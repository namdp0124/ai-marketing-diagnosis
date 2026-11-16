import { createCipheriv, createDecipheriv, createHmac, randomBytes, randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { buildHandoffSnapshot } from './app-handoff-snapshot.mjs';

// Local persistence for synthetic tests. Vercel excludes tools/ from deployments.
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const noRecord = () => new Error('RECORD_NOT_AVAILABLE');
const requireSubject = subject => {
  if (!uuid.test(subject ?? '')) throw new Error('AUTHENTICATION_REQUIRED');
};
const normaliseCode = code => {
  if (typeof code !== 'string' || code.length > 64) return null;
  const value = code.replace(/[ -]/g, '').toLowerCase();
  return /^[a-f0-9]{32}$/.test(value) ? value : null;
};
const displayCode = code => code.match(/.{4}/g).join('-');

export function openHandoffRecords({ path, encryptionKey, lookupKey, now = Date.now, codeBytes = () => randomBytes(16) }) {
  if (!Buffer.isBuffer(encryptionKey) || !Buffer.isBuffer(lookupKey) ||
      encryptionKey.length !== 32 || lookupKey.length !== 32 || encryptionKey.equals(lookupKey)) {
    throw new Error('INVALID_KEYS');
  }
  const db = new DatabaseSync(path);
  db.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;
    PRAGMA secure_delete = ON;
    CREATE TABLE IF NOT EXISTS records (
      id TEXT PRIMARY KEY,
      owner TEXT NOT NULL,
      source TEXT NOT NULL UNIQUE,
      retain_until INTEGER NOT NULL,
      snapshot BLOB NOT NULL,
      ai_report BLOB,
      revision INTEGER NOT NULL DEFAULT 0,
      app_linked_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS codes (
      digest TEXT PRIMARY KEY,
      record_id TEXT NOT NULL REFERENCES records(id) ON DELETE CASCADE,
      secret BLOB,
      active INTEGER NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS one_current_code ON codes(record_id) WHERE active = 1;
    CREATE TABLE IF NOT EXISTS deleted_sources (
      source TEXT PRIMARY KEY,
      until INTEGER NOT NULL
    );
  `);

  function transaction(work) {
    db.exec('BEGIN IMMEDIATE');
    try {
      const result = work();
      db.exec('COMMIT');
      return result;
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }

  const digest = (purpose, value) => createHmac('sha256', lookupKey).update(purpose + ':' + value).digest('hex');
  const aad = (row, field) => Buffer.from(JSON.stringify([row.id, row.owner, field]));
  function seal(row, field, value) {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', encryptionKey, iv);
    cipher.setAAD(aad(row, field));
    const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]);
  }
  function unseal(row, field, value) {
    const bytes = Buffer.from(value);
    const decipher = createDecipheriv('aes-256-gcm', encryptionKey, bytes.subarray(0, 12));
    decipher.setAAD(aad(row, field));
    decipher.setAuthTag(bytes.subarray(12, 28));
    return JSON.parse(Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]));
  }

  function allocateCode(row) {
    const insert = db.prepare('INSERT INTO codes VALUES (?, ?, ?, 1) ON CONFLICT(digest) DO NOTHING');
    for (let attempt = 0; attempt < 8; attempt++) {
      const bytes = codeBytes();
      if (!Buffer.isBuffer(bytes) || bytes.length !== 16) throw new Error('INVALID_RANDOMNESS');
      const raw = bytes.toString('hex');
      const codeDigest = digest('code', raw);
      if (insert.run(codeDigest, row.id, seal(row, 'code:' + codeDigest, raw)).changes === 1) return displayCode(raw);
    }
    throw new Error('CODE_ALLOCATION_FAILED');
  }

  function owned(subject, id) {
    requireSubject(subject);
    const row = db.prepare('SELECT * FROM records WHERE id = ? AND owner = ? AND retain_until > ?').get(id, subject, now());
    if (!row) throw noRecord();
    return row;
  }

  function copyCode(subject, id) {
    requireSubject(subject);
    const row = db.prepare(`SELECT r.id, r.owner, c.digest, c.secret FROM records r JOIN codes c ON c.record_id = r.id
      WHERE r.id = ? AND r.owner = ? AND r.retain_until > ? AND c.active = 1`).get(id, subject, now());
    if (!row) throw noRecord();
    return displayCode(unseal(row, 'code:' + row.digest, row.secret));
  }

  function save(subject, { snapshotId, diagnosis, answers, consented, consentVersion, retainUntil }) {
    requireSubject(subject);
    const savedAt = now();
    if (consented !== true || !uuid.test(snapshotId ?? '') || !Number.isSafeInteger(retainUntil) || retainUntil <= savedAt ||
        typeof consentVersion !== 'string' || !/^[a-z0-9.-]{1,32}$/i.test(consentVersion)) {
      throw new Error('SAVE_POLICY_REQUIRED');
    }
    const snapshot = buildHandoffSnapshot(diagnosis, answers);
    const source = digest('snapshot', subject + ':' + snapshotId);
    return transaction(() => {
      const existing = db.prepare('SELECT * FROM records WHERE source = ?').get(source);
      if (existing) {
        if (existing.retain_until <= savedAt) throw noRecord();
        if (JSON.stringify(unseal(existing, 'snapshot', existing.snapshot).data) !== JSON.stringify(snapshot)) {
          throw new Error('SNAPSHOT_CONFLICT');
        }
        return { id: existing.id, code: copyCode(subject, existing.id) };
      }
      if (db.prepare('SELECT 1 FROM deleted_sources WHERE source = ? AND until > ?').get(source, savedAt)) throw noRecord();
      const row = { id: randomUUID(), owner: subject };
      db.prepare('INSERT INTO records (id, owner, source, retain_until, snapshot) VALUES (?, ?, ?, ?, ?)')
        .run(row.id, subject, source, retainUntil, seal(row, 'snapshot', { data: snapshot, consentVersion, savedAt }));
      return { id: row.id, code: allocateCode(row) };
    });
  }

  function addAiReport(subject, id, { text, generatedAt, consented, consentVersion, reviewed, expectedRevision }) {
    return transaction(() => {
      const row = owned(subject, id);
      if (row.revision !== expectedRevision) throw new Error('REVISION_CONFLICT');
      const updatedAt = now();
      if (consented !== true || reviewed !== true || typeof consentVersion !== 'string' || !/^[a-z0-9.-]{1,32}$/i.test(consentVersion)) {
        throw new Error('AI_CONSENT_REQUIRED');
      }
      if (typeof text !== 'string' || !text.trim() || Buffer.byteLength(text) > 32768 ||
          !Number.isSafeInteger(generatedAt) || generatedAt < 0 || generatedAt > updatedAt) {
        throw new Error('INVALID_AI_REPORT');
      }
      const report = { text, generatedAt, updatedAt, consentVersion };
      db.prepare('UPDATE records SET ai_report = ?, revision = revision + 1 WHERE id = ?')
        .run(seal(row, 'aiReport', report), id);
      return row.revision + 1;
    });
  }

  function removeAiReport(subject, id) {
    return transaction(() => {
      const row = owned(subject, id);
      db.prepare('UPDATE records SET ai_report = NULL, revision = revision + 1 WHERE id = ?').run(row.id);
    });
  }

  function restore(subject, code) {
    requireSubject(subject);
    const raw = normaliseCode(code);
    if (!raw) throw noRecord();
    return transaction(() => {
      const linkedAt = now();
      const row = db.prepare(`SELECT r.* FROM records r JOIN codes c ON c.record_id = r.id
        WHERE c.digest = ? AND c.active = 1 AND r.owner = ? AND r.retain_until > ?`)
        .get(digest('code', raw), subject, linkedAt);
      if (!row) throw noRecord();
      const snapshot = unseal(row, 'snapshot', row.snapshot).data;
      let aiReport = null;
      if (row.ai_report) {
        const { text, generatedAt, updatedAt } = unseal(row, 'aiReport', row.ai_report);
        aiReport = { text, generatedAt, updatedAt };
      }
      db.prepare('UPDATE records SET app_linked_at = COALESCE(app_linked_at, ?) WHERE id = ?').run(linkedAt, row.id);
      return { id: row.id, snapshot, aiReport, revision: row.revision, retainUntil: row.retain_until, appLinkedAt: row.app_linked_at ?? linkedAt };
    });
  }

  function rotate(subject, id, currentCode) {
    return transaction(() => {
      const row = owned(subject, id);
      const raw = normaliseCode(currentCode);
      if (!raw || !db.prepare('UPDATE codes SET secret = NULL, active = 0 WHERE digest = ? AND record_id = ? AND active = 1')
        .run(digest('code', raw), id).changes) throw noRecord();
      return allocateCode(row);
    });
  }

  function remove(subject, id) {
    return transaction(() => {
      requireSubject(subject);
      const row = db.prepare('SELECT source, retain_until FROM records WHERE id = ? AND owner = ?').get(id, subject);
      if (!row) throw noRecord();
      db.prepare('INSERT INTO deleted_sources VALUES (?, ?)').run(row.source, row.retain_until);
      db.prepare('DELETE FROM records WHERE id = ?').run(id);
    });
  }

  function purgeExpired() {
    return transaction(() => {
      const time = now();
      db.prepare('DELETE FROM deleted_sources WHERE until <= ?').run(time);
      return db.prepare('DELETE FROM records WHERE retain_until <= ?').run(time).changes;
    });
  }

  return { save, copyCode, addAiReport, removeAiReport, restore, rotate, remove, purgeExpired, close: () => db.close() };
}
