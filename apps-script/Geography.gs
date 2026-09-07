/** ที่อยู่ผู้ป่วย: ไม่อนุมานจังหวัดจากชื่อตำบลซึ่งอาจซ้ำข้ามจังหวัด
 * รายชื่ออำเภอ/ตำบล: กรมพัฒนาที่ดิน ตารางผนวก 1 หน้า 33–34
 * https://e-library.ldd.go.th/library/flip/bib10629f/files/basic-html/page36.html
 * https://e-library.ldd.go.th/library/flip/bib10629f/files/basic-html/page37.html
 */
var GEOGRAPHY = {
  province: 'กระบี่', city: 'เมืองกระบี่',
  districts: {
    'เมืองกระบี่': ['ปากน้ำ', 'กระบี่ใหญ่', 'กระบี่น้อย', 'เขาคราม', 'เขาทอง', 'ทับปริก', 'ไสไทย', 'อ่าวนาง', 'หนองทะเล', 'คลองประสงค์'],
    'เขาพนม': ['เขาพนม', 'เขาดิน', 'โคกหาร', 'พรุเตียว', 'สินปุน', 'หน้าเขา'],
    'เกาะลันตา': ['เกาะกลาง', 'เกาะลันตาน้อย', 'เกาะลันตาใหญ่', 'คลองยาง', 'ศาลาด่าน'],
    'คลองท่อม': ['คลองท่อมใต้', 'คลองท่อมเหนือ', 'คลองพน', 'ทรายขาว', 'พรุดินนา', 'เพหลา', 'ห้วยน้ำขาว'],
    'อ่าวลึก': ['อ่าวลึกใต้', 'อ่าวลึกเหนือ', 'อ่าวลึกน้อย', 'เขาใหญ่', 'คลองยา', 'คลองหิน', 'นาเหนือ', 'บ้านกลาง', 'แหลมสัก'],
    'ปลายพระยา': ['ปลายพระยา', 'เขาเขน', 'เขาต่อ', 'คีรีวง'],
    'ลำทับ': ['ลำทับ', 'ดินแดง', 'ดินอุดม', 'ทุ่งไทรทอง'],
    'เหนือคลอง': ['เหนือคลอง', 'เกาะศรีบอยา', 'คลองขนาน', 'คลองเขม้า', 'โคกยาง', 'ตลิ่งชัน', 'ปกาสัย', 'ห้วยยูง']
  }
};

function areaName_(value, kind) {
  var s = String(value || '').trim();
  var prefixes = { province: /^(จังหวัด\s*|จ\.\s*)/, district: /^(อำเภอ\s*|อ\.\s*)/, tambon: /^(ตำบล\s*|ต\.\s*)/ };
  s = s.replace(prefixes[kind], '').trim();
  return /^(ไม่ระบุ|ยังไม่ระบุ|ไม่ทราบ|-)$/.test(s) ? '' : s;
}

function patientArea_(p) {
  var province = areaName_(p.province, 'province');
  var district = areaName_(p.district, 'district');
  var tambon = areaName_(p.tambon, 'tambon');
  if (province === GEOGRAPHY.province && district === 'เมือง') district = GEOGRAPHY.city;
  var districtKey = '__unknown';
  if (province && province !== GEOGRAPHY.province) districtKey = '__outside';
  if (province === GEOGRAPHY.province && Object.prototype.hasOwnProperty.call(GEOGRAPHY.districts, district)) districtKey = district;
  var tambonKey = '__unknown';
  if (districtKey === GEOGRAPHY.city && GEOGRAPHY.districts[GEOGRAPHY.city].indexOf(tambon) !== -1) tambonKey = tambon;
  return { province: province, district: district, tambon: tambon, districtKey: districtKey, tambonKey: tambonKey };
}

function areaFilter_(opts) {
  opts = opts || {};
  var scope = opts.scope || 'all';
  if (['all', 'krabi', 'outside', 'unknown'].indexOf(scope) === -1) throw new Error('พื้นที่ไม่ถูกต้อง');
  var district = String(opts.district || '');
  var tambon = String(opts.tambon || '');
  if (district && district !== '__unknown' && !Object.prototype.hasOwnProperty.call(GEOGRAPHY.districts, district)) throw new Error('อำเภอไม่ถูกต้อง');
  if (district && scope !== 'krabi') throw new Error('กรุณาเลือกจังหวัดกระบี่ก่อนเลือกอำเภอ');
  if (tambon && (district !== GEOGRAPHY.city || (tambon !== '__unknown' && GEOGRAPHY.districts[GEOGRAPHY.city].indexOf(tambon) === -1))) throw new Error('ตำบลไม่ถูกต้อง');
  return { scope: scope, district: district, tambon: tambon };
}

function matchesArea_(p, f) {
  var a = patientArea_(p);
  if (f.scope === 'krabi' && a.province !== GEOGRAPHY.province) return false;
  if (f.scope === 'outside' && a.districtKey !== '__outside') return false;
  if (f.scope === 'unknown' && a.districtKey !== '__unknown') return false;
  if (f.district && a.districtKey !== f.district) return false;
  return !f.tambon || a.tambonKey === f.tambon;
}

function areaSummary_(patients, level) {
  var names = level === 'district' ? Object.keys(GEOGRAPHY.districts) : GEOGRAPHY.districts[GEOGRAPHY.city];
  var rows = names.map(function (name) { return { key: name, name: name, total: 0, imc: 0, active: 0, closed: 0 }; });
  if (level === 'district') rows.push({ key: '__outside', name: 'ต่างจังหวัด', total: 0, imc: 0, active: 0, closed: 0 });
  rows.push({ key: '__unknown', name: level === 'district' ? 'ยังไม่ระบุพื้นที่' : 'ยังไม่ระบุตำบล / ต้องตรวจสอบ', total: 0, imc: 0, active: 0, closed: 0 });
  patients.forEach(function (p) {
    var area = patientArea_(p);
    if (level === 'tambon' && area.districtKey !== GEOGRAPHY.city) return;
    var key = level === 'district' ? area.districtKey : area.tambonKey;
    var row = rows.filter(function (r) { return r.key === key; })[0];
    row.total++;
    if (String(p.screening_result) === 'IMC') row.imc++;
    if (String(p.status) === 'closed') row.closed++; else row.active++;
  });
  return rows;
}

/** ตรวจเฉพาะพื้นที่ที่เปลี่ยน เพื่อให้แก้ข้อมูลเก่าด้านอื่นได้โดยไม่ทิ้งที่อยู่เดิม */
function validatePatientArea_(rec, previous) {
  previous = previous || {};
  var changed = ['province', 'district', 'tambon'].some(function (k) { return String(rec[k] || '') !== String(previous[k] || ''); });
  if (!changed) return;
  var a = patientArea_(rec);
  if ((a.district || a.tambon) && !a.province) throw new Error('กรุณาระบุจังหวัดของผู้ป่วย');
  if (a.tambon && !a.district) throw new Error('กรุณาระบุอำเภอของผู้ป่วย');
  if (a.province === GEOGRAPHY.province && a.district) {
    if (!Object.prototype.hasOwnProperty.call(GEOGRAPHY.districts, a.district)) throw new Error('กรุณาเลือกอำเภอในจังหวัดกระบี่');
    if (a.tambon && GEOGRAPHY.districts[a.district].indexOf(a.tambon) === -1) throw new Error('ตำบลไม่ตรงกับอำเภอที่เลือก');
  }
  rec.province = a.province; rec.district = a.district; rec.tambon = a.tambon;
}
