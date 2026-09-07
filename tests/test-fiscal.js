// ทดสอบการนับไตรมาส/ปี ตามปีงบประมาณของราชการไทย (เริ่ม 1 ต.ค.)
//
// ตรวจสองอย่าง
//   1. periodKey_() ใน Config.gs ให้ค่าถูกต้องตรงตามรอยต่อของแต่ละไตรมาส
//   2. periodKey() ใน js.html ซึ่งเป็นคู่แฝดฝั่งหน้าจอ ให้ค่าตรงกันทุกเคส
//      ถ้าสองตัวนี้เพี้ยนจากกัน เลขบนแท่งกราฟกับรายชื่อที่กดดูจะไม่ตรงกัน

const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'apps-script');
const config = fs.readFileSync(path.join(SRC, 'Config.gs'), 'utf8');
const js = fs.readFileSync(path.join(SRC, 'js.html'), 'utf8');

// Config.gs เป็น JavaScript ล้วน โหลดมาใช้ได้เลย
eval(config.replace(/^\s*function (\w+)/gm, 'global.$1 = function $1'));

// js.html เป็นหน้าจอทั้งหน้า จึงดึงมาเฉพาะฟังก์ชันที่จะทดสอบ
const grabbed = js.match(/function periodKey\(iso, mode\)[\s\S]*?\r?\n\}/);
if (!grabbed) {
  console.log('FAIL  หา periodKey() ใน js.html ไม่เจอ - อาจถูกเปลี่ยนชื่อไปแล้ว');
  process.exit(1);
}
eval('global.periodKeyClient = ' + grabbed[0].replace('function periodKey', 'function'));

// [วันที่, ไตรมาสที่คาดหวัง, ปีงบที่คาดหวัง, คำอธิบาย]
const cases = [
  ['2025-09-30', 'FY2568-Q4', 'FY2568', 'วันสุดท้ายของปีงบ 2568'],
  ['2025-10-01', 'FY2569-Q1', 'FY2569', 'วันแรกของปีงบ 2569 - ขึ้นปีงบใหม่ทั้งที่ยังเป็น ค.ศ. เดิม'],
  ['2025-11-30', 'FY2569-Q1', 'FY2569', 'กลางไตรมาส 1'],
  ['2025-12-31', 'FY2569-Q1', 'FY2569', 'วันสุดท้ายของไตรมาส 1'],
  ['2026-01-01', 'FY2569-Q2', 'FY2569', 'ข้ามปี ค.ศ. แต่ยังปีงบเดิม'],
  ['2026-03-31', 'FY2569-Q2', 'FY2569', 'วันสุดท้ายของไตรมาส 2'],
  ['2026-04-01', 'FY2569-Q3', 'FY2569', 'วันแรกของไตรมาส 3'],
  ['2026-06-30', 'FY2569-Q3', 'FY2569', 'วันสุดท้ายของไตรมาส 3'],
  ['2026-07-01', 'FY2569-Q4', 'FY2569', 'วันแรกของไตรมาส 4'],
  ['2026-09-30', 'FY2569-Q4', 'FY2569', 'วันสุดท้ายของปีงบ 2569'],
  ['2026-10-01', 'FY2570-Q1', 'FY2570', 'วันแรกของปีงบ 2570'],
  ['', '', '', 'ช่องว่าง'],
  ['ยบ.IMC', '', '', 'ข้อความที่ไม่ใช่วันที่'],
];

let pass = 0, fail = 0;
const check = (label, got, want) => {
  const ok = got === want;
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `  ได้ ${got || '(ว่าง)'} คาดหวัง ${want || '(ว่าง)'}`}`);
};

for (const [iso, q, y, label] of cases) {
  const gotQ = periodKey_(iso, 'quarters');
  const gotY = periodKey_(iso, 'years');
  check(`${String(iso || '(ว่าง)').padEnd(12)} -> ${(gotQ || '(ว่าง)').padEnd(11)} [${label}]`, gotQ, q);
  check(`${''.padEnd(12)}    ${(gotY || '(ว่าง)').padEnd(11)} รายปีงบ`, gotY, y);

  for (const mode of ['months', 'quarters', 'years']) {
    check(`${''.padEnd(12)}    js.html ตรงกัน (${mode})`,
      periodKeyClient(iso, mode), periodKey_(iso, mode));
  }
}

// เดือนยังเป็นปฏิทินตามเดิม เพราะไม่มีปัญหาคาบเกี่ยวปี
check('เดือนคงรูปเดิม 2025-10-01 -> 2025-10', periodKey_('2025-10-01', 'months'), '2025-10');

// กราฟเรียงแท่งด้วย sort() แบบข้อความ กุญแจจึงต้องเรียงตรงตามเวลา
const chrono = ['2025-09-30', '2025-10-01', '2026-01-01', '2026-04-01', '2026-07-01', '2026-10-01'];
for (const mode of ['quarters', 'years']) {
  const keys = chrono.map(d => periodKey_(d, mode));
  const sorted = Array.from(new Set(keys)).sort();
  const expected = Array.from(new Set(keys));
  check(`เรียงด้วย sort() ได้ลำดับเวลาถูกต้อง (${mode})`, sorted.join(' '), expected.join(' '));
}

console.log(`\nรวม: ${pass} ผ่าน / ${fail} ไม่ผ่าน`);
process.exit(fail ? 1 : 0);
