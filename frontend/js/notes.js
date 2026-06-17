// ═══════════════════════════════════════════════════════════════════════════
// NOTES — read-only viewer for Obsidian-imported markdown
//
// Notes live in /data/notes/<slug>.md and are populated by
// scripts/import-from-obsidian.py. This tab only renders them; nothing here
// writes to the server. Image assets resolve under /files/notes/assets/<slug>/.
// ═══════════════════════════════════════════════════════════════════════════

const notes = {
  list: [],
  current: null,
  query: "",
};
let _notesLoaded = false;

async function notesInit() {
  _notesLoaded = true;
  await notesLoadList();
}

async function notesLoadList() {
  const params = new URLSearchParams();
  if (notes.query) params.set("q", notes.query);
  const qs = params.toString() ? "?" + params.toString() : "";
  notes.list = await api("/api/notes" + qs).catch(() => []);
  notesRenderList();
}

function notesApplySearch() {
  notes.query = document.getElementById("notes-search-input").value.trim();
  notesLoadList();
}

function notesRenderList() {
  const list = document.getElementById("notes-list");
  if (!notes.list.length) {
    list.innerHTML = '<div class="placeholder" style="padding:20px;text-align:center;color:var(--fg-muted);">No notes yet.<br><span style="font-size:11px;">Run scripts/import-from-obsidian.py to publish from your vault.</span></div>';
    return;
  }
  list.innerHTML = notes.list.map((n) => {
    const tagList = Array.isArray(n.tags) ? n.tags : [];
    const tags = tagList.slice(0, 3).map((t) =>
      `<span class="n-tag-chip">${esc(t)}</span>`
    ).join("");
    const more = tagList.length > 3 ? `<span class="n-tag-more">+${tagList.length - 3}</span>` : "";
    return `
      <div class="note-item${notes.current && notes.current.slug === n.slug ? " active" : ""}" onclick="notesSelect('${esc(n.slug)}')">
        <div class="n-title-row">
          <div class="n-title">${esc(n.title) || '<em style="color:var(--fg-muted)">Untitled</em>'}</div>
          ${n.pinned ? '<span class="n-pin">PIN</span>' : ""}
        </div>
        ${n.date ? `<div class="n-date">${esc(n.date)}</div>` : ""}
        ${tags || more ? `<div class="n-tags">${tags}${more}</div>` : ""}
      </div>`;
  }).join("");
}

async function notesSelect(slug) {
  try {
    notes.current = await api(`/api/notes/${encodeURIComponent(slug)}`);
  } catch (e) {
    alert("Failed to load note");
    return;
  }
  notesRenderView();
  notesRenderList();
}

function notesRenderView() {
  const n = notes.current;
  document.getElementById("notes-placeholder").style.display = "none";
  const wrap = document.getElementById("notes-view");
  wrap.style.display = "flex";

  document.getElementById("note-view-title").textContent = n.title || n.slug;

  const metaParts = [];
  if (n.date) metaParts.push(`<span class="nv-date">${esc(n.date)}</span>`);
  const tagList = Array.isArray(n.tags) ? n.tags : [];
  tagList.forEach((t) => metaParts.push(`<span class="n-tag-chip">${esc(t)}</span>`));
  if (n.pinned) metaParts.push('<span class="n-pin">PIN</span>');
  document.getElementById("note-view-meta").innerHTML = metaParts.join(" ");

  const rendered = marked.parse(n.body || "", { breaks: true, gfm: true });
  const render = document.getElementById("note-render");
  render.innerHTML = rendered;

  // Rewrite intra-note links: [text](note:slug) → on-click navigation.
  render.querySelectorAll('a[href^="note:"]').forEach((a) => {
    const target = a.getAttribute("href").slice(5);
    a.setAttribute("href", "javascript:void(0)");
    a.classList.add("note-link");
    a.addEventListener("click", (ev) => { ev.preventDefault(); notesSelect(target); });
  });
}
