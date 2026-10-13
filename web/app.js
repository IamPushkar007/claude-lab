import { createCavity } from '../src/cavity-mac.js';
import * as M from '../src/measure.js';

const $ = (id) => document.getElementById(id);
const getJSON = (p) => fetch(p).then((r) => (r.ok ? r.json() : null)).catch(() => null);
const getText = (p) => fetch(p).then((r) => (r.ok ? r.text() : ''));
const fmt = (x) => (Number.isFinite(x) ? x.toExponential(2) : 'NaN');
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const hash = (n) => { const s = Math.sin(n * 12.9898 + 78.233) * 43758.5453; return s - Math.floor(s); };

const [manifest, ref, result] = await Promise.all([
  getJSON('/experiments/ghia-cavity-re100.json'),
  getJSON('/data/ghia1982_re100.json'),
  getJSON('/results/ghia-cavity-re100.json'),
]);
const a = manifest.acceptance;
const refVerified = !/^UNVERIFIED/.test(ref.verification_status);
const refU = ref.u_on_vertical_centerline_x_0_5;
const refV = ref.v_on_horizontal_centerline_y_0_5;

// ---------- static content ----------
$('claim').textContent = manifest.claim;
$('open').innerHTML = manifest.open_items.map((s) => `<li>${s}</li>`).join('');
$('s-papers').textContent = 1;
$('s-methods').textContent = 1;
$('s-scenes').textContent = 1;
$('s-review').textContent = result?.status === 'MATCHES_REFERENCE' ? 0 : 1;

const files = {
  'cavity-mac.js': '/src/cavity-mac.js', 'measure.js': '/src/measure.js', 'reproduce.js': '/scripts/reproduce.js',
  'ghia.json': '/data/ghia1982_re100.json', 'manifest.json': '/experiments/ghia-cavity-re100.json',
};
const sources = {};
for (const [name, path] of Object.entries(files)) sources[name] = await getText(path);
function showSource(name) {
  const lines = sources[name].split('\n');
  $('code').innerHTML = lines.map((l, i) => `<span class="ln">${String(i + 1).padStart(3)}</span>  ${l.replace(/&/g, '&amp;').replace(/</g, '&lt;')}`).join('\n');
  [...$('tabs').children].forEach((b) => b.classList.toggle('on', b.textContent === name));
  const at = name === 'cavity-mac.js' ? Math.max(0, lines.findIndex((l) => l.includes('function step'))) : 0;
  $('codewrap').scrollTop = at * 8.5 * 1.55;
}
for (const name of Object.keys(files)) {
  const b = document.createElement('button');
  b.textContent = name;
  b.onclick = () => showSource(name);
  $('tabs').appendChild(b);
}
showSource('cavity-mac.js');

const poolLines = Object.values(sources).join('\n').split('\n').map((l) => l.trim()).filter((l) => l.length > 8);

$('routes').innerHTML = '<tr><th>Paper</th><th>Extract</th><th>Code</th><th>Check</th></tr>' + [
  ['momentum', 'equation', 'step()', 'centreline'],
  ['continuity', 'constraint', 'SOR + correct', 'div, flux'],
  ['no-slip, lid', 'boundary', 'ghost cells', 'wall values'],
  ['Re = 100', 'settings', 'manifest.json', 'conditions'],
  ['tables I, II', 'reference', 'ghia.json', 'compare'],
  ['tolerance', 'MISSING', 'lab-chosen', 'flagged'],
].map(([p, e, c, k]) => `<tr><td class="hi">${p}</td><td><span class="chip ${e === 'MISSING' ? '' : 'hi'}">${e}</span></td><td><span class="chip">${c}</span></td><td><span class="chip">${k}</span></td></tr>`).join('');

const roles = ['read', 'build', 'review', 'UI'];
$('agents').innerHTML = [0, 1, 2, 3, 4, 5].map((r) => {
  const l = r, rr = r + 6;
  const cell = (n) => `<td class="dim">${String(n + 1).padStart(2, '0')}</td><td>${roles[n % 4]}</td><td><span class="bar"></span></td>`;
  return `<tr>${cell(l)}<td style="width:10px"></td>${cell(rr)}</tr>`;
}).join('');

