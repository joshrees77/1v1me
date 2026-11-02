import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import vm from 'node:vm';
import {pickVisibleCombat,maskIsSolid} from './dist/combat-raycast.js';
import {createCombatIndex} from './dist/combat-index.js';
import {uniqueSurfaceIndices,uniquePanelIndices} from './dist/map-rendering.js';
const vendor={module:{exports:{}},exports:{},console,performance,setTimeout,clearTimeout};vendor.self=vendor;vm.runInNewContext(readFileSync('dist/vendor/babylon.js','utf8'),vendor);const B=vendor.exports;
const engine=new B.NullEngine(),scene=new B.Scene(engine);
const masks=JSON.parse(readFileSync('dist/assets/hit-masks.json'));
for(const m of Object.values(masks))m.bytes=Buffer.from(m.bits,'base64');
const meta=JSON.parse(readFileSync('dist/assets/rust/map.json'));
const raw=gunzipSync(readFileSync('dist/assets/rust/map.bin.gz'));const data=raw.buffer.slice(raw.byteOffset,raw.byteOffset+raw.byteLength);
for(const item of meta){if(!item.solid||item.name==='shadowcaster')continue;const mesh=new B.Mesh(item.name,scene),v=new B.VertexData();v.positions=new Float32Array(data,...item.p);v.uvs=new Float32Array(data,...item.uv);v.indices=uniqueSurfaceIndices(v.positions,new Uint32Array(data,...item.i));if(item.name==='me_metal_rust_03')v.indices=uniquePanelIndices(v.positions,v.indices);v.applyToMesh(mesh);mesh.metadata={world:true,hitMask:/chainlink|grate|grating|foliage|grass|shrub|pine|_dec|decal|holes/.test(item.name)?masks[item.texture]:null};mesh.computeWorldMatrix(true);}
const indexStart=performance.now(),worldIndex=createCombatIndex(B,scene.meshes),indexMs=performance.now()-indexStart;
const target=B.MeshBuilder.CreateBox('test-target',{size:.15},scene);target.metadata={bot:true,head:true};
let holes=0,solids=0;const start=performance.now();
// Exercise actual UVs and cutouts in the imported fence/grating geometry.
for(const mesh of scene.meshes.filter(m=>m.metadata?.hitMask)){
 const p=mesh.getVerticesData('position'),uv=mesh.getVerticesData('uv'),idx=mesh.getIndices();
 for(let i=0;i<idx.length&&holes<12;i+=3){
  const ids=idx.slice(i,i+3),a=B.Vector3.FromArray(p,ids[0]*3),b=B.Vector3.FromArray(p,ids[1]*3),c=B.Vector3.FromArray(p,ids[2]*3),normal=B.Vector3.Cross(b.subtract(a),c.subtract(a)).normalize();if(normal.length()<.9)continue;
  for(const weights of [[.2,.3,.5],[.5,.2,.3],[.3,.5,.2]]){
   const point=a.scale(weights[0]).add(b.scale(weights[1])).add(c.scale(weights[2]));const coords={x:ids.reduce((s,id,j)=>s+uv[id*2]*weights[j],0),y:ids.reduce((s,id,j)=>s+uv[id*2+1]*weights[j],0)};
   target.position.copyFrom(point.add(normal.scale(.25)));target.computeWorldMatrix(true);
   const ray=new B.Ray(point.subtract(normal.scale(.25)),normal,.6),rawHit=scene.pickWithRay(ray,m=>!!m.metadata?.world);
   if(!rawHit?.hit||rawHit.pickedMesh!==mesh||Math.abs(rawHit.distance-.25)>.005)continue;
   const hit=pickVisibleCombat(B,scene,ray,worldIndex);
   if(maskIsSolid(mesh.metadata.hitMask,coords)){assert.ok(!hit.pickedMesh.metadata.bot,'opaque fence pixels retain cover');solids++;}
   else if(hit?.pickedMesh===target){holes++;}
  }
 }
}
assert.ok(holes>=6,'real map cutout holes allow a shot where the old solid-triangle test blocked it');assert.ok(solids>0,'solid pixels still block');
// A clear spawn lane and a known wall-obstructed lane on the actual map.
const origin=new B.Vector3(-8,-6.1011+1.68,4.8);
for(const [position,expected] of [[[-8,-6.028+1.55,11.2],true],[[8,-6.04+1.55,12],false]]){
 target.position.set(...position);target.computeWorldMatrix(true);const ray=new B.Ray(origin,target.position.subtract(origin).normalize(),100);const hit=pickVisibleCombat(B,scene,ray,worldIndex);assert.equal(!!hit?.pickedMesh?.metadata?.bot,expected,'actual map clear/covered lane');
}
// Compare the accelerated result with the original picker across map viewpoints,
// long/short rays, upward/downward shots and both sides of geometry.
let seed=23;const random=()=>((seed=Math.imul(seed,1664525)+1013904223>>>0)/4294967296);
const legacyTimes=[],fastTimes=[];
for(let i=0;i<240;i++){
 const from=i<120?origin:new B.Vector3(random()*60-30,random()*18-6,random()*60-10);
 const direction=new B.Vector3(random()*2-1,random()*.9-.35,random()*2-1).normalize();
 const ray=new B.Ray(from,direction,i%3===0?2.7:i%3===1?40:100);
 target.position.set(from.x+direction.x*15,from.y+direction.y*15,from.z+direction.z*15);target.computeWorldMatrix(true);
 let t=performance.now();const expected=pickVisibleCombat(B,scene,ray);legacyTimes.push(performance.now()-t);
 t=performance.now();const actual=pickVisibleCombat(B,scene,ray,worldIndex);fastTimes.push(performance.now()-t);
 assert.equal(!!actual?.hit,!!expected?.hit,'BVH preserves hit/miss');
 if(actual?.hit){assert.ok(Math.abs(actual.distance-expected.distance)<.003,`ray ${i}: nearest visible surface (${actual.distance} vs ${expected.distance})`);assert.equal(!!actual.pickedMesh.metadata.bot,!!expected.pickedMesh.metadata.bot,'cover/enemy priority preserved');}
}
const sum=a=>a.reduce((x,y)=>x+y,0);
assert.ok(sum(fastTimes)<sum(legacyTimes)/3,'accelerated map lookup is at least 3x faster across the ray sample');
console.log(`PASS BVH: ${worldIndex.triangleCount} triangles, build ${Math.round(indexMs)}ms, 240 rays ${sum(legacyTimes).toFixed(1)}ms → ${sum(fastTimes).toFixed(1)}ms.`);
// Material changes must keep consulting the current alpha-test state, and the
// index must account for transformed meshes rather than assuming local positions.
const checkScene=new B.Scene(engine),panel=B.MeshBuilder.CreatePlane('masked-panel',{size:4,sideOrientation:B.Mesh.DOUBLESIDE},checkScene);
panel.position.set(3,2,5);panel.scaling.set(2,1,1);panel.rotation.y=.2;panel.metadata={world:true,hitMask:{width:1,height:1,bytes:new Uint8Array([0])}};
const behind=B.MeshBuilder.CreateBox('behind-panel',{size:.4},checkScene);behind.position.set(3,2,8);behind.metadata={bot:true};behind.computeWorldMatrix(true);
const checkIndex=createCombatIndex(B,[panel]),checkRay=new B.Ray(new B.Vector3(3,2,0),new B.Vector3(0,0,1),10);
assert.equal(pickVisibleCombat(B,checkScene,checkRay,checkIndex).pickedMesh,behind,'transparent transformed panel allows enemy hit');
panel.material=new B.StandardMaterial('opaque',checkScene);
const opaque=pickVisibleCombat(B,checkScene,checkRay,checkIndex),reference=pickVisibleCombat(B,checkScene,checkRay);
assert.equal(opaque.pickedMesh,panel,'opaque material change blocks the old transparent pixels');assert.ok(Math.abs(opaque.distance-reference.distance)<1e-6,'transformed surface distance matches Babylon');
panel.setEnabled(false);assert.equal(pickVisibleCombat(B,checkScene,checkRay,checkIndex).pickedMesh,behind,'disabled cover is ignored');
checkScene.dispose();
console.log(`PASS actual map combat: ${holes} cutout shots, ${solids} opaque hits, clear lane and solid cover (${Math.round(performance.now()-start)}ms).`);engine.dispose();
