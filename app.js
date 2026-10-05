/* ============================================================
   6点透視 立体生成ツール — Noisism Rendering Engine
   ============================================================ */

// ==PURE-MATH-START==
function makeRNG(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeView(cx, cy, R, shifts) {
  const s = shifts || {};
  return {
    cx, cy, R,
    vpXp: { x: cx + R * (s.xp || 1), y: cy },
    vpXm: { x: cx - R * (s.xm || 1), y: cy },
    vpYp: { x: cx, y: cy + R * (s.yp || 1) },
    vpYm: { x: cx, y: cy - R * (s.ym || 1) },
    vpZp: { x: cx, y: cy },
  };
}

function circleFrom3Points(a, b, p) {
  const d = 2 * (a.x * (b.y - p.y) + b.x * (p.y - a.y) + p.x * (a.y - b.y));
  if (Math.abs(d) < 1e-6) return { type: 'line', a, b };
  const a2 = a.x * a.x + a.y * a.y, b2 = b.x * b.x + b.y * b.y, p2 = p.x * p.x + p.y * p.y;
  const ux = (a2 * (b.y - p.y) + b2 * (p.y - a.y) + p2 * (a.y - b.y)) / d;
  const uy = (a2 * (p.x - b.x) + b2 * (a.x - p.x) + p2 * (b.x - a.x)) / d;
  return { type: 'circle', c: { x: ux, y: uy }, r: Math.hypot(a.x - ux, a.y - uy) };
}

function curveThrough(view, fam, p) {
  if (fam === 'X') return circleFrom3Points(view.vpXp, view.vpXm, p);
  if (fam === 'Y') return circleFrom3Points(view.vpYp, view.vpYm, p);
  return { type: 'line', a: view.vpZp, b: p };
}

function advance(curve, p, delta) {
  if (curve.type === 'circle') {
    const a0 = Math.atan2(p.y - curve.c.y, p.x - curve.c.x);
    const a1 = a0 + delta;
    return { x: curve.c.x + curve.r * Math.cos(a1), y: curve.c.y + curve.r * Math.sin(a1) };
  }
  const vx = p.x - curve.a.x, vy = p.y - curve.a.y;
  const f = 1 + delta;
  return { x: curve.a.x + vx * f, y: curve.a.y + vy * f };
}

function sampleSeg(curve, p1, p2, bend, n = 22) {
  const pts = [];
  if (curve.type === 'circle') {
    let a1 = Math.atan2(p1.y - curve.c.y, p1.x - curve.c.x);
    let a2 = Math.atan2(p2.y - curve.c.y, p2.x - curve.c.x);
    let da = a2 - a1;
    while (da > Math.PI) da -= 2 * Math.PI;
    while (da < -Math.PI) da += 2 * Math.PI;
    for (let i = 0; i <= n; i++) {
      const t = i / n, a = a1 + da * t;
      let x = curve.c.x + curve.r * Math.cos(a);
      let y = curve.c.y + curve.r * Math.sin(a);
      if (bend) {
        x = x * (1 - bend) + (p1.x + (p2.x - p1.x) * t) * bend;
        y = y * (1 - bend) + (p1.y + (p2.y - p1.y) * t) * bend;
      }
      pts.push({ x, y });
    }
  } else {
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      pts.push({ x: p1.x + (p2.x - p1.x) * t, y: p1.y + (p2.y - p1.y) * t });
    }
  }
  return pts;
}
// ==PURE-MATH-END==

function walkSegments(view, rng, opts) {
  const segs = [];
  const fams = opts.fams;
  let p = { x: view.cx + opts.startR * Math.cos(opts.startA), y: view.cy + opts.startR * Math.sin(opts.startA) };
  const base = { x: p.x, y: p.y };
  for (let i = 0; i < opts.steps; i++) {
    const fam = fams[Math.floor(rng() * fams.length)];
    const curve = curveThrough(view, fam, p);
    let delta;
    if (curve.type === 'circle') {
      let d = opts.minD + rng() * (opts.maxD - opts.minD);
      if (opts.quantize) {
        d = opts.quantize[Math.floor(rng() * opts.quantize.length)];
      }
      delta = d * (rng() < 0.5 ? -1 : 1);
    } else {
      delta = (rng() < 0.5 ? -1 : 1) * (0.02 + rng() * 0.06) * (opts.zBoost || 1);
    }
    let np = advance(curve, p, delta);
    const dc = Math.hypot(np.x - view.cx, np.y - view.cy);
    if (dc > opts.maxR) np = advance(curve, p, -delta);
    segs.push({ fam, p1: { x: p.x, y: p.y }, p2: np });
    p = np;
  }
  const back = curveThrough(view, 'X', p);
  segs.push({ fam: 'X', p1: { x: p.x, y: p.y }, p2: base });
  return { segs, base };
}

