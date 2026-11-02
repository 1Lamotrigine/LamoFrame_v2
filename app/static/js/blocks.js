/**
 * Готовые блоки и шаблоны элементов.
 *
 * Каждый блок — это фрейм с уже расставленными элементами: шапка, подвал,
 * первый экран, преимущества, призыв к действию, галерея и контакты.
 * Шапка и подвал создаются как общие компоненты: один объект на все страницы.
 */

import {
  activePage,
  addComponent,
  addFrame,
  commit,
  createElement,
  deviceComponents,
  deviceWidth,
  editingDevice,
  getFrame,
  getPages,
  setFrameSelection,
  state,
  syncRuntime,
} from "./state.js";
import { toast } from "./toast.js";

export const BLOCKS = [
  { id: "header", title: "Шапка сайта", hint: "Меню и логотип", icon: "layers", component: "header" },
  { id: "footer", title: "Подвал сайта", hint: "Контакты и ссылки", icon: "sections", component: "footer" },
  { id: "hero", title: "Первый экран", hint: "Заголовок и кнопка", icon: "monitor", h: 560 },
  { id: "features", title: "Преимущества", hint: "Три карточки", icon: "grid", h: 460 },
  { id: "about", title: "О компании", hint: "Текст и цифры", icon: "type", h: 380 },
  { id: "cta", title: "Призыв к действию", hint: "Яркий блок", icon: "button", h: 300 },
  { id: "gallery", title: "Галерея", hint: "Сетка изображений", icon: "image", h: 420 },
  { id: "contact", title: "Контакты", hint: "Форма-заглушка", icon: "embed", h: 380 },
];

const ACCENT = "#4F46E5";
const INK = "#18181B";
const MUTED = "#52525B";
const SOFT = "#F7F7F8";
const WHITE = "#FFFFFF";
const BORDER = "#E4E4E7";

function makeElement(frame, def) {
  const el = createElement(def.type, {
    frameId: frame.id,
    x: Number(def.x) || 0,
    y: Number(def.y) || 0,
    width: Number(def.w) || undefined,
  });
  el.name = def.name || el.name;
  el.x = Math.round(Number(def.x) || 0);
  el.y = Math.round(Number(def.y) || 0);
  if (def.w !== undefined) el.w = Math.max(1, Math.round(Number(def.w) || 1));
  if (def.h !== undefined) el.h = Math.max(1, Math.round(Number(def.h) || 1));
  if (def.z !== undefined) el.z = def.z;
  el.props = { ...el.props, ...(def.props || {}) };
  el.style = { ...el.style, ...(def.style || {}) };
  return el;
}

function fillFrame(frame, defs) {
  const elements = defs.map((def, index) => makeElement(frame, { ...def, z: index + 1 }));
  frame.elements = elements;
}

function heading(text, x, y, w, patch = {}) {
  return {
    type: "heading",
    x,
    y,
    w,
    h: patch.h || 72,
    name: patch.name || "Заголовок",
    props: { text, level: patch.level || 2 },
    style: { fontSize: patch.fontSize || 44, fontWeight: 700, lineHeight: 1.15, color: patch.color || INK, ...patch.style },
  };
}

function text(value, x, y, w, patch = {}) {
  return {
    type: "text",
    x,
    y,
    w,
    h: patch.h || 80,
    name: patch.name || "Текст",
    props: { text: value },
    style: { fontSize: patch.fontSize || 18, lineHeight: 1.6, color: patch.color || MUTED, ...patch.style },
  };
}

function button(label, x, y, w = 190, h = 52, patch = {}) {
  return {
    type: "button",
    x,
    y,
    w,
    h,
    name: patch.name || label,
    props: { text: label, href: patch.href || "#" },
    style: { fontSize: patch.fontSize || 16, fontWeight: 600, color: WHITE, fill: patch.fill || ACCENT, borderRadius: 10, textAlign: "center", ...patch.style },
  };
}

