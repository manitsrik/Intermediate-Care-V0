/**
 * ตรวจเปลือก PWA ที่เอาไปวางบน GitHub Pages
 *
 * เช็คว่ายังเข้าเกณฑ์ที่ Chrome ยอมให้กด "ติดตั้งแอป" อยู่
 * กับเช็คว่าไฟล์ที่อ้างถึงมีจริงครบทุกตัว
 *
 * ที่ต้องมีเทสต์เพราะพังแบบเงียบ ๆ ได้ง่ายมาก ไอคอนหาย manifest ผิดรูป
 * หรือ service worker ชี้ไปไฟล์ที่ไม่มี ล้วนไม่มีข้อความเตือนให้เห็น
 * รู้อีกทีคือปุ่มติดตั้งไม่ขึ้นบนมือถือ ซึ่งกว่าจะรู้ก็ push ขึ้นไปแล้ว
 */

var fs = require('fs');
var path = require('path');

var PWA = path.join(__dirname, '..', 'pwa');

var pass = 0, fail = 0;
function check(name, fn) {
  try {
    fn();
    console.log('ผ่าน  ' + name);
    pass++;
  } catch (e) {
    console.log('ไม่ผ่าน ' + name + ' → ' + e.message);
    fail++;
  }
}

function read(f) { return fs.readFileSync(path.join(PWA, f), 'utf8'); }

/** ตัดคอมเมนต์ออกก่อนตรวจโค้ด ไม่งั้นชื่อโดเมนที่เขียนอธิบายไว้จะถูกนับว่าเป็นโค้ด */
function stripComments(src) {
  var inBlock = false;
  return src.split('\n').map(function (line) {
    var t = line.trim();
    if (inBlock) {
      if (t.indexOf('*/') !== -1) inBlock = false;
      return '';
    }
    if (t.indexOf('/*') === 0) {
      if (t.indexOf('*/') === -1) inBlock = true;
      return '';
    }
    if (t.indexOf('//') === 0) return '';
    return line;
  }).join('\n');
}


/** อ่านขนาดจริงจากส่วนหัว PNG ไม่เชื่อชื่อไฟล์ */
function pngSize(f) {
  var b = fs.readFileSync(path.join(PWA, f));
  var sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  for (var i = 0; i < sig.length; i++) {
    if (b[i] !== sig[i]) throw new Error(f + ' ไม่ใช่ไฟล์ PNG');
  }
  if (b.toString('ascii', 12, 16) !== 'IHDR') throw new Error(f + ' ส่วนหัวไม่ใช่ IHDR');
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
}

var manifest = null;
var html = read('index.html');
var sw = read('sw.js');

check('manifest อ่านเป็น JSON ได้', function () {
  manifest = JSON.parse(read('manifest.webmanifest'));
});

check('manifest มีครบตามที่ Chrome ใช้ตัดสินว่าติดตั้งได้', function () {
  ['name', 'short_name', 'start_url', 'icons'].forEach(function (k) {
    if (!manifest[k]) throw new Error('ไม่มี ' + k);
  });
  if (['standalone', 'fullscreen', 'minimal-ui'].indexOf(manifest.display) === -1) {
    throw new Error('display ต้องเป็น standalone / fullscreen / minimal-ui ไม่ใช่ ' + manifest.display);
  }
});

check('ไอคอนมีขนาด 192 และ 512 ตามที่ Chrome บังคับ', function () {
  var sizes = {};
  manifest.icons.forEach(function (ic) {
    var real = pngSize(ic.src.replace('./', ''));
    if (real.w + 'x' + real.h !== ic.sizes) {
      throw new Error(ic.src + ' บอกว่า ' + ic.sizes + ' แต่ของจริง ' + real.w + 'x' + real.h);
    }
    sizes[real.w] = true;
  });
  if (!sizes[192]) throw new Error('ไม่มีไอคอน 192px');
  if (!sizes[512]) throw new Error('ไม่มีไอคอน 512px');
});

