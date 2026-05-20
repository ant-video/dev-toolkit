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
    pool_manager: State<'_, ConnectionPoolManager>,
) -> Result<crate::database::QueryResult, String> {
    let pool = pool_manager.get_pool(&connectionId).await.ok_or("连接不存在")?;

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
    pool_manager: State<'_, ConnectionPoolManager>,
) -> Result<crate::database::ExecuteResult, String> {
    let pool = pool_manager.get_pool(&connectionId).await.ok_or("连接不存在")?;

    match pool {
        super::pool::ActivePool::MySql(p) => super::mysql::execute_statement(&p, &sql, database.as_deref()).await,
        super::pool::ActivePool::Postgres(p) => super::postgres::execute_statement(&p, &sql, database.as_deref()).await,
        super::pool::ActivePool::Sqlite(p) => super::sqlite::execute_statement(&p, &sql, database.as_deref()).await,
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
