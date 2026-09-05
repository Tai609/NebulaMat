//! Local-first experiment records inspired by ExperMate's product contract.
//!
//! The SQLite catalog is application-owned so a new conversation does not hide
//! earlier experiments. Raw evidence and normalized Markdown remain in the
//! active research workspace, where the agent and provenance layer can inspect
//! them without receiving unrestricted access to the app data directory.

use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use rusqlite::{params, Connection, OptionalExtension, Row};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Manager};

use crate::runtime::workspace_dir;

const DB_DIR: &str = "experiments";
const DB_NAME: &str = "experiments.sqlite3";

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExperimentRecord {
    pub id: String,
    pub title: String,
    pub date: String,
    pub system_code: String,
    pub device_code: String,
    pub experiment_type: String,
    pub sample_batch: Option<String>,
    pub status: String,
    pub purpose: String,
    pub summary: String,
    pub conclusion: String,
    pub anomaly: bool,
    pub archived: bool,
    pub tags: Vec<String>,
    pub raw_dir: String,
    pub standardized_path: Option<String>,
    pub source_files: Vec<String>,
    pub missing_fields: Vec<String>,
    pub metadata: Value,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct InboxRecord {
    exp_id: Option<String>,
    id: Option<String>,
    title: Option<String>,
    date: Option<String>,
    system_code: Option<String>,
    device_code: Option<String>,
    experiment_type: Option<String>,
    sample_batch: Option<String>,
    status: Option<String>,
    purpose: Option<String>,
    summary: Option<String>,
    conclusion: Option<String>,
    anomaly: Option<bool>,
    tags: Option<Vec<String>>,
    raw_dir: Option<String>,
    standardized_path: Option<String>,
    source_files: Option<Vec<String>>,
    missing_fields: Option<Vec<String>>,
    metadata: Option<Value>,
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .min(i64::MAX as u128) as i64
}

fn database_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?
        .join(DB_DIR);
    std::fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
    Ok(dir.join(DB_NAME))
}

fn connection(app: &AppHandle) -> Result<(Connection, PathBuf), String> {
    let path = database_path(app)?;
    let conn = Connection::open(&path).map_err(|error| error.to_string())?;
    conn.busy_timeout(std::time::Duration::from_secs(30))
        .map_err(|error| error.to_string())?;
    conn.execute_batch(
        "PRAGMA journal_mode = WAL;
         CREATE TABLE IF NOT EXISTS experiments (
           id TEXT PRIMARY KEY,
           title TEXT NOT NULL,
           experiment_date TEXT NOT NULL,
           system_code TEXT NOT NULL,
           device_code TEXT NOT NULL,
           experiment_type TEXT NOT NULL,
           sample_batch TEXT,
           status TEXT NOT NULL,
           purpose TEXT NOT NULL,
           summary TEXT NOT NULL,
           conclusion TEXT NOT NULL,
           anomaly INTEGER NOT NULL,
           archived INTEGER NOT NULL,
           tags_json TEXT NOT NULL,
           raw_dir TEXT NOT NULL,
           standardized_path TEXT,
           source_files_json TEXT NOT NULL,
           missing_fields_json TEXT NOT NULL,
           metadata_json TEXT NOT NULL,
           created_at INTEGER NOT NULL,
           updated_at INTEGER NOT NULL
         );
         CREATE INDEX IF NOT EXISTS idx_experiments_date ON experiments(experiment_date DESC);
         CREATE INDEX IF NOT EXISTS idx_experiments_status ON experiments(status, archived);",
    )
    .map_err(|error| error.to_string())?;
    Ok((conn, path))
}

fn string_list(value: &str) -> Vec<String> {
    serde_json::from_str(value).unwrap_or_default()
}

fn json_value(value: &str) -> Value {
    serde_json::from_str(value).unwrap_or_else(|_| serde_json::json!({}))
}

fn record_from_row(row: &Row<'_>) -> rusqlite::Result<ExperimentRecord> {
    Ok(ExperimentRecord {
        id: row.get(0)?,
        title: row.get(1)?,
        date: row.get(2)?,
        system_code: row.get(3)?,
        device_code: row.get(4)?,
        experiment_type: row.get(5)?,
        sample_batch: row.get(6)?,
        status: row.get(7)?,
        purpose: row.get(8)?,
        summary: row.get(9)?,
        conclusion: row.get(10)?,
        anomaly: row.get::<_, i64>(11)? != 0,
        archived: row.get::<_, i64>(12)? != 0,
        tags: string_list(&row.get::<_, String>(13)?),
        raw_dir: row.get(14)?,
        standardized_path: row.get(15)?,
        source_files: string_list(&row.get::<_, String>(16)?),
        missing_fields: string_list(&row.get::<_, String>(17)?),
        metadata: json_value(&row.get::<_, String>(18)?),
        created_at: row.get(19)?,
        updated_at: row.get(20)?,
    })
}

