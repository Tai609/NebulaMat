// App-managed NovoMCP HTTP service. NovoMCP speaks Streamable HTTP, so it is
// supervised as a local process and registered with OpenCode as a remote MCP
// endpoint. Its Python environment is isolated from the user's interpreter.
use std::net::{TcpListener, TcpStream};
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{AppHandle, Manager, State};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;

const PACKAGE: &str = "novomcp";

#[derive(Default)]
pub struct NovoMcpState {
    child: Mutex<Option<CommandChild>>,
    running: Mutex<bool>,
    lifecycle: Mutex<()>,
}

fn env_dir(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("runtime")
        .join("novomcp-env"))
}

fn python_bin(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = env_dir(app)?;
    #[cfg(windows)]
    return Ok(dir.join("Scripts").join("python.exe"));
    #[cfg(not(windows))]
    Ok(dir.join("bin").join("python"))
}

fn novomcp_bin(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = env_dir(app)?;
    #[cfg(windows)]
    return Ok(dir.join("Scripts").join("novomcp.exe"));
    #[cfg(not(windows))]
    Ok(dir.join("bin").join("novomcp"))
}

fn pid_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(env_dir(app)?.join("novomcp.pid"))
}

fn meta_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(env_dir(app)?.join("server.json"))
}

fn enabled_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(env_dir(app)?.join("enabled"))
}

#[derive(serde::Serialize, serde::Deserialize, Clone)]
struct ServerMeta {
    port: u16,
}

#[derive(serde::Serialize)]
pub struct NovoMcpStatus {
    pub installed: bool,
    pub running: bool,
    pub url: Option<String>,
    pub mcp_url: Option<String>,
}

fn load_meta(app: &AppHandle) -> Option<ServerMeta> {
    let text = std::fs::read_to_string(meta_path(app).ok()?).ok()?;
    serde_json::from_str(&text).ok()
}

fn port_available(port: u16) -> bool {
    TcpListener::bind(("127.0.0.1", port)).is_ok()
}

fn kill_orphan(app: &AppHandle) {
    let Some(pid) = pid_path(app)
        .ok()
        .and_then(|p| std::fs::read_to_string(p).ok())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty() && s.chars().all(|c| c.is_ascii_digit()))
    else {
        return;
    };
    #[cfg(windows)]
    {
        let _ = crate::runtime::quiet_command("taskkill")
            .args([
                "/FI",
                &format!("PID eq {pid}"),
                "/FI",
                "IMAGENAME eq python.exe",
                "/F",
                "/T",
            ])
            .output();
    }
    #[cfg(unix)]
    {
        let _ = std::process::Command::new("kill")
            .args(["-TERM", &pid])
            .output();
    }
    std::thread::sleep(std::time::Duration::from_millis(250));
}

