/** Сборка редактора: связывает состояние, холст, панели, сохранение и экспорт. */

import { loadProject, saveProject, uploadAsset } from "./api.js";
import {
  addElement,
  addFrame,
  addPage,
  commit,
  editingDevice,
  emit,
  findElement,
  getFrame,
  init,
  on,
  redo,
  responsiveAuto,
  serializeDoc,
  setEditingDevice,
  setResponsiveAuto,
  regenerateDeviceLayout,
  setActiveFrame,
  setFrameSelection,
  setSaveState,
  setSelection,
  setTheme,
  setTool,
  state,
  undo,
} from "./state.js";
import {
  addElementCentered,
  fitToView,
  initCanvas,
  renderCanvas,
  setZoomPercent,
  zoomIn,
  zoomOut,
} from "./canvas.js";
import { initLayers, setAssets } from "./layers.js";
import { initPages } from "./pages.js";
import { insertBlock } from "./blocks.js";
import { initPanels } from "./panels.js";
import { initShortcuts } from "./shortcuts.js";
import { initPalette, openPalette, closePalette } from "./palette.js";
import { renderStandalone } from "./render.js";
import { createProjectZip } from "./bundle.js";
import { toast } from "./toast.js";

const projectId = window.BUILDER.projectId;
const docNode = document.getElementById("project-data");
const doc = docNode ? JSON.parse(docNode.textContent) : null;

let booted = false;
let saveTimer = null;
let saveInFlight = false;
let saveQueued = false;
let saveWaiters = [];
let docRevision = 0;
let baseUpdatedAt = window.BUILDER?.updatedAt || "";
let assetList = [];
let imageMode = null;
let presentationView = null;
let tourIndex = 0;

// Границы и ширина левой панели по умолчанию (см. setupSidebarResizer).
const LEFT_MIN = 200;
const LEFT_MAX = 560;
const LEFT_DEFAULT = 264;

const saveIndicator = document.getElementById("saveIndicator");
const saveText = document.getElementById("saveText");
const projectTitleInput = document.getElementById("projectTitle");
const canvasBadge = document.getElementById("canvasBadge");
const canvasSections = document.getElementById("canvasSections");
// Обучающий тур — оверлей со spotlight. Показываем в первый запуск,
// позже его можно вызвать кнопкой «?».
let tour = null;
let tourSpot = null;
let tourCard = null;
let tourEls = {};

if (!doc) {
  toast("Не удалось прочитать документ проекта", { type: "error" });
} else {
  state.theme = document.documentElement.dataset.theme === "dark" ? "dark" : "light";
  initCanvas({ onFiles: handleDroppedFiles });
  initLayers({ onUpload: () => document.getElementById("assetInput").click(), onAddAsset: addAssetToCanvas });
  initPages();
  initPanels({ onReplaceImage: () => requestImage("replace") });
  initPalette({
    addElement: (type) => addElementCentered(type),
    addFrame: () => createFrameFromToolbar(),
    addPage: () => {
      const page = addPage();
      if (page) toast(`Страница «${page.name}» создана`, { type: "success", duration: 1800 });
    },
    addBlock: (id) => insertBlock(id),
    gotoFrame: (frameId) => {
      setActiveFrame(frameId);
      setFrameSelection([frameId]);
      fitToView();
    },
    save: () => saveNow({ manual: true }),
    preview: openPreview,
    export: exportProject,
    presentation: togglePresentation,
    fit: fitToView,
    zoomIn,
    zoomOut,
    theme: () => setTheme(state.theme === "dark" ? "light" : "dark"),
    undo: () => undo(),
    redo: () => redo(),
    shortcuts: openShortcuts,
  });
  initShortcuts({
    onSave: () => saveNow({ manual: true }),
    onPreview: openPreview,
    onExport: exportProject,
    onPresentation: togglePresentation,
    onPalette: openPalette,
    onShortcuts: openShortcuts,
    onZoomIn: zoomIn,
    onZoomOut: zoomOut,
    onFit: fitToView,
    onResetZoom: () => setZoomPercent(100),
  });
  setupUi();
  init(doc, { projectId });
  booted = true;
  loadAssets();
  updateHistoryButtons();
  requestAnimationFrame(() => {
    fitToView();
    maybeShowTour();
  });
}

