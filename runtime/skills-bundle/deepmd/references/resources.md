# DeePMD Resources

> Load this when: local guidance is not enough and you need upstream documentation, papers, model libraries, or broader MLP context.

## Primary resources

- DeePMD-kit documentation: https://docs.deepmodeling.org/projects/deepmd/
- DeepModeling project: https://deepmodeling.com/
- DPLibrary model repository: https://dplibrary.deepmd.net/#/
- DeePMD-kit papers page: https://deepmodeling.com/blog/papers/deepmd-kit/
- DP-GEN documentation/project: https://docs.deepmodeling.com/projects/dpgen/
- LAMMPS `pair_style deepmd` manual: https://docs.lammps.org/pair_deepmd.html

## Papers to know

- DeePMD-kit original package paper: Han Wang et al., 2018.
- DeePMD-kit v2 paper: Jinzhe Zeng et al., 2023.
- Deep Potential / DeepPot-SE method papers for descriptor and symmetry details.
- DP-GEN papers for concurrent learning and model-deviation active learning.

## Related local docs

- `__NEBULAMAT_AICC_ROOT__/knowledge/machine-learning-potentials.md` for tool-agnostic MLP principles and program taxonomy.
- `__NEBULAMAT_AICC_ROOT__/knowledge/molecular-dynamics.md` for MD sampling, MSD/diffusion, RDF, VACF/VDOS, and free-energy analysis.
- `__NEBULAMAT_AICC_ROOT__/tools/lammps` for LAMMPS input mechanics.
- `__NEBULAMAT_AICC_ROOT__/tools/vasp` or `__NEBULAMAT_AICC_ROOT__/tools/cp2k` for DFT label generation.

## Related MLP programs

This tool is only for DeePMD. Use or create separate tool skills for MACE, NequIP/Allegro, GPUMD/NEP, LASP, GemNet-OC, EquiformerV2, and other architectures because their data formats, training commands, deployment paths, and validation failure modes differ.
