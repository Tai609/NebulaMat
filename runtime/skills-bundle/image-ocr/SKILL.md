---
name: image-ocr
description: Read and transcribe the text visible inside an image file (PNG/JPG/JPEG/WebP/BMP/GIF) using the built-in Windows Media.Ocr OCR engine, with NO external credential or network required. Use this whenever the model cannot read an image directly, the VISION_API_KEY credential is missing, or the user pastes/attaches a screenshot and asks what it says or what is in it. Also computes image dimensions/format so the agent can describe scene context. English and Chinese (and other installed Windows OCR languages) supported.
---

# Image OCR (offline local OCR)

This skill gives a text-only agent a fully local, credential-free way to "see"
the text inside an image, using the OCR engine that ships with Windows 10/11
(`Windows.Media.Ocr`). It does not need `VISION_API_KEY` or any network call.

## When to use

- The user pastes or attaches an image and asks what it contains / what it says.
- The runtime model cannot read images directly (e.g. a text-only model).
- `vision_glance` / `vision_detect` / `vision_ground` fail because
  `VISION_API_KEY` is not configured.
- You need the text of a screenshot, a diagram label, a figure caption, UI
  text, a form, or a table to answer a question.

## What it CAN and CANNOT do

| Can do | Cannot do |
| --- | --- |
| Transcribe visible text (very reliable) | Semantic description of shapes/scenes (no NLP) |
| Report image dimensions & format | Identify people, objects, or diagrams by vision |
| Chinese, English, and any installed OCR language | Color/shape analysis (see PIL fallback below) |

For a *semantic* ("what does this look like") description you still need a
vision model. This skill guarantees you at least get the **text** even when no
vision credential is present.

## How to run

There is a PowerShell script `scripts/ocr-image.ps1`. Run it from the session
workspace via the `pwsh` tool.

```powershell
# Basic
pwsh -NoProfile -ExecutionPolicy Bypass -File <skill>/scripts/ocr-image.ps1 -Path C:\path\to\image.png
```

Because script execution may be disabled, always launch with
`-ExecutionPolicy Bypass -File`. The tool wrapper often already runs as pwsh;
if invoking a `.ps1` reports an execution-policy (SecurityError), use the
`pwsh -File` form above.

Alternative: paste the script body directly into the `pwsh` tool command if
you cannot locate the skill's `scripts` folder (the tool does not support
`-File` pointing outside the workspace unless allowed). The script is
self-contained.

## Getting the image into the workspace first

- If the user uploaded an image, resolve where it landed. The current session's
  workspace is the CWD of the `pwsh` tool; uploaded files can land in *another*
  session directory. Use `glob` for `**/name.png` and, when needed, `Copy-Item`
  the file into the **current** workspace (vision/image tools only see the
  allowed directories, and the skill's script should also get a path it can
  access).
- Confirm the file exists and is an image before OCR.

## Typical flow

1. `glob` for the image path (e.g. `**/pasted.png`).
2. If it is outside the current allowed workspace, `Copy-Item` it into the CWD.
3. Run `ocr-image.ps1` on the resolved path.
4. Merge the OCR lines into a clean reading, fixing obvious character splits
   (spaces from CJK glyph separation, `l`/`1`/`I`, `0`/`O`, etc.) that are OCR
   artifacts, NOT transcription errors to preserve wholesale. Present the
   cleaned text to the user.

## OCR line-merge tips

Windows OCR splits CJK text with spaces between characters on short lines and
may garble a few glyphs (`vision-toolkit` as `vision-tootkit`, `workspace` as
`· yamI`). These are recognizer artifacts. Rejoin them into normal words based
on context, and note any genuinely ambiguous spot rather than inventing text.

## Notes

- Works on PNG/JPG/JPEG/BMP. For very dark/low-contrast images, consider
  preprocessing (invert/scale) if available; the engine generally handles
  screenshots well.
- The default engine uses the Windows user/profile languages. You can pass a
  specific BCP-47 tag (e.g. `en-US`, `ja-JP`) with the `-Language` parameter if
  the tag's language pack is installed.
- No network, no credential, no tokens. Fully local.
