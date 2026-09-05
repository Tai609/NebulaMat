use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use serde_json::Value;
#[cfg(windows)]
use tauri::path::BaseDirectory;
use tauri::{AppHandle, Manager};

const MODELS_DEV_URLS: &[&str] = &["https://models.dev/api.json", "https://models.dev/api"];
const OPENCODE_GO_MODELS_URL: &str = "https://opencode.ai/zen/go/v1/models";
const MODELS_DEV_MAX_BYTES: usize = 32 * 1024 * 1024;
const MODELS_DEV_TIMEOUT: Duration = Duration::from_secs(20);
// Bump this whenever the route filtering/merge semantics change. Older
// snapshots may contain protocols that the bundled DSH adapter cannot serve;
// accepting them would keep the whole llm-pi-ai namespace unavailable after an
// offline refresh.
const MODEL_CATALOG_SCHEMA_VERSION: u32 = 2;

// Keep this list synchronized with the protocols accepted by the bundled
// `@deepseek-ai/dsh-llm-pi-ai` adapter. Models.dev contains integrations that
// pi-ai knows about but this DSH adapter deliberately does not serve. Keeping
// those routes out of settings.yaml is important: one invalid provider profile
// rejects the whole `llm-pi-ai` settings namespace, hiding every valid route.
const SUPPORTED_PI_AI_APIS: &[&str] = &[
    "anthropic-messages",
    "openai-completions",
    "openai-responses",
];

const SUPPORTED_PI_AI_REASONING_LEVELS: &[&str] =
    &["off", "minimal", "low", "medium", "high", "xhigh", "max"];