const statusClass = !result ? 'warn' : result.status === 'FAILED' ? 'bad' : result.status === 'MATCHES_REFERENCE' ? 'ok' : 'warn';
const stateWord = !result ? 'no result' : result.status === 'FAILED' ? 'failed' : result.status === 'MATCHES_REFERENCE' ? 'match' : 'review';
const emptyCells = '<span class="cell"></span>'.repeat(7);
$('index').innerHTML = '<tr><th>Method</th><th>Reference scene index</th><th>State</th></tr>' +
  `<tr><td class="hi">M01</td><td><span class="cell ${statusClass}"></span>${emptyCells}</td><td class="${statusClass}">${stateWord}</td></tr>` +
  `<tr><td class="dim">M02</td><td>${'<span class="cell"></span>'.repeat(8)}</td><td class="dim">planned</td></tr>` +
  `<tr><td class="dim">M03</td><td>${'<span class="cell"></span>'.repeat(8)}</td><td class="dim">planned</td></tr>`;
$('index-foot').textContent = `1 scene / ${result?.status === 'MATCHES_REFERENCE' ? 1 : 0} matched / 1 further review${refVerified ? '' : ' (reference unverified)'}`;

// ---------- canvases ----------
const hero = $('hero-canvas');
const hg = hero.getContext('2d');
const dpr = Math.min(2, window.devicePixelRatio || 1);
function fit(c, h) {
  c.width = Math.max(10, Math.floor(c.clientWidth * dpr));
  const hh = h ?? c.clientHeight;
  c.height = Math.floor(hh * dpr);
  c.style.height = hh + 'px';
}
function fitAll() {
  hero.width = Math.floor(hero.clientWidth * dpr);
  hero.height = Math.floor(hero.clientHeight * dpr);
  hg.fillStyle = '#000'; hg.fillRect(0, 0, hero.width, hero.height);
  fit($('adv'), 100); fit($('refgrid'), 64); fit($('impgrid'), 64); fit($('diffbars'), 30);
  for (const id of ['sp-mass', 'sp-speed', 'sp-res']) fit($(id), 32);
}

// ---------- simulation + particles ----------
let sim, running = true, advMode = 'advect';
const NP = 3200;
const px = new Float32Array(NP), py = new Float32Array(NP), age = new Int16Array(NP), life = new Int16Array(NP);
const series = { mass: [], speed: [], res: [] };
let feed = [], flags, nextLogT, feedN = 0;
let rowSpeed;

function spawn(k) { px[k] = Math.random(); py[k] = Math.random(); age[k] = 0; life[k] = 80 + ((Math.random() * 180) | 0); }

function log(tag, msg) {
  feed.push([feedN++, tag, msg]);
  if (feed.length > 11) feed.shift();
  $('feed').innerHTML = feed.map(([n, t, m], i) => `<div class="${i === feed.length - 1 ? 'last' : ''}"><span class="n">${String(n).padStart(3, '0')}</span><span class="t">${t}</span>${m}</div>`).join('');
}

function reset() {
  sim = createCavity({ N: Number($('grid').value), Re: Number($('re').value), lid: 1 });
  $('title-re').textContent = `${sim.N}x${sim.N}`;
  for (let k = 0; k < NP; k++) { spawn(k); age[k] = (Math.random() * life[k]) | 0; }
  series.mass = []; series.speed = []; series.res = [];
  feed = []; feedN = 0; flags = { conv: false }; nextLogT = 2;
  rowSpeed = new Float32Array(sim.N);
  const warm = Number(new URLSearchParams(location.search).get('warm') || 0);
  for (let k = 0; k < warm; k++) sim.step();
  hg.fillStyle = '#000'; hg.fillRect(0, 0, hero.width, hero.height);
  log('run', `start Re=${sim.Re} grid=${sim.N} dt=${sim.dt.toExponential(2)}`);
  log('read', 'load manifest + reference data');
  if (sim.Re !== 100) log('flag', 'no reference for this Re; unverified');
}

