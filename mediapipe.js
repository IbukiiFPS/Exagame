/* ============================================================
   mediapipe.js – webcam, MediaPipe Pose, joint-angle maths,
   optional camera preview, calibration preview.
   Started by the Start button (game.js), so phones can ask for camera permission after a tap.
   ============================================================ */
(function () {
  'use strict';
  const { $, U, CFG, game, live, track } = GW;
  const { deg, lerp, angleAt, fromVertical, wrap180 } = U;

  const videoEl = $('input-video');
  const outCanvas = $('output-canvas');
  const octx = outCanvas ? outCanvas.getContext('2d') : null;
  const calibCanvas = $('calibView');
  const cctx = calibCanvas ? calibCanvas.getContext('2d') : null;
  const statusEl = $('status');

  GW.mp = { canvas: outCanvas, started: false };

  /* ---------- Joint angles from landmarks ---------- */
  function extractMetrics(res, W, H) {
    const lm = res.poseLandmarks; if (!lm) return null;
    const P = i => ({ x: lm[i].x * W, y: lm[i].y * H, v: lm[i].visibility ?? 0 });
    const m = { hip: null, thigh: null, knee: null, lean: null, armL: null, armR: null, elbL: null, elbR: null, twistRaw: null, twistShRaw: null };

    // Leg chain: the chosen side ('L' / 'R' = the person's own left / right) or the more visible one
    const chains = [[11, 23, 25, 27], [12, 24, 26, 28]].map(ix => {
      const p = ix.map(P); return { p, vis: Math.min(p[0].v, p[1].v, p[2].v, p[3].v) };
    });
    const best = CFG.SIDE === 'L' ? chains[0] : CFG.SIDE === 'R' ? chains[1] : (chains[0].vis >= chains[1].vis ? chains[0] : chains[1]);
    if (best.vis >= CFG.MIN_VIS) {
      const [sh, hip, kn, an] = best.p;
      m.hip = angleAt(sh, hip, kn); m.knee = angleAt(hip, kn, an);
      m.thigh = fromVertical(hip, kn); m.lean = fromVertical(hip, sh);
    }
    // Arms: angle at the shoulder between hip and wrist (~0 hanging, ~180 overhead)
    const arm = (s, h, w) => { const a = P(s), b = P(h), c = P(w); return Math.min(a.v, b.v, c.v) >= CFG.MIN_VIS ? angleAt(b, a, c) : null; };
    m.armL = arm(11, 23, 15); m.armR = arm(12, 24, 16);
    // Elbows: angle at the elbow (180 = straight arm) – lets the avatar bend its arms like you do
    const elb = (s, e, w) => { const a = P(s), b = P(e), c = P(w); return Math.min(a.v, b.v, c.v) >= CFG.MIN_VIS ? angleAt(a, b, c) : null; };
    m.elbL = elb(11, 13, 15); m.elbR = elb(12, 14, 16);

    // Torso twist (raw): shoulder-line rotation relative to hip-line (world landmarks).
    // The person's own neutral offset is subtracted later, in smoothInto().
    const wl = res.poseWorldLandmarks;
    if (wl && Math.min(lm[11].visibility ?? 0, lm[12].visibility ?? 0, lm[23].visibility ?? 0, lm[24].visibility ?? 0) >= CFG.MIN_VIS) {
      const ang = (a, b) => deg(Math.atan2(b.z - a.z, b.x - a.x)), hipA = ang(wl[23], wl[24]);
      m.twistShRaw = wrap180(ang(wl[11], wl[12]) - hipA);              // shoulder line vs hip line
      m.twistRaw = m.twistShRaw;
      if (Math.min(lm[13].visibility ?? 0, lm[14].visibility ?? 0) >= CFG.MIN_VIS) {
        /* the arms turn with the chest: the elbow line swings round with the shoulders, so the reading uses both –
           a real twist needs the shoulders AND the arms to go round together */
        const el = wrap180(ang(wl[13], wl[14]) - hipA);
        m.twistRaw = wrap180(m.twistShRaw + 0.45 * wrap180(el - m.twistShRaw));
      }
    }
    return m;
  }
  function smoothInto(m) {
    for (const k of ['hip', 'thigh', 'knee', 'lean', 'armL', 'armR', 'elbL', 'elbR', 'twistRaw', 'twistShRaw']) {
      if (m[k] == null) continue;
      live[k] = live[k] == null ? m[k] : lerp(live[k], m[k], CFG.EMA);
    }
    /* Sign convention: live.twist > 0 = turned toward the SCREEN-RIGHT side.
       The screen is a mirror, so turning to your own left must read as screen-left (negative).
       Raw world-landmark twist is positive when you turn to your own left (right shoulder comes
       toward the camera), hence the minus sign. */
    if (live.twistRaw != null) live.twist = -wrap180(live.twistRaw - CFG.TWIST_OFFSET);
    if (live.twistShRaw != null) live.twistSh = -wrap180(live.twistShRaw - CFG.TWIST_OFFSET);
    live.ok.leg = m.hip != null;
    live.ok.arms = m.armL != null && m.armR != null;
    live.ok.twist = m.twistRaw != null;
  }

  /* ---------- Preview drawing (canvases are mirrored by CSS scaleX(-1)) ----------
     Base skeleton is drawn soft white; the joints that matter for the current exercise are
     highlighted with angle arcs, live degree labels and arrows showing which way to move. */
  const CONNECTIONS = [[11, 12], [11, 13], [13, 15], [12, 14], [14, 16], [11, 23], [12, 24], [23, 24],
    [23, 25], [25, 27], [24, 26], [26, 28], [27, 29], [29, 31], [27, 31], [28, 30], [30, 32], [28, 32]];
  const KEY_JOINTS = [11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28];
  const C_OK = '#2fd673', C_FOCUS = '#ffb21a', C_BASE = 'rgba(255,255,255,.75)', FONT = '"Nunito",ui-rounded,system-ui,sans-serif';

  function pill(ctx, text, x, y, fs, bg, fg) {                     // label drawn un-mirrored so it reads correctly
    ctx.save(); ctx.translate(x, y); ctx.scale(-1, 1);
    ctx.font = '900 ' + fs + 'px ' + FONT; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const w = ctx.measureText(text).width + fs * 0.9, h = fs * 1.5, r = h / 2;
    ctx.beginPath();
    ctx.moveTo(-w / 2 + r, -h / 2); ctx.lineTo(w / 2 - r, -h / 2); ctx.arc(w / 2 - r, 0, r, -Math.PI / 2, Math.PI / 2);
    ctx.lineTo(-w / 2 + r, h / 2); ctx.arc(-w / 2 + r, 0, r, Math.PI / 2, Math.PI * 1.5); ctx.closePath();
    ctx.fillStyle = bg; ctx.fill(); ctx.fillStyle = fg; ctx.fillText(text, 0, fs * 0.05);
    ctx.restore();
  }
  function arcAt(ctx, a, b, c, r, col, lw) {                      // angle arc at joint b, between rays b→a and b→c
    const a1 = Math.atan2(a.y - b.y, a.x - b.x), a2 = Math.atan2(c.y - b.y, c.x - b.x);
    let d = a2 - a1; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI;
    ctx.save(); ctx.globalAlpha = .28; ctx.fillStyle = col;
    ctx.beginPath(); ctx.moveTo(b.x, b.y); ctx.arc(b.x, b.y, r, a1, a1 + d, d < 0); ctx.closePath(); ctx.fill();
    ctx.globalAlpha = 1; ctx.strokeStyle = col; ctx.lineWidth = lw;
    ctx.beginPath(); ctx.arc(b.x, b.y, r, a1, a1 + d, d < 0); ctx.stroke(); ctx.restore();
  }
  function arrow(ctx, x, y, dx, dy, len, col, lw) {               // chevron arrow pointing along (dx, dy)
    const ex = x + dx * len, ey = y + dy * len, hs = len * 0.45, px = -dy, py = dx;
    ctx.save(); ctx.strokeStyle = col; ctx.lineWidth = lw; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.shadowColor = 'rgba(0,0,0,.35)'; ctx.shadowBlur = 6;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(ex, ey);
    ctx.moveTo(ex - dx * hs + px * hs, ey - dy * hs + py * hs); ctx.lineTo(ex, ey); ctx.lineTo(ex - dx * hs - px * hs, ey - dy * hs - py * hs);
    ctx.stroke(); ctx.restore();
  }
  function seg(ctx, p, q, col, lw) {
    ctx.strokeStyle = col; ctx.lineWidth = lw; ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y); ctx.stroke();
  }

  function drawHints(ctx, lm, W, H, hit) {
    const P = i => ({ x: lm[i].x * W, y: lm[i].y * H, v: lm[i].visibility ?? 0 });
    const vis = (...ix) => ix.every(i => (lm[i].visibility ?? 0) >= 0.4);
    const u = W / 100, fs = Math.max(11, Math.round(u * 3.6)), lw = Math.max(4, u * 1.3);
    const bob = Math.sin(performance.now() / 220) * u * 1.2;      // gentle bounce on the arrows
    const R = Math.round, mode = game.mode;
    ctx.lineCap = 'round';

    if (mode === 'potato') {                                      // sit-to-stand: hip + knee on the visible leg
      const chains = [[11, 23, 25, 27], [12, 24, 26, 28]];
      const vmin = ix => Math.min(...ix.map(i => lm[i].visibility ?? 0));
      const ix = CFG.SIDE === 'L' ? chains[0] : CFG.SIDE === 'R' ? chains[1] : (vmin(chains[0]) >= vmin(chains[1]) ? chains[0] : chains[1]);
      if (!vis(...ix)) return;
      const [sh, hp, kn, an] = ix.map(P), hipOk = live.hip > CFG.HIP_TARGET, col = hipOk ? C_OK : C_FOCUS;
      seg(ctx, sh, hp, col, lw * 1.4); seg(ctx, hp, kn, col, lw * 1.4); seg(ctx, kn, an, C_BASE, lw);
      const r = Math.hypot(kn.x - hp.x, kn.y - hp.y) * 0.38;
      arcAt(ctx, sh, hp, kn, r, col, lw * 0.6);
      arcAt(ctx, hp, kn, an, r * 0.75, 'rgba(255,255,255,.9)', lw * 0.45);
      pill(ctx, 'HIP ' + R(live.hip) + '°', hp.x + (hp.x < W / 2 ? -1 : 1) * r * 1.9, hp.y, fs, col, '#16213a');
      pill(ctx, R(live.knee) + '°', kn.x + (kn.x < W / 2 ? -1 : 1) * r * 1.5, kn.y, fs * 0.8, 'rgba(255,255,255,.92)', '#16213a');
      if (!hit) arrow(ctx, sh.x, sh.y - u * 6 - bob, 0, -1, u * 7, C_FOCUS, lw);
      return;
    }

    if (mode === 'fruit') {                                       // arm raises: both shoulders
      [[11, 13, 15, 23, live.armL], [12, 14, 16, 24, live.armR]].forEach(([s, e, w, h, ang]) => {
        if (!vis(s, e, w, h) || ang == null) return;
        const S = P(s), E = P(e), Wr = P(w), Hp = P(h), ok = ang > CFG.ARM_UP, col = ok ? C_OK : C_FOCUS;
        seg(ctx, S, E, col, lw * 1.4); seg(ctx, E, Wr, col, lw * 1.4);
        const r = Math.hypot(E.x - S.x, E.y - S.y) * 0.45;
        arcAt(ctx, Hp, S, Wr, r, col, lw * 0.6);
        const out = S.x < P(s === 11 ? 12 : 11).x ? -1 : 1;     // label on the outside of the body
        pill(ctx, R(ang) + '°', S.x + out * r * 1.6, S.y + r * 0.2, fs, col, '#16213a');
        if (!ok) arrow(ctx, Wr.x, Wr.y - u * 4 - bob, 0, -1, u * 7, C_FOCUS, lw);
      });
      if (vis(0, 11, 12)) {                                       // dashed "reach here" line above the head
        const n = P(0), y = n.y - Math.abs(P(11).x - P(12).x) * 0.9;
        ctx.save(); ctx.setLineDash([u * 2.5, u * 2]); ctx.strokeStyle = hit ? C_OK : 'rgba(255,255,255,.8)'; ctx.lineWidth = lw * 0.5;
        ctx.beginPath(); ctx.moveTo(n.x - u * 18, y); ctx.lineTo(n.x + u * 18, y); ctx.stroke(); ctx.restore();
      }
      return;
    }

    if (!vis(11, 12, 23, 24) || live.twist == null) return;      // torso twist: shoulder line vs hip line
    /* the fruit decides the direction: apple = screen-left, orange = screen-right.
       The canvas is mirrored by CSS, so screen-left is +x in picture coordinates. */
    const need = game.sortNeed, fruitCol = need === 'L' ? '#ff4d5e' : '#ff9a1f';
    const sTw = live.twist * CFG.TWIST_SCREEN_SIGN, ok = need === 'R' ? sTw > CFG.TWIST_TARGET : sTw < -CFG.TWIST_TARGET;
    const wrong = need === 'R' ? sTw < -CFG.TWIST_TARGET : sTw > CFG.TWIST_TARGET, col = ok ? C_OK : wrong ? '#ff5d5d' : fruitCol;
    const L1 = P(11), R1 = P(12), L2 = P(23), R2 = P(24);
    seg(ctx, L2, R2, 'rgba(255,255,255,.9)', lw);
    seg(ctx, L1, R1, col, lw * 1.6);
    const mx = (L1.x + R1.x) / 2, my = (L1.y + R1.y) / 2, half = Math.abs(L1.x - R1.x) / 2, dir = need === 'L' ? 1 : -1;
    pill(ctx, (need === 'L' ? '← APPLE  ' : 'ORANGE →  ') + R(Math.abs(live.twist)) + '°', mx, my - half * 0.95, fs, col, '#16213a');
    if (!ok && game.step !== 'back') arrow(ctx, mx + dir * (half + u * 3), my, dir, 0, u * 9 + Math.abs(bob) * 1.5, fruitCol, lw * 1.3);
  }

  function drawFrame(cv, ctx, results, targetReached, maxW, hints) {
    if (!cv || !ctx) return;
    const img = results.image;
    if (img && img.width) {                                       // maxW keeps the small window light: it is drawn at a lower resolution
      const sc = maxW ? Math.min(1, maxW / img.width) : 1, cw = Math.round(img.width * sc), ch = Math.round(img.height * sc);
      if (cv.width !== cw || cv.height !== ch) { cv.width = cw; cv.height = ch; }
    }
    const W = cv.width, H = cv.height;
    ctx.save(); ctx.clearRect(0, 0, W, H);
    if (img) ctx.drawImage(img, 0, 0, W, H);
    if (hints) { ctx.fillStyle = 'rgba(22,33,58,.22)'; ctx.fillRect(0, 0, W, H); }   // dim the video so the hints pop
    const lm = results.poseLandmarks;
    if (lm) {
      const col = hints ? C_BASE : (targetReached ? '#22c55e' : '#38bdf8');
      ctx.lineCap = 'round'; ctx.lineWidth = Math.max(3, W / (hints ? 160 : 110));
      ctx.strokeStyle = col; ctx.shadowColor = hints ? 'rgba(0,0,0,.4)' : col; ctx.shadowBlur = hints ? 4 : 10;
      CONNECTIONS.forEach(([a, b]) => {
        if ((lm[a].visibility ?? 1) < 0.4 || (lm[b].visibility ?? 1) < 0.4) return;
        ctx.beginPath(); ctx.moveTo(lm[a].x * W, lm[a].y * H); ctx.lineTo(lm[b].x * W, lm[b].y * H); ctx.stroke();
      });
      ctx.shadowBlur = 0;
      if (hints) drawHints(ctx, lm, W, H, targetReached);
      KEY_JOINTS.forEach(i => {
        if ((lm[i].visibility ?? 1) < 0.4) return;
        ctx.fillStyle = hints ? '#fff' : (targetReached ? '#bbf7d0' : '#f59e0b');
        ctx.beginPath(); ctx.arc(lm[i].x * W, lm[i].y * H, Math.max(hints ? 3 : 5, W / (hints ? 150 : 110)), 0, Math.PI * 2); ctx.fill();
      });
    }
    ctx.restore();
  }

  GW.mp.drawFrame = drawFrame;                                    // exposed so the preview can be tested without a camera

  function showError(msg) {
    GW.mp.started = false;
    if (statusEl) {
      statusEl.className = 'err';
      const m = $('statusMsg'); if (m) m.innerHTML = msg;
      const r = $('statusRetry'); if (r) r.hidden = false;
    }
    GW.setBanner('Camera unavailable', 'warn');
  }

  /* ---------- Start pose tracking + camera ---------- */
  let pose = null, cam = null, firstFrame = false;
  GW.mp.setQuality = function (q) { if (pose) pose.setOptions({ modelComplexity: q === 'fast' ? 0 : 1 }); };

  GW.mp.start = function () {
    if (GW.mp.started) return;
    GW.mp.started = true;
    if (typeof Pose === 'undefined' || typeof Camera === 'undefined') {
      showError('Could not load MediaPipe.<br>Check your internet connection and reload.'); return;
    }
    if (!window.isSecureContext && location.protocol !== 'file:') {
      showError('Camera access needs a secure page.<br>Open this game through <b>https://</b> (or http://localhost on a computer).'); return;
    }
    const fast = GW.quality() === 'fast';                         // phones use the lighter model and a smaller picture
    pose = new Pose({ locateFile: file => `https://cdn.jsdelivr.net/npm/@mediapipe/pose@0.5.1675469404/${file}` });
    pose.setOptions({ modelComplexity: fast ? 0 : 1, smoothLandmarks: true, enableSegmentation: false,
                      minDetectionConfidence: 0.5, minTrackingConfidence: 0.5 });

    pose.onResults(onResults);
    GW.mp.feed = onResults;                                       // test hook: push a results object through the same code
    function onResults(results) {
      if (!firstFrame) { firstFrame = true; if (GW.onFirstFrame) GW.onFirstFrame(); }
      const now = performance.now();
      const calibOn = !!(GW.calib && GW.calib.active);
      const iw = (results.image && results.image.width) || 1280, ih = (results.image && results.image.height) || 720;
      const m = extractMetrics(results, iw, ih);                  // angles must use the real picture shape
      let target = false;
      if (results.poseLandmarks) {
        track.lm = results.poseLandmarks; track.wl = results.poseWorldLandmarks || null; track.t = now;
        const lm = track.lm;                                      // whole body = shoulders, hips, knees and ankles all seen
        live.full = [11, 12, 23, 24, 25, 26, 27, 28].every(i => (lm[i].visibility ?? 0) >= 0.5);
      } else live.full = false;
      if (m) {
        smoothInto(m); live.tracking = true; live.lastSeen = now;
        target = calibOn ? false : GW.evaluateMode(now);          // scoring is paused during calibration
      } else if (now - live.lastSeen > 700) {
        live.tracking = false; live.prog = 0;
        if (!calibOn) GW.setBanner('I cannot see you – step back so your whole body is in view', 'warn');
      }
      game.targetReached = target;
      if (GW.ui.showCam && outCanvas && octx) {                   // the small camera window: video + MediaPipe skeleton
        drawFrame(outCanvas, octx, results, target, 480, true);
        const lost = !m, part = !lost && !live.full, w = $('camWin');
        if (w && (w.classList.contains('lost') !== lost || w.classList.contains('part') !== part)) {
          w.classList.toggle('lost', lost); w.classList.toggle('part', part);
          const ct = $('camTxt'); if (ct) ct.textContent = lost ? 'No body' : part ? 'Step back – show your legs' : 'Full body ✓';
        }
      }
      if (calibOn && calibCanvas && cctx) drawFrame(calibCanvas, cctx, results, GW.calib.good);
      GW.updateReadouts(); if (!calibOn && GW.updateForm) GW.updateForm();
    }

    cam = new Camera(videoEl, {
      onFrame: async () => { await pose.send({ image: videoEl }); },
      facingMode: 'user',                                         // front camera on phones and tablets
      width: fast ? 640 : 1280, height: fast ? 480 : 720
    });
    cam.start().catch(err => {
      const n = err && err.name;
      showError(n === 'NotAllowedError' ? 'Camera permission was denied.<br>Allow camera access for this site in your browser settings, then try again.'
              : n === 'NotFoundError'   ? 'No camera was found on this device.'
              : n === 'NotReadableError' ? 'The camera is being used by another app.<br>Close it and try again.'
              : 'Camera error: ' + (err && err.message ? err.message : err));
    });
  };
})();
