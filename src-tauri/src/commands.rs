use serde::{Deserialize, Serialize};
use base64::Engine;
use digest::Digest;
use chrono::{TimeZone, Timelike};

// ==================== 时间转换 ====================
#[derive(Serialize, Deserialize)]
pub struct TimeConvertResult {
    pub timestamp: i64,
    pub timestamp_ms: i64,
    pub utc: String,
    pub local: String,
    pub relative: String,
    pub iso8601: String,
}

#[tauri::command]
pub fn timestamp_now() -> TimeConvertResult {
    let now = chrono::Utc::now();
    let ts = now.timestamp();
    let ts_ms = now.timestamp_millis();
    let local = chrono::Local::now();
    TimeConvertResult {
        timestamp: ts,
        timestamp_ms: ts_ms,
        utc: now.format("%Y-%m-%d %H:%M:%S UTC").to_string(),
        local: local.format("%Y-%m-%d %H:%M:%S").to_string(),
        relative: "刚刚".to_string(),
        iso8601: now.to_rfc3339(),
    }
}

#[tauri::command]
pub fn timestamp_to_date(timestamp: i64, unit: String) -> Result<TimeConvertResult, String> {
    let ts = if unit == "ms" { timestamp / 1000 } else { timestamp };
    let ts_ms = if unit == "ms" { timestamp } else { timestamp * 1000 };
    let dt = chrono::DateTime::from_timestamp(ts, 0).ok_or("无效的时间戳")?;
    let local_dt = dt.with_timezone(&chrono::Local);
    let now = chrono::Utc::now();
    let diff = now - dt;
    let relative = if diff.num_seconds() < 0 {
        format!("{}秒后", -diff.num_seconds())
    } else if diff.num_seconds() < 60 {
        format!("{}秒前", diff.num_seconds())
    } else if diff.num_minutes() < 60 {
        format!("{}分钟前", diff.num_minutes())
    } else if diff.num_hours() < 24 {
        format!("{}小时前", diff.num_hours())
    } else {
        format!("{}天前", diff.num_days())
    };

    Ok(TimeConvertResult {
        timestamp: ts,
        timestamp_ms: ts_ms,
        utc: dt.format("%Y-%m-%d %H:%M:%S UTC").to_string(),
        local: local_dt.format("%Y-%m-%d %H:%M:%S").to_string(),
        relative,
        iso8601: dt.to_rfc3339(),
    })
}

#[tauri::command]
pub fn date_to_timestamp(date_str: String, format_str: String) -> Result<TimeConvertResult, String> {
    let fmt = if format_str.is_empty() { "%Y-%m-%d %H:%M:%S" } else { &format_str };
    let dt = chrono::NaiveDateTime::parse_from_str(&date_str, fmt)
        .map_err(|e| format!("日期解析失败: {}", e))?;
    let local = chrono::Local;
    let local_dt = local.from_local_datetime(&dt).single().ok_or("时区转换失败")?;
    let utc_dt = local_dt.to_utc();
    Ok(TimeConvertResult {
        timestamp: utc_dt.timestamp(),
        timestamp_ms: utc_dt.timestamp_millis(),
        utc: utc_dt.format("%Y-%m-%d %H:%M:%S UTC").to_string(),
        local: local_dt.format("%Y-%m-%d %H:%M:%S").to_string(),
        relative: String::new(),
        iso8601: utc_dt.to_rfc3339(),
    })
}

// ==================== JSON 工具 ====================
#[derive(Serialize)]
pub struct JsonResult {
    pub success: bool,
    pub result: String,
    pub error: Option<String>,
}

#[tauri::command]
pub fn json_format(input: String, indent: u32) -> JsonResult {
    match serde_json::from_str::<serde_json::Value>(&input) {
        Ok(val) => {
            let result = if indent == 2 {
                serde_json::to_string_pretty(&val).unwrap_or_default()
            } else {
                let mut buf = Vec::new();
                let formatter = serde_json::ser::PrettyFormatter::with_indent("    ".as_bytes());
                let mut ser = serde_json::Serializer::with_formatter(&mut buf, formatter);
                val.serialize(&mut ser).unwrap();
                String::from_utf8(buf).unwrap_or_default()
            };
            JsonResult { success: true, result, error: None }
        }
        Err(e) => JsonResult { success: false, result: input, error: Some(e.to_string()) }
    }
}

#[tauri::command]
pub fn json_minify(input: String) -> JsonResult {
    match serde_json::from_str::<serde_json::Value>(&input) {
        Ok(val) => {
            let result = serde_json::to_string(&val).unwrap_or_default();
            JsonResult { success: true, result, error: None }
        }
        Err(e) => JsonResult { success: false, result: input, error: Some(e.to_string()) }
    }
}

#[tauri::command]
pub fn json_validate(input: String) -> JsonResult {
    match serde_json::from_str::<serde_json::Value>(&input) {
        Ok(val) => {
            let tp = match val {
                serde_json::Value::Null => "null",
                serde_json::Value::Bool(_) => "boolean",
                serde_json::Value::Number(_) => "number",
                serde_json::Value::String(_) => "string",
                serde_json::Value::Array(_) => "array",
                serde_json::Value::Object(_) => "object",
            };
            JsonResult { success: true, result: format!("✓ 合法的 JSON (类型: {})", tp), error: None }
        }
        Err(e) => JsonResult { success: false, result: String::new(), error: Some(format!("✗ 无效的 JSON: {}", e)) }
    }
}

#[tauri::command]
pub fn json_unescape(input: String) -> JsonResult {
    let trimmed = input.trim();
    if trimmed.starts_with('"') {
        match serde_json::from_str::<serde_json::Value>(trimmed) {
            Ok(serde_json::Value::String(s)) => {
                JsonResult { success: true, result: s, error: None }
            }
            Ok(_) => {
                let result = serde_json::to_string_pretty(&serde_json::from_str::<serde_json::Value>(trimmed).unwrap()).unwrap_or_default();
                JsonResult { success: true, result, error: None }
            }
            Err(e) => JsonResult { success: false, result: input, error: Some(format!("JSON 解析失败: {}", e)) }
        }
    } else {
        match serde_json::from_str::<serde_json::Value>(trimmed) {
            Ok(val) => {
                let result = serde_json::to_string_pretty(&val).unwrap_or_default();
                JsonResult { success: true, result, error: None }
            }
            Err(_) => {
                let double_quoted = format!("\"{}\"", trimmed.replace('\\', "\\\\").replace('"', "\\\""));
                match serde_json::from_str::<serde_json::Value>(&double_quoted) {
                    Ok(serde_json::Value::String(s)) => {
                        match serde_json::from_str::<serde_json::Value>(&s) {
                            Ok(val) => {
                                let result = serde_json::to_string_pretty(&val).unwrap_or_default();
                                JsonResult { success: true, result, error: None }
                            }
                            Err(_) => {
                                JsonResult { success: true, result: s, error: None }
                            }
                        }
                    }
                    _ => JsonResult { success: false, result: input, error: Some("无法去转义".to_string()) }
                }
            }
        }
    }
}

