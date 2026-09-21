// ============================================================================
//  jobs.js — DỰNG DỮ LIỆU GỬI CHO ENGINE
//  --------------------------------------------------------------------------
//  Tách riêng ra khỏi main.js vì đây là chỗ đã sai một lần và sai thì KHÔNG
//  có gì báo: engine nhận thiếu trường thì lặng lẽ ghi "No prompts to process!"
//  rồi dừng, nhìn từ ngoài y như bấm Bắt đầu mà không có gì xảy ra.
//  Ở dạng hàm thuần thế này thì kiểm thử được bằng node, chạy trong một giây.
//
//  HỢP ĐỒNG DỮ LIỆU — handleStart(data) trong flow-engine.js đọc đúng ba trường:
//
//    data.prompts         mảng CHUỖI, giữ NGUYÊN danh sách ĐẦY ĐỦ (tuyệt đối
//                         không cắt theo tab). Engine tra prompts[index - 1]
//                         theo số thứ tự TOÀN CỤC, nên cắt là lệch hết tên file.
//    data.videosToCreate  mảng OBJECT { index, text } — phần việc RIÊNG của một
//                         tab. index đếm từ 1 và là số thứ tự toàn cục.
//    data.settings        object cài đặt.
// ============================================================================

/**
 * Biến danh sách prompt thành danh sách việc, đánh số từ 1.
 */
function buildJobs(prompts) {
  return (prompts || []).map((text, i) => ({ index: i + 1, text }));
}

/**
 * Chia việc cho n tab theo KHỐI LIÊN TIẾP, phần dư dồn cho các tab đầu.
 *
 * Cố ý không chia bài xen kẽ: chia liên tiếp thì mỗi tab xử lý một dải số thứ
 * tự liền mạch, tên file sinh ra nhóm lại theo tab thay vì nhảy cóc. Đây cũng
 * đúng cách bản tiện ích 1.10.0 làm.
 */
function splitJobs(jobs, n) {
  const out = [];
  if (!jobs || !jobs.length) return out;

  const count = Math.max(1, Math.min(n, jobs.length));
  const per = Math.floor(jobs.length / count);
  const du = jobs.length % count;

  let pos = 0;
  for (let i = 0; i < count; i++) {
    const size = per + (i < du ? 1 : 0);
    out.push(jobs.slice(pos, pos + size));
    pos += size;
  }
  return out;
}

/**
 * Dựng trọn gói message START_AUTOMATION cho MỘT tab.
 *
 * @param {string[]} prompts  TOÀN BỘ danh sách prompt, không cắt
 * @param {Array<{index:number,text:string}>} part  phần việc của tab này
 * @param {object} settings
 */
function buildStartMessage(prompts, part, settings) {
  return {
    action: 'START_AUTOMATION',
    data: {
      prompts: prompts || [],
      videosToCreate: part || [],
      settings: settings || {}
    }
  };
}

/**
 * Lập kế hoạch chạy cho nhiều tài khoản, mỗi tài khoản nhiều tab.
 *
 * Hai kiểu chia, khác nhau ở chỗ ranh giới nằm đâu:
 *
 *   'split'   — coi mọi tab như một dàn máy chung, chia liên tiếp cho tất cả.
 *               Xong sớm nhất, nhưng một prompt rơi vào tài khoản nào là
 *               chuyện hên xui.
 *
 *   'account' — chia cho TỪNG TÀI KHOẢN trước, rồi mới chia phần của mỗi tài
 *               khoản cho các tab của chính nó. Mỗi tài khoản ôm một dải số
 *               thứ tự liền mạch và chạy độc lập — hợp khi muốn tách hạn mức
 *               hoặc tách kết quả theo tài khoản.
 *
 * @param {string[]} prompts
 * @param {Array<{id:string, accountId:string}>} tabs  các tab sẽ chạy
 * @param {'split'|'account'} mode
 * @returns {Array<{tabId, accountId, part}>}  chỉ gồm tab thật sự có việc
 */
function planRun(prompts, tabs, mode = 'split') {
  return planRunJobs(buildJobs(prompts), tabs, mode);
}

/**
 * Như planRun nhưng nhận thẳng danh sách VIỆC đã dựng sẵn.
 *
 * Tách ra vì khi người dùng chỉ chạy một dải (ví dụ prompt 50–100), ta phải
 * LỌC TRƯỚC rồi mới chia. Chia trước rồi lọc thì tab nào rơi vào vùng bị bỏ
 * sẽ nhận phần rỗng trong khi tab khác ôm hết việc.
 */
