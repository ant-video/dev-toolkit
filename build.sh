#!/bin/bash
# DevToolkit 本地编译打包脚本
# 使用方法: ./build.sh [选项]
#   --macos   仅构建 macOS (dmg + app)
#   --linux   仅构建 Linux (deb + rpm)
#   --windows 仅构建 Windows (msi + nsis)
#   --all     构建所有可用平台 (默认)
#   --clean   构建前清理
#   --release 发布版本构建 (默认)

set -e

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$PROJECT_DIR"

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

log_info()  { echo -e "${BLUE}[INFO]${NC} $1"; }
log_ok()    { echo -e "${GREEN}[OK]${NC}   $1"; }
log_warn()  { echo -e "${YELLOW}[WARN]${NC}  $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

# 检测当前平台
detect_platform() {
    case "$(uname -s)" in
        Darwin*)   echo "macos" ;;
        Linux*)    echo "linux" ;;
        CYGWIN*|MINGW*|MSYS*) echo "windows" ;;
        *)         echo "unknown" ;;
    esac
}

CURRENT_PLATFORM=$(detect_platform)
log_info "当前平台: $CURRENT_PLATFORM"

# 检查依赖
check_dependencies() {
    log_info "检查依赖..."

    # Node.js
    if ! command -v node &> /dev/null; then
        log_error "未找到 Node.js，请先安装 Node.js 18+"
        exit 1
    fi
    NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
    if [ "$NODE_VERSION" -lt 18 ]; then
        log_error "Node.js 版本过低 (当前: $(node -v)，需要 18+)"
        exit 1
    fi
    log_ok "Node.js: $(node -v)"

    # npm
    if ! command -v npm &> /dev/null; then
        log_error "未找到 npm"
        exit 1
    fi
    log_ok "npm: $(npm -v)"

    # Rust (Tauri 必需)
    if ! command -v cargo &> /dev/null; then
        log_error "未找到 Rust/Cargo，请先安装 Rust: https://rustup.rs"
        exit 1
    fi
    log_ok "Rust: $(rustc --version | cut -d' ' -f2)"

    # Tauri CLI
    if ! command -v tauri &> /dev/null; then
        log_info "未找到 Tauri CLI，将使用 npx 运行..."
        USE_NPX=true
    else
        log_ok "Tauri CLI: $(tauri --version 2>/dev/null | head -1)"
        USE_NPX=false
    fi

    # 平台特定依赖
    case "$CURRENT_PLATFORM" in
        macos)
            if ! command -v xcodebuild &> /dev/null; then
                log_warn "未找到 Xcode，macOS 构建可能失败"
            else
                log_ok "Xcode: 已安装"
            fi
            ;;
        linux)
            # 检查 webkit2gtk
            if ! pkg-config --exists webkit2gtk-4.1 2>/dev/null; then
                log_warn "未找到 webkit2gtk-4.1，Linux 构建可能失败"
                log_warn "Ubuntu/Debian: sudo apt install libwebkit2gtk-4.1-dev"
                log_warn "Fedora: sudo dnf install webkit2gtk4.1-devel"
            else
                log_ok "webkit2gtk-4.1: 已安装"
            fi
            ;;
    esac

    log_ok "依赖检查通过"
}

# 安装前端依赖
install_deps() {
    log_info "安装前端依赖..."
    if [ -f "package-lock.json" ]; then
        npm ci
    else
        npm install
    fi
    log_ok "前端依赖安装完成"
}

# 清理构建
clean_build() {
    log_info "清理构建目录..."
    rm -rf src-tauri/target
    rm -rf node_modules/.cache
    log_ok "清理完成"
}

# 构建 macOS
build_macos() {
    log_info "=========================================="
    log_info "  构建 macOS (Intel + Apple Silicon)"
    log_info "=========================================="

    # 构建 Universal Binary (Intel + ARM)
    log_info "构建 Universal Binary..."
    if [ "$USE_NPX" = true ]; then
        npx tauri build --target universal-apple-darwin
    else
        tauri build --target universal-apple-darwin
    fi

    # 输出位置
    BUNDLE_DIR="src-tauri/target/universal-apple-darwin/release/bundle"
    if [ -d "$BUNDLE_DIR" ]; then
        log_ok "macOS 应用: $BUNDLE_DIR/macos/DevToolkit.app"
        log_ok "DMG 安装包: $BUNDLE_DIR/dmg/DevToolkit_*.dmg"
    else
        # 可能只构建了单一架构
        for target in aarch64-apple-darwin x86_64-apple-darwin; do
            if [ -d "src-tauri/target/$target/release/bundle" ]; then
                log_ok "macOS 应用: src-tauri/target/$target/release/bundle/macos/DevToolkit.app"
                log_ok "DMG 安装包: src-tauri/target/$target/release/bundle/dmg/DevToolkit_*.dmg"
            fi
        done
    fi
}

