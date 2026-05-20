# 数据库客户端工具实施计划 - Phase 1 核心功能

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 在 DevToolkit 中实现数据库客户端核心功能，支持 MySQL/PostgreSQL/SQLite 的连接管理和 SQL 查询。

**Architecture:** 使用 sqlx 作为统一数据库驱动，deadpool 管理连接池，AES-256-GCM 加密密码存储在本地 SQLite。前端复用 CodeMirror 作为 SQL 编辑器，延续 Dracula 暗色主题。

**Tech Stack:** Tauri 2.0 + Rust (sqlx, deadpool, aes-gcm, rusqlite) + CodeMirror SQL Mode

---

## Task 1: 添加 Rust 依赖

**Files:**
- Modify: `src-tauri/Cargo.toml`

**Step 1: 添加数据库相关依赖**

在 `src-tauri/Cargo.toml` 的 `[dependencies]` 部分添加：

```toml
# 数据库驱动
sqlx = { version = "0.7", features = ["runtime-tokio", "tls-rustls", "mysql", "postgres", "sqlite"] }
deadpool = "0.12"
rusqlite = { version = "0.31", features = ["bundled"] }
tokio = { version = "1", features = ["rt-multi-thread", "macros"] }
```

**Step 2: 验证依赖可编译**

Run: `cd /Users/liushiquan/.openclaw/workspace/dev-toolkit/src-tauri && cargo check`

Expected: 编译成功，无错误

**Step 3: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/Cargo.lock
git commit -m "chore: 添加数据库客户端依赖 (sqlx, deadpool, rusqlite, tokio)"
```

---

## Task 2: 创建数据库模块基础结构

**Files:**
- Create: `src-tauri/src/database/mod.rs`
- Create: `src-tauri/src/database/types.rs`
- Modify: `src-tauri/src/lib.rs`

**Step 1: 创建类型定义文件**

Create `src-tauri/src/database/types.rs`:

```rust
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// 数据库类型
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum DbType {
    MySQL,
    PostgreSQL,
    SQLite,
}

/// SSL 模式
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum SslMode {
    Disabled,
    Preferred,
    Required,
    VerifyIdentity,
}

impl Default for SslMode {
    fn default() -> Self {
        Self::Preferred
    }
}

/// 连接配置（前端传递，密码明文）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConnectionConfig {
    pub name: String,
    pub db_type: DbType,
    pub host: String,
    pub port: u16,
    pub username: String,
    pub password: String,
    pub database: String,
    #[serde(default)]
    pub ssl_mode: SslMode,
    #[serde(default)]
    pub options: HashMap<String, String>,
}

/// 保存的连接（持久化存储，密码加密）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SavedConnection {
    pub id: String,
    pub name: String,
    pub db_type: DbType,
    pub host: String,
    pub port: u16,
    pub username: String,
    pub encrypted_password: String,  // AES 加密
    pub database: String,
    pub ssl_mode: SslMode,
    pub options: HashMap<String, String>,
    pub created_at: i64,
    pub updated_at: i64,
}

/// 连接测试结果
#[derive(Debug, Serialize)]
pub struct TestResult {
    pub success: bool,
    pub message: String,
    pub server_version: Option<String>,
}

/// 查询结果
#[derive(Debug, Serialize)]
pub struct QueryResult {
    pub success: bool,
    pub columns: Vec<ColumnInfo>,
    pub rows: Vec<Vec<Option<String>>>,
    pub row_count: usize,
    pub execution_time_ms: u64,
    pub error: Option<String>,
}

/// 列信息
#[derive(Debug, Serialize)]
pub struct ColumnInfo {
    pub name: String,
    pub data_type: String,
    pub nullable: bool,
}

/// 执行结果
#[derive(Debug, Serialize)]
pub struct ExecuteResult {
    pub success: bool,
    pub affected_rows: u64,
    pub last_insert_id: Option<i64>,
    pub execution_time_ms: u64,
    pub error: Option<String>,
}

/// 表信息
#[derive(Debug, Serialize)]
pub struct TableInfo {
    pub name: String,
    pub schema: Option<String>,
    pub table_type: String,
    pub row_count: Option<i64>,
}

/// 表结构
#[derive(Debug, Serialize)]
pub struct TableSchema {
    pub name: String,
    pub columns: Vec<ColumnSchema>,
}

/// 列结构
#[derive(Debug, Serialize)]
pub struct ColumnSchema {
    pub name: String,
    pub data_type: String,
    pub nullable: bool,
    pub default: Option<String>,
    pub is_primary_key: bool,
    pub comment: Option<String>,
}

/// 数据库信息
#[derive(Debug, Serialize)]
pub struct DatabaseInfo {
    pub name: String,
    pub charset: Option<String>,
    pub collation: Option<String>,
}

impl ConnectionConfig {
    /// 获取默认端口
    pub fn default_port(db_type: &DbType) -> u16 {
        match db_type {
            DbType::MySQL => 3306,
            DbType::PostgreSQL => 5432,
            DbType::SQLite => 0,
        }
    }
}
```

**Step 2: 创建模块入口**

Create `src-tauri/src/database/mod.rs`:

```rust
pub mod types;

pub use types::*;
```

**Step 3: 在 lib.rs 中声明模块**

在 `src-tauri/src/lib.rs` 开头添加：

```rust
mod database;
```

**Step 4: 验证编译**

Run: `cd /Users/liushiquan/.openclaw/workspace/dev-toolkit/src-tauri && cargo check`

Expected: 编译成功

**Step 5: Commit**

```bash
git add src-tauri/src/database/
git commit -m "feat(db): 添加数据库模块基础类型定义"
```

---

## Task 3: 实现密码加密模块

**Files:**
- Create: `src-tauri/src/database/crypto.rs`
- Modify: `src-tauri/src/database/mod.rs`

**Step 1: 创建加密模块**

Create `src-tauri/src/database/crypto.rs`:

```rust
use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Nonce,
};
use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use std::env;

/// 获取加密密钥（基于机器标识）
fn get_encryption_key() -> [u8; 32] {
    // 使用机器名作为密钥种子（生产环境应使用更安全的密钥管理）
    let hostname = env::var("USER")
        .or_else(|_| env::var("USERNAME"))
        .unwrap_or_else(|_| "dev-toolkit".to_string());

    let mut key = [0u8; 32];
    let hash = sha2::Sha256::digest(hostname.as_bytes());
    key.copy_from_slice(&hash);
    key
}

/// 加密密码
pub fn encrypt_password(password: &str) -> Result<String, String> {
    let key = get_encryption_key();
    let cipher = Aes256Gcm::new_from_slice(&key)
        .map_err(|e| format!("初始化加密器失败: {}", e))?;

    // 生成随机 nonce
    let nonce_bytes: [u8; 12] = rand::random();
    let nonce = Nonce::from_slice(&nonce_bytes);

    let ciphertext = cipher
        .encrypt(nonce, password.as_bytes())
        .map_err(|e| format!("加密失败: {}", e))?;

    // 格式: base64(nonce + ciphertext)
    let mut combined = nonce_bytes.to_vec();
    combined.extend(ciphertext);
    Ok(BASE64.encode(&combined))
}

/// 解密密码
pub fn decrypt_password(encrypted: &str) -> Result<String, String> {
    let key = get_encryption_key();
    let cipher = Aes256Gcm::new_from_slice(&key)
        .map_err(|e| format!("初始化解密器失败: {}", e))?;

    let combined = BASE64
        .decode(encrypted)
        .map_err(|e| format!("Base64 解码失败: {}", e))?;

    if combined.len() < 12 {
        return Err("加密数据格式无效".to_string());
    }

    let (nonce_bytes, ciphertext) = combined.split_at(12);
    let nonce = Nonce::from_slice(nonce_bytes);

    let plaintext = cipher
        .decrypt(nonce, ciphertext)
        .map_err(|e| format!("解密失败: {}", e))?;

    String::from_utf8(plaintext).map_err(|e| format!("密码解码失败: {}", e))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_encrypt_decrypt() {
        let password = "my_secret_password";
        let encrypted = encrypt_password(password).unwrap();
        let decrypted = decrypt_password(&encrypted).unwrap();
        assert_eq!(password, decrypted);
    }
}
```

**Step 2: 添加缺失依赖到 Cargo.toml**

在 `src-tauri/Cargo.toml` 添加：

```toml
sha2 = "0.10"
rand = "0.8"
```

**Step 3: 更新模块导出**

Modify `src-tauri/src/database/mod.rs`:

```rust
pub mod crypto;
pub mod types;

pub use types::*;
```

**Step 4: 验证编译**

Run: `cd /Users/liushiquan/.openclaw/workspace/dev-toolkit/src-tauri && cargo check`

Expected: 编译成功

**Step 5: Commit**

```bash
git add src-tauri/src/database/crypto.rs src-tauri/src/database/mod.rs src-tauri/Cargo.toml
git commit -m "feat(db): 实现密码 AES-256-GCM 加密模块"
```

---

## Task 4: 实现连接配置存储

**Files:**
- Create: `src-tauri/src/database/storage.rs`
- Modify: `src-tauri/src/database/mod.rs`

**Step 1: 创建存储模块**

Create `src-tauri/src/database/storage.rs`:

```rust
use crate::database::{ConnectionConfig, SavedConnection};
use rusqlite::{Connection, Result as SqliteResult};
use std::path::PathBuf;

