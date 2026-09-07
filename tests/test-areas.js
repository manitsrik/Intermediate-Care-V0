// ใช้ API และการคำนวณจริงกับชีตจำลอง ตรวจพื้นที่ที่ซ้ำ/ขาดและยอดเจาะรายชื่อ
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ctx = vm.createContext({ console });
for (const file of ['Config.gs', 'Geography.gs', 'Util.gs', 'Schema.gs', 'Api.gs']) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../apps-script', file), 'utf8'), ctx);
}
let count = 0;
function test(label, fn) { fn(); count++; console.log('PASS ' + label); }
const patient = (hn, province, district, tambon, extra = {}) => ({
  hn, province, district, tambon, first_name: hn, status: 'active', screening_result: 'IMC',
  start_date: '2026-08-01', first_bi: 5, latest_bi: 10, kbh_appt_date: '2026-09-10', ...extra
});
let patients = [
  patient('A', 'กระบี่', 'เมืองกระบี่', 'ปากน้ำ'),
  patient('B', 'จ. กระบี่', 'อ. เมือง', 'ต. ปากน้ำ', { status: 'closed', end_date: '2026-09-02', latest_bi: 7 }),
  patient('C', 'กระบี่', 'เมืองกระบี่', 'อ่าวนาง', { screening_result: 'NoIMC', first_bi: 16, latest_bi: 16 }),
  patient('D', 'กระบี่', 'เหนือคลอง', 'เหนือคลอง', { start_date: '2026-09-01' }),
  patient('E', 'ระนอง', 'เมืองระนอง', 'ปากน้ำ'),
  patient('F', '', '', 'ปากน้ำ'),
  patient('G', 'กระบี่', 'เมืองกระบี่', ''),
  patient('H', 'กระบี่', 'เมืองกระบี่', 'สะกดผิด'),
  patient('I', 'กระบี่', '', ''),
  patient('J', 'กระบี่', 'สะกดผิด', 'ปากน้ำ')
];
let assessments = [
  { hn: 'A', assess_date: '2026-08-01', total: 5 }, { hn: 'A', assess_date: '2026-08-20', total: 8 },
  { hn: 'B', assess_date: '2026-08-01', total: 5 }, { hn: 'B', assess_date: '2026-08-20', total: 7 },
  { hn: 'E', assess_date: '2026-08-01', total: 0 }, { hn: 'E', assess_date: '2026-08-20', total: 20 },
  { hn: 'ORPHAN', assess_date: '2026-08-01', total: 0 }, { hn: 'ORPHAN', assess_date: '2026-08-20', total: 20 }
];
ctx.currentUser_ = () => ({ email: 'test@local' });
ctx.todayIso_ = () => '2026-09-07';
ctx.dateToIso_ = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
ctx.readAll_ = name => name === 'patients' ? patients : assessments;
const city = { scope: 'krabi', district: 'เมืองกระบี่' };
const paknam = { ...city, tambon: 'ปากน้ำ' };
test('ทุกแถวอยู่ในกลุ่มอำเภอเพียงกลุ่มเดียว รวมยอดเท่าผู้ป่วยทั้งหมด', () => {
  const d = ctx.apiDashboard();
  assert.equal(d.total, 10);
  for (const key of ['total', 'imc', 'active', 'closed']) assert.equal(d.districts.reduce((s, r) => s + r[key], 0), d[key]);
});
test('ไม่เดาจังหวัดจากตำบลปากน้ำ และไม่ปนกับปากน้ำจังหวัดอื่น', () => {
  assert.equal(ctx.patientArea_(patients[5]).districtKey, '__unknown');
  assert.equal(ctx.apiDashboard(paknam).total, 2);
  assert.equal(ctx.apiDashboard({ scope: 'outside' }).total, 1);
});
test('รองรับคำนำหน้าและชื่อเมืองแบบย่อเมื่อยืนยันจังหวัดแล้ว', () => {
  assert.equal(ctx.patientArea_(patients[1]).districtKey, 'เมืองกระบี่');
  assert.equal(ctx.patientArea_(patients[1]).tambonKey, 'ปากน้ำ');
});
test('ทั้งจังหวัดไม่รวมต่างจังหวัดหรือจังหวัดที่ว่าง', () => assert.equal(ctx.apiDashboard({ scope: 'krabi' }).total, 8));
test('อำเภอว่างหรือไม่ตรงรายชื่อไม่หายไปจากยอดรวม', () => {
  assert.equal(ctx.apiDashboard({ scope: 'unknown' }).total, 3);
  assert.equal(ctx.apiDashboard({ scope: 'krabi', district: '__unknown' }).total, 2);
});
test('ตำบลว่างหรือสะกดผิดรวมในกลุ่มตรวจสอบภายในอำเภอเมือง', () => {
  const d = ctx.apiDashboard(city);
  assert.equal(d.total, 5);
  assert.equal(d.tambons.reduce((sum, r) => sum + r.total, 0), 5);
  assert.equal(ctx.apiDashboard({ ...city, tambon: '__unknown' }).total, 2);
});
test('กรองตัวเลขทั้งหมด กราฟ นัดหมาย และค่าเทียบเดือนก่อนด้วยกลุ่มเดียวกัน', () => {
  const d = ctx.apiDashboard(paknam);
  assert.equal(d.total, 2); assert.equal(d.imc, 2); assert.equal(d.active, 1); assert.equal(d.closed, 1);
  assert.equal(d.avgGain, 3.5); assert.equal(d.delta.avgGain, 1); assert.equal(d.delta.active, -1);
  assert.equal(d.months[0].count, 2); assert.equal(d.quarters[0].count, 2); assert.equal(d.years[0].count, 2);
  assert.equal(d.upcoming.length, 1); assert.equal(d.upcoming[0].hn, 'A');
  assert.equal(d.patients.map(p => p.hn).join(','), 'A,B');
});
test('ยอดในตารางแต่ละพื้นที่ตรงกับรายชื่อใน snapshot ที่ส่งให้หน้าจอ', () => {
  for (const f of [{}, city, paknam, { scope: 'unknown' }, { scope: 'outside' }]) {
    const d = ctx.apiDashboard(f);
    for (const level of ['district', 'tambon']) {
      for (const r of d[level === 'district' ? 'districts' : 'tambons']) {
        const rows = d.patients.filter(p => (level !== 'tambon' || p.area.districtKey === 'เมืองกระบี่') && p.area[level + 'Key'] === r.key);
        assert.equal(r.total, rows.length);
        assert.equal(r.imc, rows.filter(p => p.screening_result === 'IMC').length);
        assert.equal(r.active, rows.filter(p => p.status !== 'closed').length);
        assert.equal(r.closed, rows.filter(p => p.status === 'closed').length);
      }
    }
  }
});
test('พื้นที่ไม่มีผู้ป่วยแสดง 0 และค่า BI ว่าง ไม่เกิด NaN', () => {
  const d = ctx.apiDashboard({ ...city, tambon: 'เขาทอง' });
  assert.equal(d.total, 0); assert.equal(d.avgGain, null); assert.equal(d.delta.avgGain, null);
  assert.equal(d.patients.length, 0); assert.equal(d.upcoming.length, 0);
});
test('ปฏิเสธตัวกรองตำบลที่ไม่มีอำเภอหรือจับคู่ผิด', () => {
  for (const f of [{ scope: 'bad' }, { scope: 'all', district: 'เมืองกระบี่' }, { scope: 'krabi', tambon: 'ปากน้ำ' }, { scope: 'krabi', district: 'เหนือคลอง', tambon: 'ปากน้ำ' }, { ...city, tambon: 'ผิด' }]) assert.throws(() => ctx.apiDashboard(f));
});
test('ฟอร์มจังหวัดกระบี่ตรวจอำเภอและตำบลสัมพันธ์กัน', () => {
  assert.throws(() => ctx.validatePatientArea_({ province: 'กระบี่', district: 'เหนือคลอง', tambon: 'อ่าวนาง' }, {}));
  assert.throws(() => ctx.validatePatientArea_({ province: '', district: '', tambon: 'ปากน้ำ' }, {}));
  assert.throws(() => ctx.validatePatientArea_({ province: 'กระบี่', district: '__proto__', tambon: '' }, {}));
});
test('แก้ข้อมูลเก่าด้านอื่นได้โดยไม่ลบตำบลเดิมที่ยังไม่มีจังหวัด', () => {
  const old = { province: '', district: '', tambon: 'ปากน้ำ' };
  const next = { ...old, first_name: 'แก้ชื่อ' };
  ctx.validatePatientArea_(next, old);
  assert.equal(next.tambon, 'ปากน้ำ');
});
test('เลือกตำบลได้ทุกอำเภอ ไม่ใช่แค่อำเภอเมือง', () => {
  assert.equal(ctx.patientArea_(patients[3]).tambonKey, 'เหนือคลอง');
  assert.equal(ctx.apiDashboard({ scope: 'krabi', district: 'เหนือคลอง', tambon: 'เหนือคลอง' }).total, 1);
});
test('แท็บรายตำบลตามอำเภอที่เลือก ยอดรวมตรงกับตัวกรอง', () => {
  const d = ctx.apiDashboard({ scope: 'krabi', district: 'เหนือคลอง' });
  assert.equal(d.tambonDistrict, 'เหนือคลอง');
  assert.equal(d.tambons.reduce((s, r) => s + r.total, 0), d.total);
  assert.equal(ctx.apiDashboard().tambonDistrict, 'เมืองกระบี่');   // ไม่เลือกอำเภอ ตกมาที่อำเภอเมือง
});
test('ตำบลข้ามอำเภอหรืออำเภอที่ยังไม่ระบุ ยังถูกปฏิเสธเหมือนเดิม', () => {
  for (const f of [{ scope: 'krabi', district: 'เหนือคลอง', tambon: 'อ่าวนาง' },
                   { scope: 'krabi', district: '__unknown', tambon: 'ปากน้ำ' }]) {
    assert.throws(() => ctx.apiDashboard(f));
  }
});
test('ชื่อตำบลในกระบี่ไม่ซ้ำข้ามอำเภอ การเดาอำเภอจากตำบลจึงได้คำตอบเดียว', () => {
  const lookup = ctx.tambonToDistrict_();
  const all = Object.keys(ctx.GEOGRAPHY.districts).reduce((s, d) => s + ctx.GEOGRAPHY.districts[d].length, 0);
  assert.equal(Object.keys(lookup).length, all);   // ไม่มีชื่อไหนถูกตัดทิ้งเพราะซ้ำ
  assert.equal(lookup['อ่าวนาง'], 'เมืองกระบี่');
  assert.equal(lookup['เหนือคลอง'], 'เหนือคลอง');
});
test('บันทึกพื้นที่ลงคอลัมน์ใหม่ และยังเก็บคะแนน BI เดิมครบ', () => {
  patients = [{ ...patients[0], patient_id: 1, _row: 2, bi_1: 5, bi_5: 10 }];
  let saved;
  ctx.withLock_ = fn => fn(); ctx.nowIso_ = () => '2026-09-07T12:00:00';
  ctx.updateObject_ = (name, row, rec) => { saved = rec; };
  ctx.apiSavePatient({ patient_id: 1, hn: 'A', province: 'กระบี่', district: 'เมืองกระบี่', tambon: 'อ่าวนาง' });
  assert.equal(saved.province, 'กระบี่'); assert.equal(saved.district, 'เมืองกระบี่'); assert.equal(saved.tambon, 'อ่าวนาง');
  assert.equal(saved.bi_1, 5); assert.equal(saved.bi_5, 10);
  const row = ctx.toRow_('patients', saved);
  assert.equal(row[53], 'กระบี่'); assert.equal(row[54], 'เมืองกระบี่');
  assert.equal(row[48], 5); assert.equal(row[52], 10);
});
console.log(`\n${count} tests passed`);