function planRunJobs(jobs, tabs, mode = 'split') {
  const ketQua = [];
  if (!jobs.length || !tabs.length) return ketQua;

  if (mode !== 'account') {
    const parts = splitJobs(jobs, tabs.length);
    parts.forEach((part, i) => {
      if (part.length) ketQua.push({ tabId: tabs[i].id, accountId: tabs[i].accountId, part });
    });
    return ketQua;
  }

  // ── Chia theo tài khoản ──────────────────────────────────────────────
  // Giữ nguyên thứ tự tài khoản xuất hiện, để lần chạy nào cũng cho ra cùng
  // một cách chia với cùng đầu vào — dễ đối chiếu khi có sự cố.
  const thuTu = [];
  const theoTk = new Map();
  for (const t of tabs) {
    const k = t.accountId || 'khong-ro';
    if (!theoTk.has(k)) { theoTk.set(k, []); thuTu.push(k); }
    theoTk.get(k).push(t);
  }

  const phanTk = splitJobs(jobs, thuTu.length);
  thuTu.forEach((accId, i) => {
    const phan = phanTk[i];
    if (!phan || !phan.length) return;
    const tabsCuaTk = theoTk.get(accId);
    const parts = splitJobs(phan, tabsCuaTk.length);
    parts.forEach((part, j) => {
      if (part.length) ketQua.push({ tabId: tabsCuaTk[j].id, accountId: accId, part });
    });
  });
  return ketQua;
}

/**
 * Danh sách TÊN ảnh để gửi cho CHECK_ASSET_NAMES.
 *
 * handleCheckAssetNames(payload) trong flow-engine.js đọc payload.names và
 * đòi một mảng CHUỖI. Đưa mảng object vào là nó trả "Chưa có tên ảnh nào để
 * kiểm tra" — im lặng đúng kiểu đã từng làm nút Bắt đầu không làm gì.
 */
function buildImageNames(data) {
  const ds = (data && data.files) || [];
  return ds
    .map((f) => (typeof f === 'string' ? f : (f && f.name)))
    .filter((s) => typeof s === 'string' && s.length > 0);
}

// ============================================================================
//  ẢNH → VIDEO
//  --------------------------------------------------------------------------
//  Flow gắn ảnh vào video qua Character Sync: trong câu lệnh có "@mã_ảnh" thì
//  Flow lấy đúng ảnh mang mã đó trong kho ra dùng. Nên sinh prompt video cho
//  một mẻ ảnh thực chất là ghép "<câu lệnh chung> @<mã ảnh>" cho từng ảnh.
// ============================================================================

/**
 * Dựng danh sách mã ảnh từ khoảng số, giống hệt bản tiện ích.
 * Ví dụ: from=1, to=3, pad=2, prefix='anh' -> ['anh01','anh02','anh03']
 */
function buildI2vNames({ from, to, pad = 2, prefix = '', suffix = '' }) {
  const a = parseInt(from, 10);
  const b = parseInt(to, 10);
  const p = Math.min(6, Math.max(1, parseInt(pad, 10) || 2));
  if (!Number.isInteger(a) || !Number.isInteger(b) || b < a) return [];
  if (b - a > 999) return [];        // chặn nhập nhầm kiểu 1..100000

  const pre = String(prefix || '').trim();
  const suf = String(suffix || '').trim();
  const out = [];
  for (let i = a; i <= b; i++) out.push(`${pre}${String(i).padStart(p, '0')}${suf}`);
  return out;
}

/**
 * Mã ảnh phải khớp cú pháp @tag của Character Sync: chỉ chữ, số, gạch dưới.
 * Có dấu cách hay gạch nối là Flow cắt tag giữa chừng và lấy nhầm ảnh.
 */
function invalidI2vNames(names) {
  return (names || []).filter((n) => !/^[\p{L}\p{N}_]+$/u.test(String(n || '')));
}

