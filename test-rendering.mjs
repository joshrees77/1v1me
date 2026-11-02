import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {uniqueSurfaceIndices,uniquePanelIndices,surfaceDepth} from './dist/map-rendering.js';
const meta=JSON.parse(readFileSync('dist/assets/rust/map.json'));
const packed=gunzipSync(readFileSync('dist/assets/rust/map.bin.gz'));
const bytes=packed.buffer.slice(packed.byteOffset,packed.byteOffset+packed.byteLength);
let removed=0;const biases=new Set();
for(const [i,item] of meta.entries()){
  const positions=new Float32Array(bytes,...item.p),indices=new Uint32Array(bytes,...item.i);
  const clean=uniqueSurfaceIndices(positions,indices);
  assert.ok(clean.length>0&&clean.length<=indices.length);
  assert.deepEqual(uniqueSurfaceIndices(positions,clean),clean,'no duplicate surfaces remain');
  removed+=(indices.length-clean.length)/3;
  const depth=surfaceDepth(item.name,i);biases.add(depth.zOffset+':'+depth.zOffsetUnits);
}
assert.equal(biases.size,meta.length,'overlapping material batches have distinct depth precedence');
assert.ok(surfaceDepth('me_metal_rust_03_dec',33).zOffset<surfaceDepth('me_metal_rust_03',32).zOffset,'decal draws ahead of structural steel');
assert.equal(surfaceDepth('dirt_sand_01_dec',46).disableDepthWrite,true,'overlapping ground decals cannot compete in the depth buffer');
assert.equal(surfaceDepth('dirt_sand_01',22).disableDepthWrite,false,'solid terrain still occludes decals and players');
assert.ok(removed>0,'actual import contains duplicate faces and cleanup removes them');
console.log(`PASS: ${removed} duplicate render triangles removed; stable depth precedence for ${meta.length} materials. Collision source is untouched.`);

// Same panel, reversed winding and opposite diagonal: exact triangle keys miss it.
const quad=new Float32Array([0,0,0, 2,0,0, 2,2,0, 0,2,0]);
const doubled=new Uint32Array([0,1,2, 0,2,3, 3,1,0, 3,2,1]);
assert.equal(uniquePanelIndices(quad,doubled).length,6,'alternate-diagonal copies collapse to one panel');
const bent=quad.slice();bent[11]=.1;
assert.equal(uniquePanelIndices(bent,doubled).length,12,'nonplanar geometry is not treated as a duplicate panel');
const metal=meta.find(e=>e.name==='me_metal_rust_03');
const p=new Float32Array(bytes,...metal.p),before=uniqueSurfaceIndices(p,new Uint32Array(bytes,...metal.i)),after=uniquePanelIndices(p,before);
assert.deepEqual(uniquePanelIndices(p,after),after,'panel cleanup is idempotent');
const kept=new Set();for(let i=0;i<after.length;i+=3)kept.add(Array.from(after.slice(i,i+3)).join(','));
const point=i=>Array.from(p.slice(i*3,i*3+3)),sub=(a,b)=>a.map((v,i)=>v-b[i]),dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0);
const remaining=[];
for(let i=0;i<after.length;i+=3){const a=point(after[i]),u=sub(point(after[i+1]),a),v=sub(point(after[i+2]),a),uu=dot(u,u),uv=dot(u,v),vv=dot(v,v);remaining.push({a,u,v,uu,uv,vv,den:uu*vv-uv*uv});}
function covered(q){return remaining.some(({a,u,v,uu,uv,vv,den})=>{if(den<1e-15)return false;const w=sub(q,a),wu=dot(w,u),wv=dot(w,v),s=(vv*wu-uv*wv)/den,t=(uu*wv-uv*wu)/den;if(s<-.00001||t<-.00001||s+t>1.00001)return false;return Math.hypot(...w.map((n,i)=>n-s*u[i]-t*v[i]))<.00002;});}
let tested=0;
for(let i=0;i<before.length;i+=3){const ids=Array.from(before.slice(i,i+3));if(kept.has(ids.join(',')))continue;const points=ids.map(point);for(const weights of [[.6,.2,.2],[.2,.6,.2],[.2,.2,.6]]){const q=[0,1,2].map(a=>points.reduce((s,p,j)=>s+p[a]*weights[j],0));assert.ok(covered(q),'removed metal faces remain covered by retained coplanar panels');tested++;}}
assert.ok(tested>0,'actual imported housing has retriangulated duplicate panels');
console.log(`PASS: ${(before.length-after.length)/3} alternate-diagonal metal triangles removed; ${tested} surface-coverage samples retained.`);
