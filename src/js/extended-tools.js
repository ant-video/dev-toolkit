// ==================== 新增工具初始化 ====================

// 编辑器初始化
function initNewToolEditors() {
    // 文本转义
    editors.textEscapeInput = makePlainInputEditor('text-escape-input-editor');
    editors.textEscapeOutput = makePlainOutputEditor('text-escape-output-editor');

    // JSON ↔ CSV
    editors.jsonCsvInput = makeInputEditor('json-csv-input-editor', 'javascript');
    editors.jsonCsvOutput = makeOutputEditor('json-csv-output-editor', 'javascript');

    // TOML ↔ JSON
    editors.tomlJsonInput = makePlainInputEditor('toml-json-input-editor');
    editors.tomlJsonOutput = makeOutputEditor('toml-json-output-editor', 'javascript');

    // JSONPath
    editors.jsonpathInput = makeInputEditor('jsonpath-input-editor', 'javascript');
    editors.jsonpathOutput = makeOutputEditor('jsonpath-output-editor', 'javascript');

    // JSON Schema
    editors.jsonSchemaInput = makeInputEditor('json-schema-input-editor', 'javascript');
    editors.jsonSchemaOutput = makeOutputEditor('json-schema-output-editor', 'javascript');

    // JSON → TS
    editors.jsonTsInput = makeInputEditor('json-ts-input-editor', 'javascript');
    editors.jsonTsOutput = makePlainOutputEditor('json-ts-output-editor');

    // SQL 格式化
    editors.sqlFormatInput = makePlainInputEditor('sql-format-input-editor');
    editors.sqlFormatOutput = makePlainOutputEditor('sql-format-output-editor');

    // 代码格式化
    editors.codeFormatInput = makePlainInputEditor('code-format-input-editor');
    editors.codeFormatOutput = makePlainOutputEditor('code-format-output-editor');

    // Markdown 预览
    editors.markdownInput = makePlainInputEditor('markdown-input-editor');

    // Protobuf 解码
    editors.protobufInput = makePlainInputEditor('protobuf-input-editor');
    editors.protobufOutput = makeOutputEditor('protobuf-output-editor', 'javascript');

    // MessagePack 解码
    editors.msgpackInput = makePlainInputEditor('msgpack-input-editor');
    editors.msgpackOutput = makeOutputEditor('msgpack-output-editor', 'javascript');

    // Mock 数据
    editors.mockOutput = makePlainOutputEditor('mock-output-editor');

    // Changelog
    editors.changelogOutput = makePlainOutputEditor('changelog-output-editor');
}

// 页面初始化映射
const newToolInitMap = {
    'text-escape': () => { editors.textEscapeInput?.refresh(); editors.textEscapeOutput?.refresh(); },
    'json-csv': () => { editors.jsonCsvInput?.refresh(); editors.jsonCsvOutput?.refresh(); },
    'toml-json': () => { editors.tomlJsonInput?.refresh(); editors.tomlJsonOutput?.refresh(); },
    'jsonpath': () => { editors.jsonpathInput?.refresh(); editors.jsonpathOutput?.refresh(); },
    'json-schema': () => { editors.jsonSchemaInput?.refresh(); editors.jsonSchemaOutput?.refresh(); },
    'json-ts': () => { editors.jsonTsInput?.refresh(); editors.jsonTsOutput?.refresh(); },
    'sql-format': () => { editors.sqlFormatInput?.refresh(); editors.sqlFormatOutput?.refresh(); },
    'code-format': () => { editors.codeFormatInput?.refresh(); editors.codeFormatOutput?.refresh(); },
    'markdown-preview': () => { editors.markdownInput?.refresh(); },
    'protobuf-decode': () => { editors.protobufInput?.refresh(); editors.protobufOutput?.refresh(); },
    'msgpack-decode': () => { editors.msgpackInput?.refresh(); editors.msgpackOutput?.refresh(); },
    'mock-data': () => { editors.mockOutput?.refresh(); },
    'changelog': () => { editors.changelogOutput?.refresh(); },
    'regex-favorites': () => { loadRegexFavorites(); },
};

// ==================== 文本转义/反转义 ====================
async function doTextEscape() {
    const input = editors.textEscapeInput?.getValue();
    if (!input?.trim()) return;
    const escapeType = document.getElementById('text-escape-type').value;
    try {
        const r = await invoke('text_escape', { text: input, escapeType });
        if (r.success) {
            editors.textEscapeOutput.setValue(r.result);
            showStatus('text-escape-status', '✓ 转义成功', 'success');
        } else {
            showStatus('text-escape-status', '✗ ' + r.error, 'error');
        }
    } catch(e) { showStatus('text-escape-status', '✗ ' + e, 'error'); }
}

async function doTextUnescape() {
    const input = editors.textEscapeInput?.getValue();
    if (!input?.trim()) return;
    const escapeType = document.getElementById('text-escape-type').value;
    try {
        const r = await invoke('text_unescape', { text: input, escapeType });
        if (r.success) {
            editors.textEscapeOutput.setValue(r.result);
            showStatus('text-escape-status', '✓ 反转义成功', 'success');
        } else {
            showStatus('text-escape-status', '✗ ' + r.error, 'error');
        }
    } catch(e) { showStatus('text-escape-status', '✗ ' + e, 'error'); }
}

