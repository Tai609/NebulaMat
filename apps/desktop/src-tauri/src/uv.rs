// Shared runner for long uv-sidecar provisioning (jupyter env, science MCP
// env). The old `.output().await` calls were silent and unbounded: a stalled
// download (proxy, TLS inspection, antivirus) left the UI on "Setting up…"
// forever with zero diagnostics. This streams every output line to the
// frontend as a `setup-progress` event and kills the process when it produces
// no output for STALL_SECS, turning a silent hang into a readable error.
use std::collections::VecDeque;
use std::path::Path;
use std::time::Duration;
use tauri::{AppHandle, Emitter};
use tauri_plugin_shell::process::CommandEvent;
use tauri_plugin_shell::ShellExt;

/// One line of live provisioning output, shown in Settings while setting up.
#[derive(Clone, serde::Serialize)]
pub struct SetupProgress {
    /// Which provisioning flow the line belongs to ("jupyter" | "science").
    pub task: &'static str,
    pub line: String,
}

/// No output for this long = the download is wedged, not slow: uv prints a
/// line per package/wheel, so even a slow link produces output well within
/// this window. Generous on purpose — killing a genuinely slow download is
/// worse than waiting.
const STALL_SECS: u64 = 600;

/// How many trailing output lines to keep for the error message.
const TAIL_LINES: usize = 12;

/// Keep the last TAIL_LINES lines: uv puts the actual failure reason at the
/// end of its output, and the full log of a 300 MB install is noise.
fn push_tail(tail: &mut VecDeque<String>, line: &str) {
    if tail.len() == TAIL_LINES {
        tail.pop_front();
    }
    tail.push_back(line.to_string());
}

/// Run the bundled uv with live progress. Emits each output line as a
/// `setup-progress` event, fails with the output tail on a non-zero exit, and
/// kills + fails when uv goes silent for STALL_SECS.
pub async fn run_uv(
    app: &AppHandle,
    task: &'static str,
    args: Vec<String>,
    label: &str,
) -> Result<(), String> {
    let mut cmd = app
        .shell()
        .sidecar("uv")
        .map_err(|e| format!("uv sidecar not found: {e}"))?
        .args(args);
    // Same proxy the OpenCode sidecar uses, plus optional PyPI / Python-download
    // mirrors: a GUI-launched app inherits no shell env, so without this uv's
    // download of the managed Python (github.com) and wheels (pypi.org) ignores
    // the user's configured proxy and mirrors and can hang or fail on restricted
    // networks (see runtime::uv_network_env).
    for (k, v) in crate::runtime::uv_network_env(app) {
        cmd = cmd.env(k, v);
    }
    let (mut rx, child) = cmd
        .spawn()
        .map_err(|e| format!("{label} failed to run: {e}"))?;

    let mut tail: VecDeque<String> = VecDeque::new();
    loop {
        let event = match tokio::time::timeout(Duration::from_secs(STALL_SECS), rx.recv()).await {
            Err(_) => {
                let _ = child.kill();
                return Err(format!(
                    "{label} stalled — no output for {} minutes. Check your network/proxy \
                     (needs github.com and pypi.org), and consider excluding the app data \
                     folder from real-time antivirus scanning, then retry.",
                    STALL_SECS / 60
                ));
            }
            // Channel closed without a Terminated event: treat as failure.
            Ok(None) => return Err(format!("{label} exited without a status: {}", last(&tail))),
            Ok(Some(event)) => event,
        };
        match event {
            CommandEvent::Stdout(bytes) | CommandEvent::Stderr(bytes) => {
                // uv writes plain lines when piped; split handles multi-line chunks.
                for line in String::from_utf8_lossy(&bytes).split(['\n', '\r']) {
                    let line = line.trim();
                    if line.is_empty() {
                        continue;
                    }
                    push_tail(&mut tail, line);
                    let _ = app.emit(
                        "setup-progress",
                        SetupProgress {
                            task,
                            line: line.to_string(),
                        },
                    );
                }
            }
            CommandEvent::Error(e) => push_tail(&mut tail, &e),
            CommandEvent::Terminated(status) => {
                return if status.code == Some(0) {
                    Ok(())
                } else {
                    Err(format!("{label} failed: {}", last(&tail)))
                };
            }
            _ => {}
        }
    }
}

/// Create the shared env's virtualenv, robust to an unusable system Python.
///
/// First tries to reuse a Python already on the machine (`uv venv --python 3.12`,
/// no download — fast, and what most users get). When that base interpreter is
/// unusable — a broken/partial install, or antivirus/permissions blocking the
/// copied `python.exe` (the "uv venv failed: Using CPython …" first-run failure
/// reported on Windows) — it retries with `--managed-python`, which ignores
/// system Pythons and downloads an isolated managed 3.12 instead.
///
/// The caller must only invoke this when the env's interpreter is missing, so a
/// clean wipe between attempts is safe: no MCP server can be holding the
/// interpreter (that lock was the separate #10 failure). The final error, when
/// both fail, carries both reasons for diagnosis.
pub async fn create_venv(app: &AppHandle, task: &'static str, dir: &Path) -> Result<(), String> {
    let venv_args = |managed: bool| {
        let mut a = vec![
            "venv".to_string(),
            dir.to_string_lossy().to_string(),
            "--python".into(),
            "3.12".into(),
            "--allow-existing".into(),
        ];
        if managed {
            a.push("--managed-python".into());
        }
        a
    };

    let Err(reuse_err) = run_uv(app, task, venv_args(false), "uv venv").await else {
        return Ok(());
    };

    // The system interpreter was unusable — start clean and download an
    // isolated managed Python. Wiping removes any half-written venv from the
    // failed attempt so the retry can't inherit its broken pyvenv.cfg.
    let _ = app.emit(
        "setup-progress",
        SetupProgress {
            task,
            line: "System Python unusable — downloading an isolated managed Python…".into(),
        },
    );
    let _ = std::fs::remove_dir_all(dir);
    std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    run_uv(app, task, venv_args(true), "uv venv (managed Python)")
        .await
        .map_err(|managed_err| {
            format!("system Python failed ({reuse_err}); managed-Python fallback also failed: {managed_err}")
        })
}

fn last(tail: &VecDeque<String>) -> String {
    if tail.is_empty() {
        "(no output)".to_string()
    } else {
        tail.iter().cloned().collect::<Vec<_>>().join("\n")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tail_keeps_only_the_last_lines() {
        let mut tail = VecDeque::new();
        for i in 0..(TAIL_LINES + 5) {
            push_tail(&mut tail, &format!("line {i}"));
        }
        assert_eq!(tail.len(), TAIL_LINES);
        assert_eq!(tail.front().unwrap(), "line 5");
        assert_eq!(tail.back().unwrap(), &format!("line {}", TAIL_LINES + 4));
    }

    #[test]
    fn last_reports_no_output_when_empty() {
        assert_eq!(last(&VecDeque::new()), "(no output)");
        let mut tail = VecDeque::new();
        push_tail(&mut tail, "error: boom");
        assert!(last(&tail).contains("boom"));
    }
}
