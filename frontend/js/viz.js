// ═══════════════════════════════════════════════════════════════════════════
// PAGE 2 — VISUALIZATION
// ═══════════════════════════════════════════════════════════════════════════

const viz = { files: [], allFiles: [], selected: new Set(), fileModes: {} };
let _vizLoaded = false, _vizPlotted = false, _vizInitPromise = null;

async function vizInit() {
  _vizLoaded = true;
  _vizInitPromise = (async () => {
    document.getElementById("viz-select-all").addEventListener("change", function () {
      const checked = this.checked;
      document.querySelectorAll("#viz-tbody input[type=checkbox]").forEach((cb) => {
        cb.checked = checked;
        cb.dispatchEvent(new Event("change"));
      });
    });

    await vizLoadFiles();
  })();
  await _vizInitPromise;
}

// Called when exp-type changes: reload all files, rebuild sample dropdown, reset dependent filters
async function vizOnTypeChange() {
  document.getElementById("viz-sample-filter").value = "";
  document.getElementById("viz-meas-filter").value = "";
  document.getElementById("viz-meas-filter").style.display = "none";
  await vizLoadFiles();
}

// Called when sample changes: rebuild meas dropdown from already-loaded allFiles, re-render
function vizOnSampleChange() {
  document.getElementById("viz-meas-filter").value = "";
  vizPopulateMeasFilter();
  vizRenderTable();
}

// Called when meas filter changes: just re-render
function vizOnMeasChange() {
  vizRenderTable();
}

async function vizLoadFiles() {
  const type = document.getElementById("viz-exp-type").value;
  const p    = new URLSearchParams({ exp_type: type });

  vizSetStatus("Loading…", "busy");
  try {
    viz.allFiles = await api("/api/files?" + p);
    viz.selected.clear();
    viz.fileModes = {};
    viz.allFiles.forEach((f) => {
      viz.fileModes[f.id] = type.startsWith("ppms") ? f.auto_mode || "MT" : "";
    });
    vizPopulateSampleFilter();
    vizPopulateMeasFilter();
    vizRenderTable();
    vizSetStatus(`${viz.files.length} file${viz.files.length !== 1 ? "s" : ""} found.`, "ready");
  } catch (e) {
    vizSetStatus("Error loading files.", "error");
  }
}

// Rebuild sample dropdown from currently loaded allFiles
function vizPopulateSampleFilter() {
  const sel  = document.getElementById("viz-sample-filter");
  const prev = sel.value;
  const seen = new Map();
  viz.allFiles.forEach((f) => {
    if (!seen.has(f.sample_id)) seen.set(f.sample_id, f.sample_name);
  });
  sel.innerHTML = '<option value="">All samples</option>' +
    Array.from(seen.entries()).map(([id, name]) =>
      `<option value="${id}"${prev == id ? " selected" : ""}>${esc(name)}</option>`
    ).join("");
}

// Rebuild measurement dropdown from allFiles, filtered by the current sample selection
function vizPopulateMeasFilter() {
  const sampleId = document.getElementById("viz-sample-filter").value;
  const sel      = document.getElementById("viz-meas-filter");
  sel.style.display = sampleId ? "" : "none";

  const source = sampleId
    ? viz.allFiles.filter((f) => f.sample_id == sampleId)
    : viz.allFiles;

  const seen = new Map();
  source.forEach((f) => {
    if (!seen.has(f.experiment_id)) {
      const parts = [];
      if (f.exp_orientation) parts.push(f.exp_orientation);
      if (f.exp_date) parts.push(f.exp_date);
      seen.set(f.experiment_id, parts.join(" · ") || `Exp #${f.experiment_id}`);
    }
  });
  sel.innerHTML = '<option value="">All measurements</option>' +
    Array.from(seen.entries()).map(([id, label]) =>
      `<option value="${id}">${esc(label)}</option>`
    ).join("");
}

