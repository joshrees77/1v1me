import bpy,json,os,struct
from mathutils import Vector
out='/Users/joshrees/FPS/shatter-duel/dist/assets/rust';os.makedirs(out,exist_ok=True)
groups={};collv=[];colli=[]
def images(tree):
 r=[]
 for n in tree.nodes:
  if n.type=='TEX_IMAGE' and n.image:r.append(n.image.name)
  elif n.type=='GROUP' and n.node_tree:r.extend(images(n.node_tree))
 return r
instances=[]
for item in bpy.context.evaluated_depsgraph_get().object_instances:
 o=item.object
 if o.type!='MESH':continue
 if not item.is_instance and not o.original.visible_get():continue
 matrix=item.matrix_world.copy()
 if item.is_instance and (abs(matrix.translation.x)>95 or abs(matrix.translation.y)>95):continue
 instances.append((o.original,matrix))
for o,matrix in instances:
 m=o.data;m.calc_loop_triangles();uv=m.uv_layers.active
 normal_matrix=matrix.to_3x3().inverted().transposed()
 for t in m.loop_triangles:
  material=o.material_slots[t.material_index].material if o.material_slots else None
  name=material.name if material else o.name
  if name=='shadowcaster':continue
  if name not in groups:
   candidates=images(material.node_tree) if material and material.use_nodes else []
   tex=next((v for v in candidates if not any(k in v.lower() for k in ['_nml','_bump','_normal','_spec','_spc','~','_n.tga'])),None)
   solid=not any(s in name.lower() for s in ['decal','_dec','grass','foliage','wire','paper','trash','sky','rock_cliffwall','shadowcaster','shrub','brush','pine','palmtree','water','river'])
   groups[name]={'name':name,'texture':tex,'solid':solid,'p':[],'n':[],'uv':[]}
  g=groups[name];vs=[]
  for li in t.loops:
   v=matrix@m.vertices[m.loops[li].vertex_index].co;vs.append(v)
   n=normal_matrix@m.corner_normals[li].vector;n.normalize()
   g['p'].extend([v.x,v.z,v.y]);g['n'].extend([n.x,n.z,n.y]);g['uv'].extend(uv.data[li].uv if uv else (0,0))
  if g['solid'] and all(abs(v.x)<65 and abs(v.y)<65 and -12<v.z<35 for v in vs):
   start=len(collv)//3
   for v in vs:collv.extend([v.x,v.z,v.y])
   colli.extend([start,start+2,start+1])
blob=bytearray();meta=[]
for g in groups.values():
 for key in ['p','n','uv']:
  values=g[key];g[key]=[len(blob),len(values)];blob.extend(struct.pack('<'+'f'*len(values),*values))
 meta.append(g)
open(out+'/map.bin','wb').write(blob);json.dump(meta,open(out+'/map.json','w'),separators=(',',':'))
with open(out+'/collision.bin','wb') as f:
 f.write(struct.pack('<II',len(collv),len(colli)));f.write(struct.pack('<'+'f'*len(collv),*collv));f.write(struct.pack('<'+'I'*len(colli),*colli))
print('EXPORTED',len(instances),'instances',len(meta),'materials',len(blob),'bytes',len(colli)//3,'collision triangles')
