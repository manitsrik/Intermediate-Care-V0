/**
 * ฟังก์ชันฝั่งเซิร์ฟเวอร์ที่หน้าเว็บเรียกใช้ผ่าน google.script.run
 *
 * หลักการ: คะแนน BI ผลคัดกรอง และลำดับครั้ง คำนวณที่ฝั่งนี้เสมอ
 * ไม่เชื่อค่าที่ส่งมาจากหน้าจอ เพื่อให้ข้อมูลในชีตสอดคล้องกันตลอด
 */

/* ------------------------------------------------------------------- สิทธิ์ */

function currentUser_() {
  var email = Session.getActiveUser().getEmail() || '';
  var users = readAll_(SHEETS.USERS);
  var active = users.filter(function (u) {
    return String(u.active).toUpperCase() !== 'FALSE' && String(u.email).trim() !== '';
  });

  // ยังไม่มีใครในตาราง users เลย ถือว่าอยู่ระหว่างติดตั้ง อนุญาตให้คนที่เปิดไฟล์ได้ใช้งาน
  if (!active.length) {
    return { email: email, name: email, role: 'staff', bootstrap: true };
  }

  var me = active.filter(function (u) {
    return String(u.email).trim().toLowerCase() === email.toLowerCase();
  })[0];

  if (!me) {
    throw new Error('บัญชี ' + email + ' ยังไม่มีสิทธิ์ใช้งาน กรุณาให้ผู้ดูแลเพิ่มอีเมลนี้ในชีต users');
  }
  return { email: email, name: me.name || email, role: me.role || 'staff', bootstrap: false };
}

/* ---------------------------------------------------------------- ตั้งต้น */

/** ข้อมูลชุดแรกที่หน้าเว็บต้องใช้ เรียกครั้งเดียวตอนเปิดแอป */
function apiBootstrap() {
  var user = currentUser_();
  return {
    user: user,
    appName: CONFIG.APP_NAME,
    org: CONFIG.ORG,
    maskMode: CONFIG.MASK_MODE,
    biItems: BI_ITEMS,
    biMax: BI_MAX,
    vocab: VOCAB,
    today: todayIso_()
  };
}

/* --------------------------------------------------------------- ผู้ป่วย */

function displayPatient_(p) {
  var o = {};
  Object.keys(p).forEach(function (k) { o[k] = p[k]; });
  o.full_name = [p.prefix, p.first_name, p.last_name].filter(String).join(' ').trim();
  o.admit_date_th = toThaiDate_(p.admit_date);
  o.start_date_th = toThaiDate_(p.start_date);
  o.imc_end_date_th = toThaiDate_(p.imc_end_date);
  o.latest_bi_date_th = toThaiDate_(p.latest_bi_date);
  return o;
}

/** รายชื่อผู้ป่วยสำหรับหน้าแรก รองรับค้นหาและกรองสถานะ */
function apiListPatients(opts) {
  currentUser_();
  opts = opts || {};
  var q = String(opts.q || '').trim().toLowerCase();
  var status = opts.status || '';
  var screening = opts.screening || '';

  return readAll_(SHEETS.PATIENTS)
    .filter(function (p) {
      if (status && String(p.status) !== status) return false;
      if (screening && String(p.screening_result) !== screening) return false;
      if (!q) return true;
      var hay = [p.hn, p.cid, p.first_name, p.last_name, p.tambon, p.dx].join(' ').toLowerCase();
      return hay.indexOf(q) !== -1;
    })
    .map(displayPatient_)
    .sort(function (a, b) {
      return String(b.start_date || '').localeCompare(String(a.start_date || ''));
    });
}

