/** Правая панель свойств: геометрия фрейма, геометрия и стиль элемента, типографика. */

import {
  alignSelection,
  bringForward,
  commit,
  deleteElements,
  deleteFrame,
  deleteFrames,
  distributeSelection,
  duplicateElements,
  duplicateFrame,
  on,
  selectedElements,
  selectedFrames,
  selectionBounds,
  sendBackward,
  setSelection,
  state,
  update,
  updateFrame,
  groupSelection,
  ungroupSelection,
} from "./state.js";
import { elementTypeLabel } from "./render.js";
import { icon, toast } from "./toast.js";
import { mountColorPicker } from "./colorpicker.js";

let onReplaceImage = null;
let lastMode = "";

const SHADOWS = [
  ["", "Без тени"],
  ["0 1px 2px rgba(24,24,27,.08)", "Мягкая"],
  ["0 10px 30px rgba(15,23,42,.12)", "Средняя"],
  ["0 24px 60px rgba(15,23,42,.22)", "Глубокая"],
  ["0 0 0 4px rgba(79,70,229,.18)", "Свечение"],
];

const FONT_OPTIONS = [
  ["system", "Системный"],
  ["inter", "Inter"],
  ["serif", "Georgia"],
  ["mono", "Monospace"],
];

const WEIGHTS = [
  [300, "Light 300"],
  [400, "Regular 400"],
  [500, "Medium 500"],
  [600, "Semibold 600"],
  [700, "Bold 700"],
  [800, "Extrabold 800"],
];

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[char]);
}

function common(entries, getter, fallback = "") {
  if (!entries.length) return fallback;
  const first = getter(entries[0]);
  return entries.every((entry) => String(getter(entry)) === String(first)) ? first : "";
}

function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function colorField({ label, key, value, scope = "style", allowEmpty = false }) {
  return `
    <div class="field">
      <label>${label}</label>
      <div class="color-field" data-color-field>
        <button type="button" class="color-swatch" data-color-open
                data-color-for="${key}" data-scope="${scope}"
                data-empty="${allowEmpty && !value ? "1" : ""}"
                aria-label="${label}"></button>
        <input class="input" type="text" data-${scope}="${key}" value="${esc(value)}"
               placeholder="${allowEmpty ? "transparent" : "#000000"}" spellcheck="false">
      </div>
    </div>`;
}

function numberField({ label, key, value, min, max, step = 1, scope = "style", suffix = "" }) {
  const safeValue = value === undefined || value === null || Number.isNaN(Number(value)) ? "" : value;
  return `
    <label class="mini-field">
      <span>${label}${suffix ? `<em>${suffix}</em>` : ""}</span>
      <input class="input" type="number" data-${scope}="${key}" value="${safeValue}" min="${min}" max="${max}" step="${step}">
    </label>`;
}

function selectField({ label, key, value, options, scope = "style" }) {
  return `
    <div class="field">
      <label>${label}</label>
      <select class="select" data-${scope}="${key}">
        ${options.map(([val, text]) => `<option value="${esc(val)}"${String(val) === String(value) ? " selected" : ""}>${esc(text)}</option>`).join("")}
      </select>
    </div>`;
}

export function initPanels(options = {}) {
  onReplaceImage = options.onReplaceImage || null;
  const panel = document.getElementById("propertiesPanel");
  if (!panel) return;
  panel.addEventListener("input", onPanelInput);
  // change не дублируем: select/checkbox/range в современных браузерах тоже
  // присылают input, а повторный commit создавал лишний шаг истории.
  panel.addEventListener("click", onPanelClick);
  mountColorPicker(panel, { onPick: onColorPicked });

  on("selection", () => renderProperties());
  on("active", () => {
    if (!state.selection.size && !state.frameSelection.size) renderProperties();
  });
  on("doc", ({ transient }) => {
    if (!transient) syncValues();
  });
  renderProperties();
}

/** Колбэк из кастомного пикера: применить выбранный цвет к нужному полю. */
function onColorPicked(button, value, { transient = false } = {}) {
  const scope = button.dataset.scope;
  const key = button.dataset.colorFor;
  const text = [...document.querySelectorAll(`[data-${scope}="${key}"]`)].find((node) => node.type === "text");
  if (text) text.value = value;
  const field = button.closest("[data-color-field]");
  const swatch = field?.querySelector("[data-color-open]");
  if (swatch) {
    const empty = !value || value === "transparent";
    swatch.style.setProperty("--swatch", empty ? "transparent" : value);
    swatch.dataset.empty = empty ? "1" : "";
  }
  if (transient) {
    // Живой предпросмотр: обновляем документ без записи в историю и без
    // автосохранения. Финальный commit придёт на pointerup/change.
    if (scope === "style") {
      update(() => {
        for (const entry of selectedElements()) {
          entry.el.style = entry.el.style || {};
          entry.el.style[key] = value;
        }
      }, { label: "color-preview" });
    } else if (scope === "frame") {
      update(() => {
        for (const frame of selectedFrames()) frame[key] = value;
      }, { label: "color-preview" });
    }
    return;
  }
  setValue(scope, key, value);
}

