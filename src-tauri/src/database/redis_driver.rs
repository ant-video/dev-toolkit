use crate::database::{ConnectionConfig, QueryResult, ColumnInfo, ExecuteResult, TableInfo, DatabaseInfo, TableSchema, ColumnSchema};
use redis::AsyncCommands;
use std::time::Duration;

const QUERY_TIMEOUT: Duration = Duration::from_secs(30);

/// Redis 连接类型（支持单机和集群模式）
#[derive(Clone)]
pub enum RedisConn {
    /// 单机模式连接
    Single(redis::aio::ConnectionManager),
    /// 集群模式连接
    Cluster(redis::cluster_async::ClusterConnection),
}

impl RedisConn {
    /// 是否为集群模式
    pub fn is_cluster(&self) -> bool {
        matches!(self, RedisConn::Cluster(_))
    }
}

impl redis::aio::ConnectionLike for RedisConn {
    fn req_packed_command<'a>(
        &'a mut self,
        cmd: &'a redis::Cmd,
    ) -> redis::RedisFuture<'a, redis::Value> {
        match self {
            RedisConn::Single(conn) => conn.req_packed_command(cmd),
            RedisConn::Cluster(conn) => conn.req_packed_command(cmd),
        }
    }

    fn req_packed_commands<'a>(
        &'a mut self,
        pipeline: &'a redis::Pipeline,
        offset: usize,
        count: usize,
    ) -> redis::RedisFuture<'a, Vec<redis::Value>> {
        match self {
            RedisConn::Single(conn) => conn.req_packed_commands(pipeline, offset, count),
            RedisConn::Cluster(conn) => conn.req_packed_commands(pipeline, offset, count),
        }
    }

    fn get_db(&self) -> i64 {
        match self {
            RedisConn::Single(conn) => conn.get_db(),
            RedisConn::Cluster(conn) => conn.get_db(),
        }
    }
}

/// 构建单节点连接字符串
fn build_node_url(host: &str, port: u16, password: &str) -> String {
    if password.is_empty() {
        format!("redis://{}:{}", host, port)
    } else {
        let encoded_password = urlencoding::encode(password);
        format!("redis://:{}@{}:{}", encoded_password, host, port)
    }
}

/// 解析 host 字段为节点列表
/// 支持逗号分隔的多节点，如 "10.2.40.11:6381,10.2.40.12:6381"
/// 如果节点没有指定端口，则使用 config.port 作为默认端口
fn parse_nodes(config: &ConnectionConfig) -> Vec<(String, u16)> {
    config.host.split(',')
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .map(|node| {
            if let Some((h, p)) = node.split_once(':') {
                (h.to_string(), p.parse().unwrap_or(config.port))
            } else {
                (node.to_string(), config.port)
            }
        })
        .collect()
}

/// 探测 Redis 节点是否为集群模式
async fn detect_cluster(conn: &mut redis::aio::ConnectionManager) -> bool {
    // 方法1：CLUSTER NODES（集群节点返回节点列表，非集群返回 ERR）
    if let Ok(val) = redis::cmd("CLUSTER")
        .arg("NODES")
        .query_async::<_, redis::Value>(conn)
        .await
    {
        match &val {
            redis::Value::Data(_) => return true,
            _ => {}
        }
    }

    // 方法2：CLUSTER INFO（检查 cluster_enabled）
    if let Ok(val) = redis::cmd("CLUSTER")
        .arg("INFO")
        .query_async::<_, redis::Value>(conn)
        .await
    {
        if let redis::Value::Data(bytes) = &val {
            let info = String::from_utf8_lossy(bytes);
            if info.contains("cluster_enabled:1") {
                return true;
            }
        }
    }

    false
}

