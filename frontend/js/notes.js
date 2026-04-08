// ═══════════════════════════════════════════════════════════════════════════
// PAGE 3 — NOTES
// ═══════════════════════════════════════════════════════════════════════════

const notes = {
  list: [],
  current: null,
  dirty: false,
  mentionTargets: [],
  experimentToSample: {},
  typeFilter: 'all',
  tagFilter: null,
};
let _editTags = [];
let _notesLoaded  = false;
let _noteSaveTimer = null;

const EXP_TYPE_LABEL = {
  "ppms-vsm": "PPMS-VSM",
  "ppms-hc":  "PPMS-HC",
  pxrd:       "PXRD",
  sxrd:       "SXRD",
  microscopy: "Microscopy",
};

async function notesInit() {
  _notesLoaded = true;
  await notesBuildMentionTargets();
  await notesLoadList();
}

async function notesBuildMentionTargets() {
  const samples  = await api("/api/samples").catch(() => []);
  const allNotes = await api("/api/notes").catch(() => []);

  const sampleTargets = samples.map((s) => ({
    kind: "sample", id: s.id, label: s.name, hint: s.compound || "",
    search: `${s.name} ${s.compound || ""}`.toLowerCase(),
  }));

  const expTargets = [];
  notes.experimentToSample = {};
  const details = await Promise.all(samples.map((s) => api(`/api/samples/${s.id}`).catch(() => null)));
  details.forEach((detail) => {
    if (!detail?.experiments) return;
    detail.experiments.forEach((exp) => {
      notes.experimentToSample[exp.id] = detail.id;
      const expLabel = `${detail.name} / ${EXP_TYPE_LABEL[exp.type] || exp.type.toUpperCase()}${exp.exp_date ? ` (${exp.exp_date})` : ""}`;
      expTargets.push({
        kind: "experiment", id: exp.id, label: expLabel, hint: "measurement",
        search: `${detail.name} ${exp.type} ${exp.exp_date || ""}`.toLowerCase(),
      });
    });
  });

  const noteTargets = allNotes.map((n) => ({
    kind: "note", id: n.id, label: n.title || `Untitled #${n.id}`, hint: "note",
    search: `${n.title || ""} ${n.body || ""}`.toLowerCase(),
  }));

  notes.mentionTargets = [...sampleTargets, ...expTargets, ...noteTargets];
}

async function notesLoadList(q = "") {
  const params = new URLSearchParams();
  if (q) params.set("q", q);
  if (notes.typeFilter && notes.typeFilter !== 'all') params.set("note_type", notes.typeFilter);
  if (notes.tagFilter) params.set("tag", notes.tagFilter);
  const qs = params.toString() ? "?" + params.toString() : "";
  notes.list = await api("/api/notes" + qs).catch(() => []);
  notesRenderList();
  notesRenderTagFilter();
}

function notesSetTypeFilter(type) {
  notes.typeFilter = type;
  document.querySelectorAll('.notes-type-pill').forEach(p => {
    p.classList.toggle('active', p.dataset.type === type);
  });
  notesLoadList(document.getElementById("notes-search-input").value.trim());
}

function notesRenderTagFilter() {
  // Collect all unique tags across the full unfiltered list.
  // We re-fetch without the tag filter to build the tag cloud.
  const el = document.getElementById("notes-tag-filter");
  if (!el) return;
  const params = new URLSearchParams();
  if (notes.typeFilter && notes.typeFilter !== 'all') params.set("note_type", notes.typeFilter);
  const q = document.getElementById("notes-search-input").value.trim();
  if (q) params.set("q", q);
  const qs = params.toString() ? "?" + params.toString() : "";
  api("/api/notes" + qs).then(allNotes => {
    const tagSet = new Set();
    allNotes.forEach(n => {
      try { (JSON.parse(n.tags || "[]")).forEach(t => tagSet.add(t)); } catch {}
    });
    const tags = Array.from(tagSet).sort();
    if (!tags.length) { el.style.display = "none"; return; }
    el.style.display = "flex";
    el.innerHTML =
      `<div class="notes-tag-pill${!notes.tagFilter ? " active" : ""}" onclick="notesSetTagFilter(null)">All tags</div>` +
      tags.map(t =>
        `<div class="notes-tag-pill${notes.tagFilter === t ? " active" : ""}" onclick="notesSetTagFilter(${JSON.stringify(t)})">${esc(t)}</div>`
      ).join("");
  }).catch(() => { el.style.display = "none"; });
}

