// ===== 全局阻止 Tauri 默认拖放导航（但允许自定义 drop 处理） =====
document.addEventListener('dragover', (e) => {
    // 阻止 Tauri 默认行为（打开文件），但允许事件继续传播
    e.preventDefault();
}, false);
document.addEventListener('drop', (e) => {
    // 如果不是我们的自定义拖放区域，阻止默认行为
    const target = e.target.closest('#image-upload-area, #qr-upload-area');
    if (!target) {
        e.preventDefault();
    }
}, false);

// ===== Navigation =====
document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', () => {
        document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
        document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
        item.classList.add('active');
        const page = document.getElementById('page-' + item.dataset.page);
        if (page) page.classList.add('active');
        setTimeout(() => {
            Object.values(editors).forEach(cm => cm && cm.refresh());
            updateHttpLayoutHeight();
        }, 10);
    });
});

// ===== Tauri API =====
const { invoke } = window.__TAURI__.core;

// ===== Debounce =====
function debounce(fn, ms = 300) {
    let timer;
    return function (...args) {
        clearTimeout(timer);
        timer = setTimeout(() => fn.apply(this, args), ms);
    };
}

// ===== Sidebar Toggle =====
function toggleSidebar() {
    const sidebar = document.getElementById('sidebar');
    const toggle = document.getElementById('sidebar-toggle');
    sidebar.classList.toggle('collapsed');
    if (sidebar.classList.contains('collapsed')) {
        toggle.style.display = 'block';
    } else {
        toggle.style.display = 'none';
    }
    // Refresh editors after layout change
    setTimeout(() => {
        Object.values(editors).forEach(cm => cm && cm.refresh());
    }, 300);
}

// ===== CodeMirror Helper =====
const CM_INPUT_OPTS = {
    theme: 'dracula',
    lineNumbers: true,
    lineWrapping: true,
    matchBrackets: true,
    autoCloseBrackets: true,
    styleActiveLine: true,
    tabSize: 2,
    indentWithTabs: false,
    viewportMargin: 50,
    foldGutter: true,
    gutters: ['CodeMirror-linenumbers', 'CodeMirror-foldgutter'],
    highlightSelectionMatches: { annotateScrollbar: true, showToken: /\w/, style: 'cm-search-highlight' },
};

const CM_OUTPUT_OPTS = {
    ...CM_INPUT_OPTS,
    readOnly: true,
    cursorBlinkRate: -1,
};

const CM_PLAIN_OPTS = {
    ...CM_INPUT_OPTS,
    mode: null,
    matchBrackets: false,
    autoCloseBrackets: false,
};

const CM_PLAIN_OUTPUT_OPTS = {
    ...CM_OUTPUT_OPTS,
    mode: null,
    matchBrackets: false,
    autoCloseBrackets: false,
};

function makeEditor(id, opts) {
    const el = document.getElementById(id);
    if (!el) return null;
    // Set initial height from data attribute
    const defaultH = el.dataset.defaultH;
    if (defaultH) el.style.height = defaultH + 'px';
    return CodeMirror(el, { ...opts, value: '' });
}

function makeInputEditor(id, mode) {
    return makeEditor(id, { ...CM_INPUT_OPTS, mode: mode || 'javascript' });
}

function makeOutputEditor(id, mode) {
    const cm = makeEditor(id, { ...CM_OUTPUT_OPTS, mode: mode || 'javascript' });
    if (!cm) return null;
    const wrapper = cm.getWrapperElement();
    wrapper.parentElement.classList.add('code-editor-readonly');
    return cm;
}

function makePlainInputEditor(id) {
    return makeEditor(id, CM_PLAIN_OPTS);
}

function makePlainOutputEditor(id) {
    const cm = makeEditor(id, CM_PLAIN_OUTPUT_OPTS);
    if (!cm) return null;
    const wrapper = cm.getWrapperElement();
    wrapper.parentElement.classList.add('code-editor-readonly');
    return cm;
}

// HTTP 编辑器：带行号 + 折叠功能
const CM_HTTP_OPTS = {
    ...CM_PLAIN_OPTS,
    lineNumbers: true,
    foldGutter: true,
    gutters: ['CodeMirror-linenumbers', 'CodeMirror-foldgutter'],
    highlightSelectionMatches: false,
    styleActiveLine: false,
    viewportMargin: Infinity,
};

const CM_HTTP_OUTPUT_OPTS = {
    ...CM_HTTP_OPTS,
    readOnly: true,
    cursorBlinkRate: -1,
};

function makeHttpInputEditor(id) { return makeEditor(id, CM_HTTP_OPTS); }

function makeHttpOutputEditor(id) {
    const cm = makeEditor(id, CM_HTTP_OUTPUT_OPTS);
    if (!cm) return null;
    cm.getWrapperElement().parentElement.classList.add('code-editor-readonly');
    return cm;
}

// 轻量级编辑器：用于 base64 等大文本场景，关闭高亮和行号提升性能
const CM_LIGHT_OPTS = {
    ...CM_PLAIN_OPTS,
    lineNumbers: false,
    foldGutter: false,
    gutters: [],
    highlightSelectionMatches: false,
    styleActiveLine: false,
    matchBrackets: false,
    viewportMargin: 10,
};

const CM_LIGHT_OUTPUT_OPTS = {
    ...CM_LIGHT_OPTS,
    readOnly: true,
    cursorBlinkRate: -1,
};

function makeLightInputEditor(id) {
    return makeEditor(id, CM_LIGHT_OPTS);
}

function makeLightOutputEditor(id) {
    const cm = makeEditor(id, CM_LIGHT_OUTPUT_OPTS);
    if (!cm) return null;
    const wrapper = cm.getWrapperElement();
    wrapper.parentElement.classList.add('code-editor-readonly');
    return cm;
}

// ===== Persistent Search Bar =====
// Each editor wrapper gets a search bar. Ctrl/Cmd+F opens it.
let searchState = {}; // keyed by editor key

function createSearchBar(editorKey) {
    const cm = editors[editorKey];
    if (!cm) return;
    const container = cm.getWrapperElement().parentElement;

    // Create search bar element
    const bar = document.createElement('div');
    bar.className = 'search-bar hidden';
    bar.id = 'search-' + editorKey;
    bar.innerHTML = `
        <input type="text" placeholder="搜索..." class="search-input">
        <span class="search-info"></span>
        <button class="search-btn" data-action="prev" title="上一个 (Shift+Enter)">▲</button>
        <button class="search-btn" data-action="next" title="下一个 (Enter)">▼</button>
        <span class="search-option" data-option="case" title="区分大小写">Aa</span>
        <span class="search-option" data-option="regex" title="正则表达式">.*</span>
        <button class="search-close" title="关闭 (Esc)">✕</button>
    `;

    // Insert before the editor container
    container.parentElement.insertBefore(bar, container);

    const input = bar.querySelector('.search-input');
    const info = bar.querySelector('.search-info');
    const prevBtn = bar.querySelector('[data-action="prev"]');
    const nextBtn = bar.querySelector('[data-action="next"]');
    const closeBtn = bar.querySelector('.search-close');
    const caseOpt = bar.querySelector('[data-option="case"]');
    const regexOpt = bar.querySelector('[data-option="regex"]');

    searchState[editorKey] = {
        bar, input, info, cm,
        cursor: null,
        caseSensitive: false,
        useRegex: false,
        matches: [],
        matchIndex: -1,
    };

    // Input handler with debounce
    input.addEventListener('input', debounce(() => doSearch(editorKey), 150));
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            if (e.shiftKey) searchPrev(editorKey);
            else searchNext(editorKey);
        }
        if (e.key === 'Escape') {
            closeSearch(editorKey);
            cm.focus();
        }
    });

    prevBtn.addEventListener('click', () => searchPrev(editorKey));
    nextBtn.addEventListener('click', () => searchNext(editorKey));
    closeBtn.addEventListener('click', () => { closeSearch(editorKey); cm.focus(); });

    caseOpt.addEventListener('click', () => {
        const st = searchState[editorKey];
        st.caseSensitive = !st.caseSensitive;
        caseOpt.classList.toggle('active', st.caseSensitive);
        doSearch(editorKey);
    });

    regexOpt.addEventListener('click', () => {
        const st = searchState[editorKey];
        st.useRegex = !st.useRegex;
        regexOpt.classList.toggle('active', st.useRegex);
        doSearch(editorKey);
    });
}

function openSearch(editorKey) {
    const st = searchState[editorKey];
    if (!st) return;
    st.bar.classList.remove('hidden');
    st.input.focus();
    st.input.select();
    // If there's selected text, pre-fill
    const sel = st.cm.getSelection();
    if (sel && sel.length < 200 && sel.indexOf('\n') === -1) {
        st.input.value = sel;
        doSearch(editorKey);
    }
}

function closeSearch(editorKey) {
    const st = searchState[editorKey];
    if (!st) return;
    st.bar.classList.add('hidden');
    // Clear highlights
    st.cm.getAllMarks().forEach(m => m.clear());
    st.matches = [];
    st.matchIndex = -1;
    st.info.textContent = '';
}

function doSearch(editorKey) {
    const st = searchState[editorKey];
    if (!st) return;
    const query = st.input.value;
    if (!query) {
        st.cm.getAllMarks().forEach(m => m.clear());
        st.matches = [];
        st.matchIndex = -1;
        st.info.textContent = '';
        return;
    }

    // Clear previous marks
    st.cm.getAllMarks().forEach(m => m.clear());
    st.matches = [];

    let searchQuery;
    try {
        if (st.useRegex) {
            searchQuery = new RegExp(query, st.caseSensitive ? '' : 'i');
        } else {
            // Escape regex special chars for literal search
            const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            searchQuery = new RegExp(escaped, st.caseSensitive ? '' : 'i');
        }
    } catch(e) {
        st.info.textContent = '⚠ 无效';
        return;
    }

    const cursor = st.cm.getSearchCursor(searchQuery);
    while (cursor.findNext()) {
        st.matches.push({ from: { ...cursor.from() }, to: { ...cursor.to() } });
        st.cm.markText(cursor.from(), cursor.to(), { className: 'cm-search-highlight' });
    }

    if (st.matches.length === 0) {
        st.info.textContent = '0/0';
        st.matchIndex = -1;
    } else {
        st.matchIndex = 0;
        // Jump to first match
        st.cm.setSelection(st.matches[0].from, st.matches[0].to);
        st.cm.scrollIntoView(st.matches[0].from, 50);
        updateSearchInfo(editorKey);
    }
}

