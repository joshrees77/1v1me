import {readFile} from 'node:fs/promises';
import {gunzipSync} from 'node:zlib';
import {createPhysics,nearestNode} from '../dist/physics.js';
import {createCombatIndex} from '../dist/combat-index.js';
import {uniqueSurfaceIndices,uniquePanelIndices} from '../dist/map-rendering.js';
export class V {
  constructor(x=0,y=0,z=0){Object.assign(this,{x,y,z});}
  static FromArray(a,i){return new V(a[i],a[i+1],a[i+2]);}
  static TransformCoordinates(v){return v;}
  add(v){return new V(this.x+v.x,this.y+v.y,this.z+v.z);}
  subtract(v){return new V(this.x-v.x,this.y-v.y,this.z-v.z);}
  scale(n){return new V(this.x*n,this.y*n,this.z*n);}
  length(){return Math.hypot(this.x,this.y,this.z);}
  normalize(){return this.scale(1/(this.length()||1));}
}
export async function loadWorld(){
  const read=p=>readFile(new URL('../dist/assets/'+p,import.meta.url));
  const [metaBytes,map,collision,navBytes,maskBytes]=await Promise.all(['rust/map.json','rust/map.bin.gz','rust/collision.bin','rust/nav.json','hit-masks.json'].map(read));
  const meta=JSON.parse(metaBytes),raw=gunzipSync(map),data=raw.buffer.slice(raw.byteOffset,raw.byteOffset+raw.byteLength),masks=JSON.parse(maskBytes),nav=JSON.parse(navBytes);
  for(const m of Object.values(masks))m.bytes=Buffer.from(m.bits,'base64');
  const meshes=meta.filter(m=>m.solid&&m.name!=='shadowcaster').map(item=>{
    const position=new Float32Array(data,...item.p),uv=new Float32Array(data,...item.uv);
    let indices=uniqueSurfaceIndices(position,new Uint32Array(data,...item.i));
    if(item.name==='me_metal_rust_03')indices=uniquePanelIndices(position,indices);
    return {getIndices:()=>indices,getVerticesData:k=>k==='position'?position:uv,computeWorldMatrix(){},isEnabled:()=>true,isVisible:true,
      metadata:{world:true,hitMask:/chainlink|grate|grating|foliage|grass|shrub|pine|_dec|decal|holes/.test(item.name)?masks[item.texture]:null}};
  });
  const index=createCombatIndex({Vector3:V,Vector2:class{constructor(x,y){Object.assign(this,{x,y});}}},meshes);
  const physics=await createPhysics(collision.buffer.slice(collision.byteOffset,collision.byteOffset+collision.byteLength));
  const spawn=p=>{const n=nav[nearestNode(nav,p)];return {x:n[0],y:n[1],z:n[2]};};
  return {physics,index,spawns:[spawn({x:-8,y:-6,z:5}),spawn({x:16,y:-6,z:32})]};
}
export function direction(yaw,pitch){return new V(Math.sin(yaw)*Math.cos(pitch),-Math.sin(pitch),Math.cos(yaw)*Math.cos(pitch));}
export function spreadDirection(yaw,pitch,spread,angle,radius){
  const f=direction(yaw,pitch),r=new V(Math.cos(yaw),0,-Math.sin(yaw)),u=new V(Math.sin(yaw)*Math.sin(pitch),Math.cos(pitch),Math.cos(yaw)*Math.sin(pitch));
  return f.add(r.scale(Math.cos(angle)*radius*spread)).add(u.scale(Math.sin(angle)*radius*spread)).normalize();
}
function boxRay(o,d,min,max){let near=0,far=Infinity;for(const k of ['x','y','z']){if(Math.abs(d[k])<1e-9){if(o[k]<min[k]||o[k]>max[k])return Infinity;}else{let a=(min[k]-o[k])/d[k],b=(max[k]-o[k])/d[k];if(a>b)[a,b]=[b,a];near=Math.max(near,a);far=Math.min(far,b);if(near>far)return Infinity;}}return near;}
export function playerHit(origin,dir,target){
  const h=target.crouched?.58:1;
  const head=boxRay(origin,dir,{x:target.x-.19,y:target.y+1.36*h,z:target.z-.19},{x:target.x+.19,y:target.y+1.76*h,z:target.z+.19});
  const body=boxRay(origin,dir,{x:target.x-.32,y:target.y+.03,z:target.z-.27},{x:target.x+.32,y:target.y+1.36*h,z:target.z+.27});
  return head<body?{distance:head,head:true}:{distance:body,head:false};
}
export function castShot(world,origin,dir,range,target){
  const enemy=target?playerHit(origin,dir,target):{distance:Infinity};
  const cover=world.index.pick({origin,direction:dir,length:range},Math.min(range,enemy.distance));
  if(cover)return {end:cover.pickedPoint,distance:cover.distance,hit:false};
  if(enemy.distance<=range)return {...enemy,end:origin.add(dir.scale(enemy.distance)),hit:true};
  return {end:origin.add(dir.scale(range)),distance:range,hit:false};
}
