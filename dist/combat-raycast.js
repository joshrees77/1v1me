export function maskIsSolid(mask, uv) {
  if (!mask || !uv) return true;
  // Source textures use repeat wrapping and invertY=false, matching the renderer.
  const repeat = n => n - Math.floor(n);
  const x = Math.min(mask.width-1, Math.floor(repeat(uv.x)*mask.width));
  const y = Math.min(mask.height-1, Math.floor(repeat(uv.y)*mask.height));
  const pixel = y*mask.width+x;
  return !!(mask.bytes[pixel>>3] & (1 << (pixel&7)));
}

export function pickVisibleCombat(B, scene, ray, worldIndex) {
  const enemy = scene.pickWithRay(ray,m=>m.isEnabled()&&m.isVisible&&!!m.metadata?.bot);
  const limit = enemy?.hit ? Math.min(ray.length,enemy.distance) : ray.length;
  if(worldIndex)return worldIndex.pick(ray,limit)??(enemy?.hit?enemy:null);
  let travelled=0, last=null;
  // Continue through transparent holes, including additional faces in the same
  // imported material batch. Solid cover still wins over an enemy behind it.
  for(let layer=0;layer<64&&travelled<limit;layer++){
    const query=new B.Ray(ray.origin.add(ray.direction.scale(travelled)),ray.direction,limit-travelled);
    const hit=scene.pickWithRay(query,m=>m.isEnabled()&&m.isVisible&&!!m.metadata?.world);
    if(!hit?.hit) return enemy?.hit?enemy:null;
    const distance=travelled+hit.distance;
    const mesh=hit.pickedMesh;
    const mask=!mesh.material||mesh.material.needAlphaTesting()?mesh.metadata.hitMask:null;
    if(maskIsSolid(mask,hit.getTextureCoordinates())){
      hit.distance=distance;return hit;
    }
    hit.distance=distance;travelled=distance+.002;last=hit;
  }
  // Bounded work even with pathological overlapping geometry.
  return travelled>=limit?(enemy?.hit?enemy:null):last;
}
