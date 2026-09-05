#!/usr/bin/env python3
"""Open Science — large-file probe (P0-6): reference, don't load.

Scientific files routinely exceed any context window (90 GB FASTQ, multi-GB
HDF5/FITS snapshots, 20 GB+ NetCDF, huge VASP logs). Reading them raw both OOMs
and hallucinates. This tool returns a compact **memory pointer** — header /
schema / shape / a small sample / key numbers — by introspection and sampling,
in bounded memory, WITHOUT loading the whole file into the model.

It is stdlib-first: tables, text, logs, and NDJSON work with zero dependencies
(streamed). Binary scientific formats (Parquet, HDF5, FITS, NetCDF) are
introspected via their real library when installed, and degrade to a clear
"install X to introspect" pointer otherwise — never a raw dump.

Usage:
    python large_file_probe.py FILE [--sample N]
Output: one compact JSON object on stdout (the pointer).
"""
from __future__ import annotations

import csv
import gzip
import json
import re
import sys
from pathlib import Path

SAMPLE_DEFAULT = 5
MAX_SAMPLE = 50
TAIL_BYTES = 65536
MAX_CELL = 200  # truncate any single sampled value so the pointer stays small


def human(n: int) -> str:
    x = float(n)
    for unit in ["B", "KB", "MB", "GB", "TB"]:
        if x < 1024 or unit == "TB":
            return f"{x:.0f} {unit}" if unit == "B" else f"{x:.1f} {unit}"
        x /= 1024
    return f"{n} B"


def count_lines(path: Path) -> int:
    """Total newline count, streamed in fixed-size chunks (constant memory)."""
    total = 0
    with path.open("rb") as fh:
        while True:
            chunk = fh.read(1 << 20)
            if not chunk:
                break
            total += chunk.count(b"\n")
    return total


def head_lines(path: Path, n: int) -> list[str]:
    out: list[str] = []
    with path.open("r", encoding="utf-8", errors="replace") as fh:
        for _ in range(n):
            line = fh.readline()
            if not line:
                break
            out.append(line.rstrip("\n"))
    return out


def tail_lines(path: Path, n: int) -> list[str]:
    size = path.stat().st_size
    with path.open("rb") as fh:
        fh.seek(max(0, size - TAIL_BYTES))
        data = fh.read()
    text = data.decode("utf-8", errors="replace")
    lines = text.splitlines()
    return lines[-n:] if len(lines) > n else lines


def _clip(s: str) -> str:
    return s if len(s) <= MAX_CELL else s[:MAX_CELL] + "…"


def is_gzip(path: Path) -> bool:
    """Gzip magic bytes — genomics text (FASTQ/VCF) is routinely gzipped."""
    with path.open("rb") as fh:
        return fh.read(2) == b"\x1f\x8b"


def _open_text(path: Path):
    if is_gzip(path):
        return gzip.open(path, "rt", encoding="utf-8", errors="replace")
    return path.open("r", encoding="utf-8", errors="replace")


def stream_lines(path: Path):
    """Yield decoded lines (gzip or plain) one at a time — constant memory."""
    with _open_text(path) as fh:
        for line in fh:
            yield line.rstrip("\n")


def count_lines_any(path: Path) -> int:
    """Newline count for gzip OR plain files, streamed in constant memory."""
    if not is_gzip(path):
        return count_lines(path)
    total = 0
    with gzip.open(path, "rb") as fh:
        while True:
            chunk = fh.read(1 << 20)
            if not chunk:
                break
            total += chunk.count(b"\n")
    return total


def _decompressed_ext(path: Path) -> str:
    """Real format extension, seeing through a `.gz`/`.bgz`/`.bz2` wrapper so
    `reads.fastq.gz` is detected as FASTQ, not as a generic gzip blob."""
    name = path.name.lower()
    for z in (".gz", ".bgz", ".bz2"):
        if name.endswith(z):
            name = name[: -len(z)]
            break
    dot = name.rfind(".")
    return name[dot:] if dot != -1 else ""


# --------------------------------------------------------------------------- #
# Format detection
# --------------------------------------------------------------------------- #

