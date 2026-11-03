const clamp=v=>Math.max(0,Math.min(1,v));
const smooth=v=>{const t=clamp(v);return t*t*(3-2*t);};
export function track(t,keys){
  if(t<=keys[0][0])return keys[0][1];
  for(let i=1;i<keys.length;i++)if(t<=keys[i][0]){const [a,x]=keys[i-1],[b,y]=keys[i];return x+(y-x)*smooth((t-a)/(b-a));}
  return keys.at(-1)[1];
}
// Independent additive layers: ADS, locomotion, handling, recoil, then mechanism.
export function weaponPose(s,i,dt){
  if(s.weapon!==i.weapon){s.weapon=i.weapon;s.equip=.22;s.ads=0;s.yaw=i.yaw;s.pitch=i.pitch;s.sx=0;s.sy=0;}
  const blend=1-Math.exp(-dt*22);
  s.equip=Math.max(0,(s.equip||0)-dt);
  s.ads=(s.ads||0)+((i.aim?1:0)-(s.ads||0))*(1-Math.exp(-dt*20));
  const dy=Math.atan2(Math.sin(i.yaw-(s.yaw??i.yaw)),Math.cos(i.yaw-(s.yaw??i.yaw))),dp=i.pitch-(s.pitch??i.pitch);
  s.yaw=i.yaw;s.pitch=i.pitch;
  s.sx=(s.sx||0)+(Math.max(-.035,Math.min(.035,-dy*.16/Math.max(dt,.001)))-(s.sx||0))*blend;
  s.sy=(s.sy||0)+(Math.max(-.025,Math.min(.025,dp*.12/Math.max(dt,.001)))-(s.sy||0))*blend;
  s.moving=(s.moving||0)+(clamp(i.speed/6.5)-(s.moving||0))*(1-Math.exp(-dt*18));
  s.sprint=(s.sprint||0)+((i.sprint&&!i.aim&&i.speed>6.5?1:0)-(s.sprint||0))*(1-Math.exp(-dt*14));
  const ads=s.ads,run=s.sprint,kick=i.recoil,lower=s.equip/.22;
  const r=i.reload>0?clamp(1-i.reload/i.reloadDuration):0;
  const handling=i.reload>0?track(r,[[0,0],[.12,1],[.8,1],[1,0]]):0;
  const bob=Math.sin(i.bob)*.012*s.moving*(1-ads*.93);
  const pose={x:.32-.28*ads+s.sx*(1-ads*.9)-.1*handling,y:-.3+bob-kick*.3+.11*handling-.16*lower-.045*run,z:.55-kick+.08*handling,
    rx:-kick*1.6-.12*handling+.2*lower-.15*run+s.sy*(1-ads*.9),ry:s.sx*.8,rz:Math.sin(i.bob*.5)*.018*s.moving*(1-ads)-.28*handling+.16*run,
    breech:0,bolt:0,boltLift:0,magazine:0,hand:0,shell:0,ads};
  if(i.weapon==='shotgun'&&i.reload>0){
    pose.breech=track(r,[[0,0],[.18,.7],[.72,.7],[.9,0],[1,0]]);
    pose.shell=track(r,[[0,0],[.2,0],[.32,1],[.48,1],[.62,0],[1,0]]);
    pose.hand=track(r,[[0,0],[.2,0],[.38,1],[.65,1],[.85,0],[1,0]]);
  }
  if(i.weapon==='sniper'){
    const c=i.cooldown>0?1-i.cooldown/1.15:1;
    pose.boltLift=track(c,[[0,0],[.12,0],[.23,1],[.62,1],[.78,0],[1,0]]);
    pose.bolt=track(c,[[0,0],[.23,0],[.4,.13],[.5,.13],[.68,0],[1,0]]);
    if(i.reload>0){pose.magazine=track(r,[[0,0],[.18,0],[.32,.3],[.55,.3],[.72,0],[1,0]]);pose.hand=pose.magazine*3;}
  }
  return pose;
}
