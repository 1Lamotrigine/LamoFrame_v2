/** Единое состояние документа + история + события. */

const MAX_HISTORY = 50;

const listeners = new Map();

export const state = {
  projectId: null,
  doc: null,
  selection: new Set(),
  frameSelection: new Set(),
  activeFrameId: null,
  tool: "select",
  zoom: 1,
  pan: { x: 0, y: 0 },
  theme: "light",
  dirty: false,
  saveState: "saved", // saved | pending | saving | error
  lastSavedAt: null,
  saveError: "",
  guides: [],
  editingId: null,
  history: [],
  historyIndex: -1,
  clipboard: null,
  presentation: false,
  // Устройство, макет которого сейчас редактируется (только в ручном режиме).
  device: "desktop",
};

/**
 * Привести документ к актуальной схеме (version 3: страницы + общие шапка/подвал).
 *
 * Runtime-инвариант: `doc.frames` — это «видимый» список фреймов активной
 * страницы, в который дополнительно включены общие компоненты (шапка и подвал).
 * Все обработчики редактора продолжают работать с одним массивом, а страницы
 * и компоненты синхронизируются в `syncRuntime()` перед сохранением/экспортом.
 *
 * Старые документы:
 * - version 1 — вертикальные секции → фреймы;
 * - version 2 — просто фреймы → одна страница «Главная».
 */
export function migrateDoc(doc) {
  if (!doc || typeof doc !== "object") return doc;

  if (!Array.isArray(doc.pages) || !doc.pages.length) {
    const frames = Array.isArray(doc.frames) ? doc.frames : sectionsToFrames(doc);
    frames.forEach(normalizeFrame);
    const existing = doc.components || {};
    const header = existing.header || frames.find((frame) => frame.role === "header") || null;
    const footer = existing.footer || frames.find((frame) => frame.role === "footer") || null;
    if (header) normalizeFrame(header);
    if (footer) normalizeFrame(footer);
    doc.pages = [
      {
        id: uid("p"),
        name: "Главная",
        slug: "index",
        frames: frames.filter((frame) => !isComponentFrame(frame)),
      },
    ];
    doc.activePageId = doc.pages[0].id;
    doc.components = { header, footer };
  } else {
    normalizePageList(doc);
    normalizeComponents(doc);
  }

  doc.version = 3;
  delete doc.sections;
  normalizeSettings(doc);
  normalizeGroups(doc);
  normalizeStack(doc);
  doc.frames = composeFrames(doc);
  return doc;
}

export const DEVICES = ["desktop", "tablet", "phone"];

/** Ширина макета для каждого устройства (десктоп берёт ширину документа). */
export const DEVICE_WIDTHS = { desktop: 1200, tablet: 768, phone: 390 };

export const DEVICE_LABELS = { desktop: "Десктоп", tablet: "Планшет", phone: "Смартфон" };

/** Ширина макета устройства. */
export function deviceWidth(doc, device) {
  if (device === "desktop") return Math.max(320, Number(doc?.settings?.width) || DEVICE_WIDTHS.desktop);
  return DEVICE_WIDTHS[device] || DEVICE_WIDTHS.desktop;
}

/** Настройки макета: ширина, фон и режим адаптива при экспорте. */
function normalizeSettings(doc) {
  doc.settings = doc.settings && typeof doc.settings === "object" ? doc.settings : {};
  doc.settings.width = Math.max(320, Number(doc.settings.width) || DEVICE_WIDTHS.desktop);
  doc.settings.bg = doc.settings.bg || "#ffffff";
  doc.settings.font = doc.settings.font || "system";
  const responsive = doc.settings.responsive && typeof doc.settings.responsive === "object" ? doc.settings.responsive : {};
  // Новая модель: флажок «Авто» + устройство, макет которого правит пользователь.
  // Старые документы хранили `mode` (auto/desktop/tablet/phone) — переносим.
  const auto = typeof responsive.auto === "boolean"
    ? responsive.auto
    : !responsive.mode || responsive.mode === "auto";
  let device = DEVICES.includes(responsive.device) ? responsive.device : null;
  if (!device) device = DEVICES.includes(responsive.mode) && responsive.mode !== "auto" ? responsive.mode : "desktop";
  doc.settings.responsive = { auto, device: auto ? "desktop" : device };
}

function sectionsToFrames(doc) {
  const width = Math.max(320, Number(doc.settings?.width) || 1200);
  const sections = Array.isArray(doc.sections) ? doc.sections : [];
  let y = 0;
  return sections.map((section, index) => {
    const h = Math.max(40, Number(section.height) || 560);
    const frame = {
      id: section.id || `f_${index}`,
      name: section.name || `Фрейм ${index + 1}`,
      x: 0,
      y,
      w: width,
      h,
      bg: section.bg || "#ffffff",
      elements: Array.isArray(section.elements) ? section.elements : [],
    };
    y += h;
    return frame;
  });
}

function normalizePageList(doc) {
  const usedSlugs = new Set();
  doc.pages.forEach((page, index) => {
    if (!page.id) page.id = uid("p");
    page.name = page.name || `Страница ${index + 1}`;
    page.slug = uniquePageSlug(page.slug || page.name || `page-${index + 1}`, usedSlugs);
    page.frames = Array.isArray(page.frames) ? page.frames : [];
    page.frames.forEach(normalizeFrame);
    normalizePageDevices(page);
  });
  if (!doc.pages.some((page) => page.id === doc.activePageId)) {
    doc.activePageId = doc.pages[0].id;
  }
}

/** Привести ручные макеты страницы (планшет/смартфон) к актуальной схеме. */
function normalizePageDevices(page) {
  if (!page.devices || typeof page.devices !== "object") {
    delete page.devices;
    return;
  }
  for (const device of ["tablet", "phone"]) {
    const entry = page.devices[device];
    if (!entry || !Array.isArray(entry.frames) || !entry.frames.length) {
      delete page.devices[device];
      continue;
    }
    entry.frames.forEach(normalizeFrame);
  }
  if (!page.devices.tablet && !page.devices.phone) delete page.devices;
}

/** Шапка/подвал: базовые (десктоп) + варианты для планшета и смартфона. */
function normalizeComponents(doc) {
  doc.components = doc.components && typeof doc.components === "object" ? doc.components : {};
  for (const role of ["header", "footer"]) {
    const frame = doc.components[role];
    if (frame) normalizeFrame(frame);
    else delete doc.components[role];
  }
  const devices = doc.components.devices;
  if (devices && typeof devices === "object") {
    let kept = false;
    for (const device of ["tablet", "phone"]) {
      const entry = devices[device];
      if (!entry || typeof entry !== "object") {
        delete devices[device];
        continue;
      }
      for (const role of ["header", "footer"]) {
        const frame = entry[role];
        if (frame && typeof frame === "object") {
          normalizeFrame(frame);
          frame.role = role;
          kept = true;
        } else {
          delete entry[role];
        }
      }
      if (!entry.header && !entry.footer) delete devices[device];
    }
    if (!kept) delete doc.components.devices;
  } else {
    delete doc.components.devices;
  }
}

/** Достроить недостающие поля фрейма (обратная совместимость). */
function normalizeFrame(frame) {
  if (!frame || typeof frame !== "object") return;
  frame.x = Number(frame.x) || 0;
  frame.y = Number(frame.y) || 0;
  frame.w = Math.max(1, Number(frame.w) || 1200);
  frame.h = Math.max(1, Number(frame.h) || 400);
  frame.bg = frame.bg || "#ffffff";
  frame.name = frame.name || "Фрейм";
  frame.radius = Math.max(0, Number(frame.radius) || 0);
  frame.locked = Boolean(frame.locked);
  frame.hidden = Boolean(frame.hidden);
  if (frame.role !== "header" && frame.role !== "footer") delete frame.role;
  if (!Array.isArray(frame.elements)) frame.elements = [];
  return frame;
}

/**
 * Привести список групп в порядок: убрать битые ссылки, оставить группы,
 * в которых реально состоит 2+ элемента (одиночки теряют смысл).
 */
