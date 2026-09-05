/**
 * dsh-vaspflow host: convergence parser — Node port of backend/parser.py.
 *
 * @module dsh-vaspflow/host/parser
 */
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { statSync } from 'node:fs';
import { join } from './paths.js';

/** Fortran double format: 1.23D+02 → 1.23E+02 */
function toFloat(s) {
  return Number(s.replace(/D/g, 'E').replace(/d/g, 'e'));
}

const OSZICAR_IONIC_PATTERN = /^\s+\d+\s+F=\s*([\d.\-+EDed]+)/;

/** Extract one free energy F per ionic step from OSZICAR (streamed). */
export async function parseIonicEnergies(oszicarPath) {
  const energies = [];
  try {
    const lineStream = createInterface({
      input: createReadStream(oszicarPath, { encoding: 'utf-8' }),
      crlfDelay: Infinity,
    });
    for await (const line of lineStream) {
      const m = OSZICAR_IONIC_PATTERN.exec(line);
      if (m) energies.push(toFloat(m[1]));
    }
  } catch (error) {
    console.warn(`OSZICAR parse failed (${oszicarPath}): ${error}`);
  }
  return energies;
}

const FORCE_LINE_PATTERN = /FORCES:\s+max atom,\s+RMS\s+([\d.\-+EDed]+)/i;

/**
 * Stream-extract max force per ionic step from OUTCAR. Prefers VASP's
 * "FORCES: max atom, RMS" lines; falls back to TOTAL-FORCE blocks (max ||F||
 * per block, ended by "total drift").
 */
export async function parseMaxForces(outcarPath) {
  const maxForces = [];
  const totalForceBlocks = [];
  let inTotalForceBlock = false;
  let currentBlockMax = 0.0;
  let currentBlockHasForce = false;

  try {
    const lineStream = createInterface({
      input: createReadStream(outcarPath, { encoding: 'utf-8' }),
      crlfDelay: Infinity,
    });
    for await (const line of lineStream) {
      const match = FORCE_LINE_PATTERN.exec(line);
      if (match) {
        maxForces.push(toFloat(match[1]));
        continue;
      }

      const upper = line.toUpperCase();
      if (upper.includes('TOTAL-FORCE') && upper.includes('(EV/ANGST')) {
        inTotalForceBlock = true;
        currentBlockMax = 0.0;
        currentBlockHasForce = false;
        continue;
      }

      if (!inTotalForceBlock) continue;

      const stripped = line.trim();
      if (!stripped || stripped.startsWith('---')) continue;
      if (stripped.toLowerCase().includes('total drift')) {
        if (currentBlockHasForce) totalForceBlocks.push(currentBlockMax);
        inTotalForceBlock = false;
        continue;
      }

      const parts = stripped.split(/\s+/);
      if (parts.length < 6) continue;
      let fx;
      let fy;
      let fz;
      try {
        fx = toFloat(parts[3]);
        fy = toFloat(parts[4]);
        fz = toFloat(parts[5]);
      } catch {
        continue;
      }
      currentBlockHasForce = true;
      const norm = Math.sqrt(fx * fx + fy * fy + fz * fz);
      currentBlockMax = Math.max(currentBlockMax, norm);
    }
  } catch (error) {
    console.warn(`OUTCAR force parse failed (${outcarPath}): ${error}`);
  }

  if (maxForces.length > 0) return maxForces;
  return totalForceBlocks;
}

/**
 * Parse convergence data (energies + max forces), aligned like the Python
 * original. Returns {ion_steps, energies, max_forces, _source?}.
 */
export async function parseConvergence(taskDir) {
  const oszicarPath = join(taskDir, 'OSZICAR');
  const outcarPath = join(taskDir, 'OUTCAR');

  let energies = [];
  if (fileExists(oszicarPath)) energies = await parseIonicEnergies(oszicarPath);

  let maxForces = [];
  if (fileExists(outcarPath)) maxForces = await parseMaxForces(outcarPath);

  let n = energies.length;

  if (n === 0 && maxForces.length > 0) {
    n = maxForces.length;
    energies = new Array(n).fill(0.0);
    console.warn(`no OSZICAR energies, fell back to force-block count (${n} steps), energies all 0`);
  } else if (n > 0 && maxForces.length >= n) {
    maxForces = maxForces.slice(-n);
  } else if (n > 0 && maxForces.length < n) {
    console.warn(`force blocks (${maxForces.length}) < energy steps (${n}), padded`);
    while (maxForces.length < n) {
      maxForces.push(maxForces.length > 0 ? maxForces[maxForces.length - 1] : 0.0);
    }
  }

  if (n === 0) {
    return { ion_steps: [], energies: [], max_forces: [], error: '未找到 OSZICAR 或 OUTCAR' };
  }

  const ionSteps = Array.from({ length: n }, (_, i) => i + 1);
  const hasRealEnergy = energies.some((e) => e !== 0.0);
  return {
    ion_steps: ionSteps,
    energies,
    max_forces: maxForces,
    _source: hasRealEnergy ? `OSZICAR (${n} steps)` : `OUTCAR (${n} force blocks)`,
  };
}

/** Same step count used by the convergence chart, with final energy. */
export async function parseConvergenceSummary(taskDir) {
  const result = await parseConvergence(taskDir);
  const steps = result.ion_steps ?? [];
  const energies = result.energies ?? [];
  let finalEnergy = null;
  for (let i = energies.length - 1; i >= 0; i -= 1) {
    if (energies[i] !== 0.0) {
      finalEnergy = energies[i];
      break;
    }
  }
  return {
    n_ion_steps: steps.length,
    final_energy: finalEnergy,
    source: result._source ?? '',
  };
}

function fileExists(p) {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
}
