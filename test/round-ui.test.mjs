import test from 'node:test';
import assert from 'node:assert/strict';
import {countdownNumber} from '../src/modules/countdown.ts';
import {soundEvents} from '../src/modules/soundEvents.ts';
import {canRematch} from '../src/modules/game.ts';

const player=()=>({name:'탐험가',connected:true,left:false,rematchReady:false,collected:0,summoned:0,kills:0,baseDamage:0,inventory:{}});
const state=()=>({matchId:'first',you:0,phase:'battle',players:[player(),player()],hp:[1200,1200],units:[],winner:null});
test('countdown is exactly 3,2,1 at server-aligned second boundaries',()=>{
 assert.equal(countdownNumber(10000,7000),3);assert.equal(countdownNumber(10000,7999),3);
 assert.equal(countdownNumber(10000,8000),2);assert.equal(countdownNumber(10000,9000),1);
 assert.equal(countdownNumber(10000,10500),1);
});
test('rematch requires result phase and two connected players who have not left',()=>{
 const s=state();assert.equal(canRematch(s),false);s.phase='result';assert.equal(canRematch(s),true);
 s.players[1].connected=false;assert.equal(canRematch(s),false);s.players[1].connected=true;s.players[1].left=true;assert.equal(canRematch(s),false);
 s.players[1]=null;assert.equal(canRematch(s),false);
});
test('audio does not replay old actions on initial load or a new rematch',()=>{
 const s=state();s.players[0].collected=6;assert.deepEqual(soundEvents(null,s),[]);
 const old=state();s.matchId='second';s.phase='result';s.winner=0;assert.deepEqual(soundEvents(old,s),[]);
});
test('confirmed collection, summoning and damage yield cues only once',()=>{
 const old=state(),s=state();s.players[0].collected=1;s.players[0].summoned=1;s.hp[1]=1180;
 assert.deepEqual(soundEvents(old,s),['collect','summon','stone']);assert.deepEqual(soundEvents(s,s),[]);
});
test('result sound handles victory, defeat and draw, and collapse only on destruction',()=>{
 for(const [winner,cue]of [[0,'win'],[1,'lose'],[null,'draw']]){
  const old=state(),s=state();s.phase='result';s.winner=winner;
  assert.deepEqual(soundEvents(old,s),[cue]);assert.deepEqual(soundEvents(s,s),[]);
 }
 const old=state(),s=state();s.hp[1]=0;s.phase='result';s.winner=0;
 assert.deepEqual(soundEvents(old,s),['collapse','win']);
});
test('a repeated snapshot never replays attack audio and countdown has one start cue',()=>{
 const old=state(),s=state();old.units=[{id:'u1',attackAt:100}];s.units=[{id:'u1',attackAt:300}];
 assert.deepEqual(soundEvents(old,s),['hit']);assert.deepEqual(soundEvents(s,s),[]);
 old.phase='countdown';s.phase='collect';s.units=[];assert.deepEqual(soundEvents(old,s),['go']);
});
