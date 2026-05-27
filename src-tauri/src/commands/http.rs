use super::*;

// ==================== HTTP 请求工具 ====================
#[derive(Serialize, Deserialize, Clone)]
pub struct HttpRequest {
    pub method: String,
    pub url: String,
    pub headers: std::collections::HashMap<String, String>,
    pub body_type: String,
    pub body: String,
    pub timeout: u64,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct HttpResponse {
    pub success: bool,
    pub status: u16,
    pub status_text: String,
    pub headers: std::collections::HashMap<String, String>,
    pub body: String,
    pub time_ms: u64,
    pub size_bytes: u64,
    pub redirects: Vec<HttpRedirect>,
    pub error: Option<String>,
    pub is_image: bool,
    pub content_type: String,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct HttpRedirect {
    pub status: u16,
    pub status_text: String,
    pub url: String,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct HttpHistoryEntry {
    pub id: String,
    pub request: HttpRequest,
    pub response: Option<HttpResponse>,
    pub created_at: i64,
    pub name: Option<String>,
    pub folder_id: Option<String>,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct HttpFolder {
    pub id: String,
    pub name: String,
    pub parent_id: Option<String>,
    pub created_at: i64,
}

#[tauri::command]
pub async fn http_request(req: HttpRequest) -> HttpResponse {
    let timeout_dur = std::time::Duration::from_secs(if req.timeout == 0 { 30 } else { req.timeout });

    let method = match req.method.to_uppercase().as_str() {
        "POST" => reqwest::Method::POST,
        "PUT" => reqwest::Method::PUT,
        "DELETE" => reqwest::Method::DELETE,
        "PATCH" => reqwest::Method::PATCH,
        "HEAD" => reqwest::Method::HEAD,
        "OPTIONS" => reqwest::Method::OPTIONS,
        _ => reqwest::Method::GET,
    };

    // 先用禁止重定向的客户端跟踪重定向链
    let no_redirect_client = reqwest::Client::builder()
        .timeout(timeout_dur)
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .unwrap_or_default();

    let auto_content_type = matches!(req.body_type.as_str(), "json" | "form" | "form-data");
    let mut redirects: Vec<HttpRedirect> = Vec::new();
    let mut current_url = req.url.clone();
    let max_redirects = 10u32;

    for _ in 0..max_redirects {
        let mut builder = no_redirect_client.request(method.clone(), &current_url);
        for (k, v) in &req.headers {
            if !k.is_empty() {
                if auto_content_type && k.eq_ignore_ascii_case("content-type") {
                    continue;
                }
                builder = builder.header(k.as_str(), v.as_str());
            }
        }
        if req.method != "GET" && req.method != "HEAD" && !req.body.is_empty() {
            match req.body_type.as_str() {
                "json" => {
                    builder = builder.header("Content-Type", "application/json").body(req.body.clone());
                }
                "form" => {
                    if let Ok(map) = serde_json::from_str::<std::collections::HashMap<String, String>>(&req.body) {
                        builder = builder.form(&map);
                    } else {
                        builder = builder.body(req.body.clone());
                    }
                }
                "form-data" => {
                    if let Ok(map) = serde_json::from_str::<std::collections::HashMap<String, String>>(&req.body) {
                        let mut form = reqwest::multipart::Form::new();
                        for (k, v) in &map {
                            form = form.text(k.clone(), v.clone());
                        }
                        builder = builder.multipart(form);
                    } else {
                        builder = builder.body(req.body.clone());
                    }
                }
                _ => {
                    builder = builder.body(req.body.clone());
                }
            }
        }

        match builder.send().await {
            Ok(resp) => {
                let status = resp.status().as_u16();
                if status >= 300 && status < 400 {
                    if let Some(location) = resp.headers().get("location") {
                        let location_str = location.to_str().unwrap_or("").to_string();
                        // 处理相对路径
                        if location_str.starts_with("http://") || location_str.starts_with("https://") {
                            current_url = location_str;
                        } else if location_str.starts_with('/') {
                            if let Ok(parsed) = url::Url::parse(&req.url) {
                                current_url = parsed.origin().ascii_serialization() + &location_str;
                            } else {
                                current_url = location_str;
                            }
                        } else {
                            current_url = location_str;
                        }
                        redirects.push(HttpRedirect {
                            status,
                            status_text: resp.status().canonical_reason().unwrap_or("").to_string(),
                            url: current_url.clone(),
                        });
                        continue;
                    }
                }
                // 非重定向响应或无 Location 头，跳出循环用正常客户端发最终请求
                break;
            }
            Err(_) => break,
        }
    }

    // 用自动重定向的客户端发送最终请求获取完整响应
    let client = reqwest::Client::builder()
        .timeout(timeout_dur)
        .build()
        .unwrap_or_default();

    let mut builder = client.request(method.clone(), &req.url);
    for (k, v) in &req.headers {
        if !k.is_empty() {
            if auto_content_type && k.eq_ignore_ascii_case("content-type") {
                continue;
            }
            builder = builder.header(k.as_str(), v.as_str());
        }
    }
    if req.method != "GET" && req.method != "HEAD" && !req.body.is_empty() {
        match req.body_type.as_str() {
            "json" => {
                builder = builder.header("Content-Type", "application/json").body(req.body.clone());
            }
            "form" => {
                if let Ok(map) = serde_json::from_str::<std::collections::HashMap<String, String>>(&req.body) {
                    builder = builder.form(&map);
                } else {
                    builder = builder.body(req.body.clone());
                }
            }
            "form-data" => {
                if let Ok(map) = serde_json::from_str::<std::collections::HashMap<String, String>>(&req.body) {
                    let mut form = reqwest::multipart::Form::new();
                    for (k, v) in &map {
                        form = form.text(k.clone(), v.clone());
                    }
                    builder = builder.multipart(form);
                } else {
                    builder = builder.body(req.body.clone());
                }
            }
            _ => {
                builder = builder.body(req.body.clone());
            }
        }
    }

    let start = std::time::Instant::now();
    match builder.send().await {
        Ok(resp) => {
            let elapsed = start.elapsed().as_millis() as u64;
            let status = resp.status().as_u16();
            let status_text = resp.status().canonical_reason().unwrap_or("").to_string();
            let resp_headers: std::collections::HashMap<String, String> = resp
                .headers()
                .iter()
                .map(|(k, v)| (k.to_string(), v.to_str().unwrap_or("").to_string()))
                .collect();
            let content_type = resp_headers.get("content-type").cloned().unwrap_or_default();
            let is_image = content_type.starts_with("image/");
            let body_bytes = match resp.bytes().await {
                Ok(b) => b,
                Err(e) => {
                    return HttpResponse {
                        success: false, status, status_text, headers: resp_headers,
                        body: String::new(), time_ms: elapsed, size_bytes: 0, redirects,
                        error: Some(format!("读取响应体失败: {}", e)),
                        is_image: false, content_type: String::new(),
                    };
                }
            };
            let size = body_bytes.len() as u64;
            let body = if is_image {
                use base64::Engine;
                base64::engine::general_purpose::STANDARD.encode(&body_bytes)
            } else {
                String::from_utf8_lossy(&body_bytes).to_string()
            };
            HttpResponse {
                success: true, status, status_text, headers: resp_headers,
                body, time_ms: elapsed, size_bytes: size, redirects, error: None,
                is_image, content_type,
            }
        }
        Err(e) => {
            let elapsed = start.elapsed().as_millis() as u64;
            let mut msg = e.to_string();
            if e.is_timeout() { msg = "请求超时".to_string(); }
            else if e.is_connect() { msg = format!("连接失败: {}", e); }
            else if e.is_request() { msg = format!("请求构造失败: {}", e); }
            HttpResponse {
                success: false, status: 0, status_text: String::new(),
                headers: std::collections::HashMap::new(), body: String::new(),
                time_ms: elapsed, size_bytes: 0, redirects: Vec::new(), error: Some(msg),
                is_image: false, content_type: String::new(),
            }
        }
    }
}

fn http_data_dir(app: &tauri::AppHandle) -> std::path::PathBuf {
    let dir = app.path().app_data_dir().unwrap_or_else(|_| std::env::temp_dir());
    let dir = dir.join("http");
    let _ = std::fs::create_dir_all(&dir);
    dir
}

#[tauri::command]
pub fn http_save_history(app: tauri::AppHandle, entries: Vec<HttpHistoryEntry>) -> Result<(), String> {
    let path = http_data_dir(&app).join("history.json");
    let data = serde_json::to_string_pretty(&entries).map_err(|e| format!("序列化失败: {}", e))?;
    std::fs::write(&path, data).map_err(|e| format!("写入失败: {}", e))
}

#[tauri::command]
pub fn http_load_history(app: tauri::AppHandle) -> Vec<HttpHistoryEntry> {
    let path = http_data_dir(&app).join("history.json");
    let data = match std::fs::read_to_string(&path) {
        Ok(d) => d,
        Err(_) => return Vec::new(),
    };
    serde_json::from_str(&data).unwrap_or_default()
}

#[tauri::command]
pub fn http_save_favorites(app: tauri::AppHandle, entries: Vec<HttpHistoryEntry>) -> Result<(), String> {
    let path = http_data_dir(&app).join("favorites.json");
    let data = serde_json::to_string_pretty(&entries).map_err(|e| format!("序列化失败: {}", e))?;
    std::fs::write(&path, data).map_err(|e| format!("写入失败: {}", e))
}

#[tauri::command]
pub fn http_load_favorites(app: tauri::AppHandle) -> Vec<HttpHistoryEntry> {
    let path = http_data_dir(&app).join("favorites.json");
    let data = match std::fs::read_to_string(&path) {
        Ok(d) => d,
        Err(_) => return Vec::new(),
    };
    serde_json::from_str(&data).unwrap_or_default()
}

#[tauri::command]
pub fn http_save_folders(app: tauri::AppHandle, folders: Vec<HttpFolder>) -> Result<(), String> {
    let path = http_data_dir(&app).join("folders.json");
    let data = serde_json::to_string_pretty(&folders).map_err(|e| format!("序列化失败: {}", e))?;
    std::fs::write(&path, data).map_err(|e| format!("写入失败: {}", e))
}

#[tauri::command]
pub fn http_load_folders(app: tauri::AppHandle) -> Vec<HttpFolder> {
    let path = http_data_dir(&app).join("folders.json");
    let data = match std::fs::read_to_string(&path) {
        Ok(d) => d,
        Err(_) => return Vec::new(),
    };
    serde_json::from_str(&data).unwrap_or_default()
}

