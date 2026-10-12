// Execute the existing handlers with isolated fake env and fake upstream fetch.
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
function harness(file, env, upstream) {
 const ctx=vm.createContext({module:{exports:{}},process:{env},URLSearchParams,console,fetch:upstream});
 vm.runInContext(readFileSync(file,'utf8'),ctx);
 return async(method,body)=>{let result;const response={statusCode:200,setHeader(){},end(text){result={status:this.statusCode,body:JSON.parse(text)};}};await ctx.module.exports({method,body},response);return result;};
}
let calls=[];
const ai=harness('api/diagnose.js',{OPENAI_API_KEY:'test-placeholder'},async(url,options)=>{
 calls.push({url,body:JSON.parse(options.body)});return {ok:true,json:async()=>({output:[{content:[{text:'모의 결과'}]}],status:'completed'})};
});
assert.equal((await ai('GET',{})).status,405);
assert.equal((await ai('POST','invalid')).status,400);
assert.equal((await ai('POST',{})).status,400);
const response=await ai('POST',{profile:{industry:'카페'},scores:{overall:60}});
assert.equal(response.body.result,'모의 결과');assert.equal(calls.length,1);assert.equal(calls[0].url,'https://api.openai.com/v1/responses');assert.equal(calls[0].body.model,'gpt-5-mini');
const missing=harness('api/diagnose.js',{},()=>{throw Error('Must not call upstream');});assert.equal((await missing('POST',{})).status,500);
const limit=harness('api/diagnose.js',{OPENAI_API_KEY:'test'},async()=>({ok:false,status:429,json:async()=>({error:{message:'mock rate limit'}})}));assert.equal((await limit('POST',{profile:{},scores:{}})).status,429);
let marketCalls=0;
const market=harness('api/market-data.js',{SMALLBIZ365_SERVICE_KEY:'test-placeholder'},async()=>{marketCalls++;return {ok:true,text:async()=>JSON.stringify({response:{header:{resultCode:'00'},body:{totalCount:0,items:[]}}})};});
assert.equal((await market('GET',{})).status,405);
assert.equal((await market('POST','invalid')).status,400);
const data=await market('POST',{region:'충장로/동명동',industry:'카페'});assert.equal(data.status,200);assert.equal(data.body.ok,true);assert.equal(data.body.analysisMode,'administrative');assert(marketCalls>0);
console.log('PASS: unchanged API contracts, request validation, missing-key handling, upstream 429, mocked AI parsing and public-data response; zero live calls.');