function renderProperties() {
  const panel = document.getElementById("propertiesPanel");
  if (!panel) return;
  const frames = selectedFrames();
  const entries = selectedElements();
  if (frames.length) {
    renderFramePanel(panel, frames);
  } else if (entries.length) {
    renderElementPanel(panel, entries);
  } else {
    renderEmpty(panel, "Ничего не выбрано", "Выберите фрейм, элемент на холсте или слой слева, чтобы настроить его.");
  }
  syncSwatches(panel);
}

/** Обновить цветные образцы у полей после перерисовки панели. */
function syncSwatches(panel) {
  panel.querySelectorAll("[data-color-open]").forEach((button) => {
    const scope = button.dataset.scope;
    const key = button.dataset.colorFor;
    const input = [...panel.querySelectorAll(`[data-${scope}="${key}"]`)].find((node) => node.type === "text");
    const value = String(input?.value || "").trim();
    button.style.setProperty("--swatch", value && value !== "transparent" ? value : "transparent");
    button.dataset.empty = value && value !== "transparent" ? "" : "1";
  });
}

function renderEmpty(panel, title, text) {
  panel.innerHTML = `
    <div class="props-empty">
      <div class="props-empty-icon">${icon("move", "icon icon-lg")}</div>
      <strong>${title}</strong>
      <p>${text}</p>
      <div class="props-empty-tips">
        <span><b>F</b> инструмент «Фрейм»</span>
        <span><b>?</b> горячие клавиши</span>
      </div>
    </div>`;
  lastMode = "empty";
}

function renderFramePanel(panel, frames) {
  const single = frames.length === 1;
  const frame = frames[0];
  lastMode = "frame";
  const bounds = framesBounds(frames);
  panel.innerHTML = `
    <div class="props-head">
      <span class="props-type-icon">${icon("frame")}</span>
      <div class="props-title">
        <strong>${single ? esc(frame.name || "Фрейм") : `${frames.length} фрейма`}</strong>
        <span class="muted">${single && frame.role === "header" ? "Общая шапка · сверху на всех страницах" : single && frame.role === "footer" ? "Общий подвал · снизу на всех страницах" : "Фрейм"}</span>
      </div>
      <button class="btn btn-icon" type="button" data-frame-action="toggle-lock" title="${frame.locked ? "Разблокировать" : "Заблокировать"}">
        ${icon(frame.locked ? "lock" : "unlock")}
      </button>
    </div>

    <div class="props-group">
      <div class="props-group-title">Название</div>
      <div class="props-group-body">
        <div class="field">
          <label>Имя фрейма</label>
          <input class="input" type="text" data-frame-prop="name" value="${esc(frame.name)}" ${single ? "" : "disabled"}>
        </div>
      </div>
    </div>

    <div class="props-group">
      <div class="props-group-title">Положение и размер</div>
      <div class="props-group-body">
        <div class="geom-grid">
          ${numberField({ label: "X", key: "x", value: Math.round(bounds.x), scope: "frame-geom" })}
          ${numberField({ label: "Y", key: "y", value: Math.round(bounds.y), scope: "frame-geom" })}
          ${numberField({ label: "W", key: "w", value: Math.round(bounds.w), min: 1, scope: "frame-geom" })}
          ${numberField({ label: "H", key: "h", value: Math.round(bounds.h), min: 1, scope: "frame-geom" })}
        </div>
      </div>
    </div>

    <div class="props-group">
      <div class="props-group-title">Оформление</div>
      <div class="props-group-body">
        ${colorField({ label: "Фон", key: "bg", value: frame.bg, scope: "frame" })}
        ${numberField({ label: "Скругление", key: "radius", value: Math.round(frame.radius || 0), min: 0, max: 999, suffix: "px", scope: "frame" })}
      </div>
    </div>

    <div class="props-group">
      <div class="props-group-title">Действия</div>
      <div class="props-group-body">
        <div class="props-actions-row">
          <button class="btn btn-sm btn-outline" type="button" data-frame-action="duplicate">${icon("copy", "icon icon-sm")} Дублировать</button>
          <button class="btn btn-sm btn-outline" type="button" data-frame-action="delete">${icon("trash", "icon icon-sm")} Удалить</button>
        </div>
      </div>
    </div>

    <div class="props-hint">
      ${icon("resize", "icon icon-sm")}
      <p>Тяните за грани и углы фрейма, чтобы менять размер. Двойной клик по ярлыку — переименование.</p>
    </div>`;
  syncValues();
}

