// ===== HTTP 请求工具 =====
let _httpHistory = [];
let _httpFavorites = [];
let _httpPanelMode = '';
let _httpParamsSyncing = false;
let _httpFolders = [];
let _httpActiveFolder = null; // null = 显示全部，folder id = 选中某文件夹
let _httpEnvVars = {};

// ===== 多 Tab 请求管理 =====
let _reqTabs = [];
let _reqActiveTabId = null;

function _genTabId() {
    return 't' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
}

function createTabState() {
    return {
        id: _genTabId(),
        method: 'GET', url: '',
        params: [],
        headers: [{ key: 'Content-Type', value: 'application/json', checked: true }],
        bodyType: 'json', body: '',
        formdata: [],
        authType: 'none',
        authBearer: '', authBasicUser: '', authBasicPass: '',
        authApiKeyName: 'X-API-Key', authApiKeyValue: '', authApiKeyLoc: 'header',
        timeout: 30,
        hasResponse: false,
        responseStatusHtml: '',
        responseBodyText: '',
        responseRawText: '',
        responseHeadersHtml: '',
        responseSizeWarning: false, responseSizeText: '',
        responseIsImage: false, responseImageSrc: '', responseImageInfo: '',
        fullResponseBody: '',
    };
}

function getKvRowData(containerId) {
    const rows = [];
    document.getElementById(containerId).querySelectorAll('.kv-row').forEach(row => {
        const cb = row.querySelector('.kv-check');
        rows.push({ key: row.querySelector('.kv-key').value, value: row.querySelector('.kv-value').value, checked: cb ? cb.checked : true });
    });
    return rows;
}

function setKvRowData(containerId, rows) {
    const container = document.getElementById(containerId);
    container.innerHTML = '';
    if (!rows || rows.length === 0) { addKvRow(containerId); return; }
    rows.forEach(r => addKvRow(containerId, r.key || '', r.value || '', r.checked !== false));
}

function getHeaderRowData() {
    const rows = [];
    document.getElementById('http-headers-kv').querySelectorAll('.kv-row').forEach(row => {
        const cb = row.querySelector('.kv-check');
        rows.push({ key: row.querySelector('.kv-key').value, value: row.querySelector('.kv-value').value, checked: cb ? cb.checked : true });
    });
    return rows;
}

function setHeaderRowData(rows) {
    const container = document.getElementById('http-headers-kv');
    container.innerHTML = '';
    if (!rows || rows.length === 0) { addHeaderRow(); return; }
    rows.forEach(r => addHeaderRow(r.key || '', r.value || '', r.checked !== false));
}

function saveCurrentTabState() {
    if (!_reqActiveTabId) return;
    const tab = _reqTabs.find(t => t.id === _reqActiveTabId);
    if (!tab) return;
    tab.method = document.getElementById('http-method').value;
    tab.url = document.getElementById('http-url').value;
    tab.timeout = parseInt(document.getElementById('http-timeout').value, 10) || 30;
    tab.bodyType = document.getElementById('http-body-type').value;
    tab.body = editors.httpBody ? editors.httpBody.getValue() : '';
    tab.params = getKvRowData('http-params-kv');
    tab.headers = getHeaderRowData();
    tab.formdata = getKvRowData('http-formdata-kv');
    tab.authType = document.getElementById('http-auth-type').value;
    tab.authBearer = document.getElementById('http-auth-bearer-token').value;
    tab.authBasicUser = document.getElementById('http-auth-basic-user').value;
    tab.authBasicPass = document.getElementById('http-auth-basic-pass').value;
    tab.authApiKeyName = document.getElementById('http-auth-apikey-name').value;
    tab.authApiKeyValue = document.getElementById('http-auth-apikey-value').value;
    tab.authApiKeyLoc = document.getElementById('http-auth-apikey-loc').value;
    tab.hasResponse = document.getElementById('http-response-section').style.display !== 'none';
    tab.responseStatusHtml = document.getElementById('http-response-status').innerHTML;
    tab.responseBodyText = editors.httpResponseBody ? editors.httpResponseBody.getValue() : '';
    tab.responseRawText = editors.httpResponseRaw ? editors.httpResponseRaw.getValue() : '';
    tab.responseHeadersHtml = document.getElementById('http-response-headers-grid').innerHTML;
    tab.responseSizeWarning = document.getElementById('http-response-size-warning').style.display !== 'none';
    tab.responseSizeText = document.getElementById('http-response-size-text').textContent;
    tab.responseIsImage = document.getElementById('http-response-image-wrap').style.display !== 'none';
    tab.responseImageSrc = document.getElementById('http-response-image').src;
    tab.responseImageInfo = document.getElementById('http-response-image-info').textContent;
    tab.fullResponseBody = _httpFullResponseBody;
}

function restoreTabState(tab) {
    _httpParamsSyncing = true;
    try {
        document.getElementById('http-method').value = tab.method;
        updateHttpMethodColor();
        document.getElementById('http-url').value = tab.url;
        document.getElementById('http-timeout').value = tab.timeout;
        document.getElementById('http-body-type').value = tab.bodyType;
        setKvRowData('http-params-kv', tab.params);
        setHeaderRowData(tab.headers);
        setKvRowData('http-formdata-kv', tab.formdata);
        toggleHttpBodyEditor();
        if (editors.httpBody) {
            editors.httpBody.setValue(tab.body || '');
            setTimeout(() => { editors.httpBody && editors.httpBody.refresh(); validateHttpBodyJson(); }, 30);
        }
        document.getElementById('http-auth-type').value = tab.authType;
        toggleHttpAuthPanel();
        document.getElementById('http-auth-bearer-token').value = tab.authBearer || '';
        document.getElementById('http-auth-basic-user').value = tab.authBasicUser || '';
        document.getElementById('http-auth-basic-pass').value = tab.authBasicPass || '';
        document.getElementById('http-auth-apikey-name').value = tab.authApiKeyName || 'X-API-Key';
        document.getElementById('http-auth-apikey-value').value = tab.authApiKeyValue || '';
        document.getElementById('http-auth-apikey-loc').value = tab.authApiKeyLoc || 'header';
    } finally { _httpParamsSyncing = false; }

    _httpFullResponseBody = tab.fullResponseBody || '';
    document.getElementById('http-response-size-warning').style.display = tab.responseSizeWarning ? 'flex' : 'none';
    document.getElementById('http-response-size-text').textContent = tab.responseSizeText || '';

    if (tab.hasResponse) {
        document.getElementById('http-response-section').style.display = 'block';
        document.getElementById('http-response-placeholder').style.display = 'none';
        document.getElementById('http-response-status').innerHTML = tab.responseStatusHtml || '';
        if (tab.responseIsImage) {
            document.getElementById('http-response-image-wrap').style.display = 'flex';
            document.getElementById('http-response-body-editor').style.display = 'none';
            document.getElementById('http-response-image').src = tab.responseImageSrc || '';
            document.getElementById('http-response-image-info').textContent = tab.responseImageInfo || '';
        } else {
            document.getElementById('http-response-image-wrap').style.display = 'none';
            document.getElementById('http-response-body-editor').style.display = 'block';
            if (editors.httpResponseBody) editors.httpResponseBody.setValue(tab.responseBodyText || '');
            if (editors.httpResponseRaw) editors.httpResponseRaw.setValue(tab.responseRawText || '');
        }
        document.getElementById('http-response-headers-grid').innerHTML = tab.responseHeadersHtml || '';
    } else {
        document.getElementById('http-response-section').style.display = 'none';
        document.getElementById('http-response-placeholder').style.display = 'block';
    }

    closeHttpResponseSearch();
    const hSearch = document.getElementById('http-resp-headers-search');
    if (hSearch) { hSearch.value = ''; filterResponseHeaders(''); }
    syncFloatTitle();
}

const _reqMethodColors = { GET:'#00d68f', POST:'#ff9f43', PUT:'#448aff', DELETE:'#ff6b6b', PATCH:'#a855f7', HEAD:'#6c5ce7', OPTIONS:'#8b8fa3' };

function _getReqTabLabel(tab) {
    if (tab.customName) return tab.customName;
    if (!tab.url) return 'New Request';
    const url = tab.url.replace(/\{\{[^}]+\}\}/g, '…');
    try {
        const u = new URL(url.startsWith('http') ? url : 'https://' + url);
        const path = u.pathname === '/' ? '' : u.pathname.slice(0, 12);
        return (u.hostname + path).replace('www.', '');
    } catch(e) { return tab.url.slice(0, 22); }
}

