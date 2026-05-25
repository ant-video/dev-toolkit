use crate::database::{ConnectionConfig, QueryResult, ColumnInfo, ExecuteResult, TableInfo, DatabaseInfo, TableSchema, ColumnSchema};
use serde_json::{json, Value};
use std::time::Duration;

/// Elasticsearch 连接信息
#[derive(Clone)]
pub struct ElasticsearchConnInfo {
    pub base_url: String,
    pub username: String,
    pub password: String,
}

/// 构建 Elasticsearch 连接信息
pub fn build_connection_info(config: &ConnectionConfig) -> ElasticsearchConnInfo {
    ElasticsearchConnInfo {
        base_url: format!("http://{}:{}", config.host, config.port),
        username: config.username.clone(),
        password: config.password.clone(),
    }
}

/// 创建带超时的 reqwest 客户端
pub fn create_client() -> reqwest::Client {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .build()
        .unwrap_or_default()
}

/// 为请求添加认证
fn add_auth(request: reqwest::RequestBuilder, conn_info: &ElasticsearchConnInfo) -> reqwest::RequestBuilder {
    if conn_info.username.is_empty() {
        request
    } else {
        request.basic_auth(&conn_info.username, Some(&conn_info.password))
    }
}

/// 测试连接
pub async fn test_connection(client: &reqwest::Client, conn_info: &ElasticsearchConnInfo) -> Result<String, String> {
    let request = client.get(&conn_info.base_url);
    let response = add_auth(request, conn_info)
        .send()
        .await
        .map_err(|e| format!("Elasticsearch 连接失败: {}", e))?;

    let body: Value = response.json()
        .await
        .map_err(|e| format!("解析响应失败: {}", e))?;

    let version = body["version"]["number"].as_str().unwrap_or("unknown");
    Ok(format!("Elasticsearch {}", version))
}

/// 获取索引列表（作为"数据库"）
pub async fn get_databases(client: &reqwest::Client, conn_info: &ElasticsearchConnInfo) -> Result<Vec<DatabaseInfo>, String> {
    let url = format!("{}/_cat/indices?format=json", conn_info.base_url);
    let request = client.get(&url);
    let response = add_auth(request, conn_info)
        .send()
        .await
        .map_err(|e| format!("获取索引列表失败: {}", e))?;

    let body: Value = response.json()
        .await
        .map_err(|e| format!("解析响应失败: {}", e))?;

    let mut databases = Vec::new();
    if let Some(indices) = body.as_array() {
        for index in indices {
            if let Some(name) = index["index"].as_str() {
                databases.push(DatabaseInfo {
                    name: name.to_string(),
                    charset: None,
                    collation: None,
                });
            }
        }
    }

    if databases.is_empty() {
        databases.push(DatabaseInfo {
            name: "_all".to_string(),
            charset: None,
            collation: None,
        });
    }

    Ok(databases)
}

/// 从 mapping 响应中提取字段列表
fn extract_fields_from_mapping(body: &Value, index: &str) -> Vec<String> {
    let mut fields = Vec::new();

    // ES 7+: index.mappings.properties
    if let Some(props) = body[index]["mappings"]["properties"].as_object() {
        for name in props.keys() {
            fields.push(name.clone());
        }
        if !fields.is_empty() { return fields; }
    }

    // ES 6: index.mappings.{type}.properties
    if let Some(mappings) = body[index]["mappings"].as_object() {
        for (_type_name, type_body) in mappings {
            if let Some(props) = type_body["properties"].as_object() {
                for name in props.keys() {
                    fields.push(name.clone());
                }
                if !fields.is_empty() { return fields; }
            }
        }
    }

    fields
}

