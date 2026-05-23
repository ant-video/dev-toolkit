// src-tauri/src/ssh/session.rs

use crate::ssh::types::*;
use ssh2::{Session, KeyboardInteractivePrompt, Prompt, Channel};
use std::collections::HashMap;
use std::net::{TcpStream, ToSocketAddrs};
use std::sync::Arc;
use tokio::sync::{RwLock, mpsc};
use tauri::{AppHandle, Emitter};
use std::io::{Read, Write};
use std::time::Duration;

/// PTY操作请求
pub enum PtyRequest {
    Write { data: Vec<u8> },
    Resize { cols: u16, rows: u16 },
    SetSftpActive(bool),
}

/// PTY会话信息 - 包含操作通道
pub struct PtySession {
    pub request_tx: mpsc::UnboundedSender<PtyRequest>,
}

/// 全局PTY会话管理器 - 使用消息传递避免锁竞争
lazy_static::lazy_static! {
    pub static ref PTY_SESSIONS: Arc<RwLock<HashMap<String, PtySession>>> =
        Arc::new(RwLock::new(HashMap::new()));
}

/// 键盘交互认证提示处理器
struct PasswordPrompt {
    password: String,
}

impl KeyboardInteractivePrompt for PasswordPrompt {
    fn prompt<'a>(
        &mut self,
        _username: &str,
        _instructions: &str,
        prompts: &[Prompt<'a>],
    ) -> Vec<String> {
        // 对所有提示返回密码
        prompts.iter().map(|_| self.password.clone()).collect()
    }
}

