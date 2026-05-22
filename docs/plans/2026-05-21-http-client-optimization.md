# HTTP 请求功能优化 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 按优先级为 HTTP 客户端新增环境变量、Auth 模块、历史搜索、超时配置、大响应保护、图片预览，并修复 cURL 导出 bug。

**Architecture:** 全部改动限于前端三文件（`src/index.html`、`src/app.js`、`src/styles.css`）和 Rust 后端（`src-tauri/src/commands.rs`）。环境变量和 Auth 作为新 Tab 插入已有 Tab 栏；Rust 侧只需新增图片响应 base64 字段。所有新状态持久化到 localStorage（env vars）或已有 Tauri file store（无新增 Tauri 命令，除图片预览外）。

**Tech Stack:** Tauri 2.0、Rust + reqwest、原生 JS、CodeMirror 5、localStorage

---

## 任务总览（按优先级）

| # | 优先级 | 功能 | 难度 | 预计时间 |
|---|--------|------|------|----------|
| 1 | 低(先做) | 修复 cURL 导出 bug | 极低 | 5min |
| 2 | 中 | 超时可配置 UI | 低 | 10min |
| 3 | 低 | 历史记录搜索 | 低 | 20min |
| 4 | 中 | 认证模块 Auth Tab | 中 | 40min |
| 5 | 高 | 环境变量 / 变量替换 | 中 | 60min |
| 6 | 高 | 大响应保护（截断+提示） | 低 | 20min |
| 7 | 高 | 图片响应预览 | 中 | 40min |
| 8 | 中 | 多 Tab 并行请求 | 高 | 跳过（复杂度过高，影响整体布局架构） |
| 9 | 高 | 请求集合 Collection | 高 | 跳过（现有收藏+文件夹已覆盖核心场景） |
| 10 | 中 | 前置/后置脚本 | 高 | 跳过（需沙箱 JS 执行引擎，超出当前范围） |

---

## Task 1: 修复 cURL 导出 bug

**问题定位：** `app.js:2745` 调用了 `getKvPairs('http-headers-kv')`，该函数不过滤未勾选的 header checkbox，导致导出时包含被禁用的 header。应改为 `getHeaderPairs()`（已有函数，会跳过未勾选行）。

**Files:**
- Modify: `src/app.js:2745`

**Step 1: 定位并修复**

找到 `src/app.js` 第 2745 行：
```js
// 改前
const headers = getKvPairs('http-headers-kv');
// 改后
const headers = getHeaderPairs();
```

**Step 2: 验证**
- `npx tauri dev` 打开应用
- 在 Headers 里添加两条，勾掉其中一条
- 点击「导出 cURL」，确认被禁用的 header 不在输出中

**Step 3: Commit**
```bash
git add src/app.js
git commit -m "fix(http): 修复 cURL 导出时包含已禁用 header 的 bug"
```

---

## Task 2: 超时可配置 UI

**问题定位：** `sendHttpRequest()`（`app.js:2972`）硬编码 `timeout: 30`，用户无法调整。

**Files:**
- Modify: `src/index.html:127`（action bar 末尾加超时输入）
- Modify: `src/app.js:2972`（读取 UI 值）
- Modify: `src/styles.css`（加 `.http-timeout-input` 样式）

**Step 1: 在 HTML action bar 末尾添加超时输入**

在 `src/index.html` 第 127 行（`<button id="http-float-btn"...` 之后）插入：
```html
<span class="http-action-separator"></span>
<label class="http-timeout-label">超时</label>
<input type="number" id="http-timeout" class="http-timeout-input" value="30" min="1" max="300" title="请求超时（秒）">
<span style="color:var(--text-secondary);font-size:12px">s</span>
```

**Step 2: 在 styles.css 末尾 HTTP 相关区域添加样式**

找到 `.http-action-bar` 样式附近，追加：
```css
.http-timeout-label {
    color: var(--text-secondary);
    font-size: 12px;
    white-space: nowrap;
}
.http-timeout-input {
    width: 48px;
    background: var(--bg-tertiary);
    border: 1px solid var(--border);
    border-radius: 4px;
    color: var(--text-primary);
    font-size: 12px;
    padding: 2px 6px;
    text-align: center;
}
.http-timeout-input::-webkit-inner-spin-button { opacity: 0.5; }
```