/// 从样本文档提取字段（当 mapping 无显式定义时）
async fn get_fields_from_sample(client: &reqwest::Client, conn_info: &ElasticsearchConnInfo, index: &str) -> Result<Vec<String>, String> {
    let url = format!("{}/{}/_search?size=1", conn_info.base_url, index);
    let body = json!({ "query": { "match_all": {} }, "size": 1 });
    let request = client.post(&url).json(&body);
    let response = add_auth(request, conn_info)
        .send()
        .await
        .map_err(|e| format!("查询样本文档失败: {}", e))?;

    let resp: Value = response.json().await.unwrap_or_default();
    let mut fields = Vec::new();
    if let Some(hit) = resp["hits"]["hits"].as_array().and_then(|a| a.first()) {
        if let Some(source) = hit["_source"].as_object() {
            for key in source.keys() {
                fields.push(key.clone());
            }
        }
    }
    Ok(fields)
}

/// 获取索引下的映射（作为"表"）
pub async fn get_tables(client: &reqwest::Client, conn_info: &ElasticsearchConnInfo, index: &str) -> Result<Vec<TableInfo>, String> {
    let url = format!("{}/{}/_mapping", conn_info.base_url, index);
    let request = client.get(&url);
    let response = add_auth(request, conn_info)
        .send()
        .await
        .map_err(|e| format!("获取映射失败: {}", e))?;

    if response.status().is_success() {
        let body: Value = response.json()
            .await
            .map_err(|e| format!("解析响应失败: {}", e))?;

        let fields = extract_fields_from_mapping(&body, index);

        // 如果 mapping 中没有字段，尝试从样本文档获取
        let fields = if fields.is_empty() {
            get_fields_from_sample(client, conn_info, index).await.unwrap_or_default()
        } else {
            fields
        };

        if fields.is_empty() {
            return Ok(vec![TableInfo {
                name: "_doc".to_string(),
                schema: None,
                table_type: "type".to_string(),
                row_count: None,
            }]);
        }

        Ok(fields.into_iter().map(|name| TableInfo {
            name,
            schema: None,
            table_type: "field".to_string(),
            row_count: None,
        }).collect())
    } else {
        Err(format!("获取映射失败: HTTP {}", response.status()))
    }
}

/// 从 mapping 响应中提取字段及类型
fn extract_columns_from_mapping(body: &Value, index: &str) -> Vec<ColumnSchema> {
    let mut columns = Vec::new();

    // ES 7+: index.mappings.properties
    if let Some(props) = body[index]["mappings"]["properties"].as_object() {
        for (name, field_type) in props {
            let data_type = field_type["type"].as_str().unwrap_or("object").to_string();
            columns.push(ColumnSchema {
                name: name.clone(),
                data_type,
                length: None,
                nullable: true,
                default: None,
                is_primary_key: name == "_id",
                auto_increment: false,
                comment: None,
            });
        }
        if !columns.is_empty() { return columns; }
    }

    // ES 6: index.mappings.{type}.properties
    if let Some(mappings) = body[index]["mappings"].as_object() {
        for (_type_name, type_body) in mappings {
            if let Some(props) = type_body["properties"].as_object() {
                for (name, field_type) in props {
                    let data_type = field_type["type"].as_str().unwrap_or("object").to_string();
                    columns.push(ColumnSchema {
                        name: name.clone(),
                        data_type,
                        length: None,
                        nullable: true,
                        default: None,
                        is_primary_key: name == "_id",
                        auto_increment: false,
                        comment: None,
                    });
                }
                if !columns.is_empty() { return columns; }
            }
        }
    }

    columns
}

/// 从样本文档推断字段（当 mapping 无显式定义时）
async fn get_columns_from_sample(client: &reqwest::Client, conn_info: &ElasticsearchConnInfo, index: &str) -> Result<Vec<ColumnSchema>, String> {
    let url = format!("{}/{}/_search?size=1", conn_info.base_url, index);
    let body = json!({ "query": { "match_all": {} }, "size": 1 });
    let request = client.post(&url).json(&body);
    let response = add_auth(request, conn_info)
        .send()
        .await
        .map_err(|e| format!("查询样本文档失败: {}", e))?;

    let resp: Value = response.json().await.unwrap_or_default();
    let mut columns = Vec::new();
    if let Some(hit) = resp["hits"]["hits"].as_array().and_then(|a| a.first()) {
        if let Some(source) = hit["_source"].as_object() {
            for (key, val) in source {
                let data_type = match val {
                    Value::String(_) => "text",
                    Value::Number(n) => {
                        if n.is_f64() { "float" } else { "integer" }
                    }
                    Value::Bool(_) => "boolean",
                    Value::Array(_) => "array",
                    Value::Object(_) => "object",
                    _ => "text",
                }.to_string();
                columns.push(ColumnSchema {
                    name: key.clone(),
                    data_type,
                    length: None,
                    nullable: true,
                    default: None,
                    is_primary_key: false,
                    auto_increment: false,
                    comment: None,
                });
            }
        }
    }
    Ok(columns)
}

