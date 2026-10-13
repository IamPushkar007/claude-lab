import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createCavity, runToSteadyState } from '../src/cavity-mac.js';
import * as M from '../src/measure.js';

const root = new URL('..', import.meta.url);
const read = (p) => JSON.parse(readFileSync(new URL(p, root), 'utf8'));

export function runExperiment(manifest, ref) {
  const sim = createCavity({ N: 64, Re: manifest.conditions.Re, lid: manifest.conditions.lid_speed });
  const t0 = performance.now();
  runToSteadyState(sim, { maxTime: 60, tol: 1e-6 });
  const seconds = (performance.now() - t0) / 1000;

  const a = manifest.acceptance;
  const u = M.compareToReference(M.uCenterline(sim), ref.u_on_vertical_centerline_x_0_5);
  const v = M.compareToReference(M.vCenterline(sim), ref.v_on_horizontal_centerline_y_0_5);
  const checks = {
    finite: M.allFinite(sim),
    converged: sim.state.lastChange < 1e-6,
    maxDivergence: M.maxDivergence(sim),
    boundaryFlux: M.boundaryFlux(sim),
    maxSpeed: M.maxSpeed(sim),
  };
  const pass = {
    finite: checks.finite,
    converged: checks.converged,
    mass: checks.maxDivergence <= a.max_cell_divergence && Math.abs(checks.boundaryFlux) <= a.max_boundary_flux,
    stable: checks.maxSpeed <= a.max_speed_bound * sim.lid,
    u_matches_reference: u.maxAbs <= a.u_centerline_max_abs_error,
    v_matches_reference: v.maxAbs <= a.v_centerline_max_abs_error,
  };
  const referenceVerified = !/^UNVERIFIED/.test(ref.verification_status);
  const status = !Object.values(pass).every(Boolean)
    ? 'FAILED'
    : referenceVerified ? 'MATCHES_REFERENCE' : 'MATCHES_UNVERIFIED_REFERENCE';

  return {
    id: manifest.id,
    status,
    referenceVerified,
    steps: sim.state.steps,
    simulatedTime: sim.state.t,
    finalChangeRate: sim.state.lastChange,
    wallSeconds: seconds,
    differenceFromReference: { u, v },
    checks,
    pass,
    openItems: manifest.open_items,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const manifest = read('experiments/ghia-cavity-re100.json');
  const ref = read('data/ghia1982_re100.json');
  const result = runExperiment(manifest, ref);
  mkdirSync(new URL('results/', root), { recursive: true });
  writeFileSync(new URL(`results/${manifest.id}.json`, root), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.status === 'FAILED' ? 1 : 0);
}
