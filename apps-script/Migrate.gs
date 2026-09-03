/**
 * นำเข้าข้อมูลเดิมจากชีต ตยเคส เข้าโครงสร้างใหม่
 *
 * ไฟล์เดิมมีปัญหาที่ต้องแก้ระหว่างนำเข้า
 *   1. วันที่หลายช่องเพี้ยนเป็นปี ค.ศ. 19xx เพราะพิมพ์ปี พ.ศ. สองหลัก
 *   2. บางช่องข้อมูลอยู่ผิดคอลัมน์ เช่น ช่อง BI4 เก็บวันที่ ช่องวันที่ End เก็บคะแนน
 *   3. ที่อยู่บางแถวถูกแปลงเป็นวันที่ เช่น บ้านเลขที่ 3/11
 *   4. ช่อง FU เก็บทั้งวันที่และข้อความปนกัน
 *
 * ทุกกรณีที่ระบบเดาไม่ได้จะไม่เดาให้ แต่บันทึกไว้ในชีต migration_report
 * เพื่อให้เจ้าหน้าที่กลับมาตรวจกับแฟ้มจริง
 */

/** ตำแหน่งคอลัมน์ในไฟล์เดิม (1-based) */
var LEGACY = {
  SEQ: 2,            // B - ในไฟล์จริงเก็บลำดับเคส ไม่ใช่เลขบัตรตามที่หัวตารางเขียนไว้
  PREFIX: 3, FIRST: 4, LAST: 5, HN: 6, RIGHTS: 7, DX: 8, SEX: 9, AGE: 10,
  ADDRESS: 11, TAMBON: 12, PHONE: 13,
  ADMIT: 14, DC: 15, WARD: 16, IMC_PROGRAM: 17, KBH_APPT: 18, START: 19,
  BI1: 20, SCREENING: 21,
  FU2: 22, BI2: 23, FU3: 24, BI3: 25, FU4: 26, BI4: 27, FU5: 28, BI5: 29,
  END: 30, BI_LAST: 31, IMC_END: 32, PT_COUNT: 33, DC_REASON: 34,
  HOME_VISIT: 35, SIX_MONTH: 36, NOTE: 37
};

/** แก้คำที่สะกดไม่ตรงกันในไฟล์เดิมให้เป็นค่ามาตรฐาน */
var DX_FIX = {
  'recerrent stoke': 'Recurrent stroke',
  'recurrent stoke': 'Recurrent stroke',
  'ischemic stroke': 'Ischemic stroke',
  'hemorrhagic stroke': 'Hemorrhagic stroke',
  'minor stroke': 'Minor stroke',
  'tia': 'TIA', 'sci': 'SCI', 'tbi': 'TBI', 'ctf': 'CTF'
};

var DC_REASON_FIX = {
  'bi>ม15': 'BI > 15',
  'bi<น15': 'BI < 15',
  '20ก่อน6ด.': 'BI 20 ก่อนครบ 6 เดือน',
  'bi คงที่': 'BI คงที่',
  'กลับมาทำงานได้': 'กลับมาทำงานได้',
  'ไม่มาตามนัด': 'ไม่มาตามนัด',
  'ไม่ได้ติดตาม': 'ไม่ได้ติดตาม',
  'ไม่ได้ตามต่อ': 'ไม่ได้ติดตาม',
  'dead': 'เสียชีวิต'
};

function runMigration() {
  var ui = SpreadsheetApp.getUi();
  var legacy = findLegacySheet_();
  if (!legacy) {
    ui.alert('ไม่พบชีตข้อมูลเดิม',
      'กรุณาวางข้อมูลเดิมไว้ในแท็บชื่อ ' + CONFIG.LEGACY_SHEET_NAME + ' ของไฟล์นี้ก่อน',
      ui.ButtonSet.OK);
    return;
  }

  var answer = ui.alert('ยืนยันการนำเข้า',
    'จะนำเข้าข้อมูลจากแท็บ ' + legacy.getName() + '\n' +
    (CONFIG.MASK_MODE
      ? 'โหมดทดสอบเปิดอยู่ ชื่อ HN เบอร์โทร และที่อยู่จะถูกแทนด้วยข้อมูลสมมติ'
      : 'โหมดใช้งานจริง ข้อมูลจะถูกนำเข้าตามต้นฉบับ') + '\n\nดำเนินการต่อหรือไม่',
    ui.ButtonSet.YES_NO);
  if (answer !== ui.Button.YES) return;

  var result = migrateLegacy_(legacy);
  ui.alert('นำเข้าเสร็จแล้ว',
    'ผู้ป่วย ' + result.patients + ' ราย\n' +
    'ผลประเมิน BI ' + result.assessments + ' รายการ\n' +
    'การติดตาม ' + result.followups + ' รายการ\n\n' +
    'มีข้อมูลที่ต้องตรวจซ้ำ ' + result.issues + ' จุด ดูรายละเอียดในแท็บ ' + SHEETS.MIGRATION_REPORT,
    ui.ButtonSet.OK);
}

