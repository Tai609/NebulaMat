import type { SkillInfo } from "@ai4s/sdk";

export type ResearchAssistantMode = "deep-research" | "scientific-assistant" | "experiment-log";

/** Stable marker so runtime history restoration can keep this orchestration
 *  instructions out of the user-visible transcript. */
export const DEEP_RESEARCH_CONTEXT_START = "[NEBULAMAT_INTERNAL_DEEP_RESEARCH]";
export const DEEP_RESEARCH_CONTEXT_END = "[/NEBULAMAT_INTERNAL_DEEP_RESEARCH]";

/**
 * Scientific skills that make up the Deep Research lane. The list is an
 * allow-list of names, not an assumption that every installation has every
 * skill; the prompt reports availability and asks the agent to degrade
 * explicitly when a connector is missing.
 */
export const DEEP_RESEARCH_SKILLS = [
  "aris-research-lit",
  "aris-arxiv",
  "aris-openalex",
  "aris-semantic-scholar",
  "aris-deepxiv",
  "aris-research-pipeline",
  "aris-research-review",
  "aris-citation-audit",
  "aris-paper-claim-audit",
  "aris-integrity-forensics",
  "aris-proof-checker",
  "aris-analyze-results",
  "aris-experiment-audit",
  "aris-reproducible-research",
  "literature-review",
  "citation-reviewer",
  "stats-integrity",
  "traceability-review",
  "nature-academic-search",
  "nature-downloader",
  "nature-paper-card",
  "nature-ref-verifier",
  "nature-statistics",
] as const;

const DATABASES = [
  "PubMed/NCBI",
  "arXiv",
  "OpenAlex",
  "Semantic Scholar",
  "Crossref",
  "Europe PMC",
] as const;

export const SCIENTIFIC_ASSISTANT_TOOL_ROUTES = [
  "Periodic DFT -> VASP or CP2K",
  "Molecular quantum chemistry -> Gaussian, with Multiwfn for validated wavefunction post-processing",
  "Molecular and classical dynamics -> LAMMPS or GROMACS",
  "Machine-learning potentials -> MatterSim, UMA, DeePMD, or the declared general MLP workflow",
  "Structure construction -> pymatgen, ASE, RDKit, or CatKit",
  "Phonons and thermochemistry -> Phonopy or VASPKIT",
  "Catalytic kinetics -> CatMAP, Cantera, OpenMKM, or kmos",
  "Electronic-structure post-processing -> LOBSTER, Bader, or VASPKIT",
  "Visualization -> VASPFlow scene, OVITO, PyVista, or VMD",
] as const;

function compact(value: string, max = 620): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > max ? `${normalized.slice(0, max - 1)}…` : normalized;
}

function availableNames(skills: readonly SkillInfo[] | readonly string[] | undefined): string[] {
  if (!skills?.length) return [];
  return skills
    .map((skill) => typeof skill === "string" ? skill : skill.name)
    .filter((name): name is string => typeof name === "string" && name.trim().length > 0);
}

/**
 * Build the model-facing instructions for the host-enforced Deep Research
 * state machine. DSH remains the sole agent loop; the desktop verifies stages,
 * tool receipts, provider coverage and CEBRO writes before exposing synthesis.
 */