function setupUi() {
  // Вкладки левой панели
  for (const tab of document.querySelectorAll("[data-tab]")) {
    tab.addEventListener("click", () => {
      for (const other of document.querySelectorAll("[data-tab]")) {
        other.classList.toggle("is-active", other === tab);
        other.setAttribute("aria-selected", other === tab ? "true" : "false");
      }
      for (const panel of document.querySelectorAll("[data-panel]")) {
        panel.classList.toggle("is-active", panel.dataset.panel === tab.dataset.tab);
      }
    });
  }

  // Библиотека элементов
  for (const button of document.querySelectorAll("[data-add]")) {
    const type = button.dataset.add;
    if (type && type !== "frame") {
      button.draggable = true;
      button.addEventListener("dragstart", (event) => {
        if (!event.dataTransfer) return;
        event.dataTransfer.effectAllowed = "copy";
        event.dataTransfer.setData("application/x-sb-element", type);
        event.dataTransfer.setData("text/plain", type);
        button.classList.add("is-dragging");
      });
      button.addEventListener("dragend", () => button.classList.remove("is-dragging"));
    }
    button.addEventListener("click", () => {
      if (type === "frame") {
        setTool(state.tool === "frame" ? "select" : "frame");
        if (state.tool === "frame") {
          toast("Протяните фрейм на холсте или кликните для стандартного размера", { type: "info", duration: 2600 });
        }
        return;
      }
      if (type === "image") {
        requestImage("new");
        return;
      }
      addElementCentered(type);
    });
  }

  // Готовые блоки и общие компоненты
  for (const button of document.querySelectorAll("[data-block]")) {
    button.addEventListener("click", () => {
      const frame = insertBlock(button.dataset.block);
      if (frame) requestAnimationFrame(() => fitToView());
    });
  }

  // Активное состояние инструмента «Фрейм» в библиотеке
  const frameToolButton = document.querySelector('[data-add="frame"]');
  const renderToolState = () => frameToolButton?.classList.toggle("is-active", state.tool === "frame");
  on("tool", renderToolState);
  renderToolState();

  // История
  document.getElementById("undoBtn")?.addEventListener("click", () => undo());
  document.getElementById("redoBtn")?.addEventListener("click", () => redo());
  on("history", updateHistoryButtons);

  // Зум
  document.getElementById("zoomInBtn")?.addEventListener("click", zoomIn);
  document.getElementById("zoomOutBtn")?.addEventListener("click", zoomOut);
  document.getElementById("fitBtn")?.addEventListener("click", fitToView);
  document.getElementById("zoomLabel")?.addEventListener("click", () => setZoomPercent(100));
  on("view", updateCanvasMeta);

  // Тема
  document.getElementById("themeBtn")?.addEventListener("click", () => setTheme(state.theme === "dark" ? "light" : "dark"));
  on("theme", () => {
    // canvas already listens; nothing else here
  });
  window.addEventListener("sb-theme-change", (event) => {
    if ((event.detail === "dark" || event.detail === "light") && event.detail !== state.theme) {
      setTheme(event.detail);
    }
  });

  // Сохранение
  on("doc", ({ source, transient }) => {
    if (!booted) return;
    updateCanvasMeta();
    // Навигация по страницам не меняет содержимое проекта и не должна
    // запускать автосохранение.
    if (source === "page" || source === "init") return;
    docRevision += 1;
    if (transient) return;
    scheduleSave();
  });
  setSaveState("saved");
  on("save", renderSaveState);
  renderSaveState();
  saveIndicator?.addEventListener("click", () => {
    if (state.saveState === "error") saveNow({ manual: true });
  });

  // Название проекта
  projectTitleInput?.addEventListener("change", commitTitle);
  projectTitleInput?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") projectTitleInput.blur();
    event.stopPropagation();
  });

  // Кнопки верхней панели
  document.getElementById("previewBtn")?.addEventListener("click", () => openPreview("desktop"));
  document.getElementById("exportBtn")?.addEventListener("click", exportProject);
  document.getElementById("shortcutsBtn")?.addEventListener("click", openShortcuts);
  document.getElementById("presentationBtn")?.addEventListener("click", togglePresentation);
  document.getElementById("tourBtn")?.addEventListener("click", () => startTour(true));

  for (const button of document.querySelectorAll("[data-open-shortcuts]")) {
    button.addEventListener("click", openShortcuts);
  }

  // Модальные окна
  for (const close of document.querySelectorAll("[data-close-modal]")) {
    close.addEventListener("click", () => {
      const modal = document.getElementById(close.dataset.closeModal);
      if (modal) modal.hidden = true;
    });
  }
  for (const modal of document.querySelectorAll(".modal")) {
    modal.addEventListener("pointerdown", (event) => {
      if (event.target === modal) modal.hidden = true;
    });
  }
  document.getElementById("previewExportBtn")?.addEventListener("click", () => {
    document.getElementById("previewModal").hidden = true;
    exportProject();
  });
  document.getElementById("previewNewTab")?.addEventListener("click", openPublicLink);

  // Устройства в превью
  for (const button of document.querySelectorAll("[data-device]")) {
    button.addEventListener("click", () => {
      for (const other of document.querySelectorAll("[data-device]")) {
        other.classList.toggle("is-active", other === button);
      }
      const frame = document.querySelector(".preview-device");
      if (frame) frame.dataset.deviceFrame = button.dataset.device;
    });
  }

  // Файлы
  document.getElementById("imageInput")?.addEventListener("change", onImageInputChange);
  document.getElementById("assetInput")?.addEventListener("change", onAssetInputChange);

  // Ctrl+V: картинка из буфера обмена
  window.addEventListener("paste", onPaste);

  // Закрытие вкладки
  window.addEventListener("beforeunload", (event) => {
    if (state.dirty || state.saveState === "saving") {
      event.preventDefault();
      event.returnValue = "";
    }
  });

  // Кнопка выхода из презентации
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && state.presentation) togglePresentation();
  });

  setupSidebarResizer();
  setupAdaptive();
}

