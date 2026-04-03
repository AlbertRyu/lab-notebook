// ═══════════════════════════════════════════════════════════════════════════
// PAGE 4 — ENTITY GRAPH
// ═══════════════════════════════════════════════════════════════════════════

let _graphLoaded = false;
const graph = {
  nodes: [], edges: [],
  simulation: null,
  nodeIndex: new Map(),
  dataPromise: null,
  cachedData: null,
  canvas: null, ctx: null,
  width: 0, height: 0, dpr: 1,
  hoverKey: null, dragKey: null, dragMode: null,
  pointerId: null, pointerDownX: 0, pointerDownY: 0, pointerDownTime: 0,
  panStartX: 0, panStartY: 0, viewStartX: 0, viewStartY: 0,
  view: { x: 0, y: 0, scale: 1 },
  animId: null, lastTs: 0,
  resizeObserver: null,
  degree: {},
  baseSize: { sample: 12, experiment: 10, note: 11 },
};

// ── Init ─────────────────────────────────────────────────────────────────

async function graphInit() {
  _graphLoaded = true;
  graphEnsureCanvas();
  graphResizeCanvas();
  graphSetStatus("Building graph…");
  graphDraw();
  graphWarmup();
  if (!graph.resizeObserver && window.ResizeObserver) {
    const wrap = document.getElementById("graph-canvas");
    if (wrap) {
      graph.resizeObserver = new ResizeObserver(() => {
        if (!document.getElementById("page-graph")?.classList.contains("active")) return;
        graphResizeCanvas();
        graphDraw();
      });
      graph.resizeObserver.observe(wrap);
    }
  }
  await graphRefresh();
}

// ── Canvas setup ──────────────────────────────────────────────────────────

function graphGetViewport() {
  const wrap = document.getElementById("graph-canvas");
  if (!wrap) return { width: 0, height: 0 };
  const rect = wrap.getBoundingClientRect();
  return { width: Math.max(1, rect.width), height: Math.max(1, rect.height) };
}

function graphEnsureCanvas() {
  const wrap = document.getElementById("graph-canvas");
  if (!wrap) return null;
  let canvas = wrap.querySelector("canvas");
  if (!canvas) {
    canvas = document.createElement("canvas");
    wrap.appendChild(canvas);
    canvas.addEventListener("pointerdown",   graphPointerDown);
    canvas.addEventListener("pointermove",   graphPointerMove);
    canvas.addEventListener("pointerup",     graphPointerUp);
    canvas.addEventListener("pointercancel", graphPointerUp);
    canvas.addEventListener("pointerleave",  graphPointerLeave);
    canvas.addEventListener("wheel",         graphWheel, { passive: false });
  }
  graph.canvas = canvas;
  graph.ctx    = canvas.getContext("2d");
  return canvas;
}

function graphResizeCanvas() {
  const canvas = graphEnsureCanvas();
  if (!canvas) return;
  const { width, height } = graphGetViewport();
  const dpr = window.devicePixelRatio || 1;
  graph.width  = width;
  graph.height = height;
  graph.dpr    = dpr;
  canvas.width  = Math.round(width  * dpr);
  canvas.height = Math.round(height * dpr);
  canvas.style.width  = `${width}px`;
  canvas.style.height = `${height}px`;
}

// ── Coordinate transforms ─────────────────────────────────────────────────

function graphWorldToScreen(x, y) {
  return { x: graph.width  / 2 + graph.view.x + x * graph.view.scale,
           y: graph.height / 2 + graph.view.y + y * graph.view.scale };
}
function graphScreenToWorld(x, y) {
  return { x: (x - graph.width  / 2 - graph.view.x) / graph.view.scale,
           y: (y - graph.height / 2 - graph.view.y) / graph.view.scale };
}

// ── Node helpers ──────────────────────────────────────────────────────────

