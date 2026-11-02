// Static rendered-map triangle BVH, built once during loading rather than per shot.
// Physics colliders are deliberately not used: their solid faces omit fence holes.
import {maskIsSolid} from './combat-raycast.js';
export function createCombatIndex(B, meshes) {
  const sources=meshes.filter(m=>m.metadata?.world);
  const count=sources.reduce((n,m)=>n+m.getIndices().length/3,0);
  const triangles=new Float64Array(count*9),texcoords=new Float32Array(count*6);
  const bounds=new Float64Array(count*6),owner=new Uint16Array(count),faces=new Uint32Array(count),order=new Uint32Array(count);
  let id=0;
  sources.forEach((mesh,mi)=>{
    const p=mesh.getVerticesData('position'),uv=mesh.getVerticesData('uv'),idx=mesh.getIndices(),matrix=mesh.computeWorldMatrix(true);
    for(let i=0;i<idx.length;i+=3,id++){
      owner[id]=mi;faces[id]=i/3;order[id]=id;
      const points=[0,1,2].map(j=>B.Vector3.TransformCoordinates(B.Vector3.FromArray(p,idx[i+j]*3),matrix));
      const a=points[0],e1=points[1].subtract(a),e2=points[2].subtract(a);
      triangles.set([a.x,a.y,a.z,e1.x,e1.y,e1.z,e2.x,e2.y,e2.z],id*9);
      for(let j=0;j<3;j++){texcoords[id*6+j*2]=uv?.[idx[i+j]*2]??0;texcoords[id*6+j*2+1]=uv?.[idx[i+j]*2+1]??0;}
      bounds.set([Math.min(...points.map(p=>p.x)),Math.min(...points.map(p=>p.y)),Math.min(...points.map(p=>p.z)),Math.max(...points.map(p=>p.x)),Math.max(...points.map(p=>p.y)),Math.max(...points.map(p=>p.z))],id*6);
    }
  });
  function build(start,end){
    const box=[Infinity,Infinity,Infinity,-Infinity,-Infinity,-Infinity];
    for(let i=start;i<end;i++){const k=order[i]*6;for(let a=0;a<3;a++){box[a]=Math.min(box[a],bounds[k+a]);box[a+3]=Math.max(box[a+3],bounds[k+a+3]);}}
    const node={box,start,end};if(end-start<=12)return node;
    let axis=0;for(let a=1;a<3;a++)if(box[a+3]-box[a]>box[axis+3]-box[axis])axis=a;
    order.subarray(start,end).sort((a,b)=>(bounds[a*6+axis]+bounds[a*6+axis+3])-(bounds[b*6+axis]+bounds[b*6+axis+3]));
    const mid=(start+end)>>>1;node.left=build(start,mid);node.right=build(mid,end);return node;
  }
  const root=count?build(0,count):null;
  return {triangleCount:count,pick(ray,limit=ray.length){
    if(!root)return null;
    const o=[ray.origin.x,ray.origin.y,ray.origin.z],d=[ray.direction.x,ray.direction.y,ray.direction.z];
    let nearest=limit,best=-1,bestU=0,bestV=0;
    // Slab intersection handles parallel axes without Infinity * 0 / NaN.
    function entry(box){let near=0,far=nearest;for(let a=0;a<3;a++){if(Math.abs(d[a])<1e-14){if(o[a]<box[a]-1e-8||o[a]>box[a+3]+1e-8)return Infinity;}else{let lo=(box[a]-o[a])/d[a],hi=(box[a+3]-o[a])/d[a];if(lo>hi)[lo,hi]=[hi,lo];near=Math.max(near,lo);far=Math.min(far,hi);if(near>far+1e-8)return Infinity;}}return near;}
    function visit(node){
      if(entry(node.box)>nearest)return;
      if(node.left){const l=entry(node.left.box),r=entry(node.right.box);if(l<r){if(l<=nearest)visit(node.left);if(r<=nearest)visit(node.right);}else{if(r<=nearest)visit(node.right);if(l<=nearest)visit(node.left);}return;}
      for(let n=node.start;n<node.end;n++){
        const id=order[n],mesh=sources[owner[id]];
        if(!mesh.isEnabled()||!mesh.isVisible||!mesh.metadata?.world)continue;
        const k=id*9,ax=triangles[k],ay=triangles[k+1],az=triangles[k+2],ex=triangles[k+3],ey=triangles[k+4],ez=triangles[k+5],fx=triangles[k+6],fy=triangles[k+7],fz=triangles[k+8];
        const px=d[1]*fz-d[2]*fy,py=d[2]*fx-d[0]*fz,pz=d[0]*fy-d[1]*fx,det=ex*px+ey*py+ez*pz;
        if(Math.abs(det)<1e-12)continue;
        const tx=o[0]-ax,ty=o[1]-ay,tz=o[2]-az,u=(tx*px+ty*py+tz*pz)/det;if(u<0||u>1)continue;
        const qx=ty*ez-tz*ey,qy=tz*ex-tx*ez,qz=tx*ey-ty*ex,v=(d[0]*qx+d[1]*qy+d[2]*qz)/det;if(v<0||u+v>1)continue;
        const distance=(fx*qx+fy*qy+fz*qz)/det;if(distance<0||distance>nearest)continue;
        const t=id*6,uv={x:texcoords[t]*(1-u-v)+texcoords[t+2]*u+texcoords[t+4]*v,y:texcoords[t+1]*(1-u-v)+texcoords[t+3]*u+texcoords[t+5]*v};
        const mask=!mesh.material||mesh.material.needAlphaTesting()?mesh.metadata.hitMask:null;
        if(!maskIsSolid(mask,uv))continue;
        nearest=distance;best=id;bestU=uv.x;bestV=uv.y;
      }
    }
    visit(root);if(best<0)return null;
    return {hit:true,distance:nearest,pickedMesh:sources[owner[best]],pickedPoint:ray.origin.add(ray.direction.scale(nearest)),faceId:faces[best],getTextureCoordinates:()=>new B.Vector2(bestU,bestV)};
  }};
}
