import { describe, expect, it } from "vitest";
import {
  nearestFrameIndexForStep,
  parseExtxyzTrajectory,
  parseUmaThermoCsv,
  thermoRowForFrame,
} from "./mdTrajectory";

const frame = (step: number, x: number) => `3
Lattice="4 0 0 1 4 0 0 0 15" Properties=species:S:1:pos:R:3:move_mask:L:1:atom_role:S:1 md_step=${step} time_fs=${step * 0.5} md_phase=production md_seed=1729 pbc="T T F"
Cu ${x} 0 0 F substrate
O 1 0 2 T substrate
H 1 0 3 T adsorbate
`;

describe("ASE molecular dynamics trajectory parsing", () => {
  it("parses multi-frame EXTXYZ metadata, a triclinic cell, roles, and fixed atoms", () => {
    const trajectory = parseExtxyzTrajectory(frame(10, 0) + frame(20, 0.1), "trajectory.extxyz");
    expect(trajectory.totalFrames).toBe(2);
    expect(trajectory.sampled).toBe(false);
    expect(trajectory.frames[1]).toMatchObject({ step: 20, timeFs: 10, phase: "production", seed: 1729 });
    expect(trajectory.frames[0].structure).toMatchObject({
      pbc: [true, true, false],
      lattice: { matrix: [[4, 0, 0], [1, 4, 0], [0, 0, 15]] },
    });
    expect(trajectory.frames[0].structure.sites[0].properties).toEqual({ fixed: true, role: "substrate" });
    expect(trajectory.frames[0].structure.sites[2].properties).toEqual({ fixed: false, role: "adsorbate" });
  });

  it("uniformly samples long trajectories while retaining the first and final frames", () => {
    const text = Array.from({ length: 10 }, (_, index) => frame(index, index / 10)).join("");
    const trajectory = parseExtxyzTrajectory(text, "trajectory.extxyz", 4);
    expect(trajectory.sampled).toBe(true);
    expect(trajectory.totalFrames).toBe(10);
    expect(trajectory.frames.map((item) => item.sourceIndex)).toEqual([0, 3, 6, 9]);
  });

  it("parses UMA thermodynamics and aligns them to trajectory steps", () => {
    const rows = parseUmaThermoCsv([
      "phase,step,time_fs,temperature_k,potential_energy_ev,kinetic_energy_ev,total_energy_ev,max_force_ev_per_angstrom,minimum_distance_angstrom",
      "equilibration,10,5,280,-10,1,-9,0.4,1.2",
      "production,20,10,301,-10.2,1.1,-9.1,0.3,1.1",
    ].join("\n"));
    expect(rows).toHaveLength(2);
    expect(rows[1]).toMatchObject({ phase: "production", temperatureK: 301, minimumDistanceAngstrom: 1.1 });
    const trajectory = parseExtxyzTrajectory(frame(10, 0) + frame(20, 0.1));
    expect(thermoRowForFrame(trajectory.frames[1], 1, 2, rows)?.step).toBe(20);
    expect(nearestFrameIndexForStep(trajectory.frames, 18)).toBe(1);
  });
});
