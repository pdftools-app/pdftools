/**
 * PDF 合并工具 — 纯客户端，无后端
 * 依赖：pdf-lib、pdf.js (CDN)
 */

// pdf.js worker 提前初始化
if (typeof pdfjsLib !== 'undefined') {
  pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://unpkg.com/pdfjs-dist@4.0.379/build/pdf.worker.min.js';
}

// ============ 配置 ============
const FREE_LIMIT_FILES = 5;
const FREE_LIMIT_MERGES = 3;
const AFDIAN_URL = 'https://ifdian.net/a/thd4682';
const SALT = 'pdftools2026';  // 与 generate-keys.py 保持一致

// ============ 状态 ============
const STATE = {
  files: [],
  license: null,
  dragIdx: null,
  mergeCountToday: 0,
  mergeDate: '',
};

// ============ Key 校验 ============

/** DJB2 哈希（与 Python 版本一致） */
function djb2Hash(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h * 33) + s.charCodeAt(i)) >>> 0;
  }
  return h >>> 0;
}

/** 哈希值转 4 位校验码 */
function hashToChecksum(h) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let result = '';
  for (let i = 0; i < 4; i++) {
    result += chars[h % chars.length];
    h = Math.floor(h / chars.length);
  }
  return result;
}

/** 验证 License Key */
function validateKey(key) {
  const trimmed = key.trim().toUpperCase();
  // 格式: PDF-XXXX-XXXX-XXXX
  const match = trimmed.match(/^PDF-([A-Z0-9]{4})-([A-Z0-9]{4})-([A-Z0-9]{4})$/);
  if (!match) return false;

  const group1 = match[1];
  const group2 = match[2];
  const checksum = match[3];

  // 用 salt 重算校验码
  const hash = djb2Hash(group1 + group2 + SALT);
  const expected = hashToChecksum(hash);

  return checksum === expected;
}

// ============ 存储 ============
function loadState() {
  try {
    const raw = localStorage.getItem('pdf-tools-state');
    if (raw) {
      const saved = JSON.parse(raw);
      STATE.license = saved.license || null;
      STATE.mergeCountToday = saved.mergeCountToday || 0;
      STATE.mergeDate = saved.mergeDate || '';
    }
  } catch (_) {}
  checkDateReset();
}

function saveState() {
  try {
    localStorage.setItem('pdf-tools-state', JSON.stringify({
      license: STATE.license,
      mergeCountToday: STATE.mergeCountToday,
      mergeDate: STATE.mergeDate,
    }));
  } catch (_) {}
}

function checkDateReset() {
  const today = new Date().toISOString().slice(0, 10);
  if (STATE.mergeDate !== today) {
    STATE.mergeCountToday = 0;
    STATE.mergeDate = today;
    saveState();
  }
}

function isPremium() {
  if (!STATE.license || !STATE.license.valid) return false;
  if (!STATE.license.expiresAt) return true; // 旧版买断兼容
  return Date.now() < STATE.license.expiresAt;
}

function canMerge() {
  if (isPremium()) return true;
  return STATE.mergeCountToday < FREE_LIMIT_MERGES;
}

// ============ UI 更新 ============
function refreshTierBadge() {
  const badge = document.getElementById('tierBadge');
  const upBtn = document.getElementById('upgradeBtn');
  const hint = document.getElementById('usageHint');
  if (isPremium()) {
    badge.textContent = '专业版 👑';
    badge.className = 'badge badge-pro';
    upBtn.style.display = 'none';
    if (hint && STATE.license && STATE.license.expiresAt) {
      const days = Math.max(0, Math.ceil((STATE.license.expiresAt - Date.now()) / 86400000));
      hint.textContent = `剩余 ${days} 天`;
    }
  } else {
    badge.textContent = '免费版';
    badge.className = 'badge badge-free';
    upBtn.style.display = '';
    const rem = Math.max(0, FREE_LIMIT_MERGES - STATE.mergeCountToday);
    if (hint) hint.textContent = `今日剩余 ${rem} 次合并`;
  }
}