function searchNext(editorKey) {
    const st = searchState[editorKey];
    if (!st || st.matches.length === 0) return;
    st.matchIndex = (st.matchIndex + 1) % st.matches.length;
    const m = st.matches[st.matchIndex];
    st.cm.setSelection(m.from, m.to);
    st.cm.scrollIntoView(m.from, 50);
    updateSearchInfo(editorKey);
}

function searchPrev(editorKey) {
    const st = searchState[editorKey];
    if (!st || st.matches.length === 0) return;
    st.matchIndex = (st.matchIndex - 1 + st.matches.length) % st.matches.length;
    const m = st.matches[st.matchIndex];
    st.cm.setSelection(m.from, m.to);
    st.cm.scrollIntoView(m.from, 50);
    updateSearchInfo(editorKey);
}

function updateSearchInfo(editorKey) {
    const st = searchState[editorKey];
    if (!st) return;
    if (st.matches.length === 0) {
        st.info.textContent = '0/0';
    } else {
        st.info.textContent = `${st.matchIndex + 1}/${st.matches.length}`;
    }
}

// Intercept Ctrl/Cmd+F globally — use last-focused editor
let _searchBarFocused = false;
document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        e.preventDefault();
        e.stopPropagation();
        // If a search input is already focused, don't re-open (let user type normally)
        if (_searchBarFocused) return;
        // Use last-focused editor, fall back to first visible in active page
        let targetKey = lastFocusedEditorKey;
        if (!targetKey || !searchState[targetKey]) {
            const activePage = document.querySelector('.page.active');
            if (!activePage) return;
            const cmEl = activePage.querySelector('.CodeMirror');
            if (!cmEl || !cmEl.CodeMirror) return;
            const cm = cmEl.CodeMirror;
            for (const [key, ed] of Object.entries(editors)) {
                if (ed === cm) { targetKey = key; break; }
            }
        }
        if (targetKey) openSearch(targetKey);
    }
}, true);

// Track when search input is focused (to prevent Ctrl+F from re-opening)
document.addEventListener('focusin', (e) => {
    _searchBarFocused = e.target.classList && e.target.classList.contains('search-input');
});
document.addEventListener('focusout', (e) => {
    if (e.target.classList && e.target.classList.contains('search-input')) {
        setTimeout(() => { _searchBarFocused = false; }, 100);
    }
});

// ===== Last-focused editor tracking =====
let lastFocusedEditorKey = null;

// ===== Initialize all editors =====
const editors = {};

function initEditors() {
    // JSON
    editors.jsonInput = makeInputEditor('json-input-editor', 'javascript');
    editors.jsonOutput = makeOutputEditor('json-output-editor', 'javascript');

    // Diff
    editors.diffLeft = makePlainInputEditor('diff-left-editor');
    editors.diffRight = makePlainInputEditor('diff-right-editor');

    // Regex
    editors.regexInput = makePlainInputEditor('regex-input-editor');

    // Text stats
    editors.textStatsInput = makePlainInputEditor('text-stats-editor');
    if (editors.textStatsInput) editors.textStatsInput.on('change', debounce(() => calcTextStats(), 400));

    // Base64
    editors.base64Input = makeLightInputEditor('base64-input-editor');
    editors.base64Output = makeLightOutputEditor('base64-output-editor');

    // URL codec
    editors.urlCodecInput = makePlainInputEditor('url-codec-input-editor');
    editors.urlCodecOutput = makePlainOutputEditor('url-codec-output-editor');

    // Unicode
    editors.unicodeInput = makePlainInputEditor('unicode-input-editor');
    editors.unicodeOutput = makePlainOutputEditor('unicode-output-editor');

    // HTML codec
    editors.htmlCodecInput = makePlainInputEditor('html-codec-input-editor');
    editors.htmlCodecOutput = makePlainOutputEditor('html-codec-output-editor');

    // Hash
    editors.hashInput = makePlainInputEditor('hash-input-editor');

    // HMAC
    editors.hmacInput = makePlainInputEditor('hmac-input-editor');
    editors.hmacOutput = makePlainOutputEditor('hmac-output-editor');

    // AES
    editors.aesInput = makePlainInputEditor('aes-input-editor');
    editors.aesOutput = makePlainOutputEditor('aes-output-editor');

    // JWT
    editors.jwtInput = makePlainInputEditor('jwt-input-editor');

    // YAML/JSON
    editors.yamlJsonInput = makePlainInputEditor('yaml-json-input-editor');
    editors.yamlJsonOutput = makeOutputEditor('yaml-json-output-editor', 'javascript');

    // XML
    editors.xmlInput = makePlainInputEditor('xml-input-editor');
    editors.xmlOutput = makePlainOutputEditor('xml-output-editor');

    // Lorem Ipsum
    editors.loremOutput = makePlainOutputEditor('lorem-output-editor');

    // Text Deduplicate
    editors.textDedupInput = makePlainInputEditor('text-dedup-input-editor');
    editors.textDedupOutput = makePlainOutputEditor('text-dedup-output-editor');

    // Text Sort
    editors.textSortInput = makePlainInputEditor('text-sort-input-editor');
    editors.textSortOutput = makePlainOutputEditor('text-sort-output-editor');

    // Text Trim
    editors.textTrimInput = makePlainInputEditor('text-trim-input-editor');
    editors.textTrimOutput = makePlainOutputEditor('text-trim-output-editor');

    // Translate
    editors.translateInput = makePlainInputEditor('translate-input-editor');
    editors.translateOutput = makePlainOutputEditor('translate-output-editor');

    // Image Base64
    editors.imageBase64Output = makeLightOutputEditor('image-base64-output');
    editors.b64ToImgInput = makeLightInputEditor('b64-to-img-input-editor');

    // QR Code
    editors.qrInput = makeLightInputEditor('qr-input-editor');
    editors.qrDecodeOutput = makeLightOutputEditor('qr-decode-output-editor');

    // HTTP Client
    editors.httpBody = makeHttpInputEditor('http-body-editor');
    editors.httpResponseBody = makeHttpOutputEditor('http-response-body-editor');
    editors.httpResponseRaw = makeHttpOutputEditor('http-response-raw-editor');

    // Screenshot uses Canvas API, not CodeMirror editors

    // Create search bars for all editors & track focus
    for (const [key, cm] of Object.entries(editors)) {
        if (!cm) continue;  // skip null editors
        createSearchBar(key);
        // Track which editor was last focused
        cm.on('focus', () => { lastFocusedEditorKey = key; });
    }

    // Initialize drag-to-resize handles
    document.querySelectorAll('.code-editor.resizable').forEach(el => {
        initResizeHandle(el);
    });
}

initEditors();
updateShortcutHint();

// ===== Clipboard =====
function copyToClipboard(text) {
    navigator.clipboard.writeText(text).catch(() => {});
}

function copyEditorContent(editorKey) {
    const cm = editors[editorKey];
    if (cm) copyToClipboard(cm.getValue());
}

function copyJsonOutput() {
    copyEditorContent('jsonOutput');
}

function showStatus(containerId, msg, type) {
    const el = document.getElementById(containerId);
    if (!el) return;
    el.textContent = msg;
    el.className = 'status-msg ' + (type === 'error' ? 'status-error' : 'status-success');
    el.style.display = 'block';
    clearTimeout(el._hideTimer);
    el._hideTimer = setTimeout(() => { el.style.display = 'none'; }, 3000);
}

// ===== 时间戳转换 =====
let _lastClockSecond = -1;
function startClock() {
    const update = () => {
        const now = new Date();
        const sec = now.getSeconds();
        if (sec !== _lastClockSecond) {
            _lastClockSecond = sec;
            const hh = String(now.getHours()).padStart(2, '0');
            const mm = String(now.getMinutes()).padStart(2, '0');
            const ss = String(sec).padStart(2, '0');
            document.getElementById('current-time').textContent = `${hh}:${mm}:${ss}`;
        }
        const ts = Math.floor(Date.now() / 1000);
        document.getElementById('current-ts').textContent = ts;
        document.getElementById('current-ts-ms').textContent = Date.now();
        if (sec % 10 === 0) {
            document.getElementById('current-iso').textContent = now.toISOString();
        }
    };
    update();
    setInterval(update, 1000);
}
startClock();

async function convertTimestamp() {
    const input = document.getElementById('ts-input').value.trim();
    const unit = document.getElementById('ts-unit').value;
    if (!input) return;
    try {
        const r = await invoke('timestamp_to_date', { timestamp: parseInt(input), unit });
        const el = document.getElementById('ts-result');
        el.style.display = 'block';
        el.innerHTML = `
            <div><span class="label">UTC:</span><span class="value">${r.utc}</span></div>
            <div><span class="label">本地:</span><span class="value">${r.local}</span></div>
            <div><span class="label">ISO 8601:</span><span class="value">${r.iso8601}</span></div>
            <div><span class="label">相对:</span><span class="value">${r.relative}</span></div>
            <div><span class="label">秒:</span><span class="value">${r.timestamp}</span></div>
            <div><span class="label">毫秒:</span><span class="value">${r.timestamp_ms}</span></div>
        `;
    } catch(e) {
        document.getElementById('ts-result').style.display = 'block';
        document.getElementById('ts-result').innerHTML = `<div style="color:var(--error)">❌ ${e}</div>`;
    }
}

async function convertDate() {
    const input = document.getElementById('date-input').value.trim();
    if (!input) return;
    try {
        const r = await invoke('date_to_timestamp', { dateStr: input, formatStr: '' });
        const el = document.getElementById('date-result');
        el.style.display = 'block';
        el.innerHTML = `
            <div><span class="label">时间戳(秒):</span><span class="value">${r.timestamp}</span></div>
            <div><span class="label">时间戳(毫秒):</span><span class="value">${r.timestamp_ms}</span></div>
            <div><span class="label">UTC:</span><span class="value">${r.utc}</span></div>
            <div><span class="label">本地:</span><span class="value">${r.local}</span></div>
        `;
    } catch(e) {
        document.getElementById('date-result').style.display = 'block';
        document.getElementById('date-result').innerHTML = `<div style="color:var(--error)">❌ ${e}</div>`;
    }
}

// ===== JSON 工具 =====
async function jsonFormat(indent) {
    const input = editors.jsonInput.getValue();
    if (!input.trim()) return;
    try {
        const r = await invoke('json_format', { input, indent });
        editors.jsonOutput.setValue(r.result);
        editors.jsonOutput.scrollTo(0, 0);
        showStatus('json-status', r.success ? '✓ 格式化成功' : '✗ ' + (r.error || ''), r.success ? 'success' : 'error');
    } catch(e) { showStatus('json-status', '✗ ' + e, 'error'); }
}

