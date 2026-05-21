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
    // 查询主键列
    let pk_rows = sqlx::query(
        r#"
        SELECT kcu.column_name
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu
          ON tc.constraint_name = kcu.constraint_name
         AND tc.table_schema = kcu.table_schema
         AND tc.table_name = kcu.table_name
        WHERE tc.constraint_type = 'PRIMARY KEY'
          AND tc.table_schema = $1
          AND tc.table_name = $2
        "#,
    )
    .bind(schema)
    .bind(table)
    .fetch_all(pool)
    .await
    .map_err(|e| format!("查询主键失败: {}", e))?;

    let pk_columns: std::collections::HashSet<String> = pk_rows
        .iter()
        .map(|row| row.get::<String, _>(0))
        .collect();

    let query = r#"
        SELECT column_name, data_type, character_maximum_length,
               numeric_precision, numeric_scale, is_nullable, column_default,
               is_identity
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
        .map(|row| {
            let char_len: Option<i64> = row.try_get::<Option<i64>, _>(2).ok().flatten();
            let num_prec: Option<i64> = row.try_get::<Option<i64>, _>(3).ok().flatten();
            let num_scale: Option<i64> = row.try_get::<Option<i64>, _>(4).ok().flatten();

            let length = if let Some(len) = char_len {
                Some(len.to_string())
            } else if let Some(prec) = num_prec {
                if let Some(scale) = num_scale {
                    if scale > 0 {
                        Some(format!("{},{}", prec, scale))
                    } else {
                        Some(prec.to_string())
                    }
                } else {
                    Some(prec.to_string())
                }
            } else {
                None
            };

            let name: String = row.get(0);
            let default: Option<String> = row.try_get::<Option<String>, _>(6).ok().flatten();
            let is_identity: String = row
                .try_get::<Option<String>, _>(7)
                .ok()
                .flatten()
                .unwrap_or_default();
            // PostgreSQL 自增判定：IDENTITY 列，或 serial 类型默认值为 nextval(...)
            let auto_increment = is_identity.eq_ignore_ascii_case("YES")
                || default
                    .as_deref()
                    .map(|d| d.trim_start().starts_with("nextval("))
                    .unwrap_or(false);

            ColumnSchema {
                is_primary_key: pk_columns.contains(&name),
                auto_increment,
                data_type: row.get::<String, _>(1).to_uppercase(),
                length,
                nullable: row.get::<String, _>(5) == "YES",
                default,
                comment: None,
                name,
            }
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
                        .map(|col| {
                            let col_name = col.name();
                            if let Ok(Some(v)) = row.try_get::<Option<String>, _>(col_name) {
                                return Some(v);
                            }
                            if let Ok(Some(v)) = row.try_get::<Option<i64>, _>(col_name) {
                                return Some(v.to_string());
                            }
                            if let Ok(Some(v)) = row.try_get::<Option<i32>, _>(col_name) {
                                return Some(v.to_string());
                            }
                            if let Ok(Some(v)) = row.try_get::<Option<f64>, _>(col_name) {
                                return Some(v.to_string());
                            }
                            if let Ok(Some(v)) = row.try_get::<Option<bool>, _>(col_name) {
                                return Some(v.to_string());
                            }
                            if let Ok(Some(v)) = row.try_get::<Option<Vec<u8>>, _>(col_name) {
                                return Some(format!("0x{}", hex::encode(&v)));
                            }
                            if let Ok(Some(v)) = row.try_get::<Option<chrono::DateTime<chrono::Utc>>, _>(col_name) {
                                return Some(v.to_string());
                            }
                            if let Ok(Some(v)) = row.try_get::<Option<chrono::NaiveDateTime>, _>(col_name) {
                                return Some(v.to_string());
                            }
                            if let Ok(Some(v)) = row.try_get::<Option<chrono::NaiveDate>, _>(col_name) {
                                return Some(v.to_string());
                            }
                            if let Ok(None) = row.try_get::<Option<String>, _>(col_name) {
                                return None;
                            }
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

/// 查询表的外键关系
pub async fn get_foreign_keys(
    pool: &sqlx::postgres::PgPool,
    schema: &str,
    table: &str,
) -> Result<Vec<crate::database::ForeignKeyInfo>, String> {
    let sql = r#"
        SELECT kcu.column_name, ccu.table_name, ccu.column_name, ccu.table_schema
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu
          ON tc.constraint_name = kcu.constraint_name
         AND tc.table_schema = kcu.table_schema
        JOIN information_schema.constraint_column_usage ccu
          ON ccu.constraint_name = tc.constraint_name
         AND ccu.table_schema = tc.table_schema
        WHERE tc.constraint_type = 'FOREIGN KEY'
          AND tc.table_schema = $1
          AND tc.table_name = $2
    "#;
    use sqlx::Row;
    let rows = sqlx::query(sql).bind(schema).bind(table).fetch_all(pool).await
        .map_err(|e| format!("查询外键失败: {}", e))?;
    Ok(rows.iter().map(|r| crate::database::ForeignKeyInfo {
        column: r.get::<String, _>(0),
        referenced_table: r.get::<String, _>(1),
        referenced_column: r.get::<String, _>(2),
        referenced_schema: r.try_get::<Option<String>, _>(3).ok().flatten(),
    }).collect())
}
