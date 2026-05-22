# SSH可视化连接工具设计方案

## 一、整体架构

```
┌─────────────────────────────────────────────────────────────┐
│                    DevToolkit Application                    │
├──────────────┬──────────────────────────────────────────────┤
│              │  ┌─────────────────────────────────────────┐ │
│   SSH导航    │  │         工作区（标签页容器）              │ │
│   ┌────────┐│  │  ┌─────────┬─────────┬─────────┬──────┐ │ │
│   │会话列表││  │  │终端标签1 │终端标签2 │SFTP标签 │监控  │ │ │
│   ├────────┤│  │  └─────────┴─────────┴─────────┴──────┘ │ │
│   │快速连接││  │                                            │ │
│   ├────────┤│  │  ┌─────────────────────────────────────┐ │ │
│   │分组管理││  │  │                                      │ │ │
│   │  - 生产││  │  │        当前标签内容区域              │ │ │
│   │  - 测试││  │  │                                      │ │ │
│   │  - 开发││  │  │                                      │ │ │
│   └────────┘│  │  └─────────────────────────────────────┘ │ │
└──────────────┴──────────────────────────────────────────────┘
```

### 核心设计理念

- **左侧边栏**：会话管理树（可折叠分组）、快速连接按钮、搜索框
- **右侧工作区**：多标签页容器，每个标签对应一个SSH会话/SFTP/监控面板
- **状态持久化**：会话配置保存到本地JSON文件，支持导入导出

## 二、前端设计

### 2.1 页面结构

新增 `src/ssh/` 目录，SSH工具相关前端资源：

```html
<section id="page-ssh" class="page">
  <!-- 左侧边栏 -->
  <div class="ssh-sidebar">
    <div class="ssh-search-box">
      <input type="text" placeholder="搜索会话...">
    </div>
    <div class="ssh-session-tree">
      <!-- 会话分组树 -->
    </div>
    <div class="ssh-quick-actions">
      <button class="btn-quick-connect">+ 快速连接</button>
    </div>
  </div>

  <!-- 右侧工作区 -->
  <div class="ssh-workspace">
    <div class="ssh-tabs">
      <!-- 标签页栏 -->
    </div>
    <div class="ssh-content">
      <!-- 当前标签内容 -->
    </div>
  </div>
</section>
```

### 2.2 核心组件

**1. 终端组件** (`ssh-terminal.js`)
- 集成 xterm.js + xterm-addon-fit（自适应尺寸）
- xterm-addon-search（搜索功能）
- xterm-addon-web-links（链接识别）
- 支持分屏：左右/上下/四分屏
- 右键菜单：复制/粘贴/重新连接/上传下载

**2. SFTP文件管理器** (`ssh-sftp.js`)
- 双栏布局（本地/远程）
- 树形目录 + 文件列表
- 拖拽上传下载
- 进度条显示
- 文件编辑器（复用CodeMirror）

**3. 系统监控面板** (`ssh-monitor.js`)
- 实时图表（CPU/内存/磁盘/网络）
- 进程列表（可排序、搜索、kill）
- Docker容器卡片
- 快捷命令面板

**4. 会话管理组件** (`ssh-sessions.js`)
- 树形分组展示
- 拖拽排序
- 右键菜单：编辑/复制/删除/导出
- 连接状态图标

### 2.3 样式设计

沿用 DevToolkit 的 Dracula 暗色主题，新增：
- `.ssh-*` 系列样式类
- 终端配色方案（可自定义）
- 文件管理器图标（SVG内联）
- 监控图表渐变色

## 三、后端设计（Rust）

### 3.1 新增依赖

```toml
# SSH核心
ssh2 = "0.9"
tokio = { version = "1", features = ["rt-multi-thread", "macros", "io-util", "process"] }

# 监控数据解析
sysinfo = "0.30"

# 已有依赖复用
# chrono, dirs, uuid, rand, base64, aes-gcm, serde, serde_json...
```

### 3.2 模块结构

```
src-tauri/src/
├── ssh/
│   ├── mod.rs           # 模块入口
│   ├── session.rs       # SSH会话管理（连接/断开/重连）
│   ├── channel.rs       # SSH Channel管理（终端/SFTP）
│   ├── sftp.rs          # SFTP文件操作
│   ├── monitor.rs       # 系统监控数据采集
│   ├── pty.rs           # PTY终端交互
│   ├── config.rs        # 会话配置管理（CRUD/导入导出）
│   └── types.rs         # 类型定义
├── commands.rs          # 新增SSH相关命令
├── lib.rs               # 注册新命令
└── main.rs
```

### 3.3 核心数据结构

