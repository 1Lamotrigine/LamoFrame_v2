/** Левая панель: страницы проекта. */

import {
  addPage,
  deletePage,
  duplicatePage,
  editingDevice,
  getPages,
  on,
  pageDeviceFrames,
  state,
  switchPage,
  updatePage,
} from "./state.js";
import { fitToView } from "./canvas.js";
import { icon, toast } from "./toast.js";

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[char]);
}

export function initPages() {
  on("pages", renderPages);
  on("doc", ({ transient, source } = {}) => {
    if (!transient && source !== "page") renderPages();
  });

  const list = document.getElementById("pagesList");
  list?.addEventListener("click", onClick);
  list?.addEventListener("dblclick", onDoubleClick);
  document.getElementById("addPageBtn")?.addEventListener("click", () => {
    const page = addPage();
    if (page) toast(`Страница «${page.name}» создана`, { type: "success" });
  });

  renderPages();
}

export function renderPages() {
  const list = document.getElementById("pagesList");
  if (!list) return;
  const pages = getPages();
  const count = document.getElementById("pagesCount");
  if (count) count.textContent = pages.length > 1 ? String(pages.length) : "";

  // Показываем число фреймов того макета, который сейчас редактируется:
  // в ручном режиме у планшета и смартфона свои списки фреймов.
  const device = editingDevice();
  list.innerHTML = pages
    .map((page, index) => {
      const frames = page.id === state.doc?.activePageId
        ? (state.doc?.frames || []).filter((frame) => frame.role !== "header" && frame.role !== "footer")
        : pageDeviceFrames(page, device);
      return `
        <div class="page-card${page.id === state.doc?.activePageId ? " is-active" : ""}" data-page-card="${page.id}">
          <span class="page-index">${String(index + 1).padStart(2, "0")}</span>
          <div class="page-card-text">
            <strong class="page-name" title="Нажмите на карандаш или дважды кликните, чтобы переименовать">${escapeHtml(page.name)}</strong>
            <span class="muted">${frames.length} фрейм. · /${escapeHtml(page.slug)}</span>
          </div>
          <button class="btn btn-icon" type="button" data-rename-page title="Переименовать страницу" aria-label="Переименовать страницу">
            ${icon("pencil")}
          </button>
          <button class="btn btn-icon" type="button" data-duplicate-page title="Дублировать страницу" aria-label="Дублировать страницу">
            ${icon("copy")}
          </button>
          <button class="btn btn-icon danger-hover" type="button" data-delete-page title="Удалить страницу" aria-label="Удалить страницу" ${pages.length <= 1 ? "disabled" : ""}>
            ${icon("trash")}
          </button>
        </div>`;
    })
    .join("");
}

function onClick(event) {
  const card = event.target.closest("[data-page-card]");
  if (!card) return;
  const pageId = card.dataset.pageCard;
  if (event.target.closest("[data-rename-page]")) {
    beginRename(pageId);
    return;
  }
  if (event.target.closest("[data-duplicate-page]")) {
    const page = duplicatePage(pageId);
    if (page) toast(`Страница «${page.name}» создана`, { type: "success" });
    return;
  }
  if (event.target.closest("[data-delete-page]")) {
    if (deletePage(pageId)) toast("Страница удалена", { type: "info" });
    else toast("Нельзя удалить единственную страницу", { type: "error" });
    return;
  }
  if (pageId === state.doc?.activePageId) return;
  if (switchPage(pageId)) {
    requestAnimationFrame(() => fitToView());
  }
}

function onDoubleClick(event) {
  const name = event.target.closest(".page-name");
  const card = event.target.closest("[data-page-card]");
  if (!name || !card) return;
  beginRename(card.dataset.pageCard);
}

/** Инлайн-переименование страницы: меняется название, slug остаётся прежним. */
function beginRename(pageId) {
  const card = document.querySelector(`[data-page-card="${pageId}"]`);
  const page = getPages().find((item) => item.id === pageId);
  const name = card?.querySelector(".page-name");
  if (!page || !name) return;
  const input = document.createElement("input");
  input.className = "page-rename";
  input.value = page.name || "";
  input.maxLength = 80;
  name.replaceWith(input);
  input.focus();
  input.select();
  let done = false;
  const finish = (save) => {
    if (done) return;
    done = true;
    const value = input.value.trim();
    if (save && value && value !== page.name) {
      // Переименование меняет только название; slug (имя файла при экспорте)
      // остаётся прежним, чтобы не ломать ссылки на страницы.
      updatePage(page.id, { name: value.slice(0, 80) });
      toast("Страница переименована", { type: "success", duration: 1400 });
    } else {
      renderPages();
    }
  };
  input.addEventListener("blur", () => finish(true), { once: true });
  input.addEventListener("keydown", (keyEvent) => {
    if (keyEvent.key === "Enter") input.blur();
    if (keyEvent.key === "Escape") {
      done = true;
      renderPages();
    }
    keyEvent.stopPropagation();
  });
}
