# 版本更新通知功能实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 DevToolkit 添加版本更新通知功能，当有新版本发布时自动提醒用户

**Architecture:** 使用 Rust 后端调用 GitHub Releases API 检查更新，前端显示模态弹窗通知用户

**Tech Stack:** Tauri 2.0, Rust (reqwest), vanilla JavaScript

---

## 文件结构

| 文件 | 变更类型 | 说明 |
|------|----------|------|
| `src-tauri/src/updater.rs` | 新增 | 更新检查逻辑 |
| `src-tauri/src/lib.rs` | 修改 | 注册 check_update 命令 |
| `src/index.html` | 修改 | 添加更新弹窗 HTML 和手动检查按钮 |
| `src/app.js` | 修改 | 添加更新检查逻辑 |
| `src/styles.css` | 修改 | 添加更新弹窗样式 |
| `docs/PRODUCT.md` | 修改 | 更新隐私政策和功能说明 |
| `README.md` | 修改 | 添加版本更新特性说明 |

---

## Task 1: 创建 Rust 更新检查模块

**Files:**
- Create: `src-tauri/src/updater.rs`

- [ ] **Step 1: 创建 updater.rs 文件**

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

#[tauri::command]
pub async fn check_update() -> Result<UpdateInfo, String> {
    let current_version = env!("CARGO_PKG_VERSION");

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

    let release: GitHubRelease = resp
        .json()
        .await
        .map_err(|e| format!("解析响应失败: {}", e))?;

    let latest_version = release.tag_name.trim_start_matches('v');
    let has_update = compare_versions(current_version, latest_version);

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

- [ ] **Step 2: 验证文件创建成功**

Run: `ls -la src-tauri/src/updater.rs`
Expected: 文件存在

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/updater.rs
git commit -m "feat: 添加版本更新检查模块"
```

---

## Task 2: 注册 Tauri 命令

**Files:**
- Modify: `src-tauri/src/lib.rs:1-2`

- [ ] **Step 1: 添加 updater 模块声明**

在 `src-tauri/src/lib.rs` 文件开头添加：

```rust
mod commands;
mod database;
mod ssh;
mod updater;  // 新增这一行
```

- [ ] **Step 2: 注册 check_update 命令**

在 `invoke_handler` 中添加 `updater::check_update`：

```rust
.invoke_handler(tauri::generate_handler![
    // ... 现有命令保持不变
    // 在最后一行添加：
    updater::check_update,
])
```

- [ ] **Step 3: 验证编译通过**

Run: `cd src-tauri && cargo check`
Expected: 编译成功，无错误

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/lib.rs
git commit -m "feat: 注册 check_update 命令"
```

---

## Task 3: 添加更新弹窗 HTML

**Files:**
- Modify: `src/index.html`

- [ ] **Step 1: 添加手动检查按钮**

在侧边栏底部 `sidebar-footer` 中添加检查更新按钮：

找到：
```html
<div class="sidebar-footer">
    <span>v1.0.0</span>
</div>
```

替换为：
```html
<div class="sidebar-footer">
    <span>v1.0.0</span>
    <button id="btn-check-update" class="btn-check-update" title="检查更新">🔄</button>
</div>
```

- [ ] **Step 2: 添加更新弹窗 HTML**

在 `</body>` 标签前添加：

```html
<!-- 更新通知弹窗 -->
<div id="update-modal" class="modal">
    <div class="modal-content update-modal-content">
        <div class="modal-header">
            <h3>🆕 发现新版本 v<span id="update-version"></span></h3>
            <button class="modal-close" onclick="hideUpdateModal()">✕</button>
        </div>
        <div class="modal-body">
            <p class="update-current">当前版本：v<span id="current-version"></span></p>
            <div id="release-notes" class="release-notes"></div>
        </div>
        <div class="modal-footer">
            <button class="btn btn-ghost" onclick="hideUpdateModal()">稍后提醒</button>
            <button class="btn btn-ghost" onclick="ignoreUpdateVersion()">忽略此版本</button>
            <button class="btn btn-primary" onclick="openDownloadUrl()">跳转下载</button>
        </div>
    </div>
</div>
```

- [ ] **Step 3: 验证 HTML 结构**

Run: `grep -n "update-modal" src/index.html`
Expected: 找到更新弹窗相关代码

- [ ] **Step 4: Commit**

```bash
git add src/index.html
git commit -m "feat: 添加更新弹窗 HTML 和手动检查按钮"
```

---

## Task 4: 添加更新弹窗样式

**Files:**
- Modify: `src/styles.css`

- [ ] **Step 1: 添加更新弹窗样式**

在 `src/styles.css` 文件末尾添加：

```css
/* ===== 版本更新弹窗 ===== */
.update-modal-content {
    max-width: 500px;
    width: 90%;
}

.update-current {
    font-size: 13px;
    color: var(--text-secondary);
    margin-bottom: 12px;
}

.release-notes {
    background: var(--bg-input);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    padding: 12px;
    max-height: 200px;
    overflow-y: auto;
    font-size: 13px;
    line-height: 1.6;
    color: var(--text-primary);
    white-space: pre-wrap;
    word-break: break-word;
}

.release-notes h1,
.release-notes h2,
.release-notes h3 {
    font-size: 14px;
    font-weight: 600;
    margin: 8px 0 4px 0;
    color: var(--text-primary);
}

.release-notes h1:first-child,
.release-notes h2:first-child,
.release-notes h3:first-child {
    margin-top: 0;
}

.release-notes ul,
.release-notes ol {
    margin: 4px 0;
    padding-left: 20px;
}

.release-notes li {
    margin: 2px 0;
}

.release-notes code {
    background: var(--bg-secondary);
    padding: 1px 4px;
    border-radius: 3px;
    font-size: 12px;
}

.release-notes p {
    margin: 4px 0;
}

.btn-check-update {
    background: none;
    border: 1px solid var(--border);
    border-radius: 4px;
    color: var(--text-muted);
    cursor: pointer;
    padding: 2px 6px;
    font-size: 12px;
    transition: all var(--transition);
    line-height: 1;
}

.btn-check-update:hover {
    color: var(--text-primary);
    border-color: var(--accent);
}
```

- [ ] **Step 2: 验证样式添加成功**

Run: `grep -n "update-modal-content" src/styles.css`
Expected: 找到更新弹窗样式

- [ ] **Step 3: Commit**

```bash
git add src/styles.css
git commit -m "feat: 添加更新弹窗样式"
```

---

## Task 5: 添加前端更新检查逻辑

**Files:**
- Modify: `src/app.js`

- [ ] **Step 1: 添加 markdown 简单解析函数**

在 `app.js` 文件末尾添加：

```javascript
// ==================== 版本更新检查 ====================
function simpleMarkdownToHtml(md) {
    if (!md) return '';
    let html = escapeHtml(md);
    // 标题
    html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
    html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
    html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');
    // 粗体
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    // 行内代码
    html = html.replace(/`(.+?)`/g, '<code>$1</code>');
    // 无序列表
    html = html.replace(/^[*-] (.+)$/gm, '<li>$1</li>');
    html = html.replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>');
    // 有序列表
    html = html.replace(/^\d+\. (.+)$/gm, '<li>$1</li>');
    // 换行
    html = html.replace(/\n\n/g, '</p><p>');
    html = '<p>' + html + '</p>';
    return html;
}
```

- [ ] **Step 2: 添加更新弹窗控制函数**

```javascript
let updateInfoCache = null;

function showUpdateModal(updateInfo) {
    updateInfoCache = updateInfo;
    document.getElementById('update-version').textContent = updateInfo.latest_version;
    document.getElementById('current-version').textContent = updateInfo.current_version;
    document.getElementById('release-notes').innerHTML = simpleMarkdownToHtml(updateInfo.release_notes);
    document.getElementById('update-modal').classList.add('active');
}

function hideUpdateModal() {
    document.getElementById('update-modal').classList.remove('active');
    updateInfoCache = null;
}

function ignoreUpdateVersion() {
    if (updateInfoCache) {
        localStorage.setItem('ignoredUpdateVersion', updateInfoCache.latest_version);
    }
    hideUpdateModal();
}

async function openDownloadUrl() {
    if (updateInfoCache) {
        const { openUrl } = window.__TAURI__.opener;
        await openUrl(updateInfoCache.download_url);
    }
    hideUpdateModal();
}
```

- [ ] **Step 3: 添加启动时检查函数**

```javascript
async function checkUpdateOnStartup() {
    try {
        const updateInfo = await invoke('check_update');
        if (updateInfo.has_update) {
            const ignoredVersion = localStorage.getItem('ignoredUpdateVersion');
            if (ignoredVersion !== updateInfo.latest_version) {
                showUpdateModal(updateInfo);
            }
        }
    } catch (error) {
        console.log('更新检查失败:', error);
    }
}
```

- [ ] **Step 4: 添加手动检查函数**

```javascript
async function checkUpdateManually() {
    try {
        const updateInfo = await invoke('check_update');
        if (updateInfo.has_update) {
            showUpdateModal(updateInfo);
        } else {
            alert('已是最新版本 v' + updateInfo.current_version);
        }
    } catch (error) {
        alert('检查更新失败: ' + error);
    }
}
```

- [ ] **Step 5: 在 DOMContentLoaded 中调用启动检查**

在已有的 `document.addEventListener('DOMContentLoaded', ...)` 回调末尾添加：

```javascript
// 检查版本更新
setTimeout(checkUpdateOnStartup, 2000);
```

- [ ] **Step 6: 绑定手动检查按钮事件**

```javascript
// 绑定检查更新按钮
document.getElementById('btn-check-update')?.addEventListener('click', checkUpdateManually);
```

- [ ] **Step 7: 验证代码添加成功**

Run: `grep -n "checkUpdateOnStartup" src/app.js`
Expected: 找到更新检查函数

- [ ] **Step 8: Commit**

```bash
git add src/app.js
git commit -m "feat: 添加前端更新检查逻辑"
```

---

## Task 6: 更新产品文档

**Files:**
- Modify: `docs/PRODUCT.md`

- [ ] **Step 1: 更新隐私政策**

找到：
```
- ✅ **完全离线**：无需网络，所有计算在本地完成
```

替换为：
```
- ✅ **本地优先**：所有计算在本地完成，仅版本检查时访问 GitHub API
```

- [ ] **Step 2: 添加版本更新功能说明**

在"通用功能"部分之前添加：

```markdown
### 🆕 版本更新检查

自动检查是否有新版本发布，及时获取最新功能和修复。

| 功能 | 说明 |
|------|------|
| 启动检查 | 应用启动时自动检查新版本 |
| 手动检查 | 点击侧边栏底部 🔄 按钮手动检查 |
| 版本忽略 | 可选择忽略特定版本，不再提示 |
| 更新日志 | 显示新版本的更新内容 |
| 跳转下载 | 点击后打开 GitHub Releases 页面 |

---
```

- [ ] **Step 3: Commit**

```bash
git add docs/PRODUCT.md
git commit -m "docs: 更新产品文档，添加版本更新功能说明"
```

---

## Task 7: 更新 README

**Files:**
- Modify: `README.md`

- [ ] **Step 1: 添加版本更新特性**

在"特性"部分添加：

```markdown
- 🆕 **版本更新**：自动检查新版本，一键跳转下载
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: 更新 README，添加版本更新特性说明"
```

---

## Task 8: 整体测试

- [ ] **Step 1: 编译项目**

Run: `cd src-tauri && cargo build`
Expected: 编译成功

- [ ] **Step 2: 启动开发模式**

Run: `npx tauri dev`
Expected: 应用正常启动

- [ ] **Step 3: 测试手动检查更新**

1. 点击侧边栏底部的 🔄 按钮
2. 验证弹窗显示或"已是最新版本"提示

- [ ] **Step 4: 测试启动时自动检查**

1. 关闭应用
2. 重新启动应用
3. 等待 2 秒，验证是否显示更新弹窗（如果有新版本）

- [ ] **Step 5: 测试忽略版本功能**

1. 如果显示更新弹窗，点击"忽略此版本"
2. 重新启动应用
3. 验证不再显示该版本的更新提示

- [ ] **Step 6: 测试跳转下载功能**

1. 如果显示更新弹窗，点击"跳转下载"
2. 验证浏览器打开 GitHub Releases 页面

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: 完成版本更新通知功能"
```

---

## 自审查清单

- [x] **Spec coverage:** 所有设计文档中的需求都已覆盖
- [x] **Placeholder scan:** 没有 TBD、TODO 或不完整的部分
- [x] **Type consistency:** 类型、方法签名、属性名称在各任务中一致
