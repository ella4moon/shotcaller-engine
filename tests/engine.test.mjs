import test from 'node:test';
import assert from 'node:assert/strict';
import {createMatch,applyCommand,advanceDeadline,playerView,assertInvariants} from '../src/engine.mjs';
const create=(extra={})=>createMatch({id:'test',names:['Amber','Blue','Coral','Dusk','Elm'],now:0,planningMs:1000,conflictMs:500,...extra});
const order=(s,id,value)=>applyCommand(s,id,{type:'order',order:value},{now:2});
const seal=(s,id)=>applyCommand(s,id,{type:'seal'},{now:2});
function contested(){let s=create();s=seal(order(s,'p1',{type:'move',target:1}),'p1');s=seal(order(s,'p2',{type:'move',target:1}),'p2');return advanceDeadline(s,1000);}
test('deterministic setup and invalid command atomicity',()=>{
  const s=create(),snapshot=JSON.stringify(s);assert.deepEqual(s,create());
  for(const cmd of [{type:'order',order:{type:'move',target:6}},{type:'order',order:{type:'collect',target:1}},{type:'teleport'},{type:'seal',now:0}])assert.throws(()=>applyCommand(s,'p1',cmd,{now:1}));
  assert.equal(JSON.stringify(s),snapshot);
});
test('all sealed orders wait for the deadline',()=>{let s=create();for(const p of s.players)s=seal(s,p.id);assert.equal(s.turn,1);assert.equal(advanceDeadline(s,999),s);assert.equal(advanceDeadline(s,1000).turn,2);});
test('unsealed orders become hold',()=>{assert.equal(advanceDeadline(order(create(),'p1',{type:'collect'}),1000).players[0].treasury,0);});
test('settlement is once-only and overdue recovery opens a fresh window',()=>{
  let s=seal(order(create(),'p1',{type:'collect'}),'p1');const income=s.districts[0].income;s=advanceDeadline(s,500000);
  assert.equal(s.players[0].treasury,income);assert.equal(s.settledTurn,1);assert.equal(s.deadlineAt,501000);assert.equal(advanceDeadline(s,500000),s);
});
test('serialized conflicts resume with secret choices',()=>{
  let s=contested();assert.equal(s.phase,'conflict');assert.deepEqual(s.conflicts[0].participants,['p1','p2']);
  s=applyCommand(s,'p1',{type:'vote',conflictId:'t1-c1',choice:'engage'},{now:1001});const view=playerView(s,'p2');assert.equal(view.conflicts[0].selfChoice,null);
  for(const key of ['pending','choices','seed','token'])assert.ok(!JSON.stringify(view).includes('"'+key+'"'));
  assert.ok(view.players.every(p=>!Object.hasOwn(p,'treasury')&&!Object.hasOwn(p,'order')));
  const done=advanceDeadline(JSON.parse(JSON.stringify(s)),1500);assert.equal(done.players[0].position,1);assert.equal(done.players[1].alive,false);assert.equal(done.turn,2);
});
test('all withdraw preserves positions',()=>{assert.deepEqual(advanceDeadline(contested(),1500).players.slice(0,2).map(p=>p.position),[0,2]);});
test('multiple engage eliminates the whole conflict group',()=>{
  let s=contested();for(const id of ['p1','p2'])s=applyCommand(s,id,{type:'vote',conflictId:'t1-c1',choice:'engage'},{now:1001});assert.equal(s.players.filter(p=>p.alive).length,3);
});
test('connected attack chain settles each unit once',()=>{
  let s=create();s.players[1].position=1;s.players[2].position=2;s=seal(order(s,'p1',{type:'attack',target:1}),'p1');s=seal(order(s,'p2',{type:'attack',target:2}),'p2');s=advanceDeadline(s,1000);
  assert.deepEqual(s.conflicts[0].participants,['p1','p2','p3']);
  for(const id of ['p1','p2','p3'])s=applyCommand(s,id,{type:'vote',conflictId:'t1-c1',choice:id==='p1'?'engage':'withdraw'},{now:1001});
  assertInvariants(s);assert.equal(s.players[0].position,1);assert.equal(s.players.filter(p=>!p.alive).length,2);
});
test('unauthorized, repeat, and late votes fail',()=>{
  let s=contested();assert.throws(()=>applyCommand(s,'p3',{type:'vote',conflictId:'t1-c1',choice:'engage'},{now:1001}),{code:'NOT_PARTICIPANT'});
  s=applyCommand(s,'p1',{type:'vote',conflictId:'t1-c1',choice:'withdraw'},{now:1001});
  assert.throws(()=>applyCommand(s,'p1',{type:'vote',conflictId:'t1-c1',choice:'engage'},{now:1002}),{code:'VOTE_LOCKED'});
  assert.throws(()=>applyCommand(s,'p2',{type:'vote',conflictId:'t1-c1',choice:'engage'},{now:1500}),{code:'DEADLINE_PASSED'});
});
test('turn limit supports score ties',()=>{const s=advanceDeadline(create({maxTurns:1}),1000);assert.equal(s.phase,'finished');assert.equal(s.winners.length,5);assert.equal(s.deadlineAt,null);});
test('total elimination is a draw',()=>{
  let s=create({names:['A','B']});s=seal(order(s,'p1',{type:'move',target:1}),'p1');s=seal(order(s,'p2',{type:'move',target:1}),'p2');s=advanceDeadline(s,1000);
  for(const id of ['p1','p2'])s=applyCommand(s,id,{type:'vote',conflictId:'t1-c1',choice:'engage'},{now:1001});assert.equal(s.phase,'finished');assert.deepEqual(s.winners,[]);
});
test('clock regression and view mutation cannot change authority',()=>{
  const s=seal(create(),'p1');assert.throws(()=>advanceDeadline(s,1),{code:'CLOCK_REGRESSION'});const view=playerView(s,'p1');view.players[0].position=9;view.self.order.type='move';assert.equal(s.players[0].position,0);assert.equal(s.players[0].order.type,'hold');
});
test('100 seeded complete simulations preserve invariants',()=>{
  for(let run=0;run<100;run++){let s=create({seed:String(run),maxTurns:6}),now=0;
    while(s.phase!=='finished'){
      if(s.phase==='planning')for(const p of s.players.filter(p=>p.alive)){
        const target=(p.position+1)%s.districts.length;s=applyCommand(s,p.id,{type:'order',order:(run+s.turn)%3?{type:'move',target}:{type:'collect'}},{now:now+1});s=applyCommand(s,p.id,{type:'seal'},{now:now+1});
      }
      now=s.deadlineAt;s=advanceDeadline(s,now);assertInvariants(s);
    }assert.equal(s.settledTurn,6);
  }
});