TABLE_EXT = {".csv", ".tsv", ".tab"}
TEXT_EXT = {".txt", ".log", ".out", ".md", ".dat"}
NDJSON_EXT = {".jsonl", ".ndjson"}
LOG_HINT = re.compile(r"OUTCAR|OSZICAR|\.log$|\.out$", re.IGNORECASE)


def detect_format(path: Path) -> str:
    ext = path.suffix.lower()
    # Genomics/earth formats first — they may carry a `.gz` wrapper, so look
    # through it at the real extension (reads.fastq.gz → fastq).
    dext = _decompressed_ext(path)
    if dext in {".fastq", ".fq"}:
        return "fastq"
    if dext in {".fasta", ".fa", ".fna", ".faa", ".ffn"}:
        return "fasta"
    if dext == ".vcf":
        return "vcf"
    if dext in {".bam", ".cram", ".sam"}:
        return "bam"
    if dext in {".grib", ".grib2", ".grb", ".grb2"}:
        return "grib"
    if dext == ".root":
        return "root"
    if ext in {".parquet", ".pq"}:
        return "parquet"
    if ext in {".h5", ".hdf5", ".he5"}:
        return "hdf5"
    if ext in {".fits", ".fit", ".fts"}:
        return "fits"
    if ext in {".nc", ".nc4", ".netcdf", ".cdf"}:
        return "netcdf"
    if ext in NDJSON_EXT:
        return "ndjson"
    if ext in TABLE_EXT:
        return "table"
    if path.name.upper() in {"OUTCAR", "OSZICAR", "INCAR"} or ext in {".log", ".out"}:
        return "log"
    if ext in TEXT_EXT:
        return "text"
    return "text"


# --------------------------------------------------------------------------- #
# Table (CSV/TSV) — schema + row count + sample, streamed
# --------------------------------------------------------------------------- #


def _sniff_delim(sample: str, ext: str) -> str:
    if ext == ".tsv" or ext == ".tab":
        return "\t"
    try:
        return csv.Sniffer().sniff(sample, delimiters=",\t;|").delimiter
    except csv.Error:
        return ","


def _infer_type(values: list[str]) -> str:
    seen = set()
    for v in values:
        v = v.strip()
        if v == "" or v.lower() in {"na", "nan", "null", "none"}:
            continue
        try:
            int(v)
            seen.add("int")
            continue
        except ValueError:
            pass
        try:
            float(v)
            seen.add("float")
            continue
        except ValueError:
            seen.add("str")
    if not seen:
        return "empty"
    if seen == {"int"}:
        return "int"
    if seen <= {"int", "float"}:
        return "float"
    return "str"


def probe_table(path: Path, sample: int) -> dict:
    ext = path.suffix.lower()
    head = head_lines(path, sample + 1 + 200)  # header + sample + rows for typing
    if not head:
        return {"format": "table", "empty": True}
    delim = _sniff_delim("\n".join(head[:50]), ext)
    rows = list(csv.reader(head, delimiter=delim))
    header = rows[0]
    body = rows[1:]
    # Per-column type inference over the sampled body rows.
    cols = []
    for i, name in enumerate(header):
        vals = [r[i] for r in body if i < len(r)]
        cols.append({"name": name, "dtype": _infer_type(vals)})
    total_lines = count_lines(path)
    # Header counts as one line if the file ends without a trailing newline the
    # last row may be uncounted; report rows as lines minus the header row.
    data_rows = max(0, total_lines - 1)
    sample_rows = [[_clip(c) for c in r] for r in body[:sample]]
    tail = tail_lines(path, sample)
    tail_rows = [
        [_clip(c) for c in next(csv.reader([ln], delimiter=delim), [])]
        for ln in tail
    ]
    return {
        "format": "table",
        "delimiter": "\\t" if delim == "\t" else delim,
        "columns": cols,
        "n_columns": len(header),
        "approx_rows": data_rows,
        "sample_head": sample_rows,
        "sample_tail": tail_rows[-sample:],
    }