function notesSetTagFilter(tag) {
  notes.tagFilter = tag;
  notesLoadList(document.getElementById("notes-search-input").value.trim());
}

function notesRenderList() {
  const list = document.getElementById("notes-list");
  if (!notes.list.length) {
    list.innerHTML = '<div class="placeholder" style="padding:20px;text-align:center;color:var(--fg-muted);">No notes yet</div>';
    return;
  }
  list.innerHTML = notes.list.map((n) => {
    const isLog = n.note_type === 'daily_log';
    const typeClass = isLog ? 'log' : 'disc';
    const typeLabel = isLog ? 'LOG' : 'DISC';
    let tagChips = "";
    if (!isLog) {
      try {
        const tags = JSON.parse(n.tags || "[]");
        if (tags.length) {
          const shown = tags.slice(0, 3).map(t =>
            `<span class="n-tag-chip${notes.tagFilter === t ? " active" : ""}" onclick="event.stopPropagation();notesSetTagFilter(${notes.tagFilter === t ? 'null' : JSON.stringify(t)})">${esc(t)}</span>`
          ).join("");
          const more = tags.length > 3 ? `<span class="n-tag-more">+${tags.length - 3}</span>` : "";
          tagChips = `<div class="n-tags">${shown}${more}</div>`;
        }
      } catch {}
    }
    return `
    <div class="note-item${notes.current && notes.current.id === n.id ? " active" : ""}" onclick="notesSelect(${n.id})">
      <div class="n-title-row">
        <div class="n-title">${esc(n.title) || '<em style="color:var(--fg-muted)">Untitled</em>'}</div>
        <span class="n-type-badge ${typeClass}">${typeLabel}</span>
        ${n.pinned ? '<span class="n-pin">PIN</span>' : ""}
      </div>
      <div class="n-date">${fmtDate(n.updated_at)}</div>
      ${tagChips}
      <div class="n-preview">${esc(notesStripMentions(n.body).slice(0, 80))}</div>
    </div>`;
  }).join("");
}

function notesStripMentions(body) {
  return (body || "").replace(/@\[([^\]]+)\]\([^)]+\)/g, "@$1").replace(/@(\S+)/g, "@$1");
}

async function notesSelect(id) {
  if (notes.dirty && !confirm("Discard unsaved changes?")) return;
  notes.current = await api(`/api/notes/${id}`);
  notes.dirty = false;
  notesRenderEditor();
  notesRenderList();
}

function notesRenderEditor() {
  const n = notes.current;
  document.getElementById("notes-placeholder").style.display  = "none";
  document.getElementById("notes-editor-wrap").style.display  = "flex";
  document.getElementById("note-title-input").value           = n.title || "";
  document.getElementById("note-body").value                  = n.body  || "";
  document.getElementById("note-pin-btn").textContent         = n.pinned ? "Unpin" : "Pin";
  document.getElementById("note-save-status").textContent     = "";

  const type = n.note_type || 'discussion';
  document.getElementById("note-meta-discussion").style.display = type === 'discussion' ? "" : "none";
  document.getElementById("note-meta-daily-log").style.display  = type === 'daily_log'  ? "" : "none";

  if (type === 'discussion') {
    try { _editTags = n.tags ? JSON.parse(n.tags) : []; } catch { _editTags = []; }
    tagsRender();
    document.getElementById("note-status-select").value = n.status || 'draft';
  } else if (type === 'daily_log') {
    document.getElementById("note-log-date").value = n.log_date || '';
    document.getElementById("note-next-steps").value = n.next_steps || '';
  }

  noteSetTab(auth.authenticated ? "edit" : "preview");
}

