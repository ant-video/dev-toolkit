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

        // SSH页面特殊处理：移除内容区域的padding
        const content = document.querySelector('.content');
        if (content) {
            if (item.dataset.page === 'ssh') {
                content.classList.add('ssh-active');
            } else {
                content.classList.remove('ssh-active');
            }
        }

        // 数据库页面：确保初始化后再操作
        if (item.dataset.page === 'database') {
            setTimeout(() => {
                initDatabaseTool().then(() => {
                    if (item.dataset.dbType) {
                        const dbTypeSelect = document.getElementById('db-type-select');
                        if (dbTypeSelect) {
                            dbTypeSelect.value = item.dataset.dbType;
                            dbTypeSelect.dispatchEvent(new Event('change'));
                        }
                        document.getElementById('db-new-connection')?.click();
                    }
                });
            }, 50);
        }

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

// JSON 实时校验（仅当 body-type=json 时）
function validateHttpBodyJson() {
    const statusEl = document.getElementById('http-body-json-status');
    if (!statusEl || !editors.httpBody) return;
    const type = document.getElementById('http-body-type');
    if (!type || type.value !== 'json') { statusEl.textContent = ''; return; }
    const val = editors.httpBody.getValue().trim();
    if (!val) { statusEl.textContent = ''; return; }
    try {
        JSON.parse(val);
        statusEl.textContent = '✓ valid';
        statusEl.className = 'http-body-json-status valid';
    } catch(e) {
        const msg = e.message.replace(/^JSON\.parse: /, '').slice(0, 40);
        statusEl.textContent = '✗ ' + msg;
        statusEl.className = 'http-body-json-status invalid';
    }
}
if (editors.httpBody) {
    editors.httpBody.on('change', debounce(validateHttpBodyJson, 300));
}
document.addEventListener('change', e => {
    if (e.target && e.target.id === 'http-body-type') validateHttpBodyJson();
});

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

