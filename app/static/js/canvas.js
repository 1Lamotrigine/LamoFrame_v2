/**
 * Холст: рендер фреймов, выделение, перенос, ресайз фреймов и элементов,
 * поворот, инструменты рисования, пан и зум.
 */

import {
  addElement,
  addFrame,
  clearSelection,
  commit,
  createElement,
  deleteElements,
  duplicateElements,
  emit,
  findElement,
  getFrame,
  on,
  pushHistory,
  restackFrames,
  selectedElements,
  selectedFrames,
  setActiveFrame,
  setFrameSelection,
  setGuides,
  setSelection,
  setTool,
  setView,
  state,
  toggleFrameSelection,
  toggleSelection,
  update,
  updateFrame,
} from "./state.js";
import { renderSections, framesBounds } from "./render.js";
import { elementAbsoluteRect, frameRect, renderOverlay, updateSizeTooltip } from "./selection.js";
import { snapCoordinate, snapRect } from "./snapping.js";
import { toast } from "./toast.js";

let viewport = null;
let world = null;
let root = null;
let overlay = null;
let marquee = null;
let interaction = null;
let nodeCache = new Map();
let spaceDown = false;
let onFiles = null;
let canvasReady = false;

const HANDLE_MIN = 8;
const DEFAULT_FRAME = { w: 1200, h: 720 };
const MIN_DRAG = 4;

export function initCanvas(options = {}) {
  viewport = document.getElementById("canvasViewport");
  world = document.getElementById("canvasWorld");
  root = document.getElementById("framesRoot");
  overlay = document.getElementById("canvasOverlay");
  marquee = document.getElementById("marquee");
  onFiles = options.onFiles || null;
  if (!viewport) return;

  viewport.addEventListener("pointerdown", onPointerDown);
  window.addEventListener("pointermove", onPointerMove);
  window.addEventListener("pointerup", onPointerUp);
  window.addEventListener("pointercancel", onPointerUp);
  viewport.addEventListener("dblclick", onDoubleClick);
  viewport.addEventListener("wheel", onWheel, { passive: false });
  viewport.addEventListener("contextmenu", (event) => event.preventDefault());
  viewport.addEventListener("click", (event) => {
    if (event.target.closest(".sb-el a")) event.preventDefault();
  });
  viewport.addEventListener("dragover", (event) => {
    const types = [...(event.dataTransfer?.types || [])];
    if (types.includes("Files") || types.includes("application/x-sb-element")) {
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
      viewport.classList.add("is-drop-target");
    }
  });
  viewport.addEventListener("dragleave", (event) => {
    if (!viewport.contains(event.relatedTarget)) viewport.classList.remove("is-drop-target");
  });
  viewport.addEventListener("drop", (event) => {
    viewport.classList.remove("is-drop-target");
    const type = event.dataTransfer?.getData("application/x-sb-element");
    if (type) {
      event.preventDefault();
      dropElementFromLibrary(type, screenToDoc(event.clientX, event.clientY));
      return;
    }
    if (!event.dataTransfer.files?.length || !onFiles) return;
    event.preventDefault();
    const point = screenToDoc(event.clientX, event.clientY);
    onFiles([...event.dataTransfer.files], point);
  });

  window.addEventListener("keydown", (event) => {
    if (event.code === "Space" && !isTypingTarget(event.target)) {
      if (!spaceDown) {
        spaceDown = true;
        viewport.classList.add("can-pan");
      }
      if (document.activeElement?.closest?.("#canvasViewport")) event.preventDefault();
    }
    if (event.key === "Escape" && state.tool !== "select") {
      setTool("select");
    }
  });
  window.addEventListener("keyup", (event) => {
    if (event.code === "Space") {
      spaceDown = false;
      viewport.classList.remove("can-pan");
    }
  });
  window.addEventListener("blur", () => {
    spaceDown = false;
    viewport?.classList.remove("can-pan");
  });

  on("doc", ({ transient, source } = {}) => {
    if (!canvasReady) return;
    if (transient && source !== "init") {
      updateNodesPointwise();
      renderOverlay();
    } else {
      renderCanvas();
    }
  });
  on("selection", () => renderOverlay());
  on("guides", () => renderOverlay());
  on("view", applyView);
  on("active", () => renderOverlay());
  on("theme", () => renderCanvas());
  on("tool", applyCursor);

  window.addEventListener("resize", () => {
    if (canvasReady) applyView();
  });

  canvasReady = true;
}

export function renderCanvas() {
  if (!root || !state.doc) return;
  root.innerHTML = renderSections(state.doc, { editor: true });
  nodeCache = new Map([...root.querySelectorAll(".sb-el[data-id]")].map((node) => [node.dataset.id, node]));
  renderOverlay();
  applyView();
}

function applyView() {
  if (!world || !viewport) return;
  const { zoom, pan } = state;
  world.style.transform = `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`;
  const zoomLabel = document.getElementById("zoomLabel");
  if (zoomLabel) zoomLabel.textContent = `${Math.round(zoom * 100)}%`;
}