# --------------------------------------------------------------------------- #
# NDJSON — keys + record count + sample
# --------------------------------------------------------------------------- #


def probe_ndjson(path: Path, sample: int) -> dict:
    head = head_lines(path, sample)
    records = []
    keys: set[str] = set()
    for ln in head:
        try:
            obj = json.loads(ln)
            records.append(obj)
            if isinstance(obj, dict):
                keys.update(obj.keys())
        except json.JSONDecodeError:
            continue
    return {
        "format": "ndjson",
        "keys": sorted(keys),
        "approx_records": count_lines(path),
        "sample": records[:sample],
    }


# --------------------------------------------------------------------------- #
# Text / log — line count + head/tail; logs also get numeric extraction
# --------------------------------------------------------------------------- #

# Deterministic extractors for common scientific logs (numbers, not prose).
_LOG_PATTERNS = {
    "vasp_free_energy_eV": re.compile(r"free\s+energy\s+TOTEN\s*=\s*(-?\d+\.\d+)"),
    "vasp_energy_sigma0_eV": re.compile(r"energy\(sigma->0\)\s*=\s*(-?\d+\.\d+)"),
    "converged_electronic": re.compile(r"(reached required accuracy)"),
}


def probe_text(path: Path, sample: int, is_log: bool) -> dict:
    out = {
        "format": "log" if is_log else "text",
        "lines": count_lines(path),
        "sample_head": [_clip(x) for x in head_lines(path, sample)],
        "sample_tail": [_clip(x) for x in tail_lines(path, sample)],
    }
    if is_log:
        extracted: dict[str, object] = {}
        # Scan streamed; keep only the LAST match of each numeric pattern.
        with path.open("r", encoding="utf-8", errors="replace") as fh:
            for line in fh:
                for key, pat in _LOG_PATTERNS.items():
                    m = pat.search(line)
                    if m:
                        val = m.group(1)
                        try:
                            extracted[key] = float(val)
                        except ValueError:
                            extracted[key] = val
        if extracted:
            out["extracted"] = extracted
    return out


# --------------------------------------------------------------------------- #
# Binary scientific formats — real library if present, else a clear pointer
# --------------------------------------------------------------------------- #


def _needs(pkg: str, fmt: str) -> dict:
    return {
        "format": fmt,
        "introspection": "unavailable",
        "hint": f"install `{pkg}` to introspect {fmt} headers/schema without loading data",
    }


def probe_parquet(path: Path) -> dict:
    try:
        import pyarrow.parquet as pq  # type: ignore
    except ImportError:
        return _needs("pyarrow", "parquet")
    md = pq.read_metadata(str(path))  # metadata only — no column data read
    schema = pq.read_schema(str(path))
    return {
        "format": "parquet",
        "num_rows": md.num_rows,
        "num_columns": md.num_columns,
        "row_groups": md.num_row_groups,
        "columns": [{"name": f.name, "dtype": str(f.type)} for f in schema],
    }


def probe_hdf5(path: Path) -> dict:
    try:
        import h5py  # type: ignore
    except ImportError:
        return _needs("h5py", "hdf5")
    datasets = []

    def visit(name, obj):
        if isinstance(obj, h5py.Dataset):
            datasets.append({"path": name, "shape": list(obj.shape), "dtype": str(obj.dtype)})

    with h5py.File(str(path), "r") as f:
        f.visititems(visit)
    return {"format": "hdf5", "n_datasets": len(datasets), "datasets": datasets[:100]}


def probe_fits(path: Path) -> dict:
    try:
        from astropy.io import fits  # type: ignore
    except ImportError:
        return _needs("astropy", "fits")
    hdus = []
    with fits.open(str(path), memmap=True) as hdul:  # memmap — headers only
        for i, hdu in enumerate(hdul):
            hdus.append({
                "index": i,
                "type": type(hdu).__name__,
                "shape": list(hdu.data.shape) if getattr(hdu, "data", None) is not None else None,
                "keys": list(hdu.header.keys())[:30],
            })
    return {"format": "fits", "n_hdus": len(hdus), "hdus": hdus}