/// 获取数据库文件路径
fn get_db_path() -> PathBuf {
    let data_dir = dirs::data_local_dir()
        .or_else(|| dirs::data_dir())
        .unwrap_or_else(|| PathBuf::from("."));
    data_dir.join("dev-toolkit").join("connections.db")
}

/// 初始化数据库表
pub fn init_storage() -> SqliteResult<()> {
    let path = get_db_path();
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).ok();
    }

    let conn = Connection::open(&path)?;
    conn.execute(
        "CREATE TABLE IF NOT EXISTS connections (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            db_type TEXT NOT NULL,
            host TEXT NOT NULL,
            port INTEGER NOT NULL,
            username TEXT NOT NULL,
            encrypted_password TEXT NOT NULL,
            database TEXT NOT NULL,
            ssl_mode TEXT NOT NULL DEFAULT 'preferred',
            options TEXT,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
        )",
        [],
    )?;
    Ok(())
}

/// 保存连接配置
pub fn save_connection(config: ConnectionConfig) -> Result<SavedConnection, String> {
    init_storage().map_err(|e| format!("初始化存储失败: {}", e))?;

    let id = uuid::Uuid::new_v4().to_string();
    let encrypted_password = super::crypto::encrypt_password(&config.password)?;
    let now = chrono::Utc::now().timestamp();

    let saved = SavedConnection {
        id: id.clone(),
        name: config.name,
        db_type: config.db_type,
        host: config.host,
        port: config.port,
        username: config.username,
        encrypted_password,
        database: config.database,
        ssl_mode: config.ssl_mode,
        options: config.options,
        created_at: now,
        updated_at: now,
    };

    let path = get_db_path();
    let conn = Connection::open(&path).map_err(|e| format!("打开数据库失败: {}", e))?;

    conn.execute(
        "INSERT INTO connections (id, name, db_type, host, port, username, encrypted_password, database, ssl_mode, options, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
        rusqlite::params![
            saved.id,
            saved.name,
            serde_json::to_string(&saved.db_type).unwrap_or_default(),
            saved.host,
            saved.port,
            saved.username,
            saved.encrypted_password,
            saved.database,
            serde_json::to_string(&saved.ssl_mode).unwrap_or_default(),
            serde_json::to_string(&saved.options).unwrap_or_default(),
            saved.created_at,
            saved.updated_at,
        ],
    ).map_err(|e| format!("保存连接失败: {}", e))?;

    Ok(saved)
}

/// 获取所有保存的连接
pub fn list_connections() -> Result<Vec<SavedConnection>, String> {
    init_storage().map_err(|e| format!("初始化存储失败: {}", e))?;

    let path = get_db_path();
    let conn = Connection::open(&path).map_err(|e| format!("打开数据库失败: {}", e))?;

    let mut stmt = conn
        .prepare(
            "SELECT id, name, db_type, host, port, username, encrypted_password, database, ssl_mode, options, created_at, updated_at FROM connections ORDER BY created_at DESC",
        )
        .map_err(|e| format!("查询失败: {}", e))?;

    let connections = stmt
        .query_map([], |row| {
            Ok(SavedConnection {
                id: row.get(0)?,
                name: row.get(1)?,
                db_type: serde_json::from_str(&row.get::<_, String>(2)?).unwrap_or(crate::database::types::DbType::MySQL),
                host: row.get(3)?,
                port: row.get(4)?,
                username: row.get(5)?,
                encrypted_password: row.get(6)?,
                database: row.get(7)?,
                ssl_mode: serde_json::from_str(&row.get::<_, String>(8)?).unwrap_or_default(),
                options: serde_json::from_str(&row.get::<_, String>(9)?).unwrap_or_default(),
                created_at: row.get(10)?,
                updated_at: row.get(11)?,
            })
        })
        .map_err(|e| format!("读取连接列表失败: {}", e))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("解析连接列表失败: {}", e))?;

    Ok(connections)
}

/// 删除连接
pub fn delete_connection(id: &str) -> Result<(), String> {
    let path = get_db_path();
    let conn = Connection::open(&path).map_err(|e| format!("打开数据库失败: {}", e))?;

    conn.execute("DELETE FROM connections WHERE id = ?1", [id])
        .map_err(|e| format!("删除连接失败: {}", e))?;

    Ok(())
}

/// 获取单个连接（含解密密码）
pub fn get_connection(id: &str) -> Result<(SavedConnection, String), String> {
    let path = get_db_path();
    let conn = Connection::open(&path).map_err(|e| format!("打开数据库失败: {}", e))?;

    let mut stmt = conn
        .prepare(
            "SELECT id, name, db_type, host, port, username, encrypted_password, database, ssl_mode, options, created_at, updated_at FROM connections WHERE id = ?1",
        )
        .map_err(|e| format!("查询失败: {}", e))?;

    let saved = stmt
        .query_row([id], |row| {
            Ok(SavedConnection {
                id: row.get(0)?,
                name: row.get(1)?,
                db_type: serde_json::from_str(&row.get::<_, String>(2)?).unwrap_or(crate::database::types::DbType::MySQL),
                host: row.get(3)?,
                port: row.get(4)?,
                username: row.get(5)?,
                encrypted_password: row.get(6)?,
                database: row.get(7)?,
                ssl_mode: serde_json::from_str(&row.get::<_, String>(8)?).unwrap_or_default(),
                options: serde_json::from_str(&row.get::<_, String>(9)?).unwrap_or_default(),
                created_at: row.get(10)?,
                updated_at: row.get(11)?,
            })
        })
        .map_err(|e| format!("连接不存在: {}", e))?;

    let password = super::crypto::decrypt_password(&saved.encrypted_password)?;

    Ok((saved, password))
}
```

**Step 2: 添加 dirs 依赖**

在 `src-tauri/Cargo.toml` 添加：

```toml
dirs = "5"
```

**Step 3: 更新模块导出**

Modify `src-tauri/src/database/mod.rs`:

```rust
pub mod crypto;
pub mod storage;
pub mod types;

pub use types::*;
```

**Step 4: 验证编译**

Run: `cd /Users/liushiquan/.openclaw/workspace/dev-toolkit/src-tauri && cargo check`

Expected: 编译成功

**Step 5: Commit**

```bash
git add src-tauri/src/database/storage.rs src-tauri/src/database/mod.rs src-tauri/Cargo.toml
git commit -m "feat(db): 实现连接配置本地 SQLite 存储"
```

---

## Task 5: 实现 MySQL 连接器

**Files:**
- Create: `src-tauri/src/database/mysql.rs`
- Modify: `src-tauri/src/database/mod.rs`

**Step 1: 创建 MySQL 连接器**

Create `src-tauri/src/database/mysql.rs`:

```rust
use crate::database::{ColumnInfo, ConnectionConfig, DatabaseInfo, ExecuteResult, QueryResult, TableInfo, TableSchema, ColumnSchema};
use sqlx::mysql::{MySqlPoolOptions, MySqlRow};
use sqlx::{Column, Row};
use std::time::Instant;

/// 构建 MySQL 连接字符串
pub fn build_connection_string(config: &ConnectionConfig) -> String {
    let ssl_mode = match &config.ssl_mode {
        crate::database::types::SslMode::Disabled => "false",
        crate::database::types::SslMode::Preferred => "preferred",
        crate::database::types::SslMode::Required | crate::database::types::SslMode::VerifyIdentity => "true",
    };

    format!(
        "mysql://{}:{}@{}:{}/{}?ssl-mode={}",
        urlencoding::encode(&config.username),
        urlencoding::encode(&config.password),
        config.host,
        config.port,
        config.database,
        ssl_mode
    )
}

/// 测试 MySQL 连接
pub async fn test_connection(config: &ConnectionConfig) -> Result<String, String> {
    let url = build_connection_string(config);
    let pool = MySqlPoolOptions::new()
        .max_connections(1)
        .connect(&url)
        .await
        .map_err(|e| format!("连接失败: {}", e))?;

    let row: MySqlRow = sqlx::query("SELECT VERSION()")
        .fetch_one(&pool)
        .await
        .map_err(|e| format!("查询版本失败: {}", e))?;

    let version: String = row.get(0);
    pool.close().await;

    Ok(version)
}

/// 获取数据库列表
pub async fn get_databases(pool: &sqlx::mysql::MySqlPool) -> Result<Vec<DatabaseInfo>, String> {
    let rows = sqlx::query("SHOW DATABASES")
        .fetch_all(pool)
        .await
        .map_err(|e| format!("查询数据库列表失败: {}", e))?;

    Ok(rows
        .iter()
        .map(|row| DatabaseInfo {
            name: row.get(0),
            charset: None,
            collation: None,
        })
        .collect())
}

/// 获取表列表
pub async fn get_tables(pool: &sqlx::mysql::MySqlPool, database: &str) -> Result<Vec<TableInfo>, String> {
    let query = format!(
        "SELECT TABLE_NAME, TABLE_TYPE, TABLE_ROWS FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME"
    );
    let rows = sqlx::query(&query)
        .bind(database)
        .fetch_all(pool)
        .await
        .map_err(|e| format!("查询表列表失败: {}", e))?;

    Ok(rows
        .iter()
        .map(|row| TableInfo {
            name: row.get(0),
            schema: Some(database.to_string()),
            table_type: row.get::<String, _>(1),
            row_count: row.get::<Option<i64>, _>(2),
        })
        .collect())
}