function link(label, x, y, w, href, patch = {}) {
  return {
    type: "link",
    x,
    y,
    w,
    h: patch.h || 36,
    name: label,
    props: { text: label, href, target: patch.target || "_self" },
    style: { fontSize: patch.fontSize || 15, fontWeight: 600, color: patch.color || MUTED, textDecoration: "none", textAlign: patch.textAlign || "left", ...patch.style },
  };
}

function shape(x, y, w, h, patch = {}) {
  return {
    type: "shape",
    x,
    y,
    w,
    h,
    name: patch.name || "Фигура",
    props: { shape: patch.shape || "rectangle" },
    style: { fill: patch.fill || SOFT, borderRadius: patch.radius ?? 16, borderWidth: patch.borderWidth ?? 0, borderColor: patch.borderColor || "transparent", ...patch.style },
  };
}

function line(x, y, w, patch = {}) {
  return {
    type: "line",
    x,
    y,
    w,
    h: patch.h || 2,
    name: patch.name || "Линия",
    props: {},
    style: { fill: patch.fill || BORDER, strokeWidth: patch.strokeWidth || 2, ...patch.style },
  };
}

function image(x, y, w, h, patch = {}) {
  return {
    type: "image",
    x,
    y,
    w,
    h,
    name: patch.name || "Изображение",
    props: { src: patch.src || "", alt: patch.alt || "" },
    style: { borderRadius: patch.radius ?? 14, objectFit: "cover", ...patch.style },
  };
}

function firstPageHref() {
  const pages = getPages();
  return pages.length ? `page:${pages[0].id}` : "#";
}

function headerDefs(width) {
  const pages = getPages();
  const nav = pages.slice(0, 4);
  const navWidth = 120;
  const navGap = 18;
  const navStart = Math.max(300, width - 48 - 176 - nav.length * (navWidth + navGap));
  const defs = [
    text("LAMOFRAME", 48, 30, 260, {
      name: "Логотип",
      h: 30,
      fontSize: 19,
      color: INK,
      style: { fontWeight: 800, letterSpacing: "0.06em", lineHeight: 1.2 },
    }),
  ];
  nav.forEach((page, index) => {
    defs.push(
      link(page.name, navStart + index * (navWidth + navGap), 29, navWidth, `page:${page.id}`, {
        fontSize: 14,
        color: MUTED,
        textAlign: "left",
      }),
    );
  });
  defs.push(button("Связаться", width - 48 - 168, 22, 168, 44, { fontSize: 14, name: "Кнопка в шапке", href: firstPageHref() }));
  defs.push(line(0, 87, width, { strokeWidth: 1, fill: BORDER }));
  return defs;
}

function footerDefs(width) {
  const pages = getPages();
  const defs = [
    text("LAMOFRAME", 48, 32, 300, {
      name: "Логотип в подвале",
      h: 30,
      fontSize: 20,
      color: WHITE,
      style: { fontWeight: 800, letterSpacing: "0.06em" },
    }),
    text("Собирайте страницы на свободном холсте и публикуйте готовый сайт.", 48, 78, 460, {
      name: "Описание",
      h: 52,
      fontSize: 14,
      color: "#A1A1AA",
    }),
  ];
  const nav = pages.slice(0, 4);
  nav.forEach((page, index) => {
    defs.push(
      link(page.name, width - 48 - 220, 38 + index * 30, 220, `page:${page.id}`, {
        fontSize: 14,
        color: "#D4D4D8",
        textAlign: "right",
        h: 26,
      }),
    );
  });
  defs.push(line(48, 146, width - 96, { strokeWidth: 1, fill: "#3F3F46" }));
  defs.push(text("© 2026 LamoFrame. Все права защищены.", 48, 158, 520, { name: "Копирайт", h: 24, fontSize: 12, color: "#71717A" }));
  return defs;
}

