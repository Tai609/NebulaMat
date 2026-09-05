import { describe, expect, it } from "vitest";
import {
  buildMatterGenRequest,
  buildMatterGenTaskPrompt,
  serializeMatterGenRequest,
  validateMatterGenRequest,
} from "./mattergen";

describe("MatterGen request contract", () => {
  it("creates a bounded chemical-system request", () => {
    const request = buildMatterGenRequest({ chemicalSystem: "Li-Fe-Mn-Mg-P-O", samples: 80 });
    expect(request.batch_size).toBe(64);
    expect(request.properties_to_condition_on).toEqual({ chemical_system: "Li-Fe-Mn-Mg-P-O" });
    expect(request.standardization.surface_target_atoms).toBe(96);
    expect(request.standardization.surface_min_lateral_angstrom).toBe(12);
    expect(validateMatterGenRequest(request)).toEqual([]);
  });

  it("rejects unsafe paths and oversized batches", () => {
    const request = buildMatterGenRequest({ chemicalSystem: "Li-O", samples: 2 });
    expect(validateMatterGenRequest({ ...request, output_dir: "../outside" })).toContain("output_dir must be workspace-relative");
    expect(validateMatterGenRequest({ ...request, batch_size: 64, num_batches: 32 })).toContain("requested samples exceed 1024");
  });

  it("serializes a request and names the preflight command", () => {
    const request = buildMatterGenRequest({ chemicalSystem: "Li-O", samples: 4 });
    const json = serializeMatterGenRequest(request);
    expect(JSON.parse(json).schema_version).toBe(1);
    expect(buildMatterGenTaskPrompt(request)).toContain("--dry-run");
    expect(buildMatterGenTaskPrompt(request)).toContain("科学计算环境点击 MatterGen 权重的安装按钮");
    expect(buildMatterGenTaskPrompt(request)).toContain("mattergen-run.json");
    expect(buildMatterGenTaskPrompt(request)).toContain("standardize_mattergen_structure");
    expect(buildMatterGenTaskPrompt(request)).toContain("原子数不变");
    expect(buildMatterGenTaskPrompt(request)).toContain("三者全部先弛豫且全部收敛后才能求能");
    expect(buildMatterGenTaskPrompt(request)).toContain("自建直接单点能脚本一律保持 hold");
  });
});
