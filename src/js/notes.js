const notesState = {
    notes: [],
    activeId: null,
    showArchived: false,
    tagFilter: '',
    viewMode: 'edit',
    initialized: false,
    reminderStarted: false,
    saveTimer: null,
};

function initNotesTool() {
    if (notesState.initialized) {
        refreshNotesEditor();
        return;
    }
    notesState.initialized = true;

    editors.noteContent = makePlainInputEditor('note-content-editor');
    editors.noteContent?.on('change', () => {
        scheduleNoteAutosave();
        if (shouldRenderNotesPreview()) renderNotesPreview();
    });

    document.getElementById('notes-search')?.addEventListener('input', renderNotesList);
    document.getElementById('note-title')?.addEventListener('input', scheduleNoteAutosave);
    document.getElementById('note-tags')?.addEventListener('input', scheduleNoteAutosave);
    document.getElementById('note-reminder-at')?.addEventListener('change', scheduleNoteAutosave);
    document.getElementById('note-attachment-input')?.addEventListener('change', handleNoteAttachments);

    // Drag-and-drop support
    setupNotesDropzone();

    loadNotes();
}

function startNotesReminderService() {
    if (notesState.reminderStarted) return;
    notesState.reminderStarted = true;
    if ('Notification' in window && Notification.permission === 'default') {
        Notification.requestPermission().catch(() => {});
    }
    refreshNotesForReminderService();
    setInterval(async () => {
        await refreshNotesForReminderService();
    }, 30000);
}

async function refreshNotesForReminderService() {
    if (notesState.initialized) {
        flushNoteDraftFromInputs();
        checkDueNoteReminders();
        return;
    }
    try {
        notesState.notes = await invoke('notes_list');
        checkDueNoteReminders();
    } catch (_) {}
}

async function loadNotes() {
    try {
        notesState.notes = await invoke('notes_list');
        if (!notesState.activeId && notesState.notes.length) {
            const first = notesState.notes.find(note => !note.archived) || notesState.notes[0];
            notesState.activeId = first.id;
        }
        renderNotesList();
        openActiveNote();
        checkDueNoteReminders();
    } catch (e) {
        showNotesStatus('加载失败: ' + e, 'error');
    }
}

function createNote() {
    initNotesTool();
    const now = Date.now();
    const draft = {
        id: 'draft-' + now,
        title: '',
        content: '',
        tags: [],
        attachments: [],
        reminder_at: null,
        reminder_done: true,
        pinned: false,
        archived: false,
        created_at: now,
        updated_at: now,
        isDraft: true,
    };
    notesState.notes.unshift(draft);
    notesState.activeId = draft.id;
    notesState.showArchived = false;
    renderNotesList();
    openActiveNote();
    document.getElementById('note-title')?.focus();
}

function getActiveNote() {
    return notesState.notes.find(note => note.id === notesState.activeId) || null;
}

function openNote(id) {
    flushNoteDraftFromInputs();
    notesState.activeId = id;
    openActiveNote();
    renderNotesList();
}

function openActiveNote() {
    const note = getActiveNote();
    const empty = document.getElementById('notes-empty-state');
    const editor = document.getElementById('notes-editor');
    if (!note) {
        if (empty) empty.hidden = false;
        if (editor) editor.hidden = true;
        return;
    }

    if (empty) empty.hidden = true;
    if (editor) editor.hidden = false;
    document.getElementById('note-title').value = note.title || '';
    document.getElementById('note-tags').value = (note.tags || []).join(', ');
    document.getElementById('note-reminder-at').value = note.reminder_at ? toDatetimeLocalValue(note.reminder_at) : '';
    editors.noteContent?.setValue(note.content || '');
    document.getElementById('note-pin-btn').textContent = note.pinned ? '取消置顶' : '置顶';
    document.getElementById('note-archive-btn').textContent = note.archived ? '移出归档' : '归档';
    document.getElementById('note-meta').textContent = formatNoteMeta(note);
    renderNoteAttachments();
    refreshNotesEditor();
    applyNotesViewMode();
}

function refreshNotesEditor() {
    setTimeout(() => editors.noteContent?.refresh(), 30);
}

function flushNoteDraftFromInputs() {
    const note = getActiveNote();
    if (!note || document.getElementById('notes-editor')?.hidden) return;
    note.title = document.getElementById('note-title')?.value || '';
    note.content = editors.noteContent?.getValue() || '';
    note.tags = parseNoteTags(document.getElementById('note-tags')?.value || '');
    const previousReminder = note.reminder_at || null;
    note.reminder_at = parseReminderInput();
    if (!note.reminder_at) note.reminder_done = true;
    else if (note.reminder_at !== previousReminder) note.reminder_done = false;
}

