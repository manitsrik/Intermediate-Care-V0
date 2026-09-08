/**
 * เปิดเซิร์ฟเวอร์เล็ก ๆ ให้ดูหน้าพรีวิวผ่าน localhost แทนการเปิดไฟล์ตรง ๆ
 *
 *   node tools/build-preview.js     ประกอบไฟล์ก่อน
 *   node tools/serve-preview.js     แล้วเปิด http://localhost:8081
 *
 * เปิดด้วย file:// ก็ดูได้ครบทุกอย่างอยู่แล้ว รวมถึงของที่เก็บลง localStorage
 * ตัวนี้มีไว้เพื่อกรณีเดียวคืออยากเปิดดูจากมือถือหรือแท็บเล็ตในวงแลนเดียวกัน
 * ซึ่ง file:// ทำไม่ได้ จึงพิมพ์เลข IP ในวงแลนออกมาให้ไปพิมพ์บนเครื่องนั้นด้วย
 *
 * ข้อจำกัด: เป็นการพรีวิวหน้าจอเท่านั้น ข้อมูลเป็นของปลอมในหน่วยความจำของเบราว์เซอร์
 * ปิดแท็บแล้วหายไป ไม่ได้คุยกับ Google Sheet และไม่ได้ทดสอบโค้ดฝั่งเซิร์ฟเวอร์
 * ต่างจาก tools/serve-pwa.js ที่ต้องใช้ localhost จริง ๆ เพราะ service worker
 */

const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..', 'preview');
const PORT = Number(process.argv[2]) || 8081;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.pdf': 'application/pdf'
};

if (!fs.existsSync(path.join(ROOT, 'index.html'))) {
  console.error('ยังไม่มี preview/index.html ให้รัน node tools/build-preview.js ก่อน');
  process.exit(1);
}

/** เลข IP ในวงแลน เครื่องเดียวมีได้หลายวง เช่นเสียบสายไว้ด้วยและต่อไวไฟด้วย */
function lanAddresses() {
  const nets = os.networkInterfaces();
  const out = [];
  Object.keys(nets).forEach(function (name) {
    (nets[name] || []).forEach(function (net) {
      if (net.family === 'IPv4' && !net.internal) out.push(net.address);
    });
  });
  return out;
}

const server = http.createServer(function (req, res) {
  let rel = decodeURIComponent(req.url.split('?')[0]);
  if (rel.endsWith('/')) rel += 'index.html';

  // กันไม่ให้ขอไฟล์นอกโฟลเดอร์ preview ด้วยการใส่ ../ มาในลิงก์
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
      'cache-control': 'no-store'          // ประกอบพรีวิวใหม่แล้วรีเฟรชต้องเห็นของใหม่ทันที
    }).end(buf);
  });
});

/* พอร์ตชนกันเป็นเรื่องปกติเวลาลืมปิดหน้าต่างเดิม บอกทางออกไปเลยดีกว่าโยน stack ใส่ */
server.on('error', function (e) {
  if (e.code === 'EADDRINUSE') {
    console.error('พอร์ต ' + PORT + ' มีคนใช้อยู่ ลองสั่ง node tools/serve-preview.js ' + (PORT + 1));
    process.exit(1);
  }
  throw e;
});

server.listen(PORT, function () {
  console.log('เปิดที่ http://localhost:' + PORT + ' แล้ว กด Ctrl+C เพื่อหยุด');
  lanAddresses().forEach(function (ip) {
    console.log('จากมือถือในวงแลนเดียวกัน http://' + ip + ':' + PORT);
  });
  console.log('พรีวิวบนเครื่อง: ข้อมูลทั้งหมดเป็นของปลอมและไม่ถูกบันทึกที่ไหน');
});
