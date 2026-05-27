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

