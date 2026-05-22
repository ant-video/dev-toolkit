// src/ssh/ssh-sessions.js

class SshSessionManager {
    constructor() {
        this.sessions = [];
        this.groups = [];
        this.connections = new Map();
        this.selectedSession = null;
        this.expandedGroups = new Set(['默认']);
        this.initialized = false;

        // 延迟初始化，等待 Tauri API 准备好
        this.waitForTauriAndInit();
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

    async waitForTauriAndInit() {
        // 等待 Tauri API 准备好
        let attempts = 0;
        while (!this.getTauriInvoke() && attempts < 50) {
            await new Promise(resolve => setTimeout(resolve, 100));
            attempts++;
        }

        if (!this.getTauriInvoke()) {
            console.warn('Tauri API 未就绪，SSH 会话管理器将在页面切换时初始化');
            return;
        }

        await this.init();
    }

    async init() {
        if (this.initialized) return;
        this.initialized = true;
        await this.loadSessions();
        this.render();
        this.bindEvents();
    }

    async loadSessions() {
        const invoke = this.getTauriInvoke();
        if (!invoke) {
            console.warn('Tauri API 不可用');
            return;
        }
        try {
            const result = await invoke('ssh_list_sessions');
            this.sessions = result || [];
            this.updateGroups();
        } catch (e) {
            console.error('加载会话失败:', e);
            if (typeof SSHUtils !== 'undefined') {
                SSHUtils.showToast('加载会话失败: ' + e, 'error');
            }
        }
    }

    updateGroups() {
        const groupSet = new Set(this.sessions.map(s => s.group || '默认'));
        this.groups = Array.from(groupSet);
    }

    render() {
        const container = document.getElementById('ssh-session-tree');
        if (!container) return;

        const grouped = {};
        for (const session of this.sessions) {
            const group = session.group || '默认';
            if (!grouped[group]) {
                grouped[group] = [];
            }
            grouped[group].push(session);
        }

        container.innerHTML = Object.entries(grouped).map(([group, sessions]) => `
            <div class="ssh-group ${this.expandedGroups.has(group) ? 'expanded' : ''}">
                <div class="ssh-group-header" data-group="${group}">
                    <span class="ssh-group-icon">▶</span>
                    <span>${group}</span>
                    <span style="margin-left: auto; color: var(--text-muted);">${sessions.length}</span>
                </div>
                <div class="ssh-group-sessions">
                    ${sessions.map(session => this.renderSessionItem(session)).join('')}
                </div>
            </div>
        `).join('');

        if (this.sessions.length === 0) {
            container.innerHTML = `
                <div class="ssh-empty">
                    <div class="ssh-empty-icon">📭</div>
                    <div>暂无保存的会话</div>
                </div>
            `;
        }
    }

    renderSessionItem(session) {
        const conn = this.connections.get(session.id);
        const status = conn ? conn.status : 'disconnected';

        return `
            <div class="ssh-session-item ${this.selectedSession === session.id ? 'active' : ''}"
                 data-session-id="${session.id}">
                <span class="ssh-session-status ${status}"></span>
                <span class="ssh-session-name">${session.name || session.host}</span>
                <div class="ssh-session-actions">
                    <span class="ssh-session-action" data-action="edit" title="编辑">✏️</span>
                    <span class="ssh-session-action" data-action="duplicate" title="复制">📋</span>
                    <span class="ssh-session-action" data-action="delete" title="删除">🗑️</span>
                </div>
            </div>
        `;
    }

    bindEvents() {
        const container = document.getElementById('ssh-session-tree');
        if (!container) return;

        container.addEventListener('click', async (e) => {
            const groupHeader = e.target.closest('.ssh-group-header');
            if (groupHeader) {
                const group = groupHeader.dataset.group;
                if (this.expandedGroups.has(group)) {
                    this.expandedGroups.delete(group);
                } else {
                    this.expandedGroups.add(group);
                }
                this.render();
                return;
            }

            const sessionItem = e.target.closest('.ssh-session-item');
            if (sessionItem) {
                const sessionId = sessionItem.dataset.sessionId;
                const action = e.target.dataset.action;

                if (action) {
                    e.stopPropagation();
                    await this.handleAction(sessionId, action);
                } else {
                    this.selectSession(sessionId);
                }
            }
        });

        container.addEventListener('dblclick', (e) => {
            const sessionItem = e.target.closest('.ssh-session-item');
            if (sessionItem) {
                const sessionId = sessionItem.dataset.sessionId;
                this.connect(sessionId);
            }
        });

        container.addEventListener('contextmenu', (e) => {
            const sessionItem = e.target.closest('.ssh-session-item');
            if (sessionItem) {
                e.preventDefault();
                const sessionId = sessionItem.dataset.sessionId;
                this.showContextMenu(e, sessionId);
            }
        });

        const searchInput = document.getElementById('ssh-search-input');
        if (searchInput) {
            searchInput.addEventListener('input', SSHUtils.debounce((e) => {
                this.filterSessions(e.target.value);
            }, 300));
        }
    }

    selectSession(sessionId) {
        this.selectedSession = sessionId;
        this.render();
    }

    async handleAction(sessionId, action) {
        const session = this.sessions.find(s => s.id === sessionId);
        if (!session) return;

        switch (action) {
            case 'edit':
                this.openEditModal(session);
                break;
            case 'duplicate':
                await this.duplicateSession(session);
                break;
            case 'delete':
                await this.deleteSession(sessionId);
                break;
        }
    }

    async duplicateSession(session) {
        const newSession = {
            ...session,
            id: '',
            name: session.name + ' (副本)'
        };

        try {
            const result = await window.__TAURI__.invoke('ssh_save_session', { session: newSession });
            this.sessions.push(result);
            this.updateGroups();
            this.render();
            SSHUtils.showToast('会话已复制', 'success');
        } catch (e) {
            SSHUtils.showToast('复制失败: ' + e, 'error');
        }
    }

    async deleteSession(sessionId) {
        const session = this.sessions.find(s => s.id === sessionId);
        if (!session) return;

        const confirmed = await SSHUtils.confirm(`确定删除会话 "${session.name || session.host}" 吗？`);
        if (!confirmed) return;

        try {
            await window.__TAURI__.invoke('ssh_delete_session', { id: sessionId });
            this.sessions = this.sessions.filter(s => s.id !== sessionId);
            this.updateGroups();
            this.render();
            SSHUtils.showToast('会话已删除', 'success');
        } catch (e) {
            SSHUtils.showToast('删除失败: ' + e, 'error');
        }
    }

    showContextMenu(e, sessionId) {
        const session = this.sessions.find(s => s.id === sessionId);
        if (!session) return;

        const menu = document.createElement('div');
        menu.className = 'ssh-context-menu';
        menu.innerHTML = `
            <div class="ssh-context-menu-item" data-action="connect">🔌 连接</div>
            <div class="ssh-context-menu-item" data-action="edit">✏️ 编辑</div>
            <div class="ssh-context-menu-item" data-action="duplicate">📋 复制</div>
            <div class="ssh-context-menu-divider"></div>
            <div class="ssh-context-menu-item" data-action="export">📤 导出</div>
            <div class="ssh-context-menu-divider"></div>
            <div class="ssh-context-menu-item danger" data-action="delete">🗑️ 删除</div>
        `;

        menu.style.left = e.clientX + 'px';
        menu.style.top = e.clientY + 'px';
        document.body.appendChild(menu);

        menu.addEventListener('click', async (e) => {
            const action = e.target.dataset.action;
            if (action) {
                menu.remove();
                switch (action) {
                    case 'connect':
                        this.connect(sessionId);
                        break;
                    default:
                        await this.handleAction(sessionId, action);
                }
            }
        });

        const closeMenu = () => {
            menu.remove();
            document.removeEventListener('click', closeMenu);
        };
        setTimeout(() => document.addEventListener('click', closeMenu), 0);
    }

    filterSessions(keyword) {
        const container = document.getElementById('ssh-session-tree');
        if (!container) return;

        const items = container.querySelectorAll('.ssh-session-item');
        keyword = keyword.toLowerCase();

        items.forEach(item => {
            const name = item.querySelector('.ssh-session-name').textContent.toLowerCase();
            item.style.display = name.includes(keyword) ? '' : 'none';
        });
    }

    openEditModal(session) {
        const modal = document.getElementById('ssh-connect-modal');
        const form = document.getElementById('ssh-connect-form');

        form.name.value = session.name || '';
        form.host.value = session.host;
        form.port.value = session.port;
        form.username.value = session.username;
        form.group.value = session.group || '默认';

        if (session.auth_type.type === 'password') {
            form.auth_type.value = 'password';
            form.password.value = session.auth_type.password || '';
            document.getElementById('ssh-password-group').style.display = '';
            document.getElementById('ssh-key-group').style.display = 'none';
        } else {
            form.auth_type.value = 'private_key';
            form.key_path.value = session.auth_type.key_path || '';
            document.getElementById('ssh-password-group').style.display = 'none';
            document.getElementById('ssh-key-group').style.display = '';
        }

        form.dataset.editSessionId = session.id;
        modal.style.display = '';
    }

    async connect(sessionId) {
        const session = this.sessions.find(s => s.id === sessionId);
        if (!session) return;

        window.dispatchEvent(new CustomEvent('ssh-connect', {
            detail: { session }
        }));
    }

    updateConnectionStatus(sessionId, status, error = null) {
        this.connections.set(sessionId, { status, error });
        this.render();
    }
}

window.sshSessionManager = new SshSessionManager();
