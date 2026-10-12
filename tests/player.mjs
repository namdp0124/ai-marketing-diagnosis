import assert from 'node:assert/strict';
class Classes { constructor(){this.values=new Set();} add(x){this.values.add(x);} remove(x){this.values.delete(x);} toggle(x,on){on?this.add(x):this.remove(x);} }
class Video {
 constructor(){this.events={};this.classList=new Classes();this.currentTime=0;this.paused=true;this.ended=false;this.src='';this.loads=0;}
 addEventListener(name,fn){this.events[name]=fn;}
 getAttribute(name){return this[name]||null;}
 load(){this.loads++;this.ended=false;}
 pause(){this.paused=true;}
 play(){if(this.reject)return Promise.reject(new Error('NotAllowedError'));this.paused=false;this.ended=false;return Promise.resolve();}
 requestVideoFrameCallback(fn){queueMicrotask(fn);}
 finish(){this.ended=true;this.paused=true;this.events.ended();}
}
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const globalEvents={};
globalThis.document={hidden:false,querySelectorAll:()=>[],addEventListener:(name,fn)=>globalEvents[name]=fn};
let motion;
globalThis.matchMedia=()=>motion={matches:false,addEventListener:(name,fn)=>motion.change=fn};
const {CharacterPlayer}=await import('../scripts/character-player.mjs');
function fixture(reduced=false,rejected=false){
 const videos=[new Video(),new Video()];videos[0].reject=rejected;
 const nodes={};for(const key of ['[data-playback-toggle]','[data-playback-status]','[data-clip-number]','[data-character-poster]'])nodes[key]={textContent:'',attributes:{},setAttribute(k,v){this.attributes[k]=v;},addEventListener(k,fn){this[k]=fn;}};
 const root={dataset:{},querySelectorAll:()=>videos,querySelector:key=>nodes[key]};
 globalThis.matchMedia=()=>motion={matches:reduced,addEventListener:(name,fn)=>motion.change=fn};
 const player=new CharacterPlayer(root);return {player,videos,root,nodes,motion};
}
let f=fixture();await tick();assert.equal(f.root.dataset.clip,'1');
const sequence=['1'];for(let i=0;i<8;i++){f.videos[f.player.active].finish();await tick();sequence.push(f.root.dataset.clip);}
assert.deepEqual(sequence,['1','2','3','4','1','2','3','4','1']);
assert(f.videos.every(v=>v.muted&&!v.loop));
assert.equal(f.videos[1-f.player.active].autoplay,false);
f.nodes['[data-playback-toggle]'].click();assert(f.videos.every(v=>v.paused));
f.nodes['[data-playback-toggle]'].click();await tick();assert(!f.videos[f.player.active].paused);
f.motion.matches=true;f.motion.change();assert.equal(f.root.dataset.playback,'poster');assert(f.videos.every(v=>v.paused));
f.motion.matches=false;f.motion.change();await tick();assert.equal(f.root.dataset.playback,'playing');
f.videos[f.player.active].events.error();assert.equal(f.root.dataset.playback,'poster');
f.nodes['[data-playback-toggle]'].click();await tick();assert.equal(f.root.dataset.playback,'playing');
f=fixture(true);await tick();assert(f.videos.every(v=>!v.src));assert(f.nodes['[data-playback-toggle]'].disabled);
f=fixture(false,true);await tick();assert.equal(f.root.dataset.playback,'poster');assert.equal(f.nodes['[data-playback-toggle]'].textContent,'다시 재생');
f.videos[0].reject=false;f.nodes['[data-playback-toggle]'].click();await tick();assert.equal(f.root.dataset.playback,'playing');
document.hidden=true;globalEvents.visibilitychange();assert(f.videos.every(v=>v.paused));
document.hidden=false;globalEvents.visibilitychange();await tick();assert(!f.videos[f.player.active].paused);
console.log('PASS: 2 full playback cycles, mute, inactive preload, pause/resume, reduced motion at startup/change, load error, autoplay rejection/retry, visibility pause/resume.');
