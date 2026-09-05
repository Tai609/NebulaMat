import type { RuntimeToolGuard, ToolAdmissionDecision, ToolGuardContext } from "@ai4s/sdk";
import { isSubmissionReady, type DFTModelAudit, type SubmissionManifest } from "@ai4s/shared";

export type ToolRisk = "ordinary" | "mutating" | "dft-preparation" | "remote-execution";

const DFT_WORDS = /(?:\bdft\b|\bvasp(?:kit)?\b|\b(?:in|pos|pot|dos)car\b|\bneb\b|\bincar\b|\bbader\b|first-principles|electronic structure|adsorption energy|structural relaxation)/i;
const MUTATING_TOOLS = new Set(["write", "create", "edit", "apply_patch", "delete", "bash", "shell", "task"]);
const COMMAND_TOOLS = new Set(["bash", "shell", "shell_command", "exec", "exec_command", "execute", "execute_command", "terminal", "run_command"]);
const REMOTE_TOOLS = new Set(["ssh", "scp", "sftp", "rsync", "ssh_connect", "remote_compute", "hpc_submit", "dft_submit", "submit_dft", "materials_submit", "materials_mcp_submit"]);
const REMOTE_EXECUTABLES = new Set(["ssh", "scp", "sftp", "rsync", "sbatch", "srun", "salloc", "qsub", "qrun", "bsub", "jsrun"]);
const DFT_EXECUTABLES = new Set(["vasp", "vasp_std", "vasp_gam", "vasp_ncl", "pw.x", "cp2k", "cp2k.psmp", "gpaw"]);
const COMMAND_KEYS = ["command", "cmd", "executable", "program"] as const;
const DISABLED_BUILT_IN_TOOLS = new Set(["web_search", "web_fetch"]);

function normalizedToolName(tool: string): string {
  return tool.trim().toLowerCase().replace(/[.:/-]+/g, "_");
}

