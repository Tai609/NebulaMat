// Parser for VASP EIGENVAL band-structure files (P1-3, materials). Pure text,
// offline. Layout: 5 header lines, then a line `NELECT NKPTS NBANDS`, then one
// block per k-point — a blank line, a `kx ky kz weight` line, then NBANDS lines
// `bandIndex energy [energyDown] [occ…]`. The viewer plots each band's energy
// across the k-point path.

export interface BandData {
  nkpts: number;
  nbands: number;
  spin: boolean;
  /** kpoints[i] = [kx, ky, kz]. */
  kpoints: [number, number, number][];
  /** bands[b][k] = energy of band b at k-point k (spin-up channel). */
  bands: number[][];
  /** Spin-down energies when spin-polarized. */
  bandsDown?: number[][];
  eMin: number;
  eMax: number;
}

function nums(line: string): number[] {
  return line
    .trim()
    .split(/\s+/)
    .map(Number)
    .filter((n) => Number.isFinite(n));
}

export function parseEigenval(text: string): BandData {
  const lines = text.split(/\r?\n/);
  if (lines.length < 7) throw new Error("not an EIGENVAL (too few lines)");
  const control = nums(lines[5]);
  if (control.length < 3) throw new Error("EIGENVAL control line malformed");
  const nkpts = Math.round(control[1]);
  const nbands = Math.round(control[2]);
  if (nkpts <= 0 || nbands <= 0) throw new Error("EIGENVAL NKPTS/NBANDS invalid");

  const kpoints: [number, number, number][] = [];
  const bands: number[][] = Array.from({ length: nbands }, () => []);
  const bandsDown: number[][] = Array.from({ length: nbands }, () => []);
  let spin = false;
  let eMin = Infinity;
  let eMax = -Infinity;

  // Walk the data region, skipping blank lines; read NKPTS blocks.
  let i = 6;
  const nextNonEmpty = () => {
    while (i < lines.length && lines[i].trim() === "") i++;
    return i < lines.length ? lines[i++] : null;
  };

  for (let k = 0; k < nkpts; k++) {
    const kline = nextNonEmpty();
    if (kline === null) break;
    const kv = nums(kline);
    kpoints.push([kv[0] ?? 0, kv[1] ?? 0, kv[2] ?? 0]);
    for (let b = 0; b < nbands; b++) {
      const bline = nextNonEmpty();
      if (bline === null) break;
      const bv = nums(bline);
      // bv[0] is the band index; energies follow. Spin-polarized files carry two
      // energy columns before the occupations.
      const up = bv[1];
      const hasDown = bv.length >= 5; // idx, Eup, Edown, occUp, occDown
      if (hasDown) spin = true;
      bands[b].push(up);
      if (hasDown) bandsDown[b].push(bv[2]);
      const vals = hasDown ? [up, bv[2]] : [up];
      for (const v of vals) {
        if (Number.isFinite(v)) {
          if (v < eMin) eMin = v;
          if (v > eMax) eMax = v;
        }
      }
    }
  }
  if (kpoints.length === 0) throw new Error("EIGENVAL has no k-points");
  if (!Number.isFinite(eMin)) {
    eMin = 0;
    eMax = 1;
  }
  return {
    nkpts: kpoints.length,
    nbands,
    spin,
    kpoints,
    bands,
    bandsDown: spin ? bandsDown : undefined,
    eMin,
    eMax,
  };
}
