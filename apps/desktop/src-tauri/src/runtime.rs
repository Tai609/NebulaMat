// Manages DeepSeek Harness so it never interferes with any user runtime: it
// runs the real dsh CLI on a dedicated free port with an app-private home and
// is killed on app exit.
use std::hash::{Hash, Hasher};
use std::net::TcpListener;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};
#[cfg(windows)]
use tauri::path::BaseDirectory;
use tauri::{AppHandle, Manager, State};
use tauri_plugin_shell::process::CommandChild;
use tauri_plugin_shell::ShellExt;

#[derive(Default)]
struct RuntimeLifecycle {
    child: Option<CommandChild>,
    url: Option<String>,
    port: Option<u16>,
}

/// One lock owns every sidecar lifecycle field. Keeping child/url/port in
/// separate mutexes allowed two concurrent `start_runtime` calls to both see
/// "stopped", spawn on the same port, and overwrite each other's child handle.
#[derive(Default)]
pub struct RuntimeState {
    lifecycle: Mutex<RuntimeLifecycle>,
}

/// App-private runtime root, e.g. ~/Library/Application Support/com.ai4s.workbench/runtime
pub(crate) fn runtime_root(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("runtime"))
}

/// The running sidecar's base URL (`http://127.0.0.1:<port>`), or None when the
/// runtime is not started yet. The gateway proxies authenticated remote calls
/// here without forwarding its external credential.
pub(crate) fn sidecar_url(state: &RuntimeState) -> Option<String> {
    state.lifecycle.lock().unwrap().url.clone()
}

/// File recording the user's chosen active workspace folder (absolute path).
fn active_workspace_file(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(runtime_root(app)?.join("active-workspace.txt"))
}

/// File recording the user's chosen BASE folder — it contains the managed
/// `projects/` and `sessions/` collections (Settings → Workspace).
fn base_workspace_file(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(runtime_root(app)?.join("base-workspace.txt"))
}

pub(crate) const PROJECTS_DIR_NAME: &str = "projects";
pub(crate) const SESSIONS_DIR_NAME: &str = "sessions";

/// Keep the user-visible workspace root predictable:
///
/// ```text
/// OpenScience/
///   projects/
///   sessions/
///   .openscience/
/// ```
///
/// Existing root-level workspaces are left where they are and remain readable.
/// Moving them would invalidate absolute session directories stored by DSH.
fn ensure_base_layout(dir: PathBuf) -> Result<PathBuf, String> {
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    for child in [PROJECTS_DIR_NAME, SESSIONS_DIR_NAME] {
        std::fs::create_dir_all(dir.join(child)).map_err(|e| e.to_string())?;
    }
    Ok(dir)
}

pub(crate) fn projects_dir(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(base_workspace_dir(app)?.join(PROJECTS_DIR_NAME))
}

pub(crate) fn sessions_dir(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(base_workspace_dir(app)?.join(SESSIONS_DIR_NAME))
}

/// A workspace path read back from disk. Installs predating #76 wrote the Windows
/// `\\?\` verbatim form here, which then flowed to the UI and could never match a
/// session's `directory`; unwrapping on read repairs them without a re-pick. The
/// transform is Windows-only — elsewhere `\` is a legal filename character.
fn persisted_path(raw: &str) -> String {
    #[cfg(target_os = "windows")]
    return crate::artifact_file::strip_windows_verbatim(raw);
    #[cfg(not(target_os = "windows"))]
    return raw.to_owned();
}

/// The active workspace folder DSH / the kernel / previews / provenance all
/// operate in. Defaults to the base folder (`~/Documents/OpenScience`) until the
/// user opens or creates another one; the choice persists across restarts.
pub fn workspace_dir(app: &AppHandle) -> Result<PathBuf, String> {
    if let Ok(f) = active_workspace_file(app) {
        if let Ok(s) = std::fs::read_to_string(&f) {
            // Installs from before #76 persisted the Windows `\\?\` verbatim path;
            // unwrap it on read so those users are repaired without a re-pick.
            let dir = PathBuf::from(persisted_path(s.trim()));
            if dir.is_dir() {
                return ensure_base_layout(dir);
            }
        }
    }
    base_workspace_dir(app)
}

/// The workspace root containing the `projects/` and `sessions/` collections.
/// A folder the user picked in Settings wins; the default is `~/Documents/OpenScience`
/// (no space — the agent runs shell commands against this path, and unquoted
/// spaces break them), falling back to `$HOME/Documents`.
pub fn base_workspace_dir(app: &AppHandle) -> Result<PathBuf, String> {
    if let Ok(f) = base_workspace_file(app) {
        if let Ok(s) = std::fs::read_to_string(&f) {
            let dir = PathBuf::from(persisted_path(s.trim()));
            if dir.is_dir() {
                return Ok(dir);
            }
        }
    }
    let docs = match app.path().document_dir() {
        Ok(d) => d,
        Err(_) => {
            let home = std::env::var("HOME")
                .or_else(|_| std::env::var("USERPROFILE"))
                .map_err(|_| "could not resolve a documents directory".to_string())?;
            PathBuf::from(home).join("Documents")
        }
    };
    let dir = docs.join("OpenScience");

    // One-time migrations, oldest name last. A failed rename (e.g. cross-volume)
    // keeps the existing location rather than splitting the user's files.
    if !dir.exists() {
        for old in [
            docs.join("Open Science"),
            runtime_root(app)?.join("workspace"),
        ] {
            if old.is_dir() {
                if std::fs::rename(&old, &dir).is_ok() {
                    break;
                }
                return ensure_base_layout(old);
            }
        }
    }
    ensure_base_layout(dir)
}

/// DSH credential state is addressed by credential references, not provider auth files.
#[tauri::command(async)]
pub fn provider_auth_exists(app: AppHandle, provider_id: String) -> Result<bool, String> {
    let _ = (app, provider_id);
    Err("DSH credential state is addressed by credential reference; provider auth probes are unsupported".into())
}

/// Deploy the bundled skill packs (Tauri resources) into the app-private DSH
/// global skills dir (`<DSH_HOME>/skills/`), which DSH scans regardless of
/// project detection. The `skills/` resource is one audited manifest carrying
/// all 180 built-in skills (ARIS, Nature, and the remaining materials,
/// office, plotting, Git, audit, and workflow skills). The
/// workspace's own `.dsh/skills/` stays reserved for skills the user
/// installs. Runs before every sidecar start so app upgrades refresh the packs.
fn deploy_bundled_skills(app: &AppHandle, dsh_home: &Path) {
    let dst = dsh_home.join("skills");
    let source = app
        .path()
        .resolve("skills", tauri::path::BaseDirectory::Resource)
        .ok()
        .filter(|path| path.is_dir())
        .unwrap_or_else(|| {
            PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../../runtime/skills-bundle")
        });
    let manifest = std::fs::read_to_string(source.join("manifest.json")).ok();
    let expected = manifest.as_deref().and_then(|text| {
        serde_json::from_str::<serde_json::Value>(text)
            .ok()
            .and_then(|value| value.get("skillCount").and_then(serde_json::Value::as_u64))
    });
    let deployment_marker = manifest
        .as_deref()
        .map(|text| skill_pack_marker(text, dsh_home));
    // The resource is immutable inside an installed app. Once the marker and
    // the managed directory set agree with the shipped manifest, reuse the
    // existing copy instead of walking and replacing ~130 MB on every launch.
    if let Some(marker) = deployment_marker.as_deref() {
        if expected == Some(180) && skill_pack_ready(&source, &dst, marker, 180) {
            return;
        }
    }
    let names = match sync_skill_pack(&source, &dst) {
        Ok(names) => names,
        Err(error) => {
            eprintln!("failed to deploy bundled skills: {error}");
            return;
        }
    };
    if expected != Some(180) || !skill_pack_inventory_ready(&source, &dst, 180) {
        eprintln!(
            "bundled skill manifest mismatch: expected {expected:?}, deployed managed {}",
            names.len()
        );
        return;
    }
    let bundled: std::collections::HashSet<std::ffi::OsString> = names.into_iter().collect();
    // The global skills dir is exclusively app-managed (the user's own skills
    // live in the workspace's `.dsh/skills/`), so any skill dir not in the
    // freshly-bundled set is a stale leftover — e.g. one renamed across an app
    // upgrade (`hpc-slurm` → `remote-compute`) — and must be removed so the
    // obsolete duplicate can't shadow or confuse the agent. Prune ONLY when all
    // resource deployed cleanly: a partial deploy would make `bundled`
    // incomplete and wrongly delete valid skills.
    prune_stale_skills(&dst, &bundled);
    if let Some(marker) = deployment_marker {
        if let Err(error) = std::fs::write(dst.join(SKILL_PACK_MARKER), marker) {
            eprintln!("failed to write bundled skill marker: {error}");
        }
        if let Err(error) = rewrite_aicc_tokens(&dst, &dsh_home.join("aicc")) {
            eprintln!("failed to resolve bundled AICC skill paths: {error}");
        }
    }
}

fn aris_resource_root(app: &AppHandle) -> Option<PathBuf> {
    app.path()
        .resolve("aris", tauri::path::BaseDirectory::Resource)
        .ok()
        .filter(|path| path.join("manifest.json").is_file())
        .or_else(|| {
            let path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../../runtime/aris");
            path.join("manifest.json").is_file().then_some(path)
        })
}

/// Deploy the app-owned DSH tool governance plugin into the private DSH home.
/// The plugin is loaded by the server's `tools/pre-execute` waterfall, so the
/// adapter can observe the same decision without being the authority that
/// decides whether a tool is allowed to run.
fn deploy_dsh_tool_governance(app: &AppHandle, dsh_home: &Path) -> Result<(), String> {
    let bundled = app
        .path()
        .resolve(
            "harness/tool-governance",
            tauri::path::BaseDirectory::Resource,
        )
        .ok()
        .filter(|path| path.is_dir());
    let source = bundled.unwrap_or_else(|| {
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../../runtime/harness/tool-governance")
    });
    if !source.join("package.json").is_file() || !source.join("index.js").is_file() {
        return Err(format!(
            "DSH tool governance plugin is missing from {}",
            source.display()
        ));
    }

    // Relative Cordis plugin entries are resolved from the active profile's
    // baseUrl (`<DSH_HOME>/profiles/web`), not from DSH_HOME itself.
    let profile_dir = dsh_home.join("profiles").join("web");
    std::fs::create_dir_all(&profile_dir).map_err(|error| error.to_string())?;
    let destination = profile_dir.join("nebulamat-tool-governance");
    sync_managed_support_dir(&source, &destination).map_err(|error| error.to_string())
}

/// Install the bundled cost-meter host package in the active DSH profile.
/// Keeping the original host service preserves provider-reported token usage,
/// time-of-call pricing, and its durable ledger while the desktop owns the UI.
fn deploy_dsh_cost_meter(app: &AppHandle, dsh_home: &Path) -> Result<(), String> {
    let bundled = app
        .path()
        .resolve(
            "harness/dsh-cost-meter",
            tauri::path::BaseDirectory::Resource,
        )
        .ok()
        .filter(|path| path.is_dir());
    let source = bundled.unwrap_or_else(|| {
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../../runtime/harness/dsh-cost-meter")
    });
    for required in [
        "package.json",
        "lib/index.js",
        "lib/typert.host.js",
        "lib/zod.js",
    ] {
        if !source.join(required).is_file() {
            return Err(format!(
                "DSH cost meter is missing {required} from {}",
                source.display()
            ));
        }
    }

    let modules = dsh_home.join("profiles").join("web").join("node_modules");
    std::fs::create_dir_all(&modules).map_err(|error| error.to_string())?;
    let destination = modules.join("dsh-cost-meter");
    sync_managed_support_dir(&source, &destination).map_err(|error| error.to_string())
}

/// Deploy the bundled GenUI server/client package into the app-private DSH
/// profile. NebulaMat owns this package: even a valid development `link:` is
/// replaced so the installed app never depends on a checkout outside its own
/// resources.
fn deploy_dsh_genui(app: &AppHandle, dsh_home: &Path) -> Result<(), String> {
    const PACKAGE: &str = "@omdsh-dev/dsh-genui";
    let bundled = app
        .path()
        .resolve("harness/dsh-genui", tauri::path::BaseDirectory::Resource)
        .ok()
        .filter(|path| path.is_dir());
    let source = bundled.unwrap_or_else(|| {
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../../runtime/harness/dsh-genui")
    });
    for required in [
        "package.json",
        "lib/index.js",
        "lib/client.js",
        "cordis.patch.yml",
        "SKILL.md",
    ] {
        if !source.join(required).is_file() {
            return Err(format!(
                "DSH GenUI bundle is missing {required} from {}",
                source.display()
            ));
        }
    }

    let destination = profile_package_dir(&dsh_home.join("profiles").join("web"), PACKAGE);
    let parent = destination
        .parent()
        .ok_or("DSH GenUI package has no parent directory")?;
    std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    sync_managed_support_dir(&source, &destination).map_err(|error| error.to_string())?;

    let skill_dir = dsh_home.join("skills").join("genui");
    std::fs::create_dir_all(&skill_dir).map_err(|error| error.to_string())?;
    if !skill_dir.join("SKILL.md").is_file() {
        std::fs::copy(source.join("SKILL.md"), skill_dir.join("SKILL.md"))
            .map_err(|error| error.to_string())?;
    }
    Ok(())
}

/// Deploy VASPFlow's MIT-licensed host data service. Its upstream browser
/// client targets DSH's web shell; NebulaMat reuses the task/scene contract in
/// its native React UI instead, so only the host files are installed here.
fn deploy_dsh_vaspflow(app: &AppHandle, dsh_home: &Path) -> Result<(), String> {
    let bundled = app
        .path()
        .resolve("harness/dsh-vaspflow", tauri::path::BaseDirectory::Resource)
        .ok()
        .filter(|path| path.is_dir());
    let source = bundled.unwrap_or_else(|| {
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../../runtime/harness/dsh-vaspflow")
    });
    for required in [
        "package.json",
        "lib/index.js",
        "lib/host/scanner.js",
        "lib/host/parser.js",
        "lib/host/structure.js",
        "lib/host/task-files.js",
        "lib/host/task-store.js",
        "cordis.patch.yml",
        "LICENSE",
    ] {
        if !source.join(required).is_file() {
            return Err(format!(
                "DSH VASPFlow bundle is missing {required} from {}",
                source.display()
            ));
        }
    }
    let profile = dsh_home.join("profiles").join("web");
    let destination = profile_package_dir(&profile, BUNDLED_VASPFLOW_PACKAGE);
    std::fs::create_dir_all(
        destination
            .parent()
            .ok_or("DSH VASPFlow package has no parent directory")?,
    )
    .map_err(|error| error.to_string())?;
    sync_managed_support_dir(&source, &destination).map_err(|error| error.to_string())
}

pub(crate) fn dsh_home(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(runtime_root(app)?.join("dsh-home"))
}

/// A small, secret-free record of the user's last confirmed default model. DSH
/// owns the complete settings document, but `session.selectModel` can report a
/// successful session switch even when its settings write fails. Keeping this
/// selection separately lets startup repair a missing, partially written, or
/// stale default section instead of silently reverting after a relaunch.
const DEFAULT_MODEL_FILE: &str = "default-model.json";

#[derive(Clone, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
struct PersistedModelSelection {
    provider: String,
    model: String,
}

fn parse_model_selection(value: &str) -> Option<PersistedModelSelection> {
    let (provider, model) = value.trim().split_once('/')?;
    let provider = provider.trim();
    let model = model.trim();
    if provider.is_empty() || model.is_empty() {
        return None;
    }
    Some(PersistedModelSelection {
        provider: provider.to_owned(),
        model: model.to_owned(),
    })
}

fn default_model_file(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(runtime_root(app)?.join(DEFAULT_MODEL_FILE))
}

fn atomic_replace_file(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let tmp = path.with_extension(format!("tmp.{}", std::process::id()));
    std::fs::write(&tmp, bytes).map_err(|error| error.to_string())?;
    match std::fs::rename(&tmp, path) {
        Ok(()) => Ok(()),
        Err(first_error) => {
            #[cfg(windows)]
            if path.is_file() {
                std::fs::remove_file(path).map_err(|error| error.to_string())?;
                return std::fs::rename(&tmp, path).map_err(|error| error.to_string());
            }
            let _ = std::fs::remove_file(&tmp);
            Err(first_error.to_string())
        }
    }
}

fn read_persisted_model(path: &Path) -> Option<PersistedModelSelection> {
    let text = std::fs::read_to_string(path).ok()?;
    let selection = serde_json::from_str::<PersistedModelSelection>(&text).ok()?;
    (!selection.provider.is_empty() && !selection.model.is_empty()).then_some(selection)
}

fn default_model_from_settings(text: &str) -> Option<PersistedModelSelection> {
    let root = serde_yaml::from_str::<serde_yaml::Value>(text).ok()?;
    let section = root.get(serde_yaml::Value::String("agent-default-model".into()))?;
    let provider = section
        .get(serde_yaml::Value::String("provider".into()))
        .and_then(serde_yaml::Value::as_str)?
        .trim();
    let model = section
        .get(serde_yaml::Value::String("model".into()))
        .and_then(serde_yaml::Value::as_str)?
        .trim();
    (!provider.is_empty() && !model.is_empty()).then(|| PersistedModelSelection {
        provider: provider.to_owned(),
        model: model.to_owned(),
    })
}

/// Apply the desktop's last confirmed selection when DSH's own default section
/// is absent, incomplete, or stale. An equal section is left untouched,
/// including its optional reasoning effort.
fn restore_default_model_settings(
    text: &str,
    fallback: Option<&PersistedModelSelection>,
) -> Result<Option<String>, String> {
    if fallback.is_none() || default_model_from_settings(text).as_ref() == fallback {
        return Ok(None);
    }
    let mut root = if text.trim().is_empty() {
        serde_yaml::Value::Mapping(serde_yaml::Mapping::new())
    } else {
        serde_yaml::from_str::<serde_yaml::Value>(text)
            .map_err(|error| format!("invalid DSH settings: {error}"))?
    };
    let root_map = root
        .as_mapping_mut()
        .ok_or_else(|| "DSH settings root must be a YAML map".to_owned())?;
    let selection = fallback.expect("fallback checked above");
    let mut section = serde_yaml::Mapping::new();
    section.insert(
        serde_yaml::Value::String("provider".into()),
        serde_yaml::Value::String(selection.provider.clone()),
    );
    section.insert(
        serde_yaml::Value::String("model".into()),
        serde_yaml::Value::String(selection.model.clone()),
    );
    root_map.insert(
        serde_yaml::Value::String("agent-default-model".into()),
        serde_yaml::Value::Mapping(section),
    );
    serde_yaml::to_string(&root)
        .map(Some)
        .map_err(|error| error.to_string())
}