/**
 * หาแท็บข้อมูลเดิม ลองสามทางตามลำดับ
 *   1. ชื่อแท็บตามที่ตั้งไว้ใน CONFIG
 *   2. gid ของแท็บต้นฉบับ
 *   3. เดาจากหัวตาราง เผื่อผู้ใช้คัดลอกแท็บมาแล้วชื่อกลายเป็น "สำเนาของ ..."
 */
function findLegacySheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  var byName = ss.getSheetByName(CONFIG.LEGACY_SHEET_NAME);
  if (byName) return byName;

  var byGid = ss.getSheets().filter(function (s) {
    return s.getSheetId() === CONFIG.LEGACY_SHEET_GID;
  })[0];
  if (byGid) return byGid;

  return ss.getSheets().filter(function (s) {
    return !SCHEMA[s.getName()] && s.getName() !== SHEETS.SUMMARY && looksLikeLegacySheet_(s);
  })[0];
}

/** หัวตารางของไฟล์เดิมต้องมีคำเหล่านี้ครบจึงจะถือว่าใช่ */
function looksLikeLegacySheet_(sh) {
  if (sh.getLastRow() < 2 || sh.getLastColumn() < 20) return false;
  var header = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0]
    .map(function (v) { return String(v).trim(); });
  return ['HN', 'Dx', 'IMC program', 'BI 1'].every(function (want) {
    return header.indexOf(want) !== -1;
  });
}

