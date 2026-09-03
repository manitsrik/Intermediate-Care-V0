/**
 * ประกอบไฟล์พรีวิวสำหรับเปิดดูหน้าจอบนเครื่อง โดยไม่ต้อง deploy
 *
 *   node tools/build-preview.js   แล้วเปิด preview/index.html ในเบราว์เซอร์
 *
 * ตัวพรีวิวใช้ css.html กับ js.html ตัวจริง จึงไม่มีทางเพี้ยนจากของที่ deploy
 * ส่วนฝั่งเซิร์ฟเวอร์แทนด้วยข้อมูลปลอมในหน่วยความจำ ปิดหน้าต่างแล้วหายไป
 *
 * ข้อจำกัด: เป็นการพรีวิวหน้าจอเท่านั้น ไม่ได้ทดสอบโค้ดที่คุยกับ Google Sheet
 * ตรรกะที่ต้องเชื่อจริง ๆ ให้ทดสอบผ่านลิงก์ /dev
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'apps-script');
const OUT = path.join(ROOT, 'preview');

const read = (f) => fs.readFileSync(path.join(SRC, f), 'utf8');

/** ดึงเนื้อในของ .html ที่เป็น <style> หรือ <script> ของ Apps Script มาใช้ตรง ๆ */
const css = read('css.html');
const js = read('js.html');
const shell = read('index.html');

/** Config.gs กับ Bi.gs เป็น JavaScript ล้วน เอามาใช้ในตัวจำลองได้เลย ไม่ต้องเขียนซ้ำ */
const config = read('Config.gs');
const bi = read('Bi.gs');