fn prepare_default_model_selection(app: &AppHandle, dsh_home: &Path) -> Result<(), String> {
    let fallback_path = default_model_file(app)?;
    let fallback = read_persisted_model(&fallback_path);
    let settings_path = dsh_home.join("settings.yaml");
    let settings_text = match std::fs::read_to_string(&settings_path) {
        Ok(text) => text,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => String::new(),
        Err(error) => {
            return Err(format!(
                "could not read {}: {error}",
                settings_path.display()
            ))
        }
    };
    let current = default_model_from_settings(&settings_text);
    if fallback.is_none() {
        let Some(current) = current else {
            return Ok(());
        };
        if let Some(parent) = fallback_path.parent() {
            std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        }
        let bytes = serde_json::to_vec_pretty(&current).map_err(|error| error.to_string())?;
        atomic_replace_file(&fallback_path, &bytes)?;
        return Ok(());
    }
    let fallback = fallback.as_ref().expect("fallback checked above");
    let restored = match restore_default_model_settings(&settings_text, Some(fallback)) {
        Ok(Some(text)) => text,
        Ok(None) => return Ok(()),
        Err(error) => {
            // Keep a recoverable copy of a malformed settings document. The
            // DSH file provider cannot boot from invalid YAML, but silently
            // deleting a user's document would be worse than repairing it.
            if !settings_text.trim().is_empty() {
                let backup = settings_path.with_extension(format!(
                    "yaml.corrupt-{}",
                    SystemTime::now()
                        .duration_since(UNIX_EPOCH)
                        .map(|duration| duration.as_secs())
                        .unwrap_or_default()
                ));
                std::fs::rename(&settings_path, &backup).map_err(|backup_error| {
                    format!(
                        "invalid DSH settings ({error}); could not preserve {}: {backup_error}",
                        settings_path.display()
                    )
                })?;
                crate::debug_log::append(
                    app,
                    &format!(
                        "[runtime] preserved malformed settings at {}",
                        backup.display()
                    ),
                );
            }
            restore_default_model_settings("", Some(fallback))?
                .ok_or_else(|| "default model recovery produced no settings".to_owned())?
        }
    };
    if let Some(parent) = settings_path.parent() {
        std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    atomic_replace_file(&settings_path, restored.as_bytes())?;
    crate::debug_log::append(
        app,
        &format!(
            "[runtime] restored confirmed default model {}/{} into {}",
            fallback.provider,
            fallback.model,
            settings_path.display()
        ),
    );
    Ok(())
}

/// Remember a model without ever accepting or serializing provider secrets.
#[tauri::command]
pub fn remember_default_model(app: AppHandle, model: String) -> Result<(), String> {
    let selection =
        parse_model_selection(&model).ok_or_else(|| format!("invalid model selection: {model}"))?;
    let path = default_model_file(&app)?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let bytes = serde_json::to_vec_pretty(&selection).map_err(|error| error.to_string())?;
    atomic_replace_file(&path, &bytes)
}

/// Seed a small, app-owned environment fact sheet for conversations that are
/// not rooted in the materials repository. Never overwrite an existing global
/// AGENTS.md: users may have deliberately customized their global instructions.
fn ensure_global_scientific_memory(dsh_home: &Path) {
    let path = dsh_home.join("AGENTS.md");
    if path.exists() {
        return;
    }
    const MEMORY: &str = r#"# NebulaMat scientific environment facts

On Windows, a missing or empty native MatterGen venv does not prove that the
machine lacks the scientific environment. When a workspace contains
`materials/runtime.json`, use its configured `tools.mattergen.runtime.wsl_python`
and checkpoint metadata for read-only preflight. Never assume another user's
Windows profile, WSL distribution, home directory, or a fixed `/root/...` path.
Report native, WSL2, and remote runtimes separately; do not describe an empty
native venv as proof that PyTorch, MatterGen, or a model checkpoint is absent.
"#;
    if let Err(error) = std::fs::write(&path, MEMORY) {
        eprintln!("failed to seed global scientific memory: {error}");
    }
}

/// AICC skills that extend NebulaMat's calculation layer. AICC's orchestration,
/// HPC, and persistent-shell skills are deliberately not deployed: NebulaMat's
/// materials coordinator, remote-compute skill, Runs, and provenance remain the
/// authoritative control plane.
#[allow(dead_code)]
const AICC_TOOL_SKILLS: &[&str] = &[
    "catmap",
    "cp2k",
    "deepmd",
    "gaussian",
    "gromacs",
    "lammps",
    "lobster",
    "mlp",
    "multiwfn",
    "ovito",
    "phonopy",
    "report",
    "structure-prep",
    "vasp",
    "vaspkit",
];
#[allow(dead_code)]
const AICC_COMMIT: &str = "c416a8ae8999aaba5faf0230ec052cd54a5ca0bb";
#[allow(dead_code)]
const AICC_DEPLOY_SCHEMA: u32 = 1;

#[allow(dead_code)]
fn deploy_aicc_tool_skills(
    app: &AppHandle,
    skills_dst: &Path,
) -> Result<Vec<std::ffi::OsString>, String> {
    let resource = app
        .path()
        .resolve("aicc", tauri::path::BaseDirectory::Resource)
        .ok()
        .filter(|path| path.is_dir())
        .or_else(|| {
            let path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../../runtime/aicc");
            path.is_dir().then_some(path)
        })
        .ok_or("AICC app resource is missing; rebuild the bundled materials resources")?;
    let collection = skills_dst
        .parent()
        .ok_or("DSH skills directory has no parent")?
        .join("aicc");
    prepare_aicc_collection(&resource, &collection).map_err(|e| e.to_string())?;
    let source_commit = std::fs::read_to_string(collection.join(".commit"))
        .unwrap_or_else(|_| AICC_COMMIT.to_string());
    let selected_marker = collection.join(".nebulamat-skills-ready");
    let expected_marker = format!(
        "{}:{}:{}\n",
        source_commit.trim(),
        AICC_DEPLOY_SCHEMA,
        collection.to_string_lossy().replace('\\', "/")
    );
    let selected_ready = std::fs::read_to_string(&selected_marker).ok().as_deref()
        == Some(expected_marker.as_str())
        && AICC_TOOL_SKILLS.iter().all(|name| {
            let path = skills_dst.join(name);
            path.join("SKILL.md").is_file()
        });
    if selected_ready {
        return Ok(AICC_TOOL_SKILLS
            .iter()
            .map(|name| std::ffi::OsString::from(*name))
            .collect());
    }
    let deployed =
        sync_selected_skill_pack(&collection.join("tools"), skills_dst, AICC_TOOL_SKILLS)
            .map_err(|e| e.to_string())?;
    std::fs::write(selected_marker, expected_marker).map_err(|e| e.to_string())?;
    Ok(deployed)
}

/// Replace the source-only AICC token in bundled skill prose with the actual
/// app-private collection path. This keeps installed resources portable while
/// retaining usable links into the shipped materials knowledge base.
fn rewrite_aicc_tokens(root: &Path, aicc_root: &Path) -> std::io::Result<()> {
    fn visit(dir: &Path, aicc_root: &str) -> std::io::Result<()> {
        for entry in std::fs::read_dir(dir)? {
            let entry = entry?;
            let path = entry.path();
            if entry.file_type()?.is_dir() {
                visit(&path, aicc_root)?;
                continue;
            }
            if path.extension().and_then(|value| value.to_str()) != Some("md") {
                continue;
            }
            let original = std::fs::read_to_string(&path)?;
            let rewritten = original.replace("__NEBULAMAT_AICC_ROOT__", aicc_root);
            if rewritten != original {
                std::fs::write(path, rewritten)?;
            }
        }
        Ok(())
    }

    let aicc_text = aicc_root.to_string_lossy().replace('\\', "/");
    visit(root, &aicc_text)
}

#[allow(dead_code)]
fn prepare_aicc_collection(src: &Path, dst: &Path) -> std::io::Result<()> {
    let source_commit =
        std::fs::read_to_string(src.join(".commit")).unwrap_or_else(|_| AICC_COMMIT.to_string());
    let expected_marker = format!("{}:{}\n", source_commit.trim(), AICC_DEPLOY_SCHEMA);
    let ready_marker = dst.join(".nebulamat-ready");
    let path_marker = dst.join(".nebulamat-path");
    let expected_path = format!("{}\n", dst.to_string_lossy().replace('\\', "/"));
    let ready = dst.join("tools").is_dir()
        && dst.join("knowledge").is_dir()
        && std::fs::read_to_string(&ready_marker).ok().as_deref() == Some(expected_marker.as_str())
        && std::fs::read_to_string(&path_marker).ok().as_deref() == Some(expected_path.as_str());
    if ready {
        return Ok(());
    }

    let staging = dst.with_file_name(format!(".aicc-staging-{}", std::process::id()));
    if staging.exists() {
        std::fs::remove_dir_all(&staging)?;
    }
    copy_dir(src, &staging)?;
    if dst.exists() {
        std::fs::remove_dir_all(dst)?;
    }
    std::fs::rename(&staging, dst)?;
    rewrite_aicc_references(dst)?;
    rewrite_aicc_tokens(dst, dst)?;
    std::fs::write(ready_marker, expected_marker)?;
    std::fs::write(path_marker, expected_path)?;
    Ok(())
}

/// AICC references are repository-root relative. Once the collection is an app
/// resource, rewrite them to its app-private absolute path so every DSH
/// workspace resolves the same knowledge, procedure, and tool documents.
#[allow(dead_code)]
fn rewrite_aicc_references(root: &Path) -> std::io::Result<()> {
    fn replace_root_relative(text: &str, directory: &str, root_text: &str) -> String {
        let needle = format!("{directory}/");
        let replacement = format!("{root_text}/{needle}");
        let mut output = String::with_capacity(text.len());
        let mut cursor = 0;
        while let Some(relative) = text[cursor..].find(&needle) {
            let start = cursor + relative;
            let previous = text[..start].chars().next_back();
            let is_root_relative = previous.map_or(true, |value| {
                !value.is_ascii_alphanumeric() && !matches!(value, '/' | '.' | '-' | '_' | ':')
            });
            output.push_str(&text[cursor..start]);
            if is_root_relative {
                output.push_str(&replacement);
            } else {
                output.push_str(&needle);
            }
            cursor = start + needle.len();
        }
        output.push_str(&text[cursor..]);
        output
    }

    fn visit(dir: &Path, root_text: &str) -> std::io::Result<()> {
        for entry in std::fs::read_dir(dir)? {
            let entry = entry?;
            let path = entry.path();
            if entry.file_type()?.is_dir() {
                visit(&path, root_text)?;
                continue;
            }
            if path.extension().and_then(|value| value.to_str()) != Some("md") {
                continue;
            }
            let original = std::fs::read_to_string(&path)?;
            let mut rewritten = original.clone();
            for directory in ["knowledge", "procedures", "tools"] {
                rewritten = replace_root_relative(&rewritten, directory, root_text);
            }
            rewritten = rewritten.replace("`AGENTS.md`", &format!("`{root_text}/AGENTS.md`"));
            rewritten = rewritten.replace("`STRUCTURE.md`", &format!("`{root_text}/STRUCTURE.md`"));
            if rewritten != original {
                std::fs::write(path, rewritten)?;
            }
        }
        Ok(())
    }

    let root_text = root.to_string_lossy().replace('\\', "/");
    visit(root, &root_text)
}

/// Remove stale app-managed skill directories while preserving user-owned DSH
/// skills and unrelated files.
fn prune_stale_skills(dst: &Path, bundled: &std::collections::HashSet<std::ffi::OsString>) {
    let Ok(entries) = std::fs::read_dir(dst) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir()
            && path.join("SKILL.md").is_file()
            && path.join(MANAGED_SKILL_MARKER).is_file()
            && !bundled.contains(&entry.file_name())
        {
            let _ = std::fs::remove_dir_all(&path);
        }
    }
}

const MANAGED_SKILL_MARKER: &str = ".nebulamat-managed";
const SKILL_PACK_MARKER: &str = ".nebulamat-skill-pack";

fn bundled_skill_names(src: &Path) -> std::collections::HashSet<std::ffi::OsString> {
    std::fs::read_dir(src)
        .ok()
        .into_iter()
        .flatten()
        .filter_map(Result::ok)
        .filter_map(|entry| {
            let path = entry.path();
            (entry.file_type().ok()?.is_dir() && path.join("SKILL.md").is_file())
                .then_some(entry.file_name())
        })
        .collect()
}

/// Every bundled skill must have a usable destination. A real user skill with
/// the same name is accepted as a deliberate shadow and is never overwritten.
fn skill_pack_inventory_ready(src: &Path, dst: &Path, expected: usize) -> bool {
    let source_names = bundled_skill_names(src);
    source_names.len() == expected
        && source_names.iter().all(|name| {
            let path = dst.join(name);
            path.join("SKILL.md").is_file()
        })
}

fn skill_pack_marker(manifest: &str, dsh_home: &Path) -> String {
    format!(
        "{manifest}\ninstallRoot={}\n",
        dsh_home.to_string_lossy().replace('\\', "/")
    )
}

/// Check the cheap on-disk deployment marker before touching any skill bytes.
/// The source and destination name sets are compared so a deleted or stale
/// managed directory cannot be mistaken for a complete install.
fn skill_pack_ready(src: &Path, dst: &Path, marker: &str, expected: usize) -> bool {
    if std::fs::read_to_string(dst.join(SKILL_PACK_MARKER))
        .ok()
        .as_deref()
        != Some(marker)
    {
        return false;
    }
    skill_pack_inventory_ready(src, dst, expected)
}

/// Copy every skill directory under `src` into `dst`, replacing same-named
/// directories (so bundled updates win) and leaving everything else in `dst`
/// alone. Returns the names of the skill directories it deployed (for stale
/// pruning). Directories without a SKILL.md (placeholders) are skipped.
fn sync_skill_pack(src: &Path, dst: &Path) -> std::io::Result<Vec<std::ffi::OsString>> {
    std::fs::create_dir_all(dst)?;
    let mut deployed = Vec::new();
    for entry in std::fs::read_dir(src)? {
        let entry = entry?;
        if !entry.file_type()?.is_dir() || !entry.path().join("SKILL.md").is_file() {
            continue;
        }
        // `user/` belongs to the installed skills — a pack may never claim it.
        let target = dst.join(entry.file_name());
        if target.exists() {
            if !target.join(MANAGED_SKILL_MARKER).is_file() {
                eprintln!(
                    "keeping user-owned DSH skill that shadows bundled skill {}",
                    entry.file_name().to_string_lossy()
                );
                continue;
            }
            std::fs::remove_dir_all(&target)?;
        }
        copy_dir(&entry.path(), &target)?;
        std::fs::write(target.join(MANAGED_SKILL_MARKER), b"NebulaMat\n")?;
        deployed.push(entry.file_name());
    }
    Ok(deployed)
}

/// Refresh a non-skill support directory owned by a bundled pack. A real
/// user-created directory is never replaced; the marker is what grants the app
/// permission to update or remove its previous copy.
#[allow(dead_code)]
fn sync_managed_support_dir(src: &Path, dst: &Path) -> std::io::Result<()> {
    if !src.is_dir() {
        return Err(std::io::Error::new(
            std::io::ErrorKind::NotFound,
            format!("support directory is missing: {}", src.display()),
        ));
    }
    let fingerprint = support_dir_fingerprint(src)?;
    if dst.symlink_metadata().is_ok() {
        if dst.join(MANAGED_SKILL_MARKER).is_file() {
            if dst.is_dir()
                && std::fs::read_to_string(dst.join(MANAGED_SKILL_MARKER))
                    .ok()
                    .as_deref()
                    == Some(fingerprint.as_str())
            {
                return Ok(());
            }
            std::fs::remove_dir_all(dst)?;
        } else if dst.is_dir() {
            eprintln!("keeping user-owned support directory {}", dst.display());
            return Ok(());
        } else {
            // A broken junction/symlink reports `exists() == false`; remove
            // its link entry before creating the managed directory.
            std::fs::remove_file(dst)?;
        }
    }
    copy_dir(src, dst)?;
    std::fs::write(dst.join(MANAGED_SKILL_MARKER), fingerprint)
}

/// Build a deterministic source inventory so immutable bundled support
/// packages are only copied when their contents change between app versions.
fn support_dir_fingerprint(root: &Path) -> std::io::Result<String> {
    fn visit(
        root: &Path,
        dir: &Path,
        items: &mut Vec<(String, bool, u64, u128)>,
    ) -> std::io::Result<()> {
        for entry in std::fs::read_dir(dir)? {
            let entry = entry?;
            let path = entry.path();
            let relative = path
                .strip_prefix(root)
                .unwrap_or(&path)
                .to_string_lossy()
                .replace('\\', "/");
            let metadata = entry.metadata()?;
            let modified = metadata
                .modified()
                .ok()
                .and_then(|value| value.duration_since(UNIX_EPOCH).ok())
                .map(|value| value.as_nanos())
                .unwrap_or_default();
            items.push((relative, metadata.is_dir(), metadata.len(), modified));
            if metadata.is_dir() {
                visit(root, &path, items)?;
            }
        }
        Ok(())
    }

    let mut items = Vec::new();
    visit(root, root, &mut items)?;
    items.sort_unstable_by(|a, b| a.0.cmp(&b.0));
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    for item in items {
        item.hash(&mut hasher);
    }
    Ok(format!("NebulaMat-support-v1:{:016x}\n", hasher.finish()))
}

#[allow(dead_code)]
fn sync_selected_skill_pack(
    src: &Path,
    dst: &Path,
    names: &[&str],
) -> std::io::Result<Vec<std::ffi::OsString>> {
    std::fs::create_dir_all(dst)?;
    let mut deployed = Vec::new();
    for name in names {
        let skill = src.join(name);
        if !skill.join("SKILL.md").is_file() {
            return Err(std::io::Error::new(
                std::io::ErrorKind::NotFound,
                format!("AICC skill {name} has no SKILL.md"),
            ));
        }
        let target = dst.join(name);
        if target.exists() {
            if !target.join(MANAGED_SKILL_MARKER).is_file() {
                eprintln!("keeping user-owned DSH skill that shadows bundled skill {name}");
                continue;
            }
            std::fs::remove_dir_all(&target)?;
        }
        copy_dir(&skill, &target)?;
        std::fs::write(target.join(MANAGED_SKILL_MARKER), b"NebulaMat\n")?;
        deployed.push(std::ffi::OsString::from(*name));
    }
    Ok(deployed)
}

fn copy_dir(src: &Path, dst: &Path) -> std::io::Result<()> {
    std::fs::create_dir_all(dst)?;
    for entry in std::fs::read_dir(src)? {
        let entry = entry?;
        let to = dst.join(entry.file_name());
        if entry.file_type()?.is_dir() {
            copy_dir(&entry.path(), &to)?;
        } else {
            std::fs::copy(entry.path(), &to)?;
        }
    }
    Ok(())
}

/// Reserved subdirectory of the profile's global skills dir holding the skills
/// the USER installs. It lives inside the DSH global skills directory
/// DSH scans this root directly, so an installed skill is available in every
/// workspace while project-local skills stay under `.dsh/skills/`.
/// Bundled-pack pruning skips this name, so app upgrades never delete it.
fn user_skills_dir(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(dsh_home(app)?.join("skills"))
}

/// The `name:` from a SKILL.md's YAML frontmatter, or None when the text is not
/// a skill file (no leading frontmatter, no usable name).
fn skill_name_from_markdown(text: &str) -> Option<String> {
    let front = text
        .trim_start_matches('\u{feff}')
        .trim_start()
        .strip_prefix("---")?
        .split_once("\n---")?
        .0
        .to_string();
    front.lines().find_map(|line| {
        let value = line.trim().strip_prefix("name:")?;
        sanitize_skill_name(value.trim().trim_matches(['"', '\'']))
    })
}

/// A skill's name doubles as its directory name — accept only what cannot
/// escape the skills dir (no separators, no `..`, no hidden names).
fn sanitize_skill_name(name: &str) -> Option<String> {
    let ok = !name.is_empty()
        && name.len() <= 64
        && !name.starts_with('.')
        && name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'));
    ok.then(|| name.to_string())
}

/// Skill directories in the active workspace's `.dsh/skills/`.
fn workspace_skill_dirs(workspace: &Path) -> Vec<PathBuf> {
    let root = workspace.join(".dsh").join("skills");
    let Ok(entries) = std::fs::read_dir(&root) else {
        return Vec::new();
    };
    entries
        .flatten()
        .map(|e| e.path())
        .filter(|p| p.is_dir() && p.join("SKILL.md").is_file())
        .collect()
}

fn dir_name(path: &Path) -> Option<&str> {
    path.file_name().and_then(|n| n.to_str())
}