// ==================== JSON ↔ CSV ====================
async function jsonToCsv() {
    const input = editors.jsonCsvInput?.getValue();
    if (!input?.trim()) return;
    const delimiter = document.getElementById('csv-delimiter').value;
    try {
        const r = await invoke('json_to_csv', { jsonStr: input, delimiter });
        if (r.success) {
            editors.jsonCsvOutput.setValue(r.result);
            showStatus('json-csv-status', '✓ 转换成功', 'success');
        } else {
            showStatus('json-csv-status', '✗ ' + r.error, 'error');
        }
    } catch(e) { showStatus('json-csv-status', '✗ ' + e, 'error'); }
}

async function csvToJson() {
    const input = editors.jsonCsvInput?.getValue();
    if (!input?.trim()) return;
    const delimiter = document.getElementById('csv-delimiter').value;
    try {
        const r = await invoke('csv_to_json', { csvStr: input, delimiter });
        if (r.success) {
            editors.jsonCsvOutput.setValue(r.result);
            showStatus('json-csv-status', '✓ 转换成功', 'success');
        } else {
            showStatus('json-csv-status', '✗ ' + r.error, 'error');
        }
    } catch(e) { showStatus('json-csv-status', '✗ ' + e, 'error'); }
}

// ==================== TOML ↔ JSON ====================
async function tomlToJson() {
    const input = editors.tomlJsonInput?.getValue();
    if (!input?.trim()) return;
    try {
        const r = await invoke('toml_to_json', { tomlStr: input });
        if (r.success) {
            editors.tomlJsonOutput.setValue(r.result);
            showStatus('toml-json-status', '✓ 转换成功', 'success');
        } else {
            showStatus('toml-json-status', '✗ ' + r.error, 'error');
        }
    } catch(e) { showStatus('toml-json-status', '✗ ' + e, 'error'); }
}

async function jsonToToml() {
    const input = editors.tomlJsonInput?.getValue();
    if (!input?.trim()) return;
    try {
        const r = await invoke('json_to_toml', { jsonStr: input });
        if (r.success) {
            editors.tomlJsonOutput.setValue(r.result);
            showStatus('toml-json-status', '✓ 转换成功', 'success');
        } else {
            showStatus('toml-json-status', '✗ ' + r.error, 'error');
        }
    } catch(e) { showStatus('toml-json-status', '✗ ' + e, 'error'); }
}

// ==================== JSONPath 查询 ====================
async function doJsonPathQuery() {
    const input = editors.jsonpathInput?.getValue();
    const path = document.getElementById('jsonpath-path')?.value?.trim();
    if (!input?.trim() || !path) {
        showStatus('jsonpath-status', '请输入 JSON 数据和查询路径', 'error');
        return;
    }
    try {
        const r = await invoke('jsonpath_query', { jsonStr: input, path });
        if (r.success) {
            editors.jsonpathOutput.setValue(r.result);
            showStatus('jsonpath-status', '✓ 查询成功', 'success');
        } else {
            showStatus('jsonpath-status', '✗ ' + r.error, 'error');
        }
    } catch(e) { showStatus('jsonpath-status', '✗ ' + e, 'error'); }
}

// ==================== JSON Schema ====================
async function generateJsonSchema() {
    const input = editors.jsonSchemaInput?.getValue();
    if (!input?.trim()) return;
    try {
        const r = await invoke('json_schema_generate', { jsonStr: input });
        if (r.success) {
            editors.jsonSchemaOutput.setValue(r.result);
            showStatus('json-schema-status', '✓ Schema 生成成功', 'success');
        } else {
            showStatus('json-schema-status', '✗ ' + r.error, 'error');
        }
    } catch(e) { showStatus('json-schema-status', '✗ ' + e, 'error'); }
}

// ==================== JSON → TypeScript ====================
async function jsonToTsType() {
    const input = editors.jsonTsInput?.getValue();
    if (!input?.trim()) return;
    const interfaceName = document.getElementById('ts-interface-name')?.value?.trim() || 'RootType';
    try {
        const r = await invoke('json_to_typescript', { jsonStr: input, interfaceName });
        if (r.success) {
            editors.jsonTsOutput.setValue(r.result);
            showStatus('json-ts-status', '✓ 类型生成成功', 'success');
        } else {
            showStatus('json-ts-status', '✗ ' + r.error, 'error');
        }
    } catch(e) { showStatus('json-ts-status', '✗ ' + e, 'error'); }
}

// ==================== SQL 格式化 ====================
async function doSqlFormat() {
    const input = editors.sqlFormatInput?.getValue();
    if (!input?.trim()) return;
    const uppercase = document.getElementById('sql-uppercase')?.checked || false;
    const indent = document.getElementById('sql-indent')?.value || '  ';
    try {
        const r = await invoke('sql_format', { sql: input, uppercase, indent });
        if (r.success) {
            editors.sqlFormatOutput.setValue(r.result);
            showStatus('sql-format-status', '✓ 格式化成功', 'success');
        } else {
            showStatus('sql-format-status', '✗ ' + r.error, 'error');
        }
    } catch(e) { showStatus('sql-format-status', '✗ ' + e, 'error'); }
}

