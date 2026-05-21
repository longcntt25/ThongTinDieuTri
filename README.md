# 📋 Hệ Thống Tra Cứu Phiếu Điều Trị
## Bệnh Viện Phụ Sản Hải Phòng

> Website tra cứu nhanh phiếu tóm tắt thông tin điều trị dành cho nhân viên y tế.  
> Stack: HTML + CSS + JS (Cloudflare Pages) + Google Apps Script + Google Sheets

---

## 🗂️ Cấu Trúc File

```
ThongTinDieuTri/
├── index.html         ← SPA entry point + PWA
├── style.css          ← Design system đầy đủ
├── app.js             ← SPA logic (router, API, render)
├── manifest.json      ← PWA manifest
├── Logo.png           ← Logo bệnh viện
└── appscript/
    └── Code.gs        ← Google Apps Script (backend API)
```

---

## 🚀 Hướng Dẫn Deploy — Từng Bước

### BƯỚC 1: Tạo Google Sheet

1. Vào [sheets.google.com](https://sheets.google.com) → **Tạo bảng tính mới**
2. Đặt tên: `MedProtocol_DB`
3. Copy **ID** từ URL: `https://docs.google.com/spreadsheets/d/**{ID_NÀY}**/edit`

---

### BƯỚC 2: Tạo Google Apps Script

1. Vào [script.google.com](https://script.google.com) → **Dự án mới**
2. Đặt tên: `MedProtocol_API`
3. Xóa nội dung mặc định, paste toàn bộ nội dung file `appscript/Code.gs` vào
4. Tìm dòng này và thay ID Google Sheet vừa tạo:
   ```javascript
   const SPREADSHEET_ID = 'YOUR_GOOGLE_SHEET_ID_HERE';
   //                      ↑ Thay ID vào đây
   ```
5. Nhấn **💾 Lưu** (Ctrl+S)

---

### BƯỚC 3: Deploy Apps Script thành Web App

1. Nhấn **Deploy** → **New Deployment**
2. Chọn loại: **Web App**
3. Cấu hình:
   - **Description**: `MedProtocol v1`
   - **Execute as**: `Me` (tài khoản của bạn)
   - **Who has access**: `Anyone` ← **BẮT BUỘC**
4. Nhấn **Deploy** → Cấp quyền nếu được hỏi
5. Copy **URL Web App** (dạng: `https://script.google.com/macros/s/AKfycb.../exec`)

---

### BƯỚC 4: Khởi Tạo Database

Truy cập URL này trên trình duyệt:
```
https://script.google.com/macros/s/{SCRIPT_ID}/exec?action=setup
```

Kết quả mong đợi:
```json
{ "success": true, "message": "Setup hoàn tất! Mật khẩu mặc định: cntt123" }
```

Google Sheet sẽ tự động tạo 5 sheet:
- **Departments** — Danh sách khoa
- **Conditions** — Bệnh lý theo khoa
- **Protocols** — Nội dung mẫu phiếu
- **AdminConfig** — Cấu hình (mật khẩu)
- **Tokens** — Session tokens

---

### BƯỚC 5: Cấu Hình Frontend

Mở file `app.js`, tìm và thay URL:
```javascript
const CONFIG = {
  SCRIPT_URL: 'YOUR_GOOGLE_APPS_SCRIPT_WEB_APP_URL_HERE',
  //           ↑ Thay URL Apps Script vào đây
  ...
};
```

---

### BƯỚC 6: Deploy lên Cloudflare Pages

#### Cách A: Qua GitHub (Khuyên dùng)

1. Push toàn bộ code lên GitHub repo
2. Vào [pages.cloudflare.com](https://pages.cloudflare.com) → **Create a project**
3. **Connect to Git** → Chọn repo
4. Cấu hình:
   - **Project name**: `thongtindieutri`  ← sẽ thành `thongtindieutri.pages.dev`
   - **Framework preset**: None
   - **Build command**: (để trống)
   - **Build output directory**: `/` (hoặc để trống)
5. Nhấn **Save and Deploy**

#### Cách B: Upload Trực Tiếp

1. Vào [pages.cloudflare.com](https://pages.cloudflare.com) → **Create a project**
2. Chọn **Upload assets**
3. Kéo thả tất cả file (trừ thư mục `appscript/`) vào
4. Đặt tên project: `thongtindieutri`

---

### BƯỚC 7: Nhập Dữ Liệu Qua Admin Panel

1. Truy cập `https://thongtindieutri.pages.dev`
2. Click icon 👤 góc phải → Trang Admin
3. Đăng nhập mật khẩu: `cntt123`
4. **Tab Khoa** → Thêm: `Khoa Sản 3`
5. **Tab Bệnh Lý** → Chọn khoa → Thêm 4 bệnh:
   - Dọa đẻ non (Mức: Trung bình)
   - Tiền chuyển dạ (Mức: Thấp)
   - Tiền sản giật (Mức: Cao)
   - Rau tiền đạo (Mức: Cao)
6. **Tab Mẫu Phiếu** → Chọn khoa + bệnh → Thêm từng giai đoạn

---

## 🔐 Bảo Mật

| Điều | Ghi chú |
|------|---------|
| Mật khẩu mặc định | `cntt123` — **Đổi ngay sau khi deploy!** |
| Session token | Tự hết hạn sau 8 giờ |
| Hash algorithm | SHA-256 (Web Crypto API) |
| Admin path | Nhấn icon 👤 trên header |

**Đổi mật khẩu**: Admin → Tab Cài Đặt → Đổi Mật Khẩu

---

## 📱 Tính Năng PWA

- **Cài app**: Trình duyệt di động có thể cài đặt ứng dụng vào màn hình chính thông qua manifest.json.
- **Trực tiếp**: Ứng dụng luôn đọc/ghi trực tiếp với Google Sheet để đảm bảo không bị stale/cache dữ liệu cũ.

---

## 🔄 Mở Rộng Thêm Khoa

Để thêm khoa mới (VD: Khoa Sản 1):
1. Vào Admin Panel → Tab Khoa → Thêm khoa mới
2. Tab Bệnh Lý → Chọn khoa mới → Thêm các bệnh lý
3. Tab Mẫu Phiếu → Nhập nội dung phiếu

**Không cần chạm vào code!** Toàn bộ UI tự động cập nhật.

---

## ❓ Troubleshooting

| Lỗi | Giải pháp |
|-----|-----------|
| "Không thể tải danh sách khoa" | Kiểm tra SCRIPT_URL trong app.js |
| "Không có kết nối" | Kiểm tra Apps Script deploy "Who has access: Anyone" |
| Đăng nhập admin thất bại | Chạy lại `?action=setup` để reset password |
| Logo không hiển thị | Logo.png phải ở cùng thư mục với index.html |
| CORS error | Đảm bảo dùng POST với `Content-Type: text/plain` |

---

## 🛠️ Cập Nhật Apps Script

Sau khi sửa Code.gs:
1. **Deploy** → **Manage deployments**
2. Nhấn ✏️ Edit → **New version** → **Deploy**

---

*Phát triển cho Bệnh viện Phụ Sản Hải Phòng — Sở Y tế TP. Hải Phòng*
