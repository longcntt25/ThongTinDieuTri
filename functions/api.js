// ================================================================
// BỆNH VIỆN PHỤ SẢN HẢI PHÒNG — Medical Protocol API
// Cloudflare Pages Functions — D1 Database Backend
// ================================================================

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json;charset=utf-8',
      ...corsHeaders
    }
  });
}

// Hàm bổ trợ chuyển đổi cột 'active' từ INTEGER (0/1) trong SQLite sang boolean (true/false)
// để tương thích hoàn toàn với logic kiểm tra của Frontend (app.js)
function mapRow(row) {
  if (!row) return row;
  return {
    ...row,
    active: (row.active === 1 || row.active === true || String(row.active).toUpperCase() === 'TRUE')
  };
}

function mapRows(rows) {
  if (!rows) return [];
  return rows.map(mapRow);
}

// Handler chính xử lý tất cả các yêu cầu đến /api
export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);

  // Xử lý CORS Preflight Request
  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  // Kiểm tra liên kết D1 Database
  if (!env.DB) {
    return jsonResponse({
      success: false,
      error: 'Không tìm thấy liên kết cơ sở dữ liệu "DB". Hãy cấu hình D1 binding trong Cloudflare Dashboard.'
    }, 500);
  }

  try {
    if (request.method === 'GET') {
      const action = url.searchParams.get('action');
      return await handleGet(action, url.searchParams, env.DB);
    } else if (request.method === 'POST') {
      let body;
      try {
        body = await request.json();
      } catch (e) {
        return jsonResponse({ success: false, error: 'Định dạng JSON không hợp lệ' }, 400);
      }
      return await handlePost(body, env.DB);
    } else {
      return jsonResponse({ success: false, error: 'Phương thức không được hỗ trợ' }, 405);
    }
  } catch (err) {
    return jsonResponse({ success: false, error: 'Lỗi máy chủ nội bộ: ' + err.message }, 500);
  }
}

// Xử lý GET Requests
async function handleGet(action, searchParams, db) {
  switch (action) {
    case 'getDepts': {
      // Admin hoặc hệ thống lấy toàn bộ danh sách khoa để hiển thị/quản lý
      const { results } = await db.prepare(
        "SELECT * FROM Departments ORDER BY sortOrder ASC, name ASC"
      ).all();
      return jsonResponse({ success: true, data: mapRows(results) });
    }
    case 'getConditions': {
      const deptId = searchParams.get('deptId');
      if (!deptId) return jsonResponse({ success: false, error: 'Thiếu deptId' });
      // Lấy toàn bộ bệnh lý của khoa (phục vụ admin)
      const { results } = await db.prepare(
        "SELECT * FROM Conditions WHERE deptId = ? ORDER BY sortOrder ASC, name ASC"
      ).bind(deptId).all();
      return jsonResponse({ success: true, data: mapRows(results) });
    }
    case 'getProtocol': {
      const condId = searchParams.get('condId');
      if (!condId) return jsonResponse({ success: false, error: 'Thiếu condId' });
      const { results } = await db.prepare(
        "SELECT * FROM Protocols WHERE condId = ? ORDER BY sortOrder ASC"
      ).bind(condId).all();
      return jsonResponse({ success: true, data: results });
    }
    case 'getAdminData': {
      const deptId = searchParams.get('deptId');
      const condId = searchParams.get('condId');

      // Đọc toàn bộ danh sách khoa (gồm cả ẩn) cho Admin quản lý
      const { results: depts } = await db.prepare(
        "SELECT * FROM Departments ORDER BY sortOrder ASC, name ASC"
      ).all();

      const selectedDeptId = deptId || (depts.length > 0 ? depts[0].id : null);

      // Đọc toàn bộ danh sách bệnh lý thuộc khoa đã chọn (gồm cả ẩn) cho Admin quản lý
      let conditions = [];
      if (selectedDeptId) {
        const { results } = await db.prepare(
          "SELECT * FROM Conditions WHERE deptId = ? ORDER BY sortOrder ASC, name ASC"
        ).bind(selectedDeptId).all();
        conditions = results;
      }

      const selectedCondId = condId || (conditions.length > 0 ? conditions[0].id : null);

      // Đọc mẫu phác đồ cho bệnh lý đã chọn
      let protocols = [];
      if (selectedCondId) {
        const { results } = await db.prepare(
          "SELECT * FROM Protocols WHERE condId = ? ORDER BY sortOrder ASC"
        ).bind(selectedCondId).all();
        protocols = results;
      }

      return jsonResponse({
        success: true,
        depts: mapRows(depts),
        conditions: mapRows(conditions),
        protocols,
        selectedDeptId,
        selectedCondId
      });
    }
    case 'getAllData': {
      // Dành cho Client Frontend tải nhanh dữ liệu lúc đầu (SWR)
      // Chỉ lấy các Khoa và Bệnh lý được cấu hình hiển thị (active = 1)
      const { results: depts } = await db.prepare(
        "SELECT * FROM Departments WHERE active = 1 ORDER BY sortOrder ASC, name ASC"
      ).all();
      const { results: conditions } = await db.prepare(
        "SELECT * FROM Conditions WHERE active = 1 ORDER BY sortOrder ASC, name ASC"
      ).all();
      const { results: protocols } = await db.prepare(
        "SELECT * FROM Protocols ORDER BY sortOrder ASC"
      ).all();

      return jsonResponse({
        success: true,
        depts: mapRows(depts),
        conditions: mapRows(conditions),
        protocols
      });
    }
    case 'setup': {
      return await setupDb(db);
    }
    case 'ping': {
      return jsonResponse({ success: true, message: 'pong' });
    }
    default: {
      return jsonResponse({ success: false, error: 'Hành động không xác định: ' + action });
    }
  }
}