def probe_netcdf(path: Path) -> dict:
    try:
        import netCDF4  # type: ignore
    except ImportError:
        return _needs("netCDF4", "netcdf")
    with netCDF4.Dataset(str(path)) as ds:
        dims = {k: len(v) for k, v in ds.dimensions.items()}
        variables = [
            {"name": k, "dims": list(v.dimensions), "dtype": str(v.dtype)}
            for k, v in ds.variables.items()
        ]
    return {"format": "netcdf", "dimensions": dims, "variables": variables[:100]}


# --------------------------------------------------------------------------- #
# Genomics — FASTQ / FASTA / VCF (stdlib, gzip-aware) + BAM (library)
# --------------------------------------------------------------------------- #

# How many records to scan for length stats before stopping — bounds work on a
# 90 GB file while still giving a representative spread.
_STATS_SCAN = 100_000


def probe_fastq(path: Path, sample: int) -> dict:
    gz = is_gzip(path)
    reads = 0
    ids: list[str] = []
    lmin = lmax = None
    ltotal = scanned = 0
    for i, line in enumerate(stream_lines(path)):
        phase = i % 4
        if phase == 0:  # header line "@id desc"
            reads += 1
            if len(ids) < sample:
                ids.append(_clip(line[1:] if line.startswith("@") else line))
        elif phase == 1 and scanned < _STATS_SCAN:  # sequence
            n = len(line)
            lmin = n if lmin is None else min(lmin, n)
            lmax = n if lmax is None else max(lmax, n)
            ltotal += n
            scanned += 1
    out = {
        "format": "fastq",
        "gzipped": gz,
        "approx_reads": reads,
        "sample_ids": ids,
    }
    if scanned:
        out["read_length"] = {"min": lmin, "max": lmax,
                              "mean": round(ltotal / scanned, 1),
                              "scanned_reads": scanned}
    return out


def probe_fasta(path: Path, sample: int) -> dict:
    seqs = 0
    ids: list[str] = []
    total_bp = 0
    for line in stream_lines(path):
        if line.startswith(">"):
            seqs += 1
            if len(ids) < sample:
                ids.append(_clip(line[1:].strip()))
        else:
            total_bp += len(line.strip())
    return {
        "format": "fasta",
        "gzipped": is_gzip(path),
        "approx_sequences": seqs,
        "approx_residues": total_bp,
        "sample_ids": ids,
    }


def probe_vcf(path: Path, sample: int) -> dict:
    meta = 0
    samples: list[str] = []
    variants = 0
    sample_rows: list[str] = []
    contigs: list[str] = []
    seen_header = False
    for line in stream_lines(path):
        if line.startswith("##"):
            meta += 1
            m = re.match(r"##contig=<ID=([^,>]+)", line)
            if m and len(contigs) < 30:
                contigs.append(m.group(1))
        elif line.startswith("#CHROM"):
            cols = line.split("\t")
            samples = cols[9:] if len(cols) > 9 else []
            seen_header = True
        elif line.strip():
            variants += 1
            if len(sample_rows) < sample:
                sample_rows.append(_clip("\t".join(line.split("\t")[:5])))
    out = {
        "format": "vcf",
        "gzipped": is_gzip(path),
        "meta_lines": meta,
        "has_header": seen_header,
        "samples": samples,
        "n_samples": len(samples),
        "approx_variants": variants,
        "sample_variants": sample_rows,
    }
    if contigs:
        out["contigs"] = contigs
    return out


def probe_bam(path: Path) -> dict:
    try:
        import pysam  # type: ignore
    except ImportError:
        return _needs("pysam", "bam")
    ext = _decompressed_ext(path)
    mode = "rc" if ext == ".cram" else "rb" if ext == ".bam" else "r"
    with pysam.AlignmentFile(str(path), mode, check_sq=False) as af:  # header only
        refs = list(getattr(af, "references", []) or [])
        header = af.header.to_dict() if hasattr(af, "header") else {}
        sq = header.get("SQ", [])
    return {
        "format": "bam",
        "n_references": len(refs),
        "references": refs[:30],
        "mapped": header.get("HD", {}),
        "n_sequences_in_header": len(sq),
    }