function mirrorSegs(view, segs) {
  return segs.map(s => ({
    fam: s.fam,
    p1: { x: 2 * view.cx - s.p1.x, y: s.p1.y },
    p2: { x: 2 * view.cx - s.p2.x, y: s.p2.y },
  }));
}

function scaleSegs(view, segs, f) {
  return segs.map(s => ({
    fam: s.fam,
    p1: { x: view.cx + (s.p1.x - view.cx) * f, y: view.cy + (s.p1.y - view.cy) * f },
    p2: { x: view.cx + (s.p2.x - view.cx) * f, y: view.cy + (s.p2.y - view.cy) * f },
  }));
}

function generate(view, mode, seed) {
  const rng = makeRNG(seed);
  const startA = rng() * Math.PI * 2;
  if (mode === 'pebble') {
    return walkSegments(view, rng, {
      steps: 90 + Math.floor(rng() * 50), fams: ['X', 'X', 'Y', 'Y', 'Z'],
      minD: 0.015, maxD: 0.075, maxR: view.R * 0.42, startR: 20 + rng() * 40, startA, zBoost: 1,
    });
  }
  if (mode === 'crystal') {
    const q = [0.05, 0.08, 0.12];
    const g = walkSegments(view, rng, {
      steps: 18 + Math.floor(rng() * 12), fams: ['X', 'Y', 'Z'],
      minD: 0.04, maxD: 0.1, quantize: q, maxR: view.R * 0.45,
      startR: 10 + rng() * 25, startA, zBoost: 2.2,
    });
    g.segs = g.segs.concat(mirrorSegs(view, g.segs));
    return g;
  }
  const a1 = walkSegments(view, rng, {
    steps: 14 + Math.floor(rng() * 8), fams: ['X', 'Y'], minD: 0.04, maxD: 0.1,
    quantize: [0.05, 0.1], maxR: view.R * 0.44, startR: 8 + rng() * 20, startA, zBoost: 2,
  });
  const b1 = walkSegments(view, rng, {
    steps: 10 + Math.floor(rng() * 8), fams: ['Y', 'Z'], minD: 0.06, maxD: 0.12,
    quantize: [0.07, 0.11], maxR: view.R * 0.4, startR: 30 + rng() * 30, startA: startA + 1.3, zBoost: 3,
  });
  return { segs: a1.segs.concat(mirrorSegs(view, a1.segs), scaleSegs(view, b1.segs, 1.0)), base: a1.base };
}

/* ============================================================
   描画システム（ノイジスム・レンダリング）
   ============================================================ */
const canvas = document.getElementById('cv');
const ctx = canvas.getContext('2d');

const FAM_COLORS = { X: '#58c4dc', Y: '#e0a458', Z: '#a87ffb' };
let state = {
  mode: 'pebble', seed: (Math.random() * 1e9) | 0,
  gen: null, view: null, animT: 0, quiz: null,
};

// ノイジスム・ストローク描画: 単純な実線ではなく確率的散乱とディザを付与
function renderNoisismSegs(view, segs, opts) {
  const o = opts || {};
  const upto = o.upto !== undefined ? o.upto : segs.length;
  const corrupt = o.corrupt || null;
  const rng = makeRNG(12345);

  for (let i = 0; i < Math.min(upto, segs.length); i++) {
    const s = segs[i];
    let curve = curveThrough(view, s.fam, s.p1);
    let bend = corrupt && corrupt.bend ? corrupt.bend : 0;
    if (corrupt && corrupt.shifts) {
      const v2 = makeView(view.cx, view.cy, view.R, corrupt.shifts);
      curve = curveThrough(v2, s.fam, s.p1);
    }
    const pts = sampleSeg(curve, s.p1, s.p2, bend, 28);
    const strokeColor = o.colorFam ? FAM_COLORS[s.fam] : (o.color || '#e2ebf5');

    // コアパス
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let j = 1; j < pts.length; j++) ctx.lineTo(pts[j].x, pts[j].y);
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = o.lw || 1.1;
    ctx.globalAlpha = 0.85;
    ctx.stroke();

    // 規則的ディザ＆ランダム散乱 (エッジの量子化知覚)
    if (!corrupt) {
      ctx.fillStyle = strokeColor;
      for (let j = 0; j < pts.length; j += 2) {
        const pt = pts[j];
        const b = NoiseEngine.getBayer(pt.x, pt.y);
        if (b > 0.4) {
          const scatter = NoiseEngine.gaussian(rng) * 1.5;
          ctx.globalAlpha = 0.35 * b;
          ctx.fillRect(pt.x + scatter, pt.y + scatter, 1.2, 1.2);
        }
      }
    }
    ctx.globalAlpha = 1.0;
  }
}

