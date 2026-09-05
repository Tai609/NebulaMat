// Multi-agent lifecycle audit. Agent handoffs are distinct from authored-file
// provenance and executable runs, so they live in their own append-only ledger:
// <workspace>/.openscience/agents.jsonl.
use std::path::{Component, Path, PathBuf};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use serde_json::Value;
use tauri::AppHandle;

use crate::provenance::content_hash;
use crate::runtime::workspace_dir;

const STORE_DIR: &str = ".openscience";
const AUDIT_FILE: &str = "agents.jsonl";
const TEXT_CAP: usize = 64_000;
const LIST_CAP: usize = 2_000;

#[derive(Default)]
pub struct AgentAuditState(pub Mutex<()>);

#[derive(Clone, Debug, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentAuditInput {
    pub event_type: String,
    pub agent_id: String,
    pub role: String,
    pub session_id: String,
    #[serde(default)]
    pub parent_session_id: Option<String>,
    #[serde(default)]
    pub parent_task_id: Option<String>,
    #[serde(default)]
    pub model: Option<String>,
    #[serde(default)]
    pub started_at: Option<u64>,
    #[serde(default)]
    pub ended_at: Option<u64>,
    #[serde(default)]
    pub status: Option<String>,
    #[serde(default)]
    pub task_input: Option<Value>,
    #[serde(default)]
    pub output_summary: Option<String>,
    #[serde(default)]
    pub deliverables: Vec<String>,
    #[serde(default)]
    pub review_decision: Option<Value>,
    #[serde(default)]
    pub revision_diff: Option<String>,
}

#[derive(Clone, Debug, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentAuditRecord {
    pub schema_version: u32,
    pub event_id: String,
    pub ts: u64,
    #[serde(flatten)]
    pub input: AgentAuditInput,
}

fn audit_file(root: &Path) -> PathBuf {
    root.join(STORE_DIR).join(AUDIT_FILE)
}

fn valid_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 160
        && value
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | ':' | '.'))
}

fn valid_event(value: &str) -> bool {
    matches!(
        value,
        "agent.started"
            | "agent.completed"
            | "agent.failed"
            | "review.decision"
            | "artifact.revised"
            | "governance.blocked"
            | "governance.approval-required"
    )
}

fn cap_text(mut value: String) -> String {
    if value.len() <= TEXT_CAP {
        return value;
    }
    let mut end = TEXT_CAP;
    while !value.is_char_boundary(end) {
        end -= 1;
    }
    value.truncate(end);
    value.push_str("\n... [truncated]");
    value
}

fn sensitive_key(key: &str) -> bool {
    let key = key.to_ascii_lowercase();
    [
        "password",
        "secret",
        "token",
        "api_key",
        "apikey",
        "authorization",
        "credential",
    ]
    .iter()
    .any(|needle| key.contains(needle))
}

fn sanitize_value(value: Value, depth: usize) -> Value {
    if depth > 8 {
        return Value::String("[depth capped]".into());
    }
    match value {
        Value::String(text) => Value::String(cap_text(text)),
        Value::Array(values) => Value::Array(
            values
                .into_iter()
                .take(LIST_CAP)
                .map(|value| sanitize_value(value, depth + 1))
                .collect(),
        ),
        Value::Object(values) => Value::Object(
            values
                .into_iter()
                .take(LIST_CAP)
                .map(|(key, value)| {
                    let value = if sensitive_key(&key) {
                        Value::String("[redacted]".into())
                    } else {
                        sanitize_value(value, depth + 1)
                    };
                    (key, value)
                })
                .collect(),
        ),
        other => other,
    }
}

fn normalize_deliverable(root: &Path, raw: &str) -> Option<String> {
    let path = Path::new(raw);
    let relative = if path.is_absolute() {
        let full = path
            .canonicalize()
            .ok()
            .or_else(|| Some(path.to_path_buf()))?;
        let base = root
            .canonicalize()
            .ok()
            .unwrap_or_else(|| root.to_path_buf());
        full.strip_prefix(base).ok()?.to_path_buf()
    } else {
        path.to_path_buf()
    };
    if relative.as_os_str().is_empty()
        || relative
            .components()
            .any(|component| !matches!(component, Component::Normal(_)))
    {
        return None;
    }
    Some(
        relative
            .components()
            .map(|component| component.as_os_str().to_string_lossy().into_owned())
            .collect::<Vec<_>>()
            .join("/"),
    )
}

