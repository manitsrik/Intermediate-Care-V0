/**
 * จุดเข้าเว็บแอป
 * เผยแพร่ผ่าน Deploy > New deployment > Web app
 */

function doGet() {
  return HtmlService.createTemplateFromFile('index')
    .evaluate()
    .setTitle(CONFIG.APP_NAME)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover');
}

/** ใช้ใน index.html เพื่อรวมไฟล์ css และ js เข้าเป็นหน้าเดียว */
function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}