function renderReqTabs() {
    const container = document.getElementById('http-req-tabs-container');
    if (!container) return;
    const canClose = _reqTabs.length > 1;
    container.innerHTML = _reqTabs.map(tab => {
        const isActive = tab.id === _reqActiveTabId;
        const color = _reqMethodColors[tab.method] || '#e4e6f0';
        const label = escapeHtml(_getReqTabLabel(tab));
        return '<div class="http-req-tab' + (isActive ? ' active' : '') + '" onclick="switchReqTab(\'' + tab.id + '\')" ondblclick="event.stopPropagation();startTabRename(\'' + tab.id + '\')">' +
            '<span class="http-req-tab-method" style="color:' + color + '">' + tab.method + '</span>' +
            '<span class="http-req-tab-label" id="http-req-tab-label-' + tab.id + '">' + label + '</span>' +
            (canClose ? '<button class="http-req-tab-close" onclick="event.stopPropagation();closeReqTab(\'' + tab.id + '\')">✕</button>' : '') +
            '</div>';
    }).join('');
    const activeEl = container.querySelector('.http-req-tab.active');
    if (activeEl) activeEl.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

function startTabRename(id) {
    const tab = _reqTabs.find(t => t.id === id);
    if (!tab) return;
    const span = document.getElementById('http-req-tab-label-' + id);
    if (!span) return;
    const currentName = _getReqTabLabel(tab);
    const input = document.createElement('input');
    input.className = 'http-req-tab-rename-input';
    input.value = currentName === 'New Request' ? '' : currentName;
    input.placeholder = 'New Request';
    span.replaceWith(input);
    input.focus();
    input.select();
    function commit() {
        const val = input.value.trim();
        tab.customName = val || '';
        renderReqTabs();
        saveReqTabsToStorage();
    }
    input.addEventListener('blur', commit);
    input.addEventListener('keydown', e => {
        if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
        if (e.key === 'Escape') { input.removeEventListener('blur', commit); renderReqTabs(); }
    });
}

function addReqTab() {
    saveCurrentTabState();
    const tab = createTabState();
    _reqTabs.push(tab);
    _reqActiveTabId = tab.id;
    restoreTabState(tab);
    renderReqTabs();
    saveReqTabsToStorage();
}

function closeReqTab(id) {
    if (_reqTabs.length <= 1) return;
    const idx = _reqTabs.findIndex(t => t.id === id);
    if (idx < 0) return;
    if (_reqActiveTabId === id) saveCurrentTabState();
    _reqTabs.splice(idx, 1);
    if (_reqActiveTabId === id) {
        const newIdx = Math.min(idx, _reqTabs.length - 1);
        _reqActiveTabId = _reqTabs[newIdx].id;
        restoreTabState(_reqTabs[newIdx]);
    }
    renderReqTabs();
    saveReqTabsToStorage();
}

function switchReqTab(id) {
    if (id === _reqActiveTabId) return;
    saveCurrentTabState();
    _reqActiveTabId = id;
    const tab = _reqTabs.find(t => t.id === id);
    if (tab) restoreTabState(tab);
    renderReqTabs();
    saveReqTabsToStorage();
}

function loadHttpEnv() {
    try {
        const saved = localStorage.getItem('http.env_vars');
        if (saved) _httpEnvVars = JSON.parse(saved) || {};
    } catch(e) { _httpEnvVars = {}; }
}

function saveHttpEnv() {
    const pairs = {};
    document.getElementById('http-env-kv').querySelectorAll('.kv-row').forEach(row => {
        const k = row.querySelector('.kv-key').value.trim();
        const v = row.querySelector('.kv-value').value;
        if (k) pairs[k] = v;
    });
    _httpEnvVars = pairs;
    localStorage.setItem('http.env_vars', JSON.stringify(pairs));
    closeHttpEnvModal();
}

function showHttpEnvModal() {
    const container = document.getElementById('http-env-kv');
    container.innerHTML = '';
    const entries = Object.entries(_httpEnvVars);
    if (entries.length === 0) {
        addEnvRow();
    } else {
        entries.forEach(([k, v]) => addEnvRow(k, v));
    }
    document.getElementById('http-env-modal').style.display = 'flex';
}

function closeHttpEnvModal() {
    document.getElementById('http-env-modal').style.display = 'none';
}

// ===== 提取响应字段到环境变量 =====
function _getJsonByPath(obj, path) {
    if (!path) return obj;
    return path.split('.').reduce((o, k) => (o != null && typeof o === 'object' ? o[k] : undefined), obj);
}

function showExtractVarModal() {
    const respSection = document.getElementById('http-response-section');
    if (!respSection || respSection.style.display === 'none') { alert('暂无响应内容'); return; }
    document.getElementById('http-extract-path').value = '';
    document.getElementById('http-extract-varname').value = '';
    document.getElementById('http-extract-preview').textContent = '';
    document.getElementById('http-extract-var-modal').style.display = 'flex';
    document.getElementById('http-extract-path').oninput = _updateExtractPreview;
}

function _updateExtractPreview() {
    const path = document.getElementById('http-extract-path').value.trim();
    const raw = editors.httpResponseBody ? editors.httpResponseBody.getValue() : '';
    const preview = document.getElementById('http-extract-preview');
    try {
        const parsed = JSON.parse(raw);
        const val = _getJsonByPath(parsed, path);
        preview.textContent = val === undefined ? '(未找到路径)' : JSON.stringify(val, null, 2).slice(0, 200);
        preview.style.color = 'var(--text-primary)';
    } catch(e) {
        preview.textContent = '响应不是 JSON 格式';
        preview.style.color = 'var(--text-secondary)';
    }
}

function closeExtractVarModal() {
    document.getElementById('http-extract-var-modal').style.display = 'none';
}

function confirmExtractVar() {
    const path = document.getElementById('http-extract-path').value.trim();
    const varName = document.getElementById('http-extract-varname').value.trim().toUpperCase();
    if (!varName) { alert('请输入变量名'); return; }
    const raw = editors.httpResponseBody ? editors.httpResponseBody.getValue() : '';
    try {
        const parsed = JSON.parse(raw);
        const val = _getJsonByPath(parsed, path);
        const strVal = typeof val === 'object' ? JSON.stringify(val) : String(val == null ? '' : val);
        _httpEnvVars[varName] = strVal;
        saveHttpEnv();
        closeExtractVarModal();
        alert('已提取 ' + varName + ' = ' + strVal.slice(0, 60));
    } catch(e) { alert('提取失败：' + e.message); }
}

function addEnvRow(key = '', value = '') {
    const container = document.getElementById('http-env-kv');
    const row = document.createElement('div');
    row.className = 'kv-row';
    row.innerHTML = '<input type="text" class="kv-key" placeholder="VAR_NAME" autocomplete="off" value="' + escapeHtmlAttr(key) + '"><input type="text" class="kv-value" placeholder="value" autocomplete="off" value="' + escapeHtmlAttr(value) + '"><button class="kv-remove" onclick="removeKvRow(this)">✕</button>';
    container.appendChild(row);
}

function resolveVars(text) {
    if (!text || typeof text !== 'string') return text;
    return text.replace(/\{\{([^}]+)\}\}/g, (_, key) => {
        const k = key.trim();
        return Object.prototype.hasOwnProperty.call(_httpEnvVars, k) ? _httpEnvVars[k] : '{{' + k + '}}';
    });
}

function hasUnresolvedVars(text) {
    return /\{\{[^}]+\}\}/.test(text);
}
let _httpExpandedFolders = new Set(); // 展开的文件夹 id 集合
let _httpFolderModalReturnTo = null; // 新建文件夹后返回的上下文: 'favorite' 或 null
let _httpLayoutMode = 'vertical'; // 'vertical' | 'horizontal'
let _httpFloatEl = null; // 悬浮窗 DOM

// ===== 布局切换 =====

function toggleHttpLayout() {
    const container = document.getElementById('http-layout-container');
    const btn = document.getElementById('http-layout-btn');
    if (_httpLayoutMode === 'vertical') {
        _httpLayoutMode = 'horizontal';
        container.classList.add('horizontal');
        btn.textContent = '↔ 左右';
        btn.title = '切换为上下布局';
    } else {
        _httpLayoutMode = 'vertical';
        container.classList.remove('horizontal');
        btn.textContent = '↕ 上下';
        btn.title = '切换为左右布局';
    }
    // 左右布局时，让编辑器填满容器高度
    updateHttpLayoutHeight();
    setTimeout(() => {
        if (editors.httpResponseBody) editors.httpResponseBody.refresh();
        if (editors.httpResponseRaw) editors.httpResponseRaw.refresh();
        if (editors.httpBody) editors.httpBody.refresh();
    }, 50);
}

function updateHttpLayoutHeight() {
    const container = document.getElementById('http-layout-container');
    if (!container) return;
    const isHorizontal = container.classList.contains('horizontal');
    const bodyEditor = document.getElementById('http-body-editor');
    const respBodyEditor = document.getElementById('http-response-body-editor');
    const respRawEditor = document.getElementById('http-response-raw-editor');

    if (isHorizontal) {
        // 计算可用高度：容器高度 - tabs高度 - padding
        const containerH = container.clientHeight;
        const reqTabs = document.getElementById('http-request-tabs');
        const respTabs = document.getElementById('http-response-tabs');
        const reqTabsH = reqTabs ? reqTabs.offsetHeight : 0;
        const respTabsH = respTabs ? respTabs.offsetHeight : 0;
        // 请求区编辑器高度
        const reqEditorH = Math.max(100, containerH - reqTabsH - 40);
        // 响应区编辑器高度
        const respEditorH = Math.max(100, containerH - respTabsH - 60);

        if (bodyEditor) bodyEditor.style.height = reqEditorH + 'px';
        if (respBodyEditor) respBodyEditor.style.height = respEditorH + 'px';
        if (respRawEditor) respRawEditor.style.height = respEditorH + 'px';
    } else {
        // 上下布局时恢复默认高度
        if (bodyEditor) bodyEditor.style.height = bodyEditor.dataset.defaultH + 'px';
        if (respBodyEditor) respBodyEditor.style.height = respBodyEditor.dataset.defaultH + 'px';
        if (respRawEditor) respRawEditor.style.height = respRawEditor.dataset.defaultH + 'px';
    }
}

// ===== 响应悬浮窗 =====

function floatHttpResponse() {
    if (_httpFloatEl) { closeHttpResponseFloat(); return; }
    const section = document.getElementById('http-response-section');
    if (section.style.display === 'none') return;

    const method = document.getElementById('http-method').value;
    const url = document.getElementById('http-url').value.trim();

    const float = document.createElement('div');
    float.className = 'http-float-window';
    float.innerHTML =
        '<div class="http-float-header">' +
            '<span class="http-float-title">📡 ' + escapeHtml(method + ' ' + url) + '</span>' +
            '<div class="http-float-controls">' +
                '<button class="http-float-max" onclick="toggleFloatMaximize()" title="最大化">⛶</button>' +
                '<button class="http-float-close" onclick="closeHttpResponseFloat()">✕</button>' +
            '</div>' +
        '</div>' +
        '<div class="http-float-body" id="http-float-body"></div>';
    document.body.appendChild(float);

    const floatBody = float.querySelector('#http-float-body');
    const responseArea = document.getElementById('http-response-area');
    floatBody.appendChild(responseArea);

    _httpFloatEl = float;
    _httpFloatMaximized = false;
    initFloatDrag(float);
    initFloatResize(float);

    setTimeout(() => {
        if (editors.httpResponseBody) editors.httpResponseBody.refresh();
        if (editors.httpResponseRaw) editors.httpResponseRaw.refresh();
    }, 100);
}

let _httpFloatMaximized = false;
let _httpFloatPrevStyle = {};

function toggleFloatMaximize() {
    if (!_httpFloatEl) return;
    if (_httpFloatMaximized) {
        // 还原
        Object.assign(_httpFloatEl.style, _httpFloatPrevStyle);
        _httpFloatMaximized = false;
    } else {
        // 最大化前保存位置/大小
        _httpFloatPrevStyle = {
            top: _httpFloatEl.style.top,
            left: _httpFloatEl.style.left,
            right: _httpFloatEl.style.right,
            width: _httpFloatEl.style.width,
            height: _httpFloatEl.style.height,
            borderRadius: _httpFloatEl.style.borderRadius,
        };
        _httpFloatEl.style.top = '0';
        _httpFloatEl.style.left = '0';
        _httpFloatEl.style.right = '0';
        _httpFloatEl.style.width = '100vw';
        _httpFloatEl.style.height = '100vh';
        _httpFloatEl.style.borderRadius = '0';
        _httpFloatMaximized = true;
    }
    setTimeout(() => {
        if (editors.httpResponseBody) editors.httpResponseBody.refresh();
        if (editors.httpResponseRaw) editors.httpResponseRaw.refresh();
    }, 100);
}

function closeHttpResponseFloat() {
    if (!_httpFloatEl) return;
    const responseArea = document.getElementById('http-response-area');
    const layoutContainer = document.getElementById('http-layout-container');
    layoutContainer.appendChild(responseArea);
    _httpFloatEl.remove();
    _httpFloatEl = null;
    _httpFloatMaximized = false;

    setTimeout(() => {
        if (editors.httpResponseBody) editors.httpResponseBody.refresh();
        if (editors.httpResponseRaw) editors.httpResponseRaw.refresh();
    }, 100);
}

function initFloatDrag(float) {
    const header = float.querySelector('.http-float-header');
    let startX, startY, startLeft, startTop;
    header.addEventListener('mousedown', (e) => {
        if (e.target.closest('.http-float-close') || e.target.closest('.http-float-max')) return;
        if (_httpFloatMaximized) return;
        e.preventDefault();
        startX = e.clientX;
        startY = e.clientY;
        startLeft = float.offsetLeft;
        startTop = float.offsetTop;
        document.body.style.cursor = 'move';
        document.body.style.userSelect = 'none';
        const onMove = (e2) => {
            float.style.left = (startLeft + e2.clientX - startX) + 'px';
            float.style.top = (startTop + e2.clientY - startY) + 'px';
            float.style.right = 'auto';
        };
        const onUp = () => {
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
        };
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
    });
}

