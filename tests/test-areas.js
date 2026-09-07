// ใช้ API และการคำนวณจริงกับชีตจำลอง ตรวจพื้นที่ที่ซ้ำ/ขาดและยอดเจาะรายชื่อ
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ctx = vm.createContext({ console });
for (const file of ['Config.gs', 'Bi.gs', 'Geography.gs', 'Util.gs', 'Schema.gs', 'Api.gs']) {
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

test('เคสที่ปิดแล้วเหลือเรื่องเดียวคือวันสิ้นสุด ที่เหลือไม่ต้องตามแล้ว', () => {
  const closed = {
    status: 'closed', screening_result: 'NoIMC',
    kbh_appt_date: '2026-01-01', imc_end_date: '2026-01-01', latest_bi_date: '2025-01-01'
  };
  // มีวันสิ้นสุดแล้ว ของที่เลยกำหนดทั้งหลายไม่ต้องเตือน เพราะเคสจบไปแล้ว
  assert.equal(ctx.attentionFlags_({ ...closed, end_date: '2026-02-01' }, '2026-09-07').join(","), "");
  // ไม่มีวันสิ้นสุด ต้องเตือนข้อเดียว ไม่ใช่เตือนทุกข้อ
  assert.equal(ctx.attentionFlags_(closed, '2026-09-07').join(","), "noend");
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
    if (a.key === 'noend') {
      assert.ok(rows.every(x => x.status === 'closed'), 'ข้อนี้ต้องมีแต่เคสที่ปิดแล้ว');
    } else {
      assert.ok(rows.every(x => x.status !== 'closed'), a.key + ' ต้องไม่มีเคสที่ปิดแล้ว');
    }
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
// niceTop อยู่ฝั่งหน้าจอ ดึงมาทดสอบด้วย เพราะเพดานแกนกระทบการอ่านกราฟโดยตรง
vm.runInContext(
  fs.readFileSync(path.join(__dirname, '../apps-script/js.html'), 'utf8')
    .match(/function niceTop\(max\)[\s\S]*?\r?\n\}/)[0], ctx);

test('เดินงวดถัดไปถูกต้องทุกโหมด รวมตอนข้ามปี', () => {
  assert.equal(ctx.nextPeriod_('2026-01', 'months'), '2026-02');
  assert.equal(ctx.nextPeriod_('2026-09', 'months'), '2026-10');
  assert.equal(ctx.nextPeriod_('2026-12', 'months'), '2027-01');
  assert.equal(ctx.nextPeriod_('FY2569-Q1', 'quarters'), 'FY2569-Q2');
  assert.equal(ctx.nextPeriod_('FY2569-Q4', 'quarters'), 'FY2570-Q1');   // ข้ามปีงบ
  assert.equal(ctx.nextPeriod_('FY2569', 'years'), 'FY2570');
});
test('งวดที่ไม่มีข้อมูลถูกเติมเป็นศูนย์ แกนนอนจึงเป็นเส้นเวลาต่อเนื่อง', () => {
  const keep = patients[0].start_date;
  patients[0].start_date = '2026-05-01';    // เว้น มิ.ย. กับ ก.ค. ที่ไม่มีใครเข้าเลย
  const d = ctx.apiDashboard();
  const keys = d.months.map(x => x.key);

  assert.equal(keys[0], '2026-05');
  assert.equal(keys[keys.length - 1], '2026-09');
  for (let i = 1; i < keys.length; i++) {
    assert.equal(keys[i], ctx.nextPeriod_(keys[i - 1], 'months'), keys[i - 1] + ' -> ' + keys[i]);
  }

  const june = d.months.filter(x => x.key === '2026-06')[0];
  assert.ok(june, 'เดือนที่ไม่มีข้อมูลต้องยังอยู่บนแกน ไม่ใช่หายไปเฉย ๆ');
  assert.equal(june.count, 0);
  assert.equal(june.closed, 0);

  patients[0].start_date = keep;
});
test('เพดานแกนตั้งใกล้ค่าจริง ไม่กระโดดจนแท่งเตี้ย', () => {
  assert.equal(ctx.niceTop(25), 28);    // ของเดิมได้ 40 แท่งสูงสุดใช้พื้นที่แค่ 62%
  for (const max of [1, 3, 4, 7, 13, 25, 40, 58, 99, 260]) {
    const top = ctx.niceTop(max);
    assert.ok(top >= max, 'เพดานต้องไม่ต่ำกว่าค่าสูงสุด (' + max + ')');
    assert.equal(top % 4, 0, 'ต้องหารสี่ลงตัว ป้ายแกนจะได้เป็นจำนวนเต็ม (' + max + ')');
    // ค่าน้อยกว่าสี่ยกเว้นให้ เพราะเส้นแบ่งมีสี่ช่อง เพดานต่ำสุดจึงเป็นสี่
    if (max >= 4) assert.ok(max / top >= 0.6, 'แท่งสูงสุดควรใช้พื้นที่เกิน 60% (' + max + ' -> ' + top + ')');
  }
});
test('เคสที่ปิดแล้วแต่ไม่มีวันสิ้นสุด ขึ้นเตือนและหายไปจากแท่งจบโปรแกรม', () => {
  const keep = patients[1].end_date;          // TEST B เป็นเคสเดียวที่ปิดแล้ว
  const before = ctx.apiDashboard();
  assert.equal(before.attention.filter(a => a.key === 'noend')[0].count, 0);
  assert.equal(before.months.reduce((s, x) => s + x.closed, 0), 1);

  patients[1].end_date = '';
  const after = ctx.apiDashboard();
  assert.equal(after.attention.filter(a => a.key === 'noend')[0].count, 1);
  // หายจากกราฟทั้งที่ยังนับเป็นจบแล้วบนการ์ด นี่คืออาการที่ทำให้กราฟดูเหมือนไม่มีใครจบ
  assert.equal(after.months.reduce((s, x) => s + x.closed, 0), 0);
  assert.equal(after.closed, before.closed);

  patients[1].end_date = keep;
});
test('หน้ารายงานกรองรายไตรมาสของปีงบได้', () => {
  const keep = patients[0].start_date;
  patients[0].start_date = '2026-11-05';        // ปีงบ 2570 ไตรมาส 1 (ต.ค.-ธ.ค.)
  const others = patients.filter(x => x !== patients[0]);

  // ของเดิมทุกคนเริ่ม ส.ค.-ก.ย. 2026 = ปีงบ 2569 ไตรมาส 4
  assert.equal(ctx.apiReport({ fy: 'FY2569', fq: 'Q4' }).total, others.length);
  assert.equal(ctx.apiReport({ fy: 'FY2569', fq: 'Q1' }).total, 0);
  assert.equal(ctx.apiReport({ fy: 'FY2570', fq: 'Q1' }).total, 1);

  // ไม่เลือกไตรมาสต้องได้ทั้งปีงบเหมือนเดิม
  assert.equal(ctx.apiReport({ fy: 'FY2569' }).total, others.length);

  const r = ctx.apiReport({ fy: 'FY2569', fq: 'Q4' });
  assert.equal(r.fq, 'Q4');
  assert.equal(r.fiscalQuarters.length, 4);
  assert.equal(r.fiscalQuarters[0].key, 'Q1');

  patients[0].start_date = keep;
});
test('ปฏิเสธไตรมาสที่ไม่มีปีงบกำกับ หรือค่าที่ไม่ถูกต้อง', () => {
  assert.throws(() => ctx.apiReport({ fq: 'Q1' }), /เลือกปีงบ/);
  assert.throws(() => ctx.apiReport({ fy: 'FY2569', fq: 'Q9' }));
  assert.throws(() => ctx.apiReport({ fy: 'FY2569', fq: '__proto__' }));
});
test('ทุกการ์ดนับได้เท่าฐานของตัวเอง และฐานไม่เท่ากันจริง', () => {
  const r = ctx.apiReport();
  const sum = (rows) => rows.reduce((s, x) => s + x.count, 0);

  assert.equal(sum(r.wards), r.bases.wards);
  assert.equal(sum(r.adl), r.bases.adl);
  assert.equal(sum(r.dcReasons), r.bases.dcReasons);
  assert.equal(sum(r.buckets), r.bases.buckets);
  assert.equal(sum(r.programs), r.bases.programs);
  assert.equal(sum(r.dxGroups), r.bases.dxGroups);

  // ถ้าฐานเท่ากันหมด การเขียนกำกับก็ไม่ได้แก้ปัญหาอะไร ต้องมีใบที่ฐานต่างกันจริง
  assert.equal(r.bases.wards, r.total);
  assert.equal(r.bases.adl, r.assessed);
  assert.equal(r.bases.dcReasons, r.closed);
  assert.ok(r.bases.adl < r.bases.wards, 'ฐานกลุ่ม ADL ต้องเล็กกว่าฐานผู้ป่วยทั้งหมด');
  assert.ok(r.bases.dcReasons < r.bases.wards, 'ฐานเหตุจบต้องเล็กกว่าฐานผู้ป่วยทั้งหมด');
});
test('"ไม่ระบุ" อยู่ล่างสุดเสมอ ไม่แทรกกลางกลุ่มที่มีความหมาย', () => {
  patients[0].ward = 'SU'; patients[1].ward = 'SU'; patients[2].ward = 'SU';
  patients[3].ward = 'ortho';                        // ที่เหลืออีกหกรายไม่มี ward

  const rows = ctx.apiReport().wards;
  assert.equal(rows[0].name, 'SU');                  // มากสุดอยู่บน
  assert.equal(rows[rows.length - 1].name, 'ไม่ระบุ');
  // "ไม่ระบุ" มีหกราย มากกว่าทุกกลุ่มจริง ถ้าเรียงตามจำนวนล้วนมันจะขึ้นไปอยู่บนสุด
  assert.equal(rows[rows.length - 1].count, 6);
  assert.ok(rows[rows.length - 1].count > rows[0].count);

  ['ward'].forEach(k => patients.forEach(p => { delete p[k]; }));
});
test('กดแท่งแล้วได้รายชื่อชุดเดียวกับที่นับ ไม่ใช่คนละชุด', () => {
  patients[0].ward = 'SU'; patients[1].ward = 'SU';
  const r = ctx.apiReport();

  r.wards.forEach(row => {
    const rows = r.patients.filter(p => p.groups.ward === row.name);
    assert.equal(rows.length, row.count, 'ward ' + row.name);
  });
  r.adl.forEach(row => {
    assert.equal(r.patients.filter(p => p.groups.adl === row.name).length, row.count);
  });
  // เคสที่ยังไม่ปิดต้องไม่มีเหตุจบติดมา ไม่งั้นจะไปโผล่ในแท่งเหตุจบเป็น "ไม่ระบุ"
  assert.ok(r.patients.every(p => p.status === 'closed' || p.groups.dcReason === ''));

  patients.forEach(p => { delete p.ward; });
});
test('กรองตามสถานะได้ และทุกแท่งนับใหม่จากชุดที่เหลือ', () => {
  const closed = patients.filter(p => p.status === 'closed');
  const active = patients.filter(p => p.status !== 'closed');

  const c = ctx.apiReport({ status: 'closed' });
  assert.equal(c.total, closed.length);
  assert.equal(c.bases.wards, closed.length);
  assert.ok(c.patients.every(p => p.status === 'closed'));

  const a = ctx.apiReport({ status: 'active' });
  assert.equal(a.total, active.length);
  assert.equal(a.closed, 0);
  assert.equal(a.bases.dcReasons, 0);            // ไม่มีใครจบ แท่งเหตุจบจึงไม่มีฐาน
  assert.equal(a.dcReasons.length, 0);

  assert.throws(() => ctx.apiReport({ status: 'ทุกสถานะ' }), /สถานะ/);
});
test('กรองตามกลุ่มการวินิจฉัยได้ และตัวเลือกไม่หายตอนกรองพื้นที่', () => {
  patients[0].dx_group = 'stroke'; patients[1].dx_group = 'stroke'; patients[4].dx_group = 'TBI';

  const all = ctx.apiReport();
  assert.equal(all.dxOptions.join(','), 'TBI,stroke');

  const stroke = ctx.apiReport({ dxGroup: 'stroke' });
  assert.equal(stroke.total, 2);
  assert.equal(stroke.dxGroups.length, 1);
  assert.equal(stroke.dxGroups[0].name, 'stroke');

  // TEST E อยู่ระนอง กรองพื้นที่เป็นกระบี่แล้วต้องไม่เหลือ แต่ตัวเลือก TBI ยังต้องอยู่
  const krabi = ctx.apiReport({ scope: 'krabi', dxGroup: 'TBI' });
  assert.equal(krabi.total, 0);
  assert.ok(krabi.dxOptions.indexOf('TBI') !== -1);

  patients.forEach(p => { delete p.dx_group; });
});
test('ช่องที่กรอกไม่ครบถูกรวมไว้ที่เดียว และตรงกับรายชื่อที่กดดู', () => {
  const r = ctx.apiReport();
  r.gaps.forEach(g => {
    assert.equal(r.patients.filter(p => p.gaps.indexOf(g.key) !== -1).length, g.count, g.key);
  });

  // F I J ยืนยันจังหวัด/อำเภอไม่ได้ ส่วน E อยู่ต่างจังหวัดซึ่งระบุไว้ชัดแล้ว ไม่นับว่าขาด
  const area = r.gaps.filter(g => g.key === 'area')[0];
  assert.equal(area.count, 3);
  assert.ok(r.patients.filter(p => p.hn === 'E')[0].gaps.indexOf('area') === -1);

  // C D F G H I J ยังไม่เคยประเมิน ส่วน A B E มีใบประเมินแล้ว
  assert.equal(r.gaps.filter(g => g.key === 'bi')[0].count, patients.length - 3);
});
test('แจ้งช่องที่การ์ดผลลัพธ์ใช้คิด ไม่ใช่เฉพาะช่องที่โผล่เป็น "ไม่ระบุ"', () => {
  const count = (r, key) => r.gaps.filter(g => g.key === key)[0].count;

  /*
    ก่อนหน้านี้ไม่ได้ตรวจสามข้อนี้ หน้าจอจึงขึ้น "อยู่ครบ 6 เดือน" จากฐานสองราย
    ทั้งที่จบไปแล้วสามสิบสองราย โดยไม่มีอะไรบอกว่าอีกสามสิบรายหายไปไหน
  */
  const before = ctx.apiReport();
  assert.equal(count(before, 'dc'), patients.length);   // ไม่มีใครมีวัน D/C
  assert.equal(count(before, 'pt'), patients.length);   // ไม่มีใครมีจำนวนครั้ง PT
  assert.equal(count(before, 'end'), 0);                // เคสที่ปิดแล้วมีวันสิ้นสุดครบ

  const closed = patients.filter(p => p.status === 'closed')[0];
  const keepEnd = closed.end_date;
  closed.end_date = '';
  assert.equal(count(ctx.apiReport(), 'end'), 1);
  closed.end_date = keepEnd;

  // เคสที่ยังดูแลอยู่ไม่ถูกถามหาวันสิ้นสุด เพราะยังไม่ถึงเวลาต้องมี
  assert.ok(patients.filter(p => p.status !== 'closed').length > 0);
  assert.equal(count(ctx.apiReport(), 'end'), 0);

  patients[0].dc_date = '2026-07-20';
  patients[0].pt_visit_count = 4;
  const after = ctx.apiReport();
  assert.equal(count(after, 'dc'), patients.length - 1);
  assert.equal(count(after, 'pt'), patients.length - 1);
  assert.equal(after.outcome.admitToStart.base, 1);
  assert.equal(after.outcome.ptVisits.base, 1);

  // ทุกข้อในกล่องต้องตรงกับรายชื่อที่กดเข้าไปดูเหมือนข้ออื่น
  after.gaps.forEach(g => {
    assert.equal(after.patients.filter(p => p.gaps.indexOf(g.key) !== -1).length, g.count, g.key);
  });

  delete patients[0].dc_date;
  delete patients[0].pt_visit_count;
});
test('ตัวชี้วัดผลลัพธ์คิดจากข้อมูลที่มีจริง ไม่เดาให้เมื่อยังไม่มีอะไรให้เทียบ', () => {
  const o = ctx.apiReport().outcome;

  assert.equal(o.base, patients.length);           // ทุกคนมีทั้ง first_bi และ latest_bi
  assert.equal(o.avgFirst, 6.1);
  assert.equal(o.avgLatest, 10.3);
  assert.equal(o.avgGain, 4.2);
  assert.equal(o.improved + o.same + o.declined, o.base);

  /*
    มีใบประเมินที่ลงวันที่ไว้สองใบแค่ A B E เท่านั้น อีกเจ็ดรายยังไม่มีอะไรให้เทียบ
    ต้องไม่ถูกนับเป็น "คงที่" ไม่งั้นจะดูเหมือนดูแลไปแล้วเจ็ดรายไม่ขยับ
  */
  assert.equal(o.adlShift.base, 3);
  assert.equal(o.adlShift.up, 1);                  // E ติดเตียง 0 -> ติดสังคม 20
  assert.equal(o.adlShift.same, 2);
  assert.equal(o.adlShift.down, 0);

  assert.equal(o.sixMonth.base, 1);                // มีเคสปิดใบเดียวที่มีวันครบทั้งสองด้าน
  assert.equal(o.sixMonth.stayed, 0);              // อยู่ 32 วัน ยังไม่ถึง 183

  // ไม่มีใครกรอกจำนวนครั้ง PT หรือวัน D/C ต้องคืน null ไม่ใช่ศูนย์ที่อ่านเหมือนวัดแล้วได้ศูนย์
  assert.equal(o.ptVisits.base, 0);
  assert.equal(o.ptVisits.median, null);
  assert.equal(o.admitToStart.base, 0);
  assert.equal(o.admitToStart.avg, null);
});
test('ผู้ป่วยมีเพียงใบประเมินเดียวยังไม่ถูกนับว่ากลุ่ม ADL คงที่', () => {
  assessments.push({ hn: 'D', assess_date: '2026-08-05', total: 10 });
  const o = ctx.apiReport().outcome;
  assert.equal(o.adlShift.base, 3, 'D มีใบเดียว ยังเทียบไม่ได้');

  assessments.push({ hn: 'D', assess_date: '2026-08-25', total: 10 });
  const after = ctx.apiReport().outcome;
  assert.equal(after.adlShift.base, 4, 'ประเมินใบที่สองแล้วจึงเข้าฐาน');
  assert.equal(after.adlShift.same, 3);

  assessments.length -= 2;
});
test('แจกแจงรายพื้นที่นับทุกคนครั้งเดียว และแตกเป็นรายตำบลเมื่อเจาะอำเภอ', () => {
  const r = ctx.apiReport();
  assert.equal(r.areaLevel, 'district');
  assert.equal(r.areas.reduce((s, x) => s + x.total, 0), r.total);
  r.areas.forEach(x => {
    assert.equal(x.bed + x.home + x.social + x.unassessed, x.total, x.name);
    assert.equal(r.patients.filter(p => p.groups.area === x.key).length, x.total, x.name);
  });
  assert.ok(r.areas.every(x => x.total > 0), 'พื้นที่ที่ไม่มีผู้ป่วยต้องถูกตัดออก');

  const city = ctx.apiReport({ scope: 'krabi', district: 'เมืองกระบี่' });
  assert.equal(city.areaLevel, 'tambon');
  assert.equal(city.areas.reduce((s, x) => s + x.total, 0), city.total);
});
test('เลือกปีงบแล้วได้ตัวเลขงวดก่อนมาเทียบ ไม่เลือกก็ไม่มี', () => {
  assert.equal(ctx.apiReport().prev, null);

  const y = ctx.apiReport({ fy: 'FY2569' });
  assert.equal(y.prev.key, 'FY2568');
  assert.equal(y.prev.label, 'ปีงบ 2568');
  assert.equal(y.prev.total, 0);

  const q = ctx.apiReport({ fy: 'FY2569', fq: 'Q4' });
  assert.equal(q.prev.key, 'FY2569-Q3');
  assert.equal(q.prev.label, 'ปีงบ 2569 ไตรมาส 3');

  // งวดก่อนใช้ตัวกรองชุดเดียวกัน ไม่งั้นเลขที่เอามาเทียบเป็นคนละกลุ่มผู้ป่วย
  const scoped = ctx.apiReport({ scope: 'krabi', district: 'เมืองกระบี่', fy: 'FY2569' });
  assert.equal(scoped.prev.key, 'FY2568');
  assert.equal(scoped.prev.total, 0);
});
test('เดินงวดถอยหลังถูกต้องทุกโหมด รวมตอนข้ามปี', () => {
  assert.equal(ctx.prevPeriod_('FY2570', 'years'), 'FY2569');
  assert.equal(ctx.prevPeriod_('FY2570-Q1', 'quarters'), 'FY2569-Q4');
  assert.equal(ctx.prevPeriod_('FY2569-Q2', 'quarters'), 'FY2569-Q1');
  assert.equal(ctx.prevPeriod_('2026-01', 'months'), '2025-12');
  assert.equal(ctx.prevPeriod_('2026-02', 'months'), '2026-01');

  // ไปแล้วกลับต้องได้ที่เดิม ทั้งสองทิศต้องนับงวดแบบเดียวกัน
  ['FY2569', 'FY2569-Q3', '2026-05'].forEach(key => {
    const mode = key.indexOf('-Q') !== -1 ? 'quarters' : (key.indexOf('FY') === 0 ? 'years' : 'months');
    assert.equal(ctx.prevPeriod_(ctx.nextPeriod_(key, mode), mode), key, key);
  });
});
test('ค่ากลางทนต่อค่าสุดโต่งที่ค่าเฉลี่ยไม่ทน', () => {
  assert.equal(ctx.medianOf_([]), null);
  assert.equal(ctx.medianOf_([7]), 7);
  assert.equal(ctx.medianOf_([1, 2, 3, 4]), 2.5);
  assert.equal(ctx.medianOf_([3, 1, 2]), 2);        // ไม่ต้องเรียงมาก่อน

  // สี่รายรอราวสองสัปดาห์ อีกรายรอทั้งปี ค่าเฉลี่ยเด้งไปเกินสองเดือน ค่ากลางไม่ขยับ
  const days = [12, 14, 15, 16, 365];
  assert.equal(ctx.medianOf_(days), 15);
  assert.equal(ctx.avgOf_(days), 84.4);
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