function normalizeGroups(doc) {
  const registry = doc.groups && typeof doc.groups === "object" && !Array.isArray(doc.groups)
    ? doc.groups
    : {};
  const used = new Map();
  // Группы живут внутри элементов на страницах и в компонентах, а не в
  // рантайм-кадре doc.frames (тот собирается позже).
  const collect = (frame) => {
    for (const el of frame?.elements || []) {
      const groupId = el.groupId ? String(el.groupId) : "";
      if (!groupId) {
        delete el.groupId;
        continue;
      }
      el.groupId = groupId;
      used.set(groupId, (used.get(groupId) || 0) + 1);
    }
  };
  for (const page of doc.pages || []) {
    for (const frame of page.frames || []) collect(frame);
    for (const device of Object.values(page.devices || {})) {
      for (const frame of device?.frames || []) collect(frame);
    }
  }
  collect(doc.components?.header);
  collect(doc.components?.footer);
  for (const device of Object.values(doc.components?.devices || {})) {
    collect(device?.header);
    collect(device?.footer);
  }

  const next = {};
  for (const [groupId, count] of used) {
    if (count < 2) continue;
    const meta = registry[groupId] || {};
    next[groupId] = { id: groupId, name: meta.name || "Группа" };
  }

  // Снимаем группировку с элементов, чьи группы больше не валидны.
  const strip = (frame) => {
    for (const el of frame?.elements || []) {
      if (el.groupId && !next[el.groupId]) delete el.groupId;
    }
  };
  for (const page of doc.pages || []) {
    for (const frame of page.frames || []) strip(frame);
    for (const device of Object.values(page.devices || {})) {
      for (const frame of device?.frames || []) strip(frame);
    }
  }
  strip(doc.components?.header);
  strip(doc.components?.footer);
  for (const device of Object.values(doc.components?.devices || {})) {
    strip(device?.header);
    strip(device?.footer);
  }
  doc.groups = next;
}

export function groupName(groupId, doc = state.doc) {
  return doc?.groups?.[groupId]?.name || "Группа";
}

/** Все элементы выбранной группы (в текущем рантайме). */
export function elementsInGroup(groupId, doc = state.doc) {
  const result = [];
  if (!groupId) return result;
  for (const frame of doc?.frames || []) {
    for (const el of frame.elements || []) {
      if (el.groupId === groupId) result.push({ el, frame });
    }
  }
  return result;
}

/** Дополнить набор id элементами, входящими в те же группы. */
export function expandGroups(ids, doc = state.doc) {
  const out = new Set(ids.filter(Boolean));
  for (const id of [...out]) {
    const found = (doc?.frames || [])
      .flatMap((frame) => frame.elements || [])
      .find((el) => el.id === id);
    if (!found?.groupId) continue;
    for (const item of elementsInGroup(found.groupId, doc)) out.add(item.el.id);
  }
  return [...out];
}

/** Сгруппировать выбранные элементы. Возвращает id группы или null. */
export function groupSelection(entries = selectedElements()) {
  if (!state.doc || entries.length < 2) return null;
  const groupId = uid("g");
  commit(() => {
    state.doc.groups = state.doc.groups || {};
    state.doc.groups[groupId] = { id: groupId, name: `Группа ${Object.keys(state.doc.groups).length + 1}` };
    for (const { el } of entries) el.groupId = groupId;
  }, { label: "group" });
  return groupId;
}

/** Разгруппировать: снять groupId у переданных элементов (или у выделения). */
export function ungroupSelection(groupIds = null) {
  if (!state.doc) return false;
  const ids = groupIds
    ? (Array.isArray(groupIds) ? groupIds : [groupIds])
    : [...new Set(selectedElements().map((entry) => entry.el.groupId).filter(Boolean))];
  if (!ids.length) return false;
  commit(() => {
    for (const frame of state.doc.frames || []) {
      for (const el of frame.elements || []) {
        if (el.groupId && ids.includes(el.groupId)) delete el.groupId;
      }
    }
    for (const id of ids) delete state.doc.groups?.[id];
  }, { label: "ungroup" });
  return true;
}

export function renameGroup(groupId, name) {
  if (!state.doc?.groups?.[groupId] || !name) return false;
  commit(() => {
    state.doc.groups[groupId].name = String(name).slice(0, 60);
  }, { label: "rename-group" });
  return true;
}

export function isComponentFrame(frame) {
  return Boolean(frame && (frame.role === "header" || frame.role === "footer"));
}

export function activePage(doc = state.doc) {
  if (!doc) return null;
  return (doc.pages || []).find((page) => page.id === doc.activePageId) || doc.pages?.[0] || null;
}

/** Режим «Авто» включён — экспорт адаптируется сам, ручные макеты выключены. */
export function responsiveAuto(doc = state.doc) {
  return doc?.settings?.responsive?.auto !== false;
}

export function responsiveDevice(doc = state.doc) {
  const device = doc?.settings?.responsive?.device;
  return DEVICES.includes(device) ? device : "desktop";
}

/** Устройство, макет которого сейчас на холсте. В авторежиме всегда десктоп. */
export function editingDevice(doc = state.doc) {
  return responsiveAuto(doc) ? "desktop" : responsiveDevice(doc);
}

/** Макеты общих компонентов (шапка/подвал) для конкретного устройства. */
export function deviceComponents(doc, device) {
  const base = doc?.components || {};
  if (device === "desktop") return base;
  return (base.devices && base.devices[device]) || {};
}

/** Фреймы контента страницы для устройства (десктоп — базовый макет). */
export function pageDeviceFrames(page, device) {
  if (!page) return [];
  if (device === "desktop") return page.frames || [];
  return page.devices?.[device]?.frames || [];
}

/** Записать фреймы контента страницы для устройства. */
function setPageDeviceFrames(page, device, frames) {
  if (!page) return;
  if (device === "desktop") {
    page.frames = frames;
    return;
  }
  page.devices = page.devices || {};
  page.devices[device] = page.devices[device] || {};
  page.devices[device].frames = frames;
}

/** Удалить шапку/подвал активного устройства. */
function deleteComponentFrame(role) {
  const doc = state.doc;
  if (!doc) return;
  const device = editingDevice(doc);
  const store = device === "desktop" ? doc.components : doc.components?.devices?.[device];
  if (store) delete store[role];
  if (device === "desktop" && doc.components) delete doc.components[role];
}

function composeFrames(doc, device = editingDevice(doc)) {
  const page = activePage(doc);
  const components = deviceComponents(doc, device);
  const list = [];
  if (components.header) list.push(components.header);
  list.push(...pageDeviceFrames(page, device));
  if (components.footer) list.push(components.footer);
  return list;
}

/**
 * Синхронизировать runtime-список фреймов с макетом активного устройства.
 * Вызывается перед сохранением, экспортом, сменой страницы/устройства.
 */
export function syncRuntime(doc = state.doc, device = editingDevice(doc)) {
  if (!doc) return;
  doc.components = doc.components && typeof doc.components === "object" ? doc.components : {};
  const frames = Array.isArray(doc.frames) ? doc.frames : [];
  const header = frames.find((frame) => frame.role === "header") || null;
  const footer = frames.find((frame) => frame.role === "footer") || null;
  const content = frames.filter((frame) => !isComponentFrame(frame));
  const page = activePage(doc);
  if (page) setPageDeviceFrames(page, device, content);
  const store = device === "desktop"
    ? doc.components
    : (doc.components.devices || (doc.components.devices = {}))[device] || (doc.components.devices[device] = {});
  if (header) {
    header.role = "header";
    store.header = header;
  } else if (device === "desktop") {
    delete doc.components.header;
  } else {
    delete store.header;
  }
  if (footer) {
    footer.role = "footer";
    store.footer = footer;
  } else if (device === "desktop") {
    delete doc.components.footer;
  } else {
    delete store.footer;
  }
}

/**
 * Документ для сохранения/истории: без runtime-дубля `frames`.
 * Активная страница и компоненты уже синхронизированы.
 */
export function serializeDoc(doc = state.doc) {
  syncRuntime(doc);
  const copy = clone(doc);
  delete copy.frames;
  return copy;
}

const CYRILLIC = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z", и: "i",
  й: "y", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t",
  у: "u", ф: "f", х: "h", ц: "ts", ч: "ch", ш: "sh", щ: "sch", ъ: "", ы: "y", ь: "",
  э: "e", ю: "yu", я: "ya",
};

/** Латиница для slug: кириллица транслитерируется, чтобы имена файлов были читаемыми. */
export function transliterate(value) {
  return String(value ?? "")
    .toLowerCase()
    .split("")
    .map((char) => (CYRILLIC[char] !== undefined ? CYRILLIC[char] : char))
    .join("");
}

export function uniquePageSlug(value, used = new Set()) {
  const base = transliterate(value || "page")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "page";
  let slug = base;
  let n = 2;
  while (used.has(slug)) {
    slug = `${base}-${n}`;
    n += 1;
  }
  used.add(slug);
  return slug;
}

let lastPushLabel = "";
let lastPushTime = 0;

export function on(event, handler) {
  if (!listeners.has(event)) listeners.set(event, new Set());
  listeners.get(event).add(handler);
  return () => listeners.get(event)?.delete(handler);
}

