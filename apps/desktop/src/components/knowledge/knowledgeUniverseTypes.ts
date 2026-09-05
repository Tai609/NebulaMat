import type { KnowledgeUniverseNode } from "@/lib/tauri";

export const UNIVERSE_CATEGORIES = [
  "chemical",
  "synthesis",
  "characterization",
  "testing",
  "structure",
  "data",
  "other",
] as const;

export type UniverseCategory = (typeof UNIVERSE_CATEGORIES)[number];

export const UNIVERSE_COLORS: Record<UniverseCategory, string> = {
  chemical: "#58a6ff",
  synthesis: "#c084fc",
  characterization: "#2dd4bf",
  testing: "#fb923c",
  structure: "#a3e635",
  data: "#f472b6",
  other: "#94a3b8",
};

const CATEGORY_HINTS: ReadonlyArray<[UniverseCategory, readonly string[]]> = [
  ["chemical", ["chemical", "chemical_entity", "material", "electrolyte", "element", "electrode", "sample", "adsorbate", "catalyst", "compound", "reagent", "precursor", "solvent"]],
  ["synthesis", ["synthesis", "process", "reaction", "preparation", "fabrication", "calcination", "annealing", "coating", "deposition", "mixing", "drying", "synthesis_step"]],
  ["characterization", ["characterization", "measurement", "spectrum", "peak", "technique", "instrument", "equipment", "spectroscopy", "microscopy", "diffraction", "analyzer", "detector"]],
  ["testing", ["testing", "test", "parameter", "condition", "experimental_condition", "performance", "metric", "potential", "current", "voltage", "capacity", "cycle", "temperature", "pressure", "duration"]],
  ["structure", ["structure", "atom", "bond", "orbital", "crystal_plane", "structural_feature", "facet", "lattice", "phase"]],
  ["data", ["data", "data_point", "dataset", "figure", "image", "annotation", "axis", "chart", "table", "plot"]],
];

function normalized(value: string): string {
  return value.trim().toLocaleLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, "_").replace(/^_+|_+$/g, "");
}

function matchesHint(value: string, hint: string): boolean {
  return value === hint
    || value.startsWith(`${hint}_`)
    || value.endsWith(`_${hint}`)
    || value.includes(`_${hint}_`);
}

function classify(value: string): UniverseCategory {
  if (!value || value === "concept" || value === "entity" || value === "method") return "other";
  for (const [category, hints] of CATEGORY_HINTS) {
    if (hints.some((hint) => matchesHint(value, hint))) return category;
  }
  return "other";
}

/** Prefer the extracted raw node type, then use its real graph section as fallback. */
export function universeType(nodeType: string, cluster = ""): UniverseCategory {
  const fromType = classify(normalized(nodeType));
  return fromType === "other" ? classify(normalized(cluster)) : fromType;
}

export function universeNodeType(node: Pick<KnowledgeUniverseNode, "nodeType" | "cluster">): UniverseCategory {
  return universeType(node.nodeType, node.cluster);
}

export function universeColor(nodeType: string, cluster = ""): string {
  return UNIVERSE_COLORS[universeType(nodeType, cluster)];
}

/** Theme-aware category color for DOM controls that mirror the graph palette. */
export function universeThemeColor(nodeType: string, cluster = ""): string {
  const category = universeType(nodeType, cluster);
  const seriesIndex = UNIVERSE_CATEGORIES.indexOf(category) + 1;
  return `var(--series-${seriesIndex})`;
}
