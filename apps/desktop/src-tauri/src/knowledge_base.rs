//! Local CATDA multimodal knowledge-base index.
//!
//! The source graphs remain in their CATDA directory.  This module stores a
//! application-scoped SQLite FTS5 index with source paths, compact graph text,
//! and namespaced node/edge records, so retrieval survives conversation
//! workspace switches without copying hundreds of megabytes into each session.

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::cmp::Ordering;
use std::collections::{HashMap, HashSet};
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use tauri::{path::BaseDirectory, AppHandle, Manager};

const DEFAULT_SOURCE_DIR: &str = r"C:\Users\泰\Desktop\CATDA\CATDA\output_extract";
const MAX_CONTENT_CHARS: usize = 100_000;

/// Resolve the bundled CATDA graph first so installed users do not need the
/// developer's external CATDA checkout. The external path remains a useful
/// development fallback when running a local build without packaged assets.
fn default_source_dir(app: &AppHandle) -> PathBuf {
    app.path()
        .resolve("catda/full_output", BaseDirectory::Resource)
        .ok()
        .filter(|path| path.is_dir())
        .unwrap_or_else(|| PathBuf::from(DEFAULT_SOURCE_DIR))
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct KnowledgeBaseStatus {
    pub enabled: bool,
    pub source_dir: Option<String>,
    pub indexed_at: Option<String>,
    pub documents: usize,
    pub indexed_bytes: u64,
    pub nodes: usize,
    pub edges: usize,
    pub database_path: String,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KnowledgeSearchResult {
    pub source_id: String,
    pub title: String,
    pub source_path: String,
    pub snippet: String,
    pub score: f64,
    pub related_images: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KnowledgeArticleSummary {
    pub source_id: String,
    pub title: String,
    pub bytes: u64,
    pub nodes: usize,
    pub edges: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KnowledgeUniverseNode {
    pub id: String,
    pub label: String,
    pub node_type: String,
    pub cluster: String,
    pub source_id: String,
    pub degree: usize,
    pub properties: String,
    pub related_images: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KnowledgeUniverseEdge {
    pub source: String,
    pub target: String,
    pub relation: String,
    pub weight: f64,
    pub source_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KnowledgeUniverse {
    pub nodes: Vec<KnowledgeUniverseNode>,
    pub edges: Vec<KnowledgeUniverseEdge>,
    pub total_nodes: usize,
    pub total_edges: usize,
    pub visible_nodes: usize,
    pub visible_edges: usize,
    pub truncated: bool,
}

/// Graph-aware retrieval result. `matched_nodes` are the nodes whose indexed
/// labels/properties match the query; `adjacent_nodes` are their one-hop
/// neighbors and `edges` contains only the relationships connecting the two
/// sets. Keeping the sets separate lets callers render a focused subgraph or
/// cite only direct matches.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct KnowledgeGraphSearchResult {
    pub matched_nodes: Vec<KnowledgeUniverseNode>,
    pub adjacent_nodes: Vec<KnowledgeUniverseNode>,
    pub edges: Vec<KnowledgeUniverseEdge>,
    pub total_matches: usize,
    pub truncated: bool,
}

#[derive(Debug, Clone)]
struct UniverseNodeCandidate {
    node: KnowledgeUniverseNode,
}

const DEFAULT_UNIVERSE_LIMIT: usize = 520;
const MAX_UNIVERSE_LIMIT: usize = 900;

/// The CATDA index belongs to the application, not to the currently selected
/// conversation workspace.  Keeping it under the app data directory means a
/// workspace switch only changes the runtime working folder; it cannot hide
/// or destroy the user's imported knowledge universe.
fn database_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("knowledge");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("catda.sqlite3"))
}

fn connection(app: &AppHandle) -> Result<(Connection, PathBuf), String> {
    let path = database_path(app)?;
    let conn = Connection::open(&path).map_err(|e| e.to_string())?;
    conn.busy_timeout(std::time::Duration::from_secs(30))
        .map_err(|e| e.to_string())?;
    conn.execute_batch(
        "PRAGMA journal_mode = WAL;
         CREATE TABLE IF NOT EXISTS knowledge_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
         CREATE TABLE IF NOT EXISTS knowledge_documents (
           source_id TEXT PRIMARY KEY,
           title TEXT NOT NULL,
           source_path TEXT NOT NULL,
           content TEXT NOT NULL,
           related_images TEXT NOT NULL,
           bytes INTEGER NOT NULL,
           nodes INTEGER NOT NULL,
           edges INTEGER NOT NULL
         );
         CREATE TABLE IF NOT EXISTS knowledge_nodes (
           node_id TEXT PRIMARY KEY,
           source_id TEXT NOT NULL,
           label TEXT NOT NULL,
           node_type TEXT NOT NULL,
           cluster TEXT NOT NULL,
           degree INTEGER NOT NULL,
           properties TEXT NOT NULL,
           related_images TEXT NOT NULL
         );
         CREATE INDEX IF NOT EXISTS knowledge_nodes_source_idx ON knowledge_nodes(source_id);
         CREATE TABLE IF NOT EXISTS knowledge_edges (
           source_node TEXT NOT NULL,
           target_node TEXT NOT NULL,
           relation TEXT NOT NULL,
           weight REAL NOT NULL,
           source_id TEXT NOT NULL,
           PRIMARY KEY(source_node, target_node, relation, source_id)
         );
         CREATE INDEX IF NOT EXISTS knowledge_edges_source_idx ON knowledge_edges(source_node);
         CREATE INDEX IF NOT EXISTS knowledge_edges_target_idx ON knowledge_edges(target_node);
         CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_nodes_fts USING fts5(
           node_id UNINDEXED, source_id UNINDEXED, label, node_type, cluster,
           properties, tokenize='unicode61 remove_diacritics 1'
         );
         CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_fts USING fts5(
           source_id UNINDEXED, title, source_path UNINDEXED, content,
           tokenize='unicode61 remove_diacritics 1'
         );",
    )
    .map_err(|e| e.to_string())?;
    Ok((conn, path))
}

fn meta(conn: &Connection, key: &str) -> Option<String> {
    conn.query_row(
        "SELECT value FROM knowledge_meta WHERE key = ?1",
        [key],
        |row| row.get(0),
    )
    .optional()
    .ok()
    .flatten()
}

fn set_meta(conn: &Connection, key: &str, value: impl AsRef<str>) -> Result<(), String> {
    conn.execute(
        "INSERT INTO knowledge_meta(key, value) VALUES(?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![key, value.as_ref()],
    )
    .map(|_| ())
    .map_err(|e| e.to_string())
}

fn parse_usize(conn: &Connection, key: &str) -> usize {
    meta(conn, key).and_then(|v| v.parse().ok()).unwrap_or(0)
}

fn table_count(conn: &Connection, table: &str) -> usize {
    conn.query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |row| {
        row.get::<_, i64>(0)
    })
    .unwrap_or(0)
    .max(0) as usize
}

fn status_from(conn: &Connection, path: &Path) -> KnowledgeBaseStatus {
    KnowledgeBaseStatus {
        enabled: parse_usize(conn, "documents") > 0,
        source_dir: meta(conn, "source_dir"),
        indexed_at: meta(conn, "indexed_at"),
        documents: parse_usize(conn, "documents"),
        indexed_bytes: meta(conn, "indexed_bytes")
            .and_then(|v| v.parse().ok())
            .unwrap_or(0),
        nodes: parse_usize(conn, "nodes"),
        edges: parse_usize(conn, "edges"),
        database_path: path.to_string_lossy().into_owned(),
        error: meta(conn, "error"),
    }
}

fn count_nodes_edges(value: &Value) -> (usize, usize) {
    let mut nodes = 0;
    let mut edges = 0;
    if let Some(root) = value.as_object() {
        for (category, section) in root {
            if let Some(obj) = section.as_object() {
                if let Some(items) = obj.get("nodes").and_then(Value::as_array) {
                    nodes += items.len();
                }
                if let Some(items) = obj.get("edges").and_then(Value::as_array) {
                    edges += items.len();
                }
                let _ = category;
            }
        }
    }
    (nodes, edges)
}

fn collect_strings(value: &Value, key: Option<&str>, out: &mut String, images: &mut Vec<String>) {
    if out.len() >= MAX_CONTENT_CHARS {
        return;
    }
    match value {
        Value::Object(map) => {
            for (k, v) in map {
                if out.len() >= MAX_CONTENT_CHARS {
                    break;
                }
                out.push_str(k);
                out.push_str(": ");
                collect_strings(v, Some(k), out, images);
                out.push('\n');
            }
        }
        Value::Array(items) => {
            for item in items {
                collect_strings(item, key, out, images);
                if out.len() >= MAX_CONTENT_CHARS {
                    break;
                }
            }
        }
        Value::String(text) => {
            let trimmed = text.trim();
            if trimmed.is_empty() {
                return;
            }
            if key.is_some_and(|k| k.to_ascii_lowercase().contains("image"))
                || trimmed.to_ascii_lowercase().ends_with(".png")
                || trimmed.to_ascii_lowercase().ends_with(".jpg")
                || trimmed.to_ascii_lowercase().ends_with(".jpeg")
                || trimmed.to_ascii_lowercase().ends_with(".svg")
            {
                if images.len() < 32 && !images.iter().any(|image| image == trimmed) {
                    images.push(trimmed.to_owned());
                }
            }
            out.push_str(trimmed);
            out.push(' ');
        }
        Value::Number(number) => {
            out.push_str(&number.to_string());
            out.push(' ');
        }
        Value::Bool(value) => {
            out.push_str(if *value { "true " } else { "false " });
        }
        Value::Null => {}
    }
}

fn first_text(value: &Value, wanted: &[&str]) -> Option<String> {
    match value {
        Value::Object(map) => {
            for (key, child) in map {
                let normalized = key.to_ascii_lowercase();
                if wanted
                    .iter()
                    .any(|needle| normalized == *needle || normalized.contains(needle))
                {
                    if let Some(text) = child.as_str().map(str::trim).filter(|v| !v.is_empty()) {
                        return Some(text.to_owned());
                    }
                }
                if let Some(found) = first_text(child, wanted) {
                    return Some(found);
                }
            }
            None
        }
        Value::Array(items) => items.iter().find_map(|item| first_text(item, wanted)),
        _ => None,
    }
}

fn markdown_title(text: &str) -> Option<String> {
    const SECTION_HEADINGS: &[&str] = &[
        "abstract",
        "article",
        "communication",
        "introduction",
        "perspective",
        "review",
        "supporting information",
    ];
    text.lines().find_map(|line| {
        let trimmed = line.trim();
        if !trimmed.starts_with('#') {
            return None;
        }
        let title = trimmed.trim_start_matches('#').trim();
        if title.len() < 8 || SECTION_HEADINGS.contains(&title.to_ascii_lowercase().as_str()) {
            return None;
        }
        Some(title.to_owned())
    })
}

fn source_article_title(source: &Path, source_id: &str, graph: &Value) -> String {
    let markdown_path = source_id
        .strip_prefix("output_")
        .and_then(|number| number.parse::<u32>().ok())
        .and_then(|number| {
            source.parent().map(|root| {
                root.join("data")
                    .join("processed_papers")
                    .join(format!("paper_{number}"))
                    .join("txt")
                    .join("full.md")
            })
        });
    let markdown_title = markdown_path.and_then(|path| {
        let file = fs::File::open(path).ok()?;
        let mut prefix = String::new();
        file.take(64 * 1024).read_to_string(&mut prefix).ok()?;
        markdown_title(&prefix)
    });
    markdown_title
        .or_else(|| first_text(graph, &["paper_title", "article_title"]))
        .unwrap_or_else(|| source_id.to_owned())
}

fn numeric_output_dirs(source: &Path) -> Result<Vec<(String, PathBuf)>, String> {
    let mut dirs = Vec::new();
    for entry in fs::read_dir(source).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        if !entry.file_type().map_err(|e| e.to_string())?.is_dir() {
            continue;
        }
        let name = entry.file_name().to_string_lossy().into_owned();
        if name
            .strip_prefix("output_")
            .and_then(|v| v.parse::<u32>().ok())
            .is_some()
        {
            let graph = entry.path().join("graph").join("full_output.json");
            if graph.is_file() {
                dirs.push((name, graph));
            }
        }
    }
    dirs.sort_by(|a, b| {
        let parse = |v: &str| v.trim_start_matches("output_").parse::<u32>().unwrap_or(0);
        parse(&a.0).cmp(&parse(&b.0))
    });
    Ok(dirs)
}

fn compact_value(value: Option<&Value>, max_chars: usize) -> String {
    let Some(value) = value else {
        return String::new();
    };
    let raw = match value {
        Value::String(text) => text.clone(),
        _ => serde_json::to_string(value).unwrap_or_default(),
    };
    let compact = raw.split_whitespace().collect::<Vec<_>>().join(" ");
    let mut chars = compact.chars();
    let text = chars.by_ref().take(max_chars).collect::<String>();
    if chars.next().is_some() {
        format!("{text}...")
    } else {
        text
    }
}

fn value_text(value: &Value, keys: &[&str]) -> Option<String> {
    value.as_object().and_then(|object| {
        keys.iter()
            .find_map(|key| object.get(*key).and_then(scalar_text))
    })
}

fn scalar_text(value: &Value) -> Option<String> {
    match value {
        Value::String(text) => {
            let trimmed = text.trim();
            (!trimmed.is_empty()).then_some(trimmed.to_owned())
        }
        Value::Number(number) => Some(number.to_string()),
        Value::Bool(value) => Some(value.to_string()),
        _ => None,
    }
}

fn array_strings(value: Option<&Value>) -> Vec<String> {
    value
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(|item| item.as_str().map(ToOwned::to_owned))
                .take(24)
                .collect()
        })
        .unwrap_or_default()
}

