import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import vm from 'node:vm';
import { buildHandoffSnapshot } from '../tools/app-handoff-snapshot.mjs';
import { openHandoffRecords } from '../tools/app-handoff-records.mjs';

const fixtureInputs = {
  contextProduct: '합성 매장 식별 정보',
  contextStrength: '합성 비고',
  contextCompetitor: '비슷한 가게가 많은 것 같아요',
  contextGoal: '방문 손님을 늘리고 싶어요',
};
const sandbox = vm.createContext({
  document: { getElementById: id => ({ value: fixtureInputs[id] || '' }) },
});
const html = readFileSync(new URL('../diagnosis.html', import.meta.url), 'utf8');
const source = html.match(/<script>([\s\S]*?)<\/script>/)[1].split('    document.getElementById("prevBtn").addEventListener')[0];
vm.runInContext(source, sandbox);
const fixture = JSON.parse(vm.runInContext(`
  Object.assign(profile, { industry: '카페', region: '충장로/동명동', operationType: '오프라인',
    businessYear: '1~3년', customerGroup: '30대', salesChannel: '현장 방문' });
  answers.competition_clear = 5;
  JSON.stringify({ diagnosis: buildDiagnosis(), answers });
`, sandbox));
const projected = buildHandoffSnapshot(fixture.diagnosis, fixture.answers);
assert.equal(projected.schemaVersion, 1);
assert.equal(projected.answers.competition_clear, 5);
assert.equal(Object.keys(projected.answers).length, 12);
assert.deepEqual(projected.result.scores, fixture.diagnosis.scores);
assert.equal(projected.result.type, fixture.diagnosis.resultType);
assert.equal(projected.operations.goal, fixtureInputs.contextGoal);
assert.equal(projected.basicReport.improvement, fixture.diagnosis.weakest.name);
assert.match(projected.basicReport.summary, /실행 준비도 60점/);
assert(!JSON.stringify(projected).includes(fixtureInputs.contextProduct));
assert(!JSON.stringify(projected).includes(fixtureInputs.contextStrength));
assert.throws(() => buildHandoffSnapshot(fixture.diagnosis, { ...fixture.answers, competition_clear: 6 }), /INVALID_SNAPSHOT/);

const folder = mkdtempSync(join(tmpdir(), 'ye-g-handoff-test-'));
const path = join(folder, 'records.db');
const encryptionKey = randomBytes(32);
const lookupKey = randomBytes(32);
const start = Date.UTC(2026, 10, 17);
let time = start;
const owner = randomUUID();
const outsider = randomUUID();
const input = { ...fixture, snapshotId: randomUUID(), consented: true, consentVersion: 'fixture-v1',
  retainUntil: Date.UTC(2029, 10, 17) };