function parseNoteTags(value) {
    const seen = new Set();
    return value
        .split(/[\s,，]+/)
        .map(tag => tag.trim().replace(/^#/, ''))
        .filter(Boolean)
        .filter(tag => {
            const key = tag.toLowerCase();
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });
}

function scheduleNoteAutosave() {
    flushNoteDraftFromInputs();
    renderNotesList();
    clearTimeout(notesState.saveTimer);
    notesState.saveTimer = setTimeout(() => saveCurrentNote(true), 900);
}

async function saveCurrentNote(silent = false) {
    flushNoteDraftFromInputs();
    const note = getActiveNote();
    if (!note) return;
    if (!note.title.trim() && !note.content.trim() && !(note.attachments || []).length) {
        if (!silent) showNotesStatus('标题、内容和附件不能同时为空', 'error');
        return;
    }

    try {
        const saved = await invoke('notes_save', {
            input: {
                id: note.isDraft ? null : note.id,
                title: note.title,
                content: note.content,
                tags: note.tags || [],
                attachments: note.attachments || [],
                reminder_at: note.reminder_at || null,
                reminder_done: !!note.reminder_done,
                pinned: !!note.pinned,
                archived: !!note.archived,
            }
        });
        const idx = notesState.notes.findIndex(item => item.id === note.id);
        if (idx >= 0) notesState.notes[idx] = saved;
        notesState.activeId = saved.id;
        sortNotesInMemory();
        renderNotesList();
        if (silent) {
            refreshActiveNoteChrome(saved);
        } else {
            openActiveNote();
        }
        showNotesStatus(silent ? '已自动保存' : '已保存', 'success');
    } catch (e) {
        showNotesStatus('保存失败: ' + e, 'error');
    }
}

function refreshActiveNoteChrome(note) {
    document.getElementById('note-pin-btn').textContent = note.pinned ? '取消置顶' : '置顶';
    document.getElementById('note-archive-btn').textContent = note.archived ? '移出归档' : '归档';
    document.getElementById('note-meta').textContent = formatNoteMeta(note);
    if (shouldRenderNotesPreview()) renderNotesPreview();
}

function sortNotesInMemory() {
    notesState.notes.sort((a, b) => {
        if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1;
        return (b.updated_at || 0) - (a.updated_at || 0);
    });
}

function renderNotesList() {
    const list = document.getElementById('notes-list');
    if (!list) return;
    const query = (document.getElementById('notes-search')?.value || '').trim().toLowerCase();
    const notes = notesState.notes.filter(note => {
        if (!!note.archived !== notesState.showArchived) return false;
        if (notesState.tagFilter && !(note.tags || []).some(tag => tag.toLowerCase() === notesState.tagFilter)) return false;
        if (!query) return true;
        const attachmentNames = (note.attachments || []).map(file => file.name || '');
        const haystack = [note.title, note.content, ...(note.tags || []), ...attachmentNames].join('\n').toLowerCase();
        return haystack.includes(query);
    });

    renderNotesTagFilter();
    renderNotesOverview(notes, query);
    document.getElementById('notes-archive-toggle').textContent = notesState.showArchived ? '进行中' : '归档';

    if (!notes.length) {
        const emptyText = query || notesState.tagFilter
            ? '没有匹配的笔记'
            : (notesState.showArchived ? '暂无归档笔记' : '暂无笔记');
        list.innerHTML = `
            <div class="notes-empty-list">
                <div>${emptyText}</div>
                ${notesState.showArchived ? '' : '<button class="btn btn-primary btn-sm" onclick="createNote()">新建笔记</button>'}
            </div>`;
        return;
    }

    list.innerHTML = notes.map(note => {
        const title = escapeHtml(note.title || '未命名笔记');
        const snippet = escapeHtml((note.content || '').replace(/\s+/g, ' ').trim() || '空白内容');
        const tags = (note.tags || []).map(tag => `<span class="notes-list-tag">#${escapeHtml(tag)}</span>`).join('');
        const badges = renderNoteListBadges(note);
        return `
            <div class="notes-list-item ${note.id === notesState.activeId ? 'active' : ''}" onclick="openNote('${escapeHtmlAttr(note.id)}')">
                <div class="notes-list-title-row">
                    <div class="notes-list-title">${title}</div>
                    ${note.pinned ? '<span class="notes-list-pin">置顶</span>' : ''}
                </div>
                <div class="notes-list-snippet">${snippet}</div>
                ${tags ? `<div class="notes-list-tags">${tags}</div>` : ''}
                <div class="notes-list-foot">
                    <span>${formatRelativeNoteTime(note.updated_at)}</span>
                    <span class="notes-list-badges">${badges}</span>
                </div>
            </div>
        `;
    }).join('');
}

function renderNotesOverview(visibleNotes, query) {
    const stats = document.getElementById('notes-page-stats');
    const summary = document.getElementById('notes-filter-summary');
    const activeNotes = notesState.notes.filter(note => !note.archived);
    const archivedNotes = notesState.notes.filter(note => note.archived);
    const pinnedCount = activeNotes.filter(note => note.pinned).length;
    const dueCount = activeNotes.filter(note => note.reminder_at && !note.reminder_done).length;
    if (stats) {
        stats.innerHTML = `
            <span>${activeNotes.length} 条进行中</span>
            <span>${archivedNotes.length} 条归档</span>
            ${pinnedCount ? `<span>${pinnedCount} 条置顶</span>` : ''}
            ${dueCount ? `<span>${dueCount} 个提醒</span>` : ''}
        `;
    }
    if (!summary) return;
    const parts = [];
    parts.push(notesState.showArchived ? '归档视图' : '进行中');
    if (query) parts.push(`搜索 "${escapeHtml(query)}"`);
    if (notesState.tagFilter) parts.push(`#${escapeHtml(notesState.tagFilter)}`);
    parts.push(`${visibleNotes.length} 条结果`);
    summary.innerHTML = parts.join(' · ');
}

function renderNoteListBadges(note) {
    const badges = [];
    if (note.reminder_at && !note.reminder_done) {
        badges.push(`<span class="notes-list-badge">${escapeHtml(formatNoteDate(note.reminder_at))}</span>`);
    }
    const attachmentCount = (note.attachments || []).length;
    if (attachmentCount) {
        badges.push(`<span class="notes-list-badge">${attachmentCount} 附件</span>`);
    }
    return badges.join('');
}

function renderNotesTagFilter() {
    const container = document.getElementById('notes-tag-filter');
    if (!container) return;
    const tags = [...new Set(notesState.notes.flatMap(note => note.tags || []).map(tag => tag.trim()).filter(Boolean))]
        .sort((a, b) => a.localeCompare(b));
    if (!tags.length) {
        container.innerHTML = '';
        return;
    }
    container.innerHTML = tags.map(tag => {
        const key = tag.toLowerCase();
        return `<button class="notes-tag-chip ${notesState.tagFilter === key ? 'active' : ''}" onclick="setNotesTagFilter('${escapeHtmlAttr(key)}')">#${escapeHtml(tag)}</button>`;
    }).join('');
}

function setNotesTagFilter(tag) {
    notesState.tagFilter = notesState.tagFilter === tag ? '' : tag;
    renderNotesList();
}

function toggleNotesArchiveView() {
    flushNoteDraftFromInputs();
    notesState.showArchived = !notesState.showArchived;
    const visible = notesState.notes.filter(note => !!note.archived === notesState.showArchived);
    notesState.activeId = visible[0]?.id || null;
    renderNotesList();
    openActiveNote();
}

async function toggleNotePinned() {
    const note = getActiveNote();
    if (!note) return;
    note.pinned = !note.pinned;
    await saveCurrentNote(true);
}

async function archiveCurrentNote() {
    const note = getActiveNote();
    if (!note) return;
    if (note.isDraft) {
        note.archived = !note.archived;
        openActiveNote();
        renderNotesList();
        return;
    }
    try {
        const saved = await invoke('notes_set_archived', { id: note.id, archived: !note.archived });
        const idx = notesState.notes.findIndex(item => item.id === note.id);
        if (idx >= 0) notesState.notes[idx] = saved;
        notesState.activeId = null;
        const visible = notesState.notes.filter(item => !!item.archived === notesState.showArchived);
        notesState.activeId = visible[0]?.id || null;
        renderNotesList();
        openActiveNote();
        showNotesStatus(saved.archived ? '已归档' : '已移出归档', 'success');
    } catch (e) {
        showNotesStatus('操作失败: ' + e, 'error');
    }
}

async function deleteCurrentNote() {
    const note = getActiveNote();
    if (!note) return;
    if (!confirm('确定删除这条笔记？')) return;
    if (!note.isDraft) {
        try {
            await invoke('notes_delete', { id: note.id });
        } catch (e) {
            showNotesStatus('删除失败: ' + e, 'error');
            return;
        }
    }
    notesState.notes = notesState.notes.filter(item => item.id !== note.id);
    const visible = notesState.notes.filter(item => !!item.archived === notesState.showArchived);
    notesState.activeId = visible[0]?.id || null;
    renderNotesList();
    openActiveNote();
    showNotesStatus('已删除', 'success');
}

async function copyNoteMarkdown() {
    const note = getActiveNote();
    if (!note) return;
    flushNoteDraftFromInputs();
    let markdown;
    if (note.isDraft) {
        markdown = `# ${note.title || 'Untitled Note'}\n\n${(note.tags || []).map(tag => '#' + tag).join(' ')}\n\n${note.content || ''}`;
    } else {
        markdown = await invoke('notes_export_markdown', { id: note.id });
    }
    copyToClipboard(markdown);
    showNotesStatus('Markdown 已复制', 'success');
}

function setNotesViewMode(mode) {
    if (!['edit', 'preview', 'split'].includes(mode)) return;
    flushNoteDraftFromInputs();
    notesState.viewMode = mode;
    applyNotesViewMode();
}

function shouldRenderNotesPreview() {
    return notesState.viewMode === 'preview' || notesState.viewMode === 'split';
}

function applyNotesViewMode() {
    const shell = document.getElementById('notes-view-shell');
    const editPane = document.getElementById('notes-edit-pane');
    const previewPane = document.getElementById('notes-preview-pane');
    if (!shell || !editPane || !previewPane) return;

    shell.classList.remove('mode-edit', 'mode-preview', 'mode-split');
    shell.classList.add('mode-' + notesState.viewMode);
    editPane.hidden = notesState.viewMode === 'preview';
    previewPane.hidden = notesState.viewMode === 'edit';

    document.querySelectorAll('.notes-view-btn').forEach(btn => btn.classList.remove('active'));
    document.getElementById('notes-view-' + notesState.viewMode)?.classList.add('active');

    if (shouldRenderNotesPreview()) renderNotesPreview();
    if (notesState.viewMode !== 'preview') refreshNotesEditor();
}

async function renderNotesPreview() {
    const preview = document.getElementById('notes-preview');
    const note = getActiveNote();
    if (!preview || !note) return;
    flushNoteDraftFromInputs();
    const media = prepareNoteMarkdownMedia(note.content || '', note.attachments || []);
    let html = '';
    try {
        const r = await invoke('markdown_to_html', { markdown: media.markdown });
        html = r.success ? r.result : simpleMarkdownToHtml(media.markdown);
    } catch (_) {
        html = simpleMarkdownToHtml(media.markdown);
    }
    html = applyNoteMediaTokens(html, media.tokens);
    const attachmentHtml = renderAttachmentsInlineForPreview(note, media.referencedIds);
    preview.innerHTML = html + attachmentHtml;
    bindNotesPreviewMedia(preview);
}

function buildAttachmentRefMap(attachments) {
    const map = new Map();
    for (const att of attachments) {
        [att.id, att.name, '/' + att.name].filter(Boolean).forEach(key => map.set(normalizeAttachmentRef(key), att));
    }
    return map;
}

function normalizeAttachmentRef(src) {
    let value = String(src || '').trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
    }
    value = value.split('#')[0].split('?')[0];
    try {
        value = decodeURIComponent(value);
    } catch (_) {}
    return value.replace(/^attachment:/, '').replace(/^\/+/, '').toLowerCase();
}

function prepareNoteMarkdownMedia(markdown, attachments) {
    const refMap = buildAttachmentRefMap(attachments);
    const tokens = new Map();
    const referencedIds = new Set();
    let index = 0;
    const makeToken = (att, label, forceImage) => {
        const token = `NOTE_MEDIA_TOKEN_${index++}`;
        tokens.set(token, renderAttachmentForPreview(att, label, forceImage, true));
        referencedIds.add(att.id);
        return token;
    };
    const output = replaceMarkdownAttachmentRefs(markdown, refMap, makeToken);
    return { markdown: output, tokens, referencedIds };
}

function replaceMarkdownAttachmentRefs(markdown, refMap, makeToken) {
    let output = '';
    let i = 0;
    while (i < markdown.length) {
        const isImage = markdown[i] === '!' && markdown[i + 1] === '[';
        const isLink = markdown[i] === '[';
        if (!isImage && !isLink) {
            output += markdown[i++];
            continue;
        }

        const labelStart = i + (isImage ? 2 : 1);
        const labelEnd = findMarkdownClosing(markdown, labelStart, '[', ']');
        if (labelEnd < 0 || markdown[labelEnd + 1] !== '(') {
            output += markdown[i++];
            continue;
        }

        const srcStart = labelEnd + 2;
        const srcEnd = findMarkdownClosing(markdown, srcStart, '(', ')');
        if (srcEnd < 0) {
            output += markdown[i++];
            continue;
        }

        const raw = markdown.slice(i, srcEnd + 1);
        const label = markdown.slice(labelStart, labelEnd);
        const src = markdown.slice(srcStart, srcEnd);
        const att = refMap.get(normalizeAttachmentRef(src));
        if (!att || (isImage && !(att.mime || '').startsWith('image/'))) {
            output += raw;
        } else {
            output += makeToken(att, unescapeMarkdownLinkText(label) || att.name, isImage);
        }
        i = srcEnd + 1;
    }
    return output;
}

function findMarkdownClosing(text, start, openChar, closeChar) {
    let depth = 0;
    for (let i = start; i < text.length; i++) {
        if (text[i] === '\\') {
            i++;
            continue;
        }
        if (text[i] === openChar) depth++;
        if (text[i] === closeChar) {
            if (depth === 0) return i;
            depth--;
        }
    }
    return -1;
}

function applyNoteMediaTokens(html, tokens) {
    let output = html;
    tokens.forEach((mediaHtml, token) => {
        const escapedToken = escapeRegExp(token);
        output = output
            .replace(new RegExp(`<p>\\s*${escapedToken}\\s*</p>`, 'g'), mediaHtml)
            .replace(new RegExp(escapedToken, 'g'), mediaHtml);
    });
    return output;
}

function escapeRegExp(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function renderAttachmentForPreview(att, label, forceImage = false, inline = false) {
    const src = escapeHtmlAttr(att.data_url || '');
    const mime = att.mime || '';
    const name = escapeHtml(label || att.name || '附件');
    const title = escapeHtmlAttr(att.name || label || '附件');
    const inlineClass = inline ? ' notes-preview-inline-media' : '';
    if (!src) return `<span class="notes-preview-file${inlineClass}">${name}</span>`;
    if (forceImage || mime.startsWith('image/')) {
        return `<img class="notes-preview-image${inlineClass}" src="${src}" alt="${title}" data-title="${title}">`;
    }
    if (mime.startsWith('audio/')) {
        return inline
            ? `<audio src="${src}" controls class="notes-preview-audio${inlineClass}" title="${title}"></audio>`
            : `<div class="notes-preview-file-label">${name}</div><audio src="${src}" controls class="notes-preview-audio"></audio>`;
    }
    if (mime.startsWith('video/')) {
        return inline
            ? `<video src="${src}" controls class="notes-preview-video${inlineClass}" title="${title}"></video>`
            : `<div class="notes-preview-file-label">${name}</div><video src="${src}" controls class="notes-preview-video"></video>`;
    }
    return `<a class="notes-preview-file${inlineClass}" href="${src}" download="${title}">${name}</a>`;
}

function renderAttachmentsInlineForPreview(note, referencedIds) {
    const attachments = note.attachments || [];
    if (!attachments.length) return '';
    const unreferenced = attachments.filter(att => !referencedIds.has(att.id));
    if (!unreferenced.length) return '';
    let html = '<div class="notes-preview-media"><h3>附件</h3>';
    for (const att of unreferenced) {
        html += renderAttachmentForPreview(att);
    }
    html += '</div>';
    return html;
}

function bindNotesPreviewMedia(preview) {
    preview.querySelectorAll('.notes-preview-image').forEach(img => {
        img.addEventListener('click', () => showImageLightbox(img.src, img.dataset.title || img.alt || ''));
    });
}

function parseReminderInput() {
    const value = document.getElementById('note-reminder-at')?.value;
    if (!value) return null;
    const time = new Date(value).getTime();
    return Number.isNaN(time) ? null : time;
}

function toDatetimeLocalValue(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    const pad = n => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function clearNoteReminder() {
    const note = getActiveNote();
    if (!note) return;
    document.getElementById('note-reminder-at').value = '';
    note.reminder_at = null;
    note.reminder_done = true;
    scheduleNoteAutosave();
}

async function handleNoteAttachments(event) {
    const note = getActiveNote();
    if (!note) return;
    const files = Array.from(event.target.files || []);
    if (!files.length) return;
    note.attachments = note.attachments || [];
    const added = [];
    for (const file of files) {
        if (file.size > 12 * 1024 * 1024) {
            showNotesStatus(`${file.name} 超过 12MB，已跳过`, 'error');
            continue;
        }
        const dataUrl = await readFileAsDataUrl(file);
        const att = {
            id: 'att-' + Date.now() + '-' + Math.random().toString(16).slice(2),
            name: file.name,
            mime: file.type || 'application/octet-stream',
            data_url: dataUrl,
            size: file.size,
            added_at: Date.now(),
        };
        note.attachments.push(att);
        added.push(att);
    }
    event.target.value = '';
    insertAttachmentRefsAtCursor(added);
    renderNoteAttachments();
    if (shouldRenderNotesPreview()) renderNotesPreview();
    scheduleNoteAutosave();
}

function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(file);
    });
}