fn universe_node_from(
    source_id: &str,
    cluster: &str,
    value: &Value,
) -> Option<KnowledgeUniverseNode> {
    let id = value_text(value, &["id"])?;
    let node_type = value_text(value, &["type", "node_type", "nodeType"])
        .unwrap_or_else(|| "concept".to_owned());
    let label = value_text(value, &["name", "label", "title"]).unwrap_or_else(|| id.clone());
    let properties = value
        .get("properties")
        .or_else(|| value.get("composition"))
        .map(|property| compact_value(Some(property), 480))
        .unwrap_or_default();
    let related_images = array_strings(
        value
            .get("related_images")
            .or_else(|| value.get("relatedImages")),
    );
    Some(KnowledgeUniverseNode {
        id: format!("{source_id}::{cluster}::{id}"),
        label,
        node_type,
        cluster: cluster.to_owned(),
        source_id: source_id.to_owned(),
        degree: 0,
        properties,
        related_images,
    })
}

/// Parse the CATDA graph once into the namespaced records used by both the
/// article viewer and the persistent graph-search tables.  CATDA sections may
/// reuse a raw node id, so every stored id remains namespaced by article and
/// extraction section.
fn graph_records_from_value(
    source_id: &str,
    value: &Value,
) -> (
    Vec<KnowledgeUniverseNode>,
    Vec<KnowledgeUniverseEdge>,
    usize,
    usize,
) {
    let Some(root) = value.as_object() else {
        return (Vec::new(), Vec::new(), 0, 0);
    };
    let mut nodes = HashMap::<String, UniverseNodeCandidate>::new();
    let mut edges = Vec::<KnowledgeUniverseEdge>::new();
    let mut total_nodes = 0usize;
    let mut total_edges = 0usize;
    let mut local_ids = HashMap::<(String, String), String>::new();
    let mut raw_id_candidates = HashMap::<String, Vec<String>>::new();
    for (cluster, section) in root {
        let Some(section) = section.as_object() else {
            continue;
        };
        if let Some(items) = section.get("nodes").and_then(Value::as_array) {
            total_nodes += items.len();
            for item in items {
                let Some(node) = universe_node_from(source_id, cluster, item) else {
                    continue;
                };
                let raw_id = value_text(item, &["id"]).unwrap_or_default();
                local_ids.insert((cluster.clone(), raw_id.clone()), node.id.clone());
                raw_id_candidates
                    .entry(raw_id)
                    .or_default()
                    .push(node.id.clone());
                nodes
                    .entry(node.id.clone())
                    .or_insert(UniverseNodeCandidate { node });
            }
        }
    }
    for (cluster, section) in root {
        let Some(section) = section.as_object() else {
            continue;
        };
        if let Some(items) = section.get("edges").and_then(Value::as_array) {
            total_edges += items.len();
            for item in items {
                let Some(item) = item.as_object() else {
                    continue;
                };
                let source_raw = item
                    .get("source_id")
                    .or_else(|| item.get("sourceId"))
                    .or_else(|| item.get("source"))
                    .and_then(scalar_text);
                let target_raw = item
                    .get("target_id")
                    .or_else(|| item.get("targetId"))
                    .or_else(|| item.get("target"))
                    .and_then(scalar_text);
                let (Some(source_raw), Some(target_raw)) =
                    (source_raw.as_deref(), target_raw.as_deref())
                else {
                    continue;
                };
                let resolve_id = |raw: &str| {
                    local_ids
                        .get(&(cluster.clone(), raw.to_owned()))
                        .cloned()
                        .or_else(|| {
                            raw_id_candidates
                                .get(raw)
                                .filter(|items| items.len() == 1)
                                .and_then(|items| items.first().cloned())
                        })
                };
                let (Some(source_node), Some(target_node)) =
                    (resolve_id(source_raw), resolve_id(target_raw))
                else {
                    continue;
                };
                let relation = ["type", "relation", "label"]
                    .iter()
                    .find_map(|key| {
                        item.get(*key)
                            .and_then(Value::as_str)
                            .map(str::trim)
                            .filter(|text| !text.is_empty())
                            .map(ToOwned::to_owned)
                    })
                    .unwrap_or_else(|| cluster.clone());
                let weight = item
                    .get("confidence_score")
                    .or_else(|| item.get("weight"))
                    .and_then(Value::as_f64)
                    .unwrap_or(1.0)
                    .clamp(0.2, 5.0);
                edges.push(KnowledgeUniverseEdge {
                    source: source_node.clone(),
                    target: target_node.clone(),
                    relation,
                    weight,
                    source_id: source_id.to_owned(),
                });
                if let Some(node) = nodes.get_mut(&source_node) {
                    node.node.degree += 1;
                }
                if let Some(node) = nodes.get_mut(&target_node) {
                    node.node.degree += 1;
                }
            }
        }
    }
    let mut all_nodes = nodes
        .into_values()
        .map(|candidate| candidate.node)
        .collect::<Vec<_>>();
    all_nodes.sort_by(|a, b| {
        b.degree
            .cmp(&a.degree)
            .then_with(|| a.source_id.cmp(&b.source_id))
            .then_with(|| a.id.cmp(&b.id))
    });
    (all_nodes, edges, total_nodes, total_edges)
}

