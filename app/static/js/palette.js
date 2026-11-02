/** Командная палитра (Ctrl/Cmd+K). */

import { icon } from "./toast.js";
import { state } from "./state.js";

let root = null;
let input = null;
let list = null;
let actions = [];
let filtered = [];
let index = 0;
let extra = {};

export function initPalette(options = {}) {
  extra = options;
  root = document.getElementById("commandPalette");
  if (!root) return;
  input = root.querySelector("#paletteInput");
  list = root.querySelector("#paletteList");
  input.addEventListener("input", applyFilter);
  input.addEventListener("keydown", onKeyDown);
  root.addEventListener("click", (event) => {
    if (event.target === root || event.target.closest("[data-close-palette]")) closePalette();
  });
  list.addEventListener("click", (event) => {
    const item = event.target.closest("[data-palette-index]");
    if (item) run(Number(item.dataset.paletteIndex));
  });
  list.addEventListener("mousemove", (event) => {
    const item = event.target.closest("[data-palette-index]");
    if (!item) return;
    index = Number(item.dataset.paletteIndex);
    paintActive();
  });
}

function buildActions() {
  const list_ = [
    { id: "add-text", group: "Добавить", title: "Добавить текст", icon: "type", keywords: "надпись text", run: () => extra.addElement?.("text") },
    { id: "add-heading", group: "Добавить", title: "Добавить заголовок", icon: "heading", keywords: "heading h1 h2", run: () => extra.addElement?.("heading") },
    { id: "add-button", group: "Добавить", title: "Добавить кнопку", icon: "button", keywords: "button cta", run: () => extra.addElement?.("button") },
    { id: "add-link", group: "Добавить", title: "Добавить ссылку", icon: "link", keywords: "ссылка link href", run: () => extra.addElement?.("link") },
    { id: "add-image", group: "Добавить", title: "Добавить изображение", icon: "image", keywords: "картинка фото image", run: () => extra.addElement?.("image") },
    { id: "add-shape", group: "Добавить", title: "Добавить фигуру", icon: "square", keywords: "shape круг квадрат", run: () => extra.addElement?.("shape") },
    { id: "add-line", group: "Добавить", title: "Добавить линию", icon: "line", keywords: "разделитель line", run: () => extra.addElement?.("line") },
    { id: "add-frame", group: "Добавить", title: "Добавить фрейм", icon: "frame", keywords: "фрейм frame артборд блок", run: () => extra.addFrame?.() },
    { id: "add-page", group: "Страницы", title: "Создать страницу", icon: "pages", keywords: "страница page новая", run: () => extra.addPage?.() },
    { id: "block-hero", group: "Блоки", title: "Вставить первый экран", icon: "monitor", keywords: "hero блок шаблон", run: () => extra.addBlock?.("hero") },
    { id: "block-features", group: "Блоки", title: "Вставить преимущества", icon: "grid", keywords: "features блок шаблон", run: () => extra.addBlock?.("features") },
    { id: "block-cta", group: "Блоки", title: "Вставить призыв к действию", icon: "button", keywords: "cta блок шаблон", run: () => extra.addBlock?.("cta") },
    { id: "block-gallery", group: "Блоки", title: "Вставить галерею", icon: "image", keywords: "gallery блок шаблон", run: () => extra.addBlock?.("gallery") },
    { id: "block-contact", group: "Блоки", title: "Вставить контакты", icon: "embed", keywords: "contact блок шаблон", run: () => extra.addBlock?.("contact") },
    { id: "save", group: "Проект", title: "Сохранить сейчас", icon: "check", shortcut: "⌘S", keywords: "save", run: () => extra.save?.() },
    { id: "preview", group: "Проект", title: "Открыть превью", icon: "play", shortcut: "P", keywords: "предпросмотр preview", run: () => extra.preview?.() },
    { id: "export", group: "Проект", title: "Скачать сайт (ZIP)", icon: "download", shortcut: "E", keywords: "экспорт export выгрузка скачать zip", run: () => extra.export?.() },
    { id: "presentation", group: "Вид", title: "Режим презентации", icon: "monitor", shortcut: "F", keywords: "presentation показ", run: () => extra.presentation?.() },
    { id: "fit", group: "Вид", title: "Вписать холст в окно", icon: "fit", shortcut: "⇧1", keywords: "fit зум", run: () => extra.fit?.() },
    { id: "zoom-in", group: "Вид", title: "Увеличить масштаб", icon: "zoom-in", shortcut: "⌘+", keywords: "zoom плюс", run: () => extra.zoomIn?.() },
    { id: "zoom-out", group: "Вид", title: "Уменьшить масштаб", icon: "zoom-out", shortcut: "⌘−", keywords: "zoom минус", run: () => extra.zoomOut?.() },
    { id: "theme", group: "Вид", title: state.theme === "dark" ? "Светлая тема редактора" : "Тёмная тема редактора", icon: state.theme === "dark" ? "sun" : "moon", keywords: "theme тема оформление", run: () => extra.theme?.() },
    { id: "undo", group: "Правка", title: "Отменить", icon: "undo", shortcut: "⌘Z", keywords: "undo назад", run: () => extra.undo?.() },
    { id: "redo", group: "Правка", title: "Повторить", icon: "redo", shortcut: "⇧⌘Z", keywords: "redo вперёд", run: () => extra.redo?.() },
    { id: "shortcuts", group: "Помощь", title: "Все горячие клавиши", icon: "keyboard", shortcut: "?", keywords: "shortcuts хоткеи", run: () => extra.shortcuts?.() },
  ];
  for (const frame of state.doc?.frames || []) {
    list_.push({
      id: `goto-${frame.id}`,
      group: "Фреймы",
      title: `Перейти к «${frame.name}»`,
      icon: "frame",
      run: () => extra.gotoFrame?.(frame.id),
    });
  }
  return list_;
}