function applyCursor() {
  if (!viewport) return;
  viewport.classList.toggle("is-frame-tool", state.tool === "frame");
  viewport.classList.toggle("is-draw-tool", state.tool !== "select" && state.tool !== "frame");
}

export function fitToView() {
  if (!viewport || !state.doc) return;
  const bounds = framesBounds(state.doc);
  const rect = viewport.getBoundingClientRect();
  const w = Math.max(bounds.w, 1);
  const h = Math.max(bounds.h, 1);
  const availableW = rect.width - 120;
  const availableH = rect.height - 140;
  const zoom = Math.min(1, Math.max(0.1, Math.min(availableW / w, availableH / h)));
  setView({ zoom, pan: { x: Math.max(48, (rect.width - w * zoom) / 2 - bounds.x * zoom), y: Math.max(48, 64 - bounds.y * zoom) } });
}

export function setZoomPercent(percent, anchor = null) {
  if (!viewport) return;
  const zoom = Math.min(4, Math.max(0.1, percent / 100));
  if (anchor) {
    const rect = viewport.getBoundingClientRect();
    const docX = (anchor.clientX - rect.left - state.pan.x) / state.zoom;
    const docY = (anchor.clientY - rect.top - state.pan.y) / state.zoom;
    setView({ zoom, pan: { x: anchor.clientX - rect.left - docX * zoom, y: anchor.clientY - rect.top - docY * zoom } });
  } else {
    const rect = viewport.getBoundingClientRect();
    const centerX = rect.width / 2;
    const centerY = rect.height / 2;
    const docX = (centerX - state.pan.x) / state.zoom;
    const docY = (centerY - state.pan.y) / state.zoom;
    setView({ zoom, pan: { x: centerX - docX * zoom, y: centerY - docY * zoom } });
  }
}

export function zoomIn() {
  setZoomPercent(Math.round(state.zoom * 100 * 1.25));
}

export function zoomOut() {
  setZoomPercent(Math.round(state.zoom * 100 / 1.25));
}

function screenToDoc(clientX, clientY) {
  const rect = viewport.getBoundingClientRect();
  return { x: (clientX - rect.left - state.pan.x) / state.zoom, y: (clientY - rect.top - state.pan.y) / state.zoom };
}

function isTypingTarget(target) {
  return Boolean(
    target?.closest?.('input, textarea, select, [contenteditable="true"]') ||
      target?.isContentEditable,
  );
}

/** Фрейм под точкой документа (top-most, сверху вниз по массиву). */
function frameAtDocPoint(x, y) {
  const frames = state.doc?.frames || [];
  for (let i = frames.length - 1; i >= 0; i -= 1) {
    const frame = frames[i];
    if (frame.hidden) continue;
    const rect = frameRect(frame);
    if (x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h) return frame;
  }
  return null;
}

function onPointerDown(event) {
  if (!state.doc) return;
  if (state.presentation) return;
  const active = document.activeElement;
  if (
    active &&
    active !== document.body &&
    !active.closest?.("#canvasViewport") &&
    active.matches?.("input, textarea, select")
  ) {
    active.blur();
  }
  if (isTypingTarget(event.target)) return;

  // Ярлык фрейма: клик — выделить, протягивание — переставить порядок секций.
  const tag = event.target.closest(".frame-tag");
  if (tag) {
    event.preventDefault();
    const frameId = tag.dataset.frameId;
    if (event.shiftKey) {
      toggleFrameSelection(frameId, { additive: true });
      return;
    }
    if (!state.frameSelection.has(frameId) || state.frameSelection.size <= 1) {
      setActiveFrame(frameId);
      setFrameSelection([frameId]);
    } else {
      setActiveFrame(frameId);
      emit("active");
    }
    beginDragFrames(event);
    return;
  }

  if (event.button === 1 || spaceDown) {
    event.preventDefault();
    startPan(event);
    return;
  }
  if (event.button !== 0) return;

  // Управляющие маркеры выделения (элемент или фрейм)
  const handle = event.target.closest("[data-handle], .sel-handle");
  if (handle) {
    event.preventDefault();
    beginTransform(event, handle.dataset.handle || handleClassHandle(handle));
    return;
  }

  // Инструмент «фрейм» или рисование элемента: протягиваем рамку на пустом
  if (state.tool !== "select" && !event.target.closest(".sb-el[data-id]")) {
    event.preventDefault();
    startDrawTool(event);
    return;
  }

  const elNode = event.target.closest(".sb-el[data-id]");
  if (elNode) {
    if (elNode.dataset.locked === "1") {
      toast("Элемент заблокирован. Снимите замок в слоях.", { type: "info" });
      return;
    }
    event.preventDefault();
    const id = elNode.dataset.id;
    if (event.shiftKey) {
      toggleSelection(id);
      if (!state.selection.has(id)) return;
    } else if (!state.selection.has(id)) {
      setSelection([id]);
    } else {
      emit("active");
    }
    beginDragElements(event);
    return;
  }

  // Пустое место: рамка выделения элементов/фреймов. Клик без движения по
  // фрейму выделит сам фрейм, протягивание — выберет элементы внутри него.
  // Перетаскивание фрейма доступно, когда он уже выбран (тянем за пустое
  // место выбранного фрейма) или за его ярлык.
  const point = screenToDoc(event.clientX, event.clientY);
  const frame = frameAtDocPoint(point.x, point.y);
  if (frame) {
    if (event.shiftKey || event.metaKey || event.ctrlKey) {
      event.preventDefault();
      toggleFrameSelection(frame.id, { additive: true });
      return;
    }
    if (state.frameSelection.has(frame.id) || state.activeFrameId === frame.id) {
      // Фрейм уже выбран — тянем его (или всю группу выбранных).
      if (!state.frameSelection.has(frame.id) || state.frameSelection.size <= 1) {
        setActiveFrame(frame.id);
        setFrameSelection([frame.id]);
      } else {
        setActiveFrame(frame.id);
        emit("active");
      }
      event.preventDefault();
      beginDragFrames(event);
      return;
    }
    event.preventDefault();
    startMarquee(event, frame.id);
    return;
  }

  clearSelection();
  startMarquee(event, null);
}

