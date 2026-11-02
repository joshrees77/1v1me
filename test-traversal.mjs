import {readFileSync,writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {createPhysics,nearestNode,findPath} from './dist/physics.js';
const b=readFileSync('dist/assets/rust/collision.bin');
const physics=await createPhysics(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength));
const nav=JSON.parse(readFileSync('dist/assets/rust/nav.json'));
const pos=i=>({x:nav[i][0],y:nav[i][1],z:nav[i][2]});
const start=nearestNode(nav,{x:-8,y:-6,z:5}),end=nearestNode(nav,{x:16,y:-6,z:32});
assert.ok(nav.length>500,'connected playable area exists');
const a=physics.actor(pos(start));
for(let i=0;i<120;i++)physics.move(a,0,0,1/60);
assert.ok(a.grounded,'player rests on actual map ground');
const base=a.y;physics.move(a,0,0,1/60,true);let highest=a.y;
for(let i=0;i<120;i++){physics.move(a,0,0,1/60);highest=Math.max(highest,a.y);}
assert.ok(highest>base+.8,'jump leaves the map floor');assert.ok(Math.abs(a.y-base)<.1,'jump lands back on map');
let traveled=0,maxError=0;
function walk(route,label){
 assert.ok(route.length>1,label+' has a connected path');physics.teleport(a,pos(route[0]));
 for(const id of route.slice(1)){
  const n=nav[id];let done=false;
  for(let tick=0;tick<120;tick++){
   const dx=n[0]-a.x,dz=n[2]-a.z,len=Math.hypot(dx,dz);
   if(len<.08&&Math.abs(a.y-n[1])<.25){done=true;break;}
   const move=Math.min(2.8/60,len);physics.move(a,dx/(len||1)*move,dz/(len||1)*move,1/60);traveled+=move;
  }
  const error=Math.hypot(a.x-n[0],a.z-n[2]);maxError=Math.max(maxError,error);
  assert.ok(done,`${label}: stuck approaching node ${id}, error ${error.toFixed(3)}, height ${a.y.toFixed(2)} expected ${n[1].toFixed(2)}`);
 }
}
walk(findPath(nav,start,end),'spawn to opponent');
const high=nav.reduce((best,n,i)=>n[1]>nav[best][1]?i:best,0);
walk(findPath(nav,end,high),'opponent to highest walkable platform');
walk(findPath(nav,high,start),'platform descent to spawn');
for(let i=0;i<12;i++){
 const target=(i*317+113)%nav.length;
 const path=findPath(nav,start,target);if(path.length>1)walk(path,`patrol ${i+1}`);
}
// Sprint into a real vertical map surface, not a synthetic arena box.
let wallTest=false;
for(let i=0;i<nav.length&&!wallTest;i+=7){
 const n=pos(i);
 for(const d of [{x:1,y:0,z:0},{x:-1,y:0,z:0},{x:0,y:0,z:1},{x:0,y:0,z:-1}]){
  const h=physics.world.castRayAndGetNormal(new physics.R.Ray({x:n.x,y:n.y+1,z:n.z},d),2,true,undefined,undefined,undefined,undefined,c=>c.handle===physics.terrain.handle);
  if(!h||Math.abs(h.normal.y)>.1||h.timeOfImpact<.6)continue;
  physics.teleport(a,n);for(let k=0;k<30;k++)physics.move(a,d.x*9.2/60,d.z*9.2/60,1/60);
  const progress=(a.x-n.x)*d.x+(a.z-n.z)*d.z;
  if(Math.abs(a.y-n.y)<.3&&progress<h.timeOfImpact){wallTest=true;break;}
 }
}
assert.ok(wallTest,'actual map wall blocks sprinting');
const report={nodes:nav.length,walkedMetres:Math.round(traveled),highestPlatformY:nav[high][1],heightGain:nav[high][1]-nav[start][1],maxWaypointError:maxError,spawn:pos(start),opponentSpawn:pos(end),checks:['grounding','jump and landing','sprint vs map wall','spawn-to-opponent','platform ascent and descent','12 patrol routes']};
writeFileSync('traversal-report.json',JSON.stringify(report,null,2)+'\n');console.log('PASS actual Rust traversal',report);
