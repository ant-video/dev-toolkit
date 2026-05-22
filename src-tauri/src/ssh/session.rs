// src-tauri/src/ssh/session.rs

use crate::ssh::types::*;
use ssh2::Session;
use std::collections::HashMap;
use std::net::TcpStream;
use std::sync::Arc;
use tokio::sync::RwLock;
use tauri::{AppHandle, Emitter};

/// SSH连接管理器
pub struct SshConnectionManager {
    connections: Arc<RwLock<HashMap<String, ActiveConnection>>>,
}

impl SshConnectionManager {
    pub fn new() -> Self {
        Self {
            connections: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    /// 建立SSH连接
    pub async fn connect(
        &self,
        session_config: &SshSession,
        app: AppHandle,
    ) -> Result<String, String> {
        let connection_id = uuid::Uuid::new_v4().to_string();

        // 发送连接中状态
        let _ = app.emit(&format!("ssh-status-{}", session_config.id), ConnectionInfo {
            connection_id: connection_id.clone(),
            session_id: session_config.id.clone(),
            status: ConnectionStatus::Connecting,
            connected_at: None,
            error: None,
        });

        // 建立TCP连接
        let addr = format!("{}:{}", session_config.host, session_config.port);
        let tcp = TcpStream::connect(&addr)
            .map_err(|e| format!("连接失败 {}: {}", addr, e))?;

        // 创建SSH会话
        let mut sess = Session::new()
            .map_err(|e| format!("创建SSH会话失败: {}", e))?;
        sess.set_tcp_stream(tcp);
        sess.handshake()
            .map_err(|e| format!("SSH握手失败: {}", e))?;

        // 认证
        match &session_config.auth_type {
            AuthType::Password { password } => {
                sess.userauth_password(&session_config.username, password)
                    .map_err(|e| format!("密码认证失败: {}", e))?;
            }
            AuthType::PrivateKey { key_path, passphrase } => {
                let key = std::fs::read(key_path)
                    .map_err(|e| format!("读取密钥失败: {}", e))?;
                let key_str = String::from_utf8(key)
                    .map_err(|e| format!("密钥格式错误: {}", e))?;
                sess.userauth_pubkey_memory(
                    &session_config.username,
                    None,
                    &key_str,
                    passphrase.as_deref(),
                )
                .map_err(|e| format!("密钥认证失败: {}", e))?;
            }
            AuthType::KeyboardInteractive => {
                return Err("键盘交互认证暂不支持".to_string());
            }
        }

        if !sess.authenticated() {
            return Err("认证失败".to_string());
        }

        // 保存连接
        let conn = ActiveConnection {
            session: sess,
            config: session_config.clone(),
            connected_at: chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string(),
        };

        {
            let mut connections = self.connections.write().await;
            connections.insert(connection_id.clone(), conn);
        }

        // 发送连接成功状态
        let _ = app.emit(&format!("ssh-status-{}", session_config.id), ConnectionInfo {
            connection_id: connection_id.clone(),
            session_id: session_config.id.clone(),
            status: ConnectionStatus::Connected,
            connected_at: Some(chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string()),
            error: None,
        });

        Ok(connection_id)
    }

    /// 断开连接
    pub async fn disconnect(&self, connection_id: &str) -> Result<(), String> {
        let mut connections = self.connections.write().await;
        connections.remove(connection_id);
        Ok(())
    }

    /// 获取连接
    pub async fn get_connection(&self, connection_id: &str) -> Option<ActiveConnection> {
        let connections = self.connections.read().await;
        connections.get(connection_id).cloned()
    }
}

/// 活动连接
#[derive(Clone)]
pub struct ActiveConnection {
    pub session: Session,
    pub config: SshSession,
    pub connected_at: String,
}

impl ActiveConnection {
    /// 创建PTY终端通道
    pub fn create_pty(&self, cols: u16, rows: u16) -> Result<ssh2::Channel, String> {
        let mut channel = self.session
            .channel_session()
            .map_err(|e| format!("创建通道失败: {}", e))?;

        // 请求PTY
        channel.request_pty(
            "xterm-256color",
            None,
            Some((cols as u32, rows as u32, 0, 0)),
        ).map_err(|e| format!("请求PTY失败: {}", e))?;

        // 启动shell
        channel.shell().map_err(|e| format!("启动shell失败: {}", e))?;

        Ok(channel)
    }

    /// 创建SFTP会话
    pub fn create_sftp(&self) -> Result<ssh2::Sftp, String> {
        self.session.sftp().map_err(|e| format!("创建SFTP失败: {}", e))
    }
}

// 全局连接管理器
lazy_static::lazy_static! {
    pub static ref SSH_MANAGER: Arc<SshConnectionManager> = Arc::new(SshConnectionManager::new());
}
