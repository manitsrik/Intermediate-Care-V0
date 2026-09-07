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
    return { email: email, name: email, role: 'admin', isAdmin: true, bootstrap: true };
  }

  var me = active.filter(function (u) {
    return String(u.email).trim().toLowerCase() === email.toLowerCase();
  })[0];

  if (!me) {
    throw new Error('บัญชี ' + email + ' ยังไม่มีสิทธิ์ใช้งาน กรุณาให้ผู้ดูแลเพิ่มอีเมลนี้ในชีต users');
  }

  var role = String(me.role || 'staff').toLowerCase();

  /*
    ถ้ายังไม่มีใครเป็นผู้ดูแลระบบเลย ให้ผู้ใช้ที่ลงทะเบียนไว้ทำหน้าที่แทนไปก่อน
    ไม่งั้นจะไม่มีใครเพิ่มผู้ใช้ได้เลยนอกจากเข้าไปแก้ในชีตดิบ
    พอมีผู้ดูแลคนแรกแล้วช่องทางนี้จะปิดทันที
  */
  var hasAdmin = active.filter(function (u) {
    return String(u.role).toLowerCase() === 'admin';
  }).length > 0;

  return {
    email: email, name: me.name || email, role: role,
    isAdmin: role === 'admin' || !hasAdmin,
    noAdminYet: !hasAdmin,
    bootstrap: false
  };
}

/** ตั้งตัวเองเป็นผู้ดูแลระบบ ใช้ได้เฉพาะตอนที่ยังไม่มีผู้ดูแลคนใดในระบบ */
function apiClaimAdmin() {
  var email = String(Session.getActiveUser().getEmail() || '').trim();
  if (!email) throw new Error('อ่านอีเมลของผู้ใช้ไม่ได้');

  return withLock_(function () {
    var rows = readAll_(SHEETS.USERS);
    var admins = rows.filter(function (u) {
      return String(u.role).toLowerCase() === 'admin' && String(u.active).toUpperCase() !== 'FALSE';
    });
    if (admins.length) {
      throw new Error('มีผู้ดูแลระบบอยู่แล้ว ให้ผู้ดูแลคนนั้นเป็นผู้เพิ่มสิทธิ์ให้');
    }

    var me = rows.filter(function (u) {
      return String(u.email).trim().toLowerCase() === email.toLowerCase();
    })[0];

    var rec = {
      email: email,
      name: me ? me.name : '',
      role: 'admin',
      active: 'TRUE',
      added_at: me ? (me.added_at || nowIso_()) : nowIso_()
    };
    if (me) updateObject_(SHEETS.USERS, me._row, rec);
    else appendObject_(SHEETS.USERS, rec);

    return { ok: true, email: email };
  });
}

/** ใช้กับฟังก์ชันที่ผู้ใช้ทั่วไปไม่ควรเรียกได้ */
function requireAdmin_() {
  var u = currentUser_();
  if (!u.isAdmin && !u.bootstrap) {
    throw new Error('เฉพาะผู้ดูแลระบบเท่านั้นที่ทำรายการนี้ได้');
  }
  return u;
}

/* ------------------------------------------------------- โหมดทดสอบ */

var MASK_PROP_ = 'MASK_MODE';

/**
 * โหมดทดสอบที่ระบบใช้อยู่จริงตอนนี้
 *
 * CONFIG.MASK_MODE เป็นค่าตั้งต้นของไฟล์ ส่วนค่าที่ผู้ดูแลสลับเองในหน้าตั้งค่าเก็บใน
 * Script Properties เพราะนี่คือสวิตช์เดียวที่กั้นระหว่างข้อมูลสมมติกับข้อมูลคนไข้จริง
 * คนที่ต้องกดคือผู้ดูแลของโรงพยาบาล ไม่ควรต้องรอให้ใครมาแก้โค้ดแล้ว push ใหม่ให้
 */
function maskMode_() {
  try {
    var v = PropertiesService.getScriptProperties().getProperty(MASK_PROP_);
    if (v === 'TRUE') return true;
    if (v === 'FALSE') return false;
  } catch (e) {
    // อ่าน property ไม่ได้ ให้ถอยไปใช้ค่าตั้งต้นในไฟล์ ซึ่งเป็นฝั่งที่ปลอดภัยกว่า
  }
  return CONFIG.MASK_MODE;
}

/**
 * สลับโหมดทดสอบ
 *
 * มีผลกับแถบเตือนบนหน้าจอ และกับการนำเข้าข้อมูลเก่าครั้งถัดไปเท่านั้น
 * แถวที่นำเข้าไปแล้วถูกปกปิดตั้งแต่ตอนเขียนลงชีต ปิดโหมดนี้ทีหลังไม่ได้คืนค่าจริงให้
 */
function apiSetMaskMode(on) {
  requireAdmin_();
  var want = (on === true || String(on).toUpperCase() === 'TRUE');
  PropertiesService.getScriptProperties().setProperty(MASK_PROP_, want ? 'TRUE' : 'FALSE');
  return { ok: true, maskMode: want };
}

/* --------------------------------------------------------- จัดการผู้ใช้ */

/**
 * รายชื่อคนที่มีสิทธิ์แก้ไขไฟล์ Sheet
 * คืนค่า null ถ้าอ่านไม่ได้ เพื่อให้หน้าจอแยกได้ว่า "ไม่มีสิทธิ์" กับ "ตรวจไม่ได้"
 */
function fileEditors_() {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var list = ss.getEditors().map(function (u) { return String(u.getEmail()).toLowerCase(); });
    var owner = ss.getOwner();
    if (owner) list.push(String(owner.getEmail()).toLowerCase());
    return list;
  } catch (e) {
    return null;
  }
}

/**
 * อีเมลเจ้าของไฟล์ Sheet คืนค่าว่างถ้าไม่มีหรืออ่านไม่ได้
 * ไฟล์ที่อยู่ใน Shared Drive ไม่มีเจ้าของรายบุคคล getOwner() จะคืน null
 *
 * หน้าจอต้องรู้ว่าใครเป็นเจ้าของ เพราะเจ้าของถอนสิทธิ์ไฟล์ไม่ได้
 * ถ้าไม่บอกไว้ก่อน ผู้ดูแลจะกดปุ่มถอนสิทธิ์แล้วเจอข้อความผิดพลาดโดยไม่รู้ตัวว่าทำไม
 */
function fileOwnerEmail_() {
  try {
    var owner = SpreadsheetApp.getActiveSpreadsheet().getOwner();
    return owner ? String(owner.getEmail()).toLowerCase() : '';
  } catch (e) {
    return '';
  }
}

/** ลิงก์เปิดไฟล์ Sheet ไว้ให้กดจากหน้าตั้งค่า ซึ่งเป็นหน้าที่พูดเรื่องสิทธิ์บนไฟล์ */
function sheetUrl_() {
  try {
    return SpreadsheetApp.getActiveSpreadsheet().getUrl();
  } catch (e) {
    return '';
  }
}

/**
 * แชร์ไฟล์ Sheet ให้ผู้ใช้ในสิทธิ์ผู้แก้ไข
 * จำเป็นเพราะแอปตั้งค่าให้แต่ละคนรันสคริปต์ด้วยบัญชีตัวเอง
 * ถ้าไม่มีสิทธิ์แก้ไขไฟล์จะเปิดแอปได้แต่กดบันทึกไม่ผ่าน
 */
function shareWithEditor_(email) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var editors = fileEditors_();
    if (editors && editors.indexOf(email.toLowerCase()) !== -1) {
      return { shared: true, already: true };
    }
    ss.addEditor(email);
    return { shared: true, already: false };
  } catch (e) {
    return { shared: false, error: e.message };
  }
}

/**
 * ถอนสิทธิ์แก้ไขไฟล์ Sheet
 * ต้องทำคู่กับการปิดสิทธิ์ในแอปเสมอ ไม่งั้นคนที่ถูกปิดยังเปิดไฟล์ดิบอ่านข้อมูลผู้ป่วยได้
 * เจ้าของไฟล์ถอนไม่ได้ และไม่ยอมให้ถอนสิทธิ์ตัวเอง
 */
function revokeEditor_(email) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var target = String(email).trim().toLowerCase();

    var owner = ss.getOwner();
    if (owner && String(owner.getEmail()).toLowerCase() === target) {
      return { revoked: false, error: 'เป็นเจ้าของไฟล์ ถอนสิทธิ์ไม่ได้' };
    }
    var me = String(Session.getActiveUser().getEmail() || '').toLowerCase();
    if (me === target) {
      return { revoked: false, error: 'ถอนสิทธิ์ไฟล์ของตัวเองไม่ได้' };
    }

    var editors = ss.getEditors().map(function (u) { return String(u.getEmail()).toLowerCase(); });
    if (editors.indexOf(target) === -1) return { revoked: true, already: true };

    ss.removeEditor(email);
    return { revoked: true, already: false };
  } catch (e) {
    return { revoked: false, error: e.message };
  }
}

