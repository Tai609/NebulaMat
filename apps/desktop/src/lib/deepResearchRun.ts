import {
  canAdvanceResearchAutopilotStage,
  stableHash,
  type ResearchAutopilotStage,
} from "@ai4s/shared";
import type { HistoryMessage, RuntimeMessageEvent } from "@ai4s/sdk";
import type { KnowledgeUniverseBundle } from "./modelPromptPreparation";
import { DEEP_RESEARCH_SKILLS } from "./deepResearch";

export const DEEP_RESEARCH_RUNS_KEY = "ai4s.session.deep-research-runs.v1";
export const DEEP_RESEARCH_MAX_ATTEMPTS = 2;
const DEEP_RESEARCH_RECEIPT_LIMIT = 200;

export type DeepResearchRunStatus = "running" | "retrying" | "qualified" | "incomplete";

export interface DeepResearchStageEntry {
  stage: ResearchAutopilotStage;
  at: number;
  reason: string;
}

export interface DeepResearchToolReceipt {
  sessionId: string;
  callId: string;
  tool: string;
  status: "success" | "failed";
  governedRetrieval: boolean;
  providerFamilies: string[];
  recordKeys: string[];
  outputDigest: string;
  evidenceExcerpt: string;
  at: number;
}

export interface DeepResearchRun {
  schemaVersion: 1;
  runId: string;
  sessionId: string;
  query: string;
  stage: ResearchAutopilotStage;
  stageHistory: DeepResearchStageEntry[];
  status: DeepResearchRunStatus;
  attempt: number;
  maxAttempts: number;
  researchId: string;
  expectedGraphHash: string;
  knowledge: KnowledgeUniverseBundle;
  toolReceipts: DeepResearchToolReceipt[];
  providerFamilies: string[];
  blockers: string[];
  graphWriteHash?: string;
  finalReport?: string;
  createdAt: number;
  updatedAt: number;
}

const PROVIDER_PATTERNS: ReadonlyArray<[string, RegExp]> = [
  ["pubmed", /\b(?:pubmed|ncbi|entrez)\b/i],
  ["arxiv", /\b(?:arxiv|deepxiv|alphaxiv)\b/i],
  ["openalex", /\bopen[\s_-]?alex\b/i],
  ["semantic-scholar", /\b(?:semantic[\s_-]?scholar|semanticscholar|s2)\b/i],
  ["crossref", /\bcross[\s_-]?ref\b/i],
  ["europe-pmc", /\beurope[\s_-]?pmc\b/i],
  ["google-scholar", /\bgoogle[\s_-]?scholar\b/i],
  ["scopus", /\bscopus\b/i],
  ["science-direct", /\bscience[\s_-]?direct\b/i],
  ["web-of-science", /\bweb[\s_-]?of[\s_-]?science\b/i],
  ["cnki", /\bcnki\b|中国知网/i],
];

/**
 * The DSH MCP adapter exposes a bundled paper-search server with names such
 * as `mcp__paper-search__search_openalex`.  Keep these mappings scoped to the
 * exact server/tool routes: a provider name in arbitrary model prose is not
 * enough to establish a provider receipt.
 */
const PAPER_SEARCH_TOOL_PROVIDERS: Readonly<Record<string, string>> = {
  "mcp__paper_search__search_pubmed": "pubmed",
  "mcp__paper_search__search_arxiv": "arxiv",
  "mcp__paper_search__search_openalex": "openalex",
  "mcp__paper_search__search_semantic": "semantic-scholar",
  "mcp__paper_search__search_semantic_scholar": "semantic-scholar",
  "mcp__paper_search__search_crossref": "crossref",
  "mcp__paper_search__get_crossref_paper_by_doi": "crossref",
  "mcp__paper_search__search_europepmc": "europe-pmc",
  "mcp__paper_search__search_europe_pmc": "europe-pmc",
  "mcp__paper_search__search_google_scholar": "google-scholar",
};

const GOVERNED_RETRIEVAL = /(?:^|[\s_:/.-])(?:skill|mcp|literature|academic|citation|paper|retriev|search|openalex|arxiv|pubmed|crossref|semantic[\s_-]?scholar)(?:$|[\s_:/.-])/i;
const UNGOVERNED_SHELL = /^(?:bash|shell|exec|execute|run|run_command)$/i;
const DOI = /\b10\.\d{4,9}\/[A-Z0-9][A-Z0-9._;()/:+-]*[A-Z0-9]\b/giu;
const PMID = /\bPMID\s*[:=]?\s*(\d{5,10})\b/giu;
const ARXIV = /\b(?:arXiv\s*:\s*)?(\d{4}\.\d{4,5})(?:v\d+)?\b/giu;

