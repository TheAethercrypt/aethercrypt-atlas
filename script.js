"use strict";

const $ = id => document.getElementById(id);
const NS = "http://www.w3.org/2000/svg";
const GRID = 40;
const MIN_ZOOM = 0.15;
const MAX_ZOOM = 3;

const state = {
  projectName: "Untitled World",
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

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function currentMap() {
  return state.maps.find(m => m.id === state.currentMapId);
}

function selectedObject() {
  return state.objects.find(o => o.id === state.selectedId);
}

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
    objects: clone(state.objects)
  };
}

function restore(data) {
  state.projectName = data.projectName || "Untitled World";
  state.width = clamp(Number(data.width) || 2400, 200, 12000);
  state.height = clamp(Number(data.height) || 1600, 200, 12000);
  state.zoom = clamp(Number(data.zoom) || 1, MIN_ZOOM, MAX_ZOOM);

  state.layers = Array.isArray(data.layers) && data.layers.length
    ? clone(data.layers)
    : [{ id: uid("layer"), name: "Layer 1", visible: true }];

  state.activeLayerId = state.layers.some(l => l.id === data.activeLayerId)
    ? data.activeLayerId
    : state.layers[0].id;

  state.objects = Array.isArray(data.objects) ? clone(data.objects) : [];
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
  select: "Select an object, edit its properties or link a region to a submap.",
  pan: "Drag to move around the canvas. You can also use the middle mouse button.",
  land: "Click to add polygon points. Double-click or right-click to finish.",
  freehand: "Hold the mouse button and draw a continent or coastline by hand.",
  water: "Click to add points. Double-click or right-click to finish.",
  line: "Click the start point, then click the endpoint.",
  eraser: "Click an object to erase it.",
  label: "Click the canvas to add a text label. Select it to resize, curve or move it.",
  bucket: "Click a land or water shape to recolor the whole region with the brush color.",
  mountain: "Click anywhere to place a mountain stamp. Click again to add more."
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
  renderObjects();
  renderLayers();
  renderProperties();
  updateProjectName();
  updateBreadcrumbs();
  renderSubmaps();
}

function updateProjectName() {
  $("projectName").textContent = state.projectName;
  document.title = `${state.projectName} — The Aethercrypt: Atlas`;
}