async function jsonMinify() {
    const input = editors.jsonInput.getValue();
    if (!input.trim()) return;
    try {
        const r = await invoke('json_minify', { input });
        editors.jsonOutput.setValue(r.result);
        editors.jsonOutput.scrollTo(0, 0);
        showStatus('json-status', r.success ? '✓ 压缩成功' : '✗ ' + (r.error || ''), r.success ? 'success' : 'error');
    } catch(e) { showStatus('json-status', '✗ ' + e, 'error'); }
}

async function jsonValidate() {
    const input = editors.jsonInput.getValue();
    if (!input.trim()) return;
    try {
        const r = await invoke('json_validate', { input });
        showStatus('json-status', r.success ? r.result : r.error, r.success ? 'success' : 'error');
    } catch(e) { showStatus('json-status', '✗ ' + e, 'error'); }
}

function swapJsonEditors() {
    const inputVal = editors.jsonInput.getValue();
    const outputVal = editors.jsonOutput.getValue();
    editors.jsonInput.setValue(outputVal);
    editors.jsonOutput.setValue(inputVal);
}

function clearJsonEditors() {
    editors.jsonInput.setValue('');
    editors.jsonOutput.setValue('');
}

async function jsonUnescape() {
    const input = editors.jsonInput.getValue();
    if (!input.trim()) return;
    try {
        const r = await invoke('json_unescape', { input });
        editors.jsonOutput.setValue(r.result);
        editors.jsonOutput.scrollTo(0, 0);
        showStatus('json-status', r.success ? '✓ 去转义成功' : '✗ ' + (r.error || ''), r.success ? 'success' : 'error');
    } catch(e) { showStatus('json-status', '✗ ' + e, 'error'); }
}

// ===== 文本对比 (Side-by-side Diff) =====
async function textDiff() {
    const left = editors.diffLeft.getValue();
    const right = editors.diffRight.getValue();
    if (!left && !right) return;
    try {
        const r = await invoke('text_diff', { left, right });
        // Stats
        const statsEl = document.getElementById('diff-stats');
        statsEl.innerHTML = `
            <div class="diff-stat-item"><div class="diff-stat-dot" style="background:var(--success)"></div> 相同 ${r.stats.same} 行</div>
            <div class="diff-stat-item"><div class="diff-stat-dot" style="background:var(--warning)"></div> 修改 ${r.stats.changed} 行</div>
            <div class="diff-stat-item"><div class="diff-stat-dot" style="background:var(--diff-del-text)"></div> 删除 ${r.stats.deleted} 行</div>
            <div class="diff-stat-item"><div class="diff-stat-dot" style="background:var(--diff-add-text)"></div> 新增 ${r.stats.added} 行</div>
        `;
        // Render left & right with paired diff for change lines
        const leftResult = document.getElementById('diff-left-result');
        const rightResult = document.getElementById('diff-right-result');
        leftResult.innerHTML = '';
        rightResult.innerHTML = '';
        for (let i = 0; i < r.left.length; i++) {
            const ll = r.left[i];
            const rl = r.right[i];
            if (ll.diff_type === 'change' && rl.diff_type === 'change') {
                // Word-level diff for changed lines
                const { leftHtml: lHtml, rightHtml: rHtml } = wordDiffHtml(ll.content, rl.content);
                leftResult.insertAdjacentHTML('beforeend',
                    `<div class="diff-line change"><span class="diff-line-num">${ll.line_num || ''}</span><span class="diff-line-text">${lHtml}</span></div>`);
                rightResult.insertAdjacentHTML('beforeend',
                    `<div class="diff-line change"><span class="diff-line-num">${rl.line_num || ''}</span><span class="diff-line-text">${rHtml}</span></div>`);
            } else {
                leftResult.insertAdjacentHTML('beforeend', renderDiffLine(ll));
                rightResult.insertAdjacentHTML('beforeend', renderDiffLine(rl));
            }
        }
        // Enable synchronized scrolling
        setupDiffSyncScroll();
    } catch(e) {
        document.getElementById('diff-stats').innerHTML = `<div style="color:var(--error)">❌ ${e}</div>`;
    }
}

let _diffSyncLock = false;
function setupDiffSyncScroll() {
    const leftSide = document.getElementById('diff-left-result')?.parentElement;
    const rightSide = document.getElementById('diff-right-result')?.parentElement;
    if (!leftSide || !rightSide) return;

    const syncScroll = (source, target) => {
        if (_diffSyncLock) return;
        _diffSyncLock = true;
        target.scrollTop = source.scrollTop;
        _diffSyncLock = false;
    };

    leftSide.onscroll = () => syncScroll(leftSide, rightSide);
    rightSide.onscroll = () => syncScroll(rightSide, leftSide);
}

function renderDiffLine(line) {
    const numStr = line.line_num > 0 ? line.line_num : '';
    const textContent = line.diff_type === 'placeholder' ? '' : escapeHtml(line.content);
    return `<div class="diff-line ${line.diff_type}"><span class="diff-line-num">${numStr}</span><span class="diff-line-text">${textContent}</span></div>`;
}