function heroDefs(width) {
  return [
    shape(width - 420, 96, 320, 320, { name: "Акцент", fill: ACCENT, radius: 40 }),
    shape(width - 356, 160, 190, 190, { name: "Акцент 2", fill: "#C7D2FE", radius: 30 }),
    heading("Соберите сайт\nза один вечер", 88, 128, Math.min(680, width - 520), {
      name: "Главный заголовок",
      level: 1,
      fontSize: 58,
      h: 170,
    }),
    text(
      "Свободный холст, готовые блоки и экспорт в готовый сайт. Без кода и лишних настроек.",
      88,
      316,
      Math.min(560, width - 520),
      { name: "Подзаголовок", h: 90, fontSize: 19, anchor: "features" },
    ),
    button("Начать бесплатно", 88, 432, 210, 56, { name: "Главная кнопка", fontSize: 16 }),
    link("Посмотреть возможности →", 318, 444, 240, "#features", { fontSize: 15, color: ACCENT, h: 32 }),
  ];
}

function featuresDefs(width) {
  const gap = 24;
  const cardW = Math.floor((width - 176 - gap * 2) / 3);
  const items = [
    ["Свободный холст", "Двигайте фреймы и элементы мышью, как в графическом редакторе."],
    ["Готовые блоки", "Шапка, подвал, первый экран и преимущества добавляются в один клик."],
    ["Готовый сайт", "Экспорт собирает страницы, стили и картинки в аккуратный ZIP."],
  ];
  const defs = [
    heading("Всё для быстрого старта", 88, 64, Math.min(720, width - 176), {
      name: "Заголовок блока",
      fontSize: 38,
      h: 60,
      style: { textAlign: "left" },
    }),
  ];
  items.forEach(([title, body], index) => {
    const x = 88 + index * (cardW + gap);
    defs.push(shape(x, 160, cardW, 220, { name: `Карточка ${index + 1}`, fill: SOFT, radius: 20 }));
    defs.push(
      heading(title, x + 28, 194, cardW - 56, {
        name: `Заголовок карточки ${index + 1}`,
        fontSize: 22,
        h: 56,
        style: { textAlign: "left" },
      }),
    );
    defs.push(
      text(body, x + 28, 264, cardW - 56, {
        name: `Текст карточки ${index + 1}`,
        h: 96,
        fontSize: 15,
        color: MUTED,
      }),
    );
  });
  return defs;
}

function aboutDefs(width) {
  return [
    heading("О компании", 88, 64, 500, { name: "Заголовок блока", fontSize: 38, h: 60 }),
    text(
      "Мы помогаем небольшим командам запускать сайты без разработчиков. Расскажите о себе, добавьте цифры и фотографии — всё настраивается на холсте.",
      88,
      148,
      Math.min(540, width - 176),
      { name: "Описание", h: 130, fontSize: 17 },
    ),
    shape(width - 468, 80, 380, 240, { name: "Фото", fill: "#EEF2FF", radius: 24 }),
    text("120+", width - 420, 140, 160, { name: "Цифра 1", h: 56, fontSize: 44, color: ACCENT, style: { fontWeight: 800 } }),
    text("проектов\nзапущено", width - 420, 200, 160, { name: "Подпись 1", h: 64, fontSize: 14, color: MUTED }),
    text("8 лет", width - 220, 140, 140, { name: "Цифра 2", h: 56, fontSize: 36, color: ACCENT, style: { fontWeight: 800 } }),
    text("на рынке", width - 220, 200, 140, { name: "Подпись 2", h: 30, fontSize: 14, color: MUTED }),
  ];
}

function ctaDefs(width) {
  return [
    shape(0, 0, width, 300, { name: "Фон", fill: ACCENT, radius: 0, anchor: "cta" }),
    heading("Готовы собрать свой сайт?", 88, 92, Math.min(680, width - 400), {
      name: "Заголовок призыва",
      fontSize: 40,
      color: WHITE,
      h: 70,
    }),
    text("Начните с бесплатного шаблона — результат будет готов через несколько минут.", 88, 176, Math.min(560, width - 400), {
      name: "Текст призыва",
      h: 60,
      fontSize: 17,
      color: "#E0E7FF",
    }),
    button("Создать сайт", width - 320, 122, 220, 56, { name: "Кнопка призыва", fill: WHITE, style: { color: ACCENT, fontWeight: 700 } }),
  ];
}

