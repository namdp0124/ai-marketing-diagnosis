import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// Synthetic upstream responses; this test never calls an external API.
const empty = { header: { resultCode: '03', resultMsg: 'NODATA_ERROR' }, body: {} };
const codes = ['12210', '12240', '12270', '12300', '12330'];
function setup(stores, respond) {
  const calls = [];
  const ctx = vm.createContext({
    module: { exports: {} }, process: { env: { SMALLBIZ365_SERVICE_KEY: 'fake-key' } },
    URLSearchParams,
    fetch: async value => {
      const url = new URL(value);
      calls.push(url);
      const data = url.pathname.endsWith('/storeListInDong') ? stores(url) : empty;
      return respond ? respond(url, data) : { ok: true, text: async () => JSON.stringify(data) };
    }
  });
  vm.runInContext(readFileSync('api/market-data.js', 'utf8'), ctx);
  const run = async body => {
    let output;
    await ctx.module.exports({ method: 'POST', body }, {
      statusCode: 200, setHeader() {},
      end(text) { output = { status: this.statusCode, body: JSON.parse(text) }; }
    });
    return output;
  };
  return { ctx, calls, run };
}
function page(items, totalCount = items.length) {
  return { header: { resultCode: '00', stdrYm: '202606' }, body: { totalCount, items } };
}
const cafe = { bizesId: 'fixture-cafe', indsSclsCd: 'I21201', indsSclsNm: '카페' };
const other = { bizesId: 'fixture-other', indsSclsNm: '세탁' };

const single = setup(url => {
  assert.equal(url.searchParams.get('divId'), 'signguCd');
  assert.equal(url.searchParams.get('key'), '12210');
  assert.equal(url.searchParams.get('numOfRows'), '1000');
  assert.equal(url.searchParams.get('type'), 'json');
  return page(url.searchParams.get('pageNo') === '1' ? Array(1000).fill(cafe) : Array(500).fill(other), 1500);
});
const normal = await single.run({ district: '동구', industry: '카페', longitude: '', latitude: ' ' });
assert.equal(normal.status, 200);
assert.equal(normal.body.totalCount, 1500);
assert.equal(normal.body.sampleCount, 1500);
assert.equal(normal.body.sameIndustryCount, 1000);
assert.equal(normal.body.analysisMode, 'administrative');
assert.equal(normal.body.query.longitude, null);
assert.equal(normal.body.query.latitude, null);
assert(!single.calls.some(url => /Radius|baroApi/.test(url.pathname)));
assert.equal(single.calls.filter(url => url.pathname.endsWith('/storeListInDong')).length, 2);
for (const value of ['null', 'undefined', '""', '"  "']) {
  assert.equal(vm.runInContext(`parseNumber(${value})`, single.ctx), null);
}
assert.equal(vm.runInContext('parseNumber(0)', single.ctx), 0);
assert.equal(vm.runInContext('parseNumber("126.9231")', single.ctx), 126.9231);

const city = setup(url => {
  assert(codes.includes(url.searchParams.get('key')));
  return page([cafe, other]);
});
const all = await city.run({ region: '광주 전체', district: '광주 전체', industry: '카페' });
assert.equal(all.body.query.districtName, '광주 전체');
assert.deepEqual(all.body.query.districtCodes, codes);
assert.equal(all.body.query.districtCounts.length, 5);
assert.equal(all.body.totalCount, 10);
assert.equal(all.body.sampleCount, 10);
assert.equal(all.body.sameIndustryCount, 5);
assert.equal(city.calls.filter(url => url.pathname.endsWith('/storeListInDong')).length, 5);
assert(!city.calls.some(url => url.searchParams.get('key') === '12' || url.pathname.endsWith('/baroApi')));
await city.run({ region: '광주 전체', industry: '카페' }); // Automatic selection also covers five districts.
for (const [district, code] of Object.entries({ 동구: '12210', 서구: '12240', 남구: '12270', 북구: '12300', 광산구: '12330' })) {
  const result = await city.run({ region: '광주 전체', district });
  assert.equal(result.body.query.districtCode, code); // An explicit district overrides the city-wide profile.
}

const zero = await setup(() => empty).run({ district: '동구', industry: '카페' });
assert.equal(zero.status, 200);
assert.equal(zero.body.sampleCount, 0);
const noCafe = await setup(() => page([other])).run({ district: '동구', industry: '카페' });
assert.equal(noCafe.body.sampleCount, 1);
assert.equal(noCafe.body.sameIndustryCount, 0);
const failure = await setup(() => ({ header: { resultCode: '30', resultMsg: 'SERVICE_KEY_IS_NOT_REGISTERED_ERROR' } })).run({ district: '동구' });
assert.equal(failure.status, 502);
assert.equal(failure.body.ok, undefined);
const partialFailure = await setup(url => url.searchParams.get('key') === '12270'
  ? { header: { resultCode: '30', resultMsg: 'SERVICE_KEY_IS_NOT_REGISTERED_ERROR' } }
  : page([cafe])).run({ region: '광주 전체' });
assert.equal(partialFailure.status, 502); // Do not label a partial city-wide response as a complete success.

// The requested dong is filtered only within the fetched district sample.
const dongs = setup(() => page([
  { ...cafe, adongNm: '동명동', ldongNm: '동명동' },
  { ...other, adongNm: '충장동', ldongNm: '충장동' }
]));
const dong = await dongs.run({ district: '동구', dongName: '동명동', industry: '카페', longitude: '', latitude: '' });
assert.equal(dong.body.totalCount, 2);
assert.equal(dong.body.sampleCount, 1);
assert.equal(dong.body.sameIndustryCount, 1);
assert.match(dong.body.summary, /동구 동명동 표본 1개/);
const fallback = await dongs.run({ district: '동구', dongName: '표본에없는동', industry: '카페' });
assert.equal(fallback.body.sampleCount, 2);
assert.match(fallback.body.note, /행정구 표본으로 요약/);
assert(!dongs.calls.some(url => url.pathname.endsWith('/storeListInRadius')));

const nested = await setup(() => ({ response: page([cafe]) })).run({ district: '동구' });
assert.equal(nested.body.sampleCount, 1);
const httpError = await setup(() => page([cafe]), (url, data) => ({ ok: false, text: async () => JSON.stringify(data) })).run({ district: '동구' });
assert.equal(httpError.status, 502);
const invalidJson = await setup(() => page([cafe]), () => ({ ok: true, text: async () => '<upstream-error />' })).run({ district: '동구' });
assert.equal(invalidJson.status, 502);
const networkError = await setup(() => { throw Error('Synthetic upstream unavailable'); }).run({ district: '동구' });
assert.equal(networkError.status, 502);
assert.equal(networkError.body.ok, undefined);

console.log('PASS: July 2026 codes, five-district scope, pagination/counts, blank coordinates, valid zero coordinates, empty samples, same-industry zero, dong filtering/fallback, nested responses and HTTP/JSON/network/upstream errors. No live calls.');