#[derive(Clone, Debug, Deserialize, Serialize)]
struct ModelCatalogCache {
    schema_version: u32,
    fetched_at: u64,
    source: String,
    managed_route_ids: Vec<String>,
    routes: Vec<ModelCatalogRoute>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
struct ModelCatalogRoute {
    id: String,
    display_name: String,
    api: String,
    base_url: String,
    models: Vec<ModelCatalogModel>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
struct ModelCatalogModel {
    id: String,
    name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    context_window: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    max_tokens: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    input: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    reasoning_efforts: Option<BTreeMap<String, Option<String>>>,
}

#[derive(Default)]
struct ProviderHints {
    models: BTreeMap<String, (String, String)>,
    by_api: BTreeMap<String, String>,
    default: Option<(String, String)>,
}

type StaticHints = BTreeMap<String, ProviderHints>;

fn cache_path(dsh_home: &Path) -> PathBuf {
    dsh_home.join("model-catalog.json")
}

fn valid_catalog_id(value: &str) -> bool {
    let value = value.trim();
    !value.is_empty()
        && value.len() <= 160
        && !value
            .chars()
            .any(|ch| ch.is_control() || ch == '/' || ch == '\\')
}

fn valid_model_id(value: &str) -> bool {
    let value = value.trim();
    !value.is_empty() && value.len() <= 240 && !value.chars().any(|ch| ch.is_control())
}

fn json_string(value: &Value, keys: &[&str]) -> Option<String> {
    keys.iter()
        .filter_map(|key| value.get(*key).and_then(Value::as_str))
        .map(str::trim)
        .find(|value| !value.is_empty())
        .map(str::to_owned)
}

fn json_positive_u64(value: &Value, keys: &[&str]) -> Option<u64> {
    for key in keys {
        let candidate = value.get(*key).and_then(|value| {
            value
                .as_u64()
                .or_else(|| value.as_i64().and_then(|number| u64::try_from(number).ok()))
        });
        if let Some(candidate) = candidate.filter(|number| *number > 0) {
            return Some(candidate);
        }
    }
    None
}

fn nested_positive_u64(value: &Value, parent: &str, keys: &[&str]) -> Option<u64> {
    value
        .get(parent)
        .and_then(|parent| json_positive_u64(parent, keys))
}

fn normalize_catalog_api(raw: &str) -> Option<String> {
    let normalized = raw.trim().to_ascii_lowercase();
    let normalized = match normalized.as_str() {
        "openai-chat" | "openai-chat-completions" | "openai.completions" => "openai-completions",
        "openai.responses" => "openai-responses",
        "anthropic" => "anthropic-messages",
        other => other,
    };
    SUPPORTED_PI_AI_APIS
        .contains(&normalized)
        .then(|| normalized.to_owned())
}

fn normalize_provider_npm(raw: &str) -> Option<String> {
    let npm = raw.trim().to_ascii_lowercase();
    let api = if npm.contains("anthropic") {
        "anthropic-messages"
    } else if npm.contains("google") || npm.contains("gemini") {
        "google-generative-ai"
    } else if npm.contains("mistral") {
        "mistral-conversations"
    } else if npm.contains("bedrock") || npm.contains("aws") {
        "bedrock-converse-stream"
    } else if npm.contains("azure") {
        "azure-openai-responses"
    } else if npm.contains("openai") || npm.contains("compatible") {
        "openai-completions"
    } else {
        return None;
    };
    normalize_catalog_api(api)
}

fn provider_endpoint(value: &Value) -> Option<String> {
    let endpoint = json_string(
        value,
        &["baseUrl", "baseURL", "base_url", "endpoint", "url", "api"],
    )?;
    (endpoint.starts_with("http://") || endpoint.starts_with("https://")).then_some(endpoint)
}

fn catalog_model_input(value: &Value) -> Option<Vec<String>> {
    let input = value
        .get("input")
        .or_else(|| {
            value
                .get("modalities")
                .and_then(|modalities| modalities.get("input"))
        })
        .and_then(Value::as_array)?;
    let values: Vec<String> = input
        .iter()
        .filter_map(Value::as_str)
        .map(str::to_ascii_lowercase)
        .filter(|value| matches!(value.as_str(), "text" | "image"))
        .collect();
    (!values.is_empty()).then_some(values)
}

fn catalog_reasoning_efforts(value: &Value) -> Option<BTreeMap<String, Option<String>>> {
    if let Some(options) = value.get("reasoning_options").and_then(Value::as_array) {
        let mut efforts = BTreeMap::new();
        for option in options {
            let Some(kind) = option.get("type").and_then(Value::as_str) else {
                continue;
            };
            if kind == "effort" {
                if let Some(values) = option.get("values").and_then(Value::as_array) {
                    for value in values
                        .iter()
                        .filter_map(Value::as_str)
                        .filter(|value| SUPPORTED_PI_AI_REASONING_LEVELS.contains(value))
                    {
                        efforts.insert(value.to_owned(), Some(value.to_owned()));
                    }
                }
            } else if kind == "toggle" {
                efforts.entry("off".to_owned()).or_insert(None);
                efforts
                    .entry("high".to_owned())
                    .or_insert(Some("high".to_owned()));
            }
        }
        if !efforts.is_empty() {
            return Some(efforts);
        }
    }
    let source = value
        .get("thinkingLevelMap")
        .or_else(|| value.get("thinking_level_map"))
        .or_else(|| value.get("reasoningEfforts"))
        .or_else(|| value.get("reasoning_efforts"))
        .and_then(Value::as_object)?;
    let mut efforts = BTreeMap::new();
    for &key in SUPPORTED_PI_AI_REASONING_LEVELS {
        if let Some(value) = source.get(key) {
            efforts.insert(key.to_owned(), value.as_str().map(str::to_owned));
        }
    }
    (!efforts.is_empty()).then_some(efforts)
}

/// Parse both the current Models.dev provider map and the older envelope form
/// (`{"providers": {...}}`). Unsupported integrations are ignored so an
/// upstream addition cannot make the entire llm-pi-ai namespace invalid.
fn parse_models_dev_catalog_with_hints(
    root: &Value,
    hints: Option<&StaticHints>,
) -> Result<Vec<ModelCatalogRoute>, String> {
    let providers = root
        .get("providers")
        .unwrap_or(root)
        .as_object()
        .ok_or_else(|| "Models.dev response has no provider map".to_owned())?;
    let mut groups: BTreeMap<(String, String, String), (String, Vec<ModelCatalogModel>)> =
        BTreeMap::new();

    for (provider_id, provider_value) in providers {
        if !valid_catalog_id(provider_id) {
            continue;
        }
        let Some(provider_object) = provider_value.as_object() else {
            continue;
        };
        let provider_name = json_string(provider_value, &["name", "displayName"])
            .unwrap_or_else(|| provider_id.to_owned());
        let provider_api = json_string(provider_value, &["protocol"])
            .and_then(|value| normalize_catalog_api(&value))
            .or_else(|| {
                json_string(provider_value, &["api"])
                    .and_then(|value| normalize_catalog_api(&value))
            })
            .or_else(|| {
                json_string(provider_value, &["npm"])
                    .and_then(|value| normalize_provider_npm(&value))
            });
        let provider_npm = json_string(provider_value, &["npm"]);
        let hinted_provider_api = hints
            .and_then(|all| all.get(provider_id))
            .and_then(|hint| hint.default.as_ref())
            .map(|(api, _)| api.clone());
        let provider_base_url = provider_endpoint(provider_value).or_else(|| {
            hints
                .and_then(|all| all.get(provider_id))
                .and_then(|hint| hint.default.as_ref())
                .map(|(_, url)| url.clone())
        });
        let Some(models) = provider_object.get("models").and_then(Value::as_object) else {
            continue;
        };

        for (model_key, model_value) in models {
            let Some(_model_object) = model_value.as_object() else {
                continue;
            };
            let model_id = json_string(model_value, &["id"])
                .filter(|id| valid_model_id(id))
                .unwrap_or_else(|| model_key.to_owned());
            if !valid_model_id(&model_id) {
                continue;
            }
            let model_hint = hints
                .and_then(|all| all.get(provider_id))
                .and_then(|hint| hint.models.get(model_key));
            let model_provider_npm = model_value
                .get("provider")
                .and_then(|provider| provider.get("npm"))
                .and_then(Value::as_str);
            let Some(api) = json_string(model_value, &["protocol"])
                .or_else(|| json_string(model_value, &["api"]))
                .or_else(|| model_provider_npm.and_then(normalize_provider_npm))
                .or_else(|| model_hint.map(|(api, _)| api.clone()))
                .or_else(|| provider_api.clone())
                .or_else(|| hinted_provider_api.clone())
                .or_else(|| provider_npm.as_deref().and_then(normalize_provider_npm))
                .and_then(|value| normalize_catalog_api(&value))
            else {
                continue;
            };
            let Some(base_url) = provider_endpoint(model_value)
                .or_else(|| provider_base_url.clone())
                .or_else(|| {
                    hints
                        .and_then(|all| all.get(provider_id))
                        .and_then(|hint| hint.by_api.get(&api))
                        .cloned()
                })
                .or_else(|| model_hint.map(|(_, url)| url.clone()))
            else {
                continue;
            };
            if !base_url.starts_with("http://") && !base_url.starts_with("https://") {
                continue;
            }
            let model = ModelCatalogModel {
                id: model_id,
                name: json_string(model_value, &["name", "displayName"])
                    .unwrap_or_else(|| model_key.to_owned()),
                context_window: json_positive_u64(
                    model_value,
                    &[
                        "contextWindow",
                        "context_window",
                        "contextLength",
                        "context_length",
                    ],
                )
                .or_else(|| nested_positive_u64(model_value, "limit", &["context"]))
                .or_else(|| nested_positive_u64(model_value, "limits", &["context"])),
                max_tokens: json_positive_u64(
                    model_value,
                    &[
                        "maxTokens",
                        "max_tokens",
                        "maxOutputTokens",
                        "max_output_tokens",
                    ],
                )
                .or_else(|| nested_positive_u64(model_value, "limit", &["output"]))
                .or_else(|| nested_positive_u64(model_value, "limits", &["output"])),
                input: catalog_model_input(model_value),
                reasoning_efforts: catalog_reasoning_efforts(model_value),
            };
            groups
                .entry((provider_id.to_owned(), api, base_url))
                .or_insert_with(|| (provider_name.clone(), Vec::new()))
                .1
                .push(model);
        }
    }

    let mut provider_group_counts = BTreeMap::<String, usize>::new();
    for (provider, _, _) in groups.keys() {
        *provider_group_counts.entry(provider.clone()).or_default() += 1;
    }
    let mut used_ids = BTreeSet::new();
    let mut routes = Vec::new();
    for ((provider, api, base_url), (display_name, mut models)) in groups {
        models.sort_by(|a, b| a.id.cmp(&b.id));
        if models.is_empty() {
            continue;
        }
        // Keep the conventional provider id for the dominant OpenAI-compatible
        // route. Existing credentials are normally stored under that id; the
        // less common protocols get deterministic suffixes.
        let base_id = if provider_group_counts.get(&provider) == Some(&1)
            || (api == "openai-completions"
                && provider_group_counts
                    .get(&provider)
                    .copied()
                    .unwrap_or_default()
                    > 1)
        {
            provider.clone()
        } else {
            let api_slug: String = api
                .chars()
                .map(|ch| if ch.is_ascii_alphanumeric() { ch } else { '-' })
                .collect();
            format!("{provider}--{api_slug}")
        };
        let mut route_id = base_id.clone();
        let mut suffix = 2;
        while !used_ids.insert(route_id.clone()) {
            route_id = format!("{base_id}-{suffix}");
            suffix += 1;
        }
        routes.push(ModelCatalogRoute {
            id: route_id,
            display_name,
            api,
            base_url,
            models,
        });
    }
    if routes.is_empty() {
        return Err("Models.dev response contained no supported provider models".to_owned());
    }
    routes.sort_by(|a, b| a.id.cmp(&b.id));
    Ok(routes)
}

#[cfg(test)]
fn parse_models_dev_catalog(root: &Value) -> Result<Vec<ModelCatalogRoute>, String> {
    parse_models_dev_catalog_with_hints(root, None)
}

/// Convert OpenCode Go's OpenAI-compatible `/models` response into the same
/// provider shape as Models.dev. Models.dev remains the source for metadata;
/// this endpoint is an authoritative ID supplement so a newly published Go
/// model is visible before the next Models.dev snapshot catches up.
fn parse_opencode_go_catalog(root: &Value) -> Result<Vec<ModelCatalogRoute>, String> {
    let models = root
        .get("data")
        .and_then(Value::as_array)
        .or_else(|| root.as_array())
        .ok_or_else(|| "OpenCode Go response has no data array".to_owned())?;
    let mut entries = serde_json::Map::new();
    for model in models {
        let Some(id) = model.get("id").and_then(Value::as_str).map(str::trim) else {
            continue;
        };
        if !valid_model_id(id) {
            continue;
        }
        let name = model
            .get("name")
            .and_then(Value::as_str)
            .filter(|value| !value.trim().is_empty())
            .unwrap_or(id);
        entries.insert(
            id.to_owned(),
            serde_json::json!({
                "id": id,
                "name": name,
                "api": "openai-completions"
            }),
        );
    }
    if entries.is_empty() {
        return Err("OpenCode Go response contained no model ids".to_owned());
    }
    let root = serde_json::json!({
        "opencode-go": {
            "name": "OpenCode Go",
            "api": "https://opencode.ai/zen/go/v1",
            "npm": "@ai-sdk/openai-compatible",
            "models": entries
        }
    });
    parse_models_dev_catalog_with_hints(&root, None)
}

fn bundled_pi_ai_data_dir(app: &AppHandle) -> Option<PathBuf> {
    #[cfg(windows)]
    {
        if let Ok(runtime_dir) = app
            .path()
            .resolve("dsh/windows-x64", BaseDirectory::Resource)
        {
            let path = runtime_dir
                .join("node_modules")
                .join("@earendil-works")
                .join("pi-ai")
                .join("dist")
                .join("providers")
                .join("data");
            if path.is_dir() {
                return Some(path);
            }
        }
        #[cfg(debug_assertions)]
        {
            let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .join("dsh")
                .join("windows-x64")
                .join("node_modules")
                .join("@earendil-works")
                .join("pi-ai")
                .join("dist")
                .join("providers")
                .join("data");
            if path.is_dir() {
                return Some(path);
            }
        }
    }
    None
}

fn load_static_hints(app: &AppHandle) -> StaticHints {
    let mut all = StaticHints::new();
    let Some(data_dir) = bundled_pi_ai_data_dir(app) else {
        return all;
    };
    let Ok(entries) = std::fs::read_dir(data_dir) else {
        return all;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|value| value.to_str()) != Some("json") {
            continue;
        }
        let Some(provider_id) = path
            .file_stem()
            .and_then(|value| value.to_str())
            .map(str::to_owned)
        else {
            continue;
        };
        let Ok(text) = std::fs::read_to_string(path) else {
            continue;
        };
        let Ok(groups) = serde_json::from_str::<Value>(&text) else {
            continue;
        };
        let Some(groups) = groups.as_object() else {
            continue;
        };
        let hint = all.entry(provider_id).or_default();
        for models in groups.values().filter_map(Value::as_object) {
            for (model_key, model) in models {
                let Some(api) = json_string(model, &["api"]) else {
                    continue;
                };
                let Some(base_url) = json_string(model, &["baseUrl", "baseURL"]) else {
                    continue;
                };
                let Some(api) = normalize_catalog_api(&api) else {
                    continue;
                };
                hint.models
                    .insert(model_key.clone(), (api.clone(), base_url.clone()));
                hint.by_api.entry(api.clone()).or_insert(base_url.clone());
                if hint.default.is_none() {
                    hint.default = Some((api, base_url));
                }
            }
        }
    }
    all
}

/// Parse the provider data shipped with pi-ai into the same route shape used
/// by Models.dev. This is intentionally kept as a real catalog, rather than
/// only an endpoint hint, so an offline or proxy-interrupted first launch can
/// still expose every model bundled in the installer.
fn load_bundled_catalog(app: &AppHandle) -> Result<Vec<ModelCatalogRoute>, String> {
    let data_dir = bundled_pi_ai_data_dir(app)
        .ok_or_else(|| "bundled pi-ai provider data directory is missing".to_owned())?;
    let mut providers = serde_json::Map::new();
    let entries = std::fs::read_dir(&data_dir).map_err(|error| error.to_string())?;
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|value| value.to_str()) != Some("json") {
            continue;
        }
        let Some(provider_id) = path
            .file_stem()
            .and_then(|value| value.to_str())
            .filter(|value| valid_catalog_id(value))
            .map(str::to_owned)
        else {
            continue;
        };
        let Ok(text) = std::fs::read_to_string(&path) else {
            continue;
        };
        let Ok(groups) = serde_json::from_str::<Value>(&text) else {
            continue;
        };
        let Some(groups) = groups.as_object() else {
            continue;
        };
        let mut models = serde_json::Map::new();
        for (api_group, group_models) in groups {
            let Some(group_models) = group_models.as_object() else {
                continue;
            };
            for (model_key, model) in group_models {
                // A few upstream catalogs repeat a model key across protocol
                // groups. Preserve both entries; the explicit model `id`
                // remains the user-facing identifier.
                let mut key = model_key.clone();
                if models.contains_key(&key) {
                    key = format!("{api_group}--{model_key}");
                }
                models.insert(key, model.clone());
            }
        }
        if !models.is_empty() {
            providers.insert(
                provider_id.clone(),
                serde_json::json!({
                    "name": provider_id,
                    "models": models,
                }),
            );
        }
    }
    parse_models_dev_catalog_with_hints(&Value::Object(providers), None)
}

