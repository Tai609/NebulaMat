// Remote Access Gateway — one authenticated HTTP surface that re-exposes the
// agent runtime + workspace files to CLI / LAN-web / tunnel clients. Loopback by
// default; LAN (0.0.0.0) is an explicit opt-in. Std-only `TcpListener` with a
// thread per connection (mirrors `preview_server.rs`) — no new crates: agent
// calls proxy to the loopback DeepSeek Harness sidecar with the already-present blocking
// `reqwest`; file calls
// reuse `artifact_file`. A small self-contained web client ships at `/`.
//
// The ONLY thing that ever binds off-loopback is this gateway, and it is the only
// thing that understands the external bearer token — the sidecar stays
// 127.0.0.1-only always. See docs/rfc/remote-access-gateway.md.
use std::cell::RefCell;
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{Shutdown, TcpListener, TcpStream};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;

use tauri::{AppHandle, Emitter, Manager, State};

use crate::artifact_file::{locate_under, mime_for, resolve_under, scope_root};
use crate::runtime::{
    random_hex, runtime_root, sidecar_url, tighten_private, workspace_dir, RuntimeState,
};

/// The web client + all `/v1` routes are served on this port when free, so a
/// bookmarked URL / QR survives restarts; falls back to an ephemeral port.
const PREFERRED_PORT: u16 = 4098;

/// SPA route roots (client-side routes served by index.html, not the DSH
/// proxy). Everything else that isn't a static asset is proxied to the sidecar.
const SPA_ROOTS: &[&str] = &[
    "live",
    "example",
    "skills",
    "notebooks",
    "files",
    "runs",
    "projects",
    "settings",
    "dft-review",
    "graphs",
    "materials",
];

// ---- persisted config (app-level, under the runtime root) -------------------

struct Persisted {
    enabled: bool,
    lan: bool,
    /// "full" = every endpoint; "read-only" = GET only (no turns, no approvals).
    mode: String,
    token: String,
}

impl Default for Persisted {
    fn default() -> Self {
        Persisted {
            enabled: false,
            lan: false,
            mode: "full".into(),
            token: String::new(),
        }
    }
}

fn config_file(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(runtime_root(app)?.join("gateway.txt"))
}

fn read_persisted(app: &AppHandle) -> Persisted {
    let mut p = Persisted::default();
    if let Ok(f) = config_file(app) {
        if let Ok(s) = std::fs::read_to_string(f) {
            for line in s.lines() {
                if let Some((k, v)) = line.trim().split_once(' ') {
                    match k {
                        "enabled" => p.enabled = v == "1",
                        "lan" => p.lan = v == "1",
                        "mode" => p.mode = normalize_mode(v),
                        "token" => p.token = v.to_string(),
                        _ => {}
                    }
                }
            }
        }
    }
    p
}

fn write_persisted(app: &AppHandle, p: &Persisted) -> Result<(), String> {
    let f = config_file(app)?;
    if let Some(dir) = f.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let body = format!(
        "enabled {}\nlan {}\nmode {}\ntoken {}\n",
        if p.enabled { 1 } else { 0 },
        if p.lan { 1 } else { 0 },
        p.mode,
        p.token
    );
    std::fs::write(&f, body).map_err(|e| e.to_string())?;
    tighten_private(&f); // token is a secret — owner-only, never in git
    Ok(())
}

fn normalize_mode(m: &str) -> String {
    if m == "read-only" {
        "read-only".into()
    } else {
        "full".into()
    }
}

// ---- runtime state ----------------------------------------------------------

/// Token + mode the running listener reads PER-REQUEST, so rotating the token
/// or flipping the access mode never needs a rebind (the port stays stable).
struct Shared {
    token: Mutex<String>,
    read_only: AtomicBool,
    desktop: bool,
}

struct Running {
    port: u16,
    lan: bool,
    stop: Arc<AtomicBool>,
    shared: Arc<Shared>,
}

#[derive(Default)]
pub struct GatewayState(Mutex<Option<Running>>);

/// App-private loopback bridge between the Tauri WebView and DSH. DSH correctly
/// rejects the WebView's cross-origin HTTP/WebSocket requests; this bridge
/// authenticates the desktop, applies a narrow CORS allowlist, and rewrites the
/// inner hop to DSH's own loopback authority.
#[derive(Default)]
pub struct DesktopBridgeState(Mutex<Option<Running>>);

struct Ctx {
    app: AppHandle,
    shared: Arc<Shared>,
}

impl Ctx {
    fn token(&self) -> String {
        self.shared.token.lock().unwrap().clone()
    }
    fn read_only(&self) -> bool {
        self.shared.read_only.load(Ordering::Relaxed)
    }
    fn desktop(&self) -> bool {
        self.shared.desktop
    }
}

fn runtime_capabilities(desktop: bool, read_only: bool) -> serde_json::Value {
    serde_json::json!({
        "runtime": "dsh",
        "sessions": {
            "create": !read_only, "archive": !read_only,
            "unarchive": false, "delete": false, "revert": !read_only, "fork": !read_only
        },
        "interaction": { "questions": !read_only, "permissions": !read_only, "persistentRules": false },
        "configuration": { "providers": desktop && !read_only, "oauth": false, "mcp": false },
        "execution": { "shell": !read_only, "commands": false, "toolAdmission": "server" },
        "surfaces": { "desktop": desktop, "web": !desktop, "readOnlyWeb": !desktop && read_only }
    })
}

thread_local! {
    static RESPONSE_CORS_ORIGIN: RefCell<Option<String>> = const { RefCell::new(None) };
}

// ---- lifecycle --------------------------------------------------------------

fn bind_listener(lan: bool, prefer_gateway_port: bool) -> std::io::Result<TcpListener> {
    let host = if lan { "0.0.0.0" } else { "127.0.0.1" };
    if prefer_gateway_port {
        match TcpListener::bind((host, PREFERRED_PORT)) {
            Ok(l) => Ok(l),
            Err(_) => TcpListener::bind((host, 0)),
        }
    } else {
        TcpListener::bind((host, 0))
    }
}