function initFloatResize(float) {
    const handle = document.createElement('div');
    handle.className = 'http-float-resize';
    float.appendChild(handle);

    let startX, startY, startW, startH;
    handle.addEventListener('mousedown', (e) => {
        if (_httpFloatMaximized) return;
        e.preventDefault();
        e.stopPropagation();
        startX = e.clientX;
        startY = e.clientY;
        startW = float.offsetWidth;
        startH = float.offsetHeight;
        document.body.style.cursor = 'nwse-resize';
        document.body.style.userSelect = 'none';
        const onMove = (e2) => {
            const newW = Math.max(300, startW + e2.clientX - startX);
            const newH = Math.max(200, startH + e2.clientY - startY);
            float.style.width = newW + 'px';
            float.style.height = newH + 'px';
        };
        const onUp = () => {
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
            setTimeout(() => {
                if (editors.httpResponseBody) editors.httpResponseBody.refresh();
                if (editors.httpResponseRaw) editors.httpResponseRaw.refresh();
            }, 50);
        };
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
    });
}

// 发送请求后同步悬浮窗标题
function syncFloatTitle() {
    if (!_httpFloatEl) return;
    const method = document.getElementById('http-method').value;
    const url = document.getElementById('http-url').value.trim();
    const title = _httpFloatEl.querySelector('.http-float-title');
    if (title) title.textContent = '📡 ' + method + ' ' + url;
}
function syncUrlToParams() {
    if (_httpParamsSyncing) return;
    _httpParamsSyncing = true;
    try {
        const url = document.getElementById('http-url').value.trim();
        const params = {};
        try {
            const u = new URL(url.startsWith('http') ? url : 'http://' + url);
            u.searchParams.forEach((v, k) => { params[k] = v; });
        } catch(e) {}
        setKvPairs('http-params-kv', params);
    } finally { _httpParamsSyncing = false; }
}

