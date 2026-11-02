"""Pack source alpha cutouts for weapon ray tests. Movement collision is unchanged."""
import base64,json
from pathlib import Path
from PIL import Image
root=Path(__file__).resolve().parent.parent/'dist/assets/rust'
result={}
for name in sorted({m['texture'] for m in json.loads((root/'map.json').read_text()) if m.get('texture')}):
 im=Image.open(root/name).convert('RGBA');alpha=list(im.getchannel('A').getdata())
 if min(alpha)>=115:continue
 bits=bytearray((len(alpha)+7)//8)
 for i,a in enumerate(alpha):
  if a>=115:bits[i//8]|=1<<(i%8)
 result[name]={'width':im.width,'height':im.height,'bits':base64.b64encode(bits).decode()}
out=root.parent/'hit-masks.json';out.write_text(json.dumps(result,separators=(',',':'))+'\n')
print('Packed',len(result),'original alpha masks:',out.stat().st_size,'bytes')
