// ═══════════════════════════════════════════════════════════════════════════
// GLOBAL STATE & UTILS
// ═══════════════════════════════════════════════════════════════════════════

const auth = { authenticated: false };

const savedTheme = localStorage.getItem("theme") || "light";
document.documentElement.setAttribute("data-theme", savedTheme);

function toggleTheme() {
  const next = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", next);
  localStorage.setItem("theme", next);
  if (_vizPlotted) vizRenderPlot();
}

function toggleNav() {
  const nav = document.getElementById("nav");
  const expanded = nav.classList.toggle("expanded");
  localStorage.setItem("nav-expanded", expanded ? "1" : "0");
  const btn = document.querySelector(".nav-toggle");
  btn.textContent = expanded ? "‹" : "›";
  btn.title = expanded ? "Collapse sidebar" : "Expand sidebar";
}

async function api(path, opts = {}) {
  const res = await fetch(path, opts);
  if (!res.ok) {
    const msg = await res.text();
    if (res.status === 401) {
      auth.authenticated = false;
      applyAuthUi();
    }
    throw new Error(msg || `HTTP ${res.status}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

async function authInit() {
  try {
    const me = await api("/api/auth/me");
    auth.authenticated = !!me.authenticated;
  } catch (_) {
    auth.authenticated = false;
  }
  applyAuthUi();
}

function applyAuthUi() {
  const lockBtn = document.getElementById("nav-auth");
  if (lockBtn) lockBtn.textContent = auth.authenticated ? "🔓" : "🔒";
  document.body.classList.toggle("readonly", !auth.authenticated);

  [
    "inv-add-sample-btn", "inv-scan-btn", "inv-import-btn",
    "detail-add-exp-btn", "detail-edit-sample-btn", "detail-delete-sample-btn",
    "prep-add-sample-btn", "prep-detail-edit-btn", "prep-detail-delete-btn",
    "notes-add-btn", "note-save-btn", "note-pin-btn", "note-delete-btn",
    "note-title-input", "note-body",
    "bx-add-btn",
  ].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.disabled = !auth.authenticated;
  });

  const noteTabEdit = document.getElementById("note-tab-edit");
  if (noteTabEdit) noteTabEdit.style.display = auth.authenticated ? "" : "none";

  if (notes.current) noteSetTab(auth.authenticated ? "edit" : "preview");
  bxApplyAuth();
}

function ensureWriteAuth() {
  if (auth.authenticated) return true;
  alert("Read-only mode. Please unlock editing with password first.");
  openAuthModal();
  return false;
}

function openAuthModal() {
  if (auth.authenticated) { authLogout(); return; }
  modalOpen("Unlock Editing", `
    <div class="form-row">
      <label>Password</label>
      <input id="auth-password" type="password" placeholder="Enter password" autocomplete="current-password">
    </div>
  `, async () => {
    const password = document.getElementById("auth-password").value;
    await authLogin(password);
    closeModal();
  });
}

async function authLogin(password) {
  await api("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password }),
  });
  auth.authenticated = true;
  applyAuthUi();
}

async function authLogout() {
  await api("/api/auth/logout", { method: "POST" });
  auth.authenticated = false;
  applyAuthUi();
}

function esc(s) {
  if (s == null) return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function fmtDate(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

// ═══════════════════════════════════════════════════════════════════════════
// PAGE NAVIGATION
// ═══════════════════════════════════════════════════════════════════════════

function showPage(name) {
  document.querySelectorAll(".page").forEach((p) => p.classList.remove("active"));
  document.querySelectorAll(".nav-btn").forEach((b) => b.classList.remove("active"));
  document.getElementById("page-" + name).classList.add("active");
  document.getElementById("nav-" + name).classList.add("active");
  if (name !== "graph") graphStopAnimation();
  if (name === "preparations" && !_preparationsLoaded) preparationsInit();
  if (name === "viz" && !_vizLoaded) vizInit();
  if (name === "graph") {
    if (!_graphLoaded) graphInit();
    else graphStartAnimation();
    requestAnimationFrame(() => {
      if (document.getElementById("page-graph")?.classList.contains("active")) {
        graphResizeCanvas();
        graphDraw();
      }
    });
  }
  if (name === "notes" && !_notesLoaded) notesInit();
  if (name === "boxes" && !_bxLoaded) bxInit();
  if (name === "overview") ovShow();
}

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    closeLightbox();
    closeModal();
    mentionHide();
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// SHARED — PLOTLY HELPER
// ═══════════════════════════════════════════════════════════════════════════

function drawPlotly(el, data) {
  const dark = document.documentElement.getAttribute("data-theme") === "dark";
  const bg   = dark ? "#1e1e21" : "#ffffff";
  const fg   = dark ? "#cccccc" : "#222222";
  const grid = dark ? "#444444" : "#e0e0e0";
  Plotly.react(el, data.traces, {
    paper_bgcolor: bg, plot_bgcolor: bg,
    showlegend: true, uirevision: "plot-ui",
    font: { color: fg, family: "'Segoe UI', system-ui, Arial, sans-serif", size: 12 },
    margin: { l: 85, r: 36, t: 36, b: 72, pad: 8 },
    xaxis: { title: data.xaxis, gridcolor: grid, linecolor: grid, zerolinecolor: grid },
    yaxis: { title: data.yaxis, gridcolor: grid, linecolor: grid, zerolinecolor: grid },
    legend: { x: 1, xanchor: "right", y: 1 },
    hovermode: "closest",
  }, { responsive: true, editable: false, displayModeBar: true, edits: { legendPosition: true } });
}

// ═══════════════════════════════════════════════════════════════════════════
// SHARED — MODAL & LIGHTBOX
// ═══════════════════════════════════════════════════════════════════════════

let _modalSubmit = null;
function modalOpen(title, bodyHtml, onSubmit) {
  document.getElementById("modal-title").textContent = title;
  document.getElementById("modal-body").innerHTML = bodyHtml;
  _modalSubmit = onSubmit;
  document.getElementById("modal-submit").onclick = async () => {
    try { await _modalSubmit(); } catch (e) { alert(e.message); }
  };
  document.getElementById("modal-overlay").classList.add("open");
  document.querySelector("#modal-body input")?.focus();
}
function closeModal(e) {
  if (e && e.target !== document.getElementById("modal-overlay")) return;
  document.getElementById("modal-overlay").classList.remove("open");
}

function openLightbox(src, alt) {
  document.getElementById("lightbox-img").src = src;
  document.getElementById("lightbox-img").alt = alt;
  document.getElementById("lightbox").classList.add("open");
}
function closeLightbox() {
  document.getElementById("lightbox").classList.remove("open");
}

// ═══════════════════════════════════════════════════════════════════════════
// RESIZABLE PANELS
// ═══════════════════════════════════════════════════════════════════════════

function initResizers() {
  const MIN_W = 160, MAX_W = 600;
  const STORAGE_KEY = "panel-widths";

  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    Object.entries(saved).forEach(([id, w]) => {
      const el = document.getElementById(id);
      if (el) el.style.width = w + "px";
    });
  } catch (_) {}

  document.querySelectorAll(".resizer").forEach((resizer) => {
    const targetId = resizer.dataset.target;
    const leftPanel = document.getElementById(targetId);
    if (!leftPanel) return;
    let startX, startW;
    resizer.addEventListener("mousedown", (e) => {
      e.preventDefault();
      startX = e.clientX;
      startW = leftPanel.getBoundingClientRect().width;
      resizer.classList.add("dragging");
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";

      function onMove(e) {
        const dx = e.clientX - startX;
        leftPanel.style.width = Math.min(MAX_W, Math.max(MIN_W, startW + dx)) + "px";
      }
      function onUp() {
        resizer.classList.remove("dragging");
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        try {
          const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
          saved[targetId] = parseInt(leftPanel.style.width);
          localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
        } catch (_) {}
        window.dispatchEvent(new Event("resize"));
      }
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    });
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// APP BOOT — fetch tab HTML fragments, then initialise
// ═══════════════════════════════════════════════════════════════════════════

async function loadTabs() {
  const tabs = ["overview", "inventory", "preparations", "viz", "notes", "graph", "boxes"];
  const pages = document.getElementById("pages");
  const htmls = await Promise.all(
    tabs.map((t) => fetch(`/static/tabs/${t}.html`).then((r) => r.text()))
  );
  htmls.forEach((html) => {
    const tmp = document.createElement("div");
    tmp.innerHTML = html;
    // Move children (the .page div) into #pages
    while (tmp.firstElementChild) pages.appendChild(tmp.firstElementChild);
  });
}

document.addEventListener("DOMContentLoaded", async () => {
  if (localStorage.getItem("nav-expanded") === "1") {
    document.getElementById("nav").classList.add("expanded");
    const btn = document.querySelector(".nav-toggle");
    btn.textContent = "‹";
    btn.title = "Collapse sidebar";
  }
  await loadTabs();
  await authInit();
  await invInit();
  ovShow();
  initResizers();
  setTimeout(() => { void graphWarmup(); }, 0);
});
