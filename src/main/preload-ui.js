// ============================================================================
//  preload-ui.js — cầu nối cho cửa sổ giao diện app
//  Chỉ phơi đúng những hàm giao diện cần, không phơi ipcRenderer trần.
// ============================================================================

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('flowApp', {
  // ── Tài khoản ──────────────────────────────────────────────────────────
  accounts: {
    list:    ()           => ipcRenderer.invoke('app:acc:list'),
    create:  (name)       => ipcRenderer.invoke('app:acc:create', name),
    rename:  (id, name)   => ipcRenderer.invoke('app:acc:rename', { id, name }),
    remove:  (id)         => ipcRenderer.invoke('app:acc:remove', id),
    logout:  (id)         => ipcRenderer.invoke('app:acc:logout', id),
    setDir:  (id, dir)    => ipcRenderer.invoke('app:acc:dir', { id, dir })
  },

  // ── Tab ────────────────────────────────────────────────────────────────
  tabs: {
    list:      ()          => ipcRenderer.invoke('app:tabs:list'),
    create:    (accountId) => ipcRenderer.invoke('app:tabs:create', accountId),
    close:     (id)        => ipcRenderer.invoke('app:tabs:close', id),
    activate:  (id)        => ipcRenderer.invoke('app:tabs:activate', id),
    reload:    (id)        => ipcRenderer.invoke('app:tabs:reload', id),
    reinject:  (id)        => ipcRenderer.invoke('app:tabs:reinject', id),
    diagnose:  (id)        => ipcRenderer.invoke('app:tabs:diagnose', id),
    setPane:   (rect, visible) => ipcRenderer.send('app:tabs:pane', { rect, visible }),
    // Đổi / đọc chế độ Image-Video trên trang Flow của một tab.
    setMode:   (id, mode)  => ipcRenderer.invoke('app:tabs:setMode', { id, mode }),
    getMode:   (id)        => ipcRenderer.invoke('app:tabs:getMode', id),
    // Đọc danh sách model video Flow đang cho chọn (và model đang chọn).
    listModels:(id)        => ipcRenderer.invoke('app:tabs:listModels', id)
  },

  // ── Điều khiển chạy ────────────────────────────────────────────────────
  run: {
    start:  (payload) => ipcRenderer.invoke('app:run:start', payload),
    pause:  (tabIds)  => ipcRenderer.invoke('app:run:pause', tabIds),
    resume: (tabIds)  => ipcRenderer.invoke('app:run:resume', tabIds),
    stop:   (tabIds)  => ipcRenderer.invoke('app:run:stop', tabIds),
    stats:  ()        => ipcRenderer.invoke('app:run:stats'),
    // Xem trước tên ảnh Flow sẽ đặt — tính bằng ĐÚNG hàm tiến trình chính
    // dùng lúc chạy, để thứ người dùng nhìn thấy và thứ máy làm không lệch.
    chainPreview: (payload) => ipcRenderer.invoke('app:run:chainPreview', payload),
    // Bộ nhịp "hiền" gợi ý theo số tab — tính ở tiến trình chính để giao diện
    // không giữ một bản sao thứ hai của mấy con số ấy.
    nhipAnToan: (soTab) => ipcRenderer.invoke('app:run:nhipAnToan', soTab)
  },

  // ── Dự án ──────────────────────────────────────────────────────────────
  projects: {
    list:   ()     => ipcRenderer.invoke('app:proj:list'),
    load:   (name) => ipcRenderer.invoke('app:proj:load', name),
    remove: (name) => ipcRenderer.invoke('app:proj:remove', name)
  },

  // ── Lệnh gửi thẳng cho engine ──────────────────────────────────────────
  engine: {
    uiSelftest:      ()     => ipcRenderer.invoke('app:eng:ui-selftest'),
    uiHealth:        ()     => ipcRenderer.invoke('app:eng:ui-health'),
    uiClear:         ()     => ipcRenderer.invoke('app:eng:ui-clear'),
    // Chỉ lại phần tử bằng cách bấm trên trang Flow, và xuất báo cáo .txt.
    uiPick:          (k)    => ipcRenderer.invoke('app:eng:ui-pick', k),
    uiReport:        ()     => ipcRenderer.invoke('app:eng:ui-report'),
    pushSelectors:   (s)    => ipcRenderer.invoke('app:eng:selectors-push', s),
    checkAssetNames: (d)    => ipcRenderer.invoke('app:eng:check-assets', d),
    checkFlowAssets: (d)    => ipcRenderer.invoke('app:eng:check-flow-assets', d),
    uploadImages:    (d)    => ipcRenderer.invoke('app:eng:upload-images', d)
  },

  // ── Cài đặt & hộp thoại ────────────────────────────────────────────────
  settings: {
    get:  ()     => ipcRenderer.invoke('app:settings:get'),
    save: (data) => ipcRenderer.invoke('app:settings:save', data)
  },

  dialog: {
    pickFolder: () => ipcRenderer.invoke('app:dialog:folder'),
    pickImages: () => ipcRenderer.invoke('app:dialog:images'),
    openTxt:    () => ipcRenderer.invoke('app:dialog:txt'),
    saveTxt:    (content, suggested) => ipcRenderer.invoke('app:dialog:save-txt', { content, suggested })
  },

  system: {
    version:   ()     => ipcRenderer.invoke('app:version'),
    openPath:  (p)    => ipcRenderer.invoke('app:open-path', p),
    testPaste: (text) => ipcRenderer.invoke('app:test-paste', text)
  },

  // ── Tự cập nhật ────────────────────────────────────────────────────────
  capNhat: {
    trangThai: ()       => ipcRenderer.invoke('app:capnhat:trangThai'),
    kiemTra:   ()       => ipcRenderer.invoke('app:capnhat:kiemTra'),
    caiDat:    (epBuoc) => ipcRenderer.invoke('app:capnhat:caiDat', epBuoc),
    moTrang:   ()       => ipcRenderer.invoke('app:capnhat:moTrang'),
    luuCaiDat: (c)      => ipcRenderer.invoke('app:capnhat:luuCaiDat', c)
  },

  // ── Sự kiện từ tiến trình chính ────────────────────────────────────────
  on: (channel, callback) => {
    const cho = ['log', 'tabs', 'accounts', 'stats', 'table', 'progress', 'run-state',
                 'cap-nhat', 'ui-pick', 'ui-break'];
    if (!cho.includes(channel)) return;
    ipcRenderer.on('ui:' + channel, (_e, payload) => callback(payload));
  }
});
