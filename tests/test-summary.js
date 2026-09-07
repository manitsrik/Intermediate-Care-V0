// ทดสอบชีต summary กับคอลัมน์ bi_1..bi_N บนแถวผู้ป่วย
//
// ประเด็นที่ต้องกันไว้
//   1. สูตรในชีต summary ต้องไม่มีตัวไหนไล่ค้นข้ามตาราง เพราะงานจะโตเป็น
//      (จำนวนผู้ป่วย x จำนวนใบประเมิน) แล้วชีตจะอืดขึ้นเรื่อย ๆ ตามปีที่ใช้งาน
//   2. backfillBiColumns_() ต้องวางคะแนนลงถูกคนถูกช่อง และเรียกซ้ำได้ผลเท่าเดิม
//   3. คอลัมน์ที่เพิ่มใหม่ต้องต่อท้าย ตำแหน่งคอลัมน์เดิมห้ามขยับ ไม่งั้นข้อมูลจริงเลื่อน

const fs = require('fs');
const path = require('path');
const SRC = path.join(__dirname, '..', 'apps-script');

/* ---------------------------------------------- ชีตจำลองเท่าที่โค้ดเรียกใช้ */

function FakeSheet(name, rows, cols) {
  this.name = name;
  this.maxRows = rows;
  this.maxCols = cols;
  this.values = [];        // [r][c] แบบ 0-based
  this.formulas = {};      // 'r,c' -> สูตร
  this.cleared = false;
}
FakeSheet.prototype.at = function (r, c) {
  while (this.values.length <= r) this.values.push([]);
  while (this.values[r].length <= c) this.values[r].push('');
  return this.values[r][c];
};
FakeSheet.prototype.getMaxRows = function () { return this.maxRows; };
FakeSheet.prototype.getMaxColumns = function () { return this.maxCols; };
FakeSheet.prototype.insertColumnsAfter = function (after, n) { this.maxCols = after + n; };
FakeSheet.prototype.setFrozenRows = function () { return this; };
FakeSheet.prototype.setColumnWidth = function () { return this; };
FakeSheet.prototype.clear = function () { this.cleared = true; this.values = []; this.formulas = {}; return this; };
FakeSheet.prototype.protect = function () {
  return { setDescription: function () { return { setWarningOnly: function () {} }; } };
};
FakeSheet.prototype.getLastRow = function () {
  let last = 0;
  this.values.forEach((row, i) => { if (row && row.join('') !== '') last = i + 1; });
  return last;
};
FakeSheet.prototype.getRange = function (r, c, nr, nc) {
  const sh = this;
  nr = nr || 1; nc = nc || 1;
  if (c + nc - 1 > sh.maxCols) throw new Error(`นอกขอบเขต: ${sh.name} กว้าง ${sh.maxCols} แต่เขียนถึงคอลัมน์ ${c + nc - 1}`);
  const api = {
    setValues(vals) {
      vals.forEach((row, i) => row.forEach((v, j) => {
        sh.at(r - 1 + i, c - 1 + j);
        sh.values[r - 1 + i][c - 1 + j] = v;
      }));
      return api;
    },
    getValues() {
      const out = [];
      for (let i = 0; i < nr; i++) {
        const row = [];
        for (let j = 0; j < nc; j++) row.push(sh.at(r - 1 + i, c - 1 + j));
        out.push(row);
      }
      return out;
    },
    setFormula(f) { sh.formulas[`${r},${c}`] = f; return api; },
    setNumberFormat() { return api; },
    setFontWeight() { return api; },
    setBackground() { return api; },
  };
  return api;
};

const sheets = {};
const ss = {
  getSheetByName: (n) => sheets[n] || null,
  insertSheet: (n) => (sheets[n] = new FakeSheet(n, 1000, 26)),
};

global.SpreadsheetApp = {
  getActiveSpreadsheet: () => ss,
  getUi: () => ({ alert() {}, ButtonSet: { OK: 'OK' }, createMenu: () => ({ addItem() { return this; }, addSeparator() { return this; }, addToUi() {} }) }),
};
global.Utilities = { formatDate: (d, tz, f) => '' };
global.Session = { getActiveUser: () => ({ getEmail: () => 'test@local' }) };