/** Объединённый прямоугольник фреймов. */
function framesBounds(frames) {
  if (frames.length === 1) {
    const f = frames[0];
    return { x: Number(f.x) || 0, y: Number(f.y) || 0, w: Number(f.w) || 0, h: Number(f.h) || 0 };
  }
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const f of frames) {
    minX = Math.min(minX, Number(f.x) || 0);
    minY = Math.min(minY, Number(f.y) || 0);
    maxX = Math.max(maxX, (Number(f.x) || 0) + (Number(f.w) || 0));
    maxY = Math.max(maxY, (Number(f.y) || 0) + (Number(f.h) || 0));
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

function renderElementPanel(panel, entries) {
  const single = entries.length === 1;
  const el = entries[0].el;
  lastMode = "element";
  const bounds = selectionBounds(entries);
  const style = el.style || {};
  const props = el.props || {};
  const textMode = ["text", "heading", "button", "link"].includes(el.type) && single;
  const palette = el.type === "shape" || el.type === "button" || el.type === "line";
  const showTypography = entries.every((entry) => ["text", "heading", "button", "link"].includes(entry.el.type));
  const rotation = common(entries, (entry) => entry.el.rotation || 0, 0);

  panel.innerHTML = `
    <div class="props-head">
      <span class="props-type-icon">${icon(el.type === "shape" && props.shape === "ellipse" ? "circle" : el.type === "heading" ? "heading" : el.type === "text" ? "type" : el.type === "button" ? "button" : el.type === "link" ? "link" : el.type === "image" ? "image" : el.type === "line" ? "line" : "square")}</span>
      <div class="props-title">
        <strong>${single ? esc(el.name || elementTypeLabel(el.type)) : `${entries.length} элемента`}</strong>
        <span class="muted">${single ? elementTypeLabel(el.type) : "Групповое выделение"}</span>
      </div>
      <button class="btn btn-icon" type="button" data-action="toggle-lock" title="${el.locked ? "Разблокировать" : "Заблокировать"}">
        ${icon(el.locked ? "lock" : "unlock")}
      </button>
    </div>

    <div class="props-group">
      <div class="props-group-title">Положение и размер</div>
      <div class="props-group-body">
        <div class="geom-grid">
          ${numberField({ label: "X", key: "x", value: Math.round(bounds.x), scope: "geom" })}
          ${numberField({ label: "Y", key: "y", value: Math.round(bounds.y), scope: "geom" })}
          ${numberField({ label: "W", key: "w", value: Math.round(bounds.w), min: 1, scope: "geom" })}
          ${numberField({ label: "H", key: "h", value: Math.round(bounds.h), min: 1, scope: "geom" })}
          ${single ? numberField({ label: "∠", key: "rotation", value: rotation, min: -360, max: 360, suffix: "°", scope: "geom" }) : ""}
        </div>
      </div>
    </div>

    <div class="props-group">
      <div class="props-group-title">Блок в секции</div>
      <div class="props-group-body">
        <div class="align-note">${single ? "Куда встаёт блок внутри своей секции." : "Как блоки встают друг относительно друга."}</div>
        <div class="align-bar" role="group" aria-label="Выравнивание блока в секции">
          <button type="button" data-action="align-left" title="${single ? "Прижать к левому краю секции" : "Выровнять по левому краю"}" aria-label="Выровнять по левому краю">${icon("align-left", "icon icon-sm")}</button>
          <button type="button" data-action="align-center-h" title="${single ? "Центр секции по горизонтали" : "Центр по горизонтали"}" aria-label="Центр по горизонтали">${icon("align-center-h", "icon icon-sm")}</button>
          <button type="button" data-action="align-right" title="${single ? "Прижать к правому краю секции" : "Выровнять по правому краю"}" aria-label="Выровнять по правому краю">${icon("align-right", "icon icon-sm")}</button>
          <span class="align-divider"></span>
          <button type="button" data-action="align-top" title="${single ? "Прижать к верху секции" : "Выровнять по верху"}" aria-label="Выровнять по верху">${icon("align-top", "icon icon-sm")}</button>
          <button type="button" data-action="align-middle" title="${single ? "Центр секции по вертикали" : "Центр по вертикали"}" aria-label="Центр по вертикали">${icon("align-middle", "icon icon-sm")}</button>
          <button type="button" data-action="align-bottom" title="${single ? "Прижать к низу секции" : "Выровнять по низу"}" aria-label="Выровнять по низу">${icon("align-bottom", "icon icon-sm")}</button>
          <span class="align-divider"></span>
          <button type="button" data-action="distribute-h" title="Распределить по горизонтали (3+)" aria-label="Распределить по горизонтали">${icon("distribute-h", "icon icon-sm")}</button>
          <button type="button" data-action="distribute-v" title="Распределить по вертикали (3+)" aria-label="Распределить по вертикали">${icon("distribute-v", "icon icon-sm")}</button>
        </div>
      </div>
    </div>

    ${single ? renderContentGroup(el, props, textMode) : ""}
    ${showTypography ? renderTypographyGroup(entries, style) : ""}

    <div class="props-group">
      <div class="props-group-title">Оформление</div>
      <div class="props-group-body">
        ${palette ? colorField({ label: "Заливка", key: "fill", value: common(entries, (entry) => entry.el.style?.fill, ""), allowEmpty: true }) : ""}
        ${el.type === "image" ? colorField({ label: "Подложка", key: "fill", value: common(entries, (entry) => entry.el.style?.fill, "transparent"), allowEmpty: true }) : ""}
        <div class="field-row">
          ${numberField({ label: "Радиус", key: "borderRadius", value: common(entries, (entry) => entry.el.style?.borderRadius, 0), min: 0, max: 999, suffix: "px" })}
          ${numberField({ label: "Обводка", key: "borderWidth", value: common(entries, (entry) => entry.el.style?.borderWidth, 0), min: 0, max: 40, suffix: "px" })}
        </div>
        ${colorField({ label: "Цвет обводки", key: "borderColor", value: common(entries, (entry) => entry.el.style?.borderColor, "transparent"), allowEmpty: true })}
        <div class="field">
          <label>Прозрачность <span class="field-value">${Math.round(num(common(entries, (entry) => entry.el.style?.opacity, 1), 1) * 100)}%</span></label>
          <input type="range" min="0" max="100" step="1" data-opacity-range value="${Math.round(num(common(entries, (entry) => entry.el.style?.opacity, 1), 1) * 100)}">
        </div>
        ${selectField({
          label: "Тень",
          key: "boxShadow",
          value: common(entries, (entry) => entry.el.style?.boxShadow, ""),
          options: SHADOWS,
        })}
        ${el.type === "image" ? selectField({
          label: "Кадрирование",
          key: "objectFit",
          value: common(entries, (entry) => entry.el.style?.objectFit, "cover"),
          options: [["cover", "Заполнить"], ["contain", "Вписать"], ["fill", "Растянуть"]],
        }) : ""}
      </div>
    </div>

    <div class="props-group">
      <div class="props-group-title">Порядок и действия</div>
      <div class="props-group-body">
        <div class="z-row">
          <button class="btn btn-sm btn-outline" type="button" data-action="forward">${icon("arrow-up", "icon icon-sm")} Выше</button>
          <button class="btn btn-sm btn-outline" type="button" data-action="backward">${icon("arrow-down", "icon icon-sm")} Ниже</button>
        </div>
        <div class="props-actions-row">
          <button class="btn btn-sm btn-outline" type="button" data-action="duplicate">${icon("copy", "icon icon-sm")} Дублировать</button>
          <button class="btn btn-sm btn-outline" type="button" data-action="delete">${icon("trash", "icon icon-sm")} Удалить</button>
        </div>
        <div class="props-actions-row">
          ${entries.length > 1
            ? `<button class="btn btn-sm btn-outline" type="button" data-action="group">${icon("folder", "icon icon-sm")} Группировать</button>`
            : ""}
          ${entries.some((entry) => entry.el.groupId)
            ? `<button class="btn btn-sm btn-outline" type="button" data-action="ungroup">${icon("unlink", "icon icon-sm")} Разгруппировать</button>`
            : ""}
        </div>
        <label class="checkbox"><input type="checkbox" data-action-check="hidden" ${el.hidden ? "checked" : ""}> Скрыть слой</label>
      </div>
    </div>`;
  syncValues();
}

function textInput({ label, key, value, placeholder = "", scope = "prop" }) {
  return `
    <div class="field">
      <label>${label}</label>
      <input class="input" type="text" data-${scope}="${key}" value="${esc(value)}" placeholder="${esc(placeholder)}">
    </div>`;
}

function pageLinkField(props) {
  const pages = state.doc?.pages || [];
  if (!pages.length) return "";
  const current = String(props?.href || "").startsWith("page:") ? props.href : "";
  return selectField({
    label: "Страница сайта",
    key: "href",
    value: current,
    options: [["", "— внешняя ссылка / без ссылки —"], ...pages.map((page) => [`page:${page.id}`, page.name])],
    scope: "prop",
  });
}

function renderContentGroup(el, props, textMode) {
  const pageSelect = pageLinkField(props);
  if (textMode) {
    if (el.type === "link") {
      return `
        <div class="props-group">
          <div class="props-group-title">Ссылка</div>
          <div class="props-group-body">
            <div class="field">
              <label>Текст</label>
              <textarea class="textarea" rows="2" data-prop="text">${esc(props.text)}</textarea>
            </div>
            ${textInput({ label: "URL", key: "href", value: props.href, placeholder: "https://… или #anchor" })}
            ${pageSelect}
            ${selectField({
              label: "Открывать",
              key: "target",
              value: props.target || "_blank",
              options: [["_blank", "В новой вкладке"], ["_self", "В текущей вкладке"]],
              scope: "prop",
            })}
            <p class="hint">Если выбрать страницу, ссылка заменит URL и в экспорте поведёт на нужную страницу сайта.</p>
          </div>
        </div>`;
    }
    return `
      <div class="props-group">
        <div class="props-group-title">Контент</div>
        <div class="props-group-body">
          <div class="field">
            <label>Текст</label>
            <textarea class="textarea" rows="3" data-prop="text">${esc(props.text)}</textarea>
          </div>
          ${el.type === "heading" ? selectField({
            label: "Уровень заголовка",
            key: "level",
            value: props.level || 2,
            options: [[1, "H1 — главный"], [2, "H2 — раздел"], [3, "H3 — подраздел"]],
            scope: "prop",
          }) : ""}
          ${el.type === "button" ? textInput({ label: "Ссылка", key: "href", value: props.href, placeholder: "https://… или #anchor" }) : ""}
          ${el.type === "button" ? pageSelect : ""}
          ${el.type === "text" || el.type === "heading" ? textInput({ label: "Ссылка (необязательно)", key: "href", value: props.href, placeholder: "https://…" }) : ""}
          ${el.type === "text" || el.type === "heading" || el.type === "button" || el.type === "shape" ? textInput({ label: "Якорь (id)", key: "anchor", value: props.anchor, placeholder: "features" }) : ""}
        </div>
      </div>`;
  }
  if (el.type === "image") {
    return `
      <div class="props-group">
        <div class="props-group-title">Изображение</div>
        <div class="props-group-body">
          <button class="btn btn-outline image-replace" type="button" data-action="replace-image">
            ${icon("upload", "icon icon-sm")} ${props.src ? "Заменить изображение" : "Загрузить изображение"}
          </button>
          ${textInput({ label: "Или URL", key: "src", value: props.src, placeholder: "https://…" })}
          ${textInput({ label: "Alt-текст", key: "alt", value: props.alt, placeholder: "Описание для доступности" })}
        </div>
      </div>`;
  }
  if (el.type === "shape") {
    return `
      <div class="props-group">
        <div class="props-group-title">Фигура</div>
        <div class="props-group-body">
          ${selectField({
            label: "Форма",
            key: "shape",
            value: props.shape || "rectangle",
            options: [["rectangle", "Прямоугольник"], ["ellipse", "Круг / эллипс"]],
            scope: "prop",
          })}
        </div>
      </div>`;
  }
  if (el.type === "line") {
    return `
      <div class="props-group">
        <div class="props-group-title">Линия</div>
        <div class="props-group-body">
          ${numberField({ label: "Толщина", key: "strokeWidth", value: el.style?.strokeWidth || 2, min: 1, max: 40, suffix: "px" })}
        </div>
      </div>`;
  }
  if (el.type === "embed") {
    return `
      <div class="props-group">
        <div class="props-group-title">Встраивание</div>
        <div class="props-group-body">
          ${textInput({ label: "URL (iframe)", key: "src", value: props.src, placeholder: "https://www.youtube.com/embed/…" })}
          <p class="hint">Контент открывается в sandbox-iframe. Для экспорта нужен интернет.</p>
        </div>
      </div>`;
  }
  return "";
}

function renderTypographyGroup(entries, style) {
  const hAlign = common(entries, (entry) => entry.el.style?.textAlign, "left") || "left";
  const vAlign = common(entries, (entry) => entry.el.style?.verticalAlign, "top") || "top";
  return `
    <div class="props-group">
      <div class="props-group-title">Типографика</div>
      <div class="props-group-body">
        ${selectField({
          label: "Шрифт",
          key: "fontFamily",
          value: common(entries, (entry) => entry.el.style?.fontFamily, "system"),
          options: FONT_OPTIONS,
        })}
        <div class="field-row">
          ${numberField({ label: "Размер", key: "fontSize", value: common(entries, (entry) => entry.el.style?.fontSize, 18), min: 6, max: 240, suffix: "px" })}
          ${selectField({
            label: "Насыщенность",
            key: "fontWeight",
            value: common(entries, (entry) => entry.el.style?.fontWeight, 400),
            options: WEIGHTS,
          })}
        </div>
        <div class="field-row">
          ${numberField({ label: "Межстрочный", key: "lineHeight", value: common(entries, (entry) => entry.el.style?.lineHeight, 1.4), min: 0.6, max: 3, step: 0.05 })}
          ${numberField({ label: "Трекинг", key: "letterSpacing", value: common(entries, (entry) => entry.el.style?.letterSpacing, 0), min: -10, max: 40, step: 0.5, suffix: "px" })}
        </div>
        ${colorField({ label: "Цвет текста", key: "color", value: common(entries, (entry) => entry.el.style?.color, "#18181B") })}
      </div>
    </div>

    <div class="props-group">
      <div class="props-group-title">Текст внутри блока</div>
      <div class="props-group-body">
        <div class="align-note">Как строки располагаются внутри рамки самого текста.</div>
        <div class="align-bar align-text" role="group" aria-label="Выравнивание строк в блоке">
          ${[["left", "align-left", "По левому краю"], ["center", "align-center-h", "По центру"], ["right", "align-right", "По правому краю"], ["justify", "distribute-h", "По ширине"]]
            .map(([mode, ic, label]) => `
            <button type="button" data-text-align="${mode}" title="${label}"
              class="${hAlign === mode ? "is-active" : ""}">
              ${icon(ic, "icon icon-sm")}
            </button>`).join("")}
        </div>
        <div class="align-bar align-text" role="group" aria-label="Выравнивание по вертикали в блоке">
          ${[["top", "align-top", "К верху блока"], ["middle", "align-middle", "По центру блока"], ["bottom", "align-bottom", "К низу блока"]]
            .map(([mode, ic, label]) => `
            <button type="button" data-text-valign="${mode}" title="${label}"
              class="${vAlign === mode ? "is-active" : ""}">
              ${icon(ic, "icon icon-sm")}
            </button>`).join("")}
        </div>
      </div>
    </div>`;
}

function onPanelInput(event) {
  const target = event.target;
  const colorField = target.closest?.("[data-color-field]");
  if (colorField && target.type === "text") {
    const swatch = colorField.querySelector("[data-color-open]");
    const value = String(target.value || "").trim();
    if (swatch) {
      swatch.style.setProperty("--swatch", value && value !== "transparent" ? value : "transparent");
      swatch.dataset.empty = value && value !== "transparent" ? "" : "1";
    }
  }
  if (target.matches("[data-opacity-range]")) {
    const value = Number(target.value) / 100;
    setStyleValue("opacity", value);
    const label = target.closest(".field")?.querySelector(".field-value");
    if (label) label.textContent = `${target.value}%`;
    return;
  }
  if (target.matches("[data-geom]")) {
    applyGeometry(target.dataset.geom, Number(target.value));
    return;
  }
  if (target.matches("[data-frame-geom]")) {
    applyFrameGeometry(target.dataset.frameGeom, Number(target.value));
    return;
  }
  if (target.matches("[data-frame-prop]")) {
    const frames = selectedFrames();
    if (frames.length === 1 && frames[0].name !== target.value) {
      updateFrame(frames[0].id, { [target.dataset.frameProp]: target.value });
    }
    return;
  }
  if (target.matches("[data-frame]")) {
    const key = target.dataset.frame;
    let value = target.value;
    if (key === "radius") value = Math.max(0, Number(value) || 0);
    for (const frame of selectedFrames()) {
      if (frame[key] !== value) updateFrame(frame.id, { [key]: value });
    }
    return;
  }
  if (target.matches("[data-style]")) {
    const key = target.dataset.style;
    let value = target.value;
    if (["borderRadius", "borderWidth", "fontSize", "fontWeight", "lineHeight", "letterSpacing", "strokeWidth"].includes(key)) {
      value = Number(value);
    }
    setStyleValue(key, value);
    return;
  }
  if (target.matches("[data-prop]")) {
    const key = target.dataset.prop;
    let value = target.value;
    if (key === "level") value = Number(value);
    setPropValue(key, value);
    return;
  }
  if (target.matches("[data-action-check]")) {
    if (target.dataset.actionCheck === "hidden") {
      const entries = selectedElements();
      commit(() => {
        for (const entry of entries) entry.el.hidden = target.checked;
      }, { label: "visibility" });
    }
  }
}

function onPanelClick(event) {
  const textAlign = event.target.closest("[data-text-align]");
  if (textAlign) {
    setStyleValue("textAlign", textAlign.dataset.textAlign);
    syncTextAlignButtons();
    return;
  }
  const textValign = event.target.closest("[data-text-valign]");
  if (textValign) {
    setStyleValue("verticalAlign", textValign.dataset.textValign);
    syncTextAlignButtons();
    return;
  }
  const action = event.target.closest("[data-action]")?.dataset.action;
  if (action) {
    handleAction(action);
    return;
  }
  const frameAction = event.target.closest("[data-frame-action]")?.dataset.frameAction;
  if (frameAction) handleFrameAction(frameAction);
}

/** Подсветить активные кнопки выравнивания текста (в блоке и по вертикали). */
function syncTextAlignButtons() {
  const panel = document.getElementById("propertiesPanel");
  if (!panel) return;
  const entries = selectedElements();
  const hAlign = common(entries, (entry) => entry.el.style?.textAlign, "left");
  const vAlign = common(entries, (entry) => entry.el.style?.verticalAlign, "top");
  panel.querySelectorAll("[data-text-align]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.textAlign === hAlign);
  });
  panel.querySelectorAll("[data-text-valign]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.textValign === vAlign);
  });
}

