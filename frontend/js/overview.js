// ═══════════════════════════════════════════════════════════════════════════
// PAGE 0 — OVERVIEW
// ═══════════════════════════════════════════════════════════════════════════

const OV_KEY = "lab_overview_v2";
const OV_TYPE_COLORS = {
  "ppms-vsm": "#b45309",
  "ppms-hc":  "#92400e",
  pxrd:       "#0891b2",
  sxrd:       "#0f766e",
  microscopy: "#7c3aed",
  fmr:        "#16a34a",
};

// ── Editable fields persistence ──────────────────────────────────────────

function ovDescAutoResize() {
  const el = document.getElementById("ov-description");
  if (!el) return;
  el.style.height = "auto";
  el.style.height = el.scrollHeight + "px";
}

let _ovSaveTimer = null;
function ovSave() {
  ovDescAutoResize();
  clearTimeout(_ovSaveTimer);
  _ovSaveTimer = setTimeout(ovSaveConfig, 600);
}

// ── Goals / Milestones ───────────────────────────────────────────────────

function ovGoalsBuild() {
  return [
    { text: "Synthesize phase-pure HOIP crystals",   status: "done",        deadline: "" },
    { text: "PXRD characterization of all batches",  status: "in-progress", deadline: "" },
    { text: "Magnetic measurements (PPMS-VSM)",      status: "in-progress", deadline: "" },
    { text: "Transport measurements (PPMS-HC)",      status: "todo",        deadline: "" },
    { text: "Write manuscript draft",                status: "todo",        deadline: "" },
  ];
}

function ovSaveGoals() {
  const rows = document.querySelectorAll("#ov-goals-tbody tr");
  const goals = Array.from(rows).map((r) => ({
    text:     r.querySelector(".ov-goal-text")?.value     || "",
    status:   r.querySelector(".ov-goal-status")?.value   || "todo",
    deadline: r.querySelector(".ov-goal-deadline")?.value || "",
  }));
  try {
    const data = JSON.parse(localStorage.getItem(OV_KEY) || "{}");
    data["ov-goals"] = goals;
    localStorage.setItem(OV_KEY, JSON.stringify(data));
  } catch (_) {}
}

function ovMakeGoalRow(g) {
  const tr = document.createElement("tr");
  tr.innerHTML = `
    <td><input class="ov-goal-inp ov-goal-text" value="${esc(g.text || "")}" placeholder="Milestone…" oninput="ovSaveGoals()"></td>
    <td>
      <select class="ov-goal-sel ov-goal-status" onchange="ovSaveGoals()">
        <option value="todo"        ${g.status === "todo"        ? "selected" : ""}>📋 To Do</option>
        <option value="in-progress" ${g.status === "in-progress" ? "selected" : ""}>🔄 In Progress</option>
        <option value="done"        ${g.status === "done"        ? "selected" : ""}>✅ Done</option>
        <option value="blocked"     ${g.status === "blocked"     ? "selected" : ""}>🚫 Blocked</option>
      </select>
    </td>
    <td><input class="ov-goal-inp ov-goal-deadline" type="date" value="${esc(g.deadline || "")}" oninput="ovSaveGoals()"></td>
    <td><button class="ov-goal-del auth-write" onclick="this.closest('tr').remove(); ovSaveGoals()" title="Remove">✕</button></td>
  `;
  return tr;
}

function ovRenderGoals(goals) {
  const tbody = document.getElementById("ov-goals-tbody");
  if (!tbody) return;
  tbody.innerHTML = "";
  goals.forEach((g) => tbody.appendChild(ovMakeGoalRow(g)));
}

function ovAddGoal() {
  const tbody = document.getElementById("ov-goals-tbody");
  if (!tbody) return;
  const row = ovMakeGoalRow({ text: "", status: "todo", deadline: "" });
  tbody.appendChild(row);
  ovSaveGoals();
  row.querySelector(".ov-goal-text").focus();
}

