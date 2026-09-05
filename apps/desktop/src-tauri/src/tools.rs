// Detects which scientific/runtime tools are available to the app: first on the
// user's own PATH, then — for the ones the app ships or provisions itself (the
// bundled uv sidecar, the managed Jupyter env) — the app's own copy. Probing the
// host alone reported "not found" for tools the app had already installed and
// was actively using (#68). This surfaces the truth to the UI honestly.
use serde::Serialize;
use sha2::Digest;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

#[derive(Serialize)]
pub struct ToolStatus {
    name: String,
    found: bool,
    version: Option<String>,
    /// True when the tool is the app's own (bundled uv / managed Jupyter env)
    /// rather than something on the user's PATH, so the UI can label it instead
    /// of telling the user to install what the app already ships.
    managed: bool,
    /// This row represents a large model asset that can be fetched into the
    /// active workspace with the explicit download button in the UI.
    downloadable: bool,
}

impl ToolStatus {
    fn new(name: &str, found: bool, version: Option<String>, managed: bool) -> Self {
        Self {
            name: name.to_string(),
            found,
            version,
            managed,
            downloadable: false,
        }
    }
}

fn probe(name: &str, bin: &str, version_arg: &str) -> ToolStatus {
    // Search the SAME enriched PATH the kernel and the agent's shell run
    // under — a GUI-launched app has a minimal PATH, and probing with it
    // misreported the user's anaconda/homebrew tools as missing.
    let path = Some(crate::runtime::enriched_path());
    probe_with_path(name, bin, version_arg, path.as_deref())
}