const options = { path, encryptionKey, lookupKey, now: () => time };
let records = openHandoffRecords(options);
try {
  assert.throws(() => records.save(null, input), /AUTHENTICATION_REQUIRED/);
  assert.throws(() => records.save(owner, { ...input, consented: false }), /SAVE_POLICY_REQUIRED/);
  const saved = records.save(owner, input);
  assert.match(saved.code, /^(?:[a-f0-9]{4}-){7}[a-f0-9]{4}$/);
  assert.deepEqual(records.save(owner, input), saved);
  const changed = { ...input, answers: { ...input.answers, competition_clear: 4 } };
  assert.throws(() => records.save(owner, changed), /SNAPSHOT_CONFLICT/);
  const second = records.save(owner, { ...input, snapshotId: randomUUID() });
  assert.notEqual(second.code, saved.code);
  assert.notEqual(second.id, saved.id);
  assert.equal(records.copyCode(owner, saved.id), saved.code);
  assert.throws(() => records.copyCode(outsider, saved.id), /^Error: RECORD_NOT_AVAILABLE$/);
  assert.throws(() => records.restore(outsider, saved.code), /^Error: RECORD_NOT_AVAILABLE$/);
  assert.throws(() => records.restore(null, saved.code), /AUTHENTICATION_REQUIRED/);
  const forged = saved.code.replace(/^[a-f0-9]/, char => char === 'a' ? 'b' : 'a');
  assert.throws(() => records.restore(owner, forged), /^Error: RECORD_NOT_AVAILABLE$/);
  assert.throws(() => records.restore(owner, '잘못된 코드'), /^Error: RECORD_NOT_AVAILABLE$/);
  const base = records.restore(owner, saved.code);
  assert.equal(base.aiReport, null);
  assert.deepEqual(base.snapshot, projected);
  assert.equal(base.appLinkedAt, start);

  const update = { text: '합성 AI 실행안 원문\n대표 사진을 점검하세요.', generatedAt: start,
    consented: true, reviewed: true, consentVersion: 'ai-fixture-v1', expectedRevision: 0 };
  assert.throws(() => records.addAiReport(owner, saved.id, { ...update, consented: false }), /AI_CONSENT_REQUIRED/);
  assert.throws(() => records.addAiReport(owner, saved.id, { ...update, reviewed: false }), /AI_CONSENT_REQUIRED/);
  assert.throws(() => records.addAiReport(outsider, saved.id, update), /RECORD_NOT_AVAILABLE/);
  time = Date.UTC(2028, 10, 17);
  const revision = records.addAiReport(owner, saved.id, update);
  assert.throws(() => records.addAiReport(owner, saved.id, update), /REVISION_CONFLICT/);
  records.close();
  records = openHandoffRecords(options);
  const restored = records.restore(owner, saved.code.toUpperCase().replaceAll('-', ' '));
  assert.equal(restored.id, saved.id);
  assert.equal(restored.appLinkedAt, start);
  assert.equal(restored.revision, revision);
  assert.deepEqual(restored.aiReport, { text: update.text, generatedAt: start, updatedAt: time });
  assert.deepEqual(restored.snapshot, base.snapshot);
  assert.equal(records.copyCode(owner, saved.id), saved.code);
  assert.equal(records.restore(owner, saved.code).id, saved.id);
  const bytes = readFileSync(path);
  for (const plaintext of [saved.code.replaceAll('-', ''), update.text, projected.basicReport.summary]) {
    assert(!bytes.includes(Buffer.from(plaintext)));
  }

  records.removeAiReport(owner, saved.id);
  assert.equal(records.restore(owner, saved.code).aiReport, null);
  assert.throws(() => records.addAiReport(owner, saved.id, { ...update, expectedRevision: revision }), /REVISION_CONFLICT/);
  const rotated = records.rotate(owner, saved.id, saved.code);
  assert.notEqual(rotated, saved.code);
  assert.throws(() => records.restore(owner, saved.code), /RECORD_NOT_AVAILABLE/);
  assert.throws(() => records.rotate(owner, saved.id, saved.code), /RECORD_NOT_AVAILABLE/);
  assert.equal(records.restore(owner, rotated).id, saved.id);
  assert.throws(() => records.remove(outsider, saved.id), /RECORD_NOT_AVAILABLE/);
  records.remove(owner, saved.id);
  assert.throws(() => records.restore(owner, rotated), /RECORD_NOT_AVAILABLE/);
  assert.throws(() => records.copyCode(owner, saved.id), /RECORD_NOT_AVAILABLE/);
  assert.throws(() => records.save(owner, input), /RECORD_NOT_AVAILABLE/);

  const tamper = new DatabaseSync(path);
  try {
    const { snapshot } = tamper.prepare('SELECT snapshot FROM records WHERE id = ?').get(second.id);
    snapshot[snapshot.length - 1] ^= 1;
    tamper.prepare('UPDATE records SET snapshot = ? WHERE id = ?').run(snapshot, second.id);
    assert.throws(() => records.restore(owner, second.code), /authenticate/i);
  } finally {
    tamper.close();
  }
  time = input.retainUntil;
  assert.throws(() => records.restore(owner, second.code), /RECORD_NOT_AVAILABLE/);
  assert.equal(records.purgeExpired(), 1);
} finally {
  records.close();
  rmSync(folder, { recursive: true, force: true });
}

const allocations = [1, 1, 2];
const colliding = openHandoffRecords({ ...options, path: ':memory:', now: () => start,
  codeBytes: () => Buffer.alloc(16, allocations.shift() ?? 1) });
try {
  const first = colliding.save(owner, input);
  const second = colliding.save(owner, { ...input, snapshotId: randomUUID() });
  assert.notEqual(second.code, first.code);
  assert.throws(() => colliding.rotate(owner, first.id, first.code), /CODE_ALLOCATION_FAILED/);
  assert.equal(colliding.restore(owner, first.code).id, first.id);
  assert.throws(() => colliding.save(owner, { ...input, snapshotId: randomUUID() }), /CODE_ALLOCATION_FAILED/);
} finally {
  colliding.close();
}

console.log('PASS: synthetic snapshot fidelity, stable IDs over two years and restart, consent, encrypted storage, ownership, forgery and tamper rejection, collision retry and rollback, rotation, withdrawal, deletion and retention.');
