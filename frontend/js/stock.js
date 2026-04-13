// ═══════════════════════════════════════════════════════════════════════════
// CRYSTAL STOCK
// ═══════════════════════════════════════════════════════════════════════════

let _stkLoaded = false;
let _stkBottles = []; // [{id, compound, crystal_count, notes, photo}]

async function stkInit() {
  _stkLoaded = true;
  await stkLoad();
}

async function stkLoad() {
  try {
    const data = await api("/api/stock-config");
    _stkBottles = data.bottles || [];
    stkRender();
  } catch (e) {
    document.getElementById("stk-grid").innerHTML =
      `<div class="stk-empty">Error loading stock: ${esc(e.message)}</div>`;
  }
}

function stkRender() {
  const grid = document.getElementById("stk-grid");
  const badge = document.getElementById("stk-total");
  const total = _stkBottles.reduce((s, b) => s + (b.crystal_count || 0), 0);
  badge.textContent = `${total} crystal${total !== 1 ? "s" : ""} total`;

  if (!_stkBottles.length) {
    grid.innerHTML = `<div class="stk-empty">No bottles recorded yet. Click "+ Add bottle" to get started.</div>`;
    return;
  }

  grid.innerHTML = _stkBottles
    .map((b) => {
      const photoHtml = b.photo
        ? `<img class="stk-photo" src="/files/stock/${esc(b.photo)}" alt="${esc(b.compound)}"
             onclick="openLightbox('/files/stock/${esc(b.photo)}','${esc(b.compound)}')">`
        : `<div class="stk-photo-placeholder" onclick="stkTriggerUpload('${esc(b.id)}')">
             <span class="stk-photo-icon">📷</span>
             <span class="stk-photo-hint">Add photo</span>
           </div>`;

      const photoDelBtn = b.photo
        ? `<button class="stk-photo-del auth-write" title="Remove photo" onclick="stkDeletePhoto('${esc(b.id)}')">✕</button>`
        : "";

      return `<div class="stk-card" data-id="${esc(b.id)}">
        <div class="stk-photo-wrap">
          ${photoHtml}
          ${photoDelBtn}
          <input type="file" class="stk-file-input" id="stk-file-${esc(b.id)}"
            accept="image/*" onchange="stkHandleFile('${esc(b.id)}',this)">
        </div>
        <div class="stk-body">
          <div class="stk-compound">${esc(b.compound)}</div>
          <div class="stk-count-row">
            <span class="stk-count-label">Crystals remaining:</span>
            <span class="stk-count">${b.crystal_count ?? 0}</span>
          </div>
          ${b.notes ? `<div class="stk-notes">${esc(b.notes)}</div>` : ""}
          <div class="stk-actions auth-write">
            <button onclick="stkEditBottle('${esc(b.id)}')">Edit</button>
            <button class="danger" onclick="stkDeleteBottle('${esc(b.id)}')">Delete</button>
          </div>
        </div>
      </div>`;
    })
    .join("");
}

async function stkSave() {
  await api("/api/stock-config", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ bottles: _stkBottles }),
  });
}

// ── Add ────────────────────────────────────────────────────────────────────

function stkAddBottle() {
  if (!ensureWriteAuth()) return;
  modalOpen(
    "Add Bottle",
    `<div class="form-row">
      <label>Compound</label>
      <input id="stk-new-compound" type="text" placeholder="e.g. 4Cl-Mn-BA" list="stk-datalist">
      <datalist id="stk-datalist">
        <option value="Mn-PEA">
        <option value="4Cl-Mn-BA">
        <option value="4Br-Mn-BA">
        <option value="4H-Mn-BA">
        <option value="4F-Mn-BA">
        <option value="4I-Mn-BA">
      </datalist>
    </div>
    <div class="form-row">
      <label>Crystal count</label>
      <input id="stk-new-count" type="number" min="0" placeholder="0">
    </div>
    <div class="form-row">
      <label>Notes <span style="font-weight:normal;opacity:.6">(optional)</span></label>
      <input id="stk-new-notes" type="text" placeholder="e.g. large clear, from batch 5">
    </div>`,
    async () => {
      const compound = document.getElementById("stk-new-compound").value.trim();
      if (!compound) {
        alert("Compound name is required.");
        return;
      }
      const count = parseInt(document.getElementById("stk-new-count").value) || 0;
      const notes = document.getElementById("stk-new-notes").value.trim();
      const id = String(Date.now());
      _stkBottles.push({ id, compound, crystal_count: count, notes, photo: null });
      try {
        await stkSave();
      } catch (e) {
        _stkBottles.pop();
        alert("Failed to save: " + e.message);
        return;
      }
      closeModal();
      stkRender();
    }
  );
}

