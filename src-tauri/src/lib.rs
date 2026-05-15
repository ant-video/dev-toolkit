mod commands;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            // 时间转换
            commands::timestamp_now,
            commands::timestamp_to_date,
            commands::date_to_timestamp,
            // JSON 工具
            commands::json_format,
            commands::json_minify,
            commands::json_validate,
            commands::json_unescape,
            commands::text_diff,
            // 编解码
            commands::base64_encode,
            commands::base64_decode,
            commands::url_encode,
            commands::url_decode,
            commands::unicode_encode,
            commands::unicode_decode,
            commands::html_encode,
            commands::html_decode,
            // 加解密
            commands::md5_hash,
            commands::sha1_hash,
            commands::sha256_hash,
            commands::sha512_hash,
            commands::hmac_sha256,
            commands::aes_encrypt,
            commands::aes_decrypt,
            // 进制转换
            commands::base_convert,
            // 正则测试
            commands::regex_test,
            // JWT 解码
            commands::jwt_decode,
            // URL 解析
            commands::url_parse,
            // 颜色转换
            commands::color_convert,
            // 文本统计
            commands::text_stats,
            // 生成工具
            commands::uuid_generate,
            commands::password_generate,
            // YAML/JSON 互转
            commands::yaml_to_json,
            commands::json_to_yaml,
            // XML 格式化
            commands::xml_format,
            commands::xml_minify,
            // 文本大小写/命名转换
            commands::text_case_convert,
            // CSS 单位转换
            commands::css_unit_convert,
            // Cron 表达式解析
            commands::cron_parse,
            // 文本处理
            commands::text_deduplicate,
            commands::text_sort,
            commands::text_trim_lines,
            // Lorem Ipsum 生成器
            commands::lorem_generate,
            // MIME 类型查询
            commands::mime_lookup,
            // 数字格式化
            commands::number_format,
            // 图片 Base64 互转
            commands::image_to_base64,
            commands::base64_to_image,
            // 截图工具
            commands::screenshot_window,
            commands::crop_image,
            commands::save_image,
            commands::open_save_dialog,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
