/**
 * ตรวจส่วนที่ทำให้แอปใช้งานเหมือนแอปติดเครื่อง
 *
 * - preboot วาดโครงหน้าจอได้ทันทีโดยไม่ต้องรอเซิร์ฟเวอร์
 * - ของที่เก็บลงเครื่องมีแค่ชื่อหน่วยงาน ไม่มีข้อมูลผู้ป่วยและไม่มีอีเมลผู้ใช้
 * - เน็ตหลุดแล้วขึ้นแถบเตือน และข้อความบอกชัดว่าข้อมูลยังไม่ถูกบันทึก
 *
 * ทั้งหมดนี้ test-render.js จับไม่ได้ เพราะมันข้าม boot() ไปวาดหน้าจอตรง ๆ
 * ใช้ไฟล์ preview ที่ประกอบเสร็จแล้วเหมือนกัน จึงเป็นโค้ดตัวเดียวกับที่ deploy
 */

var fs = require('fs');
var path = require('path');

var PREVIEW = path.join(__dirname, '..', 'preview', 'index.html');
if (!fs.existsSync(PREVIEW)) {
  console.error('ยังไม่มี preview/index.html ให้รัน node tools/build-preview.js ก่อน');
  process.exit(1);
}

var html = fs.readFileSync(PREVIEW, 'utf8');
var scripts = [];
html.replace(/<script>([\s\S]*?)<\/script>/g, function (_, body) {
  scripts.push(body);
  return '';
});

/* ---------------------------------------------------------- DOM ปลอม */

function makeEl(id) {
  return {
    id: id, innerHTML: '', textContent: '', value: '', title: '',
    hidden: false, style: {}, dataset: {}, clientWidth: 200,
    classList: { toggle: function () {}, add: function () {}, remove: function () {} },
    addEventListener: function () {},
    removeEventListener: function () {},
    querySelector: function () { return makeEl('q'); },
    querySelectorAll: function () { return []; },
    getBoundingClientRect: function () { return { width: 100 }; },
    scrollIntoView: function () {},
    focus: function () {},
    appendChild: function () {},
    elements: []
  };
}

var els = {};
var doc = {
  getElementById: function (id) {
    if (!els[id]) els[id] = makeEl(id);
    return els[id];
  },
  querySelector: function () { return makeEl('sel'); },
  // preboot ใช้ตัวนี้หาปุ่มเมนูทั้งฝั่งซ้ายและแถบล่าง จึงต้องคืนมากกว่าหนึ่งตัว
  querySelectorAll: function () { return [makeEl('a'), makeEl('b')]; },
  addEventListener: function () {},
  removeEventListener: function () {},
  body: { classList: { toggle: function () {} } },
  createElement: function () { return makeEl('new'); }
};

var bound = [];
var win = {
  scrollTo: function () {},
  setTimeout: function (fn) { return 0; },
  clearTimeout: function () {},
  addEventListener: function (type) { bound.push(type); },
  getComputedStyle: function () { return { fontSize: '13px' }; }
};