/** ข้อมูลผู้ป่วยหนึ่งรายพร้อมประวัติ BI และการติดตามทั้งหมด */
function apiGetPatient(hn) {
  currentUser_();
  var p = findPatientByHn_(hn);
  if (!p) throw new Error('ไม่พบผู้ป่วย HN ' + hn);

  var bi = readAll_(SHEETS.BI)
    .filter(function (r) { return String(r.hn) === String(hn); })
    .sort(function (a, b) { return Number(a.seq) - Number(b.seq); })
    .map(function (r) { r.assess_date_th = toThaiDate_(r.assess_date); return r; });

  var fu = readAll_(SHEETS.FOLLOWUPS)
    .filter(function (r) { return String(r.hn) === String(hn); })
    .sort(function (a, b) { return Number(a.seq) - Number(b.seq); })
    .map(function (r) { r.fu_date_th = toThaiDate_(r.fu_date); return r; });

  return { patient: displayPatient_(p), assessments: bi, followups: fu };
}

function findPatientByHn_(hn) {
  return readAll_(SHEETS.PATIENTS).filter(function (p) {
    return String(p.hn).trim() === String(hn).trim();
  })[0];
}

/**
 * บันทึกผู้ป่วย ถ้าไม่มี patient_id ถือเป็นรายใหม่
 * ค่าที่ระบบคำนวณเอง: dx_group, six_month_status, imc_end_date
 */
function apiSavePatient(form) {
  var user = currentUser_();
  return withLock_(function () {
    var all = readAll_(SHEETS.PATIENTS);
    var hn = String(form.hn || '').trim();
    if (!hn) throw new Error('กรุณากรอก HN');

    var existing = all.filter(function (p) { return String(p.hn).trim() === hn; })[0];
    var isNew = !form.patient_id;

    if (isNew && existing) {
      throw new Error('มีผู้ป่วย HN ' + hn + ' อยู่แล้ว (' +
        [existing.prefix, existing.first_name].join('') + ') กรุณาเปิดเวชระเบียนเดิมแทน');
    }
    if (!isNew && existing && String(existing.patient_id) !== String(form.patient_id)) {
      throw new Error('HN ' + hn + ' ถูกใช้กับผู้ป่วยรายอื่นแล้ว');
    }

    var target = isNew ? {} : all.filter(function (p) {
      return String(p.patient_id) === String(form.patient_id);
    })[0];
    if (!isNew && !target) throw new Error('ไม่พบเวชระเบียนที่ต้องการแก้ไข');

    var rec = {};
    SCHEMA[SHEETS.PATIENTS].forEach(function (f) {
      rec[f] = (form[f] !== undefined) ? form[f] : (target[f] !== undefined ? target[f] : '');
    });

    rec.dx_group = dxGroupOf_(rec.dx);
    rec.six_month_status = computeSixMonth_(rec.start_date, rec.imc_end_date);
    if (rec.start_date && !rec.imc_end_date) {
      rec.imc_end_date = addDaysIso_(rec.start_date, CONFIG.IMC_DURATION_DAYS);
    }
    if (!rec.status) rec.status = 'active';

    if (isNew) {
      rec.patient_id = nextPatientId_(all);
      rec.created_by = user.email;
      rec.created_at = nowIso_();
    }
    rec.updated_by = user.email;
    rec.updated_at = nowIso_();

    if (isNew) {
      appendObject_(SHEETS.PATIENTS, rec);
    } else {
      updateObject_(SHEETS.PATIENTS, target._row, rec);
    }
    return { ok: true, hn: rec.hn, patient_id: rec.patient_id };
  });
}

function nextPatientId_(all) {
  var max = 0;
  all.forEach(function (p) {
    var n = parseInt(p.patient_id, 10);
    if (!isNaN(n) && n > max) max = n;
  });
  return max + 1;
}

function dxGroupOf_(dx) {
  var hit = VOCAB.DX.filter(function (d) { return d.value === dx; })[0];
  return hit ? hit.group : '';
}

/** ครบ 6 เดือนหรือยัง นับจากวัน start ตาม CONFIG.IMC_DURATION_DAYS */
function computeSixMonth_(startDate, imcEndDate) {
  if (!startDate) return '';
  var due = imcEndDate || addDaysIso_(startDate, CONFIG.IMC_DURATION_DAYS);
  return todayIso_() >= due ? 'ครบ' : 'ไม่ครบ';
}

/* ------------------------------------------------------------ ประเมิน BI */