export function emit(event, payload) {
  for (const handler of listeners.get(event) || []) {
    try {
      handler(payload);
    } catch (error) {
      console.error(`[state] ${event}`, error);
    }
  }
}

export function uid(prefix = "e") {
  return `${prefix}_${Math.random().toString(36).slice(2, 8)}${Date.now().toString(36).slice(-3)}`;
}

export function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

export function init(document, { projectId } = {}) {
  state.projectId = projectId ?? null;
  state.doc = migrateDoc(document);
  state.device = editingDevice(state.doc);
  state.selection = new Set();
  const firstFrame = (state.doc?.frames?.find((frame) => !isComponentFrame(frame)) || state.doc?.frames?.[0])?.id ?? null;
  // Первый фрейм сразу выделяем: у него появляются маркеры ресайза,
  // и новичок может сразу тянуть за грани/углы.
  state.frameSelection = new Set(firstFrame ? [firstFrame] : []);
  state.activeFrameId = firstFrame;
  state.tool = "select";
  state.history = [serializeDoc(state.doc)];
  state.historyIndex = 0;
  state.dirty = false;
  state.saveState = "saved";
  lastPushLabel = "";
  lastPushTime = 0;
  emit("doc", { source: "init" });
  emit("selection");
  emit("tool");
}

export function currentSnapshot() {
  return state.history[state.historyIndex];
}

/**
 * Добавить текущее состояние документа в историю.
 * История хранит снимки ПОСЛЕ изменения, поэтому вызывать её нужно
 * после мутации (см. commit) либо в конце перетаскивания/ресайза.
 * Частые изменения с одной меткой (ввод текста, ползунок) склеиваются:
 * последний снимок заменяется актуальным, а не пропускается.
 */
export function pushHistory(label = "") {
  if (!state.doc) return;
  const now = Date.now();
  const snapshot = serializeDoc(state.doc);
  if (label && label === lastPushLabel && now - lastPushTime < 650 && state.historyIndex > 0) {
    state.history[state.historyIndex] = snapshot;
    lastPushTime = now;
    emit("history");
    return;
  }
  lastPushLabel = label;
  lastPushTime = now;
  state.history = state.history.slice(0, state.historyIndex + 1);
  state.history.push(snapshot);
  if (state.history.length > MAX_HISTORY + 1) state.history.shift();
  state.historyIndex = state.history.length - 1;
  emit("history");
}

export function canUndo() {
  return state.historyIndex > 0;
}

export function canRedo() {
  return state.historyIndex < state.history.length - 1;
}

function applyDocSnapshot(snapshot) {
  state.doc = snapshot;
  state.device = editingDevice(state.doc);
  lastPushLabel = "";
  lastPushTime = 0;
  pruneSelection();
  markDirty();
}

export function undo() {
  if (!canUndo()) return false;
  state.historyIndex -= 1;
  applyDocSnapshot(migrateDoc(clone(state.history[state.historyIndex])));
  emit("doc", { source: "undo" });
  emit("responsive");
  emit("selection");
  emit("history");
  return true;
}

export function redo() {
  if (!canRedo()) return false;
  state.historyIndex += 1;
  applyDocSnapshot(migrateDoc(clone(state.history[state.historyIndex])));
  emit("doc", { source: "redo" });
  emit("responsive");
  emit("selection");
  emit("history");
  return true;
}

function pruneSelection() {
  const ids = new Set(allElements().map((entry) => entry.el.id));
  state.selection = new Set([...state.selection].filter((id) => ids.has(id)));
  const frameIds = new Set((state.doc?.frames || []).map((f) => f.id));
  state.frameSelection = new Set([...state.frameSelection].filter((id) => frameIds.has(id)));
  if (state.activeFrameId && !frameIds.has(state.activeFrameId)) {
    state.activeFrameId = state.doc.frames[0]?.id ?? null;
  }
}

export function markDirty() {
  state.dirty = true;
  state.saveState = "pending";
  emit("save");
}

/**
 * Изменить документ.
 * history=true — поставить снимок в историю перед изменением.
 */
export function commit(mutator, { label = "", history = true, silent = false } = {}) {
  if (!state.doc) return;
  mutator(state.doc);
  if (history) pushHistory(label);
  markDirty();
  if (!silent) emit("doc", { source: label });
}

/** Изменение без записи в историю (промежуточные кадры перетаскивания). */
export function update(mutator, { label = "update" } = {}) {
  if (!state.doc) return;
  mutator(state.doc);
  markDirty();
  emit("doc", { source: label, transient: true });
}

export function allElements() {
  const result = [];
  for (const frame of state.doc?.frames || []) {
    for (const el of frame.elements || []) result.push({ el, frame });
  }
  return result;
}

export function findElement(id) {
  for (const frame of state.doc?.frames || []) {
    const index = (frame.elements || []).findIndex((el) => el.id === id);
    if (index !== -1) return { el: frame.elements[index], frame, index };
  }
  return null;
}

export function getFrame(id) {
  return (state.doc?.frames || []).find((frame) => frame.id === id) || null;
}

export function selectedElements() {
  return [...state.selection].map(findElement).filter(Boolean);
}

export function selectedIds() {
  return [...state.selection];
}

export function setSelection(ids, { active = true, expand = true } = {}) {
  const list = Array.isArray(ids) ? ids.filter(Boolean) : [ids].filter(Boolean);
  state.selection = new Set(expand ? expandGroups(list) : list);
  if (state.selection.size) state.frameSelection.clear();
  const first = selectedElements()[0];
  if (first) state.activeFrameId = first.frame.id;
  emit("selection");
  if (active) emit("active");
}

export function addToSelection(ids) {
  const list = Array.isArray(ids) ? ids : [ids];
  for (const id of expandGroups(list)) {
    if (id) state.selection.add(id);
  }
  if (state.selection.size) state.frameSelection.clear();
  const first = selectedElements()[0];
  if (first) state.activeFrameId = first.frame.id;
  emit("selection");
}

export function toggleSelection(id) {
  if (state.selection.has(id)) {
    // Снимаем выделение со всей группы, к которой относится элемент.
    const found = findElement(id);
    const groupIds = found?.el.groupId ? elementsInGroup(found.el.groupId).map((item) => item.el.id) : [id];
    for (const member of groupIds) state.selection.delete(member);
  } else {
    for (const member of expandGroups([id])) state.selection.add(member);
  }
  if (state.selection.size) state.frameSelection.clear();
  const first = selectedElements()[0];
  if (first) state.activeFrameId = first.frame.id;
  emit("selection");
}

export function clearSelection() {
  if (!state.selection.size && !state.frameSelection.size) return;
  state.selection.clear();
  state.frameSelection.clear();
  emit("selection");
}

// ---------------------------------------------------------------- Фреймы как выделение
export function selectedFrames() {
  return [...state.frameSelection].map((id) => getFrame(id)).filter(Boolean);
}

export function setFrameSelection(ids, { additive = false } = {}) {
  const list = Array.isArray(ids) ? ids.filter(Boolean) : [ids].filter(Boolean);
  if (additive) {
    for (const id of list) {
      if (state.frameSelection.has(id)) state.frameSelection.delete(id);
      else state.frameSelection.add(id);
    }
  } else {
    state.frameSelection = new Set(list);
  }
  state.selection.clear();
  const first = selectedFrames()[0];
  if (first) state.activeFrameId = first.id;
  emit("selection");
  emit("active");
}

export function clearFrameSelection() {
  if (!state.frameSelection.size) return;
  state.frameSelection.clear();
  emit("selection");
}

export function toggleFrameSelection(id, { additive = false } = {}) {
  setFrameSelection([id], { additive });
}

export function setActiveFrame(frameId) {
  state.activeFrameId = frameId;
  emit("active");
}

export function setTool(tool) {
  state.tool = tool || "select";
  emit("tool");
}

export function setView({ zoom, pan } = {}) {
  if (zoom !== undefined) state.zoom = Math.min(4, Math.max(0.1, zoom));
  if (pan) state.pan = { x: pan.x, y: pan.y };
  emit("view");
}

export function setGuides(guides) {
  state.guides = guides || [];
  emit("guides");
}

export function setTheme(theme) {
  state.theme = theme;
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem("sb-theme", theme);
  } catch (error) {
    /* ignore */
  }
  emit("theme");
}

export function toggleTheme() {
  setTheme(state.theme === "dark" ? "light" : "dark");
}

// ---------------------------------------------------------------------------
// Фабрики элементов
// ---------------------------------------------------------------------------

export const ELEMENT_TYPES = ["text", "heading", "button", "link", "image", "shape", "line", "embed"];