/// 获取表结构
pub async fn get_table_schema(
    pool: &sqlx::mysql::MySqlPool,
    database: &str,
    table: &str,
) -> Result<TableSchema, String> {
    let query = r#"
        SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT, COLUMN_KEY, COLUMN_COMMENT
        FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
        ORDER BY ORDINAL_POSITION
    "#;

    let rows = sqlx::query(query)
        .bind(database)
        .bind(table)
        .fetch_all(pool)
        .await
        .map_err(|e| format!("查询表结构失败: {}", e))?;

    let columns: Vec<ColumnSchema> = rows
        .iter()
        .map(|row| ColumnSchema {
            name: row.get(0),
            data_type: row.get(1),
            nullable: row.get::<String, _>(2) == "YES",
            default: row.get(3),
            is_primary_key: row.get::<String, _>(4) == "PRI",
            comment: Some(row.get(5)).filter(|s: &String| !s.is_empty()),
        })
        .collect();

    Ok(TableSchema {
        name: table.to_string(),
        columns,
    })
}

/// 执行查询
pub async fn execute_query(
    pool: &sqlx::mysql::MySqlPool,
    sql: &str,
) -> Result<QueryResult, String> {
    let start = Instant::now();

    let result = sqlx::query(sql).fetch_all(pool).await;

    match result {
        Ok(rows) => {
            if rows.is_empty() {
                return Ok(QueryResult {
                    success: true,
                    columns: vec![],
                    rows: vec![],
                    row_count: 0,
                    execution_time_ms: start.elapsed().as_millis() as u64,
                    error: None,
                });
            }

            let columns: Vec<ColumnInfo> = rows[0]
                .columns()
                .iter()
                .map(|col| ColumnInfo {
                    name: col.name().to_string(),
                    data_type: "text".to_string(), // MySQL 不提供类型信息
                    nullable: true,
                })
                .collect();

            let data: Vec<Vec<Option<String>>> = rows
                .iter()
                .map(|row| {
                    row.columns()
                        .iter()
                        .map(|col| row.try_get::<Option<String>, _>(col.name()).ok().flatten())
                        .collect()
                })
                .collect();

            let row_count = data.len();

            Ok(QueryResult {
                success: true,
                columns,
                rows: data,
                row_count,
                execution_time_ms: start.elapsed().as_millis() as u64,
                error: None,
            })
        }
        Err(e) => Ok(QueryResult {
            success: false,
            columns: vec![],
            rows: vec![],
            row_count: 0,
            execution_time_ms: start.elapsed().as_millis() as u64,
            error: Some(e.to_string()),
        }),
    }
}

/// 执行语句
pub async fn execute_statement(
    pool: &sqlx::mysql::MySqlPool,
    sql: &str,
) -> Result<ExecuteResult, String> {
    let start = Instant::now();

    let result = sqlx::query(sql).execute(pool).await;

    match result {
        Ok(exec_result) => Ok(ExecuteResult {
            success: true,
            affected_rows: exec_result.rows_affected(),
            last_insert_id: Some(exec_result.last_insert_id() as i64),
            execution_time_ms: start.elapsed().as_millis() as u64,
            error: None,
        }),
        Err(e) => Ok(ExecuteResult {
            success: false,
            affected_rows: 0,
            last_insert_id: None,
            execution_time_ms: start.elapsed().as_millis() as u64,
            error: Some(e.to_string()),
        }),
    }
}
```

**Step 2: 验证编译**

Run: `cd /Users/liushiquan/.openclaw/workspace/dev-toolkit/src-tauri && cargo check`

Expected: 编译成功

**Step 3: Commit**

```bash
git add src-tauri/src/database/mysql.rs
git commit -m "feat(db): 实现 MySQL 连接器 (连接测试、查询、表结构)"
```

---

## Task 6: 实现连接池管理器

**Files:**
- Create: `src-tauri/src/database/pool.rs`
- Modify: `src-tauri/src/database/mod.rs`

**Step 1: 创建连接池管理器**

Create `src-tauri/src/database/pool.rs`:

```rust
use crate::database::{ConnectionConfig, DbType};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;

/// 连接池类型别名
pub type MySqlPool = sqlx::mysql::MySqlPool;
pub type PostgresPool = sqlx::postgres::PgPool;
pub type SqlitePool = sqlx::sqlite::SqlitePool;

/// 活跃连接
pub enum ActivePool {
    MySql(MySqlPool),
    Postgres(PostgresPool),
    Sqlite(SqlitePool),
}

/// 连接池管理器
pub struct ConnectionPoolManager {
    pools: Arc<RwLock<HashMap<String, ActivePool>>>,
}

