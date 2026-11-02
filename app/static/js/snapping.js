/** Привязка к краям и центрам фрейма и соседних элементов. */

import { getFrame, state } from "./state.js";

/**
 * Собрать цели привязки в координатах документа для фрейма.
 * Края и центры самого фрейма + края/центры соседних элементов внутри него.
 */
export function collectTargets(frameId, excludeIds = new Set()) {
  const frame = getFrame(frameId);
  const fx = Number(frame?.x) || 0;
  const fy = Number(frame?.y) || 0;
  const width = Number(frame?.w) || 600;
  const height = Number(frame?.h) || 400;
  const x = [
    { value: fx, kind: "art" },
    { value: fx + width / 2, kind: "art" },
    { value: fx + width, kind: "art" },
  ];
  const y = [
    { value: fy, kind: "art" },
    { value: fy + height / 2, kind: "art" },
    { value: fy + height, kind: "art" },
  ];
  for (const el of frame?.elements || []) {
    if (excludeIds.has(el.id) || el.hidden) continue;
    const ex = fx + Number(el.x);
    const ey = fy + Number(el.y);
    x.push(
      { value: ex, kind: "el" },
      { value: ex + Number(el.w) / 2, kind: "el" },
      { value: ex + Number(el.w), kind: "el" },
    );
    y.push(
      { value: ey, kind: "el" },
      { value: ey + Number(el.h) / 2, kind: "el" },
      { value: ey + Number(el.h), kind: "el" },
    );
  }
  return { x, y, artWidth: width, artHeight: height, frameX: fx, frameY: fy };
}

function closestDelta(edges, targets) {
  let best = null;
  for (const edge of edges) {
    for (const target of targets) {
      const delta = target.value - edge.value;
      if (best === null || Math.abs(delta) < Math.abs(best.delta)) {
        best = { delta, target: target.value, edge: edge.value };
      }
    }
  }
  return best;
}

/**
 * Притянуть прямоугольник (в координатах документа) к сетке краёв.
 * @returns {{x:number,y:number,guides:Array}}
 */
export function snapRect(rect, { frameId, excludeIds = new Set(), threshold = 6 } = {}) {
  const targets = collectTargets(frameId, excludeIds);
  const edgesX = [
    { value: rect.x, name: "left" },
    { value: rect.x + rect.w / 2, name: "center" },
    { value: rect.x + rect.w, name: "right" },
  ];
  const edgesY = [
    { value: rect.y, name: "top" },
    { value: rect.y + rect.h / 2, name: "middle" },
    { value: rect.y + rect.h, name: "bottom" },
  ];
  const bestX = closestDelta(edgesX, targets.x);
  const bestY = closestDelta(edgesY, targets.y);
  const guides = [];
  let x = rect.x;
  let y = rect.y;
  if (bestX && Math.abs(bestX.delta) <= threshold) {
    x += bestX.delta;
    guides.push({ axis: "x", pos: bestX.target, kind: bestX.target === targets.frameX || bestX.target === targets.frameX + targets.artWidth ? "art" : "el" });
  }
  if (bestY && Math.abs(bestY.delta) <= threshold) {
    y += bestY.delta;
    guides.push({ axis: "y", pos: bestY.target, kind: bestY.target === targets.frameY || bestY.target === targets.frameY + targets.artHeight ? "art" : "el" });
  }
  return { x, y, guides };
}

/** Притянуть одну координату документа (для ресайза). */
export function snapCoordinate(value, axis, { frameId, excludeIds = new Set(), threshold = 6 } = {}) {
  const targets = collectTargets(frameId, excludeIds);
  const list = axis === "x" ? targets.x : targets.y;
  let best = null;
  for (const target of list) {
    const delta = target.value - value;
    if (best === null || Math.abs(delta) < Math.abs(best.delta)) best = { delta, target: target.value };
  }
  if (best && Math.abs(best.delta) <= threshold) {
    return { value: value + best.delta, guide: { axis, pos: best.target, kind: "el" } };
  }
  return { value, guide: null };
}

export function snapStep(delta, threshold) {
  return Math.abs(delta) <= threshold;
}
