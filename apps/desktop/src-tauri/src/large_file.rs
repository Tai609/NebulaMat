// UI entry to the large-file memory-pointer probe (P0-6). When a file is too
// big to preview, the app can still introspect it WITHOUT loading it: this runs
// the bundled `large-file` skill's stdlib probe (schema / shape / sample / key
// numbers) and returns its compact JSON pointer. Bounded memory — the probe
// streams and samples; it never loads the whole file.
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

use crate::artifact_file::{resolve_or_locate, scoped_root};

/// First path in `candidates` that exists on disk (the bundled resource in a
/// packaged app; the in-repo skill in a dev run).
fn first_existing(candidates: &[PathBuf]) -> Option<PathBuf> {
    candidates.iter().find(|p| p.is_file()).cloned()
}

/// Locate the probe script: the bundled Tauri resource first, then the in-repo
/// path for `pnpm tauri dev`.
fn probe_script(app: &AppHandle) -> Option<PathBuf> {
    let mut candidates: Vec<PathBuf> = Vec::new();
    if let Ok(p) = app.path().resolve(
        "skills/large-file/large_file_probe.py",
        tauri::path::BaseDirectory::Resource,
    ) {
        candidates.push(p);
    }
    // Dev fallback: repo checkout relative to the crate.
    candidates.push(
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../../runtime/skills-bundle/large-file/large_file_probe.py"),
    );
    first_existing(&candidates)
}

/// Introspect a workspace file with the large-file probe and return the JSON
/// pointer string. `path` is resolved (and sandboxed) under the given scope.
/// `async`: the probe is a whole python run over a large file.
#[tauri::command(async)]
pub fn probe_large_file(
    app: AppHandle,
    path: String,
    root: Option<String>,
    dir: Option<String>,
) -> Result<String, String> {
    let full = resolve_or_locate(&scoped_root(&app, root.as_deref(), dir.as_deref())?, &path)?;
    if !full.is_file() {
        return Err("no such file".into());
    }
    let (python, _) = crate::kernel::python_bin(&app)?;
    let script = probe_script(&app).ok_or("large-file probe not found")?;

    let mut cmd = crate::runtime::quiet_command(&python);
    cmd.arg(&script).arg(&full);
    // Same enriched PATH as the kernel/agent so a conda/homebrew python resolves.
    cmd.env("PATH", crate::runtime::enriched_path());
    let out = cmd
        .output()
        .map_err(|e| format!("probe failed to run: {e}"))?;
    if !out.status.success() {
        return Err(format!(
            "probe error: {}",
            String::from_utf8_lossy(&out.stderr)
        ));
    }
    Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
}

#[cfg(test)]
mod tests {
    use super::first_existing;

    #[test]
    fn first_existing_picks_the_first_present_file() {
        let dir = std::env::temp_dir().join(format!("os-probe-locate-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let real = dir.join("large_file_probe.py");
        std::fs::write(&real, b"# probe").unwrap();

        let missing = dir.join("nope.py");
        // Bundled-resource-missing → falls through to the present dev path.
        assert_eq!(first_existing(&[missing.clone(), real.clone()]), Some(real));
        // Nothing present → None (caller surfaces a clear error).
        assert_eq!(first_existing(&[missing, dir.join("also-nope.py")]), None);

        let _ = std::fs::remove_dir_all(&dir);
    }
}