/// 创建 Redis 连接（自动探测单机/集群模式）
pub async fn create_connection(config: &ConnectionConfig) -> Result<RedisConn, String> {
    let nodes = parse_nodes(config);
    if nodes.is_empty() {
        return Err("Redis 节点列表为空".to_string());
    }

    // 用第一个节点探测
    let (first_host, first_port) = &nodes[0];
    let url = build_node_url(first_host, *first_port, &config.password);
    let client = redis::Client::open(url)
        .map_err(|e| format!("Redis 客户端创建失败: {}", e))?;
    let mut conn = redis::aio::ConnectionManager::new(client)
        .await
        .map_err(|e| format!("Redis 连接失败: {}", e))?;

    let is_cluster = detect_cluster(&mut conn).await;

    if is_cluster {
        // 集群模式：用所有节点建立集群连接
        let node_urls: Vec<String> = nodes.iter()
            .map(|(h, p)| build_node_url(h, *p, ""))
            .collect();

        let mut builder = redis::cluster::ClusterClientBuilder::new(node_urls);
        if !config.password.is_empty() {
            builder = builder.password(config.password.clone());
        }

        let cluster_client = builder.build()
            .map_err(|e| format!("Redis 集群客户端创建失败: {}", e))?;
        let cluster_conn = cluster_client.get_async_connection()
            .await
            .map_err(|e| format!("Redis 集群连接失败: {}", e))?;
        Ok(RedisConn::Cluster(cluster_conn))
    } else {
        Ok(RedisConn::Single(conn))
    }
}

/// 测试连接
pub async fn test_connection(conn: &mut RedisConn) -> Result<String, String> {
    let result = tokio::time::timeout(QUERY_TIMEOUT, async {
        let info: String = redis::cmd("INFO")
            .query_async(conn)
            .await
            .map_err(|e| format!("获取 Redis 信息失败: {}", e))?;

        // 解析版本
        for line in info.lines() {
            if line.starts_with("redis_version:") {
                let version = line.trim_start_matches("redis_version:").trim();
                if conn.is_cluster() {
                    return Ok(format!("Redis {} (Cluster)", version));
                }
                return Ok(format!("Redis {}", version));
            }
        }
        if conn.is_cluster() {
            Ok("Redis Cluster".to_string())
        } else {
            Ok("Redis".to_string())
        }
    }).await;

    match result {
        Ok(r) => r,
        Err(_) => Err("连接超时".to_string()),
    }
}

/// 获取数据库列表（Redis 的 keyspaces）
pub async fn get_databases(conn: &mut RedisConn) -> Result<Vec<DatabaseInfo>, String> {
    // 集群模式只支持 db0
    if conn.is_cluster() {
        return Ok(vec![DatabaseInfo {
            name: "db0".to_string(),
            charset: None,
            collation: None,
        }]);
    }

    let info: String = redis::cmd("INFO")
        .arg("keyspace")
        .query_async(conn)
        .await
        .map_err(|e| format!("获取 keyspace 信息失败: {}", e))?;

    let mut databases = Vec::new();
    databases.push(DatabaseInfo {
        name: "db0".to_string(),
        charset: None,
        collation: None,
    });

    // 解析 keyspace 信息
    for line in info.lines() {
        if line.starts_with("db") && line.contains(':') {
            let name = line.split(':').next().unwrap_or("").trim();
            if !name.is_empty() && !databases.iter().any(|d| d.name == name) {
                databases.push(DatabaseInfo {
                    name: name.to_string(),
                    charset: None,
                    collation: None,
                });
            }
        }
    }

    // 添加所有可能的数据库
    for i in 0..16 {
        let name = format!("db{}", i);
        if !databases.iter().any(|d| d.name == name) {
            databases.push(DatabaseInfo {
                name,
                charset: None,
                collation: None,
            });
        }
    }

    databases.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(databases)
}

