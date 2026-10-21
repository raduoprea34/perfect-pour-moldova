(() => {
  'use strict';

  const canvas = document.querySelector('#game');
  const ctx = canvas.getContext('2d');
  const handSprite = new Image();
  handSprite.src = 'assets/hand-gestures.png';
  const jugSprite = new Image();
  jugSprite.src = 'assets/pouring-jug-realistic.png';
  const overfillHand = new Image();
  overfillHand.src = 'assets/hand-overfill.png';
  const shell = document.querySelector('#gameShell');
  const startButton = document.querySelector('#startButton');
  const nextButton = document.querySelector('#nextButton');
  const resetButton = document.querySelector('#resetButton');
  const soundButton = document.querySelector('#soundButton');
  const scoreElement = document.querySelector('#score');
  const streakElement = document.querySelector('#streak');
  const roundLabel = document.querySelector('#roundLabel');
  const vesselName = document.querySelector('#vesselName');
  const instructionText = document.querySelector('#instructionText');
  const scaleMarker = document.querySelector('#scaleMarker');
  const resultKicker = document.querySelector('#resultKicker');
  const resultPercent = document.querySelector('#resultPercent');
  const resultMessage = document.querySelector('#resultMessage');
  const bestScore = document.querySelector('#bestScore');

  const TAU = Math.PI * 2;
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const palette = [
    { liquid: '#91283a', light: '#d65b64', dark: '#4b111b', clay: '#b66f45', glaze: '#e5b87e' },
    { liquid: '#9a2c38', light: '#df646a', dark: '#521118', clay: '#a9603d', glaze: '#dfad70' },
    { liquid: '#852536', light: '#ca5260', dark: '#46101a', clay: '#c17c4d', glaze: '#edc38b' },
    { liquid: '#932535', light: '#d95762', dark: '#4d1019', clay: '#ae6841', glaze: '#ddb17b' }
  ];
  const vessels = [
    { name: 'Cristal cu stele', type: 'crystal', handle: true, target: .68, speed: .255, points: [[0,.15],[.38,.15],[.39,.33],[.38,.75],[.31,.95],[.22,.99],[0,1]] },
    { name: 'Căniță de lut', type: 'clay', handle: true, target: .61, speed: .235, points: [[0,.14],[.32,.14],[.36,.34],[.39,.72],[.32,.95],[.20,.99],[0,1]] },
    { name: 'Cristal fațetat', type: 'crystal', handle: false, target: .74, speed: .27, points: [[0,.14],[.36,.14],[.34,.54],[.28,.91],[.20,.99],[0,1]] },
    { name: 'Cană cu brâu', type: 'clay', handle: true, target: .57, speed: .225, points: [[0,.13],[.35,.13],[.38,.35],[.43,.68],[.35,.94],[.22,.99],[0,1]] }
  ];
  console.assert(palette.every(color => color.clay && color.glaze) && vessels.every(item => ['clay','crystal'].includes(item.type) && item.target > 0 && item.target < 1), 'Invalid vessel theme');

  let width = 0, height = 0, dpr = 1;
  let state = 'intro';
  let round = Number(localStorage.getItem('pour-round') || 0);
  let score = Number(localStorage.getItem('pour-score') || 0);
  let streak = Number(localStorage.getItem('pour-streak') || 0);
  let best = Number(localStorage.getItem('pour-best') || 0);
  let vessel = vessels[round % vessels.length];
  let colors = palette[round % palette.length];
  let fill = 0;
  let displayedFill = 0;
  let pouring = false;
  let pourStart = 0;
  let settleTimer = 0;
  let surfaceEnergy = 0;
  let gestureBlend = 0;
  let overfillBlend = 0;
  let tilt = 0;
  let droplets = [];
  let bubbles = [];
  let rings = [];
  let sparks = [];
  let audio = null;
  let muted = localStorage.getItem('pour-muted') === 'true';
  let lastTime = performance.now();
  let pointerX = innerWidth / 2;

  class SoundEngine {
    constructor() {
      this.pourSound = new Audio('pour_sound.m4a');
      this.pourSound.preload = 'auto';
      this.pourSound.loop = true;
      this.pourSound.volume = .72;
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return;
      this.context = new AudioContext();
      this.master = this.context.createGain();
      this.master.gain.value = .21;
      this.master.connect(this.context.destination);
    }
    wake() { if (this.context?.state === 'suspended') this.context.resume(); }
    startPour() {
      if (muted || !this.pourSound.paused) return;
      this.pourSound.currentTime = 0;
      this.pourSound.play().catch(() => {});
    }
    stopPour() {
      this.pourSound.pause();
      this.pourSound.currentTime = 0;
    }
    tone(frequency, duration = .35, volume = .25, delay = 0) {
      if (!this.context || muted) return;
      const now = this.context.currentTime + delay;
      const osc = this.context.createOscillator();
      const gain = this.context.createGain();
      osc.type = 'sine'; osc.frequency.value = frequency;
      gain.gain.setValueAtTime(0, now); gain.gain.linearRampToValueAtTime(volume, now + .015); gain.gain.exponentialRampToValueAtTime(.001, now + duration);
      osc.connect(gain); gain.connect(this.master); osc.start(now); osc.stop(now + duration + .02);
    }
    result(quality) {
      if (quality > .94) { this.tone(523, .5); this.tone(659, .5, .22, .09); this.tone(784, .7, .2, .18); }
      else if (quality > .75) { this.tone(392, .42); this.tone(523, .5, .18, .12); }
      else this.tone(260, .45, .18);
    }
  }

  function resize() {
    width = innerWidth; height = innerHeight; dpr = Math.min(devicePixelRatio || 1, 2);
    canvas.width = width * dpr; canvas.height = height * dpr;
    canvas.style.width = `${width}px`; canvas.style.height = `${height}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function metrics() {
    const mobile = width < 720;
    const h = Math.min(height * (mobile ? .47 : .55), mobile ? 385 : 440);
    const w = h * .62;
    const top = height * (mobile ? .34 : .31);
    return { cx: width * .5, top, bottom: top + h, h, w };
  }

  function capacityHeight(m) { return m.h*(1-vessel.points[1][1]); }

  function halfWidthAt(t) {
    const points = vessel.points;
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i], b = points[i + 1];
      if (t >= a[1] && t <= b[1]) {
        const mix = (t - a[1]) / (b[1] - a[1]);
        return a[0] + (b[0] - a[0]) * mix;
      }
    }
    return points[points.length - 1][0];
  }

  function vesselPath() {
    const m = metrics();
    const profile = vessel.points.slice(1);
    const left = profile.map(([x,y]) => ({x:m.cx-x*m.w,y:m.top+y*m.h}));
    const right = [...profile].reverse().slice(1).map(([x,y]) => ({x:m.cx+x*m.w,y:m.top+y*m.h}));
    const all = [...left, ...right];
    const path = new Path2D();
    path.moveTo(all[0].x, all[0].y);
    for (let i = 1; i < all.length - 1; i++) {
      const point = all[i], next = all[i + 1];
      path.quadraticCurveTo(point.x, point.y, (point.x+next.x)/2, (point.y+next.y)/2);
    }
    const mouth=all[all.length-1], rimHalf=profile[0][0]*m.w, rimY=m.top+profile[0][1]*m.h, rimDepth=Math.max(3,rimHalf*.06);
    path.quadraticCurveTo(mouth.x,mouth.y,mouth.x,mouth.y);
    path.bezierCurveTo(m.cx+rimHalf*.55,rimY-rimDepth,m.cx-rimHalf*.55,rimY-rimDepth,all[0].x,all[0].y);
    path.closePath();
    return path;
  }

  function setTheme() {
    colors = palette[round % palette.length];
    vessel = vessels[round % vessels.length];
    document.documentElement.style.setProperty('--liquid', colors.liquid);
    document.documentElement.style.setProperty('--liquid-light', colors.light);
    roundLabel.textContent = `Vas ${String(round + 1).padStart(2, '0')}`;
    vesselName.textContent = vessel.name;
    scoreElement.textContent = String(score).padStart(4, '0');
    streakElement.textContent = `×${streak}`;
    bestScore.textContent = best ? `Cel mai bun ${best.toFixed(1)}%` : 'Cel mai bun —';
  }

  function startGame() {
    if (!audio) audio = new SoundEngine();
    audio.wake();
    shell.classList.add('playing');
    state = 'ready';
    resetPour();
  }

  function resetPour() {
    audio?.stopPour();
    fill = 0; displayedFill = 0; pouring = false; settleTimer = 0; surfaceEnergy = 0; gestureBlend = 0; overfillBlend = 0; tilt = 0;
    droplets = []; bubbles = []; rings = []; sparks = [];
    state = shell.classList.contains('playing') ? 'ready' : 'intro';
    shell.classList.remove('pouring', 'show-result');
    canvas.classList.remove('is-pouring');
    scaleMarker.style.top = '100%';
    instructionText.textContent = 'Ține apăsat pentru a turna';
  }

  function beginPour() {
    if (state !== 'ready') return;
    if (!audio) audio = new SoundEngine();
    audio.wake(); audio.startPour();
    state = 'pouring'; pouring = true; pourStart = performance.now(); surfaceEnergy = Math.max(surfaceEnergy, .45);
    shell.classList.add('pouring'); canvas.classList.add('is-pouring');
    instructionText.textContent = 'Oprește-te la semnul de pe ulcior';
  }

  function endPour() {
    if (state !== 'pouring') return;
    pouring = false; state = 'settling'; settleTimer = 0;
    audio?.stopPour();
    shell.classList.remove('pouring'); canvas.classList.remove('is-pouring');
    instructionText.textContent = 'Lasă vinul să se așeze…';
    surfaceEnergy = Math.max(surfaceEnergy, .75);
    createRing();
  }

  function evaluate() {
    state = 'result';
    const difference = Math.abs(fill - vessel.target);
    const quality = Math.max(0, 1 - difference / .32);
    const accuracy = Math.max(0, 100 - difference * 185);
    const points = Math.round(quality * 750 + (difference < .018 ? 250 : 0));
    const perfect = difference < .018;
    const close = difference < .055;
    if (perfect) streak += 1; else if (!close) streak = 0;
    score += points;
    best = Math.max(best, accuracy);
    localStorage.setItem('pour-score', score); localStorage.setItem('pour-streak', streak); localStorage.setItem('pour-best', best);
    scoreElement.textContent = String(score).padStart(4, '0'); streakElement.textContent = `×${streak}`; bestScore.textContent = `Cel mai bun ${best.toFixed(1)}%`;

    if (perfect) {
      resultKicker.textContent = 'Turnare perfectă'; resultMessage.textContent = 'Chiar la semn.';
      burst(56); createRing();
      if (navigator.vibrate) navigator.vibrate([18, 35, 24]);
    } else if (close) {
      resultKicker.textContent = 'Aproape perfect'; resultMessage.textContent = fill > vessel.target ? 'Doar o picătură peste.' : 'Mai lipsea o picătură.'; burst(26);
    } else if (fill > 1) {
      resultKicker.textContent = 'S-a revărsat'; resultMessage.textContent = 'Cu belșug.';
    } else {
      resultKicker.textContent = fill > vessel.target ? 'Turnat cu belșug' : 'Puțin sfios';
      resultMessage.textContent = fill > vessel.target ? 'Lasă ultima picătură să cadă.' : 'Mai ai loc în ulcior.';
    }
    resultPercent.textContent = `${accuracy.toFixed(1)}%`;
    shell.classList.add('show-result');
    audio?.result(quality);
  }

  function nextRound() {
    round += 1; localStorage.setItem('pour-round', round); setTheme(); resetPour();
  }

  function addDrop(x, y, vx, vy, size = 4) {
    droplets.push({x,y,vx,vy,size,life:1});
  }

  function createRing() {
    const m = metrics();
    const levelY = m.bottom - Math.min(fill, 1) * capacityHeight(m);
    rings.push({x:m.cx,y:levelY,life:1});
  }

  function burst(count) {
    const m = metrics();
    const y = m.bottom - Math.min(fill, 1) * capacityHeight(m);
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * TAU;
      const speed = 1 + Math.random() * 3.8;
      sparks.push({x:m.cx,y,vx:Math.cos(angle)*speed,vy:Math.sin(angle)*speed-1.4,life:1,size:.8+Math.random()*2.2});
    }
  }

  function update(dt, time) {
    if (pouring) {
      const warmup = Math.min(1, (time - pourStart) / 380);
      fill += vessel.speed * warmup * dt / 1000;
      surfaceEnergy = Math.min(1, surfaceEnergy + dt * .0018);
      tilt += ((pointerX / width - .5) * .22 - tilt) * .035;
      if (Math.random() < dt * .009) bubbles.push({x:(Math.random()-.5)*.55,y:0,life:1,r:1.5+Math.random()*3});
      if (fill > 1 && Math.random() < dt * .055) {
        const m=metrics(), side=Math.random()<.5?-1:1, rimHalf=vessel.points[1][0]*m.w;
        addDrop(m.cx+side*rimHalf*(.8+Math.random()*.17),m.top+m.h*vessel.points[1][1]+4,(.3+Math.random()*1.5)*side,Math.random()*.7,1.5+Math.random()*3);
        if(fill>1.035&&Math.random()<.22)rings.push({x:m.cx+(Math.random()-.5)*m.w*.5,y:m.bottom+12,life:1,wine:true});
      }
      if (fill >= 1.13) endPour();
    }
    displayedFill += (fill - displayedFill) * Math.min(1, dt * .008);
    surfaceEnergy *= Math.pow(.997, dt);
    const gestureTarget = displayedFill >= vessel.target - .11 ? 1 : 0;
    gestureBlend += (gestureTarget - gestureBlend) * (reducedMotion ? 1 : Math.min(1, dt * .007));
    const overfillTarget = displayedFill > vessel.target + .025 ? 1 : 0;
    overfillBlend += (overfillTarget - overfillBlend) * (reducedMotion ? 1 : Math.min(1, dt * .012));
    if (state === 'settling') { settleTimer += dt; if (settleTimer > (reducedMotion ? 220 : 850)) evaluate(); }
    const marker = 100 - Math.min(2, displayedFill / vessel.target) * 50;
    scaleMarker.style.top = `${Math.max(0, marker)}%`;
  }

  function drawBackdrop(time) {
    ctx.clearRect(0,0,width,height);
    const m=metrics();
    ctx.save(); ctx.globalAlpha=.2;
    for(let i=0;i<7;i++) {
      const x=width*(.1+i*.135), y=height*.17+Math.sin(time*.00035+i)*9;
      ctx.beginPath(); ctx.arc(x,y,1+i%2,0,TAU); ctx.fillStyle=colors.liquid; ctx.fill();
    }
    ctx.restore();
    const shadow=ctx.createRadialGradient(m.cx,m.bottom+18,0,m.cx,m.bottom+18,m.w*.75);
    shadow.addColorStop(0,'rgba(30,45,43,.18)');shadow.addColorStop(1,'rgba(30,45,43,0)');
    ctx.save();ctx.scale(1,.18);ctx.fillStyle=shadow;ctx.beginPath();ctx.arc(m.cx,(m.bottom+20)/.18,m.w*.75,0,TAU);ctx.fill();ctx.restore();
  }

  function drawVessel(time) {
    if (state === 'intro') return;
    const m=metrics(), path=vesselPath();
    const liquidTop=m.bottom-Math.min(displayedFill,1)*capacityHeight(m);

    if(vessel.handle){
      ctx.save();ctx.beginPath();ctx.moveTo(m.cx+m.w*.25,m.top+m.h*.29);ctx.bezierCurveTo(m.cx+m.w*.58,m.top+m.h*.28,m.cx+m.w*.59,m.top+m.h*.72,m.cx+m.w*.31,m.top+m.h*.76);
      ctx.strokeStyle=vessel.type==='crystal'?'rgba(157,177,176,.55)':'#7b402b';ctx.lineWidth=m.w*.1;ctx.lineCap='round';ctx.stroke();
      ctx.strokeStyle=vessel.type==='crystal'?'rgba(255,255,255,.58)':colors.glaze;ctx.lineWidth=m.w*.045;ctx.stroke();ctx.restore();
    }

    ctx.save(); ctx.clip(path);

    const vesselSkin=ctx.createLinearGradient(m.cx-m.w,m.top,m.cx+m.w,m.bottom);
    if(vessel.type==='crystal'){
      vesselSkin.addColorStop(0,'rgba(255,255,255,.82)');vesselSkin.addColorStop(.42,'rgba(190,211,210,.15)');vesselSkin.addColorStop(1,'rgba(255,255,255,.46)');ctx.globalAlpha=.28;
    }else{
      vesselSkin.addColorStop(0,colors.glaze);vesselSkin.addColorStop(.42,colors.clay);vesselSkin.addColorStop(1,'#8d4d32');ctx.globalAlpha=.34;
    }
    ctx.fillStyle=vesselSkin;ctx.fillRect(m.cx-m.w,m.top,m.w*2,m.h);ctx.globalAlpha=1;

    if (displayedFill > .001) {
      const wave=7*surfaceEnergy;
      ctx.beginPath();ctx.moveTo(m.cx-m.w,liquidTop);
      for(let x=m.cx-m.w;x<=m.cx+m.w;x+=7) {
        const y=liquidTop+Math.sin(x*.045+time*.006)*wave+tilt*(x-m.cx);
        ctx.lineTo(x,y);
      }
      ctx.lineTo(m.cx+m.w,m.bottom+20);ctx.lineTo(m.cx-m.w,m.bottom+20);ctx.closePath();
      const liquid=ctx.createLinearGradient(m.cx,liquidTop,m.cx,m.bottom);
      liquid.addColorStop(0,colors.light);liquid.addColorStop(.14,colors.liquid);liquid.addColorStop(1,colors.dark);
      ctx.fillStyle=liquid;ctx.globalAlpha=.86;ctx.fill();ctx.globalAlpha=1;
      ctx.beginPath();ctx.moveTo(m.cx-m.w,liquidTop);
      for(let x=m.cx-m.w;x<=m.cx+m.w;x+=6)ctx.lineTo(x,liquidTop+Math.sin(x*.045+time*.006)*wave+tilt*(x-m.cx));
      ctx.strokeStyle='rgba(255,255,255,.72)';ctx.lineWidth=2;ctx.shadowColor=colors.light;ctx.shadowBlur=10;ctx.stroke();ctx.shadowBlur=0;

      const surfaceT=Math.max(.17,Math.min(1,(liquidTop-m.top)/m.h));
      const surfaceHalf=halfWidthAt(surfaceT)*m.w*.88;
      const foamCount=Math.round(surfaceEnergy*10);
      for(let i=0;i<foamCount;i++){
        const fx=m.cx-surfaceHalf+(i+.5)/Math.max(1,foamCount)*surfaceHalf*2;
        const fy=liquidTop+Math.sin(fx*.045+time*.006)*wave+tilt*(fx-m.cx)+Math.sin(i*17.2)*2;
        ctx.beginPath();ctx.arc(fx,fy,1.2+(i%3)*.55,0,TAU);ctx.fillStyle='rgba(255,255,255,.66)';ctx.fill();
      }

      for(const b of bubbles) {
        b.y+=.00016*(16+surfaceEnergy*22);b.life-=.0012;
        const by=m.bottom-b.y*capacityHeight(m), bx=m.cx+b.x*m.w*halfWidthAt(Math.max(.18,(by-m.top)/m.h))*2;
        if(by>liquidTop+5&&b.life>0){ctx.beginPath();ctx.arc(bx,by,b.r,0,TAU);ctx.strokeStyle='rgba(255,255,255,.38)';ctx.lineWidth=.8;ctx.stroke();}
      }
      bubbles=bubbles.filter(b=>b.life>0&&m.bottom-b.y*capacityHeight(m)>liquidTop);
    }
    ctx.restore();

    ctx.save();ctx.clip(path);
    if(vessel.type==='crystal'){
      ctx.strokeStyle='rgba(255,255,255,.5)';ctx.lineWidth=1.4;
      for(let i=-2;i<=2;i++){ctx.beginPath();ctx.moveTo(m.cx+i*m.w*.12,m.top+m.h*.17);ctx.lineTo(m.cx+i*m.w*.08,m.bottom);ctx.stroke();}
      ctx.strokeStyle='rgba(110,137,136,.22)';ctx.lineWidth=1;
      for(let i=0;i<3;i++){const y=m.top+m.h*(.38+i*.18);ctx.beginPath();ctx.moveTo(m.cx-m.w*.38,y);ctx.lineTo(m.cx+m.w*.38,y);ctx.stroke();}
      ctx.fillStyle='rgba(255,255,255,.42)';ctx.fillRect(m.cx-m.w*.31,m.top+m.h*.21,m.w*.045,m.h*.58);
    }else{
      const bandTop=m.top+m.h*.5, bandHeight=m.h*.14;
      ctx.fillStyle='rgba(248,220,166,.73)';ctx.fillRect(m.cx-m.w,bandTop,m.w*2,bandHeight);
      ctx.strokeStyle='#762033';ctx.fillStyle='#762033';ctx.lineWidth=1.4;
      for(let i=-3;i<=3;i++){
        const x=m.cx+i*m.w*.125;ctx.beginPath();ctx.moveTo(x,bandTop+bandHeight*.15);ctx.lineTo(x+m.w*.055,bandTop+bandHeight*.5);ctx.lineTo(x,bandTop+bandHeight*.85);ctx.lineTo(x-m.w*.055,bandTop+bandHeight*.5);ctx.closePath();ctx.stroke();
        ctx.beginPath();ctx.arc(x,bandTop+bandHeight*.5,1.5,0,TAU);ctx.fill();
      }
      ctx.fillStyle='rgba(91,48,31,.16)';
      for(let i=0;i<24;i++){const x=m.cx+Math.sin(i*8.7)*m.w*.34, y=m.top+m.h*(.2+(i%12)*.061);ctx.beginPath();ctx.arc(x,y,.7+(i%3)*.25,0,TAU);ctx.fill();}
      const glaze=ctx.createLinearGradient(m.cx-m.w*.3,0,m.cx+m.w*.25,0);glaze.addColorStop(0,'rgba(255,239,197,.34)');glaze.addColorStop(.45,'rgba(255,255,255,0)');glaze.addColorStop(1,'rgba(70,28,20,.12)');ctx.fillStyle=glaze;ctx.fillRect(m.cx-m.w,m.top,m.w*2,m.h);
    }
    ctx.restore();

    ctx.save();ctx.strokeStyle=vessel.type==='crystal'?'rgba(116,143,143,.62)':'#7b402b';ctx.lineWidth=vessel.type==='crystal'?2:2.5;ctx.stroke(path);
    ctx.strokeStyle=vessel.type==='crystal'?'rgba(255,255,255,.76)':'rgba(255,220,168,.54)';ctx.lineWidth=1;ctx.translate(-2,-1);ctx.stroke(path);ctx.restore();

    const rimHalf=vessel.points[1][0]*m.w, rimDepth=Math.max(3,rimHalf*.06), rimY=m.top+m.h*vessel.points[1][1];
    ctx.save();ctx.beginPath();ctx.ellipse(m.cx,rimY,rimHalf,rimDepth,0,0,Math.PI);ctx.strokeStyle=vessel.type==='crystal'?'rgba(255,255,255,.58)':'#7b402b';ctx.lineWidth=vessel.type==='crystal'?1.4:2;ctx.stroke();
    ctx.beginPath();ctx.ellipse(m.cx,rimY,rimHalf*.88,rimDepth*.56,0,0,TAU);ctx.strokeStyle=vessel.type==='crystal'?'rgba(116,143,143,.36)':'rgba(83,42,28,.52)';ctx.lineWidth=1;ctx.stroke();ctx.restore();

    if(displayedFill>.001){
      const surfaceT=Math.max(.17,Math.min(1,(liquidTop-m.top)/m.h)), surfaceHalf=halfWidthAt(surfaceT)*m.w*.9;
      ctx.save();ctx.beginPath();ctx.ellipse(m.cx,liquidTop,surfaceHalf,Math.max(3,5*surfaceEnergy),tilt,0,TAU);ctx.fillStyle=colors.light;ctx.globalAlpha=vessel.type==='clay'?.62:.34;ctx.fill();ctx.strokeStyle='rgba(255,255,255,.68)';ctx.lineWidth=1.5;ctx.stroke();ctx.restore();
    }

    const targetY=m.bottom-vessel.target*capacityHeight(m);
    const t=(targetY-m.top)/m.h, lineHalf=halfWidthAt(t)*m.w*.92;
    ctx.save();ctx.setLineDash([3,6]);ctx.lineDashOffset=-time*.012;ctx.beginPath();ctx.moveTo(m.cx-lineHalf,targetY);ctx.lineTo(m.cx+lineHalf,targetY);ctx.strokeStyle=colors.liquid;ctx.lineWidth=1.25;ctx.stroke();ctx.setLineDash([]);ctx.restore();

    const overflow=Math.max(0,Math.min(1,(displayedFill-1)/.08));
    if(overflow>0){
      ctx.save();ctx.globalAlpha=.42+overflow*.14;ctx.beginPath();ctx.ellipse(m.cx,rimY,rimHalf*.92,rimDepth*.72,0,0,TAU);ctx.fillStyle=colors.light;ctx.fill();ctx.strokeStyle='rgba(255,255,255,.5)';ctx.lineWidth=1.2;ctx.stroke();ctx.restore();
    }

  }

  function drawPour(time) {
    if (!pouring) return;
    const m=metrics(), mouthY=m.top+m.h*.17;
    const jugWidth=Math.min(width*(width<720?.96:.52),m.h*1.35), jugHeight=jugWidth*((jugSprite.naturalHeight/jugSprite.naturalWidth)||(853/1280));
    const jugX=m.cx-jugWidth*.18, jugY=Math.max(105,m.top-45)-jugHeight*.45;
    const sourceX=jugX+jugWidth*.192, sourceY=jugY+jugHeight*.515;
    const streamX=m.cx+Math.sin(time*.013)*1.2;
    const stream=ctx.createLinearGradient(streamX,sourceY,streamX,mouthY);
    stream.addColorStop(0,colors.light);stream.addColorStop(1,colors.liquid);
    ctx.save();ctx.lineCap='round';ctx.beginPath();ctx.moveTo(sourceX,sourceY);ctx.bezierCurveTo(sourceX-2,sourceY+26,streamX+4,mouthY-18,streamX,mouthY+4);
    ctx.strokeStyle=stream;ctx.lineWidth=7+Math.sin(time*.017)*1.1;ctx.shadowColor=colors.light;ctx.shadowBlur=10;ctx.stroke();
    ctx.beginPath();ctx.moveTo(sourceX-1,sourceY);ctx.bezierCurveTo(sourceX-2,sourceY+26,streamX+2,mouthY-10,streamX,mouthY);ctx.strokeStyle='rgba(255,255,255,.48)';ctx.lineWidth=1.4;ctx.stroke();ctx.restore();

    if(jugSprite.complete&&jugSprite.naturalWidth){
      ctx.drawImage(jugSprite,jugX,jugY,jugWidth,jugHeight);
    }
  }

  function drawEffects(dt) {
    const m=metrics();
    droplets=droplets.filter(d=>d.life>0&&d.y<height+20);
    for(const d of droplets){d.x+=d.vx*dt*.07;d.y+=d.vy*dt*.07;d.vy+=dt*.006;d.life-=dt*.00045;ctx.beginPath();ctx.ellipse(d.x,d.y,d.size*.65,d.size,0,0,TAU);ctx.fillStyle=colors.liquid;ctx.globalAlpha=Math.max(0,d.life);ctx.fill();}
    ctx.globalAlpha=1;
    rings=rings.filter(r=>r.life>0);
    for(const r of rings){r.life-=dt*.001;ctx.save();ctx.beginPath();ctx.ellipse(r.x,r.y,(1-r.life)*m.w*.35+5,(1-r.life)*8+2,0,0,TAU);ctx.strokeStyle=r.wine?colors.light:'#fff';ctx.globalAlpha=Math.max(0,r.life)*.65;ctx.lineWidth=r.wine?2:1.2;ctx.stroke();ctx.restore();}
    sparks=sparks.filter(s=>s.life>0);
    for(const s of sparks){s.x+=s.vx*dt*.055;s.y+=s.vy*dt*.055;s.vy+=dt*.003;s.life-=dt*.001;ctx.beginPath();ctx.arc(s.x,s.y,s.size*Math.max(0,s.life),0,TAU);ctx.fillStyle=colors.liquid;ctx.globalAlpha=Math.max(0,s.life);ctx.fill();}
    ctx.globalAlpha=1;
  }

  function drawHandGuide(time) {
    if(state==='intro'||!handSprite.complete||!handSprite.naturalWidth)return;
    const m=metrics(), mobile=width<720, size=mobile?112:Math.min(195,m.h*.5);
    const glassLeft=m.cx-Math.max(...vessel.points.map(point=>point[0]))*m.w;
    const x=Math.max(mobile?-14:24,glassLeft-size-(mobile?8:24)), y=m.top+m.h*.47-size*.5;
    const frameWidth=handSprite.naturalWidth/2, pinchAlpha=Math.max(0,1-gestureBlend*1.25), stopAlpha=Math.max(0,(gestureBlend-.08)/.92)*(1-overfillBlend);
    ctx.save();ctx.globalAlpha=pinchAlpha;ctx.drawImage(handSprite,0,0,frameWidth,handSprite.naturalHeight,x,y+Math.sin(time*.004)*2,size,size);ctx.restore();
    const stopScale=.92+gestureBlend*.08, stopSize=size*stopScale;
    ctx.save();ctx.globalAlpha=stopAlpha;ctx.drawImage(handSprite,frameWidth,0,frameWidth,handSprite.naturalHeight,x+(size-stopSize)/2,y+(size-stopSize)/2,stopSize,stopSize);ctx.restore();
    const shake=reducedMotion?0:Math.sin(time*.024)*4*overfillBlend;
    if(overfillHand.complete&&overfillHand.naturalWidth){
      const overWidth=size*1.38, overHeight=overWidth*overfillHand.naturalHeight/overfillHand.naturalWidth;
      ctx.save();ctx.globalAlpha=overfillBlend;ctx.translate(x+size*.5+shake,y+size*.47);ctx.rotate((reducedMotion?0:Math.sin(time*.021)*.045)*overfillBlend);ctx.drawImage(overfillHand,-overWidth*.5,-overHeight*.5,overWidth,overHeight);ctx.restore();
    }
    const phase=overfillBlend>.45?2:gestureBlend>.5?1:0, labels=['Toarnă oleacă...','Destul!','Gata uuăăii!!!'];
    ctx.save();ctx.textAlign='center';ctx.font=`800 ${mobile?11:12}px Inter, sans-serif`;ctx.letterSpacing='1px';ctx.fillStyle='#722339';ctx.fillText(labels[phase],x+size*.54,y+size+17);ctx.restore();
  }

  function frame(time) {
    const dt=Math.min(34,time-lastTime);lastTime=time;
    update(dt,time);drawBackdrop(time);drawVessel(time);drawPour(time);drawHandGuide(time);drawEffects(dt);requestAnimationFrame(frame);
  }

  function handleDown(event) {
    if (event.target.closest?.('button, a')) return;
    pointerX=event.clientX??width/2;
    beginPour();
  }
  function handleMove(event) { pointerX=event.clientX??pointerX; }
  function handleUp() { endPour(); }

  canvas.addEventListener('pointerdown',handleDown);
  canvas.addEventListener('pointermove',handleMove);
  canvas.addEventListener('pointerup',handleUp);
  canvas.addEventListener('pointercancel',handleUp);
  startButton.addEventListener('click',startGame);
  nextButton.addEventListener('click',nextRound);
  resetButton.addEventListener('click',resetPour);
  document.querySelector('.brand').addEventListener('click',event=>{event.preventDefault();resetPour();});

  soundButton.classList.toggle('is-muted',muted);soundButton.setAttribute('aria-pressed',String(muted));
  soundButton.addEventListener('click',()=>{
    muted=!muted;localStorage.setItem('pour-muted',muted);soundButton.classList.toggle('is-muted',muted);soundButton.setAttribute('aria-pressed',String(muted));soundButton.setAttribute('aria-label',muted?'Unmute sound':'Mute sound');
    if(!muted){if(!audio)audio=new SoundEngine();audio.wake();audio.tone(520,.25,.16);}
    else audio?.stopPour();
  });

  addEventListener('keydown',event=>{if(event.code==='Space'&&!event.repeat){event.preventDefault();if(state==='intro')startGame();else beginPour();}if(event.key==='Escape')resetPour();});
  addEventListener('keyup',event=>{if(event.code==='Space'){event.preventDefault();endPour();}});
  addEventListener('resize',resize);

  resize();setTheme();requestAnimationFrame(frame);
})();
