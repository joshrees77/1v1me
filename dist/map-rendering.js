// Imported double-sided surfaces sometimes contain coincident copies with
// different UVs. Keep one triangle per position within each material batch.
// This affects visual indices only; the authoritative collision mesh is separate.
export function uniqueSurfaceIndices(positions, indices) {
  const vertices = new Array(positions.length / 3), seen = new Set(), out = [];
  for (let i = 0; i < vertices.length; i++) {
    vertices[i] = [0,1,2].map(axis => Math.round(positions[i*3+axis]*100000)).join(',');
  }
  for (let i = 0; i < indices.length; i += 3) {
    const triangle = [indices[i],indices[i+1],indices[i+2]];
    const key = triangle.map(index => vertices[index]).sort().join('|');
    if (seen.has(key)) continue;
    seen.add(key); out.push(...triangle);
  }
  return new Uint32Array(out);
}

export function surfaceDepth(name, index) {
  // Decals render after solid geometry, retaining its depth buffer but never
  // writing their own depth. This prevents overlapping dirt patches from
  // fighting each other as camera projection changes. The bias only separates
  // them from the underlying solid surface; it is not their layer ordering.
  const decal = /(?:_dec(?:al)?(?:_|$)|_text$)/.test(name);
  return { disableDepthWrite: decal, zOffset: decal ? -1 : 0, zOffsetUnits: -(index + 1) * .25 - (decal ? 40 : 0) };
}

// The vent housing also contains double-sided quads whose reverse faces use
// the OTHER diagonal. Triangle-only deduplication cannot recognize those copies.
// Remove repeated convex four-corner panels without changing their outer edges,
// UVs or two-sided material. Concave/non-planar pairs are deliberately excluded.
export function uniquePanelIndices(positions, indices) {
  const pointKeys=new Array(positions.length/3);
  for(let i=0;i<pointKeys.length;i++)pointKeys[i]=[0,1,2].map(a=>Math.round(positions[i*3+a]*100000)).join(',');
  const edges=new Map(),panels=new Map(),removed=new Set();
  const point=i=>[positions[i*3],positions[i*3+1],positions[i*3+2]];
  const sub=(a,b)=>a.map((v,i)=>v-b[i]);
  const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
  const dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0);
  for(let t=0;t<indices.length;t+=3){
    const tri=[indices[t],indices[t+1],indices[t+2]];
    for(let e=0;e<3;e++){
      const a=tri[e],b=tri[(e+1)%3],c=tri[(e+2)%3];
      const edge=[pointKeys[a],pointKeys[b]].sort().join('|'),previous=edges.get(edge)||[];
      for(const other of previous){
        if(pointKeys[other.c]===pointKeys[c])continue;
        const pa=point(a),pb=point(b),pc=point(c),pd=point(other.c),ab=sub(pb,pa);
        const n=cross(ab,sub(pc,pa)),n2=cross(ab,sub(pd,pa)),length=Math.sqrt(dot(n,n));
        if(length<1e-9||Math.abs(dot(n,sub(pd,pa)))/length>1e-5||dot(n,n2)>=0)continue;
        const cd=sub(pd,pc);
        if(dot(cross(cd,sub(pa,pc)),cross(cd,sub(pb,pc)))>=0)continue;
        const key=[a,b,c,other.c].map(i=>pointKeys[i]).sort().join('|');
        const first=panels.get(key),pair=[other.t,t];
        if(first){
          if(pair.some(i=>first.includes(i))||first.some(i=>removed.has(i)))continue;
          pair.forEach(i=>removed.add(i));
        }else if(!pair.some(i=>removed.has(i)))panels.set(key,pair);
      }
      previous.push({t,c});edges.set(edge,previous);
    }
  }
  const result=[];for(let t=0;t<indices.length;t+=3)if(!removed.has(t))result.push(indices[t],indices[t+1],indices[t+2]);
  return new Uint32Array(result);
}