fn validate_and_sanitize(
    root: &Path,
    mut input: AgentAuditInput,
) -> Result<AgentAuditInput, String> {
    if !valid_event(&input.event_type) {
        return Err("invalid agent audit event type".into());
    }
    for (label, value) in [
        ("agent id", input.agent_id.as_str()),
        ("role", input.role.as_str()),
        ("session id", input.session_id.as_str()),
    ] {
        if !valid_id(value) {
            return Err(format!("invalid {label}"));
        }
    }
    for (label, value) in [
        ("parent session id", input.parent_session_id.as_deref()),
        ("parent task id", input.parent_task_id.as_deref()),
    ] {
        if value.is_some_and(|value| !valid_id(value)) {
            return Err(format!("invalid {label}"));
        }
    }
    input.model = input.model.map(cap_text);
    input.status = input.status.map(cap_text);
    input.task_input = input.task_input.map(|value| sanitize_value(value, 0));
    input.review_decision = input.review_decision.map(|value| sanitize_value(value, 0));
    input.output_summary = input.output_summary.map(cap_text);
    input.revision_diff = input.revision_diff.map(cap_text);
    input.deliverables = input
        .deliverables
        .into_iter()
        .filter_map(|path| normalize_deliverable(root, &path))
        .collect();
    input.deliverables.sort();
    input.deliverables.dedup();
    Ok(input)
}

fn append_record(root: &Path, input: AgentAuditInput) -> Result<AgentAuditRecord, String> {
    let input = validate_and_sanitize(root, input)?;
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default();
    let millis = now.as_millis();
    let event_id = format!(
        "agent_{}",
        content_hash(&format!(
            "{millis}:{}:{}:{}:{}",
            input.event_type,
            input.agent_id,
            input.parent_task_id.as_deref().unwrap_or(""),
            input.status.as_deref().unwrap_or("")
        ))
    );
    let record = AgentAuditRecord {
        schema_version: 1,
        event_id,
        ts: now.as_secs(),
        input,
    };
    let file = audit_file(root);
    if let Some(directory) = file.parent() {
        std::fs::create_dir_all(directory).map_err(|error| error.to_string())?;
    }
    use std::io::Write;
    let mut file = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(file)
        .map_err(|error| format!("agent audit open failed: {error}"))?;
    writeln!(
        file,
        "{}",
        serde_json::to_string(&record).map_err(|error| error.to_string())?
    )
    .map_err(|error| format!("agent audit write failed: {error}"))?;
    Ok(record)
}

fn read_records(root: &Path) -> Vec<AgentAuditRecord> {
    let Ok(text) = std::fs::read_to_string(audit_file(root)) else {
        return Vec::new();
    };
    text.lines()
        .filter_map(|line| serde_json::from_str(line).ok())
        .collect()
}

#[tauri::command(async)]
pub fn record_agent_audit(
    app: AppHandle,
    state: tauri::State<AgentAuditState>,
    input: AgentAuditInput,
) -> Result<AgentAuditRecord, String> {
    let _guard = state.0.lock().map_err(|_| "agent audit lock poisoned")?;
    append_record(&workspace_dir(&app)?, input)
}

#[tauri::command(async)]
pub fn list_agent_audit(
    app: AppHandle,
    session_id: Option<String>,
) -> Result<Vec<AgentAuditRecord>, String> {
    let mut records = read_records(&workspace_dir(&app)?);
    if let Some(session_id) = session_id {
        records.retain(|record| {
            record.input.session_id == session_id
                || record.input.parent_session_id.as_deref() == Some(session_id.as_str())
        });
    }
    records.reverse();
    Ok(records)
}

#[cfg(test)]
mod tests {
    use super::{append_record, read_records, AgentAuditInput};
    use serde_json::json;

    fn temp_root(tag: &str) -> std::path::PathBuf {
        let root =
            std::env::temp_dir().join(format!("ai4s-agent-audit-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).unwrap();
        root
    }

    fn input() -> AgentAuditInput {
        AgentAuditInput {
            event_type: "agent.started".into(),
            agent_id: "ses_reader".into(),
            role: "reader".into(),
            session_id: "ses_reader".into(),
            parent_session_id: Some("ses_parent".into()),
            parent_task_id: Some("call_1".into()),
            model: Some("provider/model".into()),
            started_at: Some(10),
            ended_at: None,
            status: Some("running".into()),
            task_input: Some(json!({"prompt":"read paper", "apiKey":"do-not-store"})),
            output_summary: None,
            deliverables: vec!["evidence/paper.md".into(), "../escape".into()],
            review_decision: None,
            revision_diff: None,
        }
    }

    #[test]
    fn appends_redacted_bounded_records() {
        let root = temp_root("append");
        let record = append_record(&root, input()).unwrap();
        assert_eq!(record.schema_version, 1);
        assert_eq!(record.input.deliverables, vec!["evidence/paper.md"]);
        assert_eq!(record.input.task_input.unwrap()["apiKey"], "[redacted]");
        assert_eq!(read_records(&root).len(), 1);
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn rejects_unknown_events_and_invalid_ids() {
        let root = temp_root("invalid");
        let mut bad = input();
        bad.event_type = "agent.maybe".into();
        assert!(append_record(&root, bad).is_err());
        let mut bad = input();
        bad.agent_id = "contains a space".into();
        assert!(append_record(&root, bad).is_err());
        let _ = std::fs::remove_dir_all(root);
    }
}
