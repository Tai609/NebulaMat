"""Build a standalone CATDA FTS index for development and migration checks.

The desktop application stores its live index under the Tauri application data
directory. This script keeps an explicit ``--database`` destination so it can
prepare or inspect a copy without coupling a Python utility to platform-
specific app-data paths.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sqlite3
import sys
import time
from pathlib import Path

DEFAULT_SOURCE = Path(r"C:\Users\泰\Desktop\CATDA\CATDA\output_extract")
MAX_CHARS = 100_000


def default_database() -> Path:
    """Match Tauri's app-data location for the current desktop platform."""
    if os.name == "nt":
        root = Path(os.environ.get("APPDATA", Path.home() / "AppData/Roaming"))
    elif sys.platform == "darwin":
        root = Path.home() / "Library/Application Support"
    else:
        root = Path(os.environ.get("XDG_DATA_HOME", Path.home() / ".local/share"))
    return root / "com.ai4s.workbench" / "knowledge" / "catda.sqlite3"


def first_text(value: object, wanted: tuple[str, ...]) -> str | None:
    if isinstance(value, dict):
        for key, child in value.items():
            normalized = key.lower()
            if any(needle == normalized or needle in normalized for needle in wanted):
                if isinstance(child, str) and child.strip():
                    return child.strip()
            found = first_text(child, wanted)
            if found:
                return found
    elif isinstance(value, list):
        for child in value:
            found = first_text(child, wanted)
            if found:
                return found
    return None


def flatten(value: object, key: str | None = None, output: list[str] | None = None, images: list[str] | None = None, total: list[int] | None = None) -> tuple[str, list[str]]:
    if output is None:
        output = []
    if images is None:
        images = []
    if total is None:
        total = [sum(len(part) for part in output)]
    if total[0] >= MAX_CHARS:
        return "".join(output)[:MAX_CHARS], images
    if isinstance(value, dict):
        for child_key, child in value.items():
            prefix = f"{child_key}: "
            output.append(prefix)
            total[0] += len(prefix)
            flatten(child, child_key, output, images, total)
            if total[0] >= MAX_CHARS:
                break
    elif isinstance(value, list):
        for child in value:
            flatten(child, key, output, images, total)
            if total[0] >= MAX_CHARS:
                break
    elif isinstance(value, str):
        text = value.strip()
        if text:
            lower = text.lower()
            if ((key and "image" in key.lower()) or lower.endswith((".png", ".jpg", ".jpeg", ".svg"))) and text not in images and len(images) < 32:
                images.append(text)
            output.append(text + " ")
            total[0] += len(text) + 1
    elif isinstance(value, (int, float, bool)):
        text = str(value).lower() + " "
        output.append(text)
        total[0] += len(text)
    return "".join(output)[:MAX_CHARS], images


def article_files(source: Path) -> list[tuple[str, Path]]:
    matches = []
    for directory in source.iterdir():
        if not directory.is_dir() or not re.fullmatch(r"output_\d+", directory.name):
            continue
        graph = directory / "graph" / "full_output.json"
        if graph.is_file():
            matches.append((directory.name, graph))
    return sorted(matches, key=lambda pair: int(pair[0][7:]))


def build(source: Path, destination: Path) -> tuple[int, int, int, int]:
    files = article_files(source)
    if not files:
        raise RuntimeError(f"No output_*/graph/full_output.json files found in {source}")
    destination.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(destination)
    connection.execute("PRAGMA journal_mode = WAL")
    connection.executescript(
        """CREATE TABLE IF NOT EXISTS knowledge_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS knowledge_documents (
          source_id TEXT PRIMARY KEY, title TEXT NOT NULL, source_path TEXT NOT NULL,
          content TEXT NOT NULL, related_images TEXT NOT NULL, bytes INTEGER NOT NULL,
          nodes INTEGER NOT NULL, edges INTEGER NOT NULL
        );
        CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_fts USING fts5(
          source_id UNINDEXED, title, source_path UNINDEXED, content,
          tokenize='unicode61 remove_diacritics 1'
        );""",
    )
    connection.execute("BEGIN")
    connection.execute("DELETE FROM knowledge_documents")
    connection.execute("DELETE FROM knowledge_fts")
    total_bytes = total_nodes = total_edges = 0
    for source_id, path in files:
        raw = path.read_bytes()
        value = json.loads(raw)
        nodes = edges = 0
        if isinstance(value, dict):
            for section in value.values():
                if isinstance(section, dict):
                    nodes += len(section.get("nodes", [])) if isinstance(section.get("nodes"), list) else 0
                    edges += len(section.get("edges", [])) if isinstance(section.get("edges"), list) else 0
        content, images = flatten(value)
        title = first_text(value, ("paper_title", "article_title", "title", "doi")) or source_id
        connection.execute("INSERT INTO knowledge_documents VALUES (?,?,?,?,?,?,?,?)", (source_id, title, str(path), content, json.dumps(images, ensure_ascii=False), len(raw), nodes, edges))
        connection.execute("INSERT INTO knowledge_fts(source_id,title,source_path,content) VALUES (?,?,?,?)", (source_id, title, str(path), content))
        total_bytes += len(raw)
        total_nodes += nodes
        total_edges += edges
    metadata = {"source_dir": str(source), "indexed_at": str(int(time.time())), "documents": str(len(files)), "indexed_bytes": str(total_bytes), "nodes": str(total_nodes), "edges": str(total_edges), "error": ""}
    for key, value in metadata.items():
        connection.execute("INSERT INTO knowledge_meta VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", (key, value))
    connection.commit()
    connection.close()
    return len(files), total_bytes, total_nodes, total_edges


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("source", nargs="?", type=Path, default=DEFAULT_SOURCE)
    parser.add_argument("--database", type=Path, default=default_database())
    args = parser.parse_args()
    result = build(args.source, args.database)
    print(f"indexed documents={result[0]} bytes={result[1]} nodes={result[2]} edges={result[3]} database={args.database}")
