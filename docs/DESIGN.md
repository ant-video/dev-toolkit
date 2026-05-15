# 📐 DevToolkit 设计文档

> 版本：1.0.0 | 更新日期：2026-05-15

## 1. 项目概述

### 1.1 定位

DevToolkit 是一款面向开发者的跨平台桌面工具集应用，将日常开发中频繁使用的编码、解码、加解密、格式化、对比等小工具整合到一个统一的界面中，免去在浏览器中反复搜索在线工具的麻烦。

### 1.2 目标用户

- 后端/前端开发者
- 运维工程师
- 安全研究人员
- 需要频繁处理文本编码的技术人员

### 1.3 核心价值

| 价值 | 说明 |
|------|------|
| **离线可用** | 基于 Tauri 桌面应用，无需联网，数据不出本机 |
| **一站式** | 16 类工具 29 个命令，覆盖日常 90% 的编码/解码/加解密需求 |
| **高性能** | Rust 后端处理计算密集任务，CodeMirror 虚拟渲染支持大文本 |
| **隐私安全** | 所有数据处理均在本地完成，无网络请求 |

---

## 2. 技术架构

### 2.1 技术栈

```
┌─────────────────────────────────────────┐
│            Tauri 2.0 Runtime            │
├──────────────────┬──────────────────────┤
│   Frontend       │      Backend         │
│   HTML/CSS/JS    │      Rust            │
│   CodeMirror 5   │      serde_json      │
│   Dracula Theme  │      chrono          │
│                  │      aes-gcm         │
│                  │      sha1/sha2/md-5  │
│                  │      hmac/digest     │
│                  │      regex           │
├──────────────────┴──────────────────────┤
│           macOS / Windows / Linux        │
└─────────────────────────────────────────┘
```

### 2.2 架构设计

```
┌─────────────────────────────────────────────────────┐
│                     UI Layer                         │
│  ┌───────┐  ┌──────────┐  ┌──────────┐  ┌────────┐ │
│  │Sidebar│  │Tool Pages│  │SearchBar │  │DragHdl │ │
│  └───┬───┘  └────┬─────┘  └────┬─────┘  └───┬────┘ │
│      │           │             │             │       │
├──────┴───────────┴─────────────┴─────────────┴───────┤
│                   CodeMirror Layer                    │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐           │
│  │ Editor   │  │ Fold     │  │ Search   │           │
│  │ Instance │  │ Plugin   │  │ Plugin   │           │
│  └────┬─────┘  └──────────┘  └──────────┘           │
│       │ invoke()                                    │
├───────┴──────────────────────────────────────────────┤
│                   Rust Backend                       │
│  ┌──────────────────────────────────────────────┐   │
│  │  29 Tauri Commands (#[tauri::command])       │   │
│  │  ├─ 时间: timestamp_now/to_date/date_to      │   │
│  │  ├─ JSON: format/minify/validate/unescape    │   │
│  │  ├─ Diff: text_diff                          │   │
│  │  ├─ 编解码: base64/url/unicode/html           │   │
│  │  ├─ 加密: md5/sha1/sha256/sha512/hmac/aes    │   │
│  │  └─ 转换: base_convert/color/jwt/url_parse   │   │
│  └──────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────┘
```

### 2.3 前后端通信

采用 Tauri IPC 机制，前端通过 `window.__TAURI__.invoke()` 调用 Rust 命令：

```javascript
// 前端调用示例
const result = await invoke('json_format', { input: jsonString });

// Rust 端定义
#[tauri::command]
pub fn json_format(input: String) -> JsonResult { ... }
```

所有命令均为**同步计算**（无 I/O 阻塞），返回结构化 JSON 结果。

---

## 3. 模块设计

### 3.1 工具模块一览