/// Install a pasted SKILL.md straight into the profile's user skills dir — no
/// model turn, no provider needed — and refreshes DSH skill discovery
/// rediscovers it (discovery is cached per instance). Returns the skill's name.
#[tauri::command(async)]
pub fn install_skill_markdown(
    app: AppHandle,
    state: State<'_, RuntimeState>,
    text: String,
) -> Result<String, String> {
    let name = skill_name_from_markdown(&text)
        .ok_or_else(|| "not a skill file: it needs YAML frontmatter with a `name:`".to_string())?;
    // A bundled pack owns its name: refuse duplicates instead of shadowing.
    let dir = user_skills_dir(&app)?.join(&name);
    if dir.join("SKILL.md").is_file() {
        return Err(format!("a DSH skill is already called \"{name}\""));
    }
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    std::fs::write(dir.join("SKILL.md"), text.as_bytes()).map_err(|e| e.to_string())?;
    restart_sidecar_if_running(&app, &state)?;
    Ok(name)
}

/// Names already in the workspace's `.dsh/skills/`. Taken before an agent
/// install runs so `adopt_workspace_skills` can tell what it added.
#[tauri::command(async)]
pub fn workspace_skill_names(app: AppHandle) -> Result<Vec<String>, String> {
    Ok(workspace_skill_dirs(&workspace_dir(&app)?)
        .iter()
        .filter_map(|p| dir_name(p).map(str::to_owned))
        .collect())
}

/// Move skills the agent just wrote into the workspace over to the profile's
/// user skills dir, so they outlive that session's folder. `known` is the
/// pre-install listing — a pinned project's own skills stay project-scoped.
/// The workspace copy is dropped once the profile copy is in place: leaving both
/// would give DSH two skills with the same name.
/// it scanned last. Restarts the sidecar when anything moved; returns the names.
#[tauri::command(async)]
pub fn adopt_workspace_skills(
    app: AppHandle,
    state: State<'_, RuntimeState>,
    known: Vec<String>,
) -> Result<Vec<String>, String> {
    let dst_root = user_skills_dir(&app)?;
    let mut adopted = Vec::new();
    for src in workspace_skill_dirs(&workspace_dir(&app)?) {
        let Some(name) = dir_name(&src) else { continue };
        if known.iter().any(|k| k == name) || sanitize_skill_name(name).is_none() {
            continue;
        }
        let dst = dst_root.join(name);
        if dst.exists() {
            continue;
        }
        copy_dir(&src, &dst).map_err(|e| e.to_string())?;
        // Only now that the profile copy exists — a failed cleanup leaves a
        // harmless duplicate, never a lost skill.
        if let Err(e) = std::fs::remove_dir_all(&src) {
            eprintln!("could not remove the workspace copy of {name}: {e}");
        }
        adopted.push(name.to_string());
    }
    if !adopted.is_empty() {
        restart_sidecar_if_running(&app, &state)?;
    }
    Ok(adopted)
}

/// PATH for the sidecar (and everything the agent runs through it). Apps
/// launched from Finder/Dock/a desktop entry get a minimal PATH, so the agent
/// would not find the user's Python/conda/Homebrew tools. Prepend the
/// well-known locations that actually exist — the platform lists differ
/// (macOS Homebrew vs. Linux /opt/conda & Linuxbrew), same as python_candidates.
#[cfg(unix)]
pub(crate) fn enriched_path() -> String {
    let base = std::env::var("PATH").unwrap_or_default();
    let home = std::env::var("HOME").unwrap_or_default();

    #[cfg(target_os = "macos")]
    let extras = [
        "/opt/homebrew/bin".to_string(),
        "/usr/local/bin".to_string(),
        format!("{home}/anaconda3/bin"),
        format!("{home}/miniconda3/bin"),
        "/opt/anaconda3/bin".to_string(),
        "/opt/miniconda3/bin".to_string(),
        format!("{home}/.pyenv/shims"),
        format!("{home}/.local/bin"),
    ];
    #[cfg(target_os = "linux")]
    let extras = [
        format!("{home}/anaconda3/bin"),
        format!("{home}/miniconda3/bin"),
        "/opt/conda/bin".to_string(),
        "/opt/anaconda3/bin".to_string(),
        "/opt/miniconda3/bin".to_string(),
        format!("{home}/.pyenv/shims"),
        "/home/linuxbrew/.linuxbrew/bin".to_string(),
        "/usr/local/bin".to_string(),
        format!("{home}/.local/bin"),
    ];
    #[cfg(all(unix, not(target_os = "macos"), not(target_os = "linux")))]
    let extras = [
        format!("{home}/.pyenv/shims"),
        "/usr/local/bin".to_string(),
        format!("{home}/.local/bin"),
    ];

    let mut parts: Vec<String> = extras
        .into_iter()
        .filter(|p| !base.split(':').any(|b| b == p) && std::path::Path::new(p).is_dir())
        .collect();
    if !base.is_empty() {
        parts.push(base);
    }
    parts.join(":")
}

/// Windows twin of the unix version above: GUI apps inherit a PATH without the
/// user's Python/conda, and Anaconda famously does NOT add itself to PATH.
/// Prepend the conda install roots that exist — including `Library\bin`, which
/// conda pythons need on PATH for their DLLs (numpy fails to import otherwise).
#[cfg(windows)]
pub(crate) fn enriched_path() -> String {
    let base = std::env::var("PATH").unwrap_or_default();
    let mut roots: Vec<String> = Vec::new();
    if let Ok(profile) = std::env::var("USERPROFILE") {
        roots.push(format!("{profile}\\anaconda3"));
        roots.push(format!("{profile}\\miniconda3"));
    }
    roots.push("C:\\ProgramData\\anaconda3".into());
    roots.push("C:\\ProgramData\\miniconda3".into());
    let mut extras: Vec<String> = Vec::new();
    for root in roots {
        for dir in [
            root.clone(),
            format!("{root}\\Scripts"),
            format!("{root}\\Library\\bin"),
        ] {
            extras.push(dir);
        }
    }
    let mut parts: Vec<String> = extras
        .into_iter()
        .filter(|p| !base.split(';').any(|b| b.eq_ignore_ascii_case(p)) && Path::new(p).is_dir())
        .collect();
    if !base.is_empty() {
        parts.push(base);
    }
    parts.join(";")
}

/// On-disk path of a bundled sidecar (`externalBin`), if it is there. Tauri
/// places them next to the app executable with the target-triple suffix
/// stripped. Needed whenever something other than `ShellExt::sidecar` has to
/// reach one: DSH spawning an MCP server by path, or a synchronous probe.
pub(crate) fn sidecar_bin(name: &str) -> Option<PathBuf> {
    let exe = std::env::current_exe().ok()?;
    let file = if cfg!(windows) {
        format!("{name}.exe")
    } else {
        name.to_string()
    };
    let bin = exe.parent()?.join(file);
    bin.exists().then_some(bin)
}

/// A `std::process::Command` that never pops a console window on Windows.
/// A GUI app spawning a console-subsystem child (python.exe, taskkill, git…)
/// otherwise flashes a black window per spawn — every direct spawn in this
/// crate must go through here. (Sidecars via tauri_plugin_shell already set
/// the flag internally.)
pub(crate) fn quiet_command(bin: impl AsRef<std::ffi::OsStr>) -> std::process::Command {
    #[allow(unused_mut)]
    let mut cmd = std::process::Command::new(bin);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd
}

/// Make a secret-holding path owner-only: 700 for directories, 600 for files
/// (unix). The runtime root carries provider/connector API keys in
/// DSH settings and credentials, and the sidecar may rewrite those files with
/// a default umask while running — locking the DIRECTORY is what holds, since a
/// 700 dir is unreachable for other users whatever the file modes inside. On
/// Windows, %APPDATA% is per-user ACL'd already; nothing to do.
pub(crate) fn tighten_private(path: &Path) {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if let Ok(meta) = std::fs::metadata(path) {
            let mode = if meta.is_dir() { 0o700 } else { 0o600 };
            let _ = std::fs::set_permissions(path, std::fs::Permissions::from_mode(mode));
        }
    }
    #[cfg(not(unix))]
    let _ = path;
}

/// `bytes` bytes of OS randomness as lowercase hex. Panics only if the OS
/// CSPRNG is unavailable — a machine state where serving anything is unsafe.
pub(crate) fn random_hex(bytes: usize) -> String {
    let mut buf = vec![0u8; bytes];
    getrandom::fill(&mut buf).expect("OS random source unavailable");
    buf.iter().map(|b| format!("{b:02x}")).collect()
}

/// Per-run password retained for the desktop gateway's outer authentication.
/// Generated fresh each app launch and held only in memory — never written to disk — so a local
/// webpage that scans loopback ports can neither drive agent turns nor read
/// `/global/config` (which carries provider API keys). The webview gets it
/// via the `runtime_password` command; Tauri IPC is app-only.
pub(crate) fn server_password() -> &'static str {
    static PASSWORD: std::sync::OnceLock<String> = std::sync::OnceLock::new();
    PASSWORD.get_or_init(|| random_hex(16))
}

/// Expose the per-run sidecar password to the frontend SDK client.
#[tauri::command]
pub fn runtime_password() -> String {
    server_password().to_string()
}

pub(crate) fn free_port() -> u16 {
    TcpListener::bind("127.0.0.1:0")
        .ok()
        .and_then(|l| l.local_addr().ok())
        .map(|a| a.port())
        .unwrap_or(43917)
}

/// Network-proxy setting for the sidecar: `system` (default) follows the OS,
/// `custom <url>` uses a fixed proxy, `none` forces direct connections.
/// Stored as one line in `proxy.txt` under the runtime root.
fn proxy_setting_file(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(runtime_root(app)?.join("proxy.txt"))
}

/// The persisted proxy setting as (mode, url). Unknown/missing → system.
fn read_proxy_setting(app: &AppHandle) -> (String, String) {
    let raw = proxy_setting_file(app)
        .ok()
        .and_then(|p| std::fs::read_to_string(p).ok())
        .unwrap_or_default();
    let line = raw.lines().next().unwrap_or("").trim();
    match line.split_once(' ') {
        Some(("custom", url)) if !url.trim().is_empty() => ("custom".into(), url.trim().into()),
        _ if line == "none" => ("none".into(), String::new()),
        _ => ("system".into(), String::new()),
    }
}

/// Accept `http://`, `https://` or `socks5://` with a host:port.
fn validate_proxy_url(url: &str) -> Result<(), String> {
    let rest = ["http://", "https://", "socks5://"]
        .iter()
        .find_map(|s| url.strip_prefix(s))
        .ok_or("proxy URL must start with http://, https:// or socks5://")?;
    let hostport = rest.trim_end_matches('/');
    let (host, port) = hostport
        .rsplit_once(':')
        .ok_or("proxy URL needs a host:port")?;
    if host.is_empty() || port.parse::<u16>().is_err() {
        return Err("proxy URL needs a host:port".into());
    }
    Ok(())
}

/// Proxy env for the sidecar. A GUI app launched from Finder/Dock inherits no
/// shell environment, so a user whose traffic runs through a system proxy
/// (common where provider hosts are unreachable directly) gets a sidecar that
/// cannot reach them: its fetch honors HTTP(S)_PROXY but nothing sets it.
/// Resolved from the persisted setting: `system` mirrors the OS proxy (an
/// existing env always wins — a terminal launch already carries the user's own
/// values), `custom` pins the user's URL, `none` neutralizes even inherited
/// env. Verified live with xAI OAuth (#9): the proxied browser delivers the
/// code, then the sidecar's token exchange to auth.x.ai hangs without a proxy
/// and succeeds with one.
fn resolve_proxy_env(mode: &str, url: &str) -> Vec<(&'static str, String)> {
    // Loopback traffic (the sidecar's own API, provider OAuth callback
    // servers) must never route through a proxy.
    const NO_PROXY_LOOPBACK: &str = "localhost,127.0.0.1,::1";
    match mode {
        "none" => vec![
            ("HTTP_PROXY", String::new()),
            ("HTTPS_PROXY", String::new()),
            ("http_proxy", String::new()),
            ("https_proxy", String::new()),
            ("ALL_PROXY", String::new()),
            ("NO_PROXY", "*".to_string()),
        ],
        "custom" => vec![
            ("HTTP_PROXY", url.to_string()),
            ("HTTPS_PROXY", url.to_string()),
            ("NO_PROXY", NO_PROXY_LOOPBACK.to_string()),
        ],
        _ => {
            if ["HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy"]
                .iter()
                .any(|k| std::env::var_os(k).is_some())
            {
                return Vec::new();
            }
            match system_proxy_url() {
                Some(sys) => vec![
                    ("HTTP_PROXY", sys.clone()),
                    ("HTTPS_PROXY", sys),
                    ("NO_PROXY", NO_PROXY_LOOPBACK.to_string()),
                ],
                None => Vec::new(),
            }
        }
    }
}

/// The proxy the sidecar would actually use right now, for display in
/// Settings. None ⇒ direct connections.
fn effective_proxy(mode: &str, url: &str) -> Option<String> {
    match mode {
        "none" => None,
        "custom" => Some(url.to_string()),
        _ => ["HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy"]
            .iter()
            .find_map(|k| std::env::var(k).ok().filter(|v| !v.is_empty()))
            .or_else(system_proxy_url),
    }
}

/// PyPI-index and Python-download mirrors for the bundled uv, stored one per
/// line (`pypi <url>` / `python <url>`) in `mirrors.txt` under the runtime root.
/// Empty ⇒ uv's defaults (pypi.org / github.com). Only the uv provisioning
/// flows read these — no long-running sidecar to restart.
fn mirror_setting_file(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(runtime_root(app)?.join("mirrors.txt"))
}

/// The persisted mirrors as (pypi_index_url, python_install_mirror_url).
fn read_mirror_setting(app: &AppHandle) -> (String, String) {
    let raw = mirror_setting_file(app)
        .ok()
        .and_then(|p| std::fs::read_to_string(p).ok())
        .unwrap_or_default();
    let (mut pypi, mut python) = (String::new(), String::new());
    for line in raw.lines() {
        match line.trim().split_once(' ') {
            Some(("pypi", v)) => pypi = v.trim().to_string(),
            Some(("python", v)) => python = v.trim().to_string(),
            _ => {}
        }
    }
    (pypi, python)
}

/// Accept an `http(s)://` URL with a non-empty host.
fn validate_mirror_url(url: &str) -> Result<(), String> {
    let rest = ["https://", "http://"]
        .iter()
        .find_map(|s| url.strip_prefix(s))
        .ok_or("mirror URL must start with http:// or https://")?;
    if rest.trim_matches('/').is_empty() {
        return Err("mirror URL needs a host".into());
    }
    Ok(())
}

/// Network env for the bundled uv sidecar (managed-Python download + pip
/// install). Mirrors the DSH sidecar's proxy so first-run provisioning
/// works behind the same proxy the agent uses, and adds the optional PyPI /
/// Python-download mirrors. uv reads HTTP(S)_PROXY, `UV_DEFAULT_INDEX` and
/// `UV_PYTHON_INSTALL_MIRROR` from its environment.
pub(crate) fn uv_network_env(app: &AppHandle) -> Vec<(&'static str, String)> {
    let (mode, url) = read_proxy_setting(app);
    let mut env = resolve_proxy_env(&mode, &url);
    let (pypi, python) = read_mirror_setting(app);
    if !pypi.is_empty() {
        env.push(("UV_DEFAULT_INDEX", pypi));
    }
    if !python.is_empty() {
        env.push(("UV_PYTHON_INSTALL_MIRROR", python));
    }
    env
}

/// Proxy env for a bundled sidecar other than DSH (e.g. agent-browser's
/// Chrome download). Same resolution as the DSH sidecar so a first-run
/// browser install works behind the user's configured proxy, without the uv
/// mirror vars that only uv understands.
pub(crate) fn sidecar_proxy_env(app: &AppHandle) -> Vec<(&'static str, String)> {
    let (mode, url) = read_proxy_setting(app);
    resolve_proxy_env(&mode, &url)
}

/// The system-configured proxy as a URL, if one is enabled (macOS: scutil).
/// HTTP(S) proxies are preferred — an HTTPS proxy endpoint still speaks plain
/// HTTP CONNECT, hence the http:// scheme — with SOCKS as the fallback.
#[cfg(target_os = "macos")]
fn system_proxy_url() -> Option<String> {
    let out = quiet_command("scutil").arg("--proxy").output().ok()?;
    parse_scutil_proxy(&String::from_utf8_lossy(&out.stdout))
}

/// Parse `scutil --proxy` output (`  Key : value` lines) into a proxy URL.
fn parse_scutil_proxy(text: &str) -> Option<String> {
    let get = |key: &str| -> Option<String> {
        let prefix = format!("{key} : ");
        text.lines().find_map(|l| {
            l.trim()
                .strip_prefix(prefix.as_str())
                .map(|v| v.trim().to_string())
        })
    };
    let enabled = |key: &str| get(key).as_deref() == Some("1");
    for (en, host, port, scheme) in [
        ("HTTPSEnable", "HTTPSProxy", "HTTPSPort", "http"),
        ("HTTPEnable", "HTTPProxy", "HTTPPort", "http"),
        ("SOCKSEnable", "SOCKSProxy", "SOCKSPort", "socks5"),
    ] {
        if enabled(en) {
            if let (Some(h), Some(p)) = (get(host), get(port)) {
                return Some(format!("{scheme}://{h}:{p}"));
            }
        }
    }
    None
}

#[cfg(windows)]
fn system_proxy_url() -> Option<String> {
    // GUI launches do not inherit a terminal's proxy environment. Read the
    // WinInet settings that browsers and PowerShell use, while leaving PAC
    // files to the user's explicit custom-proxy setting.
    const INTERNET_SETTINGS: &str =
        r"HKCU\Software\Microsoft\Windows\CurrentVersion\Internet Settings";
    let enabled = quiet_command("reg")
        .args(["query", INTERNET_SETTINGS, "/v", "ProxyEnable"])
        .output()
        .ok()
        .and_then(|output| {
            windows_registry_value(&String::from_utf8_lossy(&output.stdout), "ProxyEnable")
        })
        .is_some_and(|value| value == "1" || value.eq_ignore_ascii_case("0x1"));
    if !enabled {
        return None;
    }
    quiet_command("reg")
        .args(["query", INTERNET_SETTINGS, "/v", "ProxyServer"])
        .output()
        .ok()
        .and_then(|output| {
            windows_registry_value(&String::from_utf8_lossy(&output.stdout), "ProxyServer")
        })
        .and_then(|value| parse_windows_proxy(&value))
}

#[cfg(all(not(target_os = "macos"), not(windows)))]
fn system_proxy_url() -> Option<String> {
    // Linux terminal launches inherit the user's proxy environment (covered
    // by the passthrough above); no desktop proxy store is read here yet.
    None
}

#[cfg(windows)]
fn windows_registry_value(text: &str, name: &str) -> Option<String> {
    text.lines()
        .find_map(|line| {
            let mut fields = line.split_whitespace();
            (fields.next() == Some(name)).then(|| {
                fields.next();
                fields.collect::<Vec<_>>().join(" ")
            })
        })
        .filter(|value| !value.is_empty())
}

fn parse_windows_proxy(value: &str) -> Option<String> {
    let mut candidates = std::collections::HashMap::new();
    let entries: Vec<(&str, &str)> = if value.contains('=') {
        value
            .split(';')
            .filter_map(|entry| entry.trim().split_once('='))
            .collect()
    } else {
        vec![("http", value)]
    };
    for (kind, endpoint) in entries {
        let endpoint = endpoint.trim();
        if !endpoint.is_empty() {
            candidates.insert(kind.trim().to_ascii_lowercase(), endpoint);
        }
    }
    for kind in ["https", "http", "socks"] {
        let Some(endpoint) = candidates.get(kind).copied() else {
            continue;
        };
        let endpoint = endpoint.trim_end_matches('/');
        if endpoint.starts_with("http://")
            || endpoint.starts_with("https://")
            || endpoint.starts_with("socks5://")
        {
            return Some(endpoint.to_string());
        }
        if kind == "socks" {
            return Some(format!("socks5://{endpoint}"));
        }
        return Some(format!("http://{endpoint}"));
    }
    None
}