// ── Live stats & charts ──────────────────────────────────────────────────

async function ovLoadLive() {
  try {
    const [sRes, fRes] = await Promise.all([fetch("/api/samples"), fetch("/api/files")]);
    if (!sRes.ok || !fRes.ok) return;
    const samples = await sRes.json();
    const files   = await fRes.json();

    // Stat cards
    document.getElementById("ov-stat-samples").textContent   = samples.length;
    const expSet = new Set(files.map((f) => f.experiment_id));
    document.getElementById("ov-stat-exps").textContent      = expSet.size;
    document.getElementById("ov-stat-files").textContent     = files.length;
    const cpdSet = new Set(samples.map((s) => s.compound));
    document.getElementById("ov-stat-compounds").textContent = cpdSet.size;

    // Sample table
    const tbody = document.getElementById("ov-sample-tbody");
    if (tbody) {
      tbody.innerHTML = "";
      if (!samples.length) {
        tbody.innerHTML = '<tr><td colspan="5" style="padding:20px;text-align:center;color:var(--fg-muted)">No samples yet — import data from the Inventory tab.</td></tr>';
      } else {
        samples.forEach((s) => {
          const tr = document.createElement("tr");
          tr.onclick = () => { showPage("inventory"); invSelectSample(s.id); };
          const d = s.synthesis_date ? s.synthesis_date.slice(0, 10) : "—";
          tr.innerHTML = `
            <td><strong>${esc(s.name)}</strong></td>
            <td>${esc(s.compound)}</td>
            <td>${esc(s.batch || "—")}</td>
            <td>${esc(s.box   || "—")}</td>
            <td style="color:var(--fg-muted)">${d}</td>
          `;
          tbody.appendChild(tr);
        });
      }
    }

    // Experiments by type
    const byType = {}, seen = {};
    files.forEach((f) => {
      if (!seen[f.experiment_id]) {
        seen[f.experiment_id] = true;
        byType[f.exp_type] = (byType[f.exp_type] || 0) + 1;
      }
    });

    // Samples by compound
    const byCpd = {};
    samples.forEach((s) => { byCpd[s.compound] = (byCpd[s.compound] || 0) + 1; });

    ovDrawCharts(byType, byCpd);
  } catch (e) {
    console.error("Overview live load error:", e);
  }
}

function ovDrawCharts(byType, byCpd) {
  const isDark    = document.documentElement.getAttribute("data-theme") === "dark";
  const fontColor = isDark ? "#a1a1aa" : "#555555";
  const gridColor = isDark ? "#3f3f46" : "#e0e0e0";
  const baseLayout = {
    paper_bgcolor: "transparent", plot_bgcolor: "transparent",
    font: { size: 10, color: fontColor },
    margin: { t: 8, b: 36, l: 32, r: 8 },
    showlegend: false,
  };

  // Chart 1 — Experiments by type
  const typeKeys   = Object.keys(byType);
  const typeVals   = typeKeys.map((k) => byType[k]);
  const typeColors = typeKeys.map((k) => OV_TYPE_COLORS[k] || "#6b7280");
  if (typeKeys.length > 0) {
    Plotly.newPlot("ov-chart-exps",
      [{ type: "bar", x: typeKeys, y: typeVals, marker: { color: typeColors }, hovertemplate: "%{x}: %{y}<extra></extra>" }],
      { ...baseLayout, xaxis: { showgrid: false, tickfont: { size: 9 } }, yaxis: { showgrid: true, gridcolor: gridColor, tickfont: { size: 9 }, dtick: 1 } },
      { responsive: true, displayModeBar: false });
  } else {
    document.getElementById("ov-chart-exps").innerHTML =
      '<div style="height:100%;display:flex;align-items:center;justify-content:center;color:var(--fg-muted);font-size:12px">No experiment data</div>';
  }

  // Chart 2 — Samples by compound (horizontal)
  const cpdKeys = Object.keys(byCpd);
  const cpdVals = cpdKeys.map((k) => byCpd[k]);
  if (cpdKeys.length > 0) {
    Plotly.newPlot("ov-chart-compounds",
      [{ type: "bar", orientation: "h", x: cpdVals, y: cpdKeys, marker: { color: "#2563eb" }, hovertemplate: "%{y}: %{x}<extra></extra>" }],
      { ...baseLayout, margin: { t: 8, b: 24, l: 90, r: 8 }, xaxis: { showgrid: true, gridcolor: gridColor, tickfont: { size: 9 }, dtick: 1 }, yaxis: { showgrid: false, tickfont: { size: 9 }, automargin: true } },
      { responsive: true, displayModeBar: false });
  } else {
    document.getElementById("ov-chart-compounds").innerHTML =
      '<div style="height:100%;display:flex;align-items:center;justify-content:center;color:var(--fg-muted);font-size:12px">No sample data</div>';
  }
}