// ==================== 文本对比 (逐行 diff) ====================
#[derive(Serialize)]
pub struct DiffLine {
    pub line_num: usize,
    pub content: String,
    pub diff_type: String,
}

#[derive(Serialize)]
pub struct DiffResult {
    pub left: Vec<DiffLine>,
    pub right: Vec<DiffLine>,
    pub stats: DiffStats,
}

#[derive(Serialize)]
pub struct DiffStats {
    pub added: usize,
    pub deleted: usize,
    pub changed: usize,
    pub same: usize,
}

#[tauri::command]
pub fn text_diff(left: String, right: String) -> DiffResult {
    let left_lines: Vec<&str> = left.lines().collect();
    let right_lines: Vec<&str> = right.lines().collect();
    let llen = left_lines.len();
    let rlen = right_lines.len();

    if llen > 5000 || rlen > 5000 {
        return simple_diff(&left_lines, &right_lines);
    }

    let mut dp = vec![vec![0usize; rlen + 1]; llen + 1];
    for i in 1..=llen {
        for j in 1..=rlen {
            if left_lines[i-1] == right_lines[j-1] {
                dp[i][j] = dp[i-1][j-1] + 1;
            } else {
                dp[i][j] = dp[i-1][j].max(dp[i][j-1]);
            }
        }
    }

    let mut left_result: Vec<DiffLine> = Vec::new();
    let mut right_result: Vec<DiffLine> = Vec::new();
    let mut i = llen;
    let mut j = rlen;
    let mut ops: Vec<(String, usize, usize)> = Vec::new();

    while i > 0 || j > 0 {
        if i > 0 && j > 0 && left_lines[i-1] == right_lines[j-1] {
            ops.push(("same".to_string(), i-1, j-1));
            i -= 1;
            j -= 1;
        } else if j > 0 && (i == 0 || dp[i][j-1] >= dp[i-1][j]) {
            ops.push(("add".to_string(), 0, j-1));
            j -= 1;
        } else {
            ops.push(("del".to_string(), i-1, 0));
            i -= 1;
        }
    }
    ops.reverse();

    let mut stats = DiffStats { added: 0, deleted: 0, changed: 0, same: 0 };
    let mut idx = 0;
    while idx < ops.len() {
        if ops[idx].0 == "del" {
            let mut dels = Vec::new();
            while idx < ops.len() && ops[idx].0 == "del" {
                dels.push(ops[idx].1);
                idx += 1;
            }
            let mut adds = Vec::new();
            while idx < ops.len() && ops[idx].0 == "add" {
                adds.push(ops[idx].2);
                idx += 1;
            }
            let pairs = dels.len().min(adds.len());
            for k in 0..pairs {
                left_result.push(DiffLine { line_num: dels[k] + 1, content: left_lines[dels[k]].to_string(), diff_type: "change".to_string() });
                right_result.push(DiffLine { line_num: adds[k] + 1, content: right_lines[adds[k]].to_string(), diff_type: "change".to_string() });
                stats.changed += 1;
            }
            for k in pairs..dels.len() {
                left_result.push(DiffLine { line_num: dels[k] + 1, content: left_lines[dels[k]].to_string(), diff_type: "del".to_string() });
                right_result.push(DiffLine { line_num: 0, content: String::new(), diff_type: "placeholder".to_string() });
                stats.deleted += 1;
            }
            for k in pairs..adds.len() {
                left_result.push(DiffLine { line_num: 0, content: String::new(), diff_type: "placeholder".to_string() });
                right_result.push(DiffLine { line_num: adds[k] + 1, content: right_lines[adds[k]].to_string(), diff_type: "add".to_string() });
                stats.added += 1;
            }
        } else if ops[idx].0 == "add" {
            let aj = ops[idx].2;
            left_result.push(DiffLine { line_num: 0, content: String::new(), diff_type: "placeholder".to_string() });
            right_result.push(DiffLine { line_num: aj + 1, content: right_lines[aj].to_string(), diff_type: "add".to_string() });
            stats.added += 1;
            idx += 1;
        } else {
            let li = ops[idx].1;
            let rj = ops[idx].2;
            left_result.push(DiffLine { line_num: li + 1, content: left_lines[li].to_string(), diff_type: "same".to_string() });
            right_result.push(DiffLine { line_num: rj + 1, content: right_lines[rj].to_string(), diff_type: "same".to_string() });
            stats.same += 1;
            idx += 1;
        }
    }

    DiffResult { left: left_result, right: right_result, stats }
}

fn simple_diff(left_lines: &[&str], right_lines: &[&str]) -> DiffResult {
    let max = left_lines.len().max(right_lines.len());
    let mut left_result = Vec::new();
    let mut right_result = Vec::new();
    let mut stats = DiffStats { added: 0, deleted: 0, changed: 0, same: 0 };

    for i in 0..max {
        let l = left_lines.get(i);
        let r = right_lines.get(i);
        match (l, r) {
            (Some(lv), Some(rv)) => {
                if lv == rv {
                    left_result.push(DiffLine { line_num: i+1, content: lv.to_string(), diff_type: "same".to_string() });
                    right_result.push(DiffLine { line_num: i+1, content: rv.to_string(), diff_type: "same".to_string() });
                    stats.same += 1;
                } else {
                    left_result.push(DiffLine { line_num: i+1, content: lv.to_string(), diff_type: "change".to_string() });
                    right_result.push(DiffLine { line_num: i+1, content: rv.to_string(), diff_type: "change".to_string() });
                    stats.changed += 1;
                }
            }
            (Some(lv), None) => {
                left_result.push(DiffLine { line_num: i+1, content: lv.to_string(), diff_type: "del".to_string() });
                right_result.push(DiffLine { line_num: 0, content: String::new(), diff_type: "placeholder".to_string() });
                stats.deleted += 1;
            }
            (None, Some(rv)) => {
                left_result.push(DiffLine { line_num: 0, content: String::new(), diff_type: "placeholder".to_string() });
                right_result.push(DiffLine { line_num: i+1, content: rv.to_string(), diff_type: "add".to_string() });
                stats.added += 1;
            }
            _ => {}
        }
    }
    DiffResult { left: left_result, right: right_result, stats }
}