impl ConnectionPoolManager {
    pub fn new() -> Self {
        Self {
            pools: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    /// 创建连接池
    pub async fn create_pool(&self, id: String, config: &ConnectionConfig) -> Result<(), String> {
        let pool = match config.db_type {
            DbType::MySQL => {
                let url = super::mysql::build_connection_string(config);
                let pool = sqlx::mysql::MySqlPoolOptions::new()
                    .max_connections(5)
                    .connect(&url)
                    .await
                    .map_err(|e| format!("连接失败: {}", e))?;
                ActivePool::MySql(pool)
            }
            DbType::PostgreSQL => {
                let url = super::postgres::build_connection_string(config);
                let pool = sqlx::postgres::PgPoolOptions::new()
                    .max_connections(5)
                    .connect(&url)
                    .await
                    .map_err(|e| format!("连接失败: {}", e))?;
                ActivePool::Postgres(pool)
            }
            DbType::SQLite => {
                let url = super::sqlite::build_connection_string(config);
                let pool = sqlx::sqlite::SqlitePoolOptions::new()
                    .max_connections(1)
                    .connect(&url)
                    .await
                    .map_err(|e| format!("连接失败: {}", e))?;
                ActivePool::Sqlite(pool)
            }
        };

        let mut pools = self.pools.write().await;
        pools.insert(id, pool);

        Ok(())
    }

    /// 获取连接池
    pub async fn get_pool(&self, id: &str) -> Option<ActivePool> {
        let pools = self.pools.read().await;
        pools.get(id).map(|p| match p {
            ActivePool::MySql(p) => ActivePool::MySql(p.clone()),
            ActivePool::Postgres(p) => ActivePool::Postgres(p.clone()),
            ActivePool::Sqlite(p) => ActivePool::Sqlite(p.clone()),
        })
    }

    /// 关闭连接池
    pub async fn close_pool(&self, id: &str) {
        let mut pools = self.pools.write().await;
        if let Some(pool) = pools.remove(id) {
            match pool {
                ActivePool::MySql(p) => p.close().await,
                ActivePool::Postgres(p) => p.close().await,
                ActivePool::Sqlite(p) => p.close().await,
            }
        }
    }

    /// 关闭所有连接池
    pub async fn close_all(&self) {
        let mut pools = self.pools.write().await;
        for (_, pool) in pools.drain() {
            match pool {
                ActivePool::MySql(p) => p.close().await,
                ActivePool::Postgres(p) => p.close().await,
                ActivePool::Sqlite(p) => p.close().await,
            }
        }
    }
}

impl Default for ConnectionPoolManager {
    fn default() -> Self {
        Self::new()
    }
}
```

**Step 2: 更新模块导出**

Modify `src-tauri/src/database/mod.rs`:

```rust
pub mod crypto;
pub mod mysql;
pub mod pool;
pub mod postgres;
pub mod sqlite;
pub mod storage;
pub mod types;

pub use pool::*;
pub use types::*;
```

**Step 3: 验证编译（预期失败，需要 postgres 和 sqlite 模块）**

Run: `cd /Users/liushiquan/.openclaw/workspace/dev-toolkit/src-tauri && cargo check`

Expected: 提示缺少 postgres 和 sqlite 模块

**Step 4: Commit**

```bash
git add src-tauri/src/database/pool.rs src-tauri/src/database/mod.rs
git commit -m "feat(db): 实现连接池管理器"
```

---

## Task 7: 实现 PostgreSQL 连接器

**Files:**
- Create: `src-tauri/src/database/postgres.rs`

**Step 1: 创建 PostgreSQL 连接器**

Create `src-tauri/src/database/postgres.rs`:

```rust
use crate::database::{ColumnInfo, ConnectionConfig, DatabaseInfo, ExecuteResult, QueryResult, TableInfo, TableSchema, ColumnSchema};
use sqlx::postgres::{PgPoolOptions, PgRow};
use sqlx::{Column, Row};
use std::time::Instant;

/// 构建 PostgreSQL 连接字符串
pub fn build_connection_string(config: &ConnectionConfig) -> String {
    let ssl_mode = match &config.ssl_mode {
        crate::database::types::SslMode::Disabled => "disable",
        crate::database::types::SslMode::Preferred => "prefer",
        crate::database::types::SslMode::Required => "require",
        crate::database::types::SslMode::VerifyIdentity => "verify-full",
    };

    format!(
        "postgres://{}:{}@{}:{}/{}?sslmode={}",
        urlencoding::encode(&config.username),
        urlencoding::encode(&config.password),
        config.host,
        config.port,
        config.database,
        ssl_mode
    )
}

/// 测试 PostgreSQL 连接
pub async fn test_connection(config: &ConnectionConfig) -> Result<String, String> {
    let url = build_connection_string(config);
    let pool = PgPoolOptions::new()
        .max_connections(1)
        .connect(&url)
        .await
        .map_err(|e| format!("连接失败: {}", e))?;

    let row: PgRow = sqlx::query("SELECT version()")
        .fetch_one(&pool)
        .await
        .map_err(|e| format!("查询版本失败: {}", e))?;

    let version: String = row.get(0);
    pool.close().await;

    Ok(version)
}

/// 获取数据库列表
pub async fn get_databases(pool: &sqlx::postgres::PgPool) -> Result<Vec<DatabaseInfo>, String> {
    let rows = sqlx::query("SELECT datname FROM pg_database WHERE datistemplate = false")
        .fetch_all(pool)
        .await
        .map_err(|e| format!("查询数据库列表失败: {}", e))?;

    Ok(rows
        .iter()
        .map(|row| DatabaseInfo {
            name: row.get(0),
            charset: None,
            collation: None,
        })
        .collect())
}

/// 获取表列表
pub async fn get_tables(pool: &sqlx::postgres::PgPool, schema: &str) -> Result<Vec<TableInfo>, String> {
    let query = r#"
        SELECT table_name, table_type
        FROM information_schema.tables
        WHERE table_schema = $1
        ORDER BY table_name
    "#;

    let rows = sqlx::query(query)
        .bind(schema)
        .fetch_all(pool)
        .await
        .map_err(|e| format!("查询表列表失败: {}", e))?;

    Ok(rows
        .iter()
        .map(|row| TableInfo {
            name: row.get(0),
            schema: Some(schema.to_string()),
            table_type: row.get(1),
            row_count: None,
        })
        .collect())
}

/// 获取表结构
pub async fn get_table_schema(
    pool: &sqlx::postgres::PgPool,
    schema: &str,
    table: &str,
) -> Result<TableSchema, String> {
    let query = r#"
        SELECT column_name, data_type, is_nullable, column_default
        FROM information_schema.columns
        WHERE table_schema = $1 AND table_name = $2
        ORDER BY ordinal_position
    "#;

    let rows = sqlx::query(query)
        .bind(schema)
        .bind(table)
        .fetch_all(pool)
        .await
        .map_err(|e| format!("查询表结构失败: {}", e))?;

    let columns: Vec<ColumnSchema> = rows
        .iter()
        .map(|row| ColumnSchema {
            name: row.get(0),
            data_type: row.get(1),
            nullable: row.get::<String, _>(2) == "YES",
            default: row.get(3),
            is_primary_key: false, // 需要额外查询
            comment: None,
        })
        .collect();

    Ok(TableSchema {
        name: table.to_string(),
        columns,
    })
}

/// 执行查询
pub async fn execute_query(
    pool: &sqlx::postgres::PgPool,
    sql: &str,
) -> Result<QueryResult, String> {
    let start = Instant::now();

    let result = sqlx::query(sql).fetch_all(pool).await;

    match result {
        Ok(rows) => {
            if rows.is_empty() {
                return Ok(QueryResult {
                    success: true,
                    columns: vec![],
                    rows: vec![],
                    row_count: 0,
                    execution_time_ms: start.elapsed().as_millis() as u64,
                    error: None,
                });
            }

            let columns: Vec<ColumnInfo> = rows[0]
                .columns()
                .iter()
                .map(|col| ColumnInfo {
                    name: col.name().to_string(),
                    data_type: "text".to_string(),
                    nullable: true,
                })
                .collect();

            let data: Vec<Vec<Option<String>>> = rows
                .iter()
                .map(|row| {
                    row.columns()
                        .iter()
                        .map(|col| row.try_get::<Option<String>, _>(col.name()).ok().flatten())
                        .collect()
                })
                .collect();

            let row_count = data.len();

            Ok(QueryResult {
                success: true,
                columns,
                rows: data,
                row_count,
                execution_time_ms: start.elapsed().as_millis() as u64,
                error: None,
            })
        }
        Err(e) => Ok(QueryResult {
            success: false,
            columns: vec![],
            rows: vec![],
            row_count: 0,
            execution_time_ms: start.elapsed().as_millis() as u64,
            error: Some(e.to_string()),
        }),
    }
}

/// 执行语句
pub async fn execute_statement(
    pool: &sqlx::postgres::PgPool,
    sql: &str,
) -> Result<ExecuteResult, String> {
    let start = Instant::now();

    let result = sqlx::query(sql).execute(pool).await;

    match result {
        Ok(exec_result) => Ok(ExecuteResult {
            success: true,
            affected_rows: exec_result.rows_affected(),
            last_insert_id: None,
            execution_time_ms: start.elapsed().as_millis() as u64,
            error: None,
        }),
        Err(e) => Ok(ExecuteResult {
            success: false,
            affected_rows: 0,
            last_insert_id: None,
            execution_time_ms: start.elapsed().as_millis() as u64,
            error: Some(e.to_string()),
        }),
    }
}
```

**Step 2: 验证编译**

Run: `cd /Users/liushiquan/.openclaw/workspace/dev-toolkit/src-tauri && cargo check`

Expected: 提示缺少 sqlite 模块

**Step 3: Commit**

```bash
git add src-tauri/src/database/postgres.rs
git commit -m "feat(db): 实现 PostgreSQL 连接器"
```

---

## Task 8: 实现 SQLite 连接器

**Files:**
- Create: `src-tauri/src/database/sqlite.rs`

**Step 1: 创建 SQLite 连接器**

Create `src-tauri/src/database/sqlite.rs`:

```rust
use crate::database::{ColumnInfo, ConnectionConfig, ExecuteResult, QueryResult, TableInfo, TableSchema, ColumnSchema};
use sqlx::sqlite::{SqlitePoolOptions, SqliteRow};
use sqlx::{Column, Row};
use std::time::Instant;

/// 构建 SQLite 连接字符串
pub fn build_connection_string(config: &ConnectionConfig) -> String {
    // SQLite 使用文件路径作为 database
    format!("sqlite:{}?mode=rwc", config.database)
}

/// 测试 SQLite 连接
pub async fn test_connection(config: &ConnectionConfig) -> Result<String, String> {
    let url = build_connection_string(config);
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect(&url)
        .await
        .map_err(|e| format!("连接失败: {}", e))?;

    let row: SqliteRow = sqlx::query("SELECT sqlite_version()")
        .fetch_one(&pool)
        .await
        .map_err(|e| format!("查询版本失败: {}", e))?;

    let version: String = row.get(0);
    pool.close().await;

    Ok(format!("SQLite {}", version))
}

/// 获取表列表
pub async fn get_tables(pool: &sqlx::sqlite::SqlitePool) -> Result<Vec<TableInfo>, String> {
    let query = r#"
        SELECT name, type
        FROM sqlite_master
        WHERE type IN ('table', 'view')
        ORDER BY name
    "#;

    let rows = sqlx::query(query)
        .fetch_all(pool)
        .await
        .map_err(|e| format!("查询表列表失败: {}", e))?;

    Ok(rows
        .iter()
        .map(|row| TableInfo {
            name: row.get(0),
            schema: None,
            table_type: row.get(1),
            row_count: None,
        })
        .collect())
}

/// 获取表结构
pub async fn get_table_schema(
    pool: &sqlx::sqlite::SqlitePool,
    table: &str,
) -> Result<TableSchema, String> {
    let query = format!("PRAGMA table_info({})", table);

    let rows = sqlx::query(&query)
        .fetch_all(pool)
        .await
        .map_err(|e| format!("查询表结构失败: {}", e))?;

    let columns: Vec<ColumnSchema> = rows
        .iter()
        .map(|row| ColumnSchema {
            name: row.get(1),
            data_type: row.get(2),
            nullable: row.get::<i32, _>(3) == 0,
            default: row.get(4),
            is_primary_key: row.get::<i32, _>(5) == 1,
            comment: None,
        })
        .collect();

    Ok(TableSchema {
        name: table.to_string(),
        columns,
    })
}

/// 执行查询
pub async fn execute_query(
    pool: &sqlx::sqlite::SqlitePool,
    sql: &str,
) -> Result<QueryResult, String> {
    let start = Instant::now();

    let result = sqlx::query(sql).fetch_all(pool).await;

    match result {
        Ok(rows) => {
            if rows.is_empty() {
                return Ok(QueryResult {
                    success: true,
                    columns: vec![],
                    rows: vec![],
                    row_count: 0,
                    execution_time_ms: start.elapsed().as_millis() as u64,
                    error: None,
                });
            }

            let columns: Vec<ColumnInfo> = rows[0]
                .columns()
                .iter()
                .map(|col| ColumnInfo {
                    name: col.name().to_string(),
                    data_type: "text".to_string(),
                    nullable: true,
                })
                .collect();

            let data: Vec<Vec<Option<String>>> = rows
                .iter()
                .map(|row| {
                    row.columns()
                        .iter()
                        .map(|col| row.try_get::<Option<String>, _>(col.name()).ok().flatten())
                        .collect()
                })
                .collect();

            let row_count = data.len();

            Ok(QueryResult {
                success: true,
                columns,
                rows: data,
                row_count,
                execution_time_ms: start.elapsed().as_millis() as u64,
                error: None,
            })
        }
        Err(e) => Ok(QueryResult {
            success: false,
            columns: vec![],
            rows: vec![],
            row_count: 0,
            execution_time_ms: start.elapsed().as_millis() as u64,
            error: Some(e.to_string()),
        }),
    }
}

/// 执行语句
pub async fn execute_statement(
    pool: &sqlx::sqlite::SqlitePool,
    sql: &str,
) -> Result<ExecuteResult, String> {
    let start = Instant::now();

    let result = sqlx::query(sql).execute(pool).await;

    match result {
        Ok(exec_result) => Ok(ExecuteResult {
            success: true,
            affected_rows: exec_result.rows_affected(),
            last_insert_id: Some(exec_result.last_insert_rowid()),
            execution_time_ms: start.elapsed().as_millis() as u64,
            error: None,
        }),
        Err(e) => Ok(ExecuteResult {
            success: false,
            affected_rows: 0,
            last_insert_id: None,
            execution_time_ms: start.elapsed().as_millis() as u64,
            error: Some(e.to_string()),
        }),
    }
}
```

**Step 2: 验证编译**

Run: `cd /Users/liushiquan/.openclaw/workspace/dev-toolkit/src-tauri && cargo check`

Expected: 编译成功

**Step 3: Commit**

```bash
git add src-tauri/src/database/sqlite.rs
git commit -m "feat(db): 实现 SQLite 连接器"
```

---

## Task 9: 实现 Tauri 命令

**Files:**
- Create: `src-tauri/src/database/commands.rs`
- Modify: `src-tauri/src/lib.rs`

**Step 1: 创建 Tauri 命令**

Create `src-tauri/src/database/commands.rs`:

```rust
use crate::database::{ConnectionConfig, ConnectionPoolManager, DbType, SavedConnection, TestResult};
use tauri::State;

/// 测试数据库连接
#[tauri::command]
pub async fn db_test_connection(config: ConnectionConfig) -> TestResult {
    let result = match config.db_type {
        DbType::MySQL => super::mysql::test_connection(&config).await,
        DbType::PostgreSQL => super::postgres::test_connection(&config).await,
        DbType::SQLite => super::sqlite::test_connection(&config).await,
    };

    match result {
        Ok(version) => TestResult {
            success: true,
            message: "连接成功".to_string(),
            server_version: Some(version),
        },
        Err(e) => TestResult {
            success: false,
            message: e,
            server_version: None,
        },
    }
}

/// 保存连接配置
#[tauri::command]
pub fn db_save_connection(config: ConnectionConfig) -> Result<SavedConnection, String> {
    super::storage::save_connection(config)
}

/// 获取所有保存的连接
#[tauri::command]
pub fn db_list_connections() -> Result<Vec<SavedConnection>, String> {
    super::storage::list_connections()
}

/// 删除连接
#[tauri::command]
pub fn db_delete_connection(id: String) -> Result<(), String> {
    super::storage::delete_connection(&id)
}

/// 建立连接
#[tauri::command]
pub async fn db_connect(
    id: String,
    pool_manager: State<'_, ConnectionPoolManager>,
) -> Result<(), String> {
    let (saved, password) = super::storage::get_connection(&id)?;

    let config = ConnectionConfig {
        name: saved.name,
        db_type: saved.db_type,
        host: saved.host,
        port: saved.port,
        username: saved.username,
        password,
        database: saved.database,
        ssl_mode: saved.ssl_mode,
        options: saved.options,
    };

    pool_manager.create_pool(id, &config).await
}

/// 断开连接
#[tauri::command]
pub async fn db_disconnect(
    id: String,
    pool_manager: State<'_, ConnectionPoolManager>,
) -> Result<(), String> {
    pool_manager.close_pool(&id).await;
    Ok(())
}

/// 执行查询
#[tauri::command]
pub async fn db_query(
    connection_id: String,
    sql: String,
    pool_manager: State<'_, ConnectionPoolManager>,
) -> Result<crate::database::QueryResult, String> {
    let pool = pool_manager.get_pool(&connection_id).await.ok_or("连接不存在")?;

    match pool {
        super::pool::ActivePool::MySql(p) => super::mysql::execute_query(&p, &sql).await,
        super::pool::ActivePool::Postgres(p) => super::postgres::execute_query(&p, &sql).await,
        super::pool::ActivePool::Sqlite(p) => super::sqlite::execute_query(&p, &sql).await,
    }
}

/// 执行语句
#[tauri::command]
pub async fn db_execute(
    connection_id: String,
    sql: String,
    pool_manager: State<'_, ConnectionPoolManager>,
) -> Result<crate::database::ExecuteResult, String> {
    let pool = pool_manager.get_pool(&connection_id).await.ok_or("连接不存在")?;

    match pool {
        super::pool::ActivePool::MySql(p) => super::mysql::execute_statement(&p, &sql).await,
        super::pool::ActivePool::Postgres(p) => super::postgres::execute_statement(&p, &sql).await,
        super::pool::ActivePool::Sqlite(p) => super::sqlite::execute_statement(&p, &sql).await,
    }
}

/// 获取表列表
#[tauri::command]
pub async fn db_get_tables(
    connection_id: String,
    database: String,
    pool_manager: State<'_, ConnectionPoolManager>,
) -> Result<Vec<crate::database::TableInfo>, String> {
    let pool = pool_manager.get_pool(&connection_id).await.ok_or("连接不存在")?;

    match pool {
        super::pool::ActivePool::MySql(p) => super::mysql::get_tables(&p, &database).await,
        super::pool::ActivePool::Postgres(p) => super::postgres::get_tables(&p, &database).await,
        super::pool::ActivePool::Sqlite(p) => super::sqlite::get_tables(&p).await,
    }
}

/// 获取表结构
#[tauri::command]
pub async fn db_get_table_schema(
    connection_id: String,
    database: String,
    table: String,
    pool_manager: State<'_, ConnectionPoolManager>,
) -> Result<crate::database::TableSchema, String> {
    let pool = pool_manager.get_pool(&connection_id).await.ok_or("连接不存在")?;

    match pool {
        super::pool::ActivePool::MySql(p) => super::mysql::get_table_schema(&p, &database, &table).await,
        super::pool::ActivePool::Postgres(p) => super::postgres::get_table_schema(&p, &database, &table).await,
        super::pool::ActivePool::Sqlite(p) => super::sqlite::get_table_schema(&p, &table).await,
    }
}
```

**Step 2: 更新模块导出**

Modify `src-tauri/src/database/mod.rs`:

```rust
pub mod commands;
pub mod crypto;
pub mod mysql;
pub mod pool;
pub mod postgres;
pub mod sqlite;
pub mod storage;
pub mod types;

pub use pool::*;
pub use types::*;
```

**Step 3: 在 lib.rs 注册命令和状态**

Modify `src-tauri/src/lib.rs`，在 `invoke_handler!` 中添加命令：

```rust
// 在 invoke_handler 的 generate_handler![] 中添加
commands::db_test_connection,
commands::db_save_connection,
commands::db_list_connections,
commands::db_delete_connection,
commands::db_connect,
commands::db_disconnect,
commands::db_query,
commands::db_execute,
commands::db_get_tables,
commands::db_get_table_schema,
```

并在 Builder 中添加状态管理：

```rust
.manage(database::ConnectionPoolManager::new())
```

**Step 4: 验证编译**

Run: `cd /Users/liushiquan/.openclaw/workspace/dev-toolkit/src-tauri && cargo check`

Expected: 编译成功

**Step 5: Commit**

```bash
git add src-tauri/src/database/commands.rs src-tauri/src/database/mod.rs src-tauri/src/lib.rs
git commit -m "feat(db): 实现 Tauri 数据库命令 (连接管理、查询、表结构)"
```

---

## Task 10: 添加前端 HTML 结构

**Files:**
- Modify: `src/index.html`
- Modify: `src/styles.css`

**Step 1: 在导航栏添加数据库入口**

在 `src/index.html` 的导航栏中添加：

```html
<li data-page="database">
    <span class="nav-icon">🗄️</span>
    <span class="nav-text">数据库</span>
</li>
```

**Step 2: 添加数据库页面结构**

在 `src/index.html` 中添加页面 section：

```html
<!-- 数据库工具 -->
<section id="page-database" class="page">
    <div class="db-container">
        <!-- 左侧连接面板 -->
        <div class="db-sidebar">
            <div class="db-sidebar-header">
                <h3>连接</h3>
                <button class="btn-icon" id="db-new-connection" title="新建连接">+</button>
            </div>
            <div class="db-connection-list" id="db-connection-list">
                <!-- 动态生成的连接列表 -->
            </div>
            <div class="db-tree" id="db-tree">
                <!-- 动态生成的数据库树 -->
            </div>
        </div>

        <!-- 右侧工作区 -->
        <div class="db-workspace">
            <div class="db-toolbar">
                <select id="db-connection-select" class="db-select">
                    <option value="">选择连接...</option>
                </select>
                <select id="db-database-select" class="db-select">
                    <option value="">选择数据库...</option>
                </select>
                <div class="db-toolbar-actions">
                    <button class="btn btn-primary" id="db-execute">执行</button>
                    <button class="btn" id="db-format">格式化</button>
                    <button class="btn" id="db-clear">清空</button>
                </div>
            </div>

            <div class="db-editor-container">
                <div class="db-editor-header">
                    <span>SQL 编辑器</span>
                    <div class="db-editor-actions">
                        <span class="btn-text" id="db-history">历史</span>
                        <span class="btn-text" id="db-favorites">收藏</span>
                    </div>
                </div>
                <textarea id="db-sql-input"></textarea>
            </div>

            <div class="db-resize-handle"></div>

            <div class="db-result-container">
                <div class="db-result-tabs">
                    <button class="tab active" data-tab="result">结果</button>
                    <button class="tab" data-tab="message">消息</button>
                </div>
                <div class="db-result-content" id="db-result-content">
                    <div class="db-result-placeholder">
                        执行查询查看结果
                    </div>
                </div>
                <div class="db-result-status">
                    <span id="db-result-info">就绪</span>
                    <div class="db-export-actions">
                        <button class="btn-text" id="db-export-csv">导出 CSV</button>
                        <button class="btn-text" id="db-export-json">导出 JSON</button>
                    </div>
                </div>
            </div>
        </div>
    </div>
</section>

<!-- 新建连接弹窗 -->
<div class="modal" id="db-connection-modal">
    <div class="modal-content db-modal">
        <div class="modal-header">
            <h3>新建连接</h3>
            <button class="modal-close">&times;</button>
        </div>
        <div class="modal-body">
            <form id="db-connection-form">
                <div class="form-group">
                    <label>连接名称</label>
                    <input type="text" name="name" required placeholder="我的数据库">
                </div>
                <div class="form-group">
                    <label>数据库类型</label>
                    <select name="db_type" id="db-type-select">
                        <option value="mysql">MySQL</option>
                        <option value="postgresql">PostgreSQL</option>
                        <option value="sqlite">SQLite</option>
                    </select>
                </div>
                <div class="form-row" id="db-host-row">
                    <div class="form-group">
                        <label>主机</label>
                        <input type="text" name="host" value="localhost">
                    </div>
                    <div class="form-group">
                        <label>端口</label>
                        <input type="number" name="port" id="db-port-input" value="3306">
                    </div>
                </div>
                <div class="form-group" id="db-username-row">
                    <label>用户名</label>
                    <input type="text" name="username" value="root">
                </div>
                <div class="form-group" id="db-password-row">
                    <label>密码</label>
                    <input type="password" name="password">
                </div>
                <div class="form-group" id="db-database-row">
                    <label>数据库</label>
                    <input type="text" name="database">
                </div>
                <div class="form-group" id="db-file-row" style="display: none;">
                    <label>数据库文件</label>
                    <div class="file-input-group">
                        <input type="text" name="database_file" id="db-file-path" readonly>
                        <button type="button" class="btn" id="db-browse-file">浏览...</button>
                    </div>
                </div>
            </form>
        </div>
        <div class="modal-footer">
            <button type="button" class="btn" id="db-test-connection">测试连接</button>
            <button type="button" class="btn btn-primary" id="db-save-connection">保存</button>
            <button type="button" class="btn modal-cancel">取消</button>
        </div>
    </div>
</div>
```

**Step 3: 添加数据库工具样式**

在 `src/styles.css` 末尾添加数据库工具样式：

```css
/* ========== 数据库工具样式 ========== */

.db-container {
    display: flex;
    height: 100%;
    gap: 0;
}

.db-sidebar {
    width: 280px;
    min-width: 200px;
    max-width: 400px;
    background: var(--bg-secondary);
    border-right: 1px solid var(--border);
    display: flex;
    flex-direction: column;
    resize: horizontal;
    overflow: hidden;
}

.db-sidebar-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 12px 16px;
    border-bottom: 1px solid var(--border);
}

.db-sidebar-header h3 {
    margin: 0;
    font-size: 14px;
    color: var(--fg);
}

.db-connection-list {
    max-height: 200px;
    overflow-y: auto;
    border-bottom: 1px solid var(--border);
}

.db-connection-item {
    display: flex;
    align-items: center;
    padding: 8px 16px;
    cursor: pointer;
    border-bottom: 1px solid var(--border-light);
}

.db-connection-item:hover {
    background: var(--bg-hover);
}

.db-connection-item.active {
    background: var(--bg-active);
}

.db-connection-icon {
    margin-right: 8px;
    font-size: 16px;
}

.db-connection-name {
    flex: 1;
    font-size: 13px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.db-connection-status {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--gray);
}

.db-connection-status.connected {
    background: var(--green);
}

.db-tree {
    flex: 1;
    overflow-y: auto;
    padding: 8px 0;
}

.db-tree-item {
    display: flex;
    align-items: center;
    padding: 6px 16px;
    cursor: pointer;
    font-size: 13px;
}

.db-tree-item:hover {
    background: var(--bg-hover);
}

.db-tree-item.selected {
    background: var(--bg-active);
}

.db-tree-icon {
    margin-right: 6px;
    font-size: 14px;
}

.db-tree-folder > .db-tree-icon {
    transition: transform 0.15s;
}

.db-tree-folder.open > .db-tree-icon {
    transform: rotate(90deg);
}

.db-tree-children {
    padding-left: 20px;
    display: none;
}

.db-tree-folder.open > .db-tree-children {
    display: block;
}

.db-workspace {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-width: 0;
    background: var(--bg);
}

.db-toolbar {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px 16px;
    background: var(--bg-secondary);
    border-bottom: 1px solid var(--border);
}

.db-select {
    padding: 6px 12px;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 4px;
    color: var(--fg);
    font-size: 13px;
    min-width: 150px;
}

.db-toolbar-actions {
    margin-left: auto;
    display: flex;
    gap: 8px;
}

.db-editor-container {
    flex: 0 0 auto;
    min-height: 150px;
    border-bottom: 1px solid var(--border);
}

.db-editor-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 8px 16px;
    background: var(--bg-secondary);
    border-bottom: 1px solid var(--border);
    font-size: 12px;
    color: var(--fg-muted);
}

