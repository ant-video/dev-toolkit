# 🛠️ DevToolkit - 程序员工具集

[![Build](https://github.com/ant-video/dev-toolkit/actions/workflows/build.yml/badge.svg)](https://github.com/ant-video/dev-toolkit/actions/workflows/build.yml)

跨平台桌面应用，基于 Tauri 2.0 + Rust + CodeMirror 5。

📖 **文档**：[产品设计文档](docs/PRODUCT.md) | [技术设计文档](docs/DESIGN.md)

## 功能

| 分类 | 工具 | 说明 |
|------|------|------|
| 🕐 时间 | 时间戳转换 | Unix 时间戳 ↔ 日期互转 |
| 📝 文本 | JSON 工具 | 格式化 / 压缩 / 校验 / 去转义 / 代码折叠 |
| 📄 对比 | 文本对比 | 逐行逐词差异高亮 + 同步滚动 |
| 🔍 正则 | 正则测试 | 实时匹配 + 分组捕获 |
| 📊 统计 | 文本统计 | 字数 / 行数 / 字符数 / 字节数 |
| 🔐 编解码 | Base64 | 文本 ↔ Base64 互转 |
| 🌐 编解码 | URL 编解码 | 百分号编码 / 解码 |
| 🔣 编解码 | Unicode | \uXXXX 转义 / 解码 |
| 📎 编解码 | HTML 实体 | 特殊字符 ↔ 实体互转 |
| 🔒 加密 | 哈希计算 | MD5 / SHA-1 / SHA-256 / SHA-512 |
| 🔑 加密 | HMAC-SHA256 | 消息认证签名 |
| 🛡️ 加密 | AES 加解密 | AES-256-GCM 对称加解密 |
| 🔢 转换 | 进制转换 | 2~36 进制互转 |
| 🎨 转换 | 颜色转换 | HEX / RGB / HSL 互转 + 预览 |
| 🎫 转换 | JWT 解码 | 解析 Header / Payload / Signature |
| 🔗 转换 | URL 解析 | 协议 / 主机 / 路径 / 参数 |
| 📸 截图 | 截图工具 | ⌘⇧S 快捷键 / 选区/窗口/全屏 / 内置编辑器 |
| 🔢 生成 | UUID / 密码 | UUID 多格式 / 密码强度评估 |
| 📋 格式 | YAML/JSON | YAML ↔ JSON 双向转换 |
| 📄 文档 | XML 工具 | XML 格式化 / 压缩 |
| 📱 二维码 | QR 码 | 生成 / 解码 / 自定义容错级别 |
| 🌐 网络 | HTTP 请求 | REST API 测试 / 历史 / 收藏夹 |
| 🌍 翻译 | 翻译工具 | 多语言翻译 (离线 + 在线) |
| 🎨 转换 | CSS 单位 | px/rem/em/vw/vh 互转 |
| ⏱️ 时间 | Cron 解析 | 表达式解析 + 可视化构建 |
| 📝 文本 | 文本处理 | 去重 / 排序 / 去空白行 |
| 🔤 转换 | 命名转换 | camelCase/snake_case/kebab-case 等 |
| 📊 数字 | 数字格式化 | 千分位 / 科学计数法 / 中文数字 |
| 📎 工具 | MIME 查询 | 文件类型 ↔ MIME 类型 |
| 📜 工具 | Lorem Ipsum | 占位文本生成 (中/英文) |
| 🖼️ 图片 | 图片 Base64 | 图片 ↔ Base64 互转 |

## 特性

- 🔍 **持久搜索栏**：⌘F 打开，常驻显示，支持上一个/下一个、匹配计数、大小写/正则
- 📸 **全局截图**：⌘⇧S / Ctrl+Shift+S 快速截图，内置编辑器
- 📐 **编辑器可拖拽**：拖动底部手柄调整编辑器高度
- 📂 **侧边栏折叠**：点击 ◀ / ☰ 收起展开
- 🗂️ **JSON 折叠**：按 1/2/3 级折叠、全部折叠/展开
- 📊 **文本对比**：LCS 算法逐行 diff + 逐词高亮 + 同步滚动
- 🌙 **Dracula 暗色主题**：护眼舒适
- 🔒 **本地优先**：无网络请求，数据不出本机（仅版本检查时访问 GitHub API）
- 🆕 **版本更新**：自动检查新版本，一键跳转下载

## 截图

> *待补充*

## 下载

| 平台 | 格式 |
|------|------|
| macOS (Intel) | `.dmg` |
| macOS (Apple Silicon) | `.dmg` |
| Windows | `.msi` / `.exe` |
| Linux | `.deb` / `.AppImage` |

前往 [Releases](https://github.com/ant-video/dev-toolkit/releases) 下载最新版本。

## 构建

### 前置要求

- [Node.js](https://nodejs.org/) 18+
- [Rust](https://www.rust-lang.org/tools/install) 1.70+
- [Tauri CLI](https://tauri.app/start/prerequisites/)

### 开发

```bash
npm install
npx tauri dev
```

### 本地构建脚本

项目根目录提供了 `build.sh` 脚本，简化本地编译打包流程：

```bash
# 查看帮助
./build.sh --help

# 构建当前平台（macOS 默认 Universal Binary）
./build.sh

# 构建指定平台
./build.sh --macos    # macOS (dmg + app)
./build.sh --linux    # Linux (deb + rpm)
./build.sh --windows  # Windows (msi + nsis)

# 清理后构建
./build.sh --clean

# 调试版本构建
./build.sh --debug
```

### 手动构建

```bash
# 安装依赖
npm install

# 开发模式
npx tauri dev

# 发布版本构建
npx tauri build
```

构建产物位于 `src-tauri/target/*/release/bundle/`：

| 平台 | 产物位置 |
|------|----------|
| macOS | `src-tauri/target/universal-apple-darwin/release/bundle/dmg/*.dmg` |
| Linux | `src-tauri/target/release/bundle/deb/*.deb`, `rpm/*.rpm` |
| Windows | `src-tauri/target/release/bundle/msi/*.msi`, `nsis/*.exe` |

### 跨平台构建 (GitHub Actions)

```bash
# 1. 初始化 CI（需要 gh CLI + workflow scope）
bash setup-ci.sh
git add .github/workflows/build.yml
git commit -m "ci: add workflow"
git push

# 2. 打 Tag 触发构建
git tag v1.0.0
git push --tags
```

构建完成后在 [Releases](https://github.com/ant-video/dev-toolkit/releases) 页面查看产物。

## 技术栈

| 层级 | 技术 |
|------|------|
| 框架 | Tauri 2.0 |
| 后端 | Rust |
| 前端 | HTML / CSS / JavaScript |
| 编辑器 | CodeMirror 5 |
| 主题 | Dracula |
| CI/CD | GitHub Actions |

## 文档

- 📖 [产品说明文档](docs/PRODUCT.md) — 功能介绍、使用指南、常见问题
- 📐 [技术设计文档](docs/DESIGN.md) — 架构设计、模块说明、数据流、安全设计

## 开源协议

MIT License
