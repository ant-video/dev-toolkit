// src/ssh/ssh-sftp.js

class SftpManager {
    constructor(container, connectionId) {
        this.container = container;
        this.connectionId = connectionId;
        this.localPath = '/';
        this.remotePath = '.';
        this.localFiles = [];
        this.remoteFiles = [];
        this.selectedLocal = null;
        this.selectedRemote = null;

        this.init();
        window.sftpManager = this;
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

    async init() {
        this.render();
        this.bindEvents();
        // 初始化本地目录为主目录
        const invoke = this.getTauriInvoke();
        if (invoke) {
            try {
                const home = await invoke('ssh_local_home_dir');
                this.localPath = home;
            } catch (e) {
                // 使用根目录
                try {
                    const roots = await invoke('ssh_local_root_dirs');
                    if (roots && roots.length > 0) {
                        this.localPath = roots[0].path;
                    }
                } catch (e2) {
                    console.error('获取根目录失败:', e2);
                }
            }
            this.loadLocalFiles();
        }
        this.loadRemoteFiles('.');
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
                // 内部拖拽（从本地面板拖入）
                const localPath = e.dataTransfer.getData('local-path');
                if (localPath) {
                    const fileName = localPath.split(/[/\\]/).pop();
                    this.uploadFile(localPath, this.remotePath + '/' + fileName);
                    return;
                }
                // 浏览器文件拖入
                const files = e.dataTransfer.files;
                for (const file of files) {
                    this.uploadFile(file.path, this.remotePath + '/' + file.name);
                }
            });
        }

    }

    async loadLocalFiles() {
        const invoke = this.getTauriInvoke();
        if (!invoke) return;

        try {
            const files = await invoke('ssh_local_list_dir', { path: this.localPath });
            this.localFiles = files;
            const pathInput = document.getElementById('sftp-local-path');
            if (pathInput) pathInput.value = this.localPath;
            this.renderLocalFiles();
        } catch (e) {
            SSHUtils.showToast('加载本地目录失败: ' + e, 'error');
        }
    }

    renderLocalFiles() {
        const list = document.getElementById('sftp-local-list');
        if (!list) return;

        list.innerHTML = this.localFiles.map(file => `
            <div class="ssh-sftp-item ${this.selectedLocal === file.path ? 'selected' : ''}"
                 data-path="${file.path}" data-is-dir="${file.is_dir}" draggable="true">
                <span class="ssh-sftp-item-icon">${SSHUtils.getFileIcon(file.name, file.is_dir)}</span>
                <span class="ssh-sftp-item-name">${file.name}</span>
                <span class="ssh-sftp-item-size">${file.is_dir ? '' : SSHUtils.formatSize(file.size)}</span>
                <span class="ssh-sftp-item-date">${file.modified}</span>
                ${!file.is_dir ? `<button class="ssh-sftp-action-btn" data-action="upload" data-path="${file.path}" title="上传">⬆️</button>` : ''}
            </div>
        `).join('');

        list.querySelectorAll('.ssh-sftp-item').forEach(item => {
            item.addEventListener('click', (e) => {
                if (e.target.classList.contains('ssh-sftp-action-btn')) return;
                this.selectedLocal = item.dataset.path;
                this.renderLocalFiles();
            });
            item.addEventListener('dblclick', () => {
                if (item.dataset.isDir === 'true') {
                    this.localPath = item.dataset.path;
                    this.loadLocalFiles();
                }
            });
            // 拖拽到远程
            item.addEventListener('dragstart', (e) => {
                e.dataTransfer.setData('local-path', item.dataset.path);
                e.dataTransfer.setData('is-dir', item.dataset.isDir);
            });
        });

        // 上传按钮
        list.querySelectorAll('.ssh-sftp-action-btn[data-action="upload"]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const localPath = btn.dataset.path;
                const fileName = localPath.split(/[/\\]/).pop();
                const remotePath = this.remotePath + '/' + fileName;
                this.uploadFile(localPath, remotePath);
            });
        });
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
                ${!file.is_dir ? `<button class="ssh-sftp-action-btn" data-action="download" data-path="${file.path}" title="下载">⬇️</button>` : ''}
            </div>
        `).join('');

        list.querySelectorAll('.ssh-sftp-item').forEach(item => {
            item.addEventListener('click', (e) => {
                if (e.target.classList.contains('ssh-sftp-action-btn')) return;
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

        // 下载按钮
        list.querySelectorAll('.ssh-sftp-action-btn[data-action="download"]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const remotePath = btn.dataset.path;
                const fileName = remotePath.split('/').pop();
                const localPath = this.localPath + '/' + fileName;
                this.downloadFile(remotePath, localPath);
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
        const invoke = this.getTauriInvoke();
        if (!invoke) return;

        // 显示进度
        this.showTransferProgress('upload', localPath, remotePath);

        try {
            await invoke('ssh_sftp_upload', {
                connectionId: this.connectionId,
                localPath: localPath,
                remotePath: remotePath
            });
            SSHUtils.showToast('上传完成: ' + remotePath, 'success');
            // 刷新远程目录
            this.loadRemoteFiles(this.remotePath);
        } catch (e) {
            SSHUtils.showToast('上传失败: ' + e, 'error');
        }
    }

    async downloadFile(remotePath, localPath) {
        const invoke = this.getTauriInvoke();
        if (!invoke) return;

        // 显示进度
        this.showTransferProgress('download', remotePath, localPath);

        try {
            await invoke('ssh_sftp_download', {
                connectionId: this.connectionId,
                remotePath: remotePath,
                localPath: localPath
            });
            SSHUtils.showToast('下载完成: ' + localPath, 'success');
            // 刷新本地目录
            this.loadLocalFiles();
        } catch (e) {
            SSHUtils.showToast('下载失败: ' + e, 'error');
        }
    }

    showTransferProgress(type, source, dest) {
        const queue = document.getElementById('transfer-queue');
        if (!queue) return;

        const id = 'transfer-' + Date.now();
        const html = `
            <div class="ssh-transfer-item" id="${id}">
                <div class="ssh-transfer-info">
                    <span>${type === 'upload' ? '⬆️' : '⬇️'} ${source.split('/').pop()}</span>
                    <span class="ssh-transfer-percent">0%</span>
                </div>
                <div class="ssh-transfer-bar">
                    <div class="ssh-transfer-progress" style="width: 0%"></div>
                </div>
            </div>
        `;
        queue.insertAdjacentHTML('beforeend', html);

        // 监听进度事件
        const event = window.__TAURI__?.event;
        if (event) {
            const unlisten = event.listen(`sftp-transfer-progress-${this.connectionId}`, (evt) => {
                const data = evt.payload;
                if (data.local_path === source || data.remote_path === source) {
                    const item = document.getElementById(id);
                    if (item) {
                        item.querySelector('.ssh-transfer-percent').textContent = data.percent + '%';
                        item.querySelector('.ssh-transfer-progress').style.width = data.percent + '%';
                    }
                }
            });

            event.listen(`sftp-transfer-complete-${this.connectionId}`, (evt) => {
                const data = evt.payload;
                if (data.local_path === source || data.remote_path === source) {
                    setTimeout(() => {
                        const item = document.getElementById(id);
                        if (item) item.remove();
                    }, 1000);
                    unlisten.then(fn => fn());
                }
            });
        }
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

    goLocalParent() {
        // 计算父目录
        const path = this.localPath.replace(/\\/g, '/');
        const parts = path.split('/').filter(p => p);
        parts.pop();
        let parent;
        if (parts.length === 0) {
            // Windows 根目录处理
            if (this.localPath.match(/^[A-Za-z]:\\/)) {
                parent = this.localPath.substring(0, 3);
            } else {
                parent = '/';
            }
        } else {
            parent = parts.join('/');
            if (!parent.match(/^[A-Za-z]:/)) {
                parent = '/' + parent;
            }
        }
        this.localPath = parent;
        this.loadLocalFiles();
    }

    refreshLocal() {
        this.loadLocalFiles();
    }
}

window.SftpManager = SftpManager;