.db-editor-actions {
    display: flex;
    gap: 12px;
}

#db-sql-input {
    width: 100%;
    height: 200px;
    border: none;
    padding: 12px 16px;
    font-family: var(--font-mono);
    font-size: 14px;
    line-height: 1.5;
    background: var(--bg);
    color: var(--fg);
    resize: vertical;
}

#db-sql-input:focus {
    outline: none;
}

.db-resize-handle {
    height: 6px;
    background: var(--border);
    cursor: row-resize;
}

.db-resize-handle:hover {
    background: var(--accent);
}

.db-result-container {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-height: 200px;
    overflow: hidden;
}

.db-result-tabs {
    display: flex;
    background: var(--bg-secondary);
    border-bottom: 1px solid var(--border);
}

.db-result-tabs .tab {
    padding: 8px 16px;
    background: none;
    border: none;
    color: var(--fg-muted);
    font-size: 13px;
    cursor: pointer;
    border-bottom: 2px solid transparent;
}

.db-result-tabs .tab.active {
    color: var(--fg);
    border-bottom-color: var(--accent);
}

.db-result-content {
    flex: 1;
    overflow: auto;
    padding: 16px;
}

.db-result-placeholder {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 100%;
    color: var(--fg-muted);
    font-size: 14px;
}

.db-result-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 13px;
}