/// 获取索引映射结构
pub async fn get_table_schema(client: &reqwest::Client, conn_info: &ElasticsearchConnInfo, index: &str, _table: &str) -> Result<TableSchema, String> {
    let url = format!("{}/{}/_mapping", conn_info.base_url, index);
    let request = client.get(&url);
    let response = add_auth(request, conn_info)
        .send()
        .await
        .map_err(|e| format!("获取映射失败: {}", e))?;

    if response.status().is_success() {
        let body: Value = response.json()
            .await
            .map_err(|e| format!("解析响应失败: {}", e))?;

        let mut columns = extract_columns_from_mapping(&body, index);

        // 如果 mapping 中没有字段，尝试从样本文档推断
        if columns.is_empty() {
            columns = get_columns_from_sample(client, conn_info, index).await.unwrap_or_default();
        }

        // 最终兜底
        if columns.is_empty() {
            columns.push(ColumnSchema {
                name: "_id".to_string(),
                data_type: "keyword".to_string(),
                length: None,
                nullable: false,
                default: None,
                is_primary_key: true,
                auto_increment: false,
                comment: None,
            });
            columns.push(ColumnSchema {
                name: "_source".to_string(),
                data_type: "object".to_string(),
                length: None,
                nullable: true,
                default: None,
                is_primary_key: false,
                auto_increment: false,
                comment: None,
            });
        }

        Ok(TableSchema {
            name: index.to_string(),
            columns,
        })
    } else {
        Err(format!("获取映射失败: HTTP {}", response.status()))
    }
}