| 序号 | 模块 | data-page | 命令数 | 输入 | 输出 |
|------|------|-----------|--------|------|------|
| 1 | 时间戳转换 | `timestamp` | 3 | 时间戳/日期字符串 | 互转结果 |
| 2 | JSON 工具 | `json` | 4 | JSON 字符串 | 格式化/压缩/校验/去转义 |
| 3 | 文本对比 | `diff` | 1 | 左右两段文本 | 逐行逐词差异 |
| 4 | 正则测试 | `regex` | 1 | 正则+测试文本 | 匹配结果 |
| 5 | 文本统计 | `text-stats` | 1 | 文本 | 字数/行数/字符数 |
| 6 | Base64 | `base64` | 2 | 文本/编码串 | 编码/解码 |
| 7 | URL 编解码 | `url-codec` | 2 | 文本/编码串 | 编码/解码 |
| 8 | Unicode | `unicode` | 2 | 文本/Unicode串 | 编码/解码 |
| 9 | HTML 编解码 | `html-codec` | 2 | 文本/HTML实体 | 编码/解码 |
| 10 | 哈希计算 | `hash` | 4 | 文本 | MD5/SHA1/256/512 |
| 11 | HMAC-SHA256 | `hmac` | 1 | 消息+密钥 | HMAC签名 |
| 12 | AES 加解密 | `aes` | 2 | 明文+密钥 | 密文(Base64) |
| 13 | 进制转换 | `base-convert` | 1 | 数值+源/目标进制 | 转换结果 |
| 14 | 颜色转换 | `color` | 1 | 颜色值 | HEX/RGB/HSL互转 |
| 15 | JWT 解码 | `jwt` | 1 | JWT Token | Header/Payload/Signature |
| 16 | URL 解析 | `url-parse` | 1 | URL | 协议/主机/路径/参数等 |

### 3.2 核心算法

#### 3.2.1 文本对比 (text_diff)

```
输入: left_text, right_text
      ↓
  按行切分 → left_lines[], right_lines[]
      ↓
  LCS (最长公共子序列) DP 表
      ↓
  回溯生成差异操作序列: same / add / del
      ↓
  合并连续 del+add → change
      ↓
  输出: 左右两列 DiffLine[], 每行带 diff_type
```

- **时间复杂度**: O(n × m)，n/m 为行数
- **大文本降级**: 行数 > 5000 时退回简单逐行对比
- **前端词级高亮**: change 行再按词做 LCS，用 `<span class="diff-char-del/add">` 标注差异词

#### 3.2.2 JSON 去转义 (json_unescape)

```
输入: 可能含转义序列的字符串
      ↓
  是否以 " 开头？
  ├─ 是 → serde_json 反序列化为 JSON String → 直接得到去转义结果
  └─ 否 → 尝试作为 JSON Value 解析
         ├─ 成功 → 格式化输出
         └─ 失败 → 尝试双重转义还原
```

#### 3.2.3 AES-256-GCM 加解密

```
加密:
  输入(明文, 密钥) → PBKDF2 派生 256-bit key → 随机 12-byte nonce
  → AES-256-GCM 加密 → Base64(nonce + ciphertext + tag)

解密:
  Base64 解码 → 前12字节为nonce → AES-256-GCM 解密 → 明文
```

### 3.3 编辑器系统

每个文本域均使用 CodeMirror 5 实例，统一管理：

```javascript
const editors = {
    jsonInput:  CodeMirror(...),  // 可编辑
    jsonOutput: CodeMirror(...),  // 只读
    diffLeft:   CodeMirror(...),  // 可编辑
    diffRight:  CodeMirror(...),  // 可编辑
    // ... 共 20 个编辑器实例
};
```

**编辑器特性**：
- 虚拟渲染：仅渲染可视区域，支持 MB 级文本不卡顿
- 语法高亮：JSON 模式着色
- 代码折叠：brace-fold 插件，支持 1/2/3 级折叠
- 括号匹配：matchBrackets + closeBrackets
- 当前行高亮：activeLine 插件
- Dracula 暗色主题

---

## 4. 界面设计

### 4.1 整体布局

```
┌──────────────────────────────────────────────────┐
│  ◀ ┃  🕐 时间戳  📝 JSON  📄 对比  ...          │ ← 侧边栏
│    ┃                                             │
│    ┃  ┌─────────────────────────────────────┐    │
│    ┃  │  [格式化] [压缩] [去转义] [校验]      │    │ ← 工具栏
│    ┃  ├─────────────────────────────────────┤    │
│    ┃  │                                     │    │
│    ┃  │         CodeMirror 编辑器            │    │ ← 输入区
│    ┃  │                                     │    │
│    ┃  ├─────────────────────────────────────┤    │
│    ┃  │  ⌘F 🔍 搜索词 [▲][▼] 3/12  [Aa][.*]│    │ ← 搜索栏
│    ┃  ├─────────────────────────────────────┤    │
│    ┃  │         CodeMirror 编辑器            │    │ ← 输出区
│    ┃  │                                     │    │
│    ┃  │                                 ⠿   │    │ ← 拖拽手柄
│    ┃  └─────────────────────────────────────┘    │
│    ┃                                             │
│    ┃  v1.0.0                                     │ ← 版本号
└──────────────────────────────────────────────────┘
```

