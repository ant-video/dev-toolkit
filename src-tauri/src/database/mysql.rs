use crate::database::{ColumnInfo, ConnectionConfig, DatabaseInfo, ExecuteResult, QueryResult, TableInfo, TableSchema, ColumnSchema, SslMode};
use sqlx::mysql::{MySqlPoolOptions, MySqlRow};
use sqlx::{Column, Executor, Row};
use std::time::Instant;

/// 构建 MySQL 连接字符串（不指定数据库，允许访问所有数据库）
pub fn build_connection_string(config: &ConnectionConfig) -> String {
    let ssl_mode = match &config.ssl_mode {
        SslMode::Disabled => "false",
        SslMode::Preferred => "preferred",
        SslMode::Required | SslMode::VerifyIdentity => "true",
    };

    // 不指定数据库，允许查询任意数据库
    format!(
        "mysql://{}:{}@{}:{}/?ssl-mode={}",
        urlencoding::encode(&config.username),
        urlencoding::encode(&config.password),
        config.host,
        config.port,
        ssl_mode
    )
}

/// 构建带数据库的 MySQL 连接字符串（用于测试连接）
pub fn build_connection_string_with_db(config: &ConnectionConfig) -> String {
    let ssl_mode = match &config.ssl_mode {
        SslMode::Disabled => "false",
        SslMode::Preferred => "preferred",
        SslMode::Required | SslMode::VerifyIdentity => "true",
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
    let url = build_connection_string_with_db(config);
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
    println!("[MySQL] 查询表列表, 数据库: {}", database);
    let query = "SELECT TABLE_NAME, TABLE_TYPE, TABLE_ROWS FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME";
    let rows = sqlx::query(query)
        .bind(database)
        .fetch_all(pool)
        .await
        .map_err(|e| format!("查询表列表失败: {}", e))?;

    println!("[MySQL] 查询到 {} 张表", rows.len());
    Ok(rows
        .iter()
        .map(|row| TableInfo {
            name: row.get(0),
            schema: Some(database.to_string()),
            table_type: row.get::<String, _>(1),
            row_count: row.get::<Option<u64>, _>(2),
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
    database: Option<&str>,
) -> Result<QueryResult, String> {
    let start = Instant::now();
    println!("[MySQL] 执行查询, 数据库: {:?}, SQL: {}", database, sql);

    // 获取一个连接，确保 USE 和后续查询在同一个连接上执行
    let mut conn = pool.acquire().await.map_err(|e| format!("获取连接失败: {}", e))?;

    // 如果指定了数据库，先执行 USE 切换数据库
    if let Some(db) = database {
        let use_sql = format!("USE `{}`", db);
        println!("[MySQL] 执行: {}", use_sql);
        conn.execute(use_sql.as_str())
            .await
            .map_err(|e| format!("切换数据库失败: {}", e))?;
    }

    let result = sqlx::query(sql).fetch_all(&mut *conn).await;

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
                        .map(|col| {
                            // 尝试多种类型获取值
                            let col_name = col.name();

                            // 先尝试 String
                            if let Ok(Some(v)) = row.try_get::<Option<String>, _>(col_name) {
                                return Some(v);
                            }
                            // 尝试 i64
                            if let Ok(Some(v)) = row.try_get::<Option<i64>, _>(col_name) {
                                return Some(v.to_string());
                            }
                            // 尝试 u64
                            if let Ok(Some(v)) = row.try_get::<Option<u64>, _>(col_name) {
                                return Some(v.to_string());
                            }
                            // 尝试 i32
                            if let Ok(Some(v)) = row.try_get::<Option<i32>, _>(col_name) {
                                return Some(v.to_string());
                            }
                            // 尝试 u32
                            if let Ok(Some(v)) = row.try_get::<Option<u32>, _>(col_name) {
                                return Some(v.to_string());
                            }
                            // 尝试 f64
                            if let Ok(Some(v)) = row.try_get::<Option<f64>, _>(col_name) {
                                return Some(v.to_string());
                            }
                            // 尝试 f32
                            if let Ok(Some(v)) = row.try_get::<Option<f32>, _>(col_name) {
                                return Some(v.to_string());
                            }
                            // 尝试 bool
                            if let Ok(Some(v)) = row.try_get::<Option<bool>, _>(col_name) {
                                return Some(v.to_string());
                            }
                            // 尝试 Vec<u8> (binary/blob)
                            if let Ok(Some(v)) = row.try_get::<Option<Vec<u8>>, _>(col_name) {
                                // 转换为 hex
                                return Some(format!("0x{}", hex::encode(&v)));
                            }
                            // 尝试 chrono::DateTime
                            if let Ok(Some(v)) = row.try_get::<Option<chrono::DateTime<chrono::Utc>>, _>(col_name) {
                                return Some(v.to_string());
                            }
                            // 尝试 chrono::NaiveDateTime
                            if let Ok(Some(v)) = row.try_get::<Option<chrono::NaiveDateTime>, _>(col_name) {
                                return Some(v.to_string());
                            }
                            // 尝试 chrono::NaiveDate
                            if let Ok(Some(v)) = row.try_get::<Option<chrono::NaiveDate>, _>(col_name) {
                                return Some(v.to_string());
                            }
                            // 尝试 chrono::NaiveTime
                            if let Ok(Some(v)) = row.try_get::<Option<chrono::NaiveTime>, _>(col_name) {
                                return Some(v.to_string());
                            }
                            // 最后检查是否为 NULL
                            if let Ok(None) = row.try_get::<Option<String>, _>(col_name) {
                                return None;
                            }
                            // 无法解析，返回 [BINARY]
                            Some("[BINARY]".to_string())
                        })
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
    database: Option<&str>,
) -> Result<ExecuteResult, String> {
    let start = Instant::now();

    // 获取一个连接
    let mut conn = pool.acquire().await.map_err(|e| format!("获取连接失败: {}", e))?;

    // 如果指定了数据库，先执行 USE 切换数据库
    if let Some(db) = database {
        let use_sql = format!("USE `{}`", db);
        conn.execute(use_sql.as_str())
            .await
            .map_err(|e| format!("切换数据库失败: {}", e))?;
    }

    let result = sqlx::query(sql).execute(&mut *conn).await;

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