/// First line of a `--version` run, when it succeeded. Some tools print to
/// stderr (node, Rscript), hence the fallback.
fn version_line(out: &std::process::Output) -> Option<String> {
    let text = if !out.stdout.is_empty() {
        &out.stdout
    } else {
        &out.stderr
    };
    String::from_utf8_lossy(text)
        .lines()
        // WSL/Python may emit a deprecation warning before the requested
        // version. Keep the actual probe value instead of surfacing the
        // warning as the tool version.
        .find(|line| {
            let lower = line.trim().to_ascii_lowercase();
            !lower.is_empty()
                && !lower.starts_with("warning:")
                && !lower.starts_with("userwarning:")
        })
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

fn probe_with_path(name: &str, bin: &str, version_arg: &str, path: Option<&str>) -> ToolStatus {
    let mut cmd = crate::runtime::quiet_command(bin);
    cmd.arg(version_arg);
    if let Some(p) = path {
        cmd.env("PATH", p);
    }
    let out = cmd.output();
    match out {
        // `--version` must succeed — the Windows Store python alias runs,
        // prints an install hint, and exits non-zero; output alone is not
        // evidence the tool is installed.
        Ok(o) if o.status.success() => ToolStatus::new(name, true, version_line(&o), false),
        _ => ToolStatus::new(name, false, None, false),
    }
}

/// An app-owned binary at a known absolute path: the bundled uv sidecar or a
/// binary in the managed Jupyter env. Existence alone counts as found — that is
/// exactly what `jupyter_status().installed` reports for the same env, and the
/// two must never contradict each other. The version is a bonus.
fn probe_managed(name: &str, bin: &Path, version_arg: &str) -> Option<ToolStatus> {
    if !bin.exists() {
        return None;
    }
    let version = crate::runtime::quiet_command(bin)
        .arg(version_arg)
        .output()
        .ok()
        .filter(|o| o.status.success())
        .and_then(|o| version_line(&o));
    Some(ToolStatus::new(name, true, version, true))
}

/// Fall back to the app's own copy when the host probe found nothing. The
/// user's install always wins: it is what OpenCode's shell tool runs, and
/// relabelling it "app-managed" would be a lie.
fn or_managed(host: ToolStatus, managed: Option<PathBuf>, version_arg: &str) -> ToolStatus {
    if host.found {
        return host;
    }
    match managed {
        Some(bin) => probe_managed(&host.name, &bin, version_arg).unwrap_or(host),
        None => host,
    }
}

/// Host Jupyter, preferring `jupyter-lab` for its clean version string and
/// falling back to `jupyter` so an install without JupyterLab still counts.
fn jupyter_host_probe() -> ToolStatus {
    let lab = probe("Jupyter", "jupyter-lab", "--version");
    if lab.found {
        lab
    } else {
        probe("Jupyter", "jupyter", "--version")
    }
}

/// Run a small import probe against one Python interpreter. Keeping this
/// separate from the generic executable probe lets the environment page tell
/// the difference between Python being installed and a scientific package
/// being usable in that Python.
fn probe_python_module(name: &str, python: &Path, code: &str) -> ToolStatus {
    let mut cmd = crate::runtime::quiet_command(python);
    cmd.args(["-c", code])
        .env("PATH", crate::runtime::enriched_path());
    match cmd.output() {
        Ok(output) if output.status.success() => {
            ToolStatus::new(name, true, version_line(&output), false)
        }
        _ => ToolStatus::new(name, false, None, false),
    }
}

/// Probe the host Python installations in preference order. The managed
/// Jupyter interpreter is intentionally checked as a fallback only: an
/// existing user Python with torch installed is the environment that the
/// agent's shell will normally reach first.
fn python_module_probe(app: &AppHandle, name: &str, code: &str) -> ToolStatus {
    let mut candidates: Vec<PathBuf> = if cfg!(windows) {
        vec![PathBuf::from("python.exe"), PathBuf::from("python3.exe")]
    } else {
        vec![PathBuf::from("python3"), PathBuf::from("python")]
    };
    if let Ok(path) = crate::jupyter::env_bin(app, "python") {
        candidates.push(path);
    }
    for candidate in candidates {
        let result = probe_python_module(name, &candidate, code);
        if result.found {
            return result;
        }
    }
    ToolStatus::new(name, false, None, false)
}

/// The MatterGen environment is separate from Jupyter because the upstream
/// stack pins Python 3.10 and platform-specific PyTorch/PyG wheels. Prefer it
/// for MatterGen and PyTorch probes once the app has provisioned it.
fn mattergen_python(app: &AppHandle) -> Option<PathBuf> {
    let root = app
        .path()
        .app_data_dir()
        .ok()?
        .join("runtime")
        .join("mattergen")
        .join("venv");
    #[cfg(windows)]
    let python = root.join("Scripts").join("python.exe");
    #[cfg(not(windows))]
    let python = root.join("bin").join("python");
    python.is_file().then_some(python)
}

fn managed_python_module_probe(
    app: &AppHandle,
    name: &str,
    code: &str,
    managed_python: Option<PathBuf>,
) -> ToolStatus {
    if let Some(python) = managed_python {
        let result = probe_python_module(name, &python, code);
        if result.found {
            return ToolStatus {
                managed: true,
                ..result
            };
        }
    }
    #[cfg(windows)]
    {
        // MatterGen, MatterSim and UMA are commonly installed in the Linux
        // WSL2 environment. Probe that configured interpreter before the
        // empty Windows 3.12 Python so a valid WSL package is not reported as
        // missing merely because the native venv is unprovisioned.
        for interpreter in configured_wsl_python_interpreters(app) {
            let wsl = wsl_python_module_probe(&interpreter, name, code);
            if wsl.found {
                return wsl;
            }
        }
    }
    python_module_probe(app, name, code)
}

/// MatterGen is commonly installed in the project's WSL2 environment because
/// its upstream CUDA/PyG stack is Linux-first. The Windows app cannot execute
/// that interpreter as a native Path, but it can probe it through `wsl.exe` so
/// the environment page reports the real installation instead of suggesting a
/// second, empty native venv.
#[cfg(windows)]
fn configured_wsl_python_interpreters(app: &AppHandle) -> Vec<String> {
    // Keep the machine-specific path in materials/runtime.json when the
    // active workspace provides it. The fallback preserves detection for
    // older sessions that were created before the config was introduced.
    let mut paths = Vec::new();
    let mut roots = Vec::new();
    if let Ok(workspace) = crate::runtime::workspace_dir(app) {
        roots.push(workspace);
    }
    if let Ok(base) = crate::runtime::base_workspace_dir(app) {
        if !roots.iter().any(|root| root == &base) {
            roots.push(base);
        }
    }
    for root in roots {
        let config = root.join("materials").join("runtime.json");
        if let Ok(text) = std::fs::read_to_string(config) {
            if let Ok(value) = serde_json::from_str::<serde_json::Value>(&text) {
                if let Some(tools) = value.get("tools").and_then(serde_json::Value::as_object) {
                    for tool in tools.values() {
                        if let Some(runtimes) =
                            tool.get("runtime").and_then(serde_json::Value::as_object)
                        {
                            if let Some(path) = runtimes
                                .get("wsl_python")
                                .and_then(serde_json::Value::as_str)
                            {
                                if path.starts_with('/') && !paths.iter().any(|item| item == path) {
                                    paths.push(path.to_string());
                                }
                            }
                        }
                    }
                }
            }
        }
    }
    if !paths
        .iter()
        .any(|item| item == "/root/mattergen/venv/bin/python")
    {
        paths.push("/root/mattergen/venv/bin/python".to_string());
    }
    paths
}

#[cfg(windows)]
fn wsl_python_module_probe(interpreter: &str, name: &str, code: &str) -> ToolStatus {
    let mut cmd = crate::runtime::quiet_command("wsl.exe");
    cmd.args(["--exec", interpreter, "-c", code])
        .env("PATH", crate::runtime::enriched_path());
    match cmd.output() {
        Ok(output) if output.status.success() => ToolStatus::new(
            name,
            true,
            version_line(&output).map(|value| format!("{value} · WSL2")),
            false,
        ),
        _ => ToolStatus::new(name, false, None, false),
    }
}

/// CUDA is a host capability rather than a Python package. `nvidia-smi` gives
/// us a reliable driver/GPU signal without importing a CUDA runtime into the
/// desktop process.
fn cuda_probe() -> ToolStatus {
    let mut cmd = crate::runtime::quiet_command("nvidia-smi");
    cmd.args([
        "--query-gpu=name,driver_version,memory.total",
        "--format=csv,noheader,nounits",
    ])
    .env("PATH", crate::runtime::enriched_path());
    match cmd.output() {
        Ok(output) if output.status.success() => {
            let line = String::from_utf8_lossy(&output.stdout)
                .lines()
                .next()
                .map(str::trim)
                .filter(|line| !line.is_empty())
                .map(|line| {
                    let fields = line.split(',').map(str::trim).collect::<Vec<_>>();
                    if fields.len() == 3 {
                        format!("driver {} · {} · {} MiB", fields[1], fields[0], fields[2])
                    } else {
                        line.to_string()
                    }
                });
            ToolStatus::new("CUDA", line.is_some(), line, false)
        }
        _ => ToolStatus::new("CUDA", false, None, false),
    }
}

/// The MatterGen source is a small installer resource; the large checkpoint
/// is handled separately as a workspace asset below.
fn bundled_mattergen_source_probe(app: &AppHandle) -> ToolStatus {
    let resource = app
        .path()
        .resolve(
            "mattergen/upstream/pyproject.toml",
            tauri::path::BaseDirectory::Resource,
        )
        .ok();
    let source_tree = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../../runtime/mattergen/upstream/pyproject.toml");
    let path = resource
        .filter(|p| p.is_file())
        .or_else(|| source_tree.is_file().then_some(source_tree));
    ToolStatus::new(
        "MatterGen source",
        path.is_some(),
        path.map(|_| "1.0.3 · bundled".into()),
        true,
    )
}

fn mattergen_checkpoint_probe(app: &AppHandle) -> ToolStatus {
    let checkpoint = workspace_asset(
        app,
        "runtime/mattergen/models/chemical_system/checkpoints/last.ckpt",
    );
    let config = workspace_asset(app, "runtime/mattergen/models/chemical_system/config.yaml");
    let found = checkpoint.as_ref().is_some_and(|path| path.is_file())
        && config.as_ref().is_some_and(|path| path.is_file());
    let mut status = ToolStatus::new(
        "MatterGen checkpoint",
        found,
        checkpoint
            .as_ref()
            .filter(|path| path.is_file())
            .map(|path| {
                format!(
                    "chemical_system · {} MiB · workspace",
                    path.metadata()
                        .map(|m| m.len() / (1024 * 1024))
                        .unwrap_or(0)
                )
            }),
        false,
    );
    status.downloadable = true;
    status
}

const MATTERSIM_CHECKPOINT_SHA256: &str =
    "e3df9fa708725e3d453140646c7d1838324b347a3d1214cf1440522146f872b5";
const MATTERSIM_CHECKPOINT_URL: &str =
    "https://github.com/microsoft/mattersim/raw/v1.0.0/pretrained_models/mattersim-v1.0.0-5M.pth";
const UMA_WEIGHT_URL: &str =
    "https://huggingface.co/facebook/UMA/resolve/main/uma-s-1p2p1.pt?download=true";
const MATTERGEN_CHECKPOINT_SHA256: &str =
    "4ad21d977c2b776a31c92498c4d1c88d3e1e286deeb941e997af8e082310b80";
const MATTERGEN_CHECKPOINT_URL: &str = "https://huggingface.co/microsoft/mattergen/resolve/main/checkpoints/chemical_system/checkpoints/last.ckpt?download=true";
const MATTERGEN_CONFIG_SHA256: &str =
    "0640de891dc75e34c92c4da022344767918fe4a2300908b1013fe6161f3c2c81";
const MATTERGEN_CONFIG_URL: &str = "https://huggingface.co/microsoft/mattergen/resolve/main/checkpoints/chemical_system/config.yaml?download=true";

fn workspace_asset(app: &AppHandle, relative: &str) -> Option<PathBuf> {
    // Model assets are project-level runtime resources, not per-session
    // artifacts. Keep downloads beside materials/runtime.json in the selected
    // base workspace so every dated session reuses the same verified file.
    crate::runtime::base_workspace_dir(app)
        .ok()
        .map(|root| root.join(relative))
}

fn first_file(candidates: impl IntoIterator<Item = PathBuf>) -> Option<PathBuf> {
    candidates.into_iter().find(|path| path.is_file())
}

fn mattersim_checkpoint_probe(app: &AppHandle) -> ToolStatus {
    let resource = app
        .path()
        .resolve(
            "mattersim/models/mattersim-v1.0.0-5M.pth",
            tauri::path::BaseDirectory::Resource,
        )
        .ok();
    let source =
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../../runtime/mattersim/models");
    let path = first_file(
        [
            resource,
            workspace_asset(app, "runtime/mattersim/models/mattersim-v1.0.0-5M.pth"),
            workspace_asset(app, "runtime/mattersim/models/MatterSim-v1.0.0-5M.pth"),
            Some(source.join("mattersim-v1.0.0-5M.pth")),
            Some(source.join("MatterSim-v1.0.0-5M.pth")),
        ]
        .into_iter()
        .flatten(),
    );
    let mut status = ToolStatus::new(
        "MatterSim checkpoint",
        path.is_some(),
        path.as_ref().map(|p| {
            format!(
                "MatterSim-v1.0.0-5M · {} MiB",
                p.metadata().map(|m| m.len() / (1024 * 1024)).unwrap_or(0)
            )
        }),
        path.as_ref().is_some_and(|p| {
            p.starts_with(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../../runtime"))
        }),
    );
    status.downloadable = true;
    status
}

fn uma_weights_probe(app: &AppHandle) -> ToolStatus {
    let path = first_file(
        [
            workspace_asset(app, "runtime/uma/models/uma-s-1p2p1.pt"),
            app.path()
                .app_data_dir()
                .ok()
                .map(|root| root.join("runtime/materials-env/models/uma-s-1p2p1.pt")),
            app.path()
                .app_data_dir()
                .ok()
                .map(|root| root.join("runtime/uma/models/uma-s-1p2p1.pt")),
        ]
        .into_iter()
        .flatten(),
    );
    let mut status = ToolStatus::new(
        "UMA weights",
        path.is_some(),
        path.as_ref().map(|p| {
            format!(
                "uma-s-1p2p1 · {} MiB",
                p.metadata().map(|m| m.len() / (1024 * 1024)).unwrap_or(0)
            )
        }),
        false,
    );
    status.downloadable = true;
    status
}

fn sha256_file(path: &Path) -> Result<String, String> {
    let mut file = std::fs::File::open(path).map_err(|e| e.to_string())?;
    let mut digest = sha2::Sha256::new();
    let mut buffer = [0u8; 1024 * 1024];
    loop {
        let read = file.read(&mut buffer).map_err(|e| e.to_string())?;
        if read == 0 {
            break;
        }
        digest.update(&buffer[..read]);
    }
    Ok(format!("{:x}", digest.finalize()))
}

fn huggingface_token() -> Option<String> {
    for key in ["HF_TOKEN", "HUGGINGFACE_HUB_TOKEN"] {
        if let Ok(value) = std::env::var(key) {
            let value = value.trim().to_string();
            if !value.is_empty() {
                return Some(value);
            }
        }
    }
    let home = std::env::var_os("USERPROFILE")
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("HOME").map(PathBuf::from));
    home.and_then(|root| std::fs::read_to_string(root.join(".cache/huggingface/token")).ok())
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn download_verified_file(
    client: &reqwest::blocking::Client,
    url: &str,
    target: &Path,
    expected_sha: Option<&str>,
    label: &str,
    bearer_token: Option<&str>,
) -> Result<String, String> {
    if let Some(parent) = target.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    if target.is_file() {
        let verified = match expected_sha {
            None => true,
            Some(expected) => sha256_file(target)
                .map(|actual| actual == expected)
                .unwrap_or(false),
        };
        if verified {
            return Ok(target.to_string_lossy().to_string());
        }
        let _ = std::fs::remove_file(target);
    }
    let partial = target.with_file_name(format!(
        "{}.part",
        target
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("download")
    ));
    let mut request = client.get(url);
    if let Some(token) = bearer_token {
        request = request.bearer_auth(token);
    }
    let mut response = request
        .send()
        .map_err(|e| format!("{label} download failed: {e}"))?;
    if !response.status().is_success() {
        let status = response.status();
        return Err(format!("{label} download returned HTTP {status}"));
    }
    let mut file = std::fs::File::create(&partial).map_err(|e| e.to_string())?;
    let mut buffer = [0u8; 1024 * 1024];
    loop {
        let read = response
            .read(&mut buffer)
            .map_err(|e| format!("{label} download interrupted: {e}"))?;
        if read == 0 {
            break;
        }
        file.write_all(&buffer[..read]).map_err(|e| e.to_string())?;
    }
    file.sync_all().map_err(|e| e.to_string())?;
    if let Some(expected) = expected_sha {
        let actual = sha256_file(&partial)?;
        if actual != expected {
            let _ = std::fs::remove_file(&partial);
            return Err(format!(
                "{label} SHA-256 校验失败：expected {expected}, got {actual}"
            ));
        }
    }
    std::fs::rename(&partial, target).map_err(|e| e.to_string())?;
    Ok(target.to_string_lossy().to_string())
}

fn download_material_model_blocking(app: &AppHandle, asset: &str) -> Result<String, String> {
    let client = reqwest::blocking::Client::builder()
        .user_agent("NebulaMat material model downloader")
        .build()
        .map_err(|e| format!("model downloader initialization failed: {e}"))?;
    if asset == "mattergen" {
        let config = workspace_asset(app, "runtime/mattergen/models/chemical_system/config.yaml")
            .ok_or("active workspace is unavailable")?;
        let checkpoint = workspace_asset(
            app,
            "runtime/mattergen/models/chemical_system/checkpoints/last.ckpt",
        )
        .ok_or("active workspace is unavailable")?;
        download_verified_file(
            &client,
            MATTERGEN_CONFIG_URL,
            &config,
            Some(MATTERGEN_CONFIG_SHA256),
            "MatterGen chemical_system config",
            None,
        )?;
        return download_verified_file(
            &client,
            MATTERGEN_CHECKPOINT_URL,
            &checkpoint,
            Some(MATTERGEN_CHECKPOINT_SHA256),
            "MatterGen chemical_system checkpoint",
            None,
        );
    }

    let (url, relative, expected_sha, label, token) = match asset {
        "mattersim" => (
            MATTERSIM_CHECKPOINT_URL,
            "runtime/mattersim/models/mattersim-v1.0.0-5M.pth",
            Some(MATTERSIM_CHECKPOINT_SHA256),
            "MatterSim checkpoint",
            None,
        ),
        "uma" => (
            UMA_WEIGHT_URL,
            "runtime/uma/models/uma-s-1p2p1.pt",
            None,
            "UMA weights",
            huggingface_token(),
        ),
        other => return Err(format!("unknown material model asset: {other}")),
    };
    let target = workspace_asset(app, relative).ok_or("active workspace is unavailable")?;
    if asset == "uma" && target.is_file() && token.is_none() {
        // UMA is gated, but an existing file remains usable without requiring
        // a token merely to re-open the environment page.
        return Ok(target.to_string_lossy().to_string());
    }
    if asset == "uma" && token.is_none() && !target.is_file() {
        return Err("UMA 权重需要 Hugging Face facebook/UMA 访问许可和 HF_TOKEN；请先在当前用户环境登录 Hugging Face 后重试".into());
    }
    download_verified_file(&client, url, &target, expected_sha, label, token.as_deref())
}

/// Download a pinned MatterGen, MatterSim or gated UMA model into the active workspace.
/// The operation is explicit from the environment page and never overwrites a
/// verified file.
#[tauri::command(async)]
pub async fn download_material_model(app: AppHandle, asset: String) -> Result<String, String> {
    tokio::task::spawn_blocking(move || download_material_model_blocking(&app, &asset))
        .await
        .map_err(|e| format!("model download task failed: {e}"))?
}

/// Report availability of the tools relevant to a research workflow. `async`:
/// the serial process probes take seconds on Windows and ran on the UI thread
/// at startup — a big part of the "app is sluggish right after opening" bug.
/// The app-owned fallbacks only spawn when the host probe came up empty, so the
/// common case costs no extra process.
#[tauri::command(async)]
pub fn detect_tools(app: AppHandle) -> Vec<ToolStatus> {
    let python = {
        let p3 = probe("Python", "python3", "--version");
        if p3.found {
            p3
        } else {
            probe("Python", "python", "--version")
        }
    };
    let cuda = cuda_probe();
    let managed_mattergen_python = mattergen_python(&app);
    let pytorch = managed_python_module_probe(
        &app,
        "PyTorch",
        "import torch; print(f'{torch.__version__} · CUDA {torch.version.cuda or \"CPU\"}')",
        managed_mattergen_python.clone(),
    );
    let mattergen = managed_python_module_probe(
        &app,
        "MatterGen",
        "import importlib.metadata as m; print(m.version('mattergen'))",
        managed_mattergen_python,
    );
    let mattersim = managed_python_module_probe(
        &app,
        "MatterSim",
        "import importlib.metadata as m; print(m.version('mattersim'))",
        None,
    );
    let uma = managed_python_module_probe(
        &app,
        "UMA",
        "import importlib.metadata as m; print(m.version('fairchem-core'))",
        None,
    );
    vec![
        // The managed Jupyter env carries its own Python — the one the app's
        // notebook Run button already defaults to (kernel::python_bin).
        or_managed(python, crate::jupyter::env_python(&app), "--version"),
        probe("R", "Rscript", "--version"),
        probe("Node.js", "node", "--version"),
        // uv ships with the app (tauri externalBin) and is the uv every
        // provisioning flow actually runs — never report it missing.
        or_managed(
            probe("uv", "uv", "--version"),
            crate::runtime::sidecar_bin("uv"),
            "--version",
        ),
        // The managed env powers Open JupyterLab, the notebook kernel and the
        // agent's jupyter-mcp-server; it lives under app data, off any PATH.
        // `jupyter-lab` on both sides, not `jupyter`: it prints a bare version
        // ("4.4.1") where `jupyter --version` leads with "Selected Jupyter core
        // packages..." — and it is the exact binary jupyter_status() calls
        // installed, so the two views of the managed env cannot disagree.
        or_managed(
            jupyter_host_probe(),
            crate::jupyter::env_bin(&app, "jupyter-lab").ok(),
            "--version",
        ),
        probe("Git", "git", "--version"),
        cuda,
        pytorch,
        mattergen,
        bundled_mattergen_source_probe(&app),
        mattergen_checkpoint_probe(&app),
        mattersim,
        mattersim_checkpoint_probe(&app),
        uma,
        uma_weights_probe(&app),
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(unix)]
    fn script(dir: &Path, name: &str, body: &str) -> PathBuf {
        use std::os::unix::fs::PermissionsExt;
        std::fs::create_dir_all(dir).unwrap();
        let path = dir.join(name);
        std::fs::write(&path, format!("#!/bin/sh\n{body}\n")).unwrap();
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).unwrap();
        path
    }

    #[cfg(unix)]
    fn temp_dir(tag: &str) -> PathBuf {
        std::env::temp_dir().join(format!("os-tools-{tag}-{}", std::process::id()))
    }

    // A Finder-launched app has a minimal PATH, so probing with the plain
    // environment misreported the user's anaconda/homebrew tools as missing —
    // detection must search the SAME enriched PATH the kernel and agent use.
    #[cfg(unix)]
    #[test]
    fn probe_searches_the_given_path() {
        let dir = temp_dir("path");
        script(&dir, "mytool", "echo mytool 9.9");

        let found = probe_with_path("MyTool", "mytool", "--version", dir.to_str());
        assert!(found.found, "tool on the provided PATH must be found");
        assert_eq!(found.version.as_deref(), Some("mytool 9.9"));
        assert!(
            !found.managed,
            "a tool on the user's PATH is not app-managed"
        );

        let missing = probe_with_path("MyTool", "mytool", "--version", Some("/nonexistent-dir"));
        assert!(
            !missing.found,
            "tool off the provided PATH must not be found"
        );

        let _ = std::fs::remove_dir_all(&dir);
    }

    // The Windows Store `python.exe` alias prints an install hint and exits
    // non-zero — output alone must not count as "found".
    #[cfg(unix)]
    #[test]
    fn probe_rejects_a_tool_that_fails_version() {
        let dir = temp_dir("fake");
        script(&dir, "faketool", "echo 'not really installed' >&2\nexit 9");

        let status = probe_with_path("FakeTool", "faketool", "--version", dir.to_str());
        assert!(
            !status.found,
            "a tool that exits non-zero on --version must not be found"
        );

        let _ = std::fs::remove_dir_all(&dir);
    }

    // #68: the app-managed Jupyter (and the bundled uv) live off PATH, so the
    // host probe cannot see them and the page claimed "not found" for a Jupyter
    // the user was successfully running.
    #[cfg(unix)]
    #[test]
    fn falls_back_to_the_app_managed_binary() {
        let dir = temp_dir("managed");
        let bin = script(&dir, "jupyter", "echo jupyter 4.4.1");

        let host_missing =
            probe_with_path("Jupyter", "jupyter", "--version", Some("/nonexistent-dir"));
        let status = or_managed(host_missing, Some(bin), "--version");
        assert!(
            status.found,
            "an app-managed binary must be reported as found"
        );
        assert!(
            status.managed,
            "it must be labelled app-managed, not the user's own"
        );
        assert_eq!(status.version.as_deref(), Some("jupyter 4.4.1"));

        let _ = std::fs::remove_dir_all(&dir);
    }

    // A binary that exists but cannot report a version is still installed:
    // jupyter_status().installed goes by existence alone, and the two views of
    // the same env must not contradict each other.
    #[cfg(unix)]
    #[test]
    fn managed_binary_without_a_version_is_still_found() {
        let dir = temp_dir("managed-noversion");
        let bin = script(&dir, "jupyter", "exit 1");

        let status = probe_managed("Jupyter", &bin, "--version").expect("exists ⇒ found");
        assert!(status.found && status.managed);
        assert_eq!(status.version, None);

        let _ = std::fs::remove_dir_all(&dir);
    }

    // The user's own install wins: it is what OpenCode's shell tool runs, so
    // relabelling it "app-managed" would misreport the environment.
    #[cfg(unix)]
    #[test]
    fn a_host_hit_wins_over_the_app_managed_copy() {
        let dir = temp_dir("host-wins");
        script(&dir, "uv", "echo uv 0.9.0");
        let managed = script(&temp_dir("host-wins-managed"), "uv", "echo uv 0.1.0");

        let host = probe_with_path("uv", "uv", "--version", dir.to_str());
        let status = or_managed(host, Some(managed.clone()), "--version");
        assert!(status.found && !status.managed);
        assert_eq!(status.version.as_deref(), Some("uv 0.9.0"));

        let _ = std::fs::remove_dir_all(&dir);
        let _ = std::fs::remove_dir_all(managed.parent().unwrap());
    }

    // No host tool and no app copy stays an honest "not found".
    #[cfg(unix)]
    #[test]
    fn nothing_installed_stays_not_found() {
        let host = probe_with_path("R", "Rscript", "--version", Some("/nonexistent-dir"));
        let status = or_managed(
            host,
            Some(PathBuf::from("/nonexistent-dir/Rscript")),
            "--version",
        );
        assert!(!status.found && !status.managed && status.version.is_none());
    }
}
