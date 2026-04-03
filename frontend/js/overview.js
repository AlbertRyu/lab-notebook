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

function ovSave() {
  const data = {};
  ["ov-title","ov-description","ov-prop-pi","ov-prop-affil",
   "ov-prop-start","ov-prop-compound","ov-prop-status","ov-prop-notes"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) data[id] = el.value;
  });
  try { localStorage.setItem(OV_KEY, JSON.stringify(data)); } catch (_) {}
}

function ovLoadEditable() {
  let data = {};
  try { data = JSON.parse(localStorage.getItem(OV_KEY) || "{}"); } catch (_) {}
  ["ov-title","ov-description","ov-prop-pi","ov-prop-affil",
   "ov-prop-start","ov-prop-compound","ov-prop-status","ov-prop-notes"].forEach((id) => {
    const el = document.getElementById(id);
    if (el && data[id] !== undefined) el.value = data[id];
  });
}

function ovUpdateStatus() { /* native <select> renders fine */ }

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

function ovShow() {
  ovLoadEditable();
  let data = {};
  try { data = JSON.parse(localStorage.getItem(OV_KEY) || "{}"); } catch (_) {}
  ovRenderGoals(data["ov-goals"] || ovGoalsBuild());
  ovLoadLive();
}
