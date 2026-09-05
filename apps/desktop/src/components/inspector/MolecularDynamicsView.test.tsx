import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MolecularDynamicsView } from "./MolecularDynamicsView";

const setOption = vi.fn();
const dispose = vi.fn();

vi.mock("echarts", () => ({
  init: () => ({
    on: vi.fn(),
    resize: vi.fn(),
    setOption,
    dispose,
  }),
}));

vi.mock("./VaspFlowStructureView", () => ({
  VaspFlowStructureView: ({ trajectoryFrame }: { trajectoryFrame: number }) => <div>frame:{trajectoryFrame}</div>,
}));

const extxyz = `2
Lattice="4 0 0 0 4 0 0 0 12" Properties=species:S:1:pos:R:3:move_mask:L:1 md_step=10 time_fs=5 md_phase=equilibration pbc="T T F"
Cu 0 0 1 F
H 1 1 2 T
2
Lattice="4 0 0 0 4 0 0 0 12" Properties=species:S:1:pos:R:3:move_mask:L:1 md_step=20 time_fs=10 md_phase=production pbc="T T F"
Cu 0 0 1 F
H 1 1 2.1 T
`;

const thermo = `phase,step,time_fs,temperature_k,potential_energy_ev,kinetic_energy_ev,total_energy_ev,max_force_ev_per_angstrom,minimum_distance_angstrom
equilibration,10,5,290,-10,1,-9,0.3,1.2
production,20,10,310,-10.1,1.1,-9,0.2,1.1
`;

describe("MolecularDynamicsView", () => {
  beforeEach(() => {
    setOption.mockClear();
    dispose.mockClear();
  });

  it("keeps the structure frame and thermodynamic metrics synchronized", async () => {
    render(
      <MolecularDynamicsView
        materialId="trajectory-preview.extxyz"
        path="md/seed-7/trajectory-preview.extxyz"
        text={extxyz}
        thermoText={thermo}
        manifestText={'{"protocol":{"temperature_k":300}}'}
      />,
    );

    expect(screen.getByText("frame:0")).toBeInTheDocument();
    expect(screen.getByText("290.0 K")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /last frame|最后一帧/i }));
    expect(screen.getByText("frame:1")).toBeInTheDocument();
    expect(screen.getByText("310.0 K")).toBeInTheDocument();
    await waitFor(() => expect(setOption).toHaveBeenCalled());
  });
});
