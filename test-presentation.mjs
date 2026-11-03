import assert from 'node:assert/strict';
import {SnapshotBuffer,PredictedView,presentationTimers,blendMotion} from './dist/net-presentation.js';
import {weaponPose} from './dist/weapon-presentation.js';
import {Rooms,validateInput} from './multiplayer/rooms.mjs';
const motion=x=>({x,y:0,z:0,yaw:0,pitch:0,crouched:false,weapon:'sniper'});
// Model TCP bursts, stalled delivery and 50–200ms RTT at multiple render rates.
for(const fps of [30,60,144])for(const rtt of [.05,.1,.2]){
 const buffer=new SnapshotBuffer(),arrivals=[];let ordered=0;
 for(let n=0;n<=160;n++){
   const at=n*.05,jitter=[0,.008,.004,.036,0,.012,.055,0][n%8];
   ordered=Math.max(ordered,at+rtt/2+jitter+(n>=60&&n<=62?.09:0));
   arrivals.push({at,arrival:ordered,motion:motion(at*3)});
 }
 let previous=-Infinity,maxStep=0,frames=0;
 for(let t=0;t<8;t+=1/fps){
   while(arrivals.length&&arrivals[0].arrival<=t){const p=arrivals.shift();buffer.push(p.at,p.arrival,p.motion);}
   const s=buffer.sample(t,1/fps);if(!s)continue;
   assert.ok(s.x>=previous-1e-9,'packet jitter never reverses a continuously advancing opponent');
   if(Number.isFinite(previous)&&t>1)maxStep=Math.max(maxStep,s.x-previous);
   previous=s.x;frames++;
 }
 assert.ok(frames>fps*6);assert.ok(maxStep<3/fps*1.5,`${fps}fps ${rtt*1000}ms: no burst teleport ${maxStep}`);
 assert.ok(buffer.delay>=.075&&buffer.delay<=.15);
 assert.equal(buffer.push(0,9,motion(-100)),false,'stale snapshot rejected');
}
const view=new PredictedView();view.reset(motion(0));view.advance(motion(0),motion(.1));
const before=view.sample(.5,0);view.correct(motion(.1),motion(-.05));
assert.equal(view.sample(.5,0).x,before.x,'correction preserves rendered position at arrival');
for(let i=0;i<60;i++)view.sample(.5,1/60);
assert.ok(Math.abs(view.error.x)<1e-8,'visual correction converges without changing physics');
view.correct(motion(0),motion(10));assert.equal(view.sample(.5,0).x,10,'large corrections snap, not travel through geometry');
assert.deepEqual(presentationTimers({reload:1,knife:.02,cooldown:.05},.075),{reload:.925,knife:0,cooldown:0});
assert.ok(Math.abs(blendMotion({...motion(0),yaw:3.13},{...motion(1),yaw:-3.13},.5).yaw-Math.PI)<.02,'yaw wraps via shortest arc');
// Exact shot time: 100ms round trip + 85ms presentation buffer = 185ms rewind.
const rooms=new Rooms({}),history=[];for(let n=0;n<=60;n++)history.push({at:n/60,motion:motion(n/60*6)});
const pose=rooms.targetAt({history,motion:motion(6)},1,{client:{rtt:.1},renderDelay:.085});
assert.ok(Math.abs(pose.x-(1-.185)*6)<1e-8,'moving-target rewind includes downlink and uplink plus buffer');
assert.ok(rooms.targetAt({history,motion:motion(6)},1,{client:{rtt:5},renderDelay:5}).x>=4.5,'rewind capped at 250ms');
const validated=validateInput({seq:1,renderDelay:9,input:{forward:0,side:0,yaw:0,pitch:0,weapon:'sniper'}});
assert.equal(validated.renderDelay,.15,'client cannot choose unlimited rewind');
const input={weapon:'shotgun',aim:false,yaw:0,pitch:0,speed:0,sprint:false,bob:0,recoil:0,reload:0,reloadDuration:2.2,cooldown:0};
for(const fps of [30,60,144]){
 const state={};for(let n=0;n<fps;n++)weaponPose(state,input,1/fps);
 let p;for(let n=0;n<fps/2;n++)p=weaponPose(state,{...input,aim:true},1/fps);
 assert.ok(p.ads>.999,'ADS independent of frame rate');assert.ok(Math.abs(p.x-.04)<.001);
}
let s={};let p=weaponPose(s,{...input,reload:1.1},1/60);assert.ok(p.breech>.6&&p.hand>0,'shotgun opens and support hand loads');
p=weaponPose(s,{...input,reload:.01},1/60);assert.ok(p.breech<.01,'shotgun closes before reload ends');
p=weaponPose({}, {...input,weapon:'sniper',reloadDuration:2.1,reload:1},1/60);assert.ok(p.magazine>.2,'sniper magazine comes out');
p=weaponPose({}, {...input,weapon:'sniper',cooldown:.65},1/60);assert.ok(p.bolt>.1&&p.boltLift>.9,'bolt lifts and draws back after firing');
p=weaponPose({}, {...input,weapon:'sniper',cooldown:0},1/60);assert.equal(p.bolt,0);assert.equal(p.boltLift,0);
console.log('PASS presentation: 9 delay/jitter/frame-rate scenarios, monotonic interpolation, correction continuity, timer aging, bounded moving-target rewind, ADS, staged reloads and bolt cycle.');