function handleClassHandle(handle) {
  const match = [...handle.classList].find((name) => name.startsWith("handle-"));
  if (match) return match.replace("handle-", "");
  if (handle.classList.contains("rotate-handle")) return "rotate";
  return "se";
}

function startPan(event) {
  interaction = {
    type: "pan",
    startX: event.clientX,
    startY: event.clientY,
    startPan: { ...state.pan },
  };
  viewport.classList.add("is-panning");
}

// ---------------------------------------------------------------- Инструменты
function startDrawTool(event) {
  const start = screenToDoc(event.clientX, event.clientY);
  interaction = {
    type: "draw",
    tool: state.tool,
    start,
    moved: false,
    point: start,
  };
  if (marquee) {
    marquee.hidden = false;
    marquee.classList.add("is-draw");
    marquee.style.left = `${start.x}px`;
    marquee.style.top = `${start.y}px`;
    marquee.style.width = "0px";
    marquee.style.height = "0px";
  }
}

function updateDraw(event) {
  const point = screenToDoc(event.clientX, event.clientY);
  interaction.point = point;
  const x = Math.min(interaction.start.x, point.x);
  const y = Math.min(interaction.start.y, point.y);
  const w = Math.abs(point.x - interaction.start.x);
  const h = Math.abs(point.y - interaction.start.y);
  if (w > MIN_DRAG || h > MIN_DRAG) interaction.moved = true;
  if (marquee) {
    marquee.style.left = `${x}px`;
    marquee.style.top = `${y}px`;
    marquee.style.width = `${w}px`;
    marquee.style.height = `${h}px`;
  }
}

function finishDraw(info) {
  if (marquee) {
    marquee.hidden = true;
    marquee.classList.remove("is-draw");
  }
  const { tool, start, point, moved } = info;
  const x = Math.max(0, Math.min(start.x, point.x));
  const y = Math.max(0, Math.min(start.y, point.y));
  const w = Math.abs(point.x - start.x);
  const h = Math.abs(point.y - start.y);

  if (tool === "frame") {
    if (moved && w > MIN_DRAG && h > MIN_DRAG) {
      addFrame({ x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) });
    } else {
      addFrame({ x: Math.round(x), y: Math.round(y), ...DEFAULT_FRAME });
    }
    toast("Фрейм создан", { type: "success", duration: 1400 });
    setTool("select");
    return;
  }

  // Рисование элемента (text/heading/button/image/shape/line/embed)
  const frame = frameAtDocPoint(x + 2, y + 2) || getFrame(state.activeFrameId) || state.doc.frames[0];
  if (!frame) {
    toast("Сначала создайте фрейм", { type: "info" });
    setTool("select");
    return;
  }
  const relX = Math.round(x - (Number(frame.x) || 0));
  const relY = Math.round(y - (Number(frame.y) || 0));
  let el;
  if (moved && w > MIN_DRAG && h > MIN_DRAG) {
    // Создаём сразу с нужной высотой — иначе одно действие рисования
    // попадало бы в историю двумя шагами (add + resize).
    el = addElement(tool, { frameId: frame.id, x: relX, y: relY, width: Math.round(w), height: Math.round(h) });
    setSelection([el.id]);
  } else {
    el = addElement(tool, { frameId: frame.id, x: relX, y: relY });
  }
  setTool("select");
}

// ------------------------------------------------------------ Перетаскивание
function beginDragElements(event) {
  if (event.altKey) {
    const entries = selectedElements();
    if (entries.length) {
      duplicateElements(entries);
      toast("Копия создана — перетаскивайте", { type: "info", duration: 1400 });
    }
  }
  const entries = selectedElements().filter((entry) => !entry.el.locked);
  if (!entries.length) return;
  const originals = entries.map((entry) => {
    const rect = elementAbsoluteRect(entry);
    return { entry, x: rect.x, y: rect.y, w: rect.w, h: rect.h };
  });
  const start = screenToDoc(event.clientX, event.clientY);
  interaction = {
    type: "drag-el",
    start,
    originals,
    frameId: entries[0].frame.id,
    moved: false,
    alt: event.altKey,
  };
  viewport.classList.add("is-dragging");
}

