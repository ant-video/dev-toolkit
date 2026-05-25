# 版本更新通知功能设计文档

> 日期：2026-05-25
> 状态：设计完成，待实现

---

## 概述

为 DevToolkit 添加版本更新通知功能，当有新版本发布时自动提醒用户，并提供跳转下载功能。

**核心需求**：
- 更新源：GitHub Releases API
- 检查时机：启动时自动检查 + 手动检查
- 通知形式：模态弹窗
- 下载方式：跳转浏览器到 GitHub Releases 页面

---

## 架构设计

```
┌─────────────────────────────────────────────────────────────┐
│  Frontend (app.js)                                          │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐  │
│  │ 启动时调用    │  │ 手动检查按钮 │  │ 更新弹窗 UI      │  │
│  │ check_update │  │ check_update │  │ 显示版本/日志/下载│  │
│  └──────┬───────┘  └──────┬───────┘  └──────────────────┘  │
│         │                 │                                 │
│         └────────┬────────┘                                 │
│                  ▼                                          │
│         invoke('check_update')                              │
└──────────────────┬──────────────────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────────────────┐
│  Rust Backend (commands.rs + updater.rs)                    │
│  ┌──────────────────────────────────────────────────────┐  │
│  │ check_update() -> Result<UpdateInfo, String>         │  │
│  │  1. GET https://api.github.com/repos/{owner}/{repo}/ │  │
│  │     releases/latest                                   │  │
│  │  2. 解析 JSON，提取 tag_name, body, html_url         │  │
│  │  3. 比较版本号 (semver)                               │  │
│  │  4. 返回 UpdateInfo                                  │  │
│  └──────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

---

## Rust 后端实现

### 新增文件

`src-tauri/src/updater.rs`

### 核心结构体

```rust
use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Clone)]
pub struct UpdateInfo {
    pub has_update: bool,
    pub current_version: String,
    pub latest_version: String,
    pub release_notes: String,
    pub download_url: String,
    pub checked_at: String,
}

#[derive(Deserialize)]
struct GitHubRelease {
    tag_name: String,
    body: Option<String>,
    html_url: String,
    prerelease: bool,
}
```

### 核心命令

```rust
#[tauri::command]
pub async fn check_update() -> Result<UpdateInfo, String> {
    // 1. 从 tauri.conf.json 读取当前版本
    let current_version = env!("CARGO_PKG_VERSION");

    // 2. 调用 GitHub API
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| e.to_string())?;

    let resp = client
        .get("https://api.github.com/repos/ant-video/dev-toolkit/releases/latest")
        .header("User-Agent", "DevToolkit-UpdateChecker")
        .send()
        .await
        .map_err(|e| format!("网络请求失败: {}", e))?;

    // 3. 解析响应
    let release: GitHubRelease = resp
        .json()
        .await
        .map_err(|e| format!("解析响应失败: {}", e))?;

    // 4. 比较版本号
    let latest_version = release.tag_name.trim_start_matches('v');
    let has_update = compare_versions(current_version, latest_version);

    // 5. 返回结果
    Ok(UpdateInfo {
        has_update,
        current_version: current_version.to_string(),
        latest_version: latest_version.to_string(),
        release_notes: release.body.unwrap_or_default(),
        download_url: release.html_url,
        checked_at: chrono::Local::now().to_rfc3339(),
    })
}
```

### 版本比较函数

```rust
fn compare_versions(current: &str, latest: &str) -> bool {
    let current_parts: Vec<u32> = current
        .split('.')
        .filter_map(|s| s.parse().ok())
        .collect();
    let latest_parts: Vec<u32> = latest
        .split('.')
        .filter_map(|s| s.parse().ok())
        .collect();

    for i in 0..3 {
        let c = current_parts.get(i).unwrap_or(&0);
        let l = latest_parts.get(i).unwrap_or(&0);
        if l > c {
            return true;
        }
        if l < c {
            return false;
        }
    }
    false
}
```

### 注册命令

在 `lib.rs` 的 `invoke_handler` 中添加：
```rust
.invoke_handler(tauri::generate_handler![
    // ... 现有命令
    updater::check_update,
])
```

---

## 前端 UI 实现

### 1. 启动时检查 (app.js)

```javascript
async function checkUpdateOnStartup() {
    try {
        const updateInfo = await invoke('check_update');
        if (updateInfo.has_update) {
            const ignoredVersion = localStorage.getItem('ignoredVersion');
            if (ignoredVersion !== updateInfo.latest_version) {
                showUpdateModal(updateInfo);
            }
        }
    } catch (error) {
        console.log('更新检查失败:', error);
    }
}

// 在应用初始化时调用
document.addEventListener('DOMContentLoaded', () => {
    checkUpdateOnStartup();
});
```

### 2. 手动检查按钮 (index.html)

位置：标题栏右侧，设置图标旁边

```html
<button id="btn-check-update" class="toolbar-btn" title="检查更新">
    <span class="update-icon">🔄</span>
