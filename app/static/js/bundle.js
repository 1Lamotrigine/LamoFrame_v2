/**
 * Многофайловый экспорт проекта: HTML-страницы, общий CSS/JS и изображения,
 * упакованные в ZIP прямо в браузере.
 */

import {
  buildMainScript,
  buildStylesheet,
  docComponents,
  docPages,
  renderBundlePage,
} from "./render.js";
import { createZip } from "./zip.js";

const MIME_EXTENSIONS = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/svg+xml": "svg",
  "image/avif": "avif",
  "image/bmp": "bmp",
  "image/x-icon": "ico",
  "image/vnd.microsoft.icon": "ico",
};

function safeName(value, fallback = "file") {
  const cleaned = String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "");
  return cleaned || fallback;
}

function extensionFromMime(mime) {
  return MIME_EXTENSIONS[String(mime || "").toLowerCase().split(";")[0].trim()] || "";
}

function extensionFromUrl(url) {
  try {
    const pathname = new URL(url, window.location.href).pathname;
    const match = pathname.match(/\.([a-z0-9]{1,8})$/i);
    return match ? match[1].toLowerCase() : "";
  } catch (error) {
    return "";
  }
}

function baseNameFromUrl(url, index) {
  try {
    const pathname = new URL(url, window.location.href).pathname;
    const file = decodeURIComponent(pathname.split("/").pop() || "");
    const base = file.replace(/\.[^.]+$/, "");
    return safeName(base, `image-${index + 1}`);
  } catch (error) {
    return `image-${index + 1}`;
  }
}

function uniqueName(base, extension, used) {
  const ext = extension ? `.${extension}` : "";
  let name = `${base}${ext}`;
  let counter = 2;
  while (used.has(name)) {
    name = `${base}-${counter}${ext}`;
    counter += 1;
  }
  used.add(name);
  return name;
}

function decodeDataUri(uri) {
  const comma = uri.indexOf(",");
  if (comma < 0) throw new Error("Некорректный data URI");
  const meta = uri.slice(5, comma);
  const payload = uri.slice(comma + 1);
  const mime = (meta.split(";")[0] || "").trim();
  if (/;base64/i.test(meta)) {
    const binary = atob(payload.replace(/\s/g, ""));
    const data = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) data[i] = binary.charCodeAt(i);
    return { data, mime };
  }
  // Percent-encoded data URI — это байты, а не Unicode-текст. Декодируем
  // %XX в байты, иначе binary-данные с кодами >127 исказятся.
  const bytes = [];
  for (let i = 0; i < payload.length; i += 1) {
    const char = payload[i];
    if (char === "%" && /^[0-9a-f]{2}$/i.test(payload.slice(i + 1, i + 3))) {
      bytes.push(parseInt(payload.slice(i + 1, i + 3), 16));
      i += 2;
    } else {
      const encoded = new TextEncoder().encode(char);
      for (const byte of encoded) bytes.push(byte);
    }
  }
  return { data: new Uint8Array(bytes), mime };
}

function allDocumentFrames(doc) {
  const frames = [];
  const manual = doc?.settings?.responsive?.auto === false;
  for (const page of docPages(doc)) {
    frames.push(...(page.frames || []));
    if (manual) {
      for (const device of ["tablet", "phone"]) {
        frames.push(...(page.deviceFrames?.[device]?.frames || page.frames || []));
      }
    }
  }
  for (const device of manual ? ["desktop", "tablet", "phone"] : ["desktop"]) {
    const { header, footer } = docComponents(doc, device);
    if (header) frames.push(header);
    if (footer) frames.push(footer);
  }
  return frames;
}

function collectSources(doc) {
  const sources = new Set();
  for (const frame of allDocumentFrames(doc)) {
    for (const el of frame.elements || []) {
      if (el.type !== "image") continue;
      const src = String(el.props?.src || "").trim();
      if (src) sources.add(src);
    }
  }
  return [...sources];
}

async function loadImageSource(src) {
  if (src.startsWith("data:")) return decodeDataUri(src);
  const response = await fetch(src, { credentials: "same-origin" });
  if (!response.ok) throw new Error(`Не удалось загрузить изображение (${response.status})`);
  const blob = await response.blob();
  return {
    data: new Uint8Array(await blob.arrayBuffer()),
    mime: blob.type || response.headers.get("content-type") || "",
  };
}

async function collectImages(doc) {
  const sources = collectSources(doc);
  const imageMap = new Map();
  const files = [];
  const used = new Set();

  // Последовательно, а не Promise.all: иначе порядок файлов и суффиксы
  // (image-2, image-3) зависят от скорости загрузки и ZIP получается
  // недетерминированным.
  for (let index = 0; index < sources.length; index += 1) {
    const src = sources[index];
    try {
      const image = await loadImageSource(src);
      const extension =
        extensionFromMime(image.mime) ||
        extensionFromUrl(src) ||
        (src.startsWith("data:image/svg") ? "svg" : "png");
      const base = src.startsWith("data:") ? `image-${index + 1}` : baseNameFromUrl(src, index);
      const name = uniqueName(base, extension, used);
      const path = `assets/images/${name}`;
      imageMap.set(src, path);
      files.push({ path, data: image.data });
    } catch (error) {
      // Внешнюю картинку без CORS оставляем по исходному URL — сайт продолжит работать.
    }
  }

  return { imageMap, files };
}

function pageFileNames(pages) {
  const used = new Set(["index.html"]);
  return pages.map((page, index) => {
    if (index === 0) return "index.html";
    const base = safeName(page.slug || page.name, `page-${index + 1}`).replace(/\.html?$/, "");
    let name = `${base || `page-${index + 1}`}.html`;
    let counter = 2;
    while (used.has(name)) {
      name = `${base || `page-${index + 1}`}-${counter}.html`;
      counter += 1;
    }
    used.add(name);
    return name;
  });
}

/**
 * Собрать полный набор файлов проекта.
 * @returns {Promise<{files: {path: string, data: string|Uint8Array}[], pageFiles: string[]}>}
 */
export async function buildProjectBundle(doc) {
  const pages = docPages(doc);
  const pageFiles = pageFileNames(pages);
  const pageHrefs = new Map(pages.map((page, index) => [page.id, pageFiles[index]]));
  const { imageMap, files: imageFiles } = await collectImages(doc);

  const files = pages.map((page, index) => ({
    path: pageFiles[index],
    data: renderBundlePage(doc, page, { pageHrefs, imageMap }),
  }));

  files.push({ path: "assets/css/style.css", data: buildStylesheet(doc) });
  files.push({ path: "assets/js/main.js", data: buildMainScript(doc) });
  files.push(...imageFiles);
  return { files, pageFiles };
}

/** Собрать ZIP с сайтом. */
export async function createProjectZip(doc) {
  const { files, pageFiles } = await buildProjectBundle(doc);
  const blob = createZip(files.map((file) => ({ name: file.path, data: file.data })));
  return { blob, pageFiles };
}
