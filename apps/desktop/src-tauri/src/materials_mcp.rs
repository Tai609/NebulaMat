// First-party materials MCP provisioning. This environment is intentionally
// separate from science-mcp-env because pymatgen/ASE/RDKit and future ML
// packages have incompatible and much larger dependency graphs.
use serde_json::Value;
use std::path::PathBuf;
use std::process::Command;
use tauri::{path::BaseDirectory, AppHandle, Manager};

use crate::runtime::{base_workspace_dir, workspace_dir};

pub(crate) fn env_dir(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("runtime")
        .join("materials-env"))
}

pub(crate) fn python_bin(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = env_dir(app)?;
    #[cfg(windows)]
    return Ok(dir.join("Scripts").join("python.exe"));
    #[cfg(not(windows))]
    Ok(dir.join("bin").join("python"))
}

/// Resolve the bundled first-party package. The source-tree fallback keeps
/// `tauri dev` useful; release builds use the resource declared in tauri.conf.
fn package_dir(app: &AppHandle) -> Result<PathBuf, String> {
    if let Ok(path) = app.path().resolve("materials-mcp", BaseDirectory::Resource) {
        if path.is_dir() {
            return Ok(path);
        }
    }
    let source_tree = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../../runtime/materials-mcp")
        .canonicalize()
        .map_err(|e| format!("materials-mcp resource is missing: {e}"))?;
    if source_tree.is_dir() {
        Ok(source_tree)
    } else {
        Err("materials-mcp resource is missing from this build".into())
    }
}

/// Absolute path to the isolated materials interpreter, if provisioned.
#[tauri::command]
pub fn materials_mcp_python(app: AppHandle) -> Result<Option<String>, String> {
    let py = python_bin(&app)?;
    Ok(py.exists().then(|| py.to_string_lossy().to_string()))
}

/// Create the independent materials environment and fully refresh the bundled
/// MCP package and its dependency set. `uv pip install --reinstall` is
/// intentional: it replaces every resolved package in the environment in one
/// install operation, without a fragile uninstall-first window.
/// No package is accepted from the frontend: this command can only install the
/// first-party source shipped with the app.
#[tauri::command]
pub async fn setup_materials_mcp(app: AppHandle) -> Result<String, String> {
    let dir = env_dir(&app)?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let py = python_bin(&app)?;
    if !py.exists() {
        crate::uv::create_venv(&app, "materials", &dir).await?;
    }
    let package = package_dir(&app)?;
    crate::uv::run_uv(
        &app,
        "materials",
        vec![
            "pip".into(),
            "install".into(),
            "--reinstall".into(),
            "--python".into(),
            py.to_string_lossy().to_string(),
            package.to_string_lossy().to_string(),
        ],
        "uv pip install --reinstall materials-mcp and dependencies",
    )
    .await?;
    Ok(py.to_string_lossy().to_string())
}

fn validate_id(value: &str, label: &str) -> Result<(), String> {
    if value.is_empty()
        || value.len() > 160
        || !value
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | ':' | '.'))
    {
        return Err(format!("invalid {label}"));
    }
    Ok(())
}

fn review_workspace(app: &AppHandle, requested: Option<String>) -> Result<PathBuf, String> {
    let active = workspace_dir(app)?
        .canonicalize()
        .map_err(|e| e.to_string())?;
    let base = base_workspace_dir(app)?
        .canonicalize()
        .map_err(|e| e.to_string())?;
    let target = requested
        .map(PathBuf::from)
        .unwrap_or_else(|| active.clone())
        .canonicalize()
        .map_err(|e| format!("materials workflow workspace is unavailable: {e}"))?;
    if !target.starts_with(&base) {
        return Err(
            "materials workflow workspace must be inside the configured workspace root".into(),
        );
    }
    Ok(target)
}