# 构建 Linux
build_linux() {
    log_info "=========================================="
    log_info "  构建 Linux (deb + rpm)"
    log_info "=========================================="

    if [ "$USE_NPX" = true ]; then
        npx tauri build
    else
        tauri build
    fi

    BUNDLE_DIR="src-tauri/target/release/bundle"
    if [ -d "$BUNDLE_DIR" ]; then
        log_ok "DEB 安装包: $BUNDLE_DIR/deb/*.deb"
        log_ok "RPM 安装包: $BUNDLE_DIR/rpm/*.rpm"
    fi
}

# 构建 Windows
build_windows() {
    log_info "=========================================="
    log_info "  构建 Windows (msi + nsis)"
    log_info "=========================================="

    if [ "$USE_NPX" = true ]; then
        npx tauri build
    else
        tauri build
    fi

    BUNDLE_DIR="src-tauri/target/release/bundle"
    if [ -d "$BUNDLE_DIR" ]; then
        log_ok "MSI 安装包: $BUNDLE_DIR/msi/*.msi"
        log_ok "NSIS 安装包: $BUNDLE_DIR/nsis/*.exe"
    fi
}

# 主逻辑
CLEAN=false
RELEASE=true
TARGET_PLATFORMS=()

while [[ $# -gt 0 ]]; do
    case $1 in
        --clean)
            CLEAN=true
            shift
            ;;
        --release)
            RELEASE=true
            shift
            ;;
        --debug)
            RELEASE=false
            shift
            ;;
        --macos)
            TARGET_PLATFORMS=("macos")
            shift
            ;;
        --linux)
            TARGET_PLATFORMS=("linux")
            shift
            ;;
        --windows)
            TARGET_PLATFORMS=("windows")
            shift
            ;;
        --all)
            TARGET_PLATFORMS=("all")
            shift
            ;;
        -h|--help)
            echo "用法: $0 [选项]"
            echo ""
            echo "选项:"
            echo "  --macos    仅构建 macOS"
            echo "  --linux    仅构建 Linux"
            echo "  --windows  仅构建 Windows"
            echo "  --all      构建所有可用平台 (默认)"
            echo "  --clean    构建前清理"
            echo "  --release  发布版本构建 (默认)"
            echo "  --debug    调试版本构建"
            echo "  -h, --help 显示帮助"
            exit 0
            ;;
        *)
            log_error "未知选项: $1"
            exit 1
            ;;
    esac
done

# 确定要构建的平台
if [ ${#TARGET_PLATFORMS[@]} -eq 0 ]; then
    case "$CURRENT_PLATFORM" in
        macos)  TARGET_PLATFORMS=("macos") ;;
        linux)  TARGET_PLATFORMS=("linux") ;;
        windows) TARGET_PLATFORMS=("windows") ;;
        *)      TARGET_PLATFORMS=("all") ;;
    esac
fi

# 执行构建
echo ""
echo "╔══════════════════════════════════════╗"
echo "║     DevToolkit 本地编译打包脚本       ║"
echo "║     版本: 1.0.0                      ║"
echo "╚══════════════════════════════════════╝"
echo ""

check_dependencies

if [ "$CLEAN" = true ]; then
    clean_build
fi

install_deps

echo ""
log_info "开始构建..."
echo ""

for platform in "${TARGET_PLATFORMS[@]}"; do
    case "$platform" in
        all)
            case "$CURRENT_PLATFORM" in
                macos)   build_macos ;;
                linux)   build_linux ;;
                windows) build_windows ;;
            esac
            ;;
        macos)
            if [ "$CURRENT_PLATFORM" != "macos" ]; then
                log_warn "当前不是 macOS 平台，跳过 macOS 构建"
            else
                build_macos
            fi
            ;;
        linux)
            if [ "$CURRENT_PLATFORM" != "linux" ]; then
                log_warn "当前不是 Linux 平台，跳过 Linux 构建"
            else
                build_linux
            fi
            ;;
        windows)
            if [ "$CURRENT_PLATFORM" != "windows" ]; then
                log_warn "当前不是 Windows 平台，跳过 Windows 构建"
            else
                build_windows
            fi
            ;;
    esac
    echo ""
done

echo ""
echo "╔══════════════════════════════════════╗"
echo "║           构建完成!                  ║"
echo "╚══════════════════════════════════════╝"
echo ""
log_info "产物位置:"
log_info "  macOS: src-tauri/target/*/release/bundle/dmg/*.dmg"
log_info "  Linux: src-tauri/target/release/bundle/{deb,rpm}/*"
log_info "  Windows: src-tauri/target/release/bundle/{msi,nsis}/*"
echo ""
