import { describe, expect, it } from "vitest";
import { parseFits, pixelToWorld, type FitsImage, type FitsSpectrum } from "./fits";
import { FITS_IMAGE_2D_B64, FITS_SPECTRUM_1D_B64 } from "./fits.fixtures";

function toBuffer(b64: string): ArrayBuffer {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}

describe("parseFits — 2D image (real astropy file)", () => {
  const r = parseFits(toBuffer(FITS_IMAGE_2D_B64)) as FitsImage;

  it("reads dimensions and BITPIX float data", () => {
    expect(r.kind).toBe("image");
    expect(r.width).toBe(8);
    expect(r.height).toBe(8);
    expect(r.data.length).toBe(64);
  });

  it("decodes big-endian float32 values (row-major ramp 0..63)", () => {
    expect(r.data[0]).toBeCloseTo(0, 5);
    expect(r.data[1]).toBeCloseTo(1, 5);
    expect(r.data[63]).toBeCloseTo(63, 5);
    expect(r.min).toBeCloseTo(0, 5);
    expect(r.max).toBeCloseTo(63, 5);
  });

  it("extracts the WCS keywords", () => {
    expect(r.wcs.ctype1).toBe("RA---TAN");
    expect(r.wcs.crval1).toBeCloseTo(150.0, 6);
    expect(r.wcs.crval2).toBeCloseTo(2.2, 6);
    expect(r.wcs.cdelt1).toBeCloseTo(-0.001, 6);
    expect(r.bunit).toBe("Jy/beam");
  });

  it("computes a finite display range", () => {
    expect(r.lo).toBeLessThanOrEqual(r.hi);
    expect(Number.isFinite(r.lo)).toBe(true);
    expect(Number.isFinite(r.hi)).toBe(true);
  });

  it("maps the reference pixel to its world coordinate", () => {
    // At CRPIX (4.5, 4.5) the world coord is exactly CRVAL.
    const w = pixelToWorld(r.wcs, 3.5, 3.5); // 0-based px 3.5 == FITS 4.5
    expect(w).not.toBeNull();
    expect(w!.lat).toBeCloseTo(2.2, 6);
    expect(w!.lon).toBeCloseTo(150.0, 4);
  });
});

describe("parseFits — 1D spectrum (real astropy file)", () => {
  const r = parseFits(toBuffer(FITS_SPECTRUM_1D_B64)) as FitsSpectrum;

  it("reads a 1D array and its linear world axis", () => {
    expect(r.kind).toBe("spectrum");
    expect(r.length).toBe(16);
    expect(r.data[0]).toBeCloseTo(0, 5);
    expect(r.data[1]).toBeCloseTo(3, 5); // int16 values 0,3,6,...
    expect(r.data[15]).toBeCloseTo(45, 5);
    expect(r.x0).toBeCloseTo(4000, 6); // CRVAL1 at pixel 1
    expect(r.dx).toBeCloseTo(2, 6);
    expect(r.ctype1).toBe("WAVE");
  });
});

describe("parseFits — errors", () => {
  it("rejects a non-FITS buffer", () => {
    const bad = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]).buffer;
    expect(() => parseFits(bad)).toThrow(/SIMPLE/);
  });
});
