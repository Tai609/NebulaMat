// Chemical-structure helpers (P1-3). Pure and WebGL-free so they unit-test in
// jsdom; the interactive 3D depiction happens in MoleculeView via 3Dmol.js.

/** 3Dmol.js render styles the viewer exposes. */
export type MoleculeStyleMode = "stick" | "sphere" | "cartoon";

/** File extension → the format string 3Dmol.js expects in `addModel`. */
const MOLECULE_FORMATS: Record<string, string> = {
  cif: "cif",
  cube: "cube",
  mcif: "cif",
  mmcif: "cif",
  mol: "sdf",
  mol2: "mol2",
  pdb: "pdb",
  pqr: "pqr",
  sdf: "sdf",
  xyz: "xyz",
  // SMILES has no coordinates; it is converted to a molblock first (see
  // smilesToMolblock) and then handed to 3Dmol as an "sdf" model.
  smi: "sdf",
  smiles: "sdf",
};

/** Extensions with no 3D coordinates — a molblock must be generated first. */
const SMILES_EXTS = new Set(["smi", "smiles"]);

function extOf(filename: string): string {
  const dot = filename.lastIndexOf(".");
  return dot >= 0 ? filename.slice(dot + 1).toLowerCase() : "";
}

/** The 3Dmol format for a file, or null when it is not a molecule file. */
export function moleculeFormatFor(filename: string): string | null {
  return MOLECULE_FORMATS[extOf(filename)] ?? null;
}

export function isSmilesFile(filename: string): boolean {
  return SMILES_EXTS.has(extOf(filename));
}

/**
 * Heuristic: does this look like a macromolecule (protein / large complex)
 * rather than a small molecule? Secondary-structure records or many atoms /
 * alpha carbons imply a cartoon depiction reads better than sticks.
 */
export function looksLikeMacromolecule(content: string): boolean {
  if (/^(HELIX|SHEET)\s/m.test(content)) return true;
  const atoms = content.match(/^ATOM\s+/gm)?.length ?? 0;
  const alphaCarbons = content.match(/^ATOM\s+\d+\s+CA\s+/gm)?.length ?? 0;
  return atoms > 120 || alphaCarbons > 20;
}

/** The style to open a file with: cartoon for macromolecules, else sticks. */
export function defaultStyleMode(filename: string, content: string): MoleculeStyleMode {
  const macromoleculeExt = ["cif", "mcif", "mmcif", "pdb", "pqr"].includes(extOf(filename));
  return macromoleculeExt && looksLikeMacromolecule(content) ? "cartoon" : "stick";
}

/**
 * Convert a `.smi` / `.smiles` file (one `<SMILES> [name]` per line, `#`
 * comments skipped) into a single SDF string with 2D coordinates, so the same
 * 3D viewer can render it. Returns null if no line parses. openchemlib is
 * loaded lazily to keep it out of the main bundle.
 */
export async function smilesToMolblock(text: string): Promise<string | null> {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"));
  if (lines.length === 0) return null;

  const OCL = await import("openchemlib");
  const records: string[] = [];
  for (const line of lines) {
    const [smiles, ...rest] = line.split(/\s+/);
    try {
      const mol = OCL.Molecule.fromSmiles(smiles);
      if (mol.getAllAtoms() === 0) continue;
      mol.inventCoordinates(); // ensure a laid-out 2D depiction
      const name = rest.join(" ") || `Structure ${records.length + 1}`;
      // A molfile's first line is its title; the rest is the connection table.
      const molfile = mol.toMolfile().split(/\r?\n/);
      molfile[0] = name;
      records.push(molfile.join("\n"));
    } catch {
      // Skip an unparseable SMILES line rather than failing the whole file.
    }
  }
  if (records.length === 0) return null;
  return `${records.join("\n$$$$\n")}\n$$$$\n`;
}
