/** Левая панель: слои, фреймы и файлы проекта. */

import {
  addFrame,
  clearSelection,
  commit,
  deleteFrame,
  deleteFrames,
  duplicateFrame,
  emit,
  elementsInGroup,
  expandGroups,
  findElement,
  getFrame,
  groupName,
  on,
  renameGroup,
  setActiveFrame,
  setFrameSelection,
  setSelection,
  state,
  toggleFrameSelection,
  ungroupSelection,
} from "./state.js";
import { icon, toast } from "./toast.js";

let uploadHandler = null;
let addAssetHandler = null;
let assets = [];

const TYPE_ICON = {
  text: "type",
  heading: "heading",
  button: "button",
  link: "link",
  image: "image",
  shape: "square",
  line: "line",
  embed: "embed",
};

const ROLE_LABEL = {
  header: "общая шапка",
  footer: "общий подвал",
};

export function initLayers({ onUpload, onAddAsset } = {}) {
  uploadHandler = onUpload;
  addAssetHandler = onAddAsset;

  on("selection", renderLayers);
  on("doc", ({ transient }) => {
    if (!transient) {
      renderLayers();
      renderFramesPanel();
    }
  });
  on("active", () => {
    renderLayers();
    renderFramesPanel();
  });

  const layersList = document.getElementById("layersList");
  layersList?.addEventListener("click", onLayerClick);
  layersList?.addEventListener("dblclick", onLayerDoubleClick);
  layersList?.addEventListener("dragstart", onLayerDragStart);
  layersList?.addEventListener("dragover", onLayerDragOver);
  layersList?.addEventListener("dragleave", onLayerDragLeave);
  layersList?.addEventListener("drop", onLayerDrop);

  const framesList = document.getElementById("framesList");
  framesList?.addEventListener("click", onFrameClick);

  const assetsList = document.getElementById("assetsList");
  assetsList?.addEventListener("click", (event) => {
    const add = event.target.closest("[data-add-asset]");
    if (add && addAssetHandler) addAssetHandler(add.dataset.addAsset);
  });

  document.getElementById("uploadAssetBtn")?.addEventListener("click", () => uploadHandler?.());
  document.getElementById("addFrameBtn")?.addEventListener("click", () => {
    const content = (state.doc.frames || []).filter((frame) => frame.role !== "header" && frame.role !== "footer");
    const frame = addFrame({ name: `Фрейм ${content.length + 1}` });
    toast(`Фрейм «${frame.name}» добавлен`, { type: "success" });
  });

  renderLayers();
  renderFramesPanel();
}

export function setAssets(nextAssets) {
  assets = nextAssets || [];
  renderAssets();
}

export function renderAssets() {
  const list = document.getElementById("assetsList");
  const count = document.getElementById("assetsCount");
  if (count) count.textContent = assets.length ? `${assets.length}` : "";
  if (!list) return;
  if (!assets.length) {
    list.innerHTML = `
      <div class="empty">
        <div class="empty-icon">${icon("image")}</div>
        <strong>Пока нет файлов</strong>
        <p>Загрузите изображение до 2 МБ — оно появится здесь и на холсте.</p>
      </div>`;
    return;
  }
  list.innerHTML = assets
    .map(
      (asset) => `
      <div class="asset-item">
        <button class="asset-thumb" type="button" data-add-asset="${asset.id}" title="Добавить на холст">
          <img src="${asset.url}" alt="${escapeAttr(asset.name)}" loading="lazy">
        </button>
        <div class="asset-meta">
          <span class="asset-name" title="${escapeAttr(asset.name)}">${escapeHtml(asset.name)}</span>
          <span class="muted">${formatSize(asset.size)}</span>
        </div>
        <button class="btn btn-icon" type="button" data-add-asset="${asset.id}" title="Добавить на холст" aria-label="Добавить ${escapeAttr(asset.name)} на холст">
          ${icon("plus")}
        </button>
      </div>`,
    )
    .join("");
}

