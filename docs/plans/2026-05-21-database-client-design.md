# 数据库客户端工具设计文档

> 版本：1.0.0 | 创建日期：2026-05-21

## 1. 项目概述

| 项目 | 说明 |
|------|------|
| **名称** | DevToolkit Database Client |
| **定位** | DevToolkit 新增工具模块 |
| **目标** | 轻量级多数据库客户端，满足日常开发需求 |
| **风格** | 延续 DevToolkit Dracula 暗色主题 |

### 1.1 核心价值

- **一站式**：一个工具连接多种数据库，无需安装多个客户端
- **轻量级**：基于 Tauri，安装包小，启动快
- **离线可用**：所有连接配置本地存储，无需联网
- **安全可靠**：密码加密存储，支持 SSL/TLS 连接

---

## 2. 数据库支持

### 2.1 支持范围

| 类型 | 数据库 | Rust 驱动 | 优先级 |
|------|--------|----------|--------|
| 关系型 | MySQL / MariaDB | `sqlx` | P0 |
| 关系型 | PostgreSQL | `sqlx` | P0 |
| 关系型 | SQLite | `sqlx` | P0 |
| 关系型 | SQL Server | `tiberius` | P1 |
| 关系型 | Oracle | `oracle` crate | P1 |
| NoSQL | MongoDB | `mongodb` | P2 |
| NoSQL | Redis | `redis` crate | P2 |
| 时序 | ClickHouse | `clickhouse` crate | P2 |
| 搜索 | Elasticsearch | `elasticsearch` crate | P2 |

### 2.2 驱动策略

- **统一抽象层**：使用 `sqlx` 作为 MySQL/PostgreSQL/SQLite 的统一驱动
- **专用驱动**：SQL Server、Oracle、MongoDB、Redis 等使用各自专用驱动
- **异步架构**：所有数据库操作基于 `tokio` 异步运行时

---

## 3. 架构设计

### 3.1 整体架构

```
┌─────────────────────────────────────────────────────────────┐
│                        UI Layer                              │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐  │
│  │ 连接管理面板 │  │ 数据库树导航 │  │ SQL编辑器 + 结果面板 │  │
│  │ (左侧抽屉)   │  │ (左侧树形)   │  │ (右侧工作区)        │  │
│  └──────┬──────┘  └──────┬──────┘  └──────────┬──────────┘  │
│         │                │                     │             │
├─────────┴────────────────┴─────────────────────┴─────────────┤
│                      Connection Manager                       │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  Connection Pool (连接池管理)                         │   │
│  │  ├─ MySQL/PostgreSQL/SQLite (sqlx)                   │   │
│  │  ├─ SQL Server (tiberius)                            │   │
│  │  ├─ Oracle (oracle crate)                            │   │
│  │  ├─ MongoDB (mongodb)                                │   │
│  │  ├─ Redis (redis)                                    │   │
│  │  └─ ClickHouse/Elasticsearch (各自驱动)               │   │
│  └──────────────────────────────────────────────────────┘   │
├──────────────────────────────────────────────────────────────┤
│                      Rust Backend                            │
│  ┌────────────┐ ┌────────────┐ ┌────────────┐ ┌──────────┐ │
│  │ db_connect │ │ db_query   │ │ db_schema  │ │ db_export│ │
│  │ db_test    │ │ db_execute │ │ db_tables  │ │ db_import│ │
│  └────────────┘ └────────────┘ └────────────┘ └──────────┘ │
└──────────────────────────────────────────────────────────────┘
```

### 3.2 数据流

```
用户操作 → 前端 UI → Tauri IPC → Rust Backend → sqlx/driver → 数据库服务器
                                                    │
                    Result<T, E> ← 序列化返回 ←─────┘
```

### 3.3 关键设计决策

| 决策 | 说明 |
|------|------|
| 连接池 | 使用 `deadpool` 管理连接池，避免频繁建立连接 |
| 异步架构 | 基于 `tokio` 运行时，所有数据库操作异步 |
| 连接存储 | 本地 SQLite 存储，密码用 AES-256-GCM 加密 |
| 统一抽象 | 定义 `DatabaseConnection` trait，统一不同数据库操作 |

---

## 4. 功能模块设计

### 4.1 连接管理

| 功能 | 说明 |
|------|------|
| 新建连接 | 表单配置：主机、端口、用户名、密码、数据库名 |
| 连接测试 | 点击测试按钮验证连接是否成功 |
| 保存连接 | 连接配置加密存储到本地 |
| 连接池 | 自动管理连接池，避免频繁建立连接 |
| 断开连接 | 手动断开或自动超时断开 |