// Khởi tạo database ban đầu
async function setupDb(db) {
  try {
    // 1. Tạo các bảng bằng cách thực thi từng câu lệnh SQLite riêng biệt
    // Điều này tránh lỗi phân tích dòng mới (incomplete input SQLITE_ERROR) của Cloudflare D1.
    const queries = [
      `CREATE TABLE IF NOT EXISTS Departments (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        color TEXT,
        sortOrder INTEGER DEFAULT 0,
        active INTEGER DEFAULT 1
      )`,
      `CREATE TABLE IF NOT EXISTS Conditions (
        id TEXT PRIMARY KEY,
        deptId TEXT,
        name TEXT NOT NULL,
        shortDesc TEXT,
        severity TEXT,
        sortOrder INTEGER DEFAULT 0,
        active INTEGER DEFAULT 1,
        FOREIGN KEY(deptId) REFERENCES Departments(id) ON DELETE CASCADE
      )`,
      `CREATE TABLE IF NOT EXISTS Protocols (
        id TEXT PRIMARY KEY,
        condId TEXT,
        dayLabel TEXT,
        assessment TEXT,
        labTests TEXT,
        treatment TEXT,
        nutrition TEXT,
        communication TEXT,
        careLevel TEXT,
        sortOrder INTEGER DEFAULT 0,
        FOREIGN KEY(condId) REFERENCES Conditions(id) ON DELETE CASCADE
      )`,
      `CREATE TABLE IF NOT EXISTS AdminConfig (
        key TEXT PRIMARY KEY,
        value TEXT
      )`,
      `CREATE TABLE IF NOT EXISTS Tokens (
        token TEXT PRIMARY KEY,
        expiry TEXT
      )`
    ];

    for (const q of queries) {
      await db.prepare(q).run();
    }

    // 2. Khởi tạo mật khẩu admin mặc định 'bvps123' nếu chưa có
    const storedHash = await db.prepare(
      "SELECT value FROM AdminConfig WHERE key = 'adminPasswordHash'"
    ).first('value');

    if (!storedHash) {
      // SHA-256 hash của 'bvps123'
      const defaultHash = 'bb0b4266190225b57c580fc521fa5e7f41307e8ac2ad40224f18b17d605b89fa';
      await db.prepare(
        "INSERT INTO AdminConfig (key, value) VALUES ('adminPasswordHash', ?)"
      ).bind(defaultHash).run();
    }

    // Các cấu hình mặc định khác
    const hospitalName = await db.prepare(
      "SELECT value FROM AdminConfig WHERE key = 'hospitalName'"
    ).first('value');
    if (!hospitalName) {
      await db.prepare(
        "INSERT INTO AdminConfig (key, value) VALUES ('hospitalName', 'Bệnh viện Phụ Sản Hải Phòng')"
      ).run();
    }

    const appVersion = await db.prepare(
      "SELECT value FROM AdminConfig WHERE key = 'appVersion'"
    ).first('value');
    if (!appVersion) {
      await db.prepare(
        "INSERT INTO AdminConfig (key, value) VALUES ('appVersion', '2.0.0')"
      ).run();
    }

    return jsonResponse({ success: true, message: 'Setup hoàn tất! Mật khẩu mặc định đã được đặt/reset thành: bvps123' });
  } catch (err) {
    return jsonResponse({ success: false, error: 'Setup DB thất bại: ' + err.message }, 500);
  }
}