### 4.2 交互设计

#### 4.2.1 侧边栏

| 操作 | 效果 |
|------|------|
| 点击 ◀ 按钮 | 侧边栏收起，宽度变为 0，内容区展开 |
| 点击 ☰ 按钮 | 侧边栏展开，恢复 220px 宽度 |
| 切换工具项 | 高亮当前项，切换右侧工具页面，刷新所有编辑器 |

**动画**：CSS `transition: all 0.25s ease`，通过 `margin-left: -220px` 实现滑出效果。

#### 4.2.2 搜索栏

| 操作 | 效果 |
|------|------|
| ⌘F / Ctrl+F | 打开**最后获焦编辑器**的搜索栏 |
| 输入搜索词 | 实时搜索，显示匹配数 (如 `3/12`) |
| 点击 ▲/▼ | 上一个/下一个匹配 |
| 点击 Aa | 切换大小写敏感 |
| 点击 .* | 切换正则模式 |
| 点击 ✕ | 关闭搜索栏 |

**关键设计决策**：自定义持久搜索栏替代 CodeMirror 内置 dialog。内置 dialog 在找到后消失，不符合开发者使用习惯。搜索栏**常驻显示**直到手动关闭。

#### 4.2.3 编辑器调整大小

每个编辑器底部有一个 18px 高的拖拽手柄（`⠿` 图标），支持垂直拖拽：

- 最小高度：80px
- 最大高度：80vh
- 拖拽结束后自动 `cm.refresh()` 刷新 CodeMirror
- 实现方式：JS mousedown/mousemove/mouseup 事件，非 CSS resize

#### 4.2.4 JSON 折叠

工具栏提供折叠级别按钮：

| 按钮 | 效果 |
|------|------|
| 1 | 折叠到第 1 级（只显示最外层） |
| 2 | 折叠到第 2 级 |
| 3 | 折叠到第 3 级 |
| 全部折叠 | 折叠所有可折叠块 |
| 全部展开 | 展开所有折叠块 |

### 4.3 文本对比页面

```
┌──────────────────────────────────────────────────────┐
│  [对比] [清空]                                        │
│  相同 5 行 | 修改 2 行 | 删除 1 行 | 新增 1 行         │ ← 统计栏
│  ┌────────────────────┬────────────────────┐          │
│  │    原始文本         │    修改后文本       │          │
│  ├────────────────────┼────────────────────┤          │
│  │ 1  Hello World     │ 1  Hello World     │ ← 相同行 │
│  │ 2  This is old     │ 2  This is new     │ ← 修改行 │
│  │    │old│ → │new│   │    │old│ → │new│   │ ← 词高亮 │
│  │ 3  Extra line      │                    │ ← 删除行 │
│  │                    │ 3  Added line       │ ← 新增行 │
│  │ 4  Common text     │ 4  Common text     │ ← 相同行 │
│  └────────────────────┴────────────────────┘          │
│        ↑ 左右同步滚动 ↑                                │
└──────────────────────────────────────────────────────┘
```

**颜色编码**：
- 🟢 绿色背景 `rgba(0,214,143,0.15)` → 新增行/词
- 🔴 红色背景 `rgba(255,107,107,0.15)` → 删除行/词
- 🟡 黄色背景 `rgba(255,192,72,0.1)` → 修改行
- 灰色背景 → 占位行（对齐用）

---

## 5. 数据流

### 5.1 通用处理流程

```
用户输入 → CodeMirror 编辑器
    ↓ getValue()
invoke('command_name', { params })
    ↓ Tauri IPC
Rust 命令处理
    ↓ 返回 Result
前端接收 → setValue() 到输出编辑器
    ↓
showStatus() 显示成功/失败提示
```

### 5.2 命令返回结构

所有命令返回统一的结构体：

```rust
// 通用结果
pub struct JsonResult {
    pub success: bool,
    pub result: String,
    pub error: Option<String>,
}

// Diff 结果
pub struct DiffResult {
    pub left: Vec<DiffLine>,
    pub right: Vec<DiffLine>,
    pub stats: DiffStats,
}

// Diff 行
pub struct DiffLine {
    pub line_num: usize,
    pub content: String,
    pub diff_type: String,  // "same" | "add" | "del" | "change" | "placeholder"
}
```

