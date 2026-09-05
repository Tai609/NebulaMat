import {
  innoClawEvidenceCardToResearchNodes,
  validateInnoClawEvidenceCard,
  type InnoClawEvidenceCard,
} from "@ai4s/shared";
import type { ResearchActionType, ResearchMode } from "@ai4s/shared";
import type {
  ResearchActionAdapter,
  ResearchActionAdapterContext,
  ResearchActionExecution,
} from "./researchRuntime";
import type { InnoClawLiteratureProvider, InnoClawLiteratureProviderId } from "./literatureProviders";

export interface InnoClawEvidenceCardAdapterOptions {
  id?: string;
  modes?: readonly ResearchMode[];
  actionTypes?: readonly ResearchActionType[];
  source?: string;
  /** Resolve a card from Paper Study, a provider connector, or an agent artifact. */
  resolveCard: (context: ResearchActionAdapterContext) => Promise<InnoClawEvidenceCard | null> | InnoClawEvidenceCard | null;
}

/**
 * Adapter boundary for InnoClaw Paper Study/Evidence Card output.
 *
 * The provider owns retrieval; this adapter only validates and converts the
 * result into CEBRO artifact/evidence nodes. A missing card is inconclusive,
 * never fabricated evidence.
 */
export function createInnoClawEvidenceCardAdapter(
  options: InnoClawEvidenceCardAdapterOptions,
): ResearchActionAdapter {
  const modes = options.modes ?? ["hybrid", "theory", "computation", "experiment"];
  const actionTypes = options.actionTypes ?? ["retrieve", "observe"];
  return {
    id: options.id ?? "innoclaw:evidence-card",
    modes,
    actionTypes,
    capabilities: {
      version: "1.0.0",
      modes,
      actionTypes,
      safetyClasses: ["read-only"],
      replayability: ["manual"],
      externalEffects: false,
    },
    async execute(context): Promise<ResearchActionExecution> {
      const raw = await options.resolveCard(context);
      if (!raw) {
        return {
          status: "inconclusive",
          summary: "InnoClaw provider returned no evidence card; no evidence was added.",
        };
      }
      const card = validateInnoClawEvidenceCard(raw);
      const relationCandidate = context.action.metadata?.evidenceRelation;
      const relation = ["supports", "refutes", "qualifies", "inconclusive"].includes(String(relationCandidate))
        ? relationCandidate as "supports" | "refutes" | "qualifies" | "inconclusive"
        : undefined;
      const nodes = innoClawEvidenceCardToResearchNodes(card, {
        actionId: context.action.id,
        branchId: context.action.branchId,
        now: Date.now(),
        source: options.source,
        relation,
      });
      return {
        status: card.retrievalStatus === "empty" || card.retrievalStatus === "failed_retrieval" ? "inconclusive" : "completed",
        summary: `Converted InnoClaw evidence card ${card.id} (${card.sourcesFound}/${card.sourcesAttempted} sources) into CEBRO nodes.`,
        artifacts: [nodes.artifact],
        evidence: [nodes.evidence],
      };
    },
  };
}

/** Resolve a card placed in an action's metadata by a Paper Study/worker host. */
export function resolveInnoClawEvidenceCardFromMetadata(
  context: ResearchActionAdapterContext,
): InnoClawEvidenceCard | null {
  const candidate = context.action.metadata?.innoclawEvidenceCard ?? context.action.metadata?.evidenceCard;
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return null;
  return candidate as InnoClawEvidenceCard;
}

/** A zero-network adapter useful while wiring Paper Study: the provider puts a
 * validated card into action metadata, then the same runtime path is used. */
export function createInnoClawMetadataEvidenceCardAdapter(
  options: Omit<InnoClawEvidenceCardAdapterOptions, "resolveCard"> = {},
): ResearchActionAdapter {
  return createInnoClawEvidenceCardAdapter({
    ...options,
    resolveCard: resolveInnoClawEvidenceCardFromMetadata,
  });
}

/** Network-backed Paper Study adapter. The provider owns HTTP retrieval; the
 * runtime still owns validation, graph mutation, provenance and readiness. */
export function createInnoClawLiteratureProviderAdapter(options: {
  providers: Partial<Record<InnoClawLiteratureProviderId, InnoClawLiteratureProvider>>;
  id?: string;
  source?: string;
}): ResearchActionAdapter {
  return createInnoClawEvidenceCardAdapter({
    id: options.id ?? "innoclaw:literature-provider",
    source: options.source ?? "desktop:innoclaw-literature-provider",
    resolveCard: async (context) => {
      const metadata = context.action.metadata ?? {};
      const query = typeof metadata.literatureQuery === "string" ? metadata.literatureQuery.trim() : "";
      if (!query) return null;
      const providerId = typeof metadata.literatureProvider === "string" ? metadata.literatureProvider as InnoClawLiteratureProviderId : "arxiv";
      const provider = options.providers[providerId];
      if (!provider) throw new Error(`Unknown InnoClaw literature provider: ${providerId}`);
      const maxResults = typeof metadata.maxResults === "number" ? metadata.maxResults : undefined;
      return provider.search({ query, maxResults, signal: context.signal });
    },
  });
}
