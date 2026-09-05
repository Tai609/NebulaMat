import {
  createInnoClawLiteratureProviderAdapter,
  createInnoClawMetadataEvidenceCardAdapter,
  createInnoClawLiteratureProviderRegistry,
  ResearchRuntime,
} from "@ai4s/sdk";
import {
  listResearchGraphs,
  logDebug,
  writeResearchGraph,
  workspacePath,
} from "./tauri";
import type { ResearchGraph } from "@ai4s/shared";

let runtime: ResearchRuntime | null = null;
let activeWorkspace: string | null = null;
let initialization: Promise<ResearchRuntime> | null = null;
const persistenceQueues = new Map<string, Promise<void>>();

function enqueuePersistence(graph: ResearchGraph, ownerWorkspace: string | null): void {
  const queueKey = `${ownerWorkspace ?? "<unbound>"}\u0000${graph.researchId}`;
  const previous = persistenceQueues.get(queueKey) ?? Promise.resolve();
  const next = previous
    .catch(() => undefined)
    .then(async () => {
      // The Rust command repeats this check immediately before writing. The
      // early check avoids noisy retries when a workspace switch is known.
      if (ownerWorkspace !== null && (await workspacePath()) !== ownerWorkspace) return;
      await writeResearchGraph(graph, ownerWorkspace);
    });
  persistenceQueues.set(queueKey, next);
  void next
    .catch((error) => logDebug(`CEBRO graph persistence failed: ${error instanceof Error ? error.message : String(error)}`))
    .finally(() => {
      if (persistenceQueues.get(queueKey) === next) persistenceQueues.delete(queueKey);
    });
}

function createRuntime(ownerWorkspace: string | null): ResearchRuntime {
  const next = new ResearchRuntime({
    actor: "desktop:research-runtime",
    onGraphChanged: (graph) => enqueuePersistence(graph, ownerWorkspace),
  });
  // Paper Study/Deep Research workers can place a validated Evidence Card in
  // action metadata. The adapter converts it into CEBRO nodes; it never
  // performs network access or mutates the graph outside ResearchRuntime.
  next.registerAdapter(createInnoClawMetadataEvidenceCardAdapter({ source: "desktop:innoclaw-paper-study" }));
  next.registerAdapter(createInnoClawLiteratureProviderAdapter({
    providers: createInnoClawLiteratureProviderRegistry(),
    source: "desktop:innoclaw-paper-study:providers",
  }));
  return next;
}

/**
 * Hydrate the runtime from the active workspace and install its persistence
 * callback. The promise is shared so AppShell and ResearchPage cannot race a
 * workspace load or create duplicate graph runtimes.
 */
export function initializeResearchWorkspace(): Promise<ResearchRuntime> {
  if (initialization) return initialization;
  initialization = (async () => {
    // Workspace selection can change while the list RPC is in flight. Do not
    // publish a runtime until the path used for hydration is still current.
    for (;;) {
      const workspace = await workspacePath();
      if (runtime && activeWorkspace === workspace) return runtime;
      const next = createRuntime(workspace);
      for (const graph of await listResearchGraphs()) {
        try {
          next.hydrateResearch(graph);
        } catch (error) {
          void logDebug(`CEBRO graph ignored during hydration: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      if (await workspacePath() !== workspace) continue;
      runtime = next;
      activeWorkspace = workspace;
      return next;
    }
  })().finally(() => {
    initialization = null;
  });
  return initialization;
}

/** Runtime access for desktop views and future adapter integrations. */
export function getResearchRuntime(): ResearchRuntime {
  if (!runtime) {
    runtime = createRuntime(activeWorkspace);
    activeWorkspace = null;
  }
  return runtime;
}

export function researchWorkspaceKey(): string | null {
  return activeWorkspace;
}
