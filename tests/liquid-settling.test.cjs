const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../game.js'), 'utf8');
const body = source.slice(source.indexOf('  function update(dt, time)'), source.indexOf('  function drawBackdrop'));
const simulate = new Function('reducedMotion', 'dt', 'fill', `
  let state='settling', pouring=false, displayedFill=fill*.8;
  let surfaceEnergy=.9, tilt=.12, settleTimer=0, settleDuration=950, wavePhase=0, gestureBlend=0, overfillBlend=0, evaluations=0;
  const vessel={target:.68};
  function evaluate() { state='result'; evaluations++; }
  ${body}
  update(dt, 0);
  const initialEnergy=surfaceEnergy, initialTilt=tilt, initialPhaseStep=wavePhase;
  let lastPhaseStep=wavePhase;
  const samples=[.9,initialEnergy];
  let energyBeforeFinish=surfaceEnergy;
  for(let time=dt;time<1200;time+=dt) {
    const settling=state==='settling';
    if(settling) energyBeforeFinish=surfaceEnergy;
    const previousPhase=wavePhase;
    update(dt,time);
    if(settling) lastPhaseStep=wavePhase-previousPhase;
    samples.push(surfaceEnergy);
  }
  return {state, fill, displayedFill, surfaceEnergy, tilt, evaluations, initialEnergy, initialTilt, samples, energyBeforeFinish, initialPhaseStep, lastPhaseStep};
`);
for (const reducedMotion of [false, true]) {
  for (const dt of [8, 16, 34]) {
    for (const fill of [.2, .68, 1.13]) {
      const result = simulate(reducedMotion, dt, fill);
      assert.equal(result.state, 'result');
      assert.equal(result.evaluations, 1);
      assert.equal(result.fill, fill);
      assert.equal(result.displayedFill, fill);
      assert.equal(result.surfaceEnergy, 0);
      assert.equal(result.tilt, 0);
      assert.ok(result.initialEnergy < .9 && result.initialTilt < .12);
      if (!reducedMotion) {
        assert.ok(result.lastPhaseStep < result.initialPhaseStep * .3, 'Wave motion slows gradually with its amplitude');
        assert.ok(result.initialEnergy > .85, 'Waves retain inertia immediately after release');
        assert.ok(result.energyBeforeFinish < .02, 'No visible wave left to snap flat');
        for(let i=1;i<result.samples.length;i++) {
          assert.ok(result.samples[i] <= result.samples[i-1], 'Wave amplitude decreases smoothly');
          assert.ok(result.samples[i-1]-result.samples[i] < .1, 'No abrupt amplitude change');
        }
      }
    }
  }
}
assert.ok(source.includes('if(displayedFill>.001 && surfaceEnergy>0)'), 'Hide curved surface highlight when settled');
console.log('Passed: liquid settles flat at the scored fill without changing the amount poured.');
