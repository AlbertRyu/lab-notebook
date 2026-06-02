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

// Called when exp-type changes: reload all files and reset all dependent filters
async function vizOnTypeChange() {
  document.getElementById("viz-mode-filter").value = "";
  document.getElementById("viz-compound-filter").value = "";
  document.getElementById("viz-sample-filter").value = "";
  document.getElementById("viz-orientation-filter").value = "";
  await vizLoadFiles();
}

function vizOnSampleChange() {
  vizOnFilterChange();
}

function vizOnFilterChange() {
  vizRefreshFilters();
  vizRenderTable();
  vizSetStatus(`${viz.files.length} file${viz.files.length !== 1 ? "s" : ""} found.`, "ready");
}

function vizFormatDiagnosticValue(value, unit) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return null;
  if (unit === "Oe" || unit === "K") return `${Math.round(Number(value))} ${unit}`;
  const rounded = Math.round(Number(value) * 1000) / 1000;
  return `${Number.isInteger(rounded) ? rounded.toFixed(0) : rounded} ${unit}`;
}

function vizFileDisplayName(f) {
  if (f.exp_type !== "ppms-vsm" || !["MT", "MH"].includes(f.auto_mode)) return f.filename;
  if (!f.sample_name || !f.exp_orientation) return f.filename;

  const diagnosticValue = f.auto_mode === "MT"
    ? vizFormatDiagnosticValue(f.external_field_oe, "Oe")
    : vizFormatDiagnosticValue(f.temperature_k, "K");

  return diagnosticValue
    ? `${f.sample_name}-${f.exp_orientation}-${diagnosticValue}`
    : f.filename;
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
      viz.fileModes[f.id] = type.startsWith("ppms") ? vizFileMode(f) : "";
    });
    vizRefreshFilters();
    vizRenderTable();
    vizSetStatus(`${viz.files.length} file${viz.files.length !== 1 ? "s" : ""} found.`, "ready");
  } catch (e) {
    vizSetStatus("Error loading files.", "error");
  }
}

function vizModeFilterEnabled() {
  return document.getElementById("viz-exp-type").value === "ppms-vsm";
}

function vizGetFilters(exclude) {
  return {
    mode: exclude === "mode" || !vizModeFilterEnabled()
      ? ""
      : document.getElementById("viz-mode-filter").value,
    compound: exclude === "compound"
      ? ""
      : document.getElementById("viz-compound-filter").value,
    sample: exclude === "sample"
      ? ""
      : document.getElementById("viz-sample-filter").value,
    orientation: exclude === "orientation"
      ? ""
      : document.getElementById("viz-orientation-filter").value,
  };
}

function vizFileMode(f) {
  if (f.exp_type === "ppms-hc") return f.auto_mode || "HC";
  if (f.exp_type === "ppms-vsm") return f.auto_mode || "MT";
  return f.auto_mode || "";
}

function vizMatchesFilters(f, filters) {
  if (filters.mode && vizFileMode(f) !== filters.mode) return false;
  if (filters.compound && f.sample_compound !== filters.compound) return false;
  if (filters.sample && String(f.sample_id) !== filters.sample) return false;
  if (filters.orientation && (f.exp_orientation || "") !== filters.orientation) return false;
  return true;
}

function vizOptionsSource(exclude) {
  const filters = vizGetFilters(exclude);
  return viz.allFiles.filter((f) => vizMatchesFilters(f, filters));
}

function vizSetSelectOptions(id, allLabel, entries, disabled) {
  const sel = document.getElementById(id);
  const prev = sel.value;
  sel.disabled = !!disabled;
  sel.innerHTML = `<option value="">${allLabel}</option>` +
    entries.map(({ value, label }) =>
      `<option value="${esc(String(value))}">${esc(label)}</option>`
    ).join("");

  const valid = entries.some((entry) => String(entry.value) === prev);
  sel.value = !disabled && valid ? prev : "";
  return prev !== sel.value;
}

function vizUniqueOptions(source, valueOf, labelOf) {
  const seen = new Map();
  source.forEach((f) => {
    const value = valueOf(f);
    if (value === null || value === undefined || value === "") return;
    if (!seen.has(String(value))) seen.set(String(value), { value, label: labelOf(f) });
  });
  return Array.from(seen.values()).sort((a, b) => a.label.localeCompare(b.label));
}

function vizRefreshFilters() {
  let changed = false;
  for (let i = 0; i < 4; i++) {
    const modeEntries = vizModeFilterEnabled()
      ? vizUniqueOptions(vizOptionsSource("mode"), vizFileMode, (f) => {
          const m = vizFileMode(f);
          return m === "CHI" ? "χ(T)" : m;
        }).filter((entry) => ["MT", "MH", "CHI"].includes(String(entry.value)))
      : [];
    const compoundEntries = vizUniqueOptions(
      vizOptionsSource("compound"),
      (f) => f.sample_compound,
      (f) => f.sample_compound
    );
    const sampleEntries = vizUniqueOptions(
      vizOptionsSource("sample"),
      (f) => f.sample_id,
      (f) => f.sample_name
    );
    const orientationEntries = vizUniqueOptions(
      vizOptionsSource("orientation"),
      (f) => f.exp_orientation,
      (f) => f.exp_orientation
    );

    const passChanged = [
      vizSetSelectOptions("viz-mode-filter", "All modes", modeEntries, !vizModeFilterEnabled()),
      vizSetSelectOptions("viz-compound-filter", "All compounds", compoundEntries, false),
      vizSetSelectOptions("viz-sample-filter", "All samples", sampleEntries, false),
      vizSetSelectOptions("viz-orientation-filter", "All orientations", orientationEntries, false),
    ].some(Boolean);
    changed = changed || passChanged;
    if (!passChanged) break;
  }
  return changed;
}

function vizRenderTable() {
  const filters = vizGetFilters();
  viz.files = viz.allFiles.filter((f) => vizMatchesFilters(f, filters));
  // Drop selections no longer visible
  viz.selected.forEach((id) => { if (!viz.files.find((f) => f.id === id)) viz.selected.delete(id); });

  const tbody = document.getElementById("viz-tbody");
  document.getElementById("viz-plot-btn").disabled = viz.selected.size === 0;

  if (!viz.files.length) {
    tbody.innerHTML = `<tr><td colspan="3" style="text-align:center;padding:20px;color:var(--fg-muted);">No files</td></tr>`;
    vizSyncSelectAll();
    return;
  }

  tbody.innerHTML = viz.files.map((f) => {
    const expType = document.getElementById("viz-exp-type").value;
    const isPpms = expType.startsWith("ppms");
    const mode = vizFileMode(f);
    const modeCtrl = isPpms
      ? `<span class="mode-pill">${esc(mode === "CHI" ? "χ(T)" : mode)}</span>`
      : '<span style="color:var(--fg-muted);font-size:11px;">—</span>';

    return `<tr id="vrow-${f.id}" ${viz.selected.has(f.id) ? 'class="selected"' : ""}>
      <td>
        <span class="fname">${esc(vizFileDisplayName(f))}</span>
        <span class="fsample">${esc(f.sample_name)}</span>
      </td>
      <td>${modeCtrl}</td>
      <td style="text-align:center;">
        <input type="checkbox" ${viz.selected.has(f.id) ? "checked" : ""}
          onchange="vizToggleFile(${f.id}, this.checked)">
      </td>
    </tr>`;
  }).join("");
  vizSyncSelectAll();
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
    if (modes.size > 1) { vizSetStatus("Mixed modes — select one mode only.", "error"); return; }
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
