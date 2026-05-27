use super::*;
use std::sync::Mutex;

// ===== 翻译工具 =====
#[derive(serde::Serialize)]
pub struct TranslateResult {
    pub success: bool,
    pub result: String,
    pub error: Option<String>,
}

#[tauri::command]
pub async fn translate(text: String, source: String, target: String) -> TranslateResult {
    if text.trim().is_empty() {
        return TranslateResult {
            success: false,
            result: String::new(),
            error: Some("请输入要翻译的文本".to_string()),
        };
    }

    // MyMemory API: https://api.mymemory.translated.net/get?q=text&langpair=source|target
    let lang_pair = format!("{}|{}", source, target);
    let url = format!(
        "https://api.mymemory.translated.net/get?q={}&langpair={}",
        urlencoding::encode(&text),
        urlencoding::encode(&lang_pair)
    );

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .unwrap_or_default();

    match client.get(&url).send().await {
        Ok(resp) => {
            match resp.text().await {
                Ok(body) => {
                    // 解析 JSON 响应
                    if let Ok(json) = serde_json::from_str::<serde_json::Value>(&body) {
                        if let Some(response_data) = json.get("responseData") {
                            if let Some(translated) = response_data.get("translatedText") {
                                if let Some(translated_text) = translated.as_str() {
                                    return TranslateResult {
                                        success: true,
                                        result: translated_text.to_string(),
                                        error: None,
                                    };
                                }
                            }
                        }
                        // 检查错误信息
                        if let Some(error_msg) = json.get("responseStatus") {
                            if error_msg.as_str() != Some("200") {
                                return TranslateResult {
                                    success: false,
                                    result: String::new(),
                                    error: Some(format!("翻译失败: {:?}", error_msg)),
                                };
                            }
                        }
                    }
                    TranslateResult {
                        success: false,
                        result: String::new(),
                        error: Some("解析翻译结果失败".to_string()),
                    }
                }
                Err(e) => TranslateResult {
                    success: false,
                    result: String::new(),
                    error: Some(format!("读取响应失败: {}", e)),
                },
            }
        }
        Err(e) => TranslateResult {
            success: false,
            result: String::new(),
            error: Some(format!("请求失败: {}", e)),
        },
    }
}

/// 打开在线翻译窗口（WebView）
#[tauri::command]
pub async fn open_translate_webview(
    app: tauri::AppHandle,
    service: String,
) -> Result<(), String> {
    let (url, title) = match service.as_str() {
        "youdao" => (
            "https://m.youdao.com/translate".parse::<url::Url>().unwrap(),
            "有道翻译",
        ),
        "google" => (
            "https://translate.google.com".parse::<url::Url>().unwrap(),
            "Google 翻译",
        ),
        "baidu" => (
            "https://fanyi.baidu.com".parse::<url::Url>().unwrap(),
            "百度翻译",
        ),
        "deepl" => (
            "https://www.deepl.com/translator".parse::<url::Url>().unwrap(),
            "DeepL 翻译",
        ),
        _ => return Err(format!("未知的翻译服务: {}", service)),
    };

    let label = format!("translate-{}", service);

    tauri::WebviewWindowBuilder::new(
        &app,
        label,
        tauri::WebviewUrl::External(url),
    )
    .title(title)
    .inner_size(900.0, 700.0)
    .center()
    .resizable(true)
    .build()
    .map_err(|e| format!("创建窗口失败: {}", e))?;

    Ok(())
}

// ==================== SSH会话管理 ====================

use crate::ssh::SshSession;

#[tauri::command]
pub fn ssh_list_sessions() -> Result<Vec<SshSession>, String> {
    crate::ssh::load_sessions()
}

#[tauri::command]
pub fn ssh_save_session(session: SshSession) -> Result<SshSession, String> {
    if session.id.is_empty() {
        crate::ssh::add_session(session)
    } else {
        crate::ssh::update_session(&session)?;
        Ok(session)
    }
}

#[tauri::command]
pub fn ssh_delete_session(id: String) -> Result<(), String> {
    crate::ssh::delete_session(&id)
}

#[tauri::command]
pub fn ssh_get_groups() -> Result<Vec<String>, String> {
    crate::ssh::get_groups()
}

#[tauri::command]
pub fn ssh_import_sessions(json: String) -> Result<Vec<SshSession>, String> {
    let sessions: Vec<SshSession> = serde_json::from_str(&json)
        .map_err(|e| format!("解析导入数据失败: {}", e))?;

    let mut existing = crate::ssh::load_sessions()?;
    for mut session in sessions {
        // 重新生成ID避免冲突
        session.id = uuid::Uuid::new_v4().to_string();
        let now = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
        session.created_at = now.clone();
        session.updated_at = now;
        existing.push(session);
    }

    crate::ssh::save_sessions(&existing)?;
    Ok(existing)
}

#[tauri::command]
pub fn ssh_export_sessions(ids: Vec<String>) -> Result<String, String> {
    let sessions = crate::ssh::load_sessions()?;
    let filtered: Vec<SshSession> = sessions
        .into_iter()
        .filter(|s| ids.is_empty() || ids.contains(&s.id))
        .collect();

    serde_json::to_string_pretty(&filtered)
        .map_err(|e| format!("导出失败: {}", e))
}

// ==================== SSH 连接管理 ====================

/// SSH测试命令
#[tauri::command]
pub fn ssh_test() -> Result<String, String> {
    Ok("SSH命令测试成功".to_string())
}

/// SSH连接
#[tauri::command]
pub async fn ssh_connect(
    app: tauri::AppHandle,
    _session_id: String,
    session: SshSession,
) -> Result<String, String> {
    crate::ssh::session::SSH_MANAGER
        .connect(&session, app)
        .await
}