fn article_universe_sync(
    app: &AppHandle,
    source_id: String,
    requested_limit: Option<usize>,
) -> Result<KnowledgeUniverse, String> {
    let (conn, _) = connection(app)?;
    let source_path = conn
        .query_row(
            "SELECT source_path FROM knowledge_documents WHERE source_id=?1",
            [&source_id],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("knowledge article not found: {source_id}"))?;
    let limit = requested_limit
        .unwrap_or(DEFAULT_UNIVERSE_LIMIT)
        .clamp(100, MAX_UNIVERSE_LIMIT);
    let path = PathBuf::from(source_path);
    let raw = fs::read(&path).map_err(|e| format!("cannot read graph {}: {e}", path.display()))?;
    let value: Value = serde_json::from_slice(&raw)
        .map_err(|e| format!("invalid graph {}: {e}", path.display()))?;
    if !value.is_object() {
        return Err(format!("graph root is not an object: {}", path.display()));
    }
    let (all_nodes, edges, total_nodes, total_edges) = graph_records_from_value(&source_id, &value);
    // Seed each real extraction section, then expand only through real edges.
    let mut selected_ids = HashSet::new();
    let mut represented_clusters = HashSet::new();
    for node in &all_nodes {
        if represented_clusters.insert(node.cluster.clone()) {
            selected_ids.insert(node.id.clone());
        }
    }
    let degree_by_id = all_nodes
        .iter()
        .map(|node| (node.id.clone(), node.degree))
        .collect::<HashMap<_, _>>();
    let mut frontier = selected_ids.clone();
    while selected_ids.len() < limit && !frontier.is_empty() {
        let mut candidates = HashSet::new();
        for edge in &edges {
            if frontier.contains(&edge.source) && !selected_ids.contains(&edge.target) {
                candidates.insert(edge.target.clone());
            }
            if frontier.contains(&edge.target) && !selected_ids.contains(&edge.source) {
                candidates.insert(edge.source.clone());
            }
        }
        let mut ranked = candidates.into_iter().collect::<Vec<_>>();
        ranked.sort_by(|a, b| {
            degree_by_id
                .get(b)
                .cmp(&degree_by_id.get(a))
                .then_with(|| a.cmp(b))
        });
        frontier.clear();
        for id in ranked {
            if selected_ids.len() >= limit {
                break;
            }
            if selected_ids.insert(id.clone()) {
                frontier.insert(id);
            }
        }
    }
    if selected_ids.len() < limit {
        for node in &all_nodes {
            if selected_ids.len() >= limit {
                break;
            }
            selected_ids.insert(node.id.clone());
        }
    }
    let visible_nodes = all_nodes
        .into_iter()
        .filter(|node| selected_ids.contains(&node.id))
        .collect::<Vec<_>>();
    let visible_edges = edges
        .into_iter()
        .filter(|edge| selected_ids.contains(&edge.source) && selected_ids.contains(&edge.target))
        .collect::<Vec<_>>();
    Ok(KnowledgeUniverse {
        nodes: visible_nodes.clone(),
        edges: visible_edges.clone(),
        total_nodes,
        total_edges,
        visible_nodes: visible_nodes.len(),
        visible_edges: visible_edges.len(),
        truncated: visible_nodes.len() < total_nodes || visible_edges.len() < total_edges,
    })
}