fn permission_mode_file(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(runtime_root(app)?.join("permission-mode"))
}

fn dsh_permission_mode(app: &AppHandle) -> String {
    let saved = permission_mode_file(app)
        .ok()
        .and_then(|path| std::fs::read_to_string(path).ok());
    match saved.as_deref().map(str::trim) {
        Some("danger-full-access") => "danger-full-access",
        _ => "workspace-write",
    }
    .to_string()
}

#[derive(Debug, PartialEq)]
struct DshLaunch {
    program: String,
    prefix_args: Vec<String>,
    entry: Option<String>,
    description: String,
}

// Passing an absolute Windows script path as a Node argv entry can be split at
// the drive colon by the shell process bridge (Node then tries to lstat `C:`).
// Load the bundled ESM entry through a file URL instead, keeping the path out
// of the child command line entirely.
const BUNDLED_DSH_BOOTSTRAP: &str =
    "import('node:url').then(({pathToFileURL}) => import(pathToFileURL(process.env.NEBULAMAT_DSH_ENTRY).href))";

fn bundled_dsh_launch(runtime_dir: &Path) -> Option<DshLaunch> {
    let node = runtime_dir.join("node.exe");
    let entry = runtime_dir
        .join("node_modules")
        .join("@deepseek-ai")
        .join("dsh")
        .join("lib")
        .join("bin.js");
    if !node.is_file() || !entry.is_file() {
        return None;
    }
    Some(DshLaunch {
        program: node.to_string_lossy().into_owned(),
        prefix_args: vec![
            "-e".into(),
            BUNDLED_DSH_BOOTSTRAP.into(),
            // Node -e has no script filename; this placeholder keeps dsh's
            // normal process.argv.slice(2) parsing intact.
            "dsh".into(),
        ],
        entry: Some(entry.to_string_lossy().into_owned()),
        description: "bundled DeepSeek Harness".into(),
    })
}

fn resolve_dsh_launch(app: &AppHandle) -> Result<DshLaunch, String> {
    if let Some(program) = std::env::var("NEBULAMAT_DSH_BIN")
        .ok()
        .filter(|value| !value.trim().is_empty())
    {
        return Ok(DshLaunch {
            description: format!("NEBULAMAT_DSH_BIN ({program})"),
            program,
            prefix_args: Vec::new(),
            entry: None,
        });
    }

    #[cfg(windows)]
    {
        if let Ok(runtime_dir) = app
            .path()
            .resolve("dsh/windows-x64", BaseDirectory::Resource)
        {
            if let Some(launch) = bundled_dsh_launch(&runtime_dir) {
                return Ok(launch);
            }
        }
        #[cfg(debug_assertions)]
        if let Some(launch) = bundled_dsh_launch(
            &PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .join("dsh")
                .join("windows-x64"),
        ) {
            return Ok(launch);
        }
    }

    #[cfg(any(debug_assertions, not(windows)))]
    return Ok(DshLaunch {
        program: "dsh".into(),
        prefix_args: Vec::new(),
        entry: None,
        description: "development PATH fallback".into(),
    });

    #[cfg(all(not(debug_assertions), windows))]
    Err(
        "bundled DeepSeek Harness runtime is missing or incomplete; reinstall NebulaMat or set NEBULAMAT_DSH_BIN"
            .into(),
    )
}

fn spawn_sidecar(app: &AppHandle, port: u16) -> Result<CommandChild, String> {
    let root = runtime_root(app)?;
    let dsh_home = dsh_home(app)?;
    let app_data = app
        .path()
        .app_data_dir()
        .map(|path| path.to_string_lossy().to_string())
        .unwrap_or_else(|_| "<unresolved>".to_owned());
    let user = std::env::var("USERNAME")
        .or_else(|_| std::env::var("USER"))
        .unwrap_or_else(|_| "<unknown>".to_owned());
    crate::debug_log::append(
        app,
        &format!(
            "[runtime] launch user={user} app_data={app_data} dsh_home={} settings_exists={} fallback_exists={}",
            dsh_home.display(),
            dsh_home.join("settings.yaml").is_file(),
            default_model_file(app).map(|path| path.is_file()).unwrap_or(false)
        ),
    );
    // Run DSH inside the user-facing workspace, not the app's cwd (which may be
    // `/` when launched from Finder).
    let workspace = workspace_dir(app)?;
    for d in [&dsh_home, &workspace] {
        std::fs::create_dir_all(d).map_err(|e| e.to_string())?;
    }
    ensure_global_scientific_memory(&dsh_home);
    deploy_bundled_skills(app, &dsh_home);
    // Materials skills link into the pinned AICC knowledge base. Provision it
    // once beside the global skills and resolve the portable source token in
    // the copied markdown; a missing optional dev resource must not block DSH.
    if let Err(error) = deploy_aicc_tool_skills(app, &dsh_home.join("skills")) {
        crate::debug_log::append(app, &format!("[aicc] startup deployment skipped: {error}"));
    }
    deploy_dsh_tool_governance(app, &dsh_home)?;
    deploy_dsh_cost_meter(app, &dsh_home)?;
    deploy_dsh_genui(app, &dsh_home)?;
    deploy_dsh_vaspflow(app, &dsh_home)?;
    ensure_dsh_web_profile(app)?;
    if let Err(error) = prepare_default_model_selection(app, &dsh_home) {
        crate::debug_log::append(
            app,
            &format!("[runtime] default model recovery skipped: {error}"),
        );
    }
    if let Err(error) = crate::model_catalog::initialize(app, &dsh_home) {
        crate::debug_log::append(
            app,
            &format!("[model-catalog] startup initialization failed: {error}"),
        );
    }
    write_dsh_module_state(app, &read_dsh_module_state(app))?;
    // DSH settings and credentials live below this app-private home.
    tighten_private(&root);
    tighten_private(&dsh_home);
    let home = std::env::var("HOME").unwrap_or_default();
    let port_str = port.to_string();

    let launch = resolve_dsh_launch(app)?;
    let launch_description = launch.description.clone();
    let launch_program = launch.program.clone();
    let launch_entry = launch.entry.clone();
    let aris_repo = aris_resource_root(app)
        .map(|root| root.join("upstream"))
        .filter(|path| path.join("tools").is_dir());
    let mut launch_args = launch.prefix_args;
    launch_args.extend([
        "--profile".into(),
        "web".into(),
        "--host".into(),
        "127.0.0.1".into(),
        "--port".into(),
        port_str,
    ]);
    let mut cmd = app
        .shell()
        .command(launch_program.clone())
        .args(launch_args)
        .env("DSH_HOME", dsh_home.to_string_lossy().to_string())
        .env("DSH_CWD", workspace.to_string_lossy().to_string())
        .env("DSH_PERMISSION_MODE", dsh_permission_mode(app))
        .env("HOME", home)
        // Never inherit a developer's shell DeepSeek key into the packaged
        // runtime. Provider credentials must be entered explicitly through
        // the app-owned credential service.
        .env("DEEPSEEK_API_KEY", "")
        // Lets bundled skill helpers (e.g. remote-compute's record_run.py) stamp
        // the recording app version into provenance — they run outside the app
        // and can't otherwise know it.
        .env(
            "OPENSCIENCE_APP_VERSION",
            app.package_info().version.to_string(),
        )
        .current_dir(&workspace);
    if let Some(aris_repo) = aris_repo {
        cmd = cmd.env("ARIS_REPO", aris_repo.to_string_lossy().to_string());
    }
    // MatterGen source and the runner are shipped as small resources. The
    // Python environment and large model checkpoint are provisioned lazily;
    // the checkpoint lives in the shared workspace and is never installer data.
    let source_tree = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../../runtime/mattergen");
    let models = crate::runtime::base_workspace_dir(app)
        .unwrap_or_else(|_| workspace.clone())
        .join("runtime")
        .join("mattergen")
        .join("models");
    let source = app
        .path()
        .resolve("mattergen/upstream", tauri::path::BaseDirectory::Resource)
        .ok()
        .filter(|path| path.is_dir())
        .unwrap_or_else(|| source_tree.join("upstream"));
    let runner = app
        .path()
        .resolve(
            "mattergen/mattergen_runner.py",
            tauri::path::BaseDirectory::Resource,
        )
        .ok()
        .filter(|path| path.is_file())
        .unwrap_or_else(|| source_tree.join("mattergen_runner.py"));
    let setup = app
        .path()
        .resolve(
            "mattergen/setup_mattergen.py",
            tauri::path::BaseDirectory::Resource,
        )
        .ok()
        .filter(|path| path.is_file())
        .unwrap_or_else(|| source_tree.join("setup_mattergen.py"));
    cmd = cmd
        .env(
            "NEBULAMAT_MATTERGEN_MODELS",
            models.to_string_lossy().to_string(),
        )
        .env(
            "NEBULAMAT_MATTERGEN_SOURCE",
            source.to_string_lossy().to_string(),
        )
        .env(
            "NEBULAMAT_MATTERGEN_RUNNER",
            runner.to_string_lossy().to_string(),
        )
        .env(
            "NEBULAMAT_MATTERGEN_SETUP",
            setup.to_string_lossy().to_string(),
        );
    if let Ok(app_data) = app.path().app_data_dir() {
        let home = app_data.join("runtime").join("mattergen");
        let python = if cfg!(windows) {
            home.join("venv").join("Scripts").join("python.exe")
        } else {
            home.join("venv").join("bin").join("python")
        };
        cmd = cmd
            .env(
                "NEBULAMAT_MATTERGEN_HOME",
                home.to_string_lossy().to_string(),
            )
            .env(
                "NEBULAMAT_MATTERGEN_PYTHON",
                python.to_string_lossy().to_string(),
            );
    }
    if let Some(uv) = sidecar_bin("uv") {
        cmd = cmd.env("NEBULAMAT_UV_BIN", uv.to_string_lossy().to_string());
    }
    if let Some(entry) = launch_entry {
        cmd = cmd.env("NEBULAMAT_DSH_ENTRY", entry);
    }
    // GUI-launched apps get a minimal PATH; give the agent the user's real tools.
    let mut cmd = cmd.env("PATH", enriched_path());
    // The agent's own `ssh`/`rsync`/`sbatch` calls ride the app's shared
    // connection through this config, so a host the user signed in to once needs
    // no further password or one-time code (#73). The bundled remote-compute
    // skill and the ssh_connect tool both pass `-F "$OPENSCIENCE_SSH_CONFIG"`.
    if let Some(ssh_config) = crate::ssh_session::config_path(app) {
        cmd = cmd.env(
            "OPENSCIENCE_SSH_CONFIG",
            ssh_config.to_string_lossy().to_string(),
        );
    }
    // Apply the network-proxy setting so provider logins and API calls work
    // where direct connections are blocked (see resolve_proxy_env).
    let (proxy_mode, proxy_url) = read_proxy_setting(app);
    for (k, v) in resolve_proxy_env(&proxy_mode, &proxy_url) {
        cmd = cmd.env(k, v);
    }

    let (mut rx, child) = cmd.spawn().map_err(|e| {
        format!(
            "failed to start DeepSeek Harness using {launch_description} ({launch_program}): {e}. Reinstall NebulaMat or set NEBULAMAT_DSH_BIN to a working dsh executable"
        )
    })?;
    // Drain events so the child's stdout/stderr buffer never blocks it, AND record
    // the failure signals we used to discard. When the ad-hoc-signed sidecar dies
    // during bootstrap (TCC denial, config-merge abort, panic) the only symptom was
    // a generic connection error in the UI with no cause. Now
    // stderr, spawn errors, and the exit code land in debug.log next to the
    // frontend's connection attempts. DSH owns its own log files, so stdout
    // request traffic is not copied into debug.log.
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        use tauri_plugin_shell::process::CommandEvent;
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stderr(bytes) => {
                    for line in String::from_utf8_lossy(&bytes).split(['\n', '\r']) {
                        let line = line.trim();
                        if !line.is_empty() {
                            crate::debug_log::append(&app, &format!("[deepseek-harness] {line}"));
                        }
                    }
                }
                CommandEvent::Error(e) => {
                    crate::debug_log::append(&app, &format!("[deepseek-harness] error: {e}"));
                }
                CommandEvent::Terminated(status) => {
                    crate::debug_log::append(
                        &app,
                        &format!(
                            "[deepseek-harness] terminated: code={:?} signal={:?}",
                            status.code, status.signal
                        ),
                    );
                }
                _ => {}
            }
        }
    });
    Ok(child)
}

/// Kill and respawn a running sidecar on its stable port. The lifecycle lock
/// covers the complete state transition, and URL is cleared before spawning so
/// a failed restart can never leave a stale "running" marker behind.
fn restart_sidecar_if_running(
    app: &AppHandle,
    state: &RuntimeState,
) -> Result<Option<String>, String> {
    let mut lifecycle = state.lifecycle.lock().unwrap();
    let Some(child) = lifecycle.child.take() else {
        lifecycle.url = None;
        return Ok(None);
    };
    lifecycle.url = None;
    let _ = child.kill();

    let port = *lifecycle.port.get_or_insert_with(free_port);
    let child = spawn_sidecar(app, port)?;
    let url = format!("http://127.0.0.1:{port}");
    lifecycle.child = Some(child);
    lifecycle.url = Some(url.clone());
    Ok(Some(url))
}

/// Start DeepSeek Harness (idempotent). Returns its base URL. `async`:
/// skill-pack deployment + process spawn at startup must not block the UI
/// thread while the first window paints.
#[tauri::command(async)]
pub fn start_runtime(app: AppHandle, state: State<'_, RuntimeState>) -> Result<String, String> {
    let mut lifecycle = state.lifecycle.lock().unwrap();
    if let (Some(_), Some(url)) = (&lifecycle.child, &lifecycle.url) {
        let _ = url;
        drop(lifecycle);
        return crate::gateway::desktop_bridge_url(&app);
    }
    // Repair any impossible partial state left by an older build or a failed
    // transition before attempting a fresh start.
    if let Some(child) = lifecycle.child.take() {
        let _ = child.kill();
    }
    lifecycle.url = None;

    // Reuse a stable port across restarts so the frontend URL doesn't change.
    let port = *lifecycle.port.get_or_insert_with(free_port);
    let child = spawn_sidecar(&app, port)?;
    let url = format!("http://127.0.0.1:{port}");
    lifecycle.child = Some(child);
    lifecycle.url = Some(url.clone());
    drop(lifecycle);
    crate::gateway::desktop_bridge_url(&app)
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelCatalogRefreshResult {
    changed: bool,
    restarted: bool,
    source: String,
    route_count: usize,
    model_count: usize,
}

/// Pull the current provider catalogs and restart DSH only when its generated
/// settings changed. This command is user-triggered from Settings so a catalog
/// update never interrupts an active turn in the background.
#[tauri::command(async)]
pub fn refresh_model_catalog(
    app: AppHandle,
    state: State<'_, RuntimeState>,
) -> Result<ModelCatalogRefreshResult, String> {
    let dsh_home = dsh_home(&app)?;
    let settings_path = dsh_home.join("settings.yaml");
    let before = std::fs::read(&settings_path).ok();
    let summary = crate::model_catalog::refresh(&app, &dsh_home)?;
    let after = std::fs::read(&settings_path).ok();
    let changed = before != after;
    let restarted = if changed {
        restart_sidecar_if_running(&app, &state)?.is_some()
    } else {
        false
    };
    Ok(ModelCatalogRefreshResult {
        changed,
        restarted,
        source: summary.source,
        route_count: summary.route_count,
        model_count: summary.model_count,
    })
}

/// The workspace directory the sidecar runs in — the frontend passes it to the
/// SDK so skill discovery is scoped to the right DSH instance.
#[tauri::command]
pub fn workspace_path(app: AppHandle) -> Result<String, String> {
    Ok(workspace_dir(&app)?.to_string_lossy().to_string())
}

/// The base folder containing projects and sessions (`~/Documents/OpenScience`).
#[tauri::command]
pub fn workspace_base(app: AppHandle) -> Result<String, String> {
    Ok(base_workspace_dir(&app)?.to_string_lossy().to_string())
}

/// Choose the base folder (Settings → Workspace → Change). Creates its
/// `projects/` and `sessions/` collections and persists the choice. Existing
/// workspaces keep their folders.
#[tauri::command]
pub fn set_workspace_base(app: AppHandle, path: String) -> Result<String, String> {
    let dir = PathBuf::from(&path);
    if !dir.is_absolute() {
        return Err("workspace base must be absolute".into());
    }
    ensure_base_layout(dir.clone()).map_err(|e| format!("could not create folder: {e}"))?;
    let canon = crate::artifact_file::native_path(&dir.canonicalize().map_err(|e| e.to_string())?);
    std::fs::write(base_workspace_file(&app)?, canon.as_bytes()).map_err(|e| e.to_string())?;
    Ok(canon)
}

/// Reveal the base workspace folder in the OS file manager. (The sandboxed
/// `open_path` resolves inside the ACTIVE workspace only, which may be a dated
/// subfolder — the base needs its own door.)
#[tauri::command]
pub fn open_workspace_base(app: AppHandle) -> Result<(), String> {
    crate::artifact_file::os_open(&base_workspace_dir(&app)?)
}

/// Switch the active workspace folder: create it if needed and persist the
/// choice. The kernel / Files / provenance read the folder via `workspace_dir`;
/// the agent runtime is scoped per request — the frontend reconnects its event
/// stream with `?directory=` and creates sessions with it (a bare `/event`
/// stream would not see other folders' instances, so the scoped stream is
/// required). `path` must be absolute.
#[tauri::command(async)]
pub fn set_workspace(
    app: AppHandle,
    _state: State<'_, RuntimeState>,
    path: String,
) -> Result<String, String> {
    let dir = PathBuf::from(&path);
    if !dir.is_absolute() {
        return Err("workspace path must be absolute".into());
    }
    std::fs::create_dir_all(&dir).map_err(|e| format!("could not create folder: {e}"))?;
    let canon = dir.canonicalize().map_err(|e| e.to_string())?;
    // Persisted and returned in native form — on Windows the verbatim `\\?\`
    // path `canonicalize()` produces matches nothing the sidecar reports (#76).
    let native = crate::artifact_file::native_path(&canon);
    std::fs::write(active_workspace_file(&app)?, native.as_bytes()).map_err(|e| e.to_string())?;

    // Follow the active folder with the snapshot watcher so out-of-app edits
    // (external editor, detached process) in the new workspace are captured too.
    crate::git_snapshot::watch_workspace(&canon);

    // No sidecar restart: DSH serves every folder from one process via
    // per-directory instances, and the frontend reconnects its event stream
    // with `?directory=<new folder>`. Restarting here used to cost 3-6 s per
    // history-session switch (process boot + reconnect polling).
    // Jupyter-lab, however, pins its root_dir at spawn time — re-root it (in
    // the background) so agent-created notebooks land in the new folder.
    crate::jupyter::reroot_jupyter(&app);
    // Refresh this session's local copy of the remote-machine list from the
    // canonical base file, so a machine configured in Settings is visible to
    // every session's agent without reaching outside the workspace.
    crate::compute::materialize_active(&app);
    Ok(native)
}

/// Record which session owns the active workspace, so bundled skill helpers
/// (record_run.py) can stamp remote runs with their `sessionId` — the app knows
/// the id but the off-app helper only sees the workspace. Written as
/// `<workspace>/.openscience/session.txt`; best-effort, empty ids are ignored.
#[tauri::command]
pub fn mark_session(app: AppHandle, session_id: String) -> Result<(), String> {
    let id = session_id.trim();
    if id.is_empty() {
        return Ok(());
    }
    let dir = workspace_dir(&app)?.join(".openscience");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = dir.join("session.txt");
    // Write-then-rename so a concurrent read never sees a half-written id.
    let tmp = path.with_extension("txt.tmp");
    std::fs::write(&tmp, id).map_err(|e| e.to_string())?;
    if std::fs::rename(&tmp, &path).is_err() {
        let _ = std::fs::write(&path, id);
        let _ = std::fs::remove_file(&tmp);
    }
    Ok(())
}

/// Create a new dated folder `<base>/sessions/<name>` and switch to it. `name`
/// is a single path segment (the frontend supplies a timestamp); rejects
/// separators.
#[tauri::command(async)]
pub fn new_dated_workspace(
    app: AppHandle,
    state: State<'_, RuntimeState>,
    name: String,
) -> Result<String, String> {
    if name.is_empty() || name.contains('/') || name.contains('\\') || name.contains("..") {
        return Err("invalid folder name".into());
    }
    let dir = sessions_dir(&app)?.join(&name);
    // `set_workspace` moves `app`; keep a handle to seed the harness afterwards.
    let seed_app = app.clone();
    let canon = set_workspace(app, state, dir.to_string_lossy().to_string())?;
    // Seed the agent harness into the fresh folder so it starts with its
    // operating rules, not an empty directory. Only NEW dated folders get seeded
    // (never `set_workspace` alone — switching to an existing session must not
    // re-plant the scaffold).
    crate::harness::seed_harness(&seed_app, std::path::Path::new(&canon));
    crate::git_snapshot::commit_best_effort(std::path::Path::new(&canon), "Initialize workspace");
    Ok(canon)
}

/// Native "choose a folder" dialog; returns the absolute path, or None on cancel.
#[tauri::command]
pub async fn pick_folder(app: AppHandle) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    let Some(picked) = app.dialog().file().blocking_pick_folder() else {
        return Ok(None);
    };
    let path = picked.into_path().map_err(|e| e.to_string())?;
    Ok(Some(path.to_string_lossy().to_string()))
}