function _noteCollectPayload() {
  const type   = (notes.current && notes.current.note_type) || 'discussion';
  const title  = document.getElementById("note-title-input").value.trim() || "Untitled";
  const body   = document.getElementById("note-body").value;
  const pinned = notes.current ? notes.current.pinned : false;
  const payload = { title, body, pinned, note_type: type };

  if (type === 'discussion') {
    // Flush any pending text in the tag input
    const pendingText = document.getElementById("note-tags-text").value.trim();
    if (pendingText) { tagsAdd(pendingText); document.getElementById("note-tags-text").value = ""; }
    payload.tags = JSON.stringify(_editTags);
    payload.status = document.getElementById("note-status-select").value;
  } else if (type === 'daily_log') {
    payload.log_date = document.getElementById("note-log-date").value || "";
    payload.next_steps = document.getElementById("note-next-steps").value.trim();
  }
  return payload;
}

async function noteTogglePin() {
  if (!ensureWriteAuth()) return;
  if (!notes.current) return;
  clearTimeout(_noteSaveTimer);
  const payload = _noteCollectPayload();
  payload.pinned = !notes.current.pinned;
  try {
    const updated = await api(`/api/notes/${notes.current.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    notes.current = updated;
    notes.dirty   = false;
    document.getElementById("note-save-status").textContent = payload.pinned ? "Pinned" : "Unpinned";
    await notesLoadList(document.getElementById("notes-search-input").value.trim());
    notesRenderEditor();
  } catch (e) {
    document.getElementById("note-save-status").textContent = "Pin failed";
  }
}

async function createNewNote(type = 'discussion') {
  if (!ensureWriteAuth()) return;
  if (notes.dirty && !confirm("Discard unsaved changes?")) return;
  const today = new Date().toISOString().slice(0, 10);
  const body = type === 'daily_log'
    ? "## What was done\n\n\n## Observations / Surprises\n\n\n## Issues\n\n"
    : "";
  const payload = {
    title: type === 'daily_log' ? `Log ${today}` : "New note",
    body,
    note_type: type,
    ...(type === 'daily_log' ? { log_date: today } : {}),
  };
  const n = await api("/api/notes", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  notes.list.unshift(n);
  notes.current = n;
  notes.dirty   = false;
  notesRenderList();
  notesRenderEditor();
  await notesBuildMentionTargets();
  setTimeout(() => document.getElementById("note-title-input").focus(), 50);
}

async function uploadNoteFile(input) {
  if (!ensureWriteAuth()) return;
  if (!input.files || input.files.length === 0) return;

  // Filter to only .md files
  const mdFiles = Array.from(input.files).filter(f =>
    f.name.toLowerCase().endsWith('.md')
  );

  if (mdFiles.length === 0) {
    alert('No Markdown (.md) files selected.');
    input.value = '';
    return;
  }

  if (mdFiles.length === 1) {
    // Single file - existing behavior
    const file = mdFiles[0];
    try {
      const fd = new FormData();
      fd.append('file', file);

      const note = await api('/api/notes/upload', {
        method: 'POST',
        body: fd
      });

      notes.list.unshift(note);
      notes.current = note;
      notes.dirty = false;
      notesRenderList();
      notesRenderEditor();
      await notesBuildMentionTargets();

    } catch (e) {
      alert('Failed to upload note: ' + (e.message || 'Unknown error'));
    } finally {
      input.value = '';
    }
    return;
  }

  // Multiple files - upload sequentially
  let succeeded = 0;
  let failed = 0;
  let failedNames = [];

  for (const file of mdFiles) {
    try {
      const fd = new FormData();
      fd.append('file', file);

      const note = await api('/api/notes/upload', {
        method: 'POST',
        body: fd
      });

      notes.list.unshift(note);
      succeeded++;
    } catch (e) {
      failed++;
      failedNames.push(file.name);
    }
  }

  // After all uploads
  notesRenderList();
  await notesBuildMentionTargets();
  input.value = '';

  let msg = `Upload complete:\n${succeeded} succeeded${failed > 0 ? `\n${failed} failed:\n${failedNames.join('\n')}` : ''}`;
  alert(msg);
}

function noteMarkDirty() {
  notes.dirty = true;
  document.getElementById("note-save-status").textContent = "● unsaved";
  clearTimeout(_noteSaveTimer);
  _noteSaveTimer = setTimeout(noteSave, 2000);
}

async function noteSave() {
  if (!ensureWriteAuth()) return;
  if (!notes.current) return;
  clearTimeout(_noteSaveTimer);
  const payload = _noteCollectPayload();
  try {
    const updated = await api(`/api/notes/${notes.current.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    notes.current = updated;
    notes.dirty   = false;
    document.getElementById("note-save-status").textContent = "Saved";
    setTimeout(() => {
      if (document.getElementById("note-save-status").textContent === "Saved")
        document.getElementById("note-save-status").textContent = "";
    }, 2000);
    const idx = notes.list.findIndex((n) => n.id === updated.id);
    if (idx >= 0) notes.list[idx] = updated;
    else          notes.list.unshift(updated);
    notesRenderList();
    await notesBuildMentionTargets();
  } catch (e) {
    document.getElementById("note-save-status").textContent = "Save failed";
  }
}

async function deleteCurrentNote() {
  if (!ensureWriteAuth()) return;
  if (!notes.current) return;
  if (!confirm(`Delete "${notes.current.title}"?`)) return;
  clearTimeout(_noteSaveTimer);
  await api(`/api/notes/${notes.current.id}`, { method: "DELETE" });
  notes.list    = notes.list.filter((n) => n.id !== notes.current.id);
  notes.current = null;
  notes.dirty   = false;
  document.getElementById("notes-placeholder").style.display  = "flex";
  document.getElementById("notes-editor-wrap").style.display  = "none";
  notesRenderList();
  await notesBuildMentionTargets();
}

function downloadCurrentNote() {
  if (!notes.current) return;

  // Get current (possibly unsaved) content from the editor
  const title = document.getElementById("note-title-input").value.trim() || "Untitled";
  const body = document.getElementById("note-body").value;

  // Slugify for filename
  const slug = title.toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s-]+/g, '-')
    .slice(0, 50) || "untitled";

  const filename = `${slug}.md`;

  const n = notes.current;
  const note_type = n.note_type || 'discussion';
  const created_at = n.created_at || "";
  const updated_at = n.updated_at || "";

  let frontmatter = "---\n"
    + `id: ${n.id}\n`
    + `title: ${title}\n`
    + `note_type: ${note_type}\n`
    + `pinned: ${String(n.pinned).toLowerCase()}\n`
    + `created_at: ${created_at}\n`
    + `updated_at: ${updated_at}\n`;

  if (note_type === 'discussion') {
    frontmatter += `tags: ${JSON.stringify(_editTags)}\n`;
    frontmatter += `status: ${document.getElementById("note-status-select").value}\n`;
  } else if (note_type === 'daily_log') {
    frontmatter += `log_date: ${document.getElementById("note-log-date").value || ""}\n`;
    const nextSteps = document.getElementById("note-next-steps").value.trim();
    if (nextSteps) frontmatter += `next_steps: ${JSON.stringify(nextSteps)}\n`;
  }
  frontmatter += "---\n\n";

  const content = frontmatter + body;

  // Create download
  const blob = new Blob([content], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function notesApplySearch() {
  const q = document.getElementById("notes-search-input").value.trim();
  notesLoadList(q);
}

// ── Tag chip editor ───────────────────────────────────────────────────────

function tagsRender() {
  const container = document.getElementById("note-tags-chips");
  if (!container) return;
  container.innerHTML = _editTags.map((t, i) =>
    `<span class="edit-tag-chip">${esc(t)}<button class="tag-chip-rm" onclick="tagsRemove(${i})" tabindex="-1">×</button></span>`
  ).join("");
}

function tagsAdd(val) {
  const tag = val.trim().toLowerCase();
  if (!tag || _editTags.includes(tag)) return;
  _editTags.push(tag);
  tagsRender();
  noteMarkDirty();
}

function tagsRemove(idx) {
  _editTags.splice(idx, 1);
  tagsRender();
  noteMarkDirty();
}

function tagsHandleKey(e) {
  const input = document.getElementById("note-tags-text");
  if (e.key === "Enter" || e.key === ",") {
    e.preventDefault();
    tagsAdd(input.value);
    input.value = "";
  } else if (e.key === "Backspace" && !input.value && _editTags.length) {
    tagsRemove(_editTags.length - 1);
  }
}

function tagsHandleInput(e) {
  // Allow pasting comma-separated tags
  const input = document.getElementById("note-tags-text");
  if (input.value.includes(",")) {
    input.value.split(",").forEach(t => tagsAdd(t));
    input.value = "";
  }
}

// ── Tab switching ─────────────────────────────────────────────────────────

function noteSetTab(tab) {
  const editTab    = document.getElementById("note-tab-edit");
  const previewTab = document.getElementById("note-tab-preview");
  if (editTab)    editTab.classList.toggle("active",    tab === "edit");
  if (previewTab) previewTab.classList.toggle("active", tab === "preview");
  const body   = document.getElementById("note-body");
  const render = document.getElementById("note-render");
  if (tab === "edit") {
    body.style.display   = "";
    render.style.display = "none";
  } else {
    body.style.display   = "none";
    render.style.display = "block";
    render.innerHTML     = noteRenderBody(document.getElementById("note-body").value);
  }
}

function noteRenderBody(text) {
  if (!text) return '<p style="color:var(--fg-muted)">Nothing written yet.</p>';
  const chips = [];
  const ph    = (i) => `\x00CHIP${i}\x00`;
  let safe = text.replace(/@\[([^\]]+)\]\((sample|experiment|note):(\d+)\)/g, (_, label, kind, id) => {
    const i     = chips.length;
    const click = kind === "sample"     ? `mentionJumpSample(${id})`
                : kind === "experiment" ? `mentionJumpExperiment(${id})`
                :                        `mentionJumpNote(${id})`;
    chips.push(`<span class="mention-chip" onclick="${click}">@${esc(label)}</span>`);
    return ph(i);
  });
  let html = marked.parse(safe, { breaks: true, gfm: true });
  chips.forEach((chip, i) => { html = html.split(ph(i)).join(chip); });
  return html;
}

// ── Cross-tab mention jumps ───────────────────────────────────────────────

function mentionJumpSample(sampleId) {
  showPage("inventory");
  invSelectSample(sampleId);
}

async function mentionJumpExperiment(expId) {
  const sampleId = notes.experimentToSample[expId];
  if (!sampleId) return;
  showPage("inventory");
  await invSelectSample(sampleId);
  const el = document.getElementById(`meas-${expId}`);
  if (el) {
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.style.outline = "2px solid var(--accent)";
    setTimeout(() => { el.style.outline = ""; }, 1200);
  }
}

async function mentionJumpNote(noteId) {
  showPage("notes");
  if (!_notesLoaded) await notesInit();
  await notesSelect(noteId);
}

// ── @mention autocomplete ─────────────────────────────────────────────────

let _mentionStart = -1;

function parseMentionQuery(raw) {
  const trimmedLeft = raw.replace(/^\s+/, "");
  const m = trimmedLeft.match(/^([smnSMN])\s+(.*)$/);
  if (!m) return { kind: null, query: raw.trim().toLowerCase() };
  const key  = m[1].toLowerCase();
  const kind = key === "s" ? "sample" : key === "m" ? "experiment" : "note";
  return { kind, query: (m[2] || "").trim().toLowerCase() };
}

function noteHandleMention(e) {
  const ta   = document.getElementById("note-body");
  const pos  = ta.selectionStart;
  const text = ta.value;

  let atPos = -1;
  for (let i = pos - 1; i >= 0; i--) {
    if (text[i] === "@") { atPos = i; break; }
    if (text[i] === "\n") break;
  }
  if (atPos === -1) { mentionHide(); return; }

  _mentionStart = atPos;
  const raw     = text.slice(atPos + 1, pos);
  const { kind, query } = parseMentionQuery(raw);
  const matches = notes.mentionTargets
    .filter((t) => (!kind || t.kind === kind) && t.search.includes(query))
    .slice(0, 8);
  if (!matches.length) { mentionHide(); return; }

  const coords = getCaretCoords(ta, atPos);
  const dd = document.getElementById("mention-dropdown");
  dd.style.display = "block";
  dd.style.left    = coords.x + "px";
  dd.style.top     = coords.y + "px";
  dd.innerHTML = matches.map((t, i) => `
    <div class="mention-option${i === 0 ? " focused" : ""}" data-kind="${t.kind}" data-id="${t.id}" data-label="${esc(t.label)}"
         onclick="mentionInsertFromEl(this)">
      <span>@${esc(t.label)}</span>
      <span class="mo-type">${esc(t.hint)}</span>
    </div>`).join("");
}

function noteHandleMentionKey(e) {
  const dd = document.getElementById("mention-dropdown");
  if (dd.style.display === "none" || !dd.children.length) return;
  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    e.preventDefault();
    const focused = dd.querySelector(".focused");
    const items   = Array.from(dd.children);
    const idx     = items.indexOf(focused);
    items.forEach((i) => i.classList.remove("focused"));
    const next = e.key === "ArrowDown" ? (idx + 1) % items.length : (idx - 1 + items.length) % items.length;
    items[next].classList.add("focused");
  } else if (e.key === "Enter" || e.key === "Tab") {
    const focused = dd.querySelector(".focused");
    if (focused) { e.preventDefault(); mentionInsert(focused.dataset.kind, parseInt(focused.dataset.id), focused.dataset.label); }
  } else if (e.key === "Escape") {
    mentionHide();
  }
}