// ==================== 编解码工具 ====================
#[derive(Serialize)]
pub struct CodecResult {
    pub success: bool,
    pub result: String,
    pub error: Option<String>,
}

#[tauri::command]
pub fn base64_encode(input: String) -> CodecResult {
    let encoded = base64::engine::general_purpose::STANDARD.encode(input.as_bytes());
    CodecResult { success: true, result: encoded, error: None }
}

#[tauri::command]
pub fn base64_decode(input: String) -> CodecResult {
    match base64::engine::general_purpose::STANDARD.decode(&input) {
        Ok(bytes) => match String::from_utf8(bytes) {
            Ok(s) => CodecResult { success: true, result: s, error: None },
            Err(e) => CodecResult { success: false, result: String::new(), error: Some(format!("UTF-8 解码失败: {}", e)) }
        },
        Err(e) => CodecResult { success: false, result: String::new(), error: Some(format!("Base64 解码失败: {}", e)) }
    }
}

#[tauri::command]
pub fn url_encode(input: String) -> CodecResult {
    CodecResult { success: true, result: urlencoding::encode(&input).to_string(), error: None }
}

#[tauri::command]
pub fn url_decode(input: String) -> CodecResult {
    match urlencoding::decode(&input) {
        Ok(s) => CodecResult { success: true, result: s.to_string(), error: None },
        Err(e) => CodecResult { success: false, result: String::new(), error: Some(format!("URL 解码失败: {}", e)) }
    }
}

#[tauri::command]
pub fn unicode_encode(input: String) -> CodecResult {
    let result: String = input.chars()
        .map(|c| {
            if c as u32 > 127 {
                format!("\\u{:04x}", c as u32)
            } else {
                c.to_string()
            }
        })
        .collect();
    CodecResult { success: true, result, error: None }
}

#[tauri::command]
pub fn unicode_decode(input: String) -> CodecResult {
    let mut result = String::new();
    let mut chars = input.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '\\' && chars.peek() == Some(&'u') {
            chars.next();
            let mut hex = String::new();
            for _ in 0..4 {
                if let Some(h) = chars.next() {
                    hex.push(h);
                }
            }
            if let Ok(code) = u32::from_str_radix(&hex, 16) {
                if let Some(ch) = char::from_u32(code) {
                    result.push(ch);
                } else {
                    result.push_str(&format!("\\u{}", hex));
                }
            } else {
                result.push_str(&format!("\\u{}", hex));
            }
        } else {
            result.push(c);
        }
    }
    CodecResult { success: true, result, error: None }
}

#[tauri::command]
pub fn html_encode(input: String) -> CodecResult {
    let result = input.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&#39;");
    CodecResult { success: true, result, error: None }
}

#[tauri::command]
pub fn html_decode(input: String) -> CodecResult {
    let result = input.replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'");
    CodecResult { success: true, result, error: None }
}

// ==================== 加解密工具 ====================
#[derive(Serialize)]
pub struct CryptoResult {
    pub success: bool,
    pub result: String,
    pub error: Option<String>,
}

#[tauri::command]
pub fn md5_hash(input: String) -> CryptoResult {
    let mut hasher = md5::Md5::new();
    md5::Digest::update(&mut hasher, input.as_bytes());
    let result = hex::encode(md5::Digest::finalize(hasher));
    CryptoResult { success: true, result, error: None }
}

#[tauri::command]
pub fn sha1_hash(input: String) -> CryptoResult {
    let mut hasher = sha1::Sha1::new();
    sha1::Digest::update(&mut hasher, input.as_bytes());
    let result = hex::encode(sha1::Digest::finalize(hasher));
    CryptoResult { success: true, result, error: None }
}

#[tauri::command]
pub fn sha256_hash(input: String) -> CryptoResult {
    let mut hasher = sha2::Sha256::new();
    sha2::Digest::update(&mut hasher, input.as_bytes());
    let result = hex::encode(sha2::Digest::finalize(hasher));
    CryptoResult { success: true, result, error: None }
}

#[tauri::command]
pub fn sha512_hash(input: String) -> CryptoResult {
    let mut hasher = sha2::Sha512::new();
    sha2::Digest::update(&mut hasher, input.as_bytes());
    let result = hex::encode(sha2::Digest::finalize(hasher));
    CryptoResult { success: true, result, error: None }
}

#[tauri::command]
pub fn hmac_sha256(key: String, input: String) -> CryptoResult {
    use hmac::{Hmac, Mac};
    use sha2::Sha256;
    type HmacSha256 = Hmac<Sha256>;
    match HmacSha256::new_from_slice(key.as_bytes()) {
        Ok(mut mac) => {
            mac.update(input.as_bytes());
            let result = hex::encode(mac.finalize().into_bytes());
            CryptoResult { success: true, result, error: None }
        }
        Err(e) => CryptoResult { success: false, result: String::new(), error: Some(e.to_string()) }
    }
}

#[tauri::command]
pub fn aes_encrypt(key: String, input: String) -> CryptoResult {
    use aes_gcm::{Aes256Gcm, KeyInit, Nonce};
    use aes_gcm::aead::Aead;

    let key_hash = sha2::Sha256::digest(key.as_bytes());
    let key = aes_gcm::Key::<Aes256Gcm>::from_slice(&key_hash);
    let cipher = Aes256Gcm::new(key);
    let nonce = Nonce::from_slice(&key_hash[..12]);

    match cipher.encrypt(nonce, input.as_bytes()) {
        Ok(ciphertext) => {
            let result = base64::engine::general_purpose::STANDARD.encode(&ciphertext);
            CryptoResult { success: true, result, error: None }
        }
        Err(e) => CryptoResult { success: false, result: String::new(), error: Some(format!("加密失败: {}", e)) }
    }
}

#[tauri::command]
pub fn aes_decrypt(key: String, input: String) -> CryptoResult {
    use aes_gcm::{Aes256Gcm, KeyInit, Nonce};
    use aes_gcm::aead::Aead;

    let key_hash = sha2::Sha256::digest(key.as_bytes());
    let key = aes_gcm::Key::<Aes256Gcm>::from_slice(&key_hash);
    let cipher = Aes256Gcm::new(key);
    let nonce = Nonce::from_slice(&key_hash[..12]);

    match base64::engine::general_purpose::STANDARD.decode(&input) {
        Ok(ciphertext) => {
            match cipher.decrypt(nonce, ciphertext.as_slice()) {
                Ok(plaintext) => match String::from_utf8(plaintext) {
                    Ok(s) => CryptoResult { success: true, result: s, error: None },
                    Err(e) => CryptoResult { success: false, result: String::new(), error: Some(format!("UTF-8解码失败: {}", e)) }
                },
                Err(e) => CryptoResult { success: false, result: String::new(), error: Some(format!("解密失败: {}", e)) }
            }
        }
        Err(e) => CryptoResult { success: false, result: String::new(), error: Some(format!("Base64解码失败: {}", e)) }
    }
}

