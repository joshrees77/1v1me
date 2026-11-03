import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const vendor={module:{exports:{}},exports:{},console,performance,setTimeout,clearTimeout};vendor.self=vendor;
vm.runInNewContext(readFileSync('dist/vendor/babylon.js','utf8'),vendor);
const B=vendor.exports,engine=new B.NullEngine(),scene=new B.Scene(engine);
const context=vm.createContext({B,scene,materials:{},WEAPONS:{shotgun:{},sniper:{},knife:{}},gunModels:{},spawnBot:{x:0,y:0,z:0},camera:new B.FreeCamera('test-camera',B.Vector3.Zero(),scene)});
scene.metadata={shadow:{addShadowCaster(){}}};
const source=readFileSync('dist/game.js','utf8');
vm.runInContext('let botRoot,bot,gunRoot,shotgunBreech,muzzleFlash;const weaponRigs={};'+source.slice(source.indexOf('function mat('),source.indexOf('function box('))+source.slice(source.indexOf('function modelProfile('),source.indexOf('function moveBody(')),context);
const run=s=>vm.runInContext(s,context);
run("mat('black','#111111');mat('white','#ffffff');mat('glow','#ee7755');buildBot();botRoot.position.set(0,0,0);buildGuns();");
// Real geometry must be closed and face outwards, not disappear from one side.
const bevel=run("modelBevel('closed-test',[1,1,1])"),p=bevel.getVerticesData('position'),normals=bevel.getVerticesData('normal');
for(let i=0;i<p.length;i+=3)assert.ok(p[i]*normals[i]+p[i+1]*normals[i+1]+p[i+2]*normals[i+2]>0,'beveled surfaces have outward normals');
for(const m of scene.meshes){assert.ok(m.getVerticesData('position').every(Number.isFinite),'model coordinates are finite');m.computeWorldMatrix(true);}
const root=run('botRoot');
// Verify actual revised head and torso silhouettes from front, side and rear.
for(const angle of [0,Math.PI/2,Math.PI]){
 const direction=new B.Vector3(-Math.sin(angle),0,-Math.cos(angle));
 for(const [height,head] of [[1.8*.86,true],[1.23*.86,false]]){
  const origin=new B.Vector3(Math.sin(angle)*3,height,Math.cos(angle)*3);
  const hit=scene.pickWithRay(new B.Ray(origin,direction,5),m=>m.metadata?.bot);
  assert.ok(hit?.hit,'revised character registers combat rays');assert.equal(hit.pickedMesh.metadata.head,head,'head/body classification remains correct');
 }
}
for(const name of ['shotgun','sniper','knife'])for(const m of run(`gunModels.${name}.getChildMeshes()`)){assert.equal(m.isPickable,false,'viewmodels never intercept aim rays');assert.equal(m.renderingGroupId,2,'weapon pieces use the viewmodel depth pass');}
const hinge=run('shotgunBreech');assert.ok(hinge.getChildMeshes().some(m=>m.name==='shotgun-barrel'));
assert.ok(!hinge.getChildMeshes().some(m=>m.name==='shotgun-stock'),'break action rotates the barrels, not the stock');
console.log(`PASS: refined model geometry, outward bevels, head/body hits from three angles, viewmodel ray exclusion and shotgun hinge (${root.getChildMeshes().length} operator parts).`);
engine.dispose();
