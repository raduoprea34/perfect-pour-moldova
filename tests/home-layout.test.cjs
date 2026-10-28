const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '../game.js'), 'utf8');
const body = source.slice(source.indexOf('  function metrics()'), source.indexOf('  function capacityHeight'));
const metrics = new Function('width', 'height', 'state', 'previewBounds', `const vessel={points:[[.43,1]]}, HAND_SIDE_PADDING=12, HAND_GLASS_GAP=8; ${body}; return metrics();`);

const pourBody = source.slice(source.indexOf('  function drawPour(time)'), source.indexOf('  function drawEffects'));
const drawPreview = new Function('metrics', 'ctx', 'jugSprite', 'width', `
  const state = 'intro', pouring = false;
  const colors = { light: '#fff', liquid: '#91283a' };
  ${pourBody}; drawPour(0);
`);

// Exercise the actual drawing code, including sprite bounds and stream length.
for (const [width, height] of [[272, 200], [327, 270], [420, 280], [260, 240], [500, 560]]) {
  const bounds = { left: 24, top: 16, width, height };
  const m = metrics(width + 48, 900, 'intro', bounds);
  const paths = [];
  let sprite;
  const ctx = new Proxy({
    createLinearGradient: () => ({ addColorStop() {} }),
    moveTo: (x, y) => paths.push([x, y]),
    drawImage: (...args) => { sprite = args.slice(1); }
  }, { get: (target, key) => target[key] ?? (() => {}) });
  drawPreview(() => m, ctx, { complete: true, naturalWidth: 1280, naturalHeight: 853 }, width + 48);
  const [x, y, w, h] = sprite;
  assert.ok(x >= bounds.left && x + w <= bounds.left + width, 'Jug fits horizontally');
  assert.ok(y >= bounds.top && y + h <= bounds.top + height, 'Jug fits vertically');
  assert.ok(m.bottom <= bounds.top + height, 'Glass fits vertically');
  assert.ok(m.cx - m.w * .43 >= bounds.left, 'Glass fits horizontally');
  const streamLength = m.top + m.h * .17 - paths[0][1];
  assert.ok(streamLength >= 35 && streamLength >= m.h * .31, 'Stream is clearly visible');
  const sceneLeft = m.cx - m.w * .43;
  assert.ok(Math.abs((sceneLeft + x + w) / 2 - (bounds.left + width / 2)) < 2, 'Scene is centered');
}
for (const [width, height] of [[320, 568], [390, 844], [720, 800], [1440, 900]]) {
  const m = metrics(width, height, 'ready');
  assert.ok(m.cx >= width / 2);
  assert.ok(m.cx + m.w * .59 <= width - 12 + 1e-8);
  assert.ok(m.top > 0 && m.bottom < height);
}
console.log('Passed: preview is centered, stream is visible, artwork fits, and gameplay respects its right margin.');
