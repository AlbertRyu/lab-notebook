// ═══════════════════════════════════════════════════════════════════════════
// PAGE 1 — INVENTORY
// ═══════════════════════════════════════════════════════════════════════════

const inv = { samples: [], current: null };

// Called by main.js after tab HTML is injected
async function invInit() {
  await invLoadFilters();
  await invLoadSamples();
}

async function invLoadFilters() {
  try {
    const f = await api("/api/filters");
    invPopSelect("inv-compound", f.compounds, "All compounds");
    invPopSelect("inv-batch",    f.batches,   "All batches");
    invPopSelect("inv-box",      f.boxes,     "All boxes");
  } catch (_) {}
}

function invPopSelect(id, values, ph) {
  const sel = document.getElementById(id);
  const cur = sel.value;
  sel.innerHTML = `<option value="">${ph}</option>` +
    values.map((v) => `<option value="${esc(v)}"${v === cur ? " selected" : ""}>${esc(v)}</option>`).join("");
}

async function invLoadSamples() {
  const p = new URLSearchParams();
  const q        = document.getElementById("inv-search-input").value.trim();
  const compound = document.getElementById("inv-compound").value;
  const batch    = document.getElementById("inv-batch").value;
  const box      = document.getElementById("inv-box").value;
  if (q)        p.set("q",        q);
  if (compound) p.set("compound", compound);
  if (batch)    p.set("batch",    batch);
  if (box)      p.set("box",      box);
  inv.samples = await api("/api/samples?" + p);
  invRenderList();
}

function invApplyFilters() { invLoadSamples(); }

function invRenderList() {
  const list = document.getElementById("inv-list");
  document.getElementById("inv-count").textContent =
    `${inv.samples.length} sample${inv.samples.length !== 1 ? "s" : ""}`;
  if (!inv.samples.length) {
    list.innerHTML = '<div class="placeholder" style="padding:20px;text-align:center;color:var(--fg-muted);">No samples</div>';
    return;
  }
  list.innerHTML = inv.samples.map((s) => `
    <div class="sample-item${inv.current && inv.current.id === s.id ? " active" : ""}" onclick="invSelectSample(${s.id})">
      <div class="s-name">${esc(s.name)}</div>
      <div class="s-meta">${esc(s.compound)}${s.batch ? " · " + esc(s.batch) : ""}${s.box ? " · Box " + esc(s.box) : ""}</div>
    </div>
  `).join("");
}

async function invSelectSample(id) {
  inv.current = await api(`/api/samples/${id}`);
  invRenderDetail();
  invRenderList();
}

function invRenderDetail() {
  const s = inv.current;
  document.getElementById("inv-detail-placeholder").style.display = "none";
  const dv = document.getElementById("inv-detail-view");
  dv.style.display = "flex";
  document.getElementById("detail-name").textContent = s.name;

  const items = [
    ["Compound", s.compound], ["Synthesized", s.synthesis_date],
    ["Batch", s.batch], ["Box", s.box], ["Crystal size", s.crystal_size],
  ].filter(([, v]) => v);
  document.getElementById("detail-meta").innerHTML =
    items.map(([k, v]) => `<div class="meta-item">${esc(k)}: <span>${esc(v)}</span></div>`).join("");

  const notesEl = document.getElementById("detail-notes");
  notesEl.textContent = s.notes || "";
  notesEl.style.display = s.notes ? "" : "none";

  invRenderSamplePhotos(s);
  invRenderMeasurements(s);
}

function invRenderSamplePhotos(s) {
  const el    = document.getElementById("sample-photos");
  const files = s.sample_files || [];
  el.innerHTML = `
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
      <span class="sec-label">Sample Photos</span>
      <button class="auth-write" style="font-size:11px;padding:2px 8px;" onclick="document.getElementById('sp-upload').click()">+ Photo</button>
      <input type="file" multiple accept="image/*" id="sp-upload" style="display:none" onchange="invUploadSamplePhoto(${s.id},this)">
    </div>
    ${files.length
      ? `<div class="gallery">${files.map((f) => `
          <div class="gallery-item">
            <img src="/files/${esc(f.path)}?v=${f.id}" alt="${esc(f.filename)}" loading="lazy"
              onclick="openLightbox('/files/${esc(f.path)}?v=${f.id}','${esc(f.filename)}')">
            <div class="img-name">${esc(f.filename)}</div>
            <button class="img-del auth-write" title="Delete" onclick="event.stopPropagation();invDeleteSamplePhoto(${s.id},${f.id})">✕</button>
          </div>`).join("")}</div>`
      : `<div style="font-size:12px;color:var(--fg-muted);">No photos yet</div>`}`;
}

