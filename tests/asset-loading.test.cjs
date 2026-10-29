const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../game.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
for (const [,asset] of source.matchAll(/\.src = '(assets\/[^']+)'/g)) {
  assert.ok(html.includes(`href="${asset}"`), 'Artwork preload matches runtime URL');
  assert.ok(fs.existsSync(path.join(__dirname, '..', asset)), 'Artwork exists');
}
const body = source.slice(source.indexOf('  async function loadAssets()'), source.indexOf('  function resetPour()'));
function harness(decode) {
  const create = new Function('decode', `
    let assetsReady=false, assetsLoading=false, audio=null, state='intro', starts=0;
    const handSprite={decode,src:'hand'}, jugSprite={decode,src:'jug'}, overfillHand={decode,src:'overfill'};
    const startButton={disabled:true}, startLabel={}, assetStatus={hidden:false};
    const classes=new Set();
    const shell={classList:{add:value=>classes.add(value)}};
    const document={body:{scrollTop:0}};
    class SoundEngine { wake() { starts++; } }
    function resetPour() {} function resize() {}
    ${body}
    return {loadAssets,startGame,startButton,startLabel,assetStatus,classes,get starts(){return starts;}};
  `);
  return create(decode);
}
(async () => {
  const releases=[];
  const app=harness(()=>new Promise(resolve=>releases.push(resolve)));
  const loading=app.loadAssets();
  app.startGame();
  await app.loadAssets();
  assert.equal(releases.length,3, 'No duplicate loading while pending');
  assert.equal(app.starts,0, 'Keyboard cannot start game before assets are ready');
  assert.equal(app.startButton.disabled,true);
  releases[0](); releases[1]();
  await Promise.resolve();
  assert.equal(app.classes.has('assets-ready'),false, 'Wait for every image');
  releases[2](); await loading;
  assert.equal(app.classes.has('assets-ready'),true);
  assert.equal(app.assetStatus.hidden,true);
  assert.equal(app.startButton.disabled,false);
  app.startGame(); assert.equal(app.starts,1);

  let failed=true;
  const retry=harness(()=>failed?Promise.reject(new Error('offline')):Promise.resolve());
  await retry.loadAssets();
  assert.equal(retry.startLabel.textContent,'Reîncearcă');
  assert.equal(retry.startButton.disabled,false);
  assert.equal(retry.classes.has('assets-ready'),false);
  failed=false;
  retry.startGame();
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(retry.classes.has('assets-ready'),true);
  assert.equal(retry.starts,0, 'Retry loads artwork without unexpectedly starting play');
  retry.startGame(); assert.equal(retry.starts,1);
  console.log('Passed: loading gate, keyboard guard, failure state, and retry.');
})().catch(error=>{console.error(error);process.exitCode=1;});
