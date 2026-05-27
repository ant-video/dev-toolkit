fn main() {
    // macOS: 链接 CoreGraphics 框架（用于屏幕录制权限检测 API）
    #[cfg(target_os = "macos")]
    println!("cargo:rustc-link-lib=framework=CoreGraphics");

    tauri_build::build()
}