// ── Entry point (called by main.js after HTML injection) ─────────────────

async function ovShow() {
  _ovPpmsCompounds = null; // force fresh fetch from server on each tab activation
  const config = await ovLoadConfig();
  const titleEl = document.getElementById("ov-title");
  const descEl  = document.getElementById("ov-description");
  if (titleEl) titleEl.value = config.title       || "";
  if (descEl)  descEl.value  = config.description || "";
  ovDescAutoResize();
  _ovPpmsCompounds = config.compounds;

  let stored = {};
  try { stored = JSON.parse(localStorage.getItem(OV_KEY) || "{}"); } catch (_) {}
  ovRenderGoals(stored["ov-goals"] || ovGoalsBuild());

  ovPpmsRender();
  ovLoadLive();
}

// ═══════════════════════════════════════════════════════════════════════════
// PPMS Representative Graphs — interactive compound cards
// Data is persisted on the server at /data/ppms_config.json
// ═══════════════════════════════════════════════════════════════════════════

// In-memory cache; reset to null each time the overview tab is opened so
// the latest server data is always fetched on activation.
let _ovPpmsCompounds = null;

// All images available in /static/images/ppms/
const OV_PPMS_IMAGES = [
  { file: "MnPEA_MT.png",               label: "Mn-PEA  M vs T" },
  { file: "MnPEA_MH.png",               label: "Mn-PEA  M vs H" },
  { file: "MnPEA_HC.png",               label: "Mn-PEA  HC" },
  { file: "MnPEA_HC_Zoomed.png",        label: "Mn-PEA  HC Zoomed" },
  { file: "MnPEA_PhaseDiagram.png",     label: "Mn-PEA  Phase Diagram" },
  { file: "MnPEA_PhaseDiagram_Zoom.png",label: "Mn-PEA  Phase Diagram Zoom" },
  { file: "4Cl_MT.png",  label: "4Cl-Mn-BA  M vs T" },
  { file: "4Cl_MH.png",  label: "4Cl-Mn-BA  M vs H" },
  { file: "4Cl_HC.png",  label: "4Cl-Mn-BA  HC" },
  { file: "4H_MT.png",   label: "4H-Mn-BA  M vs T" },
  { file: "4H_MH.png",   label: "4H-Mn-BA  M vs H" },
  { file: "4H_HC.png",   label: "4H-Mn-BA  HC" },
  { file: "4F_MT.png",   label: "4F-Mn-BA  M vs T" },
  { file: "4F_MH.png",   label: "4F-Mn-BA  M vs H" },
  { file: "4Br_MT.png",  label: "4Br-Mn-BA  M vs T" },
  { file: "4Br_MH.png",  label: "4Br-Mn-BA  M vs H" },
  { file: "4Br_HC.png",  label: "4Br-Mn-BA  HC" },
];