function syncParamsToUrl() {
    if (_httpParamsSyncing) return;
    _httpParamsSyncing = true;
    try {
        const urlInput = document.getElementById('http-url');
        const raw = urlInput.value.trim();
        try {
            const u = new URL(raw.startsWith('http') ? raw : 'http://' + raw);
            u.search = '';
            document.getElementById('http-params-kv').querySelectorAll('.kv-row').forEach(row => {
                const cb = row.querySelector('.kv-check');
                if (cb && !cb.checked) return;
                const k = row.querySelector('.kv-key').value.trim();
                const v = row.querySelector('.kv-value').value;
                if (k) u.searchParams.set(k, v);
            });
            const result = u.toString();
            urlInput.value = raw.startsWith('http') ? result : result.replace(/^https?:\/\//, '');
        } catch(e) {}
    } finally { _httpParamsSyncing = false; }
}

document.getElementById('http-url').addEventListener('input', syncUrlToParams);
document.getElementById('http-url').addEventListener('keydown', e => { if (e.key === 'Enter') sendHttpRequest(); });
document.getElementById('http-params-kv').addEventListener('input', syncParamsToUrl);

(async () => {
    try {
        _httpHistory = await invoke('http_load_history');
        _httpFavorites = await invoke('http_load_favorites');
        _httpFolders = await invoke('http_load_folders');
    } catch(e) {}
    loadHttpEnv();
})();

// 持久化 Tab 列表（只存请求状态，不存响应内容）
const REQ_TABS_KEY = 'http.req_tabs.v1';

function saveReqTabsToStorage() {
    try {
        const lightweight = _reqTabs.map(t => ({
            id: t.id, customName: t.customName || null,
            method: t.method, url: t.url, timeout: t.timeout,
            bodyType: t.bodyType, body: t.body,
            params: t.params, headers: t.headers, formdata: t.formdata,
            authType: t.authType, authBearer: t.authBearer,
            authBasicUser: t.authBasicUser, authBasicPass: t.authBasicPass,
            authApiKeyName: t.authApiKeyName, authApiKeyValue: t.authApiKeyValue,
            authApiKeyLoc: t.authApiKeyLoc,
        }));
        localStorage.setItem(REQ_TABS_KEY, JSON.stringify({ tabs: lightweight, activeId: _reqActiveTabId }));
    } catch(e) {}
}

function loadReqTabsFromStorage() {
    try {
        const raw = localStorage.getItem(REQ_TABS_KEY);
        if (!raw) return null;
        const data = JSON.parse(raw);
        if (!data.tabs || !data.tabs.length) return null;
        return data;
    } catch(e) { return null; }
}

// 初始化 Tab（优先从 localStorage 恢复）
(function initReqTabs() {
    const saved = loadReqTabsFromStorage();
    if (saved) {
        _reqTabs = saved.tabs.map(t => ({ ...createTabState(), ...t }));
        _reqActiveTabId = saved.activeId && _reqTabs.find(t => t.id === saved.activeId)
            ? saved.activeId : _reqTabs[0].id;
    } else {
        const tab = createTabState();
        _reqTabs = [tab];
        _reqActiveTabId = tab.id;
    }
    renderReqTabs();
})();

// ⌘T / Ctrl+T 新建 Tab（仅 HTTP 页面激活时）
document.addEventListener('keydown', e => {
    if ((e.metaKey || e.ctrlKey) && e.key === 't' &&
        document.getElementById('page-http-client').classList.contains('active')) {
        e.preventDefault();
        addReqTab();
    }
});

function switchHttpPanelMode(mode) {
    _httpActiveFolder = null;
    _httpPanelMode = mode;
    document.querySelectorAll('.http-panel-tab').forEach(t => {
        t.classList.toggle('active', t.dataset.mode === mode);
    });
    renderHttpPanelList();
}

// ===== 文件夹树逻辑 =====

function buildFolderTree() {
    const map = {};
    _httpFolders.forEach(f => { map[f.id] = { ...f, children: [] }; });
    const roots = [];
    Object.values(map).forEach(node => {
        if (node.parent_id && map[node.parent_id]) {
            map[node.parent_id].children.push(node);
        } else {
            roots.push(node);
        }
    });
    return roots;
}

function getFolderCount(folderId) {
    const ids = getFolderDescendants(folderId);
    return _httpFavorites.filter(e => e.folder_id && ids.includes(e.folder_id)).length;
}

function renderFolderTree(nodes, depth) {
    return nodes.map(node => {
        const hasChildren = node.children.length > 0;
        const expanded = _httpExpandedFolders.has(node.id);
        const isActive = _httpActiveFolder === node.id;
        const count = getFolderCount(node.id);
        const arrow = hasChildren
            ? '<span class="folder-tree-arrow" onclick="event.stopPropagation();toggleFolderExpand(\'' + escapeHtmlAttr(node.id) + '\')">' + (expanded ? '▼' : '▶') + '</span>'
            : '<span class="folder-tree-arrow"></span>';
        const childrenHtml = (hasChildren && expanded) ? '<div class="folder-tree-children">' + renderFolderTree(node.children, depth + 1) + '</div>' : '';
        return '<div class="folder-tree-item' + (isActive ? ' active' : '') + '" onclick="setHttpActiveFolder(\'' + escapeHtmlAttr(node.id) + '\')" style="padding-left:' + (depth * 16) + 'px">'
            + arrow
            + '<span class="folder-tree-name">📁 ' + escapeHtml(node.name) + (count > 0 ? ' <span class="folder-tree-count">(' + count + ')</span>' : '') + '</span>'
            + '<span class="folder-tree-actions">'
            + '<span class="folder-tree-action" onclick="event.stopPropagation();showRenameFolderModal(\'' + escapeHtmlAttr(node.id) + '\')" title="重命名">✎</span>'
            + '<span class="folder-tree-action" onclick="event.stopPropagation();showAddFolderModal(\'' + escapeHtmlAttr(node.id) + '\')" title="添加子文件夹">+</span>'
            + '<span class="folder-tree-action folder-tree-action-del" onclick="event.stopPropagation();showDeleteFolderModal(\'' + escapeHtmlAttr(node.id) + '\')" title="删除">✕</span>'
            + '</span>'
            + '</div>' + childrenHtml;
    }).join('');
}

function renderHttpFolders() { renderHttpPanelList(); } // 兼容旧调用

function toggleCollectionExpand(id) {
    if (_httpExpandedFolders.has(id)) _httpExpandedFolders.delete(id);
    else _httpExpandedFolders.add(id);
    renderHttpPanelList();
}

function toggleFolderExpand(id) {
    if (_httpExpandedFolders.has(id)) _httpExpandedFolders.delete(id);
    else _httpExpandedFolders.add(id);
    renderHttpFolders();
}

function setHttpActiveFolder(id) {
    _httpActiveFolder = id;
    renderHttpFolders();
    renderHttpPanelList();
}

function getFolderDescendants(folderId) {
    const ids = [folderId];
    const queue = [folderId];
    while (queue.length) {
        const pid = queue.shift();
        _httpFolders.filter(f => f.parent_id === pid).forEach(f => {
            ids.push(f.id);
            queue.push(f.id);
        });
    }
    return ids;
}

// 填充文件夹下拉选择（用于模态框）
function renderFolderSelect(selectId, selectedId, includeEmpty) {
    const sel = document.getElementById(selectId);
    if (!sel) return;
    let html = includeEmpty ? '<option value="">无（根级）</option>' : '<option value="">不归属任何文件夹</option>';
    function renderOptions(nodes, depth) {
        nodes.forEach(node => {
            const prefix = '\u00A0\u00A0'.repeat(depth) + (depth > 0 ? '└ ' : '');
            html += '<option value="' + escapeHtmlAttr(node.id) + '"' + (selectedId === node.id ? ' selected' : '') + '>' + prefix + escapeHtml(node.name) + '</option>';
            if (node.children.length) renderOptions(node.children, depth + 1);
        });
    }
    renderOptions(buildFolderTree(), 0);
    sel.innerHTML = html;
}

// ===== 收藏模态框 =====

function showAddFavoriteModal() {
    const method = document.getElementById('http-method').value;
    const url = document.getElementById('http-url').value.trim();
    if (!url) { alert('请先输入 URL'); return; }
    document.getElementById('http-favorite-name').value = method + ' ' + url;
    renderFolderSelect('http-favorite-folder', null, false);
    document.getElementById('http-favorite-modal').style.display = 'flex';
}

function closeFavoriteModal() {
    document.getElementById('http-favorite-modal').style.display = 'none';
}

function confirmAddFavorite() {
    const name = document.getElementById('http-favorite-name').value.trim();
    const folderId = document.getElementById('http-favorite-folder').value || null;
    closeFavoriteModal();
    if (!name) return;
    addHttpFavorite(name, folderId);
}

// ===== 文件夹模态框 =====

function showAddFolderModal(defaultParentId, returnTo) {
    _httpFolderModalReturnTo = returnTo || null;
    document.getElementById('http-folder-name').value = '';
    renderFolderSelect('http-folder-parent', defaultParentId || null, true);
    document.getElementById('http-folder-modal').style.display = 'flex';
}

function closeFolderModal() {
    document.getElementById('http-folder-modal').style.display = 'none';
    _httpFolderModalReturnTo = null;
}

async function confirmAddFolder() {
    const name = document.getElementById('http-folder-name').value.trim();
    const parentId = document.getElementById('http-folder-parent').value || null;
    if (!name) return;
    const folder = {
        id: Date.now().toString(36) + Math.random().toString(36).slice(2),
        name,
        parent_id: parentId,
        created_at: Math.floor(Date.now() / 1000)
    };
    _httpFolders.push(folder);
    if (parentId) _httpExpandedFolders.add(parentId);
    try { await invoke('http_save_folders', { folders: _httpFolders }); } catch(e) {}
    closeFolderModal();
    renderHttpFolders();
    // 如果是从收藏模态框新建文件夹，刷新收藏模态框的下拉
    if (_httpFolderModalReturnTo === 'favorite') {
        renderFolderSelect('http-favorite-folder', folder.id, false);
        document.getElementById('http-favorite-modal').style.display = 'flex';
    }
}

// ===== 重命名文件夹 =====

let _httpRenameFolderId = null;

function showRenameFolderModal(id) {
    const folder = _httpFolders.find(f => f.id === id);
    if (!folder) return;
    _httpRenameFolderId = id;
    document.getElementById('http-rename-name').value = folder.name;
    document.getElementById('http-rename-modal').style.display = 'flex';
}

function closeRenameFolderModal() {
    document.getElementById('http-rename-modal').style.display = 'none';
    _httpRenameFolderId = null;
}

async function confirmRenameFolder() {
    const name = document.getElementById('http-rename-name').value.trim();
    if (!name || !_httpRenameFolderId) return;
    const folder = _httpFolders.find(f => f.id === _httpRenameFolderId);
    if (folder) folder.name = name;
    try { await invoke('http_save_folders', { folders: _httpFolders }); } catch(e) {}
    closeRenameFolderModal();
    renderHttpFolders();
    renderHttpPanelList();
}

// ===== 删除文件夹 =====

let _httpDeleteFolderId = null;

function showDeleteFolderModal(id) {
    const folder = _httpFolders.find(f => f.id === id);
    if (!folder) return;
    const count = getFolderCount(id);
    _httpDeleteFolderId = id;
    document.getElementById('http-delete-msg').textContent = '确定删除文件夹「' + folder.name + '」？' + (count > 0 ? '该文件夹下有 ' + count + ' 个收藏，将改为不归属任何文件夹。' : '');
    document.getElementById('http-delete-modal').style.display = 'flex';
}

function closeDeleteFolderModal() {
    document.getElementById('http-delete-modal').style.display = 'none';
    _httpDeleteFolderId = null;
}

async function confirmDeleteFolder() {
    const id = _httpDeleteFolderId;
    if (!id) return;
    // 子文件夹的 parent_id 改为被删文件夹的 parent_id
    const folder = _httpFolders.find(f => f.id === id);
    const parentId = folder ? folder.parent_id : null;
    _httpFolders.forEach(f => { if (f.parent_id === id) f.parent_id = parentId; });
    // 删除文件夹
    _httpFolders = _httpFolders.filter(f => f.id !== id);
    // 该文件夹下的收藏改为不归属任何文件夹
    _httpFavorites.forEach(e => { if (e.folder_id === id) e.folder_id = null; });
    if (_httpActiveFolder === id) _httpActiveFolder = null;
    _httpExpandedFolders.delete(id);
    try {
        await invoke('http_save_folders', { folders: _httpFolders });
        await invoke('http_save_favorites', { entries: _httpFavorites });
    } catch(e) {}
    closeDeleteFolderModal();
    renderHttpFolders();
    renderHttpPanelList();
}

// ===== 重命名收藏 =====

let _httpRenameFavId = null;

function showRenameFavModal(id) {
    const entry = _httpFavorites.find(e => e.id === id);
    if (!entry) return;
    _httpRenameFavId = id;
    document.getElementById('http-rename-fav-name').value = entry.name || entry.request.url;
    document.getElementById('http-rename-fav-modal').style.display = 'flex';
}

function closeRenameFavModal() {
    document.getElementById('http-rename-fav-modal').style.display = 'none';
    _httpRenameFavId = null;
}

async function confirmRenameFav() {
    const name = document.getElementById('http-rename-fav-name').value.trim();
    if (!name || !_httpRenameFavId) return;
    const entry = _httpFavorites.find(e => e.id === _httpRenameFavId);
    if (entry) entry.name = name;
    try { await invoke('http_save_favorites', { entries: _httpFavorites }); } catch(e) {}
    closeRenameFavModal();
    renderHttpPanelList();
}

async function addHttpFavorite(name, folderId) {
    const method = document.getElementById('http-method').value;
    const url = document.getElementById('http-url').value.trim();
    const headers = getHeaderPairs();
    const bodyType = document.getElementById('http-body-type').value;
    let body = '';
    if (bodyType === 'form-data') {
        body = JSON.stringify(getKvPairs('http-formdata-kv'));
    } else if (bodyType !== 'none') {
        body = editors.httpBody ? editors.httpBody.getValue() : '';
    }
    const entry = {
        id: Date.now().toString(36) + Math.random().toString(36).slice(2),
        request: { method, url, headers, body_type: bodyType, body, timeout: 30 },
        response: null,
        created_at: Math.floor(Date.now() / 1000),
        name: name || (method + ' ' + url),
        folder_id: folderId || null
    };
    _httpFavorites.unshift(entry);
    try {
        await invoke('http_save_favorites', { entries: _httpFavorites });
        if (_httpPanelMode === 'collections' || _httpPanelMode === 'favorites') {
            renderHttpPanelList();
        }
    } catch(e) { alert('保存失败: ' + e); }
}

function updateHttpMethodColor() {
    const sel = document.getElementById('http-method');
    const colors = { GET:'#00d68f', POST:'#ff9f43', PUT:'#448aff', DELETE:'#ff6b6b', PATCH:'#a855f7', HEAD:'#6c5ce7', OPTIONS:'#8b8fa3' };
    sel.style.color = colors[sel.value] || '#e4e6f0';
}

function switchHttpTab(group, tabName) {
    const isReq = group === 'request';
    const tabPrefix = isReq ? 'http-request-tabs' : 'http-response-tabs';
    const contentPrefix = isReq ? 'http-tab-' : 'http-response-tab-';
    const tabs = document.getElementById(tabPrefix);
    if (tabs) {
        tabs.querySelectorAll('.http-tab').forEach(t => {
            const tName = t.textContent.trim().toLowerCase();
            t.classList.toggle('active', tName === tabName);
        });
    }
    document.querySelectorAll('[id^="' + contentPrefix + '"]').forEach(el => {
        if (el.closest('#page-http-client') || el.closest('.http-float-window')) {
            el.classList.toggle('active', el.id === contentPrefix + tabName);
        }
    });
    // refresh editors when switching to body/raw tabs
    setTimeout(() => {
        if (isReq && tabName === 'body' && editors.httpBody) editors.httpBody.refresh();
        if (!isReq && tabName === 'body' && editors.httpResponseBody) editors.httpResponseBody.refresh();
        if (!isReq && tabName === 'raw' && editors.httpResponseRaw) editors.httpResponseRaw.refresh();
    }, 10);
}

function addKvRow(containerId, key = '', value = '', checked = true) {
    const container = document.getElementById(containerId);
    const row = document.createElement('div');
    row.className = 'kv-row' + (checked ? '' : ' disabled');
    const cbHtml = containerId === 'http-params-kv'
        ? '<input type="checkbox" class="kv-check"' + (checked ? ' checked' : '') + '>'
        : '';
    row.innerHTML = cbHtml + '<input type="text" class="kv-key" placeholder="Key" autocomplete="off" value="' + escapeHtmlAttr(key) + '"><input type="text" class="kv-value" placeholder="Value" autocomplete="off" value="' + escapeHtmlAttr(value) + '"><button class="kv-remove" onclick="removeKvRow(this)">✕</button>';
    container.appendChild(row);
    if (containerId === 'http-params-kv') {
        const cb = row.querySelector('.kv-check');
        if (cb) cb.addEventListener('change', function() {
            row.classList.toggle('disabled', !this.checked);
            syncParamsToUrl();
        });
        if (key) syncParamsToUrl();
    }
}

function removeKvRow(btn) {
    const row = btn.closest('.kv-row');
    const container = row.parentElement;
    if (container.querySelectorAll('.kv-row').length > 1) {
        row.remove();
    } else {
        row.querySelectorAll('input').forEach(i => i.value = '');
    }
    if (container.id === 'http-params-kv') syncParamsToUrl();
}

function getKvPairs(containerId) {
    const pairs = {};
    document.getElementById(containerId).querySelectorAll('.kv-row').forEach(row => {
        const key = row.querySelector('.kv-key').value.trim();
        const val = row.querySelector('.kv-value').value;
        if (key) pairs[key] = val;
    });
    return pairs;
}

function setKvPairs(containerId, pairs) {
    const container = document.getElementById(containerId);
    container.innerHTML = '';
    const entries = Object.entries(pairs);
    if (entries.length === 0) {
        addKvRow(containerId);
    } else {
        entries.forEach(([k, v]) => addKvRow(containerId, k, v));
    }
}

function escapeHtmlAttr(s) {
    return String(s).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function toggleHttpBodyEditor() {
    const type = document.getElementById('http-body-type').value;
    document.getElementById('http-body-editor-wrap').style.display = (type === 'json' || type === 'raw') ? 'block' : 'none';
    document.getElementById('http-formdata-wrap').style.display = type === 'form-data' ? 'block' : 'none';
    // 自动更新 Headers 中的 Content-Type
    const ctMap = { 'json': 'application/json', 'form-data': 'multipart/form-data', 'form': 'application/x-www-form-urlencoded', 'raw': 'text/plain' };
    const newCt = ctMap[type];
    if (newCt) {
        updateKvHeader('http-headers-kv', 'Content-Type', newCt);
    }
    requestAnimationFrame(() => { requestAnimationFrame(() => { if (editors.httpBody) editors.httpBody.refresh(); }); });
}

function toggleHttpAuthPanel() {
    const type = document.getElementById('http-auth-type').value;
    ['bearer', 'basic', 'apikey'].forEach(t => {
        document.getElementById('http-auth-' + t).style.display = type === t ? 'block' : 'none';
    });
}

function getAuthHeaders() {
    const type = document.getElementById('http-auth-type').value;
    if (type === 'bearer') {
        const token = document.getElementById('http-auth-bearer-token').value.trim();
        return token ? { 'Authorization': 'Bearer ' + token } : {};
    }
    if (type === 'basic') {
        const user = document.getElementById('http-auth-basic-user').value;
        const pass = document.getElementById('http-auth-basic-pass').value;
        if (!user && !pass) return {};
        return { 'Authorization': 'Basic ' + btoa(user + ':' + pass) };
    }
    if (type === 'apikey') {
        const name = document.getElementById('http-auth-apikey-name').value.trim();
        const val = document.getElementById('http-auth-apikey-value').value.trim();
        const loc = document.getElementById('http-auth-apikey-loc').value;
        if (!name || !val || loc !== 'header') return {};
        return { [name]: val };
    }
    return {};
}

function getAuthQueryParams() {
    const type = document.getElementById('http-auth-type').value;
    if (type === 'apikey') {
        const name = document.getElementById('http-auth-apikey-name').value.trim();
        const val = document.getElementById('http-auth-apikey-value').value.trim();
        const loc = document.getElementById('http-auth-apikey-loc').value;
        if (name && val && loc === 'query') return { [name]: val };
    }
    return {};
}

function formatHttpBodyJson(action) {
    if (!editors.httpBody) return;
    const raw = editors.httpBody.getValue();
    if (!raw.trim()) return;
    try {
        const parsed = JSON.parse(raw);
        const formatted = action === 'beautify' ? JSON.stringify(parsed, null, 2) : JSON.stringify(parsed);
        editors.httpBody.setValue(formatted);
    } catch(e) {
        alert('JSON 格式错误: ' + e.message);
    }
}

// ===== cURL 导入导出 =====
function showCurlImportModal() {
    document.getElementById('http-curl-import-modal').style.display = 'flex';
    document.getElementById('http-curl-input').value = '';
    document.getElementById('http-curl-input').focus();
}

function closeCurlImportModal() {
    document.getElementById('http-curl-import-modal').style.display = 'none';
}

function importCurlCommand() {
    const input = document.getElementById('http-curl-input').value.trim();
    if (!input) {
        alert('请输入 cURL 命令');
        return;
    }
    try {
        const parsed = parseCurlCommand(input);
        // 设置 method
        document.getElementById('http-method').value = parsed.method || 'GET';
        updateHttpMethodColor();
        // 设置 URL
        document.getElementById('http-url').value = parsed.url || '';
        // 设置 headers
        setHeaderPairs(parsed.headers || {});
        // 设置 body type 和 body
        if (parsed.data) {
            // 判断是否为 JSON 类型（content-type 包含 application/json）
            const isJson = parsed.contentType && parsed.contentType.toLowerCase().includes('application/json');
            document.getElementById('http-body-type').value = isJson ? 'json' : 'raw';
            toggleHttpBodyEditor();
            if (editors.httpBody) {
                editors.httpBody.setValue(parsed.data);
                setTimeout(() => editors.httpBody.refresh(), 50);
            }
        } else {
            document.getElementById('http-body-type').value = 'none';
            toggleHttpBodyEditor();
            if (editors.httpBody) editors.httpBody.setValue('');
        }
        // 重新设置 headers（覆盖 toggleHttpBodyEditor 自动设置的 Content-Type）
        setHeaderPairs(parsed.headers || {});
        // 解析 URL params
        try {
            const u = new URL(parsed.url || '');
            const params = {};
            u.searchParams.forEach((v, k) => { params[k] = v; });
            setKvPairs('http-params-kv', params);
        } catch(e) {
            setKvPairs('http-params-kv', {});
        }
        closeCurlImportModal();
    } catch(e) {
        alert('解析 cURL 命令失败: ' + e.message);
    }
}

function parseCurlCommand(curl) {
    const result = { method: 'GET', url: '', headers: {}, data: '', contentType: '' };
    // 移除换行续行符，合并为单行
    curl = curl.replace(/\\\s*\n/g, ' ').replace(/\r?\n/g, ' ');

    // 提取 URL：在整个命令中查找 https?:// 开头的 URL
    let urlMatch = curl.match(/['"](https?:\/\/[^'"]+)['"]/);
    if (!urlMatch) urlMatch = curl.match(/(https?:\/\/[^\s'"]+)/);
    if (urlMatch) result.url = urlMatch[1];

    // 提取 method
    const methodMatch = curl.match(/-X\s+['"]?(\w+)['"]?/i) || curl.match(/--request\s+['"]?(\w+)['"]?/i);
    if (methodMatch) result.method = methodMatch[1].toUpperCase();

    // 提取 headers：支持单引号和双引号
    const headerRegex = /-H\s+'([^']+)'/g;
    let headerMatch;
    while ((headerMatch = headerRegex.exec(curl)) !== null) {
        const colonIdx = headerMatch[1].indexOf(':');
        if (colonIdx > 0) {
            const key = headerMatch[1].substring(0, colonIdx).trim();
            const value = headerMatch[1].substring(colonIdx + 1).trim();
            if (key) {
                result.headers[key] = value;
                if (key.toLowerCase() === 'content-type') result.contentType = value;
            }
        }
    }
    // 也检查双引号形式
    const headerRegex2 = /-H\s+"([^"]+)"/g;
    while ((headerMatch = headerRegex2.exec(curl)) !== null) {
        const colonIdx = headerMatch[1].indexOf(':');
        if (colonIdx > 0) {
            const key = headerMatch[1].substring(0, colonIdx).trim();
            const value = headerMatch[1].substring(colonIdx + 1).trim();
            if (key) {
                result.headers[key] = value;
                if (key.toLowerCase() === 'content-type') result.contentType = value;
            }
        }
    }

    // 提取 data：支持单引号和双引号，贪婪匹配到引号结束
    // --data-raw '...'
    let dataMatch = curl.match(/--data-raw\s+'([\s\S]*?)'(?:\s|$)/);
    if (!dataMatch) dataMatch = curl.match(/--data-raw\s+"([\s\S]*?)"(?:\s|$)/);
    // --data '...'
    if (!dataMatch) dataMatch = curl.match(/--data\s+'([\s\S]*?)'(?:\s|$)/);
    if (!dataMatch) dataMatch = curl.match(/--data\s+"([\s\S]*?)"(?:\s|$)/);
    // -d '...'
    if (!dataMatch) dataMatch = curl.match(/-d\s+'([\s\S]*?)'(?:\s|$)/);
    if (!dataMatch) dataMatch = curl.match(/-d\s+"([\s\S]*?)"(?:\s|$)/);

    if (dataMatch) {
        result.data = dataMatch[1].replace(/\\'/g, "'").replace(/\\"/g, '"');
    }

    // 如果没有 explicit method 但有 data，默认 POST
    if (!methodMatch && result.data) result.method = 'POST';
    return result;
}

function exportAsCurl() {
    const method = document.getElementById('http-method').value;
    const url = document.getElementById('http-url').value.trim();
    if (!url) {
        alert('请先输入请求 URL');
        return;
    }
    const headers = getHeaderPairs();
    const bodyType = document.getElementById('http-body-type').value;
    const body = editors.httpBody ? editors.httpBody.getValue() : '';

    let curl = `curl -X ${method} '${url}'`;
    // 添加 headers
    Object.entries(headers).forEach(([key, value]) => {
        if (key && value) {
            curl += ` \\\n  -H '${key}: ${value}'`;
        }
    });
    // 添加 body
    if (bodyType !== 'none' && body) {
        const escapedBody = body.replace(/'/g, "'\\''");
        curl += ` \\\n  -d '${escapedBody}'`;
    }

    document.getElementById('http-curl-output').value = curl;
    document.getElementById('http-curl-export-modal').style.display = 'flex';
}

function closeCurlExportModal() {
    document.getElementById('http-curl-export-modal').style.display = 'none';
}

function copyCurlOutput() {
    const curl = document.getElementById('http-curl-output').value;
    navigator.clipboard.writeText(curl).then(() => {
        alert('已复制到剪贴板');
    }).catch(() => {
        alert('复制失败');
    });
}

// ===== 大响应保护 =====
const HTTP_MAX_BODY_SIZE = 512 * 1024; // 512KB
let _httpFullResponseBody = '';

function copyHttpResponseBody() {
    const text = editors.httpResponseBody ? editors.httpResponseBody.getValue() : '';
    if (!text) return;
    navigator.clipboard.writeText(text).then(() => {
        const btn = document.getElementById('http-response-copy-btn');
        if (!btn) return;
        const orig = btn.textContent;
        btn.textContent = '✅';
        setTimeout(() => { btn.textContent = orig; }, 1200);
    }).catch(() => {});
}

function loadFullHttpResponse() {
    if (!_httpFullResponseBody) return;
    let bodyText = _httpFullResponseBody;
    try {
        const parsed = JSON.parse(_httpFullResponseBody);
        bodyText = JSON.stringify(parsed, null, 2);
    } catch(e) {}
    if (editors.httpResponseBody) editors.httpResponseBody.setValue(bodyText);
    if (editors.httpResponseRaw) editors.httpResponseRaw.setValue(_httpFullResponseBody);
    document.getElementById('http-response-size-warning').style.display = 'none';
}

// ===== HTTP 响应搜索（独立于 CodeMirror 搜索，专注大文本性能） =====
let _httpSearchState = { matches: [], matchIndex: -1, caseSensitive: false };

function openHttpResponseSearch() {
    const bar = document.getElementById('http-response-search-bar');
    bar.classList.add('active');
    const input = document.getElementById('http-response-search-input');
    input.focus();
    input.select();
}

function closeHttpResponseSearch() {
    const bar = document.getElementById('http-response-search-bar');
    bar.classList.remove('active');
    clearHttpSearchHighlights();
    _httpSearchState.matches = [];
    _httpSearchState.matchIndex = -1;
    document.getElementById('http-response-search-info').textContent = '';
    document.getElementById('http-response-search-input').value = '';
}

function filterResponseHeaders(query) {
    const q = query.trim().toLowerCase();
    document.getElementById('http-response-headers-grid').querySelectorAll('.http-header-row').forEach(row => {
        const key = (row.querySelector('.http-header-key') || {}).textContent || '';
        const val = (row.querySelector('.http-header-val') || {}).textContent || '';
        row.style.display = (!q || key.toLowerCase().includes(q) || val.toLowerCase().includes(q)) ? '' : 'none';
    });
}

function clearHttpSearchHighlights() {
    if (editors.httpResponseBody) {
        editors.httpResponseBody.getAllMarks().forEach(m => m.clear());
    }
}

function doHttpResponseSearch() {
    const cm = editors.httpResponseBody;
    if (!cm) return;
    clearHttpSearchHighlights();
    const input = document.getElementById('http-response-search-input');
    const info = document.getElementById('http-response-search-info');
    const query = input.value;
    if (!query) {
        _httpSearchState.matches = [];
        _httpSearchState.matchIndex = -1;
        info.textContent = '';
        return;
    }
    const caseOpt = document.querySelector('#http-response-search-bar [data-option="case"]');
    _httpSearchState.caseSensitive = caseOpt && caseOpt.classList.contains('active');
    _httpSearchState.matches = [];
    try {
        const flags = _httpSearchState.caseSensitive ? 'g' : 'gi';
        const regex = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), flags);
        const content = cm.getValue();
        let match;
        while ((match = regex.exec(content)) !== null) {
            _httpSearchState.matches.push({ index: match.index, length: match[0].length });
        }
    } catch(e) { info.textContent = '⚠'; return; }
    if (_httpSearchState.matches.length === 0) {
        _httpSearchState.matchIndex = -1;
        info.textContent = '0/0';
    } else {
        _httpSearchState.matchIndex = 0;
        jumpToHttpSearchMatch(0);
        updateHttpSearchInfo();
    }
}

function jumpToHttpSearchMatch(idx) {
    const cm = editors.httpResponseBody;
    if (!cm || idx < 0 || idx >= _httpSearchState.matches.length) return;
    const m = _httpSearchState.matches[idx];
    cm.scrollIntoView({ line: 0, ch: 0 }, 50);
    const pos = cm.posFromIndex(m.index);
    cm.setSelection(pos, cm.posFromIndex(m.index + m.length));
    cm.scrollIntoView(pos, 50);
    clearHttpSearchHighlights();
    const end = cm.posFromIndex(m.index + m.length);
    cm.markText(pos, end, { className: 'cm-search-highlight' });
}

function updateHttpSearchInfo() {
    const info = document.getElementById('http-response-search-info');
    if (_httpSearchState.matches.length === 0) {
        info.textContent = '0/0';
    } else {
        info.textContent = (_httpSearchState.matchIndex + 1) + '/' + _httpSearchState.matches.length;
    }
}

function httpResponseSearchNext() {
    if (_httpSearchState.matches.length === 0) return;
    _httpSearchState.matchIndex = (_httpSearchState.matchIndex + 1) % _httpSearchState.matches.length;
    jumpToHttpSearchMatch(_httpSearchState.matchIndex);
    updateHttpSearchInfo();
}

function httpResponseSearchPrev() {
    if (_httpSearchState.matches.length === 0) return;
    _httpSearchState.matchIndex = (_httpSearchState.matchIndex - 1 + _httpSearchState.matches.length) % _httpSearchState.matches.length;
    jumpToHttpSearchMatch(_httpSearchState.matchIndex);
    updateHttpSearchInfo();
}

// 绑定搜索框事件
document.getElementById('http-response-search-input').addEventListener('input', debounce(doHttpResponseSearch, 200));
document.getElementById('http-response-search-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.shiftKey ? httpResponseSearchPrev() : httpResponseSearchNext(); }
    if (e.key === 'Escape') { closeHttpResponseSearch(); if (editors.httpResponseBody) editors.httpResponseBody.focus(); }
});

function updateKvHeader(containerId, key, value) {
    const container = document.getElementById(containerId);
    let found = false;
    container.querySelectorAll('.kv-row').forEach(row => {
        if (row.querySelector('.kv-key').value.trim().toLowerCase() === key.toLowerCase()) {
            row.querySelector('.kv-value').value = value;
            found = true;
        }
    });
    if (!found) {
        addHeaderRow(key, value);
    }
}

// ===== Headers 专用 KV 编辑器（带 checkbox + datalist） =====
function addHeaderRow(key = '', value = '', checked = true) {
    const container = document.getElementById('http-headers-kv');
    const row = document.createElement('div');
    row.className = 'kv-row' + (checked ? '' : ' disabled');
    row.innerHTML = '<input type="checkbox" class="kv-check"' + (checked ? ' checked' : '') + '><input type="text" class="kv-key" placeholder="Key" autocomplete="off" list="http-header-suggestions" value="' + escapeHtmlAttr(key) + '"><input type="text" class="kv-value" placeholder="Value" autocomplete="off" value="' + escapeHtmlAttr(value) + '"><button class="kv-remove" onclick="removeKvRow(this)">✕</button>';
    container.appendChild(row);
    const cb = row.querySelector('.kv-check');
    cb.addEventListener('change', function() {
        row.classList.toggle('disabled', !this.checked);
    });
}

function getHeaderPairs() {
    const pairs = {};
    document.getElementById('http-headers-kv').querySelectorAll('.kv-row').forEach(row => {
        const cb = row.querySelector('.kv-check');
        if (cb && !cb.checked) return;
        const key = row.querySelector('.kv-key').value.trim();
        const val = row.querySelector('.kv-value').value;
        if (key) pairs[key] = val;
    });
    return pairs;
}

function setHeaderPairs(pairs) {
    const container = document.getElementById('http-headers-kv');
    container.innerHTML = '';
    const entries = Object.entries(pairs);
    if (entries.length === 0) {
        addHeaderRow();
    } else {
        entries.forEach(([k, v]) => addHeaderRow(k, v));
    }
}

function formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

async function sendHttpRequest() {
    const method = document.getElementById('http-method').value;
    const rawUrl = document.getElementById('http-url').value.trim();
    if (!rawUrl) { alert('请输入 URL'); return; }

    // 解析环境变量
    const url = resolveVars(rawUrl);
    const urlInput = document.getElementById('http-url');
    urlInput.style.borderColor = hasUnresolvedVars(url) ? 'var(--error)' : '';

    const headers = getHeaderPairs();
    // Header 值解析环境变量
    Object.keys(headers).forEach(k => { headers[k] = resolveVars(headers[k]); });
    // Auth headers 合并（Auth 优先覆盖同名手动 Header）
    Object.assign(headers, getAuthHeaders());

    const bodyType = document.getElementById('http-body-type').value;
    let body = '';
    if (bodyType === 'form-data') {
        body = JSON.stringify(getKvPairs('http-formdata-kv'));
    } else if (bodyType !== 'none') {
        body = editors.httpBody ? editors.httpBody.getValue() : '';
    }
    body = resolveVars(body);
    const params = getKvPairs('http-params-kv');
    // Auth query params 合并
    Object.assign(params, getAuthQueryParams());

    let finalUrl = url;
    if (Object.keys(params).length > 0) {
        try {
            const u = new URL(url.startsWith('http') ? url : 'http://' + url);
            Object.entries(params).forEach(([k, v]) => u.searchParams.set(k, v));
            finalUrl = u.toString();
        } catch(e) {}
    }

    document.getElementById('http-response-size-warning').style.display = 'none';
    document.getElementById('http-response-image-wrap').style.display = 'none';
    document.getElementById('http-response-body-editor').style.display = 'block';

    const btn = document.getElementById('http-send-btn');
    btn.disabled = true;
    btn.classList.add('loading');
    btn.textContent = '发送中';

    const timeout = parseInt(document.getElementById('http-timeout').value, 10) || 30;

    try {
        const r = await invoke('http_request', {
            req: { method, url: finalUrl, headers, body_type: bodyType, body, timeout }
        });

        document.getElementById('http-response-section').style.display = 'block';
        document.getElementById('http-response-placeholder').style.display = 'none';
        syncFloatTitle();

        const statusEl = document.getElementById('http-response-status');
        if (r.success) {
            const statusColor = r.status < 300 ? 'var(--success)' : r.status < 400 ? 'var(--warning)' : 'var(--error)';
            let statusHtml = '<span style="color:' + statusColor + ';font-weight:600">' + r.status + ' ' + r.status_text + '</span> <span style="color:var(--text-secondary)">| ' + r.time_ms + 'ms | ' + formatBytes(r.size_bytes) + '</span>';
            if (r.redirects && r.redirects.length > 0) {
                statusHtml += '<div class="http-redirect-chain">' + r.redirects.map(rd =>
                    '<span class="http-redirect-item"><span class="http-redirect-status">' + rd.status + ' ' + escapeHtml(rd.status_text) + '</span> → <span class="http-redirect-url">' + escapeHtml(rd.url) + '</span></span>'
                ).join('') + '</div>';
            }
            statusEl.innerHTML = statusHtml;
        } else {
            statusEl.innerHTML = '<span style="color:var(--error);font-weight:600">❌ ' + (r.error || '请求失败') + '</span> <span style="color:var(--text-secondary)">| ' + r.time_ms + 'ms</span>';
        }

        _httpFullResponseBody = r.body || '';
        const sizeWarning = document.getElementById('http-response-size-warning');
        const sizeText = document.getElementById('http-response-size-text');
        const isTruncated = r.success && !r.is_image && r.size_bytes > HTTP_MAX_BODY_SIZE;
        const imageWrap = document.getElementById('http-response-image-wrap');
        const bodyEditorEl = document.getElementById('http-response-body-editor');

        if (r.success && r.is_image) {
            // 图片响应：显示 img，隐藏代码编辑器和大小警告
            const img = document.getElementById('http-response-image');
            img.src = 'data:' + r.content_type + ';base64,' + r.body;
            document.getElementById('http-response-image-info').textContent =
                r.content_type + ' · ' + formatBytes(r.size_bytes);
            imageWrap.style.display = 'flex';
            bodyEditorEl.style.display = 'none';
            sizeWarning.style.display = 'none';
            if (editors.httpResponseRaw) editors.httpResponseRaw.setValue('[图片数据 ' + r.content_type + '，大小: ' + formatBytes(r.size_bytes) + '，Base64 编码后长度: ' + r.body.length + ']');
        } else if (r.success && r.body) {
            imageWrap.style.display = 'none';
            bodyEditorEl.style.display = 'block';
            let displayBody = r.body;
            if (isTruncated) {
                displayBody = r.body.slice(0, HTTP_MAX_BODY_SIZE) + '\n\n... [已截断，共 ' + formatBytes(r.size_bytes) + '，点击"加载完整内容"查看全部]';
                sizeWarning.style.display = 'flex';
                sizeText.textContent = '响应体较大（' + formatBytes(r.size_bytes) + '），已截断显示前 512KB';
            } else {
                sizeWarning.style.display = 'none';
            }
            let bodyText = displayBody;
            if (!isTruncated) {
                try {
                    const parsed = JSON.parse(r.body);
                    bodyText = JSON.stringify(parsed, null, 2);
                } catch(e) {}
            }
            if (editors.httpResponseBody) {
                editors.httpResponseBody.setValue(bodyText);
                try { editors.httpResponseBody.setOption('mode', 'javascript'); } catch(e) {}
            }
            if (editors.httpResponseRaw) editors.httpResponseRaw.setValue(displayBody);
        } else {
            imageWrap.style.display = 'none';
            bodyEditorEl.style.display = 'block';
            sizeWarning.style.display = 'none';
            if (editors.httpResponseBody) editors.httpResponseBody.setValue(r.body || '');
            if (editors.httpResponseRaw) editors.httpResponseRaw.setValue(r.body || '');
        }

        const headersGrid = document.getElementById('http-response-headers-grid');
        if (r.success && Object.keys(r.headers).length > 0) {
            headersGrid.innerHTML = Object.entries(r.headers).map(([k, v]) =>
                '<div class="http-header-row"><span class="http-header-key">' + escapeHtml(k) + '</span><span class="http-header-val">' + escapeHtml(v) + '</span><span class="http-header-copy" onclick="copyToClipboard(\'' + escapeHtmlAttr(v) + '\')" title="复制">📋</span></div>'
            ).join('');
        } else {
            headersGrid.innerHTML = '<div style="color:var(--text-secondary);padding:12px">无响应头</div>';
        }

        const entry = {
            id: Date.now().toString(36) + Math.random().toString(36).slice(2),
            request: { method, url: finalUrl, headers, body_type: bodyType, body, timeout },
            response: r.success ? r : null,
            created_at: Math.floor(Date.now() / 1000),
            name: null,
            folder_id: null
        };
        _httpHistory.unshift(entry);
        if (_httpHistory.length > 100) _httpHistory = _httpHistory.slice(0, 100);
        try { await invoke('http_save_history', { entries: _httpHistory }); } catch(e) {}

    } catch(e) {
        document.getElementById('http-response-section').style.display = 'block';
        document.getElementById('http-response-placeholder').style.display = 'none';
        syncFloatTitle();
        document.getElementById('http-response-status').innerHTML = '<span style="color:var(--error);font-weight:600">❌ ' + e + '</span>';
    } finally {
        btn.disabled = false;
        btn.classList.remove('loading');
        btn.textContent = '发送';
        renderReqTabs();
    }
}

function toggleHttpPanel(mode) {
    const panel = document.getElementById('http-panel');
    if (panel.style.display !== 'none' && _httpPanelMode === mode) {
        closeHttpPanel(); return;
    }
    switchHttpPanelMode(mode);
    panel.style.display = 'block';
}

function closeHttpPanel() {
    document.getElementById('http-panel').style.display = 'none';
    _httpPanelMode = '';
}

function exportHttpData() {
    if ((_httpPanelMode || 'collections') === 'history') {
        _downloadJson(
            { version: 1, type: 'http-history', data: _httpHistory },
            'http-history-' + new Date().toISOString().slice(0, 10) + '.json'
        );
    } else {
        document.getElementById('http-export-modal').style.display = 'flex';
    }
}

function closeHttpExportModal() {
    document.getElementById('http-export-modal').style.display = 'none';
}

function exportAsInternal() {
    closeHttpExportModal();
    _downloadJson(
        { version: 1, type: 'http-collections', folders: _httpFolders, data: _httpFavorites },
        'http-collections-' + new Date().toISOString().slice(0, 10) + '.json'
    );
}

function exportAsPostman() {
    closeHttpExportModal();
    _downloadJson(
        _convertToPostman(_httpFolders, _httpFavorites, 'DevToolkit Collections'),
        'postman-collection-' + new Date().toISOString().slice(0, 10) + '.json'
    );
}

function _downloadJson(obj, filename) {
    const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    a.click(); URL.revokeObjectURL(url);
}

function _convertToPostman(folders, favorites, collectionName) {
    function toPostmanUrl(raw) {
        try {
            const u = new URL(raw.startsWith('http') ? raw : 'https://' + raw);
            const query = [];
            u.searchParams.forEach((v, k) => query.push({ key: k, value: v }));
            return {
                raw,
                protocol: u.protocol.replace(':', ''),
                host: u.hostname.split('.'),
                path: u.pathname.split('/').filter(Boolean),
                query: query.length ? query : undefined,
            };
        } catch(e) { return { raw: raw || '' }; }
    }

    function toPostmanBody(bodyType, body) {
        if (!bodyType || bodyType === 'none') return undefined;
        if (bodyType === 'json') return { mode: 'raw', raw: body || '', options: { raw: { language: 'json' } } };
        if (bodyType === 'text') return { mode: 'raw', raw: body || '' };
        if (bodyType === 'form-data') {
            let fd = [];
            try { fd = JSON.parse(body || '[]'); } catch(e) {}
            return { mode: 'formdata', formdata: fd.map(f => ({ key: f.key || '', value: f.value || '', type: 'text' })) };
        }
        if (bodyType === 'urlencoded') {
            return { mode: 'urlencoded', urlencoded: (body || '').split('&').filter(Boolean).map(p => {
                const [k, ...v] = p.split('=');
                return { key: decodeURIComponent(k || ''), value: decodeURIComponent(v.join('=') || '') };
            })};
        }
        return { mode: 'raw', raw: body || '' };
    }

    function favToItem(fav) {
        const req = fav.request || {};
        return {
            name: fav.name || (req.method + ' ' + req.url),
            request: {
                method: req.method || 'GET',
                header: Object.entries(req.headers || {}).map(([key, value]) => ({ key, value })),
                url: toPostmanUrl(req.url || ''),
                body: toPostmanBody(req.body_type, req.body),
            },
        };
    }

    function buildItems(parentId) {
        const childFolders = folders.filter(f => (f.parent_id || null) === parentId);
        const childReqs = favorites.filter(e => (e.folder_id || null) === parentId);
        return [
            ...childFolders.map(f => ({ name: f.name, item: buildItems(f.id) })),
            ...childReqs.map(favToItem),
        ];
    }

    return {
        info: {
            name: collectionName || 'DevToolkit Collections',
            _postman_id: Date.now().toString(36) + Math.random().toString(36).slice(2),
            schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
        },
        item: buildItems(null),
    };
}

function importHttpData() {
    document.getElementById('http-import-file').click();
}

async function onHttpImportFile(e) {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
        const text = await file.text();
        const parsed = JSON.parse(text);
        // 自动检测格式
        if (parsed.log && Array.isArray(parsed.log.entries)) {
            await _importFromHar(parsed);
        } else if (parsed.info && parsed.info.schema && parsed.info.schema.includes('postman')) {
            await _importFromPostman(parsed);
        } else if (parsed.type === 'http-history') {
            await _importInternalHistory(parsed);
        } else {
            await _importInternalCollections(parsed);
        }
        renderHttpPanelList();
    } catch(err) { alert('导入失败：' + err.message); }
}

