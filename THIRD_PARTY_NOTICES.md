# Third-Party Notices

NebulaMat bundles third-party skills and supporting materials as separate
resources. These resources retain their own licenses and are not relicensed
under NebulaMat's MIT license.

## AI Computational Chemist (AICC)

- Source: https://github.com/JCLiuGroup/AI-Computational-Chemist
- Pinned commit: `c416a8ae8999aaba5faf0230ec052cd54a5ca0bb`
- License: Creative Commons Attribution-NonCommercial 4.0 International
  (CC BY-NC 4.0)
- Copyright: 2026 The AICC authors (JCLiu Group, Nankai University)

NebulaMat ships the AICC skill, procedure, helper-script, and knowledge
collection without its benchmark fixtures. The AICC installer does not provide
VASP, CP2K, Gaussian, GROMACS, LAMMPS, pseudopotentials, basis sets, force
fields, or other licensed scientific software. Use of the bundled AICC material
is subject to its NonCommercial restriction. See the complete `LICENSE` stored
inside the deployed AICC collection.

NebulaMat modifies only deployment-time paths and routes execution through its
own approval, remote-compute, Runs, and provenance boundaries.

## ARIS (Auto-Research-In-Sleep)

- Source: https://github.com/wanshuiyin/Auto-claude-code-research-in-sleep
- Pinned commit: `014c16e0e58198e4230fafd246b0e6203892422f`
- License: MIT

NebulaMat ships the Codex skill mirror under the `aris-` namespace together
with its helper scripts, templates, and optional MCP server source. The
generated skill wrappers adapt delegation names to DSH and retain NebulaMat's
approval, provenance, and tool-governance boundaries. Optional MCP servers are
not registered or launched automatically, and their credentials and provider
dependencies are never bundled. The upstream TTY monitor is omitted because
NebulaMat provides native durable session and subagent views; ARIS watchdog and
run-state helpers remain available.

## Microsoft MatterGen (optional)

- Source: https://github.com/microsoft/mattergen
- Pinned revision: `ac9ddd406171138c3f037d06b9b53fedbbb1c536`
- Version: `1.0.3`
- License: MIT

NebulaMat ships the pinned MatterGen source under
`runtime/mattergen/upstream`, a request adapter and runner. The official
`chemical_system` checkpoint is not included in the installer: users download
it explicitly from the Scientific environment page into the shared workspace.
The pinned 512,404,276 byte checkpoint is verified against SHA-256
`4ad21d977c2b776a31c92498c4d1c88d3e1e286deeb941e997af8e082310b80` before use.
PyTorch/CUDA wheels are provisioned into an app-private environment on first
use rather than installed into the user's system Python. Users who use the
upstream environment remain subject to its license and model/checkpoint terms.

## DeepSeek Harness

- Source: https://github.com/deepseek-ai/deepseek-harness
- Bundled npm package: `@deepseek-ai/dsh@0.1.0-rc.6`
- License: MIT

The Windows installer includes the DSH CLI and its locked production npm
dependency closure. Package-level license files remain alongside their packages
inside the bundled runtime.

## dsh-cost-meter

- Source: https://github.com/Han-1413141/dsh-cost-meter
- Bundled version: `1.3.1`
- License: MIT

NebulaMat bundles the plugin's Host accounting service and Typert declarations.
Its DSH Web client is replaced by a native desktop settings surface. The
original license is retained at `runtime/harness/dsh-cost-meter/LICENSE`.

## dsh-token-billing (design reference)

- Source: https://github.com/2006spy/dsh-token-billing
- Referenced commit: `c40834bf352322b72cab45a7859c39747f365ab0`
- Version at reference: `0.7.2`
- License: MIT

NebulaMat uses this project as a design and accounting reference for provider
billing modes, list-price value, savings, trends, and model/provider cost
breakdowns. It does not bundle or load the project's DSH Web client; the
implementation remains in NebulaMat's native desktop UI and existing Host RPC
boundary.

## dsh-genui

- Source: https://github.com/omdsh-dev/dsh-genui
- Bundled version: `0.8.3`
- License: MIT

NebulaMat bundles the prebuilt DSH GenUI host/client package and its browser
assets so the desktop installer does not depend on a developer's local
checkout. The original license is retained at
`runtime/harness/dsh-genui/LICENSE`.

## VASPFlow

- Source: https://github.com/21271122/VASPFlow
- Pinned commit: `1cf773749bd0bd8405f2503a2d684bdb99ca34f5`
- License: MIT

NebulaMat bundles VASPFlow's host-side VASP scanner, parsers, task-file
service, and structure-scene assembler. Its DSH Web client is not loaded;
NebulaMat consumes the shared HTTP/tool contract from a native desktop task
page and Three.js structure view. The original license is retained at
`runtime/harness/dsh-vaspflow/LICENSE`.

## ExperMate (design reference)

- Source: https://github.com/21271122/ExperMate
- Referenced commit: `a5c6a9805d7bc7d7824b5628c6c523e85f9ecd11`
- License: Elastic License 2.0

NebulaMat uses ExperMate as a product reference for a local SQLite experiment
catalog, immutable attachment archives, structured records, search and archive
operations. No ExperMate source code or client bundle is included.

## Zod

- Source: https://github.com/colinhacks/zod
- Version: 4.4.3
- License: MIT

The bundled cost-meter host includes a self-contained Zod ESM build so the
desktop runtime can load the plugin offline. The original license is retained
at `runtime/harness/dsh-cost-meter/ZOD_LICENSE`.

## Node.js

- Source: https://github.com/nodejs/node
- Bundled Windows runtime: `22.23.2` x64
- License: MIT and third-party terms listed in the Node.js distribution

The complete Node.js license is shipped as `dsh/windows-x64/LICENSE.node.txt`.
