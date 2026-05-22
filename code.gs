// ================================================================
// BỆNH VIỆN PHỤ SẢN HẢI PHÒNG — Medical Protocol API
// Google Apps Script — Web App Backend
// ================================================================
// HƯỚNG DẪN:
// 1. Tạo Google Sheet mới, copy ID từ URL vào SPREADSHEET_ID bên dưới
// 2. Deploy > New Deployment > Web App
//    - Execute as: Me
//    - Who has access: Anyone
// 3. Copy URL deployment vào CONFIG.SCRIPT_URL trong app.js
// 4. Lần đầu deploy xong, truy cập: <URL>?action=setup để khởi tạo sheets
// ================================================================

const SPREADSHEET_ID = '1QJx3eZme9S0W7QQsmZnh9t2ThyYjiq0OskycHjkSbZg'; // ← THAY ID GOOGLE SHEET VÀO ĐÂY
const TOKEN_EXPIRY_HOURS = 8;

// Tên các sheet
const SHEET = {
  DEPTS:      'Departments',
  CONDITIONS: 'Conditions',
  PROTOCOLS:  'Protocols',
  CONFIG:     'AdminConfig',
  TOKENS:     'Tokens'
};

// ================================================================
// CACHE HELPERS — CacheService, TTL 300 giây (5 phút)
// ================================================================

const CACHE_TTL = 300; // 5 phút

/**
 * Đọc cache theo key, trả về object hoặc null nếu miss
 */
function cacheGet_(key) {
  try {
    const raw = CacheService.getScriptCache().get(key);
    if (raw === null) return null;
    return JSON.parse(raw);
  } catch (e) {
    return null;
  }
}

/**
 * Ghi cache, bỏ qua nếu dữ liệu > 100KB
 */
function cacheSet_(key, data) {
  try {
    const json = JSON.stringify(data);
    if (json.length > 100000) return; // Bỏ qua nếu > 100KB
    CacheService.getScriptCache().put(key, json, CACHE_TTL);
  } catch (e) {
    // Bỏ qua lỗi cache
  }
}

/**
 * Xóa tất cả cache đã biết
 */
function cacheClearAll_() {
  try {
    CacheService.getScriptCache().removeAll([
      'c_Departments',
      'c_Conditions',
      'c_Protocols',
      'c_AdminConfig'
    ]);
  } catch (e) {
    // Bỏ qua lỗi cache
  }
}

/**
 * Đọc sheet có cache — thử cache trước, fallback readSheet()
 */
function readSheetCached_(sheetName) {
  const cacheKey = 'c_' + sheetName;
  const cached = cacheGet_(cacheKey);
  if (cached !== null) return cached;

  const data = readSheet(sheetName);
  cacheSet_(cacheKey, data);
  return data;
}

// ================================================================
// SPREADSHEET HELPER
// ================================================================

/**
 * Lấy đối tượng Spreadsheet hoạt động (Active) hoặc mở bằng ID làm phương án dự phòng.
 * Giúp tối ưu hóa tốc độ và loại bỏ lỗi cấu hình ID sai nếu Script được liên kết trực tiếp với Sheet.
 */
function getSs_() {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    if (ss) return ss;
  } catch (e) {
    // Bỏ qua lỗi
  }
  return SpreadsheetApp.openById(SPREADSHEET_ID);
}

// ================================================================
// HTTP ENTRY POINTS
// ================================================================

function doGet(e) {
  const p = e.parameter || {};
  let result;
  try {
    switch (p.action) {
      case 'getDepts':       result = getDepts();               break;
      case 'getConditions':  result = getConditions(p.deptId);  break;
      case 'getProtocol':    result = getProtocol(p.condId);    break;
      case 'getAdminData':   result = getAdminData(p.deptId, p.condId); break;
      case 'getAllData':     result = getAllData();             break;
      case 'setup':          result = setupSheets();             break;
      case 'ping':           result = { success: true, message: 'pong' }; break;
      default:               result = { success: false, error: 'Unknown action: ' + p.action };
    }
  } catch (err) {
    result = { success: false, error: err.toString() };
  }
  return buildResponse(result);
}