/// SSH断开连接
#[tauri::command]
pub async fn ssh_disconnect(connection_id: String) -> Result<(), String> {
    crate::ssh::session::SSH_MANAGER
        .disconnect(&connection_id)
        .await
}

/// 创建PTY终端
#[tauri::command]
pub async fn ssh_create_pty(
    app: tauri::AppHandle,
    connection_id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    eprintln!("[PTY] Creating PTY for connection: {}, cols: {}, rows: {}", connection_id, cols, rows);

    // 创建PTY通道（这会设置session为非阻塞模式）
    let channel = crate::ssh::session::SSH_MANAGER
        .create_pty_for_connection(&connection_id, cols, rows)
        .await?;

    eprintln!("[PTY] PTY channel created successfully");

    // 启动读写循环
    let request_tx = crate::ssh::session::spawn_pty_loop(channel, connection_id.clone(), app);

    // 保存PTY会话
    {
        let mut sessions = crate::ssh::session::PTY_SESSIONS.write().await;
        sessions.insert(connection_id.clone(), crate::ssh::session::PtySession { request_tx });
        eprintln!("[PTY] PTY session saved for {}", connection_id);
    }

    eprintln!("[PTY] PTY creation completed");
    Ok(())
}

/// 调整PTY大小
#[tauri::command]
pub async fn ssh_resize_pty(
    connection_id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    let sessions = crate::ssh::session::PTY_SESSIONS.read().await;
    if let Some(session) = sessions.get(&connection_id) {
        let _ = session.request_tx.send(crate::ssh::session::PtyRequest::Resize { cols, rows });
        eprintln!("[RESIZE] Sent resize request for {}: {}x{}", connection_id, cols, rows);
    } else {
        eprintln!("[RESIZE] No PTY session found for {}", connection_id);
    }
    Ok(())
}

/// 写入数据到SSH通道
#[tauri::command]
pub async fn ssh_write(
    connection_id: String,
    data: Vec<u8>,
) -> Result<(), String> {
    eprintln!("[WRITE] Received write request, connection: {}, data len: {}", connection_id, data.len());

    let sessions = crate::ssh::session::PTY_SESSIONS.read().await;
    if let Some(session) = sessions.get(&connection_id) {
        let _ = session.request_tx.send(crate::ssh::session::PtyRequest::Write { data: data.clone() });
        eprintln!("[WRITE] Sent write request for {}, {} bytes", connection_id, data.len());
    } else {
        eprintln!("[WRITE] No PTY session found for {}", connection_id);
    }

    Ok(())
}

// ==================== SFTP 操作 ====================

/// SFTP列出目录
#[tauri::command]
pub async fn ssh_sftp_list_dir(
    connection_id: String,
    path: String,
) -> Result<Vec<crate::ssh::sftp::SftpEntry>, String> {
    crate::ssh::session::SSH_MANAGER
        .with_sftp(&connection_id, |sftp| crate::ssh::sftp::list_dir(sftp, &path))
        .await
}

/// SFTP读取文件
#[tauri::command]
pub async fn ssh_sftp_read_file(
    connection_id: String,
    path: String,
) -> Result<String, String> {
    crate::ssh::session::SSH_MANAGER
        .with_sftp(&connection_id, |sftp| crate::ssh::sftp::read_file(sftp, &path))
        .await
}

/// SFTP写入文件
#[tauri::command]
pub async fn ssh_sftp_write_file(
    connection_id: String,
    path: String,
    content: String,
) -> Result<(), String> {
    crate::ssh::session::SSH_MANAGER
        .with_sftp(&connection_id, |sftp| crate::ssh::sftp::write_file(sftp, &path, &content))
        .await
}

/// SFTP创建目录
#[tauri::command]
pub async fn ssh_sftp_mkdir(
    connection_id: String,
    path: String,
) -> Result<(), String> {
    crate::ssh::session::SSH_MANAGER
        .with_sftp(&connection_id, |sftp| crate::ssh::sftp::mkdir(sftp, &path))
        .await
}

/// SFTP删除文件
#[tauri::command]
pub async fn ssh_sftp_remove(
    connection_id: String,
    path: String,
    is_dir: bool,
) -> Result<(), String> {
    crate::ssh::session::SSH_MANAGER
        .with_sftp(&connection_id, |sftp| {
            if is_dir {
                crate::ssh::sftp::remove_dir(sftp, &path)
            } else {
                crate::ssh::sftp::remove_file(sftp, &path)
            }
        })
        .await
}

/// 本地文件信息
#[derive(Debug, Clone, serde::Serialize)]
pub struct LocalFileInfo {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub size: u64,
    pub modified: String,
}

/// 列出本地目录内容
#[tauri::command]
pub fn ssh_local_list_dir(path: String) -> Result<Vec<LocalFileInfo>, String> {
    let dir = std::fs::read_dir(&path)
        .map_err(|e| format!("读取目录失败: {}", e))?;

    let mut files: Vec<LocalFileInfo> = Vec::new();

    for entry in dir.flatten() {
        let meta = entry.metadata().ok();
        let name = entry.file_name().to_string_lossy().to_string();
        let is_dir = meta.as_ref().map(|m| m.is_dir()).unwrap_or(false);
        let size = meta.as_ref().map(|m| m.len()).unwrap_or(0);
        let modified = meta
            .and_then(|m| m.modified().ok())
            .map(|t| {
                let dt: chrono::DateTime<chrono::Local> = t.into();
                dt.format("%Y-%m-%d %H:%M").to_string()
            })
            .unwrap_or_default();

        files.push(LocalFileInfo {
            name,
            path: entry.path().to_string_lossy().to_string(),
            is_dir,
            size,
            modified,
        });
    }

    // 排序：目录优先，然后按名称
    files.sort_by(|a, b| {
        if a.is_dir != b.is_dir {
            b.is_dir.cmp(&a.is_dir)
        } else {
            a.name.to_lowercase().cmp(&b.name.to_lowercase())
        }
    });

    Ok(files)
}