```rust
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
    pub description: String,
    pub tags: Vec<String>,
    pub proxy: Option<ProxyConfig>,
    pub terminal: TerminalConfig,
    pub created_at: String,
    pub updated_at: String,
}

/// 认证方式
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum AuthType {
    Password { password: String },
    PrivateKey { key_path: String, passphrase: Option<String> },
    KeyboardInteractive,
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

/// 系统监控数据
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MonitorData {
    pub cpu_usage: Vec<f32>,
    pub memory: MemoryInfo,
    pub disk: Vec<DiskInfo>,
    pub network: NetworkInfo,
    pub uptime: u64,
    pub load_avg: [f32; 3],
}

/// SFTP文件信息
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SftpFileInfo {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub size: u64,
    pub permissions: u32,
    pub modified: String,
    pub owner: String,
    pub group: String,
}
```

### 3.4 Tauri命令设计

```rust
// === 会话配置管理 ===
ssh_list_sessions()         -> Result<Vec<SshSession>, String>
ssh_save_session(session)   -> Result<SshSession, String>
ssh_delete_session(id)      -> Result<(), String>
ssh_test_connection(session)-> Result<bool, String>
ssh_import_sessions(json)   -> Result<Vec<SshSession>, String>
ssh_export_sessions(ids)    -> Result<String, String>

// === SSH连接管理 ===
ssh_connect(session_id)     -> Result<String, String>  // 返回连接ID
ssh_disconnect(id)          -> Result<(), String>
ssh_resize_pty(id, cols, rows) -> Result<(), String>

// === SFTP操作 ===
ssh_sftp_list_dir(id, path)    -> Result<Vec<SftpFileInfo>, String>
ssh_sftp_download(id, remote, local) -> Result<(), String>
ssh_sftp_upload(id, local, remote)   -> Result<(), String>
ssh_sftp_delete(id, path)      -> Result<(), String>
ssh_sftp_rename(id, old, new)  -> Result<(), String>
ssh_sftp_mkdir(id, path)       -> Result<(), String>
ssh_sftp_chmod(id, path, mode) -> Result<(), String>
ssh_sftp_read_file(id, path)   -> Result<String, String>
ssh_sftp_write_file(id, path, content) -> Result<(), String>

// === 系统监控 ===
ssh_monitor_start(id)          -> Result<(), String>
ssh_monitor_stop(id)           -> Result<(), String>
ssh_monitor_data(id)           -> Result<MonitorData, String>
ssh_monitor_processes(id)      -> Result<Vec<ProcessInfo>, String>
ssh_monitor_kill_process(id, pid) -> Result<(), String>

// === Docker管理 ===
ssh_docker_list(id)            -> Result<Vec<DockerContainer>, String>
ssh_docker_logs(id, cid, lines)-> Result<String, String>
ssh_docker_action(id, cid, action) -> Result<(), String>
```

### 3.5 通信机制

**终端数据流**：
```
前端 xterm.js  <-->  Tauri Event  <-->  Rust SSH Channel  <-->  远程服务器
     |                   |                   |
  onData()          emit/listen          ssh2 channel
  (键盘输入)        (双向事件流)          read/write
```

- **前端->后端**：通过 `invoke("ssh_write", { id, data })` 发送键盘输入
- **后端->前端**：通过 `app.emit("ssh-output-{id}", data)` 推送终端输出
- **监控数据**：后端定时轮询，通过事件推送至前端

## 四、关键实现细节

### 4.1 终端数据流

**前端实现**：
```javascript
class SshTerminal {
  constructor(connectionId, container) {
    this.term = new Terminal({
      fontSize: 14,
      fontFamily: 'Monaco, Menlo, "Courier New", monospace',
      theme: draculaTheme,
      cursorBlink: true,
    });

    this.term.open(container);
    this.fitAddon = new FitAddon();
    this.term.loadAddon(this.fitAddon);
    this.fitAddon.fit();

    // 用户输入 -> 后端
    this.term.onData(data => {
      invoke('ssh_write', { connectionId, data });
    });

    // 后端输出 -> 终端
    listen(`ssh-output-${connectionId}`, event => {
      this.term.write(event.payload);
    });

    // 窗口resize
    window.addEventListener('resize', () => {
      this.fitAddon.fit();
      invoke('ssh_resize_pty', {
        connectionId,
        cols: this.term.cols,
        rows: this.term.rows
      });
    });
  }
}
```