function velocityAt(x, y) {
  const { N, u, v } = sim;
  let fx = clamp(x * N, 0, N - 1e-6), fy = clamp(y * N - 0.5, 0, N - 1 - 1e-6);
  let i = fx | 0, j = fy | 0, s = fx - i, t = fy - j;
  const uu = (1 - s) * (1 - t) * u[i * N + j] + s * (1 - t) * u[(i + 1) * N + j] + (1 - s) * t * u[i * N + j + 1] + s * t * u[(i + 1) * N + j + 1];
  fx = clamp(x * N - 0.5, 0, N - 1 - 1e-6); fy = clamp(y * N, 0, N - 1e-6);
  i = fx | 0; j = fy | 0; s = fx - i; t = fy - j;
  const M1 = N + 1;
  const vv = (1 - s) * (1 - t) * v[i * M1 + j] + s * (1 - t) * v[(i + 1) * M1 + j] + (1 - s) * t * v[i * M1 + j + 1] + s * t * v[(i + 1) * M1 + j + 1];
  return [uu, vv];
}

function updateRowSpeed() {
  const { N, u, v } = sim;
  for (let j = 0; j < N; j++) {
    let sum = 0;
    for (let i = 0; i < N; i++) {
      const uc = 0.5 * (u[i * N + j] + u[(i + 1) * N + j]);
      const vc = 0.5 * (v[i * (N + 1) + j] + v[i * (N + 1) + j + 1]);
      sum += Math.hypot(uc, vc);
    }
    rowSpeed[j] = 0.85 * rowSpeed[j] + 0.15 * (sum / N);
  }
}

// ---------- hero ----------
function annulus(cx, cy, Rout, Rin) {
  hg.beginPath();
  hg.moveTo(cx + Rout, cy); hg.arc(cx, cy, Rout, 0, Math.PI * 2);
  hg.moveTo(cx + Rin, cy); hg.arc(cx, cy, Rin, 0, Math.PI * 2);
}