/// 执行 Elasticsearch 查询
pub async fn execute_query(client: &reqwest::Client, conn_info: &ElasticsearchConnInfo, index: &str, query_json: &str, size: Option<i64>) -> Result<QueryResult, String> {
    let start = std::time::Instant::now();

    let search_size = size.unwrap_or(100);

    // 智能判断用户输入：如果是完整 query body 则直接使用，否则包装
    let body: Value = if query_json.trim().is_empty() || query_json.trim() == "{}" {
        json!({ "query": { "match_all": {} }, "size": search_size })
    } else {
        let parsed: Value = serde_json::from_str(query_json)
            .map_err(|e| format!("查询解析失败: {}", e))?;
        if parsed.get("query").is_some() {
            // 用户已提供完整 query body，直接使用，补充 size
            let mut b = parsed.clone();
            if b.get("size").is_none() {
                b["size"] = json!(search_size);
            }
            b
        } else {
            // 用户只提供了 query 部分，包装完整请求
            json!({ "query": parsed, "size": search_size })
        }
    };

    let url = format!("{}/{}/_search", conn_info.base_url, index);
    let request = client.post(&url).json(&body);
    let response = add_auth(request, conn_info)
        .send()
        .await
        .map_err(|e| format!("查询失败: {}", e))?;

    if !response.status().is_success() {
        let error_body: Value = response.json().await.unwrap_or_default();
        let error_msg = error_body["error"]["reason"].as_str().unwrap_or("未知错误");
        return Err(format!("查询失败: {}", error_msg));
    }

    let resp_body: Value = response.json()
        .await
        .map_err(|e| format!("解析响应失败: {}", e))?;

    // 第一遍：收集所有列名
    let mut column_set = std::collections::HashSet::new();
    column_set.insert("_id".to_string());
    column_set.insert("_score".to_string());

    let empty_hits = vec![];
    let hits = resp_body["hits"]["hits"].as_array().unwrap_or(&empty_hits);
    let mut source_fields = std::collections::HashSet::new();

    for hit in hits {
        if let Some(source) = hit["_source"].as_object() {
            for key in source.keys() {
                if source_fields.insert(key.clone()) {
                    column_set.insert(key.clone());
                }
            }
        }
    }

    // 构建列定义
    let mut columns = vec![
        ColumnInfo { name: "_id".to_string(), data_type: "keyword".to_string(), nullable: false },
        ColumnInfo { name: "_score".to_string(), data_type: "double".to_string(), nullable: true },
    ];
    let mut extra_cols: Vec<ColumnInfo> = source_fields.into_iter().map(|name| ColumnInfo {
        name: name.clone(),
        data_type: "mixed".to_string(),
        nullable: true,
    }).collect();
    extra_cols.sort_by(|a, b| a.name.cmp(&b.name));
    columns.extend(extra_cols);

    // 第二遍：按列顺序构建行
    let mut rows = Vec::new();
    for hit in hits {
        let mut row = Vec::new();
        for col in &columns {
            let value = match col.name.as_str() {
                "_id" => hit["_id"].as_str().map(|s| s.to_string()),
                "_score" => hit["_score"].as_f64().map(|f| f.to_string()),
                _ => {
                    hit["_source"][&col.name].as_str().map(|s| s.to_string())
                        .or_else(|| Some(json_value_to_string(&hit["_source"][&col.name])))
                }
            };
            row.push(value);
        }
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

/// 索引文档
pub async fn insert_document(client: &reqwest::Client, conn_info: &ElasticsearchConnInfo, index: &str, doc_json: &str) -> Result<ExecuteResult, String> {
    let start = std::time::Instant::now();

    let doc: Value = serde_json::from_str(doc_json)
        .map_err(|e| format!("文档解析失败: {}", e))?;

    let url = format!("{}/{}/_doc", conn_info.base_url, index);
    let request = client.post(&url).json(&doc);
    let response = add_auth(request, conn_info)
        .send()
        .await
        .map_err(|e| format!("索引失败: {}", e))?;

    if !response.status().is_success() {
        let error_body: Value = response.json().await.unwrap_or_default();
        let error_msg = error_body["error"]["reason"].as_str().unwrap_or("未知错误");
        return Err(format!("索引失败: {}", error_msg));
    }

    let elapsed = start.elapsed().as_millis() as u64;

    Ok(ExecuteResult {
        success: true,
        affected_rows: 1,
        last_insert_id: None,
        execution_time_ms: elapsed,
        error: None,
    })
}

/// 删除文档
pub async fn delete_document(client: &reqwest::Client, conn_info: &ElasticsearchConnInfo, index: &str, id: &str) -> Result<ExecuteResult, String> {
    let start = std::time::Instant::now();

    let url = format!("{}/{}/_doc/{}", conn_info.base_url, index, id);
    let request = client.delete(&url);
    let response = add_auth(request, conn_info)
        .send()
        .await
        .map_err(|e| format!("删除失败: {}", e))?;

    if !response.status().is_success() {
        let error_body: Value = response.json().await.unwrap_or_default();
        let error_msg = error_body["error"]["reason"].as_str().unwrap_or("未知错误");
        return Err(format!("删除失败: {}", error_msg));
    }

    let elapsed = start.elapsed().as_millis() as u64;

    Ok(ExecuteResult {
        success: true,
        affected_rows: 1,
        last_insert_id: None,
        execution_time_ms: elapsed,
        error: None,
    })
}

fn json_value_to_string(value: &Value) -> String {
    match value {
        Value::String(s) => s.clone(),
        Value::Number(n) => n.to_string(),
        Value::Bool(b) => b.to_string(),
        Value::Null => "null".to_string(),
        Value::Array(arr) => {
            let items: Vec<String> = arr.iter().map(|v| json_value_to_string(v)).collect();
            format!("[{}]", items.join(", "))
        }
        Value::Object(_) => serde_json::to_string(value).unwrap_or_default(),
    }
}