function migrateLegacy_(legacy) {
  var rows = legacy.getDataRange().getValues();
  var report = [];
  var patients = [], assessments = [], followups = [];
  var now = nowIso_();
  var user = Session.getActiveUser().getEmail() || 'migration';

  for (var r = 1; r < rows.length; r++) {
    var row = rows[r];
    var seq = cell_(row, LEGACY.SEQ);
    var rawHn = cell_(row, LEGACY.HN);
    if (!seq && !rawHn) continue;                      // แถวว่างจากการจัดรูปแบบ

    var legacyRow = r + 1;
    var note = function (col, raw, issue, action) {
      report.push([legacyRow, rawHn, col, String(raw), issue, action]);
    };

    var hn = CONFIG.MASK_MODE ? maskHn_(seq || legacyRow) : String(rawHn).trim();
    var phones = String(cell_(row, LEGACY.PHONE)).split(/[\/,]/).map(function (s) { return s.trim(); });

    // ที่อยู่: ถ้ากลายเป็นวันที่ แปลว่าต้นฉบับเป็นบ้านเลขที่แบบ 3/11
    var addrRaw = cell_(row, LEGACY.ADDRESS);
    var address = String(addrRaw);
    if (isDateLike_(addrRaw)) {
      var back = dateBackToSlash_(addrRaw);
      note('ที่อยู่', addrRaw, 'บ้านเลขที่ถูกแปลงเป็นวันที่', 'กู้กลับเป็น ' + back + ' ควรตรวจกับแฟ้มจริง');
      address = back;
    }

    var admit = pickDate_(row, LEGACY.ADMIT, 'admit', note);
    var dc = pickDate_(row, LEGACY.DC, 'D/C', note);
    var start = pickDate_(row, LEGACY.START, 'วัน Start', note);
    var kbh = pickDate_(row, LEGACY.KBH_APPT, 'วันนัด KBH', note);
    var imcEnd = pickDate_(row, LEGACY.IMC_END, 'วันสิ้นสุด IMC', note);

    // ช่อง "วันที่ End" ในไฟล์เดิมบางแถวเก็บคะแนน BI แทนวันที่
    var endRaw = cell_(row, LEGACY.END);
    var endDate = '';
    var strayBi = null;
    if (endRaw !== '') {
      if (isBiScore_(endRaw)) {
        strayBi = parseInt(endRaw, 10);
        note('วันที่ End', endRaw, 'เป็นคะแนน BI ไม่ใช่วันที่', 'ย้ายไปเก็บเป็นคะแนน BI ครั้งสุดท้าย');
      } else {
        var p = parseLegacyDate_(endRaw);
        endDate = p.iso;
        if (p.issue) note('วันที่ End', endRaw, p.issue, p.iso ? 'แก้เป็น ' + p.iso : 'เว้นว่างไว้');
      }
    }

    var dx = fixVocab_(cell_(row, LEGACY.DX), DX_FIX);
    var dcReason = fixVocab_(cell_(row, LEGACY.DC_REASON), DC_REASON_FIX);

    var patient = {
      patient_id: seq || legacyRow - 1,
      cid: '',                                          // ไฟล์เดิมไม่มีเลขบัตร คอลัมน์ B เก็บลำดับเคส
      hn: hn,
      prefix: cell_(row, LEGACY.PREFIX),
      first_name: CONFIG.MASK_MODE ? maskName_(seq) : cell_(row, LEGACY.FIRST),
      last_name: CONFIG.MASK_MODE ? '' : cell_(row, LEGACY.LAST),
      sex: cell_(row, LEGACY.SEX),
      age: cell_(row, LEGACY.AGE),
      rights: cell_(row, LEGACY.RIGHTS),
      dx: dx,
      dx_group: dxGroupOf_(dx),
      address: CONFIG.MASK_MODE ? maskAddress_(address) : address,
      tambon: cell_(row, LEGACY.TAMBON),
      phone1: CONFIG.MASK_MODE ? maskPhone_(phones[0]) : (phones[0] || ''),
      phone2: CONFIG.MASK_MODE ? maskPhone_(phones[1]) : (phones[1] || ''),
      admit_date: admit,
      dc_date: dc,
      ward: cell_(row, LEGACY.WARD),
      imc_program: cell_(row, LEGACY.IMC_PROGRAM),
      kbh_appt_date: kbh,
      start_date: start,
      screening_result: normalizeScreening_(cell_(row, LEGACY.SCREENING)),
      end_date: endDate,
      imc_end_date: imcEnd,
      pt_visit_count: cell_(row, LEGACY.PT_COUNT),
      dc_reason: dcReason,
      home_visit: cell_(row, LEGACY.HOME_VISIT),
      six_month_status: cell_(row, LEGACY.SIX_MONTH),
      note: cell_(row, LEGACY.NOTE),
      status: dcReason ? 'closed' : 'active',
      legacy_row: legacyRow,
      created_by: user, created_at: now, updated_by: user, updated_at: now
    };

    // คะแนน BI ครั้งที่ 1-5 พร้อมวันที่ติดตามที่คู่กัน
    var biCols = [
      { seq: 1, col: LEGACY.BI1, dateCol: null,        label: 'BI 1' },
      { seq: 2, col: LEGACY.BI2, dateCol: LEGACY.FU2,  label: 'BI 2' },
      { seq: 3, col: LEGACY.BI3, dateCol: LEGACY.FU3,  label: 'BI 3' },
      { seq: 4, col: LEGACY.BI4, dateCol: LEGACY.FU4,  label: 'BI 4' },
      { seq: 5, col: LEGACY.BI5, dateCol: LEGACY.FU5,  label: 'BI 5' }
    ];

    var biList = [];
    biCols.forEach(function (b) {
      var raw = cell_(row, b.col);
      if (raw === '') return;

      if (!isBiScore_(raw)) {
        var asDate = parseLegacyDate_(raw);
        note(b.label, raw, 'ไม่ใช่คะแนน BI (0-20)',
          asDate.iso ? 'ตีความเป็นวันที่ ' + asDate.iso + ' เก็บเป็นการติดตามแทน' : 'ข้ามไป ต้องกรอกใหม่');
        if (asDate.iso) {
          followups.push(buildFollowup_(hn, followups.length + 1, asDate.iso, '', b.label + ' (นำเข้าจากไฟล์เดิม)', user, now));
        }
        return;
      }

      var dateInfo = b.dateCol ? parseLegacyDate_(cell_(row, b.dateCol)) : { iso: start, issue: '' };
      if (b.dateCol && dateInfo.issue) {
        note(b.label + ' - วันที่', cell_(row, b.dateCol), dateInfo.issue,
          dateInfo.iso ? 'ใช้ ' + dateInfo.iso : 'ไม่มีวันที่ ต้องกรอกใหม่');
      }
      biList.push({ seq: b.seq, total: parseInt(raw, 10), date: dateInfo.iso || '' });
    });

    // คะแนน BI ครั้งสุดท้ายที่บันทึกแยกไว้ หรือที่หลุดมาจากช่องวันที่ End
    var lastBiRaw = cell_(row, LEGACY.BI_LAST);
    var lastBi = isBiScore_(lastBiRaw) ? parseInt(lastBiRaw, 10) : strayBi;
    if (lastBi !== null && lastBi !== undefined) {
      var already = biList.filter(function (b) { return b.total === lastBi; }).length > 0;
      if (!already) {
        biList.push({ seq: biList.length + 1, total: lastBi, date: endDate || imcEnd || '' });
      }
    }

    biList.forEach(function (b) {
      assessments.push({
        assess_id: uid_('BI'),
        hn: hn, seq: b.seq, assess_date: b.date,
        feeding: '', transfer: '', grooming: '', toilet: '', bathing: '',
        mobility: '', stairs: '', dressing: '', bowels: '', bladder: '',
        total: b.total,
        multiple_impairment: '',
        imc_eligible: b.total < 15 ? 'TRUE' : '',
        ctf_group: ctfGroup_(b.total),
        note: 'นำเข้าจากไฟล์เดิม มีเฉพาะคะแนนรวม',
        assessed_by: user, created_at: now
      });
    });

    if (biList.length) {
      var sorted = biList.slice().sort(function (a, b) { return a.seq - b.seq; });
      patient.first_bi = sorted[0].total;
      patient.latest_bi = sorted[sorted.length - 1].total;
      patient.latest_bi_date = sorted[sorted.length - 1].date;
      patient.bi_count = sorted.length;
    }

    // ช่อง FU ที่มีข้อความอธิบายการติดตาม เช่น ยบ.IMC 11/11
    [LEGACY.FU2, LEGACY.FU3, LEGACY.FU4, LEGACY.FU5].forEach(function (c) {
      var raw = cell_(row, c);
      if (raw === '' || isDateLike_(raw)) return;
      var text = String(raw).trim();
      if (!/[ก-๙a-zA-Z]/.test(text)) return;
      var d = parseLegacyDate_(raw);
      followups.push(buildFollowup_(hn, followups.length + 1, d.iso,
        guessFuType_(text), text, user, now));
      if (!d.iso) note('ช่องติดตาม', raw, 'ไม่มีวันที่ชัดเจน', 'บันทึกข้อความไว้ ต้องเติมวันที่เอง');
    });

    patients.push(patient);
  }

  writeMigration_(patients, assessments, followups, report);
  return {
    patients: patients.length,
    assessments: assessments.length,
    followups: followups.length,
    issues: report.length
  };
}

