use crate::database::{ConnectionConfig, ConnectionPoolManager, DbType, QueryRegistry, SavedConnection, TestResult};
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
pub async fn db_save_connection(config: ConnectionConfig) -> Result<SavedConnection, String> {
    super::storage::save_connection(config).await
}

/// 获取所有保存的连接
#[tauri::command]
pub async fn db_list_connections() -> Result<Vec<SavedConnection>, String> {
    super::storage::list_connections().await
}

/// 删除连接
#[tauri::command]
pub async fn db_delete_connection(id: String) -> Result<(), String> {
    super::storage::delete_connection(&id).await
}

/// 建立连接
#[tauri::command]
pub async fn db_connect(
    id: String,
    pool_manager: State<'_, ConnectionPoolManager>,
) -> Result<(), String> {
    let (saved, password) = super::storage::get_connection(&id).await?;

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
        group: saved.group,
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
    connectionId: String,
    sql: String,
    database: Option<String>,
    queryToken: Option<String>,
    pool_manager: State<'_, ConnectionPoolManager>,
    registry: State<'_, QueryRegistry>,
) -> Result<crate::database::QueryResult, String> {
    let pool = pool_manager.get_pool(&connectionId).await.ok_or("连接不存在")?;
    let _guard = register_query(&pool, queryToken.as_deref(), &connectionId, &registry).await;

    match pool {
        super::pool::ActivePool::MySql(p) => super::mysql::execute_query(&p, &sql, database.as_deref()).await,
        super::pool::ActivePool::Postgres(p) => super::postgres::execute_query(&p, &sql, database.as_deref()).await,
        super::pool::ActivePool::Sqlite(p) => super::sqlite::execute_query(&p, &sql, database.as_deref()).await,
    }
}

/// 执行语句
#[tauri::command]
pub async fn db_execute(
    connectionId: String,
    sql: String,
    database: Option<String>,
    queryToken: Option<String>,
    pool_manager: State<'_, ConnectionPoolManager>,
    registry: State<'_, QueryRegistry>,
) -> Result<crate::database::ExecuteResult, String> {
    let pool = pool_manager.get_pool(&connectionId).await.ok_or("连接不存在")?;
    let _guard = register_query(&pool, queryToken.as_deref(), &connectionId, &registry).await;

    match pool {
        super::pool::ActivePool::MySql(p) => super::mysql::execute_statement(&p, &sql, database.as_deref()).await,
        super::pool::ActivePool::Postgres(p) => super::postgres::execute_statement(&p, &sql, database.as_deref()).await,
        super::pool::ActivePool::Sqlite(p) => super::sqlite::execute_statement(&p, &sql, database.as_deref()).await,
    }
}

/// 取消正在执行的查询
#[tauri::command]
pub async fn db_cancel_query(
    connectionId: String,
    queryToken: String,
    pool_manager: State<'_, ConnectionPoolManager>,
    registry: State<'_, QueryRegistry>,
) -> Result<(), String> {
    let active = registry.get(&queryToken).await.ok_or("查询不在运行中")?;
    if active.connection_id != connectionId {
        return Err("连接 ID 不匹配".to_string());
    }
    let pool = pool_manager.get_pool(&connectionId).await.ok_or("连接不存在")?;
    super::cancel::send_cancel(&pool, &active.backend_pid).await?;
    registry.unregister(&queryToken).await;
    Ok(())
}

/// 当 token 提供时把查询注册到 registry，并返回 RAII guard 确保清理
async fn register_query(
    pool: &super::pool::ActivePool,
    token: Option<&str>,
    connection_id: &str,
    registry: &QueryRegistry,
) -> Option<QueryGuard> {
    let token = token?;
    let pid = super::cancel::fetch_backend_pid(pool).await.ok()?;
    registry
        .register(
            token.to_string(),
            super::cancel::ActiveQuery {
                connection_id: connection_id.to_string(),
                backend_pid: pid,
            },
        )
        .await;
    Some(QueryGuard {
        registry: registry.inner_clone(),
        token: token.to_string(),
    })
}

pub struct QueryGuard {
    registry: QueryRegistry,
    token: String,
}

impl Drop for QueryGuard {
    fn drop(&mut self) {
        let r = self.registry.clone();
        let t = std::mem::take(&mut self.token);
        // 用阻塞调度避免 Drop 异步限制
        tokio::spawn(async move { r.unregister(&t).await });
    }
}

/// 获取表列表
#[tauri::command]
pub async fn db_get_tables(
    connectionId: String,
    database: String,
    pool_manager: State<'_, ConnectionPoolManager>,
) -> Result<Vec<crate::database::TableInfo>, String> {
    println!("[db_get_tables] connectionId: {}, database: {}", connectionId, database);
    let pool = pool_manager.get_pool(&connectionId).await.ok_or("连接不存在")?;

    let result = match pool {
        super::pool::ActivePool::MySql(p) => super::mysql::get_tables(&p, &database).await,
        super::pool::ActivePool::Postgres(p) => super::postgres::get_tables(&p, &database).await,
        super::pool::ActivePool::Sqlite(p) => super::sqlite::get_tables(&p).await,
    };

    println!("[db_get_tables] result: {:?}", result);
    result
}

