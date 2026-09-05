// Modal cloud-compute detection (P2-2). Like the HPC/Slurm integration, the app
// never handles credentials of its own: Modal runs use the user's OWN `modal`
// install + token. This module only DETECTS whether Modal is available and
// authenticated so the UI can surface status; submission itself is agent-driven
// via the bundled `modal-run` skill.
use tauri::AppHandle;
use tauri_plugin_shell::ShellExt;

#[derive(serde::Serialize)]
pub struct ModalStatus {
    /// `modal --version` succeeded.
    pub installed: bool,
    pub version: Option<String>,
    /// A token is configured (`~/.modal.toml` or MODAL_TOKEN_ID in the env).
    pub authenticated: bool,
    /// Human-readable next step when something is missing.
    pub hint: Option<String>,
}

/// Pure auth check: a token env var (non-empty) or a `~/.modal.toml` file.
pub(crate) fn is_authenticated(home: &str, token_env: Option<&str>) -> bool {
    if token_env.map(|t| !t.trim().is_empty()).unwrap_or(false) {
        return true;
    }
    !home.is_empty() && std::path::Path::new(home).join(".modal.toml").is_file()
}

#[tauri::command]
pub async fn modal_status(app: AppHandle) -> Result<ModalStatus, String> {
    let cmd = app.shell().command("modal").args(["--version"]);
    // GUI-launched apps get a minimal PATH; use the same enriched PATH the agent
    // sees so a conda/user-installed `modal` is found.
    let cmd = cmd.env("PATH", crate::runtime::enriched_path());
    let out = cmd.output().await;
    let (installed, version) = match out {
        Ok(o) if o.status.success() => (
            true,
            Some(String::from_utf8_lossy(&o.stdout).trim().to_string()),
        ),
        _ => (false, None),
    };

    let home = std::env::var("HOME").unwrap_or_default();
    let token_env = std::env::var("MODAL_TOKEN_ID").ok();
    let authenticated = installed && is_authenticated(&home, token_env.as_deref());

    let hint = if !installed {
        Some("Modal not found — install it (`pip install modal`) then run `modal token new` in your terminal.".to_string())
    } else if !authenticated {
        Some(
            "Modal is installed but not authenticated — run `modal token new` in your terminal."
                .to_string(),
        )
    } else {
        None
    };

    Ok(ModalStatus {
        installed,
        version,
        authenticated,
        hint,
    })
}

#[cfg(test)]
mod tests {
    use super::is_authenticated;

    #[test]
    fn auth_via_token_env() {
        assert!(is_authenticated("/home/x", Some("ak-123")));
        assert!(!is_authenticated("/home/x", Some("")));
        assert!(!is_authenticated("/home/x", Some("   ")));
    }

    #[test]
    fn auth_via_config_file() {
        let dir = std::env::temp_dir().join(format!("modaltest-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let home = dir.to_string_lossy().to_string();
        assert!(!is_authenticated(&home, None)); // no file yet
        std::fs::write(dir.join(".modal.toml"), "token_id='x'").unwrap();
        assert!(is_authenticated(&home, None)); // file present
        assert!(!is_authenticated("", None)); // empty home is never authed
        let _ = std::fs::remove_dir_all(&dir);
    }
}