async function _importFromPostman(parsed) {
    const newFolders = [];
    const newFavorites = [];
    let _seq = 0;
    const _uid = () => Date.now().toString(36) + '_' + (++_seq).toString(36) + '_' + Math.random().toString(36).slice(2);

    const _now = Math.floor(Date.now() / 1000);
    // info.name 作为根集合
    const rootFolderId = _uid();
    const collectionName = (parsed.info && parsed.info.name) || 'Imported Collection';
    newFolders.push({ id: rootFolderId, name: collectionName, parent_id: null, created_at: _now });

    function parseItems(items, parentFolderId) {
        (items || []).forEach(item => {
            if (Array.isArray(item.item)) {
                // 子集合（folder）
                const fid = _uid();
                newFolders.push({ id: fid, name: item.name || 'Folder', parent_id: parentFolderId, created_at: _now });
                parseItems(item.item, fid);
            } else if (item.request) {
                const req = item.request;
                const url = typeof req.url === 'string' ? req.url : (req.url && req.url.raw) || '';
                const method = (req.method || 'GET').toUpperCase();
                const headers = {};
                (req.header || []).forEach(h => { if (h.key && !h.disabled) headers[h.key] = h.value || ''; });

                let bodyType = 'none', body = '';
                if (req.body) {
                    if (req.body.mode === 'raw') {
                        const lang = req.body.options?.raw?.language || '';
                        bodyType = lang === 'json' ? 'json' : 'text';
                        body = req.body.raw || '';
                        if (bodyType === 'text' && body.trim().startsWith('{')) bodyType = 'json';
                    } else if (req.body.mode === 'formdata') {
                        bodyType = 'form-data';
                        body = JSON.stringify((req.body.formdata || []).map(f => ({ key: f.key || '', value: f.value || '' })));
                    } else if (req.body.mode === 'urlencoded') {
                        bodyType = 'urlencoded';
                        body = (req.body.urlencoded || []).map(p => encodeURIComponent(p.key || '') + '=' + encodeURIComponent(p.value || '')).join('&');
                    }
                }
                newFavorites.push({
                    id: _uid(),
                    name: item.name || (method + ' ' + url),
                    folder_id: parentFolderId,
                    request: { method, url, headers, body_type: bodyType, body, timeout: 30 },
                    response: null,
                    created_at: Math.floor(Date.now() / 1000),
                });
            }
        });
    }

    // 从根集合开始递归解析
    parseItems(parsed.item, rootFolderId);

    _httpFolders = [..._httpFolders, ...newFolders];
    const existingIds = new Set(_httpFavorites.map(e => e.id));
    const addedFavs = newFavorites.filter(e => !existingIds.has(e.id));
    _httpFavorites = [..._httpFavorites, ...addedFavs];
    try {
        await invoke('http_save_folders', { folders: _httpFolders });
        await invoke('http_save_favorites', { entries: _httpFavorites });
    } catch(er) {}
    // 自动展开根集合
    _httpExpandedFolders.add(rootFolderId);
    alert('已从 Postman 导入集合「' + collectionName + '」：' + (newFolders.length - 1) + ' 个子集合，' + addedFavs.length + ' 个接口');
}