function apiSaveBi(form) {
  var user = currentUser_();
  return withLock_(function () {
    var hn = String(form.hn || '').trim();
    if (!findPatientByHn_(hn)) throw new Error('ไม่พบผู้ป่วย HN ' + hn);
    if (!form.assess_date) throw new Error('กรุณาเลือกวันที่ประเมิน');

    var result = evaluateBi_(form, form.multiple_impairment);
    var existing = readAll_(SHEETS.BI).filter(function (r) { return String(r.hn) === hn; });

    var rec = {
      assess_id: form.assess_id || uid_('BI'),
      hn: hn,
      seq: form.seq || (existing.length + 1),
      assess_date: form.assess_date,
      total: result.total,
      multiple_impairment: form.multiple_impairment ? 'TRUE' : 'FALSE',
      imc_eligible: result.imc_eligible ? 'TRUE' : 'FALSE',
      ctf_group: result.ctf_group,
      note: form.note || '',
      assessed_by: user.email,
      created_at: nowIso_()
    };
    BI_ITEMS.forEach(function (item) { rec[item.key] = form[item.key]; });

    var old = existing.filter(function (r) { return String(r.assess_id) === String(form.assess_id); })[0];
    if (old) {
      rec.created_at = old.created_at;
      updateObject_(SHEETS.BI, old._row, rec);
    } else {
      appendObject_(SHEETS.BI, rec);
    }

    refreshPatientBiStats_(hn);
    return { ok: true, result: result, seq: rec.seq };
  });
}

/**
 * อัปเดตสรุปคะแนน BI ลงในแถวผู้ป่วย
 * ทำให้หน้ารายชื่อและชีต summary ไม่ต้องคำนวณข้ามตารางทุกครั้ง
 */
function refreshPatientBiStats_(hn) {
  var list = readAll_(SHEETS.BI)
    .filter(function (r) { return String(r.hn) === String(hn); })
    .sort(function (a, b) { return Number(a.seq) - Number(b.seq); });
  if (!list.length) return;

  var p = findPatientByHn_(hn);
  if (!p) return;

  var first = list[0], last = list[list.length - 1];
  p.first_bi = first.total;
  p.latest_bi = last.total;
  p.latest_bi_date = last.assess_date;
  p.bi_count = list.length;
  if (!p.screening_result) {
    p.screening_result = String(first.imc_eligible).toUpperCase() === 'TRUE' ? 'IMC' : 'NoIMC';
  }
  p.updated_at = nowIso_();
  updateObject_(SHEETS.PATIENTS, p._row, p);
}

/* -------------------------------------------------------------- ติดตามผล */

function apiSaveFollowup(form) {
  var user = currentUser_();
  return withLock_(function () {
    var hn = String(form.hn || '').trim();
    if (!findPatientByHn_(hn)) throw new Error('ไม่พบผู้ป่วย HN ' + hn);
    if (!form.fu_date) throw new Error('กรุณาเลือกวันที่ติดตาม');

    var existing = readAll_(SHEETS.FOLLOWUPS).filter(function (r) { return String(r.hn) === hn; });
    var rec = {
      fu_id: form.fu_id || uid_('FU'),
      hn: hn,
      seq: form.seq || (existing.length + 1),
      fu_date: form.fu_date,
      fu_type: form.fu_type || '',
      complications: form.complications || '',
      note: form.note || '',
      recorded_by: user.email,
      created_at: nowIso_()
    };

    var old = existing.filter(function (r) { return String(r.fu_id) === String(form.fu_id); })[0];
    if (old) {
      rec.created_at = old.created_at;
      updateObject_(SHEETS.FOLLOWUPS, old._row, rec);
    } else {
      appendObject_(SHEETS.FOLLOWUPS, rec);
    }

    refreshPtVisitCount_(hn);
    return { ok: true, seq: rec.seq };
  });
}

