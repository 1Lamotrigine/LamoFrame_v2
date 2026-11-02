/** Дашборд: живые миниатюры проектов и действия с карточками. */

import { renderDocument } from "./render.js";
import { csrfToken } from "./api.js";
import { toast } from "./toast.js";

const payloadNode = document.getElementById("projects-data");
const payload = payloadNode ? JSON.parse(payloadNode.textContent) : {};

for (const card of document.querySelectorAll(".project-card")) {
  const id = card.dataset.projectId;
  const doc = payload[id];
  const iframe = card.querySelector(".project-frame");
  const empty = card.querySelector(".project-empty-preview");
  if (!doc || !iframe) continue;
  const page = doc.pages?.find((item) => item.id === doc.activePageId) || doc.pages?.[0];
  const blocks = page?.frames || doc.frames || doc.sections || [];
  const elementCount = blocks.reduce((sum, block) => sum + (block.elements?.length || 0), 0);
  if (!elementCount) {
    iframe.remove();
    if (empty) empty.hidden = false;
    continue;
  }
  try {
    iframe.srcdoc = renderDocument(doc, { scripts: false });
    iframe.addEventListener("load", () => {
      // Высота — только видимой первой страницы (а не сумма всех страниц,
      // которые скрыты и давали огромный пустой блок под превью).
      const total = Math.max(
        600,
        ...blocks.map((block) => (Number(block.y) || 0) + (Number(block.height || block.h) || 0)),
      );
      const designWidth = Number(doc.settings?.width) || 1200;
      iframe.style.height = `${total}px`;
      iframe.style.transform = `scale(${card.querySelector(".project-frame-wrap").clientWidth / designWidth})`;
      iframe.classList.add("is-ready");
    }, { once: true });
  } catch (error) {
    console.error(error);
    iframe.remove();
    if (empty) empty.hidden = false;
  }
}

// Тема
const themeButton = document.querySelector("[data-theme-toggle]");
themeButton?.addEventListener("click", () => {
  const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = next;
  try {
    localStorage.setItem("sb-theme", next);
  } catch (error) {
    /* ignore */
  }
});

async function postAction(id, action) {
  const response = await fetch(`/projects/${id}/${action}/`, {
    method: "POST",
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
      "X-CSRFToken": csrfToken(),
    },
    body: "{}",
  });
  if (!response.ok) throw new Error(`Ошибка ${response.status}`);
  return response;
}

document.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-action]");
  if (!button) return;
  const id = button.dataset.id;
  const action = button.dataset.action;
  if (action === "delete") {
    const title = button.dataset.title || "проект";
    if (!confirm(`Удалить «${title}»? Действие необратимо.`)) return;
    button.disabled = true;
    try {
      await postAction(id, "delete");
      const card = button.closest(".project-card");
      card?.animate([{ opacity: 1, transform: "none" }, { opacity: 0, transform: "scale(.98)" }], {
        duration: 160,
        easing: "ease",
      });
      setTimeout(() => window.location.reload(), 160);
    } catch (error) {
      button.disabled = false;
      toast("Не удалось удалить проект", { type: "error" });
    }
    return;
  }
  if (action === "duplicate") {
    button.disabled = true;
    try {
      await postAction(id, "duplicate");
      window.location.reload();
    } catch (error) {
      button.disabled = false;
      toast("Не удалось дублировать проект", { type: "error" });
    }
  }
});
