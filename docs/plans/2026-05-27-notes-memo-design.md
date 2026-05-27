# 笔记备忘录功能设计

## 产品定位

笔记备忘录面向开发者的临时记录和长期沉淀场景：排查问题时的命令片段、接口说明、待办事项、会议结论、代码阅读笔记。它不是复杂知识库，核心目标是打开快、记录快、搜索快，并保证数据本地保存。

## 核心功能

- 新建、编辑、删除笔记。
- 自动保存和手动保存并存，降低输入丢失风险。
- 标题、正文、标签联合搜索。
- 标签筛选，适合按项目、环境、主题整理。
- 置顶，保留当前最常用笔记。
- 归档，隐藏已完成但仍需保留的内容。
- Markdown 编辑和预览，复用现有 Markdown 渲染命令。
- 一键复制为 Markdown，便于粘贴到文档、Issue、聊天工具。
- 多媒体附件，支持图片、音频、视频和常见文档作为本地 Data URL 保存并预览。
- 定时提醒，支持为笔记设置提醒时间，到期后使用系统 Web Notification 或应用内弹窗提醒。

## 数据模型

```json
{
  "id": "uuid",
  "title": "标题",
  "content": "Markdown 内容",
  "tags": ["project", "todo"],
  "attachments": [
    {
      "id": "att-id",
      "name": "screenshot.png",
      "mime": "image/png",
      "data_url": "data:image/png;base64,...",
      "size": 1024,
      "added_at": 1760000000000
    }
  ],
  "reminder_at": 1760000000000,
  "reminder_done": false,
  "pinned": false,
  "archived": false,
  "created_at": 1760000000000,
  "updated_at": 1760000000000
}
```

## 技术实现

- 后端模块：`src-tauri/src/commands/notes.rs`。
- 前端模块：`src/js/notes.js`。
- 存储位置：Tauri `app_data_dir()/notes/notes.json`。
- 命令：
  - `notes_list`
  - `notes_save`
  - `notes_delete`
  - `notes_set_archived`
  - `notes_mark_reminder_done`
  - `notes_export_markdown`
- 编辑器：复用 CodeMirror，保持和其他文本工具一致。
- 初始化：在 `src/js/app-init.js` 通过页面映射懒加载，避免启动时初始化不必要编辑器。
- 提醒服务：应用启动后定时轮询本地笔记数据；当笔记页已初始化时只检查内存状态，避免覆盖正在编辑的草稿。
- 附件策略：首版以 Data URL 直接写入 `notes.json`，降低实现复杂度；单文件限制为 12MB，适合截图、短音频、短视频和小文档。

## 后续增强

- 支持笔记导入/导出 JSON。
- 大附件改为文件落盘，JSON 中只保留路径、MIME、校验信息。
- 使用 Tauri 原生通知插件替代 Web Notification，提升跨平台一致性。
- 支持按更新时间、标题、创建时间切换排序。
- 支持全文高亮搜索。
- 支持从 HTTP/数据库/SSH 工具一键发送选中文本到笔记。
- 如果笔记量明显增长，再考虑 SQLite 存储和 FTS 搜索。