// Xử lý POST Requests
async function handlePost(body, db) {
  const { action, token } = body;

  if (action === 'login') {
    const passwordHash = body.passwordHash;
    if (!passwordHash) return jsonResponse({ success: false, error: 'Thiếu mật khẩu' });

    const storedHash = await db.prepare(
      "SELECT value FROM AdminConfig WHERE key = 'adminPasswordHash'"
    ).first('value');

    if (!storedHash) {
      return jsonResponse({ success: false, error: 'Chưa cấu hình mật khẩu, hãy chạy setup bằng cách truy cập URL /api?action=setup' });
    }

    if (passwordHash !== storedHash) {
      return jsonResponse({ success: false, error: 'Sai mật khẩu' });
    }

    // Tạo Session token mới dạng UUID
    const newToken = crypto.randomUUID();
    const expiryDate = new Date();
    expiryDate.setHours(expiryDate.getHours() + 8); // Hết hạn sau 8 giờ
    const expiryStr = expiryDate.toISOString();

    await db.prepare(
      "INSERT INTO Tokens (token, expiry) VALUES (?, ?)"
    ).bind(newToken, expiryStr).run();

    // Dọn dẹp các token đã hết hạn
    try {
      const nowStr = new Date().toISOString();
      await db.prepare("DELETE FROM Tokens WHERE expiry < ?").bind(nowStr).run();
    } catch (e) {
      // Bỏ qua lỗi dọn dẹp
    }

    return jsonResponse({ success: true, token: newToken, expiresAt: expiryStr });
  }

  // Kiểm tra token cho các thao tác chỉnh sửa dữ liệu khác
  if (!token) {
    return jsonResponse({ success: false, error: 'Unauthorized — thiếu token' }, 401);
  }

  const isValid = await validateToken(token, db);
  if (!isValid) {
    return jsonResponse({ success: false, error: 'Unauthorized — token không hợp lệ hoặc đã hết hạn' }, 401);
  }

  switch (action) {
    case 'saveDept': {
      const item = body.item;
      if (!item) return jsonResponse({ success: false, error: 'Thiếu thông tin khoa' });
      if (!item.id) {
        item.id = crypto.randomUUID();
      }

      await db.prepare(
        "INSERT OR REPLACE INTO Departments (id, name, description, color, sortOrder, active) VALUES (?, ?, ?, ?, ?, ?)"
      ).bind(
        item.id,
        item.name,
        item.description || '',
        item.color || '#2D2B8C',
        item.sortOrder !== undefined ? Number(item.sortOrder) : 0,
        (item.active === true || String(item.active).toUpperCase() === 'TRUE' || item.active === 1) ? 1 : 0
      ).run();

      return jsonResponse({ success: true, id: item.id });
    }
    case 'deleteDept': {
      const id = body.id;
      if (!id) return jsonResponse({ success: false, error: 'Thiếu id khoa' });

      // Thực hiện xóa cascade thủ công
      await db.prepare(
        "DELETE FROM Protocols WHERE condId IN (SELECT id FROM Conditions WHERE deptId = ?)"
      ).bind(id).run();

      await db.prepare(
        "DELETE FROM Conditions WHERE deptId = ?"
      ).bind(id).run();

      await db.prepare(
        "DELETE FROM Departments WHERE id = ?"
      ).bind(id).run();

      return jsonResponse({ success: true });
    }
    case 'saveCondition': {
      const item = body.item;
      if (!item) return jsonResponse({ success: false, error: 'Thiếu thông tin bệnh lý' });
      if (!item.id) {
        item.id = crypto.randomUUID();
      }

      await db.prepare(
        "INSERT OR REPLACE INTO Conditions (id, deptId, name, shortDesc, severity, sortOrder, active) VALUES (?, ?, ?, ?, ?, ?, ?)"
      ).bind(
        item.id,
        item.deptId,
        item.name,
        item.shortDesc || '',
        item.severity || 'low',
        item.sortOrder !== undefined ? Number(item.sortOrder) : 0,
        (item.active === true || String(item.active).toUpperCase() === 'TRUE' || item.active === 1) ? 1 : 0
      ).run();

      return jsonResponse({ success: true, id: item.id });
    }
    case 'deleteCondition': {
      const id = body.id;
      if (!id) return jsonResponse({ success: false, error: 'Thiếu id bệnh lý' });

      await db.prepare(
        "DELETE FROM Protocols WHERE condId = ?"
      ).bind(id).run();

      await db.prepare(
        "DELETE FROM Conditions WHERE id = ?"
      ).bind(id).run();

      return jsonResponse({ success: true });
    }
    case 'saveProtocol': {
      const item = body.item;
      if (!item) return jsonResponse({ success: false, error: 'Thiếu thông tin mẫu phiếu' });
      if (!item.id) {
        item.id = crypto.randomUUID();
      }

      await db.prepare(
        "INSERT OR REPLACE INTO Protocols (id, condId, dayLabel, assessment, labTests, treatment, nutrition, communication, careLevel, sortOrder) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
      ).bind(
        item.id,
        item.condId,
        item.dayLabel || '',
        item.assessment || '',
        item.labTests || '',
        item.treatment || '',
        item.nutrition || '',
        item.communication || '',
        item.careLevel || '',
        item.sortOrder !== undefined ? Number(item.sortOrder) : 0
      ).run();

      return jsonResponse({ success: true, id: item.id });
    }
    case 'deleteProtocol': {
      const id = body.id;
      if (!id) return jsonResponse({ success: false, error: 'Thiếu id mẫu phiếu' });

      await db.prepare(
        "DELETE FROM Protocols WHERE id = ?"
      ).bind(id).run();

      return jsonResponse({ success: true });
    }
    case 'changePassword': {
      const newHash = body.newHash;
      if (!newHash) return jsonResponse({ success: false, error: 'Thiếu hash mật khẩu mới' });

      await db.prepare(
        "INSERT OR REPLACE INTO AdminConfig (key, value) VALUES ('adminPasswordHash', ?)"
      ).bind(newHash).run();

      // Đăng xuất toàn bộ phiên đăng nhập của thiết bị khác
      await db.prepare(
        "DELETE FROM Tokens WHERE token != ?"
      ).bind(token).run();

      return jsonResponse({ success: true });
    }
    case 'logout': {
      await db.prepare(
        "DELETE FROM Tokens WHERE token = ?"
      ).bind(token).run();

      return jsonResponse({ success: true });
    }
    default: {
      return jsonResponse({ success: false, error: 'Hành động POST không xác định: ' + action });
    }
  }
}

// Kiểm tra token xem có tồn tại và hợp lệ không
async function validateToken(token, db) {
  if (!token) return false;
  try {
    const row = await db.prepare(
      "SELECT expiry FROM Tokens WHERE token = ?"
    ).bind(token).first();

    if (!row) return false;

    const expiryTime = new Date(row.expiry).getTime();
    const nowTime = new Date().getTime();

    return expiryTime > nowTime;
  } catch (e) {
    return false;
  }
}
