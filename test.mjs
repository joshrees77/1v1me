import {weaponPose} from './dist/weapon-presentation.js';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import {pickVisibleCombat} from './dist/combat-raycast.js';
import assert from 'node:assert/strict';

// Run the actual gameplay functions with Babylon's real headless rendering engine.
// The DOM is a small inert fixture; rendering and input are checked in the browser.
const vendor = { module: { exports: {} }, exports: {}, console, setTimeout, clearTimeout, performance };
vendor.self = vendor;
vm.runInNewContext(readFileSync(new URL('./dist/vendor/babylon.js', import.meta.url), 'utf8'), vendor);
const BABYLON = vendor.exports;
assert.ok(BABYLON.NullEngine, 'Babylon headless engine available');
const elements = new Map();
const makeElement = () => ({ style: {}, textContent: '', hidden: false, value: '', classList: { toggle() {} }, replaceChildren() {}, append() {}, setAttribute() {} });
const document = { getElementById(id) { if (!elements.has(id)) elements.set(id, makeElement()); return elements.get(id); }, createElement: makeElement, querySelectorAll: () => [], exitPointerLock() {} };
const context = vm.createContext({ weaponPose, pickVisibleCombat, window: { BABYLON }, document, localStorage: { getItem: () => null }, console, Math, setTimeout, clearTimeout, performance });
const source = readFileSync(new URL('./dist/game.js', import.meta.url), 'utf8').replace(/^import .*;\n/gm, '');
vm.runInContext(source.slice(0, source.lastIndexOf('\ntry {\n  if(!B')), context);
const run = (code) => vm.runInContext(code, context);
run(`
  settings.sound=false;
  engine=new B.NullEngine();scene=new B.Scene(engine);camera=new B.FreeCamera('test-camera',new B.Vector3(0,1.68,0),scene);scene.activeCamera=camera;
  mat('red','#df3e36');mat('ivory','#dedfd5');mat('white','#ffffff');
  botRoot=new B.TransformNode('test-bot',scene);
  bot={x:0,z:10,hp:100};
  const target=B.MeshBuilder.CreateBox('target',{width:1,height:2,depth:1},scene);target.parent=botRoot;target.position.set(0,1,10);target.metadata={bot:true,head:false};target.computeWorldMatrix(true);
  camera.setTarget(new B.Vector3(0,1.68,10));camera.getViewMatrix(true);scene.render();mode='playing';cooldown=0;
`);

// A broad target isolates damage falloff from pellet spread and random rotation.
run(`target.scaling.set(10,10,1);target.position.z=4;target.computeWorldMatrix(true);fire()`);
assert.equal(run('ammo.shotgun'), 1, 'shotgun consumes one of two shells');
assert.equal(run('bot.hp'), 0, 'close shotgun blast can eliminate a target');
assert.equal(run('hitCount'), 1, 'multiple pellets count as one successful shot');
assert.equal(run('playerScore'), 1, 'elimination awards exactly one round');
run('hitBot(100)');
assert.equal(run('playerScore'), 1, 'round lock prevents duplicate scores');
run(`roundDelay=0;bot.hp=100;botRoot.setEnabled(true);target.position.z=15.5;target.computeWorldMatrix(true);cooldown=0;fire()`);
assert.equal(run('ammo.shotgun'), 0, 'second barrel consumes the last shell');
assert.ok(run('bot.hp') >= 60 && run('bot.hp') <= 62, '15m blast falls to roughly 40 total damage even with every pellet hitting');
run('fire()');
assert.equal(run('reloadTime'), 0, 'fire cooldown prevents immediate empty-trigger reload');
run(`cooldown=0;fire()`);
assert.equal(run('reloadTime'), 2.2, 'empty shotgun starts the two-barrel reload');
run(`reloadTime=0;ammo.shotgun=2;target.position.z=25.5;target.computeWorldMatrix(true);bot.hp=100;fire()`);
assert.equal(run('bot.hp'), 93, '25m blast is only 7 damage with all pellets hitting');
run(`cooldown=0;bot.hp=100;target.position.z=42;target.computeWorldMatrix(true);fire()`);
assert.equal(run('bot.hp'), 100, 'shotgun cannot hit beyond 40m');
run(`target.scaling.set(1,1,1);target.position.z=10;target.computeWorldMatrix(true);switchWeapon('sniper');setAiming(true);updateSniperStability(.25);cooldown=0;fire()`);
assert.equal(run('bot.hp'), 20, 'sniper body damage is unchanged');

run(`roundDelay=0;bot.hp=100;botRoot.setEnabled(true);target.metadata.head=true;setAiming(true);updateSniperStability(.25);cooldown=0;fire()`);
assert.equal(run('bot.hp'), 0, 'sniper headshot is lethal');