fn import_sync(
    app: &AppHandle,
    requested_source: Option<String>,
) -> Result<KnowledgeBaseStatus, String> {
    let source = requested_source
        .filter(|value| !value.trim().is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(|| default_source_dir(app));
    if !source.is_dir() {
        return Err(format!(
            "CATDA knowledge source directory does not exist: {}",
            source.display()
        ));
    }
    let (conn, db_path) = connection(app)?;
    let files = numeric_output_dirs(&source)?;
    if files.is_empty() {
        return Err(format!(
            "No output_*/graph/full_output.json files found in {}",
            source.display()
        ));
    }
    conn.execute_batch(
        "BEGIN IMMEDIATE; DELETE FROM knowledge_documents; DELETE FROM knowledge_fts;
         DELETE FROM knowledge_nodes; DELETE FROM knowledge_nodes_fts; DELETE FROM knowledge_edges;",
    )
    .map_err(|e| e.to_string())?;
    let mut indexed_bytes = 0u64;
    let mut total_nodes = 0usize;
    let mut total_edges = 0usize;
    for (source_id, path) in files.iter() {
        let bytes = fs::read(path).map_err(|e| e.to_string())?;
        let byte_len = bytes.len() as u64;
        let value: Value = serde_json::from_slice(&bytes)
            .map_err(|e| format!("invalid graph {}: {}", path.display(), e))?;
        let (nodes, edges) = count_nodes_edges(&value);
        let mut content = String::with_capacity(bytes.len().min(MAX_CONTENT_CHARS));
        let mut images = Vec::new();
        collect_strings(&value, None, &mut content, &mut images);
        let title = source_article_title(&source, source_id, &value);
        let source_path = path.to_string_lossy().into_owned();
        let image_json = serde_json::to_string(&images).map_err(|e| e.to_string())?;
        conn.execute(
            "INSERT INTO knowledge_documents(source_id,title,source_path,content,related_images,bytes,nodes,edges)
             VALUES(?1,?2,?3,?4,?5,?6,?7,?8)",
            params![source_id, title, source_path, content, image_json, byte_len, nodes, edges],
        )
        .map_err(|e| e.to_string())?;
        conn.execute(
            "INSERT INTO knowledge_fts(source_id,title,source_path,content)
             SELECT source_id,title,source_path,content FROM knowledge_documents WHERE source_id=?1",
            [source_id],
        )
        .map_err(|e| e.to_string())?;
        let (graph_nodes, graph_edges, _, _) = graph_records_from_value(source_id, &value);
        for node in graph_nodes {
            let node_id = node.id.clone();
            let node_source_id = node.source_id.clone();
            let node_label = node.label.clone();
            let node_type = node.node_type.clone();
            let node_cluster = node.cluster.clone();
            let node_properties = node.properties.clone();
            let related_images =
                serde_json::to_string(&node.related_images).map_err(|e| e.to_string())?;
            conn.execute(
                "INSERT INTO knowledge_nodes(node_id,source_id,label,node_type,cluster,degree,properties,related_images)
                 VALUES(?1,?2,?3,?4,?5,?6,?7,?8)",
                params![
                    node_id,
                    node_source_id,
                    node_label,
                    node_type,
                    node_cluster,
                    node.degree as i64,
                    node_properties,
                    related_images,
                ],
            )
            .map_err(|e| e.to_string())?;
            conn.execute(
                "INSERT INTO knowledge_nodes_fts(node_id,source_id,label,node_type,cluster,properties)
                 VALUES(?1,?2,?3,?4,?5,?6)",
                params![
                    node.id,
                    node.source_id,
                    node.label,
                    node.node_type,
                    node.cluster,
                    node.properties,
                ],
            )
            .map_err(|e| e.to_string())?;
        }
        for edge in graph_edges {
            conn.execute(
                "INSERT OR IGNORE INTO knowledge_edges(source_node,target_node,relation,weight,source_id)
                 VALUES(?1,?2,?3,?4,?5)",
                params![edge.source, edge.target, edge.relation, edge.weight, edge.source_id],
            )
            .map_err(|e| e.to_string())?;
        }
        indexed_bytes += byte_len;
        total_nodes += nodes;
        total_edges += edges;
    }
    let now = chrono_like_now();
    set_meta(&conn, "source_dir", source.to_string_lossy())?;
    set_meta(&conn, "indexed_at", &now)?;
    set_meta(&conn, "documents", &files.len().to_string())?;
    set_meta(&conn, "indexed_bytes", &indexed_bytes.to_string())?;
    set_meta(&conn, "nodes", &total_nodes.to_string())?;
    set_meta(&conn, "edges", &total_edges.to_string())?;
    set_meta(&conn, "error", "")?;
    conn.execute_batch("COMMIT;").map_err(|e| e.to_string())?;
    Ok(status_from(&conn, &db_path))
}

fn chrono_like_now() -> String {
    // Avoid adding a date-time dependency to the Tauri binary.
    format!(
        "{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0)
    )
}

fn fts_query(query: &str) -> String {
    let mut terms = Vec::new();
    let mut current = String::new();
    for ch in query.chars() {
        if ch.is_ascii_alphanumeric() || ch == '_' || ch == '-' || ch == '.' {
            current.push(ch);
        } else {
            if !current.is_empty() {
                terms.push(std::mem::take(&mut current));
            }
            if ('\u{4e00}'..='\u{9fff}').contains(&ch) {
                terms.push(ch.to_string());
            }
        }
    }
    if !current.is_empty() {
        terms.push(current);
    }
    terms.dedup();
    terms
        .into_iter()
        .map(|term| format!("\"{}\"", term.replace('"', "")))
        .collect::<Vec<_>>()
        .join(" OR ")
}

fn search_sync(
    app: &AppHandle,
    query: String,
    limit: usize,
) -> Result<Vec<KnowledgeSearchResult>, String> {
    let (conn, _) = connection(app)?;
    let expression = fts_query(&query);
    if expression.is_empty() {
        return Ok(Vec::new());
    }
    let capped = limit.clamp(1, 12) as i64;
    let mut results = Vec::new();
    let mut stmt = conn
        .prepare(
            "SELECT source_id,title,source_path,
                    snippet(knowledge_fts, 3, '[', ']', ' … ', 36),
                    bm25(knowledge_fts), related_images
             FROM knowledge_fts JOIN knowledge_documents USING(source_id)
             WHERE knowledge_fts MATCH ?1 ORDER BY bm25(knowledge_fts) LIMIT ?2",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![expression, capped], |row| {
            let raw_images: String = row.get(5)?;
            let related_images = serde_json::from_str(&raw_images).unwrap_or_default();
            Ok(KnowledgeSearchResult {
                source_id: row.get(0)?,
                title: row.get(1)?,
                source_path: row.get(2)?,
                snippet: row.get(3)?,
                score: row.get::<_, f64>(4)?.abs(),
                related_images,
            })
        })
        .map_err(|e| e.to_string())?;
    for row in rows {
        results.push(row.map_err(|e| e.to_string())?);
    }
    if results.is_empty() {
        // FTS tokenization is intentionally conservative for Chinese prompts;
        // a bounded LIKE fallback still gives useful exact entity matches.
        let needle = query.trim();
        if !needle.is_empty() {
            let pattern = format!("%{}%", needle.replace('%', "").replace('_', ""));
            let mut fallback = conn
                .prepare(
                    "SELECT source_id,title,source_path,substr(content,1,420),0.0,related_images
                 FROM knowledge_documents WHERE content LIKE ?1 LIMIT ?2",
                )
                .map_err(|e| e.to_string())?;
            let rows = fallback
                .query_map(params![pattern, capped], |row| {
                    let raw_images: String = row.get(5)?;
                    Ok(KnowledgeSearchResult {
                        source_id: row.get(0)?,
                        title: row.get(1)?,
                        source_path: row.get(2)?,
                        snippet: row.get(3)?,
                        score: row.get(4)?,
                        related_images: serde_json::from_str(&raw_images).unwrap_or_default(),
                    })
                })
                .map_err(|e| e.to_string())?;
            for row in rows {
                results.push(row.map_err(|e| e.to_string())?);
            }
        }
    }
    results.sort_by(|a, b| a.score.partial_cmp(&b.score).unwrap_or(Ordering::Equal));
    Ok(results)
}