check('มีไอคอน maskable ให้ Android ครอบมุมได้ไม่กินเนื้อ', function () {
  var m = manifest.icons.filter(function (ic) {
    return String(ic.purpose || '').indexOf('maskable') !== -1;
  });
  if (!m.length) throw new Error('ไม่มีไอคอนที่ purpose เป็น maskable');
});

check('ทุกไฟล์ที่ manifest อ้างถึงมีอยู่จริง', function () {
  manifest.icons.forEach(function (ic) {
    var f = path.join(PWA, ic.src.replace('./', ''));
    if (!fs.existsSync(f)) throw new Error('ไม่มีไฟล์ ' + ic.src);
  });
});

check('ทุกไฟล์ที่หน้าเปิดแอปอ้างถึงมีอยู่จริง', function () {
  var refs = html.match(/(?:href|src)="\.\/([^"]+)"/g) || [];
  if (!refs.length) throw new Error('ไม่เจอการอ้างไฟล์ในเครื่องเลย');
  refs.forEach(function (r) {
    var f = r.replace(/.*"\.\//, '').replace(/"$/, '');
    if (!fs.existsSync(path.join(PWA, f))) throw new Error('ไม่มีไฟล์ ' + f);
  });
});

check('service worker เก็บไฟล์ที่มีอยู่จริงทั้งหมด', function () {
  var block = sw.match(/var SHELL = \[([\s\S]*?)\];/);
  if (!block) throw new Error('หา SHELL ใน sw.js ไม่เจอ');
  var files = block[1].match(/'\.\/([^']*)'/g) || [];
  files.forEach(function (q) {
    var f = q.replace(/'\.\//, '').replace(/'$/, '');
    if (f === '') return;                                   // './' คือตัว index.html เอง
    if (!fs.existsSync(path.join(PWA, f))) throw new Error('sw.js เก็บ ' + f + ' ที่ไม่มีอยู่');
  });
  if (files.length < 3) throw new Error('sw.js เก็บไฟล์น้อยผิดปกติ');
});

check('service worker ดัก fetch ไว้ ไม่งั้น Chrome ไม่ให้ติดตั้ง', function () {
  if (sw.indexOf("addEventListener('fetch'") === -1) throw new Error('ไม่มีตัวดัก fetch');
});

check('หน้าเปิดแอปประกาศ manifest ไว้', function () {
  if (html.indexOf('rel="manifest"') === -1) throw new Error('ไม่มี link rel=manifest');
  if (html.indexOf("register('./sw.js')") === -1) throw new Error('ไม่ได้ลงทะเบียน service worker');
});

check('ลิงก์ปลายทางเป็นลิงก์ deployment จริงของ Apps Script', function () {
  var m = html.match(/var APP_URL = '([^']+)'/);
  if (!m) throw new Error('หา APP_URL ไม่เจอ');
  if (!/^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(m[1])) {
    throw new Error('ไม่ใช่ลิงก์ /exec ที่ถูกรูปแบบ: ' + m[1]);
  }
});

check('เปลือกนี้ต้องไม่มีข้อมูลผู้ป่วยติดไปแม้แต่นิดเดียว', function () {
  [html, sw, read('manifest.webmanifest')].forEach(function (text) {
    if (/\bHN\d|hn['"]?\s*:/.test(text)) throw new Error('เจอข้อมูลที่ดูเหมือน HN');
  });
});

check('service worker ต้องไม่แตะโดเมนของตัวแอป', function () {
  // ตัดคอมเมนต์ทิ้งก่อน ไม่งั้นชื่อโดเมนที่เขียนอธิบายไว้จะถูกนับว่าเป็นโค้ด
  var code = stripComments(sw);
  if (code.indexOf('script.google.com') !== -1) {
    throw new Error('sw.js อ้างถึงโดเมนของตัวแอป ต้องปล่อยให้ผ่านไปตรง ๆ');
  }
  if (code.indexOf('self.location.origin') === -1) {
    throw new Error('sw.js ไม่ได้กรองให้เหลือแต่โดเมนตัวเอง อาจไปแคชหน้าที่มีข้อมูลผู้ป่วย');
  }
});

console.log('\nรวม: ' + pass + ' ผ่าน / ' + fail + ' ไม่ผ่าน');
process.exit(fail ? 1 : 0);