.db-result-table th,
.db-result-table td {
    padding: 8px 12px;
    text-align: left;
    border-bottom: 1px solid var(--border);
}

.db-result-table th {
    background: var(--bg-secondary);
    font-weight: 600;
    position: sticky;
    top: 0;
    z-index: 1;
}

.db-result-table tr:hover td {
    background: var(--bg-hover);
}

.db-result-table td.null {
    color: var(--fg-muted);
    font-style: italic;
}

.db-result-status {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 8px 16px;
    background: var(--bg-secondary);
    border-top: 1px solid var(--border);
    font-size: 12px;
    color: var(--fg-muted);
}

.db-export-actions {
    display: flex;
    gap: 12px;
}

.btn-text {
    background: none;
    border: none;
    color: var(--accent);
    cursor: pointer;
    font-size: 12px;
}

.btn-text:hover {
    text-decoration: underline;
}

.btn-icon {
    width: 28px;
    height: 28px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 4px;
    color: var(--fg);
    font-size: 16px;
    cursor: pointer;
}

.btn-icon:hover {
    background: var(--bg-hover);
}

/* 连接弹窗 */
.db-modal {
    width: 480px;
}

.form-group {
    margin-bottom: 16px;
}

.form-group label {
    display: block;
    margin-bottom: 6px;
    font-size: 13px;
    color: var(--fg);
}

.form-group input,
.form-group select {
    width: 100%;
    padding: 8px 12px;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 4px;
    color: var(--fg);
    font-size: 14px;
}

.form-group input:focus,
.form-group select:focus {
    outline: none;
    border-color: var(--accent);
}

.form-row {
    display: flex;
    gap: 12px;
}

.form-row .form-group {
    flex: 1;
}

.file-input-group {
    display: flex;
    gap: 8px;
}

.file-input-group input {
    flex: 1;
}

.file-input-group .btn {
    flex-shrink: 0;
}

.modal-footer {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    padding: 16px;
    border-top: 1px solid var(--border);
}
```

**Step 4: Commit**

```bash
git add src/index.html src/styles.css
git commit -m "feat(db): 添加数据库工具前端 HTML 结构和样式"
```

---

## Task 11: 实现前端 JavaScript 逻辑

**Files:**
- Modify: `src/app.js`

**Step 1: 在 app.js 末尾添加数据库工具逻辑**

```javascript
// ==================== 数据库工具 ====================

