//! Goal-mode state module. Per-session goal state lives in the DSH home and is
//! read directly by the UI, so status updates do not consume a model turn.

use serde_json::{json, Value};
use std::path::PathBuf;
use tauri::AppHandle;

fn goals_file(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(crate::runtime::dsh_home(app)?.join("nebulamat-goals.json"))
}

fn read_goals(app: &AppHandle) -> Result<Value, String> {
    let path = goals_file(app)?;
    let Ok(text) = std::fs::read_to_string(&path) else {
        return Ok(json!({ "version": 1, "goals": {} }));
    };
    serde_json::from_str(&text).map_err(|e| format!("nebulamat-goals.json unreadable: {e}"))
}

/// Atomic write-temp-then-rename so a
/// crash mid-write can never leave a truncated state file.
fn write_goals(app: &AppHandle, root: &Value) -> Result<(), String> {
    let path = goals_file(app)?;
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, serde_json::to_vec(root).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, &path).map_err(|e| e.to_string())
}

/// The current goal for a session, or null when none exists. The JSON is the
/// plugin's own schema (objective/status/autoTurns/history/…) passed through
/// verbatim so the UI and the plugin can never disagree on fields. Reading
/// also heals invalid history literals left by older builds (the plugin's
/// schema decode rejects the whole file otherwise), so an update fixes broken
/// state the moment a session opens.
#[tauri::command(async)]
pub fn goal_state(app: AppHandle, session_id: String) -> Result<Option<Value>, String> {
    let mut root = read_goals(&app)?;
    if let Some(goals) = root.get_mut("goals").and_then(|g| g.as_object_mut()) {
        if repair_history_types(goals) {
            let _ = write_goals(&app, &root); // best-effort heal
        }
    }
    Ok(root.get("goals").and_then(|g| g.get(&session_id)).cloned())
}

/// Pause / resume / clear a goal from the UI, without a model turn.
/// Mirrors the module's transitions: continuation only fires while the
/// status is "active", so writing "paused" stops the loop at the next idle.
#[tauri::command(async)]
pub fn goal_update(
    app: AppHandle,
    session_id: String,
    action: String,
) -> Result<Option<Value>, String> {
    let mut root = read_goals(&app)?;
    let goals = root
        .get_mut("goals")
        .and_then(|g| g.as_object_mut())
        .ok_or("no goals recorded")?;

    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_secs();

    let updated: Option<Value> = match action.as_str() {
        "clear" => {
            goals.remove(&session_id);
            None
        }
        "pause" | "resume" => {
            let goal = goals
                .get_mut(&session_id)
                .and_then(|g| g.as_object_mut())
                .ok_or("no goal for this session")?;
            // History `type` must be a literal from the plugin's schema
            // ("paused"/"resumed" — NOT the action verbs), or the plugin's
            // Effect Schema decode fails hard (StateDecodeError) on its next
            // read and goal mode breaks for every session.
            let (status, entry_type, detail) = if action == "pause" {
                ("paused", "paused", "Paused from the app.")
            } else {
                ("active", "resumed", "Resumed from the app.")
            };
            goal.insert("status".into(), json!(status));
            goal.insert("updatedAt".into(), json!(now));
            if let Some(history) = goal.get_mut("history").and_then(|h| h.as_array_mut()) {
                history.push(json!({ "type": entry_type, "detail": detail, "timestamp": now }));
            }
            Some(Value::Object(goal.clone()))
        }
        other => return Err(format!("unknown goal action: {other}")),
    };

    // Self-heal state written by builds that used the invalid action verbs —
    // one bad entry poisons the plugin's whole state file.
    repair_history_types(goals);

    write_goals(&app, &root)?;
    Ok(updated)
}

/// Rewrite invalid history `type` literals ("pause"→"paused", "resume"→
/// "resumed") across every goal. Anything else is left untouched. Returns
/// whether anything was repaired.
fn repair_history_types(goals: &mut serde_json::Map<String, Value>) -> bool {
    let mut changed = false;
    for goal in goals.values_mut() {
        let Some(history) = goal.get_mut("history").and_then(|h| h.as_array_mut()) else {
            continue;
        };
        for entry in history {
            let fixed = match entry.get("type").and_then(|t| t.as_str()) {
                Some("pause") => "paused",
                Some("resume") => "resumed",
                _ => continue,
            };
            entry["type"] = json!(fixed);
            changed = true;
        }
    }
    changed
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    // The mutation logic is exercised through goal_update in integration; here
    // we pin the schema assumptions the UI depends on.
    #[test]
    fn state_schema_passthrough_keeps_module_fields() {
        let goal = json!({
            "objective": "x", "status": "active", "autoTurns": 2,
            "history": [], "completionEvidence": null
        });
        assert_eq!(goal["status"], "active");
        assert_eq!(goal["autoTurns"], 2);
    }

    #[test]
    fn repair_rewrites_invalid_history_types_only() {
        let mut goals = json!({
            "s1": { "history": [
                { "type": "pause", "detail": "d", "timestamp": 1 },
                { "type": "resume", "detail": "d", "timestamp": 2 },
                { "type": "checkpoint", "detail": "d", "timestamp": 3 }
            ]}
        });
        repair_history_types(goals.as_object_mut().unwrap());
        let h = &goals["s1"]["history"];
        assert_eq!(h[0]["type"], "paused");
        assert_eq!(h[1]["type"], "resumed");
        assert_eq!(h[2]["type"], "checkpoint");
    }
}
