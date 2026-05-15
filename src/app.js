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
    const wrapper = cm.getWrapperElement();
    wrapper.parentElement.classList.add('code-editor-readonly');
    return cm;
}

function makePlainInputEditor(id) {
    return makeEditor(id, CM_PLAIN_OPTS);
}

function makePlainOutputEditor(id) {
    const cm = makeEditor(id, CM_PLAIN_OUTPUT_OPTS);
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
    editors.textStatsInput.on('change', debounce(() => calcTextStats(), 400));

    // Base64
    editors.base64Input = makePlainInputEditor('base64-input-editor');
    editors.base64Output = makePlainOutputEditor('base64-output-editor');

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

    // Create search bars for all editors & track focus
    for (const [key, cm] of Object.entries(editors)) {
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
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
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
async function b64Encode() {
    const input = editors.base64Input.getValue();
    if (!input) return;
    try {
        const r = await invoke('base64_encode', { input });
        editors.base64Output.setValue(r.result);
    } catch(e) { editors.base64Output.setValue('Error: ' + e); }
}

async function b64Decode() {
    const input = editors.base64Input.getValue();
    if (!input) return;
    try {
        const r = await invoke('base64_decode', { input });
        editors.base64Output.setValue(r.success ? r.result : 'Error: ' + r.error);
    } catch(e) { editors.base64Output.setValue('Error: ' + e); }
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
