/**
 * ฟังก์ชันช่วยเหลือทั่วไป: วันที่แบบไทย, การปกปิดข้อมูล PDPA, การอ่าน/เขียนชีต
 */

var TH_MONTHS_FULL = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
  'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
var TH_MONTHS_ABBR = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.',
  'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];

function nowIso_() {
  return Utilities.formatDate(new Date(), 'Asia/Bangkok', "yyyy-MM-dd'T'HH:mm:ss");
}

function todayIso_() {
  return Utilities.formatDate(new Date(), 'Asia/Bangkok', 'yyyy-MM-dd');
}

function uid_(prefix) {
  return prefix + '-' + Utilities.formatDate(new Date(), 'Asia/Bangkok', 'yyMMddHHmmss') +
    '-' + Math.floor(Math.random() * 900 + 100);
}

/* ------------------------------------------------------------------ วันที่ */

/** yyyy-MM-dd เป็น "1 ต.ค. 2568" (พ.ศ.) */
function toThaiDate_(iso, full) {
  if (!iso) return '';
  var p = String(iso).split('-');
  if (p.length !== 3) return String(iso);
  var m = parseInt(p[1], 10) - 1;
  var names = full ? TH_MONTHS_FULL : TH_MONTHS_ABBR;
  return parseInt(p[2], 10) + ' ' + names[m] + ' ' + (parseInt(p[0], 10) + 543);
}

function dateToIso_(d) {
  return Utilities.formatDate(d, 'Asia/Bangkok', 'yyyy-MM-dd');
}

function addDaysIso_(iso, days) {
  var p = String(iso).split('-');
  var d = new Date(parseInt(p[0], 10), parseInt(p[1], 10) - 1, parseInt(p[2], 10));
  d.setDate(d.getDate() + days);
  return dateToIso_(d);
}

function daysBetweenIso_(a, b) {
  if (!a || !b) return null;
  var pa = String(a).split('-'), pb = String(b).split('-');
  var da = new Date(pa[0], pa[1] - 1, pa[2]), db = new Date(pb[0], pb[1] - 1, pb[2]);
  return Math.round((db - da) / 86400000);
}

/**
 * ตีความปีที่ผู้ใช้พิมพ์ให้เป็นปี ค.ศ.
 *   68   เป็น พ.ศ. 2568 เป็น ค.ศ. 2025
 *   2568 เป็น ค.ศ. 2025
 *   1968 เกิดจาก Excel ตีความ "68" ผิด เป็น ค.ศ. 2025
 *   2025 ใช้ตามนั้น
 */
function normalizeYear_(y) {
  y = parseInt(y, 10);
  if (isNaN(y)) return null;
  if (y < 100) return 2500 + y - 543;
  if (y >= 1900 && y < 2000) return y - 1900 + 2500 - 543;
  if (y >= 2400 && y <= 2700) return y - 543;
  return y;
}

/**
 * แปลงค่าวันที่จากไฟล์เดิมซึ่งมีอย่างน้อย 4 รูปแบบปนกัน
 * คืน { iso, issue } ถ้า issue ไม่ว่างแปลว่าต้องให้คนมาตรวจซ้ำ
 */
function parseLegacyDate_(value) {
  if (value === null || value === undefined || value === '') return { iso: '', issue: '' };

  // 1. Sheets อ่านออกมาเป็นวัตถุวันที่แล้ว
  if (Object.prototype.toString.call(value) === '[object Date]') {
    var y = value.getFullYear();
    var iso = [pad4_(normalizeYear_(y)), pad2_(value.getMonth() + 1), pad2_(value.getDate())].join('-');
    return {
      iso: iso,
      issue: y < 2000 ? 'ปีเพี้ยนเป็น ' + y + ' (พิมพ์ปี พ.ศ. สองหลัก แล้วถูกตีความเป็น ค.ศ.)' : ''
    };
  }

  // 2. ตัวเลขล้วน คือ serial number ของ Excel/Sheets
  if (typeof value === 'number' || /^\d+(\.\d+)?$/.test(String(value).trim())) {
    var serial = parseFloat(value);
    if (serial > 20000 && serial < 60000) {
      var d = new Date(Date.UTC(1899, 11, 30) + Math.round(serial) * 86400000);
      var yy = d.getUTCFullYear();
      var iso2 = [pad4_(normalizeYear_(yy)), pad2_(d.getUTCMonth() + 1), pad2_(d.getUTCDate())].join('-');
      return {
        iso: iso2,
        issue: yy < 2000 ? 'ปีเพี้ยนเป็น ' + yy + ' จากเลข serial ' + serial : ''
      };
    }
    return { iso: '', issue: 'ตัวเลข ' + value + ' ไม่ใช่วันที่ที่ตีความได้' };
  }

  var s = String(value).trim();

  // 3. รูปแบบ "01 พฤษภาคม 2569" หรือ "1 พ.ค. 2569"
  for (var i = 0; i < 12; i++) {
    var re = new RegExp('(\\d{1,2})\\s*(' + TH_MONTHS_FULL[i] + '|' + escapeRe_(TH_MONTHS_ABBR[i]) + ')\\s*(\\d{2,4})');
    var m = s.match(re);
    if (m) {
      return { iso: [pad4_(normalizeYear_(m[3])), pad2_(i + 1), pad2_(m[1])].join('-'), issue: '' };
    }
  }

  // 4. รูปแบบ "27/10/68" หรือ "1/12/2568" อาจมีข้อความปน เช่น "ยบ.IMC 11/11/68"
  var dmy = s.match(/(\d{1,2})\s*[\/\-\.]\s*(\d{1,2})\s*[\/\-\.]\s*(\d{2,4})/);
  if (dmy) {
    var extra = s.replace(dmy[0], '').trim();
    return {
      iso: [pad4_(normalizeYear_(dmy[3])), pad2_(dmy[2]), pad2_(dmy[1])].join('-'),
      issue: extra ? 'มีข้อความปนในช่องวันที่: ' + extra : ''
    };
  }

  // 5. "11/11" ไม่มีปี หรือ "9/1 30/1" มีหลายวันในช่องเดียว
  if (/(\d{1,2})\s*[\/\-]\s*(\d{1,2})/.test(s)) {
    return { iso: '', issue: 'ไม่มีปีกำกับ: ' + s + ' ต้องกรอกใหม่' };
  }

  return { iso: '', issue: 'ไม่ใช่วันที่: ' + s };
}

