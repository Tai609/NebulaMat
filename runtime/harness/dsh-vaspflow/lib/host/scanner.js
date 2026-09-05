/**
 * dsh-vaspflow host: project scanner — Node port of backend/scanner.py.
 *
 * Data contract (JSON fields) is kept field-for-field identical to the Python
 * original so the migrated UI and the vasp_* tools see the same data.
 *
 * @module dsh-vaspflow/host/scanner
 */
import { promises as fsp, openSync, readSync, statSync, opendirSync, closeSync, readFileSync } from 'node:fs';
import { basename, join, normpath, realpath, relpath, sep } from './paths.js';

export const SKIP_DIR_NAMES = new Set([
  'node_modules', '.git', '__pycache__', '.vscode', 'dist', '.vite', '.venv', 'venv',
]);
const SCAN_METADATA_FILES = ['INCAR', 'OSZICAR', 'OUTCAR', 'CONTCAR', 'vasprun.xml'];

/** Per-root task metadata cache: root -> rel -> {signature, task}. */
const taskMetadataCache = new Map();

/** Fortran double format: 1.23D+02 → 1.23E+02 */
export function toFloat(value) {
  return Number(value.replace(/D/g, 'E').replace(/d/g, 'e'));
}

/** Strip INCAR comments (# and !) and trim. */
export function stripIncarComment(line) {
  for (const marker of ['#', '!']) {
    const idx = line.indexOf(marker);
    if (idx >= 0) line = line.slice(0, idx);
  }
  return line.trim();
}

/** Parse INCAR into {system, summary: {KEY: value}}. */
export function quickParseIncar(incarPath) {
  const summary = {};
  let system = 'unknown';
  try {
    const text = readText(incarPath);
    for (const rawLine of text.split(/\r?\n/)) {
      for (const segment of rawLine.split(';')) {
        const line = stripIncarComment(segment);
        const eq = line.indexOf('=');
        if (eq < 0) continue;
        const key = line.slice(0, eq).trim().toUpperCase();
        const value = line.slice(eq + 1).trim();
        if (!key) continue;
        summary[key] = value;
        if (key === 'SYSTEM' && value) system = value;
      }
    }
  } catch {
    // unreadable INCAR: keep defaults
  }
  return { system, summary };
}

const OSZICAR_SUMMARY_PATTERN = /^\s+\d+\s+F=\s*([\d.\-+EDed]+)/;

/** Count ionic steps and return the final free energy from OSZICAR. */
export function quickParseOszicarSummary(oszicarPath) {
  let nIon = 0;
  let finalEnergy = null;
  try {
    const text = readText(oszicarPath);
    for (const line of text.split(/\r?\n/)) {
      const m = OSZICAR_SUMMARY_PATTERN.exec(line);
      if (!m) continue;
      nIon += 1;
      finalEnergy = toFloat(m[1]);
    }
  } catch {
    // ignore
  }
  return { nIon, finalEnergy };
}

/**
 * Read only the tail of OUTCAR (last 64KB, binary-safe) and judge
 * finished / converged / EDIFF-failure.
 */
export function quickParseOutcarTail(outcarPath, tailLines = 200) {
  const result = { isFinished: false, isConverged: false, errorMsg: '' };
  let raw;
  try {
    const fileSize = statSync(outcarPath).size;
    const chunkSize = Math.min(fileSize, 65536);
    const fd = openSync(outcarPath, 'r');
    try {
      const buf = Buffer.alloc(chunkSize);
      if (fileSize > chunkSize) readSync(fd, buf, 0, chunkSize, fileSize - chunkSize);
      else readSync(fd, buf, 0, chunkSize, 0);
      raw = buf.toString('utf-8');
    } finally {
      closeSync(fd);
    }
  } catch {
    return result;
  }
  const tailText = raw.split('\n').slice(-tailLines).join('\n');
  if (tailText.includes('General timing and accounting')) result.isFinished = true;
  if (/reached required accuracy/i.test(tailText)) result.isConverged = true;
  else if (/aborting loop because EDIFF/i.test(tailText)) result.errorMsg = 'EDIFF convergence failure';
  return result;
}

function vectorLength(v) {
  return Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
}

function vectorAngle(left, right) {
  const lLen = vectorLength(left);
  const rLen = vectorLength(right);
  if (lLen === 0 || rLen === 0) return 0.0;
  let cosine = (left[0] * right[0] + left[1] * right[1] + left[2] * right[2]) / (lLen * rLen);
  cosine = Math.max(-1.0, Math.min(1.0, cosine));
  return (Math.acos(cosine) * 180) / Math.PI;
}

/** Parse CONTCAR/POSCAR lattice → [a, b, c, alpha, beta, gamma]. */
export function quickParseContcarLattice(contcarPath) {
  try {
    const lines = readText(contcarPath).split(/\r?\n/);
    const scale = toFloat(lines[1].trim().split(/\s+/)[0]);
    const vectors = [];
    for (let index = 2; index < 5; index += 1) {
      const parts = lines[index].trim().split(/\s+/).slice(0, 3).map(toFloat);
      vectors.push(parts.map((value) => value * scale));
    }
    const lengths = vectors.map(vectorLength);
    const angles = [
      vectorAngle(vectors[1], vectors[2]),
      vectorAngle(vectors[0], vectors[2]),
      vectorAngle(vectors[0], vectors[1]),
    ];
    return lengths.concat(angles);
  } catch {
    return null;
  }
}