function refreshLimitNotice() {
  const notice = document.getElementById('limitNotice');
  if (isPremium()) {
    notice.classList.remove('show');
  } else if (STATE.files.length >= FREE_LIMIT_FILES) {
    notice.classList.add('show');
  } else {
    notice.classList.remove('show');
  }

  const btn = document.getElementById('mergeBtn');
  if (STATE.files.length === 0) {
    btn.disabled = true;
    btn.textContent = '🔗 开始合并';
  } else if (!isPremium() && STATE.files.length > FREE_LIMIT_FILES) {
    btn.disabled = true;
    btn.textContent = `🔒 免费版限 ${FREE_LIMIT_FILES} 个文件`;
  } else if (!isPremium() && !canMerge()) {
    btn.disabled = true;
    btn.textContent = '🔒 今日免费次数已用完';
  } else {
    btn.disabled = false;
    btn.textContent = `🔗 合并 ${STATE.files.length} 个文件`;
  }
}

// ============ 文件列表渲染 ============
function renderFileList() {
  const list = document.getElementById('fileList');
  const body = document.getElementById('fileListBody');
  const count = document.getElementById('fileCount');
  const actionBar = document.getElementById('actionBar');
  const dropzone = document.getElementById('dropzone');

  if (STATE.files.length === 0) {
    list.style.display = 'none';
    actionBar.style.display = 'none';
    dropzone.style.display = '';
    return;
  }

  list.style.display = '';
  actionBar.style.display = 'flex';
  dropzone.style.display = 'none';
  count.textContent = STATE.files.length;

  body.innerHTML = STATE.files.map((f, i) => {
    const sizeStr = f.size > 1024 * 1024
      ? (f.size / 1024 / 1024).toFixed(1) + ' MB'
      : (f.size / 1024).toFixed(0) + ' KB';
    const pageStr = f.pages !== undefined ? `${f.pages} 页` : '';

    return `
      <div class="file-item" draggable="true" data-idx="${i}">
        <div class="idx">${i + 1}</div>
        <div class="finfo">
          <div class="fname" title="${escapeHtml(f.name)}">${escapeHtml(f.name)}</div>
          <div class="fsize">${sizeStr}${pageStr ? ' · ' + pageStr : ''}</div>
        </div>
        <div class="btns">
          <button class="btn-sm move" onclick="moveUp(${i})" ${i === 0 ? 'disabled' : ''} title="上移">↑</button>
          <button class="btn-sm move" onclick="moveDown(${i})" ${i === STATE.files.length - 1 ? 'disabled' : ''} title="下移">↓</button>
          <button class="btn-sm del" onclick="removeFile(${i})" title="移除">✕</button>
        </div>
      </div>`;
  }).join('');

  refreshLimitNotice();
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ============ 文件操作 ============
async function addFiles(fileList) {
  const pdfs = Array.from(fileList).filter(f => f.type === 'application/pdf');
  if (pdfs.length === 0) return;

  for (const file of pdfs) {
    if (STATE.files.some(f => f.name === file.name && f.size === file.size)) continue;

    const arrayBuffer = await file.arrayBuffer();
    let pages = undefined;
    try {
      const pdfDoc = await PDFLib.PDFDocument.load(arrayBuffer, { ignoreEncryption: true });
      pages = pdfDoc.getPageCount();
    } catch (_) {}

    STATE.files.push({
      id: Date.now() + Math.random(),
      file: file,
      name: file.name,
      size: file.size,
      pages: pages,
      pdfBytes: new Uint8Array(arrayBuffer),
    });
  }

  renderFileList();
}

function removeFile(idx) {
  STATE.files.splice(idx, 1);
  renderFileList();
}

function refreshPreviewIfVisible() {
  if (document.getElementById('previewArea').style.display === 'block') {
    showPreview();
  }
}

function moveUp(idx) {
  if (idx <= 0) return;
  [STATE.files[idx - 1], STATE.files[idx]] = [STATE.files[idx], STATE.files[idx - 1]];
  renderFileList();
  refreshPreviewIfVisible();
}

function moveDown(idx) {
  if (idx >= STATE.files.length - 1) return;
  [STATE.files[idx], STATE.files[idx + 1]] = [STATE.files[idx + 1], STATE.files[idx]];
  renderFileList();
  refreshPreviewIfVisible();
}

function clearFiles() {
  STATE.files = [];
  renderFileList();
  document.getElementById('resultWrap').classList.remove('show');
  document.getElementById('progressWrap').classList.remove('show');
  document.getElementById('dropzone').style.display = '';
}

// ============ 核心：合并 PDF ============
async function mergePDFs() {
  if (STATE.files.length === 0) return;
  if (!isPremium() && STATE.files.length > FREE_LIMIT_FILES) return;
  if (!isPremium() && !canMerge()) return;

  const progressWrap = document.getElementById('progressWrap');
  const progressFill = document.getElementById('progressFill');
  const progressText = document.getElementById('progressText');
  const mergeBtn = document.getElementById('mergeBtn');
  const resultWrap = document.getElementById('resultWrap');

  progressWrap.classList.add('show');
  resultWrap.classList.remove('show');
  mergeBtn.disabled = true;
  progressFill.style.width = '0%';

  try {
    progressText.textContent = '正在创建文档...';
    progressFill.style.width = '10%';
    await sleep(100);

    const mergedPdf = await PDFLib.PDFDocument.create();

    for (let i = 0; i < STATE.files.length; i++) {
      progressText.textContent = `正在处理 ${i + 1}/${STATE.files.length}: ${STATE.files[i].name}`;
      progressFill.style.width = `${10 + Math.floor((i / STATE.files.length) * 70)}%`;
      await sleep(50);

      try {
        const srcDoc = await PDFLib.PDFDocument.load(STATE.files[i].pdfBytes, { ignoreEncryption: true });
        const pages = await mergedPdf.copyPages(srcDoc, srcDoc.getPageIndices());
        pages.forEach(p => mergedPdf.addPage(p));
      } catch (err) {
        console.error(`Failed to merge ${STATE.files[i].name}:`, err);
      }
    }

    progressText.textContent = '正在生成文件...';
    progressFill.style.width = '90%';
    await sleep(100);

    const mergedBytes = await mergedPdf.save();
    progressFill.style.width = '100%';
    progressText.textContent = '完成！';

    STATE.mergeCountToday++;
    saveState();

    const blob = new Blob([mergedBytes], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    const sizeStr = (blob.size / 1024 / 1024).toFixed(2) + ' MB';

    document.getElementById('resultSize').textContent = `合并后文件大小: ${sizeStr} · 共 ${STATE.files.length} 个文件`;
    const downloadBtn = document.getElementById('downloadBtn');
    downloadBtn.href = url;
    downloadBtn.download = 'merged.pdf';

    setTimeout(() => {
      progressWrap.classList.remove('show');
      resultWrap.classList.add('show');
    }, 500);

  } catch (err) {
    progressText.textContent = '合并失败: ' + err.message;
    progressFill.style.background = '#e74c3c';
    console.error('Merge error:', err);
  }

  mergeBtn.disabled = false;
  refreshLimitNotice();
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// ============ License ============
function showLicenseModal() {
  // 设置购买链接
  document.getElementById('buyLink').href = AFDIAN_URL;
  document.getElementById('licenseModal').classList.add('show');
  document.getElementById('modalMsg').style.display = 'none';
  document.getElementById('licenseInput').value = '';
}

function hideLicenseModal() {
  document.getElementById('licenseModal').classList.remove('show');
}

function activateLicense() {
  const input = document.getElementById('licenseInput').value.trim();
  const msg = document.getElementById('modalMsg');

  if (!input) {
    msg.style.display = 'block';
    msg.style.color = '#e74c3c';
    msg.textContent = '请输入 License Key';
    return;
  }

  if (!validateKey(input)) {
    msg.style.display = 'block';
    msg.style.color = '#e74c3c';
    msg.textContent = '❌ 无效的 License Key';
    return;
  }

  STATE.license = { key: input, valid: true, expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000 };
  saveState();
  refreshTierBadge();
  refreshLimitNotice();
  hideLicenseModal();
}

// ============ 拖拽排序 ============
function setupDragSort() {
  const body = document.getElementById('fileListBody');

  body.addEventListener('dragstart', (e) => {
    const item = e.target.closest('.file-item');
    if (!item) return;
    STATE.dragIdx = parseInt(item.dataset.idx);
    item.style.opacity = '0.5';
  });

  body.addEventListener('dragend', (e) => {
    const item = e.target.closest('.file-item');
    if (item) item.style.opacity = '1';
    STATE.dragIdx = null;
  });

  body.addEventListener('dragover', (e) => {
    e.preventDefault();
    const item = e.target.closest('.file-item');
    if (!item || STATE.dragIdx === null) return;
    const targetIdx = parseInt(item.dataset.idx);
    if (targetIdx !== STATE.dragIdx) {
      const [moved] = STATE.files.splice(STATE.dragIdx, 1);
      STATE.files.splice(targetIdx, 0, moved);
      STATE.dragIdx = targetIdx;
      renderFileList();
      refreshPreviewIfVisible();
    }
  });
}

// ============ 拖拽上传 ============
function setupDropzone() {
  const dz = document.getElementById('dropzone');
  const fileInput = document.getElementById('fileInput');

  dz.addEventListener('click', () => fileInput.click());

  dz.addEventListener('dragover', (e) => {
    e.preventDefault();
    dz.classList.add('drag-over');
  });

  dz.addEventListener('dragleave', () => {
    dz.classList.remove('drag-over');
  });

  dz.addEventListener('drop', (e) => {
    e.preventDefault();
    dz.classList.remove('drag-over');
    addFiles(e.dataTransfer.files);
  });

  fileInput.addEventListener('change', (e) => {
    addFiles(e.target.files);
    fileInput.value = '';
  });

  document.addEventListener('dragover', (e) => {
    e.preventDefault();
    dz.classList.add('drag-over');
  });
  document.addEventListener('drop', (e) => {
    e.preventDefault();
    dz.classList.remove('drag-over');
    if (!dz.contains(e.target)) {
      addFiles(e.dataTransfer.files);
    }
  });
}

// ============ 预览 ============
function showPreview() {
  if (STATE.files.length === 0) return;
  const area = document.getElementById('previewArea');
  const grid = document.getElementById('previewGrid');
  area.style.display = 'block';

  const colors = ['#667eea','#f59e0b','#10b981','#ef4444','#8b5cf6','#ec4899','#06b6d4','#f97316'];
  const totalPages = STATE.files.reduce((sum, f) => sum + (f.pages || 0), 0);

  grid.innerHTML = ''
    + '<div style="width:100%;text-align:center;margin-bottom:14px;font-size:13px;color:#64748b">'
    + '合并顺序确认 · 共 ' + STATE.files.length + ' 个文件 · 预计 ' + totalPages + ' 页'
    + '</div>'
    + '<div style="display:flex;gap:12px;overflow-x:auto;padding-bottom:8px">'
    + STATE.files.map((f, i) => {
        const sizeStr = f.size > 1024 * 1024
          ? (f.size / 1024 / 1024).toFixed(1) + ' MB'
          : (f.size / 1024).toFixed(0) + ' KB';
        const bg = colors[i % colors.length];
        return ''
          + '<div class="preview-card" id="pcard-' + i + '" style="flex-shrink:0;min-width:150px">'
          + '<div style="width:150px;height:100px;background:' + bg + ';border-radius:8px;display:flex;flex-direction:column;align-items:center;justify-content:center;color:white;margin-bottom:8px">'
          + '<div style="font-size:36px;font-weight:800">' + (i + 1) + '</div>'
          + '<div style="font-size:11px">' + (f.pages || '?') + ' 页 · ' + sizeStr + '</div>'
          + '</div>'
          + '<div class="pname" style="font-size:12px;text-align:center" title="' + escapeHtml(f.name) + '">' + escapeHtml(f.name) + '</div>'
          + '</div>';
      }).join('')
    + '</div>';
}

function hidePreview() {
  document.getElementById('previewArea').style.display = 'none';
}

// ============ 事件绑定 ============
function setupEvents() {
  document.getElementById('mergeBtn').addEventListener('click', mergePDFs);
  document.getElementById('clearBtn').addEventListener('click', clearFiles);
  document.getElementById('downloadBtn').addEventListener('click', () => {
    setTimeout(() => {
      document.getElementById('resultWrap').classList.remove('show');
      clearFiles();
    }, 1000);
  });
  document.getElementById('resetBtn').addEventListener('click', clearFiles);
  document.getElementById('previewBtn').addEventListener('click', showPreview);
  document.getElementById('closePreview').addEventListener('click', hidePreview);

  document.getElementById('upgradeBtn').addEventListener('click', (e) => {
    e.preventDefault();
    showLicenseModal();
  });
  document.getElementById('limitUpgradeLink').addEventListener('click', (e) => {
    e.preventDefault();
    showLicenseModal();
  });
  document.getElementById('modalClose').addEventListener('click', hideLicenseModal);
  document.getElementById('modalActivate').addEventListener('click', activateLicense);
  document.getElementById('licenseInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') activateLicense();
  });

  document.getElementById('licenseModal').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) hideLicenseModal();
  });
}

// ============ 启动 ============
function init() {
  loadState();
  refreshTierBadge();
  setupDropzone();
  setupDragSort();
  setupEvents();
}

document.addEventListener('DOMContentLoaded', init);
