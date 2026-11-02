import R from './vendor/rapier.es.js';
export async function createPhysics(bytes) {
  await R.init();
  const world=new R.World({x:0,y:-20,z:0});
  const header=new Uint32Array(bytes,0,2);
  const vertices=new Float32Array(bytes,8,header[0]);
  const indices=new Uint32Array(bytes,8+header[0]*4,header[1]);
  const terrain=world.createCollider(R.ColliderDesc.trimesh(vertices,indices,R.TriMeshFlags.FIX_INTERNAL_EDGES | R.TriMeshFlags.DELETE_DEGENERATE_TRIANGLES));
  world.step();
  const actors=[];
  function actor(pos) {
    const collider=world.createCollider(R.ColliderDesc.capsule(.53,.35).setTranslation(pos.x,pos.y+.9,pos.z));
    const controller=world.createCharacterController(.02);
    controller.enableAutostep(.36,.2,false);controller.enableSnapToGround(.4);
    controller.setMaxSlopeClimbAngle(Math.PI/4);controller.setMinSlopeSlideAngle(Math.PI/3);
    const a={...pos,vy:0,grounded:false,crouched:false,jumpBuffer:0,groundGrace:0,collider,controller};actors.push(a);return a;
  }
  function teleport(a,p) {Object.assign(a,p,{vy:0,grounded:false,crouched:false,jumpBuffer:0,groundGrace:0});a.collider.setShape(new R.Capsule(.53,.35));a.controller.enableAutostep(.36,.2,false);a.collider.setTranslation({x:a.x,y:a.y+.9,z:a.z});world.step();}
  function crouch(a,wantsCrouch) {
    if(a.crouched===wantsCrouch)return a.crouched;
    // Test the entire standing capsule before expanding it; keep feet fixed.
    if(!wantsCrouch&&world.intersectionWithShape({x:a.x,y:a.y+.9,z:a.z},{x:0,y:0,z:0,w:1},new R.Capsule(.53,.35),undefined,undefined,undefined,undefined,c=>c.handle===terrain.handle))return true;
    a.crouched=wantsCrouch;a.collider.setShape(new R.Capsule(wantsCrouch?.15:.53,.35));
    a.collider.setTranslation({x:a.x,y:a.y+(wantsCrouch?.52:.9),z:a.z});
    a.controller.enableAutostep(wantsCrouch?.18:.36,.2,false);world.step();return a.crouched;
  }
  function move(a,dx,dz,dt,jump=false,hover=false) {
    // Hover keeps collision checks active but suspends gravity and ground snapping.
    if(hover){a.vy=0;a.jumpBuffer=0;a.groundGrace=0;a.controller.disableSnapToGround();}
    else {
    a.jumpBuffer=jump?.16:Math.max(0,a.jumpBuffer-dt);
    a.groundGrace=a.grounded?.1:Math.max(0,a.groundGrace-dt);
    if(a.jumpBuffer>0&&a.groundGrace>0){a.vy=8;a.jumpBuffer=0;a.groundGrace=0;a.grounded=false;}
    a.vy=Math.max(-30,a.vy-20*dt);
    }
    a.controller.computeColliderMovement(a.collider,{x:dx,y:a.vy*dt,z:dz},undefined,undefined,c=>c.handle===terrain.handle);
    if(hover)a.controller.enableSnapToGround(.4);
    const d=a.controller.computedMovement();a.x+=d.x;a.y+=d.y;a.z+=d.z;
    a.grounded=a.vy<=0&&a.controller.computedGrounded();if(a.grounded||d.y<a.vy*dt-.001&&a.vy>0)a.vy=0;
    a.collider.setTranslation({x:a.x,y:a.y+(a.crouched?.52:.9),z:a.z});
    world.step();return a;
  }
  function ground(x,z,top=30) {
    const h=world.castRayAndGetNormal(new R.Ray({x,y:top,z},{x:0,y:-1,z:0}),50,true,undefined,undefined,undefined,undefined,c=>c.handle===terrain.handle);
    return h?{x,y:top-h.timeOfImpact,z,normal:h.normal}:null;
  }
  function clear(p) {return !world.intersectionWithShape({x:p.x,y:p.y+.94,z:p.z},{x:0,y:0,z:0,w:1},new R.Capsule(.5,.34),undefined,undefined,undefined,undefined,c=>c.handle===terrain.handle);}
  return {world,terrain,actor,move,teleport,crouch,ground,clear,R};
}
export function nearestNode(nodes,p) {let best=0,d=Infinity;for(let i=0;i<nodes.length;i++){const n=nodes[i],v=(n[0]-p.x)**2+(n[1]-p.y)**2*4+(n[2]-p.z)**2;if(v<d){d=v;best=i;}}return best;}
export function findPath(nodes,start,end) {
  const open=new Set([start]),came=new Map(),g=new Map([[start,0]]),f=new Map([[start,0]]);
  const dist=(a,b)=>Math.hypot(nodes[a][0]-nodes[b][0],nodes[a][1]-nodes[b][1],nodes[a][2]-nodes[b][2]);
  while(open.size){let current=-1,score=Infinity;for(const n of open)if(f.get(n)<score){score=f.get(n);current=n;}if(current===end){const path=[end];while(came.has(current)){current=came.get(current);path.unshift(current);}return path;}open.delete(current);for(const n of nodes[current][3]){const t=g.get(current)+dist(current,n);if(t<(g.get(n)??Infinity)){came.set(n,current);g.set(n,t);f.set(n,t+dist(n,end));open.add(n);}}}return [];
}
