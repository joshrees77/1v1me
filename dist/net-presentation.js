// Presentation only. Collision, health and shot results remain authoritative.
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
export function blendMotion(a,b,t){
  const out={...(t<.5?a:b)};
  for(const k of ['x','y','z','pitch'])out[k]=a[k]+(b[k]-a[k])*t;
  out.yaw=a.yaw+Math.atan2(Math.sin(b.yaw-a.yaw),Math.cos(b.yaw-a.yaw))*t;
  return out;
}
export class SnapshotBuffer {
  constructor(){this.reset();}
  reset(){this.frames=[];this.offsets=[];this.delay=.085;this.jitter=0;this.cursor=null;this.lastArrival=null;this.lastServer=null;this.underruns=0;}
  push(serverTime,arrival,motion){
    if(this.lastServer!==null&&serverTime<=this.lastServer)return false;
    if(this.lastServer!==null){
      const variation=Math.abs((arrival-this.lastArrival)-(serverTime-this.lastServer));
      this.jitter+=(Math.min(.2,variation)-this.jitter)*.15;
    }
    this.offsets.push(arrival-serverTime);if(this.offsets.length>80)this.offsets.shift();
    this.offset=Math.min(...this.offsets);
    this.delay=clamp(.075+this.jitter*2,.075,.15);
    this.lastArrival=arrival;this.lastServer=serverTime;
    this.frames.push({at:serverTime,motion:{...motion}});if(this.frames.length>40)this.frames.shift();
    return true;
  }
  sample(now,dt){
    if(!this.frames.length)return null;
    const target=now-this.offset-this.delay;
    if(this.cursor===null||Math.abs(target-this.cursor)>.35)this.cursor=target;
    else this.cursor+=dt*clamp(1+(target-this.cursor)*3,.9,1.1);
    // Interpolate server timestamps, never variable packet-arrival spacing.
    while(this.frames.length>2&&this.frames[1].at<this.cursor)this.frames.shift();
    let a=this.frames[0],b=this.frames.at(-1);
    if(this.cursor<=a.at)return {...a.motion};
    for(let i=1;i<this.frames.length;i++)if(this.frames[i].at>=this.cursor){a=this.frames[i-1];b=this.frames[i];break;}
    if(this.cursor>b.at){this.underruns++;this.cursor=b.at;return {...b.motion};} // Freeze rather than extrapolate through cover.
    return blendMotion(a.motion,b.motion,clamp((this.cursor-a.at)/(b.at-a.at||1),0,1));
  }
}
export class PredictedView {
  constructor(){this.reset({x:0,y:0,z:0});}
  reset(s){this.previous={...s};this.current={...s};this.error={x:0,y:0,z:0};this.correction=0;}
  advance(before,after){this.previous={...before};this.current={...after};}
  correct(before,after){
    const d={x:before.x-after.x,y:before.y-after.y,z:before.z-after.z};
    this.correction=Math.hypot(d.x,d.y,d.z);
    if(this.correction>1.5){this.reset(after);return;}
    for(const k of ['x','y','z']){this.previous[k]-=d[k];this.current[k]-=d[k];this.error[k]+=d[k];}
  }
  sample(alpha,dt){
    const out={};for(const k of ['x','y','z']){this.error[k]*=Math.exp(-dt*22);out[k]=this.previous[k]+(this.current[k]-this.previous[k])*clamp(alpha,0,1)+this.error[k];}
    return out;
  }
}
export function presentationTimers(state,age){
  const elapsed=clamp(age,0,.25);
  return {reload:Math.max(0,state.reload-elapsed),knife:Math.max(0,state.knife-elapsed),cooldown:Math.max(0,state.cooldown-elapsed)};
}
