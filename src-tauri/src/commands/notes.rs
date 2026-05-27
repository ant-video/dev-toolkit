use super::*;

#[derive(Serialize, Deserialize, Clone, Default)]
pub struct NoteAttachment {
    pub id: String,
    pub name: String,
    pub mime: String,
    pub data_url: String,
    pub size: u64,
    pub added_at: i64,
}

#[derive(Serialize, Deserialize, Clone, Default)]
pub struct NoteEntry {
    pub id: String,
    pub title: String,
    pub content: String,
    pub tags: Vec<String>,
    #[serde(default)]
    pub attachments: Vec<NoteAttachment>,
    #[serde(default)]
    pub reminder_at: Option<i64>,
    #[serde(default)]
    pub reminder_done: bool,
    pub pinned: bool,
    pub archived: bool,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Deserialize)]
pub struct NoteInput {
    pub id: Option<String>,
    pub title: String,
    pub content: String,
    pub tags: Vec<String>,
    #[serde(default)]
    pub attachments: Vec<NoteAttachment>,
    #[serde(default)]
    pub reminder_at: Option<i64>,
    #[serde(default)]
    pub reminder_done: bool,
    pub pinned: bool,
    pub archived: bool,
}

fn notes_data_dir(app: &tauri::AppHandle) -> std::path::PathBuf {
    let dir = app.path().app_data_dir().unwrap_or_else(|_| std::env::temp_dir());
    let dir = dir.join("notes");
    let _ = std::fs::create_dir_all(&dir);
    dir
}

fn notes_path(app: &tauri::AppHandle) -> std::path::PathBuf {
    notes_data_dir(app).join("notes.json")
}

fn normalize_tags(tags: Vec<String>) -> Vec<String> {
    let mut tags: Vec<String> = tags
        .into_iter()
        .map(|tag| tag.trim().trim_start_matches('#').to_string())
        .filter(|tag| !tag.is_empty())
        .collect();
    tags.sort_by_key(|tag| tag.to_lowercase());
    tags.dedup_by(|a, b| a.eq_ignore_ascii_case(b));
    tags
}

fn load_notes_from_disk(app: &tauri::AppHandle) -> Vec<NoteEntry> {
    let path = notes_path(app);
    let data = match std::fs::read_to_string(&path) {
        Ok(data) => data,
        Err(_) => return Vec::new(),
    };
    let mut notes: Vec<NoteEntry> = serde_json::from_str(&data).unwrap_or_default();
    notes.sort_by(|a, b| {
        b.pinned
            .cmp(&a.pinned)
            .then_with(|| b.updated_at.cmp(&a.updated_at))
            .then_with(|| a.title.to_lowercase().cmp(&b.title.to_lowercase()))
    });
    notes
}

fn save_notes_to_disk(app: &tauri::AppHandle, notes: &[NoteEntry]) -> Result<(), String> {
    let path = notes_path(app);
    let data = serde_json::to_string_pretty(notes).map_err(|e| format!("序列化笔记失败: {}", e))?;
    std::fs::write(&path, data).map_err(|e| format!("保存笔记失败: {}", e))
}

#[tauri::command]
pub fn notes_list(app: tauri::AppHandle) -> Vec<NoteEntry> {
    load_notes_from_disk(&app)
}

#[tauri::command]
pub fn notes_save(app: tauri::AppHandle, input: NoteInput) -> Result<NoteEntry, String> {
    let mut notes = load_notes_from_disk(&app);
    let now = chrono::Utc::now().timestamp_millis();
    let id = input
        .id
        .filter(|id| !id.trim().is_empty())
        .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
    let title = input.title.trim().to_string();
    let content = input.content;
    let tags = normalize_tags(input.tags);
    let attachments = input.attachments;
    let reminder_at = input.reminder_at.filter(|value| *value > 0);

    if title.is_empty() && content.trim().is_empty() && attachments.is_empty() {
        return Err("标题、内容和附件不能同时为空".to_string());
    }

    let note = if let Some(existing) = notes.iter_mut().find(|note| note.id == id) {
        existing.title = title;
        existing.content = content;
        existing.tags = tags;
        existing.attachments = attachments;
        existing.reminder_at = reminder_at;
        existing.reminder_done = input.reminder_done || reminder_at.is_none();
        existing.pinned = input.pinned;
        existing.archived = input.archived;
        existing.updated_at = now;
        existing.clone()
    } else {
        let note = NoteEntry {
            id,
            title,
            content,
            tags,
            attachments,
            reminder_at,
            reminder_done: input.reminder_done || reminder_at.is_none(),
            pinned: input.pinned,
            archived: input.archived,
            created_at: now,
            updated_at: now,
        };
        notes.push(note.clone());
        note
    };

    save_notes_to_disk(&app, &notes)?;
    Ok(note)
}

#[tauri::command]
pub fn notes_delete(app: tauri::AppHandle, id: String) -> Result<(), String> {
    let mut notes = load_notes_from_disk(&app);
    let before = notes.len();
    notes.retain(|note| note.id != id);
    if notes.len() == before {
        return Err("笔记不存在".to_string());
    }
    save_notes_to_disk(&app, &notes)
}

#[tauri::command]
pub fn notes_set_archived(app: tauri::AppHandle, id: String, archived: bool) -> Result<NoteEntry, String> {
    let mut notes = load_notes_from_disk(&app);
    let now = chrono::Utc::now().timestamp_millis();
    let note = notes
        .iter_mut()
        .find(|note| note.id == id)
        .ok_or_else(|| "笔记不存在".to_string())?;
    note.archived = archived;
    note.updated_at = now;
    let saved = note.clone();
    save_notes_to_disk(&app, &notes)?;
    Ok(saved)
}

#[tauri::command]
pub fn notes_mark_reminder_done(app: tauri::AppHandle, id: String) -> Result<NoteEntry, String> {
    let mut notes = load_notes_from_disk(&app);
    let now = chrono::Utc::now().timestamp_millis();
    let note = notes
        .iter_mut()
        .find(|note| note.id == id)
        .ok_or_else(|| "笔记不存在".to_string())?;
    note.reminder_done = true;
    note.updated_at = now;
    let saved = note.clone();
    save_notes_to_disk(&app, &notes)?;
    Ok(saved)
}

#[tauri::command]
pub fn notes_export_markdown(app: tauri::AppHandle, id: String) -> Result<String, String> {
    let notes = load_notes_from_disk(&app);
    let note = notes
        .into_iter()
        .find(|note| note.id == id)
        .ok_or_else(|| "笔记不存在".to_string())?;
    let mut output = String::new();
    let title = if note.title.trim().is_empty() {
        "Untitled Note"
    } else {
        note.title.trim()
    };
    output.push_str("# ");
    output.push_str(title);
    output.push_str("\n\n");
    if !note.tags.is_empty() {
        output.push_str(&note.tags.iter().map(|tag| format!("#{}", tag)).collect::<Vec<_>>().join(" "));
        output.push_str("\n\n");
    }
    output.push_str(&note.content);
    Ok(output)
}
