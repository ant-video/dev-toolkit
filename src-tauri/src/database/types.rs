use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// 数据库类型
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum DbType {
    MySQL,
    PostgreSQL,
    SQLite,
    Redis,
    MongoDB,
    Elasticsearch,
}

/// SSL 模式
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum SslMode {
    Disabled,
    Preferred,
    Required,
    VerifyIdentity,
}

impl Default for SslMode {
    fn default() -> Self {
        Self::Preferred
    }
}

/// 连接配置（前端传递，密码明文）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConnectionConfig {
    pub name: String,
    pub db_type: DbType,
    pub host: String,
    pub port: u16,
    pub username: String,
    pub password: String,
    pub database: String,
    #[serde(default)]
    pub ssl_mode: SslMode,
    #[serde(default)]
    pub options: HashMap<String, String>,
    #[serde(default)]
    pub group: Option<String>,
}

/// 保存的连接（持久化存储，密码加密）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SavedConnection {
    pub id: String,
    pub name: String,
    pub db_type: DbType,
    pub host: String,
    pub port: u16,
    pub username: String,
    pub encrypted_password: String,  // AES 加密
    pub database: String,
    pub ssl_mode: SslMode,
    pub options: HashMap<String, String>,
    pub created_at: i64,
    pub updated_at: i64,
    #[serde(default)]
    pub group: Option<String>,
}

/// 连接测试结果
#[derive(Debug, Serialize)]
pub struct TestResult {
    pub success: bool,
    pub message: String,
    pub server_version: Option<String>,
}

/// 查询结果
#[derive(Debug, Serialize)]
pub struct QueryResult {
    pub success: bool,
    pub columns: Vec<ColumnInfo>,
    pub rows: Vec<Vec<Option<String>>>,
    pub row_count: usize,
    pub execution_time_ms: u64,
    pub error: Option<String>,
}

/// 列信息
#[derive(Debug, Serialize)]
pub struct ColumnInfo {
    pub name: String,
    pub data_type: String,
    pub nullable: bool,
}

/// 执行结果
#[derive(Debug, Serialize)]
pub struct ExecuteResult {
    pub success: bool,
    pub affected_rows: u64,
    pub last_insert_id: Option<i64>,
    pub execution_time_ms: u64,
    pub error: Option<String>,
}

/// 表信息
#[derive(Debug, Serialize)]
pub struct TableInfo {
    pub name: String,
    pub schema: Option<String>,
    pub table_type: String,
    pub row_count: Option<u64>,
}

/// 表结构
#[derive(Debug, Serialize)]
pub struct TableSchema {
    pub name: String,
    pub columns: Vec<ColumnSchema>,
}

/// 列结构
#[derive(Debug, Serialize, Clone)]
pub struct ColumnSchema {
    pub name: String,
    pub data_type: String,
    pub length: Option<String>,
    pub nullable: bool,
    pub default: Option<String>,
    pub is_primary_key: bool,
    pub auto_increment: bool,
    pub comment: Option<String>,
}

/// 数据库信息
#[derive(Debug, Serialize)]
pub struct DatabaseInfo {
    pub name: String,
    pub charset: Option<String>,
    pub collation: Option<String>,
}

/// 外键信息
#[derive(Debug, Serialize, Clone)]
pub struct ForeignKeyInfo {
    pub column: String,
    pub referenced_table: String,
    pub referenced_column: String,
    pub referenced_schema: Option<String>,
}

impl ConnectionConfig {
    /// 获取默认端口
    pub fn default_port(db_type: &DbType) -> u16 {
        match db_type {
            DbType::MySQL => 3306,
            DbType::PostgreSQL => 5432,
            DbType::SQLite => 0,
            DbType::Redis => 6379,
            DbType::MongoDB => 27017,
            DbType::Elasticsearch => 9200,
        }
    }
}
