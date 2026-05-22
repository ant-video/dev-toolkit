// src/ssh/ssh-terminal.js

class SshTerminal {
    constructor(container, connectionId, sessionId) {
        this.container = container;
        this.connectionId = connectionId;
        this.sessionId = sessionId;
        this.term = null;
        this.fitAddon = null;
        this.searchAddon = null;
        this.channel = null;
        this.disconnected = false;

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

    isTauriReady() {
        return this.getTauriInvoke() !== null;
    }

    async init() {
        if (!this.isTauriReady()) {
            console.error('Tauri API 未就绪');
            return;
        }

        this.term = new Terminal({
            fontSize: 14,
            fontFamily: 'Monaco, Menlo, "Courier New", monospace',
            theme: this.getDraculaTheme(),
            cursorBlink: true,
            cursorStyle: 'block',
            scrollback: 10000,
            allowTransparency: true,
        });

        this.fitAddon = new FitAddon();
        this.term.loadAddon(this.fitAddon);

        this.searchAddon = new SearchAddon();
        this.term.loadAddon(this.searchAddon);

        const webLinksAddon = new WebLinksAddon();
        this.term.loadAddon(webLinksAddon);

        this.term.open(this.container);
        this.fitAddon.fit();

        this.bindEvents();
        this.listenOutput();
        await this.requestPty();
    }

    getDraculaTheme() {
        return {
            background: '#1e1e1e',
            foreground: '#f8f8f2',
            cursor: '#f8f8f2',
            cursorAccent: '#1e1e1e',
            selection: 'rgba(255, 255, 255, 0.3)',
            black: '#000000',
            red: '#ff5555',
            green: '#50fa7b',
            yellow: '#f1fa8c',
            blue: '#6272a4',
            magenta: '#ff79c6',
            cyan: '#8be9fd',
            white: '#f8f8f2',
            brightBlack: '#6272a4',
            brightRed: '#ff6e6e',
            brightGreen: '#69fa7b',
            brightYellow: '#ffffa5',
            brightBlue: '#8ba7f7',
            brightMagenta: '#ff92df',
            brightCyan: '#a5fdee',
            brightWhite: '#ffffff',
        };
    }

    bindEvents() {
        const invoke = this.getTauriInvoke();
        this.term.onData(data => {
            if (!this.disconnected && invoke) {
                invoke('ssh_write', {
                    connectionId: this.connectionId,
                    data: Array.from(new TextEncoder().encode(data))
                }).catch(e => {
                    console.error('发送数据失败:', e);
                });
            }
        });

        const resizeObserver = new ResizeObserver(() => {
            if (this.fitAddon && !this.disconnected) {
                this.fitAddon.fit();
                this.resizePty();
            }
        });
        resizeObserver.observe(this.container);

        this.container.addEventListener('keydown', (e) => {
            if (e.ctrlKey && e.shiftKey && e.key === 'F') {
                e.preventDefault();
                this.toggleSearch();
            }
            if (e.ctrlKey && e.key === 'c' && this.term.hasSelection()) {
                e.preventDefault();
                document.execCommand('copy');
            }
            if (e.ctrlKey && e.key === 'v') {
                e.preventDefault();
                navigator.clipboard.readText().then(text => {
                    this.term.paste(text);
                });
            }
        });

        this.container.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            this.showContextMenu(e);
        });
    }

    async listenOutput() {
        const event = this.getTauriEvent();
        if (!event) return;

        const unlisten = await event.listen(
            `ssh-output-${this.connectionId}`,
            (evt) => {
                if (evt.payload && evt.payload.length > 0) {
                    const data = new Uint8Array(evt.payload);
                    this.term.write(data);
                }
            }
        );

        const unlistenDisconnect = await event.listen(
            `ssh-disconnect-${this.connectionId}`,
            () => {
                this.handleDisconnect();
            }
        );

        this.unlisten = () => {
            unlisten();
            unlistenDisconnect();
        };
    }

    async requestPty() {
        const invoke = this.getTauriInvoke();
        if (!invoke) return;

        try {
            await invoke('ssh_create_pty', {
                connectionId: this.connectionId,
                cols: this.term.cols,
                rows: this.term.rows
            });
        } catch (e) {
            SSHUtils.showToast('创建终端失败: ' + e, 'error');
            this.handleDisconnect();
        }
    }

    resizePty() {
        const invoke = this.getTauriInvoke();
        if (!this.disconnected && this.connectionId && invoke) {
            invoke('ssh_resize_pty', {
                connectionId: this.connectionId,
                cols: this.term.cols,
                rows: this.term.rows
            }).catch(e => console.error('resize失败:', e));
        }
    }

    toggleSearch() {
        const searchTerm = prompt('搜索:');
        if (searchTerm) {
            this.searchAddon.findNext(searchTerm);
        }
    }

    showContextMenu(e) {
        const menu = document.createElement('div');
        menu.className = 'ssh-context-menu';
        menu.innerHTML = `
            <div class="ssh-context-menu-item" data-action="copy">📋 复制</div>
            <div class="ssh-context-menu-item" data-action="paste">📝 粘贴</div>
            <div class="ssh-context-menu-divider"></div>
            <div class="ssh-context-menu-item" data-action="search">🔍 搜索</div>
            <div class="ssh-context-menu-item" data-action="clear">🗑️ 清屏</div>
            <div class="ssh-context-menu-divider"></div>
            <div class="ssh-context-menu-item" data-action="reconnect">🔄 重新连接</div>
            <div class="ssh-context-menu-item danger" data-action="disconnect">❌ 断开连接</div>
        `;

        menu.style.left = e.clientX + 'px';
        menu.style.top = e.clientY + 'px';
        document.body.appendChild(menu);

        menu.addEventListener('click', async (e) => {
            const action = e.target.dataset.action;
            if (action) {
                menu.remove();
                this.handleContextAction(action);
            }
        });

        const closeMenu = () => {
            menu.remove();
            document.removeEventListener('click', closeMenu);
        };
        setTimeout(() => document.addEventListener('click', closeMenu), 0);
    }

    async handleContextAction(action) {
        const invoke = this.getTauriInvoke();
        switch (action) {
            case 'copy':
                if (this.term.hasSelection()) {
                    document.execCommand('copy');
                }
                break;
            case 'paste':
                const text = await navigator.clipboard.readText();
                this.term.paste(text);
                break;
            case 'search':
                this.toggleSearch();
                break;
            case 'clear':
                this.term.clear();
                break;
            case 'reconnect':
                window.dispatchEvent(new CustomEvent('ssh-reconnect', {
                    detail: { sessionId: this.sessionId }
                }));
                break;
            case 'disconnect':
                if (invoke) {
                    await invoke('ssh_disconnect', {
                        connectionId: this.connectionId
                    });
                }
                break;
        }
    }

    handleDisconnect() {
        this.disconnected = true;
        this.term.write('\r\n\x1b[31m[连接已断开]\x1b[0m\r\n');
    }

    destroy() {
        if (this.unlisten) {
            this.unlisten();
        }
        if (this.term) {
            this.term.dispose();
        }
    }
}

