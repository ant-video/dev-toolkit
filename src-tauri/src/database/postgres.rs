use crate::database::{ColumnInfo, ConnectionConfig, DatabaseInfo, ExecuteResult, QueryResult, TableInfo, TableSchema, ColumnSchema, SslMode};
use sqlx::postgres::{PgPoolOptions, PgRow};
use sqlx::{Column, Row};
use std::time::Instant;

/// 构建 PostgreSQL 连接字符串
pub fn build_connection_string(config: &ConnectionConfig) -> String {
    let ssl_mode = match &config.ssl_mode {
        SslMode::Disabled => "disable",
        SslMode::Preferred => "prefer",
        SslMode::Required => "require",
        SslMode::VerifyIdentity => "verify-full",
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
    pool: &sqlx::postgres::PgPool,
    sql: &str,
    _database: Option<&str>,
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