export function buildDeepResearchPrompt(
  query: string,
  options: { skills?: readonly SkillInfo[] | readonly string[]; graphContext?: string } = {},
): string {
  const available = new Set(availableNames(options.skills));
  const selected = DEEP_RESEARCH_SKILLS.filter(
    (name) => options.skills === undefined || available.has(name),
  );
  const skillLine = selected.length
    ? selected.map((name) => `/${name}`).join(", ")
    : "No curated skill was reported by the host. Inspect the runtime skill catalog and governed MCP/tools, then report any capability gap.";
  const databaseLine = DATABASES.join(", ");
  const graph = options.graphContext?.trim();
  return [
    DEEP_RESEARCH_CONTEXT_START,
    "Deep Research mode is enabled. The host enforces a six-stage CEBRO-inspired state machine and withholds synthesis until runtime evidence gates pass.",
    `Research question: ${compact(query, 1_200)}`,
    "Run the following stages in order: inspect the workspace and existing evidence; hypothesize competing explanations; plan the lowest-cost discriminating retrieval or analysis; execute safe read-only/reversible work; evaluate source quality and contradictions; synthesize a bounded answer. Tool execution receipts, not prose, drive the host transitions from plan through evaluate and synthesize.",
    "Use specialist lanes when useful: librarian (retrieval and metadata), researcher (mechanism/derivation), skeptic (falsifiers and competing explanations), reproducer (independent calculation or code check), and scribe (citation-complete synthesis). Keep lane assumptions separate and do not merge them silently.",
    `Actively invoke the relevant scientific skills, especially: ${skillLine}. Also inspect all installed skills for a closer domain match. Use a skill's slash command or its documented governed tool instead of simulating a search in prose.`,
    `For every literature-bearing question, invoke at least one governed retrieval skill or database tool and search at least two independent providers before synthesis: ${databaseLine}. The local knowledge base is useful context but does not count as one of those two external providers. Only successful tool receipts count; a sentence claiming that a search occurred does not. Do not answer literature claims from model memory alone. Prefer primary papers, record DOI/PMID/arXiv IDs, authors, year, venue, URL, retrieval date, and the exact evidence excerpt. Deduplicate records across providers.`,
    "If fewer than two independent providers or no governed retrieval capability is available, list each attempted capability/provider and its concrete failure or access gap. Clearly label the resulting answer as incomplete; never imply that a database search succeeded when it did not.",
    "Use the supplied Knowledge Universe receipt first, including exact document source IDs, matched and adjacent node IDs, and listed relationship edges; then use external sources. Preserve those identifiers and distinguish quoted observations, author interpretations, model-derived proxies, and your own inference. Never invent or relabel a graph edge.",
    "For every material conclusion, provide an evidence ledger with supporting, refuting, qualifying and missing evidence. State uncertainty, search coverage, publication bias, and conflicts. Never upgrade a claim to established merely because several records share a source, model, codebase, or dataset.",
    "Do not submit remote jobs, spend paid compute, operate instruments, contact people, modify external systems, or perform irreversible writes without the existing approval flow. If a step needs approval, propose it with cost, risk, reversibility, controls and a falsifier instead of executing it.",
    "Return a concise answer followed by: (1) methods and databases searched, (2) cited evidence table, (3) competing hypotheses and falsifiers, (4) limitations and next discriminating action, and (5) a reproducibility note. Cite every time-sensitive or quantitative statement.",
    ...(graph ? ["Current CEBRO context (source of truth; do not rewrite it in prose):", graph] : []),
    DEEP_RESEARCH_CONTEXT_END,
  ].join("\n\n");
}