// ── Tên ảnh Flow SẼ đặt, suy ra từ chính cài đặt đổi tên ────────────────────
//
//  VÌ SAO PHẢI CÓ
//  Nối ảnh→video chạy được hay không nằm ở đúng một chỗ: mã @tag trong câu
//  lệnh video phải TRÙNG KHÍT tên ảnh trong kho Flow. Bản 2.3.0 tự đánh số
//  lấy ("pad = max(2, số chữ số của tổng prompt)") rồi hy vọng trùng — chạy
//  thật thì log ghi "(001 → 002)" trong khi kho Flow hiện "01", "02". Sai một
//  chữ số là Character Sync không tìm thấy ảnh nào.
//
//  Nguồn sự thật duy nhất: renameMediaOnCloud() trong flow-engine.js đặt tên
//  ảnh trên Flow bằng generateFileName(video, String(i+1), tiles.length) —
//  CÙNG một hàm sinh tên file tải về. Nên ở đây ta chép lại đúng hàm đó thay
//  vì đoán. Chép, không gọi: engine chạy trong trang Flow, còn chỗ này chạy
//  ở tiến trình chính trước khi có tab nào.
//
//  Ba nhánh của generateFileName, giữ nguyên thứ tự ưu tiên của nó:
//     index_only   -> "<tiền tố>_<số>_<hậu tố>"   (đây là nhánh nên dùng)
//     custom_list  -> lấy đúng dòng thứ n người dùng nhập
//     default      -> "<số 2 chữ số>_<phần đầu câu lệnh>"
//  Nhiều ảnh cho một prompt (x2, x3, x4) thì mỗi ảnh được thêm "_1", "_2"…
//  Đúng một ảnh thì KHÔNG thêm gì — chính là chỗ sinh ra "01" chứ không phải
//  "01_1".

const VI_ACCENT = {
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

function boDauVi(input) {
  let s = String(input || '').replace(/[À-ỹ]/g, (ch) => {
    const low = ch.toLowerCase();
    const m = VI_ACCENT[low];
    if (!m) return ch;
    return ch === low ? m : m.toUpperCase();
  });
  try { s = s.normalize('NFD').replace(/[̀-ͯ]/g, ''); } catch (_) {}
  return s;
}

/** Bản sao toSafeFileChunk() của engine. */
function catAnToan(text, maxLen, boDau) {
  let raw = String(text || '');
  if (boDau) raw = boDauVi(raw);
  let out = raw
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[^\p{L}\p{N}_-]/gu, '_')
    .replace(/_+/g, '_')
    .replace(/^_+/, '');
  if (maxLen > 0 && out.length > maxLen) out = out.slice(0, maxLen);
  return out.replace(/_+$/, '');
}

/**
 * Tên ảnh Flow sẽ đặt cho một mẻ prompt, theo đúng cài đặt đổi tên hiện hành.
 *
 * @param {object} settings  bộ cài đặt y như gửi cho engine
 * @param {Array<{index:number,text:string}>} jobs  phần việc (đã đánh số)
 * @returns {string[]}  một tên cho MỖI ảnh, đúng thứ tự Flow tạo ra
 */
function tenAnhTheoRename(settings, jobs) {
  const s = settings || {};
  const mode = s.renameMode || 'default';
  const batDau = parseInt(s.renameStartIndex, 10) || 1;
  const boDau = (s.asciiMode || 'file') === 'both';

  let moiPrompt = parseInt(s.outputCount, 10);
  if (!Number.isInteger(moiPrompt) || moiPrompt < 1) moiPrompt = 1;

  const HARD_MAX = 150;
  let maxLen = s.renameMaxLen;
  maxLen = (maxLen === '' || maxLen === undefined || maxLen === null) ? 30 : parseInt(maxLen, 10);
  if (Number.isNaN(maxLen) || maxLen <= 0) maxLen = HARD_MAX;
  if (maxLen > HARD_MAX) maxLen = HARD_MAX;

  let pad = parseInt(s.renameIndexPad, 10);
  if (Number.isNaN(pad) || pad < 1) pad = 2;
  if (pad > 8) pad = 8;

  const tienTo = catAnToan(s.renamePrefix || '', 40, boDau);
  const hauTo  = catAnToan(s.renameSuffix || '', 40, boDau);
  const noi = (a, b) => (a && b) ? `${a}_${b}` : (a || b);

  const dongTuChon = String(s.renameCustomList || '')
    .split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

  const out = [];
  (jobs || []).forEach((job, i) => {
    // engine đọc video.promptIndex, mà promptIndex = item.index của
    // videosToCreate — tức số thứ tự TOÀN CỤC, không phải vị trí trong mẻ.
    // Nhầm chỗ này là tab 2 trở đi đặt tên lệch hẳn một dải.
    const thuTuTrongMe = Number.isInteger(job && job.index) ? job.index : (i + 1);
    const text = String(job && job.text || '');
    // Engine ưu tiên con số Flow đang hiển thị ở đầu câu lệnh ("12) ...").
    const m = text.match(/^(\d+)[\)\.]\s*/);
    const so = m ? parseInt(m[1], 10) : (batDau + thuTuTrongMe - 1);

    let base;
    if (mode === 'index_only') {
      const num = String(so).padStart(pad, '0');
      base = noi(noi(tienTo, num), hauTo) || num;
    } else if (mode === 'custom_list' && dongTuChon[thuTuTrongMe - 1]) {
      base = catAnToan(dongTuChon[thuTuTrongMe - 1], 150, boDau) || `media_${thuTuTrongMe}`;
    } else {
      const than = catAnToan(text.replace(/^(\d+)[\)\.]\s*/, ''), maxLen, boDau)
                || `prompt_${thuTuTrongMe}`;
      base = `${String(so).padStart(2, '0')}_${than}`;
    }

    if (moiPrompt === 1) out.push(base);
    else for (let k = 1; k <= moiPrompt; k++) out.push(`${base}_${k}`);
  });

  return out;
}