function drawHero(time) {
  const W = hero.width, H = hero.height;
  const Rout = 0.97 * H, ringW = Math.min(0.195 * W, 0.23 * H), Rin = Rout - ringW;
  const cy = H / 2, cx = 0.655 * W - Rout;
  const fieldW = 0.62 * W;

  // left: persistent particle trails
  hg.fillStyle = 'rgba(0,0,0,0.05)'; hg.fillRect(0, 0, W, H);
  const fast = new Path2D(), mid = new Path2D(), slow = new Path2D();
  for (let k = 0; k < NP; k++) {
    const [uu, vv] = velocityAt(px[k], py[k]);
    const sp = Math.hypot(uu, vv);
    const nx = px[k] + 0.045 * uu, ny = py[k] + 0.045 * vv;
    const path = sp > 0.25 ? fast : sp > 0.08 ? mid : slow;
    path.moveTo(px[k] * fieldW, (1 - py[k]) * H);
    path.lineTo(nx * fieldW, (1 - ny) * H);
    px[k] = nx; py[k] = ny;
    if (++age[k] > life[k] || nx < 0 || nx > 1 || ny < 0 || ny > 1) spawn(k);
  }
  hg.lineWidth = dpr;
  hg.strokeStyle = 'rgba(255,255,255,0.85)'; hg.stroke(fast);
  hg.strokeStyle = 'rgba(210,210,210,0.42)'; hg.stroke(mid);
  hg.strokeStyle = 'rgba(170,170,170,0.2)'; hg.stroke(slow);
  hg.strokeStyle = 'rgba(255,255,255,0.55)';
  for (let k = 0; k < 10; k++) { hg.beginPath(); hg.arc(px[k] * fieldW, (1 - py[k]) * H, (2 + (k % 3)) * dpr, 0, 7); hg.stroke(); }

  // everything right of the outer circle is repainted each frame
  hg.save();
  hg.beginPath(); hg.rect(0, 0, W, H); hg.moveTo(cx + Rout, cy); hg.arc(cx, cy, Rout, 0, Math.PI * 2);
  hg.fillStyle = '#000'; hg.fill('evenodd');
  hg.restore();

  // right: horizontal streaks driven by per-row mean speed of the live field
  const rh = Math.max(2, 3 * dpr);
  for (let yy = 0, r = 0; yy < H; yy += rh, r++) {
    const dy = yy + rh / 2 - cy;
    if (Math.abs(dy) >= Rout) continue;
    const xo = cx + Math.sqrt(Rout * Rout - dy * dy) + 4 * dpr;
    const j = clamp(Math.floor((1 - (yy + rh / 2) / H) * sim.N), 0, sim.N - 1);
    const grp = Math.floor(r / (3 + Math.floor(hash(Math.floor(r / 6)) * 5)));
    const jit = hash(grp * 1.7) * (0.5 + 0.5 * Math.sin(time * 0.8 + grp));
    const L = (W - xo - 6 * dpr) * clamp(0.08 + 2.1 * rowSpeed[j] + 0.45 * jit, 0.04, 1);
    const b = 0.25 + 0.75 * (0.6 * hash(grp * 2.3) + 0.4 * hash(r * 5.1));
    const segs = 8;
    for (let s = 0; s < segs; s++) {
      const t = s / segs;
      hg.fillStyle = `rgba(255,255,255,${(b * Math.pow(1 - t, 1.6) * 0.9).toFixed(3)})`;
      hg.fillRect(xo + t * L, yy, L / segs + 1, rh - 1);
    }
  }

  // ring band with scrolling tables built from the project's own source lines
  hg.save();
  annulus(cx, cy, Rout, Rin);
  hg.fillStyle = '#030303'; hg.fill('evenodd');
  hg.clip('evenodd');
  const vis = Math.asin(Math.min(1, (H / 2) / Rout)) + 0.12;
  const step = 0.05, nBlocks = Math.round((Math.PI * 2) / step);
  const rot = time * 0.02;
  hg.font = `${6 * dpr}px ui-monospace, Menlo, monospace`;
  hg.textBaseline = 'top';
  for (let k = 0; k < nBlocks; k++) {
    let th = (k * step + rot) % (Math.PI * 2);
    if (th > Math.PI) th -= Math.PI * 2;
    if (Math.abs(th) > vis) continue;
    const bw = (46 + hash(k + 9) * 70) * dpr;
    const r = Rin + 8 * dpr + hash(k) * Math.max(0, ringW - bw - 16 * dpr);
    hg.save();
    hg.translate(cx + r * Math.cos(th), cy + r * Math.sin(th));
    hg.rotate(th);
    if (k % 5 === 0) {
      for (let a2 = 0; a2 < 8; a2++) for (let b2 = 0; b2 < 6; b2++) {
        hg.fillStyle = `rgba(255,255,255,${(0.1 + 0.8 * hash(k * 13 + a2 * 7 + b2 + Math.floor(time * 2))).toFixed(2)})`;
        hg.fillRect(a2 * 5 * dpr, b2 * 5 * dpr, 3.5 * dpr, 3.5 * dpr);
      }
    } else {
      const rows = 7 + Math.floor(hash(k + 3) * 6), chars = Math.floor(bw / (3.7 * dpr));
      for (let q = 0; q < rows; q++) {
        const line = poolLines[(k * 7 + q * 3) % poolLines.length].slice(0, chars);
        hg.fillStyle = q === 0 ? '#f0f0f0' : q % 3 === 0 ? '#aaa' : '#7d7d7d';
        hg.fillText(line, 0, q * 6.2 * dpr);
      }
    }
    hg.restore();
  }
  hg.restore();

  hg.lineWidth = 1.5 * dpr; hg.strokeStyle = '#ececec';
  hg.beginPath(); hg.arc(cx, cy, Rout, 0, Math.PI * 2); hg.stroke();
  hg.lineWidth = dpr; hg.strokeStyle = 'rgba(255,255,255,0.35)';
  hg.beginPath(); hg.arc(cx, cy, Rout - 4 * dpr, 0, Math.PI * 2); hg.stroke();
  hg.strokeStyle = '#cfcfcf';
  hg.beginPath(); hg.arc(cx, cy, Rin, 0, Math.PI * 2); hg.stroke();
}

// ---------- panels ----------
function drawSpark(id, arr) {
  const c = $(id), g = c.getContext('2d');
  g.clearRect(0, 0, c.width, c.height);
  if (arr.length < 2) return;
  let lo = Infinity, hi = -Infinity;
  for (const x of arr) { if (x < lo) lo = x; if (x > hi) hi = x; }
  if (hi - lo < 1e-12) hi = lo + 1;
  g.strokeStyle = '#d8d8d8'; g.lineWidth = dpr; g.beginPath();
  arr.forEach((x, k) => {
    const X = (k / (arr.length - 1)) * c.width, Y = c.height - 3 - ((x - lo) / (hi - lo)) * (c.height - 6);
    k ? g.lineTo(X, Y) : g.moveTo(X, Y);
  });
  g.stroke();
}