function apiShareFile(email) {
  requireAdmin_();
  var target = String(email || '').trim();
  if (!target) throw new Error('กรุณาระบุอีเมล');
  var r = shareWithEditor_(target);
  if (!r.shared) throw new Error('แชร์ไฟล์ให้ ' + target + ' ไม่สำเร็จ: ' + r.error);
  return { ok: true, email: target, already: r.already };
}

function apiRevokeFile(email) {
  requireAdmin_();
  var target = String(email || '').trim();
  if (!target) throw new Error('กรุณาระบุอีเมล');
  var r = revokeEditor_(target);
  if (!r.revoked) throw new Error('ถอนสิทธิ์ไฟล์ของ ' + target + ' ไม่สำเร็จ: ' + r.error);
  return { ok: true, email: target, already: r.already };
}

function apiListUsers() {
  requireAdmin_();
  var editors = fileEditors_();
  var owner = fileOwnerEmail_();

  return readAll_(SHEETS.USERS)
    .filter(function (u) { return String(u.email).trim(); })
    .map(function (u) {
      var email = String(u.email).trim();
      return {
        email: email,
        name: u.name || '',
        role: String(u.role || 'staff').toLowerCase(),
        active: String(u.active).toUpperCase() !== 'FALSE',
        added_at: u.added_at || '',
        isOwner: !!owner && email.toLowerCase() === owner,
        // null = ตรวจสิทธิ์ไฟล์ไม่ได้ ไม่ใช่ว่าไม่มีสิทธิ์
        fileAccess: editors === null ? null : (editors.indexOf(email.toLowerCase()) !== -1)
      };
    })
    /*
      เรียงให้คนที่ต้องดูแลอยู่บนสุด คนที่ยังใช้งานก่อนคนที่ปิดไปแล้ว
      ผู้ดูแลก่อนผู้ใช้ทั่วไป ที่เหลือเรียงตามอีเมล
      เดิมเรียงตามลำดับแถวในชีต ซึ่งคือลำดับที่บังเอิญเพิ่มเข้ามา ไม่ได้บอกอะไรเลย
    */
    .sort(function (a, b) {
      if (a.active !== b.active) return a.active ? -1 : 1;
      var aAdmin = a.role === 'admin', bAdmin = b.role === 'admin';
      if (aAdmin !== bAdmin) return aAdmin ? -1 : 1;
      return a.email.localeCompare(b.email);
    });
}

/**
 * เพิ่มหรือแก้ผู้ใช้ ใช้อีเมลเป็นกุญแจ
 * กันสองกรณีที่ทำให้ล็อกตัวเองออกจากระบบ คือปิดสิทธิ์ตัวเอง
 * และลดสิทธิ์ผู้ดูแลคนสุดท้ายจนไม่เหลือใครจัดการผู้ใช้ได้
 */
function apiSaveUser(form) {
  var me = requireAdmin_();

  var email = String(form.email || '').trim().toLowerCase();
  if (!email) throw new Error('กรุณากรอกอีเมล');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('รูปแบบอีเมลไม่ถูกต้อง: ' + email);

  var role = String(form.role || 'staff').toLowerCase();
  if (role !== 'admin' && role !== 'staff') throw new Error('สิทธิ์ต้องเป็น admin หรือ staff');
  var active = String(form.active).toUpperCase() !== 'FALSE';

  var isSelf = (email === String(me.email).trim().toLowerCase());
  if (isSelf && !active) {
    throw new Error('ปิดการใช้งานบัญชีตัวเองไม่ได้ ให้ผู้ดูแลคนอื่นเป็นคนทำแทน');
  }

  return withLock_(function () {
    var rows = readAll_(SHEETS.USERS);
    var existing = rows.filter(function (u) {
      return String(u.email).trim().toLowerCase() === email;
    })[0];

    var admins = rows.filter(function (u) {
      return String(u.role).toLowerCase() === 'admin' && String(u.active).toUpperCase() !== 'FALSE';
    });
    var wasActiveAdmin = existing &&
      String(existing.role).toLowerCase() === 'admin' &&
      String(existing.active).toUpperCase() !== 'FALSE';
    if (wasActiveAdmin && (role !== 'admin' || !active) && admins.length <= 1) {
      throw new Error('ต้องเหลือผู้ดูแลระบบอย่างน้อย 1 คน');
    }

    /*
      ห้ามลดสิทธิ์ผู้ดูแลของตัวเอง แต่แก้ชื่อตัวเองได้
      เทียบกับสิทธิ์เดิมในชีต ไม่ใช่เทียบว่า role ที่ส่งมาเป็น admin ไหม
      เพราะช่วงที่ระบบยังไม่มีผู้ดูแลเลย คนที่เข้าหน้านี้ได้ยังเป็น staff อยู่
      ถ้าเทียบแบบเดิมเขาจะแก้ชื่อตัวเองไม่ได้ ทั้งที่ไม่ได้ลดสิทธิ์อะไรเลย
    */
    if (isSelf && wasActiveAdmin && role !== 'admin') {
      throw new Error('ลดสิทธิ์ผู้ดูแลของบัญชีตัวเองไม่ได้ ให้ผู้ดูแลคนอื่นเป็นคนทำแทน');
    }

    var rec = {
      email: email,
      // ส่ง name ว่างมาถือว่าตั้งใจลบชื่อออก ไม่ใช่ไม่ได้ส่งมา ไม่งั้นลบชื่อที่พิมพ์ผิดไม่ได้
      name: (form.name === undefined || form.name === null)
        ? (existing ? existing.name : '')
        : String(form.name).trim(),
      role: role,
      active: active ? 'TRUE' : 'FALSE',
      added_at: existing ? (existing.added_at || nowIso_()) : nowIso_()
    };

    if (existing) updateObject_(SHEETS.USERS, existing._row, rec);
    else appendObject_(SHEETS.USERS, rec);

    /*
      สิทธิ์ในแอปกับสิทธิ์บนไฟล์ต้องเดินไปด้วยกันเสมอ
      เปิดใช้งาน = แชร์ไฟล์ให้ / ปิดใช้งาน = ถอนสิทธิ์ไฟล์ออก
      ถ้าปิดแค่ในแอปแต่ยังแชร์ไฟล์อยู่ เขาจะเปิดชีตดิบอ่านข้อมูลผู้ป่วยได้
    */
    if (active) {
      var share = shareWithEditor_(email);
      return {
        ok: true, email: email, created: !existing, active: true,
        shared: share.shared, alreadyShared: !!share.already, shareError: share.error || ''
      };
    }

    var revoke = revokeEditor_(email);
    return {
      ok: true, email: email, created: false, active: false,
      revoked: revoke.revoked, alreadyRevoked: !!revoke.already, revokeError: revoke.error || ''
    };
  });
}

/**
 * ลบผู้ใช้ออกจากตารางถาวร
 *
 * มีไว้สำหรับแถวที่ใส่ผิดตั้งแต่แรก เช่นพิมพ์อีเมลผิดตัว ไม่ใช่สำหรับคนที่เคยใช้งานจริง
 * คนที่ลาออกให้ปิดการใช้งานแทน จะได้ยังรู้ว่าเคยมีใครเข้าถึงข้อมูลผู้ป่วยบ้าง
 *
 * ถอนสิทธิ์ไฟล์ออกให้ด้วยเสมอ ไม่งั้นชื่อหายจากตารางแต่ยังเปิดชีตดิบอ่านข้อมูลได้อยู่
 * ซึ่งอันตรายกว่าตอนที่ยังเห็นชื่อเขาค้างในตาราง เพราะไม่เหลือร่องรอยให้ใครสังเกต
 */
function apiDeleteUser(email) {
  var me = requireAdmin_();
  var target = String(email || '').trim().toLowerCase();
  if (!target) throw new Error('กรุณาระบุอีเมล');
  if (target === String(me.email).trim().toLowerCase()) {
    throw new Error('ลบบัญชีตัวเองไม่ได้ ให้ผู้ดูแลคนอื่นเป็นคนทำแทน');
  }

  return withLock_(function () {
    var rows = readAll_(SHEETS.USERS);
    var row = rows.filter(function (u) {
      return String(u.email).trim().toLowerCase() === target;
    })[0];
    if (!row) throw new Error('ไม่พบผู้ใช้ ' + target + ' ในตาราง');

    var admins = rows.filter(function (u) {
      return String(u.role).toLowerCase() === 'admin' && String(u.active).toUpperCase() !== 'FALSE';
    });
    var isActiveAdmin = String(row.role).toLowerCase() === 'admin' &&
      String(row.active).toUpperCase() !== 'FALSE';
    if (isActiveAdmin && admins.length <= 1) {
      throw new Error('ต้องเหลือผู้ดูแลระบบอย่างน้อย 1 คน');
    }

    /*
      ถอนสิทธิ์ไฟล์ให้สำเร็จก่อนถึงจะลบแถวได้
      ถ้าลบแถวทั้งที่ถอนไม่ผ่าน จะกลายเป็นคนที่ยังเปิดชีตดิบอ่านข้อมูลผู้ป่วยได้
      แต่ไม่เหลือชื่ออยู่ในตารางให้ใครสังเกตเห็น ซึ่งแย่กว่าการลบไม่สำเร็จไปเลย
      แถวที่ยังอยู่จะขึ้นสถานะเตือนในคอลัมน์การเข้าถึงไฟล์ให้ตามแก้ต่อได้
    */
    var revoke = revokeEditor_(target);
    if (!revoke.revoked) {
      throw new Error('ถอนสิทธิ์ไฟล์ของ ' + target + ' ไม่สำเร็จ จึงยังไม่ลบออกจากตาราง: ' + revoke.error);
    }

    deleteRow_(SHEETS.USERS, row._row);
    return { ok: true, email: target };
  });
}