// ==================== 代码格式化 ====================
async function doCodeFormat() {
    const input = editors.codeFormatInput?.getValue();
    if (!input?.trim()) return;
    const language = document.getElementById('code-format-lang').value;
    const indent = document.getElementById('code-format-indent')?.value || '  ';
    try {
        const r = await invoke('code_format', { code: input, language, indent });
        if (r.success) {
            editors.codeFormatOutput.setValue(r.result);
            showStatus('code-format-status', '✓ 格式化成功', 'success');
        } else {
            showStatus('code-format-status', '✗ ' + r.error, 'error');
        }
    } catch(e) { showStatus('code-format-status', '✗ ' + e, 'error'); }
}

// ==================== 时间差计算 ====================
async function doTimeDiff() {
    const start = document.getElementById('time-diff-start')?.value?.trim();
    const end = document.getElementById('time-diff-end')?.value?.trim();
    const format = document.getElementById('time-diff-format')?.value?.trim();
    if (!start || !end) {
        showStatus('time-diff-status', '请输入开始和结束时间', 'error');
        return;
    }
    try {
        const r = await invoke('time_diff', { start, end, format });
        if (r.success) {
            const resultEl = document.getElementById('time-diff-result');
            resultEl.innerHTML = `
                <table>
                    <tr><th>天数</th><th>小时</th><th>分钟</th><th>秒数</th><th>总秒数</th></tr>
                    <tr>
                        <td>${r.days}</td>
                        <td>${r.hours}</td>
                        <td>${r.minutes}</td>
                        <td>${r.seconds}</td>
                        <td>${r.total_seconds}</td>
                    </tr>
                </table>
                <p style="margin-top:12px;font-size:16px;color:var(--accent)">时间差: ${r.description}</p>
            `;
            showStatus('time-diff-status', '✓ 计算成功', 'success');
        } else {
            showStatus('time-diff-status', '✗ ' + r.error, 'error');
        }
    } catch(e) { showStatus('time-diff-status', '✗ ' + e, 'error'); }
}

// ==================== Markdown 预览 ====================
let markdownDebounceTimer = null;

function initMarkdownPreview() {
    const editor = editors.markdownInput;
    if (!editor) return;

    editor.on('change', () => {
        clearTimeout(markdownDebounceTimer);
        markdownDebounceTimer = setTimeout(async () => {
            const markdown = editor.getValue();
            if (!markdown.trim()) {
                document.getElementById('markdown-preview-output').innerHTML = '';
                return;
            }
            try {
                const r = await invoke('markdown_to_html', { markdown });
                if (r.success) {
                    document.getElementById('markdown-preview-output').innerHTML = r.result;
                }
            } catch(e) {
                console.error('Markdown 预览失败:', e);
            }
        }, 300);
    });
}

// 在编辑器初始化后绑定
setTimeout(initMarkdownPreview, 500);

// ==================== Protobuf 解码 ====================
async function doProtobufDecode() {
    const input = editors.protobufInput?.getValue();
    if (!input?.trim()) return;
    const encoding = document.getElementById('protobuf-encoding').value;
    try {
        const r = await invoke('protobuf_decode', { encoded: input, encoding });
        if (r.success) {
            editors.protobufOutput.setValue(r.result);
            showStatus('protobuf-status', '✓ 解码成功', 'success');
        } else {
            showStatus('protobuf-status', '✗ ' + r.error, 'error');
        }
    } catch(e) { showStatus('protobuf-status', '✗ ' + e, 'error'); }
}

// ==================== MessagePack 解码 ====================
async function doMsgpackDecode() {
    const input = editors.msgpackInput?.getValue();
    if (!input?.trim()) return;
    const encoding = document.getElementById('msgpack-encoding').value;
    try {
        const r = await invoke('msgpack_decode', { encoded: input, encoding });
        if (r.success) {
            editors.msgpackOutput.setValue(r.result);
            showStatus('msgpack-status', '✓ 解码成功', 'success');
        } else {
            showStatus('msgpack-status', '✗ ' + r.error, 'error');
        }
    } catch(e) { showStatus('msgpack-status', '✗ ' + e, 'error'); }
}

// ==================== IP/子网计算器 ====================
async function doIpSubnetCalc() {
    const cidr = document.getElementById('ip-subnet-input')?.value?.trim();
    if (!cidr) {
        showStatus('ip-subnet-status', '请输入 CIDR 格式的 IP 地址', 'error');
        return;
    }
    try {
        const r = await invoke('ip_subnet_calculate', { cidr });
        if (r.success) {
            const resultEl = document.getElementById('ip-subnet-result');
            resultEl.innerHTML = `
                <table>
                    <tr><td>网络地址</td><td class="highlight">${r.network}</td></tr>
                    <tr><td>广播地址</td><td class="highlight">${r.broadcast}</td></tr>
                    <tr><td>子网掩码</td><td>${r.subnet_mask}</td></tr>
                    <tr><td>第一个可用主机</td><td>${r.first_host}</td></tr>
                    <tr><td>最后一个可用主机</td><td>${r.last_host}</td></tr>
                    <tr><td>总主机数</td><td>${r.total_hosts}</td></tr>
                    <tr><td>可用主机数</td><td class="highlight">${r.usable_hosts}</td></tr>
                </table>
            `;
            showStatus('ip-subnet-status', '✓ 计算成功', 'success');
        } else {
            showStatus('ip-subnet-status', '✗ ' + r.error, 'error');
        }
    } catch(e) { showStatus('ip-subnet-status', '✗ ' + e, 'error'); }
}

