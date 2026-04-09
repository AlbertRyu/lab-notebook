// ═══════════════════════════════════════════════════════════════════════════
// BOX OVERVIEW
// ═══════════════════════════════════════════════════════════════════════════

let _bxLoaded = false;
let _bxData = []; // [{box, samples, description}]
let _bxDescriptions = {}; // current saved descriptions map

async function bxInit() {
  _bxLoaded = true;
  await bxLoad();
}

async function bxLoad() {
  try {
    _bxData = await api("/api/boxes");
    // Rebuild local descriptions map from loaded data
    _bxDescriptions = {};
    for (const row of _bxData) {
      if (row.description != null) _bxDescriptions[row.box] = row.description;
    }
    bxRender();
  } catch (e) {
    document.getElementById("bx-tbody").innerHTML =
      `<tr><td colspan="4" class="bx-empty">Error loading boxes: ${esc(e.message)}</td></tr>`;
  }
}

function bxRender() {
  const tbody = document.getElementById("bx-tbody");
  if (!_bxData.length) {
    tbody.innerHTML = `<tr><td colspan="4" class="bx-empty">No boxes found. Add samples with a box number in the Inventory tab.</td></tr>`;
    return;
  }

  tbody.innerHTML = _bxData
    .map((row) => {
      const sampleLinks = row.samples.length
        ? row.samples
            .map(
              (s) =>
                `<a href="#" class="bx-sample-link" onclick="bxGoToSample(${s.id});return false;">${esc(s.name)}</a>`
            )
            .join(", ")
        : `<span class="bx-none">—</span>`;

      const compounds = row.samples.length
        ? [...new Set(row.samples.map((s) => s.compound))].map(esc).join(", ")
        : `<span class="bx-none">—</span>`;

      const desc = esc(row.description || "");

      return `<tr data-box="${esc(row.box)}">
        <td class="bx-cell-box">${esc(row.box)}</td>
        <td class="bx-cell-samples">${sampleLinks}</td>
        <td class="bx-cell-compounds">${compounds}</td>
        <td class="bx-cell-desc"
            contenteditable="false"
            data-box="${esc(row.box)}"
            onblur="bxDescBlur(this)"
            onkeydown="if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();this.blur();}"
        >${desc}</td>
      </tr>`;
    })
    .join("");

  bxApplyAuth();
}

function bxApplyAuth() {
  document.querySelectorAll(".bx-cell-desc").forEach((cell) => {
    cell.contentEditable = auth.authenticated ? "true" : "false";
  });
}

function bxGoToSample(id) {
  showPage("inventory");
  invSelectSample(id);
}

function bxDescBlur(cell) {
  const box = cell.dataset.box;
  const value = cell.textContent.trim();
  bxSaveDescription(box, value);
}

async function bxSaveDescription(box, value) {
  if (value) {
    _bxDescriptions[box] = value;
  } else {
    delete _bxDescriptions[box];
  }
  try {
    await api("/api/boxes-config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ descriptions: _bxDescriptions }),
    });
  } catch (e) {
    alert("Failed to save description: " + e.message);
  }
}

function bxAddBox() {
  if (!ensureWriteAuth()) return;
  modalOpen("Add Box Entry", `
    <div class="form-row">
      <label>Box number / name</label>
      <input id="bx-new-name" type="text" placeholder="e.g. 42 or shelf-A">
    </div>
    <div class="form-row">
      <label>Description <span style="font-weight:normal;opacity:.6">(optional)</span></label>
      <input id="bx-new-desc" type="text" placeholder="What's in this box?">
    </div>
  `, async () => {
    const name = document.getElementById("bx-new-name").value.trim();
    if (!name) { alert("Box name is required."); return; }
    const desc = document.getElementById("bx-new-desc").value.trim();

    // Check if already exists
    const existing = _bxData.find((r) => r.box === name);
    if (existing) {
      alert(`Box "${name}" already exists.`);
      closeModal();
      return;
    }

    // Save description (even empty — the box appears because we add it to descriptions)
    _bxDescriptions[name] = desc || "";
    try {
      await api("/api/boxes-config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ descriptions: _bxDescriptions }),
      });
    } catch (e) {
      alert("Failed to save: " + e.message);
      return;
    }

    closeModal();
    await bxLoad();
  });
}