function updateDragElements(event) {
  const point = screenToDoc(event.clientX, event.clientY);
  let dx = point.x - interaction.start.x;
  let dy = point.y - interaction.start.y;
  if (Math.abs(dx) + Math.abs(dy) > 1) interaction.moved = true;
  if (event.shiftKey) {
    if (Math.abs(dx) > Math.abs(dy)) dy = 0;
    else dx = 0;
  }
  const exclude = new Set(interaction.originals.map((item) => item.entry.el.id));
  const bounds = {
    x: Math.min(...interaction.originals.map((item) => item.x)),
    y: Math.min(...interaction.originals.map((item) => item.y)),
    w: 0,
    h: 0,
  };
  bounds.w = Math.max(...interaction.originals.map((item) => item.x + item.w)) - bounds.x;
  bounds.h = Math.max(...interaction.originals.map((item) => item.y + item.h)) - bounds.y;
  const proposed = { x: bounds.x + dx, y: bounds.y + dy, w: bounds.w, h: bounds.h };
  const snapped = snapRect(proposed, {
    frameId: interaction.frameId,
    excludeIds: exclude,
    threshold: event.altKey ? -1 : 6 / state.zoom,
  });
  dx += snapped.x - proposed.x;
  dy += snapped.y - proposed.y;
  setGuides(event.altKey ? [] : snapped.guides);
  if (!interaction.moved) return;
  update(() => {
    for (const item of interaction.originals) {
      const fx = Number(item.entry.frame?.x) || 0;
      const fy = Number(item.entry.frame?.y) || 0;
      item.entry.el.x = Math.round(item.x + dx - fx);
      item.entry.el.y = Math.round(item.y + dy - fy);
    }
  }, { label: "drag" });
  updateSizeTooltip(`${Math.round(bounds.w)} × ${Math.round(bounds.h)}`, event);
}

function maybeMoveElToAnotherFrame() {
  const entries = selectedElements();
  if (entries.length !== 1) return false;
  const entry = entries[0];
  if (entry.el.locked) return false;
  const rect = elementAbsoluteRect(entry);
  const cx = rect.x + rect.w / 2;
  const cy = rect.y + rect.h / 2;
  const target = frameAtDocPoint(cx, cy);
  if (!target || target.id === entry.frame.id) return false;
  // Общие шапка/подвал живут вне страниц: контент туда переносить нельзя.
  if (target.role) return false;
  const oldFrame = entry.frame;
  commit(() => {
    oldFrame.elements = oldFrame.elements.filter((el) => el.id !== entry.el.id);
    entry.el.x = Math.round(rect.x - (Number(target.x) || 0));
    entry.el.y = Math.round(rect.y - (Number(target.y) || 0));
    entry.el.z = Math.max(0, ...target.elements.map((el) => Number(el.z) || 0)) + 1;
    target.elements.push(entry.el);
  }, { label: "move-frame" });
  setActiveFrame(target.id);
  toast(`Элемент перенесён в «${target.name}»`, { type: "info", duration: 1600 });
  return true;
}

// ------------------------------------------------------------ Фреймы: перенос
function beginDragFrames(event) {
  const frames = selectedFrames().filter((frame) => !frame.locked);
  if (!frames.length) return;
  const originals = frames.map((frame) => ({ frame, x: Number(frame.x) || 0, y: Number(frame.y) || 0 }));
  interaction = {
    type: "drag-frame",
    start: screenToDoc(event.clientX, event.clientY),
    originals,
    moved: false,
  };
  viewport.classList.add("is-dragging");
}

function updateDragFrames(event) {
  const point = screenToDoc(event.clientX, event.clientY);
  let dx = point.x - interaction.start.x;
  let dy = point.y - interaction.start.y;
  if (Math.abs(dx) + Math.abs(dy) > 1) interaction.moved = true;
  if (event.shiftKey) {
    if (Math.abs(dx) > Math.abs(dy)) dy = 0;
    else dx = 0;
  }
  if (!interaction.moved) return;
  update(() => {
    // Секции стоят во всю ширину канваса, поэтому по горизонтали не двигаем —
    // важен только вертикальный порядок, а он разводится автоукладкой.
    for (const item of interaction.originals) {
      if (event.shiftKey && Math.abs(dx) > Math.abs(dy)) {
        item.frame.x = Math.round(item.x + dx);
        item.frame.y = Math.round(item.y);
      } else {
        item.frame.y = Math.round(item.y + dy);
      }
    }
    restackFrames();
  }, { label: "drag-frame" });
  const first = interaction.originals[0].frame;
  updateSizeTooltip(`${Math.round(first.x)}, ${Math.round(first.y)}`, event);
}

