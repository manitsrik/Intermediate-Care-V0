// ทดสอบตรรกะแปลงวันที่จาก Util.gs กับค่าจริงที่พบในไฟล์ ตยเคส.xlsx
const fs = require('fs');
const src = fs.readFileSync(require('path').join(__dirname, '..', 'apps-script', 'Util.gs'), 'utf8');

// จำลอง Utilities ของ Apps Script เท่าที่ฟังก์ชันวันที่ต้องใช้
global.Utilities = {
  formatDate(d, tz, fmt) {
    const p = n => String(n).padStart(2, '0');
    return fmt.replace('yyyy', d.getFullYear())
      .replace('MM', p(d.getMonth() + 1))
      .replace('dd', p(d.getDate()));
  }
};
eval(src.replace(/^\s*function (\w+)/gm, 'global.$1 = function $1'));

const cases = [
  [25132, 'admit เคส 1 (พิมพ์ 21/10/68)', '2025-10-21'],
  [25144, 'D/C เคส 1', '2025-11-02'],
  [25156, 'วันนัด KBH เคส 1', '2025-11-14'],
  [45982, '4th FU เคส 1 (วันที่จริง)', '2025-11-21'],
  [46003, 'ช่อง BI4 ที่เก็บวันที่', '2025-12-12'],
  [46073, 'ช่อง BI5 ที่เก็บวันที่', '2026-02-20'],
  ['27/10/68', 'วัน Start แบบข้อความ', '2025-10-27'],
  ['1/12/68', 'วัน Start เคส 3', '2025-12-01'],
  ['01 พฤษภาคม 2569', 'วันสิ้นสุด IMC', '2026-05-01'],
  ['12/12/68 วีแคร์', 'วันนัดที่มีข้อความปน', '2025-12-12'],
  ['ยบ.IMC 11/11', 'ช่อง FU ไม่มีปี', ''],
  ['9/1 30/1', 'สองวันในช่องเดียว', ''],
];

let pass = 0, fail = 0;
for (const [input, label, expected] of cases) {
  const r = parseLegacyDate_(input);
  const ok = r.iso === expected;
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${String(input).padEnd(18)} -> ${(r.iso || '(ว่าง)').padEnd(12)} ` +
    `[${label}]${ok ? '' : '  คาดหวัง ' + expected}`);
  if (r.issue) console.log(`        แจ้งเตือน: ${r.issue}`);
}

console.log(`\nthDate: ${toThaiDate_('2025-10-01')} | ${toThaiDate_('2026-05-01', true)}`);
console.log(`+183 วันจาก 2025-10-27 = ${addDaysIso_('2025-10-27', 183)}`);
console.log(`\nรวม: ${pass} ผ่าน / ${fail} ไม่ผ่าน`);