function createSvgObject(obj) {
  let el;

  if (obj.type === "land" || obj.type === "water" || obj.type === "freehand") {
    el = document.createElementNS(NS, "polygon");

    el.setAttribute(
      "points",
      (obj.points || []).map(p => `${p.x},${p.y}`).join(" ")
    );

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

      const width = Math.max(
        100,
        (obj.text || "Label").length * (obj.fontSize || 28) * .62
      );

      path.setAttribute("id", pathId);
      path.setAttribute(
        "d",
        `M ${obj.x - width / 2} ${obj.y} Q ${obj.x} ${obj.y - Math.max(25, width * .18)} ${obj.x + width / 2} ${obj.y}`
      );

      defs.appendChild(path);

      const text = document.createElementNS(NS, "text");
      text.setAttribute("fill", obj.color);
      text.setAttribute("font-family", "Georgia, serif");
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
      el.setAttribute("font-family", "Georgia, serif");
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

    state.objects
      .filter(o => o.layerId === layer.id)
      .forEach(obj => {
        const el = createSvgObject(obj);
        if (!el) return;

        el.dataset.objectId = obj.id;

        if (obj.id === state.selectedId) {
          el.classList.add("selected-object");
        }

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
    ? obj.color
    : "#a1b18a";

  $("textProperties").hidden = obj.type !== "label";

  if (obj.type === "label") {
    $("textSize").value = obj.fontSize || 28;
    $("textSizeLabel").textContent = obj.fontSize || 28;
    $("textCurved").checked = Boolean(obj.curved);
  }

  const canLink = ["land", "water", "freehand"].includes(obj.type);

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

  return {
    x: clamp(x, 0, state.width),
    y: clamp(y, 0, state.height)
  };
}

function drawPreview(point = null) {
  overlay.replaceChildren();

  if (!state.drawing) return;

  const d = state.drawing;
  const points = [...d.points];

  if (point) points.push(point);

  if (["land", "water", "freehand"].includes(d.type)) {
    const el = document.createElementNS(NS, "polygon");

    el.setAttribute(
      "points",
      points.map(p => `${p.x},${p.y}`).join(" ")
    );

    const previewColor = d.type === "water" ? "#78a9c9" : state.brushColor;

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

  if (!d || !["land", "water", "freehand"].includes(d.type)) return;

  state.drawing = null;
  overlay.replaceChildren();

  if (d.points.length < 3) {
    showToast("A region needs at least three points.");
    return;
  }

  addObject({
    type: d.type,
    points: d.points,
    color: d.type === "water" ? "#78a9c9" : state.brushColor,
    stroke: d.type === "water" ? "#477d9f" : state.brushColor,
    strokeWidth: Math.max(1, state.brushSize / 2)
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
      fontSize: Math.max(12, state.brushSize * 4)
    });

    return;
  }

  if (state.tool === "bucket") {
    const obj = state.objects.find(item => item.id === hitId);

    if (obj && ["land", "water", "freehand"].includes(obj.type)) {
      obj.color = state.brushColor;
      obj.stroke = state.brushColor;

      renderAll();
      saveHistory();
      storeCurrentMap();
    } else {
      showToast("Select a land or water region to fill it.");
    }

    return;
  }

  if (state.tool === "mountain") {
    addObject({
      type: "mountain",
      x: point.x,
      y: point.y,
      color: state.brushColor,
      size: Math.max(24, state.brushSize * 7)
    });

    return;
  }

  if (["land", "water"].includes(state.tool)) {
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
        x1: start.x,
        y1: start.y,
        x2: point.x,
        y2: point.y,
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

    const obj = hit
      ? state.objects.find(item => item.id === hit.dataset.objectId)
      : null;

    if (obj) {
      state.selectedId = obj.id;

      state.draggingObject = {
        id: obj.id,
        start: pointFromEvent(event),
        original: clone(obj),
        moved: false
      };

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

    if (Math.abs(dx) + Math.abs(dy) > 3) {
      state.panning.moved = true;
    }

    viewport.scrollLeft = state.panning.left - dx;
    viewport.scrollTop = state.panning.top - dy;
    return;
  }

  if (state.draggingObject) {
    const p = pointFromEvent(event);
    const dx = p.x - state.draggingObject.start.x;
    const dy = p.y - state.draggingObject.start.y;

    if (Math.abs(dx) + Math.abs(dy) > 1) {
      state.draggingObject.moved = true;
    }

    const obj = state.objects.find(item => item.id === state.draggingObject.id);
    const original = state.draggingObject.original;

    if (obj) {
      if (obj.points) {
        obj.points = original.points.map(pt => ({
          x: pt.x + dx,
          y: pt.y + dy
        }));
      } else if (obj.type === "line") {
        obj.x1 = original.x1 + dx;
        obj.y1 = original.y1 + dy;
        obj.x2 = original.x2 + dx;
        obj.y2 = original.y2 + dy;
      } else {
        obj.x = original.x + dx;
        obj.y = original.y + dy;
      }

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

  if (state.drawing) {
    drawPreview(pointFromEvent(event));
  }
});

function endPointer() {
  if (state.draggingObject) {
    const moved = state.draggingObject.moved;
    state.draggingObject = null;

    if (moved) {
      renderAll();
      saveHistory();
      storeCurrentMap();
    }

    state.suppressClick = true;
    return;
  }

  if (state.panning) {
    state.suppressClick = state.panning.moved;
    state.panning = null;
    return;
  }

  if (state.drawing?.type === "freehand") {
    finishPolygon();
  }
}

canvas.addEventListener("pointerup", endPointer);
canvas.addEventListener("pointercancel", endPointer);

canvas.addEventListener("click", event => {
  if (state.tool === "pan" || state.tool === "freehand") return;
  handleCanvasClick(event);
});

canvas.addEventListener("dblclick", event => {
  if (["land", "water"].includes(state.tool)) {
    event.preventDefault();
    finishPolygon();
  }
});

canvas.addEventListener("contextmenu", event => {
  if (state.drawing && ["land", "water"].includes(state.drawing.type)) {
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

  const layer = {
    id: uid("layer"),
    name: name.trim(),
    visible: true
  };

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

  if (obj.type === "label") {
    obj.text = name || "Label";
  }

  obj.name = name;

  renderAll();
  saveHistory();
  storeCurrentMap();
});

$("objectColor").addEventListener("input", event => {
  const obj = selectedObject();
  if (!obj) return;

  obj.color = event.target.value;

  if (["land", "water", "freehand"].includes(obj.type)) {
    obj.stroke = obj.color;
  }

  renderObjects();
});

$("objectColor").addEventListener("change", () => {
  saveHistory();
  storeCurrentMap();
});

$("textSize").addEventListener("input", event => {
  const obj = selectedObject();

  if (!obj || obj.type !== "label") return;

  obj.fontSize = Number(event.target.value);
  $("textSizeLabel").textContent = obj.fontSize;

  renderObjects();
});

$("textSize").addEventListener("change", () => {
  saveHistory();
  storeCurrentMap();
});

$("textCurved").addEventListener("change", event => {
  const obj = selectedObject();

  if (!obj || obj.type !== "label") return;

  obj.curved = event.target.checked;

  renderAll();
  saveHistory();
  storeCurrentMap();
});

$("renameProjectBtn").addEventListener("click", () => {
  const name = prompt("Rename this map:", state.projectName);

  if (!name || !name.trim()) return;

  state.projectName = name.trim().slice(0, 80);

  const map = currentMap();

  if (map) {
    map.name = state.projectName;
  }

  updateProjectName();
  updateBreadcrumbs();
  renderSubmaps();
  saveHistory();
  storeCurrentMap();

  showToast("Map renamed.");
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

  if (index < 0) {
    state.maps.push(data);
  } else {
    state.maps[index] = data;
  }
}

function ancestry(mapId) {
  const chain = [];
  const visited = new Set();

  let map = state.maps.find(m => m.id === mapId);

  while (map && !visited.has(map.id)) {
    visited.add(map.id);
    chain.unshift(map);
    map = map.parentId
      ? state.maps.find(m => m.id === map.parentId)
      : null;
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
  const layer = {
    id: uid("layer"),
    name: "Layer 1",
    visible: true
  };

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

    if (region) {
      region.linkedMapId = id;
    }

    storeCurrentMap();
  }

  switchMap(id);
}

$("createRegionSubmapBtn").addEventListener("click", () => {
  const region = selectedObject();

  if (!region || !["land", "water", "freehand"].includes(region.type)) {
    return;
  }

  const defaultName = region.name || "New Region";
  const name = prompt(
    "Name this region's submap:",
    `${defaultName} — Detailed Map`
  );

  if (!name?.trim()) return;

  createSubmap(name.trim(), region.id);
});

$("openRegionSubmapBtn").addEventListener("click", () => {
  const region = selectedObject();

  if (region?.linkedMapId) {
    switchMap(region.linkedMapId);
  }
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

  if (!map || !confirm(`Delete "${map.name}" and all of its submaps?`)) {
    return;
  }

  storeCurrentMap();

  const parentId = map.parentId || "main";
  const removing = descendants(id);

  state.maps = state.maps.filter(m => !removing.has(m.id));

  state.maps.forEach(m => {
    m.data.objects.forEach(obj => {
      if (obj.linkedMapId && removing.has(obj.linkedMapId)) {
        delete obj.linkedMapId;
      }
    });
  });

  if (removing.has(state.currentMapId)) {
    state.currentMapId = parentId;

    const parent = state.maps.find(m => m.id === parentId) || state.maps[0];

    state.parentMapId = parent?.parentId || null;

    if (parent) {
      restore(clone(parent.data));
    }
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

  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width < 200 ||
    width > 12000 ||
    height < 200 ||
    height > 12000
  ) {
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
  return (name || "atlas")
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "-")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 100) || "atlas";
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

$("saveBtn").addEventListener("click", () => {
  const blob = new Blob(
    [JSON.stringify(makeProjectFile(), null, 2)],
    { type: "application/json" }
  );

  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");

  a.href = url;
  a.download = `${safeFilename(state.projectName)}.atlas.json`;
  a.click();

  setTimeout(() => URL.revokeObjectURL(url), 1000);

  showToast("Atlas saved.");
});

$("openBtn").addEventListener("click", () => $("fileInput").click());

$("fileInput").addEventListener("change", async event => {
  const file = event.target.files?.[0];

  if (!file) return;

  try {
    const data = JSON.parse(await file.text());

    if (data.format === "aethercrypt-atlas" && Array.isArray(data.maps)) {
      const maps = data.maps.filter(
        m => m && typeof m.id === "string" && m.data
      );

      if (!maps.some(m => m.id === "main")) {
        throw new Error("Missing main map");
      }

      state.maps = clone(maps);

      state.currentMapId = maps.some(m => m.id === data.currentMapId)
        ? data.currentMapId
        : "main";

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
  if (!confirm("Create a new atlas? Save your current project first if needed.")) {
    return;
  }

  state.projectName = "Untitled World";
  state.width = 2400;
  state.height = 1600;
  state.zoom = 1;

  state.layers = [{
    id: uid("layer"),
    name: "Layer 1",
    visible: true
  }];

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

  const blob = new Blob(
    [source],
    { type: "image/svg+xml;charset=utf-8" }
  );

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

$("suggestionsBtn").addEventListener("click", () => {
  $("suggestionsDialog").showModal();
});

$("suggestionForm").addEventListener("submit", event => {
  event.preventDefault();

  const category = $("suggestionType").value;
  const message = $("suggestionText").value.trim();

  if (!message) return;

  const subject = encodeURIComponent(`[Atlas suggestion] ${category}`);
  const body = encodeURIComponent(
    `${message}\n\n— The Aethercrypt: Atlas`
  );

  window.location.href = `mailto:?subject=${subject}&body=${body}`;

  $("suggestionsDialog").close();

  showToast("Your email app should open with the suggestion prepared.");
});

$("aboutBtn").addEventListener("click", () => {
  $("aboutDialog").showModal();
});

document.querySelectorAll("[data-close]").forEach(button => {
  button.addEventListener("click", () => {
    const dialog = $(button.dataset.close);

    if (dialog?.open) {
      dialog.close();
    }
  });
});

document.querySelectorAll("dialog").forEach(dialog => {
  dialog.addEventListener("click", event => {
    if (event.target === dialog) {
      dialog.close();
    }
  });
});

document.addEventListener("keydown", event => {
  const target = event.target;

  const typing = target instanceof HTMLElement &&
    (
      target.isContentEditable ||
      ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)
    );

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