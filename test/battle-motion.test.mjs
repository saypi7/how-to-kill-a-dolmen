import assert from 'node:assert/strict';
import test from 'node:test';
import {attackMotion,fitSprite,hitMotion,screenDirection,smoothPosition,travelMotion,unitDirection} from '../src/modules/battleMotion.ts';

test('target direction follows enemies on either side, including units behind the usual front',()=>{
 const units=[{id:'enemy',x:300}];
 assert.equal(unitDirection({side:0,x:400,target:'enemy'},units,[85,1115]),-1);
 assert.equal(unitDirection({side:1,x:200,target:'enemy'},units,[85,1115]),1);
 assert.equal(unitDirection({side:1,x:300,target:'base:0'},units,[85,1115]),-1);
 assert.equal(unitDirection({side:0,x:300,target:'missing'},units,[85,1115]),1);
});

test('both viewers mirror movement and attack direction consistently',()=>{
 for(const direction of [-1,1])assert.equal(screenDirection(direction,0),-screenDirection(direction,1));
 assert.equal(screenDirection(-1,1),1);
});

test('attack has one brief windup, forward lunge and return instead of a perpetual oscillation',()=>{
 const options={attackAt:1000,role:'assault',direction:1,interval:1000};
 assert.ok(attackMotion({...options,now:1050}).x<0);
 assert.ok(attackMotion({...options,now:1176}).x>7);
 assert.ok(attackMotion({...options,now:1360}).x>0);
 assert.deepEqual(attackMotion({...options,now:1420}),{x:0,y:0,rotation:0});
 assert.deepEqual(attackMotion({...options,now:9000}),{x:0,y:0,rotation:0});
 assert.deepEqual(attackMotion({...options,now:900}),{x:0,y:0,rotation:0});
});

test('attack displacement points toward the actual target, even for mirrored players',()=>{
 const options={attackAt:1000,now:1176,role:'tank',interval:1000};
 const left=attackMotion({...options,direction:-1}),right=attackMotion({...options,direction:1});
 assert.equal(left.x,-right.x);assert.equal(left.rotation,-right.rotation);
 assert.ok(Math.abs(left.x)<=5);
});

test('missing attack timestamp cannot produce an invented attack',()=>{
 for(const attackAt of [undefined,0,NaN])assert.equal(attackMotion({attackAt,now:1000,role:'assault'}).x,0);
});

test('position smoothing yields the same result at 30 and 120 fps',()=>{
 let slow=0,fast=0;
 for(let i=0;i<30;i++)slow=smoothPosition(slow,100,1000/30);
 for(let i=0;i<120;i++)fast=smoothPosition(fast,100,1000/120);
 assert.ok(Math.abs(slow-fast)<1e-8);
 assert.ok(slow<100);
});

test('flying units hover while grounded roles stay on the combat line',()=>{
 const flying=travelMotion({now:1000,role:'flying',moving:false});
 assert.ok(flying.y<-25&&flying.y>-35);
 assert.deepEqual(travelMotion({now:1000,role:'tank',moving:false}),{y:0,rotation:0});
});

test('reduced motion retains flying height and disables cosmetic movement',()=>{
 assert.deepEqual(travelMotion({now:1000,role:'flying',moving:true,reducedMotion:true}),{y:-30,rotation:0});
 assert.deepEqual(attackMotion({attackAt:1000,now:1100,role:'assault',reducedMotion:true}),{x:0,y:0,rotation:0});
 assert.equal(hitMotion({hitAt:1000,now:1050,reducedMotion:true}).x,0);
 assert.equal(smoothPosition(0,100,16,true),100);
});

test('hit recoil points away from the enemy and ends promptly',()=>{
 assert.ok(hitMotion({hitAt:1000,now:1090,direction:1}).x<0);
 assert.ok(hitMotion({hitAt:1000,now:1090,direction:-1}).x>0);
 assert.deepEqual(hitMotion({hitAt:1000,now:1180}),{x:0,highlight:false});
});

test('sprite and dolmen fitting preserves the original aspect ratio',()=>{
 const fitted=fitSprite(1216,849.6,152,123);
 assert.ok(Math.abs(fitted.width/fitted.height-1216/849.6)<1e-10);
 assert.ok(fitted.width<=152&&fitted.height<=123);
 assert.deepEqual(fitSprite(0,0,120,100),{width:120,height:100});
});