// ==================== DNS 查询 ====================
async function doDnsLookup() {
    const domain = document.getElementById('dns-domain')?.value?.trim();
    const recordType = document.getElementById('dns-record-type').value;
    if (!domain) {
        showStatus('dns-status', '请输入域名', 'error');
        return;
    }
    try {
        const r = await invoke('dns_lookup', { domain, recordType });
        if (r.success) {
            const resultEl = document.getElementById('dns-result');
            if (r.records.length === 0) {
                resultEl.innerHTML = '<p style="color:var(--text-secondary)">无记录</p>';
            } else {
                resultEl.innerHTML = `
                    <table>
                        <tr><th>记录类型</th><th>值</th></tr>
                        ${r.records.map(record => `<tr><td>${recordType}</td><td class="highlight">${record}</td></tr>`).join('')}
                    </table>
                `;
            }
            showStatus('dns-status', '✓ 查询成功', 'success');
        } else {
            showStatus('dns-status', '✗ ' + r.error, 'error');
        }
    } catch(e) { showStatus('dns-status', '✗ ' + e, 'error'); }
}

// ==================== 端口扫描 ====================
async function doPortScan() {
    const host = document.getElementById('port-scan-host')?.value?.trim();
    const ports = document.getElementById('port-scan-ports')?.value?.trim();
    const timeout = parseInt(document.getElementById('port-scan-timeout')?.value) || 1000;
    if (!host || !ports) {
        showStatus('port-scan-status', '请输入主机和端口', 'error');
        return;
    }
    try {
        const r = await invoke('port_scan', { host, ports, timeout });
        if (r.success) {
            const resultEl = document.getElementById('port-scan-result');
            resultEl.innerHTML = `
                <h3>开放端口 (${r.open_ports.length})</h3>
                ${r.open_ports.length > 0 ?
                    `<div style="display:flex;flex-wrap:wrap;gap:8px">${r.open_ports.map(p => `<span style="background:var(--success);color:#fff;padding:4px 8px;border-radius:4px">${p}</span>`).join('')}</div>` :
                    '<p style="color:var(--text-secondary)">无开放端口</p>'}
                <h3 style="margin-top:16px">关闭端口 (${r.closed_ports.length})</h3>
                ${r.closed_ports.length > 0 ?
                    `<div style="display:flex;flex-wrap:wrap;gap:8px">${r.closed_ports.map(p => `<span style="background:var(--bg-secondary);padding:4px 8px;border-radius:4px">${p}</span>`).join('')}</div>` :
                    '<p style="color:var(--text-secondary)">无关闭端口</p>'}
            `;
            showStatus('port-scan-status', `✓ 扫描完成: ${r.open_ports.length} 开放, ${r.closed_ports.length} 关闭`, 'success');
        } else {
            showStatus('port-scan-status', '✗ ' + r.error, 'error');
        }
    } catch(e) { showStatus('port-scan-status', '✗ ' + e, 'error'); }
}

// ==================== SSL 证书查看 ====================
async function doSslCertLookup() {
    const domain = document.getElementById('ssl-cert-domain')?.value?.trim();
    if (!domain) {
        showStatus('ssl-cert-status', '请输入域名', 'error');
        return;
    }
    try {
        const r = await invoke('ssl_cert_info', { domain });
        if (r.success) {
            const resultEl = document.getElementById('ssl-cert-result');
            resultEl.innerHTML = `
                <table>
                    <tr><td>颁发者</td><td>${r.issuer}</td></tr>
                    <tr><td>主题</td><td>${r.subject}</td></tr>
                    <tr><td>生效时间</td><td>${r.not_before}</td></tr>
                    <tr><td>过期时间</td><td>${r.not_after}</td></tr>
                    <tr><td>序列号</td><td style="font-family:monospace;font-size:12px">${r.serial_number}</td></tr>
                    <tr><td>指纹 (SHA-256)</td><td style="font-family:monospace;font-size:12px">${r.fingerprint}</td></tr>
                </table>
            `;
            showStatus('ssl-cert-status', '✓ 查询成功', 'success');
        } else {
            showStatus('ssl-cert-status', '✗ ' + r.error, 'error');
        }
    } catch(e) { showStatus('ssl-cert-status', '✗ ' + e, 'error'); }
}

// ==================== WebSocket 客户端 ====================
let wsConnectionId = null;

function appendWsMessage(text, type = 'info') {
    const container = document.getElementById('ws-messages');
    if (!container) return;
    const msg = document.createElement('div');
    msg.className = `ws-message ${type}`;
    msg.textContent = text;
    container.appendChild(msg);
    container.scrollTop = container.scrollHeight;
}