fn start_listener(
    app: &AppHandle,
    slot: &Mutex<Option<Running>>,
    lan: bool,
    prefer_gateway_port: bool,
    token: String,
    read_only: bool,
    desktop: bool,
) -> Result<u16, String> {
    stop_listener(slot);
    let listener =
        bind_listener(lan, prefer_gateway_port).map_err(|e| format!("gateway bind failed: {e}"))?;
    listener.set_nonblocking(true).map_err(|e| e.to_string())?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    let stop_flag = Arc::new(AtomicBool::new(false));
    let shared = Arc::new(Shared {
        token: Mutex::new(token),
        read_only: AtomicBool::new(read_only),
        desktop,
    });
    let ctx = Arc::new(Ctx {
        app: app.clone(),
        shared: shared.clone(),
    });
    let sf = stop_flag.clone();
    // Detached accept loop. A non-blocking listener + a short poll lets the flag
    // stop us within ~150ms on toggle/rebind (a blocking accept() could not).
    std::thread::spawn(move || loop {
        if sf.load(Ordering::Relaxed) {
            break;
        }
        match listener.accept() {
            Ok((stream, _addr)) => {
                // The listener is non-blocking so this loop can poll the stop
                // flag; accepted sockets INHERIT that mode on macOS/Linux, so
                // force each one back to blocking — otherwise reads/writes hit
                // WouldBlock mid-request (parse fails → 400; a partial write of
                // a large asset → truncated body → ERR_CONTENT_LENGTH_MISMATCH).
                let _ = stream.set_nonblocking(false);
                let ctx = ctx.clone();
                std::thread::spawn(move || handle(stream, ctx));
            }
            Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                std::thread::sleep(Duration::from_millis(150));
            }
            Err(_) => std::thread::sleep(Duration::from_millis(300)),
        }
    });
    *slot.lock().unwrap() = Some(Running {
        port,
        lan,
        stop: stop_flag,
        shared,
    });
    Ok(port)
}

fn start(app: &AppHandle, state: &GatewayState, p: &Persisted) -> Result<u16, String> {
    start_listener(
        app,
        &state.0,
        p.lan,
        true,
        p.token.clone(),
        p.mode == "read-only",
        false,
    )
}

fn stop_listener(slot: &Mutex<Option<Running>>) {
    if let Some(r) = slot.lock().unwrap().take() {
        r.stop.store(true, Ordering::Relaxed);
    }
}

fn stop(state: &GatewayState) {
    stop_listener(&state.0);
}

/// Start (or reuse) the authenticated desktop-only bridge. It deliberately uses
/// an ephemeral loopback port so it cannot collide with the optional user-facing
/// gateway, which keeps its stable preferred port.
pub(crate) fn desktop_bridge_url(app: &AppHandle) -> Result<String, String> {
    let state = app.state::<DesktopBridgeState>();
    if let Some(port) = state.0.lock().unwrap().as_ref().map(|running| running.port) {
        return Ok(format!("http://127.0.0.1:{port}"));
    }
    let port = start_listener(
        app,
        &state.0,
        false,
        false,
        crate::runtime::server_password().to_string(),
        false,
        true,
    )?;
    Ok(format!("http://127.0.0.1:{port}"))
}

pub fn shutdown_desktop_bridge(state: &DesktopBridgeState) {
    stop_listener(&state.0);
}

/// Auto-start on app launch if the user left it enabled last time.
pub fn autostart(app: &AppHandle) {
    let state = app.state::<GatewayState>();
    let p = read_persisted(app);
    if p.enabled && !p.token.is_empty() {
        let _ = start(app, state.inner(), &p);
    }
}

/// Stop the accept loop on app exit.
pub fn shutdown(state: &GatewayState) {
    stop(state);
}

// ---- request handling -------------------------------------------------------

struct Request {
    method: String,
    path: String,
    query: String,
    headers: Vec<(String, String)>,
    body: Vec<u8>,
}

impl Request {
    fn parse(stream: &TcpStream) -> Option<Request> {
        let mut reader = BufReader::new(stream.try_clone().ok()?);
        let mut line = String::new();
        reader.read_line(&mut line).ok()?;
        let mut parts = line.trim_end().split_whitespace();
        let method = parts.next()?.to_string();
        let target = parts.next()?.to_string();
        let (path, query) = match target.split_once('?') {
            Some((p, q)) => (p.to_string(), q.to_string()),
            None => (target, String::new()),
        };
        let mut headers = Vec::new();
        let mut content_length = 0usize;
        loop {
            let mut h = String::new();
            if reader.read_line(&mut h).ok()? == 0 {
                break;
            }
            let h = h.trim_end();
            if h.is_empty() {
                break;
            }
            if let Some((k, v)) = h.split_once(':') {
                let k = k.trim().to_lowercase();
                let v = v.trim().to_string();
                if k == "content-length" {
                    content_length = v.parse().unwrap_or(0);
                }
                headers.push((k, v));
            }
        }
        // Guard against an oversized body claim (nothing here needs > 8 MiB).
        if content_length > 8 * 1024 * 1024 {
            return None;
        }
        let mut body = vec![0u8; content_length];
        if content_length > 0 {
            reader.read_exact(&mut body).ok()?;
        }
        Some(Request {
            method,
            path,
            query,
            headers,
            body,
        })
    }

    fn header(&self, k: &str) -> Option<&str> {
        self.headers
            .iter()
            .find(|(hk, _)| hk == k)
            .map(|(_, v)| v.as_str())
    }

    fn query_get(&self, key: &str) -> Option<String> {
        query_get(&self.query, key)
    }
}

fn handle(mut stream: TcpStream, ctx: Arc<Ctx>) {
    let req = match Request::parse(&stream) {
        Some(r) => r,
        None => {
            respond_json(&mut stream, 400, "{\"error\":\"bad request\"}");
            return;
        }
    };
    let cors_origin = if ctx.desktop() {
        desktop_cors_origin(req.header("origin"))
    } else {
        None
    };
    RESPONSE_CORS_ORIGIN.with(|value| *value.borrow_mut() = cors_origin.map(str::to_string));
    route(&mut stream, &req, &ctx);
}

fn desktop_cors_origin(origin: Option<&str>) -> Option<&str> {
    match origin {
        Some("http://tauri.localhost" | "https://tauri.localhost" | "tauri://localhost") => origin,
        #[cfg(debug_assertions)]
        Some("http://localhost:5173" | "http://127.0.0.1:5173") => origin,
        _ => None,
    }
}

fn respond_desktop_preflight(stream: &mut TcpStream, req: &Request) {
    let allowed = desktop_cors_origin(req.header("origin")).is_some()
        && req
            .header("access-control-request-method")
            .is_some_and(|method| {
                method.eq_ignore_ascii_case("GET") || method.eq_ignore_ascii_case("POST")
            });
    if !allowed {
        respond_json(stream, 403, "{\"error\":\"origin not allowed\"}");
        return;
    }
    let head = format!(
        "HTTP/1.1 204 No Content\r\nContent-Length: 0\r\nAccess-Control-Allow-Origin: {}\r\nAccess-Control-Allow-Methods: GET, POST, OPTIONS\r\nAccess-Control-Allow-Headers: authorization, content-type\r\nAccess-Control-Max-Age: 600\r\nVary: Origin\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n",
        req.header("origin").unwrap_or_default(),
    );
    let _ = stream.write_all(head.as_bytes());
    let _ = stream.flush();
}