function graphGetNodeByKey(key) { return graph.nodeIndex.get(key) || null; }
function graphNodeKey(kind, id) { return `${kind}:${id}`; }
function graphShort(text, n = 24) { if (!text) return ""; return text.length <= n ? text : text.slice(0, n - 1) + "…"; }

function graphNodeRadius(node) {
  const base   = graph.baseSize[node.kind] || 10;
  const degree = graph.degree?.[node.key]  || 0;
  return base + Math.min(6, Math.sqrt(degree));
}
function graphNodeLabel(node) {
  if (node.kind === "sample")     return node.label || `Sample #${node.id}`;
  if (node.kind === "experiment") return node.label || `Measurement #${node.id}`;
  return node.label || `Note #${node.id}`;
}

function graphNeighborSet() {
  const hovered = graph.hoverKey;
  if (!hovered) return null;
  const set = new Set([hovered]);
  graph.edges.forEach((edge) => {
    if (edge.source === hovered || edge.target === hovered) { set.add(edge.source); set.add(edge.target); }
  });
  return set;
}

function graphSetHover(key) {
  if (graph.hoverKey === key) return;
  graph.hoverKey = key;
  if (key) {
    const node = graphGetNodeByKey(key);
    if (node) graphSetStatus(`${node.hover || graphNodeLabel(node)} · ${node.kind}`);
  } else if (graph.nodes.length) {
    graphSetStatus(`${graph.nodes.length} nodes, ${graph.edges.length} edges.`);
  }
  graphDraw();
}

function graphSetStatus(msg) {
  const el = document.getElementById("graph-status");
  if (el) el.textContent = msg;
}

function graphExtractRefs(body) {
  const refs = [], re = /@\[[^\]]+\]\((sample|experiment|note):(\d+)\)/g;
  let m;
  while ((m = re.exec(body || "")) !== null) refs.push({ kind: m[1], id: parseInt(m[2]) });
  return refs;
}

function graphResolveKey(value) {
  if (!value) return null;
  return typeof value === "string" ? value : value.key || null;
}

// ── Data build ───────────────────────────────────────────────────────────

function graphWarmup() {
  if (!graph.dataPromise) {
    graph.dataPromise = graphBuildData()
      .then((data) => { graph.cachedData = data; return data; })
      .catch((err) => { graph.dataPromise = null; graph.cachedData = null; throw err; });
  }
  return graph.dataPromise;
}