// ── Edit ───────────────────────────────────────────────────────────────────

function stkEditBottle(id) {
  if (!ensureWriteAuth()) return;
  const b = _stkBottles.find((x) => x.id === id);
  if (!b) return;
  modalOpen(
    "Edit Bottle",
    `<div class="form-row">
      <label>Compound</label>
      <input id="stk-ed-compound" type="text" value="${esc(b.compound)}" list="stk-datalist2">
      <datalist id="stk-datalist2">
        <option value="Mn-PEA">
        <option value="4Cl-Mn-BA">
        <option value="4Br-Mn-BA">
        <option value="4H-Mn-BA">
        <option value="4F-Mn-BA">
        <option value="4I-Mn-BA">
      </datalist>
    </div>
    <div class="form-row">
      <label>Crystal count</label>
      <input id="stk-ed-count" type="number" min="0" value="${b.crystal_count ?? 0}">
    </div>
    <div class="form-row">
      <label>Notes</label>
      <input id="stk-ed-notes" type="text" value="${esc(b.notes || "")}">
    </div>`,
    async () => {
      const compound = document.getElementById("stk-ed-compound").value.trim();
      if (!compound) {
        alert("Compound name is required.");
        return;
      }
      b.compound = compound;
      b.crystal_count = parseInt(document.getElementById("stk-ed-count").value) || 0;
      b.notes = document.getElementById("stk-ed-notes").value.trim();
      try {
        await stkSave();
      } catch (e) {
        alert("Failed to save: " + e.message);
        return;
      }
      closeModal();
      stkRender();
    }
  );
}

// ── Delete ─────────────────────────────────────────────────────────────────

async function stkDeleteBottle(id) {
  if (!ensureWriteAuth()) return;
  const b = _stkBottles.find((x) => x.id === id);
  if (!b) return;
  if (!confirm(`Delete bottle "${b.compound}"? This cannot be undone.`)) return;
  if (b.photo) {
    try {
      await api(`/api/stock/photo/${encodeURIComponent(b.photo)}`, { method: "DELETE" });
    } catch (_) {}
  }
  _stkBottles = _stkBottles.filter((x) => x.id !== id);
  try {
    await stkSave();
  } catch (e) {
    alert("Failed to delete: " + e.message);
    return;
  }
  stkRender();
}

// ── Photo upload ───────────────────────────────────────────────────────────

function stkTriggerUpload(id) {
  if (!auth.authenticated) return;
  const input = document.getElementById(`stk-file-${id}`);
  if (input) input.click();
}

async function stkHandleFile(id, input) {
  const file = input.files[0];
  if (!file) return;
  const b = _stkBottles.find((x) => x.id === id);
  if (!b) return;
  const formData = new FormData();
  formData.append("file", file);
  try {
    const res = await fetch("/api/stock/photo", { method: "POST", body: formData });
    if (!res.ok) throw new Error(await res.text());
    const { filename } = await res.json();
    b.photo = filename;
    await stkSave();
    stkRender();
  } catch (e) {
    alert("Failed to upload photo: " + e.message);
  }
}

async function stkDeletePhoto(id) {
  if (!ensureWriteAuth()) return;
  const b = _stkBottles.find((x) => x.id === id);
  if (!b || !b.photo) return;
  try {
    await api(`/api/stock/photo/${encodeURIComponent(b.photo)}`, { method: "DELETE" });
    b.photo = null;
    await stkSave();
    stkRender();
  } catch (e) {
    alert("Failed to remove photo: " + e.message);
  }
}
