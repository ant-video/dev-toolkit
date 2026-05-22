mod commands;
mod database;
mod ssh;

use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // macOS: ⌘⇧S (Cmd+Shift+S), Windows/Linux: Ctrl+Shift+S
    // 注意: macOS 上 CONTROL=⌃Ctrl, SUPER=⌘Cmd
    let mods = if cfg!(target_os = "macos") {
        Modifiers::SUPER | Modifiers::SHIFT
    } else {
        Modifiers::CONTROL | Modifiers::SHIFT
    };
    let shortcut = Shortcut::new(Some(mods), Code::KeyS);

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(move |app, _shortcut, event| {
                    if event.state == tauri_plugin_global_shortcut::ShortcutState::Pressed {
                        let app_clone = app.clone();
                        tauri::async_runtime::spawn(async move {
                            // 快捷键默认使用选择模式（交互式选择区域）
                            let _ = commands::trigger_screenshot(
                                app_clone,
                                "selection".to_string(),
                                Some(false),
                            )
                            .await;
                        });
                    }
                })
                .build(),
        )
        .manage(commands::ScreenshotState::default())
        .manage(database::ConnectionPoolManager::new())
        .manage(database::QueryRegistry::new())
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
            // QR 码工具
            commands::qr_generate,
            commands::qr_decode,
            commands::read_clipboard_image,
            // HTTP 请求工具
            commands::http_request,
            commands::http_save_history,
            commands::http_load_history,
            commands::http_save_favorites,
            commands::http_load_favorites,
            commands::http_save_folders,
            commands::http_load_folders,
            // 翻译工具
            commands::translate,
            commands::open_translate_webview,
            // 截图工具（旧，保留兼容）
            commands::screenshot_window,
            commands::crop_image,
            commands::save_image,
            commands::open_save_dialog,
            commands::system_screenshot,
            // 截图编辑器
            commands::check_screen_capture_permission,
            commands::get_screenshot_data,
            commands::save_screenshot_file,
            commands::copy_screenshot_to_clipboard,
            commands::trigger_screenshot,
            commands::close_current_window,
            // 共享命令
            commands::set_screenshot_data,
            commands::open_screenshot_editor,
            // 数据库工具
            database::commands::db_test_connection,
            database::commands::db_save_connection,
            database::commands::db_list_connections,
            database::commands::db_delete_connection,
            database::commands::db_connect,
            database::commands::db_disconnect,
            database::commands::db_query,
            database::commands::db_execute,
            database::commands::db_cancel_query,
            database::commands::db_get_databases,
            database::commands::db_get_tables,
            database::commands::db_get_table_schema,
            database::commands::db_get_foreign_keys,
            database::commands::db_open_sql_file,
            database::commands::db_open_csv_file,
            database::commands::db_save_file,
            // SSH会话管理
            commands::ssh_list_sessions,
            commands::ssh_save_session,
            commands::ssh_delete_session,
            commands::ssh_get_groups,
            commands::ssh_import_sessions,
            commands::ssh_export_sessions,
            // SSH连接管理
            commands::ssh_connect,
            commands::ssh_disconnect,
            commands::ssh_create_pty,
            commands::ssh_resize_pty,
            commands::ssh_write,
            // SFTP操作
            commands::ssh_sftp_list_dir,
            commands::ssh_sftp_read_file,
            commands::ssh_sftp_write_file,
            commands::ssh_sftp_mkdir,
            commands::ssh_sftp_remove,
            // 系统监控
            commands::ssh_monitor_data,
            commands::ssh_monitor_processes,
            commands::ssh_monitor_kill_process,
            commands::ssh_docker_list,
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
