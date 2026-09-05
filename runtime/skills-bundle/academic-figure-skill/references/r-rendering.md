# R PNG Rendering Rules

Three non-negotiable rules. Skipping any produces poor-quality PNG output — the #1 recurring bug in Academic Figure Skill.

## 1. `png(type="cairo")` — NOT ggsave for PNG

ggsave cannot pass `type="cairo"` to the underlying device. Always use:
```r
png("output.png", width=2.559, height=2.559, units="in", res=300, type="cairo")
print(plot)
dev.off()
```

For PDF, ggsave with cairo_pdf IS correct:
```r
ggsave("output.pdf", plot, width=183, height=85, units="mm", device=cairo_pdf, dpi=300)
```

## 2. Turn OFF showtext_auto() before png()

showtext converts text glyphs to vector paths. In PDF output (vector) this is fine — paths scale infinitely. In PNG output (raster), paths rasterized at 300dpi on a 183mm canvas produce jagged text edges. Cairo's native font renderer produces smooth anti-aliased glyphs.

```r
showtext_auto(FALSE)
png("output.png", ..., type="cairo")
print(plot)
dev.off()
showtext_auto(TRUE)  # re-enable for subsequent plots
```

If showtext_auto was never enabled in the script (no `showtext_auto()` call), skip the disable step. The key is: the `png(type="cairo")` call must NOT have showtext active.

## 3. Spec-correct dimensions

Never hardcode `width=4, height=4` in an R `png()` call. Width and height MUST match the panel spec from the composition engine. For a 65mm panel at 300dpi:

```python
# Python — compose.py provides this
spec = {"width_mm": 65, "height_mm": 65, "dpi": 300}
r_call = compose.r_png_device(spec, "panel_output.png")
# → png("panel_output.png", width=2.559, height=2.559, units="in", res=300, type="cairo")
```

## Why these three rules exist

R's default `png()` device on Windows uses the GDI rendering backend, which has no anti-aliasing for text at < 8pt. Cairo matches Python's FreeType/Agg text quality. The combination of (1) Cairo device + (2) native font rendering + (3) exact size matching ensures R panels render identically to Python panels in the final composition.
