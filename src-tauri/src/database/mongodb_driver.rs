use crate::database::{ConnectionConfig, QueryResult, ColumnInfo, ExecuteResult, TableInfo, DatabaseInfo, TableSchema, ColumnSchema};
use mongodb::bson::{doc, Document};
use mongodb::options::FindOptions;
use std::time::Duration;

const QUERY_TIMEOUT: Duration = Duration::from_secs(30);

/// 构建 MongoDB 连接字符串
pub fn build_connection_string(config: &ConnectionConfig) -> String {
    if config.username.is_empty() {
        format!("mongodb://{}:{}", config.host, config.port)
    } else {
        let encoded_username = urlencoding::encode(&config.username);
        let encoded_password = urlencoding::encode(&config.password);
        if config.database.is_empty() {
            format!("mongodb://{}:{}@{}:{}", encoded_username, encoded_password, config.host, config.port)
        } else {
            format!("mongodb://{}:{}@{}:{}/{}", encoded_username, encoded_password, config.host, config.port, config.database)
        }
    }
}

/// 测试连接
pub async fn test_connection(client: &mongodb::Client) -> Result<String, String> {
    let db = client.database("admin");
    let result = db.run_command(doc! { "serverStatus": 1 }, None)
        .await
        .map_err(|e| format!("获取服务器信息失败: {}", e))?;

    let version = result.get_str("version").unwrap_or("unknown");
    Ok(format!("MongoDB {}", version))
}

/// 获取数据库列表
pub async fn get_databases(client: &mongodb::Client) -> Result<Vec<DatabaseInfo>, String> {
    let databases = client.list_database_names(None, None)
        .await
        .map_err(|e| format!("获取数据库列表失败: {}", e))?;

    Ok(databases.into_iter().map(|name| DatabaseInfo {
        name,
        charset: None,
        collation: None,
    }).collect())
}

/// 获取集合列表（作为"表"）
pub async fn get_tables(db: &mongodb::Database) -> Result<Vec<TableInfo>, String> {
    let collections = db.list_collection_names(None)
        .await
        .map_err(|e| format!("获取集合列表失败: {}", e))?;

    let mut tables = Vec::new();
    for name in collections {
        // 获取文档数量
        let count = db.collection::<Document>(&name).count_documents(None, None)
            .await
            .unwrap_or(0);

        tables.push(TableInfo {
            name,
            schema: None,
            table_type: "collection".to_string(),
            row_count: Some(count),
        });
    }

    Ok(tables)
}

/// 获取集合结构（采样文档推断字段）
pub async fn get_table_schema(db: &mongodb::Database, collection: &str) -> Result<TableSchema, String> {
    let coll = db.collection::<Document>(collection);

    // 采样几个文档推断字段
    let options = FindOptions::builder()
        .limit(5)
        .build();

    let mut cursor = coll.find(None, options)
        .await
        .map_err(|e| format!("查询集合失败: {}", e))?;

    let mut fields: Vec<ColumnSchema> = Vec::new();
    let mut field_set = std::collections::HashSet::new();

    while cursor.advance().await.map_err(|e| format!("读取文档失败: {}", e))? {
        let doc: Document = cursor.deserialize_current()
            .map_err(|e| format!("文档反序列化失败: {}", e))?;
        for (key, value) in &doc {
            if field_set.insert(key.clone()) {
                fields.push(ColumnSchema {
                    name: key.clone(),
                    data_type: bson_type_to_string(value),
                    length: None,
                    nullable: true,
                    default: None,
                    is_primary_key: key == "_id",
                    auto_increment: false,
                    comment: None,
                });
            }
        }
    }

    Ok(TableSchema {
        name: collection.to_string(),
        columns: fields,
    })
}

fn bson_type_to_string(value: &mongodb::bson::Bson) -> String {
    match value {
        mongodb::bson::Bson::Double(_) => "double",
        mongodb::bson::Bson::String(_) => "string",
        mongodb::bson::Bson::Array(_) => "array",
        mongodb::bson::Bson::Document(_) => "object",
        mongodb::bson::Bson::Boolean(_) => "boolean",
        mongodb::bson::Bson::Null => "null",
        mongodb::bson::Bson::Int32(_) => "int32",
        mongodb::bson::Bson::Int64(_) => "int64",
        mongodb::bson::Bson::Timestamp(_) => "timestamp",
        mongodb::bson::Bson::DateTime(_) => "datetime",
        mongodb::bson::Bson::ObjectId(_) => "objectId",
        _ => "unknown",
    }.to_string()
}