async function doWsConnect() {
    const url = document.getElementById('ws-url')?.value?.trim();
    if (!url) {
        showStatus('ws-status', '请输入 WebSocket URL', 'error');
        return;
    }
    try {
        appendWsMessage(`正在连接 ${url}...`, 'info');
        const r = await invoke('ws_connect', { url });
        if (r.success) {
            wsConnectionId = r.connection_id;
            document.getElementById('ws-connect-btn').disabled = true;
            document.getElementById('ws-close-btn').disabled = false;
            document.getElementById('ws-send-btn').disabled = false;
            appendWsMessage('连接成功', 'success');
            showStatus('ws-status', '✓ 已连接', 'success');

            // 监听消息
            const { listen } = window.__TAURI__.event;
            listen(`ws-message-${wsConnectionId}`, (event) => {
                appendWsMessage(`收到: ${event.payload}`, 'received');
            });
            listen(`ws-close-${wsConnectionId}`, () => {
                appendWsMessage('连接已关闭', 'info');
                resetWsUI();
            });
        } else {
            appendWsMessage(`连接失败: ${r.error}`, 'error');
            showStatus('ws-status', '✗ ' + r.error, 'error');
        }
    } catch(e) {
        appendWsMessage(`连接失败: ${e}`, 'error');
        showStatus('ws-status', '✗ ' + e, 'error');
    }
}

async function doWsSend() {
    const message = document.getElementById('ws-message')?.value;
    if (!message || !wsConnectionId) return;
    try {
        await invoke('ws_send', { connectionId: wsConnectionId, message });
        appendWsMessage(`发送: ${message}`, 'sent');
        document.getElementById('ws-message').value = '';
    } catch(e) {
        appendWsMessage(`发送失败: ${e}`, 'error');
    }
}

async function doWsClose() {
    if (!wsConnectionId) return;
    try {
        await invoke('ws_close', { connectionId: wsConnectionId });
        appendWsMessage('已断开连接', 'info');
    } catch(e) {
        console.error('关闭 WebSocket 失败:', e);
    }
    resetWsUI();
}

function resetWsUI() {
    wsConnectionId = null;
    document.getElementById('ws-connect-btn').disabled = false;
    document.getElementById('ws-close-btn').disabled = true;
    document.getElementById('ws-send-btn').disabled = true;
}

// ==================== Mock 数据生成 ====================
async function doMockGenerate() {
    const dataType = document.getElementById('mock-data-type').value;
    const count = parseInt(document.getElementById('mock-data-count')?.value) || 10;
    try {
        const r = await invoke('mock_generate', { dataType, count, locale: 'zh_CN' });
        if (r.success) {
            editors.mockOutput.setValue(r.result);
            showStatus('mock-status', `✓ 生成 ${count} 条数据`, 'success');
        } else {
            showStatus('mock-status', '✗ ' + r.error, 'error');
        }
    } catch(e) { showStatus('mock-status', '✗ ' + e, 'error'); }
}

// ==================== 正则收藏夹 ====================
async function loadRegexFavorites() {
    try {
        const favorites = await invoke('regex_favorites_list');
        const container = document.getElementById('regex-favorites-list');
        if (!container) return;

        if (favorites.length === 0) {
            container.innerHTML = '<p style="color:var(--text-secondary);padding:12px">暂无收藏的正则表达式</p>';
            return;
        }

        container.innerHTML = favorites.map(fav => `
            <div class="regex-fav-item">
                <span class="regex-fav-name">${escapeHtml(fav.name)}</span>
                <span class="regex-fav-pattern">${escapeHtml(fav.pattern)}</span>
                <span class="regex-fav-category">${escapeHtml(fav.category)}</span>
                <div class="regex-fav-actions">
                    <button class="btn btn-ghost btn-sm" onclick="copyToClipboard('${escapeHtml(fav.pattern)}')">复制</button>
                    <button class="btn btn-ghost btn-sm" onclick="deleteRegexFavorite('${fav.id}')">删除</button>
                </div>
            </div>
        `).join('');
    } catch(e) {
        console.error('加载正则收藏失败:', e);
    }
}

async function doRegexFavSave() {
    const name = document.getElementById('regex-fav-name')?.value?.trim();
    const pattern = document.getElementById('regex-fav-pattern')?.value?.trim();
    const category = document.getElementById('regex-fav-category')?.value?.trim() || '默认';
    if (!name || !pattern) {
        showStatus('regex-fav-status', '请输入名称和正则表达式', 'error');
        return;
    }
    try {
        await invoke('regex_favorites_save', { name, pattern, category });
        showStatus('regex-fav-status', '✓ 保存成功', 'success');
        document.getElementById('regex-fav-name').value = '';
        document.getElementById('regex-fav-pattern').value = '';
        document.getElementById('regex-fav-category').value = '';
        await loadRegexFavorites();
    } catch(e) { showStatus('regex-fav-status', '✗ ' + e, 'error'); }
}

