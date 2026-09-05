/**
 * จุดเข้าเว็บแอป
 * เผยแพร่ผ่าน Deploy > New deployment > Web app
 */

function doGet() {
  return HtmlService.createTemplateFromFile('index')
    .evaluate()
    .setTitle(CONFIG.APP_NAME + ' · ' + CONFIG.ORG)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover')
    // สอง meta นี้ทำให้ iOS ที่กด "เพิ่มไปยังหน้าจอโฮม" เปิดแอปแบบเต็มจอ
    // ไม่มีแถบที่อยู่เว็บของ Safari คร่อมอยู่ ทำให้ดูเหมือนแอปที่ติดตั้งไว้
    // Apps Script ยอมให้ใส่ meta ได้แค่ 4 ตัว สองตัวนี้อยู่ในนั้น
    // ส่วน manifest กับ service worker ใส่ไม่ได้ เพราะหน้าจอจริงถูกฝังใน iframe
    // คนละโดเมนกับหน้าบนสุด เบราว์เซอร์จึงไม่อ่านให้
    .addMetaTag('apple-mobile-web-app-capable', 'yes')
    .addMetaTag('mobile-web-app-capable', 'yes');
}

/** ใช้ใน index.html เพื่อรวมไฟล์ css และ js เข้าเป็นหน้าเดียว */
function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}
