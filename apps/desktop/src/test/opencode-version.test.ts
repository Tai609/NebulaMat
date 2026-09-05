import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { DSH_VERSION } from "@ai4s/sdk";

/**
 * The supported DeepSeek Harness protocol version is intentionally pinned in
 * the SDK adapter. Keep this test small and local because the actual `dsh`
 * binary is supplied by the host installation or release bundle.
 */
describe("DeepSeek Harness protocol version", () => {
  const root = resolve(process.cwd(), "../..");
  const read = (path: string) => readFileSync(resolve(root, path), "utf8");

  it("is a bare semver", () => {
    expect(DSH_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("is documented by the DSH adapter", () => {
    const sdkReadme = read("packages/sdk/README.md");
    expect(sdkReadme).toContain("DSH_VERSION");
    expect(sdkReadme).toContain("dsh --profile web");
  });

  it("starts through the DSH profile", () => {
    const harnessReadme = read("runtime/harness/README.md");
    expect(harnessReadme).toContain("dsh --profile web");
  });
});
