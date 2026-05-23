# SSH 功能 Bug 修复计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 修复 SSH 连接功能中发现的 8 个 bug，提高稳定性和可靠性

**Architecture:** 前端 JavaScript 和后端 Rust 同步修复，主要涉及事件处理、状态管理和资源清理

**Tech Stack:** Tauri 2.0, Rust (ssh2 crate), Vanilla JavaScript, xterm.js

---

## 问题清单

1. `getTauriEvent()` 方法逻辑错误（前端）
2. SFTP 全局变量未初始化（前端）
3. 事件监听器重复绑定（前端）
4. `get_connection_mut` 返回克隆而非引用（后端）
5. PTY 和 SFTP 模式冲突（后端）
6. 缺少连接超时机制（后端）
7. PTY 会话未清理（后端）
8. 没有连接数量限制（后端）

---

### Task 1: 修复 getTauriEvent() 方法

**Files:**
- Modify: `src/ssh/ssh-main.js:22-30`
- Modify: `src/ssh/ssh-terminal.js:28-35`
- Modify: `src/ssh/ssh-sftp.js:17-25`

**Step 1: 修复 ssh-main.js 中的 getTauriEvent**

```javascript
getTauriEvent() {
    if (window.__TAURI__?.event) {
        return window.__TAURI__.event;  // Tauri 2.x
    }
    return null;
}
```

**Step 2: 修复 ssh-terminal.js 中的 getTauriEvent**

同样的修改。

**Step 3: 修复 ssh-sftp.js 中的 getTauriEvent**

同样的修改。

**Step 4: Commit**

```bash
git add src/ssh/ssh-main.js src/ssh/ssh-terminal.js src/ssh/ssh-sftp.js
git commit -m "fix: 修复 getTauriEvent() 方法逻辑错误"
```

---

### Task 2: 初始化 SFTP 全局变量

**Files:**
- Modify: `src/ssh/ssh-sftp.js:28-50`

**Step 1: 在 SftpManager 构造函数末尾添加全局变量赋值**

```javascript
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
    window.sftpManager = this;  // 添加这行
}
```

**Step 2: Commit**

```bash
git add src/ssh/ssh-sftp.js
git commit -m "fix: 初始化 sftpManager 全局变量"
```

---

### Task 3: 修复事件监听器重复绑定

**Files:**
- Modify: `src/ssh/ssh-sftp.js:247-259`

**Step 1: 将事件绑定移到 init() 中，只绑定一次**

在 `init()` 方法中添加事件绑定，在 `renderRemoteFiles()` 中移除。

```javascript
// 在 bindEvents() 方法中添加远程列表的事件绑定
bindEvents() {
    // ... 现有代码 ...

    // 远程文件拖拽接收上传
    const remoteList = document.getElementById('sftp-remote-list');
    if (remoteList) {
        remoteList.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'copy';
        });
        remoteList.addEventListener('drop', (e) => {
            e.preventDefault();
            const localPath = e.dataTransfer.getData('local-path');
            if (localPath) {
                const fileName = localPath.split(/[/\\]/).pop();
                this.uploadFile(localPath, this.remotePath + '/' + fileName);
            }
        });
    }
}
```

从 `renderRemoteFiles()` 中移除重复的事件绑定代码（约 248-259 行）。

**Step 2: Commit**

```bash
git add src/ssh/ssh-sftp.js
git commit -m "fix: 修复 SFTP 事件监听器重复绑定"
```

---

### Task 4: 修复 get_connection_mut 方法

**Files:**
- Modify: `src-tauri/src/ssh/session.rs:166-170`

**Step 1: 删除无用的 get_connection_mut 方法**

这个方法名暗示返回可变引用，但实际返回克隆，容易误导。删除它，因为 `with_sftp` 已经正确处理了可变访问。

```rust
// 删除以下方法
/// 获取可变连接（用于需要修改session状态的操作，如SFTP）
pub async fn get_connection_mut(&self, connection_id: &str) -> Option<ActiveConnection> {
    let connections = self.connections.read().await;
    connections.get(connection_id).cloned()
}
```

**Step 2: Commit**

```bash
git add src-tauri/src/ssh/session.rs
git commit -m "refactor: 删除误导性的 get_connection_mut 方法"
```

---

### Task 5: 修复 PTY 和 SFTP 模式冲突

**Files:**
- Modify: `src-tauri/src/ssh/session.rs:172-201`