const BASE_STYLE = {
  text: { fontSize: 18, fontWeight: 400, lineHeight: 1.5, color: "#18181B", fontFamily: "system" },
  heading: { fontSize: 44, fontWeight: 700, lineHeight: 1.15, color: "#18181B", fontFamily: "system" },
  button: {
    fontSize: 16,
    fontWeight: 600,
    color: "#FFFFFF",
    fill: "#4F46E5",
    borderRadius: 10,
    borderWidth: 0,
    borderColor: "transparent",
    textAlign: "center",
    fontFamily: "system",
  },
  link: {
    fontSize: 17,
    fontWeight: 500,
    lineHeight: 1.4,
    color: "#4F46E5",
    fontFamily: "system",
    textDecoration: "underline",
    textAlign: "left",
  },
  image: { borderRadius: 12, objectFit: "cover", opacity: 1 },
  shape: { fill: "#4F46E5", borderRadius: 16, borderWidth: 0, opacity: 1 },
  line: { fill: "#18181B", strokeWidth: 2, borderRadius: 0 },
  embed: { borderRadius: 12 },
};

const BASE_SIZE = {
  text: [280, 88],
  heading: [520, 96],
  button: [190, 52],
  link: [240, 40],
  image: [380, 260],
  shape: [220, 180],
  line: [280, 20],
  embed: [520, 300],
};

const BASE_PROPS = {
  text: { text: "Новый текст", href: "" },
  heading: { text: "Новый заголовок", href: "", level: 2 },
  button: { text: "Кнопка", href: "" },
  link: { text: "Ссылка", href: "https://", target: "_blank" },
  image: { src: "", alt: "" },
  shape: { shape: "rectangle" },
  line: {},
  embed: { src: "" },
};

export function createElement(type, { x = 120, y = 120, frameId = null, width = null, height = null } = {}) {
  const [w, h] = BASE_SIZE[type] || [200, 100];
  const frame = getFrame(frameId || state.activeFrameId) || state.doc?.frames?.[0];
  const count = allElements().filter((entry) => entry.el.type === type).length + 1;
  const names = {
    text: "Текст",
    heading: "Заголовок",
    button: "Кнопка",
    link: "Ссылка",
    image: "Изображение",
    shape: "Фигура",
    line: "Линия",
    embed: "Встраивание",
  };
  const maxZ = Math.max(0, ...(frame?.elements || []).map((el) => Number(el.z) || 0));
  const frameW = Number(frame?.w) || Number(state.doc?.settings?.width) || 1200;
  const finalW = width || w;
  return {
    id: uid("e"),
    type,
    name: `${names[type] || "Элемент"} ${count}`,
    x: Math.round(Math.min(Math.max(0, x), Math.max(0, frameW - finalW))),
    y: Math.round(Math.max(0, y)),
    w: finalW,
    h: height === null ? h : Math.max(1, Math.round(Number(height) || h)),
    z: maxZ + 1,
    rotation: 0,
    locked: false,
    hidden: false,
    props: clone(BASE_PROPS[type] || {}),
    style: clone(BASE_STYLE[type] || {}),
  };
}

export function addElement(type, options = {}) {
  const frameId = options.frameId || state.activeFrameId || state.doc.frames[0]?.id;
  const frame = getFrame(frameId);
  if (!frame) return null;
  let { x = 120, y = 120 } = options;
  if (options.center) {
    const frameW = Number(frame.w) || 1200;
    const el = createElement(type, { ...options, frameId });
    x = Math.round((frameW - el.w) / 2);
    y = options.y ?? 120;
    el.x = x;
    el.y = y;
    commit(() => frame.elements.push(el), { label: `add-${type}` });
    setSelection([el.id]);
    return el;
  }
  const el = createElement(type, { ...options, x, y, frameId });
  commit(() => frame.elements.push(el), { label: `add-${type}` });
  setSelection([el.id]);
  return el;
}

export function addFrame({ name, x = null, y = null, w = null, h = 720, bg = "#FFFFFF", radius = 0, select = true } = {}) {
  const frames = state.doc.frames || (state.doc.frames = []);
  // В ручном режиме новый фрейм должен совпадать по ширине с макетом
  // текущего устройства, иначе на планшете/телефоне он вылезает за холст.
  if (w === null || w === undefined) {
    w = deviceWidth(state.doc, editingDevice(state.doc));
  }
  const content = frames.filter((frame) => !isComponentFrame(frame));
  const index = content.length + 1;
  // Секции стоят друг под другом, поэтому новый фрейм ставим в конец стека.
  const px = x !== null ? x : 0;
  const py = y !== null
    ? y
    : content.reduce((max, f) => Math.max(max, (Number(f.y) || 0) + (Number(f.h) || 0)), 0);
  const frame = {
    id: uid("f"),
    name: name || `Фрейм ${index}`,
    x: Math.round(px),
    y: Math.round(py),
    w: Math.max(40, Math.round(w)),
    h: Math.max(40, Math.round(h)),
    bg,
    radius: Math.max(0, Math.round(radius)),
    locked: false,
    hidden: false,
    elements: [],
  };
  commit(() => {
    frames.push(frame);
    restackFrames();
  }, { label: "add-frame" });
  state.activeFrameId = frame.id;
  if (select) setFrameSelection([frame.id]);
  else { clearSelection(); emit("active"); }
  return frame;
}

// ---------------------------------------------------------------------------
// Страницы и общие компоненты (шапка/подвал)
// ---------------------------------------------------------------------------

export function getPages() {
  return state.doc?.pages || [];
}

/** Пересчитать позиции общих компонентов, чтобы они не наезжали на контент. */
export function pinComponentFrames(doc = state.doc, device = editingDevice(doc)) {
  if (!doc) return;
  const content = (doc.frames || []).filter((frame) => !isComponentFrame(frame));
  const width = deviceWidth(doc, device);
  const components = deviceComponents(doc, device);
  const top = content.length ? Math.min(...content.map((frame) => Number(frame.y) || 0)) : 0;
  const bottom = content.length
    ? Math.max(...content.map((frame) => (Number(frame.y) || 0) + (Number(frame.h) || 0)))
    : 720;
  if (components.header) {
    Object.assign(components.header, { x: 0, y: Math.round(top - (Number(components.header.h) || 88) - 32), w: width });
  }
  if (components.footer) {
    Object.assign(components.footer, { x: 0, y: Math.round(bottom + 32), w: width });
  }
}

/** Вертикальный зазор между секциями на холсте — визуальное разделение. */
export const FRAME_GAP = 24;

/** Вертикальный порядок секций: сверху вниз, при равном y — слева направо. */
function sectionOrder(a, b) {
  const ay = Number(a.y) || 0;
  const by = Number(b.y) || 0;
  if (Math.abs(ay - by) > 1) return ay - by;
  return (Number(a.x) || 0) - (Number(b.x) || 0);
}

/**
 * Выстроить список секций по вертикали без наложений: каждая следующая
 * начинается ровно под предыдущей с зазором FRAME_GAP. Порядок берётся из
 * текущих y/x, поэтому перетаскивание меняет последовательность, а изменение
 * высоты сдвигает всё, что ниже. Мутирует переданные фреймы.
 */
function packFrames(list, { gap = FRAME_GAP } = {}) {
  const content = (list || []).filter((frame) => !isComponentFrame(frame));
  if (!content.length) return;
  const ordered = [...content].sort(sectionOrder);
  let cursor = 0;
  for (const frame of ordered) {
    const nextY = Math.round(cursor);
    frame.y = nextY;
    cursor = nextY + Math.max(1, Number(frame.h) || 0) + gap;
  }
}

/** Секции текущего рантайм-документа, выставленные друг под другом. */
export function stackContentFrames(doc = state.doc, { gap = FRAME_GAP } = {}) {
  if (!doc) return;
  packFrames(doc.frames || [], { gap });
}

/**
 * Привести к «без наложений» все макеты документа: десктоп и ручные макеты
 * устройств на каждой странице. Нужно при загрузке/восстановлении истории,
 * чтобы старые документы с пересекающимися секциями сразу выглядели нормально.
 */
function normalizeStack(doc) {
  for (const page of doc.pages || []) {
    packFrames(page.frames || []);
    for (const device of Object.values(page.devices || {})) {
      packFrames(device?.frames || []);
    }
  }
}

/**
 * Пересобрать раскладку текущего устройства: выстроить секции друг под
 * другом и заново закрепить шапку/подвал. Вызывается внутри commit/update,
 * поэтому сама история и события не трогает.
 */
export function restackFrames(doc = state.doc, { gap = FRAME_GAP, pin = true } = {}) {
  if (!doc) return;
  stackContentFrames(doc, { gap });
  if (pin) pinComponentFrames(doc);
}

