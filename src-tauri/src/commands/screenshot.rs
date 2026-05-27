use super::*;
use base64::Engine;

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
        // 使用 macOS 原生 API CGPreflightScreenCaptureAccess() 检测权限
        // 该 API 在 macOS 10.15+ 可用，直接查询 app 的屏幕录制授权状态
        unsafe {
            extern "C" {
                fn CGPreflightScreenCaptureAccess() -> bool;
                fn CGRequestScreenCaptureAccess() -> bool;
            }

            let has_access = CGPreflightScreenCaptureAccess();
            if has_access {
                return ScreenCapturePermissionResult {
                    has_permission: true,
                    message: "屏幕录制权限已授权".to_string(),
                };
            }

            // 尝试请求权限（会弹出系统权限对话框）
            let requested = CGRequestScreenCaptureAccess();
            if requested {
                return ScreenCapturePermissionResult {
                    has_permission: true,
                    message: "屏幕录制权限已授权".to_string(),
                };
            }

            ScreenCapturePermissionResult {
                has_permission: false,
                message: "缺少屏幕录制权限！请在「系统设置 > 隐私与安全性 > 屏幕录制」中授权 DevToolkit，然后重启应用。".to_string(),
            }
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
