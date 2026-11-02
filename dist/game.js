import {createPhysics,nearestNode,findPath} from './physics.js';
import {createCyberTheme} from './cyber-theme.js';
import {uniqueSurfaceIndices,uniquePanelIndices,surfaceDepth} from './map-rendering.js';
import {pickVisibleCombat} from './combat-raycast.js';
import {createCombatIndex} from './combat-index.js';
/* SHATTER / Practice prototype. Babylon.js handles rendering; gameplay is local. */
const $ = (id) => document.getElementById(id);
const canvas = $('arena');
const B = window.BABYLON;
const WEAPONS = {
  shotgun: { name: 'SHOTGUN', capacity: 2, damage: 14, pellets: 10, spread: .08, range: 40, interval: .38, reload: 2.2 },
  sniper: { name: 'SNIPER', capacity: 5, damage: 80, head: 100, heldDamage: 76, heldHead: 95, powerWindow: .65, interval: 1.15, reload: 2.1, hipSpread: .18, moveSpread: .12, settleTime: .25, hoverDuration: .6, hoverDamageMultiplier: 1.5 },
  knife: { name: 'KNIFE', capacity: 1, damage: 65, head: 100, interval: .55, reload: 0 },
};
let engine, scene, camera, bot, botRoot, gunRoot, shotgunBreech, combatIndex;
let mode = 'lobby', selected = 'shotgun', weapon = 'shotgun', aiming = false;
let player = { x: 0, z: -16, y: 0, vy: 0, hp: 100, vx: 0, vz: 0 };
let yaw = 0, pitch = 0, recoil = 0, stabTime = 0, stabBob = 0, bob = 0, time = 0;
let playerScore = 0, botScore = 0, round = 1, roundTime = 60, roundDelay = 0;
let ammo = { shotgun: 2, sniper: 5 }, cooldown = 0, reloadTime = 0, knifeReturn = 0;
let shotCount = 0, hitCount = 0, kills = 0, toastTime = 0, hitTime = 0, damageTime = 0;
const keys = new Set(), obstacles = [], worldMeshes = [], effects = [], knives = [];
const gunModels = {}, materials = {};
let settings = { sensitivity: 1, difficulty: 'rookie', sound: true };
let pointerFallback = false, dragging = false, lastMouseX = 0, lastMouseY = 0;
let mouseFireHandled = false, sniperReleaseArmed = false, secondaryPressButton = null;
let sniperStableTime = 0, sniperScopeTime = 0;
let sniperHoverTime = 0, sniperHoverUsed = false;
let physics,playerActor,botActor,nav=[],spawnPlayer,spawnBot,exploring=false,patrolGoals=[];
try { settings = { ...settings, ...JSON.parse(localStorage.getItem('shatter-settings') || '{}') }; } catch {}
let audio,themeRenderer;
let mapTheme='cyber';
try{mapTheme=localStorage.getItem('shatter-map-theme')==='rust'?'rust':'cyber';}catch{}
const mapSurfaces=[];
function setMapTheme(next){
  mapTheme=next==='rust'?'rust':'cyber';const cyber=mapTheme==='cyber';themeRenderer.apply(cyber);
  document.body.dataset.theme=mapTheme;
  document.querySelectorAll('[data-theme-choice]').forEach(el=>{const active=el.dataset.themeChoice===mapTheme;el.classList.toggle('selected',active);el.setAttribute('aria-pressed',String(active));});
  $('map-title').textContent=cyber?'NEON RUST':'RUST';$('map-description').textContent=cyber?'CYBERPUNK TEXTURES':'ORIGINAL TEXTURES';
  $('hud-map-name').textContent=cyber?'NEON RUST':'RUST';
  try{localStorage.setItem('shatter-map-theme',mapTheme);}catch{}
}

function sound(kind) {
  if (!settings.sound) return;
  try {
    audio ||= new (window.AudioContext || window.webkitAudioContext)();
    if (audio.state === 'suspended') audio.resume();
    const t = audio.currentTime, osc = audio.createOscillator(), gain = audio.createGain();
    const preset = { shotgun: [105, 25, .24, .22], sniper: [90, 22, .3, .24], knife: [500, 80, .16, .05], hit: [850, 450, .07, .055], reload: [300, 420, .055, .03], kill: [440, 880, .2, .075], hurt: [110, 55, .12, .07] }[kind] || [220, 100, .1, .03];
    osc.type = ['shotgun', 'sniper'].includes(kind) ? 'sawtooth' : 'triangle';
    osc.frequency.setValueAtTime(preset[0], t); osc.frequency.exponentialRampToValueAtTime(preset[1], t + preset[2]);
    gain.gain.setValueAtTime(preset[3], t); gain.gain.exponentialRampToValueAtTime(.001, t + preset[2]);
    osc.connect(gain); gain.connect(audio.destination); osc.start(t); osc.stop(t + preset[2]);
    if (kind === 'shotgun' || kind === 'sniper') {
      const buffer = audio.createBuffer(1, audio.sampleRate * .1, audio.sampleRate), data = buffer.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
      const source = audio.createBufferSource(), ng = audio.createGain(); source.buffer = buffer; ng.gain.value = .13; source.connect(ng); ng.connect(audio.destination); source.start();
    }
  } catch { /* Audio is optional. */ }
}

