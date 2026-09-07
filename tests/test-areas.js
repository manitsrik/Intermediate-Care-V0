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
// วันนี้ในเทสต์คือ 2026-09-07 เกณฑ์ BI ค้างคือเกิน 56 วัน
const todo = (extra) => ctx.attentionFlags_({ status: 'active', screening_result: 'IMC', ...extra }, '2026-09-07');

test('เคสที่ปิดแล้วไม่มีงานค้าง แม้ทุกอย่างจะเลยกำหนดหมด', () => {
  assert.equal(ctx.attentionFlags_({
    status: 'closed', screening_result: 'NoIMC',
    kbh_appt_date: '2026-01-01', imc_end_date: '2026-01-01', latest_bi_date: '2025-01-01'
  }, '2026-09-07').join(","), "");
});
test('นัดที่เลยวันแล้วขึ้นเตือน ส่วนนัดข้างหน้าไม่ขึ้น', () => {
  assert.equal(todo({ kbh_appt_date: '2026-09-06' }).join(","), "appt");
  assert.equal(todo({ kbh_appt_date: '2026-09-07' }).join(","), "");   // วันนี้ ยังไม่ถือว่าเลย
  assert.equal(todo({ kbh_appt_date: '2026-09-08' }).join(","), "");
  assert.equal(todo({ kbh_appt_date: '' }).join(","), "");
});
test('ครบกำหนดโปรแกรมแล้วยังไม่ปิดเคส ขึ้นเตือน', () => {
  assert.equal(todo({ imc_end_date: '2026-09-06' }).join(","), "end");
  assert.equal(todo({ imc_end_date: '2026-12-31' }).join(","), "");
});
test('ประเมิน BI ค้างนับจากครั้งล่าสุด ถ้ายังไม่เคยประเมินนับจากวัน Start', () => {
  assert.equal(todo({ latest_bi_date: '2026-07-09' }).join(","), "bi");   // 60 วัน
  assert.equal(todo({ latest_bi_date: '2026-07-13' }).join(","), "");       // 56 วัน พอดี ยังไม่เกิน
  assert.equal(todo({ latest_bi_date: '2026-08-08' }).join(","), "");       // 30 วัน
  assert.equal(todo({ start_date: '2026-01-01' }).join(","), "bi");       // ไม่เคยประเมินเลย
  assert.equal(todo({ latest_bi_date: '2026-08-08', start_date: '2020-01-01' }).join(","), "");
  assert.equal(todo({}).join(","), "");                                     // ไม่มีวันอะไรให้เทียบ
});
test('คัดกรองออกแล้วแต่เคสยังไม่ปิด ขึ้นเตือน และค้างพร้อมกันหลายข้อได้', () => {
  assert.equal(todo({ screening_result: 'NoIMC' }).join(","), "screen");
  assert.equal(todo({
    screening_result: 'NoIMC', kbh_appt_date: '2026-01-01',
    imc_end_date: '2026-01-01', latest_bi_date: '2026-01-01'
  }).join(","), "appt,end,bi,screen");
});
test('ยอดในกล่องต้องจัดการตรงกับรายชื่อที่กดเข้าไปดู', () => {
  const d = ctx.apiDashboard();
  for (const a of d.attention) {
    const rows = d.patients.filter(x => x.attention.indexOf(a.key) !== -1);
    assert.equal(a.count, rows.length, a.key);
    assert.ok(rows.every(x => x.status !== 'closed'), a.key + ' ต้องไม่มีเคสที่ปิดแล้ว');
  }
  // มีคนเดียวที่ NoIMC แล้วยังไม่ปิดเคส คือ TEST C
  assert.equal(d.attention.filter(a => a.key === 'screen')[0].count, 1);
});
test('สรุปเหตุจบนับจากฐานเคสที่ปิดแล้ว ไม่ใช่ผู้ป่วยทั้งหมด', () => {
  patients[1].dc_reason = 'BI > 15';                 // TEST B เป็นเคสเดียวที่ปิดแล้ว
  const r = ctx.apiReport();
  const closed = patients.filter(x => x.status === 'closed');
  assert.equal(r.closed, closed.length);
  const sum = r.dcReasons.reduce((s, x) => s + x.count, 0);
  assert.equal(sum, closed.length);                  // ฐานคือเคสที่จบ
  assert.notEqual(sum, r.total);                     // ไม่ใช่ผู้ป่วยทั้งหมด
  assert.equal(r.dcReasons[0].name, 'BI > 15');
});
test('หน้ารายงานกรองตามพื้นที่ได้ เหมือนแดชบอร์ด', () => {
  const all = ctx.apiReport();
  assert.equal(all.total, patients.length);
  assert.equal(all.fy, '');

  const city = ctx.apiReport({ scope: 'krabi', district: 'เมืองกระบี่' });
  const inCity = patients.filter(x => ctx.patientArea_(x).districtKey === 'เมืองกระบี่');
  assert.equal(city.total, inCity.length);
  assert.ok(city.total < all.total, 'กรองแล้วต้องเหลือน้อยลง');

  // ทุกแท่งต้องนับจากชุดที่กรองแล้ว ไม่ใช่ผู้ป่วยทั้งหมด
  assert.equal(city.wards.reduce((s, x) => s + x.count, 0), inCity.length);
});
test('หน้ารายงานกรองตามปีงบได้ และนับปีงบจากวัน Start', () => {
  patients[0].start_date = '2026-10-05';   // ข้ามไปปีงบ 2570 ทั้งที่ยัง ค.ศ. 2026
  const r = ctx.apiReport();
  assert.ok(r.fiscalYears.indexOf('FY2570') !== -1);
  assert.ok(r.fiscalYears.indexOf('FY2569') !== -1);
  assert.equal(r.fiscalYears[0], 'FY2570', 'ปีล่าสุดต้องอยู่บนสุด');

  assert.equal(ctx.apiReport({ fy: 'FY2570' }).total, 1);
  assert.equal(ctx.apiReport({ fy: 'FY2569' }).total, patients.length - 1);

  // กรองพื้นที่กับปีงบพร้อมกันได้
  const both = ctx.apiReport({ scope: 'krabi', district: 'เมืองกระบี่', fy: 'FY2570' });
  assert.equal(both.total, 1);
  assert.equal(both.fy, 'FY2570');
  patients[0].start_date = '2026-08-01';   // คืนค่าเดิมให้เทสต์ถัดไป
});
test('แท่งเข้าใหม่แบ่งชั้นตามผลคัดกรอง ผลรวมต้องเท่าความสูงแท่ง', () => {
  const d = ctx.apiDashboard();
  for (const x of d.months) assert.equal(x.count, x.imc + x.noImc + x.other, x.key);
  for (const x of d.quarters) assert.equal(x.count, x.imc + x.noImc + x.other, x.key);
  for (const x of d.years) assert.equal(x.count, x.imc + x.noImc + x.other, x.key);

  // ยอดรวมทั้งกราฟต้องตรงกับตัวเลขบนการ์ด ไม่มีใครตกหล่นหรือถูกนับซ้ำ
  const sum = (k) => d.years.reduce((s, x) => s + x[k], 0);
  assert.equal(sum('imc') + sum('noImc') + sum('other'),
    patients.filter(x => x.start_date).length);
});
test('แท่งจบโปรแกรมนับจากวันสิ้นสุด คนละงวดกับวัน Start ได้', () => {
  const d = ctx.apiDashboard();
  const m = {};
  d.months.forEach(x => { m[x.key] = x; });

  // TEST B เริ่ม 2026-08 แต่จบ 2026-09 สองแท่งจึงต้องอยู่คนละงวด
  assert.equal(m['2026-08'].closed, 0, 'งวดที่เริ่มต้องไม่นับว่าจบ');
  assert.equal(m['2026-09'].closed, 1);
  // งวด 2026-09 มีทั้งสองแท่ง แต่คนละคน: D เข้าใหม่ ส่วน B จบ
  assert.equal(m['2026-09'].count, 1);
  assert.equal(m['2026-08'].count, patients.filter(x => String(x.start_date).slice(0, 7) === '2026-08').length);

  const closedWithDate = patients.filter(x => x.status === 'closed' && x.end_date);
  assert.equal(d.months.reduce((s, x) => s + x.closed, 0), closedWithDate.length);
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