function now(): number {
  return Date.now();
}

function compact(value: string, max = 1_400): string {
  const redacted = value
    .replace(/(?:bearer|api[_ -]?key|authorization)\s*[:=]\s*\S+/giu, "credential=[redacted]")
    .replace(/\b[A-Za-z0-9_-]{40,}\b/g, "[redacted-token]")
    .replace(/\s+/g, " ")
    .trim();
  return redacted.length > max ? `${redacted.slice(0, max - 3)}...` : redacted;
}

function structuredInputText(input: Record<string, unknown> | undefined): string {
  if (!input) return "";
  const values: string[] = [];
  const visit = (value: unknown, key = "", depth = 0): void => {
    if (depth > 3) return;
    if (typeof value === "string" && /provider|database|source|skill|command|tool|name/i.test(key)) values.push(value);
    else if (Array.isArray(value)) value.forEach((item) => visit(item, key, depth + 1));
    else if (value && typeof value === "object") Object.entries(value as Record<string, unknown>)
      .forEach(([childKey, child]) => visit(child, childKey, depth + 1));
  };
  visit(input);
  return values.join(" ");
}

function structuredOutputProviderText(output: string | undefined): string {
  if (!output?.trim().startsWith("{")) return "";
  try {
    return structuredInputText(JSON.parse(output) as Record<string, unknown>);
  } catch {
    return "";
  }
}

function normalizedProviderMetadata(value: string): string {
  // `\b` treats `_` as a word character. Replace connector naming
  // separators before applying the provider patterns so names such as
  // `mcp__paper-search__search_openalex` are tokenized as expected.
  return value.replace(/[_-]+/g, " ");
}

function paperSearchProvider(tool: string): string | undefined {
  const normalized = tool.trim().toLowerCase().replace(/-/g, "_");
  return PAPER_SEARCH_TOOL_PROVIDERS[normalized];
}

export function classifyDeepResearchToolReceipt(
  event: Extract<RuntimeMessageEvent, { type: "tool.updated" }>,
  at = now(),
): DeepResearchToolReceipt | null {
  if (event.status !== "success" && event.status !== "failed") return null;
  const metadata = [event.tool, event.title ?? "", structuredInputText(event.input), structuredOutputProviderText(event.output)].join(" ");
  const directProvider = paperSearchProvider(event.tool);
  const providerFamilies = [...new Set([
    ...PROVIDER_PATTERNS
      .filter(([, pattern]) => pattern.test(normalizedProviderMetadata(metadata)))
      .map(([provider]) => provider),
    ...(directProvider ? [directProvider] : []),
  ])];
  const curatedSkill = DEEP_RESEARCH_SKILLS.some((name) => metadata.toLowerCase().includes(name.toLowerCase()));
  const governedRetrieval = !UNGOVERNED_SHELL.test(event.tool) && (
    curatedSkill
    || GOVERNED_RETRIEVAL.test(event.tool)
    || GOVERNED_RETRIEVAL.test(event.title ?? "")
    || /(?:skill|provider|database|source)/i.test(structuredInputText(event.input))
    || providerFamilies.length > 0
  );
  const output = event.output ?? event.partialOutput ?? "";
  const recordKeys = [...new Set([
    ...[...output.matchAll(DOI)].map((match) => `doi:${match[0].toLowerCase().replace(/[.,;)]$/, "")}`),
    ...[...output.matchAll(PMID)].map((match) => `pmid:${match[1]}`),
    ...[...output.matchAll(ARXIV)].map((match) => `arxiv:${match[1]}`),
  ])].slice(0, 80);
  return {
    sessionId: event.sessionId,
    callId: event.callId,
    tool: event.tool,
    status: event.status,
    governedRetrieval,
    providerFamilies,
    recordKeys,
    outputDigest: stableHash(output),
    evidenceExcerpt: compact(output || `${event.tool} returned ${event.status}.`),
    at,
  };
}