/// 获取本地主目录
#[tauri::command]
pub fn ssh_local_home_dir() -> Result<String, String> {
    dirs::home_dir()
        .map(|p| p.to_string_lossy().to_string())
        .ok_or_else(|| "无法获取主目录".to_string())
}

/// 获取本地根目录/驱动器列表
#[tauri::command]
pub fn ssh_local_root_dirs() -> Result<Vec<LocalFileInfo>, String> {
    #[cfg(target_os = "windows")]
    {
        // Windows: 列出所有驱动器
        let mut drives = Vec::new();
        for letter in b'A'..=b'Z' {
            let path = format!("{}:\\", letter as char);
            if std::path::Path::new(&path).exists() {
                drives.push(LocalFileInfo {
                    name: format!("{}:", letter as char),
                    path: path.clone(),
                    is_dir: true,
                    size: 0,
                    modified: String::new(),
                });
            }
        }
        Ok(drives)
    }
    #[cfg(not(target_os = "windows"))]
    {
        // Unix: 返回根目录
        Ok(vec![LocalFileInfo {
            name: "/".to_string(),
            path: "/".to_string(),
            is_dir: true,
            size: 0,
            modified: String::new(),
        }])
    }
}

/// SFTP上传文件
#[tauri::command]
pub async fn ssh_sftp_upload(
    app: tauri::AppHandle,
    connection_id: String,
    local_path: String,
    remote_path: String,
) -> Result<(), String> {
    use std::io::{Read, Write};

    crate::ssh::session::SSH_MANAGER
        .with_sftp_transfer(&connection_id, |sftp| {
            // 获取本地文件大小
            let local_file = std::fs::File::open(&local_path)
                .map_err(|e| format!("打开本地文件失败: {}", e))?;
            let total_size = local_file.metadata()
                .map_err(|e| format!("获取文件信息失败: {}", e))?
                .len();

            // 创建远程文件
            let mut remote_file = sftp.create(std::path::Path::new(&remote_path))
                .map_err(|e| format!("创建远程文件失败: {}", e))?;

            // 分块上传
            let mut reader = std::io::BufReader::new(local_file);
            let mut buffer = [0u8; 32768];
            let mut transferred: u64 = 0;

            loop {
                let n = reader.read(&mut buffer)
                    .map_err(|e| format!("读取文件失败: {}", e))?;
                if n == 0 {
                    break;
                }

                remote_file.write_all(&buffer[..n])
                    .map_err(|e| format!("写入远程文件失败: {}", e))?;

                transferred += n as u64;

                let _ = app.emit(&format!("sftp-transfer-progress-{}", connection_id), serde_json::json!({
                    "local_path": &local_path,
                    "remote_path": &remote_path,
                    "transferred": transferred,
                    "total": total_size,
                    "percent": if total_size > 0 { (transferred * 100 / total_size) as u8 } else { 100 }
                }));
            }

            let _ = app.emit(&format!("sftp-transfer-complete-{}", connection_id), serde_json::json!({
                "local_path": &local_path,
                "remote_path": &remote_path,
                "success": true
            }));

            Ok(())
        })
        .await
}

/// SFTP下载文件
#[tauri::command]
pub async fn ssh_sftp_download(
    app: tauri::AppHandle,
    connection_id: String,
    remote_path: String,
    local_path: String,
) -> Result<(), String> {
    use std::io::{Read, Write};

    crate::ssh::session::SSH_MANAGER
        .with_sftp_transfer(&connection_id, |sftp| {
            // 打开远程文件
            let mut remote_file = sftp.open(std::path::Path::new(&remote_path))
                .map_err(|e| format!("打开远程文件失败: {}", e))?;

            // 获取远程文件大小
            let total_size = remote_file.stat()
                .map(|s| s.size.unwrap_or(0))
                .unwrap_or(0);

            // 创建本地文件
            let mut local_file = std::fs::File::create(&local_path)
                .map_err(|e| format!("创建本地文件失败: {}", e))?;

            // 分块下载
            let mut buffer = [0u8; 32768];
            let mut transferred: u64 = 0;

            loop {
                let n = remote_file.read(&mut buffer)
                    .map_err(|e| format!("读取远程文件失败: {}", e))?;
                if n == 0 {
                    break;
                }

                local_file.write_all(&buffer[..n])
                    .map_err(|e| format!("写入本地文件失败: {}", e))?;

                transferred += n as u64;

                let _ = app.emit(&format!("sftp-transfer-progress-{}", connection_id), serde_json::json!({
                    "remote_path": &remote_path,
                    "local_path": &local_path,
                    "transferred": transferred,
                    "total": total_size,
                    "percent": if total_size > 0 { (transferred * 100 / total_size) as u8 } else { 100 }
                }));
            }

            let _ = app.emit(&format!("sftp-transfer-complete-{}", connection_id), serde_json::json!({
                "remote_path": &remote_path,
                "local_path": &local_path,
                "success": true
            }));

            Ok(())
        })
        .await
}

// ==================== 系统监控 ====================

