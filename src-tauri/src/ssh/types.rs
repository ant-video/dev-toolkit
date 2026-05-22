// src-tauri/src/ssh/types.rs

use serde::{Deserialize, Serialize};

/// SSH会话配置
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SshSession {
    pub id: String,
    pub name: String,
    pub group: String,
    pub host: String,
    pub port: u16,
    pub username: String,
    pub auth_type: AuthType,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    pub tags: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub proxy: Option<ProxyConfig>,
    pub terminal: TerminalConfig,
    pub created_at: String,
    pub updated_at: String,
}

impl Default for SshSession {
    fn default() -> Self {
        let now = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
        Self {
            id: uuid::Uuid::new_v4().to_string(),
            name: String::new(),
            group: "默认".to_string(),
            host: String::new(),
            port: 22,
            username: String::new(),
            auth_type: AuthType::Password { password: String::new() },
            description: None,
            tags: Vec::new(),
            proxy: None,
            terminal: TerminalConfig::default(),
            created_at: now.clone(),
            updated_at: now,
        }
    }
}

/// 认证方式
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum AuthType {
    Password { password: String },
    PrivateKey { key_path: String, #[serde(skip_serializing_if = "Option::is_none")] passphrase: Option<String> },
    KeyboardInteractive,
}

/// 代理配置
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProxyConfig {
    #[serde(rename = "type")]
    pub proxy_type: ProxyType,
    pub host: String,
    pub port: u16,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub username: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub password: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ProxyType {
    Http,
    Socks5,
}

/// 终端配置
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TerminalConfig {
    pub shell: String,
    pub cols: u16,
    pub rows: u16,
    pub font_size: u16,
    pub font_family: String,
    pub theme: String,
    pub encoding: String,
}

impl Default for TerminalConfig {
    fn default() -> Self {
        Self {
            shell: "/bin/bash".to_string(),
            cols: 120,
            rows: 40,
            font_size: 14,
            font_family: "Monaco, Menlo, \"Courier New\", monospace".to_string(),
            theme: "dracula".to_string(),
            encoding: "utf-8".to_string(),
        }
    }
}

/// 会话分组
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionGroup {
    pub name: String,
    pub expanded: bool,
    pub sessions: Vec<SshSession>,
}

/// 连接状态
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum ConnectionStatus {
    Disconnected,
    Connecting,
    Connected,
    Reconnecting,
    Error(String),
}

/// 连接信息
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConnectionInfo {
    pub connection_id: String,
    pub session_id: String,
    pub status: ConnectionStatus,
    pub connected_at: Option<String>,
    pub error: Option<String>,
}