// Word-level diff for changed lines - returns {leftHtml, rightHtml} with inline highlights
function wordDiffHtml(leftText, rightText) {
    // Split into tokens (words + whitespace/punctuation preserved)
    const tokenize = (s) => s.split(/(\s+|[.,;:!?"'()\[\]{}<>]+)/).filter(t => t.length > 0);
    const lTokens = tokenize(leftText);
    const rTokens = tokenize(rightText);

    // LCS on tokens
    const llen = lTokens.length;
    const rlen = rTokens.length;
    const dp = [];
    for (let i = 0; i <= llen; i++) {
        dp[i] = new Uint16Array(rlen + 1);
    }
    for (let i = 1; i <= llen; i++) {
        for (let j = 1; j <= rlen; j++) {
            if (lTokens[i-1] === rTokens[j-1]) {
                dp[i][j] = dp[i-1][j-1] + 1;
            } else {
                dp[i][j] = Math.max(dp[i-1][j], dp[i][j-1]);
            }
        }
    }

    // Backtrack to find diff ops
    const ops = []; // {type: 'same'|'del'|'add', token}
    let i = llen, j = rlen;
    while (i > 0 || j > 0) {
        if (i > 0 && j > 0 && lTokens[i-1] === rTokens[j-1]) {
            ops.push({ type: 'same', lToken: lTokens[i-1], rToken: rTokens[j-1] });
            i--; j--;
        } else if (j > 0 && (i === 0 || dp[i][j-1] >= dp[i-1][j])) {
            ops.push({ type: 'add', rToken: rTokens[j-1] });
            j--;
        } else {
            ops.push({ type: 'del', lToken: lTokens[i-1] });
            i--;
        }
    }
    ops.reverse();

    // Merge consecutive same ops and group consecutive del+add
    let leftHtml = '';
    let rightHtml = '';
    let k = 0;
    while (k < ops.length) {
        if (ops[k].type === 'same') {
            leftHtml += escapeHtml(ops[k].lToken);
            rightHtml += escapeHtml(ops[k].rToken);
            k++;
        } else {
            // Collect consecutive del+add as a group
            let delBuf = '';
            let addBuf = '';
            while (k < ops.length && ops[k].type !== 'same') {
                if (ops[k].type === 'del') delBuf += ops[k].lToken;
                if (ops[k].type === 'add') addBuf += ops[k].rToken;
                k++;
            }
            if (delBuf) leftHtml += `<span class="diff-char-del">${escapeHtml(delBuf)}</span>`;
            if (addBuf) rightHtml += `<span class="diff-char-add">${escapeHtml(addBuf)}</span>`;
        }
    }

    return { leftHtml, rightHtml };
}

function clearDiff() {
    editors.diffLeft.setValue('');
    editors.diffRight.setValue('');
    document.getElementById('diff-stats').innerHTML = '';
    document.getElementById('diff-left-result').innerHTML = '';
    document.getElementById('diff-right-result').innerHTML = '';
}

function escapeHtml(text) {
    return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ===== 正则测试 =====
async function testRegex() {
    const pattern = document.getElementById('regex-pattern').value;
    const input = editors.regexInput.getValue();
    const flags = document.getElementById('regex-flags').value;
    if (!pattern || !input) return;
    try {
        const matches = await invoke('regex_test', { pattern, input, flags });
        document.getElementById('regex-result').innerHTML = `<div style="color:var(--success)">✓ 找到 ${matches.length} 个匹配</div>`;
        const MAX_MATCHES = 200;
        const renderMatches = matches.slice(0, MAX_MATCHES);
        document.getElementById('regex-matches').innerHTML = renderMatches.map(m => `
            <div class="match-item">
                <span class="match-text">${escapeHtml(m.match_text)}</span>
                <span class="match-pos">[${m.start}:${m.end}]</span>
                ${m.groups.length ? `<div class="match-groups">分组: ${m.groups.map((g,j) => `$${j+1}=${escapeHtml(g)}`).join(', ')}</div>` : ''}
            </div>
        `).join('') + (matches.length > MAX_MATCHES ? `<div style="color:var(--warning);padding:8px">⚠️ 仅显示前 ${MAX_MATCHES} 个匹配</div>` : '');
    } catch(e) {
        document.getElementById('regex-result').innerHTML = `<div style="color:var(--error)">❌ ${e}</div>`;
        document.getElementById('regex-matches').innerHTML = '';
    }
}

// ===== 文本统计 =====
async function calcTextStats() {
    const input = editors.textStatsInput.getValue();
    try {
        const r = await invoke('text_stats', { input });
        document.getElementById('text-stats-result').innerHTML = `
            <div class="stat-item"><div class="stat-value">${r.chars}</div><div class="stat-label">字符数</div></div>
            <div class="stat-item"><div class="stat-value">${r.chars_no_space}</div><div class="stat-label">字符(无空格)</div></div>
            <div class="stat-item"><div class="stat-value">${r.words}</div><div class="stat-label">单词数</div></div>
            <div class="stat-item"><div class="stat-value">${r.lines}</div><div class="stat-label">行数</div></div>
            <div class="stat-item"><div class="stat-value">${r.bytes}</div><div class="stat-label">字节数</div></div>
        `;
    } catch(e) {}
}

// ===== Base64 =====
// 安全设置大文本到编辑器（避免卡顿）
function safeSetValue(cm, val) {
    if (!cm) return;
    if (val && val.length > 50000) {
        cm.operation(() => cm.setValue(val));
    } else {
        cm.setValue(val);
    }
}

async function b64Encode() {
    const input = editors.base64Input.getValue();
    if (!input) return;
    try {
        const r = await invoke('base64_encode', { input });
        safeSetValue(editors.base64Output, r.result);
    } catch(e) { safeSetValue(editors.base64Output, 'Error: ' + e); }
}

async function b64Decode() {
    const input = editors.base64Input.getValue();
    if (!input) return;
    try {
        const r = await invoke('base64_decode', { input });
        safeSetValue(editors.base64Output, r.success ? r.result : 'Error: ' + r.error);
    } catch(e) { safeSetValue(editors.base64Output, 'Error: ' + e); }
}

// ===== URL 编解码 =====
async function urlEnc() {
    const input = editors.urlCodecInput.getValue();
    if (!input) return;
    try {
        const r = await invoke('url_encode', { input });
        editors.urlCodecOutput.setValue(r.result);
    } catch(e) {}
}

async function urlDec() {
    const input = editors.urlCodecInput.getValue();
    if (!input) return;
    try {
        const r = await invoke('url_decode', { input });
        editors.urlCodecOutput.setValue(r.result);
    } catch(e) { editors.urlCodecOutput.setValue('Error: ' + e); }
}

// ===== Unicode =====
async function uniEncode() {
    const input = editors.unicodeInput.getValue();
    if (!input) return;
    try {
        const r = await invoke('unicode_encode', { input });
        editors.unicodeOutput.setValue(r.result);
    } catch(e) {}
}

async function uniDecode() {
    const input = editors.unicodeInput.getValue();
    if (!input) return;
    try {
        const r = await invoke('unicode_decode', { input });
        editors.unicodeOutput.setValue(r.result);
    } catch(e) {}
}

// ===== HTML 编解码 =====
async function htmlEnc() {
    const input = editors.htmlCodecInput.getValue();
    if (!input) return;
    try {
        const r = await invoke('html_encode', { input });
        editors.htmlCodecOutput.setValue(r.result);
    } catch(e) {}
}

async function htmlDec() {
    const input = editors.htmlCodecInput.getValue();
    if (!input) return;
    try {
        const r = await invoke('html_decode', { input });
        editors.htmlCodecOutput.setValue(r.result);
    } catch(e) {}
}

// ===== 哈希 =====
async function calcHash() {
    const input = editors.hashInput.getValue();
    if (!input) return;
    try {
        const [md5, sha1, sha256, sha512] = await Promise.all([
            invoke('md5_hash', { input }),
            invoke('sha1_hash', { input }),
            invoke('sha256_hash', { input }),
            invoke('sha512_hash', { input }),
        ]);
        document.getElementById('hash-results').innerHTML = [
            { algo: 'MD5', val: md5.result },
            { algo: 'SHA-1', val: sha1.result },
            { algo: 'SHA-256', val: sha256.result },
            { algo: 'SHA-512', val: sha512.result },
        ].map(h => `
            <div class="hash-row">
                <span class="hash-algo">${h.algo}</span>
                <span class="hash-value">${h.val}</span>
                <span class="hash-copy" onclick="copyToClipboard('${h.val}')" title="复制">📋</span>
            </div>
        `).join('');
    } catch(e) {}
}

// ===== HMAC =====
async function calcHmac() {
    const key = document.getElementById('hmac-key').value;
    const input = editors.hmacInput.getValue();
    if (!key || !input) return;
    try {
        const r = await invoke('hmac_sha256', { key, input });
        editors.hmacOutput.setValue(r.result);
    } catch(e) { editors.hmacOutput.setValue('Error: ' + e); }
}

// ===== AES =====
async function aesEnc() {
    const key = document.getElementById('aes-key').value;
    const input = editors.aesInput.getValue();
    if (!key || !input) return;
    try {
        const r = await invoke('aes_encrypt', { key, input });
        editors.aesOutput.setValue(r.success ? r.result : 'Error: ' + r.error);
    } catch(e) { editors.aesOutput.setValue('Error: ' + e); }
}

async function aesDec() {
    const key = document.getElementById('aes-key').value;
    const input = editors.aesInput.getValue();
    if (!key || !input) return;
    try {
        const r = await invoke('aes_decrypt', { key, input });
        editors.aesOutput.setValue(r.success ? r.result : 'Error: ' + r.error);
    } catch(e) { editors.aesOutput.setValue('Error: ' + e); }
}

// ===== 进制转换 =====
async function convertBase() {
    const input = document.getElementById('base-convert-input').value.trim();
    const from = parseInt(document.getElementById('base-convert-from').value);
    if (!input) return;
    try {
        const r = await invoke('base_convert', { input, fromBase: from });
        document.getElementById('base-convert-result').innerHTML = `
            <div class="base-item"><div class="base-label">二进制 (BIN)</div><div class="base-value">${r.binary}</div></div>
            <div class="base-item"><div class="base-label">八进制 (OCT)</div><div class="base-value">${r.octal}</div></div>
            <div class="base-item"><div class="base-label">十进制 (DEC)</div><div class="base-value">${r.decimal}</div></div>
            <div class="base-item"><div class="base-label">十六进制 (HEX)</div><div class="base-value">${r.hexadecimal}</div></div>
        `;
    } catch(e) {
        document.getElementById('base-convert-result').innerHTML = `<div style="color:var(--error)">❌ ${e}</div>`;
    }
}

// ===== 颜色转换 =====
async function convertColor() {
    const input = document.getElementById('color-input').value.trim();
    const from = document.getElementById('color-from').value;
    if (!input) return;
    try {
        const r = await invoke('color_convert', { input, from });
        if (r.error) {
            document.getElementById('color-result').innerHTML = `<div style="color:var(--error)">❌ ${r.error}</div>`;
            return;
        }
        document.getElementById('color-preview').style.background = r.hex;
        document.getElementById('color-result').innerHTML = `
            <div class="color-item"><div class="color-label">HEX</div><div class="color-value">${r.hex}</div></div>
            <div class="color-item"><div class="color-label">RGB</div><div class="color-value">${r.rgb}</div></div>
            <div class="color-item"><div class="color-label">HSL</div><div class="color-value">${r.hsl}</div></div>
        `;
    } catch(e) {}
}

// ===== JWT 解码 =====
async function decodeJwt() {
    const input = editors.jwtInput.getValue().trim();
    if (!input) return;
    try {
        const r = await invoke('jwt_decode', { token: input });
        if (r.error) {
            document.getElementById('jwt-result').innerHTML = `<div style="color:var(--error)">❌ ${r.error}</div>`;
            return;
        }
        let expHtml = '';
        if (r.is_expired === true) expHtml = '<div class="jwt-expired">⚠️ Token 已过期</div>';
        else if (r.is_expired === false) expHtml = '<div class="jwt-valid">✓ Token 未过期</div>';

        document.getElementById('jwt-result').innerHTML = `
            ${expHtml}
            <div class="jwt-section">
                <div class="jwt-label">Header</div>
                <pre>${escapeHtml(r.header)}</pre>
            </div>
            <div class="jwt-section">
                <div class="jwt-label">Payload</div>
                <pre>${escapeHtml(r.payload)}</pre>
            </div>
            <div class="jwt-section">
                <div class="jwt-label">Signature</div>
                <pre>${escapeHtml(r.signature)}</pre>
            </div>
        `;
    } catch(e) {}
}

// ===== URL 解析 =====
async function parseUrl() {
    const input = document.getElementById('url-parse-input').value.trim();
    if (!input) return;
    try {
        const r = await invoke('url_parse', { input });
        if (r.error) {
            document.getElementById('url-parse-result').innerHTML = `<div style="color:var(--error)">❌ ${r.error}</div>`;
            return;
        }
        let html = `
            <div class="url-parse-item"><div class="url-label">Protocol</div><div class="url-value">${r.protocol}</div></div>
            <div class="url-parse-item"><div class="url-label">Host</div><div class="url-value">${r.host}</div></div>
            <div class="url-parse-item"><div class="url-label">Port</div><div class="url-value">${r.port || '(默认)'}</div></div>
            <div class="url-parse-item"><div class="url-label">Path</div><div class="url-value">${r.path}</div></div>
            <div class="url-parse-item"><div class="url-label">Query</div><div class="url-value">${r.query || '(无)'}</div></div>
            <div class="url-parse-item"><div class="url-label">Fragment</div><div class="url-value">${r.fragment || '(无)'}</div></div>
        `;
        if (Object.keys(r.params).length > 0) {
            html += `<div class="url-parse-item" style="grid-column:span 2"><div class="url-label">Query Params</div><div class="url-value">`;
            for (const [k, v] of Object.entries(r.params)) {
                html += `<div><strong>${escapeHtml(k)}</strong> = ${escapeHtml(v)}</div>`;
            }
            html += `</div></div>`;
        }
        document.getElementById('url-parse-result').innerHTML = html;
    } catch(e) {}
}

// ===== Click to copy timestamps =====
document.getElementById('current-ts')?.addEventListener('click', function() {
    copyToClipboard(this.textContent);
});
document.getElementById('current-ts-ms')?.addEventListener('click', function() {
    copyToClipboard(this.textContent);
});

// ===== Keyboard shortcuts =====
document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        const activePage = document.querySelector('.page.active');
        if (!activePage) return;
        const btn = activePage.querySelector('.btn-primary');
        if (btn) btn.click();
    }
});

// 窗口大小改变时更新 HTTP 布局高度
window.addEventListener('resize', debounce(updateHttpLayoutHeight, 100));

// ===== Drag-to-Resize Handles =====
function initResizeHandle(container) {
    const handle = document.createElement('div');
    handle.className = 'resize-handle';
    handle.innerHTML = '⠿';
    handle.title = '拖拽调整大小';
    container.appendChild(handle);

    let startY, startH;

    handle.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        startY = e.clientY;
        startH = container.offsetHeight;
        document.body.style.cursor = 'ns-resize';
        document.body.style.userSelect = 'none';

        const onMove = (e2) => {
            const delta = e2.clientY - startY;
            const minH = parseInt(container.dataset.minH) || 80;
            const maxH = window.innerHeight * 0.8;
            const newH = Math.min(maxH, Math.max(minH, startH + delta));
            container.style.height = newH + 'px';
        };

        const onUp = () => {
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
            // Refresh CodeMirror after resize
            const cmEl = container.querySelector('.CodeMirror');
            if (cmEl && cmEl.CodeMirror) {
                cmEl.CodeMirror.refresh();
            }
        };

        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
    });
}