/** Перетаскиваемая граница левой панели: ширина запоминается в браузере. */
function setupSidebarResizer() {
  const shell = document.getElementById("editorShell");
  const handle = document.getElementById("leftResizer");
  if (!shell || !handle) return;

  const currentWidth = () => parseFloat(getComputedStyle(shell).getPropertyValue("--left-w")) || LEFT_DEFAULT;
  const apply = (width, { persist = true } = {}) => {
    const w = Math.round(Math.min(LEFT_MAX, Math.max(LEFT_MIN, Number(width) || LEFT_DEFAULT)));
    shell.style.setProperty("--left-w", `${w}px`);
    handle.setAttribute("aria-valuenow", String(w));
    if (persist) {
      try { localStorage.setItem("sb-left-w", String(w)); } catch (error) { /* ignore */ }
    }
    return w;
  };

  let saved = null;
  try { saved = Number(localStorage.getItem("sb-left-w")); } catch (error) { /* ignore */ }
  apply(saved && saved >= LEFT_MIN && saved <= LEFT_MAX ? saved : currentWidth(), { persist: false });

  let dragging = false;
  let startX = 0;
  let startWidth = LEFT_DEFAULT;

  handle.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    dragging = true;
    startX = event.clientX;
    startWidth = currentWidth();
    handle.classList.add("is-dragging");
    document.body.classList.add("is-resizing-panel");
    handle.setPointerCapture?.(event.pointerId);
    event.preventDefault();
  });
  window.addEventListener("pointermove", (event) => {
    if (!dragging) return;
    apply(startWidth + (event.clientX - startX), { persist: false });
  });
  const stop = () => {
    if (!dragging) return;
    dragging = false;
    handle.classList.remove("is-dragging");
    document.body.classList.remove("is-resizing-panel");
    apply(currentWidth());
  };
  window.addEventListener("pointerup", stop);
  window.addEventListener("pointercancel", stop);
  handle.addEventListener("dblclick", () => apply(LEFT_DEFAULT));
  handle.addEventListener("keydown", (event) => {
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      apply(currentWidth() + (event.key === "ArrowLeft" ? -16 : 16));
    }
    if (event.key === "Home") {
      event.preventDefault();
      apply(LEFT_DEFAULT);
    }
  });
}

