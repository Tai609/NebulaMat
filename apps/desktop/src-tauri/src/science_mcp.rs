// Curated open-source science MCP connectors (P1-2). We do NOT reimplement
// literature/database access — we one-click provision existing open-source MCP
// servers (e.g. paper-search-mcp, biomcp) into a shared ISOLATED uv env under
// app data (the user's Python is untouched), then register them in OpenCode's
// config. The frontend holds the curated catalog; here we just install a pip
// package and report the managed interpreter path.
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

const BUNDLED_PAPER_SEARCH: &str = "nebulamat-paper-search";
const BUNDLED_LITERATURE_INGEST: &str = "openscience-literature-ingest-mcp";

fn env_dir(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("runtime")
        .join("science-mcp-env"))
}

/// Absolute path to the managed interpreter in the shared science-MCP env.
fn python_bin(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = env_dir(app)?;
    #[cfg(windows)]
    return Ok(dir.join("Scripts").join("python.exe"));
    #[cfg(not(windows))]
    Ok(dir.join("bin").join("python"))
}

fn paper_search_package_dir(app: &AppHandle) -> Result<PathBuf, String> {
    if let Ok(path) = app
        .path()
        .resolve("paper-search-mcp", tauri::path::BaseDirectory::Resource)
    {
        if path.is_dir() {
            return Ok(path);
        }
    }
    let source_tree = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../../runtime/paper-search-mcp")
        .canonicalize()
        .map_err(|e| format!("paper-search MCP resource is missing: {e}"))?;
    if source_tree.is_dir() {
        Ok(source_tree)
    } else {
        Err("paper-search MCP resource is missing from this build".into())
    }
}

fn literature_ingest_package_dir(app: &AppHandle) -> Result<PathBuf, String> {
    if let Ok(path) = app.path().resolve(
        "literature-ingest-mcp",
        tauri::path::BaseDirectory::Resource,
    ) {
        if path.is_dir() {
            return Ok(path);
        }
    }
    let source_tree = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../../runtime/literature-ingest-mcp")
        .canonicalize()
        .map_err(|e| format!("literature-ingest MCP resource is missing: {e}"))?;
    if source_tree.is_dir() {
        Ok(source_tree)
    } else {
        Err("literature-ingest MCP resource is missing from this build".into())
    }
}

/// The managed interpreter path if the shared env exists, else None. The
/// frontend derives launch commands (`<python> -m <module> …`) from this.
#[tauri::command]
pub fn science_mcp_python(app: AppHandle) -> Result<Option<String>, String> {
    let py = python_bin(&app)?;
    Ok(py.exists().then(|| py.to_string_lossy().to_string()))
}

/// Provision one open-source MCP package into the shared isolated env with the
/// bundled uv (creating the env on first use), and return the managed Python
/// path to launch it with. First run downloads a managed Python (~tens of MB);
/// installing a package is incremental. Streams progress as `setup-progress`
/// events and fails with a readable error when a download stalls (uv::run_uv).
#[tauri::command]
pub async fn setup_science_mcp(app: AppHandle, package: String) -> Result<String, String> {
    // Guard against a caller sending an arbitrary spec (flags, extra args).
    if !is_safe_package(&package) {
        return Err("invalid package name".into());
    }
    let dir = env_dir(&app)?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;

    // Create the venv only when its interpreter is missing. `uv venv` deletes
    // and rewrites the interpreter even with --allow-existing (verified: the
    // inode changes on every run), and on Windows a python.exe that an
    // already-enabled connector's MCP server is running from cannot be
    // replaced — so enabling a SECOND connector always died with "uv venv
    // failed" (#10). An existing interpreter means the shared env is
    // provisioned; `uv pip install` is all the next connector needs.
    let py = python_bin(&app)?;
    if !py.exists() {
        crate::uv::create_venv(&app, "science", &dir).await?;
    }
    let mut install_args = vec![
        "pip".into(),
        "install".into(),
        "--python".into(),
        py.to_string_lossy().to_string(),
    ];
    if package == BUNDLED_PAPER_SEARCH {
        let bundled = paper_search_package_dir(&app)?;
        // The bundled first-party wrapper pins paper-search-mcp exactly in its
        // project metadata. Let uv resolve that MIT dependency from the normal
        // package index, just like every other science connector, instead of
        // requiring a wheel that is not part of the application resources.
        install_args.push(bundled.to_string_lossy().to_string());
    } else if package == BUNDLED_LITERATURE_INGEST {
        let bundled = literature_ingest_package_dir(&app)?;
        install_args.push(bundled.to_string_lossy().to_string());
    } else {
        install_args.push(package);
    }
    crate::uv::run_uv(&app, "science", install_args, "uv pip install").await?;
    Ok(py.to_string_lossy().to_string())
}

/// A PyPI package name (letters/digits/._-), optionally pinned with `==<version>`.
/// Rejects anything that could smuggle extra pip args or shell metacharacters.
fn is_safe_package(pkg: &str) -> bool {
    let core = pkg.split_once("==").map(|(n, _)| n).unwrap_or(pkg);
    !core.is_empty()
        && !core.starts_with('-')
        && core
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-'))
        && pkg
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-' | '='))
}

#[cfg(test)]
mod tests {
    use super::is_safe_package;
    use std::path::PathBuf;

    #[test]
    fn bundled_paper_search_source_is_present() {
        let dir =
            PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../../runtime/paper-search-mcp");
        assert!(dir.join("pyproject.toml").is_file());
        assert!(dir
            .join("nebulamat_paper_search")
            .join("server.py")
            .is_file());
    }

    #[test]
    fn accepts_real_package_names_and_pins() {
        assert!(is_safe_package("paper-search-mcp"));
        assert!(is_safe_package("biomcp-python"));
        assert!(is_safe_package("jupyter-mcp-server==0.14.0"));
    }

    #[test]
    fn rejects_flag_and_metacharacter_injection() {
        assert!(!is_safe_package(""));
        assert!(!is_safe_package("--upgrade"));
        assert!(!is_safe_package("pkg; rm -rf /"));
        assert!(!is_safe_package("pkg && echo"));
        assert!(!is_safe_package("pkg --index-url http://evil"));
        assert!(!is_safe_package("pkg\nother"));
    }
}
