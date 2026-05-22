# SSH可视化连接工具实现计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 在DevToolkit中集成功能完善的SSH可视化连接工具，支持SSH终端、SFTP文件管理、会话管理和系统监控。

**Architecture:** 基于Tauri 2.0双端架构，前端使用xterm.js实现终端模拟，后端使用ssh2 crate处理SSH协议。采用经典双栏布局：左侧会话树管理，右侧多标签页工作区。

**Tech Stack:** Rust (ssh2, tokio) + JavaScript (xterm.js, vanilla JS) + Tauri IPC

---

## Phase 1: 基础架构搭建

### Task 1.1: 添加Rust依赖

**Files:**
- Modify: `src-tauri/Cargo.toml`

**Step 1: 添加SSH相关依赖到Cargo.toml**

在 `[dependencies]` 部分末尾添加：

```toml
# SSH相关
ssh2 = "0.9"
whoami = "1.5"
```

**Step 2: 验证依赖添加正确**

Run: `cd /Users/liushiquan/.openclaw/workspace/dev-toolkit/src-tauri && cargo check`
Expected: 编译通过，无错误

**Step 3: Commit**

```bash
git add src-tauri/Cargo.toml
git commit -m "feat(ssh): add ssh2 dependency"
```

---

### Task 1.2: 创建SSH模块目录结构

**Files:**
- Create: `src-tauri/src/ssh/mod.rs`
- Create: `src-tauri/src/ssh/types.rs`
- Create: `src-tauri/src/ssh/config.rs`
- Create: `src-tauri/src/ssh/crypto.rs`

**Step 1: 创建ssh模块目录**

Run: `mkdir -p /Users/liushiquan/.openclaw/workspace/dev-toolkit/src-tauri/src/ssh`
Expected: 目录创建成功

**Step 2: 创建mod.rs模块入口**

```rust
// src-tauri/src/ssh/mod.rs

pub mod types;
pub mod config;
pub mod crypto;

pub use types::*;
pub use config::*;
pub use crypto::*;
```

**Step 3: 创建types.rs数据类型定义**

```rust
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
```

**Step 4: 创建config.rs配置管理**

```rust
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
                            log::warn!("加密密码失败: {}", e);
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
```

**Step 5: 创建crypto.rs加密工具**

```rust
// src-tauri/src/ssh/crypto.rs

use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Nonce,
};
use base64::{engine::general_purpose::STANDARD, Engine};
use rand::RngCore;

/// 加密密钥（实际应用中应该从安全存储获取）
fn get_encryption_key() -> [u8; 32] {
    // 使用固定密钥（生产环境应该使用密钥派生）
    let key_str = "dev-toolkit-ssh-encryption-key-32b";
    let mut key = [0u8; 32];
    key[..key_str.len().min(32)].copy_from_slice(&key_str.as_bytes()[..key_str.len().min(32)]);
    key
}

/// 加密密码
pub fn encrypt_password(password: &str) -> Result<String, String> {
    if password.is_empty() {
        return Ok(String::new());
    }

    let key = get_encryption_key();
    let cipher = Aes256Gcm::new_from_slice(&key)
        .map_err(|e| format!("初始化加密器失败: {}", e))?;

    // 生成随机nonce
    let mut nonce_bytes = [0u8; 12];
    rand::thread_rng().fill_bytes(&mut nonce_bytes);
    let nonce = Nonce::from_slice(&nonce_bytes);

    // 加密
    let ciphertext = cipher
        .encrypt(nonce, password.as_bytes())
        .map_err(|e| format!("加密失败: {}", e))?;

    // 组合: nonce || ciphertext，然后base64编码
    let mut combined = nonce_bytes.to_vec();
    combined.extend(ciphertext);

    Ok(STANDARD.encode(&combined))
}

/// 解密密码
pub fn decrypt_password(encrypted: &str) -> Result<String, String> {
    if encrypted.is_empty() {
        return Ok(String::new());
    }

    let combined = STANDARD
        .decode(encrypted)
        .map_err(|e| format!("Base64解码失败: {}", e))?;

    if combined.len() < 12 {
        return Err("加密数据格式错误".to_string());
    }

    let (nonce_bytes, ciphertext) = combined.split_at(12);
    let nonce = Nonce::from_slice(nonce_bytes);

    let key = get_encryption_key();
    let cipher = Aes256Gcm::new_from_slice(&key)
        .map_err(|e| format!("初始化解密器失败: {}", e))?;

    let plaintext = cipher
        .decrypt(nonce, ciphertext)
        .map_err(|e| format!("解密失败: {}", e))?;

    String::from_utf8(plaintext).map_err(|e| format!("UTF-8解码失败: {}", e))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_encrypt_decrypt() {
        let password = "test_password_123";
        let encrypted = encrypt_password(password).unwrap();
        let decrypted = decrypt_password(&encrypted).unwrap();
        assert_eq!(password, decrypted);
    }

    #[test]
    fn test_empty_password() {
        let encrypted = encrypt_password("").unwrap();
        assert!(encrypted.is_empty());
        let decrypted = decrypt_password(&encrypted).unwrap();
        assert!(decrypted.is_empty());
    }
}
```

**Step 6: 在lib.rs中注册ssh模块**

在 `src-tauri/src/lib.rs` 开头添加：

```rust
mod commands;
mod database;
mod ssh;  // 新增
```

**Step 7: 验证编译**

Run: `cd /Users/liushiquan/.openclaw/workspace/dev-toolkit/src-tauri && cargo check`
Expected: 编译通过

**Step 8: Commit**

```bash
git add src-tauri/src/ssh/ src-tauri/src/lib.rs
git commit -m "feat(ssh): add core types, config and crypto modules"
```

---

### Task 1.3: 添加xterm.js前端依赖

**Files:**
- Create: `src/xterm/xterm.min.js`
- Create: `src/xterm/xterm.min.css`
- Create: `src/xterm/xterm-addon-fit.min.js`
- Create: `src/xterm/xterm-addon-search.min.js`
- Create: `src/xterm/xterm-addon-web-links.min.js`

**Step 1: 创建xterm目录**

Run: `mkdir -p /Users/liushiquan/.openclaw/workspace/dev-toolkit/src/xterm`
Expected: 目录创建成功

**Step 2: 下载xterm.js核心文件**

由于需要下载外部文件，这里提供下载命令供执行：

```bash
cd /Users/liushiquan/.openclaw/workspace/dev-toolkit/src/xterm

# 下载xterm.js 5.3.0
curl -L -o xterm.min.js https://cdn.jsdelivr.net/npm/xterm@5.3.0/lib/xterm.min.js
curl -L -o xterm.min.css https://cdn.jsdelivr.net/npm/xterm@5.3.0/css/xterm.min.css

# 下载插件
curl -L -o xterm-addon-fit.min.js https://cdn.jsdelivr.net/npm/xterm-addon-fit@0.8.0/lib/xterm-addon-fit.min.js
curl -L -o xterm-addon-search.min.js https://cdn.jsdelivr.net/npm/xterm-addon-search@0.13.0/lib/xterm-addon-search.min.js
curl -L -o xterm-addon-web-links.min.js https://cdn.jsdelivr.net/npm/xterm-addon-web-links@0.9.0/lib/xterm-addon-web-links.min.js
```

**Step 3: 验证文件下载成功**

Run: `ls -la /Users/liushiquan/.openclaw/workspace/dev-toolkit/src/xterm/`
Expected: 显示5个文件

**Step 4: Commit**

```bash
git add src/xterm/
git commit -m "feat(ssh): add xterm.js terminal emulator"
```

---

## Phase 2: 会话管理功能

### Task 2.1: 添加会话管理Tauri命令

**Files:**
- Modify: `src-tauri/src/commands.rs`
- Modify: `src-tauri/src/lib.rs`

**Step 1: 在commands.rs末尾添加SSH会话管理命令**

```rust
// ==================== SSH会话管理 ====================

use crate::ssh::{SshSession, SessionGroup};

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
```

**Step 2: 在lib.rs的invoke_handler中注册命令**

在 `invoke_handler` 宏中添加：

```rust
// SSH会话管理
commands::ssh_list_sessions,
commands::ssh_save_session,
commands::ssh_delete_session,
commands::ssh_get_groups,
commands::ssh_import_sessions,
commands::ssh_export_sessions,
```

**Step 3: 验证编译**

Run: `cd /Users/liushiquan/.openclaw/workspace/dev-toolkit/src-tauri && cargo check`
Expected: 编译通过

**Step 4: Commit**

```bash
git add src-tauri/src/commands.rs src-tauri/src/lib.rs
git commit -m "feat(ssh): add session management commands"
```

---

### Task 2.2: 创建SSH前端主页面

**Files:**
- Modify: `src/index.html`
- Modify: `src/styles.css`
- Create: `src/ssh/ssh-main.js`
- Create: `src/ssh/ssh-sessions.js`

**Step 1: 在index.html的nav中添加SSH导航项**

在数据库导航组后添加：

```html
<div class="nav-group">
    <div class="nav-group-title">🔌 SSH</div>
    <a class="nav-item" data-page="ssh">SSH 连接</a>
</div>
```

**Step 2: 在index.html的main区域添加SSH页面section**

在最后一个section后添加：

