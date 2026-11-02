import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import http from 'node:http';
import {once} from 'node:events';
const child=spawn(process.execPath,['server.mjs'],{env:{...process.env,PORT:'0',HOST:'0.0.0.0'},stdio:['ignore','pipe','pipe']});
let log='',error='';child.stderr.on('data',x=>error+=x);
const port=await new Promise((resolve,reject)=>{
 const timer=setTimeout(()=>reject(new Error('Server startup timed out: '+error)),30000);
 child.stdout.on('data',x=>{log+=x;const m=log.match(/0\.0\.0\.0:(\d+)/);if(m){clearTimeout(timer);resolve(Number(m[1]));}});
 child.once('exit',code=>{clearTimeout(timer);reject(new Error('Server exited: '+code+' '+error));});
});
const request=(path,method='GET')=>new Promise((resolve,reject)=>{
 const req=http.request({host:'127.0.0.1',port,path,method},res=>{const chunks=[];res.on('data',x=>chunks.push(x));res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,body:Buffer.concat(chunks)}));});req.on('error',reject);req.end();
});
try {
 let r=await request('/health');assert.equal(r.status,200);assert.equal(JSON.parse(r.body).status,'ok');
 r=await request('/');assert.equal(r.status,200);assert.match(r.body.toString(),/BUILD 0.19/);
 r=await request('/game.js');assert.equal(r.status,200);assert.match(r.headers['content-type'],/javascript/);
 r=await request('/assets/rust/map.bin.gz');assert.equal(r.status,200);assert.equal(r.headers['content-encoding'],undefined);assert.deepEqual([...r.body.subarray(0,2)],[31,139]);assert.equal(r.body.length,Number(r.headers['content-length']));
 r=await request('/assets/rust/map.bin.gz','HEAD');assert.equal(r.status,200);assert.equal(r.body.length,0);assert.ok(Number(r.headers['content-length'])>1e6);
 for(const path of ['/..%2fpackage.json','/.git/config','/%2e%2e%2fserver.mjs'])assert.equal((await request(path)).status,403,'reject '+path);
 assert.equal((await request('/%E0%A4%A')).status,400);
 assert.equal((await request('/missing-file')).status,404);
 assert.equal((await request('/','POST')).status,405);
 console.log('PASS Railway server: PORT/host, health, HTML/JS/map assets, raw gzip, HEAD, missing files, methods and traversal protection.');
}finally{const ended=once(child,'exit');child.kill('SIGTERM');await ended;}
