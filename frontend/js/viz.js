// ═══════════════════════════════════════════════════════════════════════════
// PAGE 2 — VISUALIZATION
// ═══════════════════════════════════════════════════════════════════════════

const viz = { files: [], selected: new Set(), fileModes: {} };
let _vizLoaded = false, _vizPlotted = false;

async function vizInit() {
  _vizLoaded = true;

  // Populate sample filter
  try {
    const samples = await api("/api/samples");
    const sel = document.getElementById("viz-sample-filter");
    sel.innerHTML = '<option value="">All samples</option>' +
      samples.map((s) => `<option value="${s.id}">${esc(s.name)}</option>`).join("");
  } catch (_) {}

  document.getElementById("viz-select-all").addEventListener("change", function () {
    document.querySelectorAll("#viz-tbody input[type=checkbox]").forEach((cb) => {
      cb.checked = this.checked;
      cb.dispatchEvent(new Event("change"));
    });
  });

  await vizLoadFiles();
}

async function vizLoadFiles() {
  const type     = document.getElementById("viz-exp-type").value;
  const sampleId = document.getElementById("viz-sample-filter").value;
  const p        = new URLSearchParams({ exp_type: type });
  if (sampleId) p.set("sample_id", sampleId);

  vizSetStatus("Loading…", "busy");
  try {
    viz.files = await api("/api/files?" + p);
    viz.selected.clear();
    viz.fileModes = {};
    viz.files.forEach((f) => {
      viz.fileModes[f.id] = type.startsWith("ppms") ? f.auto_mode || "MT" : "";
    });
    vizRenderTable();
    vizSetStatus(`${viz.files.length} file${viz.files.length !== 1 ? "s" : ""} found.`, "ready");
  } catch (e) {
    vizSetStatus("Error loading files.", "error");
  }
}

function vizRenderTable() {
  const tbody = document.getElementById("viz-tbody");
  document.getElementById("viz-plot-btn").disabled = viz.selected.size === 0;

  if (!viz.files.length) {
    tbody.innerHTML = `<tr><td colspan="3" style="text-align:center;padding:20px;color:var(--fg-muted);">No files</td></tr>`;
    return;
  }

  tbody.innerHTML = viz.files.map((f) => {
    const isPpms  = document.getElementById("viz-exp-type").value.startsWith("ppms");
    const modeCtrl = isPpms
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