/* ----------------------------------------------------------------- รายงาน */

/**
 * ระดับการช่วยเหลือตัวเองของกลุ่ม ADL เลขมากคือพึ่งพาคนอื่นน้อยลง
 * ใช้เทียบผลประเมินครั้งแรกกับครั้งล่าสุดว่าผู้ป่วยขยับกลุ่มขึ้นหรือลง
 */
var ADL_RANK = { 'ติดเตียง': 0, 'ติดบ้าน': 1, 'ติดสังคม': 2 };

/** ป้ายของช่องที่ยังไม่ได้กรอก เขียนไว้ที่เดียวเพราะทั้งการนับ การเรียง และการเจาะรายชื่อต้องใช้ค่าเดียวกัน */
var UNSPECIFIED = 'ไม่ระบุ';

/**
 * ช่องที่หน้ารายงานถือว่ายังกรอกไม่ครบ
 *
 * แยกจาก ATTENTION ของแดชบอร์ดเพราะตอบคนละคำถาม ATTENTION ถามว่าต้องไปทำอะไรกับผู้ป่วย
 * ส่วนตรงนี้ถามว่าตัวเลขในรายงานเชื่อได้แค่ไหน ช่องที่ว่างจะไปโผล่เป็น "ไม่ระบุ" กระจาย
 * อยู่ในหลายการ์ด รวมมาไว้ที่เดียวจึงเห็นขนาดของปัญหาและกดเข้าไปแก้ได้
 */
var REPORT_GAPS = [
  { key: 'area',    label: 'ยังไม่ระบุพื้นที่' },
  { key: 'start',   label: 'ไม่มีวัน Start' },
  { key: 'bi',      label: 'ยังไม่เคยประเมิน BI' },
  /*
    สามข้อนี้เป็นช่องที่การ์ดผลลัพธ์ใช้คิดโดยตรง ขาดเมื่อไรฐานของการ์ดหดทันที
    เคยไม่ได้ตรวจ หน้าจอจึงขึ้น "อยู่ครบ 6 เดือน 50%" จากฐานสองราย
    ทั้งที่จบไปแล้ว 32 ราย โดยไม่มีอะไรบอกว่าอีกสามสิบรายหายไปไหน
  */
  { key: 'end',     label: 'ปิดเคสแล้วแต่ไม่มีวันสิ้นสุด' },
  { key: 'dc',      label: 'ไม่มีวันจำหน่ายจากหอผู้ป่วย (D/C)' },
  { key: 'pt',      label: 'ยังไม่มีบันทึกจำนวนครั้งที่ได้ PT' },
  { key: 'dx',      label: 'ไม่ระบุการวินิจฉัย' },
  { key: 'ward',    label: 'ไม่ระบุหอผู้ป่วย' },
  { key: 'program', label: 'ไม่ระบุรูปแบบโปรแกรม' },
  { key: 'reason',  label: 'ปิดเคสแล้วแต่ไม่ระบุเหตุจบ' }
];

/** ช่วงคะแนนตามเกณฑ์ ADL ที่ใช้แบ่งกลุ่ม ติดเตียง 0-4 ติดบ้าน 5-11 ติดสังคม 12 ขึ้นไป */
var BI_BUCKETS = [
  { label: '0–4 (ติดเตียง)', min: 0, max: 4 },
  { label: '5–11 (ติดบ้าน)', min: 5, max: 11 },
  { label: '12–19 (ติดสังคม)', min: 12, max: 19 },
  { label: '20 (เต็ม)', min: 20, max: 20 }
];

/** ค่ากลางของรายการตัวเลข รายงานคู่กับค่าเฉลี่ยเพราะข้อมูลไม่กี่สิบรายเบ้ง่ายจากตัวสุดโต่งรายเดียว */
function medianOf_(list) {
  if (!list.length) return null;
  var s = list.slice().sort(function (a, b) { return a - b; });
  var mid = Math.floor(s.length / 2);
  return Math.round((s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2) * 10) / 10;
}

/** งวดก่อนหน้า ตรงข้ามกับ nextPeriod_() ใช้ดึงตัวเลขของงวดที่แล้วมาเทียบ */
function prevPeriod_(key, mode) {
  if (mode === 'months') {
    var y = parseInt(key.slice(0, 4), 10);
    var m = parseInt(key.slice(5, 7), 10) - 1;
    if (m < 1) { m = 12; y--; }
    return y + '-' + (m < 10 ? '0' + m : String(m));
  }
  if (mode === 'years') return 'FY' + (parseInt(key.slice(2), 10) - 1);

  var fy = parseInt(key.slice(2, 6), 10);
  var q = parseInt(key.slice(8), 10) - 1;
  if (q < 1) { q = 4; fy--; }
  return 'FY' + fy + '-Q' + q;
}

/** ชื่องวดที่อ่านออก ใช้ทั้งบนหัวเรื่องและบนป้ายเทียบงวดก่อน */
function periodLabel_(key) {
  if (!key) return 'ทุกปีงบ';
  var p = String(key).split('-Q');
  return 'ปีงบ ' + p[0].replace('FY', '') + (p[1] ? ' ไตรมาส ' + p[1] : '');
}

/**
 * ช่องที่ผู้ป่วยรายนี้ยังกรอกไม่ครบ คืนรหัสเหตุผล อาจขาดหลายช่องพร้อมกัน
 * รับ groups ที่คำนวณไว้แล้วมาใช้ต่อ จะได้ไม่ตีความคำว่า "ว่าง" คนละแบบกับตอนนับแท่ง
 */
function gapFlags_(p, groups, everAssessed) {
  var flags = [];
  var closed = String(p.status) === 'closed';

  if (patientArea_(p).districtKey === '__unknown') flags.push('area');
  if (String(p.start_date || '').length < 7) flags.push('start');
  if (!everAssessed) flags.push('bi');

  // วันสิ้นสุดถามเฉพาะเคสที่ปิดแล้ว เคสที่ยังดูแลอยู่ยังไม่ถึงเวลาต้องมี
  if (closed && String(p.end_date || '').length < 10) flags.push('end');
  if (String(p.dc_date || '').length < 10) flags.push('dc');

  /*
    ช่องนี้ระบบนับให้เองจากบันทึกการติดตามที่ประเภทเป็น PT
    ว่างแปลว่ายังไม่เคยมีใครบันทึกการติดตามให้รายนี้ ไม่ได้แปลว่าผู้ป่วยไม่ได้ PT
    ป้ายจึงเขียนว่า "ยังไม่มีบันทึก" ไม่ใช่ "ไม่ได้ PT"
  */
  if (isNaN(parseFloat(p.pt_visit_count))) flags.push('pt');

  if (groups.dx === UNSPECIFIED) flags.push('dx');
  if (groups.ward === UNSPECIFIED) flags.push('ward');
  if (groups.program === UNSPECIFIED) flags.push('program');
  if (groups.dcReason === UNSPECIFIED) flags.push('reason');
  return flags;
}

/**
 * ข้อมูลหน้ารายงาน สรุปตามกลุ่มที่ใช้ตัดสินใจงานจริง
 *
 * ปีงบและไตรมาสคัดจาก start_date ฐานเดียวกับกราฟผู้ป่วยเข้าใหม่บนแดชบอร์ด
 * คือ "ผู้ป่วยที่เริ่มโปรแกรมในปีงบนั้น" ไม่ใช่ "ที่จบในปีงบนั้น"
 * ตรงกับวิธีนับของรายงาน IMC ที่ส่งเขต และทำให้สองหน้าพูดภาษาเดียวกัน
 *
 * ทุกกลุ่มที่ใช้นับถูกติดไว้กับผู้ป่วยแต่ละรายใน o.groups ตั้งแต่ต้น แล้วทั้งแท่ง ฐาน
 * และรายชื่อที่กดเข้าไปดูอ่านจากที่นั่นที่เดียว ตัวเลขบนแท่งกับจำนวนรายชื่อจึงไม่มีทาง
 * เพี้ยนจากกัน วิธีเดียวกับที่กล่องงานค้างบนแดชบอร์ดใช้อยู่
 */