async function graphBuildData() {
  const nodes = new Map(), edges = [], edgeSet = new Set();
  const samples       = await api("/api/samples").catch(() => []);
  const notesList     = await api("/api/notes").catch(() => []);
  const sampleDetails = await Promise.all(samples.map((s) => api(`/api/samples/${s.id}`).catch(() => null)));

  function addNode(kind, id, label, meta = {}) {
    const key = graphNodeKey(kind, id);
    if (!nodes.has(key)) nodes.set(key, { key, kind, id, label, ...meta });
  }
  function addEdge(source, target, rel) {
    const ek = `${source}|${target}|${rel}`;
    if (edgeSet.has(ek)) return;
    edgeSet.add(ek);
    edges.push({ source, target, rel });
  }

  samples.forEach((s) => addNode("sample", s.id, s.name, { hover: s.compound || "sample" }));
  sampleDetails.forEach((detail) => {
    if (!detail?.experiments) return;
    detail.experiments.forEach((exp) => {
      const label = `${EXP_TYPE_LABEL[exp.type] || exp.type.toUpperCase()} ${exp.exp_date || ""}`.trim();
      addNode("experiment", exp.id, label, { hover: `${detail.name} / ${label}`, sampleId: detail.id });
      addEdge(graphNodeKey("sample", detail.id), graphNodeKey("experiment", exp.id), "owns");
    });
  });
  notesList.forEach((n) => addNode("note", n.id, graphShort(n.title || `Untitled #${n.id}`), { hover: n.title || `Untitled #${n.id}` }));
  notesList.forEach((n) => {
    const src = graphNodeKey("note", n.id);
    graphExtractRefs(n.body).forEach((r) => {
      const dst = graphNodeKey(r.kind, r.id);
      if (nodes.has(dst) && src !== dst) addEdge(src, dst, "ref");
    });
  });

  const seededNodes = Array.from(nodes.values()).map((node, index) => {
    const angle  = (2 * Math.PI * index) / Math.max(1, nodes.size);
    const radius = 180 + Math.min(140, nodes.size * 4);
    return { ...node, x: radius * Math.cos(angle) + (Math.random() - 0.5) * 24, y: radius * Math.sin(angle) + (Math.random() - 0.5) * 24, vx: 0, vy: 0 };
  });

  const degree = {};
  seededNodes.forEach((node) => { degree[node.key] = 0; });
  edges.forEach((edge) => { degree[edge.source] = (degree[edge.source] || 0) + 1; degree[edge.target] = (degree[edge.target] || 0) + 1; });

  graph.degree    = degree;
  graph.nodeIndex = new Map(seededNodes.map((node) => [node.key, node]));
  graph.simulation = d3.forceSimulation(seededNodes)
    .force("charge", d3.forceManyBody().strength(-220))
    .force("center", d3.forceCenter(0, 0))
    .force("link", d3.forceLink(edges).id((d) => d.key).distance((e) => e.rel === "owns" ? 110 : 130).strength((e) => e.rel === "owns" ? 0.45 : 0.28))
    .force("collide", d3.forceCollide().radius((node) => graphNodeRadius(node) + 8).iterations(2))
    .alphaDecay(0.028).alphaMin(0.015);

  graph.nodes = seededNodes;
  graph.edges = edges;
  return { nodes: seededNodes, edges };
}

function graphInitPhysics(nodes, edges) {
  const seededNodes = (nodes || []).map((node, index) => {
    const angle  = (2 * Math.PI * index) / Math.max(1, nodes.length || 1);
    const radius = 180 + Math.min(140, (nodes.length || 0) * 4);
    return { ...node,
      x:  Number.isFinite(node?.x)  ? node.x  : radius * Math.cos(angle) + (Math.random() - 0.5) * 24,
      y:  Number.isFinite(node?.y)  ? node.y  : radius * Math.sin(angle) + (Math.random() - 0.5) * 24,
      vx: Number.isFinite(node?.vx) ? node.vx : 0,
      vy: Number.isFinite(node?.vy) ? node.vy : 0,
    };
  });
  const normalizedEdges = (edges || [])
    .map((edge) => ({ source: graphResolveKey(edge.source), target: graphResolveKey(edge.target), rel: edge.rel }))
    .filter((edge) => edge.source && edge.target);

  const degree = {};
  seededNodes.forEach((node) => { degree[node.key] = 0; });
  normalizedEdges.forEach((edge) => { degree[edge.source] = (degree[edge.source] || 0) + 1; degree[edge.target] = (degree[edge.target] || 0) + 1; });

  graph.degree    = degree;
  graph.nodeIndex = new Map(seededNodes.map((node) => [node.key, node]));
  graph.simulation = d3.forceSimulation(seededNodes)
    .force("charge", d3.forceManyBody().strength(-220))
    .force("center", d3.forceCenter(0, 0))
    .force("link", d3.forceLink(normalizedEdges).id((d) => d.key).distance((e) => e.rel === "owns" ? 110 : 130).strength((e) => e.rel === "owns" ? 0.45 : 0.28))
    .force("collide", d3.forceCollide().radius((node) => graphNodeRadius(node) + 8).iterations(2))
    .alphaDecay(0.028).alphaMin(0.015);

  graph.nodes = seededNodes;
  graph.edges = normalizedEdges;
}

function graphStepPhysics(dt) {
  if (!graph.simulation || !graph.nodes.length) return;
  const steps = Math.max(1, Math.min(5, Math.round(dt)));
  for (let i = 0; i < steps; i++) graph.simulation.tick();
}

