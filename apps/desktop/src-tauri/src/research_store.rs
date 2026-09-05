//! Workspace-owned persistence for CEBRO research graphs.
//!
//! Graphs are stored as one JSON document per research in the active session
//! workspace. Every committed graph version also becomes an append-only
//! provenance record, so a graph can be traced back without making the DSH
//! transcript the source of truth.

use std::path::{Path, PathBuf};

use serde_json::Value;
use tauri::{AppHandle, State};

use crate::provenance::{append_record_with_event_id, ProvenanceState};
use crate::runtime::workspace_dir;

const STORE_DIR: &str = ".openscience/research";

fn research_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let root = workspace_dir(app)?;
    Ok(root.join(STORE_DIR))
}

fn validate_research_id(id: &str) -> Result<(), String> {
    let trimmed = id.trim();
    if trimmed.is_empty() || trimmed == "." || trimmed == ".." {
        return Err("research id must not be empty".into());
    }
    if trimmed.len() > 160 {
        return Err("research id is too long".into());
    }
    if trimmed.chars().any(|c| {
        c.is_control() || matches!(c, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|')
    }) {
        return Err("research id contains a path or filename control character".into());
    }
    Ok(())
}

fn graph_file(dir: &Path, research_id: &str) -> Result<PathBuf, String> {
    validate_research_id(research_id)?;
    Ok(dir.join(format!("{research_id}.json")))
}

fn graph_id(graph: &Value) -> Result<&str, String> {
    graph
        .get("researchId")
        .and_then(Value::as_str)
        .filter(|id| !id.trim().is_empty())
        .ok_or_else(|| "research graph must contain a non-empty researchId".into())
}

fn updated_at(graph: &Value) -> i64 {
    graph.get("updatedAt").and_then(Value::as_i64).unwrap_or(0)
}

fn read_graph_file(path: &Path) -> Result<Value, String> {
    let text =
        std::fs::read_to_string(path).map_err(|e| format!("research graph read failed: {e}"))?;
    serde_json::from_str(&text).map_err(|e| format!("research graph JSON is invalid: {e}"))
}

fn persist_graph(root: &Path, research_id: &str, graph: &Value) -> Result<(), String> {
    validate_research_id(research_id)?;
    let graph_id = graph_id(graph)?;
    if graph_id != research_id {
        return Err("research graph id does not match the target file".into());
    }
    let body = serde_json::to_string_pretty(graph)
        .map_err(|e| format!("research graph encode failed: {e}"))?;
    let dir = root.join(STORE_DIR);
    std::fs::create_dir_all(&dir).map_err(|e| format!("research store directory failed: {e}"))?;
    let path = graph_file(&dir, research_id)?;
    let temporary = path.with_extension("json.tmp");
    std::fs::write(&temporary, body.as_bytes())
        .map_err(|e| format!("research graph temporary write failed: {e}"))?;
    if let Err(error) = std::fs::rename(&temporary, &path) {
        // Windows does not replace an existing destination during rename.
        if path.exists() {
            std::fs::remove_file(&path)
                .map_err(|e| format!("research graph replace failed: {e}"))?;
            std::fs::rename(&temporary, &path)
                .map_err(|e| format!("research graph commit failed: {e}"))?;
        } else {
            return Err(format!("research graph commit failed: {error}"));
        }
    }

    let provenance_path = format!("{STORE_DIR}/{research_id}.json");
    let event_id = graph
        .get("eventId")
        .and_then(Value::as_str)
        .map(str::to_owned);
    append_record_with_event_id(
        root,
        &provenance_path,
        "cebro.graph",
        None,
        None,
        Some(body),
        None,
        Some(format!("Persist CEBRO research graph {research_id}")),
        None,
        None,
        event_id,
    )?;
    Ok(())
}

/// List valid graph documents from the active workspace, newest first.
#[tauri::command]
pub fn list_research_graphs(app: AppHandle) -> Result<Vec<Value>, String> {
    let dir = research_dir(&app)?;
    let Ok(entries) = std::fs::read_dir(&dir) else {
        return Ok(Vec::new());
    };
    let mut graphs = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|ext| ext.to_str()) != Some("json") {
            continue;
        }
        let Ok(graph) = read_graph_file(&path) else {
            continue;
        };
        if let Ok(id) = graph_id(&graph) {
            if validate_research_id(id).is_ok() {
                graphs.push(graph);
            }
        }
    }
    graphs.sort_by_key(|graph| std::cmp::Reverse(updated_at(graph)));
    Ok(graphs)
}