fn validate_code(value: &str, fallback: &str) -> String {
    let value = value.trim().to_ascii_uppercase();
    let filtered: String = value
        .chars()
        .filter(|character| character.is_ascii_alphanumeric())
        .take(12)
        .collect();
    if filtered.is_empty() {
        fallback.into()
    } else {
        filtered
    }
}

fn validate_date(date: &str) -> Result<String, String> {
    let date = date.trim();
    let bytes = date.as_bytes();
    if bytes.len() == 10
        && bytes[4] == b'-'
        && bytes[7] == b'-'
        && bytes
            .iter()
            .enumerate()
            .all(|(index, value)| matches!(index, 4 | 7) || value.is_ascii_digit())
    {
        Ok(date.to_owned())
    } else {
        Err("experiment date must use YYYY-MM-DD".into())
    }
}

fn validate_experiment_id(id: &str) -> Result<(), String> {
    if id.is_empty() || id.len() > 96 {
        return Err("invalid experiment id".into());
    }
    if id
        .chars()
        .any(|character| !(character.is_ascii_alphanumeric() || character == '-'))
    {
        return Err("experiment id contains unsupported characters".into());
    }
    Ok(())
}

fn next_experiment_id(
    conn: &Connection,
    system_code: &str,
    device_code: &str,
    date: &str,
) -> Result<String, String> {
    let compact_date = date.replace('-', "");
    let compact_date = compact_date.get(2..).ok_or("invalid experiment date")?;
    let prefix = format!("{system_code}-{device_code}-{compact_date}-");
    let pattern = format!("{prefix}%");
    let mut statement = conn
        .prepare("SELECT id FROM experiments WHERE id LIKE ?1 ORDER BY id DESC LIMIT 1")
        .map_err(|error| error.to_string())?;
    let latest: Option<String> = statement
        .query_row([pattern], |row| row.get(0))
        .optional()
        .map_err(|error| error.to_string())?;
    let sequence = latest
        .as_deref()
        .and_then(|id| id.strip_prefix(&prefix))
        .and_then(|value| value.parse::<u32>().ok())
        .unwrap_or(0)
        + 1;
    Ok(format!("{prefix}{sequence:03}"))
}

fn unique_destination(directory: &Path, source: &Path) -> PathBuf {
    let original = source
        .file_name()
        .and_then(|value| value.to_str())
        .filter(|value| !value.is_empty())
        .unwrap_or("attachment");
    let sanitized: String = original
        .chars()
        .map(|character| {
            if character.is_control()
                || matches!(
                    character,
                    '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|'
                )
            {
                '_'
            } else {
                character
            }
        })
        .collect();
    let direct = directory.join(&sanitized);
    if !direct.exists() {
        return direct;
    }
    let stem = Path::new(&sanitized)
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("attachment");
    let extension = Path::new(&sanitized)
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| format!(".{value}"))
        .unwrap_or_default();
    for index in 2..10_000 {
        let candidate = directory.join(format!("{stem}-{index}{extension}"));
        if !candidate.exists() {
            return candidate;
        }
    }
    directory.join(format!("{stem}-{}{}", now_ms(), extension))
}