function renderNoteAttachments() {
    const container = document.getElementById('notes-attachments');
    const note = getActiveNote();
    if (!container || !note) return;
    const attachments = note.attachments || [];
    if (!attachments.length) {
        container.innerHTML = `
            <div class="notes-attachment-empty">
                <div>暂无附件</div>
                <span>可拖入截图、录音、视频或文档，预览时会直接显示。</span>
            </div>`;
        return;
    }
    container.innerHTML = attachments.map(att => `
        <div class="notes-attachment">
            <div class="notes-attachment-preview">${renderAttachmentPreview(att)}</div>
            <div class="notes-attachment-info">
                <div class="notes-attachment-name" title="${escapeHtmlAttr(att.name)}">${escapeHtml(att.name)}</div>
                <div class="notes-attachment-meta">${escapeHtml(att.mime || 'file')} · ${formatBytes(att.size || 0)}</div>
            </div>
            <div class="notes-attachment-actions">
                <button class="btn btn-ghost" onclick="copyAttachmentDataUrl('${escapeHtmlAttr(att.id)}')">复制</button>
                <button class="btn btn-danger" onclick="removeNoteAttachment('${escapeHtmlAttr(att.id)}')">移除</button>
            </div>
        </div>
    `).join('');
}

function renderAttachmentPreview(att) {
    const src = escapeHtmlAttr(att.data_url || '');
    const mime = att.mime || '';
    if (mime.startsWith('image/')) return `<img src="${src}" alt="${escapeHtmlAttr(att.name)}" onclick="openAttachmentInPreview('${escapeHtmlAttr(att.id)}')">`;
    if (mime.startsWith('audio/')) return `<audio src="${src}" controls></audio>`;
    if (mime.startsWith('video/')) return `<video src="${src}" controls></video>`;
    return '<div class="notes-attachment-file">FILE</div>';
}

