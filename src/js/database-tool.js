// ==================== 数据库工具 ====================

const dbState = {
    connections: [],
    currentConnection: null,
    currentDatabase: null,
    tabs: [],
    activeTabId: null,
    tabSeq: 0,
    schemaCache: {},
    queryHistory: [],
    queryFavorites: [],
    messageLog: [],
    messageFilter: 'error',
    activeResultTab: 'result',
    messageUnread: 0,
    connectionHealth: 'idle', // idle | connected | error | disconnected
};

const DB_MESSAGE_MAX = 500;

const DB_HISTORY_KEY = 'dbtoolkit.queryHistory.v1';
const DB_FAVORITES_KEY = 'dbtoolkit.queryFavorites.v1';
const DB_HISTORY_MAX = 200;

const SQL_KEYWORDS = [
    'SELECT', 'FROM', 'WHERE', 'GROUP BY', 'ORDER BY', 'HAVING', 'LIMIT', 'OFFSET',
    'INSERT INTO', 'VALUES', 'UPDATE', 'SET', 'DELETE FROM',
    'CREATE TABLE', 'CREATE INDEX', 'CREATE VIEW', 'CREATE DATABASE',
    'ALTER TABLE', 'ADD COLUMN', 'DROP COLUMN', 'DROP TABLE', 'DROP INDEX',
    'JOIN', 'LEFT JOIN', 'RIGHT JOIN', 'INNER JOIN', 'FULL OUTER JOIN', 'ON', 'AS',
    'AND', 'OR', 'NOT', 'IN', 'BETWEEN', 'LIKE', 'IS NULL', 'IS NOT NULL',
    'DISTINCT', 'COUNT', 'SUM', 'AVG', 'MIN', 'MAX',
    'UNION', 'UNION ALL', 'EXISTS', 'CASE', 'WHEN', 'THEN', 'ELSE', 'END',
    'BEGIN', 'COMMIT', 'ROLLBACK', 'EXPLAIN', 'DESC', 'DESCRIBE', 'SHOW',
    'PRIMARY KEY', 'FOREIGN KEY', 'REFERENCES', 'UNIQUE', 'DEFAULT', 'AUTO_INCREMENT',
    'INT', 'BIGINT', 'VARCHAR', 'TEXT', 'DATETIME', 'TIMESTAMP', 'BOOLEAN', 'DECIMAL',
];

function getActiveTab() {
    return dbState.tabs.find(t => t.id === dbState.activeTabId) || null;
}

function getActiveEditor() {
    const tab = getActiveTab();
    return tab ? tab.editor : null;
}

// 这些函数在后续模块中实现，先用桩防止初始化时 ReferenceError
function loadHistoryFromStorage() {
    try {
        const h = localStorage.getItem(DB_HISTORY_KEY);
        if (h) dbState.queryHistory = JSON.parse(h) || [];
        const f = localStorage.getItem(DB_FAVORITES_KEY);
        if (f) dbState.queryFavorites = JSON.parse(f) || [];
    } catch (_) {
        dbState.queryHistory = [];
        dbState.queryFavorites = [];
    }
}

// ============================================================
// SQL 自动补全
// ============================================================

function schemaKey(connId, db) { return `${connId || ''}::${db || ''}`; }

function primeSchemaCache(connId, db, tableNames) {
    const key = schemaKey(connId, db);
    const existing = dbState.schemaCache[key] || {tables: [], columns: {}};
    existing.tables = Array.from(new Set(tableNames));
    dbState.schemaCache[key] = existing;
}

function getCachedTables() {
    const key = schemaKey(dbState.currentConnection, dbState.currentDatabase);
    return (dbState.schemaCache[key] && dbState.schemaCache[key].tables) || [];
}

function getCachedColumns(tableName) {
    const key = schemaKey(dbState.currentConnection, dbState.currentDatabase);
    const cache = dbState.schemaCache[key];
    if (!cache) return null;
    return cache.columns[tableName] || null;
}

async function loadColumnsIntoCache(tableName) {
    const key = schemaKey(dbState.currentConnection, dbState.currentDatabase);
    const cache = dbState.schemaCache[key];
    if (!cache) return [];
    if (Array.isArray(cache.columns[tableName])) return cache.columns[tableName];
    if (cache.columns[tableName] === 'loading') return [];
    cache.columns[tableName] = 'loading';
    try {
        const schema = await invoke('db_get_table_schema', {
            connectionId: dbState.currentConnection,
            database: dbState.currentDatabase,
            table: tableName,
        });
        cache.columns[tableName] = (schema.columns || []).map(c => c.name);
        return cache.columns[tableName];
    } catch (_) {
        delete cache.columns[tableName];
        return [];
    }
}

function dbSqlHint(cm) {
    const cursor = cm.getCursor();
    const line = cm.getLine(cursor.line);
    const upToCursor = line.slice(0, cursor.ch);

    // 解析光标前的 token
    const dotMatch = /([a-zA-Z_][\w]*)\.([a-zA-Z_][\w]*)?$/.exec(upToCursor);
    if (dotMatch) {
        const tableName = dotMatch[1];
        const prefix = dotMatch[2] || '';
        const tables = getCachedTables();
        const matched = tables.find(t => t.toLowerCase() === tableName.toLowerCase());
        if (matched) {
            const cols = getCachedColumns(matched);
            if (cols === null) {
                // 异步加载并稍后再触发
                loadColumnsIntoCache(matched).then(() => {
                    if (cm.state.completionActive) cm.state.completionActive.close();
                    cm.showHint({hint: dbSqlHint, completeSingle: false});
                });
                return null;
            }
            const list = cols
                .filter(c => c.toLowerCase().startsWith(prefix.toLowerCase()))
                .map(c => ({text: c, displayText: c, className: 'CodeMirror-hint-column'}));
            return {
                list,
                from: CodeMirror.Pos(cursor.line, cursor.ch - prefix.length),
                to: cursor,
            };
        }
    }

    // 普通标识符补全：关键字 + 表名
    const wordMatch = /([a-zA-Z_][\w]*)$/.exec(upToCursor);
    const prefix = wordMatch ? wordMatch[1] : '';
    if (prefix.length === 0 && wordMatch === null) return null;

    const tables = getCachedTables();
    const prefixLower = prefix.toLowerCase();
    const tableHints = tables
        .filter(t => t.toLowerCase().startsWith(prefixLower))
        .map(t => ({text: t, displayText: t, className: 'CodeMirror-hint-table'}));
    const keywordHints = SQL_KEYWORDS
        .filter(k => k.toLowerCase().startsWith(prefixLower))
        .map(k => ({text: k, displayText: k, className: 'CodeMirror-hint-keyword'}));

    const list = [...tableHints, ...keywordHints];
    if (list.length === 0) return null;

    return {
        list,
        from: CodeMirror.Pos(cursor.line, cursor.ch - prefix.length),
        to: cursor,
    };
}

function updateExecuteButton() {
    const btn = document.getElementById('db-execute');
    if (!btn) return;
    const tab = getActiveTab();
    if (tab && tab.running) {
        btn.textContent = '取消';
        btn.classList.add('btn-danger');
    } else {
        btn.textContent = '执行';
        btn.classList.remove('btn-danger');
    }
}

const historyPanelState = {
    open: false,
    mode: 'history', // 'history' | 'favorites'
    search: '',
};

function toggleHistoryPanel(mode) {
    const panel = document.getElementById('db-history-panel');
    const backdrop = document.getElementById('db-history-backdrop');
    if (!panel) return;
    if (historyPanelState.open && historyPanelState.mode === mode) {
        closeHistoryPanel();
        return;
    }
    historyPanelState.open = true;
    historyPanelState.mode = mode;
    panel.hidden = false;
    if (backdrop) backdrop.hidden = false;
    panel.querySelectorAll('.db-history-tab').forEach(b => {
        b.classList.toggle('active', b.dataset.mode === mode);
    });
    renderHistoryList();
}

function closeHistoryPanel() {
    const panel = document.getElementById('db-history-panel');
    const backdrop = document.getElementById('db-history-backdrop');
    if (panel) panel.hidden = true;
    if (backdrop) backdrop.hidden = true;
    historyPanelState.open = false;
}

function renderHistoryList() {
    const list = document.getElementById('db-history-list');
    if (!list) return;
    const items = (historyPanelState.mode === 'favorites'
        ? dbState.queryFavorites
        : dbState.queryHistory) || [];
    const search = historyPanelState.search.trim().toLowerCase();
    const filtered = search
        ? items.filter(e => (e.sql || '').toLowerCase().includes(search) ||
                            (e.connectionName || '').toLowerCase().includes(search))
        : items;

    if (filtered.length === 0) {
        list.innerHTML = `<div class="db-history-empty">${search ? '无匹配项' : '暂无记录'}</div>`;
        return;
    }

    list.innerHTML = filtered.map(e => {
        const preview = (e.sql || '').replace(/\s+/g, ' ').slice(0, 120);
        const time = formatRelativeTime(e.timestamp);
        const statusClass = e.success ? 'ok' : 'err';
        const meta = [
            e.connectionName || '',
            e.database || '',
            e.durationMs != null ? `${e.durationMs}ms` : '',
            e.success ? `${e.rowCount || 0} 行` : '失败',
        ].filter(Boolean).join(' · ');
        const isFav = dbState.queryFavorites.some(f => f.sql === e.sql);
        return `<div class="db-history-item ${statusClass}" data-id="${escapeHtmlAttr(e.id)}">
            <div class="db-history-item-meta">
                <span class="db-history-time">${escapeHtml(time)}</span>
                <span class="db-history-meta">${escapeHtml(meta)}</span>
                <span class="db-history-actions">
                    <button class="db-history-fav ${isFav ? 'active' : ''}" data-action="star" title="${isFav ? '取消收藏' : '收藏'}">★</button>
                    <button class="db-history-copy" data-action="copy" title="复制 SQL">⧉</button>
                    <button class="db-history-del" data-action="del" title="删除">✕</button>
                </span>
            </div>
            <div class="db-history-sql">${escapeHtml(preview)}${(e.sql || '').length > 120 ? '…' : ''}</div>
        </div>`;
    }).join('');

    list.querySelectorAll('.db-history-item').forEach(node => {
        const id = node.dataset.id;
        node.addEventListener('click', evt => {
            const action = evt.target.dataset && evt.target.dataset.action;
            if (action === 'star') return toggleFavorite(id);
            if (action === 'copy') return copyHistoryEntry(id);
            if (action === 'del') return deleteHistoryEntry(id);
            loadHistoryEntryIntoTab(id);
        });
    });
}

function formatRelativeTime(ts) {
    if (!ts) return '';
    const diff = Date.now() - ts;
    const sec = Math.floor(diff / 1000);
    if (sec < 60) return `${sec}s 前`;
    const min = Math.floor(sec / 60);
    if (min < 60) return `${min}m 前`;
    const hr = Math.floor(min / 60);
    if (hr < 24) return `${hr}h 前`;
    const d = new Date(ts);
    return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function findHistoryEntry(id) {
    return dbState.queryHistory.find(e => e.id === id) ||
           dbState.queryFavorites.find(e => e.id === id);
}

function loadHistoryEntryIntoTab(id) {
    const entry = findHistoryEntry(id);
    if (!entry) return;
    const active = getActiveTab();
    if (active && active.editor && !active.editor.getValue().trim()) {
        active.editor.setValue(entry.sql);
        active.editor.focus();
    } else {
        createTab({name: '历史', sql: entry.sql});
    }
}

function copyHistoryEntry(id) {
    const entry = findHistoryEntry(id);
    if (!entry) return;
    navigator.clipboard.writeText(entry.sql).then(() =>
        dbShowStatus('已复制 SQL', 'success')
    ).catch(() => dbShowStatus('复制失败', 'error'));
}

function deleteHistoryEntry(id) {
    if (historyPanelState.mode === 'favorites') {
        dbState.queryFavorites = dbState.queryFavorites.filter(e => e.id !== id);
    } else {
        dbState.queryHistory = dbState.queryHistory.filter(e => e.id !== id);
    }
    persistHistory();
    renderHistoryList();
}

function toggleFavorite(id) {
    const entry = findHistoryEntry(id);
    if (!entry) return;
    const idx = dbState.queryFavorites.findIndex(f => f.sql === entry.sql);
    if (idx >= 0) {
        dbState.queryFavorites.splice(idx, 1);
    } else {
        const newId = (crypto.randomUUID && crypto.randomUUID()) || String(Date.now());
        dbState.queryFavorites.unshift({...entry, id: newId});
        if (dbState.queryFavorites.length > DB_HISTORY_MAX) {
            dbState.queryFavorites.length = DB_HISTORY_MAX;
        }
    }
    persistHistory();
    renderHistoryList();
}

function persistHistory() {
    try {
        localStorage.setItem(DB_HISTORY_KEY, JSON.stringify(dbState.queryHistory));
        localStorage.setItem(DB_FAVORITES_KEY, JSON.stringify(dbState.queryFavorites));
    } catch (_) {}
}

function clearHistoryList() {
    if (historyPanelState.mode === 'favorites') {
        if (!confirm('清空所有收藏？')) return;
        dbState.queryFavorites = [];
    } else {
        if (!confirm('清空所有历史？')) return;
        dbState.queryHistory = [];
    }
    persistHistory();
    renderHistoryList();
}

function recordHistory(entry) {
    // 模块 3 中实现：写入 dbState.queryHistory + localStorage
    if (!entry || !entry.sql) return;
    const e = Object.assign({
        id: (crypto.randomUUID && crypto.randomUUID()) || String(Date.now()),
        timestamp: Date.now(),
    }, entry);
    dbState.queryHistory.unshift(e);
    if (dbState.queryHistory.length > DB_HISTORY_MAX) {
        dbState.queryHistory.length = DB_HISTORY_MAX;
    }
    try {
        localStorage.setItem(DB_HISTORY_KEY, JSON.stringify(dbState.queryHistory));
    } catch (_) {}
}

// ============================================================
// 消息日志面板
// ============================================================

function recordMessage(level, sql, message) {
    const entry = {
        timestamp: Date.now(),
        level,    // 'info' | 'warning' | 'error'
        sql: sql || '',
        message: String(message || ''),
    };
    dbState.messageLog.unshift(entry);
    if (dbState.messageLog.length > DB_MESSAGE_MAX) {
        dbState.messageLog.length = DB_MESSAGE_MAX;
    }
    // 未读计数（仅当用户没在看消息面板）
    if (level !== 'info' && dbState.activeResultTab !== 'message') {
        dbState.messageUnread++;
        updateMessageBadge();
    }
    if (dbState.activeResultTab === 'message') {
        renderMessageList();
    }
}

function updateMessageBadge() {
    const badge = document.getElementById('db-msg-badge');
    if (!badge) return;
    if (dbState.messageUnread > 0) {
        badge.textContent = dbState.messageUnread > 99 ? '99+' : String(dbState.messageUnread);
        badge.hidden = false;
    } else {
        badge.hidden = true;
    }
}

function switchResultTab(name) {
    dbState.activeResultTab = name;
    document.querySelectorAll('.db-result-tabs .tab').forEach(t => {
        t.classList.toggle('active', t.dataset.tab === name);
    });
    const resultEl = document.getElementById('db-result-content');
    const messageEl = document.getElementById('db-message-content');
    if (resultEl) resultEl.hidden = name !== 'result';
    if (messageEl) messageEl.hidden = name !== 'message';

    if (name === 'message') {
        dbState.messageUnread = 0;
        updateMessageBadge();
        renderMessageList();
    }
}

function renderMessageList() {
    const list = document.getElementById('db-message-list');
    if (!list) return;
    const filter = dbState.messageFilter;
    const filtered = dbState.messageLog.filter(m => {
        if (filter === 'all') return true;
        if (filter === 'error') return m.level === 'error';
        if (filter === 'warning') return m.level === 'warning' || m.level === 'error';
        return true;
    });

    if (filtered.length === 0) {
        list.innerHTML = '<div class="db-message-empty">无消息</div>';
        return;
    }

    list.innerHTML = filtered.map(m => {
        const t = new Date(m.timestamp);
        const time = `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}:${String(t.getSeconds()).padStart(2, '0')}`;
        const sqlPreview = m.sql ? `<div class="db-message-sql">${escapeHtml(m.sql.replace(/\s+/g, ' ').slice(0, 200))}</div>` : '';
        return `<div class="db-message-item ${escapeHtml(m.level)}">
            <span class="db-message-time">${time}</span>
            <span class="db-message-level">${m.level.toUpperCase()}</span>
            <div class="db-message-body">${escapeHtml(m.message)}${sqlPreview}</div>
        </div>`;
    }).join('');
}

function clearMessageLog() {
    if (!confirm('清空所有消息？')) return;
    dbState.messageLog = [];
    dbState.messageUnread = 0;
    updateMessageBadge();
    renderMessageList();
}

// ============================================================
// 连接活跃状态
// ============================================================

function updateConnectionHealth(state) {
    // state: 'idle' | 'connected' | 'error' | 'disconnected'
    dbState.connectionHealth = state;
    refreshConnectionBadge();
    if (state === 'disconnected') {
        recordMessage('error', '', '连接似乎已断开，请重新连接');
    }
}

function refreshConnectionBadge() {
    const el = document.getElementById('db-conn-status');
    const text = document.getElementById('db-conn-text');
    if (!el || !text) return;

    el.dataset.state = dbState.connectionHealth;
    const conn = dbState.connections.find(c => c.id === dbState.currentConnection);
    if (!conn) {
        text.textContent = '未连接';
        el.title = '未选择连接';
        return;
    }
    const dbLabel = dbState.currentDatabase ? ` · ${dbState.currentDatabase}` : '';
    text.textContent = `${conn.name}${dbLabel}`;
    const stateLabel = {
        idle: '空闲',
        connected: '已连接',
        error: '上次执行出错',
        disconnected: '连接断开',
    }[dbState.connectionHealth] || '';
    el.title = `${conn.db_type.toUpperCase()} · ${conn.host || ''} · ${stateLabel}`;
}

function setTransactionState(inTrans) {
    const el = document.getElementById('db-conn-trans');
    const wasInTrans = el && !el.hidden;
    if (el) el.hidden = !inTrans;
    if (inTrans && !wasInTrans) {
        recordMessage('warning', '', '已进入事务（BEGIN）');
    } else if (!inTrans && wasInTrans) {
        recordMessage('info', '', '事务结束');
    }
}

function copyMessageLog() {
    const filter = dbState.messageFilter;
    const filtered = dbState.messageLog.filter(m => {
        if (filter === 'all') return true;
        if (filter === 'error') return m.level === 'error';
        if (filter === 'warning') return m.level === 'warning' || m.level === 'error';
        return true;
    });
    const text = filtered.map(m => {
        const t = new Date(m.timestamp).toLocaleString();
        return `[${t}] [${m.level.toUpperCase()}] ${m.message}${m.sql ? '\n  SQL: ' + m.sql : ''}`;
    }).join('\n');
    navigator.clipboard.writeText(text).then(() =>
        dbShowStatus(`已复制 ${filtered.length} 条消息`, 'success')
    ).catch(() => dbShowStatus('复制失败', 'error'));
}

function cancelActiveQuery() {
    const tab = getActiveTab();
    if (!tab || !tab.running || !tab.queryToken) {
        dbShowStatus('没有正在运行的查询', 'info');
        return;
    }
    const conn = dbState.connections.find(c => c.id === dbState.currentConnection);
    if (conn && ['sqlite', 'redis', 'mongodb', 'elasticsearch'].includes(conn.db_type)) {
        dbShowStatus(`${conn.db_type.toUpperCase()} 不支持取消查询`, 'error');
        return;
    }
    invoke('db_cancel_query', {
        connectionId: dbState.currentConnection,
        queryToken: tab.queryToken,
    }).then(() => {
        dbShowStatus('取消信号已发送', 'success');
    }).catch(e => {
        dbShowStatus(`取消失败: ${e}`, 'error');
    });
}

// ============================================================
// 结果导出（CSV / TSV / JSON / SQL / Markdown）
// ============================================================

const exportState = {
    format: 'csv',
    scope: 'all',
};

const EXPORT_PREVIEW_ROWS = 10;

function openExportModal() {
    const tab = getActiveTab();
    if (!tab || !tab.result || tab.result.kind !== 'query') {
        dbShowStatus('当前 tab 无查询结果可导出', 'error');
        return;
    }

    const r = tab.result;
    const total = r.rowCount;
    const pageEnd = Math.min(total, (r.page + 1) * r.pageSize);
    const pageStart = r.page * r.pageSize;
    const pageRows = pageEnd - pageStart;

    document.getElementById('db-export-all-label').textContent = `全部 (${total})`;
    document.getElementById('db-export-page-label').textContent = `当前页 (${pageRows})`;

    // 默认 SQL 表名为源表
    const sqlTableInput = document.getElementById('db-export-sql-table');
    if (sqlTableInput) sqlTableInput.value = r.sourceTable || '';

    document.getElementById('db-export-modal').classList.add('active');
    applyExportFormatVisibility();
    updateExportPreview();
}

function closeExportModal() {
    document.getElementById('db-export-modal')?.classList.remove('active');
}

function applyExportFormatVisibility() {
    const fmt = exportState.format;
    document.querySelectorAll('.db-export-opt').forEach(el => {
        const show = (el.dataset.showFor || '').split(',').includes(fmt);
        el.style.display = show ? '' : 'none';
    });
    document.querySelectorAll('.db-export-fmt').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.fmt === fmt);
    });
}