const DEFAULT_GRAPH_SEARCH_LIMIT: usize = 12;
const MAX_GRAPH_SEARCH_LIMIT: usize = 48;

fn graph_node_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<KnowledgeUniverseNode> {
    let raw_images: String = row.get(7)?;
    Ok(KnowledgeUniverseNode {
        id: row.get(0)?,
        label: row.get(2)?,
        node_type: row.get(3)?,
        cluster: row.get(4)?,
        source_id: row.get(1)?,
        degree: row.get::<_, i64>(5)?.max(0) as usize,
        properties: row.get(6)?,
        related_images: serde_json::from_str(&raw_images).unwrap_or_default(),
    })
}

fn graph_search_sync(
    app: &AppHandle,
    query: String,
    limit: usize,
) -> Result<KnowledgeGraphSearchResult, String> {
    let (conn, _) = connection(app)?;
    let expression = fts_query(&query);
    if expression.is_empty() {
        return Ok(KnowledgeGraphSearchResult::default());
    }
    let capped = limit.clamp(1, MAX_GRAPH_SEARCH_LIMIT);
    let mut matched_nodes = Vec::new();
    let mut matched_ids = HashSet::new();
    let mut total_matches = conn
        .query_row(
            "SELECT COUNT(*) FROM knowledge_nodes_fts WHERE knowledge_nodes_fts MATCH ?1",
            [&expression],
            |row| row.get::<_, i64>(0),
        )
        .unwrap_or(0)
        .max(0) as usize;
    let mut stmt = conn
        .prepare(
            "SELECT n.node_id,n.source_id,n.label,n.node_type,n.cluster,n.degree,n.properties,n.related_images
             FROM knowledge_nodes_fts f JOIN knowledge_nodes n ON n.node_id=f.node_id
             WHERE knowledge_nodes_fts MATCH ?1 ORDER BY bm25(knowledge_nodes_fts) LIMIT ?2",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![expression, capped as i64], graph_node_from_row)
        .map_err(|e| e.to_string())?;
    for row in rows {
        let node = row.map_err(|e| e.to_string())?;
        matched_ids.insert(node.id.clone());
        matched_nodes.push(node);
    }
    if matched_nodes.is_empty() {
        let needle = query.trim();
        if !needle.is_empty() {
            let pattern = format!("%{}%", needle.replace('%', "").replace('_', ""));
            total_matches = conn
                .query_row(
                    "SELECT COUNT(*) FROM knowledge_nodes
                     WHERE label LIKE ?1 OR node_type LIKE ?1 OR cluster LIKE ?1 OR properties LIKE ?1",
                    [&pattern],
                    |row| row.get::<_, i64>(0),
                )
                .unwrap_or(0)
                .max(0) as usize;
            let mut fallback = conn
                .prepare(
                    "SELECT node_id,source_id,label,node_type,cluster,degree,properties,related_images
                     FROM knowledge_nodes
                     WHERE label LIKE ?1 OR node_type LIKE ?1 OR cluster LIKE ?1 OR properties LIKE ?1
                     ORDER BY degree DESC LIMIT ?2",
                )
                .map_err(|e| e.to_string())?;
            let rows = fallback
                .query_map(params![pattern, capped as i64], graph_node_from_row)
                .map_err(|e| e.to_string())?;
            for row in rows {
                let node = row.map_err(|e| e.to_string())?;
                matched_ids.insert(node.id.clone());
                matched_nodes.push(node);
            }
        }
    }
    if matched_nodes.is_empty() {
        return Ok(KnowledgeGraphSearchResult::default());
    }

    let mut edges = Vec::new();
    let mut edge_keys = HashSet::new();
    let mut neighbor_ids = HashSet::new();
    for node_id in &matched_ids {
        let mut stmt = conn
            .prepare(
                "SELECT source_node,target_node,relation,weight,source_id
                 FROM knowledge_edges WHERE source_node=?1 OR target_node=?1",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([node_id], |row| {
                Ok(KnowledgeUniverseEdge {
                    source: row.get(0)?,
                    target: row.get(1)?,
                    relation: row.get(2)?,
                    weight: row.get(3)?,
                    source_id: row.get(4)?,
                })
            })
            .map_err(|e| e.to_string())?;
        for row in rows {
            let edge = row.map_err(|e| e.to_string())?;
            let key = format!(
                "{}\u{1f}{}\u{1f}{}\u{1f}{}",
                edge.source, edge.target, edge.relation, edge.source_id
            );
            if edge_keys.insert(key) {
                if !matched_ids.contains(&edge.source) {
                    neighbor_ids.insert(edge.source.clone());
                }
                if !matched_ids.contains(&edge.target) {
                    neighbor_ids.insert(edge.target.clone());
                }
                edges.push(edge);
            }
        }
    }

    let mut adjacent_nodes = Vec::new();
    for node_id in neighbor_ids {
        let node = conn
            .query_row(
                "SELECT node_id,source_id,label,node_type,cluster,degree,properties,related_images
                 FROM knowledge_nodes WHERE node_id=?1",
                [&node_id],
                graph_node_from_row,
            )
            .optional()
            .map_err(|e| e.to_string())?;
        if let Some(node) = node {
            adjacent_nodes.push(node);
        }
    }
    adjacent_nodes.sort_by(|a, b| b.degree.cmp(&a.degree).then_with(|| a.id.cmp(&b.id)));
    let neighbor_cap = capped.saturating_mul(3);
    let truncated = total_matches > matched_nodes.len() || adjacent_nodes.len() > neighbor_cap;
    adjacent_nodes.truncate(neighbor_cap);
    let visible_ids = matched_ids
        .iter()
        .cloned()
        .chain(adjacent_nodes.iter().map(|node| node.id.clone()))
        .collect::<HashSet<_>>();
    edges.retain(|edge| visible_ids.contains(&edge.source) && visible_ids.contains(&edge.target));
    Ok(KnowledgeGraphSearchResult {
        total_matches,
        matched_nodes,
        adjacent_nodes,
        edges,
        truncated,
    })
}