function insertAttachmentRefsAtCursor(attachments) {
    if (!attachments.length || !editors.noteContent) return;
    const editor = editors.noteContent;
    const cursor = editor.getCursor();
    const refs = formatInlineAttachmentRefs(editor, cursor, attachments);
    editor.replaceRange(refs, cursor);
    editor.focus();
}

function formatInlineAttachmentRefs(editor, cursor, attachments) {
    const line = editor.getLine(cursor.line) || '';
    const before = line.slice(0, cursor.ch);
    const after = line.slice(cursor.ch);
    const refs = attachments.map(formatAttachmentMarkdown).join(' ');
    const leading = before && !/\s$/.test(before) ? ' ' : '';
    const trailing = after && !/^\s/.test(after) ? ' ' : '';
    return leading + refs + trailing;
}

function removeNoteAttachment(id) {
    const note = getActiveNote();
    if (!note) return;
    note.attachments = (note.attachments || []).filter(att => att.id !== id);
    renderNoteAttachments();
    if (shouldRenderNotesPreview()) renderNotesPreview();
    scheduleNoteAutosave();
}

function copyAttachmentDataUrl(id) {
    const note = getActiveNote();
    const att = note?.attachments?.find(item => item.id === id);
    if (!att) return;
    copyToClipboard(att.data_url);
    showNotesStatus('附件 Data URL 已复制', 'success');
}

