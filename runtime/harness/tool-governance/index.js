const HASH = /^[a-f0-9]{64}$/i;
const REMOTE_TOOLS = new Set([
  "ssh",
  "scp",
  "sftp",
  "rsync",
  "ssh_connect",
  "remote_compute",
  "hpc_submit",
  "dft_submit",
  "submit_dft",
  "materials_submit",
  "materials_mcp_submit",
]);
const REMOTE_COMMANDS = new Set([
  "ssh",
  "scp",
  "sftp",
  "rsync",
  "sbatch",
  "srun",
  "salloc",
  "qsub",
  "qrun",
  "bsub",
  "jsrun",
]);
const DFT_COMMANDS = new Set(["vasp", "vasp_std", "vasp_gam", "vasp_ncl", "pw.x", "cp2k", "cp2k.psmp", "gpaw"]);
const COMMAND_TOOLS = new Set(["bash", "shell", "shell_command", "exec", "exec_command", "execute", "execute_command", "terminal", "run_command"]);
const DISABLED_BUILT_IN_TOOLS = new Set(["web_search", "web_fetch"]);

function normalized(value) {
  return String(value ?? "").trim().toLowerCase().replace(/[.:/\-]+/g, "_");
}

function commandInput(input) {
  for (const key of ["command", "cmd", "executable", "program"]) {
    if (typeof input?.[key] === "string" && input[key].trim()) return input[key].trim();
  }
  return undefined;
}

function nestedShellCommand(segment) {
  const match = String(segment).match(/^(?:(?:bash|sh|zsh|dash)(?:\.exe)?\s+-\S*c\S*|cmd(?:\.exe)?\s+\/c|(?:powershell|pwsh)(?:\.exe)?\s+-(?:command|c))\s+(.+)$/i);
  if (!match) return undefined;
  const payload = match[1].trim();
  const quote = payload[0];
  if ((quote === "\"" || quote === "'") && payload.endsWith(quote)) return payload.slice(1, -1);
  return payload;
}

function commandHeads(command) {
  return String(command)
    .split(/&&|;|\||\r?\n/)
    .flatMap((part) => {
      const segment = part.trim()
        .replace(/^&\s+/, "")
        .replace(/^env(?:\s+\w+=(?:"[^"]*"|'[^']*'|\S*))*\s+/, "")
        .replace(/^sudo(?:\s+-\S+)*\s+/, "");
      const head = segment.match(/^(?:"([^"]+)"|'([^']+)'|([^\s]+))/)?.slice(1).find(Boolean) ?? "";
      const normalizedHead = head.toLowerCase().replace(/\.exe$/, "").split(/[\\/]/).pop() ?? "";
      const nested = nestedShellCommand(segment);
      return [normalizedHead, ...(nested && nested !== segment ? commandHeads(nested) : [])].filter(Boolean);
    });
}

function isRemoteExecution(name, input) {
  const tool = normalized(name);
  if (REMOTE_TOOLS.has(tool) || [...REMOTE_TOOLS].some((candidate) => tool.endsWith(`_${candidate}`))) return true;
  if (!COMMAND_TOOLS.has(tool)) return false;
  const heads = commandHeads(commandInput(input) ?? "");
  return heads.some((head) => REMOTE_COMMANDS.has(head) || DFT_COMMANDS.has(head));
}

function record(input, ...keys) {
  for (const key of keys) {
    if (input?.[key] && typeof input[key] === "object") return input[key];
  }
  return undefined;
}

function contracts(input) {
  const workflow = record(input, "workflow", "materialsWorkflow", "materials_workflow");
  return {
    manifest: record(input, "submissionManifest", "submission_manifest") ?? record(workflow, "submissionManifest", "submission_manifest"),
    audit: record(input, "dftModelAudit", "dft_model_audit", "modelAudit", "model_audit") ?? record(workflow, "modelAudit", "model_audit"),
  };
}

function humanApproval(manifest) {
  const approval = manifest?.humanApproval ?? manifest?.human_approval;
  if (!approval || approval.decision !== "approved" || !String(approval.actor ?? "").startsWith("human:")) return false;
  return [approval.modelHash, approval.parametersHash, approval.auditHash, approval.costHash].every((value) => HASH.test(String(value ?? "")))
    && Number.isFinite(approval.approvedAt);
}

function admissionReason(exec) {
  if (DISABLED_BUILT_IN_TOOLS.has(normalized(exec.name))) {
    return "The built-in DeepSeek web search/fetch tools are disabled. Use the browser-control MCP tools (mcp__browser-control__agent_browser_open/read/snapshot) for web research instead.";
  }
  const input = exec.arguments && typeof exec.arguments === "object" ? exec.arguments : {};
  const command = commandInput(input);
  // Preparation and inspection of DFT inputs are allowed. Only a named
  // remote/DFT executor reaches this server-side admission gate.
  if (!isRemoteExecution(exec.name, input)) return undefined;

  const { manifest, audit } = contracts(input);
  if (!manifest || !audit || !humanApproval(manifest)) {
    return "NebulaMat governance blocked this remote/DFT execution: provide a named human approval bound to the exact model, parameters, audit, and cost hashes before execution.";
  }
  if (![manifest.modelHash, manifest.parametersHash, manifest.auditHash, manifest.costHash, manifest.hash, audit.modelHash, audit.costHash, audit.hash].every((value) => HASH.test(String(value ?? "")))) {
    return "NebulaMat governance blocked this execution: submission and audit hashes are incomplete or invalid.";
  }
  if (manifest.modelHash !== audit.modelHash || manifest.auditHash !== audit.hash || manifest.costHash !== audit.costHash) {
    return "NebulaMat governance blocked this execution: the submission manifest is stale relative to the reviewed audit.";
  }
  if (COMMAND_TOOLS.has(normalized(exec.name)) && command !== String(manifest.command ?? "").trim()) {
    return "NebulaMat governance blocked this execution: the command does not match the approved submission manifest.";
  }
  return undefined;
}

function apply(ctx) {
  const deny = (exec) => admissionReason(exec);
  ctx.on("tools/pre-execute", (exec, next) => {
    const reason = deny(exec);
    return reason ? { kind: "deny", reason } : next();
  }, { prepend: true });
  ctx.tools.guard(deny);
}

const name = "nebulamat-tool-governance";
const inject = ["tools"];
export { apply, admissionReason, name, inject };