function pad2_(n) { n = parseInt(n, 10); return (n < 10 ? '0' : '') + n; }
function pad4_(n) { n = parseInt(n, 10); return ('0000' + n).slice(-4); }
function escapeRe_(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

/* --------------------------------------------------------------- PDPA mask */

/**
 * ปกปิดข้อมูลที่ระบุตัวบุคคลได้ ใช้เมื่อ CONFIG.MASK_MODE = true
 * ตั้งใจให้ยังอ่านออกว่าเป็นข้อมูลชนิดใด แต่ย้อนกลับไปหาตัวคนไม่ได้
 */
function maskCid_(v) {
  if (!v) return '';
  var s = String(v).replace(/\D/g, '');
  if (!s) return 'xxxxxxxxxxxxx';
  return s.charAt(0) + '-xxxx-xxxxx-xx-x';
}

function maskName_(seed) {
  return 'ทดสอบ ' + (seed === undefined ? '' : seed);
}

function maskPhone_(v) {
  if (!v) return '';
  var s = String(v).replace(/\D/g, '');
  if (s.length < 3) return 'xxx-xxx-xxxx';
  return s.substring(0, 3) + '-xxx-xxxx';
}

function maskAddress_(v) {
  if (!v) return '';
  return 'xxx';
}

/**
 * ปกปิด HN ด้วยรหัสสมมติที่ยังใช้เชื่อมตารางได้
 * ใช้ลำดับเคสเป็นตัวตั้ง จึงได้ค่าเดิมทุกครั้งที่นำเข้าซ้ำ
 */
function maskHn_(seq) {
  return 'TEST' + ('000' + seq).slice(-3);
}

/* --------------------------------------------------------------- อ่าน/เขียน */

function sheet_(name) {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
  if (!sh) {
    throw new Error('ยังไม่ได้ติดตั้งระบบ ไม่พบชีต ' + name +
      ' กรุณาใช้เมนู Intermediate Care แล้วเลือก ติดตั้งระบบ');
  }
  return sh;
}

/**
 * แปลงค่าจากช่องในชีตให้เป็นชนิดพื้นฐานที่ส่งข้ามไปหน้าเว็บได้เสมอ
 * ถ้าปล่อยชนิดแปลก ๆ ผ่านไป google.script.run จะส่งกลับมาเป็น null ทั้งก้อน
 * โดยไม่บอกสาเหตุ ทำให้หน้าจอค้างที่ "กำลังโหลด"
 */
function plain_(v) {
  if (v === null || v === undefined) return '';
  if (Object.prototype.toString.call(v) === '[object Date]') return dateToIso_(v);
  var t = typeof v;
  if (t === 'string' || t === 'boolean') return v;
  if (t === 'number') return isFinite(v) ? v : '';
  return String(v);
}

/** อ่านทั้งชีตออกมาเป็น array ของ object ตาม SCHEMA */
function readAll_(name) {
  var sh = sheet_(name);
  var last = sh.getLastRow();
  if (last < 2) return [];
  var headers = SCHEMA[name];
  var values = sh.getRange(2, 1, last - 1, headers.length).getValues();
  var out = [];
  values.forEach(function (row, i) {
    if (row.join('') === '') return;
    var o = {};
    headers.forEach(function (h, c) { o[h] = plain_(row[c]); });
    o._row = i + 2;
    out.push(o);
  });
  return out;
}

/** แปลง object เป็นแถวตามลำดับคอลัมน์ของชีต */
function toRow_(name, obj) {
  return SCHEMA[name].map(function (h) {
    var v = obj[h];
    return (v === undefined || v === null) ? '' : v;
  });
}

function appendObject_(name, obj) {
  var sh = sheet_(name);
  sh.appendRow(toRow_(name, obj));
  return sh.getLastRow();
}

/** เขียนหลายแถวในครั้งเดียว ใช้ตอนนำเข้าข้อมูลจำนวนมากให้เร็วกว่า appendRow ทีละแถว */
function appendObjects_(name, objects) {
  if (!objects.length) return;
  var sh = sheet_(name);
  var rows = objects.map(function (o) { return toRow_(name, o); });
  sh.getRange(sh.getLastRow() + 1, 1, rows.length, SCHEMA[name].length).setValues(rows);
}

function updateObject_(name, rowNumber, obj) {
  var sh = sheet_(name);
  sh.getRange(rowNumber, 1, 1, SCHEMA[name].length).setValues([toRow_(name, obj)]);
}

/**
 * ครอบการเขียนด้วย lock กันสองคนบันทึกชนกัน
 * ผู้ใช้ 5 คนโอกาสชนต่ำ แต่ความเสียหายสูงถ้าเกิด จึงกันไว้
 */
function withLock_(fn) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) {
    throw new Error('ระบบกำลังบันทึกรายการอื่นอยู่ กรุณากดบันทึกอีกครั้ง');
  }
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}
