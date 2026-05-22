# 📋 Hệ Thống Tra Cứu Phiếu Điều Trị
## Bệnh Viện Phụ Sản Hải Phòng

> Website tra cứu nhanh phiếu tóm tắt thông tin điều trị dành cho nhân viên y tế.  
> **Stack hiện đại**: HTML + CSS + JS (Cloudflare Pages) + **Cloudflare D1 Database** + **Cloudflare Pages Functions** (Backend API nội bộ).

---

## 🗂️ Cấu Trúc Dự Án

```
ThongTinDieuTri/
├── index.html         ← Giao diện SPA (Frontend)
├── style.css          ← Bộ CSS thiết kế giao diện
├── app.js             ← Logic gọi API nội bộ (/api) & hiển thị dữ liệu
├── manifest.json      ← Cấu hình PWA để cài ứng dụng trên điện thoại
├── Logo.png           ← Logo bệnh viện
└── functions/
    └── api.js         ← Backend API Router chạy trực tiếp tại Edge (Cloudflare)
```

---

## 🚀 Hướng Dẫn Deploy Chi Tiết (Hoàn Toàn Miễn Phí)

Hãy làm theo các bước đơn giản dưới đây để đưa website và cơ sở dữ liệu của bạn lên Internet toàn cầu.

### BƯỚC 1: Đẩy code lên GitHub
1. Tạo một Repository mới trên GitHub (để chế độ Private hoặc Public tùy bạn).
2. Đẩy toàn bộ mã nguồn của thư mục này lên GitHub repository đó.

---

### BƯỚC 2: Tạo Cơ Sở Dữ Liệu Cloudflare D1
1. Đăng nhập vào trang quản trị [Cloudflare Dashboard](https://dash.cloudflare.com/).
2. Chọn mục **Workers & Pages** ở menu bên trái, sau đó chọn **D1**.
3. Nhấp vào nút **Create database** (Tạo cơ sở dữ liệu).
4. Chọn **D1** (không phải bản Beta), nhập tên database là `medprotocol-db` (hoặc tên tùy ý) rồi nhấn **Create**.

---

### BƯỚC 3: Tạo và Cấu Hình Dự Án Cloudflare Pages
1. Ở menu bên trái Cloudflare, chọn **Workers & Pages** -> Nhấn **Create application** -> Chọn tab **Pages**.
2. Nhấp vào nút **Connect to Git** và chọn Repository GitHub bạn đã đẩy code lên ở Bước 1.
3. Ở phần cấu hình (Build settings):
   - **Framework preset**: Chọn `None`.
   - **Build command**: (để trống).
   - **Build output directory**: (để trống hoặc ghi `/`).
4. Nhấn **Save and Deploy**. Cloudflare sẽ bắt đầu build website tĩnh của bạn.

---

### BƯỚC 4: Liên Kết (Bind) Cơ Sở Dữ Liệu D1 với Pages
*Đây là bước quan trọng giúp code API trong thư mục `/functions` có thể nói chuyện được với database D1.*

1. Trong trang dự án Pages vừa tạo, nhấp chọn tab **Settings** (Cài đặt) -> Chọn mục **Functions** ở menu con bên trái.
2. Cuộn xuống phần **D1 database bindings** -> Nhấp vào **Add binding**.
3. Điền các thông tin sau:
   - **Variable name** (Tên biến): Điền chính xác là `DB` (viết hoa).
   - **D1 database**: Chọn database bạn đã tạo ở Bước 2 (`medprotocol-db`).
4. Nhấn **Save** (Lưu).
5. **QUAN TRỌNG**: Để áp dụng cấu hình này, hãy quay lại tab **Deployments**, nhấp vào nút **Create new deployment** (hoặc kích hoạt một đợt deploy mới bằng cách đẩy code lên GitHub) để Cloudflare nhận dạng liên kết mới.

---

### BƯỚC 5: Khởi Tạo Database và Thiết Lập Mật Khẩu
Sau khi Pages hoàn thành deploy, bạn chỉ cần chạy link setup một lần duy nhất:

1. Truy cập vào đường dẫn sau trên trình duyệt (thay tên miền của bạn vào):
   ```
   https://{TEN-DU-AN-CUA-BAN}.pages.dev/api?action=setup
   ```
2. Nếu màn hình hiển thị:
   ```json
   { "success": true, "message": "Setup hoàn tất! Mật khẩu mặc định đã được đặt/reset thành: bvps123" }
   ```
   Nghĩa là cơ sở dữ liệu đã khởi tạo thành công tất cả các bảng và đặt mật khẩu Admin mặc định là `bvps123`.

---

### BƯỚC 6: Nhập Dữ Liệu & Sử Dụng
1. Truy cập trang chủ dự án của bạn (ví dụ: `https://thongtindieutri.pages.dev`).
2. Click vào biểu tượng Admin 👤 ở góc trên bên phải.
3. Nhập mật khẩu mặc định: `bvps123` để đăng nhập vào trang quản trị.
4. **Đổi mật khẩu ngay**: Vào tab **Cài Đặt** trong Admin -> Điền mật khẩu mới và nhấn **Đổi Mật Khẩu**.
5. Nhập các dữ liệu Khoa, Bệnh lý, và Mẫu phiếu như bình thường. Cơ sở dữ liệu Cloudflare D1 sẽ lưu trữ tự động và hiển thị lập tức trên giao diện người dùng.

---

## 🔐 Bảo Mật
- Toàn bộ kết nối API được bảo vệ bởi Session token thời hạn 8 giờ lưu trực tiếp trong bảng `Tokens` của database D1.
- Mật khẩu Admin được mã hóa dưới dạng hash SHA-256 (sử dụng chuẩn Web Crypto API trực tiếp ở Edge) trước khi so khớp và lưu trữ.
- API chạy trực tiếp ở máy chủ Cloudflare giúp che giấu cấu trúc database và ngăn chặn các hành vi tấn công SQL Injection nhờ sử dụng Prepared Statements (`bind`).

---

*Phát triển cho Bệnh viện Phụ Sản Hải Phòng — Sở Y tế TP. Hải Phòng*
