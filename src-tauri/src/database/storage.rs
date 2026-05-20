use crate::database::{ConnectionConfig, SavedConnection, DbType, SslMode};
use sqlx::sqlite::{SqlitePool, SqlitePoolOptions};
use std::path::PathBuf;
use std::sync::OnceLock;

static STORAGE_POOL: OnceLock<SqlitePool> = OnceLock::new();

/// 获取数据库文件路径
fn get_db_path() -> PathBuf {
    let data_dir = dirs::data_local_dir()
        .or_else(|| dirs::data_dir())
        .unwrap_or_else(|| PathBuf::from("."));
    data_dir.join("dev-toolkit").join("connections.db")
}

/// 获取存储连接池
async fn get_pool() -> Result<SqlitePool, String> {
    if let Some(pool) = STORAGE_POOL.get() {
        return Ok(pool.clone());
    }

    let path = get_db_path();
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("创建目录失败: {}", e))?;
    }

    let url = format!("sqlite:{}?mode=rwc", path.display());
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect(&url)
        .await
        .map_err(|e| format!("连接存储失败: {}", e))?;

    // 初始化表
    sqlx::query(
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
    )
    .execute(&pool)
    .await
    .map_err(|e| format!("创建表失败: {}", e))?;

    let _ = STORAGE_POOL.set(pool.clone());
    Ok(pool)
}

/// 保存连接配置
pub async fn save_connection(config: ConnectionConfig) -> Result<SavedConnection, String> {
    let pool = get_pool().await?;

    let id = uuid::Uuid::new_v4().to_string();
    let encrypted_password = super::crypto::encrypt_password(&config.password)?;
    let now = chrono::Utc::now().timestamp();

    let db_type_str = serde_json::to_string(&config.db_type).unwrap_or_else(|_| "\"mysql\"".to_string());
    let ssl_mode_str = serde_json::to_string(&config.ssl_mode).unwrap_or_else(|_| "\"preferred\"".to_string());
    let options_str = serde_json::to_string(&config.options).unwrap_or_else(|_| "{}".to_string());

    sqlx::query(
        "INSERT INTO connections (id, name, db_type, host, port, username, encrypted_password, database, ssl_mode, options, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(&id)
    .bind(&config.name)
    .bind(&db_type_str)
    .bind(&config.host)
    .bind(config.port as i32)
    .bind(&config.username)
    .bind(&encrypted_password)
    .bind(&config.database)
    .bind(&ssl_mode_str)
    .bind(&options_str)
    .bind(now)
    .bind(now)
    .execute(&pool)
    .await
    .map_err(|e| format!("保存连接失败: {}", e))?;

    Ok(SavedConnection {
        id,
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
    })
}

/// 获取所有保存的连接
pub async fn list_connections() -> Result<Vec<SavedConnection>, String> {
    let pool = get_pool().await?;

    let rows = sqlx::query_as::<_, (String, String, String, String, i32, String, String, String, String, String, i64, i64)>(
        "SELECT id, name, db_type, host, port, username, encrypted_password, database, ssl_mode, options, created_at, updated_at FROM connections ORDER BY created_at DESC",
    )
    .fetch_all(&pool)
    .await
    .map_err(|e| format!("查询连接列表失败: {}", e))?;

    Ok(rows
        .into_iter()
        .map(|row| SavedConnection {
            id: row.0,
            name: row.1,
            db_type: serde_json::from_str(&row.2).unwrap_or(DbType::MySQL),
            host: row.3,
            port: row.4 as u16,
            username: row.5,
            encrypted_password: row.6,
            database: row.7,
            ssl_mode: serde_json::from_str(&row.8).unwrap_or(SslMode::Preferred),
            options: serde_json::from_str(&row.9).unwrap_or_default(),
            created_at: row.10,
            updated_at: row.11,
        })
        .collect())
}

/// 删除连接
pub async fn delete_connection(id: &str) -> Result<(), String> {
    let pool = get_pool().await?;

    sqlx::query("DELETE FROM connections WHERE id = ?")
        .bind(id)
        .execute(&pool)
        .await
        .map_err(|e| format!("删除连接失败: {}", e))?;

    Ok(())
}

/// 获取单个连接（含解密密码）
pub async fn get_connection(id: &str) -> Result<(SavedConnection, String), String> {
    let pool = get_pool().await?;

    let row = sqlx::query_as::<_, (String, String, String, String, i32, String, String, String, String, String, i64, i64)>(
        "SELECT id, name, db_type, host, port, username, encrypted_password, database, ssl_mode, options, created_at, updated_at FROM connections WHERE id = ?",
    )
    .bind(id)
    .fetch_one(&pool)
    .await
    .map_err(|e| format!("连接不存在: {}", e))?;

    let saved = SavedConnection {
        id: row.0,
        name: row.1,
        db_type: serde_json::from_str(&row.2).unwrap_or(DbType::MySQL),
        host: row.3,
        port: row.4 as u16,
        username: row.5,
        encrypted_password: row.6.clone(),
        database: row.7,
        ssl_mode: serde_json::from_str(&row.8).unwrap_or(SslMode::Preferred),
        options: serde_json::from_str(&row.9).unwrap_or_default(),
        created_at: row.10,
        updated_at: row.11,
    };

    let password = super::crypto::decrypt_password(&row.6)?;

    Ok((saved, password))
}
