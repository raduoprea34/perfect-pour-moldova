const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../game.js'), 'utf8');
const body = source.slice(source.indexOf('  function returnHome()'), source.indexOf('  function beginPour()'));
const run = new Function('state', `
  const classes=new Set(['playing','pouring','show-result','assets-ready']);
  const shell={classList:{remove:(...names)=>names.forEach(name=>classes.delete(name)),contains:name=>classes.has(name)}};
  let stopped=0, resized=0, focused=0;
  const audio={stopPour:()=>stopped++};
  const startButton={focus:()=>focused++};
  const canvas={classList:{remove(){}}}, instructionText={};
  let fill=.7, displayedFill=.65, pouring=true, settleTimer=100, surfaceEnergy=.8, gestureBlend=1, overfillBlend=1, tilt=.1;
  let droplets=[1], bubbles=[1], rings=[1], sparks=[1];
  const score=750, round=3, streak=2, best=98;
  function resize(){if(state!=='intro')throw new Error('Resize before intro');resized++;}
  ${body}
  returnHome();
  return {state,classes:[...classes],stopped,resized,focused,fill,displayedFill,pouring,surfaceEnergy,tilt,settleTimer,particles:droplets.length+bubbles.length+rings.length+sparks.length,score,round,streak,best};
`);
for (const state of ['ready','pouring','settling','result']) {
  const result=run(state);
  assert.equal(result.state,'intro');
  assert.deepEqual(result.classes,['assets-ready']);
  assert.equal(result.stopped,1);
  assert.equal(result.resized,1);
  assert.equal(result.focused,1);
  for (const key of ['fill','displayedFill','surfaceEnergy','tilt','settleTimer','particles']) assert.equal(result[key],0);
  assert.equal(result.pouring,false);
  assert.deepEqual([result.score,result.round,result.streak,result.best],[750,3,2,98]);
}
console.log('Passed: return home stops pouring, clears effects, restores focus, and preserves progress.');
