/**
 * dsh-vaspflow host unit tests (Node built-in test runner, zero deps).
 *
 * Covers the Phase 1 verification contract:
 *  - toFloat (D→E)
 *  - OSZICAR ionic energies
 *  - OUTCAR max forces (FORCES line + TOTAL-FORCE fallback)
 *  - CONTCAR lattice (a/b/c + angles)
 *  - scanner task recognition + field contract
 *  - task store identity
 *
 * Run: node --test lib/host/*.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { toFloat, stripIncarComment, quickParseIncar, quickParseOszicarSummary, quickParseContcarLattice, scanSingleDir, scanProject } from './scanner.js';
import { parseIonicEnergies, parseMaxForces, parseConvergence } from './parser.js';
import { getStructure, getStructureScene, parseStructureFile } from './structure.js';
import { TaskStore } from './task-store.js';

test('toFloat converts D→E and d→e', () => {
  assert.equal(toFloat('1.23D+02'), 123);
  assert.equal(toFloat('-4.5d-03'), -0.0045);
  assert.equal(toFloat('0.123E+03'), 123);
});

test('stripIncarComment cuts # and !', () => {
  assert.equal(stripIncarComment('  ENCUT = 400  # cutoff'), 'ENCUT = 400');
  assert.equal(stripIncarComment('  ISPIN = 2  ! spin'), 'ISPIN = 2');
});

test('quickParseIncar handles ; segments and SYSTEM', () => {
  const dir = mkdtempSync(join(tmpdir(), 'vfp-test-'));
  try {
    writeFileSync(join(dir, 'INCAR'), [
      'SYSTEM = test-system ;  ENCUT = 400',
      'ISMEAR = 1  # comment',
      '! full comment line',
    ].join('\n'));
    const { system, summary } = quickParseIncar(join(dir, 'INCAR'));
    assert.equal(system, 'test-system');
    assert.equal(summary.ENCUT, '400');
    assert.equal(summary.ISMEAR, '1');
    assert.equal(summary.SYSTEM, 'test-system');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('quickParseOszicarSummary counts steps and final energy', () => {
  const dir = mkdtempSync(join(tmpdir(), 'vfp-test-'));
  try {
    writeFileSync(join(dir, 'OSZICAR'), [
      'DAV:   1     0.123E+03    -0.123E+03 -0.500E+01',
      'DAV:  12     0.987E+02    -0.124E+03 -0.100E-06',
      '   1 F= -.12345678E+03 E0= -.12345678E+03  d E =-.123E-06  mag= 0.0000',
      '   2 F= -.12345679E+03 E0= -.12345679E+03  d E =-.123E-07  mag= 0.0000',
    ].join('\n'));
    const { nIon, finalEnergy } = quickParseOszicarSummary(join(dir, 'OSZICAR'));
    assert.equal(nIon, 2);
    assert.ok(Math.abs(finalEnergy - -123.45679) < 1e-6);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('parseIonicEnergies extracts per-step F values', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'vfp-test-'));
  try {
    writeFileSync(join(dir, 'OSZICAR'), [
      '   1 F= -.10000000E+03 E0= -.10000000E+03  d E =-.100E-05  mag= 0.0000',
      '   2 F= -.10000010E+03 E0= -.10000010E+03  d E =-.100E-06  mag= 0.0000',
    ].join('\n'));
    const energies = await parseIonicEnergies(join(dir, 'OSZICAR'));
    assert.equal(energies.length, 2);
    assert.ok(Math.abs(energies[0] - -100.0) < 1e-6);
    assert.ok(Math.abs(energies[1] - -100.0001) < 1e-6);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('parseMaxForces prefers FORCES lines', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'vfp-test-'));
  try {
    writeFileSync(join(dir, 'OUTCAR'), [
      '  FORCES: max atom, RMS     0.016939    0.004383',
      '  FORCES: max atom, RMS     0.008312    0.002112',
      '  FORCES: max atom, RMS     0.003021    0.001009',
    ].join('\n'));
    const forces = await parseMaxForces(join(dir, 'OUTCAR'));
    assert.equal(forces.length, 3);
    assert.ok(Math.abs(forces[0] - 0.016939) < 1e-9);
    assert.ok(Math.abs(forces[2] - 0.003021) < 1e-9);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('parseMaxForces falls back to TOTAL-FORCE blocks', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'vfp-test-'));
  try {
    writeFileSync(join(dir, 'OUTCAR'), [
      'TOTAL-FORCE (eV/Angst)',
      '  ---',
      '  1 2 3 0.5 0.0 0.0',
      '  2 2 3 0.0 0.4 0.3',
      '  total drift: 0.000000 0.000000 0.000000',
      'TOTAL-FORCE (eV/Angst)',
      '  ---',
      '  1 2 3 0.1 0.0 0.0',
      '  total drift: 0.000000 0.000000 0.000000',
    ].join('\n'));
    const forces = await parseMaxForces(join(dir, 'OUTCAR'));
    // block 1 max norm = ||0.5,0,0|| = 0.5 ; block 2 = 0.1
    assert.equal(forces.length, 2);
    assert.ok(Math.abs(forces[0] - 0.5) < 1e-9);
    assert.ok(Math.abs(forces[1] - 0.1) < 1e-9);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('parseConvergence aligns forces to energies', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'vfp-test-'));
  try {
    writeFileSync(join(dir, 'OSZICAR'), [
      '   1 F= -.10000000E+03 E0= -.10000000E+03  d E =-.100E-05  mag= 0.0000',
      '   2 F= -.10000010E+03 E0= -.10000010E+03  d E =-.100E-06  mag= 0.0000',
    ].join('\n'));
    writeFileSync(join(dir, 'OUTCAR'), [
      '  FORCES: max atom, RMS     0.016939    0.004383',
      '  FORCES: max atom, RMS     0.008312    0.002112',
    ].join('\n'));
    const result = await parseConvergence(dir);
    assert.equal(result.ion_steps.length, 2);
    assert.deepEqual(result.ion_steps, [1, 2]);
    assert.equal(result.max_forces.length, 2);
    assert.ok(result._source.includes('OSZICAR'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('quickParseContcarLattice computes a/b/c and angles', () => {
  const dir = mkdtempSync(join(tmpdir(), 'vfp-test-'));
  try {
    writeFileSync(join(dir, 'CONTCAR'), [
      'test system',
      '    1.0',
      '      3.0  0.0  0.0',
      '      0.0  3.0  0.0',
      '      0.0  0.0  5.0',
      '   Cu',
      '     1',
      'Direct',
      '  0.0  0.0  0.0',
    ].join('\n'));
    const lattice = quickParseContcarLattice(join(dir, 'CONTCAR'));
    assert.equal(lattice.length, 6);
    assert.ok(Math.abs(lattice[0] - 3.0) < 1e-9);
    assert.ok(Math.abs(lattice[1] - 3.0) < 1e-9);
    assert.ok(Math.abs(lattice[2] - 5.0) < 1e-9);
    assert.ok(Math.abs(lattice[3] - 90.0) < 1e-9);
    assert.ok(Math.abs(lattice[4] - 90.0) < 1e-9);
    assert.ok(Math.abs(lattice[5] - 90.0) < 1e-9);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('getStructure parses species + cartesian coords', () => {
  const dir = mkdtempSync(join(tmpdir(), 'vfp-test-'));
  try {
    writeFileSync(join(dir, 'POSCAR'), [
      'Cu2O',
      '    1.0',
      '      4.27  0.0  0.0',
      '      0.0  4.27  0.0',
      '      0.0  0.0  4.27',
      '   Cu  O',
      '   2  1',
      'Direct',
      '  0.0  0.0  0.0',
      '  0.5  0.5  0.0',
      '  0.25 0.25 0.25',
    ].join('\n'));
    const struct = getStructure(join(dir, 'POSCAR'));
    assert.equal(struct.num_atoms, 3);
    assert.deepEqual(struct.species, ['Cu', 'Cu', 'O']);
    assert.equal(struct.coords.length, 3);
    assert.ok(Math.abs(struct.coords[2][0] - 0.25 * 4.27) < 1e-9);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('getStructureScene builds bonds + families', () => {
  const dir = mkdtempSync(join(tmpdir(), 'vfp-test-'));
  try {
    writeFileSync(join(dir, 'CONTCAR'), [
      'H2',
      '    1.0',
      '      10.0  0.0  0.0',
      '      0.0  10.0  0.0',
      '      0.0  0.0  10.0',
      '   H',
      '   2',
      'Direct',
      '  0.0  0.0  0.0',
      '  0.0  0.0  0.1',
    ].join('\n'));
    const scene = getStructureScene(join(dir, 'CONTCAR'), { includeConnectivity: true, bondAlgorithm: 'minimum-distance' });
    assert.equal(scene.version, 1);
    assert.equal(scene.summary.atom_count, 2);
    // pymatgen reduced_formula of a single-element composition is the element
    // symbol (counts divided by GCD).
    assert.equal(scene.summary.formula, 'H');
    assert.ok(scene.bonds.length >= 1);
    assert.ok(scene.bond_families.some((f) => f.key === 'H|H'));
    assert.equal(scene.cell.lengths.length, 3);
    assert.ok(Math.abs(scene.cell.lengths[0] - 10.0) < 1e-9);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('cross-boundary bond connects to periodic image atoms on BOTH sides', () => {
  const dir = mkdtempSync(join(tmpdir(), 'vfp-boundary-'));
  try {
    // Two H atoms in a 10Å cell at frac x=0.0 and x=0.9: the true bond is 1Å
    // across the boundary. Both sides get their real partner rendered: an
    // image of H(0.9) at x=-1 near H(0), and an image of H(0.0) at x=10 near
    // H(0.9) — never a chord straight across the cell.
    writeFileSync(join(dir, 'CONTCAR'), [
      'H-chain',
      '    1.0',
      '      10.0  0.0  0.0',
      '      0.0  10.0  0.0',
      '      0.0  0.0  10.0',
      '   H',
      '   2',
      'Direct',
      '  0.0  0.0  0.0',
      '  0.9  0.0  0.0',
    ].join('\n'));
    const scene = getStructureScene(join(dir, 'CONTCAR'), { includeConnectivity: true, bondAlgorithm: 'minimum-distance' });
    assert.equal(scene.summary.atom_count, 2, 'summary counts base atoms only');
    const images = scene.atoms.filter((a) => a.is_periodic_image);
    assert.equal(images.length, 2, 'one periodic image per side of the boundary');
    // Image of H(0.9) near H(0.0): frac 0.9 - 1 = -0.1 → x = -1.
    const nearLeft = images.find((a) => a.position[0] < 0);
    assert.ok(nearLeft, 'image on the left side exists');
    assert.ok(Math.abs(nearLeft.position[0] - (-1)) < 1e-6, `left image at x=${nearLeft.position[0]}`);
    // Image of H(0.0) near H(0.9): frac 0.0 + 1 = 1.0 → x = 10.
    const nearRight = images.find((a) => a.position[0] > 9);
    assert.ok(nearRight, 'image on the right side exists');
    assert.ok(Math.abs(nearRight.position[0] - 10) < 1e-6, `right image at x=${nearRight.position[0]}`);
    assert.equal(scene.bonds.length, 2, 'two bonds, one per side');
    for (const bond of scene.bonds) {
      assert.ok(Math.abs(bond.length - 1.0) < 1e-6, `bond length ${bond.length} is the real periodic distance`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('scanSingleDir recognizes VASP task and field contract', () => {
  const root = mkdtempSync(join(tmpdir(), 'vfp-root-'));
  const taskDirPath = join(root, 'relax', 'task1');
  mkdirSync(taskDirPath, { recursive: true });
  try {
    writeFileSync(join(taskDirPath, 'INCAR'), 'SYSTEM = cu-relax\nEDIFFG = -0.02\n');
    writeFileSync(join(taskDirPath, 'OSZICAR'), '   1 F= -.10000000E+03 E0= -.10000000E+03  d E =-.100E-05  mag= 0.0000\n');
    writeFileSync(join(taskDirPath, 'OUTCAR'), 'reached required accuracy\nGeneral timing and accounting\n');
    const task = scanSingleDir(taskDirPath, root);
    assert.ok(task !== null);
    assert.equal(task.is_vasp_task, true);
    assert.equal(task.status, 'finished');
    assert.equal(task.is_converged, true);
    assert.equal(task.system, 'cu-relax');
    assert.equal(task.n_ion_steps, 1);
    assert.equal(task.rel_path.replace(/\\/g, '/'), 'relax/task1');
    assert.equal(task.incar_summary.EDIFFG, '-0.02');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('scanProject returns tasks + directories, skips noise dirs', async () => {
  const root = mkdtempSync(join(tmpdir(), 'vfp-root-'));
  try {
    const taskDirPath = join(root, 'a', 'b');
    mkdirSync(taskDirPath, { recursive: true });
    mkdirSync(join(root, 'node_modules', 'x'), { recursive: true });
    writeFileSync(join(taskDirPath, 'OUTCAR'), 'reached required accuracy\n');
    writeFileSync(join(root, 'node_modules', 'x', 'OUTCAR'), 'x\n');
    const result = await scanProject(root);
    assert.equal(result.tasks.length, 1);
    assert.ok(result.directories.some((d) => d.label === 'b'));
    assert.ok(!result.directories.some((d) => d.label === 'x'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('TaskStore assigns stable ids and root keys are casefolded', () => {
  const store = new TaskStore();
  const root = join(tmpdir(), 'vfp-store');
  mkdirSync(root, { recursive: true });
  try {
    const id = store.addProject(root, [{ rel_path: 't1', label: 't1' }], [{ rel_path: 't1', label: 't1' }]);
    assert.equal(id, 1);
    assert.equal(store.tasks.get(1).label, 't1');
    const id2 = store.addProject(root, [], []);
    assert.equal(id2, 1, 'same root reuses project id');
    assert.equal(store.version, 3);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('parseStructureFile handles Selective dynamics + Cartesian', () => {
  const dir = mkdtempSync(join(tmpdir(), 'vfp-test-'));
  try {
    writeFileSync(join(dir, 'POSCAR'), [
      'sd test',
      '1.0',
      '5.0 0.0 0.0',
      '0.0 5.0 0.0',
      '0.0 0.0 5.0',
      'Al',
      '2',
      'Selective dynamics',
      'Cartesian',
      '0.0 0.0 0.0 F F F',
      '2.5 2.5 2.5 T T T',
    ].join('\n'));
    const struct = parseStructureFile(join(dir, 'POSCAR'));
    assert.equal(struct.numAtoms, 2);
    assert.deepEqual(struct.species, ['Al', 'Al']);
    assert.ok(Math.abs(struct.fracCoords[1][0] - 0.5) < 1e-9);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
