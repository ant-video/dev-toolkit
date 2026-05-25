use crate::database::{ConnectionConfig, DbType};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;

/// 连接池类型别名
pub type MySqlPool = sqlx::mysql::MySqlPool;
pub type PostgresPool = sqlx::postgres::PgPool;
pub type SqlitePool = sqlx::sqlite::SqlitePool;

/// NoSQL 连接类型
pub type RedisConnection = super::redis_driver::RedisConn;
pub type MongoDatabase = mongodb::Database;
pub type ElasticsearchClient = (reqwest::Client, super::elasticsearch_driver::ElasticsearchConnInfo);

/// 活跃连接
#[derive(Clone)]
pub enum ActivePool {
    MySql(MySqlPool),
    Postgres(PostgresPool),
    Sqlite(SqlitePool),
    Redis(RedisConnection),
    MongoDB(MongoDatabase),
    Elasticsearch(ElasticsearchClient),
}

/// 连接池管理器
#[derive(Clone)]
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
            DbType::Redis => {
                let conn = super::redis_driver::create_connection(config).await?;
                ActivePool::Redis(conn)
            }
            DbType::MongoDB => {
                let url = super::mongodb_driver::build_connection_string(config);
                let client = mongodb::Client::with_uri_str(&url)
                    .await
                    .map_err(|e| format!("MongoDB 连接失败: {}", e))?;
                let db_name = if config.database.is_empty() { "test" } else { &config.database };
                let db = client.database(db_name);
                ActivePool::MongoDB(db)
            }
            DbType::Elasticsearch => {
                let conn_info = super::elasticsearch_driver::build_connection_info(config);
                let client = super::elasticsearch_driver::create_client();
                ActivePool::Elasticsearch((client, conn_info))
            }
        };

        let mut pools = self.pools.write().await;
        pools.insert(id, pool);

        Ok(())
    }

    /// 获取连接池
    pub async fn get_pool(&self, id: &str) -> Option<ActivePool> {
        let pools = self.pools.read().await;
        pools.get(id).cloned()
    }

    /// 关闭连接池
    pub async fn close_pool(&self, id: &str) {
        let mut pools = self.pools.write().await;
        if let Some(pool) = pools.remove(id) {
            match pool {
                ActivePool::MySql(p) => p.close().await,
                ActivePool::Postgres(p) => p.close().await,
                ActivePool::Sqlite(p) => p.close().await,
                // NoSQL 连接会在 drop 时自动关闭
                ActivePool::Redis(_) => {},
                ActivePool::MongoDB(_) => {},
                ActivePool::Elasticsearch(_) => {},
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
                // NoSQL 连接会在 drop 时自动关闭
                ActivePool::Redis(_) => {},
                ActivePool::MongoDB(_) => {},
                ActivePool::Elasticsearch(_) => {},
            }
        }
    }
}

impl Default for ConnectionPoolManager {
    fn default() -> Self {
        Self::new()
    }
}