const dbState = {
    connections: [],
    currentConnection: null,
    currentDatabase: null,
    editor: null,
    resultEditor: null,
};

// 初始化数据库工具
async function initDatabaseTool() {
    // 初始化 SQL 编辑器 (CodeMirror)
    const sqlInput = document.getElementById('db-sql-input');
    if (sqlInput && typeof CodeMirror !== 'undefined') {
        dbState.editor = CodeMirror.fromTextArea(sqlInput, {
            mode: 'text/x-sql',
            theme: 'dracula',
            lineNumbers: true,
            indentUnit: 2,
            tabSize: 2,
            lineWrapping: true,
            extraKeys: {
                'Cmd-Enter': executeQuery,
                'Ctrl-Enter': executeQuery,
            },
        });
    }

    // 绑定事件
    document.getElementById('db-new-connection')?.addEventListener('click', openConnectionModal);
    document.getElementById('db-test-connection')?.addEventListener('click', testConnection);
    document.getElementById('db-save-connection')?.addEventListener('click', saveConnection);
    document.getElementById('db-execute')?.addEventListener('click', executeQuery);
    document.getElementById('db-format')?.addEventListener('click', formatSql);
    document.getElementById('db-clear')?.addEventListener('click', clearSql);
    document.getElementById('db-type-select')?.addEventListener('change', handleDbTypeChange);
    document.getElementById('db-browse-file')?.addEventListener('click', browseSqliteFile);

    // 连接选择器
    document.getElementById('db-connection-select')?.addEventListener('change', handleConnectionChange);
    document.getElementById('db-database-select')?.addEventListener('change', handleDatabaseChange);

    // 加载保存的连接
    await loadConnections();

    // 处理数据库类型变化
    handleDbTypeChange();
}

// 打开连接弹窗
function openConnectionModal() {
    const modal = document.getElementById('db-connection-modal');
    if (modal) {
        modal.classList.add('active');
        document.getElementById('db-connection-form')?.reset();
        handleDbTypeChange();
    }
}

// 关闭连接弹窗
function closeConnectionModal() {
    const modal = document.getElementById('db-connection-modal');
    if (modal) {
        modal.classList.remove('active');
    }
}

// 处理数据库类型变化
function handleDbTypeChange() {
    const dbType = document.getElementById('db-type-select')?.value;
    const hostRow = document.getElementById('db-host-row');
    const usernameRow = document.getElementById('db-username-row');
    const passwordRow = document.getElementById('db-password-row');
    const databaseRow = document.getElementById('db-database-row');
    const fileRow = document.getElementById('db-file-row');
    const portInput = document.getElementById('db-port-input');

    if (dbType === 'sqlite') {
        hostRow.style.display = 'none';
        usernameRow.style.display = 'none';
        passwordRow.style.display = 'none';
        databaseRow.style.display = 'none';
        fileRow.style.display = 'block';
    } else {
        hostRow.style.display = 'flex';
        usernameRow.style.display = 'block';
        passwordRow.style.display = 'block';
        databaseRow.style.display = 'block';
        fileRow.style.display = 'none';

        // 更新默认端口
        const ports = { mysql: '3306', postgresql: '5432' };
        if (portInput) portInput.value = ports[dbType] || '3306';
    }
}

// 浏览 SQLite 文件
async function browseSqliteFile() {
    const result = await invoke('open_save_dialog', {
        defaultPath: '',
        filters: [{ name: 'SQLite', extensions: ['db', 'sqlite', 'sqlite3'] }],
    });
    if (result) {
        document.getElementById('db-file-path').value = result;
    }
}

// 测试连接
async function testConnection() {
    const form = document.getElementById('db-connection-form');
    const formData = new FormData(form);
    const dbType = formData.get('db_type');

    const config = {
        name: formData.get('name') || '测试连接',
        db_type: dbType,
        host: formData.get('host') || 'localhost',
        port: parseInt(formData.get('port')) || 3306,
        username: formData.get('username') || '',
        password: formData.get('password') || '',
        database: dbType === 'sqlite' ? formData.get('database_file') : formData.get('database'),
        ssl_mode: 'preferred',
        options: {},
    };

    showStatus('正在测试连接...', 'info');

    try {
        const result = await invoke('db_test_connection', { config });
        if (result.success) {
            showStatus(`连接成功! ${result.server_version || ''}`, 'success');
        } else {
            showStatus(`连接失败: ${result.message}`, 'error');
        }
    } catch (e) {
        showStatus(`测试失败: ${e}`, 'error');
    }
}

// 保存连接
async function saveConnection() {
    const form = document.getElementById('db-connection-form');
    const formData = new FormData(form);
    const dbType = formData.get('db_type');

    const config = {
        name: formData.get('name'),
        db_type: dbType,
        host: formData.get('host') || 'localhost',
        port: parseInt(formData.get('port')) || 3306,
        username: formData.get('username') || '',
        password: formData.get('password') || '',
        database: dbType === 'sqlite' ? formData.get('database_file') : formData.get('database'),
        ssl_mode: 'preferred',
        options: {},
    };

    try {
        const saved = await invoke('db_save_connection', { config });
        showStatus(`连接 "${saved.name}" 已保存`, 'success');
        closeConnectionModal();
        await loadConnections();
    } catch (e) {
        showStatus(`保存失败: ${e}`, 'error');
    }
}

// 加载连接列表
async function loadConnections() {
    try {
        const connections = await invoke('db_list_connections');
        dbState.connections = connections;

        renderConnectionList();
        updateConnectionSelect();
    } catch (e) {
        console.error('加载连接失败:', e);
    }
}

// 渲染连接列表
function renderConnectionList() {
    const list = document.getElementById('db-connection-list');
    if (!list) return;

    if (dbState.connections.length === 0) {
        list.innerHTML = '<div class="db-result-placeholder">暂无保存的连接</div>';
        return;
    }

    const icons = { mysql: '🐬', postgresql: '🐘', sqlite: '📦' };

    list.innerHTML = dbState.connections.map(conn => `
        <div class="db-connection-item" data-id="${conn.id}">
            <span class="db-connection-icon">${icons[conn.db_type] || '🗄️'}</span>
            <span class="db-connection-name">${conn.name}</span>
            <span class="db-connection-status"></span>
        </div>
    `).join('');

    // 绑定点击事件
    list.querySelectorAll('.db-connection-item').forEach(item => {
        item.addEventListener('click', () => connectToDatabase(item.dataset.id));
        item.addEventListener('contextmenu', (e) => showConnectionContextMenu(e, item.dataset.id));
    });
}

// 更新连接选择器
function updateConnectionSelect() {
    const select = document.getElementById('db-connection-select');
    if (!select) return;

    select.innerHTML = '<option value="">选择连接...</option>' +
        dbState.connections.map(conn => `<option value="${conn.id}">${conn.name}</option>`).join('');
}

// 连接到数据库
async function connectToDatabase(connectionId) {
    showStatus('正在连接...', 'info');

    try {
        await invoke('db_connect', { id: connectionId });
        dbState.currentConnection = connectionId;

        // 更新状态指示器
        const item = document.querySelector(`.db-connection-item[data-id="${connectionId}"]`);
        if (item) {
            item.classList.add('active');
            item.querySelector('.db-connection-status').classList.add('connected');
        }

        // 更新选择器
        document.getElementById('db-connection-select').value = connectionId;

        // 加载表列表
        await loadTables();

        showStatus('连接成功', 'success');
    } catch (e) {
        showStatus(`连接失败: ${e}`, 'error');
    }
}

// 处理连接选择变化
async function handleConnectionChange(e) {
    const connectionId = e.target.value;
    if (connectionId) {
        await connectToDatabase(connectionId);
    }
}

// 处理数据库选择变化
async function handleDatabaseChange(e) {
    dbState.currentDatabase = e.target.value;
    if (dbState.currentDatabase) {
        await loadTables();
    }
}

// 加载表列表
async function loadTables() {
    if (!dbState.currentConnection) return;

    const tree = document.getElementById('db-tree');
    if (!tree) return;

    try {
        const tables = await invoke('db_get_tables', {
            connectionId: dbState.currentConnection,
            database: dbState.currentDatabase || '',
        });

        renderTableTree(tables);
    } catch (e) {
        console.error('加载表列表失败:', e);
        tree.innerHTML = '<div class="db-result-placeholder">加载失败</div>';
    }
}