export function addComponent(role, { height = null } = {}) {
  if (!state.doc) return null;
  if (role !== "header" && role !== "footer") return null;
  const device = editingDevice(state.doc);
  syncRuntime(state.doc, device);
  const existingFrame = deviceComponents(state.doc, device)[role];
  if (existingFrame) {
    setFrameSelection([existingFrame.id]);
    return existingFrame;
  }
  const doc = state.doc;
  const width = deviceWidth(doc, device);
  const h = Number(height) || (role === "header" ? 88 : 180);
  const content = (doc.frames || []).filter((frame) => !isComponentFrame(frame));
  const top = content.length ? Math.min(...content.map((frame) => Number(frame.y) || 0)) : 0;
  const bottom = content.length
    ? Math.max(...content.map((frame) => (Number(frame.y) || 0) + (Number(frame.h) || 0)))
    : 720;
  const frame = {
    id: uid("f"),
    name: role === "header" ? "Шапка сайта" : "Подвал сайта",
    role,
    x: 0,
    y: Math.round(role === "header" ? top - h - 32 : bottom + 32),
    w: width,
    h,
    bg: role === "header" ? "#FFFFFF" : "#18181B",
    radius: 0,
    locked: false,
    hidden: false,
    elements: [],
  };
  commit(() => {
    const store = device === "desktop"
      ? doc.components
      : (doc.components.devices || (doc.components.devices = {}))[device] || (doc.components.devices[device] = {});
    store[role] = frame;
    doc.frames = composeFrames(doc, device);
  }, { label: `add-${role}` });
  state.activeFrameId = frame.id;
  setFrameSelection([frame.id]);
  return frame;
}

export function removeComponent(role) {
  const device = editingDevice(state.doc);
  const store = device === "desktop" ? state.doc?.components : state.doc?.components?.devices?.[device];
  if (!store?.[role]) return false;
  commit(() => {
    delete store[role];
    state.doc.frames = composeFrames(state.doc, device);
  }, { label: `remove-${role}` });
  emit("selection");
  return true;
}

export function addPage({ name = "", slug = "", copyCurrent = false } = {}) {
  if (!state.doc) return null;
  const device = editingDevice(state.doc);
  syncRuntime(state.doc, device);
  const doc = state.doc;
  const index = (doc.pages?.length || 0) + 1;
  const title = name || `Страница ${index}`;
  const page = {
    id: uid("p"),
    name: title,
    slug: uniquePageSlug(slug || title, new Set((doc.pages || []).map((p) => p.slug))),
    frames: [
      {
        id: uid("f"),
        name: "Фрейм 1",
        x: 0,
        y: 0,
        w: deviceWidth(doc, "desktop"),
        h: 720,
        bg: "#FFFFFF",
        radius: 0,
        locked: false,
        hidden: false,
        elements: [],
      },
    ],
  };
  if (copyCurrent) {
    const source = activePage(doc);
    page.frames = clone(source?.frames || []).map((frame) => ({
      ...frame,
      id: uid("f"),
      name: frame.name,
      elements: (frame.elements || []).map((el) => ({ ...el, id: uid("e") })),
    }));
  }
  commit(() => {
    doc.pages = doc.pages || [];
    doc.pages.push(page);
    if (!responsiveAuto(doc)) {
      ensureDeviceLayouts(doc);
      doc.frames = composeFrames(doc, device);
    }
  }, { label: "add-page" });
  switchPage(page.id, { skipSync: true });
  return page;
}

export function updatePage(pageId, patch) {
  const page = (state.doc?.pages || []).find((item) => item.id === pageId);
  if (!page) return;
  const next = { ...patch };
  if (next.slug !== undefined) {
    const used = new Set((state.doc.pages || []).filter((p) => p.id !== pageId).map((p) => p.slug));
    next.slug = uniquePageSlug(next.slug || page.name, used);
  }
  commit(() => Object.assign(page, next), { label: "page" });
  emit("pages");
}

export function deletePage(pageId) {
  const doc = state.doc;
  if (!doc || (doc.pages || []).length <= 1) return false;
  const device = editingDevice(doc);
  syncRuntime(doc, device);
  const wasActive = doc.activePageId === pageId;
  commit(() => {
    doc.pages = doc.pages.filter((page) => page.id !== pageId);
    if (!doc.pages.some((page) => page.id === doc.activePageId)) {
      doc.activePageId = doc.pages[0].id;
      doc.frames = composeFrames(doc, device);
    }
  }, { label: "delete-page" });
  if (wasActive) {
    state.selection.clear();
    state.frameSelection.clear();
    state.activeFrameId = (doc.frames.find((frame) => !isComponentFrame(frame)) || doc.frames[0])?.id ?? null;
    emit("selection");
    emit("active");
  }
  emit("pages");
  emit("doc", { source: "page-delete" });
  return true;
}

export function switchPage(pageId, { skipSync = false } = {}) {
  const doc = state.doc;
  if (!doc) return false;
  const page = (doc.pages || []).find((item) => item.id === pageId);
  if (!page) return false;
  const device = editingDevice(doc);
  if (!skipSync) syncRuntime(doc, device);
  if (!responsiveAuto(doc)) ensureDeviceLayouts(doc, device);
  doc.activePageId = page.id;
  doc.frames = composeFrames(doc, device);
  // Компоненты общие для всех страниц. Пересчитывать их позицию при каждом
  // переключении нельзя: шапка «переезжала» бы вслед за последней страницей.
  state.selection.clear();
  state.frameSelection.clear();
  state.activeFrameId = (doc.frames.find((frame) => !isComponentFrame(frame)) || doc.frames[0])?.id ?? null;
  lastPushLabel = "";
  lastPushTime = 0;
  emit("doc", { source: "page" });
  emit("selection");
  emit("active");
  emit("pages");
  return true;
}

export function duplicatePage(pageId) {
  const doc = state.doc;
  const device = editingDevice(doc);
  syncRuntime(doc, device);
  const source = (doc.pages || []).find((page) => page.id === pageId);
  if (!source) return null;
  const title = `${source.name} (копия)`;
  const page = {
    id: uid("p"),
    name: title,
    slug: uniquePageSlug(title, new Set((doc.pages || []).map((p) => p.slug))),
    frames: clone(source.frames || []).map((frame) => ({
      ...frame,
      id: uid("f"),
      elements: (frame.elements || []).map((el) => ({ ...el, id: uid("e") })),
    })),
  };
  // Копируем и ручные макеты устройств, чтобы копия совпадала со страницей.
  if (source.devices) {
    page.devices = {};
    for (const [name, entry] of Object.entries(source.devices)) {
      if (!entry?.frames?.length) continue;
      page.devices[name] = {
        frames: clone(entry.frames).map((frame) => ({
          ...frame,
          id: uid("f"),
          elements: (frame.elements || []).map((el) => ({ ...el, id: uid("e") })),
        })),
      };
    }
  }
  commit(() => doc.pages.push(page), { label: "duplicate-page" });
  emit("pages");
  switchPage(page.id, { skipSync: true });
  return page;
}

export function getPageLinks() {
  return (state.doc?.pages || []).map((page) => ({ id: page.id, name: page.name, slug: page.slug }));
}

export function updateFrame(frameId, patch, { history = true } = {}) {
  const frame = getFrame(frameId);
  if (!frame) return;
  const touchesGeometry = ["w", "h", "y"].some((key) => patch[key] !== undefined);
  const mutator = () => {
    if (patch.w !== undefined) patch.w = Math.max(1, Math.round(Number(patch.w) || 1));
    if (patch.h !== undefined) patch.h = Math.max(1, Math.round(Number(patch.h) || 1));
    if (patch.x !== undefined) patch.x = Math.round(Number(patch.x) || 0);
    if (patch.y !== undefined) patch.y = Math.round(Number(patch.y) || 0);
    if (patch.radius !== undefined) patch.radius = Math.max(0, Math.round(Number(patch.radius) || 0));
    Object.assign(frame, patch);
    // Секции не должны наслаиваться: выстраиваем их друг под другом, чтобы
    // изменение высоты/сдвиг одной секции уводил все нижние вниз.
    if (touchesGeometry) restackFrames();
  };
  if (history) commit(mutator, { label: "frame" });
  else update(mutator, { label: "frame" });
}

export function deleteFrame(frameId) {
  const frames = state.doc?.frames || [];
  const frame = getFrame(frameId);
  if (!frame) return false;
  commit(() => {
    state.doc.frames = frames.filter((f) => f.id !== frameId);
    if (frame.role) deleteComponentFrame(frame.role);
    restackFrames();
  }, { label: "delete-frame" });
  state.frameSelection.delete(frameId);
  if (state.activeFrameId === frameId) {
    state.activeFrameId = state.doc.frames[0]?.id ?? null;
    emit("active");
  }
  emit("selection");
  return true;
}

