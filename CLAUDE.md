# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

DevToolkit is a cross-platform desktop app (Tauri 2.0 + Rust + vanilla JS + CodeMirror 5) that bundles 40+ developer utilities (timestamp, JSON, diff, regex, encoding, crypto, etc.) into a single offline-first interface.

## Build & Dev Commands

```bash
npm install          # Install JS deps
npx tauri dev        # Dev mode with hot reload
npx tauri build      # Production build
./build.sh           # Local build script (--macos, --linux, --windows, --clean, --debug)
```

Build artifacts: `src-tauri/target/*/release/bundle/`

## Architecture

**Two-layer architecture**: Frontend (HTML/CSS/JS) communicates with Rust backend exclusively via Tauri IPC (`invoke()`).

### Frontend (`src/`)
- `index.html` — Single-page app, all tool pages as `<section>` elements toggled by `.active` class
- `app.js` — All frontend logic: navigation, CodeMirror instance management, tool handlers, search bar, drag resize, sidebar toggle
- `styles.css` — Dracula dark theme, layout, diff highlighting colors
- `screenshot-editor.html` — Standalone screenshot editor window
- `codemirror/` — Bundled CodeMirror 5 minified files (core + plugins: brace-fold, search, matchbrackets, etc.)

**Key frontend patterns**:
- All CodeMirror instances stored in a global `editors` object, refreshed on page switch
- Tool pages identified by `data-page` attribute on nav items, matched to `id="page-{name}"` sections
- Custom persistent search bar (not CodeMirror's built-in dialog) — stays visible until manually closed
- Editor resize via JS mousedown/mousemove on drag handle, not CSS resize

### Backend (`src-tauri/src/`)
- `commands.rs` — All 40+ `#[tauri::command]` functions (~2267 lines). Each tool is one or more commands returning typed Result structs
- `lib.rs` — Tauri builder setup: command registration, global shortcut (⌘⇧S for screenshot), plugin init
- `main.rs` — Entry point, calls `dev_toolkit_lib::run()`

**Command return pattern**: Commands return `Result<T, String>` where T is a serde-serializable struct (e.g., `TimeConvertResult`, `JsonResult { success, result, error }`).

### IPC Flow
```
CodeMirror.getValue() → invoke('command_name', { params }) → Rust #[tauri::command] → Result → CodeMirror.setValue()
```

## Adding a New Tool

1. Add `#[tauri::command]` function(s) in `commands.rs` with input params and return struct
2. Register command(s) in `lib.rs`'s `invoke_handler` macro
3. Add nav item with `data-page="tool-name"` in `index.html`
4. Add `<section id="page-tool-name" class="page">` with input/output CodeMirror editors in `index.html`
5. Add JS handler in `app.js` that calls `invoke()` and updates the output editor
6. Add styles in `styles.css` if needed

## Key Design Decisions

- **No framework**: Vanilla JS, no React/Vue. All state managed in DOM and global `editors` object
- **CodeMirror 5** (not 6): Bundled as minified files, not npm packages
- **Offline-first**: No network requests. All computation in Rust backend
- **Global Tauri API**: `withGlobalTauri: true` in tauri.conf.json, so `window.__TAURI__` is available (no JS-side import)
- **Diff algorithm**: LCS-based in Rust, with frontend word-level highlighting. Degrades to simple line compare when >5000 lines
- **AES-256-GCM**: PBKDF2 key derivation, random 12-byte nonce, Base64 output format `nonce + ciphertext + tag`