/// 最大并发连接数
const MAX_CONNECTIONS: usize = 10;

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
        // 检查连接数限制
        {
            let connections = self.connections.read().await;
            if connections.len() >= MAX_CONNECTIONS {
                return Err(format!("已达到最大连接数限制 ({})", MAX_CONNECTIONS));
            }
        }

        let connection_id = uuid::Uuid::new_v4().to_string();

        // 发送连接中状态
        let _ = app.emit(&format!("ssh-status-{}", session_config.id), ConnectionInfo {
            connection_id: connection_id.clone(),
            session_id: session_config.id.clone(),
            status: ConnectionStatus::Connecting,
            connected_at: None,
            error: None,
        });

        // 建立TCP连接（带超时）
        let addr = format!("{}:{}", session_config.host, session_config.port);
        let socket_addr = addr.to_socket_addrs()
            .map_err(|e| format!("地址解析失败 {}: {}", addr, e))?
            .next()
            .ok_or_else(|| format!("无法解析地址: {}", addr))?;
        let tcp = TcpStream::connect_timeout(
            &socket_addr,
            Duration::from_secs(10),  // 10秒连接超时
        ).map_err(|e| format!("连接失败 {}: {}", addr, e))?;

        // 设置读写超时
        tcp.set_read_timeout(Some(Duration::from_secs(30)))
            .map_err(|e| format!("设置读超时失败: {}", e))?;
        tcp.set_write_timeout(Some(Duration::from_secs(30)))
            .map_err(|e| format!("设置写超时失败: {}", e))?;

        // 创建SSH会话
        let mut sess = Session::new()
            .map_err(|e| format!("创建SSH会话失败: {}", e))?;
        sess.set_tcp_stream(tcp);
        sess.handshake()
            .map_err(|e| format!("SSH握手失败: {}", e))?;

        // 获取服务器支持的认证方法
        let auth_methods = sess.auth_methods(&session_config.username)
            .map_err(|e| format!("获取认证方法失败: {}", e))?;

        // 认证
        match &session_config.auth_type {
            AuthType::Password { password } => {
                // 检查是否支持密码认证
                if auth_methods.contains("password") {
                    sess.userauth_password(&session_config.username, password)
                        .map_err(|e| format!("密码认证失败: {}", e))?;
                } else if auth_methods.contains("keyboard-interactive") {
                    // 如果不支持密码但支持键盘交互，尝试使用键盘交互
                    let mut prompter = PasswordPrompt { password: password.clone() };
                    sess.userauth_keyboard_interactive(&session_config.username, &mut prompter)
                        .map_err(|e| format!("键盘交互认证失败: {}", e))?;
                } else {
                    return Err(format!("服务器不支持密码认证，支持的认证方法: {}", auth_methods));
                }
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
            // 再次检查，防止并发请求在读锁释放和写锁获取之间绕过限制
            if connections.len() >= MAX_CONNECTIONS {
                return Err(format!("已达到最大连接数限制 ({})", MAX_CONNECTIONS));
            }
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
        // 清理 PTY 会话，防止内存泄漏
        {
            let mut sessions = PTY_SESSIONS.write().await;
            sessions.remove(connection_id);
        }

        // 断开 SSH 连接
        let mut connections = self.connections.write().await;
        connections.remove(connection_id);
        Ok(())
    }

    /// 获取连接
    pub async fn get_connection(&self, connection_id: &str) -> Option<ActiveConnection> {
        let connections = self.connections.read().await;
        connections.get(connection_id).cloned()
    }

    /// 创建SFTP（自动处理阻塞模式切换）
    /// 保持写锁直到操作完成
    pub async fn with_sftp<F, T>(&self, connection_id: &str, f: F) -> Result<T, String>
    where
        F: FnOnce(&ssh2::Sftp) -> Result<T, String>,
    {
        // 通知 PTY 循环暂停读取，避免阻塞模式冲突
        {
            let sessions = PTY_SESSIONS.read().await;
            if let Some(pty) = sessions.get(connection_id) {
                let _ = pty.request_tx.send(PtyRequest::SetSftpActive(true));
            }
        }

        // 等待 PTY 循环处理消息
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;

        let mut connections = self.connections.write().await;
        let conn = connections.get_mut(connection_id).ok_or("连接不存在")?;

        // 切换到阻塞模式
        conn.session.set_blocking(true);
        let sftp = conn.session.sftp().map_err(|e| format!("创建SFTP失败: {}", e))?;

        // 执行操作
        let result = f(&sftp);

        // 释放 SFTP 资源
        drop(sftp);

        // 恢复非阻塞模式
        conn.session.set_blocking(false);

        // 通知 PTY 循环恢复读取
        {
            let sessions = PTY_SESSIONS.read().await;
            if let Some(pty) = sessions.get(connection_id) {
                let _ = pty.request_tx.send(PtyRequest::SetSftpActive(false));
            }
        }

        result
    }

    /// 执行SFTP文件传输（上传/下载），保持阻塞模式直到完成
    pub async fn with_sftp_transfer<F, T>(&self, connection_id: &str, f: F) -> Result<T, String>
    where
        F: FnOnce(&ssh2::Sftp) -> Result<T, String>,
    {
        // 与 with_sftp 相同，但明确表示这是用于传输操作
        self.with_sftp(connection_id, f).await
    }

    /// 创建PTY终端（需要可变访问session来设置非阻塞模式）
    pub async fn create_pty_for_connection(
        &self,
        connection_id: &str,
        cols: u16,
        rows: u16,
    ) -> Result<Channel, String> {
        let mut connections = self.connections.write().await;
        let conn = connections.get_mut(connection_id).ok_or("连接不存在")?;
        conn.create_pty(cols, rows)
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
    pub fn create_pty(&mut self, cols: u16, rows: u16) -> Result<ssh2::Channel, String> {
        // 确保session为阻塞模式，以便完成通道创建和设置
        self.session.set_blocking(true);

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

        // 设置session为非阻塞模式，后续读写操作将非阻塞
        self.session.set_blocking(false);

        Ok(channel)
    }

    /// 创建SFTP会话
    pub fn create_sftp(&mut self) -> Result<ssh2::Sftp, String> {
        // SFTP需要阻塞模式
        self.session.set_blocking(true);
        self.session.sftp().map_err(|e| format!("创建SFTP失败: {}", e))
    }

    /// 恢复非阻塞模式（PTY使用）
    pub fn restore_nonblocking(&mut self) {
        self.session.set_blocking(false);
    }
}

/// 启动PTY读写循环
/// 返回请求通道，读取循环在独立线程中运行
pub fn spawn_pty_loop(
    mut channel: Channel,
    connection_id: String,
    app: AppHandle,
) -> mpsc::UnboundedSender<PtyRequest> {
    let (request_tx, mut request_rx) = mpsc::unbounded_channel::<PtyRequest>();

    std::thread::spawn(move || {
        eprintln!("[PTY] Read/write thread started for {}", connection_id);
        let mut buf = [0u8; 8192];
        let mut sftp_active = false;

        loop {
            // 先处理请求（优先处理 SFTP 状态变更）
            while let Ok(req) = request_rx.try_recv() {
                match req {
                    PtyRequest::Write { data } => {
                        eprintln!("[PTY] Writing {} bytes to server", data.len());
                        // 非阻塞模式下 write_all 会因 WouldBlock 失败，需要手动重试
                        let mut offset = 0;
                        while offset < data.len() {
                            match channel.write(&data[offset..]) {
                                Ok(n) => offset += n,
                                Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                                    std::thread::sleep(std::time::Duration::from_millis(1));
                                }
                                Err(e) => {
                                    eprintln!("[PTY] Write error: {}", e);
                                    break;
                                }
                            }
                        }
                    }
                    PtyRequest::Resize { cols, rows } => {
                        eprintln!("[PTY] Resizing to {}x{}", cols, rows);
                        if let Err(e) = channel.request_pty_size(cols as u32, rows as u32, Some(0), Some(0)) {
                            eprintln!("[PTY] Resize error: {}", e);
                        }
                    }
                    PtyRequest::SetSftpActive(active) => {
                        sftp_active = active;
                        eprintln!("[PTY] SFTP active: {}", active);
                    }
                }
            }

            // SFTP 活跃时跳过读取，避免与 SFTP 的阻塞模式冲突
            let mut read_something = false;
            if !sftp_active {
                loop {
                    match channel.read(&mut buf) {
                        Ok(0) => {
                            // EOF
                            eprintln!("[PTY] EOF received for {}", connection_id);
                            let _ = app.emit(&format!("ssh-disconnect-{}", connection_id), &());
                            return;
                        }
                        Ok(n) => {
                            read_something = true;
                            let data: Vec<u8> = buf[..n].to_vec();
                            let _ = app.emit(&format!("ssh-output-{}", connection_id), &data);
                        }
                        Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                            // 无数据可读，退出读取循环
                            break;
                        }
                        Err(e) => {
                            eprintln!("[PTY] Read error: {}", e);
                            let _ = app.emit(&format!("ssh-disconnect-{}", connection_id), &());
                            return;
                        }
                    }
                }
            }

            // 如果什么都没发生，短暂休眠
            if !read_something {
                std::thread::sleep(std::time::Duration::from_millis(10));
            }
        }
    });

    request_tx
}

// 全局连接管理器
lazy_static::lazy_static! {
    pub static ref SSH_MANAGER: Arc<SshConnectionManager> = Arc::new(SshConnectionManager::new());
}