function mat(name, hex, emissive = false) {
  const m = new B.StandardMaterial(name, scene); m.diffuseColor = B.Color3.FromHexString(hex); m.specularColor = B.Color3.Black();
  if (emissive) m.emissiveColor = m.diffuseColor.scale(.7);
  materials[name] = m; return m;
}
function box(name, x, y, z, w, h, d, material, collides = false) {
  const mesh = B.MeshBuilder.CreateBox(name, { width: w, height: h, depth: d }, scene);
  mesh.position.set(x, y, z); mesh.material = material; mesh.receiveShadows = true;
  if (collides) { obstacles.push({ x, z, w, d, top: y + h / 2 }); worldMeshes.push(mesh); mesh.metadata = { world: true }; }
  return mesh;
}
function textPanel(text, x, y, z, w, h, rot = 0, color = '#52594b', bg = '#dcded3') {
  const plane = B.MeshBuilder.CreatePlane('sign', { width: w, height: h }, scene);
  plane.position.set(x, y, z); plane.rotation.y = rot; plane.isPickable = false;
  const tex = new B.DynamicTexture('sign-text', { width: 1024, height: 256 }, scene, false);
  const ctx = tex.getContext(); ctx.fillStyle = bg; ctx.fillRect(0, 0, 1024, 256); ctx.font = 'bold 120px Arial'; ctx.fillStyle = color; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(text, 512, 134); tex.update();
  const m = new B.StandardMaterial('sign-mat', scene); m.diffuseTexture = tex; m.specularColor = B.Color3.Black(); plane.material = m;
}
function buildArena() {
  const ivory = mat('ivory', '#dedfd5'), light = mat('light', '#ecece3'), edge = mat('edge', '#bec3b5'), floor = mat('floor', '#cdd0c2');
  const charcoal = mat('charcoal', '#303a31'), red = mat('red', '#df3e36'), darkRed = mat('darkRed', '#a32324'), white = mat('white', '#eeeeea');
  mat('metal', '#444b47'); mat('black', '#1c2420'); mat('glow', '#ee5c49', true); mat('skin', '#9ca799');
  const ground = box('ground', 0, -.3, 0, 44, .6, 52, floor); ground.metadata = { world: true }; worldMeshes.push(ground);
  box('outer-foundation', 0, -1, 0, 45, 1, 53, edge);
  box('rear-wall', 0, 4.3, 24, 44, 8.6, 1.5, ivory, true);
  box('left-wall', -21, 3.4, 0, 1.5, 6.8, 48, ivory, true);
  box('right-wall', 21, 3.4, 0, 1.5, 6.8, 48, ivory, true);
  box('front-wall', 0, 1.5, -24, 44, 3, 1, ivory, true);
  // Two flank lanes, staggered cover, and an open central duel lane.
  for (const [x,z,w,h,d] of [[-8,-9,5,2.5,5],[8,9,5,2.5,5],[-8,8,4,4.2,7],[8,-7,4,4.2,7],[-15,0,3,2,4],[15,0,3,2,4],[-3,2,3,1.2,2.5],[4,-1,2.5,1.2,2.5]]) {
    box('cover', x, h/2, z, w, h, d, light, true);
    box('cover-foot', x, .15, z, w+.12, .3, d+.12, edge);
    box('cover-top', x, h+.025, z, w+.05, .05, d+.05, ivory);
  }
  for (const x of [-16,16]) for (const z of [-17,17]) {
    box('pillar', x, 4.1, z, 1.1, 8.2, 1.1, light, true);
    box('pillar-band', x, 1.2, z-.56, 1.12, .14, .02, red);
  }
  for (const z of [-17,17]) box('crossbeam', 0, 8.1, z, 33, .7, 1.1, light);
  for (const x of [-16,16]) box('side-beam', x, 8.1, 0, 1.1, .7, 35, light);
  for (let i = -18; i <= 18; i += 6) box('floor-line', i, .008, 0, .025, .012, 47, edge);
  for (let i = -18; i <= 18; i += 6) box('floor-line', 0, .008, i, 41, .012, .025, edge);
  for (const z of [-18,18]) {
    box('spawn-stripe', 0, .013, z, 7, .018, .15, red);
    box('spawn-stripe-end', -3.5, .013, z + (z < 0 ? 1 : -1), .15, .018, 2, red);
    box('spawn-stripe-end', 3.5, .013, z + (z < 0 ? 1 : -1), .15, .018, 2, red);
  }
  box('rear-inset', 0, 3.8, 23.2, 9, 5.9, .15, charcoal);
  textPanel('A T R I U M', 0, 5.3, 23.08, 7, 1.6, 0, '#e5e5d9', '#303a31');
  textPanel('01 / PRACTICE FPS', 0, 3.7, 23.06, 4.6, 1, 0, '#b5bdac', '#303a31');
  textPanel('SECTOR 01', -12, 4.5, 23.1, 4.5, 1.1);
  textPanel('SECTOR 02', 12, 4.5, 23.1, 5.6, 1.1);
  for (const x of [-18.5,18.5]) {
    box('light-strip', x, .03, 0, .05, .05, 39, white);
    box('rear-red-stripe', x, 3.5, 23.1, .16, 6, .03, red);
  }
  // Abstract distant architecture completes the silhouette without expensive assets.
  for (let i=0;i<12;i++) box('skyline', -45+i*8, 3+(i%3)*2, 38+(i%2)*8, 5, 11+(i%3)*4, 7, i%2?light:ivory);
  const shadow = new B.ShadowGenerator(2048, scene.getLightByName('sun'));
  shadow.useBlurExponentialShadowMap = true; shadow.blurKernel = 24; shadow.darkness = .24;
  scene.meshes.filter(m => m.name === 'cover' || m.name === 'pillar' || m.name.includes('beam')).forEach(m => shadow.addShadowCaster(m));
  scene.metadata = { shadow };
}
async function buildRust() {
  mat('ivory','#d7c4a2');mat('charcoal','#3b3830');mat('red','#df3e36');mat('darkRed','#962e25');mat('white','#eee3ca');mat('metal','#55534c');mat('black','#242722');mat('glow','#ee5c49',true);mat('skin','#8e947a');
  const [meta,data,collision,navigation,hitMasks]=await Promise.all([
    fetch('assets/rust/map.json').then(r=>r.json()),fetch('assets/rust/map.bin.gz').then(r=>new Response(r.body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer()),fetch('assets/rust/collision.bin').then(r=>r.arrayBuffer()),fetch('assets/rust/nav.json').then(r=>r.json()),fetch('assets/hit-masks.json').then(r=>r.json())]);
  for(const mask of Object.values(hitMasks))mask.bytes=Uint8Array.from(atob(mask.bits),c=>c.charCodeAt(0));
  nav=navigation;
  // Keep world depth for decals; viewmodels retain their separate group 2.
  scene.setRenderingAutoClearDepthStencil(1,false);
  const decalOrder=(a,b)=>a.getMesh().uniqueId-b.getMesh().uniqueId;
  scene.setRenderingOrder(1,decalOrder,decalOrder);
  const textureCache=new Map();
  for(const [surfaceIndex,item] of meta.entries()){
    if(item.name==='shadowcaster')continue;
    const mesh=new B.Mesh(item.name,scene),v=new B.VertexData();
    v.positions=new Float32Array(data,...item.p);v.normals=new Float32Array(data,...item.n);v.uvs=new Float32Array(data,...item.uv);v.indices=uniqueSurfaceIndices(v.positions,new Uint32Array(data,...item.i));
    if(item.name==='me_metal_rust_03')v.indices=uniquePanelIndices(v.positions,v.indices);
    v.applyToMesh(mesh);
    const m=new B.StandardMaterial(item.name+'-ps2',scene);m.specularColor=B.Color3.Black();m.backFaceCulling=false;m.diffuseColor=new B.Color3(.83,.78,.67);
    Object.assign(m,surfaceDepth(item.name,surfaceIndex));
    if(item.name==='me_metal_rust_03')m.twoSidedLighting=true;
    mesh.renderingGroupId=m.disableDepthWrite?1:0;
    if(item.texture){if(!textureCache.has(item.texture)){const t=new B.Texture('assets/rust/'+item.texture,scene,false,false,B.Texture.TRILINEAR_SAMPLINGMODE);t.anisotropicFilteringLevel=8;t.hasAlpha=/chainlink|grate|grating|foliage|grass|shrub|pine|_dec|decal|holes/.test(item.name);textureCache.set(item.texture,t);}m.diffuseTexture=textureCache.get(item.texture);m.useAlphaFromDiffuseTexture=m.diffuseTexture.hasAlpha;m.transparencyMode=m.diffuseTexture.hasAlpha?B.Material.MATERIAL_ALPHATEST:B.Material.MATERIAL_OPAQUE;m.alphaCutOff=.45;}
    mapSurfaces.push({name:item.name,mesh,original:m});mesh.material=m;mesh.metadata={world:item.solid,hitMask:hitMasks[item.texture]};mesh.isPickable=item.solid;mesh.freezeWorldMatrix();mesh.receiveShadows=true;
  }
  combatIndex=createCombatIndex(B,mapSurfaces.map(s=>s.mesh));
  physics=await createPhysics(collision);
  const point=(n)=>({x:n[0],y:n[1],z:n[2]});
  spawnPlayer=point(nav[nearestNode(nav,{x:-8,y:-6,z:5})]);spawnBot=point(nav[nearestNode(nav,{x:16,y:-6,z:32})]);
  playerActor=physics.actor(spawnPlayer);botActor=physics.actor(spawnBot);
  patrolGoals=[nav.reduce((best,n,i)=>n[1]>nav[best][1]?i:best,0),nearestNode(nav,spawnPlayer),nearestNode(nav,{x:28,y:-6,z:10}),nearestNode(nav,spawnBot)];
  const shadow=new B.ShadowGenerator(1024,scene.getLightByName('sun'));shadow.usePercentageCloserFiltering=true;shadow.darkness=.3;scene.metadata={shadow};
}
// Eight-sided cross sections give stocks, armour and grips a shaped silhouette.
// The bevels are geometry, so they remain visible with the low-resolution art.
function modelProfile(name, sections) {
  const positions=[],indices=[],uvs=[],normals=[];
  for(const [z,w,h,cy=0] of sections){
    const b=Math.min(w,h)*.22;
    for(const [x,y] of [[-w/2+b,-h/2],[w/2-b,-h/2],[w/2,-h/2+b],[w/2,h/2-b],[w/2-b,h/2],[-w/2+b,h/2],[-w/2,h/2-b],[-w/2,-h/2+b]]){
      positions.push(x,y+cy,z);uvs.push(x/w+.5,(z-sections[0][0])/(sections.at(-1)[0]-sections[0][0]));
    }
  }
  for(let r=0;r<sections.length-1;r++)for(let j=0;j<8;j++){const a=r*8+j,b=r*8+(j+1)%8,c=a+8,d=b+8;indices.push(a,b,c,b,d,c);}
  for(let j=1;j<7;j++){indices.push(0,j+1,j);const k=(sections.length-1)*8;indices.push(k,k+j,k+j+1);}
  // Babylon's default left-handed front faces use clockwise winding.
  for(let i=0;i<indices.length;i+=3)[indices[i+1],indices[i+2]]=[indices[i+2],indices[i+1]];
  const mesh=new B.Mesh(name,scene),v=new B.VertexData();v.positions=positions;v.indices=indices;v.uvs=uvs;
  B.VertexData.ComputeNormals(positions,indices,normals);v.normals=normals;v.applyToMesh(mesh);mesh.convertToFlatShadedMesh();return mesh;
}
function modelBevel(name,size){
  const [w,h,d]=size,b=Math.min(w,h,d)*.16;
  return modelProfile(name,[[-d/2,w-b*2,h-b*2],[-d/2+b,w,h],[d/2-b,w,h],[d/2,w-b*2,h-b*2]]);
}
function modelOval(name,size){return B.MeshBuilder.CreateSphere(name,{diameterX:size[0],diameterY:size[1],diameterZ:size[2],segments:8},scene);}
function buildBot() {
  botRoot = new B.TransformNode('opponent', scene);botRoot.scaling.setAll(.86);
  const armour=mat('operator-armour','#8aaeb3'),cloth=mat('operator-cloth','#303c46'),edge=mat('operator-edge','#607b83');
  const visor=mat('operator-visor','#ff527f',true),mark=mat('operator-mark','#b6a16e');
  armour.diffuseTexture=new B.Texture('assets/neon/tower-steel.png',scene,false,false,B.Texture.TRILINEAR_SAMPLINGMODE);
  armour.specularColor=new B.Color3(.12,.14,.15);armour.specularPower=24;
  function part(name, mesh, x,y,z, material=armour, parent=botRoot, head=false) {
    mesh.name=name;mesh.parent=parent;mesh.position.set(x,y,z);mesh.material=material;
    mesh.metadata={bot:true,head};scene.metadata.shadow.addShadowCaster(mesh);return mesh;
  }
  function plate(name,pos,size,material=armour,parent=botRoot,head=false){return part(name,modelBevel(name,size),...pos,material,parent,head);}
  function oval(name,pos,size,material=armour,parent=botRoot,head=false){return part(name,modelOval(name,size),...pos,material,parent,head);}
  const torso=part('bot-torso',B.MeshBuilder.CreateCylinder('torso',{height:.55,diameterTop:.59,diameterBottom:.4,tessellation:12},scene),0,1.25,0,cloth);torso.scaling.z=.67;
  // Separate pectoral plates, waist segments and shoulder caps follow a human form.
  for(const side of [-1,1]){
    const chest=plate('chest-armour',[side*.125,1.28,.155],[.255,.29,.15]);chest.rotation.z=-side*.13;
    plate('abdomen-armour',[side*.09,1.045,.155],[.18,.16,.085],edge);
    plate('harness',[side*.22,1.36,.07],[.055,.25,.18],cloth).rotation.z=-side*.18;
  }
  plate('unit-badge',[-.13,1.32,.239],[.07,.045,.012],mark);
  plate('radio',[.23,1.39,.13],[.08,.12,.08],cloth);
  plate('power-pack',[0,1.18,-.19],[.32,.43,.16],cloth);
  plate('pack-spine',[0,1.18,-.285],[.07,.31,.025],armour);
  oval('bot-head',[0,1.8,0],[.4,.4,.4],armour,botRoot,true);
  plate('helmet-brow',[0,1.88,.185],[.36,.065,.11],cloth,botRoot,true);
  const face=part('visor',modelProfile('wraparound-visor',[[-.035,.35,.09],[.015,.31,.085],[.045,.22,.07]]),0,1.805,.205,visor,botRoot,true);
  plate('respirator',[0,1.68,.19],[.23,.13,.12],cloth,botRoot,true);
  for(const side of [-1,1])oval('helmet-ear',[side*.19,1.77,0],[.065,.15,.15],edge,botRoot,true);
  for(const x of [-.06,0,.06])plate('mask-vent',[x,1.69,.254],[.016,.065,.012],edge,botRoot,true);
  oval('bot-neck',[0,1.55,0],[.19,.18,.19],cloth);
  oval('bot-hips',[0,.91,0],[.43,.27,.32],cloth);
  plate('belt',[0,1,.015],[.44,.065,.32],edge);
  for(const side of [-1,1])plate('belt-pouch',[side*.18,.96,.18],[.12,.16,.11],armour);
  bot={x:0,y:0,z:8,hp:100,fire:2,ai:0,waypoint:0,legs:[],arms:[],stride:0};
  for(const side of [-1,1]){
    const leg=new B.TransformNode('leg-pivot',scene);leg.parent=botRoot;leg.position.set(side*.15,.86,0);leg.scaling.y=1.27;bot.legs.push(leg);
    oval('bot-thigh',[0,-.15,0],[.23,.37,.24],cloth,leg);
    oval('knee-joint',[0,-.33,.012],[.17,.17,.18],cloth,leg);
    oval('bot-shin',[0,-.46,-.005],[.17,.29,.19],cloth,leg);
    plate('thigh-plate',[0,-.14,.104],[.18,.25,.075],armour,leg);
    oval('knee-pad',[0,-.32,.105],[.185,.16,.09],edge,leg);
    plate('shin-plate',[0,-.47,.08],[.14,.2,.07],armour,leg);
    part('bot-foot',modelProfile('boot',[[-.12,.16,.16],[.04,.2,.15],[.21,.17,.105,-.02]]),0,-.59,.02,cloth,leg);
    const arm=new B.TransformNode('arm-pivot',scene);arm.parent=botRoot;arm.position.set(side*.33,1.37,0);arm.rotation.z=side*.12;bot.arms.push(arm);
    oval('shoulder-pad',[0,-.015,.005],[.26,.24,.28],armour,arm);
    const upper=oval('bot-upper-arm',[0,-.15,.055],[.18,.29,.2],cloth,arm);upper.rotation.x=-.35;
    oval('elbow-joint',[0,-.275,.12],[.16,.16,.16],edge,arm);
    const reach=side===1?-.08:.12;
    const forearm=oval('bot-forearm',[reach,-.29,.265],[.16,.17,.36],cloth,arm);forearm.rotation.y=side===1?-.45:.7;
    plate('forearm-guard',[reach,-.21,.265],[.15,.05,.22],armour,arm).rotation.y=side===1?-.45:.7;
    const handX=side===1?-.15:.23;
    oval('gloved-hand',[handX,-.285,.41],[.14,.13,.18],cloth,arm);
    oval('glove-thumb',[handX-side*.055,-.25,.45],[.055,.07,.09],cloth,arm);
  }
  plate('bot-gun',[.12,1.08,.48],[.11,.13,.4],cloth);
  const barrel=part('bot-gun-barrel',B.MeshBuilder.CreateCylinder('bot-barrel',{height:.28,diameter:.06,tessellation:12},scene),.12,1.1,.79,edge);barrel.rotation.x=Math.PI/2;
  plate('bot-gun-rail',[.12,1.17,.5],[.065,.035,.3],edge);
  botRoot.position.set(spawnBot?.x||0,spawnBot?.y||0,spawnBot?.z||7);
}
function buildGuns() {
  gunRoot = new B.TransformNode('viewmodel', scene); gunRoot.parent = camera;
  function attach(parent,name,mesh,pos,material){mesh.name=name;mesh.parent=parent;mesh.position.set(...pos);mesh.material=material;mesh.isPickable=false;mesh.renderingGroupId=2;return mesh;}
  function piece(parent,name,pos,dims,material,rz=0){const m=attach(parent,name,modelBevel(name,dims),pos,material);m.rotation.z=rz;return m;}
  function profile(parent,name,pos,sections,material){return attach(parent,name,modelProfile(name,sections),pos,material);}
  function oval(parent,name,pos,dims,material){return attach(parent,name,modelOval(name,dims),pos,material);}
  function tube(parent,name,pos,length,diameter,material,end=diameter){const m=attach(parent,name,B.MeshBuilder.CreateCylinder(name,{height:length,diameterTop:end,diameterBottom:diameter,tessellation:16},scene),pos,material);m.rotation.x=Math.PI/2;return m;}
  const glove=mat('player-glove','#263039'),sleeve=mat('player-sleeve','#40565d'),cuff=mat('player-cuff','#1aa6b4',true);
  const gunmetal=mat('weapon-steel','#4c5b63'),coated=mat('weapon-coating','#28353d'),grip=mat('weapon-grip','#343b3c'),lens=mat('scope-glass','#345867');
  gunmetal.specularColor=new B.Color3(.25,.28,.3);gunmetal.specularPower=28;coated.specularColor=new B.Color3(.12,.14,.16);coated.specularPower=20;
  // Small specular highlights make the bevels readable without glossy chrome.
  function hand(root,x,y,z,support=false){
    oval(root,support?'support-glove':'glove',[x,y,z],[.13,.135,.18],glove);
    oval(root,'thumb',[x-.063,y+.015,z+.025],[.065,.085,.105],glove).rotation.z=-.4;
    for(let i=0;i<3;i++)oval(root,'finger',[x+.047,y-.026+i*.032,z+.045],[.045,.03,.105],glove);
    piece(root,'knuckle-plate',[x,y+.058,z+.012],[.095,.025,.1],sleeve);
  }
  for (const name of Object.keys(WEAPONS)) {
    const root = new B.TransformNode(name+'-model',scene);root.parent=gunRoot;root.scaling.setAll(.9);gunModels[name]=root;
    hand(root,.015,-.15,-.08);
    profile(root,'sleeve',[.015,-.215,-.23],[[-.2,.18,.17,-.06],[.07,.145,.14],[.12,.135,.13]],sleeve);
    piece(root,'armour-cuff',[.015,-.19,-.15],[.16,.05,.1],coated,-.12);
    piece(root,'cuff-status',[.07,-.175,-.1],[.03,.014,.012],cuff);
    if (name==='shotgun') {
      const stock=mat('shotgun-stock','#63564b');
      profile(root,'shotgun-stock',[0,-.035,-.12],[[-.36,.105,.2,-.055],[-.31,.12,.19,-.05],[-.13,.105,.125],[.035,.13,.13]],stock);
      piece(root,'butt-pad',[0,-.09,-.48],[.115,.2,.035],grip);
      const g=piece(root,'shotgun-grip',[0,-.13,-.04],[.105,.22,.115],stock);g.rotation.x=-.3;
      profile(root,'shotgun-receiver',[0,0,.055],[[-.115,.14,.13],[-.065,.235,.145],[.08,.235,.135],[.12,.21,.11]],gunmetal);
      piece(root,'receiver-inlay',[.119,0,.06],[.008,.06,.11],coated);
      for(const side of [-1,1])tube(root,'hinge-pin',[side*.122,-.025,.11],.012,.037,coated).rotation.set(0,0,Math.PI/2);
      // Three narrow sides leave the trigger guard visibly open.
      piece(root,'trigger-guard-bottom',[0,-.135,.065],[.07,.018,.135],coated);
      piece(root,'trigger-guard-front',[0,-.1,.13],[.07,.075,.018],coated);
      piece(root,'trigger',[0,-.092,.055],[.012,.06,.025],gunmetal);
      piece(root,'top-lever',[.025,.085,-.015],[.045,.018,.13],coated,-.15);
      shotgunBreech=new B.TransformNode('break-action',scene);shotgunBreech.parent=root;shotgunBreech.position.z=.13;
      for(const side of [-1,1]){
        tube(shotgunBreech,'shotgun-barrel',[side*.063,0,.36],.72,.112,gunmetal,.096);
        tube(shotgunBreech,'shotgun-muzzle-ring',[side*.063,0,.713],.025,.105,coated);
        tube(shotgunBreech,'shotgun-bore',[side*.063,0,.728],.004,.079,materials.black);
      }
      profile(shotgunBreech,'fore-end',[0,-.064,.23],[[-.16,.13,.065],[-.1,.195,.105],[.1,.18,.09],[.17,.12,.05]],stock);
      for(let i=0;i<5;i++)piece(shotgunBreech,'fore-end-rib',[0,-.107,.13+i*.038],[.16,.012,.009],grip);
      piece(shotgunBreech,'barrel-rib',[0,.045,.35],[.018,.02,.69],coated);
      oval(shotgunBreech,'bead-sight',[0,.062,.67],[.018,.018,.018],materials.glow);
      hand(root,-.055,-.135,.35,true);
    } else if(name==='sniper') {
      profile(root,'sniper-chassis',[0,-.025,.12],[[-.3,.115,.13],[-.18,.15,.14],[.22,.135,.12],[.43,.085,.08]],coated);
      tube(root,'receiver',[0,.045,.14],.42,.105,gunmetal);
      tube(root,'barrel',[0,.045,.71],.65,.058,gunmetal,.045);
      tube(root,'muzzle-brake',[0,.045,1.04],.13,.077,coated);
      tube(root,'muzzle-opening',[0,.045,1.107],.003,.043,materials.black);
      for(let i=0;i<3;i++)piece(root,'brake-port',[.039,.045,1+i*.033],[.006,.025,.019],materials.black);
      profile(root,'stock',[0,-.065,-.285],[[-.23,.105,.2,-.025],[-.17,.115,.18],[-.03,.075,.1],[.09,.105,.12]],grip);
      piece(root,'cheek-rest',[0,.025,-.35],[.125,.075,.21],coated);
      piece(root,'butt-pad',[0,-.08,-.52],[.115,.205,.032],coated);
      const g=piece(root,'grip',[0,-.155,-.07],[.095,.22,.1],grip);g.rotation.x=-.27;
      piece(root,'trigger-guard',[0,-.115,.055],[.075,.018,.15],gunmetal);
      piece(root,'trigger',[0,-.075,.035],[.014,.065,.025],gunmetal);
      piece(root,'scope-rail',[0,.12,.13],[.065,.03,.38],coated);
      for(const z of [-.01,.27]){piece(root,'scope-mount',[0,.17,z],[.055,.075,.045],gunmetal);tube(root,'scope-ring',[0,.225,z],.043,.132,gunmetal);}
      tube(root,'scope-tube',[0,.225,.13],.5,.106,coated);
      tube(root,'scope-objective',[0,.225,.36],.14,.107,coated,.162);
      tube(root,'scope-front-glass',[0,.225,.432],.003,.14,lens);
      tube(root,'scope-eyepiece',[0,.225,-.15],.11,.138,coated);
      tube(root,'scope-rear-glass',[0,.225,-.207],.003,.114,lens);
      const dial=tube(root,'scope-turret',[0,.303,.12],.065,.062,gunmetal);dial.rotation.x=0;
      piece(root,'bolt-handle',[.105,.035,-.015],[.13,.023,.026],gunmetal,-.23);
      oval(root,'bolt-knob',[.167,.015,-.015],[.055,.055,.055],coated);
      profile(root,'magazine',[0,-.15,.2],[[-.07,.09,.2],[.055,.1,.21],[.08,.08,.18]],gunmetal);
      for(let i=0;i<4;i++)piece(root,'handguard-vent',[.071,-.013,.28+i*.045],[.008,.035,.023],materials.black);
      hand(root,-.075,-.12,.37,true);
    } else {
      profile(root,'knife-handle',[0,-.02,.035],[[-.13,.06,.065],[-.09,.075,.075],[.08,.067,.07],[.12,.055,.06]],grip);
      for(let i=0;i<6;i++)piece(root,'grip-wrap',[0,-.02,-.06+i*.03],[.077,.077,.012],coated);
      piece(root,'knife-pommel',[0,-.02,-.103],[.075,.08,.025],gunmetal);
      piece(root,'knife-guard',[0,-.015,.17],[.15,.055,.03],gunmetal);
      profile(root,'knife-blade',[0,-.015,.18],[[0,.11,.022],[.21,.09,.018],[.37,.002,.002]],gunmetal);
      profile(root,'blade-ridge',[0,-.002,.19],[[0,.024,.008],[.2,.019,.006],[.345,.001,.001]],materials.white);
    }
  }
  scene.setRenderingAutoClearDepthStencil(2,true,true,true);
}
function moveBody(body, dx, dz, radius, feet = 0) {
  // Small substeps prevent tunnelling through cover when sprinting or during a long frame.
  const count = Math.max(1,Math.ceil(Math.hypot(dx,dz)/.18));
  for(let step=0;step<count;step++) {
    body.x = Math.max(-19.8,Math.min(19.8,body.x+dx/count));
    body.z = Math.max(-22.6,Math.min(22.6,body.z+dz/count));
    for(const o of obstacles) {
      if(feet >= o.top-.04) continue;
      const nx=Math.max(o.x-o.w/2,Math.min(body.x,o.x+o.w/2)), nz=Math.max(o.z-o.d/2,Math.min(body.z,o.z+o.d/2));
      const ax=body.x-nx,az=body.z-nz,dist=Math.hypot(ax,az);
      if(dist<radius && dist>.00001){body.x=nx+ax/dist*radius;body.z=nz+az/dist*radius;}
      else if(dist<=.00001){const choices=[{v:Math.abs(body.x-(o.x-o.w/2)),x:o.x-o.w/2-radius},{v:Math.abs(body.x-(o.x+o.w/2)),x:o.x+o.w/2+radius},{v:Math.abs(body.z-(o.z-o.d/2)),z:o.z-o.d/2-radius},{v:Math.abs(body.z-(o.z+o.d/2)),z:o.z+o.d/2+radius}].sort((a,b)=>a.v-b.v);if(choices[0].x!==undefined)body.x=choices[0].x;else body.z=choices[0].z;}
    }
  }
}
function pickCombat(ray) {
  return pickVisibleCombat(B,scene,ray,combatIndex);
}
function tracer(from,to,color='#ffe3ab',life=.075) {
  const mesh=B.MeshBuilder.CreateLines('tracer',{points:[from,to]},scene);mesh.color=B.Color3.FromHexString(color);mesh.isPickable=false;effects.push({mesh,life,max:life});
}
function sparks(pos,count=8,red=false) {
  for(let i=0;i<count;i++){
    const size=.035+Math.random()*(red?.16:.04),mesh=B.MeshBuilder.CreateBox('fragment',{size},scene);mesh.position.copyFrom(pos);mesh.material=red?materials.red:materials.ivory;mesh.isPickable=false;
    effects.push({mesh,life:red?1.2:.35,max:red?1.2:.35,velocity:new B.Vector3((Math.random()-.5)*6,Math.random()*5+1,(Math.random()-.5)*6),spin:Math.random()*8});
  }
}
function notice(title,sub='',duration=1.8) { $('toast').replaceChildren();const t=document.createElement('span');t.textContent=title;$('toast').append(t);if(sub){const s=document.createElement('small');s.textContent=sub;$('toast').append(s);}toastTime=duration; }
function hitBot(damage,head=false,source='') {
  if(roundDelay>0||mode!=='playing'||exploring)return;
  hitCount++;bot.hp=Math.max(0,bot.hp-damage);hitTime=.18;sound('hit');
  if(bot.hp<=0){kills++;sparks(new B.Vector3(bot.x,(bot.y||0)+1.1,bot.z),28,true);botRoot.setEnabled(false);sound('kill');finishRound(true,head?'HEADSHOT':source==='knife'?'KNIFE ELIMINATION':'BOT ELIMINATED');}
  else notice(head?'HEADSHOT':`${damage} DAMAGE`,`${bot.hp} HP REMAINING`,.7);
}
function shotgunFalloff(distance) {
  if(distance>=40)return 0;
  if(distance<=5)return 1;
  if(distance>=25)return .05*(40-distance)/15;
  return .05+.95*Math.pow(1-(distance-5)/20,2);
}
function fireShotgun(config, direction, muzzle) {
  const right=camera.getDirection(B.Axis.X),up=camera.getDirection(B.Axis.Y),phase=Math.random()*Math.PI*2;
  let damage=0;
  for(let i=0;i<config.pellets;i++) {
    // Evenly distributed pellets with a random rotation: no lucky all-centre clusters.
    const radius=Math.sqrt((i+.5)/config.pellets)*config.spread,angle=i*2.3999632297+phase;
    const pellet=direction.add(right.scale(Math.cos(angle)*radius)).add(up.scale(Math.sin(angle)*radius)).normalize();
    const hit=pickCombat(new B.Ray(camera.position.clone(),pellet,config.range));
    tracer(muzzle,hit?.hit?hit.pickedPoint:camera.position.add(pellet.scale(config.range)),'#ffd49a',.06);
    if(hit?.hit){const isBot=!!hit.pickedMesh.metadata?.bot;if(isBot)damage+=config.damage*shotgunFalloff(hit.distance);sparks(hit.pickedPoint,2,isBot);}
  }
  // Aggregate all pellets before settling the shot: one hit statistic and one round award.
  if(damage>=.5)hitBot(Math.round(damage),false,'shotgun');
}
function setAiming(value) {
  if(!value)sniperReleaseArmed=false;
  if(aiming!==value){sniperStableTime=0;sniperScopeTime=0;}
  aiming=value;
  if(value)beginSniperHover();else sniperHoverTime=0;
}
function playerAirborne(){return physics?!playerActor.grounded:player.y>.05||Math.abs(player.vy)>.1;}
function sniperHoverActive(){return sniperHoverTime>0&&weapon==='sniper'&&aiming&&reloadTime<=0&&roundDelay<=0&&mode==='playing'&&playerAirborne();}
function beginSniperHover(){
  if(sniperHoverUsed||weapon!=='sniper'||!aiming||!playerAirborne()||reloadTime>0||roundDelay>0||mode!=='playing')return;
  sniperHoverUsed=true;sniperHoverTime=WEAPONS.sniper.hoverDuration;
  player.vx=player.vz=player.vy=0;
  if(playerActor)playerActor.vy=0;
}
function resetSniperHover(){sniperHoverTime=0;sniperHoverUsed=false;}
function sniperStatus(){return sniperHoverActive()?`HOVER ${sniperHoverTime.toFixed(2)}s · +50% DAMAGE TAKEN`:sniperMoving()?'MOVING':sniperStableTime<WEAPONS.sniper.settleTime?'SETTLING':'STEADY';}
function damagePlayer(amount){
  if(exploring||roundDelay>0||mode!=='playing'||player.hp<=0)return;
  const damage=amount*(sniperHoverActive()?WEAPONS.sniper.hoverDamageMultiplier:1);
  player.hp=Math.max(0,player.hp-damage);damageTime=.24;sound('hurt');updateHUD();
  if(player.hp<=0)finishRound(false,'ELIMINATED BY BOT');
}
function sniperMoving() {
  if(sniperHoverActive())return false;
  return Math.hypot(player.vx,player.vz)>.15 || Math.abs(player.vy)>.1 || ['KeyW','KeyA','KeyS','KeyD','Space'].some(key=>keys.has(key));
}
function updateSniperStability(dt) {
  // Damage timing measures the whole scope hold, independently of accuracy.
  // Moving then stopping cannot restart the one-shot window.
  if(weapon==='sniper'&&aiming)sniperScopeTime+=dt;
  else sniperScopeTime=0;
  // Scope alignment progresses while moving; movement adds its own spread.
  // Stopping must not start another full scope-in penalty.
  if(weapon==='sniper'&&aiming&&reloadTime<=0&&roundDelay<=0)sniperStableTime=Math.min(WEAPONS.sniper.settleTime,sniperStableTime+dt);
  else sniperStableTime=0;
}
function sniperPowerActive(){return weapon==='sniper'&&aiming&&sniperScopeTime<WEAPONS.sniper.powerWindow;}
function sniperDamage(head){
  const config=WEAPONS.sniper;
  return sniperPowerActive()?(head?config.head:config.damage):(head?config.heldHead:config.heldDamage);
}
function sniperDamageLabel(){return sniperPowerActive()?`HEAD 100 · ${(WEAPONS.sniper.powerWindow-sniperScopeTime).toFixed(2)}s`:'HEAD 95';}
function sniperSpread() {
  const config=WEAPONS.sniper;
  const base=aiming?.06*(1-Math.min(1,sniperStableTime/config.settleTime)):config.hipSpread;
  return base+(sniperMoving()?config.moveSpread:0);
}
function sniperShotDirection(forward, random=Math.random) {
  const spread=sniperSpread();
  if(spread===0)return forward;
  const radius=Math.sqrt(random())*spread,angle=random()*Math.PI*2;
  return forward.add(camera.getDirection(B.Axis.X).scale(Math.cos(angle)*radius)).add(camera.getDirection(B.Axis.Y).scale(Math.sin(angle)*radius)).normalize();
}
function fire() {
  if(mode!=='playing'||roundDelay>0||cooldown>0||reloadTime>0)return;
  if(weapon==='knife'){stabKnife();return;}
  const config=WEAPONS[weapon];if(ammo[weapon]<=0){reload();return;}
  if(weapon==='sniper')sniperReleaseArmed=false;
  ammo[weapon]--;shotCount++;cooldown=config.interval;recoil=weapon==='sniper'?.12:.16;sound(weapon);
  let direction=camera.getForwardRay().direction;
  const muzzle=camera.position.add(direction.scale(.8)).add(new B.Vector3(Math.cos(yaw)*.2,-.12,-Math.sin(yaw)*.2));
  if(weapon==='shotgun'){fireShotgun(config,direction,muzzle);updateHUD();return;}
  direction=sniperShotDirection(direction);
  const ray=new B.Ray(camera.position.clone(),direction,100);
  const hit=pickCombat(ray);
  const end=hit?.hit?hit.pickedPoint:camera.position.add(direction.scale(80));
  tracer(muzzle,end);
  if(hit?.hit){if(hit.pickedMesh.metadata?.bot){const head=hit.pickedMesh.metadata.head;hitBot(sniperDamage(head),head);sparks(end,6,true);}else sparks(end,5);}
  updateHUD();
}
function stabKnife() {
  if(knifeReturn>0){notice('KNIFE RETURNING',`${knifeReturn.toFixed(1)} SECONDS`,.6);return;}
  cooldown=.55;stabTime=.38;stabBob=bob;shotCount++;sound('knife');
  const hit=pickCombat(new B.Ray(camera.position.clone(),camera.getForwardRay().direction,2.7));
  if(hit?.hit&&hit.pickedMesh.metadata?.bot){hitBot(65,false,'knife');sparks(hit.pickedPoint,8,true);}
}
function throwKnife() {
  if(mode!=='playing'||roundDelay>0||knifeReturn>0||cooldown>0||reloadTime>0)return;
  knifeReturn=3;cooldown=.45;stabTime=0;shotCount++;sound('knife');
  const mesh=B.MeshBuilder.CreateCylinder('thrown-knife',{height:.55,diameterTop:0,diameterBottom:.13,tessellation:3},scene);mesh.material=materials.white;mesh.isPickable=false;
  mesh.position.copyFrom(camera.position.add(camera.getForwardRay().direction.scale(.5)));mesh.rotation.x=Math.PI/2;
  const velocity=camera.getForwardRay().direction.scale(31);velocity.y+=1.3;
  knives.push({mesh,velocity,life:3});updateHUD();
}
function reload() {
  if(mode!=='playing'||roundDelay>0||weapon==='knife'||reloadTime>0||ammo[weapon]===WEAPONS[weapon].capacity)return;
  reloadTime=WEAPONS[weapon].reload;setAiming(false);sound('reload');updateHUD();
}
function switchWeapon(next) {
  if(next===weapon)return;weapon=next;stabTime=0;reloadTime=0;setAiming(false);cooldown=Math.max(cooldown,.2);updateHUD();
}
function updateHUD() {
  $('health').textContent=Math.ceil(player.hp);$('health-fill').style.width=`${player.hp}%`;
  $('health-fill').style.background=player.hp<35?'#f45950':'white';
  $('player-score').textContent=playerScore;$('bot-score').textContent=botScore;$('round-number').textContent=`ROUND ${String(round).padStart(2,'0')}`;
  $('traversal').hidden=!exploring;$('traversal').textContent=`EXPLORATION · ${playerActor?.grounded?'GROUNDED':'AIRBORNE'} · ${player.crouched?'CROUCHED':'STANDING'} · HEIGHT ${(player.y+6).toFixed(1)}m · BOT ROUTE ${bot.path?.length||0} STEPS · ${Math.round(engine.getFps())} FPS`;
  $('timer').textContent=exploring?'∞':`${Math.floor(Math.ceil(roundTime)/60)}:${String(Math.ceil(roundTime)%60).padStart(2,'0')}`;
  $('weapon-name').textContent=WEAPONS[weapon].name;
  $('ammo').textContent=weapon==='knife'?(knifeReturn>0?knifeReturn.toFixed(1):'01'):ammo[weapon];
  $('ammo-reserve').textContent=weapon==='knife'?(knifeReturn>0?'SEC':'/ 01'):'/ ∞';
  $('weapon-hint').textContent=reloadTime>0?'RELOADING…':weapon==='knife'?'LMB STAB · RMB THROW':weapon==='sniper'?(aiming?`${sniperStatus()} · ${sniperDamageLabel()} · RELEASE RMB TO FIRE`:'HIP-FIRE · HEAD 95 · LOW ACCURACY'):'R RELOAD · HOLD RMB AIM';
  document.querySelectorAll('[data-slot]').forEach(el=>el.classList.toggle('active',el.dataset.slot===weapon));
  for(const [name,root] of Object.entries(gunModels))root.setEnabled(name===weapon && !(name==='knife'&&knifeReturn>0));
}
function clearEffects() {effects.splice(0).forEach(e=>e.mesh.dispose());knives.splice(0).forEach(k=>k.mesh.dispose());}
function resetRound() {
  resetSniperHover();
  clearEffects();Object.assign(player,{x:0,z:-16,y:0,vy:0,hp:100,vx:0,vz:0,crouched:false});yaw=0;pitch=0;recoil=0;stabTime=0;
  if(physics){Object.assign(player,spawnPlayer);physics.teleport(playerActor,spawnPlayer);}
  Object.assign(bot,{x:0,z:12,hp:100,fire:2.6,ai:0,waypoint:0});if(physics){Object.assign(bot,spawnBot,{path:[],repath:0,patrol:-1});physics.teleport(botActor,spawnBot);}botRoot.position.set(bot.x,bot.y||0,bot.z);botRoot.setEnabled(true);
  ammo={shotgun:2,sniper:5};reloadTime=0;knifeReturn=0;cooldown=.35;setAiming(false);roundTime=60;roundDelay=0;
  weapon=selected;notice(exploring?'EXPLORE RUST':`ROUND ${String(round).padStart(2,'0')}`,exploring?'NO DAMAGE · BOT PATROLS · T TO RESET POSITION':'FIRST TO 5 ROUNDS',3);updateHUD();
}
async function lockMouse() {
  try{await canvas.requestPointerLock();pointerFallback=false;}catch{pointerFallback=true;notice('DRAG TO LOOK','MOUSE CAPTURE UNAVAILABLE · CLICK TO FIRE · WASD TO MOVE',4);}
}
function startMatch(explore=false) {
  exploring=explore===true;
  mode='playing';playerScore=0;botScore=0;round=1;shotCount=0;hitCount=0;kills=0;keys.clear();
  $('lobby').hidden=true;$('hud').hidden=false;['result-modal','pause-modal','controls-modal','settings-modal'].forEach(id=>$(id).hidden=true);
  camera.fov=1.2;gunRoot.setEnabled(true);resetRound();sound('reload');lockMouse();
}
function finishRound(won,reason,draw=false) {
  if(roundDelay>0)return;
  if(!draw){if(won)playerScore++;else botScore++;}
  roundDelay=2.4;setAiming(false);keys.clear();updateHUD();
  notice(draw?'ROUND DRAW':won?'ROUND WON':'ROUND LOST',reason,2.4);
}
function endMatch() {
  mode='result';document.exitPointerLock?.();$('result-modal').hidden=false;$('toast').textContent='';
  $('result-title').textContent=playerScore>=5?'YOU WON':'YOU LOST';
  $('result-score').textContent=`${playerScore} — ${botScore}`;
  $('result-detail').textContent=`${kills} eliminations · ${shotCount?Math.round(hitCount/shotCount*100):0}% hit rate · ${settings.difficulty==='rookie'?'Easy':'Hard'} opponent`;
}
function pause() {
  if(mode!=='playing')return;mode='paused';setAiming(false);dragging=false;keys.clear();$('pause-modal').hidden=false;document.exitPointerLock?.();
}
function resume() {if(mode!=='paused')return;mode='playing';$('pause-modal').hidden=true;keys.clear();lockMouse();}
function lobby() {
  mode='lobby';keys.clear();setAiming(false);document.exitPointerLock?.();$('lobby').hidden=false;$('hud').hidden=true;$('pause-modal').hidden=true;$('result-modal').hidden=true;gunRoot.setEnabled(false);botRoot.setEnabled(true);botRoot.position.set(spawnBot?.x||0,spawnBot?.y||0,spawnBot?.z||7);botRoot.rotation.y=-.45;clearEffects();
}
function stopReleasedMovement() {
  // No input means an immediate horizontal stop, including after sprinting.
  // Remove released local axes before acceleration so diagonal releases don't drift.
  let localForward=player.vx*Math.sin(yaw)+player.vz*Math.cos(yaw);
  let localSide=player.vx*Math.cos(yaw)-player.vz*Math.sin(yaw);
  if(keys.has('KeyW')===keys.has('KeyS'))localForward=0;
  if(keys.has('KeyA')===keys.has('KeyD'))localSide=0;
  player.vx=localForward*Math.sin(yaw)+localSide*Math.cos(yaw);
  player.vz=localForward*Math.cos(yaw)-localSide*Math.sin(yaw);
}
function playerStep(dt) {
  if(!playerAirborne())resetSniperHover();
  beginSniperHover();
  const hovering=sniperHoverActive();
  let forward=(keys.has('KeyW')?1:0)-(keys.has('KeyS')?1:0),side=(keys.has('KeyD')?1:0)-(keys.has('KeyA')?1:0);
  const length=Math.hypot(forward,side);if(length>0){forward/=length;side/=length;}
  player.crouched=physics?physics.crouch(playerActor,keys.has('KeyC')):keys.has('KeyC');
  const baseSpeed=aiming?(weapon==='sniper'?1.8:3.3):keys.has('ShiftLeft')||keys.has('ShiftRight')?9.2:6.5;
  const speed=player.crouched?Math.min(2.1,baseSpeed):baseSpeed;
  const tx=(Math.sin(yaw)*forward+Math.cos(yaw)*side)*speed,tz=(Math.cos(yaw)*forward-Math.sin(yaw)*side)*speed;
  stopReleasedMovement();
  const accel=1-Math.exp(-dt*((physics?!playerActor.grounded:player.y>.05)?7:28));player.vx+=(tx-player.vx)*accel;player.vz+=(tz-player.vz)*accel;
  // Apply as soon as aiming begins; sprint momentum cannot bypass scoped movement.
  const horizontalSpeed=Math.hypot(player.vx,player.vz);
  if((aiming||player.crouched)&&horizontalSpeed>speed){player.vx*=speed/horizontalSpeed;player.vz*=speed/horizontalSpeed;}
  if(hovering)player.vx=player.vz=player.vy=0;
  if(physics){
    physics.move(playerActor,player.vx*dt,player.vz*dt,dt,keys.has('Space'),hovering);keys.delete('Space');
    Object.assign(player,{x:playerActor.x,y:playerActor.y,z:playerActor.z,vy:playerActor.vy});
    if(player.y< -15||Math.abs(player.x)>62||Math.abs(player.z)>62){physics.teleport(playerActor,spawnPlayer);Object.assign(player,spawnPlayer,{vx:0,vz:0,vy:0});resetSniperHover();notice('OUT OF BOUNDS','POSITION RESET',1);}
  }else{
  if(!hovering&&keys.has('Space')&&!playerAirborne()){player.vy=7;player.y+=.001;keys.delete('Space');}
  const previousY=player.y;if(!hovering){player.vy-=20*dt;player.y+=player.vy*dt;}else keys.delete('Space');
  // Landing on low cover is supported, with the same collider heights used for movement.
  let support=0;for(const o of obstacles)if(Math.abs(player.x-o.x)<o.w/2+.2&&Math.abs(player.z-o.z)<o.d/2+.2&&previousY>=o.top-.05&&player.y<o.top)support=Math.max(support,o.top);
  if(player.y<=support){player.y=support;player.vy=0;}
  moveBody(player,player.vx*dt,player.vz*dt,.37,player.y);
  }
  if(!playerAirborne())resetSniperHover();
  else if(hovering)sniperHoverTime=sniperHoverTime-dt<1e-6?0:sniperHoverTime-dt;
  else beginSniperHover();
  bob+=dt*Math.hypot(player.vx,player.vz)*1.6;
  camera.position.set(player.x,player.y+(player.crouched?.85:1.68),player.z);camera.rotation.set(pitch-recoil*.12,yaw,0);
  updateSniperStability(dt);
}
const waypoints=[[0,10],[-4,13],[-12,14],[-13,4],[-11,-2],[-3,-4],[0,3],[5,5],[12,14],[13,2],[12,-13],[3,-13],[0,-4]];
function botStep(dt) {
  if(bot.hp<=0)return;
  const previousX=bot.x,previousZ=bot.z;
  const hard=settings.difficulty==='duelist';
  const origin=new B.Vector3(bot.x,(bot.y||0)+1.48,bot.z),target=new B.Vector3(player.x,player.y+(player.crouched?.55:1.1),player.z),delta=target.subtract(origin),distance=delta.length();
  const visible=physics?!physics.world.castRay(new physics.R.Ray(origin,delta.normalize()),distance,true,undefined,undefined,undefined,undefined,c=>c.handle===physics.terrain.handle):!scene.pickWithRay(new B.Ray(origin,delta.normalize(),distance),m=>!!m.metadata?.world)?.hit;
  if(physics){
    bot.repath-=dt;
    if(bot.repath<=0||!bot.path?.length){
      const start=nearestNode(nav,bot);
      if(exploring){if(!bot.path?.length)bot.patrol=((bot.patrol??-1)+1)%patrolGoals.length;bot.goal=patrolGoals[bot.patrol];}
      else bot.goal=nearestNode(nav,player);
      bot.path=findPath(nav,start,bot.goal);bot.repath=exploring?12:2;
    }
    const n=nav[bot.path?.[0]];let dx=0,dz=0;
    if(n){const length=Math.hypot(n[0]-bot.x,n[2]-bot.z);if(length<.13&&Math.abs(bot.y-n[1])<.5)bot.path.shift();else{const speed=Math.min(hard?3.9:2.8,length/dt);dx=(n[0]-bot.x)/(length||1)*speed*dt;dz=(n[2]-bot.z)/(length||1)*speed*dt;}}
    physics.move(botActor,dx,dz,dt);Object.assign(bot,{x:botActor.x,y:botActor.y,z:botActor.z});
    if(bot.y< -15){physics.teleport(botActor,spawnBot);Object.assign(bot,spawnBot,{path:[]});}
  }
  botRoot.position.set(bot.x,bot.y||0,bot.z);botRoot.rotation.y=Math.atan2(player.x-bot.x,player.z-bot.z);
  const travelled=Math.hypot(bot.x-previousX,bot.z-previousZ);
  bot.stride=(bot.stride||0)+travelled*3.5;
  bot.legs.forEach((leg,i)=>leg.rotation.x=travelled>.0001?Math.sin(bot.stride+i*Math.PI)*.32:0);
  bot.fire-=dt;
  if(!exploring&&visible&&distance<35&&bot.fire<=0){
    bot.fire=hard?.65+Math.random()*.35:1.05+Math.random()*.7;
    const hit=Math.random()<(hard?.61:.36),from=new B.Vector3(bot.x,(bot.y||0)+1.2,bot.z);
    tracer(from,hit?target:target.add(new B.Vector3((Math.random()-.5)*3,1.2,0)),'#f24d3d',.14);
    if(hit)damagePlayer(hard?19:13);
  }
}
function effectStep(dt) {
  for(let i=effects.length-1;i>=0;i--){const e=effects[i];e.life-=dt;if(e.life<=0){e.mesh.dispose();effects.splice(i,1);continue;}if(e.velocity){e.velocity.y-=12*dt;e.mesh.position.addInPlace(e.velocity.scale(dt));e.mesh.rotation.x+=e.spin*dt;e.mesh.rotation.z+=e.spin*.6*dt;if(e.mesh.position.y<.03){e.mesh.position.y=.03;e.velocity.scaleInPlace(.4);e.velocity.y=Math.abs(e.velocity.y);}}e.mesh.visibility=Math.min(1,e.life*4);}
  for(let i=knives.length-1;i>=0;i--){const k=knives[i];k.life-=dt;k.velocity.y-=5*dt;const step=k.velocity.scale(dt),length=step.length();const hit=pickCombat(new B.Ray(k.mesh.position.clone(),step.normalize(),length+.15));
    if(hit?.hit){sparks(hit.pickedPoint,8,!!hit.pickedMesh.metadata?.bot);if(hit.pickedMesh.metadata?.bot)hitBot(100,!!hit.pickedMesh.metadata.head,'knife');k.life=0;}
    if(k.life<=0){k.mesh.dispose();knives.splice(i,1);}else{k.mesh.position.addInPlace(k.velocity.scale(dt));k.mesh.rotation.x+=dt*20;k.mesh.rotation.y=yaw;}
  }
}
function updateWeaponPose() {
  const knife=weapon==='knife';
  const stabbing=knife&&knifeReturn===0&&stabTime>0;
  // Keep the starting grip angle and height; only translate down the blade's axis.
  const poseBob=stabbing?stabBob:bob;
  let thrust=0;
  if(stabbing){
    const elapsed=.38-stabTime;
    const phase=Math.max(0,Math.min(1,elapsed<.09?elapsed/.09:(.38-elapsed)/.29));
    thrust=.42*phase*phase*(3-2*phase);
  }
  const kick=knife?0:recoil;
  gunRoot.position.set(aiming?.04:.32,-.3+Math.sin(poseBob)*.009-kick*.4-(reloadTime>0?.25:0),.55-kick+thrust);
  gunRoot.rotation.set(-kick*2+(reloadTime>0?.65:0),0,Math.sin(poseBob*.5)*.015);
}
function step() {
  const dt=Math.min(engine.getDeltaTime()/1000,.05);time+=dt;
  if(mode==='lobby') {
    camera.position.set(38+Math.sin(time*.08)*1.2,17,-35);camera.setTarget(new B.Vector3(5,-1,22));camera.fov=.95;
    botRoot.position.y=(spawnBot?.y||0)+Math.sin(time*1.5)*.025;bot.legs.forEach(l=>l.rotation.x=0);
  } else if(mode==='playing') {
    if(roundDelay>0){roundDelay-=dt;effectStep(dt);if(roundDelay<=0){if(playerScore>=5||botScore>=5)endMatch();else{round++;resetRound();}}}
    else {playerStep(dt);botStep(dt);effectStep(dt);if(!exploring)roundTime=Math.max(0,roundTime-dt);if(!exploring&&roundTime<=0)finishRound(player.hp>bot.hp,'TIME LIMIT · HIGHER HEALTH WINS',player.hp===bot.hp);}
    cooldown=Math.max(0,cooldown-dt);knifeReturn=Math.max(0,knifeReturn-dt);
    if(reloadTime>0){reloadTime-=dt;if(reloadTime<=0){ammo[weapon]=WEAPONS[weapon].capacity;reloadTime=0;sound('reload');}}
    recoil*=Math.exp(-dt*13);stabTime=Math.max(0,stabTime-dt);hitTime=Math.max(0,hitTime-dt);damageTime=Math.max(0,damageTime-dt);
    if(toastTime>0){toastTime-=dt;if(toastTime<=0)$('toast').textContent='';}
    const scope=aiming&&weapon==='sniper'&&reloadTime===0&&roundDelay<=0;
    const targetFov=scope?.32:aiming?.93:1.2;camera.fov+=(targetFov-camera.fov)*(1-Math.exp(-dt*18));
    $('scope').style.display=scope?'flex':'none';$('crosshair').style.display=scope?'none':'block';gunRoot.setEnabled(!scope);
    $('crosshair').style.transform=`translate(-50%,-50%) scale(${weapon==='sniper'?1+Math.min(.4,sniperSpread()*1.5):1})`;
    $('scope-status').textContent=`4× / ${sniperStatus()} · ${sniperDamageLabel()}`;
    $('scope-status').style.color=sniperHoverActive()?'#ffcc88':sniperSpread()>0?'#ff9c94':sniperPowerActive()?'#7ee9ed':'#f2f1e9';
    updateWeaponPose();
    if(shotgunBreech)shotgunBreech.rotation.x=weapon==='shotgun'&&reloadTime>0?Math.sin(reloadTime/WEAPONS.shotgun.reload*Math.PI)*.65:0;
    $('hit-marker').style.opacity=hitTime>0?'1':'0';$('damage-flash').style.opacity=String(damageTime/.24);
    updateHUD();
  }
  scene.render();
}
function bindUI() {
  document.querySelectorAll('[data-theme-choice]').forEach(el=>el.onclick=()=>setMapTheme(el.dataset.themeChoice));
  $('play').onclick=()=>startMatch(false);$('explore').onclick=()=>startMatch(true);$('rematch').onclick=startMatch;$('resume').onclick=resume;$('leave').onclick=lobby;$('result-leave').onclick=lobby;$('pause-button').onclick=pause;
  $('settings-open').onclick=()=>{$('settings-modal').hidden=false;};$('controls-open').onclick=()=>{$('controls-modal').hidden=false;};$('pause-settings').onclick=()=>{$('pause-modal').hidden=true;$('settings-modal').hidden=false;};
  document.querySelectorAll('[data-close]').forEach(el=>el.onclick=()=>{el.closest('.modal-backdrop').hidden=true;if(mode==='paused')$('pause-modal').hidden=false;});
  document.querySelectorAll('.modal-backdrop').forEach(el=>el.addEventListener('click',e=>{if(e.target===el&&['settings-modal','controls-modal'].includes(el.id)){el.hidden=true;if(mode==='paused')$('pause-modal').hidden=false;}}));
  document.querySelectorAll('[data-weapon]').forEach(el=>el.onclick=()=>{selected=el.dataset.weapon;document.querySelectorAll('[data-weapon]').forEach(b=>b.classList.toggle('selected',b===el));});
  $('sensitivity').value=settings.sensitivity;$('sensitivity-value').value=Number(settings.sensitivity).toFixed(1);$('difficulty').value=settings.difficulty;$('sound').checked=settings.sound;
  for(const id of ['sensitivity','difficulty','sound'])$(id).addEventListener('input',()=>{settings={sensitivity:Number($('sensitivity').value),difficulty:$('difficulty').value,sound:$('sound').checked};$('sensitivity-value').value=settings.sensitivity.toFixed(1);try{localStorage.setItem('shatter-settings',JSON.stringify(settings));}catch{}});
  document.addEventListener('keydown',e=>{
    if(e.code==='Escape'){if(mode==='playing')pause();else if(!$('settings-modal').hidden||!$('controls-modal').hidden){$('settings-modal').hidden=true;$('controls-modal').hidden=true;if(mode==='paused')$('pause-modal').hidden=false;}return;}
    if(mode!=='playing')return;
    if(['Space','KeyC','ArrowUp','ArrowDown','Tab'].includes(e.code))e.preventDefault();if(e.code==='Space'&&e.repeat)return;keys.add(e.code);
    if(e.repeat)return;if(e.code==='KeyT'&&exploring){physics.teleport(playerActor,spawnPlayer);Object.assign(player,spawnPlayer,{vx:0,vz:0,vy:0});resetSniperHover();}if(e.code==='Digit1')switchWeapon('shotgun');if(e.code==='Digit2')switchWeapon('sniper');if(e.code==='Digit3')switchWeapon('knife');if(e.code==='KeyR')reload();if(e.code==='KeyQ')throwKnife();
  });
  document.addEventListener('keyup',e=>{keys.delete(e.code);stopReleasedMovement();});
  document.addEventListener('mousemove',e=>{const locked=document.pointerLockElement===canvas;if(mode==='playing'&&(locked||(pointerFallback&&dragging))){const scale=.002*settings.sensitivity*(aiming&&weapon==='sniper'?.3:1),dx=locked?e.movementX:e.clientX-lastMouseX,dy=locked?e.movementY:e.clientY-lastMouseY;yaw+=dx*scale;pitch=Math.max(-1.45,Math.min(1.45,pitch+dy*scale));}lastMouseX=e.clientX;lastMouseY=e.clientY;});
  canvas.addEventListener('mousedown',e=>{
    if(mode!=='playing')return;
    if(document.pointerLockElement!==canvas&&!pointerFallback){lockMouse();return;}
    dragging=true;lastMouseX=e.clientX;lastMouseY=e.clientY;
    const secondary=e.button===2||(e.button===0&&e.ctrlKey);
    if(secondary){
      secondaryPressButton=e.button;
      if(e.button===0)mouseFireHandled=true; // macOS Control-click is secondary input.
      if(weapon==='knife')throwKnife();else{setAiming(true);sniperReleaseArmed=weapon==='sniper';}
    }else if(e.button===0){mouseFireHandled=true;fire();}
  });
  canvas.addEventListener('click',e=>{if(e.button!==0||e.ctrlKey)return;if(mode==='playing'&&!mouseFireHandled&&(pointerFallback||document.pointerLockElement===canvas))fire();mouseFireHandled=false;});
  document.addEventListener('mouseup',e=>{
    dragging=e.buttons>0;
    if(e.button===2||e.button===secondaryPressButton){
      secondaryPressButton=null;
      const releaseShot=sniperReleaseArmed&&aiming&&weapon==='sniper';
      sniperReleaseArmed=false;
      // Evaluate the shot while scope accuracy and damage timing are still active.
      // Left-click firing or cancelling aim consumes this gesture already.
      if(releaseShot)fire();
      setAiming(false);
    }
  });canvas.addEventListener('contextmenu',e=>e.preventDefault());
  canvas.addEventListener('wheel',e=>{if(mode==='playing'){e.preventDefault();const order=['shotgun','sniper','knife'];switchWeapon(order[(order.indexOf(weapon)+(e.deltaY>0?1:2))%3]);}},{passive:false});
  document.addEventListener('pointerlockchange',()=>{if(!document.pointerLockElement&&mode==='playing')pause();});
  window.addEventListener('blur',()=>{keys.clear();if(mode==='playing')pause();});
  window.addEventListener('resize',()=>engine.resize());
}

try {
  if(!B||!B.Engine.isSupported())throw new Error('WebGL is unavailable. Enable hardware acceleration or try Chrome, Edge, Firefox, or Safari on a desktop computer.');
  engine=new B.Engine(canvas,true,{stencil:true,preserveDrawingBuffer:false,powerPreference:'high-performance'});
  engine.setHardwareScalingLevel(Math.max(1,window.devicePixelRatio/1.5));
  scene=new B.Scene(engine);scene.clearColor=new B.Color4(.69,.65,.54,1);scene.ambientColor=new B.Color3(.65,.67,.59);
  scene.fogMode=B.Scene.FOGMODE_EXP2;scene.fogDensity=.005;scene.fogColor=new B.Color3(.69,.65,.54);
  camera=new B.FreeCamera('camera',new B.Vector3(23,16,-24),scene);camera.minZ=.1;camera.maxZ=700;camera.inputs.clear();
  const hemi=new B.HemisphericLight('ambient',new B.Vector3(.2,1,0),scene);hemi.intensity=.8;hemi.groundColor=new B.Color3(.48,.52,.4);
  const sun=new B.DirectionalLight('sun',new B.Vector3(-.65,-1,.5),scene);sun.position.set(12,25,-20);sun.intensity=.85;sun.shadowMinZ=1;sun.shadowMaxZ=80;
  scene.imageProcessingConfiguration.contrast=1.12;scene.imageProcessingConfiguration.exposure=1;
  await buildRust();buildBot();buildGuns();themeRenderer=await createCyberTheme(B,scene,mapSurfaces);setMapTheme(mapTheme);gunRoot.setEnabled(false);bindUI();
  $('loading').hidden=true;engine.runRenderLoop(step);
  // Read-only diagnostics for testing and performance inspection.
  window.shatter={snapshot:()=>({mode,mapTheme,weapon,ammo:{...ammo},player:{x:player.x,y:player.y,z:player.z,hp:player.hp,crouched:player.crouched,grounded:playerActor?.grounded,hovering:sniperHoverActive(),hoverTime:sniperHoverTime},bot:{x:bot.x,y:bot.y,z:bot.z,hp:bot.hp,path:bot.path?.length},exploring,navNodes:nav.length,playerScore,botScore,round,roundTime,knifeReturn,reloadTime,shotCount,hitCount,projectiles:knives.length,meshCount:scene.meshes.length,fps:engine.getFps(),pointerLocked:document.pointerLockElement===canvas})};
} catch(error) {$('loading').hidden=true;$('load-error').hidden=false;$('error-detail').textContent=error.message;console.error(error);}
