/** Горячие клавиши редактора. */

import {
  copySelection,
  deleteElements,
  deleteFrame,
  deleteFrames,
  duplicateElements,
  duplicateFrame,
  groupSelection,
  moveFramesBy,
  moveSelectionBy,
  pasteClipboard,
  redo,
  selectedElements,
  selectedFrames,
  setSelection,
  setTool,
  state,
  undo,
  ungroupSelection,
} from "./state.js";
import { startInlineEditSelected } from "./canvas.js";
import { toast } from "./toast.js";

let handlers = {};

export function initShortcuts(options = {}) {
  handlers = options;
  window.addEventListener("keydown", onKeyDown);
}

function isTyping(target) {
  return Boolean(
    target?.closest?.('input, textarea, select, [contenteditable="true"]') || target?.isContentEditable,
  );
}

function hasModal() {
  return [...document.querySelectorAll(".modal")].some((modal) => !modal.hidden);
}

function closeTopModal() {
  const modals = [...document.querySelectorAll(".modal")].filter((modal) => !modal.hidden);
  if (!modals.length) return false;
  modals[modals.length - 1].hidden = true;
  return true;
}

function onKeyDown(event) {
  const mac = navigator.platform.toUpperCase().includes("MAC");
  const mod = mac ? event.metaKey : event.ctrlKey;

  if (event.key === "Escape") {
    if (closeTopModal()) {
      event.preventDefault();
      return;
    }
    if (state.editingId) return;
    if (state.selection.size) {
      event.preventDefault();
      setSelection([]);
    }
    return;
  }

  if (isTyping(event.target)) {
    if (mod && event.key.toLowerCase() === "s") {
      event.preventDefault();
      handlers.onSave?.();
    }
    return;
  }

  if (hasModal() && event.key !== "?") return;

  if (event.key === "?" || (event.shiftKey && event.key === "/")) {
    event.preventDefault();
    handlers.onShortcuts?.();
    return;
  }

  if (mod && event.key.toLowerCase() === "k") {
    event.preventDefault();
    handlers.onPalette?.();
    return;
  }
  if (mod && event.key.toLowerCase() === "s") {
    event.preventDefault();
    handlers.onSave?.();
    return;
  }
  if (mod && event.key.toLowerCase() === "z") {
    event.preventDefault();
    if (event.shiftKey) redo();
    else undo();
    return;
  }
  if (mod && event.key.toLowerCase() === "y") {
    event.preventDefault();
    redo();
    return;
  }
  if (mod && event.key.toLowerCase() === "d") {
    event.preventDefault();
    const frames = selectedFrames();
    if (frames.length) {
      for (const frame of frames) duplicateFrame(frame.id);
      toast("Фрейм продублирован", { type: "success", duration: 1400 });
      return;
    }
    const entries = selectedElements();
    if (entries.length) {
      duplicateElements(entries);
      toast("Дубликат создан", { type: "success", duration: 1400 });
    }
    return;
  }
  if (mod && event.key.toLowerCase() === "c") {
    const kind = copySelection();
    if (kind) {
      event.preventDefault();
      toast(kind === "frames" ? "Фрейм скопирован" : "Скопировано", { type: "info", duration: 1200 });
    }
    return;
  }
  if (mod && event.key.toLowerCase() === "v") {
    if (state.clipboard) {
      event.preventDefault();
      const kind = state.clipboard.kind;
      if (pasteClipboard()) {
        toast(kind === "frames" ? "Фрейм вставлен" : "Вставлено", { type: "success", duration: 1200 });
      }
    }
    return;
  }
  if (mod && event.key.toLowerCase() === "a") {
    event.preventDefault();
    const ids = [];
    for (const frame of state.doc?.frames || []) {
      for (const el of frame.elements || []) if (!el.locked && !el.hidden) ids.push(el.id);
    }
    setSelection(ids);
    return;
  }
  if (mod && event.key === "0") {
    event.preventDefault();
    handlers.onResetZoom?.();
    return;
  }
  if (mod && event.key === "=") {
    event.preventDefault();
    handlers.onZoomIn?.();
    return;
  }
  if (mod && event.key === "-") {
    event.preventDefault();
    handlers.onZoomOut?.();
    return;
  }
  if (mod && event.key.toLowerCase() === "g") {
    event.preventDefault();
    if (event.shiftKey) {
      if (ungroupSelection()) toast("Группа разобрана", { type: "info", duration: 1200 });
    } else {
      const entries = selectedElements();
      if (entries.length >= 2) {
        if (groupSelection(entries)) toast("Элементы сгруппированы", { type: "success", duration: 1200 });
      } else {
        toast("Выберите 2+ элемента для группировки", { type: "info", duration: 1400 });
      }
    }
    return;
  }

  if (event.key === "Delete" || event.key === "Backspace") {
    const frames = selectedFrames();
    if (frames.length) {
      event.preventDefault();
      if (frames.length > 1) {
        deleteFrames(frames.map((frame) => frame.id));
        toast(`Удалено фреймов: ${frames.length}`, { type: "info", duration: 1400 });
      } else {
        deleteFrame(frames[0].id);
      }
      return;
    }
    const entries = selectedElements();
    if (entries.length) {
      event.preventDefault();
      deleteElements(entries);
    }
    return;
  }

  if (event.key === "Enter" && state.selection.size === 1) {
    event.preventDefault();
    startInlineEditSelected();
    return;
  }

  if (event.key === "F" && !mod && !event.shiftKey) {
    event.preventDefault();
    setTool(state.tool === "frame" ? "select" : "frame");
    return;
  }
  if (event.key === "F" && !mod && event.shiftKey) {
    event.preventDefault();
    handlers.onPresentation?.();
    return;
  }
  if (event.key === "E" && !mod) {
    event.preventDefault();
    handlers.onExport?.();
    return;
  }
  if (event.key === "P" && !mod) {
    event.preventDefault();
    handlers.onPreview?.();
    return;
  }

  const step = event.shiftKey ? 10 : 1;
  const arrows = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
  if (arrows[event.key] && (state.selection.size || state.frameSelection.size)) {
    event.preventDefault();
    if (state.selection.size) moveSelectionBy(...arrows[event.key]);
    else moveFramesBy(...arrows[event.key]);
    return;
  }

  if (event.key === "+" || event.key === "=") {
    event.preventDefault();
    handlers.onZoomIn?.();
  }
  if (event.key === "-") {
    event.preventDefault();
    handlers.onZoomOut?.();
  }
  if (event.key === "1" && event.shiftKey) {
    event.preventDefault();
    handlers.onFit?.();
  }
}