</button>
```

### 3. 更新弹窗 HTML

```html
<div id="update-modal" class="modal hidden">
    <div class="modal-content update-modal">
        <h3>🆕 发现新版本 v<span id="update-version"></span></h3>
        <div class="update-info">
            <p>当前版本：v<span id="current-version"></span></p>
            <div id="release-notes" class="release-notes"></div>
        </div>
        <div class="modal-actions">
            <button id="btn-dismiss" class="btn-secondary">稍后提醒</button>
            <button id="btn-ignore-version" class="btn-secondary">忽略此版本</button>
            <button id="btn-download" class="btn-primary">跳转下载</button>
        </div>
    </div>
</div>
```

### 4. 弹窗逻辑 (app.js)

```javascript
function showUpdateModal(updateInfo) {
    document.getElementById('update-version').textContent = updateInfo.latest_version;
    document.getElementById('current-version').textContent = updateInfo.current_version;
    document.getElementById('release-notes').innerHTML = markdownToHtml(updateInfo.release_notes);

    document.getElementById('btn-dismiss').onclick = () => hideUpdateModal();
    document.getElementById('btn-ignore-version').onclick = () => {
        localStorage.setItem('ignoredVersion', updateInfo.latest_version);
        hideUpdateModal();
    };
    document.getElementById('btn-download').onclick = async () => {
        // 使用 Tauri opener 插件打开外部 URL
        const { openUrl } = window.__TAURI__.opener;
        await openUrl(updateInfo.download_url);
        hideUpdateModal();
    };

    document.getElementById('update-modal').classList.remove('hidden');
}

function hideUpdateModal() {
    document.getElementById('update-modal').classList.add('hidden');
}
```

### 5. 手动检查逻辑

```javascript
document.getElementById('btn-check-update').addEventListener('click', async () => {
    try {
        const updateInfo = await invoke('check_update');
        if (updateInfo.has_update) {
            showUpdateModal(updateInfo);
        } else {
            showToast('已是最新版本 v' + updateInfo.current_version);
        }
    } catch (error) {
        showToast('检查更新失败: ' + error, 'error');
    }
});
```

---

## 错误处理

| 场景 | 处理方式 |
|------|----------|
| 网络不可用 | 启动时：静默失败<br>手动检查：显示"网络不可用"提示 |
| GitHub API 限流 | 显示"检查过于频繁，请稍后再试" |
| 响应解析失败 | 显示"版本信息获取失败" |
| 超时 (10秒) | 显示"网络超时，请检查网络连接" |
| 当前版本已是最新 | 手动检查时显示"已是最新版本 v1.x.x" |
| 版本号格式异常 | 跳过该版本，不显示更新 |
| Release 无下载链接 | 只显示版本信息，隐藏"跳转下载"按钮 |

---

## 样式设计

### 更新弹窗样式

```css
.update-modal {
    max-width: 500px;
    padding: 24px;
}

.update-modal h3 {
    margin: 0 0 16px 0;
    font-size: 18px;
    color: #f8f8f2;
}

.update-info {
    margin-bottom: 20px;
}

.release-notes {
    margin-top: 12px;
    padding: 12px;
    background: #282a36;
    border-radius: 4px;
    max-height: 200px;
    overflow-y: auto;
    font-size: 14px;
    line-height: 1.5;
}

.modal-actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
}

.btn-primary {
    background: #50fa7b;
    color: #282a36;
    border: none;
    padding: 8px 16px;
    border-radius: 4px;
    cursor: pointer;
}

.btn-secondary {
    background: #44475a;
    color: #f8f8f2;
    border: none;
    padding: 8px 16px;
    border-radius: 4px;
    cursor: pointer;
}
```

---

## 产品文档更新

### docs/PRODUCT.md

移除：
```
- ✅ **完全离线**：无需网络，所有计算在本地完成
```

添加：
```
- ✅ **本地优先**：所有计算在本地完成，仅版本检查时访问 GitHub API
```

添加功能说明：
```
### 🆕 版本更新检查

自动检查是否有新版本发布，及时获取最新功能和修复。

| 功能 | 说明 |
|------|------|
| 启动检查 | 应用启动时自动检查新版本 |
| 手动检查 | 点击标题栏 🔄 按钮手动检查 |
| 版本忽略 | 可选择忽略特定版本，不再提示 |
| 更新日志 | 显示新版本的更新内容 |
| 跳转下载 | 点击后打开 GitHub Releases 页面 |
```

### README.md

在特性列表添加：
```
- 🆕 **版本更新**：自动检查新版本，一键跳转下载
```

---

## 文件变更清单

| 文件 | 变更类型 | 说明 |
|------|----------|------|
| `src-tauri/src/updater.rs` | 新增 | 更新检查逻辑 |
| `src-tauri/src/lib.rs` | 修改 | 注册 check_update 命令 |
| `src-tauri/Cargo.toml` | 修改 | 可能需要添加依赖（已有 reqwest） |
| `src/index.html` | 修改 | 添加更新弹窗 HTML 和手动检查按钮 |
| `src/app.js` | 修改 | 添加更新检查逻辑 |
| `src/styles.css` | 修改 | 添加更新弹窗样式 |
| `docs/PRODUCT.md` | 修改 | 更新隐私政策和功能说明 |
| `README.md` | 修改 | 添加版本更新特性说明 |

---

## 不在范围内

以下功能暂不实现，可作为后续扩展：

- 自动下载更新包
- 应用内安装更新
- 更新源配置化
- 增量更新
- 更新回滚机制
