import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const fallbackPath = path.join(repoRoot, "apps", "desktop", "src-tauri", "models-dev-fallback.json");
const modelsDevUrl = process.env.NEBULAMAT_MODELS_DEV_URL || "https://models.dev/api.json";
const opencodeGoUrl = "https://opencode.ai/zen/go/v1/models";

async function readJson(url) {
  try {
    const response = await fetch(url, {
      headers: { "user-agent": "NebulaMat model catalog sync" },
    });
    if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}`);
    return response.json();
  } catch (fetchError) {
    // Windows installations commonly have a WinHTTP/IE proxy configured while
    // Node's undici fetch does not inherit it. Reuse PowerShell's proxy-aware
    // client as a fallback instead of making catalog sync fail behind it.
    for (const shell of ["pwsh", "powershell"]) {
      try {
        const escaped = url.replaceAll("'", "''");
        const text = execFileSync(shell, [
          "-NoProfile",
          "-Command",
          `(Invoke-WebRequest -UseBasicParsing -Uri '${escaped}').Content`,
        ], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
        return JSON.parse(text);
      } catch {
        // Try the next shell, then report the original fetch error below.
      }
    }
    throw fetchError;
  }
}

const catalog = await readJson(modelsDevUrl);
const official = await readJson(opencodeGoUrl);
const providers = catalog.providers ?? catalog;
const provider = providers["opencode-go"];
if (!provider || typeof provider !== "object") {
  throw new Error("Models.dev response does not contain an opencode-go provider");
}
provider.models ??= {};
let added = 0;
for (const item of official.data ?? []) {
  const id = String(item?.id ?? "").trim();
  if (!id || provider.models[id]) continue;
  provider.models[id] = { id, name: id, reasoning: true };
  added += 1;
}

await fs.writeFile(fallbackPath, JSON.stringify(catalog));
console.log(JSON.stringify({
  source: modelsDevUrl,
  fallbackPath,
  providers: Object.keys(providers).length,
  opencodeGoModels: Object.keys(provider.models).length,
  officialOpencodeGoModels: (official.data ?? []).length,
  officialModelsAddedToFallback: added,
}, null, 2));