function invRenderMeasurements(s) {
  const mSection = document.getElementById("inv-measurements");
  if (!s.experiments.length) {
    mSection.innerHTML = '<div class="placeholder">No experiments recorded yet</div>';
    return;
  }
  const typeLabel = { "ppms-vsm": "PPMS-VSM", "ppms-hc": "PPMS-HC", pxrd: "PXRD", sxrd: "SXRD", microscopy: "Microscopy" };
  mSection.innerHTML = `
    <div class="sec-label" style="padding:0 0 8px;">Measurements</div>
    ${s.experiments.map((exp) => {
      const images    = exp.files.filter((f) => f.file_type === "image" || f.file_type === "screenshot");
      const dataFiles = exp.files.filter((f) => f.file_type === "data");
      const label     = typeLabel[exp.type] || exp.type.toUpperCase();
      const isCustomOrient = exp.orientation && exp.orientation !== "OOP" && exp.orientation !== "IP";
      return `<div class="meas-card" id="meas-${exp.id}">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;">
          <span class="tag tag-${exp.type}">${label}</span>
          ${exp.exp_date ? `<span style="font-size:11px;color:var(--fg-muted);">${exp.exp_date}</span>` : ""}
          ${exp.type === "ppms-vsm" && exp.orientation ? `<span style="font-size:11px;color:var(--fg-muted);background:var(--bg-2,#eee);padding:1px 6px;border-radius:3px;">${esc(exp.orientation)}</span>` : ""}
          <div style="flex:1"></div>
          <button class="danger auth-write" style="font-size:11px;padding:2px 8px;" onclick="invDeleteMeasurement(${exp.id})">Delete</button>
        </div>

        ${exp.type === "ppms-vsm" ? `
        <div style="margin-bottom:10px;">
          <div class="sec-label">Orientation</div>
          <div class="exp-notes-view auth-write" id="exp-orient-view-${exp.id}" onclick="invStartEditOrientation(${exp.id})" title="Click to edit">${esc(exp.orientation || "Click to set orientation…")}</div>
          <div id="exp-orient-edit-${exp.id}" style="display:none;">
            <select id="exp-orient-sel-${exp.id}" onchange="invToggleCustomOrientationEdit(${exp.id})">
              <option value="OOP"${!isCustomOrient && exp.orientation !== "IP" ? " selected" : ""}>Out-of-Plane (OOP)</option>
              <option value="IP"${exp.orientation === "IP" ? " selected" : ""}>In-Plane (IP)</option>
              <option value="custom"${isCustomOrient ? " selected" : ""}>Custom…</option>
            </select>
            <input id="exp-orient-custom-${exp.id}" type="text" placeholder="Custom orientation name"
              value="${esc(isCustomOrient ? exp.orientation : "")}"
              style="display:${isCustomOrient ? "" : "none"};margin-top:4px;width:100%;box-sizing:border-box;">
            <div style="display:flex;gap:6px;margin-top:4px;">
              <button style="font-size:11px;padding:3px 8px;" class="primary auth-write" onclick="invSaveOrientation(${exp.id})">Save</button>
              <button style="font-size:11px;padding:3px 8px;" onclick="invCancelOrientation(${exp.id})">Cancel</button>
            </div>
          </div>
        </div>` : ""}

        <div style="margin-bottom:10px;">
          <div class="sec-label">Notes</div>
          <div class="exp-notes-view" id="exp-notes-view-${exp.id}" onclick="invStartEditNote(${exp.id})" title="Click to edit">${esc(exp.notes || "Click to add notes…")}</div>
          <div id="exp-notes-edit-${exp.id}" style="display:none;">
            <textarea class="exp-notes-input" id="exp-notes-ta-${exp.id}">${esc(exp.notes || "")}</textarea>
            <div style="display:flex;gap:6px;margin-top:4px;">
              <button style="font-size:11px;padding:3px 8px;" class="primary auth-write" onclick="invSaveNote(${exp.id})">Save</button>
              <button style="font-size:11px;padding:3px 8px;" onclick="invCancelNote(${exp.id})">Cancel</button>
            </div>
          </div>
        </div>

        <div style="margin-bottom:10px;">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
            <span class="sec-label">Photos</span>
            <button class="auth-write" style="font-size:11px;padding:2px 8px;" onclick="document.getElementById('ep-upload-${exp.id}').click()">+ Photo</button>
            <input type="file" multiple accept="image/*" id="ep-upload-${exp.id}" style="display:none" onchange="invUploadExpFile(${exp.id},'image',this)">
          </div>
          ${images.length
            ? `<div class="gallery">${images.map((f) => `
                <div class="gallery-item">
                  <img src="/files/${esc(f.path)}" alt="${esc(f.filename)}" loading="lazy"
                    onclick="openLightbox('/files/${esc(f.path)}','${esc(f.filename)}')">
                  <div class="img-name">${esc(f.filename)}</div>
                  <button class="img-del auth-write" title="Delete" onclick="event.stopPropagation();invDeleteExpFile(${exp.id},${f.id})">✕</button>
                </div>`).join("")}</div>`
            : `<div style="font-size:12px;color:var(--fg-muted);">No photos</div>`}
        </div>

        <div>
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
            <span class="sec-label">Data Files</span>
            <button class="auth-write" style="font-size:11px;padding:2px 8px;" onclick="document.getElementById('ed-upload-${exp.id}').click()">+ File</button>
            <input type="file" multiple id="ed-upload-${exp.id}" style="display:none" onchange="invUploadExpFile(${exp.id},'data',this)">
          </div>
          ${dataFiles.length
            ? `<div class="file-list">${dataFiles.map((f) => `
                <div class="file-row">
                  <span class="fname">${esc(f.filename)}</span>
                  <a href="/files/${esc(f.path)}" download="${esc(f.filename)}">↓</a>
                  <button class="f-del auth-write" title="Delete" onclick="invDeleteExpFile(${exp.id},${f.id})">✕</button>
                </div>`).join("")}</div>`
            : `<div style="font-size:12px;color:var(--fg-muted);">No data files</div>`}
        </div>
      </div>`;
    }).join("")}`;
}

