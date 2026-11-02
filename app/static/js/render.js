/**
 * Единый рендерер документа: холст редактора, превью и экспорт.
 * Никакой другой модуль не собирает HTML страницы.
 */

const FONTS = {
  system: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif",
  inter: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif",
  serif: "Georgia, 'Times New Roman', serif",
  mono: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
};

export function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function attr(value) {
  return escapeHtml(value);
}

function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/**
 * Вернуть список фреймов документа, приводя старую схему «секций» к фреймам.
 * Нужно, чтобы дашборд, превью и экспорт умели читать и старые документы.
 */
export function normalizeFrames(doc) {
  if (Array.isArray(doc?.frames)) return doc.frames;
  const sections = Array.isArray(doc?.sections) ? doc.sections : [];
  const width = Math.max(320, num(doc?.settings?.width, 1200));
  let y = 0;
  return sections.map((section, index) => {
    const h = Math.max(40, num(section.height, 560));
    const frame = {
      id: section.id || `f_${index}`,
      name: section.name || `Фрейм ${index + 1}`,
      x: 0,
      y,
      w: width,
      h,
      bg: section.bg || "#ffffff",
      radius: 0,
      elements: Array.isArray(section.elements) ? section.elements : [],
    };
    y += h;
    return frame;
  });
}

