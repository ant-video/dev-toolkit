// src/ssh/ssh-utils.js

const SSHUtils = {
    // 生成UUID
    uuid() {
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
            const r = Math.random() * 16 | 0;
            const v = c === 'x' ? r : (r & 0x3 | 0x8);
            return v.toString(16);
        });
    },

    // 格式化日期
    formatDate(date) {
        if (typeof date === 'string') {
            date = new Date(date);
        }
        return date.toLocaleString('zh-CN', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
        });
    },

    // 格式化文件大小
    formatSize(bytes) {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    },

    // 格式化速度
    formatSpeed(bytesPerSec) {
        return this.formatSize(bytesPerSec) + '/s';
    },

    // 格式化持续时间
    formatDuration(seconds) {
        if (seconds < 60) {
            return `${seconds}秒`;
        } else if (seconds < 3600) {
            const minutes = Math.floor(seconds / 60);
            const secs = seconds % 60;
            return `${minutes}分${secs}秒`;
        } else {
            const hours = Math.floor(seconds / 3600);
            const minutes = Math.floor((seconds % 3600) / 60);
            return `${hours}时${minutes}分`;
        }
    },

    // 显示提示消息
    showToast(message, type = 'info') {
        const toast = document.createElement('div');
        toast.className = `ssh-toast ssh-toast-${type}`;
        toast.textContent = message;
        toast.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            padding: 12px 20px;
            background: ${type === 'error' ? '#ff5555' : type === 'success' ? '#50fa7b' : '#6272a4'};
            color: white;
            border-radius: 4px;
            z-index: 10000;
            animation: slideIn 0.3s ease;
        `;
        document.body.appendChild(toast);

        setTimeout(() => {
            toast.style.animation = 'slideOut 0.3s ease';
            setTimeout(() => toast.remove(), 300);
        }, 3000);
    },

    // 显示确认对话框
    async confirm(message) {
        return new Promise((resolve) => {
            const modal = document.createElement('div');
            modal.className = 'ssh-modal';
            modal.innerHTML = `
                <div class="ssh-modal-overlay"></div>
                <div class="ssh-modal-content" style="width: 320px;">
                    <div class="ssh-modal-header">
                        <h3>确认</h3>
                    </div>
                    <div class="ssh-modal-body">
                        <p style="margin: 0; color: var(--text-primary);">${message}</p>
                    </div>
                    <div class="ssh-modal-footer">
                        <button class="ssh-btn ssh-btn-secondary" id="confirm-cancel">取消</button>
                        <button class="ssh-btn ssh-btn-primary" id="confirm-ok">确定</button>
                    </div>
                </div>
            `;
            document.body.appendChild(modal);

            modal.querySelector('#confirm-ok').onclick = () => {
                modal.remove();
                resolve(true);
            };
            modal.querySelector('#confirm-cancel').onclick = () => {
                modal.remove();
                resolve(false);
            };
            modal.querySelector('.ssh-modal-overlay').onclick = () => {
                modal.remove();
                resolve(false);
            };
        });
    },

    // 解析SSH连接字符串
    parseConnectionString(str) {
        // 支持格式: user@host:port, user@host, host:port, host
        const result = {
            host: '',
            port: 22,
            username: ''
        };

        // 解析 user@ 部分
        if (str.includes('@')) {
            const parts = str.split('@');
            result.username = parts[0];
            str = parts[1];
        }

        // 解析 :port 部分
        if (str.includes(':')) {
            const parts = str.split(':');
            result.host = parts[0];
            result.port = parseInt(parts[1]) || 22;
        } else {
            result.host = str;
        }

        return result;
    },

    // 获取文件图标
    getFileIcon(name, isDir) {
        if (isDir) return '📁';

        const ext = name.split('.').pop().toLowerCase();
        const icons = {
            'js': '📜',
            'ts': '📜',
            'py': '🐍',
            'java': '☕',
            'go': '🐹',
            'rs': '🦀',
            'c': '📜',
            'cpp': '📜',
            'h': '📜',
            'html': '🌐',
            'css': '🎨',
            'json': '📋',
            'xml': '📋',
            'yaml': '📋',
            'yml': '📋',
            'md': '📝',
            'txt': '📄',
            'log': '📄',
            'sh': '🔧',
            'bash': '🔧',
            'zsh': '🔧',
            'zip': '📦',
            'tar': '📦',
            'gz': '📦',
            'rar': '📦',
            '7z': '📦',
            'jpg': '🖼️',
            'jpeg': '🖼️',
            'png': '🖼️',
            'gif': '🖼️',
            'svg': '🖼️',
            'pdf': '📕',
            'doc': '📘',
            'docx': '📘',
            'xls': '📗',
            'xlsx': '📗',
            'ppt': '📙',
            'pptx': '📙',
        };

        return icons[ext] || '📄';
    },

    // 防抖函数
    debounce(fn, delay) {
        let timer = null;
        return function(...args) {
            clearTimeout(timer);
            timer = setTimeout(() => fn.apply(this, args), delay);
        };
    },

    // 节流函数
    throttle(fn, delay) {
        let last = 0;
        return function(...args) {
            const now = Date.now();
            if (now - last >= delay) {
                last = now;
                fn.apply(this, args);
            }
        };
    }
};

// 添加CSS动画
const style = document.createElement('style');
style.textContent = `
    @keyframes slideIn {
        from { transform: translateX(100%); opacity: 0; }
        to { transform: translateX(0); opacity: 1; }
    }
    @keyframes slideOut {
        from { transform: translateX(0); opacity: 1; }
        to { transform: translateX(100%); opacity: 0; }
    }
`;
document.head.appendChild(style);