function checkDueNoteReminders() {
    const now = Date.now();
    notesState.notes
        .filter(note => note.reminder_at && !note.reminder_done && !note.archived && note.reminder_at <= now)
        .forEach(note => fireNoteReminder(note));
}

async function fireNoteReminder(note) {
    note.reminder_done = true;
    const title = note.title || '笔记提醒';
    const body = (note.content || '').replace(/\s+/g, ' ').trim().slice(0, 140);
    if ('Notification' in window && Notification.permission === 'granted') {
        const notification = new Notification(title, { body: body || '到达提醒时间' });
        notification.onclick = () => {
            window.focus();
            openNotesReminderTarget(note.id);
        };
    } else {
        alert(`${title}\n\n${body || '到达提醒时间'}`);
    }
    try {
        const saved = await invoke('notes_mark_reminder_done', { id: note.id });
        const idx = notesState.notes.findIndex(item => item.id === note.id);
        if (idx >= 0) notesState.notes[idx] = saved;
        renderNotesList();
        if (notesState.activeId === note.id) openActiveNote();
    } catch (_) {}
}

function openNotesReminderTarget(id) {
    const nav = document.querySelector('.nav-item[data-page="notes"]');
    nav?.click();
    setTimeout(() => openNote(id), 100);
}

function formatNoteMeta(note) {
    const reminder = note.reminder_at
        ? ` · 提醒 ${formatNoteDate(note.reminder_at)}${note.reminder_done ? '（已触发）' : ''}`
        : '';
    const media = (note.attachments || []).length ? ` · ${(note.attachments || []).length} 个附件` : '';
    return `创建 ${formatNoteDate(note.created_at)} · 更新 ${formatNoteDate(note.updated_at)}${reminder}${media}`;
}