fn articles_sync(app: &AppHandle) -> Result<Vec<KnowledgeArticleSummary>, String> {
    let (conn, _) = connection(app)?;
    let mut stmt = conn
        .prepare(
            "SELECT source_id,title,bytes,nodes,edges FROM knowledge_documents
             ORDER BY CAST(SUBSTR(source_id, 8) AS INTEGER), source_id",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| {
            Ok(KnowledgeArticleSummary {
                source_id: row.get(0)?,
                title: row.get(1)?,
                bytes: row.get(2)?,
                nodes: row.get(3)?,
                edges: row.get(4)?,
            })
        })
        .map_err(|e| e.to_string())?;
    rows.map(|row| row.map_err(|e| e.to_string())).collect()
}

#[tauri::command(async)]
pub async fn knowledge_base_status(app: AppHandle) -> Result<KnowledgeBaseStatus, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let (conn, path) = connection(&app)?;
        Ok(status_from(&conn, &path))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command(async)]
pub async fn knowledge_base_import(
    app: AppHandle,
    source_dir: Option<String>,
) -> Result<KnowledgeBaseStatus, String> {
    tauri::async_runtime::spawn_blocking(move || import_sync(&app, source_dir))
        .await
        .map_err(|e| e.to_string())?
}

/// First-run convenience: build the default CATDA index when the application
/// has no documents yet. An older database that predates the graph tables is
/// rebuilt once so graph retrieval is available without a manual re-import.
#[tauri::command(async)]
pub async fn knowledge_base_ensure(app: AppHandle) -> Result<KnowledgeBaseStatus, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let (conn, path) = connection(&app)?;
        let previous_source = meta(&conn, "source_dir");
        let previous_source_exists = previous_source
            .as_deref()
            .map(Path::new)
            .is_some_and(Path::is_dir);
        if parse_usize(&conn, "documents") > 0
            && (parse_usize(&conn, "nodes") == 0 || table_count(&conn, "knowledge_nodes") > 0)
            && previous_source_exists
        {
            return Ok(status_from(&conn, &path));
        }
        drop(conn);
        import_sync(&app, previous_source.filter(|_| previous_source_exists))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command(async)]
