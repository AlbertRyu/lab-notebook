// ═══════════════════════════════════════════════════════════════════════════
// PAGE 3 — NOTES
// ═══════════════════════════════════════════════════════════════════════════

const notes = {
  list: [],
  current: null,
  dirty: false,
  mentionTargets: [],
  experimentToSample: {},
};
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
  const p = q ? "?q=" + encodeURIComponent(q) : "";
  notes.list = await api("/api/notes" + p).catch(() => []);
  notesRenderList();
}

function notesRenderList() {
  const list = document.getElementById("notes-list");
  if (!notes.list.length) {
    list.innerHTML = '<div class="placeholder" style="padding:20px;text-align:center;color:var(--fg-muted);">No notes yet</div>';
    return;
  }
  list.innerHTML = notes.list.map((n) => `
    <div class="note-item${notes.current && notes.current.id === n.id ? " active" : ""}" onclick="notesSelect(${n.id})">
      <div class="n-title-row">
        <div class="n-title">${esc(n.title) || '<em style="color:var(--fg-muted)">Untitled</em>'}</div>
        ${n.pinned ? '<span class="n-pin">PIN</span>' : ""}
      </div>
      <div class="n-date">${fmtDate(n.updated_at)}</div>
      <div class="n-preview">${esc(notesStripMentions(n.body).slice(0, 80))}</div>
    </div>`).join("");
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
  noteSetTab(auth.authenticated ? "edit" : "preview");
}

async function noteTogglePin() {
  if (!ensureWriteAuth()) return;
  if (!notes.current) return;
  clearTimeout(_noteSaveTimer);
  const title  = document.getElementById("note-title-input").value.trim() || "Untitled";
  const body   = document.getElementById("note-body").value;
  const pinned = !notes.current.pinned;
  try {
    const updated = await api(`/api/notes/${notes.current.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, body, pinned }),
    });
    notes.current = updated;
    notes.dirty   = false;
    document.getElementById("note-save-status").textContent = pinned ? "Pinned" : "Unpinned";
    await notesLoadList(document.getElementById("notes-search-input").value.trim());
    notesRenderEditor();
  } catch (e) {
    document.getElementById("note-save-status").textContent = "Pin failed";
  }
}

async function createNewNote() {
  if (!ensureWriteAuth()) return;
  if (notes.dirty && !confirm("Discard unsaved changes?")) return;
  const n = await api("/api/notes", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title: "New note", body: "" }),
  });
  notes.list.unshift(n);
  notes.current = n;
  notes.dirty   = false;
  notesRenderList();
  notesRenderEditor();
  await notesBuildMentionTargets();
  setTimeout(() => document.getElementById("note-title-input").focus(), 50);
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
  const title = document.getElementById("note-title-input").value.trim() || "Untitled";
  const body  = document.getElementById("note-body").value;
  try {
    const updated = await api(`/api/notes/${notes.current.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, body }),
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

  // Use the same frontmatter format as the files on disk
  const created_at = notes.current.created_at ? notes.current.created_at : "";
  const updated_at = notes.current.updated_at ? notes.current.updated_at : "";

  const content = (
    "---\n"
    + `id: ${notes.current.id}\n`
    + `title: ${title}\n`
    + `pinned: ${String(notes.current.pinned).toLowerCase()}\n`
    + `created_at: ${created_at}\n`
    + `updated_at: ${updated_at}\n`
    + "---\n\n"
    + body
  );

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