/// 系统监控数据
#[derive(Debug, Clone, serde::Serialize)]
pub struct SystemMonitorData {
    pub cpu_usage: Vec<f32>,
    pub memory: MemoryInfo,
    pub disk: Vec<DiskInfo>,
    pub network: NetworkInfo,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct MemoryInfo {
    pub total: u64,
    pub used: u64,
    pub free: u64,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct DiskInfo {
    pub name: String,
    pub total: u64,
    pub used: u64,
    pub usage: String,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct NetworkInfo {
    pub rx_bytes: u64,
    pub tx_bytes: u64,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct ProcessInfo {
    pub pid: u32,
    pub user: String,
    pub cpu: f32,
    pub mem: f32,
    pub command: String,
}

/// 获取系统监控数据（批量命令，减少锁持有时间）
#[tauri::command]
pub async fn ssh_monitor_data(
    connection_id: String,
) -> Result<SystemMonitorData, String> {
    use std::io::Read;

    crate::ssh::session::SSH_MANAGER.with_blocking(&connection_id, |session| {
        let mut channel = session.channel_session()
            .map_err(|e| format!("创建通道失败: {}", e))?;

        // 批量执行所有监控命令，用分隔符分隔
        channel.exec("echo '===LOAD==='; cat /proc/loadavg 2>/dev/null || echo '0 0 0'; echo '===CORES==='; nproc 2>/dev/null || echo 1; echo '===MEM==='; cat /proc/meminfo 2>/dev/null | grep -E '^(MemTotal|MemFree|MemAvailable|Buffers|Cached):'; echo '===DISK==='; df -k 2>/dev/null | tail -n +2; echo '===NET==='; cat /proc/net/dev 2>/dev/null | tail -n +3; echo '==='")
            .map_err(|e| format!("执行命令失败: {}", e))?;

        let mut output = String::new();
        channel.read_to_string(&mut output).ok();
        channel.close().ok();

        // 解析各部分（奇数索引是标记名，偶数索引是数据）
        let sections: Vec<&str> = output.split("===").collect();

        // 解析 CPU 负载
        let cpu_line = sections.get(1).unwrap_or(&"");
        let cpu_load: Vec<f32> = cpu_line.split_whitespace()
            .take(3)
            .filter_map(|s| s.parse().ok())
            .collect();

        // 解析核心数
        let cores_line = sections.get(3).unwrap_or(&"1");
        let cores: f32 = cores_line.trim().parse::<f32>().unwrap_or(1.0).max(1.0);

        // 将负载转换为百分比（负载/核心数）
        let cpu_usage: Vec<f32> = cpu_load.iter().map(|v| (v / cores).min(1.0)).collect();

        // 解析内存（索引偏移：CORES占了2个section）
        let mem_section = sections.get(5).unwrap_or(&"");
        let mut mem_total: u64 = 0;
        let mut mem_free: u64 = 0;
        let mut mem_available: u64 = 0;
        let mut mem_buffers: u64 = 0;
        let mut mem_cached: u64 = 0;

        for line in mem_section.lines() {
            let parts: Vec<&str> = line.split_whitespace().collect();
            if parts.len() >= 2 {
                let value: u64 = parts[1].parse().unwrap_or(0);
                match parts[0] {
                    "MemTotal:" => mem_total = value,
                    "MemFree:" => mem_free = value,
                    "MemAvailable:" => mem_available = value,
                    "Buffers:" => mem_buffers = value,
                    "Cached:" => mem_cached = value,
                    _ => {}
                }
            }
        }

        let mem_used = if mem_available > 0 {
            mem_total.saturating_sub(mem_available)
        } else {
            mem_total.saturating_sub(mem_free).saturating_sub(mem_buffers).saturating_sub(mem_cached)
        };

        // 解析磁盘
        let disk_section = sections.get(7).unwrap_or(&"");
        let mut disks: Vec<DiskInfo> = Vec::new();
        for line in disk_section.lines() {
            let parts: Vec<&str> = line.split_whitespace().collect();
            if parts.len() >= 6 {
                let fs_type = parts[0];
                if fs_type.starts_with("tmpfs") || fs_type.starts_with("devtmpfs") || fs_type.starts_with("overlay") {
                    continue;
                }
                let total: u64 = parts[1].parse().unwrap_or(0) * 1024;
                let used: u64 = parts[2].parse().unwrap_or(0) * 1024;
                let usage_str = parts[4].trim_end_matches('%');
                if total > 0 {
                    disks.push(DiskInfo {
                        name: parts[5].to_string(),
                        total,
                        used,
                        usage: format!("{}%", usage_str),
                    });
                }
            }
        }

        // 解析网络
        let net_section = sections.get(9).unwrap_or(&"");
        let mut total_rx: u64 = 0;
        let mut total_tx: u64 = 0;
        for line in net_section.lines() {
            let parts: Vec<&str> = line.split_whitespace().collect();
            if parts.len() >= 10 {
                let iface = parts[0].trim_end_matches(':');
                if iface != "lo" {
                    let rx: u64 = parts[1].parse().unwrap_or(0);
                    let tx: u64 = parts[9].parse().unwrap_or(0);
                    total_rx += rx;
                    total_tx += tx;
                }
            }
        }

        Ok(SystemMonitorData {
            cpu_usage: if cpu_usage.is_empty() { vec![0.0] } else { cpu_usage },
            memory: MemoryInfo {
                total: mem_total * 1024,
                used: mem_used * 1024,
                free: mem_free * 1024,
            },
            disk: disks,
            network: NetworkInfo {
                rx_bytes: total_rx,
                tx_bytes: total_tx,
            },
        })
    }).await
}

/// 获取进程列表
#[tauri::command]
pub async fn ssh_monitor_processes(
    connection_id: String,
) -> Result<Vec<ProcessInfo>, String> {
    use std::io::Read;

    crate::ssh::session::SSH_MANAGER.with_blocking(&connection_id, |session| {
        let mut channel = session.channel_session()
            .map_err(|e| format!("创建通道失败: {}", e))?;

        channel.exec("ps aux --sort=-%cpu 2>/dev/null | head -21 || ps aux | head -21")
            .map_err(|e| format!("执行命令失败: {}", e))?;

        let mut output = String::new();
        channel.read_to_string(&mut output).ok();
        channel.close().ok();

        let mut processes = Vec::new();
        for line in output.lines().skip(1) {
            let parts: Vec<&str> = line.split_whitespace().collect();
            if parts.len() >= 11 {
                processes.push(ProcessInfo {
                    pid: parts[1].parse().unwrap_or(0),
                    user: parts[0].to_string(),
                    cpu: parts[2].parse().unwrap_or(0.0),
                    mem: parts[3].parse().unwrap_or(0.0),
                    command: parts[10..].join(" "),
                });
            }
        }

        Ok(processes)
    }).await
}

/// 终止进程
#[tauri::command]
pub async fn ssh_monitor_kill_process(
    connection_id: String,
    pid: u32,
) -> Result<(), String> {
    crate::ssh::session::SSH_MANAGER.with_blocking(&connection_id, |session| {
        let mut channel = session.channel_session()
            .map_err(|e| format!("创建通道失败: {}", e))?;

        channel.exec(&format!("kill -9 {}", pid))
            .map_err(|e| format!("执行命令失败: {}", e))?;

        channel.close().ok();

        Ok(())
    }).await
}

/// Docker容器列表
#[derive(Debug, Clone, serde::Serialize)]
pub struct DockerContainer {
    pub name: String,
    pub image: String,
    pub status: String,
}

#[tauri::command]
pub async fn ssh_docker_list(
    connection_id: String,
) -> Result<Vec<DockerContainer>, String> {
    use std::io::Read;

    crate::ssh::session::SSH_MANAGER.with_blocking(&connection_id, |session| {
        let mut channel = session.channel_session()
            .map_err(|e| format!("创建通道失败: {}", e))?;

        channel.exec("docker ps --format '{{.Names}}|{{.Image}}|{{.Status}}' 2>/dev/null || echo ''")
            .map_err(|e| format!("执行命令失败: {}", e))?;

        let mut output = String::new();
        channel.read_to_string(&mut output).ok();
        channel.close().ok();

        let mut containers = Vec::new();
        for line in output.lines() {
            let parts: Vec<&str> = line.split('|').collect();
            if parts.len() >= 3 {
                containers.push(DockerContainer {
                    name: parts[0].to_string(),
                    image: parts[1].to_string(),
                    status: parts[2].to_string(),
                });
            }
        }

        Ok(containers)
    }).await
}

// ==================== IP/子网计算器 ====================
#[derive(Serialize)]
pub struct SubnetResult {
    pub success: bool,
    pub network: String,
    pub broadcast: String,
    pub subnet_mask: String,
    pub first_host: String,
    pub last_host: String,
    pub total_hosts: u64,
    pub usable_hosts: u64,
    pub error: Option<String>,
}

#[tauri::command]
pub fn ip_subnet_calculate(cidr: String) -> SubnetResult {
    let parts: Vec<&str> = cidr.trim().split('/').collect();
    if parts.len() != 2 {
        return SubnetResult {
            success: false, network: String::new(), broadcast: String::new(),
            subnet_mask: String::new(), first_host: String::new(), last_host: String::new(),
            total_hosts: 0, usable_hosts: 0, error: Some("格式错误，应为 IP/掩码位数，如 192.168.1.0/24".to_string()),
        };
    }

    let ip_parts: Vec<u8> = match parts[0].split('.').map(|s| s.parse::<u8>()).collect::<Result<Vec<_>, _>>() {
        Ok(v) => v,
        Err(_) => return SubnetResult {
            success: false, network: String::new(), broadcast: String::new(),
            subnet_mask: String::new(), first_host: String::new(), last_host: String::new(),
            total_hosts: 0, usable_hosts: 0, error: Some("无效的 IP 地址".to_string()),
        },
    };

    if ip_parts.len() != 4 {
        return SubnetResult {
            success: false, network: String::new(), broadcast: String::new(),
            subnet_mask: String::new(), first_host: String::new(), last_host: String::new(),
            total_hosts: 0, usable_hosts: 0, error: Some("IP 地址需要 4 个八位字节".to_string()),
        };
    }

    let prefix: u32 = match parts[1].parse() {
        Ok(p) if p <= 32 => p,
        _ => return SubnetResult {
            success: false, network: String::new(), broadcast: String::new(),
            subnet_mask: String::new(), first_host: String::new(), last_host: String::new(),
            total_hosts: 0, usable_hosts: 0, error: Some("掩码位数必须在 0-32 之间".to_string()),
        },
    };

    let ip = ((ip_parts[0] as u32) << 24) | ((ip_parts[1] as u32) << 16) | ((ip_parts[2] as u32) << 8) | (ip_parts[3] as u32);
    let mask = if prefix == 0 { 0u32 } else { !0u32 << (32 - prefix) };
    let network = ip & mask;
    let broadcast = network | !mask;
    let total_hosts = 2u64.pow(32 - prefix);
    let usable_hosts = if prefix >= 31 { 0 } else { total_hosts - 2 };

    let first_host = if prefix >= 31 { network } else { network + 1 };
    let last_host = if prefix >= 31 { broadcast } else { broadcast - 1 };

    let format_ip = |ip: u32| -> String {
        format!("{}.{}.{}.{}", (ip >> 24) & 0xFF, (ip >> 16) & 0xFF, (ip >> 8) & 0xFF, ip & 0xFF)
    };

    SubnetResult {
        success: true,
        network: format_ip(network),
        broadcast: format_ip(broadcast),
        subnet_mask: format_ip(mask),
        first_host: format_ip(first_host),
        last_host: format_ip(last_host),
        total_hosts,
        usable_hosts,
        error: None,
    }
}

// ==================== DNS 查询 ====================
#[derive(Serialize)]
pub struct DnsResult {
    pub success: bool,
    pub records: Vec<String>,
    pub error: Option<String>,
}

#[tauri::command]
pub async fn dns_lookup(domain: String, record_type: Option<String>) -> DnsResult {
    use trust_dns_resolver::TokioAsyncResolver;
    use trust_dns_resolver::config::*;

    let resolver = TokioAsyncResolver::tokio(ResolverConfig::default(), ResolverOpts::default());

    let rtype = record_type.unwrap_or_else(|| "A".to_string());
    let mut records = Vec::new();

    match rtype.as_str() {
        "A" => {
            match resolver.ipv4_lookup(domain.clone()).await {
                Ok(ips) => {
                    for ip in ips {
                        records.push(ip.to_string());
                    }
                }
                Err(e) => return DnsResult { success: false, records: Vec::new(), error: Some(format!("A 记录查询失败: {}", e)) },
            }
        }
        "AAAA" => {
            match resolver.ipv6_lookup(domain.clone()).await {
                Ok(ips) => {
                    for ip in ips {
                        records.push(ip.to_string());
                    }
                }
                Err(e) => return DnsResult { success: false, records: Vec::new(), error: Some(format!("AAAA 记录查询失败: {}", e)) },
            }
        }
        "MX" => {
            match resolver.mx_lookup(domain.clone()).await {
                Ok(mx_records) => {
                    for mx in mx_records {
                        records.push(format!("{} (优先级: {})", mx.exchange(), mx.preference()));
                    }
                }
                Err(e) => return DnsResult { success: false, records: Vec::new(), error: Some(format!("MX 记录查询失败: {}", e)) },
            }
        }
        "TXT" => {
            match resolver.txt_lookup(domain.clone()).await {
                Ok(txt_records) => {
                    for txt in txt_records {
                        for data in txt.txt_data() {
                            records.push(String::from_utf8_lossy(data).to_string());
                        }
                    }
                }
                Err(e) => return DnsResult { success: false, records: Vec::new(), error: Some(format!("TXT 记录查询失败: {}", e)) },
            }
        }
        "NS" => {
            match resolver.ns_lookup(domain.clone()).await {
                Ok(ns_records) => {
                    for ns in ns_records {
                        records.push(ns.to_string());
                    }
                }
                Err(e) => return DnsResult { success: false, records: Vec::new(), error: Some(format!("NS 记录查询失败: {}", e)) },
            }
        }
        _ => return DnsResult { success: false, records: Vec::new(), error: Some("不支持的记录类型，支持: A, AAAA, MX, TXT, NS".to_string()) },
    }

    DnsResult { success: true, records, error: None }
}

// ==================== 端口扫描 ====================
#[derive(Serialize)]
pub struct PortScanResult {
    pub success: bool,
    pub open_ports: Vec<u16>,
    pub closed_ports: Vec<u16>,
    pub error: Option<String>,
}

#[tauri::command]
pub async fn port_scan(host: String, ports: String, timeout: Option<u64>) -> PortScanResult {
    let timeout_ms = timeout.unwrap_or(1000);
    let port_list: Vec<u16> = if ports.contains('-') {
        let range: Vec<&str> = ports.split('-').collect();
        if range.len() != 2 {
            return PortScanResult { success: false, open_ports: Vec::new(), closed_ports: Vec::new(), error: Some("端口范围格式错误，应为 1-1024".to_string()) };
        }
        let start: u16 = match range[0].parse() { Ok(v) => v, Err(_) => return PortScanResult { success: false, open_ports: Vec::new(), closed_ports: Vec::new(), error: Some("起始端口无效".to_string()) } };
        let end: u16 = match range[1].parse() { Ok(v) => v, Err(_) => return PortScanResult { success: false, open_ports: Vec::new(), closed_ports: Vec::new(), error: Some("结束端口无效".to_string()) } };
        (start..=end).collect()
    } else {
        ports.split(',').map(|s| s.trim().parse::<u16>()).collect::<Result<Vec<_>, _>>().unwrap_or_default()
    };

    let mut open_ports = Vec::new();
    let mut closed_ports = Vec::new();

    for port in port_list {
        let addr = format!("{}:{}", host, port);
        match tokio::time::timeout(
            std::time::Duration::from_millis(timeout_ms),
            tokio::net::TcpStream::connect(&addr),
        ).await {
            Ok(Ok(_)) => open_ports.push(port),
            _ => closed_ports.push(port),
        }
    }

    PortScanResult { success: true, open_ports, closed_ports, error: None }
}

// ==================== SSL 证书查看 ====================
#[derive(Serialize)]
pub struct SslCertResult {
    pub success: bool,
    pub issuer: String,
    pub subject: String,
    pub not_before: String,
    pub not_after: String,
    pub serial_number: String,
    pub fingerprint: String,
    pub error: Option<String>,
}

#[tauri::command]
pub async fn ssl_cert_info(domain: String) -> SslCertResult {
    use std::net::TcpStream;

    let addr = format!("{}:443", domain);
    let stream = match TcpStream::connect(&addr) {
        Ok(s) => s,
        Err(e) => return SslCertResult {
            success: false, issuer: String::new(), subject: String::new(),
            not_before: String::new(), not_after: String::new(),
            serial_number: String::new(), fingerprint: String::new(),
            error: Some(format!("连接失败: {}", e)),
        },
    };

    // 使用 native-tls 获取证书信息
    let connector = match native_tls::TlsConnector::new() {
        Ok(c) => c,
        Err(e) => return SslCertResult {
            success: false, issuer: String::new(), subject: String::new(),
            not_before: String::new(), not_after: String::new(),
            serial_number: String::new(), fingerprint: String::new(),
            error: Some(format!("TLS 初始化失败: {}", e)),
        },
    };

    let stream = match connector.connect(&domain, stream) {
        Ok(s) => s,
        Err(e) => return SslCertResult {
            success: false, issuer: String::new(), subject: String::new(),
            not_before: String::new(), not_after: String::new(),
            serial_number: String::new(), fingerprint: String::new(),
            error: Some(format!("TLS 握手失败: {}", e)),
        },
    };

    let cert = match stream.peer_certificate() {
        Ok(Some(c)) => c,
        Ok(None) => return SslCertResult {
            success: false, issuer: String::new(), subject: String::new(),
            not_before: String::new(), not_after: String::new(),
            serial_number: String::new(), fingerprint: String::new(),
            error: Some("服务器未提供证书".to_string()),
        },
        Err(e) => return SslCertResult {
            success: false, issuer: String::new(), subject: String::new(),
            not_before: String::new(), not_after: String::new(),
            serial_number: String::new(), fingerprint: String::new(),
            error: Some(format!("获取证书失败: {}", e)),
        },
    };

    // 解析证书信息（DER 格式）
    let der = cert.to_der().unwrap_or_default();
    let fingerprint = sha2::Sha256::digest(&der);
    let fingerprint_hex = hex::encode(fingerprint);

    // native_tls 不直接暴露证书详细信息，返回基本数据
    SslCertResult {
        success: true,
        issuer: "需要 x509-parser 解析".to_string(),
        subject: domain.clone(),
        not_before: "需要 x509-parser 解析".to_string(),
        not_after: "需要 x509-parser 解析".to_string(),
        serial_number: "需要 x509-parser 解析".to_string(),
        fingerprint: fingerprint_hex,
        error: None,
    }
}

// ==================== WebSocket 客户端 ====================
use std::collections::HashMap;

lazy_static::lazy_static! {
    static ref WS_CONNECTIONS: Mutex<HashMap<String, tokio::sync::mpsc::UnboundedSender<String>>> = Mutex::new(HashMap::new());
}

#[derive(Serialize)]
pub struct WsConnectResult {
    pub success: bool,
    pub connection_id: String,
    pub error: Option<String>,
}

#[tauri::command]
pub async fn ws_connect(url: String, app: tauri::AppHandle) -> WsConnectResult {
    use tokio_tungstenite::connect_async;
    use futures_util::{StreamExt, SinkExt};

    let (ws_stream, _) = match connect_async(&url).await {
        Ok(r) => r,
        Err(e) => return WsConnectResult { success: false, connection_id: String::new(), error: Some(format!("连接失败: {}", e)) },
    };

    let connection_id = uuid::Uuid::new_v4().to_string();
    let (mut write, mut read) = ws_stream.split();
    let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<String>();

    // 保存发送通道
    {
        let mut conns = WS_CONNECTIONS.lock().unwrap();
        conns.insert(connection_id.clone(), tx);
    }

    // 接收消息的任务
    let conn_id_recv = connection_id.clone();
    let app_recv = app.clone();
    tokio::spawn(async move {
        while let Some(msg) = read.next().await {
            match msg {
                Ok(tokio_tungstenite::tungstenite::Message::Text(text)) => {
                    let _ = app_recv.emit(&format!("ws-message-{}", conn_id_recv), &text);
                }
                Ok(tokio_tungstenite::tungstenite::Message::Close(_)) => {
                    let _ = app_recv.emit(&format!("ws-close-{}", conn_id_recv), &());
                    break;
                }
                Err(_) => break,
                _ => {}
            }
        }
        // 清理连接
        let mut conns = WS_CONNECTIONS.lock().unwrap();
        conns.remove(&conn_id_recv);
    });

    // 发送消息的任务
    tokio::spawn(async move {
        while let Some(msg) = rx.recv().await {
            if write.send(tokio_tungstenite::tungstenite::Message::Text(msg)).await.is_err() {
                break;
            }
        }
        let _ = write.close().await;
    });

    WsConnectResult { success: true, connection_id, error: None }
}

#[tauri::command]
pub async fn ws_send(connection_id: String, message: String) -> Result<(), String> {
    let conns = WS_CONNECTIONS.lock().unwrap();
    if let Some(tx) = conns.get(&connection_id) {
        tx.send(message).map_err(|e| e.to_string())?;
        Ok(())
    } else {
        Err("连接不存在".to_string())
    }
}

#[tauri::command]
pub async fn ws_close(connection_id: String) -> Result<(), String> {
    let mut conns = WS_CONNECTIONS.lock().unwrap();
    conns.remove(&connection_id);
    Ok(())
}

// ==================== 正则可视化 ====================
#[derive(Serialize)]
pub struct RegexVisualizeResult {
    pub success: bool,
    pub nodes: Vec<RegexNode>,
    pub error: Option<String>,
}

#[derive(Serialize)]
pub struct RegexNode {
    pub node_type: String,
    pub content: String,
    pub description: String,
    pub start: usize,
    pub end: usize,
}

#[tauri::command]
pub fn regex_visualize(pattern: String) -> RegexVisualizeResult {
    let mut nodes = Vec::new();
    let chars: Vec<char> = pattern.chars().collect();
    let len = chars.len();
    let mut i = 0;

    while i < len {
        let start = i;
        match chars[i] {
            '^' => {
                nodes.push(RegexNode {
                    node_type: "anchor".to_string(),
                    content: "^".to_string(),
                    description: "行首锚点".to_string(),
                    start,
                    end: start + 1,
                });
                i += 1;
            }
            '$' => {
                nodes.push(RegexNode {
                    node_type: "anchor".to_string(),
                    content: "$".to_string(),
                    description: "行尾锚点".to_string(),
                    start,
                    end: start + 1,
                });
                i += 1;
            }
            '.' => {
                nodes.push(RegexNode {
                    node_type: "meta".to_string(),
                    content: ".".to_string(),
                    description: "匹配任意字符".to_string(),
                    start,
                    end: start + 1,
                });
                i += 1;
            }
            '*' => {
                nodes.push(RegexNode {
                    node_type: "quantifier".to_string(),
                    content: "*".to_string(),
                    description: "匹配 0 次或多次".to_string(),
                    start,
                    end: start + 1,
                });
                i += 1;
            }
            '+' => {
                nodes.push(RegexNode {
                    node_type: "quantifier".to_string(),
                    content: "+".to_string(),
                    description: "匹配 1 次或多次".to_string(),
                    start,
                    end: start + 1,
                });
                i += 1;
            }
            '?' => {
                nodes.push(RegexNode {
                    node_type: "quantifier".to_string(),
                    content: "?".to_string(),
                    description: "匹配 0 次或 1 次".to_string(),
                    start,
                    end: start + 1,
                });
                i += 1;
            }
            '{' => {
                let mut end = i + 1;
                while end < len && chars[end] != '}' {
                    end += 1;
                }
                if end < len {
                    end += 1;
                    let content: String = chars[i..end].iter().collect();
                    nodes.push(RegexNode {
                        node_type: "quantifier".to_string(),
                        content: content.clone(),
                        description: format!("匹配 {} 次", content),
                        start,
                        end,
                    });
                    i = end;
                } else {
                    i += 1;
                }
            }
            '(' => {
                let mut content = "(".to_string();
                let mut desc = "捕获组开始".to_string();
                if i + 1 < len && chars[i + 1] == '?' {
                    if i + 2 < len {
                        match chars[i + 2] {
                            ':' => { content = "(?:".to_string(); desc = "非捕获组".to_string(); i += 3; }
                            '=' => { content = "(?=".to_string(); desc = "正向前瞻".to_string(); i += 3; }
                            '!' => { content = "(?!".to_string(); desc = "负向前瞻".to_string(); i += 3; }
                            '<' => {
                                if i + 3 < len && chars[i + 3] == '=' {
                                    content = "(?<=".to_string(); desc = "正向后顾".to_string(); i += 4;
                                } else if i + 3 < len && chars[i + 3] == '!' {
                                    content = "(?<!".to_string(); desc = "负向后顾".to_string(); i += 4;
                                } else {
                                    content = "(?<".to_string(); desc = "命名捕获组".to_string(); i += 3;
                                }
                            }
                            _ => { i += 1; }
                        }
                    } else {
                        i += 1;
                    }
                } else {
                    i += 1;
                }
                nodes.push(RegexNode {
                    node_type: "group".to_string(),
                    content,
                    description: desc,
                    start,
                    end: i,
                });
            }
            ')' => {
                nodes.push(RegexNode {
                    node_type: "group".to_string(),
                    content: ")".to_string(),
                    description: "组结束".to_string(),
                    start,
                    end: start + 1,
                });
                i += 1;
            }
            '[' => {
                let mut end = i + 1;
                if end < len && chars[end] == '^' {
                    end += 1;
                }
                if end < len && chars[end] == ']' {
                    end += 1;
                }
                while end < len && chars[end] != ']' {
                    end += 1;
                }
                if end < len {
                    end += 1;
                    let content: String = chars[i..end].iter().collect();
                    let desc = if content.starts_with("[^") {
                        "字符类（取反）".to_string()
                    } else {
                        "字符类".to_string()
                    };
                    nodes.push(RegexNode {
                        node_type: "charset".to_string(),
                        content,
                        description: desc,
                        start,
                        end,
                    });
                    i = end;
                } else {
                    i += 1;
                }
            }
            '\\' => {
                if i + 1 < len {
                    let next = chars[i + 1];
                    let content: String = vec!['\\', next].iter().collect();
                    let desc = match next {
                        'd' => "数字 [0-9]".to_string(),
                        'D' => "非数字".to_string(),
                        'w' => "单词字符 [a-zA-Z0-9_]".to_string(),
                        'W' => "非单词字符".to_string(),
                        's' => "空白字符".to_string(),
                        'S' => "非空白字符".to_string(),
                        'b' => "单词边界".to_string(),
                        'B' => "非单词边界".to_string(),
                        'n' => "换行符".to_string(),
                        'r' => "回车符".to_string(),
                        't' => "制表符".to_string(),
                        _ => format!("转义字符 {}", next),
                    };
                    nodes.push(RegexNode {
                        node_type: "escape".to_string(),
                        content,
                        description: desc,
                        start,
                        end: i + 2,
                    });
                    i += 2;
                } else {
                    i += 1;
                }
            }
            '|' => {
                nodes.push(RegexNode {
                    node_type: "alternation".to_string(),
                    content: "|".to_string(),
                    description: "或（任选其一）".to_string(),
                    start,
                    end: start + 1,
                });
                i += 1;
            }
            _ => {
                // 普通字符
                let mut end = i + 1;
                let mut content = chars[i].to_string();
                // 收集连续的普通字符
                while end < len && !matches!(chars[end], '^' | '$' | '.' | '*' | '+' | '?' | '{' | '}' | '(' | ')' | '[' | ']' | '\\' | '|') {
                    content.push(chars[end]);
                    end += 1;
                }
                nodes.push(RegexNode {
                    node_type: "literal".to_string(),
                    content: content.clone(),
                    description: format!("字面量 '{}'", content),
                    start,
                    end,
                });
                i = end;
            }
        }
    }

    RegexVisualizeResult {
        success: true,
        nodes,
        error: None,
    }
}