function buildFollowup_(hn, seq, date, type, text, user, now) {
  return {
    fu_id: uid_('FU'), hn: hn, seq: seq, fu_date: date || '',
    fu_type: type || '', complications: '', note: text,
    recorded_by: user, created_at: now
  };
}

function guessFuType_(text) {
  var t = String(text);
  if (/ยบ|เยี่ยม/.test(t)) return 'เยี่ยมบ้าน';
  if (/OPD|opd/.test(t)) return 'OPD';
  if (/PT|pt|กายภาพ/.test(t)) return 'PT';
  return '';
}

function writeMigration_(patients, assessments, followups, report) {
  withLock_(function () {
    appendObjects_(SHEETS.PATIENTS, patients);
    appendObjects_(SHEETS.BI, assessments);
    appendObjects_(SHEETS.FOLLOWUPS, followups);

    var sh = sheet_(SHEETS.MIGRATION_REPORT);
    if (sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, 6).clearContent();
    if (report.length) {
      sh.getRange(2, 1, report.length, 6).setValues(report);
    }
  });
}

/** ลบเฉพาะข้อมูลที่มาจากการนำเข้า ไม่แตะข้อมูลที่กรอกผ่านแอป */
function clearMigratedData() {
  var ui = SpreadsheetApp.getUi();
  if (ui.alert('ยืนยัน', 'จะลบเฉพาะเวชระเบียนที่นำเข้าจากไฟล์เดิม พร้อมผลประเมินและการติดตามของรายเหล่านั้น',
    ui.ButtonSet.YES_NO) !== ui.Button.YES) return;

  withLock_(function () {
    var patients = readAll_(SHEETS.PATIENTS);
    var migratedHn = {};
    patients.forEach(function (p) { if (p.legacy_row) migratedHn[String(p.hn)] = true; });

    deleteRowsWhere_(SHEETS.PATIENTS, function (o) { return !!o.legacy_row; });
    deleteRowsWhere_(SHEETS.BI, function (o) { return migratedHn[String(o.hn)]; });
    deleteRowsWhere_(SHEETS.FOLLOWUPS, function (o) { return migratedHn[String(o.hn)]; });

    var rep = sheet_(SHEETS.MIGRATION_REPORT);
    if (rep.getLastRow() > 1) rep.getRange(2, 1, rep.getLastRow() - 1, 6).clearContent();
  });
  ui.alert('ลบข้อมูลที่นำเข้าเรียบร้อย');
}

