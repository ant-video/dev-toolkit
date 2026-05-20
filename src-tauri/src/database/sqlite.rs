use crate::database::{ColumnInfo, ConnectionConfig, ExecuteResult, QueryResult, TableInfo, TableSchema, ColumnSchema};
use sqlx::{Column, Row};
use std::time::Instant;

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

    Ok(format!("SQLite {}", row.0))
}

/// 获取表列表
pub async fn get_tables(pool: &sqlx::sqlite::SqlitePool) -> Result<Vec<TableInfo>, String> {
    let query = "SELECT name, type FROM sqlite_master WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite_%' ORDER BY name";
    let rows = sqlx::query(query)
        .fetch_all(pool)
        .await
        .map_err(|e| format!("查询表列表失败: {}", e))?;

    Ok(rows
        .iter()
        .map(|row| TableInfo {
            name: row.get(0),
            schema: None,
            table_type: row.get::<String, _>(1),
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
    _database: Option<&str>,
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
    _database: Option<&str>,
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