// ── File upload / delete ─────────────────────────────────────────────────

async function invUploadSamplePhoto(sampleId, input) {
  if (!ensureWriteAuth()) return;
  for (const file of Array.from(input.files)) {
    const fd = new FormData(); fd.append("file", file);
    await api(`/api/samples/${sampleId}/files`, { method: "POST", body: fd });
  }
  input.value = "";
  if (inv.current) await invSelectSample(inv.current.id);
}

async function invDeleteSamplePhoto(sampleId, fileId) {
  if (!ensureWriteAuth()) return;
  if (!confirm("Delete this photo?")) return;
  await api(`/api/samples/${sampleId}/files/${fileId}`, { method: "DELETE" });
  if (inv.current) await invSelectSample(inv.current.id);
}

async function invUploadExpFile(expId, fileType, input) {
  if (!ensureWriteAuth()) return;
  for (const file of Array.from(input.files)) {
    const fd = new FormData(); fd.append("file", file);
    await api(`/api/experiments/${expId}/files?file_type=${fileType}`, { method: "POST", body: fd });
  }
  input.value = "";
  if (inv.current) await invSelectSample(inv.current.id);
}

async function invDeleteExpFile(expId, fileId) {
  if (!ensureWriteAuth()) return;
  if (!confirm("Delete this file?")) return;
  await api(`/api/experiments/${expId}/files/${fileId}`, { method: "DELETE" });
  if (inv.current) await invSelectSample(inv.current.id);
}

// ── Inline experiment notes editor ───────────────────────────────────────

function invStartEditNote(expId) {
  document.getElementById(`exp-notes-view-${expId}`).style.display = "none";
  document.getElementById(`exp-notes-edit-${expId}`).style.display = "";
  document.getElementById(`exp-notes-ta-${expId}`).focus();
}

function invCancelNote(expId) {
  const exp = inv.current?.experiments.find((e) => e.id === expId);
  document.getElementById(`exp-notes-ta-${expId}`).value         = exp?.notes || "";
  document.getElementById(`exp-notes-view-${expId}`).style.display = "";
  document.getElementById(`exp-notes-edit-${expId}`).style.display = "none";
}