// ===== JSON fold all / unfold all =====
function jsonFoldAll() {
    const cm = editors.jsonOutput;
    if (!cm) return;
    for (let i = 0; i < cm.lineCount(); i++) {
        cm.foldCode(i, null, 'fold');
    }
}

function jsonUnfoldAll() {
    const cm = editors.jsonOutput;
    if (!cm) return;
    for (let i = 0; i < cm.lineCount(); i++) {
        cm.foldCode(i, null, 'unfold');
    }
}

function jsonFoldLevel(level) {
    const cm = editors.jsonOutput;
    if (!cm) return;
    for (let i = 0; i < cm.lineCount(); i++) {
        cm.foldCode(i, null, 'unfold');
    }
    const indentUnit = cm.getOption('tabSize');
    for (let i = 0; i < cm.lineCount(); i++) {
        const line = cm.getLine(i);
        if (!line) continue;
        const indent = line.search(/\S/);
        if (indent >= 0 && Math.floor(indent / indentUnit) >= level) {
            cm.foldCode(i, null, 'fold');
        }
    }
}

// ===== 命名转换 =====
async function convertCase() {
    const input = document.getElementById('case-convert-input').value.trim();
    if (!input) return;
    try {
        const r = await invoke('text_case_convert', { input });
        const items = [
            { label: 'camelCase', value: r.camel_case },
            { label: 'PascalCase', value: r.pascal_case },
            { label: 'snake_case', value: r.snake_case },
            { label: 'kebab-case', value: r.kebab_case },
            { label: 'CONSTANT_CASE', value: r.constant_case },
            { label: 'dot.case', value: r.dot_case },
            { label: 'Title Case', value: r.title_case },
            { label: 'UPPER CASE', value: r.upper_case },
            { label: 'lower case', value: r.lower_case },
        ];
        document.getElementById('case-convert-result').innerHTML = items.map(it => `
            <div class="case-item">
                <div class="case-label">${it.label}</div>
                <div class="case-value" onclick="copyToClipboard('${escapeHtml(it.value)}')">${escapeHtml(it.value)}</div>
                <span class="case-copy" onclick="copyToClipboard('${escapeHtml(it.value)}')" title="复制">📋</span>
            </div>
        `).join('');
    } catch(e) {
        document.getElementById('case-convert-result').innerHTML = `<div style="color:var(--error)">❌ ${e}</div>`;
    }
}

// ===== CSS 单位转换 =====
async function convertCssUnit() {
    const value = parseFloat(document.getElementById('css-unit-value').value);
    const unit = document.getElementById('css-unit-from').value;
    const baseSize = parseFloat(document.getElementById('css-base-size').value) || 16;
    const vpWidth = parseFloat(document.getElementById('css-vp-width').value) || 1920;
    const vpHeight = parseFloat(document.getElementById('css-vp-height').value) || 1080;
    if (isNaN(value)) return;
    try {
        const r = await invoke('css_unit_convert', { value, unit, baseSize, viewportWidth: vpWidth, viewportHeight: vpHeight });
        if (r.error) {
            document.getElementById('css-unit-result').innerHTML = `<div style="color:var(--error)">❌ ${r.error}</div>`;
            return;
        }
        const items = [
            { label: 'px', value: r.px },
            { label: 'rem', value: r.rem },
            { label: 'em', value: r.em },
            { label: 'pt', value: r.pt },
            { label: 'vw', value: r.vw },
            { label: 'vh', value: r.vh },
        ];
        document.getElementById('css-unit-result').innerHTML = items.map(it => `
            <div class="css-unit-item">
                <div class="css-unit-label">${it.label}</div>
                <div class="css-unit-value">${it.value}</div>
            </div>
        `).join('');
    } catch(e) {
        document.getElementById('css-unit-result').innerHTML = `<div style="color:var(--error)">❌ ${e}</div>`;
    }
}

// ===== 数字格式化 =====
async function formatNumber() {
    const input = document.getElementById('number-format-input').value.trim();
    if (!input) return;
    try {
        const r = await invoke('number_format', { input });
        if (r.error) {
            document.getElementById('number-format-result').innerHTML = `<div style="color:var(--error)">❌ ${r.error}</div>`;
            return;
        }
        const items = [
            { label: '十进制', value: r.decimal },
            { label: '二进制', value: r.binary },
            { label: '八进制', value: r.octal },
            { label: '十六进制', value: r.hex },
            { label: '科学计数法', value: r.scientific },
            { label: '千分位', value: r.grouped },
            { label: '中文数字', value: r.chinese },
        ];
        document.getElementById('number-format-result').innerHTML = items.map(it => `
            <div class="number-format-item">
                <div class="number-format-label">${it.label}</div>
                <div class="number-format-value" onclick="copyToClipboard('${escapeHtml(it.value)}')">${escapeHtml(it.value)}</div>
            </div>
        `).join('');
    } catch(e) {
        document.getElementById('number-format-result').innerHTML = `<div style="color:var(--error)">❌ ${e}</div>`;
    }
}

// ===== YAML/JSON 互转 =====
async function yamlToJson() {
    const input = editors.yamlJsonInput.getValue();
    if (!input.trim()) return;
    try {
        const r = await invoke('yaml_to_json', { input });
        editors.yamlJsonOutput.setValue(r.result);
        showStatus('yaml-json-status', r.success ? '✓ 转换成功' : '✗ ' + (r.error || ''), r.success ? 'success' : 'error');
    } catch(e) { showStatus('yaml-json-status', '✗ ' + e, 'error'); }
}

async function jsonToYaml() {
    const input = editors.yamlJsonInput.getValue();
    if (!input.trim()) return;
    try {
        const r = await invoke('json_to_yaml', { input });
        editors.yamlJsonOutput.setValue(r.result);
        showStatus('yaml-json-status', r.success ? '✓ 转换成功' : '✗ ' + (r.error || ''), r.success ? 'success' : 'error');
    } catch(e) { showStatus('yaml-json-status', '✗ ' + e, 'error'); }
}

// ===== XML 工具 =====
async function xmlFormat() {
    const input = editors.xmlInput.getValue();
    if (!input.trim()) return;
    try {
        const r = await invoke('xml_format', { input });
        editors.xmlOutput.setValue(r.result);
        showStatus('xml-status', r.success ? '✓ 格式化成功' : '✗ ' + (r.error || ''), r.success ? 'success' : 'error');
    } catch(e) { showStatus('xml-status', '✗ ' + e, 'error'); }
}

async function xmlMinify() {
    const input = editors.xmlInput.getValue();
    if (!input.trim()) return;
    try {
        const r = await invoke('xml_minify', { input });
        editors.xmlOutput.setValue(r.result);
        showStatus('xml-status', r.success ? '✓ 压缩成功' : '✗ ' + (r.error || ''), r.success ? 'success' : 'error');
    } catch(e) { showStatus('xml-status', '✗ ' + e, 'error'); }
}

// ===== Cron 解析 =====
async function parseCron() {
    const input = document.getElementById('cron-input').value.trim();
    if (!input) return;
    try {
        const r = await invoke('cron_parse', { expression: input });
        if (r.error) {
            document.getElementById('cron-result').innerHTML = `<div style="color:var(--error)">❌ ${r.error}</div>`;
            return;
        }
        let html = `<div class="cron-desc">📝 ${escapeHtml(r.description)}</div>`;
        if (r.next_times && r.next_times.length > 0) {
            html += `<div class="cron-next-title">⏰ 下次执行时间</div>`;
            html += r.next_times.map((t, i) => `<div class="cron-next-item"><span class="cron-next-num">${i + 1}</span><span class="cron-next-time">${t}</span></div>`).join('');
        }
        document.getElementById('cron-result').innerHTML = html;
    } catch(e) {
        document.getElementById('cron-result').innerHTML = `<div style="color:var(--error)">❌ ${e}</div>`;
    }
}

// ===== Cron 生成器 =====
function updateCronBuilder() {
    const fields = ['minute', 'hour', 'dom', 'month', 'dow'];
    const fieldNames = { minute: '分', hour: '时', dom: '日', month: '月', dow: '周' };
    const parts = [];
    const descParts = [];

    fields.forEach(field => {
        const typeSelect = document.getElementById(`cron-${field}-type`);
        const valInput = document.getElementById(`cron-${field}-val`);
        const type = typeSelect.value;

        // 显示/隐藏值输入框
        if (valInput) {
            valInput.style.display = type === '*' ? 'none' : 'block';
        }

        let value;
        if (type === '*') {
            value = '*';
        } else if (type === 'step') {
            const val = valInput ? valInput.value.trim() : '';
            value = val ? `*/${val}` : '*';
            if (val) descParts.push(`每隔${val}${fieldNames[field]}`);
        } else {
            const val = valInput ? valInput.value.trim() : '';
            value = val || '*';
            if (val && val !== '*') {
                if (field === 'dow') {
                    const dowNames = { '0': '周日', '1': '周一', '2': '周二', '3': '周三', '4': '周四', '5': '周五', '6': '周六', '7': '周日' };
                    if (val.includes('-')) {
                        descParts.push(`周${val}`);
                    } else if (val.includes(',')) {
                        const days = val.split(',').map(d => dowNames[d] || d).join('、');
                        descParts.push(days);
                    } else {
                        descParts.push(dowNames[val] || val);
                    }
                } else if (field === 'month') {
                    descParts.push(`${val}月`);
                } else if (field === 'dom') {
                    descParts.push(`${val}日`);
                } else if (field === 'hour') {
                    descParts.push(`${val}点`);
                } else if (field === 'minute') {
                    descParts.push(`${val}分`);
                }
            }
        }
        parts.push(value);
    });

    const expr = parts.join(' ');
    document.getElementById('cron-generated-expr').textContent = expr;

    // 生成描述
    let desc = descParts.length > 0 ? descParts.join('的') : '每分钟';
    document.getElementById('cron-generated-desc').innerHTML = `📝 ${desc}`;
}

function copyCronExpr() {
    const expr = document.getElementById('cron-generated-expr').textContent;
    navigator.clipboard.writeText(expr).then(() => {
        alert('已复制: ' + expr);
    });
}

function applyCronExpr() {
    const expr = document.getElementById('cron-generated-expr').textContent;
    document.getElementById('cron-input').value = expr;
    parseCron();
}

function applyCronPreset(expr) {
    document.getElementById('cron-input').value = expr;
    parseCron();
}