// 渲染表树
function renderTableTree(tables) {
    const tree = document.getElementById('db-tree');
    if (!tree) return;

    if (tables.length === 0) {
        tree.innerHTML = '<div class="db-result-placeholder">无表</div>';
        return;
    }

    const groups = {
        'BASE TABLE': [],
        'VIEW': [],
    };

    tables.forEach(t => {
        const type = t.table_type.toUpperCase();
        if (groups[type]) groups[type].push(t);
        else groups['BASE TABLE'].push(t);
    });

    let html = '';

    if (groups['BASE TABLE'].length > 0) {
        html += `
            <div class="db-tree-folder">
                <div class="db-tree-item"><span class="db-tree-icon">📁</span>表</div>
                <div class="db-tree-children">
                    ${groups['BASE TABLE'].map(t => `
                        <div class="db-tree-item" data-table="${t.name}">
                            <span class="db-tree-icon">📄</span>${t.name}
                        </div>
                    `).join('')}
                </div>
            </div>
        `;
    }

    if (groups['VIEW'].length > 0) {
        html += `
            <div class="db-tree-folder">
                <div class="db-tree-item"><span class="db-tree-icon">📁</span>视图</div>
                <div class="db-tree-children">
                    ${groups['VIEW'].map(t => `
                        <div class="db-tree-item" data-table="${t.name}">
                            <span class="db-tree-icon">👁️</span>${t.name}
                        </div>
                    `).join('')}
                </div>
            </div>
        `;
    }

    tree.innerHTML = html;

    // 绑定文件夹展开/折叠
    tree.querySelectorAll('.db-tree-folder > .db-tree-item').forEach(item => {
        item.addEventListener('click', (e) => {
            e.stopPropagation();
            item.parentElement.classList.toggle('open');
        });
    });

    // 绑定表点击事件
    tree.querySelectorAll('.db-tree-children .db-tree-item').forEach(item => {
        item.addEventListener('click', (e) => {
            e.stopPropagation();
            const tableName = item.dataset.table;
            insertSelectStatement(tableName);
        });
        item.addEventListener('dblclick', (e) => {
            e.stopPropagation();
            const tableName = item.dataset.table;
            showTableSchema(tableName);
        });
    });
}

// 插入 SELECT 语句
function insertSelectStatement(tableName) {
    const sql = `SELECT * FROM ${tableName} LIMIT 100;`;
    if (dbState.editor) {
        dbState.editor.setValue(sql);
    }
}

// 显示表结构
async function showTableSchema(tableName) {
    try {
        const schema = await invoke('db_get_table_schema', {
            connectionId: dbState.currentConnection,
            database: dbState.currentDatabase || '',
            table: tableName,
        });

        let sql = `-- ${tableName} 表结构\n`;
        schema.columns.forEach(col => {
            sql += `-- ${col.name}: ${col.data_type}`;
            if (col.is_primary_key) sql += ' PRIMARY KEY';
            if (!col.nullable) sql += ' NOT NULL';
            if (col.default) sql += ` DEFAULT ${col.default}`;
            sql += '\n';
        });

        if (dbState.editor) {
            dbState.editor.setValue(sql);
        }
    } catch (e) {
        showStatus(`获取表结构失败: ${e}`, 'error');
    }
}

// 执行查询
async function executeQuery() {
    if (!dbState.currentConnection) {
        showStatus('请先选择连接', 'error');
        return;
    }

    const sql = dbState.editor ? dbState.editor.getValue() : '';
    if (!sql.trim()) {
        showStatus('请输入 SQL 语句', 'error');
        return;
    }

    showStatus('执行中...', 'info');

    const startTime = Date.now();

    try {
        // 判断是查询还是执行
        const isQuery = /^\s*(SELECT|SHOW|DESC|DESCRIBE|EXPLAIN)/i.test(sql);

        if (isQuery) {
            const result = await invoke('db_query', {
                connectionId: dbState.currentConnection,
                sql,
            });
            displayQueryResult(result, Date.now() - startTime);
        } else {
            const result = await invoke('db_execute', {
                connectionId: dbState.currentConnection,
                sql,
            });
            displayExecuteResult(result, Date.now() - startTime);
        }
    } catch (e) {
        showStatus(`执行失败: ${e}`, 'error');
        displayError(e, Date.now() - startTime);
    }
}

// 显示查询结果
function displayQueryResult(result, duration) {
    const container = document.getElementById('db-result-content');
    const info = document.getElementById('db-result-info');

    if (!result.success) {
        displayError(result.error || '未知错误', duration);
        return;
    }

    if (result.row_count === 0) {
        container.innerHTML = '<div class="db-result-placeholder">查询返回 0 行</div>';
        info.textContent = `0 行 | ${duration}ms`;
        return;
    }

    let html = `<table class="db-result-table"><thead><tr>`;
    result.columns.forEach(col => {
        html += `<th>${col.name}</th>`;
    });
    html += `</tr></thead><tbody>`;

    result.rows.forEach(row => {
        html += '<tr>';
        row.forEach(cell => {
            html += `<td class="${cell === null ? 'null' : ''}">${cell === null ? 'NULL' : escapeHtml(cell)}</td>`;
        });
        html += '</tr>';
    });

    html += '</tbody></table>';
    container.innerHTML = html;

    info.textContent = `${result.row_count} 行 | ${duration}ms`;
    showStatus('查询完成', 'success');
}

// 显示执行结果
function displayExecuteResult(result, duration) {
    const container = document.getElementById('db-result-content');
    const info = document.getElementById('db-result-info');

    if (!result.success) {
        displayError(result.error || '未知错误', duration);
        return;
    }

    container.innerHTML = `<div class="db-result-placeholder">执行成功</div>`;

    let infoText = `影响 ${result.affected_rows} 行`;
    if (result.last_insert_id) {
        infoText += ` | 最后插入 ID: ${result.last_insert_id}`;
    }
    infoText += ` | ${duration}ms`;

    info.textContent = infoText;
    showStatus('执行完成', 'success');
}

// 显示错误
function displayError(error, duration) {
    const container = document.getElementById('db-result-content');
    const info = document.getElementById('db-result-info');

    container.innerHTML = `<div class="db-result-placeholder" style="color: var(--red);">错误: ${escapeHtml(error)}</div>`;
    info.textContent = `错误 | ${duration}ms`;
    showStatus('执行失败', 'error');
}

// 格式化 SQL
function formatSql() {
    if (!dbState.editor) return;

    let sql = dbState.editor.getValue();

    // 简单格式化
    sql = sql
        .replace(/\s+/g, ' ')
        .replace(/\s*,\s*/g, ', ')
        .replace(/\s+/g, ' ')
        .replace(/SELECT/gi, 'SELECT')
        .replace(/FROM/gi, '\nFROM')
        .replace(/WHERE/gi, '\nWHERE')
        .replace(/GROUP BY/gi, '\nGROUP BY')
        .replace(/ORDER BY/gi, '\nORDER BY')
        .replace(/LIMIT/gi, '\nLIMIT')
        .replace(/JOIN/gi, '\nJOIN')
        .replace(/LEFT JOIN/gi, '\nLEFT JOIN')
        .replace(/RIGHT JOIN/gi, '\nRIGHT JOIN')
        .replace(/INNER JOIN/gi, '\nINNER JOIN')
        .replace(/ON/gi, '\n  ON');

    dbState.editor.setValue(sql.trim());
}

// 清空 SQL
function clearSql() {
    if (dbState.editor) {
        dbState.editor.setValue('');
    }
}

// HTML 转义
function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

// 显示连接上下文菜单
function showConnectionContextMenu(e, connectionId) {
    e.preventDefault();
    // TODO: 实现右键菜单（删除、编辑等）
}

// 在页面切换时初始化
document.querySelectorAll('[data-page="database"]').forEach(item => {
    item.addEventListener('click', () => {
        setTimeout(initDatabaseTool, 100);
    });
});

// 首次加载时检查是否是数据库页面
if (document.querySelector('[data-page="database"]')?.classList.contains('active')) {
    initDatabaseTool();
}
```

**Step 2: Commit**

```bash
git add src/app.js
git commit -m "feat(db): 实现数据库工具前端 JavaScript 逻辑"
```

---

## Task 12: 编译测试

**Step 1: 编译项目**

Run: `cd /Users/liushiquan/.openclaw/workspace/dev-toolkit && npx tauri build --debug`

Expected: 编译成功，无错误

**Step 2: 运行测试**

Run: `cd /Users/liushiquan/.openclaw/workspace/dev-toolkit && npx tauri dev`

Expected: 应用启动，数据库工具可正常使用

**Step 3: Commit（如有修改）**

```bash
git add -A
git commit -m "fix(db): 修复编译问题"
```

---

## Task 13: 最终提交和文档更新

**Step 1: 更新文档**

在 `docs/PRODUCT.md` 中添加数据库工具说明：

```markdown
### 🗄️ 数据库客户端

多数据库连接管理工具，支持 MySQL、PostgreSQL、SQLite。

| 功能 | 说明 |
|------|------|
| 连接管理 | 新建/保存/测试连接，密码加密存储 |
| SQL 编辑器 | 语法高亮、格式化、快捷执行 (⌘+Enter) |
| 查询结果 | 表格展示、分页、导出 CSV/JSON |
| 数据库导航 | 树形结构浏览表、视图 |
| 表结构查看 | 双击表名查看字段详情 |

**支持的数据库**：
- MySQL / MariaDB
- PostgreSQL
- SQLite
```

**Step 2: 最终提交**

```bash
git add -A
git commit -m "feat(db): 完成数据库客户端 Phase 1 核心功能

- 支持 MySQL/PostgreSQL/SQLite 连接
- 连接配置加密存储
- SQL 编辑器 (CodeMirror SQL 模式)
- 查询结果表格展示
- 数据库树形导航
- 表结构查看
"
git push
```

---

**Phase 1 完成！** 🎉

后续 Phase 2 将实现：
- 表设计器（可视化建表/改表）
- 索引管理
- 数据导入导出增强