**Step 1: 改进 with_sftp 方法，确保模式切换的安全性**

```rust
/// 创建SFTP（自动处理阻塞模式切换）
/// 保持写锁直到操作完成
pub async fn with_sftp<F, T>(&self, connection_id: &str, f: F) -> Result<T, String>
where
    F: FnOnce(&ssh2::Sftp) -> Result<T, String>,
{
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

    result
}
```

**Step 2: Commit**

```bash
git add src-tauri/src/ssh/session.rs
git commit -m "fix: 确保 SFTP 操作后正确释放资源并恢复非阻塞模式"
```

---

### Task 6: 添加连接超时机制

**Files:**
- Modify: `src-tauri/src/ssh/session.rs:58-78`

**Step 1: 修改 connect 方法，添加超时**

```rust
use std::time::Duration;
use std::net::TcpStream;

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

    // 建立TCP连接（带超时）
    let addr = format!("{}:{}", session_config.host, session_config.port);
    let tcp = TcpStream::connect_timeout(
        &addr.parse().map_err(|e| format!("地址格式错误: {}", e))?,
        Duration::from_secs(10),  // 10秒超时
    ).map_err(|e| format!("连接失败 {}: {}", addr, e))?;

    // 设置读写超时
    tcp.set_read_timeout(Some(Duration::from_secs(30)))
        .map_err(|e| format!("设置读超时失败: {}", e))?;
    tcp.set_write_timeout(Some(Duration::from_secs(30)))
        .map_err(|e| format!("设置写超时失败: {}", e))?;

    // ... 其余代码保持不变
}
```

**Step 2: Commit**

```bash
git add src-tauri/src/ssh/session.rs
git commit -m "feat: 添加 SSH 连接超时机制（10秒连接超时，30秒读写超时）"
```

---

### Task 7: 清理 PTY 会话

**Files:**
- Modify: `src-tauri/src/ssh/session.rs:153-158`
- Modify: `src-tauri/src/commands.rs:3083-3089`

**Step 1: 在 disconnect 方法中清理 PTY 会话**

```rust
/// 断开连接
pub async fn disconnect(&self, connection_id: &str) -> Result<(), String> {
    // 清理 PTY 会话
    {
        let mut sessions = PTY_SESSIONS.write().await;
        sessions.remove(connection_id);
    }

    // 断开 SSH 连接
    let mut connections = self.connections.write().await;
    connections.remove(connection_id);
    Ok(())
}
```

**Step 2: Commit**

```bash
git add src-tauri/src/ssh/session.rs
git commit -m "fix: 断开连接时清理 PTY 会话，防止内存泄漏"
```

---

### Task 8: 添加连接数量限制

**Files:**
- Modify: `src-tauri/src/ssh/session.rs:46-56`
- Modify: `src-tauri/src/ssh/session.rs:58-78`

**Step 1: 添加最大连接数常量**

```rust
/// 最大并发连接数
const MAX_CONNECTIONS: usize = 10;

/// SSH连接管理器
pub struct SshConnectionManager {
    connections: Arc<RwLock<HashMap<String, ActiveConnection>>>,
}
```

**Step 2: 在 connect 方法中添加连接数检查**

```rust
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

    // ... 其余代码保持不变
}
```

**Step 3: Commit**

```bash
git add src-tauri/src/ssh/session.rs
git commit -m "feat: 添加最大连接数限制（10个）"
```

---

## 验证步骤

**Step 1: 编译检查**

```bash
cd src-tauri && cargo check
```

Expected: 无编译错误

**Step 2: 运行测试**

```bash
cd src-tauri && cargo test
```

Expected: 所有测试通过

**Step 3: 功能测试**

1. 启动应用 `npx tauri dev`
2. 测试 SSH 连接功能
3. 测试 SFTP 文件传输
4. 测试连接超时场景
5. 测试断开连接后资源是否正确清理

---

## 完成

所有修复完成后，创建最终 commit：

```bash
git add -A
git commit -m "fix: 修复 SSH 功能的 8 个 bug

- 修复 getTauriEvent() 方法逻辑错误
- 初始化 sftpManager 全局变量
- 修复 SFTP 事件监听器重复绑定
- 删除误导性的 get_connection_mut 方法
- 确保 SFTP 操作后正确释放资源
- 添加连接超时机制（10秒连接，30秒读写）
- 断开连接时清理 PTY 会话
- 添加最大连接数限制（10个）"
```
