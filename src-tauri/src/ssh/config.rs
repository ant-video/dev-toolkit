// src-tauri/src/ssh/config.rs

use crate::ssh::types::*;
use crate::ssh::crypto;
use std::path::PathBuf;
use std::fs;

/// 获取配置文件路径
pub fn get_config_path() -> PathBuf {
    let config_dir = dirs::config_dir().unwrap_or_else(|| PathBuf::from("."));
    config_dir.join("dev-toolkit").join("ssh-sessions.json")
}

/// 获取配置目录
pub fn get_config_dir() -> PathBuf {
    let config_dir = dirs::config_dir().unwrap_or_else(|| PathBuf::from("."));
    config_dir.join("dev-toolkit")
}

/// 加载所有会话配置
pub fn load_sessions() -> Result<Vec<SshSession>, String> {
    let path = get_config_path();

    if !path.exists() {
        return Ok(Vec::new());
    }

    let content = fs::read_to_string(&path)
        .map_err(|e| format!("读取配置文件失败: {}", e))?;

    let mut sessions: Vec<SshSession> = serde_json::from_str(&content)
        .map_err(|e| format!("解析配置文件失败: {}", e))?;

    // 解密密码
    for session in &mut sessions {
        if let AuthType::Password { password } = &session.auth_type {
            if !password.is_empty() {
                match crypto::decrypt_password(password) {
                    Ok(decrypted) => {
                        session.auth_type = AuthType::Password { password: decrypted };
                    }
                    Err(_) => {
                        // 解密失败，保持原样（可能是未加密的旧数据）
                    }
                }
            }
        }
    }

    Ok(sessions)
}

/// 保存所有会话配置
pub fn save_sessions(sessions: &[SshSession]) -> Result<(), String> {
    let config_dir = get_config_dir();
    fs::create_dir_all(&config_dir)
        .map_err(|e| format!("创建配置目录失败: {}", e))?;

    // 加密密码后再保存
    let encrypted_sessions: Vec<SshSession> = sessions
        .iter()
        .map(|s| {
            let mut s = s.clone();
            if let AuthType::Password { password } = &s.auth_type {
                if !password.is_empty() {
                    match crypto::encrypt_password(password) {
                        Ok(encrypted) => {
                            s.auth_type = AuthType::Password { password: encrypted };
                        }
                        Err(e) => {
                            eprintln!("加密密码失败: {}", e);
                        }
                    }
                }
            }
            s
        })
        .collect();

    let json = serde_json::to_string_pretty(&encrypted_sessions)
        .map_err(|e| format!("序列化配置失败: {}", e))?;

    let path = get_config_path();
    fs::write(&path, json)
        .map_err(|e| format!("写入配置文件失败: {}", e))?;

    Ok(())
}

/// 添加新会话
pub fn add_session(mut session: SshSession) -> Result<SshSession, String> {
    let mut sessions = load_sessions()?;

    // 生成ID和时间戳
    if session.id.is_empty() {
        session.id = uuid::Uuid::new_v4().to_string();
    }
    let now = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
    session.created_at = now.clone();
    session.updated_at = now;

    sessions.push(session.clone());
    save_sessions(&sessions)?;

    Ok(session)
}

/// 更新会话
pub fn update_session(session: &SshSession) -> Result<(), String> {
    let mut sessions = load_sessions()?;

    let index = sessions
        .iter()
        .position(|s| s.id == session.id)
        .ok_or_else(|| format!("找不到会话: {}", session.id))?;

    let mut updated = session.clone();
    updated.updated_at = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
    sessions[index] = updated;

    save_sessions(&sessions)
}

/// 删除会话
pub fn delete_session(id: &str) -> Result<(), String> {
    let mut sessions = load_sessions()?;
    sessions.retain(|s| s.id != id);
    save_sessions(&sessions)
}

/// 获取所有分组
pub fn get_groups() -> Result<Vec<String>, String> {
    let sessions = load_sessions()?;
    let mut groups: Vec<String> = sessions
        .iter()
        .map(|s| s.group.clone())
        .filter(|g| !g.is_empty())
        .collect();
    groups.sort();
    groups.dedup();
    Ok(groups)
}