**Step 3: 修改 sendHttpRequest() 读取超时值**

`app.js:2972`，修改 invoke 调用：
```js
// 改前
req: { method, url: finalUrl, headers, body_type: bodyType, body, timeout: 30 }
// 改后
const timeout = parseInt(document.getElementById('http-timeout').value, 10) || 30;
req: { method, url: finalUrl, headers, body_type: bodyType, body, timeout }
```

同时更新历史记录保存处（`app.js:3020`）：
```js
// 改前
request: { method, url: finalUrl, headers, body_type: bodyType, body, timeout: 30 },
// 改后
request: { method, url: finalUrl, headers, body_type: bodyType, body, timeout },
```

**Step 4: 验证**
- 改超时为 2 秒，请求一个慢接口，应报"请求超时"
- 改回 30 秒，正常请求应成功

**Step 5: Commit**
```bash
git add src/index.html src/app.js src/styles.css
git commit -m "feat(http): 新增超时时间配置 UI"
```

---

## Task 3: 历史记录搜索/过滤

**问题定位：** `renderHttpPanelList()`（`app.js:3055`）展示全量条目，无法过滤。Panel header 需要加搜索框。

**Files:**
- Modify: `src/index.html:244-256`（历史面板 header 加搜索框）
- Modify: `src/app.js:3055`（renderHttpPanelList 加过滤逻辑）
- Modify: `src/styles.css`（搜索框样式）

**Step 1: 在历史面板 header 加搜索输入框**

在 `src/index.html` 第 253 行（`<div class="http-panel-folders"` 之前）插入：
```html
<div class="http-panel-search-wrap">
    <input type="text" id="http-panel-search" class="http-panel-search" 
           placeholder="搜索 URL 或名称..." autocomplete="off"
           oninput="renderHttpPanelList()">
</div>
```

**Step 2: 修改 renderHttpPanelList() 加过滤逻辑**

在 `app.js:3057`（`let entries = ...` 赋值后）插入过滤：
```js
// 过滤逻辑（加在 entries 赋值之后，folder filter 之前）
const searchQuery = (document.getElementById('http-panel-search')?.value || '').toLowerCase().trim();
if (searchQuery) {
    entries = entries.filter(e => {
        const url = (e.request.url || '').toLowerCase();
        const name = (e.name || '').toLowerCase();
        return url.includes(searchQuery) || name.includes(searchQuery);
    });
}
```

**Step 3: 添加样式**

```css
.http-panel-search-wrap {
    padding: 8px 12px 4px;
    border-bottom: 1px solid var(--border);
}
.http-panel-search {
    width: 100%;
    background: var(--bg-tertiary);
    border: 1px solid var(--border);
    border-radius: 4px;
    color: var(--text-primary);
    font-size: 12px;
    padding: 5px 10px;
    box-sizing: border-box;
}
.http-panel-search:focus { outline: none; border-color: var(--accent); }
```

**Step 4: 验证**
- 打开历史面板，输入关键词，条目应实时过滤
- 清空搜索，恢复全量展示
- 切换到收藏 tab，搜索同样生效

**Step 5: Commit**
```bash
git add src/index.html src/app.js src/styles.css
git commit -m "feat(http): 历史/收藏面板新增搜索过滤"
```

---

## Task 4: 认证模块 Auth Tab

**新增功能：** 在请求 Tab 栏（Params / Headers / Body）增加 "Auth" Tab，支持四种认证方式。认证自动注入请求头，与 Headers tab 的手动 header 合并（Auth 优先）。

**认证类型：**
- `none` — 不注入
- `bearer` — `Authorization: Bearer <token>`
- `basic` — `Authorization: Basic base64(user:pass)`  
- `apikey` — 支持 Header / Query Param 两种位置

**Files:**
- Modify: `src/index.html:133-136`（Tab 栏加 Auth 按钮）
- Modify: `src/index.html:206`（Tab 内容区加 Auth 面板）
- Modify: `src/app.js`（getAuthHeaders 函数 + sendHttpRequest 集成）
- Modify: `src/styles.css`（Auth 面板样式）

**Step 1: HTML - Tab 栏新增 Auth 按钮**

在 `src/index.html:135`（`<button class="http-tab" ...Body` 之后）插入：
```html
<button class="http-tab" onclick="switchHttpTab('request','auth')">Auth</button>
```