function deleteRowsWhere_(sheetName, predicate) {
  var sh = sheet_(sheetName);
  var rows = readAll_(sheetName).filter(predicate).map(function (o) { return o._row; });
  rows.sort(function (a, b) { return b - a; }).forEach(function (r) { sh.deleteRow(r); });
}

/* ------------------------------------------------------------ ตัวช่วยเล็ก ๆ */

function cell_(row, col1Based) {
  var v = row[col1Based - 1];
  return (v === undefined || v === null) ? '' : v;
}

function isDateLike_(v) {
  if (Object.prototype.toString.call(v) === '[object Date]') return true;
  var n = parseFloat(v);
  return !isNaN(n) && String(v).indexOf('.') === -1 && n > 20000 && n < 60000;
}

/** คะแนน BI ต้องเป็นจำนวนเต็ม 0-20 เท่านั้น ค่าอื่นแปลว่าข้อมูลหลุดคอลัมน์ */
function isBiScore_(v) {
  if (v === '' || v === null || v === undefined) return false;
  if (Object.prototype.toString.call(v) === '[object Date]') return false;
  var n = Number(v);
  return !isNaN(n) && n >= 0 && n <= BI_MAX && Math.floor(n) === n;
}

/** กู้ค่าที่ถูกแปลงเป็นวันที่กลับเป็นข้อความแบบ วัน/เดือน เช่น 3/11 */
function dateBackToSlash_(v) {
  var d = (Object.prototype.toString.call(v) === '[object Date]')
    ? v
    : new Date(Date.UTC(1899, 11, 30) + Math.round(parseFloat(v)) * 86400000);
  var day = (Object.prototype.toString.call(v) === '[object Date]') ? d.getDate() : d.getUTCDate();
  var mon = (Object.prototype.toString.call(v) === '[object Date]') ? d.getMonth() + 1 : d.getUTCMonth() + 1;
  return day + '/' + mon;
}

function pickDate_(row, col, label, note) {
  var raw = cell_(row, col);
  if (raw === '') return '';
  var p = parseLegacyDate_(raw);
  if (p.issue) note(label, raw, p.issue, p.iso ? 'แก้เป็น ' + p.iso : 'เว้นว่างไว้ ต้องกรอกใหม่');
  return p.iso;
}

function normalizeScreening_(v) {
  var s = String(v).trim().toLowerCase();
  if (s === 'imc') return 'IMC';
  if (s === 'noimc' || s === 'no imc') return 'NoIMC';
  return '';
}

function fixVocab_(v, table) {
  var s = String(v).trim();
  if (!s) return '';
  var key = s.toLowerCase().replace(/\s+/g, ' ').trim();
  return table[key] || s;
}
