#!/usr/bin/env python3
# /// script
# requires-python = ">=3.10"
# dependencies = ["rdkit"]
# ///
"""SMILES -> 3D structure with charge/multiplicity report.

Usage:
    uv run smiles_to_xyz.py "SMILES" out.xyz [--confs N] [--seed 42]

Run with `uv run` so the dependency above resolves into an isolated, cached
environment (no global install needed). Embeds with ETKDGv3, optimizes with
MMFF94 (UFF fallback), writes the lowest-energy conformer, and prints formula,
formal charge, and the multiplicity implied by radical electron count.
"""
import argparse
import sys


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("smiles")
    p.add_argument("out")
    p.add_argument("--confs", type=int, default=1, help="conformers to embed (keeps lowest-E)")
    p.add_argument("--seed", type=int, default=42)
    args = p.parse_args()

    try:
        from rdkit import Chem
        from rdkit.Chem import AllChem, Descriptors, rdMolDescriptors
    except ImportError:
        sys.exit("rdkit is required: run via `uv run smiles_to_xyz.py ...` (or pip install rdkit)")

    mol = Chem.MolFromSmiles(args.smiles)
    if mol is None:
        sys.exit("could not parse SMILES")

    frags = Chem.GetMolFrags(mol)
    if len(frags) > 1:
        print(f"WARNING: {len(frags)} fragments (salt/mixture?) - keeping all; "
              "strip explicitly if a single component is intended")

    mol = Chem.AddHs(mol)
    params = AllChem.ETKDGv3()
    params.randomSeed = args.seed
    cids = AllChem.EmbedMultipleConfs(mol, numConfs=args.confs, params=params)
    if not cids:
        sys.exit("3D embedding failed")

    energies = []
    for cid in cids:
        if AllChem.MMFFHasAllMoleculeParams(mol):
            ff = AllChem.MMFFGetMoleculeForceField(
                mol, AllChem.MMFFGetMoleculeProperties(mol), confId=cid)
            tag = "MMFF94"
        else:
            ff = AllChem.UFFGetMoleculeForceField(mol, confId=cid)
            tag = "UFF"
        ff.Minimize(maxIts=2000)
        energies.append((ff.CalcEnergy(), cid))
    energies.sort()
    best = energies[0][1]

    conf = mol.GetConformer(best)
    with open(args.out, "w") as f:
        f.write(f"{mol.GetNumAtoms()}\n{args.smiles} ({tag}-optimized)\n")
        for atom in mol.GetAtoms():
            pos = conf.GetAtomPosition(atom.GetIdx())
            f.write(f"{atom.GetSymbol():2s} {pos.x:12.6f} {pos.y:12.6f} {pos.z:12.6f}\n")

    charge = Chem.GetFormalCharge(mol)
    radicals = sum(a.GetNumRadicalElectrons() for a in mol.GetAtoms())
    print(f"wrote {args.out}")
    print(f"formula:      {rdMolDescriptors.CalcMolFormula(mol)}")
    print(f"MW:           {Descriptors.MolWt(mol):.2f}")
    print(f"charge:       {charge}")
    print(f"multiplicity: {radicals + 1} (from {radicals} radical electron(s); "
          "verify for TM complexes / open-shell species)")
    if len(energies) > 1:
        spread = energies[-1][0] - energies[0][0]
        print(f"conformers:   {len(energies)} embedded, energy spread {spread:.2f} kcal/mol ({tag})")


if __name__ == "__main__":
    main()