/// 获取 key 列表（作为"表"）
pub async fn get_tables(conn: &mut RedisConn, database: &str) -> Result<Vec<TableInfo>, String> {
    // 集群模式不支持 SELECT
    if !conn.is_cluster() {
        let db_num: u32 = database.trim_start_matches("db").parse().unwrap_or(0);
        redis::cmd("SELECT")
            .arg(db_num)
            .query_async::<_, ()>(conn)
            .await
            .map_err(|e| format!("切换数据库失败: {}", e))?;
    }

    // 获取 key 数量
    let db_size: u32 = redis::cmd("DBSIZE")
        .query_async(conn)
        .await
        .map_err(|e| format!("获取 DBSIZE 失败: {}", e))?;

    // 获取部分 key 作为示例
    let (_cursor, keys): (u64, Vec<String>) = redis::cmd("SCAN")
        .arg(0)
        .arg("COUNT")
        .arg(100)
        .query_async(conn)
        .await
        .map_err(|e| format!("SCAN 失败: {}", e))?;

    let mut tables = Vec::new();
    tables.push(TableInfo {
        name: format!("共 {} 个 key", db_size),
        schema: None,
        table_type: "info".to_string(),
        row_count: Some(db_size as u64),
    });

    for key in keys {
        let key_type: String = redis::cmd("TYPE")
            .arg(&key)
            .query_async(conn)
            .await
            .unwrap_or_else(|_| "unknown".to_string());

        tables.push(TableInfo {
            name: key,
            schema: None,
            table_type: key_type,
            row_count: None,
        });
    }

    Ok(tables)
}

/// 获取 key 的结构（类型和值）
pub async fn get_table_schema(conn: &mut RedisConn, _database: &str, table: &str) -> Result<TableSchema, String> {
    let key_type: String = redis::cmd("TYPE")
        .arg(table)
        .query_async(conn)
        .await
        .map_err(|e| format!("获取 key 类型失败: {}", e))?;

    let mut columns = Vec::new();

    match key_type.as_str() {
        "string" => {
            let value: String = conn.get(table).await.map_err(|e| format!("获取值失败: {}", e))?;
            columns.push(ColumnSchema {
                name: "value".to_string(),
                data_type: "string".to_string(),
                length: None,
                nullable: true,
                default: None,
                is_primary_key: false,
                auto_increment: false,
                comment: Some(value),
            });
        }
        "list" => {
            let len: u32 = conn.llen(table).await.map_err(|e| format!("获取列表长度失败: {}", e))?;
            columns.push(ColumnSchema {
                name: "length".to_string(),
                data_type: "integer".to_string(),
                length: None,
                nullable: false,
                default: Some(len.to_string()),
                is_primary_key: false,
                auto_increment: false,
                comment: None,
            });
            if len > 0 {
                let items: Vec<String> = conn.lrange(table, 0, 9).await.map_err(|e| format!("获取列表元素失败: {}", e))?;
                for (i, item) in items.iter().enumerate() {
                    columns.push(ColumnSchema {
                        name: format!("[{}]", i),
                        data_type: "string".to_string(),
                        length: None,
                        nullable: true,
                        default: None,
                        is_primary_key: false,
                        auto_increment: false,
                        comment: Some(item.clone()),
                    });
                }
            }
        }
        "set" => {
            let members: Vec<String> = conn.smembers(table).await.map_err(|e| format!("获取集合成员失败: {}", e))?;
            columns.push(ColumnSchema {
                name: "size".to_string(),
                data_type: "integer".to_string(),
                length: None,
                nullable: false,
                default: Some(members.len().to_string()),
                is_primary_key: false,
                auto_increment: false,
                comment: None,
            });
            for (i, member) in members.iter().enumerate().take(10) {
                columns.push(ColumnSchema {
                    name: format!("member_{}", i),
                    data_type: "string".to_string(),
                    length: None,
                    nullable: true,
                    default: None,
                    is_primary_key: false,
                    auto_increment: false,
                    comment: Some(member.clone()),
                });
            }
        }
        "zset" => {
            let count: u32 = conn.zcard(table).await.map_err(|e| format!("获取有序集合大小失败: {}", e))?;
            columns.push(ColumnSchema {
                name: "size".to_string(),
                data_type: "integer".to_string(),
                length: None,
                nullable: false,
                default: Some(count.to_string()),
                is_primary_key: false,
                auto_increment: false,
                comment: None,
            });
            let items: Vec<(String, f64)> = conn.zrange_withscores(table, 0, 9).await.map_err(|e| format!("获取有序集合元素失败: {}", e))?;
            for (i, (member, score)) in items.iter().enumerate() {
                columns.push(ColumnSchema {
                    name: format!("[{}] {}", i, member),
                    data_type: "score".to_string(),
                    length: None,
                    nullable: true,
                    default: None,
                    is_primary_key: false,
                    auto_increment: false,
                    comment: Some(score.to_string()),
                });
            }
        }
        "hash" => {
            let fields: Vec<(String, String)> = conn.hgetall(table).await.map_err(|e| format!("获取哈希字段失败: {}", e))?;
            columns.push(ColumnSchema {
                name: "size".to_string(),
                data_type: "integer".to_string(),
                length: None,
                nullable: false,
                default: Some(fields.len().to_string()),
                is_primary_key: false,
                auto_increment: false,
                comment: None,
            });
            for (_i, (field, value)) in fields.iter().enumerate().take(10) {
                columns.push(ColumnSchema {
                    name: field.clone(),
                    data_type: "string".to_string(),
                    length: None,
                    nullable: true,
                    default: None,
                    is_primary_key: false,
                    auto_increment: false,
                    comment: Some(value.clone()),
                });
            }
        }
        _ => {
            columns.push(ColumnSchema {
                name: "type".to_string(),
                data_type: "string".to_string(),
                length: None,
                nullable: false,
                default: Some(key_type),
                is_primary_key: false,
                auto_increment: false,
                comment: None,
            });
        }
    }

    Ok(TableSchema {
        name: table.to_string(),
        columns,
    })
}