/// 获取数据库列表
#[tauri::command]
pub async fn db_get_databases(
    connectionId: String,
    pool_manager: State<'_, ConnectionPoolManager>,
) -> Result<Vec<crate::database::DatabaseInfo>, String> {
    let pool = pool_manager.get_pool(&connectionId).await.ok_or("连接不存在")?;

    match pool {
        super::pool::ActivePool::MySql(p) => super::mysql::get_databases(&p).await,
        super::pool::ActivePool::Postgres(p) => super::postgres::get_databases(&p).await,
        super::pool::ActivePool::Sqlite(_) => {
            // SQLite 只有一个数据库
            Ok(vec![crate::database::DatabaseInfo {
                name: "main".to_string(),
                charset: None,
                collation: None,
            }])
        }
    }
}

/// 获取表结构
#[tauri::command]
pub async fn db_get_table_schema(
    connectionId: String,
    database: String,
    table: String,
    pool_manager: State<'_, ConnectionPoolManager>,
) -> Result<crate::database::TableSchema, String> {
    let pool = pool_manager.get_pool(&connectionId).await.ok_or("连接不存在")?;

    match pool {
        super::pool::ActivePool::MySql(p) => super::mysql::get_table_schema(&p, &database, &table).await,
        super::pool::ActivePool::Postgres(p) => super::postgres::get_table_schema(&p, &database, &table).await,
        super::pool::ActivePool::Sqlite(p) => super::sqlite::get_table_schema(&p, &table).await,
    }
}

/// 打开 SQL 文件并读取内容
#[tauri::command]
pub async fn db_open_sql_file() -> Result<Option<(String, String)>, String> {
    use rfd::FileDialog;
    let path = FileDialog::new()
        .add_filter("SQL", &["sql", "txt"])
        .add_filter("All", &["*"])
        .pick_file();
    let Some(path) = path else { return Ok(None) };

    let name = path
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| "Untitled.sql".to_string());

    let bytes = std::fs::read(&path).map_err(|e| format!("读取文件失败: {}", e))?;
    if bytes.len() > 20 * 1024 * 1024 {
        return Err("文件过大 (>20MB)，请用命令行执行".to_string());
    }
    let text = String::from_utf8(bytes).map_err(|e| format!("文件不是有效的 UTF-8: {}", e))?;
    Ok(Some((name, text)))
}

/// 打开 CSV 文件并读取内容
#[tauri::command]
pub async fn db_open_csv_file() -> Result<Option<(String, String)>, String> {
    use rfd::FileDialog;
    let path = FileDialog::new()
        .add_filter("CSV", &["csv", "tsv", "txt"])
        .add_filter("All", &["*"])
        .pick_file();
    let Some(path) = path else { return Ok(None) };

    let name = path
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| "Untitled.csv".to_string());

    let bytes = std::fs::read(&path).map_err(|e| format!("读取文件失败: {}", e))?;
    if bytes.len() > 50 * 1024 * 1024 {
        return Err("文件过大 (>50MB)".to_string());
    }
    // 尝试 UTF-8，否则按 GBK 解析（常见 Excel 导出）
    let text = match String::from_utf8(bytes.clone()) {
        Ok(t) => t,
        Err(_) => {
            // 简化的 GBK 失败回退：按 latin1 解码以避免 panic
            bytes.iter().map(|b| *b as char).collect::<String>()
        }
    };
    Ok(Some((name, text)))
}

/// 查询表的外键（用于 FK 导航）
#[tauri::command]
pub async fn db_get_foreign_keys(
    connectionId: String,
    database: String,
    table: String,
    pool_manager: State<'_, ConnectionPoolManager>,
) -> Result<Vec<crate::database::ForeignKeyInfo>, String> {
    let pool = pool_manager.get_pool(&connectionId).await.ok_or("连接不存在")?;
    match pool {
        super::pool::ActivePool::MySql(p) => super::mysql::get_foreign_keys(&p, &database, &table).await,
        super::pool::ActivePool::Postgres(p) => super::postgres::get_foreign_keys(&p, &database, &table).await,
        super::pool::ActivePool::Sqlite(p) => super::sqlite::get_foreign_keys(&p, &table).await,
    }
}

/// 弹出保存对话框并写入文件
/// 返回保存的绝对路径；用户取消时返回 None
#[tauri::command]
pub async fn db_save_file(
    defaultName: String,
    content: String,
    filterName: Option<String>,
    filterExts: Option<Vec<String>>,
) -> Result<Option<String>, String> {
    use rfd::FileDialog;
    let mut dialog = FileDialog::new().set_file_name(&defaultName);
    if let (Some(name), Some(exts)) = (filterName, filterExts) {
        let ext_refs: Vec<&str> = exts.iter().map(|s| s.as_str()).collect();
        dialog = dialog.add_filter(&name, &ext_refs);
    }
    let Some(path) = dialog.save_file() else { return Ok(None) };
    std::fs::write(&path, content).map_err(|e| format!("写入文件失败: {}", e))?;
    Ok(Some(path.to_string_lossy().to_string()))
}