/**
 * Bộ cài đặt cho MẺ VIDEO nối tiếp sau một mẻ ảnh.
 *
 *  Chuỗi ảnh→video sinh ra prompt dạng "<câu lệnh> @01" — ĐÚNG MỘT thẻ @, vì
 *  mỗi video dựng từ đúng một ảnh. Ba khoá dưới đây phải được ép, không được
 *  để nguyên như người dùng đặt:
 *
 *  runMode: 'video'   — hiển nhiên.
 *
 *  charSync: true     — đây là thứ khiến Flow lấy đúng ảnh mang mã @01 ra
 *                       dùng. Tắt thì mọi video sinh ra từ chữ, chẳng liên
 *                       quan gì tới mẻ ảnh vừa tạo.
 *
 *  keyframeSync: false — ĐÂY LÀ LỖI ĐÃ LÀM HỎNG NGUYÊN MỘT MẺ 30 PROMPT.
 *                       "Đồng bộ khung hình đầu/cuối" đòi HAI thẻ @ (ảnh đầu
 *                       và ảnh cuối). Prompt của chuỗi chỉ có một, nên engine
 *                       ném lỗi ngay ở bước dán, không prompt nào qua được:
 *
 *                         ❌ Lỗi Khung hình: Bạn cần gắn thẻ 2 ảnh
 *                            (@bắt_đầu @kết_thúc) trong Prompt!
 *
 *                       Hai tính năng này loại trừ nhau về bản chất, nên đây
 *                       không phải "tôn trọng lựa chọn người dùng" — giữ nó
 *                       bật chỉ có nghĩa là mẻ chạy hỏng 100%.
 *
 * @returns {{settings: object, daTat: string[]}} settings đã chuẩn hoá, và
 *          danh sách tên tính năng bị tắt để còn nói cho người dùng biết.
 */
function caiDatChuoiVideo(videoSettings) {
  const s = { ...(videoSettings || {}), runMode: 'video', charSync: true };
  const daTat = [];

  if (s.keyframeSync) {
    daTat.push('Đồng bộ khung hình đầu/cuối (đòi 2 thẻ @ảnh, chuỗi chỉ có 1)');
  }
  s.keyframeSync = false;

  return { settings: s, daTat };
}

/**
 * Ghép câu lệnh video cho từng ảnh.
 *
 * @param {string[]} names           mã ảnh
 * @param {string} shared            câu lệnh dùng chung cho mọi ảnh
 * @param {string[]|null} perImage   câu lệnh riêng theo thứ tự ảnh (nếu có)
 *
 * Mã ảnh đặt ở CUỐI câu cho đọc tự nhiên; Character Sync quét @tag ở mọi vị trí.
 */
function buildI2vPrompts(names, shared, perImage = null) {
  const chung = String(shared || '').trim();
  return (names || []).map((n, i) => {
    const rieng = perImage && perImage[i] ? String(perImage[i]).trim() : '';
    const than = rieng || chung;
    return than ? `${than} @${n}` : `@${n}`;
  });
}

module.exports = {
  buildJobs, splitJobs, buildStartMessage, planRun, planRunJobs, buildImageNames,
  buildI2vNames, invalidI2vNames, buildI2vPrompts, tenAnhTheoRename,
  caiDatChuoiVideo
};