/// 根据 key 类型返回对应的读取命令和参数
fn read_command_for_type(key_type: &str, key: &str) -> (String, Vec<String>) {
    match key_type {
        "string" => ("GET".to_string(), vec![key.to_string()]),
        "list" => ("LRANGE".to_string(), vec![key.to_string(), "0".to_string(), "-1".to_string()]),
        "set" => ("SMEMBERS".to_string(), vec![key.to_string()]),
        "hash" => ("HGETALL".to_string(), vec![key.to_string()]),
        "zset" => ("ZRANGE".to_string(), vec![key.to_string(), "0".to_string(), "-1".to_string(), "WITHSCORES".to_string()]),
        "stream" => ("XRANGE".to_string(), vec![key.to_string(), "-".to_string(), "+".to_string()]),
        _ => ("GET".to_string(), vec![key.to_string()]),
    }
}

/// 执行 Redis 命令
pub async fn execute_query(conn: &mut RedisConn, command: &str) -> Result<QueryResult, String> {
    let start = std::time::Instant::now();

    // 解析命令
    let parts: Vec<&str> = command.split_whitespace().collect();
    if parts.is_empty() {
        return Err("命令不能为空".to_string());
    }

    let cmd_name = parts[0].to_uppercase();

    // 集群模式不支持 SELECT
    if conn.is_cluster() && cmd_name == "SELECT" {
        return Err("Redis 集群模式不支持 SELECT 命令（仅支持 db0）".to_string());
    }

    let mut cmd = redis::cmd(parts[0]);
    for part in &parts[1..] {
        cmd.arg(part);
    }

    // 尝试执行命令；如果 GET 遇到 WRONGTYPE，自动检测 key 类型并用正确命令重试
    let result: redis::Value = match tokio::time::timeout(QUERY_TIMEOUT, cmd.query_async(conn))
        .await
        .map_err(|_| "命令执行超时".to_string())?
    {
        Ok(val) => val,
        Err(e) => {
            let err_msg = format!("{}", e);
            if cmd_name == "GET" && parts.len() >= 2 && err_msg.contains("WRONGTYPE") {
                // 检测 key 类型
                let key_type: String = redis::cmd("TYPE")
                    .arg(parts[1])
                    .query_async(conn)
                    .await
                    .map_err(|e2| format!("获取 key 类型失败: {}", e2))?;
                if key_type == "none" {
                    return Err(format!("key '{}' 不存在", parts[1]));
                }
                let (new_cmd_name, new_args) = read_command_for_type(&key_type, parts[1]);
                let mut retry_cmd = redis::cmd(&new_cmd_name);
                for arg in &new_args {
                    retry_cmd.arg(arg);
                }
                retry_cmd.query_async(conn)
                    .await
                    .map_err(|e2| format!("命令执行失败: {}", e2))?
            } else {
                return Err(format!("命令执行失败: {}", e));
            }
        }
    };

    let elapsed = start.elapsed().as_millis() as u64;

    // 转换结果
    let mut columns = Vec::new();
    let mut rows = Vec::new();

    match result {
        redis::Value::Nil => {
            columns.push(ColumnInfo { name: "result".to_string(), data_type: "string".to_string(), nullable: true });
            rows.push(vec![Some("(nil)".to_string())]);
        }
        redis::Value::Int(n) => {
            columns.push(ColumnInfo { name: "result".to_string(), data_type: "integer".to_string(), nullable: false });
            rows.push(vec![Some(n.to_string())]);
        }
        redis::Value::Data(bytes) => {
            columns.push(ColumnInfo { name: "result".to_string(), data_type: "string".to_string(), nullable: false });
            let s = String::from_utf8_lossy(&bytes).to_string();
            rows.push(vec![Some(s)]);
        }
        redis::Value::Status(s) => {
            columns.push(ColumnInfo { name: "result".to_string(), data_type: "string".to_string(), nullable: false });
            rows.push(vec![Some(s)]);
        }
        redis::Value::Okay => {
            columns.push(ColumnInfo { name: "result".to_string(), data_type: "string".to_string(), nullable: false });
            rows.push(vec![Some("OK".to_string())]);
        }
        redis::Value::Bulk(values) => {
            columns.push(ColumnInfo { name: "index".to_string(), data_type: "integer".to_string(), nullable: false });
            columns.push(ColumnInfo { name: "value".to_string(), data_type: "string".to_string(), nullable: true });
            for (i, value) in values.iter().enumerate() {
                let s = match value {
                    redis::Value::Nil => None,
                    redis::Value::Int(n) => Some(n.to_string()),
                    redis::Value::Data(bytes) => Some(String::from_utf8_lossy(bytes).to_string()),
                    redis::Value::Status(s) => Some(s.clone()),
                    redis::Value::Okay => Some("OK".to_string()),
                    _ => Some(format!("{:?}", value)),
                };
                rows.push(vec![Some(i.to_string()), s]);
            }
        }
        _ => {
            columns.push(ColumnInfo { name: "result".to_string(), data_type: "string".to_string(), nullable: false });
            rows.push(vec![Some(format!("{:?}", result))]);
        }
    }

    let row_count = rows.len();

    Ok(QueryResult {
        success: true,
        columns,
        rows,
        row_count,
        execution_time_ms: elapsed,
        error: None,
    })
}