**连接配置结构**：

```rust
struct DbConnection {
    id: String,           // UUID
    name: String,         // 显示名称
    db_type: DbType,      // MySQL/PostgreSQL/...
    host: String,
    port: u16,
    username: String,
    password: String,     // AES 加密存储
    database: String,
    ssl_mode: SslMode,    // SSL/TLS 配置
    options: HashMap<String, String>,
}

enum DbType {
    MySQL,
    PostgreSQL,
    SQLite,
    SQLServer,
    Oracle,
    MongoDB,
    Redis,
    ClickHouse,
    Elasticsearch,
}
```

### 4.2 数据库导航树

```
📂 服务器名称
  ├─ 📂 数据库
  │   ├─ 📂 mydb
  │   │   ├─ 📂 表
  │   │   │   ├─ 📄 users
  │   │   │   ├─ 📄 orders
  │   │   │   └─ 📄 products
  │   │   ├─ 📂 视图
  │   │   ├─ 📂 存储过程
  │   │   └─ 📂 索引
  │   └─ 📂 other_db
  ├─ 📂 系统数据库
  └─ 🔗 新建数据库
```

| 操作 | 说明 |
|------|------|
| 展开/折叠 | 点击节点展开子项 |
| 刷新 | 右键刷新节点 |
| 查看数据 | 双击表名，自动生成 SELECT 查询 |
| 查看结构 | 右键查看表结构（字段、类型、索引） |
| 新建表 | 右键菜单 → 新建表 |
| 删除表 | 右键菜单 → 删除表（带确认） |

### 4.3 SQL 编辑器

| 功能 | 说明 |
|------|------|
| 语法高亮 | CodeMirror SQL 模式，关键词着色 |
| 自动补全 | 表名、字段名、关键词补全 |
| 多语句执行 | 支持 `;` 分隔的多条 SQL |
| 执行选中 | 选中部分 SQL 后仅执行选中部分 |
| 快捷执行 | ⌘+Enter / Ctrl+Enter 执行当前 SQL |
| 格式化 | SQL 格式化美化 |
| 查询历史 | 保存最近执行的 SQL 语句 |
| 收藏查询 | 保存常用 SQL |

**界面布局**：

```
┌─────────────────────────────────────────────────┐
│ [执行] [格式化] [清空]        历史 ▼  收藏 ★   │ ← 工具栏
├─────────────────────────────────────────────────┤
│ SELECT * FROM users                             │
│ WHERE created_at > '2024-01-01';                │
│                                                 │ ← SQL 编辑器 (CodeMirror)
│                                                 │
├─────────────────────────────────────────────────┤
│ 结果 | 消息 | 执行计划                          │ ← 标签页
├─────────────────────────────────────────────────┤
│ id │ name  │ email          │ created_at       │
│ 1  │ Alice │ alice@test.com │ 2024-01-15       │ ← 结果表格
│ 2  │ Bob   │ bob@test.com   │ 2024-02-20       │
├─────────────────────────────────────────────────┤
│ 行数: 2  耗时: 0.023s    [导出 CSV] [导出 JSON] │ ← 状态栏
└─────────────────────────────────────────────────┘
```

### 4.4 查询结果展示

| 功能 | 说明 |
|------|------|
| 表格展示 | 虚拟滚动，支持大数据量 |
| 分页 | 默认每页 100 行，可调整 |
| 排序 | 点击列头排序 |
| 筛选 | 列筛选器 |
| 单元格编辑 | 双击单元格可直接编辑（UPDATE） |
| 导出 | CSV / JSON / Excel / SQL INSERT |
| 复制 | 选中单元格/行后复制 |

### 4.5 表设计器

| 功能 | 说明 |
|------|------|
| 可视化建表 | 表单方式添加字段、类型、约束 |
| 修改表结构 | ALTER TABLE 可视化操作 |
| 索引管理 | 创建/删除索引 |
| 外键管理 | 设置表间关联 |
| 预览 SQL | 生成 SQL 预览后再执行 |

**表设计界面**：