function apiReport(opts) {
  currentUser_();
  opts = opts || {};
  var filter = areaFilter_(opts);
  var fy = String(opts.fy || '');
  var fq = String(opts.fq || '');
  var status = String(opts.status || '');
  var dxGroup = String(opts.dxGroup || '');

  if (fq && !fy) throw new Error('กรุณาเลือกปีงบก่อนเลือกไตรมาส');
  if (fq && !FISCAL_QUARTERS.some(function (q) { return q.key === fq; })) {
    throw new Error('ไตรมาสไม่ถูกต้อง');
  }
  if (status && ['active', 'closed'].indexOf(status) === -1) throw new Error('สถานะไม่ถูกต้อง');

  // เลือกไตรมาสก็เทียบกุญแจระดับไตรมาส ไม่เลือกก็เทียบระดับปีงบ ใช้ตัวเดียวกันทั้งคู่
  var wanted = fy ? (fq ? fy + '-' + fq : fy) : '';
  var mode = fq ? 'quarters' : 'years';

  var all = readAll_(SHEETS.PATIENTS);
  var today = todayIso_();

  // ตัวเลือกในดรอปดาวน์คิดจากผู้ป่วยทุกคนก่อนกรอง ตัวเลือกจะได้ไม่หายไปตอนเปลี่ยนตัวกรองอื่น
  var seenFy = {}, seenDx = {};
  all.forEach(function (p) {
    var k = periodKey_(p.start_date, 'years');
    if (k) seenFy[k] = true;
    var d = String(p.dx_group || p.dx || '').trim();
    if (d) seenDx[d] = true;
  });

  var keep = function (p, wantKey) {
    if (!matchesArea_(p, filter)) return false;
    if (wantKey && periodKey_(p.start_date, mode) !== wantKey) return false;
    if (status && (String(p.status) === 'closed' ? 'closed' : 'active') !== status) return false;
    return !dxGroup || String(p.dx_group || p.dx || '').trim() === dxGroup;
  };

  var patients = all.filter(function (p) { return keep(p, wanted); });

  /*
    ดัชนีผลประเมินของแต่ละคน ทั้งครั้งแรกและครั้งล่าสุด

    ใบที่ไม่มีวันที่ยังนับว่า "เคยประเมินแล้ว" แต่ไม่เอามาจัดลำดับ เพราะบอกไม่ได้ว่า
    มาก่อนหรือหลังใบอื่น ถ้าเอาไปเทียบด้วยจะกลายเป็นใบแรกของทุกคนที่มีมัน
    ส่วนกลุ่ม ADL ใช้ค่าที่บันทึกไว้ ถ้าว่าง (ข้อมูลนำเข้าบางแถว) จึงคิดจากคะแนนรวมแทน
  */
  var everAssessed = {}, firstAt = {}, lastAt = {}, datedCount = {};
  readAll_(SHEETS.BI).forEach(function (r) {
    var hn = String(r.hn);
    everAssessed[hn] = true;
    var d = String(r.assess_date || '');
    if (!d) return;
    var total = parseFloat(r.total);
    var rec = {
      date: d,
      total: total,
      adl: String(r.adl_group || '').trim() || (isNaN(total) ? '' : adlGroup_(total))
    };
    datedCount[hn] = (datedCount[hn] || 0) + 1;
    if (!lastAt[hn] || d >= lastAt[hn].date) lastAt[hn] = rec;
    if (!firstAt[hn] || d < firstAt[hn].date) firstAt[hn] = rec;
  });

  var bucketOf = function (v) {
    var hit = BI_BUCKETS.filter(function (k) { return v >= k.min && v <= k.max; })[0];
    return hit ? hit.label : '';
  };

  // เจาะอำเภอไว้แล้วก็แจกแจงต่อเป็นรายตำบล ยังไม่เจาะก็แจกแจงเป็นรายอำเภอ
  var areaLevel = isDistrict_(filter.district) ? 'tambon' : 'district';

  var views = patients.map(function (p) {
    var hn = String(p.hn);
    var o = displayPatient_(p, today);
    var b = parseFloat(p.latest_bi);
    o.groups = {
      bucket: isNaN(b) ? '' : bucketOf(b),
      adl: (lastAt[hn] || {}).adl || '',
      dx: String(p.dx_group || p.dx || '').trim() || UNSPECIFIED,
      ward: String(p.ward || '').trim() || UNSPECIFIED,
      program: String(p.imc_program || '').trim() || UNSPECIFIED,
      // เหตุจบว่างไว้สำหรับเคสที่ยังไม่ปิด ไม่ใช่ "ไม่ระบุ" เพราะยังไม่ถึงเวลาต้องกรอก
      dcReason: String(p.status) === 'closed' ? (String(p.dc_reason || '').trim() || UNSPECIFIED) : '',
      area: areaLevel === 'district' ? o.area.districtKey : o.area.tambonKey
    };
    o.gaps = gapFlags_(p, o.groups, !!everAssessed[hn]);
    return o;
  });

  /*
    นับจากค่าที่ติดอยู่กับผู้ป่วยแต่ละราย ไม่ได้ตีความใหม่จากคนละที่
    ฐานคือจำนวนรายที่มีค่าในกลุ่มนั้นจริง แต่ละการ์ดจึงบอกฐานของตัวเองได้ถูกต้อง
    โดยไม่ต้องมีใครไปจำว่าการ์ดไหนใช้ฐานอะไร
  */
  var tally = function (key) {
    var map = {}, base = 0;
    views.forEach(function (o) {
      var k = o.groups[key];
      if (!k) return;
      base++;
      map[k] = (map[k] || 0) + 1;
    });
    var rows = Object.keys(map).map(function (k) { return { name: k, count: map[k] }; });
    // "ไม่ระบุ" ไม่ใช่กลุ่มจริง ดันไว้ล่างสุดเสมอ ไม่ให้แทรกกลางกลุ่มที่มีความหมาย
    rows.sort(function (a, b) {
      if ((a.name === UNSPECIFIED) !== (b.name === UNSPECIFIED)) return a.name === UNSPECIFIED ? 1 : -1;
      return b.count - a.count;
    });
    return { rows: rows, base: base };
  };

  var bucketTally = tally('bucket');
  var adlTally = tally('adl');
  var dxTally = tally('dx');
  var wardTally = tally('ward');
  var programTally = tally('program');
  var dcTally = tally('dcReason');

  // แท่งการกระจายคะแนนเรียงตามช่วงคะแนนเสมอ ไม่ใช่ตามจำนวนราย ไม่งั้นแกนอ่านไม่ได้
  var buckets = BI_BUCKETS.map(function (k) {
    var hit = bucketTally.rows.filter(function (x) { return x.name === k.label; })[0];
    return { label: k.label, min: k.min, max: k.max, count: hit ? hit.count : 0 };
  });

  /* ------------------------------------------------------------- ผลลัพธ์

    แท่งข้างบนบอกว่าคนไข้กลุ่มนี้หน้าตาเป็นแบบไหน ส่วนตรงนี้บอกว่าดูแลแล้วได้ผลไหม
    ซึ่งเป็นคำถามที่รายงาน IMC ต้องตอบจริง ทุกตัวคิดจากข้อมูลที่มีอยู่แล้วในชีต
  */
  var firsts = [], latests = [], gains = [];
  var shiftUp = 0, shiftSame = 0, shiftDown = 0, shiftBase = 0;
  var stayed = 0, stayBase = 0;
  var ptVisits = [], toStart = [];

  views.forEach(function (o) {
    var hn = String(o.hn);
    var a = parseFloat(o.first_bi), b = parseFloat(o.latest_bi);
    if (!isNaN(a) && !isNaN(b)) { firsts.push(a); latests.push(b); gains.push(b - a); }

    /*
      เลื่อนกลุ่ม ADL ต้องมีใบประเมินที่ลงวันที่ไว้อย่างน้อยสองใบ
      มีใบเดียวแปลว่ายังไม่มีอะไรให้เทียบ ถ้านับรวมจะไปกองอยู่ในช่อง "คงที่"
      แล้วทำให้ดูเหมือนดูแลไปก็ไม่มีอะไรเปลี่ยน ทั้งที่ยังไม่ได้วัดซ้ำเลย
    */
    var f = firstAt[hn], l = lastAt[hn];
    if ((datedCount[hn] || 0) >= 2 && f && l &&
        ADL_RANK[f.adl] !== undefined && ADL_RANK[l.adl] !== undefined) {
      shiftBase++;
      var d = ADL_RANK[l.adl] - ADL_RANK[f.adl];
      if (d > 0) shiftUp++; else if (d < 0) shiftDown++; else shiftSame++;
    }

    /*
      อยู่ครบ 6 เดือนนับจากวันจริงที่เริ่มถึงวันจริงที่จบ ไม่ได้อ่านช่อง six_month_status
      เพราะช่องนั้นเก็บผลตอนกดบันทึกครั้งสุดท้าย พอเวลาผ่านไปก็ค้างอยู่ที่ค่าเดิม
      ฐานคือเคสที่ปิดแล้วและมีวันครบทั้งสองด้าน เคสที่ยังดูแลอยู่ยังตอบไม่ได้
    */
    if (String(o.status) === 'closed') {
      var s = String(o.start_date || ''), e = String(o.end_date || '');
      if (s.length >= 10 && e.length >= 10) {
        stayBase++;
        if (daysBetweenIso_(s, e) >= CONFIG.IMC_DURATION_DAYS) stayed++;
      }
    }

    var pt = parseFloat(o.pt_visit_count);
    if (!isNaN(pt) && pt >= 0) ptVisits.push(pt);

    // ช่วงรอยต่อจากจำหน่ายออกจากหอผู้ป่วยถึงวันเริ่มโปรแกรม ยิ่งสั้นยิ่งได้ฟื้นฟูเร็ว
    var days = daysBetweenIso_(String(o.dc_date || ''), String(o.start_date || ''));
    if (days !== null && !isNaN(days) && days >= 0) toStart.push(days);
  });

  var outcome = {
    base: gains.length,
    avgFirst: avgOf_(firsts),
    avgLatest: avgOf_(latests),
    avgGain: avgOf_(gains),
    improved: gains.filter(function (v) { return v > 0; }).length,
    same: gains.filter(function (v) { return v === 0; }).length,
    declined: gains.filter(function (v) { return v < 0; }).length,
    adlShift: { up: shiftUp, same: shiftSame, down: shiftDown, base: shiftBase },
    sixMonth: { stayed: stayed, base: stayBase },
    ptVisits: { avg: avgOf_(ptVisits), median: medianOf_(ptVisits), base: ptVisits.length },
    admitToStart: { avg: avgOf_(toStart), median: medianOf_(toStart), base: toStart.length }
  };

  /* --------------------------------------------------- แจกแจงรายพื้นที่

    ตารางเทียบพื้นที่กับกลุ่ม ADL ในตารางเดียว ตอบคำถามที่แท่งเดี่ยว ๆ ตอบไม่ได้
    คือพื้นที่ไหนผู้ป่วยหนักกว่ากัน แถวที่ไม่มีผู้ป่วยเลยตัดทิ้ง ตารางจะได้ไม่ยาวลอย
  */
  var areaKeys = areaLevel === 'district'
    ? Object.keys(GEOGRAPHY.districts).concat(['__outside', '__unknown'])
    : tambonsOf_(filter.district).concat(['__unknown']);

  var nameOfArea = function (key) {
    if (key === '__outside') return 'ต่างจังหวัด';
    if (key === '__unknown') return areaLevel === 'district' ? 'ยังไม่ระบุพื้นที่' : 'ยังไม่ระบุตำบล / ต้องตรวจสอบ';
    return key;
  };

  var areas = areaKeys.map(function (key) {
    var rows = views.filter(function (o) { return o.groups.area === key; });
    var g = [];
    rows.forEach(function (o) {
      var a = parseFloat(o.first_bi), b = parseFloat(o.latest_bi);
      if (!isNaN(a) && !isNaN(b)) g.push(b - a);
    });
    var adlCount = function (name) {
      return rows.filter(function (o) { return o.groups.adl === name; }).length;
    };
    return {
      key: key,
      name: nameOfArea(key),
      total: rows.length,
      bed: adlCount('ติดเตียง'),
      home: adlCount('ติดบ้าน'),
      social: adlCount('ติดสังคม'),
      unassessed: rows.filter(function (o) { return !o.groups.adl; }).length,
      avgGain: avgOf_(g)
    };
  }).filter(function (r) { return r.total > 0; })
    .sort(function (a, b) { return b.total - a.total; });

  /* ------------------------------------------------------- เทียบงวดก่อน

    เลือกงวดไว้แล้วเห็นแค่ว่างวดนี้เป็นแบบไหน ยังตอบไม่ได้ว่าดีขึ้นหรือแย่ลง
    จึงคิดตัวเลขหัวเรื่องของงวดก่อนด้วยตัวกรองชุดเดียวกันมาวางเทียบให้
  */
  var prev = null;
  if (wanted) {
    var prevKey = prevPeriod_(wanted, mode);
    var prevRows = all.filter(function (p) { return keep(p, prevKey); });
    var prevGains = [];
    prevRows.forEach(function (p) {
      var a = parseFloat(p.first_bi), b = parseFloat(p.latest_bi);
      if (!isNaN(a) && !isNaN(b)) prevGains.push(b - a);
    });
    prev = {
      key: prevKey,
      label: periodLabel_(prevKey),
      total: prevRows.length,
      avgGain: avgOf_(prevGains),
      improved: prevGains.filter(function (v) { return v > 0; }).length
    };
  }

  var progress = views.filter(function (o) {
    return !isNaN(parseFloat(o.first_bi)) && !isNaN(parseFloat(o.latest_bi));
  }).map(function (o) {
    var a = parseFloat(o.first_bi), b = parseFloat(o.latest_bi);
    return {
      hn: o.hn, name: o.full_name, dx: o.dx, ward: o.ward,
      first: a, latest: b, gain: b - a, adl: o.groups.adl, status: o.status
    };
  }).sort(function (x, y) { return y.gain - x.gain; });

  return {
    filter: filter,
    fy: fy,
    fq: fq,
    status: status,
    dxGroup: dxGroup,
    periodLabel: periodLabel_(wanted),
    fiscalYears: Object.keys(seenFy).sort().reverse(),
    fiscalQuarters: FISCAL_QUARTERS,
    dxOptions: Object.keys(seenDx).sort(),
    areaLevel: areaLevel,
    total: patients.length,
    assessed: adlTally.base,
    active: patients.length - dcTally.base,
    closed: dcTally.base,
    adl: adlTally.rows,
    dxGroups: dxTally.rows,
    wards: wardTally.rows,
    programs: programTally.rows,
    dcReasons: dcTally.rows,
    buckets: buckets,
    // ฐานของแต่ละการ์ดไม่เท่ากัน หน้าจอจึงต้องเขียนกำกับไว้ทุกใบ ไม่ใช่แค่ใบเหตุจบ
    bases: {
      buckets: bucketTally.base,
      adl: adlTally.base,
      dxGroups: dxTally.base,
      wards: wardTally.base,
      programs: programTally.base,
      dcReasons: dcTally.base
    },
    outcome: outcome,
    areas: areas,
    prev: prev,
    gaps: REPORT_GAPS.map(function (it) {
      return {
        key: it.key,
        label: it.label,
        count: views.filter(function (o) { return o.gaps.indexOf(it.key) !== -1; }).length
      };
    }),
    progress: progress,
    patients: views
  };
}

