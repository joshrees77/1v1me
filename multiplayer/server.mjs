import {WebSocketServer} from 'ws';
import {Rooms} from './rooms.mjs';
import {loadWorld} from './world.mjs';
export async function attachMultiplayer(server){
  const world=await loadWorld(),rooms=new Rooms(world);
  const sockets=new WebSocketServer({noServer:true,maxPayload:4096,perMessageDeflate:false});
  server.on('upgrade',(req,socket,head)=>{
    let valid=false;
    try{valid=new URL(req.url,'http://localhost').pathname==='/multiplayer'&&(!req.headers.origin||new URL(req.headers.origin).host===req.headers.host);}catch{}
    if(!valid||sockets.clients.size>=64){socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');return;}
    sockets.handleUpgrade(req,socket,head,ws=>sockets.emit('connection',ws));
  });
  sockets.on('connection',ws=>{
    const c=rooms.connect(data=>{if(ws.readyState===1&&ws.bufferedAmount<262144)ws.send(JSON.stringify(data));else if(ws.bufferedAmount>=262144)ws.close(1013,'Connection too slow');});
    let messages=0,windowAt=performance.now(),alive=true,pingAt=0;
    ws.on('message',(data,binary)=>{
      const now=performance.now();if(now-windowAt>1000){messages=0;windowAt=now;}
      if(++messages>180||binary){ws.close(1008,'Invalid traffic');return;}
      try{rooms.receive(c,JSON.parse(data.toString()));}catch{ws.close(1007,'Invalid JSON');}
    });
    ws.on('pong',()=>{alive=true;c.rtt=Math.min(.4,(performance.now()-pingAt)/1000);});
    const heartbeat=setInterval(()=>{if(!alive){ws.terminate();return;}alive=false;pingAt=performance.now();ws.ping();},5000);
    ws.on('close',()=>{clearInterval(heartbeat);rooms.disconnect(c);});ws.on('error',()=>ws.terminate());
    c.send({type:'hello',version:1});
  });
  let previous=performance.now()/1000,accumulator=0;
  const loop=setInterval(()=>{
    const now=performance.now()/1000;accumulator=Math.min(.1,accumulator+now-previous);previous=now;
    while(accumulator>=1/60){rooms.tick(1/60);accumulator-=1/60;}
  },1000/60);
  return ()=>{clearInterval(loop);for(const c of [...rooms.clients])rooms.disconnect(c);for(const ws of sockets.clients)ws.terminate();sockets.close();world.physics.world.free();};
}