function setValue(scope, key, value) {
  if (scope === "style") setStyleValue(key, value);
  else if (scope === "prop") setPropValue(key, value);
  else if (scope === "frame") {
    for (const frame of selectedFrames()) updateFrame(frame.id, { [key]: value });
  }
}

function setStyleValue(key, value) {
  const entries = selectedElements();
  if (!entries.length) return;
  if (entries.every((entry) => entry.el.style?.[key] === value)) return;
  commit(() => {
    for (const entry of entries) {
      entry.el.style = entry.el.style || {};
      entry.el.style[key] = value;
    }
  }, { label: `style-${key}` });
}

function setPropValue(key, value) {
  const entries = selectedElements();
  if (!entries.length) return;
  if (entries.every((entry) => entry.el.props?.[key] === value)) return;
  commit(() => {
    for (const entry of entries) {
      entry.el.props = entry.el.props || {};
      entry.el.props[key] = value;
    }
  }, { label: `prop-${key}` });
}

function applyGeometry(key, value) {
  const entries = selectedElements();
  if (!entries.length || !Number.isFinite(value)) return;
  const bounds = selectionBounds(entries);
  commit(() => {
    if (entries.length === 1) {
      const { el, frame } = entries[0];
      const fx = Number(frame?.x) || 0;
      const fy = Number(frame?.y) || 0;
      if (key === "rotation") el.rotation = value;
      else if (key === "w") el.w = Math.max(1, value);
      else if (key === "h") el.h = Math.max(1, value);
      else if (key === "x") el.x = Math.max(0, value - fx);
      else if (key === "y") el.y = Math.max(0, value - fy);
      return;
    }
    if (key === "x" || key === "y") {
      const delta = value - bounds[key];
      for (const { el } of entries) el[key] = Math.round(Number(el[key]) + delta);
    } else if (key === "w" || key === "h") {
      const axis = key === "w" ? "x" : "y";
      const size = key === "w" ? "w" : "h";
      const scale = bounds[size] ? Math.max(1, value) / bounds[size] : 1;
      for (const { el, frame } of entries) {
        const offset = Number(frame?.[axis]) || 0;
        const absolute = offset + Number(el[axis]);
        el[axis] = Math.round(Math.max(0, bounds[axis] + (absolute - bounds[axis]) * scale - offset));
        el[size] = Math.max(1, Math.round(Number(el[size]) * scale));
      }
    }
  }, { label: `geom-${key}` });
}

