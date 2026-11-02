import assert from 'node:assert/strict';
import {createPhysics} from './dist/physics.js';
const vertices=[],indices=[];
function cube(x,y,z,w,h,d){const start=vertices.length/3;for(const [a,b,c] of [[-1,-1,-1],[1,-1,-1],[1,1,-1],[-1,1,-1],[-1,-1,1],[1,-1,1],[1,1,1],[-1,1,1]])vertices.push(x+a*w/2,y+b*h/2,z+c*d/2);for(const i of [0,2,1,0,3,2,4,5,6,4,6,7,0,1,5,0,5,4,3,7,6,3,6,2,0,4,7,0,7,3,1,2,6,1,6,5])indices.push(start+i);}
cube(0,-.5,0,30,1,30);cube(0,1.5,4,6,.5,4);
const buffer=new ArrayBuffer(8+vertices.length*4+indices.length*4);new Uint32Array(buffer,0,2).set([vertices.length,indices.length]);new Float32Array(buffer,8,vertices.length).set(vertices);new Uint32Array(buffer,8+vertices.length*4).set(indices);
const p=await createPhysics(buffer),a=p.actor({x:0,y:0,z:0});const tick=(dx=0,dz=0,jump=false)=>p.move(a,dx,dz,1/60,jump);for(let i=0;i<20;i++)tick();
assert.ok(a.grounded);
for(let i=0;i<60;i++)tick(0,.07);
assert.ok(a.z<1.7,'standing capsule cannot enter the low passage');
const feet=a.y;p.crouch(a,true);assert.ok(Math.abs(a.y-feet)<1e-8,'crouching preserves feet');assert.ok(a.collider.halfHeight()<.2,'collision shape really shrinks');
for(let i=0;i<70;i++)tick(0,.035);
assert.ok(a.z>3.5&&a.z<6,'crouched character crawls into the passage');
assert.equal(p.crouch(a,false),true,'standing blocked under the roof');assert.ok(a.collider.halfHeight()<.2);
tick(0,0,true);for(let i=0;i<40;i++){tick();assert.ok(a.y+1.02<1.28,'jump cannot penetrate low ceiling');}
for(let i=0;i<100;i++)tick(0,.035);
assert.ok(a.z>6.4);assert.equal(p.crouch(a,false),false,'standing resumes in clear space');assert.ok(a.collider.halfHeight()>.5);
p.teleport(a,{x:8,y:.07,z:0});a.vy=-1;tick(0,0,true);let maxY=a.y;for(let i=0;i<65;i++){tick();maxY=Math.max(maxY,a.y);}assert.ok(maxY>1.3,'Space just before landing is buffered into a full jump');
for(let i=0;i<60;i++)tick();tick(0,0,true);for(let i=0;i<15;i++)tick();const prior=a.vy;tick(0,0,true);assert.ok(a.vy<prior,'cannot double jump');
p.teleport(a,{x:14.9,y:0,z:0});for(let i=0;i<10;i++)tick();for(let i=0;i<8;i++)tick(.08,0);assert.equal(a.grounded,false);tick(0,0,true);assert.ok(a.vy>7,'brief grace after leaving a ledge still permits jumping');
console.log('PASS: real capsule crouch/crawl, ceiling-safe standing, feet stability, head collision, buffered jump, ledge grace, and no double jump.');
