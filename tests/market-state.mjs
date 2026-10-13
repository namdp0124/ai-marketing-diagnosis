import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const html = readFileSync('diagnosis.html', 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1]
  .split('    document.getElementById("prevBtn").addEventListener')[0];
const emptyMessage = '선택한 조건에서 분석에 활용할 수 있는 상가업소 표본을 확인하지 못했습니다. 마케팅 진단은 입력한 점포 정보를 기준으로 계속 진행할 수 있습니다.';

function element() {
  const classes = new Set();
  return {
    value: '', textContent: '', innerHTML: '', children: [], dataset: {}, style: {},
    disabled: false,
    appendChild(child) { this.children.push(child); },
    classList: {
      add(name) { classes.add(name); },
      remove(name) { classes.delete(name); },
      contains(name) { return classes.has(name); }
    }
  };
}

function setup(response) {
  const elements = new Map();
  const document = {
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, element());
      return elements.get(id);
    },
    createElement: element
  };
  let calls = 0;
  const ctx = vm.createContext({
    document, console,
    window: { location: { protocol: 'https:' } },
    fetch: async () => {
      calls++;
      return { ok: response.ok, json: async () => response.body };
    }
  });
  vm.runInContext(script, ctx);
  const diagnosis = () => JSON.parse(vm.runInContext('JSON.stringify(buildDiagnosis())', ctx));
  const report = () => vm.runInContext('buildReportText("full")', ctx);
  return { ctx, document, diagnosis, report, calls: () => calls };
}

const fixture = {
  ok: true, sampleCount: 12, sameIndustryCount: 0, totalCount: 50,
  analysisMode: 'administrative', query: { districtName: '동구' },
  competitionDensity: '낮음', summary: '모의 표본 12개',
  topCategories: [], topDongs: [], industryCodes: [], nearbyZones: [],
  marketInsight: { characterLabel: '모의 상권', opportunityIndustries: ['모의 추천 업종'], recommendedMessage: '모의 추천 문구' }
};

const normal = setup({ ok: true, body: fixture });
await vm.runInContext('loadMarketData()', normal.ctx);
assert.equal(normal.calls(), 1);
assert.equal(normal.diagnosis().publicDataContext.sampleStores, 12);
assert.equal(normal.diagnosis().publicDataContext.sameIndustryStores, 0);
assert.match(normal.document.getElementById('marketStatus').textContent, /데이터를 반영했습니다/);
assert(normal.document.getElementById('marketSummary').classList.contains('show'));
assert.match(normal.report(), /모의 표본 12개/);

const empty = setup({ ok: true, body: { ...fixture, sampleCount: 0, sameIndustryCount: 0 } });
await vm.runInContext('loadMarketData()', empty.ctx);
assert.equal(empty.calls(), 1);
assert.equal(empty.document.getElementById('marketStatus').textContent, emptyMessage);
assert.equal(empty.document.getElementById('marketSummary').innerHTML, '');
assert.equal(empty.diagnosis().publicDataContext, null);
assert(!empty.diagnosis().actions.some(action => action.includes('소상공인365') || action.includes('모의 추천')));
assert(!empty.document.getElementById('marketResultBox').textContent.includes('모의 추천'));
assert.match(empty.report(), /분석에 활용할 수 있는 상가업소 표본을 확인하지 못했습니다/);
assert(!empty.report().includes('모의 추천'));

const failure = setup({ ok: false, body: { error: '모의 연결 오류' } });
await vm.runInContext('loadMarketData()', failure.ctx);
assert.equal(failure.calls(), 1);
assert.match(failure.document.getElementById('marketStatus').textContent, /공공데이터 조회에 실패했습니다/);
assert.equal(failure.document.getElementById('marketSummary').innerHTML, '');
assert.equal(failure.diagnosis().publicDataContext, null);
assert.match(failure.report(), /공공데이터 조회에 실패했습니다/);

assert.equal(normal.diagnosis().scores.overall, empty.diagnosis().scores.overall);
assert.equal(empty.diagnosis().scores.overall, failure.diagnosis().scores.overall);
console.log('PASS: 정상 표본(동일 업종 0건 포함), 표본 0건, 조회 실패; 기본 점수 유지 및 공공데이터 근거 차단.');
