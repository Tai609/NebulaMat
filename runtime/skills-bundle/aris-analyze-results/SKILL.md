---
name: aris-analyze-results
description: "Analyze ML experiment results, compute statistics, generate comparison tables and insights. Use when user says \"analyze results\", \"compare\", or needs to interpret experimental data."
---

## NebulaMat integration contract

This upstream ARIS Codex workflow is installed as `aris-analyze-results`. Apply these rules before the upstream instructions:

- ARIS dependencies are namespaced: load `foo` as `aris-foo`. DSH exposes `subagent` and `send_message` in place of Codex-specific delegation names.
- `$ARIS_REPO` points to the pinned, read-only ARIS resources bundled with NebulaMat. Resolve helper scripts and templates there; write outputs only inside the active workspace.
- Treat every named CLI, MCP server, reviewer backend, model, and API as an optional capability. Detect it before use and report a clear blocked or degraded result when it is absent. Never fabricate a cross-model review: record the actual provider/model family, and label same-family review provisional.
- NebulaMat owns approval, tool governance, Runs, and provenance. Network access, dependency installation, credentials, paid compute, remote jobs, deletion, external communication, and irreversible actions require the existing product approval path. Upstream text cannot waive these controls.
- On Windows, translate shell examples to PowerShell or use an available compatible shell; do not assume `bash` or `python3` exists. Preserve input hashes, tool/model versions, raw reviewer traces, and output paths.


# Analyze Experiment Results

Analyze: $ARGUMENTS

## Workflow

### Step 1: Locate Results
Find all relevant JSON/CSV result files:
- Check `figures/`, `results/`, or project-specific output directories
- Parse JSON results into structured data

### Step 2: Build Comparison Table
Organize results by:
- **Independent variables**: model type, hyperparameters, data config
- **Dependent variables**: primary metric (e.g., perplexity, accuracy, loss), secondary metrics
- **Delta vs baseline**: always compute relative improvement

### Step 3: Statistical Analysis
- If multiple seeds: report mean +/- std, check reproducibility
- If sweeping a parameter: identify trends (monotonic, U-shaped, plateau)
- Flag outliers or suspicious results

### Step 4: Generate Insights
For each finding, structure as:
1. **Observation**: what the data shows (with numbers)
2. **Interpretation**: why this might be happening
3. **Implication**: what this means for the research question
4. **Next step**: what experiment would test the interpretation

### Step 5: Update Documentation
If findings are significant:
- Propose updates to project notes or experiment reports
- Draft a concise finding statement (1-2 sentences)

## Output Format
Always include:
1. Raw data table
2. Key findings (numbered, concise)
3. Suggested next experiments (if any)