function getExportOptions() {
    return {
        format: exportState.format,
        scope: exportState.scope,
        header: document.getElementById('db-export-header')?.checked ?? true,
        delim: document.getElementById('db-export-delim')?.value || ',',
        bom: document.getElementById('db-export-bom')?.checked || false,
        nullText: document.getElementById('db-export-null')?.value || '',
        jsonShape: document.getElementById('db-export-json-shape')?.value || 'objects',
        pretty: document.getElementById('db-export-pretty')?.checked ?? true,
        sqlTable: (document.getElementById('db-export-sql-table')?.value || '').trim(),
        sqlBatch: Math.max(1, Math.min(1000, parseInt(document.getElementById('db-export-sql-batch')?.value, 10) || 100)),
    };
}

function getExportRows(opts) {
    const tab = getActiveTab();
    if (!tab || !tab.result) return {columns: [], rows: []};
    const r = tab.result;
    if (opts.scope === 'page') {
        const start = r.page * r.pageSize;
        const end = Math.min(r.rowCount, start + r.pageSize);
        return {columns: r.columns, rows: r.rows.slice(start, end)};
    }
    return {columns: r.columns, rows: r.rows};
}

function escapeCsvField(value, delim, nullText) {
    if (value === null || value === undefined) return nullText;
    const s = String(value);
    // 需要引号包围的情况
    if (s.includes(delim) || s.includes('"') || s.includes('\n') || s.includes('\r')) {
        return '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
}

function buildExportContent(opts, rows, columns) {
    const colNames = columns.map(c => c.name);
    switch (opts.format) {
        case 'csv': {
            const delim = opts.delim;
            const lines = [];
            if (opts.header) lines.push(colNames.map(n => escapeCsvField(n, delim, '')).join(delim));
            for (const row of rows) {
                lines.push(row.map(v => escapeCsvField(v, delim, opts.nullText)).join(delim));
            }
            const out = lines.join('\n');
            return opts.bom ? '\uFEFF' + out : out;
        }
        case 'tsv': {
            const lines = [];
            if (opts.header) lines.push(colNames.join('\t'));
            for (const row of rows) {
                lines.push(row.map(v => {
                    if (v === null || v === undefined) return opts.nullText;
                    return String(v).replace(/\t/g, ' ').replace(/\n/g, ' ');
                }).join('\t'));
            }
            const out = lines.join('\n');
            return opts.bom ? '\uFEFF' + out : out;
        }
        case 'json': {
            if (opts.jsonShape === 'arrays') {
                const data = [colNames, ...rows];
                return opts.pretty ? JSON.stringify(data, null, 2) : JSON.stringify(data);
            }
            if (opts.jsonShape === 'ndjson') {
                return rows.map(row => {
                    const o = {};
                    colNames.forEach((n, i) => { o[n] = row[i]; });
                    return JSON.stringify(o);
                }).join('\n');
            }
            // objects
            const data = rows.map(row => {
                const o = {};
                colNames.forEach((n, i) => { o[n] = row[i]; });
                return o;
            });
            return opts.pretty ? JSON.stringify(data, null, 2) : JSON.stringify(data);
        }
        case 'sql': {
            const tbl = opts.sqlTable || 'target_table';
            const colsSql = colNames.map(c => quoteIdent(c)).join(', ');
            const out = [];
            for (let i = 0; i < rows.length; i += opts.sqlBatch) {
                const batch = rows.slice(i, i + opts.sqlBatch);
                const valuesSql = batch.map(row =>
                    '(' + row.map(v => v === null ? (opts.nullText === '' ? 'NULL' : `'${escapeSql(opts.nullText)}'`) : formatSqlValue(v)).join(', ') + ')'
                ).join(',\n  ');
                out.push(`INSERT INTO ${quoteIdent(tbl)} (${colsSql}) VALUES\n  ${valuesSql};`);
            }
            return out.join('\n\n');
        }
        case 'markdown': {
            if (rows.length === 0) return '_无数据_';
            const widths = colNames.map((n, i) => {
                let w = String(n).length;
                for (const r of rows) {
                    const v = r[i] === null ? opts.nullText : String(r[i] ?? '');
                    if (v.length > w) w = v.length;
                }
                return Math.min(w, 60);
            });
            const fmt = (s, w) => {
                s = String(s).replace(/\|/g, '\\|').replace(/\n/g, ' ');
                return s.length > w ? s.slice(0, w - 1) + '…' : s + ' '.repeat(w - s.length);
            };
            const lines = [];
            if (opts.header) {
                lines.push('| ' + colNames.map((n, i) => fmt(n, widths[i])).join(' | ') + ' |');
                lines.push('| ' + widths.map(w => '-'.repeat(w)).join(' | ') + ' |');
            }
            for (const r of rows) {
                lines.push('| ' + r.map((v, i) => fmt(v === null ? opts.nullText : (v ?? ''), widths[i])).join(' | ') + ' |');
            }
            return lines.join('\n');
        }
    }
    return '';
}

function updateExportPreview() {
    const opts = getExportOptions();
    const {columns, rows} = getExportRows(opts);
    const total = rows.length;
    const preview = rows.slice(0, EXPORT_PREVIEW_ROWS);

    const previewEl = document.getElementById('db-export-preview');
    const metaEl = document.getElementById('db-export-meta');
    if (!previewEl) return;

    try {
        const content = buildExportContent(opts, preview, columns);
        previewEl.textContent = content || '(空)';
    } catch (e) {
        previewEl.textContent = `预览失败: ${e}`;
    }

    // 估算总大小（基于预览的平均行字节数）
    try {
        const full = buildExportContent(opts, rows, columns);
        const bytes = new Blob([full]).size;
        metaEl.textContent = `共 ${total} 行 · 输出 ${formatBytes(bytes)}`;
    } catch (_) {
        metaEl.textContent = `共 ${total} 行`;
    }
}

function formatBytes(n) {
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(2)} MB`;
    return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

async function exportCopyToClipboard() {
    const opts = getExportOptions();
    const {columns, rows} = getExportRows(opts);
    try {
        const content = buildExportContent(opts, rows, columns);
        await navigator.clipboard.writeText(content);
        dbShowStatus(`✓ 已复制 ${rows.length} 行 (${formatBytes(new Blob([content]).size)})`, 'success');
        closeExportModal();
        recordMessage('info', '', `导出复制到剪贴板: ${opts.format} · ${rows.length} 行`);
    } catch (e) {
        dbShowStatus(`复制失败: ${e}`, 'error');
    }
}

async function exportSaveToFile() {
    const opts = getExportOptions();
    const {columns, rows} = getExportRows(opts);
    const content = buildExportContent(opts, rows, columns);

    const tab = getActiveTab();
    const baseName = (tab && tab.result && tab.result.sourceTable) || 'query';
    const extMap = {csv: 'csv', tsv: 'tsv', json: opts.jsonShape === 'ndjson' ? 'ndjson' : 'json', sql: 'sql', markdown: 'md'};
    const ext = extMap[opts.format];
    const filterNames = {csv: 'CSV', tsv: 'TSV', json: 'JSON', sql: 'SQL', markdown: 'Markdown'};
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:-]/g, '').replace('T', '-');
    const defaultName = `${baseName}-${stamp}.${ext}`;

    try {
        const path = await invoke('db_save_file', {
            defaultName,
            content,
            filterName: filterNames[opts.format],
            filterExts: [ext],
        });
        if (path) {
            dbShowStatus(`✓ 已保存到 ${path}`, 'success');
            recordMessage('info', '', `导出文件: ${path} · ${rows.length} 行`);
            closeExportModal();
        }
    } catch (e) {
        dbShowStatus(`保存失败: ${e}`, 'error');
    }
}

function setupExportModal() {
    document.getElementById('db-export-close')?.addEventListener('click', closeExportModal);
    document.getElementById('db-export-cancel')?.addEventListener('click', closeExportModal);
    document.getElementById('db-export-copy')?.addEventListener('click', exportCopyToClipboard);
    document.getElementById('db-export-save')?.addEventListener('click', exportSaveToFile);

    document.querySelectorAll('.db-export-fmt').forEach(btn => {
        btn.addEventListener('click', () => {
            exportState.format = btn.dataset.fmt;
            applyExportFormatVisibility();
            updateExportPreview();
        });
    });

    document.querySelectorAll('input[name="export-scope"]').forEach(r => {
        r.addEventListener('change', () => {
            exportState.scope = r.value;
            updateExportPreview();
        });
    });

    // 选项变化时刷新预览
    ['db-export-header', 'db-export-delim', 'db-export-bom', 'db-export-null',
     'db-export-json-shape', 'db-export-pretty', 'db-export-sql-table', 'db-export-sql-batch']
        .forEach(id => {
            const el = document.getElementById(id);
            if (el) {
                el.addEventListener('change', updateExportPreview);
                el.addEventListener('input', updateExportPreview);
            }
        });
}

async function openSqlFile() {
    try {
        const result = await invoke('db_open_sql_file');
        if (!result) return; // 用户取消
        const [name, content] = result;
        // 当前 tab 没内容则直接载入；否则新建 tab
        const active = getActiveTab();
        if (active && active.editor && !active.editor.getValue().trim()) {
            active.editor.setValue(content);
            active.name = name;
            active.dirty = false;
            renderTabStrip();
        } else {
            createTab({name, sql: content});
        }
        dbShowStatus(`已载入 ${name}`, 'success');
        recordMessage('info', '', `已从文件载入 ${name} (${content.length} 字符)`);
    } catch (e) {
        dbShowStatus(`打开失败: ${e}`, 'error');
    }
}

// ============================================================
// CSV 导入向导
// ============================================================

const csvState = {
    fileName: '',
    raw: '',
    rows: [],          // 解析后的二维数组
    headers: [],       // 用作列名（首行或自动生成）
    targetTable: '',
    targetColumns: [], // [{name, data_type, nullable, ...}]
    mapping: {},       // {csvColumnIndex: targetColName}
    step: 'options',   // 'options' | 'mapping'
};

async function openCsvImportWizard() {
    if (!dbState.currentConnection || !dbState.currentDatabase) {
        dbShowStatus('请先连接并选择数据库', 'error');
        return;
    }
    try {
        const result = await invoke('db_open_csv_file');
        if (!result) return;
        const [name, content] = result;
        csvState.fileName = name;
        csvState.raw = content;
        csvState.step = 'options';
        renderCsvPreview();
        showCsvModal();
    } catch (e) {
        dbShowStatus(`打开 CSV 失败: ${e}`, 'error');
    }
}

function startCsvImport() { openCsvImportWizard(); }

function showCsvModal() {
    const modal = document.getElementById('db-csv-modal');
    if (modal) modal.classList.add('active');
    setCsvStep('options');
}

function closeCsvModal() {
    const modal = document.getElementById('db-csv-modal');
    if (modal) modal.classList.remove('active');
}

function setCsvStep(step) {
    csvState.step = step;
    document.getElementById('db-csv-step-options').hidden = step !== 'options';
    document.getElementById('db-csv-step-mapping').hidden = step !== 'mapping';
    document.getElementById('db-csv-back').hidden = step !== 'mapping';
    document.getElementById('db-csv-next').hidden = step !== 'options';
    document.getElementById('db-csv-import').hidden = step !== 'mapping';
}

function parseCsv(text, delim, quote) {
    // 简易解析器：支持引号包围 + 引号转义 ("" 内嵌)
    const rows = [];
    let cur = [];
    let field = '';
    let inQ = false;
    const len = text.length;
    for (let i = 0; i < len; i++) {
        const c = text[i];
        if (inQ) {
            if (c === quote) {
                if (text[i + 1] === quote) { field += quote; i++; }
                else inQ = false;
            } else {
                field += c;
            }
            continue;
        }
        if (quote && c === quote && field === '') {
            inQ = true;
        } else if (c === delim) {
            cur.push(field);
            field = '';
        } else if (c === '\n') {
            cur.push(field);
            rows.push(cur);
            cur = [];
            field = '';
        } else if (c === '\r') {
            // 跳过
        } else {
            field += c;
        }
    }
    if (field.length > 0 || cur.length > 0) {
        cur.push(field);
        rows.push(cur);
    }
    return rows.filter(r => r.length > 0 && !(r.length === 1 && r[0] === ''));
}

function renderCsvPreview() {
    const delimSelect = document.getElementById('db-csv-delim');
    const quoteSelect = document.getElementById('db-csv-quote');
    const headerCheck = document.getElementById('db-csv-header');
    const fileInfo = document.getElementById('db-csv-file-info');
    const preview = document.getElementById('db-csv-preview');
    if (!preview) return;

    const delim = delimSelect.value === '\\t' ? '\t' : delimSelect.value;
    const quote = quoteSelect.value;
    const useHeader = headerCheck.checked;

    const rows = parseCsv(csvState.raw, delim, quote);
    csvState.rows = rows;
    if (useHeader && rows.length > 0) {
        csvState.headers = rows[0];
    } else if (rows.length > 0) {
        csvState.headers = rows[0].map((_, i) => `col${i + 1}`);
    } else {
        csvState.headers = [];
    }

    fileInfo.textContent = `📄 ${csvState.fileName} · ${rows.length} 行 × ${csvState.headers.length} 列`;

    const dataRows = useHeader ? rows.slice(1, 6) : rows.slice(0, 5);
    let html = '<table class="db-csv-preview-table"><thead><tr>';
    html += csvState.headers.map(h => `<th>${escapeHtml(String(h))}</th>`).join('');
    html += '</tr></thead><tbody>';
    for (const row of dataRows) {
        html += '<tr>';
        for (let i = 0; i < csvState.headers.length; i++) {
            html += `<td>${escapeHtml(String(row[i] || ''))}</td>`;
        }
        html += '</tr>';
    }
    html += '</tbody></table>';
    preview.innerHTML = html;
}

async function gotoCsvMapping() {
    if (csvState.headers.length === 0) {
        dbShowStatus('CSV 解析为空', 'error');
        return;
    }
    // 加载表列表
    const tables = getCachedTables();
    const tableSelect = document.getElementById('db-csv-table');
    tableSelect.innerHTML = '<option value="">选择目标表...</option>' +
        tables.map(t => `<option value="${escapeHtmlAttr(t)}">${escapeHtml(t)}</option>`).join('');
    tableSelect.onchange = onCsvTargetTableChange;
    document.getElementById('db-csv-mapping').innerHTML = '<div class="db-csv-empty">请先选择目标表</div>';
    setCsvStep('mapping');
}

async function onCsvTargetTableChange() {
    const table = document.getElementById('db-csv-table').value;
    csvState.targetTable = table;
    if (!table) return;
    try {
        const schema = await invoke('db_get_table_schema', {
            connectionId: dbState.currentConnection,
            database: dbState.currentDatabase,
            table,
        });
        csvState.targetColumns = schema.columns || [];
        renderCsvMapping();
    } catch (e) {
        dbShowStatus(`获取表结构失败: ${e}`, 'error');
    }
}

function renderCsvMapping() {
    const wrap = document.getElementById('db-csv-mapping');
    const cols = csvState.targetColumns;
    if (cols.length === 0) {
        wrap.innerHTML = '<div class="db-csv-empty">该表无列</div>';
        return;
    }
    // 默认按列名匹配
    const mapping = {};
    for (const c of cols) {
        const idx = csvState.headers.findIndex(h => h && h.toLowerCase() === c.name.toLowerCase());
        if (idx >= 0) mapping[c.name] = idx;
    }
    csvState.mapping = mapping;

    let html = '<table class="db-csv-mapping-table">';
    html += '<thead><tr><th>目标列</th><th>类型</th><th>来源 CSV 列</th></tr></thead><tbody>';
    for (const c of cols) {
        const required = c.nullable ? '' : '<span class="db-csv-required" title="非空">*</span>';
        html += `<tr>
            <td>${escapeHtml(c.name)}${required}</td>
            <td><code>${escapeHtml(c.data_type)}</code></td>
            <td>
                <select class="db-csv-col" data-target="${escapeHtmlAttr(c.name)}">
                    <option value="">（跳过）</option>
                    ${csvState.headers.map((h, i) => {
                        const sel = mapping[c.name] === i ? 'selected' : '';
                        return `<option value="${i}" ${sel}>${escapeHtml(String(h))}</option>`;
                    }).join('')}
                </select>
            </td>
        </tr>`;
    }
    html += '</tbody></table>';
    wrap.innerHTML = html;

    wrap.querySelectorAll('.db-csv-col').forEach(sel => {
        sel.addEventListener('change', () => {
            const target = sel.dataset.target;
            const v = sel.value;
            if (v === '') delete csvState.mapping[target];
            else csvState.mapping[target] = parseInt(v, 10);
        });
    });
}

async function runCsvImport() {
    if (!csvState.targetTable) {
        dbShowStatus('请选择目标表', 'error');
        return;
    }
    const mappingEntries = Object.entries(csvState.mapping);
    if (mappingEntries.length === 0) {
        dbShowStatus('请至少映射一列', 'error');
        return;
    }

    const useHeader = document.getElementById('db-csv-header').checked;
    const truncate = document.getElementById('db-csv-truncate').checked;
    const batchSize = Math.max(10, Math.min(2000, parseInt(document.getElementById('db-csv-batch-size').value, 10) || 200));
    const dataRows = useHeader ? csvState.rows.slice(1) : csvState.rows;
    const dbType = (dbState.connections.find(c => c.id === dbState.currentConnection) || {}).db_type;

    // 二次确认
    const total = dataRows.length;
    const action = truncate ? `先清空 ${csvState.targetTable}，再` : '';
    if (!confirm(`将${action}向 ${csvState.targetTable} 导入 ${total} 行，分 ${Math.ceil(total / batchSize)} 批。确认？`)) return;

    closeCsvModal();
    dbShowStatus(`导入中 0/${total}...`, 'info');
    recordMessage('info', '', `CSV 导入开始: ${csvState.fileName} → ${csvState.targetTable} (${total} 行)`);

    let inserted = 0;
    let failed = 0;
    try {
        if (truncate) {
            await invoke('db_execute', {
                connectionId: dbState.currentConnection,
                sql: `TRUNCATE TABLE ${quoteIdent(csvState.targetTable, dbType)}`,
                database: dbState.currentDatabase,
            });
        }

        const targetCols = mappingEntries.map(([col]) => col);
        const csvIdxs = mappingEntries.map(([, idx]) => idx);

        for (let i = 0; i < dataRows.length; i += batchSize) {
            const batch = dataRows.slice(i, i + batchSize);
            const valuesSql = batch.map(row =>
                '(' + csvIdxs.map(idx => formatSqlValue(row[idx] === undefined || row[idx] === '' ? null : row[idx])).join(', ') + ')'
            ).join(',\n');
            const sql = `INSERT INTO ${quoteIdent(csvState.targetTable, dbType)} (${targetCols.map(c => quoteIdent(c, dbType)).join(', ')}) VALUES\n${valuesSql}`;

            try {
                const result = await invoke('db_execute', {
                    connectionId: dbState.currentConnection,
                    sql,
                    database: dbState.currentDatabase,
                });
                if (result.success) inserted += batch.length;
                else { failed += batch.length; recordMessage('error', sql.slice(0, 200), result.error || '导入失败'); }
            } catch (e) {
                failed += batch.length;
                recordMessage('error', sql.slice(0, 200), String(e));
            }
            dbShowStatus(`导入中 ${i + batch.length}/${total}...`, 'info');
        }

        if (failed === 0) {
            dbShowStatus(`✓ 导入完成：${inserted} 行`, 'success');
            recordMessage('info', '', `CSV 导入完成: ${inserted} 行成功`);
        } else {
            dbShowStatus(`⚠️ 导入完成：成功 ${inserted}，失败 ${failed}`, 'error');
            recordMessage('warning', '', `CSV 导入部分失败: 成功 ${inserted}, 失败 ${failed}`);
        }
    } catch (e) {
        dbShowStatus(`导入失败: ${e}`, 'error');
        recordMessage('error', '', String(e));
    }
}

// 按当前连接的数据库类型对标识符做安全转义
function quoteIdent(name, dbType) {
    if (name === undefined || name === null) return '';
    if (!dbType) {
        const conn = dbState.connections.find(c => c.id === dbState.currentConnection);
        dbType = conn ? conn.db_type : 'mysql';
    }
    const s = String(name);
    if (dbType === 'mysql') {
        return '`' + s.replace(/`/g, '``') + '`';
    }
    // PostgreSQL / SQLite 使用双引号
    return '"' + s.replace(/"/g, '""') + '"';
}

// 数据库工具状态显示
function dbShowStatus(msg, type = 'info') {
    const el = document.getElementById('db-status');
    if (!el) {
        console.log('[DB]', msg, type);
        return;
    }
    el.textContent = msg;
    el.className = 'status-msg ' + (type === 'error' ? 'status-error' : type === 'success' ? 'status-success' : 'status-info');
    el.style.display = 'block';
    clearTimeout(el._hideTimer);
    if (type !== 'info') {
        el._hideTimer = setTimeout(() => { el.style.display = 'none'; }, 5000);
    }
}

// 初始化数据库工具
async function initDatabaseTool() {
    // 避免重复初始化
    if (dbState.tabs.length > 0) {
        const active = getActiveTab();
        if (active && active.editor) active.editor.refresh();
        return;
    }

    // 加载持久化的历史 / 收藏
    loadHistoryFromStorage();

    // 创建首个 tab
    createTab();

    // 绑定事件
    document.getElementById('db-new-connection')?.addEventListener('click', openConnectionModal);
    document.getElementById('db-test-connection')?.addEventListener('click', testConnection);
    document.getElementById('db-save-connection')?.addEventListener('click', saveConnection);
    document.getElementById('db-execute')?.addEventListener('click', executeQuery);
    document.getElementById('db-format')?.addEventListener('click', formatSql);
    document.getElementById('db-clear')?.addEventListener('click', clearSql);
    document.getElementById('db-type-select')?.addEventListener('change', handleDbTypeChange);
    document.getElementById('db-browse-file')?.addEventListener('click', browseSqliteFile);
    document.getElementById('db-tab-new')?.addEventListener('click', () => createTab());
    document.getElementById('db-open-sql')?.addEventListener('click', openSqlFile);
    document.getElementById('db-import-csv')?.addEventListener('click', openCsvImportWizard);
    document.getElementById('db-export-open')?.addEventListener('click', openExportModal);
    setupExportModal();
    document.getElementById('db-history')?.addEventListener('click', () => toggleHistoryPanel('history'));
    document.getElementById('db-favorites')?.addEventListener('click', () => toggleHistoryPanel('favorites'));
    document.getElementById('db-history-close')?.addEventListener('click', closeHistoryPanel);
    document.getElementById('db-history-backdrop')?.addEventListener('click', closeHistoryPanel);
    document.getElementById('db-history-clear')?.addEventListener('click', clearHistoryList);
    document.getElementById('db-history-search')?.addEventListener('input', evt => {
        historyPanelState.search = evt.target.value || '';
        renderHistoryList();
    });
    document.querySelectorAll('.db-history-tab').forEach(b => {
        b.addEventListener('click', () => toggleHistoryPanel(b.dataset.mode));
    });
    document.addEventListener('keydown', evt => {
        if (evt.key === 'Escape' && historyPanelState.open) {
            closeHistoryPanel();
        }
    });

    // 结果/消息 tab 切换
    document.querySelectorAll('.db-result-tabs .tab').forEach(btn => {
        btn.addEventListener('click', () => switchResultTab(btn.dataset.tab));
    });

    // 消息过滤
    document.querySelectorAll('input[name="msg-filter"]').forEach(r => {
        r.addEventListener('change', () => {
            dbState.messageFilter = r.value;
            renderMessageList();
        });
    });

    document.getElementById('db-message-clear')?.addEventListener('click', clearMessageLog);
    document.getElementById('db-message-copy')?.addEventListener('click', copyMessageLog);

    // NoSQL 助手示例点击 → 填入编辑器
    document.getElementById('db-nosql-help-body')?.addEventListener('click', (e) => {
        const example = e.target.closest('.helper-example');
        if (!example) return;
        const cmd = example.dataset.cmd;
        if (!cmd) return;
        const editor = getActiveEditor();
        if (editor) editor.setValue(cmd);
        closeNoSQLHelper();
    });

    // NoSQL 使用助手按钮
    document.getElementById('db-nosql-help')?.addEventListener('click', showNoSQLHelper);

    // CSV 导入向导事件
    document.getElementById('db-csv-close')?.addEventListener('click', closeCsvModal);
    document.getElementById('db-csv-cancel')?.addEventListener('click', closeCsvModal);
    document.getElementById('db-csv-next')?.addEventListener('click', gotoCsvMapping);
    document.getElementById('db-csv-back')?.addEventListener('click', () => setCsvStep('options'));
    document.getElementById('db-csv-import')?.addEventListener('click', runCsvImport);
    document.getElementById('db-csv-delim')?.addEventListener('change', renderCsvPreview);
    document.getElementById('db-csv-quote')?.addEventListener('change', renderCsvPreview);
    document.getElementById('db-csv-header')?.addEventListener('change', renderCsvPreview);

    // 连接选择器
    document.getElementById('db-connection-select')?.addEventListener('change', handleConnectionChange);

    // 数据库选择器
    document.getElementById('db-database-select')?.addEventListener('change', handleDatabaseChange);

    // 创建表按钮
    document.getElementById('db-create-table')?.addEventListener('click', () => {
        if (!dbState.currentConnection || !dbState.currentDatabase) {
            dbShowStatus('请先连接数据库', 'error');
            return;
        }
        openCreateTableDialog();
    });

    // 弹窗关闭
    document.querySelector('#db-connection-modal .modal-close')?.addEventListener('click', closeConnectionModal);
    document.querySelector('#db-connection-modal .modal-cancel')?.addEventListener('click', closeConnectionModal);

    // 加载保存的连接
    await loadConnections();

    // 处理数据库类型变化
    handleDbTypeChange();
}

// ============================================================
// SQL 编辑器多标签 (Tab) 管理
// ============================================================

function createTab(opts = {}) {
    const id = 't' + (++dbState.tabSeq);
    const name = opts.name || `查询 ${dbState.tabSeq}`;
    const sql = opts.sql || '';

    const paneHost = document.getElementById('db-tab-panes');
    if (!paneHost) return null;

    // 为该 tab 创建独立的 textarea + 结果容器
    const pane = document.createElement('div');
    pane.className = 'db-tab-pane';
    pane.dataset.tabId = id;
    const ta = document.createElement('textarea');
    pane.appendChild(ta);
    paneHost.appendChild(pane);

    let editor = null;
    if (typeof CodeMirror !== 'undefined') {
        editor = CodeMirror.fromTextArea(ta, {
            mode: 'text/x-sql',
            theme: 'dracula',
            lineNumbers: true,
            indentUnit: 2,
            tabSize: 2,
            lineWrapping: true,
            matchBrackets: true,
            autoCloseBrackets: true,
            extraKeys: {
                'Cmd-Enter': executeQuery,
                'Ctrl-Enter': executeQuery,
                'Cmd-/': cm => cm.toggleComment && cm.toggleComment(),
                'Ctrl-/': cm => cm.toggleComment && cm.toggleComment(),
                'Cmd-Space': cm => cm.showHint && cm.showHint({hint: dbSqlHint, completeSingle: false}),
                'Ctrl-Space': cm => cm.showHint && cm.showHint({hint: dbSqlHint, completeSingle: false}),
                'Cmd-T': () => createTab(),
                'Ctrl-T': () => createTab(),
                'Cmd-W': () => { const t = getActiveTab(); if (t) closeTab(t.id); },
                'Ctrl-W': () => { const t = getActiveTab(); if (t) closeTab(t.id); },
            },
            hintOptions: {hint: dbSqlHint, completeSingle: false},
        });
        if (sql) editor.setValue(sql);
        editor.on('change', () => {
            const t = dbState.tabs.find(x => x.editor === editor);
            if (t && !t.dirty && editor.getValue().trim()) {
                t.dirty = true;
                renderTabStrip();
            }
        });
        // 输入触发补全（仅在字母/点之后）
        editor.on('inputRead', (cm, change) => {
            if (!change || change.origin !== '+input') return;
            const last = change.text && change.text[change.text.length - 1];
            if (!last) return;
            if (/[a-zA-Z_]/.test(last) || last === '.') {
                clearTimeout(editor._hintTimer);
                editor._hintTimer = setTimeout(() => {
                    if (!cm.state.completionActive) {
                        cm.showHint({hint: dbSqlHint, completeSingle: false});
                    }
                }, last === '.' ? 0 : 200);
            }
        });
    }

    const tab = {
        id,
        name,
        editor,
        result: null,         // {columns, rows, page, pageSize, duration, isError, error?}
        running: false,
        queryToken: null,
        dirty: false,
    };
    dbState.tabs.push(tab);

    renderTabStrip();
    activateTab(id);

    return tab;
}

function activateTab(id) {
    const tab = dbState.tabs.find(t => t.id === id);
    if (!tab) return;
    dbState.activeTabId = id;

    document.querySelectorAll('.db-tab-pane').forEach(p => {
        p.classList.toggle('active', p.dataset.tabId === id);
    });
    renderTabStrip();
    // 重新测量 CodeMirror
    setTimeout(() => tab.editor && tab.editor.refresh(), 0);
    // 重新渲染结果
    renderTabResult(tab);
    // 同步执行按钮状态
    updateExecuteButton();
}

function closeTab(id) {
    const idx = dbState.tabs.findIndex(t => t.id === id);
    if (idx < 0) return;
    const tab = dbState.tabs[idx];
    if (tab.dirty && (tab.editor?.getValue() || '').trim()) {
        if (!confirm(`"${tab.name}" 有未运行的内容，确定关闭？`)) return;
    }
    if (tab.editor) {
        try { tab.editor.toTextArea(); } catch (_) {}
    }
    const pane = document.querySelector(`.db-tab-pane[data-tab-id="${id}"]`);
    if (pane) pane.remove();
    dbState.tabs.splice(idx, 1);

    if (dbState.activeTabId === id) {
        const next = dbState.tabs[idx] || dbState.tabs[idx - 1];
        if (next) activateTab(next.id);
        else createTab();
    } else {
        renderTabStrip();
    }
}

function renameTab(id) {
    const tab = dbState.tabs.find(t => t.id === id);
    if (!tab) return;
    const name = prompt('标签名称', tab.name);
    if (name && name.trim()) {
        tab.name = name.trim();
        renderTabStrip();
    }
}

function duplicateTab(id) {
    const src = dbState.tabs.find(t => t.id === id);
    if (!src) return;
    const sql = src.editor ? src.editor.getValue() : '';
    createTab({name: src.name + ' 副本', sql});
}

function closeOtherTabs(id) {
    const others = dbState.tabs.filter(t => t.id !== id).map(t => t.id);
    others.forEach(closeTab);
}

function renderTabStrip() {
    const strip = document.getElementById('db-tab-list');
    if (!strip) return;
    strip.innerHTML = '';
    dbState.tabs.forEach(tab => {
        const el = document.createElement('div');
        el.className = 'db-tab' + (tab.id === dbState.activeTabId ? ' active' : '') + (tab.running ? ' running' : '');
        el.dataset.tabId = tab.id;
        const dirty = tab.dirty ? '<span class="db-tab-dirty" title="未运行">●</span>' : '';
        el.innerHTML = `<span class="db-tab-name">${escapeHtml(tab.name)}</span>${dirty}<button class="db-tab-close" title="关闭">×</button>`;
        el.addEventListener('click', e => {
            if (e.target.classList.contains('db-tab-close')) {
                closeTab(tab.id);
            } else {
                activateTab(tab.id);
            }
        });
        el.addEventListener('dblclick', e => {
            if (!e.target.classList.contains('db-tab-close')) renameTab(tab.id);
        });
        el.addEventListener('contextmenu', e => {
            e.preventDefault();
            showTabContextMenu(e, tab.id);
        });
        strip.appendChild(el);
    });
}

function showTabContextMenu(evt, tabId) {
    // 简易上下文菜单：用 prompt 简化（避免新增完整菜单 DOM）
    const choices = ['重命名', '复制此标签', '关闭其他', '取消'];
    const choice = prompt(`操作此标签：\n1) 重命名\n2) 复制此标签\n3) 关闭其他\n输入 1-3 (或回车取消)`);
    if (choice === '1') renameTab(tabId);
    else if (choice === '2') duplicateTab(tabId);
    else if (choice === '3') closeOtherTabs(tabId);
}

// 打开连接弹窗
function openConnectionModal() {
    const modal = document.getElementById('db-connection-modal');
    if (modal) {
        modal.classList.add('active');
        document.getElementById('db-connection-form')?.reset();
        handleDbTypeChange();
    }
}

// 关闭连接弹窗
function closeConnectionModal() {
    const modal = document.getElementById('db-connection-modal');
    if (modal) {
        modal.classList.remove('active');
    }
}

// 处理数据库类型变化
function handleDbTypeChange() {
    const dbType = document.getElementById('db-type-select')?.value;
    const hostRow = document.getElementById('db-host-row');
    const usernameRow = document.getElementById('db-username-row');
    const passwordRow = document.getElementById('db-password-row');
    const databaseRow = document.getElementById('db-database-row');
    const fileRow = document.getElementById('db-file-row');
    const portInput = document.getElementById('db-port-input');

    if (dbType === 'sqlite') {
        hostRow.style.display = 'none';
        usernameRow.style.display = 'none';
        passwordRow.style.display = 'none';
        databaseRow.style.display = 'none';
        fileRow.style.display = 'block';
    } else {
        hostRow.style.display = 'flex';
        usernameRow.style.display = 'block';
        passwordRow.style.display = 'block';
        databaseRow.style.display = 'block';
        fileRow.style.display = 'none';

        // 更新默认端口
        const ports = { mysql: '3306', postgresql: '5432', redis: '6379', mongodb: '27017', elasticsearch: '9200' };
        if (portInput) portInput.value = ports[dbType] || '3306';

        // 数据库字段标签提示
        const dbLabel = databaseRow.querySelector('label');
        if (dbLabel) {
            if (dbType === 'redis') {
                dbLabel.textContent = '数据库 (可选，默认 db0)';
            } else if (dbType === 'mongodb') {
                dbLabel.textContent = '数据库 (可选)';
            } else if (dbType === 'elasticsearch') {
                dbLabel.textContent = '索引 (可选)';
            } else {
                dbLabel.textContent = '数据库';
            }
        }

        // Redis 主机字段提示（支持集群多节点）
        const hostLabel = document.getElementById('db-host-label');
        const hostInput = document.getElementById('db-host-input');
        if (hostLabel) {
            hostLabel.textContent = (dbType === 'redis') ? '主机（多节点逗号分隔）' : '主机';
        }
        if (hostInput) {
            hostInput.placeholder = (dbType === 'redis') ? 'localhost 或 10.0.0.1:6381,10.0.0.2:6381' : '';
        }
    }
}

// 浏览 SQLite 文件
async function browseSqliteFile() {
    const result = await invoke('db_browse_sqlite_file');
    if (result) {
        document.getElementById('db-file-path').value = result;
    }
}

// 测试连接
async function testConnection() {
    const form = document.getElementById('db-connection-form');
    const formData = new FormData(form);
    const dbType = formData.get('db_type');

    const config = {
        name: formData.get('name') || '测试连接',
        db_type: dbType,
        host: formData.get('host') || 'localhost',
        port: parseInt(formData.get('port')) || 3306,
        username: formData.get('username') || '',
        password: formData.get('password') || '',
        database: dbType === 'sqlite' ? formData.get('database_file') : formData.get('database'),
        ssl_mode: 'preferred',
        options: {},
    };

    dbShowStatus('正在测试连接...', 'info');

    try {
        const result = await invoke('db_test_connection', { config });
        if (result.success) {
            dbShowStatus(`连接成功! ${result.server_version || ''}`, 'success');
        } else {
            dbShowStatus(`连接失败: ${result.message}`, 'error');
        }
    } catch (e) {
        dbShowStatus(`测试失败: ${e}`, 'error');
    }
}

// 保存连接
async function saveConnection() {
    const form = document.getElementById('db-connection-form');
    const formData = new FormData(form);
    const dbType = formData.get('db_type');
    const editId = form.dataset.editId;

    const config = {
        name: formData.get('name'),
        db_type: dbType,
        host: formData.get('host') || 'localhost',
        port: parseInt(formData.get('port')) || 3306,
        username: formData.get('username') || '',
        password: formData.get('password') || '',
        database: dbType === 'sqlite' ? formData.get('database_file') : formData.get('database'),
        ssl_mode: 'preferred',
        options: {},
        group: (formData.get('group') || '').toString().trim() || null,
    };

    // 如果是编辑模式，先删除旧连接
    if (editId) {
        try {
            await invoke('db_delete_connection', { id: editId });
        } catch (e) {
            console.error('删除旧连接失败:', e);
        }
        delete form.dataset.editId;
    }

    try {
        const saved = await invoke('db_save_connection', { config });
        dbShowStatus(`连接 "${saved.name}" 已保存`, 'success');
        closeConnectionModal();
        await loadConnections();
    } catch (e) {
        dbShowStatus(`保存失败: ${e}`, 'error');
    }
}

// 加载连接列表
async function loadConnections() {
    try {
        const connections = await invoke('db_list_connections');
        dbState.connections = connections;

        renderConnectionList();
        updateConnectionSelect();
    } catch (e) {
        console.error('加载连接失败:', e);
    }
}

// 渲染连接列表（按分组）
function renderConnectionList() {
    const list = document.getElementById('db-connection-list');
    if (!list) return;

    if (dbState.connections.length === 0) {
        list.innerHTML = '<div class="db-result-placeholder" style="padding: 16px;">暂无保存的连接</div>';
        return;
    }

    const icons = { mysql: '🐬', postgresql: '🐘', sqlite: '📦', redis: '🔴', mongodb: '🍃', elasticsearch: '🔍' };

    // 按 group 分桶；无 group 的归到 _none
    const groups = new Map();
    for (const c of dbState.connections) {
        const g = (c.group && c.group.trim()) || '';
        if (!groups.has(g)) groups.set(g, []);
        groups.get(g).push(c);
    }
    // 排序：有名字的分组按名称排序，无分组放最后
    const groupKeys = [...groups.keys()].sort((a, b) => {
        if (!a) return 1;
        if (!b) return -1;
        return a.localeCompare(b, 'zh');
    });

    const collapsedSet = new Set(JSON.parse(localStorage.getItem('dbtoolkit.collapsedGroups') || '[]'));

    const renderItem = (conn) => `
        <div class="db-connection-item" data-id="${escapeHtmlAttr(conn.id)}" draggable="true">
            <span class="db-connection-icon">${icons[conn.db_type] || '🗄️'}</span>
            <span class="db-connection-name">${escapeHtml(conn.name)}</span>
            <span class="db-connection-mode" data-id="${escapeHtmlAttr(conn.id)}"></span>
            <span class="db-connection-status"></span>
            <div class="db-connection-actions">
                <button class="db-conn-action db-conn-edit" data-id="${escapeHtmlAttr(conn.id)}" title="编辑">✏️</button>
                <button class="db-conn-action db-conn-delete" data-id="${escapeHtmlAttr(conn.id)}" title="删除">🗑️</button>
            </div>
        </div>
    `;

    list.innerHTML = groupKeys.map(g => {
        const items = groups.get(g).map(renderItem).join('');
        if (!g) {
            // 无分组的不显示 header
            return `<div class="db-group-block" data-group="">${items}</div>`;
        }
        const isCollapsed = collapsedSet.has(g);
        return `
            <div class="db-group-block ${isCollapsed ? 'collapsed' : ''}" data-group="${escapeHtmlAttr(g)}">
                <div class="db-group-header" data-group-name="${escapeHtmlAttr(g)}">
                    <span class="db-group-toggle">${isCollapsed ? '▶' : '▼'}</span>
                    <span class="db-group-name">${escapeHtml(g)}</span>
                    <span class="db-group-count">${groups.get(g).length}</span>
                </div>
                <div class="db-group-items">${items}</div>
            </div>
        `;
    }).join('');

    // 分组折叠
    list.querySelectorAll('.db-group-header').forEach(h => {
        h.addEventListener('click', () => {
            const name = h.dataset.groupName;
            const set = new Set(JSON.parse(localStorage.getItem('dbtoolkit.collapsedGroups') || '[]'));
            if (set.has(name)) set.delete(name); else set.add(name);
            localStorage.setItem('dbtoolkit.collapsedGroups', JSON.stringify([...set]));
            renderConnectionList();
        });
    });

    // 绑定点击事件
    list.querySelectorAll('.db-connection-item').forEach(item => {
        item.addEventListener('click', (e) => {
            if (e.target.closest('.db-conn-action')) return;
            connectToDatabase(item.dataset.id);
        });
        item.addEventListener('dblclick', () => disconnectDatabase(item.dataset.id));
    });

    list.querySelectorAll('.db-conn-edit').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            editConnection(btn.dataset.id);
        });
    });

    list.querySelectorAll('.db-conn-delete').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            deleteConnection(btn.dataset.id);
        });
    });
}

// 更新连接选择器
function updateConnectionSelect() {
    const select = document.getElementById('db-connection-select');
    if (!select) return;

    select.innerHTML = '<option value="">选择连接...</option>' +
        dbState.connections.map(conn => `<option value="${conn.id}">${conn.name}</option>`).join('');
}

// 连接到数据库
// 根据数据库类型更新界面
function updateUIForDbType(dbType) {
    const executeBtn = document.getElementById('db-execute');
    const formatBtn = document.getElementById('db-format');
    const openSqlBtn = document.getElementById('db-open-sql');
    const importCsvBtn = document.getElementById('db-import-csv');
    const createTableBtn = document.getElementById('db-create-table');

    const isSql = ['mysql', 'postgresql', 'sqlite'].includes(dbType);
    const isRedis = dbType === 'redis';
    const isMongoDb = dbType === 'mongodb';
    const isElasticsearch = dbType === 'elasticsearch';

    // 更新工具栏按钮显示
    if (formatBtn) formatBtn.style.display = isSql ? '' : 'none';
    if (openSqlBtn) openSqlBtn.style.display = isSql ? '' : 'none';
    if (importCsvBtn) importCsvBtn.style.display = isSql ? '' : 'none';
    if (createTableBtn) createTableBtn.style.display = isSql ? '' : 'none';

    // NoSQL 使用助手按钮
    const helpBtn = document.getElementById('db-nosql-help');
    if (helpBtn) helpBtn.style.display = (isRedis || isMongoDb || isElasticsearch) ? '' : 'none';

    // 更新执行按钮文本
    if (executeBtn) {
        if (isRedis) {
            executeBtn.textContent = '执行命令';
        } else if (isMongoDb || isElasticsearch) {
            executeBtn.textContent = '执行查询';
        } else {
            executeBtn.textContent = '执行';
        }
    }

    // 更新编辑器占位符
    const activePane = document.querySelector('.db-tab-pane.active');
    if (activePane) {
        const editor = activePane.querySelector('.db-editor');
        if (editor && editor.cm) {
            if (isRedis) {
                editor.cm.setOption('placeholder', '输入 Redis 命令，如：\nGET key\nSET key value\nKEYS *\nINFO');
            } else if (isMongoDb) {
                editor.cm.setOption('placeholder', '输入 MongoDB 查询，格式：collection?filter\n如：users?{"name":"Alice"}\n留空查询全部');
            } else if (isElasticsearch) {
                editor.cm.setOption('placeholder', '输入 ES 查询，格式：index?query\n如：my_index?{"query":{"match_all":{}}}');
            } else {
                editor.cm.setOption('placeholder', '输入 SQL 语句...');
            }
        }
    }
}

async function connectToDatabase(connectionId) {
    dbShowStatus('正在连接...', 'info');
    updateConnectionHealth('idle');

    try {
        await invoke('db_connect', { id: connectionId });
        dbState.currentConnection = connectionId;
        updateConnectionHealth('connected');

        // 从保存的连接信息中获取数据库名
        const conn = dbState.connections.find(c => c.id === connectionId);
        if (conn) {
            dbState.currentDatabase = conn.database;
            recordMessage('info', '', `已连接到 ${conn.name} (${conn.db_type})`);
            // 根据数据库类型更新界面
            updateUIForDbType(conn.db_type);
        }

        // 刷新结果区（显示 NoSQL 使用助手）
        const activeTab = getActiveTab();
        if (activeTab) renderTabResult(activeTab);

        // 更新状态指示器
        document.querySelectorAll('.db-connection-item').forEach(item => {
            item.classList.remove('active');
            item.querySelector('.db-connection-status')?.classList.remove('connected');
        });

        const item = document.querySelector(`.db-connection-item[data-id="${connectionId}"]`);
        if (item) {
            item.classList.add('active');
            item.querySelector('.db-connection-status')?.classList.add('connected');
        }

        // 获取并显示连接模式（集群/单机）
        if (conn?.db_type === 'redis') {
            try {
                const mode = await invoke('db_get_connection_mode', { connectionId });
                const modeEl = document.querySelector(`.db-connection-mode[data-id="${connectionId}"]`);
                if (modeEl) {
                    modeEl.textContent = mode === 'cluster' ? '集群' : '单机';
                    modeEl.className = `db-connection-mode ${mode === 'cluster' ? 'mode-cluster' : 'mode-single'}`;
                }
            } catch (_) {}
        }

        // 更新选择器
        document.getElementById('db-connection-select').value = connectionId;

        // 加载数据库列表
        await loadDatabases();

        // 加载表列表
        await loadTables();

        dbShowStatus('连接成功', 'success');
    } catch (e) {
        dbShowStatus(`连接失败: ${e}`, 'error');
    }
}

// 断开连接
async function disconnectDatabase(connectionId) {
    try {
        await invoke('db_disconnect', { id: connectionId });

        if (dbState.currentConnection === connectionId) {
            dbState.currentConnection = null;
            dbState.currentDatabase = null;

            // 清空数据库选择器
            const dbSelect = document.getElementById('db-database-select');
            if (dbSelect) dbSelect.innerHTML = '<option value="">选择数据库...</option>';

            // 清空表树
            const tree = document.getElementById('db-tree');
            if (tree) tree.innerHTML = '';
        }

        // 更新状态指示器
        const item = document.querySelector(`.db-connection-item[data-id="${connectionId}"]`);
        if (item) {
            item.classList.remove('active');
            item.querySelector('.db-connection-status')?.classList.remove('connected');
            const modeEl = item.querySelector('.db-connection-mode');
            if (modeEl) { modeEl.textContent = ''; modeEl.className = 'db-connection-mode'; }
        }

        dbShowStatus('已断开连接', 'info');
    } catch (e) {
        dbShowStatus(`断开失败: ${e}`, 'error');
    }
}

// 编辑连接
async function editConnection(connectionId) {
    const conn = dbState.connections.find(c => c.id === connectionId);
    if (!conn) return;

    // 先断开现有连接
    if (dbState.currentConnection === connectionId) {
        await disconnectDatabase(connectionId);
    }

    // 打开弹窗并填充数据
    const modal = document.getElementById('db-connection-modal');
    const form = document.getElementById('db-connection-form');
    if (modal && form) {
        modal.classList.add('active');

        // 填充表单
        form.querySelector('[name="name"]').value = conn.name || '';
        form.querySelector('[name="db_type"]').value = conn.db_type || 'mysql';
        form.querySelector('[name="host"]').value = conn.host || 'localhost';
        form.querySelector('[name="port"]').value = conn.port || 3306;
        form.querySelector('[name="username"]').value = conn.username || '';
        form.querySelector('[name="database"]').value = conn.database || '';
        const groupInput = form.querySelector('[name="group"]');
        if (groupInput) groupInput.value = conn.group || '';

        // 保存正在编辑的 ID
        form.dataset.editId = connectionId;

        handleDbTypeChange();
    }
}

// 删除连接
async function deleteConnection(connectionId) {
    // 使用 Tauri 原生对话框（confirm() 在 WebView 中可能不可靠）
    try {
        const confirmed = await invoke('plugin:dialog|message', {
            message: '确定要删除这个连接吗？',
            title: '删除连接',
            kind: 'warning',
            buttons: 'OkCancel',
        });
        if (confirmed !== 'Ok') return;
    } catch (_) {
        // 对话框插件不可用时回退到 confirm
        if (!confirm('确定要删除这个连接吗？')) return;
    }

    try {
        // 先断开
        if (dbState.currentConnection === connectionId) {
            await disconnectDatabase(connectionId);
        }

        await invoke('db_delete_connection', { id: connectionId });
        await loadConnections();
        dbShowStatus('连接已删除', 'info');
    } catch (e) {
        dbShowStatus(`删除失败: ${e}`, 'error');
    }
}

// 加载数据库列表
async function loadDatabases() {
    if (!dbState.currentConnection) return;

    const select = document.getElementById('db-database-select');
    if (!select) return;

    try {
        const conn = dbState.connections.find(c => c.id === dbState.currentConnection);

        // SQLite 只有一个数据库，直接设置
        if (conn && conn.db_type === 'sqlite') {
            select.innerHTML = '<option value="main">main</option>';
            select.value = 'main';
            dbState.currentDatabase = 'main';
            return;
        }

        const databases = await invoke('db_get_databases', {
            connectionId: dbState.currentConnection,
        });

        console.log('获取到的数据库列表:', databases);

        select.innerHTML = '<option value="">选择数据库...</option>' +
            databases.map(db => `<option value="${db.name}">${db.name}</option>`).join('');

        // 确定要选择的数据库
        let targetDb = null;
        if (dbState.currentDatabase) {
            // 检查数据库是否存在
            const exists = databases.some(db => db.name === dbState.currentDatabase);
            if (exists) {
                targetDb = dbState.currentDatabase;
            } else {
                // 如果保存的数据库不存在，选择第一个
                targetDb = databases[0]?.name || '';
            }
        } else if (databases.length > 0) {
            // 默认选择第一个数据库
            targetDb = databases[0].name;
        }

        // 先更新状态，再设置选择器值
        if (targetDb) {
            dbState.currentDatabase = targetDb;
            select.value = targetDb;
        }

        console.log('当前数据库:', dbState.currentDatabase);

        // 选择数据库后自动加载表
        if (dbState.currentDatabase) {
            await loadTables();
        }
    } catch (e) {
        console.error('加载数据库列表失败:', e);
        select.innerHTML = '<option value="">加载失败</option>';
    }
}

// 处理数据库选择变化
async function handleDatabaseChange(e) {
    const database = e.target.value;
    console.log('数据库选择变化:', database, '之前:', dbState.currentDatabase);
    if (database) {
        dbState.currentDatabase = database;
        refreshConnectionBadge();
        await loadTables();
    }
}

// 处理连接选择变化
async function handleConnectionChange(e) {
    const connectionId = e.target.value;
    if (connectionId) {
        await connectToDatabase(connectionId);
    }
}

// 加载表列表
async function loadTables() {
    if (!dbState.currentConnection) return;

    const tree = document.getElementById('db-tree');
    if (!tree) return;

    if (!dbState.currentDatabase) {
        tree.innerHTML = '<div class="db-result-placeholder" style="padding: 16px;">请先选择数据库</div>';
        return;
    }

    tree.innerHTML = '<div class="db-result-placeholder" style="padding: 16px;">加载中...</div>';

    try {
        const dbName = String(dbState.currentDatabase).trim();
        const conn = dbState.connections.find(c => c.id === dbState.currentConnection);
        const dbType = conn?.db_type || 'mysql';

        const tables = await invoke('db_get_tables', {
            connectionId: dbState.currentConnection,
            database: dbName,
        });

        if (!tables || tables.length === 0) {
            const emptyText = dbType === 'redis' ? '无 Key' :
                            dbType === 'mongodb' ? '无集合' :
                            dbType === 'elasticsearch' ? '无索引' : '无表';
            tree.innerHTML = `<div class="db-result-placeholder" style="padding: 16px;">${emptyText}</div>`;
            primeSchemaCache(dbState.currentConnection, dbName, []);
            return;
        }

        primeSchemaCache(dbState.currentConnection, dbName, tables.map(t => t.name));
        renderTableTree(tables, dbType);
    } catch (e) {
        console.error('加载表列表失败:', e);
        tree.innerHTML = `<div class="db-result-placeholder" style="padding: 16px; color: var(--error);">加载失败: ${e}</div>`;
    }
}

// 渲染表树
function renderTableTree(tables, dbType = 'mysql') {
    const tree = document.getElementById('db-tree');
    if (!tree) return;

    if (tables.length === 0) {
        const emptyText = dbType === 'redis' ? '无 Key' :
                        dbType === 'mongodb' ? '无集合' :
                        dbType === 'elasticsearch' ? '无索引' : '无表';
        tree.innerHTML = `<div class="db-result-placeholder" style="padding: 16px;">${emptyText}</div>`;
        return;
    }

    // NoSQL 数据库直接显示列表
    if (dbType === 'redis') {
        const infoItem = tables.find(t => t.table_type === 'info');
        const keys = tables.filter(t => t.table_type !== 'info');
        let html = '';
        if (infoItem) {
            html += `<div class="db-tree-item" style="color: var(--text-secondary); font-size: 12px; padding: 4px 8px;">${infoItem.name}</div>`;
        }
        html += keys.map(t => `
            <div class="db-tree-item" data-table="${t.name}" data-type="${t.table_type}">
                <span class="db-tree-icon">${getKeyTypeIcon(t.table_type)}</span>${t.name}
                <span class="db-tree-badge">${t.table_type}</span>
            </div>
        `).join('');
        tree.innerHTML = html;
        bindTreeEvents(tree);
        return;
    }

    if (dbType === 'mongodb') {
        const html = tables.map(t => `
            <div class="db-tree-item" data-table="${t.name}" data-type="collection">
                <span class="db-tree-icon">📦</span>${t.name}
                ${t.row_count !== null ? `<span class="db-tree-badge">${t.row_count} 文档</span>` : ''}
            </div>
        `).join('');
        tree.innerHTML = html;
        bindTreeEvents(tree);
        return;
    }

    if (dbType === 'elasticsearch') {
        const html = tables.map(t => `
            <div class="db-tree-item" data-table="${t.name}" data-type="${t.table_type}">
                <span class="db-tree-icon">${t.table_type === 'field' ? '📋' : '📊'}</span>${t.name}
            </div>
        `).join('');
        tree.innerHTML = html;
        bindTreeEvents(tree);
        return;
    }

    // SQL 数据库：按表和视图分组
    const groups = { 'BASE TABLE': [], 'VIEW': [], 'table': [], 'view': [] };
    tables.forEach(t => {
        const type = t.table_type.toUpperCase();
        if (groups[type]) groups[type].push(t);
        else if (groups[t.table_type]) groups[t.table_type].push(t);
        else groups['BASE TABLE'].push(t);
    });

    let html = '';

    const allTables = [...(groups['BASE TABLE'] || []), ...(groups['table'] || [])];
    const allViews = [...(groups['VIEW'] || []), ...(groups['view'] || [])];

    if (allTables.length > 0) {
        html += `
            <div class="db-tree-folder">
                <div class="db-tree-item"><span class="db-tree-icon">📁</span>表 (${allTables.length})</div>
                <div class="db-tree-children">
                    ${allTables.map(t => `
                        <div class="db-tree-item" data-table="${t.name}" data-type="table">
                            <span class="db-tree-icon">📄</span>${t.name}
                        </div>
                    `).join('')}
                </div>
            </div>
        `;
    }

    if (allViews.length > 0) {
        html += `
            <div class="db-tree-folder">
                <div class="db-tree-item"><span class="db-tree-icon">📁</span>视图 (${allViews.length})</div>
                <div class="db-tree-children">
                    ${allViews.map(t => `
                        <div class="db-tree-item" data-table="${t.name}" data-type="view">
                            <span class="db-tree-icon">👁️</span>${t.name}
                        </div>
                    `).join('')}
                </div>
            </div>
        `;
    }

    tree.innerHTML = html;

    // 绑定所有树节点事件（包括文件夹展开/折叠和表点击）
    bindTreeEvents(tree);
}

// 获取 Redis Key 类型图标
function getKeyTypeIcon(type) {
    const icons = {
        'string': '📝',
        'list': '📋',
        'set': '🎯',
        'zset': '📊',
        'hash': '🗂️',
        'info': 'ℹ️'
    };
    return icons[type] || '📄';
}

// 绑定树节点事件
function bindTreeEvents(tree) {
    // 绑定文件夹展开/折叠
    tree.querySelectorAll('.db-tree-folder > .db-tree-item').forEach(item => {
        item.addEventListener('click', (e) => {
            e.stopPropagation();
            item.parentElement.classList.toggle('open');
        });
    });

    // 绑定表点击和右键事件
    tree.querySelectorAll('.db-tree-item[data-table]').forEach(item => {
        // 单击 / 双击 - 直接打开数据编辑器
        const open = (e) => {
            e.stopPropagation();
            openDataEditor(item.dataset.table);
        };
        item.addEventListener('click', open);
        item.addEventListener('dblclick', open);

        // 右键菜单
        item.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            e.stopPropagation();
            showTableContextMenu(e, item.dataset.table, item.dataset.type);
        });
    });
}

// 显示表右键菜单
function showTableContextMenu(e, tableName, tableType) {
    // 移除已有菜单
    const existing = document.getElementById('db-context-menu');
    if (existing) existing.remove();

    const isView = tableType === 'view';
    const menu = document.createElement('div');
    menu.id = 'db-context-menu';
    menu.className = 'db-context-menu';
    menu.innerHTML = `
        <div class="db-menu-item" data-action="edit">🔢 编辑数据</div>
        ${!isView ? `<div class="db-menu-item" data-action="edit-structure">✏️ 编辑结构</div>` : ''}
        <div class="db-menu-divider"></div>
        ${!isView ? `<div class="db-menu-item db-menu-danger" data-action="truncate">🗑️ 清空表</div>` : ''}
        ${!isView ? `<div class="db-menu-item db-menu-danger" data-action="drop">❌ 删除表</div>` : ''}
        ${isView ? `<div class="db-menu-item db-menu-danger" data-action="drop">❌ 删除视图</div>` : ''}
    `;

    // 定位菜单
    menu.style.left = e.pageX + 'px';
    menu.style.top = e.pageY + 'px';
    document.body.appendChild(menu);

    // 点击其他地方关闭菜单
    const closeMenu = () => {
        menu.remove();
        document.removeEventListener('click', closeMenu);
    };
    setTimeout(() => document.addEventListener('click', closeMenu), 0);

    // 绑定菜单项点击
    menu.querySelectorAll('.db-menu-item').forEach(item => {
        item.addEventListener('click', (e) => {
            e.stopPropagation();
            const action = item.dataset.action;
            handleTableAction(action, tableName, tableType);
            closeMenu();
        });
    });
}

// 处理表操作
function handleTableAction(action, tableName, tableType) {
    switch (action) {
        case 'edit-structure':
            openSchemaEditor(tableName);
            break;
        case 'edit':
            openDataEditor(tableName);
            break;
        case 'truncate':
            if (confirm(`确定要清空表 "${tableName}" 吗？此操作不可恢复！`)) {
                executeSql(`TRUNCATE TABLE ${quoteIdent(tableName)};`);
            }
            break;
        case 'drop':
            const typeText = tableType === 'view' ? '视图' : '表';
            if (confirm(`确定要删除${typeText} "${tableName}" 吗？此操作不可恢复！`)) {
                const sql = tableType === 'view' ? `DROP VIEW ${quoteIdent(tableName)};` : `DROP TABLE ${quoteIdent(tableName)};`;
                executeSql(sql);
            }
            break;
    }
}

// 执行 SQL 并刷新
async function executeSql(sql) {
    if (!dbState.currentConnection || !dbState.currentDatabase) {
        dbShowStatus('请先连接数据库', 'error');
        return;
    }

    try {
        if (getActiveEditor()) {
            getActiveEditor().setValue(sql);
        }
        await executeQuery();
        // 刷新表列表
        await loadTables();
    } catch (e) {
        dbShowStatus(`执行失败: ${e}`, 'error');
    }
}

// 打开数据编辑器
function openDataEditor(tableName) {
    const sql = `SELECT * FROM ${quoteIdent(tableName)} LIMIT 100;`;
    if (getActiveEditor()) {
        getActiveEditor().setValue(sql);
    }
    executeQuery();
}

// ==================== 数据编辑器 ====================

const dataEditor = {
    tableName: null,
    schema: null,
    data: [],
    changes: [], // {rowIndex, column, oldValue, newValue}
    deletedRows: [],
    newRows: [],
    page: 1,
    pageSize: 100,
    totalRows: 0,
    primaryKey: null,
};

// 打开数据编辑器
function openDataEditor(tableName) {
    dataEditor.tableName = tableName;
    dataEditor.page = 1;
    dataEditor.changes = [];
    dataEditor.deletedRows = [];
    dataEditor.newRows = [];

    const modal = document.getElementById('db-data-editor-modal');
    document.getElementById('db-editor-title').textContent = `编辑: ${tableName}`;

    // 获取表结构
    try {
        invoke('db_get_table_schema', {
            connectionId: dbState.currentConnection,
            database: dbState.currentDatabase,
            table: tableName,
        }).then(schema => {
            dataEditor.schema = schema;

            // 找主键
            const pkCol = dataEditor.schema.columns.find(c => c.is_primary_key);
            dataEditor.primaryKey = pkCol ? pkCol.name : null;

            modal.classList.add('active');
            loadDataEditorData();
            initEditorEvents();
        }).catch(e => {
            alert('获取表结构失败: ' + e);
        });
    } catch (e) {
        alert('获取表结构失败: ' + e);
    }
}

// 加载数据
async function loadDataEditorData() {
    const dbType = (dbState.connections.find(c => c.id === dbState.currentConnection) || {}).db_type;

    // Redis：用 schema 中的数据直接展示，不需要 SQL 查询
    if (dbType === 'redis') {
        const columns = dataEditor.schema.columns;
        // 每列的 comment/default 就是值，构造单行数据匹配列结构
        const row = columns.map(col => col.comment || col.default || null);
        dataEditor.data = [row];
        dataEditor.totalRows = 1;
        renderEditorTable();
        document.getElementById('db-editor-page-info').textContent = `${columns[0]?.name === 'value' ? 'String' : columns[0]?.data_type || 'Key'} 类型`;
        return;
    }

    // MongoDB：通过 query 命令获取文档
    if (dbType === 'mongodb') {
        try {
            const result = await invoke('db_query', {
                connectionId: dbState.currentConnection,
                sql: `${dataEditor.tableName}?{}?20`,
                database: dbState.currentDatabase,
            });
            dataEditor.data = result.rows || [];
            dataEditor.totalRows = result.row_count || 0;
            renderEditorTable();
            document.getElementById('db-editor-page-info').textContent = `共 ${dataEditor.totalRows} 条`;
        } catch (e) {
            document.getElementById('db-editor-status').textContent = '加载失败: ' + e;
        }
        return;
    }

    // Elasticsearch：显示索引映射结构
    if (dbType === 'elasticsearch') {
        const fields = dataEditor.schema.columns;
        // 重新定义 schema 为两列：字段名 + 类型
        dataEditor.schema = {
            name: dataEditor.schema.name,
            columns: [
                { name: '字段名', data_type: 'keyword', is_primary_key: false },
                { name: '类型', data_type: 'keyword', is_primary_key: false },
            ]
        };
        dataEditor.data = fields.map(f => [f.name, f.data_type]);
        dataEditor.totalRows = fields.length;
        renderEditorTable();
        document.getElementById('db-editor-page-info').textContent = `${fields.length} 个字段`;
        return;
    }

    const offset = (dataEditor.page - 1) * dataEditor.pageSize;

    try {
        // 获取总数
        const countResult = await invoke('db_query', {
            connectionId: dbState.currentConnection,
            sql: `SELECT COUNT(*) as cnt FROM \`${dataEditor.tableName}\``,
            database: dbState.currentDatabase,
        });
        dataEditor.totalRows = parseInt(countResult.rows[0]?.[0]) || 0;

        // 获取数据
        const result = await invoke('db_query', {
            connectionId: dbState.currentConnection,
            sql: `SELECT * FROM \`${dataEditor.tableName}\` LIMIT ${dataEditor.pageSize} OFFSET ${offset}`,
            database: dbState.currentDatabase,
        });

        dataEditor.data = result.rows || [];
        renderEditorTable();

        // 更新分页信息
        const totalPages = Math.ceil(dataEditor.totalRows / dataEditor.pageSize) || 1;
        document.getElementById('db-editor-page-info').textContent =
            `第 ${dataEditor.page}/${totalPages} 页，共 ${dataEditor.totalRows} 行`;
    } catch (e) {
        document.getElementById('db-editor-status').textContent = '加载失败: ' + e;
    }
}