/* ---------------------------------------------------------------- ตั้งต้น */

/**
 * ข้อมูลชุดแรกที่หน้าเว็บต้องใช้ เรียกครั้งเดียวตอนเปิดแอป
 *
 * ส่งรายชื่อผู้ป่วยกลับไปพร้อมข้อมูลตั้งต้นด้วย การคุยกับ Apps Script หนึ่งรอบ
 * ใช้เวลาหลายวินาที การรวมสองรอบเป็นรอบเดียวทำให้หน้าแรกขึ้นเร็วขึ้นเท่าตัว
 * ส่วนที่เพิ่มมาคืออ่านชีตอีกใบเดียว
 */
function apiBootstrap() {
  var user = currentUser_();
  ensurePatientAreaHeaders_();
  var today = todayIso_();
  var weekAhead = addDaysIso_(today, 7);
  // ส่ง today เข้าไปเอง ไม่ปล่อยให้ map ยัด index มาเป็นอาร์กิวเมนต์ที่สองแทน
  var patients = readAll_(SHEETS.PATIENTS).map(function (p) {
    return displayPatient_(p, today);
  }).sort(function (a, b) {
    return String(b.start_date || '').localeCompare(String(a.start_date || ''));
  });

  // ตัวเลขบนกระดิ่ง คือนัดหมายที่ถึงกำหนดใน 7 วันข้างหน้า ไม่ใช่ข้อความแจ้งเตือนลอย ๆ
  var alerts = patients.filter(function (p) {
    var d = String(p.kbh_appt_date || '');
    return d && d >= today && d <= weekAhead && String(p.status) !== 'closed';
  }).length;

  return {
    user: user,
    patients: patients,
    alerts: alerts,
    appName: CONFIG.APP_NAME,
    org: CONFIG.ORG,
    orgUnit: CONFIG.ORG_UNIT,
    orgPlace: CONFIG.ORG_PLACE,
    maskMode: maskMode_(),
    sheetUrl: sheetUrl_(),
    biItems: BI_ITEMS,
    biMax: BI_MAX,
    // คำเต็มกับป้ายสั้นของงานค้าง หน้าจอจะได้ไม่ต้องมีรายการของตัวเองให้หลุดกัน
    attention: ATTENTION,
    // หน้าการติดตามเขียนคำว่า "ใน N วัน" จากค่านี้ ป้ายบนจอกับของที่เซิร์ฟเวอร์คัดมาจะได้ตรงกัน
    dueAheadDays: CONFIG.FU_DUE_AHEAD_DAYS,
    vocab: VOCAB,
    geography: GEOGRAPHY,
    today: todayIso_()
  };
}