/** Удалить несколько фреймов одним шагом истории. */
export function deleteFrames(ids = [...state.frameSelection]) {
  const list = (Array.isArray(ids) ? ids : [ids]).filter(Boolean);
  if (!list.length) return 0;
  const idsSet = new Set(list);
  const removed = (state.doc?.frames || []).filter((frame) => idsSet.has(frame.id));
  if (!removed.length) return 0;
  commit(() => {
    state.doc.frames = state.doc.frames.filter((frame) => !idsSet.has(frame.id));
    for (const frame of removed) {
      if (frame.role) deleteComponentFrame(frame.role);
    }
    restackFrames();
  }, { label: "delete-frames" });
  for (const id of list) state.frameSelection.delete(id);
  if (idsSet.has(state.activeFrameId)) {
    state.activeFrameId = state.doc.frames[0]?.id ?? null;
  }
  emit("selection");
  emit("active");
  return removed.length;
}

export function duplicateFrame(frameId) {
  const frame = getFrame(frameId);
  if (!frame) return null;
  const copy = clone(frame);
  copy.id = uid("f");
  copy.name = `${frame.name} копия`;
  copy.x = 0;
  copy.y = Number(frame.y) + Number(frame.h);
  copy.elements = (copy.elements || []).map((el) => ({ ...el, id: uid("e") }));
  delete copy.role;
  commit(() => {
    state.doc.frames.push(copy);
    restackFrames();
  }, { label: "duplicate-frame" });
  state.activeFrameId = copy.id;
  setFrameSelection([copy.id]);
  return copy;
}

export function duplicateElements(entries, { offset = 24 } = {}) {
  const byFrame = new Map();
  for (const entry of entries) {
    if (!byFrame.has(entry.frame.id)) byFrame.set(entry.frame.id, []);
    byFrame.get(entry.frame.id).push(entry.el);
  }
  const newIds = [];
  const groupRemap = new Map();
  commit(() => {
    for (const [frameId, elements] of byFrame) {
      const frame = getFrame(frameId);
      if (!frame) continue;
      const maxZ = Math.max(0, ...frame.elements.map((el) => Number(el.z) || 1));
      elements.forEach((original, index) => {
        const copy = clone(original);
        copy.id = uid("e");
        copy.name = `${original.name} копия`;
        copy.x = Math.round(Number(original.x) + offset);
        copy.y = Math.round(Number(original.y) + offset);
        copy.z = maxZ + index + 1;
        // Копия группы образует собственную группу, а не делит её с оригиналом.
        if (copy.groupId) {
          if (!groupRemap.has(copy.groupId)) {
            const newGroupId = uid("g");
            groupRemap.set(copy.groupId, newGroupId);
            state.doc.groups = state.doc.groups || {};
            state.doc.groups[newGroupId] = { id: newGroupId, name: groupName(copy.groupId) };
          }
          copy.groupId = groupRemap.get(copy.groupId);
        }
        frame.elements.push(copy);
        newIds.push(copy.id);
      });
    }
  }, { label: "duplicate" });
  if (newIds.length) setSelection(newIds);
  return newIds;
}

export function deleteElements(entries = selectedElements()) {
  if (!entries.length) return;
  commit(() => {
    for (const entry of entries) {
      const frame = getFrame(entry.frame.id);
      if (!frame) continue;
      frame.elements = frame.elements.filter((el) => el.id !== entry.el.id);
    }
  }, { label: "delete" });
  clearSelection();
}

export function hasSelection() {
  return state.selection.size > 0;
}

