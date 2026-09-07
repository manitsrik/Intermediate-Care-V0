/**
 * นิยามโครงสร้างชีต และฟังก์ชันติดตั้งระบบครั้งแรก
 *
 * ทุกสูตรในชีต summary อ้างคอลัมน์ผ่าน col_() ที่คำนวณจาก SCHEMA
 * ถ้าเพิ่ม/ย้ายคอลัมน์ในอนาคต สูตรจะขยับตามเองโดยไม่ต้องแก้มือ
 */

var SCHEMA = {};

SCHEMA[SHEETS.PATIENTS] = [
  'patient_id', 'cid', 'hn', 'prefix', 'first_name', 'last_name', 'sex', 'age', 'rights',
  'dx', 'dx_group', 'dx_detail', 'rt_pa', 'hemiparesis_side',
  'ct_mri', 'operation', 'underlying', 'other_problems',
  'address', 'tambon', 'phone1', 'phone2',
  'admit_date', 'dc_date', 'ward',
  'imc_program', 'kbh_appt_date', 'kbh_appt_time', 'kbh_hospital',
  'start_date', 'screening_result',
  'first_bi', 'latest_bi', 'latest_bi_date', 'bi_count',
  'end_date', 'imc_end_date', 'pt_visit_count', 'dc_reason',
  'home_visit', 'six_month_status', 'note',
  'status', 'legacy_row', 'created_by', 'created_at', 'updated_by', 'updated_at'
];

/**
 * ต่อคอลัมน์ bi_1..bi_N ไว้ท้ายรายการ เก็บคะแนน BI แต่ละครั้งไว้บนแถวผู้ป่วย
 *
 * เก็บซ้ำจาก bi_assessments เพื่อให้ชีต summary ดึงค่าตรง ๆ ได้ ไม่ต้อง VLOOKUP
 * ข้ามตารางทีละแถว ซึ่งเป็นงานเท่ากับ (จำนวนผู้ป่วย x จำนวนใบประเมิน) ต่อสูตร
 * หนึ่งตัว และบวมขึ้นเรื่อย ๆ ตามปีที่ใช้งาน
 *
 * ต่อท้ายเสมอ ตำแหน่งคอลัมน์เดิมจะได้ไม่ขยับ ข้อมูลที่มีอยู่จึงไม่เลื่อนตาม
 */
for (var biSeq = 1; biSeq <= CONFIG.BI_SUMMARY_COLUMNS; biSeq++) {
  SCHEMA[SHEETS.PATIENTS].push('bi_' + biSeq);
}
// ต่อท้ายคอลัมน์เดิมทั้งหมด รวมถึง BI เพื่อไม่ให้ข้อมูลเก่าเลื่อนช่อง
SCHEMA[SHEETS.PATIENTS].push('province', 'district');

SCHEMA[SHEETS.BI] = [
  'assess_id', 'hn', 'seq', 'assess_date',
  'feeding', 'transfer', 'grooming', 'toilet', 'bathing',
  'mobility', 'stairs', 'dressing', 'bowels', 'bladder',
  'total', 'multiple_impairment', 'imc_eligible', 'adl_group',
  'note', 'assessed_by', 'created_at'
];

SCHEMA[SHEETS.FOLLOWUPS] = [
  'fu_id', 'hn', 'seq', 'fu_date', 'fu_type', 'complications', 'note',
  'recorded_by', 'created_at'
];

SCHEMA[SHEETS.USERS] = ['email', 'name', 'role', 'active', 'added_at'];

SCHEMA[SHEETS.MIGRATION_REPORT] = ['legacy_row', 'hn', 'column', 'raw_value', 'issue', 'action_taken'];

/** ลำดับคอลัมน์ (1-based) ของ field ในชีต */
function idx_(sheetName, field) {
  var i = SCHEMA[sheetName].indexOf(field);
  if (i === -1) throw new Error('ไม่พบคอลัมน์ ' + field + ' ในชีต ' + sheetName);
  return i + 1;
}

