# MatterGen model cache

The upstream MatterGen source is bundled under `../upstream/`. The official
`chemical_system` checkpoint is downloaded into this directory by the desktop
environment page, not copied into the installer. The cache contains
`chemical_system/checkpoints/last.ckpt` and its `config.yaml` after a verified
installation. The checkpoint is tracked with Git LFS in source checkouts
because it is about 512 MB; release bundles intentionally omit it.

The checkpoint is the official Microsoft MatterGen 1.0.3 model from the pinned
upstream revision. It is MIT licensed; retain the upstream model card and
notice when redistributing a release build.