fn bundled_models_dev_snapshot_path(app: &AppHandle) -> Option<PathBuf> {
    #[cfg(windows)]
    {
        if let Ok(path) = app
            .path()
            .resolve("models-dev-fallback.json", BaseDirectory::Resource)
        {
            if path.is_file() {
                return Some(path);
            }
        }
    }
    #[cfg(debug_assertions)]
    {
        let path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("models-dev-fallback.json");
        if path.is_file() {
            return Some(path);
        }
    }
    None
}

fn load_models_dev_snapshot(
    app: &AppHandle,
    hints: Option<&StaticHints>,
) -> Result<(String, Vec<ModelCatalogRoute>), String> {
    let path = bundled_models_dev_snapshot_path(app)
        .ok_or_else(|| "bundled Models.dev snapshot is missing".to_owned())?;
    let text = std::fs::read_to_string(&path).map_err(|error| error.to_string())?;
    let root = serde_json::from_str::<Value>(&text)
        .map_err(|error| format!("invalid bundled Models.dev snapshot: {error}"))?;
    let routes = parse_models_dev_catalog_with_hints(&root, hints)?;
    Ok(("bundled Models.dev snapshot".to_owned(), routes))
}

fn merge_catalog_routes(
    mut base: Vec<ModelCatalogRoute>,
    additions: Vec<ModelCatalogRoute>,
) -> Vec<ModelCatalogRoute> {
    for addition in additions {
        let Some(existing) = base.iter_mut().find(|route| {
            route.id == addition.id
                && route.api == addition.api
                && route.base_url == addition.base_url
        }) else {
            base.push(addition);
            continue;
        };
        let mut models = std::mem::take(&mut existing.models)
            .into_iter()
            .map(|model| (model.id.clone(), model))
            .collect::<BTreeMap<_, _>>();
        for model in addition.models {
            if let Some(current) = models.get_mut(&model.id) {
                // Supplementary sources may only know an id and endpoint. Do
                // not discard richer metadata already provided by Models.dev
                // or the bundled pi-ai catalog when merging that entry.
                if (current.name.is_empty() || current.name == current.id) && !model.name.is_empty()
                {
                    current.name = model.name;
                }
                current.context_window = current.context_window.or(model.context_window);
                current.max_tokens = current.max_tokens.or(model.max_tokens);
                current.input = current.input.take().or(model.input);
                current.reasoning_efforts =
                    current.reasoning_efforts.take().or(model.reasoning_efforts);
            } else {
                models.insert(model.id.clone(), model);
            }
        }
        existing.models = models.into_values().collect();
    }
    base.sort_by(|a, b| a.id.cmp(&b.id));
    base
}

fn replace_file_atomically(tmp: &Path, destination: &Path) -> Result<(), String> {
    match std::fs::rename(tmp, destination) {
        Ok(()) => Ok(()),
        Err(first_error) => {
            // std::fs::rename does not replace an existing file on Windows.
            // The temporary file is complete before this fallback runs.
            #[cfg(windows)]
            {
                if destination.is_file() {
                    std::fs::remove_file(destination).map_err(|error| error.to_string())?;
                    return std::fs::rename(tmp, destination).map_err(|error| error.to_string());
                }
            }
            Err(first_error.to_string())
        }
    }
}

fn write_cache(dsh_home: &Path, cache: &ModelCatalogCache) -> Result<(), String> {
    let path = cache_path(dsh_home);
    let tmp = path.with_extension(format!("json.{}.tmp", std::process::id()));
    let bytes = serde_json::to_vec_pretty(cache).map_err(|error| error.to_string())?;
    std::fs::write(&tmp, bytes).map_err(|error| error.to_string())?;
    let result = replace_file_atomically(&tmp, &path);
    if result.is_err() {
        let _ = std::fs::remove_file(&tmp);
    }
    result
}