// 渲染表格
function renderEditorTable() {
    const thead = document.getElementById('db-editor-thead');
    const tbody = document.getElementById('db-editor-tbody');
    const columns = dataEditor.schema.columns;

    // 表头
    let headerHtml = '<tr><th class="row-checkbox"><input type="checkbox" id="editor-select-all"></th>';
    columns.forEach((col, i) => {
        const pk = col.is_primary_key ? ' class="pk"' : '';
        headerHtml += `<th${pk}>${escapeHtml(col.name)}<br><small>${escapeHtml(col.data_type)}</small></th>`;
    });
    headerHtml += '</tr>';
    thead.innerHTML = headerHtml;

    // 表体
    let bodyHtml = '';
    dataEditor.data.forEach((row, rowIndex) => {
        bodyHtml += `<tr data-row="${rowIndex}">`;
        bodyHtml += `<td class="row-checkbox"><input type="checkbox" class="row-select"></td>`;
        columns.forEach((col, colIndex) => {
            const value = row[colIndex];
            const isPk = col.is_primary_key;
            const cellClass = isPk ? 'pk' : 'editable';
            const displayValue = value === null ? 'NULL' : escapeHtml(String(value));
            const nullClass = value === null ? ' null-value' : '';

            // 检查是否有修改
            const change = dataEditor.changes.find(c => c.rowIndex === rowIndex && c.column === col.name);
            const modifiedClass = change ? ' modified' : '';
            const showValue = change ? escapeHtml(change.newValue) : displayValue;

            bodyHtml += `<td class="${cellClass}${nullClass}${modifiedClass}" data-col="${escapeHtmlAttr(col.name)}" data-col-index="${colIndex}">${showValue}</td>`;
        });
        bodyHtml += '</tr>';
    });
    tbody.innerHTML = bodyHtml;

    // 绑定单元格点击事件
    tbody.querySelectorAll('td.editable').forEach(cell => {
        cell.addEventListener('dblclick', () => startEditCell(cell));
    });

    // 行选择
    tbody.querySelectorAll('.row-select').forEach(cb => {
        cb.addEventListener('change', updateEditorButtons);
    });
}

