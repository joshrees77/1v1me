export class DuelClient {
  constructor(onMessage,onClose){this.onMessage=onMessage;this.onClose=onClose;this.id=null;this.ws=null;this.ping=0;}
  async connect(){
    this.close();
    const url=new URL('/multiplayer',location.href);url.protocol=location.protocol==='https:'?'wss:':'ws:';
    const ws=this.ws=new WebSocket(url);
    await new Promise((resolve,reject)=>{
      let ready=false;
      const timeout=setTimeout(()=>{reject(Error('Cannot connect to the multiplayer server. Use the Railway address or run npm start.'));ws.close();},12000);
      ws.onmessage=e=>{
        let m;try{m=JSON.parse(e.data);}catch{return;}
        if(m.type==='hello'){ready=true;clearTimeout(timeout);resolve();return;}
        if(m.type==='pong'){const sample=Math.max(0,performance.now()-m.stamp);this.ping=Math.round(this.ping?this.ping*.75+sample*.25:sample);return;}
        if(m.type==='joined')this.id=m.id;
        this.onMessage(m);
      };
      ws.onerror=()=>{if(!ready){clearTimeout(timeout);reject(Error('Multiplayer is unavailable at this address. Run the Railway server with npm start.'));}};
      ws.onclose=()=>{clearTimeout(timeout);if(!ready)reject(Error('Connection closed.'));if(this.ws===ws){this.ws=null;clearInterval(this.timer);this.onClose();}};
    });
    this.send({type:'ping',stamp:performance.now()});
    this.timer=setInterval(()=>this.send({type:'ping',stamp:performance.now()}),1000);
  }
  send(message){if(this.ws?.readyState===1&&this.ws.bufferedAmount<65536){this.ws.send(JSON.stringify(message));return true;}return false;}
  close(){clearInterval(this.timer);if(this.ws){const ws=this.ws;this.ws=null;ws.close();}this.id=null;}
}
