/**
 * Кастомная палитра цветов в стиле Figma.
 * Спектр насыщенность/яркость, слайдеры оттенка и прозрачности, hex-поле
 * и набор готовых образцов. Полностью заменяет системный <input type="color">.
 */

const SWATCHES = [
  "#000000", "#18181B", "#52525B", "#A1A1AA", "#D4D4D8", "#FFFFFF",
  "#DC2626", "#EA580C", "#D97706", "#CA8A04", "#16A34A", "#059669",
  "#0891B2", "#0284C7", "#2563EB", "#4F46E5", "#7C3AED", "#C026D3",
  "#DB2777", "#E11D48", "#BE123C", "#9F1239", "#7F1D1D", "#1E1B4B",
];

let root = null;
let mounted = null;
let activeButton = null;
let current = { r: 255, g: 255, b: 255, a: 1 };
let onPick = null;
let previewDirty = false;

export function mountColorPicker(container, options = {}) {
  mounted = container;
  onPick = options.onPick || null;
  // Один делегированный обработчик: открытие по кнопке-образцу.
  container.addEventListener("click", (event) => {
    const trigger = event.target.closest("[data-color-open]");
    if (trigger) {
      event.preventDefault();
      open(trigger);
    }
  });
  document.addEventListener("pointerdown", onDocumentPointerDown, true);
  window.addEventListener("resize", () => activeButton && place(root, activeButton));
  window.addEventListener("scroll", () => activeButton && place(root, activeButton), true);
  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && root && !root.hidden) {
      event.preventDefault();
      event.stopPropagation();
      close();
    }
  }, true);
}

function ensureRoot() {
  if (root) return root;
  root = document.createElement("div");
  root.className = "colorpicker";
  root.hidden = true;
  root.innerHTML = `
    <div class="cp-sv" data-cp-sv>
      <div class="cp-sv-knob" data-cp-knob></div>
    </div>
    <div class="cp-controls">
      <div class="cp-slider cp-hue" data-cp-hue>
        <div class="cp-slider-knob" data-cp-hue-knob></div>
      </div>
      <div class="cp-slider cp-alpha" data-cp-alpha>
        <div class="cp-alpha-fill" data-cp-alpha-fill></div>
        <div class="cp-slider-knob" data-cp-alpha-knob></div>
      </div>
    </div>
    <div class="cp-fields">
      <div class="cp-preview" data-cp-preview></div>
      <div class="cp-hex-wrap">
        <span class="cp-hex-hash">#</span>
        <input class="cp-hex" data-cp-hex maxlength="8" spellcheck="false" aria-label="HEX">
      </div>
      <div class="cp-alpha-value"><input class="cp-alpha-input" data-cp-alpha-input type="number" min="0" max="100" aria-label="Прозрачность"><span>%</span></div>
    </div>
    <div class="cp-swatches" data-cp-swatches>
      ${SWATCHES.map((color) => `<button type="button" class="cp-swatch" data-cp-swatch="${color}" style="background:${color}" aria-label="${color}"></button>`).join("")}
      <button type="button" class="cp-swatch cp-swatch-clear" data-cp-clear title="Прозрачный" aria-label="Прозрачный"></button>
    </div>`;
  document.body.appendChild(root);
  bindEvents();
  return root;
}

