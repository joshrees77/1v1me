import {readFileSync,writeFileSync} from 'node:fs';
import {createPhysics} from '../dist/physics.js';
const bytes=readFileSync(new URL('../dist/assets/rust/collision.bin',import.meta.url));
const p=await createPhysics(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));
const nodes=[],grid=new Map(),step=.8;
for(let ix=-55;ix<=55;ix++)for(let iz=-55;iz<=55;iz++){
 let top=24;
 for(let level=0;level<7;level++){
  const h=p.ground(ix*step,iz*step,top);if(!h||h.y< -8)break;top=h.y-.2;
  if(h.normal.y<.65||!p.clear(h))continue;
  const key=ix+','+iz,list=grid.get(key)||[];list.push(nodes.length);grid.set(key,list);nodes.push([h.x,h.y+.025,h.z,[],ix,iz]);
 }
}
console.log('sampled',nodes.length);
const a=p.actor({x:0,y:40,z:0});let checks=0;
for(let i=0;i<nodes.length;i++){
 const n=nodes[i];
 for(const [dx,dz] of [[1,0],[-1,0],[0,1],[0,-1]])for(const j of grid.get((n[4]+dx)+','+(n[5]+dz))||[]){
  const t=nodes[j];if(Math.abs(t[1]-n[1])>.8)continue;
  p.teleport(a,{x:n[0],y:n[1],z:n[2]});
  for(let k=0;k<5;k++)p.move(a,0,0,1/60);
  for(let k=0;k<16;k++)p.move(a,dx*step/16,dz*step/16,1/60);
  if(Math.hypot(a.x-t[0],a.z-t[2])<.12&&Math.abs(a.y-t[1])<.18)n[3].push(j);checks++;
 }
}
// Keep the largest connected walkable component; isolated prop roofs aren't spawn points.
const seen=new Set(),components=[];
for(let i=0;i<nodes.length;i++)if(!seen.has(i)){const q=[i];seen.add(i);for(let k=0;k<q.length;k++)for(const j of nodes[q[k]][3])if(!seen.has(j)){seen.add(j);q.push(j);}components.push(q);}
components.sort((a,b)=>b.length-a.length);const distance=c=>Math.min(...c.map(i=>(nodes[i][0]-5)**2+(nodes[i][2]-15)**2+(nodes[i][1]+6)**2));const playable=components.filter(c=>c.length>100).sort((a,b)=>distance(a)-distance(b));const ids=playable[0],remap=new Map(ids.map((v,i)=>[v,i]));
const result=ids.map(i=>{const n=nodes[i];return [n[0],n[1],n[2],n[3].filter(j=>remap.has(j)).map(j=>remap.get(j))];});
writeFileSync(new URL('../dist/assets/rust/nav.json',import.meta.url),JSON.stringify(result));
console.log('NAV',result.length,'nodes',checks,'physical edge tests; components',components.slice(0,12).map(c=>c.length),'bounds', [0,1,2].map(i=>[Math.min(...result.map(n=>n[i])),Math.max(...result.map(n=>n[i]))]));