function applyFrameGeometry(key, value) {
  const frames = selectedFrames();
  if (!frames.length || !Number.isFinite(value)) return;
  const bounds = framesBounds(frames);
  if (frames.length === 1) {
    updateFrame(frames[0].id, { [key]: value });
    return;
  }
  const delta = value - bounds[key];
  for (const frame of frames) {
    if (key === "x" || key === "y") {
      updateFrame(frame.id, { [key]: Math.round((Number(frame[key]) || 0) + delta) });
    } else if (key === "w" || key === "h") {
      const scale = bounds[key] ? Math.max(1, value) / bounds[key] : 1;
      updateFrame(frame.id, { [key]: Math.round((Number(frame[key]) || 1) * scale) });
    }
  }
}

function handleAction(action) {
  const entries = selectedElements();
  if (!entries.length) return;
  switch (action) {
    case "duplicate":
      duplicateElements(entries);
      toast("Элементы продублированы", { type: "success" });
      break;
    case "delete":
      deleteElements(entries);
      toast("Удалено", { type: "info" });
      break;
    case "group": {
      const groupId = groupSelection(entries);
      if (groupId) toast("Элементы сгруппированы", { type: "success" });
      break;
    }
    case "ungroup":
      if (ungroupSelection()) toast("Группа разобрана", { type: "info" });
      break;
    case "forward":
      bringForward(entries);
      break;
    case "backward":
      sendBackward(entries);
      break;
    case "toggle-lock": {
      const next = !entries.every((entry) => entry.el.locked);
      commit(() => {
        for (const entry of entries) entry.el.locked = next;
      }, { label: "lock" });
      break;
    }
    case "align-left":
    case "align-center-h":
    case "align-right":
    case "align-top":
    case "align-middle":
    case "align-bottom": {
      // Кнопки называют режимы иначе, чем state.alignSelection.
      const modeMap = {
        "align-left": "left",
        "align-center-h": "center-h",
        "align-right": "right",
        "align-top": "top",
        "align-middle": "center-v",
        "align-bottom": "bottom",
      };
      alignSelection(modeMap[action]);
      break;
    }
    case "distribute-h":
      if (entries.length < 3) {
        toast("Распределение работает для 3+ элементов", { type: "info", duration: 2000 });
      } else {
        distributeSelection("h");
      }
      break;
    case "distribute-v":
      if (entries.length < 3) {
        toast("Распределение работает для 3+ элементов", { type: "info", duration: 2000 });
      } else {
        distributeSelection("v");
      }
      break;
    case "replace-image": {
      const entry = selectedElements()[0];
      if (entry && onReplaceImage) onReplaceImage(entry.el.id);
      break;
    }
    default:
      break;
  }
}