/** ตัวอักษรคอลัมน์ เช่น 1 -> A, 28 -> AB */
function letter_(n) {
  var s = '';
  while (n > 0) {
    var m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/**
 * อ้างช่วงทั้งคอลัมน์ของ field เช่น patients!C2:C
 * เปิดปลายไว้ได้เพราะทุกสูตรในชีต summary เป็นการดึงค่ามาตรง ๆ แถวต่อแถว
 * ไม่มีตัวไหนไล่ค้นข้ามตารางแล้ว จำนวนแถวจึงโตได้เรื่อย ๆ โดยไม่ต้องตั้งเพดาน
 */
function col_(sheetName, field) {
  var L = letter_(idx_(sheetName, field));
  return "'" + sheetName + "'!" + L + '2:' + L;
}

/**
 * เติมหัวคอลัมน์พื้นที่ที่เพิ่มในภายหลังให้ชีตเดิมโดยไม่เขียนทับข้อมูล
 * เรียกตอนเปิดแอปเพื่อให้ deployment ใหม่พร้อมใช้ได้ทันทีโดยไม่ต้องรัน setupSystem()
 */
function ensurePatientAreaHeaders_() {
  var sh = sheet_(SHEETS.PATIENTS);
  var start = idx_(SHEETS.PATIENTS, 'province');
  var expected = ['province', 'district'];
  var range = sh.getRange(1, start, 1, expected.length);
  var actual = range.getValues()[0];
  var changed = false;

  expected.forEach(function (name, i) {
    var current = String(actual[i] || '').trim();
    if (!current) {
      actual[i] = name;
      changed = true;
      return;
    }
    if (current !== name) {
      throw new Error('หัวคอลัมน์พื้นที่ในชีต patients ไม่ตรงกับโครงสร้างระบบ: คอลัมน์ ' +
        letter_(start + i) + ' ต้องเป็น ' + name + ' แต่พบ ' + current);
    }
  });

  if (changed) {
    range.setValues([actual]).setFontWeight('bold').setBackground('#e8f0fe');
    sh.getRange(1, start, sh.getMaxRows(), expected.length).setNumberFormat('@');
  }
  return changed;
}

/**
 * ติดตั้งระบบครั้งแรก - สร้างชีตทั้งหมดพร้อมหัวคอลัมน์
 * เรียกซ้ำได้ ไม่ลบข้อมูลเดิม
 */
function setupSystem() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var created = [];

  Object.keys(SCHEMA).forEach(function (name) {
    var sh = ss.getSheetByName(name);
    if (!sh) {
      sh = ss.insertSheet(name);
      created.push(name);
    }
    var headers = SCHEMA[name];
    ensureColumns_(sh, headers.length);
    sh.getRange(1, 1, 1, headers.length).setValues([headers])
      .setFontWeight('bold').setBackground('#e8f0fe');
    sh.setFrozenRows(1);
    // เก็บทุกช่องเป็น text ล้วน กัน Sheets แปลง "3/11" เป็นวันที่แบบไฟล์เดิม
    sh.getRange(1, 1, sh.getMaxRows(), headers.length).setNumberFormat('@');
  });

  var filled = backfillBiColumns_();
  buildSummarySheet_(ss);
  ensureCurrentUserIsRegistered_();

  var ui = SpreadsheetApp.getUi();
  ui.alert('ติดตั้งเรียบร้อย',
    (created.length ? 'สร้างชีตใหม่: ' + created.join(', ') : 'ชีตครบอยู่แล้ว อัปเดตหัวคอลัมน์ให้แล้ว') +
    '\nเติมคะแนน BI ย้อนหลังบนแถวผู้ป่วย ' + filled + ' แถว',
    ui.ButtonSet.OK);
}

/**
 * คัดลอกคะแนน BI ของทุกคนมาไว้ที่คอลัมน์ bi_1..bi_N บนแถวผู้ป่วย
 *
 * ตอนบันทึกปกติ refreshPatientBiStats_() ทำให้อยู่แล้วทีละคน ตัวนี้มีไว้เติมย้อนหลัง
 * ให้ข้อมูลที่มีอยู่ก่อนจะมีคอลัมน์พวกนี้ ไม่งั้นชีต summary จะว่างจนกว่าจะมีการ
 * ประเมินใหม่ เรียกซ้ำได้ ผลลัพธ์เหมือนเดิมเสมอ
 *
 * อ่านทีเดียวเขียนทีเดียว ไม่ไล่เขียนทีละแถว เพราะทุกครั้งที่แตะชีตคือค่าใช้จ่าย
 */
function backfillBiColumns_() {
  var sh = sheet_(SHEETS.PATIENTS);
  var last = sh.getLastRow();
  if (last < 2) return 0;

  var n = CONFIG.BI_SUMMARY_COLUMNS;
  var bySeq = {};
  readAll_(SHEETS.BI).forEach(function (r) {
    var seq = Number(r.seq);
    if (!(seq >= 1 && seq <= n)) return;
    var hn = String(r.hn);
    if (!bySeq[hn]) bySeq[hn] = {};
    bySeq[hn][seq] = r.total;
  });

  var hns = sh.getRange(2, idx_(SHEETS.PATIENTS, 'hn'), last - 1, 1).getValues();
  var block = hns.map(function (row) {
    var found = bySeq[String(plain_(row[0]))] || {};
    var out = [];
    for (var i = 1; i <= n; i++) out.push(found[i] === undefined ? '' : found[i]);
    return out;
  });

  sh.getRange(2, idx_(SHEETS.PATIENTS, 'bi_1'), block.length, n).setValues(block);
  return block.length;
}

/**
 * ชีต summary - มุมมองรวมหน้าตาใกล้เคียงไฟล์ ตยเคส เดิม
 * สร้างจากสูตรล้วน คนที่ชินของเก่าเปิดดูได้เหมือนเดิมโดยไม่ต้องกรอกซ้ำ
 */
function buildSummarySheet_(ss) {
  var sh = ss.getSheetByName(SHEETS.SUMMARY) || ss.insertSheet(SHEETS.SUMMARY);
  sh.clear();

  var P = function (f) { return col_(SHEETS.PATIENTS, f); };
  var hnCol = P('hn');
  var guard = function (expr) { return '=ARRAYFORMULA(IF(' + hnCol + '="","",' + expr + '))'; };

  var cols = [
    ['ลำดับ',            guard(P('patient_id'))],
    ['HN',               guard(hnCol)],
    ['ชื่อ-สกุล',         guard(P('prefix') + '&" "&' + P('first_name') + '&" "&' + P('last_name'))],
    ['เพศ',              guard(P('sex'))],
    ['อายุ',             guard(P('age'))],
    ['สิทธิ์',            guard(P('rights'))],
    ['Dx',               guard(P('dx'))],
    ['ตำบล',             guard(P('tambon'))],
    ['admit',            guard(P('admit_date'))],
    ['D/C',              guard(P('dc_date'))],
    ['ward',             guard(P('ward'))],
    ['IMC program',      guard(P('imc_program'))],
    ['วัน Start',        guard(P('start_date'))]
  ];

  // BI แต่ละครั้ง อ่านจากคอลัมน์บนแถวผู้ป่วยที่เตรียมไว้ให้แล้วตั้งแต่ตอนบันทึก
  for (var i = 1; i <= CONFIG.BI_SUMMARY_COLUMNS; i++) {
    cols.push(['BI ' + i, guard(P('bi_' + i))]);
  }

  cols = cols.concat([
    ['BI ล่าสุด',          guard(P('latest_bi'))],
    ['เข้า/ไม่เข้า IMC',   guard(P('screening_result'))],
    ['จน.ครั้งที่ได้ PT',  guard(P('pt_visit_count'))],
    ['วันสิ้นสุด IMC',     guard(P('imc_end_date'))],
    ['เหตุจบ',            guard(P('dc_reason'))],
    ['ครบ 6 เดือน',       guard(P('six_month_status'))]
  ]);

  sh.getRange(1, 1, 1, cols.length)
    .setValues([cols.map(function (c) { return c[0]; })])
    .setFontWeight('bold').setBackground('#fce8b2');
  sh.setFrozenRows(1);

  cols.forEach(function (c, i) { sh.getRange(2, i + 1).setFormula(c[1]); });

  sh.setColumnWidth(3, 180);
  sh.protect()
    .setDescription('ชีตนี้สร้างจากสูตรอัตโนมัติ ห้ามพิมพ์ทับ')
    .setWarningOnly(true);
}

/**
 * เพิ่มคนที่กดติดตั้งเข้าตาราง users ในฐานะผู้ดูแลระบบ
 * ถ้ามีแถวอยู่แล้วจะเลื่อนสิทธิ์ให้เป็น admin เพื่อกันไม่ให้ไม่มีใครจัดการผู้ใช้ได้
 */
function ensureCurrentUserIsRegistered_() {
  var email = Session.getActiveUser().getEmail();
  if (!email) return;

  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEETS.USERS);
  var last = sh.getLastRow();
  var rows = last > 1 ? sh.getRange(2, 1, last - 1, SCHEMA[SHEETS.USERS].length).getValues() : [];

  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i][0]).trim().toLowerCase() === email.toLowerCase()) {
      sh.getRange(i + 2, idx_(SHEETS.USERS, 'role')).setValue('admin');
      sh.getRange(i + 2, idx_(SHEETS.USERS, 'active')).setValue('TRUE');
      return;
    }
  }
  sh.appendRow([email, '', 'admin', 'TRUE', nowIso_()]);
}