fn route(stream: &mut TcpStream, req: &Request, ctx: &Ctx) {
    let path = req.path.as_str();

    if ctx.desktop()
        && req.method == "OPTIONS"
        && (path.starts_with("/api/") || path.starts_with("/plugins/dsh-vaspflow/"))
    {
        respond_desktop_preflight(stream, req);
        return;
    }
    if ctx.desktop()
        && req.header("origin").is_some()
        && desktop_cors_origin(req.header("origin")).is_none()
    {
        respond_json(stream, 403, "{\"error\":\"origin not allowed\"}");
        return;
    }

    // Liveness — open (carries no capability).
    if req.method == "GET" && path == "/v1/health" {
        respond_json(
            stream,
            200,
            "{\"ok\":true,\"service\":\"open-science-gateway\"}",
        );
        return;
    }

    // ---- /v1 contract API (CLI / curl / the SPA's file browser) ----
    if let Some(rest) = path.strip_prefix("/v1/") {
        if !authed(req, &ctx.token()) {
            respond_json(stream, 401, "{\"error\":\"unauthorized\"}");
            return;
        }
        if ctx.read_only() && req.method != "GET" {
            respond_json(stream, 403, "{\"error\":\"token is read-only\"}");
            return;
        }
        v1(stream, req, ctx, rest);
        return;
    }

    // ---- the real desktop SPA (served straight from the app's embedded assets,
    //      so remote clients get the identical UI, not a re-implementation) ----
    if req.method == "GET" {
        if path == "/" || path == "/index.html" {
            serve_index(stream, ctx);
            return;
        }
        // Static assets are the ONLY GETs served from disk. Crucially, do NOT
        // let the asset resolver's SPA fallback answer runtime API paths
        // (/event, /experimental/session, …) with index.html — that would break
        // EventSource (MIME text/html) and every JSON fetch (sessions / runs /
        // notebooks come back as HTML and render blank).
        if looks_static(path) {
            if !serve_asset(stream, ctx, path) {
                respond_json(stream, 404, "{\"error\":\"not found\"}");
            }
            return;
        }
        // Extensionless GET on a known client-side route → the SPA shell.
        let first = path.trim_matches('/').split('/').next().unwrap_or("");
        if SPA_ROOTS.contains(&first) {
            serve_index(stream, ctx);
            return;
        }
        // Anything else GET is a DSH API path → proxied below.
    }

    // ---- transparent DSH proxy (the SPA's DeepSeekHarnessClient talks here) ----
    if !authed(req, &ctx.token()) {
        respond_json(stream, 401, "{\"error\":\"unauthorized\"}");
        return;
    }
    if req.method == "GET"
        && matches!(path, "/api/events.mux" | "/api/events.host")
        && is_websocket_upgrade(req)
    {
        proxy_dsh_websocket(stream, req, ctx);
        return;
    }
    if let Some(method) = dsh_rpc_method(req) {
        if !ctx.desktop() && is_remote_privileged_method(method) {
            respond_json(
                stream,
                403,
                "{\"error\":\"runtime configuration is managed on the desktop\"}",
            );
            return;
        }
        if ctx.read_only() && !is_read_only_dsh_method(method) {
            respond_json(stream, 403, "{\"error\":\"token is read-only\"}");
            return;
        }
    } else if ctx.read_only() && req.method != "GET" {
        respond_json(stream, 403, "{\"error\":\"token is read-only\"}");
        return;
    }
    proxy_dsh_http(stream, req, ctx);
}

/// The versioned contract surface (CLI / curl / the SPA's file browser).
/// `rest` is the path after `/v1/`.
fn v1(stream: &mut TcpStream, req: &Request, ctx: &Ctx, rest: &str) {
    let segs: Vec<&str> = rest.trim_matches('/').split('/').collect();
    match (req.method.as_str(), segs.as_slice()) {
        ("GET", ["whoami"]) => {
            let mode = if ctx.read_only() { "read-only" } else { "full" };
            let payload = serde_json::json!({ "mode": mode, "directory": ws_dir(ctx) });
            respond_json(stream, 200, &payload.to_string());
        }
        ("GET", ["capabilities"]) => {
            // Keep this contract aligned with DeepSeekHarnessClient's
            // RuntimeCapabilities snapshot. The gateway reports the surface
            // restrictions separately so a web client can hide controls before
            // issuing an unsupported request.
            let payload = runtime_capabilities(ctx.desktop(), ctx.read_only());
            respond_json(stream, 200, &payload.to_string());
        }
        ("GET", ["sessions"]) => {
            forward_dsh_value(
                stream,
                upstream_dsh_rpc(ctx, "session.list", serde_json::json!({})),
            );
        }
        ("POST", ["sessions"]) => {
            let ws = ws_dir(ctx);
            if forward_dsh_value(
                stream,
                upstream_dsh_rpc(ctx, "session.create", serde_json::json!({ "cwd": ws })),
            ) {
                let _ = ctx.app.emit("gateway:sessions-changed", ());
            }
        }
        ("DELETE", ["sessions", _id]) => {
            respond_json(
                stream,
                501,
                "{\"error\":\"session deletion is not part of the DSH core API\"}",
            );
        }
        ("GET", ["sessions", id, "messages"]) => {
            forward_dsh_value(
                stream,
                upstream_dsh_rpc(
                    ctx,
                    "session.history",
                    serde_json::json!({ "sessionId": id, "maxMessages": 200 }),
                ),
            );
        }
        ("POST", ["sessions", id, "prompt"]) => {
            let text = json_str_field(&req.body, "text").unwrap_or_default();
            if text.trim().is_empty() {
                respond_json(stream, 400, "{\"error\":\"missing text\"}");
                return;
            }
            forward_dsh_value(
                stream,
                upstream_dsh_rpc(
                    ctx,
                    "session.prompt",
                    serde_json::json!({
                        "sessionId": id,
                        "mode": "queue",
                        "content": [{ "type": "text", "text": text }]
                    }),
                ),
            );
        }
        ("POST", ["sessions", id, "abort"]) => {
            forward_dsh_value(
                stream,
                upstream_dsh_rpc(
                    ctx,
                    "session.cancel",
                    serde_json::json!({ "sessionId": id }),
                ),
            );
        }
        ("GET", ["permissions"] | ["questions"]) | ("POST", ["permissions", _, "reply"]) => {
            respond_json(
                stream,
                501,
                "{\"error\":\"DSH interactions use the authenticated WebSocket RPC channel\"}",
            )
        }
        ("GET", ["fs", "list"]) => fs_list(stream, req, ctx),
        ("GET", ["fs", "read"]) => fs_read(stream, req, ctx),
        // Read-only projects + runs (local state the sidecar doesn't own) so the
        // web client can see existing projects and run history.
        ("GET", ["projects"]) => match crate::project::list_projects(ctx.app.clone()) {
            Ok(list) => respond_json(
                stream,
                200,
                &serde_json::to_string(&list).unwrap_or_else(|_| "[]".into()),
            ),
            Err(e) => respond_json(stream, 500, &err_json(&e)),
        },
        ("GET", ["runs"]) => match crate::runs::list_runs(ctx.app.clone()) {
            Ok(list) => respond_json(
                stream,
                200,
                &serde_json::to_string(&list).unwrap_or_else(|_| "[]".into()),
            ),
            Err(e) => respond_json(stream, 500, &err_json(&e)),
        },
        ("GET", ["runs", "query"]) => {
            let q = req.query_get("q").unwrap_or_else(|| "{}".into());
            match serde_json::from_str::<crate::runs_index::RunQuery>(&q) {
                Ok(query) => match crate::runs_index::query_runs_cmd(ctx.app.clone(), query) {
                    Ok(page) => respond_json(
                        stream,
                        200,
                        &serde_json::to_string(&page).unwrap_or_else(|_| "{}".into()),
                    ),
                    Err(e) => respond_json(stream, 500, &err_json(&e)),
                },
                Err(e) => respond_json(stream, 400, &err_json(&format!("bad query: {e}"))),
            }
        }
        ("GET", ["runs", "log"]) => {
            let hash = req.query_get("hash").unwrap_or_default();
            match crate::runs::read_run_log(ctx.app.clone(), hash) {
                Ok(text) => respond(stream, 200, "text/plain; charset=utf-8", text.as_bytes()),
                Err(e) => respond_json(stream, 404, &err_json(&e)),
            }
        }
        ("GET", ["events"]) => {
            respond_json(
                stream,
                501,
                "{\"error\":\"DSH events require WebSocket /api/events.mux and /api/events.host\"}",
            );
        }
        _ => respond_json(stream, 404, "{\"error\":\"not found\"}"),
    }
}