```
┌─────────────────────────────────────────────────────────────┐
│ 表名: [users        ]  引擎: [InnoDB ▼]  字符集: [utf8mb4 ▼]│
├─────────────────────────────────────────────────────────────┤
│ 字段列表                                                    │
│ ┌─────┬──────────┬────────────┬────────┬─────────┬────────┐│
│ │ #   │ 字段名    │ 类型       │ 长度   │ 默认值   │ 约束   ││
│ ├─────┼──────────┼────────────┼────────┼─────────┼────────┤│
│ │ 1   │ id       │ INT        │ -      │ AUTO    │ PK     ││
│ │ 2   │ name     │ VARCHAR    │ 255    │ NULL    │ NOT NULL││
│ │ 3   │ email    │ VARCHAR    │ 255    │ NULL    │ UNIQUE ││
│ │ 4   │ created  │ TIMESTAMP  │ -      │ NOW()   │        ││
│ └─────┴──────────┴────────────┴────────┴─────────┴────────┘│
│ [+ 添加字段] [- 删除字段] [↑ 上移] [↓ 下移]                  │
├─────────────────────────────────────────────────────────────┤
│ 索引                                                        │
│ ┌──────────────┬─────────────┬─────────────────────────────┐│
│ │ 索引名        │ 类型        │ 字段                        ││
│ ├──────────────┼─────────────┼─────────────────────────────┤│
│ │ PRIMARY      │ 主键        │ id                          ││
│ │ idx_email    │ 普通        │ email                       ││
│ └──────────────┴─────────────┴─────────────────────────────┘│
│ [+ 添加索引] [- 删除索引]                                    │
├─────────────────────────────────────────────────────────────┤
│                               [预览 SQL] [保存] [取消]       │
└─────────────────────────────────────────────────────────────┘
```

### 4.6 数据导入/导出

| 功能 | 格式 | 说明 |
|------|------|------|
| 导出数据 | CSV | 表/查询结果导出为 CSV |
| 导出数据 | JSON | 表/查询结果导出为 JSON |
| 导出数据 | SQL | 导出为 INSERT 语句 |
| 导入数据 | CSV | 从 CSV 导入到表 |
| 导入数据 | JSON | 从 JSON 导入到表 |

---

## 5. Tauri 命令设计

### 5.1 命令列表

| 命令 | 参数 | 返回 | 说明 |
|------|------|------|------|
| `db_test_connection` | `DbConnectionConfig` | `TestResult` | 测试连接 |
| `db_connect` | `connection_id` | `ConnectionResult` | 建立连接 |
| `db_disconnect` | `connection_id` | `()` | 断开连接 |
| `db_list_connections` | - | `Vec<DbConnection>` | 列出所有保存的连接 |
| `db_save_connection` | `DbConnection` | `connection_id` | 保存连接配置 |
| `db_delete_connection` | `connection_id` | `()` | 删除连接配置 |
| `db_get_databases` | `connection_id` | `Vec<String>` | 获取数据库列表 |
| `db_get_tables` | `connection_id, database` | `Vec<TableInfo>` | 获取表列表 |
| `db_get_table_schema` | `connection_id, table` | `TableSchema` | 获取表结构 |
| `db_query` | `connection_id, sql` | `QueryResult` | 执行 SELECT |
| `db_execute` | `connection_id, sql` | `ExecuteResult` | 执行 INSERT/UPDATE/DELETE |
| `db_create_table` | `connection_id, TableDef` | `()` | 创建表 |
| `db_alter_table` | `connection_id, AlterDef` | `()` | 修改表 |
| `db_drop_table` | `connection_id, table` | `()` | 删除表 |
| `db_export` | `connection_id, ExportConfig` | `ExportResult` | 导出数据 |
| `db_import` | `connection_id, ImportConfig` | `ImportResult` | 导入数据 |

### 5.2 返回结构

```rust
// 查询结果
struct QueryResult {
    success: bool,
    columns: Vec<ColumnInfo>,
    rows: Vec<Vec<Option<String>>>,
    row_count: usize,
    execution_time_ms: u64,
    error: Option<String>,
}

// 执行结果
struct ExecuteResult {
    success: bool,
    affected_rows: u64,
    last_insert_id: Option<u64>,
    execution_time_ms: u64,
    error: Option<String>,
}

// 表结构
struct TableSchema {
    name: String,
    columns: Vec<ColumnSchema>,
    indexes: Vec<IndexSchema>,
    foreign_keys: Vec<ForeignKeySchema>,
}

struct ColumnSchema {
    name: String,
    data_type: String,
    nullable: bool,
    default: Option<String>,
    is_primary_key: bool,
    comment: Option<String>,
}
```

---

## 6. 技术栈

### 6.1 Rust 依赖