// 开始编辑单元格（即时模式：失焦/回车立即 UPDATE）
function startEditCell(cell) {
    if (cell.classList.contains('editing')) return;

    const row = cell.parentElement;
    const rowIndex = parseInt(row.dataset.row);
    const colName = cell.dataset.col;
    const colIndex = parseInt(cell.dataset.colIndex);
    const currentValue = dataEditor.data[rowIndex][colIndex];

    if (!dataEditor.primaryKey) {
        dbShowStatus('当前表没有主键，无法在编辑器中修改。请用 SQL 编辑器。', 'error');
        return;
    }

    // 创建输入框
    const input = document.createElement('input');
    input.type = 'text';
    input.value = currentValue === null ? '' : currentValue;

    cell.classList.add('editing');
    cell.innerHTML = '';
    cell.appendChild(input);
    input.focus();
    input.select();

    let committed = false;

    const renderCell = (value) => {
        cell.classList.remove('editing');
        if (value === null) {
            cell.textContent = 'NULL';
            cell.classList.add('null-value');
        } else {
            cell.textContent = value;
            cell.classList.remove('null-value');
        }
    };

    const commit = async () => {
        if (committed) return;
        committed = true;
        const raw = input.value;
        const newValue = raw === '' ? null : raw;

        // 没改 → 直接还原显示
        if (newValue === currentValue || (newValue === null && currentValue === null)) {
            renderCell(currentValue);
            return;
        }

        const tableName = dataEditor.tableName;
        const pkCondition = getPkConditionSql(dataEditor.data[rowIndex]);
        const sql = `UPDATE ${quoteIdent(tableName)} SET ${quoteIdent(colName)} = ${formatSqlValue(newValue)} WHERE ${pkCondition}`;

        cell.classList.add('saving');
        cell.classList.remove('editing');
        cell.textContent = '...';

        try {
            const result = await invoke('db_execute', {
                connectionId: dbState.currentConnection,
                sql,
                database: dbState.currentDatabase,
            });
            if (!result.success) throw new Error(result.error || '更新失败');

            // 写入本地缓存，避免重新查询
            dataEditor.data[rowIndex][colIndex] = newValue;
            cell.classList.remove('saving');
            renderCell(newValue);
            cell.classList.add('saved-flash');
            setTimeout(() => cell.classList.remove('saved-flash'), 800);
            recordMessage('info', sql, `UPDATE 成功`);

            // 撤销 toast：执行反向 UPDATE
            showToast({
                message: `✓ 已更新 ${colName}`,
                type: 'success',
                undoAction: async () => {
                    const undoSql = `UPDATE ${quoteIdent(tableName)} SET ${quoteIdent(colName)} = ${formatSqlValue(currentValue)} WHERE ${pkCondition}`;
                    try {
                        await invoke('db_execute', {
                            connectionId: dbState.currentConnection,
                            sql: undoSql,
                            database: dbState.currentDatabase,
                        });
                        dataEditor.data[rowIndex][colIndex] = currentValue;
                        renderCell(currentValue);
                        dbShowStatus('已撤销修改', 'success');
                    } catch (e) {
                        dbShowStatus(`撤销失败: ${e}`, 'error');
                    }
                },
            });
        } catch (e) {
            cell.classList.remove('saving');
            renderCell(currentValue);
            cell.classList.add('error-flash');
            setTimeout(() => cell.classList.remove('error-flash'), 1200);
            dbShowStatus(`更新失败: ${e}`, 'error');
            recordMessage('error', sql, String(e));
        }
    };

    const cancel = () => {
        if (committed) return;
        committed = true;
        renderCell(currentValue);
    };

    input.addEventListener('blur', commit);
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            input.removeEventListener('blur', commit);
            commit();
        } else if (e.key === 'Escape') {
            input.removeEventListener('blur', commit);
            cancel();
        }
    });
}