function mentionInsertFromEl(el) {
  mentionInsert(el.dataset.kind, parseInt(el.dataset.id), el.dataset.label);
}

function mentionInsert(kind, id, label) {
  const ta     = document.getElementById("note-body");
  const pos    = ta.selectionStart;
  const text   = ta.value;
  const before = text.slice(0, _mentionStart);
  const after  = text.slice(pos);
  const insert = `@[${label}](${kind}:${id})`;
  ta.value     = before + insert + after;
  const newPos = before.length + insert.length;
  ta.setSelectionRange(newPos, newPos);
  mentionHide();
  noteMarkDirty();
}

function mentionHide() {
  document.getElementById("mention-dropdown").style.display = "none";
}

// Approximate caret pixel position in textarea
function getCaretCoords(ta, pos) {
  const div   = document.createElement("div");
  const style = window.getComputedStyle(ta);
  ["fontFamily","fontSize","fontWeight","lineHeight","padding","border","width","boxSizing","whiteSpace","wordBreak"]
    .forEach((p) => { div.style[p] = style[p]; });
  div.style.position   = "absolute";
  div.style.visibility = "hidden";
  div.style.top        = "0";
  div.style.left       = "0";
  div.style.overflow   = "hidden";
  div.style.height     = "auto";
  div.style.whiteSpace = "pre-wrap";
  document.body.appendChild(div);
  div.textContent = ta.value.slice(0, pos);
  const span = document.createElement("span");
  span.textContent = "|";
  div.appendChild(span);
  const rect     = ta.getBoundingClientRect();
  const spanRect = span.getBoundingClientRect();
  document.body.removeChild(div);
  const scrollTop = ta.scrollTop;
  return {
    x: rect.left + (spanRect.left - div.getBoundingClientRect().left),
    y: rect.top + span.offsetTop - scrollTop + parseFloat(style.lineHeight) + 2,
  };
}