function formatSize(bytes) {
  if (!bytes) return "0 КБ";
  return bytes > 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} МБ` : `${Math.ceil(bytes / 1024)} КБ`;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[char]);
}

function escapeAttr(value) {
  return escapeHtml(value);
}

export function renderLayers() {
  const list = document.getElementById("layersList");
  if (!list) return;
  const frames = state.doc?.frames || [];
  const total = frames.reduce((sum, frame) => sum + (frame.elements?.length || 0), 0);
  const count = document.getElementById("layersCount");
  if (count) count.textContent = total ? String(total) : "";

  if (!total) {
    list.innerHTML = `
      <div class="empty">
        <div class="empty-icon">${icon("layers")}</div>
        <strong>Слоёв пока нет</strong>
        <p>Добавьте элемент из библиотеки — он появится в этом списке.</p>
      </div>`;
    return;
  }

  const collapsed = state.collapsedGroups || (state.collapsedGroups = new Set());

  list.innerHTML = frames
    .map((frame) => {
      const elements = [...(frame.elements || [])].sort((a, b) => Number(b.z) - Number(a.z));

      // Собираем группы внутри фрейма, сохраняя порядок первого появления.
      const groupsOrder = [];
      const grouped = new Map();
      for (const el of elements) {
        if (!el.groupId) continue;
        if (!grouped.has(el.groupId)) {
          grouped.set(el.groupId, []);
          groupsOrder.push(el.groupId);
        }
        grouped.get(el.groupId).push(el);
      }

      const renderedGroupIds = new Set();
      const parts = [];
      for (const el of elements) {
        if (!el.groupId) {
          parts.push(layerRow(el));
          continue;
        }
        if (renderedGroupIds.has(el.groupId)) continue;
        renderedGroupIds.add(el.groupId);
        const members = grouped.get(el.groupId) || [el];
        const isCollapsed = collapsed.has(el.groupId);
        const groupSelected = members.every((m) => state.selection.has(m.id));
        const rows = isCollapsed ? "" : members.map((m) => layerRow(m, true)).join("");
        parts.push(`
          <div class="layer-group-block${groupSelected ? " is-selected" : ""}" data-layer-group="${el.groupId}">
            <div class="layer-group-head${isCollapsed ? " is-collapsed" : ""}" data-group-toggle="${el.groupId}" role="button" tabindex="0" aria-label="${escapeAttr(groupName(el.groupId))}">
              <span class="layer-group-caret">${icon("chevron-right", "icon icon-sm")}</span>
              <span class="layer-icon">${icon("folder", "icon icon-sm")}</span>
              <span class="layer-name" title="Двойной клик — переименовать группу">${escapeHtml(groupName(el.groupId))}</span>
              <span class="layer-section-count">${members.length}</span>
              <button class="layer-action" type="button" data-ungroup="${el.groupId}" title="Разгруппировать" aria-label="Разгруппировать ${escapeAttr(groupName(el.groupId))}">
                ${icon("unlink", "icon icon-sm")}
              </button>
            </div>
            <div class="layer-rows layer-group-rows">${rows}</div>
          </div>`);
      }

      return `
        <div class="layer-group" data-layer-frame="${frame.id}">
          <div class="layer-section-head${frame.id === state.activeFrameId ? " is-active" : ""}" data-frame-target="${frame.id}">
            <span>${escapeHtml(frame.name)}${frame.role ? ` <em class="frame-role-badge">${ROLE_LABEL[frame.role] || ""}</em>` : ""}</span>
            <span class="layer-section-count">${elements.length}</span>
          </div>
          <div class="layer-rows">${parts.join("")}</div>
        </div>`;
    })
    .join("");
}

function layerRow(el, grouped = false) {
  const selected = state.selection.has(el.id);
  const typeIcon = el.type === "shape" && el.props?.shape === "ellipse" ? "circle" : TYPE_ICON[el.type] || "square";
  return `
    <div class="layer-row${selected ? " is-selected" : ""}${el.hidden ? " is-hidden" : ""}${grouped ? " is-grouped" : ""}"
         draggable="true" data-layer-id="${el.id}" role="button" tabindex="0"
         aria-label="${escapeAttr(el.name)}">
      <span class="layer-grip" aria-hidden="true">${icon("more", "icon icon-sm")}</span>
      <span class="layer-icon">${icon(typeIcon, "icon icon-sm")}</span>
      <span class="layer-name" title="Двойной клик — переименовать">${escapeHtml(el.name || "Элемент")}</span>
      <button class="layer-action${el.hidden ? " is-on" : ""}" type="button" data-hide="${el.id}"
              aria-label="${el.hidden ? "Показать" : "Скрыть"} ${escapeAttr(el.name)}" title="${el.hidden ? "Показать" : "Скрыть"}">
        ${icon(el.hidden ? "eye-off" : "eye", "icon icon-sm")}
      </button>
      <button class="layer-action${el.locked ? " is-on" : ""}" type="button" data-lock="${el.id}"
              aria-label="${el.locked ? "Разблокировать" : "Заблокировать"} ${escapeAttr(el.name)}" title="${el.locked ? "Разблокировать" : "Заблокировать"}">
        ${icon(el.locked ? "lock" : "unlock", "icon icon-sm")}
      </button>
    </div>`;
}

function onLayerClick(event) {
  const hide = event.target.closest("[data-hide]");
  if (hide) {
    event.stopPropagation();
    const id = hide.dataset.hide;
    commit(() => {
      const found = findElement(id);
      if (found) found.el.hidden = !found.el.hidden;
    }, { label: "visibility" });
    return;
  }
  const lock = event.target.closest("[data-lock]");
  if (lock) {
    event.stopPropagation();
    const id = lock.dataset.lock;
    commit(() => {
      const found = findElement(id);
      if (found) found.el.locked = !found.el.locked;
    }, { label: "lock" });
    return;
  }
  const ungroup = event.target.closest("[data-ungroup]");
  if (ungroup) {
    event.stopPropagation();
    const groupId = ungroup.dataset.ungroup;
    const members = elementsInGroup(groupId);
    ungroupSelection(groupId);
    toast("Группа разобрана", { type: "info", duration: 1600 });
    if (members.length) setSelection(members.map((item) => item.el.id), { expand: false });
    return;
  }
  const groupToggle = event.target.closest("[data-group-toggle]");
  if (groupToggle) {
    event.stopPropagation();
    const groupId = groupToggle.dataset.groupToggle;
    const collapsed = state.collapsedGroups || (state.collapsedGroups = new Set());
    if (collapsed.has(groupId)) collapsed.delete(groupId);
    else collapsed.add(groupId);
    renderLayers();
    return;
  }
  const head = event.target.closest("[data-frame-target]");
  if (head) {
    setActiveFrame(head.dataset.frameTarget);
    clearSelection();
    return;
  }
  const row = event.target.closest("[data-layer-id]");
  if (!row) return;
  if (event.shiftKey || event.metaKey || event.ctrlKey) {
    if (state.selection.has(row.dataset.layerId)) state.selection.delete(row.dataset.layerId);
    else state.selection.add(row.dataset.layerId);
    if (state.selection.size) state.frameSelection.clear();
    emit("selection");
    return;
  }
  setSelection([row.dataset.layerId]);
}

function onLayerDoubleClick(event) {
  const groupHead = event.target.closest("[data-group-toggle]");
  if (groupHead && event.target.closest(".layer-group-head")) {
    const groupId = groupHead.dataset.groupToggle;
    const nameNode = groupHead.querySelector(".layer-name");
    if (nameNode) beginRename(groupId, nameNode, groupName(groupId), (value) => renameGroup(groupId, value), renderLayers);
    return;
  }
  const name = event.target.closest(".layer-name");
  const row = event.target.closest("[data-layer-id]");
  if (!name || !row) return;
  const found = findElement(row.dataset.layerId);
  if (!found) return;
  beginRename(row.dataset.layerId, name, found.el.name || "", (value) => {
    commit(() => {
      const current = findElement(row.dataset.layerId);
      if (current) current.el.name = value.slice(0, 80);
    }, { label: "rename" });
  }, renderLayers);
}

/** Общий инлайн-редактор имени (слой или группа). */
function beginRename(_id, nameNode, currentValue, save, restore) {
  const input = document.createElement("input");
  input.className = "layer-rename";
  input.value = currentValue;
  nameNode.replaceWith(input);
  input.focus();
  input.select();
  let cancelled = false;
  const finish = (isSave) => {
    if (cancelled) return;
    const value = input.value.trim();
    if (isSave && value) save(value);
    else restore();
  };
  input.addEventListener("blur", () => finish(true), { once: true });
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") input.blur();
    if (event.key === "Escape") {
      cancelled = true;
      restore();
      input.blur();
    }
    event.stopPropagation();
  });
}

let dragElementId = null;

function onLayerDragStart(event) {
  const row = event.target.closest("[data-layer-id]");
  if (!row) return;
  dragElementId = row.dataset.layerId;
  event.dataTransfer.effectAllowed = "move";
  event.dataTransfer.setData("text/x-builder-element", dragElementId);
  row.classList.add("is-dragging");
}

function onLayerDragOver(event) {
  if (!dragElementId) return;
  const row = event.target.closest("[data-layer-id]");
  const head = event.target.closest("[data-frame-target]");
  if (!row && !head) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = "move";
  document.querySelectorAll(".layer-row.is-drop-before, .layer-row.is-drop-after, .layer-section-head.is-drop")
    .forEach((node) => node.classList.remove("is-drop-before", "is-drop-after", "is-drop"));
  if (row) {
    const rect = row.getBoundingClientRect();
    row.classList.add(event.clientY < rect.top + rect.height / 2 ? "is-drop-before" : "is-drop-after");
  } else if (head) {
    head.classList.add("is-drop");
  }
}

function onLayerDragLeave(event) {
  const row = event.target.closest("[data-layer-id]");
  if (row) row.classList.remove("is-drop-before", "is-drop-after");
}

function onLayerDrop(event) {
  const row = event.target.closest("[data-layer-id]");
  const head = event.target.closest("[data-frame-target]");
  if (!dragElementId || (!row && !head)) return;
  event.preventDefault();
  const draggedId = dragElementId;
  dragElementId = null;
  const dragged = findElement(draggedId);
  if (!dragged) return;
  if (head) {
    const targetFrame = getFrame(head.dataset.frameTarget);
    if (!targetFrame || targetFrame.id === dragged.frame.id) return;
    commit(() => {
      dragged.frame.elements = dragged.frame.elements.filter((el) => el.id !== draggedId);
      dragged.el.z = Math.max(0, ...targetFrame.elements.map((el) => Number(el.z) || 0)) + 1;
      targetFrame.elements.push(dragged.el);
    }, { label: "reorder" });
    setActiveFrame(targetFrame.id);
    return;
  }
  const target = findElement(row.dataset.layerId);
  if (!target || target.el.id === draggedId) return;
  const rect = row.getBoundingClientRect();
  const before = event.clientY < rect.top + rect.height / 2;
  commit(() => {
    const sourceFrame = dragged.frame;
    const targetFrame = target.frame;
    sourceFrame.elements = sourceFrame.elements.filter((el) => el.id !== draggedId);
    const sorted = [...targetFrame.elements].sort((a, b) => Number(b.z) - Number(a.z));
    let index = sorted.findIndex((el) => el.id === target.el.id);
    if (!before) index += 1;
    sorted.splice(index, 0, dragged.el);
    const base = sorted.length;
    sorted.forEach((el, i) => {
      el.z = base - i;
    });
    targetFrame.elements.push(dragged.el);
  }, { label: "reorder" });
  setSelection([draggedId]);
}

function onFrameClick(event) {
  const row = event.target.closest("[data-frame-card]");
  if (!row) return;
  const frameId = row.dataset.frameCard;
  if (event.target.closest("[data-duplicate-frame]")) {
    duplicateFrame(frameId);
    toast("Фрейм продублирован", { type: "success" });
    return;
  }
  if (event.target.closest("[data-delete-frame]")) {
    const selected = [...state.frameSelection];
    if (selected.length > 1 && selected.includes(frameId)) {
      deleteFrames(selected);
      toast(`Удалено фреймов: ${selected.length}`, { type: "info" });
    } else {
      deleteFrame(frameId);
      toast("Фрейм удалён", { type: "info" });
    }
    return;
  }
  if (event.shiftKey || event.metaKey || event.ctrlKey) {
    event.preventDefault();
    toggleFrameSelection(frameId, { additive: true });
    return;
  }
  // Клик по уже выбранному фрейму в мультивыделении сохраняет группу.
  if (state.frameSelection.has(frameId) && state.frameSelection.size > 1) {
    setActiveFrame(frameId);
    return;
  }
  setActiveFrame(frameId);
  setFrameSelection([frameId]);
}

export function renderFramesPanel() {
  const list = document.getElementById("framesList");
  if (!list) return;
  list.innerHTML = (state.doc?.frames || [])
    .map((frame, index) => {
      const selected = state.frameSelection.has(frame.id);
      const active = frame.id === state.activeFrameId;
      return `
      <div class="frame-card${active ? " is-active" : ""}${selected ? " is-selected" : ""}" data-frame-card="${frame.id}">
        <span class="frame-index">${String(index + 1).padStart(2, "0")}</span>
        <div class="frame-card-text">
          <strong>${escapeHtml(frame.name)}${frame.role ? ` <em class="frame-role-badge">${ROLE_LABEL[frame.role] || ""}</em>` : ""}</strong>
          <span class="muted">${Math.round(Number(frame.w) || 0)} × ${Math.round(Number(frame.h) || 0)} · ${(frame.elements || []).length} эл.</span>
        </div>
        <button class="btn btn-icon" type="button" data-duplicate-frame title="Дублировать фрейм" aria-label="Дублировать фрейм">
          ${icon("copy")}
        </button>
        <button class="btn btn-icon danger-hover" type="button" data-delete-frame title="Удалить фрейм" aria-label="Удалить фрейм">
          ${icon("trash")}
        </button>
      </div>`;
    })
    .join("");
}