fn save_record(conn: &Connection, record: &ExperimentRecord) -> Result<(), String> {
    validate_experiment_id(&record.id)?;
    let tags = serde_json::to_string(&record.tags).map_err(|error| error.to_string())?;
    let source_files =
        serde_json::to_string(&record.source_files).map_err(|error| error.to_string())?;
    let missing_fields =
        serde_json::to_string(&record.missing_fields).map_err(|error| error.to_string())?;
    let metadata = serde_json::to_string(&record.metadata).map_err(|error| error.to_string())?;
    conn.execute(
        "INSERT INTO experiments (
           id, title, experiment_date, system_code, device_code, experiment_type,
           sample_batch, status, purpose, summary, conclusion, anomaly, archived,
           tags_json, raw_dir, standardized_path, source_files_json,
           missing_fields_json, metadata_json, created_at, updated_at
         ) VALUES (
           ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14,
           ?15, ?16, ?17, ?18, ?19, ?20, ?21
         ) ON CONFLICT(id) DO UPDATE SET
           title=excluded.title, experiment_date=excluded.experiment_date,
           system_code=excluded.system_code, device_code=excluded.device_code,
           experiment_type=excluded.experiment_type, sample_batch=excluded.sample_batch,
           status=excluded.status, purpose=excluded.purpose, summary=excluded.summary,
           conclusion=excluded.conclusion, anomaly=excluded.anomaly,
           archived=excluded.archived, tags_json=excluded.tags_json,
           raw_dir=excluded.raw_dir, standardized_path=excluded.standardized_path,
           source_files_json=excluded.source_files_json,
           missing_fields_json=excluded.missing_fields_json,
           metadata_json=excluded.metadata_json, updated_at=excluded.updated_at",
        params![
            record.id,
            record.title,
            record.date,
            record.system_code,
            record.device_code,
            record.experiment_type,
            record.sample_batch,
            record.status,
            record.purpose,
            record.summary,
            record.conclusion,
            i64::from(record.anomaly),
            i64::from(record.archived),
            tags,
            record.raw_dir,
            record.standardized_path,
            source_files,
            missing_fields,
            metadata,
            record.created_at,
            record.updated_at,
        ],
    )
    .map_err(|error| error.to_string())?;
    Ok(())
}