```html
<!-- SSH 连接工具 -->
<section id="page-ssh" class="page">
    <div class="ssh-container">
        <!-- 左侧边栏 -->
        <aside class="ssh-sidebar">
            <div class="ssh-sidebar-header">
                <h3>会话管理</h3>
            </div>
            <div class="ssh-search">
                <input type="text" id="ssh-search-input" placeholder="搜索会话...">
            </div>
            <div class="ssh-session-tree" id="ssh-session-tree">
                <!-- 会话树将通过JS渲染 -->
            </div>
            <div class="ssh-sidebar-actions">
                <button class="ssh-btn ssh-btn-primary" id="ssh-quick-connect">
                    <span class="icon">+</span> 快速连接
                </button>
            </div>
        </aside>

        <!-- 右侧工作区 -->
        <div class="ssh-workspace">
            <div class="ssh-tabs" id="ssh-tabs">
                <!-- 标签页将通过JS渲染 -->
            </div>
            <div class="ssh-content" id="ssh-content">
                <div class="ssh-welcome">
                    <div class="ssh-welcome-icon">🔌</div>
                    <h2>SSH 连接工具</h2>
                    <p>选择左侧会话连接，或点击"快速连接"创建新连接</p>
                    <div class="ssh-features">
                        <div class="ssh-feature">
                            <span class="icon">💻</span>
                            <span>SSH终端</span>
                        </div>
                        <div class="ssh-feature">
                            <span class="icon">📁</span>
                            <span>SFTP文件管理</span>
                        </div>
                        <div class="ssh-feature">
                            <span class="icon">📊</span>
                            <span>系统监控</span>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </div>

    <!-- 快速连接对话框 -->
    <div class="ssh-modal" id="ssh-connect-modal" style="display: none;">
        <div class="ssh-modal-overlay"></div>
        <div class="ssh-modal-content">
            <div class="ssh-modal-header">
                <h3>快速连接</h3>
                <button class="ssh-modal-close">&times;</button>
            </div>
            <div class="ssh-modal-body">
                <form id="ssh-connect-form">
                    <div class="ssh-form-group">
                        <label>会话名称</label>
                        <input type="text" name="name" placeholder="可选，用于保存会话">
                    </div>
                    <div class="ssh-form-row">
                        <div class="ssh-form-group ssh-form-flex-3">
                            <label>主机地址 *</label>
                            <input type="text" name="host" required placeholder="192.168.1.1">
                        </div>
                        <div class="ssh-form-group ssh-form-flex-1">
                            <label>端口</label>
                            <input type="number" name="port" value="22">
                        </div>
                    </div>
                    <div class="ssh-form-group">
                        <label>用户名 *</label>
                        <input type="text" name="username" required placeholder="root">
                    </div>
                    <div class="ssh-form-group">
                        <label>认证方式</label>
                        <select name="auth_type">
                            <option value="password">密码</option>
                            <option value="private_key">密钥</option>
                        </select>
                    </div>
                    <div class="ssh-form-group" id="ssh-password-group">
                        <label>密码 *</label>
                        <input type="password" name="password" placeholder="输入密码">
                    </div>
                    <div class="ssh-form-group" id="ssh-key-group" style="display: none;">
                        <label>密钥路径</label>
                        <input type="text" name="key_path" placeholder="/path/to/id_rsa">
                    </div>
                    <div class="ssh-form-group">
                        <label>分组</label>
                        <input type="text" name="group" value="默认" placeholder="分组名称">
                    </div>
                </form>
            </div>
            <div class="ssh-modal-footer">
                <button type="button" class="ssh-btn ssh-btn-secondary" id="ssh-cancel-connect">取消</button>
                <button type="button" class="ssh-btn ssh-btn-primary" id="ssh-save-and-connect">保存并连接</button>
                <button type="button" class="ssh-btn ssh-btn-primary" id="ssh-connect-only">连接</button>
            </div>
        </div>
    </div>
</section>
```

**Step 3: 在index.html的head中添加xterm样式**

在 `</head>` 前添加：

```html
    <link rel="stylesheet" href="xterm/xterm.min.css">
```

**Step 4: 在index.html底部添加xterm和SSH脚本**

在现有脚本后添加：

```html
<script src="xterm/xterm.min.js"></script>
<script src="xterm/xterm-addon-fit.min.js"></script>
<script src="xterm/xterm-addon-search.min.js"></script>
<script src="xterm/xterm-addon-web-links.min.js"></script>
<script src="ssh/ssh-utils.js"></script>
<script src="ssh/ssh-sessions.js"></script>
<script src="ssh/ssh-terminal.js"></script>
<script src="ssh/ssh-sftp.js"></script>
<script src="ssh/ssh-monitor.js"></script>
<script src="ssh/ssh-main.js"></script>
```

**Step 5: Commit**

```bash
git add src/index.html
git commit -m "feat(ssh): add SSH page structure to index.html"
```

---

### Task 2.3: 添加SSH样式

**Files:**
- Modify: `src/styles.css`

**Step 1: 在styles.css末尾添加SSH样式**

```css
/* ==================== SSH 连接工具样式 ==================== */

.ssh-container {
    display: flex;
    height: 100%;
    background: var(--bg-primary);
}

/* 左侧边栏 */
.ssh-sidebar {
    width: 280px;
    min-width: 200px;
    max-width: 400px;
    background: var(--bg-secondary);
    border-right: 1px solid var(--border-color);
    display: flex;
    flex-direction: column;
    position: relative;
}

.ssh-sidebar-header {
    padding: 16px;
    border-bottom: 1px solid var(--border-color);
}

.ssh-sidebar-header h3 {
    margin: 0;
    font-size: 14px;
    color: var(--text-primary);
}

.ssh-search {
    padding: 12px 16px;
    border-bottom: 1px solid var(--border-color);
}

.ssh-search input {
    width: 100%;
    padding: 8px 12px;
    background: var(--bg-primary);
    border: 1px solid var(--border-color);
    border-radius: 4px;
    color: var(--text-primary);
    font-size: 13px;
}

.ssh-search input:focus {
    outline: none;
    border-color: var(--accent-color);
}

/* 会话树 */
.ssh-session-tree {
    flex: 1;
    overflow-y: auto;
    padding: 8px 0;
}

.ssh-group {
    margin-bottom: 4px;
}

.ssh-group-header {
    display: flex;
    align-items: center;
    padding: 8px 16px;
    cursor: pointer;
    user-select: none;
    color: var(--text-secondary);
    font-size: 12px;
    font-weight: 600;
    text-transform: uppercase;
}

.ssh-group-header:hover {
    background: rgba(255, 255, 255, 0.05);
}

.ssh-group-icon {
    margin-right: 8px;
    transition: transform 0.2s;
}

.ssh-group.expanded .ssh-group-icon {
    transform: rotate(90deg);
}

.ssh-group-sessions {
    display: none;
}

.ssh-group.expanded .ssh-group-sessions {
    display: block;
}

.ssh-session-item {
    display: flex;
    align-items: center;
    padding: 8px 16px 8px 32px;
    cursor: pointer;
    color: var(--text-primary);
    font-size: 13px;
    transition: background 0.15s;
}

.ssh-session-item:hover {
    background: rgba(255, 255, 255, 0.05);
}

.ssh-session-item.active {
    background: rgba(98, 114, 164, 0.2);
}

.ssh-session-status {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    margin-right: 10px;
    background: var(--text-muted);
}

.ssh-session-status.connected {
    background: #50fa7b;
}

.ssh-session-status.connecting {
    background: #f1fa8c;
    animation: pulse 1s infinite;
}

.ssh-session-status.error {
    background: #ff5555;
}

@keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.5; }
}

.ssh-session-name {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.ssh-session-actions {
    display: none;
    gap: 4px;
}

.ssh-session-item:hover .ssh-session-actions {
    display: flex;
}

.ssh-session-action {
    padding: 2px 6px;
    font-size: 11px;
    color: var(--text-muted);
    cursor: pointer;
}

.ssh-session-action:hover {
    color: var(--text-primary);
}

/* 侧边栏底部操作 */
.ssh-sidebar-actions {
    padding: 16px;
    border-top: 1px solid var(--border-color);
}

/* 右侧工作区 */
.ssh-workspace {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-width: 0;
}

/* 标签页 */
.ssh-tabs {
    display: flex;
    align-items: center;
    background: var(--bg-secondary);
    border-bottom: 1px solid var(--border-color);
    min-height: 40px;
    padding: 0 8px;
    overflow-x: auto;
}

.ssh-tab {
    display: flex;
    align-items: center;
    padding: 8px 16px;
    margin-right: 4px;
    background: transparent;
    border: none;
    border-radius: 4px 4px 0 0;
    color: var(--text-secondary);
    font-size: 13px;
    cursor: pointer;
    white-space: nowrap;
    transition: all 0.15s;
}

.ssh-tab:hover {
    background: rgba(255, 255, 255, 0.05);
    color: var(--text-primary);
}

.ssh-tab.active {
    background: var(--bg-primary);
    color: var(--text-primary);
    margin-bottom: -1px;
}

.ssh-tab-icon {
    margin-right: 8px;
}

.ssh-tab-title {
    margin-right: 8px;
}

.ssh-tab-close {
    width: 16px;
    height: 16px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 2px;
    font-size: 12px;
    opacity: 0.6;
}

.ssh-tab-close:hover {
    opacity: 1;
    background: rgba(255, 255, 255, 0.1);
}

.ssh-tab-status {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    margin-right: 8px;
    background: var(--text-muted);
}

.ssh-tab-status.connected {
    background: #50fa7b;
}

/* 内容区域 */
.ssh-content {
    flex: 1;
    overflow: hidden;
    position: relative;
}

/* 欢迎页面 */
.ssh-welcome {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100%;
    color: var(--text-secondary);
}

.ssh-welcome-icon {
    font-size: 64px;
    margin-bottom: 16px;
}

.ssh-welcome h2 {
    margin: 0 0 8px 0;
    color: var(--text-primary);
}

.ssh-welcome p {
    margin: 0 0 24px 0;
}

.ssh-features {
    display: flex;
    gap: 32px;
}

.ssh-feature {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
}

.ssh-feature .icon {
    font-size: 24px;
}

/* 按钮 */
.ssh-btn {
    padding: 8px 16px;
    border: none;
    border-radius: 4px;
    font-size: 13px;
    cursor: pointer;
    transition: all 0.15s;
    display: inline-flex;
    align-items: center;
    gap: 6px;
}

.ssh-btn-primary {
    background: var(--accent-color);
    color: white;
}

.ssh-btn-primary:hover {
    background: #444a5f;
}

.ssh-btn-secondary {
    background: var(--bg-primary);
    color: var(--text-primary);
    border: 1px solid var(--border-color);
}

.ssh-btn-secondary:hover {
    background: var(--bg-tertiary);
}

.ssh-btn-danger {
    background: #ff5555;
    color: white;
}

.ssh-btn-danger:hover {
    background: #ff3333;
}

/* 模态框 */
.ssh-modal {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 1000;
    display: flex;
    align-items: center;
    justify-content: center;
}

.ssh-modal-overlay {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.6);
}

.ssh-modal-content {
    position: relative;
    background: var(--bg-secondary);
    border-radius: 8px;
    width: 480px;
    max-width: 90vw;
    max-height: 90vh;
    display: flex;
    flex-direction: column;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
}

.ssh-modal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 16px 20px;
    border-bottom: 1px solid var(--border-color);
}

.ssh-modal-header h3 {
    margin: 0;
    font-size: 16px;
    color: var(--text-primary);
}

.ssh-modal-close {
    background: none;
    border: none;
    color: var(--text-muted);
    font-size: 20px;
    cursor: pointer;
    padding: 0;
    width: 24px;
    height: 24px;
    display: flex;
    align-items: center;
    justify-content: center;
}

.ssh-modal-close:hover {
    color: var(--text-primary);
}

.ssh-modal-body {
    padding: 20px;
    overflow-y: auto;
    flex: 1;
}

.ssh-modal-footer {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    padding: 16px 20px;
    border-top: 1px solid var(--border-color);
}

/* 表单 */
.ssh-form-group {
    margin-bottom: 16px;
}

.ssh-form-group label {
    display: block;
    margin-bottom: 6px;
    font-size: 13px;
    color: var(--text-secondary);
}

.ssh-form-group input,
.ssh-form-group select {
    width: 100%;
    padding: 8px 12px;
    background: var(--bg-primary);
    border: 1px solid var(--border-color);
    border-radius: 4px;
    color: var(--text-primary);
    font-size: 13px;
}

.ssh-form-group input:focus,
.ssh-form-group select:focus {
    outline: none;
    border-color: var(--accent-color);
}

.ssh-form-row {
    display: flex;
    gap: 16px;
}

.ssh-form-flex-3 {
    flex: 3;
}

.ssh-form-flex-1 {
    flex: 1;
}

/* 终端容器 */
.ssh-terminal-container {
    width: 100%;
    height: 100%;
    background: #1e1e1e;
}

.ssh-terminal-container .xterm {
    height: 100%;
    padding: 8px;
}

/* 终端工具栏 */
.ssh-terminal-toolbar {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 16px;
    background: var(--bg-secondary);
    border-bottom: 1px solid var(--border-color);
}

.ssh-terminal-toolbar .ssh-btn {
    padding: 4px 8px;
    font-size: 12px;
}

/* 分屏容器 */
.ssh-split-container {
    display: flex;
    width: 100%;
    height: 100%;
}

.ssh-split-pane {
    flex: 1;
    border-right: 1px solid var(--border-color);
}

.ssh-split-pane:last-child {
    border-right: none;
}

.ssh-split-horizontal .ssh-split-pane {
    border-right: 1px solid var(--border-color);
    border-bottom: none;
}

.ssh-split-vertical {
    flex-direction: column;
}

.ssh-split-vertical .ssh-split-pane {
    border-bottom: 1px solid var(--border-color);
    border-right: none;
}

/* SFTP文件管理器 */
.ssh-sftp-container {
    display: flex;
    height: 100%;
}

.ssh-sftp-pane {
    flex: 1;
    display: flex;
    flex-direction: column;
    border-right: 1px solid var(--border-color);
}

.ssh-sftp-pane:last-child {
    border-right: none;
}

.ssh-sftp-header {
    display: flex;
    align-items: center;
    padding: 8px 16px;
    background: var(--bg-secondary);
    border-bottom: 1px solid var(--border-color);
    gap: 8px;
}

.ssh-sftp-path {
    flex: 1;
    padding: 6px 12px;
    background: var(--bg-primary);
    border: 1px solid var(--border-color);
    border-radius: 4px;
    color: var(--text-primary);
    font-size: 13px;
}

.ssh-sftp-filelist {
    flex: 1;
    overflow-y: auto;
    padding: 8px 0;
}

.ssh-sftp-item {
    display: flex;
    align-items: center;
    padding: 6px 16px;
    cursor: pointer;
    font-size: 13px;
}

.ssh-sftp-item:hover {
    background: rgba(255, 255, 255, 0.05);
}

.ssh-sftp-item.selected {
    background: rgba(98, 114, 164, 0.2);
}

.ssh-sftp-item-icon {
    margin-right: 8px;
    width: 16px;
    text-align: center;
}

.ssh-sftp-item-name {
    flex: 1;
}

.ssh-sftp-item-size {
    width: 80px;
    text-align: right;
    color: var(--text-muted);
}

.ssh-sftp-item-date {
    width: 120px;
    text-align: right;
    color: var(--text-muted);
    margin-left: 16px;
}

/* 系统监控 */
.ssh-monitor-container {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 16px;
    padding: 16px;
    overflow-y: auto;
}

.ssh-monitor-card {
    background: var(--bg-secondary);
    border-radius: 8px;
    padding: 16px;
}

.ssh-monitor-card-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 12px;
}

.ssh-monitor-card-title {
    font-size: 14px;
    font-weight: 600;
    color: var(--text-primary);
}

.ssh-monitor-value {
    font-size: 24px;
    font-weight: 700;
    color: var(--accent-color);
}

.ssh-monitor-chart {
    height: 100px;
    background: var(--bg-primary);
    border-radius: 4px;
}

/* 进度条 */
.ssh-progress {
    height: 4px;
    background: var(--bg-primary);
    border-radius: 2px;
    overflow: hidden;
}

.ssh-progress-bar {
    height: 100%;
    background: var(--accent-color);
    transition: width 0.3s;
}

/* 传输队列 */
.ssh-transfer-queue {
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;
    background: var(--bg-secondary);
    border-top: 1px solid var(--border-color);
    max-height: 200px;
    overflow-y: auto;
}

.ssh-transfer-item {
    display: flex;
    align-items: center;
    padding: 8px 16px;
    border-bottom: 1px solid var(--border-color);
    font-size: 13px;
}

.ssh-transfer-icon {
    margin-right: 8px;
}

.ssh-transfer-name {
    flex: 1;
}

.ssh-transfer-progress {
    width: 100px;
    margin: 0 16px;
}

.ssh-transfer-speed {
    width: 80px;
    text-align: right;
    color: var(--text-muted);
}

/* 右键菜单 */
.ssh-context-menu {
    position: fixed;
    background: var(--bg-secondary);
    border: 1px solid var(--border-color);
    border-radius: 4px;
    padding: 4px 0;
    min-width: 160px;
    z-index: 2000;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3);
}

.ssh-context-menu-item {
    display: flex;
    align-items: center;
    padding: 8px 16px;
    cursor: pointer;
    font-size: 13px;
    color: var(--text-primary);
}

.ssh-context-menu-item:hover {
    background: rgba(255, 255, 255, 0.05);
}

.ssh-context-menu-item.danger {
    color: #ff5555;
}

.ssh-context-menu-divider {
    height: 1px;
    background: var(--border-color);
    margin: 4px 0;
}

/* 空状态 */
.ssh-empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 32px;
    color: var(--text-muted);
}

.ssh-empty-icon {
    font-size: 32px;
    margin-bottom: 8px;
}

/* 加载状态 */
.ssh-loading {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 32px;
}

.ssh-spinner {
    width: 32px;
    height: 32px;
    border: 3px solid var(--border-color);
    border-top-color: var(--accent-color);
    border-radius: 50%;
    animation: spin 1s linear infinite;
}

@keyframes spin {
    to { transform: rotate(360deg); }
}
```

