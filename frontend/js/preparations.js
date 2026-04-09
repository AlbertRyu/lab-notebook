// ═══════════════════════════════════════════════════════════════════════════
// PREPARATIONS — Samples waiting for measurement
// ═══════════════════════════════════════════════════════════════════════════

let _preparationsLoaded = false;
const prep = { samples: [], current: null };

// Called by main.js after tab HTML is injected
async function preparationsInit() {
  if (_preparationsLoaded) return;
  await prepLoadFilters();
  await prepLoadSamples();
  _preparationsLoaded = true;
}

async function prepLoadFilters() {
  try {
    const f = await api("/api/filters");
    prepPopSelect("prep-compound", f.compounds, "All compounds");
    prepPopSelect("prep-batch",    f.batches,   "All batches");
    prepPopSelect("prep-box",      f.boxes,     "All boxes");
  } catch (_) {}
}

function prepPopSelect(id, values, ph) {
  const sel = document.getElementById(id);
  const cur = sel.value;
  sel.innerHTML = `<option value="">${ph}</option>` +
    values.map((v) => `<option value="${esc(v)}"${v === cur ? " selected" : ""}>${esc(v)}</option>`).join("");
}

async function prepLoadSamples() {
  const p = new URLSearchParams();
  const q        = document.getElementById("prep-search-input").value.trim();
  const compound = document.getElementById("prep-compound").value;
  const batch    = document.getElementById("prep-batch").value;
  const box      = document.getElementById("prep-box").value;
  // Always filter to only samples without experiments
  p.set("has_experiments", "without");
  if (q)        p.set("q",        q);
  if (compound) p.set("compound", compound);
  if (batch)    p.set("batch",    batch);
  if (box)      p.set("box",      box);
  prep.samples = await api("/api/samples?" + p);
  prepRenderList();
}

function prepApplyFilters() { prepLoadSamples(); }

function prepRenderList() {
  const list = document.getElementById("prep-list");
  document.getElementById("prep-count").textContent =
    `${prep.samples.length} sample${prep.samples.length !== 1 ? "s" : ""} waiting`;
  if (!prep.samples.length) {
    list.innerHTML = '<div class="placeholder" style="padding:20px;text-align:center;color:var(--fg-muted);">No samples waiting for measurement</div>';
    return;
  }
  list.innerHTML = prep.samples.map((s) => `
    <div class="sample-item${prep.current && prep.current.id === s.id ? " active" : ""}" onclick="prepSelectSample(${s.id})">
      <div class="s-name">${esc(s.name)}</div>
      <div class="s-meta">${esc(s.compound)}${s.batch ? " · " + esc(s.batch) : ""}${s.box ? " · Box " + esc(s.box) : ""}</div>
    </div>
  `).join("");
}

async function prepSelectSample(id) {
  prep.current = await api(`/api/samples/${id}`);
  prepRenderDetail();
  prepRenderList();
}

function prepRenderDetail() {
  const s = prep.current;
  document.getElementById("prep-detail-placeholder").style.display = "none";
  const dv = document.getElementById("prep-detail-view");
  dv.style.display = "flex";
  document.getElementById("prep-detail-name").textContent = s.name;

  const items = [
    ["Compound", s.compound], ["Synthesized", s.synthesis_date],
    ["Batch", s.batch], ["Box", s.box], ["Crystal size", s.crystal_size],
  ].filter(([, v]) => v);
  document.getElementById("prep-detail-meta").innerHTML =
    items.map(([k, v]) => `<div class="meta-item">${esc(k)}: <span>${esc(v)}</span></div>`).join("");

  const notesEl = document.getElementById("prep-detail-notes");
  notesEl.textContent = s.notes || "";
  notesEl.style.display = s.notes ? "" : "none";

  prepRenderSamplePhotos(s);
}

function prepRenderSamplePhotos(s) {
  const el    = document.getElementById("prep-sample-photos");
  const files = s.sample_files || [];
  el.innerHTML = `
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
      <span class="sec-label">Sample Photos</span>
      <button class="auth-write" style="font-size:11px;padding:2px 8px;" onclick="document.getElementById('prep-sp-upload').click()">+ Photo</button>
      <input type="file" multiple accept="image/*" id="prep-sp-upload" style="display:none" onchange="prepUploadSamplePhoto(${s.id},this)">
    </div>
    ${files.length
      ? `<div class="gallery">${files.map((f) => `
          <div class="gallery-item">
            <img src="/files/${esc(f.path)}?v=${f.id}" alt="${esc(f.filename)}" loading="lazy"
              onclick="openLightbox('/files/${esc(f.path)}?v=${f.id}','${esc(f.filename)}')">
            <div class="img-name">${esc(f.filename)}</div>
            <button class="img-del auth-write" title="Delete" onclick="event.stopPropagation();prepDeleteSamplePhoto(${s.id},${f.id})">✕</button>
          </div>`).join("")}</div>`
      : `<div style="font-size:12px;color:var(--fg-muted);">No photos yet</div>`}`;
}

// ── File upload / delete ─────────────────────────────────────────────────

