// Optional real-browser checks, no npm dependencies. Requires Node 22+ and Chrome.
// node tests/test-area-browser.js "path/to/chrome.exe"
// Build preview first. All data and screenshots remain under ignored preview/.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { spawn } = require('node:child_process');
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
    await screenshot('dashboard-areas-desktop.png');
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