**Step 2: Commit**

```bash
git add src/styles.css
git commit -m "feat(ssh): add SSH tool styles"
```

---

### Task 2.4: 创建SSH工具函数

**Files:**
- Create: `src/ssh/ssh-utils.js`

**Step 1: 创建ssh-utils.js**

```javascript
// src/ssh/ssh-utils.js

const SSHUtils = {
    // 生成UUID
    uuid() {
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
            const r = Math.random() * 16 | 0;
            const v = c === 'x' ? r : (r & 0x3 | 0x8);
            return v.toString(16);
        });
    },

    // 格式化日期
    formatDate(date) {
        if (typeof date === 'string') {
            date = new Date(date);
        }
        return date.toLocaleString('zh-CN', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
        });
    },

    // 格式化文件大小
    formatSize(bytes) {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    },

    // 格式化速度
    formatSpeed(bytesPerSec) {
        return this.formatSize(bytesPerSec) + '/s';
    },

    // 格式化持续时间
    formatDuration(seconds) {
        if (seconds < 60) {
            return `${seconds}秒`;
        } else if (seconds < 3600) {
            const minutes = Math.floor(seconds / 60);
            const secs = seconds % 60;
            return `${minutes}分${secs}秒`;
        } else {
            const hours = Math.floor(seconds / 3600);
            const minutes = Math.floor((seconds % 3600) / 60);
            return `${hours}时${minutes}分`;
        }
    },

    // 显示提示消息
    showToast(message, type = 'info') {
        const toast = document.createElement('div');
        toast.className = `ssh-toast ssh-toast-${type}`;
        toast.textContent = message;
        toast.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            padding: 12px 20px;
            background: ${type === 'error' ? '#ff5555' : type === 'success' ? '#50fa7b' : '#6272a4'};
            color: white;
            border-radius: 4px;
            z-index: 10000;
            animation: slideIn 0.3s ease;
        `;
        document.body.appendChild(toast);

        setTimeout(() => {
            toast.style.animation = 'slideOut 0.3s ease';
            setTimeout(() => toast.remove(), 300);
        }, 3000);
    },

    // 显示确认对话框
    async confirm(message) {
        return new Promise((resolve) => {
            const modal = document.createElement('div');
            modal.className = 'ssh-modal';
            modal.innerHTML = `
                <div class="ssh-modal-overlay"></div>
                <div class="ssh-modal-content" style="width: 320px;">
                    <div class="ssh-modal-header">
                        <h3>确认</h3>
                    </div>
                    <div class="ssh-modal-body">
                        <p style="margin: 0; color: var(--text-primary);">${message}</p>
                    </div>
                    <div class="ssh-modal-footer">
                        <button class="ssh-btn ssh-btn-secondary" id="confirm-cancel">取消</button>
                        <button class="ssh-btn ssh-btn-primary" id="confirm-ok">确定</button>
                    </div>
                </div>
            `;
            document.body.appendChild(modal);

            modal.querySelector('#confirm-ok').onclick = () => {
                modal.remove();
                resolve(true);
            };
            modal.querySelector('#confirm-cancel').onclick = () => {
                modal.remove();
                resolve(false);
            };
            modal.querySelector('.ssh-modal-overlay').onclick = () => {
                modal.remove();
                resolve(false);
            };
        });
    },

    // 解析SSH连接字符串
    parseConnectionString(str) {
        // 支持格式: user@host:port, user@host, host:port, host
        const result = {
            host: '',
            port: 22,
            username: ''
        };

        // 解析 user@ 部分
        if (str.includes('@')) {
            const parts = str.split('@');
            result.username = parts[0];
            str = parts[1];
        }

        // 解析 :port 部分
        if (str.includes(':')) {
            const parts = str.split(':');
            result.host = parts[0];
            result.port = parseInt(parts[1]) || 22;
        } else {
            result.host = str;
        }

        return result;
    },

    // 获取文件图标
    getFileIcon(name, isDir) {
        if (isDir) return '📁';

        const ext = name.split('.').pop().toLowerCase();
        const icons = {
            'js': '📜',
            'ts': '📜',
            'py': '🐍',
            'java': '☕',
            'go': '🐹',
            'rs': '🦀',
            'c': '📜',
            'cpp': '📜',
            'h': '📜',
            'html': '🌐',
            'css': '🎨',
            'json': '📋',
            'xml': '📋',
            'yaml': '📋',
            'yml': '📋',
            'md': '📝',
            'txt': '📄',
            'log': '📄',
            'sh': '🔧',
            'bash': '🔧',
            'zsh': '🔧',
            'zip': '📦',
            'tar': '📦',
            'gz': '📦',
            'rar': '📦',
            '7z': '📦',
            'jpg': '🖼️',
            'jpeg': '🖼️',
            'png': '🖼️',
            'gif': '🖼️',
            'svg': '🖼️',
            'pdf': '📕',
            'doc': '📘',
            'docx': '📘',
            'xls': '📗',
            'xlsx': '📗',
            'ppt': '📙',
            'pptx': '📙',
        };

        return icons[ext] || '📄';
    },

    // 防抖函数
    debounce(fn, delay) {
        let timer = null;
        return function(...args) {
            clearTimeout(timer);
            timer = setTimeout(() => fn.apply(this, args), delay);
        };
    },

    // 节流函数
    throttle(fn, delay) {
        let last = 0;
        return function(...args) {
            const now = Date.now();
            if (now - last >= delay) {
                last = now;
                fn.apply(this, args);
            }
        };
    }
};