**Step 2: HTML - Auth Tab 内容区**

在 `src/index.html:205`（`</div>` 结束 Body tab 后，`</div>` 结束请求区域前）插入：
```html
<div class="http-tab-content" id="http-tab-auth">
    <div class="http-auth-type-row">
        <label>认证类型</label>
        <select id="http-auth-type" class="select-field" onchange="toggleHttpAuthPanel()">
            <option value="none">无</option>
            <option value="bearer">Bearer Token</option>
            <option value="basic">Basic Auth</option>
            <option value="apikey">API Key</option>
        </select>
    </div>
    <!-- Bearer Token -->
    <div id="http-auth-bearer" class="http-auth-panel" style="display:none">
        <label>Token</label>
        <input type="text" id="http-auth-bearer-token" class="input-field" 
               placeholder="your-token-here" autocomplete="off" spellcheck="false">
        <p class="http-auth-hint">发送时自动注入 Authorization: Bearer &lt;token&gt;</p>
    </div>
    <!-- Basic Auth -->
    <div id="http-auth-basic" class="http-auth-panel" style="display:none">
        <label>用户名</label>
        <input type="text" id="http-auth-basic-user" class="input-field" 
               placeholder="username" autocomplete="off">
        <label>密码</label>
        <input type="password" id="http-auth-basic-pass" class="input-field" 
               placeholder="password" autocomplete="new-password">
        <p class="http-auth-hint">发送时自动注入 Authorization: Basic base64(user:pass)</p>
    </div>
    <!-- API Key -->
    <div id="http-auth-apikey" class="http-auth-panel" style="display:none">
        <label>Key 名称</label>
        <input type="text" id="http-auth-apikey-name" class="input-field" 
               placeholder="X-API-Key" value="X-API-Key" autocomplete="off">
        <label>Value</label>
        <input type="text" id="http-auth-apikey-value" class="input-field" 
               placeholder="your-api-key" autocomplete="off" spellcheck="false">
        <label>位置</label>
        <select id="http-auth-apikey-loc" class="select-field">
            <option value="header">Header</option>
            <option value="query">Query Param</option>
        </select>
        <p class="http-auth-hint">发送时自动注入到 Header 或 URL 参数中</p>
    </div>
</div>
```

**Step 3: JS - toggleHttpAuthPanel 函数**

在 `app.js` 中 `toggleHttpBodyEditor` 函数附近新增：
```js
function toggleHttpAuthPanel() {
    const type = document.getElementById('http-auth-type').value;
    ['bearer', 'basic', 'apikey'].forEach(t => {
        document.getElementById('http-auth-' + t).style.display = type === t ? 'block' : 'none';
    });
}
```

**Step 4: JS - getAuthHeaders 函数**

```js
function getAuthHeaders() {
    const type = document.getElementById('http-auth-type').value;
    if (type === 'bearer') {
        const token = document.getElementById('http-auth-bearer-token').value.trim();
        return token ? { 'Authorization': 'Bearer ' + token } : {};
    }
    if (type === 'basic') {
        const user = document.getElementById('http-auth-basic-user').value;
        const pass = document.getElementById('http-auth-basic-pass').value;
        if (!user && !pass) return {};
        return { 'Authorization': 'Basic ' + btoa(user + ':' + pass) };
    }
    if (type === 'apikey') {
        const name = document.getElementById('http-auth-apikey-name').value.trim();
        const val = document.getElementById('http-auth-apikey-value').value.trim();
        const loc = document.getElementById('http-auth-apikey-loc').value;
        if (!name || !val || loc !== 'header') return {};
        return { [name]: val };
    }
    return {};
}

function getAuthQueryParams() {
    const type = document.getElementById('http-auth-type').value;
    if (type === 'apikey') {
        const name = document.getElementById('http-auth-apikey-name').value.trim();
        const val = document.getElementById('http-auth-apikey-value').value.trim();
        const loc = document.getElementById('http-auth-apikey-loc').value;
        if (name && val && loc === 'query') return { [name]: val };
    }
    return {};
}
```

**Step 5: 修改 sendHttpRequest() 集成 Auth**

在 `app.js:2947`（`const headers = getHeaderPairs();` 之后）插入：
```js
// Auth headers 合并（Auth 优先覆盖同名 Header）
const authHeaders = getAuthHeaders();
Object.assign(headers, authHeaders);
```

