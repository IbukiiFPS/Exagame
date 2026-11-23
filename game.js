/* ============================================================
   game.js – config, shared state, scoring rules, HUD, audio, UI
   Creates the global GW object used by the other files.
   ============================================================ */
(function () {
  'use strict';
  const GW = window.GW = {};
  const $ = id => document.getElementById(id);

  /* ---------- Math helpers (shared) ---------- */
  const U = {
    deg: r => r * 180 / Math.PI,
    rad: d => d * Math.PI / 180,
    lerp: (a, b, t) => a + (b - a) * t,
    clamp: (v, a, b) => Math.max(a, Math.min(b, v)),
    clamp01: v => Math.max(0, Math.min(1, v)),
    ease: k => k * k * (3 - 2 * k),
    wrap180(d) { while (d > 180) d -= 360; while (d < -180) d += 360; return d; },
    angleAt(a, b, c) {                                   // angle at b of a-b-c, degrees
      const v1 = { x: a.x - b.x, y: a.y - b.y }, v2 = { x: c.x - b.x, y: c.y - b.y };
      const m = Math.hypot(v1.x, v1.y) * Math.hypot(v2.x, v2.y);
      return m ? U.deg(Math.acos(U.clamp((v1.x * v2.x + v1.y * v2.y) / m, -1, 1))) : 0;
    },
    fromVertical(a, b) { return U.deg(Math.atan2(Math.abs(b.x - a.x), Math.abs(b.y - a.y))); },
    pulse(t, period) {                                   // 0→1, hold, 1→0, rest
      const p = (t % period) / period;
      return p < 0.3 ? U.ease(p / 0.3) : p < 0.5 ? 1 : p < 0.8 ? 1 - U.ease((p - 0.5) / 0.3) : 0;
    }
  };
  GW.$ = $; GW.U = U;
  const { clamp, clamp01 } = U;

  /* phones / tablets (incl. iPadOS, which reports itself as a Mac) */
  GW.IS_MOBILE = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) ||
                 (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

  /* ---------- Tunable configuration ----------
     The threshold values are overwritten by the active profile (see calibration.js). */
  const CFG = GW.CFG = {
    HIP_TARGET: 160,      // deg – hip angle must exceed
    THIGH_TARGET: 22,     // deg – thigh deviation from vertical must be below
    SEATED_HIP: 135,      // deg – below this = seated (arms the next rep)
    ARM_UP: 140,          // deg – both arms above this = raised
    ARM_DOWN: 60,         // deg – both arms below this = lowered (re-arms)
    TWIST_TARGET: 20,     // deg – shoulder-vs-hip rotation to count a side
    TWIST_OFFSET: 0,      // deg – the person's own "neutral" twist (from calibration)
    SIDE: 'auto',         // 'auto' | 'L' | 'R' – which leg is used for sit-to-stand
    COOLDOWN_MS: 600,     // debounce between reps
    MIN_VIS: 0.5,         // landmark visibility threshold
    EMA: 0.35,            // smoothing factor
    TWIST_SCREEN_SIGN: 1  // live.twist is already mirror-correct (see mediapipe.js); flip to -1 only if a camera reports it reversed
  };
  GW.MODES = {
    potato: { name: 'Sweet Potato Pull',  kind: 'Sit-to-Stand', hint: 'Sit side-on to the camera, then stand up tall',
              goal: 'Stand up to pull the sweet potato out of the ground',
              steps: ['STAND UP – lean forward, push through your feet', 'HOLD – stay tall for a moment', 'SIT DOWN – slowly back onto the chair'],
              demo: ['Sit tall near the front of the chair', 'Lean forward and push through your feet', 'Stand up tall – hips and knees straight'] },
    fruit:  { name: 'High Fruit Picking', kind: 'Arm Raises',   hint: 'Face the camera and raise both arms high',
              goal: 'Stretch up and pick the glowing apple',
              steps: ['REACH UP – both arms high', 'HOLD – stretch for a moment', 'ARMS DOWN – lower them slowly'],
              demo: ['Arms relaxed by your sides', 'Lift both arms out and up', 'Reach high above your head'] },
    sort:   { name: 'Fruit Sorting',      kind: 'Torso Twists', hint: 'Apples go left, oranges go right',
              goal: 'Apples into the left basket, oranges into the right',
              steps: ['Look at the fruit in your hands', 'Apple: TWIST LEFT  ·  Orange: TWIST RIGHT', 'RETURN to the middle for the next fruit'],
              demo: ['Face the front, fruit in your hands', 'Turn your shoulders to one side', 'Turn to the other side – feet stay still'] }
  };

  GW.MODE_ORDER = ['potato', 'fruit', 'sort'];

  /* ---------- Shared state ---------- */
  const game = GW.game = { mode: 'potato', score: 0, coins: 0, reps: 0, combo: 0, armed: false, twistSide: 0, lastHarvestTime: 0, targetReached: false, sortNeed: 'L', sortWrong: false,
                           phase: 'intro', fever: 0, step: 'ready', holdStart: 0, lastActive: 0 };   // phase: intro → demo → count → play → (finishing) → done
  const live = GW.live = { hip: null, thigh: null, knee: null, lean: null, armL: null, armR: null, elbL: null, elbR: null, twist: null, twistRaw: null, prog: 0,
                           ok: { leg: false, arms: false, twist: false }, tracking: false, lastSeen: 0, full: false };
  GW.ui    = { gMode: 'coach', showCam: true, coachOpen: true, detailsOpen: false };   // coachOpen = the small coach window is shown (and drawn)
  GW.track = { lm: null, wl: null, t: 0 };
  GW.started = false;

  /* ---------- Settings (saved on this device) ---------- */
  const SKEY = 'gw.settings.v1';
  const settings = GW.settings = { goal: 20, weight: 60, quality: 'auto', sound: true, coach: true, cam: true, round: '15+5', avatar: 'somchai' };
  function loadSettings() {
    try {
      const s = JSON.parse(localStorage.getItem(SKEY)); if (!s) return;
      if ([10, 20, 30, 50].indexOf(s.goal) >= 0) settings.goal = s.goal;
      if (isFinite(s.weight)) settings.weight = clamp(+s.weight, 30, 150);
      if (['auto', 'fast', 'accurate'].indexOf(s.quality) >= 0) settings.quality = s.quality;
      if (typeof s.sound === 'boolean') settings.sound = s.sound;
      if (typeof s.coach === 'boolean') settings.coach = s.coach;
      if (typeof s.cam === 'boolean') settings.cam = s.cam;
      if (['15+5', '10+5', '6+2'].indexOf(s.round) >= 0) settings.round = s.round;
      if (typeof s.avatar === 'string' && (GW.AVATARS || []).some(a => a.id === s.avatar)) settings.avatar = s.avatar;
    } catch (e) {}
  }
  function saveSettings() { try { localStorage.setItem(SKEY, JSON.stringify(settings)); } catch (e) {} }
  GW.quality = () => settings.quality === 'auto' ? (GW.IS_MOBILE ? 'fast' : 'accurate') : settings.quality;

  /* ---------- Session stats ---------- */
  const stats = GW.stats = { kcal: 0, seconds: 0, goalHit: false };
  /* Rough energy estimate per rep = MET × body weight (kg) × seconds per rep ÷ 3600.
     PLACEHOLDER MET values for light exercise – have a professional confirm them before reporting calories. */
  const MET = { potato: 4.0, fruit: 2.5, sort: 3.0 };

  /* ---------- Audio (Web Audio API chime) ---------- */
  let audioCtx = null;
  function ensureAudio() {
    if (!audioCtx) { try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) {} }
    if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
  }
  ['pointerdown', 'keydown', 'touchstart'].forEach(ev => window.addEventListener(ev, ensureAudio, { passive: true }));
  function tone(freq, delay, dur, type, vol) {
    if (!settings.sound) return;
    ensureAudio(); if (!audioCtx) return;
    const o = audioCtx.createOscillator(), g = audioCtx.createGain(), t = audioCtx.currentTime + (delay || 0);
    o.type = type || 'sine'; o.frequency.value = freq;
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol || 0.18, t + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, t + (dur || 0.3));
    o.connect(g).connect(audioCtx.destination); o.start(t); o.stop(t + (dur || 0.3) + 0.05);
  }
  GW.tone = tone;
  const playSparkle = () => [1046.5, 1318.5, 1568, 2093, 2637].forEach((f, i) => tone(f, i * 0.06, 0.5, 'triangle', 0.14));
  const playFanfare = () => [[523.25, 0], [659.25, .14], [783.99, .28], [1046.5, .42], [783.99, .62], [1046.5, .76]]
    .forEach(([f, d], i) => tone(f, d, i === 5 ? 0.9 : 0.28, 'triangle', 0.16));
  function playChime() {
    if (!settings.sound) return;
    ensureAudio(); if (!audioCtx) return;
    const t0 = audioCtx.currentTime;
    [659.25, 880, 1318.5, 1760].forEach((f, i) => {
      const o = audioCtx.createOscillator(), g = audioCtx.createGain(), t = t0 + i * 0.08;
      o.type = 'sine'; o.frequency.value = f;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.2, t + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
      o.connect(g).connect(audioCtx.destination);
      o.start(t); o.stop(t + 0.65);
    });
  }

  /* ============================================================
     ROUND PLAN – every round is N steady reps, then F faster reps (Ring Fit style)
       steady reps:  do the move → HOLD for a moment → return
       faster reps:  no hold, "FASTER!", and the garden gives big / golden items
     ============================================================ */
  const ROUND_OPTS = { '15+5': [15, 5], '10+5': [10, 5], '6+2': [6, 2] };
  const plan = () => ROUND_OPTS[settings.round] || ROUND_OPTS['15+5'];
  const total = () => plan()[0] + plan()[1];
  const HOLD_MS = { potato: 1000, fruit: 1000, sort: 0 };       // torso twist: go, then return – no hold
  const R = game.r = { n: 0, reps: 0, kcal0: 0, elapsed: 0, result: null };
  const isFast = () => (game.phase === 'play' || game.phase === 'finishing') && R.reps >= plan()[0];
  GW.isFast = isFast;
  GW.nextIsGolden = () => game.phase === 'play' && R.reps >= plan()[0];   // the 3D garden shows big / golden items in the faster part

  const BKEY = 'gw.bestTime.v1';                                // best (fastest) round time per game
  let best = {};
  try { best = JSON.parse(localStorage.getItem(BKEY)) || {}; } catch (e) {}
  const saveBest = () => { try { localStorage.setItem(BKEY, JSON.stringify(best)); } catch (e) {} };

  /* ---------- HUD ---------- */
  function bump(id) { const el = $(id); if (!el) return; el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump'); }
  const fmt = s => Math.floor(s / 60) + ':' + String(Math.floor(s % 60)).padStart(2, '0');
  let progKey = '';
  function buildProg() {                                        // one square per rep: N steady, a gap, F faster (gold outline)
    const [n, f] = plan(), key = n + '+' + f; if (key === progKey) return; progKey = key;
    let h = ''; for (let i = 0; i < n; i++) h += '<i data-i="' + i + '"></i>';
    h += '<i class="gap"></i>'; for (let i = n; i < n + f; i++) h += '<i class="fast" data-i="' + i + '"></i>';
    $('prog').innerHTML = h;
    $('rsDone').innerHTML = h.replace('<i class="gap"></i>', '<i style="background:none;width:6px"></i>');
  }
  GW.updateHUD = function () {
    buildProg();
    const T = total();
    $('reps').textContent = R.reps; $('goal').textContent = T;
    $('progNum').innerHTML = R.reps + '<span>/' + T + '</span>';
    $('kcal').textContent = stats.kcal.toFixed(1);
    $('prog').querySelectorAll('i[data-i]').forEach(c => {
      const i = +c.dataset.i; c.classList.toggle('on', i < R.reps); c.classList.toggle('next', game.phase === 'play' && i === R.reps);
    });
    $('exCard').classList.toggle('fast', isFast());
    GW.updateTime();
  };
  let timeKey = '';
  GW.updateTime = function () {
    const txt = fmt(game.phase === 'intro' ? 0 : R.elapsed); if (txt === timeKey) return; timeKey = txt;
    $('time').textContent = txt;
  };
  let bannerKey = '';
  GW.setBanner = function (text, kind = 'info') {
    const key = kind + text; if (key === bannerKey) return; bannerKey = key;
    const b = $('banner'); b.textContent = text; b.className = kind;
  };
  let toastTimer;
  function judge(word, cls, sub) {
    const t = $('toast'), w = $('tWord');
    w.textContent = word; w.className = cls || ''; $('tSub').textContent = sub || ''; $('tSub').hidden = !sub;
    t.classList.remove('show'); void t.offsetWidth; t.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 1300);
  }

  /* ---------- the big instruction in the middle ---------- */
  let promptKey = '', promptText = '', flashUntil = 0;
  function setPrompt(text, kind, sub, hold, fruit) {             // kind: go | hold | back | warn | count
    if (performance.now() < flashUntil) return;
    const fast = isFast() && kind !== 'warn';
    const key = text + kind + sub + fruit + fast;
    if (hold != null) { $('pmHold').hidden = false; $('pmHoldFill').style.width = Math.round(clamp01(hold) * 100) + '%'; }
    else $('pmHold').hidden = true;
    if (key === promptKey) return;
    const changed = text !== promptText; promptKey = key; promptText = text;
    const p = $('prompt'); p.hidden = false;
    $('pmTxt').textContent = text; $('pmSub').textContent = sub || '';
    $('pmBadge').hidden = !fast;
    $('pmFruitL').hidden = fruit !== 'L'; $('pmFruitR').hidden = fruit !== 'R';
    $('pmFruitL').className = 'pm-fruit apple'; $('pmFruitR').className = 'pm-fruit orange';
    p.className = kind || 'go';
    if (changed) { void p.offsetWidth; p.classList.add('pop'); }
  }
  function flashPrompt(text, kind, ms) { flashUntil = 0; setPrompt(text, kind, ''); flashUntil = performance.now() + ms; }
  function hidePrompt() { $('prompt').hidden = true; promptKey = promptText = ''; flashUntil = 0; }
  GW.setPrompt = setPrompt;

  /* ---------- Live form gauge (bottom): how close the current pose is to the target ---------- */
  let formKey = '';
  GW.updateForm = function () {
    const L = live, Rd = Math.round, m = game.mode;
    let p = 0, txt = '--';
    if (L.tracking) {
      if (m === 'potato' && L.ok.leg)      { p = L.prog; txt = 'Hip ' + Rd(L.hip) + '°/' + Rd(CFG.HIP_TARGET) + '°'; }
      else if (m === 'fruit' && L.ok.arms) { p = L.prog; txt = 'Arms ' + Rd(Math.min(L.armL, L.armR)) + '°/' + Rd(CFG.ARM_UP) + '°'; }
      else if (m === 'sort' && L.ok.twist) {
        const d = game.sortNeed === 'R' ? 1 : -1;
        p = game.step === 'back' ? 0 : clamp01(L.twist * CFG.TWIST_SCREEN_SIGN * d / CFG.TWIST_TARGET);
        txt = 'Twist ' + Rd(Math.abs(L.twist)) + '°/' + Rd(CFG.TWIST_TARGET) + '°';
      }
    }
    const hit = !!game.targetReached, w = Math.round(clamp01(p) * 100);
    const key = w + txt + hit; if (key === formKey) return; formKey = key;
    $('formFill').style.width = w + '%';
    $('formVal').textContent = txt;
    $('gauge').classList.toggle('hit', hit);
    $('coachMini').classList.toggle('hit', hit);
  };

  /* ============================================================
     REP RULES – a small step machine per rep (thresholds come from CFG / the body profile)
       ready → go → (hold) → rep! → back → go …
     ============================================================ */
  function stepper(now, o, play) {
    if (!play) return o.up;
    const holdMs = isFast() ? 0 : HOLD_MS[game.mode];
    if (game.step === 'back' || game.step === 'ready') {
      if (!o.down) { setPrompt(o.backTxt, 'back', o.backSub); return o.up; }
      game.step = 'go';
    }
    if (game.step === 'go') {
      if (!o.up) { setPrompt(o.goTxt, 'go', isFast() ? 'Quick as you can – safely!' : o.goSub); return false; }
      if (holdMs <= 0) { harvest(now); return true; }
      game.step = 'hold'; game.holdStart = now;
    }
    if (game.step === 'hold') {
      if (!o.upLoose) { game.step = 'go'; setPrompt(o.goTxt, 'go', 'Almost – hold it a little longer'); return false; }
      const k = (now - game.holdStart) / holdMs;
      if (k >= 1) { harvest(now); return true; }
      setPrompt('HOLD!', 'hold', o.holdSub, k);
      return true;
    }
    return o.up;
  }

  GW.evaluateMode = function (now) {
    const L = live, play = game.phase === 'play', setBanner = play ? GW.setBanner : () => {}; L.prog = 0;

    if (game.mode === 'potato') {                                   // Sit-to-Stand
      if (!L.ok.leg) { setBanner('Turn sideways so your hip, knee and ankle are visible', 'warn'); if (play) setPrompt('TURN SIDEWAYS', 'warn', 'So the camera can see your legs'); return false; }
      const seated = L.hip < CFG.SEATED_HIP;
      const target = L.hip > CFG.HIP_TARGET && L.thigh < CFG.THIGH_TARGET;
      const loose = L.hip > CFG.HIP_TARGET - 8 && L.thigh < CFG.THIGH_TARGET + 6;
      L.prog = Math.min(clamp01((L.hip - 110) / (CFG.HIP_TARGET - 110)), clamp01((70 - L.thigh) / (70 - CFG.THIGH_TARGET)));
      setBanner(seated ? 'Lean forward a little, then push up' : target ? 'Tall and straight – lovely' : 'Straighten your hips and knees', target ? 'ok' : 'info');
      return stepper(now, { down: seated, up: target, upLoose: loose,
        goTxt: 'STAND UP!', goSub: 'Push through your feet', holdSub: 'Stay tall',
        backTxt: 'SIT DOWN', backSub: 'Slowly back onto the chair' }, play);
    }

    if (game.mode === 'fruit') {                                    // Arm raises
      if (!L.ok.arms) { setBanner('Face the camera so both arms are visible', 'warn'); if (play) setPrompt('FACE THE CAMERA', 'warn', 'So I can see both arms'); return false; }
      const mn = Math.min(L.armL, L.armR);
      const up = mn > CFG.ARM_UP, down = Math.max(L.armL, L.armR) < CFG.ARM_DOWN, loose = mn > CFG.ARM_UP - 12;
      L.prog = clamp01((mn - 30) / (CFG.ARM_UP - 30));
      setBanner(up ? 'Both arms high – lovely' : down ? 'Arms by your sides' : 'Keep lifting both arms', up ? 'ok' : 'info');
      return stepper(now, { down, up, upLoose: loose,
        goTxt: 'REACH UP!', goSub: isFast() ? '' : 'Stretch both arms up to the apple', holdSub: 'Stretch… and hold',
        backTxt: 'ARMS DOWN', backSub: 'Lower them slowly' }, play);
    }

    /* Torso twists – the fruit in your hands says which way: apple = LEFT, orange = RIGHT (screen sides; the avatar mirrors you).
       Twist to that side → the fruit goes in the basket → RETURN to the middle → next fruit. */
    if (!L.ok.twist) { setBanner('Face the camera so your shoulders and hips are visible', 'warn'); if (play) setPrompt('FACE THE CAMERA', 'warn', 'So I can see your shoulders'); return false; }
    L.prog = clamp(L.twist / CFG.TWIST_TARGET, -1, 1);
    const need = game.sortNeed, f = SORT[need];
    const sTw = L.twist * CFG.TWIST_SCREEN_SIGN;                       // + = toward the screen-right basket (shoulders + arms together)
    const sSh = (L.twistSh ?? L.twist) * CFG.TWIST_SCREEN_SIGN;        // shoulders alone
    const T = CFG.TWIST_TARGET, armsOnly = Math.abs(sTw) > T && !(Math.sign(sSh) === Math.sign(sTw) && Math.abs(sSh) > T * 0.5);
    const side = armsOnly ? null : sTw > T ? 'R' : sTw < -T ? 'L' : null;
    const centred = Math.abs(L.twist) < CFG.TWIST_TARGET * 0.5;
    game.sortWrong = game.step === 'go' && !!side && side !== need;
    if (!play) return side === need;
    if (game.step === 'back') {
      if (!centred) { setPrompt('RETURN', 'back', 'Back to the middle'); setBanner('Turn back to face the camera', 'info'); return false; }
      game.step = 'go';
    }
    if (side === need && game.step === 'go') { harvest(now); return true; }
    if (armsOnly && game.step === 'go') { setPrompt('TURN YOUR BODY', 'warn', 'Shoulders and arms turn together'); setBanner('Turn your chest, not just your arms – feet stay still', 'warn'); return false; }
    if (side) { setPrompt('OTHER WAY!', 'warn', f.fruit + ' goes ' + (need === 'L' ? 'left' : 'right')); setBanner(f.fruit + ' goes in the ' + (need === 'L' ? 'left' : 'right') + ' basket', 'warn'); return false; }
    setPrompt(need === 'L' ? 'TWIST LEFT' : 'TWIST RIGHT', 'go', f.fruit + (need === 'L' ? ' → left basket' : ' → right basket'), null, need);
    setBanner('Turn your shoulders, keep your feet still', 'info');
    return false;
  };

  /* fruit order for the sorting game: random, but never 3 of the same side in a row and kept balanced */
  const SORT = { L: { fruit: 'Apple' }, R: { fruit: 'Orange' } };
  GW.SORT = SORT;
  const sortHist = [];
  function pickNextSort(first) {
    if (first) sortHist.length = 0;
    const nL = sortHist.filter(x => x === 'L').length, nR = sortHist.length - nL;
    let side;
    if (sortHist.length >= 2 && sortHist[sortHist.length - 1] === sortHist[sortHist.length - 2]) side = sortHist[sortHist.length - 1] === 'L' ? 'R' : 'L';
    else side = Math.random() < 0.5 + (nR - nL) * 0.12 ? 'L' : 'R';
    sortHist.push(side); if (sortHist.length > 8) sortHist.shift();
    game.sortNeed = side; game.sortWrong = false;
  }

  /* ---------- a completed rep ---------- */
  function harvest(now) {
    const secs = game.lastHarvestTime ? clamp((now - game.lastHarvestTime) / 1000, 1.5, 6) : 3;   // time this rep took
    stats.kcal += MET[game.mode] * settings.weight * secs / 3600;
    const wasFast = isFast();
    game.lastHarvestTime = now; game.reps++; R.reps++; game.step = 'back';

    GW.updateHUD(); bump('bdReps');
    wasFast ? playSparkle() : playChime();
    if (GW.three) GW.three.harvestFX({ golden: wasFast });
    if (game.mode === 'sort') pickNextSort();

    const [n] = plan(), T = total();
    if (R.reps >= T) { flashPrompt(String(R.reps), 'count', 900); game.phase = 'finishing'; setTimeout(() => finishRound(), 900); return; }
    if (R.reps === n) {                                          // steady part done → faster part
      judge('FASTER!', 'fast', 'Last ' + (T - n) + ' – no need to hold');
      [784, 988, 1175].forEach((f, i) => tone(f, i * 0.09, 0.25, 'square', 0.07));
    } else if (!stats.goalHit && game.reps >= settings.goal) { stats.goalHit = true; judge('GOAL!', 'goal', 'Daily goal reached'); }
    flashPrompt(String(R.reps), 'count', 650);
    const left = T - R.reps;
    GW.setBanner(left === 1 ? 'One more to go!' : left + ' more to go', 'ok');
  }

  /* ---------- overlay cards ---------- */
  function showOverlay(id) {
    ['intro', 'results'].forEach(k => { $(k).hidden = k !== id; });
    $('camera-container').classList.toggle('ov', !!id);
  }
  const modeAt = d => GW.MODE_ORDER[(GW.MODE_ORDER.indexOf(game.mode) + d + GW.MODE_ORDER.length) % GW.MODE_ORDER.length];
  const nextMode = () => modeAt(1);
  /* ---------- screen wipe between the menu, Grandpa's demo and the round ---------- */
  let wiping = false, wipeT1 = 0, wipeT2 = 0;
  function wipe(text, mid) {
    clearTimeout(wipeT1); clearTimeout(wipeT2);
    wiping = true; $('wipeTxt').textContent = text || ''; $('wipe').classList.add('on');
    wipeT1 = setTimeout(() => {
      mid(); syncStage();
      wipeT2 = setTimeout(() => { $('wipe').classList.remove('on'); wiping = false; }, 750);
    }, 560);
  }
  function cancelWipe() { clearTimeout(wipeT1); clearTimeout(wipeT2); $('wipe').classList.remove('on'); wiping = false; }

  /* ---------- Grandpa shows the move (two slow reps) before you start ---------- */
  const DEMO_MS = { potato: 7500, fruit: 7500, sort: 7500 };          // two reps, played a little faster (see three-scene.js)
  let demoTimer = 0;
  function startDemo() {
    if (game.phase !== 'intro' || wiping) return;
    ensureAudio(); tone(880, 0, 0.15, 'triangle', 0.16);
    wipe('Watch Grandpa', beginDemo);
  }
  function beginDemo() {
      showOverlay(null); hidePrompt(); game.phase = 'demo'; syncStage();     // panel visible first, so the bar can animate
      const M = GW.MODES[game.mode], ms = DEMO_MS[game.mode];
      $('dmName').textContent = M.name; $('dmKind').textContent = M.kind;
      $('demoSteps').innerHTML = M.demo.map((t, i) => '<li' + (i ? '' : ' class="on"') + '><b>' + (i + 1) + '</b>' + t + '</li>').join('');
      const f = $('demoFill'); f.style.transition = 'none'; f.style.width = '0%'; void f.offsetWidth;
      f.style.transition = 'width ' + ms + 'ms linear'; f.style.width = '100%';
      if (GW.three && GW.three.demoStart) GW.three.demoStart();
      bannerKey = ''; GW.setBanner('Watch Grandpa – get into position while you watch', 'info');
      clearTimeout(demoTimer); demoTimer = setTimeout(endDemo, ms + 300);
      Object.assign(dz, { low: 0, armed: false, t0: 0 }); renderDemoGesture(0);
  }
  /* during the demo: raise ONE hand (about 1 s) to start straight away.
     One hand, not both – raising both arms is the Fruit Picking move, which people copy while they watch. */
  const dz = { low: 0, armed: false, t0: 0 };
  function demoGestureTick(now) {
    const h = hands(); let p = 0;
    if (h && !h.L && !h.R) { if (!dz.low) dz.low = now; if (now - dz.low >= LOW_MS) dz.armed = true; dz.t0 = 0; }
    else if (h && h.L !== h.R && dz.armed) {
      dz.low = 0; if (!dz.t0) dz.t0 = now;
      p = Math.min(1, (now - dz.t0) / 900);
      if (p >= 1) { dz.armed = false; dz.t0 = 0; p = 0; tone(1046.5, 0, 0.2, 'triangle', 0.2); endDemo(); }
    } else { dz.low = 0; dz.t0 = 0; }
    renderDemoGesture(p);
  }
  function renderDemoGesture(p) { const f = $('demoSkip').querySelector('.hfill'); if (f) f.style.width = Math.round(p * 100) + '%'; }

  /* ---------- switch to another game in the middle of one ----------
     The current round is simply dropped (no result, no best time); the new game starts with Grandpa's demo. */
  GW.switchGame = function (target) {
    if (wiping || !GW.MODES[target]) return;
    const p = game.phase;
    if (p === 'intro' || p === 'done' || !GW.started) { GW.setMode(target); return; }
    if (target === game.mode) return;
    clearTimeout(cdTimer); clearTimeout(demoTimer);
    game.phase = 'switching'; hidePrompt(); ensureAudio(); tone(660, 0, 0.12, 'triangle', 0.16);
    wipe(GW.MODES[target].name, () => {
      game.mode = target; game.twistSide = 0; game.step = 'ready'; live.prog = 0;
      $('exName').textContent = GW.MODES[target].name; $('exKind').textContent = GW.MODES[target].kind;
      R.reps = 0; R.elapsed = 0;
      if (GW.three && GW.three.roundStart) GW.three.roundStart();
      GW.updateHUD(); GW.updateReadouts(true); if (GW.updateForm) GW.updateForm();
      beginDemo();
    });
  };
  function endDemo() {
    if (game.phase !== 'demo' || wiping) return;
    clearTimeout(demoTimer);
    wipe('Your turn!', startCountdown);
  }

  function enterIntro() {
    clearTimeout(cdTimer); clearTimeout(demoTimer); cancelWipe();
    game.phase = 'intro'; hidePrompt();
    const M = GW.MODES[game.mode], [n, f] = plan();
    $('inName').textContent = M.name; $('inKind').textContent = M.kind; $('inGoal').textContent = M.goal;
    $('inReps').textContent = n + '+' + f;
    $('inBest').textContent = best[game.mode] ? fmt(best[game.mode]) : '—';
    $('inRound').textContent = R.n + 1;
    $('inSteps').innerHTML = M.steps.map((t, i) => '<li><b>' + (i + 1) + '</b>' + t + '</li>').join('');
    $('carPrevName').textContent = GW.MODES[modeAt(-1)].name; $('carNextName').textContent = GW.MODES[modeAt(1)].name;
    document.querySelectorAll('#carDots i').forEach((d, i) => d.classList.toggle('on', GW.MODE_ORDER[i] === game.mode));
    R.reps = 0; R.elapsed = 0; showOverlay('intro'); gestureReset();
    bannerKey = ''; GW.setBanner('Raise both hands to start', 'info');
    if (GW.three && GW.three.roundStart) GW.three.roundStart();
    GW.updateHUD();
  }
  let cdTimer = 0;
  function startCountdown() {
    if (game.phase !== 'intro' && game.phase !== 'done' && game.phase !== 'demo') return;
    clearTimeout(demoTimer);
    ensureAudio(); showOverlay(null); game.phase = 'count'; hidePrompt(); syncStage();
    if (game.mode === 'sort') pickNextSort(true);
    R.reps = 0; R.elapsed = 0; GW.updateHUD();
    if (GW.three && GW.three.roundStart) GW.three.roundStart();
    let n = 3;
    const step = () => {
      if (game.phase !== 'count') return;
      if (n > 0) { judge(String(n), 'count', ''); tone(587.33, 0, 0.25, 'triangle', 0.2); GW.setBanner('Get ready…', 'info'); n--; cdTimer = setTimeout(step, 950); }
      else { judge('GO!', 'go', ''); tone(1174.7, 0, 0.5, 'triangle', 0.22); beginRound(); }
    };
    step();
  }
  function beginRound() {
    R.n++; R.reps = 0; R.kcal0 = stats.kcal; R.elapsed = 0;
    game.lastHarvestTime = 0; game.lastActive = 0; game.twistSide = 0;
    game.step = game.mode === 'sort' ? 'go' : 'ready';              // sit / arms down first; the first fruit counts straight away
    game.phase = 'play'; syncStage();
    bannerKey = ''; GW.setBanner(GW.MODES[game.mode].hint, 'info');
    GW.updateHUD();
  }
  function finishRound() {
    if (game.phase !== 'play' && game.phase !== 'finishing') return;
    game.phase = 'done'; hidePrompt();
    const t = Math.round(R.elapsed), prev = best[game.mode], isBest = !prev || t < prev;
    if (isBest) { best[game.mode] = t; saveBest(); }
    R.result = { isBest };
    judge('FINISH!', 'finish', '');
    playFanfare();
    if (GW.three && GW.three.finishFX) GW.three.finishFX(3);
    GW.setBanner('Round complete – well done!', 'ok');
    GW.updateHUD();
    setTimeout(showResults, 1500);
  }
  function showResults() {
    if (game.phase !== 'done') return;
    const M = GW.MODES[game.mode];
    $('rsHead').textContent = 'Round ' + R.n + ' complete';
    $('rsName').textContent = M.name;
    $('rsMsg').textContent = ['Well done!', 'Brilliant work!', 'Great job!'][R.n % 3];
    $('rsDone').querySelectorAll('i[data-i]').forEach((c, i) => { c.classList.remove('on'); void c.offsetWidth; c.style.animationDelay = (i * 0.04) + 's'; c.classList.add('on'); });
    $('rsReps').textContent = R.reps;
    $('rsTime').textContent = fmt(R.elapsed);
    $('rsKcal').textContent = (stats.kcal - R.kcal0).toFixed(1);
    $('rsBest').hidden = !R.result.isBest;
    $('rsToday').textContent = game.reps + ' / ' + settings.goal;
    $('rsDayFill').style.width = Math.round(clamp01(game.reps / settings.goal) * 100) + '%';
    $('rsNextLbl').textContent = 'Next: ' + GW.MODES[nextMode()].name;
    showOverlay('results'); gestureReset();
    bannerKey = ''; GW.setBanner('Raise both hands for the next game', 'info');
  }
  function doAction(a) {
    if (wiping) return;
    if (game.phase === 'demo') { if (a === 'go') endDemo(); return; }
    if (game.phase === 'intro') {
      if (a === 'go') startDemo();
      else { GW.setMode(modeAt(a === 'prev' ? -1 : 1)); tone(a === 'prev' ? 660 : 880, 0, 0.12, 'triangle', 0.16); }
    } else if (game.phase === 'done' && a === 'go') GW.setMode(nextMode());
  }

  /* ============================================================
     HANDS-FREE CONTROLS on the game-select and results cards
       • left hand up (alone) ~0.7 s  → previous game      • right hand up (alone) → next game
       • twist the upper body left / right                → previous / next game
       • BOTH hands up 1 s                                → start (or continue after a round)
     The screen is a mirror, so your left hand / left twist moves to the left.
     Every gesture waits until both hands are down (or you face the front) before it can fire again.
     ============================================================ */
  const BOTH_MS = 1000, ONE_MS = 700, LOW_MS = 400, HAND_MARGIN = 0.05;
  const gz = { both: 0, one: 0, side: null, armedBoth: false, armedOne: false, low: 0, twistArmed: false, pBoth: 0, pOne: 0 };
  function hands() {
    const lm = GW.track.lm; if (!lm || performance.now() - GW.track.t > 500) return null;
    const up = (s, w) => lm[s] && lm[w] && (lm[s].visibility ?? 0) >= 0.5 && (lm[w].visibility ?? 0) >= 0.5 && lm[w].y < lm[s].y - HAND_MARGIN;
    return { L: up(11, 15), R: up(12, 16) };
  }
  function gestureReset() { Object.assign(gz, { both: 0, one: 0, side: null, armedBoth: false, armedOne: false, low: 0, twistArmed: false, pBoth: 0, pOne: 0 }); renderGesture(); }
  function gestureTick(now) {
    const h = hands();
    if (!h) { gz.both = gz.one = 0; gz.pBoth = gz.pOne = 0; return; }
    if (!h.L && !h.R) {
      if (!gz.low) gz.low = now;
      if (now - gz.low >= LOW_MS) { gz.armedBoth = true; gz.armedOne = true; }
      gz.both = gz.one = 0; gz.pBoth = gz.pOne = 0;
    } else gz.low = 0;
    if (h.L && h.R) {
      gz.one = 0; gz.pOne = 0;
      if (gz.armedBoth) {
        if (!gz.both) gz.both = now;
        gz.pBoth = Math.min(1, (now - gz.both) / BOTH_MS);
        if (gz.pBoth >= 1) { gz.armedBoth = gz.armedOne = false; gz.both = 0; gz.pBoth = 0; tone(1046.5, 0, 0.2, 'triangle', 0.2); doAction('go'); }
      }
    } else if (h.L || h.R) {
      gz.both = 0; gz.pBoth = 0;
      const side = h.L ? 'L' : 'R';
      if (side !== gz.side) { gz.side = side; gz.one = 0; }
      if (gz.armedOne && game.phase === 'intro') {
        if (!gz.one) gz.one = now;
        gz.pOne = Math.min(1, (now - gz.one) / ONE_MS);
        if (gz.pOne >= 1) { gz.armedOne = false; gz.one = 0; gz.pOne = 0; doAction(side === 'L' ? 'prev' : 'next'); }
      }
    }
    /* twist to switch (game select only) */
    if (game.phase === 'intro' && live.ok.twist && live.twist != null) {
      const s = live.twist * CFG.TWIST_SCREEN_SIGN;
      if (Math.abs(live.twist) < CFG.TWIST_TARGET * 0.5) gz.twistArmed = true;
      else if (gz.twistArmed && Math.abs(s) > CFG.TWIST_TARGET * 1.2 && !h.L && !h.R) { gz.twistArmed = false; doAction(s < 0 ? 'prev' : 'next'); }
    }
  }
  function renderGesture() {
    const w = Math.round(gz.pBoth * 100) + '%';
    $('inGo').querySelector('.hfill').style.width = w; $('rsNext').querySelector('.hfill').style.width = w;
    $('carPrev').querySelector('.hfill').style.height = gz.side === 'L' ? Math.round(gz.pOne * 100) + '%' : '0%';
    $('carNext').querySelector('.hfill').style.height = gz.side === 'R' ? Math.round(gz.pOne * 100) + '%' : '0%';
  }

  /* ---------- the coach window: big while you get ready, small while you are moving ---------- */
  let coachBig = null;
  function updateCoachSize(now) {
    const p = game.phase, mov = Math.abs(live.prog || 0) > 0.3 && live.tracking;
    if (p === 'play' && mov) game.lastActive = now;
    const big = p === 'intro' || p === 'demo' || p === 'count' || (p === 'play' && now - (game.lastActive || 0) > 5000);
    if (big !== coachBig) { coachBig = big; $('coachMini').classList.toggle('big', big); }
  }

  /* ---------- game clock (10 Hz) ---------- */
  let lastTick = performance.now();
  function tick() {
    const now = performance.now(), dt = Math.min(0.5, (now - lastTick) / 1000); lastTick = now;
    if (!GW.started) return;
    const calibOn = !!(GW.calib && GW.calib.active), sheetOpen = !!document.querySelector('.sheet.open');
    if (game.phase === 'play' && live.tracking && !calibOn) { R.elapsed += dt; stats.seconds += dt; }
    if (game.phase === 'play' && !live.tracking) setPrompt('STEP INTO VIEW', 'warn', 'I can’t see you right now');
    if ((game.phase === 'intro' || game.phase === 'done') && !calibOn && !sheetOpen) {
      gestureTick(now); renderGesture();
      if (live.tracking) GW.setBanner(game.phase === 'intro' ? 'Raise both hands to start · one hand or a twist to switch game' : 'Raise both hands for the next game', 'info');
    }
    if (game.phase === 'demo' && !calibOn && !sheetOpen) demoGestureTick(now);
    updateCoachSize(now); syncStage(now);
    GW.updateTime();
  }

  /* ---------- what is on screen in each phase ----------
     camera window: only on the menu / results and during the 3-2-1 (to check you are in the picture);
                    hidden while you play, unless I lose sight of you for a moment
     coach window:  your setting, but always shown big in the middle during Grandpa's demo */
  let stageKey = '';
  function syncStage(now) {
    now = now || performance.now();
    const p = game.phase, demo = p === 'demo', playing = p === 'play' || p === 'finishing';
    const lost = playing && GW.started && !live.tracking && now - (live.lastSeen || 0) > 1500;
    const cam = settings.cam && (p === 'intro' || p === 'done' || p === 'count' || lost);
    const coach = settings.coach || demo;
    const key = cam + '|' + coach + '|' + demo;
    if (key === stageKey) return; stageKey = key;
    $('camWin').classList.toggle('off', !cam); GW.ui.showCam = cam;
    $('coachMini').hidden = !coach; GW.ui.coachOpen = coach;
    $('camera-container').classList.toggle('demo', demo);
    $('demo').hidden = !demo;
    $('coachTag').textContent = demo ? 'Watch Grandpa' : 'Follow Grandpa';
  }

  /* ---------- choose your farmer ---------- */
  GW.setAvatar = function (id) {
    if (!(GW.AVATARS || []).some(a => a.id === id)) id = 'somchai';
    settings.avatar = id; saveSettings();
    if (GW.three && GW.three.setAvatar) GW.three.setAvatar(id);
    document.querySelectorAll('.av-opt').forEach(b => b.classList.toggle('on', b.dataset.id === id));
  };
  function buildPickers() {
    const list = GW.AVATARS || []; if (!list.length) return;
    const thumbs = GW.three && GW.three.avatarThumbs ? GW.three.avatarThumbs() : {};
    document.querySelectorAll('.av-pick').forEach(box => {
      const withBot = box.dataset.bot === '1';
      box.innerHTML = list.filter(a => withBot || a.id !== 'ybot').map(a =>
        '<button class="av-opt" data-id="' + a.id + '" aria-label="' + a.name + '">' +
        (thumbs[a.id] ? '<img alt="" src="' + thumbs[a.id] + '">' : '<span class="av-bot">Y</span>') +
        '<b>' + a.name + '</b><small>' + a.who + '</small></button>').join('');
      box.querySelectorAll('.av-opt').forEach(b => b.addEventListener('click', () => { GW.setAvatar(b.dataset.id); tone(880, 0, 0.12, 'triangle', 0.16); }));
    });
  }

  /* ---------- Coach-sheet readouts (target labels follow the active profile) ---------- */
  function setRead(rowId, valId, text, hit) { $(valId).textContent = text; $(rowId).classList.toggle('hit', !!hit); }
  GW.updateReadouts = function (force) {
    if (!force && !GW.ui.detailsOpen) return;               // nothing to draw while the details sheet is closed
    document.querySelectorAll('.read').forEach(r => r.classList.toggle('focus', r.dataset.modes === game.mode));
    const f = v => v == null ? '--' : Math.round(v) + '°', t = live.tracking, L = live, R = Math.round;
    $('tHip').textContent   = 'target > ' + R(CFG.HIP_TARGET) + '°';
    $('tThigh').textContent = 'target < ' + R(CFG.THIGH_TARGET) + '°';
    $('tArms').textContent  = 'target > ' + R(CFG.ARM_UP) + '° both';
    $('tTwist').textContent = 'target ± ' + R(CFG.TWIST_TARGET) + '° each side';
    setRead('rowHip',   'rHip',   t && L.ok.leg ? f(L.hip)   : '--', t && L.ok.leg && L.hip > CFG.HIP_TARGET);
    setRead('rowThigh', 'rThigh', t && L.ok.leg ? f(L.thigh) : '--', t && L.ok.leg && L.thigh < CFG.THIGH_TARGET);
    setRead('rowKnee',  'rKnee',  t && L.ok.leg ? f(L.knee)  : '--', false);
    setRead('rowLean',  'rLean',  t && L.ok.leg ? f(L.lean)  : '--', false);
    setRead('rowArms',  'rArms',  t && L.ok.arms ? f(L.armL) + ' / ' + f(L.armR) : '--', t && L.ok.arms && Math.min(L.armL, L.armR) > CFG.ARM_UP);
    setRead('rowTwist', 'rTwist', t && L.ok.twist ? (L.twist > 0 ? '+' : '') + f(L.twist) : '--', t && L.ok.twist && Math.abs(L.twist) > CFG.TWIST_TARGET);
  };

  /* ---------- Exercise selection ---------- */
  GW.setMode = function (mode) {
    const changed = mode !== game.mode;
    game.mode = mode; game.twistSide = 0; live.prog = 0;
    $('exName').textContent = GW.MODES[mode].name; $('exKind').textContent = GW.MODES[mode].kind;
    /* a different game (or nothing running yet) opens the game-select card; re-selecting the same one
       mid-round – e.g. after a profile change – keeps the round going */
    if (changed || game.phase === 'intro' || game.phase === 'done' || !GW.booted) enterIntro();
    GW.updateReadouts(true); if (GW.updateForm) GW.updateForm(); ensureAudio();
  };
  function setGMode(m) {
    GW.ui.gMode = m;
    $('segCoach').classList.toggle('on', m === 'coach'); $('segMirror').classList.toggle('on', m === 'mirror'); ensureAudio();
  }

  /* ---------- Sheets ---------- */
  function closeSheets() {
    document.querySelectorAll('.sheet.open').forEach(s => s.classList.remove('open'));
    $('backdrop').classList.remove('show'); GW.ui.detailsOpen = false;
  }
  function openSheet(id) {
    closeSheets(); $(id).classList.add('open'); $('backdrop').classList.add('show');
    if (id === 'coachSheet') { GW.ui.detailsOpen = true; GW.updateReadouts(true); }
  }

  /* ---------- Start, wake lock, full screen ---------- */
  let wakeLock = null;
  function keepAwake() {
    try {
      if ('wakeLock' in navigator) navigator.wakeLock.request('screen').then(l => { wakeLock = l; l.addEventListener('release', () => { wakeLock = null; }); }, () => {});
    } catch (e) {}
  }
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && GW.started && !wakeLock) keepAwake(); });

  function startGame(then) {
    ensureAudio();
    $('welcome').classList.add('hide');
    GW.started = true; GW.afterStart = then || null;
    const st = $('status'); st.className = ''; $('statusRetry').hidden = true;
    $('statusMsg').innerHTML = 'Starting camera and loading the pose model…<br>Please allow camera access.';
    keepAwake();
    if (GW.mp) GW.mp.start();
  }
  /* called by mediapipe.js when the first camera frame has been processed */
  GW.onFirstFrame = function () {
    $('status').classList.add('hidden');
    if (GW.afterStart === 'calibrate') { GW.afterStart = null; $('calBtn').click(); }
  };

  function fsSupported() { const d = document.documentElement; return !!(d.requestFullscreen || d.webkitRequestFullscreen); }
  function toggleFullscreen() {
    const d = document, el = d.documentElement;
    if (d.fullscreenElement || d.webkitFullscreenElement) (d.exitFullscreen || d.webkitExitFullscreen).call(d);
    else (el.requestFullscreen || el.webkitRequestFullscreen).call(el);
  }

  /* the small coach window (top-left): hidden = not drawn, which also saves battery */
  function applyCoach() { stageKey = ''; syncStage(); }
  /* the camera window (right): live video + MediaPipe skeleton and joint hints */
  function applyCam() { stageKey = ''; syncStage(); }


  /* ---------- Boot ---------- */
  GW.boot = function () {
    loadSettings();
    $('goalSel').value = String(settings.goal); $('weightIn').value = settings.weight;
    $('qualSel').value = settings.quality; $('soundOn').checked = settings.sound; $('coachOn').checked = settings.coach;
    $('showCam').checked = settings.cam;
    $('roundSel').value = settings.round;
    applyCoach(); applyCam();

    $('carPrev').addEventListener('click', () => doAction('prev'));
    $('swPrev').addEventListener('click', () => GW.switchGame(modeAt(-1)));
    $('swNext').addEventListener('click', () => GW.switchGame(modeAt(1)));
    $('carNext').addEventListener('click', () => doAction('next'));
    $('segCoach').addEventListener('click', () => setGMode('coach'));
    $('segMirror').addEventListener('click', () => setGMode('mirror'));

    $('coachMini').addEventListener('click', () => openSheet('coachSheet'));
    $('btnMenu').addEventListener('click', () => openSheet('menuSheet'));
    $('backdrop').addEventListener('click', closeSheets);
    document.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', closeSheets));
    window.addEventListener('keydown', e => {
      if (e.key === 'Escape') { closeSheets(); return; }
      if (GW.started && (e.key === 'ArrowLeft' || e.key === 'ArrowRight') && !document.querySelector('.sheet.open') && !(GW.calib && GW.calib.active)) {
        if (game.phase === 'intro') doAction(e.key === 'ArrowLeft' ? 'prev' : 'next');
        else if (game.phase !== 'done') GW.switchGame(modeAt(e.key === 'ArrowLeft' ? -1 : 1));   // mid-game: jump to the next game
        return;
      }
      if ((e.key === 'Enter' || e.key === ' ') && GW.started && !(GW.calib && GW.calib.active) && !document.querySelector('.sheet.open')
          && (game.phase === 'intro' || game.phase === 'done' || game.phase === 'demo') && !(e.target && /INPUT|SELECT|TEXTAREA|BUTTON/.test(e.target.tagName))) {
        e.preventDefault(); doAction('go'); return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey || (e.target && /INPUT|SELECT|TEXTAREA/.test(e.target.tagName))) return;
      if (!GW.started || (GW.calib && GW.calib.active)) return;           // shortcuts only while playing
      const k = e.key.toLowerCase();
      if (k === '1' || k === '2' || k === '3') GW.switchGame(GW.MODE_ORDER[+k - 1]);
      else if (k === 'm') { $('menuSheet').classList.contains('open') ? closeSheets() : openSheet('menuSheet'); }
      else if (k === 'f' && fsSupported()) toggleFullscreen();
    });
    $('calBtn').addEventListener('click', closeSheets);              // calibration.js opens the wizard from the same button

    $('goalSel').addEventListener('change', e => { settings.goal = +e.target.value; stats.goalHit = game.reps >= settings.goal; saveSettings(); GW.updateHUD(); });
    $('weightIn').addEventListener('change', e => { settings.weight = clamp(+e.target.value || 60, 30, 150); e.target.value = settings.weight; saveSettings(); });
    $('qualSel').addEventListener('change', e => { settings.quality = e.target.value; saveSettings(); if (GW.mp && GW.mp.setQuality) GW.mp.setQuality(GW.quality()); });
    $('coachOn').addEventListener('change', e => { settings.coach = e.target.checked; saveSettings(); applyCoach(); });
    $('soundOn').addEventListener('change', e => { settings.sound = e.target.checked; saveSettings(); });
    $('showCam').addEventListener('change', e => { settings.cam = e.target.checked; saveSettings(); applyCam(); });
    $('roundSel').addEventListener('change', e => { settings.round = e.target.value; saveSettings(); if (game.phase !== 'play') enterIntro(); else GW.updateHUD(); });
    $('inGo').addEventListener('click', startDemo);
    $('demoSkip').addEventListener('click', endDemo);
    buildPickers(); GW.setAvatar(settings.avatar);
    $('rsNext').addEventListener('click', () => GW.setMode(nextMode()));
    $('rsAgain').addEventListener('click', startCountdown);
    $('resetBtn').addEventListener('click', () => {
      game.reps = 0; game.twistSide = 0; R.n = 0;
      stats.kcal = 0; stats.seconds = 0; stats.goalHit = false; closeSheets(); enterIntro();
    });
    if (fsSupported()) $('fsBtn').addEventListener('click', toggleFullscreen); else $('fsBtn').hidden = true;

    $('startBtn').addEventListener('click', () => startGame(null));
    $('startCalBtn').addEventListener('click', () => startGame('calibrate'));
    $('statusRetry').addEventListener('click', () => location.reload());

    GW.setMode('potato');
    if (GW.calib && GW.calib.init) GW.calib.init();                  // loads the saved body profile
    GW.booted = true;
    setInterval(tick, 100);
  };
})();