/// Read one graph document by its CEBRO research id.
#[tauri::command]
pub fn read_research_graph(app: AppHandle, research_id: String) -> Result<Value, String> {
    let dir = research_dir(&app)?;
    let path = graph_file(&dir, &research_id)?;
    if !path.is_file() {
        return Err(format!("research graph not found: {research_id}"));
    }
    read_graph_file(&path)
}

/// Atomically persist one graph version and append its provenance entry.
#[tauri::command]
pub fn write_research_graph(
    app: AppHandle,
    state: State<'_, ProvenanceState>,
    research_id: String,
    graph: Value,
    expected_workspace: Option<String>,
) -> Result<(), String> {
    let _guard = state.0.lock().map_err(|_| "provenance lock poisoned")?;
    let root = workspace_dir(&app)?;
    if let Some(expected) = expected_workspace {
        let actual = std::fs::canonicalize(&root)
            .map_err(|e| format!("active workspace unavailable: {e}"))?;
        let expected = std::fs::canonicalize(expected)
            .map_err(|e| format!("expected workspace unavailable: {e}"))?;
        if actual != expected {
            return Err("active workspace changed before research graph persistence".into());
        }
    }
    persist_graph(&root, &research_id, &graph)?;
    drop(_guard);
    crate::git_snapshot::commit_best_effort(
        &root,
        &format!("Persist research graph {research_id}"),
    );
    Ok(())
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::{persist_graph, validate_research_id};
    use crate::provenance::versions_for;

    fn temp_root(tag: &str) -> std::path::PathBuf {
        let root = std::env::temp_dir().join(format!("ai4s-research-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).unwrap();
        root
    }

    #[test]
    fn accepts_portable_ids_and_rejects_path_injection() {
        assert!(validate_research_id("research-1").is_ok());
        assert!(validate_research_id("研究-1").is_ok());
        assert!(validate_research_id("../escape").is_err());
        assert!(validate_research_id("C:\\escape").is_err());
        assert!(validate_research_id("research:name").is_err());
    }

    #[test]
    fn persists_snapshot_and_deduplicates_provenance_event() {
        let root = temp_root("round-trip");
        let first = json!({
            "researchId": "research-1",
            "updatedAt": 1,
            "eventId": "event-1",
            "title": "First snapshot"
        });
        persist_graph(&root, "research-1", &first).unwrap();
        persist_graph(&root, "research-1", &first).unwrap();

        let file = root.join(".openscience/research/research-1.json");
        assert_eq!(
            std::fs::read_to_string(&file).unwrap(),
            serde_json::to_string_pretty(&first).unwrap()
        );
        let records = versions_for(&root, ".openscience/research/research-1.json").unwrap();
        assert_eq!(records.len(), 1);
        assert_eq!(records[0].tool, "cebro.graph");
        assert_eq!(records[0].source_event_id.as_deref(), Some("event-1"));

        let second = json!({
            "researchId": "research-1",
            "updatedAt": 2,
            "eventId": "event-2",
            "title": "Second snapshot"
        });
        persist_graph(&root, "research-1", &second).unwrap();
        assert_eq!(
            std::fs::read_to_string(&file).unwrap(),
            serde_json::to_string_pretty(&second).unwrap()
        );
        assert_eq!(
            versions_for(&root, ".openscience/research/research-1.json")
                .unwrap()
                .len(),
            2
        );
        let _ = std::fs::remove_dir_all(root);
    }
}
