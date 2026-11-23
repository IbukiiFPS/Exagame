/* ============================================================
   three-scene.js – everything 3D
     A) Figure builder + forward kinematics (Grandpa coach + farmer avatars)
     B) Y Bot (Mixamo) rig driver – the player's 3D model
     C) The garden: floating island, trees, player avatar, game objects, star burst
     D) Sidebar 3D Grandpa coach
   ============================================================ */
(function () {
  'use strict';
  const { $, U, CFG, game, live, ui } = GW;
  const { rad, lerp, clamp, clamp01, ease, pulse } = U;

  if (typeof THREE === 'undefined') {
    GW.three = { harvestFX() {} };
    GW.setBanner('Could not load Three.js from the CDN', 'warn');
    return;
  }

  /* ---- Player model file (put it in the same folder as index.html) ---- */
  const MODEL_URL = 'y_bot_from_mixamo.glb';
  const FOOT_LIFT = 0.026;     // lifts the model so its soles rest on the grass (measured for this model)
  const IS_MOBILE = GW.IS_MOBILE;
  const PR_MAX = IS_MOBILE ? 1.5 : 2;   // lower pixel ratio on phones = smoother and cooler

  /* ==========================================================
     A) FIGURE BUILDER + FORWARD KINEMATICS
     The figure faces +z; its left side (+x) appears on screen-right when viewed from the front.
     ========================================================== */
  const _d = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0), _qy = new THREE.Quaternion();
  const V3 = (x, y, z) => new THREE.Vector3(x, y, z);

  function setBone(m, a, b, yaw = 0) {
    _d.subVectors(b, a); const L = _d.length(); if (L < 1e-5) return;
    m.position.copy(a).add(b).multiplyScalar(0.5);
    m.quaternion.setFromUnitVectors(_up, _d.divideScalar(L));
    if (yaw) { _qy.setFromAxisAngle(_up, yaw); m.quaternion.multiply(_qy); }
    const u = m.userData; m.scale.set(u.R * u.sx, L, u.R * u.sz);
  }

  /* opts: glasses, moustache, female, hair ('short' | 'bun' | 'ponytail' | 'long'), hat ('straw' | 'conical' | 'cap' | 'scarf'),
           neck (checked pha-khao-ma scarf), apron, basket, earrings.  Extra materials (hat, accent, check, blush, lip, gold) are optional. */
  const _bx = new THREE.Vector3(), _by = new THREE.Vector3(), _bz = new THREE.Vector3(), _m4 = new THREE.Matrix4(), _qb = new THREE.Quaternion(), _qx = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2);
  function makeFigure(M, opts = {}) {
    const glasses = opts.glasses !== false, stache = opts.moustache !== false, fem = !!opts.female;
    const hatM = M.hat || M.hair, accM = M.accent || M.shirt;
    const g = new THREE.Group(), B = {}, S = {};
    const bone = (n, mat, rt, rb, R, sx = 1, sz = 1) => {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, 1, 14), mat); m.userData = { R, sx, sz }; g.add(m); B[n] = m;
    };
    const ball = (n, mat, r, sx = 1, sy = 1, sz = 1) => {
      const m = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), mat); m.scale.set(r * sx, r * sy, r * sz); g.add(m); S[n] = m;
    };
    bone('chest', M.shirt, 1, .82, .17, fem ? 1.0 : 1.12, .72);
    bone('neckB', M.skin, 1, 1, .045);
    ['L', 'R'].forEach(s => {
      bone('thigh' + s, M.pants, .82, 1, .078); bone('shin' + s, M.pants, .78, 1, .058);
      bone('uarm' + s, M.shirt, .85, 1, .052);  bone('farm' + s, M.skin, .8, 1, .042);
      ball('hip' + s, M.pants, .08); ball('knee' + s, M.pants, .062); ball('sh' + s, M.shirt, .066);
      ball('elb' + s, M.skin, .047); ball('wr' + s, M.skin, .052);
      const foot = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.06, 0.27), M.shoe); g.add(foot); S['foot' + s] = foot;
    });
    ball('pelvis', M.pants, .16, 1.05, .72, .78);

    const head = new THREE.Group(); g.add(head);
    const sk = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 16), M.skin); sk.scale.set(.105, .12, .11); head.add(sk);
    const hair = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 12, 0, Math.PI * 2, 0, Math.PI * .55), M.hair);
    hair.scale.set(.113, .125, .118); hair.position.set(0, .012, -.012); hair.rotation.x = -.25; head.add(hair);
    const add = (geo, mat, x, y, z, sc) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); if (sc) m.scale.set(sc[0], sc[1], sc[2]); head.add(m); return m; };
    const sph = new THREE.SphereGeometry(1, 10, 8);
    [-1, 1].forEach(s => {
      add(sph, M.skin, s * .108, 0, 0, [.022, .03, .02]);                                          // ears
      add(sph, M.dark, s * .04, .02, .1, [.013, .013, .013]);                                      // eyes
      if (glasses) add(new THREE.TorusGeometry(.028, .004, 8, 16), M.dark, s * .04, .02, .105);    // glasses
    });
    if (glasses) add(new THREE.BoxGeometry(.03, .004, .004), M.dark, 0, .025, .11);                // glasses bridge
    add(sph, M.skin, 0, -.01, .112, [.018, .018, .018]);                                           // nose
    if (stache) add(sph, M.hair, 0, -.04, .104, [.05, .013, .02]);                                 // moustache
    const sm = add(new THREE.TorusGeometry(.03, fem ? .006 : .004, 6, 14, Math.PI), fem && M.lip ? M.lip : M.dark, 0, -.05, .1); sm.rotation.z = Math.PI; // smile

    /* ---- hair styles ---- */
    if (opts.hair === 'bun') add(sph, M.hair, 0, .075, -.1, [.055, .055, .055]);
    if (opts.hair === 'ponytail') { add(sph, M.hair, 0, .03, -.115, [.032, .032, .032]); const p = add(sph, M.hair, 0, -.04, -.135, [.034, .09, .034]); p.rotation.x = .35; }
    if (opts.hair === 'long') add(sph, M.hair, 0, -.05, -.055, [.112, .13, .075]);
    /* ---- face details ---- */
    if (fem) [-1, 1].forEach(s => {
      const l = add(new THREE.BoxGeometry(.026, .005, .004), M.dark, s * .042, .036, .104); l.rotation.z = s * -.25;   // lashes
      if (M.blush) add(sph, M.blush, s * .064, -.022, .084, [.02, .013, .008]);                                      // rosy cheeks
    });
    if (opts.earrings && M.gold) [-1, 1].forEach(s => add(sph, M.gold, s * .11, -.035, .005, [.011, .011, .011]));
    /* ---- hats ---- */
    if (opts.hat === 'straw') {
      add(new THREE.CylinderGeometry(.075, .085, .07, 20), hatM, 0, .115, 0);
      add(new THREE.CylinderGeometry(.19, .19, .012, 28), hatM, 0, .085, 0);
      const band = add(new THREE.TorusGeometry(.082, .009, 6, 24), accM, 0, .095, 0); band.rotation.x = Math.PI / 2;
    } else if (opts.hat === 'conical') {                     // Thai "ngob" farmer's hat
      add(new THREE.ConeGeometry(.26, .13, 28), hatM, 0, .165, 0);
      add(new THREE.CylinderGeometry(.085, .095, .04, 18), M.dark, 0, .095, 0);
      const r1 = add(new THREE.TorusGeometry(.18, .005, 5, 28), accM, 0, .132, 0); r1.rotation.x = Math.PI / 2;
    } else if (opts.hat === 'cap') {
      add(new THREE.SphereGeometry(1, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2), hatM, 0, .028, 0, [.116, .11, .121]);
      const v = add(new THREE.CylinderGeometry(.1, .1, .008, 20, 1, false, -Math.PI / 2, Math.PI), hatM, 0, .03, .07); v.rotation.x = .15;
      add(sph, accM, 0, .138, 0, [.014, .01, .014]);
    } else if (opts.hat === 'scarf') {
      const d = add(new THREE.SphereGeometry(1, 20, 12, 0, Math.PI * 2, 0, Math.PI * .6), hatM, 0, .012, -.01, [.121, .133, .126]); d.rotation.x = -.3;
      add(sph, hatM, 0, -.03, -.122, [.032, .028, .022]);
      [-1, 1].forEach(s => { const t = add(new THREE.BoxGeometry(.026, .075, .008), hatM, s * .022, -.08, -.12); t.rotation.z = s * .3; });
    }
    /* ---- body accessories (placed every frame in apply) ---- */
    const extras = [];
    const extra = (geo, mat, place) => { const m = new THREE.Mesh(geo, mat); g.add(m); extras.push([m, place]); return m; };
    if (opts.neck) {
      const nm = M.check || accM;
      extra(new THREE.TorusGeometry(.072, .028, 8, 20), nm, (m, J, Y, Z) => { m.position.copy(J.neck).addScaledVector(Y, -.015); m.quaternion.copy(_qb).multiply(_qx); });
      extra(new THREE.SphereGeometry(.03, 10, 8), nm, (m, J, Y, Z) => { m.position.copy(J.neck).addScaledVector(Z, .075).addScaledVector(Y, -.035); });
      extra(new THREE.BoxGeometry(.05, .12, .015), nm, (m, J, Y, Z) => { m.position.copy(J.neck).addScaledVector(Z, .085).addScaledVector(Y, -.1); m.quaternion.copy(_qb); });
    }
    if (opts.apron) {
      extra(new THREE.BoxGeometry(.27, .38, .012), accM, (m, J, Y, Z) => { m.position.lerpVectors(J.pelvis, J.neck, .3).addScaledVector(Z, .122); m.quaternion.copy(_qb); });
      extra(new THREE.BoxGeometry(.12, .07, .014), M.shirt, (m, J, Y, Z) => { m.position.lerpVectors(J.pelvis, J.neck, .22).addScaledVector(Z, .13); m.quaternion.copy(_qb); });   // pocket
    }
    if (opts.basket) {
      const wick = M.basket || accM;
      extra(new THREE.CylinderGeometry(.12, .09, .22, 14), wick, (m, J, Y, Z) => { m.position.lerpVectors(J.pelvis, J.neck, .62).addScaledVector(Z, -.2); m.quaternion.copy(_qb); });
      extra(new THREE.TorusGeometry(.12, .014, 6, 18), M.dark, (m, J, Y, Z) => { m.position.lerpVectors(J.pelvis, J.neck, .62).addScaledVector(Z, -.2).addScaledVector(Y, .11); m.quaternion.copy(_qb).multiply(_qx); });
    }

    return {
      g, head, M,
      apply(J) {
        setBone(B.chest, J.pelvis, J.neck, J.tw);
        const tdir = J.neck.clone().sub(J.pelvis).normalize();
        if (extras.length) {                                  // torso frame for the accessories
          _by.copy(tdir); _bx.subVectors(J.shL, J.shR); _bx.addScaledVector(_by, -_bx.dot(_by)).normalize();
          _bz.crossVectors(_bx, _by); _m4.makeBasis(_bx, _by, _bz); _qb.setFromRotationMatrix(_m4);
          extras.forEach(([m, place]) => place(m, J, _by, _bz));
        }
        const hd = tdir.clone().add(_up).normalize();
        const headPos = J.neck.clone().addScaledVector(hd, .17);
        setBone(B.neckB, J.neck.clone().addScaledVector(tdir, -.03), headPos);
        head.position.copy(headPos); head.rotation.set(0, J.tw * .6, 0);
        S.pelvis.position.copy(J.pelvis);
        ['L', 'R'].forEach(s => {
          setBone(B['thigh' + s], J['hip' + s], J['knee' + s]); setBone(B['shin' + s], J['knee' + s], J['ankle' + s]);
          setBone(B['uarm' + s], J['sh' + s], J['elb' + s]);    setBone(B['farm' + s], J['elb' + s], J['wr' + s]);
          S['hip' + s].position.copy(J['hip' + s]); S['knee' + s].position.copy(J['knee' + s]);
          S['sh' + s].position.copy(J['sh' + s]);   S['elb' + s].position.copy(J['elb' + s]); S['wr' + s].position.copy(J['wr' + s]);
          S['foot' + s].position.set(J['ankle' + s].x, J['ankle' + s].y - .035, J['ankle' + s].z + .07);
        });
      }
    };
  }

  function buildChair() {
    const chair = new THREE.Group();
    const wood = new THREE.MeshStandardMaterial({ color: 0x8b5e34, roughness: .8 });
    const box = (w, h, d, x, y, z) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), wood); m.position.set(x, y, z); chair.add(m); };
    box(0.5, 0.04, 0.5, 0, 0.415, -0.42);                                  // seat
    box(0.5, 0.62, 0.04, 0, 0.72, -0.66);                                  // back
    [[-.22, -.2], [.22, -.2], [-.22, -.64], [.22, -.64]].forEach(p => box(0.04, 0.4, 0.04, p[0], 0.2, p[1]));
    return chair;
  }

  /* pose parameters (degrees) → joint positions */
  /* bL/bR = extra elbow bend of each forearm (deg, toward overhead), fL/fR = extra forward tilt of each forearm */
  const DEF = { thigh: 2, knee: 178, lean: 3, armL: 10, armR: 10, fz: 0.1, dA2: 0, fz2: 0.25, twist: 0, bL: 0, bR: 0, fL: 0, fR: 0 };
  function computeJoints(P) {
    const Ls = .44, Lt = .45, Lb = .55, Lu = .28, Lf = .26, AY = .08, HW = .1, SW = .2;
    const th = rad(P.thigh), shank = th - rad(180 - P.knee), ln = rad(P.lean), tw = rad(P.twist);
    const kY = AY + Math.cos(shank) * Ls, kZ = -Math.sin(shank) * Ls;
    const hY = kY + Math.cos(th) * Lt,    hZ = kZ - Math.sin(th) * Lt;
    const J = { tw };
    J.pelvis = V3(0, hY, hZ);
    J.hipL = V3(HW, hY, hZ);       J.hipR = V3(-HW, hY, hZ);
    J.kneeL = V3(HW + .015, kY, kZ); J.kneeR = V3(-HW - .015, kY, kZ);
    J.ankleL = V3(HW + .03, AY, 0);  J.ankleR = V3(-HW - .03, AY, 0);
    const td = V3(0, Math.cos(ln), Math.sin(ln));
    J.neck = J.pelvis.clone().addScaledVector(td, Lb);
    const sc = J.neck.clone().addScaledVector(td, -.06);
    J.shL = sc.clone().add(V3(SW * Math.cos(tw), 0, -SW * Math.sin(tw)));
    J.shR = sc.clone().add(V3(-SW * Math.cos(tw), 0, SW * Math.sin(tw)));
    const arm = (s, A) => {
      const a = rad(A), a2 = rad(A + P.dA2 + (s > 0 ? P.bL : P.bR));       // the forearm bends at the elbow
      const u = V3(s * Math.sin(a), -Math.cos(a), P.fz).normalize().applyAxisAngle(_up, tw);
      const f = V3(s * Math.sin(a2), -Math.cos(a2), P.fz2 + (s > 0 ? P.fL : P.fR)).normalize().applyAxisAngle(_up, tw);
      const root = s > 0 ? J.shL : J.shR, e = root.clone().addScaledVector(u, Lu), w = e.clone().addScaledVector(f, Lf);
      return [e, w];
    };
    const l = arm(1, P.armL), r = arm(-1, P.armR);
    J.elbL = l[0]; J.wrL = l[1]; J.elbR = r[0]; J.wrR = r[1];
    return J;
  }

  /* demo poses (Grandpa coach), the green target ghost, and live "copy the player" poses */
  function coachParams(mode, t) {
    if (mode === 'potato') {
      const k = pulse(t, 5.5);
      return { P: { ...DEF, thigh: lerp(88, 2, k), knee: lerp(90, 178, k), lean: Math.sin(k * Math.PI) * 24 + 4, armL: 12, armR: 12, fz: .55 + .3 * Math.sin(k * Math.PI), dA2: -6, fz2: 1.1 },
               hit: k > 0.9, phase: k < 0.12 ? 0 : (k < 0.9 ? 1 : 2) };
    }
    if (mode === 'fruit') {
      const k = pulse(t, 5.5), a = lerp(8, 172, k), b = 34 * Math.sin(Math.PI * k) + 6 * (1 - k);   // elbows soft on the way up, straight at the top
      return { P: { ...DEF, armL: a, armR: a, fz: 0.05, dA2: 0, fz2: 0.1, bL: b, bR: b, fL: 0.25 * (1 - k), fR: 0.25 * (1 - k) }, hit: a > CFG.ARM_UP, phase: a < 30 ? 0 : (a < 150 ? 1 : 2) };
    }
    const tw = 36 * Math.sin(2 * Math.PI * t / 5);
    return { P: { ...DEF, armL: 30, armR: 30, fz: .35, dA2: -60, fz2: 1, twist: tw }, hit: Math.abs(tw) > CFG.TWIST_TARGET, phase: Math.abs(tw) < 10 ? 0 : (tw > 0 ? 1 : 2) };
  }
  let ghostTwist = 24;
  function ghostParams(mode, t) {
    if (mode === 'potato') return { ...DEF, thigh: 3, knee: 176, lean: 4, armL: 12, armR: 12, fz: .5, dA2: -6, fz2: 1.1 };
    if (mode === 'fruit')  return { ...DEF, armL: 172, armR: 172, fz: 0, dA2: 0, fz2: 0 };
    const target = Math.sin(2 * Math.PI * t / 5) > 0 ? 26 : -26; ghostTwist = lerp(ghostTwist, target, 0.08);
    return { ...DEF, armL: 30, armR: 30, fz: .35, dA2: -60, fz2: 1, twist: ghostTwist };
  }
  function liveParams(mode) {
    if (mode === 'potato') return { ...DEF, thigh: live.thigh ?? 2, knee: live.knee ?? 178, lean: clamp(live.lean ?? 3, 0, 60), armL: 12, armR: 12, fz: .5, dA2: -6, fz2: 1.1 };
    if (mode === 'fruit') {                     // mirror: your right arm drives the avatar arm on the screen-right side
      const AL = live.armR ?? 10, AR = live.armL ?? 10;
      const [bL, fL] = elbowBend(live.elbR, AL), [bR, fR] = elbowBend(live.elbL, AR);
      return { ...DEF, armL: AL, armR: AR, fz: 0.05, dA2: 0, fz2: 0.1, bL, bR, fL, fR };
    }
    return { ...DEF, armL: 30, armR: 30, fz: .35, dA2: -60, fz2: 1, twist: clamp((live.twist ?? 0) * CFG.TWIST_SCREEN_SIGN, -50, 50) };
  }
  /* your elbow angle (180 = straight) → how the avatar's forearm bends:
     with the arm raised the bend lifts the forearm toward overhead; with the arm low it tips the forearm forward */
  function elbowBend(e, A) {
    const b = clamp(180 - (e ?? 172), 0, 110), w = clamp01((A - 35) / 60);
    return [b * w, (b / 90) * (1 - w) * 1.2];
  }
  function idleParams(mode) {                    // avatar's pose before a body is detected
    if (mode === 'potato') return { ...DEF, thigh: 88, knee: 90, lean: 6, armL: 12, armR: 12, fz: .55, dA2: -6, fz2: 1.1 };
    if (mode === 'sort')   return { ...DEF, armL: 30, armR: 30, fz: .35, dA2: -60, fz2: 1, twist: 0 };
    return { ...DEF, bL: 8, bR: 8, fL: 0.2, fR: 0.2 };
  }
  /* ==========================================================
     FULL-BODY POSE for the player avatar
     A pose = torso direction + twist + one direction per limb segment (in the avatar's own frame, already mirrored).
     Live poses come from MediaPipe's 3D world landmarks, so every part of the body is copied – legs, arms,
     elbows, lean, side-bend, one-leg lifts – in every game, whichever way you face the camera.
     ========================================================== */
  const SEGS = ['T', 'uL', 'fL', 'uR', 'fR', 'tL', 'sL', 'tR', 'sR'];      // torso, upper/fore arm, thigh/shin
  function newPose() { const p = { tw: 0 }; SEGS.forEach(k => { p[k] = new THREE.Vector3(0, -1, 0); }); p.T.set(0, 1, 0); return p; }
  function jointsToPose(J, o) {
    const d = (k, a, b) => o[k].subVectors(b, a).normalize();
    o.tw = J.tw; d('T', J.pelvis, J.neck);
    d('uL', J.shL, J.elbL); d('fL', J.elbL, J.wrL); d('uR', J.shR, J.elbR); d('fR', J.elbR, J.wrR);
    d('tL', J.hipL, J.kneeL); d('sL', J.kneeL, J.ankleL); d('tR', J.hipR, J.kneeR); d('sR', J.kneeR, J.ankleR);
    return o;
  }
  function blendPose(a, b, k) { a.tw = lerp(a.tw, b.tw, k); SEGS.forEach(n => { a[n].lerp(b[n], k); if (a[n].lengthSq() < 1e-6) a[n].copy(b[n]); a[n].normalize(); }); }
  /* pose → joint positions. The legs hang from the pelvis, then the whole body is moved so the lower foot
     stands on the ground where the feet normally are (sitting pushes the hips back onto the chair). */
  function poseToJoints(p) {
    const Ls = .44, Lt = .45, Lb = .55, Lu = .28, Lf = .26, AY = .08, HW = .1, SW = .2, FX = HW + .03;
    const J = { tw: p.tw };
    J.hipL = V3(HW, 0, 0); J.hipR = V3(-HW, 0, 0);
    J.kneeL = J.hipL.clone().addScaledVector(p.tL, Lt); J.ankleL = J.kneeL.clone().addScaledVector(p.sL, Ls);
    J.kneeR = J.hipR.clone().addScaledVector(p.tR, Lt); J.ankleR = J.kneeR.clone().addScaledVector(p.sR, Ls);
    const yL = J.ankleL.y, yR = J.ankleR.y, ym = Math.min(yL, yR);
    const wL = Math.exp(-(yL - ym) / 0.04), wR = Math.exp(-(yR - ym) / 0.04), ws = wL + wR;
    const off = V3(-(wL * (J.ankleL.x - FX) + wR * (J.ankleR.x + FX)) / ws, AY - ym, -(wL * J.ankleL.z + wR * J.ankleR.z) / ws);
    ['hipL', 'hipR', 'kneeL', 'kneeR', 'ankleL', 'ankleR'].forEach(k => J[k].add(off));
    J.pelvis = off.clone();
    J.neck = J.pelvis.clone().addScaledVector(p.T, Lb);
    const sc = J.neck.clone().addScaledVector(p.T, -.06);
    const X = V3(Math.cos(p.tw), 0, -Math.sin(p.tw)); X.addScaledVector(p.T, -X.dot(p.T)).normalize();   // shoulder line ⟂ torso
    J.shL = sc.clone().addScaledVector(X, SW); J.shR = sc.clone().addScaledVector(X, -SW);
    J.elbL = J.shL.clone().addScaledVector(p.uL, Lu); J.wrL = J.elbL.clone().addScaledVector(p.fL, Lf);
    J.elbR = J.shR.clone().addScaledVector(p.uR, Lu); J.wrR = J.elbR.clone().addScaledVector(p.fR, Lf);
    keepHandsOut(J);
    return J;
  }
  /* no clipping: elbows and hands are pushed out of the torso, and hands out of the thighs (e.g. hands on the lap),
     so an arm can never sink into the body whatever the camera reports */
  const _cp = new THREE.Vector3(), _cd = new THREE.Vector3(), _cm = new THREE.Vector3(), _cf = new THREE.Vector3(0, 0, 1);
  function pushOut(p, a, b, r) {                   // move p to the surface of capsule a–b (radius r); returns how far it moved
    _cd.subVectors(b, a); const L2 = _cd.lengthSq();
    const k = L2 ? clamp01(_cp.subVectors(p, a).dot(_cd) / L2) : 0;
    _cp.copy(a).addScaledVector(_cd, k); _cd.subVectors(p, _cp);
    const d = _cd.length(); if (d >= r) return 0;
    if (d < 1e-4) _cd.copy(_cf); else _cd.divideScalar(d);
    p.copy(_cp).addScaledVector(_cd, r); return r - d;
  }
  function keepHandsOut(J) {
    const TR = 0.165, LR = 0.095;
    ['L', 'R'].forEach(s => {
      const e = J['elb' + s], w = J['wr' + s];
      pushOut(e, J.pelvis, J.neck, TR);
      pushOut(w, J.pelvis, J.neck, TR);
      pushOut(w, J.hipL, J.kneeL, LR); pushOut(w, J.hipR, J.kneeR, LR);
      for (let i = 0; i < 2; i++) {                // the forearm itself must not cut through the chest either
        _cm.addVectors(e, w).multiplyScalar(0.5); const before = _cm.clone();
        if (!pushOut(_cm, J.pelvis, J.neck, TR)) break;
        w.addScaledVector(_cm.sub(before), 2);
      }
    });
  }
  const restPose = jointsToPose(computeJoints({ ...DEF, bL: 8, bR: 8, fL: .2, fR: .2 }), newPose());
  const _pX = new THREE.Vector3(1, 0, 0), _nX = new THREE.Vector3(), _pY = new THREE.Vector3(0, 1, 0), _pZ = new THREE.Vector3(0, 0, 1);
  const _wa = new THREE.Vector3(), _wb = new THREE.Vector3(), _hm = new THREE.Vector3(), _sm = new THREE.Vector3();
  /* MediaPipe world landmarks: metres, x = picture right, y = down, z = away from the camera → flip to y-up, z-toward-camera */
  const wp = (wl, i, out) => out.set(wl[i].x, -wl[i].y, -wl[i].z);
  /* a direction in the person's own body frame (left, up, forward) → the avatar frame, mirrored like a looking-glass */
  const toAv = (d, out) => out.set(-d.dot(_pX), d.dot(_pY), d.dot(_pZ)).normalize();
  function livePose(out) {
    const tr = GW.track, lm = tr.lm, wl = tr.wl;
    if (!lm || !wl || performance.now() - tr.t > 500) return false;
    const v = i => (lm[i].visibility ?? 0) >= 0.5;
    if (!(v(11) && v(12) && v(23) && v(24))) return false;
    wp(wl, 23, _wa); wp(wl, 24, _wb); _nX.subVectors(_wa, _wb); _nX.y = 0;              // the person's left, from the hips
    if (_nX.lengthSq() < 1e-6) return false;
    _pX.lerp(_nX.normalize(), 0.25).normalize();                                        // steadied: side-on hips are noisy in depth
    _pZ.crossVectors(_pX, _pY);                                                         // the way the person faces
    _hm.addVectors(_wa, _wb).multiplyScalar(.5);
    _sm.addVectors(wp(wl, 11, _wa), wp(wl, 12, _wb)).multiplyScalar(.5);
    toAv(_sm.sub(_hm), out.T);
    const seg = (i, j, o) => toAv(wp(wl, j, _wb).sub(wp(wl, i, _wa)), o);
    const armOk = {}, legOk = {};
    /* mirror: the avatar's left side (screen-right) copies the person's RIGHT side */
    [['L', 12, 14, 16, 24, 26, 28], ['R', 11, 13, 15, 23, 25, 27]].forEach(([s, sh, el, wr, hp, kn, an]) => {
      if ((armOk[s] = v(sh) && v(el) && v(wr))) { seg(sh, el, out['u' + s]); seg(el, wr, out['f' + s]); }
      if ((legOk[s] = v(hp) && v(kn) && v(an))) { seg(hp, kn, out['t' + s]); seg(kn, an, out['s' + s]); }
    });
    const fill = (ok, keys) => ['L', 'R'].forEach(s => {                                 // a hidden limb copies the other side, else rests
      if (ok[s]) return; const o = s === 'L' ? 'R' : 'L';
      keys.forEach(k => { if (ok[o]) { out[k + s].copy(out[k + o]); out[k + s].x *= -1; } else out[k + s].copy(restPose[k + s]); });
    });
    fill(armOk, ['u', 'f']); fill(legOk, ['t', 's']);
    out.tw = rad(clamp((live.twist ?? 0) * CFG.TWIST_SCREEN_SIGN, -50, 50));
    return true;
  }

  function livePhase(mode) {
    if (mode === 'potato') return live.hip < CFG.SEATED_HIP ? 0 : (game.targetReached ? 2 : 1);
    if (mode === 'fruit') { const mn = Math.min(live.armL ?? 0, live.armR ?? 0); return mn < CFG.ARM_DOWN ? 0 : (mn >= CFG.ARM_UP ? 2 : 1); }
    const tw = live.twist ?? 0; return Math.abs(tw) < 10 ? 0 : (tw > 0 ? 1 : 2);
  }
  const PHASES = {
    potato: ['① Sit tall', '② Lean & push', '③ Stand tall ✔'],
    fruit:  ['① Arms down', '② Lift up', '③ Reach high ✔'],
    sort:   ['① Face front', '② Twist to one side', '③ Twist to the other ✔']
  };
  const SHORT = {
    potato: ['Sit tall', 'Lean & push', 'Stand tall ✔'],
    fruit:  ['Arms down', 'Lift up', 'Reach high ✔'],
    sort:   ['Face front', 'Twist one side', 'Twist other ✔']
  };
  const CAPTION = {
    get potato() { return 'Correct pose: hips open past ' + Math.round(CFG.HIP_TARGET) + '° and thighs upright (under ' + Math.round(CFG.THIGH_TARGET) + '°).'; },
    get fruit()  { return 'Correct pose: both arms above ' + Math.round(CFG.ARM_UP) + '° – reach high!'; },
    get sort()   { return 'Correct pose: twist ' + Math.round(CFG.TWIST_TARGET) + '° or more to each side.'; }
  };
  let chipKey = '';
  function setChips(mode, idx, hit) {
    const key = mode + idx + hit; if (key === chipKey) return; chipKey = key;
    const mc = $('miniCap'); if (mc) mc.textContent = SHORT[mode][idx];
    const dots = $('miniDots'); if (dots) for (let i = 0; i < dots.children.length; i++) dots.children[i].classList.toggle('on', i <= idx);
    const ds = $('demoSteps'); if (ds) for (let i = 0; i < ds.children.length; i++) ds.children[i].classList.toggle('on', i === idx);
    $('chips').innerHTML = PHASES[mode].map((p, i) => '<span class="chip' + (i === idx ? (hit && i === 2 ? ' hit' : ' on') : '') + '">' + p + '</span>').join('');
  }

  /* ==========================================================
     B) Y BOT RIG DRIVER
     Mixamo Y Bot (T-pose, +Z forward, Y up, left = +X). Every frame each bone is turned so that it
     points at the joint positions produced by computeJoints() – the same pose data that drives the
     primitive figures. Animations stored in the file are NOT played.
     ========================================================== */
  function makeYBotRig(model, toWorld) {
    const bones = {};
    model.traverse(o => {      // names look like "mixamorigHips_01": drop the prefix and the numeric suffix
      if (o.isBone) bones[o.name.replace(/^mixamorig:?/, '').replace(/_\d+$/, '')] = o;
    });
    const CHILD = {
      Hips: 'Spine', Spine: 'Spine1', Spine1: 'Spine2', Spine2: 'Neck', Neck: 'Head', Head: 'HeadTop_End',
      LeftShoulder: 'LeftArm', LeftArm: 'LeftForeArm', LeftForeArm: 'LeftHand', LeftHand: 'LeftHandMiddle1',
      LeftUpLeg: 'LeftLeg', LeftLeg: 'LeftFoot', LeftFoot: 'LeftToeBase',
      RightShoulder: 'RightArm', RightArm: 'RightForeArm', RightForeArm: 'RightHand', RightHand: 'RightHandMiddle1',
      RightUpLeg: 'RightLeg', RightLeg: 'RightFoot', RightFoot: 'RightToeBase'
    };
    const missing = Object.keys(CHILD).concat(Object.values(CHILD)).filter(k => !bones[k]);
    if (missing.length) throw new Error('model is missing bones: ' + Array.from(new Set(missing)).join(', '));

    const restQ = {}, restDir = {};
    for (const k in CHILD) { restQ[k] = bones[k].quaternion.clone(); restDir[k] = bones[CHILD[k]].position.clone().normalize(); }

    model.updateMatrixWorld(true);
    const footRest = {}, a = new THREE.Vector3(), b = new THREE.Vector3();
    ['Left', 'Right'].forEach(s => {          // keeps the feet flat on the ground
      footRest[s] = b.setFromMatrixPosition(bones[s + 'ToeBase'].matrixWorld).sub(a.setFromMatrixPosition(bones[s + 'Foot'].matrixWorld)).clone();
    });

    const qp = new THREE.Quaternion(), qw = new THREE.Quaternion(), qd = new THREE.Quaternion(), gq = new THREE.Quaternion();
    const cur = new THREE.Vector3(), pos = new THREE.Vector3(), tgt = new THREE.Vector3();
    const P = new THREE.Vector3(), N = new THREE.Vector3(), T1 = new THREE.Vector3(), T2 = new THREE.Vector3();
    const D = new THREE.Vector3(), HD = new THREE.Vector3(), FD = new THREE.Vector3(), UP = new THREE.Vector3(0, 1, 0);

    function aimDir(key, dir) {               // turn the bone so its child direction equals dir (world space)
      const bn = bones[key];
      bn.parent.updateWorldMatrix(true, false);
      bn.parent.getWorldQuaternion(qp);
      qw.copy(qp).multiply(restQ[key]);
      cur.copy(restDir[key]).applyQuaternion(qw);
      qd.setFromUnitVectors(cur, dir);
      qw.premultiply(qd);
      bn.quaternion.copy(qp).invert().multiply(qw);
      bn.updateMatrix();
      return dir;
    }
    function aimTo(key, point) {              // aim the bone from where it is now to a world point
      const bn = bones[key];
      bn.updateWorldMatrix(true, false);
      pos.setFromMatrixPosition(bn.matrixWorld);
      tgt.copy(point).sub(pos);
      if (tgt.lengthSq() < 1e-8) return aimDir(key, UP.clone());
      return aimDir(key, tgt.normalize().clone());
    }
    function twist(key, axis, angle) {        // extra roll about a world axis
      const bn = bones[key];
      bn.parent.updateWorldMatrix(true, false);
      bn.parent.getWorldQuaternion(qp);
      qw.copy(qp).multiply(bn.quaternion);
      qd.setFromAxisAngle(axis, angle);
      qw.premultiply(qd);
      bn.quaternion.copy(qp).invert().multiply(qw);
      bn.updateMatrix();
    }

    return {
      bones,
      apply(J, host) {                        // host = the group the model lives in
        host.getWorldQuaternion(gq);
        toWorld(J.pelvis, P);                 // pelvis position
        const hips = bones.Hips; hips.parent.updateWorldMatrix(true, false);
        hips.position.copy(P); hips.parent.worldToLocal(hips.position); hips.updateMatrix();

        toWorld(J.neck, N);                   // torso: one straight line pelvis -> neck, twist shared by 3 spine bones
        D.copy(N).sub(P).normalize();
        aimDir('Hips', D.clone());
        ['Spine', 'Spine1', 'Spine2'].forEach(k => { aimDir(k, D.clone()); twist(k, D, J.tw / 3); });
        HD.copy(D).add(UP).normalize();
        aimDir('Neck', HD.clone());
        aimDir('Head', UP.clone()); twist('Head', UP, -0.4 * J.tw);

        ['L', 'R'].forEach(s => {
          const S = s === 'L' ? 'Left' : 'Right';
          aimTo(S + 'Shoulder', toWorld(J['sh' + s], T1));        // arms
          aimTo(S + 'Arm', toWorld(J['elb' + s], T1));
          FD.copy(aimTo(S + 'ForeArm', toWorld(J['wr' + s], T2)));
          aimDir(S + 'Hand', FD.clone());
          aimTo(S + 'UpLeg', toWorld(J['knee' + s], T1));         // legs
          aimTo(S + 'Leg', toWorld(J['ankle' + s], T2));
          aimDir(S + 'Foot', footRest[S].clone().applyQuaternion(gq).normalize());
        });
      }
    };
  }

  /* Y Bot arms are drawn a second time on top of the finished picture, so an arm can never
     disappear behind or inside the body: the main pass draws everything (layer 0), then the depth
     buffer is cleared and only the arms (layer 1) are drawn again. The overlay re-uses the same skeleton
     and vertex buffers; only its index list differs (triangles whose bones are all arm / forearm / hand / finger bones). */
  const armOverlays = [];
  function makeArmOverlay(model, glowList) {
    const ARM = /^(Left|Right)(Arm|ForeArm|Hand)/;
    let triangles = 0;
    model.traverse(o => {
      if (!o.isSkinnedMesh || Array.isArray(o.material)) return;
      const g = o.geometry, idx = g.index, si = g.attributes.skinIndex, sw = g.attributes.skinWeight;
      if (!idx || !si || !sw) return;
      const isArm = o.skeleton.bones.map(b => ARM.test(b.name.replace(/^mixamorig:?/, '').replace(/_\d+$/, '')));
      const vArm = new Uint8Array(si.count);
      for (let v = 0; v < si.count; v++) {                      // the bone with the biggest weight owns the vertex
        const w = [sw.getX(v), sw.getY(v), sw.getZ(v), sw.getW(v)], j = [si.getX(v), si.getY(v), si.getZ(v), si.getW(v)];
        let best = 0; for (let k = 1; k < 4; k++) if (w[k] > w[best]) best = k;
        vArm[v] = isArm[j[best]] ? 1 : 0;
      }
      const src = idx.array, keep = [];
      for (let i = 0; i < src.length; i += 3) if (vArm[src[i]] && vArm[src[i + 1]] && vArm[src[i + 2]]) keep.push(src[i], src[i + 1], src[i + 2]);
      if (!keep.length) return;
      const g2 = new THREE.BufferGeometry();
      for (const name in g.attributes) g2.setAttribute(name, g.attributes[name]);
      g2.setIndex(new THREE.BufferAttribute(new src.constructor(keep), 1));
      const mat = o.material.clone();
      const m2 = new THREE.SkinnedMesh(g2, mat);
      m2.position.copy(o.position); m2.quaternion.copy(o.quaternion); m2.scale.copy(o.scale);
      o.parent.add(m2); m2.bind(o.skeleton, o.bindMatrix);
      armOverlays.push(m2);
      m2.frustumCulled = false; m2.layers.set(1);                 // layer 1 = drawn in a second pass, on top of the finished picture
      if (mat.emissive) glowList.push(mat);
      triangles += keep.length / 3;
    });
    return triangles;
  }

  /* ==========================================================
     C) THE GARDEN (transparent canvas over a CSS sky gradient)
     ========================================================== */
  const container = $('camera-container');
  const renderer = new THREE.WebGLRenderer({ canvas: $('three-canvas'), alpha: true, antialias: true });
  renderer.setClearColor(0x000000, 0);
  const scene = new THREE.Scene();
  const camera3 = new THREE.PerspectiveCamera(40, 16 / 9, 0.1, 120);
  camera3.position.set(0, 2.2, 8.4); camera3.lookAt(0, 1.5, 0);
  scene.add(new THREE.HemisphereLight(0xffffff, 0xcfe6d8, 0.8));
  const sun = new THREE.DirectionalLight(0xffffff, 0.7); sun.position.set(4, 8, 6); scene.add(sun);
  scene.children.forEach(l => { if (l.isLight) l.layers.enable(1); });   // the arm pass needs the same lights

  /* The camera is placed so the important part of the garden always fits the screen,
     from a tall phone in portrait (narrow) to a wide desktop window. */
  const layout = { hw: 5.4, bx: 2.2, px: 1.8, bs: 1 };      // half-width shown, basket x, sweet-potato-bed x
  const TAN_HALF = Math.tan(rad(40 / 2));
  function fitCamera(aspect) {
    const hw = clamp(2.2 + (aspect - 0.5) * (5.4 - 2.2) / (1.78 - 0.5), 2.2, 5.4);
    const d = Math.max(9, hw / (TAN_HALF * aspect));
    layout.hw = hw; layout.bx = clamp(hw - 1.1, 1.3, 2.2); layout.px = clamp(hw - 1.1, 1.15, 1.8); layout.bs = clamp(hw / 3.6, 0.78, 1);
    camera3.position.set(0, 1.5 + d * 0.083, d); camera3.lookAt(0, 1.5, 0);
  }
  function resize3D() {
    const w = container.clientWidth, h = container.clientHeight; if (!w || !h) return;
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, PR_MAX));
    renderer.setSize(w, h, false);
    camera3.aspect = w / h; fitCamera(w / h);
    /* slide the picture up by half the height of the bottom controls, so the player's feet stay clear of them */
    const bottomEl = $('bottom'), shift = bottomEl ? Math.round(bottomEl.offsetHeight / 2) : 0;
    camera3.setViewOffset(w, h, 0, shift, w, h);
  }
  new ResizeObserver(resize3D).observe(container);
  if ($('bottom')) new ResizeObserver(resize3D).observe($('bottom'));      // the prompt can grow to two lines
  window.addEventListener('resize', resize3D);
  resize3D();

  const M3 = (c, o = {}) => new THREE.MeshStandardMaterial(Object.assign({ color: c, roughness: 0.7, metalness: 0.02 }, o));

  /* ---------- Floating island on a white sky ---------- */
  const AV = 1.45;                                   // player scale
  const platform = new THREE.Group(); scene.add(platform);
  {
    const grass = new THREE.Mesh(new THREE.CylinderGeometry(4.2, 4.2, 0.25, 64), M3(0x86d19a, { roughness: 1 })); grass.position.y = -0.125;
    const soil = new THREE.Mesh(new THREE.CylinderGeometry(4.2, 3.4, 0.9, 64), M3(0xe3c9a3, { roughness: 1 })); soil.position.y = -0.7;
    const path = new THREE.Mesh(new THREE.CircleGeometry(1.7, 48), M3(0xf3ead0, { roughness: 1 })); path.rotation.x = -Math.PI / 2; path.position.y = 0.004;
    const rimRing = new THREE.Mesh(new THREE.TorusGeometry(4.2, 0.08, 8, 64), M3(0x6cc08a)); rimRing.rotation.x = Math.PI / 2;
    platform.add(grass, soil, path, rimRing);
  }
  {   // soft shadow far below the island
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const x = c.getContext('2d'), g = x.createRadialGradient(64, 64, 4, 64, 64, 64);
    g.addColorStop(0, 'rgba(15,23,42,.20)'); g.addColorStop(1, 'rgba(15,23,42,0)');
    x.fillStyle = g; x.fillRect(0, 0, 128, 128);
    const sh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false }));
    sh.rotation.x = -Math.PI / 2; sh.position.y = -2.6; sh.scale.set(10, 10, 1); scene.add(sh);
  }

  const clouds = [];
  [[-7, 5.4, -10, 1.1], [4, 6.4, -13, 1.4], [9, 4.4, -9, 0.9], [-3, 7.2, -15, 1.2]].forEach(c => {
    const g = new THREE.Group(), mat = new THREE.MeshBasicMaterial({ color: 0xe6f1fb });
    [[0, 0, 0, 1], [1, -.1, 0, .8], [-1, -.1, 0, .75], [.4, .35, 0, .7]].forEach(p => {
      const s = new THREE.Mesh(new THREE.SphereGeometry(1, 14, 10), mat); s.position.set(p[0], p[1], p[2]); s.scale.set(p[3], p[3] * .75, p[3] * .8); g.add(s);
    });
    g.position.set(c[0], c[1], c[2]); g.scale.setScalar(c[3]); scene.add(g); clouds.push(g);
  });

  /* ---------- Trees, bushes, flowers ---------- */
  const trees = [];
  function makeTree(x, z, sc, shade) {
    const g = new THREE.Group();
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.22, 1.7, 8), M3(0xc9a074, { roughness: 1 })); trunk.position.y = 0.85; g.add(trunk);
    const fol = new THREE.Group(); fol.position.y = 1.6; g.add(fol);
    const lm = M3(shade, { roughness: .85 });
    [[0, .55, 0, .95], [-.6, .15, .1, .7], [.6, .2, -.1, .72]].forEach(p => {
      const s = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), lm); s.position.set(p[0], p[1], p[2]); s.scale.setScalar(p[3]); fol.add(s);
    });
    g.userData.fol = fol; g.position.set(x, 0, z); g.scale.setScalar(sc); scene.add(g); trees.push(g);
  }
  [[-3.6, -2.4, 0.8, 0x9be3ae], [-2.0, -3.6, 1.0, 0x86d89d], [-0.3, -4.1, 0.9, 0x9be3ae], [1.6, -3.7, 1.05, 0xb2ebc0], [3.3, -2.6, 0.85, 0x9be3ae], [3.9, 0.0, 0.7, 0xb2ebc0], [-3.9, 0.2, 0.7, 0xb2ebc0]]
    .forEach(a => makeTree(a[0], a[1], a[2], a[3]));
  [[-3.4, 1.4, .4], [3.3, 1.6, .45]].forEach(b => {
    const m = new THREE.Mesh(new THREE.SphereGeometry(1, 14, 10), M3(0x9be3ae, { roughness: .9 })); m.position.set(b[0], b[2] * .6, b[1]); m.scale.set(b[2], b[2] * .75, b[2]); scene.add(m);
  });
  {
    const blocked = (x, z) => [[-2.2, 0.6, 1.0], [2.2, 0.6, 1.0], [-1.8, 0.1, 1.1], [-1.75, -0.35, 0.7], [0, 0, 1.6]].some(c => Math.hypot(x - c[0], z - c[1]) < c[2]);
    let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const stemG = new THREE.CylinderGeometry(0.012, 0.015, 0.2, 5), headG = new THREE.SphereGeometry(0.06, 8, 6);
    const stemM = M3(0x2f9e4f), cols = [0xf472b6, 0xfbbf24, 0xf87171, 0xc084fc, 0xffffff].map(c => M3(c, { roughness: .6 }));
    let n = 0;
    while (n < 34) {
      const a = rnd() * Math.PI * 2, r = 1.8 + rnd() * 2.1, x = Math.cos(a) * r, z = Math.sin(a) * r;
      if (blocked(x, z)) continue;
      const st = new THREE.Mesh(stemG, stemM), fl = new THREE.Mesh(headG, cols[n % cols.length]);
      st.position.set(x, 0.1, z); fl.position.set(x, 0.22, z); scene.add(st, fl); n++;
    }
  }

  /* ---------- Player avatars: four farmers (two men, two women) + the optional Y Bot model ---------- */
  const mkM = (c, r, o) => new THREE.MeshStandardMaterial(Object.assign({ color: c, roughness: r }, o || {}));
  function checkTex(hex) {                            // "pha khao ma" – the checked Thai farmer's cloth
    const c = document.createElement('canvas'); c.width = c.height = 32;
    const x = c.getContext('2d'), col = '#' + hex.toString(16).padStart(6, '0');
    x.fillStyle = '#ffffff'; x.fillRect(0, 0, 32, 32);
    x.globalAlpha = .55; x.fillStyle = col; x.fillRect(0, 0, 16, 32); x.fillRect(0, 0, 32, 16);
    x.globalAlpha = 1; x.fillRect(0, 0, 16, 16);
    const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(5, 1); t.magFilter = THREE.NearestFilter;
    return t;
  }
  const FARMERS = [
    { id: 'somchai', name: 'Somchai', who: 'Straw hat · checked scarf', female: false, hair: 'short', hat: 'straw', neck: true,
      c: { skin: 0xe0ac7e, shirt: 0x22a35a, pants: 0x1e3a8a, hair: 0x2a211c, shoe: 0x6b3a1a, hat: 0xe8c36a, accent: 0xd94141 } },
    { id: 'malee', name: 'Malee', who: 'Farmer’s hat · apron', female: true, hair: 'ponytail', hat: 'conical', apron: true, earrings: true,
      c: { skin: 0xf1c27d, shirt: 0xf97316, pants: 0x3b2f63, hair: 0x1f1a17, shoe: 0x7c2d12, hat: 0xead39a, accent: 0x3b82f6 } },
    { id: 'boon', name: 'Uncle Boon', who: 'Cap · glasses · basket', female: false, hair: 'short', hat: 'cap', glasses: true, moustache: true, basket: true,
      c: { skin: 0xc68642, shirt: 0x4f7fc9, pants: 0x57534e, hair: 0xd6d3d1, shoe: 0x44403c, hat: 0x15803d, accent: 0xfacc15, basket: 0xc8964f } },
    { id: 'kaew', name: 'Auntie Kaew', who: 'Headscarf · glasses · scarf', female: true, hair: 'bun', hat: 'scarf', glasses: true, earrings: true, neck: true,
      c: { skin: 0xd9a066, shirt: 0xa855f7, pants: 0x1f2937, hair: 0xa8a29e, shoe: 0x7c2d12, hat: 0xef4444, accent: 0x0ea5a4 } }
  ];
  GW.AVATARS = FARMERS.map(f => ({ id: f.id, name: f.name, who: f.who, female: f.female })).concat([{ id: 'ybot', name: 'Y Bot', who: '3D model (needs ' + MODEL_URL + ')', female: false }]);
  function buildFarmer(f) {
    const c = f.c, M = {
      skin: mkM(c.skin, .7), shirt: mkM(c.shirt, .65), pants: mkM(c.pants, .8), hair: mkM(c.hair, .9), shoe: mkM(c.shoe, .6),
      dark: mkM(0x1e293b, .5), hat: mkM(c.hat, .85), accent: mkM(c.accent, .6), blush: mkM(0xf28b9a, .8), lip: mkM(0xc2415b, .5),
      gold: mkM(0xffc83d, .3, { metalness: .5 }), basket: mkM(c.basket || 0xc8964f, .95)
    };
    if (f.neck) M.check = new THREE.MeshStandardMaterial({ map: checkTex(c.accent), roughness: .9 });
    return makeFigure(M, { glasses: !!f.glasses, moustache: !!f.moustache, female: f.female, hair: f.hair, hat: f.hat,
                           neck: f.neck, apron: f.apron, basket: f.basket, earrings: f.earrings });
  }

  const avRig = new THREE.Group(), avYaw = new THREE.Group(), avBody = new THREE.Group();
  avRig.scale.setScalar(AV); scene.add(avRig); avRig.add(avYaw);
  const farmers = {};
  FARMERS.forEach(f => { const fig = buildFarmer(f); fig.g.visible = false; avBody.add(fig.g); farmers[f.id] = fig; });
  let curAv = FARMERS[0].id;
  const ybot = { state: 'none', rig: null, model: null };          // state: none | loading | ready | failed
  const usingYBot = () => curAv === 'ybot' && ybot.state === 'ready';
  const curFig = () => farmers[curAv] || farmers[FARMERS[0].id];
  const avatar = {
    g: avBody,
    apply(J) { if (usingYBot()) ybot.rig.apply(J, avBody); else curFig().apply(J); }
  };
  const bodyMats = [];                                // Y Bot materials that glow when the target pose is reached
  function refreshAvatar() {
    const yb = usingYBot();
    for (const id in farmers) farmers[id].g.visible = !yb && farmers[id] === curFig();
    if (ybot.model) ybot.model.visible = yb;
  }
  function loadYBot() {
    if (ybot.state !== 'none') { refreshAvatar(); return; }
    const fail = why => {
      ybot.state = 'failed';
      console.warn('[Garden of Wellbeing] Y Bot not used – ' + why + '.');
      GW.setBanner('Could not load ' + MODEL_URL + ' – showing a farmer instead', 'warn');
      if (curAv === 'ybot' && GW.setAvatar) GW.setAvatar(FARMERS[0].id);
    };
    if (location.protocol === 'file:') return fail('running directly from file:// (models need a local server)');
    if (!THREE.GLTFLoader) return fail('GLTFLoader script is missing from index.html');
    ybot.state = 'loading';
    new THREE.GLTFLoader().load(MODEL_URL, gltf => {
      try {
        const model = gltf.scene;                     // gltf.animations (a one-frame T-pose) is deliberately not played
        model.traverse(o => {
          if (!o.isMesh) return;
          o.frustumCulled = false;                    // skinned meshes move far from their bind-pose bounds
          (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => {
            if (m.metalness > 0.5) m.metalness = 0.15;  // the file's body material is fully metallic and renders black without an environment map
            if (m.emissive) bodyMats.push(m);
          });
        });
        makeArmOverlay(model, bodyMats);
        ybot.rig = makeYBotRig(model, (v, out) => { out.copy(v); out.y += FOOT_LIFT; return avBody.localToWorld(out); });
        ybot.model = model; avBody.add(model); ybot.state = 'ready'; refreshAvatar();
      } catch (e) { fail(e.message); }
    }, undefined, () => fail('could not load "' + MODEL_URL + '"'));
  }
  function setAvatar(id) {
    curAv = id === 'ybot' || farmers[id] ? id : FARMERS[0].id;
    if (curAv === 'ybot') loadYBot();
    refreshAvatar();
  }
  setAvatar(curAv);

  /* little portraits of each farmer for the picker (rendered once, then the renderer is thrown away) */
  function avatarThumbs() {
    const out = {};
    try {
      const cv = document.createElement('canvas'); cv.width = 168; cv.height = 200;
      const r = new THREE.WebGLRenderer({ canvas: cv, alpha: true, antialias: true, preserveDrawingBuffer: true });
      r.setClearColor(0x000000, 0);
      const sc = new THREE.Scene(), cam = new THREE.PerspectiveCamera(28, cv.width / cv.height, 0.1, 20);
      sc.add(new THREE.AmbientLight(0xffffff, 0.75)); const l = new THREE.DirectionalLight(0xffffff, 0.9); l.position.set(2, 4, 3); sc.add(l);
      cam.position.set(0.35, 1.42, 2.7); cam.lookAt(0, 1.3, 0);       // head-and-shoulders portrait
      const J = computeJoints({ ...DEF, armL: 18, armR: 150, bL: 8, bR: 30, fL: .2, fR: 0 });   // friendly wave
      FARMERS.forEach(f => {
        const fig = buildFarmer(f); fig.g.rotation.y = 0.15; fig.apply(J); sc.add(fig.g);
        r.render(sc, cam); out[f.id] = cv.toDataURL('image/png'); sc.remove(fig.g);
      });
      r.dispose(); if (r.forceContextLoss) r.forceContextLoss();
    } catch (e) { console.warn('avatar thumbnails failed', e); }
    return out;
  }

  const avChair = buildChair();
  const avShadow = new THREE.Mesh(new THREE.CircleGeometry(0.5, 32), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: .22, depthWrite: false }));
  avShadow.rotation.x = -Math.PI / 2; avShadow.position.y = 0.006;
  avYaw.add(avShadow, avChair, avBody);

  const avPose = jointsToPose(computeJoints(idleParams('potato')), newPose()), tgtPose = newPose();
  let avJ = poseToJoints(avPose), avYawNow = 0, avSeated = true;
  function updateAvatar() {
    const mode = game.mode;
    avYawNow = lerp(avYawNow, mode === 'potato' ? rad(-62) : 0, 0.08);
    avYaw.rotation.y = avYawNow;
    avRig.updateMatrixWorld(true);                    // the Y Bot targets are converted with this matrix
    /* whole body from the 3D landmarks; the older per-game copy is only a backup when the hips are not visible */
    if (!(live.tracking && livePose(tgtPose)))
      jointsToPose(computeJoints(live.tracking ? liveParams(mode) : idleParams(mode)), tgtPose);
    blendPose(avPose, tgtPose, 0.3);
    avJ = poseToJoints(avPose); avatar.apply(avJ);
    /* a chair appears whenever you sit down, in any game */
    if (avJ.pelvis.y < 0.62) avSeated = true; else if (avJ.pelvis.y > 0.74) avSeated = false;
    avChair.visible = mode === 'potato' || avSeated;
    const glow = game.targetReached ? 0x0f6a0f : 0x000000;
    curFig().M.shirt.emissive.setHex(glow);
    bodyMats.forEach(m => m.emissive.setHex(glow));
    avRig.updateMatrixWorld(true);                    // hands are read by the sorting mode right after this
  }

  /* ---------- Extruded gold star burst ---------- */
  function makeStarShape(outer = 1, inner = 0.45, pts = 5) {
    const s = new THREE.Shape();
    for (let i = 0; i < pts * 2; i++) {
      const r = i % 2 === 0 ? outer : inner, a = i * Math.PI / pts - Math.PI / 2;
      i ? s.lineTo(Math.cos(a) * r, Math.sin(a) * r) : s.moveTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    s.closePath(); return s;
  }
  const starGeo = new THREE.ExtrudeGeometry(makeStarShape(), { depth: 0.28, bevelEnabled: true, bevelThickness: 0.07, bevelSize: 0.06, bevelSegments: 2 });
  starGeo.center();
  const starMat = new THREE.MeshStandardMaterial({ color: 0xffd23d, metalness: 0.25, roughness: 0.35, emissive: 0xc77800, emissiveIntensity: 0.45 });
  let stars = [];
  function launchStarBurst(o, n) {
    o = o || { x: 0, y: 1.5 };
    for (let i = 0; i < (n || (IS_MOBILE ? 16 : 26)); i++) {
      const m = new THREE.Mesh(starGeo, starMat); m.renderOrder = 12;
      const s0 = 0.07 + Math.random() * 0.1;
      m.scale.setScalar(s0);
      m.position.set(o.x + (Math.random() - 0.5) * 0.4, o.y + (Math.random() - 0.5) * 0.3, 1.8);
      const a = Math.random() * Math.PI * 2, el = (Math.random() - 0.25) * Math.PI * 0.8, sp = 2 + Math.random() * 3.5;
      m.userData = {
        v: new THREE.Vector3(Math.cos(a) * Math.cos(el) * sp, Math.sin(el) * sp + 1.6, Math.sin(a) * Math.cos(el) * sp * 0.6),
        spin: new THREE.Vector3((Math.random() - 0.5) * 9, (Math.random() - 0.5) * 9, (Math.random() - 0.5) * 9),
        life: 0, max: 1.3 + Math.random() * 0.9, s0
      };
      scene.add(m); stars.push(m);
    }
  }
  function updateStars(dt) {
    stars = stars.filter(m => {
      const u = m.userData; u.life += dt; u.v.y -= 5 * dt;
      m.position.addScaledVector(u.v, dt);
      m.rotation.x += u.spin.x * dt; m.rotation.y += u.spin.y * dt; m.rotation.z += u.spin.z * dt;
      const k = u.life / u.max;
      m.scale.setScalar(u.s0 * (k < 0.7 ? 1 : Math.max(0.001, 1 - (k - 0.7) / 0.3)));
      if (u.life >= u.max) { scene.remove(m); return false; }
      return true;
    });
  }

  /* ---------- shared gameplay bits ---------- */
  const GOLD_HEX = 0xffc83d;
  const goldMat = () => new THREE.MeshStandardMaterial({ color: GOLD_HEX, metalness: 0.6, roughness: 0.28, emissive: 0x7a4a00, emissiveIntensity: 0.55 });
  const nextGolden = () => !!(GW.nextIsGolden && GW.nextIsGolden());
  const arc = (out, a, b, k, h) => out.set(lerp(a.x, b.x, k), lerp(a.y, b.y, k) + Math.sin(Math.PI * k) * h, lerp(a.z, b.z, k));
  const _sv = new THREE.Vector3(), _up3 = new THREE.Vector3(0, 1, 0);
  function stretch(m, a, b) {                       // unit-height cylinder from point a to point b
    _sv.subVectors(b, a); const L = _sv.length(); if (L < 1e-5) return;
    m.position.copy(a).add(b).multiplyScalar(0.5);
    m.quaternion.setFromUnitVectors(_up3, _sv.divideScalar(L)); m.scale.set(1, L, 1);
  }
  function leafMesh(mat, sx, sy, sz) { const l = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 8), mat); l.scale.set(sx, sy, sz); return l; }

  /* little fruit models (radius r) */
  const stemM = M3(0x6b4423), leafM = M3(0x2fae55, { roughness: .6 });
  function makeApple(r, mat) {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.SphereGeometry(r, 22, 16), mat); body.scale.set(1, 0.9, 1); g.add(body);
    const dimple = new THREE.Mesh(new THREE.SphereGeometry(r * 0.28, 10, 8), M3(0x8f1022)); dimple.position.y = r * 0.78; dimple.scale.set(1, 0.35, 1); g.add(dimple);
    const st = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.06, r * 0.08, r * 0.5, 6), stemM); st.position.y = r * 1.0; st.rotation.z = 0.25; g.add(st);
    const lf = leafMesh(leafM, r * 0.42, r * 0.08, r * 0.2); lf.position.set(r * 0.3, r * 1.05, 0); lf.rotation.z = 0.5; g.add(lf);
    g.userData.body = body; return g;
  }
  function makeOrange(r, mat) {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.SphereGeometry(r, 22, 16), mat); g.add(body);
    const cal = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.16, r * 0.2, r * 0.08, 6), M3(0x5e8a2a)); cal.position.y = r * 0.98; g.add(cal);
    const lf = leafMesh(leafM, r * 0.48, r * 0.08, r * 0.22); lf.position.set(-r * 0.3, r * 1.02, 0); lf.rotation.z = -0.45; g.add(lf);
    g.userData.body = body; return g;
  }
  const APPLE_HEX = 0xe8263f, ORANGE_HEX = 0xff9418;
  const appleMat = () => M3(APPLE_HEX, { roughness: .32, emissive: 0x5a0010, emissiveIntensity: .25 });
  const orangeMat = () => M3(ORANGE_HEX, { roughness: .75, emissive: 0x5a2a00, emissiveIntensity: .2 });

  /* wooden crate that fills up item by item */
  function makeCrate(itemGeo, itemScale) {
    const g = new THREE.Group(), items = [];
    const wood = M3(0xc08a4e, { roughness: .9 }), dark = M3(0x9a6a36, { roughness: .9 });
    const box = (w, h, d, x, y, z, m) => { const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m || wood); b.position.set(x, y, z); g.add(b); };
    box(1.9, 0.1, 1.2, 0, 0.05, 0, dark);
    [0.18, 0.46].forEach(y => { box(1.9, 0.2, 0.08, 0, y, 0.6); box(1.9, 0.2, 0.08, 0, y, -0.6); box(0.08, 0.2, 1.2, 0.95, y, 0); box(0.08, 0.2, 1.2, -0.95, y, 0); });
    [[-0.95, 0.6], [0.95, 0.6], [-0.95, -0.6], [0.95, -0.6]].forEach(p => box(0.12, 0.62, 0.12, p[0], 0.31, p[1], dark));
    for (let i = 0; i < 12; i++) {
      const layer = Math.floor(i / 8), j = i % 8, col = j % 4, row = Math.floor(j / 4);
      const m = new THREE.Mesh(itemGeo, M3(0xffffff, { roughness: .5 }));
      m.scale.set(itemScale[0], itemScale[1], itemScale[2]); m.rotation.z = (i % 3 - 1) * 0.3;
      m.position.set(-0.6 + col * 0.4 + layer * 0.2, 0.28 + layer * 0.24, -0.25 + row * 0.5);
      m.visible = false; g.add(m); items.push(m);
    }
    g.userData = { items, count: 0, bounce: 0 };
    return g;
  }
  function crateAdd(c, hex, golden) {
    const u = c.userData, it = u.items[u.count % u.items.length]; u.count++; u.bounce = 1;
    it.visible = true; it.material.color.setHex(golden ? GOLD_HEX : hex); it.material.emissive.setHex(golden ? 0x7a4a00 : 0x000000);
  }
  function crateEmpty(c) { c.userData.count = 0; c.userData.items.forEach(m => { m.visible = false; }); }

  /* soil / leaf particle bursts */
  const bits = [], bitGeo = new THREE.DodecahedronGeometry(1, 0);
  function burst(pos, hexes, n, speed) {
    for (let i = 0; i < n; i++) {
      const m = new THREE.Mesh(bitGeo, M3(hexes[i % hexes.length], { roughness: 1 }));
      const s = 0.03 + Math.random() * 0.05; m.scale.setScalar(s); m.position.copy(pos);
      const a = Math.random() * Math.PI * 2, sp = speed * (0.5 + Math.random());
      m.userData = { v: new THREE.Vector3(Math.cos(a) * sp * 0.6, speed * (1 + Math.random()), Math.sin(a) * sp * 0.6), life: 0, max: 0.8 + Math.random() * 0.4, s };
      scene.add(m); bits.push(m);
    }
  }
  function updateBits(dt) {
    for (let i = bits.length - 1; i >= 0; i--) {
      const m = bits[i], u = m.userData; u.life += dt; u.v.y -= 9 * dt; m.position.addScaledVector(u.v, dt);
      m.rotation.x += dt * 6; m.rotation.y += dt * 4;
      if (m.position.y < 0.02) { m.position.y = 0.02; u.v.set(0, 0, 0); }
      m.scale.setScalar(u.s * Math.max(0.01, 1 - Math.max(0, u.life / u.max - 0.6) / 0.4));
      if (u.life >= u.max) { scene.remove(m); m.material.dispose(); bits.splice(i, 1); }
    }
  }

  /* ============ Mode 1: Sweet Potato Pull
     The potato is planted right in front of the player (between the player and the camera).
     The player holds its leafy top: standing up pulls it out of the soil, it pops free and flies into the crate. ============ */
  const potatoRig = new THREE.Group(); avYaw.add(potatoRig);         // avatar space: +z is the way the player faces
  const POT_Z = 0.6;
  const soilM = M3(0x7a4e2a, { roughness: 1 }), soilDark = M3(0x3f2614, { roughness: 1 });
  {
    const mound = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.36, 0.1, 24), soilM); mound.position.set(0, 0.05, POT_Z);
    const hole = new THREE.Mesh(new THREE.CircleGeometry(0.12, 20), soilDark); hole.rotation.x = -Math.PI / 2; hole.position.set(0, 0.102, POT_Z);
    potatoRig.add(mound, hole);
    for (let i = 0; i < 8; i++) {
      const a = i / 8 * Math.PI * 2 + 0.4, c = new THREE.Mesh(bitGeo, soilM);
      c.scale.setScalar(0.035 + (i % 3) * 0.01); c.position.set(Math.cos(a) * 0.3, 0.05, POT_Z + Math.sin(a) * 0.3); c.rotation.set(a, a * 2, 0); potatoRig.add(c);
    }
    [[0.42, POT_Z + 0.12], [-0.4, POT_Z - 0.08], [0.1, POT_Z + 0.42]].forEach(([x, z], k) => {   // neighbouring plants still in the ground
      const bed = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.18, 0.06, 16), soilM); bed.position.set(x, 0.03, z); potatoRig.add(bed);
      for (let i = 0; i < 4; i++) { const l = leafMesh(leafM, 0.035, 0.12, 0.012); l.position.set(x, 0.14, z); l.rotation.set(0, i * 0.8 + k, (i % 2 ? 1 : -1) * 0.5); potatoRig.add(l); }
    });
  }
  const spudMat = M3(0xc0507a, { roughness: .55, emissive: 0x3b0a1e, emissiveIntensity: .35 }), spudGold = goldMat();
  const spudGeo = new THREE.SphereGeometry(0.13, 20, 14);
  const potato = new THREE.Group(); potatoRig.add(potato);
  const spud = new THREE.Mesh(spudGeo, spudMat); spud.scale.set(0.85, 1.3, 0.8); potato.add(spud);
  {
    const tail = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.12, 6), M3(0x9d3f63)); tail.rotation.x = Math.PI; tail.position.y = -0.2; potato.add(tail);
    [[0.08, 0.04, 0.07], [-0.07, -0.05, 0.08], [0.02, 0.1, -0.09]].forEach(p => { const e = new THREE.Mesh(new THREE.SphereGeometry(0.012, 6, 4), M3(0x6d2442)); e.position.set(p[0], p[1], p[2]); potato.add(e); });
  }
  const vineM = M3(0x2f9e4f), stems = [-1, 0, 1].map(() => { const m = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.018, 1, 6), vineM); potatoRig.add(m); return m; });
  const vineLeaves = [];
  for (let i = 0; i < 8; i++) { const l = leafMesh(leafM, 0.065, 0.018, 0.035); potatoRig.add(l); vineLeaves.push(l); }
  const tuft = new THREE.Group(); potatoRig.add(tuft);                 // leafy top, held in the hands
  for (let i = 0; i < 7; i++) {
    const l = leafMesh(leafM, 0.07, 0.2, 0.02), a = i / 7 * Math.PI * 2;
    l.position.set(Math.cos(a) * 0.03, 0.1, Math.sin(a) * 0.03); l.rotation.set(Math.sin(a) * 0.6, a, Math.cos(a) * 0.6); tuft.add(l);
  }
  const potCrate = makeCrate(spudGeo, [2.3, 1.5, 1.6]); potCrate.scale.setScalar(0.55); scene.add(potCrate);
  const flyer = new THREE.Mesh(spudGeo, spudMat); flyer.visible = false; scene.add(flyer);
  const pt = { st: 'idle', t: 0, rise: 0, grow: 1, golden: false, from: new THREE.Vector3(), to: new THREE.Vector3() };
  const _hand2 = new THREE.Vector3(), _top = new THREE.Vector3(), _pw = new THREE.Vector3(), _sa = new THREE.Vector3(), _sb = new THREE.Vector3();
  function updatePotato(dt, t) {
    potCrate.position.set(-Math.min(2.05, layout.hw - 0.6), 0, 0.95); potCrate.rotation.y = 0.35;
    const cu = potCrate.userData; cu.bounce = Math.max(0, cu.bounce - dt * 3);
    potCrate.scale.setScalar(0.55 * (1 + 0.12 * Math.sin(cu.bounce * Math.PI)));
    const prog = live.tracking && game.phase === 'play' ? live.prog : 0;
    pt.rise = lerp(pt.rise, prog, Math.min(1, dt * 6));
    /* hands of the avatar (same space as potatoRig) */
    _hand2.copy(avJ.wrL).add(avJ.wrR).multiplyScalar(0.5); if (usingYBot()) _hand2.y += FOOT_LIFT;
    tuft.position.copy(_hand2); tuft.rotation.z = Math.sin(t * 3) * 0.08;

    spud.material = nextGolden() ? spudGold : spudMat;
    let y;
    if (pt.st === 'regrow') {                                   // next potato settles into the soil
      pt.t += dt / 0.6; const k = Math.min(1, pt.t);
      y = lerp(-0.3, -0.07, ease(k)); potato.scale.setScalar(Math.max(0.01, ease(k)));
      if (k >= 1) pt.st = 'idle';
    } else {
      const k = ease(pt.rise);
      y = lerp(-0.07, 0.34, k);                                 // buried (only the top peeks out) → pulled up
      potato.scale.setScalar(1);
    }
    const shake = clamp01((pt.rise - 0.5) * 2.5);
    potato.position.set(Math.sin(t * 45) * 0.018 * shake, y, POT_Z + Math.sin(t * 38) * 0.012 * shake);
    potato.rotation.z = Math.sin(t * 2.2) * 0.06;
    _top.set(potato.position.x, potato.position.y + 0.17, potato.position.z);
    stems.forEach((m, i) => {                                   // a small bunch of stems from the potato to the hands
      _sa.set(_top.x + (i - 1) * 0.025, _top.y, _top.z); _sb.set(_hand2.x + (i - 1) * 0.03, _hand2.y, _hand2.z);
      stretch(m, _sa, _sb);
    });
    vineLeaves.forEach((l, i) => {
      const k = 0.15 + (i / vineLeaves.length) * 0.75, sd = i % 2 ? 1 : -1;
      l.position.lerpVectors(_top, _hand2, k); l.position.x += sd * 0.06; l.position.y += 0.01;
      l.rotation.set(0.3, i * 0.9, sd * 0.7 + Math.sin(t * 3 + i) * 0.12);
    });
    if (shake > 0.5 && Math.random() < dt * 6) { potatoRig.localToWorld(_pw.set(0, 0.1, POT_Z)); burst(_pw, [0x7a4e2a, 0x5a3a1e], 2, 1.2); }

    if (flyer.visible) {                                        // popped potato arcs into the crate
      pt.t2 += dt / 0.85; const k = Math.min(1, pt.t2);
      arc(flyer.position, pt.from, pt.to, ease(k), 1.8);
      flyer.rotation.z += dt * 10; flyer.rotation.x += dt * 6;
      flyer.scale.set(0.85 * 1.45, 1.3 * 1.45, 0.8 * 1.45).multiplyScalar(lerp(1, 0.7, k));
      if (k >= 1) { flyer.visible = false; crateAdd(potCrate, 0xc0507a, pt.golden); }
    }
  }
  function pullPotato(golden) {
    potato.getWorldPosition(pt.from);
    pt.golden = golden; flyer.material = golden ? spudGold : spudMat;
    flyer.position.copy(pt.from); flyer.rotation.set(0, 0, 0); flyer.visible = true; pt.t2 = 0;
    const u = potCrate.userData, slot = u.items[u.count % u.items.length].position;
    potCrate.localToWorld(pt.to.copy(slot)); pt.to.y += 0.15;
    potatoRig.localToWorld(_pw.set(0, 0.1, POT_Z));
    burst(_pw, [0x7a4e2a, 0x5a3a1e, 0x8b5e34], IS_MOBILE ? 10 : 18, 2.2);
    pt.st = 'regrow'; pt.t = 0; pt.rise = 0;
    return { x: pt.from.x, y: pt.from.y + 0.4 };
  }

  /* ============ Mode 2: High Fruit Picking – a proper apple tree behind the player ============ */
  const appleTree = new THREE.Group(); scene.add(appleTree);
  const TZ = -1.55;
  {
    const bark = M3(0x9b6b43, { roughness: .95 });
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.32, 2.8, 12), bark); trunk.position.set(0, 1.4, TZ); appleTree.add(trunk);
    const flare = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.52, 0.32, 12), bark); flare.position.set(0, 0.16, TZ); appleTree.add(flare);
    [[[0, 2.3, TZ], [-1.05, 3.15, TZ + 0.35], 0.09], [[0, 2.45, TZ], [1.1, 3.2, TZ + 0.3], 0.09], [[0, 2.6, TZ], [0.15, 3.7, TZ + 0.6], 0.08]].forEach(([a, b, r]) => {
      const limb = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.7, r, 1, 8), bark); stretch(limb, new THREE.Vector3(...a), new THREE.Vector3(...b)); appleTree.add(limb);
    });
    const shades = [0x5cc77a, 0x4fb86d, 0x74d48c].map(c => new THREE.MeshStandardMaterial({ color: c, roughness: .85, flatShading: true }));
    const icoG = new THREE.IcosahedronGeometry(1, 1);
    const clusters = [[0, 3.8, TZ, 1.45], [-1.25, 3.4, TZ + 0.25, 1.0], [1.25, 3.4, TZ + 0.2, 1.0], [-0.7, 4.35, TZ + 0.1, 0.95], [0.75, 4.4, TZ, 0.95],
                      [0, 3.35, TZ + 0.8, 0.8], [-1.95, 3.05, TZ + 0.1, 0.62], [1.95, 3.05, TZ + 0.1, 0.62]];
    const blossomM = [M3(0xffffff), M3(0xffd1e3)];
    clusters.forEach((c, i) => {
      const m = new THREE.Mesh(icoG, shades[i % 3]); m.position.set(c[0], c[1], c[2]); m.scale.setScalar(c[3]); m.rotation.set(i, i * 2, 0); appleTree.add(m);
      for (let k = 0; k < 4; k++) {                               // blossoms on the visible side of the canopy
        const a = (k / 4 + i * 0.13) * Math.PI * 2, el = 0.2 + (k % 2) * 0.35;
        const d = new THREE.Vector3(Math.cos(a) * Math.cos(el) * 0.8, Math.sin(el), 0.6 + Math.abs(Math.sin(a)) * 0.4).normalize();
        const b = new THREE.Mesh(new THREE.SphereGeometry(0.05, 6, 5), blossomM[k % 2]); b.position.set(c[0], c[1], c[2]).addScaledVector(d, c[3] * 0.98); appleTree.add(b);
      }
    });
    [[0.55, TZ + 0.55], [-0.65, TZ + 0.75], [0.95, TZ + 0.05]].forEach(([x, z]) => {   // windfalls under the tree
      const a = makeApple(0.14, appleMat()); a.position.set(x, 0.12, z); a.rotation.z = 1.2; appleTree.add(a);
    });
  }
  const apples = [];
  [[-1.25, 2.95, -0.2], [-0.62, 2.82, 0.15], [0, 3.0, 0.28], [0.62, 2.82, 0.15], [1.25, 2.95, -0.2]].forEach(([x, y, z]) => {
    const g = new THREE.Group(); g.position.set(x, y + 0.22, z);            // pivot where the stem meets the branch
    const twig = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.015, 0.14, 5), stemM); twig.position.y = -0.07; g.add(twig);
    const mat = appleMat(), gmat = goldMat();
    const fruit = makeApple(0.17, mat); fruit.position.y = -0.24; g.add(fruit);
    const halo = new THREE.Mesh(new THREE.RingGeometry(0.24, 0.29, 32), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }));
    halo.position.set(0, -0.24, 0.05); g.add(halo);
    appleTree.add(g);
    apples.push({ g, home: g.position.clone(), fruit, body: fruit.userData.body, mat, gmat, halo, st: 'hang', t: 0, golden: false, from: new THREE.Vector3(), to: new THREE.Vector3() });
  });
  const appleBasket = makeBasket(APPLE_HEX); scene.add(appleBasket);
  const tr = { p: 0, ai: 2 };                                // ai = the apple to pick next
  function updateTree(dt, t) {
    appleBasket.position.set(layout.bx * 0.9, 0.3, 0.9);
    appleBasket.userData.bounce = Math.max(0, appleBasket.userData.bounce - dt * 3);
    appleBasket.scale.setScalar(0.55 * layout.bs * (1 + 0.2 * Math.sin(appleBasket.userData.bounce * Math.PI)));
    tr.p = lerp(tr.p, live.tracking && game.phase === 'play' ? live.prog : 0, Math.min(1, dt * 6));
    const gold = nextGolden();
    apples.forEach((a, i) => {
      const target = i === tr.ai;
      if (a.st === 'hang') {
        a.body.material = target && gold ? a.gmat : a.mat;
        a.g.rotation.z = Math.sin(t * 1.6 + i * 1.3) * (target ? 0.08 + 0.2 * tr.p : 0.04);
        a.g.scale.setScalar(target ? (gold ? 1.75 : 1.2) + 0.25 * tr.p + 0.04 * Math.sin(t * 4) : 0.85);   // faster part: big golden apple
        a.mat.emissiveIntensity = target ? 0.4 + 0.8 * tr.p : 0.15;
        a.halo.material.opacity = target ? 0.45 + 0.2 * Math.sin(t * 4) + 0.3 * tr.p : 0;
        a.halo.material.color.setHex(gold && target ? GOLD_HEX : 0xffffff);
      } else if (a.st === 'fall') {                          // arc down into the basket
        a.t += dt / 0.95; const k = Math.min(1, a.t);
        arc(a.g.position, a.from, a.to, ease(k), 1.2);
        a.g.rotation.z += dt * 6; a.halo.material.opacity = 0;
        if (k >= 1) {
          const u = appleBasket.userData, f = u.fruits[u.count % u.fruits.length]; u.count++;
          f.visible = true; f.material.color.setHex(a.golden ? GOLD_HEX : APPLE_HEX); f.material.emissive.setHex(a.golden ? 0x7a4a00 : 0x5a0010);
          u.bounce = 1;
          a.st = 'regrow'; a.t = 0; a.g.position.copy(a.home); a.g.rotation.set(0, 0, 0); a.g.scale.setScalar(0.01); a.body.material = a.mat;
        }
      } else if (a.st === 'regrow') {
        a.t += dt; a.g.scale.setScalar(Math.max(0.01, 0.85 * ease(Math.min(1, a.t / 0.6))));
        if (a.t >= 0.6) a.st = 'hang';
      }
    });
  }
  function pickApple(golden) {
    const a = apples[tr.ai];
    a.st = 'fall'; a.t = 0; a.golden = golden; a.body.material = golden ? a.gmat : a.mat;
    a.from.copy(a.g.position);
    a.to.copy(appleBasket.position); a.to.y += 0.45 + 0.24 * a.g.scale.y;    // pivot sits above the fruit
    burst(new THREE.Vector3(a.home.x, a.home.y, a.home.z + 0.1), [0x5cc77a, 0x74d48c, 0xffffff], IS_MOBILE ? 6 : 10, 1.0);
    const o = { x: a.home.x, y: a.home.y };
    const free = apples.map((_, i) => i).filter(i => i !== tr.ai && apples[i].st === 'hang');
    tr.ai = free.length ? free[Math.floor(Math.random() * free.length)] : (tr.ai + 1) % apples.length;
    return o;
  }

  /* ============ Mode 3: Fruit Sorting – apple → LEFT basket, orange → RIGHT basket ============ */
  const sortRig = new THREE.Group(); scene.add(sortRig);
  const SIDE_COL = { L: APPLE_HEX, R: ORANGE_HEX };
  const FRUIT_S = 1.25, BASKET_S = 0.62;
  function makeBasket(color) {
    const g = new THREE.Group();
    const wall = new THREE.Mesh(new THREE.CylinderGeometry(1, 0.7, 0.9, 28, 1, true), M3(0xb7791f, { roughness: .9, side: THREE.DoubleSide }));
    g.add(wall);
    const bottom = new THREE.Mesh(new THREE.CircleGeometry(0.7, 24), M3(0x8a5a14, { side: THREE.DoubleSide })); bottom.rotation.x = -Math.PI / 2; bottom.position.y = -0.45; g.add(bottom);
    const rimM = new THREE.Mesh(new THREE.TorusGeometry(1, 0.08, 8, 32), M3(color, { emissive: color, emissiveIntensity: .3 })); rimM.rotation.x = Math.PI / 2; rimM.position.y = 0.45; g.add(rimM);
    [0.12, -0.2].forEach(y => { const b = new THREE.Mesh(new THREE.TorusGeometry(0.86 + (y < 0 ? -0.08 : 0.0), 0.03, 6, 28), M3(0x8a5a14)); b.rotation.x = Math.PI / 2; b.position.y = y; g.add(b); });
    const spots = [[-.4, .0, .1], [.4, .0, .1], [0, .0, .4], [-.2, .3, .1], [.25, .3, -.1], [0, .55, .1]];
    const fruits = spots.map(p => { const f = new THREE.Mesh(new THREE.SphereGeometry(0.3, 14, 10), M3(color, { roughness: .45, emissive: color, emissiveIntensity: .15 }));
      f.position.set(p[0], p[1], p[2]); f.visible = false; g.add(f); return f; });
    g.rotation.x = 0.35;
    const holder = new THREE.Group(); holder.add(g);
    holder.userData = { fruits, rim: rimM, count: 0, bounce: 0, color, shake: 0 };
    return holder;
  }
  function emptyBasket(b) { const u = b.userData; u.count = 0; u.bounce = 0; u.fruits.forEach(f => { f.visible = false; }); }

  /* signpost with a picture of the fruit and its name */
  function makeSign(kind) {
    const c = document.createElement('canvas'); c.width = 256; c.height = 300;
    const x = c.getContext('2d'), col = kind === 'L' ? '#e8263f' : '#ff9418';
    const rr = (X, Y, W, H, R) => { x.beginPath(); x.moveTo(X + R, Y); x.arcTo(X + W, Y, X + W, Y + H, R); x.arcTo(X + W, Y + H, X, Y + H, R); x.arcTo(X, Y + H, X, Y, R); x.arcTo(X, Y, X + W, Y, R); x.closePath(); };
    rr(8, 8, 240, 284, 36); x.fillStyle = '#fff'; x.fill(); x.lineWidth = 14; x.strokeStyle = col; x.stroke();
    x.fillStyle = col; x.beginPath(); x.arc(128, 122, 66, 0, Math.PI * 2); x.fill();                    // fruit
    x.fillStyle = 'rgba(255,255,255,.45)'; x.beginPath(); x.ellipse(104, 98, 16, 24, -0.5, 0, Math.PI * 2); x.fill();
    x.fillStyle = '#6b4423'; x.fillRect(124, 42, 8, 26);
    x.fillStyle = '#2fae55'; x.beginPath(); x.ellipse(kind === 'L' ? 152 : 104, 54, 26, 11, kind === 'L' ? -0.4 : 0.4, 0, Math.PI * 2); x.fill();
    if (kind === 'R') { x.fillStyle = 'rgba(0,0,0,.08)'; for (let i = 0; i < 26; i++) { x.beginPath(); x.arc(84 + (i * 37) % 90, 90 + (i * 53) % 80, 2.5, 0, Math.PI * 2); x.fill(); } }
    x.fillStyle = '#16213a'; x.font = '900 46px Nunito, system-ui, sans-serif'; x.textAlign = 'center';
    x.fillText(kind === 'L' ? 'APPLE' : 'ORANGE', 128, 250);
    const g = new THREE.Group();
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 1.5, 8), M3(0x9b6b43)); post.position.y = 0.75; g.add(post);
    const board = new THREE.Mesh(new THREE.PlaneGeometry(0.85, 1.0), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true }));
    board.position.y = 1.85; g.add(board);
    g.userData.board = board;
    return g;
  }
  const basketL = makeBasket(SIDE_COL.L), basketR = makeBasket(SIDE_COL.R);
  const signL = makeSign('L'), signR = makeSign('R');
  sortRig.add(basketL, basketR, signL, signR);

  /* the fruit in the player's hands: an apple or an orange */
  const heldApple = makeApple(0.17, appleMat()), heldOrange = makeOrange(0.17, orangeMat()), heldGold = goldMat();
  const sfruit = new THREE.Group(); sfruit.add(heldApple, heldOrange); sfruit.renderOrder = 12; sortRig.add(sfruit);
  heldApple.traverse(o => { o.renderOrder = 12; }); heldOrange.traverse(o => { o.renderOrder = 12; });
  const sf = { st: 'grow', t: 0, scale: 0, side: 'L', type: 'L', from: new THREE.Vector3(), golden: false, goldOn: false };
  function setHeld(type, golden) {
    sf.type = type; heldApple.visible = type === 'L'; heldOrange.visible = type === 'R';
    if (golden !== sf.goldOn) {
      sf.goldOn = golden;
      heldApple.userData.body.material = golden ? heldGold : heldApple.userData.mat || (heldApple.userData.mat = heldApple.userData.body.material);
      heldOrange.userData.body.material = golden ? heldGold : heldOrange.userData.mat || (heldOrange.userData.mat = heldOrange.userData.body.material);
    }
  }
  heldApple.userData.mat = heldApple.userData.body.material; heldOrange.userData.mat = heldOrange.userData.body.material;

  /* big floating arrow above the head, coloured like the fruit, pointing at its basket */
  const arrowShape = new THREE.Shape();
  [[-0.5, 0.14], [0.1, 0.14], [0.1, 0.34], [0.55, 0], [0.1, -0.34], [0.1, -0.14], [-0.5, -0.14]].forEach((p, i) => i ? arrowShape.lineTo(p[0], p[1]) : arrowShape.moveTo(p[0], p[1]));
  const arrowMat = new THREE.MeshStandardMaterial({ color: APPLE_HEX, roughness: .45, emissive: APPLE_HEX, emissiveIntensity: .12 });
  const cueArrow = new THREE.Mesh(new THREE.ExtrudeGeometry(arrowShape, { depth: 0.12, bevelEnabled: true, bevelThickness: 0.03, bevelSize: 0.03, bevelSegments: 2 }), arrowMat);
  cueArrow.geometry.center(); sortRig.add(cueArrow);
  /* chasing dots on the grass from the player to the right basket */
  const dots = [];
  for (let i = 0; i < 8; i++) {
    const d = new THREE.Mesh(new THREE.CircleGeometry(0.075, 16), new THREE.MeshBasicMaterial({ color: APPLE_HEX, transparent: true, opacity: 0, depthWrite: false }));
    d.rotation.x = -Math.PI / 2; d.position.y = 0.012; sortRig.add(d); dots.push(d);
  }
  /* crate of mixed fruit behind the player (where the fruit comes from) */
  const mixCrate = makeCrate(new THREE.SphereGeometry(0.17, 12, 10), [1, 1, 1]);
  mixCrate.position.set(1.05, 0, -1.15); mixCrate.rotation.y = -0.4; mixCrate.scale.setScalar(0.5); sortRig.add(mixCrate);
  for (let i = 0; i < 12; i++) crateAdd(mixCrate, i % 2 ? ORANGE_HEX : APPLE_HEX, false);

  const _hand = new THREE.Vector3();
  function handWorld(out) {                         // midpoint of both hands, slightly in front
    _hand.copy(avJ.wrL).add(avJ.wrR).multiplyScalar(0.5); _hand.y += 0.05 + (usingYBot() ? FOOT_LIFT : 0); _hand.z += 0.1;
    return avatar.g.localToWorld(out.copy(_hand));
  }
  let arrowSide = 0;
  function updateSort(dt, t) {
    const bx = layout.bx;
    basketL.position.set(-bx, 0.3, 0.6); basketR.position.set(bx, 0.3, 0.6);
    signL.position.set(-bx - 0.1, 0, 0.05); signR.position.set(bx + 0.1, 0, 0.05);
    const active = (game.phase === 'play' || game.phase === 'count') && game.step !== 'back';   // hidden while you RETURN to the middle
    const need = game.sortNeed, col = SIDE_COL[need], dir = need === 'L' ? -1 : 1;
    [['L', basketL, signL], ['R', basketR, signR]].forEach(([side, b, sg]) => {
      const u = b.userData; u.bounce = Math.max(0, u.bounce - dt * 3);
      const on = active && side === need, glow = on ? 0.6 + 0.4 * Math.sin(t * 5) : 0;
      const wrong = game.sortWrong && side !== need;
      b.scale.setScalar(BASKET_S * layout.bs * (1 + 0.2 * Math.sin(u.bounce * Math.PI) + 0.06 * glow));
      b.rotation.z = wrong ? Math.sin(t * 30) * 0.05 : 0;
      u.rim.material.emissiveIntensity = 0.25 + glow;
      sg.scale.setScalar(layout.bs * (on ? 1.08 + 0.04 * Math.sin(t * 5) : 0.92));
      sg.userData.board.material.opacity = on || !active ? 1 : 0.55;
    });
    /* arrow + dots */
    arrowSide = lerp(arrowSide, dir, Math.min(1, dt * 8));
    cueArrow.visible = active;
    if (active) {
      arrowMat.color.setHex(col); arrowMat.emissive.setHex(col);
      const pulse = game.sortWrong ? 1.25 + 0.15 * Math.sin(t * 20) : 1 + 0.06 * Math.sin(t * 6);
      cueArrow.scale.set(arrowSide * pulse * 0.75, pulse * 0.75, pulse * 0.75);
      cueArrow.position.set(dir * (0.75 + 0.12 * Math.sin(t * 5)), 2.6, 0.35);   // beside the head, on the side to twist to
    }
    dots.forEach((d, i) => {
      const k = (i + 1) / (dots.length + 1);
      d.position.x = dir * lerp(0.45, bx - 0.4, k); d.position.z = lerp(0.35, 0.65, k);
      d.material.color.setHex(col);
      d.material.opacity = active ? 0.25 + 0.6 * Math.max(0, Math.sin(t * 6 - i * 0.7)) : 0;
    });

    if (sf.st === 'grow' || sf.st === 'held') {
      setHeld(need, false);
      if (sf.st === 'grow') { sf.t += dt; sf.scale = ease(clamp01(sf.t / 0.45)); if (sf.t >= 0.45) { sf.st = 'held'; sf.scale = 1; } }
      handWorld(sfruit.position); sfruit.rotation.y = t * 1.2;
    } else if (sf.st === 'fly') {
      sf.t += dt / 0.6; const k = Math.min(1, sf.t), b = sf.side === 'L' ? basketL : basketR;
      const tx = b.position.x, ty = b.position.y + 0.5, tz = b.position.z;
      sfruit.position.set(lerp(sf.from.x, tx, ease(k)), lerp(sf.from.y, ty, ease(k)) + Math.sin(Math.PI * k) * 1.3, lerp(sf.from.z, tz, ease(k)));
      sf.scale = 1 - 0.3 * k; sfruit.rotation.y += dt * 8;
      if (k >= 1) {
        const u = b.userData, f = u.fruits[u.count % u.fruits.length]; u.count++; u.bounce = 1;
        f.visible = true; f.material.color.setHex(sf.golden ? GOLD_HEX : u.color); f.material.emissive.setHex(sf.golden ? 0x7a4a00 : u.color);
        sf.st = 'grow'; sf.t = 0; sf.scale = 0;
      }
    }
    sfruit.scale.setScalar(Math.max(0.001, FRUIT_S * sf.scale * (nextGolden() ? 1.4 : 1)));   // faster part: big fruit
  }
  function dropFruit(golden) {                      // called on a completed rep, before the next fruit is chosen
    sf.side = game.sortNeed; sf.golden = false; setHeld(sf.side, false);
    sf.st = 'fly'; sf.t = 0; sf.scale = 1; sf.from.copy(sfruit.position);
    const b = sf.side === 'L' ? basketL : basketR;
    return { x: b.position.x, y: b.position.y + 0.5 };
  }

  /* background trees carry fruit in the fruit games */
  const treeFruit = [];
  trees.forEach((tg, i) => {
    for (let k = 0; k < 6; k++) {
      const a = k / 6 * Math.PI * 2 + i, f = new THREE.Mesh(new THREE.SphereGeometry(0.13, 10, 8), M3(i % 2 ? ORANGE_HEX : APPLE_HEX, { roughness: .45 }));
      f.position.set(Math.cos(a) * 0.75, 0.25 + Math.sin(k * 1.7) * 0.35, 0.55 + Math.abs(Math.sin(a)) * 0.3);
      tg.userData.fol.add(f); treeFruit.push(f);
    }
  });

  /* ============ Your garden grows: every rep sprouts a flower on the island ============ */
  const sproutSpots = [];
  {
    const blocked = (x, z) => [[-2.2, 0.6, 0.9], [2.2, 0.6, 0.9], [-1.8, 0.1, 1.0], [-1.6, -1.1, 0.8], [1.9, 0.9, 0.7], [0, 0, 1.25]].some(c => Math.hypot(x - c[0], z - c[1]) < c[2]);
    let seed = 99; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    while (sproutSpots.length < 60) {
      const a = rnd() * Math.PI * 2, r = 1.3 + rnd() * 2.6, x = Math.cos(a) * r, z = Math.sin(a) * r * 0.9 + 0.3;
      if (Math.hypot(x, z) < 3.9 && !blocked(x, z)) sproutSpots.push([x, z, rnd()]);
    }
  }
  const PETALS = [0xf472b6, 0xfbbf24, 0xf87171, 0xc084fc, 0x60a5fa, 0xffffff];
  const sStemG = new THREE.CylinderGeometry(0.014, 0.018, 0.34, 5), sHeadG = new THREE.SphereGeometry(0.075, 10, 8), sPetalG = new THREE.SphereGeometry(0.06, 8, 6);
  const sStemM = M3(0x2f9e4f), sCenterM = M3(0x7c4a12);
  let sprouts = [], sproutN = 0;
  function sprout(golden) {
    const spot = sproutSpots[sproutN % sproutSpots.length]; sproutN++;
    const old = sprouts.find(s => s.spot === spot); if (old) { scene.remove(old.g); sprouts = sprouts.filter(s => s !== old); }
    const g = new THREE.Group(), col = golden ? 0xffc21a : PETALS[Math.floor(spot[2] * PETALS.length)];
    const st = new THREE.Mesh(sStemG, sStemM); st.position.y = 0.17; g.add(st);
    const head = new THREE.Group(); head.position.y = 0.36; g.add(head);
    head.add(new THREE.Mesh(sHeadG, golden ? sCenterM : M3(0xfde68a)));
    const pm = M3(col, { roughness: .5, emissive: golden ? 0x6b4000 : 0x000000 });
    for (let i = 0; i < 6; i++) { const p = new THREE.Mesh(sPetalG, pm); const a = i / 6 * Math.PI * 2; p.position.set(Math.cos(a) * 0.09, 0, Math.sin(a) * 0.09); p.scale.set(1, 0.45, 1); head.add(p); }
    head.rotation.x = 0.5;
    const sc = golden ? 1.8 : 1 + spot[2] * 0.4;
    g.position.set(spot[0], 0, spot[1]); g.scale.setScalar(0.01); scene.add(g);
    sprouts.push({ g, spot, t: 0, sc });
  }
  function updateSprouts(dt, t) {
    sprouts.forEach((s, i) => {
      if (s.t < 1) { s.t = Math.min(1, s.t + dt / 0.7); const k = s.t, el = 1 + Math.sin(k * Math.PI * 2.5) * (1 - k) * 0.5; s.g.scale.setScalar(Math.max(0.01, s.sc * ease(k) * el)); }
      s.g.rotation.z = Math.sin(t * 1.5 + i) * 0.06;
    });
  }

  /* ---------- Per-frame garden update ---------- */
  let feverLit = false;
  function updateGarden(dt, t) {
    const mode = game.mode;
    potatoRig.visible = mode === 'potato';
    appleTree.visible = appleBasket.visible = mode === 'fruit';
    potCrate.visible = mode === 'potato'; if (mode !== 'potato') flyer.visible = false;
    treeFruit.forEach(f => { f.visible = mode !== 'potato'; });
    sortRig.visible = mode === 'sort';
    if (mode === 'potato') updatePotato(dt, t);
    else if (mode === 'fruit') updateTree(dt, t);
    else updateSort(dt, t);
    updateSprouts(dt, t); updateBits(dt);
    trees.forEach((g, i) => { g.userData.fol.rotation.z = Math.sin(t * 0.8 + i * 1.7) * 0.025; });
    clouds.forEach(c => { c.position.x += dt * (game.fever ? 0.9 : 0.25); if (c.position.x > 14) c.position.x = -14; });
    const fv = !!game.fever;                                      // FEVER: warm sunlight
    if (fv !== feverLit) { feverLit = fv; sun.color.setHex(fv ? 0xffd9a0 : 0xffffff); sun.intensity = fv ? 0.95 : 0.7; }
  }

  /* called by game.js */
  GW.three = {
    armOverlay(on) { armOverlays.forEach(m => { m.visible = !!on; }); },   // on/off switch (handy for testing)
    debug() { return { crate: potCrate.userData.count, appleBasket: appleBasket.userData.count, basketL: basketL.userData.count, basketR: basketR.userData.count,
                       flowers: sprouts.length, nextApple: tr.ai, potato: pt.st, held: sf.type, need: game.sortNeed }; },                // quick state check for testing
    harvestFX(info) {
      const golden = !!(info && info.golden);
      const o = game.mode === 'potato' ? pullPotato(golden) : game.mode === 'fruit' ? pickApple(golden) : dropFruit(golden);
      launchStarBurst(o);
      if (golden) setTimeout(() => launchStarBurst({ x: o.x, y: o.y + 0.6 }, 20), 180);
      sprout(golden);
    },
    setAvatar,                                        // choose the player's farmer (or 'ybot')
    avatarThumbs,                                     // { id: dataURL } portraits for the picker
    demoStart() { demoT0 = performance.now() / 1000; chipKey = ''; },   // Grandpa's demo starts from the first rep
    roundStart() {                                    // a fresh round starts with empty crates and baskets
      crateEmpty(potCrate);
      emptyBasket(appleBasket); emptyBasket(basketL); emptyBasket(basketR);
    },
    finishFX(stars) {
      launchStarBurst({ x: 0, y: 2.2 }, 30);
      if (stars >= 2) setTimeout(() => launchStarBurst({ x: -1.6, y: 2.6 }, 20), 250);
      if (stars >= 3) setTimeout(() => launchStarBurst({ x: 1.6, y: 2.6 }, 20), 500);
    }
  };

  /* ==========================================================
     D) 3D GRANDPA COACH (inside the Coach panel)
     ========================================================== */
  const solidM = {
    skin:  new THREE.MeshStandardMaterial({ color: 0xfcd5b0, roughness: .7 }),
    shirt: new THREE.MeshStandardMaterial({ color: 0x38bdf8, roughness: .65 }),
    pants: new THREE.MeshStandardMaterial({ color: 0x475569, roughness: .8 }),
    hair:  new THREE.MeshStandardMaterial({ color: 0xf1f5f9, roughness: .9 }),
    shoe:  new THREE.MeshStandardMaterial({ color: 0xe2e8f0, roughness: .6 }),
    dark:  new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: .5 })
  };
  const ghostMat = new THREE.MeshBasicMaterial({ color: 0x2fd673, transparent: true, opacity: .22, depthWrite: false });
  const ghostM = { skin: ghostMat, shirt: ghostMat, pants: ghostMat, hair: ghostMat, shoe: ghostMat, dark: ghostMat };

  const gCanvas = $('grandpa3d');
  const gRenderer = new THREE.WebGLRenderer({ canvas: gCanvas, alpha: true, antialias: true });
  gRenderer.setClearColor(0x000000, 0);
  const gScene = new THREE.Scene();
  const gCam = new THREE.PerspectiveCamera(32, 1.2, 0.1, 50);
  gScene.add(new THREE.AmbientLight(0xffffff, 0.8));
  const gSun = new THREE.DirectionalLight(0xffffff, 0.95); gSun.position.set(2, 4, 3); gScene.add(gSun);
  function resizeG() {
    const w = gCanvas.clientWidth, h = gCanvas.clientHeight; if (!w || !h) return;
    gRenderer.setPixelRatio(Math.min(devicePixelRatio || 1, PR_MAX));
    gRenderer.setSize(w, h, false); gCam.aspect = w / h; gCam.updateProjectionMatrix();
  }
  new ResizeObserver(resizeG).observe(gCanvas); resizeG();

  {
    const lawn = new THREE.Mesh(new THREE.CircleGeometry(2.1, 48), new THREE.MeshStandardMaterial({ color: 0x9fdcb0, roughness: 1 }));
    lawn.rotation.x = -Math.PI / 2; gScene.add(lawn);
    const shadow = new THREE.Mesh(new THREE.CircleGeometry(0.42, 32), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: .12, depthWrite: false }));
    shadow.rotation.x = -Math.PI / 2; shadow.position.y = 0.003; gScene.add(shadow);
    const cols = [0xf472b6, 0xfbbf24, 0xf87171, 0xc084fc];
    for (let i = 0; i < 9; i++) {
      const a = i / 9 * Math.PI * 2 + 0.3, r = 1.35 + ((i * 37) % 5) * 0.1, g = new THREE.Group();
      const st = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.012, 0.22, 5), new THREE.MeshStandardMaterial({ color: 0x15803d })); st.position.y = 0.11; g.add(st);
      const fl = new THREE.Mesh(new THREE.SphereGeometry(0.05, 10, 8), new THREE.MeshStandardMaterial({ color: cols[i % 4] })); fl.position.y = 0.24; g.add(fl);
      g.position.set(Math.cos(a) * r, 0, Math.sin(a) * r); gScene.add(g);
    }
  }
  const ringMat = new THREE.MeshBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: .8, side: THREE.DoubleSide });
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.5, 0.54, 48), ringMat); ring.rotation.x = -Math.PI / 2; ring.position.y = 0.006; gScene.add(ring);
  const chair = buildChair(); gScene.add(chair);

  const grandpa = makeFigure(solidM), ghost = makeFigure(ghostM);
  ghost.g.scale.setScalar(1.03);
  gScene.add(grandpa.g); gScene.add(ghost.g);

  let gp = { ...DEF }, gCamReady = false, demoT0 = 0;
  const DEMO_SPEED = { potato: 11 / 7.5, fruit: 11 / 7.5, sort: 10 / 7.5 };
  const gCamTarget = new THREE.Vector3(), gLook = new THREE.Vector3(0, 0.74, 0);
  function updateGrandpa(t) {
    const mode = game.mode, demo = game.phase === 'demo';
    if (demo) t = Math.max(0, t - demoT0) * DEMO_SPEED[mode];       // starts at the beginning of a rep; 2 reps in ~7.5 s
    let P, hit, phase;
    if (!demo && ui.gMode === 'mirror' && live.tracking) {
      P = liveParams(mode); hit = game.targetReached; phase = livePhase(mode);
      $('gCap').textContent = 'Mirroring you – match the green ghost!';
    } else {
      const c = coachParams(mode, t); P = c.P; hit = c.hit; phase = c.phase;
      $('gCap').textContent = (ui.gMode === 'mirror' && !live.tracking ? 'No body seen yet – showing the coach. ' : '') + CAPTION[mode];
    }
    for (const k in DEF) gp[k] = lerp(gp[k], P[k], 0.25);
    grandpa.apply(computeJoints(gp));
    ghost.apply(computeJoints(ghostParams(mode, t)));
    solidM.shirt.emissive.setHex(hit ? 0x0b5a2a : 0x000000);
    ringMat.color.setHex(hit ? 0x2fd673 : 0x2bb4f4);
    chair.visible = mode === 'potato';
    setChips(mode, phase, hit);
    if (mode === 'potato') gCamTarget.set(4.4, 1.1, 2.3); else gCamTarget.set(1.0, 1.1, 5.1);
    if (!gCamReady) { gCam.position.copy(gCamTarget); gCamReady = true; }   // first time the panel opens: no fly-in from the origin
    gCam.position.lerp(gCamTarget, 0.06); gCam.lookAt(gLook);
  }

  /* ---------- Render loop ---------- */
  let lastFrame = performance.now(), frameNo = 0;
  function frame(now) {
    requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - lastFrame) / 1000); lastFrame = now;
    const t = now / 1000;
    updateAvatar();                       // first: hand position is needed by the sorting fruit
    updateGarden(dt, t); updateStars(dt);
    camera3.layers.set(0); renderer.autoClear = true; renderer.render(scene, camera3);
    if (armOverlays.length) {                                    // arms again, on top of everything
      renderer.autoClear = false; renderer.clearDepth(); camera3.layers.set(1); renderer.render(scene, camera3); renderer.autoClear = true;
    }
    frameNo++;
    if (ui.coachOpen && (!IS_MOBILE || (frameNo & 1))) { updateGrandpa(t); gRenderer.render(gScene, gCam); }   // small coach window; every 2nd frame on phones
  }
  requestAnimationFrame(frame);
})();
