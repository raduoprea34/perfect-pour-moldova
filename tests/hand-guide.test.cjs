const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../game.js'), 'utf8');
const body = source.slice(source.indexOf('  function drawHandGuide(time)'), source.indexOf('  function frame(time)'));
const metricsBody = source.slice(source.indexOf('  function metrics()'), source.indexOf('  function capacityHeight'));
const gap = Number(source.match(/const HAND_GLASS_GAP = (\d+)/)[1]);
const padding = Number(source.match(/const HAND_SIDE_PADDING = (\d+)/)[1]);
const draw = new Function('width', 'ctx', 'gestureBlend', 'overfillBlend', `
  const state='ready', height=844, reducedMotion=false, HAND_SIDE_PADDING=${padding}, HAND_GLASS_GAP=${gap};
  const handSprite={complete:true,naturalWidth:1280,naturalHeight:853};
  const overfillHand={...handSprite};
  const vessel={points:[[0,0],[.43,1]]};
  ${metricsBody}
  ctx.layout = metrics();
  ${body}; drawHandGuide(100);
`);
for (const width of [280, 320, 375, 390, 720, 1440]) {
  for (const phase of [0, .6, 1]) {
    const ctx = new Proxy({
      measureText: text => ({width:text.length*9}),
      drawImage: (...args) => {
        if (args.length !== 9) return;
        const [x, , w] = args.slice(5);
        assert.ok(x >= padding && x+w <= width-padding, 'Hand fits');
      },
      translate: (x) => {
        const size = ctx.layout.guideSize;
        const radius = size*.72;
        assert.ok(x-radius >= padding && x+radius <= width-padding, 'Overfill hand fits, including rotation');
      },
      fillText: (text, x, y, maxWidth) => {
        const half = Math.min(text.length*9,maxWidth)/2;
        assert.ok(x-half >= padding-1e-8 && x+half <= width-padding+1e-8, 'Label fits');
      }
    }, {get:(target,key)=>target[key]??(()=>{})});
    draw(width, ctx, phase, phase);
    const m = ctx.layout;
    if (width === 375 || width === 390) assert.ok(m.h >= 320, 'Phone glass keeps a useful size');
    const glassLeft = m.cx - m.w*.43;
    assert.ok(Math.abs(glassLeft - (m.guideX + m.guideWidth/2) - gap) < 1e-8, 'Fixed hand-to-glass gap');
    assert.ok(m.guideX-m.guideWidth/2 >= padding-1e-8, 'Group respects left margin');
    assert.ok(m.cx+m.w*.59 <= width-padding+1e-8, 'Glass respects right margin');
  }
}
console.log('Passed: hand gestures and labels respect side padding and a fixed glass gap at narrow and desktop widths.');