async function deleteRegexFavorite(id) {
    try {
        await invoke('regex_favorites_delete', { id });
        showStatus('regex-fav-status', '✓ 已删除', 'success');
        await loadRegexFavorites();
    } catch(e) { showStatus('regex-fav-status', '✗ ' + e, 'error'); }
}

// ==================== Changelog 生成 ====================
async function doChangelogGenerate() {
    const repoPath = document.getElementById('changelog-repo-path')?.value?.trim();
    const fromRef = document.getElementById('changelog-from')?.value?.trim() || null;
    const toRef = document.getElementById('changelog-to')?.value?.trim() || null;
    if (!repoPath) {
        showStatus('changelog-status', '请输入仓库路径', 'error');
        return;
    }
    try {
        const r = await invoke('changelog_generate', { repoPath, fromRef, toRef });
        if (r.success) {
            editors.changelogOutput.setValue(r.result);
            showStatus('changelog-status', '✓ Changelog 生成成功', 'success');
        } else {
            showStatus('changelog-status', '✗ ' + r.error, 'error');
        }
    } catch(e) { showStatus('changelog-status', '✗ ' + e, 'error'); }
}

// ==================== 新增工具初始化 ====================

// 编辑器初始化（追加到 initNewToolEditors）
function initNewToolEditors2() {
    // Hex 编解码
    editors.hexInput = makePlainInputEditor('hex-input-editor');
    editors.hexOutput = makePlainOutputEditor('hex-output-editor');

    // JSON Diff
    editors.jsonDiffOld = makeInputEditor('json-diff-old-editor', 'javascript');
    editors.jsonDiffNew = makeInputEditor('json-diff-new-editor', 'javascript');

    // cURL 生成器
    editors.curlHeaders = makePlainInputEditor('curl-headers-editor');
    editors.curlBody = makePlainInputEditor('curl-body-editor');
    editors.curlOutput = makePlainOutputEditor('curl-output-editor');
}

// 页面初始化映射（追加）
const newToolInitMap2 = {
    'hex-codec': () => { editors.hexInput?.refresh(); editors.hexOutput?.refresh(); },
    'json-diff': () => { editors.jsonDiffOld?.refresh(); editors.jsonDiffNew?.refresh(); },
    'curl-generator': () => { editors.curlHeaders?.refresh(); editors.curlBody?.refresh(); editors.curlOutput?.refresh(); },
    'env-vars': () => { loadEnvVars(); },
    'system-info': () => { loadSystemInfo(); },
    'color-palette': () => { doGeneratePalette(); },
};

// ==================== Hex 编解码 ====================
async function doHexEncode() {
    const input = editors.hexInput?.getValue();
    if (!input?.trim()) return;
    try {
        const r = await invoke('hex_encode', { input });
        if (r.success) {
            editors.hexOutput.setValue(r.result);
            showStatus('hex-status', '✓ 编码成功', 'success');
        } else {
            showStatus('hex-status', '✗ ' + r.error, 'error');
        }
    } catch(e) { showStatus('hex-status', '✗ ' + e, 'error'); }
}

async function doHexDecode() {
    const input = editors.hexInput?.getValue();
    if (!input?.trim()) return;
    try {
        const r = await invoke('hex_decode', { input });
        if (r.success) {
            editors.hexOutput.setValue(r.result);
            showStatus('hex-status', '✓ 解码成功', 'success');
        } else {
            showStatus('hex-status', '✗ ' + r.error, 'error');
        }
    } catch(e) { showStatus('hex-status', '✗ ' + e, 'error'); }
}

// ==================== JSON Diff ====================
async function doJsonDiff() {
    const oldJson = editors.jsonDiffOld?.getValue();
    const newJson = editors.jsonDiffNew?.getValue();
    if (!oldJson?.trim() || !newJson?.trim()) {
        showStatus('json-diff-status', '请输入两个 JSON', 'error');
        return;
    }
    try {
        const r = await invoke('json_diff', { oldJson, newJson });
        if (r.success) {
            const resultEl = document.getElementById('json-diff-result');
            let html = '';

            if (r.added.length === 0 && r.removed.length === 0 && r.modified.length === 0) {
                html = '<p style="color:var(--success)">✓ 两个 JSON 完全相同</p>';
            } else {
                if (r.removed.length > 0) {
                    html += '<h3 style="color:var(--error);margin-bottom:8px">删除 (' + r.removed.length + ')</h3>';
                    html += '<div style="margin-bottom:12px">';
                    r.removed.forEach(item => {
                        html += '<div style="color:var(--error);font-family:monospace;font-size:13px">- ' + escapeHtml(item) + '</div>';
                    });
                    html += '</div>';
                }
                if (r.added.length > 0) {
                    html += '<h3 style="color:var(--success);margin-bottom:8px">新增 (' + r.added.length + ')</h3>';
                    html += '<div style="margin-bottom:12px">';
                    r.added.forEach(item => {
                        html += '<div style="color:var(--success);font-family:monospace;font-size:13px">+ ' + escapeHtml(item) + '</div>';
                    });
                    html += '</div>';
                }
                if (r.modified.length > 0) {
                    html += '<h3 style="color:var(--warning);margin-bottom:8px">修改 (' + r.modified.length + ')</h3>';
                    html += '<div>';
                    r.modified.forEach(item => {
                        html += '<div style="color:var(--warning);font-family:monospace;font-size:13px">~ ' + escapeHtml(item) + '</div>';
                    });
                    html += '</div>';
                }
            }

            resultEl.innerHTML = html;
            showStatus('json-diff-status', '✓ 对比完成', 'success');
        } else {
            showStatus('json-diff-status', '✗ ' + r.error, 'error');
        }
    } catch(e) { showStatus('json-diff-status', '✗ ' + e, 'error'); }
}

