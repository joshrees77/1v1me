import {readFileSync}from'node:fs';import vm from'node:vm';import assert from'node:assert/strict';
import {createPhysics}from'./dist/physics.js';
import {pickVisibleCombat}from'./dist/combat-raycast.js';
import {fileURLToPath}from'node:url';
const root=fileURLToPath(new URL('./',import.meta.url));
const vendor={module:{exports:{}},exports:{},console,setTimeout,clearTimeout,performance};vendor.self=vendor;vm.runInNewContext(readFileSync(root+'dist/vendor/babylon.js','utf8'),vendor);
const elements=new Map(),listeners=new Map(),windowListeners=new Map();const make=()=>({style:{},classList:{toggle(){}},value:'',hidden:false,replaceChildren(){},append(){},setAttribute(){},addEventListener(type,fn){this.events??={};this.events[type]=fn;}});
const document={getElementById(id){if(!elements.has(id))elements.set(id,make());return elements.get(id)},createElement:make,querySelectorAll:()=>[],addEventListener(type,fn){listeners.set(type,fn)},exitPointerLock(){}};
const context=vm.createContext({window:{BABYLON:vendor.exports,addEventListener(type,fn){windowListeners.set(type,fn)}},document,localStorage:{getItem:()=>null},console,Math:Object.assign(Object.create(Math),{random:()=>.5}),performance,setTimeout,clearTimeout,pickVisibleCombat});
const s=readFileSync(root+'dist/game.js','utf8').replace(/^import .*;\n/gm,'');vm.runInContext(s.slice(0,s.lastIndexOf('\ntry {\n  if(!B')),context);const run=s=>vm.runInContext(s,context);
run(`settings.sound=false;engine=new B.NullEngine();scene=new B.Scene(engine);camera=new B.FreeCamera('input-test',new B.Vector3(0,1.68,0),scene);scene.activeCamera=camera;camera.fov=.32;mat('red','#df3e36');mat('ivory','#dedfd5');botRoot=new B.TransformNode('target-root',scene);const target=B.MeshBuilder.CreateBox('head',{width:.4,height:.4,depth:.4},scene);target.parent=botRoot;target.position.set(0,1.68,20);target.metadata={bot:true,head:true};bot={x:0,y:0,z:20,hp:100};mode='playing';weapon='sniper';pointerFallback=true;player={x:0,y:0,z:0,vx:0,vz:0,vy:0,hp:100};yaw=0;pitch=0;bindUI();`);
const vertices=[],indices=[];
function cube(x,y,z,w,h,d){const start=vertices.length/3;for(const [a,b,c] of [[-1,-1,-1],[1,-1,-1],[1,1,-1],[-1,1,-1],[-1,-1,1],[1,-1,1],[1,1,1],[-1,1,1]])vertices.push(x+a*w/2,y+b*h/2,z+c*d/2);for(const i of [0,2,1,0,3,2,4,5,6,4,6,7,0,1,5,0,5,4,3,7,6,3,6,2,0,4,7,0,7,3,1,2,6,1,6,5])indices.push(start+i);}
cube(0,-.5,0,30,1,30);cube(0,1.5,4,6,.5,4);
const buffer=new ArrayBuffer(8+vertices.length*4+indices.length*4);new Uint32Array(buffer,0,2).set([vertices.length,indices.length]);new Float32Array(buffer,8,vertices.length).set(vertices);new Uint32Array(buffer,8+vertices.length*4).set(indices);