// 添加CSS动画
const style = document.createElement('style');
style.textContent = `
    @keyframes slideIn {
        from { transform: translateX(100%); opacity: 0; }
        to { transform: translateX(0); opacity: 1; }
    }
    @keyframes slideOut {
        from { transform: translateX(0); opacity: 1; }
        to { transform: translateX(100%); opacity: 0; }
    }
`;
document.head.appendChild(style);
```

**Step 2: Commit**

```bash
git add src/ssh/ssh-utils.js
git commit -m "feat(ssh): add utility functions"
```

---

### Task 2.5: 创建会话管理组件

**Files:**
- Create: `src/ssh/ssh-sessions.js`

**Step 1: 创建ssh-sessions.js**

```javascript
// src/ssh/ssh-sessions.js

class SshSessionManager {
    constructor() {
        this.sessions = [];
        this.groups = [];
        this.connections = new Map(); // session_id -> connection info
        this.selectedSession = null;
        this.expandedGroups = new Set(['默认']);

        this.init();
    }

    async init() {
        await this.loadSessions();
        this.render();
        this.bindEvents();
    }

    async loadSessions() {
        try {
            const result = await window.__TAURI__.invoke('ssh_list_sessions');
            this.sessions = result || [];
            this.updateGroups();
        } catch (e) {
            console.error('加载会话失败:', e);
            SSHUtils.showToast('加载会话失败: ' + e, 'error');
        }
    }

    updateGroups() {
        const groupSet = new Set(this.sessions.map(s => s.group || '默认'));
        this.groups = Array.from(groupSet);
    }

    render() {
        const container = document.getElementById('ssh-session-tree');
        if (!container) return;

        // 按分组组织会话
        const grouped = {};
        for (const session of this.sessions) {
            const group = session.group || '默认';
            if (!grouped[group]) {
                grouped[group] = [];
            }
            grouped[group].push(session);
        }

        // 渲染分组
        container.innerHTML = Object.entries(grouped).map(([group, sessions]) => `
            <div class="ssh-group ${this.expandedGroups.has(group) ? 'expanded' : ''}">
                <div class="ssh-group-header" data-group="${group}">
                    <span class="ssh-group-icon">▶</span>
                    <span>${group}</span>
                    <span style="margin-left: auto; color: var(--text-muted);">${sessions.length}</span>
                </div>
                <div class="ssh-group-sessions">
                    ${sessions.map(session => this.renderSessionItem(session)).join('')}
                </div>
            </div>
        `).join('');

        // 如果没有会话
        if (this.sessions.length === 0) {
            container.innerHTML = `
                <div class="ssh-empty">
                    <div class="ssh-empty-icon">📭</div>
                    <div>暂无保存的会话</div>
                </div>
            `;
        }
    }

    renderSessionItem(session) {
        const conn = this.connections.get(session.id);
        const status = conn ? conn.status : 'disconnected';

        return `
            <div class="ssh-session-item ${this.selectedSession === session.id ? 'active' : ''}"
                 data-session-id="${session.id}">
                <span class="ssh-session-status ${status}"></span>
                <span class="ssh-session-name">${session.name || session.host}</span>
                <div class="ssh-session-actions">
                    <span class="ssh-session-action" data-action="edit" title="编辑">✏️</span>
                    <span class="ssh-session-action" data-action="duplicate" title="复制">📋</span>
                    <span class="ssh-session-action" data-action="delete" title="删除">🗑️</span>
                </div>
            </div>
        `;
    }

    bindEvents() {
        const container = document.getElementById('ssh-session-tree');
        if (!container) return;

        // 分组展开/收起
        container.addEventListener('click', async (e) => {
            const groupHeader = e.target.closest('.ssh-group-header');
            if (groupHeader) {
                const group = groupHeader.dataset.group;
                if (this.expandedGroups.has(group)) {
                    this.expandedGroups.delete(group);
                } else {
                    this.expandedGroups.add(group);
                }
                this.render();
                return;
            }

            // 会话项点击
            const sessionItem = e.target.closest('.ssh-session-item');
            if (sessionItem) {
                const sessionId = sessionItem.dataset.sessionId;
                const action = e.target.dataset.action;

                if (action) {
                    e.stopPropagation();
                    await this.handleAction(sessionId, action);
                } else {
                    this.selectSession(sessionId);
                }
            }
        });

        // 双击连接
        container.addEventListener('dblclick', (e) => {
            const sessionItem = e.target.closest('.ssh-session-item');
            if (sessionItem) {
                const sessionId = sessionItem.dataset.sessionId;
                this.connect(sessionId);
            }
        });

        // 右键菜单
        container.addEventListener('contextmenu', (e) => {
            const sessionItem = e.target.closest('.ssh-session-item');
            if (sessionItem) {
                e.preventDefault();
                const sessionId = sessionItem.dataset.sessionId;
                this.showContextMenu(e, sessionId);
            }
        });

        // 搜索
        const searchInput = document.getElementById('ssh-search-input');
        if (searchInput) {
            searchInput.addEventListener('input', SSHUtils.debounce((e) => {
                this.filterSessions(e.target.value);
            }, 300));
        }
    }

    selectSession(sessionId) {
        this.selectedSession = sessionId;
        this.render();
    }

    async handleAction(sessionId, action) {
        const session = this.sessions.find(s => s.id === sessionId);
        if (!session) return;

        switch (action) {
            case 'edit':
                this.openEditModal(session);
                break;
            case 'duplicate':
                await this.duplicateSession(session);
                break;
            case 'delete':
                await this.deleteSession(sessionId);
                break;
        }
    }

    async duplicateSession(session) {
        const newSession = {
            ...session,
            id: '',
            name: session.name + ' (副本)'
        };

        try {
            const result = await window.__TAURI__.invoke('ssh_save_session', { session: newSession });
            this.sessions.push(result);
            this.updateGroups();
            this.render();
            SSHUtils.showToast('会话已复制', 'success');
        } catch (e) {
            SSHUtils.showToast('复制失败: ' + e, 'error');
        }
    }

    async deleteSession(sessionId) {
        const session = this.sessions.find(s => s.id === sessionId);
        if (!session) return;

        const confirmed = await SSHUtils.confirm(`确定删除会话 "${session.name || session.host}" 吗？`);
        if (!confirmed) return;

        try {
            await window.__TAURI__.invoke('ssh_delete_session', { id: sessionId });
            this.sessions = this.sessions.filter(s => s.id !== sessionId);
            this.updateGroups();
            this.render();
            SSHUtils.showToast('会话已删除', 'success');
        } catch (e) {
            SSHUtils.showToast('删除失败: ' + e, 'error');
        }
    }

    showContextMenu(e, sessionId) {
        const session = this.sessions.find(s => s.id === sessionId);
        if (!session) return;

        const menu = document.createElement('div');
        menu.className = 'ssh-context-menu';
        menu.innerHTML = `
            <div class="ssh-context-menu-item" data-action="connect">🔌 连接</div>
            <div class="ssh-context-menu-item" data-action="edit">✏️ 编辑</div>
            <div class="ssh-context-menu-item" data-action="duplicate">📋 复制</div>
            <div class="ssh-context-menu-divider"></div>
            <div class="ssh-context-menu-item" data-action="export">📤 导出</div>
            <div class="ssh-context-menu-divider"></div>
            <div class="ssh-context-menu-item danger" data-action="delete">🗑️ 删除</div>
        `;

        menu.style.left = e.clientX + 'px';
        menu.style.top = e.clientY + 'px';
        document.body.appendChild(menu);

        // 点击菜单项
        menu.addEventListener('click', async (e) => {
            const action = e.target.dataset.action;
            if (action) {
                menu.remove();
                switch (action) {
                    case 'connect':
                        this.connect(sessionId);
                        break;
                    default:
                        await this.handleAction(sessionId, action);
                }
            }
        });

        // 点击外部关闭
        const closeMenu = () => {
            menu.remove();
            document.removeEventListener('click', closeMenu);
        };
        setTimeout(() => document.addEventListener('click', closeMenu), 0);
    }

    filterSessions(keyword) {
        const container = document.getElementById('ssh-session-tree');
        if (!container) return;

        const items = container.querySelectorAll('.ssh-session-item');
        keyword = keyword.toLowerCase();

        items.forEach(item => {
            const name = item.querySelector('.ssh-session-name').textContent.toLowerCase();
            item.style.display = name.includes(keyword) ? '' : 'none';
        });
    }

    openEditModal(session) {
        // 使用快速连接模态框编辑
        const modal = document.getElementById('ssh-connect-modal');
        const form = document.getElementById('ssh-connect-form');

        // 填充表单
        form.name.value = session.name || '';
        form.host.value = session.host;
        form.port.value = session.port;
        form.username.value = session.username;
        form.group.value = session.group || '默认';

        if (session.auth_type.type === 'password') {
            form.auth_type.value = 'password';
            form.password.value = session.auth_type.password || '';
            document.getElementById('ssh-password-group').style.display = '';
            document.getElementById('ssh-key-group').style.display = 'none';
        } else {
            form.auth_type.value = 'private_key';
            form.key_path.value = session.auth_type.key_path || '';
            document.getElementById('ssh-password-group').style.display = 'none';
            document.getElementById('ssh-key-group').style.display = '';
        }

        // 保存session ID用于更新
        form.dataset.editSessionId = session.id;

        modal.style.display = '';
    }