export function openPalette() {
  if (!root) return;
  actions = buildActions();
  root.hidden = false;
  input.value = "";
  index = 0;
  applyFilter();
  requestAnimationFrame(() => input.focus());
}

export function closePalette() {
  if (root) root.hidden = true;
}

function applyFilter() {
  const query = input.value.trim().toLowerCase();
  const words = query.split(/\s+/).filter(Boolean);
  filtered = actions.filter((action) => {
    if (!words.length) return true;
    const haystack = `${action.group} ${action.title} ${action.keywords || ""} ${action.shortcut || ""}`.toLowerCase();
    return words.every((word) => haystack.includes(word));
  });
  index = 0;
  renderList();
}

function renderList() {
  if (!filtered.length) {
    list.innerHTML = `<div class="palette-empty">Ничего не найдено. Попробуйте «кнопка», «экспорт» или «фрейм».</div>`;
    return;
  }
  let lastGroup = "";
  list.innerHTML = filtered
    .map((action, i) => {
      const group = action.group !== lastGroup ? `<div class="palette-group">${action.group}</div>` : "";
      lastGroup = action.group;
      return `${group}
        <button class="palette-item${i === index ? " is-active" : ""}" type="button" data-palette-index="${i}">
          <span class="palette-icon">${icon(action.icon, "icon icon-sm")}</span>
          <span class="palette-title">${action.title}</span>
          ${action.shortcut ? `<span class="kbd">${action.shortcut}</span>` : ""}
        </button>`;
    })
    .join("");
}

function paintActive() {
  [...list.querySelectorAll("[data-palette-index]")].forEach((node) => {
    node.classList.toggle("is-active", Number(node.dataset.paletteIndex) === index);
  });
  list.querySelector(".palette-item.is-active")?.scrollIntoView({ block: "nearest" });
}

function onKeyDown(event) {
  if (event.key === "ArrowDown") {
    event.preventDefault();
    index = Math.min(filtered.length - 1, index + 1);
    paintActive();
  } else if (event.key === "ArrowUp") {
    event.preventDefault();
    index = Math.max(0, index - 1);
    paintActive();
  } else if (event.key === "Enter") {
    event.preventDefault();
    run(index);
  } else if (event.key === "Escape") {
    event.preventDefault();
    closePalette();
  }
  event.stopPropagation();
}

function run(i) {
  const action = filtered[i];
  if (!action) return;
  closePalette();
  action.run();
}
