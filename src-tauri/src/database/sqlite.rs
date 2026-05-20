use crate::database::{ConnectionConfig};

/// 构建 SQLite 连接字符串
pub fn build_connection_string(config: &ConnectionConfig) -> String {
    // SQLite 使用文件路径作为连接字符串
    // 数据库名就是文件路径
    format!("sqlite:{}?mode=rwc", config.database)
}

/// 测试 SQLite 连接
pub async fn test_connection(config: &ConnectionConfig) -> Result<String, String> {
    let url = build_connection_string(config);
    let pool = sqlx::sqlite::SqlitePoolOptions::new()
        .max_connections(1)
        .connect(&url)
        .await
        .map_err(|e| format!("连接失败: {}", e))?;

    let row: (i32,) = sqlx::query_as("SELECT 1")
        .fetch_one(&pool)
        .await
        .map_err(|e| format!("查询失败: {}", e))?;

    pool.close().await;

    Ok(format!("SQLite 连接成功 (测试值: {})", row.0))
}