/* --------------------------------------------------------------- ผู้ป่วย */

/**
 * แปลงแถวในชีตเป็นข้อมูลผู้ป่วยที่หน้าจอใช้ได้เลย
 *
 * ติดธงงานค้างมาให้ตั้งแต่ตรงนี้ ทุกหน้าที่แสดงผู้ป่วยจึงเห็นงานค้างชุดเดียวกัน
 * ไม่ใช่เห็นเฉพาะหน้าที่นึกจะคำนวณเอง เดิมมีแต่แดชบอร์ดที่คำนวณ หน้ารายชื่อซึ่งเป็น
 * หน้าที่ทีมเปิดทุกวันจึงเป็นหน้าที่บอกน้อยที่สุด
 *
 * รับ today จากผู้เรียกที่วนหลายราย จะได้ไม่ถามวันที่ตามเขตเวลาซ้ำทุกแถว
 * ซึ่งเป็นการข้ามไปฝั่ง Java ครั้งหนึ่งต่อผู้ป่วยหนึ่งคน
 */
function displayPatient_(p, today) {
  var o = {};
  Object.keys(p).forEach(function (k) { o[k] = p[k]; });
  o.area = patientArea_(p);
  o.full_name = fullName_(p);
  o.admit_date_th = toThaiDate_(p.admit_date);
  o.start_date_th = toThaiDate_(p.start_date);
  o.imc_end_date_th = toThaiDate_(p.imc_end_date);
  o.latest_bi_date_th = toThaiDate_(p.latest_bi_date);
  o.attention = attentionFlags_(p, today || todayIso_());
  return o;
}

/** รายชื่อผู้ป่วยสำหรับหน้าแรก รองรับค้นหาและกรองสถานะ */
function apiListPatients(opts) {
  currentUser_();
  opts = opts || {};
  var q = String(opts.q || '').trim().toLowerCase();
  var status = opts.status || '';
  var screening = opts.screening || '';
  var today = todayIso_();

  return readAll_(SHEETS.PATIENTS)
    .filter(function (p) {
      if (status && String(p.status) !== status) return false;
      if (screening && String(p.screening_result) !== screening) return false;
      if (!q) return true;
      var hay = [p.hn, p.cid, p.first_name, p.last_name, p.tambon, p.dx].join(' ').toLowerCase();
      return hay.indexOf(q) !== -1;
    })
    .map(function (p) { return displayPatient_(p, today); })
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

  /*
    เรียงตามวันที่จริง ไม่ใช่ตามเลขครั้งที่ที่เก็บไว้ในชีต
    ข้อมูลเก่าที่ยังไม่มีใครกดบันทึกซ้ำอาจมีเลขครั้งที่ค้างจากลำดับที่กด
    ถ้าเรียงตามเลขนั้น ไทม์ไลน์จะสลับที่โดยที่คนอ่านไม่มีทางรู้
  */
  var fu = readAll_(SHEETS.FOLLOWUPS)
    .filter(function (r) { return String(r.hn) === String(hn); })
    .sort(compareFollowup_)
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

    validatePatientArea_(rec, target);
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
      adl_group: result.adl_group,
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

  // ล้างก่อนเขียนทับ ไม่งั้นถ้าใบประเมินถูกแก้จนเหลือน้อยลง ค่าเก่าจะค้างอยู่
  for (var i = 1; i <= CONFIG.BI_SUMMARY_COLUMNS; i++) p['bi_' + i] = '';
  list.forEach(function (r) {
    var seq = Number(r.seq);
    if (seq >= 1 && seq <= CONFIG.BI_SUMMARY_COLUMNS) p['bi_' + seq] = r.total;
  });
  if (!p.screening_result) {
    p.screening_result = String(first.imc_eligible).toUpperCase() === 'TRUE' ? 'IMC' : 'NoIMC';
  }
  p.updated_at = nowIso_();
  updateObject_(SHEETS.PATIENTS, p._row, p);
}

/* -------------------------------------------------------------- ติดตามผล */

/**
 * ลำดับที่ถูกต้องของการติดตามคือลำดับ "วันที่จริง" ไม่ใช่ลำดับที่กดบันทึก
 *
 * ของจริงมีการกรอกย้อนหลังตลอด เช่น นึกได้ทีหลังว่าลืมลงเยี่ยมบ้านของเดือนก่อน
 * ถ้านับครั้งที่ตามลำดับที่กด รายการนั้นจะกลายเป็นครั้งที่ 5 ที่วันที่เก่ากว่าครั้งที่ 4
 * แล้วไทม์ไลน์ในเวชระเบียนจะเรียงสลับกันโดยไม่มีอะไรบอก
 *
 * รายการที่ยังไม่มีวันที่ (นำเข้ามาจากไฟล์เดิมที่อ่านวันที่ไม่ออก) ไปต่อท้ายเสมอ
 * เรียงตามเวลาที่บันทึก ลำดับจะได้คงที่ ไม่สลับไปมาทุกครั้งที่เรียก
 */
function compareFollowup_(a, b) {
  var ad = String(a.fu_date || ''), bd = String(b.fu_date || '');
  if (!ad !== !bd) return ad ? -1 : 1;
  if (ad !== bd) return ad < bd ? -1 : 1;
  return String(a.created_at || '') < String(b.created_at || '') ? -1 : 1;
}

/**
 * ด้านกลับของ compareFollowup_ ใช้กับสมุดบันทึกในหน้าการติดตามที่เรียงใหม่ไปเก่า
 *
 * กลับด้านทุกอย่างยกเว้นรายการที่ยังไม่มีวันที่ ซึ่งไปท้ายสุดทั้งสองแบบ
 * ตรงนี้เคยเขียนแยกไว้ที่ผู้เรียกแล้วลืมกลับด้านกรณีวันที่ตรงกัน หน้าการติดตามจึงเรียง
 * ครั้งที่ 2 ไว้เหนือครั้งที่ 3 ของวันเดียวกัน สวนทางกับไทม์ไลน์ในเวชระเบียน
 * เขียนคู่กับตัวข้างบนไว้ที่เดียว สองหน้าจะได้ไม่มีทางเรียงคนละอย่างอีก
 */
function compareFollowupDesc_(a, b) {
  var ad = String(a.fu_date || ''), bd = String(b.fu_date || '');
  if (!ad !== !bd) return ad ? -1 : 1;
  return -compareFollowup_(a, b);
}

/**
 * เขียนเลข "ครั้งที่" ของผู้ป่วยหนึ่งรายใหม่ทั้งชุดให้ตรงลำดับวันที่
 *
 * เขียนเฉพาะแถวที่เลขเปลี่ยนจริง และเขียนแค่ช่องเดียว ไม่ยกทั้งแถว
 * คนที่บันทึกตามลำดับปกติจึงไม่ต้องรอการเขียนเพิ่มเลยสักช่อง
 *
 * คืนตารางจากรหัสรายการไปเลขใหม่ ผู้เรียกจะได้ตอบกลับได้ว่ารายการที่เพิ่งบันทึกเป็นครั้งที่เท่าไร
 */
function resequenceFollowups_(hn) {
  var seqOf = {};
  readAll_(SHEETS.FOLLOWUPS)
    .filter(function (r) { return String(r.hn) === String(hn); })
    .sort(compareFollowup_)
    .forEach(function (r, i) {
      seqOf[String(r.fu_id)] = i + 1;
      if (Number(r.seq) === i + 1) return;
      updateCell_(SHEETS.FOLLOWUPS, r._row, 'seq', i + 1);
    });
  return seqOf;
}

function apiSaveFollowup(form) {
  var user = currentUser_();
  return withLock_(function () {
    var hn = String(form.hn || '').trim();
    if (!findPatientByHn_(hn)) throw new Error('ไม่พบผู้ป่วย HN ' + hn);
    if (!form.fu_date) throw new Error('กรุณาเลือกวันที่ติดตาม');

    var existing = readAll_(SHEETS.FOLLOWUPS).filter(function (r) { return String(r.hn) === hn; });
    var old = existing.filter(function (r) { return String(r.fu_id) === String(form.fu_id); })[0];
    var rec = {
      fu_id: old ? old.fu_id : (form.fu_id || uid_('FU')),
      hn: hn,
      // เลขชั่วคราว เดี๋ยว resequenceFollowups_ เขียนทับให้ตรงลำดับวันที่อีกที
      seq: old ? old.seq : (existing.length + 1),
      fu_date: form.fu_date,
      fu_type: form.fu_type || '',
      complications: form.complications || '',
      note: form.note || '',
      recorded_by: user.email,
      created_at: old ? old.created_at : nowIso_()
    };

    if (old) updateObject_(SHEETS.FOLLOWUPS, old._row, rec);
    else appendObject_(SHEETS.FOLLOWUPS, rec);

    var seqOf = resequenceFollowups_(hn);

    /*
      นัดครั้งถัดไปเขียนกลับไปที่วันนัด OPD ของผู้ป่วย

      เดิมตามคนไข้เสร็จแล้ววันนัดเดิมยังค้างอยู่ที่เดิม ธง "เลยกำหนดนัดแล้ว" จึงไม่มีวัน
      หายไปเอง จนกว่าจะมีคนเข้าไปแก้เวชระเบียนแยกอีกที ปล่อยช่องว่าง = ไม่แตะวันนัดเดิม
    */
    refreshPtVisitCount_(hn, form.next_appt
      ? { kbh_appt_date: form.next_appt, updated_by: user.email }
      : null);

    return { ok: true, seq: seqOf[String(rec.fu_id)] || rec.seq };
  });
}

