// Identical 60 Hz movement on the server and in client prediction.
export const STEP = 1 / 60;
export function moveOnline(physics, actor, s, input, spawn) {
  const dt = STEP;
  if (actor.grounded) { s.hoverUsed = false; s.hover = 0; }
  s.weapon = input.weapon; s.aim = input.aim; s.yaw = input.yaw; s.pitch = input.pitch;
  if (!s.aim || s.weapon !== 'sniper') s.hover = 0;
  if (s.aim && s.weapon === 'sniper' && !actor.grounded && !s.hoverUsed) {
    s.hoverUsed = true; s.hover = .6; actor.vy = 0;
  }
  const hovering = s.hover > 0;
  s.crouched = physics.crouch(actor, input.crouch);
  let f = input.forward, r = input.side, length = Math.hypot(f, r);
  if (length > 1) { f /= length; r /= length; }
  let speed = s.aim ? (s.weapon === 'sniper' ? 1.8 : 3.3) : input.sprint ? 9.2 : 6.5;
  if (s.crouched) speed = Math.min(speed, 2.1);
  const sin = Math.sin(s.yaw), cos = Math.cos(s.yaw);
  let vf = s.vx * sin + s.vz * cos, vr = s.vx * cos - s.vz * sin;
  if (!f) vf = 0; if (!r) vr = 0;
  s.vx = vf * sin + vr * cos; s.vz = vf * cos - vr * sin;
  const a = 1 - Math.exp(-dt * (actor.grounded ? 28 : 7));
  s.vx += ((sin*f+cos*r)*speed-s.vx)*a; s.vz += ((cos*f-sin*r)*speed-s.vz)*a;
  const v = Math.hypot(s.vx,s.vz);
  if (v > speed) { s.vx *= speed/v; s.vz *= speed/v; }
  if (hovering) s.vx = s.vz = 0;
  physics.move(actor,s.vx*dt,s.vz*dt,dt,input.jump,hovering);
  Object.assign(s,{x:actor.x,y:actor.y,z:actor.z,vy:actor.vy,grounded:actor.grounded,jumpBuffer:actor.jumpBuffer,groundGrace:actor.groundGrace});
  if (actor.grounded) { s.hoverUsed=false; s.hover=0; }
  else s.hover=Math.max(0,(s.hover||0)-dt);
  if(s.y < -15 || Math.abs(s.x)>62 || Math.abs(s.z)>62) {
    physics.teleport(actor,spawn); Object.assign(s,spawn,{vx:0,vz:0,vy:0,hover:0,hoverUsed:false,grounded:false});
  }
  return s;
}
export function restoreOnline(physics, actor, s) {
  physics.teleport(actor,s); physics.crouch(actor,!!s.crouched);
  for (const key of ['vy','grounded','jumpBuffer','groundGrace']) actor[key]=s[key]??0;
}
