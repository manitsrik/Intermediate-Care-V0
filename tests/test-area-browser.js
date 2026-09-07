// Optional real-browser checks, no npm dependencies. Requires Node 22+ and Chrome.
// node tests/test-area-browser.js "path/to/chrome.exe"
// Build preview first. All data and screenshots remain under ignored preview/.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { spawn } = require('node:child_process');
const zlib = require('node:zlib');
const chromePath = process.argv[2];
if (!chromePath || !fs.existsSync(chromePath)) throw new Error('Pass the path to Chrome as the first argument');
const out = path.resolve(__dirname, '../preview');
const profile = fs.mkdtempSync(path.join(out, 'browser-test-'));
const chrome = spawn(chromePath, ['--headless=new', '--window-size=1440,1080', '--no-first-run', '--no-default-browser-check',
  '--remote-debugging-port=0', '--user-data-dir=' + profile, 'about:blank'], { windowsHide: true, stdio: 'ignore' });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
let ws, nextId = 0, checks = 0;
const pending = new Map(), exceptions = [];
let launchError;
chrome.on('error', e => { launchError = e; });
// toast ของแอปเป็นโมดัลที่รอคนกดตกลง ไม่ใช่ข้อความที่หายเอง
// ถ้าไม่ปิดให้ ลำดับหลังบันทึกจะไม่เดินต่อ และเทสต์จะค้างจนหมดเวลา
async function submitAndDismiss(formId) {
  await evaluate('document.getElementById("' + formId + '").requestSubmit()');
  await until(() => evaluate('!document.getElementById("modal").hidden'));
  await evaluate('document.getElementById("modal-ok").click()');
}