async function _importFromHar(parsed) {
    const entries = (parsed.log && parsed.log.entries) || [];
    const newItems = entries.map(entry => {
        const req = entry.request || {};
        const method = (req.method || 'GET').toUpperCase();
        const url = req.url || '';
        if (!url) return null;
        const headers = {};
        (req.headers || []).forEach(h => { headers[h.name] = h.value; });
        let bodyType = 'none', body = '';
        if (req.postData) {
            const mime = req.postData.mimeType || '';
            bodyType = mime.includes('json') ? 'json' : mime.includes('form') ? 'urlencoded' : 'text';
            body = req.postData.text || '';
        }
        return {
            id: Date.now().toString(36) + Math.random().toString(36).slice(2),
            request: { method, url, headers, body_type: bodyType, body, timeout: 30 },
            response: null,
            created_at: entry.startedDateTime ? Math.floor(new Date(entry.startedDateTime).getTime() / 1000) : Math.floor(Date.now() / 1000),
        };
    }).filter(Boolean);
    const existingUrls = new Set(_httpHistory.map(e => e.request?.url));
    const added = newItems.filter(e => !existingUrls.has(e.request.url));
    _httpHistory = [...added, ..._httpHistory].slice(0, 200);
    try { await invoke('http_save_history', { entries: _httpHistory }); } catch(er) {}
    alert('已从 HAR 导入 ' + added.length + ' 条记录到历史');
}

