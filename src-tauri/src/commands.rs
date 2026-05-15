use serde::{Deserialize, Serialize};
use base64::Engine;
use digest::Digest;
use chrono::TimeZone;

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

// ==================== JSON 去转义 ====================
#[tauri::command]
pub fn json_unescape(input: String) -> JsonResult {
    let trimmed = input.trim();
    // Try to parse as a JSON string first (e.g. "hello\\nworld")
    if trimmed.starts_with('"') {
        match serde_json::from_str::<serde_json::Value>(trimmed) {
            Ok(serde_json::Value::String(s)) => {
                // It's a valid JSON string, the deserialized value is the unescaped version
                JsonResult { success: true, result: s, error: None }
            }
            Ok(_) => {
                // It's a JSON value but not a string - format it prettily
                let result = serde_json::to_string_pretty(&serde_json::from_str::<serde_json::Value>(trimmed).unwrap()).unwrap_or_default();
                JsonResult { success: true, result, error: None }
            }
            Err(e) => JsonResult { success: false, result: input, error: Some(format!("JSON 解析失败: {}", e)) }
        }
    } else {
        // Not a quoted JSON string - try to unescape common escape sequences
        // Or try to parse as JSON value (e.g. already a JSON object/array)
        match serde_json::from_str::<serde_json::Value>(trimmed) {
            Ok(val) => {
                let result = serde_json::to_string_pretty(&val).unwrap_or_default();
                JsonResult { success: true, result, error: None }
            }
            Err(_) => {
                // Try treating as a double-escaped JSON string
                // e.g. "{\"key\":\"value\"}" -> {"key":"value"}
                let double_quoted = format!("\"{}\"", trimmed.replace('\\', "\\\\").replace('"', "\\\""));
                match serde_json::from_str::<serde_json::Value>(&double_quoted) {
                    Ok(serde_json::Value::String(s)) => {
                        // Now s is the unescaped version, try to format it as JSON
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
    pub diff_type: String, // "same", "add", "del", "change"
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

    // Simple LCS-based line diff
    let llen = left_lines.len();
    let rlen = right_lines.len();

    // For very large inputs, fall back to simple comparison
    if llen > 5000 || rlen > 5000 {
        return simple_diff(&left_lines, &right_lines);
    }

    // Build LCS table
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

    // Backtrack to find diff
    let mut left_result: Vec<DiffLine> = Vec::new();
    let mut right_result: Vec<DiffLine> = Vec::new();
    let mut i = llen;
    let mut j = rlen;
    let mut ops: Vec<(String, usize, usize)> = Vec::new(); // (op, left_idx, right_idx)

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

    // Group consecutive del+add as "change"
    let mut idx = 0;
    while idx < ops.len() {
        if ops[idx].0 == "del" {
            // Collect consecutive dels
            let mut dels = Vec::new();
            while idx < ops.len() && ops[idx].0 == "del" {
                dels.push(ops[idx].1);
                idx += 1;
            }
            // Collect consecutive adds
            let mut adds = Vec::new();
            while idx < ops.len() && ops[idx].0 == "add" {
                adds.push(ops[idx].2);
                idx += 1;
            }
            // Pair them as changes, extras as del/add
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

// AES-256-GCM 加解密
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