/**
 * นับจำนวนครั้งที่ได้ PT ใหม่ พร้อมเขียนค่าอื่นบนแถวผู้ป่วยที่ต้องเปลี่ยนไปพร้อมกัน
 * รวมเป็นการเขียนครั้งเดียว เพราะทุกครั้งที่แตะชีตคือเวลาที่คนกดบันทึกต้องนั่งรอ
 */
function refreshPtVisitCount_(hn, changes) {
  var n = readAll_(SHEETS.FOLLOWUPS).filter(function (r) {
    return String(r.hn) === String(hn) && String(r.fu_type) === 'PT';
  }).length;
  var p = findPatientByHn_(hn);
  if (!p) return;
  p.pt_visit_count = n;
  if (changes) Object.keys(changes).forEach(function (k) { p[k] = changes[k]; });
  p.updated_at = nowIso_();
  updateObject_(SHEETS.PATIENTS, p._row, p);
}

/**
 * ผู้ป่วยที่ถึงกำหนดต้องตาม เรียงจากเลยนัดนานที่สุดลงมาหาที่ยังไม่ถึง
 *
 * หน้าการติดตามต้องตอบให้ได้ว่าวันนี้ต้องตามใคร ไม่ใช่เป็นสมุดบันทึกย้อนหลังอย่างเดียว
 * ใช้ช่องวันนัด OPD ช่องเดียวกับที่แดชบอร์ดกับธง "เลยกำหนดนัดแล้ว" ใช้
 * ทั้งสามที่จึงพูดถึงนัดเดียวกันเสมอ
 *
 * ติดวันที่ติดตามครั้งล่าสุดไปด้วย คนที่เปิดดูจะได้แยกออกว่ารายไหนตามไปแล้วแต่ยังไม่ได้
 * เลื่อนนัด กับรายไหนที่ยังไม่มีใครแตะเลย
 */
function dueFollowups_(patients, rows, today) {
  var lastFu = {};
  rows.forEach(function (r) {
    var d = String(r.fu_date || '');
    if (!d) return;
    var hn = String(r.hn);
    if (!lastFu[hn] || d > lastFu[hn]) lastFu[hn] = d;
  });

  return patients
    .filter(function (p) {
      if (String(p.status) === 'closed') return false;
      var d = String(p.kbh_appt_date || '');
      return !!d && daysBetweenIso_(today, d) <= CONFIG.FU_DUE_AHEAD_DAYS;
    })
    .map(function (p) {
      return {
        hn: p.hn,
        name: fullName_(p),
        program: p.imc_program || '',
        appt: p.kbh_appt_date,
        days_left: daysBetweenIso_(today, String(p.kbh_appt_date)),
        last_fu: lastFu[String(p.hn)] || ''
      };
    })
    .sort(function (a, b) { return a.days_left - b.days_left; });
}

/**
 * การติดตามทั้งหมดพร้อมชื่อผู้ป่วย และรายชื่อที่ถึงกำหนดต้องตาม
 *
 * ส่งไปทุกแถว ไม่ตัดที่ 60 รายการเงียบ ๆ อย่างเดิม เพราะหน้าจอกรองเองได้แล้ว
 * และการตัดทิ้งโดยไม่มีอะไรบอกทำให้ของเก่าหายไปทั้งที่คนเปิดดูคิดว่าเห็นครบ
 *
 * รายการที่ยังไม่มีวันที่ก็ส่งไปด้วย ไม่กรองทิ้ง ตอนนำเข้าไฟล์เดิมมีรายการที่อ่านวันที่
 * ไม่ออกแล้วเก็บข้อความไว้ให้คนมาเติมวันที่เอง ถ้ากรองทิ้งตรงนี้ แถวที่ต้องตามงานมากที่สุด
 * จะกลายเป็นแถวเดียวที่มองไม่เห็นจากหน้าการติดตาม
 */