fn read_cache(dsh_home: &Path) -> Option<ModelCatalogCache> {
    let text = std::fs::read_to_string(cache_path(dsh_home)).ok()?;
    let cache = serde_json::from_str::<ModelCatalogCache>(&text).ok()?;
    (cache.schema_version == MODEL_CATALOG_SCHEMA_VERSION
        && !cache.routes.is_empty()
        && cache
            .routes
            .iter()
            .all(|route| normalize_catalog_api(&route.api).is_some()))
    .then_some(cache)
}

fn yaml_string(value: &str) -> serde_yaml::Value {
    serde_yaml::Value::String(value.to_owned())
}

fn route_settings_value(
    route: &ModelCatalogRoute,
    existing: Option<&serde_yaml::Value>,
) -> serde_yaml::Value {
    let mut profile = existing
        .and_then(serde_yaml::Value::as_mapping)
        .cloned()
        .unwrap_or_default();
    profile.insert(yaml_string("displayName"), yaml_string(&route.display_name));
    profile.insert(yaml_string("api"), yaml_string(&route.api));
    profile.insert(yaml_string("baseURL"), yaml_string(&route.base_url));
    let models = route
        .models
        .iter()
        .map(|model| {
            let mut entry = serde_yaml::Mapping::new();
            entry.insert(yaml_string("id"), yaml_string(&model.id));
            entry.insert(yaml_string("name"), yaml_string(&model.name));
            if let Some(context) = model.context_window {
                entry.insert(
                    yaml_string("contextWindow"),
                    serde_yaml::Value::Number(serde_yaml::Number::from(context)),
                );
            }
            if let Some(max_tokens) = model.max_tokens {
                entry.insert(
                    yaml_string("maxTokens"),
                    serde_yaml::Value::Number(serde_yaml::Number::from(max_tokens)),
                );
            }
            if let Some(input) = &model.input {
                entry.insert(
                    yaml_string("input"),
                    serde_yaml::Value::Sequence(
                        input.iter().map(|value| yaml_string(value)).collect(),
                    ),
                );
            }
            if let Some(efforts) = &model.reasoning_efforts {
                let mut map = serde_yaml::Mapping::new();
                for (key, value) in efforts {
                    if !SUPPORTED_PI_AI_REASONING_LEVELS.contains(&key.as_str()) {
                        continue;
                    }
                    map.insert(
                        yaml_string(key),
                        value
                            .as_ref()
                            .map_or(serde_yaml::Value::Null, |value| yaml_string(value)),
                    );
                }
                if !map.is_empty() {
                    entry.insert(
                        yaml_string("reasoningEfforts"),
                        serde_yaml::Value::Mapping(map),
                    );
                }
            }
            serde_yaml::Value::Mapping(entry)
        })
        .collect();
    profile.insert(yaml_string("models"), serde_yaml::Value::Sequence(models));
    serde_yaml::Value::Mapping(profile)
}

fn provider_credential_ref(provider_id: &str) -> String {
    let known = match provider_id {
        "deepseek-official" => Some("DEEPSEEK_API_KEY"),
        "anthropic" => Some("ANTHROPIC_API_KEY"),
        "cohere" => Some("COHERE_API_KEY"),
        "google" => Some("GOOGLE_API_KEY"),
        "groq" => Some("GROQ_API_KEY"),
        "mistral" => Some("MISTRAL_API_KEY"),
        "openai" => Some("OPENAI_API_KEY"),
        "openrouter" => Some("OPENROUTER_API_KEY"),
        "xai" => Some("XAI_API_KEY"),
        _ => None,
    };
    if let Some(reference) = known {
        return reference.to_owned();
    }
    let mut normalized = provider_id
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || character == '_' {
                character.to_ascii_uppercase()
            } else {
                '_'
            }
        })
        .collect::<String>();
    if normalized
        .chars()
        .next()
        .is_some_and(|character| !character.is_ascii_alphabetic() && character != '_')
    {
        normalized.insert(0, '_');
    }
    format!("NEBULAMAT_{normalized}_API_KEY")
}

fn is_application_managed_profile(route: &ModelCatalogRoute, profile: &serde_yaml::Value) -> bool {
    let expected_ref = provider_credential_ref(&route.id);
    let credential_ref = profile
        .get(&yaml_string("apiKeyEnv"))
        .and_then(serde_yaml::Value::as_str);
    let api = profile
        .get(&yaml_string("api"))
        .and_then(serde_yaml::Value::as_str);
    let base_url = profile
        .get(&yaml_string("baseURL"))
        .and_then(serde_yaml::Value::as_str);
    credential_ref == Some(expected_ref.as_str())
        && api == Some(route.api.as_str())
        && base_url.is_some_and(|value| {
            value.trim_end_matches('/') == route.base_url.trim_end_matches('/')
        })
}

/// Provider identity is independent from its model metadata. This lets an
/// upstream name/metadata correction flow through while still detecting a
/// user-switched endpoint or protocol.
fn profile_matches_managed_identity(
    route: &ModelCatalogRoute,
    profile: &serde_yaml::Value,
) -> bool {
    let expected = route_settings_value(route, None);
    ["api", "baseURL"]
        .iter()
        .all(|key| profile.get(yaml_string(key)) == expected.get(yaml_string(key)))
}

/// A managed profile's model list must still match the previous snapshot. A
/// user may intentionally narrow or replace models without changing endpoint;
/// that is a customization and must not be overwritten at the next refresh.
fn profile_matches_managed_snapshot(
    route: &ModelCatalogRoute,
    profile: &serde_yaml::Value,
) -> bool {
    profile_matches_managed_identity(route, profile)
        && profile.get(yaml_string("models"))
            == route_settings_value(route, None).get(yaml_string("models"))
}