// ==================== 正则可视化 ====================
async function doRegexVisualize() {
    const pattern = document.getElementById('regex-visual-input')?.value?.trim();
    if (!pattern) {
        showStatus('regex-visual-status', '请输入正则表达式', 'error');
        return;
    }
    try {
        const r = await invoke('regex_visualize', { pattern });
        if (r.success) {
            const container = document.getElementById('regex-visual-result');
            let html = '<div class="regex-visual-nodes">';

            r.nodes.forEach(node => {
                html += `<div class="regex-node ${node.node_type}" title="${escapeHtml(node.description)}">
                    <span class="node-content">${escapeHtml(node.content)}</span>
                    <span class="node-desc">${escapeHtml(node.description)}</span>
                </div>`;
            });

            html += '</div>';
            container.innerHTML = html;
            showStatus('regex-visual-status', '✓ 可视化成功', 'success');
        } else {
            showStatus('regex-visual-status', '✗ ' + r.error, 'error');
        }
    } catch(e) { showStatus('regex-visual-status', '✗ ' + e, 'error'); }
}

// ==================== 环境变量查看 ====================
async function loadEnvVars() {
    const filter = document.getElementById('env-vars-filter')?.value?.trim() || null;
    try {
        const vars = await invoke('env_vars_list', { filter });
        const container = document.getElementById('env-vars-list');

        if (vars.length === 0) {
            container.innerHTML = '<p style="color:var(--text-secondary);padding:12px">无匹配的环境变量</p>';
            return;
        }

        container.innerHTML = vars.map(v => `
            <div class="env-var-item">
                <span class="env-var-name">${escapeHtml(v.name)}</span>
                <span class="env-var-value">${escapeHtml(v.value)}</span>
            </div>
        `).join('');

        showStatus('env-vars-status', `✓ ${vars.length} 个环境变量`, 'success');
    } catch(e) {
        showStatus('env-vars-status', '✗ ' + e, 'error');
    }
}

// ==================== 系统信息 ====================
function formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function formatUptime(seconds) {
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    if (days > 0) return `${days}天 ${hours}小时 ${mins}分钟`;
    if (hours > 0) return `${hours}小时 ${mins}分钟`;
    return `${mins}分钟`;
}

function getProgressClass(usage) {
    if (usage < 0.6) return 'low';
    if (usage < 0.8) return 'medium';
    return 'high';
}

async function loadSystemInfo() {
    try {
        const info = await invoke('system_info');
        const container = document.getElementById('system-info-display');

        container.innerHTML = `
            <div class="system-info-card">
                <h3>💻 操作系统</h3>
                <div class="info-value">${escapeHtml(info.os_name)}</div>
                <div class="info-detail">${escapeHtml(info.arch)}</div>
            </div>
            <div class="system-info-card">
                <h3>🖥️ 主机名</h3>
                <div class="info-value">${escapeHtml(info.hostname)}</div>
                <div class="info-detail">用户: ${escapeHtml(info.username)}</div>
            </div>
            <div class="system-info-card">
                <h3>⚡ CPU</h3>
                <div class="info-value">${info.cpu_cores} 核</div>
                <div class="info-detail">逻辑处理器</div>
            </div>
            <div class="system-info-card">
                <h3>🧠 内存</h3>
                <div class="info-value">${formatBytes(info.used_memory)} / ${formatBytes(info.total_memory)}</div>
                <div class="system-info-progress">
                    <div class="system-info-progress-bar ${getProgressClass(info.memory_usage)}" style="width:${(info.memory_usage * 100).toFixed(1)}%"></div>
                </div>
                <div class="info-detail">${(info.memory_usage * 100).toFixed(1)}% 已使用</div>
            </div>
            <div class="system-info-card">
                <h3>💾 磁盘</h3>
                <div class="info-value">${formatBytes(info.disk_used)} / ${formatBytes(info.disk_total)}</div>
                <div class="system-info-progress">
                    <div class="system-info-progress-bar ${getProgressClass(info.disk_usage)}" style="width:${(info.disk_usage * 100).toFixed(1)}%"></div>
                </div>
                <div class="info-detail">${(info.disk_usage * 100).toFixed(1)}% 已使用</div>
            </div>
            <div class="system-info-card">
                <h3>⏱️ 运行时间</h3>
                <div class="info-value">${formatUptime(info.uptime)}</div>
                <div class="info-detail">自上次启动</div>
            </div>
        `;

        showStatus('system-info-status', '✓ 信息已加载', 'success');
    } catch(e) {
        showStatus('system-info-status', '✗ ' + e, 'error');
    }
}

