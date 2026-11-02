import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import WebSocket from 'ws';
import {loadWorld,V,castShot} from './multiplayer/world.mjs';
import {Rooms,validateInput} from './multiplayer/rooms.mjs';
import {moveOnline,restoreOnline,STEP} from './dist/online-motion.js';

const world=await loadWorld();let now=10;
const rooms=new Rooms(world,{clock:()=>now,random:()=>.5});
const messages=new Map();
const connect=()=>{const log=[];const c=rooms.connect(m=>log.push(structuredClone(m)));messages.set(c,log);return c;};
const a=connect(),b=connect(),c=connect();
const send=(client,m)=>rooms.receive(client,m);
send(a,{type:'create',name:'Host'});const room=a.room;
send(b,{type:'join',name:'Guest',code:room.code});send(c,{type:'join',code:room.code});
assert.equal(c.room,null,'third player cannot join a duel');
send(b,{type:'rules',rules:{rounds:1,seconds:30,weapons:'sniper'}});assert.equal(room.rules.rounds,5,'guest cannot edit rules');
send(a,{type:'rules',rules:{rounds:1,seconds:30,weapons:'sniper'}});assert.equal(room.rules.weapons,'sniper');
send(a,{type:'ready',ready:true,weapon:'sniper'});send(a,{type:'start'});assert.equal(room.phase,'waiting','both must be ready');
send(b,{type:'ready',ready:true,weapon:'sniper'});send(b,{type:'start'});assert.equal(room.phase,'waiting','only host starts');
send(a,{type:'start'});assert.equal(room.phase,'countdown');now+=3.01;rooms.tick();assert.equal(room.phase,'playing');
let [p,q]=room.players;
const input=(extra={})=>({forward:0,side:0,yaw:0,pitch:0,weapon:'sniper',aim:false,jump:false,crouch:false,sprint:false,...extra});
assert.throws(()=>validateInput({seq:1,input:input({yaw:NaN})}));
assert.throws(()=>validateInput({seq:1,input:input({forward:100})}));
const before={...p.motion};
send(a,{type:'input',epoch:room.epoch,seq:1,input:input(),damage:9999,x:999});now+=STEP;rooms.tick();
assert.equal(q.hp,100,'client cannot submit damage');assert.ok(Math.abs(p.motion.x-before.x)<.01,'client cannot teleport');
send(a,{type:'input',epoch:room.epoch-1,seq:2,input:input({forward:1})});assert.equal(p.queue.length,0,'old-round packets discarded');
// Compare authoritative walking, jumping, crouch and air hover to prediction,
// then reconcile from a serialized server state and replay pending input.
const predicted=world.physics.actor(p.motion);let s={...p.motion};restoreOnline(world.physics,predicted,s);
for(let frame=0;frame<100;frame++){
  const i=input({forward:frame<30?1:0,jump:frame===32,aim:frame>=40&&frame<72,crouch:frame>=85});
  send(a,{type:'input',epoch:room.epoch,seq:frame+2,input:i});moveOnline(world.physics,predicted,s,i,p.spawn);now+=STEP;rooms.tick();
  assert.ok(Math.hypot(s.x-p.motion.x,s.y-p.motion.y,s.z-p.motion.z)<.0001,'prediction matches server frame '+frame);
  if(frame===55){s=JSON.parse(JSON.stringify(p.motion));restoreOnline(world.physics,predicted,s);}
}
assert.ok(p.motion.crouched,'crouch replicated');
send(a,{type:'input',epoch:room.epoch,seq:1,input:input({forward:1})});assert.equal(p.queue.length,0,'duplicate input rejected');
send(a,{type:'input',epoch:room.epoch,seq:102,input:input({weapon:'shotgun'})});now+=STEP;rooms.tick();assert.equal(p.motion.weapon,'sniper','weapon rules enforced');