/// Serve the SPA shell (`index.html`) with a marker so it boots in web mode.
fn serve_index(stream: &mut TcpStream, ctx: &Ctx) {
    match ctx.app.asset_resolver().get("index.html".to_string()) {
        Some(asset) => {
            let html = String::from_utf8_lossy(&asset.bytes);
            let injected = html.replacen(
                "<head>",
                "<head><script>window.__OS_WEB__=true;</script>",
                1,
            );
            respond(stream, 200, "text/html; charset=utf-8", injected.as_bytes());
        }
        None => respond(
            stream,
            503,
            "text/plain; charset=utf-8",
            b"Frontend assets unavailable.",
        ),
    }
}

/// Whether a GET path is a static frontend asset (vs an OpenCode API path or a
/// client-side route). Vite emits everything hashed under `/assets/`; a few root
/// files carry a known extension. OpenCode paths and SPA routes are extensionless.
fn looks_static(path: &str) -> bool {
    if path.starts_with("/assets/") {
        return true;
    }
    let last = path.rsplit('/').next().unwrap_or("");
    match last.rsplit_once('.') {
        Some((_, ext)) => matches!(
            ext,
            "js" | "mjs"
                | "css"
                | "map"
                | "svg"
                | "png"
                | "jpg"
                | "jpeg"
                | "gif"
                | "webp"
                | "ico"
                | "woff"
                | "woff2"
                | "ttf"
                | "otf"
                | "json"
                | "wasm"
                | "txt"
                | "html"
        ),
        None => false,
    }
}

/// Serve a bundled static asset (JS/CSS/fonts/images). Returns false if there is
/// no such asset (the caller then decides: SPA route vs OpenCode proxy).
fn serve_asset(stream: &mut TcpStream, ctx: &Ctx, path: &str) -> bool {
    let key = path.trim_start_matches('/');
    match ctx.app.asset_resolver().get(key.to_string()) {
        Some(asset) => {
            respond(stream, 200, &asset.mime_type, &asset.bytes);
            true
        }
        None => false,
    }
}

/// Transparently proxy a DSH HTTP call to the loopback runtime. Gateway
/// credentials terminate here and are never forwarded to DSH.
fn proxy_dsh_http(stream: &mut TcpStream, req: &Request, ctx: &Ctx) {
    let base = match endpoint(ctx) {
        Some(v) => v,
        None => return respond_json(stream, 503, "{\"error\":\"runtime not started\"}"),
    };
    let upstream_query = query_without_gateway_token(&req.query);
    let target = if upstream_query.is_empty() {
        format!("{base}{}", req.path)
    } else {
        format!("{base}{}?{upstream_query}", req.path)
    };
    let method = match reqwest::Method::from_bytes(req.method.as_bytes()) {
        Ok(m) => m,
        Err(_) => return respond_json(stream, 400, "{\"error\":\"bad method\"}"),
    };
    let mut rb = shared_client().request(method, target);
    if !req.body.is_empty() {
        let ct = req
            .header("content-type")
            .unwrap_or("application/json")
            .to_string();
        rb = rb.header("Content-Type", ct).body(req.body.clone());
    }
    forward(stream, rb.send().map_err(|e| e.to_string()));
}

fn dsh_rpc_method(req: &Request) -> Option<&str> {
    if req.method != "POST" || req.path == "/api/respond" {
        return None;
    }
    req.path
        .strip_prefix("/api/")
        .filter(|method| !method.is_empty())
}

fn is_remote_privileged_method(method: &str) -> bool {
    method.starts_with("settings.")
        || (method.starts_with("credentials.") && method != "credentials.describe")
        || matches!(
            method,
            "llm.discoverModels"
                | "host.pickDirectory"
                | "host.openPath"
                | "agentPreset.read"
                | "agentPreset.copy"
                | "agentPreset.openDocument"
                | "agentPreset.remove"
        )
}

fn is_read_only_dsh_method(method: &str) -> bool {
    matches!(
        method,
        "host.describe"
            | "host.listDirectory"
            | "session.list"
            | "session.search"
            | "session.history"
            | "session.models"
            | "session.attachment"
            | "subagent.list"
            | "subagent.history"
            | "workspace.list"
            | "skill.list"
            | "agentPreset.list"
            | "llm.providers"
            | "llm.models"
            | "credentials.describe"
    )
}

fn is_websocket_upgrade(req: &Request) -> bool {
    req.header("upgrade")
        .is_some_and(|value| value.eq_ignore_ascii_case("websocket"))
        && req.header("connection").is_some_and(|value| {
            value
                .split(',')
                .any(|token| token.trim().eq_ignore_ascii_case("upgrade"))
        })
}