fn apply_settings(
    dsh_home: &Path,
    previous_managed_route_ids: &[String],
    previous_routes: &[ModelCatalogRoute],
    routes: &[ModelCatalogRoute],
) -> Result<Vec<String>, String> {
    let settings_path = dsh_home.join("settings.yaml");
    let text = std::fs::read_to_string(&settings_path).unwrap_or_default();
    let mut root = if text.trim().is_empty() {
        serde_yaml::Value::Mapping(serde_yaml::Mapping::new())
    } else {
        serde_yaml::from_str::<serde_yaml::Value>(&text)
            .map_err(|error| format!("invalid DSH settings: {error}"))?
    };
    let root_map = root
        .as_mapping_mut()
        .ok_or_else(|| "DSH settings root must be a YAML map".to_owned())?;
    let namespace_key = yaml_string("llm-pi-ai");
    if !root_map.contains_key(&namespace_key) {
        root_map.insert(
            namespace_key.clone(),
            serde_yaml::Value::Mapping(serde_yaml::Mapping::new()),
        );
    }
    let namespace = root_map
        .get_mut(&namespace_key)
        .ok_or_else(|| "llm-pi-ai settings namespace is missing".to_owned())?;
    let namespace_map = namespace
        .as_mapping_mut()
        .ok_or_else(|| "llm-pi-ai settings must be a YAML map".to_owned())?;
    let providers_key = yaml_string("providers");
    if !namespace_map.contains_key(&providers_key) {
        namespace_map.insert(
            providers_key.clone(),
            serde_yaml::Value::Mapping(serde_yaml::Mapping::new()),
        );
    }
    let providers = namespace_map
        .get_mut(&providers_key)
        .ok_or_else(|| "llm-pi-ai.providers is missing".to_owned())?;
    let providers_map = providers
        .as_mapping_mut()
        .ok_or_else(|| "llm-pi-ai.providers must be a YAML map".to_owned())?;

    // Older releases wrote every Models.dev integration into this namespace,
    // including protocols that `dsh-llm-pi-ai` rejects. One invalid profile
    // makes the adapter refuse the whole settings section, so remove only
    // profiles that explicitly name an unsupported protocol before rebuilding
    // the managed catalog. Entries without an `api` remain untouched: they
    // may be partial user profiles completed by a bundled provider catalog.
    let unsupported_profile_keys: Vec<serde_yaml::Value> = providers_map
        .iter()
        .filter_map(|(key, value)| {
            let api = value
                .get(&yaml_string("api"))
                .and_then(serde_yaml::Value::as_str)?;
            normalize_catalog_api(api).is_none().then(|| key.clone())
        })
        .collect();
    for key in unsupported_profile_keys {
        providers_map.remove(&key);
    }

    let legacy_profiles: BTreeMap<String, serde_yaml::Value> = providers_map
        .iter()
        .filter_map(|(key, value)| {
            key.as_str().map(|key| {
                (
                    key.split("--").next().unwrap_or(key).to_owned(),
                    value.clone(),
                )
            })
        })
        .collect();
    let previous_routes_by_id: BTreeMap<&str, &ModelCatalogRoute> = previous_routes
        .iter()
        .filter(|route| previous_managed_route_ids.iter().any(|id| id == &route.id))
        .map(|route| (route.id.as_str(), route))
        .collect();
    let next_route_ids: BTreeSet<&str> = routes.iter().map(|route| route.id.as_str()).collect();
    for route_id in previous_managed_route_ids {
        if next_route_ids.contains(route_id.as_str()) {
            continue;
        }
        let key = yaml_string(route_id);
        let owned = previous_routes_by_id
            .get(route_id.as_str())
            .zip(providers_map.get(&key))
            .is_some_and(|(route, profile)| profile_matches_managed_snapshot(route, profile));
        if owned {
            providers_map.remove(&key);
        }
    }
    let mut applied_route_ids = Vec::new();
    for route in routes {
        let route_key = yaml_string(&route.id);
        let direct_existing = providers_map.get(&route_key);
        let was_managed = previous_managed_route_ids.iter().any(|id| id == &route.id);
        let still_owned = previous_routes_by_id
            .get(route.id.as_str())
            .zip(direct_existing)
            .is_some_and(|(previous, profile)| profile_matches_managed_snapshot(previous, profile));
        // A user may reuse an application-owned id for a custom endpoint. Once
        // its catalog fields diverge, relinquish ownership instead of replacing
        // the custom profile on every launch.
        if was_managed
            && previous_routes_by_id.contains_key(route.id.as_str())
            && direct_existing.is_some()
            && !still_owned
        {
            continue;
        }
        // An explicit model list is normally a user narrowing/custom route. A
        // profile written by an older NebulaMat build may predate the ownership
        // cache, though. Adopt it when its credential reference, protocol, and
        // endpoint all match the app-owned route; otherwise new upstream models
        // would remain permanently hidden after an upgrade.
        if !was_managed
            && direct_existing
                .and_then(|value| value.get(&yaml_string("models")))
                .is_some()
            && direct_existing.is_none_or(|value| !is_application_managed_profile(route, value))
        {
            continue;
        }
        let inherited_existing = {
            route
                .id
                .split("--")
                .next()
                .and_then(|provider| legacy_profiles.get(provider))
        };
        let inherited_existing = inherited_existing.filter(|value| {
            previous_managed_route_ids
                .iter()
                .any(|id| id == route.id.split("--").next().unwrap_or_default())
                || value.get(&yaml_string("models")).is_none()
        });
        let existing = direct_existing.or(inherited_existing);
        providers_map.insert(route_key, route_settings_value(route, existing));
        applied_route_ids.push(route.id.clone());
    }

    let rendered = serde_yaml::to_string(&root).map_err(|error| error.to_string())?;
    let tmp = settings_path.with_extension(format!("yaml.{}.tmp", std::process::id()));
    std::fs::write(&tmp, rendered).map_err(|error| error.to_string())?;
    let result = replace_file_atomically(&tmp, &settings_path);
    if result.is_err() {
        let _ = std::fs::remove_file(&tmp);
    }
    result.map(|()| applied_route_ids)
}

fn fetch_catalog(
    app: &AppHandle,
    hints: Option<&StaticHints>,
) -> Result<(String, Vec<ModelCatalogRoute>), String> {
    let urls: Vec<String> = std::env::var("NEBULAMAT_MODELS_DEV_URL")
        .ok()
        .filter(|value| !value.trim().is_empty())
        .map(|value| vec![value])
        .unwrap_or_else(|| {
            MODELS_DEV_URLS
                .iter()
                .map(|value| (*value).to_owned())
                .collect()
        });
    let mut builder = reqwest::blocking::Client::builder()
        .timeout(MODELS_DEV_TIMEOUT)
        .user_agent("NebulaMat model catalog refresh");
    // The refresh runs before the DSH child receives its proxy environment.
    // Reuse the same WinInet/custom proxy resolution as the sidecar itself.
    if let Some(proxy_url) =
        crate::runtime::sidecar_proxy_env(app)
            .into_iter()
            .find_map(|(key, value)| {
                ((key == "HTTPS_PROXY" || key == "HTTP_PROXY") && !value.is_empty())
                    .then_some(value)
            })
    {
        if let Ok(proxy) = reqwest::Proxy::all(&proxy_url) {
            builder = builder.proxy(proxy);
        }
    }
    let client = builder.build().map_err(|error| error.to_string())?;
    let mut last_error = String::new();
    for url in urls {
        match client.get(&url).send() {
            Ok(response) if response.status().is_success() => match response.bytes() {
                Ok(bytes) if bytes.len() <= MODELS_DEV_MAX_BYTES => {
                    let json = serde_json::from_slice::<Value>(&bytes)
                        .map_err(|error| format!("invalid Models.dev JSON: {error}"))?;
                    let routes = parse_models_dev_catalog_with_hints(&json, hints)?;
                    let source = match client
                        .get(OPENCODE_GO_MODELS_URL)
                        .timeout(Duration::from_secs(8))
                        .send()
                    {
                        Ok(response) if response.status().is_success() => match response.bytes() {
                            Ok(bytes) if bytes.len() <= MODELS_DEV_MAX_BYTES => {
                                match serde_json::from_slice::<Value>(&bytes)
                                    .map_err(|error| error.to_string())
                                    .and_then(|value| parse_opencode_go_catalog(&value))
                                {
                                    Ok(opencode_routes) => (
                                        format!("{url} + {OPENCODE_GO_MODELS_URL}"),
                                        merge_catalog_routes(routes, opencode_routes),
                                    ),
                                    Err(_) => (url.clone(), routes),
                                }
                            }
                            _ => (url.clone(), routes),
                        },
                        _ => (url.clone(), routes),
                    };
                    return Ok(source);
                }
                Ok(_) => {
                    last_error = format!("Models.dev response exceeds {MODELS_DEV_MAX_BYTES} bytes")
                }
                Err(error) => last_error = error.to_string(),
            },
            Ok(response) => last_error = format!("Models.dev returned HTTP {}", response.status()),
            Err(error) => last_error = error.to_string(),
        }
    }
    Err(last_error)
}

#[derive(Clone, Debug)]
pub(crate) struct ModelCatalogRefresh {
    pub(crate) source: String,
    pub(crate) route_count: usize,
    pub(crate) model_count: usize,
}

fn refresh_result(cache: &ModelCatalogCache) -> ModelCatalogRefresh {
    ModelCatalogRefresh {
        source: cache.source.clone(),
        route_count: cache.routes.len(),
        model_count: cache.routes.iter().map(|route| route.models.len()).sum(),
    }
}