// ── Rendering ─────────────────────────────────────────────────────────────

function graphDraw() {
  const ctx = graph.ctx, canvas = graph.canvas;
  if (!ctx || !canvas || !graph.nodes.length) return;

  const dark = document.documentElement.getAttribute("data-theme") === "dark"
            || document.documentElement.getAttribute("saved-theme") === "dark";
  const palette = dark
    ? { text: "#f4f4f5", muted: "#a1a1aa", sample: "#60a5fa", experiment: "#4ade80", note: "#fbbf24", edge: "rgba(148,163,184,0.34)", edgeSoft: "rgba(148,163,184,0.12)", bgLine: "rgba(255,255,255,0.05)" }
    : { text: "#111827", muted: "#555555", sample: "#2563eb", experiment: "#16a34a", note: "#f59e0b", edge: "rgba(100,116,139,0.26)", edgeSoft: "rgba(100,116,139,0.08)", bgLine: "rgba(17,24,39,0.04)" };

  const hovered   = graph.hoverKey;
  const activeSet = graphNeighborSet();
  const showLabels = graph.view.scale >= 0.72 || graph.nodes.length <= 80 || !!hovered;

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const offsetX = (graph.width  / 2 + graph.view.x) * graph.dpr;
  const offsetY = (graph.height / 2 + graph.view.y) * graph.dpr;
  const scale   = graph.view.scale * graph.dpr;

  ctx.save();
  ctx.setTransform(scale, 0, 0, scale, offsetX, offsetY);
  ctx.lineWidth = 1 / graph.view.scale;

  graph.edges.forEach((edge) => {
    const sourceKey = graphResolveKey(edge.source), targetKey = graphResolveKey(edge.target);
    if (!sourceKey || !targetKey) return;
    const source = graphGetNodeByKey(sourceKey), target = graphGetNodeByKey(targetKey);
    if (!source || !target) return;
    const active = !activeSet || (activeSet.has(sourceKey) && activeSet.has(targetKey));
    ctx.beginPath();
    ctx.moveTo(source.x, source.y);
    ctx.lineTo(target.x, target.y);
    ctx.strokeStyle = active ? palette.edge : palette.edgeSoft;
    ctx.stroke();
  });

  graph.nodes.forEach((node) => {
    const active = !activeSet || activeSet.has(node.key);
    const radius = graphNodeRadius(node);
    ctx.beginPath();
    ctx.arc(node.x, node.y, radius, 0, Math.PI * 2);
    ctx.fillStyle   = node.kind === "sample" ? palette.sample : node.kind === "experiment" ? palette.experiment : palette.note;
    ctx.globalAlpha = hovered && !active ? 0.26 : 1;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.lineWidth   = 1.5 / graph.view.scale;
    ctx.strokeStyle = dark
      ? (active ? "rgba(255,255,255,0.92)" : "rgba(255,255,255,0.3)")
      : (active ? "rgba(255,255,255,0.9)"  : "rgba(255,255,255,0.45)");
    ctx.stroke();
  });

  ctx.textAlign    = "center";
  ctx.textBaseline = "bottom";
  ctx.lineJoin     = "round";
  ctx.miterLimit   = 2;

  graph.nodes.forEach((node) => {
    const active = !activeSet || activeSet.has(node.key);
    if (!showLabels && !active) return;
    const r     = graphNodeRadius(node);
    const label = graphNodeLabel(node);
    ctx.font        = `${Math.max(10, Math.min(13, 12 / Math.max(graph.view.scale, 0.65)))}px 'Segoe UI', system-ui, Arial, sans-serif`;
    ctx.globalAlpha = hovered && !active ? 0.2 : 0.95;
    ctx.fillStyle   = palette.text;
    ctx.strokeStyle = dark ? "rgba(24,24,27,0.92)" : "rgba(255,255,255,0.92)";
    ctx.lineWidth   = 3;
    ctx.strokeText(label, node.x, node.y - r - 6 / graph.view.scale);
    ctx.fillText(  label, node.x, node.y - r - 6 / graph.view.scale);
  });
  ctx.restore();
}