function combatReset(weapon='sniper',distance=10){
  room.phase='playing';room.deadline=now+60;room.rules={rounds:5,seconds:60,weapons:'all'};room.projectiles=[];
  for(const [i,person] of [p,q].entries()){
    Object.assign(person,{lastInputAt:now+5,hp:100,scopeAt:null,hoverUntil:0,history:[],queue:[],nextFire:0,reloadEnd:0,knifeEnd:0,ammo:{shotgun:2,sniper:5}});
    person.motion={x:0,y:0,z:i?distance:0,vx:0,vz:0,vy:0,grounded:true,hover:0,hoverUsed:false,weapon,aim:false,yaw:0,pitch:0};
  }
  rooms.world={...world,index:{pick:()=>null}};
}
combatReset();p.motion.aim=true;p.scopeAt=now-.3;p.motion.pitch=Math.atan2(1.68-1.55,10);
rooms.action(room,p,'fire',now);assert.equal(q.hp,0,'steady quick-scope headshot kills');assert.equal(room.phase,'round');
combatReset();p.motion.aim=true;p.scopeAt=now-1;p.motion.pitch=Math.atan2(1.68-1.55,10);
rooms.action(room,p,'fire',now);assert.equal(q.hp,5,'held scope headshot deals 95');assert.equal(p.ammo.sniper,4);
rooms.action(room,p,'fire',now+.1);assert.equal(p.ammo.sniper,4,'server enforces fire interval');
combatReset();p.motion.aim=true;p.scopeAt=now-.3;p.motion.pitch=Math.atan2(1.68-1,10);q.motion.hover=.4;q.hoverUntil=now+.4;
rooms.action(room,p,'fire',now);assert.equal(q.hp,0,'hovering target takes extra damage');
combatReset('shotgun',3);p.motion.pitch=Math.atan2(1.68-.95,3);rooms.action(room,p,'fire',now);const closeDamage=100-q.hp;
combatReset('shotgun',20);p.motion.pitch=Math.atan2(1.68-.95,20);rooms.action(room,p,'fire',now);assert.ok(100-q.hp<closeDamage*.25,'shotgun loses substantial range damage');
combatReset('sniper');p.ammo.sniper=0;rooms.action(room,p,'reload',now);assert.ok(p.reloadEnd>now);assert.equal(p.ammo.sniper,0);now+=2.11;rooms.tick();assert.equal(p.ammo.sniper,5,'reload completed on server');
combatReset('knife',2);p.motion.pitch=Math.atan2(1.68-1,2);rooms.action(room,p,'fire',now);assert.equal(q.hp,35,'stab damage');
combatReset('knife',8);p.motion.pitch=Math.atan2(1.68-1,8);rooms.action(room,p,'throw',now);assert.equal(room.projectiles.length,1);assert.ok(p.knifeEnd>now);
for(let i=0;i<20;i++){now+=STEP;rooms.tick();}assert.equal(q.hp,0,'server sweeps thrown knife into target');
// Actual imported map geometry: clear sightline and blocked cover.
const origin=new V(-8,-6.1011+1.68,4.8);
for(const [pose,expected] of [[{x:-8,y:-6.028,z:11.2},true],[{x:8,y:-6.04,z:12},false]]){
  const d=new V(pose.x,pose.y+1.55,pose.z).subtract(origin).normalize();assert.equal(castShot(world,origin,d,100,pose).hit,expected,'actual map cover');
}
// Scope and fire through the same input packet path used by browsers.
combatReset();rooms.world=world;
Object.assign(p.motion,{x:-8,y:-6.1011,z:4.8});Object.assign(q.motion,{x:-8,y:-6.028,z:11.2});
for(const person of [p,q]){world.physics.teleport(person.actor,person.motion);person.received=0;person.seq=0;person.history=[];}
for(let frame=1;frame<=24;frame++){
  const dx=q.motion.x-p.motion.x,dz=q.motion.z-p.motion.z,dy=p.motion.y+1.68-(q.motion.y+1.55);
  send(a,{type:'input',epoch:room.epoch,seq:frame,input:input({aim:true,yaw:Math.atan2(dx,dz),pitch:Math.atan2(dy,Math.hypot(dx,dz))}),...(frame===24?{action:'fire'}:{})});now+=STEP;rooms.tick();
}
assert.equal(q.hp,0,'scoped input sequence and release-shot packet register on actual map');assert.equal(p.ammo.sniper,4);
combatReset();rooms.world=world;p.motion.y=8;world.physics.teleport(p.actor,p.motion);p.lastInputAt=now-1;const airborneY=p.motion.y;
now+=STEP;rooms.tick();assert.ok(p.motion.y<airborneY,'stalled client cannot freeze gravity');
rooms.world=world;room.phase='playing';room.rules.rounds=1;p.score=0;q.score=0;p.hp=90;q.hp=20;room.deadline=now;rooms.tick();assert.equal(room.winner,p.id);now+=2.5;rooms.tick();assert.equal(room.phase,'result','first-to target ends match');
send(a,{type:'rematch'});assert.equal(room.phase,'waiting');assert.ok(room.players.every(p=>!p.ready));
rooms.disconnect(a);assert.equal(room.host,b.id,'host transfers on disconnect');assert.equal(room.phase,'waiting');rooms.disconnect(b);assert.equal(rooms.rooms.size,0,'empty lobby removed');rooms.disconnect(c);
world.physics.world.free();
console.log('PASS multiplayer simulation: lobby ownership/rules/ready, prediction and reconciliation, jump/crouch/hover, input validation, authoritative damage/ammo/reload/cooldown, sniper timing, shotgun range, stab/throw, real-map cover, rounds/rematch/disconnect.');

