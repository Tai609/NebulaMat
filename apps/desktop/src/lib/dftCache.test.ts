import { describe, expect, it, beforeEach } from "vitest";
import {
  buildDftCacheKey,
  readDftCache,
  readDftCheckpoint,
  readMaterialsCheckpoint,
  writeDftCache,
  writeDftCheckpoint,
  writeMaterialsCheckpoint,
} from "./dftCache";

describe("DFT cache and checkpoint primitives", () => {
  beforeEach(() => localStorage.clear());

  it("uses model/parameter identity for cache entries", () => {
    const key = buildDftCacheKey({ code: "POSCAR", model: "PBE", parameters: { encut: 520 } });
    writeDftCache({ key, createdAt: 1, output: { energy: -1 }, verified: true });
    expect(readDftCache<{ energy: number }>(key)?.output.energy).toBe(-1);
  });

  it("persists a resumable workflow checkpoint", () => {
    writeDftCheckpoint("wf-1", "dft.audit", "dft:audit:1", "dft-v1-a", true);
    expect(readDftCheckpoint("wf-1")).toMatchObject({ stage: "dft.audit", taskId: "dft:audit:1", resumable: true });
  });

  it("rejects a DFT checkpoint that skips a scheduler stage", () => {
    writeDftCheckpoint("wf-2", "dft.prepare", "dft:prepare:1", "model-a", true);
    expect(() => writeDftCheckpoint("wf-2", "dft.running", "dft:run:1", "model-a", true)).toThrow(
      "Invalid DFT checkpoint transition",
    );
  });

  it("keeps materials design checkpoints outside the DFT scheduler namespace", () => {
    writeMaterialsCheckpoint("materials-1", "materials.goal", "materials:goal:1", "input-a");
    writeMaterialsCheckpoint("materials-1", "materials.evidence", "materials:evidence:1", "input-a");
    expect(readMaterialsCheckpoint("materials-1")).toMatchObject({
      stage: "materials.evidence",
      previousStage: "materials.goal",
      eventId: expect.stringMatching(/^materials-checkpoint_/),
    });
  });
});