function doPost(e) {
  let data, result;
  try {
    data = JSON.parse(e.postData.contents);
    const action = data.action;

    if (action === 'login') {
      result = login(data.passwordHash);
    } else {
      // Tất cả action khác yêu cầu token hợp lệ
      if (!validateToken(data.token)) {
        return buildResponse({ success: false, error: 'Unauthorized — token không hợp lệ hoặc đã hết hạn' });
      }
      switch (action) {
        case 'saveDept':        result = saveDept(data.item);                         break;
        case 'deleteDept':      result = deleteDeptCascade(data.id);                  break;
        case 'saveCondition':   result = saveCondition(data.item);                    break;
        case 'deleteCondition': result = deleteConditionCascade(data.id);             break;
        case 'saveProtocol':    result = saveProtocol(data.item);                     break;
        case 'deleteProtocol':  result = deleteRowById(SHEET.PROTOCOLS, data.id);     break;
        case 'changePassword':  result = changePassword(data.newHash);                break;
        case 'logout':          result = revokeToken(data.token);                     break;
        default:                result = { success: false, error: 'Unknown action' };
      }
    }
  } catch (err) {
    result = { success: false, error: err.toString() };
  }
  return buildResponse(result);
}

function buildResponse(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

// ================================================================
// SETUP — Khởi tạo sheets và password mặc định
// ================================================================

function setupSheets() {
  const ss = getSs_();

  // Định nghĩa cấu trúc từng sheet
  const defs = [
    {
      name: SHEET.DEPTS,
      headers: ['id', 'name', 'description', 'color', 'sortOrder', 'active']
    },
    {
      name: SHEET.CONDITIONS,
      headers: ['id', 'deptId', 'name', 'shortDesc', 'severity', 'sortOrder', 'active']
    },
    {
      name: SHEET.PROTOCOLS,
      headers: ['id', 'condId', 'dayLabel', 'assessment', 'labTests', 'treatment', 'nutrition', 'communication', 'careLevel', 'sortOrder']
    },
    {
      name: SHEET.CONFIG,
      headers: ['key', 'value']
    },
    {
      name: SHEET.TOKENS,
      headers: ['token', 'expiry']
    }
  ];

  defs.forEach(def => {
    let sheet = ss.getSheetByName(def.name);
    if (!sheet) {
      sheet = ss.insertSheet(def.name);
      const headerRange = sheet.getRange(1, 1, 1, def.headers.length);
      headerRange.setValues([def.headers]);
      headerRange.setFontWeight('bold');
      headerRange.setBackground('#3B2F8C');
      headerRange.setFontColor('#FFFFFF');
    }
  });

  // Khởi tạo hoặc reset password mặc định
  const config = ss.getSheetByName(SHEET.CONFIG);
  const configData = config.getDataRange().getValues();
  
  let passRowIdx = -1;
  for (let i = 1; i < configData.length; i++) {
    if (configData[i][0] === 'adminPasswordHash') {
      passRowIdx = i + 1;
      break;
    }
  }

  const defaultHash = hashString('bvps123');
  if (passRowIdx > 0) {
    config.getRange(passRowIdx, 2).setValue(defaultHash);
  } else {
    config.appendRow(['adminPasswordHash', defaultHash]);
  }

  const keys = configData.slice(1).map(r => r[0]);
  if (!keys.includes('hospitalName')) {
    config.appendRow(['hospitalName', 'Bệnh viện Phụ Sản Hải Phòng']);
  }
  if (!keys.includes('appVersion')) {
    config.appendRow(['appVersion', '1.0.0']);
  }

  cacheClearAll_();
  return { success: true, message: 'Setup hoàn tất! Mật khẩu mặc định đã được đặt/reset thành: bvps123' };
}

// ================================================================
// READ OPERATIONS — Sử dụng cache để tăng tốc
// ================================================================

function getDepts() {
  const rows = readSheetCached_(SHEET.DEPTS);
  const active = rows
    .filter(r => r.active === true || String(r.active).toUpperCase() === 'TRUE')
    .sort((a, b) => Number(a.sortOrder || 0) - Number(b.sortOrder || 0));
  return { success: true, data: active };
}

function getConditions(deptId) {
  if (!deptId) return { success: false, error: 'Thiếu deptId' };
  const rows = readSheetCached_(SHEET.CONDITIONS);
  const filtered = rows
    .filter(r => r.deptId === deptId && (r.active === true || String(r.active).toUpperCase() === 'TRUE'))
    .sort((a, b) => Number(a.sortOrder || 0) - Number(b.sortOrder || 0));
  return { success: true, data: filtered };
}

function getProtocol(condId) {
  if (!condId) return { success: false, error: 'Thiếu condId' };
  const rows = readSheetCached_(SHEET.PROTOCOLS);
  const filtered = rows
    .filter(r => r.condId === condId)
    .sort((a, b) => Number(a.sortOrder || 0) - Number(b.sortOrder || 0));
  return { success: true, data: filtered };
}

/**
 * Bulk endpoint — Lấy tất cả dữ liệu admin trong 1 request
 * Trả về departments, conditions, protocols cùng lúc
 */
function getAdminData(deptId, condId) {
  // Đọc tất cả departments (active, đã sort)
  const allDepts = readSheetCached_(SHEET.DEPTS);
  const depts = allDepts
    .filter(r => r.active === true || String(r.active).toUpperCase() === 'TRUE')
    .sort((a, b) => Number(a.sortOrder || 0) - Number(b.sortOrder || 0));

  // Nếu không truyền deptId, dùng dept đầu tiên
  const selectedDeptId = deptId || (depts.length > 0 ? depts[0].id : null);

  // Đọc conditions cho deptId đã chọn (active, đã sort)
  const allConditions = readSheetCached_(SHEET.CONDITIONS);
  const conditions = selectedDeptId
    ? allConditions
        .filter(r => r.deptId === selectedDeptId && (r.active === true || String(r.active).toUpperCase() === 'TRUE'))
        .sort((a, b) => Number(a.sortOrder || 0) - Number(b.sortOrder || 0))
    : [];

  // Nếu không truyền condId, dùng condition đầu tiên
  const selectedCondId = condId || (conditions.length > 0 ? conditions[0].id : null);

  // Đọc protocols cho condId đã chọn (đã sort)
  const allProtocols = readSheetCached_(SHEET.PROTOCOLS);
  const protocols = selectedCondId
    ? allProtocols
        .filter(r => r.condId === selectedCondId)
        .sort((a, b) => Number(a.sortOrder || 0) - Number(b.sortOrder || 0))
    : [];

  return {
    success: true,
    depts: depts,
    conditions: conditions,
    protocols: protocols,
    selectedDeptId: selectedDeptId,
    selectedCondId: selectedCondId
  };
}

/**
 * Lấy toàn bộ danh sách khoa, bệnh lý hoạt động, và mẫu phiếu
 * Phục vụ preloading ở client-side
 */
function getAllData() {
  const allDepts = readSheetCached_(SHEET.DEPTS);
  const depts = allDepts
    .filter(r => r.active === true || String(r.active).toUpperCase() === 'TRUE')
    .sort((a, b) => Number(a.sortOrder || 0) - Number(b.sortOrder || 0));

  const allConditions = readSheetCached_(SHEET.CONDITIONS);
  const conditions = allConditions
    .filter(r => r.active === true || String(r.active).toUpperCase() === 'TRUE')
    .sort((a, b) => Number(a.sortOrder || 0) - Number(b.sortOrder || 0));

  const allProtocols = readSheetCached_(SHEET.PROTOCOLS);
  const protocols = allProtocols
    .sort((a, b) => Number(a.sortOrder || 0) - Number(b.sortOrder || 0));

  return {
    success: true,
    depts: depts,
    conditions: conditions,
    protocols: protocols
  };
}

// ================================================================
// WRITE OPERATIONS (yêu cầu token hợp lệ) — Xóa cache sau khi ghi
// ================================================================

function saveDept(item) {
  return upsertRow(SHEET.DEPTS, item,
    ['id', 'name', 'description', 'color', 'sortOrder', 'active']
  );
}

function saveCondition(item) {
  return upsertRow(SHEET.CONDITIONS, item,
    ['id', 'deptId', 'name', 'shortDesc', 'severity', 'sortOrder', 'active']
  );
}

function saveProtocol(item) {
  return upsertRow(SHEET.PROTOCOLS, item,
    ['id', 'condId', 'dayLabel', 'assessment', 'labTests', 'treatment', 'nutrition', 'communication', 'careLevel', 'sortOrder']
  );
}

function upsertRow(sheetName, item, columns) {
  const ss = getSs_();
  const sheet = ss.getSheetByName(sheetName);

  // Sinh ID nếu là item mới
  if (!item.id) {
    item.id = Utilities.getUuid();
  }

  // Tải dữ liệu từ CacheService thay vì truy vấn trực tiếp Google Sheets API (giảm tải tốn 300ms-600ms!)
  const cachedData = readSheetCached_(sheetName);
  let existingRowNum = -1;
  for (let i = 0; i < cachedData.length; i++) {
    if (String(cachedData[i].id) === String(item.id)) {
      existingRowNum = i + 2; // Dòng thực tế = index + 2 (1-based và trừ dòng header)
      break;
    }
  }

  // Xây dựng mảng giá trị theo đúng thứ tự cột
  const rowValues = columns.map(col => (item[col] !== undefined && item[col] !== null) ? item[col] : '');

  if (existingRowNum > 0) {
    sheet.getRange(existingRowNum, 1, 1, columns.length).setValues([rowValues]);
  } else {
    sheet.appendRow(rowValues);
  }

  cacheClearAll_();
  return { success: true, id: item.id };
}

function deleteRowById(sheetName, id) {
  const ss = getSs_();
  const sheet = ss.getSheetByName(sheetName);
  
  // Tải dữ liệu từ CacheService để tìm vị trí dòng cần xóa
  const cachedData = readSheetCached_(sheetName);

  // Xóa từ dưới lên để không ảnh hưởng index
  for (let i = cachedData.length - 1; i >= 0; i--) {
    if (String(cachedData[i].id) === String(id)) {
      sheet.deleteRow(i + 2); // 1-based, bỏ qua header
      cacheClearAll_();
      return { success: true };
    }
  }
  return { success: false, error: 'Không tìm thấy dòng với id: ' + id };
}

function deleteDeptCascade(deptId) {
  if (!deptId) return { success: false, error: 'Thiếu deptId' };
  const ss = getSs_();

  // 1. Tìm tất cả các condId thuộc deptId này từ sheet Conditions
  const condSheet = ss.getSheetByName(SHEET.CONDITIONS);
  if (!condSheet) {
    // Không có sheet Conditions → chỉ xóa khoa (inline)
    const deptSheet = ss.getSheetByName(SHEET.DEPTS);
    const deptData = deptSheet.getDataRange().getValues();
    const deptIdIdx = deptData[0].indexOf('id');
    for (let i = deptData.length - 1; i >= 1; i--) {
      if (String(deptData[i][deptIdIdx]) === String(deptId)) {
        deptSheet.deleteRow(i + 1);
        break;
      }
    }
    cacheClearAll_();
    return { success: true };
  }
  
  const condData = condSheet.getDataRange().getValues();
  if (condData.length < 2) {
    // Không có bệnh lý nào → chỉ xóa khoa (inline, tái sử dụng ss)
    const deptSheet = ss.getSheetByName(SHEET.DEPTS);
    const deptData = deptSheet.getDataRange().getValues();
    const deptIdIdx = deptData[0].indexOf('id');
    for (let i = deptData.length - 1; i >= 1; i--) {
      if (String(deptData[i][deptIdIdx]) === String(deptId)) {
        deptSheet.deleteRow(i + 1);
        break;
      }
    }
    cacheClearAll_();
    return { success: true };
  }
  
  const condHeaders = condData[0];
  const condIdIdx = condHeaders.indexOf('id');
  const condDeptIdIdx = condHeaders.indexOf('deptId');
  
  const condIdsToDelete = [];
  for (let i = 1; i < condData.length; i++) {
    if (String(condData[i][condDeptIdIdx]) === String(deptId)) {
      condIdsToDelete.push(String(condData[i][condIdIdx]));
    }
  }

  // 2. Xóa tất cả Protocols có condId nằm trong danh sách condIdsToDelete
  if (condIdsToDelete.length > 0) {
    const protoSheet = ss.getSheetByName(SHEET.PROTOCOLS);
    if (protoSheet) {
      const protoData = protoSheet.getDataRange().getValues();
      if (protoData.length >= 2) {
        const protoHeaders = protoData[0];
        const protoCondIdIdx = protoHeaders.indexOf('condId');
        
        for (let i = protoData.length - 1; i >= 1; i--) {
          if (condIdsToDelete.includes(String(protoData[i][protoCondIdIdx]))) {
            protoSheet.deleteRow(i + 1);
          }
        }
      }
    }
  }

  // 3. Xóa các dòng trong sheet Conditions thuộc khoa này
  for (let i = condData.length - 1; i >= 1; i--) {
    if (String(condData[i][condDeptIdIdx]) === String(deptId)) {
      condSheet.deleteRow(i + 1);
    }
  }

  // 4. Xóa dòng trong sheet Departments (inline, tái sử dụng ss)
  const deptSheet = ss.getSheetByName(SHEET.DEPTS);
  const deptData = deptSheet.getDataRange().getValues();
  const deptIdIdx = deptData[0].indexOf('id');
  for (let i = deptData.length - 1; i >= 1; i--) {
    if (String(deptData[i][deptIdIdx]) === String(deptId)) {
      deptSheet.deleteRow(i + 1);
      break;
    }
  }

  cacheClearAll_();
  return { success: true };
}

function deleteConditionCascade(condId) {
  if (!condId) return { success: false, error: 'Thiếu condId' };
  const ss = getSs_();

  // 1. Xóa tất cả các dòng trong sheet Protocols có condId trùng khớp
  const protoSheet = ss.getSheetByName(SHEET.PROTOCOLS);
  if (protoSheet) {
    const protoData = protoSheet.getDataRange().getValues();
    if (protoData.length >= 2) {
      const protoHeaders = protoData[0];
      const protoCondIdIdx = protoHeaders.indexOf('condId');
      
      for (let i = protoData.length - 1; i >= 1; i--) {
        if (String(protoData[i][protoCondIdIdx]) === String(condId)) {
          protoSheet.deleteRow(i + 1);
        }
      }
    }
  }

  // 2. Xóa dòng trong sheet Conditions (inline, tái sử dụng ss)
  const condSheet = ss.getSheetByName(SHEET.CONDITIONS);
  const condData = condSheet.getDataRange().getValues();
  const condIdIdx = condData[0].indexOf('id');
  for (let i = condData.length - 1; i >= 1; i--) {
    if (String(condData[i][condIdIdx]) === String(condId)) {
      condSheet.deleteRow(i + 1);
      break;
    }
  }

  cacheClearAll_();
  return { success: true };
}

// ================================================================
// AUTH
// ================================================================

function login(passwordHash) {
  if (!passwordHash) return { success: false, error: 'Thiếu mật khẩu' };

  const stored = getConfigValue('adminPasswordHash');
  if (!stored) return { success: false, error: 'Chưa cấu hình mật khẩu, hãy chạy setup' };

  if (passwordHash !== stored) {
    return { success: false, error: 'Sai mật khẩu' };
  }

  // Xóa token hết hạn
  const ss = getSs_();
  cleanExpiredTokens(ss);

  // Tạo token mới
  const token = Utilities.getUuid();
  const expiry = new Date();
  expiry.setHours(expiry.getHours() + TOKEN_EXPIRY_HOURS);

  const tokenSheet = ss.getSheetByName(SHEET.TOKENS);
  tokenSheet.appendRow([token, expiry.toISOString()]);

  return { success: true, token: token, expiresAt: expiry.toISOString() };
}

function validateToken(token) {
  if (!token) return false;
  const ss = getSs_();
  const tokenSheet = ss.getSheetByName(SHEET.TOKENS);
  if (!tokenSheet) return false;

  const data = tokenSheet.getDataRange().getValues();
  const now = new Date();

  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === token) {
      return new Date(data[i][1]) > now;
    }
  }
  return false;
}

