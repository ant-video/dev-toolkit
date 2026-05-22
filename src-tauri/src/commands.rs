use serde::{Deserialize, Serialize};
use base64::Engine;
use digest::Digest;
use chrono::{TimeZone, Timelike};
use image::GenericImageView;
use tauri::Manager;

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
    } else {
        return CronParseResult {
            description: String::new(),
            next_times: Vec::new(),
            error: Some("Cron 表达式需要 5 个字段（分 时 日 月 周）".to_string()),
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
    let description = if desc_parts.is_empty() { "每分钟".to_string() } else { desc_parts.join("，") };

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

// ==================== 图片 Base64 互转 ====================
#[derive(Serialize)]
pub struct ImageToBase64Result {
    pub success: bool,
    pub base64: String,
    pub mime_type: String,
    pub size_bytes: u64,
    pub error: Option<String>,
}

#[tauri::command]
pub fn image_to_base64(path: String) -> ImageToBase64Result {
    use std::path::Path;

    let path = Path::new(&path);
    if !path.exists() {
        return ImageToBase64Result {
            success: false,
            base64: String::new(),
            mime_type: String::new(),
            size_bytes: 0,
            error: Some("文件不存在".to_string()),
        };
    }

    let ext = path.extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();

    let mime_type = match ext.as_str() {
        "jpg" | "jpeg" => "image/jpeg",
        "png" => "image/png",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "svg" => "image/svg+xml",
        "bmp" => "image/bmp",
        "ico" => "image/x-icon",
        "avif" => "image/avif",
        _ => "application/octet-stream",
    };

    match std::fs::read(path) {
        Ok(bytes) => {
            let b64 = base64::prelude::BASE64_STANDARD.encode(&bytes);
            ImageToBase64Result {
                success: true,
                base64: b64,
                mime_type: mime_type.to_string(),
                size_bytes: bytes.len() as u64,
                error: None,
            }
        }
        Err(e) => ImageToBase64Result {
            success: false,
            base64: String::new(),
            mime_type: String::new(),
            size_bytes: 0,
            error: Some(format!("读取文件失败: {}", e)),
        },
    }
}

#[derive(Serialize)]
pub struct Base64ToImageResult {
    pub success: bool,
    pub data_url: String,
    pub mime_type: String,
    pub size_bytes: u64,
    pub error: Option<String>,
}

#[tauri::command]
pub fn base64_to_image(base64_str: String) -> Base64ToImageResult {
    // 剥离 data URL 前缀（如 data:image/png;base64,）
    let pure_base64 = if base64_str.contains(',') && base64_str.starts_with("data:") {
        base64_str.split(',').nth(1).unwrap_or(&base64_str).trim()
    } else {
        base64_str.trim()
    };

    let decoded = match base64::prelude::BASE64_STANDARD.decode(pure_base64) {
        Ok(data) => data,
        Err(e) => return Base64ToImageResult {
            success: false,
            data_url: String::new(),
            mime_type: String::new(),
            size_bytes: 0,
            error: Some(format!("Base64 解码失败: {}", e)),
        },
    };

    // 尝试检测 MIME 类型（通过文件头签名）
    let mime_type = detect_mime(&decoded);
    let data_url = format!("data:{};base64,{}", mime_type, pure_base64);

    Base64ToImageResult {
        success: true,
        data_url,
        mime_type,
        size_bytes: decoded.len() as u64,
        error: None,
    }
}

fn detect_mime(data: &[u8]) -> String {
    if data.len() >= 2 {
        // PNG: 89 50 4E 47
        if data[0] == 0x89 && data[1] == 0x50 {
            return "image/png".to_string();
        }
        // JPEG: FF D8 FF
        if data[0] == 0xFF && data[1] == 0xD8 {
            return "image/jpeg".to_string();
        }
    }
    if data.len() >= 4 {
        // GIF: 47 49 46
        if data[0] == 0x47 && data[1] == 0x49 && data[2] == 0x46 {
            return "image/gif".to_string();
        }
        // WebP: 52 49 46 46 ... 57 45 42 50
        if data[0] == 0x52 && data[1] == 0x49 && data[2] == 0x46 && data[3] == 0x46 {
            if data.len() >= 12 && data[8] == 0x57 && data[9] == 0x45 && data[10] == 0x42 && data[11] == 0x50 {
                return "image/webp".to_string();
            }
        }
        // BMP: 42 4D
        if data[0] == 0x42 && data[1] == 0x4D {
            return "image/bmp".to_string();
        }
    }
    "application/octet-stream".to_string()
}

// ==================== 截图工具 ====================

/// 检查 macOS 屏幕录制权限
#[derive(Serialize)]
pub struct ScreenCapturePermissionResult {
    pub has_permission: bool,
    pub message: String,
}

#[tauri::command]
pub fn check_screen_capture_permission() -> ScreenCapturePermissionResult {
    #[cfg(target_os = "macos")]
    {
        use std::process::Command;

        // 通过尝试截取一个 1x1 像素的区域来检测权限
        // 如果没有权限，截图会失败或返回空白
        let temp_path = std::env::temp_dir().join("dev_toolkit_permission_test.png");
        let temp_path_str = temp_path.to_string_lossy().to_string();

        // 使用 -R 参数指定区域截图（1x1 像素）
        let result = Command::new("screencapture")
            .args(["-x", "-R", "0", "0", "1", "1", &temp_path_str])
            .output();

        match result {
            Ok(output) if output.status.success() => {
                // 检查文件是否存在且大小有效
                if let Ok(metadata) = std::fs::metadata(&temp_path) {
                    let _ = std::fs::remove_file(&temp_path);
                    if metadata.len() > 0 {
                        // 进一步验证：读取图片并检查是否是有效图片
                        // 如果没有屏幕录制权限，screencapture 会创建一个桌面壁纸的截图
                        // 我们无法完全检测，但至少文件创建成功了
                        return ScreenCapturePermissionResult {
                            has_permission: true,
                            message: "屏幕录制权限已授权".to_string(),
                        };
                    }
                }
                ScreenCapturePermissionResult {
                    has_permission: false,
                    message: "无法验证屏幕录制权限，请确保已在系统设置中授权".to_string(),
                }
            }
            Ok(output) => {
                let stderr = String::from_utf8_lossy(&output.stderr);
                ScreenCapturePermissionResult {
                    has_permission: false,
                    message: format!("截图权限检测失败: {}", stderr),
                }
            }
            Err(e) => ScreenCapturePermissionResult {
                has_permission: false,
                message: format!("无法执行截图命令: {}", e),
            },
        }
    }

    #[cfg(not(target_os = "macos"))]
    {
        ScreenCapturePermissionResult {
            has_permission: true,
            message: "非 macOS 系统，无需检测屏幕录制权限".to_string(),
        }
    }
}

#[derive(Serialize)]
pub struct ScreenshotResult {
    pub success: bool,
    pub image_data: String,       // base64 data URL
    pub width: u32,
    pub height: u32,
    pub file_size: u64,
    pub error: Option<String>,
}

#[derive(Serialize)]
pub struct SaveImageResult {
    pub success: bool,
    pub file_path: String,
    pub error: Option<String>,
}

#[derive(Serialize, Deserialize)]
pub struct CropInfo {
    pub x: u32,
    pub y: u32,
    pub width: u32,
    pub height: u32,
}

// 截取当前窗口（前端实现，后端仅提供裁剪和保存）
#[tauri::command]
pub fn screenshot_window(_window: tauri::Window) -> ScreenshotResult {
    // Tauri 2.x 的窗口截图需要额外插件支持
    // 前端使用 navigator.mediaDevices.getDisplayMedia() 或 appWindow.capture()
    ScreenshotResult {
        success: false,
        image_data: String::new(),
        width: 0,
        height: 0,
        file_size: 0,
        error: Some("请使用前端截图功能（区域选择）".to_string()),
    }
}

// 截取指定区域（由前端传递区域坐标和截图数据）
#[tauri::command]
pub fn crop_image(base64_data: String, crop: CropInfo) -> ScreenshotResult {
    use base64::prelude::BASE64_STANDARD;
    use image::GenericImageView;
    use std::fs;

    // 解码 base64
    let decoded = match BASE64_STANDARD.decode(&base64_data) {
        Ok(d) => d,
        Err(e) => return ScreenshotResult {
            success: false,
            image_data: String::new(),
            width: 0,
            height: 0,
            file_size: 0,
            error: Some(format!("Base64 解码失败: {}", e)),
        },
    };

    // 尝试解码为图片
    let mut img = match image::load_from_memory(&decoded) {
        Ok(i) => i,
        Err(e) => return ScreenshotResult {
            success: false,
            image_data: String::new(),
            width: 0,
            height: 0,
            file_size: 0,
            error: Some(format!("图片解码失败: {}", e)),
        },
    };

    let (orig_w, orig_h) = img.dimensions();
    let x = crop.x.min(orig_w.saturating_sub(1));
    let y = crop.y.min(orig_h.saturating_sub(1));
    let w = crop.width.min(orig_w.saturating_sub(x));
    let h = crop.height.min(orig_h.saturating_sub(y));

    if w == 0 || h == 0 {
        return ScreenshotResult {
            success: false,
            image_data: String::new(),
            width: 0,
            height: 0,
            file_size: 0,
            error: Some("裁剪区域无效".to_string()),
        };
    }

    // 裁剪
    let cropped = img.crop(x, y, w, h);

    // 保存到临时文件，然后读取
    let temp_path = std::env::temp_dir().join("dev_toolkit_crop.png");
    if cropped.save(&temp_path).is_err() {
        return ScreenshotResult {
            success: false,
            image_data: String::new(),
            width: 0,
            height: 0,
            file_size: 0,
            error: Some("图片编码失败".to_string()),
        };
    }

    // 读取文件并编码为 base64
    match fs::read(&temp_path) {
        Ok(buffer) => {
            let _ = fs::remove_file(&temp_path); // 清理临时文件
            let base64_out = BASE64_STANDARD.encode(&buffer);
            let data_url = format!("data:image/png;base64,{}", base64_out);
            ScreenshotResult {
                success: true,
                image_data: data_url,
                width: w,
                height: h,
                file_size: buffer.len() as u64,
                error: None,
            }
        }
        Err(e) => ScreenshotResult {
            success: false,
            image_data: String::new(),
            width: 0,
            height: 0,
            file_size: 0,
            error: Some(format!("读取临时文件失败: {}", e)),
        },
    }
}

// 保存图片到本地
#[tauri::command]
pub fn save_image(base64_data: String, filename: String) -> SaveImageResult {
    use base64::prelude::BASE64_STANDARD;

    // 解码 base64
    let decoded = match BASE64_STANDARD.decode(&base64_data) {
        Ok(d) => d,
        Err(e) => return SaveImageResult {
            success: false,
            file_path: String::new(),
            error: Some(format!("Base64 解码失败: {}", e)),
        },
    };

    // 解码图片
    let img = match image::load_from_memory(&decoded) {
        Ok(i) => i,
        Err(e) => return SaveImageResult {
            success: false,
            file_path: String::new(),
            error: Some(format!("图片解码失败: {}", e)),
        },
    };

    // 保存到临时目录（使用原文件名扩展名）
    let temp_dir = std::env::temp_dir();
    let file_path = temp_dir.join(&filename);

    // 保存（image crate 自动处理格式）
    match img.save(&file_path) {
        Ok(_) => SaveImageResult {
            success: true,
            file_path: file_path.to_string_lossy().to_string(),
            error: None,
        },
        Err(e) => SaveImageResult {
            success: false,
            file_path: String::new(),
            error: Some(format!("保存失败: {}", e)),
        },
    }
}

// 打开系统文件选择器保存
#[tauri::command]
pub fn open_save_dialog(_window: tauri::Window, default_name: String) -> Result<String, String> {
    use rfd::FileDialog;

    let path = FileDialog::new()
        .set_file_name(&default_name)
        .add_filter("图片", &["png", "jpg", "jpeg", "webp"])
        .save_file();

    match path {
        Some(p) => Ok(p.to_string_lossy().to_string()),
        None => Err("用户取消保存".to_string()),
    }
}

// ==================== 系统截图 ====================
#[derive(Serialize)]
pub struct SystemScreenshotResult {
    pub success: bool,
    pub image_data: String,  // base64 data URL
    pub width: u32,
    pub height: u32,
    pub error: Option<String>,
}

#[tauri::command]
pub fn system_screenshot(mode: String) -> SystemScreenshotResult {
    use base64::prelude::BASE64_STANDARD;
    use image::GenericImageView;
    use std::process::Command;

    let temp_path = std::env::temp_dir().join(format!("dev_toolkit_screenshot_{}.png", std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()));
    let temp_path_str = temp_path.to_string_lossy().to_string();

    let result = if cfg!(target_os = "macos") {
        // macOS: screencapture 命令
        // -w: 窗口选择, -x: 全屏, -s: 区域选择
        let args = match mode.as_str() {
            "window" => vec!["-w", &temp_path_str],
            "fullscreen" => vec!["-x", &temp_path_str],
            "selection" => vec!["-s", &temp_path_str],
            _ => vec!["-s", &temp_path_str],
        };
        Command::new("screencapture").args(&args).output()
    } else if cfg!(target_os = "windows") {
        // Windows: 使用 PowerShell 截图
        // 全屏截图使用 [System.Windows.Forms.SendKeys] 或 PrintScreen
        let ps_script = match mode.as_str() {
            "fullscreen" => {
                // 使用 PowerShell + .NET 截取全屏
                format!(
                    "Add-Type -AssemblyName System.Windows.Forms; \
                     $screen = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds; \
                     $bmp = New-Object System.Drawing.Bitmap($screen.Width, $screen.Height); \
                     $g = [System.Drawing.Graphics]::FromImage($bmp); \
                     $g.CopyFromScreen($screen.Location, [System.Drawing.Point]::Empty, $screen.Size); \
                     $g.Dispose(); \
                     $bmp.Save('{}'); \
                     $bmp.Dispose()",
                    temp_path_str
                )
            }
            _ => {
                // 区域选择：先截全屏，让用户在编辑器中裁剪
                format!(
                    "Add-Type -AssemblyName System.Windows.Forms; \
                     $screen = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds; \
                     $bmp = New-Object System.Drawing.Bitmap($screen.Width, $screen.Height); \
                     $g = [System.Drawing.Graphics]::FromImage($bmp); \
                     $g.CopyFromScreen($screen.Location, [System.Drawing.Point]::Empty, $screen.Size); \
                     $g.Dispose(); \
                     $bmp.Save('{}'); \
                     $bmp.Dispose()",
                    temp_path_str
                )
            }
        };
        Command::new("powershell").args(["-NoProfile", "-Command", &ps_script]).output()
    } else if cfg!(target_os = "linux") {
        // Linux: 尝试使用 gnome-screenshot 或 scrot
        let (cmd, args) = if which_command_exists("gnome-screenshot") {
            match mode.as_str() {
                "fullscreen" => ("gnome-screenshot", vec!["-f", &temp_path_str]),
                "window" => ("gnome-screenshot", vec!["-w", "-f", &temp_path_str]),
                _ => ("gnome-screenshot", vec!["-a", "-f", &temp_path_str]),
            }
        } else if which_command_exists("scrot") {
            ("scrot", vec!["-s", &temp_path_str])
        } else if which_command_exists("xfce4-screenshooter") {
            ("xfce4-screenshooter", vec!["-r", "-s", &temp_path_str])
        } else {
            return SystemScreenshotResult {
                success: false,
                image_data: String::new(),
                width: 0,
                height: 0,
                error: Some("未找到截图工具，请安装 gnome-screenshot、scrot 或 xfce4-screenshooter".to_string()),
            };
        };
        Command::new(cmd).args(&args).output()
    } else {
        return SystemScreenshotResult {
            success: false,
            image_data: String::new(),
            width: 0,
            height: 0,
            error: Some("不支持的操作系统".to_string()),
        };
    };

    let output = match result {
        Ok(o) => o,
        Err(e) => return SystemScreenshotResult {
            success: false,
            image_data: String::new(),
            width: 0,
            height: 0,
            error: Some(format!("截图命令执行失败: {}", e)),
        },
    };

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return SystemScreenshotResult {
            success: false,
            image_data: String::new(),
            width: 0,
            height: 0,
            error: Some(format!("截图失败: {}", stderr)),
        };
    }

    // 读取截图文件
    let file_data = match std::fs::read(&temp_path) {
        Ok(d) => d,
        Err(e) => return SystemScreenshotResult {
            success: false,
            image_data: String::new(),
            width: 0,
            height: 0,
            error: Some(format!("读取截图文件失败: {}", e)),
        },
    };

    // 清理临时文件
    let _ = std::fs::remove_file(&temp_path);

    // 获取图片尺寸
    let img = match image::load_from_memory(&file_data) {
        Ok(i) => i,
        Err(e) => return SystemScreenshotResult {
            success: false,
            image_data: String::new(),
            width: 0,
            height: 0,
            error: Some(format!("图片解码失败: {}", e)),
        },
    };
    let (w, h) = img.dimensions();

    // 转为 base64
    let base64_out = BASE64_STANDARD.encode(&file_data);
    let data_url = format!("data:image/png;base64,{}", base64_out);

    SystemScreenshotResult {
        success: true,
        image_data: data_url,
        width: w,
        height: h,
        error: None,
    }
}

/// 检查系统命令是否存在
fn which_command_exists(cmd: &str) -> bool {
    std::process::Command::new("which")
        .arg(cmd)
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

// ==================== 截图编辑器 ====================
use std::sync::Mutex;

pub struct ScreenshotState {
    pub data: Mutex<Option<String>>,
}

impl Default for ScreenshotState {
    fn default() -> Self {
        Self { data: Mutex::new(None) }
    }
}

/// 关闭调用此命令的窗口（用于截图编辑器）
#[tauri::command]
pub async fn close_current_window(window: tauri::WebviewWindow) -> Result<(), String> {
    window.close().map_err(|e| format!("关闭窗口失败: {}", e))
}

#[derive(Serialize)]
pub struct ScreenshotDataResult {
    pub success: bool,
    pub image_data: String,
}

#[tauri::command]
pub fn get_screenshot_data(state: tauri::State<ScreenshotState>) -> ScreenshotDataResult {
    let data = state.data.lock().unwrap();
    match data.clone() {
        Some(d) => ScreenshotDataResult { success: true, image_data: d },
        None => ScreenshotDataResult { success: false, image_data: String::new() },
    }
}

#[derive(Serialize)]
pub struct SaveFileResult {
    pub success: bool,
    pub file_path: String,
    pub error: Option<String>,
}

#[tauri::command]
pub fn save_screenshot_file(image_base64: String) -> SaveFileResult {
    use base64::prelude::BASE64_STANDARD;

    let data = match BASE64_STANDARD.decode(&image_base64) {
        Ok(d) => d,
        Err(e) => return SaveFileResult {
            success: false,
            file_path: String::new(),
            error: Some(format!("Base64解码失败: {}", e)),
        },
    };

    let path = match rfd::FileDialog::new()
        .set_file_name("screenshot.png")
        .add_filter("PNG", &["png"])
        .add_filter("JPEG", &["jpg", "jpeg"])
        .save_file()
    {
        Some(p) => p,
        None => return SaveFileResult {
            success: false,
            file_path: String::new(),
            error: Some("用户取消".to_string()),
        },
    };

    match std::fs::write(&path, &data) {
        Ok(_) => SaveFileResult {
            success: true,
            file_path: path.to_string_lossy().to_string(),
            error: None,
        },
        Err(e) => SaveFileResult {
            success: false,
            file_path: String::new(),
            error: Some(format!("写入失败: {}", e)),
        },
    }
}

#[tauri::command]
pub fn copy_screenshot_to_clipboard(image_base64: String) -> Result<String, String> {
    use base64::prelude::BASE64_STANDARD;
    use std::process::Command as StdCommand;

    let data = BASE64_STANDARD.decode(&image_base64)
        .map_err(|e| format!("Base64解码失败: {}", e))?;

    // 保存到临时文件
    let temp_path = std::env::temp_dir().join(format!(
        "dev_toolkit_clipboard_{}.png",
        std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_millis()
    ));
    std::fs::write(&temp_path, &data)
        .map_err(|e| format!("写入临时文件失败: {}", e))?;

    let path_str = temp_path.to_string_lossy().to_string();

    let result = if cfg!(target_os = "macos") {
        // macOS: 使用 Swift 复制图片到系统剪贴板（比 osascript 更可靠）
        let swift_code = format!(
            "import AppKit; let i = NSImage(contentsOf: URL(fileURLWithPath: \"{}\")); \
             guard let img = i else {{ exit(1) }}; \
             let pb = NSPasteboard.general; pb.clearContents(); pb.writeObjects([img])",
            path_str
        );
        StdCommand::new("swift")
            .args(["-e", &swift_code])
            .output()
    } else if cfg!(target_os = "windows") {
        // Windows: 使用 PowerShell 复制图片到剪贴板
        let ps_script = format!(
            "Add-Type -AssemblyName System.Windows.Forms; \
             Add-Type -AssemblyName System.Drawing; \
             $img = [System.Drawing.Image]::FromFile('{}'); \
             [System.Windows.Forms.Clipboard]::SetImage($img); \
             $img.Dispose()",
            path_str
        );
        StdCommand::new("powershell")
            .args(["-NoProfile", "-Command", &ps_script])
            .output()
    } else if cfg!(target_os = "linux") {
        // Linux: 使用 xclip 复制图片到剪贴板
        if which_command_exists("xclip") {
            StdCommand::new("xclip")
                .args(["-selection", "clipboard", "-t", "image/png", "-i", &path_str])
                .output()
        } else if which_command_exists("xsel") {
            // xsel 不支持图片，尝试使用 wl-copy (Wayland)
            if which_command_exists("wl-copy") {
                StdCommand::new("sh")
                    .args(["-c", &format!("cat '{}' | wl-copy --type image/png", path_str)])
                    .output()
            } else {
                let _ = std::fs::remove_file(&temp_path);
                return Err("未找到剪贴板工具，请安装 xclip 或 wl-copy".to_string());
            }
        } else {
            let _ = std::fs::remove_file(&temp_path);
            return Err("未找到剪贴板工具，请安装 xclip 或 wl-copy".to_string());
        }
    } else {
        let _ = std::fs::remove_file(&temp_path);
        return Err("不支持的操作系统".to_string());
    };

    let _ = std::fs::remove_file(&temp_path);

    match result {
        Ok(output) if output.status.success() => Ok("已复制到剪贴板".to_string()),
        Ok(output) => Err(format!("复制到剪贴板失败: {}", String::from_utf8_lossy(&output.stderr))),
        Err(e) => Err(format!("复制命令执行失败: {}", e)),
    }
}

/// 触发截图并打开编辑器窗口
#[tauri::command]
pub async fn trigger_screenshot(
    app: tauri::AppHandle,
    mode: String,
    hide_main_window: Option<bool>,
) -> Result<String, String> {
    use base64::prelude::BASE64_STANDARD;
    use std::process::Command;

    let temp_path = std::env::temp_dir().join(format!("dev_toolkit_snip_{}.png",
        std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_millis()));
    let temp_path_str = temp_path.to_string_lossy().to_string();

    let should_hide_main_window = hide_main_window.unwrap_or(false);

    if should_hide_main_window {
        // 仅在明确请求截外部内容时才隐藏主窗口；默认保留本应用可见。
        if cfg!(target_os = "macos") {
            if let Some(main_window) = app.get_webview_window("main") {
                let _ = main_window.hide();
            }

            std::thread::sleep(std::time::Duration::from_millis(300));

            let activate_script = r#"
                tell application "System Events"
                    set appList to name of every application process whose visible is true and name is not "dev-toolkit"
                    if (count of appList) > 0 then
                        set frontApp to item 1 of appList
                        tell process frontApp
                            set frontmost to true
                        end tell
                    end if
                end tell
            "#;
            let _ = Command::new("osascript")
                .args(["-e", activate_script])
                .output();

            std::thread::sleep(std::time::Duration::from_millis(200));
        } else {
            if let Some(main_window) = app.get_webview_window("main") {
                let _ = main_window.hide();
            }
            std::thread::sleep(std::time::Duration::from_millis(100));
        }
    }

    // 执行截图命令
    let screenshot_result = if cfg!(target_os = "macos") {
        // 根据模式选择不同的 screencapture 参数
        let args = match mode.as_str() {
            "fullscreen" => vec!["-x".to_string(), temp_path_str.clone()],
            "window" => vec!["-w".to_string(), "-x".to_string(), temp_path_str.clone()],
            _ => vec!["-i".to_string(), "-x".to_string(), temp_path_str.clone()], // selection 模式
        };
        Command::new("screencapture")
            .args(&args)
            .output()
            .map_err(|e| format!("截图命令失败: {}", e))
    } else if cfg!(target_os = "windows") {
        let ps_script = format!(
            "Add-Type -AssemblyName System.Windows.Forms; \
             Add-Type -AssemblyName System.Drawing; \
             $screen = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds; \
             $bmp = New-Object System.Drawing.Bitmap($screen.Width, $screen.Height); \
             $g = [System.Drawing.Graphics]::FromImage($bmp); \
             $g.CopyFromScreen($screen.Location, [System.Drawing.Point]::Empty, $screen.Size); \
             $g.Dispose(); \
             $bmp.Save('{}'); \
             $bmp.Dispose()",
            temp_path_str
        );
        Command::new("powershell")
            .args(["-NoProfile", "-Command", &ps_script])
            .output()
            .map_err(|e| format!("截图命令失败: {}", e))
    } else if cfg!(target_os = "linux") {
        let output = if which_command_exists("gnome-screenshot") {
            Command::new("gnome-screenshot")
                .args(["-a", "-f", &temp_path_str])
                .output()
        } else if which_command_exists("scrot") {
            Command::new("scrot").args(["-s", &temp_path_str]).output()
        } else if which_command_exists("xfce4-screenshooter") {
            Command::new("xfce4-screenshooter")
                .args(["-r", "-s", &temp_path_str])
                .output()
        } else {
            if should_hide_main_window {
                if let Some(main_window) = app.get_webview_window("main") {
                    let _ = main_window.show();
                }
            }
            return Err("未找到截图工具".to_string());
        };
        output.map_err(|e| format!("截图命令失败: {}", e))
    } else {
        if should_hide_main_window {
            if let Some(main_window) = app.get_webview_window("main") {
                let _ = main_window.show();
            }
        }
        return Err("不支持的操作系统".to_string());
    };

    if should_hide_main_window {
        if let Some(main_window) = app.get_webview_window("main") {
            let _ = main_window.show();
            let _ = main_window.set_focus();
        }
    }

    // 检查截图结果
    let output = screenshot_result?;
    if !output.status.success() {
        return Err(format!("截图失败: {}", String::from_utf8_lossy(&output.stderr)));
    }

    let file_data = std::fs::read(&temp_path)
        .map_err(|e| format!("读取截图失败: {}", e))?;
    let _ = std::fs::remove_file(&temp_path);

    let base64_out = BASE64_STANDARD.encode(&file_data);
    let data_url = format!("data:image/png;base64,{}", base64_out);

    // 存储截图数据（通过 app.state() 获取管理的状态）
    let state = app.state::<ScreenshotState>();
    *state.data.lock().unwrap() = Some(data_url.clone());

    // 获取图片尺寸
    let img = image::load_from_memory(&file_data)
        .map_err(|e| format!("图片解码失败: {}", e))?;
    let (w, h) = img.dimensions();

    // 打开编辑器窗口
    use tauri::WebviewWindowBuilder;
    use tauri::WebviewUrl;

    let win_w = (w as f64).min(1200.0).max(400.0);
    let win_h = (h as f64).min(800.0).max(300.0) + 60.0;  // +60 for toolbar

    let label = format!("screenshot-{}", std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_millis());

    WebviewWindowBuilder::new(
        &app,
        &label,
        WebviewUrl::App("/screenshot-editor.html".into()),
    )
    .title("截图编辑器")
    .decorations(false)
    .always_on_top(true)
    .inner_size(win_w, win_h)
    .min_inner_size(400.0, 300.0)
    .resizable(true)
    .build()
    .map_err(|e| format!("创建窗口失败: {}", e))?;

    Ok("截图完成".to_string())
}

/// 设置截图数据（供前端注入数据到 ScreenshotState）
#[tauri::command]
pub fn set_screenshot_data(data: String, state: tauri::State<ScreenshotState>) -> Result<String, String> {
    *state.data.lock().unwrap() = Some(data);
    Ok("ok".to_string())
}

/// 打开截图编辑器窗口
#[tauri::command]
pub fn open_screenshot_editor(
    app: tauri::AppHandle,
    label: String,
    title: String,
) -> Result<String, String> {
    use tauri::WebviewWindowBuilder;
    use tauri::WebviewUrl;

    let win_label = format!("screenshot-{}", label);

    WebviewWindowBuilder::new(
        &app,
        &win_label,
        WebviewUrl::App("/screenshot-editor.html".into()),
    )
    .title(&title)
    .decorations(false)
    .always_on_top(true)
    .inner_size(1000.0, 700.0)
    .min_inner_size(400.0, 300.0)
    .resizable(true)
    .build()
    .map_err(|e| format!("创建窗口失败: {}", e))?;

    Ok("ok".to_string())
}

// ==================== QR 码工具 ====================

/// 从系统剪贴板读取图片，返回 base64 data URL
#[tauri::command]
pub fn read_clipboard_image() -> Result<String, String> {
    use std::process::Command as StdCommand;

    let temp_path = std::env::temp_dir().join(format!(
        "dev_toolkit_clipboard_read_{}.png",
        std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_millis()
    ));
    let path_str = temp_path.to_string_lossy().to_string();

    let result = if cfg!(target_os = "macos") {
        let script = format!(
            "import AppKit; guard let pb = NSPasteboard.general.data(forType: .tiff), \
             let rep = NSBitmapImageRep(data: pb), \
             let png = rep.representation(using: .png, properties: [:]) else {{ exit(1) }}; \
             try! png.write(to: URL(fileURLWithPath: \"{}\"))",
            path_str
        );
        StdCommand::new("swift").args(["-e", &script]).output()
    } else if cfg!(target_os = "windows") {
        let ps_script = format!(
            "Add-Type -AssemblyName System.Windows.Forms; \
             Add-Type -AssemblyName System.Drawing; \
             $img = [System.Windows.Forms.Clipboard]::GetImage(); \
             if ($img -eq $null) {{ exit 1 }}; \
             $img.Save('{}', [System.Drawing.Imaging.ImageFormat]::Png)",
            path_str
        );
        StdCommand::new("powershell").args(["-NoProfile", "-Command", &ps_script]).output()
    } else if cfg!(target_os = "linux") {
        if which_command_exists("xclip") {
            StdCommand::new("sh").args(["-c", &format!("xclip -selection clipboard -t image/png -o > '{}'", path_str)]).output()
        } else {
            return Err("未找到剪贴板工具，请安装 xclip".to_string());
        }
    } else {
        return Err("不支持的操作系统".to_string());
    };

    match result {
        Ok(output) if output.status.success() => {
            let data = std::fs::read(&temp_path)
                .map_err(|e| format!("读取临时文件失败: {}", e))?;
            let _ = std::fs::remove_file(&temp_path);
            let b64 = base64::engine::general_purpose::STANDARD.encode(&data);
            Ok(format!("data:image/png;base64,{}", b64))
        }
        Ok(_) => {
            let _ = std::fs::remove_file(&temp_path);
            Err("剪贴板中没有图片".to_string())
        }
        Err(e) => {
            let _ = std::fs::remove_file(&temp_path);
            Err(format!("读取剪贴板失败: {}", e))
        }
    }
}
#[derive(Serialize)]
pub struct QrGenerateResult {
    pub success: bool,
    pub data_url: String,
    pub base64: String,
    pub size_bytes: u64,
    pub error: Option<String>,
}

#[derive(Serialize)]
pub struct QrDecodeResult {
    pub success: bool,
    pub text: String,
    pub error: Option<String>,
}

#[tauri::command]
pub fn qr_generate(input: String, ec_level: String) -> QrGenerateResult {
    if input.is_empty() {
        return QrGenerateResult {
            success: false,
            data_url: String::new(),
            base64: String::new(),
            size_bytes: 0,
            error: Some("输入不能为空".to_string()),
        };
    }

    let ec = match ec_level.as_str() {
        "L" => qrcode::EcLevel::L,
        "Q" => qrcode::EcLevel::Q,
        "H" => qrcode::EcLevel::H,
        _ => qrcode::EcLevel::M,
    };

    let code = match qrcode::QrCode::with_error_correction_level(input.as_bytes(), ec) {
        Ok(c) => c,
        Err(e) => {
            return QrGenerateResult {
                success: false,
                data_url: String::new(),
                base64: String::new(),
                size_bytes: 0,
                error: Some(format!("QR 码生成失败: {}", e)),
            };
        }
    };

    let img = code.render::<image::Rgba<u8>>().build();
    let scaled = image::imageops::resize(&img, img.width() * 4, img.height() * 4, image::imageops::FilterType::Nearest);

    let mut png_buf = Vec::new();
    let mut cursor = std::io::Cursor::new(&mut png_buf);
    if let Err(e) = scaled.write_to(&mut cursor, image::ImageFormat::Png) {
        return QrGenerateResult {
            success: false,
            data_url: String::new(),
            base64: String::new(),
            size_bytes: 0,
            error: Some(format!("PNG 编码失败: {}", e)),
        };
    }

    let b64 = base64::engine::general_purpose::STANDARD.encode(&png_buf);
    let data_url = format!("data:image/png;base64,{}", b64);

    QrGenerateResult {
        success: true,
        data_url,
        base64: b64,
        size_bytes: png_buf.len() as u64,
        error: None,
    }
}

#[tauri::command]
pub fn qr_decode(image_data: String) -> QrDecodeResult {
    let pure_base64 = if image_data.contains(',') && image_data.starts_with("data:") {
        image_data.split(',').nth(1).unwrap_or(&image_data).trim()
    } else {
        image_data.trim()
    };

    let bytes = match base64::engine::general_purpose::STANDARD.decode(pure_base64) {
        Ok(b) => b,
        Err(e) => {
            return QrDecodeResult {
                success: false,
                text: String::new(),
                error: Some(format!("Base64 解码失败: {}", e)),
            };
        }
    };

    let img = match image::load_from_memory(&bytes) {
        Ok(i) => i.to_luma8(),
        Err(e) => {
            return QrDecodeResult {
                success: false,
                text: String::new(),
                error: Some(format!("图片加载失败: {}", e)),
            };
        }
    };

    let mut prepared = rqrr::PreparedImage::prepare(img);
    let grids = prepared.detect_grids();
    if grids.is_empty() {
        return QrDecodeResult {
            success: false,
            text: String::new(),
            error: Some("未检测到 QR 码".to_string()),
        };
    }

    match grids[0].decode() {
        Ok((_, content)) => QrDecodeResult {
            success: true,
            text: content,
            error: None,
        },
        Err(e) => QrDecodeResult {
            success: false,
            text: String::new(),
            error: Some(format!("QR 码解码失败: {}", e)),
        },
    }
}

// ==================== HTTP 请求工具 ====================
#[derive(Serialize, Deserialize, Clone)]
pub struct HttpRequest {
    pub method: String,
    pub url: String,
    pub headers: std::collections::HashMap<String, String>,
    pub body_type: String,
    pub body: String,
    pub timeout: u64,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct HttpResponse {
    pub success: bool,
    pub status: u16,
    pub status_text: String,
    pub headers: std::collections::HashMap<String, String>,
    pub body: String,
    pub time_ms: u64,
    pub size_bytes: u64,
    pub redirects: Vec<HttpRedirect>,
    pub error: Option<String>,
    pub is_image: bool,
    pub content_type: String,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct HttpRedirect {
    pub status: u16,
    pub status_text: String,
    pub url: String,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct HttpHistoryEntry {
    pub id: String,
    pub request: HttpRequest,
    pub response: Option<HttpResponse>,
    pub created_at: i64,
    pub name: Option<String>,
    pub folder_id: Option<String>,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct HttpFolder {
    pub id: String,
    pub name: String,
    pub parent_id: Option<String>,
    pub created_at: i64,
}

#[tauri::command]
pub async fn http_request(req: HttpRequest) -> HttpResponse {
    let timeout_dur = std::time::Duration::from_secs(if req.timeout == 0 { 30 } else { req.timeout });

    let method = match req.method.to_uppercase().as_str() {
        "POST" => reqwest::Method::POST,
        "PUT" => reqwest::Method::PUT,
        "DELETE" => reqwest::Method::DELETE,
        "PATCH" => reqwest::Method::PATCH,
        "HEAD" => reqwest::Method::HEAD,
        "OPTIONS" => reqwest::Method::OPTIONS,
        _ => reqwest::Method::GET,
    };

    // 先用禁止重定向的客户端跟踪重定向链
    let no_redirect_client = reqwest::Client::builder()
        .timeout(timeout_dur)
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .unwrap_or_default();

    let auto_content_type = matches!(req.body_type.as_str(), "json" | "form" | "form-data");
    let mut redirects: Vec<HttpRedirect> = Vec::new();
    let mut current_url = req.url.clone();
    let max_redirects = 10u32;

    for _ in 0..max_redirects {
        let mut builder = no_redirect_client.request(method.clone(), &current_url);
        for (k, v) in &req.headers {
            if !k.is_empty() {
                if auto_content_type && k.eq_ignore_ascii_case("content-type") {
                    continue;
                }
                builder = builder.header(k.as_str(), v.as_str());
            }
        }
        if req.method != "GET" && req.method != "HEAD" && !req.body.is_empty() {
            match req.body_type.as_str() {
                "json" => {
                    builder = builder.header("Content-Type", "application/json").body(req.body.clone());
                }
                "form" => {
                    if let Ok(map) = serde_json::from_str::<std::collections::HashMap<String, String>>(&req.body) {
                        builder = builder.form(&map);
                    } else {
                        builder = builder.body(req.body.clone());
                    }
                }
                "form-data" => {
                    if let Ok(map) = serde_json::from_str::<std::collections::HashMap<String, String>>(&req.body) {
                        let mut form = reqwest::multipart::Form::new();
                        for (k, v) in &map {
                            form = form.text(k.clone(), v.clone());
                        }
                        builder = builder.multipart(form);
                    } else {
                        builder = builder.body(req.body.clone());
                    }
                }
                _ => {
                    builder = builder.body(req.body.clone());
                }
            }
        }

        match builder.send().await {
            Ok(resp) => {
                let status = resp.status().as_u16();
                if status >= 300 && status < 400 {
                    if let Some(location) = resp.headers().get("location") {
                        let location_str = location.to_str().unwrap_or("").to_string();
                        // 处理相对路径
                        if location_str.starts_with("http://") || location_str.starts_with("https://") {
                            current_url = location_str;
                        } else if location_str.starts_with('/') {
                            if let Ok(parsed) = url::Url::parse(&req.url) {
                                current_url = parsed.origin().ascii_serialization() + &location_str;
                            } else {
                                current_url = location_str;
                            }
                        } else {
                            current_url = location_str;
                        }
                        redirects.push(HttpRedirect {
                            status,
                            status_text: resp.status().canonical_reason().unwrap_or("").to_string(),
                            url: current_url.clone(),
                        });
                        continue;
                    }
                }
                // 非重定向响应或无 Location 头，跳出循环用正常客户端发最终请求
                break;
            }
            Err(_) => break,
        }
    }

    // 用自动重定向的客户端发送最终请求获取完整响应
    let client = reqwest::Client::builder()
        .timeout(timeout_dur)
        .build()
        .unwrap_or_default();

    let mut builder = client.request(method.clone(), &req.url);
    for (k, v) in &req.headers {
        if !k.is_empty() {
            if auto_content_type && k.eq_ignore_ascii_case("content-type") {
                continue;
            }
            builder = builder.header(k.as_str(), v.as_str());
        }
    }
    if req.method != "GET" && req.method != "HEAD" && !req.body.is_empty() {
        match req.body_type.as_str() {
            "json" => {
                builder = builder.header("Content-Type", "application/json").body(req.body.clone());
            }
            "form" => {
                if let Ok(map) = serde_json::from_str::<std::collections::HashMap<String, String>>(&req.body) {
                    builder = builder.form(&map);
                } else {
                    builder = builder.body(req.body.clone());
                }
            }
            "form-data" => {
                if let Ok(map) = serde_json::from_str::<std::collections::HashMap<String, String>>(&req.body) {
                    let mut form = reqwest::multipart::Form::new();
                    for (k, v) in &map {
                        form = form.text(k.clone(), v.clone());
                    }
                    builder = builder.multipart(form);
                } else {
                    builder = builder.body(req.body.clone());
                }
            }
            _ => {
                builder = builder.body(req.body.clone());
            }
        }
    }

    let start = std::time::Instant::now();
    match builder.send().await {
        Ok(resp) => {
            let elapsed = start.elapsed().as_millis() as u64;
            let status = resp.status().as_u16();
            let status_text = resp.status().canonical_reason().unwrap_or("").to_string();
            let resp_headers: std::collections::HashMap<String, String> = resp
                .headers()
                .iter()
                .map(|(k, v)| (k.to_string(), v.to_str().unwrap_or("").to_string()))
                .collect();
            let content_type = resp_headers.get("content-type").cloned().unwrap_or_default();
            let is_image = content_type.starts_with("image/");
            let body_bytes = match resp.bytes().await {
                Ok(b) => b,
                Err(e) => {
                    return HttpResponse {
                        success: false, status, status_text, headers: resp_headers,
                        body: String::new(), time_ms: elapsed, size_bytes: 0, redirects,
                        error: Some(format!("读取响应体失败: {}", e)),
                        is_image: false, content_type: String::new(),
                    };
                }
            };
            let size = body_bytes.len() as u64;
            let body = if is_image {
                use base64::Engine;
                base64::engine::general_purpose::STANDARD.encode(&body_bytes)
            } else {
                String::from_utf8_lossy(&body_bytes).to_string()
            };
            HttpResponse {
                success: true, status, status_text, headers: resp_headers,
                body, time_ms: elapsed, size_bytes: size, redirects, error: None,
                is_image, content_type,
            }
        }
        Err(e) => {
            let elapsed = start.elapsed().as_millis() as u64;
            let mut msg = e.to_string();
            if e.is_timeout() { msg = "请求超时".to_string(); }
            else if e.is_connect() { msg = format!("连接失败: {}", e); }
            else if e.is_request() { msg = format!("请求构造失败: {}", e); }
            HttpResponse {
                success: false, status: 0, status_text: String::new(),
                headers: std::collections::HashMap::new(), body: String::new(),
                time_ms: elapsed, size_bytes: 0, redirects: Vec::new(), error: Some(msg),
                is_image: false, content_type: String::new(),
            }
        }
    }
}

fn http_data_dir(app: &tauri::AppHandle) -> std::path::PathBuf {
    let dir = app.path().app_data_dir().unwrap_or_else(|_| std::env::temp_dir());
    let dir = dir.join("http");
    let _ = std::fs::create_dir_all(&dir);
    dir
}

#[tauri::command]
pub fn http_save_history(app: tauri::AppHandle, entries: Vec<HttpHistoryEntry>) -> Result<(), String> {
    let path = http_data_dir(&app).join("history.json");
    let data = serde_json::to_string_pretty(&entries).map_err(|e| format!("序列化失败: {}", e))?;
    std::fs::write(&path, data).map_err(|e| format!("写入失败: {}", e))
}

#[tauri::command]
pub fn http_load_history(app: tauri::AppHandle) -> Vec<HttpHistoryEntry> {
    let path = http_data_dir(&app).join("history.json");
    let data = match std::fs::read_to_string(&path) {
        Ok(d) => d,
        Err(_) => return Vec::new(),
    };
    serde_json::from_str(&data).unwrap_or_default()
}

#[tauri::command]
pub fn http_save_favorites(app: tauri::AppHandle, entries: Vec<HttpHistoryEntry>) -> Result<(), String> {
    let path = http_data_dir(&app).join("favorites.json");
    let data = serde_json::to_string_pretty(&entries).map_err(|e| format!("序列化失败: {}", e))?;
    std::fs::write(&path, data).map_err(|e| format!("写入失败: {}", e))
}

#[tauri::command]
pub fn http_load_favorites(app: tauri::AppHandle) -> Vec<HttpHistoryEntry> {
    let path = http_data_dir(&app).join("favorites.json");
    let data = match std::fs::read_to_string(&path) {
        Ok(d) => d,
        Err(_) => return Vec::new(),
    };
    serde_json::from_str(&data).unwrap_or_default()
}

#[tauri::command]
pub fn http_save_folders(app: tauri::AppHandle, folders: Vec<HttpFolder>) -> Result<(), String> {
    let path = http_data_dir(&app).join("folders.json");
    let data = serde_json::to_string_pretty(&folders).map_err(|e| format!("序列化失败: {}", e))?;
    std::fs::write(&path, data).map_err(|e| format!("写入失败: {}", e))
}

#[tauri::command]
pub fn http_load_folders(app: tauri::AppHandle) -> Vec<HttpFolder> {
    let path = http_data_dir(&app).join("folders.json");
    let data = match std::fs::read_to_string(&path) {
        Ok(d) => d,
        Err(_) => return Vec::new(),
    };
    serde_json::from_str(&data).unwrap_or_default()
}

// ===== 翻译工具 =====
#[derive(serde::Serialize)]
pub struct TranslateResult {
    pub success: bool,
    pub result: String,
    pub error: Option<String>,
}

#[tauri::command]
pub async fn translate(text: String, source: String, target: String) -> TranslateResult {
    if text.trim().is_empty() {
        return TranslateResult {
            success: false,
            result: String::new(),
            error: Some("请输入要翻译的文本".to_string()),
        };
    }

    // MyMemory API: https://api.mymemory.translated.net/get?q=text&langpair=source|target
    let lang_pair = format!("{}|{}", source, target);
    let url = format!(
        "https://api.mymemory.translated.net/get?q={}&langpair={}",
        urlencoding::encode(&text),
        urlencoding::encode(&lang_pair)
    );

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .unwrap_or_default();

    match client.get(&url).send().await {
        Ok(resp) => {
            match resp.text().await {
                Ok(body) => {
                    // 解析 JSON 响应
                    if let Ok(json) = serde_json::from_str::<serde_json::Value>(&body) {
                        if let Some(response_data) = json.get("responseData") {
                            if let Some(translated) = response_data.get("translatedText") {
                                if let Some(translated_text) = translated.as_str() {
                                    return TranslateResult {
                                        success: true,
                                        result: translated_text.to_string(),
                                        error: None,
                                    };
                                }
                            }
                        }
                        // 检查错误信息
                        if let Some(error_msg) = json.get("responseStatus") {
                            if error_msg.as_str() != Some("200") {
                                return TranslateResult {
                                    success: false,
                                    result: String::new(),
                                    error: Some(format!("翻译失败: {:?}", error_msg)),
                                };
                            }
                        }
                    }
                    TranslateResult {
                        success: false,
                        result: String::new(),
                        error: Some("解析翻译结果失败".to_string()),
                    }
                }
                Err(e) => TranslateResult {
                    success: false,
                    result: String::new(),
                    error: Some(format!("读取响应失败: {}", e)),
                },
            }
        }
        Err(e) => TranslateResult {
            success: false,
            result: String::new(),
            error: Some(format!("请求失败: {}", e)),
        },
    }
}

/// 打开在线翻译窗口（WebView）
#[tauri::command]
pub async fn open_translate_webview(
    app: tauri::AppHandle,
    service: String,
) -> Result<(), String> {
    let (url, title) = match service.as_str() {
        "youdao" => (
            "https://m.youdao.com/translate".parse::<url::Url>().unwrap(),
            "有道翻译",
        ),
        "google" => (
            "https://translate.google.com".parse::<url::Url>().unwrap(),
            "Google 翻译",
        ),
        "baidu" => (
            "https://fanyi.baidu.com".parse::<url::Url>().unwrap(),
            "百度翻译",
        ),
        "deepl" => (
            "https://www.deepl.com/translator".parse::<url::Url>().unwrap(),
            "DeepL 翻译",
        ),
        _ => return Err(format!("未知的翻译服务: {}", service)),
    };

    let label = format!("translate-{}", service);

    tauri::WebviewWindowBuilder::new(
        &app,
        label,
        tauri::WebviewUrl::External(url),
    )
    .title(title)
    .inner_size(900.0, 700.0)
    .center()
    .resizable(true)
    .build()
    .map_err(|e| format!("创建窗口失败: {}", e))?;

    Ok(())
}

// ==================== SSH会话管理 ====================

use crate::ssh::SshSession;

#[tauri::command]
pub fn ssh_list_sessions() -> Result<Vec<SshSession>, String> {
    crate::ssh::load_sessions()
}

#[tauri::command]
pub fn ssh_save_session(session: SshSession) -> Result<SshSession, String> {
    if session.id.is_empty() {
        crate::ssh::add_session(session)
    } else {
        crate::ssh::update_session(&session)?;
        Ok(session)
    }
}

#[tauri::command]
pub fn ssh_delete_session(id: String) -> Result<(), String> {
    crate::ssh::delete_session(&id)
}

#[tauri::command]
pub fn ssh_get_groups() -> Result<Vec<String>, String> {
    crate::ssh::get_groups()
}

#[tauri::command]
pub fn ssh_import_sessions(json: String) -> Result<Vec<SshSession>, String> {
    let sessions: Vec<SshSession> = serde_json::from_str(&json)
        .map_err(|e| format!("解析导入数据失败: {}", e))?;

    let mut existing = crate::ssh::load_sessions()?;
    for mut session in sessions {
        // 重新生成ID避免冲突
        session.id = uuid::Uuid::new_v4().to_string();
        let now = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
        session.created_at = now.clone();
        session.updated_at = now;
        existing.push(session);
    }

    crate::ssh::save_sessions(&existing)?;
    Ok(existing)
}

#[tauri::command]
pub fn ssh_export_sessions(ids: Vec<String>) -> Result<String, String> {
    let sessions = crate::ssh::load_sessions()?;
    let filtered: Vec<SshSession> = sessions
        .into_iter()
        .filter(|s| ids.is_empty() || ids.contains(&s.id))
        .collect();

    serde_json::to_string_pretty(&filtered)
        .map_err(|e| format!("导出失败: {}", e))
}

// ==================== SSH 连接管理 ====================

/// SSH连接
#[tauri::command]
pub async fn ssh_connect(
    app: tauri::AppHandle,
    session_id: String,
    session: SshSession,
) -> Result<String, String> {
    crate::ssh::session::SSH_MANAGER
        .connect(&session, app)
        .await
}

/// SSH断开连接
#[tauri::command]
pub async fn ssh_disconnect(connection_id: String) -> Result<(), String> {
    crate::ssh::session::SSH_MANAGER
        .disconnect(&connection_id)
        .await
}

/// 创建PTY终端
#[tauri::command]
pub async fn ssh_create_pty(
    connection_id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    use std::sync::Arc;
    use tokio::sync::RwLock;

    let conn = crate::ssh::session::SSH_MANAGER
        .get_connection(&connection_id)
        .await
        .ok_or("连接不存在")?;

    let channel = conn.create_pty(cols, rows)?;

    // 保存channel到全局管理器
    lazy_static::lazy_static! {
        static ref PTY_CHANNELS: Arc<RwLock<std::collections::HashMap<String, ssh2::Channel>>> =
            Arc::new(RwLock::new(std::collections::HashMap::new()));
    }

    {
        let mut channels = PTY_CHANNELS.write().await;
        channels.insert(connection_id.clone(), channel);
    }

    Ok(())
}

/// 调整PTY大小
#[tauri::command]
pub async fn ssh_resize_pty(
    connection_id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    use std::sync::Arc;
    use tokio::sync::RwLock;

    lazy_static::lazy_static! {
        static ref PTY_CHANNELS: Arc<RwLock<std::collections::HashMap<String, ssh2::Channel>>> =
            Arc::new(RwLock::new(std::collections::HashMap::new()));
    }

    let mut channels = PTY_CHANNELS.write().await;
    if let Some(channel) = channels.get_mut(&connection_id) {
        channel.request_pty_size(cols as u32, rows as u32, Some(0), Some(0))
            .map_err(|e| format!("调整大小失败: {}", e))?;
    }

    Ok(())
}

/// 写入数据到SSH通道
#[tauri::command]
pub async fn ssh_write(
    connection_id: String,
    data: Vec<u8>,
) -> Result<(), String> {
    use std::sync::Arc;
    use tokio::sync::RwLock;

    lazy_static::lazy_static! {
        static ref PTY_CHANNELS: Arc<RwLock<std::collections::HashMap<String, ssh2::Channel>>> =
            Arc::new(RwLock::new(std::collections::HashMap::new()));
    }

    let mut channels = PTY_CHANNELS.write().await;
    if let Some(channel) = channels.get_mut(&connection_id) {
        use std::io::Write;
        channel.write_all(&data)
            .map_err(|e| format!("写入失败: {}", e))?;
    }

    Ok(())
}

// ==================== SFTP 操作 ====================

/// SFTP列出目录
#[tauri::command]
pub async fn ssh_sftp_list_dir(
    connection_id: String,
    path: String,
) -> Result<Vec<crate::ssh::sftp::SftpEntry>, String> {
    let conn = crate::ssh::session::SSH_MANAGER
        .get_connection(&connection_id)
        .await
        .ok_or("连接不存在")?;

    let sftp = conn.create_sftp()?;
    crate::ssh::sftp::list_dir(&sftp, &path)
}

/// SFTP读取文件
#[tauri::command]
pub async fn ssh_sftp_read_file(
    connection_id: String,
    path: String,
) -> Result<String, String> {
    let conn = crate::ssh::session::SSH_MANAGER
        .get_connection(&connection_id)
        .await
        .ok_or("连接不存在")?;

    let sftp = conn.create_sftp()?;
    crate::ssh::sftp::read_file(&sftp, &path)
}

/// SFTP写入文件
#[tauri::command]
pub async fn ssh_sftp_write_file(
    connection_id: String,
    path: String,
    content: String,
) -> Result<(), String> {
    let conn = crate::ssh::session::SSH_MANAGER
        .get_connection(&connection_id)
        .await
        .ok_or("连接不存在")?;

    let sftp = conn.create_sftp()?;
    crate::ssh::sftp::write_file(&sftp, &path, &content)
}

/// SFTP创建目录
#[tauri::command]
pub async fn ssh_sftp_mkdir(
    connection_id: String,
    path: String,
) -> Result<(), String> {
    let conn = crate::ssh::session::SSH_MANAGER
        .get_connection(&connection_id)
        .await
        .ok_or("连接不存在")?;

    let sftp = conn.create_sftp()?;
    crate::ssh::sftp::mkdir(&sftp, &path)
}

/// SFTP删除文件
#[tauri::command]
pub async fn ssh_sftp_remove(
    connection_id: String,
    path: String,
    is_dir: bool,
) -> Result<(), String> {
    let conn = crate::ssh::session::SSH_MANAGER
        .get_connection(&connection_id)
        .await
        .ok_or("连接不存在")?;

    let sftp = conn.create_sftp()?;
    if is_dir {
        crate::ssh::sftp::remove_dir(&sftp, &path)
    } else {
        crate::ssh::sftp::remove_file(&sftp, &path)
    }
}

// ==================== 系统监控 ====================

/// 系统监控数据
#[derive(Debug, Clone, serde::Serialize)]
pub struct SystemMonitorData {
    pub cpu_usage: Vec<f32>,
    pub memory: MemoryInfo,
    pub disk: Vec<DiskInfo>,
    pub network: NetworkInfo,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct MemoryInfo {
    pub total: u64,
    pub used: u64,
    pub free: u64,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct DiskInfo {
    pub name: String,
    pub total: u64,
    pub used: u64,
    pub usage: String,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct NetworkInfo {
    pub rx_bytes: u64,
    pub tx_bytes: u64,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct ProcessInfo {
    pub pid: u32,
    pub user: String,
    pub cpu: f32,
    pub mem: f32,
    pub command: String,
}

/// 获取系统监控数据
#[tauri::command]
pub async fn ssh_monitor_data(
    connection_id: String,
) -> Result<SystemMonitorData, String> {
    let conn = crate::ssh::session::SSH_MANAGER
        .get_connection(&connection_id)
        .await
        .ok_or("连接不存在")?;

    let mut channel = conn.session.channel_session()
        .map_err(|e| format!("创建通道失败: {}", e))?;

    // 执行命令获取系统信息
    channel.exec("cat /proc/loadavg 2>/dev/null || echo '0 0 0'")
        .map_err(|e| format!("执行命令失败: {}", e))?;

    let mut output = String::new();
    use std::io::Read;
    channel.read_to_string(&mut output).ok();
    channel.close().ok();

    // 解析CPU负载
    let cpu_usage: Vec<f32> = output.split_whitespace()
        .take(3)
        .filter_map(|s| s.parse().ok())
        .collect();

    Ok(SystemMonitorData {
        cpu_usage: if cpu_usage.is_empty() { vec![0.0] } else { cpu_usage },
        memory: MemoryInfo { total: 0, used: 0, free: 0 },
        disk: vec![],
        network: NetworkInfo { rx_bytes: 0, tx_bytes: 0 },
    })
}

/// 获取进程列表
#[tauri::command]
pub async fn ssh_monitor_processes(
    connection_id: String,
) -> Result<Vec<ProcessInfo>, String> {
    let conn = crate::ssh::session::SSH_MANAGER
        .get_connection(&connection_id)
        .await
        .ok_or("连接不存在")?;

    let mut channel = conn.session.channel_session()
        .map_err(|e| format!("创建通道失败: {}", e))?;

    channel.exec("ps aux --sort=-%cpu 2>/dev/null | head -21 || ps aux | head -21")
        .map_err(|e| format!("执行命令失败: {}", e))?;

    let mut output = String::new();
    use std::io::Read;
    channel.read_to_string(&mut output).ok();
    channel.close().ok();

    let mut processes = Vec::new();
    for line in output.lines().skip(1) {
        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.len() >= 11 {
            processes.push(ProcessInfo {
                pid: parts[1].parse().unwrap_or(0),
                user: parts[0].to_string(),
                cpu: parts[2].parse().unwrap_or(0.0),
                mem: parts[3].parse().unwrap_or(0.0),
                command: parts[10..].join(" "),
            });
        }
    }

    Ok(processes)
}

/// 终止进程
#[tauri::command]
pub async fn ssh_monitor_kill_process(
    connection_id: String,
    pid: u32,
) -> Result<(), String> {
    let conn = crate::ssh::session::SSH_MANAGER
        .get_connection(&connection_id)
        .await
        .ok_or("连接不存在")?;

    let mut channel = conn.session.channel_session()
        .map_err(|e| format!("创建通道失败: {}", e))?;

    channel.exec(&format!("kill -9 {}", pid))
        .map_err(|e| format!("执行命令失败: {}", e))?;

    channel.close().ok();

    Ok(())
}

/// Docker容器列表
#[derive(Debug, Clone, serde::Serialize)]
pub struct DockerContainer {
    pub name: String,
    pub image: String,
    pub status: String,
}

#[tauri::command]
pub async fn ssh_docker_list(
    connection_id: String,
) -> Result<Vec<DockerContainer>, String> {
    let conn = crate::ssh::session::SSH_MANAGER
        .get_connection(&connection_id)
        .await
        .ok_or("连接不存在")?;

    let mut channel = conn.session.channel_session()
        .map_err(|e| format!("创建通道失败: {}", e))?;

    channel.exec("docker ps --format '{{.Names}}|{{.Image}}|{{.Status}}' 2>/dev/null || echo ''")
        .map_err(|e| format!("执行命令失败: {}", e))?;

    let mut output = String::new();
    use std::io::Read;
    channel.read_to_string(&mut output).ok();
    channel.close().ok();

    let mut containers = Vec::new();
    for line in output.lines() {
        let parts: Vec<&str> = line.split('|').collect();
        if parts.len() >= 3 {
            containers.push(DockerContainer {
                name: parts[0].to_string(),
                image: parts[1].to_string(),
                status: parts[2].to_string(),
            });
        }
    }

    Ok(containers)
}
