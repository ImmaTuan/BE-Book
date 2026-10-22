# Backend CRUD sách + đăng nhập Admin

Node.js 20+, MySQL 8.0.16+, Express, JWT, bcrypt. Chỉ quản lý sách, thêm xác thực/phân quyền; không có CRUD tài khoản, đơn hàng hay thanh toán. Đây là backend API, chưa có trang HTML/React. Khi làm frontend, gọi /api/auth/me để quyết định hiển thị/điều hướng; backend vẫn tự kiểm tra quyền mọi request.

## Cài đặt thay bản CRUD cũ

Dừng server cũ (Ctrl+C), thay thư mục backend bằng project này. Giữ nguyên database và ghi lại thông tin kết nối từ .env cũ. Không cần import lại schema FINAL 11 bảng.

```powershell
npm install
Copy-Item .env.example .env
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Sửa thông tin MySQL trong .env; gán JWT_SECRET bằng chuỗi vừa sinh. Không dùng chuỗi placeholder. Nếu chưa có DB: import database/demo.sql (users, categories, books). Nếu trước đây chỉ import demo 2 bảng: có thể import lại demo.sql để thêm users, dữ liệu cũ không bị xóa.

```powershell
npm run seed:accounts
npm run dev
```

Seed tạo 2 tài khoản theo .env, password đã băm bcrypt. Không đổi mật khẩu/quyền của email đã tồn tại; nếu đã tồn tại thì dùng tài khoản cũ đúng mật khẩu hoặc chọn email khác trong .env. Mặc định:

| Vai trò | Email | Mật khẩu demo |
|---|---|---|
| Admin | admin@bookstore.local | Admin123456! |
| Khách | customer@bookstore.local | Customer123456! |

## Đăng nhập và phân quyền

POST /api/auth/admin/login với JSON email, password. Sai mật khẩu/khóa tài khoản: 401; đúng tài khoản nhưng role customer: 403, "Bạn không có quyền truy cập trang Admin". Admin hợp lệ nhận data.token và data.user.

POST /api/auth/login là login chung cho cả Admin/khách để test; khách nhận token nhưng vẫn không gọi được /api/admin/*. GET /api/auth/me cần token, trả tài khoản hiện tại. Token HS256 có hạn 2 giờ. Mỗi request kiểm tra lại role/is_active từ DB, nên hạ quyền/khóa tài khoản có hiệu lực ngay cả khi token chưa hết hạn. Không nhận role/user_id từ body khi login.

Gửi header cho mọi /api/admin/*:
```text
Authorization: Bearer <data.token>
```

Không token/token lỗi/hết hạn: 401. Có token khách thường: 403. Đúng Admin: cho truy cập. Health không yêu cầu login. Login giới hạn 30 lần/15 phút/IP. Logout phía client xóa token; chưa có danh sách thu hồi token/refresh token.

## API CRUD sách (cần token Admin)

| Method | URL | Công dụng |
|---|---|---|
| GET | /api/admin/books | Danh sách sách |
| GET | /api/admin/books/:id | Chi tiết sách |
| POST | /api/admin/books | Thêm sách |
| PATCH | /api/admin/books/:id | Sửa trường được gửi |
| PUT | /api/admin/books/:id | Cũng sửa các trường được gửi để tiện test |
| DELETE | /api/admin/books/:id | Xóa sách chưa bị tham chiếu |
| GET | /api/admin/categories | Chỉ đọc danh sách để chọn category_id; không có CRUD thể loại |

Danh sách sách hỗ trợ `?page=1&limit=20&search=abc&category_id=1`, limit tối đa 100.

POST tối thiểu:
```json
{"category_id":1,"title":"Sách mới","price":100000,"weight_grams":300}
```
category_id phải tồn tại. Tùy chọn: description, cover_url (URL http/https), stock_quantity, publisher, publication_year, is_active. Không nhận id/created_at từ body. Sách đã có liên kết tác giả/đơn hàng/review không xóa được (409); ngừng bán bằng PATCH {"is_active":false}. Không tự xóa dữ liệu liên quan.


## Postman

Import postman/BooksCRUD.postman_collection.json. Nếu đổi tài khoản trong .env thì sửa collection variables tương ứng. Chạy thứ tự A1 -> A6 -> các request CRUD. Request A2 tự lưu admin_token; A5 lưu customer_token. CRUD dùng admin_token từ collection, không cần copy tay. Có test 401 chưa login và 403 tài khoản khách. Bộ CRUD lấy category_id có sẵn, tạo sách, sửa và xóa chính sách mới tạo.

## Kiểm tra và lưu ý

npm test kiểm tra CRUD và auth qua HTTP với DB giả lập. Chưa chạy tích hợp MySQL thật tại môi trường tạo file; dùng Postman để kiểm tra trên máy bạn. Server mặc định chỉ bind 127.0.0.1. Chưa có UI; route guard React cần làm khi tạo frontend. Không commit .env.

Cấu trúc: routes -> controllers -> models, middleware/auth.js xác thực và phân quyền. Thêm sách cần category_id tồn tại. Xóa sách có liên kết bị chặn 409; dùng PATCH is_active=false để ngừng bán. Không có script nào xóa database cũ.
