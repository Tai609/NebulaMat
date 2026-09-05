import { describe, expect, it } from "vitest";
import type { ProviderInfo } from "@ai4s/sdk";
import {
  fallbackDefaultModel,
  filterSelectableProviders,
  filterModelOptions,
  flattenModelOptions,
  type ModelFilter,
} from "./modelCatalog";

const providers: ProviderInfo[] = [
  {
    id: "openai",
    name: "OpenAI",
    models: [
      { id: "gpt-5.2", name: "GPT-5.2" },
      { id: "o3", name: "o3" },
    ],
  },
  {
    id: "ollama-cloud",
    name: "Ollama Cloud",
    models: [{ id: "qwen3-coder", name: "Qwen3 Coder" }],
  },
];

const options = flattenModelOptions(providers);
const favorites = ["openai/o3", "missing/model"];
const recent = ["ollama-cloud/qwen3-coder", "openai/gpt-5.2", "missing/model"];

describe("model catalog", () => {
  it("keeps both bundled and user-configured routes selectable", () => {
    expect(filterSelectableProviders([
      { id: "deepseek-official", name: "DeepSeek", models: [{ id: "deepseek-v4-flash", name: "DeepSeek V4 Flash" }] },
      { id: "opencode-go", name: "OpenCode Go", models: [{ id: "qwen3.7-max", name: "Qwen3.7 Max" }] },
    ]).map((provider) => provider.id)).toEqual(["deepseek-official", "opencode-go"]);
  });

  it("flattens providers into canonical model options without changing order", () => {
    expect(options.map((m) => m.key)).toEqual([
      "openai/gpt-5.2",
      "openai/o3",
      "ollama-cloud/qwen3-coder",
    ]);
  });

  it.each([
    ["gpt-5.2", ["openai/gpt-5.2"]],
    ["QWEN3", ["ollama-cloud/qwen3-coder"]],
    ["ollama cloud", ["ollama-cloud/qwen3-coder"]],
    ["OPENAI", ["openai/gpt-5.2", "openai/o3"]],
  ])("searches model names, ids, and providers with query %s", (query, expected) => {
    expect(filterModelOptions(options, { kind: "all" }, query, favorites, recent).map((m) => m.key))
      .toEqual(expected);
  });

  it("filters favorites while keeping unavailable favorites outside the visible list", () => {
    expect(filterModelOptions(options, { kind: "favorites" }, "", favorites, recent).map((m) => m.key))
      .toEqual(["openai/o3"]);
  });

  it("preserves recent preference order", () => {
    expect(filterModelOptions(options, { kind: "recent" }, "", favorites, recent).map((m) => m.key))
      .toEqual(["ollama-cloud/qwen3-coder", "openai/gpt-5.2"]);
  });

  it("limits a provider filter (an empty query filters nothing away)", () => {
    const filter: ModelFilter = { kind: "provider", providerID: "openai" };
    expect(filterModelOptions(options, filter, "", favorites, recent).map((m) => m.key))
      .toEqual(["openai/gpt-5.2", "openai/o3"]);
    expect(filterModelOptions(options, { kind: "all" }, "", favorites, recent)).toHaveLength(3);
  });
});

describe("fallbackDefaultModel", () => {
  it("leaves an available default alone", () => {
    expect(fallbackDefaultModel(providers, "openai/o3")).toBeNull();
  });

  it("re-points a renamed model at the same provider's first model", () => {
    expect(fallbackDefaultModel(providers, "openai/gpt-4-old")).toBe("openai/gpt-5.2");
  });

  it("falls back to the first provider when the default's provider is gone", () => {
    expect(fallbackDefaultModel(providers, "mydog/gpt-5.6-sol")).toBe("openai/gpt-5.2");
  });

  it("has nothing to offer when no models exist", () => {
    expect(fallbackDefaultModel([], "openai/o3")).toBeNull();
    expect(fallbackDefaultModel([{ id: "empty", name: "Empty", models: [] }], "empty/x")).toBeNull();
  });
});