async function _importInternalHistory(parsed) {
    const entries = parsed.data || (Array.isArray(parsed) ? parsed : []);
    const existingUrls = new Set(_httpHistory.map(e => e.request?.url));
    const added = entries.filter(e => e.request && !existingUrls.has(e.request.url));
    _httpHistory = [...added, ..._httpHistory].slice(0, 200);
    try { await invoke('http_save_history', { entries: _httpHistory }); } catch(er) {}
    alert('已导入 ' + added.length + ' 条历史记录');
}

async function _importInternalCollections(parsed) {
    const now = Math.floor(Date.now() / 1000);
    const newFolders = (parsed.folders || []).map(f => ({ created_at: now, ...f }));
    const entries = parsed.data || (Array.isArray(parsed) ? parsed : []);
    const existingFolderIds = new Set(_httpFolders.map(f => f.id));
    const addedFolders = newFolders.filter(f => f.id && !existingFolderIds.has(f.id));
    _httpFolders = [..._httpFolders, ...addedFolders];
    const existingIds = new Set(_httpFavorites.map(e => e.id));
    const addedEntries = entries.filter(e => e.id && !existingIds.has(e.id));
    _httpFavorites = [..._httpFavorites, ...addedEntries];
    try {
        await invoke('http_save_folders', { folders: _httpFolders });
        await invoke('http_save_favorites', { entries: _httpFavorites });
    } catch(er) {}
    alert('已导入 ' + addedFolders.length + ' 个集合，' + addedEntries.length + ' 个接口');
}

function renderHttpPanelList() {
    if (_httpPanelMode === 'history') { renderHttpHistoryList(); }
    else { renderCollectionTree(); }
}

function renderHttpHistoryList() {
    const list = document.getElementById('http-panel-list');
    const searchQ = (document.getElementById('http-panel-search')?.value || '').toLowerCase().trim();
    const methodColors = { GET:'#00d68f', POST:'#ff9f43', PUT:'#448aff', DELETE:'#ff6b6b', PATCH:'#a855f7', HEAD:'#6c5ce7', OPTIONS:'#8b8fa3' };
    const clearBtn = '<div class="http-history-toolbar"><button class="btn btn-ghost btn-sm" onclick="clearHttpHistory()">🗑 清空历史</button></div>';
    let itemsHtml = '';
    _httpHistory.forEach((entry, i) => {
        const urlStr = (entry.request.url || '').toLowerCase();
        if (searchQ && !urlStr.includes(searchQ)) return;
        const color = methodColors[entry.request.method] || '#e4e6f0';
        const time = entry.created_at ? new Date(entry.created_at * 1000).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '';
        itemsHtml += '<div class="http-history-item" onclick="loadHttpEntry(_httpHistory[' + i + '])">' +
            '<span class="http-history-method" style="color:' + color + '">' + entry.request.method + '</span>' +
            '<span class="http-history-info"><span class="http-history-name">' + escapeHtml(entry.request.url) + '</span></span>' +
            '<span class="http-history-time">' + time + '</span>' +
            '<button class="kv-remove" onclick="event.stopPropagation();removeHttpEntry(' + i + ')">✕</button>' +
            '</div>';
    });
    if (!itemsHtml) {
        itemsHtml = '<div style="color:var(--text-secondary);padding:20px;text-align:center">' + (searchQ ? '无匹配记录' : '暂无历史记录') + '</div>';
    }
    list.innerHTML = clearBtn + itemsHtml;
}