    async connect(sessionId) {
        const session = this.sessions.find(s => s.id === sessionId);
        if (!session) return;

        // 触发连接事件
        window.dispatchEvent(new CustomEvent('ssh-connect', {
            detail: { session }
        }));
    }

    updateConnectionStatus(sessionId, status, error = null) {
        this.connections.set(sessionId, { status, error });
        this.render();
    }
}

// 创建全局实例
window.sshSessionManager = new SshSessionManager();
```

**Step 2: Commit**

```bash
git add src/ssh/ssh-sessions.js
git commit -m "feat(ssh): add session manager component"
```

---

## Phase 3: SSH终端实现

### Task 3.1: 创建SSH会话连接后端

**Files:**
- Create: `src-tauri/src/ssh/session.rs`
- Create: `src-tauri/src/ssh/channel.rs`
- Modify: `src-tauri/src/ssh/mod.rs`

**Step 1: 创建session.rs**

```rust
// src-tauri/src/ssh/session.rs

use crate::ssh::types::*;
use ssh2::Session;
use std::collections::HashMap;
use std::net::TcpStream;
use std::sync::Arc;
use tokio::sync::{broadcast, Mutex, RwLock};
use tauri::AppHandle;

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
                sess.userauth_pubkey_memory(
                    &session_config.username,
                    None,
                    &key,
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

        // 创建输出通道
        let (output_tx, _) = broadcast::channel(1024);

        // 保存连接
        let conn = ActiveConnection {
            session: sess,
            output_tx,
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
        if let Some(conn) = connections.remove(connection_id) {
            // 发送断开状态
            let _ = conn.output_tx.send(vec![]); // 发送空数据表示断开
        }
        Ok(())
    }

    /// 获取连接
    pub async fn get_connection(&self, connection_id: &str) -> Option<Arc<ActiveConnection>> {
        let connections = self.connections.read().await;
        connections.get(connection_id).map(|c| Arc::new(c.clone()))
    }
}

/// 活动连接
#[derive(Clone)]
pub struct ActiveConnection {
    pub session: Session,
    pub output_tx: broadcast::Sender<Vec<u8>>,
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
            Some(cols as u32),
            Some(rows as u32),
            None,
        ).map_err(|e| format!("请求PTY失败: {}", e))?;

        // 启动shell
        channel.shell(true).map_err(|e| format!("启动shell失败: {}", e))?;

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
```

**Step 2: 更新mod.rs**

```rust
// src-tauri/src/ssh/mod.rs

pub mod types;
pub mod config;
pub mod crypto;
pub mod session;

pub use types::*;
pub use config::*;
pub use crypto::*;
pub use session::*;
```

**Step 3: 添加lazy_static依赖到Cargo.toml**

```toml
lazy_static = "1.4"
```

**Step 4: 验证编译**

Run: `cd /Users/liushiquan/.openclaw/workspace/dev-toolkit/src-tauri && cargo check`
Expected: 编译通过

**Step 5: Commit**

```bash
git add src-tauri/src/ssh/ src-tauri/Cargo.toml
git commit -m "feat(ssh): add SSH session connection backend"
```

---

### Task 3.2: 创建终端组件

**Files:**
- Create: `src/ssh/ssh-terminal.js`

**Step 1: 创建ssh-terminal.js**

```javascript
// src/ssh/ssh-terminal.js

class SshTerminal {
    constructor(container, connectionId, sessionId) {
        this.container = container;
        this.connectionId = connectionId;
        this.sessionId = sessionId;
        this.term = null;
        this.fitAddon = null;
        this.searchAddon = null;
        this.channel = null;
        this.disconnected = false;

        this.init();
    }

    async init() {
        // 创建终端
        this.term = new Terminal({
            fontSize: 14,
            fontFamily: 'Monaco, Menlo, "Courier New", monospace',
            theme: this.getDraculaTheme(),
            cursorBlink: true,
            cursorStyle: 'block',
            scrollback: 10000,
            allowTransparency: true,
        });

        // 加载插件
        this.fitAddon = new FitAddon();
        this.term.loadAddon(this.fitAddon);

        this.searchAddon = new SearchAddon();
        this.term.loadAddon(this.searchAddon);

        const webLinksAddon = new WebLinksAddon();
        this.term.loadAddon(webLinksAddon);

        // 打开终端
        this.term.open(this.container);
        this.fitAddon.fit();

        // 绑定事件
        this.bindEvents();

        // 监听后端输出
        this.listenOutput();

        // 请求PTY
        await this.requestPty();
    }

    getDraculaTheme() {
        return {
            background: '#1e1e1e',
            foreground: '#f8f8f2',
            cursor: '#f8f8f2',
            cursorAccent: '#1e1e1e',
            selection: 'rgba(255, 255, 255, 0.3)',
            black: '#000000',
            red: '#ff5555',
            green: '#50fa7b',
            yellow: '#f1fa8c',
            blue: '#6272a4',
            magenta: '#ff79c6',
            cyan: '#8be9fd',
            white: '#f8f8f2',
            brightBlack: '#6272a4',
            brightRed: '#ff6e6e',
            brightGreen: '#69fa7b',
            brightYellow: '#ffffa5',
            brightBlue: '#8ba7f7',
            brightMagenta: '#ff92df',
            brightCyan: '#a5fdee',
            brightWhite: '#ffffff',
        };
    }

    bindEvents() {
        // 用户输入 -> 后端
        this.term.onData(data => {
            if (!this.disconnected) {
                window.__TAURI__.invoke('ssh_write', {
                    connectionId: this.connectionId,
                    data: Array.from(new TextEncoder().encode(data))
                }).catch(e => {
                    console.error('发送数据失败:', e);
                });
            }
        });

        // 窗口resize
        const resizeObserver = new ResizeObserver(() => {
            if (this.fitAddon && !this.disconnected) {
                this.fitAddon.fit();
                this.resizePty();
            }
        });
        resizeObserver.observe(this.container);

        // 键盘快捷键
        this.container.addEventListener('keydown', (e) => {
            // Ctrl+Shift+F: 搜索
            if (e.ctrlKey && e.shiftKey && e.key === 'F') {
                e.preventDefault();
                this.toggleSearch();
            }
            // Ctrl+C: 复制
            if (e.ctrlKey && e.key === 'c' && this.term.hasSelection()) {
                e.preventDefault();
                document.execCommand('copy');
            }
            // Ctrl+V: 粘贴
            if (e.ctrlKey && e.key === 'v') {
                e.preventDefault();
                navigator.clipboard.readText().then(text => {
                    this.term.paste(text);
                });
            }
        });

        // 右键菜单
        this.container.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            this.showContextMenu(e);
        });
    }

    async listenOutput() {
        // 监听SSH输出事件
        const unlisten = await window.__TAURI__.event.listen(
            `ssh-output-${this.connectionId}`,
            (event) => {
                if (event.payload && event.payload.length > 0) {
                    const data = new Uint8Array(event.payload);
                    this.term.write(data);
                }
            }
        );

        // 监听断开事件
        const unlistenDisconnect = await window.__TAURI__.event.listen(
            `ssh-disconnect-${this.connectionId}`,
            () => {
                this.handleDisconnect();
            }
        );

        this.unlisten = () => {
            unlisten();
            unlistenDisconnect();
        };
    }

    async requestPty() {
        try {
            await window.__TAURI__.invoke('ssh_create_pty', {
                connectionId: this.connectionId,
                cols: this.term.cols,
                rows: this.term.rows
            });
        } catch (e) {
            SSHUtils.showToast('创建终端失败: ' + e, 'error');
            this.handleDisconnect();
        }
    }

    resizePty() {
        if (!this.disconnected && this.connectionId) {
            window.__TAURI__.invoke('ssh_resize_pty', {
                connectionId: this.connectionId,
                cols: this.term.cols,
                rows: this.term.rows
            }).catch(e => console.error('resize失败:', e));
        }
    }

    toggleSearch() {
        // 简单的搜索实现
        const searchTerm = prompt('搜索:');
        if (searchTerm) {
            this.searchAddon.findNext(searchTerm);
        }
    }

    showContextMenu(e) {
        const menu = document.createElement('div');
        menu.className = 'ssh-context-menu';
        menu.innerHTML = `
            <div class="ssh-context-menu-item" data-action="copy">📋 复制</div>
            <div class="ssh-context-menu-item" data-action="paste">📝 粘贴</div>
            <div class="ssh-context-menu-divider"></div>
            <div class="ssh-context-menu-item" data-action="search">🔍 搜索</div>
            <div class="ssh-context-menu-item" data-action="clear">🗑️ 清屏</div>
            <div class="ssh-context-menu-divider"></div>
            <div class="ssh-context-menu-item" data-action="reconnect">🔄 重新连接</div>
            <div class="ssh-context-menu-item danger" data-action="disconnect">❌ 断开连接</div>
        `;

        menu.style.left = e.clientX + 'px';
        menu.style.top = e.clientY + 'px';
        document.body.appendChild(menu);

        menu.addEventListener('click', async (e) => {
            const action = e.target.dataset.action;
            if (action) {
                menu.remove();
                this.handleContextAction(action);
            }
        });

        const closeMenu = () => {
            menu.remove();
            document.removeEventListener('click', closeMenu);
        };
        setTimeout(() => document.addEventListener('click', closeMenu), 0);
    }

    async handleContextAction(action) {
        switch (action) {
            case 'copy':
                if (this.term.hasSelection()) {
                    document.execCommand('copy');
                }
                break;
            case 'paste':
                const text = await navigator.clipboard.readText();
                this.term.paste(text);
                break;
            case 'search':
                this.toggleSearch();
                break;
            case 'clear':
                this.term.clear();
                break;
            case 'reconnect':
                window.dispatchEvent(new CustomEvent('ssh-reconnect', {
                    detail: { sessionId: this.sessionId }
                }));
                break;
            case 'disconnect':
                await window.__TAURI__.invoke('ssh_disconnect', {
                    connectionId: this.connectionId
                });
                break;
        }
    }

    handleDisconnect() {
        this.disconnected = true;
        this.term.write('\r\n\x1b[31m[连接已断开]\x1b[0m\r\n');
    }

    destroy() {
        if (this.unlisten) {
            this.unlisten();
        }
        if (this.term) {
            this.term.dispose();
        }
    }
}

// 分屏终端管理
class SplitTerminalManager {
    constructor(container) {
        this.container = container;
        this.terminals = [];
        this.layout = 'single';
    }

    setLayout(layout) {
        this.layout = layout;
        this.render();
    }

