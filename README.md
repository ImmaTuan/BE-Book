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

POST /api/auth/admin/login với JSON email, password. Sai mật khẩu/khóa tài khoản: 401; đúng tài khoản nhưng role customer: 403. Login trả data.access_token (15 phút), data.refresh_token (30 ngày) và data.user. Trường data.token được giữ tương thích với client cũ.

POST /api/auth/login là login chung cho cả Admin/khách để test; khách vẫn không gọi được /api/admin/*. POST /api/auth/refresh nhận JSON `{"refresh_token":"..."}` và trả cặp token mới; refresh token cũ bị xoay và không dùng lại được. POST /api/auth/logout nhận refresh_token để thu hồi phiên. GET /api/auth/me cần access token, trả tài khoản hiện tại. Mỗi request kiểm tra lại role/is_active từ DB. Không nhận role/user_id từ body khi login.

Gửi header cho mọi /api/admin/*:
```text
Authorization: Bearer <data.token>
```

Không token/token lỗi/hết hạn: 401. Có token khách thường: 403. Đúng Admin: cho truy cập. Health không yêu cầu login. Login/refresh/logout giới hạn 30 lần/15 phút/IP. Chạy `database/add_user_login.sql` một lần để tạo bảng lưu hash refresh token.

## API đơn hàng

Customer gọi `POST /api/orders` để đặt đơn, `GET /api/orders` để xem danh sách đơn của mình, `GET /api/orders/:id` để xem chi tiết đơn của mình. Body tạo đơn gồm `recipient_name`, `recipient_phone`, `shipping_address` và `items` (mảng `{ "book_id": 1, "quantity": 2 }`). Giá sách được lấy từ database; tồn kho được kiểm tra và trừ trong transaction.

Admin gọi `GET /api/admin/orders` (hỗ trợ `page`, `limit`, `status`), `GET /api/admin/orders/:id`, `POST /api/admin/orders/:id/shipment` để tạo/thử lại vận đơn, `GET /api/admin/orders/:id/shipment` để đồng bộ trạng thái từ GHN và `PATCH /api/admin/orders/:id/status` để đổi trạng thái nội bộ. Hủy đơn đã có vận đơn sẽ gọi GHN hủy trước; hủy đơn chưa giao sẽ hoàn tồn kho.

Điền `GHN_TOKEN`, `GHN_SHOP_ID` và các cấu hình trong `.env` (tham khảo `.env.example`). Tài khoản staging cần `GHN_API_URL=https://dev-online-gateway.ghn.vn`; production dùng `https://online-gateway.ghn.vn`. Customer có thể lấy danh sách tỉnh/phường qua `GET /api/shipping/ghn/provinces` và `GET /api/shipping/ghn/provinces/:provinceId/wards`, rồi gửi `to_ward_name` và `to_province_name`; địa chỉ hành chính cũ cần thêm `to_district_name` và `is_new_to_address: false`. GHN yêu cầu token + ShopId ở header, địa chỉ, dịch vụ, kích thước kiện và `required_note` khi tạo vận đơn. Nếu chưa có credentials, đơn nội bộ vẫn được tạo với `ghn_status: not_configured`.

Để nhận trạng thái tự động, đặt `GHN_WEBHOOK_SECRET` trong `.env`, rồi cấu hình GHN webhook URL là `/api/webhooks/ghn/orders` với custom header `x-ghn-webhook-secret` có cùng giá trị. GHN cũng hỗ trợ admin đồng bộ trạng thái thủ công qua API shipment ở trên.

Chạy `database/add_orders.sql` nếu database chưa có bảng `orders`/`order_items`. Với database đã có các bảng đó từ schema cũ, chạy một lần `database/add_ghn_order_fields.sql` để thêm trường địa chỉ GHN và khối lượng snapshot sản phẩm.

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
