// Parser for VASP DOSCAR total density-of-states (P1-3, materials). Pure text,
// offline. DOSCAR layout: 5 header lines, then a control line
// `Emax Emin NEDOS Efermi weight`, then NEDOS total-DOS rows. A row is
//   E  tdos  itdos                      (non-spin, 3 columns)
//   E  tdos↑ tdos↓  itdos↑ itdos↓       (spin-polarized, 5 columns)
// Per-atom projected blocks may follow; we read only the total DOS.

export interface DosData {
  efermi: number;
  nedos: number;
  spin: boolean;
  energies: number[];
  /** Total DOS (spin up, or the single channel when non-spin-polarized). */
  up: number[];
  /** Spin-down DOS when spin-polarized. */
  down?: number[];
}

function nums(line: string): number[] {
  return line
    .trim()
    .split(/\s+/)
    .map((t) => Number(t))
    .filter((n) => Number.isFinite(n));
}

export function parseDoscar(text: string): DosData {
  const lines = text.split(/\r?\n/);
  if (lines.length < 7) throw new Error("not a DOSCAR (too few lines)");
  const control = nums(lines[5]);
  if (control.length < 4) throw new Error("DOSCAR control line malformed");
  const nedos = Math.round(control[2]);
  const efermi = control[3];
  if (!Number.isFinite(nedos) || nedos <= 0) throw new Error("DOSCAR NEDOS invalid");

  const energies: number[] = [];
  const up: number[] = [];
  const down: number[] = [];
  let spin = false;
  for (let i = 0; i < nedos; i++) {
    const row = nums(lines[6 + i] ?? "");
    if (row.length < 3) break; // ran out of TDOS rows
    energies.push(row[0]);
    if (row.length >= 5) {
      spin = true;
      up.push(row[1]);
      down.push(row[2]);
    } else {
      up.push(row[1]);
    }
  }
  if (energies.length === 0) throw new Error("DOSCAR has no DOS rows");
  return {
    efermi,
    nedos: energies.length,
    spin,
    energies,
    up,
    down: spin ? down : undefined,
  };
}