在 URL params 构建处（`app.js:2958`，`Object.entries(params).forEach` 之前）插入：
```js
// Auth query params
const authParams = getAuthQueryParams();
Object.assign(params, authParams);
```

**Step 6: 添加样式**

```css
.http-auth-type-row {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 12px;
}
.http-auth-panel { padding: 4px 0; }
.http-auth-panel label {
    display: block;
    color: var(--text-secondary);
    font-size: 12px;
    margin: 10px 0 4px;
}
.http-auth-panel label:first-child { margin-top: 0; }
.http-auth-hint {
    color: var(--text-secondary);
    font-size: 11px;
    margin: 8px 0 0;
    font-style: italic;
}
```

**Step 7: 验证**
- Bearer Token: 选 Bearer，填 `mytoken`，发请求，在请求 Headers tab 不应显示（由 Auth 注入），但实际发出的请求应带 `Authorization: Bearer mytoken`（用 httpbin.org/headers 验证）
- Basic Auth: 用户名 `user`，密码 `pass`，验证 Authorization 头为 `Basic dXNlcjpwYXNz`
- API Key Header: 自动注入 X-API-Key header
- API Key Query: URL 参数里带上 key

**Step 8: Commit**
```bash
git add src/index.html src/app.js src/styles.css
git commit -m "feat(http): 新增认证模块（Bearer/Basic/API Key）"
```

---

## Task 5: 环境变量 / 变量替换

**设计方案：**
- 在 action bar 加「环境」按钮，点击打开侧滑或模态编辑器
- 变量语法：`{{VAR_NAME}}`
- 作用域：URL 输入框、Header 值、Body 内容
- 持久化：`localStorage['http.env_vars']`（JSON 格式）
- UI 指示：URL 输入框旁显示未解析变量警告（实时）

**Files:**
- Modify: `src/index.html:118-127`（action bar 加环境按钮 + 环境编辑模态框）
- Modify: `src/app.js`（resolveVars + 集成到 sendHttpRequest + 持久化）
- Modify: `src/styles.css`（环境 Tag 样式、警告样式）

**Step 1: HTML - action bar 新增「环境」按钮**

在 `src/index.html:120`（`⭐ 收藏` 按钮之后）插入：
```html
<button class="btn btn-ghost btn-sm" onclick="showHttpEnvModal()">🌍 环境变量</button>
```

**Step 2: HTML - 环境变量编辑模态框**

在 `src/index.html` cURL 导入模态框之前（约 370 行）插入：
```html
<!-- 环境变量编辑模态框 -->
<div id="http-env-modal" class="modal-overlay" style="display:none">
    <div class="modal-content" style="width:560px;max-width:90vw">
        <div class="modal-header">
            <span>环境变量</span>
            <button class="modal-close" onclick="closeHttpEnvModal()">✕</button>
        </div>
        <div class="modal-body">
            <p class="http-auth-hint" style="margin-bottom:12px">在 URL、Header 值、Body 中使用 <code>{{VAR_NAME}}</code> 引用变量</p>
            <div id="http-env-kv" class="kv-editor"></div>
            <button class="btn btn-ghost btn-sm" style="margin-top:8px" onclick="addEnvRow()">+ 添加变量</button>
        </div>
        <div class="modal-footer">
            <button class="btn btn-secondary" onclick="closeHttpEnvModal()">取消</button>
            <button class="btn btn-primary" onclick="saveHttpEnv()">保存</button>
        </div>
    </div>
</div>
```

**Step 3: JS - 环境变量状态和持久化**