function bindEvents() {
  const sv = root.querySelector("[data-cp-sv]");
  const hue = root.querySelector("[data-cp-hue]");
  const alpha = root.querySelector("[data-cp-alpha]");
  const hex = root.querySelector("[data-cp-hex]");
  const alphaInput = root.querySelector("[data-cp-alpha-input]");

  dragArea(sv, (x, y) => {
    const rect = sv.getBoundingClientRect();
    const s = clamp01(x / rect.width);
    const v = 1 - clamp01(y / rect.height);
    const hsv = rgbToHsv(current.r, current.g, current.b);
    const rgb = hsvToRgb(hsv.h, s, v);
    current = { ...rgb, a: current.a };
    commitColor(false, { transient: true });
  }, () => commitColor(false));

  dragArea(hue, (x) => {
    const rect = hue.getBoundingClientRect();
    const h = clamp01(x / rect.width) * 360;
    const hsv = rgbToHsv(current.r, current.g, current.b);
    const rgb = hsvToRgb(h, hsv.s, hsv.v);
    current = { ...rgb, a: current.a };
    commitColor(false, { transient: true });
  }, () => commitColor(false));

  dragArea(alpha, (x) => {
    const rect = alpha.getBoundingClientRect();
    current.a = clamp01(x / rect.width);
    commitColor(false, { transient: true });
  }, () => commitColor(false));

  hex.addEventListener("input", () => {
    const parsed = parseHex(hex.value);
    if (parsed) {
      current = parsed;
      // Во время набора — только предпросмотр; в историю попадает
      // финальное значение по change/blur.
      commitColor(false, { keepHex: true, transient: true });
    }
  });
  hex.addEventListener("change", () => commitColor(false, { keepHex: true }));
  hex.addEventListener("keydown", (event) => event.stopPropagation());

  alphaInput.addEventListener("input", () => {
    current.a = clamp01((Number(alphaInput.value) || 0) / 100);
    commitColor(false, { keepAlphaInput: true, transient: true });
  });
  alphaInput.addEventListener("change", () => commitColor(false, { keepAlphaInput: true }));
  alphaInput.addEventListener("keydown", (event) => event.stopPropagation());

  root.querySelector("[data-cp-swatches]").addEventListener("click", (event) => {
    const swatch = event.target.closest("[data-cp-swatch]");
    if (swatch) {
      current = hexToRgb(swatch.dataset.cpSwatch);
      current.a = 1;
      commitColor(true);
      return;
    }
    if (event.target.closest("[data-cp-clear]")) {
      apply("transparent");
      close();
    }
  });
}

function dragArea(element, handler, onEnd = null) {
  const run = (event) => {
    const rect = element.getBoundingClientRect();
    handler(event.clientX - rect.left, event.clientY - rect.top);
  };
  element.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    element.setPointerCapture(event.pointerId);
    run(event);
    const move = (moveEvent) => run(moveEvent);
    const up = () => {
      element.removeEventListener("pointermove", move);
      element.removeEventListener("pointerup", up);
      if (onEnd) onEnd();
    };
    element.addEventListener("pointermove", move);
    element.addEventListener("pointerup", up);
  });
}

function onDocumentPointerDown(event) {
  if (!root || root.hidden) return;
  if (root.contains(event.target)) return;
  if (event.target.closest("[data-color-open]")) return;
  close();
}

export function open(button) {
  ensureRoot();
  activeButton = button;
  previewDirty = false;
  const raw = button.dataset.scope && button.dataset.colorFor
    ? readCurrentValue(button)
    : button.dataset.cpSwatch || "#ffffff";
  const parsed = parseColor(raw) || { r: 255, g: 255, b: 255, a: 1 };
  current = parsed;
  root.hidden = false;
  render();
  place(root, button);
}

/** Прочитать значение поля, к которому привязан образец. */
function readCurrentValue(button) {
  const scope = button.dataset.scope;
  const key = button.dataset.colorFor;
  const text = [...document.querySelectorAll(`[data-${scope}="${key}"]`)].find((node) => node.type === "text");
  return text?.value || button.dataset.value || "#ffffff";
}

function place(node, button) {
  const rect = button.getBoundingClientRect();
  const pw = 244;
  const ph = node.offsetHeight || 300;
  let left = rect.left;
  let top = rect.bottom + 8;
  if (left + pw > window.innerWidth - 10) left = window.innerWidth - pw - 10;
  if (top + ph > window.innerHeight - 10) top = Math.max(10, rect.top - ph - 8);
  node.style.left = `${Math.max(10, left)}px`;
  node.style.top = `${top}px`;
}

function render(options = {}) {
  const sv = root.querySelector("[data-cp-sv]");
  const knob = root.querySelector("[data-cp-knob]");
  const hue = root.querySelector("[data-cp-hue]");
  const hueKnob = root.querySelector("[data-cp-hue-knob]");
  const alpha = root.querySelector("[data-cp-alpha]");
  const alphaKnob = root.querySelector("[data-cp-alpha-knob]");
  const alphaFill = root.querySelector("[data-cp-alpha-fill]");
  const preview = root.querySelector("[data-cp-preview]");
  const hex = root.querySelector("[data-cp-hex]");
  const alphaInput = root.querySelector("[data-cp-alpha-input]");

  const hsv = rgbToHsv(current.r, current.g, current.b);
  const solid = hsvToRgb(hsv.h, 1, 1);
  sv.style.background =
    `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, rgb(${solid.r},${solid.g},${solid.b}))`;
  knob.style.left = `${hsv.s * 100}%`;
  knob.style.top = `${(1 - hsv.v) * 100}%`;
  knob.style.background = `rgb(${current.r},${current.g},${current.b})`;

  hue.style.background = "linear-gradient(to right,#f00,#ff0,#0f0,#0ff,#00f,#f0f,#f00)";
  hueKnob.style.left = `${(hsv.h / 360) * 100}%`;

  alpha.style.setProperty("--cp-alpha", `rgb(${current.r},${current.g},${current.b})`);
  alphaFill.style.background = `linear-gradient(to right, transparent, rgb(${current.r},${current.g},${current.b}))`;
  alphaKnob.style.left = `${current.a * 100}%`;

  preview.style.background = rgbaCss(current);
  if (!options.keepHex) hex.value = hexString(current, current.a < 1);
  if (!options.keepAlphaInput) alphaInput.value = Math.round(current.a * 100);
}

