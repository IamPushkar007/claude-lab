import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createCavity, runToSteadyState } from '../src/cavity-mac.js';
import * as M from '../src/measure.js';
import { runExperiment } from '../scripts/reproduce.js';

const read = (p) => JSON.parse(readFileSync(new URL(`../${p}`, import.meta.url), 'utf8'));

test('measurement tools: interpolation and comparison', () => {
  const line = { s: [0, 0.5, 1], f: [0, 1, 0] };
  assert.equal(M.interp(line, 0.25), 0.5);
  const c = M.compareToReference(line, [[0.25, 0.5], [0.75, 0.4]]);
  assert.ok(Math.abs(c.maxAbs - 0.1) < 1e-12);
});

test('projection keeps the field divergence-free and mass-conserving', () => {
  const sim = createCavity({ N: 32, Re: 100 });
  for (let k = 0; k < 300; k++) sim.step();
  assert.ok(M.allFinite(sim));
  assert.ok(M.maxDivergence(sim) < 1e-6, `divergence ${M.maxDivergence(sim)}`);
  assert.equal(M.boundaryFlux(sim), 0);
});

test('reviewer check catches an unstable run (dt far above the stability limit)', () => {
  const ok = createCavity({ N: 32, Re: 100 });
  const bad = createCavity({ N: 32, Re: 100, dt: 20 * ok.dt });
  for (let k = 0; k < 400; k++) bad.step();
  const stable = M.allFinite(bad) && M.maxSpeed(bad) <= 1.5;
  assert.equal(stable, false);
});

test('reviewer check rejects a wrong answer (reference shifted by 0.05)', () => {
  const ref = read('data/ghia1982_re100.json');
  const sim = createCavity({ N: 32, Re: 100 });
  runToSteadyState(sim, { maxTime: 8 });
  const wrong = ref.u_on_vertical_centerline_x_0_5.map(([y, u]) => [y, u + 0.05]);
  const tol = read('experiments/ghia-cavity-re100.json').acceptance.u_centerline_max_abs_error;
  assert.ok(M.compareToReference(M.uCenterline(sim), wrong).maxAbs > tol);
});

test('Ghia Re=100 experiment reproduces within the stated tolerances (about 40 s)', { timeout: 300000 }, () => {
  const result = runExperiment(read('experiments/ghia-cavity-re100.json'), read('data/ghia1982_re100.json'));
  assert.notEqual(result.status, 'FAILED', JSON.stringify(result.pass));
  assert.equal(result.referenceVerified, false, 'status must stay UNVERIFIED until the reference is page-checked');
});