/** Вкладка «Адаптив»: флажок «Авто» + выбор ручного макета устройства. */
function setupAdaptive() {
  const autoInput = document.getElementById("adaptiveAuto");
  const buttons = [...document.querySelectorAll("[data-responsive-mode]")];
  const hint = document.getElementById("adaptiveHint");
  const resetBtn = document.getElementById("adaptiveResetBtn");
  const syncButtons = () => {
    const auto = responsiveAuto();
    const device = editingDevice();
    if (autoInput) autoInput.checked = auto;
    for (const button of buttons) {
      const mode = button.dataset.responsiveMode;
      const on = !auto && mode === device;
      button.disabled = auto;
      button.classList.toggle("is-active", on);
      button.setAttribute("aria-checked", on ? "true" : "false");
    }
    if (resetBtn) {
      resetBtn.hidden = auto || device === "desktop";
    }
    if (hint) {
      hint.textContent = auto
        ? "Включите «Авто» — и экспорт сам адаптируется. Выключите, чтобы собрать отдельный макет для планшета и смартфона на каждой странице."
        : "Редактируется макет выбранного устройства. Планшет и смартфон сначала копируют десктоп — их можно перестроить под себя. Настройки хранятся отдельно для каждой страницы.";
    }
  };
  autoInput?.addEventListener("change", () => {
    const on = autoInput.checked;
    if (setResponsiveAuto(on)) {
      toast(on ? "Адаптив: авто" : "Адаптив: ручные макеты устройств", { type: "success", duration: 1800 });
      requestAnimationFrame(() => fitToView());
    }
  });
  for (const button of buttons) {
    button.addEventListener("click", () => {
      if (button.disabled) return;
      const device = button.dataset.responsiveMode;
      if (setEditingDevice(device)) {
        const labels = { desktop: "Десктоп", tablet: "Планшет", phone: "Смартфон" };
        toast(`Макет: ${labels[device] || device}`, { type: "success", duration: 1600 });
        requestAnimationFrame(() => fitToView());
      }
    });
  }
  for (const button of document.querySelectorAll("[data-adaptive-preview]")) {
    button.addEventListener("click", () => openPreview(button.dataset.adaptivePreview));
  }
  resetBtn?.addEventListener("click", () => {
    const device = editingDevice();
    if (!window.confirm(`Пересобрать макет «${device === "tablet" ? "Планшет" : "Смартфон"}» из десктопа? Текущие правки этого устройства будут потеряны.`)) {
      return;
    }
    if (regenerateDeviceLayout(device)) {
      toast("Макет пересобран из десктопа", { type: "success", duration: 2000 });
      requestAnimationFrame(() => fitToView());
    }
  });
  on("responsive", () => {
    syncButtons();
    const modal = document.getElementById("previewModal");
    if (modal && !modal.hidden) openPreview();
  });
  on("doc", () => syncButtons());
  syncButtons();
}

function updateHistoryButtons() {
  const undoBtn = document.getElementById("undoBtn");
  const redoBtn = document.getElementById("redoBtn");
  // Импортируем функции проверки лениво нельзя — используем индексы состояния.
  if (undoBtn) undoBtn.disabled = state.historyIndex <= 0;
  if (redoBtn) redoBtn.disabled = state.historyIndex >= state.history.length - 1;
}

function updateCanvasMeta() {
  if (!state.doc) return;
  const frames = state.doc.frames || [];
  const width = Math.max(...frames.map((f) => Number(f.w) || 0), Number(state.doc.settings?.width) || 1200);
  const height = frames.reduce((max, f) => Math.max(max, Number(f.y) + Number(f.h)), 0);
  const device = editingDevice();
  const deviceLabel = { desktop: "Десктоп", tablet: "Планшет", phone: "Смартфон" }[device] || "Десктоп";
  const suffix = responsiveAuto() ? "" : ` · ${deviceLabel}`;
  if (canvasBadge) canvasBadge.textContent = `${Math.round(width)} × ${Math.round(height || 0)}${suffix}`;
  if (canvasSections) {
    const count = frames.filter((frame) => frame.role !== "header" && frame.role !== "footer").length;
    canvasSections.textContent = `${count} ${count === 1 ? "фрейм" : count < 5 ? "фрейма" : "фреймов"}`;
  }
}

function commitTitle() {
  if (!projectTitleInput || !state.doc) return;
  const title = projectTitleInput.value.trim() || "Новый сайт";
  projectTitleInput.value = title;
  if (state.doc.meta?.title === title && window.BUILDER.projectTitle === title) return;
  commit(() => {
    state.doc.meta = state.doc.meta || {};
    state.doc.meta.title = title;
  }, { label: "title" });
  window.BUILDER.projectTitle = title;
  document.title = `${title} — редактор`;
}

// ---------------------------------------------------------------- Assets
async function loadAssets() {
  try {
    const payload = await loadProject(projectId);
    assetList = payload.assets || [];
    setAssets(assetList);
  } catch (error) {
    console.warn("assets", error);
  }
}

