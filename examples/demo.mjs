import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {randomUUID,randomBytes} from 'node:crypto';
import {Store} from '../src/store.mjs';
import {MatchService} from '../src/service.mjs';
import {createHttpServer} from '../src/server.mjs';
const directory=resolve('data/demo',randomUUID());await mkdir(directory,{recursive:true,mode:0o700});
const database=resolve(directory,'engine.sqlite'),adminToken=randomBytes(32).toString('hex');let now=0,store,service,server,base;
async function start(){store=new Store(database);service=new MatchService(store,{now:()=>now,settings:{planningMs:1000,conflictMs:500,maxTurns:3}});server=createHttpServer(service,{adminToken,tickMs:10000});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));base='http://127.0.0.1:'+server.address().port;}
async function stop(){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));store.close();}
async function request(path,token,data){const response=await fetch(base+path,{method:data?'POST':'GET',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:data?JSON.stringify(data):undefined});const result=await response.json();assert.ok(response.ok,JSON.stringify(result));return result;}
await start();try{
  const match=await request('/matches',adminToken,{names:['Amber','Blue','Coral','Dusk','Elm']}),path='/matches/'+match.matchId;
  async function send(seat,command){const view=await request(path,seat.token);return request(path+'/commands',seat.token,{requestId:randomUUID(),expectedVersion:view.version,command});}
  for(const seat of match.seats.slice(0,2)){await send(seat,{type:'order',order:{type:'move',target:1}});await send(seat,{type:'seal'});}
  const hidden=await request(path,match.seats[2].token);assert.equal(hidden.self.order,null);assert.ok(hidden.players.every(p=>!Object.hasOwn(p,'order')));console.log('Five authenticated seats; opponents receive no private orders.');
  now=1000;service.sweep();await send(match.seats[0],{type:'vote',conflictId:'t1-c1',choice:'engage'});console.log('Simultaneous moves opened a conflict; private vote persisted.');
  await stop();await start();const resumed=await request(path,match.seats[0].token);assert.equal(resumed.phase,'conflict');assert.equal(resumed.conflicts[0].selfChoice,'engage');console.log('Restarted server and SQLite connection; conflict recovered.');
  now=1500;service.sweep();const result=await request(path,match.seats[0].token);assert.equal(result.players.find(p=>p.id==='p2').alive,false);assert.equal(result.players[0].position,1);assert.equal(result.settledTurn,1);assert.equal(service.sweep(),0);console.log('Timeout settled once. Amber survived.\nDemo passed. Database: '+database);
}finally{await stop();}