/// 执行 MongoDB 查询（find）
pub async fn execute_query(db: &mongodb::Database, collection: &str, filter_json: &str, limit: Option<i64>) -> Result<QueryResult, String> {
    let start = std::time::Instant::now();

    let filter: Document = if filter_json.trim().is_empty() || filter_json.trim() == "{}" {
        doc! {}
    } else {
        serde_json::from_str(filter_json)
            .map_err(|e| format!("过滤条件解析失败: {}", e))?
    };

    let options = FindOptions::builder()
        .limit(limit.or(Some(100)))
        .build();

    let coll = db.collection::<Document>(collection);
    let mut cursor = tokio::time::timeout(QUERY_TIMEOUT, coll.find(filter, options))
        .await
        .map_err(|_| "查询超时".to_string())?
        .map_err(|e| format!("查询失败: {}", e))?;

    // 第一遍：收集所有文档和列名
    let mut docs = Vec::new();
    let mut column_set = std::collections::HashSet::new();

    while cursor.advance().await.map_err(|e| format!("读取文档失败: {}", e))? {
        let doc: Document = cursor.deserialize_current()
            .map_err(|e| format!("文档反序列化失败: {}", e))?;

        for (key, _) in &doc {
            column_set.insert(key.clone());
        }
        docs.push(doc);
    }

    // 构建列定义
    let mut columns: Vec<ColumnInfo> = column_set.into_iter().map(|name| ColumnInfo {
        name: name.clone(),
        data_type: "mixed".to_string(),
        nullable: true,
    }).collect();
    columns.sort_by(|a, b| a.name.cmp(&b.name));

    // 第二遍：按列顺序构建行
    let mut rows = Vec::new();
    for doc in &docs {
        let row: Vec<Option<String>> = columns.iter()
            .map(|col| doc.get(&col.name).map(|v| bson_to_string(v)))
            .collect();
        rows.push(row);
    }

    let elapsed = start.elapsed().as_millis() as u64;
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

fn bson_to_string(value: &mongodb::bson::Bson) -> String {
    match value {
        mongodb::bson::Bson::Double(f) => format!("{}", f),
        mongodb::bson::Bson::String(s) => s.clone(),
        mongodb::bson::Bson::Array(arr) => {
            let items: Vec<String> = arr.iter().map(|v| bson_to_string(v)).collect();
            format!("[{}]", items.join(", "))
        }
        mongodb::bson::Bson::Document(doc) => {
            serde_json::to_string(doc).unwrap_or_else(|_| format!("{:?}", doc))
        }
        mongodb::bson::Bson::Boolean(b) => b.to_string(),
        mongodb::bson::Bson::Null => "null".to_string(),
        mongodb::bson::Bson::Int32(n) => n.to_string(),
        mongodb::bson::Bson::Int64(n) => n.to_string(),
        mongodb::bson::Bson::Timestamp(ts) => format!("Timestamp({}, {})", ts.time, ts.increment),
        mongodb::bson::Bson::DateTime(dt) => dt.to_string(),
        mongodb::bson::Bson::ObjectId(oid) => oid.to_string(),
        _ => format!("{:?}", value),
    }
}

/// 执行 MongoDB insert
pub async fn insert_document(db: &mongodb::Database, collection: &str, doc_json: &str) -> Result<ExecuteResult, String> {
    let start = std::time::Instant::now();

    let doc: Document = serde_json::from_str(doc_json)
        .map_err(|e| format!("文档解析失败: {}", e))?;

    let coll = db.collection::<Document>(collection);
    let _result = coll.insert_one(doc, None)
        .await
        .map_err(|e| format!("插入失败: {}", e))?;

    let elapsed = start.elapsed().as_millis() as u64;

    Ok(ExecuteResult {
        success: true,
        affected_rows: 1,
        last_insert_id: None,
        execution_time_ms: elapsed,
        error: None,
    })
}

/// 执行 MongoDB update
pub async fn update_documents(db: &mongodb::Database, collection: &str, filter_json: &str, update_json: &str) -> Result<ExecuteResult, String> {
    let start = std::time::Instant::now();

    let filter: Document = serde_json::from_str(filter_json)
        .map_err(|e| format!("过滤条件解析失败: {}", e))?;
    let update: Document = serde_json::from_str(update_json)
        .map_err(|e| format!("更新内容解析失败: {}", e))?;

    let coll = db.collection::<Document>(collection);
    let result = coll.update_many(filter, update, None)
        .await
        .map_err(|e| format!("更新失败: {}", e))?;

    let elapsed = start.elapsed().as_millis() as u64;

    Ok(ExecuteResult {
        success: true,
        affected_rows: result.modified_count,
        last_insert_id: None,
        execution_time_ms: elapsed,
        error: None,
    })
}

/// 执行 MongoDB delete
pub async fn delete_documents(db: &mongodb::Database, collection: &str, filter_json: &str) -> Result<ExecuteResult, String> {
    let start = std::time::Instant::now();

    let filter: Document = serde_json::from_str(filter_json)
        .map_err(|e| format!("过滤条件解析失败: {}", e))?;

    let coll = db.collection::<Document>(collection);
    let result = coll.delete_many(filter, None)
        .await
        .map_err(|e| format!("删除失败: {}", e))?;

    let elapsed = start.elapsed().as_millis() as u64;

    Ok(ExecuteResult {
        success: true,
        affected_rows: result.deleted_count,
        last_insert_id: None,
        execution_time_ms: elapsed,
        error: None,
    })
}