function frameAtDocPoint(x, y) {
  const frames = state.doc?.frames || [];
  for (let i = frames.length - 1; i >= 0; i -= 1) {
    const frame = frames[i];
    if (frame.hidden) continue;
    const fx = Number(frame.x) || 0;
    const fy = Number(frame.y) || 0;
    if (x >= fx && x <= fx + Number(frame.w) && y >= fy && y <= fy + Number(frame.h)) return frame;
  }
  return null;
}

function createFrameFromToolbar() {
  const content = (state.doc.frames || []).filter((item) => item.role !== "header" && item.role !== "footer");
  const frame = addFrame({ name: `Фрейм ${content.length + 1}` });
  toast(`Фрейм «${frame.name}» создан`, { type: "success", duration: 1600 });
  return frame;
}

function addAssetToCanvas(assetId) {
  const asset = assetList.find((item) => String(item.id) === String(assetId));
  if (!asset) return;
  const frame = getFrame(state.activeFrameId) || state.doc.frames[0];
  if (!frame) {
    toast("Сначала создайте фрейм", { type: "error" });
    return;
  }
  const el = addElement("image", { frameId: frame.id, x: 80, y: 80 });
  if (!el) return;
  commit(() => {
    const found = getFrame(frame.id)?.elements.find((item) => item.id === el.id);
    if (found) {
      found.props.src = asset.url;
      found.props.alt = asset.name;
      found.name = asset.name.replace(/\.[a-z0-9]+$/i, "").slice(0, 60) || "Изображение";
    }
  }, { label: "asset-image" });
  setTab("files");
  toast("Изображение добавлено на холст", { type: "success" });
}

function setTab(name) {
  const tab = document.querySelector(`[data-tab="${name}"]`);
  tab?.click();
}

function requestImage(mode, point = null) {
  imageMode = { mode, point };
  document.getElementById("imageInput").value = "";
  document.getElementById("imageInput").click();
}

async function onImageInputChange(event) {
  const file = event.target.files?.[0];
  if (!file || !imageMode) return;
  const mode = imageMode;
  imageMode = null;
  try {
    const asset = await uploadFile(file);
    if (!asset) return;
    if (mode.mode === "replace") {
      const entry = [...state.selection][0];
      if (entry) {
        commit(() => {
          const found = findElement(entry)?.el;
          if (found) {
            found.props.src = asset.url;
            found.props.alt = asset.name;
          }
        }, { label: "replace-image" });
        toast("Изображение заменено", { type: "success" });
      }
    } else {
      addImageFromAsset(asset, mode.point);
    }
  } catch (error) {
    toast(error.message || "Не удалось загрузить изображение", { type: "error" });
  }
}

async function onAssetInputChange(event) {
  const files = [...(event.target.files || [])];
  event.target.value = "";
  for (const file of files) {
    try {
      await uploadFile(file);
    } catch (error) {
      toast(error.message || "Не удалось загрузить файл", { type: "error" });
    }
  }
  if (files.length) toast(files.length === 1 ? "Файл загружен" : `Загружено файлов: ${files.length}`, { type: "success" });
}

async function uploadFile(file) {
  if (!file.type.startsWith("image/")) {
    toast("Можно загружать только изображения", { type: "error" });
    return null;
  }
  if (file.size > 2 * 1024 * 1024) {
    toast("Файл больше 2 МБ", { type: "error" });
    return null;
  }
  const asset = await uploadAsset(projectId, file);
  assetList = [asset, ...assetList];
  setAssets(assetList);
  return asset;
}

function addImageFromAsset(asset, point = null) {
  let frame = getFrame(state.activeFrameId) || state.doc.frames[0];
  let x = 80;
  let y = 80;
  if (point) {
    const found = frameAtDocPoint(point.x, point.y);
    if (found) {
      frame = found;
      x = Math.max(0, point.x - (Number(found.x) || 0) - 190);
      y = Math.max(0, point.y - (Number(found.y) || 0) - 130);
    }
  }
  if (!frame) {
    toast("Сначала создайте фрейм", { type: "error" });
    return;
  }
  const el = addElement("image", { frameId: frame.id, x, y });
  if (!el) return;
  commit(() => {
    const found = frame.elements.find((item) => item.id === el.id);
    if (found) {
      found.props.src = asset.url;
      found.props.alt = asset.name;
    }
  }, { label: "new-image" });
  if (!point) setTab("files");
}