export function buildSpecialistResearchPrompt(
  query: string,
  mode: Exclude<ResearchAssistantMode, "deep-research">,
): string {
  const shared = [
    DEEP_RESEARCH_CONTEXT_START,
    `Selected NebulaMat research lane: ${mode}.`,
    `User request: ${compact(query, 1_200)}`,
    "Select only the capabilities needed for this request. Do not run every available scientific tool as a fixed pipeline, and never present a proxy, generated structure, or model estimate as experimental evidence.",
  ];
  if (mode === "scientific-assistant") {
    const routeCatalog = SCIENTIFIC_ASSISTANT_TOOL_ROUTES.join("; ");
    return [
      ...shared,
      `Act as the scientific assistant for computational materials and chemistry work. First classify the request into one or more of these routes, then activate only the matching tool family: ${routeCatalog}. MatterGen remains a candidate-generation route, not a stability or synthesizability validator.`,
      "At planning time, state the selected route or routes, chosen tools, required inputs, expected outputs, and why adjacent tools were excluded. Do not run the catalog as a fixed pipeline. When the scientific method would change materially between engines, ask for the missing method choice instead of silently substituting the available executable.",
      "Before using an engine, model, or post-processor, inspect the installed skill catalog and runtime capability status. Report configured, discovered, ready, and missing separately: a bundled skill or reference document is not proof that an external binary, model weight, license, pseudopotential, basis set, force field, or cluster module is executable. If the preferred route is unavailable, report the concrete gap and offer only scientifically valid alternatives.",
      "For a new materials workflow, call the materials capability inventory first and create a capability plan containing only the required database, MatterGen, structure, simulation, post-processing, kinetics, visualization, or reporting stages. Preserve engine and model identity, checkpoint hashes, software versions, input hashes, units, convergence state, and uncertainty. Never mix energies from different engines or models in one physical expression.",
      "Use route-specific boundaries. MatterSim is a bulk energy/force/stress and relaxation proxy; UMA is limited to its declared adsorption or OC25/surface-MD tasks; Multiwfn analyzes validated molecular wavefunctions rather than replacing Gaussian; CatMAP is mean-field microkinetics, Cantera/OpenMKM is reactor-level validation, and kmos is for explicitly spatial lattice kinetics; VASPKIT is optional and requires a concrete DOS/PDOS, work-function, trajectory, or thermochemistry deliverable.",
      "Prefer VASPFlow's shared data tools (vasp_scan, vasp_convergence, vasp_structure_scene, vasp_task_files, vasp_read_file) for VASP directories, outputs, and interactive structure scenes. Use OVITO for reproducible atomistic or trajectory rendering, PyVista for volumetric fields, and VMD for molecular or trajectory inspection only when their corresponding runtime is ready. Do not restore the retired NebulaMat crystal-viewer route.",
      "Before any VASP or other remote, paid, or high-cost submission, stop after preparing and validating inputs. Report the engine/model, atom count, free/fixed layers or molecular degrees of freedom, cell or coverage, k-points or basis/force-field choices, memory, walltime, accelerator and run count, plus a lower-cost alternative, then obtain explicit user approval. Do not infer submission approval from this mode being selected.",
      DEEP_RESEARCH_CONTEXT_END,
    ].join("\n");
  }
  return [
    ...shared,
    "Act as the experiment-record assistant. Read only the uploaded notes, images, audio transcripts, tables, and instrument exports that are actually available. Extract purpose, date, experimenter, system, sample batch, materials, equipment, procedure, parameters, observations, characterization, results, anomalies, conclusion, and next steps. Never guess a missing temperature, sample identifier, amount, unit, instrument, or outcome; mark it as missing and ask a focused follow-up when it blocks normalization.",
    "Keep raw attachments immutable. A database draft supplies an experiment id and raw archive path; preserve both. Write the normalized JSON receipt to .openscience/experiment-inbox/<exp_id>.json and the readable YAML-frontmatter Markdown log to wiki/实验日志/<system>/<experiment_type>/<exp_id>.md. The JSON must retain source_files, raw_dir, standardized_path, missing_fields, anomaly, tags, metadata, and a concise evidence-grounded summary.",
    "Use experiment ids in the form <SYSTEM>-<DEVICE>-YYMMDD-<NNN> and stable sample batches in the form <SYSTEM>-<CANDIDATE>-B<NNN> when those components are known. Allowed default device codes are M (muffle furnace), T (tube furnace), E (electrochemistry), G (glovebox), F (controlled-atmosphere furnace), and B (general); unknown equipment remains B only when the user explicitly accepts the general category.",
    "Do not call literature, VASP, MatterGen, MatterSim, UMA, or remote-compute tools merely because they are installed. Use analysis tools only when an uploaded record contains corresponding data and the requested normalization requires them.",
    DEEP_RESEARCH_CONTEXT_END,
  ].join("\n");
}