function vizRenderTable() {
  const sampleId = document.getElementById("viz-sample-filter").value;
  const measId   = document.getElementById("viz-meas-filter").value;
  viz.files = viz.allFiles.filter((f) => {
    if (sampleId && f.sample_id != sampleId) return false;
    if (measId   && f.experiment_id != measId) return false;
    return true;
  });
  // Drop selections no longer visible
  viz.selected.forEach((id) => { if (!viz.files.find((f) => f.id === id)) viz.selected.delete(id); });

  const tbody = document.getElementById("viz-tbody");
  document.getElementById("viz-plot-btn").disabled = viz.selected.size === 0;

  if (!viz.files.length) {
    tbody.innerHTML = `<tr><td colspan="3" style="text-align:center;padding:20px;color:var(--fg-muted);">No files</td></tr>`;
    return;
  }

  tbody.innerHTML = viz.files.map((f) => {
    const expType = document.getElementById("viz-exp-type").value;
    const isPpms  = expType.startsWith("ppms");
    const isHC    = expType === "ppms-hc";
    const modeCtrl = isPpms && !isHC
      ? `<div class="mode-group">${["MT", "MH"].map((m) =>
          `<label><input type="radio" name="vm-${f.id}" value="${m}" ${viz.fileModes[f.id] === m ? "checked" : ""}
            onchange="viz.fileModes[${f.id}]='${m}'"> ${m}</label>`
        ).join("")}</div>`
      : '<span style="color:var(--fg-muted);font-size:11px;">—</span>';

    return `<tr id="vrow-${f.id}" ${viz.selected.has(f.id) ? 'class="selected"' : ""}>
      <td>
        <span class="fname">${esc(f.filename)}</span>
        <span class="fsample">${esc(f.sample_name)}</span>
      </td>
      <td>${modeCtrl}</td>
      <td style="text-align:center;">
        <input type="checkbox" ${viz.selected.has(f.id) ? "checked" : ""}
          onchange="vizToggleFile(${f.id}, this.checked)">
      </td>
    </tr>`;
  }).join("");
}

function vizToggleFile(id, checked) {
  if (checked) viz.selected.add(id);
  else         viz.selected.delete(id);
  document.getElementById("vrow-" + id)?.classList.toggle("selected", checked);
  document.getElementById("viz-plot-btn").disabled = viz.selected.size === 0;
  vizSyncSelectAll();
}

function vizSyncSelectAll() {
  const cbs = Array.from(document.querySelectorAll("#viz-tbody input[type=checkbox]"));
  const n   = cbs.filter((c) => c.checked).length;
  const sa  = document.getElementById("viz-select-all");
  sa.indeterminate = n > 0 && n < cbs.length;
  sa.checked       = n === cbs.length && cbs.length > 0;
}

async function vizRenderPlot() {
  if (!viz.selected.size) return;
  vizSetStatus("Rendering…", "busy");

  const type = document.getElementById("viz-exp-type").value;
  const ids  = Array.from(viz.selected);

  if (type.startsWith("ppms")) {
    const modes = new Set(ids.map((id) => viz.fileModes[id]));
    if (modes.size > 1) { vizSetStatus("Mixed modes (MT & MH) — select one mode only.", "error"); return; }
  }

  const mode = type.startsWith("ppms") ? viz.fileModes[ids[0]] : undefined;
  const p    = mode ? `?mode=${mode}` : "";

  try {
    const data = await api(`/api/plot${p}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(ids),
    });
    drawPlotly(document.getElementById("viz-plot"), data);
    _vizPlotted = true;
    vizSetStatus(`Plotted ${ids.length} file${ids.length !== 1 ? "s" : ""}.`, "ready");
  } catch (e) {
    vizSetStatus("Plot error: " + e.message, "error");
  }
}

function vizClearPlot() {
  Plotly.purge(document.getElementById("viz-plot"));
  _vizPlotted = false;
  vizSetStatus("Plot cleared.", "ready");
}

function vizSetStatus(msg, cls) {
  const el = document.getElementById("viz-status");
  el.textContent = msg;
  el.className   = cls || "";
}