async function handleDroppedFiles(files, point) {
  for (const file of files) {
    if (!file.type.startsWith("image/")) continue;
    try {
      const asset = await uploadFile(file);
      if (asset) addImageFromAsset(asset, point);
    } catch (error) {
      toast(error.message || "Не удалось загрузить файл", { type: "error" });
    }
  }
}

async function onPaste(event) {
  if (event.target.closest?.('input, textarea, select, [contenteditable="true"]')) return;
  const items = [...(event.clipboardData?.items || [])];
  const imageItem = items.find((item) => item.type.startsWith("image/"));
  if (!imageItem) return;
  event.preventDefault();
  const file = imageItem.getAsFile();
  if (!file) return;
  try {
    const asset = await uploadFile(file);
    if (asset) {
      addImageFromAsset(asset);
      toast("Картинка вставлена из буфера", { type: "success" });
    }
  } catch (error) {
    toast(error.message || "Не удалось вставить изображение", { type: "error" });
  }
}

// --------------------------------------------------------------- Saving
function scheduleSave() {
  if (!booted) return;
  setSaveState("pending");
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => saveNow(), 1000);
}

function renderSaveState() {
  if (!saveIndicator) return;
  saveIndicator.dataset.state = state.saveState;
  const labels = {
    saved: "Сохранено",
    pending: "Есть изменения",
    saving: "Сохраняем…",
    error: "Ошибка · повторить",
  };
  if (saveText) saveText.textContent = labels[state.saveState] || "Сохранено";
  saveIndicator.title =
    state.saveState === "error"
      ? state.saveError || "Не удалось сохранить. Нажмите, чтобы повторить."
      : state.lastSavedAt
        ? `Последнее сохранение: ${state.lastSavedAt.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}`
        : "";
}

async function saveNow({ manual = false, force = false } = {}) {
  if (!state.doc || saveInFlight) {
    if (saveInFlight) saveQueued = true;
    return false;
  }
  clearTimeout(saveTimer);
  if (!force && !manual && !state.dirty && state.saveState === "saved") return true;
  saveInFlight = true;
  saveQueued = false;
  const revisionAtSave = docRevision;
  setSaveState("saving");
  const snapshot = serializeDoc(state.doc);
  const title = projectTitleInput?.value.trim() || "Новый сайт";
  try {
    const { html } = await renderStandalone(snapshot);
    const bytes = new Blob([html]).size;
    if (bytes > 5 * 1024 * 1024) {
      toast("Экспорт больше 5 МБ — файл будет тяжёлым для скачивания", { type: "info", duration: 4200 });
    }
    const result = await saveProject(projectId, {
      data: snapshot,
      html,
      title,
      baseUpdatedAt,
    });
    if (result?.updated_at) baseUpdatedAt = result.updated_at;
    if (result?.slug) window.BUILDER.projectSlug = result.slug;
    if (docRevision === revisionAtSave) {
      setSaveState("saved");
    } else {
      // Во время запроса пользователь продолжил редактировать: снимок уже
      // устарел, поэтому не имеем права объявлять документ сохранённым.
      setSaveState("pending");
      saveQueued = true;
    }
    if (manual) toast("Проект сохранён", { type: "success", duration: 1600 });
    return true;
  } catch (error) {
    setSaveState("error", error.message || "Нет связи с сервером");
    if (manual) toast(error.message || "Не удалось сохранить проект", { type: "error" });
    return false;
  } finally {
    saveInFlight = false;
    const waiters = saveWaiters;
    saveWaiters = [];
    for (const resolve of waiters) resolve();
    if (saveQueued || docRevision !== revisionAtSave) scheduleSave();
  }
}

function waitForCurrentSave() {
  if (!saveInFlight) return Promise.resolve();
  return new Promise((resolve) => saveWaiters.push(resolve));
}


// --------------------------------------------------------------- Export
async function exportProject() {
  const button = document.getElementById("exportBtn");
  button?.classList.add("is-disabled");
  let saved = false;
  try {
    if (saveInFlight) await waitForCurrentSave();
    saved = await saveNow({ force: true });
    const snapshot = serializeDoc(state.doc);
    const { blob, pageFiles } = await createProjectZip(snapshot);
    const slug = String(window.BUILDER.projectSlug || "site")
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, "-")
      .replace(/^-+|-+$/g, "") || "site";
    downloadBlob(blob, `${slug}.zip`);
    const pagesLabel = pageFiles.length > 1 ? `, страниц: ${pageFiles.length}` : "";
    toast(
      saved
        ? `ZIP скачан: index.html${pagesLabel} + assets`
        : `Сервер недоступен — ZIP собран локально: index.html${pagesLabel} + assets`,
      { type: saved ? "success" : "info", duration: 3600 },
    );
  } catch (error) {
    toast(error.message || "Не удалось подготовить экспорт", { type: "error", duration: 3600 });
  } finally {
    button?.classList.remove("is-disabled");
  }
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