const OV_PPMS_CATS = [
  { key: "vsm",          label: "VSM" },
  { key: "hc",           label: "Heat Capacity" },
  { key: "phase_diagram",label: "Phase Diagram" },
];

const OV_PPMS_DEFAULT = [
  { id: "mn-pea",    name: "Mn-PEA",    description: "Data from Lukas's old sample (DSC4 & DSC6).",
    vsm: ["MnPEA_MT.png","MnPEA_MH.png"],
    hc:  ["MnPEA_HC.png","MnPEA_HC_Zoomed.png"],
    phase_diagram: ["MnPEA_PhaseDiagram.png","MnPEA_PhaseDiagram_Zoom.png"] },
  { id: "4cl-mn-ba", name: "4Cl-Mn-BA", description: "Representative: 4Cl-Mn-BA - 1",
    vsm: ["4Cl_MT.png","4Cl_MH.png"], hc: ["4Cl_HC.png"], phase_diagram: [] },
  { id: "4h-mn-ba",  name: "4H-Mn-BA",  description: "Representative: 4H-Mn-BA - 1",
    vsm: ["4H_MT.png","4H_MH.png"],   hc: ["4H_HC.png"],  phase_diagram: [] },
  { id: "4f-mn-ba",  name: "4F-Mn-BA",  description: "Representative: 4F-Mn-BA - 1",
    vsm: ["4F_MT.png","4F_MH.png"],   hc: [],             phase_diagram: [] },
  { id: "4br-mn-ba", name: "4Br-Mn-BA", description: "Representative: 4Br-Mn-BA - 1",
    vsm: ["4Br_MT.png","4Br_MH.png"], hc: ["4Br_HC.png"], phase_diagram: [] },
  { id: "4i-mn-ba",  name: "4I-Mn-BA",  description: "Representative: 4I-Mn-BA - 1",
    vsm: [], hc: [], phase_diagram: [] },
];

async function ovLoadConfig() {
  try {
    const res = await fetch("/api/ppms-config");
    if (!res.ok) throw new Error();
    const data = await res.json();
    const compounds = Array.isArray(data.compounds) && data.compounds.length > 0
      ? data.compounds
      : OV_PPMS_DEFAULT.map(c => ({ ...c, vsm: [...c.vsm], hc: [...c.hc], phase_diagram: [...c.phase_diagram] }));
    return { title: data.title || "", description: data.description || "", compounds };
  } catch (_) {}
  return { title: "", description: "", compounds: OV_PPMS_DEFAULT.map(c => ({ ...c, vsm: [...c.vsm], hc: [...c.hc], phase_diagram: [...c.phase_diagram] })) };
}

async function ovSaveConfig() {
  const titleEl = document.getElementById("ov-title");
  const descEl  = document.getElementById("ov-description");
  try {
    const res = await fetch("/api/ppms-config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title:       titleEl?.value ?? "",
        description: descEl?.value  ?? "",
        compounds:   _ovPpmsCompounds ?? [],
      }),
    });
    if (!res.ok) throw new Error(await res.text());
  } catch (e) {
    console.error("Failed to save config:", e);
    alert("Save failed — check the browser console for details.");
  }
}

// Keep old name as alias so call-sites in edit/delete/add still work
const ovPpmsSaveToServer = ovSaveConfig;

// ── View mode ─────────────────────────────────────────────────────────────

async function ovPpmsRender() {
  if (_ovPpmsCompounds === null) {
    const config = await ovLoadConfig();
    _ovPpmsCompounds = config.compounds;
  }
  const container = document.getElementById("ov-ppms");
  if (!container) return;
  container.innerHTML = "";
  _ovPpmsCompounds.forEach((c, idx) => container.appendChild(ovPpmsMakeCard(c, idx)));
}