function handleFrameAction(action) {
  const frames = selectedFrames();
  if (!frames.length) return;
  if (action === "duplicate") {
    for (const frame of frames) duplicateFrame(frame.id);
    toast("Фрейм продублирован", { type: "success" });
    return;
  }
  if (action === "delete") {
    if (frames.length > 1) deleteFrames(frames.map((frame) => frame.id));
    else deleteFrame(frames[0].id);
    setSelection([]);
    toast(frames.length > 1 ? `Удалено фреймов: ${frames.length}` : "Фрейм удалён", { type: "info" });
    return;
  }
  if (action === "toggle-lock") {
    const next = !frames.every((frame) => frame.locked);
    for (const frame of frames) updateFrame(frame.id, { locked: next });
  }
}

function syncValues() {
  const panel = document.getElementById("propertiesPanel");
  if (!panel) return;
  const set = (selector, value) => {
    const node = panel.querySelector(selector);
    if (node && document.activeElement !== node) node.value = value;
  };
  const frames = selectedFrames();
  const entries = selectedElements();

  if (frames.length) {
    const bounds = framesBounds(frames);
    const frame = frames[0];
    set('[data-frame-geom="x"]', Math.round(bounds.x));
    set('[data-frame-geom="y"]', Math.round(bounds.y));
    set('[data-frame-geom="w"]', Math.round(bounds.w));
    set('[data-frame-geom="h"]', Math.round(bounds.h));
    set('[data-frame-prop="name"]', frame.name || "");
    set('[data-frame="bg"]', frame.bg || "#ffffff");
    set('[data-frame="radius"]', Math.round(frame.radius || 0));
    syncSwatches(panel);
    return;
  }

  if (entries.length) {
    const bounds = selectionBounds(entries);
    const el = entries[0].el;
    set('[data-geom="x"]', Math.round(bounds.x));
    set('[data-geom="y"]', Math.round(bounds.y));
    set('[data-geom="w"]', Math.round(bounds.w));
    set('[data-geom="h"]', Math.round(bounds.h));
    set('[data-geom="rotation"]', el.rotation || 0);
    for (const key of ["fill", "borderRadius", "borderWidth", "borderColor", "fontFamily", "fontSize", "fontWeight", "lineHeight", "letterSpacing", "textAlign", "color", "objectFit", "boxShadow"]) {
      const value = common(entries, (entry) => entry.el.style?.[key], "");
      set(`[data-style="${key}"]`, value);
    }
    const hiddenToggle = panel.querySelector('[data-action-check="hidden"]');
    if (hiddenToggle) hiddenToggle.checked = entries.every((entry) => entry.el.hidden);
    syncTextAlignButtons();
    const opacityRange = panel.querySelector("[data-opacity-range]");
    if (opacityRange && document.activeElement !== opacityRange) {
      opacityRange.value = Math.round(num(common(entries, (entry) => entry.el.style?.opacity, 1), 1) * 100);
    }
    if (entries.length === 1) {
      for (const key of ["text", "href", "alt", "src", "level", "shape", "anchor"]) {
        set(`[data-prop="${key}"]`, el.props?.[key] ?? "");
      }
    }
  }
  syncSwatches(panel);
}
