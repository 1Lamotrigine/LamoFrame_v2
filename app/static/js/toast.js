/** Тосты: короткая обратная связь без блокировки интерфейса. */

export function icon(name, className = "icon") {
  const base = window.BUILDER?.iconsUrl || "";
  return `<svg class="${className}" aria-hidden="true"><use href="${base}#i-${name}"></use></svg>`;
}

export function toast(message, { type = "info", duration = 2600 } = {}) {
  const container = document.getElementById("toasts");
  if (!container) return;
  const node = document.createElement("div");
  node.className = `toast${type === "error" ? " is-error" : ""}${type === "success" ? " is-success" : ""}`;
  node.setAttribute("role", type === "error" ? "alert" : "status");
  node.innerHTML = `${icon(type === "error" ? "close" : type === "success" ? "check" : "sparkles")}<span></span>`;
  node.querySelector("span").textContent = message;
  container.appendChild(node);
  const remove = () => {
    node.classList.add("is-leaving");
    setTimeout(() => node.remove(), 180);
  };
  const timer = setTimeout(remove, duration);
  node.addEventListener("click", () => {
    clearTimeout(timer);
    remove();
  });
  return node;
}
