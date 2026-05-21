use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;

use super::pool::ActivePool;

/// 后端进程/连接 ID（用于发送取消信号）
#[derive(Clone)]
pub enum BackendPid {
    MySql(u64),
    Postgres(i32),
    Sqlite, // SQLite 无法跨连接取消
}

#[derive(Clone)]
pub struct ActiveQuery {
    pub connection_id: String,
    pub backend_pid: BackendPid,
}

/// 跟踪正在执行的查询（query_token -> ActiveQuery）
#[derive(Clone, Default)]
pub struct QueryRegistry {
    inner: Arc<RwLock<HashMap<String, ActiveQuery>>>,
}

impl QueryRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    pub async fn register(&self, token: String, q: ActiveQuery) {
        self.inner.write().await.insert(token, q);
    }

    pub async fn unregister(&self, token: &str) {
        self.inner.write().await.remove(token);
    }

    pub async fn get(&self, token: &str) -> Option<ActiveQuery> {
        self.inner.read().await.get(token).cloned()
    }

    pub fn inner_clone(&self) -> Self {
        self.clone()
    }
}

/// 从池中获取当前会话的 backend pid
pub async fn fetch_backend_pid(pool: &ActivePool) -> Result<BackendPid, String> {
    match pool {
        ActivePool::MySql(p) => {
            let row: (u64,) = sqlx::query_as("SELECT CONNECTION_ID()")
                .fetch_one(p)
                .await
                .map_err(|e| format!("获取 MySQL 连接 ID 失败: {}", e))?;
            Ok(BackendPid::MySql(row.0))
        }
        ActivePool::Postgres(p) => {
            let row: (i32,) = sqlx::query_as("SELECT pg_backend_pid()")
                .fetch_one(p)
                .await
                .map_err(|e| format!("获取 PG backend pid 失败: {}", e))?;
            Ok(BackendPid::Postgres(row.0))
        }
        ActivePool::Sqlite(_) => Ok(BackendPid::Sqlite),
    }
}

/// 通过同一池的另一条连接发出取消信号
pub async fn send_cancel(pool: &ActivePool, pid: &BackendPid) -> Result<(), String> {
    match (pool, pid) {
        (ActivePool::MySql(p), BackendPid::MySql(id)) => {
            let sql = format!("KILL QUERY {}", id);
            sqlx::query(&sql)
                .execute(p)
                .await
                .map_err(|e| format!("KILL QUERY 失败: {}", e))?;
            Ok(())
        }
        (ActivePool::Postgres(p), BackendPid::Postgres(pid)) => {
            sqlx::query("SELECT pg_cancel_backend($1)")
                .bind(pid)
                .execute(p)
                .await
                .map_err(|e| format!("pg_cancel_backend 失败: {}", e))?;
            Ok(())
        }
        (ActivePool::Sqlite(_), _) => Err("SQLite 不支持取消查询".to_string()),
        _ => Err("连接类型与 PID 不匹配".to_string()),
    }
}
