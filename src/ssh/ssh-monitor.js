// src/ssh/ssh-monitor.js

class SystemMonitor {
    constructor(container, connectionId) {
        this.container = container;
        this.connectionId = connectionId;
        this.data = null;
        this.processes = [];
        this.dockerContainers = [];
        this.refreshInterval = null;

        window.systemMonitor = this;
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

    async init() {
        this.render();
        await this.refresh();
        this.startAutoRefresh();
    }

    render() {
        this.container.innerHTML = `
            <div class="ssh-monitor-container">
                <div class="ssh-monitor-card">
                    <div class="ssh-monitor-card-header">
                        <span class="ssh-monitor-card-title">💻 CPU</span>
                    </div>
                    <div class="ssh-monitor-value" id="monitor-cpu">-</div>
                    <div class="ssh-monitor-chart" id="monitor-cpu-chart"></div>
                </div>
                <div class="ssh-monitor-card">
                    <div class="ssh-monitor-card-header">
                        <span class="ssh-monitor-card-title">🧠 内存</span>
                    </div>
                    <div class="ssh-monitor-value" id="monitor-memory">-</div>
                    <div class="ssh-monitor-chart" id="monitor-memory-chart"></div>
                </div>
                <div class="ssh-monitor-card">
                    <div class="ssh-monitor-card-header">
                        <span class="ssh-monitor-card-title">💾 磁盘</span>
                    </div>
                    <div class="ssh-monitor-value" id="monitor-disk">-</div>
                    <div id="monitor-disk-list"></div>
                </div>
                <div class="ssh-monitor-card">
                    <div class="ssh-monitor-card-header">
                        <span class="ssh-monitor-card-title">🌐 网络</span>
                    </div>
                    <div class="ssh-monitor-value" id="monitor-network">-</div>
                    <div id="monitor-network-info"></div>
                </div>
                <div class="ssh-monitor-card" style="grid-column: span 2;">
                    <div class="ssh-monitor-card-header">
                        <span class="ssh-monitor-card-title">📋 进程</span>
                        <input type="text" id="process-search" placeholder="搜索进程..." style="width: 200px; padding: 4px 8px; background: var(--bg-primary); border: 1px solid var(--border-color); border-radius: 4px; color: var(--text-primary);">
                    </div>
                    <div id="monitor-processes" style="max-height: 300px; overflow-y: auto;"></div>
                </div>
                <div class="ssh-monitor-card" style="grid-column: span 2;">
                    <div class="ssh-monitor-card-header">
                        <span class="ssh-monitor-card-title">🐳 Docker容器</span>
                    </div>
                    <div id="monitor-docker"></div>
                </div>
            </div>
        `;

        this.bindEvents();
    }

    bindEvents() {
        const searchInput = document.getElementById('process-search');
        if (searchInput) {
            searchInput.addEventListener('input', (e) => {
                this.filterProcesses(e.target.value);
            });
        }
    }

    async refresh() {
        const invoke = this.getTauriInvoke();
        if (!invoke) return;

        try {
            const data = await invoke('ssh_monitor_data', {
                connectionId: this.connectionId
            });
            this.data = data;
            this.updateDisplay();

            const processes = await invoke('ssh_monitor_processes', {
                connectionId: this.connectionId
            });
            this.processes = processes;
            this.renderProcesses();

            try {
                const containers = await invoke('ssh_docker_list', {
                    connectionId: this.connectionId
                });
                this.dockerContainers = containers;
                this.renderDocker();
            } catch (e) {
                const dockerEl = document.getElementById('monitor-docker');
                if (dockerEl) dockerEl.innerHTML = '<div style="color: var(--text-muted);">Docker不可用</div>';
            }
        } catch (e) {
            console.error('刷新监控数据失败:', e);
        }
    }

    updateDisplay() {
        if (!this.data) return;

        const cpuEl = document.getElementById('monitor-cpu');
        const memEl = document.getElementById('monitor-memory');
        const diskEl = document.getElementById('monitor-disk');
        const netEl = document.getElementById('monitor-network');

        if (cpuEl && this.data.cpu_usage?.length > 0) {
            const cpuUsage = this.data.cpu_usage.reduce((a, b) => a + b, 0) / this.data.cpu_usage.length;
            cpuEl.textContent = (cpuUsage * 100).toFixed(1) + '%';
        }

        if (memEl && this.data.memory && this.data.memory.total > 0) {
            const memUsage = (this.data.memory.used / this.data.memory.total * 100).toFixed(1);
            memEl.textContent = memUsage + '%';
        }

        if (diskEl && this.data.disk?.length > 0) {
            diskEl.textContent = this.data.disk[0].usage;
        }

        if (netEl && this.data.network) {
            netEl.textContent = SSHUtils.formatSize(this.data.network.rx_bytes) + ' ↓ / ' +
                SSHUtils.formatSize(this.data.network.tx_bytes) + ' ↑';
        }
    }

    renderProcesses() {
        const container = document.getElementById('monitor-processes');
        if (!container) return;

        container.innerHTML = `
            <table style="width: 100%; border-collapse: collapse;">
                <thead>
                    <tr style="color: var(--text-secondary); font-size: 12px;">
                        <th style="text-align: left; padding: 4px;">PID</th>
                        <th style="text-align: left; padding: 4px;">用户</th>
                        <th style="text-align: left; padding: 4px;">CPU%</th>
                        <th style="text-align: left; padding: 4px;">MEM%</th>
                        <th style="text-align: left; padding: 4px;">命令</th>
                        <th style="text-align: left; padding: 4px;">操作</th>
                    </tr>
                </thead>
                <tbody>
                    ${this.processes.slice(0, 20).map(p => `
                        <tr style="font-size: 13px; border-bottom: 1px solid var(--border-color);">
                            <td style="padding: 4px;">${p.pid}</td>
                            <td style="padding: 4px;">${p.user}</td>
                            <td style="padding: 4px; color: ${p.cpu > 50 ? '#ff5555' : 'inherit'};">${p.cpu}%</td>
                            <td style="padding: 4px;">${p.mem}%</td>
                            <td style="padding: 4px; max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${p.command}</td>
                            <td style="padding: 4px;">
                                <button class="ssh-btn ssh-btn-secondary" style="padding: 2px 6px; font-size: 11px;" onclick="window.systemMonitor?.killProcess(${p.pid})">Kill</button>
                            </td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        `;
    }

    renderDocker() {
        const container = document.getElementById('monitor-docker');
        if (!container) return;

        if (this.dockerContainers.length === 0) {
            container.innerHTML = '<div style="color: var(--text-muted);">无运行中的容器</div>';
            return;
        }

        container.innerHTML = this.dockerContainers.map(c => `
            <div style="display: inline-block; padding: 8px 12px; margin: 4px; background: var(--bg-primary); border-radius: 4px;">
                <div style="font-weight: 600; margin-bottom: 4px;">${c.name}</div>
                <div style="font-size: 12px; color: var(--text-muted);">${c.image}</div>
                <div style="font-size: 12px; color: ${c.status?.includes('Up') ? '#50fa7b' : '#ff5555'};">${c.status}</div>
            </div>
        `).join('');
    }

    filterProcesses(keyword) {
        const container = document.getElementById('monitor-processes');
        if (!container) return;

        const filtered = keyword
            ? this.processes.filter(p =>
                p.command.toLowerCase().includes(keyword.toLowerCase()) ||
                p.user.toLowerCase().includes(keyword.toLowerCase()) ||
                p.pid.toString().includes(keyword)
            )
            : this.processes;

        container.innerHTML = `
            <table style="width: 100%; border-collapse: collapse;">
                <thead>
                    <tr style="color: var(--text-secondary); font-size: 12px;">
                        <th style="text-align: left; padding: 4px;">PID</th>
                        <th style="text-align: left; padding: 4px;">用户</th>
                        <th style="text-align: left; padding: 4px;">CPU%</th>
                        <th style="text-align: left; padding: 4px;">MEM%</th>
                        <th style="text-align: left; padding: 4px;">命令</th>
                        <th style="text-align: left; padding: 4px;">操作</th>
                    </tr>
                </thead>
                <tbody>
                    ${filtered.slice(0, 20).map(p => `
                        <tr style="font-size: 13px; border-bottom: 1px solid var(--border-color);">
                            <td style="padding: 4px;">${p.pid}</td>
                            <td style="padding: 4px;">${p.user}</td>
                            <td style="padding: 4px; color: ${p.cpu > 50 ? '#ff5555' : 'inherit'};">${p.cpu}%</td>
                            <td style="padding: 4px;">${p.mem}%</td>
                            <td style="padding: 4px; max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${p.command}</td>
                            <td style="padding: 4px;">
                                <button class="ssh-btn ssh-btn-secondary" style="padding: 2px 6px; font-size: 11px;" onclick="window.systemMonitor?.killProcess(${p.pid})">Kill</button>
                            </td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        `;
    }

    async killProcess(pid) {
        const invoke = this.getTauriInvoke();
        if (!invoke) return;

        const confirmed = await SSHUtils.confirm(`确定终止进程 ${pid} 吗？`);
        if (!confirmed) return;

        try {
            await invoke('ssh_monitor_kill_process', {
                connectionId: this.connectionId,
                pid: pid
            });
            SSHUtils.showToast('进程已终止', 'success');
            await this.refresh();
        } catch (e) {
            SSHUtils.showToast('终止进程失败: ' + e, 'error');
        }
    }

    startAutoRefresh() {
        this.refreshInterval = setInterval(() => {
            this.refresh();
        }, 3000);
    }

    stopAutoRefresh() {
        if (this.refreshInterval) {
            clearInterval(this.refreshInterval);
            this.refreshInterval = null;
        }
    }

    destroy() {
        this.stopAutoRefresh();
    }
}

window.SystemMonitor = SystemMonitor;