export function selectionBounds(entries = selectedElements()) {
  if (!entries.length) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const { el, frame } of entries) {
    // Панель и оверлей должны показывать абсолютные координаты документа,
    // а элементы хранят x/y относительно своего фрейма.
    const fx = Number(frame?.x) || 0;
    const fy = Number(frame?.y) || 0;
    minX = Math.min(minX, fx + Number(el.x));
    minY = Math.min(minY, fy + Number(el.y));
    maxX = Math.max(maxX, fx + Number(el.x) + Number(el.w));
    maxY = Math.max(maxY, fy + Number(el.y) + Number(el.h));
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

export function copySelection() {
  const frames = selectedFrames();
  if (frames.length) {
    state.clipboard = {
      kind: "frames",
      frames: frames.map((frame) => clone(frame)),
    };
    return "frames";
  }
  const entries = selectedElements();
  if (!entries.length) return false;
  state.clipboard = {
    kind: "elements",
    items: entries.map((entry) => ({
      frameId: entry.frame.id,
      el: clone(entry.el),
    })),
  };
  return "elements";
}

export function pasteClipboard() {
  if (!state.clipboard) return false;
  if (state.clipboard.kind === "frames") return pasteFrames(state.clipboard.frames || []);
  return pasteElements(state.clipboard.items || []);
}

function pasteFrames(frames) {
  if (!frames.length || !state.doc) return false;
  const newIds = [];
  const offset = 40;
  commit(() => {
    for (const source of frames) {
      const copy = clone(source);
      copy.id = uid("f");
      copy.name = `${source.name || "Фрейм"} копия`;
      copy.x = Math.round((Number(source.x) || 0) + offset);
      copy.y = Math.round((Number(source.y) || 0) + offset);
      copy.hidden = false;
      delete copy.role;
      copy.elements = (copy.elements || []).map((el) => ({
        ...el,
        id: uid("e"),
      }));
      state.doc.frames.push(copy);
      newIds.push(copy.id);
    }
  }, { label: "paste-frames" });
  if (!newIds.length) return false;
  state.activeFrameId = newIds[0];
  setFrameSelection(newIds);
  return true;
}

function pasteElements(items) {
  if (!items.length) return false;
  const newIds = [];
  const offset = 20;
  const groupRemap = new Map();
  commit(() => {
    for (const item of items) {
      const frame = getFrame(item.frameId) || state.doc.frames[0];
      if (!frame) continue;
      const maxZ = Math.max(0, ...frame.elements.map((el) => Number(el.z) || 1));
      const copy = clone(item.el);
      copy.id = uid("e");
      copy.name = `${item.el.name || "Элемент"} копия`;
      copy.x = Number(copy.x) + offset;
      copy.y = Number(copy.y) + offset;
      copy.z = maxZ + 1;
      if (copy.groupId) {
        if (!groupRemap.has(copy.groupId)) {
          const newGroupId = uid("g");
          groupRemap.set(copy.groupId, newGroupId);
          state.doc.groups = state.doc.groups || {};
          state.doc.groups[newGroupId] = { id: newGroupId, name: groupName(copy.groupId) };
        }
        copy.groupId = groupRemap.get(copy.groupId);
      }
      frame.elements.push(copy);
      newIds.push(copy.id);
    }
  }, { label: "paste" });
  if (newIds.length) setSelection(newIds);
  return newIds.length > 0;
}

export function alignSelection(mode) {
  const entries = selectedElements();
  if (!entries.length) return;
  // Один элемент — выравниваем относительно его фрейма (визуально «по краю
  // секции»). Несколько — относительно общего bounding box выделения.
  const single = entries.length === 1;
  const bounds = single
    ? (() => {
        const frame = entries[0].frame;
        return {
          x: Number(frame?.x) || 0,
          y: Number(frame?.y) || 0,
          w: Number(frame?.w) || 1200,
          h: Number(frame?.h) || 0,
        };
      })()
    : selectionBounds(entries);

  commit(() => {
    for (const { el, frame } of entries) {
      const fx = Number(frame?.x) || 0;
      const fy = Number(frame?.y) || 0;
      const absX = fx + Number(el.x);
      const absY = fy + Number(el.y);
      let nextX = absX;
      let nextY = absY;
      if (mode === "left") nextX = bounds.x;
      if (mode === "center-h") nextX = bounds.x + (bounds.w - el.w) / 2;
      if (mode === "right") nextX = bounds.x + bounds.w - el.w;
      if (mode === "top") nextY = bounds.y;
      if (mode === "center-v") nextY = bounds.y + (bounds.h - el.h) / 2;
      if (mode === "bottom") nextY = bounds.y + bounds.h - el.h;
      el.x = Math.round(Math.max(0, nextX - fx));
      el.y = Math.round(Math.max(0, nextY - fy));
    }
  }, { label: "align" });
}

export function distributeSelection(axis = "h") {
  const entries = selectedElements();
  if (entries.length < 3) return;
  commit(() => {
    const absX = (entry) => (Number(entry.frame?.x) || 0) + Number(entry.el.x);
    const absY = (entry) => (Number(entry.frame?.y) || 0) + Number(entry.el.y);
    const sorted = [...entries].sort((a, b) => (axis === "h" ? absX(a) - absX(b) : absY(a) - absY(b)));
    const first = sorted[0];
    const last = sorted[sorted.length - 1];
    if (axis === "h") {
      const start = absX(first);
      const end = absX(last) + Number(last.el.w);
      const totalWidth = sorted.reduce((sum, entry) => sum + Number(entry.el.w), 0);
      const gap = (end - start - totalWidth) / (sorted.length - 1);
      let cursor = start;
      for (const entry of sorted) {
        const fx = Number(entry.frame?.x) || 0;
        entry.el.x = Math.round(Math.max(0, cursor - fx));
        cursor += Number(entry.el.w) + gap;
      }
    } else {
      const start = absY(first);
      const end = absY(last) + Number(last.el.h);
      const totalHeight = sorted.reduce((sum, entry) => sum + Number(entry.el.h), 0);
      const gap = (end - start - totalHeight) / (sorted.length - 1);
      let cursor = start;
      for (const entry of sorted) {
        const fy = Number(entry.frame?.y) || 0;
        entry.el.y = Math.round(Math.max(0, cursor - fy));
        cursor += Number(entry.el.h) + gap;
      }
    }
  }, { label: "distribute" });
}

export function moveSelectionBy(dx, dy) {
  const entries = selectedElements().filter((entry) => !entry.el.locked);
  if (!entries.length) return;
  commit(() => {
    for (const { el } of entries) {
      el.x = Math.round(Number(el.x) + dx);
      el.y = Math.round(Number(el.y) + dy);
    }
  }, { label: "nudge" });
}

/** Сдвиг всех выделенных фреймов с клавиатуры. */
export function moveFramesBy(dx, dy) {
  const frames = selectedFrames().filter((frame) => !frame.locked);
  if (!frames.length) return;
  commit(() => {
    for (const frame of frames) {
      frame.x = Math.round(Number(frame.x) + dx);
      frame.y = Math.round(Number(frame.y) + dy);
    }
  }, { label: "nudge-frames" });
}

/** Режим адаптива влияет на CSS/JS в превью и экспорте. */
export function setResponsiveAuto(auto) {
  if (!state.doc) return false;
  const next = Boolean(auto);
  if (responsiveAuto(state.doc) === next) return false;
  commit(() => {
    const doc = state.doc;
    syncRuntime(doc, editingDevice(doc));
    // Ручные макеты устройств создаём сразу при выключении «Авто»,
    // чтобы превью и экспорт совпадали с холстом. При включении — сохраняем.
    if (!next) ensureDeviceLayouts(doc);
    doc.settings = doc.settings || {};
    doc.settings.responsive = { auto: next, device: "desktop" };
    doc.frames = composeFrames(doc, "desktop");
    pinComponentFrames(doc, "desktop");
  }, { label: "responsive" });
  state.device = "desktop";
  state.selection.clear();
  state.frameSelection.clear();
  state.activeFrameId = (state.doc.frames.find((frame) => !isComponentFrame(frame)) || state.doc.frames[0])?.id ?? null;
  emit("responsive");
  emit("selection");
  emit("active");
  return true;
}

/** Переключить устройство, макет которого редактируем (в ручном режиме). */
export function setEditingDevice(device) {
  const doc = state.doc;
  if (!doc || responsiveAuto(doc) || !DEVICES.includes(device)) return false;
  if (responsiveDevice(doc) === device) return false;
  commit(() => {
    syncRuntime(doc, editingDevice(doc));
    ensureDeviceLayouts(doc, device);
    doc.settings.responsive = { auto: false, device };
    doc.frames = composeFrames(doc, device);
    pinComponentFrames(doc, device);
  }, { label: "device" });
  state.device = device;
  state.selection.clear();
  state.frameSelection.clear();
  state.activeFrameId = (state.doc.frames.find((frame) => !isComponentFrame(frame)) || state.doc.frames[0])?.id ?? null;
  emit("responsive");
  emit("selection");
  emit("active");
  return true;
}

/** Клиентски создать недостающие ручные макеты устройств (рефлоу десктопа). */
export function ensureDeviceLayouts(doc = state.doc, only = null, { force = false } = {}) {
  if (!doc) return;
  const devices = only ? [only] : ["tablet", "phone"];
  for (const device of devices) {
    if (device === "desktop") continue;
    for (const page of doc.pages || []) {
      if (!force && page.devices?.[device]?.frames?.length) continue;
      const desktop = page.frames || [];
      const ordered = [...desktop].sort(sectionOrder);
      const frames = [];
      let cursor = 0;
      for (const frame of ordered) {
        const reflowed = reflowFrameForDevice(frame, deviceWidth(doc, device), device);
        reflowed.y = Math.round(cursor);
        cursor += reflowed.h + FRAME_GAP;
        frames.push(reflowed);
      }
      if (frames.length) setPageDeviceFrames(page, device, frames);
    }
    const store = doc.components.devices?.[device];
    for (const role of ["header", "footer"]) {
      const base = doc.components?.[role];
      if (!base || (!force && store?.[role])) continue;
      const scaled = cloneFrameForDevice(base, deviceWidth(doc, "desktop"), deviceWidth(doc, device));
      scaled.role = role;
      if (!doc.components.devices) doc.components.devices = {};
      if (!doc.components.devices[device]) doc.components.devices[device] = {};
      doc.components.devices[device][role] = scaled;
    }
  }
  const devicesStore = doc.components && doc.components.devices;
  if (devicesStore && !Object.keys(devicesStore).length) delete doc.components.devices;
}

/**
 * Пересобрать макет текущего устройства из десктопного (кнопка «Сбросить»).
 * Возвращает true, если что-то изменилось.
 */
export function regenerateDeviceLayout(device = editingDevice(state.doc)) {
  const doc = state.doc;
  if (!doc || device === "desktop" || responsiveAuto(doc)) return false;
  commit(() => {
    syncRuntime(doc, device);
    ensureDeviceLayouts(doc, device, { force: true });
    doc.frames = composeFrames(doc, device);
  }, { label: "regenerate-device" });
  state.selection.clear();
  state.frameSelection.clear();
  emit("doc", { source: "regenerate-device" });
  emit("selection");
  return true;
}

const SCALED_STYLE_KEYS = ["fontSize", "borderRadius", "borderWidth", "strokeWidth", "letterSpacing"];

/** Настройки рефлоу для ручных макетов устройств. */
const DEVICE_REFLOW = {
  tablet: { pad: 32, gap: 20, cardPad: 24, cardGap: 10, heading: 40, text: 18, button: 17, radius: 16 },
  phone: { pad: 20, gap: 16, cardPad: 18, cardGap: 8, heading: 30, text: 16, button: 16, radius: 14 },
};

function overlapsMatch(a, b, tol = 1) {
  return (
    nat(a.x) >= nat(b.x) - tol &&
    nat(a.y) >= nat(b.y) - tol &&
    nat(a.x) + nat(a.w) <= nat(b.x) + nat(b.w) + tol &&
    nat(a.y) + nat(a.h) <= nat(b.y) + nat(b.h) + tol
  );
}

/**
 * Разбить элементы фрейма на смысловые блоки (по аналогии с render.elementBlocks):
 * фоновая фигура, содержащая содержимое, становится «карточкой».
 */
function layoutBlocks(frame) {
  const elements = [...(frame.elements || [])];
  const frameArea = Math.max(1, nat(frame.w) * nat(frame.h));
  const containers = elements
    .filter((el) => {
      if (el.type !== "shape") return false;
      if (nat(el.w) * nat(el.h) > frameArea * 0.55) return false;
      return elements.some((other) => other !== el && other.type !== "shape" && overlapsMatch(other, el));
    })
    .sort((a, b) => nat(a.w) * nat(a.h) - nat(b.w) * nat(b.h));

  const consumed = new Set();
  const blocks = [];
  for (const shape of containers) {
    const children = elements.filter(
      (el) => el !== shape && el.type !== "shape" && !consumed.has(el) && overlapsMatch(el, shape),
    );
    if (!children.length) continue;
    consumed.add(shape);
    children.forEach((el) => consumed.add(el));
    const els = [shape, ...children].sort(readingOrder);
    blocks.push({ kind: "card", els });
  }
  for (const el of elements) {
    if (consumed.has(el)) continue;
    blocks.push({ kind: el.type === "shape" ? "decor" : "single", els: [el] });
  }
  blocks.sort((a, b) => readingOrder(a.els[0], b.els[0]));
  return blocks;
}

function readingOrder(a, b) {
  const ay = nat(a.y);
  const by = nat(b.y);
  if (Math.abs(ay - by) > 24) return ay - by;
  return nat(a.x) - nat(b.x);
}

/**
 * Пересобрать фрейм страницы в макет устройства: вертикальный поток блоков
 * с подходящими размерами вместо пропорционального сжатия десктопа.
 * Результат — обычные абсолютно позиционированные элементы, которые можно
 * дальше править вручную.
 */
function reflowFrameForDevice(frame, toWidth, device) {
  const cfg = DEVICE_REFLOW[device] || DEVICE_REFLOW.phone;
  const innerWidth = Math.max(120, toWidth - cfg.pad * 2);
  const out = {
    id: uid("f"),
    name: frame.name,
    x: 0,
    y: 0,
    w: toWidth,
    h: cfg.pad,
    bg: frame.bg || "#FFFFFF",
    radius: 0,
    locked: Boolean(frame.locked),
    hidden: Boolean(frame.hidden),
    elements: [],
  };

  const blocks = layoutBlocks(frame);
  for (const block of blocks) {
    const isCard = block.kind === "card";
    const padX = isCard ? cfg.cardPad : 0;
    const blockTop = out.h;
    const contentWidth = innerWidth - padX * 2;
    let cursor = isCard ? cfg.cardPad : 0;

    const placed = [];
    for (const el of block.els) {
      if (isCard && el.type === "shape") {
        // Фигура-контейнер: фон карточки. Размеры проставим после раскладки.
        const bg = clone(el);
        bg.id = uid("e");
        bg.x = cfg.pad;
        bg.y = blockTop;
        bg.w = innerWidth;
        bg.h = 1;
        placed.push({ el: bg, card: true });
        continue;
      }
      const item = placeReflowElement(el, contentWidth, cursor, cfg, nat(frame.w));
      cursor += item.h + cfg.cardGap;
      placed.push({ el: item, card: false });
    }

    const contentHeight = Math.max(1, cursor - cfg.cardGap);
    const blockHeight = isCard ? contentHeight + cfg.cardPad * 2 : contentHeight;

    for (const item of placed) {
      const el = item.el;
      if (item.card) {
        el.h = blockHeight;
      } else {
        // el.y уже посчитан как смещение внутри карточки/блока.
        el.y = blockTop + el.y;
        el.x = cfg.pad + padX + (el.align === "center" ? Math.max(0, (contentWidth - el.w) / 2) : 0);
        delete el.align;
      }
      delete el.localY;
      out.elements.push(el);
    }

    out.h = blockTop + blockHeight + cfg.gap;
  }

  out.h = Math.max(120, out.h - cfg.gap + cfg.pad);
  return out;
}

/** Разместить один элемент в потоке устройства и вернуть копию с новым размером. */
function placeReflowElement(el, width, localY, cfg, frameWidth) {
  const copy = clone(el);
  copy.id = uid("e");
  copy.style = copy.style && typeof copy.style === "object" ? { ...copy.style } : {};
  copy.props = copy.props && typeof copy.props === "object" ? { ...copy.props } : {};
  copy.x = 0;
  copy.y = localY;
  copy.localY = localY;
  copy.w = width;

  const centered = frameWidth > 0 && Math.abs(nat(el.x) + nat(el.w) / 2 - frameWidth / 2) <= frameWidth * 0.04;
  copy.align = centered ? "center" : "flex-start";

  switch (el.type) {
    case "heading":
      copy.w = width;
      copy.h = Math.round(cfg.heading * 1.3);
      copy.style.fontSize = cfg.heading;
      copy.style.lineHeight = 1.15;
      break;
    case "text":
      copy.w = width;
      copy.h = Math.round(countLines(el, width) * cfg.text * 1.6);
      copy.style.fontSize = cfg.text;
      copy.style.lineHeight = 1.55;
      break;
    case "button": {
      copy.h = 54;
      copy.w = Math.min(width, Math.max(160, Math.round(nat(el.w))));
      copy.style.fontSize = cfg.button;
      break;
    }
    case "link":
      copy.w = width;
      copy.h = Math.max(32, Math.round(cfg.text * 1.8));
      copy.style.fontSize = cfg.text;
      break;
    case "image": {
      copy.w = width;
      const ratio = nat(el.w) > 0 ? nat(el.h) / nat(el.w) : 0.66;
      copy.h = Math.max(120, Math.round(width * ratio));
      break;
    }
    case "embed":
      copy.w = width;
      copy.h = Math.round(width * 0.5625);
      break;
    case "line":
      copy.w = width;
      copy.h = 2;
      break;
    case "shape": {
      // Отдельная декоративная фигура: сохраняем пропорции, не растягиваем.
      const ratio = nat(el.w) > 0 && nat(el.h) > 0 ? nat(el.h) / nat(el.w) : 1;
      const maxW = Math.round(width * 0.55);
      copy.w = Math.min(maxW, Math.max(48, Math.round(nat(el.w))));
      copy.h = Math.max(48, Math.round(copy.w * ratio));
      copy.align = "center";
      break;
    }
    default:
      copy.w = width;
      break;
  }
  return copy;
}

/** Приблизительная оценка числа строк текста при заданной ширине. */
function countLines(el, width) {
  const text = String(el.props?.text ?? "");
  const size = nat(el.style?.fontSize) || 16;
  const perLine = Math.max(8, Math.floor(width / (size * 0.52)));
  let lines = 0;
  for (const paragraph of text.split("\n")) {
    lines += Math.max(1, Math.ceil(paragraph.length / perLine));
  }
  return Math.max(1, lines);
}

/** Клон макета страницы под устройство: пропорциональное масштабирование. */
function cloneForDevice(frames, fromWidth, toWidth) {
  const ratio = fromWidth > 0 ? toWidth / fromWidth : 1;
  return (frames || []).map((frame) => cloneFrameForDevice(frame, fromWidth, toWidth, ratio));
}

function cloneFrameForDevice(frame, fromWidth, toWidth, ratio = fromWidth > 0 ? toWidth / fromWidth : 1) {
  const copy = clone(frame);
  copy.id = uid("f");
  copy.x = Math.round(nat(copy.x) * ratio);
  copy.y = Math.round(nat(copy.y) * ratio);
  copy.w = Math.max(1, Math.round(nat(copy.w) * ratio));
  copy.h = Math.max(1, Math.round(nat(copy.h) * ratio));
  copy.radius = Math.max(0, Math.round(nat(copy.radius) * ratio));
  delete copy.role;
  copy.hidden = Boolean(copy.hidden);
  copy.locked = Boolean(copy.locked);
  copy.elements = (copy.elements || []).map((el) => {
    const scaled = { ...el, id: uid("e") };
    scaled.x = Math.round(nat(scaled.x) * ratio);
    scaled.y = Math.round(nat(scaled.y) * ratio);
    scaled.w = Math.max(1, Math.round(nat(scaled.w) * ratio));
    scaled.h = Math.max(1, Math.round(nat(scaled.h) * ratio));
    if (scaled.style && typeof scaled.style === "object") {
      scaled.style = { ...scaled.style };
      for (const key of SCALED_STYLE_KEYS) {
        if (scaled.style[key] !== undefined && scaled.style[key] !== null) {
          scaled.style[key] = Math.round(Number(scaled.style[key]) * ratio * 100) / 100;
        }
      }
    }
    return scaled;
  });
  return copy;
}

function nat(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/** Устаревший API: оставлен для совместимости с прежними вызовами. */
export function setResponsiveMode(mode) {
  if (mode === "auto") return setResponsiveAuto(true);
  if (DEVICES.includes(mode)) {
    if (responsiveAuto(state.doc)) setResponsiveAuto(false);
    return setEditingDevice(mode);
  }
  return false;
}

export function responsiveMode(doc = state.doc) {
  return responsiveAuto(doc) ? "auto" : responsiveDevice(doc);
}

export { composeFrames };

export function bringForward(entries = selectedElements()) {
  if (!entries.length) return;
  commit(() => {
    for (const entry of entries) entry.el.z = (Number(entry.el.z) || 1) + 1;
  }, { label: "z-order" });
}

export function sendBackward(entries = selectedElements()) {
  if (!entries.length) return;
  commit(() => {
    for (const entry of entries) entry.el.z = Math.max(1, (Number(entry.el.z) || 1) - 1);
  }, { label: "z-order" });
}

export function setSaveState(status, error = "") {
  state.saveState = status;
  state.saveError = error;
  if (status === "saved") {
    state.dirty = false;
    state.lastSavedAt = new Date();
  }
  emit("save");
}
