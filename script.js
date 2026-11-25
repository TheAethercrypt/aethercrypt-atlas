
"use strict";

const $ = id => document.getElementById(id);
const NS = "http://www.w3.org/2000/svg";
const GRID = 40;
const MIN_ZOOM = 0.15;
const MAX_ZOOM = 3;

const state = {
  projectName: "The Aethercrypt: Atlas",
  width: 2400,
  height: 1600,
  zoom: 1,
  tool: "select",
  brushColor: "#8e718e",
  brushSize: 5,
  showGrid: false,
  snapGrid: false,
  layers: [{ id: "layer-main", name: "Layer 1", visible: true }],
  activeLayerId: "layer-main",
  objects: [],
  selectedId: null,
  maps: [],
  currentMapId: "main",
  parentMapId: null,
  drawing: null,
  panning: null,
  history: [],
  historyIndex: -1,
  suppressClick: false,
  draggingObject: null
};

const canvas = $("mapCanvas");
const viewport = $("canvasViewport");
const stage = $("canvasStage");
const objectGroup = $("mapObjects");
const overlay = $("interactionOverlay");

let toastTimer;

function uid(prefix = "item") {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}
function clone(value) { return JSON.parse(JSON.stringify(value)); }
function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
function currentMap() { return state.maps.find(m => m.id === state.currentMapId); }
function selectedObject() { return state.objects.find(o => o.id === state.selectedId); }