/// Characters a file name cannot carry on Windows/macOS/Linux, plus control
/// characters. Conversation titles are free text, so a title becomes a file
/// name only after this.
fn safe_file_stem(title: &str, fallback: &str) -> String {
    let cleaned: String = title
        .chars()
        .map(|c| {
            if c.is_control() || matches!(c, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|') {
                '-'
            } else {
                c
            }
        })
        .collect();
    // Windows also rejects a trailing dot or space.
    let trimmed = cleaned.trim().trim_end_matches('.').trim();
    // 80 chars leaves room for the id suffix and the extension inside the
    // 255-byte limit every mainstream filesystem enforces.
    let capped: String = trimmed.chars().take(80).collect();
    let capped = capped.trim().to_string();
    if capped.is_empty() {
        return fallback.to_string();
    }
    // Windows refuses these device names whatever the extension.
    const RESERVED: &[&str] = &[
        "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8",
        "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
    ];
    if RESERVED.iter().any(|r| capped.eq_ignore_ascii_case(r)) {
        return format!("{capped}-");
    }
    capped
}

/// Write one exported conversation into a folder the user picked in a native
/// dialog. Confined to that folder: the file name is derived from the title
/// (never used as a path), so a conversation called "../../.ssh/authorized_keys"
/// cannot escape it.
#[tauri::command]
pub fn write_export_file(
    directory: String,
    name: String,
    contents: String,
) -> Result<String, String> {
    let dir = PathBuf::from(&directory);
    if !dir.is_dir() {
        return Err(format!("{directory} is not a folder"));
    }
    let stem = safe_file_stem(&name, "conversation");
    let mut path = dir.join(format!("{stem}.md"));
    // Two conversations can share a title; never silently overwrite one.
    let mut n = 2;
    while path.exists() {
        path = dir.join(format!("{stem} ({n}).md"));
        n += 1;
        if n > 999 {
            return Err("too many files with that name".to_string());
        }
    }
    std::fs::write(&path, contents).map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().to_string())
}

/// Kill the DSH sidecar if running.
#[tauri::command]
pub fn stop_runtime(
    state: State<'_, RuntimeState>,
    bridge: State<'_, crate::gateway::DesktopBridgeState>,
) {
    let mut lifecycle = state.lifecycle.lock().unwrap();
    if let Some(child) = lifecycle.child.take() {
        let _ = child.kill();
    }
    lifecycle.url = None;
    drop(lifecycle);
    crate::gateway::shutdown_desktop_bridge(bridge.inner());
}

pub fn kill_child(state: &RuntimeState) {
    let mut lifecycle = state.lifecycle.lock().unwrap();
    if let Some(child) = lifecycle.child.take() {
        let _ = child.kill();
    }
    lifecycle.url = None;
}

#[cfg(test)]
mod tests {
    use super::{
        application_owned_dsh_patch_rows, bundled_dsh_launch, default_dsh_web_profile,
        default_model_from_settings, dsh_mcp_plugin, dsh_plugin_entry, ensure_base_layout,
        github_tarball_specs, normalized_plugin_spec, parse_model_selection, parse_scutil_proxy,
        parse_windows_proxy, plugin_spec_matches, prepare_aicc_collection, prune_stale_skills,
        random_hex, remove_application_owned_profile_dependencies, repair_dsh_profile_bundles,
        resolve_proxy_env, restore_default_model_settings, sanitize_mcp_state,
        skill_name_from_markdown, summarize_plugin_failure, sync_managed_support_dir,
        sync_selected_skill_pack, sync_skill_pack, validate_proxy_url, workspace_skill_dirs,
        DshModuleState, BUNDLED_DSH_BOOTSTRAP, BUNDLED_GENUI_PACKAGE, BUNDLED_VASPFLOW_PACKAGE,
        MANAGED_SKILL_MARKER,
    };
    use std::fs;

    #[test]
    fn model_selection_parser_keeps_provider_slashes_out_of_the_model_id() {
        let selection = parse_model_selection("opencode-go/glm-5.3-flash").unwrap();
        assert_eq!(selection.provider, "opencode-go");
        assert_eq!(selection.model, "glm-5.3-flash");
        assert!(parse_model_selection("missing-provider").is_none());
    }

    #[test]
    fn default_model_recovery_repairs_a_missing_or_stale_settings_section() {
        let fallback = parse_model_selection("opencode-go/glm-5.3-flash").unwrap();
        let restored = restore_default_model_settings("llm-pi-ai: {}\n", Some(&fallback))
            .unwrap()
            .unwrap();
        assert_eq!(
            default_model_from_settings(&restored),
            Some(fallback.clone())
        );
        let existing =
            "agent-default-model:\n  provider: deepseek-official\n  model: deepseek-v4-flash\n";
        let repaired = restore_default_model_settings(existing, Some(&fallback))
            .unwrap()
            .unwrap();
        assert_eq!(
            default_model_from_settings(&repaired),
            Some(fallback.clone())
        );

        let matching =
            "agent-default-model:\n  provider: opencode-go\n  model: glm-5.3-flash\n  reasoningEffort: max\n";
        assert!(restore_default_model_settings(matching, Some(&fallback))
            .unwrap()
            .is_none());
    }