async function prepUploadSamplePhoto(sampleId, input) {
  if (!ensureWriteAuth()) return;
  for (const file of Array.from(input.files)) {
    const fd = new FormData(); fd.append("file", file);
    await api(`/api/samples/${sampleId}/files`, { method: "POST", body: fd });
  }
  input.value = "";
  if (prep.current) await prepSelectSample(prep.current.id);
}

async function prepDeleteSamplePhoto(sampleId, fileId) {
  if (!ensureWriteAuth()) return;
  if (!confirm("Delete this photo?")) return;
  await api(`/api/samples/${sampleId}/files/${fileId}`, { method: "DELETE" });
  if (prep.current) await prepSelectSample(prep.current.id);
}

// ── Modals (Add / Edit sample) ───────────────────────────────────────────

function _prepCompoundSelectHtml(currentValue) {
  const compounds = Array.from(document.getElementById("prep-compound").options)
    .map((o) => o.value).filter((v) => v);
  if (compounds.length === 0) {
    return `<input id="f-compound" type="text" placeholder="4Br-Mn-BA" value="${esc(currentValue || "")}">`;
  }
  const isCustom = !!currentValue && !compounds.includes(currentValue);
  const opts = compounds.map((c) =>
    `<option value="${esc(c)}"${c === currentValue && !isCustom ? " selected" : ""}>${esc(c)}</option>`
  ).join("");
  return `
    <select id="f-compound-sel" onchange="toggleModalCustomCompound()">
      ${!currentValue ? '<option value="">— select —</option>' : ""}
      ${opts}
      <option value="__custom__"${isCustom ? " selected" : ""}>Other…</option>
    </select>
    <input id="f-compound" type="text" placeholder="Type compound name"
      value="${esc(isCustom ? currentValue : "")}"
      style="display:${isCustom ? "" : "none"};margin-top:4px;width:100%;box-sizing:border-box;">`;
}

function prepOpenAddSample() {
  if (!ensureWriteAuth()) return;
  modalOpen("Add Sample", `
    <div class="form-row"><label>Name *</label><input id="f-name" placeholder="4Br-Mn-BA-001"></div>
    <div class="form-row"><label>Compound *</label>${_prepCompoundSelectHtml(null)}</div>
    <div class="form-row"><label>Synthesis date</label><input id="f-date" type="date"></div>
    <div class="form-row"><label>Batch</label><input id="f-batch"></div>
    <div class="form-row"><label>Box</label><input id="f-box"></div>
    <div class="form-row"><label>Crystal size</label><input id="f-size" placeholder="0.5 x 0.3 x 0.1 mm"></div>
    <div class="form-row"><label>Notes</label><textarea id="f-notes"></textarea></div>
  `, async () => {
    const payload = {
      name:           document.getElementById("f-name").value.trim(),
      compound:       getModalCompoundValue(),
      synthesis_date: document.getElementById("f-date").value || null,
      batch:          document.getElementById("f-batch").value.trim() || null,
      box:            document.getElementById("f-box").value.trim()   || null,
      crystal_size:   document.getElementById("f-size").value.trim()  || null,
      notes:          document.getElementById("f-notes").value.trim() || null,
    };
    if (!payload.name || !payload.compound) return;
    await api("/api/samples", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    closeModal();
    await prepLoadFilters();
    await prepLoadSamples();
  });
}

async function prepDeleteSample() {
  if (!ensureWriteAuth()) return;
  if (!prep.current) return;
  if (!confirm(`Delete sample "${prep.current.name}"?\n\nThis cannot be undone.`)) return;
  await api(`/api/samples/${prep.current.id}`, { method: "DELETE" });
  prep.current = null;
  await prepLoadFilters();
  await prepLoadSamples();
  // Reset detail view
  document.getElementById("prep-detail-view").style.display = "none";
  document.getElementById("prep-detail-placeholder").style.display = "flex";
}

function prepOpenEditSample() {
  if (!ensureWriteAuth()) return;
  const s = prep.current;
  modalOpen("Edit Sample", `
    <div class="form-row"><label>Compound *</label>${_prepCompoundSelectHtml(s.compound)}</div>
    <div class="form-row"><label>Synthesis date</label><input id="f-date" type="date" value="${s.synthesis_date || ""}"></div>
    <div class="form-row"><label>Batch</label><input id="f-batch" value="${esc(s.batch || "")}"></div>
    <div class="form-row"><label>Box</label><input id="f-box" value="${esc(s.box || "")}"></div>
    <div class="form-row"><label>Crystal size</label><input id="f-size" value="${esc(s.crystal_size || "")}"></div>
    <div class="form-row"><label>Notes</label><textarea id="f-notes">${esc(s.notes || "")}</textarea></div>
  `, async () => {
    const payload = {
      name:           s.name,
      compound:       getModalCompoundValue(),
      synthesis_date: document.getElementById("f-date").value     || null,
      batch:          document.getElementById("f-batch").value.trim() || null,
      box:            document.getElementById("f-box").value.trim()   || null,
      crystal_size:   document.getElementById("f-size").value.trim()  || null,
      notes:          document.getElementById("f-notes").value.trim() || null,
    };
    await api(`/api/samples/${s.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    closeModal();
    await prepLoadSamples();
    await prepSelectSample(s.id);
  });
}