// ── Hit testing ───────────────────────────────────────────────────────────

function graphHitTest(clientX, clientY) {
  const canvas = graph.canvas;
  if (!canvas) return null;
  const rect  = canvas.getBoundingClientRect();
  const world = graphScreenToWorld(clientX - rect.left, clientY - rect.top);
  let best = null, bestDist = Infinity;
  graph.nodes.forEach((node) => {
    const dx = node.x - world.x, dy = node.y - world.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const hitRadius = graphNodeRadius(node) + 12 / Math.max(graph.view.scale, 0.4);
    if (dist <= hitRadius && dist < bestDist) { best = node; bestDist = dist; }
  });
  return best;
}

// ── Pointer events ────────────────────────────────────────────────────────

function graphPointerDown(event) {
  if (!graph.canvas || !graph.nodes.length) return;
  const rect = graph.canvas.getBoundingClientRect();
  const x = event.clientX - rect.left, y = event.clientY - rect.top;
  const hit = graphHitTest(event.clientX, event.clientY);
  graph.pointerId      = event.pointerId;
  graph.pointerDownX   = x; graph.pointerDownY = y;
  graph.pointerDownTime = performance.now();
  graph.dragMode       = hit ? "node" : "pan";
  graph.dragKey        = hit ? hit.key : null;
  graph.panStartX      = x; graph.panStartY = y;
  graph.viewStartX     = graph.view.x; graph.viewStartY = graph.view.y;
  graph.canvas.setPointerCapture(event.pointerId);
  if (hit) {
    graphSetHover(hit.key);
    const node = graphGetNodeByKey(hit.key);
    if (node) { node.fx = node.x; node.fy = node.y; }
    graph.simulation?.alphaTarget(0.3).restart();
    graphStartAnimation();
  }
  graph.canvas.style.cursor = "grabbing";
  graphDraw();
}

function graphPointerMove(event) {
  if (!graph.canvas || !graph.nodes.length) return;
  const rect = graph.canvas.getBoundingClientRect();
  const x = event.clientX - rect.left, y = event.clientY - rect.top;
  if (graph.dragMode === "node" && graph.dragKey) {
    const node  = graphGetNodeByKey(graph.dragKey);
    if (!node) return;
    const world = graphScreenToWorld(x, y);
    node.fx = world.x; node.fy = world.y;
    node.x  = world.x; node.y  = world.y;
    graphDraw(); return;
  }
  if (graph.dragMode === "pan") {
    graph.view.x = graph.viewStartX + (x - graph.panStartX);
    graph.view.y = graph.viewStartY + (y - graph.panStartY);
    graphDraw(); return;
  }
  const hit = graphHitTest(event.clientX, event.clientY);
  graph.canvas.style.cursor = hit ? "pointer" : "grab";
  graphSetHover(hit ? hit.key : null);
}

function graphPointerUp(event) {
  if (!graph.canvas) return;
  const wasNodeDrag = graph.dragMode === "node" && graph.dragKey;
  const moved       = Math.hypot(
    graph.pointerDownX - (event.clientX - graph.canvas.getBoundingClientRect().left),
    graph.pointerDownY - (event.clientY - graph.canvas.getBoundingClientRect().top),
  ) > 6;
  const elapsed   = performance.now() - graph.pointerDownTime;
  const draggedKey = graph.dragKey;
  if (graph.pointerId !== null && graph.canvas.hasPointerCapture(graph.pointerId))
    graph.canvas.releasePointerCapture(graph.pointerId);
  if (wasNodeDrag && draggedKey) {
    const node = graphGetNodeByKey(draggedKey);
    if (node) { node.fx = null; node.fy = null; }
    if (!moved && elapsed < 300) graphNodeClick(draggedKey);
    graph.simulation?.alphaTarget(0);
  }
  graph.pointerId = null; graph.dragMode = null; graph.dragKey = null;
  graph.canvas.style.cursor = graph.hoverKey ? "pointer" : "grab";
  graphDraw();
}