function apiListFollowups() {
  currentUser_();
  var today = todayIso_();
  var patients = readAll_(SHEETS.PATIENTS);
  var nameByHn = {};
  patients.forEach(function (p) { nameByHn[String(p.hn)] = fullName_(p); });

  var rows = readAll_(SHEETS.FOLLOWUPS)
    .map(function (r) {
      r.patient_name = nameByHn[String(r.hn)] || '';
      r.fu_date_th = toThaiDate_(r.fu_date);
      return r;
    })
    // ใหม่ไปเก่า แต่รายการที่ยังไม่มีวันที่ไปท้ายสุดเสมอ ไม่ใช่ปนอยู่หัวตาราง
    .sort(compareFollowupDesc_);

  return { rows: rows, due: dueFollowups_(patients, rows, today) };
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

/* ------------------------------------------------------------ แดชบอร์ด */

/** วันสุดท้ายของเดือนก่อนหน้าวันที่ที่ให้มา ใช้เป็นเส้นเทียบของตัวเลข "จากเดือนก่อน" */
function prevMonthEnd_(iso) {
  var y = parseInt(String(iso).substring(0, 4), 10);
  var m = parseInt(String(iso).substring(5, 7), 10);
  return dateToIso_(new Date(y, m - 1, 0));   // วันที่ 0 ของเดือนนี้คือวันสุดท้ายของเดือนก่อน
}

/**
 * จำนวนคนที่ยังอยู่ในโปรแกรม ณ วันที่ที่กำหนด
 * เคสที่ปิดไปแล้วแต่ไม่ได้บันทึกวันจบ ถือว่าปิดมาตั้งแต่แรก เพราะเดาวันแทนไม่ได้
 */
function activeAsOf_(patients, iso) {
  return patients.filter(function (p) {
    var s = String(p.start_date || '');
    if (!s || s > iso) return false;
    if (String(p.status) !== 'closed') return true;
    var e = String(p.end_date || '');
    return !!e && e > iso;
  }).length;
}

/** ค่าเฉลี่ยของผลต่างคะแนน BI ปัดหนึ่งตำแหน่ง คืน null ถ้ายังไม่มีข้อมูลพอ */
function avgOf_(list) {
  if (!list.length) return null;
  var sum = list.reduce(function (s, v) { return s + v; }, 0);
  return Math.round((sum / list.length) * 10) / 10;
}

/**
 * งวดถัดไปจากงวดที่ให้มา ตามรูปแบบกุญแจของ periodKey_()
 * ใช้เดินเติมงวดที่ไม่มีข้อมูล จะได้ไม่ข้ามช่วงว่างบนแกนนอน
 */
function nextPeriod_(key, mode) {
  if (mode === 'months') {
    var y = parseInt(key.slice(0, 4), 10);
    var m = parseInt(key.slice(5, 7), 10) + 1;
    if (m > 12) { m = 1; y++; }
    return y + '-' + (m < 10 ? '0' + m : String(m));
  }
  if (mode === 'years') return 'FY' + (parseInt(key.slice(2), 10) + 1);

  var fy = parseInt(key.slice(2, 6), 10);
  var q = parseInt(key.slice(8), 10) + 1;
  if (q > 4) { q = 1; fy++; }
  return 'FY' + fy + '-Q' + q;
}

/**
 * งานค้างของผู้ป่วยหนึ่งราย คืนรหัสเหตุผลที่ค้าง อาจค้างหลายข้อพร้อมกัน
 *
 * เคสที่ปิดแล้วไม่มีอะไรต้องทำต่อ จึงตัดออกตั้งแต่ต้น
 * ข้อ bi ใช้วันประเมินล่าสุด ถ้ายังไม่เคยประเมินเลยก็นับจากวัน Start แทน
 * ไม่งั้นคนที่เข้าโปรแกรมมานานแต่ไม่เคยถูกประเมินจะรอดสายตาไปตลอด
 */
function attentionFlags_(p, today) {
  var flags = [];

  /*
    เคสที่ปิดแล้วไม่มีอะไรต้องทำต่อ ยกเว้นเรื่องเดียวคือวันสิ้นสุดที่หายไป
    ส่วนใหญ่มาจากข้อมูลที่นำเข้าจากไฟล์เดิมซึ่งช่องนั้นว่าง ฟอร์มจบโปรแกรมในแอป
    บังคับกรอกอยู่แล้ว ถ้าไม่มีวันสิ้นสุด เคสนั้นจะหายไปจากแท่งจบโปรแกรมบนกราฟ
    ทำให้ดูเหมือนไม่มีใครจบเลยทั้งที่จบไปแล้ว
  */
  if (String(p.status) === 'closed') {
    if (String(p.end_date || '').length < 7) flags.push('noend');
    return flags;
  }

  var appt = String(p.kbh_appt_date || '');
  if (appt && appt < today) flags.push('appt');

  var end = String(p.imc_end_date || '');
  if (end && end < today) flags.push('end');

  var since = String(p.latest_bi_date || p.start_date || '');
  var days = since ? daysBetweenIso_(since, today) : null;
  if (days !== null && days > CONFIG.BI_STALE_DAYS) flags.push('bi');

  if (String(p.screening_result) === 'NoIMC') flags.push('screen');
  return flags;
}

function apiDashboard(opts) {
  currentUser_();
  var filter = areaFilter_(opts);
  var patients = readAll_(SHEETS.PATIENTS).filter(function (p) { return matchesArea_(p, filter); });
  return buildDashboard_(patients, readAll_(SHEETS.BI), todayIso_(), filter);
}

function buildDashboard_(patients, assessments, today, filter) {
  var thisMonth = today.substring(0, 7);
  var cutoff = prevMonthEnd_(today);

  var byMonth = {}, byQuarter = {}, byYear = {};

  /*
    แต่ละงวดเก็บสี่ตัว: เข้าใหม่ที่เข้าเกณฑ์ / ไม่เข้าเกณฑ์ / ยังไม่คัดกรอง / จบโปรแกรม
    สามตัวแรกนับจาก start_date ตัวสุดท้ายนับจาก end_date จึงเป็นคนละฐานวันที่กัน
    หน้าจอต้องเขียนกำกับไว้ ไม่งั้นคนอ่านจะนึกว่าทั้งกราฟนับจากวัน Start
  */
  var addPeriod_ = function (iso, field) {
    if (String(iso || '').length < 7) return;
    [[byMonth, 'months'], [byQuarter, 'quarters'], [byYear, 'years']].forEach(function (x) {
      var key = periodKey_(iso, x[1]);
      if (!key) return;
      if (!x[0][key]) x[0][key] = { imc: 0, noImc: 0, other: 0, closed: 0 };
      x[0][key][field]++;
    });
  };

  var imc = 0, noImc = 0, active = 0, closed = 0;
  var newThisMonth = 0, newImcThisMonth = 0;
  var gains = [];

  patients.forEach(function (p) {
    if (String(p.screening_result) === 'IMC') imc++;
    if (String(p.screening_result) === 'NoIMC') noImc++;
    if (String(p.status) === 'closed') closed++; else active++;

    var d = String(p.start_date || '');
    if (d.length >= 7) {
      addPeriod_(d, String(p.screening_result) === 'IMC' ? 'imc'
        : (String(p.screening_result) === 'NoIMC' ? 'noImc' : 'other'));

      if (d.substring(0, 7) === thisMonth) {
        newThisMonth++;
        if (String(p.screening_result) === 'IMC') newImcThisMonth++;
      }
    }

    // แท่งจบโปรแกรมนับจาก end_date ซึ่งเป็นคนละฐานวันที่กับแท่งเข้าใหม่
    if (String(p.status) === 'closed') addPeriod_(p.end_date, 'closed');

    var a = parseFloat(p.first_bi), b = parseFloat(p.latest_bi);
    if (!isNaN(a) && !isNaN(b)) gains.push(b - a);
  });

  /*
    เติมงวดที่ไม่มีข้อมูลให้ครบตั้งแต่งวดแรกถึงงวดสุดท้าย

    ถ้าเอาเฉพาะงวดที่มีข้อมูล แกนนอนจะไม่ใช่เส้นเวลาจริง เดือนที่ไม่มีใคร
    เข้าหรือจบจะหายไปเฉย ๆ ทำให้ ธ.ค. ไปติดกับ พ.ค. เหมือนเป็นเดือนติดกัน
    ทั้งที่ห่างกันห้าเดือน ระยะห่างระหว่างแท่งจะอ่านไม่ได้เลย
    และช่วงที่ไม่มีคนเข้าโปรแกรมเลยก็หายไปด้วย ทั้งที่เป็นข้อมูลที่ควรเห็น
  */
  var series = function (map, mode, keep) {
    var keys = Object.keys(map).sort();
    if (!keys.length) return [];

    var zero = { imc: 0, noImc: 0, other: 0, closed: 0 };
    var last = keys[keys.length - 1];
    var full = [], k = keys[0], guard = 0;
    while (k <= last && guard++ < 400) {     // guard กันวนไม่รู้จบถ้ากุญแจผิดรูป
      full.push(k);
      k = nextPeriod_(k, mode);
    }

    return full.slice(-keep).map(function (key) {
      var s = map[key] || zero;
      return {
        key: key, imc: s.imc, noImc: s.noImc, other: s.other, closed: s.closed,
        count: s.imc + s.noImc + s.other    // ความสูงรวมของแท่งเข้าใหม่ ความหมายเท่าเดิม
      };
    });
  };

  /*
    คะแนนเฉลี่ยเมื่อสิ้นเดือนก่อน คิดจากผลประเมินที่บันทึกไว้ก่อนวันนั้นจริง ๆ
    ไม่ใช่เอา latest_bi ปัจจุบันมาใช้ ไม่งั้นตัวเลขเทียบจะเท่ากันเสมอ
  */
  var byHn = {};
  var includedHns = Object.create(null);
  patients.forEach(function (p) { includedHns[String(p.hn)] = true; });
  assessments.forEach(function (r) {
    if (!includedHns[String(r.hn)]) return;
    var d = String(r.assess_date || '');
    var v = parseFloat(r.total);
    if (!d || isNaN(v) || d > cutoff) return;
    var k = String(r.hn);
    if (!byHn[k]) byHn[k] = { first: null, last: null, firstDate: '', lastDate: '' };
    var e = byHn[k];
    if (!e.firstDate || d < e.firstDate) { e.firstDate = d; e.first = v; }
    if (!e.lastDate || d >= e.lastDate) { e.lastDate = d; e.last = v; }
  });
  var gainsBefore = Object.keys(byHn)
    .map(function (k) { return byHn[k].last - byHn[k].first; })
    .filter(function (v) { return !isNaN(v); });

  var avgGain = avgOf_(gains);
  var avgGainBefore = avgOf_(gainsBefore);

  // นัดหมายที่ยังมาไม่ถึง เรียงจากใกล้ที่สุด ใช้เตือนงานที่ต้องทำ
  var upcoming = patients
    .filter(function (p) {
      return p.kbh_appt_date && String(p.kbh_appt_date) >= today && String(p.status) !== 'closed';
    })
    .sort(function (a, b) { return String(a.kbh_appt_date).localeCompare(String(b.kbh_appt_date)); })
    .slice(0, 6)
    .map(function (p) {
      return {
        hn: p.hn,
        name: fullName_(p),
        program: p.imc_program,
        date: p.kbh_appt_date,
        days_left: daysBetweenIso_(today, String(p.kbh_appt_date))
      };
    });

  // ธงงานค้างติดมากับ displayPatient_ แล้ว ทั้งตัวเลขสรุป รายชื่อที่กดดู และหน้ารายชื่อ
  // จึงอ่านจากชุดเดียวกัน ไม่มีหน้าไหนตีความคำว่า "ค้าง" เป็นของตัวเอง
  var view = patients.map(function (p) { return displayPatient_(p, today); });

  return {
    filter: filter,
    today: today,
    patients: view,
    attention: ATTENTION.map(function (it) {
      return {
        key: it.key,
        label: it.label,
        count: view.filter(function (o) { return o.attention.indexOf(it.key) !== -1; }).length
      };
    }),
    geography: GEOGRAPHY,
    districts: areaSummary_(patients, 'district'),
    tambons: areaSummary_(patients, 'tambon', filter.district),
    tambonDistrict: tambonDistrict_(filter.district),
    upcoming: upcoming,
    total: patients.length,
    imc: imc,
    noImc: noImc,
    active: active,
    closed: closed,
    avgGain: avgGain,
    improved: gains.filter(function (v) { return v > 0; }).length,
    months: series(byMonth, 'months', 12),
    quarters: series(byQuarter, 'quarters', 8),
    years: series(byYear, 'years', 6),
    delta: {
      total: newThisMonth,
      imc: newImcThisMonth,
      active: active - activeAsOf_(patients, cutoff),
      avgGain: (avgGain === null || avgGainBefore === null)
        ? null : Math.round((avgGain - avgGainBefore) * 10) / 10
    }
  };
}
