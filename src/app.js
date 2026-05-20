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
})();

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
    const headers = getKvPairs('http-headers-kv');
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
    const url = document.getElementById('http-url').value.trim();
    if (!url) { alert('请输入 URL'); return; }

    const headers = getHeaderPairs();
    const bodyType = document.getElementById('http-body-type').value;
    let body = '';
    if (bodyType === 'form-data') {
        body = JSON.stringify(getKvPairs('http-formdata-kv'));
    } else if (bodyType !== 'none') {
        body = editors.httpBody ? editors.httpBody.getValue() : '';
    }
    const params = getKvPairs('http-params-kv');

    let finalUrl = url;
    if (Object.keys(params).length > 0) {
        try {
            const u = new URL(url.startsWith('http') ? url : 'http://' + url);
            Object.entries(params).forEach(([k, v]) => u.searchParams.set(k, v));
            finalUrl = u.toString();
        } catch(e) {}
    }

    const btn = document.getElementById('http-send-btn');
    btn.disabled = true;
    btn.textContent = '发送中...';

    try {
        const r = await invoke('http_request', {
            req: { method, url: finalUrl, headers, body_type: bodyType, body, timeout: 30 }
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

        if (r.success && r.body) {
            let bodyText = r.body;
            try {
                const parsed = JSON.parse(r.body);
                bodyText = JSON.stringify(parsed, null, 2);
            } catch(e) {}
            if (editors.httpResponseBody) {
                editors.httpResponseBody.setValue(bodyText);
                try { editors.httpResponseBody.setOption('mode', 'javascript'); } catch(e) {}
            }
            if (editors.httpResponseRaw) editors.httpResponseRaw.setValue(r.body);
        } else {
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
            request: { method, url: finalUrl, headers, body_type: bodyType, body, timeout: 30 },
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
    editor: null,
};

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
    if (dbState.editor) {
        dbState.editor.refresh();
        return;
    }

    // 初始化 SQL 编辑器 (CodeMirror)
    const sqlInput = document.getElementById('db-sql-input');
    if (sqlInput && typeof CodeMirror !== 'undefined') {
        dbState.editor = CodeMirror.fromTextArea(sqlInput, {
            mode: 'text/x-sql',
            theme: 'dracula',
            lineNumbers: true,
            indentUnit: 2,
            tabSize: 2,
            lineWrapping: true,
            extraKeys: {
                'Cmd-Enter': executeQuery,
                'Ctrl-Enter': executeQuery,
            },
        });
        // 延迟刷新确保正确渲染
        setTimeout(() => dbState.editor && dbState.editor.refresh(), 100);
    }

    // 绑定事件
    document.getElementById('db-new-connection')?.addEventListener('click', openConnectionModal);
    document.getElementById('db-test-connection')?.addEventListener('click', testConnection);
    document.getElementById('db-save-connection')?.addEventListener('click', saveConnection);
    document.getElementById('db-execute')?.addEventListener('click', executeQuery);
    document.getElementById('db-format')?.addEventListener('click', formatSql);
    document.getElementById('db-clear')?.addEventListener('click', clearSql);
    document.getElementById('db-type-select')?.addEventListener('change', handleDbTypeChange);
    document.getElementById('db-browse-file')?.addEventListener('click', browseSqliteFile);

    // 连接选择器
    document.getElementById('db-connection-select')?.addEventListener('change', handleConnectionChange);

    // 数据库选择器
    document.getElementById('db-database-select')?.addEventListener('change', handleDatabaseChange);

    // 弹窗关闭
    document.querySelector('#db-connection-modal .modal-close')?.addEventListener('click', closeConnectionModal);
    document.querySelector('#db-connection-modal .modal-cancel')?.addEventListener('click', closeConnectionModal);

    // 加载保存的连接
    await loadConnections();

    // 处理数据库类型变化
    handleDbTypeChange();
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

// 渲染连接列表
function renderConnectionList() {
    const list = document.getElementById('db-connection-list');
    if (!list) return;

    if (dbState.connections.length === 0) {
        list.innerHTML = '<div class="db-result-placeholder" style="padding: 16px;">暂无保存的连接</div>';
        return;
    }

    const icons = { mysql: '🐬', postgresql: '🐘', sqlite: '📦' };

    list.innerHTML = dbState.connections.map(conn => `
        <div class="db-connection-item" data-id="${conn.id}">
            <span class="db-connection-icon">${icons[conn.db_type] || '🗄️'}</span>
            <span class="db-connection-name">${conn.name}</span>
            <span class="db-connection-status"></span>
            <div class="db-connection-actions">
                <button class="db-conn-action db-conn-edit" data-id="${conn.id}" title="编辑">✏️</button>
                <button class="db-conn-action db-conn-delete" data-id="${conn.id}" title="删除">🗑️</button>
            </div>
        </div>
    `).join('');

    // 绑定点击事件
    list.querySelectorAll('.db-connection-item').forEach(item => {
        // 单击连接
        item.addEventListener('click', (e) => {
            if (e.target.closest('.db-conn-action')) return; // 忽略按钮点击
            connectToDatabase(item.dataset.id);
        });

        // 双击断开
        item.addEventListener('dblclick', () => disconnectDatabase(item.dataset.id));
    });

    // 绑定编辑和删除按钮
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

    try {
        await invoke('db_connect', { id: connectionId });
        dbState.currentConnection = connectionId;

        // 从保存的连接信息中获取数据库名
        const conn = dbState.connections.find(c => c.id === connectionId);
        if (conn) {
            dbState.currentDatabase = conn.database;
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
            return;
        }

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
        // 单击 - 插入 SELECT 语句
        item.addEventListener('click', (e) => {
            e.stopPropagation();
            const tableName = item.dataset.table;
            insertSelectStatement(tableName);
        });

        // 双击 - 显示表结构
        item.addEventListener('dblclick', (e) => {
            e.stopPropagation();
            const tableName = item.dataset.table;
            showTableSchema(tableName);
        });

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
        <div class="db-menu-item" data-action="select">📄 查看数据</div>
        <div class="db-menu-item" data-action="structure">📋 查看结构</div>
        <div class="db-menu-item" data-action="insert">➕ 插入数据</div>
        <div class="db-menu-divider"></div>
        <div class="db-menu-item" data-action="edit">✏️ 编辑数据</div>
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
        case 'select':
            insertSelectStatement(tableName);
            break;
        case 'structure':
            showTableSchema(tableName);
            break;
        case 'insert':
            showInsertDialog(tableName);
            break;
        case 'edit':
            openDataEditor(tableName);
            break;
        case 'truncate':
            if (confirm(`确定要清空表 "${tableName}" 吗？此操作不可恢复！`)) {
                executeSql(`TRUNCATE TABLE \`${tableName}\`;`);
            }
            break;
        case 'drop':
            const typeText = tableType === 'view' ? '视图' : '表';
            if (confirm(`确定要删除${typeText} "${tableName}" 吗？此操作不可恢复！`)) {
                const sql = tableType === 'view' ? `DROP VIEW \`${tableName}\`;` : `DROP TABLE \`${tableName}\`;`;
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
        if (dbState.editor) {
            dbState.editor.setValue(sql);
        }
        await executeQuery();
        // 刷新表列表
        await loadTables();
    } catch (e) {
        dbShowStatus(`执行失败: ${e}`, 'error');
    }
}

// 显示插入数据对话框
async function showInsertDialog(tableName) {
    try {
        const schema = await invoke('db_get_table_schema', {
            connectionId: dbState.currentConnection,
            database: dbState.currentDatabase,
            table: tableName,
        });

        // 生成 INSERT 语句模板
        let columns = schema.columns.map(col => col.name).join(', ');
        let placeholders = schema.columns.map(() => '?').join(', ');
        let sql = `INSERT INTO \`${tableName}\` (${columns})\nVALUES (${placeholders});\n\n-- 字段说明:\n`;
        schema.columns.forEach(col => {
            sql += `-- ${col.name}: ${col.data_type}`;
            if (col.is_primary_key) sql += ' [主键]';
            if (!col.nullable) sql += ' [必填]';
            if (col.default) sql += ` [默认: ${col.default}]`;
            sql += '\n';
        });

        if (dbState.editor) {
            dbState.editor.setValue(sql);
        }
        dbShowStatus('已生成 INSERT 语句模板', 'info');
    } catch (e) {
        dbShowStatus(`获取表结构失败: ${e}`, 'error');
    }
}

// 打开数据编辑器
function openDataEditor(tableName) {
    const sql = `SELECT * FROM \`${tableName}\` LIMIT 100;`;
    if (dbState.editor) {
        dbState.editor.setValue(sql);
    }
    executeQuery();
}

// 插入 SELECT 语句
function insertSelectStatement(tableName) {
    const sql = `SELECT * FROM ${tableName} LIMIT 100;`;
    if (dbState.editor) {
        dbState.editor.setValue(sql);
    }
}

// 显示表结构
async function showTableSchema(tableName) {
    try {
        const schema = await invoke('db_get_table_schema', {
            connectionId: dbState.currentConnection,
            database: dbState.currentDatabase || '',
            table: tableName,
        });

        let sql = `-- ${tableName} 表结构\n`;
        schema.columns.forEach(col => {
            sql += `-- ${col.name}: ${col.data_type}`;
            if (col.is_primary_key) sql += ' PRIMARY KEY';
            if (!col.nullable) sql += ' NOT NULL';
            if (col.default) sql += ` DEFAULT ${col.default}`;
            sql += '\n';
        });

        if (dbState.editor) {
            dbState.editor.setValue(sql);
        }
    } catch (e) {
        dbShowStatus(`获取表结构失败: ${e}`, 'error');
    }
}

// 执行查询
async function executeQuery() {
    if (!dbState.currentConnection) {
        dbShowStatus('请先选择连接', 'error');
        return;
    }

    const sql = dbState.editor ? dbState.editor.getValue() : '';
    if (!sql.trim()) {
        dbShowStatus('请输入 SQL 语句', 'error');
        return;
    }

    dbShowStatus('执行中...', 'info');

    const startTime = Date.now();

    try {
        // 判断是查询还是执行
        const isQuery = /^\s*(SELECT|SHOW|DESC|DESCRIBE|EXPLAIN)/i.test(sql);

        // 获取当前选择的数据库
        const database = dbState.currentDatabase || null;
        console.log('执行查询, 数据库:', database);

        if (isQuery) {
            const result = await invoke('db_query', {
                connectionId: dbState.currentConnection,
                sql,
                database,
            });
            displayQueryResult(result, Date.now() - startTime);
        } else {
            const result = await invoke('db_execute', {
                connectionId: dbState.currentConnection,
                sql,
                database,
            });
            displayExecuteResult(result, Date.now() - startTime);
        }
    } catch (e) {
        dbShowStatus(`执行失败: ${e}`, 'error');
        displayError(e, Date.now() - startTime);
    }
}

// 显示查询结果
function displayQueryResult(result, duration) {
    const container = document.getElementById('db-result-content');
    const info = document.getElementById('db-result-info');

    if (!result.success) {
        displayError(result.error || '未知错误', duration);
        return;
    }

    if (result.row_count === 0) {
        container.innerHTML = '<div class="db-result-placeholder">查询返回 0 行</div>';
        info.textContent = `0 行 | ${duration}ms`;
        return;
    }

    let html = `<table class="db-result-table"><thead><tr>`;
    result.columns.forEach(col => {
        html += `<th>${col.name}</th>`;
    });
    html += `</tr></thead><tbody>`;

    result.rows.forEach(row => {
        html += '<tr>';
        row.forEach(cell => {
            html += `<td class="${cell === null ? 'null' : ''}">${cell === null ? 'NULL' : escapeHtml(cell)}</td>`;
        });
        html += '</tr>';
    });

    html += '</tbody></table>';
    container.innerHTML = html;

    info.textContent = `${result.row_count} 行 | ${duration}ms`;
    dbShowStatus('查询完成', 'success');
}

// 显示执行结果
function displayExecuteResult(result, duration) {
    const container = document.getElementById('db-result-content');
    const info = document.getElementById('db-result-info');

    if (!result.success) {
        displayError(result.error || '未知错误', duration);
        return;
    }

    container.innerHTML = `<div class="db-result-placeholder">执行成功</div>`;

    let infoText = `影响 ${result.affected_rows} 行`;
    if (result.last_insert_id) {
        infoText += ` | 最后插入 ID: ${result.last_insert_id}`;
    }
    infoText += ` | ${duration}ms`;

    info.textContent = infoText;
    dbShowStatus('执行完成', 'success');
}

// 显示错误
function displayError(error, duration) {
    const container = document.getElementById('db-result-content');
    const info = document.getElementById('db-result-info');

    container.innerHTML = `<div class="db-result-placeholder" style="color: var(--red);">错误: ${escapeHtml(String(error))}</div>`;
    info.textContent = `错误 | ${duration}ms`;
    dbShowStatus('执行失败', 'error');
}

// 格式化 SQL
function formatSql() {
    if (!dbState.editor) return;

    let sql = dbState.editor.getValue();

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

    dbState.editor.setValue(sql.trim());
}

// 清空 SQL
function clearSql() {
    if (dbState.editor) {
        dbState.editor.setValue('');
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
