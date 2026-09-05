#!/usr/bin/env bash
# Smoke test for forensics_tools. Run before every change.
#
# Validates:
#   1. Each script compiles (py_compile)
#   2. Each script's --help works (catches argparse %-escape bugs)
#   3. Each script's documented positive-control test fires correctly
#   4. Each script's negative-control test stays silent
#
# Exits non-zero on any failure. Designed to be a < 30-second pre-commit gate.

set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TOOLS="$ROOT/forensics_tools"
TMP="$(mktemp -d)"
trap "rm -rf $TMP" EXIT

PASS=0; FAIL=0
log_ok()  { echo "  ✓ $1"; PASS=$((PASS+1)); }
log_err() { echo "  ✗ $1"; FAIL=$((FAIL+1)); }

cd "$ROOT"

echo "== compile =="
for f in "$TOOLS"/*.py; do
  if python3 -m py_compile "$f" 2>/dev/null; then
    log_ok "compile $(basename $f)"
  else
    log_err "compile $(basename $f)"
  fi
done

echo
echo "== --help =="
for f in "$TOOLS"/{magnitude_consistency,decimal_match,image_dup,image_dup_orb,panel_split,channel_check,xlsx_aggregate_consistency}.py; do
  if python3 "$f" --help >/dev/null 2>&1; then
    log_ok "--help $(basename $f)"
  else
    log_err "--help $(basename $f) (likely % unescaped in argparse help= string)"
  fi
done

echo
echo "== decimal_match positive control =="
python3 - <<PY >/dev/null 2>&1
import openpyxl
wb = openpyxl.Workbook(); ws = wb.active
import random; random.seed(0)
vals = [round(random.uniform(0, 100), 3) for _ in range(50)]
vals.extend([12.75, 34.75, 56.75, 78.75, 23.75, 45.75, 67.75, 89.75])
for i, v in enumerate(vals): ws.cell(i+1, 1, v)
wb.save("$TMP/dm.xlsx")
PY
out=$(python3 "$TOOLS/decimal_match.py" "$TMP/dm.xlsx" --digits 2 --min-class 3 --min-distinct 3 2>&1)
if echo "$out" | grep -q "sig=.*'75'.*FLAG"; then
  log_ok "decimal_match catches injected '.75' pattern"
else
  log_err "decimal_match FAILED to catch injected '.75' pattern"
  echo "$out" | tail -5
fi

echo
echo "== decimal_match negative control =="
python3 - <<PY >/dev/null 2>&1
import openpyxl, random
wb = openpyxl.Workbook(); ws = wb.active
random.seed(1)
for i in range(80): ws.cell(i+1, 1, round(random.uniform(0, 100), 2))
wb.save("$TMP/dm_clean.xlsx")
PY
out=$(python3 "$TOOLS/decimal_match.py" "$TMP/dm_clean.xlsx" --digits 2 --min-class 8 --min-distinct 6 --ratio 3.0 2>&1)
n_flags=$(echo "$out" | grep -oE "total FLAG count: [0-9]+" | grep -oE "[0-9]+")
if [ "${n_flags:-0}" = "0" ]; then
  log_ok "decimal_match clean on random data (no false positives)"
else
  log_err "decimal_match emitted $n_flags flags on random data"
fi

echo
echo "== magnitude_consistency positive control =="
python3 - <<PY >/dev/null 2>&1
import openpyxl
wb = openpyxl.Workbook(); ws = wb.active; ws.title = "test"
ws.cell(1, 1, "county"); ws.cell(1, 2, "wind_generation_GWh")
# need ≥ 5 rows for auto-detect to fire
for i, (n, v) in enumerate([("A", 1500.0), ("B", 500.0), ("C", 250.0), ("D", 800.0), ("E", 100.0), ("F", 2000.0)]):
    ws.cell(i+2, 1, n); ws.cell(i+2, 2, v)
wb.save("$TMP/mc.xlsx")
open("$TMP/mc.txt","w").write("Background: county A produces 1500 TWh of wind energy.\n")
PY
out=$(python3 "$TOOLS/magnitude_consistency.py" \
  --text "$TMP/mc.txt" --xlsx "$TMP/mc.xlsx" --min-value 100 --top-k 1 2>&1)
if echo "$out" | grep -q "UNIT-CONFUSION FLAG.*1000x"; then
  log_ok "magnitude_consistency catches 1500 TWh-vs-GWh"
else
  log_err "magnitude_consistency MISSED 1500 TWh-vs-GWh"
  echo "$out" | tail -5
fi

echo
echo "== magnitude_consistency negative control =="
echo "Background: county A produces 1500 GWh of wind energy." > "$TMP/mc_clean.txt"
out=$(python3 "$TOOLS/magnitude_consistency.py" \
  --text "$TMP/mc_clean.txt" --xlsx "$TMP/mc.xlsx" --min-value 100 --top-k 1 2>&1)
n_flags=$(echo "$out" | grep -oE "[0-9]+ flag" | head -1 | grep -oE "[0-9]+")
if [ "${n_flags:-0}" = "0" ]; then
  log_ok "magnitude_consistency silent when units agree"
else
  log_err "magnitude_consistency emitted $n_flags flag(s) on matching units"
fi

echo
echo "== magnitude_consistency cross-family no-FP =="
# 800 kV (voltage) should NOT match against TWh (energy) cells
python3 - <<PY >/dev/null 2>&1
import openpyxl
wb = openpyxl.Workbook(); ws = wb.active
ws.cell(1, 1, "province"); ws.cell(1, 2, "total_TWh")
for i, (n, v) in enumerate([("Qinghai", 79.75), ("Henan", 384.70), ("Anhui", 229.72), ("Hebei", 426.88), ("Beijing", 131.08)]):
    ws.cell(i+2, 1, n); ws.cell(i+2, 2, v)
wb.save("$TMP/voltage.xlsx")
PY
echo "Qinghai-Henan ±800 kV UHVDC delivers clean energy." > "$TMP/voltage.txt"
out=$(python3 "$TOOLS/magnitude_consistency.py" \
  --text "$TMP/voltage.txt" --xlsx "$TMP/voltage.xlsx" --min-value 100 --top-k 1 2>&1)
n_flags=$(echo "$out" | grep -oE "[0-9]+ flag" | head -1 | grep -oE "^[0-9]+")
if [ "${n_flags:-0}" = "0" ]; then
  log_ok "magnitude_consistency: kV-vs-TWh cross-family is not flagged"
else
  log_err "magnitude_consistency: kV (voltage) wrongly matched against TWh (energy)"
fi

echo
echo "== xlsx_aggregate_consistency positive control =="
python3 - <<PY >/dev/null 2>&1
import openpyxl
wb1 = openpyxl.Workbook(); ws1 = wb1.active; ws1.title = "S1"
ws1.cell(1, 1, "region"); ws1.cell(1, 2, "total_GWh")
for i, (n, v) in enumerate([("A", 100.0), ("B", 200.0), ("C", 300.0), ("D", 400.0), ("E", 500.0)]):
    ws1.cell(i+2, 1, n); ws1.cell(i+2, 2, v)
wb1.save("$TMP/agg_a.xlsx")
wb2 = openpyxl.Workbook(); ws2 = wb2.active; ws2.title = "S2"
ws2.cell(1, 1, "region"); ws2.cell(1, 2, "annual_generation_GWh")
# All systematically lower by 0.4% per row
for i, (n, v) in enumerate([("A", 99.6), ("B", 199.2), ("C", 298.8), ("D", 398.4), ("E", 498.0)]):
    ws2.cell(i+2, 1, n); ws2.cell(i+2, 2, v)
wb2.save("$TMP/agg_b.xlsx")
PY
out=$(python3 "$TOOLS/xlsx_aggregate_consistency.py" "$TMP/agg_a.xlsx" "$TMP/agg_b.xlsx" \
  --tol-low 0.001 --tol-high 0.05 --entity-overlap 0.5 2>&1)
if echo "$out" | grep -q "SYSTEMATIC — all same sign"; then
  log_ok "xlsx_aggregate_consistency: catches 0.4% systematic same-sign cross-file mismatch"
else
  log_err "xlsx_aggregate_consistency: missed 0.4% systematic mismatch"
  echo "$out" | tail -5
fi

echo
echo "== xlsx_aggregate_consistency negative control =="
# Same data — should not flag
out=$(python3 "$TOOLS/xlsx_aggregate_consistency.py" "$TMP/agg_a.xlsx" "$TMP/agg_a.xlsx" \
  --tol-low 0.001 --tol-high 0.05 --entity-overlap 0.5 2>&1)
if echo "$out" | grep -qE "^=== 0 flag"; then
  log_ok "xlsx_aggregate_consistency: silent on identical files"
else
  log_err "xlsx_aggregate_consistency: spurious flag on identical files"
fi

echo
echo "== magnitude_consistency concentration family =="
# 1.5 mM in text vs 1.5 µM in XLSX -> should FLAG (concentration confusion)
python3 - <<PY >/dev/null 2>&1
import openpyxl
wb = openpyxl.Workbook(); ws = wb.active
ws.cell(1, 1, "compound"); ws.cell(1, 2, "ic50_µM")
for i, (n, v) in enumerate([("CompA", 1.5), ("CompB", 0.3), ("CompC", 7.8), ("CompD", 2.1), ("CompE", 15.0)]):
    ws.cell(i+2, 1, n); ws.cell(i+2, 2, v)
wb.save("$TMP/bio.xlsx")
PY
echo "Compound CompA shows IC50 of 1.5 mM in our assay." > "$TMP/bio.txt"
out=$(python3 "$TOOLS/magnitude_consistency.py" \
  --text "$TMP/bio.txt" --xlsx "$TMP/bio.xlsx" --min-value 1 --top-k 1 2>&1)
if echo "$out" | grep -q "UNIT-CONFUSION FLAG (mM vs µM"; then
  log_ok "magnitude_consistency: mM vs µM concentration confusion flagged"
else
  log_err "magnitude_consistency: missed mM vs µM concentration confusion"
fi

echo
echo "== summary =="
echo "PASS: $PASS    FAIL: $FAIL"
[ "$FAIL" -eq 0 ]