function formatNoteDate(value) {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleString();
}

function formatRelativeNoteTime(value) {
    if (!value) return '';
    const date = new Date(value);
    const time = date.getTime();
    if (Number.isNaN(time)) return '';
    const diff = Date.now() - time;
    const minute = 60 * 1000;
    const hour = 60 * minute;
    const day = 24 * hour;
    if (diff < minute) return '刚刚更新';
    if (diff < hour) return `${Math.floor(diff / minute)} 分钟前`;
    if (diff < day) return `${Math.floor(diff / hour)} 小时前`;
    if (diff < 7 * day) return `${Math.floor(diff / day)} 天前`;
    return date.toLocaleDateString();
}

function showNotesStatus(message, type = 'info') {
    const el = document.getElementById('notes-status');
    if (!el) return;
    el.textContent = message;
    el.className = 'status-msg notes-status ' + type;
    clearTimeout(showNotesStatus.timer);
    showNotesStatus.timer = setTimeout(() => {
        el.textContent = '';
        el.className = 'status-msg notes-status';
    }, 2200);
}

// ==================== Fullscreen ====================

function toggleNotesFullscreen() {
    const note = getActiveNote();
    if (!note || !note.attachments?.length) {
        showNotesStatus('没有附件可全屏查看', 'error');
        return;
    }
    const images = note.attachments.filter(a => a.mime.startsWith('image/'));
    if (!images.length) {
        showNotesStatus('没有图片附件', 'error');
        return;
    }
    showImageLightbox(images[0].data_url, images[0].name);
}

