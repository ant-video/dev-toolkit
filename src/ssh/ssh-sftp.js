// src/ssh/ssh-sftp.js

class SftpManager {
    constructor(container, connectionId) {
        this.container = container;
        this.connectionId = connectionId;
        this.localPath = '/';
        this.remotePath = '/';
        this.localFiles = [];
        this.remoteFiles = [];
        this.selectedLocal = null;
        this.selectedRemote = null;

        this.init();
    }

    // 获取 Tauri invoke 函数（兼容 Tauri 1.x 和 2.x）
    getTauriInvoke() {
        if (window.__TAURI__?.core?.invoke) {
            return window.__TAURI__.core.invoke;  // Tauri 2.x
        } else if (window.__TAURI__?.invoke) {
            return window.__TAURI__.invoke;  // Tauri 1.x
        }
        return null;
    }

    init() {
        this.render();
        this.bindEvents();
        this.loadRemoteFiles('/');
    }

    render() {
        this.container.innerHTML = `
            <div class="ssh-sftp-container">
                <div class="ssh-sftp-pane" id="sftp-local-pane">
                    <div class="ssh-sftp-header">
                        <span>📁 本地</span>
                        <input type="text" class="ssh-sftp-path" id="sftp-local-path" value="${this.localPath}">
                        <button class="ssh-btn ssh-btn-secondary" onclick="window.sftpManager?.goLocalParent()">⬆️</button>
                        <button class="ssh-btn ssh-btn-secondary" onclick="window.sftpManager?.refreshLocal()">🔄</button>
                    </div>
                    <div class="ssh-sftp-filelist" id="sftp-local-list"></div>
                </div>
                <div class="ssh-sftp-pane" id="sftp-remote-pane">
                    <div class="ssh-sftp-header">
                        <span>🌐 远程</span>
                        <input type="text" class="ssh-sftp-path" id="sftp-remote-path" value="${this.remotePath}">
                        <button class="ssh-btn ssh-btn-secondary" onclick="window.sftpManager?.goRemoteParent()">⬆️</button>
                        <button class="ssh-btn ssh-btn-secondary" onclick="window.sftpManager?.refreshRemote()">🔄</button>
                    </div>
                    <div class="ssh-sftp-filelist" id="sftp-remote-list"></div>
                </div>
            </div>
            <div class="ssh-transfer-queue" id="transfer-queue"></div>
        `;
    }

    bindEvents() {
        const localPathInput = document.getElementById('sftp-local-path');
        const remotePathInput = document.getElementById('sftp-remote-path');

        if (localPathInput) {
            localPathInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') {
                    this.localPath = e.target.value;
                    this.loadLocalFiles();
                }
            });
        }

        if (remotePathInput) {
            remotePathInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') {
                    this.remotePath = e.target.value;
                    this.loadRemoteFiles(this.remotePath);
                }
            });
        }

        const remoteList = document.getElementById('sftp-remote-list');
        if (remoteList) {
            remoteList.addEventListener('dragover', (e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'copy';
            });
            remoteList.addEventListener('drop', (e) => {
                e.preventDefault();
                const files = e.dataTransfer.files;
                for (const file of files) {
                    this.uploadFile(file.path, this.remotePath + '/' + file.name);
                }
            });
        }
    }

    async loadRemoteFiles(path) {
        const invoke = this.getTauriInvoke();
        if (!invoke) return;

        try {
            const files = await invoke('ssh_sftp_list_dir', {
                connectionId: this.connectionId,
                path: path
            });
            this.remoteFiles = files;
            this.remotePath = path;
            const pathInput = document.getElementById('sftp-remote-path');
            if (pathInput) pathInput.value = path;
            this.renderRemoteFiles();
        } catch (e) {
            SSHUtils.showToast('加载远程目录失败: ' + e, 'error');
        }
    }

    renderRemoteFiles() {
        const list = document.getElementById('sftp-remote-list');
        if (!list) return;

        list.innerHTML = this.remoteFiles.map(file => `
            <div class="ssh-sftp-item ${this.selectedRemote === file.path ? 'selected' : ''}"
                 data-path="${file.path}" data-is-dir="${file.is_dir}">
                <span class="ssh-sftp-item-icon">${SSHUtils.getFileIcon(file.name, file.is_dir)}</span>
                <span class="ssh-sftp-item-name">${file.name}</span>
                <span class="ssh-sftp-item-size">${file.is_dir ? '' : SSHUtils.formatSize(file.size)}</span>
                <span class="ssh-sftp-item-date">${file.modified}</span>
            </div>
        `).join('');

        list.querySelectorAll('.ssh-sftp-item').forEach(item => {
            item.addEventListener('click', () => {
                this.selectedRemote = item.dataset.path;
                this.renderRemoteFiles();
            });
            item.addEventListener('dblclick', () => {
                if (item.dataset.isDir === 'true') {
                    this.loadRemoteFiles(item.dataset.path);
                } else {
                    this.openRemoteFile(item.dataset.path);
                }
            });
        });
    }

    async openRemoteFile(path) {
        const invoke = this.getTauriInvoke();
        if (!invoke) return;

        try {
            const content = await invoke('ssh_sftp_read_file', {
                connectionId: this.connectionId,
                path: path
            });

            window.dispatchEvent(new CustomEvent('ssh-edit-file', {
                detail: { path, content, connectionId: this.connectionId }
            }));
        } catch (e) {
            SSHUtils.showToast('打开文件失败: ' + e, 'error');
        }
    }

    async uploadFile(localPath, remotePath) {
        SSHUtils.showToast('上传功能开发中...', 'info');
    }

    async downloadFile(remotePath, localPath) {
        SSHUtils.showToast('下载功能开发中...', 'info');
    }

    goRemoteParent() {
        const parts = this.remotePath.split('/').filter(p => p);
        parts.pop();
        const parent = parts.length === 0 ? '/' : '/' + parts.join('/');
        this.loadRemoteFiles(parent);
    }

    refreshRemote() {
        this.loadRemoteFiles(this.remotePath);
    }

    goLocalParent() {}
    refreshLocal() {}
    loadLocalFiles() {}
}

window.SftpManager = SftpManager;