**后端实现**：
```rust
pub struct SshChannel {
    channel: ssh2::Channel,
    output_tx: tokio::sync::broadcast::Sender<Vec<u8>>,
}

impl SshChannel {
    pub async fn start_read_loop(&self) {
        let mut buf = [0u8; 4096];
        loop {
            match self.channel.read(&mut buf) {
                Ok(n) if n > 0 => {
                    let _ = self.output_tx.send(buf[..n].to_vec());
                }
                Ok(_) => break,
                Err(e) => {
                    log::error!("SSH read error: {}", e);
                    break;
                }
            }
        }
    }

    pub fn write(&self, data: &[u8]) -> Result<(), String> {
        self.channel.write_all(data)
            .map_err(|e| e.to_string())
    }
}
```

### 4.2 SFTP文件传输进度

```rust
#[derive(Clone, Serialize)]
pub struct TransferProgress {
    pub transfer_id: String,
    pub filename: String,
    pub total_bytes: u64,
    pub transferred_bytes: u64,
    pub speed: f64,
    pub status: TransferStatus,
}

async fn transfer_with_progress(
    sftp: &ssh2::Sftp,
    src: &Path,
    dst: &Path,
    app: &AppHandle,
    transfer_id: &str,
) -> Result<(), String> {
    // 分块传输，每100ms推送一次进度事件
    // app.emit("sftp-progress", progress)?;
}
```

### 4.3 系统监控数据采集

通过SSH执行命令获取监控数据：
- CPU: `cat /proc/stat | grep '^cpu '`
- 内存: `cat /proc/meminfo`
- 磁盘: `df -h`
- 网络: `cat /proc/net/dev`
- 进程: `ps aux --sort=-%cpu | head -50`
- Docker: `docker ps -a --format '{{json .}}'`

### 4.4 会话配置加密存储

使用AES-256-GCM加密密码字段：
- 32字节密钥 + 随机12字节nonce
- Base64编码存储
- 格式：`base64(nonce || ciphertext)`

### 4.5 分屏终端

支持4种布局模式：
- single: 单终端
- horizontal: 左右分屏
- vertical: 上下分屏
- quad: 四分屏

## 五、文件结构

```
dev-toolkit/
├── src/
│   ├── index.html
│   ├── app.js
│   ├── styles.css
│   ├── ssh/
│   │   ├── ssh-main.js
│   │   ├── ssh-sessions.js
│   │   ├── ssh-terminal.js
│   │   ├── ssh-sftp.js
│   │   ├── ssh-monitor.js
│   │   └── ssh-utils.js
│   ├── xterm/               # xterm.js minified文件
│   └── codemirror/
│
├── src-tauri/
│   ├── src/
│   │   ├── main.rs
│   │   ├── lib.rs
│   │   ├── commands.rs
│   │   └── ssh/
│   │       ├── mod.rs
│   │       ├── types.rs
│   │       ├── session.rs
│   │       ├── channel.rs
│   │       ├── pty.rs
│   │       ├── sftp.rs
│   │       ├── monitor.rs
│   │       ├── config.rs
│   │       └── crypto.rs
│   └── Cargo.toml
│
└── docs/plans/
    └── 2026-05-22-ssh-tool-design.md
```

## 六、技术栈

| 层级 | 技术 | 用途 |
|------|------|------|
| 终端 | xterm.js ^5.3.0 | 终端模拟器 |
| 终端插件 | xterm-addon-fit ^0.8.0 | 自适应尺寸 |
| 终端插件 | xterm-addon-search ^0.13.0 | 终端搜索 |
| 终端插件 | xterm-addon-web-links ^0.9.0 | URL识别 |
| 编辑器 | CodeMirror 5 | 远程文件编辑 |
| SSH协议 | ssh2 0.9 | SSH/SFTP实现 |
| 异步运行时 | tokio 1.x | 异步IO |
| 加密 | aes-gcm 0.10 | 密码加密 |

## 七、开发步骤

```
Phase 1: 基础架构（2-3天）
├── 添加依赖（ssh2, xterm.js等）
├── 创建文件结构
├── 定义数据类型
└── 实现配置存储加密

Phase 2: 会话管理（1-2天）
├── 会话配置CRUD
├── 会话列表UI（树形分组）
├── 快速连接对话框
└── 导入导出功能

Phase 3: SSH终端（3-4天）
├── SSH连接/断开
├── xterm.js集成
├── 双向数据流（输入/输出）
├── PTY resize处理
└── 分屏功能

Phase 4: SFTP文件管理（3-4天）
├── SFTP基础操作
├── 双栏文件管理器UI
├── 拖拽上传下载
├── 传输进度显示
└── 远程文件编辑

Phase 5: 系统监控（2-3天）
├── 监控数据采集
├── 性能图表UI
├── 进程管理
└── Docker管理

Phase 6: 优化完善（1-2天）
├── 错误处理
├── 重连机制
├── 快捷键
└── 测试验证
```

预估总工期：12-18天