---

## 6. 安全设计

### 6.1 数据安全

| 项目 | 措施 |
|------|------|
| 数据传输 | 无网络传输，所有数据在本地内存中处理 |
| 数据持久化 | 不持久化任何用户数据，关闭即清除 |
| 密钥处理 | AES/HMAC 密钥仅在内存中存在，不写入磁盘 |
| CSP | Tauri 窗口 CSP 策略（当前为 null，生产环境需收紧） |

### 6.2 加密实现

- **AES-256-GCM**：认证加密，防篡改
- **PBKDF2 密钥派生**：用户密钥通过 PBKDF2 派生为 256-bit 加密密钥
- **随机 Nonce**：每次加密生成随机 12-byte nonce
- **HMAC-SHA256**：标准 HMAC 实现

---

## 7. 跨平台构建

### 7.1 支持平台

| 平台 | 格式 | 架构 |
|------|------|------|
| macOS | .dmg, .app | x86_64, aarch64 (Apple Silicon) |
| Windows | .msi, .exe (NSIS) | x86_64 |
| Linux | .deb, .AppImage | x86_64 |

### 7.2 CI/CD (GitHub Actions)

构建流程在 `.github/workflows/build.yml` 中定义：

```
触发: push tag (v*) 或手动触发 (workflow_dispatch)
  ↓
4 个并行 Job:
  ├─ macos-latest (aarch64) → .dmg
  ├─ macos-latest (x86_64)  → .dmg
  ├─ windows-latest          → .msi + .exe
  └─ ubuntu-22.04            → .deb + .AppImage
  ↓
产物上传至 GitHub Release (草稿)
```

### 7.3 构建命令

```bash
# 开发模式
npm install
npx tauri dev

# 生产构建
npx tauri build

# 打 Tag 触发 CI
git tag v1.0.0
git push --tags
```

---

## 8. 代码统计

| 文件 | 行数 | 说明 |
|------|------|------|
| `src/index.html` | 372 | 页面结构 |
| `src/styles.css` | 1045 | 样式与主题 |
| `src/app.js` | 1044 | 前端逻辑 |
| `src-tauri/src/commands.rs` | 814 | 29 个 Rust 命令 |
| `src-tauri/src/lib.rs` | 50 | 命令注册 |
| **总计** | **3325** | 核心代码 |

---

## 9. 依赖清单

### 9.1 Rust 依赖 (Cargo.toml)

| 依赖 | 版本 | 用途 |
|------|------|------|
| tauri | 2.x | 应用框架 |
| serde / serde_json | 1.x | 序列化 |
| chrono / chrono-tz | 0.4 / 0.10 | 时间处理 |
| md-5 | 0.10 | MD5 哈希 |
| sha1 | 0.10 | SHA-1 哈希 |
| sha2 | 0.10 | SHA-256/512 哈希 |
| digest | 0.10 | 哈希 trait |
| hmac | 0.12 | HMAC 签名 |
| hex | 0.4 | 十六进制编解码 |
| base64 | 0.22 | Base64 编解码 |
| url | 2.x | URL 解析 |
| aes-gcm | 0.10 | AES-GCM 加解密 |
| regex | 1.x | 正则表达式 |
| urlencoding | 2.x | URL 编解码 |
| jwt | 0.16 | JWT 解码 |

### 9.2 前端依赖

| 依赖 | 版本 | 用途 |
|------|------|------|
| CodeMirror | 5.x | 代码编辑器 |
| Dracula Theme | - | 暗色主题 |

---

## 10. 未来规划

### 10.1 短期 (v1.1)

- [ ] Markdown 预览工具
- [ ] QR 码生成/解析
- [ ] 正则表达式可视化
- [ ] 系统快捷键全局呼出

### 10.2 中期 (v1.5)

- [ ] 工具收藏/常用置顶
- [ ] 历史记录（本地 SQLite）
- [ ] 自定义主题切换
- [ ] 插件系统

### 10.3 长期 (v2.0)

- [ ] 端到端加密的云同步配置
- [ ] 团队共享工具模板
- [ ] HTTP 请求工具（类似 Postman）
- [ ] WebSocket 调试工具