fn find_record(conn: &Connection, id: &str) -> Result<Option<ExperimentRecord>, String> {
    conn.query_row(
        "SELECT id, title, experiment_date, system_code, device_code,
                experiment_type, sample_batch, status, purpose, summary,
                conclusion, anomaly, archived, tags_json, raw_dir,
                standardized_path, source_files_json, missing_fields_json,
                metadata_json, created_at, updated_at
         FROM experiments WHERE id = ?1",
        [id],
        record_from_row,
    )
    .optional()
    .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn list_experiments(
    app: AppHandle,
    query: Option<String>,
    include_archived: Option<bool>,
) -> Result<Vec<ExperimentRecord>, String> {
    let (conn, _) = connection(&app)?;
    let query = query.unwrap_or_default().trim().to_lowercase();
    let pattern = format!("%{query}%");
    let mut statement = conn
        .prepare(
            "SELECT id, title, experiment_date, system_code, device_code,
                    experiment_type, sample_batch, status, purpose, summary,
                    conclusion, anomaly, archived, tags_json, raw_dir,
                    standardized_path, source_files_json, missing_fields_json,
                    metadata_json, created_at, updated_at
             FROM experiments
             WHERE (?1 = '' OR lower(id || ' ' || title || ' ' || summary || ' ' || tags_json) LIKE ?2)
               AND (?3 = 1 OR archived = 0)
             ORDER BY experiment_date DESC, updated_at DESC",
        )
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map(
            params![query, pattern, i64::from(include_archived.unwrap_or(false))],
            record_from_row,
        )
        .map_err(|error| error.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn read_experiment(app: AppHandle, id: String) -> Result<ExperimentRecord, String> {
    validate_experiment_id(&id)?;
    let (conn, _) = connection(&app)?;
    find_record(&conn, &id)?.ok_or_else(|| format!("experiment not found: {id}"))
}

#[tauri::command]
pub async fn pick_experiment_files(
    app: AppHandle,
    system_code: String,
    device_code: String,
    date: String,
    title: Option<String>,
) -> Result<Option<ExperimentRecord>, String> {
    use tauri_plugin_dialog::DialogExt;
    let Some(picked) = app.dialog().file().blocking_pick_files() else {
        return Ok(None);
    };
    let sources = picked
        .into_iter()
        .map(|file| file.into_path().map_err(|error| error.to_string()))
        .collect::<Result<Vec<PathBuf>, String>>()?;
    if sources.is_empty() {
        return Ok(None);
    }
    let date = validate_date(&date)?;
    let system_code = validate_code(&system_code, "EXP");
    let device_code = validate_code(&device_code, "B");
    let (conn, _) = connection(&app)?;
    let id = next_experiment_id(&conn, &system_code, &device_code, &date)?;
    let workspace = workspace_dir(&app)?;
    let description = title
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("实验记录");
    let folder_label: String = description
        .chars()
        .filter(|character| {
            !character.is_control()
                && !matches!(
                    character,
                    '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|'
                )
        })
        .take(48)
        .collect();
    let raw_dir = workspace.join("raw").join("experiments").join(format!(
        "{}_{}_{}",
        date.replace('-', "."),
        folder_label,
        id
    ));
    std::fs::create_dir_all(&raw_dir).map_err(|error| error.to_string())?;
    let mut copied = Vec::new();
    for source in sources {
        if !source.is_file() {
            continue;
        }
        let destination = unique_destination(&raw_dir, &source);
        std::fs::copy(&source, &destination)
            .map_err(|error| format!("could not archive {}: {error}", source.display()))?;
        copied.push(destination.to_string_lossy().into_owned());
    }
    if copied.is_empty() {
        return Err("no regular experiment files were selected".into());
    }
    let now = now_ms();
    let record = ExperimentRecord {
        id,
        title: description.to_owned(),
        date,
        system_code,
        device_code,
        experiment_type: "待规范化".into(),
        sample_batch: None,
        status: "draft".into(),
        purpose: String::new(),
        summary: String::new(),
        conclusion: String::new(),
        anomaly: false,
        archived: false,
        tags: Vec::new(),
        raw_dir: raw_dir.to_string_lossy().into_owned(),
        standardized_path: None,
        source_files: copied,
        missing_fields: vec![
            "experiment_type".into(),
            "purpose".into(),
            "conclusion".into(),
        ],
        metadata: serde_json::json!({ "normalization": "pending", "source": "native-upload" }),
        created_at: now,
        updated_at: now,
    };
    save_record(&conn, &record)?;
    crate::git_snapshot::request_snapshot(&workspace);
    Ok(Some(record))
}

#[tauri::command]
pub fn update_experiment(
    app: AppHandle,
    mut record: ExperimentRecord,
) -> Result<ExperimentRecord, String> {
    validate_date(&record.date)?;
    validate_experiment_id(&record.id)?;
    let (conn, _) = connection(&app)?;
    let existing = find_record(&conn, &record.id)?
        .ok_or_else(|| format!("experiment not found: {}", record.id))?;
    // The normal editor may update structured fields, but it cannot redirect
    // provenance to a different raw archive or manufacture a creation time.
    record.raw_dir = existing.raw_dir;
    record.source_files = existing.source_files;
    record.created_at = existing.created_at;
    record.updated_at = now_ms();
    save_record(&conn, &record)?;
    Ok(record)
}

#[tauri::command]
pub fn set_experiment_archived(
    app: AppHandle,
    id: String,
    archived: bool,
) -> Result<ExperimentRecord, String> {
    validate_experiment_id(&id)?;
    let (conn, _) = connection(&app)?;
    conn.execute(
        "UPDATE experiments SET archived = ?2, updated_at = ?3 WHERE id = ?1",
        params![id, i64::from(archived), now_ms()],
    )
    .map_err(|error| error.to_string())?;
    find_record(&conn, &id)?.ok_or_else(|| format!("experiment not found: {id}"))
}

#[tauri::command]
pub fn remove_experiment_record(app: AppHandle, id: String) -> Result<(), String> {
    validate_experiment_id(&id)?;
    let (conn, _) = connection(&app)?;
    conn.execute("DELETE FROM experiments WHERE id = ?1", [&id])
        .map_err(|error| error.to_string())?;
    // Raw attachments and normalized Markdown deliberately remain recoverable.
    Ok(())
}

fn apply_inbox(mut record: ExperimentRecord, inbox: InboxRecord) -> ExperimentRecord {
    if let Some(value) = inbox.title.filter(|value| !value.trim().is_empty()) {
        record.title = value;
    }
    if let Some(value) = inbox.date.filter(|value| validate_date(value).is_ok()) {
        record.date = value;
    }
    if let Some(value) = inbox.system_code {
        record.system_code = validate_code(&value, &record.system_code);
    }
    if let Some(value) = inbox.device_code {
        record.device_code = validate_code(&value, &record.device_code);
    }
    if let Some(value) = inbox.experiment_type {
        record.experiment_type = value;
    }
    if inbox.sample_batch.is_some() {
        record.sample_batch = inbox.sample_batch;
    }
    if let Some(value) = inbox.status {
        record.status = value;
    } else {
        record.status = "normalized".into();
    }
    if let Some(value) = inbox.purpose {
        record.purpose = value;
    }
    if let Some(value) = inbox.summary {
        record.summary = value;
    }
    if let Some(value) = inbox.conclusion {
        record.conclusion = value;
    }
    if let Some(value) = inbox.anomaly {
        record.anomaly = value;
    }
    if let Some(value) = inbox.tags {
        record.tags = value;
    }
    if let Some(value) = inbox.standardized_path {
        record.standardized_path = Some(value);
    }
    if let Some(value) = inbox.missing_fields {
        record.missing_fields = value;
    }
    if let Some(value) = inbox.metadata {
        record.metadata = value;
    }
    // Raw evidence is immutable. An inbox may repeat the locations for a
    // receipt, but it cannot redirect an existing database record.
    let _ = inbox.raw_dir;
    let _ = inbox.source_files;
    record.updated_at = now_ms();
    record
}

#[tauri::command]
pub fn sync_experiment_inbox(app: AppHandle) -> Result<Vec<ExperimentRecord>, String> {
    let workspace = workspace_dir(&app)?;
    let inbox_dir = workspace.join(".openscience").join("experiment-inbox");
    let Ok(entries) = std::fs::read_dir(&inbox_dir) else {
        return Ok(Vec::new());
    };
    let (conn, _) = connection(&app)?;
    let mut synced = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|value| value.to_str()) != Some("json") {
            continue;
        }
        let Ok(text) = std::fs::read_to_string(&path) else {
            continue;
        };
        let Ok(inbox) = serde_json::from_str::<InboxRecord>(&text) else {
            continue;
        };
        let id = inbox
            .exp_id
            .clone()
            .or_else(|| inbox.id.clone())
            .unwrap_or_default();
        if validate_experiment_id(&id).is_err() {
            continue;
        }
        let Some(existing) = find_record(&conn, &id)? else {
            continue;
        };
        let record = apply_inbox(existing, inbox);
        save_record(&conn, &record)?;
        synced.push(record);
    }
    Ok(synced)
}

#[tauri::command]
pub fn experiment_database_status(app: AppHandle) -> Result<Value, String> {
    let (conn, path) = connection(&app)?;
    let total: i64 = conn
        .query_row("SELECT COUNT(*) FROM experiments", [], |row| row.get(0))
        .map_err(|error| error.to_string())?;
    Ok(serde_json::json!({
        "databasePath": path,
        "total": total,
        "workspace": workspace_dir(&app)?,
    }))
}

#[cfg(test)]
mod tests {
    use super::{
        apply_inbox, next_experiment_id, validate_experiment_id, ExperimentRecord, InboxRecord,
    };
    use rusqlite::Connection;

    fn schema(conn: &Connection) {
        conn.execute_batch("CREATE TABLE experiments (id TEXT PRIMARY KEY);")
            .unwrap();
    }

    #[test]
    fn portable_ids_reject_paths() {
        assert!(validate_experiment_id("OX-E-260830-001").is_ok());
        assert!(validate_experiment_id("../record").is_err());
        assert!(validate_experiment_id("C:\\record").is_err());
    }

    #[test]
    fn ids_increment_by_system_device_and_day() {
        let conn = Connection::open_in_memory().unwrap();
        schema(&conn);
        assert_eq!(
            next_experiment_id(&conn, "OX", "E", "2026-08-30").unwrap(),
            "OX-E-260830-001"
        );
        conn.execute(
            "INSERT INTO experiments(id) VALUES (?1)",
            ["OX-E-260830-001"],
        )
        .unwrap();
        assert_eq!(
            next_experiment_id(&conn, "OX", "E", "2026-08-30").unwrap(),
            "OX-E-260830-002"
        );
    }

    #[test]
    fn inbox_cannot_redirect_raw_evidence() {
        let record = ExperimentRecord {
            id: "OX-E-260830-001".into(),
            title: "draft".into(),
            date: "2026-08-30".into(),
            system_code: "OX".into(),
            device_code: "E".into(),
            experiment_type: "draft".into(),
            sample_batch: None,
            status: "draft".into(),
            purpose: String::new(),
            summary: String::new(),
            conclusion: String::new(),
            anomaly: false,
            archived: false,
            tags: vec![],
            raw_dir: "trusted/raw".into(),
            standardized_path: None,
            source_files: vec!["trusted/raw/a.txt".into()],
            missing_fields: vec![],
            metadata: serde_json::json!({}),
            created_at: 1,
            updated_at: 1,
        };
        let inbox = InboxRecord {
            title: Some("normalized".into()),
            raw_dir: Some("other/raw".into()),
            source_files: Some(vec!["other/raw/b.txt".into()]),
            ..Default::default()
        };
        let updated = apply_inbox(record, inbox);
        assert_eq!(updated.title, "normalized");
        assert_eq!(updated.raw_dir, "trusted/raw");
        assert_eq!(updated.source_files, vec!["trusted/raw/a.txt"]);
    }
}