/* ------------------------------------------------------ โหลดโค้ดจริงมาใช้ */

for (const f of ['Config.gs', 'Util.gs', 'Schema.gs']) {
  eval(fs.readFileSync(path.join(SRC, f), 'utf8').replace(/^\s*function (\w+)/gm, 'global.$1 = function $1'));
}

let pass = 0, fail = 0;
const check = (label, ok, detail) => {
  ok ? pass++ : fail++;
  console.log(`${ok ? 'ผ่าน ' : 'ไม่ผ่าน'}  ${label}${ok || !detail ? '' : `\n        ${detail}`}`);
};

/* ------------------------------------- 1. คอลัมน์ใหม่ต้องต่อท้าย ไม่แทรกกลาง */

const cols = SCHEMA[SHEETS.PATIENTS];
const before = ['status', 'legacy_row', 'created_by', 'created_at', 'updated_by', 'updated_at'];
check('คอลัมน์เดิมยังอยู่ตำแหน่งเดิม ไม่มีอะไรแทรกกลาง',
  cols.slice(cols.length - 5 - before.length, cols.length - 5).join(',') === before.join(','),
  'ท้ายรายการคือ ' + cols.slice(-11).join(','));
check(`ต่อ bi_1..bi_${CONFIG.BI_SUMMARY_COLUMNS} ไว้ท้ายสุด`,
  cols.slice(-CONFIG.BI_SUMMARY_COLUMNS).join(',') ===
    Array.from({ length: CONFIG.BI_SUMMARY_COLUMNS }, (_, i) => 'bi_' + (i + 1)).join(','));

/* ------------------------------------------------ 2. สูตรในชีต summary */

// ชีตของจริงกว้าง 26 คอลัมน์ตอนสร้าง แคบกว่า SCHEMA อยู่แล้ว ใช้ทดสอบการขยายไปในตัว
sheets[SHEETS.PATIENTS] = new FakeSheet(SHEETS.PATIENTS, 1000, 26);
sheets[SHEETS.BI] = new FakeSheet(SHEETS.BI, 1000, 26);
buildSummarySheet_(ss);