const mock = `
<script>
${config}
${bi}

/* ---------------------------------------------------- ข้อมูลปลอมสำหรับพรีวิว */

var DB = {
  patients: [
    p(1, 'TEST001', 'นาย', 'ทดสอบ 1', 'M', 62, 'UC', 'Ischemic stroke', 'SU', '2025-10-27',
      'IMC', 'active', 13, 16, 4, 'right', 'นัด OPD KBH', '2026-09-05'),
    p(2, 'TEST002', 'น.ส.', 'ทดสอบ 2', 'F', 53, 'UC', 'Hemorrhagic stroke', 'SU', '2025-12-01',
      'IMC', 'closed', 8, 18, 3, 'left', 'ส่งต่อคลีนิก สปสช.', ''),
    p(3, 'TEST003', 'นาย', 'ทดสอบ 3', 'M', 47, 'ปกส.', 'Recurrent stroke', 'SU', '2025-11-30',
      'NoIMC', 'active', 18, 18, 2, '', 'กลับบ้าน', '2026-09-04'),
    p(4, 'TEST004', 'น.ส.', 'ทดสอบ 4', 'F', 34, 'UC', 'TBI', 'ศญ', '2025-11-28',
      'IMC', 'active', 0, 4, 3, '', 'เยี่ยมบ้าน', '2026-09-12'),
    p(5, 'TEST005', 'นาย', 'ทดสอบ 5', 'M', 28, 'ขรก.', 'SCI', 'ortho', '2025-11-23',
      'IMC', 'active', 5, 9, 2, '', 'นัด OPD KBH', ''),
    p(6, 'TEST006', 'นาง', 'ทดสอบ 6', 'F', 71, 'UC', 'Minor stroke', 'SU', '2025-11-10',
      'NoIMC', 'closed', 17, 17, 1, '', 'กลับบ้าน', '')
  ],
  bi: [],
  fu: [],
  users: [
    { email: 'preview@local', name: 'พรีวิวบนเครื่อง', role: 'admin', active: true, added_at: '' },
    { email: 'nurse1@example.org', name: 'สมศรี (พยาบาล)', role: 'staff', active: true, added_at: '' },
    { email: 'pt1@example.org', name: 'สมชาย (นักกายภาพบำบัด)', role: 'staff', active: false, added_at: '', fileAccess: false }
  ]
};

function p(id, hn, prefix, name, sex, age, rights, dx, ward, start, screening, status,
           firstBi, lastBi, biCount, side, program, appt) {
  return {
    patient_id: id, hn: hn, cid: '1-xxxx-xxxxx-xx-x', prefix: prefix,
    first_name: name, last_name: '', sex: sex, age: age, rights: rights,
    dx: dx, dx_group: 'stroke', dx_detail: '', rt_pa: '', hemiparesis_side: side,
    ct_mri: 'Infarction at left MCA', operation: '', underlying: 'HT, DM type 2',
    other_problems: '', address: 'xxx', tambon: 'ปากน้ำ',
    phone1: '08x-xxx-xxxx', phone2: '',
    admit_date: '2025-10-21', dc_date: '2025-11-02', ward: ward,
    imc_program: program, kbh_appt_date: appt, kbh_appt_time: '', kbh_hospital: '',
    start_date: start, screening_result: screening,
    first_bi: firstBi, latest_bi: lastBi, latest_bi_date: '2026-02-16', bi_count: biCount,
    end_date: '', imc_end_date: '2026-04-28', pt_visit_count: biCount + 2,
    dc_reason: status === 'closed' ? 'BI > 15' : '',
    home_visit: '', six_month_status: 'ไม่ครบ', note: '',
    status: status, legacy_row: '', created_by: 'preview@local',
    created_at: '', updated_by: '', updated_at: ''
  };
}

// สร้างผลประเมินและการติดตามให้พอเห็นกราฟและไทม์ไลน์
DB.patients.forEach(function (pt) {
  var n = Number(pt.bi_count) || 1;
  var step = (Number(pt.latest_bi) - Number(pt.first_bi)) / Math.max(n - 1, 1);
  for (var i = 0; i < n; i++) {
    var total = Math.round(Number(pt.first_bi) + step * i);
    DB.bi.push({
      assess_id: pt.hn + '-BI' + (i + 1), hn: pt.hn, seq: i + 1,
      assess_date: ['2025-10-27', '2025-11-11', '2025-12-09', '2026-02-16'][i] || '2026-02-16',
      total: total, multiple_impairment: 'FALSE',
      imc_eligible: total < 15 ? 'TRUE' : 'FALSE', ctf_group: ctfGroup_(total),
      note: 'ข้อมูลตัวอย่างสำหรับพรีวิว', assessed_by: 'preview@local', created_at: ''
    });
  }
  ['เดินด้วย walker ได้เอง ไม่มีแผลกดทับ', 'ฝึกลุกนั่งและยืนทรงตัว ขาขวาแรงขึ้น']
    .forEach(function (txt, i) {
      DB.fu.push({
        fu_id: pt.hn + '-FU' + (i + 1), hn: pt.hn, seq: i + 1,
        fu_date: ['2025-12-09', '2026-02-16'][i], fu_type: ['PT', 'เยี่ยมบ้าน'][i],
        complications: txt, note: '', recorded_by: 'preview@local', created_at: ''
      });
    });
});

/* ------------------------------------------------- ตัวจำลอง google.script.run */

function thai_(iso) {
  var m = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];
  if (!iso) return '';
  var s = String(iso).split('-');
  return s.length === 3 ? parseInt(s[2], 10) + ' ' + m[parseInt(s[1], 10) - 1] + ' ' + s[0] : iso;
}

function full_(pt) { return [pt.prefix, pt.first_name, pt.last_name].filter(String).join(' ').trim(); }

var API = {
  apiListUsers: function () {
    return DB.users.map(function (u) {
      var o = JSON.parse(JSON.stringify(u));
      o.fileAccess = u.fileAccess !== false;
      return o;
    });
  },

  apiShareFile: function (email) {
    var row = DB.users.filter(function (u) { return u.email === email; })[0];
    if (row) row.fileAccess = true;
    return { ok: true, email: email, already: false };
  },

  apiRevokeFile: function (email) {
    var row = DB.users.filter(function (u) { return u.email === email; })[0];
    if (row) row.fileAccess = false;
    return { ok: true, email: email, already: false };
  },

  apiSaveUser: function (form) {
    var email = String(form.email || '').trim().toLowerCase();
    if (!email) throw new Error('กรุณากรอกอีเมล');
    var row = DB.users.filter(function (u) { return u.email === email; })[0];
    var created = !row;
    if (created) { row = { email: email, added_at: '' }; DB.users.push(row); }
    row.name = form.name || row.name || '';
    row.role = form.role || 'staff';
    row.active = String(form.active).toUpperCase() !== 'FALSE';
    row.fileAccess = row.active;
    return row.active
      ? { ok: true, email: email, created: created, active: true, shared: true, alreadyShared: false, shareError: '' }
      : { ok: true, email: email, created: false, active: false, revoked: true, alreadyRevoked: false, revokeError: '' };
  },

  apiBootstrap: function () {
    return {
      user: { email: 'preview@local', name: 'พรีวิวบนเครื่อง', role: 'admin', isAdmin: true },
      appName: CONFIG.APP_NAME, org: CONFIG.ORG, maskMode: true,
      biItems: BI_ITEMS, biMax: BI_MAX, vocab: VOCAB,
      today: new Date().toISOString().slice(0, 10)
    };
  },

  apiListPatients: function (opts) {
    opts = opts || {};
    var q = String(opts.q || '').toLowerCase();
    return DB.patients.filter(function (pt) {
      if (opts.status && pt.status !== opts.status) return false;
      if (opts.screening && pt.screening_result !== opts.screening) return false;
      if (!q) return true;
      return [pt.hn, pt.first_name, pt.tambon, pt.dx].join(' ').toLowerCase().indexOf(q) !== -1;
    }).map(function (pt) {
      var o = JSON.parse(JSON.stringify(pt));
      o.full_name = full_(pt);
      return o;
    });
  },

  apiGetPatient: function (hn) {
    var pt = DB.patients.filter(function (x) { return x.hn === hn; })[0];
    if (!pt) throw new Error('ไม่พบผู้ป่วย HN ' + hn);
    var o = JSON.parse(JSON.stringify(pt));
    o.full_name = full_(pt);
    return {
      patient: o,
      assessments: DB.bi.filter(function (b) { return b.hn === hn; }),
      followups: DB.fu.filter(function (f) { return f.hn === hn; })
    };
  },

  apiSavePatient: function (form) {
    var pt = DB.patients.filter(function (x) { return String(x.patient_id) === String(form.patient_id); })[0];
    if (pt) { Object.keys(form).forEach(function (k) { pt[k] = form[k]; }); return { ok: true, hn: pt.hn }; }
    var rec = p(DB.patients.length + 1, form.hn, form.prefix, form.first_name, form.sex,
      form.age, form.rights, form.dx, form.ward, form.start_date, '', 'active', '', '', 0, '', form.imc_program, form.kbh_appt_date);
    Object.keys(form).forEach(function (k) { if (form[k] !== '') rec[k] = form[k]; });
    DB.patients.unshift(rec);
    return { ok: true, hn: rec.hn };
  },

  apiSaveBi: function (form) {
    var result = evaluateBi_(form, form.multiple_impairment);
    var seq = DB.bi.filter(function (b) { return b.hn === form.hn; }).length + 1;
    var rec = { assess_id: 'new' + seq, hn: form.hn, seq: seq, assess_date: form.assess_date,
      total: result.total, multiple_impairment: form.multiple_impairment ? 'TRUE' : 'FALSE',
      imc_eligible: result.imc_eligible ? 'TRUE' : 'FALSE', ctf_group: result.ctf_group,
      note: form.note || '', assessed_by: 'preview@local', created_at: '' };
    DB.bi.push(rec);
    var pt = DB.patients.filter(function (x) { return x.hn === form.hn; })[0];
    if (pt) { pt.latest_bi = result.total; pt.bi_count = seq; if (!pt.first_bi) pt.first_bi = result.total; }
    return { ok: true, result: result, seq: seq };
  },

  apiSaveFollowup: function (form) {
    var seq = DB.fu.filter(function (f) { return f.hn === form.hn; }).length + 1;
    DB.fu.push({ fu_id: 'new' + seq, hn: form.hn, seq: seq, fu_date: form.fu_date,
      fu_type: form.fu_type, complications: form.complications || '', note: form.note || '',
      recorded_by: 'preview@local', created_at: '' });
    return { ok: true, seq: seq };
  },

  apiClosePatient: function (form) {
    var pt = DB.patients.filter(function (x) { return x.hn === form.hn; })[0];
    if (pt) { pt.status = 'closed'; pt.dc_reason = form.dc_reason; pt.end_date = form.end_date; }
    return { ok: true };
  },

  apiListFollowups: function (limit) {
    return DB.fu.slice().sort(function (a, b) {
      return String(b.fu_date).localeCompare(String(a.fu_date));
    }).slice(0, limit || 60).map(function (f) {
      var pt = DB.patients.filter(function (x) { return x.hn === f.hn; })[0];
      var o = JSON.parse(JSON.stringify(f));
      o.patient_name = pt ? full_(pt) : '';
      o.fu_date_th = thai_(f.fu_date);
      return o;
    });
  },

  apiDashboard: function () {
    var imc = DB.patients.filter(function (x) { return x.screening_result === 'IMC'; }).length;
    var noImc = DB.patients.filter(function (x) { return x.screening_result === 'NoIMC'; }).length;
    var closed = DB.patients.filter(function (x) { return x.status === 'closed'; }).length;
    var gains = DB.patients.map(function (x) { return Number(x.latest_bi) - Number(x.first_bi); })
      .filter(function (v) { return !isNaN(v); });
    var byMonth = {};
    DB.patients.forEach(function (x) {
      var k = String(x.start_date).slice(0, 7);
      if (k) byMonth[k] = (byMonth[k] || 0) + 1;
    });
    return {
      upcoming: DB.patients.filter(function (x) { return x.kbh_appt_date; })
        .map(function (x, i) {
          return { hn: x.hn, name: full_(x), program: x.imc_program,
                   date: x.kbh_appt_date, days_left: i };
        }),
      total: DB.patients.length, imc: imc, noImc: noImc,
      active: DB.patients.length - closed, closed: closed,
      avgGain: Math.round(gains.reduce(function (s, v) { return s + v; }, 0) / gains.length * 10) / 10,
      improved: gains.filter(function (v) { return v > 0; }).length,
      months: Object.keys(byMonth).sort().map(function (k) { return { month: k, count: byMonth[k] }; })
    };
  }
};

/** เลียนแบบรูปแบบการเรียกของ Apps Script รวมถึงหน่วงเวลาให้เหมือนของจริง */
var google = { script: { run: {} } };
(function () {
  function make(success, failure) {
    var runner = {};
    Object.keys(API).forEach(function (name) {
      runner[name] = function () {
        var args = arguments;
        setTimeout(function () {
          try {
            var out = API[name].apply(null, args);
            if (success) success(out);
          } catch (e) {
            if (failure) failure(e); else console.error(e);
          }
        }, 180);
      };
    });
    runner.withSuccessHandler = function (fn) { return make(fn, failure); };
    runner.withFailureHandler = function (fn) { return make(success, fn); };
    return runner;
  }
  google.script.run = make(null, null);
})();

console.log('พรีวิวบนเครื่อง: ข้อมูลทั้งหมดเป็นของปลอมและไม่ถูกบันทึกที่ไหน');
</script>
`;

const html = shell
  .replace('<?!= include(\'css\'); ?>', css)
  .replace('<?!= include(\'js\'); ?>', mock + js)
  .replace('<head>', '<head>\n  <meta name="viewport" content="width=device-width, initial-scale=1">');

fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'index.html'), html, 'utf8');

console.log('เขียน preview/index.html แล้ว (' + Math.round(html.length / 1024) + ' KB)');
console.log('เปิดไฟล์นี้ในเบราว์เซอร์ได้เลย ไม่ต้องมีเซิร์ฟเวอร์');