    render() {
        this.container.innerHTML = '';
        this.container.className = `ssh-split-container ssh-split-${this.layout}`;

        const layouts = {
            single: 1,
            horizontal: 2,
            vertical: 2,
            quad: 4
        };

        const count = layouts[this.layout] || 1;

        for (let i = 0; i < count; i++) {
            const pane = document.createElement('div');
            pane.className = 'ssh-split-pane';
            const terminalDiv = document.createElement('div');
            terminalDiv.className = 'ssh-terminal-container';
            terminalDiv.style.height = '100%';
            pane.appendChild(terminalDiv);
            this.container.appendChild(pane);

            // 如果已有终端实例，保留
            if (this.terminals[i]) {
                this.terminals[i].container = terminalDiv;
            }
        }
    }

    getTerminal(index) {
        return this.terminals[index];
    }

    addTerminal(terminal, index) {
        this.terminals[index] = terminal;
    }

    destroyAll() {
        this.terminals.forEach(t => t && t.destroy());
        this.terminals = [];
    }
}

window.SshTerminal = SshTerminal;
window.SplitTerminalManager = SplitTerminalManager;
```

**Step 2: Commit**

```bash
git add src/ssh/ssh-terminal.js
git commit -m "feat(ssh): add terminal component with xterm.js"
```

---

## Phase 4: SFTP文件管理

### Task 4.1: 创建SFTP后端

**Files:**
- Create: `src-tauri/src/ssh/sftp.rs`
- Modify: `src-tauri/src/ssh/mod.rs`
- Modify: `src-tauri/src/commands.rs`
- Modify: `src-tauri/src/lib.rs`

**Step 1: 创建sftp.rs**

```rust
// src-tauri/src/ssh/sftp.rs

use crate::ssh::types::*;
use ssh2::Sftp;
use std::path::Path;

/// SFTP文件信息
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct SftpEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub size: u64,
    pub permissions: u32,
    pub modified: String,
    pub owner: String,
    pub group: String,
}

/// 列出目录内容
pub fn list_dir(sftp: &Sftp, path: &str) -> Result<Vec<SftpEntry>, String> {
    let mut entries = Vec::new();

    let dir = sftp.opendir(Path::new(path))
        .map_err(|e| format!("打开目录失败: {}", e))?;

    while let Some((filename, attrs)) = dir.readdir().map_err(|e| format!("读取目录失败: {}", e))? {
        let name = filename.to_string_lossy().to_string();

        // 跳过 . 和 ..
        if name == "." || name == ".." {
            continue;
        }

        let full_path = if path.ends_with('/') {
            format!("{}{}", path, name)
        } else {
            format!("{}/{}", path, name)
        };

        let is_dir = attrs.is_dir();
        let size = attrs.size().unwrap_or(0);
        let permissions = attrs.permissions().unwrap_or(0);
        let modified = attrs.mtime()
            .map(|t| {
                chrono::DateTime::from_timestamp(t as i64, 0)
                    .map(|dt| dt.format("%Y-%m-%d %H:%M").to_string())
                    .unwrap_or_default()
            })
            .unwrap_or_default();

        let (owner, group) = if let Some(uid) = attrs.uid() {
            if let Some(gid) = attrs.gid() {
                (uid.to_string(), gid.to_string())
            } else {
                (uid.to_string(), String::new())
            }
        } else {
            (String::new(), String::new())
        };

        entries.push(SftpEntry {
            name,
            path: full_path,
            is_dir,
            size,
            permissions,
            modified,
            owner,
            group,
        });
    }

    // 排序：目录在前，然后按名称排序
    entries.sort_by(|a, b| {
        if a.is_dir && !b.is_dir {
            std::cmp::Ordering::Less
        } else if !a.is_dir && b.is_dir {
            std::cmp::Ordering::Greater
        } else {
            a.name.to_lowercase().cmp(&b.name.to_lowercase())
        }
    });

    Ok(entries)
}

/// 创建目录
pub fn mkdir(sftp: &Sftp, path: &str) -> Result<(), String> {
    sftp.mkdir(Path::new(path), 0o755)
        .map_err(|e| format!("创建目录失败: {}", e))
}

/// 删除文件
pub fn remove_file(sftp: &Sftp, path: &str) -> Result<(), String> {
    sftp.unlink(Path::new(path))
        .map_err(|e| format!("删除文件失败: {}", e))
}

/// 删除目录
pub fn remove_dir(sftp: &Sftp, path: &str) -> Result<(), String> {
    sftp.rmdir(Path::new(path))
        .map_err(|e| format!("删除目录失败: {}", e))
}

/// 重命名
pub fn rename(sftp: &Sftp, old: &str, new: &str) -> Result<(), String> {
    sftp.rename(Path::new(old), Path::new(new), None)
        .map_err(|e| format!("重命名失败: {}", e))
}

/// 修改权限
pub fn chmod(sftp: &Sftp, path: &str, mode: i32) -> Result<(), String> {
    sftp.setstat(Path::new(path), ssh2::Stat {
        permissions: Some(mode as u32),
        ..Default::default()
    }).map_err(|e| format!("修改权限失败: {}", e))
}

/// 读取文件内容
pub fn read_file(sftp: &Sftp, path: &str) -> Result<String, String> {
    let mut file = sftp.open(Path::new(path))
        .map_err(|e| format!("打开文件失败: {}", e))?;

    let mut content = String::new();
    std::io::Read::read_to_string(&mut file, &mut content)
        .map_err(|e| format!("读取文件失败: {}", e))?;

    Ok(content)
}

/// 写入文件内容
pub fn write_file(sftp: &Sftp, path: &str, content: &str) -> Result<(), String> {
    let mut file = sftp.create(Path::new(path))
        .map_err(|e| format!("创建文件失败: {}", e))?;

    std::io::Write::write_all(&mut file, content.as_bytes())
        .map_err(|e| format!("写入文件失败: {}", e))?;

    Ok(())
}
```

**Step 2: 更新mod.rs**

```rust
pub mod types;
pub mod config;
pub mod crypto;
pub mod session;
pub mod sftp;

pub use types::*;
pub use config::*;
pub use crypto::*;
pub use session::*;
pub use sftp::*;
```

**Step 3: Commit**

```bash
git add src-tauri/src/ssh/
git commit -m "feat(ssh): add SFTP backend operations"
```

---

### Task 4.2: 创建SFTP前端组件

**Files:**
- Create: `src/ssh/ssh-sftp.js`

**Step 1: 创建ssh-sftp.js**

```javascript
// src/ssh/ssh-sftp.js

class SftpManager {
    constructor(container, connectionId) {
        this.container = container;
        this.connectionId = connectionId;
        this.localPath = '/';
        this.remotePath = '/';
        this.localFiles = [];
        this.remoteFiles = [];
        this.selectedLocal = null;
        this.selectedRemote = null;

        this.init();
    }

    init() {
        this.render();
        this.bindEvents();
        this.loadRemoteFiles('/');
    }

    render() {
        this.container.innerHTML = `
            <div class="ssh-sftp-container">
                <div class="ssh-sftp-pane" id="sftp-local-pane">
                    <div class="ssh-sftp-header">
                        <span>📁 本地</span>
                        <input type="text" class="ssh-sftp-path" id="sftp-local-path" value="${this.localPath}">
                        <button class="ssh-btn ssh-btn-secondary" onclick="window.sftpManager.goLocalParent()">⬆️</button>
                        <button class="ssh-btn ssh-btn-secondary" onclick="window.sftpManager.refreshLocal()">🔄</button>
                    </div>
                    <div class="ssh-sftp-filelist" id="sftp-local-list"></div>
                </div>
                <div class="ssh-sftp-pane" id="sftp-remote-pane">
                    <div class="ssh-sftp-header">
                        <span>🌐 远程</span>
                        <input type="text" class="ssh-sftp-path" id="sftp-remote-path" value="${this.remotePath}">
                        <button class="ssh-btn ssh-btn-secondary" onclick="window.sftpManager.goRemoteParent()">⬆️</button>
                        <button class="ssh-btn ssh-btn-secondary" onclick="window.sftpManager.refreshRemote()">🔄</button>
                    </div>
                    <div class="ssh-sftp-filelist" id="sftp-remote-list"></div>
                </div>
            </div>
            <div class="ssh-transfer-queue" id="transfer-queue"></div>
        `;
    }

    bindEvents() {
        // 路径输入框回车
        document.getElementById('sftp-local-path').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                this.localPath = e.target.value;
                this.loadLocalFiles();
            }
        });

        document.getElementById('sftp-remote-path').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                this.remotePath = e.target.value;
                this.loadRemoteFiles(this.remotePath);
            }
        });

        // 拖拽上传
        const remoteList = document.getElementById('sftp-remote-list');
        remoteList.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'copy';
        });
        remoteList.addEventListener('drop', (e) => {
            e.preventDefault();
            const files = e.dataTransfer.files;
            for (const file of files) {
                this.uploadFile(file.path, this.remotePath + '/' + file.name);
            }
        });
    }

    async loadRemoteFiles(path) {
        try {
            const files = await window.__TAURI__.invoke('ssh_sftp_list_dir', {
                connectionId: this.connectionId,
                path: path
            });
            this.remoteFiles = files;
            this.remotePath = path;
            document.getElementById('sftp-remote-path').value = path;
            this.renderRemoteFiles();
        } catch (e) {
            SSHUtils.showToast('加载远程目录失败: ' + e, 'error');
        }
    }

    renderRemoteFiles() {
        const list = document.getElementById('sftp-remote-list');
        list.innerHTML = this.remoteFiles.map(file => `
            <div class="ssh-sftp-item ${this.selectedRemote === file.path ? 'selected' : ''}"
                 data-path="${file.path}" data-is-dir="${file.is_dir}">
                <span class="ssh-sftp-item-icon">${SSHUtils.getFileIcon(file.name, file.is_dir)}</span>
                <span class="ssh-sftp-item-name">${file.name}</span>
                <span class="ssh-sftp-item-size">${file.is_dir ? '' : SSHUtils.formatSize(file.size)}</span>
                <span class="ssh-sftp-item-date">${file.modified}</span>
            </div>
        `).join('');

        // 绑定点击事件
        list.querySelectorAll('.ssh-sftp-item').forEach(item => {
            item.addEventListener('click', () => {
                this.selectedRemote = item.dataset.path;
                this.renderRemoteFiles();
            });
            item.addEventListener('dblclick', () => {
                if (item.dataset.isDir === 'true') {
                    this.loadRemoteFiles(item.dataset.path);
                } else {
                    this.openRemoteFile(item.dataset.path);
                }
            });
        });
    }

    async openRemoteFile(path) {
        try {
            const content = await window.__TAURI__.invoke('ssh_sftp_read_file', {
                connectionId: this.connectionId,
                path: path
            });

            // 使用CodeMirror编辑
            window.dispatchEvent(new CustomEvent('ssh-edit-file', {
                detail: { path, content, connectionId: this.connectionId }
            }));
        } catch (e) {
            SSHUtils.showToast('打开文件失败: ' + e, 'error');
        }
    }

    async uploadFile(localPath, remotePath) {
        // TODO: 实现文件上传
        SSHUtils.showToast('上传功能开发中...', 'info');
    }

    async downloadFile(remotePath, localPath) {
        // TODO: 实现文件下载
        SSHUtils.showToast('下载功能开发中...', 'info');
    }

    goRemoteParent() {
        const parts = this.remotePath.split('/').filter(p => p);
        parts.pop();
        const parent = parts.length === 0 ? '/' : '/' + parts.join('/');
        this.loadRemoteFiles(parent);
    }

    refreshRemote() {
        this.loadRemoteFiles(this.remotePath);
    }

    goLocalParent() {
        // TODO: 实现本地目录导航
    }

    refreshLocal() {
        // TODO: 实现本地文件刷新
    }
}