fn websocket_upstream_request(req: &Request, authority: &str) -> Vec<u8> {
    let mut head = format!(
        "GET {} HTTP/1.1\r\nHost: {authority}\r\nOrigin: http://{authority}\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n",
        req.path
    );
    for name in [
        "sec-websocket-key",
        "sec-websocket-version",
        "sec-websocket-protocol",
        "sec-websocket-extensions",
    ] {
        if let Some(value) = req.header(name) {
            head.push_str(name);
            head.push_str(": ");
            head.push_str(value);
            head.push_str("\r\n");
        }
    }
    head.push_str("\r\n");
    head.into_bytes()
}

fn read_http_head(stream: &mut TcpStream) -> std::io::Result<Vec<u8>> {
    const MAX_HEAD_BYTES: usize = 64 * 1024;
    let mut head = Vec::with_capacity(1024);
    let mut byte = [0u8; 1];
    while head.len() < MAX_HEAD_BYTES {
        stream.read_exact(&mut byte)?;
        head.push(byte[0]);
        if head.ends_with(b"\r\n\r\n") {
            return Ok(head);
        }
    }
    Err(std::io::Error::new(
        std::io::ErrorKind::InvalidData,
        "DSH WebSocket handshake headers are too large",
    ))
}

/// Relay the authenticated browser WebSocket to DSH's loopback-only downlink.
/// The external bearer/query token terminates at this gateway; Host and Origin
/// are rewritten to the sidecar authority so DSH's own rebinding fence remains
/// effective on the inner hop.
fn proxy_dsh_websocket(stream: &mut TcpStream, req: &Request, ctx: &Ctx) {
    let base = match endpoint(ctx) {
        Some(value) => value,
        None => return respond_json(stream, 503, "{\"error\":\"runtime not started\"}"),
    };
    let authority = base
        .strip_prefix("http://")
        .or_else(|| base.strip_prefix("https://"))
        .unwrap_or(&base)
        .trim_end_matches('/');
    let mut upstream = match TcpStream::connect(authority) {
        Ok(value) => value,
        Err(error) => {
            return respond_json(
                stream,
                502,
                &err_json(&format!("upstream websocket: {error}")),
            )
        }
    };
    let _ = upstream.set_read_timeout(Some(Duration::from_secs(10)));
    if let Err(error) = upstream.write_all(&websocket_upstream_request(req, authority)) {
        return respond_json(
            stream,
            502,
            &err_json(&format!("upstream websocket handshake: {error}")),
        );
    }
    let response_head = match read_http_head(&mut upstream) {
        Ok(value) => value,
        Err(error) => {
            return respond_json(
                stream,
                502,
                &err_json(&format!("upstream websocket handshake: {error}")),
            )
        }
    };
    if stream.write_all(&response_head).is_err() || stream.flush().is_err() {
        return;
    }
    let switched =
        response_head.starts_with(b"HTTP/1.1 101 ") || response_head.starts_with(b"HTTP/1.0 101 ");
    if !switched {
        let _ = std::io::copy(&mut upstream, stream);
        return;
    }
    let _ = upstream.set_read_timeout(None);

    let mut client_reader = match stream.try_clone() {
        Ok(value) => value,
        Err(_) => return,
    };
    let mut upstream_writer = match upstream.try_clone() {
        Ok(value) => value,
        Err(_) => return,
    };
    let client_to_upstream = std::thread::spawn(move || {
        let _ = std::io::copy(&mut client_reader, &mut upstream_writer);
        let _ = upstream_writer.shutdown(Shutdown::Write);
    });
    let _ = std::io::copy(&mut upstream, stream);
    let _ = upstream.shutdown(Shutdown::Both);
    let _ = stream.shutdown(Shutdown::Both);
    let _ = client_to_upstream.join();
}

// ---- workspace file routes (reuse artifact_file, sandboxed) -----------------

/// Resolve which directory a file request is scoped to. A web client viewing a
/// session that is NOT the host's active one passes that session's absolute
/// `dir` (from its SessionMeta); we accept it only if it sits under the base
/// workspace (so a client can't read arbitrary paths). Otherwise fall back to
/// the `root` scope (workspace = host active, base = the base folder).
fn fs_base(ctx: &Ctx, req: &Request) -> Result<PathBuf, String> {
    if let Some(dir) = req.query_get("dir").filter(|d| !d.is_empty()) {
        return crate::artifact_file::session_scope_root(&ctx.app, &dir);
    }
    scope_root(&ctx.app, req.query_get("root").as_deref())
}

fn fs_list(stream: &mut TcpStream, req: &Request, ctx: &Ctx) {
    let rel = req.query_get("path").unwrap_or_default();
    let base = match fs_base(ctx, req) {
        Ok(b) => b,
        Err(e) => return respond_json(stream, 400, &err_json(&e)),
    };
    match crate::artifact_file::dir_entries(&base, &rel) {
        Ok(entries) => {
            let json = serde_json::to_string(&entries).unwrap_or_else(|_| "[]".into());
            respond_json(stream, 200, &json);
        }
        Err(e) => respond_json(stream, 400, &err_json(&e)),
    }
}

fn fs_read(stream: &mut TcpStream, req: &Request, ctx: &Ctx) {
    let rel = req.query_get("path").unwrap_or_default();
    let base = match fs_base(ctx, req) {
        Ok(b) => b,
        Err(e) => return respond_json(stream, 400, &err_json(&e)),
    };
    // Resolve by basename like the desktop preview server: agent prose often
    // names a file without its directory ("figure1.png" for "figures/figure1.png").
    let located = locate_under(&base, &rel).unwrap_or(rel);
    let full = match resolve_under(&base, &located) {
        Ok(p) => p,
        Err(e) => return respond_json(stream, 404, &err_json(&e)),
    };
    let ext = full.extension().and_then(|s| s.to_str()).unwrap_or("");
    let (mime, _is_text) = mime_for(ext);
    match std::fs::read(&full) {
        Ok(bytes) => respond(stream, 200, mime, &bytes),
        Err(e) => respond_json(stream, 404, &err_json(&e.to_string())),
    }
}

// ---- upstream proxy helpers -------------------------------------------------

fn shared_client() -> &'static reqwest::blocking::Client {
    static C: OnceLock<reqwest::blocking::Client> = OnceLock::new();
    C.get_or_init(|| {
        reqwest::blocking::Client::builder()
            .timeout(Duration::from_secs(120))
            .build()
            .expect("build reqwest client")
    })
}

