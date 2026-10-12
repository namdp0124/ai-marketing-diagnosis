import assert from 'node:assert/strict';
const base='http://127.0.0.1:4173';
for(const route of ['/','/diagnosis.html','/diagnosis','/diagnosis/']){
 const response=await fetch(base+route);assert.equal(response.status,200);
 const html=await response.text();assert(!/ye-g-character\.gif|ye-g-intro\.png/.test(html));
 if(route==='/'){
  assert.equal([...html.matchAll(/href="\/diagnosis\.html"/g)].length,6);
  assert(!html.includes('href="/diagnosis"'));
 }
 const resources=[...html.matchAll(/(?:src|href)="(\/(?:styles|scripts|assets)[^"]+)"/g)].map(m=>m[1]);
 for(const src of new Set(resources))assert.equal((await fetch(base+src,{method:'HEAD'})).status,200,src);
}
for(const route of ['/about','/local','/news','/app','/contact','/api/unknown','/assets/ye-g-character.gif','/.env','/tools/preview.mjs'])assert.equal((await fetch(base+route)).status,404,route);
for(let n=1;n<=4;n++){
 const response=await fetch(`${base}/assets/brand/ye-g-motion-${n}.mp4`,{headers:{Range:'bytes=0-1023'}});
 assert.equal(response.status,206);assert.equal((await response.arrayBuffer()).byteLength,1024);
 assert.equal(response.headers.get('content-type'),'video/mp4');
}
for(const endpoint of ['diagnose','market-data'])assert.equal((await fetch(`${base}/api/${endpoint}`)).status,405);
const post=async(endpoint,body)=>fetch(`${base}/api/${endpoint}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
const diagnosis=await post('diagnose',{profile:{region:'광주 전체'},scores:{overall:65}});assert.equal(diagnosis.status,200);assert((await diagnosis.json()).result.includes('모의 응답'));
assert.equal((await post('diagnose',{})).status,400);
const market=await post('market-data',{district:'동구'});assert.equal(market.status,200);assert.equal((await market.json()).ok,true);
console.log('PASS: local routes, refresh targets, linked resources, future-page 404s, legacy/private paths blocked, all 4 MP4 byte ranges, mock API methods/payloads.');