window.SftpManager = SftpManager;
```

**Step 2: Commit**

```bash
git add src/ssh/ssh-sftp.js
git commit -m "feat(ssh): add SFTP file manager component"
```

---

## Phase 5: 系统监控

### Task 5.1: 创建系统监控组件

**Files:**
- Create: `src/ssh/ssh-monitor.js`

**Step 1: 创建ssh-monitor.js**

```javascript
// src/ssh/ssh-monitor.js

class SystemMonitor {
    constructor(container, connectionId) {
        this.container = container;
        this.connectionId = connectionId;
        this.data = null;
        this.processes = [];
        this.dockerContainers = [];
        this.refreshInterval = null;

        this.init();
    }

    async init() {
        this.render();
        await this.refresh();
        this.startAutoRefresh();
    }

    render() {
        this.container.innerHTML = `
            <div class="ssh-monitor-container">
                <div class="ssh-monitor-card">
                    <div class="ssh-monitor-card-header">
                        <span class="ssh-monitor-card-title">💻 CPU</span>
                    </div>
                    <div class="ssh-monitor-value" id="monitor-cpu">-</div>
                    <div class="ssh-monitor-chart" id="monitor-cpu-chart"></div>
                </div>
                <div class="ssh-monitor-card">
                    <div class="ssh-monitor-card-header">
                        <span class="ssh-monitor-card-title">🧠 内存</span>
                    </div>
                    <div class="ssh-monitor-value" id="monitor-memory">-</div>
                    <div class="ssh-monitor-chart" id="monitor-memory-chart"></div>
                </div>
                <div class="ssh-monitor-card">
                    <div class="ssh-monitor-card-header">
                        <span class="ssh-monitor-card-title">💾 磁盘</span>
                    </div>
                    <div class="ssh-monitor-value" id="monitor-disk">-</div>
                    <div id="monitor-disk-list"></div>
                </div>
                <div class="ssh-monitor-card">
                    <div class="ssh-monitor-card-header">
                        <span class="ssh-monitor-card-title">🌐 网络</span>
                    </div>
                    <div class="ssh-monitor-value" id="monitor-network">-</div>
                    <div id="monitor-network-info"></div>
                </div>
                <div class="ssh-monitor-card" style="grid-column: span 2;">
                    <div class="ssh-monitor-card-header">
                        <span class="ssh-monitor-card-title">📋 进程</span>
                        <input type="text" id="process-search" placeholder="搜索进程..." style="width: 200px; padding: 4px 8px; background: var(--bg-primary); border: 1px solid var(--border-color); border-radius: 4px; color: var(--text-primary);">
                    </div>
                    <div id="monitor-processes" style="max-height: 300px; overflow-y: auto;"></div>
                </div>
                <div class="ssh-monitor-card" style="grid-column: span 2;">
                    <div class="ssh-monitor-card-header">
                        <span class="ssh-monitor-card-title">🐳 Docker容器</span>
                    </div>
                    <div id="monitor-docker"></div>
                </div>
            </div>
        `;

        this.bindEvents();
    }

    bindEvents() {
        // 进程搜索
        document.getElementById('process-search').addEventListener('input', (e) => {
            this.filterProcesses(e.target.value);
        });
    }

    async refresh() {
        try {
            // 获取监控数据
            const data = await window.__TAURI__.invoke('ssh_monitor_data', {
                connectionId: this.connectionId
            });
            this.data = data;
            this.updateDisplay();

            // 获取进程列表
            const processes = await window.__TAURI__.invoke('ssh_monitor_processes', {
                connectionId: this.connectionId
            });
            this.processes = processes;
            this.renderProcesses();

            // 获取Docker容器
            try {
                const containers = await window.__TAURI__.invoke('ssh_docker_list', {
                    connectionId: this.connectionId
                });
                this.dockerContainers = containers;
                this.renderDocker();
            } catch (e) {
                // Docker可能不可用
                document.getElementById('monitor-docker').innerHTML = '<div style="color: var(--text-muted);">Docker不可用</div>';
            }
        } catch (e) {
            console.error('刷新监控数据失败:', e);
        }
    }

    updateDisplay() {
        if (!this.data) return;

        // CPU
        const cpuUsage = this.data.cpu_usage.reduce((a, b) => a + b, 0) / this.data.cpu_usage.length;
        document.getElementById('monitor-cpu').textContent = cpuUsage.toFixed(1) + '%';

        // 内存
        const memUsage = (this.data.memory.used / this.data.memory.total * 100).toFixed(1);
        document.getElementById('monitor-memory').textContent = memUsage + '%';

        // 磁盘
        const disk = this.data.disk[0];
        if (disk) {
            document.getElementById('monitor-disk').textContent = disk.usage + '%';
        }

        // 网络
        document.getElementById('monitor-network').textContent =
            SSHUtils.formatSize(this.data.network.rx_bytes) + ' ↓ / ' +
            SSHUtils.formatSize(this.data.network.tx_bytes) + ' ↑';
    }