def probe_grib(path: Path) -> dict:
    for pkg, mod in (("cfgrib", "cfgrib"), ("pygrib", "pygrib")):
        try:
            __import__(mod)
        except ImportError:
            continue
        if pkg == "cfgrib":
            import cfgrib  # type: ignore
            ds = cfgrib.open_dataset(str(path))
            return {
                "format": "grib",
                "variables": [
                    {"name": k, "dims": list(v.dims), "shape": list(v.shape)}
                    for k, v in list(ds.data_vars.items())[:100]
                ],
                "coords": list(ds.coords)[:50],
            }
        import pygrib  # type: ignore
        with pygrib.open(str(path)) as g:
            msgs = [str(m)[:120] for _, m in zip(range(20), g)]
        return {"format": "grib", "sample_messages": msgs, "n_sampled": len(msgs)}
    return _needs("cfgrib", "grib")


def probe_root(path: Path) -> dict:
    try:
        import uproot  # type: ignore
    except ImportError:
        return _needs("uproot", "root")
    trees = []
    with uproot.open(str(path)) as f:  # metadata only — no branch data read
        for key in f.keys(recursive=False):
            obj = f[key]
            branches = getattr(obj, "keys", lambda: [])()
            entry = {"name": key, "type": type(obj).__name__}
            if branches:
                entry["n_entries"] = int(getattr(obj, "num_entries", 0))
                entry["branches"] = [str(b) for b in list(branches)[:50]]
            trees.append(entry)
    return {"format": "root", "n_keys": len(trees), "keys": trees[:50]}


# --------------------------------------------------------------------------- #
# Driver
# --------------------------------------------------------------------------- #

NOTE = (
    "Memory pointer — file introspected/sampled, not loaded. Work from this "
    "schema/sample; read specific ranges deterministically, never the whole file."
)


def probe(path: Path, sample: int) -> dict:
    if not path.exists():
        return {"error": f"no such file: {path}"}
    if path.is_dir():
        return {"error": f"is a directory: {path}"}
    sample = max(1, min(sample, MAX_SAMPLE))
    fmt = detect_format(path)
    base = {"path": str(path), "size": human(path.stat().st_size),
            "size_bytes": path.stat().st_size}
    try:
        if fmt == "table":
            detail = probe_table(path, sample)
        elif fmt == "ndjson":
            detail = probe_ndjson(path, sample)
        elif fmt == "parquet":
            detail = probe_parquet(path)
        elif fmt == "hdf5":
            detail = probe_hdf5(path)
        elif fmt == "fits":
            detail = probe_fits(path)
        elif fmt == "netcdf":
            detail = probe_netcdf(path)
        elif fmt == "fastq":
            detail = probe_fastq(path, sample)
        elif fmt == "fasta":
            detail = probe_fasta(path, sample)
        elif fmt == "vcf":
            detail = probe_vcf(path, sample)
        elif fmt == "bam":
            detail = probe_bam(path)
        elif fmt == "grib":
            detail = probe_grib(path)
        elif fmt == "root":
            detail = probe_root(path)
        elif fmt == "log":
            detail = probe_text(path, sample, is_log=True)
        else:
            detail = probe_text(path, sample, is_log=False)
    except Exception as e:  # a probe must degrade to a pointer, never crash
        detail = {"format": fmt, "introspection": "failed", "reason": str(e)[:200]}
    base.update(detail)
    base["note"] = NOTE
    return base


def main(argv: list[str]) -> int:
    args = argv[1:]
    sample = SAMPLE_DEFAULT
    if "--sample" in args:
        i = args.index("--sample")
        try:
            sample = int(args[i + 1])
            del args[i:i + 2]
        except (ValueError, IndexError):
            print(json.dumps({"error": "--sample needs an integer"}))
            return 2
    if not args:
        print(json.dumps({"error": "usage: large_file_probe.py FILE [--sample N]"}))
        return 2
    print(json.dumps(probe(Path(args[0]), sample), ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