fn run_review_bridge(
    app: &AppHandle,
    args: &[String],
    workspace_directory: Option<String>,
) -> Result<Value, String> {
    let python = python_bin(app)?;
    if !python.is_file() {
        return Err(
            "materials MCP is not installed; enable materials-mcp in Settings first".into(),
        );
    }
    let workspace = review_workspace(app, workspace_directory.clone())?;
    // The app data environment can outlive an app upgrade. Put the bundled
    // first-party package ahead of site-packages so a newly added bridge
    // module (such as human_review) is available before setup is rerun.
    let package = package_dir(app)?;
    let package_parent = package
        .parent()
        .ok_or_else(|| "materials-mcp package has no parent directory".to_string())?;
    let mut bridge_args = Vec::with_capacity(args.len() + 2);
    if let Some(directory) = workspace_directory {
        bridge_args.extend(["--workspace".into(), directory]);
    }
    bridge_args.extend_from_slice(args);
    let output = Command::new(python)
        .args(["-m", "materials_mcp.human_review"])
        .args(bridge_args)
        .current_dir(workspace)
        .env("PYTHONPATH", package_parent)
        .output()
        .map_err(|error| format!("materials review bridge failed to start: {error}"))?;
    if !output.status.success() {
        let message = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if message.is_empty() {
            format!("materials review bridge exited with {}", output.status)
        } else {
            message
        });
    }
    serde_json::from_slice(&output.stdout)
        .map_err(|error| format!("materials review bridge returned invalid JSON: {error}"))
}

/// Read a workflow snapshot for the DFT review panel.
#[tauri::command]
pub fn get_materials_workflow(app: AppHandle, workflow_id: String) -> Result<Value, String> {
    validate_id(&workflow_id, "workflow id")?;
    run_review_bridge(&app, &["get".into(), workflow_id], None)
}

/// Read a workflow snapshot from the session's workspace without applying the
/// DFT-only inbox filter used by the human review surface.
#[tauri::command]
pub fn get_materials_workflow_scoped(
    app: AppHandle,
    workflow_id: String,
    workspace_directory: Option<String>,
) -> Result<Value, String> {
    validate_id(&workflow_id, "workflow id")?;
    run_review_bridge(&app, &["get".into(), workflow_id], workspace_directory)
}

#[tauri::command]
pub fn claim_materials_dft_human_review(
    app: AppHandle,
    workflow_id: String,
    task_id: String,
    actor: String,
) -> Result<Value, String> {
    validate_id(&workflow_id, "workflow id")?;
    validate_id(&task_id, "task id")?;
    if !actor.starts_with("human:") {
        return Err("DFT review actor must use human:<id>".into());
    }
    validate_id(&actor, "human actor")?;
    run_review_bridge(&app, &["claim".into(), workflow_id, task_id, actor], None)
}

/// List DFT-enabled workflow summaries for the review inbox.
#[tauri::command]
pub fn list_materials_workflows(app: AppHandle) -> Result<Value, String> {
    run_review_bridge(&app, &["list".into(), "--dft-only".into()], None)
}

/// List every materials workflow for a session workspace. This is deliberately
/// separate from `list_materials_workflows`, whose DFT gate semantics are used
/// by the approval inbox.
#[tauri::command]
pub fn list_all_materials_workflows(
    app: AppHandle,
    workspace_directory: Option<String>,
) -> Result<Value, String> {
    run_review_bridge(&app, &["list".into()], workspace_directory)
}

/// Record a named human's DFT decision. The Python coordinator enforces all
/// task ownership, artifact validation, and SHA-256 binding rules.
#[tauri::command]
pub fn record_material_dft_human_review(
    app: AppHandle,
    workflow_id: String,
    task_id: String,
    actor: String,
    decision: String,
    note: String,
    requested_changes: Vec<String>,
) -> Result<Value, String> {
    validate_id(&workflow_id, "workflow id")?;
    validate_id(&task_id, "task id")?;
    if !actor.starts_with("human:") {
        return Err("DFT review actor must use human:<id>".into());
    }
    validate_id(&actor, "human actor")?;
    if !matches!(
        decision.as_str(),
        "approved" | "changes_requested" | "rejected"
    ) {
        return Err("invalid DFT review decision".into());
    }
    let encoded_changes = serde_json::to_string(&requested_changes)
        .map_err(|error| format!("could not encode requested changes: {error}"))?;
    run_review_bridge(
        &app,
        &[
            "review".into(),
            workflow_id,
            task_id,
            actor,
            decision,
            "--note".into(),
            note,
            "--requested-changes".into(),
            encoded_changes,
        ],
        None,
    )
}