function showToast(message) {
  $("toast").textContent = message;
  $("toast").classList.add("visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $("toast").classList.remove("visible"), 2300);
}

function snapshot() {
  return {
    projectName: state.projectName,
    width: state.width,
    height: state.height,
    zoom: state.zoom,
    layers: clone(state.layers),
    activeLayerId: state.activeLayerId,
    objects: clone(state.objects),
    backgroundColor: state.backgroundColor || "#f2eadb",
    backgroundIsOcean: !!state.backgroundIsOcean
  };
}

function restore(data) {
  state.projectName = (!data.projectName || data.projectName === "Untitled World") ? "The Aethercrypt: Atlas" : data.projectName;
  state.width = clamp(Number(data.width) || 2400, 200, 12000);
  state.height = clamp(Number(data.height) || 1600, 200, 12000);
  state.zoom = clamp(Number(data.zoom) || 1, MIN_ZOOM, MAX_ZOOM);
  state.layers = Array.isArray(data.layers) && data.layers.length
    ? clone(data.layers)
    : [{ id: uid("layer"), name: "Layer 1", visible: true }];
  state.activeLayerId = state.layers.some(l => l.id === data.activeLayerId)
    ? data.activeLayerId : state.layers[0].id;
  state.objects = Array.isArray(data.objects) ? clone(data.objects) : [];
  state.backgroundColor = data.backgroundColor || "#f2eadb";
  state.backgroundIsOcean = !!data.backgroundIsOcean;
  $("canvasBackground").setAttribute("fill", state.backgroundIsOcean ? "url(#oceanWavePattern)" : state.backgroundColor);
  if ($("backgroundColor")) $("backgroundColor").value = state.backgroundColor;
  state.selectedId = null;
  state.drawing = null;
  overlay.replaceChildren();
  renderAll();
}

function saveHistory() {
  const encoded = JSON.stringify(snapshot());
  if (state.history[state.historyIndex] === encoded) return;
  state.history = state.history.slice(0, state.historyIndex + 1);
  state.history.push(encoded);
  if (state.history.length > 100) state.history.shift();
  state.historyIndex = state.history.length - 1;
  updateHistoryButtons();
}

function undo() {
  if (state.historyIndex <= 0) return;
  state.historyIndex--;
  restore(JSON.parse(state.history[state.historyIndex]));
  updateHistoryButtons();
  storeCurrentMap();
  showToast("Undo");
}
function redo() {
  if (state.historyIndex >= state.history.length - 1) return;
  state.historyIndex++;
  restore(JSON.parse(state.history[state.historyIndex]));
  updateHistoryButtons();
  storeCurrentMap();
  showToast("Redo");
}
function updateHistoryButtons() {
  $("undoBtn").disabled = state.historyIndex <= 0;
  $("redoBtn").disabled = state.historyIndex >= state.history.length - 1;
}

const toolHelp = {
  image: "Click the map to place the imported image.",
  select: "Select an object, edit its properties or link a region to a submap.",
  pan: "Drag to move around the canvas. You can also use the middle mouse button.",
  land: "Create land. Choose manual drawing or point-by-point in the popup.",
  freehand: "Create land. Choose manual drawing or point-by-point in the popup.",
  water: "Click to add points. Double-click or right-click to finish.",
  line: "Click the start point, then click the endpoint.",
  eraser: "Click an object to erase it.",
  label: "Click the canvas to add a text label. Select it to resize, curve or move it.",
  bucket: "Click a land or water shape to recolor the whole region with the brush color.",
  mountain: "Click anywhere to place a mountain stamp. Click again to add more.",
  lake: "Click to add lake points. Double-click or right-click to finish.",
  compass: "Click anywhere to place a compass rose."
};

function setTool(tool) {
  state.tool = tool;
  canvas.dataset.tool = tool;
  document.querySelectorAll(".tool-btn").forEach(button => {
    button.classList.toggle("active", button.dataset.tool === tool);
  });
  $("toolHint").textContent = toolHelp[tool] || "";
  $("toolTip").textContent = toolHelp[tool] || "";
}

function updateZoom() {
  canvas.style.width = `${state.width * state.zoom}px`;
  canvas.style.height = `${state.height * state.zoom}px`;
  $("zoomLabel").textContent = `${Math.round(state.zoom * 100)}%`;
}

function setZoom(value, anchorX = null, anchorY = null) {
  const oldZoom = state.zoom;
  const nextZoom = clamp(value, MIN_ZOOM, MAX_ZOOM);
  if (nextZoom === oldZoom) return;

  const viewportRect = viewport.getBoundingClientRect();
  const x = anchorX ?? viewportRect.width / 2;
  const y = anchorY ?? viewportRect.height / 2;

  const worldX = (viewport.scrollLeft + x) / oldZoom;
  const worldY = (viewport.scrollTop + y) / oldZoom;

  state.zoom = nextZoom;
  updateZoom();

  viewport.scrollLeft = Math.max(0, worldX * nextZoom - x);
  viewport.scrollTop = Math.max(0, worldY * nextZoom - y);
}

function fitCanvas() {
  const availableWidth = Math.max(100, viewport.clientWidth - 60);
  const availableHeight = Math.max(100, viewport.clientHeight - 60);
  state.zoom = clamp(
    Math.min(availableWidth / state.width, availableHeight / state.height),
    MIN_ZOOM,
    1
  );
  updateZoom();
  viewport.scrollTo({ left: 0, top: 0, behavior: "smooth" });
}

function updateCanvasDimensions() {
  canvas.setAttribute("width", state.width);
  canvas.setAttribute("height", state.height);
  canvas.setAttribute("viewBox", `0 0 ${state.width} ${state.height}`);
  $("canvasBackground").setAttribute("width", state.width);
  $("canvasBackground").setAttribute("height", state.height);
  $("canvasGrid").setAttribute("width", state.width);
  $("canvasGrid").setAttribute("height", state.height);
  $("canvasInfo").textContent = `${state.width} × ${state.height} px`;
  $("canvasWidth").value = state.width;
  $("canvasHeight").value = state.height;
  $("gridPattern").setAttribute("width", GRID);
  $("gridPattern").setAttribute("height", GRID);
  $("canvasGrid").setAttribute("visibility", state.showGrid ? "visible" : "hidden");
  updateZoom();
}

function renderAll() {
  updateCanvasDimensions();
  $("canvasBackground").setAttribute("fill", state.backgroundIsOcean ? "url(#oceanWavePattern)" : (state.backgroundColor || "#f2eadb"));
  renderObjects();
  renderLayers();
  renderProperties();
  updateProjectName();
  updateBreadcrumbs();
  renderSubmaps();
}

function updateProjectName() {
  const displayName = state.projectName === "Untitled World" ? "The Aethercrypt: Atlas" : state.projectName;
  $("projectName").textContent = displayName;
  // Keep the public page title stable for search engines; map names belong to the editor, not the website identity.
  document.title = "The Aethercrypt: Atlas";
}

function createSvgObject(obj) {
  let el;

  if (obj.type === "image") {
    el = document.createElementNS(NS, "image");
    el.setAttribute("x", obj.x || 0);
    el.setAttribute("y", obj.y || 0);
    el.setAttribute("width", obj.width || 360);
    el.setAttribute("height", obj.height || 240);
    el.setAttribute("href", obj.href || "");
    el.setAttribute("preserveAspectRatio", "xMidYMid meet");
  } else if (obj.type === "land" || obj.type === "water" || obj.type === "freehand") {
    el = document.createElementNS(NS, "polygon");
    el.setAttribute("points", (obj.points || []).map(p => `${p.x},${p.y}`).join(" "));
    el.setAttribute("fill", obj.color);
    el.setAttribute("fill-opacity", obj.type === "water" ? ".72" : ".88");
    el.setAttribute("stroke", obj.stroke || obj.color);
    el.setAttribute("stroke-width", obj.strokeWidth || 2);
    el.setAttribute("stroke-linejoin", "round");
    el.setAttribute("stroke-linecap", "round");
  } else if (obj.type === "line") {
    el = document.createElementNS(NS, "line");
    el.setAttribute("x1", obj.x1);
    el.setAttribute("y1", obj.y1);
    el.setAttribute("x2", obj.x2);
    el.setAttribute("y2", obj.y2);
    el.setAttribute("stroke", obj.color);
    el.setAttribute("stroke-width", obj.strokeWidth || 2);
    el.setAttribute("stroke-linecap", "round");
  } else if (obj.type === "label") {
    if (obj.curved) {
      el = document.createElementNS(NS, "g");
      const pathId = `curve-${obj.id}`;
      const defs = document.createElementNS(NS, "defs");
      const path = document.createElementNS(NS, "path");
      const width = Math.max(100, (obj.text || "Label").length * (obj.fontSize || 28) * .62);
      path.setAttribute("id", pathId);
      path.setAttribute("d", `M ${obj.x - width / 2} ${obj.y} Q ${obj.x} ${obj.y - Math.max(10, Number(obj.curveSize) || width * .18)} ${obj.x + width / 2} ${obj.y}`);
      defs.appendChild(path);
      const text = document.createElementNS(NS, "text");
      text.setAttribute("fill", obj.color);
      text.setAttribute("font-family", obj.fontFamily || "Georgia, serif");
      text.setAttribute("letter-spacing", obj.letterSpacing || 0);
      text.setAttribute("font-size", obj.fontSize || 28);
      const textPath = document.createElementNS(NS, "textPath");
      textPath.setAttribute("href", `#${pathId}`);
      textPath.setAttribute("startOffset", "50%");
      textPath.setAttribute("text-anchor", "middle");
      textPath.textContent = obj.text || "Label";
      text.appendChild(textPath);
      el.append(defs, text);
    } else {
      el = document.createElementNS(NS, "text");
      el.setAttribute("x", obj.x);
      el.setAttribute("y", obj.y);
      el.setAttribute("fill", obj.color);
      el.setAttribute("font-family", obj.fontFamily || "Georgia, serif");
      el.setAttribute("letter-spacing", obj.letterSpacing || 0);
      el.setAttribute("font-size", obj.fontSize || 28);
      el.textContent = obj.text || "Label";
    }
  } else if (obj.type === "mountain") {
    el = document.createElementNS(NS, "text");
    el.setAttribute("x", obj.x);
    el.setAttribute("y", obj.y);
    el.setAttribute("font-size", obj.size || 42);
    el.setAttribute("text-anchor", "middle");
    el.setAttribute("dominant-baseline", "central");
    el.textContent = "▲";
    el.setAttribute("fill", obj.color || "#78665b");
    el.setAttribute("stroke", "#3c3030");
    el.setAttribute("stroke-width", "1.2");
    el.setAttribute("paint-order", "stroke");
  }

  if (el && obj.type !== "line") {
    el.setAttribute("stroke-linejoin", "round");
  }
  return el;
}

function renderObjects() {
  objectGroup.replaceChildren();

  for (const layer of state.layers) {
    const group = document.createElementNS(NS, "g");
    group.setAttribute("visibility", layer.visible ? "visible" : "hidden");
    group.dataset.layerId = layer.id;

    state.objects.filter(o => o.layerId === layer.id).forEach(obj => {
      const el = createSvgObject(obj);
      if (!el) return;
      el.dataset.objectId = obj.id;
      if (obj.id === state.selectedId) el.classList.add("selected-object");
      group.appendChild(el);
    });

    objectGroup.appendChild(group);
  }
}

function renderLayers() {
  const list = $("layerList");
  list.replaceChildren();

  state.layers.forEach(layer => {
    const row = document.createElement("div");
    row.className = "layer-row";
    row.classList.toggle("active", layer.id === state.activeLayerId);

    const visible = document.createElement("button");
    visible.type = "button";
    visible.className = "layer-visibility";
    visible.textContent = layer.visible ? "◉" : "○";
    visible.title = "Toggle layer visibility";
    visible.addEventListener("click", () => {
      layer.visible = !layer.visible;
      renderAll();
      saveHistory();
      storeCurrentMap();
    });

    const select = document.createElement("button");
    select.type = "button";
    select.className = "layer-select";
    select.textContent = layer.name;
    select.addEventListener("click", () => {
      state.activeLayerId = layer.id;
      renderLayers();
    });

    row.append(visible, select);
    list.appendChild(row);
  });
}

function renderProperties() {
  const obj = selectedObject();
  $("selectionMessage").hidden = Boolean(obj);
  $("objectProperties").hidden = !obj;

  if (!obj) return;

  $("objectName").value = obj.name || obj.text || "";
  $("objectColor").value = /^#[0-9a-f]{6}$/i.test(obj.color || "")
    ? obj.color : "#a1b18a";
  $("textProperties").hidden = obj.type !== "label";
  if (obj.type === "label") {
    $("textSize").value = obj.fontSize || 28;
    $("textSizeLabel").textContent = obj.fontSize || 28;
    $("textCurved").checked = Boolean(obj.curved);
    $("textFont").value = obj.fontFamily || "Georgia, serif";
    $("textSpacing").value = obj.letterSpacing || 0;
    $("textSpacingLabel").textContent = obj.letterSpacing || 0;
    $("curveSize").value = obj.curveSize || 70;
    $("curveSizeLabel").textContent = obj.curveSize || 70;
    $("curveOptions").hidden = !obj.curved;
  }

  const canLink = ["land", "water", "lake", "freehand"].includes(obj.type);
  $("createRegionSubmapBtn").hidden = !canLink || Boolean(obj.linkedMapId);
  $("openRegionSubmapBtn").hidden = !obj.linkedMapId;
}

function addObject(obj) {
  obj.id = uid("object");
  obj.layerId = state.activeLayerId;
  obj.name = obj.name || "";
  state.objects.push(obj);
  state.selectedId = obj.id;
  renderAll();
  saveHistory();
  storeCurrentMap();
}

function pointFromEvent(event) {
  const rect = canvas.getBoundingClientRect();
  let x = (event.clientX - rect.left) * state.width / rect.width;
  let y = (event.clientY - rect.top) * state.height / rect.height;

  if (state.snapGrid && !state.drawing?.freehand) {
    x = Math.round(x / GRID) * GRID;
    y = Math.round(y / GRID) * GRID;
  }

  return { x: clamp(x, 0, state.width), y: clamp(y, 0, state.height) };
}

function drawPreview(point = null) {
  overlay.replaceChildren();
  if (!state.drawing) return;

  const d = state.drawing;
  const points = [...d.points];
  if (point) points.push(point);

  if (["land", "water", "freehand", "lake"].includes(d.type)) {
    const el = document.createElementNS(NS, "polygon");
    el.setAttribute("points", points.map(p => `${p.x},${p.y}`).join(" "));
    const previewColor = d.type === "water" ? "#78a9c9" : d.type === "lake" ? "#65a9a0" : state.brushColor;
    el.setAttribute("fill", previewColor);
    el.setAttribute("fill-opacity", ".3");
    el.setAttribute("stroke", previewColor);
    el.setAttribute("stroke-width", Math.max(1, state.brushSize / 2));
    el.setAttribute("stroke-dasharray", "5 4");
    overlay.appendChild(el);
  } else if (d.type === "line") {
    const start = d.points[0];
    const end = point || start;
    const el = document.createElementNS(NS, "line");
    el.setAttribute("x1", start.x);
    el.setAttribute("y1", start.y);
    el.setAttribute("x2", end.x);
    el.setAttribute("y2", end.y);
    el.setAttribute("stroke", state.brushColor);
    el.setAttribute("stroke-width", state.brushSize);
    el.setAttribute("stroke-dasharray", "5 4");
    overlay.appendChild(el);
  }
}

function finishPolygon() {
  const d = state.drawing;
  if (!d || !["land", "water", "freehand", "lake"].includes(d.type)) return;
  state.drawing = null;
  overlay.replaceChildren();

  if (d.points.length < 3) {
    showToast("A region needs at least three points.");
    return;
  }

  addObject({
    type: d.type,
    points: d.points,
    color: d.type === "water" ? "#78a9c9" : d.type === "lake" ? "#65a9a0" : state.brushColor,
    stroke: d.type === "water" ? "#477d9f" : d.type === "lake" ? "#397d77" : state.brushColor,
    strokeWidth: Math.max(1, state.brushSize / 2),
    waveDirection: "horizontal"
  });
}

function handleCanvasClick(event) {
  if (state.suppressClick) {
    state.suppressClick = false;
    return;
  }

  const hit = event.target.closest?.("[data-object-id]");
  const hitId = hit?.dataset.objectId;
  const point = pointFromEvent(event);

  if (state.tool === "select") {
    state.selectedId = hitId || null;
    renderAll();
    return;
  }

  if (state.tool === "eraser") {
    if (hitId) {
      state.objects = state.objects.filter(o => o.id !== hitId);
      state.selectedId = null;
      renderAll();
      saveHistory();
      storeCurrentMap();
    }
    return;
  }

  if (state.tool === "label") {
    const text = prompt("Enter your map label:", "New Location");
    if (text === null || !text.trim()) return;

    addObject({
      type: "label",
      text: text.trim(),
      x: point.x,
      y: point.y,
      color: state.brushColor,
      fontSize: Math.max(12, state.brushSize * 4),
      fontFamily: "Georgia, serif",
      letterSpacing: 0,
      curveSize: 70
    });
    return;
  }

  if (state.tool === "bucket") {
    const obj = state.objects.find(item => item.id === hitId);
    if (obj && ["land", "water", "freehand"].includes(obj.type)) {
      obj.color = state.brushColor;
      obj.stroke = state.brushColor;
      renderAll(); saveHistory(); storeCurrentMap();
    } else { showToast("Select a land or water region to fill it."); }
    return;
  }

  if (state.tool === "mountain") {
    addObject({ type: "mountain", x: point.x, y: point.y, color: state.brushColor, size: Math.max(24, state.brushSize * 7) });
    return;
  }

  if (["land", "water", "lake"].includes(state.tool)) {
    if (!state.drawing || state.drawing.type !== state.tool) {
      state.drawing = { type: state.tool, points: [point] };
    } else {
      state.drawing.points.push(point);
    }
    drawPreview();
    return;
  }

  if (state.tool === "line") {
    if (!state.drawing || state.drawing.type !== "line") {
      state.drawing = { type: "line", points: [point] };
      drawPreview(point);
    } else {
      const start = state.drawing.points[0];
      state.drawing = null;
      overlay.replaceChildren();
      addObject({
        type: "line",
        x1: start.x, y1: start.y,
        x2: point.x, y2: point.y,
        color: state.brushColor,
        strokeWidth: state.brushSize
      });
    }
  }
}

canvas.addEventListener("pointerdown", event => {
  if (state.tool === "pan" || event.button === 1) {
    event.preventDefault();
    state.panning = {
      x: event.clientX,
      y: event.clientY,
      left: viewport.scrollLeft,
      top: viewport.scrollTop,
      moved: false
    };
    canvas.setPointerCapture(event.pointerId);
    return;
  }

  if (state.tool === "select" && event.button === 0) {
    const hit = event.target.closest?.("[data-object-id]");
    const obj = hit ? state.objects.find(item => item.id === hit.dataset.objectId) : null;
    if (obj) {
      state.selectedId = obj.id;
      state.draggingObject = { id: obj.id, start: pointFromEvent(event), original: clone(obj), moved: false };
      canvas.setPointerCapture(event.pointerId);
      renderAll();
      return;
    }
  }

  if (state.tool === "freehand" && event.button === 0) {
    event.preventDefault();
    state.drawing = {
      type: "freehand",
      points: [pointFromEvent(event)],
      pointerId: event.pointerId
    };
    canvas.setPointerCapture(event.pointerId);
    drawPreview();
  }
});

canvas.addEventListener("pointermove", event => {
  if (state.panning) {
    const dx = event.clientX - state.panning.x;
    const dy = event.clientY - state.panning.y;
    if (Math.abs(dx) + Math.abs(dy) > 3) state.panning.moved = true;
    viewport.scrollLeft = state.panning.left - dx;
    viewport.scrollTop = state.panning.top - dy;
    return;
  }

  if (state.draggingObject) {
    const p = pointFromEvent(event);
    const dx = p.x - state.draggingObject.start.x;
    const dy = p.y - state.draggingObject.start.y;
    if (Math.abs(dx) + Math.abs(dy) > 1) state.draggingObject.moved = true;
    const obj = state.objects.find(item => item.id === state.draggingObject.id);
    const original = state.draggingObject.original;
    if (obj) {
      if (obj.points) obj.points = original.points.map(pt => ({ x: pt.x + dx, y: pt.y + dy }));
      else if (obj.type === "line") { obj.x1 = original.x1 + dx; obj.y1 = original.y1 + dy; obj.x2 = original.x2 + dx; obj.y2 = original.y2 + dy; }
      else { obj.x = original.x + dx; obj.y = original.y + dy; }
      renderObjects();
    }
    return;
  }

  if (state.drawing?.type === "freehand") {
    const p = pointFromEvent(event);
    const points = state.drawing.points;
    const last = points[points.length - 1];
    const minDistance = Math.max(1, state.brushSize / 2);

    if (Math.hypot(p.x - last.x, p.y - last.y) >= minDistance) {
      points.push(p);
      drawPreview();
    }
    return;
  }

  if (state.drawing) drawPreview(pointFromEvent(event));
});

function endPointer() {
  if (state.draggingObject) {
    const moved = state.draggingObject.moved;
    state.draggingObject = null;
    if (moved) { renderAll(); saveHistory(); storeCurrentMap(); }
    state.suppressClick = true;
    return;
  }
  if (state.panning) {
    state.suppressClick = state.panning.moved;
    state.panning = null;
    return;
  }

  if (state.drawing?.type === "freehand") finishPolygon();
}

canvas.addEventListener("pointerup", endPointer);
canvas.addEventListener("pointercancel", endPointer);

canvas.addEventListener("click", event => {
  if (state.tool === "pan" || state.tool === "freehand") return;
  handleCanvasClick(event);
});

canvas.addEventListener("dblclick", event => {
  if (["land", "water", "lake"].includes(state.tool)) {
    event.preventDefault();
    finishPolygon();
  }
});

canvas.addEventListener("contextmenu", event => {
  if (state.drawing && ["land", "water", "lake"].includes(state.drawing.type)) {
    event.preventDefault();
    finishPolygon();
  }
});

document.querySelectorAll(".tool-btn").forEach(button => {
  button.addEventListener("click", () => setTool(button.dataset.tool));
});

$("brushColor").addEventListener("input", event => {
  state.brushColor = event.target.value;
});

$("brushSize").addEventListener("input", event => {
  state.brushSize = Number(event.target.value);
  $("brushSizeLabel").textContent = state.brushSize;
});

$("showGrid").addEventListener("change", event => {
  state.showGrid = event.target.checked;
  updateCanvasDimensions();
});

$("snapGrid").addEventListener("change", event => {
  state.snapGrid = event.target.checked;
});

$("zoomInBtn").addEventListener("click", () => setZoom(state.zoom * 1.2));
$("zoomOutBtn").addEventListener("click", () => setZoom(state.zoom / 1.2));
$("fitBtn").addEventListener("click", fitCanvas);

viewport.addEventListener("wheel", event => {
  if (!event.ctrlKey && !event.metaKey) return;
  event.preventDefault();

  const rect = viewport.getBoundingClientRect();
  setZoom(
    state.zoom * (event.deltaY < 0 ? 1.1 : 1 / 1.1),
    event.clientX - rect.left,
    event.clientY - rect.top
  );
}, { passive: false });

$("undoBtn").addEventListener("click", undo);
$("redoBtn").addEventListener("click", redo);

$("addLayerBtn").addEventListener("click", () => {
  const name = prompt("Name your new layer:", `Layer ${state.layers.length + 1}`);
  if (!name?.trim()) return;
  const layer = { id: uid("layer"), name: name.trim(), visible: true };
  state.layers.push(layer);
  state.activeLayerId = layer.id;
  renderAll();
  saveHistory();
  storeCurrentMap();
});

$("objectName").addEventListener("change", event => {
  const obj = selectedObject();
  if (!obj) return;

  const name = event.target.value.trim();
  if (obj.type === "label") obj.text = name || "Label";
  obj.name = name;

  renderAll();
  saveHistory();
  storeCurrentMap();
});

$("objectColor").addEventListener("input", event => {
  const obj = selectedObject();
  if (!obj) return;
  obj.color = event.target.value;
  if (["land", "water", "freehand"].includes(obj.type)) obj.stroke = obj.color;
  renderObjects();
});

$("objectColor").addEventListener("change", () => {
  saveHistory();
  storeCurrentMap();
});

$("textSize").addEventListener("input", event => {
  const obj = selectedObject(); if (!obj || obj.type !== "label") return;
  obj.fontSize = Number(event.target.value);
  $("textSizeLabel").textContent = obj.fontSize; renderObjects();
});
$("textSize").addEventListener("change", () => { saveHistory(); storeCurrentMap(); });
$("textCurved").addEventListener("change", event => {
  const obj = selectedObject(); if (!obj || obj.type !== "label") return;
  obj.curved = event.target.checked; renderAll(); saveHistory(); storeCurrentMap();
});

$("renameProjectBtn").addEventListener("click", () => {
  const name = prompt("Rename this map:", state.projectName);
  if (!name || !name.trim()) return;
  state.projectName = name.trim().slice(0, 80);
  const map = currentMap(); if (map) map.name = state.projectName;
  updateProjectName(); updateBreadcrumbs(); renderSubmaps();
  saveHistory(); storeCurrentMap(); showToast("Map renamed.");
});

$("deleteObjectBtn").addEventListener("click", () => {
  if (!state.selectedId) return;
  state.objects = state.objects.filter(o => o.id !== state.selectedId);
  state.selectedId = null;
  renderAll();
  saveHistory();
  storeCurrentMap();
});

function captureCurrentMap() {
  return {
    id: state.currentMapId,
    parentId: state.parentMapId,
    name: state.projectName,
    data: snapshot()
  };
}

function storeCurrentMap() {
  const data = captureCurrentMap();
  const index = state.maps.findIndex(m => m.id === data.id);
  if (index < 0) state.maps.push(data);
  else state.maps[index] = data;
}

function ancestry(mapId) {
  const chain = [];
  const visited = new Set();
  let map = state.maps.find(m => m.id === mapId);

  while (map && !visited.has(map.id)) {
    visited.add(map.id);
    chain.unshift(map);
    map = map.parentId ? state.maps.find(m => m.id === map.parentId) : null;
  }

  return chain;
}

function updateBreadcrumbs() {
  const container = $("breadcrumbs");
  container.replaceChildren();

  ancestry(state.currentMapId).forEach((map, index) => {
    if (index) {
      const sep = document.createElement("span");
      sep.className = "breadcrumb-separator";
      sep.textContent = "›";
      container.appendChild(sep);
    }

    const button = document.createElement("button");
    button.className = "breadcrumb-btn";
    button.classList.toggle("current", map.id === state.currentMapId);
    button.textContent = map.name;
    button.addEventListener("click", () => switchMap(map.id));
    container.appendChild(button);
  });
}

function switchMap(id) {
  storeCurrentMap();
  const target = state.maps.find(m => m.id === id);
  if (!target) return;

  state.currentMapId = target.id;
  state.parentMapId = target.parentId || null;
  restore(clone(target.data));

  state.history = [];
  state.historyIndex = -1;
  saveHistory();
  renderAll();
  showToast(`Opened ${target.name}`);
}

function createSubmap(name, linkedObjectId = null) {
  storeCurrentMap();

  const parent = state.currentMapId;
  const id = uid("map");
  const layer = { id: uid("layer"), name: "Layer 1", visible: true };

  state.maps.push({
    id,
    parentId: parent,
    name,
    linkedObjectId,
    data: {
      projectName: name,
      width: 1200,
      height: 800,
      zoom: 1,
      layers: [layer],
      activeLayerId: layer.id,
      objects: []
    }
  });

  if (linkedObjectId) {
    const region = state.objects.find(o => o.id === linkedObjectId);
    if (region) region.linkedMapId = id;
    storeCurrentMap();
  }

  switchMap(id);
}

$("createRegionSubmapBtn").addEventListener("click", () => {
  const region = selectedObject();
  if (!region || !["land", "water", "lake", "freehand"].includes(region.type)) return;

  const defaultName = region.name || "New Region";
  const name = prompt("Name this region's submap:", `${defaultName} — Detailed Map`);
  if (!name?.trim()) return;

  createSubmap(name.trim(), region.id);
});

$("openRegionSubmapBtn").addEventListener("click", () => {
  const region = selectedObject();
  if (region?.linkedMapId) switchMap(region.linkedMapId);
});

function renderSubmaps() {
  const list = $("submapList");
  list.replaceChildren();

  if (!state.maps.length) {
    const empty = document.createElement("div");
    empty.className = "submap-empty";
    empty.textContent = "Your atlas is waiting to be explored. Create a submap to begin.";
    list.appendChild(empty);
    return;
  }

  state.maps.forEach(map => {
    const entry = document.createElement("div");
    entry.className = "submap-entry";
    entry.classList.toggle("current", map.id === state.currentMapId);

    const main = document.createElement("div");
    main.className = "submap-entry-main";

    const name = document.createElement("div");
    name.className = "submap-entry-name";
    name.textContent = map.name;

    const meta = document.createElement("div");
    meta.className = "submap-entry-meta";
    const parent = state.maps.find(m => m.id === map.parentId);
    meta.textContent = map.id === "main"
      ? "Main map"
      : `Submap · ${parent?.name || "Unknown parent"}`;

    main.append(name, meta);

    const open = document.createElement("button");
    open.type = "button";
    open.textContent = map.id === state.currentMapId ? "Here" : "Open";
    open.disabled = map.id === state.currentMapId;
    open.addEventListener("click", () => {
      switchMap(map.id);
      $("submapDialog").close();
    });

    entry.append(main, open);

    if (map.id !== "main") {
      const remove = document.createElement("button");
      remove.type = "button";
      remove.textContent = "×";
      remove.title = "Delete submap and descendants";
      remove.addEventListener("click", () => deleteSubmap(map.id));
      entry.appendChild(remove);
    }

    list.appendChild(entry);
  });
}

function descendants(id) {
  const ids = new Set([id]);
  let changed = true;

  while (changed) {
    changed = false;
    state.maps.forEach(map => {
      if (map.parentId && ids.has(map.parentId) && !ids.has(map.id)) {
        ids.add(map.id);
        changed = true;
      }
    });
  }

  return ids;
}

function deleteSubmap(id) {
  if (id === "main") return;
  const map = state.maps.find(m => m.id === id);
  if (!map || !confirm(`Delete "${map.name}" and all of its submaps?`)) return;

  storeCurrentMap();

  const parentId = map.parentId || "main";
  const removing = descendants(id);
  state.maps = state.maps.filter(m => !removing.has(m.id));

  // Remove broken region links after deleting their maps.
  state.maps.forEach(m => {
    m.data.objects.forEach(obj => {
      if (obj.linkedMapId && removing.has(obj.linkedMapId)) delete obj.linkedMapId;
    });
  });

  if (removing.has(state.currentMapId)) {
    state.currentMapId = parentId;
    const parent = state.maps.find(m => m.id === parentId) || state.maps[0];
    state.parentMapId = parent?.parentId || null;
    if (parent) restore(clone(parent.data));
  }

  storeCurrentMap();
  renderAll();
  showToast("Submap deleted.");
}

$("submapsBtn").addEventListener("click", () => {
  storeCurrentMap();
  renderSubmaps();
  $("submapDialog").showModal();
});

$("createSubmapForm").addEventListener("submit", event => {
  event.preventDefault();
  const name = $("submapName").value.trim();
  if (!name) return;
  createSubmap(name);
  $("submapName").value = "";
  $("submapDialog").close();
});

$("resizeBtn").addEventListener("click", () => {
  $("canvasWidth").value = state.width;
  $("canvasHeight").value = state.height;
  $("canvasSizeDialog").showModal();
});

$("canvasSizeForm").addEventListener("submit", event => {
  event.preventDefault();

  const width = Number($("canvasWidth").value);
  const height = Number($("canvasHeight").value);

  if (!Number.isFinite(width) || !Number.isFinite(height) ||
      width < 200 || width > 12000 || height < 200 || height > 12000) {
    showToast("Dimensions must be between 200 and 12000 px.");
    return;
  }

  saveHistory();
  state.width = Math.round(width);
  state.height = Math.round(height);
  updateCanvasDimensions();
  storeCurrentMap();
  saveHistory();
  $("canvasSizeDialog").close();
  showToast(`Canvas resized to ${state.width} × ${state.height}.`);
});

function safeFilename(name) {
  return (name || "atlas").replace(/[<>:"/\\|?*\x00-\x1F]/g, "-")
    .trim().replace(/\s+/g, "-").slice(0, 100) || "atlas";
}

function makeProjectFile() {
  storeCurrentMap();
  return {
    format: "aethercrypt-atlas",
    version: 3,
    currentMapId: state.currentMapId,
    maps: clone(state.maps)
  };
}

function downloadAtlasProject() {
  const blob = new Blob([JSON.stringify(makeProjectFile(), null, 2)], {
    type: "application/json"
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${safeFilename(state.projectName)}.atlas.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
  showToast("Project file download started. Keep a backup copy!");
}

$("saveBtn").addEventListener("click", () => {
  const warning = $("saveWarningDialog");
  if (warning && !warning.open) warning.showModal();
});

$("confirmSaveBtn")?.addEventListener("click", () => {
  $("saveWarningDialog")?.close();
  downloadAtlasProject();
});

$("openBtn").addEventListener("click", () => $("fileInput").click());

$("fileInput").addEventListener("change", async event => {
  const file = event.target.files?.[0];
  if (!file) return;

  try {
    const data = JSON.parse(await file.text());

    if (data.format === "aethercrypt-atlas" && Array.isArray(data.maps)) {
      const maps = data.maps.filter(m => m && typeof m.id === "string" && m.data);
      if (!maps.some(m => m.id === "main")) throw new Error("Missing main map");

      state.maps = clone(maps);
      state.currentMapId = maps.some(m => m.id === data.currentMapId)
        ? data.currentMapId : "main";

      const target = state.maps.find(m => m.id === state.currentMapId);
      state.parentMapId = target.parentId || null;
      restore(clone(target.data));
    } else {
      const mapData = data.data || data;
      state.maps = [{
        id: "main",
        parentId: null,
        name: mapData.projectName || "Untitled World",
        data: mapData
      }];
      state.currentMapId = "main";
      state.parentMapId = null;
      restore(clone(mapData));
    }

    storeCurrentMap();
    state.history = [];
    state.historyIndex = -1;
    saveHistory();
    renderAll();
    showToast("Project opened successfully.");
  } catch (error) {
    console.error(error);
    alert("Could not open this project. Please select a valid Atlas JSON file.");
  } finally {
    event.target.value = "";
  }
});

$("newBtn").addEventListener("click", () => {
  if (!confirm("Create a new atlas? Save your current project first if needed.")) return;

  state.projectName = "The Aethercrypt: Atlas";
  state.width = 2400;
  state.height = 1600;
  state.zoom = 1;
  state.layers = [{ id: uid("layer"), name: "Layer 1", visible: true }];
  state.activeLayerId = state.layers[0].id;
  state.objects = [];
  state.selectedId = null;
  state.maps = [];
  state.currentMapId = "main";
  state.parentMapId = null;
  state.drawing = null;
  state.history = [];
  state.historyIndex = -1;

  storeCurrentMap();
  renderAll();
  saveHistory();
  setTool("select");
  fitCanvas();
  showToast("New atlas created.");
});

$("exportBtn").addEventListener("click", () => {
  const svg = canvas.cloneNode(true);
  svg.setAttribute("xmlns", NS);
  svg.setAttribute("width", state.width);
  svg.setAttribute("height", state.height);
  svg.setAttribute("viewBox", `0 0 ${state.width} ${state.height}`);

  const source = new XMLSerializer().serializeToString(svg);
  const blob = new Blob([source], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const image = new Image();

  image.onload = () => {
    const output = document.createElement("canvas");
    output.width = state.width;
    output.height = state.height;
    const ctx = output.getContext("2d");
    ctx.fillStyle = "#f2eadb";
    ctx.fillRect(0, 0, output.width, output.height);
    ctx.drawImage(image, 0, 0);

    output.toBlob(png => {
      URL.revokeObjectURL(url);
      if (!png) {
        showToast("PNG export failed.");
        return;
      }

      const pngUrl = URL.createObjectURL(png);
      const a = document.createElement("a");
      a.href = pngUrl;
      a.download = `${safeFilename(state.projectName)}.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(pngUrl), 1000);
      showToast("Map exported as PNG.");
    }, "image/png");
  };

  image.onerror = () => {
    URL.revokeObjectURL(url);
    showToast("PNG export failed.");
  };

  image.src = url;
});

$("suggestionsBtn").addEventListener("click", () => $("suggestionsDialog").showModal());
$("suggestionForm").addEventListener("submit", async event => {
  event.preventDefault();
  const form = $("suggestionForm");
  const category = $("suggestionType").value;
  const message = $("suggestionText").value.trim();
  if (!message) return;
  const submitButton = form.querySelector('button[type="submit"]');
  submitButton.disabled = true;
  submitButton.textContent = "Sending…";
  try {
    // FormSubmit's AJAX endpoint expects form-encoded data (not JSON).
    const payload = new FormData();
    payload.append("name", "Aethercrypt Atlas community suggestion");
    payload.append("_subject", `Aethercrypt Atlas — ${category}`);
    payload.append("_template", "table");
    payload.append("_captcha", "false");
    payload.append("category", category);
    payload.append("message", message);
    payload.append("source", "The Aethercrypt: Atlas");
    const response = await fetch("https://formsubmit.co/ajax/jackiethearticwolf@gmail.com", {
      method: "POST", headers: { "Accept": "application/json" }, body: payload
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || result.success === false || result.success === "false") {
      throw new Error(result.message || `Email service returned ${response.status}.`);
    }
    showToast("Suggestion accepted by the email service. Check your inbox/spam folder.");
    $("suggestionText").value = "";
    $("suggestionsDialog").close();
  } catch (error) {
    console.error("Suggestion delivery failed:", error);
    showToast(`Suggestion not sent: ${error.message || "check your connection"}.`);
  } finally {
    submitButton.disabled = false;
    submitButton.textContent = "Send suggestion";
  }
});

$("aboutBtn").addEventListener("click", () => $("aboutDialog").showModal());

document.querySelectorAll("[data-close]").forEach(button => {
  button.addEventListener("click", () => {
    const dialog = $(button.dataset.close);
    if (dialog?.open) dialog.close();
  });
});

document.querySelectorAll("dialog").forEach(dialog => {
  dialog.addEventListener("click", event => {
    if (event.target === dialog) dialog.close();
  });
});

document.addEventListener("keydown", event => {
  const target = event.target;
  const typing = target instanceof HTMLElement &&
    (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));

  if (typing) return;

  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
    event.preventDefault();
    $("saveBtn").click();
  } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "o") {
    event.preventDefault();
    $("fileInput").click();
  } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
    event.preventDefault();
    undo();
  } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "y") {
    event.preventDefault();
    redo();
  } else if (event.key === "Escape" && state.drawing) {
    state.drawing = null;
    overlay.replaceChildren();
  }
});

storeCurrentMap();
renderAll();
saveHistory();
setTool("select");
fitCanvas();
updateHistoryButtons();

/* =========================================================
   THE AETHERCRYPT: ATLAS — INTEGRATED FEATURE EXPANSION
   These features are part of script.js; no extra JS file.
========================================================= */

state.backgroundColor = state.backgroundColor || "#f2eadb";

// Layer rename controls. Visibility toggles already exist in renderLayers().
const baseRenderLayers = renderLayers;
renderLayers = function () {
  baseRenderLayers();
  document.querySelectorAll(".layer-row").forEach((row, index) => {
    const layer = state.layers[index];
    if (!layer || row.querySelector(".layer-rename")) return;
    const rename = document.createElement("button");
    rename.type = "button";
    rename.className = "layer-rename";
    rename.textContent = "✎";
    rename.title = "Rename layer";
    rename.addEventListener("click", event => {
      event.stopPropagation();
      const nextName = prompt("Rename this layer:", layer.name);
      if (!nextName || !nextName.trim()) return;
      layer.name = nextName.trim().slice(0, 60);
      renderLayers();
      saveHistory();
      storeCurrentMap();
      showToast("Layer renamed.");
    });
    row.appendChild(rename);
  });
};

// Draw decorative wave patterns clipped to the water polygon.
const baseCreateSvgObject = createSvgObject;
createSvgObject = function (obj) {
  if (obj.type === "water") {
    const group = document.createElementNS(NS, "g");
    const base = baseCreateSvgObject(obj);
    group.appendChild(base);

    const points = obj.points || [];
    if (points.length >= 3) {
      const clipId = `water-clip-${obj.id}`;
      const defs = document.createElementNS(NS, "defs");
      const clip = document.createElementNS(NS, "clipPath");
      clip.setAttribute("id", clipId);
      const shape = document.createElementNS(NS, "polygon");
      shape.setAttribute("points", points.map(p => `${p.x},${p.y}`).join(" "));
      clip.appendChild(shape);
      defs.appendChild(clip);
      group.appendChild(defs);

      const xs = points.map(p => p.x), ys = points.map(p => p.y);
      const minX = Math.min(...xs), maxX = Math.max(...xs);
      const minY = Math.min(...ys), maxY = Math.max(...ys);
      const vertical = obj.waveDirection === "vertical";
      const start = vertical ? minX - 100 : minY - 100;
      const end = vertical ? maxX + 100 : maxY + 100;

      for (let offset = start; offset <= end; offset += 65) {
        const wave = document.createElementNS(NS, "path");
        const d = vertical
          ? `M ${offset} ${minY - 100} q -18 22 0 44 t 0 44 t 0 44 t 0 44 t 0 44 t 0 44 t 0 44 t 0 44 t 0 44 t 0 44 t 0 44 t 0 44 t 0 44 t 0 44 t 0 44`
          : `M ${minX - 100} ${offset} q 22 -18 44 0 t 44 0 t 44 0 t 44 0 t 44 0 t 44 0 t 44 0 t 44 0 t 44 0 t 44 0 t 44 0 t 44 0 t 44 0 t 44 0`;
        wave.setAttribute("d", d);
        wave.setAttribute("class", "water-wave");
        wave.setAttribute("clip-path", `url(#${clipId})`);
        group.appendChild(wave);
      }
    }
    return group;
  }

  if (obj.type === "lake") {
    const group = document.createElementNS(NS, "g");
    group.appendChild(baseCreateSvgObject({ ...obj, type: "water" }));
    const points = obj.points || [];
    if (points.length >= 3) {
      const cx = points.reduce((sum, p) => sum + p.x, 0) / points.length;
      const cy = points.reduce((sum, p) => sum + p.y, 0) / points.length;
      [0, 1, 2].forEach(i => {
        const ellipse = document.createElementNS(NS, "ellipse");
        ellipse.setAttribute("cx", cx);
        ellipse.setAttribute("cy", cy);
        ellipse.setAttribute("rx", 22 + i * 18);
        ellipse.setAttribute("ry", 10 + i * 8);
        ellipse.setAttribute("class", "lake-detail");
        group.appendChild(ellipse);
      });
    }
    return group;
  }

  if (obj.type === "compass") {
    const group = document.createElementNS(NS, "g");
    group.setAttribute("class", "compass-rose");
    const circle = document.createElementNS(NS, "circle");
    circle.setAttribute("cx", obj.x); circle.setAttribute("cy", obj.y);
    circle.setAttribute("r", 48); circle.setAttribute("fill", "#f2eadb");
    circle.setAttribute("fill-opacity", ".9"); circle.setAttribute("stroke", "#4b354f");
    circle.setAttribute("stroke-width", "3");
    const star = document.createElementNS(NS, "path");
    star.setAttribute("d", `M ${obj.x} ${obj.y-39} L ${obj.x+10} ${obj.y} L ${obj.x} ${obj.y+39} L ${obj.x-10} ${obj.y} Z M ${obj.x-39} ${obj.y} L ${obj.x} ${obj.y-10} L ${obj.x+39} ${obj.y} L ${obj.x} ${obj.y+10} Z`);
    star.setAttribute("fill", "#8e405c"); star.setAttribute("stroke", "#392638");
    star.setAttribute("stroke-width", "2");
    const north = document.createElementNS(NS, "text");
    north.setAttribute("x", obj.x); north.setAttribute("y", obj.y-57);
    north.setAttribute("font-size", "18"); north.setAttribute("fill", "#8e405c");
    north.textContent = "N";
    group.append(circle, star, north);
    return group;
  }

  return baseCreateSvgObject(obj);
};

// Text typography controls.
function updateSelectedLabel(property, value) {
  const obj = selectedObject();
  if (!obj || obj.type !== "label") return;
  obj[property] = value;
  renderObjects();
}
$("textFont").addEventListener("change", event => {
  updateSelectedLabel("fontFamily", event.target.value);
  saveHistory(); storeCurrentMap();
});
$("textSpacing").addEventListener("input", event => {
  const value = Number(event.target.value);
  $("textSpacingLabel").textContent = value;
  updateSelectedLabel("letterSpacing", value);
});
$("textSpacing").addEventListener("change", () => { saveHistory(); storeCurrentMap(); });
$("curveSize").addEventListener("input", event => {
  const value = Number(event.target.value);
  $("curveSizeLabel").textContent = value;
  updateSelectedLabel("curveSize", value);
});
$("curveSize").addEventListener("change", () => { saveHistory(); storeCurrentMap(); });
$("textCurved").addEventListener("change", () => {
  $("curveOptions").hidden = !$("textCurved").checked;
});

// Water wave direction is editable from the selected object's properties.
const waveLabel = document.createElement("label");
waveLabel.textContent = "Water wave direction";
waveLabel.htmlFor = "waveDirection";
const waveSelect = document.createElement("select");
waveSelect.id = "waveDirection";
waveSelect.className = "form-control";
waveSelect.innerHTML = '<option value="horizontal">Horizontal</option><option value="vertical">Vertical</option>';
$("objectProperties").insertBefore(waveLabel, $("createRegionSubmapBtn"));
$("objectProperties").insertBefore(waveSelect, $("createRegionSubmapBtn"));
const baseRenderProperties = renderProperties;
renderProperties = function () {
  baseRenderProperties();
  const obj = selectedObject();
  const isWater = obj?.type === "water";
  waveLabel.hidden = !isWater;
  waveSelect.hidden = !isWater;
  if (isWater) waveSelect.value = obj.waveDirection || "horizontal";
};
waveSelect.addEventListener("change", event => {
  const obj = selectedObject();
  if (!obj || obj.type !== "water") return;
  obj.waveDirection = event.target.value;
  renderObjects(); saveHistory(); storeCurrentMap();
});

// Lake drawing and compass placement use the existing canvas tools.
const baseHandleCanvasClick = handleCanvasClick;
handleCanvasClick = function (event) {
  if (state.tool === "compass") {
    const point = pointFromEvent(event);
    addObject({ type: "compass", x: point.x, y: point.y, name: "Compass Rose" });
    setTool("select");
    return;
  }
  baseHandleCanvasClick(event);
};
$("mapCanvas").addEventListener("dblclick", event => {
  if (state.tool !== "lake") return;
  event.preventDefault();
  finishPolygon();
});
$("mapCanvas").addEventListener("contextmenu", event => {
  if (state.tool !== "lake") return;
  event.preventDefault();
  finishPolygon();
});

// Canvas background and ocean conversion.
$("applyBackgroundBtn").addEventListener("click", () => {
  state.backgroundColor = $("backgroundColor").value;
  state.backgroundIsOcean = false;
  $("canvasBackground").setAttribute("fill", state.backgroundColor);
  saveHistory(); storeCurrentMap();
  showToast("Canvas background updated.");
});
$("makeOceanBtn").addEventListener("click", () => {
  if (!confirm("Turn the entire canvas into an ocean? Land shapes will be removed.")) return;
  state.backgroundColor = "#78a9c9";
  state.backgroundIsOcean = true;
  $("backgroundColor").value = state.backgroundColor;
  $("canvasBackground").setAttribute("fill", "url(#oceanWavePattern)");
  state.objects = state.objects.filter(obj => !["land", "freehand", "lake"].includes(obj.type));
  state.selectedId = null;
  renderAll(); saveHistory(); storeCurrentMap();
  showToast("The canvas is now a vast ocean.");
});

function transformSelectedShape(transformer, successMessage) {
  const obj = selectedObject();
  if (!obj || !["land", "freehand", "water", "lake"].includes(obj.type) || !Array.isArray(obj.points)) {
    showToast("Select a land, lake or water shape first.");
    return;
  }
  const xs = obj.points.map(p => p.x), ys = obj.points.map(p => p.y);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
  const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
  obj.points = obj.points.map(point => transformer(point, cx, cy));
  renderAll(); saveHistory(); storeCurrentMap(); showToast(successMessage);
}
$("rotateLandBtn").addEventListener("click", () => transformSelectedShape(
  (p, cx, cy) => ({ x: cx - (p.y - cy), y: cy + (p.x - cx) }),
  "Shape rotated 90 degrees."
));
$("flipLandBtn").addEventListener("click", () => transformSelectedShape(
  (p, cx) => ({ x: cx - (p.x - cx), y: p.y }),
  "Shape flipped horizontally."
));

// Grouping: select one object, then choose another; both move together.
$("groupObjectsBtn").addEventListener("click", () => {
  const first = selectedObject();
  if (!first) { showToast("Select the land or text you want to group first."); return; }
  const candidates = state.objects.filter(obj => obj.id !== first.id &&
    ["land", "freehand", "label"].includes(obj.type));
  if (!candidates.length) { showToast("Add another land shape or label first."); return; }
  const menu = candidates.map((obj, i) => `${i + 1}. ${obj.name || obj.text || obj.type}`).join("\n");
  const answer = prompt("Choose the object to group with the selected one:\n" + menu);
  if (answer === null) return;
  const second = candidates[Number(answer) - 1];
  if (!second) { showToast("That object number is not valid."); return; }
  const groupId = first.groupId || second.groupId || uid("group");
  first.groupId = groupId; second.groupId = groupId;
  saveHistory(); storeCurrentMap(); showToast("Objects grouped. Select and drag either one to move them together.");
});

let groupDragCopies = null;
$("mapCanvas").addEventListener("pointerdown", () => {
  groupDragCopies = null;
  if (!state.draggingObject) return;
  const selected = state.objects.find(obj => obj.id === state.draggingObject.id);
  if (!selected?.groupId) return;
  groupDragCopies = state.objects
    .filter(obj => obj.groupId === selected.groupId && obj.id !== selected.id)
    .map(obj => ({ id: obj.id, original: clone(obj) }));
});
$("mapCanvas").addEventListener("pointermove", event => {
  if (!state.draggingObject || !groupDragCopies?.length) return;
  const point = pointFromEvent(event);
  const dx = point.x - state.draggingObject.start.x;
  const dy = point.y - state.draggingObject.start.y;
  groupDragCopies.forEach(item => {
    const obj = state.objects.find(candidate => candidate.id === item.id);
    if (!obj) return;
    const original = item.original;
    if (original.points) obj.points = original.points.map(p => ({ x: p.x + dx, y: p.y + dy }));
    else if (original.type === "line") {
      obj.x1 = original.x1 + dx; obj.y1 = original.y1 + dy;
      obj.x2 = original.x2 + dx; obj.y2 = original.y2 + dy;
    } else { obj.x = original.x + dx; obj.y = original.y + dy; }
  });
  renderObjects();
});
$("mapCanvas").addEventListener("pointerup", () => { groupDragCopies = null; });
$("mapCanvas").addEventListener("pointercancel", () => { groupDragCopies = null; });

// Surprise feature: compass rose placement.
$("compassToolBtn").addEventListener("click", () => {
  setTool("compass");
  showToast("Click anywhere on the map to place a compass rose.");
});

// Tutorial placeholder.
$("tutorialBtn").addEventListener("click", () => $("tutorialDialog").showModal());

// Re-render after installing extensions so the controls reflect the current map.
renderAll();


/* ================================================================
   AETHERCRYPT ATLAS — ADVANCED CARTOGRAPHY EXTENSION
   Borders, realms, routes, islands, stamps, legends, notes,
   layer ordering/groups, pins and historical timeline snapshots.
   ================================================================ */

state.pinGroups = state.pinGroups || ["Settlements", "Landmarks", "Danger zones", "Custom"];
state.timeline = state.timeline || [];
state.activeEra = state.activeEra || "Present";
state.layerGroups = state.layerGroups || [];
state.privateNotes = state.privateNotes || [];
state.exportPrivateNotes = state.exportPrivateNotes || false;
state.drawMode = "points";

const atlasTools = ["island", "border", "trade", "coast", "frame", "river"];
const atlasHelp = {
  island: "Create a small island. Point mode: click vertices, double-click to finish. Manual mode: drag to sketch.",
  border: "Draw political borders or realm boundaries. Click points, then double-click to finish.",
  trade: "Draw a trade route between settlements. Use point mode or manual mode.",
  coast: "Add a decorative coastline stroke along any shore.",
  frame: "Draw a rectangular decorative frame around an area of your map."
};

// Add font families without replacing the original choices.
const fontSelect = $("textFont");
if (fontSelect && ![...fontSelect.options].some(o => o.text === "Cinzel")) {
  [
    ["'Cinzel', Georgia, serif", "Cinzel"],
    ["'Uncial Antiqua', Georgia, serif", "Uncial Antiqua"],
    ["'Cormorant Garamond', Georgia, serif", "Cormorant Garamond"],
    ["'IM Fell English', Georgia, serif", "IM Fell English"],
    ["'Trebuchet MS', sans-serif", "Trebuchet MS"]
  ].forEach(([value, label]) => { const option=document.createElement("option"); option.value=value; option.textContent=label; fontSelect.appendChild(option); });
}
const fontLink = document.createElement("link");
fontLink.rel = "stylesheet";
fontLink.href = "https://fonts.googleapis.com/css2?family=Alegreya+SC:wght@400;700&family=Cinzel:wght@400;600;700&family=Cinzel+Decorative:wght@400;700&family=Cormorant+Garamond:wght@400;600;700&family=IM+Fell+English&family=MedievalSharp&family=Pirata+One&family=Uncial+Antiqua&family=UnifrakturMaguntia&display=swap";
document.head.appendChild(fontLink);

function svgEl(tag, attrs={}) { const el=document.createElementNS(NS,tag); Object.entries(attrs).forEach(([k,v])=>el.setAttribute(k,v)); return el; }
function addAtlasObject(obj) { obj.id=uid("object"); obj.layerId=state.activeLayerId; obj.name=obj.name||obj.type; state.objects.push(obj); state.selectedId=obj.id; renderAll(); saveHistory(); storeCurrentMap(); }
function addStamp(type, p) {
  const common={type,x:p.x,y:p.y,color:state.brushColor,size:Math.max(28,state.brushSize*8)};
  if(type==="volcano") addAtlasObject({...common,name:"Volcano"});
  if(type==="city") addAtlasObject({...common,name:"City",size:Math.max(24,state.brushSize*6)});
  if(type==="village") addAtlasObject({...common,name:"Village",size:Math.max(20,state.brushSize*5)});
  if(type==="capital") addAtlasObject({...common,name:"Capital",size:Math.max(38,state.brushSize*9)});
  if(type==="pin") {
    const group=$("pinGroupSelect")?.value||"Settlements";
    const label=prompt(`Name this ${group.toLowerCase()} pin:`, "Unnamed place");
    if(label===null)return;
    addAtlasObject({...common,type:"pin",name:label.trim()||"Unnamed place",group,color:"#b64d65"});
  }
}

// Extend SVG rendering while preserving all existing object renderers.
const originalCreateSvgObject = createSvgObject;
createSvgObject = function(obj) {
  let el=originalCreateSvgObject(obj);
  if(el) return el;
  const color=obj.color||"#8e718e", size=obj.size||32;
  if(obj.type==="volcano") {
    el=svgEl("g",{transform:`translate(${obj.x} ${obj.y})`});
    el.append(svgEl("path",{d:`M ${-size*.65} ${size*.5} L ${-size*.2} ${-size*.35} L 0 ${size*.05} L ${size*.22} ${-size*.42} L ${size*.68} ${size*.5} Z`,fill:"#66505a",stroke:"#30232b","stroke-width":2}));
    el.append(svgEl("path",{d:`M ${-size*.2} ${-size*.35} Q 0 ${-size*.8} ${size*.22} ${-size*.42}`,fill:"none",stroke:"#d75a4a","stroke-width":Math.max(3,size*.12),"stroke-linecap":"round"}));
    el.append(svgEl("path",{d:`M ${-size*.12} ${size*.22} L 0 ${-size*.12} L ${size*.13} ${size*.22}`,fill:"none",stroke:"#e99b52","stroke-width":3}));
  } else if(["city","village","capital"].includes(obj.type)) {
    el=svgEl("g",{transform:`translate(${obj.x} ${obj.y})`});
    const isCap=obj.type==="capital", isVillage=obj.type==="village";
    const w=size*(isVillage?.72:1), h=size*(isVillage?.7:1);
    el.append(svgEl("rect",{x:-w/2,y:-h*.15,width:w,height:h*.62,rx:2,fill:isCap?"#d7b56d":color,stroke:"#342638","stroke-width":2}));
    el.append(svgEl("path",{d:`M ${-w*.62} ${-h*.15} L 0 ${-h*.72} L ${w*.62} ${-h*.15} Z`,fill:isCap?"#8e354b":"#6b4b59",stroke:"#342638","stroke-width":2}));
    el.append(svgEl("rect",{x:-w*.1,y:h*.1,width:w*.2,height:h*.37,fill:"#342638"}));
    if(isCap) el.append(svgEl("path",{d:`M 0 ${-h*.95} l ${-h*.13} ${h*.2} h ${h*.26} Z`,fill:"#e8c56e",stroke:"#5a3c2c","stroke-width":1}));
    if(isVillage) el.append(svgEl("path",{d:`M ${-w*.5} ${h*.55} l ${w*.5} ${-h*.28} l ${w*.5} ${h*.28}`,fill:"none",stroke:"#b79b76","stroke-width":2}));
  } else if(obj.type==="pin") {
    el=svgEl("g",{transform:`translate(${obj.x} ${obj.y})`});
    el.append(svgEl("path",{d:`M 0 ${size*.65} C ${-size*.15} ${size*.25}, ${-size*.55} ${-size*.05}, ${-size*.45} ${-size*.42} A ${size*.45} ${size*.45} 0 1 1 ${size*.45} ${-size*.42} C ${size*.55} ${-size*.05}, ${size*.15} ${size*.25}, 0 ${size*.65} Z`,fill:obj.color||"#b64d65",stroke:"#382537","stroke-width":2}));
    el.append(svgEl("circle",{cx:0,cy:-size*.42,r:size*.13,fill:"#fff0dc"}));
    const t=svgEl("text",{x:0,y:size*.92,"text-anchor":"middle","font-size":Math.max(12,size*.32),fill:color,"font-family":"Georgia,serif"});t.textContent=obj.name||"Pin";el.append(t);
  }
  return el;
};

// Border/realm/trade/coastline/frame objects are layered SVG strokes.
const baseCreateSvgObject2=createSvgObject;
createSvgObject=function(obj){
  if(["border","trade","coast","frame","river"].includes(obj.type)){
    const pts=obj.points||[]; const d=pts.map((p,i)=>`${i?"L":"M"} ${p.x} ${p.y}`).join(" ");
    if(obj.type==="frame"){
      const a=pts[0]||{x:0,y:0}, b=pts[1]||a;
      return svgEl("rect",{x:Math.min(a.x,b.x),y:Math.min(a.y,b.y),width:Math.abs(b.x-a.x),height:Math.abs(b.y-a.y),fill:"none",stroke:obj.color||"#6c4d75","stroke-width":obj.strokeWidth||8,"stroke-dasharray":obj.pattern||"none",rx:obj.radius||0});
    }
    const path=svgEl("path",{d,fill:"none",stroke:obj.color||"#6d526f","stroke-width":obj.strokeWidth||3,"stroke-linecap":"round","stroke-linejoin":"round"});
    if(obj.type==="border") {path.setAttribute("stroke-dasharray",obj.pattern||"10 7");path.setAttribute("stroke-width",obj.strokeWidth||4);}
    if(obj.type==="trade") {path.setAttribute("stroke-dasharray","3 8");path.setAttribute("stroke-width",obj.strokeWidth||5);}
    if(obj.type==="coast") {path.setAttribute("stroke-width",obj.strokeWidth||5);path.setAttribute("stroke-dasharray","2 5");}
    if(obj.type==="river") {path.setAttribute("stroke", "#5c9fc0");path.setAttribute("stroke-width", (obj.strokeWidth||5)*1.8);path.setAttribute("stroke-linecap","round");}
    return path;
  }
  return baseCreateSvgObject2(obj);
};

// Keep the extra object types in the SVG selection and rendering pipeline.
const originalRenderLayers = renderLayers;
renderLayers=function(){
  originalRenderLayers();
  const rows=[...$("layerList").children];
  rows.forEach((row,index)=>{
    const layer=state.layers[index]; if(!layer)return;
    const up=document.createElement("button");up.className="layer-rename";up.textContent="↑";up.title="Move layer up";
    up.addEventListener("click",()=>moveLayer(index,-1));
    const down=document.createElement("button");down.className="layer-rename";down.textContent="↓";down.title="Move layer down";
    down.addEventListener("click",()=>moveLayer(index,1));
    row.append(up,down);
  });
};
function moveLayer(index,delta){const next=index+delta;if(next<0||next>=state.layers.length)return;[state.layers[index],state.layers[next]]=[state.layers[next],state.layers[index]];renderAll();saveHistory();storeCurrentMap();}
$("layerUpBtn")?.addEventListener("click",()=>{const i=state.layers.findIndex(l=>l.id===state.activeLayerId);moveLayer(i,-1);});
$("layerDownBtn")?.addEventListener("click",()=>{const i=state.layers.findIndex(l=>l.id===state.activeLayerId);moveLayer(i,1);});
$("layerList")?.addEventListener("click",()=>setTimeout(applyLayerOpacity,0));
// Layer opacity is independent for every layer and is applied to its SVG group.
function applyLayerOpacity(){const layer=state.layers.find(l=>l.id===state.activeLayerId);if(!layer)return;const value=Math.round((layer.opacity??1)*100);if($("layerOpacity")){$("layerOpacity").value=value;$("layerOpacityLabel").textContent=value;}}
const renderObjectsWithOpacity=renderObjects;
renderObjects=function(){renderObjectsWithOpacity();objectGroup.querySelectorAll(":scope > g[data-layer-id]").forEach(group=>{const layer=state.layers.find(l=>l.id===group.dataset.layerId);group.setAttribute("opacity",layer?.opacity??1);});};
$("layerOpacity")?.addEventListener("input",e=>{const layer=state.layers.find(l=>l.id===state.activeLayerId);if(!layer)return;layer.opacity=Number(e.target.value)/100;$("layerOpacityLabel").textContent=e.target.value;renderObjects();});
$("layerOpacity")?.addEventListener("change",()=>{saveHistory();storeCurrentMap();});
const renderAllWithLayerOpacity=renderAll;
renderAll=function(){renderAllWithLayerOpacity();applyLayerOpacity();};


// Layer groups are named collections; toggling a group toggles all its layers.
$("layerGroupBtn")?.addEventListener("click",()=>{
 const name=prompt("Name this layer group:","Continent group");if(!name?.trim())return;
 const ids=state.layers.filter(l=>confirm(`Include layer “${l.name}” in ${name}?`)).map(l=>l.id);
 if(!ids.length)return;state.layerGroups.push({id:uid("layergroup"),name:name.trim(),layerIds:ids});
 saveHistory();storeCurrentMap();showToast(`Layer group “${name}” created.`);
});
$("renameLayerGroupBtn")?.addEventListener("click",()=>{
 if(!state.layerGroups.length){showToast("Create a layer group first.");return;}
 const menu=state.layerGroups.map((g,i)=>`${i+1}. ${g.name}`).join("\n");const n=Number(prompt("Choose group number to toggle visibility:\n"+menu));const g=state.layerGroups[n-1];if(!g)return;
 const visible=!g.layerIds.every(id=>state.layers.find(l=>l.id===id)?.visible);
 g.layerIds.forEach(id=>{const l=state.layers.find(x=>x.id===id);if(l)l.visible=visible;});renderAll();saveHistory();storeCurrentMap();
});

// The main drawing menu changes the active tool and the drawing mode together.
$("drawMode")?.addEventListener("change",e=>{state.drawMode=e.target.value;showToast(`Drawing mode: ${state.drawMode==="points"?"point by point":"manual freehand"}.`);});
document.querySelectorAll(".tool-btn").forEach(btn=>{
 const tool=btn.dataset.tool;
 if(atlasTools.includes(tool))btn.addEventListener("click",()=>{setTool(tool);showToast(`${toolHelp[tool]||atlasHelp[tool]} Mode: ${state.drawMode}.`);});
});

// Stamp tools and pins.
const originalCanvasClickForAtlas=handleCanvasClick;
handleCanvasClick=function(event){
 const p=pointFromEvent(event), hit=event.target.closest?.("[data-object-id]"), hitId=hit?.dataset.objectId;
 if(["volcano","city","village","capital","pin"].includes(state.tool)){addStamp(state.tool,p);return;}
 if(["island","border","trade","coast","frame","river"].includes(state.tool)){
   if(state.drawMode==="manual")return; // pointer handlers below own manual drawing
   if(state.tool==="frame"){
     if(!state.drawing){state.drawing={type:"frame",points:[p]};drawPreview(p);}else{const start=state.drawing.points[0];state.drawing=null;overlay.replaceChildren();addAtlasObject({type:"frame",points:[start,p],color:state.brushColor,strokeWidth:Math.max(3,state.brushSize)});}return;
   }
   if(!state.drawing||state.drawing.type!==state.tool)state.drawing={type:state.tool,points:[p]};else state.drawing.points.push(p);
   drawPreview();return;
 }
 originalCanvasClickForAtlas(event);
};

// Manual drawing for island, borders, routes and coasts: press, drag, release.
let manualStroke=null;
canvas.addEventListener("pointerdown",e=>{
 if(true)return; // superseded by the unified manual-drawing handler below
 if(state.drawMode!=="manual"||!["island","border","trade","coast"].includes(state.tool)||e.button!==0)return;
 e.preventDefault();manualStroke={type:state.tool,points:[pointFromEvent(e)]};canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener("pointermove",e=>{
 if(!manualStroke)return;const p=pointFromEvent(e),last=manualStroke.points.at(-1);if(Math.hypot(p.x-last.x,p.y-last.y)>4)manualStroke.points.push(p);
 overlay.replaceChildren();const path=svgEl("polyline",{points:manualStroke.points.map(q=>`${q.x},${q.y}`).join(" "),fill:manualStroke.type==="island"?"#9eaa83":"none", "fill-opacity":".25",stroke:manualStroke.type==="trade"?"#c59a55":"#8e718e","stroke-width":Math.max(2,state.brushSize),"stroke-dasharray":manualStroke.type==="border"?"10 7":manualStroke.type==="trade"?"3 8":"none"});overlay.append(path);
});
function endManualStroke(){if(!manualStroke)return;const d=manualStroke;manualStroke=null;overlay.replaceChildren();if(d.points.length<2)return;if(d.type==="island"&&d.points.length<3){showToast("An island needs a few more points.");return;}addAtlasObject({type:d.type,points:d.points,color:d.type==="island"?"#a6b18b":state.brushColor,strokeWidth:Math.max(2,state.brushSize),name:d.type==="island"?"Island":d.type});}
canvas.addEventListener("pointerup",endManualStroke);canvas.addEventListener("pointercancel",endManualStroke);

// Complete the point-based special paths on double click or right click.
function finishAtlasPath(){
 const d=state.drawing;
 if(!d || !atlasTools.includes(d.type) || d.type==="frame") return;
 state.drawing=null; overlay.replaceChildren();
 const closed=["island"].includes(d.type);
 const min=closed?3:2;
 if(d.points.length<min){showToast(`${d.type} needs at least ${min} points.`);return;}
 const colors={island:"#a6b18b",river:"#5c9fc0",border:"#8e526e",trade:"#c59a55",coast:"#6c9caa"};
 addAtlasObject({type:d.type,points:d.points.map(p=>({x:p.x,y:p.y})),color:colors[d.type]||state.brushColor,strokeWidth:Math.max(2,state.brushSize),name:d.type==="island"?"Island":d.type==="border"?"Political border":d.type==="trade"?"Trade route":d.type==="river"?"River":"Coastline"});
}
canvas.addEventListener("dblclick",e=>{if(atlasTools.includes(state.tool)){e.preventDefault();finishAtlasPath();}});
canvas.addEventListener("contextmenu",e=>{if(state.drawing&&atlasTools.includes(state.drawing.type)){e.preventDefault();finishAtlasPath();}});

// Custom legend: creates a movable map legend as a text label object.
$("legendBtn")?.addEventListener("click",()=>{
 const title=prompt("Legend title:","MAP LEGEND");if(title===null)return;
 const lines=prompt("Legend entries (one per line; use symbol — meaning):","◆ — Capital\n● — City\n⌂ — Village\n〰 — River");if(lines===null)return;
 const x=Number(prompt("Legend X position:","180"))||180,y=Number(prompt("Legend Y position:","180"))||180;
 addAtlasObject({type:"label",name:"Custom legend",text:`${title}\n${lines}`,x,y,color:state.brushColor,fontSize:24,fontFamily:"Georgia, serif",letterSpacing:1});
});

// Private notes are stored in project JSON; optional export as map text.
$("privateNotesBtn")?.addEventListener("click",()=>{
 const note=prompt("Private cartographer's note (not visible on the map):","");if(note===null)return;
 state.privateNotes.push({id:uid("note"),text:note,created:new Date().toISOString()});
 const include=confirm("Include private notes in the next PNG export? (No keeps them private.)");state.exportPrivateNotes=include;
 saveHistory();storeCurrentMap();showToast(include?"Note saved; it will be included in PNG export.":"Private note saved outside the map artwork.");
});

// Timeline mapper stores a complete snapshot for each named historical era.
$("timelineBtn")?.addEventListener("click",()=>{
 const action=prompt("Timeline Mapper\n1 = Save current era\n2 = Load an era\n3 = Delete an era","1");if(!action)return;
 if(action==="1"){
  const name=prompt("Name this historical era:",state.activeEra||"Before the War");if(!name?.trim())return;
  const existing=state.timeline.findIndex(e=>e.name===name.trim());const era={id:uid("era"),name:name.trim(),data:snapshot(),savedAt:new Date().toISOString()};
  if(existing>=0)state.timeline[existing]=era;else state.timeline.push(era);state.activeEra=era.name;saveHistory();storeCurrentMap();showToast(`Era “${era.name}” archived.`);
 }else if(action==="2"){
  if(!state.timeline.length){showToast("No historical eras saved yet.");return;}
  const menu=state.timeline.map((e,i)=>`${i+1}. ${e.name}`).join("\n"),n=Number(prompt("Load which era?\n"+menu));const era=state.timeline[n-1];if(!era)return;
  if(!confirm(`Load “${era.name}”? Save your current map as an era first if you want to preserve it.`))return;
  restore(clone(era.data));state.activeEra=era.name;saveHistory();storeCurrentMap();showToast(`Loaded era: ${era.name}`);
 }else if(action==="3"){
  const menu=state.timeline.map((e,i)=>`${i+1}. ${e.name}`).join("\n"),n=Number(prompt("Delete which era?\n"+menu));if(!state.timeline[n-1])return;
  if(confirm(`Delete “${state.timeline[n-1].name}”?`)){state.timeline.splice(n-1,1);storeCurrentMap();showToast("Historical era deleted.");}
 }
});

// Pin groups are user-defined and can be renamed/classified freely.
$("managePinGroupsBtn")?.addEventListener("click",()=>{
 const action=prompt("Pin groups\n1 = Add group\n2 = Rename group\n3 = Remove group","1");if(!action)return;
 if(action==="1"){const n=prompt("New group name:");if(n?.trim()){state.pinGroups.push(n.trim());refreshPinGroupOptions();}}
 if(action==="2"){const i=Number(prompt("Group number to rename:\n"+state.pinGroups.map((g,i)=>`${i+1}. ${g}`).join("\n")))-1;const n=prompt("New group name:",state.pinGroups[i]||"");if(state.pinGroups[i]&&n?.trim()){const old=state.pinGroups[i];state.pinGroups[i]=n.trim();state.objects.filter(o=>o.type==="pin"&&o.group===old).forEach(o=>o.group=n.trim());}}
 if(action==="3"){const i=Number(prompt("Group number to remove:\n"+state.pinGroups.map((g,i)=>`${i+1}. ${g}`).join("\n")))-1;if(state.pinGroups[i])state.pinGroups.splice(i,1);}
 refreshPinGroupOptions();saveHistory();storeCurrentMap();
});
function refreshPinGroupOptions(){const s=$("pinGroupSelect");if(!s)return;const old=s.value;s.replaceChildren();state.pinGroups.forEach(g=>{const o=document.createElement("option");o.textContent=g;s.append(o);});if(state.pinGroups.includes(old))s.value=old;}
refreshPinGroupOptions();

// Export private notes as an unobtrusive footer only when explicitly enabled.
const originalExportClick=document.querySelector("#exportBtn");
originalExportClick?.addEventListener("click",()=>{
 if(!state.exportPrivateNotes||!state.privateNotes.length)return;
 // The regular PNG export remains clean; notes are also offered as a separate text file.
 const text=state.privateNotes.map((n,i)=>`${i+1}. ${n.text}`).join("\n");
 const blob=new Blob([`AETHERCRYPT ATLAS — PRIVATE NOTES\n\n${text}`],{type:"text/plain;charset=utf-8"});
 const url=URL.createObjectURL(blob),a=document.createElement("a");a.href=url;a.download=`${safeFilename(state.projectName)}-private-notes.txt`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
});

// Persist extension metadata alongside the map snapshot without breaking older files.
const originalSnapshot=snapshot;
snapshot=function(){const data=originalSnapshot();data.pinGroups=clone(state.pinGroups);data.timeline=clone(state.timeline);data.layerGroups=clone(state.layerGroups);data.privateNotes=clone(state.privateNotes);data.exportPrivateNotes=state.exportPrivateNotes;data.activeEra=state.activeEra;return data;};
const originalRestore=restore;
restore=function(data){originalRestore(data);state.pinGroups=Array.isArray(data.pinGroups)?clone(data.pinGroups):["Settlements","Landmarks","Danger zones","Custom"];state.timeline=Array.isArray(data.timeline)?clone(data.timeline):[];state.layerGroups=Array.isArray(data.layerGroups)?clone(data.layerGroups):[];state.privateNotes=Array.isArray(data.privateNotes)?clone(data.privateNotes):[];state.exportPrivateNotes=Boolean(data.exportPrivateNotes);state.activeEra=data.activeEra||"Present";refreshPinGroupOptions();};

// Ensure the special point-drawn tools complete with the normal shortcuts.
const previousToolHelp=toolHelp;
Object.assign(previousToolHelp,atlasHelp,{volcano:"Click to place a volcano stamp.",city:"Click to place a city marker.",village:"Click to place a village marker.",capital:"Click to place a capital marker.",pin:"Click to place a categorized pin."});
renderAll();

// PNG note visibility: temporarily add notes to the SVG only for the export click.
document.addEventListener("click", event => {
  if (event.target?.id !== "exportBtn" || !state.exportPrivateNotes || !state.privateNotes.length) return;
  const group = svgEl("g", { id: "temporaryPrivateNotesExport" });
  const bg = svgEl("rect", { x: 24, y: state.height - Math.min(260, 45 + state.privateNotes.length * 24), width: Math.min(760, state.width - 48), height: Math.min(240, 24 + state.privateNotes.length * 24), rx: 8, fill: "#17111b", opacity: ".88" });
  group.append(bg);
  const heading = svgEl("text", { x: 42, y: state.height - Math.min(260, 45 + state.privateNotes.length * 24) + 25, fill: "#e5c9f4", "font-size": 17, "font-family": "Georgia,serif" }); heading.textContent = "CARTOGRAPHER'S NOTES"; group.append(heading);
  state.privateNotes.slice(0, 8).forEach((note, index) => { const t=svgEl("text", { x:42, y:state.height-Math.min(260,45+state.privateNotes.length*24)+50+index*21, fill:"#f3eaf5", "font-size":14 });t.textContent=note.text;group.append(t); });
  canvas.append(group);
  setTimeout(() => group.remove(), 0);
}, true);


/* FIX: ask for the drawing method every time a compatible tool is selected. */
const modeTools = new Set(["land","water","lake","river","island","border","trade","coast","frame"]);
let pendingModeTool = null;
const modeDialog = $("drawingModeDialog");
document.querySelectorAll('.tool-btn').forEach(button => {
  if (!modeTools.has(button.dataset.tool)) return;
  button.addEventListener("click", () => {
    pendingModeTool = button.dataset.tool;
    const readable = button.textContent.trim();
    $("drawingModeTitle").textContent = `How would you like to draw ${readable.toLowerCase()}?`;
    if (!modeDialog.open) modeDialog.showModal();
  });
});
document.querySelectorAll("[data-draw-mode]").forEach(button => {
  button.addEventListener("click", () => {
    if (!pendingModeTool) return;
    state.drawMode = button.dataset.drawMode;
    const tool = pendingModeTool;
    pendingModeTool = null;
    state.drawing = null; overlay.replaceChildren();
    setTool(tool);
    modeDialog.close();
    showToast(`${tool} selected — ${state.drawMode === "manual" ? "drag to draw" : "click points; double-click to finish"}.`);
  });
});

/* FIX: all area/path tools support both freehand dragging and point placement. */
const manualAreaTools = new Set(["land","water","lake","river","island","border","trade","coast","frame"]);
let atlasManualStroke = null;
let ignoreNextAtlasClick = false;
const oldAtlasClickHandler = handleCanvasClick;
handleCanvasClick = function(event) {
  if (ignoreNextAtlasClick) { ignoreNextAtlasClick = false; return; }
  if (state.drawMode === "manual" && manualAreaTools.has(state.tool)) return;
  oldAtlasClickHandler(event);
};
function atlasStrokeStyle(type) {
  if (type === "river") return {stroke:"#5c9fc0", fill:"none", dash:"none"};
  if (type === "border") return {stroke:"#8e526e", fill:"none", dash:"10 7"};
  if (type === "trade") return {stroke:"#c59a55", fill:"none", dash:"3 8"};
  if (type === "coast") return {stroke:"#6c9caa", fill:"none", dash:"2 5"};
  if (type === "island") return {stroke:"#687653", fill:"#a6b18b", dash:"none"};
  if (type === "water" || type === "lake") return {stroke:type === "lake" ? "#397d77" : "#477d9f", fill:type === "lake" ? "#65a9a0" : "#78a9c9", dash:"none"};
  return {stroke:state.brushColor, fill:state.brushColor, dash:"none"};
}
canvas.addEventListener("pointerdown", event => {
  if (state.drawMode !== "manual" || !manualAreaTools.has(state.tool) || event.button !== 0) return;
  event.preventDefault();
  const type = state.tool;
  const p = pointFromEvent(event);
  atlasManualStroke = {type, points:[p], start:p};
  canvas.setPointerCapture(event.pointerId);
  ignoreNextAtlasClick = true;
});
canvas.addEventListener("pointermove", event => {
  if (!atlasManualStroke) return;
  const p = pointFromEvent(event), last = atlasManualStroke.points[atlasManualStroke.points.length-1];
  if (Math.hypot(p.x-last.x,p.y-last.y) >= 3) atlasManualStroke.points.push(p);
  overlay.replaceChildren();
  const style = atlasStrokeStyle(atlasManualStroke.type);
  if (atlasManualStroke.type === "frame") {
    overlay.append(svgEl("rect",{x:Math.min(atlasManualStroke.start.x,p.x),y:Math.min(atlasManualStroke.start.y,p.y),width:Math.abs(p.x-atlasManualStroke.start.x),height:Math.abs(p.y-atlasManualStroke.start.y),fill:"none",stroke:style.stroke,"stroke-width":Math.max(3,state.brushSize),"stroke-dasharray":"6 4"}));
  } else if (["land","water","lake","island"].includes(atlasManualStroke.type)) {
    overlay.append(svgEl("polygon",{points:atlasManualStroke.points.map(q=>`${q.x},${q.y}`).join(" "),fill:style.fill,"fill-opacity":".28",stroke:style.stroke,"stroke-width":Math.max(2,state.brushSize),"stroke-dasharray":style.dash}));
  } else {
    overlay.append(svgEl("polyline",{points:atlasManualStroke.points.map(q=>`${q.x},${q.y}`).join(" "),fill:"none",stroke:style.stroke,"stroke-width":Math.max(2,state.brushSize),"stroke-dasharray":style.dash,"stroke-linecap":"round","stroke-linejoin":"round"}));
  }
});
function finishAtlasManualStroke() {
  if (!atlasManualStroke) return;
  const d = atlasManualStroke; atlasManualStroke = null; overlay.replaceChildren();
  const closed = ["land","water","lake","island"].includes(d.type);
  if (d.type === "frame") {
    const p = d.points[d.points.length-1];
    if (Math.abs(p.x-d.start.x)<5 || Math.abs(p.y-d.start.y)<5) { showToast("Drag to create a larger frame."); return; }
    addAtlasObject({type:"frame",points:[d.start,p],color:state.brushColor,strokeWidth:Math.max(3,state.brushSize)});
    return;
  }
  if (d.points.length < (closed ? 3 : 2)) { showToast("Draw a little farther to create this feature."); return; }
  const colors = {land:state.brushColor,water:"#78a9c9",lake:"#65a9a0",island:"#a6b18b",river:"#5c9fc0",border:"#8e526e",trade:"#c59a55",coast:"#6c9caa"};
  addAtlasObject({type:d.type,points:d.points,color:colors[d.type],strokeWidth:Math.max(2,state.brushSize),name:d.type==="border"?"Political border":d.type==="trade"?"Trade route":d.type[0].toUpperCase()+d.type.slice(1)});
}
canvas.addEventListener("pointerup", finishAtlasManualStroke);
canvas.addEventListener("pointercancel", finishAtlasManualStroke);

// Rivers now use the same unified point-path finisher as other line tools.

const previousDrawPreview = drawPreview;
drawPreview = function(point=null) {
  previousDrawPreview(point);
  const d=state.drawing;
  if(!d || !["island","border","trade","coast","river"].includes(d.type)) return;
  const pts=[...d.points]; if(point) pts.push(point);
  const style=atlasStrokeStyle(d.type);
  const path=svgEl("polyline",{points:pts.map(p=>`${p.x},${p.y}`).join(" "),fill:"none",stroke:style.stroke,"stroke-width":Math.max(2,state.brushSize),"stroke-dasharray":style.dash,"stroke-linecap":"round","stroke-linejoin":"round",opacity:".8"});
  overlay.append(path);
  if(d.type==="island" && pts.length>=3){const shape=svgEl("polygon",{points:pts.map(p=>`${p.x},${p.y}`).join(" "),fill:style.fill,"fill-opacity":".22",stroke:style.stroke,"stroke-width":2});overlay.insertBefore(shape,path);}
};


/* ================================================================
   PATCH: island persistence, visually distinct pin categories,
   and a reusable private-notes manager.
   ================================================================ */

// Islands are closed polygon objects. The previous renderer did not
// recognize type "island", so saved islands existed but were invisible.
const createSvgObjectBeforeIslandFix = createSvgObject;
createSvgObject = function(obj) {
  if (obj && obj.type === "island") {
    const polygon = svgEl("polygon", {
      points: (obj.points || []).map(p => `${p.x},${p.y}`).join(" "),
      fill: obj.color || "#a6b18b",
      "fill-opacity": obj.fillOpacity || ".88",
      stroke: obj.stroke || "#687653",
      "stroke-width": obj.strokeWidth || 3,
      "stroke-linejoin": "round",
      "stroke-linecap": "round"
    });
    // A subtle inner contour gives islands a cartographic look distinct from land.
    const group = svgEl("g", {});
    group.append(polygon);
    const contour = svgEl("polygon", {
      points: (obj.points || []).map(p => {
        const cx = (obj.points || []).reduce((a, q) => a + q.x, 0) / Math.max(1, obj.points.length);
        const cy = (obj.points || []).reduce((a, q) => a + q.y, 0) / Math.max(1, obj.points.length);
        return `${cx + (p.x-cx)*.88},${cy + (p.y-cy)*.88}`;
      }).join(" "),
      fill: "none", stroke: "#e0d7ad", "stroke-width": 2,
      "stroke-dasharray": "5 7", opacity: ".8", "pointer-events": "none"
    });
    group.append(contour);
    return group;
  }
  if (obj && obj.type === "pin") {
    const category = String(obj.group || "Custom").toLowerCase();
    const presets = [
      { test: /settlement|city|capital|village|pobl|asent/, color: "#b84f59", glyph: "⌂" },
      { test: /landmark|monument|historic|ruin|hito/, color: "#c49a45", glyph: "✦" },
      { test: /danger|enemy|hazard|peligro/, color: "#9d3548", glyph: "!" },
      { test: /trade|route|port|harbor|comerc/, color: "#4d8d91", glyph: "⚓" }
    ];
    const style = presets.find(item => item.test.test(category)) || { color: obj.color || "#8062a3", glyph: "◆" };
    const size = obj.size || 32;
    const g = svgEl("g", { transform: `translate(${obj.x} ${obj.y})` });
    g.append(svgEl("path", {
      d: `M 0 ${size*.72} C ${-size*.12} ${size*.35}, ${-size*.58} ${-size*.02}, ${-size*.48} ${-size*.43} A ${size*.48} ${size*.48} 0 1 1 ${size*.48} ${-size*.43} C ${size*.58} ${-size*.02}, ${size*.12} ${size*.35}, 0 ${size*.72} Z`,
      fill: style.color, stroke: "#302334", "stroke-width": 2
    }));
    g.append(svgEl("circle", { cx: 0, cy: -size*.43, r: size*.31, fill: "#f5ead8", stroke: "#302334", "stroke-width": 1.2 }));
    const glyph = svgEl("text", { x: 0, y: -size*.32, "text-anchor": "middle", "dominant-baseline": "central", "font-size": size*.43, fill: style.color, "font-weight": "700", "font-family": "Georgia,serif" });
    glyph.textContent = style.glyph;
    g.append(glyph);
    const label = svgEl("text", { x: 0, y: size*.98, "text-anchor": "middle", "font-size": Math.max(12, size*.31), fill: "#352a37", "font-family": "Georgia,serif", "paint-order": "stroke", stroke: "#f2eadb", "stroke-width": 3 });
    label.textContent = obj.name || "Pin";
    g.append(label);
    return g;
  }
  return createSvgObjectBeforeIslandFix(obj);
};

// Make pin group appearance explicit and persistent when a pin is created.
const addStampBeforePinFix = addStamp;
addStamp = function(type, point) {
  if (type !== "pin") return addStampBeforePinFix(type, point);
  const group = $("pinGroupSelect")?.value || "Settlements";
  const label = prompt(`Name this ${group.toLowerCase()} pin:`, "Unnamed place");
  if (label === null) return;
  const category = group.toLowerCase();
  const color = /settlement|city|capital|village|pobl|asent/.test(category) ? "#b84f59"
    : /landmark|monument|historic|ruin|hito/.test(category) ? "#c49a45"
    : /danger|enemy|hazard|peligro/.test(category) ? "#9d3548"
    : /trade|route|port|harbor|comerc/.test(category) ? "#4d8d91" : "#8062a3";
  addAtlasObject({ type: "pin", x: point.x, y: point.y, size: Math.max(28, state.brushSize*8), name: label.trim() || "Unnamed place", group, color });
};

// Private notes manager: notes can be listed, reopened, edited, deleted,
// and independently included/excluded from PNG export.
function openPrivateNotesManager() {
  state.privateNotes = Array.isArray(state.privateNotes) ? state.privateNotes : [];
  const menu = () => {
    const exportChoice = state.exportPrivateNotes ? "ON" : "OFF";
    const list = state.privateNotes.length
      ? state.privateNotes.map((note, i) => `${i+1}. ${note.text}`).join("\n")
      : "No notes saved yet.";
    const choice = prompt(
      `PRIVATE CARTOGRAPHER NOTES\n\n${list}\n\nPNG export: ${exportChoice}\n\nChoose an action:\n1 = Add note\n2 = View a note\n3 = Edit a note\n4 = Delete a note\n5 = Toggle PNG export\n6 = Close`,
      "1"
    );
    if (choice === null || choice === "6") return;
    if (choice === "1") {
      const text = prompt("Write your private note:", "");
      if (text && text.trim()) state.privateNotes.push({ id: uid("note"), text: text.trim(), created: new Date().toISOString() });
    } else if (["2", "3", "4"].includes(choice)) {
      if (!state.privateNotes.length) { showToast("There are no notes to manage yet."); return; }
      const index = Number(prompt(`Enter the note number:\n${state.privateNotes.map((n,i)=>`${i+1}. ${n.text}`).join("\n")}`, "1")) - 1;
      const note = state.privateNotes[index];
      if (!note) { showToast("That note number does not exist."); return; }
      if (choice === "2") alert(`PRIVATE NOTE ${index+1}\n\n${note.text}`);
      if (choice === "3") {
        const edited = prompt("Edit this note:", note.text);
        if (edited !== null) note.text = edited;
      }
      if (choice === "4" && confirm("Delete this note permanently?")) state.privateNotes.splice(index, 1);
    } else if (choice === "5") {
      state.exportPrivateNotes = !state.exportPrivateNotes;
      showToast(`Private notes in PNG export: ${state.exportPrivateNotes ? "ON" : "OFF"}.`);
    } else {
      showToast("Choose an action from 1 to 6.");
      return;
    }
    saveHistory(); storeCurrentMap();
    // Reopen the manager so notes can be browsed without creating a new note.
    openPrivateNotesManager();
  };
  menu();
}
const privateNotesButton = $("privateNotesBtn");
if (privateNotesButton) {
  const replacement = privateNotesButton.cloneNode(true);
  privateNotesButton.parentNode.replaceChild(replacement, privateNotesButton);
  replacement.addEventListener("click", openPrivateNotesManager);
}


/* IMAGE IMPORT + IMAGE WORKSHOP */
let pendingAtlasImage = null;
$("addImageBtn")?.addEventListener("click", () => $("imageFileInput").click());
$("imageFileInput")?.addEventListener("change", event => {
  const file = event.target.files?.[0]; if (!file) return;
  if (!file.type.startsWith("image/")) { showToast("Choose an image file."); event.target.value=""; return; }
  if (file.size > 12 * 1024 * 1024) { showToast("Please choose an image smaller than 12 MB."); event.target.value=""; return; }
  const reader = new FileReader();
  reader.onload = () => { pendingAtlasImage=String(reader.result); setTool("image"); showToast("Image ready. Click the map to place it."); };
  reader.onerror = () => showToast("The image could not be read."); reader.readAsDataURL(file); event.target.value="";
});
const previousAtlasClickWithImages = handleCanvasClick;
handleCanvasClick = function(event) {
  if (state.tool === "image" && pendingAtlasImage) {
    const point=pointFromEvent(event), data=pendingAtlasImage, img=new Image();
    img.onload=()=>{const maxWidth=520,maxHeight=360,scale=Math.min(1,maxWidth/img.naturalWidth,maxHeight/img.naturalHeight),width=Math.max(40,img.naturalWidth*scale),height=Math.max(40,img.naturalHeight*scale);addAtlasObject({type:"image",href:data,x:point.x-width/2,y:point.y-height/2,width,height,naturalWidth:img.naturalWidth,naturalHeight:img.naturalHeight,opacity:1,crop:{x:0,y:0,width:1,height:1},name:"Imported image"});pendingAtlasImage=null;setTool("select");showToast("Image added. Select it to edit, crop or resize it.");};
    img.onerror=()=>{pendingAtlasImage=null;showToast("Could not load that image.");};img.src=data;return;
  }
  previousAtlasClickWithImages(event);
};

// Render imported images through a clip-path so crop edits are non-destructive.
const renderImageBase = createSvgObject;
createSvgObject = function(obj) {
  if (obj?.type !== "image") return renderImageBase(obj);
  const crop=obj.crop||{x:0,y:0,width:1,height:1};
  const cx=clamp(Number(crop.x)||0,0,.99), cy=clamp(Number(crop.y)||0,0,.99);
  const cw=clamp(Number(crop.width)||1,.01,1-cx), ch=clamp(Number(crop.height)||1,.01,1-cy);
  const clipId=`clip-${obj.id}`;
  const group=svgEl("g",{}), defs=svgEl("defs",{}), clip=svgEl("clipPath",{id:clipId});
  clip.append(svgEl("rect",{x:obj.x,y:obj.y,width:obj.width,height:obj.height}));defs.append(clip);group.append(defs);
  const image=svgEl("image",{x:obj.x-cx*obj.width/cw,y:obj.y-cy*obj.height/ch,width:obj.width/cw,height:obj.height/ch,href:obj.href,preserveAspectRatio:"none",opacity:obj.opacity??1,"clip-path":`url(#${clipId})`});
  // Clip the displayed crop viewport with a nested group; the image remains fully editable.
  const viewportGroup=svgEl("g",{"clip-path":`url(#${clipId})`});viewportGroup.append(image);group.append(viewportGroup);
  return group;
};

// Add image-specific controls only while an image is selected.
const renderPropertiesBeforeImageTools=renderProperties;
renderProperties=function(){
  renderPropertiesBeforeImageTools();
  const obj=selectedObject(), panel=$("imageProperties");
  if(!panel)return;
  panel.hidden=obj?.type!=="image";
  if(obj?.type==="image"){
    $("imageOpacity").value=Math.round((obj.opacity??1)*100);$("imageOpacityLabel").textContent=$("imageOpacity").value;
    $("imageWidth").value=Math.round(obj.width);$("imageHeight").value=Math.round(obj.height);
  }
};
$("imageOpacity")?.addEventListener("input",e=>{const o=selectedObject();if(o?.type!=="image")return;o.opacity=Number(e.target.value)/100;$("imageOpacityLabel").textContent=e.target.value;renderObjects();});
$("imageOpacity")?.addEventListener("change",()=>{saveHistory();storeCurrentMap();});
$("applyImageSizeBtn")?.addEventListener("click",()=>{const o=selectedObject();if(o?.type!=="image")return;o.width=clamp(Number($("imageWidth").value)||o.width,10,12000);o.height=clamp(Number($("imageHeight").value)||o.height,10,12000);renderAll();saveHistory();storeCurrentMap();showToast("Image dimensions updated.");});
$("resetImageCropBtn")?.addEventListener("click",()=>{const o=selectedObject();if(o?.type!=="image")return;o.crop={x:0,y:0,width:1,height:1};renderAll();saveHistory();storeCurrentMap();showToast("Original image framing restored.");});
$("fitImageCanvasBtn")?.addEventListener("click",()=>{const o=selectedObject();if(o?.type!=="image")return;const ratio=Math.min(state.width/(o.naturalWidth||o.width),state.height/(o.naturalHeight||o.height));o.width=(o.naturalWidth||o.width)*ratio;o.height=(o.naturalHeight||o.height)*ratio;o.x=(state.width-o.width)/2;o.y=(state.height-o.height)/2;o.crop={x:0,y:0,width:1,height:1};renderAll();saveHistory();storeCurrentMap();showToast("Image fitted to canvas. Use Undo to reverse this change.");});

// LibreOffice-style crop frame: resize the crop viewport with edge/corner handles, then Apply.
let cropDraft=null,cropDrag=null;
function drawCropFrame(){
  overlay.replaceChildren();
  const o=selectedObject(); if(!o||o.type!=="image"||!cropDraft)return;
  const r=cropDraft, shade=svgEl("rect",{x:o.x,y:o.y,width:o.width,height:o.height,fill:"#100b14","fill-opacity":.32,"pointer-events":"none"});
  const frame=svgEl("rect",{x:r.x,y:r.y,width:r.w,height:r.h,fill:"#d7b5ff","fill-opacity":.08,stroke:"#fff4d6","stroke-width":2,"stroke-dasharray":"7 4","pointer-events":"none"});
  overlay.append(shade,frame);
  const pts=[ ["nw",r.x,r.y],["n",r.x+r.w/2,r.y],["ne",r.x+r.w,r.y],["e",r.x+r.w,r.y+r.h/2],["se",r.x+r.w,r.y+r.h],["s",r.x+r.w/2,r.y+r.h],["sw",r.x,r.y+r.h],["w",r.x,r.y+r.h/2] ];
  pts.forEach(([id,x,y])=>overlay.append(svgEl("rect",{x:x-7,y:y-7,width:14,height:14,rx:2,fill:"#fff4d6",stroke:"#765087","stroke-width":2,"data-crop-handle":id,"pointer-events":"all"})));
}
function beginImageCrop(){
  const o=selectedObject(); if(o?.type!=="image")return;
  cropDraft={x:o.x,y:o.y,w:o.width,h:o.height};
  $("cropActions").hidden=false;setTool("imageCrop");drawCropFrame();
  showToast("Drag the crop handles like a document editor, then choose Apply crop.");
}
function finishImageCrop(apply){
  const o=selectedObject();
  if(apply&&o?.type==="image"&&cropDraft){
    const r=cropDraft, prev=o.crop||{x:0,y:0,width:1,height:1};
    const nx=(r.x-o.x)/o.width,ny=(r.y-o.y)/o.height,nw=r.w/o.width,nh=r.h/o.height;
    if(nw>.01&&nh>.01)o.crop={x:prev.x+nx*prev.width,y:prev.y+ny*prev.height,width:nw*prev.width,height:nh*prev.height};
    else {showToast("Crop area is too small.");return;}
    renderAll();saveHistory();storeCurrentMap();showToast("Image crop applied.");
  }
  cropDraft=null;cropDrag=null;overlay.replaceChildren();$("cropActions").hidden=true;setTool("select");
}
$("cropImageBtn")?.addEventListener("click",beginImageCrop);
$("applyImageCropBtn")?.addEventListener("click",()=>finishImageCrop(true));
$("cancelImageCropBtn")?.addEventListener("click",()=>finishImageCrop(false));
canvas.addEventListener("pointerdown",e=>{
  if(state.tool!=="imageCrop"||!cropDraft||e.button!==0)return;
  const handle=e.target?.getAttribute?.("data-crop-handle"); if(!handle)return;
  e.preventDefault();cropDrag={handle,start:pointFromEvent(e),initial:{...cropDraft}};canvas.setPointerCapture?.(e.pointerId);
});
canvas.addEventListener("pointermove",e=>{
  if(state.tool!=="imageCrop"||!cropDrag)return;
  const p=pointFromEvent(e),d=cropDrag.initial,dx=p.x-cropDrag.start.x,dy=p.y-cropDrag.start.y,h=cropDrag.handle;
  let left=d.x,top=d.y,right=d.x+d.w,bottom=d.y+d.h;
  if(h.includes("w"))left=clamp(d.x+dx,d.x- d.w+12,d.x+d.w-12);
  if(h.includes("e"))right=clamp(d.x+d.w+dx,d.x+12,d.x+d.w*2-12);
  if(h.includes("n"))top=clamp(d.y+dy,d.y-d.h+12,d.y+d.h-12);
  if(h.includes("s"))bottom=clamp(d.y+d.h+dy,d.y+12,d.y+d.h*2-12);
  const o=selectedObject();if(!o)return;
  left=clamp(left,o.x,o.x+o.width-12);right=clamp(right,o.x+12,o.x+o.width);top=clamp(top,o.y,o.y+o.height-12);bottom=clamp(bottom,o.y+12,o.y+o.height);
  cropDraft={x:left,y:top,w:right-left,h:bottom-top};drawCropFrame();
});
canvas.addEventListener("pointerup",()=>{cropDrag=null;});
canvas.addEventListener("pointercancel",()=>{cropDrag=null;});
$("clearBtn")?.addEventListener("click", () => {
  if (!state.objects.length) { showToast("The map is already clear."); return; }
  if (!confirm("Clear every object from this map? This can be undone with Undo.")) return;
  state.objects = [];
  state.selectedId = null;
  state.drawing = null;
  overlay.replaceChildren();
  renderAll();
  saveHistory();
  storeCurrentMap();
  showToast("Map cleared. Use Undo to restore it.");
});


// Compact community popup and tiny built-in mini-game.
let relicIndex=Math.floor(Math.random()*6),relicAttempts=3,relicDone=false;
function resetRelicGame(){relicIndex=Math.floor(Math.random()*6);relicAttempts=3;relicDone=false;document.querySelectorAll("[data-vault]").forEach(b=>{b.disabled=false;b.textContent="?";b.classList.remove("vault-found","vault-empty");});$("relicGameStatus").textContent="Choose a vault to begin. Three attempts remain.";}
$("relicGameGrid")?.addEventListener("click",e=>{const b=e.target.closest("[data-vault]");if(!b||relicDone||b.disabled)return;const n=Number(b.dataset.vault);b.disabled=true;if(n===relicIndex){b.textContent="✦";b.classList.add("vault-found");relicDone=true;$("relicGameStatus").textContent="You found the relic! The Atlas remembers your name.";document.querySelectorAll("[data-vault]").forEach(x=>x.disabled=true);}else{b.textContent="·";b.classList.add("vault-empty");relicAttempts--;if(relicAttempts<=0){relicDone=true;document.querySelectorAll("[data-vault]").forEach((x,i)=>{x.disabled=true;if(i===relicIndex)x.textContent="✦";});$("relicGameStatus").textContent="The relic remains hidden no longer. Try again!";}else $("relicGameStatus").textContent=`Not this vault. ${relicAttempts} ${relicAttempts===1?"attempt":"attempts"} left.`;}});
$("relicGameReset")?.addEventListener("click",resetRelicGame);

// Cartographer's Echo: a growing sigil-memory game.
let echoSequence=[],echoInput=[],echoRound=0,echoLocked=true,echoTimers=[];
const echoButtons=[...document.querySelectorAll("[data-sigil]")];
function clearEchoTimers(){echoTimers.forEach(clearTimeout);echoTimers=[];}
function echoStatus(message){const el=$("echoStatus");if(el)el.textContent=message;}
function flashSigil(index){const button=echoButtons[index];if(!button)return;button.classList.add("sigil-lit");const timer=setTimeout(()=>button.classList.remove("sigil-lit"),430);echoTimers.push(timer);}
function playEchoSequence(){echoLocked=true;echoInput=[];echoStatus(`Round ${echoRound}: watch the sigils…`);echoSequence.forEach((sigil,i)=>{const timer=setTimeout(()=>flashSigil(sigil),650+i*760);echoTimers.push(timer);});const done=setTimeout(()=>{echoLocked=false;echoStatus(`Your turn · repeat ${echoSequence.length} sigils in order.`);},650+echoSequence.length*760);echoTimers.push(done);}
function startEcho(){clearEchoTimers();echoSequence=[];echoInput=[];echoRound=0;echoLocked=true;nextEchoRound();}
function nextEchoRound(){echoRound++;echoSequence.push(Math.floor(Math.random()*4));playEchoSequence();}
$("echoStart")?.addEventListener("click",startEcho);
$("echoBoard")?.addEventListener("click",e=>{const button=e.target.closest("[data-sigil]");if(!button||echoLocked)return;const picked=Number(button.dataset.sigil);flashSigil(picked);const position=echoInput.length;if(picked!==echoSequence[position]){echoLocked=true;echoStatus(`The echo broke at round ${echoRound}. You reached ${Math.max(0,echoRound-1)} rounds. Try again?`);$("echoStart").textContent="Try again";return;}echoInput.push(picked);if(echoInput.length===echoSequence.length){echoLocked=true;if(echoRound>=12){echoStatus("Twelve rounds! The map recognises its master. ✦");$("echoStart").textContent="Play again";}else{echoStatus("Perfect. The map reveals another sigil…");const timer=setTimeout(nextEchoRound,850);echoTimers.push(timer);}}});
function openGame(game){$("extrasDialog")?.close();$("miniGameDialog")?.showModal();["relic","echo","trial","observatory"].forEach(id=>{const panel=$(id+"GamePanel");if(panel)panel.hidden=id!==game;});$("gameDialogTitle").textContent=game==="echo"?"Cartographer's Echo":game==="trial"?"The Cartographer's Trial":game==="observatory"?"The Hollow Observatory":"Find the Lost Relic";if(game==="relic")resetRelicGame();else if(game==="echo"){$("echoStart").textContent="Begin Echo";echoStatus("Press Begin Echo to start.");}else if(game==="trial")resetTrial();else if(game==="observatory")resetObservatory();}
document.querySelectorAll("[data-launch-game]").forEach(button=>button.addEventListener("click",()=>openGame(button.dataset.launchGame)));
$("gameLibraryBack")?.addEventListener("click",()=>{$("miniGameDialog")?.close();$("extrasDialog")?.showModal();$("gamesHubSection")?.scrollIntoView({block:"nearest",behavior:"smooth"});});
$("sanctumTile")?.addEventListener("click",()=>$("sanctumDialog")?.showModal());
document.querySelectorAll("[data-soon]").forEach(button=>button.addEventListener("click",()=>{const title=button.dataset.soon||"This project";$("sanctumDialog").querySelector("h2").textContent=title;$("sanctumDialog").querySelector(".sanctum-notice h3").textContent="No link available";$("sanctumDialog").querySelector(".sanctum-notice p").textContent=`${title} is still taking shape. Its entrance will be revealed when it is ready.`;$("sanctumDialog")?.showModal();}));
$("atlasBlockTile")?.addEventListener("click",()=>$("extrasDialog")?.close());

// Each sidebar folds independently. The arrow remains as the only visible control.
function setSidebarVisibility(id, visible) {
  const el = $(id); if (!el) return;
  el.classList.toggle("sidebar-is-hidden", !visible);
  const button = el.querySelector("[data-collapse]");
  if (button) {
    button.textContent = id === "toolSidebar" ? (visible ? "‹" : "›") : (visible ? "›" : "‹");
    button.setAttribute("aria-label", visible ? "Collapse menu" : "Expand menu");
    button.setAttribute("aria-expanded", String(visible));
    button.title = visible ? "Collapse menu" : "Expand menu";
  }
}
document.querySelectorAll("[data-collapse]").forEach(button => {
  button.type = "button";
  button.addEventListener("click", event => {
    event.preventDefault(); event.stopPropagation();
    const sidebar = button.closest("#toolSidebar, #propertiesSidebar");
    if (sidebar) setSidebarVisibility(sidebar.id, sidebar.classList.contains("sidebar-is-hidden"));
  });
});

$("extrasBtn")?.addEventListener("click", () => $("extrasDialog").showModal());
$("miniGameBtn")?.addEventListener("click", () => { $("extrasDialog").showModal(); setTimeout(()=>$("gamesHubSection")?.scrollIntoView({block:"nearest",behavior:"smooth"}),80); });


// The Cartographer's Trial — hard, turn-based labyrinth puzzle.
const trialWalls = new Set([3,4,5,6,8,9,10,11,13,14,15,16,18,19,20,21]);
let trialPosition = 0, trialFinished = false, trialVisited = new Set([0]);
function renderTrial(){
  const board=$("trialBoard"); if(!board)return; board.innerHTML="";
  for(let i=0;i<25;i++){ const b=document.createElement("button"); b.type="button"; b.className="trial-cell"; b.dataset.cell=String(i);
    if(trialWalls.has(i)){b.classList.add("trial-wall");b.textContent="▧";b.disabled=true;}
    else if(i===trialPosition){b.classList.add("trial-player");b.textContent="✦";}
    else if(i===24){b.classList.add("trial-goal");b.textContent="◇";}
    else if(trialVisited.has(i)){b.classList.add("trial-path");b.textContent="·";}
    else b.textContent=""; board.appendChild(b); }
}
function resetTrial(){trialPosition=0;trialFinished=false;trialVisited=new Set([0]);const status=$("trialStatus");if(status)status.textContent="Find the path to the relic. Move only to adjacent tiles.";renderTrial();}
$("trialBoard")?.addEventListener("click",e=>{const b=e.target.closest("[data-cell]");if(!b||trialFinished)return;const next=Number(b.dataset.cell),r=Math.floor(trialPosition/5),c=trialPosition%5,nr=Math.floor(next/5),nc=next%5;if(Math.abs(r-nr)+Math.abs(c-nc)!==1)return;if(trialWalls.has(next)||trialVisited.has(next)){trialFinished=true;$("trialStatus").textContent="The labyrinth sealed your path. The trial resets—try a different route.";return;}trialPosition=next;trialVisited.add(next);if(next===24){trialFinished=true;$("trialStatus").textContent=`Relic secured in ${trialVisited.size-1} moves. You conquered the hard trial! ✦`;}renderTrial();});
$("trialReset")?.addEventListener("click",resetTrial);


// The Hollow Observatory: trace constellations by selecting stars in sequence.
const observatoryPatterns=[[2,6,10,14],[1,5,9,13,17],[0,4,8,12,16,20]];
let observatoryStage=0,observatoryExpected=[],observatoryInput=[],observatoryLocked=true,observatoryTimers=[];
function observatoryStatus(message){const el=$("observatoryStatus");if(el)el.textContent=message;}
function clearObservatoryTimers(){observatoryTimers.forEach(clearTimeout);observatoryTimers=[];}
function renderObservatory(){const board=$("observatoryBoard");if(!board)return;board.innerHTML="";for(let i=0;i<25;i++){const b=document.createElement("button");b.type="button";b.className="observatory-star";b.dataset.star=String(i);b.textContent="✦";b.setAttribute("aria-label",`Star ${i+1}`);board.appendChild(b);}}
function resetObservatory(){clearObservatoryTimers();observatoryStage=0;observatoryExpected=[];observatoryInput=[];observatoryLocked=true;renderObservatory();observatoryStatus("Begin the observation to reveal the first constellation.");$("observatoryStart").textContent="Begin observation";}
function revealObservatory(){observatoryLocked=true;observatoryInput=[];observatoryExpected=observatoryPatterns[observatoryStage];observatoryStatus(`Constellation ${observatoryStage+1}: memorise the ${observatoryExpected.length} stars…`);observatoryExpected.forEach((star,i)=>{const t=setTimeout(()=>{const b=$("observatoryBoard")?.querySelector(`[data-star="${star}"]`);b?.classList.add("star-lit");setTimeout(()=>b?.classList.remove("star-lit"),480);},650+i*720);observatoryTimers.push(t);});const done=setTimeout(()=>{observatoryLocked=false;observatoryStatus("Your turn: trace the constellation in the same order.");},650+observatoryExpected.length*720);observatoryTimers.push(done);}
$("observatoryStart")?.addEventListener("click",()=>{if(observatoryStage>=3||observatoryExpected.length===0){observatoryStage=0;renderObservatory();}revealObservatory();$("observatoryStart").textContent="Restart observation";});
$("observatoryBoard")?.addEventListener("click",e=>{const b=e.target.closest("[data-star]");if(!b||observatoryLocked)return;const picked=Number(b.dataset.star),pos=observatoryInput.length;b.classList.add("star-picked");if(picked!==observatoryExpected[pos]){observatoryLocked=true;observatoryStatus(`The constellation faded. You reached stage ${observatoryStage+1}. Try again.`);$("observatoryStart").textContent="Try again";observatoryStage=0;return;}observatoryInput.push(picked);if(observatoryInput.length===observatoryExpected.length){observatoryLocked=true;observatoryStage++;if(observatoryStage===3){observatoryStatus("All three constellations restored. The observatory shines again. ✦");$("observatoryStart").textContent="Play again";observatoryExpected=[];}else{observatoryStatus("Constellation restored. Preparing the next sky…");const t=setTimeout(revealObservatory,900);observatoryTimers.push(t);}}});
