mod commands;

use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // macOS: Cmd+Shift+S, Windows: Ctrl+Shift+S, Linux: Ctrl+Shift+S
    // 避免在 Windows 上使用 Win 键（与系统快捷键冲突，如 Win+Shift+S）
    let shortcut = Shortcut::new(
        Some(Modifiers::CONTROL | Modifiers::SHIFT),
        Code::KeyS,
    );
    let _shortcut_for_compare = shortcut.clone();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(move |app, _shortcut, event| {
                    if event.state == tauri_plugin_global_shortcut::ShortcutState::Pressed {
                        let app_clone = app.clone();
                        tauri::async_runtime::spawn(async move {
                            let _ = commands::trigger_screenshot(app_clone).await;
                        });
                    }
                })
                .build(),
        )
        .manage(commands::ScreenshotState::default())
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
            // 截图工具（旧，保留兼容）
            commands::screenshot_window,
            commands::crop_image,
            commands::save_image,
            commands::open_save_dialog,
            commands::system_screenshot,
            // 截图编辑器
            commands::get_screenshot_data,
            commands::save_screenshot_file,
            commands::copy_screenshot_to_clipboard,
            commands::trigger_screenshot,
            commands::close_current_window,
        ])
        .setup(move |app| {
            let gs = app.global_shortcut();
            gs.register(shortcut.clone())
                .map_err(|e| format!("注册快捷键失败: {}", e))?;

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