function revokeToken(token) {
  const ss = getSs_();
  const tokenSheet = ss.getSheetByName(SHEET.TOKENS);
  const data = tokenSheet.getDataRange().getValues();

  for (let i = data.length - 1; i >= 1; i--) {
    if (data[i][0] === token) {
      tokenSheet.deleteRow(i + 1);
      return { success: true };
    }
  }
  return { success: true }; // Không tìm thấy cũng OK
}

function changePassword(newHash) {
  if (!newHash) return { success: false, error: 'Thiếu hash mật khẩu mới' };
  return setConfigValue('adminPasswordHash', newHash);
}

function cleanExpiredTokens(ss) {
  const tokenSheet = ss.getSheetByName(SHEET.TOKENS);
  if (!tokenSheet) return;
  const data = tokenSheet.getDataRange().getValues();
  const now = new Date();

  for (let i = data.length - 1; i >= 1; i--) {
    try {
      if (new Date(data[i][1]) < now) {
        tokenSheet.deleteRow(i + 1);
      }
    } catch (e) {
      tokenSheet.deleteRow(i + 1); // Xóa dòng lỗi
    }
  }
}

// ================================================================
// HELPERS
// ================================================================

function readSheet(sheetName) {
  const ss = getSs_();
  const sheet = ss.getSheetByName(sheetName);
  if (!sheet) return [];

  const data = sheet.getDataRange().getValues();
  if (data.length < 2) return [];

  const headers = data[0];
  return data.slice(1).map(row => {
    const obj = {};
    headers.forEach((h, i) => { obj[h] = row[i]; });
    return obj;
  });
}

function getConfigValue(key) {
  const rows = readSheetCached_(SHEET.CONFIG);
  const row = rows.find(r => r.key === key);
  return row ? row.value : null;
}

function setConfigValue(key, value) {
  const ss = getSs_();
  const sheet = ss.getSheetByName(SHEET.CONFIG);
  const data = sheet.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === key) {
      sheet.getRange(i + 1, 2).setValue(value);
      cacheClearAll_();
      return { success: true };
    }
  }
  // Key chưa tồn tại → thêm mới
  sheet.appendRow([key, value]);
  cacheClearAll_();
  return { success: true };
}

function hashString(str) {
  const bytes = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    str,
    Utilities.Charset.UTF_8
  );
  return bytes.map(b => ('0' + (b & 0xFF).toString(16)).slice(-2)).join('');
}
