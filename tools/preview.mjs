// Local-only static preview. Never calls external services or reads .env files.
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.env.PORT || 4173);
const mock = process.argv.includes('--mock-api');
const config = JSON.parse(await readFile(path.join(root, 'vercel.json'), 'utf8'));
const routes = new Map(config.rewrites.map(rule => [rule.source, rule.destination]));
const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.png': 'image/png', '.webp': 'image/webp', '.mp4': 'video/mp4' };
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  const json = (status, data) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data)); };
  try {
    if (url.pathname.startsWith('/api/')) {
      if (!['/api/diagnose', '/api/market-data'].includes(url.pathname)) return json(404, { error: 'Unknown local API' });
      if (!mock) return json(503, { error: '로컬에서는 외부 API를 호출하지 않습니다. --mock-api로 검증 서버를 실행하세요.' });
      if (req.method !== 'POST') return json(405, { error: 'POST only' });
      let body = '';
      for await (const chunk of req) { body += chunk; if (body.length > 200000) return json(413, { error: 'Payload too large' }); }
      let input;
      try { input = JSON.parse(body); } catch { return json(400, { error: 'Invalid JSON' }); }
      if (url.pathname === '/api/diagnose') {
        if (!input.profile || !input.scores) return json(400, { error: 'Missing diagnosis fields' });
        console.log('MOCK POST /api/diagnose 200');
        return json(200, { result: '[로컬 검증용 모의 응답 — 실제 AI 결과가 아닙니다]\n예지의 냉정한 판단\n매장의 선택 이유를 한 문장으로 정리해보세요.\n\n오늘 바로 바꿀 3가지\n1. 대표 사진 점검\n2. 소개 문구 점검\n3. 문의 동선 점검\n\n7일 실행표\n1일차: 소개 문구 작성\n2일차: 사진 점검\n3일차: 리뷰 답글 작성\n4일차: 안내 게시\n5일차: 반응 확인\n6일차: 문구 보완\n7일차: 다음 실행 선택', incomplete: false, reason: '' });
      }
      console.log('MOCK POST /api/market-data 200');
      return json(200, { ok: true, source: '로컬 검증용 모의 상권 데이터', standardMonth: '테스트', analysisMode: 'administrative', query: { districtName: input.district || '동구', dongName: input.dongName || '', radius: 500 }, totalCount: 100, sampleCount: 20, sameIndustryCount: 4, competitionDensity: '보통', topCategories: [{ name: '검증용 업종', count: 4 }], topDongs: [], industryCodes: [], nearbyZones: [], summary: '검증용 표본입니다. 실제 통계가 아닙니다.', note: '외부 API 호출 없음' });
    }
    if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405); return res.end(); }
    let pathname = decodeURIComponent(url.pathname);
    pathname = routes.get(pathname) || pathname;
    if (pathname === '/') pathname = '/index.html';
    const allowed = ['/index.html', '/diagnosis.html', '/404.html'].includes(pathname) || /^\/(styles|scripts|assets\/brand)\/[a-zA-Z0-9._-]+$/.test(pathname);
    let file = path.join(root, pathname);
    let status = 200;
    if (!allowed || pathname.endsWith('.json')) { file = path.join(root, '404.html'); status = 404; }
    let info;
    try { info = await stat(file); } catch { file = path.join(root, '404.html'); status = 404; info = await stat(file); }
    const headers = { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
    if (file.endsWith('.html')) {
      let html = await readFile(file, 'utf8');
      // Local preview uses the physical HTML path; deployed markup keeps /diagnosis.
      if (file.endsWith('index.html')) html = html.replaceAll('href="/diagnosis"', 'href="/diagnosis.html"');
      if (mock && file.endsWith('diagnosis.html')) html = html.replace('<body>', '<body><div role="note" style="padding:10px 20px;background:#fff1c7;color:#453510;font:13px sans-serif">로컬 검증 모드 · 공공데이터와 AI는 모의 응답입니다. 실제 외부 API를 호출하지 않습니다.</div>');
      headers['Content-Length'] = Buffer.byteLength(html);
      res.writeHead(status, headers); return res.end(req.method === 'HEAD' ? undefined : html);
    }
    headers['Accept-Ranges'] = 'bytes';
    const range = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range || '');
    if (range) {
      const start = Number(range[1]); const end = Math.min(range[2] ? Number(range[2]) : info.size - 1, info.size - 1);
      if (start > end || start >= info.size) { res.writeHead(416, { 'Content-Range': `bytes */${info.size}` }); return res.end(); }
      Object.assign(headers, { 'Content-Range': `bytes ${start}-${end}/${info.size}`, 'Content-Length': end - start + 1 });
      res.writeHead(206, headers); if (req.method === 'HEAD') return res.end();
      return createReadStream(file, { start, end }).pipe(res);
    }
    headers['Content-Length'] = info.size;
    res.writeHead(status, headers); if (req.method === 'HEAD') return res.end();
    createReadStream(file).pipe(res);
  } catch { json(500, { error: 'Local preview error' }); }
});
server.listen(port, '127.0.0.1', () => console.log(`YE-G local preview: http://127.0.0.1:${port} (${mock ? 'MOCK API; no external calls' : 'API disabled'})`));