// ==================== 进制转换 ====================
#[derive(Serialize)]
pub struct BaseConvertResult {
    pub binary: String,
    pub octal: String,
    pub decimal: String,
    pub hexadecimal: String,
}

#[tauri::command]
pub fn base_convert(input: String, from_base: u32) -> Result<BaseConvertResult, String> {
    let num = i64::from_str_radix(input.trim(), from_base)
        .map_err(|e| format!("转换失败: {}", e))?;
    Ok(BaseConvertResult {
        binary: format!("{:b}", num),
        octal: format!("{:o}", num),
        decimal: num.to_string(),
        hexadecimal: format!("{:X}", num),
    })
}

// ==================== 正则测试 ====================
#[derive(Serialize)]
pub struct RegexMatch {
    pub match_text: String,
    pub start: usize,
    pub end: usize,
    pub groups: Vec<String>,
}

#[tauri::command]
pub fn regex_test(pattern: String, input: String, flags: String) -> Result<Vec<RegexMatch>, String> {
    let re = if flags.contains('i') {
        regex::RegexBuilder::new(&pattern).case_insensitive(true).build()
    } else {
        regex::Regex::new(&pattern)
    }.map_err(|e| format!("正则表达式错误: {}", e))?;

    let matches: Vec<RegexMatch> = re.captures_iter(&input).map(|cap| {
        let m = cap.get(0).unwrap();
        let groups: Vec<String> = cap.iter().skip(1)
            .map(|g| g.map(|gm| gm.as_str().to_string()).unwrap_or_default())
            .collect();
        RegexMatch {
            match_text: m.as_str().to_string(),
            start: m.start(),
            end: m.end(),
            groups,
        }
    }).collect();

    Ok(matches)
}

// ==================== JWT 解码 ====================
#[derive(Serialize)]
pub struct JwtDecodeResult {
    pub header: String,
    pub payload: String,
    pub signature: String,
    pub is_expired: Option<bool>,
    pub error: Option<String>,
}

#[tauri::command]
pub fn jwt_decode(token: String) -> JwtDecodeResult {
    let parts: Vec<&str> = token.trim().split('.').collect();
    if parts.len() != 3 {
        return JwtDecodeResult {
            header: String::new(),
            payload: String::new(),
            signature: String::new(),
            is_expired: None,
            error: Some("无效的 JWT 格式（需要3段用.分隔）".to_string()),
        };
    }

    let decode_part = |part: &str| -> String {
        let padded = {
            let mut p = part.to_string();
            while p.len() % 4 != 0 { p.push('='); }
            p
        };
        match base64::engine::general_purpose::STANDARD.decode(&padded) {
            Ok(bytes) => match String::from_utf8(bytes) {
                Ok(s) => match serde_json::from_str::<serde_json::Value>(&s) {
                    Ok(val) => serde_json::to_string_pretty(&val).unwrap_or(s),
                    Err(_) => s,
                },
                Err(_) => "(非UTF-8内容)".to_string(),
            },
            Err(_) => "(Base64解码失败)".to_string(),
        }
    };

    let header = decode_part(parts[0]);
    let payload = decode_part(parts[1]);

    let is_expired = if let Ok(val) = serde_json::from_str::<serde_json::Value>(&payload) {
        if let Some(exp) = val.get("exp").and_then(|v| v.as_i64()) {
            let now = chrono::Utc::now().timestamp();
            Some(now > exp)
        } else {
            None
        }
    } else {
        None
    };

    JwtDecodeResult {
        header,
        payload,
        signature: parts[2].to_string(),
        is_expired,
        error: None,
    }
}

// ==================== URL 解析 ====================
#[derive(Serialize)]
pub struct UrlParseResult {
    pub protocol: String,
    pub host: String,
    pub port: Option<u16>,
    pub path: String,
    pub query: String,
    pub fragment: String,
    pub params: std::collections::HashMap<String, String>,
    pub error: Option<String>,
}

#[tauri::command]
pub fn url_parse(input: String) -> UrlParseResult {
    match url::Url::parse(&input) {
        Ok(parsed) => {
            let mut params = std::collections::HashMap::new();
            for (k, v) in parsed.query_pairs() {
                params.insert(k.to_string(), v.to_string());
            }
            UrlParseResult {
                protocol: parsed.scheme().to_string(),
                host: parsed.host_str().unwrap_or("").to_string(),
                port: parsed.port(),
                path: parsed.path().to_string(),
                query: parsed.query().unwrap_or("").to_string(),
                fragment: parsed.fragment().unwrap_or("").to_string(),
                params,
                error: None,
            }
        }
        Err(e) => UrlParseResult {
            protocol: String::new(),
            host: String::new(),
            port: None,
            path: String::new(),
            query: String::new(),
            fragment: String::new(),
            params: std::collections::HashMap::new(),
            error: Some(e.to_string()),
        }
    }
}

// ==================== 颜色转换 ====================
#[derive(Serialize)]
pub struct ColorConvertResult {
    pub hex: String,
    pub rgb: String,
    pub hsl: String,
    pub error: Option<String>,
}