function ovPpmsMakeCard(c, idx) {
  const card = document.createElement("div");
  card.className = "ov-ppms-card";
  card.dataset.idx = idx;

  // Header
  const hdr = document.createElement("div");
  hdr.className = "ov-ppms-card-header";
  hdr.innerHTML = `
    <div class="ov-ppms-card-name">${esc(c.name)}</div>
    <div class="ov-ppms-card-desc">${esc(c.description) || '<span style="color:var(--fg-muted);font-style:italic">No description</span>'}</div>
    <button class="ov-ppms-edit-btn auth-write" title="Edit compound" onclick="ovPpmsStartEdit(${idx})">✎ Edit</button>
  `;
  card.appendChild(hdr);

  // Category sections
  let hasAnyImage = false;
  OV_PPMS_CATS.forEach(cat => {
    const imgs = c[cat.key] || [];
    if (!imgs.length) return;
    hasAnyImage = true;

    const sec = document.createElement("div");
    sec.className = "ov-ppms-cat-section";

    const lbl = document.createElement("div");
    lbl.className = "ov-graph-subheading";
    lbl.textContent = cat.label;
    sec.appendChild(lbl);

    const row = document.createElement("div");
    row.className = "ov-graph-row";
    imgs.forEach(file => {
      const gc = document.createElement("div");
      gc.className = "ov-graph-card" + (imgs.length === 1 ? " ov-graph-card--wide" : "");
      gc.innerHTML = `<img src="/static/images/ppms/${esc(file)}" alt="${esc(file)}" loading="lazy">`;
      row.appendChild(gc);
    });
    sec.appendChild(row);
    card.appendChild(sec);
  });

  if (!hasAnyImage) {
    const empty = document.createElement("div");
    empty.className = "ov-ppms-empty";
    empty.textContent = "No graphs assigned yet — click Edit to add images.";
    card.appendChild(empty);
  }

  return card;
}

// ── Edit mode ─────────────────────────────────────────────────────────────

function ovPpmsStartEdit(idx) {
  const c = _ovPpmsCompounds?.[idx];
  const card = document.querySelector(`.ov-ppms-card[data-idx="${idx}"]`);
  if (!card) return;

  card.innerHTML = "";
  card.classList.add("ov-ppms-card--editing");

  // Name
  const nameRow = document.createElement("div");
  nameRow.className = "ov-ppms-field";
  nameRow.innerHTML = `<label>Name</label><input class="ov-ppms-inp ov-ppms-name-inp" value="${esc(c.name)}" placeholder="Compound name">`;
  card.appendChild(nameRow);

  // Description
  const descRow = document.createElement("div");
  descRow.className = "ov-ppms-field";
  descRow.innerHTML = `<label>Description</label><input class="ov-ppms-inp ov-ppms-desc-inp" value="${esc(c.description)}" placeholder="e.g. Representative: 4Cl-Mn-BA - 1">`;
  card.appendChild(descRow);

  // Image categories
  OV_PPMS_CATS.forEach(cat => {
    const sec = document.createElement("div");
    sec.className = "ov-ppms-edit-cat";
    sec.dataset.cat = cat.key;

    const catHdr = document.createElement("div");
    catHdr.className = "ov-ppms-edit-cat-hdr";
    catHdr.innerHTML = `<span class="ov-graph-subheading" style="margin:0">${cat.label}</span>`;
    sec.appendChild(catHdr);

    const imgList = document.createElement("div");
    imgList.className = "ov-ppms-edit-imglist";
    (c[cat.key] || []).forEach(file => imgList.appendChild(ovPpmsMakeEditThumb(file)));
    sec.appendChild(imgList);

    const addBtn = document.createElement("button");
    addBtn.className = "ov-ppms-add-img-btn auth-write";
    addBtn.textContent = "+ Add image";
    addBtn.onclick = () => ovPpmsTogglePicker(idx, cat.key, sec, addBtn);
    sec.appendChild(addBtn);

    card.appendChild(sec);
  });

  // Actions
  const actions = document.createElement("div");
  actions.className = "ov-ppms-edit-actions";
  actions.innerHTML = `
    <button class="ov-ppms-done-btn" onclick="ovPpmsSaveEdit(${idx})">✓ Done</button>
    <button class="ov-ppms-del-btn auth-write" onclick="ovPpmsDeleteCompound(${idx})">Remove compound</button>
  `;
  card.appendChild(actions);
}