在 `app.js` HTTP 相关变量区域（`_httpHistory`、`_httpFavorites` 等附近）新增：
```js
let _httpEnvVars = {}; // { KEY: VALUE }

function loadHttpEnv() {
    try {
        const saved = localStorage.getItem('http.env_vars');
        if (saved) _httpEnvVars = JSON.parse(saved) || {};
    } catch(e) { _httpEnvVars = {}; }
}

function saveHttpEnv() {
    const pairs = {};
    document.getElementById('http-env-kv').querySelectorAll('.kv-row').forEach(row => {
        const k = row.querySelector('.kv-key').value.trim();
        const v = row.querySelector('.kv-value').value;
        if (k) pairs[k] = v;
    });
    _httpEnvVars = pairs;
    localStorage.setItem('http.env_vars', JSON.stringify(pairs));
    closeHttpEnvModal();
}

function showHttpEnvModal() {
    const container = document.getElementById('http-env-kv');
    container.innerHTML = '';
    const entries = Object.entries(_httpEnvVars);
    if (entries.length === 0) {
        addEnvRow();
    } else {
        entries.forEach(([k, v]) => addEnvRow(k, v));
    }
    document.getElementById('http-env-modal').style.display = 'flex';
}

function closeHttpEnvModal() {
    document.getElementById('http-env-modal').style.display = 'none';
}

function addEnvRow(key = '', value = '') {
    const container = document.getElementById('http-env-kv');
    const row = document.createElement('div');
    row.className = 'kv-row';
    row.innerHTML = '<input type="text" class="kv-key" placeholder="VAR_NAME" autocomplete="off" value="' + escapeHtmlAttr(key) + '"><input type="text" class="kv-value" placeholder="value" autocomplete="off" value="' + escapeHtmlAttr(value) + '"><button class="kv-remove" onclick="removeKvRow(this)">✕</button>';
    container.appendChild(row);
}
```

**Step 4: JS - resolveVars 函数**

```js
function resolveVars(text) {
    if (!text || typeof text !== 'string') return text;
    return text.replace(/\{\{([^}]+)\}\}/g, (_, key) => {
        const k = key.trim();
        return Object.prototype.hasOwnProperty.call(_httpEnvVars, k) ? _httpEnvVars[k] : '{{' + k + '}}';
    });
}

function hasUnresolvedVars(text) {
    return /\{\{[^}]+\}\}/.test(text);
}
```

**Step 5: 集成到 sendHttpRequest()**

在 `sendHttpRequest()` 中，`const url = ...` 之后，参数收集之前：
```js
// 解析环境变量
const resolvedUrl = resolveVars(url);
document.getElementById('http-url').style.borderColor = 
    hasUnresolvedVars(resolvedUrl) ? 'var(--error)' : '';
// 将 url 替换为 resolvedUrl
```

并对 headers values 和 body 做解析：
```js
// headers 解析
const headers = getHeaderPairs();
Object.keys(headers).forEach(k => { headers[k] = resolveVars(headers[k]); });

// body 解析（在 body 赋值后）
body = resolveVars(body);
```

在 `const finalUrl = url` → 改为 `const finalUrl = resolvedUrl`，后续构建 URL 参数时也用 `resolvedUrl`。

**Step 6: 初始化时加载**

在 HTTP 初始化代码（`http_load_history` 调用处附近）加入：
```js
loadHttpEnv();
```

**Step 7: 添加样式**

```css
.http-env-unresolved {
    border-color: var(--error) !important;
}
```

**Step 8: 验证**
- 打开环境变量，设 `BASE_URL = https://httpbin.org`，`TOKEN = mytoken123`
- URL 输入 `{{BASE_URL}}/get`，发送，应成功请求 httpbin.org/get
- Header 里加 `Authorization: Bearer {{TOKEN}}`，验证请求带正确值
- 设置一个不存在的变量 `{{MISSING}}`，URL 边框变红，请求仍发出但带未替换原文

**Step 9: Commit**
```bash
git add src/index.html src/app.js src/styles.css
git commit -m "feat(http): 新增环境变量/变量替换功能（{{VAR_NAME}} 语法）"
```

---

## Task 6: 大响应保护（截断 + 提示）

**设计方案：** 响应体超过 500KB 时截断显示，Body tab 顶部展示警告横幅，提供「加载完整内容」按钮（点击后展示全量，可能卡顿）。

**触发阈值：** `r.size_bytes > 512 * 1024`（512KB）

**Files:**
- Modify: `src/app.js:2993-3007`（sendHttpRequest 响应处理区域）
- Modify: `src/index.html:222`（Body tab 内加警告横幅占位 div）
- Modify: `src/styles.css`（警告样式）

**Step 1: HTML - 响应 Body tab 加警告横幅**

在 `src/index.html:222`（`http-response-tab-body` div 开头，search bar 之前）插入：
```html
<div id="http-response-size-warning" style="display:none" class="http-size-warning">
    <span id="http-response-size-text"></span>
    <button class="btn btn-ghost btn-sm" onclick="loadFullHttpResponse()">加载完整内容</button>
</div>
```

