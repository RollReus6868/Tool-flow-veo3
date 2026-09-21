// ============================================================================
//  text-utils.js — chuẩn hoá chữ và tên file
// ============================================================================

// ─── Bỏ dấu tiếng Việt ───
// Giữ nguyên bảng của bản tiện ích 1.10.0 để tên file sinh ra giống hệt.
const VI_ACCENT_MAP = {
  'à':'a','á':'a','ạ':'a','ả':'a','ã':'a','â':'a','ầ':'a','ấ':'a','ậ':'a','ẩ':'a','ẫ':'a',
  'ă':'a','ằ':'a','ắ':'a','ặ':'a','ẳ':'a','ẵ':'a',
  'è':'e','é':'e','ẹ':'e','ẻ':'e','ẽ':'e','ê':'e','ề':'e','ế':'e','ệ':'e','ể':'e','ễ':'e',
  'ì':'i','í':'i','ị':'i','ỉ':'i','ĩ':'i',
  'ò':'o','ó':'o','ọ':'o','ỏ':'o','õ':'o','ô':'o','ồ':'o','ố':'o','ộ':'o','ổ':'o','ỗ':'o',
  'ơ':'o','ờ':'o','ớ':'o','ợ':'o','ở':'o','ỡ':'o',
  'ù':'u','ú':'u','ụ':'u','ủ':'u','ũ':'u','ư':'u','ừ':'u','ứ':'u','ự':'u','ử':'u','ữ':'u',
  'ỳ':'y','ý':'y','ỵ':'y','ỷ':'y','ỹ':'y',
  'đ':'d'
};

function deaccentVi(input) {
  let s = String(input || '').replace(/[À-ỹ]/g, (ch) => {
    const lower = ch.toLowerCase();
    const mapped = VI_ACCENT_MAP[lower];
    if (!mapped) return ch;
    return ch === lower ? mapped : mapped.toUpperCase();
  });
  try { s = s.normalize('NFD').replace(/[̀-ͯ]/g, ''); } catch (_) {}
  return s;
}

/**
 * Chuẩn hoá để SO SÁNH độ dài chữ đã vào editor.
 *
 * Editor của Flow gộp khoảng trắng và đổi xuống dòng thành thẻ đoạn, nên so
 * thẳng chuỗi gốc với innerText sẽ lệch dù chữ vào đủ. Ta gộp mọi khoảng trắng
 * liên tiếp thành một dấu cách trước khi đếm — chênh lệch còn lại mới là chữ
 * thật sự bị mất.
 */
function normalizeForCompare(text) {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

/**
 * Tách phần mở rộng khỏi tên file.
 */
function splitExtension(filename) {
  const base = String(filename || '').split(/[\\/]/).pop();
  const m = base.match(/^(.*)\.([A-Za-z0-9]{1,8})$/);
  return m ? { stem: m[1], ext: m[2] } : { stem: base, ext: '' };
}

/**
 * Làm sạch một thành phần tên file cho Windows.
 *
 * Windows cấm  \ / : * ? " < > |  và không cho tên trùng thiết bị (CON, PRN,
 * AUX, NUL, COM1-9, LPT1-9). Ngoài ra Chrome ÂM THẦM bỏ qua tên file ngoài
 * ASCII — nên luôn bỏ dấu, đây là lỗi thật đã gặp ở bản 1.6.1.
 */
const WIN_RESERVED = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i;

function sanitizeDownloadPath(name) {
  // Giữ lại dấu / để còn xếp thư mục con, làm sạch từng đoạn một.
  const parts = String(name || '').split('/').filter(Boolean);
  const clean = parts.map((part) => {
    let p = deaccentVi(part)
      .replace(/[\\:*?"<>|]/g, '_')       // ký tự Windows cấm
      .replace(/[\x00-\x1f\x7f]/g, '')    // ký tự điều khiển
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/^\.+/, '')                // không cho tên bắt đầu bằng dấu chấm
      .replace(/[. ]+$/, '');             // Windows tự cắt đuôi chấm/cách -> cắt sẵn
    if (WIN_RESERVED.test(p)) p = '_' + p;
    return p;
  }).filter(Boolean);

  return clean.join('/') || 'flow_download';
}

/**
 * Xử lý ô "Thư mục con" trong Cài đặt, hỗ trợ các thẻ thay thế.
 *   {date}     -> 2026-09-18
 *   {time}     -> 14-30
 *   {datetime} -> 2026-09-18_14-30
 */
function sanitizeSubfolder(raw, settings = {}) {
  let s = String(raw || '').trim();
  if (!s) return '';

  const now = new Date();
  const p2 = (n) => String(n).padStart(2, '0');
  const date = `${now.getFullYear()}-${p2(now.getMonth() + 1)}-${p2(now.getDate())}`;
  const time = `${p2(now.getHours())}-${p2(now.getMinutes())}`;

  s = s
    .replace(/\{datetime\}/gi, `${date}_${time}`)
    .replace(/\{date\}/gi, date)
    .replace(/\{time\}/gi, time)
    .replace(/\{project\}/gi, settings.projectName || 'Flow');

  s = s.replace(/\\/g, '/').replace(/\.\.+/g, '');   // chặn thoát lên thư mục cha
  const cleaned = sanitizeDownloadPath(s);
  return cleaned.slice(0, 120).replace(/\/+$/, '');
}

module.exports = {
  deaccentVi,
  normalizeForCompare,
  splitExtension,
  sanitizeDownloadPath,
  sanitizeSubfolder
};