// 透視グリッド（消失点モアレ）
function drawGrid(view) {
  ctx.save();
  ctx.lineWidth = 1;
  for (let i = -7; i <= 7; i++) {
    if (i === 0) continue;
    const off = i * view.R * 0.085;
    ctx.strokeStyle = 'rgba(88, 196, 220, 0.09)';
    let c = curveThrough(view, 'X', { x: view.cx, y: view.cy + off });
    if (c.type === 'circle') { ctx.beginPath(); ctx.arc(c.c.x, c.c.y, c.r, 0, Math.PI * 2); ctx.stroke(); }
    ctx.strokeStyle = 'rgba(224, 164, 88, 0.09)';
    c = curveThrough(view, 'Y', { x: view.cx + off, y: view.cy });
    if (c.type === 'circle') { ctx.beginPath(); ctx.arc(c.c.x, c.c.y, c.r, 0, Math.PI * 2); ctx.stroke(); }
  }

  // Z系 (中心からの放射量子化ドット)
  ctx.strokeStyle = 'rgba(168, 127, 251, 0.12)';
  for (let i = 0; i < 32; i++) {
    const a = (i / 32) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(view.cx, view.cy);
    ctx.lineTo(view.cx + Math.cos(a) * view.R * 1.5, view.cy + Math.sin(a) * view.R * 1.5);
    ctx.stroke();
  }

  // 6消失点マーカー（ノイズ干渉ドット）
  const vps = [view.vpXp, view.vpXm, view.vpYp, view.vpYm];
  vps.forEach(v => {
    ctx.fillStyle = 'rgba(88, 196, 220, 0.9)';
    ctx.beginPath(); ctx.arc(v.x, v.y, 3.5, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(88, 196, 220, 0.3)';
    ctx.beginPath(); ctx.arc(v.x, v.y, 8, 0, Math.PI * 2); ctx.stroke();
  });
  ctx.fillStyle = 'rgba(168, 127, 251, 0.9)';
  ctx.beginPath(); ctx.arc(view.vpZp.x, view.vpZp.y, 3.5, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

function drawNormal() {
  const view = state.view;
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // 背景: フラクタル×規則性ノイズによる空間曲率フィールド
  NoiseEngine.renderCurvedField(ctx, view.cx, view.cy, view.R * 0.6, canvas.width, canvas.height);

  if (document.getElementById('showGrid').checked) drawGrid(view);
  const gen = state.gen;
  const upto = document.getElementById('anim').checked ? Math.floor(state.animT) : gen.segs.length;

  // 主要要素の内部充填（フラクタル密度陰影）
  if (upto >= gen.segs.length) {
    ctx.save();
    ctx.beginPath();
    let started = false;
    gen.segs.forEach(s => {
      const pts = sampleSeg(curveThrough(view, s.fam, s.p1), s.p1, s.p2, 0, 8);
      pts.forEach(p => {
        if (!started) { ctx.moveTo(p.x, p.y); started = true; }
        else ctx.lineTo(p.x, p.y);
      });
    });
    ctx.closePath();
    ctx.clip();

    // 内部フラクタルハッチング
    const g = ctx.createRadialGradient(view.cx, view.cy, 10, view.cx, view.cy, view.R * 0.45);
    g.addColorStop(0, 'rgba(88, 196, 220, 0.22)');
    g.addColorStop(0.7, 'rgba(168, 127, 251, 0.08)');
    g.addColorStop(1, 'rgba(0,0,0,0.6)');
    ctx.fillStyle = g;
    ctx.fill();
    ctx.restore();
  }

  renderNoisismSegs(view, gen.segs, { upto, colorFam: document.getElementById('colorFam').checked });

  if (document.getElementById('showBase').checked && gen.base) {
    ctx.fillStyle = '#ffd166';
    ctx.beginPath(); ctx.arc(gen.base.x, gen.base.y, 4, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(255, 209, 102, 0.7)';
    ctx.font = '11px monospace';
    ctx.fillText('REF_PT', gen.base.x + 8, gen.base.y - 6);
  }
}

function tick() {
  if (!state.quiz && document.getElementById('anim').checked && state.gen) {
    if (state.animT < state.gen.segs.length) {
      state.animT += Math.max(1, state.gen.segs.length / 120);
      drawNormal();
    }
  }
  requestAnimationFrame(tick);
}

/* 検証モード（A/Bテスト） */
const quiz = { active: false, n: 0, correct: 0, pass: 0, corruptSide: 'right' };

function startQuiz() {
  quiz.active = true;
  state.quiz = quiz;
  document.getElementById('quizUI').classList.remove('hidden');
  document.getElementById('quizAnswerRow').style.display = 'flex';
  document.getElementById('quizFeedback').textContent = '';
  nextRound();
}

function nextRound() {
  quiz.corruptSide = Math.random() < 0.5 ? 'left' : 'right';
  quiz.seed = (Math.random() * 1e9) | 0;
  drawQuiz();
}

function drawQuiz() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const diff = document.getElementById('difficulty').value;
  const corrupt = diff === 'bend'
    ? { bend: 0.38 }
    : { shifts: { xp: 1.34, xm: 0.8, ym: 1.28 } };

  const halves = [
    { cx: canvas.width * 0.25, side: 'left' },
    { cx: canvas.width * 0.75, side: 'right' },
  ];

  halves.forEach(h => {
    const view = makeView(h.cx, canvas.height / 2, 400);
    NoiseEngine.renderCurvedField(ctx, view.cx, view.cy, 240, canvas.width, canvas.height);
    const gen = generate(view, state.mode, quiz.seed);
    const isCorrupt = h.side === quiz.corruptSide;
    renderNoisismSegs(view, gen.segs, { corrupt: isCorrupt ? corrupt : null, color: '#e2ebf5', lw: 1.0 });
  });

  // 境界要素: ディザ区切り線
  ctx.save();
  ctx.strokeStyle = 'rgba(88, 196, 220, 0.3)';
  ctx.setLineDash([2, 4]);
  ctx.beginPath();
  ctx.moveTo(canvas.width / 2, 20);
  ctx.lineTo(canvas.width / 2, canvas.height - 20);
  ctx.stroke();
  ctx.restore();
}

function answer(choice) {
  if (!quiz.active) return;
  const fb = document.getElementById('quizFeedback');
  if (choice === 'pass') {
    quiz.pass++;
    fb.className = 'feedback';
    fb.textContent = 'PASS: 正解は「' + (quiz.corruptSide === 'left' ? '右' : '左') + '」';
  } else {
    quiz.n++;
    const ok = (choice !== quiz.corruptSide);
    if (ok) {
      quiz.correct++;
      fb.className = 'feedback ok';
      fb.textContent = 'CORRECT! 透視ルール保存側: ' + (quiz.corruptSide === 'left' ? '右' : '左');
    } else {
      fb.className = 'feedback ng';
      fb.textContent = 'INCORRECT... 透視ルール保存側: ' + (quiz.corruptSide === 'left' ? '右' : '左');
    }
  }
  updateStats();
  setTimeout(() => { if (quiz.active) { fb.textContent = ''; nextRound(); } }, 1500);
}

function updateStats() {
  const el = document.getElementById('quizStats');
  if (quiz.n === 0) { el.textContent = `試行: 0 正解: 0 パス: ${quiz.pass}`; return; }
  const acc = (100 * quiz.correct / quiz.n).toFixed(1);
  const z = (quiz.correct - quiz.n / 2) / Math.sqrt(quiz.n / 4);
  let sig = z > 1.96 ? ' [有意: ルール知覚成立]' : ' [偶然の範囲]';
  el.textContent = `試行: ${quiz.n} | 正解: ${quiz.correct} (${acc}%) | z = ${z.toFixed(2)}${sig}`;
}

function regen() {
  state.view = makeView(canvas.width / 2, canvas.height / 2, 760);
  state.gen = generate(state.view, state.mode, state.seed);
  state.animT = 0;
  document.getElementById('seedLabel').textContent = state.seed;
  if (!state.quiz) drawNormal();
}

/* イベントバインド */
document.getElementById('modeRow').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  document.querySelectorAll('#modeRow button').forEach(x => x.classList.remove('active'));
  b.classList.add('active');
  state.mode = b.dataset.mode;
  regen(); if (state.quiz) drawQuiz();
});

document.getElementById('regen').addEventListener('click', () => {
  state.seed = (Math.random() * 1e9) | 0;
  regen(); if (state.quiz) drawQuiz();
});

['showGrid', 'showBase', 'colorFam', 'anim'].forEach(id =>
  document.getElementById(id).addEventListener('change', () => { if (!state.quiz) drawNormal(); }));

document.getElementById('quizStart').addEventListener('click', startQuiz);
document.getElementById('ansLeft').addEventListener('click', () => answer('left'));
document.getElementById('ansRight').addEventListener('click', () => answer('right'));
document.getElementById('ansPass').addEventListener('click', () => answer('pass'));
document.getElementById('difficulty').addEventListener('change', () => { if (state.quiz) drawQuiz(); });

document.getElementById('savePng').addEventListener('click', () => {
  const a = document.createElement('a');
  a.download = `noisism_6vp_${state.mode}_${state.seed}.png`;
  a.href = canvas.toDataURL('image/png');
  a.click();
});

regen();
tick();