function reverseCronToUI() {
    const input = document.getElementById('cron-input').value.trim();
    if (!input) return;

    const parts = input.split(/\s+/);
    if (parts.length !== 5) {
        alert('请输入 5 字段格式');
        return;
    }

    const fields = ['minute', 'hour', 'dom', 'month', 'dow'];

    parts.forEach((part, i) => {
        const field = fields[i];
        const typeSelect = document.getElementById(`cron-${field}-type`);
        const valInput = document.getElementById(`cron-${field}-val`);
        if (!typeSelect) return;

        if (part === '*') {
            typeSelect.value = '*';
            if (valInput) valInput.value = '';
        } else if (part.startsWith('*/')) {
            typeSelect.value = 'step';
            if (valInput) valInput.value = part.substring(2);
        } else {
            typeSelect.value = 'specific';
            if (valInput) valInput.value = part;
        }
    });

    updateCronBuilder();
}

// ===== MIME 查询 =====
async function lookupMime() {
    const input = document.getElementById('mime-input').value.trim();
    if (!input) return;
    try {
        const results = await invoke('mime_lookup', { input });
        document.getElementById('mime-result').innerHTML = results.map(r => {
            if (r.error) return `<div class="mime-item" style="color:var(--text-muted)">${r.error}</div>`;
            return `<div class="mime-item">
                <div class="mime-type">${escapeHtml(r.mime_type)}</div>
                <div class="mime-exts">${r.extensions.map(e => '.' + e).join(', ')}</div>
            </div>`;
        }).join('');
    } catch(e) {
        document.getElementById('mime-result').innerHTML = `<div style="color:var(--error)">❌ ${e}</div>`;
    }
}

// ===== UUID 生成器 =====
async function generateUuid() {
    try {
        const r = await invoke('uuid_generate');
        const container = document.getElementById('uuid-result');
        container.innerHTML = `
            <div class="uuid-item" onclick="copyToClipboard('${r.uuid}')">
                <div class="uuid-format">标准</div>
                <div class="uuid-value">${r.uuid}</div>
                <span class="uuid-copy">📋</span>
            </div>
            <div class="uuid-item" onclick="copyToClipboard('${r.uppercase}')">
                <div class="uuid-format">大写</div>
                <div class="uuid-value">${r.uppercase}</div>
                <span class="uuid-copy">📋</span>
            </div>
            <div class="uuid-item" onclick="copyToClipboard('${r.no_dash}')">
                <div class="uuid-format">无横线</div>
                <div class="uuid-value">${r.no_dash}</div>
                <span class="uuid-copy">📋</span>
            </div>
            <div class="uuid-item" onclick="copyToClipboard('${r.braced}')">
                <div class="uuid-format">花括号</div>
                <div class="uuid-value">${r.braced}</div>
                <span class="uuid-copy">📋</span>
            </div>
        `;
    } catch(e) {}
}

async function generateUuid5() {
    try {
        const container = document.getElementById('uuid-result');
        let html = '';
        for (let i = 0; i < 5; i++) {
            const r = await invoke('uuid_generate');
            html += `<div class="uuid-item" onclick="copyToClipboard('${r.uuid}')">
                <div class="uuid-value">${r.uuid}</div>
                <span class="uuid-copy">📋</span>
            </div>`;
        }
        container.innerHTML = html;
    } catch(e) {}
}

// ===== 密码生成器 =====
async function generatePassword() {
    const length = parseInt(document.getElementById('pwd-length').value) || 16;
    const uppercase = document.getElementById('pwd-upper').checked;
    const lowercase = document.getElementById('pwd-lower').checked;
    const numbers = document.getElementById('pwd-numbers').checked;
    const symbols = document.getElementById('pwd-symbols').checked;
    try {
        const r = await invoke('password_generate', { length, uppercase, lowercase, numbers, symbols });
        if (r.error) {
            document.getElementById('password-result').innerHTML = `<div style="color:var(--error)">❌ ${r.error}</div>`;
            return;
        }
        let strength = '弱';
        let strengthColor = 'var(--error)';
        if (r.entropy > 60) { strength = '强'; strengthColor = 'var(--success)'; }
        else if (r.entropy > 40) { strength = '中'; strengthColor = 'var(--warning)'; }

        document.getElementById('password-result').innerHTML = `
            <div class="pwd-value" onclick="copyToClipboard('${escapeHtml(r.password)}')">${escapeHtml(r.password)}</div>
            <div class="pwd-meta">
                <span>长度: ${r.length}</span>
                <span>信息熵: ${r.entropy} bits</span>
                <span style="color:${strengthColor}">强度: ${strength}</span>
            </div>
        `;
    } catch(e) {}
}

// ===== Lorem Ipsum =====
async function generateLorem() {
    const paragraphs = parseInt(document.getElementById('lorem-paragraphs').value) || 3;
    const type = document.getElementById('lorem-type').value;
    try {
        const r = await invoke('lorem_generate', { paragraphs, type });
        editors.loremOutput.setValue(r.text);
    } catch(e) {}
}

// ===== 文本去重 =====
async function deduplicateText() {
    const input = editors.textDedupInput.getValue();
    if (!input.trim()) return;
    try {
        const r = await invoke('text_deduplicate', { input });
        editors.textDedupOutput.setValue(r.result);
        showStatus('text-dedup-status', `✓ 原始 ${r.original_lines} 行 → 去重后 ${r.result_lines} 行，移除 ${r.removed} 行`, 'success');
    } catch(e) { showStatus('text-dedup-status', '✗ ' + e, 'error'); }
}

// ===== 文本排序 =====
async function sortText(reverse) {
    const input = editors.textSortInput.getValue();
    if (!input.trim()) return;
    try {
        const r = await invoke('text_sort', { input, reverse });
        editors.textSortOutput.setValue(r.result);
        showStatus('text-sort-status', `✓ 已${reverse ? '降序' : '升序'}排序，共 ${r.result_lines} 行`, 'success');
    } catch(e) { showStatus('text-sort-status', '✗ ' + e, 'error'); }
}

// ===== 去除空行 =====
async function trimLines() {
    const input = editors.textTrimInput.getValue();
    if (!input.trim()) return;
    try {
        const r = await invoke('text_trim_lines', { input });
        editors.textTrimOutput.setValue(r.result);
        showStatus('text-trim-status', `✓ 原始 ${r.original_lines} 行 → 去除空行后 ${r.result_lines} 行，移除 ${r.removed} 行`, 'success');
    } catch(e) { showStatus('text-trim-status', '✗ ' + e, 'error'); }
}

// ===== 文本翻译 =====
async function doTranslate() {
    const text = editors.translateInput.getValue();
    if (!text.trim()) {
        showStatus('translate-status', '请输入要翻译的文本', 'error');
        return;
    }
    const source = document.getElementById('translate-source-lang').value;
    const target = document.getElementById('translate-target-lang').value;

    showStatus('translate-status', '翻译中...', 'success');
    try {
        const r = await invoke('translate', { text, source, target });
        if (r.success) {
            editors.translateOutput.setValue(r.result);
            showStatus('translate-status', '翻译完成', 'success');
        } else {
            showStatus('translate-status', r.error || '翻译失败', 'error');
        }
    } catch(e) {
        showStatus('translate-status', '✗ ' + e, 'error');
    }
}

function swapTranslateLangs() {
    const sourceSelect = document.getElementById('translate-source-lang');
    const targetSelect = document.getElementById('translate-target-lang');
    const temp = sourceSelect.value;
    sourceSelect.value = targetSelect.value;
    targetSelect.value = temp;
    // 同时交换文本
    const inputText = editors.translateInput.getValue();
    const outputText = editors.translateOutput.getValue();
    editors.translateInput.setValue(outputText);
    editors.translateOutput.setValue(inputText);
}

function switchTranslateMode(mode) {
    const tabs = document.querySelectorAll('.translate-tab');
    tabs.forEach(t => t.classList.remove('active'));
    if (mode === 'local') {
        tabs[0].classList.add('active');
        document.getElementById('translate-local-section').style.display = 'block';
        document.getElementById('translate-online-section').style.display = 'none';
    } else {
        tabs[1].classList.add('active');
        document.getElementById('translate-local-section').style.display = 'none';
        document.getElementById('translate-online-section').style.display = 'block';
    }
}

async function openOnlineTranslator(service) {
    try {
        await invoke('open_translate_webview', { service });
    } catch(e) {
        console.error('创建翻译窗口失败:', e);
        alert('打开翻译窗口失败: ' + e);
    }
}

// ===== 图片 Base64 互转 =====
let _selectedImageFile = null;

// 拖拽上传
const uploadArea = document.getElementById('image-upload-area');
if (uploadArea) {
    uploadArea.addEventListener('click', () => document.getElementById('image-file-input').click());
    uploadArea.addEventListener('dragover', (e) => {
        e.preventDefault();
        uploadArea.classList.add('dragover');
    });
    uploadArea.addEventListener('dragleave', () => uploadArea.classList.remove('dragover'));
    uploadArea.addEventListener('drop', (e) => {
        e.preventDefault();
        e.stopPropagation();
        uploadArea.classList.remove('dragover');
        const files = e.dataTransfer.files;
        if (files.length > 0) handleImageFile(files[0]);
    });
    document.getElementById('image-file-input').addEventListener('change', (e) => {
        if (e.target.files.length > 0) handleImageFile(e.target.files[0]);
    });
}

// 复制图片 Base64 内容
function copyImgBase64() {
    if (editors.imageBase64Output) {
        copyToClipboard(editors.imageBase64Output.getValue());
    }
}

function handleImageFile(file) {
    if (!file.type.startsWith('image/')) {
        showStatus('image-b64-status', '❌ 请选择图片文件', 'error');
        return;
    }
    _selectedImageFile = file;
    const reader = new FileReader();
    reader.onload = (e) => {
        document.getElementById('image-preview-img').src = e.target.result;
        document.getElementById('image-preview').style.display = 'block';
        document.getElementById('image-upload-area').style.display = 'none';
        document.getElementById('img-to-b64-btn').disabled = false;
        if (editors.imageBase64Output) safeSetValue(editors.imageBase64Output, '');
        document.getElementById('copy-img-b64-btn').disabled = true;
    };
    reader.readAsDataURL(file);
}

function clearImageUpload() {
    _selectedImageFile = null;
    document.getElementById('image-file-input').value = '';
    document.getElementById('image-preview').style.display = 'none';
    document.getElementById('image-upload-area').style.display = 'block';
    document.getElementById('img-to-b64-btn').disabled = true;
    if (editors.imageBase64Output) safeSetValue(editors.imageBase64Output, '');
    document.getElementById('copy-img-b64-btn').disabled = true;
    showStatus('image-b64-status', '', '');
}

