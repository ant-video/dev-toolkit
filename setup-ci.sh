#!/bin/bash
# Setup GitHub Actions CI for DevToolkit
# Run this script after cloning the repo
# Requires: gh CLI with 'workflow' scope

echo "🔧 Setting up GitHub Actions CI..."

mkdir -p .github/workflows

cat > .github/workflows/build.yml << 'EOF'
name: Build & Release

on:
  push:
    tags:
      - 'v*'
  workflow_dispatch:

jobs:
  build:
    strategy:
      fail-fast: false
      matrix:
        include:
          - platform: macos-latest
            args: '--target aarch64-apple-darwin'
            label: macos-arm64
          - platform: macos-latest
            args: '--target x86_64-apple-darwin'
            label: macos-x64
          - platform: windows-latest
            args: ''
            label: windows-x64
          - platform: ubuntu-22.04
            args: ''
            label: linux-x64

    runs-on: ${{ matrix.platform }}
    name: Build ${{ matrix.label }}

    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 22

      - name: Install Rust stable
        uses: dtolnay/rust-toolchain@stable
        with:
          targets: ${{ matrix.platform == 'macos-latest' && 'aarch64-apple-darwin,x86_64-apple-darwin' || '' }}

      - name: Install dependencies (Ubuntu)
        if: matrix.platform == 'ubuntu-22.04'
        run: |
          sudo apt-get update
          sudo apt-get install -y libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf

      - name: Install frontend dependencies
        run: npm install

      - name: Build Tauri app
        uses: tauri-apps/tauri-action@v0
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        with:
          tagName: ${{ github.ref_name }}
          releaseName: 'DevToolkit ${{ github.ref_name }}'
          releaseBody: '程序员工具集桌面应用'
          releaseDraft: true
          prerelease: false
          args: ${{ matrix.args }}

      - name: Upload artifacts
        uses: actions/upload-artifact@v4
        with:
          name: DevToolkit-${{ matrix.label }}
          path: |
            src-tauri/target/release/bundle/dmg/*
            src-tauri/target/release/bundle/msi/*
            src-tauri/target/release/bundle/nsis/*
            src-tauri/target/release/bundle/deb/*
            src-tauri/target/release/bundle/appimage/*
            src-tauri/target/aarch64-apple-darwin/release/bundle/dmg/*
            src-tauri/target/aarch64-apple-darwin/release/bundle/macos/*
            src-tauri/target/x86_64-apple-darwin/release/bundle/dmg/*
            src-tauri/target/x86_64-apple-darwin/release/bundle/macos/*
          if-no-files-found: ignore
EOF

echo "✅ .github/workflows/build.yml created"
echo ""
echo "Now commit and push:"
echo "  git add .github/workflows/build.yml"
echo "  git commit -m 'ci: add cross-platform build workflow'"
echo "  git push"
echo ""
echo "Or if you have gh CLI with workflow scope:"
git add .github/workflows/build.yml 2>/dev/null
if command -v gh &> /dev/null; then
    echo "  Detected gh CLI — attempting to push via API..."
    BRANCH=$(git branch --show-current)
    CONTENT=$(base64 -i .github/workflows/build.yml | tr -d '\n')
    gh api repos/$(gh repo view --json nameWithOwner -q .nameWithOwner)/contents/.github/workflows/build.yml \
      -X PUT \
      -f message="ci: add cross-platform build workflow" \
      -f content="$CONTENT" \
      -f branch="$BRANCH" 2>/dev/null && echo "✅ Pushed!" || echo "⚠️  API push failed (needs workflow scope). Use git push instead."
fi