class SplitTerminalManager {
    constructor(container) {
        this.container = container;
        this.terminals = [];
        this.layout = 'single';
    }

    setLayout(layout) {
        this.layout = layout;
        this.render();
    }

    render() {
        this.container.innerHTML = '';
        this.container.className = `ssh-split-container ssh-split-${this.layout}`;

        const layouts = {
            single: 1,
            horizontal: 2,
            vertical: 2,
            quad: 4
        };

        const count = layouts[this.layout] || 1;

        for (let i = 0; i < count; i++) {
            const pane = document.createElement('div');
            pane.className = 'ssh-split-pane';
            const terminalDiv = document.createElement('div');
            terminalDiv.className = 'ssh-terminal-container';
            terminalDiv.style.height = '100%';
            pane.appendChild(terminalDiv);
            this.container.appendChild(pane);

            if (this.terminals[i]) {
                this.terminals[i].container = terminalDiv;
            }
        }
    }

    getTerminal(index) {
        return this.terminals[index];
    }

    addTerminal(terminal, index) {
        this.terminals[index] = terminal;
    }

    destroyAll() {
        this.terminals.forEach(t => t && t.destroy());
        this.terminals = [];
    }
}

window.SshTerminal = SshTerminal;
window.SplitTerminalManager = SplitTerminalManager;