async function convertImageToBase64() {
    if (!_selectedImageFile) return;
    try {
        // 前端直接 FileReader 转 base64，无需临时文件
        const reader = new FileReader();
        reader.onload = (e) => {
            const dataUrl = e.target.result;  // data:image/png;base64,...
            // 提取纯 base64 部分
            const base64 = dataUrl.split(',')[1];
            safeSetValue(editors.imageBase64Output, dataUrl);
            const copyBtn = document.getElementById('copy-img-b64-btn'); if (copyBtn) copyBtn.disabled = false;
            
            const size = _selectedImageFile.size;
            const type = _selectedImageFile.type || 'image/png';
            showStatus('image-b64-status', `✓ 转换成功 | ${type} | ${size} 字节`, 'success');
        };
        reader.onerror = () => {
            showStatus('image-b64-status', '❌ 读取文件失败', 'error');
        };
        reader.readAsDataURL(_selectedImageFile);
    } catch(e) {
        showStatus('image-b64-status', '✗ ' + e, 'error');
    }
}

async function convertBase64ToImage() {
    const base64Str = (editors.b64ToImgInput || editors.base64Input).getValue().trim();
    if (!base64Str) return;
    try {
        const r = await invoke('base64_to_image', { base64Str });
        if (r.success) {
            const ext = r.mime_type.split('/')[1] || 'bin';
            document.getElementById('base64-to-image-result').innerHTML = `
                <div class="b64-image-card">
                    <img src="${r.data_url}" alt="预览" class="b64-image-preview">
                    <div class="b64-image-info">
                        <div class="b64-image-type">${r.mime_type}</div>
                        <div class="b64-image-size">${r.size_bytes} 字节</div>
                    </div>
                    <div class="btn-group">
                        <a href="${r.data_url}" download="image.${ext}" class="btn btn-primary" style="text-decoration:none;display:inline-block">⬇ 下载图片</a>
                    </div>
                </div>
            `;
            showStatus('b64-to-img-status', '✓ 转换成功', 'success');
        } else {
            document.getElementById('base64-to-image-result').innerHTML = '';
            showStatus('b64-to-img-status', `❌ ${r.error}`, 'error');
        }
    } catch(e) {
        showStatus('b64-to-img-status', '✗ ' + e, 'error');
    }
}

async function pasteFromClipboard() {
    try {
        const text = await navigator.clipboard.readText();
        if (text) {
            editors.base64Input.setValue(text);
        }
    } catch(e) {
        showStatus('b64-to-img-status', '❌ 无法读取剪贴板', 'error');
    }
}

// ===== 截图工具 =====

// 根据平台更新快捷键提示
function updateShortcutHint() {
    const hint = document.getElementById('shortcut-hint');
    const desc = document.getElementById('screenshot-desc');
    if (!hint) return;
    
    const platform = navigator.platform || navigator.userAgent;
    const isMac = /Mac|iPhone|iPad/.test(platform);
    
    if (isMac) {
        hint.innerHTML = '<kbd>⌘</kbd> + <kbd>⇧</kbd> + <kbd>S</kbd>';
        if (desc) desc.textContent = '随时按下快捷键，选择区域后自动弹出悬浮编辑器';
    } else {
        hint.innerHTML = '<kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>S</kbd>';
        if (desc) desc.textContent = '按下快捷键截图，自动弹出悬浮编辑器进行标注';
    }
}

// 触发截图（调用 Rust 后端 → 平台截图 → 打开悬浮编辑器窗口）
async function triggerScreenshot(mode) {
    try {
        // macOS: 先检查屏幕录制权限
        const platform = navigator.platform || navigator.userAgent;
        const isMac = /Mac|iPhone|iPad/.test(platform);
        if (isMac) {
            try {
                const permResult = await invoke('check_screen_capture_permission');
                if (!permResult.has_permission) {
                    showStatus('screenshot-status',
                        '⚠️ 缺少屏幕录制权限！请在「系统设置 > 隐私与安全性 > 屏幕录制」中授权 DevToolkit，然后重启应用。',
                        'error');
                    return;
                }
            } catch(e) {
                // 权限检测失败，继续尝试截图
                console.warn('权限检测失败，继续尝试截图:', e);
            }
        }

        showStatus('screenshot-status', '⏳ 正在截图，请选择区域...', 'info');
        const result = await invoke('trigger_screenshot', {
            mode: mode,
            hideMainWindow: false
        });
        showStatus('screenshot-status', '✅ 截图完成，编辑器已打开', 'success');
    } catch(e) {
        if (e.toString().includes('截图失败')) {
            showStatus('screenshot-status', '❌ 截图取消或失败', 'error');
        } else {
            showStatus('screenshot-status', '❌ ' + e, 'error');
        }
    }
}

// ===== QR 码工具 =====
let _qrGeneratedDataUrl = '';
let _qrUploadBase64 = '';

// QR 上传区拖拽
const qrUploadArea = document.getElementById('qr-upload-area');
if (qrUploadArea) {
    qrUploadArea.addEventListener('click', () => document.getElementById('qr-file-input').click());
    qrUploadArea.addEventListener('dragover', (e) => {
        e.preventDefault();
        qrUploadArea.classList.add('dragover');
    });
    qrUploadArea.addEventListener('dragleave', () => qrUploadArea.classList.remove('dragover'));
    qrUploadArea.addEventListener('drop', (e) => {
        e.preventDefault();
        e.stopPropagation();
        qrUploadArea.classList.remove('dragover');
        const files = e.dataTransfer.files;
        if (files.length > 0) handleQrUploadFile(files[0]);
    });
    document.getElementById('qr-file-input').addEventListener('change', (e) => {
        if (e.target.files.length > 0) handleQrUploadFile(e.target.files[0]);
    });
}

async function qrGenerate() {
    const input = editors.qrInput.getValue().trim();
    if (!input) {
        showStatus('qr-generate-status', '请输入要编码的文本', 'error');
        return;
    }
    const ecLevel = document.getElementById('qr-ec-level').value;
    try {
        const r = await invoke('qr_generate', { input, ecLevel });
        if (r.success) {
            _qrGeneratedDataUrl = r.data_url;
            document.getElementById('qr-preview-img').src = r.data_url;
            document.getElementById('qr-generate-result').style.display = 'block';
            showStatus('qr-generate-status', '✓ 生成成功 | ' + r.size_bytes + ' 字节', 'success');
        } else {
            document.getElementById('qr-generate-result').style.display = 'none';
            showStatus('qr-generate-status', '❌ ' + r.error, 'error');
        }
    } catch(e) {
        showStatus('qr-generate-status', '✗ ' + e, 'error');
    }
}

async function downloadQrImage() {
    if (!_qrGeneratedDataUrl) return;
    try {
        const base64Data = _qrGeneratedDataUrl.split(',')[1] || _qrGeneratedDataUrl;
        const r = await invoke('save_screenshot_file', { imageBase64: base64Data });
        if (r.success) {
            showStatus('qr-generate-status', '✓ 已保存到 ' + r.file_path, 'success');
        } else if (r.error !== '用户取消') {
            showStatus('qr-generate-status', '❌ ' + r.error, 'error');
        }
    } catch(e) {
        showStatus('qr-generate-status', '❌ 保存失败: ' + e, 'error');
    }
}

async function copyQrToClipboard() {
    if (!_qrGeneratedDataUrl) return;
    try {
        const base64Data = _qrGeneratedDataUrl.split(',')[1] || _qrGeneratedDataUrl;
        await invoke('copy_screenshot_to_clipboard', { imageBase64: base64Data });
        showStatus('qr-generate-status', '✓ 已复制图片到剪贴板', 'success');
    } catch(e) {
        showStatus('qr-generate-status', '❌ 复制失败: ' + e, 'error');
    }
}

function copyQrBase64() {
    if (!_qrGeneratedDataUrl) return;
    copyToClipboard(_qrGeneratedDataUrl);
    showStatus('qr-generate-status', '✓ 已复制 Base64', 'success');
}

function handleQrUploadFile(file) {
    if (!file.type.startsWith('image/')) {
        showStatus('qr-decode-status', '❌ 请选择图片文件', 'error');
        return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
        _qrUploadBase64 = e.target.result;
        document.getElementById('qr-upload-preview-img').src = e.target.result;
        document.getElementById('qr-upload-preview').style.display = 'block';
        document.getElementById('qr-upload-area').style.display = 'none';
        document.getElementById('qr-decode-btn').disabled = false;
    };
    reader.readAsDataURL(file);
}

function clearQrUpload() {
    _qrUploadBase64 = '';
    document.getElementById('qr-file-input').value = '';
    document.getElementById('qr-upload-preview').style.display = 'none';
    document.getElementById('qr-upload-area').style.display = 'block';
    document.getElementById('qr-decode-btn').disabled = true;
    document.getElementById('qr-decode-result').style.display = 'none';
    showStatus('qr-decode-status', '', '');
}

async function qrDecode() {
    if (!_qrUploadBase64) return;
    try {
        const r = await invoke('qr_decode', { imageData: _qrUploadBase64 });
        if (r.success) {
            editors.qrDecodeOutput.setValue(r.text);
            document.getElementById('qr-decode-result').style.display = 'block';
            showStatus('qr-decode-status', '✓ 解码成功', 'success');
        } else {
            document.getElementById('qr-decode-result').style.display = 'none';
            showStatus('qr-decode-status', '❌ ' + r.error, 'error');
        }
    } catch(e) {
        showStatus('qr-decode-status', '✗ ' + e, 'error');
    }
}

async function pasteQrFromClipboard() {
    try {
        const dataUrl = await invoke('read_clipboard_image');
        _qrUploadBase64 = dataUrl;
        document.getElementById('qr-upload-preview-img').src = dataUrl;
        document.getElementById('qr-upload-preview').style.display = 'block';
        document.getElementById('qr-upload-area').style.display = 'none';
        document.getElementById('qr-decode-btn').disabled = false;
        showStatus('qr-decode-status', '', '');
    } catch(e) {
        showStatus('qr-decode-status', '❌ ' + e, 'error');
    }
}

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
        rows.push({ key: row.querySelector('.kv-key').value, value: row.querySelector('.kv-value').value });
    });
    return rows;
}

function setKvRowData(containerId, rows) {
    const container = document.getElementById(containerId);
    container.innerHTML = '';
    if (!rows || rows.length === 0) { addKvRow(containerId); return; }
    rows.forEach(r => addKvRow(containerId, r.key || '', r.value || ''));
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
            setTimeout(() => editors.httpBody && editors.httpBody.refresh(), 30);
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
    syncFloatTitle();
}

