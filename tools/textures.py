from PIL import Image
import json,zipfile,io,os
root='dist/assets/rust';meta=json.load(open(root+'/map.json'))
z=zipfile.ZipFile('/Users/joshrees/FPS/assets/rust/source/mw2_rust_c2m.zip');files={os.path.basename(n).lower():n for n in z.namelist()}
used={};missing=[]
for m in meta:
 name=m['texture']
 if not name:continue
 if name not in used:
  key=name.lower();path=files.get(key)
  if not path:missing.append(name);continue
  im=Image.open(io.BytesIO(z.read(path))).convert('RGBA');im.thumbnail((256,256),Image.Resampling.BOX)
  out='texture-'+str(len(used))+'.png';im.save(root+'/'+out,optimize=True);used[name]=out
 m['texture']=used.get(name)
json.dump(meta,open(root+'/map.json','w'),separators=(',',':'))
print('TEXTURES',len(used),'missing',missing)
