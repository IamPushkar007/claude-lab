// Shared measurement tools. Every method must be scored through these so results are comparable.

export function maxDivergence(sim) {
  const { N, h, u, v } = sim;
  let m = 0;
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < N; j++) {
      const d = (u[(i + 1) * N + j] - u[i * N + j] + v[i * (N + 1) + j + 1] - v[i * (N + 1) + j]) / h;
      m = Math.max(m, Math.abs(d));
    }
  }
  return m;
}

export function boundaryFlux(sim) {
  const { N, h, u, v } = sim;
  let f = 0;
  for (let j = 0; j < N; j++) f += (u[N * N + j] - u[j]) * h;
  for (let i = 0; i < N; i++) f += (v[i * (N + 1) + N] - v[i * (N + 1)]) * h;
  return f;
}

export function maxSpeed(sim) {
  let m = 0;
  for (const a of sim.u) m = Math.max(m, Math.abs(a));
  for (const a of sim.v) m = Math.max(m, Math.abs(a));
  return m;
}

export function allFinite(sim) {
  return [sim.u, sim.v, sim.p].every((arr) => arr.every(Number.isFinite));
}

// u along the vertical centreline x = 0.5, with wall values 0 (y=0) and lid (y=1).
export function uCenterline(sim) {
  const { N, h, u, lid } = sim;
  const i = N / 2;
  const ys = [0];
  const us = [0];
  for (let j = 0; j < N; j++) { ys.push((j + 0.5) * h); us.push(u[i * N + j]); }
  ys.push(1); us.push(lid);
  return { s: ys, f: us };
}

// v along the horizontal centreline y = 0.5.
export function vCenterline(sim) {
  const { N, h, v } = sim;
  const j = N / 2;
  const xs = [0];
  const vs = [0];
  for (let i = 0; i < N; i++) { xs.push((i + 0.5) * h); vs.push(v[i * (N + 1) + j]); }
  xs.push(1); vs.push(0);
  return { s: xs, f: vs };
}

export function interp(line, s) {
  const { s: xs, f } = line;
  for (let k = 1; k < xs.length; k++) {
    if (s <= xs[k]) {
      const w = (s - xs[k - 1]) / (xs[k] - xs[k - 1]);
      return f[k - 1] * (1 - w) + f[k] * w;
    }
  }
  return f[f.length - 1];
}

export function compareToReference(line, refPoints) {
  let sq = 0;
  let maxAbs = 0;
  let at = null;
  for (const [s, ref] of refPoints) {
    const d = interp(line, s) - ref;
    sq += d * d;
    if (Math.abs(d) > maxAbs) { maxAbs = Math.abs(d); at = s; }
  }
  return { rmse: Math.sqrt(sq / refPoints.length), maxAbs, maxAbsAt: at, n: refPoints.length };
}