// ==================== Drag & Drop ====================

function setupNotesDropzone() {
    const editorEl = document.getElementById('note-content-editor');
    const panel = document.querySelector('.notes-editor-panel');
    if (!editorEl || !panel) return;

    const dropZone = document.createElement('div');
    dropZone.id = 'notes-dropzone';
    dropZone.className = 'notes-dropzone';
    editorEl.parentNode.insertBefore(dropZone, editorEl.nextSibling);

    let dragCounter = 0;

    panel.addEventListener('dragenter', (e) => {
        e.preventDefault();
        dragCounter++;
        dropZone.classList.add('active');
    });

    panel.addEventListener('dragleave', (e) => {
        e.preventDefault();
        dragCounter--;
        if (dragCounter <= 0) {
            dragCounter = 0;
            dropZone.classList.remove('active');
        }
    });

    panel.addEventListener('dragover', (e) => {
        e.preventDefault();
    });

    panel.addEventListener('drop', async (e) => {
        e.preventDefault();
        dragCounter = 0;
        dropZone.classList.remove('active');
        const items = e.dataTransfer?.items;
        const files = [];
        if (items) {
            for (let i = 0; i < items.length; i++) {
                const entry = items[i].webkitGetAsEntry?.();
                if (entry) {
                    const f = await readFileFromEntry(entry);
                    if (f) files.push(f);
                }
            }
        }
        if (!files.length) {
            files.push(...Array.from(e.dataTransfer?.files || []));
        }
        if (files.length) {
            await processDroppedFiles(files);
        }
    });
}

function readFileFromEntry(entry) {
    return new Promise((resolve) => {
        if (entry.isFile) {
            entry.file(resolve, () => resolve(null));
        } else {
            resolve(null);
        }
    });
}

async function processDroppedFiles(files) {
    const note = getActiveNote();
    if (!note) return;
    note.attachments = note.attachments || [];
    const added = [];
    for (const file of files) {
        if (file.size > 12 * 1024 * 1024) {
            showNotesStatus(`${file.name} 超过 12MB，已跳过`, 'error');
            continue;
        }
        const dataUrl = await readFileAsDataUrl(file);
        const att = {
            id: 'att-' + Date.now() + '-' + Math.random().toString(16).slice(2),
            name: file.name,
            mime: file.type || 'application/octet-stream',
            data_url: dataUrl,
            size: file.size,
            added_at: Date.now(),
        };
        note.attachments.push(att);
        added.push(att);
    }
    insertAttachmentRefsAtCursor(added);
    renderNoteAttachments();
    if (shouldRenderNotesPreview()) renderNotesPreview();
    scheduleNoteAutosave();
    showNotesStatus(`已添加 ${added.length} 个附件`, 'success');
}

// ==================== Image Toolbar ====================

function insertImageIntoNote() {
    const note = getActiveNote();
    if (!note) return;
    // Trigger file picker
    document.getElementById('note-attachment-input')?.click();
}

function insertMarkdownImage() {
    const note = getActiveNote();
    if (!note) return;
    const editor = editors.noteContent;
    if (!editor) return;
    const cursorPos = editor.getCursor();
    const imgMd = '![](https://example.com/image.png)';
    editor.replaceRange(imgMd, cursorPos);
    editor.setCursor({ line: cursorPos.line, ch: cursorPos.ch + imgMd.length - 22 });
    editor.focus();
}

