// src/ssh/ssh-main.js

class SshMain {
    constructor() {
        this.tabs = [];
        this.activeTab = null;
        this.connections = new Map();

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

    // 获取 Tauri event 模块（兼容 Tauri 1.x 和 2.x）
    getTauriEvent() {
        if (window.__TAURI__?.event) {
            return window.__TAURI__.event;  // Tauri 2.x
        } else if (window.__TAURI__?.event) {
            return window.__TAURI__.event;  // Tauri 1.x
        }
        return null;
    }

    // 检查 Tauri API 是否可用
    isTauriReady() {
        return this.getTauriInvoke() !== null;
    }

    async init() {
        // 等待 DOM 准备好
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => this.bindEvents());
        } else {
            this.bindEvents();
        }
    }

    bindEvents() {
        const quickConnectBtn = document.getElementById('ssh-quick-connect');
        if (quickConnectBtn) {
            quickConnectBtn.addEventListener('click', () => {
                this.openConnectModal();
            });
        }

        const modal = document.getElementById('ssh-connect-modal');
        const form = document.getElementById('ssh-connect-form');

        if (form && form.auth_type) {
            form.auth_type.addEventListener('change', (e) => {
                const isPassword = e.target.value === 'password';
                const passwordGroup = document.getElementById('ssh-password-group');
                const keyGroup = document.getElementById('ssh-key-group');
                if (passwordGroup) passwordGroup.style.display = isPassword ? '' : 'none';
                if (keyGroup) keyGroup.style.display = isPassword ? 'none' : '';
            });
        }

        const cancelBtn = document.getElementById('ssh-cancel-connect');
        if (cancelBtn) {
            cancelBtn.addEventListener('click', () => {
                if (modal) modal.style.display = 'none';
                this.resetConnectForm();
            });
        }

        const closeModalBtn = modal?.querySelector('.ssh-modal-close');
        if (closeModalBtn) {
            closeModalBtn.addEventListener('click', () => {
                if (modal) modal.style.display = 'none';
                this.resetConnectForm();
            });
        }

        const overlay = modal?.querySelector('.ssh-modal-overlay');
        if (overlay) {
            overlay.addEventListener('click', () => {
                if (modal) modal.style.display = 'none';
                this.resetConnectForm();
            });
        }

        const connectOnlyBtn = document.getElementById('ssh-connect-only');
        if (connectOnlyBtn) {
            connectOnlyBtn.addEventListener('click', () => {
                this.handleConnect(false);
            });
        }

        const saveAndConnectBtn = document.getElementById('ssh-save-and-connect');
        if (saveAndConnectBtn) {
            saveAndConnectBtn.addEventListener('click', () => {
                this.handleConnect(true);
            });
        }

        window.addEventListener('ssh-connect', (e) => {
            this.connectToSession(e.detail.session);
        });

        window.addEventListener('ssh-reconnect', async (e) => {
            const session = window.sshSessionManager?.sessions?.find(s => s.id === e.detail.sessionId);
            if (session) {
                this.connectToSession(session);
            }
        });
    }

    openConnectModal() {
        const modal = document.getElementById('ssh-connect-modal');
        if (modal) {
            modal.style.display = '';
            this.resetConnectForm();
        }
    }

    resetConnectForm() {
        const form = document.getElementById('ssh-connect-form');
        if (!form) return;

        form.reset();
        const portInput = form.port;
        const groupInput = form.group;
        const authTypeInput = form.auth_type;

        if (portInput) portInput.value = '22';
        if (groupInput) groupInput.value = '默认';
        if (authTypeInput) authTypeInput.value = 'password';

        const passwordGroup = document.getElementById('ssh-password-group');
        const keyGroup = document.getElementById('ssh-key-group');
        if (passwordGroup) passwordGroup.style.display = '';
        if (keyGroup) keyGroup.style.display = 'none';

        delete form.dataset.editSessionId;
    }

    async handleConnect(save) {
        if (!this.isTauriReady()) {
            SSHUtils.showToast('Tauri API 未就绪，请稍后重试', 'error');
            return;
        }

        const form = document.getElementById('ssh-connect-form');
        if (!form) return;

        const formData = new FormData(form);
        const editSessionId = form.dataset.editSessionId;

        const now = new Date().toISOString().replace('T', ' ').substring(0, 19);
        const session = {
            id: editSessionId || '',
            name: formData.get('name') || formData.get('host'),
            host: formData.get('host'),
            port: parseInt(formData.get('port')) || 22,
            username: formData.get('username'),
            group: formData.get('group') || '默认',
            auth_type: formData.get('auth_type') === 'password'
                ? { type: 'password', password: formData.get('password') }
                : { type: 'private_key', key_path: formData.get('key_path'), passphrase: null },
            description: null,
            tags: [],
            proxy: null,
            terminal: {
                shell: '/bin/bash',
                cols: 120,
                rows: 40,
                font_size: 14,
                font_family: 'Monaco, Menlo, "Courier New", monospace',
                theme: 'dracula',
                encoding: 'utf-8'
            },
            created_at: now,
            updated_at: now
        };

        if (!session.host || !session.username) {
            SSHUtils.showToast('请填写主机地址和用户名', 'error');
            return;
        }

        if (save) {
            const invoke = this.getTauriInvoke();
            try {
                const saved = await invoke('ssh_save_session', { session });
                session.id = saved.id;
                if (window.sshSessionManager) {
                    await window.sshSessionManager.loadSessions();
                    window.sshSessionManager.render();
                }
                SSHUtils.showToast('会话已保存', 'success');
            } catch (e) {
                SSHUtils.showToast('保存会话失败: ' + e, 'error');
                return;
            }
        }

        const modal = document.getElementById('ssh-connect-modal');
        if (modal) modal.style.display = 'none';

        await this.connectToSession(session);
    }

    async connectToSession(session) {
        if (!this.isTauriReady()) {
            SSHUtils.showToast('Tauri API 未就绪，请稍后重试', 'error');
            return;
        }

        const invoke = this.getTauriInvoke();
        const tabId = this.createTab('terminal', session.name || session.host, session.id);

        const content = document.getElementById(`tab-content-${tabId}`);
        if (!content) return;

        content.innerHTML = `
            <div class="ssh-loading">
                <div class="ssh-spinner"></div>
                <span style="margin-left: 12px;">正在连接 ${session.host}...</span>
            </div>
        `;

        try {
            const connectionId = await invoke('ssh_connect', {
                sessionId: session.id,
                session: session
            });

            this.connections.set(tabId, { connectionId, sessionId: session.id, session });

            content.innerHTML = '';
            const terminalContainer = document.createElement('div');
            terminalContainer.className = 'ssh-terminal-container';
            terminalContainer.style.height = '100%';
            content.appendChild(terminalContainer);

            new SshTerminal(terminalContainer, connectionId, session.id);

            this.updateTabStatus(tabId, 'connected');
            SSHUtils.showToast('连接成功', 'success');

        } catch (e) {
            content.innerHTML = `
                <div class="ssh-welcome">
                    <div class="ssh-welcome-icon">❌</div>
                    <h2>连接失败</h2>
                    <p>${e}</p>
                    <button class="ssh-btn ssh-btn-primary" onclick="window.sshMain?.reconnect('${tabId}')">重新连接</button>
                </div>
            `;
            this.updateTabStatus(tabId, 'error');
            SSHUtils.showToast('连接失败: ' + e, 'error');
        }
    }

    createTab(type, title, sessionId) {
        const tabId = SSHUtils.uuid();
        const icons = {
            terminal: '💻',
            sftp: '📁',
            monitor: '📊'
        };

        const tabsContainer = document.getElementById('ssh-tabs');
        if (tabsContainer) {
            const tab = document.createElement('button');
            tab.className = 'ssh-tab';
            tab.dataset.tabId = tabId;
            tab.innerHTML = `
                <span class="ssh-tab-status"></span>
                <span class="ssh-tab-icon">${icons[type] || '📄'}</span>
                <span class="ssh-tab-title">${title}</span>
                <span class="ssh-tab-close" onclick="event.stopPropagation(); window.sshMain?.closeTab('${tabId}')">×</span>
            `;
            tab.onclick = () => this.switchTab(tabId);
            tabsContainer.appendChild(tab);
        }

        const contentContainer = document.getElementById('ssh-content');
        if (contentContainer) {
            const content = document.createElement('div');
            content.id = `tab-content-${tabId}`;
            content.className = 'ssh-tab-content';
            content.style.cssText = 'display: none; width: 100%; height: 100%;';
            contentContainer.appendChild(content);
        }

        this.tabs.push({ id: tabId, type, title, sessionId });
        this.switchTab(tabId);

        return tabId;
    }

    switchTab(tabId) {
        document.querySelectorAll('.ssh-tab').forEach(t => {
            t.classList.toggle('active', t.dataset.tabId === tabId);
        });

        document.querySelectorAll('.ssh-tab-content').forEach(c => {
            c.style.display = c.id === `tab-content-${tabId}` ? '' : 'none';
        });

        this.activeTab = tabId;
    }

    closeTab(tabId) {
        const conn = this.connections.get(tabId);
        const invoke = this.getTauriInvoke();
        if (conn && invoke) {
            invoke('ssh_disconnect', { connectionId: conn.connectionId });
            this.connections.delete(tabId);
        }

        const tab = document.querySelector(`.ssh-tab[data-tab-id="${tabId}"]`);
        tab?.remove();

        const content = document.getElementById(`tab-content-${tabId}`);
        content?.remove();

        this.tabs = this.tabs.filter(t => t.id !== tabId);

        if (this.activeTab === tabId && this.tabs.length > 0) {
            this.switchTab(this.tabs[this.tabs.length - 1].id);
        }
    }

    updateTabStatus(tabId, status) {
        const statusEl = document.querySelector(`.ssh-tab[data-tab-id="${tabId}"] .ssh-tab-status`);
        if (statusEl) {
            statusEl.className = `ssh-tab-status ${status}`;
        }
    }

    async reconnect(tabId) {
        const conn = this.connections.get(tabId);
        if (conn) {
            await this.connectToSession(conn.session);
        }
    }

    openSftp(connectionId, sessionId) {
        const session = window.sshSessionManager?.sessions?.find(s => s.id === sessionId);
        const tabId = this.createTab('sftp', `📁 ${session?.name || 'SFTP'}`, sessionId);

        const content = document.getElementById(`tab-content-${tabId}`);
        if (content) {
            new SftpManager(content, connectionId);
            this.connections.set(tabId, { connectionId, sessionId, type: 'sftp' });
        }
    }

    openMonitor(connectionId, sessionId) {
        const session = window.sshSessionManager?.sessions?.find(s => s.id === sessionId);
        const tabId = this.createTab('monitor', `📊 ${session?.name || '监控'}`, sessionId);

        const content = document.getElementById(`tab-content-${tabId}`);
        if (content) {
            new SystemMonitor(content, connectionId);
            this.connections.set(tabId, { connectionId, sessionId, type: 'monitor' });
        }
    }
}

window.sshMain = new SshMain();
