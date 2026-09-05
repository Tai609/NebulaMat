# DeepSeek Harness runtime

NebulaMat treats DeepSeek Harness (DSH) as its only bottom runtime. The desktop
shell starts `dsh --profile web` with the Node.js and DSH dependency closure
bundled in the Windows installer. `NEBULAMAT_DSH_BIN` remains an explicit
override, and debug builds may use `PATH`; a missing release runtime is a hard
startup error and never falls back to OpenCode or another agent loop.

## Composition

- `cordis.yml` and `plugins.json` describe optional NebulaMat modules mounted
  above DSH. DSH owns the agent loop, sessions, model adapters, tools, and
  approval policy.
- Scientific connectors, browser control, graph, provenance, runs, and workspace
  presentation are application modules. MCP servers are registered through the
  DSH `@deepseek-ai/dsh-mcp-client` Cordis plugin.
- The desktop writes global instructions to `<DSH_HOME>/AGENTS.md`; project
  instructions remain in `<workspace>/AGENTS.md`.
- Global skills are deployed to `<DSH_HOME>/skills`; user-local skills live in
  the workspace `.dsh/skills` directory until adopted into the global set.
- The desktop mounts `nebulamat-tool-governance` into
  `<DSH_HOME>/profiles/web` and inserts its explicit `index.js` entry into the
  home patch. It is the authoritative `tools/pre-execute`/`tools.guard()` gate
  for remote and DFT execution; the SDK adapter only observes the resulting
  decision.
- The bundled `dsh-cost-meter` Host package is deployed into the app-private
  Web profile before startup. Its Typert service feeds the native desktop cost
  settings surface; the plugin's DSH Web client is not bundled.
- The bundled `@omdsh-dev/dsh-genui` package and its `genui` skill are deployed
  into the app-private Web profile before startup. No registry, Git checkout,
  developer `link:` path, or system package manager is required at runtime.

Each module is independently replaceable and communicates through the runtime
SDK contract rather than importing a concrete transport.

## Dispatch cost policy

The harness does not impose a multi-agent DAG on every request. The workspace
contract selects `fast`, `standard`, or `high-risk` routing: routine work stays
in the primary session, standard materials/literature work activates only the
named module, and VASP, remote, experiment, runtime-policy, or external-claim
work adds the required audit and approval gates. Review is opt-in for routine
work and targeted for high-risk work.