function drawGrid(c, n, valueAt) {
  const g = c.getContext('2d');
  g.fillStyle = '#050505'; g.fillRect(0, 0, c.width, c.height);
  const cw = c.width / n, ch = c.height / n;
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    const v = valueAt(i, j);
    if (v === null) { g.fillStyle = '#161616'; g.fillRect(i * cw + cw * 0.35, (n - 1 - j) * ch + ch * 0.35, cw * 0.3, ch * 0.3); continue; }
    const l = Math.round(clamp(v, 0, 1) * 235) + 15;
    g.fillStyle = `rgb(${l},${l},${l})`;
    g.fillRect(i * cw + 0.5, (n - 1 - j) * ch + 0.5, cw - 1, ch - 1);
  }
}

function drawAdvPanel() {
  const c = $('adv'), g = c.getContext('2d'), { N } = sim;
  g.fillStyle = '#050505'; g.fillRect(0, 0, c.width, c.height);
  if (advMode === 'advect') {
    g.fillStyle = 'rgba(235,235,235,0.85)';
    for (let k = 0; k < 600; k++) g.fillRect(px[k] * c.width, (1 - py[k]) * c.height, dpr, dpr);
  } else {
    const n = Math.min(N, 64), cw = c.width / n, ch = c.height / n;
    let maxv = 1e-12;
    const vals = new Float32Array(n * n);
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      const ii = Math.floor(i * N / n), jj = Math.floor(j * N / n);
      let val;
      if (advMode === 'project') val = sim.p[ii * N + jj];
      else val = Math.abs((sim.u[(ii + 1) * N + jj] - sim.u[ii * N + jj] + sim.v[ii * (N + 1) + jj + 1] - sim.v[ii * (N + 1) + jj]) / sim.h);
      vals[i * n + j] = val; maxv = Math.max(maxv, Math.abs(val));
    }
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      const val = vals[i * n + j];
      const t = advMode === 'project'
        ? 0.5 + 0.5 * val / maxv
        : (Math.log10(val + 1e-14) + 14) / (Math.log10(maxv + 1e-14) + 14);
      const l = Math.round(clamp(t, 0, 1) * 235) + 15;
      g.fillStyle = `rgb(${l},${l},${l})`;
      g.fillRect(i * cw, (n - 1 - j) * ch, cw + 0.5, ch + 0.5);
    }
  }
}

function drawDifferencePanel(uLine) {
  const n = 22;
  drawGrid($('impgrid'), n, (i, j) => Math.min(1, Math.hypot(...velocityAt((i + 0.5) / n, (j + 0.5) / n)) * 1.4));
  const cr = $('refgrid');
  if (sim.Re === 100) {
    const mid = n / 2 | 0;
    drawGrid(cr, n, (i, j) => {
      for (const [y, val] of refU) if (i === mid && j === Math.min(n - 1, Math.floor(y * n))) return (val + 0.25) / 1.25;
      for (const [x, val] of refV) if (j === mid && i === Math.min(n - 1, Math.floor(x * n))) return 0.15 + Math.abs(val) / 0.3;
      return null;
    });
  } else drawGrid(cr, n, () => null);
  const c = $('diffbars'), g = c.getContext('2d');
  g.fillStyle = '#050505'; g.fillRect(0, 0, c.width, c.height);
  if (sim.Re !== 100) { $('diff-foot').textContent = 'no reference for this Re'; return; }
  const sorted = [...refU].sort((p, q) => p[0] - q[0]);
  const bw = c.width / sorted.length;
  sorted.forEach(([y, val], k) => {
    const d = Math.abs(M.interp(uLine, y) - val) / a.u_centerline_max_abs_error;
    const h = clamp(d, 0, 1) * (c.height - 2);
    g.fillStyle = d > 1 ? '#ff6b6b' : '#cfcfcf';
    g.fillRect(k * bw + 1, c.height - h - 1, bw - 2, Math.max(1, h));
  });
  $('diff-foot').textContent = 'SAME INPUT / LOCAL DIFFERENCE (bar = |sim-ref| / tol, u on x=0.5). reference exists on centrelines only';
}

