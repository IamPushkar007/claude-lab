// Method: Chorin fractional-step projection on a staggered (MAC) grid.
// Unit square, no-slip walls, top lid moving at speed `lid`. Viscosity nu = lid * L / Re, L = 1.

export function createCavity({ N = 64, Re = 100, lid = 1, dt = null } = {}) {
  const h = 1 / N;
  const nu = (lid * 1) / Re;
  const dtMax = Math.min(0.25 * h * h / nu, h / Math.max(lid, 1e-9));
  const dtUsed = dt ?? 0.5 * dtMax;

  // u: (N+1) x N at vertical faces; v: N x (N+1) at horizontal faces; p: N x N at cell centres.
  const u = new Float64Array((N + 1) * N);
  const v = new Float64Array(N * (N + 1));
  const p = new Float64Array(N * N);
  const us = new Float64Array(u.length);
  const vs = new Float64Array(v.length);
  const rhs = new Float64Array(N * N);

  const U = (i, j) => u[i * N + j];
  const V = (i, j) => v[i * (N + 1) + j];

  // u with tangential ghost cells (j = -1 bottom wall, j = N lid).
  const uG = (i, j) => (j < 0 ? -U(i, 0) : j >= N ? 2 * lid - U(i, N - 1) : U(i, j));
  // v with tangential ghost cells (i = -1 left wall, i = N right wall).
  const vG = (i, j) => (i < 0 ? -V(0, j) : i >= N ? -V(N - 1, j) : V(i, j));

  const state = { t: 0, steps: 0, lastPoissonIters: 0, lastChange: Infinity };

  function step() {
    const dtl = dtUsed;
    us.set(u);
    vs.set(v);

    for (let i = 1; i < N; i++) {
      for (let j = 0; j < N; j++) {
        const uc = U(i, j);
        const vAt = 0.25 * (V(i - 1, j) + V(i, j) + V(i - 1, j + 1) + V(i, j + 1));
        const dudx = (U(i + 1, j) - U(i - 1, j)) / (2 * h);
        const dudy = (uG(i, j + 1) - uG(i, j - 1)) / (2 * h);
        const lap = (U(i + 1, j) + U(i - 1, j) + uG(i, j + 1) + uG(i, j - 1) - 4 * uc) / (h * h);
        us[i * N + j] = uc + dtl * (-(uc * dudx + vAt * dudy) + nu * lap);
      }
    }
    for (let i = 0; i < N; i++) {
      for (let j = 1; j < N; j++) {
        const vc = V(i, j);
        const uAt = 0.25 * (U(i, j - 1) + U(i + 1, j - 1) + U(i, j) + U(i + 1, j));
        const dvdx = (vG(i + 1, j) - vG(i - 1, j)) / (2 * h);
        const dvdy = (V(i, j + 1) - V(i, j - 1)) / (2 * h);
        const lap = (vG(i + 1, j) + vG(i - 1, j) + V(i, j + 1) + V(i, j - 1) - 4 * vc) / (h * h);
        vs[i * (N + 1) + j] = vc + dtl * (-(uAt * dvdx + vc * dvdy) + nu * lap);
      }
    }

    for (let i = 0; i < N; i++) {
      for (let j = 0; j < N; j++) {
        rhs[i * N + j] =
          ((us[(i + 1) * N + j] - us[i * N + j]) + (vs[i * (N + 1) + j + 1] - vs[i * (N + 1) + j])) / (h * dtl);
      }
    }

    // SOR on the pure-Neumann pressure Poisson equation.
    const omega = 1.9;
    let iters = 0;
    for (; iters < 5000; iters++) {
      let maxRes = 0;
      for (let i = 0; i < N; i++) {
        for (let j = 0; j < N; j++) {
          let sum = 0;
          let cnt = 0;
          if (i > 0) { sum += p[(i - 1) * N + j]; cnt++; }
          if (i < N - 1) { sum += p[(i + 1) * N + j]; cnt++; }
          if (j > 0) { sum += p[i * N + j - 1]; cnt++; }
          if (j < N - 1) { sum += p[i * N + j + 1]; cnt++; }
          const k = i * N + j;
          const res = (sum - cnt * p[k]) / (h * h) - rhs[k];
          p[k] += (omega * res * h * h) / cnt;
          const a = Math.abs(res);
          if (a > maxRes) maxRes = a;
        }
      }
      if (maxRes < 1e-6) break;
    }
    state.lastPoissonIters = iters + 1;
    let mean = 0;
    for (let k = 0; k < p.length; k++) mean += p[k];
    mean /= p.length;
    for (let k = 0; k < p.length; k++) p[k] -= mean;

    let change = 0;
    for (let i = 1; i < N; i++) {
      for (let j = 0; j < N; j++) {
        const nu_ = us[i * N + j] - (dtl * (p[i * N + j] - p[(i - 1) * N + j])) / h;
        change = Math.max(change, Math.abs(nu_ - u[i * N + j]));
        u[i * N + j] = nu_;
      }
    }
    for (let i = 0; i < N; i++) {
      for (let j = 1; j < N; j++) {
        const nv = vs[i * (N + 1) + j] - (dtl * (p[i * N + j] - p[i * N + j - 1])) / h;
        change = Math.max(change, Math.abs(nv - v[i * (N + 1) + j]));
        v[i * (N + 1) + j] = nv;
      }
    }
    state.t += dtl;
    state.steps++;
    state.lastChange = change / dtl;
  }

  return { N, h, nu, Re, lid, dt: dtUsed, u, v, p, state, step };
}

export function runToSteadyState(sim, { maxTime = 60, tol = 1e-6 } = {}) {
  while (sim.state.t < maxTime) {
    sim.step();
    if (!Number.isFinite(sim.state.lastChange)) break;
    if (sim.state.lastChange < tol) break;
  }
  return sim;
}
