import { neonTextures, neonCutouts } from './neon-materials.js';
// Original texture maps and UVs are authoritative. Convert individual assets only.
export async function createCyberTheme(B,scene,entries) {
  const root=new B.TransformNode('neon-district-backdrop',scene);
  const color=B.Color3.FromHexString;
  function texture(name,paint,size=256){
    const t=new B.DynamicTexture(name,{width:size,height:size},scene,true,B.Texture.TRILINEAR_SAMPLINGMODE);
    const ctx=t.getContext();ctx.scale(size/256,size/256);paint(ctx);t.update(false);return t;
  }
  // All original assets have an explicit conversion; shared source images reuse it.
  const conversions=neonTextures;
  const converted=new Map(),ready=[];
  for(const e of entries){
    const source=e.original.diffuseTexture,filename=source?.name.split('/').pop();
    const m=e.original.clone('neon-source-'+e.name);
    m.diffuseColor=B.Color3.White();m.specularColor=B.Color3.Black();
    if(conversions[filename]){
      if(!converted.has(filename)){
        let t;
        ready.push(new Promise((resolve,reject)=>{
          t=new B.Texture('assets/neon/'+conversions[filename],scene,false,false,B.Texture.TRILINEAR_SAMPLINGMODE,resolve,
            ()=>reject(new Error('Unable to load converted texture: '+filename)));
        }));
        // Preserve the original texture's coordinate system and sampling coverage.
        for(const prop of ['wrapU','wrapV','uScale','vScale','uOffset','vOffset','coordinatesIndex'])t[prop]=source[prop];
        t.hasAlpha=false;t.anisotropicFilteringLevel=8;
        converted.set(filename,t);
      }
      m.diffuseTexture=converted.get(filename);
      // Source alpha is the authoritative cutout mask: preserve thin fences,
      // leaves and decal silhouettes exactly, independent of generated RGB.
      m.useAlphaFromDiffuseTexture=false;
      if(source.hasAlpha||neonCutouts.has(filename)){
        m.opacityTexture=source;
        m.transparencyMode=B.Material.MATERIAL_ALPHATEST;
      }
    }
    if(e.name==='mtl_light_sticks_orange_on'){
      m.emissiveTexture=m.diffuseTexture;m.emissiveColor=color('#154450');m.useEmissiveAsIllumination=true;
    }
    e.cyber=m;
  }
  const emissives={};
  for(const [name,hex] of Object.entries({cyan:'#24d9ff',pink:'#e83cd9',amber:'#ffad43',white:'#b5e8ff'})){const m=new B.StandardMaterial(name+'-neon',scene);m.disableLighting=true;m.fogEnabled=false;m.emissiveColor=color(hex);m.diffuseColor=B.Color3.Black();emissives[name]=m;}
  function block(name,x,y,z,w,h,d,m){const mesh=B.MeshBuilder.CreateBox(name,{width:w,height:h,depth:d},scene);mesh.position.set(x,y,z);mesh.material=m;mesh.parent=root;mesh.isPickable=false;return mesh;}
  // Reuse the individually converted low-resolution surfaces at readable scale.
  // Broad ledges, window recesses and service panels break up the tower boxes.
  function facade(source,name,tint,u,v){
    const m=entries.find(e=>e.name===source).cyber.clone(name);
    m.diffuseTexture=m.diffuseTexture.clone();m.diffuseTexture.uScale=u;m.diffuseTexture.vScale=v;
    m.diffuseColor=color(tint);m.specularColor=B.Color3.Black();
    m.opacityTexture=null;m.useAlphaFromDiffuseTexture=false;m.transparencyMode=B.Material.MATERIAL_OPAQUE;
    m.disableDepthWrite=false;m.zOffset=0;m.zOffsetUnits=0;
    return m;
  }
  const facades=[facade('ch_concretewall06','district-concrete','#a6b3b9',1.5,6),
    facade('metal_aluminum_siding_02','district-sheet-metal','#85949f',2,7),
    facade('ch_concretewall06','district-stained-concrete','#9a9390',2,8)];
  const trim=facade('me_metal_rust_03','district-service-metal','#79838b',1,2);
  trim.twoSidedLighting=true;
  const windows=new B.StandardMaterial('district-window-recess',scene);
  windows.diffuseColor=color('#13222b');windows.specularColor=B.Color3.Black();
  const litWindow=new B.StandardMaterial('district-old-fluorescent',scene);
  litWindow.diffuseColor=color('#59666b');litWindow.emissiveColor=color('#243237');litWindow.specularColor=B.Color3.Black();
  // Outside the playable yard: scenery has no collider, pathfinding, or hit targets.
  for(let i=0;i<28;i++){
    const angle=(i/28)*Math.PI*2,r=92+(i%3)*19,x=12+Math.cos(angle)*r,z=20+Math.sin(angle)*r,h=30+(i*17%65),w=10+i%4*3,d=10+i%3*3;
    const wall=facades[i%facades.length];
    block('district-tower',x,h/2-8,z,w,h,d,wall);
    for(const side of [-1,1]){
      block('city-corner-pier',x+side*(w/2-.3),h/2-8,z,.65,h,d+.45,trim);
      for(let level=4;level<h-3;level+=7){
        const y=level-8;
        block('city-concrete-ledge',x,y-.8,z+side*(d/2+.18),w+.65,.5,.8,wall);
        block('city-side-ledge',x+side*(w/2+.18),y-.8,z,.8,.5,d+.65,wall);
        const columns=Math.max(2,Math.floor(w/4));
        for(let col=0;col<columns;col++){
          const wx=x-w/2+(col+.5)*w/columns,lit=(i+col+level)%5===0;
          block('city-window-frame',wx,y+1,z+side*(d/2+.16),w/columns*.68,2.7,.3,trim);
          block('city-window-recess',wx,y+1,z+side*(d/2+.33),w/columns*.5,2.1,.08,lit?litWindow:windows);
          block('city-window-mullion',wx,y+1,z+side*(d/2+.4),.16,2.2,.12,trim);
        }
        for(let col=0;col<2;col++){
          const wz=z+(col-.5)*d*.45;
          block('city-side-window-frame',x+side*(w/2+.17),y+1,wz,.3,2.7,d*.28,trim);
          block('city-side-window-recess',x+side*(w/2+.34),y+1,wz,.08,2.1,d*.22,(i+col+level)%4===0?litWindow:windows);
        }
      }
    }
    // Chunky rooftop plant and louvred equipment avoid a perfectly flat skyline.
    block('city-roof-plant',x+w*.12,h-6.5,z, w*.45,3,d*.45,trim);
    block('city-roof-stack',x-w*.28,h-5,z+d*.22,1.2,6,1.4,wall);
    for(let slat=0;slat<4;slat++)block('city-plant-louvre',x+w*.12,h-7.4+slat*.5,z-d*.225-.12,w*.35,.22,.3,windows);
    const edge=i%3===0?emissives.pink:emissives.cyan;
    for(let level=2;level<h-2;level+=6+(i%3)*2){
      block('city-window',x,level-8,z-d/2-.6,w*.82,.28,.08,edge);
      block('city-window',x-w/2-.6,level-8,z,.08,.28,d*.82,edge);
    }
    block('city-crown',x,h-7.9,z,w+.1,.12,d+.1,edge);
  }
  function sign(label,sub,x,y,z,w,h,accent,rotation=0){
    const m=new B.StandardMaterial('display-'+label,scene);m.disableLighting=true;m.diffuseColor=B.Color3.Black();m.fogEnabled=false;
    m.emissiveTexture=texture('display-'+label,ctx=>{ctx.fillStyle='#081427';ctx.fillRect(0,0,256,256);ctx.strokeStyle=accent;ctx.lineWidth=4;ctx.strokeRect(5,5,246,246);ctx.fillStyle=accent;ctx.font='bold 40px sans-serif';ctx.textAlign='center';ctx.fillText(label,128,130);ctx.font='13px monospace';ctx.fillText(sub,128,163);for(let n=20;n<240;n+=8){ctx.fillStyle='#ffffff07';ctx.fillRect(12,n,232,1);}},256);m.emissiveTexture.vScale=-1;m.emissiveTexture.vOffset=1;m.emissiveColor=B.Color3.Black();m.useEmissiveAsIllumination=true;m.backFaceCulling=true;
    const p=B.MeshBuilder.CreatePlane('neon-sign',{width:w,height:h},scene);p.parent=root;p.position.set(x,y,z);p.rotation.y=rotation;p.material=m;p.isPickable=false;
    const back=p.clone('neon-sign-back');back.rotation.y=rotation+Math.PI;back.isPickable=false;
  }
  // Displays sit outside the fence or high above existing cover; routes stay clear.
  sign('NEXUS','INDUSTRIAL DISTRICT / 09',6,8,48,16,5,'#42dfff');
  sign('AFTERLIFE','NIGHT SHIFT / ALWAYS OPEN',-17,6,22,9,4,'#ed68e8',Math.PI/2);
  sign('NEON','RUST / COMBAT SYSTEMS',46,10,18,9,5,'#f5ad56',-Math.PI/2);
  for(const y of [4.68,10.68]){block('tower-neon',19.49,y,20.34,4.5,.045,.045,emissives.pink);block('tower-neon',19.49,y,26.4,4.5,.045,.045,emissives.pink);block('tower-neon',17.22,y,23.37,.045,.045,6.06,emissives.cyan);block('tower-neon',21.76,y,23.37,.045,.045,6.06,emissives.cyan);}
  for(const x of [17.22,21.76])block('tower-neon',x,7.68,20.34,.045,6,.045,emissives.pink);
  sign('N / 09','SIGNAL CORE',19.49,8.2,20.28,3.2,1.7,'#ef73ed');
  const batches=new Map();for(const mesh of root.getChildMeshes()){if(!/^(city-|district-tower)/.test(mesh.name))continue;const list=batches.get(mesh.material)||[];list.push(mesh);batches.set(mesh.material,list);}for(const list of batches.values()){const combined=B.Mesh.MergeMeshes(list,true,true);if(combined){combined.parent=root;combined.isPickable=false;combined.freezeWorldMatrix();}}
  const glow=new B.GlowLayer('neon-glow',scene,{blurKernelSize:16,mainTextureRatio:.5});glow.intensity=.16;
  const lights=[];
  for(const [x,y,z,hex] of [[4,2,10,'#26cfff'],[24,5,23,'#df54ee'],[10,1,37,'#2fd5fb']]){const l=new B.PointLight('district-fill',new B.Vector3(x,y,z),scene);l.diffuse=color(hex);l.intensity=.65;l.range=20;lights.push(l);}
  function apply(enabled){
    root.setEnabled(enabled);glow.isEnabled=enabled;lights.forEach(l=>l.setEnabled(enabled));
    for(const e of entries)e.mesh.material=enabled?e.cyber:e.original;
    const hemi=scene.getLightByName('ambient'),sun=scene.getLightByName('sun');
    scene.clearColor=enabled?new B.Color4(.025,.043,.085,1):new B.Color4(.69,.65,.54,1);
    scene.fogColor=enabled?color('#0a152b'):new B.Color3(.69,.65,.54);scene.fogDensity=enabled?.007:.005;
    scene.ambientColor=enabled?new B.Color3(.32,.34,.35):new B.Color3(.65,.67,.59);
    hemi.diffuse=enabled?color('#bcc5cc'):B.Color3.White();hemi.groundColor=enabled?color('#3d3d35'):new B.Color3(.48,.52,.4);hemi.intensity=enabled?.9:.8;
    sun.diffuse=enabled?color('#c8cfcd'):B.Color3.White();sun.intensity=enabled?.75:.85;
    scene.imageProcessingConfiguration.contrast=enabled?1.1:1.12;
  }
  await Promise.all(ready);
  return {apply};
}