// -------------------------------------------------------------- Preview
const PREVIEW_DEVICES = ["desktop", "tablet", "phone"];

async function openPreview(device = null) {
  const modal = document.getElementById("previewModal");
  const frame = document.getElementById("previewFrame");
  const meta = document.getElementById("previewMeta");
  if (!modal || !frame) return;
  // В openPreview можно передать событие (обработчик клика) — устройством
  // считаем только строку из списка, иначе data-device-frame ломался бы.
  if (typeof device === "string" && PREVIEW_DEVICES.includes(device)) {
    const stage = document.querySelector(".preview-device");
    if (stage) stage.dataset.deviceFrame = device;
    for (const button of document.querySelectorAll("[data-device]")) {
      button.classList.toggle("is-active", button.dataset.device === device);
    }
  }
  modal.hidden = false;
  // Двойная запись srcdoc подряд ломает раскладку в Chromium (body остаётся 0×0),
  // поэтому пишем документ в iframe ровно один раз — после сборки.
  if (meta) meta.textContent = "Собираем превью…";
  try {
    // Снимок синхронизирует рантайм в сохранённые макеты устройств, поэтому
    // превью совпадает с тем, что уйдёт в экспорт (в т.ч. в ручном режиме).
    const { html } = await renderStandalone(serializeDoc(state.doc));
    frame.srcdoc = html;
    const bytes = new Blob([html]).size;
    if (meta) {
      meta.textContent = bytes > 5 * 1024 * 1024
        ? `как экспорт · ${(bytes / 1024 / 1024).toFixed(1)} МБ (больше 5 МБ)`
        : `как экспорт · ${Math.max(1, Math.round(bytes / 1024))} КБ`;
    }
  } catch (error) {
    frame.srcdoc = `<!doctype html><title>Ошибка</title><body style="font:14px sans-serif;padding:24px">Не удалось собрать превью.</body>`;
    if (meta) meta.textContent = "не удалось собрать превью";
  }
}

async function openPublicLink() {
  const win = window.open("about:blank", "_blank");
  if (saveInFlight) await waitForCurrentSave();
  const saved = await saveNow({ force: true });
  if (!saved) {
    if (win) win.close();
    toast(state.saveState === "saving" ? "Сохранение ещё идёт — попробуйте через секунду" : "Сначала нужно сохранить проект", { type: "error" });
    return;
  }
  if (win) win.location.href = window.BUILDER.publicUrl;
  else window.open(window.BUILDER.publicUrl, "_blank");
}

// ------------------------------------------------------------- Modals etc
function openShortcuts() {
  const modal = document.getElementById("shortcutsModal");
  if (modal) modal.hidden = false;
}

function togglePresentation() {
  state.presentation = !state.presentation;
  document.body.classList.toggle("is-presentation", state.presentation);
  closePalette();
  if (state.presentation) {
    presentationView = { zoom: state.zoom, pan: { ...state.pan } };
    const exit = document.createElement("button");
    exit.type = "button";
    exit.className = "presentation-exit";
    exit.id = "presentationExit";
    exit.innerHTML = "Выйти из презентации · Esc";
    exit.addEventListener("click", togglePresentation);
    document.body.appendChild(exit);
    setTimeout(fitToView, 60);
  } else {
    document.getElementById("presentationExit")?.remove();
    if (presentationView) {
      state.zoom = presentationView.zoom;
      state.pan = presentationView.pan;
      emit("view");
    }
  }
}

