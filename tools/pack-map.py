import numpy as np,json,struct,gzip,os
root='dist/assets/rust';meta=json.load(open(root+'/map.json'));data=open(root+'/map.bin','rb').read();out=bytearray()
for m in meta:
 values=[]
 for k,width in [('p',3),('n',3),('uv',2)]:
  off,count=m[k];values.append(np.frombuffer(data,dtype='<f4',count=count,offset=off).reshape(-1,width))
 rows,idx=np.unique(np.round(np.concatenate(values,axis=1),5),axis=0,return_inverse=True)
 for k,v in [('p',rows[:,:3]),('n',rows[:,3:6]),('uv',rows[:,6:]),('i',idx.astype('<u4'))]:
  m[k]=[len(out),v.size];out.extend(v.tobytes())
gzip.open(root+'/map.bin.gz','wb',compresslevel=9).write(out);os.remove(root+'/map.bin');json.dump(meta,open(root+'/map.json','w'),separators=(',',':'))
b=open(root+'/collision.bin','rb').read();nv,ni=struct.unpack_from('<II',b);v=np.frombuffer(b,dtype='<f4',count=nv,offset=8).reshape(-1,3);idx=np.frombuffer(b,dtype='<u4',count=ni,offset=8+nv*4);v,remap=np.unique(np.round(v,5),axis=0,return_inverse=True);idx=remap[idx].astype('<u4');open(root+'/collision.bin','wb').write(struct.pack('<II',v.size,idx.size)+v.tobytes()+idx.tobytes())
print('Packed visual',len(out),'collision',8+v.nbytes+idx.nbytes)