function readRuns(): Record<string, DeepResearchRun> {
  if (typeof window === "undefined") return {};
  try {
    const parsed = JSON.parse(window.localStorage.getItem(DEEP_RESEARCH_RUNS_KEY) ?? "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function writeRun(run: DeepResearchRun): DeepResearchRun {
  if (typeof window !== "undefined") {
    const runs = readRuns();
    runs[run.sessionId] = run;
    window.localStorage.setItem(DEEP_RESEARCH_RUNS_KEY, JSON.stringify(runs));
  }
  return run;
}

export function getDeepResearchRun(sessionId: string): DeepResearchRun | null {
  const run = readRuns()[sessionId];
  if (
    !run
    || run.schemaVersion !== 1
    || run.sessionId !== sessionId
    || typeof run.runId !== "string"
    || typeof run.query !== "string"
    || !Array.isArray(run.stageHistory)
    || !Array.isArray(run.toolReceipts)
  ) return null;
  return run;
}

export function removeDeepResearchRun(sessionId: string): void {
  if (typeof window === "undefined") return;
  const runs = readRuns();
  delete runs[sessionId];
  window.localStorage.setItem(DEEP_RESEARCH_RUNS_KEY, JSON.stringify(runs));
}

function advance(run: DeepResearchRun, stage: ResearchAutopilotStage, reason: string, at = now()): DeepResearchRun {
  if (stage === run.stage) return run;
  if (!canAdvanceResearchAutopilotStage(run.stage, stage)) {
    throw new Error(`Invalid Deep Research stage transition: ${run.stage} -> ${stage}`);
  }
  return { ...run, stage, stageHistory: [...run.stageHistory, { stage, at, reason }], updatedAt: at };
}

export function startDeepResearchRun(input: {
  sessionId: string;
  query: string;
  researchId: string;
  graphHash: string;
  knowledge: KnowledgeUniverseBundle;
  at?: number;
}): DeepResearchRun {
  const at = input.at ?? now();
  let run: DeepResearchRun = {
    schemaVersion: 1,
    runId: `deep-research:${stableHash({ sessionId: input.sessionId, query: input.query, at }).slice(0, 20)}`,
    sessionId: input.sessionId,
    query: input.query.trim(),
    stage: "inspect",
    stageHistory: [{ stage: "inspect", at, reason: "Knowledge Universe and CEBRO state inspection started." }],
    status: "running",
    attempt: 1,
    maxAttempts: DEEP_RESEARCH_MAX_ATTEMPTS,
    researchId: input.researchId,
    expectedGraphHash: input.graphHash,
    knowledge: input.knowledge,
    toolReceipts: [],
    providerFamilies: [],
    blockers: [],
    createdAt: at,
    updatedAt: at,
  };
  run = advance(run, "hypothesize", "Structured local evidence receipt was recorded before model execution.", at);
  run = advance(run, "plan", "The governed retrieval plan was sent to the sole agent runtime.", at);
  return writeRun(run);
}

export function recordDeepResearchToolEvent(
  sessionId: string,
  event: Extract<RuntimeMessageEvent, { type: "tool.updated" }>,
): DeepResearchRun | null {
  let run = getDeepResearchRun(sessionId);
  if (!run || run.status === "qualified" || run.status === "incomplete") return run;
  if (event.status === "running" || event.status === "pending") {
    if (run.stage === "evaluate") run = advance(run, "plan", "A further discriminating retrieval was selected.");
    if (run.stage === "plan") run = advance(run, "execute", `Runtime observed governed work: ${event.tool}.`);
    return writeRun(run);
  }
  const receipt = classifyDeepResearchToolReceipt(event);
  if (!receipt) return run;
  if (run.stage === "evaluate") run = advance(run, "plan", "A further tool receipt required another execution cycle.");
  if (run.stage === "plan") run = advance(run, "execute", `Runtime observed terminal tool work: ${event.tool}.`);
  const receipts = [...run.toolReceipts.filter((item) => item.callId !== receipt.callId), receipt]
    .slice(-DEEP_RESEARCH_RECEIPT_LIMIT);
  run = { ...run, toolReceipts: receipts, updatedAt: receipt.at };
  if (run.stage === "execute") run = advance(run, "evaluate", `Runtime recorded a ${receipt.status} tool receipt for evaluation.`, receipt.at);
  const providerFamilies = [...new Set(receipts
    .filter((item) => item.status === "success" && item.governedRetrieval)
    .flatMap((item) => item.providerFamilies))].sort();
  return writeRun({ ...run, providerFamilies, updatedAt: receipt.at });
}

export function deepResearchBlockers(run: DeepResearchRun, hasSynthesisText = true): string[] {
  const successfulGoverned = run.toolReceipts.filter((receipt) => receipt.status === "success" && receipt.governedRetrieval);
  const blockers: string[] = [];
  if (!run.knowledge.attempted) blockers.push("Knowledge Universe retrieval was not attempted.");
  if (!successfulGoverned.length) blockers.push("No successful governed research Skill or retrieval-tool receipt was observed.");
  if (run.providerFamilies.length < 2) {
    blockers.push(`Only ${run.providerFamilies.length} independent external literature provider(s) succeeded; at least 2 are required.`);
  }
  if (!hasSynthesisText) blockers.push("The runtime received no final synthesis text.");
  return blockers;
}

export function qualifyDeepResearchRun(run: DeepResearchRun): DeepResearchRun {
  let next = run;
  if (next.stage === "plan") next = advance(next, "execute", "The final receipt set was closed for evaluation.");
  if (next.stage === "execute") next = advance(next, "evaluate", "The final receipt set was evaluated.");
  const blockers = deepResearchBlockers(next, true);
  if (blockers.length) throw new Error(blockers.join(" "));
  if (next.stage !== "evaluate") throw new Error(`Deep Research cannot synthesize from stage ${next.stage}.`);
  next = advance(next, "synthesize", "All runtime receipt gates passed; synthesis may be released.");
  return writeRun({ ...next, status: "qualified", blockers: [], updatedAt: now() });
}

export function retryDeepResearchRun(run: DeepResearchRun, blockers: string[]): DeepResearchRun {
  let next = run;
  if (next.stage === "execute") next = advance(next, "evaluate", "The attempt ended before all evidence gates passed.");
  if (next.stage === "evaluate") next = advance(next, "plan", "A bounded corrective retrieval attempt is required.");
  return writeRun({
    ...next,
    status: "retrying",
    attempt: next.attempt + 1,
    blockers,
    updatedAt: now(),
  });
}

export function incompleteDeepResearchRun(run: DeepResearchRun, blockers: string[], report?: string): DeepResearchRun {
  const finalReport = report ?? buildDeepResearchIncompleteReport(run, blockers);
  return writeRun({ ...run, status: "incomplete", blockers, finalReport, updatedAt: now() });
}

export function recordDeepResearchGraphWrite(run: DeepResearchRun, graphHash: string): DeepResearchRun {
  return writeRun({ ...run, expectedGraphHash: graphHash, graphWriteHash: graphHash, updatedAt: now() });
}

export function buildDeepResearchCorrectionPrompt(run: DeepResearchRun): string {
  return [
    "",
    "",
    "[NEBULAMAT_INTERNAL_DEEP_RESEARCH]",
    `Deep Research runtime gate rejected the prior synthesis. Starting corrective attempt ${run.attempt} of ${run.maxAttempts}.`,
    `Blocking conditions: ${run.blockers.join(" | ")}`,
    `Successful external provider families so far: ${run.providerFamilies.join(", ") || "none"}.`,
    "Continue from the plan/execute/evaluate stages. Invoke governed scientific Skills or retrieval tools for the missing independent provider families. Do not merely state that a search was performed.",
    "Only successful runtime tool receipts count. The local Knowledge Universe does not count toward the two external providers. After the missing calls, produce one bounded source-grounded synthesis.",
    "[/NEBULAMAT_INTERNAL_DEEP_RESEARCH]",
  ].join("\n");
}

export function buildDeepResearchIncompleteReport(run: DeepResearchRun, blockers: string[]): string {
  const attempted = run.toolReceipts
    .map((receipt) => `${receipt.tool} (${receipt.status}; ${receipt.providerFamilies.join(", ") || "provider unverified"})`)
    .join("; ") || "none";
  return [
    "## Deep Research incomplete",
    "",
    "The runtime withheld the model's synthesis because the evidence contract was not satisfied.",
    "",
    ...blockers.map((blocker) => `- ${blocker}`),
    "",
    `Verified provider families: ${run.providerFamilies.join(", ") || "none"}.`,
    `Observed governed attempts: ${attempted}.`,
    `Knowledge Universe: ${run.knowledge.documentHits.length} document hit(s), ${run.knowledge.graph.matchedNodes.length} matched node(s), ${run.knowledge.graph.edges.length} relationship edge(s).`,
  ].join("\n");
}

/** Hide a server-persisted synthesis after reload unless the runtime gate passed. */
export function projectDeepResearchHistory(messages: HistoryMessage[], run: DeepResearchRun | null): HistoryMessage[] {
  if (!run || run.status === "qualified") return messages;
  let turnStart = -1;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role !== "user") continue;
    const text = message.parts.filter((part) => part.type === "text").map((part) => part.text ?? "").join("").trim();
    if (text === run.query) {
      turnStart = index;
      break;
    }
  }
  if (turnStart < 0) return messages;
  const report = run.finalReport ?? buildDeepResearchIncompleteReport(run, [
    ...run.blockers,
    "Runtime qualification did not complete before history restoration.",
  ]);
  let reportWritten = false;
  return messages.map((message, index) => {
    if (index <= turnStart || message.role !== "assistant") return message;
    const parts = message.parts.filter((part) => part.type !== "text");
    if (!reportWritten) {
      parts.push({ type: "text", text: report });
      reportWritten = true;
    }
    return { ...message, parts };
  });
}
