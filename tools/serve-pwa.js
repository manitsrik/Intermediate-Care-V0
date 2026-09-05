/**
 * เปิดเซิร์ฟเวอร์เล็ก ๆ ให้ทดลองเปลือก PWA บนเครื่องก่อน push ขึ้น GitHub Pages
 *
 *   node tools/serve-pwa.js     แล้วเปิด http://localhost:8080 ใน Chrome
 *
 * ต้องเปิดผ่าน localhost เท่านั้น เปิดไฟล์ตรง ๆ ด้วย file:// ไม่ได้
 * เพราะ service worker ทำงานเฉพาะบน https กับ localhost
 *
 * ข้อจำกัด: ทดสอบจากมือถือในวงแลนเดียวกันไม่ได้ เพราะเลข IP ในวงแลนไม่ใช่ https
 * เบราว์เซอร์จะไม่ยอมลงทะเบียน service worker ให้ ต้อง push ขึ้น Pages ก่อน
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', 'pwa');
const PORT = Number(process.argv[2]) || 8080;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png'
};

const server = http.createServer(function (req, res) {
  let rel = decodeURIComponent(req.url.split('?')[0]);
  if (rel.endsWith('/')) rel += 'index.html';

  // กันไม่ให้ขอไฟล์นอกโฟลเดอร์ pwa ด้วยการใส่ ../ มาในลิงก์
  const file = path.join(ROOT, path.normalize(rel));
  if (!file.startsWith(ROOT)) {
    res.writeHead(403).end('403');
    return;
  }

  fs.readFile(file, function (err, buf) {
    if (err) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('ไม่มีไฟล์ ' + rel);
      return;
    }
    res.writeHead(200, {
      'content-type': TYPES[path.extname(file)] || 'application/octet-stream',
      'cache-control': 'no-store'          // แก้ไฟล์แล้วโหลดใหม่ต้องเห็นทันที
    }).end(buf);
  });
});

server.listen(PORT, function () {
  console.log('เปิดที่ http://localhost:' + PORT + ' แล้ว กด Ctrl+C เพื่อหยุด');
  console.log('ใน Chrome เปิด DevTools > Application > Manifest เพื่อดูว่าติดตั้งได้ไหม');
});