/// Sidecar base URL or None if the runtime is not up.
fn endpoint(ctx: &Ctx) -> Option<String> {
    let base = sidecar_url(ctx.app.state::<RuntimeState>().inner())?;
    Some(base)
}

fn ws_dir(ctx: &Ctx) -> String {
    workspace_dir(&ctx.app)
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_default()
}

type UpstreamResult = Result<reqwest::blocking::Response, String>;

struct DshRpcUpstream {
    response: reqwest::blocking::Response,
    rpc_id: String,
}

type DshRpcResult = Result<DshRpcUpstream, String>;

fn upstream_dsh_rpc(ctx: &Ctx, method: &str, payload: serde_json::Value) -> DshRpcResult {
    let base = endpoint(ctx).ok_or_else(|| "runtime not started".to_string())?;
    let rpc_id = format!("gateway-{}", random_hex(12));
    let body = serde_json::json!({
        "type": "client-request",
        "rpcId": rpc_id,
        "method": method,
        "payload": payload,
    });
    let response = shared_client()
        .post(format!("{base}/api/{method}"))
        .header("Content-Type", "application/json")
        .body(body.to_string())
        .send()
        .map_err(|error| error.to_string())?;
    Ok(DshRpcUpstream { response, rpc_id })
}

/// Translate the DSH ServerResponse envelope into the value/error shape kept
/// by the versioned gateway compatibility surface.
fn forward_dsh_value(stream: &mut TcpStream, upstream: DshRpcResult) -> bool {
    let DshRpcUpstream { response, rpc_id } = match upstream {
        Ok(value) => value,
        Err(error) => {
            respond_json(stream, 502, &err_json(&format!("upstream: {error}")));
            return false;
        }
    };
    let status = response.status().as_u16();
    let bytes = response
        .bytes()
        .map(|value| value.to_vec())
        .unwrap_or_default();
    if !(200..300).contains(&status) {
        respond(stream, status, "application/json; charset=utf-8", &bytes);
        return false;
    }
    let envelope: serde_json::Value = match serde_json::from_slice(&bytes) {
        Ok(value) => value,
        Err(error) => {
            respond_json(
                stream,
                502,
                &err_json(&format!("invalid DSH RPC response: {error}")),
            );
            return false;
        }
    };
    if envelope.get("rpcId").and_then(serde_json::Value::as_str) != Some(rpc_id.as_str()) {
        respond_json(stream, 502, "{\"error\":\"DSH RPC correlation mismatch\"}");
        return false;
    }
    let result = envelope
        .get("result")
        .cloned()
        .unwrap_or(serde_json::Value::Null);
    if result.get("ok").and_then(serde_json::Value::as_bool) != Some(true) {
        let error = result.get("error").cloned().unwrap_or_else(|| {
            serde_json::json!({
                "code": "internal",
                "message": "DSH RPC failed without an error payload"
            })
        });
        respond_json(stream, 409, &error.to_string());
        return false;
    }
    let value = result
        .get("value")
        .cloned()
        .unwrap_or(serde_json::Value::Null);
    respond_json(stream, 200, &value.to_string());
    true
}

/// Forward an upstream response to the client; returns whether it was 2xx.
fn forward(stream: &mut TcpStream, resp: UpstreamResult) -> bool {
    match resp {
        Ok(r) => {
            let status = r.status().as_u16();
            let ct = r
                .headers()
                .get(reqwest::header::CONTENT_TYPE)
                .and_then(|v| v.to_str().ok())
                .unwrap_or("application/json")
                .to_string();
            let body = r.bytes().map(|b| b.to_vec()).unwrap_or_default();
            respond(stream, status, &ct, &body);
            (200..300).contains(&status)
        }
        Err(e) => {
            respond_json(stream, 502, &err_json(&format!("upstream: {e}")));
            false
        }
    }
}

// ---- auth + HTTP plumbing ---------------------------------------------------

fn authed(req: &Request, token: &str) -> bool {
    if let Some(h) = req.header("authorization") {
        if let Some(t) = h.strip_prefix("Bearer ") {
            if ct_eq(t.trim(), token) {
                return true;
            }
        }
    }
    // WebSocket clients cannot set an Authorization header, so their gateway
    // credential is carried in the query string and terminated here.
    if let Some(t) = req.query_get("token") {
        if ct_eq(&t, token) {
            return true;
        }
    }
    false
}

/// Length-independent-ish constant-time compare, so token checks don't leak
/// length or a prefix by timing.
fn ct_eq(a: &str, b: &str) -> bool {
    let (a, b) = (a.as_bytes(), b.as_bytes());
    if a.len() != b.len() {
        return false;
    }
    let mut diff = 0u8;
    for i in 0..a.len() {
        diff |= a[i] ^ b[i];
    }
    diff == 0
}

fn reason(status: u16) -> &'static str {
    match status {
        200 => "OK",
        201 => "Created",
        400 => "Bad Request",
        401 => "Unauthorized",
        403 => "Forbidden",
        404 => "Not Found",
        409 => "Conflict",
        501 => "Not Implemented",
        500 => "Internal Server Error",
        502 => "Bad Gateway",
        503 => "Service Unavailable",
        _ => "OK",
    }
}

fn respond(stream: &mut TcpStream, status: u16, content_type: &str, body: &[u8]) {
    let cors = RESPONSE_CORS_ORIGIN.with(|value| {
        value
            .borrow()
            .as_deref()
            .map(|origin| format!("Access-Control-Allow-Origin: {origin}\r\nVary: Origin\r\n"))
            .unwrap_or_default()
    });
    let head = format!(
        "HTTP/1.1 {status} {}\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\n{cors}X-Content-Type-Options: nosniff\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n",
        reason(status),
        body.len()
    );
    let _ = stream.write_all(head.as_bytes());
    let _ = stream.write_all(body);
    let _ = stream.flush();
}

fn respond_json(stream: &mut TcpStream, status: u16, json: &str) {
    respond(
        stream,
        status,
        "application/json; charset=utf-8",
        json.as_bytes(),
    );
}

fn err_json(msg: &str) -> String {
    serde_json::json!({ "error": msg }).to_string()
}

fn query_get(query: &str, key: &str) -> Option<String> {
    for pair in query.split('&') {
        if let Some((k, v)) = pair.split_once('=') {
            if k == key {
                return Some(percent_decode(v));
            }
        }
    }
    None
}

fn query_without_gateway_token(query: &str) -> String {
    query
        .split('&')
        .filter(|pair| {
            let key = pair.split_once('=').map_or(*pair, |(key, _)| key);
            key != "token" && key != "auth_token"
        })
        .filter(|pair| !pair.is_empty())
        .collect::<Vec<_>>()
        .join("&")
}