function galleryDefs(width) {
  const gap = 16;
  const cell = Math.floor((width - 176 - gap * 2) / 3);
  const defs = [
    heading("Галерея", 88, 48, 500, { name: "Заголовок блока", fontSize: 34, h: 56 }),
  ];
  for (let i = 0; i < 6; i += 1) {
    const col = i % 3;
    const row = Math.floor(i / 3);
    defs.push(
      image(88 + col * (cell + gap), 128 + row * (cell * 0.62 + gap), cell, Math.round(cell * 0.62), {
        name: `Фото ${i + 1}`,
        radius: 14,
        style: { objectFit: "cover" },
      }),
    );
  }
  return defs;
}

function contactDefs(width) {
  const formX = width - 468;
  return [
    heading("Свяжитесь с нами", 88, 64, 520, { name: "Заголовок блока", fontSize: 38, h: 60 }),
    text("Оставьте заявку — ответим в течение рабочего дня.", 88, 140, 440, { name: "Описание", h: 52, fontSize: 17 }),
    text("hello@example.com\n+7 900 000-00-00", 88, 220, 320, { name: "Контакты", h: 80, fontSize: 18, color: INK }),
    shape(formX, 56, 380, 260, { name: "Форма", fill: SOFT, radius: 20 }),
    text("Имя", formX + 28, 88, 320, { name: "Подпись поля", h: 24, fontSize: 13, color: MUTED }),
    shape(formX + 28, 116, 324, 44, { name: "Поле имени", fill: WHITE, radius: 10, borderWidth: 1, borderColor: BORDER }),
    text("E-mail", formX + 28, 176, 320, { name: "Подпись поля", h: 24, fontSize: 13, color: MUTED }),
    shape(formX + 28, 204, 324, 44, { name: "Поле почты", fill: WHITE, radius: 10, borderWidth: 1, borderColor: BORDER }),
    button("Отправить", formX + 28, 264, 160, 44, { name: "Кнопка формы", href: "mailto:hello@example.com" }),
  ];
}

const BUILDERS = {
  hero: heroDefs,
  features: featuresDefs,
  about: aboutDefs,
  cta: ctaDefs,
  gallery: galleryDefs,
  contact: contactDefs,
};

export function getBlock(id) {
  return BLOCKS.find((block) => block.id === id) || null;
}

export function insertBlock(id) {
  const def = getBlock(id);
  if (!def || !state.doc) return null;
  syncRuntime(state.doc);

  if (def.component) {
    const existing = deviceComponents(state.doc, editingDevice())[def.component];
    if (existing) {
      setFrameSelection([existing.id]);
      toast(`«${def.title}» уже добавлен — он общий для всех страниц`, { type: "info", duration: 2600 });
      return existing;
    }
    const frame = addComponent(def.component, { height: def.component === "header" ? 88 : 180 });
    if (!frame) return null;
    commit(() => {
      const target = getFrame(frame.id);
      if (target) fillFrame(target, def.component === "header" ? headerDefs(Number(target.w) || 1200) : footerDefs(Number(target.w) || 1200));
    }, { label: `block-${def.component}` });
    setFrameSelection([frame.id]);
    toast(`«${def.title}» добавлен на все страницы`, { type: "success" });
    return frame;
  }

  const width = deviceWidth(state.doc, editingDevice());
  const page = activePage(state.doc);
  const content = (state.doc.frames || []).filter((frame) => frame.role !== "header" && frame.role !== "footer");
  const bottom = content.length
    ? Math.max(...content.map((frame) => (Number(frame.y) || 0) + (Number(frame.h) || 0)))
    : 0;
  const frame = addFrame({
    name: def.title,
    x: 0,
    y: content.length ? bottom + 48 : 0,
    w: width,
    h: def.h || 360,
    bg: def.id === "cta" ? ACCENT : WHITE,
  });
  if (!frame) return null;
  commit(() => {
    const target = getFrame(frame.id);
    if (target) fillFrame(target, (BUILDERS[def.id] || (() => []))(Number(target.w) || width));
  }, { label: `block-${def.id}` });
  setFrameSelection([frame.id]);
  toast(`Блок «${def.title}» добавлен`, { type: "success" });
  return frame;
}