#[tauri::command]
pub fn color_convert(input: String, from: String) -> ColorConvertResult {
    let input = input.trim().to_string();

    let (r, g, b) = if from == "hex" {
        let hex = input.trim_start_matches('#');
        match hex.len() {
            3 => {
                let r = u8::from_str_radix(&hex[0..1].repeat(2), 16);
                let g = u8::from_str_radix(&hex[1..2].repeat(2), 16);
                let b = u8::from_str_radix(&hex[2..3].repeat(2), 16);
                match (r, g, b) {
                    (Ok(r), Ok(g), Ok(b)) => (r, g, b),
                    _ => return ColorConvertResult { hex: String::new(), rgb: String::new(), hsl: String::new(), error: Some("无效的HEX颜色".to_string()) }
                }
            }
            6 => {
                let r = u8::from_str_radix(&hex[0..2], 16);
                let g = u8::from_str_radix(&hex[2..4], 16);
                let b = u8::from_str_radix(&hex[4..6], 16);
                match (r, g, b) {
                    (Ok(r), Ok(g), Ok(b)) => (r, g, b),
                    _ => return ColorConvertResult { hex: String::new(), rgb: String::new(), hsl: String::new(), error: Some("无效的HEX颜色".to_string()) }
                }
            }
            _ => return ColorConvertResult { hex: String::new(), rgb: String::new(), hsl: String::new(), error: Some("无效的HEX颜色格式".to_string()) }
        }
    } else if from == "rgb" {
        let re = regex::Regex::new(r"(\d+)\s*,\s*(\d+)\s*,\s*(\d+)").unwrap();
        match re.captures(&input) {
            Some(cap) => {
                let r = cap[1].parse::<u8>().ok();
                let g = cap[2].parse::<u8>().ok();
                let b = cap[3].parse::<u8>().ok();
                match (r, g, b) {
                    (Some(r), Some(g), Some(b)) => (r, g, b),
                    _ => return ColorConvertResult { hex: String::new(), rgb: String::new(), hsl: String::new(), error: Some("无效的RGB颜色值".to_string()) }
                }
            }
            None => return ColorConvertResult { hex: String::new(), rgb: String::new(), hsl: String::new(), error: Some("无效的RGB格式，使用: r,g,b".to_string()) }
        }
    } else {
        return ColorConvertResult { hex: String::new(), rgb: String::new(), hsl: String::new(), error: Some("不支持的颜色格式".to_string()) }
    };

    let rf = r as f64 / 255.0;
    let gf = g as f64 / 255.0;
    let bf = b as f64 / 255.0;
    let max = rf.max(gf).max(bf);
    let min = rf.min(gf).min(bf);
    let l = (max + min) / 2.0;
    let (h, s) = if max == min {
        (0.0, 0.0)
    } else {
        let d = max - min;
        let s = if l > 0.5 { d / (2.0 - max - min) } else { d / (max + min) };
        let h = if max == rf {
            (gf - bf) / d + if gf < bf { 6.0 } else { 0.0 }
        } else if max == gf {
            (bf - rf) / d + 2.0
        } else {
            (rf - gf) / d + 4.0
        };
        (h * 60.0, s)
    };

    ColorConvertResult {
        hex: format!("#{:02X}{:02X}{:02X}", r, g, b),
        rgb: format!("rgb({}, {}, {})", r, g, b),
        hsl: format!("hsl({:.0}, {:.0}%, {:.0}%)", h, s * 100.0, l * 100.0),
        error: None,
    }
}

// ==================== 文本统计 ====================
#[derive(Serialize)]
pub struct TextStatsResult {
    pub chars: usize,
    pub chars_no_space: usize,
    pub words: usize,
    pub lines: usize,
    pub bytes: usize,
}

#[tauri::command]
pub fn text_stats(input: String) -> TextStatsResult {
    TextStatsResult {
        chars: input.chars().count(),
        chars_no_space: input.chars().filter(|c| !c.is_whitespace()).count(),
        words: input.split_whitespace().count(),
        lines: input.lines().count(),
        bytes: input.len(),
    }
}

// ==================== UUID 生成器 ====================
#[derive(Serialize)]
pub struct UuidResult {
    pub uuid: String,
    pub uppercase: String,
    pub no_dash: String,
    pub braced: String,
}

#[tauri::command]
pub fn uuid_generate() -> UuidResult {
    let id = uuid::Uuid::new_v4();
    UuidResult {
        uuid: id.to_string(),
        uppercase: id.to_string().to_uppercase(),
        no_dash: id.to_string().replace('-', ""),
        braced: format!("{{{}}}", id),
    }
}

// ==================== 密码生成器 ====================
#[derive(Serialize)]
pub struct PasswordResult {
    pub password: String,
    pub length: usize,
    pub entropy: f64,
}

#[tauri::command]
pub fn password_generate(length: usize, uppercase: bool, lowercase: bool, numbers: bool, symbols: bool) -> Result<PasswordResult, String> {
    use rand::Rng;
    let mut charset = String::new();
    let upper = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    let lower = "abcdefghijklmnopqrstuvwxyz";
    let nums = "0123456789";
    let syms = "!@#$%^&*()_+-=[]{}|;:,.<>?";
    
    if uppercase { charset.push_str(upper); }
    if lowercase { charset.push_str(lower); }
    if numbers { charset.push_str(nums); }
    if symbols { charset.push_str(syms); }
    
    if charset.is_empty() {
        charset = format!("{}{}{}{}", upper, lower, nums, syms);
    }
    
    let len = if length < 4 { 4 } else if length > 128 { 128 } else { length };
    let chars: Vec<char> = charset.chars().collect();
    let mut rng = rand::thread_rng();
    let password: String = (0..len).map(|_| chars[rng.gen_range(0..chars.len())]).collect();
    
    let pool_size = charset.len() as f64;
    let entropy = (len as f64) * pool_size.log2();
    
    Ok(PasswordResult { password, length: len, entropy: (entropy * 100.0).round() / 100.0 })
}

// ==================== YAML ↔ JSON 互转 ====================
#[tauri::command]
pub fn yaml_to_json(input: String) -> JsonResult {
    match serde_yaml::from_str::<serde_yaml::Value>(&input) {
        Ok(yaml_val) => {
            let json_str = serde_json::to_string(&yaml_val).unwrap_or_default();
            match serde_json::from_str::<serde_json::Value>(&json_str) {
                Ok(val) => {
                    let result = serde_json::to_string_pretty(&val).unwrap_or_default();
                    JsonResult { success: true, result, error: None }
                }
                Err(e) => JsonResult { success: false, result: input, error: Some(format!("JSON转换失败: {}", e)) }
            }
        }
        Err(e) => JsonResult { success: false, result: input, error: Some(format!("YAML解析失败: {}", e)) }
    }
}

#[tauri::command]
pub fn json_to_yaml(input: String) -> JsonResult {
    match serde_json::from_str::<serde_json::Value>(&input) {
        Ok(json_val) => {
            let yaml_str = serde_yaml::to_string(&json_val).unwrap_or_default();
            JsonResult { success: true, result: yaml_str, error: None }
        }
        Err(e) => JsonResult { success: false, result: input, error: Some(format!("JSON解析失败: {}", e)) }
    }
}