function basename(value: string): string {
  return value.replace(/^['"]|['"]$/g, "").split(/[\\/]/).pop()?.toLowerCase().replace(/\.exe$/, "") ?? "";
}

function stripCommandPrefixes(segment: string): string {
  let command = segment.trim();
  let previous = "";
  while (command !== previous) {
    previous = command;
    command = command
      .replace(/^&\s+/, "")
      .replace(/^\w+=(?:"[^"]*"|'[^']*'|\S*)\s+/, "")
      .replace(/^env(?:\s+\w+=(?:"[^"]*"|'[^']*'|\S*))*\s+/, "")
      .replace(/^sudo(?:\s+-\S+)*\s+/, "")
      .replace(/^(?:nohup|time|command)\s+/, "")
      .replace(/^timeout\s+\S+\s+/, "")
      .trim();
  }
  return command;
}

function isRemoteTool(tool: string): boolean {
  return REMOTE_TOOLS.has(tool)
    || [...REMOTE_TOOLS].some((name) => tool.endsWith(`_${name}`));
}

function nestedShellCommand(segment: string): string | undefined {
  const match = segment.match(/^(?:(?:bash|sh|zsh|dash)(?:\.exe)?\s+-\S*c\S*|cmd(?:\.exe)?\s+\/c|(?:powershell|pwsh)(?:\.exe)?\s+-(?:command|c))\s+(.+)$/i);
  if (!match) return undefined;
  const payload = match[1].trim();
  const quote = payload[0];
  if ((quote === "\"" || quote === "'") && payload.endsWith(quote)) return payload.slice(1, -1);
  return payload;
}

function commandHeads(command: string): string[] {
  return command
    .split(/&&|;|\||\r?\n/)
    .map(stripCommandPrefixes)
    .flatMap((segment) => {
      const head = basename(segment.match(/^(?:"([^"]+)"|'([^']+)'|([^\s]+))/)?.slice(1).find(Boolean) ?? "");
      const nested = nestedShellCommand(segment);
      return [head, ...(nested && nested !== command ? commandHeads(nested) : [])];
    })
    .filter(Boolean);
}

function commandFromInput(input?: Record<string, unknown>): string | undefined {
  for (const key of COMMAND_KEYS) {
    if (typeof input?.[key] === "string" && input[key].trim()) return input[key];
  }
  return undefined;
}

function isGovernedExecutionTool(tool: string): boolean {
  return COMMAND_TOOLS.has(tool) || isRemoteTool(tool);
}

function inputText(context: ToolGuardContext): string {
  return [context.tool, ...Object.values(context.input ?? {}).map((value) => (typeof value === "string" ? value : JSON.stringify(value)))]
    .join(" ")
    .slice(0, 32_000);
}

export function classifyToolRisk(context: ToolGuardContext): ToolRisk {
  const tool = normalizedToolName(context.tool);
  if (isRemoteTool(tool)) return "remote-execution";
  if (COMMAND_TOOLS.has(tool)) {
    const command = commandFromInput(context.input);
    const heads = command ? commandHeads(command) : [];
    if (heads.some((head) => REMOTE_EXECUTABLES.has(head) || DFT_EXECUTABLES.has(head))) {
      return "remote-execution";
    }
  }
  if (DFT_WORDS.test(inputText(context))) return "dft-preparation";
  if (MUTATING_TOOLS.has(tool)) return "mutating";
  return "ordinary";
}

function approvalFromInput(input?: Record<string, unknown>): Record<string, unknown> | undefined {
  const nested = input?.human_approval ?? input?.humanApproval ?? input?.dft_approval;
  const value = nested ?? (input?.decision === "approved" ? input : undefined);
  return value && typeof value === "object" ? (value as Record<string, unknown>) : undefined;
}

function recordFromInput(input: Record<string, unknown> | undefined, ...keys: string[]): Record<string, unknown> | undefined {
  for (const key of keys) {
    const value = input?.[key];
    if (value && typeof value === "object") return value as Record<string, unknown>;
  }
  return undefined;
}

function submissionContracts(input?: Record<string, unknown>): {
  manifest?: SubmissionManifest;
  audit?: DFTModelAudit;
  supplied: boolean;
} {
  const workflow = recordFromInput(input, "workflow", "materialsWorkflow", "materials_workflow");
  const manifest = recordFromInput(input, "submissionManifest", "submission_manifest")
    ?? recordFromInput(workflow, "submissionManifest", "submission_manifest");
  const audit = recordFromInput(input, "dftModelAudit", "dft_model_audit", "modelAudit", "model_audit")
    ?? recordFromInput(workflow, "modelAudit", "model_audit");
  return {
    manifest: manifest as unknown as SubmissionManifest | undefined,
    audit: audit as unknown as DFTModelAudit | undefined,
    supplied: manifest !== undefined || audit !== undefined,
  };
}

/** A remote/DFT execution approval is valid only when a named human approved
 * the exact prepared artifacts. The hashes make a later input revision stale. */
export function hasNamedHumanApproval(input?: Record<string, unknown>): boolean {
  const approval = approvalFromInput(input);
  if (!approval || approval.decision !== "approved") return false;
  if (typeof approval.actor !== "string" || !approval.actor.startsWith("human:")) return false;
  const required = ["model_sha256", "parameters_sha256", "audit_sha256", "cost_sha256"];
  return required.every(
    (key) => typeof approval[key] === "string" && /^[a-f0-9]{64}$/i.test(String(approval[key])),
  );
}

export function decideToolAdmission(context: ToolGuardContext): ToolAdmissionDecision {
  if (DISABLED_BUILT_IN_TOOLS.has(normalizedToolName(context.tool))) {
    return {
      decision: "block",
      reason: "The built-in DeepSeek web search/fetch tools are disabled. Use the browser-control MCP tools (mcp__browser-control__agent_browser_open/read/snapshot) for web research instead.",
    };
  }
  const risk = classifyToolRisk(context);
  if (risk !== "remote-execution" || !isGovernedExecutionTool(normalizedToolName(context.tool))) {
    return { decision: "allow" };
  }
  const contracts = submissionContracts(context.input);
  const command = commandFromInput(context.input)?.trim();
  const approved = contracts.supplied
    ? isSubmissionReady(contracts.manifest, contracts.audit)
      && (!COMMAND_TOOLS.has(normalizedToolName(context.tool)) || command === contracts.manifest?.command.trim())
    : hasNamedHumanApproval(context.input);
  if (!approved) {
    return {
      decision: "require-human-approval",
      reason: "Remote or DFT execution requires a named human approval bound to the exact model, parameters, audit, and cost hashes.",
    };
  }
  return { decision: "allow" };
}

export const researchToolGuard: RuntimeToolGuard = decideToolAdmission;