pub async fn knowledge_base_search(
    app: AppHandle,
    query: String,
    limit: Option<usize>,
) -> Result<Vec<KnowledgeSearchResult>, String> {
    tauri::async_runtime::spawn_blocking(move || search_sync(&app, query, limit.unwrap_or(6)))
        .await
        .map_err(|e| e.to_string())?
}

/// Search the persistent CATDA graph index and return direct matches,
/// one-hop neighbors, and the relationship edges connecting them.
#[tauri::command(async)]
pub async fn knowledge_base_graph_search(
    app: AppHandle,
    query: String,
    limit: Option<usize>,
) -> Result<KnowledgeGraphSearchResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        graph_search_sync(&app, query, limit.unwrap_or(DEFAULT_GRAPH_SEARCH_LIMIT))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command(async)]
pub async fn knowledge_base_articles(
    app: AppHandle,
) -> Result<Vec<KnowledgeArticleSummary>, String> {
    tauri::async_runtime::spawn_blocking(move || articles_sync(&app))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command(async)]
pub async fn knowledge_base_graph(
    app: AppHandle,
    source_id: String,
    limit: Option<usize>,
) -> Result<KnowledgeUniverse, String> {
    tauri::async_runtime::spawn_blocking(move || article_universe_sync(&app, source_id, limit))
        .await
        .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::{
        count_nodes_edges, fts_query, graph_records_from_value, markdown_title, universe_node_from,
    };
    use serde_json::json;

    #[test]
    fn counts_graph_sections() {
        let value =
            json!({"synthesis": {"nodes": [{"id": 1}], "edges": [{"source": 1, "target": 2}]}});
        assert_eq!(count_nodes_edges(&value), (1, 1));
    }

    #[test]
    fn builds_safe_fts_expression() {
        assert_eq!(
            fts_query("iron foam HER"),
            "\"iron\" OR \"foam\" OR \"HER\""
        );
    }

    #[test]
    fn extracts_article_title_from_markdown_heading() {
        let markdown = "www.example.org\n\nArticle\n\n# Acid-Corrosion-Induced NiFe Catalysts\n\n# Introduction";
        assert_eq!(
            markdown_title(markdown).as_deref(),
            Some("Acid-Corrosion-Induced NiFe Catalysts")
        );
    }

    #[test]
    fn namespaces_universe_nodes_by_article_and_section() {
        let value = json!({"id": "shared", "type": "chemical", "name": "Iron"});
        let synthesis = universe_node_from("output_1", "synthesis", &value).unwrap();
        let testing = universe_node_from("output_1", "testing", &value).unwrap();
        assert_eq!(synthesis.id, "output_1::synthesis::shared");
        assert_eq!(testing.id, "output_1::testing::shared");
        assert_ne!(synthesis.id, testing.id);
    }

    #[test]
    fn graph_records_keep_matches_neighbors_and_relationships_namespaced() {
        let value = json!({
            "synthesis": {
                "nodes": [
                    {"id": "method", "type": "method", "name": "Hydrothermal"},
                    {"id": "sample", "type": "material", "name": "NiFe-LDH"}
                ],
                "edges": [{"source": "method", "target": "sample", "relation": "produces"}]
            }
        });
        let (nodes, edges, total_nodes, total_edges) = graph_records_from_value("output_7", &value);
        assert_eq!((total_nodes, total_edges), (2, 1));
        assert_eq!(nodes.len(), 2);
        assert_eq!(edges.len(), 1);
        assert_eq!(edges[0].source, "output_7::synthesis::method");
        assert_eq!(edges[0].target, "output_7::synthesis::sample");
        assert_eq!(nodes.iter().map(|node| node.degree).sum::<usize>(), 2);
    }
}