/** CSS-значение из пользовательского ввода без возможности закрыть правило. */
function css(value, fallback = "") {
  if (value === undefined || value === null) return fallback;
  return String(value)
    .replace(/[;{}]/g, "")
    .replace(/[\r\n"]/g, " ")
    .replace(/'/g, "")
    .trim() || fallback;
}

function safeUrl(url, fallback = "") {
  const value = String(url || "").trim();
  if (!value) return fallback;
  if (/^(https?:|mailto:|tel:|data:image\/|#|\/|\.\.?\/)/i.test(value)) return value;
  return fallback;
}

export function fontStack(name) {
  return FONTS[name] || FONTS.system;
}

export function elementTypeLabel(type) {
  return {
    text: "Текст",
    heading: "Заголовок",
    button: "Кнопка",
    link: "Ссылка",
    image: "Изображение",
    shape: "Фигура",
    line: "Линия",
    embed: "Встраивание",
  }[type] || "Элемент";
}

export function emptyStateFor(type) {
  return {
    text: "Дважды кликните, чтобы править текст",
    heading: "Дважды кликните, чтобы править заголовок",
    button: "Текст кнопки",
    link: "Текст ссылки",
    image: "Изображение",
    shape: "",
    line: "",
    embed: "",
  }[type] || "";
}

function wrapperStyle(el, order = null) {
  const style = el.style || {};
  const w = Math.max(1, num(el.w, 100));
  const h = Math.max(1, num(el.h, 100));
  return [
    `position:absolute`,
    `left:${num(el.x)}px`,
    `top:${num(el.y)}px`,
    `width:${w}px`,
    `height:${h}px`,
    `z-index:${num(el.z, 1)}`,
    `transform:rotate(${num(el.rotation)}deg)`,
    `opacity:${clamp(style.opacity, 0, 1, 1)}`,
    `--sb-order:${order === null ? Math.round(num(el.z, 1)) : order}`,
    `--sb-ratio:${(w / h).toFixed(4)}`,
    el.hidden ? "display:none" : "",
  ]
    .filter(Boolean)
    .join(";");
}

function typography(style) {
  return [
    `font-family:${fontStack(style.fontFamily)}`,
    `font-size:${clamp(style.fontSize, 6, 240, 16)}px`,
    `font-weight:${clamp(style.fontWeight, 100, 900, 400)}`,
    `line-height:${clamp(style.lineHeight, 0.6, 3, 1.4)}`,
    `letter-spacing:${clamp(style.letterSpacing, -10, 40, 0)}px`,
    `text-align:${["left", "center", "right", "justify"].includes(style.textAlign) ? style.textAlign : "left"}`,
    `color:${css(style.color, "#18181b")}`,
    style.fontStyle === "italic" ? "font-style:italic" : "",
    style.textDecoration === "underline" ? "text-decoration:underline" : "",
    style.textTransform ? `text-transform:${css(style.textTransform)}` : "",
  ]
    .filter(Boolean)
    .join(";");
}

function boxStyle(style) {
  return [
    `background:${css(style.fill, "transparent")}`,
    `border-radius:${clamp(style.borderRadius, 0, 999, 0)}px`,
    `border:${clamp(style.borderWidth, 0, 40, 0)}px solid ${css(style.borderColor, "transparent")}`,
    style.boxShadow ? `box-shadow:${css(style.boxShadow)}` : "",
  ]
    .filter(Boolean)
    .join(";");
}

function resolveHref(href, ctx) {
  const value = String(href || "").trim();
  if (!value) return "";
  if (value.startsWith("page:")) {
    const id = value.slice(5);
    if (ctx?.pageHrefs?.has(id)) return ctx.pageHrefs.get(id);
    const slug = ctx?.pageSlugs?.get(id);
    return slug ? `#page-${slug}` : "#";
  }
  // Внутренние якоря (#about) оставляем как есть — скрипт страниц их не
  // перехватывает, а браузер сам прокрутит к элементу с таким id.
  if (value.startsWith("#")) return safeAnchor(value);
  return safeUrl(value, "");
}

function safeAnchor(value) {
  const name = value.slice(1);
  if (!/^[A-Za-z0-9_-]+$/.test(name)) return "";
  if (name.startsWith("page-")) return "";
  return `#${name}`;
}

function targetAttrs(el, ctx, fallback = "_self") {
  if (ctx?.editor) return "";
  const raw = el.props?.target;
  const target = raw === "_blank" || raw === "_self" ? raw : fallback;
  if (target !== "_blank") return "";
  return ' target="_blank" rel="noopener"';
}

function textContent(el) {
  const text = el.props?.text ?? "";
  return escapeHtml(text).replace(/\n/g, "<br>");
}

function renderText(el, editor, ctx) {
  const tag = el.type === "heading" ? `h${Math.round(clamp(el.props?.level, 1, 3, 2))}` : "div";
  const placeholder = !String(el.props?.text || "").trim() && editor ? "sb-placeholder" : "";
  const overflow = el.style?.overflow === "visible" ? "visible" : "hidden";
  const justify = { top: "flex-start", middle: "center", bottom: "flex-end" }[el.style?.verticalAlign] || "flex-start";
  const vAlignCss = `display:flex;flex-direction:column;justify-content:${justify};`;
  const inner = `<${tag} class="sb-text ${placeholder}" style="${typography(el.style || {})};${vAlignCss}margin:0;width:100%;height:100%;overflow:${overflow};white-space:pre-wrap;overflow-wrap:break-word;">${textContent(el) || (editor ? "Текст" : "")}</${tag}>`;
  const href = resolveHref(el.props?.href, ctx);
  if (!href || editor) return inner;
  return `<a class="sb-text-link" href="${attr(href)}"${targetAttrs(el, ctx, "_self")} style="display:block;width:100%;height:100%;text-decoration:none;color:inherit;">${inner}</a>`;
}

function renderButton(el, editor, ctx) {
  const href = resolveHref(el.props?.href, ctx);
  const tag = href ? "a" : "span";
  const style = [
    "display:flex",
    "align-items:center",
    "justify-content:center",
    "width:100%",
    "height:100%",
    "padding:0 12px",
    "text-align:center",
    "text-decoration:none",
    "box-sizing:border-box",
    "cursor:pointer",
    "overflow:hidden",
    typography(el.style || {}),
    boxStyle(el.style || {}),
  ].join(";");
  const hrefAttr = href ? ` href="${attr(href)}"${targetAttrs(el, ctx, "_self")}` : "";
  return `<${tag} class="sb-button"${hrefAttr} style="${style}">${escapeHtml(el.props?.text || "Кнопка")}</${tag}>`;
}

function renderLink(el, editor, ctx) {
  const href = resolveHref(el.props?.href, ctx);
  const style = [
    "display:flex",
    "align-items:center",
    "width:100%",
    "height:100%",
    "text-decoration:underline",
    "cursor:pointer",
    "overflow:hidden",
    typography(el.style || {}),
  ].join(";");
  const hrefAttr = href ? ` href="${attr(href)}"${targetAttrs(el, ctx, "_blank")}` : "";
  const tag = href ? "a" : "span";
  return `<${tag} class="sb-link"${hrefAttr} style="${style}">${textContent(el) || (editor ? "Ссылка" : "")}</${tag}>`;
}

function renderImage(el, editor, ctx) {
  const originalSrc = safeUrl(el.props?.src, "");
  const src = (originalSrc && ctx?.imageMap?.get(originalSrc)) || originalSrc;
  if (!src) {
    return `<div class="sb-image-empty" style="width:100%;height:100%;display:grid;place-items:center;background:${editor ? "#f4f4f5" : "transparent"};border-radius:${clamp(el.style?.borderRadius, 0, 999, 0)}px;color:#a1a1aa;font-size:12px;">${editor ? "Выберите изображение" : ""}</div>`;
  }
  return `<img class="sb-image" src="${attr(src)}" alt="${attr(el.props?.alt || el.name || "")}" draggable="false" style="width:100%;height:100%;object-fit:${["cover", "contain", "fill"].includes(el.style?.objectFit) ? el.style.objectFit : "cover"};border-radius:${clamp(el.style?.borderRadius, 0, 999, 0)}px;display:block;">`;
}

function renderShape(el) {
  const isEllipse = el.props?.shape === "ellipse";
  const style = [
    "width:100%",
    "height:100%",
    boxStyle(el.style || {}),
    isEllipse ? "border-radius:50%" : "",
  ]
    .filter(Boolean)
    .join(";");
  return `<div class="sb-shape" style="${style}"></div>`;
}

function renderLine(el) {
  const thickness = clamp(el.style?.strokeWidth, 1, 40, 2);
  const style = [
    "width:100%",
    `height:${thickness}px`,
    "position:absolute",
    "top:50%",
    "transform:translateY(-50%)",
    `background:${css(el.style?.fill, "#18181b")}`,
    `border-radius:${clamp(el.style?.borderRadius, 0, 999, 0)}px`,
  ].join(";");
  return `<div class="sb-line" style="${style}"></div>`;
}

function renderEmbed(el, editor) {
  const src = safeUrl(el.props?.src, "");
  if (!src) {
    return `<div class="sb-embed-empty" style="width:100%;height:100%;display:grid;place-items:center;background:${editor ? "#f4f4f5" : "transparent"};border-radius:8px;color:#a1a1aa;font-size:12px;">${editor ? "Укажите ссылку на встраиваемый контент" : ""}</div>`;
  }
  return `<iframe class="sb-embed-frame" src="${attr(src)}" title="${attr(el.name || "Встраивание")}" style="width:100%;height:100%;border:0;border-radius:${clamp(el.style?.borderRadius, 0, 999, 0)}px;" loading="lazy" sandbox="allow-scripts allow-popups"></iframe>`;
}

function renderElement(el, editor, ctx, order = null, frameWidth = 0) {
  let inner = "";
  switch (el.type) {
    case "heading":
    case "text":
      inner = renderText(el, editor, ctx);
      break;
    case "button":
      inner = renderButton(el, editor, ctx);
      break;
    case "link":
      inner = renderLink(el, editor, ctx);
      break;
    case "image":
      inner = renderImage(el, editor, ctx);
      break;
    case "shape":
      inner = renderShape(el);
      break;
    case "line":
      inner = renderLine(el);
      break;
    case "embed":
      inner = renderEmbed(el, editor);
      break;
    default:
      inner = "";
  }
  const dataAttrs = editor
    ? ` data-id="${attr(el.id)}" data-type="${attr(el.type)}"${el.locked ? ' data-locked="1"' : ""}`
    : "";
  const animation = el.props?.appear && el.props.appear !== "none" ? ` data-appear="${attr(el.props.appear)}"` : "";
  // Пользовательские якоря: id на обёртке, чтобы ссылки #anchor работали.
  const anchorName = String(el.props?.anchor || "").trim();
  const anchorAttr = !editor && /^[A-Za-z][A-Za-z0-9_-]*$/.test(anchorName) && !anchorName.startsWith("page-")
    ? ` id="${attr(anchorName)}"`
    : "";
  // Метаданные для адаптивного слоя на узких экранах (см. REFLOW_TABLET).
  const responsive =
    ` data-x="${Math.round(num(el.x))}"` +
    ` data-y="${Math.round(num(el.y))}"` +
    ` data-w="${Math.round(Math.max(1, num(el.w, 100)))}"` +
    ` data-h="${Math.round(Math.max(1, num(el.h, 100)))}"` +
    ` data-order="${num(el.z, 1)}"`;
  const centered =
    frameWidth > 0 &&
    Math.abs(num(el.x) + Math.max(1, num(el.w, 1)) / 2 - frameWidth / 2) <= frameWidth * 0.04;
  const selfAlign = centered ? "center" : "flex-start";
  return `<div class="sb-el sb-el-${attr(el.type)}${el.locked ? " is-locked" : ""}"${anchorAttr} style="${wrapperStyle(el, order)};--sb-self:${selfAlign}"${dataAttrs}${responsive}${animation}>${inner}</div>`;
}

/** Все страницы документа в едином виде (поддержка старых схем). */
export function docPages(doc) {
  if (Array.isArray(doc?.pages) && doc.pages.length) {
    return doc.pages.map((page, index) => ({
      id: page.id || `p_${index}`,
      name: page.name || `Страница ${index + 1}`,
      slug: page.slug || `page-${index + 1}`,
      // Для страниц всегда берём сохранённый десктопный макет. Рантайм-кадры
      // (doc.frames) принадлежат текущему устройству редактора и не должны
      // подменять десктопную версию в экспорте/превью. Если сохранённого
      // макета нет (старый документ) — используем doc.frames как запасной.
      frames:
        (Array.isArray(page.frames) && page.frames.length
          ? page.frames
          : (page.id === doc.activePageId && Array.isArray(doc.frames)
            ? doc.frames
            : page.frames || []))
          .filter((frame) => frame.role !== "header" && frame.role !== "footer"),
      deviceFrames: page.devices || null,
    }));
  }
  return [{ id: "index", name: "Главная", slug: "index", frames: normalizeFrames(doc), deviceFrames: null }];
}

/** Контентные фреймы страницы для устройства. */
export function pageFramesForDevice(page, device) {
  if (device === "desktop") return page?.frames || [];
  return page?.deviceFrames?.[device]?.frames || [];
}

export function docComponents(doc, device = "desktop") {
  const components = doc?.components || {};
  const frames = Array.isArray(doc?.frames) ? doc.frames : [];
  const fallback = {
    header: components.header || frames.find((frame) => frame.role === "header") || null,
    footer: components.footer || frames.find((frame) => frame.role === "footer") || null,
  };
  if (device === "desktop") return fallback;
  const deviceComponents = components.devices?.[device] || {};
  // Старые документы могли не иметь device-компонентов: лучше показать
  // десктопную шапку/подвал, чем потерять их на планшете и телефоне.
  return {
    header: deviceComponents.header || fallback.header,
    footer: deviceComponents.footer || fallback.footer,
  };
}

export function isManualResponsive(doc) {
  return doc?.settings?.responsive?.auto === false;
}

export function deviceLayoutWidth(doc, device) {
  if (device === "desktop") return Math.max(320, num(doc?.settings?.width, 1200));
  return { tablet: 768, phone: 390 }[device] || 1200;
}

function contentFrames(doc) {
  const pages = docPages(doc);
  const page = pages.find((item) => item.id === doc?.activePageId) || pages[0];
  return page?.frames || [];
}

function isInside(frame, parent) {
  return (
    num(frame.x) >= num(parent.x) - 1 &&
    num(frame.y) >= num(parent.y) - 1 &&
    num(frame.x) + num(frame.w) <= num(parent.x) + num(parent.w) + 1 &&
    num(frame.y) + num(frame.h) <= num(parent.y) + num(parent.h) + 1
  );
}

/**
 * Собрать дерево вложенности по геометрии: фрейм, целиком лежащий внутри
 * другого, считается его дочерним. Родителем выбирается самый маленький
 * содержащий фрейм.
 */
export function buildFrameTree(frames) {
  const items = sortByPosition(frames).map((frame) => ({ frame, children: [], parent: null }));
  for (const item of items) {
    let best = null;
    let bestArea = Infinity;
    const ownArea = Math.max(1, num(item.frame.w) * num(item.frame.h));
    for (const other of items) {
      if (other === item) continue;
      if (!isInside(item.frame, other.frame)) continue;
      const area = Math.max(1, num(other.frame.w) * num(other.frame.h));
      if (area <= ownArea) continue;
      if (area < bestArea) {
        best = other;
        bestArea = area;
      }
    }
    item.parent = best;
  }
  const roots = [];
  for (const item of items) {
    if (item.parent) item.parent.children.push(item);
    else roots.push(item);
  }
  return { roots, items };
}

function sortByPosition(frames) {
  return [...(frames || [])].sort((a, b) => {
    const ay = num(a.y);
    const by = num(b.y);
    const rowTolerance = 8;
    if (Math.abs(ay - by) > rowTolerance) return ay - by;
    return num(a.x) - num(b.x);
  });
}

/**
 * Визуальный порядок элементов: сверху вниз, при близких Y — слева направо.
 * Используется в мобильной перестройке: колонка должна идти «как читается»,
 * а не в порядке z-index, который зависит от того, как элемент добавляли.
 */
function visualOrderMap(elements) {
  const list = [...(elements || [])].sort((a, b) => {
    const ay = num(a.y);
    const by = num(b.y);
    if (Math.abs(ay - by) > 24) return ay - by;
    return num(a.x) - num(b.x);
  });
  const map = new Map();
  list.forEach((el, index) => map.set(el.id, index + 1));
  return map;
}

function renderElements(frame, editor, ctx) {
  if (editor) {
    const order = visualOrderMap(frame.elements);
    return [...(frame.elements || [])]
      .sort((a, b) => num(a.z, 1) - num(b.z, 1))
      .map((el) => renderElement(el, editor, ctx, order.get(el.id) ?? num(el.z, 1), num(frame.w, 0)))
      .join("");
  }
  return renderElementBlocks(frame, ctx);
}

/** Прямоугольник inner целиком лежит внутри outer (±допуск). */
function rectContains(outer, inner, tol = 1) {
  const ox = num(outer.x);
  const oy = num(outer.y);
  const ow = Math.max(1, num(outer.w, 0));
  const oh = Math.max(1, num(outer.h, 0));
  const ix = num(inner.x);
  const iy = num(inner.y);
  const iw = Math.max(1, num(inner.w, 0));
  const ih = Math.max(1, num(inner.h, 0));
  return ix >= ox - tol && iy >= oy - tol && ix + iw <= ox + ow + tol && iy + ih <= oy + oh + tol;
}

/** Порядок чтения: сверху вниз, при близких Y — слева направо. */
function readingSort(a, b) {
  const ay = num(a.y);
  const by = num(b.y);
  if (Math.abs(ay - by) > 24) return ay - by;
  return num(a.x) - num(b.x);
}

/**
 * Разбить элементы на смысловые блоки для рефлоу.
 *
 * Фоновая фигура, целиком содержащая содержимое (карточка услуги и т.п.),
 * становится контейнером: её фон и дети переезжают в рефлоу вместе, а не
 * разваливаются на отдельные строки (иначе номера всех карточек шли бы
 * подряд, а заголовки — отдельной группой).
 *
 * В обычном (масштабируемом) режиме обёртка .sb-card имеет display:contents,
 * поэтому абсолютное позиционирование и вид макета не меняются.
 */
function elementBlocks(frame) {
  const elements = [...(frame.elements || [])];
  const frameArea = Math.max(1, num(frame.w, 1200) * num(frame.h, 800));
  const containers = elements
    .filter((el) => {
      if (el.type !== "shape") return false;
      const area = Math.max(1, num(el.w, 0) * num(el.h, 0));
      if (area > frameArea * 0.55) return false;
      return elements.some((other) => other !== el && other.type !== "shape" && rectContains(el, other));
    })
    .sort((a, b) => num(a.w) * num(a.h) - num(b.w) * num(b.h));

  const groups = containers.map((shape) => ({ shape, children: [] }));
  const inGroup = new Set(containers);
  for (const el of elements) {
    if (el.type === "shape") continue;
    const group = groups.find((item) => rectContains(item.shape, el));
    if (group) {
      group.children.push(el);
      inGroup.add(el);
    }
  }

  const blocks = [];
  for (const group of groups) {
    if (!group.children.length) {
      inGroup.delete(group.shape);
      continue;
    }
    const els = [group.shape, ...group.children].sort(readingSort);
    blocks.push({ anchor: group.shape, els, group });
  }
  for (const el of elements) {
    if (inGroup.has(el)) continue;
    blocks.push({ anchor: el, els: [el], group: null });
  }

  blocks.sort((a, b) => {
    const ay = num(a.anchor.y);
    const by = num(b.anchor.y);
    if (Math.abs(ay - by) > 24) return ay - by;
    return num(a.anchor.x) - num(b.anchor.x);
  });
  return blocks;
}

/** Отрисовать элементы фрейма блоками в порядке чтения. */
function renderElementBlocks(frame, ctx) {
  const frameWidth = num(frame.w, 0);
  return elementBlocks(frame)
    .map((block) => {
      if (!block.group) {
        return block.els.map((el) => renderElement(el, false, ctx, null, frameWidth)).join("");
      }
      const inner = block.els.map((el) => renderElement(el, false, ctx, null, frameWidth)).join("");
      return `<div class="sb-card">${inner}</div>`;
    })
    .join("");
}

function renderNestedFrame(item, parent, ctx) {
  const frame = item.frame;
  const bg = css(frame.bg, "#ffffff");
  const radius = clamp(frame.radius, 0, 999, 0);
  const width = Math.max(1, Math.round(num(frame.w, 100)));
  const height = Math.max(1, Math.round(num(frame.h, 100)));
  const left = Math.round(num(frame.x) - num(parent.x));
  const top = Math.round(num(frame.y) - num(parent.y));
  const pos =
    `position:absolute;left:${left}px;top:${top}px;width:${width}px;height:${height}px;` +
    `background:${bg};border-radius:${radius}px;overflow:hidden;`;
  const inner = renderElements(frame, false, ctx);
  const children = item.children.map((child) => renderNestedFrame(child, frame, ctx)).join("");
  return `<div class="sb-nested" data-frame-id="${attr(frame.id)}" style="${pos}">${inner}${children}</div>`;
}

function renderSectionFrame(item, index, ctx) {
  const frame = item.frame;
  const bg = css(frame.bg, "#ffffff");
  const radius = clamp(frame.radius, 0, 999, 0);
  const height = Math.max(40, num(frame.h, 400));
  const inner = renderElements(frame, false, ctx);
  const children = item.children.map((child) => renderNestedFrame(child, frame, ctx)).join("");
  return `<section class="sb-section" id="section-${attr(frame.id)}" data-frame-id="${attr(frame.id)}" data-index="${index}" style="background:${bg};--sb-h:${height};${radius ? `border-radius:${radius}px;` : ""}"><div class="sb-canvas">${inner}${children}</div></section>`;
}

export function renderFrame(frame, editor = false, index = 0, ctx = {}) {
  const bg = css(frame.bg, "#ffffff");
  const radius = clamp(frame.radius, 0, 999, 0);
  const height = Math.max(40, num(frame.h, 400));
  const dataAttrs = editor ? ` data-frame-id="${attr(frame.id)}" data-index="${index}"` : "";
  const elements = renderElements(frame, editor, ctx);
  if (editor) {
    // Редактор: фрейм — свободно позиционированный артборд, элементы внутри
    // абсолютны и привязаны к его левому верхнему углу.
    const pos =
      `position:absolute;left:${Math.round(num(frame.x))}px;top:${Math.round(num(frame.y))}px;` +
      `width:${Math.max(1, Math.round(num(frame.w, 600)))}px;height:${height}px;` +
      `background:${bg};border-radius:${radius}px;overflow:hidden;`;
    return `<div class="sb-frame" id="frame-${attr(frame.id)}" style="${pos}"${dataAttrs}>${elements}</div>`;
  }
  // Превью/экспорт: фрейм становится секцией во всю ширину окна, внутри —
  // «канвас» шириной макета, который масштабируется коэффициентом --sb-k.
  const roleClass = frame.role === "footer" ? " sb-footer" : frame.role === "header" ? " sb-header" : "";
  return `<section class="sb-section${roleClass}" id="section-${attr(frame.id)}" style="background:${bg};--sb-h:${height};${radius ? `border-radius:${radius}px;` : ""}"${dataAttrs}><div class="sb-canvas">${elements}</div></section>`;
}

export function renderSections(doc, { editor = false } = {}) {
  return (doc?.frames || []).map((frame, i) => renderFrame(frame, editor, i)).join("");
}

/**
 * Фреймы для экспорта/превью: порядок идёт «как на холсте» — сверху вниз
 * по Y, а при одинаковой высоте — слева направо по X. Фреймы без элементов
 * не экспортируем: пустой фрейм дал бы пустую полосу на готовом сайте.
 *
 * Важно: в редакторе порядок НЕ трогаем (см. renderSections) — иначе панель
 * фреймов и слои самопроизвольно переставлялись бы.
 */
export function exportFrames(doc) {
  return sortByPosition(contentFrames(doc)).filter(
    (frame) => Array.isArray(frame.elements) && frame.elements.length > 0,
  );
}

/** Прямоугольник, охватывающий все фреймы (для размера рабочей области). */
export function framesBounds(doc) {
  const frames = doc?.frames || [];
  if (!frames.length) return { x: 0, y: 0, w: 0, h: 0 };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const frame of frames) {
    minX = Math.min(minX, num(frame.x));
    minY = Math.min(minY, num(frame.y));
    maxX = Math.max(maxX, num(frame.x) + num(frame.w));
    maxY = Math.max(maxY, num(frame.y) + num(frame.h));
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

const BASE_CSS = `
*,*::before,*::after{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0}
.sb-site h1,.sb-site h2,.sb-site h3,.sb-site p{margin:0}
.sb-site{line-height:1.4;-webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility}
.sb-section{position:relative;overflow:hidden}
.sb-el{box-sizing:border-box}
.sb-text{white-space:pre-wrap;overflow-wrap:break-word;word-break:break-word}
.sb-button{text-decoration:none}
.sb-image{display:block}
.sb-placeholder{color:#a1a1aa}
.sb-viewport{width:100%;overflow:hidden}
.sb-site{position:relative;transform-origin:top left;margin:0 auto;overflow:hidden}
.sb-page[hidden]{display:none!important}
.sb-nested{box-sizing:border-box}
/* Подвал всегда прижат к низу окна: если контента меньше экрана, флекс
   растягивает блок страниц, а .sb-footer прижимается через margin-top:auto.
   Если контента больше экрана — подвал просто идёт следом за секциями. */
html,body{min-height:100%}
.sb-viewport{display:flex;flex-direction:column;min-height:100vh;min-height:100dvh}
.sb-site{display:flex;flex-direction:column;min-height:100vh;min-height:100dvh;flex:1 1 auto}
.sb-pages{display:flex;flex-direction:column;flex:1 0 auto}
.sb-footer{margin-top:auto}
@media (prefers-reduced-motion: reduce){[data-appear]{opacity:1!important;transform:none!important;transition:none!important}}
`;

/**
 * Адаптивный слой для превью, публичной страницы и экспорта.
 *
 * Модель. Каждая секция занимает всю ширину окна, поэтому фон никогда не
 * обрезается белыми полосами. Элементы живут в «канвасе» шириной макета
 * (--sb-w) и масштабируются коэффициентом --sb-k = ширина_окна / ширина_макета
 * (см. SCALE_SCRIPT).
 *
 * На планшете (≤1023.98px) и телефоне (≤767.98px) масштаб выключается и
 * канвас превращается в вертикальный поток: элементы переносятся друг под
 * друга, текст и объекты меняют размер через clamp() — это настоящий рефлоу,
 * а не сжатие всей страницы. Ниже телефона включаются свои, более компактные
 * значения (см. REFLOW_PHONE).
 *
 * В ручном режиме («Авто» выключено) перестройки нет: на каждое устройство
 * рендерится свой макет, а нужный показывается медиазапросами (MANUAL_MEDIA_CSS).
 */
const AUTO_REFLOW_WIDTH = 1023.98;
const AUTO_PHONE_WIDTH = 767.98;

/**
 * Ширина, ниже которой макет перестраивается в колонку (0 — не перестраивать).
 * В авторежиме — фиксированный мобильный breakpoint; в ручном режиме
 * перестройки нет: устройство выбирается через .sb-device (см. MANUAL_MEDIA_CSS).
 */
export function responsiveBreakpoint(doc) {
  return isManualResponsive(doc) ? 0 : AUTO_REFLOW_WIDTH;
}

/** CSS автоадаптива: масштабирование + рефлоу на планшете и телефоне. */
function responsiveCss(reflowAt) {
  const head = LAYOUT_CSS;
  const tabletAt = Number(reflowAt) || AUTO_REFLOW_WIDTH;
  if (!tabletAt || tabletAt <= 0) return head;
  return (
    `${head}` +
    `\n@media (max-width: ${tabletAt}px){\n${REFLOW_TABLET}\n}` +
    `\n@media (max-width: ${AUTO_PHONE_WIDTH}px){\n${REFLOW_PHONE}\n}`
  );
}

/**
 * Планшетный рефлоу (по умолчанию до 1023.98px). Канвас перестаёт быть
 * масштабированной копией макета: секции получают высоту по контенту, а
 * элементы выстраиваются в поток и переносятся в колонку. Ширина текста
 * ограничена, размеры задаются через clamp() — они меняются вместе с экраном.
 */
const REFLOW_TABLET = `
  .sb-viewport{overflow:visible}
  .sb-section{
    height:auto!important;
    overflow:visible;
  }
  .sb-canvas{
    width:100%!important;
    height:auto!important;
    max-width:760px;
    margin:0 auto;
    transform:none!important;
    display:flex;
    flex-direction:column;
    gap:22px;
    align-items:stretch;
    padding:46px 32px 52px;
    box-sizing:border-box;
  }
  .sb-el{
    position:static!important;
    left:auto!important;
    top:auto!important;
    right:auto!important;
    bottom:auto!important;
    width:100%!important;
    height:auto!important;
    max-width:100%;
    transform:none!important;
    opacity:1!important;
  }
  /* Карточка: фон-фигура тянется на весь блок, содержимое идёт потоком. */
  .sb-card{
    position:relative;
    display:flex;
    flex-direction:column;
    gap:10px;
    padding:26px 24px;
    border-radius:16px;
    overflow:hidden;
    box-sizing:border-box;
  }
  .sb-card > .sb-el-shape{
    display:block!important;
    position:absolute!important;
    left:0!important;
    top:0!important;
    right:0!important;
    bottom:0!important;
    width:100%!important;
    height:100%!important;
    transform:none!important;
    z-index:0!important;
  }
  .sb-card > .sb-el:not(.sb-el-shape){
    position:relative!important;
    z-index:1;
    width:100%!important;
    height:auto!important;
    margin:0;
  }
  .sb-el-heading,
  .sb-el-text{width:100%!important}
  .sb-el-heading .sb-text,
  .sb-el-text .sb-text{
    height:auto!important;
    width:100%!important;
    overflow:visible!important;
    min-height:1em;
  }
  .sb-el-heading .sb-text{font-size:clamp(34px,5vw,54px)!important;line-height:1.12!important}
  .sb-el-text .sb-text{font-size:clamp(16px,2.4vw,20px)!important;line-height:1.6!important}
  .sb-el-button{align-self:var(--sb-self,flex-start);width:auto!important;max-width:100%!important}
  .sb-el-button .sb-button{
    height:auto!important;
    width:auto!important;
    min-height:52px;
    padding:15px 30px!important;
    font-size:clamp(16px,2.2vw,18px)!important;
  }
  .sb-el-image{align-self:stretch}
  .sb-el-image .sb-image,
  .sb-el-image .sb-image-empty{
    height:auto!important;
    width:100%!important;
    aspect-ratio:var(--sb-ratio,16/10);
  }
  .sb-el-embed{align-self:stretch}
  .sb-el-embed iframe,
  .sb-el-embed .sb-embed-empty{
    height:auto!important;
    width:100%!important;
    aspect-ratio:16/9;
  }
  /* Декоративные фигуры не участвуют в потоке: иначе круги и фоны
     встают между заголовком и текстом. В рефлоу они только мешают. */
  .sb-el-shape{display:none!important}
  .sb-el-line{align-self:stretch;flex:none;min-height:2px}
  .sb-el-line .sb-line{
    position:static!important;
    transform:none!important;
    width:100%!important;
    height:2px!important;
    margin:8px 0;
  }
  .sb-nested{
    position:relative!important;
    left:auto!important;
    top:auto!important;
    width:100%!important;
    height:auto!important;
    overflow:visible!important;
    padding:20px 18px;
    margin:8px 0;
    border-radius:16px;
    order:99;
  }
  .sb-nested > .sb-el{
    position:static!important;
    width:100%!important;
    height:auto!important;
    margin:10px 0;
  }
`;

/**
 * Телефонные значения поверх планшетного рефлоу (≤767.98px): уже поля,
 * меньше отступы и компактнее типографика. Применяются после REFLOW_TABLET,
 * поэтому переопределяют только то, что нужно.
 */
const REFLOW_PHONE = `
  .sb-canvas{
    max-width:none;
    gap:16px;
    padding:34px 20px 38px;
  }
  .sb-el-heading .sb-text{font-size:clamp(28px,8vw,44px)!important}
  .sb-el-text .sb-text{font-size:clamp(16px,4.4vw,19px)!important}
  .sb-el-button .sb-button{
    min-height:50px;
    padding:14px 26px!important;
    font-size:clamp(15px,4.2vw,17px)!important;
  }
  .sb-nested{padding:18px 16px;margin:10px 0;border-radius:14px}
`;

const SCALE_SCRIPT = `
(function(){
  var viewports=[].slice.call(document.querySelectorAll('.sb-viewport'));
  if(!viewports.length)return;
  var REFLOW=__REFLOW__;
  var MAX_DESIGN=1680;
  function layoutOne(viewport){
    if(!viewport.getClientRects().length)return;
    var design=Number(viewport.getAttribute('data-design-width'))||1200;
    var vw=document.documentElement.clientWidth;
    if(!vw)return;
    if(REFLOW>0&&matchMedia('(max-width: '+REFLOW+'px)').matches){
      viewport.style.removeProperty('--sb-k');
      viewport.style.removeProperty('--sb-offset');
      return;
    }
    // Не округляем коэффициент до сотых: иначе масштабированный канвас
    // (design * k) перестаёт совпадать с шириной окна и обрезается справа,
    // из-за чего макет визуально «съезжает» с центра. Округляем вниз до
    // 1e-6 — канвас никогда не превысит окно, а отступы слева/справа равны.
    var k=Math.floor((Math.min(vw,MAX_DESIGN)/design)*1e6)/1e6;
    var offset=Math.max(0,(vw-design*k)/2);
    viewport.style.setProperty('--sb-k',String(k));
    viewport.style.setProperty('--sb-offset',(Math.round(offset*1000)/1000)+'px');
  }
  function layout(){viewports.forEach(layoutOne);}
  window.addEventListener('resize',layout,{passive:true});
  window.addEventListener('orientationchange',layout,{passive:true});
  layout();
  if(document.fonts&&document.fonts.ready){document.fonts.ready.then(layout);}
  if(window.ResizeObserver){new ResizeObserver(layout).observe(document.documentElement);}
})();
`;

/** Скрипт масштабирования с реальным breakpoint выбранного режима. */
function scaleScript(reflowAt) {
  return SCALE_SCRIPT.replace("__REFLOW__", String(Math.max(0, Number(reflowAt) || 0)));
}

/** Базовая раскладка секций/канваса — нужна и в авто-, и в ручном режиме. */
const LAYOUT_CSS = `
.sb-viewport{background:var(--sb-body-bg,#ffffff);overflow-x:clip}
.sb-site{width:100%!important;max-width:none;background:transparent!important}
.sb-section{
  position:relative;
  width:100%;
  overflow:hidden;
  height:calc(var(--sb-h) * 1px * var(--sb-k,1));
}
.sb-canvas{
  position:relative;
  width:var(--sb-w,1200px);
  height:calc(var(--sb-h) * 1px);
  transform-origin:top left;
  transform:translateX(var(--sb-offset,0px)) scale(var(--sb-k,1));
  will-change:transform;
}
/* Группа «карточка» в обычном режиме не создаёт бокс — элементы остаются
   абсолютно позиционированными относительно канваса. В рефлоу становится
   flex-контейнером (см. REFLOW_TABLET). */
.sb-card{display:contents}
`;

/** Ручной режим: показываем макет нужного устройства по ширине окна. */
const MANUAL_MEDIA_CSS = `
.sb-device{display:none}
@media (min-width:1024px){.sb-device-desktop{display:block}}
@media (min-width:768px) and (max-width:1023.98px){.sb-device-tablet{display:block}}
@media (max-width:767.98px){.sb-device-phone{display:block}}
`;

const APPEAR_SCRIPT = `
(function(){
  var items=document.querySelectorAll('[data-appear]');
  if(!items.length)return;
  var reduce=window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if(reduce){items.forEach(function(el){el.style.opacity='1';el.style.transform='none';});return;}
  items.forEach(function(el){
    var kind=el.getAttribute('data-appear');
    el.style.opacity='0';
    el.style.transition='opacity .55s ease, transform .55s cubic-bezier(.22,1,.36,1)';
    el.style.transform=(kind==='up'?'translateY(28px)':kind==='left'?'translateX(-32px)':kind==='right'?'translateX(32px)':kind==='zoom'?'scale(.94)':'none');
  });
  var io=new IntersectionObserver(function(entries){
    entries.forEach(function(entry){
      if(entry.isIntersecting){
        var el=entry.target;
        el.style.opacity='1';
        el.style.transform='none';
        io.unobserve(el);
      }
    });
  },{threshold:.12});
  items.forEach(function(el){io.observe(el);});
})();
`;

const PAGES_SCRIPT = `
(function(){
  var pages=[].slice.call(document.querySelectorAll('.sb-page'));
  if(pages.length<2)return;
  function current(){
    var hash=location.hash.replace(/^#/,'');
    return hash.indexOf('page-')===0?hash.slice(5):'';
  }
  function show(slug){
    if(!slug)return;
    var found=false;
    pages.forEach(function(page){
      var on=page.getAttribute('data-page')===slug;
      if(on)found=true;
      page.hidden=!on;
      page.classList.toggle('is-active',on);
    });
    // Неизвестный hash (например, внутренний якорь #features) не должен
    // сбрасывать пользователя на первую страницу.
    if(!found)return;
    var active=pages.filter(function(page){return !page.hidden;})[0];
    if(active&&active.getAttribute('data-title'))document.title=active.getAttribute('data-title');
    window.scrollTo(0,0);
  }
  window.addEventListener('hashchange',function(){show(current());});
  show(current());
})();
`;

export function renderDocument(doc, options = {}) {
  const { inlineImages = new Map(), editor = false, scripts = true } = options;
  const settings = doc?.settings || {};
  const meta = doc?.meta || {};
  const width = Math.max(320, num(settings.width, 1200));
  const bodyBg = css(settings.bg, "#ffffff");
  const pages = docPages(doc);
  const pageSlugs = new Map(pages.map((page) => [page.id, page.slug]));
  const ctx = { editor, pageSlugs, pageIds: new Map(pages.map((page) => [page.slug, page.id])) };
  const manual = !editor && isManualResponsive(doc);

  const allFrames = [];
  for (const page of pages) {
    allFrames.push(...pageFramesForDevice(page, "desktop"));
    if (manual) {
      allFrames.push(...pageFramesForDevice(page, "tablet"));
      allFrames.push(...pageFramesForDevice(page, "phone"));
    }
  }
  for (const device of manual ? ["desktop", "tablet", "phone"] : ["desktop"]) {
    const { header, footer } = docComponents(doc, device);
    if (header) allFrames.push(header);
    if (footer) allFrames.push(footer);
  }
  const hasAppear = allFrames.some((frame) =>
    (frame.elements || []).some((el) => el.props?.appear && el.props.appear !== "none"),
  );
  const multiPage = pages.length > 1;

  let pageHtml = "";
  let styleExtra = "";

  if (manual) {
    // Ручной режим: для каждой страницы рендерим отдельный макет под каждое
    // устройство, показываем нужный через медиазапросы (см. MANUAL_MEDIA_CSS).
    let sectionIndex = 0;
    pageHtml = pages
      .map((page) => {
        const devicesHtml = ["desktop", "tablet", "phone"]
          .map((device) => {
            const deviceWidth = deviceLayoutWidth(doc, device);
            const frames = fallbackDeviceFrames(doc, page, device);
            const tree = buildFrameTree(frames || []);
            const sections = tree.roots
              .map((item) => (hasTreeContent(item) ? renderSectionFrame(item, sectionIndex++, ctx) : ""))
              .join("");
            const { header, footer } = docComponents(doc, device);
            const head = header && frameHasContent(header) ? renderFrame(header, false, 0, ctx) : "";
            const foot = footer && frameHasContent(footer) ? renderFrame(footer, false, 0, ctx) : "";
            return `<div class="sb-device sb-device-${attr(device)}"><div class="sb-viewport" style="--sb-w:${deviceWidth}px" data-design-width="${deviceWidth}"><main class="sb-site" data-width="${deviceWidth}">${head}${sections}${foot}</main></div></div>`;
          })
          .join("");
        const hidden = pages.indexOf(page) === 0 ? "" : " hidden";
        return `<div class="sb-page" id="page-${attr(page.slug)}" data-page="${attr(page.slug)}" data-title="${attr(meta.title || "Сайт")}${page.name && pages.length > 1 ? ` — ${attr(page.name)}` : ""}"${hidden}>${devicesHtml}</div>`;
      })
      .join("");
    styleExtra = `${LAYOUT_CSS}${MANUAL_MEDIA_CSS}`;
  } else {
    let pageIndex = 0;
    pageHtml = pages
      .map((page) => {
        const tree = buildFrameTree(page.frames || []);
        const sections = tree.roots
          .map((item) => (hasTreeContent(item) ? renderSectionFrame(item, pageIndex++, ctx) : ""))
          .join("");
        const hidden = pages.indexOf(page) === 0 ? "" : " hidden";
        return `<div class="sb-page" id="page-${attr(page.slug)}" data-page="${attr(page.slug)}" data-title="${attr(meta.title || "Сайт")}${page.name && pages.length > 1 ? ` — ${attr(page.name)}` : ""}"${hidden}>${sections}</div>`;
      })
      .join("");
    styleExtra = editor ? "" : responsiveCss(responsiveBreakpoint(doc));
  }

  const { header, footer } = docComponents(doc, "desktop");
  const siteWrap = manual
    ? `<div class="sb-pages">${pageHtml}</div>`
    : `<div class="sb-viewport" style="--sb-w:${width}px" data-design-width="${width}"><main class="sb-site" data-width="${width}">${header && frameHasContent(header) ? renderFrame(header, false, 0, ctx) : ""}<div class="sb-pages">${pageHtml}</div>${footer && frameHasContent(footer) ? renderFrame(footer, false, 0, ctx) : ""}</main></div>`;

  const reflowAt = manual ? 0 : responsiveBreakpoint(doc);

  let html = `<!doctype html>
<html lang="${attr(meta.lang || "ru")}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(meta.title || "Сайт")}</title>
<meta name="description" content="${attr(meta.description || "")}">
<style>${BASE_CSS}
body{background:${bodyBg};}
:root{--sb-body-bg:${bodyBg};}
.sb-site{width:${width}px;background:${bodyBg};}
${styleExtra}
</style>
</head>
<body>
${siteWrap}
${scripts ? `<script>${scaleScript(reflowAt)}</script>` : ""}
${scripts && hasAppear ? `<script>${APPEAR_SCRIPT}</script>` : ""}
${scripts && multiPage ? `<script>${PAGES_SCRIPT}</script>` : ""}
</body>
</html>`;
  if (inlineImages.size) {
    for (const [url, dataUri] of inlineImages) {
      if (!url || !dataUri) continue;
      html = html.split(`src="${attr(url)}"`).join(`src="${dataUri}"`);
    }
  }
  return html;
}

/**
 * Фреймы для устройства. Если ручной макет ещё не создан в документе,
 * клонируем базовый десктопный макет с пропорциональным масштабом — ровно
 * так же, как это делает `ensureDeviceLayouts` в state.js, чтобы экспорт
 * и редактор совпадали.
 */
function fallbackDeviceFrames(doc, page, device) {
  if (device === "desktop") return page?.frames || [];
  const explicit = page?.deviceFrames?.[device]?.frames;
  if (explicit && explicit.length) return explicit;
  return scaleFrames(page?.frames || [], deviceLayoutWidth(doc, "desktop"), deviceLayoutWidth(doc, device));
}

const RENDER_SCALED_STYLE_KEYS = ["fontSize", "borderRadius", "borderWidth", "strokeWidth", "letterSpacing"];

function scaleFrames(frames, fromWidth, toWidth) {
  const ratio = fromWidth > 0 ? toWidth / fromWidth : 1;
  return (frames || []).map((frame) => {
    const copy = JSON.parse(JSON.stringify(frame));
    copy.x = Math.round(num(copy.x) * ratio);
    copy.y = Math.round(num(copy.y) * ratio);
    copy.w = Math.max(1, Math.round(num(copy.w) * ratio));
    copy.h = Math.max(1, Math.round(num(copy.h) * ratio));
    copy.radius = Math.max(0, Math.round(num(copy.radius) * ratio));
    delete copy.role;
    copy.elements = (copy.elements || []).map((el) => {
      const scaled = { ...el };
      scaled.x = Math.round(num(scaled.x) * ratio);
      scaled.y = Math.round(num(scaled.y) * ratio);
      scaled.w = Math.max(1, Math.round(num(scaled.w) * ratio));
      scaled.h = Math.max(1, Math.round(num(scaled.h) * ratio));
      if (scaled.style && typeof scaled.style === "object") {
        scaled.style = { ...scaled.style };
        for (const key of RENDER_SCALED_STYLE_KEYS) {
          if (scaled.style[key] !== undefined && scaled.style[key] !== null) {
            scaled.style[key] = Math.round(Number(scaled.style[key]) * ratio * 100) / 100;
          }
        }
      }
      return scaled;
    });
    return copy;
  });
}

/** Общий CSS для многофайлового экспорта (assets/css/style.css). */
export function buildStylesheet(doc) {
  const settings = doc?.settings || {};
  const width = Math.max(320, num(settings.width, 1200));
  const bodyBg = css(settings.bg, "#ffffff");
  const adaptive = isManualResponsive(doc)
    ? `${LAYOUT_CSS}${MANUAL_MEDIA_CSS}`
    : responsiveCss(responsiveBreakpoint(doc));
  return `${BASE_CSS}
body{background:${bodyBg};}
:root{--sb-body-bg:${bodyBg};}
.sb-site{width:${width}px;background:${bodyBg};}
${adaptive}`;
}

/** Общий JS для многофайлового экспорта (assets/js/main.js). */
export function buildMainScript(doc) {
  const reflowAt = isManualResponsive(doc) ? 0 : responsiveBreakpoint(doc);
  return `${scaleScript(reflowAt)}\n${APPEAR_SCRIPT}`;
}

/**
 * HTML одной страницы для многофайлового экспорта.
 * Ссылки на страницы уже преобразованы в имена файлов через pageHrefs.
 */
export function renderBundlePage(doc, page, { pageHrefs = new Map(), imageMap = new Map() } = {}) {
  const settings = doc?.settings || {};
  const meta = doc?.meta || {};
  const width = Math.max(320, num(settings.width, 1200));
  const pages = docPages(doc);
  const manual = isManualResponsive(doc);
  const pageSlugs = new Map(pages.map((item) => [item.id, item.slug]));
  const ctx = { pageHrefs, pageSlugs, imageMap };
  const pageTitle = page?.name && pages.length > 1
    ? `${page.name} — ${meta.title || "Сайт"}`
    : (meta.title || "Сайт");
  const normalized = { ...page, deviceFrames: page?.deviceFrames || null };

  let body;
  if (manual) {
    let index = 0;
    const devicesHtml = ["desktop", "tablet", "phone"]
      .map((device) => {
        const deviceWidth = deviceLayoutWidth(doc, device);
        const frames = fallbackDeviceFrames(doc, normalized, device);
        const tree = buildFrameTree(frames || []);
        const sections = tree.roots
          .map((item) => (hasTreeContent(item) ? renderSectionFrame(item, index++, ctx) : ""))
          .join("");
        const { header, footer } = docComponents(doc, device);
        const head = header && frameHasContent(header) ? renderFrame(header, false, 0, ctx) : "";
        const foot = footer && frameHasContent(footer) ? renderFrame(footer, false, 0, ctx) : "";
        return `<div class="sb-device sb-device-${attr(device)}"><div class="sb-viewport" style="--sb-w:${deviceWidth}px" data-design-width="${deviceWidth}"><main class="sb-site" data-width="${deviceWidth}">${head}${sections}${foot}</main></div></div>`;
      })
      .join("");
    body = `<div class="sb-pages">${devicesHtml}</div>`;
  } else {
    const { header, footer } = docComponents(doc, "desktop");
    const tree = buildFrameTree(page?.frames || []);
    let index = 0;
    const sections = tree.roots
      .map((item) => (hasTreeContent(item) ? renderSectionFrame(item, index++, ctx) : ""))
      .join("");
    const headerHtml = header && frameHasContent(header) ? renderFrame(header, false, 0, ctx) : "";
    const footerHtml = footer && frameHasContent(footer) ? renderFrame(footer, false, 0, ctx) : "";
    body = `<div class="sb-viewport" style="--sb-w:${width}px" data-design-width="${width}"><main class="sb-site" data-width="${width}">${headerHtml}${sections}${footerHtml}</main></div>`;
  }

  return `<!doctype html>
<html lang="${attr(meta.lang || "ru")}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(pageTitle)}</title>
<meta name="description" content="${attr(meta.description || "")}">
<link rel="stylesheet" href="assets/css/style.css">
</head>
<body>
${body}
<script src="assets/js/main.js"></script>
</body>
</html>`;
}

function frameHasContent(frame) {
  if (!frame) return false;
  if ((frame.elements || []).length) return true;
  return false;
}

function hasTreeContent(item) {
  if (frameHasContent(item.frame)) return true;
  return item.children.some((child) => hasTreeContent(child));
}

function allDocumentFrames(doc) {
  const frames = [];
  for (const page of docPages(doc)) {
    frames.push(...(page.frames || []));
    if (isManualResponsive(doc)) {
      for (const device of ["tablet", "phone"]) {
        frames.push(...fallbackDeviceFrames(doc, page, device));
      }
    }
  }
  for (const device of isManualResponsive(doc) ? ["desktop", "tablet", "phone"] : ["desktop"]) {
    const { header, footer } = docComponents(doc, device);
    if (header) frames.push(header);
    if (footer) frames.push(footer);
  }
  return frames;
}

/** Собрать автономный HTML: все изображения становятся data URI. */
export async function renderStandalone(doc) {
  const urls = new Set();
  for (const frame of allDocumentFrames(doc)) {
    for (const el of frame.elements || []) {
      if (el.type === "image" && el.props?.src && !String(el.props.src).startsWith("data:")) {
        urls.add(el.props.src);
      }
    }
  }
  const inlineImages = new Map();
  await Promise.all(
    [...urls].map(async (url) => {
      try {
        const response = await fetch(url, { credentials: "same-origin" });
        if (!response.ok) return;
        const blob = await response.blob();
        const dataUri = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result);
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        });
        inlineImages.set(url, dataUri);
      } catch (error) {
        // Офлайн-экспорт не должен падать из-за одной картинки.
      }
    }),
  );
  return { html: renderDocument(doc, { inlineImages }), inlineImages };
}

export function collectImageUrls(doc) {
  const urls = new Set();
  for (const frame of allDocumentFrames(doc)) {
    for (const el of frame.elements || []) {
      if (el.type === "image" && el.props?.src && !String(el.props.src).startsWith("data:")) {
        urls.add(el.props.src);
      }
    }
  }
  return [...urls];
}