// --------------------------------------------------------- Трансформация
function beginTransform(event, handle) {
  const frames = selectedFrames().filter((frame) => !frame.locked);
  const entries = selectedElements().filter((entry) => !entry.el.locked);
  const isFrame = frames.length > 0 && !entries.length;

  if (handle === "rotate" && isFrame) return; // фреймы не поворачиваем
  if (!frames.length && !entries.length) return;

  let bounds;
  let originals;
  if (isFrame) {
    originals = frames.map((frame) => ({ frame, x: Number(frame.x) || 0, y: Number(frame.y) || 0, w: Number(frame.w) || 0, h: Number(frame.h) || 0 }));
    bounds = unionRect(originals);
  } else {
    originals = entries.map((entry) => {
      const rect = elementAbsoluteRect(entry);
      return { entry, x: rect.x, y: rect.y, w: rect.w, h: rect.h };
    });
    bounds = unionRect(originals);
  }
  interaction = {
    type: isFrame ? "resize-frame" : (handle === "rotate" ? "rotate" : "resize"),
    handle,
    originals,
    bounds,
    start: screenToDoc(event.clientX, event.clientY),
    startRotation: !isFrame ? entries[0]?.el.rotation || 0 : 0,
    center: { x: bounds.x + bounds.w / 2, y: bounds.y + bounds.h / 2 },
    entry: !isFrame ? entries[0] : null,
    frameId: !isFrame ? entries[0]?.frame.id : null,
    moved: false,
  };
  viewport.classList.add("is-transforming");
}