// ==================== XML 格式化/压缩 ====================
#[tauri::command]
pub fn xml_format(input: String) -> JsonResult {
    let trimmed = input.trim();
    let re = regex::Regex::new(r">\s+<").unwrap();
    let compacted = re.replace_all(trimmed, ">\n<");
    let compacted = regex::Regex::new(r"\n\s+").unwrap().replace_all(&compacted, "\n");
    
    let mut result = String::new();
    let mut depth = 0usize;
    
    for line in compacted.lines() {
        let line = line.trim();
        if line.is_empty() { continue; }
        
        if line.starts_with("</") {
            depth = depth.saturating_sub(1);
            result.push_str(&format!("{}{}\n", "  ".repeat(depth), line));
        } else if line.starts_with("<?") || line.starts_with("<!--") {
            result.push_str(&format!("{}{}\n", "  ".repeat(depth), line));
        } else if line.ends_with("/>") {
            result.push_str(&format!("{}{}\n", "  ".repeat(depth), line));
        } else if line.starts_with("<") {
            result.push_str(&format!("{}{}\n", "  ".repeat(depth), line));
            depth += 1;
        } else {
            result.push_str(&format!("{}{}\n", "  ".repeat(depth), line));
        }
    }
    
    JsonResult { success: true, result: result.trim().to_string(), error: None }
}

#[tauri::command]
pub fn xml_minify(input: String) -> JsonResult {
    let re = regex::Regex::new(r">\s+<").unwrap();
    let result = re.replace_all(&input.trim(), "><").to_string();
    let result = regex::Regex::new(r"\n\s*").unwrap().replace_all(&result, "").to_string();
    JsonResult { success: true, result, error: None }
}

// ==================== 文本大小写/命名转换 ====================
#[derive(Serialize)]
pub struct CaseConvertResult {
    pub camel_case: String,
    pub pascal_case: String,
    pub snake_case: String,
    pub kebab_case: String,
    pub constant_case: String,
    pub dot_case: String,
    pub title_case: String,
    pub upper_case: String,
    pub lower_case: String,
}

#[tauri::command]
pub fn text_case_convert(input: String) -> CaseConvertResult {
    let input = input.trim();
    let words: Vec<String> = {
        let s = input.replace('_', " ").replace('-', " ");
        let mut result = String::new();
        let mut chars = s.chars().peekable();
        while let Some(c) = chars.next() {
            if c.is_uppercase() && !result.is_empty() {
                let last = result.chars().last().unwrap_or(' ');
                if last.is_lowercase() || last.is_numeric() {
                    result.push(' ');
                }
            }
            result.push(c);
        }
        result.split_whitespace()
            .map(|w| w.to_lowercase())
            .collect()
    };

    if words.is_empty() {
        return CaseConvertResult {
            camel_case: String::new(),
            pascal_case: String::new(),
            snake_case: String::new(),
            kebab_case: String::new(),
            constant_case: String::new(),
            dot_case: String::new(),
            title_case: String::new(),
            upper_case: input.to_uppercase(),
            lower_case: input.to_lowercase(),
        };
    }

    let capitalize = |s: &str| -> String {
        let mut c = s.chars();
        match c.next() {
            None => String::new(),
            Some(f) => f.to_uppercase().collect::<String>() + c.as_str().to_lowercase().as_str(),
        }
    };

    CaseConvertResult {
        camel_case: words.iter().enumerate().map(|(i, w)| if i == 0 { w.clone() } else { capitalize(w) }).collect(),
        pascal_case: words.iter().map(|w| capitalize(w)).collect(),
        snake_case: words.join("_"),
        kebab_case: words.join("-"),
        constant_case: words.iter().map(|w| w.to_uppercase()).collect::<Vec<_>>().join("_"),
        dot_case: words.join("."),
        title_case: words.iter().map(|w| capitalize(w)).collect::<Vec<_>>().join(" "),
        upper_case: input.to_uppercase(),
        lower_case: input.to_lowercase(),
    }
}

// ==================== CSS 单位转换 ====================
#[derive(Serialize)]
pub struct CssUnitResult {
    pub px: String,
    pub rem: String,
    pub em: String,
    pub pt: String,
    pub vw: String,
    pub vh: String,
    pub error: Option<String>,
}

#[tauri::command]
pub fn css_unit_convert(value: f64, unit: String, base_size: f64, viewport_width: f64, viewport_height: f64) -> CssUnitResult {
    let px = match unit.as_str() {
        "px" => value,
        "rem" => value * base_size,
        "em" => value * base_size,
        "pt" => value * (4.0 / 3.0),
        "vw" => value * viewport_width / 100.0,
        "vh" => value * viewport_height / 100.0,
        _ => return CssUnitResult {
            px: String::new(), rem: String::new(), em: String::new(),
            pt: String::new(), vw: String::new(), vh: String::new(),
            error: Some(format!("不支持的单位: {}", unit)),
        },
    };

    let fmt = |v: f64| -> String {
        if (v - v.round()).abs() < 1e-10 { format!("{:.0}", v) } else { format!("{:.4}", v).trim_end_matches('0').trim_end_matches('.').to_string() }
    };

    CssUnitResult {
        px: fmt(px),
        rem: fmt(px / base_size),
        em: fmt(px / base_size),
        pt: fmt(px * 0.75),
        vw: fmt(px / viewport_width * 100.0),
        vh: fmt(px / viewport_height * 100.0),
        error: None,
    }
}

// ==================== Cron 表达式解析 ====================
#[derive(Serialize)]
pub struct CronParseResult {
    pub description: String,
    pub next_times: Vec<String>,
    pub error: Option<String>,
}

#[tauri::command]
pub fn cron_parse(expression: String) -> CronParseResult {
    let parts: Vec<&str> = expression.trim().split_whitespace().collect();
    
    let (minute, hour, dom, month, dow) = if parts.len() == 5 {
        (parts[0], parts[1], parts[2], parts[3], parts[4])
    } else if parts.len() == 6 {
        (parts[1], parts[2], parts[3], parts[4], parts[5])
    } else {
        return CronParseResult {
            description: String::new(),
            next_times: Vec::new(),
            error: Some("Cron 表达式需要 5 或 6 个字段".to_string()),
        };
    };

    let describe_field = |field: &str, name: &str| -> String {
        if field == "*" { format!("每{}", name) }
        else if field.starts_with("*/") { format!("每{}{}", &field[2..], name) }
        else if field.contains(',') { format!("{}的{}", field, name) }
        else { format!("{}{}", field, name) }
    };

    let minute_desc = describe_field(minute, "分钟");
    let hour_desc = describe_field(hour, "小时");
    let month_desc = if month == "*" { String::new() } else { describe_field(month, "月") };
    let dow_desc = match dow {
        "*" => String::new(),
        "0" | "7" => "周日".to_string(),
        "1" => "周一".to_string(),
        "2" => "周二".to_string(),
        "3" => "周三".to_string(),
        "4" => "周四".to_string(),
        "5" => "周五".to_string(),
        "6" => "周六".to_string(),
        _ => describe_field(dow, "星期"),
    };
    let dom_desc = if dom == "*" { String::new() } else { describe_field(dom, "日") };

    let mut desc_parts = vec![month_desc, dow_desc, dom_desc, hour_desc, minute_desc];
    desc_parts.retain(|s| !s.is_empty());
    let description = desc_parts.join("，");

    let next_times = generate_cron_next_times(minute, hour, dom, month, dow, 5);

    CronParseResult {
        description,
        next_times,
        error: None,
    }
}

