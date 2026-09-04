/**
 * รันโค้ดหน้าจอจริงบน node โดยใส่ DOM ปลอมให้
 *
 * ตรวจว่าแต่ละหน้าวาดออกมาได้โดยไม่พัง ซึ่ง node --check จับไม่ได้
 * เพราะ syntax ถูกแต่เรียกตัวแปรที่ไม่มีอยู่จริงก็ผ่านการตรวจ syntax
 * ใช้ไฟล์ preview ที่ประกอบเสร็จแล้ว จึงได้ทั้งโค้ดจริงและข้อมูลจำลองในไฟล์เดียว
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
  var el = {
    id: id, innerHTML: '', textContent: '', value: '', title: '',
    hidden: false, style: {}, dataset: {},
    classList: { toggle: function () {}, add: function () {}, remove: function () {} },
    addEventListener: function () {},
    removeEventListener: function () {},
    querySelector: function () { return makeEl('q'); },
    querySelectorAll: function () { return []; },
    scrollIntoView: function () {},
    focus: function () {},
    appendChild: function () {},
    elements: []
  };
  return el;
}

var els = {};
var doc = {
  getElementById: function (id) {
    if (!els[id]) els[id] = makeEl(id);
    return els[id];
  },
  querySelector: function () { return makeEl('sel'); },
  querySelectorAll: function () { return []; },
  addEventListener: function () {},
  removeEventListener: function () {},
  body: { classList: { toggle: function () {} } },
  createElement: function () { return makeEl('new'); }
};

var win = {
  scrollTo: function () {},
  setTimeout: function (fn) { return 0; },
  clearTimeout: function () {}
};

/* ------------------------------------------------------------- รันจริง */

var src = scripts.join('\n;\n')
  .replace(/\bboot\(\);\s*$/, '')                 // อย่าให้บูตเอง จะไปเรียกเซิร์ฟเวอร์ปลอมแบบ async
  + '\n; return { API: API, fn: { drawDashboard: drawDashboard, drawReport: drawReport,' +
    ' drawList: drawList, drawDetail: drawDetail, paintRows: paintRows },' +
    ' setBoot: function (b) { BOOT = b; }, setPatients: function (p) { patientCache = p; } };';

var app;
try {
  app = new Function('document', 'window', 'setTimeout', 'clearTimeout', 'console', src)(
    doc, win, win.setTimeout, win.clearTimeout, console);
} catch (e) {
  console.error('โหลดสคริปต์ไม่ผ่าน: ' + e.message);
  process.exit(1);
}

var API = app.API;
var boot = API.apiBootstrap();
app.setBoot(boot);
app.setPatients(boot.patients);

var cases = [
  ['หน้าภาพรวม', function () { app.fn.drawDashboard(API.apiDashboard()); }],
  ['หน้ารายงาน / BI', function () { app.fn.drawReport(API.apiReport()); }],
  ['หน้ารายชื่อผู้ป่วย', function () { app.fn.drawList(); }],
  ['หน้าเวชระเบียน', function () { app.fn.drawDetail(API.apiGetPatient(boot.patients[0].hn)); }]
];

var pass = 0, fail = 0;
cases.forEach(function (c) {
  els.main = makeEl('main');
  try {
    c[1]();
    var out = els.main.innerHTML;
    if (!out || out.length < 200) throw new Error('วาดออกมาได้ ' + out.length + ' ตัวอักษร น้อยผิดปกติ');
    if (out.indexOf('undefined') !== -1) throw new Error('มีคำว่า undefined หลุดไปอยู่ในหน้าจอ');
    console.log('ผ่าน  ' + c[0] + ' (' + out.length + ' ตัวอักษร)');
    pass++;
  } catch (e) {
    console.log('ไม่ผ่าน ' + c[0] + ' → ' + e.message);
    fail++;
  }
});

console.log('\nรวม: ' + pass + ' ผ่าน / ' + fail + ' ไม่ผ่าน');
process.exit(fail ? 1 : 0);
