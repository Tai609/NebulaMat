import { describe, expect, it } from "vitest";
import {
  defaultStyleMode,
  isSmilesFile,
  looksLikeMacromolecule,
  moleculeFormatFor,
  smilesToMolblock,
} from "./molecule";

describe("moleculeFormatFor", () => {
  it("maps chemical extensions to their 3Dmol format", () => {
    expect(moleculeFormatFor("ligand.mol")).toBe("sdf");
    expect(moleculeFormatFor("lib.sdf")).toBe("sdf");
    expect(moleculeFormatFor("complex.mol2")).toBe("mol2");
    expect(moleculeFormatFor("1abc.pdb")).toBe("pdb");
    expect(moleculeFormatFor("crystal.cif")).toBe("cif");
    expect(moleculeFormatFor("struct.mmcif")).toBe("cif");
    expect(moleculeFormatFor("cluster.xyz")).toBe("xyz");
    expect(moleculeFormatFor("mols.smi")).toBe("sdf");
  });

  it("returns null for non-molecule files", () => {
    expect(moleculeFormatFor("report.md")).toBeNull();
    expect(moleculeFormatFor("noext")).toBeNull();
  });
});

describe("isSmilesFile", () => {
  it("flags only the coordinate-free SMILES extensions", () => {
    expect(isSmilesFile("a.smi")).toBe(true);
    expect(isSmilesFile("a.smiles")).toBe(true);
    expect(isSmilesFile("a.sdf")).toBe(false);
    expect(isSmilesFile("a.pdb")).toBe(false);
  });
});

describe("looksLikeMacromolecule", () => {
  it("detects secondary-structure records", () => {
    expect(looksLikeMacromolecule("HELIX    1  AA1 ...\n")).toBe(true);
    expect(looksLikeMacromolecule("SHEET    1 ...\n")).toBe(true);
  });

  it("detects many alpha carbons", () => {
    const atoms = Array.from({ length: 25 }, (_, i) => `ATOM  ${i} CA  ALA`).join("\n");
    expect(looksLikeMacromolecule(atoms)).toBe(true);
  });

  it("treats a small molecule as not macromolecular", () => {
    expect(looksLikeMacromolecule("ATOM  1  C   LIG\nATOM  2  O   LIG")).toBe(false);
  });
});

describe("defaultStyleMode", () => {
  it("opens a protein PDB in cartoon", () => {
    const pdb = Array.from({ length: 25 }, (_, i) => `ATOM  ${i} CA  ALA`).join("\n");
    expect(defaultStyleMode("1abc.pdb", pdb)).toBe("cartoon");
  });

  it("opens a small molecule in stick", () => {
    expect(defaultStyleMode("ligand.mol", "small")).toBe("stick");
    // A small-molecule format never defaults to cartoon even if content is odd.
    expect(defaultStyleMode("x.sdf", "HELIX ")).toBe("stick");
  });
});

describe("smilesToMolblock", () => {
  it("converts SMILES lines to a coordinate-bearing SDF", async () => {
    const sdf = await smilesToMolblock("# comment\nCCO ethanol\nc1ccccc1 benzene\n");
    expect(sdf).not.toBeNull();
    // Two records separated by the SDF delimiter, each named from the line.
    expect(sdf!.match(/\$\$\$\$/g)).toHaveLength(2);
    expect(sdf!.startsWith("ethanol\n")).toBe(true);
    expect(sdf).toContain("\nbenzene\n");
    // Real coordinates were generated (not all-zero), so 3D rendering works.
    expect(sdf).toMatch(/-?\d+\.\d{3,}/);
  });

  it("returns null when nothing parses", async () => {
    expect(await smilesToMolblock("   \n# only a comment\n")).toBeNull();
  });
});