run(`roundDelay=0;bot.hp=100;botRoot.setEnabled(true);ammo.sniper=5;cooldown=0;setAiming(false);setAiming(true);updateSniperStability(.65);fire();`);
assert.equal(run('bot.hp'),5,'headshot at the expired window leaves a full-health target at 5 HP');
run(`bot.hp=100;cooldown=0;target.metadata.head=false;fire();`);
assert.equal(run('bot.hp'),24,'held-scope body damage drops five percent to 76');
run(`bot.hp=100;cooldown=0;target.metadata.head=true;setAiming(false);target.scaling.set(10,10,1);target.computeWorldMatrix(true);fire();`);
assert.equal(run('bot.hp'),5,'even a lucky hip-fire headshot cannot one-shot full health');
run(`setAiming(true);updateSniperStability(.649);`);
assert.equal(run('sniperDamage(true)'),100,'one-shot damage remains just inside the window');
run('updateHUD()');
assert.match(elements.get('weapon-hint').textContent,/HEAD 100/,'HUD announces the active damage window');
run(`setAiming(true);updateSniperStability(.002);`);
assert.equal(run('sniperDamage(true)'),95,'repeated aim input does not refresh an existing hold');
run('updateHUD()');
assert.match(elements.get('weapon-hint').textContent,/HEAD 95/,'HUD announces reduced damage after expiry');
run(`setAiming(false);setAiming(true);keys.add('KeyW');updateSniperStability(.7);keys.clear();updateSniperStability(.25);`);
assert.equal(run('sniperDamage(true)'),95,'movement and re-settling cannot restart damage timing');
assert.equal(run('sniperSpread()'),0,'late scoped shots remain accurate when settled');
run(`bot.hp=100;ammo.sniper=5;cooldown=0;setAiming(false);setAiming(true);updateSniperStability(.25);target.scaling.set(1,1,1);target.computeWorldMatrix(true);fire();`);
assert.equal(run('bot.hp'),0,'a fresh scope hold restores the one-shot headshot window');

run(`roundDelay=0;bot.hp=100;botRoot.setEnabled(true);target.metadata.head=false;const wall=box('test-wall',0,1,5,3,3,1,materials.ivory,true);wall.computeWorldMatrix(true);weapon='shotgun';ammo.shotgun=2;cooldown=0;reloadTime=0;fire();`);
assert.equal(run('bot.hp'), 100, 'cover blocks a shot before the target');

run(`let body={x:0,z:2};moveBody(body,0,10,.37);`);
assert.ok(run('body.z') < 4.2, 'substeps stop fast movement tunnelling through cover');
run(`body={x:2,z:2};moveBody(body,0,4,.37);`);
assert.ok(run('body.z') > 5, 'clear lane permits movement');

run(`wall.dispose();obstacles.length=0;clearEffects();target.position.set(0,1.68,10);target.scaling.y=1.5;target.computeWorldMatrix(true);weapon='knife';cooldown=0;knifeReturn=0;throwKnife();`);
assert.equal(run('knives.length'), 1, 'throw creates a projectile');
assert.equal(run('knifeReturn'), 3, 'throw starts recovery cooldown');
run('throwKnife()');
assert.equal(run('knives.length'), 1, 'recovery prevents duplicate throws');
run(`for(let i=0;i<30 && knives.length;i++)effectStep(1/60);`);
assert.equal(run('bot.hp'), 0, 'swept knife projectile hits and eliminates target');
assert.equal(run('knives.length'), 0, 'projectile is removed on impact');