function ovPpmsMakeEditThumb(file) {
  const wrap = document.createElement("div");
  wrap.className = "ov-ppms-edit-thumb";
  wrap.dataset.file = file;
  wrap.innerHTML = `
    <img src="/static/images/ppms/${esc(file)}" alt="${esc(file)}" loading="lazy">
    <div class="ov-ppms-edit-thumb-name">${esc(file)}</div>
    <button class="ov-ppms-remove-img auth-write" title="Remove" onclick="this.closest('.ov-ppms-edit-thumb').remove()">×</button>
  `;
  return wrap;
}

// ── Image picker ──────────────────────────────────────────────────────────

function ovPpmsTogglePicker(idx, catKey, catSection, triggerBtn) {
  const existing = catSection.querySelector(".ov-ppms-picker");
  if (existing) { existing.remove(); return; }

  // Close any other open pickers
  document.querySelectorAll(".ov-ppms-picker").forEach(p => p.remove());

  const picker = document.createElement("div");
  picker.className = "ov-ppms-picker";

  const grid = document.createElement("div");
  grid.className = "ov-ppms-picker-grid";

  OV_PPMS_IMAGES.forEach(img => {
    const thumb = document.createElement("div");
    thumb.className = "ov-ppms-picker-item";
    thumb.innerHTML = `
      <img src="/static/images/ppms/${esc(img.file)}" alt="${esc(img.label)}" loading="lazy">
      <div class="ov-ppms-picker-item-label">${esc(img.label)}</div>
    `;
    thumb.onclick = () => {
      const imgList = catSection.querySelector(".ov-ppms-edit-imglist");
      imgList.appendChild(ovPpmsMakeEditThumb(img.file));
      picker.remove();
    };
    grid.appendChild(thumb);
  });

  picker.appendChild(grid);
  triggerBtn.insertAdjacentElement("afterend", picker);
}

async function ovPpmsSaveEdit(idx) {
  const card = document.querySelector(`.ov-ppms-card[data-idx="${idx}"]`);
  if (!card || !_ovPpmsCompounds) return;

  _ovPpmsCompounds[idx].name        = card.querySelector(".ov-ppms-name-inp")?.value.trim() || _ovPpmsCompounds[idx].name;
  _ovPpmsCompounds[idx].description = card.querySelector(".ov-ppms-desc-inp")?.value.trim() || "";

  OV_PPMS_CATS.forEach(cat => {
    const sec = card.querySelector(`.ov-ppms-edit-cat[data-cat="${cat.key}"]`);
    if (!sec) return;
    _ovPpmsCompounds[idx][cat.key] = Array.from(sec.querySelectorAll(".ov-ppms-edit-thumb"))
      .map(el => el.dataset.file);
  });

  await ovPpmsSaveToServer();
  ovPpmsRender();
}

async function ovPpmsDeleteCompound(idx) {
  if (!confirm("Remove this compound from the overview?")) return;
  if (!_ovPpmsCompounds) return;
  _ovPpmsCompounds.splice(idx, 1);
  await ovPpmsSaveToServer();
  ovPpmsRender();
}

async function ovPpmsAddCompound() {
  if (!_ovPpmsCompounds) _ovPpmsCompounds = (await ovLoadConfig()).compounds;
  _ovPpmsCompounds.push({ id: "cpd-" + Date.now(), name: "New Compound", description: "",
    vsm: [], hc: [], phase_diagram: [] });
  await ovPpmsSaveToServer();
  await ovPpmsRender();
  setTimeout(() => ovPpmsStartEdit(_ovPpmsCompounds.length - 1), 30);
}