function insertAttachmentMarkdown() {
    const note = getActiveNote();
    if (!note || !note.attachments?.length) {
        showNotesStatus('没有可插入的附件，请先添加附件', 'error');
        return;
    }
    const editor = editors.noteContent;
    if (!editor) return;
    const cursorPos = editor.getCursor();
    const attachments = note.attachments || [];
    if (attachments.length === 1) {
        editor.replaceRange(formatInlineAttachmentRefs(editor, cursorPos, [attachments[0]]), cursorPos);
        showNotesStatus('已插入附件引用', 'success');
        return;
    }
    const menuId = 'notes-img-menu';
    const existing = document.getElementById(menuId);
    if (existing) existing.remove();
    const menu = document.createElement('div');
    menu.id = menuId;
    menu.className = 'notes-img-menu';
    const titleEl = document.createElement('div');
    titleEl.className = 'notes-img-menu-title';
    titleEl.textContent = '选择要插入的附件：';
    menu.appendChild(titleEl);
    attachments.forEach(function(att) {
        var item = document.createElement('div');
        item.className = 'notes-img-menu-item';
        item.setAttribute('data-id', att.id);
        if ((att.mime || '').startsWith('image/')) {
            var imgEl = document.createElement('img');
            imgEl.src = att.data_url;
            imgEl.alt = att.name;
            item.appendChild(imgEl);
        } else {
            var fileEl = document.createElement('div');
            fileEl.className = 'notes-img-menu-file';
            fileEl.textContent = getAttachmentIcon(att);
            item.appendChild(fileEl);
        }
        var span = document.createElement('span');
        span.textContent = att.name;
        item.appendChild(span);
        item.addEventListener('click', function() { selectAttachmentToInsert(att.id); });
        menu.appendChild(item);
    });
    menu.style.position = 'absolute';
    menu.style.zIndex = '9999';
    menu.style.top = '50%';
    menu.style.left = '50%';
    menu.style.transform = 'translate(-50%, -50%)';
    document.body.appendChild(menu);
    var closer = function(e) {
        if (e.target === menu) { menu.remove(); document.removeEventListener('click', closer); }
    };
    setTimeout(function() { document.addEventListener('click', closer); }, 0);
}

function selectAttachmentToInsert(attId) {
    const note = getActiveNote();
    const att = note?.attachments?.find(a => a.id === attId);
    if (!att) return;
    const editor = editors.noteContent;
    const cursorPos = editor.getCursor();
    editor.replaceRange(formatInlineAttachmentRefs(editor, cursorPos, [att]), cursorPos);
    const menu = document.getElementById('notes-img-menu');
    if (menu) menu.remove();
    showNotesStatus('已插入附件引用', 'success');
}

function formatAttachmentMarkdown(att) {
    const ref = '/' + encodeAttachmentRef(att.name);
    const label = escapeMarkdownLinkText(att.name);
    if ((att.mime || '').startsWith('image/')) {
        return '![' + label + '](' + ref + ')';
    }
    return '[' + label + '](' + ref + ')';
}

function encodeAttachmentRef(name) {
    return encodeURIComponent(name).replace(/%2F/g, '/');
}

function escapeMarkdownLinkText(value) {
    return String(value || '').replace(/([\\\[\]])/g, '\\$1').replace(/\r?\n/g, ' ');
}

function unescapeMarkdownLinkText(value) {
    return String(value || '').replace(/\\([\\\[\]])/g, '$1');
}

function getAttachmentIcon(att) {
    const mime = att.mime || '';
    if (mime.startsWith('audio/')) return 'AUDIO';
    if (mime.startsWith('video/')) return 'VIDEO';
    if (mime === 'application/pdf') return 'PDF';
    return 'FILE';
}



function openAttachmentInPreview(attId) {
    const note = getActiveNote();
    const att = note?.attachments?.find(a => a.id === attId);
    if (!att || !att.data_url) return;
    const mime = att.mime || '';
    if (mime.startsWith('image/')) {
        showImageLightbox(att.data_url, att.name);
    }
}

function showImageLightbox(src, title) {
    const existing = document.getElementById('notes-lightbox');
    if (existing) existing.remove();
    const lightbox = document.createElement('div');
    lightbox.id = 'notes-lightbox';
    lightbox.className = 'notes-lightbox';
    lightbox.innerHTML = `
        <div class="notes-lightbox-content">
            <img src="${escapeHtmlAttr(src)}" alt="${escapeHtmlAttr(title || '')}">
            <button class="notes-lightbox-close" onclick="this.closest('.notes-lightbox').remove()">✕</button>
        </div>`;
    lightbox.addEventListener('click', (e) => {
        if (e.target === lightbox) lightbox.remove();
    });
    document.body.appendChild(lightbox);
}