function renderCollectionTree() {
    const list = document.getElementById('http-panel-list');
    const searchQ = (document.getElementById('http-panel-search')?.value || '').toLowerCase().trim();
    const methodColors = { GET:'#00d68f', POST:'#ff9f43', PUT:'#448aff', DELETE:'#ff6b6b', PATCH:'#a855f7', HEAD:'#6c5ce7', OPTIONS:'#8b8fa3' };

    function matchEntry(e) {
        return !searchQ ||
            (e.name || '').toLowerCase().includes(searchQ) ||
            (e.request.url || '').toLowerCase().includes(searchQ);
    }

    // 递归统计某集合（含所有子集合）下匹配的请求数
    function countDeep(node) {
        const ids = getFolderDescendants(node.id);
        return _httpFavorites.filter(e => ids.includes(e.folder_id) && matchEntry(e)).length;
    }

    // 递归判断某节点是否有任何可见内容（用于搜索剪枝）
    function hasVisible(node) {
        if (countDeep(node) > 0) return true;
        if (!searchQ) return true; // 不搜索时始终显示
        return false;
    }

    function renderReqItem(entry, depth) {
        const color = methodColors[entry.request.method] || '#e4e6f0';
        const hasCustomName = entry.name && entry.name !== entry.request.url;
        const displayName = hasCustomName ? entry.name : entry.request.url;
        const eid = escapeHtmlAttr(entry.id);
        const leftPad = 24 + depth * 16;
        return '<div class="http-coll-req-item" style="padding-left:' + leftPad + 'px" onclick="loadHttpFavById(\'' + eid + '\')">' +
            '<span class="http-history-method" style="color:' + color + ';min-width:46px">' + entry.request.method + '</span>' +
            '<span class="http-history-info">' +
                '<span class="http-history-name">' + escapeHtml(displayName) + '</span>' +
                (hasCustomName ? '<div class="http-panel-item-url">' + escapeHtml(entry.request.url) + '</div>' : '') +
            '</span>' +
            '<span class="http-coll-req-actions">' +
                '<span class="http-coll-action" onclick="event.stopPropagation();showRenameFavModal(\'' + eid + '\')" title="重命名">✎</span>' +
                '<span class="http-coll-action http-coll-action-del" onclick="event.stopPropagation();removeHttpFavById(\'' + eid + '\')" title="删除">✕</span>' +
            '</span>' +
            '</div>';
    }

    // 递归渲染集合节点（node 来自 buildFolderTree）
    function renderNode(node, depth) {
        if (!hasVisible(node)) return '';
        const expanded = _httpExpandedFolders.has(node.id);
        const cid = escapeHtmlAttr(node.id);
        const totalCount = countDeep(node);
        const headerPad = 12 + depth * 16;

        const addReqBtn = '<button class="http-coll-add-req" onclick="event.stopPropagation();addCurrentToCollection(\'' + cid + '\')" title="添加当前请求">+</button>';
        const addSubBtn = '<span class="http-coll-action" onclick="event.stopPropagation();showAddFolderModal(\'' + cid + '\')" title="新建子集合">⊕</span>';
        const editBtns =
            '<span class="http-coll-action" onclick="event.stopPropagation();showRenameFolderModal(\'' + cid + '\')" title="重命名">✎</span>' +
            '<span class="http-coll-action http-coll-action-del" onclick="event.stopPropagation();showDeleteFolderModal(\'' + cid + '\')" title="删除">✕</span>';

        const header =
            '<div class="http-coll-header" style="padding-left:' + headerPad + 'px" onclick="toggleCollectionExpand(\'' + cid + '\')">' +
                '<span class="http-coll-arrow">' + (expanded ? '▼' : '▶') + '</span>' +
                '<span class="http-coll-name">' + escapeHtml(node.name) + '</span>' +
                (totalCount > 0 ? '<span class="http-coll-count">' + totalCount + '</span>' : '') +
                '<span class="http-coll-actions">' + addReqBtn + addSubBtn + editBtns + '</span>' +
            '</div>';

        if (!expanded) return '<div class="http-coll-section">' + header + '</div>';

        // 展开内容：先子集合，再本层直属请求
        let bodyHtml = '';
        if (node.children && node.children.length > 0) {
            node.children.forEach(child => { bodyHtml += renderNode(child, depth + 1); });
        }
        const directReqs = _httpFavorites.filter(e => e.folder_id === node.id && matchEntry(e));
        if (directReqs.length > 0) {
            bodyHtml += directReqs.map(e => renderReqItem(e, depth)).join('');
        }
        if (!bodyHtml) {
            bodyHtml = '<div class="http-coll-empty-req" style="padding-left:' + (28 + depth * 16) + 'px">暂无接口，点击 + 添加</div>';
        }

        return '<div class="http-coll-section">' + header + '<div class="http-coll-requests">' + bodyHtml + '</div></div>';
    }

    const tree = buildFolderTree();
    let html = '';
    tree.forEach(node => { html += renderNode(node, 0); });

    // 未分类（没有 folder_id 的请求）
    const uncategorized = _httpFavorites.filter(e => !e.folder_id && matchEntry(e));
    if (uncategorized.length > 0) {
        const uncatExp = _httpExpandedFolders.has('__uncategorized__');
        const clearUncatBtn = '<span class="http-coll-action http-coll-action-del" onclick="event.stopPropagation();clearUncategorized()" title="清空未分类">🗑</span>';
        html +=
            '<div class="http-coll-section">' +
                '<div class="http-coll-header" onclick="toggleCollectionExpand(\'__uncategorized__\')">' +
                    '<span class="http-coll-arrow">' + (uncatExp ? '▼' : '▶') + '</span>' +
                    '<span class="http-coll-name" style="color:var(--text-secondary);font-style:italic">未分类</span>' +
                    '<span class="http-coll-count">' + uncategorized.length + '</span>' +
                    '<span class="http-coll-actions">' + clearUncatBtn + '</span>' +
                '</div>' +
                (uncatExp ? '<div class="http-coll-requests">' + uncategorized.map(e => renderReqItem(e, 0)).join('') + '</div>' : '') +
            '</div>';
    }

    if (!html && !uncategorized.length) {
        html = '<div class="http-coll-empty">' + (searchQ ? '无匹配结果' : '暂无集合<br><small>创建集合来整理接口</small>') + '</div>';
    }
    html += '<div class="http-coll-add-section" onclick="showAddFolderModal(null)">+ 新建集合</div>';
    list.innerHTML = html;
}

function loadHttpFavById(id) {
    const entry = _httpFavorites.find(e => e.id === id);
    if (entry) loadHttpEntry(entry);
}

async function removeHttpFavById(id) {
    const idx = _httpFavorites.findIndex(e => e.id === id);
    if (idx < 0) return;
    _httpFavorites.splice(idx, 1);
    try { await invoke('http_save_favorites', { entries: _httpFavorites }); } catch(e) {}
    renderHttpPanelList();
}

function clearUncategorized() {
    const count = _httpFavorites.filter(e => !e.folder_id).length;
    if (!count) return;
    showHttpConfirm('确定删除全部 ' + count + ' 个未分类接口？', async () => {
        _httpFavorites = _httpFavorites.filter(e => e.folder_id);
        try { await invoke('http_save_favorites', { entries: _httpFavorites }); } catch(e) {}
        renderHttpPanelList();
    });
}

async function addCurrentToCollection(folderId) {
    const url = document.getElementById('http-url').value.trim();
    if (!url) { alert('请先输入请求 URL'); return; }
    const method = document.getElementById('http-method').value;
    await addHttpFavorite(method + ' ' + url, folderId);
    _httpExpandedFolders.add(folderId);
    renderHttpPanelList();
}

function loadHttpEntry(entry) {
    _httpParamsSyncing = true;
    try {
        document.getElementById('http-method').value = entry.request.method;
        updateHttpMethodColor();
        document.getElementById('http-url').value = entry.request.url;
        setHeaderPairs(entry.request.headers || {});
        document.getElementById('http-body-type').value = entry.request.body_type || 'none';
        toggleHttpBodyEditor();
        const bt = entry.request.body_type || 'none';
        if (bt === 'form-data') {
            try {
                const pairs = JSON.parse(entry.request.body || '{}');
                setKvPairs('http-formdata-kv', pairs);
            } catch(e) {
                setKvPairs('http-formdata-kv', {});
            }
            if (editors.httpBody) editors.httpBody.setValue('');
        } else {
            if (editors.httpBody) editors.httpBody.setValue(entry.request.body || '');
            setKvPairs('http-formdata-kv', {});
        }
        try {
            const u = new URL(entry.request.url);
            const params = {};
            u.searchParams.forEach((v, k) => { params[k] = v; });
            setKvPairs('http-params-kv', params);
        } catch(e) {
            setKvPairs('http-params-kv', {});
        }
        // 如果有 body 内容，自动切换到 Body tab
        const bt2 = entry.request.body_type || 'none';
        if (bt2 !== 'none' && entry.request.body) {
            switchHttpTab('request', 'body');
        }
    } finally { _httpParamsSyncing = false; }
    // 收藏有自定义名称时同步到当前 tab
    const activeTab = _reqTabs.find(t => t.id === _reqActiveTabId);
    if (activeTab) {
        activeTab.customName = (entry.name && entry.name !== entry.request.url) ? entry.name : '';
        renderReqTabs();
        saveReqTabsToStorage();
    }
    closeHttpPanel();
}

async function removeHttpEntry(index) {
    if (_httpPanelMode === 'history') {
        _httpHistory.splice(index, 1);
        try { await invoke('http_save_history', { entries: _httpHistory }); } catch(e) {}
    } else {
        _httpFavorites.splice(index, 1);
        try { await invoke('http_save_favorites', { entries: _httpFavorites }); } catch(e) {}
    }
    renderHttpPanelList();
}

let _httpConfirmAction = null;

function showHttpConfirm(msg, action) {
    document.getElementById('http-confirm-msg').textContent = msg;
    _httpConfirmAction = action;
    document.getElementById('http-confirm-modal').style.display = 'flex';
}

function closeHttpConfirm() {
    document.getElementById('http-confirm-modal').style.display = 'none';
    _httpConfirmAction = null;
}

async function confirmHttpAction() {
    const action = _httpConfirmAction;
    closeHttpConfirm();
    if (action) await action();
}

async function clearHttpHistory() {
    showHttpConfirm('确定清空所有历史记录？', async () => {
        _httpHistory = [];
        try { await invoke('http_save_history', { entries: [] }); } catch(e) {}
        renderHttpPanelList();
    });
}

async function clearHttpFavorites() {
    showHttpConfirm('确定清空所有集合和接口？', async () => {
        _httpFavorites = [];
        _httpFolders = [];
        try {
            await invoke('http_save_favorites', { entries: [] });
            await invoke('http_save_folders', { folders: [] });
        } catch(e) {}
        renderHttpPanelList();
    });
}