// ============================================================
// 即时模式辅助：构建主键条件 + Toast + 撤销
// ============================================================

function getPkConditionSql(rowData) {
    const pkCol = dataEditor.primaryKey;
    if (!pkCol) throw new Error('当前表没有主键，无法定位行');
    const pkIndex = dataEditor.schema.columns.findIndex(c => c.name === pkCol);
    const pkValue = rowData[pkIndex];
    const pkValueSql = pkValue === null ? 'IS NULL' : `= ${formatSqlValue(pkValue)}`;
    return `${quoteIdent(pkCol)} ${pkValueSql}`;
}

// 顶层 toast 系统（即时操作的反馈 + 撤销）
function showToast({message, type = 'info', undoAction = null, durationMs = 5000}) {
    const stack = document.getElementById('db-toast-stack');
    if (!stack) return;

    const toast = document.createElement('div');
    toast.className = `db-toast db-toast-${type}`;
    const undoBtn = undoAction
        ? `<button class="db-toast-undo">撤销 <span class="db-toast-timer">${Math.ceil(durationMs / 1000)}</span></button>`
        : '';
    toast.innerHTML = `
        <span class="db-toast-msg">${escapeHtml(message)}</span>
        ${undoBtn}
        <button class="db-toast-close" title="关闭">×</button>
    `;
    stack.appendChild(toast);

    let cancelled = false;
    const dismiss = () => {
        if (cancelled) return;
        cancelled = true;
        toast.classList.add('leaving');
        setTimeout(() => toast.remove(), 200);
    };

    if (undoAction) {
        const undoEl = toast.querySelector('.db-toast-undo');
        const timerEl = toast.querySelector('.db-toast-timer');
        let remaining = Math.ceil(durationMs / 1000);
        const tick = setInterval(() => {
            remaining--;
            if (timerEl) timerEl.textContent = remaining;
            if (remaining <= 0) clearInterval(tick);
        }, 1000);
        undoEl.addEventListener('click', () => {
            clearInterval(tick);
            dismiss();
            undoAction();
        });
    }
    toast.querySelector('.db-toast-close').addEventListener('click', dismiss);
    setTimeout(dismiss, durationMs);
}

// ============================================================
// 数据编辑器：即时模式（双击改值立即 UPDATE，删除立即 DELETE，添加行弹表单立即 INSERT）
// ============================================================

// 关闭/刷新前不再需要丢弃确认（每次操作都立即生效）
function confirmDiscardEditorChanges() { return true; }

// 初始化事件
let _editorEventsBound = false;
function initEditorEvents() {
    if (_editorEventsBound) return;
    _editorEventsBound = true;

    // 关闭按钮
    document.querySelector('#db-data-editor-modal .modal-close').onclick = () => {
        document.getElementById('db-data-editor-modal').classList.remove('active');
    };

    // 点击模态外区域关闭
    document.getElementById('db-data-editor-modal')?.addEventListener('click', evt => {
        if (evt.target.id === 'db-data-editor-modal') {
            evt.target.classList.remove('active');
        }
    });

    // Esc 关闭
    document.addEventListener('keydown', evt => {
        if (evt.key !== 'Escape') return;
        const modal = document.getElementById('db-data-editor-modal');
        if (!modal || !modal.classList.contains('active')) return;
        modal.classList.remove('active');
    });

    // 删除行（即时）
    document.getElementById('db-editor-delete-row').onclick = deleteSelectedRows;
    // 添加行（即时）
    document.getElementById('db-editor-add-row').onclick = openInsertModal;

    // 刷新
    document.getElementById('db-editor-refresh').onclick = () => loadDataEditorData();

    // 分页
    document.getElementById('db-editor-prev').onclick = () => {
        if (dataEditor.page > 1) { dataEditor.page--; loadDataEditorData(); }
    };
    document.getElementById('db-editor-next').onclick = () => {
        const totalPages = Math.ceil(dataEditor.totalRows / dataEditor.pageSize);
        if (dataEditor.page < totalPages) { dataEditor.page++; loadDataEditorData(); }
    };
    document.getElementById('db-editor-page-size').onchange = (e) => {
        dataEditor.pageSize = parseInt(e.target.value);
        dataEditor.page = 1;
        loadDataEditorData();
    };

    // 全选
    const selectAllCb = document.getElementById('editor-select-all');
    if (selectAllCb) {
        selectAllCb.onchange = (e) => {
            document.querySelectorAll('#db-editor-tbody .row-select').forEach(cb => {
                cb.checked = e.target.checked;
            });
            updateEditorButtons();
        };
    }

    // 插入弹窗按钮
    document.getElementById('db-insert-close')?.addEventListener('click', closeInsertModal);
    document.getElementById('db-insert-cancel')?.addEventListener('click', closeInsertModal);
    document.getElementById('db-insert-ok')?.addEventListener('click', confirmInsertRow);

    updateEditorButtons();
}

// 更新按钮状态：即时模式下只关心是否有勾选
function updateEditorButtons() {
    const hasSelected = document.querySelectorAll('#db-editor-tbody .row-select:checked').length > 0;
    const delBtn = document.getElementById('db-editor-delete-row');
    if (delBtn) delBtn.disabled = !hasSelected;
}

