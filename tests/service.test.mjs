import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Store} from '../src/store.mjs';
import {MatchService} from '../src/service.mjs';
import {createHttpServer} from '../src/server.mjs';
const settings={planningMs:1000,conflictMs:500,maxTurns:5};
function setup(){const store=new Store(':memory:');const service=new MatchService(store,{now:()=>0,settings});const match=service.create({names:['A','B','C','D','E']});return{store,service,match};}
test('atomic optimistic commands and idempotency',()=>{
  const {store,service,match}=setup();try{
    const token=match.seats[0].token,id=match.matchId,input={requestId:'request_001',expectedVersion:0,command:{type:'order',order:{type:'collect'}}};
    assert.equal(service.command(id,token,input).view.version,1);assert.equal(service.command(id,token,input).replayed,true);assert.equal(store.load(id).version,1);
    assert.throws(()=>service.command(id,token,{...input,command:{type:'seal'}}),{code:'IDEMPOTENCY_CONFLICT'});assert.throws(()=>service.command(id,token,{...input,requestId:'request_002'}),{code:'STALE_VERSION'});
    assert.equal(store.db.prepare('SELECT count(*) AS n FROM commands').get().n,1);const before=JSON.stringify(store.load(id));
    assert.throws(()=>service.command(id,token,{requestId:'invalid_001',expectedVersion:1,command:{type:'order',order:{type:'move',target:7}}}));assert.equal(JSON.stringify(store.load(id)),before);
  }finally{store.close();}
});
test('seat tokens are hashed and match-scoped',()=>{
  const {store,service,match}=setup();try{const other=service.create({names:['X','Y']});assert.throws(()=>service.view(other.matchId,match.seats[0].token),{code:'UNAUTHORIZED'});assert.throws(()=>service.view(match.matchId,'wrong'),{code:'UNAUTHORIZED'});assert.ok(store.db.prepare('SELECT * FROM seats').all().every(r=>!JSON.stringify(r).includes(match.seats[0].token)));}finally{store.close();}
});
test('failed receipt insert rolls back state and transition',()=>{
  const {store,service,match}=setup();try{store.db.exec("CREATE TRIGGER reject_command BEFORE INSERT ON commands BEGIN SELECT RAISE(ABORT,'injected'); END");assert.throws(()=>service.command(match.matchId,match.seats[0].token,{requestId:'test_fail_1',expectedVersion:0,command:{type:'seal'}}));assert.equal(store.load(match.matchId).version,0);assert.equal(store.db.prepare('SELECT count(*) AS n FROM transitions').get().n,0);}finally{store.close();}
});
test('SQLite reopen recovers a conflict and settles exactly once',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'shotcaller-')),path=join(dir,'state.sqlite');let store=new Store(path),now=0,service=new MatchService(store,{now:()=>now,settings});const match=service.create({names:['A','B','C']});
  const send=(seat,command)=>service.command(match.matchId,seat.token,{requestId:'request_'+store.load(match.matchId).version,expectedVersion:store.load(match.matchId).version,command});
  try{for(const seat of match.seats.slice(0,2)){send(seat,{type:'order',order:{type:'move',target:1}});send(seat,{type:'seal'});}now=1000;service.sweep();send(match.seats[0],{type:'vote',conflictId:'t1-c1',choice:'engage'});
    store.close();store=new Store(path);service=new MatchService(store,{now:()=>now,settings});assert.equal(store.load(match.matchId).phase,'conflict');now=1500;assert.equal(service.sweep(),1);assert.equal(service.sweep(),0);const state=store.load(match.matchId);assert.equal(state.players[1].alive,false);assert.equal(state.settledTurn,1);assert.equal(state.deadlineAt,2500);
  }finally{store.close();await rm(dir,{recursive:true,force:true});}
});
test('HTTP identity, strict fields, body limit and privacy',async()=>{
  const {store,service}=setup(),adminToken='a'.repeat(64),server=createHttpServer(service,{adminToken,tickMs:10000});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+server.address().port;
  const request=(path,token,data)=>fetch(base+path,{method:data?'POST':'GET',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:data?JSON.stringify(data):undefined});
  try{assert.equal((await request('/matches','bad',{names:['X','Y']})).status,401);const created=await(await request('/matches',adminToken,{names:['X','Y']})).json(),seat=created.seats[0],path='/matches/'+created.matchId;
    assert.equal((await request(path,'bad')).status,401);assert.equal((await(await request(path,seat.token)).json()).selfId,'p1');assert.equal((await request(path+'/commands',seat.token,{requestId:'http_0001',expectedVersion:0,command:{type:'seal'},playerId:'p2'})).status,400);
    await request(path+'/commands',seat.token,{requestId:'http_0001',expectedVersion:0,command:{type:'order',order:{type:'collect'}}});const opponent=await(await request(path,created.seats[1].token)).json();assert.equal(opponent.self.order,null);assert.ok(!JSON.stringify(opponent).includes('collect'));
    assert.equal((await fetch(base+'/health')).headers.get('cache-control'),'no-store');assert.equal((await request(path+'/commands',seat.token,{padding:'x'.repeat(10000)})).status,413);
  }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));store.close();}
});
