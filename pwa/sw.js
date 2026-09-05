/*
  ตัวช่วยให้ไอคอนบนหน้าจอโฮมเปิดขึ้นได้แม้ไม่มีเน็ต

  เก็บไว้แค่หน้าเปิดแอปกับไอคอน ไม่เก็บข้อมูลผู้ป่วยแม้แต่แถวเดียว
  ตัวระบบจริงอยู่บน script.google.com ซึ่งอยู่คนละโดเมนกับไฟล์ชุดนี้
  service worker จึงมองไม่เห็นและแตะข้อมูลคนไข้ไม่ได้ตั้งแต่ต้น

  แก้ไฟล์ในโฟลเดอร์นี้เมื่อไร ต้องขยับเลข CACHE ด้วย ไม่งั้นเครื่องที่ติดตั้งไว้แล้ว
  จะยังเปิดของเก่าค้างอยู่
*/

var CACHE = 'imc-shell-v1';

var SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png',
  './icon-maskable-512.png'
];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(SHELL); }));
  self.skipWaiting();
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys()
      .then(function (keys) {
        return Promise.all(keys.map(function (k) {
          return k === CACHE ? null : caches.delete(k);
        }));
      })
      .then(function () { return self.clients.claim(); })
  );
});

/*
  เอาของใหม่จากเน็ตก่อนเสมอ แล้วค่อยตกลงมาใช้ของที่เก็บไว้ตอนต่อเน็ตไม่ได้
  ถ้าทำกลับกันคือหยิบของเก่าก่อน เวลาแก้หน้าเปิดแอปแล้วเครื่องที่ติดตั้งไว้จะไม่รู้เรื่อง
*/
self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  if (new URL(req.url).origin !== self.location.origin) return;

  e.respondWith(
    fetch(req)
      .then(function (res) {
        var copy = res.clone();
        caches.open(CACHE).then(function (c) { c.put(req, copy); });
        return res;
      })
      .catch(function () {
        return caches.match(req).then(function (hit) {
          if (hit) return hit;
          // เปิดแอปตอนออฟไลน์ ให้ได้หน้าเปิดแอปเสมอ จะได้ไม่เจอจอไดโนเสาร์ของ Chrome
          return req.mode === 'navigate' ? caches.match('./index.html') : Response.error();
        });
      })
  );
});