/// Prepare the model catalog for DSH startup without touching the network.
///
/// A cached catalog is authoritative until the user explicitly refreshes it
/// from Settings. On a first launch, seed that cache from the bundled snapshot
/// (or the bundled pi-ai data as a fallback). Keeping remote catalog requests
/// out of the sidecar's critical path avoids adding the HTTP timeout to every
/// desktop launch when Models.dev is slow or unreachable.
pub(crate) fn initialize(app: &AppHandle, dsh_home: &Path) -> Result<ModelCatalogRefresh, String> {
    if let Some(cache) = read_cache(dsh_home) {
        apply_settings(
            dsh_home,
            &cache.managed_route_ids,
            &cache.routes,
            &cache.routes,
        )
        .map_err(|error| format!("cached settings repair skipped: {error}"))?;
        crate::debug_log::append(
            app,
            &format!(
                "[model-catalog] startup using cached catalog with {} routes",
                cache.routes.len()
            ),
        );
        return Ok(refresh_result(&cache));
    }

    let hints = load_static_hints(app);
    let (source, routes) = load_models_dev_snapshot(app, Some(&hints)).or_else(|_| {
        load_bundled_catalog(app).map(|routes| ("bundled pi-ai catalog".to_owned(), routes))
    })?;
    let managed_route_ids = apply_settings(dsh_home, &[], &[], &routes)
        .map_err(|error| format!("bundled settings merge skipped: {error}"))?;
    let cache = ModelCatalogCache {
        schema_version: MODEL_CATALOG_SCHEMA_VERSION,
        fetched_at: SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|duration| duration.as_secs())
            .unwrap_or_default(),
        source,
        managed_route_ids,
        routes,
    };
    write_cache(dsh_home, &cache).map_err(|error| format!("cache write failed: {error}"))?;
    crate::debug_log::append(
        app,
        &format!(
            "[model-catalog] startup initialized {} bundled routes from {}",
            cache.routes.len(),
            cache.source
        ),
    );
    Ok(refresh_result(&cache))
}