fn generate_cron_next_times(minute: &str, hour: &str, _dom: &str, _month: &str, _dow: &str, count: usize) -> Vec<String> {
    let mut times = Vec::new();
    let parse_values = |field: &str, max: i32| -> Vec<i32> {
        if field == "*" { return (0..max).collect(); }
        let mut vals = Vec::new();
        for part in field.split(',') {
            if part.starts_with("*/") {
                let step: i32 = part[2..].parse().unwrap_or(1);
                if step > 0 { vals.extend((0..max).step_by(step as usize)); }
            } else if part.contains('-') {
                let bounds: Vec<&str> = part.split('-').collect();
                if bounds.len() == 2 {
                    if let (Ok(s), Ok(e)) = (bounds[0].parse::<i32>(), bounds[1].parse::<i32>()) {
                        vals.extend(s..=e);
                    }
                }
            } else if let Ok(v) = part.parse::<i32>() {
                vals.push(v);
            }
        }
        vals.sort();
        vals.dedup();
        vals
    };

    let minutes = parse_values(minute, 60);
    let hours = parse_values(hour, 24);

    if minutes.is_empty() || hours.is_empty() {
        return times;
    }

    let now = chrono::Local::now();
    let mut current = now.with_second(0).unwrap_or(now).with_nanosecond(0).unwrap_or(now);
    current = current + chrono::Duration::minutes(1);

    while times.len() < count {
        let m = current.minute() as i32;
        let h = current.hour() as i32;

        if hours.contains(&h) && minutes.contains(&m) {
            times.push(current.format("%Y-%m-%d %H:%M").to_string());
        }

        current = current + chrono::Duration::minutes(1);

        if current.signed_duration_since(now).num_days() > 366 {
            break;
        }
    }

    times
}

// ==================== 文本去重/排序 ====================
#[derive(Serialize)]
pub struct TextProcessResult {
    pub result: String,
    pub original_lines: usize,
    pub result_lines: usize,
    pub removed: usize,
}

#[tauri::command]
pub fn text_deduplicate(input: String) -> TextProcessResult {
    let lines: Vec<&str> = input.lines().collect();
    let original = lines.len();
    let mut seen = std::collections::HashSet::new();
    let mut result: Vec<&str> = Vec::new();
    for line in &lines {
        let trimmed = line.trim();
        if seen.insert(trimmed) {
            result.push(line);
        }
    }
    TextProcessResult {
        result: result.join("\n"),
        original_lines: original,
        result_lines: result.len(),
        removed: original - result.len(),
    }
}

#[tauri::command]
pub fn text_sort(input: String, reverse: bool) -> TextProcessResult {
    let mut lines: Vec<&str> = input.lines().collect();
    let original = lines.len();
    if reverse {
        lines.sort_by(|a, b| b.cmp(a));
    } else {
        lines.sort();
    }
    TextProcessResult {
        result: lines.join("\n"),
        original_lines: original,
        result_lines: lines.len(),
        removed: 0,
    }
}

#[tauri::command]
pub fn text_trim_lines(input: String) -> TextProcessResult {
    let lines: Vec<&str> = input.lines().collect();
    let original = lines.len();
    let result: Vec<String> = lines.iter().map(|l| l.trim().to_string()).collect();
    let trimmed: Vec<&str> = result.iter().filter(|l| !l.is_empty()).map(|s| s.as_str()).collect();
    TextProcessResult {
        result: trimmed.join("\n"),
        original_lines: original,
        result_lines: trimmed.len(),
        removed: original - trimmed.len(),
    }
}

// ==================== Lorem Ipsum 生成器 ====================
#[derive(Serialize)]
pub struct LoremResult {
    pub text: String,
}

#[tauri::command]
pub fn lorem_generate(paragraphs: usize, r#type: String) -> LoremResult {
    let words = [
        "lorem", "ipsum", "dolor", "sit", "amet", "consectetur", "adipiscing", "elit",
        "sed", "do", "eiusmod", "tempor", "incididunt", "ut", "labore", "et",
        "dolore", "magna", "aliqua", "enim", "ad", "minim", "veniam", "quis",
        "nostrud", "exercitation", "ullamco", "laboris", "nisi", "aliquip", "ex",
        "ea", "commodo", "consequat", "duis", "aute", "irure", "in", "reprehenderit",
        "voluptate", "velit", "esse", "cillum", "fugiat", "nulla", "pariatur",
        "excepteur", "sint", "occaecat", "cupidatat", "non", "proident", "sunt",
        "culpa", "qui", "officia", "deserunt", "mollit", "anim", "id", "est",
        "laborum",
    ];

    let chinese_words = [
        "在这个", "美好的", "世界里", "我们一起", "探索", "未知的", "领域", "发现",
        "更多的", "可能", "创造", "无限的", "价值", "让技术", "改变", "生活",
        "从现在", "开始", "追求", "卓越", "不断", "进步", "永不", "停歇",
        "共同", "成长", "照亮", "前路", "勇敢地", "面对", "挑战", "拥抱",
        "变化", "每一次", "尝试", "都是", "新的", "起点", "未来", "可期",
    ];

    let is_chinese = r#type == "chinese";
    let word_list = if is_chinese { &chinese_words[..] } else { &words[..] };

    let mut rng = rand::thread_rng();
    use rand::Rng;
    let mut paragraphs_text = Vec::new();

    for _ in 0..paragraphs.max(1).min(20) {
        let sentence_count = rng.gen_range(4..8);
        let mut paragraph = String::new();

        for s in 0..sentence_count {
            let word_count = rng.gen_range(6..15);
            let sentence_words: Vec<&str> = (0..word_count)
                .map(|_| word_list[rng.gen_range(0..word_list.len())])
                .collect();
            
            if is_chinese {
                paragraph.push_str(&sentence_words.join(""));
                paragraph.push('。');
            } else {
                paragraph.push_str(&sentence_words.join(" "));
                paragraph.push('.');
                if s < sentence_count - 1 { paragraph.push(' '); }
            }
        }

        if !is_chinese {
            if let Some(c) = paragraph.chars().next() {
                paragraph = c.to_uppercase().collect::<String>() + &paragraph[1..];
            }
        }
        paragraphs_text.push(paragraph.trim().to_string());
    }

    LoremResult {
        text: paragraphs_text.join("\n\n"),
    }
}