async function invSaveNote(expId) {
  if (!ensureWriteAuth()) return;
  const exp = inv.current?.experiments.find((e) => e.id === expId);
  if (!exp) return;
  const body = document.getElementById(`exp-notes-ta-${expId}`).value;
  await api(`/api/experiments/${expId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sample_id: exp.sample_id, type: exp.type, exp_date: exp.exp_date, notes: body, orientation: exp.orientation }),
  });
  if (inv.current) await invSelectSample(inv.current.id);
}

// ── Inline orientation editor (ppms-vsm only) ────────────────────────────

function invStartEditOrientation(expId) {
  document.getElementById(`exp-orient-view-${expId}`).style.display = "none";
  document.getElementById(`exp-orient-edit-${expId}`).style.display = "";
}

function invCancelOrientation(expId) {
  document.getElementById(`exp-orient-view-${expId}`).style.display = "";
  document.getElementById(`exp-orient-edit-${expId}`).style.display = "none";
}

function invToggleCustomOrientationEdit(expId) {
  const sel    = document.getElementById(`exp-orient-sel-${expId}`)?.value;
  const custom = document.getElementById(`exp-orient-custom-${expId}`);
  if (custom) custom.style.display = sel === "custom" ? "" : "none";
}

async function invSaveOrientation(expId) {
  if (!ensureWriteAuth()) return;
  const exp = inv.current?.experiments.find((e) => e.id === expId);
  if (!exp) return;
  const sel = document.getElementById(`exp-orient-sel-${expId}`).value;
  const orientation = sel === "custom"
    ? (document.getElementById(`exp-orient-custom-${expId}`).value.trim() || null)
    : sel;
  await api(`/api/experiments/${expId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sample_id: exp.sample_id, type: exp.type, exp_date: exp.exp_date, notes: exp.notes, orientation }),
  });
  if (inv.current) await invSelectSample(inv.current.id);
}

async function invDeleteMeasurement(expId) {
  if (!ensureWriteAuth()) return;
  if (!confirm("Delete this measurement and all attached files?")) return;
  await api(`/api/experiments/${expId}`, { method: "DELETE" });
  if (inv.current) await invSelectSample(inv.current.id);
}

// ── Scan / Import ────────────────────────────────────────────────────────

async function triggerScan() {
  if (!ensureWriteAuth()) return;
  const st = document.getElementById("inv-scan-status");
  st.textContent = "Scanning…";
  try {
    const r = await api("/api/scan", { method: "POST" });
    st.textContent = `+${r.samples}s +${r.experiments}e +${r.files}f`;
    await invLoadFilters();
    await invLoadSamples();
    if (inv.current) await invSelectSample(inv.current.id);
  } catch (e) { st.textContent = "Error"; }
}

async function importFolder() {
  if (!ensureWriteAuth()) return;
  const input = document.getElementById("inv-folder-input");
  input.onchange = async () => {
    const files = Array.from(input.files);
    input.value = "";
    if (!files.length) return;
    const st = document.getElementById("inv-scan-status");
    st.textContent = `Uploading ${files.length} files…`;
    const formData = new FormData();
    for (const f of files) { formData.append("files", f); formData.append("paths", f.webkitRelativePath); }
    try {
      const r = await api("/api/scan/folder", { method: "POST", body: formData });
      st.textContent = `+${r.samples}s +${r.experiments}e +${r.files}f`;
      await invLoadFilters();
      await invLoadSamples();
      if (inv.current) await invSelectSample(inv.current.id);
    } catch (e) { st.textContent = "Error"; }
  };
  input.click();
}

// ── Modals (Add / Edit sample, Add experiment) ───────────────────────────