/// 执行 Redis 写命令（SET, DEL 等）
pub async fn execute_statement(conn: &mut RedisConn, command: &str) -> Result<ExecuteResult, String> {
    let start = std::time::Instant::now();

    let parts: Vec<&str> = command.split_whitespace().collect();
    if parts.is_empty() {
        return Err("命令不能为空".to_string());
    }

    let cmd_name = parts[0].to_uppercase();

    // 集群模式不支持 SELECT
    if conn.is_cluster() && cmd_name == "SELECT" {
        return Err("Redis 集群模式不支持 SELECT 命令（仅支持 db0）".to_string());
    }

    let mut cmd = redis::cmd(parts[0]);
    for part in &parts[1..] {
        cmd.arg(part);
    }

    let result: redis::Value = tokio::time::timeout(QUERY_TIMEOUT, cmd.query_async(conn))
        .await
        .map_err(|_| "命令执行超时".to_string())?
        .map_err(|e| format!("命令执行失败: {}", e))?;

    let elapsed = start.elapsed().as_millis() as u64;

    let affected_rows = match result {
        redis::Value::Int(n) => n as u64,
        redis::Value::Okay => 1,
        _ => 0,
    };

    Ok(ExecuteResult {
        success: true,
        affected_rows,
        last_insert_id: None,
        execution_time_ms: elapsed,
        error: None,
    })
}
