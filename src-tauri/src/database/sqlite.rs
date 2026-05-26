use crate::database::{ColumnInfo, ConnectionConfig, ExecuteResult, QueryResult, TableInfo, TableSchema, ColumnSchema};
use sqlx::{Column, Row};
use std::time::Instant;

/// 构建 SQLite 连接字符串
pub fn build_connection_string(config: &ConnectionConfig) -> String {
    // SQLite 使用文件路径作为连接字符串
    // Windows 下将反斜杠转为正斜杠，避免 C:\ 中的冒号被 URI 解析器误读
    let path = config.database.replace('\\', "/");
    format!("sqlite:{}?mode=rwc", path)
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

/// 校验 SQLite 标识符，仅允许字母、数字、下划线，且不以数字开头
fn validate_sqlite_ident(name: &str) -> Result<(), String> {
    if name.is_empty() || name.len() > 128 {
        return Err("非法的表名".to_string());
    }
    let mut chars = name.chars();
    let first = chars.next().unwrap();
    if !(first.is_ascii_alphabetic() || first == '_') {
        return Err("非法的表名".to_string());
    }
    for c in chars {
        if !(c.is_ascii_alphanumeric() || c == '_') {
            return Err("非法的表名".to_string());
        }
    }
    Ok(())
}

/// 获取表结构
pub async fn get_table_schema(
    pool: &sqlx::sqlite::SqlitePool,
    table: &str,
) -> Result<TableSchema, String> {
    // PRAGMA 不支持参数化绑定，必须做严格的标识符校验
    validate_sqlite_ident(table)?;
    let query = format!("PRAGMA table_info(\"{}\")", table);
    let rows = sqlx::query(&query)
        .fetch_all(pool)
        .await
        .map_err(|e| format!("查询表结构失败: {}", e))?;

    let columns: Vec<ColumnSchema> = rows
        .iter()
        .map(|row| {
            let type_str: String = row.get(2);
            // 解析类型和长度，如 VARCHAR(255) -> (VARCHAR, 255)
            let (data_type, length) = parse_sqlite_type(&type_str);

            ColumnSchema {
                name: row.get(1),
                data_type,
                length,
                nullable: row.get::<i32, _>(3) == 0,
                default: row.try_get::<Option<String>, _>(4).ok().flatten(),
                is_primary_key: row.get::<i32, _>(5) == 1,
                auto_increment: false, // SQLite 的自增通过 INTEGER PRIMARY KEY 隐式实现
                comment: None,
            }
        })
        .collect();

    Ok(TableSchema {
        name: table.to_string(),
        columns,
    })
}

/// 解析 SQLite 类型字符串
fn parse_sqlite_type(type_str: &str) -> (String, Option<String>) {
    let upper = type_str.to_uppercase();
    if let Some(start) = upper.find('(') {
        if let Some(end) = upper.find(')') {
            let base_type = upper[..start].to_string();
            let len = upper[start + 1..end].to_string();
            return (base_type, Some(len));
        }
    }
    (upper, None)
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

/// 查询表的外键关系 (SQLite: PRAGMA foreign_key_list)
pub async fn get_foreign_keys(
    pool: &sqlx::sqlite::SqlitePool,
    table: &str,
) -> Result<Vec<crate::database::ForeignKeyInfo>, String> {
    validate_sqlite_ident(table)?;
    let sql = format!("PRAGMA foreign_key_list(\"{}\")", table);
    use sqlx::Row;
    let rows = sqlx::query(&sql).fetch_all(pool).await
        .map_err(|e| format!("查询外键失败: {}", e))?;
    // pragma 列: id, seq, table, from, to, on_update, on_delete, match
    Ok(rows.iter().map(|r| crate::database::ForeignKeyInfo {
        column: r.try_get::<String, _>("from").unwrap_or_default(),
        referenced_table: r.try_get::<String, _>("table").unwrap_or_default(),
        referenced_column: r.try_get::<String, _>("to").unwrap_or_default(),
        referenced_schema: None,
    }).collect())
}