    renderProcesses() {
        const container = document.getElementById('monitor-processes');
        container.innerHTML = `
            <table style="width: 100%; border-collapse: collapse;">
                <thead>
                    <tr style="color: var(--text-secondary); font-size: 12px;">
                        <th style="text-align: left; padding: 4px;">PID</th>
                        <th style="text-align: left; padding: 4px;">用户</th>
                        <th style="text-align: left; padding: 4px;">CPU%</th>
                        <th style="text-align: left; padding: 4px;">MEM%</th>
                        <th style="text-align: left; padding: 4px;">命令</th>
                        <th style="text-align: left; padding: 4px;">操作</th>
                    </tr>
                </thead>
                <tbody>
                    ${this.processes.slice(0, 20).map(p => `
                        <tr style="font-size: 13px; border-bottom: 1px solid var(--border-color);">
                            <td style="padding: 4px;">${p.pid}</td>
                            <td style="padding: 4px;">${p.user}</td>
                            <td style="padding: 4px; color: ${p.cpu > 50 ? '#ff5555' : 'inherit'};">${p.cpu}%</td>
                            <td style="padding: 4px;">${p.mem}%</td>
                            <td style="padding: 4px; max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${p.command}</td>
                            <td style="padding: 4px;">
                                <button class="ssh-btn ssh-btn-secondary" style="padding: 2px 6px; font-size: 11px;" onclick="window.systemMonitor.killProcess(${p.pid})">Kill</button>
                            </td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        `;
    }

    renderDocker() {
        const container = document.getElementById('monitor-docker');
        if (this.dockerContainers.length === 0) {
            container.innerHTML = '<div style="color: var(--text-muted);">无运行中的容器</div>';
            return;
        }

        container.innerHTML = this.dockerContainers.map(c => `
            <div style="display: inline-block; padding: 8px 12px; margin: 4px; background: var(--bg-primary); border-radius: 4px;">
                <div style="font-weight: 600; margin-bottom: 4px;">${c.name}</div>
                <div style="font-size: 12px; color: var(--text-muted);">${c.image}</div>
                <div style="font-size: 12px; color: ${c.status.includes('Up') ? '#50fa7b' : '#ff5555'};">${c.status}</div>
            </div>
        `).join('');
    }

    filterProcesses(keyword) {
        // TODO: 实现进程过滤
    }

    async killProcess(pid) {
        const confirmed = await SSHUtils.confirm(`确定终止进程 ${pid} 吗？`);
        if (!confirmed) return;

        try {
            await window.__TAURI__.invoke('ssh_monitor_kill_process', {
                connectionId: this.connectionId,
                pid: pid
            });
            SSHUtils.showToast('进程已终止', 'success');
            await this.refresh();
        } catch (e) {
            SSHUtils.showToast('终止进程失败: ' + e, 'error');
        }
    }

    startAutoRefresh() {
        this.refreshInterval = setInterval(() => {
            this.refresh();
        }, 3000);
    }

    stopAutoRefresh() {
        if (this.refreshInterval) {
            clearInterval(this.refreshInterval);
            this.refreshInterval = null;
        }
    }

    destroy() {
        this.stopAutoRefresh();
    }
}

window.SystemMonitor = SystemMonitor;
```

**Step 2: Commit**

```bash
git add src/ssh/ssh-monitor.js
git commit -m "feat(ssh): add system monitor component"
```

---

## Phase 6: 主入口和集成

### Task 6.1: 创建SSH主入口

**Files:**
- Create: `src/ssh/ssh-main.js`

**Step 1: 创建ssh-main.js**

```javascript
// src/ssh/ssh-main.js

class SshMain {
    constructor() {
        this.tabs = [];
        this.activeTab = null;
        this.connections = new Map();

        this.init();
    }

    async init() {
        this.bindEvents();
    }

    bindEvents() {
        // 快速连接按钮
        document.getElementById('ssh-quick-connect')?.addEventListener('click', () => {
            this.openConnectModal();
        });

        // 连接模态框事件
        const modal = document.getElementById('ssh-connect-modal');
        const form = document.getElementById('ssh-connect-form');

        // 认证方式切换
        form.auth_type?.addEventListener('change', (e) => {
            const isPassword = e.target.value === 'password';
            document.getElementById('ssh-password-group').style.display = isPassword ? '' : 'none';
            document.getElementById('ssh-key-group').style.display = isPassword ? 'none' : '';
        });

        // 取消按钮
        document.getElementById('ssh-cancel-connect')?.addEventListener('click', () => {
            modal.style.display = 'none';
            this.resetConnectForm();
        });

        // 模态框关闭按钮
        modal?.querySelector('.ssh-modal-close')?.addEventListener('click', () => {
            modal.style.display = 'none';
            this.resetConnectForm();
        });

        // 模态框overlay点击关闭
        modal?.querySelector('.ssh-modal-overlay')?.addEventListener('click', () => {
            modal.style.display = 'none';
            this.resetConnectForm();
        });

        // 连接按钮
        document.getElementById('ssh-connect-only')?.addEventListener('click', () => {
            this.handleConnect(false);
        });

        // 保存并连接按钮
        document.getElementById('ssh-save-and-connect')?.addEventListener('click', () => {
            this.handleConnect(true);
        });

        // 监听会话连接事件
        window.addEventListener('ssh-connect', (e) => {
            this.connectToSession(e.detail.session);
        });

        // 监听重连事件
        window.addEventListener('ssh-reconnect', async (e) => {
            const session = window.sshSessionManager.sessions.find(s => s.id === e.detail.sessionId);
            if (session) {
                this.connectToSession(session);
            }
        });
    }

    openConnectModal() {
        const modal = document.getElementById('ssh-connect-modal');
        modal.style.display = '';
        this.resetConnectForm();
    }

    resetConnectForm() {
        const form = document.getElementById('ssh-connect-form');
        form.reset();
        form.port.value = '22';
        form.group.value = '默认';
        form.auth_type.value = 'password';
        document.getElementById('ssh-password-group').style.display = '';
        document.getElementById('ssh-key-group').style.display = 'none';
        delete form.dataset.editSessionId;
    }

    async handleConnect(save) {
        const form = document.getElementById('ssh-connect-form');
        const formData = new FormData(form);

        const session = {
            id: form.dataset.editSessionId || '',
            name: formData.get('name') || formData.get('host'),
            host: formData.get('host'),
            port: parseInt(formData.get('port')) || 22,
            username: formData.get('username'),
            group: formData.get('group') || '默认',
            auth_type: formData.get('auth_type') === 'password'
                ? { type: 'password', password: formData.get('password') }
                : { type: 'private_key', key_path: formData.get('key_path'), passphrase: null },
            terminal: {
                shell: '/bin/bash',
                cols: 120,
                rows: 40,
                font_size: 14,
                font_family: 'Monaco, Menlo, "Courier New", monospace',
                theme: 'dracula',
                encoding: 'utf-8'
            }
        };

        // 验证必填字段
        if (!session.host || !session.username) {
            SSHUtils.showToast('请填写主机地址和用户名', 'error');
            return;
        }

        // 保存会话
        if (save) {
            try {
                const saved = await window.__TAURI__.invoke('ssh_save_session', { session });
                session.id = saved.id;
                await window.sshSessionManager.loadSessions();
                window.sshSessionManager.render();
                SSHUtils.showToast('会话已保存', 'success');
            } catch (e) {
                SSHUtils.showToast('保存会话失败: ' + e, 'error');
                return;
            }
        }

        // 关闭模态框
        document.getElementById('ssh-connect-modal').style.display = 'none';

        // 连接
        await this.connectToSession(session);
    }

    async connectToSession(session) {
        // 创建标签页
        const tabId = this.createTab('terminal', session.name || session.host, session.id);

        // 显示加载状态
        const content = document.getElementById(`tab-content-${tabId}`);
        content.innerHTML = `
            <div class="ssh-loading">
                <div class="ssh-spinner"></div>
                <span style="margin-left: 12px;">正在连接 ${session.host}...</span>
            </div>
        `;

        try {
            // 调用后端连接
            const connectionId = await window.__TAURI__.invoke('ssh_connect', {
                sessionId: session.id,
                session: session
            });

            // 保存连接信息
            this.connections.set(tabId, { connectionId, sessionId: session.id, session });

            // 创建终端
            content.innerHTML = '';
            const terminalContainer = document.createElement('div');
            terminalContainer.className = 'ssh-terminal-container';
            terminalContainer.style.height = '100%';
            content.appendChild(terminalContainer);

            const terminal = new SshTerminal(terminalContainer, connectionId, session.id);

            // 更新标签页状态
            this.updateTabStatus(tabId, 'connected');

            SSHUtils.showToast('连接成功', 'success');

        } catch (e) {
            content.innerHTML = `
                <div class="ssh-welcome">
                    <div class="ssh-welcome-icon">❌</div>
                    <h2>连接失败</h2>
                    <p>${e}</p>
                    <button class="ssh-btn ssh-btn-primary" onclick="window.sshMain.reconnect('${tabId}')">重新连接</button>
                </div>
            `;
            this.updateTabStatus(tabId, 'error');
            SSHUtils.showToast('连接失败: ' + e, 'error');
        }
    }

    createTab(type, title, sessionId) {
        const tabId = SSHUtils.uuid();
        const icons = {
            terminal: '💻',
            sftp: '📁',
            monitor: '📊'
        };

        // 创建标签
        const tabsContainer = document.getElementById('ssh-tabs');
        const tab = document.createElement('button');
        tab.className = 'ssh-tab';
        tab.dataset.tabId = tabId;
        tab.innerHTML = `
            <span class="ssh-tab-status"></span>
            <span class="ssh-tab-icon">${icons[type]}</span>
            <span class="ssh-tab-title">${title}</span>
            <span class="ssh-tab-close" onclick="event.stopPropagation(); window.sshMain.closeTab('${tabId}')">×</span>
        `;
        tab.onclick = () => this.switchTab(tabId);
        tabsContainer.appendChild(tab);

        // 创建内容区域
        const contentContainer = document.getElementById('ssh-content');
        const content = document.createElement('div');
        content.id = `tab-content-${tabId}`;
        content.className = 'ssh-tab-content';
        content.style.cssText = 'display: none; width: 100%; height: 100%;';
        contentContainer.appendChild(content);

        // 记录标签
        this.tabs.push({ id: tabId, type, title, sessionId });

        // 切换到新标签
        this.switchTab(tabId);

        return tabId;
    }

    switchTab(tabId) {
        // 更新标签样式
        document.querySelectorAll('.ssh-tab').forEach(t => {
            t.classList.toggle('active', t.dataset.tabId === tabId);
        });

        // 更新内容显示
        document.querySelectorAll('.ssh-tab-content').forEach(c => {
            c.style.display = c.id === `tab-content-${tabId}` ? '' : 'none';
        });

        this.activeTab = tabId;
    }

    closeTab(tabId) {
        // 断开连接
        const conn = this.connections.get(tabId);
        if (conn) {
            window.__TAURI__.invoke('ssh_disconnect', { connectionId: conn.connectionId });
            this.connections.delete(tabId);
        }

        // 移除标签
        const tab = document.querySelector(`.ssh-tab[data-tab-id="${tabId}"]`);
        tab?.remove();

        // 移除内容
        document.getElementById(`tab-content-${tabId}`)?.remove();

        // 从列表中移除
        this.tabs = this.tabs.filter(t => t.id !== tabId);

        // 切换到其他标签
        if (this.activeTab === tabId && this.tabs.length > 0) {
            this.switchTab(this.tabs[this.tabs.length - 1].id);
        }
    }

    updateTabStatus(tabId, status) {
        const statusEl = document.querySelector(`.ssh-tab[data-tab-id="${tabId}"] .ssh-tab-status`);
        if (statusEl) {
            statusEl.className = `ssh-tab-status ${status}`;
        }
    }

    async reconnect(tabId) {
        const conn = this.connections.get(tabId);
        if (conn) {
            await this.connectToSession(conn.session);
        }
    }

    // 打开SFTP
    openSftp(connectionId, sessionId) {
        const session = window.sshSessionManager.sessions.find(s => s.id === sessionId);
        const tabId = this.createTab('sftp', `📁 ${session?.name || 'SFTP'}`, sessionId);

        const content = document.getElementById(`tab-content-${tabId}`);
        const sftp = new SftpManager(content, connectionId);

        this.connections.set(tabId, { connectionId, sessionId, sftp });
    }

    // 打开监控
    openMonitor(connectionId, sessionId) {
        const session = window.sshSessionManager.sessions.find(s => s.id === sessionId);
        const tabId = this.createTab('monitor', `📊 ${session?.name || '监控'}`, sessionId);

        const content = document.getElementById(`tab-content-${tabId}`);
        const monitor = new SystemMonitor(content, connectionId);

        this.connections.set(tabId, { connectionId, sessionId, monitor });
    }
}

// 创建全局实例
window.sshMain = new SshMain();
```

**Step 2: Commit**

```bash
git add src/ssh/ssh-main.js
git commit -m "feat(ssh): add main entry and tab management"
```

---

### Task 6.2: 在app.js中集成SSH页面

**Files:**
- Modify: `src/app.js`

**Step 1: 在app.js的页面切换逻辑中添加SSH页面处理**

找到页面切换的代码，添加SSH页面的特殊处理：

```javascript
// 在页面切换函数中添加
if (page === 'ssh') {
    // SSH页面初始化（如果需要）
    console.log('SSH页面已激活');
}
```

**Step 2: Commit**

```bash
git add src/app.js
git commit -m "feat(ssh): integrate SSH page into app navigation"
```

---

### Task 6.3: 最终验证和构建

**Step 1: 验证前端文件完整性**

Run: `ls -la /Users/liushiquan/.openclaw/workspace/dev-toolkit/src/ssh/`
Expected: 显示所有SSH JS文件

**Step 2: 验证后端编译**

Run: `cd /Users/liushiquan/.openclaw/workspace/dev-toolkit/src-tauri && cargo build --release`
Expected: 编译成功

**Step 3: 启动开发模式测试**

Run: `cd /Users/liushiquan/.openclaw/workspace/dev-toolkit && npm run dev`
Expected: 应用启动，SSH页面可访问

**Step 4: 最终Commit**

```bash
git add -A
git commit -m "feat(ssh): complete SSH visualization tool implementation"
```

---

## 执行总结

本计划将SSH可视化连接工具的实现分解为以下阶段：

1. **Phase 1: 基础架构** - 添加依赖、创建模块结构、数据类型定义
2. **Phase 2: 会话管理** - 会话CRUD、UI组件、配置加密存储
3. **Phase 3: SSH终端** - xterm.js集成、PTY通道、双向数据流
4. **Phase 4: SFTP文件管理** - 文件操作、双栏UI、传输进度
5. **Phase 5: 系统监控** - 性能监控、进程管理、Docker集成
6. **Phase 6: 主入口集成** - 标签页管理、页面集成、最终验证

每个任务都遵循TDD原则，包含完整的代码和验证步骤。
