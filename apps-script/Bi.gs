/**
 * ตรรกะของแบบประเมิน Barthel Index
 *
 * เกณฑ์ตามแบบฟอร์มของกลุ่มงานเวชกรรมฟื้นฟู รพ.กระบี่
 *   เข้าโปรแกรม IMC เมื่อ BI < 15 หรือ BI >= 15 ที่มี multiple impairment
 *   จัดกลุ่ม CTF: ติดสังคม ADL >= 12 / ติดบ้าน 5-11 / ติดเตียง 0-4
 */

/** รวมคะแนน 10 ข้อ พร้อมตรวจว่าคะแนนแต่ละข้อไม่เกินเพดาน */
function scoreBi_(scores) {
  var total = 0;
  var missing = [];
  BI_ITEMS.forEach(function (item) {
    var v = scores[item.key];
    if (v === '' || v === null || v === undefined) {
      missing.push(item.no + '. ' + item.en);
      return;
    }
    var n = parseInt(v, 10);
    var max = item.options.length - 1;
    if (isNaN(n) || n < 0 || n > max) {
      throw new Error('คะแนนข้อ ' + item.no + ' (' + item.en + ') ต้องอยู่ระหว่าง 0 ถึง ' + max);
    }
    total += n;
  });
  if (missing.length) {
    throw new Error('ยังประเมินไม่ครบ ขาดข้อ: ' + missing.join(', '));
  }
  return total;
}

/** ติดสังคม / ติดบ้าน / ติดเตียง */
function ctfGroup_(total) {
  if (total >= 12) return 'ติดสังคม';
  if (total >= 5) return 'ติดบ้าน';
  return 'ติดเตียง';
}

/**
 * เข้าเกณฑ์ IMC หรือไม่
 * multipleImpairment เป็นดุลพินิจของผู้ประเมิน ระบบไม่เดาให้
 */
function isImcEligible_(total, multipleImpairment) {
  if (total < 15) return true;
  return !!multipleImpairment;
}

/** สรุปผลการประเมินหนึ่งครั้ง ใช้ทั้งตอนบันทึกและตอนคิดสดบนหน้าจอ */
function evaluateBi_(scores, multipleImpairment) {
  var total = scoreBi_(scores);
  return {
    total: total,
    max: BI_MAX,
    ctf_group: ctfGroup_(total),
    imc_eligible: isImcEligible_(total, multipleImpairment),
    screening_result: isImcEligible_(total, multipleImpairment) ? 'IMC' : 'NoIMC'
  };
}