**Step 2: JS - 修改响应处理逻辑**

在 `app.js` 中新增变量存储完整响应体：
```js
let _httpFullResponseBody = '';
```

修改 `sendHttpRequest()` 中 `if (r.success && r.body)` 块（约 2993 行）：
```js
const MAX_BODY_SIZE = 512 * 1024; // 512KB
_httpFullResponseBody = r.body;
const sizeWarning = document.getElementById('http-response-size-warning');
const sizeText = document.getElementById('http-response-size-text');

let displayBody = r.body;
if (r.size_bytes > MAX_BODY_SIZE) {
    displayBody = r.body.slice(0, MAX_BODY_SIZE) + '\n\n... [截断，共 ' + formatBytes(r.size_bytes) + '，点击右侧按钮加载完整内容]';
    sizeWarning.style.display = 'flex';
    sizeText.textContent = '响应体较大（' + formatBytes(r.size_bytes) + '），已截断显示前 512KB';
} else {
    sizeWarning.style.display = 'none';
}

if (r.success && r.body) {
    let bodyText = displayBody;
    // 只对小响应做 JSON 格式化
    if (r.size_bytes <= MAX_BODY_SIZE) {
        try {
            const parsed = JSON.parse(r.body);
            bodyText = JSON.stringify(parsed, null, 2);
        } catch(e) {}
    }
    if (editors.httpResponseBody) {
        editors.httpResponseBody.setValue(bodyText);
        // ...
    }
}
```

在 `sendHttpRequest()` 开头（btn disabled 之前）添加：
```js
document.getElementById('http-response-size-warning').style.display = 'none';
```

**Step 3: JS - loadFullHttpResponse 函数**

```js
function loadFullHttpResponse() {
    if (!_httpFullResponseBody) return;
    let bodyText = _httpFullResponseBody;
    try {
        const parsed = JSON.parse(_httpFullResponseBody);
        bodyText = JSON.stringify(parsed, null, 2);
    } catch(e) {}
    if (editors.httpResponseBody) editors.httpResponseBody.setValue(bodyText);
    if (editors.httpResponseRaw) editors.httpResponseRaw.setValue(_httpFullResponseBody);
    document.getElementById('http-response-size-warning').style.display = 'none';
}
```

**Step 4: 样式**

```css
.http-size-warning {
    display: flex;
    align-items: center;
    gap: 12px;
    background: rgba(255, 159, 67, 0.1);
    border: 1px solid var(--warning);
    border-radius: 4px;
    padding: 6px 12px;
    margin-bottom: 8px;
    font-size: 12px;
    color: var(--warning);
}
```

**Step 5: 验证**
- 请求一个大文件 URL（如返回大 JSON 的接口），超过 512KB 时显示截断警告
- 点「加载完整内容」后编辑器显示全量
- 小响应不显示警告

**Step 6: Commit**
```bash
git add src/index.html src/app.js src/styles.css
git commit -m "feat(http): 大响应体截断保护，超 512KB 显示警告并支持按需加载"
```

---

## Task 7: 图片响应预览

**设计方案：** 
- Rust 后端：检测响应 Content-Type 为 `image/*` 时，将响应体转为 Base64 字符串，并在 `HttpResponse` 中新增 `is_image: bool` 字段
- 前端：Body tab 根据 `r.is_image` 决定显示 CodeMirror（文本）或 `<img>` 元素

**Files:**
- Modify: `src-tauri/src/commands.rs:2587-2598`（HttpResponse 结构体加 is_image + body_base64 字段）
- Modify: `src-tauri/src/commands.rs:2788-2793`（构建响应时判断 content-type 做 base64 编码）
- Modify: `src/index.html:231`（响应 body tab 加 img 占位 div）
- Modify: `src/app.js:2993-3007`（根据 is_image 切换显示逻辑）
- Modify: `src/styles.css`（图片预览样式）

**Step 1: Rust - HttpResponse 结构体新增字段**

在 `commands.rs:2598` 的 `HttpResponse` 结构体 `error` 字段后加：
```rust
pub is_image: bool,
pub content_type: String,
```

**Step 2: Rust - 构建响应时检测图片**