    #[test]
    fn base_layout_has_separate_project_and_session_collections() {
        let root = std::env::temp_dir().join(format!("os-workspace-layout-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);

        assert_eq!(ensure_base_layout(root.clone()).unwrap(), root);
        assert!(root.join("projects").is_dir());
        assert!(root.join("sessions").is_dir());

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn bundled_dsh_requires_node_and_cli_entry() {
        let root = std::env::temp_dir().join(format!("os-bundled-dsh-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).unwrap();
        assert!(bundled_dsh_launch(&root).is_none());

        fs::write(root.join("node.exe"), b"node").unwrap();
        assert!(bundled_dsh_launch(&root).is_none());

        let entry = root
            .join("node_modules")
            .join("@deepseek-ai")
            .join("dsh")
            .join("lib")
            .join("bin.js");
        fs::create_dir_all(entry.parent().unwrap()).unwrap();
        fs::write(&entry, b"// dsh").unwrap();

        let launch = bundled_dsh_launch(&root).unwrap();
        assert_eq!(launch.program, root.join("node.exe").to_string_lossy());
        assert_eq!(launch.prefix_args[0], "-e");
        assert_eq!(launch.prefix_args[1], BUNDLED_DSH_BOOTSTRAP);
        assert_eq!(launch.prefix_args[2], "dsh");
        assert_eq!(launch.entry, Some(entry.to_string_lossy().into_owned()));
        assert_eq!(launch.description, "bundled DeepSeek Harness");
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn proxy_url_validation() {
        assert!(validate_proxy_url("http://127.0.0.1:7890").is_ok());
        assert!(validate_proxy_url("socks5://10.0.0.2:1080").is_ok());
        assert!(validate_proxy_url("http://[::1]:8080").is_ok());
        assert!(validate_proxy_url("127.0.0.1:7890").is_err()); // no scheme
        assert!(validate_proxy_url("http://host").is_err()); // no port
        assert!(validate_proxy_url("http://:7890").is_err()); // no host
        assert!(validate_proxy_url("ftp://h:1").is_err()); // wrong scheme
    }

    #[test]
    fn proxy_env_modes() {
        let none = resolve_proxy_env("none", "");
        assert!(none.iter().any(|(k, v)| *k == "NO_PROXY" && v == "*"));
        assert!(none
            .iter()
            .any(|(k, v)| *k == "HTTPS_PROXY" && v.is_empty()));

        let custom = resolve_proxy_env("custom", "http://127.0.0.1:7890");
        assert!(custom
            .iter()
            .any(|(k, v)| *k == "HTTPS_PROXY" && v == "http://127.0.0.1:7890"));
        assert!(custom
            .iter()
            .any(|(k, v)| *k == "NO_PROXY" && v.contains("127.0.0.1")));
    }

    #[test]
    fn windows_proxy_parser_prefers_https_and_handles_plain_endpoints() {
        assert_eq!(
            parse_windows_proxy("http=127.0.0.1:7890;https=127.0.0.1:7990"),
            Some("http://127.0.0.1:7990".into()),
        );
        assert_eq!(
            parse_windows_proxy("127.0.0.1:7990"),
            Some("http://127.0.0.1:7990".into()),
        );
        assert_eq!(
            parse_windows_proxy("socks=127.0.0.1:1080"),
            Some("socks5://127.0.0.1:1080".into()),
        );
        assert_eq!(parse_windows_proxy(""), None);
    }

    #[test]
    fn dsh_plugin_entry_validates_and_maps_cordis_shape() {
        let config = serde_json::json!({
            "module": "@example/dsh-plugin",
            "enabled": false,
            "config": { "workspace": "lab" },
        });
        let entry = dsh_plugin_entry("lab-notes", &config).unwrap();
        assert_eq!(entry["id"], "lab-notes");
        assert_eq!(entry["name"], "@example/dsh-plugin");
        assert_eq!(entry["disabled"], true);
        assert_eq!(entry["config"]["workspace"], "lab");

        assert!(dsh_plugin_entry("../escape", &config).is_err());
        assert!(dsh_plugin_entry("lab-notes", &serde_json::json!({ "module": "" })).is_err());
        assert!(dsh_plugin_entry(
            "lab-notes",
            &serde_json::json!({ "module": "@example/dsh-plugin", "config": [] }),
        )
        .is_err());
    }

    #[test]
    fn application_owned_dsh_modules_are_disabled() {
        let rows = application_owned_dsh_patch_rows();
        assert_eq!(rows.len(), 3);
        assert!(rows.iter().all(|row| row["disabled"] == true));
        assert_eq!(
            rows.iter()
                .map(|row| row["id"].as_str().unwrap())
                .collect::<Vec<_>>(),
            vec!["llm-deepseek", "web-search-deepseek", "tool-web"],
        );
    }

    #[test]
    fn plugin_specs_match_registry_git_and_link_forms() {
        assert_eq!(
            normalized_plugin_spec("git+https://github.com/omdsh-dev/dsh-genui.git#main"),
            "omdsh-dev/dsh-genui",
        );
        let row = serde_json::json!({
            "id": "@omdsh-dev/dsh-genui",
            "module": "@omdsh-dev/dsh-genui",
            "spec": "git+https://github.com/omdsh-dev/dsh-genui.git#main",
            "packageName": "@omdsh-dev/dsh-genui",
        });
        assert!(plugin_spec_matches(
            &row,
            "https://github.com/omdsh-dev/dsh-genui"
        ));
        assert!(plugin_spec_matches(&row, "@omdsh-dev/dsh-genui"));
        assert!(plugin_spec_matches(
            &serde_json::json!({
                "id": "@omdsh-dev/dsh-genui",
                "module": "@omdsh-dev/dsh-genui",
                "spec": "link:C:/work/dsh-genui-main",
            }),
            "C:/work/dsh-genui-main",
        ));
        assert!(!plugin_spec_matches(&row, "@someone/other-plugin"));
    }

    #[test]
    fn github_specs_have_https_tarball_fallbacks() {
        assert_eq!(
            github_tarball_specs("https://github.com/Azzygoatcoder/agent-useful-skills"),
            vec![
                "https://codeload.github.com/Azzygoatcoder/agent-useful-skills/tar.gz/refs/heads/main",
                "https://codeload.github.com/Azzygoatcoder/agent-useful-skills/tar.gz/refs/heads/master",
            ]
        );
        assert_eq!(
            github_tarball_specs("git+https://github.com/example/plugin.git#release"),
            vec!["https://codeload.github.com/example/plugin/tar.gz/refs/heads/release"]
        );
        assert!(github_tarball_specs("@example/plugin").is_empty());
    }

    #[test]
    fn default_web_profile_includes_app_owned_science_bundles() {
        let profile = default_dsh_web_profile();
        assert!(profile["dependencies"].get(BUNDLED_GENUI_PACKAGE).is_none());
        assert!(profile["dsh"]["profile"]["bundles"]
            .as_array()
            .unwrap()
            .iter()
            .any(|bundle| bundle.as_str() == Some(BUNDLED_GENUI_PACKAGE)));
        assert!(profile["dsh"]["profile"]["bundles"]
            .as_array()
            .unwrap()
            .iter()
            .any(|bundle| bundle.as_str() == Some(BUNDLED_VASPFLOW_PACKAGE)));
    }

    #[test]
    fn mcp_cleanup_removes_only_the_six_retired_connectors() {
        let mut state = DshModuleState {
            memory_enabled: true,
            mcp: [
                ("materials-mcp".into(), serde_json::json!({})),
                ("paper-search".into(), serde_json::json!({})),
                ("literature-ingest".into(), serde_json::json!({})),
                ("graphify".into(), serde_json::json!({})),
                ("browser-control".into(), serde_json::json!({})),
                ("custom-user-mcp".into(), serde_json::json!({})),
                ("biomcp".into(), serde_json::json!({})),
                ("novomcp".into(), serde_json::json!({})),
                ("fred".into(), serde_json::json!({})),
                ("spaceweather".into(), serde_json::json!({})),
                ("open-meteo".into(), serde_json::json!({})),
                ("usgs-water".into(), serde_json::json!({})),
            ]
            .into_iter()
            .collect(),
            plugins: std::collections::BTreeMap::new(),
        };

        assert!(sanitize_mcp_state(&mut state));
        assert_eq!(
            state.mcp.keys().map(String::as_str).collect::<Vec<_>>(),
            vec![
                "browser-control",
                "custom-user-mcp",
                "graphify",
                "literature-ingest",
                "materials-mcp",
                "paper-search",
            ]
        );
        assert!(!sanitize_mcp_state(&mut state));
        assert!(dsh_mcp_plugin(
            "novomcp",
            &serde_json::json!({
                "type": "remote",
                "url": "https://example.invalid/mcp"
            })
        )
        .is_err());
    }

    #[test]
    fn app_owned_profile_dependencies_are_removed_without_touching_third_party_plugins() {
        let mut profile = serde_json::json!({
            "dependencies": {
                BUNDLED_GENUI_PACKAGE: "0.8.3",
                "@example/plugin": "^1.2.3"
            }
        });

        assert!(remove_application_owned_profile_dependencies(&mut profile));
        assert!(profile["dependencies"].get(BUNDLED_GENUI_PACKAGE).is_none());
        assert_eq!(profile["dependencies"]["@example/plugin"], "^1.2.3");
        assert!(!remove_application_owned_profile_dependencies(&mut profile));
    }

    #[test]
    fn profile_bundle_repair_removes_missing_external_links() {
        let root = std::env::temp_dir().join(format!("os-profile-repair-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        let installed = root.join("node_modules").join("@example").join("installed");
        fs::create_dir_all(&installed).unwrap();
        fs::write(
            installed.join("package.json"),
            r#"{"name":"@example/installed","version":"1.0.0"}"#,
        )
        .unwrap();
        let genui = root
            .join("node_modules")
            .join("@omdsh-dev")
            .join("dsh-genui");
        fs::create_dir_all(&genui).unwrap();
        fs::write(genui.join("package.json"), b"{}\n").unwrap();

        let mut profile = serde_json::json!({
            "dependencies": {
                "@example/installed": "1.0.0",
                "@example/missing": "link:C:/a/developer/checkout"
            },
            "dsh": { "profile": { "bundles": [
                "@deepseek-ai/dsh-base",
                "@deepseek-ai/dsh-web-app",
                BUNDLED_GENUI_PACKAGE,
                "@example/installed",
                "@example/missing"
            ]}}
        });

        assert!(repair_dsh_profile_bundles(&root, &mut profile));
        let bundles = profile["dsh"]["profile"]["bundles"].as_array().unwrap();
        assert!(bundles
            .iter()
            .any(|bundle| bundle.as_str() == Some("@deepseek-ai/dsh-base")));
        assert!(bundles
            .iter()
            .any(|bundle| bundle.as_str() == Some("@deepseek-ai/dsh-web-app")));
        assert!(bundles
            .iter()
            .any(|bundle| bundle.as_str() == Some(BUNDLED_GENUI_PACKAGE)));
        assert!(bundles
            .iter()
            .any(|bundle| bundle.as_str() == Some("@example/installed")));
        assert!(!bundles
            .iter()
            .any(|bundle| bundle.as_str() == Some("@example/missing")));

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn plugin_failure_summary_prioritizes_pnpm_root_cause() {
        let output = "Lockfile passes supply-chain policies\n\
Progress: resolved 1, reused 0, downloaded 0\n\
[ERR_PNPM_FETCH_404] GET https://registry.npmjs.org/@example%2Fmissing: Not Found - 404\n\
This error happened while installing a direct dependency\n\
@example/missing is not in the npm registry\n\
dsh: pnpm failed in profile directory C:/profile";

        let summary = summarize_plugin_failure(output);
        assert!(summary.starts_with("[ERR_PNPM_FETCH_404]"));
        assert!(summary.contains("@example/missing is not in the npm registry"));
        assert!(!summary.contains("Progress: resolved"));
    }

    #[test]
    fn plugin_failure_summary_omits_progress_for_network_failures() {
        let output = "Lockfile passes supply-chain policies (verified 1h ago)\n\
Progress: resolved 1, reused 0, downloaded 0, added 0\n\
[WARN] HEAD https://github.com/omdsh-dev/dsh-genui error (ETIMEDOUT). Will retry\n\
dsh: pnpm failed in profile directory C:/profile";

        let summary = summarize_plugin_failure(output);
        assert!(summary.contains("ETIMEDOUT"));
        assert!(!summary.contains("Progress: resolved"));
        assert!(!summary.contains("Lockfile passes"));
    }

    #[test]
    fn scutil_proxy_parses_and_prefers_https() {
        // Real `scutil --proxy` shape (indented `Key : value` lines).
        let all = "<dictionary> {\n  HTTPEnable : 1\n  HTTPPort : 1087\n  HTTPProxy : 127.0.0.1\n  HTTPSEnable : 1\n  HTTPSPort : 1087\n  HTTPSProxy : 127.0.0.1\n  SOCKSEnable : 1\n  SOCKSPort : 1087\n  SOCKSProxy : 127.0.0.1\n}";
        assert_eq!(
            parse_scutil_proxy(all).as_deref(),
            Some("http://127.0.0.1:1087")
        );
        let socks_only = "  SOCKSEnable : 1\n  SOCKSPort : 7890\n  SOCKSProxy : 10.0.0.2\n";
        assert_eq!(
            parse_scutil_proxy(socks_only).as_deref(),
            Some("socks5://10.0.0.2:7890")
        );
        let disabled = "  HTTPEnable : 0\n  HTTPPort : 1087\n  HTTPProxy : 127.0.0.1\n";
        assert_eq!(parse_scutil_proxy(disabled), None);
        assert_eq!(parse_scutil_proxy(""), None);
    }

    #[test]
    fn prune_removes_only_stale_skill_dirs() {
        let dst = std::env::temp_dir().join(format!("os-prune-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dst);
        for name in ["remote-compute", "hpc-slurm"] {
            fs::create_dir_all(dst.join(name)).unwrap();
            fs::write(dst.join(name).join("SKILL.md"), b"---\n").unwrap();
            fs::write(dst.join(name).join(MANAGED_SKILL_MARKER), b"NebulaMat\n").unwrap();
        }
        // A directory without a SKILL.md must never be touched.
        fs::create_dir_all(dst.join("notes")).unwrap();

        let mut bundled = std::collections::HashSet::new();
        bundled.insert(std::ffi::OsString::from("remote-compute"));
        prune_stale_skills(&dst, &bundled);

        assert!(dst.join("remote-compute").is_dir(), "bundled skill kept");
        assert!(
            !dst.join("hpc-slurm").exists(),
            "stale renamed skill removed"
        );
        assert!(dst.join("notes").is_dir(), "non-skill dir left alone");
        let _ = fs::remove_dir_all(&dst);
    }

    #[test]
    fn prune_keeps_installed_user_skills() {
        // The reserved `user/` tree holds what the user installed — an app
        // upgrade (which prunes everything unbundled) must never delete it (#61).
        let dst = std::env::temp_dir().join(format!("os-prune-user-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dst);
        let installed = dst.join("my-skill");
        fs::create_dir_all(&installed).unwrap();
        fs::write(installed.join("SKILL.md"), b"---\nname: my-skill\n---\n").unwrap();
        // A SKILL.md directly inside `user/` (not a skill dir of its own) too.

        prune_stale_skills(&dst, &std::collections::HashSet::new());

        assert!(installed.join("SKILL.md").is_file(), "installed skill kept");
        let _ = fs::remove_dir_all(&dst);
    }

    #[test]
    fn skill_name_comes_from_frontmatter_and_is_safe() {
        assert_eq!(
            skill_name_from_markdown("---\nname: my-skill\ndescription: x\n---\n\nbody\n")
                .as_deref(),
            Some("my-skill"),
        );
        // Quoted, CRLF, and a leading BOM all still parse.
        assert_eq!(
            skill_name_from_markdown("\u{feff}---\r\nname: \"quoted_1\"\r\n---\r\n").as_deref(),
            Some("quoted_1"),
        );
        // Not a skill file, or a name that cannot be a directory.
        assert_eq!(skill_name_from_markdown("# just markdown\n"), None);
        assert_eq!(skill_name_from_markdown("---\ndescription: x\n---\n"), None);
        assert_eq!(
            skill_name_from_markdown("---\nname: ../escape\n---\n"),
            None
        );
        assert_eq!(skill_name_from_markdown("---\nname: sub/dir\n---\n"), None);
        assert_eq!(skill_name_from_markdown("---\nname: .hidden\n---\n"), None);
        assert_eq!(skill_name_from_markdown("---\nname:\n---\n"), None);
    }

    #[test]
    fn workspace_skill_dirs_lists_only_real_skills() {
        let ws = std::env::temp_dir().join(format!("os-ws-skills-{}", std::process::id()));
        let _ = fs::remove_dir_all(&ws);
        let root = ws.join(".dsh").join("skills");
        fs::create_dir_all(root.join("installed")).unwrap();
        fs::write(root.join("installed").join("SKILL.md"), b"---\n").unwrap();
        fs::create_dir_all(root.join("half-written")).unwrap(); // no SKILL.md yet
        fs::write(root.join("loose.md"), b"---\n").unwrap();

        let found = workspace_skill_dirs(&ws);
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].file_name().unwrap(), "installed");
        // A workspace with no .dsh/skills at all is simply empty.
        assert!(workspace_skill_dirs(&std::env::temp_dir().join("os-nope")).is_empty());
        let _ = fs::remove_dir_all(&ws);
    }

    #[cfg(unix)]
    #[test]
    fn tighten_private_makes_dir_and_secrets_owner_only() {
        use std::os::unix::fs::PermissionsExt;
        let dir = std::env::temp_dir().join(format!("os-private-{}", std::process::id()));
        let sub = dir.join("dsh-home");
        fs::create_dir_all(&sub).unwrap();
        let cfg = sub.join("credentials.json");
        fs::write(&cfg, b"{\"apiKey\":\"secret\"}").unwrap();
        fs::set_permissions(&dir, fs::Permissions::from_mode(0o755)).unwrap();
        fs::set_permissions(&cfg, fs::Permissions::from_mode(0o644)).unwrap();

        // runtime root holds provider/connector keys — it must be unreadable
        // to other users even when the
        // sidecar later rewrites files inside with a default umask.
        super::tighten_private(&dir);
        assert_eq!(
            fs::metadata(&dir).unwrap().permissions().mode() & 0o777,
            0o700
        );
        super::tighten_private(&cfg);
        assert_eq!(
            fs::metadata(&cfg).unwrap().permissions().mode() & 0o777,
            0o600
        );

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn random_hex_is_csprng_shaped() {
        // 16 bytes → 32 hex chars, fresh per call — the shape the sidecar
        // password and the preview/Jupyter tokens rely on.
        let a = random_hex(16);
        let b = random_hex(16);
        assert_eq!(a.len(), 32);
        assert!(a.bytes().all(|c| c.is_ascii_hexdigit()));
        assert_ne!(a, b, "two draws must differ");
    }

    fn write(path: &std::path::Path, content: &str) {
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, content).unwrap();
    }

    #[test]
    fn sync_replaces_bundled_and_keeps_user_skills() {
        let tmp = std::env::temp_dir().join(format!("skillsync-{}", std::process::id()));
        let _ = fs::remove_dir_all(&tmp);
        let src = tmp.join("src");
        let dst = tmp.join("dst");

        // Bundled pack: one skill with a nested reference file, plus a top-level
        // plain file (.commit) that must NOT be copied.
        write(&src.join("paper-writer/SKILL.md"), "v2");
        write(&src.join("paper-writer/references/guide.md"), "ref");
        write(&src.join("my-skill/SKILL.md"), "bundled collision");
        write(&src.join(".commit"), "abc123");
        // A placeholder dir without SKILL.md must not be deployed.
        fs::create_dir_all(src.join("placeholder")).unwrap();

        // Existing workspace: a stale copy of the bundled skill (with a file the
        // new version no longer has) and a user-installed skill.
        write(&dst.join("paper-writer/SKILL.md"), "v1");
        write(&dst.join("paper-writer/obsolete.md"), "old");
        write(
            &dst.join("paper-writer").join(MANAGED_SKILL_MARKER),
            "NebulaMat\n",
        );
        write(&dst.join("my-skill/SKILL.md"), "user");

        sync_skill_pack(&src, &dst).unwrap();

        assert_eq!(
            fs::read_to_string(dst.join("paper-writer/SKILL.md")).unwrap(),
            "v2"
        );
        assert_eq!(
            fs::read_to_string(dst.join("paper-writer/references/guide.md")).unwrap(),
            "ref"
        );
        assert!(
            !dst.join("paper-writer/obsolete.md").exists(),
            "stale file must be gone"
        );
        assert!(dst
            .join("paper-writer")
            .join(MANAGED_SKILL_MARKER)
            .is_file());
        assert_eq!(
            fs::read_to_string(dst.join("my-skill/SKILL.md")).unwrap(),
            "user"
        );
        assert!(
            !dst.join(".commit").exists(),
            "top-level files are not skills"
        );
        assert!(
            !dst.join("placeholder").exists(),
            "dirs without SKILL.md are not skills"
        );

        fs::remove_dir_all(&tmp).unwrap();
    }

    #[test]
    fn sync_creates_destination_when_missing() {
        let tmp = std::env::temp_dir().join(format!("skillsync-new-{}", std::process::id()));
        let _ = fs::remove_dir_all(&tmp);
        let src = tmp.join("src");
        write(&src.join("literature-survey/SKILL.md"), "s");

        let dst = tmp.join("deep/nested/skills");
        sync_skill_pack(&src, &dst).unwrap();
        assert_eq!(
            fs::read_to_string(dst.join("literature-survey/SKILL.md")).unwrap(),
            "s"
        );
        fs::remove_dir_all(&tmp).unwrap();
    }

    #[test]
    fn managed_support_sync_replaces_only_app_owned_directories() {
        let tmp = std::env::temp_dir().join(format!("support-sync-{}", std::process::id()));
        let _ = fs::remove_dir_all(&tmp);
        let src = tmp.join("src");
        let managed = tmp.join("managed");
        let user = tmp.join("user");
        write(&src.join("guide.md"), "upstream");
        write(&managed.join("guide.md"), "old");
        write(&managed.join(MANAGED_SKILL_MARKER), "NebulaMat\n");
        write(&user.join("guide.md"), "user");

        sync_managed_support_dir(&src, &managed).unwrap();
        sync_managed_support_dir(&src, &user).unwrap();

        assert_eq!(
            fs::read_to_string(managed.join("guide.md")).unwrap(),
            "upstream"
        );
        assert!(managed.join(MANAGED_SKILL_MARKER).is_file());
        assert_eq!(fs::read_to_string(user.join("guide.md")).unwrap(), "user");
        assert!(!user.join(MANAGED_SKILL_MARKER).exists());
        fs::remove_dir_all(&tmp).unwrap();
    }

    #[test]
    fn aicc_collection_rewrites_shared_references_at_the_deployed_root() {
        let tmp = std::env::temp_dir().join(format!("aicc-collection-{}", std::process::id()));
        let _ = fs::remove_dir_all(&tmp);
        let src = tmp.join("resource");
        let dst = tmp.join("profile/aicc");
        write(&src.join(".commit"), "abc123\n");
        write(&src.join("knowledge/electronic-structure.md"), "knowledge");
        write(
            &src.join("tools/vasp/SKILL.md"),
            "Read `knowledge/electronic-structure.md`, `tools/vasp/references/running.md`, and `AGENTS.md`. Keep https://example.org/vtsttools/ unchanged.",
        );
        write(&src.join("tools/vasp/references/running.md"), "running");

        prepare_aicc_collection(&src, &dst).unwrap();

        let skill = fs::read_to_string(dst.join("tools/vasp/SKILL.md")).unwrap();
        let root = dst.to_string_lossy().replace('\\', "/");
        assert!(skill.contains(&format!("{root}/knowledge/electronic-structure.md")));
        assert!(skill.contains(&format!("{root}/tools/vasp/references/running.md")));
        assert!(skill.contains(&format!("{root}/AGENTS.md")));
        assert!(skill.contains("https://example.org/vtsttools/"));
        assert_eq!(
            fs::read_to_string(dst.join(".nebulamat-ready")).unwrap(),
            "abc123:1\n"
        );
        fs::remove_dir_all(&tmp).unwrap();
    }

    #[test]
    fn aicc_deploys_only_the_selected_tool_skills() {
        let tmp = std::env::temp_dir().join(format!("aicc-skills-{}", std::process::id()));
        let _ = fs::remove_dir_all(&tmp);
        let src = tmp.join("tools");
        let dst = tmp.join("skills");
        write(&src.join("vasp/SKILL.md"), "vasp");
        write(&src.join("hpc-submit/SKILL.md"), "upstream hpc");
        write(&dst.join("remote-compute/SKILL.md"), "nebulamat");

        let deployed = sync_selected_skill_pack(&src, &dst, &["vasp"]).unwrap();

        assert_eq!(deployed, vec![std::ffi::OsString::from("vasp")]);
        assert!(dst.join("vasp/SKILL.md").is_file());
        assert!(!dst.join("hpc-submit").exists());
        assert_eq!(
            fs::read_to_string(dst.join("remote-compute/SKILL.md")).unwrap(),
            "nebulamat"
        );
        fs::remove_dir_all(&tmp).unwrap();
    }
}

#[derive(Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct DshModuleState {
    #[serde(default = "default_memory_enabled")]
    memory_enabled: bool,
    #[serde(default)]
    mcp: std::collections::BTreeMap<String, serde_json::Value>,
    #[serde(default)]
    plugins: std::collections::BTreeMap<String, serde_json::Value>,
}

/// Connectors removed from NebulaMat's catalog. Persisted module state can
/// outlive an app release, so delete only these explicitly retired entries at
/// startup while preserving every material, literature, browser, notebook,
/// plugin-owned, and user-added MCP.
const REMOVED_MCP_NAMES: &[&str] = &[
    "biomcp",
    "novomcp",
    "fred",
    "spaceweather",
    "open-meteo",
    "usgs-water",
];

fn is_removed_mcp_name(name: &str) -> bool {
    REMOVED_MCP_NAMES.iter().any(|removed| *removed == name)
}

fn sanitize_mcp_state(state: &mut DshModuleState) -> bool {
    let before = state.mcp.len();
    state.mcp.retain(|name, _| !is_removed_mcp_name(name));
    state.mcp.len() != before
}

impl Default for DshModuleState {
    fn default() -> Self {
        Self {
            memory_enabled: true,
            mcp: std::collections::BTreeMap::new(),
            plugins: std::collections::BTreeMap::new(),
        }
    }
}

fn default_memory_enabled() -> bool {
    true
}

fn dsh_module_state_file(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(dsh_home(app)?.join("nebulamat-modules.json"))
}

fn read_dsh_module_state(app: &AppHandle) -> DshModuleState {
    let mut state = dsh_module_state_file(app)
        .ok()
        .and_then(|path| std::fs::read_to_string(path).ok())
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_default();
    sanitize_mcp_state(&mut state);
    state
}

fn validate_mcp_name(name: &str) -> Result<(), String> {
    let valid = !name.is_empty()
        && name.len() <= 32
        && name
            .bytes()
            .all(|value| value.is_ascii_alphanumeric() || matches!(value, b'-' | b'_'));
    valid
        .then_some(())
        .ok_or_else(|| "DSH MCP server names must match [A-Za-z0-9_-]{1,32}".to_string())
}

fn validate_dsh_plugin_id(id: &str) -> Result<(), String> {
    let valid = !id.is_empty()
        && id.len() <= 64
        && id
            .bytes()
            .all(|value| value.is_ascii_alphanumeric() || matches!(value, b'-' | b'_' | b'.'));
    valid
        .then_some(())
        .ok_or_else(|| "DSH plugin ids must match [A-Za-z0-9_.-]{1,64}".to_string())
}

fn dsh_plugin_entry(id: &str, config: &serde_json::Value) -> Result<serde_json::Value, String> {
    validate_dsh_plugin_id(id)?;
    let module = config
        .get("module")
        .and_then(serde_json::Value::as_str)
        .map(str::trim)
        .filter(|module| !module.is_empty() && module.len() <= 256)
        .ok_or("DSH plugin needs a module/package spec")?;
    if module.chars().any(char::is_control) {
        return Err("DSH plugin module cannot contain control characters".into());
    }
    let plugin_config = config
        .get("config")
        .cloned()
        .unwrap_or_else(|| serde_json::json!({}));
    if !plugin_config.is_object() {
        return Err("DSH plugin config must be a JSON object".into());
    }
    let enabled = config.get("enabled").and_then(serde_json::Value::as_bool) != Some(false);
    Ok(serde_json::json!({
        "id": id,
        "name": module,
        "disabled": !enabled,
        "config": plugin_config,
    }))
}

fn dsh_mcp_plugin(name: &str, config: &serde_json::Value) -> Result<serde_json::Value, String> {
    validate_mcp_name(name)?;
    if is_removed_mcp_name(name) {
        return Err(format!("MCP server \"{name}\" was removed from NebulaMat"));
    }
    let enabled = config.get("enabled").and_then(serde_json::Value::as_bool) != Some(false);
    let plugin_config = match config.get("type").and_then(serde_json::Value::as_str) {
        Some("local") => {
            let command = config
                .get("command")
                .and_then(serde_json::Value::as_array)
                .ok_or("local MCP config needs a command array")?;
            let mut command = command.iter().map(|part| {
                part.as_str()
                    .filter(|part| !part.is_empty())
                    .map(str::to_owned)
                    .ok_or_else(|| {
                        "local MCP command entries must be non-empty strings".to_string()
                    })
            });
            let executable = command
                .next()
                .ok_or("local MCP command cannot be empty")??;
            let args: Result<Vec<_>, _> = command.collect();
            let mut value = serde_json::json!({
                "serverName": name,
                "transport": "stdio",
                "command": executable,
                "args": args?,
            });
            if let Some(environment) = config
                .get("environment")
                .and_then(serde_json::Value::as_object)
            {
                value["env"] = serde_json::Value::Object(environment.clone());
            }
            value
        }
        Some("remote") => {
            let url = config
                .get("url")
                .and_then(serde_json::Value::as_str)
                .filter(|url| url.starts_with("http://") || url.starts_with("https://"))
                .ok_or("remote MCP config needs an http(s) URL")?;
            let mut value = serde_json::json!({
                "serverName": name,
                "transport": "streamable-http",
                "url": url,
            });
            if let Some(headers) = config.get("headers").and_then(serde_json::Value::as_object) {
                value["headers"] = serde_json::Value::Object(headers.clone());
            }
            value
        }
        _ => return Err("MCP config type must be local or remote".into()),
    };
    Ok(serde_json::json!({
        "id": format!("nebulamat-mcp-{name}"),
        "name": "@deepseek-ai/dsh-mcp-client",
        "disabled": !enabled,
        "config": plugin_config,
    }))
}

fn write_dsh_module_state(app: &AppHandle, state: &DshModuleState) -> Result<(), String> {
    let mut state = state.clone();
    sanitize_mcp_state(&mut state);
    let home = dsh_home(app)?;
    std::fs::create_dir_all(&home).map_err(|e| e.to_string())?;
    let state_text = serde_json::to_string_pretty(&state).map_err(|e| e.to_string())?;
    std::fs::write(dsh_module_state_file(app)?, format!("{state_text}\n"))
        .map_err(|e| e.to_string())?;

    let mut patches = Vec::new();
    // The application uses the browser-control MCP for web research. Disable
    // the built-in DeepSeek model/search path so it cannot register
    // `web_search` or `web_fetch` in the model tool catalog. Keep the abstract
    // `web` capability row mounted for profile compatibility; it is inert
    // without its provider and model-facing tool registration.
    patches.extend(application_owned_dsh_patch_rows());
    if !state.memory_enabled {
        patches.push(serde_json::json!({ "id": "agent-instructions", "disabled": true }));
    }
    if !state.mcp.is_empty() {
        let plugins: Result<Vec<_>, _> = state
            .mcp
            .iter()
            .map(|(name, config)| dsh_mcp_plugin(name, config))
            .collect();
        patches.push(serde_json::json!({ "insert": plugins? }));
    }
    if !state.plugins.is_empty() {
        let plugins: Result<Vec<_>, _> = state
            .plugins
            .iter()
            .map(|(id, config)| dsh_plugin_entry(id, config))
            .collect();
        patches.push(serde_json::json!({ "insert": plugins? }));
    }
    if home
        .join("profiles")
        .join("web")
        .join("nebulamat-tool-governance/package.json")
        .is_file()
    {
        patches.push(serde_json::json!({
            "insert": [{
                "id": "nebulamat-tool-governance",
                // The loader uses native ESM imports for relative entries and
                // does not apply package-directory main resolution.
                "name": "./nebulamat-tool-governance/index.js",
                "config": {}
            }]
        }));
    }
    if home
        .join("profiles")
        .join("web")
        .join("node_modules/dsh-cost-meter/package.json")
        .is_file()
    {
        patches.push(serde_json::json!({
            "insert": [{
                "id": "nebulamat-cost-meter",
                "name": "dsh-cost-meter",
                "config": {}
            }]
        }));
    }
    let patch_text = serde_json::to_string_pretty(&patches).map_err(|e| e.to_string())?;
    std::fs::write(home.join("cordis.patch.yml"), format!("{patch_text}\n"))
        .map_err(|e| e.to_string())?;
    tighten_private(&home);
    Ok(())
}

fn application_owned_dsh_patch_rows() -> Vec<serde_json::Value> {
    ["llm-deepseek", "web-search-deepseek", "tool-web"]
        .into_iter()
        .map(|id| serde_json::json!({ "id": id, "disabled": true }))
        .collect()
}

fn dsh_web_profile_dir(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(dsh_home(app)?.join("profiles").join("web"))
}

fn read_dsh_web_profile(app: &AppHandle) -> Result<(PathBuf, serde_json::Value), String> {
    let path = dsh_web_profile_dir(app)?.join("package.json");
    let text = std::fs::read_to_string(&path)
        .map_err(|e| format!("could not read DSH web profile: {e}"))?;
    let value = serde_json::from_str(&text).map_err(|e| format!("invalid DSH web profile: {e}"))?;
    Ok((path, value))
}

const BUNDLED_GENUI_PACKAGE: &str = "@omdsh-dev/dsh-genui";
const BUNDLED_VASPFLOW_PACKAGE: &str = "dsh-vaspflow";

fn default_dsh_web_profile() -> serde_json::Value {
    serde_json::json!({
        "name": "dsh-profile-web",
        "private": true,
        "dependencies": {
            "@deepseek-ai/dsh-base": "0.1.0-rc.6",
            "@deepseek-ai/dsh-web-app": "0.1.0-rc.6"
        },
        "dsh": {
            "profile": {
                "bundles": [
                    "@deepseek-ai/dsh-base",
                    "@deepseek-ai/dsh-web-app",
                    BUNDLED_GENUI_PACKAGE,
                    BUNDLED_VASPFLOW_PACKAGE
                ]
            }
        }
    })
}

/// App-owned packages are deployed directly into the profile's node_modules.
/// They must not also look like registry dependencies: pnpm re-resolves every
/// direct dependency when adding a plugin, and unpublished bundled packages
/// would make all otherwise-valid installs fail with ERR_PNPM_FETCH_404.
fn remove_application_owned_profile_dependencies(profile: &mut serde_json::Value) -> bool {
    let Some(dependencies) = profile
        .get_mut("dependencies")
        .and_then(serde_json::Value::as_object_mut)
    else {
        return false;
    };
    let removed_genui = dependencies.remove(BUNDLED_GENUI_PACKAGE).is_some();
    let removed_vaspflow = dependencies.remove(BUNDLED_VASPFLOW_PACKAGE).is_some();
    removed_genui || removed_vaspflow
}

/// Remove only profile bundles whose package manifest is unavailable. DSH
/// resolves every enabled bundle before it starts the HTTP server, so a stale
/// local link must never be allowed to take down the whole desktop runtime.
fn repair_dsh_profile_bundles(profile_dir: &Path, profile: &mut serde_json::Value) -> bool {
    let dependencies = profile
        .get("dependencies")
        .and_then(serde_json::Value::as_object)
        .cloned()
        .unwrap_or_default();
    let Some(bundles) = profile
        .get_mut("dsh")
        .and_then(serde_json::Value::as_object_mut)
        .and_then(|dsh| dsh.get_mut("profile"))
        .and_then(serde_json::Value::as_object_mut)
        .and_then(|meta| meta.get_mut("bundles"))
        .and_then(serde_json::Value::as_array_mut)
    else {
        return false;
    };

    let mut changed = false;
    let mut kept = Vec::with_capacity(bundles.len());
    for bundle in bundles.iter() {
        let Some(name) = bundle.as_str() else {
            changed = true;
            continue;
        };
        let builtin = matches!(name, "@deepseek-ai/dsh-base" | "@deepseek-ai/dsh-web-app");
        let app_owned = matches!(name, BUNDLED_GENUI_PACKAGE | BUNDLED_VASPFLOW_PACKAGE);
        let installed = profile_package_dir(profile_dir, name)
            .join("package.json")
            .is_file();
        if builtin || (app_owned && installed) || (dependencies.contains_key(name) && installed) {
            kept.push(bundle.clone());
        } else {
            changed = true;
            eprintln!("disabling unavailable DSH profile bundle {name}");
        }
    }
    if changed {
        *bundles = kept;
    }
    changed
}

/// Make the web profile self-contained enough for the packaged app. Existing
/// user dependencies remain intact. Bundled GenUI stays a profile layer but is
/// not a pnpm dependency because the app deploys it directly into node_modules.
fn ensure_dsh_web_profile(app: &AppHandle) -> Result<(), String> {
    let profile_dir = dsh_web_profile_dir(app)?;
    std::fs::create_dir_all(&profile_dir).map_err(|error| error.to_string())?;
    let path = profile_dir.join("package.json");
    let mut profile = match std::fs::read_to_string(&path) {
        Ok(text) => serde_json::from_str(&text).unwrap_or_else(|error| {
            eprintln!("resetting malformed DSH web profile: {error}");
            default_dsh_web_profile()
        }),
        Err(_) => default_dsh_web_profile(),
    };
    let mut changed = remove_application_owned_profile_dependencies(&mut profile);
    let object = profile
        .as_object_mut()
        .ok_or("DSH web profile must be a JSON object")?;
    let dependencies = object
        .entry("dependencies")
        .or_insert_with(|| serde_json::json!({}));
    if !dependencies.is_object() {
        *dependencies = serde_json::json!({});
        changed = true;
    }
    let dsh = object.entry("dsh").or_insert_with(|| serde_json::json!({}));
    let profile_meta = dsh
        .as_object_mut()
        .ok_or("DSH web profile dsh section must be an object")?
        .entry("profile")
        .or_insert_with(|| serde_json::json!({}));
    let bundles = profile_meta
        .as_object_mut()
        .ok_or("DSH web profile metadata must be an object")?
        .entry("bundles")
        .or_insert_with(|| serde_json::json!([]));
    if !bundles.is_array() {
        *bundles = serde_json::json!([]);
        changed = true;
    }
    let bundle_list = bundles.as_array_mut().unwrap();
    if !bundle_list
        .iter()
        .any(|bundle| bundle.as_str() == Some(BUNDLED_GENUI_PACKAGE))
    {
        bundle_list.push(serde_json::Value::String(BUNDLED_GENUI_PACKAGE.into()));
        changed = true;
    }
    if !bundle_list
        .iter()
        .any(|bundle| bundle.as_str() == Some(BUNDLED_VASPFLOW_PACKAGE))
    {
        bundle_list.push(serde_json::Value::String(BUNDLED_VASPFLOW_PACKAGE.into()));
        changed = true;
    }
    changed |= repair_dsh_profile_bundles(&profile_dir, &mut profile);
    if changed {
        let text = serde_json::to_string_pretty(&profile).map_err(|error| error.to_string())?;
        std::fs::write(&path, format!("{text}\n")).map_err(|error| error.to_string())?;
        tighten_private(&path);
    }
    Ok(())
}

fn profile_package_dir(profile: &Path, package_name: &str) -> PathBuf {
    package_name
        .split('/')
        .fold(profile.join("node_modules"), |path, part| path.join(part))
}

/// Compare a user supplied package/path/Git spec with the dependency entry
/// DSH wrote into the profile. The CLI normalizes these differently depending
/// on the source (`link:`, `git+https:`, a GitHub shorthand, or a registry
/// name), so a literal equality check makes a successful install look broken.
fn normalized_plugin_spec(value: &str) -> String {
    let mut value = value.trim().replace('\\', "/");
    for prefix in ["git+", "git:", "link:", "file:", "github:"] {
        if let Some(stripped) = value.strip_prefix(prefix) {
            value = stripped.to_string();
            break;
        }
    }
    if let Some(hash) = value.find('#') {
        value.truncate(hash);
    }
    while value.ends_with('/') {
        value.pop();
    }
    if value.ends_with(".git") {
        value.truncate(value.len() - 4);
    }
    if let Some((_, github_path)) = value.split_once("github.com/") {
        return github_path.trim_matches('/').to_ascii_lowercase();
    }
    value.to_ascii_lowercase()
}

fn plugin_spec_matches(row: &serde_json::Value, requested: &str) -> bool {
    let requested_trimmed = requested.trim();
    let requested_normalized = normalized_plugin_spec(requested_trimmed);
    let requested_tail = requested_normalized
        .rsplit('/')
        .next()
        .unwrap_or(&requested_normalized);
    ["id", "module", "packageName", "spec"]
        .into_iter()
        .filter_map(|key| row.get(key).and_then(serde_json::Value::as_str))
        .any(|candidate| {
            if candidate == requested_trimmed {
                return true;
            }
            let candidate_normalized = normalized_plugin_spec(candidate);
            candidate_normalized == requested_normalized
                || (!requested_tail.is_empty()
                    && candidate_normalized
                        .rsplit('/')
                        .next()
                        .is_some_and(|tail| tail == requested_tail))
        })
}

fn profile_plugin_rows(app: &AppHandle) -> Result<Vec<serde_json::Value>, String> {
    let Ok((_, profile)) = read_dsh_web_profile(app) else {
        return Ok(Vec::new());
    };
    let Some(dependencies) = profile
        .get("dependencies")
        .and_then(serde_json::Value::as_object)
    else {
        return Ok(Vec::new());
    };
    let profile_dir = dsh_web_profile_dir(app)?;
    let bundles = profile
        .get("dsh")
        .and_then(|dsh| dsh.get("profile"))
        .and_then(|profile| profile.get("bundles"))
        .and_then(serde_json::Value::as_array)
        .cloned()
        .unwrap_or_default();
    let enabled = |name: &str| bundles.iter().any(|bundle| bundle.as_str() == Some(name));
    let mut rows = Vec::new();
    for (package_name, spec) in dependencies {
        let package_dir = profile_package_dir(&profile_dir, package_name);
        let manifest = std::fs::read_to_string(package_dir.join("package.json"))
            .ok()
            .and_then(|text| serde_json::from_str::<serde_json::Value>(&text).ok())
            .unwrap_or_else(|| serde_json::json!({}));
        let dsh = manifest
            .get("dsh")
            .cloned()
            .unwrap_or_else(|| serde_json::json!({}));
        let is_bundle = dsh
            .get("bundle")
            .and_then(|bundle| bundle.get("patch"))
            .is_some();
        let has_client = dsh.get("client").is_some();
        let has_skill = package_dir.join("SKILL.md").is_file();
        if !(is_bundle || has_client || has_skill) {
            continue;
        }
        rows.push(serde_json::json!({
            "id": package_name,
            "module": package_name,
            "packageName": package_name,
            "spec": spec,
            "enabled": enabled(package_name),
            "installed": true,
            "bundle": is_bundle,
            "client": has_client,
            "skill": has_skill,
            "config": {},
        }));
    }
    Ok(rows)
}

/// Return an app-owned bundle that is deployed directly into the profile.
/// Such packages intentionally do not appear in `package.json` (pnpm would
/// try to resolve the unpublished registry package), but an install request
/// for the same GitHub/package spec should still be idempotent.
fn bundled_plugin_row(
    app: &AppHandle,
    requested: &str,
) -> Result<Option<serde_json::Value>, String> {
    if !plugin_spec_matches(
        &serde_json::json!({
            "id": BUNDLED_GENUI_PACKAGE,
            "module": BUNDLED_GENUI_PACKAGE,
            "packageName": BUNDLED_GENUI_PACKAGE,
            "spec": "https://github.com/omdsh-dev/dsh-genui",
        }),
        requested,
    ) {
        return Ok(None);
    }
    let profile_dir = dsh_web_profile_dir(app)?;
    let package_dir = profile_package_dir(&profile_dir, BUNDLED_GENUI_PACKAGE);
    if !package_dir.join("package.json").is_file() {
        return Ok(None);
    }
    let profile = read_dsh_web_profile(app).ok().map(|(_, value)| value);
    let enabled = profile
        .as_ref()
        .and_then(|value| value.get("dsh"))
        .and_then(|value| value.get("profile"))
        .and_then(|value| value.get("bundles"))
        .and_then(serde_json::Value::as_array)
        .is_some_and(|bundles| {
            bundles
                .iter()
                .any(|bundle| bundle.as_str() == Some(BUNDLED_GENUI_PACKAGE))
        });
    let manifest = std::fs::read_to_string(package_dir.join("package.json"))
        .ok()
        .and_then(|text| serde_json::from_str::<serde_json::Value>(&text).ok())
        .unwrap_or_default();
    Ok(Some(serde_json::json!({
        "id": BUNDLED_GENUI_PACKAGE,
        "module": BUNDLED_GENUI_PACKAGE,
        "packageName": BUNDLED_GENUI_PACKAGE,
        "spec": requested,
        "enabled": enabled,
        "installed": true,
        "bundle": manifest.get("dsh").and_then(|dsh| dsh.get("bundle")).is_some(),
        "client": manifest.get("dsh").and_then(|dsh| dsh.get("client")).is_some(),
        "skill": package_dir.join("SKILL.md").is_file(),
        "config": {},
    })))
}

fn update_profile_bundle(
    app: &AppHandle,
    package_name: &str,
    enabled: bool,
) -> Result<bool, String> {
    let (path, mut profile) = read_dsh_web_profile(app)?;
    let Some(dependencies) = profile
        .get("dependencies")
        .and_then(serde_json::Value::as_object)
    else {
        return Ok(false);
    };
    if !dependencies.contains_key(package_name) {
        return Ok(false);
    }
    let dsh = profile
        .as_object_mut()
        .unwrap()
        .entry("dsh")
        .or_insert_with(|| serde_json::json!({}));
    let profile_meta = dsh
        .as_object_mut()
        .unwrap()
        .entry("profile")
        .or_insert_with(|| serde_json::json!({}));
    let bundles = profile_meta
        .as_object_mut()
        .unwrap()
        .entry("bundles")
        .or_insert_with(|| serde_json::json!([]));
    let list = bundles
        .as_array_mut()
        .ok_or("DSH profile bundles must be an array")?;
    list.retain(|bundle| bundle.as_str() != Some(package_name));
    if enabled {
        list.push(serde_json::Value::String(package_name.to_string()));
    }
    let text = serde_json::to_string_pretty(&profile).map_err(|e| e.to_string())?;
    std::fs::write(path, format!("{text}\n")).map_err(|e| e.to_string())?;
    Ok(true)
}

fn plugin_path() -> String {
    let separator = if cfg!(windows) { ';' } else { ':' };
    let mut parts = vec![enriched_path()];
    let mut candidates = Vec::new();
    if let Ok(pnpm_home) = std::env::var("PNPM_HOME") {
        candidates.push(PathBuf::from(&pnpm_home));
        candidates.push(PathBuf::from(pnpm_home).join("bin"));
    }
    if let Ok(local_app_data) = std::env::var("LOCALAPPDATA") {
        let pnpm_home = PathBuf::from(local_app_data).join("pnpm");
        candidates.push(pnpm_home.clone());
        candidates.push(pnpm_home.join("bin"));
    }
    if let Ok(user_profile) = std::env::var("USERPROFILE") {
        let pnpm_home = PathBuf::from(user_profile)
            .join("AppData")
            .join("Local")
            .join("pnpm");
        candidates.push(pnpm_home.clone());
        candidates.push(pnpm_home.join("bin"));
    }
    if let Ok(home) = std::env::var("HOME") {
        candidates.push(
            PathBuf::from(&home)
                .join(".local")
                .join("share")
                .join("pnpm"),
        );
        candidates.push(PathBuf::from(&home).join(".local").join("bin"));
    }
    for candidate in candidates {
        if candidate.is_dir() {
            parts.push(candidate.to_string_lossy().into_owned());
        }
    }
    parts.join(&separator.to_string())
}

/// Convert a GitHub repository spec into tarball specs. Git transport is
/// frequently unavailable in desktop environments even when HTTPS downloads
/// work; codeload tarballs preserve the package manifest while avoiding a Git
/// subprocess and its network/credential requirements.
fn github_tarball_specs(spec: &str) -> Vec<String> {
    let mut value = spec.trim();
    for prefix in ["git+", "git:"] {
        if let Some(stripped) = value.strip_prefix(prefix) {
            value = stripped;
            break;
        }
    }
    let path = if let Some(path) = value.strip_prefix("github:") {
        path
    } else if let Some((_, path)) = value.split_once("github.com/") {
        path
    } else {
        return Vec::new();
    };
    let path = path
        .split(['?', '#'])
        .next()
        .unwrap_or(path)
        .trim_matches('/');
    let mut segments = path.split('/');
    let (Some(owner), Some(repository)) = (segments.next(), segments.next()) else {
        return Vec::new();
    };
    if owner.is_empty() || repository.is_empty() || segments.next().is_some() {
        return Vec::new();
    }
    let repository = repository.strip_suffix(".git").unwrap_or(repository);
    let branch = value
        .split_once('#')
        .map(|(_, value)| value.trim())
        .filter(|value| !value.is_empty());
    let branches: Vec<&str> = branch.map_or_else(|| vec!["main", "master"], |value| vec![value]);
    branches
        .into_iter()
        .map(|branch| {
            format!("https://codeload.github.com/{owner}/{repository}/tar.gz/refs/heads/{branch}")
        })
        .collect()
}

fn summarize_plugin_failure(details: &str) -> String {
    let lines: Vec<_> = details.lines().collect();
    if let Some(index) = lines
        .iter()
        .position(|line| line.contains("ERR_PNPM_") || line.contains("[ERR_"))
    {
        let summary = lines[index..]
            .iter()
            .filter(|line| {
                let lower = line.to_ascii_lowercase();
                !line.trim().is_empty()
                    && !lower.starts_with("progress:")
                    && !lower.contains("lockfile passes supply-chain policies")
            })
            .take(8)
            .copied()
            .collect::<Vec<_>>()
            .join("\n");
        if !summary.is_empty() {
            return summary;
        }
    }
    let meaningful: Vec<_> = lines
        .iter()
        .filter(|line| {
            let lower = line.to_ascii_lowercase();
            !line.trim().is_empty()
                && !lower.starts_with("progress:")
                && !lower.contains("lockfile passes supply-chain policies")
                && (line.contains("ERR_PNPM_")
                    || line.contains("[ERR_")
                    || [
                        "error",
                        "failed",
                        "fatal",
                        "econn",
                        "etimedout",
                        "not found",
                        "blocked",
                        "allowbuilds",
                        "git-hosted",
                        "denied",
                        "unable",
                        "cannot",
                        "invalid",
                    ]
                    .iter()
                    .any(|needle| lower.contains(needle)))
        })
        .copied()
        .collect();
    if !meaningful.is_empty() {
        return meaningful
            .iter()
            .rev()
            .take(8)
            .copied()
            .collect::<Vec<_>>()
            .into_iter()
            .rev()
            .collect::<Vec<_>>()
            .join("\n");
    }
    let tail = lines
        .iter()
        .filter(|line| {
            let lower = line.to_ascii_lowercase();
            !lower.starts_with("progress:")
                && !lower.contains("lockfile passes supply-chain policies")
        })
        .copied()
        .collect::<Vec<_>>()
        .join("\n");
    tail.chars()
        .rev()
        .take(4_000)
        .collect::<String>()
        .chars()
        .rev()
        .collect()
}

fn run_dsh_plugin_command(app: &AppHandle, args: &[&str]) -> Result<String, String> {
    // Installation is available before the runtime starts, so migrate profiles
    // created by affected versions here as well as during sidecar startup.
    ensure_dsh_web_profile(app)?;
    let launch = resolve_dsh_launch(app)?;
    let workspace = workspace_dir(app)?;
    let home = dsh_home(app)?;
    std::fs::create_dir_all(&home).map_err(|e| e.to_string())?;
    let mut command = quiet_command(&launch.program);
    command
        .args(&launch.prefix_args)
        .args(args)
        .current_dir(&workspace)
        .env("DSH_HOME", &home)
        .env("DSH_CWD", &workspace)
        .env("HOME", std::env::var("HOME").unwrap_or_default())
        .env("PATH", plugin_path());
    // Package installation reaches registries and Git hosts directly. Keep it
    // on the same persisted proxy path as the long-running sidecar; otherwise
    // a GUI configured with a custom proxy still makes pnpm attempt a direct
    // GitHub connection and report a misleading install failure.
    for (key, value) in sidecar_proxy_env(app) {
        command.env(key, value);
    }
    if let Some(entry) = launch.entry {
        command.env("NEBULAMAT_DSH_ENTRY", entry);
    }
    let output = command
        .output()
        .map_err(|e| format!("failed to run DSH plugin manager: {e}"))?;
    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    let details = format!("{stdout}\n{stderr}").trim().to_string();
    if !output.status.success() {
        let suffix = if details.is_empty() {
            "no output".to_string()
        } else {
            summarize_plugin_failure(&details)
        };
        return Err(format!(
            "DSH plugin command failed ({}): {suffix}",
            output.status
        ));
    }
    Ok(details)
}

#[tauri::command]
pub fn list_dsh_mcp_servers(app: AppHandle) -> Result<Vec<serde_json::Value>, String> {
    Ok(read_dsh_module_state(&app)
        .mcp
        .into_iter()
        .map(|(name, config)| {
            let status = dsh_mcp_status(&config);
            serde_json::json!({ "name": name, "status": status, "config": config })
        })
        .collect())
}

/// The Cordis patch is the source of truth for registration, but the UI also
/// needs a usable live-state color. Enabled entries are considered connected
/// once their validated patch is persisted; an absolute local executable that
/// has disappeared is reported as failed so the user can repair it.
fn dsh_mcp_status(config: &serde_json::Value) -> &'static str {
    if config.get("enabled").and_then(serde_json::Value::as_bool) == Some(false) {
        return "disabled";
    }
    if config.get("type").and_then(serde_json::Value::as_str) == Some("local") {
        if let Some(executable) = config
            .get("command")
            .and_then(serde_json::Value::as_array)
            .and_then(|command| command.first())
            .and_then(serde_json::Value::as_str)
        {
            let path = Path::new(executable);
            if path.is_absolute() && !path.is_file() {
                return "failed";
            }
        }
    }
    "connected"
}

#[tauri::command]
pub fn set_dsh_mcp_server(
    app: AppHandle,
    name: String,
    config: serde_json::Value,
) -> Result<(), String> {
    dsh_mcp_plugin(&name, &config)?;
    let mut state = read_dsh_module_state(&app);
    state.mcp.insert(name, config);
    write_dsh_module_state(&app, &state)
}

#[tauri::command]
pub fn remove_dsh_mcp_server(app: AppHandle, name: String) -> Result<bool, String> {
    let mut state = read_dsh_module_state(&app);
    let removed = state.mcp.remove(&name).is_some();
    if removed {
        write_dsh_module_state(&app, &state)?;
    }
    Ok(removed)
}

/// Third-party DSH Cordis plugins configured by the user. The module/package
/// must already be available to the DSH profile; this command only owns the
/// safe, persistent composition entry and its enabled state.
#[tauri::command(async)]
pub fn list_dsh_plugins(app: AppHandle) -> Result<Vec<serde_json::Value>, String> {
    let mut rows = Vec::new();
    let mut installed_modules = std::collections::HashSet::new();
    for (id, config) in read_dsh_module_state(&app).plugins {
        let module = config
            .get("module")
            .and_then(serde_json::Value::as_str)
            .unwrap_or_default()
            .to_string();
        if !module.is_empty() {
            installed_modules.insert(module.clone());
        }
        rows.push(serde_json::json!({
            "id": id,
            "module": module,
            "enabled": config.get("enabled").and_then(serde_json::Value::as_bool) != Some(false),
            "installed": false,
            "bundle": false,
            "client": false,
            "skill": false,
            "config": config.get("config").cloned().unwrap_or_else(|| serde_json::json!({})),
        }));
    }
    for row in profile_plugin_rows(&app)? {
        let module = row
            .get("module")
            .and_then(serde_json::Value::as_str)
            .unwrap_or_default();
        if !installed_modules.contains(module) {
            rows.push(row);
        }
    }
    if let Some(row) = bundled_plugin_row(&app, "https://github.com/omdsh-dev/dsh-genui")? {
        let module = row
            .get("module")
            .and_then(serde_json::Value::as_str)
            .unwrap_or_default();
        if !installed_modules.contains(module)
            && !rows
                .iter()
                .any(|item| item.get("module").and_then(serde_json::Value::as_str) == Some(module))
        {
            rows.push(row);
        }
    }
    rows.sort_by(|a, b| {
        a.get("id")
            .and_then(serde_json::Value::as_str)
            .unwrap_or_default()
            .cmp(
                b.get("id")
                    .and_then(serde_json::Value::as_str)
                    .unwrap_or_default(),
            )
    });
    Ok(rows)
}

/// Install a real DSH profile plugin using the official `dsh plugin` flow.
/// This owns the dependency and bundle manifests; it does not turn a plugin's
/// optional SKILL.md into a standalone skill installation.
#[tauri::command(async)]
pub fn install_dsh_plugin(
    app: AppHandle,
    state: tauri::State<'_, RuntimeState>,
    spec: String,
) -> Result<serde_json::Value, String> {
    let spec = spec.trim();
    if spec.is_empty() || spec.len() > 512 || spec.chars().any(char::is_control) {
        return Err(
            "DSH plugin source must be a non-empty package, path, or URL (max 512 characters)"
                .into(),
        );
    }
    ensure_dsh_web_profile(&app)?;
    if let Some(row) = bundled_plugin_row(&app, spec)? {
        restart_sidecar_if_running(&app, &state)?;
        return Ok(row);
    }
    if let Some(row) = profile_plugin_rows(&app)?
        .into_iter()
        .find(|row| plugin_spec_matches(row, spec))
    {
        restart_sidecar_if_running(&app, &state)?;
        return Ok(row);
    }
    let mut install_error = None;
    let mut installed = false;
    let candidates = github_tarball_specs(spec);
    if candidates.is_empty() {
        run_dsh_plugin_command(&app, &["plugin", "--profile", "web", "add", spec])?;
        installed = true;
    } else {
        for candidate in &candidates {
            match run_dsh_plugin_command(&app, &["plugin", "--profile", "web", "add", candidate]) {
                Ok(_) => {
                    installed = true;
                    break;
                }
                Err(error) => install_error = Some(error),
            }
        }
        if !installed {
            return Err(install_error
                .unwrap_or_else(|| "DSH plugin could not be downloaded from GitHub".to_string()));
        }
    }
    debug_assert!(installed);
    let row = profile_plugin_rows(&app)?
        .into_iter()
        .find(|row| plugin_spec_matches(row, spec))
        .ok_or_else(|| {
            "Package installed but it does not declare a DSH bundle or client module".to_string()
        })?;
    restart_sidecar_if_running(&app, &state)?;
    Ok(row)
}

#[tauri::command(async)]
pub fn set_dsh_plugin(
    app: AppHandle,
    state: tauri::State<'_, RuntimeState>,
    id: String,
    config: serde_json::Value,
) -> Result<(), String> {
    if let Some(enabled) = config.get("enabled").and_then(serde_json::Value::as_bool) {
        if update_profile_bundle(&app, &id, enabled)? {
            restart_sidecar_if_running(&app, &state)?;
            return Ok(());
        }
    }
    dsh_plugin_entry(&id, &config)?;
    let mut modules = read_dsh_module_state(&app);
    modules.plugins.insert(id, config);
    write_dsh_module_state(&app, &modules)?;
    restart_sidecar_if_running(&app, &state)?;
    Ok(())
}

#[tauri::command(async)]
pub fn remove_dsh_plugin(
    app: AppHandle,
    state: tauri::State<'_, RuntimeState>,
    id: String,
) -> Result<bool, String> {
    if profile_plugin_rows(&app)?
        .iter()
        .any(|row| row.get("id").and_then(serde_json::Value::as_str) == Some(id.as_str()))
    {
        run_dsh_plugin_command(&app, &["plugin", "--profile", "web", "remove", &id])?;
        restart_sidecar_if_running(&app, &state)?;
        return Ok(true);
    }
    validate_dsh_plugin_id(&id)?;
    let mut modules = read_dsh_module_state(&app);
    let removed = modules.plugins.remove(&id).is_some();
    if removed {
        write_dsh_module_state(&app, &modules)?;
        restart_sidecar_if_running(&app, &state)?;
    }
    Ok(removed)
}

/// Remove an entry from a map section of the app-private DSH module state
/// config ("provider" or "mcp") and restart the sidecar (PATCH /global/config
/// cannot delete keys).
/// The current approval mode ("approve" | "full"). Spawn seeding guarantees a
/// mode exists once the runtime has started; before that, report the default.
#[tauri::command]
pub fn get_approval_mode(app: AppHandle) -> Result<String, String> {
    Ok(if dsh_permission_mode(&app) == "danger-full-access" {
        "full"
    } else {
        "approve"
    }
    .to_string())
}

/// Switch the approval mode and restart the sidecar so the permission rules
/// take effect. Returns the (stable-port) base URL when it was running.
#[tauri::command(async)]
pub fn set_approval_mode(
    app: AppHandle,
    state: State<'_, RuntimeState>,
    mode: String,
) -> Result<String, String> {
    let dsh_mode = match mode.as_str() {
        "approve" => "workspace-write",
        "full" => "danger-full-access",
        other => return Err(format!("unknown approval mode: {other}")),
    };
    let path = permission_mode_file(&app)?;
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    std::fs::write(&path, format!("{dsh_mode}\n")).map_err(|e| e.to_string())?;
    tighten_private(&path);

    // The sidecar reads the proxy environment at process start.
    Ok(restart_sidecar_if_running(&app, &state)?
        .unwrap_or_else(|| path.to_string_lossy().to_string()))
}

/// The global memory file: one Markdown document that DSH loads into
/// every conversation, in the app-private profile next to the config.
fn global_memory_file(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(dsh_home(app)?.join("AGENTS.md"))
}

/// Absolute path of a memory file, forward-slashed so the config stays
/// portable. `scope` is "global" (the profile file) or "project" (that
/// folder's own AGENTS.md — the file DSH loads for sessions inside it).
fn memory_file(app: &AppHandle, scope: &str, directory: Option<&str>) -> Result<PathBuf, String> {
    match scope {
        "global" => global_memory_file(app),
        "project" => {
            let dir = directory
                .filter(|d| !d.is_empty())
                .ok_or("no project folder")?;
            Ok(PathBuf::from(dir).join("AGENTS.md"))
        }
        other => Err(format!("unknown memory scope \"{other}\"")),
    }
}

/// Read a memory layer. A file that was never written reads as empty — the
/// editor opens blank rather than erroring.
#[tauri::command]
pub fn read_memory(
    app: AppHandle,
    scope: String,
    directory: Option<String>,
) -> Result<String, String> {
    let path = memory_file(&app, &scope, directory.as_deref())?;
    Ok(std::fs::read_to_string(path).unwrap_or_default())
}

/// Replace a memory layer's contents. Writing an empty document deletes the
/// file, so "cleared" and "never set" stay the same state.
#[tauri::command]
pub fn write_memory(
    app: AppHandle,
    scope: String,
    directory: Option<String>,
    text: String,
) -> Result<(), String> {
    let path = memory_file(&app, &scope, directory.as_deref())?;
    if text.trim().is_empty() {
        if path.exists() {
            std::fs::remove_file(&path).map_err(|e| e.to_string())?;
        }
        return Ok(());
    }
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    std::fs::write(&path, text).map_err(|e| e.to_string())
}

/// Append a block to a memory layer, keeping what is already there. This is
/// what "save this to memory" from a conversation does.
#[tauri::command]
pub fn append_memory(
    app: AppHandle,
    scope: String,
    directory: Option<String>,
    text: String,
) -> Result<(), String> {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return Ok(());
    }
    let path = memory_file(&app, &scope, directory.as_deref())?;
    let existing = std::fs::read_to_string(&path).unwrap_or_default();
    let mut out = existing.trim_end().to_string();
    if !out.is_empty() {
        out.push_str("\n\n");
    }
    out.push_str(trimmed);
    out.push('\n');
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    std::fs::write(&path, out).map_err(|e| e.to_string())
}

/// Whether the memory layers are currently applied to conversations.
#[tauri::command]
pub fn get_memory_enabled(app: AppHandle) -> Result<bool, String> {
    Ok(read_dsh_module_state(&app).memory_enabled)
}

/// Apply or stop applying the memory layers, restarting the sidecar so the
/// change takes effect (instructions are read when a session's context is built).
#[tauri::command(async)]
pub fn set_memory_enabled(
    app: AppHandle,
    state: State<'_, RuntimeState>,
    enabled: bool,
) -> Result<(), String> {
    let mut modules = read_dsh_module_state(&app);
    if modules.memory_enabled == enabled {
        return Ok(()); // already in the requested state — no restart
    }
    modules.memory_enabled = enabled;
    write_dsh_module_state(&app, &modules)?;
    let _ = state;
    Ok(())
}

/// Per-agent model overrides as `{ agent: "provider/model" }`.
#[tauri::command]
pub fn get_agent_models(_app: AppHandle) -> Result<serde_json::Value, String> {
    Err("DSH does not expose per-agent model overrides; configure agent presets instead".into())
}

/// Per-agent reasoning-effort overrides as `{ agent: "high" }` (#71).
#[tauri::command]
pub fn get_agent_variants(_app: AppHandle) -> Result<serde_json::Value, String> {
    Err(
        "DSH reasoning effort is selected per model or agent preset, not by variant overrides"
            .into(),
    )
}

/// Pin one agent to its own model, or clear the override with an empty model.
/// Restarts the sidecar: agent definitions are built when it loads its config.
#[tauri::command(async)]
pub fn set_agent_model(
    app: AppHandle,
    state: State<'_, RuntimeState>,
    agent: String,
    model: String,
) -> Result<(), String> {
    let _ = (app, state, agent, model);
    Err("DSH does not expose per-agent model overrides; configure agent presets instead".into())
}

/// Pin one agent to a reasoning-effort variant, or clear it with an empty string.
/// Restarts the sidecar for the same reason `set_agent_model` does.
#[tauri::command(async)]
pub fn set_agent_variant(
    app: AppHandle,
    state: State<'_, RuntimeState>,
    agent: String,
    variant: String,
) -> Result<(), String> {
    let _ = (app, state, agent, variant);
    Err(
        "DSH reasoning effort is selected per model or agent preset, not by variant overrides"
            .into(),
    )
}

/// The persisted proxy setting plus the proxy the sidecar would use right now.
#[tauri::command]
pub fn get_proxy_setting(app: AppHandle) -> Result<serde_json::Value, String> {
    let (mode, url) = read_proxy_setting(&app);
    let effective = effective_proxy(&mode, &url);
    Ok(serde_json::json!({ "mode": mode, "url": url, "effective": effective }))
}

/// Persist the proxy setting ("system" | "custom" | "none", url for custom)
/// and restart the sidecar so its network env takes effect.
#[tauri::command(async)]
pub fn set_proxy_setting(
    app: AppHandle,
    state: State<'_, RuntimeState>,
    mode: String,
    url: String,
) -> Result<String, String> {
    let line = match mode.as_str() {
        "system" => "system".to_string(),
        "none" => "none".to_string(),
        "custom" => {
            let url = url.trim();
            validate_proxy_url(url)?;
            format!("custom {url}")
        }
        other => return Err(format!("unknown proxy mode: {other}")),
    };
    let path = proxy_setting_file(&app)?;
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    std::fs::write(&path, line).map_err(|e| e.to_string())?;

    // Same restart flow as set_approval_mode: the env only applies at spawn.
    Ok(restart_sidecar_if_running(&app, &state)?
        .unwrap_or_else(|| path.to_string_lossy().to_string()))
}

/// The persisted uv mirrors (empty string ⇒ use uv's default index/mirror).
#[tauri::command]
pub fn get_mirror_setting(app: AppHandle) -> Result<serde_json::Value, String> {
    let (pypi, python) = read_mirror_setting(&app);
    Ok(serde_json::json!({ "pypi": pypi, "python": python }))
}

/// Persist the uv mirrors. Blank fields clear that mirror. No sidecar restart:
/// only the next provisioning run (Jupyter / science MCP) reads them.
#[tauri::command]
pub fn set_mirror_setting(app: AppHandle, pypi: String, python: String) -> Result<(), String> {
    let (pypi, python) = (pypi.trim(), python.trim());
    let mut lines = Vec::new();
    if !pypi.is_empty() {
        validate_mirror_url(pypi)?;
        lines.push(format!("pypi {pypi}"));
    }
    if !python.is_empty() {
        validate_mirror_url(python)?;
        lines.push(format!("python {python}"));
    }
    let path = mirror_setting_file(&app)?;
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    std::fs::write(&path, lines.join("\n")).map_err(|e| e.to_string())
}

#[cfg(test)]
mod export_tests {
    use super::safe_file_stem;

    #[test]
    fn a_title_can_never_become_a_path() {
        // Separators become dashes, so the result can only ever be a leaf name.
        assert_eq!(
            safe_file_stem("../../.ssh/authorized_keys", "x"),
            "..-..-.ssh-authorized_keys"
        );
        assert_eq!(
            safe_file_stem("C:\\Windows\\System32", "x"),
            "C--Windows-System32"
        );
    }

    #[test]
    fn keeps_ordinary_titles_readable_including_non_latin() {
        assert_eq!(
            safe_file_stem("Spike sorting — pass 2", "x"),
            "Spike sorting — pass 2"
        );
        assert_eq!(safe_file_stem("脑机接口趋势分析", "x"), "脑机接口趋势分析");
    }

    #[test]
    fn falls_back_when_a_title_leaves_nothing_usable() {
        assert_eq!(safe_file_stem("   ", "conversation"), "conversation");
        // Nothing but separators still yields a harmless leaf name.
        assert_eq!(safe_file_stem("///", "conversation"), "---");
        // Windows rejects a trailing dot.
        assert_eq!(safe_file_stem("results.", "x"), "results");
    }

    #[test]
    fn sidesteps_windows_device_names() {
        assert_eq!(safe_file_stem("CON", "x"), "CON-");
        assert_eq!(safe_file_stem("nul", "x"), "nul-");
        assert_eq!(safe_file_stem("console", "x"), "console");
    }

    #[test]
    fn caps_the_length_so_the_filesystem_accepts_it() {
        let long = "n".repeat(500);
        assert_eq!(safe_file_stem(&long, "x").chars().count(), 80);
    }
}