| 依赖 | 版本 | 用途 |
|------|------|------|
| sqlx | 0.7 | MySQL/PostgreSQL/SQLite 统一驱动 |
| tiberius | 0.12 | SQL Server 驱动 |
| oracle | 0.6 | Oracle 驱动 |
| mongodb | 2.x | MongoDB 驱动 |
| redis | 0.24 | Redis 驱动 |
| clickhouse | 0.13 | ClickHouse 驱动 |
| elasticsearch | 8.x | Elasticsearch 客户端 |
| deadpool | 0.12 | 连接池管理 |
| tokio | 1.x | 异步运行时 |
| serde / serde_json | 1.x | 序列化 |
| aes-gcm | 0.10 | 密码加密 |
| rusqlite | 0.31 | 本地配置存储 |

### 6.2 前端依赖

| 依赖 | 用途 |
|------|------|
| CodeMirror SQL Mode | SQL 语法高亮 |
| CodeMirror Autocomplete | 自动补全 |
| CodeMirror MatchBrackets | 括号匹配 |

---

## 7. 文件结构

### 7.1 Rust 后端

```
src-tauri/src/
├── commands.rs          # 现有命令 + 新增数据库命令
├── database/            # 新增数据库模块
│   ├── mod.rs
│   ├── connection.rs    # 连接管理
│   ├── pool.rs          # 连接池
│   ├── mysql.rs         # MySQL 实现
│   ├── postgres.rs      # PostgreSQL 实现
│   ├── sqlite.rs        # SQLite 实现
│   ├── sqlserver.rs     # SQL Server 实现
│   ├── oracle.rs        # Oracle 实现
│   ├── mongodb.rs       # MongoDB 实现
│   ├── redis.rs         # Redis 实现
│   ├── clickhouse.rs    # ClickHouse 实现
│   └── elasticsearch.rs # Elasticsearch 实现
├── crypto.rs            # 密码加密
└── lib.rs               # 命令注册
```

### 7.2 前端

```
src/
├── index.html           # 新增 database 入口
├── database/
│   ├── connection.html  # 连接管理弹窗
│   ├── query.html       # SQL 编辑器
│   └── table-design.html # 表设计器
├── app.js               # 新增数据库处理逻辑
└── styles.css           # 新增数据库样式
```

---

## 8. 安全设计

| 项目 | 措施 |
|------|------|
| 密码存储 | AES-256-GCM 加密后存入本地 SQLite |
| 连接加密 | 支持 SSL/TLS 连接数据库 |
| 敏感操作 | DROP/DELETE/TRUNCATE 等操作需二次确认 |
| SQL 注入 | 参数化查询，禁止拼接 SQL |
| 连接超时 | 空闲连接自动断开（默认 10 分钟） |
| 权限控制 | 只读连接模式可选 |

---

## 9. 开发阶段

### 9.1 Phase 1 - 核心功能

**目标**：实现 MySQL/PostgreSQL/SQLite 的基础查询功能

| 任务 | 说明 |
|------|------|
| 连接管理 | 新建/保存/测试连接 |
| 连接池 | deadpool 集成 |
| SQL 查询 | SELECT 执行和结果展示 |
| 数据库导航 | 树形结构浏览 |
| 密码加密 | AES 加密存储 |

### 9.2 Phase 2 - 表设计器

**目标**：实现表结构管理

| 任务 | 说明 |
|------|------|
| 表设计器 | 可视化建表/改表 |
| 索引管理 | 创建/删除索引 |
| 表结构查看 | 字段详情、类型、约束 |
| SQL 预览 | 操作前预览 SQL |

### 9.3 Phase 3 - 扩展功能

**目标**：导入导出 + NoSQL 支持

| 任务 | 说明 |
|------|------|
| 数据导出 | CSV/JSON/SQL 导出 |
| 数据导入 | CSV/JSON 导入 |
| MongoDB | 文档数据库支持 |
| Redis | KV 数据库支持 |
| SQL Server | 企业数据库支持 |
| Oracle | 企业数据库支持 |
| ClickHouse | 时序数据库支持 |
| Elasticsearch | 搜索引擎支持 |

---

## 10. 测试计划

| 测试类型 | 内容 |
|----------|------|
| 单元测试 | 每个数据库驱动的连接/查询/执行方法 |
| 集成测试 | 完整的连接→查询→结果流程 |
| 安全测试 | 密码加密、SQL 注入防护 |
| 性能测试 | 大数据量查询、并发连接 |
| 兼容测试 | 不同数据库版本兼容性 |

---

## 11. 风险与缓解

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| Oracle 驱动不成熟 | 功能受限 | 仅支持基础查询，高级功能后续迭代 |
| 连接池资源泄漏 | 内存泄漏 | 实现超时自动回收、定期检查 |
| 大数据量性能 | UI 卡顿 | 虚拟滚动、分页加载、限制返回行数 |
| 多数据库兼容 | 语法差异 | 统一抽象层 + 数据库特定适配器 |