// 删除选中行：直接发 DELETE + 5 秒撤销
async function deleteSelectedRows() {
    const selected = Array.from(document.querySelectorAll('#db-editor-tbody .row-select:checked'));
    if (selected.length === 0) return;

    if (!dataEditor.primaryKey) {
        dbShowStatus('当前表没有主键，无法在编辑器中删除。请用 SQL 编辑器。', 'error');
        return;
    }

    const rowsToDelete = selected.map(cb => {
        const row = cb.closest('tr');
        const rowIndex = parseInt(row.dataset.row);
        return {rowIndex, rowData: [...dataEditor.data[rowIndex]]};
    });

    // 立即在 UI 上灰掉
    for (const {rowIndex} of rowsToDelete) {
        const rowEl = document.querySelector(`#db-editor-tbody tr[data-row="${rowIndex}"]`);
        if (rowEl) {
            rowEl.classList.add('deleted');
            rowEl.style.opacity = '0.4';
        }
    }

    const tableName = dataEditor.tableName;
    let ok = 0;
    const failedSqls = [];
    for (const {rowData} of rowsToDelete) {
        const sql = `DELETE FROM ${quoteIdent(tableName)} WHERE ${getPkConditionSql(rowData)}`;
        try {
            const result = await invoke('db_execute', {
                connectionId: dbState.currentConnection,
                sql,
                database: dbState.currentDatabase,
            });
            if (result.success) ok++;
            else failedSqls.push({sql, error: result.error || '未知错误'});
        } catch (e) {
            failedSqls.push({sql, error: String(e)});
        }
    }

    if (failedSqls.length > 0) {
        dbShowStatus(`⚠️ 删除部分失败：${failedSqls.length} 行`, 'error');
        for (const f of failedSqls) recordMessage('error', f.sql, f.error);
        await loadDataEditorData();
        return;
    }

    recordMessage('info', '', `已删除 ${ok} 行 (${tableName})`);
    showToast({
        message: `✓ 已删除 ${ok} 行`,
        type: 'success',
        undoAction: async () => await undoDelete(tableName, rowsToDelete),
    });
    await loadDataEditorData();
}

// 撤销删除：用 INSERT 重新插入
async function undoDelete(tableName, rowsToDelete) {
    const cols = dataEditor.schema.columns;
    const colsSql = cols.map(c => quoteIdent(c.name)).join(', ');
    let restored = 0;
    for (const {rowData} of rowsToDelete) {
        const valuesSql = rowData.map(v => formatSqlValue(v)).join(', ');
        const sql = `INSERT INTO ${quoteIdent(tableName)} (${colsSql}) VALUES (${valuesSql})`;
        try {
            await invoke('db_execute', {
                connectionId: dbState.currentConnection,
                sql,
                database: dbState.currentDatabase,
            });
            restored++;
        } catch (e) {
            recordMessage('error', sql, String(e));
        }
    }
    dbShowStatus(`已恢复 ${restored} / ${rowsToDelete.length} 行`, 'success');
    await loadDataEditorData();
}

// ============================================================
// 添加行：弹简洁表单 → 立即 INSERT
// ============================================================

function openInsertModal() {
    if (!dataEditor.schema) return;
    const fieldsEl = document.getElementById('db-insert-fields');
    const titleEl = document.getElementById('db-insert-title');
    titleEl.textContent = `添加新行到 ${dataEditor.tableName}`;

    fieldsEl.innerHTML = dataEditor.schema.columns.map((col, i) => {
        const required = col.nullable ? '' : '<span class="db-insert-required" title="非空">*</span>';
        const pk = col.is_primary_key ? '<span class="db-insert-pk" title="主键">PK</span>' : '';
        const ai = col.auto_increment ? '<span class="db-insert-ai" title="自增">AUTO</span>' : '';
        const skipChecked = col.auto_increment || col.default ? 'checked' : '';
        const placeholder = col.default ? `默认: ${col.default}` : (col.nullable ? 'NULL' : '');
        return `
            <div class="db-insert-field" data-col-index="${i}">
                <div class="db-insert-field-head">
                    <label class="db-insert-skip"><input type="checkbox" class="db-insert-skip-cb" ${skipChecked}> 使用默认</label>
                    <span class="db-insert-name">${escapeHtml(col.name)}${pk}${ai}${required}</span>
                    <code class="db-insert-type">${escapeHtml(col.data_type)}${col.length ? `(${col.length})` : ''}</code>
                </div>
                <input type="text" class="db-insert-value" placeholder="${escapeHtmlAttr(placeholder)}" ${skipChecked ? 'disabled' : ''}>
                <label class="db-insert-null-lbl"><input type="checkbox" class="db-insert-null-cb"> NULL</label>
            </div>
        `;
    }).join('');

    // 联动：skip / null 切换 input 启用状态
    fieldsEl.querySelectorAll('.db-insert-field').forEach(f => {
        const skipCb = f.querySelector('.db-insert-skip-cb');
        const nullCb = f.querySelector('.db-insert-null-cb');
        const input = f.querySelector('.db-insert-value');
        const sync = () => {
            const disabled = skipCb.checked || nullCb.checked;
            input.disabled = disabled;
            if (nullCb.checked) input.value = '';
        };
        skipCb.addEventListener('change', sync);
        nullCb.addEventListener('change', sync);
    });

    document.getElementById('db-insert-modal').classList.add('active');
    setTimeout(() => {
        const firstInput = fieldsEl.querySelector('.db-insert-value:not([disabled])');
        if (firstInput) firstInput.focus();
    }, 50);
}

function closeInsertModal() {
    document.getElementById('db-insert-modal')?.classList.remove('active');
}

async function confirmInsertRow() {
    const cols = dataEditor.schema.columns;
    const colsToInsert = [];
    const values = [];

    const fields = document.querySelectorAll('#db-insert-fields .db-insert-field');
    for (const f of fields) {
        const idx = parseInt(f.dataset.colIndex);
        const col = cols[idx];
        const skipped = f.querySelector('.db-insert-skip-cb').checked;
        if (skipped) continue;
        const isNull = f.querySelector('.db-insert-null-cb').checked;
        const raw = f.querySelector('.db-insert-value').value;
        colsToInsert.push(col.name);
        values.push(isNull ? null : raw);
    }

    if (colsToInsert.length === 0) {
        dbShowStatus('请至少填入一列', 'error');
        return;
    }

    const tableName = dataEditor.tableName;
    const colsSql = colsToInsert.map(c => quoteIdent(c)).join(', ');
    const valsSql = values.map(v => formatSqlValue(v)).join(', ');
    const sql = `INSERT INTO ${quoteIdent(tableName)} (${colsSql}) VALUES (${valsSql})`;

    try {
        const result = await invoke('db_execute', {
            connectionId: dbState.currentConnection,
            sql,
            database: dbState.currentDatabase,
        });
        if (!result.success) throw new Error(result.error || '插入失败');
        closeInsertModal();
        showToast({
            message: `✓ 已插入 1 行 (id=${result.last_insert_id ?? 'n/a'})`,
            type: 'success',
            undoAction: result.last_insert_id != null && dataEditor.primaryKey
                ? async () => {
                    const pkCol = dataEditor.primaryKey;
                    const undoSql = `DELETE FROM ${quoteIdent(tableName)} WHERE ${quoteIdent(pkCol)} = ${formatSqlValue(result.last_insert_id)}`;
                    try {
                        await invoke('db_execute', {
                            connectionId: dbState.currentConnection,
                            sql: undoSql,
                            database: dbState.currentDatabase,
                        });
                        dbShowStatus('已撤销插入', 'success');
                        await loadDataEditorData();
                    } catch (e) {
                        dbShowStatus(`撤销失败: ${e}`, 'error');
                    }
                }
                : null,
        });
        recordMessage('info', sql, `INSERT 成功 (${tableName})`);
        await loadDataEditorData();
    } catch (e) {
        dbShowStatus(`插入失败: ${e}`, 'error');
        recordMessage('error', sql, String(e));
    }
}

// 格式化 SQL 值
function formatSqlValue(value) {
    if (value === null || value === 'NULL') return 'NULL';
    return `'${escapeSql(value)}'`;
}