const _reqMethodColors = { GET:'#00d68f', POST:'#ff9f43', PUT:'#448aff', DELETE:'#ff6b6b', PATCH:'#a855f7', HEAD:'#6c5ce7', OPTIONS:'#8b8fa3' };

function _getReqTabLabel(tab) {
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
        return '<div class="http-req-tab' + (isActive ? ' active' : '') + '" onclick="switchReqTab(\'' + tab.id + '\')">' +
            '<span class="http-req-tab-method" style="color:' + color + '">' + tab.method + '</span>' +
            '<span class="http-req-tab-label">' + label + '</span>' +
            (canClose ? '<button class="http-req-tab-close" onclick="event.stopPropagation();closeReqTab(\'' + tab.id + '\')">✕</button>' : '') +
            '</div>';
    }).join('');
    const activeEl = container.querySelector('.http-req-tab.active');
    if (activeEl) activeEl.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

function addReqTab() {
    saveCurrentTabState();
    const tab = createTabState();
    _reqTabs.push(tab);
    _reqActiveTabId = tab.id;
    restoreTabState(tab);
    renderReqTabs();
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
}

function switchReqTab(id) {
    if (id === _reqActiveTabId) return;
    saveCurrentTabState();
    _reqActiveTabId = id;
    const tab = _reqTabs.find(t => t.id === id);
    if (tab) restoreTabState(tab);
    renderReqTabs();
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
        const params = getKvPairs('http-params-kv');
        try {
            const u = new URL(raw.startsWith('http') ? raw : 'http://' + raw);
            u.search = '';
            Object.entries(params).forEach(([k, v]) => u.searchParams.set(k, v));
            const result = u.toString();
            urlInput.value = raw.startsWith('http') ? result : result.replace(/^https?:\/\//, '');
        } catch(e) {}
    } finally { _httpParamsSyncing = false; }
}

document.getElementById('http-url').addEventListener('input', syncUrlToParams);
document.getElementById('http-params-kv').addEventListener('input', syncParamsToUrl);

(async () => {
    try {
        _httpHistory = await invoke('http_load_history');
        _httpFavorites = await invoke('http_load_favorites');
        _httpFolders = await invoke('http_load_folders');
    } catch(e) {}
    loadHttpEnv();
})();

// 初始化第一个请求 Tab
(function initReqTabs() {
    const tab = createTabState();
    _reqTabs = [tab];
    _reqActiveTabId = tab.id;
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
    const tabs = document.querySelectorAll('.http-panel-tab');
    tabs.forEach(t => t.classList.toggle('active', t.textContent.includes(mode === 'history' ? '历史' : '收藏')));
    document.getElementById('http-panel-folders').style.display = mode === 'favorites' ? 'block' : 'none';
    document.getElementById('http-panel-actions').innerHTML = mode === 'history'
        ? '<button class="btn btn-ghost btn-sm" onclick="clearHttpHistory()">🗑 清空历史</button>'
        : '<button class="btn btn-ghost btn-sm" onclick="clearHttpFavorites()">🗑 清空收藏</button>';
    renderHttpFolders();
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

function renderHttpFolders() {
    const container = document.getElementById('http-panel-folders');
    if (_httpPanelMode !== 'favorites') { container.style.display = 'none'; return; }
    container.style.display = 'block';
    const allActive = _httpActiveFolder === null ? 'active' : '';
    let html = '<div class="folder-tree-header">'
        + '<button class="http-folder-btn ' + allActive + '" onclick="setHttpActiveFolder(null)">全部</button>'
        + '<button class="http-folder-btn" onclick="showAddFolderModal(null)">+ 新建</button>'
        + '</div>';
    html += renderFolderTree(buildFolderTree(), 0);
    container.innerHTML = html;
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
        if (_httpPanelMode === 'favorites') {
            renderHttpFolders();
            renderHttpPanelList();
        }
    } catch(e) { alert('收藏失败: ' + e); }
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

function addKvRow(containerId, key = '', value = '') {
    const container = document.getElementById(containerId);
    const row = document.createElement('div');
    row.className = 'kv-row';
    row.innerHTML = '<input type="text" class="kv-key" placeholder="Key" autocomplete="off" value="' + escapeHtmlAttr(key) + '"><input type="text" class="kv-value" placeholder="Value" autocomplete="off" value="' + escapeHtmlAttr(value) + '"><button class="kv-remove" onclick="removeKvRow(this)">✕</button>';
    container.appendChild(row);
    if (containerId === 'http-params-kv' && key) syncParamsToUrl();
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
    btn.textContent = '发送中...';

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

function renderHttpPanelList() {
    const list = document.getElementById('http-panel-list');
    let entries = _httpPanelMode === 'history' ? _httpHistory : _httpFavorites;
    if (_httpPanelMode === 'favorites' && _httpActiveFolder) {
        const ids = getFolderDescendants(_httpActiveFolder);
        entries = entries.filter(e => e.folder_id && ids.includes(e.folder_id));
    }
    const searchQuery = (document.getElementById('http-panel-search')?.value || '').toLowerCase().trim();
    if (searchQuery) {
        entries = entries.filter(e => {
            const url = (e.request.url || '').toLowerCase();
            const name = (e.name || '').toLowerCase();
            return url.includes(searchQuery) || name.includes(searchQuery);
        });
    }
    if (entries.length === 0) {
        list.innerHTML = '<div style="color:var(--text-secondary);padding:20px;text-align:center">暂无数据</div>';
        return;
    }
    const methodColors = { GET:'#00d68f', POST:'#ff9f43', PUT:'#448aff', DELETE:'#ff6b6b', PATCH:'#a855f7', HEAD:'#6c5ce7', OPTIONS:'#8b8fa3' };
    const arr = _httpPanelMode === 'history' ? '_httpHistory' : '_httpFavorites';
    list.innerHTML = entries.map((entry, i) => {
        const color = methodColors[entry.request.method] || '#e4e6f0';
        const time = entry.created_at ? new Date(entry.created_at * 1000).toLocaleString('zh-CN') : '';
        const name = entry.name || entry.request.url;
        const folderObj = entry.folder_id ? _httpFolders.find(f => f.id === entry.folder_id) : null;
        const folderTag = folderObj ? '<span class="http-folder-tag">' + escapeHtml(folderObj.name) + '</span>' : '';
        const renameBtn = _httpPanelMode === 'favorites' ? '<span class="http-fav-rename" onclick="event.stopPropagation();showRenameFavModal(\'' + escapeHtmlAttr(entry.id) + '\')" title="重命名">✎</span>' : '';
        return '<div class="http-history-item" onclick="loadHttpEntry(' + arr + '[' + i + '])">' +
            '<span class="http-history-method" style="color:' + color + '">' + entry.request.method + '</span>' +
            '<span class="http-history-url">' + escapeHtml(name.length > 60 ? name.slice(0, 60) + '...' : name) + '</span>' +
            folderTag +
            '<span class="http-history-time">' + time + '</span>' +
            renameBtn +
            '<button class="kv-remove" onclick="event.stopPropagation();removeHttpEntry(' + i + ')">✕</button>' +
            '</div>';
    }).join('');
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
    showHttpConfirm('确定清空所有收藏？', async () => {
        _httpFavorites = [];
        try { await invoke('http_save_favorites', { entries: [] }); } catch(e) {}
        renderHttpPanelList();
    });
}

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
    if (conn && conn.db_type === 'sqlite') {
        dbShowStatus('SQLite 不支持取消查询', 'error');
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
        const ports = { mysql: '3306', postgresql: '5432' };
        if (portInput) portInput.value = ports[dbType] || '3306';
    }
}

// 浏览 SQLite 文件
async function browseSqliteFile() {
    const result = await invoke('open_save_dialog', {
        defaultPath: '',
        filters: [{ name: 'SQLite', extensions: ['db', 'sqlite', 'sqlite3'] }],
    });
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

    const icons = { mysql: '🐬', postgresql: '🐘', sqlite: '📦' };

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
        }

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
    if (!confirm('确定要删除这个连接吗？')) return;

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
        console.log('加载表列表, 数据库:', dbName);

        const tables = await invoke('db_get_tables', {
            connectionId: dbState.currentConnection,
            database: dbName,
        });

        console.log('获取到的表数量:', tables?.length);

        if (!tables || tables.length === 0) {
            tree.innerHTML = '<div class="db-result-placeholder" style="padding: 16px;">无表</div>';
            primeSchemaCache(dbState.currentConnection, dbName, []);
            return;
        }

        primeSchemaCache(dbState.currentConnection, dbName, tables.map(t => t.name));
        renderTableTree(tables);
    } catch (e) {
        console.error('加载表列表失败:', e);
        tree.innerHTML = `<div class="db-result-placeholder" style="padding: 16px; color: var(--error);">加载失败: ${e}</div>`;
    }
}

// 渲染表树
function renderTableTree(tables) {
    const tree = document.getElementById('db-tree');
    if (!tree) return;

    if (tables.length === 0) {
        tree.innerHTML = '<div class="db-result-placeholder" style="padding: 16px;">无表</div>';
        return;
    }

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

    // 绑定文件夹展开/折叠
    tree.querySelectorAll('.db-tree-folder > .db-tree-item').forEach(item => {
        item.addEventListener('click', (e) => {
            e.stopPropagation();
            item.parentElement.classList.toggle('open');
        });
    });

    // 绑定表点击和右键事件
    tree.querySelectorAll('.db-tree-children .db-tree-item').forEach(item => {
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
    document.getElementById('editor-select-all').onchange = (e) => {
        document.querySelectorAll('#db-editor-tbody .row-select').forEach(cb => {
            cb.checked = e.target.checked;
        });
        updateEditorButtons();
    };

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
        dbShowStatus('请输入 SQL 语句', 'error');
        return;
    }

    // 破坏性 SQL 拦截
    const destructive = analyzeDestructive(sql);
    if (destructive.length > 0) {
        const ok = await confirmDestructive(destructive);
        if (!ok) {
            dbShowStatus('已取消', 'info');
            recordMessage('warning', sql, '用户取消执行破坏性 SQL');
            return;
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
    const isQuery = /^\s*(SELECT|SHOW|DESC|DESCRIBE|EXPLAIN|WITH)/i.test(sql);

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

// 在页面切换时初始化
document.querySelectorAll('[data-page="database"]').forEach(item => {
    item.addEventListener('click', () => {
        setTimeout(initDatabaseTool, 100);
    });
});
