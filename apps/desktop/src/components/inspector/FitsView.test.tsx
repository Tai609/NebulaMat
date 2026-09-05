import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { FitsView } from "./FitsView";
import { FITS_IMAGE_2D_B64, FITS_SPECTRUM_1D_B64 } from "@/lib/fits.fixtures";

function toBuffer(b64: string): ArrayBuffer {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}

describe("FitsView", () => {
  it("mounts the image viewer with dimensions, unit, and stretch/colormap controls", () => {
    const { container } = render(<FitsView filename="sky.fits" bytes={toBuffer(FITS_IMAGE_2D_B64)} />);
    expect(container.textContent).toContain("sky.fits");
    expect(container.textContent).toContain("8×8");
    expect(container.textContent).toContain("Jy/beam");
    expect(container.querySelector("canvas")).not.toBeNull();
    // stretch + colormap segmented controls are present
    for (const label of ["linear", "log", "asinh", "magma", "viridis", "gray"]) {
      expect(screen.getByRole("button", { name: label })).toBeInTheDocument();
    }
  });

  it("renders the spectrum viewer as an SVG line for 1D data", () => {
    const { container } = render(
      <FitsView filename="spec.fits" bytes={toBuffer(FITS_SPECTRUM_1D_B64)} />,
    );
    expect(screen.getByText(/spectrum · 16 samples/)).toBeInTheDocument();
    const path = container.querySelector("path");
    expect(path).not.toBeNull();
    expect(path!.getAttribute("d")!.startsWith("M")).toBe(true);
    // WAVE axis label from CTYPE1
    expect(screen.getByText(/WAVE/)).toBeInTheDocument();
  });

  it("shows a friendly error for a non-FITS buffer", () => {
    render(<FitsView filename="bad.fits" bytes={new Uint8Array([1, 2, 3, 4]).buffer} />);
    expect(screen.getByText(/Could not read this FITS file/)).toBeInTheDocument();
  });
});