// ==================== MIME 类型查询 ====================
#[derive(Serialize)]
pub struct MimeResult {
    pub mime_type: String,
    pub extensions: Vec<String>,
    pub error: Option<String>,
}

static MIME_MAP: &[(&str, &[&str])] = &[
    ("text/html", &["html", "htm"]),
    ("text/css", &["css"]),
    ("text/javascript", &["js", "mjs"]),
    ("text/plain", &["txt"]),
    ("text/csv", &["csv"]),
    ("text/xml", &["xml"]),
    ("text/markdown", &["md", "markdown"]),
    ("application/json", &["json"]),
    ("application/xml", &["xml"]),
    ("application/pdf", &["pdf"]),
    ("application/zip", &["zip"]),
    ("application/gzip", &["gz", "gzip"]),
    ("application/x-tar", &["tar"]),
    ("application/x-7z-compressed", &["7z"]),
    ("application/x-rar-compressed", &["rar"]),
    ("application/octet-stream", &["bin"]),
    ("application/wasm", &["wasm"]),
    ("application/x-yaml", &["yaml", "yml"]),
    ("image/jpeg", &["jpg", "jpeg"]),
    ("image/png", &["png"]),
    ("image/gif", &["gif"]),
    ("image/svg+xml", &["svg"]),
    ("image/webp", &["webp"]),
    ("image/x-icon", &["ico"]),
    ("image/bmp", &["bmp"]),
    ("audio/mpeg", &["mp3"]),
    ("audio/ogg", &["ogg"]),
    ("audio/wav", &["wav"]),
    ("audio/flac", &["flac"]),
    ("video/mp4", &["mp4"]),
    ("video/webm", &["webm"]),
    ("video/x-msvideo", &["avi"]),
    ("video/quicktime", &["mov"]),
    ("font/woff", &["woff"]),
    ("font/woff2", &["woff2"]),
    ("font/ttf", &["ttf"]),
    ("font/otf", &["otf"]),
];

#[tauri::command]
pub fn mime_lookup(input: String) -> Vec<MimeResult> {
    let input = input.trim().to_lowercase();
    let mut results = Vec::new();

    if input.contains('/') {
        for (mime, exts) in MIME_MAP {
            if mime.starts_with(&input) || mime.contains(&input) {
                results.push(MimeResult {
                    mime_type: mime.to_string(),
                    extensions: exts.iter().map(|e| e.to_string()).collect(),
                    error: None,
                });
            }
        }
    } else {
        for (mime, exts) in MIME_MAP {
            if exts.iter().any(|e| e.starts_with(&input) || *e == input) {
                results.push(MimeResult {
                    mime_type: mime.to_string(),
                    extensions: exts.iter().map(|e| e.to_string()).collect(),
                    error: None,
                });
            }
        }
    }

    if results.is_empty() {
        results.push(MimeResult {
            mime_type: String::new(),
            extensions: Vec::new(),
            error: Some("未找到匹配的 MIME 类型".to_string()),
        });
    }

    results
}

// ==================== 数字格式化 ====================
#[derive(Serialize)]
pub struct NumberFormatResult {
    pub decimal: String,
    pub binary: String,
    pub octal: String,
    pub hex: String,
    pub scientific: String,
    pub grouped: String,
    pub chinese: String,
    pub error: Option<String>,
}

#[tauri::command]
pub fn number_format(input: String) -> NumberFormatResult {
    let input = input.trim();
    let num: f64 = match input.parse() {
        Ok(n) => n,
        Err(_) => return NumberFormatResult {
            decimal: String::new(),
            binary: String::new(),
            octal: String::new(),
            hex: String::new(),
            scientific: String::new(),
            grouped: String::new(),
            chinese: String::new(),
            error: Some("无效的数字".to_string()),
        },
    };

    let int_part = num.trunc() as i64;
    let digits = ["零", "一", "二", "三", "四", "五", "六", "七", "八", "九"];
    let units = ["", "十", "百", "千"];
    let big_units = ["", "万", "亿", "兆"];

    let mut chinese = String::new();
    if int_part == 0 {
        chinese = "零".to_string();
    } else {
        let mut n = int_part.abs();
        let mut groups: Vec<String> = Vec::new();
        
        while n > 0 {
            let group = n % 10000;
            n /= 10000;
            
            if group == 0 {
                groups.push(String::new());
                continue;
            }

            let mut group_str = String::new();
            let g = group as usize;
            let thousands = g / 1000;
            let hundreds = (g % 1000) / 100;
            let tens = (g % 100) / 10;
            let ones = g % 10;

            if thousands > 0 { group_str.push_str(digits[thousands]); group_str.push_str(units[3]); }
            if hundreds > 0 { group_str.push_str(digits[hundreds]); group_str.push_str(units[2]); }
            else if thousands > 0 && (tens > 0 || ones > 0) { group_str.push_str("零"); }
            if tens > 0 { group_str.push_str(digits[tens]); group_str.push_str(units[1]); }
            else if hundreds > 0 && ones > 0 { group_str.push_str("零"); }
            if ones > 0 { group_str.push_str(digits[ones]); }

            groups.push(group_str);
        }

        if int_part < 0 { chinese.push('负'); }
        for (i, g) in groups.iter().rev().enumerate() {
            if !g.is_empty() {
                chinese.push_str(g);
                let big_idx = groups.len() - 1 - i;
                if big_idx > 0 && big_idx < big_units.len() { chinese.push_str(big_units[big_idx]); }
            }
        }
    }

    let grouped_str = {
        let s = int_part.abs().to_string();
        let chars: Vec<char> = s.chars().collect();
        let mut result = String::new();
        for (i, c) in chars.iter().rev().enumerate() {
            if i > 0 && i % 3 == 0 { result.insert(0, ','); }
            result.insert(0, *c);
        }
        result
    };

    NumberFormatResult {
        decimal: num.to_string(),
        binary: format!("{:b}", int_part),
        octal: format!("{:o}", int_part),
        hex: format!("{:X}", int_part),
        scientific: format!("{:.6e}", num),
        grouped: grouped_str,
        chinese,
        error: None,
    }
}