// Exercise the production server with independent real WebSocket clients.
const server=spawn(process.execPath,['server.mjs'],{env:{...process.env,PORT:'0',HOST:'127.0.0.1'},stdio:['ignore','pipe','pipe']});
let output='',errors='';server.stderr.on('data',x=>errors+=x);
let clients=[];
try{
  const port=await new Promise((resolve,reject)=>{const t=setTimeout(()=>reject(Error('Server did not start: '+errors)),30000);server.stdout.on('data',x=>{output+=x;const match=output.match(/127\.0\.0\.1:(\d+)/);if(match){clearTimeout(t);resolve(+match[1]);}});server.once('exit',()=>{clearTimeout(t);reject(Error(errors));});});
  async function socket(){const ws=new WebSocket(`ws://127.0.0.1:${port}/multiplayer`);clients.push(ws);ws.messages=[];ws.on('message',data=>ws.messages.push(JSON.parse(data)));await once(ws,'open');return ws;}
  async function wait(ws,fn){const end=Date.now()+6000;while(Date.now()<end){const i=ws.messages.findIndex(fn);if(i>=0)return ws.messages.splice(i,1)[0];await new Promise(r=>setTimeout(r,10));}throw Error('Timed out waiting for network event: '+JSON.stringify(ws.messages.slice(-3)));}
  const h=await socket(),g=await socket();await wait(h,m=>m.type==='hello');await wait(g,m=>m.type==='hello');
  h.send(JSON.stringify({type:'create',name:'Network host'}));const joined=await wait(h,m=>m.type==='joined');
  g.send(JSON.stringify({type:'join',name:'Network guest',code:joined.code}));await wait(g,m=>m.type==='joined');
  h.send(JSON.stringify({type:'ready',ready:true,weapon:'sniper'}));g.send(JSON.stringify({type:'ready',ready:true,weapon:'shotgun'}));
  await wait(h,m=>m.type==='room'&&m.room.players.length===2&&m.room.players.every(p=>p.ready));h.send(JSON.stringify({type:'start'}));
  const begun=await wait(h,m=>m.type==='room'&&m.room.phase==='playing');await wait(g,m=>m.type==='room'&&m.room.phase==='playing');
  h.send(JSON.stringify({type:'input',epoch:begun.room.epoch,seq:1,input:input({forward:1})}));
  const snap=await wait(g,m=>m.type==='snapshot'&&m.players.some(p=>p.id===joined.id&&p.seq===1));assert.equal(snap.players.length,2);
  h.close();await wait(g,m=>m.type==='opponent-left');
  const transfer=await wait(g,m=>m.type==='room'&&m.room.phase==='waiting'&&m.room.players.length===1);assert.equal(transfer.room.players.length,1);
  const foreign=new WebSocket(`ws://127.0.0.1:${port}/multiplayer`,{origin:'https://unrelated.example'});foreign.on('error',()=>{});const [response]=await once(foreign,'unexpected-response').then(([,res])=>[res]);assert.equal(response.statusCode,403);foreign.terminate();
  console.log('PASS two real WebSocket clients: create/join, ready/start, state replication, disconnect/host transfer and cross-origin rejection.');
}finally{for(const ws of clients)ws.terminate();const stopped=once(server,'exit');server.kill('SIGTERM');await stopped;}