function commitColor(final, options = {}) {
  render(options);
  apply(rgbaCss(current, { preferHex: final }), { transient: Boolean(options.transient) });
  if (final) close();
}

function apply(value, { transient = false } = {}) {
  if (activeButton && onPick) onPick(activeButton, value, { transient });
  previewDirty = transient;
}

function close() {
  if (previewDirty && activeButton && onPick) {
    // Если палитру закрыли кликом снаружи/Escape, незакоммиченный
    // предпросмотр фиксируем, иначе значение осталось бы без истории.
    onPick(activeButton, rgbaCss(current, { preferHex: false }), { transient: false });
  }
  previewDirty = false;
  if (root) root.hidden = true;
  activeButton = null;
}

// ------------------------------------------------------------------ Цветовые утилиты
function clamp01(v) {
  return Math.min(1, Math.max(0, v));
}

export function hexToRgb(hex) {
  const parsed = parseHex(hex);
  return parsed ? { r: parsed.r, g: parsed.g, b: parsed.b } : { r: 255, g: 255, b: 255 };
}

export function parseHex(value) {
  let text = String(value || "").trim().replace(/^#/, "");
  if (text.length === 3) text = text.split("").map((c) => c + c).join("");
  if (!/^[0-9a-f]{6}([0-9a-f]{2})?$/i.test(text)) return null;
  return {
    r: parseInt(text.slice(0, 2), 16),
    g: parseInt(text.slice(2, 4), 16),
    b: parseInt(text.slice(4, 6), 16),
    a: text.length === 8 ? parseInt(text.slice(6, 8), 16) / 255 : 1,
  };
}

/** Парсит hex или rgb()/rgba(); возвращает null для «transparent» и пустых. */
export function parseColor(value) {
  const text = String(value || "").trim().toLowerCase();
  const named = {
    white: "#ffffff",
    black: "#000000",
    red: "#ff0000",
    green: "#008000",
    blue: "#0000ff",
    gray: "#808080",
    grey: "#808080",
  };
  if (named[text]) return parseHex(named[text]);
  if (!text || text === "transparent") return null;
  if (text.startsWith("#")) return parseHex(text);
  const match = text.match(/^rgba?\(([^)]+)\)$/);
  if (match) {
    const parts = match[1].split(",").map((p) => parseFloat(p.trim()));
    if (parts.length >= 3) {
      return {
        r: Math.round(parts[0]),
        g: Math.round(parts[1]),
        b: Math.round(parts[2]),
        a: parts.length > 3 ? clamp01(parts[3]) : 1,
      };
    }
  }
  return null;
}

function toHex(n) {
  return Math.round(Math.min(255, Math.max(0, n))).toString(16).padStart(2, "0");
}

function hexString(color, withAlpha) {
  const base = `${toHex(color.r)}${toHex(color.g)}${toHex(color.b)}`;
  return withAlpha ? `${base}${toHex(color.a * 255)}` : base;
}

function rgbaCss(color, { preferHex = true } = {}) {
  if (color.a >= 0.999) return preferHex ? `#${hexString(color, false)}` : `rgb(${color.r}, ${color.g}, ${color.b})`;
  return `rgba(${color.r}, ${color.g}, ${color.b}, ${Math.round(color.a * 100) / 100})`;
}

function rgbToHsv(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  const s = max === 0 ? 0 : d / max;
  return { h, s, v: max };
}

function hsvToRgb(h, s, v) {
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  let r = 0, g = 0, b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return {
    r: Math.round((r + m) * 255),
    g: Math.round((g + m) * 255),
    b: Math.round((b + m) * 255),
  };
}
