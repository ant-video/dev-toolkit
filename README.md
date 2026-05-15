# 🛠️ DevToolkit - 程序员工具集

跨平台桌面应用，基于 Tauri 2.0 + Rust + CodeMirror 5。

## 功能

| 分类 | 工具 |
|------|------|
| 🕐 时间 | 时间戳转换 |
| 📝 文本 | JSON 格式化/压缩/校验/去转义、文本对比、正则测试、文本统计 |
| 🔐 编解码 | Base64、URL、Unicode、HTML |
| 🔒 加解密 | MD5/SHA 哈希、HMAC-SHA256、AES-256-GCM |
| 🔄 转换 | 进制转换、颜色转换、JWT 解码、URL 解析 |

## 特性

- 🔍 常驻搜索栏（⌘F），支持上一个/下一个、匹配计数
- 📐 编辑器可拖拽调整大小
- 📂 侧边栏折叠/隐藏
- 🗂️ JSON 代码折叠（1/2/3级、全部折叠/展开）
- 📊 文本对比：逐词高亮差异 + 同步滚动

## 构建

```bash
npm install
npx tauri build
```

## 技术栈

- **后端**: Rust (Tauri 2.0)
- **前端**: HTML/CSS/JS + CodeMirror 5
- **主题**: Dracula 暗色