/// Refresh the official catalog on explicit user request. A provider outage
/// falls back to the previous cache or a bundled catalog.
pub(crate) fn refresh(app: &AppHandle, dsh_home: &Path) -> Result<ModelCatalogRefresh, String> {
    let previous = read_cache(dsh_home);
    let hints = load_static_hints(app);
    match fetch_catalog(app, Some(&hints)) {
        Ok((source, routes)) => {
            let previous_ids = previous
                .as_ref()
                .map(|cache| cache.managed_route_ids.as_slice())
                .unwrap_or(&[]);
            let previous_routes = previous
                .as_ref()
                .map(|cache| cache.routes.as_slice())
                .unwrap_or(&[]);
            let managed_route_ids =
                apply_settings(dsh_home, previous_ids, previous_routes, &routes)
                    .map_err(|error| format!("settings merge skipped: {error}"))?;
            let cache = ModelCatalogCache {
                schema_version: MODEL_CATALOG_SCHEMA_VERSION,
                fetched_at: SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .map(|duration| duration.as_secs())
                    .unwrap_or_default(),
                source,
                managed_route_ids,
                routes,
            };
            write_cache(dsh_home, &cache)
                .map_err(|error| format!("cache write failed: {error}"))?;
            crate::debug_log::append(
                app,
                &format!(
                    "[model-catalog] refreshed {} routes from {}",
                    cache.routes.len(),
                    cache.source
                ),
            );
            Ok(refresh_result(&cache))
        }
        Err(error) => {
            let snapshot = load_models_dev_snapshot(app, Some(&hints)).or_else(|_| {
                load_bundled_catalog(app).map(|routes| ("bundled pi-ai catalog".to_owned(), routes))
            });
            let (source, snapshot_routes) = match snapshot {
                Ok(value) => value,
                Err(snapshot_error) => {
                    if let Some(cache) = previous {
                        apply_settings(
                            dsh_home,
                            &cache.managed_route_ids,
                            &cache.routes,
                            &cache.routes,
                        )
                        .map_err(
                            |settings_error| {
                                format!(
                                    "refresh failed ({error}); cached settings repair skipped: {settings_error}"
                                )
                            },
                        )?;
                        crate::debug_log::append(
                            app,
                            &format!(
                                "[model-catalog] refresh failed ({error}); using cached catalog"
                            ),
                        );
                        return Ok(refresh_result(&cache));
                    } else {
                        return Err(format!(
                            "refresh failed ({error}); bundled catalogs unavailable ({snapshot_error})"
                        ));
                    }
                }
            };
            let (previous_ids, previous_routes, routes) = if let Some(cache) = previous {
                (
                    cache.managed_route_ids,
                    cache.routes.clone(),
                    merge_catalog_routes(cache.routes, snapshot_routes),
                )
            } else {
                (Vec::new(), Vec::new(), snapshot_routes)
            };
            let managed_route_ids =
                apply_settings(dsh_home, &previous_ids, &previous_routes, &routes).map_err(
                    |settings_error| {
                        format!(
                    "refresh failed ({error}); fallback settings merge skipped: {settings_error}"
                )
                    },
                )?;
            let cache = ModelCatalogCache {
                schema_version: MODEL_CATALOG_SCHEMA_VERSION,
                fetched_at: SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .map(|duration| duration.as_secs())
                    .unwrap_or_default(),
                source,
                managed_route_ids,
                routes,
            };
            write_cache(dsh_home, &cache).map_err(|cache_error| {
                format!(
                    "refresh failed ({error}); fallback catalog applied but cache write failed: {cache_error}"
                )
            })?;
            crate::debug_log::append(
                app,
                &format!(
                    "[model-catalog] refresh failed ({error}); using {} with {} routes",
                    cache.source,
                    cache.routes.len()
                ),
            );
            Ok(refresh_result(&cache))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{
        apply_settings, merge_catalog_routes, parse_models_dev_catalog,
        parse_models_dev_catalog_with_hints, parse_opencode_go_catalog, ModelCatalogModel,
        ModelCatalogRoute, ProviderHints, StaticHints, SUPPORTED_PI_AI_REASONING_LEVELS,
    };
    use serde_json::json;
    use std::fs;

    #[test]
    fn parses_official_opencode_go_model_list() {
        let routes = parse_opencode_go_catalog(&json!({
            "data": [
                {"id": "new-go-model", "object": "model"},
                {"id": "", "object": "model"}
            ]
        }))
        .unwrap();
        assert_eq!(routes.len(), 1);
        assert_eq!(routes[0].id, "opencode-go");
        assert_eq!(routes[0].api, "openai-completions");
        assert_eq!(routes[0].base_url, "https://opencode.ai/zen/go/v1");
        assert_eq!(routes[0].models[0].id, "new-go-model");
    }

    #[test]
    fn official_opencode_go_models_merge_without_losing_catalog_metadata() {
        let base = vec![ModelCatalogRoute {
            id: "opencode-go".into(),
            display_name: "OpenCode Go".into(),
            api: "openai-completions".into(),
            base_url: "https://opencode.ai/zen/go/v1".into(),
            models: vec![ModelCatalogModel {
                id: "known".into(),
                name: "Known model".into(),
                context_window: Some(1000),
                max_tokens: Some(100),
                input: Some(vec!["text".into()]),
                reasoning_efforts: None,
            }],
        }];
        let official = parse_opencode_go_catalog(&json!({
            "data": [{"id": "known"}, {"id": "new-official-model"}]
        }))
        .unwrap();
        let merged = merge_catalog_routes(base, official);
        let route = merged
            .iter()
            .find(|route| route.id == "opencode-go")
            .unwrap();
        assert_eq!(route.models.len(), 2);
        let known = route
            .models
            .iter()
            .find(|model| model.id == "known")
            .unwrap();
        assert_eq!(known.name, "Known model");
        assert_eq!(known.context_window, Some(1000));
        assert!(route
            .models
            .iter()
            .any(|model| model.id == "new-official-model"));
    }

    #[test]
    fn parses_all_supported_provider_groups_and_new_models() {
        let root = json!({
            "opencode-go": {
                "name": "OpenCode Go",
                "models": {
                    "new-model": {
                        "id": "new-model",
                        "name": "New Model",
                        "api": "openai-completions",
                        "baseUrl": "https://opencode.ai/zen/go/v1",
                        "limit": {"context": 1000000, "output": 64000},
                        "modalities": {"input": ["text", "image"]}
                    }
                }
            },
            "anthropic": {
                "name": "Anthropic",
                "models": {
                    "claude-new": {
                        "api": "anthropic-messages",
                        "baseUrl": "https://api.anthropic.com",
                        "contextWindow": 200000,
                        "maxTokens": 8192
                    }
                }
            }
        });
        let routes = parse_models_dev_catalog(&root).unwrap();
        assert_eq!(routes.len(), 2);
        assert!(routes
            .iter()
            .any(|route| route.id == "opencode-go" && route.models[0].id == "new-model"));
        assert!(routes.iter().any(|route| route.id == "anthropic"));
    }

    #[test]
    fn filters_reasoning_levels_not_supported_by_pi_ai() {
        let root = json!({
            "provider": {
                "name": "Provider",
                "models": {
                    "mixed": {
                        "api": "openai-completions",
                        "baseUrl": "https://example.com/v1",
                        "reasoning_options": [{
                            "type": "effort",
                            "values": ["none", "low", "high"]
                        }]
                    }
                }
            }
        });
        let routes = parse_models_dev_catalog(&root).unwrap();
        let efforts = routes[0].models[0].reasoning_efforts.as_ref().unwrap();
        assert_eq!(efforts.keys().cloned().collect::<Vec<_>>(), ["high", "low"]);
        assert!(!efforts.contains_key("none"));
    }

    #[test]
    fn ignores_unsupported_or_invalid_models_without_empty_routes() {
        let root = json!({
            "bad/provider": {"models": {"x": {"api": "unknown", "baseUrl": "https://example.com"}}},
            "good": {"models": {"bad id": {"api": "openai-completions", "baseUrl": "file:///tmp"}}}
        });
        assert!(parse_models_dev_catalog(&root).is_err());
    }

    #[test]
    fn skips_protocols_not_accepted_by_dsh_without_hiding_valid_routes() {
        let root = json!({
            "amazon-bedrock": {
                "npm": "@ai-sdk/amazon-bedrock",
                "models": {
                    "claude": {
                        "api": "bedrock-converse-stream",
                        "baseUrl": "https://bedrock.example"
                    }
                }
            },
            "opencode-go": {
                "npm": "@ai-sdk/openai-compatible",
                "api": "https://opencode.ai/zen/go/v1",
                "models": {
                    "deepseek-v4-flash": {
                        "name": "DeepSeek V4 Flash"
                    }
                }
            }
        });
        let routes = parse_models_dev_catalog(&root).unwrap();
        assert_eq!(routes.len(), 1);
        assert_eq!(routes[0].id, "opencode-go");
        assert_eq!(routes[0].models[0].id, "deepseek-v4-flash");
    }

    #[test]
    fn endpoint_and_api_can_be_inherited_from_installed_catalog() {
        let root = json!({
            "opencode-go": {
                "models": {
                    "new-model": {"name": "New Model", "limit": {"context": 1000}}
                }
            }
        });
        let mut hints = StaticHints::new();
        let mut provider = ProviderHints::default();
        provider.default = Some((
            "openai-completions".into(),
            "https://opencode.ai/zen/go/v1".into(),
        ));
        provider.by_api.insert(
            "openai-completions".into(),
            "https://opencode.ai/zen/go/v1".into(),
        );
        hints.insert("opencode-go".into(), provider);
        let routes = parse_models_dev_catalog_with_hints(&root, Some(&hints)).unwrap();
        assert_eq!(routes[0].base_url, "https://opencode.ai/zen/go/v1");
        assert_eq!(routes[0].api, "openai-completions");
    }

    #[test]
    fn parses_current_models_dev_provider_api_and_npm_schema() {
        let root = json!({
            "opencode-go": {
                "api": "https://opencode.ai/zen/go/v1",
                "npm": "@ai-sdk/openai-compatible",
                "name": "OpenCode Go",
                "models": {
                    "new-current-model": {
                        "id": "new-current-model",
                        "name": "New current model",
                        "reasoning_options": [{"type": "effort", "values": ["low", "max"]}],
                        "modalities": {"input": ["text", "image", "video"]},
                        "limit": {"context": 1000000, "output": 131072}
                    }
                }
            }
        });
        let routes = parse_models_dev_catalog(&root).unwrap();
        assert_eq!(routes.len(), 1);
        assert_eq!(routes[0].api, "openai-completions");
        assert_eq!(routes[0].base_url, "https://opencode.ai/zen/go/v1");
        assert_eq!(routes[0].models[0].id, "new-current-model");
        assert_eq!(
            routes[0].models[0].input.as_ref().unwrap(),
            &vec!["text".to_owned(), "image".to_owned()]
        );
        assert!(routes[0].models[0]
            .reasoning_efforts
            .as_ref()
            .unwrap()
            .contains_key("max"));
    }

    #[test]
    fn model_level_provider_npm_overrides_provider_protocol() {
        let root = json!({
            "opencode-go": {
                "api": "https://opencode.ai/zen/go/v1",
                "npm": "@ai-sdk/openai-compatible",
                "models": {
                    "anthropic-model": {
                        "provider": {"npm": "@ai-sdk/anthropic"}
                    }
                }
            }
        });
        let routes = parse_models_dev_catalog(&root).unwrap();
        let route = routes
            .iter()
            .find(|route| {
                route
                    .models
                    .iter()
                    .any(|model| model.id == "anthropic-model")
            })
            .unwrap();
        assert_eq!(route.api, "anthropic-messages");
        assert_eq!(route.base_url, "https://opencode.ai/zen/go/v1");
    }

    #[test]
    fn parses_live_models_dev_fixture_when_requested() {
        let Ok(path) = std::env::var("MODELS_DEV_FIXTURE") else {
            return;
        };
        let text = std::fs::read_to_string(path).unwrap();
        let root: serde_json::Value = serde_json::from_str(&text).unwrap();
        let routes = parse_models_dev_catalog(&root).unwrap();
        let opencode = routes
            .iter()
            .find(|route| route.id == "opencode-go")
            .unwrap();
        assert!(opencode
            .models
            .iter()
            .any(|model| model.id == "qwen3.8-max"));
        assert!(opencode
            .models
            .iter()
            .any(|model| model.id == "deepseek-v4-flash-vision-exp"));
    }

    #[test]
    fn parses_bundled_models_dev_snapshot_with_deepseek_vision_model() {
        let path =
            std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("models-dev-fallback.json");
        let text = fs::read_to_string(path).unwrap();
        let root: serde_json::Value = serde_json::from_str(&text).unwrap();
        let routes = parse_models_dev_catalog(&root).unwrap();
        assert!(routes.iter().any(|route| {
            route
                .models
                .iter()
                .any(|model| model.id == "deepseek-v4-flash-vision-exp")
        }));
        assert!(routes.iter().any(|route| {
            route.id == "opencode-go" && route.models.iter().any(|model| model.id == "hy3-preview")
        }));
        assert!(routes.iter().all(|route| {
            route.models.iter().all(|model| {
                model.reasoning_efforts.as_ref().is_none_or(|efforts| {
                    efforts
                        .keys()
                        .all(|key| SUPPORTED_PI_AI_REASONING_LEVELS.contains(&key.as_str()))
                })
            })
        }));
    }

    #[test]
    fn merges_new_snapshot_models_into_an_existing_route() {
        let existing = ModelCatalogRoute {
            id: "opencode-go".into(),
            display_name: "OpenCode Go".into(),
            api: "openai-completions".into(),
            base_url: "https://opencode.ai/zen/go/v1".into(),
            models: vec![ModelCatalogModel {
                id: "old".into(),
                name: "Old".into(),
                context_window: None,
                max_tokens: None,
                input: None,
                reasoning_efforts: None,
            }],
        };
        let addition = ModelCatalogRoute {
            models: vec![ModelCatalogModel {
                id: "deepseek-v4-flash-vision-exp".into(),
                name: "DeepSeek V4 Flash Vision Exp".into(),
                context_window: Some(1_000_000),
                max_tokens: Some(384_000),
                input: Some(vec!["text".into(), "image".into()]),
                reasoning_efforts: None,
            }],
            ..existing.clone()
        };
        let merged = merge_catalog_routes(vec![existing], vec![addition]);
        assert_eq!(merged[0].models.len(), 2);
        assert!(merged[0]
            .models
            .iter()
            .any(|model| model.id == "deepseek-v4-flash-vision-exp"));
    }

    #[test]
    fn settings_merge_preserves_other_namespaces_and_custom_routes() {
        let root = std::env::temp_dir().join(format!("os-model-catalog-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).unwrap();
        fs::write(
            root.join("settings.yaml"),
            "custom: {keep: true}\nllm-pi-ai:\n  providers:\n    user-route:\n      apiKeyEnv: USER_KEY\n    managed:\n      apiKeyEnv: OLD_KEY\n",
        )
        .unwrap();
        let route = ModelCatalogRoute {
            id: "managed".into(),
            display_name: "Managed".into(),
            api: "openai-completions".into(),
            base_url: "https://example.com/v1".into(),
            models: vec![super::ModelCatalogModel {
                id: "new".into(),
                name: "New".into(),
                context_window: Some(1000),
                max_tokens: Some(100),
                input: Some(vec!["text".into()]),
                reasoning_efforts: None,
            }],
        };
        apply_settings(&root, &["managed".into()], &[], &[route]).unwrap();
        let text = fs::read_to_string(root.join("settings.yaml")).unwrap();
        assert!(text.contains("keep: true"));
        assert!(text.contains("user-route"));
        assert!(text.contains("new"));
        // Refreshing the catalog must not discard the credential reference for
        // an already configured provider route.
        assert!(text.contains("OLD_KEY"));
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn settings_merge_removes_unsupported_protocol_profiles() {
        let root = std::env::temp_dir().join(format!(
            "os-model-catalog-unsupported-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).unwrap();
        fs::write(
            root.join("settings.yaml"),
            "llm-pi-ai:\n  providers:\n    bedrock-route:\n      api: bedrock-converse-stream\n      baseURL: https://example.com\n      models: []\n    supported-route:\n      api: openai-chat\n      baseURL: https://example.com/v1\n      models: []\n    partial-user-route:\n      apiKeyEnv: USER_KEY\n",
        )
        .unwrap();
        let route = ModelCatalogRoute {
            id: "opencode-go".into(),
            display_name: "OpenCode Go".into(),
            api: "openai-completions".into(),
            base_url: "https://opencode.ai/zen/go/v1".into(),
            models: vec![super::ModelCatalogModel {
                id: "official-new".into(),
                name: "Official new".into(),
                context_window: None,
                max_tokens: None,
                input: None,
                reasoning_efforts: None,
            }],
        };
        apply_settings(&root, &[], &[], &[route]).unwrap();
        let text = fs::read_to_string(root.join("settings.yaml")).unwrap();
        assert!(!text.contains("bedrock-route"));
        assert!(text.contains("supported-route"));
        assert!(text.contains("partial-user-route"));
        assert!(text.contains("official-new"));
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn first_refresh_does_not_replace_an_explicit_unmanaged_model_list() {
        let root =
            std::env::temp_dir().join(format!("os-model-catalog-custom-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).unwrap();
        fs::write(
            root.join("settings.yaml"),
            "llm-pi-ai:\n  providers:\n    opencode-go:\n      apiKeyEnv: USER_KEY\n      models:\n        - id: user-selected\n          name: User selected\n",
        )
        .unwrap();
        let route = ModelCatalogRoute {
            id: "opencode-go".into(),
            display_name: "OpenCode Go".into(),
            api: "openai-completions".into(),
            base_url: "https://opencode.ai/zen/go/v1".into(),
            models: vec![super::ModelCatalogModel {
                id: "official-new".into(),
                name: "Official new".into(),
                context_window: None,
                max_tokens: None,
                input: None,
                reasoning_efforts: None,
            }],
        };
        let applied = apply_settings(&root, &[], &[], &[route]).unwrap();
        assert!(applied.is_empty());
        let text = fs::read_to_string(root.join("settings.yaml")).unwrap();
        assert!(text.contains("user-selected"));
        assert!(!text.contains("official-new"));
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn first_refresh_adopts_an_application_managed_opencode_go_profile() {
        let root = std::env::temp_dir().join(format!(
            "os-model-catalog-managed-migration-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).unwrap();
        fs::write(
            root.join("settings.yaml"),
            "llm-pi-ai:\n  providers:\n    opencode-go:\n      apiKeyEnv: NEBULAMAT_OPENCODE_GO_API_KEY\n      displayName: OpenCode Go\n      api: openai-completions\n      baseURL: https://opencode.ai/zen/go/v1\n      models:\n        - id: glm-5.3\n          name: GLM-5.3\n",
        )
        .unwrap();
        let route = ModelCatalogRoute {
            id: "opencode-go".into(),
            display_name: "OpenCode Go".into(),
            api: "openai-completions".into(),
            base_url: "https://opencode.ai/zen/go/v1".into(),
            models: vec![super::ModelCatalogModel {
                id: "glm-5.3-flash".into(),
                name: "GLM-5.3-Flash".into(),
                context_window: Some(1_000_000),
                max_tokens: Some(131_072),
                input: Some(vec!["text".into(), "image".into()]),
                reasoning_efforts: None,
            }],
        };
        let applied = apply_settings(&root, &[], &[], &[route]).unwrap();
        assert_eq!(applied, ["opencode-go"]);
        let text = fs::read_to_string(root.join("settings.yaml")).unwrap();
        assert!(text.contains("glm-5.3-flash"));
        assert!(!text.contains("- id: glm-5.3\n"));
        assert!(text.contains("NEBULAMAT_OPENCODE_GO_API_KEY"));
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn refresh_keeps_a_user_customized_route_that_reuses_a_managed_id() {
        let root = std::env::temp_dir().join(format!(
            "os-model-catalog-customized-managed-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).unwrap();
        let previous = ModelCatalogRoute {
            id: "opencode-go".into(),
            display_name: "OpenCode Go".into(),
            api: "openai-completions".into(),
            base_url: "https://opencode.ai/zen/go/v1".into(),
            models: vec![ModelCatalogModel {
                id: "glm-5.3".into(),
                name: "GLM-5.3".into(),
                context_window: None,
                max_tokens: None,
                input: None,
                reasoning_efforts: None,
            }],
        };
        fs::write(
            root.join("settings.yaml"),
            "llm-pi-ai:\n  providers:\n    opencode-go:\n      displayName: OpenCode Go\n      api: openai-completions\n      baseURL: https://gateway.example/v1\n      apiKeyEnv: MY_GATEWAY_KEY\n      models:\n        - id: my-model\n          name: My Model\n",
        )
        .unwrap();
        let upstream = ModelCatalogRoute {
            models: vec![ModelCatalogModel {
                id: "glm-5.3-flash".into(),
                name: "GLM-5.3-Flash".into(),
                context_window: None,
                max_tokens: None,
                input: None,
                reasoning_efforts: None,
            }],
            ..previous.clone()
        };
        let applied =
            apply_settings(&root, &["opencode-go".into()], &[previous], &[upstream]).unwrap();
        assert!(applied.is_empty());
        let text = fs::read_to_string(root.join("settings.yaml")).unwrap();
        assert!(text.contains("gateway.example"));
        assert!(text.contains("my-model"));
        assert!(!text.contains("glm-5.3-flash"));
        let _ = fs::remove_dir_all(root);
    }
}