在 `commands.rs:2788` 的 `let body_bytes = ...` 之后，`let size = ...` 之前：
```rust
let content_type = resp_headers.get("content-type").cloned().unwrap_or_default();
let is_image = content_type.starts_with("image/");
let body = if is_image {
    use base64::Engine;
    base64::engine::general_purpose::STANDARD.encode(&body_bytes)
} else {
    String::from_utf8_lossy(&body_bytes).to_string()
};
```

在 `HttpResponse { ... }` 构建时加上新字段：
```rust
HttpResponse {
    success: true, status, status_text, headers: resp_headers,
    body, time_ms: elapsed, size_bytes: size, redirects, error: None,
    is_image, content_type,
}
```

在失败分支（`Err(e)`）的 `HttpResponse` 中也加：
```rust
is_image: false, content_type: String::new(),
```

**注意：** 需要在 `Cargo.toml` 确认 `base64` crate 已依赖。检查：
```bash
grep "base64" src-tauri/Cargo.toml
```
若不存在，追加：
```toml
base64 = "0.22"
```

**Step 3: HTML - 响应 body tab 加图片预览区**

在 `src/index.html:231`（`http-response-body-editor` 之前）插入：
```html
<div id="http-response-image-wrap" style="display:none" class="http-image-preview-wrap">
    <img id="http-response-image" class="http-image-preview" alt="响应图片">
    <div class="http-image-info" id="http-response-image-info"></div>
</div>
```

**Step 4: JS - sendHttpRequest() 图片处理逻辑**

在 `app.js` 的 `if (r.success && r.body)` 块中，在显示 body 之前添加：
```js
const imageWrap = document.getElementById('http-response-image-wrap');
const bodyEditorWrap = document.getElementById('http-response-body-editor');

if (r.is_image) {
    // 显示图片，隐藏代码编辑器
    const img = document.getElementById('http-response-image');
    img.src = 'data:' + r.content_type + ';base64,' + r.body;
    document.getElementById('http-response-image-info').textContent = 
        r.content_type + ' · ' + formatBytes(r.size_bytes);
    imageWrap.style.display = 'block';
    bodyEditorWrap.style.display = 'none';
    if (editors.httpResponseRaw) editors.httpResponseRaw.setValue('[图片数据，Base64 长度: ' + r.body.length + ']');
} else {
    imageWrap.style.display = 'none';
    bodyEditorWrap.style.display = 'block';
    // 原有文本显示逻辑...
}
```

在 `sendHttpRequest()` 开头（清理状态处）加：
```js
document.getElementById('http-response-image-wrap').style.display = 'none';
document.getElementById('http-response-body-editor').style.display = 'block';
```

**Step 5: 样式**

```css
.http-image-preview-wrap {
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 16px;
    gap: 8px;
    background: var(--bg-secondary);
    border-radius: 4px;
    min-height: 100px;
}
.http-image-preview {
    max-width: 100%;
    max-height: 400px;
    object-fit: contain;
    border-radius: 4px;
    border: 1px solid var(--border);
}
.http-image-info {
    color: var(--text-secondary);
    font-size: 11px;
}
```

**Step 6: 验证**
- 请求一个图片 URL（如 `https://httpbin.org/image/png`），Body tab 显示图片而非乱码
- 请求普通 JSON 接口，正常显示文本
- Raw tab 对图片显示提示文字而非 base64 噪音

**Step 7: Commit**
```bash
git add src/index.html src/app.js src/styles.css src-tauri/src/commands.rs src-tauri/Cargo.toml
git commit -m "feat(http): 图片响应自动预览（base64 + <img> 渲染）"
```

---

## 整体验收清单

完成所有 Task 后，逐条验证：

- [ ] Task 1: 导出 cURL，禁用的 Header 不出现在输出中
- [ ] Task 2: 超时设为 2s，慢接口报超时；改 30s 正常
- [ ] Task 3: 历史面板搜索框能过滤 URL 和名称
- [ ] Task 4: Bearer/Basic/API Key 三种认证方式均可注入正确 Header
- [ ] Task 5: `{{BASE_URL}}` 在 URL 中被替换；未定义变量保持原样并警告
- [ ] Task 6: 大响应显示截断警告；「加载完整」按钮正常工作
- [ ] Task 7: 图片 URL 响应在 Body tab 渲染为图片

## 最终 Commit
```bash
git log --oneline -8
```