function unionRect(items) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const item of items) {
    minX = Math.min(minX, item.x);
    minY = Math.min(minY, item.y);
    maxX = Math.max(maxX, item.x + item.w);
    maxY = Math.max(maxY, item.y + item.h);
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

/** Вычислить новый прямоугольник по маркеру с привязкой. */
function computeResize(event, bounds, handle, frameId, excludeIds) {
  const point = screenToDoc(event.clientX, event.clientY);
  const minSize = HANDLE_MIN;
  let x = bounds.x;
  let y = bounds.y;
  let w = bounds.w;
  let h = bounds.h;
  const left = handle.includes("w");
  const right = handle.includes("e");
  const top = handle.includes("n");
  const bottom = handle.includes("s");
  const threshold = event.altKey ? -1 : 6 / state.zoom;

  if (left) {
    const snapped = snapCoordinate(point.x, "x", { frameId, excludeIds, threshold });
    const edge = Math.min(bounds.x + bounds.w - minSize, snapped.value);
    x = edge;
    w = bounds.x + bounds.w - edge;
    setGuides(snapped.guide ? [snapped.guide] : []);
  }
  if (right) {
    const snapped = snapCoordinate(point.x, "x", { frameId, excludeIds, threshold });
    const edge = Math.max(bounds.x + minSize, snapped.value);
    w = edge - bounds.x;
    setGuides(snapped.guide ? [snapped.guide] : []);
  }
  if (top) {
    const snapped = snapCoordinate(point.y, "y", { frameId, excludeIds, threshold });
    const edge = Math.min(bounds.y + bounds.h - minSize, snapped.value);
    y = edge;
    h = bounds.y + bounds.h - edge;
    setGuides(snapped.guide ? [snapped.guide] : []);
  }
  if (bottom) {
    const snapped = snapCoordinate(point.y, "y", { frameId, excludeIds, threshold });
    const edge = Math.max(bounds.y + minSize, snapped.value);
    h = edge - bounds.y;
    setGuides(snapped.guide ? [snapped.guide] : []);
  }

  if (event.shiftKey && (left || right) && (top || bottom) && bounds.w > 0 && bounds.h > 0) {
    const ratio = bounds.w / bounds.h;
    if (w / h > ratio) w = h * ratio;
    else h = w / ratio;
    if (left) x = bounds.x + bounds.w - w;
    if (top) y = bounds.y + bounds.h - h;
  }

  w = Math.max(minSize, w);
  h = Math.max(minSize, h);
  return { x, y, w, h };
}

function updateResizeFrame(event) {
  const { bounds, handle, originals } = interaction;
  const rect = computeResize(event, bounds, handle, null, new Set());
  interaction.moved = true;
  const sx = bounds.w ? rect.w / bounds.w : 1;
  const sy = bounds.h ? rect.h / bounds.h : 1;
  update(() => {
    for (const item of originals) {
      item.frame.x = Math.round(rect.x + (item.x - bounds.x) * sx);
      item.frame.y = Math.round(rect.y + (item.y - bounds.y) * sy);
      item.frame.w = Math.max(1, Math.round(item.w * sx));
      item.frame.h = Math.max(1, Math.round(item.h * sy));
    }
    // Когда меняем высоту секции, всё, что ниже, сдвигается вниз — наложений нет.
    restackFrames();
  }, { label: "resize-frame" });
  updateSizeTooltip(`${Math.round(rect.w)} × ${Math.round(rect.h)}`, event);
}

function updateResizeElements(event) {
  const { bounds, handle, originals, frameId } = interaction;
  const rect = computeResize(event, bounds, handle, frameId, new Set(originals.map((item) => item.entry.el.id)));
  interaction.moved = true;
  const sx = bounds.w ? rect.w / bounds.w : 1;
  const sy = bounds.h ? rect.h / bounds.h : 1;
  update(() => {
    for (const item of originals) {
      const fx = Number(item.entry.frame?.x) || 0;
      const fy = Number(item.entry.frame?.y) || 0;
      const relX = (item.x - bounds.x) * sx;
      const relY = (item.y - bounds.y) * sy;
      item.entry.el.x = Math.round(rect.x + relX - fx);
      item.entry.el.y = Math.round(rect.y + relY - fy);
      item.entry.el.w = Math.max(1, Math.round(item.w * sx));
      item.entry.el.h = Math.max(1, Math.round(item.h * sy));
    }
  }, { label: "resize" });
  updateSizeTooltip(`${Math.round(rect.w)} × ${Math.round(rect.h)}`, event);
}

function updateRotate(event) {
  const point = screenToDoc(event.clientX, event.clientY);
  const { center, entry } = interaction;
  let angle = (Math.atan2(point.y - center.y, point.x - center.x) * 180) / Math.PI + 90;
  if (event.shiftKey) angle = Math.round(angle / 15) * 15;
  angle = Math.round(angle);
  interaction.moved = true;
  update(() => {
    entry.el.rotation = angle;
  }, { label: "rotate" });
  updateSizeTooltip(`${angle}°`, event);
}

// ------------------------------------------------------------- Рамка выделения
function startMarquee(event, startFrameId = null) {
  const start = screenToDoc(event.clientX, event.clientY);
  const startFrame = startFrameId
    ? (state.doc?.frames || []).find((frame) => frame.id === startFrameId) || null
    : frameAtDocPoint(start.x, start.y);
  interaction = {
    type: "marquee",
    start,
    startFrameId: startFrame ? startFrame.id : null,
    additive: event.shiftKey,
    baseElements: event.shiftKey ? [...state.selection] : [],
    baseFrames: event.shiftKey ? [...state.frameSelection] : [],
    moved: false,
  };
  if (marquee) {
    marquee.hidden = false;
    marquee.classList.remove("is-draw");
    marquee.style.left = `${start.x}px`;
    marquee.style.top = `${start.y}px`;
    marquee.style.width = "0px";
    marquee.style.height = "0px";
  }
}

function updateMarquee(event) {
  const point = screenToDoc(event.clientX, event.clientY);
  const x = Math.min(interaction.start.x, point.x);
  const y = Math.min(interaction.start.y, point.y);
  const w = Math.abs(point.x - interaction.start.x);
  const h = Math.abs(point.y - interaction.start.y);
  if (w > 1 || h > 1) interaction.moved = true;
  if (marquee) {
    marquee.style.left = `${x}px`;
    marquee.style.top = `${y}px`;
    marquee.style.width = `${w}px`;
    marquee.style.height = `${h}px`;
  }
  interaction.rect = { x, y, w, h };
  highlightMarquee(interaction, { x, y, w, h });
}

/** Живая подсветка того, что попадёт в рамку выделения. */
function highlightMarquee(info, rect) {
  if (!world) return;
  const frames = state.doc?.frames || [];
  const insideFrame = info.startFrameId
    ? frames.find((frame) => frame.id === info.startFrameId)
    : null;
  const markFrames = !insideFrame;

  for (const [id, node] of nodeCache) {
    const entry = findElement(id);
    if (!entry) continue;
    const fx = Number(entry.frame.x) || 0;
    const fy = Number(entry.frame.y) || 0;
    const el = entry.el;
    const hit = !insideFrame
      ? false
      : !el.hidden && !el.locked && intersects(rect, fx + Number(el.x), fy + Number(el.y), Number(el.w), Number(el.h));
    node.classList.toggle("is-marquee", hit);
  }
  for (const frameNode of world.querySelectorAll(".sb-frame")) {
    const frameId = String(frameNode.id || "").replace(/^frame-/, "");
    const frame = frames.find((item) => item.id === frameId);
    if (!frame) continue;
    const hit = markFrames
      && !frame.hidden && !frame.locked && frame.role !== "header" && frame.role !== "footer"
      && intersects(rect, Number(frame.x) || 0, Number(frame.y) || 0, Number(frame.w) || 0, Number(frame.h) || 0);
    frameNode.classList.toggle("is-marquee", hit);
  }
}

function clearMarqueeHighlight() {
  if (!world) return;
  world.querySelectorAll(".is-marquee").forEach((node) => node.classList.remove("is-marquee"));
}

function intersects(rect, x, y, w, h) {
  return x < rect.x + rect.w && x + w > rect.x && y < rect.y + rect.h && y + h > rect.y;
}

function finishMarquee(info) {
  if (marquee) marquee.hidden = true;
  if (!info.moved || !info.rect) {
    // Клик без протягивания: если попали по фрейму — выделяем его.
    if (info.startFrameId) {
      setActiveFrame(info.startFrameId);
      setFrameSelection([info.startFrameId]);
    } else if (!info.additive) {
      clearSelection();
    }
    return;
  }
  const rect = info.rect;
  const frames = state.doc.frames || [];
  const insideFrame = info.startFrameId
    ? frames.find((frame) => frame.id === info.startFrameId)
    : null;

  // Рамку тянем внутри фрейма — выделяем элементы; начали на пустом месте —
  // выделяем сами фреймы. Так проще и предсказуемее, чем «или-или» по факту
  // пересечения, и шанс случайно утащить весь фрейм вместо элементов нулевой.
  const elementIds = [];
  const frameIds = [];

  if (insideFrame) {
    for (const el of insideFrame.elements || []) {
      if (el.hidden || el.locked) continue;
      const ex = (Number(insideFrame.x) || 0) + Number(el.x);
      const ey = (Number(insideFrame.y) || 0) + Number(el.y);
      if (intersects(rect, ex, ey, Number(el.w), Number(el.h))) elementIds.push(el.id);
    }
    // Если ни один элемент не задет — выделяем сам фрейм (частая ситуация,
    // когда пользователь тянет по пустому месту внутри большого фрейма).
    if (!elementIds.length && intersects(rect, Number(insideFrame.x) || 0, Number(insideFrame.y) || 0, Number(insideFrame.w) || 0, Number(insideFrame.h) || 0)) {
      frameIds.push(insideFrame.id);
    }
  } else {
    for (const frame of frames) {
      if (frame.hidden || frame.role === "header" || frame.role === "footer" || frame.locked) continue;
      if (intersects(rect, Number(frame.x) || 0, Number(frame.y) || 0, Number(frame.w) || 0, Number(frame.h) || 0)) {
        frameIds.push(frame.id);
      }
    }
  }

  if (elementIds.length) {
    const combined = info.additive ? [...new Set([...info.baseElements, ...elementIds])] : elementIds;
    setSelection(combined);
    return;
  }
  if (frameIds.length) {
    const combined = info.additive ? [...new Set([...info.baseFrames, ...frameIds])] : frameIds;
    setFrameSelection(combined);
    return;
  }
  if (!info.additive) clearSelection();
}

function onPointerMove(event) {
  if (!interaction) return;
  switch (interaction.type) {
    case "pan": {
      const dx = event.clientX - interaction.startX;
      const dy = event.clientY - interaction.startY;
      setView({ pan: { x: interaction.startPan.x + dx, y: interaction.startPan.y + dy } });
      break;
    }
    case "marquee":
      updateMarquee(event);
      break;
    case "draw":
      updateDraw(event);
      break;
    case "drag-el":
      updateDragElements(event);
      break;
    case "drag-frame":
      updateDragFrames(event);
      break;
    case "resize":
      updateResizeElements(event);
      break;
    case "resize-frame":
      updateResizeFrame(event);
      break;
    case "rotate":
      updateRotate(event);
      break;
    default:
      break;
  }
}

function onPointerUp() {
  if (!interaction) return;
  const finished = interaction;
  interaction = null;
  viewport?.classList.remove("is-panning", "is-dragging", "is-transforming");
  updateSizeTooltip("");
  setGuides([]);

  if (finished.type === "draw") {
    finishDraw(finished);
    return;
  }
  if (finished.type === "marquee") {
    clearMarqueeHighlight();
    finishMarquee(finished);
    return;
  }
  if (finished.type === "drag-el") {
    if (finished.moved) {
      const movedFrame = maybeMoveElToAnotherFrame();
      if (!movedFrame) pushHistory("drag");
      emit("doc", { source: "drag-end" });
    }
    return;
  }
  if (finished.type === "drag-frame") {
    if (finished.moved) {
      pushHistory("drag-frame");
      emit("doc", { source: "drag-end" });
    }
    return;
  }
  if (finished.type === "resize" || finished.type === "resize-frame" || finished.type === "rotate") {
    if (finished.moved) {
      pushHistory(finished.type);
      emit("doc", { source: "transform-end" });
    }
  }
}

function updateNodesPointwise() {
  for (const [id, node] of nodeCache) {
    const entry = findElement(id);
    if (!entry) continue;
    const { el } = entry;
    node.style.left = `${el.x}px`;
    node.style.top = `${el.y}px`;
    node.style.width = `${el.w}px`;
    node.style.height = `${el.h}px`;
    node.style.zIndex = el.z;
    node.style.opacity = el.style?.opacity ?? 1;
    node.style.transform = `rotate(${el.rotation || 0}deg)`;
    node.style.display = el.hidden ? "none" : "";
  }
  renderOverlay();
}

function onWheel(event) {
  if (!state.doc) return;
  if (event.ctrlKey || event.metaKey) {
    event.preventDefault();
    const delta = -event.deltaY * 0.012;
    const next = Math.min(4, Math.max(0.1, state.zoom * (1 + delta)));
    const viewportRect = viewport.getBoundingClientRect();
    const docX = (event.clientX - viewportRect.left - state.pan.x) / state.zoom;
    const docY = (event.clientY - viewportRect.top - state.pan.y) / state.zoom;
    setView({
      zoom: next,
      pan: {
        x: event.clientX - viewportRect.left - docX * next,
        y: event.clientY - viewportRect.top - docY * next,
      },
    });
    return;
  }
  event.preventDefault();
  setView({ pan: { x: state.pan.x - event.deltaX, y: state.pan.y - event.deltaY } });
}

function onDoubleClick(event) {
  const elNode = event.target.closest(".sb-el[data-id]");
  if (elNode) {
    const entry = findElement(elNode.dataset.id);
    if (!entry) return;
    if (!["text", "heading", "button"].includes(entry.el.type)) return;
    if (entry.el.locked) {
      toast("Элемент заблокирован", { type: "info" });
      return;
    }
    event.preventDefault();
    startTextEditing(elNode, entry);
    return;
  }
  // Двойной клик по фрейму — переименование ярлыка
  const tag = event.target.closest(".frame-tag");
  if (tag) {
    event.preventDefault();
    beginRenameFrame(tag);
  }
}

function startTextEditing(node, entry) {
  const target =
    node.querySelector(".sb-text") ||
    node.querySelector(".sb-button") ||
    node.querySelector(".sb-el-inner") ||
    node;
  if (!target) return;
  state.editingId = entry.el.id;
  const original = entry.el.props?.text || "";
  target.setAttribute("contenteditable", "true");
  target.classList.add("is-editing");
  target.focus();
  const range = document.createRange();
  range.selectNodeContents(target);
  range.collapse(false);
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);

  let cancelled = false;
  const finish = (save) => {
    if (cancelled) return;
    target.removeAttribute("contenteditable");
    target.classList.remove("is-editing");
    state.editingId = null;
    const text = target.innerText.replace(/\n$/, "");
    if (save && text !== original) {
      commit(() => {
        const found = findElement(entry.el.id);
        if (found) found.el.props.text = text;
      }, { label: "text-edit" });
    } else {
      renderCanvas();
    }
  };

  target.addEventListener("blur", () => finish(true), { once: true });
  target.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      cancelled = true;
      target.innerText = original;
      renderCanvas();
      return;
    }
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      target.blur();
    }
    event.stopPropagation();
  });
}