// ==================== cURL 生成器 ====================
async function doGenerateCurl() {
    const method = document.getElementById('curl-method').value;
    const url = document.getElementById('curl-url')?.value?.trim();
    if (!url) {
        showStatus('curl-status', '请输入 URL', 'error');
        return;
    }

    // 解析 headers
    const headersText = editors.curlHeaders?.getValue() || '';
    const headers = headersText.split('\n')
        .filter(line => line.trim())
        .map(line => {
            const idx = line.indexOf(':');
            if (idx === -1) return null;
            return [line.substring(0, idx).trim(), line.substring(idx + 1).trim()];
        })
        .filter(h => h !== null);

    const body = editors.curlBody?.getValue() || null;
    const followRedirects = document.getElementById('curl-follow-redirects')?.checked ?? true;
    const insecure = document.getElementById('curl-insecure')?.checked ?? false;
    const timeout = parseInt(document.getElementById('curl-timeout')?.value) || 30;

    try {
        const curl = await invoke('generate_curl', {
            req: {
                method,
                url,
                headers,
                body: body || null,
                auth_type: null,
                auth_value: null,
                timeout,
                follow_redirects: followRedirects,
                insecure
            }
        });
        editors.curlOutput.setValue(curl);
        showStatus('curl-status', '✓ cURL 已生成', 'success');
    } catch(e) {
        showStatus('curl-status', '✗ ' + e, 'error');
    }
}

// ==================== 颜色调色板 ====================
async function doGeneratePalette() {
    const baseColor = document.getElementById('palette-base-hex')?.value?.trim();
    const paletteType = document.getElementById('palette-type').value;

    if (!baseColor || !/^#[0-9a-fA-F]{6}$/.test(baseColor)) {
        showStatus('color-palette-status', '请输入有效的颜色值 (如 #3498db)', 'error');
        return;
    }

    try {
        const r = await invoke('generate_color_palette', { baseColor, paletteType });
        if (r.success) {
            const container = document.getElementById('color-palette-display');
            let html = '';

            r.palettes.forEach(palette => {
                html += `<div class="palette-group">
                    <h3>${escapeHtml(palette.name)}</h3>
                    <div class="palette-colors">`;

                palette.colors.forEach(color => {
                    html += `<div class="palette-color" style="background:${color}" title="${color}" onclick="copyToClipboard('${color}')">
                        <span class="palette-color-hex">${color}</span>
                    </div>`;
                });

                html += '</div></div>';
            });

            container.innerHTML = html;
            showStatus('color-palette-status', '✓ 调色板已生成', 'success');
        } else {
            showStatus('color-palette-status', '✗ ' + r.error, 'error');
        }
    } catch(e) {
        showStatus('color-palette-status', '✗ ' + e, 'error');
    }
}

// ==================== 版本更新检查 ====================
function simpleMarkdownToHtml(md) {
    if (!md) return '';
    let html = escapeHtml(md);
    // 标题
    html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
    html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
    html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');
    // 粗体
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    // 行内代码
    html = html.replace(/`(.+?)`/g, '<code>$1</code>');
    // 无序列表
    html = html.replace(/^[*-] (.+)$/gm, '<li>$1</li>');
    html = html.replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>');
    // 有序列表
    html = html.replace(/^\d+\. (.+)$/gm, '<li>$1</li>');
    // 换行
    html = html.replace(/\n\n/g, '</p><p>');
    html = '<p>' + html + '</p>';
    return html;
}

let updateInfoCache = null;

function showUpdateModal(updateInfo) {
    updateInfoCache = updateInfo;
    document.getElementById('update-version').textContent = updateInfo.latest_version;
    document.getElementById('current-version').textContent = updateInfo.current_version;
    document.getElementById('release-notes').innerHTML = simpleMarkdownToHtml(updateInfo.release_notes);
    document.getElementById('update-modal').classList.add('active');
}

function hideUpdateModal() {
    document.getElementById('update-modal').classList.remove('active');
    updateInfoCache = null;
}

function ignoreUpdateVersion() {
    if (updateInfoCache) {
        localStorage.setItem('ignoredUpdateVersion', updateInfoCache.latest_version);
    }
    hideUpdateModal();
}

async function openDownloadUrl() {
    if (updateInfoCache) {
        const { openUrl } = window.__TAURI__.opener;
        await openUrl(updateInfoCache.download_url);
    }
    hideUpdateModal();
}

async function checkUpdateOnStartup() {
    try {
        const updateInfo = await invoke('check_update');
        if (updateInfo.has_update) {
            const ignoredVersion = localStorage.getItem('ignoredUpdateVersion');
            if (ignoredVersion !== updateInfo.latest_version) {
                showUpdateModal(updateInfo);
            }
        }
    } catch (error) {
        console.log('更新检查失败:', error);
    }
}

async function checkUpdateManually() {
    try {
        const updateInfo = await invoke('check_update');
        if (updateInfo.has_update) {
            showUpdateModal(updateInfo);
        } else {
            alert('已是最新版本 v' + updateInfo.current_version);
        }
    } catch (error) {
        alert('检查更新失败: ' + error);
    }
}