var store = {};
var storage = {
  getItem: function (k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
  setItem: function (k, v) { store[k] = String(v); }
};

/* ------------------------------------------------------------- รันจริง */

var src = scripts.join('\n;\n')
  .replace(/\bboot\(\);\s*$/, '')                 // อย่าให้บูตเอง จะไปเรียกเซิร์ฟเวอร์ปลอมแบบ async
  + '\n; return { preboot: preboot, bootFailed: bootFailed, netError_: netError_,' +
    ' saveShell_: saveShell_, readShell_: readShell_ };';

var app;
try {
  app = new Function('document', 'window', 'setTimeout', 'clearTimeout', 'console',
    'navigator', 'localStorage', src)(
    doc, win, win.setTimeout, win.clearTimeout, console, { onLine: false }, storage);
} catch (e) {
  console.error('โหลดสคริปต์ไม่ผ่าน: ' + e.message);
  process.exit(1);
}

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

check('เก็บลงเครื่องเฉพาะชื่อหน่วยงาน', function () {
  app.saveShell_({
    appName: 'Intermediate Care', org: 'รพ.กระบี่', orgUnit: 'งาน IMC', orgPlace: 'ตึกผู้ป่วยนอก',
    user: { email: 'nurse@krabihospital.go.th' }, patients: [{ hn: 'HN001', first_name: 'สมชาย' }]
  });
  var raw = store['imc.shell.v1'];
  if (!raw) throw new Error('ไม่ได้เก็บอะไรเลย');
  ['nurse@krabihospital.go.th', 'HN001', 'สมชาย'].forEach(function (bad) {
    if (raw.indexOf(bad) !== -1) throw new Error('มี "' + bad + '" หลุดลงเครื่อง');
  });
  var s = app.readShell_();
  if (s.appName !== 'Intermediate Care' || s.orgPlace !== 'ตึกผู้ป่วยนอก') {
    throw new Error('อ่านกลับมาไม่ตรงกับที่เก็บ');
  }
});

check('preboot วาดโครงหน้าจอโดยไม่ต้องรอเซิร์ฟเวอร์', function () {
  app.preboot();
  if (els['app-name'].textContent !== 'Intermediate Care') throw new Error('ไม่ได้เติมชื่อแอป');
  if (els['mobile-title'].textContent !== 'รายชื่อผู้ป่วย') throw new Error('ไม่ได้ตั้งหัวเรื่องบนมือถือ');
  if (els.main.innerHTML.indexOf('skel-row') === -1) throw new Error('ไม่ได้วาดโครงจาง ๆ รอข้อมูล');
  if (els.sidenav.innerHTML.indexOf('รายชื่อผู้ป่วย') === -1) throw new Error('ไม่ได้วาดเมนู');
});

check('ยังไม่รู้สิทธิ์ ต้องไม่โชว์เมนูผู้ดูแลระบบ', function () {
  if (els.sidenav.innerHTML.indexOf('ตั้งค่า') !== -1) throw new Error('เมนูผู้ดูแลระบบโผล่ก่อนรู้สิทธิ์จริง');
  if (els.bottomnav.innerHTML.indexOf('ตั้งค่า') !== -1) throw new Error('เมนูผู้ดูแลระบบโผล่ที่แถบล่าง');
});

check('เน็ตหลุดแล้วขึ้นแถบเตือนและเฝ้าสถานะไว้', function () {
  if (els['net-banner'].hidden !== false) throw new Error('ออฟไลน์อยู่แต่แถบเตือนไม่ขึ้น');
  if (bound.indexOf('offline') === -1 || bound.indexOf('online') === -1) {
    throw new Error('ไม่ได้เฝ้าสถานะเน็ต');
  }
});

check('กดลองใหม่ซ้ำ ๆ ต้องไม่ผูกตัวเฝ้าซ้อนกัน', function () {
  var before = bound.length;
  app.preboot();
  app.preboot();
  if (bound.length !== before) throw new Error('ผูกซ้ำจาก ' + before + ' เป็น ' + bound.length);
});

check('บูตไม่ผ่านตอนออฟไลน์ ต้องบอกสาเหตุและมีปุ่มลองใหม่', function () {
  app.bootFailed(new Error('Unexpected error while getting the method or property'));
  var out = els.main.innerHTML;
  if (out.indexOf('ไม่ได้ต่ออินเทอร์เน็ต') === -1) throw new Error('ไม่ได้บอกว่าเน็ตหลุด');
  if (out.indexOf('onclick="boot()"') === -1) throw new Error('ไม่มีปุ่มลองใหม่');
  if (out.indexOf('Unexpected error') !== -1) throw new Error('ยังเอาข้อความดิบของระบบมาโชว์');
});

check('ข้อความตอนเน็ตหลุด แยกกรณีบันทึกกับกรณีอ่าน', function () {
  var write = app.netError_(new Error('x'), 'apiSavePatient').message;
  var read = app.netError_(new Error('x'), 'apiListPatients').message;
  if (write.indexOf('ยังไม่ถูกบันทึก') === -1) throw new Error('ตอนบันทึกไม่ได้บอกว่าข้อมูลยังไม่ลงชีต');
  if (read.indexOf('ดึงข้อมูลใหม่ไม่ได้') === -1) throw new Error('ตอนอ่านข้อความไม่ตรง');
});

console.log('\nรวม: ' + pass + ' ผ่าน / ' + fail + ' ไม่ผ่าน');
process.exit(fail ? 1 : 0);