context.testPhysics=await createPhysics(buffer);
run(`physics=testPhysics;playerActor=physics.actor({x:8,y:0,z:0});spawnPlayer={x:8,y:0,z:0};`);
const reset=()=>run(`keys.clear();setAiming(false);resetSniperHover();mode='playing';exploring=false;weapon='sniper';roundDelay=0;cooldown=0;reloadTime=0;recoil=0;ammo.sniper=5;player.hp=100;bot.hp=100;botRoot.setEnabled(true);physics.teleport(playerActor,spawnPlayer);Object.assign(player,spawnPlayer,{vx:0,vz:0,vy:0});for(let i=0;i<10;i++)playerStep(1/60);`);
const jump=()=>run(`keys.add('Space');playerStep(1/60);for(let i=0;i<9;i++)playerStep(1/60);`);
const scope=()=>elements.get('arena').events.mousedown({button:2,clientX:640,clientY:360});
const release=()=>listeners.get('mouseup')({button:2,buttons:0});
for(const fps of [30,60,144]){
 reset();jump();scope();
 assert.equal(run('sniperHoverActive()'),true,'scope starts hover in midair');
 const position=run('[player.x,player.y,player.z]');
 run(`keys.add('KeyW');keys.add('Space');for(let i=0;i<${Math.floor(fps*.3)};i++)playerStep(1/${fps});`);
 for(let i=0;i<3;i++)assert.ok(Math.abs(run('[player.x,player.y,player.z]')[i]-position[i])<.001,`${fps} fps: hover holds position despite movement/jump input`);
 assert.equal(run('sniperSpread()'),0,'hover gives accurate shots after scope settles');
 assert.match(run('sniperStatus()'),/50% DAMAGE TAKEN/,'scope displays vulnerability');
 run('damagePlayer(20)');assert.equal(run('player.hp'),70,'hover multiplies incoming damage by 1.5');
 run(`keys.clear();for(let i=0;i<${fps};i++)playerStep(1/${fps});`);
 assert.equal(run('sniperHoverActive()'),false,'hover expires and does not restart while held');
 assert.ok(run('player.y')<position[1]-.1,'player falls after hover expires');
}
reset();jump();scope();run('for(let i=0;i<36;i++)playerStep(1/60)');assert.equal(run('sniperHoverActive()'),false,'hover ends at 0.6 seconds');assert.equal(run('sniperHoverUsed'),true,'expiry cannot recharge while still airborne');run('playerStep(1/60)');assert.ok(run('player.vy')<0,'gravity resumes on the next frame');
reset();jump();scope();assert.ok(run('sniperSpread()')>0,'hover retains initial scope settling');
run(`for(let i=0;i<18;i++)playerStep(1/60);target.position.set(player.x,player.y+1.68,20);target.computeWorldMatrix(true);scene.render();`);
release();assert.equal(run('bot.hp'),0,'real right-click release registers an airborne headshot');assert.equal(run('ammo.sniper'),4);assert.equal(run('sniperHoverTime'),0,'release ends hover after firing');
reset();jump();scope();run('playerStep(.1);setAiming(false);damagePlayer(20)');assert.equal(run('player.hp'),80,'damage returns to normal immediately on release');
run('setAiming(true)');assert.equal(run('sniperHoverActive()'),false,'rescoping cannot restart hover in the same jump');
run(`keys.clear();for(let i=0;i<80;i++)playerStep(1/60);`);assert.equal(run('playerActor.grounded'),true,'player lands normally');assert.equal(run('sniperHoverUsed'),false,'landing restores hover');
run('setAiming(false)');jump();scope();assert.equal(run('sniperHoverActive()'),true,'next jump can hover again');
for(const cancel of ["reload()","switchWeapon('shotgun')","pause()"]){reset();jump();scope();run('ammo.sniper=4');run(cancel);assert.equal(run('sniperHoverActive()'),false,cancel+' cancels hover');assert.equal(run('sniperHoverUsed'),true,'cancelling does not recharge hover');}
reset();scope();assert.equal(run('sniperHoverActive()'),false,'grounded scope never hovers');run('damagePlayer(20)');assert.equal(run('player.hp'),80,'grounded damage is unchanged');
jump();assert.equal(run('sniperHoverActive()'),true,'jumping while scoped also starts a hover');
reset();run("weapon='shotgun'");jump();scope();assert.equal(run('sniperHoverActive()'),false,'shotgun cannot hover');
reset();jump();scope();run('exploring=true;damagePlayer(200)');assert.equal(run('player.hp'),100,'Explore remains invulnerable');
reset();jump();scope();run('damagePlayer(100)');assert.equal(run('player.hp'),0,'hover damage clamps health at zero');assert.equal(run('roundDelay'),2.4,'lethal damage ends the round');
run('clearEffects();engine.dispose();physics.world.free()');
console.log('PASS: actual airborne controller at 30/60/144 fps, hover accuracy and release headshot, bonus damage, expiry, landing recharge and cancellation.');
