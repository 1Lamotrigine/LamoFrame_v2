/** Отрисовка выделения, направляющих, ярлыков фреймов и размеров. */

import { selectedElements, selectedFrames, selectionBounds, state } from "./state.js";

/**
 * Абсолютный прямоугольник элемента в координатах документа.
 * Элементы хранят x/y относительно левого верхнего угла своего фрейма,
 * поэтому прибавляем смещение фрейма.
 */
export function elementAbsoluteRect(entry) {
  const frame = entry.frame || {};
  return {
    x: (Number(frame.x) || 0) + Number(entry.el.x),
    y: (Number(frame.y) || 0) + Number(entry.el.y),
    w: Number(entry.el.w),
    h: Number(entry.el.h),
    rotation: Number(entry.el.rotation) || 0,
  };
}

export function frameRect(frame) {
  return {
    x: Number(frame.x) || 0,
    y: Number(frame.y) || 0,
    w: Number(frame.w) || 0,
    h: Number(frame.h) || 0,
    rotation: 0,
  };
}

/** Прямоугольник текущего выделения: фреймы или элементы. */
export function selectionRect() {
  const frames = selectedFrames();
  if (frames.length) {
    if (frames.length === 1) {
      return { ...frameRect(frames[0]), single: true, kind: "frame", ids: [frames[0].id] };
    }
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const frame of frames) {
      const rect = frameRect(frame);
      minX = Math.min(minX, rect.x);
      minY = Math.min(minY, rect.y);
      maxX = Math.max(maxX, rect.x + rect.w);
      maxY = Math.max(maxY, rect.y + rect.h);
    }
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY, rotation: 0, single: false, kind: "frame", ids: frames.map((f) => f.id) };
  }

  const entries = selectedElements();
  if (!entries.length) return null;
  const single = entries.length === 1;
  if (single) {
    const entry = entries[0];
    return {
      ...elementAbsoluteRect(entry),
      single: true,
      kind: "element",
      frameId: entry.frame.id,
      ids: [entry.el.id],
      rotation: Number(entry.el.rotation) || 0,
    };
  }
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const entry of entries) {
    const rect = elementAbsoluteRect(entry);
    minX = Math.min(minX, rect.x);
    minY = Math.min(minY, rect.y);
    maxX = Math.max(maxX, rect.x + rect.w);
    maxY = Math.max(maxY, rect.y + rect.h);
  }
  return {
    x: minX,
    y: minY,
    w: maxX - minX,
    h: maxY - minY,
    rotation: 0,
    single: false,
    kind: "element",
    ids: entries.map((entry) => entry.el.id),
    bounds: selectionBounds(entries),
  };
}

function node(tag, className, html = "") {
  const element = document.createElement(tag);
  element.className = className;
  if (html) element.innerHTML = html;
  return element;
}

export function renderOverlay() {
  const boxes = document.getElementById("selectionBoxes");
  const guides = document.getElementById("guides");
  const tags = document.getElementById("frameTags");
  if (!boxes || !guides || !tags) return;

  boxes.innerHTML = "";
  guides.innerHTML = "";
  tags.innerHTML = "";

  const rect = selectionRect();
  if (rect) {
    const box = node("div", "sel-box");
    box.style.left = `${rect.x}px`;
    box.style.top = `${rect.y}px`;
    box.style.width = `${rect.w}px`;
    box.style.height = `${rect.h}px`;
    if (rect.kind === "frame") box.classList.add("is-frame");
    if (rect.rotation) box.style.transform = `rotate(${rect.rotation}deg)`;
    if (!rect.single) box.classList.add("is-multi");

    const handles = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];
    for (const handle of handles) {
      const handleNode = node("div", `sel-handle handle-${handle}`);
      handleNode.dataset.handle = handle;
      box.appendChild(handleNode);
    }
    if (rect.kind === "element" && rect.single) {
      const rotate = node("div", "rotate-handle", '<svg class="icon icon-sm"><use href="' + window.BUILDER.iconsUrl + '#i-rotate"></use></svg>');
      rotate.dataset.handle = "rotate";
      box.appendChild(rotate);
    }
    const label = node("div", "sel-label");
    label.textContent = rect.single
      ? `${Math.round(rect.w)} × ${Math.round(rect.h)}`
      : `${rect.ids.length} ${rect.kind === "frame" ? "фрейма" : "элемента"}`;
    box.appendChild(label);
    boxes.appendChild(box);
  }

  for (const guide of state.guides || []) {
    const line = node("div", `guide guide-${guide.axis}${guide.kind === "art" ? " is-art" : ""}`);
    if (guide.axis === "x") line.style.left = `${guide.pos}px`;
    else line.style.top = `${guide.pos}px`;
    guides.appendChild(line);
  }

  // Ярлыки фреймов над каждым артбордом.
  const activeFrame = state.activeFrameId;
  for (const frame of state.doc?.frames || []) {
    const tag = node("button", "frame-tag");
    tag.type = "button";
    tag.dataset.frameId = frame.id;
    tag.style.left = `${Number(frame.x) || 0}px`;
    tag.style.top = `${Number(frame.y) || 0}px`;
    tag.innerHTML = `<span class="frame-tag-name"></span>${frame.role ? `<span class="frame-tag-role">${frame.role === "header" ? "сверху" : "снизу"}</span>` : ""}<span class="frame-tag-size"></span>`;
    tag.querySelector(".frame-tag-name").textContent = frame.name || "Фрейм";
    tag.querySelector(".frame-tag-size").textContent =
      `${Math.round(Number(frame.w) || 0)} × ${Math.round(Number(frame.h) || 0)}`;
    if (frame.id === activeFrame) tag.classList.add("is-active");
    if (frame.hidden) tag.classList.add("is-hidden");
    tags.appendChild(tag);
  }
}

export function updateSizeTooltip(text, event) {
  const tooltip = document.getElementById("sizeTooltip");
  if (!tooltip) return;
  if (!text) {
    tooltip.hidden = true;
    return;
  }
  tooltip.hidden = false;
  tooltip.textContent = text;
  tooltip.style.left = `${event.clientX + 14}px`;
  tooltip.style.top = `${event.clientY + 18}px`;
}