// 转义 SQL
function escapeSql(str) {
    return String(str).replace(/'/g, "''");
}

// ==================== 表结构编辑器 ====================

const schemaEditor = {
    tableName: null,
    originalColumns: [],
    columns: [],
    changes: [],
    isNewTable: false,
};

// 常用数据类型
const DATA_TYPES = {
    mysql: ['INT', 'BIGINT', 'SMALLINT', 'TINYINT', 'VARCHAR', 'CHAR', 'TEXT', 'LONGTEXT', 'MEDIUMTEXT', 'DATETIME', 'DATE', 'TIME', 'TIMESTAMP', 'DECIMAL', 'DOUBLE', 'FLOAT', 'BOOLEAN', 'BLOB', 'JSON', 'ENUM'],
    postgresql: ['INTEGER', 'BIGINT', 'SMALLINT', 'VARCHAR', 'CHAR', 'TEXT', 'DATE', 'TIME', 'TIMESTAMP', 'TIMESTAMPTZ', 'DECIMAL', 'DOUBLE PRECISION', 'REAL', 'BOOLEAN', 'BYTEA', 'JSON', 'JSONB', 'UUID', 'SERIAL', 'BIGSERIAL'],
    sqlite: ['INTEGER', 'TEXT', 'REAL', 'BLOB', 'NUMERIC', 'BOOLEAN', 'DATE', 'DATETIME']
};

// 打开表结构编辑器
async function openSchemaEditor(tableName) {
    schemaEditor.tableName = tableName;
    schemaEditor.isNewTable = false;
    schemaEditor.changes = [];

    try {
        const schema = await invoke('db_get_table_schema', {
            connectionId: dbState.currentConnection,
            database: dbState.currentDatabase,
            table: tableName,
        });

        schemaEditor.originalColumns = JSON.parse(JSON.stringify(schema.columns));
        schemaEditor.columns = schema.columns;

        document.getElementById('db-schema-title').textContent = `编辑结构: ${tableName}`;
        document.getElementById('db-schema-table-name').value = tableName;
        document.getElementById('db-schema-table-comment').value = '';

        renderSchemaColumns();
        initSchemaEditorEvents();

        document.getElementById('db-schema-editor-modal').classList.add('active');
    } catch (e) {
        alert('获取表结构失败: ' + e);
    }
}

// 打开创建表对话框
function openCreateTableDialog() {
    schemaEditor.tableName = '';
    schemaEditor.isNewTable = true;
    schemaEditor.columns = [];
    schemaEditor.originalColumns = [];

    // 添加默认的主键列
    schemaEditor.columns = [{
        name: 'id',
        data_type: 'INT',
        length: '',
        nullable: false,
        default: '',
        is_primary_key: true,
        auto_increment: true,
        comment: '',
        isNew: true,
    }];

    document.getElementById('db-create-table-name').value = '';
    document.getElementById('db-create-table-comment').value = '';

    renderCreateTableColumns();
    initCreateTableEvents();

    document.getElementById('db-create-table-modal').classList.add('active');
}

// 渲染表结构列
function renderSchemaColumns() {
    const tbody = document.getElementById('db-schema-tbody');
    const conn = dbState.connections.find(c => c.id === dbState.currentConnection);
    const dbType = conn ? conn.db_type : 'mysql';
    const types = DATA_TYPES[dbType] || DATA_TYPES.mysql;

    let html = '';
    schemaEditor.columns.forEach((col, index) => {
        const isNewClass = col.isNew ? 'col-new' : '';
        const deletedClass = col.deleted ? 'col-deleted' : '';
        const modifiedClass = col.modified ? 'col-modified' : '';

        html += `<tr data-index="${index}" class="${isNewClass} ${deletedClass} ${modifiedClass}">
            <td class="col-check"><input type="checkbox" class="col-select"></td>
            <td><input type="text" class="col-name-input" value="${col.name}" data-field="name"></td>
            <td>
                <select class="col-type-select" data-field="data_type">
                    ${types.map(t => `<option value="${t}" ${col.data_type === t ? 'selected' : ''}>${t}</option>`).join('')}
                </select>
            </td>
            <td><input type="text" class="col-len-input" value="${col.length || ''}" data-field="length"></td>
            <td><input type="checkbox" ${col.nullable ? 'checked' : ''} data-field="nullable"></td>
            <td><input type="text" class="col-default-input" value="${col.default || ''}" data-field="default"></td>
            <td><input type="checkbox" ${col.is_primary_key ? 'checked' : ''} data-field="is_primary_key"></td>
            <td><input type="checkbox" ${col.auto_increment ? 'checked' : ''} data-field="auto_increment"></td>
            <td><input type="text" class="col-comment-input" value="${col.comment || ''}" data-field="comment"></td>
        </tr>`;
    });

    tbody.innerHTML = html;

    // 绑定变更事件
    tbody.querySelectorAll('input, select').forEach(el => {
        el.addEventListener('change', () => {
            const row = el.closest('tr');
            const index = parseInt(row.dataset.index);
            const field = el.dataset.field;
            let value;

            if (el.type === 'checkbox') {
                value = el.checked;
            } else {
                value = el.value;
            }

            // 标记为修改
            schemaEditor.columns[index][field] = value;
            if (!schemaEditor.columns[index].isNew) {
                schemaEditor.columns[index].modified = true;
                row.classList.add('col-modified');
            }
        });
    });

    updateSchemaStatus();
}

// 渲染创建表列
function renderCreateTableColumns() {
    const tbody = document.getElementById('db-create-tbody');
    const conn = dbState.connections.find(c => c.id === dbState.currentConnection);
    const dbType = conn ? conn.db_type : 'mysql';
    const types = DATA_TYPES[dbType] || DATA_TYPES.mysql;

    let html = '';
    schemaEditor.columns.forEach((col, index) => {
        html += `<tr data-index="${index}" class="col-new">
            <td class="col-check"><button class="btn-icon" onclick="schemaEditorRemoveColumn(${index})">×</button></td>
            <td><input type="text" class="col-name-input" value="${col.name}" data-field="name" placeholder="列名"></td>
            <td>
                <select class="col-type-select" data-field="data_type">
                    ${types.map(t => `<option value="${t}" ${col.data_type === t ? 'selected' : ''}>${t}</option>`).join('')}
                </select>
            </td>
            <td><input type="text" class="col-len-input" value="${col.length || ''}" data-field="length"></td>
            <td><input type="checkbox" ${col.nullable ? 'checked' : ''} data-field="nullable"></td>
            <td><input type="text" class="col-default-input" value="${col.default || ''}" data-field="default"></td>
            <td><input type="checkbox" ${col.is_primary_key ? 'checked' : ''} data-field="is_primary_key"></td>
            <td><input type="checkbox" ${col.auto_increment ? 'checked' : ''} data-field="auto_increment"></td>
            <td><input type="text" class="col-comment-input" value="${col.comment || ''}" data-field="comment"></td>
        </tr>`;
    });

    tbody.innerHTML = html;

    // 绑定变更事件
    tbody.querySelectorAll('input, select').forEach(el => {
        el.addEventListener('change', () => {
            const row = el.closest('tr');
            const index = parseInt(row.dataset.index);
            const field = el.dataset.field;
            let value;

            if (el.type === 'checkbox') {
                value = el.checked;
            } else {
                value = el.value;
            }

            schemaEditor.columns[index][field] = value;
        });
    });
}

// 删除列（创建表时）
function schemaEditorRemoveColumn(index) {
    schemaEditor.columns.splice(index, 1);
    renderCreateTableColumns();
}

// 初始化结构编辑器事件
function initSchemaEditorEvents() {
    // 关闭
    document.querySelector('#db-schema-editor-modal .modal-close').onclick = () => {
        if (schemaEditor.changes.length > 0 || schemaEditor.columns.some(c => c.modified || c.isNew || c.deleted)) {
            if (!confirm('有未保存的更改，确定关闭吗？')) return;
        }
        document.getElementById('db-schema-editor-modal').classList.remove('active');
    };

    // 添加列
    document.getElementById('db-schema-add-col').onclick = () => {
        schemaEditor.columns.push({
            name: '',
            data_type: 'VARCHAR',
            length: '255',
            nullable: true,
            default: '',
            is_primary_key: false,
            auto_increment: false,
            comment: '',
            isNew: true,
        });
        renderSchemaColumns();
    };

    // 删除选中列
    document.getElementById('db-schema-del-col').onclick = () => {
        const selected = document.querySelectorAll('#db-schema-tbody .col-select:checked');
        selected.forEach(cb => {
            const row = cb.closest('tr');
            const index = parseInt(row.dataset.index);
            if (schemaEditor.columns[index].isNew) {
                // 新列直接删除
                schemaEditor.columns.splice(index, 1);
            } else {
                // 已存在列标记删除
                schemaEditor.columns[index].deleted = true;
            }
        });
        renderSchemaColumns();
    };

    // 保存
    document.getElementById('db-schema-save').onclick = saveSchemaChanges;

    // 全选
    document.getElementById('schema-select-all').onchange = (e) => {
        document.querySelectorAll('#db-schema-tbody .col-select').forEach(cb => {
            cb.checked = e.target.checked;
        });
    };
}

// 初始化创建表事件
function initCreateTableEvents() {
    // 关闭
    document.querySelector('#db-create-table-modal .modal-close').onclick = () => {
        document.getElementById('db-create-table-modal').classList.remove('active');
    };

    // 添加列
    document.getElementById('db-create-add-col').onclick = () => {
        schemaEditor.columns.push({
            name: '',
            data_type: 'VARCHAR',
            length: '255',
            nullable: true,
            default: '',
            is_primary_key: false,
            auto_increment: false,
            comment: '',
            isNew: true,
        });
        renderCreateTableColumns();
    };

    // 创建表
    document.getElementById('db-create-table-submit').onclick = createNewTable;
}

// 保存结构更改
async function saveSchemaChanges() {
    const statusEl = document.getElementById('db-schema-status');
    statusEl.textContent = '保存中...';

    try {
        let sqls = [];
        const tableName = schemaEditor.tableName;
        const conn = dbState.connections.find(c => c.id === dbState.currentConnection);
        const dbType = conn ? conn.db_type : 'mysql';

        // 处理删除的列
        schemaEditor.columns.filter(c => c.deleted).forEach(col => {
            sqls.push(`ALTER TABLE \`${tableName}\` DROP COLUMN \`${col.name}\`;`);
        });

        // 处理新增列
        schemaEditor.columns.filter(c => c.isNew && !c.deleted).forEach(col => {
            let colDef = buildColumnDefinition(col, dbType);
            sqls.push(`ALTER TABLE \`${tableName}\` ADD COLUMN \`${col.name}\` ${colDef};`);
        });

        // 处理修改列
        schemaEditor.columns.filter(c => c.modified && !c.deleted && !c.isNew).forEach(col => {
            let colDef = buildColumnDefinition(col, dbType);
            if (dbType === 'mysql') {
                sqls.push(`ALTER TABLE \`${tableName}\` MODIFY COLUMN \`${col.name}\` ${colDef};`);
            } else if (dbType === 'postgresql') {
                // PostgreSQL 需要分开处理
                sqls.push(`ALTER TABLE \`${tableName}\` ALTER COLUMN \`${col.name}\` TYPE ${col.data_type};`);
            }
        });

        if (sqls.length === 0) {
            statusEl.textContent = '没有需要保存的更改';
            return;
        }

        // 执行 SQL
        for (const sql of sqls) {
            await invoke('db_execute', {
                connectionId: dbState.currentConnection,
                sql,
                database: dbState.currentDatabase,
            });
        }

        statusEl.textContent = `已保存 ${sqls.length} 条更改`;
        schemaEditor.changes = [];
        schemaEditor.originalColumns = JSON.parse(JSON.stringify(schemaEditor.columns.filter(c => !c.deleted)));

        // 刷新表列表
        await loadTables();

        setTimeout(() => {
            document.getElementById('db-schema-editor-modal').classList.remove('active');
        }, 1000);
    } catch (e) {
        statusEl.textContent = '保存失败: ' + e;
    }
}

// 创建新表
async function createNewTable() {
    const tableName = document.getElementById('db-create-table-name').value.trim();
    const tableComment = document.getElementById('db-create-table-comment').value.trim();
    const statusEl = document.getElementById('db-create-status');

    if (!tableName) {
        statusEl.textContent = '请输入表名';
        return;
    }

    if (schemaEditor.columns.length === 0) {
        statusEl.textContent = '请至少添加一列';
        return;
    }

    statusEl.textContent = '创建中...';

    try {
        const conn = dbState.connections.find(c => c.id === dbState.currentConnection);
        const dbType = conn ? conn.db_type : 'mysql';

        // 构建 CREATE TABLE SQL
        let columnsDef = schemaEditor.columns.filter(c => c.name.trim()).map(col => {
            let def = `\`${col.name}\` ${buildColumnDefinition(col, dbType)}`;
            return def;
        }).join(',\n    ');

        // 添加主键约束
        const pkColumns = schemaEditor.columns.filter(c => c.is_primary_key && c.name.trim());
        if (pkColumns.length > 0) {
            columnsDef += ',\n    PRIMARY KEY (' + pkColumns.map(c => `\`${c.name}\``).join(', ') + ')';
        }

        let sql = `CREATE TABLE \`${tableName}\` (\n    ${columnsDef}\n)`;

        if (dbType === 'mysql' && tableComment) {
            sql += ` COMMENT='${escapeSql(tableComment)}'`;
        }

        sql += ';';

        await invoke('db_execute', {
            connectionId: dbState.currentConnection,
            sql,
            database: dbState.currentDatabase,
        });

        statusEl.textContent = '表创建成功';
        await loadTables();

        setTimeout(() => {
            document.getElementById('db-create-table-modal').classList.remove('active');
        }, 1000);
    } catch (e) {
        statusEl.textContent = '创建失败: ' + e;
    }
}

// 构建列定义
function buildColumnDefinition(col, dbType) {
    let def = col.data_type;

    // 添加长度
    if (col.length && ['VARCHAR', 'CHAR', 'DECIMAL', 'INT', 'BIGINT', 'FLOAT', 'DOUBLE'].includes(col.data_type.toUpperCase())) {
        def += `(${col.length})`;
    }

    // NULL/NOT NULL
    def += col.nullable ? ' NULL' : ' NOT NULL';

    // 默认值
    if (col.default) {
        def += ` DEFAULT ${formatSqlValue(col.default)}`;
    }

    // 自增 (MySQL)
    if (col.auto_increment && dbType === 'mysql') {
        def += ' AUTO_INCREMENT';
    }

    // 注释 (MySQL)
    if (col.comment && dbType === 'mysql') {
        def += ` COMMENT '${escapeSql(col.comment)}'`;
    }

    return def;
}

// 更新结构状态
function updateSchemaStatus() {
    const newCount = schemaEditor.columns.filter(c => c.isNew && !c.deleted).length;
    const modCount = schemaEditor.columns.filter(c => c.modified && !c.deleted).length;
    const delCount = schemaEditor.columns.filter(c => c.deleted).length;

    const statusEl = document.getElementById('db-schema-status');
    statusEl.textContent = `新增 ${newCount} 列，修改 ${modCount} 列，删除 ${delCount} 列`;
}

// 把 SQL 文本按语句切分，返回 [{sql, start, end}]，正确处理字符串/注释中的 ;
function splitSqlStatements(text) {
    const out = [];
    const len = text.length;
    let i = 0;
    let stmtStart = 0;

    while (i < len) {
        const c = text[i];
        const c2 = text[i + 1];

        // 行注释
        if (c === '-' && c2 === '-') {
            while (i < len && text[i] !== '\n') i++;
            continue;
        }
        // 块注释
        if (c === '/' && c2 === '*') {
            i += 2;
            while (i < len && !(text[i] === '*' && text[i + 1] === '/')) i++;
            i += 2;
            continue;
        }
        // 字符串字面量（' 和 "），跳过其中的 ;
        if (c === '\'' || c === '"' || c === '`') {
            const quote = c;
            i++;
            while (i < len) {
                if (text[i] === '\\' && quote !== '`') { i += 2; continue; }
                if (text[i] === quote) {
                    // SQL 双引号转义：'' / ""
                    if (text[i + 1] === quote) { i += 2; continue; }
                    i++;
                    break;
                }
                i++;
            }
            continue;
        }
        // 语句分隔符
        if (c === ';') {
            const seg = text.slice(stmtStart, i);
            if (seg.trim()) out.push({sql: seg.trim(), start: stmtStart, end: i + 1});
            i++;
            stmtStart = i;
            continue;
        }
        i++;
    }
    const tail = text.slice(stmtStart);
    if (tail.trim()) out.push({sql: tail.trim(), start: stmtStart, end: len});
    return out;
}

// ============================================================
// 破坏性 SQL 检测与确认
// ============================================================

// 移除注释后再做关键字匹配，避免 -- DELETE 误报
function stripSqlComments(sql) {
    return sql
        .replace(/--[^\n]*/g, '')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .trim();
}

function analyzeDestructive(sql) {
    const stmts = splitSqlStatements(sql);
    const findings = [];
    for (const s of stmts) {
        const clean = stripSqlComments(s.sql);
        if (!clean) continue;

        // DROP / TRUNCATE：永远危险
        if (/^DROP\s+(TABLE|DATABASE|SCHEMA|VIEW|INDEX)\b/i.test(clean)) {
            findings.push({type: 'DROP', sql: s.sql, keyword: 'DROP', label: 'DROP（永久删除对象）'});
        } else if (/^TRUNCATE\b/i.test(clean)) {
            findings.push({type: 'TRUNCATE', sql: s.sql, keyword: 'TRUNCATE', label: 'TRUNCATE（清空表数据）'});
        } else if (/^DELETE\s+FROM\b/i.test(clean) && !/\bWHERE\b/i.test(clean)) {
            findings.push({type: 'DELETE_ALL', sql: s.sql, keyword: 'DELETE', label: 'DELETE 无 WHERE 子句（删除全表数据）'});
        } else if (/^UPDATE\b/i.test(clean) && !/\bWHERE\b/i.test(clean)) {
            findings.push({type: 'UPDATE_ALL', sql: s.sql, keyword: 'UPDATE', label: 'UPDATE 无 WHERE 子句（更新全表数据）'});
        } else if (/^ALTER\s+TABLE\b[\s\S]*\bDROP\s+(COLUMN|CONSTRAINT|FOREIGN\s+KEY|PRIMARY\s+KEY)\b/i.test(clean)) {
            findings.push({type: 'ALTER_DROP', sql: s.sql, keyword: 'ALTER', label: 'ALTER TABLE DROP（删除列/约束）'});
        }
    }
    return findings;
}

// 选取「最强」的关键字作为输入要求
function strongestKeyword(findings) {
    const order = ['DROP', 'TRUNCATE', 'DELETE', 'UPDATE', 'ALTER'];
    for (const k of order) {
        if (findings.some(f => f.keyword === k)) return k;
    }
    return findings[0].keyword;
}

function confirmDestructive(findings) {
    return new Promise(resolve => {
        const modal = document.getElementById('db-confirm-modal');
        const summary = document.getElementById('db-confirm-summary');
        const sqlBox = document.getElementById('db-confirm-sql');
        const keywordEl = document.getElementById('db-confirm-keyword');
        const input = document.getElementById('db-confirm-input');
        const okBtn = document.getElementById('db-confirm-ok');
        const cancelBtn = document.getElementById('db-confirm-cancel');
        if (!modal) { resolve(true); return; }

        const keyword = strongestKeyword(findings);
        keywordEl.textContent = keyword;
        summary.innerHTML = findings.map(f =>
            `<div class="db-confirm-finding">⚠️ ${escapeHtml(f.label)}</div>`
        ).join('');
        sqlBox.textContent = findings.map(f => f.sql + ';').join('\n\n');
        input.value = '';
        okBtn.disabled = true;
        modal.classList.add('active');
        setTimeout(() => input.focus(), 50);

        const cleanup = () => {
            modal.classList.remove('active');
            input.removeEventListener('input', onInput);
            input.removeEventListener('keydown', onKey);
            okBtn.removeEventListener('click', onOk);
            cancelBtn.removeEventListener('click', onCancel);
        };

        const onInput = () => {
            okBtn.disabled = input.value.trim().toUpperCase() !== keyword;
        };
        const onKey = e => {
            if (e.key === 'Enter' && !okBtn.disabled) onOk();
            else if (e.key === 'Escape') onCancel();
        };
        const onOk = () => { cleanup(); resolve(true); };
        const onCancel = () => { cleanup(); resolve(false); };

        input.addEventListener('input', onInput);
        input.addEventListener('keydown', onKey);
        okBtn.addEventListener('click', onOk);
        cancelBtn.addEventListener('click', onCancel);
    });
}

// 选取要执行的 SQL：优先选区，其次光标所在语句，最后全部
function getSqlToExecute(editor) {
    if (!editor) return '';
    const sel = editor.getSelection();
    if (sel && sel.trim()) return sel.trim();

    const text = editor.getValue();
    if (!text.trim()) return '';

    const cursorOffset = editor.indexFromPos(editor.getCursor());
    const stmts = splitSqlStatements(text);
    if (stmts.length === 0) return text.trim();
    if (stmts.length === 1) return stmts[0].sql;

    for (const s of stmts) {
        if (cursorOffset >= s.start && cursorOffset <= s.end) return s.sql;
    }
    // 光标在末尾：返回最后一条
    return stmts[stmts.length - 1].sql;
}

// 执行查询
async function executeQuery() {
    if (!dbState.currentConnection) {
        dbShowStatus('请先选择连接', 'error');
        return;
    }

    const tab = getActiveTab();
    if (!tab) return;

    // 已经在跑：点击 = 取消
    if (tab.running) {
        cancelActiveQuery();
        return;
    }

    const sql = getSqlToExecute(tab.editor);
    if (!sql) {
        const curConn = dbState.connections.find(c => c.id === dbState.currentConnection);
        const prompt = curConn?.db_type === 'redis' ? '请输入 Redis 命令' :
                      curConn?.db_type === 'mongodb' ? '请输入 MongoDB 查询' :
                      curConn?.db_type === 'elasticsearch' ? '请输入 ES 查询' : '请输入 SQL 语句';
        dbShowStatus(prompt, 'error');
        return;
    }

    // 破坏性 SQL 拦截（仅 SQL 数据库）
    const curConn2 = dbState.connections.find(c => c.id === dbState.currentConnection);
    const isNoSQL = ['redis', 'mongodb', 'elasticsearch'].includes(curConn2?.db_type);
    if (!isNoSQL) {
        const destructive = analyzeDestructive(sql);
        if (destructive.length > 0) {
            const ok = await confirmDestructive(destructive);
            if (!ok) {
                dbShowStatus('已取消', 'info');
                recordMessage('warning', sql, '用户取消执行破坏性 SQL');
                return;
            }
        }
    }

    dbShowStatus('执行中...', 'info');
    tab.running = true;
    tab.lastSql = sql;
    tab.queryToken = (crypto.randomUUID && crypto.randomUUID()) ||
                     (Date.now() + '-' + Math.random().toString(36).slice(2));
    renderTabStrip();
    updateExecuteButton();

    const startTime = Date.now();
    const conn = dbState.connections.find(c => c.id === dbState.currentConnection);
    const connName = conn ? conn.name : '';
    const database = dbState.currentDatabase || null;
    let success = false;
    let rowCount = 0;
    let errorMsg = null;

    // 根据数据库类型决定调用方式
    const isQuery = isNoSQL || /^\s*(SELECT|SHOW|DESC|DESCRIBE|EXPLAIN|WITH)/i.test(sql);

    try {
        if (isQuery) {
            const result = await invoke('db_query', {
                connectionId: dbState.currentConnection,
                sql,
                database,
                queryToken: tab.queryToken,
            });
            const duration = Date.now() - startTime;
            displayQueryResult(result, duration, tab);
            success = !!result.success;
            rowCount = result.row_count || 0;
            if (!success) errorMsg = result.error || null;
        } else {
            const result = await invoke('db_execute', {
                connectionId: dbState.currentConnection,
                sql,
                database,
                queryToken: tab.queryToken,
            });
            const duration = Date.now() - startTime;
            displayExecuteResult(result, duration, tab);
            success = !!result.success;
            rowCount = result.affected_rows || 0;
            if (!success) errorMsg = result.error || null;
        }
    } catch (e) {
        const duration = Date.now() - startTime;
        const msg = String(e);
        dbShowStatus(`执行失败: ${msg}`, 'error');
        displayError(msg, duration);
        errorMsg = msg;
    } finally {
        tab.running = false;
        tab.queryToken = null;
        tab.dirty = false;
        renderTabStrip();
        updateExecuteButton();
        const durationMs = Date.now() - startTime;
        recordHistory({
            sql,
            connectionId: dbState.currentConnection,
            connectionName: connName,
            database,
            durationMs,
            success,
            rowCount,
            error: errorMsg,
        });
        if (success) {
            recordMessage('info', sql, `执行成功 (${rowCount} 行, ${durationMs}ms)`);
            updateConnectionHealth('connected');
            // 简单的事务边界识别
            if (/^\s*BEGIN\b/i.test(sql) || /^\s*START\s+TRANSACTION\b/i.test(sql)) {
                setTransactionState(true);
            } else if (/^\s*(COMMIT|ROLLBACK)\b/i.test(sql)) {
                setTransactionState(false);
            }
        } else {
            recordMessage('error', sql, errorMsg || '执行失败');
            // 错误信息暗示连接掉了
            if (errorMsg && /connection|closed|broken|timeout|refused|reset/i.test(errorMsg)) {
                updateConnectionHealth('disconnected');
            } else {
                updateConnectionHealth('error');
            }
        }
    }
}

// 显示查询结果
const RESULT_PAGE_SIZES = [200, 500, 1000, 2000];
const RESULT_DEFAULT_PAGE_SIZE = 500;
const VIRTUAL_ROW_HEIGHT = 28;       // 行估算高度（px），首次渲染后校准
const VIRTUAL_BUFFER_ROWS = 20;      // 视口上下额外渲染缓冲
const CELL_TRUNCATE = 200;           // 单元格内容截断长度

function displayQueryResult(result, duration, tab) {
    tab = tab || getActiveTab();
    if (!tab) return;

    if (!result.success) {
        displayError(result.error || '未知错误', duration);
        tab.result = {isError: true, error: result.error, duration};
        return;
    }

    // 试图从 SQL 推断源表（用于 FK 导航 + WHERE 筛选）
    const sourceTable = extractPrimaryTable(tab.lastSql || (tab.editor && tab.editor.getValue()) || '');

    tab.result = {
        columns: result.columns || [],
        rows: result.rows || [],
        rowCount: result.row_count || 0,
        duration,
        page: 0,
        pageSize: RESULT_DEFAULT_PAGE_SIZE,
        isError: false,
        kind: 'query',
        sourceTable,
    };
    renderTabResult(tab);
    dbShowStatus('查询完成', 'success');
}

function extractPrimaryTable(sql) {
    if (!sql) return null;
    const clean = stripSqlComments(sql);
    // 匹配 FROM <schema>.<table> 或 FROM <table>，捕获最后一段
    const m = /\bFROM\s+(?:[`"]?([\w]+)[`"]?\.)?[`"]?([\w]+)[`"]?/i.exec(clean);
    return m ? m[2] : null;
}

function displayExecuteResult(result, duration, tab) {
    tab = tab || getActiveTab();
    if (!tab) return;

    if (!result.success) {
        displayError(result.error || '未知错误', duration);
        tab.result = {isError: true, error: result.error, duration};
        return;
    }

    tab.result = {
        affectedRows: result.affected_rows,
        lastInsertId: result.last_insert_id,
        duration,
        isError: false,
        kind: 'execute',
    };
    renderTabResult(tab);
    dbShowStatus('执行完成', 'success');
}

// 显示错误
function displayError(error, duration) {
    const container = document.getElementById('db-result-content');
    const info = document.getElementById('db-result-info');

    container.innerHTML = `<div class="db-result-placeholder" style="color: var(--red);">错误: ${escapeHtml(String(error))}</div>`;
    if (info) info.textContent = `错误 | ${duration}ms`;
    dbShowStatus('执行失败', 'error');
}

function getNoSQLHelper(dbType) {
    if (dbType === 'elasticsearch') {
        return `<div class="db-nosql-helper">
            <div class="helper-title">Elasticsearch 使用助手</div>
            <div class="helper-section">
                <div class="helper-label">查询格式</div>
                <code>索引名?查询JSON</code>
            </div>
            <div class="helper-grid">
                <div class="helper-card">
                    <div class="helper-card-title">基础查询</div>
                    <div class="helper-example" data-cmd="my_index">my_index</div>
                    <div class="helper-desc">查询全部（match_all，前100条）</div>
                    <div class="helper-example" data-cmd="my_index?{}">my_index?{}</div>
                    <div class="helper-desc">同上，显式空查询</div>
                </div>
                <div class="helper-card">
                    <div class="helper-card-title">条件查询</div>
                    <div class="helper-example" data-cmd='my_index?{"query":{"match":{"name":"张三"}}}'>my_index?{"query":{"match":{"name":"张三"}}}</div>
                    <div class="helper-desc">全文匹配</div>
                    <div class="helper-example" data-cmd='my_index?{"query":{"term":{"status":"active"}}}'>my_index?{"query":{"term":{"status":"active"}}}</div>
                    <div class="helper-desc">精确匹配</div>
                </div>
                <div class="helper-card">
                    <div class="helper-card-title">复合查询</div>
                    <div class="helper-example" data-cmd='my_index?{"query":{"bool":{"must":[{"match":{"name":"张三"}},{"range":{"age":{"gte":18}}}]}},"size":50}'>my_index?{"query":{"bool":{"must":[...]}},"size":50}</div>
                    <div class="helper-desc">bool 组合 + 分页</div>
                    <div class="helper-example" data-cmd='my_index?{"query":{"range":{"created_at":{"gte":"2024-01-01"}}},"sort":[{"created_at":"desc"}]}'>my_index?{"query":{"range":{...}},"sort":[...]}</div>
                    <div class="helper-desc">范围 + 排序</div>
                </div>
                <div class="helper-card">
                    <div class="helper-card-title">写入操作</div>
                    <div class="helper-example" data-cmd='index:my_index:{"name":"张三","age":25}'>index:my_index:{"name":"张三","age":25}</div>
                    <div class="helper-desc">写入文档（自动生成 ID）</div>
                    <div class="helper-example" data-cmd='delete:my_index:文档ID'>delete:my_index:文档ID</div>
                    <div class="helper-desc">删除指定文档</div>
                </div>
            </div>
            <div class="helper-tip">提示：左侧选择索引后，点击字段名可查看映射结构</div>
        </div>`;
    }
    if (dbType === 'redis') {
        return `<div class="db-nosql-helper">
            <div class="helper-title">Redis 使用助手</div>
            <div class="helper-grid">
                <div class="helper-card">
                    <div class="helper-card-title">字符串</div>
                    <div class="helper-example" data-cmd="GET key">GET key</div>
                    <div class="helper-example" data-cmd="SET key value">SET key value</div>
                    <div class="helper-example" data-cmd="MGET key1 key2">MGET key1 key2</div>
                </div>
                <div class="helper-card">
                    <div class="helper-card-title">哈希</div>
                    <div class="helper-example" data-cmd="HGETALL myhash">HGETALL myhash</div>
                    <div class="helper-example" data-cmd="HSET myhash field value">HSET myhash field value</div>
                </div>
                <div class="helper-card">
                    <div class="helper-card-title">列表</div>
                    <div class="helper-example" data-cmd="LRANGE mylist 0 -1">LRANGE mylist 0 -1</div>
                    <div class="helper-example" data-cmd="LPUSH mylist item">LPUSH mylist item</div>
                </div>
                <div class="helper-card">
                    <div class="helper-card-title">集合 / 有序集合</div>
                    <div class="helper-example" data-cmd="SMEMBERS myset">SMEMBERS myset</div>
                    <div class="helper-example" data-cmd="ZRANGE myzset 0 -1 WITHSCORES">ZRANGE myzset 0 -1 WITHSCORES</div>
                </div>
                <div class="helper-card">
                    <div class="helper-card-title">键操作</div>
                    <div class="helper-example" data-cmd="KEYS *">KEYS *</div>
                    <div class="helper-example" data-cmd="TYPE key">TYPE key</div>
                    <div class="helper-example" data-cmd="TTL key">TTL key</div>
                    <div class="helper-example" data-cmd="DEL key">DEL key</div>
                </div>
                <div class="helper-card">
                    <div class="helper-card-title">服务器</div>
                    <div class="helper-example" data-cmd="INFO">INFO</div>
                    <div class="helper-example" data-cmd="DBSIZE">DBSIZE</div>
                </div>
            </div>
            <div class="helper-tip">提示：输入 GET 遇到 WRONGTYPE 时会自动检测 key 类型并用正确命令重试</div>
        </div>`;
    }
    if (dbType === 'mongodb') {
        return `<div class="db-nosql-helper">
            <div class="helper-title">MongoDB 使用助手</div>
            <div class="helper-section">
                <div class="helper-label">查询格式</div>
                <code>collection?filter_json</code>
            </div>
            <div class="helper-grid">
                <div class="helper-card">
                    <div class="helper-card-title">查询</div>
                    <div class="helper-example" data-cmd="users">users</div>
                    <div class="helper-desc">查询全部文档</div>
                    <div class="helper-example" data-cmd='users?{"name":"Alice"}'>users?{"name":"Alice"}</div>
                    <div class="helper-desc">条件查询</div>
                    <div class="helper-example" data-cmd='users?{"age":{"$gte":18}}'>users?{"age":{"$gte":18}}</div>
                    <div class="helper-desc">范围查询</div>
                </div>
                <div class="helper-card">
                    <div class="helper-card-title">写入操作</div>
                    <div class="helper-example" data-cmd='insert:users:{"name":"Bob","age":30}'>insert:users:{"name":"Bob","age":30}</div>
                    <div class="helper-desc">插入文档</div>
                    <div class="helper-example" data-cmd='update:users:{"name":"Bob"}|{"$set":{"age":31}}'>update:users:filter|update</div>
                    <div class="helper-desc">更新文档（filter|update）</div>
                    <div class="helper-example" data-cmd='delete:users:{"name":"Bob"}'>delete:users:{"name":"Bob"}</div>
                    <div class="helper-desc">删除文档</div>
                </div>
            </div>
        </div>`;
    }
    return '';
}

function showNoSQLHelper() {
    const dbType = (dbState.connections.find(c => c.id === dbState.currentConnection) || {}).db_type;
    if (!dbType) return;
    const content = getNoSQLHelper(dbType);
    if (!content) return;
    const titles = { elasticsearch: 'Elasticsearch 使用助手', redis: 'Redis 使用助手', mongodb: 'MongoDB 使用助手' };
    document.getElementById('db-nosql-help-title').textContent = titles[dbType] || '使用助手';
    document.getElementById('db-nosql-help-body').innerHTML = content;
    document.getElementById('db-nosql-help-modal').style.display = 'flex';
}

function closeNoSQLHelper() {
    document.getElementById('db-nosql-help-modal').style.display = 'none';
}

function renderTabResult(tab) {
    const container = document.getElementById('db-result-content');
    const info = document.getElementById('db-result-info');
    if (!container) return;

    if (!tab || !tab.result) {
        container.innerHTML = '<div class="db-result-placeholder">执行查询查看结果</div>';
        if (info) info.textContent = '就绪';
        return;
    }

    const r = tab.result;
    if (r.isError) {
        container.innerHTML = `<div class="db-result-placeholder" style="color: var(--red);">错误: ${escapeHtml(String(r.error || ''))}</div>`;
        if (info) info.textContent = `错误 | ${r.duration}ms`;
        return;
    }

    if (r.kind === 'execute') {
        let infoText = `影响 ${r.affectedRows} 行`;
        if (r.lastInsertId) infoText += ` | 最后插入 ID: ${r.lastInsertId}`;
        infoText += ` | ${r.duration}ms`;
        container.innerHTML = `<div class="db-result-placeholder">执行成功</div>`;
        if (info) info.textContent = infoText;
        return;
    }

    // query 结果
    if (r.rowCount === 0) {
        container.innerHTML = '<div class="db-result-placeholder">查询返回 0 行</div>';
        if (info) info.textContent = `0 行 | ${r.duration}ms`;
        return;
    }

    renderResultGrid(container, r);
    const pageCount = Math.max(1, Math.ceil(r.rowCount / r.pageSize));
    const firstRow = r.page * r.pageSize + 1;
    const lastRow = Math.min(r.rowCount, (r.page + 1) * r.pageSize);
    if (info) {
        info.textContent = `${r.rowCount} 行 (显示 ${firstRow}-${lastRow}) | 第 ${r.page + 1}/${pageCount} 页 | ${r.duration}ms`;
    }
}

function renderResultGrid(container, r) {
    const pageStart = r.page * r.pageSize;
    const pageEnd = Math.min(r.rowCount, pageStart + r.pageSize);
    const pageRows = r.rows.slice(pageStart, pageEnd);
    const pageCount = Math.max(1, Math.ceil(r.rowCount / r.pageSize));

    // 构造结构：分页栏 + 滚动容器（虚拟） + 表头独立 sticky
    container.innerHTML = `
        <div class="db-result-wrap">
            <div class="db-result-pager">
                <button class="db-pg-btn" data-pg="first" ${r.page === 0 ? 'disabled' : ''}>«</button>
                <button class="db-pg-btn" data-pg="prev" ${r.page === 0 ? 'disabled' : ''}>‹</button>
                <span class="db-pg-info">第 ${r.page + 1} / ${pageCount} 页</span>
                <button class="db-pg-btn" data-pg="next" ${r.page >= pageCount - 1 ? 'disabled' : ''}>›</button>
                <button class="db-pg-btn" data-pg="last" ${r.page >= pageCount - 1 ? 'disabled' : ''}>»</button>
                <span class="db-pg-sep">|</span>
                <label class="db-pg-size">页大小
                    <select class="db-pg-select">
                        ${RESULT_PAGE_SIZES.map(s => `<option value="${s}" ${s === r.pageSize ? 'selected' : ''}>${s}</option>`).join('')}
                    </select>
                </label>
                <span class="db-pg-jump">
                    跳到 <input type="number" class="db-pg-input" min="1" max="${pageCount}" value="${r.page + 1}"> 页
                </span>
            </div>
            <div class="db-result-scroll" id="db-result-scroll">
                <table class="db-result-table" id="db-result-table">
                    <thead><tr>${r.columns.map(c => `<th>${escapeHtml(c.name)}</th>`).join('')}</tr></thead>
                    <tbody id="db-result-tbody"></tbody>
                </table>
            </div>
        </div>
    `;

    // 分页交互
    const pager = container.querySelector('.db-result-pager');
    pager.querySelectorAll('.db-pg-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const tab = getActiveTab();
            if (!tab || !tab.result) return;
            switch (btn.dataset.pg) {
                case 'first': tab.result.page = 0; break;
                case 'prev': tab.result.page = Math.max(0, tab.result.page - 1); break;
                case 'next': tab.result.page = Math.min(pageCount - 1, tab.result.page + 1); break;
                case 'last': tab.result.page = pageCount - 1; break;
            }
            renderTabResult(tab);
        });
    });
    pager.querySelector('.db-pg-select').addEventListener('change', evt => {
        const tab = getActiveTab();
        if (!tab || !tab.result) return;
        tab.result.pageSize = parseInt(evt.target.value, 10) || RESULT_DEFAULT_PAGE_SIZE;
        tab.result.page = 0;
        renderTabResult(tab);
    });
    const jumpInput = pager.querySelector('.db-pg-input');
    jumpInput.addEventListener('change', () => {
        const tab = getActiveTab();
        if (!tab || !tab.result) return;
        const p = Math.max(1, Math.min(pageCount, parseInt(jumpInput.value, 10) || 1));
        tab.result.page = p - 1;
        renderTabResult(tab);
    });

    // 单元格点击查看全文
    const scrollEl = container.querySelector('#db-result-scroll');
    scrollEl.addEventListener('click', evt => {
        const cell = evt.target.closest('td.truncated');
        if (cell && cell.dataset.full) {
            showCellViewer(cell.dataset.full);
        }
    });

    // 单元格右键菜单（FK 导航等）
    scrollEl.addEventListener('contextmenu', evt => {
        const cell = evt.target.closest('td');
        if (!cell || cell.parentElement.classList.contains('db-spacer')) return;
        evt.preventDefault();
        const colIdx = parseInt(cell.dataset.col, 10);
        const rowIdx = parseInt(cell.parentElement.dataset.row, 10);
        if (isNaN(colIdx) || isNaN(rowIdx)) return;
        const tab = getActiveTab();
        if (!tab || !tab.result) return;
        const value = tab.result.rows[rowIdx][colIdx];
        const colName = tab.result.columns[colIdx]?.name || '';
        showResultCellMenu(evt.clientX, evt.clientY, {value, colName, sourceTable: tab.result.sourceTable});
    });

    setupVirtualScroll(scrollEl, pageRows, r.columns);
}

// ============================================================
// 结果单元格右键菜单 + FK 导航
// ============================================================

const _fkCache = {};  // key: `${conn}::${db}::${table}` -> [{column, referenced_table, ...}]

async function ensureFkLoaded(table) {
    if (!table) return [];
    const key = `${dbState.currentConnection}::${dbState.currentDatabase}::${table}`;
    if (_fkCache[key]) return _fkCache[key];
    try {
        const fks = await invoke('db_get_foreign_keys', {
            connectionId: dbState.currentConnection,
            database: dbState.currentDatabase,
            table,
        });
        _fkCache[key] = Array.isArray(fks) ? fks : [];
        return _fkCache[key];
    } catch (e) {
        _fkCache[key] = [];
        return [];
    }
}

function dismissResultCellMenu() {
    const old = document.getElementById('db-cell-menu');
    if (old) old.remove();
    document.removeEventListener('click', dismissResultCellMenu, true);
    document.removeEventListener('keydown', _menuEscHandler, true);
}
function _menuEscHandler(e) { if (e.key === 'Escape') dismissResultCellMenu(); }

async function showResultCellMenu(x, y, ctx) {
    dismissResultCellMenu();
    const menu = document.createElement('div');
    menu.id = 'db-cell-menu';
    menu.className = 'db-cell-menu';

    const valueText = ctx.value === null ? 'NULL' : String(ctx.value);
    const valuePreview = valueText.length > 40 ? valueText.slice(0, 40) + '…' : valueText;
    const items = [
        {key: 'copy', label: `📋 复制值（${escapeHtml(valuePreview)}）`},
        {key: 'filter', label: `🔎 在新 tab 筛选: ${escapeHtml(ctx.colName)} = ...`},
    ];

    menu.innerHTML = items.map(i => `<div class="db-cell-menu-item" data-key="${i.key}">${i.label}</div>`).join('') +
        '<div class="db-cell-menu-loading">加载外键...</div>';
    document.body.appendChild(menu);

    // 定位
    const rect = menu.getBoundingClientRect();
    const maxX = window.innerWidth - rect.width - 8;
    const maxY = window.innerHeight - rect.height - 8;
    menu.style.left = Math.min(x, maxX) + 'px';
    menu.style.top = Math.min(y, maxY) + 'px';

    setTimeout(() => document.addEventListener('click', dismissResultCellMenu, true), 0);
    document.addEventListener('keydown', _menuEscHandler, true);

    // 异步加载 FK 信息
    if (ctx.sourceTable && ctx.value !== null) {
        const fks = await ensureFkLoaded(ctx.sourceTable);
        const loadingEl = menu.querySelector('.db-cell-menu-loading');
        if (loadingEl) loadingEl.remove();
        const matched = fks.filter(fk => fk.column === ctx.colName);
        for (const fk of matched) {
            const item = document.createElement('div');
            item.className = 'db-cell-menu-item db-cell-menu-fk';
            item.dataset.key = 'fk';
            item.dataset.refTable = fk.referenced_table;
            item.dataset.refColumn = fk.referenced_column;
            item.innerHTML = `↗ 打开 <strong>${escapeHtml(fk.referenced_table)}</strong>.${escapeHtml(fk.referenced_column)} = ${escapeHtml(valuePreview)}`;
            menu.appendChild(item);
        }
        if (matched.length === 0) {
            const item = document.createElement('div');
            item.className = 'db-cell-menu-empty';
            item.textContent = '此列无外键';
            menu.appendChild(item);
        }
    } else {
        const loadingEl = menu.querySelector('.db-cell-menu-loading');
        if (loadingEl) loadingEl.remove();
    }

    // 菜单项点击
    menu.addEventListener('click', evt => {
        const item = evt.target.closest('.db-cell-menu-item');
        if (!item) return;
        evt.stopPropagation();
        const key = item.dataset.key;
        if (key === 'copy') {
            navigator.clipboard.writeText(valueText).then(() => dbShowStatus('已复制', 'success'));
        } else if (key === 'filter') {
            const sql = `SELECT * FROM ${quoteIdent(ctx.sourceTable || '<table>')} WHERE ${quoteIdent(ctx.colName)} = ${formatSqlValue(ctx.value)} LIMIT 100;`;
            createTab({name: `筛选 ${ctx.colName}`, sql});
        } else if (key === 'fk') {
            const refTable = item.dataset.refTable;
            const refCol = item.dataset.refColumn;
            const sql = `SELECT * FROM ${quoteIdent(refTable)} WHERE ${quoteIdent(refCol)} = ${formatSqlValue(ctx.value)} LIMIT 100;`;
            createTab({name: `→ ${refTable}`, sql});
        }
        dismissResultCellMenu();
    }, true);
}

function setupVirtualScroll(scrollEl, rows, columns) {
    const tbody = scrollEl.querySelector('#db-result-tbody');
    if (!tbody) return;
    const state = {
        rows,
        columns,
        rowHeight: VIRTUAL_ROW_HEIGHT,
        renderedStart: -1,
        renderedEnd: -1,
    };

    function renderWindow() {
        const scrollTop = scrollEl.scrollTop;
        const viewport = scrollEl.clientHeight || 400;
        let visibleStart = Math.floor(scrollTop / state.rowHeight) - VIRTUAL_BUFFER_ROWS;
        let visibleEnd = Math.ceil((scrollTop + viewport) / state.rowHeight) + VIRTUAL_BUFFER_ROWS;
        visibleStart = Math.max(0, visibleStart);
        visibleEnd = Math.min(state.rows.length, visibleEnd);

        if (visibleStart === state.renderedStart && visibleEnd === state.renderedEnd) return;
        state.renderedStart = visibleStart;
        state.renderedEnd = visibleEnd;

        const topPad = visibleStart * state.rowHeight;
        const bottomPad = (state.rows.length - visibleEnd) * state.rowHeight;
        const colCount = state.columns.length;

        const parts = [];
        if (topPad > 0) parts.push(`<tr class="db-spacer" style="height:${topPad}px"><td colspan="${colCount}"></td></tr>`);
        for (let i = visibleStart; i < visibleEnd; i++) {
            const row = state.rows[i];
            let cells = '';
            for (let c = 0; c < colCount; c++) {
                const v = row[c];
                if (v === null) {
                    cells += `<td class="null" data-col="${c}">NULL</td>`;
                } else {
                    const s = String(v);
                    if (s.length > CELL_TRUNCATE) {
                        cells += `<td class="truncated" data-col="${c}" data-full="${escapeHtmlAttr(s)}">${escapeHtml(s.slice(0, CELL_TRUNCATE))}<span class="db-cell-more">…</span></td>`;
                    } else {
                        cells += `<td data-col="${c}">${escapeHtml(s)}</td>`;
                    }
                }
            }
            parts.push(`<tr data-row="${i}">${cells}</tr>`);
        }
        if (bottomPad > 0) parts.push(`<tr class="db-spacer" style="height:${bottomPad}px"><td colspan="${colCount}"></td></tr>`);
        tbody.innerHTML = parts.join('');

        // 首批渲染后校准行高
        if (state.rowHeight === VIRTUAL_ROW_HEIGHT) {
            const sampleRow = tbody.querySelector('tr:not(.db-spacer)');
            if (sampleRow) {
                const h = sampleRow.offsetHeight;
                if (h > 0 && Math.abs(h - state.rowHeight) > 2) {
                    state.rowHeight = h;
                    state.renderedStart = -1;
                    renderWindow();
                }
            }
        }
    }

    scrollEl.addEventListener('scroll', () => requestAnimationFrame(renderWindow));
    renderWindow();
}

function showCellViewer(full) {
    // 简易：用 alert 替代弹窗；后续可改为 modal
    if (full.length < 2000) {
        alert(full);
    } else {
        const w = window.open('', '_blank', 'width=600,height=400');
        if (w) {
            w.document.title = '单元格内容';
            w.document.body.style.cssText = 'font-family:monospace;white-space:pre-wrap;padding:12px;';
            w.document.body.textContent = full;
        }
    }
}

// 格式化 SQL
function formatSql() {
    if (!getActiveEditor()) return;

    let sql = getActiveEditor().getValue();

    // 简单格式化
    sql = sql
        .replace(/\s+/g, ' ')
        .replace(/\s*,\s*/g, ', ')
        .replace(/FROM/gi, '\nFROM')
        .replace(/WHERE/gi, '\nWHERE')
        .replace(/GROUP BY/gi, '\nGROUP BY')
        .replace(/ORDER BY/gi, '\nORDER BY')
        .replace(/LIMIT/gi, '\nLIMIT')
        .replace(/ JOIN/gi, '\nJOIN')
        .replace(/ ON /gi, '\n  ON ');

    getActiveEditor().setValue(sql.trim());
}

// 清空 SQL
function clearSql() {
    if (getActiveEditor()) {
        getActiveEditor().setValue('');
    }
}

// HTML 转义
function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

// 数据库页面初始化已移至主导航点击处理中

// SSH 页面初始化
function initSshTool() {
    // 确保 Tauri API 可用
    if (!window.__TAURI__) {
        console.warn('Tauri API 未就绪');
        return;
    }
    // 触发会话管理器初始化
    if (window.sshSessionManager && !window.sshSessionManager.initialized) {
        window.sshSessionManager.init();
    }
}
document.querySelectorAll('[data-page="ssh"]').forEach(item => {
    item.addEventListener('click', () => {
        setTimeout(initSshTool, 100);
    });
});