fn ensure_meta(app: &AppHandle) -> Result<ServerMeta, String> {
    if let Some(meta) = load_meta(app) {
        if !port_available(meta.port) {
            // The previous service may still own the port. Keep the endpoint
            // stable in that case; start_novomcp reports a useful bind error.
            return Ok(meta);
        }
        return Ok(meta);
    }
    let meta = ServerMeta {
        port: crate::runtime::free_port(),
    };
    std::fs::write(
        meta_path(app)?,
        serde_json::to_string(&meta).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    Ok(meta)
}

fn status_of(app: &AppHandle, state: &NovoMcpState) -> NovoMcpStatus {
    let installed = novomcp_bin(app).map(|p| p.exists()).unwrap_or(false);
    let running = *state.running.lock().unwrap();
    let port = load_meta(app).map(|m| m.port);
    NovoMcpStatus {
        installed,
        running,
        url: port.map(|p| format!("http://127.0.0.1:{p}")),
        mcp_url: port.map(|p| format!("http://127.0.0.1:{p}/mcp/")),
    }
}

#[tauri::command]
pub fn novomcp_status(app: AppHandle, state: State<'_, NovoMcpState>) -> NovoMcpStatus {
    status_of(&app, &state)
}

/// Install NovoMCP into its own managed Python environment. The package is
/// intentionally not bundled: its optional chemistry/ML dependencies are too
/// large for the desktop installer and are downloaded only when enabled.
#[tauri::command]
pub async fn setup_novomcp(app: AppHandle) -> Result<(), String> {
    let dir = env_dir(&app)?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let py = python_bin(&app)?;
    if !py.exists() {
        crate::uv::create_venv(&app, "novomcp", &dir).await?;
    }
    crate::uv::run_uv(
        &app,
        "novomcp",
        vec![
            "pip".into(),
            "install".into(),
            "--python".into(),
            py.to_string_lossy().to_string(),
            PACKAGE.into(),
        ],
        "uv pip install novomcp",
    )
    .await?;
    let _ = ensure_meta(&app)?;
    Ok(())
}

/// Start NovoMCP bound to loopback. We invoke uvicorn directly so the
/// upstream console entrypoint's 0.0.0.0 default cannot expose the service.
#[tauri::command(async)]
pub fn start_novomcp(
    app: AppHandle,
    state: State<'_, NovoMcpState>,
) -> Result<NovoMcpStatus, String> {
    start_service(&app, &state, true)
}

fn start_service(
    app: &AppHandle,
    state: &NovoMcpState,
    persist_enabled: bool,
) -> Result<NovoMcpStatus, String> {
    let _guard = state.lifecycle.lock().unwrap();
    if *state.running.lock().unwrap() {
        return Ok(status_of(app, state));
    }
    let py = python_bin(app)?;
    if !py.exists() {
        return Err("NovoMCP is not set up yet".into());
    }
    kill_orphan(app);
    let meta = ensure_meta(app)?;
    if !port_available(meta.port) {
        return Err(format!("NovoMCP port {} is already in use", meta.port));
    }

    let audit_path = env_dir(app)?.join("audit.jsonl");
    let mut cmd = app
        .shell()
        .command(py.to_string_lossy().to_string())
        .args([
            "-m".to_string(),
            "uvicorn".to_string(),
            "novomcp.main_https:app".to_string(),
            "--host".to_string(),
            "127.0.0.1".to_string(),
            "--port".to_string(),
            meta.port.to_string(),
        ])
        .env("NOVO_AUTH", "local")
        .env("NOVO_METER", "local")
        .env("NOVO_AUDIT", "local")
        .env("NOVO_AUDIT_PATH", audit_path.to_string_lossy().to_string());
    for (key, value) in crate::runtime::sidecar_proxy_env(app) {
        cmd = cmd.env(key, value);
    }
    let (mut rx, child) = cmd
        .spawn()
        .map_err(|e| format!("failed to start NovoMCP: {e}"))?;
    if let Ok(path) = pid_path(app) {
        let _ = std::fs::write(path, child.pid().to_string());
    }
    *state.child.lock().unwrap() = Some(child);
    *state.running.lock().unwrap() = true;
    let monitor_app = app.clone();
    tauri::async_runtime::spawn(async move {
        while let Some(event) = rx.recv().await {
            if matches!(event, CommandEvent::Terminated(_)) {
                *monitor_app.state::<NovoMcpState>().running.lock().unwrap() = false;
                break;
            }
        }
    });

    // Importing the scientific stack can take several seconds. Do not register
    // the endpoint with OpenCode until uvicorn is actually accepting clients.
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(60);
    while TcpStream::connect(("127.0.0.1", meta.port)).is_err() {
        if std::time::Instant::now() >= deadline || !*state.running.lock().unwrap() {
            kill_novomcp(state);
            return Err("NovoMCP exited before its local endpoint became ready".into());
        }
        std::thread::sleep(std::time::Duration::from_millis(150));
    }
    if persist_enabled {
        std::fs::write(enabled_path(app)?, b"1").map_err(|e| e.to_string())?;
    }
    Ok(status_of(app, state))
}

/// Remove the startup marker left by older releases and terminate any legacy
/// service. NovoMCP is no longer a supported connector, so it must never be
/// imported or started as part of a fresh DeepSeek Harness launch.
pub fn disable_legacy_service(app: &AppHandle) {
    let enabled = enabled_path(app).map(|p| p.exists()).unwrap_or(false);
    let pid_exists = pid_path(app).map(|p| p.exists()).unwrap_or(false);
    if !enabled && !pid_exists {
        return;
    }
    kill_orphan(app);
    if let Ok(path) = pid_path(app) {
        let _ = std::fs::remove_file(path);
    }
    if let Ok(path) = enabled_path(app) {
        let _ = std::fs::remove_file(path);
    }
}

#[tauri::command]
pub fn stop_novomcp(app: AppHandle, state: State<'_, NovoMcpState>) -> Result<(), String> {
    kill_novomcp(&state);
    let _ = std::fs::remove_file(pid_path(&app)?);
    let _ = std::fs::remove_file(enabled_path(&app)?);
    Ok(())
}

pub fn kill_novomcp(state: &NovoMcpState) {
    if let Some(child) = state.child.lock().unwrap().take() {
        let _ = child.kill();
    }
    *state.running.lock().unwrap() = false;
}
