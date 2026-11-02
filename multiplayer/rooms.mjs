import {randomBytes,randomUUID} from 'node:crypto';
import {STEP,moveOnline} from '../dist/online-motion.js';
import {V,direction,spreadDirection,castShot} from './world.mjs';

export const WEAPONS={shotgun:{capacity:2,interval:.38,reload:2.2},sniper:{capacity:5,interval:1.15,reload:2.1},knife:{capacity:1,interval:.55,reload:0}};
const defaults={rounds:5,seconds:60,weapons:'all'};
const allowed=r=>r.weapons==='all'?Object.keys(WEAPONS):[r.weapons];
export function validateRules(r){
  if(!r||!Number.isInteger(r.rounds)||r.rounds<1||r.rounds>15||![30,60,90,120,180].includes(r.seconds)||!['all',...Object.keys(WEAPONS)].includes(r.weapons))throw Error('Invalid rules.');
  return {rounds:r.rounds,seconds:r.seconds,weapons:r.weapons};
}
export function validateInput(m){
  const i=m.input;
  if(!Number.isSafeInteger(m.seq)||m.seq<1||!i||![-1,0,1].includes(i.forward)||![-1,0,1].includes(i.side)||!Number.isFinite(i.yaw)||Math.abs(i.yaw)>1e7||!Number.isFinite(i.pitch)||Math.abs(i.pitch)>1.46||!WEAPONS[i.weapon])throw Error('Invalid input.');
  if(m.action&&!['fire','throw','reload'].includes(m.action))throw Error('Invalid action.');
  return {seq:m.seq,action:m.action,input:{forward:i.forward,side:i.side,yaw:i.yaw,pitch:i.pitch,weapon:i.weapon,aim:i.aim===true,jump:i.jump===true,crouch:i.crouch===true,sprint:i.sprint===true}};
}
export class Rooms {
  constructor(world,{clock=()=>performance.now()/1000,random=Math.random}={}){this.world=world;this.clock=clock;this.random=random;this.rooms=new Map();this.clients=new Set();this.lastSnapshot=0;}
  connect(send){const c={id:randomUUID(),send,room:null,rtt:0};this.clients.add(c);return c;}
  emit(room,type,data={}){for(const p of room.players)p.client.send({type,...data});}
  info(room){return {code:room.code,host:room.host,rules:room.rules,phase:room.phase,round:room.round,epoch:room.epoch,deadline:room.deadline,now:this.clock(),winner:room.winner,reason:room.reason,players:room.players.map(p=>({id:p.id,name:p.name,ready:p.ready,score:p.score}))};}
  broadcast(room){this.emit(room,'room',{room:this.info(room)});}
  receive(c,m){
    try{
      if(!m||typeof m!=='object')throw Error('Invalid message.');
      if(m.type==='ping'){c.send({type:'pong',stamp:m.stamp});return;}
      if(m.type==='create'||m.type==='join'){
        if(c.room)throw Error('Leave your current lobby first.');
        let room;
        if(m.type==='create'){
          if(this.rooms.size>=20)throw Error('Server is full. Try again later.');
          const code=randomBytes(5).toString('hex').toUpperCase();
          room={code,host:c.id,rules:m.rules?validateRules(m.rules):{...defaults},players:[],phase:'waiting',round:0,epoch:0,deadline:0,projectiles:[],touched:this.clock()};this.rooms.set(code,room);
        }else{
          room=this.rooms.get(String(m.code).toUpperCase());
          if(!room)throw Error('Lobby not found. Ask your friend for a new link.');
          if(room.players.length>=2)throw Error('This lobby already has two players.');
          if(room.phase!=='waiting')throw Error('This match has already started.');
        }
        const name=String(m.name||'Player').replace(/[\x00-\x1f\x7f<>]/g,'').trim().slice(0,20)||'Player';
        const actor=this.world.physics.actor(this.world.spawns[room.players.length]);
        const p={id:c.id,client:c,name,actor,ready:false,score:0,hp:100,queue:[],seq:0,received:0,credit:0,history:[],motion:{...this.world.spawns[room.players.length],vx:0,vz:0,vy:0,hover:0,hoverUsed:false,weapon:'shotgun',aim:false,yaw:0,pitch:0},ammo:{shotgun:2,sniper:5},nextFire:0,reloadEnd:0,knifeEnd:0,scopeAt:null};
        c.room=room;room.players.push(p);room.touched=this.clock();c.send({type:'joined',id:c.id,code:room.code});this.broadcast(room);return;
      }
      const room=c.room,p=room?.players.find(p=>p.id===c.id);if(!p)throw Error('Join a lobby first.');
      room.touched=this.clock();
      if(m.type==='leave'){this.disconnect(c,false);return;}
      if(m.type==='rules'){
        if(room.host!==c.id||room.phase!=='waiting')throw Error('Only the host can change lobby rules.');
        room.rules=validateRules(m.rules);room.players.forEach(p=>p.ready=false);this.broadcast(room);return;
      }
      if(m.type==='ready'){
        if(room.phase!=='waiting')throw Error('The match has started.');
        p.ready=m.ready===true;p.preferred=allowed(room.rules).includes(m.weapon)?m.weapon:allowed(room.rules)[0];this.broadcast(room);return;
      }
      if(m.type==='start'){
        if(room.host!==c.id||room.phase!=='waiting'||room.players.length!==2||room.players.some(p=>!p.ready))throw Error('Both players must be ready.');
        room.players.forEach(p=>p.score=0);room.round=0;this.beginRound(room);return;
      }
      if(m.type==='rematch'){
        if(room.host!==c.id||room.phase!=='result')throw Error('Only the host can return to the lobby.');
        room.phase='waiting';room.winner=null;room.players.forEach(p=>p.ready=false);this.broadcast(room);return;
      }
      if(m.type==='input'){
        const packet=validateInput(m);
        if(room.phase!=='playing'||m.epoch!==room.epoch||packet.seq<=p.received)return;
        if(p.queue.length>=12)throw Error('Connection is too far behind.');
        p.received=packet.seq;p.queue.push(packet);return;
      }
      throw Error('Unknown message.');
    }catch(error){c.send({type:'error',message:error.message});}
  }
  disconnect(c,remove=true){
    const room=c.room;c.room=null;if(remove)this.clients.delete(c);
    if(!room)return;
    const p=room.players.find(p=>p.id===c.id);if(p){this.world.physics.world.removeCharacterController(p.actor.controller);this.world.physics.world.removeCollider(p.actor.collider,true);}
    room.players=room.players.filter(p=>p.id!==c.id);
    if(!room.players.length){this.rooms.delete(room.code);return;}
    room.phase='waiting';room.epoch++;room.projectiles=[];room.host=room.players[0].id;room.players.forEach(p=>{p.ready=false;p.queue=[];});
    this.emit(room,'opponent-left');this.broadcast(room);
  }
  beginRound(room){
    room.round++;room.epoch++;room.phase='countdown';room.deadline=this.clock()+3;room.winner=null;room.projectiles=[];
    room.players.forEach((p,i)=>{
      const spawn=this.world.spawns[(i+room.round-1)%2],other=this.world.spawns[(i+room.round)%2];
      this.world.physics.teleport(p.actor,spawn);
      p.spawn=spawn;p.motion={...spawn,vx:0,vz:0,vy:0,grounded:false,crouched:false,jumpBuffer:0,groundGrace:0,hover:0,hoverUsed:false,aim:false,weapon:allowed(room.rules).includes(p.preferred)?p.preferred:allowed(room.rules)[0],yaw:Math.atan2(other.x-spawn.x,other.z-spawn.z),pitch:0};
      p.hp=100;p.ammo={shotgun:2,sniper:5};p.nextFire=room.deadline;p.reloadEnd=0;p.knifeEnd=0;p.scopeAt=null;p.hoverUntil=0;p.seq=0;p.received=0;p.credit=0;p.queue=[];p.history=[];p.lastInputAt=room.deadline;
    });this.broadcast(room);this.snapshot(room);
  }
  finish(room,winner,reason){
    if(room.phase!=='playing')return;
    if(winner)winner.score++;
    room.winner=winner?.id??null;room.reason=reason;room.phase='round';room.deadline=this.clock()+2.4;room.projectiles=[];room.players.forEach(p=>p.queue=[]);this.broadcast(room);this.snapshot(room);
  }
  damage(room,p,target,amount,head,weapon,at=this.clock()){
    if(room.phase!=='playing'||target.hp<=0)return;
    const boosted=target.motion.hover>0&&at<target.hoverUntil;
    const damage=Math.round(amount*(boosted?1.5:1));target.hp=Math.max(0,target.hp-damage);
    this.emit(room,'hit',{shooter:p.id,target:target.id,damage,hp:target.hp,head,weapon});
    if(!target.hp)this.finish(room,p,head?'Headshot':'Elimination');
  }
  targetAt(p,now,shooter){
    // Bounded rewind compensates transit and the opponent interpolation buffer.
    const at=now-Math.min(.2,(shooter.client.rtt||0)/2+.06);
    return p.history.findLast(h=>h.at<=at)?.motion||p.motion;
  }
  action(room,p,kind,now){
    const s=p.motion,w=s.weapon,cfg=WEAPONS[w],target=room.players.find(x=>x!==p);
    if(!target||p.hp<=0||now<p.nextFire||p.reloadEnd)return;
    if(kind==='reload'){
      if(w!=='knife'&&p.ammo[w]<cfg.capacity){p.reloadEnd=now+cfg.reload;s.aim=false;p.scopeAt=null;s.hover=0;}return;
    }
    if(kind==='throw'&&!allowed(room.rules).includes('knife'))return;
    if(kind==='throw'||w==='knife'){
      if(now<p.knifeEnd)return;
    }else if(!p.ammo[w]){p.reloadEnd=now+cfg.reload;s.aim=false;p.scopeAt=null;s.hover=0;return;}
    const origin=new V(s.x,s.y+(s.crouched?.85:1.68),s.z);
    if(kind==='throw'){
      p.knifeEnd=now+3;p.nextFire=now+.45;const velocity=direction(s.yaw,s.pitch).scale(31);velocity.y+=1.3;
      room.projectiles.push({id:randomUUID(),owner:p.id,position:origin,velocity,life:3});this.emit(room,'throw',{shooter:p.id});return;
    }
    p.nextFire=now+cfg.interval;if(w!=='knife')p.ammo[w]--;
    const targetPose=this.targetAt(target,now,p),rays=[];let damage=0,head=false;
    if(w==='shotgun'){
      const phase=this.random()*Math.PI*2;
      for(let i=0;i<10;i++){
        const hit=castShot(this.world,origin,spreadDirection(s.yaw,s.pitch,.08,i*2.3999632297+phase,Math.sqrt((i+.5)/10)),40,targetPose);rays.push(hit.end);
        if(hit.hit){const d=hit.distance;damage+=14*(d<=5?1:d>=25?.05*(40-d)/15:.05+.95*(1-(d-5)/20)**2);}
      }
    }else{
      const scoped=s.aim&&p.scopeAt!==null,age=scoped?now-p.scopeAt:Infinity;
      const moving=!s.hover&&(Math.hypot(s.vx,s.vz)>.15||Math.abs(s.vy)>.1||p.lastInput?.forward||p.lastInput?.side);
      const spread=w==='knife'?0:(scoped?.06*(1-Math.min(1,age/.25)):.18)+(moving?.12:0);
      const hit=castShot(this.world,origin,spreadDirection(s.yaw,s.pitch,spread,this.random()*Math.PI*2,Math.sqrt(this.random())),w==='knife'?2.7:100,targetPose);rays.push(hit.end);
      if(hit.hit){head=w==='sniper'&&hit.head;damage=w==='knife'?65:age<.65?(head?100:80):(head?95:76);}
    }
    this.emit(room,'shot',{shooter:p.id,weapon:w,origin,rays});
    if(damage>=.5)this.damage(room,p,target,damage,head,w,now);
  }
  tick(dt=STEP){
    const now=this.clock();
    for(const room of this.rooms.values()){
      if(now-room.touched>1800){for(const p of [...room.players]){p.client.send({type:'expired'});this.disconnect(p.client,false);}continue;}
      if(room.phase==='countdown'&&now>=room.deadline){room.phase='playing';room.deadline=now+room.rules.seconds;this.broadcast(room);}
      if(room.phase==='round'&&now>=room.deadline){
        if(room.players.some(p=>p.score>=room.rules.rounds)){room.phase='result';this.broadcast(room);}
        else this.beginRound(room);
      }
      if(room.phase==='playing'){
        for(const p of room.players){
          if(p.reloadEnd&&now>=p.reloadEnd){p.ammo[p.motion.weapon]=WEAPONS[p.motion.weapon].capacity;p.reloadEnd=0;}
          if(now>=p.hoverUntil)p.motion.hover=0;
          p.credit=Math.min(.1,p.credit+dt);
          while(p.queue.length&&p.credit+1e-8>=STEP&&room.phase==='playing'){
            const packet=p.queue.shift(),i={...packet.input};p.credit-=STEP;
            if(!allowed(room.rules).includes(i.weapon))i.weapon=allowed(room.rules)[0];
            if(i.weapon!==p.motion.weapon){p.reloadEnd=0;p.nextFire=Math.max(p.nextFire,now+.2);p.scopeAt=null;p.motion.aim=false;}
            if(p.reloadEnd)i.aim=false;
            if(i.aim&&!p.motion.aim)p.scopeAt=now;
            if(!i.aim)p.scopeAt=null;
            const used=p.motion.hoverUsed;moveOnline(this.world.physics,p.actor,p.motion,i,p.spawn);
            if(!used&&p.motion.hoverUsed)p.hoverUntil=now+.6;
            p.seq=packet.seq;p.lastInput=i;p.lastInputAt=now;
            if(packet.action)this.action(room,p,packet.action,now);
          }
          // A stalled/backgrounded browser cannot freeze itself in midair.
          if(now-p.lastInputAt>.15){
            p.scopeAt=null;moveOnline(this.world.physics,p.actor,p.motion,{forward:0,side:0,jump:false,sprint:false,crouch:p.motion.crouched,aim:false,weapon:p.motion.weapon,yaw:p.motion.yaw,pitch:p.motion.pitch},p.spawn);
          }
          p.history.push({at:now,motion:{...p.motion}});while(p.history.length>30)p.history.shift();
        }
        for(const k of room.projectiles){
          k.life-=dt;k.velocity.y-=5*dt;const delta=k.velocity.scale(dt),p=room.players.find(p=>p.id===k.owner),target=room.players.find(p=>p.id!==k.owner);
          const hit=castShot(this.world,k.position,delta.normalize(),delta.length()+.15,target?.motion);
          if(hit.hit&&p&&target){this.damage(room,p,target,100,hit.head,'knife',now);k.life=0;}
          else if(hit.distance<delta.length()+.149)k.life=0;
          k.position=k.position.add(delta);
        }
        room.projectiles=room.projectiles.filter(k=>k.life>0);
        if(now>=room.deadline){const [a,b]=room.players;this.finish(room,a.hp===b.hp?null:a.hp>b.hp?a:b,'Time limit');}
      }
      if(now-this.lastSnapshot>=.05)this.snapshot(room);
    }
    if(now-this.lastSnapshot>=.05)this.lastSnapshot=now;
  }
  snapshot(room){
    const now=this.clock();this.emit(room,'snapshot',{now,epoch:room.epoch,phase:room.phase,round:room.round,deadline:room.deadline,players:room.players.map(p=>({id:p.id,hp:p.hp,score:p.score,seq:p.seq,motion:p.motion,ammo:p.ammo,reload:Math.max(0,p.reloadEnd-now),knife:Math.max(0,p.knifeEnd-now),cooldown:Math.max(0,p.nextFire-now),spawn:p.spawn})),knives:room.projectiles.map(k=>({id:k.id,position:k.position,velocity:k.velocity}))});
  }
}