/** Metadata signature: (name, size, mtimeNs) per scan-relevant file. */
function metadataSignature(dirpath) {
  const signature = [];
  for (const name of SCAN_METADATA_FILES) {
    try {
      const st = statSync(join(dirpath, name));
      signature.push([name, st.size, st.mtimeNs]);
    } catch {
      signature.push(null);
    }
  }
  return signature;
}

/**
 * Scan one directory as a VASP task. Returns task metadata or null when the
 * directory is not a VASP task (no OUTCAR / vasprun.xml).
 */
export function scanSingleDir(dirpath, rootPath, filenames) {
  const names = filenames ?? readDirNames(dirpath);
  const hasXml = names.has('vasprun.xml');
  const hasOutcar = names.has('OUTCAR');
  if (!hasXml && !hasOutcar) return null;

  const rel = relpath(dirpath, rootPath);
  const label = basename(dirpath) || rel;
  const cacheKey = realpath(rootPath) + '\u0000' + rel;
  const signature = metadataSignature(dirpath);
  const cached = taskMetadataCache.get(cacheKey);
  if (cached && signatureEqual(cached.signature, signature)) {
    return structuredClone(cached.task);
  }

  let system = 'unknown';
  let incarSummary = {};
  if (names.has('INCAR')) {
    ({ system, summary: incarSummary } = quickParseIncar(join(dirpath, 'INCAR')));
  }

  let nIon = 0;
  let finalEnergy = null;
  if (names.has('OSZICAR')) {
    ({ nIon, finalEnergy } = quickParseOszicarSummary(join(dirpath, 'OSZICAR')));
  }

  let isFinished = false;
  let isConverged = false;
  let errorMsg = '';
  if (hasOutcar) {
    const tail = quickParseOutcarTail(join(dirpath, 'OUTCAR'));
    isFinished = tail.isFinished;
    isConverged = tail.isConverged;
    errorMsg = tail.errorMsg;
  }

  let latticeConsts = null;
  if (names.has('CONTCAR')) {
    latticeConsts = quickParseContcarLattice(join(dirpath, 'CONTCAR'));
  }

  const status = isFinished ? 'finished' : errorMsg ? 'error' : 'unknown';

  const task = {
    rel_path: rel,
    label,
    system,
    status,
    is_converged: isConverged,
    n_ion_steps: nIon,
    final_energy: finalEnergy,
    final_max_force: null,
    magmom_total: null,
    lattice_consts: latticeConsts,
    incar_summary: incarSummary,
    error_message: errorMsg,
    is_vasp_task: true,
  };
  taskMetadataCache.set(cacheKey, { signature, task: structuredClone(task) });
  return task;
}

/**
 * Scan a project tree (iterative DFS, skipping noise dirs). Returns
 * {tasks, directories} exactly like scanner.scan_project.
 */
export async function scanProject(rootPath) {
  const tasks = [];
  const directories = [];
  const visited = new Set();
  const stack = [rootPath];
  while (stack.length > 0) {
    const dirpath = stack.pop();
    const key = realpath(dirpath).toLowerCase();
    if (visited.has(key)) continue;
    visited.add(key);
    if (shouldSkipDir(dirpath)) continue;

    let entries;
    try {
      entries = await fsp.readdir(dirpath, { withFileTypes: true });
    } catch {
      continue;
    }
    const filenames = new Set();
    const childDirs = [];
    for (const entry of entries) {
      if (entry.isFile()) filenames.add(entry.name);
      else if (entry.isDirectory() && !SKIP_DIR_NAMES.has(entry.name.toLowerCase())) {
        childDirs.push(join(dirpath, entry.name));
      }
    }

    const rel = relpath(dirpath, rootPath);
    if (rel !== '.') {
      directories.push({ rel_path: rel, label: basename(dirpath) });
    }

    const task = scanSingleDir(dirpath, rootPath, filenames);
    if (task) tasks.push(task);

    // reversed sorted push keeps traversal order stable (mirrors Python)
    childDirs.sort();
    for (let i = childDirs.length - 1; i >= 0; i -= 1) stack.push(childDirs[i]);
  }
  return { tasks, directories };
}

// ---- internal helpers ------------------------------------------------------

function shouldSkipDir(dirpath) {
  const parts = normpath(dirpath).split(sep).map((p) => p.toLowerCase());
  return parts.some((part) => SKIP_DIR_NAMES.has(part));
}

function readDirNames(dirpath) {
  try {
    const names = new Set();
    const dir = opendirSync(dirpath);
    try {
      let entry;
      while ((entry = dir.readSync()) !== null) names.add(entry.name);
    } finally {
      dir.closeSync();
    }
    return names;
  } catch {
    return new Set();
  }
}

function readText(path) {
  return readFileSync(path, 'utf-8');
}

function signatureEqual(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] === null || b[i] === null) {
      if (a[i] !== b[i]) return false;
    } else if (a[i][0] !== b[i][0] || a[i][1] !== b[i][1] || a[i][2] !== b[i][2]) {
      return false;
    }
  }
  return true;
}