function graphPointerLeave() {
  if (graph.dragMode) return;
  graphSetHover(null);
  if (graph.canvas) graph.canvas.style.cursor = "grab";
}

function graphWheel(event) {
  if (!graph.canvas || !graph.nodes.length) return;
  event.preventDefault();
  const rect   = graph.canvas.getBoundingClientRect();
  const mx = event.clientX - rect.left, my = event.clientY - rect.top;
  const before = graphScreenToWorld(mx, my);
  const factor = event.deltaY > 0 ? 0.92 : 1.08;
  graph.view.scale = Math.min(2.6, Math.max(0.35, graph.view.scale * factor));
  graph.view.x = mx - graph.width  / 2 - before.x * graph.view.scale;
  graph.view.y = my - graph.height / 2 - before.y * graph.view.scale;
  graphDraw();
}

// ── Animation loop ────────────────────────────────────────────────────────

function graphAnimate(ts) {
  if (!document.getElementById("page-graph")?.classList.contains("active")) { graphStopAnimation(); return; }
  if (!graph.lastTs) graph.lastTs = ts;
  const dtMs = Math.min(40, ts - graph.lastTs);
  graph.lastTs = ts;
  graphStepPhysics(dtMs / 16.67);
  graphDraw();
  if (graph.simulation && graph.simulation.alpha() > 0.02) {
    graph.animId = requestAnimationFrame(graphAnimate);
  } else {
    graph.animId = null;
  }
}

function graphStartAnimation() {
  if (graph.animId) return;
  graph.lastTs = 0;
  graph.animId = requestAnimationFrame(graphAnimate);
}

function graphStopAnimation() {
  if (graph.animId) cancelAnimationFrame(graph.animId);
  graph.animId = null;
  graph.lastTs = 0;
}

// ── Node click & refresh ──────────────────────────────────────────────────

function graphNodeClick(key) {
  const node = graphGetNodeByKey(key);
  if (!node) return;
  if (node.kind === "sample")     mentionJumpSample(node.id);
  else if (node.kind === "experiment") mentionJumpExperiment(node.id);
  else if (node.kind === "note")  mentionJumpNote(node.id);
}

async function graphRefresh() {
  graphSetStatus("Building graph…");
  graphStopAnimation();
  graph.simulation?.stop();
  graph.simulation = null;
  graph.nodes = []; graph.edges = [];
  graph.nodeIndex = new Map();
  graph.hoverKey = null; graph.dragKey = null; graph.dragMode = null;
  graph.view = { x: 0, y: 0, scale: 1 };

  const oldCanvas = document.querySelector("#graph-canvas canvas");
  if (oldCanvas) oldCanvas.remove();
  graph.canvas = null; graph.ctx = null;

  try {
    let data = graph.cachedData;
    if (!data) {
      try { data = await graphWarmup(); }
      catch (warmupErr) { graph.dataPromise = null; graph.cachedData = null; data = await graphBuildData(); }
    }
    const { nodes, edges } = data;
    if (!nodes.length) { graphResizeCanvas(); graphDraw(); graphSetStatus("No entities found."); return; }
    graphInitPhysics(nodes, edges);
    graphResizeCanvas();
    graphDraw();
    graphSetStatus(`${nodes.length} nodes, ${edges.length} edges.`);
    graphStartAnimation();
  } catch (e) {
    console.error("Graph build failed", e);
    graph.dataPromise = null;
    graph.cachedData  = null;
    graphSetStatus(`Graph build failed: ${e?.message || e}`);
  }
}