const formulas = Object.values(sheets[SHEETS.SUMMARY].formulas);
check('สร้างสูตรครบทุกคอลัมน์', formulas.length === 24, 'ได้ ' + formulas.length + ' สูตร');
check('ไม่มีสูตรไหนไล่ค้นข้ามตาราง (VLOOKUP/MATCH/QUERY/FILTER)',
  !formulas.some((f) => /VLOOKUP|MATCH\(|QUERY|FILTER/.test(f)),
  formulas.find((f) => /VLOOKUP|MATCH\(|QUERY|FILTER/.test(f)));
check('ไม่มีสูตรไหนอ้างชีต bi_assessments อีกแล้ว',
  !formulas.some((f) => f.includes(SHEETS.BI)),
  formulas.find((f) => f.includes(SHEETS.BI)));
check('ช่วงเปิดปลาย ไม่มีเพดานแถว',
  formulas.every((f) => !/\d+\s*\)/.test(f.replace(/bi_\d/g, '')) || !/![A-Z]+2:[A-Z]+\d/.test(f)),
  formulas.find((f) => /![A-Z]+2:[A-Z]+\d/.test(f)));

const biFormula = sheets[SHEETS.SUMMARY].formulas['2,14'];  // คอลัมน์ที่ 14 คือ BI 1
check('คอลัมน์ BI 1 ดึงจาก patients!bi_1 ตรง ๆ',
  biFormula && biFormula.includes("'patients'!" + letter_(idx_(SHEETS.PATIENTS, 'bi_1')) + '2:'),
  biFormula);

/* --------------------------------------------- 3. เติมคะแนนย้อนหลัง */

const P = SCHEMA[SHEETS.PATIENTS], B = SCHEMA[SHEETS.BI];
const patients = sheet_(SHEETS.PATIENTS);   // ผ่าน sheet_() เหมือนของจริง จะได้ถูกขยายคอลัมน์ให้
patients.getRange(1, 1, 1, P.length).setValues([P]);
[['TEST001'], ['TEST002'], ['TEST003']].forEach((hn, i) => {
  patients.getRange(2 + i, idx_(SHEETS.PATIENTS, 'hn')).setValues([hn]);
});

const bi = sheet_(SHEETS.BI);
bi.getRange(1, 1, 1, B.length).setValues([B]);
const biRows = [
  ['TEST001', 1, 8], ['TEST001', 2, 12], ['TEST001', 3, 16],
  ['TEST002', 1, 5],
  ['TEST002', 7, 99],            // เกินจำนวนคอลัมน์ที่มี ต้องถูกข้าม ไม่ใช่ล้นไปทับใคร
  ['TEST999', 1, 20],            // ไม่มีในตารางผู้ป่วย ต้องไม่ทำให้พัง
];
biRows.forEach((r, i) => {
  bi.getRange(2 + i, idx_(SHEETS.BI, 'hn')).setValues([[r[0]]]);
  bi.getRange(2 + i, idx_(SHEETS.BI, 'seq')).setValues([[r[1]]]);
  bi.getRange(2 + i, idx_(SHEETS.BI, 'total')).setValues([[r[2]]]);
});

const filled = backfillBiColumns_();
const readBi = (rowIdx) => {
  const c = idx_(SHEETS.PATIENTS, 'bi_1');
  return patients.getRange(2 + rowIdx, c, 1, CONFIG.BI_SUMMARY_COLUMNS).getValues()[0];
};

check('เติมครบทุกแถวผู้ป่วย', filled === 3, 'เติม ' + filled + ' แถว');
check('TEST001 ได้คะแนนครั้งที่ 1-3 ตรงช่อง ที่เหลือว่าง',
  readBi(0).join(',') === '8,12,16,,', readBi(0).join(','));
check('TEST002 ได้เฉพาะครั้งที่ 1 ที่เหลือว่าง',
  readBi(1).join(',') === '5,,,,', readBi(1).join(','));
check('ครั้งที่ 7 ซึ่งเกินจำนวนคอลัมน์ ถูกข้ามไป ไม่ล้นไปทับช่องอื่น',
  readBi(1)[1] === '' && readBi(1)[4] === '');
check('TEST003 ที่ยังไม่เคยประเมิน เป็นค่าว่างทั้งแถว',
  readBi(2).join('') === '', readBi(2).join(','));

const snapshot = [readBi(0), readBi(1), readBi(2)].join('|');
backfillBiColumns_();
check('เรียกซ้ำแล้วผลเหมือนเดิม',
  [readBi(0), readBi(1), readBi(2)].join('|') === snapshot);

/* ------------------------------------- 4. ชีตแคบกว่า SCHEMA ต้องขยายให้เอง */

const narrow = new FakeSheet(SHEETS.FOLLOWUPS, 1000, 3);
sheets[SHEETS.FOLLOWUPS] = narrow;
sheet_(SHEETS.FOLLOWUPS);
check('sheet_() ขยายคอลัมน์ให้พอกับ SCHEMA เอง',
  narrow.getMaxColumns() >= SCHEMA[SHEETS.FOLLOWUPS].length,
  'กว้าง ' + narrow.getMaxColumns() + ' ต้องการ ' + SCHEMA[SHEETS.FOLLOWUPS].length);
check('ชีต patients ถูกขยายจาก 26 คอลัมน์ให้พอกับคอลัมน์ bi ที่เพิ่มมา',
  patients.getMaxColumns() >= P.length,
  'กว้าง ' + patients.getMaxColumns() + ' ต้องการ ' + P.length);

console.log(`\nรวม: ${pass} ผ่าน / ${fail} ไม่ผ่าน`);
process.exit(fail ? 1 : 0);