function openAddSample() {
  if (!ensureWriteAuth()) return;
  modalOpen("Add Sample", `
    <div class="form-row"><label>Name *</label><input id="f-name" placeholder="4Br-Mn-BA-001"></div>
    <div class="form-row"><label>Compound *</label><input id="f-compound" placeholder="4Br-Mn-BA"></div>
    <div class="form-row"><label>Synthesis date</label><input id="f-date" type="date"></div>
    <div class="form-row"><label>Batch</label><input id="f-batch"></div>
    <div class="form-row"><label>Box</label><input id="f-box"></div>
    <div class="form-row"><label>Crystal size</label><input id="f-size" placeholder="0.5 x 0.3 x 0.1 mm"></div>
    <div class="form-row"><label>Notes</label><textarea id="f-notes"></textarea></div>
  `, async () => {
    const payload = {
      name:           document.getElementById("f-name").value.trim(),
      compound:       document.getElementById("f-compound").value.trim(),
      synthesis_date: document.getElementById("f-date").value || null,
      batch:          document.getElementById("f-batch").value.trim() || null,
      box:            document.getElementById("f-box").value.trim()   || null,
      crystal_size:   document.getElementById("f-size").value.trim()  || null,
      notes:          document.getElementById("f-notes").value.trim() || null,
    };
    if (!payload.name || !payload.compound) return;
    await api("/api/samples", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    closeModal();
    await invLoadFilters();
    await invLoadSamples();
  });
}

async function deleteSample() {
  if (!ensureWriteAuth()) return;
  if (!inv.current) return;
  if (!confirm(`Delete sample "${inv.current.name}"? This cannot be undone.`)) return;
  await api(`/api/samples/${inv.current.id}`, { method: "DELETE" });
  inv.current = null;
  await invLoadFilters();
  await invLoadSamples();
}

function openEditSample() {
  if (!ensureWriteAuth()) return;
  const s = inv.current;
  modalOpen("Edit Sample", `
    <div class="form-row"><label>Compound *</label><input id="f-compound" value="${esc(s.compound)}"></div>
    <div class="form-row"><label>Synthesis date</label><input id="f-date" type="date" value="${s.synthesis_date || ""}"></div>
    <div class="form-row"><label>Batch</label><input id="f-batch" value="${esc(s.batch || "")}"></div>
    <div class="form-row"><label>Box</label><input id="f-box" value="${esc(s.box || "")}"></div>
    <div class="form-row"><label>Crystal size</label><input id="f-size" value="${esc(s.crystal_size || "")}"></div>
    <div class="form-row"><label>Notes</label><textarea id="f-notes">${esc(s.notes || "")}</textarea></div>
  `, async () => {
    const payload = {
      name:           s.name,
      compound:       document.getElementById("f-compound").value.trim(),
      synthesis_date: document.getElementById("f-date").value     || null,
      batch:          document.getElementById("f-batch").value.trim() || null,
      box:            document.getElementById("f-box").value.trim()   || null,
      crystal_size:   document.getElementById("f-size").value.trim()  || null,
      notes:          document.getElementById("f-notes").value.trim() || null,
    };
    await api(`/api/samples/${s.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    closeModal();
    await invLoadSamples();
    await invSelectSample(s.id);
  });
}

function openAddExperiment() {
  if (!ensureWriteAuth()) return;
  const s = inv.current;
  modalOpen("Add Experiment", `
    <div class="form-row"><label>Type *</label>
      <select id="f-exp-type" onchange="invToggleOrientationField()">
        <option value="ppms-vsm">PPMS-VSM</option><option value="ppms-hc">PPMS-HC</option>
        <option value="pxrd">PXRD</option><option value="sxrd">SXRD</option><option value="microscopy">Microscopy</option>
      </select>
    </div>
    <div class="form-row" id="f-orientation-row">
      <label>Orientation</label>
      <div>
        <select id="f-orientation-select" onchange="invToggleCustomOrientation()">
          <option value="OOP">Out-of-Plane (OOP)</option>
          <option value="IP">In-Plane (IP)</option>
          <option value="custom">Custom…</option>
        </select>
        <input id="f-orientation-custom" type="text" placeholder="Custom orientation name" style="display:none;margin-top:4px;width:100%;box-sizing:border-box;">
      </div>
    </div>
    <div class="form-row"><label>Date</label><input id="f-exp-date" type="date"></div>
    <div class="form-row"><label>Notes</label><textarea id="f-exp-notes"></textarea></div>
  `, async () => {
    const type = document.getElementById("f-exp-type").value;
    let orientation = null;
    if (type === "ppms-vsm") {
      const sel = document.getElementById("f-orientation-select").value;
      orientation = sel === "custom"
        ? (document.getElementById("f-orientation-custom").value.trim() || null)
        : sel;
    }
    const payload = {
      sample_id: s.id,
      type,
      exp_date:    document.getElementById("f-exp-date").value  || null,
      notes:       document.getElementById("f-exp-notes").value.trim() || null,
      orientation,
    };
    await api("/api/experiments", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    closeModal();
    await invSelectSample(s.id);
  });
}

function invToggleOrientationField() {
  const type = document.getElementById("f-exp-type")?.value;
  const row  = document.getElementById("f-orientation-row");
  if (row) row.style.display = type === "ppms-vsm" ? "" : "none";
}

function invToggleCustomOrientation() {
  const sel    = document.getElementById("f-orientation-select")?.value;
  const custom = document.getElementById("f-orientation-custom");
  if (custom) custom.style.display = sel === "custom" ? "" : "none";
}