fn percent_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'+' => {
                out.push(b' ');
                i += 1;
            }
            b'%' => {
                let hex = bytes
                    .get(i + 1..i + 3)
                    .and_then(|h| std::str::from_utf8(h).ok());
                if let Some(v) = hex.and_then(|h| u8::from_str_radix(h, 16).ok()) {
                    out.push(v);
                    i += 3;
                } else {
                    out.push(b'%');
                    i += 1;
                }
            }
            c => {
                out.push(c);
                i += 1;
            }
        }
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// Pull a top-level string field out of a small JSON body without a full model.
fn json_str_field(body: &[u8], field: &str) -> Option<String> {
    let v: serde_json::Value = serde_json::from_slice(body).ok()?;
    v.get(field)?.as_str().map(|s| s.to_string())
}

// ---- Tauri commands ---------------------------------------------------------

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GatewayStatus {
    enabled: bool,
    lan: bool,
    mode: String,
    running: bool,
    port: Option<u16>,
    loopback_url: Option<String>,
    lan_url: Option<String>,
    token: String,
}

/// The LAN IP the machine would use to reach the internet — found without
/// sending a packet (UDP connect just picks the route). None when offline.
fn local_ip() -> Option<String> {
    let s = std::net::UdpSocket::bind("0.0.0.0:0").ok()?;
    s.connect("8.8.8.8:80").ok()?;
    s.local_addr().ok().map(|a| a.ip().to_string())
}

fn status_of(app: &AppHandle, state: &GatewayState) -> GatewayStatus {
    let p = read_persisted(app);
    let (running, port) = match state.0.lock().unwrap().as_ref() {
        Some(r) => (true, Some(r.port)),
        None => (false, None),
    };
    let loopback_url = port.map(|pt| format!("http://127.0.0.1:{pt}"));
    let lan_url = if p.lan {
        port.and_then(|pt| local_ip().map(|ip| format!("http://{ip}:{pt}")))
    } else {
        None
    };
    GatewayStatus {
        enabled: p.enabled,
        lan: p.lan,
        mode: p.mode,
        running,
        port,
        loopback_url,
        lan_url,
        token: p.token,
    }
}

#[tauri::command]
pub fn gateway_status(app: AppHandle, state: State<'_, GatewayState>) -> GatewayStatus {
    status_of(&app, state.inner())
}

#[tauri::command(async)]
pub fn set_gateway_config(
    app: AppHandle,
    state: State<'_, GatewayState>,
    enabled: bool,
    lan: bool,
    mode: String,
) -> Result<GatewayStatus, String> {
    let mut p = read_persisted(&app);
    p.enabled = enabled;
    p.lan = lan;
    p.mode = normalize_mode(&mode);
    if p.enabled && p.token.is_empty() {
        p.token = random_hex(24);
    }
    write_persisted(&app, &p)?;
    if !p.enabled {
        stop(state.inner());
        return Ok(status_of(&app, state.inner()));
    }
    // If already running on the same binding, update token/mode IN PLACE so the
    // port never changes; only first-enable or a loopback↔LAN switch rebinds.
    let updated_in_place = {
        let guard = state.inner().0.lock().unwrap();
        match guard.as_ref() {
            Some(r) if r.lan == p.lan => {
                *r.shared.token.lock().unwrap() = p.token.clone();
                r.shared
                    .read_only
                    .store(p.mode == "read-only", Ordering::Relaxed);
                true
            }
            _ => false,
        }
    };
    if !updated_in_place {
        start(&app, state.inner(), &p)?;
    }
    Ok(status_of(&app, state.inner()))
}

