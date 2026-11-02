/**
 * Минимальный ZIP-писатель без зависимостей.
 * Используется метод store (без сжатия): для сайта из HTML/CSS/JS/картинок
 * этого достаточно, а браузер не тянет сторонние библиотеки.
 */

const encoder = new TextEncoder();

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let value = i;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[i] = value >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) {
    crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function bytes(...values) {
  return Uint8Array.from(values);
}

function u16(value) {
  return bytes(value & 0xff, (value >>> 8) & 0xff);
}

function u32(value) {
  const safe = Number(value) >>> 0;
  return bytes(safe & 0xff, (safe >>> 8) & 0xff, (safe >>> 16) & 0xff, (safe >>> 24) & 0xff);
}

function dosDateTime(date) {
  const year = Math.max(1980, date.getFullYear());
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

function normalizeData(data) {
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  return encoder.encode(String(data ?? ""));
}

/**
 * @param {{name:string, data:string|Uint8Array|ArrayBuffer}[]} files
 * @param {{date?: Date}} [options]
 * @returns {Blob}
 */
export function createZip(files, { date = new Date() } = {}) {
  const stamp = dosDateTime(date);
  const localChunks = [];
  const centralChunks = [];
  const entries = [];
  let offset = 0;

  for (const file of files) {
    const name = String(file.name || "file").replace(/\\/g, "/").replace(/^\/+/, "");
    if (!name) continue;
    const nameBytes = encoder.encode(name);
    const data = normalizeData(file.data);
    const crc = crc32(data);

    const localHeader = new Uint8Array([
      ...u32(0x04034b50),
      ...u16(20),
      ...u16(0x0800),
      ...u16(0),
      ...u16(stamp.time),
      ...u16(stamp.date),
      ...u32(crc),
      ...u32(data.length),
      ...u32(data.length),
      ...u16(nameBytes.length),
      ...u16(0),
    ]);
    localChunks.push(localHeader, nameBytes, data);
    entries.push({ nameBytes, data, crc, offset });
    offset += localHeader.length + nameBytes.length + data.length;
  }

  for (const entry of entries) {
    const centralHeader = new Uint8Array([
      ...u32(0x02014b50),
      ...u16(20),
      ...u16(20),
      ...u16(0x0800),
      ...u16(0),
      ...u16(stamp.time),
      ...u16(stamp.date),
      ...u32(entry.crc),
      ...u32(entry.data.length),
      ...u32(entry.data.length),
      ...u16(entry.nameBytes.length),
      ...u16(0),
      ...u16(0),
      ...u16(0),
      ...u16(0),
      ...u32(0),
      ...u32(entry.offset),
    ]);
    centralChunks.push(centralHeader, entry.nameBytes);
  }

  const centralSize = centralChunks.reduce((size, chunk) => size + chunk.length, 0);
  const end = new Uint8Array([
    ...u32(0x06054b50),
    ...u16(0),
    ...u16(0),
    ...u16(entries.length),
    ...u16(entries.length),
    ...u32(centralSize),
    ...u32(offset),
    ...u16(0),
  ]);

  return new Blob([...localChunks, ...centralChunks, end], { type: "application/zip" });
}