run(`roundDelay=0;weapon='shotgun';ammo.shotgun=0;reloadTime=0;cooldown=0;fire();`);
assert.ok(run('reloadTime') > 0, 'empty gun initiates reload');
run(`switchWeapon('sniper')`);
assert.equal(run('reloadTime'), 0, 'switching cancels reload');
run(`player={x:0,z:0,y:0,vy:0,hp:100,vx:0,vz:0};yaw=0;pitch=0;keys.clear();keys.add('KeyW');aiming=false;for(let i=0;i<60;i++)playerStep(1/60);`);
assert.ok(run('player.vz') > 6.4, 'normal run still reaches full speed');
run(`keys.add('ShiftLeft');player.vz=9.2;aiming=true;weapon='sniper';playerStep(1/60);`);
assert.ok(run('Math.hypot(player.vx,player.vz)') <= 1.800001, 'entering scope immediately clamps sprint momentum');
run(`for(let i=0;i<60;i++)playerStep(1/60);`);
assert.ok(run('player.vz') <= 1.800001, 'holding sprint cannot override scope slowdown');
run(`aiming=false;for(let i=0;i<60;i++)playerStep(1/60);`);
assert.ok(run('player.vz') > 9, 'leaving scope restores sprint speed');
run(`keys.clear();player.vx=player.vz=player.vy=0;roundDelay=0;reloadTime=0;weapon='sniper';setAiming(false);updateSniperStability(1);`);
assert.equal(run('sniperSpread()'), .18, 'stationary hip-fire remains highly inaccurate');
run(`setAiming(true);updateSniperStability(.1);`);
assert.ok(run('sniperSpread()') > 0, 'quick-scoping does not instantly grant precision');
run(`updateSniperStability(.15);`);
assert.equal(run('sniperSpread()'), 0, 'scope settles after 250ms stationary');
run(`player.vx=1.8;updateSniperStability(1);`);
assert.ok(run('sniperSpread()') >= .12, 'scoped walking has strong spread');
assert.equal(run('sniperStableTime'), .25, 'movement does not restart scope alignment');
run(`player.vx=0;player.vy=3;updateSniperStability(1);`);
assert.ok(run('sniperSpread()') >= .12, 'jumping is inaccurate even without horizontal movement');
run(`player.vy=0;updateSniperStability(.25);keys.add('KeyD');`);
assert.ok(run('sniperSpread()') >= .12, 'movement input adds spread before the next simulation tick');
run(`keys.clear();setAiming(false);setAiming(true);`);
assert.equal(run('sniperStableTime'), 0, 're-scoping resets settling even between frames');
// A scoped stop must be precise even if the click arrives before the next frame.
for(const fps of [30,60,144]){
 run(`keys.clear();player={x:0,z:0,y:0,vy:0,hp:100,vx:0,vz:0};yaw=.71;setAiming(false);setAiming(true);keys.add('KeyW');keys.add('KeyD');for(let i=0;i<${fps};i++)playerStep(1/${fps});`);
 assert.ok(run('sniperSpread()')>=.12,'scoped diagonal movement stays inaccurate');
 const age=run('sniperScopeTime');
 run(`keys.delete('KeyW');stopReleasedMovement();`);
 assert.ok(run('sniperSpread()')>=.12,'remaining strafe still applies movement spread');
 run(`keys.delete('KeyD');stopReleasedMovement();`);
 assert.equal(run('sniperSpread()'),0,`${fps}fps: key release restores precise scope before the next frame`);
 assert.equal(run('sniperScopeTime'),age,'stopping cannot restart the headshot damage window');
 assert.equal(run('sniperDamage(true)'),95,'held-scope head damage stays at 95 after stopping');
 run(`var beforeStopRay=sniperShotDirection(new B.Vector3(0,0,1),()=>.5);`);
 assert.equal(run('beforeStopRay.x'),0,'the actual stopped shot has no horizontal random spread');
 assert.equal(run('beforeStopRay.y'),0,'the actual stopped shot has no vertical random spread');
}
run(`player.vx=player.vz=player.vy=0;setAiming(false);setAiming(true);updateSniperStability(.1);`);
assert.ok(run('sniperSpread()')>0,'initial scope-in settling is preserved');
run(`setAiming(false);`);
run(`yaw=0;camera.rotation.set(0,0,0);camera.getViewMatrix(true);`);
// Actual ray directions, using a reproducible sample off the centre of the cone.
run(`setAiming(false);const straight=new B.Vector3(0,0,1);const hipRay=sniperShotDirection(straight,()=>.5);`);
assert.ok(run('Math.abs(hipRay.x)') > .1, 'hip-fire changes the real ray direction');
run(`setAiming(true);updateSniperStability(.25);const steadyRay=sniperShotDirection(straight,()=>.5);`);
assert.equal(run('steadyRay.x'), 0, 'settled scoped ray follows the crosshair');
assert.equal(run('steadyRay.z'), 1, 'settled scoped ray retains forward direction');
run(`player.vz=1.8;const movingRay=sniperShotDirection(straight,()=>.5);`);
assert.ok(run('Math.abs(movingRay.x)') > .08, 'scoped movement changes the real ray direction');
run(`keys.clear();keys.add('KeyC');keys.add('KeyW');keys.add('ShiftLeft');aiming=false;player.vz=9.2;playerStep(1/60);`);
assert.equal(run('player.crouched'),true,'C enters crouch');
assert.ok(run('Math.hypot(player.vx,player.vz)')<=2.100001,'crouch immediately caps sprint momentum to crawl speed');
assert.ok(Math.abs(run('camera.position.y-player.y')-.85)<.000001,'crouching lowers eye height');
run(`keys.delete('KeyC');playerStep(1/60);`);
assert.equal(run('player.crouched'),false,'releasing C restores standing');
assert.ok(Math.abs(run('camera.position.y-player.y')-1.68)<.000001,'standing restores eye height');
for(const fps of [30,60,144]){
  run(`keys.clear();aiming=false;player={x:0,z:0,y:0,vy:0,hp:100,vx:0,vz:0};yaw=.71;keys.add('KeyW');keys.add('KeyD');keys.add('ShiftLeft');for(let i=0;i<${fps};i++)playerStep(1/${fps});keys.clear();`);
  const stoppedX=run('player.x'),stoppedZ=run('player.z');
  run(`for(let i=0;i<${fps};i++)playerStep(1/${fps});`);
  assert.equal(run('player.x'),stoppedX,`${fps}fps: no X drift after releasing diagonal sprint`);
  assert.equal(run('player.z'),stoppedZ,`${fps}fps: no Z drift after releasing diagonal sprint`);
  assert.equal(run('Math.hypot(player.vx,player.vz)'),0,'release clears horizontal velocity');
}
run(`keys.add('KeyW');keys.add('KeyD');for(let i=0;i<60;i++)playerStep(1/60);keys.delete('KeyD');playerStep(1/60);`);
assert.ok(Math.abs(run('player.vx*Math.cos(yaw)-player.vz*Math.sin(yaw)'))<1e-10,'releasing strafe stops sideways drift while walking forward');
run(`scene.metadata={shadow:{addShadowCaster(){}}};buildBot();botRoot.position.set(0,0,0);scene.render();`);
assert.ok(run('botRoot.getChildMeshes().length')>35,'armoured operator includes visible equipment');
run(`const helmetHit=scene.pickWithRay(new B.Ray(new B.Vector3(0,1.55,3),new B.Vector3(0,0,-1),4),m=>m.metadata?.bot===true);`);
assert.equal(run('helmetHit.pickedMesh.metadata.head'),true,'helmet and visor retain headshot classification');
run(`const bodyHit=scene.pickWithRay(new B.Ray(new B.Vector3(0,1.05,3),new B.Vector3(0,0,-1),4),m=>m.metadata?.bot===true);`);
assert.equal(run('bodyHit.pickedMesh.metadata.head'),false,'chest armour remains a body hit');
// Exercise the actual stab and viewmodel pose throughout its travel, including walking.
run(`clearEffects();botRoot.setEnabled(false);gunRoot=new B.TransformNode('pose-test',scene);weapon='knife';knifeReturn=0;reloadTime=0;aiming=false;bob=1.2;recoil=.08;stabTime=0;updateWeaponPose();const restPose=gunRoot.position.clone();const restAngle=gunRoot.rotation.clone();stabKnife();`);
assert.equal(run('cooldown'),.55,'stab retains the existing attack cooldown');
for(const remaining of [.38,.35,.29,.2,.1,.001]){
  run(`stabTime=${remaining};bob+=.7;updateWeaponPose();`);
  assert.equal(run('gunRoot.position.x'),run('restPose.x'),'stab does not sweep sideways');
  assert.equal(run('gunRoot.position.y'),run('restPose.y'),'stab holds grip height even while walking');
  assert.ok(run('gunRoot.rotation.equalsWithEpsilon(restAngle,1e-9)'),'stab keeps the blade angle fixed');
  assert.ok(run('gunRoot.position.z>=restPose.z && gunRoot.position.z<=restPose.z+.420001'),'stab stays within forward travel');
}
run(`stabTime=.29;updateWeaponPose();`);
assert.ok(Math.abs(run('gunRoot.position.z-restPose.z')-.42)<1e-9,'stab reaches full forward extension');
run(`stabTime=0;bob=1.2;updateWeaponPose();`);
assert.ok(run('gunRoot.position.equalsWithEpsilon(restPose,1e-9)'),'knife returns to resting position');
run(`stabKnife();switchWeapon('shotgun');`);
assert.equal(run('stabTime'),0,'weapon switch cancels the stab');
run(`cooldown=0;roundDelay=0;knifeReturn=0;recoil=0;updateWeaponPose(0);const gunPose=gunRoot.position.clone();const gunAngle=gunRoot.rotation.clone();throwKnife();updateWeaponPose(0);`);
assert.ok(run('gunRoot.position.equalsWithEpsilon(gunPose,1e-9) && gunRoot.rotation.equalsWithEpsilon(gunAngle,1e-9)'),'quick throw does not swing the held gun');
run(`clearEffects();engine.dispose();`);
console.log('PASS: sniper hip-fire/movement spread, scope settling, ray directions, shotgun falloff, cover, damage, movement, collision, knife, reload and scoring.');