// --------------------------------------------------------------- Tour
const TOUR_STEPS = [
  {
    selector: ".left-panel",
    title: "Библиотека и слои",
    text: "Слева — элементы, слои, файлы и фреймы. Кликните по элементу, чтобы добавить его. Кнопка «Фрейм» или клавиша F создаёт свободный артборд.",
    place: "right",
  },
  {
    selector: "#canvasViewport",
    title: "Свободный холст",
    text: "Как в Figma: перетаскивайте элементы и сами фреймы, тяните за грани и углы для ресайза. Направляющие притянут объект к краям и центрам.",
    place: "center",
  },
  {
    selector: "#propertiesPanel",
    title: "Свойства",
    text: "Справа настраивается всё: позиция, размер, цвет, обводка, тень, типографика и ссылка. Изменения применяются сразу.",
    place: "left",
  },
  {
    selector: "#exportBtn",
    title: "Экспорт сайта в ZIP",
    text: "Один клик — и вы получаете index.html, остальные страницы и папку assets со стилями, скриптами и картинками. Превью покажет результат заранее.",
    place: "bottom",
  },
];

function startTour(force = false) {
  if (!force) {
    try {
      if (localStorage.getItem("sb-tour-seen") === "1") return;
    } catch (error) {
      /* ignore */
    }
  }
  tourIndex = 0;
  tour = document.getElementById("tour");
  if (!tour) return;
  tourSpot = document.getElementById("tourSpot");
  tourCard = document.getElementById("tourCard");
  tourEls = {
    title: document.getElementById("tourTitle"),
    text: document.getElementById("tourText"),
    step: document.getElementById("tourStep"),
    dots: document.getElementById("tourDots"),
    next: document.getElementById("tourNext"),
  };
  tour.hidden = false;
  document.getElementById("tourSkip").onclick = () => finishTour();
  tourEls.next.onclick = () => {
    tourIndex += 1;
    if (tourIndex >= TOUR_STEPS.length) finishTour();
    else renderTourStep();
  };
  window.addEventListener("resize", renderTourStep);
  // Тур не должен «застревать»: закрываем по Escape и по клику мимо карточки.
  tour.onclick = () => finishTour();
  tourCard.onclick = (event) => event.stopPropagation();
  if (!tour.__lfEscBound) {
    tour.__lfEscBound = true;
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && tour && !tour.hidden) finishTour();
    });
  }
  renderTourStep();
}

function maybeShowTour() {
  // Автопоказ тура отключён: он перекрывал холст и мешал работать сразу
  // после создания проекта. Тур остался доступен по кнопке «?» / «Тур».
  return;
}

function finishTour() {
  const node = document.getElementById("tour");
  if (node) node.hidden = true;
  window.removeEventListener("resize", renderTourStep);
  try {
    localStorage.setItem("sb-tour-seen", "1");
  } catch (error) {
    /* ignore */
  }
}

function renderTourStep() {
  const step = TOUR_STEPS[tourIndex];
  if (!step || !tourSpot || !tourCard) return;
  const target = document.querySelector(step.selector);
  if (!target) return;
  const rect = target.getBoundingClientRect();
  const pad = 6;
  tourSpot.style.left = `${Math.max(0, rect.left - pad)}px`;
  tourSpot.style.top = `${Math.max(0, rect.top - pad)}px`;
  tourSpot.style.width = `${Math.min(window.innerWidth, rect.width + pad * 2)}px`;
  tourSpot.style.height = `${Math.min(window.innerHeight, rect.height + pad * 2)}px`;
  tourEls.title.textContent = step.title;
  tourEls.text.textContent = step.text;
  tourEls.step.textContent = `${String(tourIndex + 1).padStart(2, "0")} / ${String(TOUR_STEPS.length).padStart(2, "0")}`;
  tourEls.next.textContent = tourIndex === TOUR_STEPS.length - 1 ? "Готово" : "Далее";
  tourEls.dots.innerHTML = TOUR_STEPS.map((_, i) => `<span class="tour-dot${i === tourIndex ? " is-active" : ""}"></span>`).join("");

  const cardW = 320;
  const cardH = tourCard.offsetHeight || 180;
  let left = rect.right + 18;
  let top = rect.top + Math.min(rect.height / 2 - cardH / 2, 60);
  if (step.place === "left") left = rect.left - cardW - 18;
  if (step.place === "bottom") {
    left = Math.min(window.innerWidth - cardW - 16, Math.max(16, rect.right - cardW));
    top = rect.bottom + 14;
  }
  if (step.place === "center") {
    left = Math.min(window.innerWidth - cardW - 16, rect.left + rect.width / 2 - cardW / 2);
    top = rect.top + 80;
  }
  left = Math.max(16, Math.min(window.innerWidth - cardW - 16, left));
  top = Math.max(16, Math.min(window.innerHeight - cardH - 16, top));
  tourCard.style.left = `${left}px`;
  tourCard.style.top = `${top}px`;
}