async function until(fn, timeout = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeout) { if (await fn()) return; await sleep(100); }
  throw new Error('Timed out waiting for browser');
}
function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++nextId;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error('CDP timeout: ' + method)); }, 15000);
    pending.set(id, { resolve, reject, timer });
    ws.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expression) {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
}
async function check(label, expression) {
  assert.equal(await evaluate(expression), true, label);
  checks++; console.log('PASS ' + label);
}
async function screenshot(name) {
  await evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
  const r = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  fs.writeFileSync(path.join(out, name), Buffer.from(r.data, 'base64'));
}
(async () => {
  try {
    const portFile = path.join(profile, 'DevToolsActivePort');
    await until(() => { if (launchError) throw launchError; return fs.existsSync(portFile); });
    const port = fs.readFileSync(portFile, 'utf8').split('\n')[0];
    const pages = await (await fetch('http://127.0.0.1:' + port + '/json/list')).json();
    ws = new WebSocket(pages.find(p => p.type === 'page').webSocketDebuggerUrl);
    ws.addEventListener('message', e => {
      const msg = JSON.parse(e.data);
      if (msg.method === 'Runtime.exceptionThrown') exceptions.push(msg.params.exceptionDetails);
      const p = pending.get(msg.id);
      if (p) { clearTimeout(p.timer); pending.delete(msg.id); msg.error ? p.reject(new Error(msg.error.message)) : p.resolve(msg.result); }
    });
    await new Promise((resolve, reject) => { ws.addEventListener('open', resolve, { once: true }); ws.addEventListener('error', reject, { once: true }); });
    await send('Runtime.enable'); await send('Page.enable');
    await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1080, deviceScaleFactor: 1, mobile: false });
    await send('Page.navigate', { url: pathToFileURL(path.join(out, 'index.html')).href });
    await until(() => evaluate('typeof BOOT !== "undefined" && !!BOOT'));
    await evaluate('MOCK_DELAY_MS = 0; go("dashboard")');
    await check('Dashboard keeps region data without rendering a table', 'dashCache.total === 6 && document.querySelectorAll("main .area-table").length === 0 && dashCache.districts.reduce((s,r) => s+r.total,0) === 6');
    // หัว-ท้ายกระดาษเป็นของกระดาษ บนจอมีแถบบนกับเมนูซ้ายบอกอยู่แล้ว
    await check('The letterhead stays off the screen',
      'document.querySelector(".letterhead").offsetParent === null' +
      ' && document.querySelector(".print-foot").offsetParent === null');
    await screenshot('dashboard-areas-desktop.png');

    /*
      แดชบอร์ดก็ถูกพิมพ์เหมือนกัน และใช้ @page เดียวกับหน้ารายงาน
      พอเปลี่ยนกระดาษเป็นแนวตั้ง ความกว้างลดจาก 1063px เหลือ 725px
      ต้องไม่มีการ์ดใบไหนล้นออกนอกกระดาษ และการ์ดสามใบต้องยังอยู่แถวเดียวกัน
    */
    await send('Emulation.setDeviceMetricsOverride', { width: 725, height: 1000, deviceScaleFactor: 1, mobile: false });
    await send('Emulation.setEmulatedMedia', { media: 'print' });
    await evaluate('new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))');
    await check('The dashboard still fits portrait paper with its cards on one row',
      'document.documentElement.scrollWidth <= innerWidth' +
      ' && new Set([...document.querySelectorAll(".stat-card")].map(c => Math.round(c.getBoundingClientRect().top))).size === 1');
    await send('Emulation.setEmulatedMedia', { media: '' });
    await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1080, deviceScaleFactor: 1, mobile: false });

    await evaluate('changeArea("scope", "krabi")');
    await check('Province filter excludes outside and unconfirmed addresses', 'dashCache.total === 4');
    await evaluate('changeArea("district", "เมืองกระบี่")');
    await check('City filter', 'dashCache.total === 3');
    await evaluate('changeArea("tambon", "ปากน้ำ")');
    await check('Tambon filter updates cards and snapshot', 'dashCache.total === 2 && dashboardPatients().every(p => p.tambon === "ปากน้ำ")');
    await evaluate('openDashboardPatients()');
    await check('Tambon drilldown matches total', 'sheetRows.length === 2 && sheetRows.every(p => p.tambon === "ปากน้ำ") && !document.getElementById("listmodal").hidden');
    await evaluate('closeList(); openPeriod(dashCache.months[0].key)');
    await check('Monthly drilldown keeps area filter', 'sheetRows.length === dashCache.months[0].count && sheetRows.every(p => p.tambon === "ปากน้ำ")');
    await evaluate('closeList(); openScreening("IMC")');
    await check('Screening drilldown keeps area filter', 'sheetRows.length === dashCache.imc');
    await evaluate('closeList(); openUpcomingPatients()');
    await check('Appointments keep area filter', 'sheetRows.every(p => p.tambon === "ปากน้ำ" && p.status !== "closed" && p.kbh_appt_date >= dashCache.today)');
    await evaluate('closeList(); var exportedCsv = ""; var originalCreateURL = URL.createObjectURL; URL.createObjectURL = function(b) { b.text().then(t => exportedCsv = t); return originalCreateURL.call(URL,b); }; openDashboardPatients(); exportSheet()');
    await until(() => evaluate('exportedCsv.length > 0'));
    await check('CSV contains region columns and only the selected patients', 'exportedCsv.includes("จังหวัด") && exportedCsv.includes("TEST001") && exportedCsv.includes("TEST004") && !exportedCsv.includes("TEST002")');
    await evaluate('closeList(); changeArea("tambon", "เขาทอง")');
    await check('Empty area displays zero without NaN', 'dashCache.total === 0 && !main().textContent.includes("NaN")');
    await evaluate('resetArea()');

    /* ------------------------------------------------------ หน้ารายงาน

      ตรวจบนจอกว้างก่อน เพราะตารางแจกแจงพื้นที่กับตารางความคืบหน้าเป็นตารางจริง
      เฉพาะบนจอกว้าง บนมือถือถูกพับเป็นการ์ดจนนับคอลัมน์ไม่ได้
    */
    await evaluate('go("report")');
    await until(() => evaluate('!!reportCache'));

    await check('Every bar panel counts to its own stated base',
      'REPORT_PANELS.every(p => (reportCache[p.key] || []).reduce((s, x) => s + x.count, 0) === reportCache.bases[p.key])');
    // ถ้าทุกใบฐานเท่ากันหมด การเขียนฐานกำกับก็ไม่พิสูจน์อะไร ต้องมีใบที่ฐานต่างจริง
    await check('Panels really do sit on different bases',
      'reportCache.bases.dcReasons === reportCache.closed && reportCache.bases.wards === reportCache.total' +
      ' && reportCache.bases.dcReasons !== reportCache.bases.wards');
    await check('Each panel head prints its base on screen',
      '[...document.querySelectorAll(".rep-grid .panel-head .sub")].length === REPORT_PANELS.length' +
      ' && [...document.querySelectorAll(".rep-grid .panel-head .sub")].every(s => /จาก[^0-9]*[0-9]+/.test(s.textContent))');

    await evaluate('openReportRow("wards", 0)');
    await check('Clicking a bar opens exactly the patients behind that bar',
      'sheetRows.length === reportCache.wards[0].count' +
      ' && sheetRows.every(p => p.ward === reportCache.wards[0].name)' +
      ' && !document.getElementById("listmodal").hidden');
    await evaluate('closeList(); openReportRow("adl", 0)');
    await check('ADL drilldown reads the same group the bar was counted from',
      'sheetRows.length === reportCache.adl[0].count' +
      ' && sheetRows.every(p => p.groups.adl === reportCache.adl[0].name)');

    await evaluate('closeList()');
    await check('Outcome figures render real numbers, never NaN',
      '!document.querySelector(".outcome").textContent.includes("NaN")' +
      ' && document.querySelectorAll(".outcome .outcome-fig").length === 5');
    /*
      หน้ารายงานต้องไม่หยิบการ์ดสีของแดชบอร์ดมาใช้ ไม่งั้นสองหน้าที่ตอบคนละคำถาม
      จะหน้าตาเหมือนกันจนแยกไม่ออก ยิ่งใบ "คะแนน BI เพิ่มเฉลี่ย" มีอยู่ทั้งสองหน้า
      คนละฐานคนละช่วงเวลา ถ้าวางเหมือนกันจะอ่านไม่ออกว่าเป็นเลขของหน้าไหน
    */
    await check('The report never borrows the dashboard stat cards',
      'document.querySelectorAll("main .stat-card").length === 0' +
      ' && document.querySelector(".outcome").closest(".panel") !== null');
    // ยอดผู้ป่วยไม่ใช่ผลลัพธ์ แต่เป็นขอบเขตของทุกตัวเลข จึงอยู่บนหัวหน้า
    await check('Patient counts live in the page head, not as an outcome figure',
      'document.querySelector(".rep-head .head-text").textContent.includes("กำลังดูแล")' +
      ' && document.querySelector(".rep-head .head-text").textContent.includes("จบแล้ว")' +
      ' && !document.querySelector(".outcome").textContent.includes("กำลังดูแล")');
    /*
      หัวหน้าเรียงเป็นสามชั้น ชื่อหน้ากับปุ่ม / ขอบเขต / ตัวกรอง
      ตัวกรองต้องเป็นแถวเต็มความกว้างของตัวเอง ไม่ใช่ไปเบียดอยู่ข้างชื่อหน้าแบบเดิม
      และปุ่มล้างต้องอยู่ท้ายสุดของแถว ไม่ใช่ค้างอยู่กลางระหว่างช่องพื้นที่กับช่องอื่น
    */
    await check('Head stacks into three bands with filters on a full-width row',
      'document.querySelectorAll(".rep-head .head-text .sub").length === 2' +
      ' && document.querySelector(".rep-head .rep-actions") !== null' +
      ' && Math.round(document.querySelector(".rep-filters").getBoundingClientRect().width)' +
      '    > Math.round(document.querySelector(".rep-head .head-text").getBoundingClientRect().width)' +
      ' && document.querySelector(".rep-filters").getBoundingClientRect().top' +
      '    > document.querySelector(".rep-head .head-text").getBoundingClientRect().top');
    /*
      ปุ่มล้างต้องอยู่ท้ายแถวเดียวกับช่องอื่น ไม่ใช่ตกลงไปบรรทัดใหม่ตัวเดียวโดด ๆ
      วัดว่ามันอยู่แถวเดียวกับช่องแรกจริง คือขอบบนยังไม่พ้นขอบล่างของช่องแรก
    */
    await check('The clear button sits last on the same filter row',
      'document.querySelector(".rep-selects").lastElementChild.classList.contains("area-clear")' +
      ' && document.querySelectorAll(".rep-selects .area-field").length === 7' +
      ' && document.querySelector(".rep-selects .area-clear").getBoundingClientRect().top' +
      '    < document.querySelector(".rep-selects .area-field").getBoundingClientRect().bottom');
    // ล้างแล้วต้องกลับไปตั้งต้นทุกช่อง ไม่ใช่เหลือปีงบหรือสถานะค้างไว้
    await evaluate('changeReportStatus("closed")');
    await until(() => evaluate('reportCache.status === "closed"'));
    await evaluate('changeReportYear(reportCache.fiscalYears[0])');
    await until(() => evaluate('!!reportCache.fy'));
    await evaluate('resetReportFilters()');
    await until(() => evaluate('reportCache.status === "" && reportCache.fy === ""'));
    await check('Clearing resets every filter, not just the area ones',
      'reportFilter.scope === "all" && !reportFilter.fy && !reportFilter.fq' +
      ' && !reportFilter.status && !reportFilter.dxGroup' +
      ' && document.querySelector(".rep-selects .area-clear").disabled === true');
    /*
      บรรทัดรองต้องไม่ถูกตัดกลางคำไทย เบราว์เซอร์ตัดตามพจนานุกรมของมัน
      "จบแล้ว 2" จึงกลายเป็น "จบ" ท้ายบรรทัดกับ "แล้ว 2" บรรทัดใหม่ได้ถ้าไม่กัน
      หนึ่งท่อนที่กินสองบรรทัด = หนึ่งท่อนที่มีมากกว่าหนึ่งกล่องข้อความ
    */
    await check('Sub-lines break at separators, never inside a Thai word',
      '[...document.querySelectorAll(".fig-m .nb, .page-head .sub .nb")].length > 0' +
      ' && [...document.querySelectorAll(".fig-m .nb, .page-head .sub .nb")]' +
      '      .every(s => s.getClientRects().length === 1)');
    // TEST006 มีใบประเมินใบเดียว ยังไม่มีอะไรให้เทียบ ต้องไม่ถูกนับเป็น "คงที่"
    await check('ADL shift ignores patients assessed only once',
      'reportCache.outcome.adlShift.base === 5 && reportCache.outcome.adlShift.up' +
      ' + reportCache.outcome.adlShift.same + reportCache.outcome.adlShift.down === 5');
    await check('Six-month outcome counts only closed cases with both dates',
      'reportCache.outcome.sixMonth.base === reportCache.closed');

    await check('Data-quality panel points at the rows that are actually incomplete',
      'reportCache.gaps.filter(g => g.count).length > 0' +
      ' && document.querySelectorAll(".panel .todo-row").length === reportCache.gaps.filter(g => g.count).length');
    await evaluate('openReportGap("area")');
    await check('Incomplete-address drilldown matches its count',
      'sheetRows.length === reportCache.gaps.filter(g => g.key === "area")[0].count' +
      ' && sheetRows.every(p => p.gaps.indexOf("area") !== -1)');

    await evaluate('closeList()');
    await check('Area breakdown accounts for every patient exactly once',
      'reportCache.areas.reduce((s, r) => s + r.total, 0) === reportCache.total' +
      ' && reportCache.areas.every(r => r.bed + r.home + r.social + r.unassessed === r.total)');
    await evaluate('openReportArea(0)');
    await check('Area row drilldown matches its total',
      'sheetRows.length === reportCache.areas[0].total');

    await evaluate('closeList()');
    await check('Progress table starts with the biggest gain first',
      'progressDesc === true && reportCache.progress[0].gain >= reportCache.progress[reportCache.progress.length - 1].gain');
    await evaluate('toggleProgressSort()');
    // แถบเน้นต้องมองเห็นจริงบนจอที่กำลังดูอยู่ ไม่ใช่ไปติดอยู่บนช่องที่ถูกซ่อน
    await check('Sorting the other way surfaces the patients who did not improve',
      'progressDesc === false' +
      ' && document.querySelectorAll("table.rep-progress tbody tr.row-flat").length > 0' +
      ' && document.querySelector("table.rep-progress tbody tr").classList.contains("row-flat")' +
      ' && [...document.querySelectorAll("table.rep-progress tbody tr.row-flat td")]' +
      '      .some(td => td.offsetParent !== null && getComputedStyle(td).boxShadow !== "none")');
    await evaluate('toggleProgressSort()');

    /*
      ข้อมูลตัวอย่างมีแค่หกราย เห็นเพดานสิบแถวไม่ได้
      ยัดแถวปลอมเข้าไปในผลที่ได้มาแล้ววาดใหม่ เพื่อตรวจเฉพาะการตัดแถวของหน้าจอ
      แล้วโยนของปลอมทิ้งด้วยการล้างแคช รอบถัดไปจะถามเซิร์ฟเวอร์ใหม่เอง
    */
    await evaluate('window.__realProgress = reportCache.progress;' +
      'reportCache.progress = Array.from({length: 25}, (_, i) => ({hn: "X" + i, name: "x", dx: "", ward: "", first: 1, latest: 1 + i, gain: i, adl: "", status: "active"}));' +
      'drawReport(reportCache)');
    await check('A long progress table shows ten rows with a way to see the rest',
      'document.querySelectorAll("table.rep-progress tbody tr").length === 10' +
      ' && main().textContent.includes("แสดง 10 จาก 25 ราย")');
    await evaluate('toggleProgressAll()');
    await check('Show-all reveals every row', 'document.querySelectorAll("table.rep-progress tbody tr").length === 25');
    await evaluate('toggleProgressAll(); reportCache.progress = window.__realProgress; drawReport(reportCache)');

    /*
      หางยาวของการ์ดก็เห็นไม่ได้จากข้อมูลตัวอย่างเช่นกัน หอผู้ป่วยมีแค่สามกลุ่ม
      ตรวจเฉพาะการยุบและกางของหน้าจอด้วยชุดปลอม แล้วคืนของจริงกลับไป
    */
    await evaluate('window.__realWards = reportCache.wards;' +
      'reportCache.wards = Array.from({length: 9}, (_, i) => ({name: "W" + i, count: 9 - i}));' +
      'reportCache.bases.wards = 45; drawReport(reportCache)');
    await check('A long bar panel collapses its tail into one summary row',
      '[...document.querySelectorAll(".rep-grid .panel")].filter(p => p.textContent.includes("หอผู้ป่วย"))[0]' +
      '  .querySelectorAll(".hbar-row").length === 6' +
      ' && main().textContent.includes("อื่น ๆ อีก 4 กลุ่ม")');
    await evaluate('toggleReportRows("wards")');
    await check('Expanding the tail shows every group',
      '[...document.querySelectorAll(".rep-grid .panel")].filter(p => p.textContent.includes("หอผู้ป่วย"))[0]' +
      '  .querySelectorAll(".hbar-row").length === 10');
    await evaluate('toggleReportRows("wards"); reportCache.wards = window.__realWards;' +
      'reportCache.bases.wards = reportCache.total; drawReport(reportCache)');

    await evaluate('exportedCsv = ""; exportReportSummary()');
    await until(() => evaluate('exportedCsv.length > 0'));
    await check('Summary export carries the filter context, every panel and the outcome numbers',
      'exportedCsv.includes("พื้นที่") && exportedCsv.includes("ทุกปีงบ")' +
      ' && REPORT_PANELS.every(p => exportedCsv.includes(p.title))' +
      ' && exportedCsv.includes("คะแนน BI เพิ่มเฉลี่ย")' +
      ' && exportedCsv.includes("เลื่อนกลุ่ม ADL ดีขึ้น (ราย)")');

    await evaluate('exportedCsv = ""; exportReportPatients()');
    await until(() => evaluate('exportedCsv.length > 0'));
    await check('Patient export holds exactly the filtered patients',
      'exportedCsv.trim().split("\\r\\n").length === reportCache.total + 1 && exportedCsv.includes("TEST001")');

    // กรองสถานะแล้วทุกแท่งต้องนับใหม่จากชุดที่เหลือ ไม่ใช่ค้างเลขของชุดเดิม
    await evaluate('changeReportStatus("closed")');
    await until(() => evaluate('reportCache.status === "closed"'));
    await check('Status filter narrows every panel, not just the header',
      'reportCache.patients.every(p => p.status === "closed")' +
      ' && reportCache.total === reportCache.closed' +
      ' && reportCache.bases.wards === reportCache.total' +
      ' && reportCache.wards.reduce((s, x) => s + x.count, 0) === reportCache.total');
    await evaluate('exportedCsv = ""; exportReportSummary()');
    await until(() => evaluate('exportedCsv.length > 0'));
    await check('Summary export states which filter produced it', 'exportedCsv.includes("จบแล้ว")');
    await evaluate('changeReportStatus("")');
    await until(() => evaluate('reportCache.status === ""'));

    // เลือกปีงบแล้วต้องมีเลขของงวดก่อนมาวางเทียบให้ ไม่ใช่เห็นแต่งวดที่เลือก
    await evaluate('changeReportYear(reportCache.fiscalYears[0])');
    await until(() => evaluate('!!reportCache.prev'));
    await check('Picking a fiscal year brings the previous period along to compare',
      'reportCache.prev.key === "FY" + (parseInt(reportCache.fy.slice(2), 10) - 1)' +
      ' && document.querySelector(".outcome-prev").textContent.includes(reportCache.prev.label)' +
      ' && document.querySelector(".outcome-prev").textContent.includes(reportCache.prev.total + " ราย")');
    /*
      งวดก่อนในข้อมูลตัวอย่างไม่มีใครประเมินเลย ป้ายส่วนต่างจึงต้องไม่ขึ้น
      ไม่ใช่เอาค่าว่างมาลบแล้วโชว์ "+3.5" ซึ่งอ่านเหมือนดีขึ้นจากศูนย์
    */
    await check('No delta badge when the previous period has nothing to compare',
      'reportCache.prev.avgGain === null' +
      ' && document.querySelectorAll(".outcome .fig-chip").length === 0');
    await evaluate('changeReportYear("")');
    await until(() => evaluate('reportCache.fy === ""'));

    await screenshot('report-desktop.png');

    /*
      หน้ารายงานถูกพิมพ์ไปแนบรายงานบ่อยที่สุด จึงตรวจที่ความกว้างของกระดาษจริง
      A4 แนวตั้งหักขอบแล้วเหลือราว 725px ซึ่งต่ำกว่าเบรกพอยต์มือถือ 900px
      ถ้าไม่ตรวจที่ความกว้างนี้จะไม่มีทางเห็นว่ากฎของมือถือติดไปบนกระดาษด้วย
    */
    await send('Emulation.setDeviceMetricsOverride', { width: 725, height: 1000, deviceScaleFactor: 1, mobile: false });
    await send('Emulation.setEmulatedMedia', { media: 'print' });
    await evaluate('new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))');
    await check('Printing the report fits the page and drops what cannot be clicked on paper',
      'document.documentElement.scrollWidth <= innerWidth' +
      ' && document.querySelector(".rep-filters").offsetParent === null' +
      ' && document.querySelector(".rep-actions").offsetParent === null' +
      ' && document.querySelector(".outcome").offsetParent !== null' +
      ' && document.querySelector(".page-head .sub").textContent.includes("ทุกพื้นที่")');
    /*
      บนกระดาษตารางต้องเป็นตารางจริง ไม่ใช่การ์ดเรียงลงมาทีละคนแบบบนมือถือ
      ซึ่งกินห้าบรรทัดต่อผู้ป่วยหนึ่งราย และเคยทำให้เอกสารบานเป็นหกแผ่น
    */
    /*
      หัวกระดาษของหน่วยงานต้องโผล่เฉพาะบนกระดาษ ไม่ใช่บนจอ
      และต้องมีชื่อหน่วยงานกับวันที่จริง ไม่ใช่ช่องว่างที่ลืมเติม
    */
    await check('The letterhead appears on paper with the real unit name and date',
      'document.querySelector(".letterhead").offsetParent !== null' +
      ' && document.querySelector(".print-foot").offsetParent !== null' +
      ' && document.getElementById("lh-place").textContent === BOOT.orgPlace' +
      ' && document.getElementById("lh-unit").textContent === BOOT.orgUnit' +
      ' && /25\\d\\d/.test(document.getElementById("lh-date").textContent)' +
      ' && /25\\d\\d/.test(document.getElementById("pf-date").textContent)');
    await check('Paper is not a phone: tables stay tables',
      'getComputedStyle(document.querySelector("table.rep-progress")).display === "table"' +
      ' && getComputedStyle(document.querySelector("table.rep-progress tbody tr")).display === "table-row"' +
      ' && getComputedStyle(document.querySelector("table.rep-progress thead")).display === "table-header-group"');
    await send('Emulation.setEmulatedMedia', { media: '' });
    await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1080, deviceScaleFactor: 1, mobile: false });

    /*
      สั่งพิมพ์จริงแล้วอ่านจากไฟล์ที่ได้ ไม่ใช่เดาจากความสูงบนจอ
      preferCSSPageSize ให้ @page ในไฟล์เป็นตัวกำหนดขนาดและแนวกระดาษ

      หมายเหตุ: หัว-ท้ายที่เบราว์เซอร์วาดเอง (วันที่ ชื่อเอกสาร ลิงก์ เลขหน้า)
      ตรวจจากไฟล์นี้ไม่ได้ เพราะ headless ไม่วาดให้ไม่ว่าจะสั่งอย่างไร
      สิ่งที่คุมได้จากฝั่งเราคือชื่อเอกสาร ซึ่งเป็นทั้งข้อความบนหัวกระดาษ
      และชื่อไฟล์ตอนกดบันทึก จึงตรวจตรงนั้นแทน
    */
    const pdf = Buffer.from((await send('Page.printToPDF', {
      printBackground: true, preferCSSPageSize: true
    })).data, 'base64').toString('latin1');
    const sheets = (pdf.match(/\/Type\s*\/Page[^s]/g) || []).length;
    const paper = pdf.match(/\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)/);
    assert.ok(Number(paper[2]) > Number(paper[1]), 'กระดาษต้องเป็นแนวตั้ง ได้ ' + paper[1] + 'x' + paper[2]);
    assert.ok(sheets > 0 && sheets <= 3, 'ข้อมูลตัวอย่างหกรายต้องพิมพ์ไม่เกินสามแผ่น ได้ ' + sheets);
    checks += 2;
    console.log('PASS The report prints portrait on ' + sheets + ' A4 sheet(s)');

    /*
      เลขหน้าเขียนเองใน @bottom-center ของ @page ไม่ได้พึ่งท้ายกระดาษของเบราว์เซอร์
      ซึ่งพ่วงพาธ file:/// มาด้วยและย้ายที่ไม่ได้

      พิสูจน์ด้วยการพิมพ์สองรอบเทียบกัน รอบที่สองปิดกฎด้วย content:none
      ถ้าเลขหน้าถูกวาดจริง รอบที่เปิดต้องมีก้อนข้อความมากกว่า
      ตัวหนังสือในไฟล์ PDF ถูกเข้ารหัสเป็นรหัสตัวอักษร อ่านออกมาเทียบตรง ๆ ไม่ได้
      จึงนับจำนวนก้อนแทน
    */
    const textRuns = (raw) => {
      let n = 0;
      const re = new RegExp('stream\\r?\\n', 'g');
      let at;
      while ((at = re.exec(raw)) !== null) {
        const from = at.index + at[0].length;
        const to = raw.indexOf('endstream', from);
        if (to < 0) continue;
        try {
          n += (zlib.inflateSync(Buffer.from(raw.slice(from, to), 'latin1')).toString('latin1')
            .match(/T[jJ]/g) || []).length;
        } catch (e) { /* ไม่ใช่สตรีมบีบอัด */ }
      }
      return n;
    };
    await evaluate('(() => { const s = document.createElement("style"); s.id = "no-page-number";' +
      ' s.textContent = "@media print { @page { @bottom-center { content: none } } }";' +
      ' document.head.appendChild(s); })()');
    const without = textRuns(Buffer.from((await send('Page.printToPDF', {
      printBackground: true, preferCSSPageSize: true
    })).data, 'base64').toString('latin1'));
    await evaluate('document.getElementById("no-page-number").remove()');
    assert.ok(textRuns(pdf) > without,
      'เลขหน้าใน @bottom-center ต้องถูกวาดลงกระดาษจริง ได้ ' + textRuns(pdf) + ' เทียบกับ ' + without);
    checks++;
    console.log('PASS Every sheet carries our own page number');

    /*
      ชื่อเอกสารคือชื่อไฟล์ที่ได้ตอนกด "บันทึกเป็น PDF"
      ต้องบอกได้ว่าเป็นเอกสารอะไรของใครวันไหน และต้องไม่มีอักขระที่ตั้งชื่อไฟล์ไม่ได้
      โดยเฉพาะขีดทับใน "รายงาน / BI" ซึ่งเป็นชื่อหน้าจริงบนหน้าจอ
    */
    await check('The saved file is named after the document, not index.html',
      'document.title.indexOf("รายงาน") === 0' +
      ' && document.title.includes(BOOT.orgPlace)' +
      ' && /25\\d\\d/.test(document.title)' +
      ' && !/[\\\\/:*?"<>|]/.test(document.title)');

    await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await check('Mobile layout has no horizontal page overflow', 'document.documentElement.scrollWidth <= innerWidth');
    await screenshot('dashboard-areas-mobile.png');
    await evaluate('go("report")');
    await until(() => evaluate('!!reportCache'));
    // ตรวจเชิงความหมาย ไม่นับจำนวน จำนวนแท่งเปลี่ยนได้ตามข้อมูลตัวอย่าง
    await check('Report bars shade only the two panels that have a severity order',
      '[...document.querySelectorAll(".hbar-fill")].length > 8' +
      ' && [...document.querySelectorAll(".hbar-fill")].every(b =>' +
      '   /sev-/.test(b.className) === /คะแนน BI ล่าสุด|กลุ่ม ADL/.test(b.closest(".panel").textContent))');
    await check('A zero row draws no bar at all',
      '[...document.querySelectorAll(".hbar-track")].some(t => !t.firstElementChild)' +
      ' && ![...document.querySelectorAll(".hbar-fill")].some(b => b.style.width === "0%")');
    // กดแท่งยอดศูนย์แล้วได้กล่องรายชื่อเปล่า จึงต้องไม่เป็นปุ่มตั้งแต่แรก
    await check('A zero row is not clickable',
      '[...document.querySelectorAll(".hbar-row")].every(r =>' +
      ' r.classList.contains("hbar-zero") === (r.tagName === "DIV" && !r.onclick))' +
      ' && document.querySelectorAll(".hbar-zero").length > 0');
    await screenshot('report-bars-mobile.png');   // จุดนี้อยู่หลังสลับเป็นจอมือถือแล้ว

    await evaluate('go("detail", "TEST001")');
    await until(() => evaluate('!!detailCache["TEST001"]'));
    await check('Saved records offer an edit button', 'document.querySelectorAll(".row-edit").length >= 2');

    await evaluate('go("bi", { hn: "TEST001", id: "TEST001-BI2" })');
    await check('Editing an assessment carries the id, seq and every saved score',
      'document.querySelector("[name=assess_id]").value === "TEST001-BI2"' +
      ' && document.querySelector("[name=seq]").value === "2"' +
      ' && document.querySelectorAll("#bi-form input[type=radio]:checked").length === BOOT.biItems.length');
    await evaluate('window.__biBefore = detailCache["TEST001"].assessments.length');
    await submitAndDismiss('bi-form');
    await until(() => evaluate('VIEW.name === "detail" && !!detailCache["TEST001"]'));
    await check('Saving an edit replaces the record instead of adding one',
      'detailCache["TEST001"].assessments.length === window.__biBefore' +
      ' && detailCache["TEST001"].assessments.filter(a => String(a.assess_id) === "TEST001-BI2").length === 1' +
      ' && detailCache["TEST001"].assessments.filter(a => Number(a.seq) === 2).length === 1');

    await evaluate('go("fu", { hn: "TEST001", id: "TEST001-FU1" })');
    await check('Editing a follow-up prefills what was saved and hides the continue option',
      'document.querySelector("[name=fu_id]").value === "TEST001-FU1"' +
      ' && document.querySelector("[name=fu_date]").value === "2025-12-09"' +
      ' && document.querySelector("[name=fu_type]").value === "PT"' +
      ' && !document.getElementById("fu-then-bi")');
    await evaluate('window.__fuBefore = detailCache["TEST001"].followups.length;' +
      'document.querySelector("#fu-form [name=note]").value = "แก้ไขแล้ว"');
    await submitAndDismiss('fu-form');
    await until(() => evaluate('VIEW.name === "detail" && !!detailCache["TEST001"]'));
    await check('Saving a follow-up edit keeps one row and stores the change',
      'detailCache["TEST001"].followups.length === window.__fuBefore' +
      ' && detailCache["TEST001"].followups.filter(f => String(f.fu_id) === "TEST001-FU1")[0].note === "แก้ไขแล้ว"');

    await evaluate('go("fu", "TEST001")');
    await check('A new follow-up offers to continue to the assessment',
      '!document.querySelector("[name=fu_id]") && !!document.getElementById("fu-then-bi")');
    await evaluate('document.getElementById("fu-then-bi").checked = true;' +
      'document.querySelector("[name=fu_date]").value = "2026-03-04";' +
      'document.querySelector("[name=fu_type]").value = "PT"');
    await submitAndDismiss('fu-form');
    await until(() => evaluate('VIEW.name === "bi"'));
    await check('Continuing to the assessment carries the visit date over',
      'document.querySelector("[name=assess_date]").value === "2026-03-04"' +
      ' && !document.querySelector("[name=assess_id]")');

    await evaluate('go("patient", "TEST001")');
    await check('Patient form restores province and dependent district/tambon selects', 'document.querySelector("[name=district]").tagName === "SELECT" && document.querySelector("[name=district]").value === "เมืองกระบี่" && document.querySelector("[name=tambon]").value === "ปากน้ำ"');
    await evaluate('var d = document.querySelector("[name=district]"); d.value = "เหนือคลอง"; d.dispatchEvent(new Event("change"))');
    await check('Changing district clears incompatible tambon', 'document.querySelector("[name=tambon]").value === "" && !document.querySelector("[name=tambon]").textContent.includes("อ่าวนาง")');
    await evaluate('var t = document.querySelector("[name=tambon]"); t.value = "เหนือคลอง"; var f = readForm(document.getElementById("patient-form")); API.apiSavePatient(f); dropCache_(f.hn); go("dashboard")');
    await evaluate('changeArea("scope", "krabi");');
    await evaluate('changeArea("district", "เหนือคลอง")');
    await check('Saved address moves patient to the new district', 'dashboardPatients().some(p => p.hn === "TEST001") && dashCache.total === 2');
    await evaluate('go("patient", "TEST006")');
    await check('Opening a legacy address does not erase its tambon', 'document.querySelector("[name=tambon]").value === "ปากน้ำ" && document.querySelector("[name=province]").value === ""');
    await evaluate('go("patient", "TEST005")');
    await check('Outside-province form supports free-text districts', 'document.querySelector("[name=district]").tagName === "INPUT" && document.querySelector("[name=district]").value === "เมืองตรัง"');
    await evaluate('go("dashboard")');
    await evaluate('var normalDash = API.apiDashboard; API.apiDashboard = function() { throw new Error("simulated failure") }; dashCache = null; renderDashboard()');
    await check('Failed request exposes a retry action', 'main().textContent.includes("โหลดข้อมูลพื้นที่ไม่สำเร็จ") && main().textContent.includes("ลองใหม่")');
    await evaluate('API.apiDashboard = normalDash; renderDashboard()');
    await check('Retry recovers selected area', 'dashCache.total === 2 && dashFilter.district === "เหนือคลอง"');
    await evaluate('(async function() { var realCall = call; var requests = []; call = function() { return new Promise(resolve => requests.push(resolve)); }; var first = changeArea("scope","krabi"); var second = changeArea("district","เมืองกระบี่"); requests[1](API.apiDashboard({scope:"krabi",district:"เมืองกระบี่"})); await second; requests[0](API.apiDashboard({scope:"krabi"})); await first; call = realCall; })()');
    await check('Late response cannot overwrite newer area selection', 'dashFilter.district === "เมืองกระบี่" && dashCache.total === 2');
    await evaluate('(async function() { var realCall = call; var resolveLate; call = function() { return new Promise(resolve => resolveLate = resolve); }; var pendingDash = changeArea("scope","all"); go("patient"); resolveLate(API.apiDashboard()); await pendingDash; call = realCall; })()');
    await check('Late dashboard response cannot replace another screen', 'VIEW.name === "patient" && !!document.getElementById("patient-form")');
    assert.equal(exceptions.length, 0, JSON.stringify(exceptions));
    console.log(`\n${checks} browser checks passed; screenshots saved in preview/`);
  } finally {
    for (const p of pending.values()) clearTimeout(p.timer);
    if (ws) ws.close();
    chrome.kill();
  }
})().catch(e => { console.error(e); process.exitCode = 1; });