#[tauri::command(async)]
pub fn regenerate_gateway_token(
    app: AppHandle,
    state: State<'_, GatewayState>,
) -> Result<GatewayStatus, String> {
    let mut p = read_persisted(&app);
    p.token = random_hex(24);
    write_persisted(&app, &p)?;
    // Rotate the live token in place — the listener keeps running on the same
    // port (no rebind), so the URL a client bookmarked stays valid.
    if let Some(r) = state.inner().0.lock().unwrap().as_ref() {
        *r.shared.token.lock().unwrap() = p.token.clone();
    }
    Ok(status_of(&app, state.inner()))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request(method: &str, path: &str, query: &str, headers: &[(&str, &str)]) -> Request {
        Request {
            method: method.into(),
            path: path.into(),
            query: query.into(),
            headers: headers
                .iter()
                .map(|(name, value)| ((*name).into(), (*value).into()))
                .collect(),
            body: Vec::new(),
        }
    }

    #[test]
    fn ct_eq_matches_only_identical() {
        assert!(ct_eq("abc123", "abc123"));
        assert!(!ct_eq("abc123", "abc124"));
        assert!(!ct_eq("abc", "abcd"));
        assert!(!ct_eq("", "x"));
    }

    #[test]
    fn query_get_decodes() {
        assert_eq!(
            query_get("path=a%2Fb&root=base", "path").as_deref(),
            Some("a/b")
        );
        assert_eq!(
            query_get("path=a%2Fb&root=base", "root").as_deref(),
            Some("base")
        );
        assert_eq!(query_get("path=x", "missing"), None);
    }

    #[test]
    fn json_str_field_reads_top_level() {
        assert_eq!(
            json_str_field(br#"{"text":"hi","n":1}"#, "text").as_deref(),
            Some("hi")
        );
        assert_eq!(json_str_field(br#"{"text":"hi"}"#, "reply"), None);
        assert_eq!(json_str_field(b"not json", "text"), None);
    }

    #[test]
    fn gateway_auth_accepts_only_bearer_or_token_query() {
        assert!(authed(
            &request(
                "POST",
                "/api/session.list",
                "",
                &[("authorization", "Bearer secret")]
            ),
            "secret"
        ));
        assert!(authed(
            &request("GET", "/api/events.mux", "token=secret", &[]),
            "secret"
        ));
        assert!(!authed(
            &request(
                "POST",
                "/api/session.list",
                "",
                &[("authorization", "Basic c2VjcmV0")]
            ),
            "secret"
        ));
        assert!(!authed(
            &request("GET", "/api/events.mux", "auth_token=secret", &[]),
            "secret"
        ));
    }

    #[test]
    fn desktop_bridge_allows_only_tauri_origins() {
        assert_eq!(
            desktop_cors_origin(Some("http://tauri.localhost")),
            Some("http://tauri.localhost")
        );
        assert_eq!(
            desktop_cors_origin(Some("tauri://localhost")),
            Some("tauri://localhost")
        );
        assert_eq!(desktop_cors_origin(Some("https://evil.example")), None);
        assert_eq!(desktop_cors_origin(None), None);
    }

    #[test]
    fn only_static_looking_paths_are_assets() {
        // Assets → served from disk.
        assert!(looks_static("/assets/index-CK0bI0S9.js"));
        assert!(looks_static("/assets/index-abc.css"));
        assert!(looks_static("/favicon.ico"));
        // DSH API paths must not be treated as assets.
        assert!(!looks_static("/api/session.list"));
        assert!(!looks_static("/api/events.mux"));
        // SPA routes → extensionless, also not assets.
        assert!(!looks_static("/settings"));
        assert!(!looks_static("/live/ses_abc"));
    }

    #[test]
    fn websocket_upgrade_requires_both_headers() {
        assert!(is_websocket_upgrade(&request(
            "GET",
            "/api/events.mux",
            "token=secret",
            &[
                ("connection", "keep-alive, Upgrade"),
                ("upgrade", "WebSocket")
            ],
        )));
        assert!(!is_websocket_upgrade(&request(
            "GET",
            "/api/events.mux",
            "token=secret",
            &[("upgrade", "websocket")],
        )));
    }

    #[test]
    fn websocket_handshake_rewrites_authority_and_drops_gateway_credentials() {
        let req = request(
            "GET",
            "/api/events.host",
            "token=gateway-secret",
            &[
                ("host", "remote.example"),
                ("origin", "https://remote.example"),
                ("authorization", "Bearer gateway-secret"),
                ("sec-websocket-key", "abc123"),
                ("sec-websocket-version", "13"),
            ],
        );
        let head = String::from_utf8(websocket_upstream_request(&req, "127.0.0.1:4096")).unwrap();
        assert!(head.starts_with("GET /api/events.host HTTP/1.1\r\n"));
        assert!(head.contains("Host: 127.0.0.1:4096\r\n"));
        assert!(head.contains("Origin: http://127.0.0.1:4096\r\n"));
        assert!(head.contains("sec-websocket-key: abc123\r\n"));
        assert!(!head.contains("gateway-secret"));
        assert!(!head.to_ascii_lowercase().contains("authorization"));
        assert!(!head.contains("remote.example"));
    }

    #[test]
    fn gateway_token_is_removed_from_upstream_query() {
        assert_eq!(query_without_gateway_token("token=secret"), "");
        assert_eq!(
            query_without_gateway_token("x=1&token=secret&y=2"),
            "x=1&y=2"
        );
        assert_eq!(query_without_gateway_token("auth_token=legacy&x=1"), "x=1");
    }

    #[test]
    fn dsh_remote_policy_blocks_privileged_and_limits_read_only_methods() {
        assert!(is_remote_privileged_method("settings.set"));
        assert!(is_remote_privileged_method("credentials.put"));
        assert!(!is_remote_privileged_method("credentials.describe"));
        assert!(is_remote_privileged_method("llm.discoverModels"));
        assert!(!is_remote_privileged_method("session.prompt"));

        assert!(is_read_only_dsh_method("session.list"));
        assert!(is_read_only_dsh_method("session.history"));
        assert!(is_read_only_dsh_method("llm.models"));
        assert!(is_read_only_dsh_method("credentials.describe"));
        assert!(!is_read_only_dsh_method("session.create"));
        assert!(!is_read_only_dsh_method("session.prompt"));
    }

    #[test]
    fn capabilities_match_dsh_and_token_policy() {
        let full_web = runtime_capabilities(false, false);
        assert_eq!(full_web["runtime"], "dsh");
        assert_eq!(full_web["sessions"]["delete"], false);
        assert_eq!(full_web["sessions"]["unarchive"], false);
        assert_eq!(full_web["sessions"]["revert"], true);
        assert_eq!(full_web["surfaces"]["web"], true);
        assert_eq!(full_web["configuration"]["providers"], false);
        assert_eq!(full_web["execution"]["toolAdmission"], "server");

        let read_only_web = runtime_capabilities(false, true);
        assert_eq!(read_only_web["sessions"]["create"], false);
        assert_eq!(read_only_web["sessions"]["archive"], false);
        assert_eq!(read_only_web["sessions"]["revert"], false);
        assert_eq!(read_only_web["interaction"]["permissions"], false);
        assert_eq!(read_only_web["execution"]["shell"], false);
        assert_eq!(read_only_web["execution"]["toolAdmission"], "server");
        assert_eq!(read_only_web["surfaces"]["readOnlyWeb"], true);

        let desktop = runtime_capabilities(true, false);
        assert_eq!(desktop["configuration"]["providers"], true);
        assert_eq!(desktop["surfaces"]["desktop"], true);
        assert_eq!(desktop["surfaces"]["web"], false);
    }

    #[test]
    fn accepted_socket_is_blocking_so_large_bodies_are_not_truncated() {
        // Regression: a non-blocking listener yields non-blocking accepted
        // sockets on Unix; without forcing them back to blocking, write_all of a
        // large asset returns WouldBlock mid-write → the browser sees fewer bytes
        // than Content-Length (ERR_CONTENT_LENGTH_MISMATCH). This asserts the
        // full body arrives over the exact accept pattern start() uses.
        use std::io::Read as _;
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        listener.set_nonblocking(true).unwrap();
        let port = listener.local_addr().unwrap().port();
        let payload = vec![b'x'; 5 * 1024 * 1024]; // 5 MiB, well past a socket buffer
        let expected = payload.len();

        let server = std::thread::spawn(move || loop {
            match listener.accept() {
                Ok((mut s, _)) => {
                    s.set_nonblocking(false).unwrap(); // the fix under test
                    let head = format!("HTTP/1.1 200 OK\r\nContent-Length: {expected}\r\nConnection: close\r\n\r\n");
                    s.write_all(head.as_bytes()).unwrap();
                    s.write_all(&payload).unwrap();
                    s.flush().unwrap();
                    return;
                }
                Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                    std::thread::sleep(Duration::from_millis(5));
                }
                Err(_) => return,
            }
        });

        let mut c = loop {
            match TcpStream::connect(("127.0.0.1", port)) {
                Ok(c) => break c,
                Err(_) => std::thread::sleep(Duration::from_millis(5)),
            }
        };
        let mut buf = Vec::new();
        c.read_to_end(&mut buf).unwrap();
        server.join().unwrap();

        let sep = buf.windows(4).position(|w| w == b"\r\n\r\n").unwrap();
        let body_len = buf.len() - (sep + 4);
        assert_eq!(
            body_len, expected,
            "body truncated: got {body_len} of {expected}"
        );
    }

    #[test]
    fn normalize_mode_only_two_values() {
        assert_eq!(normalize_mode("read-only"), "read-only");
        assert_eq!(normalize_mode("full"), "full");
        assert_eq!(normalize_mode("garbage"), "full");
    }
}