function updatePanels() {
  const { N, Re, state } = sim;
  const uLine = M.uCenterline(sim);
  const div = M.maxDivergence(sim), flux = M.boundaryFlux(sim), sp = M.maxSpeed(sim);
  const massOk = div <= a.max_cell_divergence && Math.abs(flux) <= a.max_boundary_flux;
  const stableOk = M.allFinite(sim) && sp <= a.max_speed_bound;
  const converged = state.lastChange < 1e-6;

  $('conditions').innerHTML = `Re=${Re}, ${N}x${N}, dt=${sim.dt.toExponential(2)}, lid=1, no-slip walls<br>t=${state.t.toFixed(2)}, steps=${state.steps}<br>|du/dt|=${fmt(state.lastChange)}`;
  const prog = clamp((-2 - Math.log10(Math.max(state.lastChange, 1e-6))) / 4, 0, 1) * 5;
  [...document.querySelectorAll('#segs b')].forEach((b, k) => { b.style.width = `${clamp(prog - k, 0, 1) * 100}%`; });

  if (Re === 100) {
    const du = M.compareToReference(uLine, refU);
    const dv = M.compareToReference(M.vCenterline(sim), refV);
    $('diff').innerHTML = `u: RMSE ${fmt(du.rmse)}, max ${fmt(du.maxAbs)} @ y=${du.maxAbsAt}<br>v: RMSE ${fmt(dv.rmse)}, max ${fmt(dv.maxAbs)} @ x=${dv.maxAbsAt}<br>` +
      `<span class="warn">reference ${refVerified ? 'verified' : 'UNVERIFIED'}${converged ? '' : '; run not converged yet'}</span>`;
  } else {
    $('diff').innerHTML = '<span class="warn">No reference loaded for this Re. Result is unverified.</span>';
  }

  $('ov-live').innerHTML =
    `<span class="${massOk ? 'ok' : 'bad'}">${massOk ? 'PASS' : 'FAIL'}</span> max|&nabla;&middot;u| ${fmt(div)} &nbsp; flux ${fmt(flux)}<br>` +
    `<span class="${stableOk ? 'ok' : 'bad'}">${stableOk ? 'PASS' : 'FAIL'}</span> max speed ${sp.toFixed(3)}`;

  drawSpark('sp-mass', series.mass); drawSpark('sp-speed', series.speed); drawSpark('sp-res', series.res);
  drawAdvPanel();
  drawDifferencePanel(uLine);

  if (state.t >= nextLogT && !converged) { log('step', `t=${state.t.toFixed(1)} |du/dt|=${fmt(state.lastChange)}`); nextLogT += 2; }
  if (converged && !flags.conv) {
    flags.conv = true;
    log('check', `converged at t=${state.t.toFixed(2)}`);
    log('check', `mass ${massOk ? 'PASS' : 'FAIL'} / stable ${stableOk ? 'PASS' : 'FAIL'}`);
    if (Re === 100) {
      const du = M.compareToReference(uLine, refU);
      log('read', `u max diff ${fmt(du.maxAbs)} vs tol ${a.u_centerline_max_abs_error}`);
      log('flag', refVerified ? 'reference verified' : 'reference UNVERIFIED: further review');
    }
  }
}

let frame = 0;
function loop(ts) {
  const time = ts / 1000;
  const { state } = sim;
  if (running && state.lastChange >= 1e-6 && state.t < 60) {
    const t0 = performance.now();
    while (performance.now() - t0 < 9) {
      sim.step();
      if (state.steps % 40 === 0) {
        series.mass.push(Math.log10(Math.max(M.maxDivergence(sim), 1e-16)));
        series.speed.push(M.maxSpeed(sim));
        series.res.push(Math.log10(Math.max(state.lastChange, 1e-12)));
        for (const key of Object.keys(series)) if (series[key].length > 300) series[key].shift();
      }
    }
  }
  updateRowSpeed();
  drawHero(time);
  if (frame++ % 6 === 0) updatePanels();
  requestAnimationFrame(loop);
}

$('toggle').onclick = () => { running = !running; $('toggle').textContent = running ? 'Pause' : 'Resume'; };
$('reset').onclick = reset;
$('re').onchange = reset;
$('grid').onchange = reset;
$('modes').onclick = (e) => {
  const m = e.target.dataset?.m;
  if (!m) return;
  advMode = m;
  [...$('modes').children].forEach((b) => b.classList.toggle('on', b.dataset.m === m));
};
window.addEventListener('resize', fitAll);
fitAll();
reset();
requestAnimationFrame(loop);
