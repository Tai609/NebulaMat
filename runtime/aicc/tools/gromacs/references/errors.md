# GROMACS Error Recovery

> Load this when: `pdb2gmx`, `grompp`, or `mdrun` fails; warnings appear; constraints break; the box explodes; or trajectory analysis is nonsensical.

Fix one thing at a time. Match the exact message in the installed-version manual/forum before changing physics. Most runtime explosions originate in structure/topology/parameter errors that survived until dynamics.

## Structure and topology construction

| Message / symptom | Likely cause | Fix |
|---|---|---|
| `Residue 'XXX' not found in residue topology database` | non-standard residue/name, wrong force field, missing residue definition | identify chemistry; rename only with evidence; parameterize separately or add documented residue definition |
| `Atom ... was not found in rtp entry` | atom names/connectivity do not match template; missing/extra atoms | compare PDB atom names to the selected force-field residue; resolve altlocs/missing atoms |
| disulfide not detected | SG distance/name/chain separation outside special-bond rules | inspect geometry and special-bond rules; verify resulting bond |
| ligand/ion unknown | `pdb2gmx` cannot parameterize it | split standard biomolecule from non-standard component; combine compatible topology explicitly |
| water/inserted molecule count wrong | coordinates changed but `[ molecules ]` did not | recount complete molecules; update topology; preserve block order |

## `grompp` topology failures

| Message / symptom | Likely cause | Fix |
|---|---|---|
| `Invalid order for directive ...` | topology directive at wrong level/order | move directives/includes to parameter or molecule level |
| `No such moleculetype ...` | `[ molecules ]` name not defined; include missing/inactive; spelling mismatch | inspect `processed.top`; fix include/macro/name |
| `Atomtype ... not found` | atom types defined after use or missing include | include atom types immediately after parent force field and before molecule definition |
| `No default Bond/Angle/Dih. types` | missing parameter or wrong atom typing/connectivity | obtain/fit missing term; correct types/bond order; never bypass with `-maxwarn` |
| coordinate/topology count mismatch | atom or molecule count/order mismatch | compare `.gro` count and `[ molecules ]`; correct coordinate block order |
| non-zero total charge warning | charged system, wrong protonation, missing counterions or rounding | decide chemistry; add intended counterions or document charged PME treatment |
| position-restraint mismatch | `-r` missing/wrong, or restraint atom numbers belong to another molecule | supply matching reference coordinates; place restraint include inside correct molecule |
| parameter redefinition warning | duplicate type definitions or custom include order | inspect values and `processed.top`; remove accidental duplicate or document intentional override |

`grompp -maxwarn` allows compilation; it does not make a system stable or physically defined.

## Immediate instability / blowing up

| Symptom | Likely cause | Fix |
|---|---|---|
| very positive potential or `NaN` at step 0 | atom overlap, wrong units/box, bad coordinates, missing LJ/charge, wrong topology | inspect structure/minimum distances; verify parameters and units; minimize conservatively |
| `Particle coordinate is nan` | dynamics already exploded | return to last stable checkpoint; diagnose timestep, overlaps, topology, restraints, pull/field |
| temperature jumps | bad contacts/velocities, timestep too large, unit error, constraint failure | minimize, check `dt` in ps, velocity generation and constraints |
| pressure/box explodes | bad contacts, aggressive/wrong barostat, wrong compressibility, vacuum direction coupled | stabilize fixed volume; check density/box; correct coupling geometry |
| `Pressure scaling more than ...` | box response too large or system unstable | stop; fix density/contacts/barostat setup |

Use `gmx mdrun -pforce <threshold>` during diagnosis to locate atoms with extreme forces. It is a locator, not a production setting.

## Constraint failures

| Message / symptom | Likely cause | Fix |
|---|---|---|
| `LINCS WARNING` | timestep too large, huge local force, bad topology/geometry, aggressive pull/restraint/field | stop at first occurrence; inspect listed atoms; fix geometry/physics before increasing LINCS settings |
| `Too many LINCS warnings` | repeated instability | trajectory after first warning is invalid |
| `SETTLE` error | distorted/overlapping water, wrong water topology/order, huge force/timestep | inspect waters, model and atom order; remove overlap |
| constraints fail only in parallel | decomposition spans constraint network or setup near stability limit | validate physics first; then test fewer ranks/update groups |

Increasing `lincs-order` or `lincs-iter` can mask symptoms and is not the first-line fix.

## Domain decomposition and performance failures

| Symptom | Likely cause | Fix |
|---|---|---|
| no domain decomposition for requested ranks | system too small or cutoffs/constraints span domains | use fewer ranks/more OpenMP threads; benchmark |
| GPU not used / low utilization | binary lacks support, bad mapping, CPU/PME/output bottleneck | confirm `gmx --version`; start with automatic offload |
| slower with more GPUs/ranks | communication/domain/PME overhead | reduce ranks/devices; tune after profiling |
| OOM | excessive ranks, output, PME grid or analysis memory | reduce concurrency/output; request justified memory |

Performance is not validation. A fast unstable run is a failed run.

## Checkpoint and continuation problems

| Symptom | Likely cause | Fix |
|---|---|---|
| checkpoint not found | wrong prefix/path or file never written | locate `.cpt`/`state_prev.cpt`; if absent, start a new provenance segment |
| append checksum mismatch | files changed, renamed, truncated or mixed | restore matching output set or use new prefix with `-noappend` |
| continuation starts with new velocities | `gen-vel = yes` | set `gen-vel = no` and use checkpoint/state correctly |
| duplicate time/frame after concatenation | overlapping segments | inspect with `gmx check`; remove duplicates in documented step |
| walltime stop with checkpoint | controlled incomplete segment | parse log, verify checkpoint and continue with `-cpi` |

Changing force field or Hamiltonian-defining parameters is not an exact continuation.

## Analysis artifacts

| Symptom | Likely cause | Fix |
|---|---|---|
| molecule split across box | raw periodic wrapping | create whole/centered derivative using `trjconv` |
| RMSD huge/sawtooth | PBC not repaired, wrong fit/output group, atom order mismatch | repair PBC, choose stable fit group, verify reference correspondence |
| MSD jumps or plateaus | wrapped trajectory or fitted-away diffusion | use `-pbc nojump`; do not fit out displacement of interest |
| membrane density smeared | bilayer not centered/aligned | center each frame on membrane/reference |
| SDF blurred | central molecule translates/rotates before averaging | align central molecule consistently; increase sampling |
| VMD `within` count does not change | dynamic selection not updated | set frame and call `$sel update` each iteration |
| VMD bond lines cross box | distance-based bond guessing | use real topology for chemistry; treat guessed bonds as display only |

## Escalation rules

Preserve the failing directory/log; identify the earliest warning; reproduce with a short diagnostic when possible; change one thing; re-run preflight and smoke test; restart from last verified-stable checkpoint/structure; record failure, diagnosis and validation outcome.