function refreshPtVisitCount_(hn) {
  var n = readAll_(SHEETS.FOLLOWUPS).filter(function (r) {
    return String(r.hn) === String(hn) && String(r.fu_type) === 'PT';
  }).length;
  var p = findPatientByHn_(hn);
  if (!p) return;
  p.pt_visit_count = n;
  p.updated_at = nowIso_();
  updateObject_(SHEETS.PATIENTS, p._row, p);
}

/** การติดตามทั้งหมดเรียงจากใหม่ไปเก่า พร้อมชื่อผู้ป่วยเพื่อให้หน้าเว็บไม่ต้องดึงซ้ำ */
function apiListFollowups(limit) {
  currentUser_();
  var nameByHn = {};
  readAll_(SHEETS.PATIENTS).forEach(function (p) {
    nameByHn[String(p.hn)] = [p.prefix, p.first_name, p.last_name].filter(String).join(' ').trim();
  });

  return readAll_(SHEETS.FOLLOWUPS)
    .filter(function (r) { return r.fu_date; })
    .sort(function (a, b) { return String(b.fu_date).localeCompare(String(a.fu_date)); })
    .slice(0, limit || 60)
    .map(function (r) {
      r.patient_name = nameByHn[String(r.hn)] || '';
      r.fu_date_th = toThaiDate_(r.fu_date);
      return r;
    });
}

/* -------------------------------------------------------------- จบโปรแกรม */

function apiClosePatient(form) {
  var user = currentUser_();
  return withLock_(function () {
    var p = findPatientByHn_(form.hn);
    if (!p) throw new Error('ไม่พบผู้ป่วย HN ' + form.hn);
    p.status = 'closed';
    p.end_date = form.end_date || todayIso_();
    p.dc_reason = form.dc_reason || '';
    p.note = form.note || p.note;
    p.six_month_status = computeSixMonth_(p.start_date, p.imc_end_date);
    p.updated_by = user.email;
    p.updated_at = nowIso_();
    updateObject_(SHEETS.PATIENTS, p._row, p);
    return { ok: true };
  });
}

/* ------------------------------------------------------------ ภาพรวมงาน */

function apiDashboard() {
  currentUser_();
  var patients = readAll_(SHEETS.PATIENTS);
  var byMonth = {};
  var imc = 0, noImc = 0, active = 0, closed = 0;
  var gains = [];

  patients.forEach(function (p) {
    if (String(p.screening_result) === 'IMC') imc++;
    if (String(p.screening_result) === 'NoIMC') noImc++;
    if (String(p.status) === 'closed') closed++; else active++;

    var d = String(p.start_date || '');
    if (d.length >= 7) {
      var key = d.substring(0, 7);
      byMonth[key] = (byMonth[key] || 0) + 1;
    }
    var a = parseFloat(p.first_bi), b = parseFloat(p.latest_bi);
    if (!isNaN(a) && !isNaN(b)) gains.push(b - a);
  });

  var months = Object.keys(byMonth).sort().slice(-12).map(function (k) {
    return { month: k, count: byMonth[k] };
  });

  // นัดหมายที่ยังมาไม่ถึง เรียงจากใกล้ที่สุด ใช้เตือนงานที่ต้องทำ
  var today = todayIso_();
  var upcoming = patients
    .filter(function (p) {
      return p.kbh_appt_date && String(p.kbh_appt_date) >= today && String(p.status) !== 'closed';
    })
    .sort(function (a, b) { return String(a.kbh_appt_date).localeCompare(String(b.kbh_appt_date)); })
    .slice(0, 6)
    .map(function (p) {
      return {
        hn: p.hn,
        name: [p.prefix, p.first_name, p.last_name].filter(String).join(' ').trim(),
        program: p.imc_program,
        date: p.kbh_appt_date,
        days_left: daysBetweenIso_(today, String(p.kbh_appt_date))
      };
    });

  return {
    upcoming: upcoming,
    total: patients.length,
    imc: imc,
    noImc: noImc,
    active: active,
    closed: closed,
    avgGain: gains.length
      ? Math.round((gains.reduce(function (s, v) { return s + v; }, 0) / gains.length) * 10) / 10
      : null,
    improved: gains.filter(function (v) { return v > 0; }).length,
    months: months
  };
}
