/**
 * สร้างไอคอนแอปสำหรับหน้าจอโฮม จากเครื่องหมายกากบาทตัวเดียวกับที่ใช้ในแอป
 *
 *   node tools/make-icons.js
 *
 * เขียน PNG เองด้วย zlib ที่ node มีมาให้ ไม่ต้องลง ImageMagick หรือ Pillow
 * ลบไฟล์ไอคอนทิ้งแล้วสั่งใหม่ได้เสมอ ไม่ต้องเก็บไฟล์ต้นฉบับจากโปรแกรมวาดรูป
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const OUT = path.join(__dirname, '..', 'pwa');

/* ------------------------------------------------------------ เขียน PNG */

const CRC_TABLE = (function () {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

/** rgba คือ Uint8Array ยาว size*size*4 */
function encodePng(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;    // 8 บิตต่อช่อง
  ihdr[9] = 6;    // RGBA
  // 10-12 = compression, filter, interlace = 0 ทั้งหมด

  // ใส่ไบต์ filter 0 หน้าทุกบรรทัด แล้วบีบอัดรวดเดียว
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    const src = y * size * 4;
    const dst = y * (size * 4 + 1);
    raw[dst] = 0;
    Buffer.from(rgba.buffer, src, size * 4).copy(raw, dst + 1);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

/* ------------------------------------------------------------ รูปเครื่องหมาย

  เครื่องหมายชุดเดียวกับ .brand-mark ใน index.html บนพิกัด 24x24
  กากบาทคือสี่เหลี่ยมสองอันซ้อนกัน ส่วนแถบล่างคือฐานที่จางกว่า
*/
const CROSS_V = [9.6, 2.6, 4.8, 13.2];
const CROSS_H = [5.4, 6.8, 13.2, 4.8];
const BASE_BAR = [6.2, 17.4, 11.6, 4];

function inRect(x, y, r) {
  return x >= r[0] && x < r[0] + r[2] && y >= r[1] && y < r[1] + r[3];
}

function inRoundRect(x, y, size, radius) {
  if (x < 0 || y < 0 || x >= size || y >= size) return false;
  const cx = Math.min(Math.max(x, radius), size - radius);
  const cy = Math.min(Math.max(y, radius), size - radius);
  const dx = x - cx, dy = y - cy;
  return dx * dx + dy * dy <= radius * radius;
}

/* สีไล่จาก --brand ลงไป --brand-ink ตัวหนังสือขาวบนโทนนี้อ่านออกทุกขนาด */
const TOP = [0x3f, 0xbb, 0xc0];
const BOTTOM = [0x20, 0x71, 0x75];

/**
 * markScale บอกว่าเครื่องหมายกินพื้นที่กี่ส่วนของด้าน
 * ไอคอนแบบ maskable ต้องเล็กลง เพราะ Android ครอบมุมทิ้งได้ถึง 20% รอบด้าน
 */
function render(size, radiusRatio, markScale) {
  const px = new Uint8Array(size * size * 4);
  const SS = 4;                       // สุ่มสี่จุดต่อด้านในหนึ่งพิกเซล ขอบจะได้ไม่หยัก
  const radius = radiusRatio * size;
  const m = markScale * size;
  const off = (size - m) / 2;
  const unit = m / 24;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let bg = 0, cross = 0, bar = 0;

      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const px_ = x + (sx + 0.5) / SS;
          const py_ = y + (sy + 0.5) / SS;
          if (inRoundRect(px_, py_, size, radius)) bg++;

          const mx = (px_ - off) / unit;
          const my = (py_ - off) / unit;
          if (inRect(mx, my, CROSS_V) || inRect(mx, my, CROSS_H)) cross++;
          else if (inRect(mx, my, BASE_BAR)) bar++;
        }
      }

      const n = SS * SS;
      const alpha = bg / n;
      const white = Math.min(1, cross / n + (bar / n) * 0.45);

      const t = y / (size - 1);
      const i = (y * size + x) * 4;
      for (let c = 0; c < 3; c++) {
        const base = TOP[c] + (BOTTOM[c] - TOP[c]) * t;
        px[i + c] = Math.round(base + (255 - base) * white);
      }
      px[i + 3] = Math.round(alpha * 255);
    }
  }

  return encodePng(size, px);
}

/* ---------------------------------------------------------------- เขียนไฟล์ */

fs.mkdirSync(OUT, { recursive: true });

const FILES = [
  // มุมมนแบบเดียวกับ .brand-mark สำหรับที่ที่ระบบไม่ครอบรูปให้
  ['icon-192.png', 192, 0.22, 0.62],
  ['icon-512.png', 512, 0.22, 0.62],
  ['apple-touch-icon-180.png', 180, 0.22, 0.62],
  // maskable ต้องเต็มสี่เหลี่ยม ไม่มีมุมมน แล้วหดเครื่องหมายเข้ามาให้พ้นขอบที่ถูกครอบ
  ['icon-maskable-512.png', 512, 0, 0.48]
];

FILES.forEach(function (f) {
  const buf = render(f[1], f[2], f[3]);
  fs.writeFileSync(path.join(OUT, f[0]), buf);
  console.log('เขียน pwa/' + f[0] + ' (' + f[1] + 'px, ' + Math.round(buf.length / 1024) + ' KB)');
});
