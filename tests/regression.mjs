import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import vm from 'node:vm';
const baseline = execFileSync('git', ['show', '30f34d8:index.html'], { encoding: 'utf8' });
const current = readFileSync('diagnosis.html', 'utf8');
function element() { return { value: '', textContent: '', innerHTML: '', children: [], dataset: {}, style: {}, appendChild(child) { this.children.push(child); }, classList: { add() {}, remove() {}, toggle() {} } }; }
function context(html) {
  const elements = new Map();
  const document = { getElementById: id => { if (!elements.has(id)) elements.set(id, element()); return elements.get(id); }, createElement: element };
  const ctx = vm.createContext({ document, console });
  const script = html.match(/<script>([\s\S]*?)<\/script>/)[1].split('    document.getElementById("prevBtn").addEventListener')[0];
  vm.runInContext(script, ctx);
  return { ctx, elements, document };
}
const before = context(baseline); const after = context(current);
const payload = c => JSON.parse(vm.runInContext('JSON.stringify(buildDiagnosis())', c.ctx));
let cases = 0;
for (let i = 0; i < 64; i++) {
  const setup = `Object.keys(choiceOptions).forEach((key, k) => profile[key] = choiceOptions[key][(${i} + k) % choiceOptions[key].length]); Object.keys(answers).forEach((key, k) => answers[key] = (${i} + k) % 5 + 1);`;
  for (const c of [before, after]) {
    vm.runInContext(setup, c.ctx);
    c.document.getElementById('contextProduct').value = `상품 ${i}`;
    c.document.getElementById('contextStrength').value = '신선한 재료';
    c.document.getElementById('contextProblem').value = '문의가 부족해요';
    if (i % 2) vm.runInContext(`marketData = {ok:true,source:'fixture',standardMonth:'202610',query:{districtName:'동구'},analysisMode:'administrative',totalCount:100,sampleCount:20,sameIndustryCount:4,competitionDensity:'보통',topCategories:[],topDongs:[],industryCodes:[],nearbyZones:[],summary:'test',note:'test'};`, c.ctx);
    else vm.runInContext('marketData=null', c.ctx);
  }
  assert.deepEqual(payload(after), payload(before));
  for (const mode of ['full', 'action', 'ai']) {
    assert.equal(vm.runInContext(`buildReportText('${mode}')`, after.ctx), vm.runInContext(`buildReportText('${mode}')`, before.ctx));
  }
  cases++;
}
for (const c of [before, after]) c.document.getElementById('aiOutput').textContent = '모의 AI 리포트\n7일 실행표';
assert.equal(vm.runInContext("buildReportText('ai')", after.ctx), vm.runInContext("buildReportText('ai')", before.ctx));
after.document.getElementById('contextProduct').value = '<img src=x onerror=alert(1)>';
vm.runInContext('renderResult()', after.ctx);
const lastActions = after.document.getElementById('actionsBox').children.slice(-6);
assert(lastActions.some(row => row.innerHTML.includes('&lt;img')));
assert(lastActions.every(row => !row.innerHTML.includes('<img')));
const baselineIds = [...baseline.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]);
const currentIds = new Set([...current.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]));
assert(baselineIds.every(id => currentIds.has(id)));
// The public-data endpoint is intentionally fixed; its request/response behavior is covered by market-query.mjs.
for (const file of ['api/diagnose.js']) assert.equal(readFileSync(file,'utf8'),execFileSync('git',['show',`30f34d8:${file}`],{encoding:'utf8'}));
for (const file of ['index.html','diagnosis.html','styles/site.css','styles/diagnosis-shell.css','scripts/character-player.mjs','scripts/character-media.mjs']) assert(!/ye-g-character\.gif|ye-g-intro\.png/.test(readFileSync(file,'utf8')));
console.log(`PASS: ${cases} diagnosis fixtures, 192 exports, AI export, input escaping, ${baselineIds.length} retained DOM IDs, unchanged AI API file, no legacy references.`);
// Verify the preserved export handlers without OS dialogs or clipboard side effects.
let copied = ''; let blob; let clicked = false; let revoked = false; const printModes = [];
after.ctx.navigator = { clipboard: { writeText: async text => { copied = text; } } };
after.ctx.Blob = Blob;
after.ctx.URL = { createObjectURL(value) { blob = value; return 'blob:test'; }, revokeObjectURL() { revoked = true; } };
after.ctx.setTimeout = fn => fn();
const classes = new Set();
after.document.body = { appendChild() {}, classList: { add:x=>classes.add(x), remove:x=>classes.delete(x) } };
after.document.querySelector = () => element();
after.document.createElement = tag => Object.assign(element(), { remove() {}, click() { clicked = true; }, setAttribute() {} });
after.ctx.window = { scrollTo() {}, print() { printModes.push(classes.has('print-text-mode')); } };
for (const mode of ['full','action','ai']) {
 after.document.getElementById('reportExportMode').value = mode;
 await vm.runInContext('copyReport()', after.ctx);
 assert.equal(copied, vm.runInContext(`buildReportText('${mode}')`, after.ctx));
 vm.runInContext('downloadReport()', after.ctx);
 assert.equal(await blob.text(), copied); assert(clicked && revoked);
 vm.runInContext('printReport()', after.ctx);
 assert.equal(classes.size, 0);
}
assert.deepEqual(printModes,[false,true,true]);
console.log('PASS: copy/TXT content and print modes for full, action, AI; object URL cleanup.');