function beginRenameFrame(tag) {
  const frameId = tag.dataset.frameId;
  const frame = getFrame(frameId);
  if (!frame) return;
  const input = document.createElement("input");
  input.className = "frame-rename";
  input.value = frame.name || "";
  tag.replaceWith(input);
  input.focus();
  input.select();
  let cancelled = false;
  const finish = (save) => {
    if (cancelled) return;
    if (save && input.value.trim()) {
      updateFrame(frameId, { name: input.value.trim().slice(0, 60) });
    } else {
      renderOverlay();
    }
  };
  input.addEventListener("blur", () => finish(true), { once: true });
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") input.blur();
    if (event.key === "Escape") {
      cancelled = true;
      input.value = frame.name;
      renderOverlay();
      input.blur();
    }
    event.stopPropagation();
  });
}

function dropElementFromLibrary(type, point) {
  if (!state.doc || !type) return;
  let frame = frameAtDocPoint(point.x, point.y);
  if (!frame) {
    const width = Math.max(480, Math.min(960, Number(state.doc.settings?.width) || 1200));
    frame = addFrame({
      x: Math.round(point.x - width / 2),
      y: Math.round(point.y - 120),
      w: width,
      h: 420,
      bg: "#FFFFFF",
    });
    if (!frame) return;
  }
  const el = createElement(type, { frameId: frame.id });
  const frameX = Number(frame.x) || 0;
  const frameY = Number(frame.y) || 0;
  const maxX = Math.max(0, (Number(frame.w) || 1200) - el.w);
  const maxY = Math.max(0, (Number(frame.h) || 400) - el.h);
  el.x = Math.round(Math.min(maxX, Math.max(0, point.x - frameX - el.w / 2)));
  el.y = Math.round(Math.min(maxY, Math.max(0, point.y - frameY - el.h / 2)));
  commit(() => {
    const target = getFrame(frame.id);
    if (target) target.elements.push(el);
  }, { label: `drop-${type}` });
  setActiveFrame(frame.id);
  setSelection([el.id]);
  toast("Элемент добавлен на холст", { type: "success", duration: 1400 });
}

export function addElementCentered(type) {
  const frame = getFrame(state.activeFrameId) || state.doc?.frames?.[0];
  if (!frame) {
    toast("Сначала создайте фрейм (клавиша F)", { type: "error" });
    return;
  }
  addElement(type, { frameId: frame.id, center: true, y: 80 });
}

export function startInlineEditSelected() {
  const entry = selectedElements()[0];
  if (!entry || !["text", "heading", "button"].includes(entry.el.type)) return;
  const node = root?.querySelector(`.sb-el[data-id="${entry.el.id}"]`);
  if (node) startTextEditing(node, entry);
}