/** เมนูบนแถบเครื่องมือของ Google Sheets */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Intermediate Care')
    .addItem('ติดตั้งระบบ (ครั้งแรก)', 'setupSystem')
    .addSeparator()
    .addItem('นำเข้าข้อมูลเดิมจากชีต ตยเคส', 'runMigration')
    .addItem('ล้างข้อมูลที่นำเข้ามา', 'clearMigratedData')
    .addSeparator()
    .addItem('ตรวจสอบระบบ', 'diagnose')
    .addToUi();
}

/**
 * ตรวจว่าแต่ละชีตมีข้อมูลกี่แถว และข้อมูลที่จะส่งไปหน้าเว็บแปลงเป็น JSON ได้จริงไหม
 * ใช้ไล่หาสาเหตุเวลาหน้าเว็บค้างที่ "กำลังโหลด"
 */
function diagnose() {
  var lines = [];

  Object.keys(SCHEMA).forEach(function (name) {
    try {
      lines.push(name + ': ' + readAll_(name).length + ' แถว');
    } catch (e) {
      lines.push(name + ': อ่านไม่ได้ - ' + e.message);
    }
  });

  lines.push('');
  try {
    var email = Session.getActiveUser().getEmail();
    lines.push('บัญชีที่ใช้งาน: ' + (email || '(อ่านอีเมลไม่ได้)'));
    var u = currentUser_();
    lines.push('สิทธิ์: ' + u.role + (u.bootstrap ? ' (ยังไม่มีใครในตาราง users)' : ''));
  } catch (e) {
    lines.push('ตรวจสิทธิ์ไม่ผ่าน: ' + e.message);
  }

  lines.push('');
  try {
    var payload = apiListPatients({});
    lines.push('apiListPatients คืน ' + payload.length + ' ราย');
    var json = JSON.stringify(payload);
    lines.push('แปลงเป็น JSON ได้ ขนาด ' + Math.round(json.length / 1024) + ' KB');
  } catch (e) {
    lines.push('apiListPatients ล้มเหลว: ' + e.message);
    lines.push(e.stack ? String(e.stack).split('\n').slice(0, 3).join('\n') : '');
  }

  SpreadsheetApp.getUi().alert('ผลตรวจสอบระบบ', lines.join('\n'), SpreadsheetApp.getUi().ButtonSet.OK);
}
