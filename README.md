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

Khi tạo vận đơn, backend lấy shop theo `GHN_SHOP_ID`, chuẩn hóa mã phường/xã (bỏ khoảng trắng) và tra danh mục GHN để gửi rõ tên phường, quận/huyện, tỉnh của người gửi với địa chỉ cũ. Shop dùng địa chỉ mới được gửi `is_new_from_address: true`, độc lập với địa chỉ người nhận. Nếu địa chỉ shop không còn tồn tại, cập nhật địa chỉ lấy hàng trên GHN đúng môi trường staging/production. Đơn đã có `ghn_status: create_failed` có thể thử lại bằng `POST /api/admin/orders/:id/shipment`, không cần đặt đơn mới.

Để nhận trạng thái tự động, đặt `GHN_WEBHOOK_SECRET` trong `.env`, rồi cấu hình GHN webhook URL là `/api/webhooks/ghn/orders` với custom header `x-ghn-webhook-secret` có cùng giá trị. GHN cũng hỗ trợ admin đồng bộ trạng thái thủ công qua API shipment ở trên.

Chạy `database/add_orders.sql` nếu database chưa có bảng `orders`/`order_items`. Với database đã có các bảng đó từ schema cũ, chạy một lần `database/add_ghn_order_fields.sql` để thêm trường địa chỉ GHN và khối lượng snapshot sản phẩm.

### Địa chỉ GHN trong hồ sơ khách hàng

Chạy một lần `database/profile_ghn_address.sql` trên database `cua_hang_sach` để lưu riêng địa chỉ cụ thể, mã/tên tỉnh, mã/tên phường, quận/huyện cho địa chỉ cũ và trạng thái địa giới. API `GET/PATCH /api/auth/me/profile` và API admin sửa profile nhận/trả các trường `shipping_address`, `shipping_province_id`, `shipping_province_name`, `shipping_ward_code`, `shipping_ward_name`, `shipping_district_name`, `shipping_is_new_to_address`. Frontend tải tỉnh và phường qua API GHN hiện có; checkout đọc profile lúc mở và cho khách sửa địa chỉ trước khi đặt.

## API CRUD sách (cần token Admin)

| Method | URL | Công dụng |
|---|---|---|
| GET | /api/admin/books | Danh sách sách |
| GET | /api/admin/books/:id | Chi tiết sách |
| POST | /api/admin/books | Thêm sách |
| POST | /api/admin/books/match | Kiểm tra sách trùng tên, tác giả và nhà xuất bản |
| PATCH | /api/admin/books/:id | Sửa trường được gửi |
| PATCH | /api/admin/books/:id/stock | Cộng số lượng bằng JSON `{"quantity": 5}` |
| PUT | /api/admin/books/:id | Cũng sửa các trường được gửi để tiện test |
| DELETE | /api/admin/books/:id | Xóa sách chưa bị tham chiếu |
| GET | /api/admin/categories | Chỉ đọc danh sách để chọn category_id; không có CRUD thể loại |

Danh sách sách hỗ trợ `?page=1&limit=20&search=abc&category_id=1`, limit tối đa 100.

POST tối thiểu:
```json
{"category_id":1,"title":"Sách mới","price":100000,"weight_grams":300}
```
category_id phải tồn tại. Tùy chọn: description, cover_url (URL http/https), stock_quantity, publisher, publication_year, is_active. Không nhận id/created_at từ body. Sách đã có liên kết tác giả/đơn hàng/review không xóa được (409); ngừng bán bằng PATCH {"is_active":false}. Không tự xóa dữ liệu liên quan.

### Tác giả và tự động bổ sung số lượng

POST/PATCH sách nhận thêm `author_names`, là mảng tên tác giả, ví dụ `{"author_names":["Nguyễn Nhật Ánh","Minh An"]}`. Backend lưu quan hệ qua `authors` và `book_authors`; tên tác giả mới được tạo khi lưu. GET danh sách/chi tiết admin trả cả `author_names` (mảng) và `authors` (chuỗi hiển thị). PATCH không gửi `author_names` sẽ giữ nguyên tác giả hiện tại; gửi mảng rỗng sẽ bỏ liên kết tác giả.

`POST /api/admin/books/match` nhận `title`, `publisher` và `author_names`, trả `data` là sách trùng hoặc `null`. Kiểm tra không ghi dữ liệu. Với nhiều tác giả, thứ tự nhập không ảnh hưởng kết quả; chỉ trùng khi có cùng toàn bộ danh sách tác giả. So sánh bỏ khoảng trắng ở hai đầu và không phân biệt hoa thường, nhưng giữ phân biệt dấu tiếng Việt.

Khi POST thêm sách trùng đủ ba thông tin, backend cộng `stock_quantity` vào sách hiện có trong transaction, không tạo bản ghi sách mới, không thay đổi giá, mô tả, tác giả hay trạng thái ẩn/hiện. Số lượng cần thêm phải lớn hơn 0. Kết quả trả HTTP 200 với `action: "stock_added"`, `quantity_added` và `data` là sách sau khi cộng. Sách mới trả HTTP 201 với `action: "created"`. Việc kiểm tra và cộng số lượng được khóa để hai yêu cầu đồng thời không tạo trùng hoặc làm mất số lượng.

Form admin tự chuyển sang thêm số lượng khi tìm thấy sách trùng. Nút sửa thông tin sách không ghi đè số lượng; dùng nút thêm số lượng để bổ sung. Nếu sửa tên/tác giả/nhà xuất bản thành thông tin của một sách khác, API trả 409 để tránh tạo hai sách giống nhau.


## Nhà xuất bản: publisher và book_publisher

Chạy trong `BE-Book` để nâng cấp database hiện tại và thêm dữ liệu demo:

```powershell
npm run seed:publishers
```

Lệnh này chạy `database/add_publishers.sql` và `database/seed_publishers.sql`. Nếu dùng phpMyAdmin, chạy hai file theo thứ tự đó trong database hiện tại. Bản dump `database/cua_hang_sach.sql` cũng đã chứa phần tạo bảng và seed cho lần import mới.

Bảng `publisher` lưu `id`, `name`, `description`, `website`, thời gian tạo/cập nhật và khóa tên chuẩn hóa. Bảng `book_publisher` có khóa chính `(book_id, publisher_id)` và hai khóa ngoại, cho phép một sách có nhiều nhà xuất bản. Tên không phân biệt hoa thường nhưng có phân biệt dấu tiếng Việt. Không thể xóa nhà xuất bản còn được sách tham chiếu.

Migration chuyển nhà xuất bản từ cột cũ sang bảng mới. Seed thêm 12 nhà xuất bản mẫu và gán giả ngẫu nhiên cho sách chưa có liên kết, giữ các liên kết đã có. Chạy lại không tạo trùng liên kết hoặc thay đổi phân công cũ. Đây là dữ liệu demo, **không phải thông tin nhà xuất bản đã được xác minh của các sách**.

### API công khai

| Method | URL | Công dụng |
|---|---|---|
| GET | `/api/publishers` | Danh sách, hỗ trợ `page`, `limit`, `search` |
| GET | `/api/publishers/:id` | Chi tiết nhà xuất bản |
| GET | `/api/publishers/:id/books` | Sách đang hiển thị của nhà xuất bản |
| GET | `/api/books/:id/publishers` | Nhà xuất bản của sách đang hiển thị |

`GET /api/books?publisher_id=1` lọc theo nhà xuất bản, kết hợp được tìm kiếm, thể loại, giá, còn hàng và sắp xếp. `book_count` trên API công khai chỉ đếm sách đang hiển thị.

### API admin, cần Bearer token

| Method | URL | Body / công dụng |
|---|---|---|
| GET | `/api/admin/publishers` | Danh sách, có phân trang và tìm kiếm |
| GET | `/api/admin/publishers/:id` | Chi tiết, đếm cả sách đang ẩn |
| POST | `/api/admin/publishers` | `name` bắt buộc, `description` và `website` tùy chọn |
| PATCH / PUT | `/api/admin/publishers/:id` | Sửa các trường được gửi |
| DELETE | `/api/admin/publishers/:id` | Xóa nếu chưa được liên kết, ngược lại trả 409 |
| GET | `/api/admin/publishers/:id/books` | Danh sách sách của nhà xuất bản |
| GET | `/api/admin/books/:id/publishers` | Nhà xuất bản đang liên kết với sách |
| POST | `/api/admin/books/:id/publishers` | `{"publisher_id": 1}` thêm một liên kết, không tạo trùng |
| PUT | `/api/admin/books/:id/publishers` | `{"publisher_ids": [1, 2]}` thay toàn bộ danh sách |
| DELETE | `/api/admin/books/:id/publishers/:publisherId` | Gỡ một liên kết |

Ví dụ tạo nhà xuất bản:

```json
{"name":"Nhà xuất bản Mộc","description":"Giới thiệu nhà xuất bản","website":"https://example.com"}
```

API thêm/sửa/kiểm tra trùng sách nhận **một** trong ba cách: `publisher_ids: [1, 2]`, `publisher_names: ["NXB A", "NXB B"]`, hoặc chuỗi `publisher: "NXB A"` để tương thích client cũ. Không gửi nhiều cách cùng lúc. Tên chưa có được tạo khi lưu sách, còn API kiểm tra trùng không tạo dữ liệu. Gửi mảng rỗng để gỡ toàn bộ nhà xuất bản khi sửa.

API sách trả thêm `publishers` (mảng thông tin), `publisher_ids`, `publisher_names`; `publisher` là chuỗi hiển thị. Cột `books.publisher` được giữ làm cache tên nhà xuất bản đầu tiên để tương thích, các API cập nhật liên kết/đổi tên tự đồng bộ cache. Khi đọc và kiểm tra sách trùng, bảng liên kết là nguồn dữ liệu chính. Với nhiều nhà xuất bản, phải trùng toàn bộ tập hợp tên, không phụ thuộc thứ tự, để tự cộng số lượng. Sửa liên kết dẫn đến trùng một sách khác trả 409.

Trong form thêm/sửa sách, chọn một hoặc nhiều nhà xuất bản từ dropdown có tìm kiếm. Có thể tạo nhà xuất bản mới ngay trong form, mục vừa tạo sẽ được chọn tự động. API vẫn nhận `publisher_names` hoặc `publisher_ids`; không dùng chuỗi hiển thị phân tách bằng dấu phẩy làm đầu vào cho nhiều nhà xuất bản.

### Tác giả trong admin

`GET /api/admin/authors` hỗ trợ `page`, `limit` (tối đa 100) và `search`. `GET /api/admin/authors/:id` trả chi tiết tác giả. `POST /api/admin/authors` nhận `name` bắt buộc và `biography` tùy chọn để thêm tác giả; tên trùng sau khi bỏ khoảng trắng đầu/cuối và không phân biệt hoa thường trả 409. Các API này yêu cầu token admin.

Ví dụ:

```json
{"name":"Nguyễn Nhật Ánh","biography":"Giới thiệu tác giả"}
```

API thêm/sửa/kiểm tra trùng sách nhận `author_ids: [1, 2]` hoặc `author_names: ["Tên tác giả"]`, không gửi cả hai cùng lúc. Các ID phải tồn tại. GET sách trong admin trả `author_ids` và `author_names` theo cùng thứ tự để điền sẵn dropdown. Gửi mảng rỗng khi sửa sẽ bỏ các liên kết tác giả; không gửi trường tác giả sẽ giữ nguyên. Việc nhận diện sách trùng vẫn dựa trên toàn bộ tập hợp tên tác giả/nhà xuất bản, không phụ thuộc thứ tự chọn.

Menu admin có mục **Tác giả** và **Nhà xuất bản** để tìm kiếm và tạo mới. Form sách dùng dropdown chọn nhiều mục, có tìm kiếm và tải thêm. Nút thêm cạnh mỗi dropdown mở form tạo ngay tại chỗ và tự chọn mục vừa tạo, giữ các lựa chọn đã có. Form lưu sách gửi `author_ids` và `publisher_ids`.

Chạy `npm run test:catalog` để kiểm tra validation tác giả/nhà xuất bản, nhận diện sách trùng và CRUD sách với DB giả lập. Kiểm thử HTTP/MySQL cho tác giả và nhà xuất bản dùng dữ liệu riêng có tiền tố và tự dọn sau khi chạy, cần database đã nâng cấp và một tài khoản admin đang hoạt động:

```powershell
$env:RUN_MYSQL_INTEGRATION = "1"
node --test tests/authors.integration.test.js tests/publishers.integration.test.js
Remove-Item Env:RUN_MYSQL_INTEGRATION
```

Kiểm thử MySQL được bỏ qua mặc định khi chạy `npm test`.

## Postman

Import postman/BooksCRUD.postman_collection.json. Nếu đổi tài khoản trong .env thì sửa collection variables tương ứng. Chạy thứ tự A1 -> A6 -> các request CRUD. Request A2 tự lưu admin_token; A5 lưu customer_token. CRUD dùng admin_token từ collection, không cần copy tay. Có test 401 chưa login và 403 tài khoản khách. Bộ CRUD lấy category_id có sẵn, tạo sách, sửa và xóa chính sách mới tạo.

Nhóm `Publishers and book_publisher` có sẵn ví dụ API mới. Request P01 lưu `publisher_id`, P11 lưu `new_publisher_id`. Điền `publisher_book_id` bằng ID sách muốn thao tác trước khi chạy nhóm liên kết. P22 thay toàn bộ danh sách nhà xuất bản của sách, còn P21/P23 chỉ thêm/gỡ một liên kết.

## Kiểm tra và lưu ý

npm test kiểm tra CRUD và auth qua HTTP với DB giả lập. Chưa chạy tích hợp MySQL thật tại môi trường tạo file; dùng Postman để kiểm tra trên máy bạn. Server mặc định chỉ bind 127.0.0.1. Chưa có UI; route guard React cần làm khi tạo frontend. Không commit .env.

Cấu trúc: routes -> controllers -> models, middleware/auth.js xác thực và phân quyền. Thêm sách cần category_id tồn tại. Xóa sách có liên kết bị chặn 409; dùng PATCH is_active=false để ngừng bán. Không có script nào xóa database cũ.


### Ngày giao dự kiến GHN

Chạy `npm run migrate:delivery` trước khi khởi động bản cập nhật (chạy lại an toàn, không sửa dữ liệu đơn cũ). Backend lưu ngày GHN trả từ API tạo vận đơn và trường `leadtime` của API chi tiết. Khách thấy ngày giao từ trạng thái `processing` (Đang chuẩn bị); `pending`/`confirmed` chỉ hiển thị thông báo chờ. Ghi nhận `processing_started_at` lần đầu chuyển sang chuẩn bị; không tự cộng số ngày cố định từ lúc xác nhận.

Ngày dự kiến được làm mới khi bắt đầu chuẩn bị/đang giao, khi admin đồng bộ GHN, và khi khách mở danh sách/chi tiết đơn đang xử lý (giới hạn mỗi đơn 15 phút). Webhook đổi trạng thái làm mất hiệu lực bản lưu để lần xem tiếp theo lấy lại lịch từ GHN. Lỗi GHN không chặn xem/chuyển trạng thái đơn và giữ ngày gần nhất. Ngày quá hạn hiển thị cảnh báo chờ GHN cập nhật; đơn đã hủy/giao/hoàn hàng không hiển thị lịch giao còn hiệu lực. Hiển thị theo múi giờ Việt Nam.


### Thanh toán COD và VNPAY

Chạy `npm run migrate:payments` trước khi khởi động bản cập nhật. API tạo đơn nhận `payment_method: "cod"`; bỏ trường này mặc định COD để tương thích client cũ. `payment_method: "vnpay"` chuyển sang luồng thanh toán trực tuyến; phương thức khác trả 400. Client không được gửi giá, số tiền thu hộ, trạng thái thanh toán hoặc ngày thanh toán.

Đơn COD mới có `payment_status: unpaid`. Admin xác nhận giao thành công hoặc GHN báo `delivered` qua webhook/đồng bộ sẽ ghi `paid` và `paid_at`; hủy/hoàn trước khi thu tiền chuyển `cancelled`. Sự kiện lặp không ghi lại thời điểm thu tiền và không tự hoàn tiền đã thu. Admin chỉ đánh dấu Đã giao sau khi giao và thu tiền thực tế thành công.

Tiền thu hộ `cod_amount` là tiền sách sau giảm giá. `GHN_PAYMENT_TYPE_ID=2` để GHN thu thêm phí giao hàng từ người nhận, không cộng phí ship vào tiền thu hộ lần nữa. `payment_method` khác với `payment_type_id` (bên trả phí vận chuyển của GHN). Màn hình đặt đơn chọn sẵn COD và cho phép chọn VNPAY. Khách và admin thấy phương thức, trạng thái và thời điểm thanh toán.

Migration gán COD cho đơn cũ, nhận diện đơn đã giao/đã hủy từ trạng thái hiện có; đơn đã giao cũ không có thời điểm thu tiền xác thực nên `paid_at` để NULL. Chạy lại migration không đổi trạng thái đã có.


### Tích hợp VNPAY sandbox tại local

Chạy `npm run migrate:vnpay` để tạo bảng lưu các lần thanh toán (chạy lại an toàn). Backend hỗ trợ các biến hiện có `vnp_TmnCode`, `vnp_HashSecret`, `vnp_Url`. Không đưa secret vào frontend hoặc commit .env. Cấu hình local:

```dotenv
VNP_RETURN_URL=http://localhost:3000/api/payments/vnpay/return
VNP_FRONTEND_URL=http://localhost:5173
```

Khách chọn VNPAY khi đặt đơn. Backend chốt giá/giảm giá từ DB, xem trước phí GHN rồi ký URL VNPAY 2.1.0 bằng HMAC-SHA512 với số tiền nhân 100 và thời hạn 15 phút (giờ Việt Nam). VNPAY thanh toán cả tiền sách sau giảm giá và phí ship. Không tạo vận đơn trước khi thanh toán; sau khi được xác nhận trả tiền, admin xác nhận đơn và tạo vận đơn như bình thường. Đơn VNPAY có COD 0, GHN thu phí vận chuyển từ shop (payment_type_id 1) để khách không trả lần nữa. Giá đã thu và phí ship đã báo được giữ nguyên nếu phí GHN thực tế thay đổi; phần chênh lệch do cửa hàng xử lý.

API dành cho khách đã đăng nhập:

- `POST /api/orders/:id/payments/vnpay`: tạo/lấy lại liên kết; body rỗng. Chỉ chủ đơn được gọi, số tiền đọc từ DB.
- `POST /api/orders/:id/payments/vnpay/check`: đối soát qua QueryDR server-to-server rồi trả đơn hiện tại. Có thể dùng ngay tại localhost; chữ ký phản hồi, mã merchant, tham chiếu, loại giao dịch và số tiền đều được kiểm tra.

VNPAY gọi `GET /api/payments/vnpay/return` để đưa trình duyệt về frontend. Return chỉ hiển thị hướng dẫn; không ghi nhận đã thanh toán. Frontend tự gọi API check khi khách quay lại, hoặc khách bấm Kiểm tra thanh toán. `GET /api/payments/vnpay/ipn` là endpoint server-to-server để VNPAY xác nhận khi có domain/HTTPS công khai. Sau này đăng ký IPN URL công khai đó ở VNPAY; localhost chưa nhận được IPN từ Internet. Cả IPN và QueryDR dùng cùng luồng đối chiếu và transaction DB, chống callback lặp.

Nếu VNPAY chưa có kết quả/đang lỗi, đơn giữ trạng thái chưa thanh toán, không được xác nhận hay giao. Nếu liên kết hết hạn, bấm Kiểm tra thanh toán; khi VNPAY xác nhận không tìm thấy giao dịch sau thời hạn ít nhất 2 phút, liên kết cũ được đánh dấu hết hạn để có thể tạo lại. Không tạo liên kết thứ hai khi kết quả cũ chưa rõ. Đơn chờ thanh toán vẫn giữ tồn kho/mã giảm giá; admin hủy đơn chưa trả tiền để giải phóng.

Đơn đã thanh toán không tự hủy/hoàn tiền. Kết quả thành công đến sau khi đơn bị hủy hoặc một lần thanh toán thứ hai được ghi nhận sẽ chuyển sang `refund_required`, không tự gửi hàng; giao dịch nghi ngờ/đảo tiền chuyển `review_required`. Hai trạng thái này cần cửa hàng đối soát, chức năng hoàn tiền tự động chưa triển khai.

Kiểm thử: `node --test tests/vnpay.service.test.js`; kiểm thử HTTP/MySQL rollback đặt `RUN_VNPAY_MYSQL_TEST=1` rồi chạy `node --test tests/vnpay.integration.test.js`.


#### VNPAY sandbox trả QueryDR mã 99 tại local

Mã 99 là lỗi đối soát của VNPAY, không có nghĩa là thanh toán thất bại. Với môi trường thử nghiệm local có thể bật `VNP_LOCAL_RETURN_CONFIRM=true` trong .env. Chế độ này chỉ được phép khi cổng thanh toán là sandbox và Return URL là localhost/127.0.0.1; dùng với production hoặc domain công khai sẽ bị từ chối cấu hình.

Khi bật, backend dùng kết quả Return đã xác thực HMAC, merchant, tham chiếu, mã giao dịch và số tiền để ghi nhận kết quả trong transaction; cùng cơ chế chống trùng của IPN. Kết quả không hợp lệ không được cập nhật. Việc này dành riêng cho chạy thử local khi chưa có IPN và QueryDR sandbox lỗi; production vẫn phải xác nhận qua IPN/QueryDR theo tài liệu VNPAY. Không coi mã 99 hay lời báo thành công trên trình duyệt là bằng chứng thanh toán.

Nếu khách đã thanh toán trước bản sửa, không thanh toán lại: khởi động lại backend, quay về trang kết quả giao dịch VNPAY và chọn Quay về website để gửi lại Return có chữ ký. Nếu không còn URL/kết quả có chữ ký thì cần đối soát từ VNPAY; hệ thống không tự gán Đã thanh toán cho đơn cũ.


### Hiển thị và lọc đơn hàng của khách

`GET /api/orders` hỗ trợ `status`, `payment_status`, `payment_method`, `search` (mã đơn, tối đa 100 ký tự), cùng `page`/`limit`. Bộ lọc kết hợp bằng AND, áp dụng trước khi đếm tổng/phân trang; user_id luôn lấy từ JWT. API admin danh sách đơn cũng hỗ trợ các bộ lọc này.

Sau khi quay về từ VNPAY, trang đơn hàng kiểm tra kết quả từ backend rồi hiện thông báo mã đơn, số tiền và trạng thái đơn hiện tại, đồng thời tìm đúng đơn vừa thanh toán. Thanh toán thành công không tự chuyển đơn sang Đã xác nhận. Trang thể hiện tiến trình Chờ xác nhận → Đã xác nhận → Đang chuẩn bị → Đang giao → Đã giao; đơn đã hủy hiện riêng. Trang tự làm mới danh sách mỗi 30 giây khi tab đang hiển thị; có nút làm mới thủ công.


### Dashboard quản trị

Mục Dashboard mở mặc định khi quản trị viên đăng nhập, có chỉ số sản phẩm/tồn kho hiện tại, doanh thu trong kỳ, phí ship, doanh thu sau phí ship và tổng lũy kế. API `GET /api/admin/dashboard?period=month` yêu cầu token admin; customer nhận 403. Các kỳ hỗ trợ: `day`, `week` (thứ Hai), `month`, `quarter`, `year`. Có thể thêm `from=YYYY-MM-DD&to=YYYY-MM-DD` (bao gồm cả ngày kết thúc). Mặc định lần lượt 30 ngày, 12 tuần, 12 tháng, 8 quý, 5 năm; tối đa 400 điểm biểu đồ và khoảng 10 năm. Các kỳ trống trả số 0.

Doanh thu chỉ tính orders.payment_status = paid, loại orders.status = cancelled và GHN cancel/returned. Tổng trước ship là total_amount đã bao gồm giảm giá; số sau ship = total_amount − shipping_fee. Đây không phải lợi nhuận vì chưa trừ giá vốn/chi phí khác. Phí ship dùng số đã lưu trên đơn, với VNPAY là phí đã báo cho khách; các điều chỉnh phí vận chuyển chưa ghi nhận không nằm trong thống kê. Ngày thống kê là paid_at theo múi giờ Việt Nam; đơn cũ thiếu paid_at dùng created_at và hiển thị cảnh báo số đơn tương ứng.

Các thẻ sản phẩm/tồn kho luôn là hiện tại. Sách bán chạy tính số lượng trong đơn đủ điều kiện doanh thu và theo ngày thanh toán; phân bố trạng thái đơn tính theo ngày đặt và bao gồm cả đơn chưa thanh toán. Các truy vấn dashboard đọc trong cùng một transaction để giữ số liệu nhất quán. Không cần migration mới.

Kiểm thử mốc thời gian: `node --test tests/dashboard-periods.test.js`. Kiểm thử SQL/phân quyền có rollback: đặt `RUN_DASHBOARD_MYSQL_TEST=1`, chạy `node --test tests/dashboard.integration.test.js`.


### Hết hạn thanh toán, thông báo, lịch sử, đánh giá và yêu thích

Chạy `npm run migrate:customer-features` rồi khởi động lại backend/frontend. Migration tạo order_events, notifications, wishlists; giữ bảng reviews hiện có nhưng thay 2 trigger cũ kiểm tra payments bằng điều kiện orders.payment_status=paid và đơn đã giao (trạng thái nội bộ hoặc GHN). Đánh giá mới chỉ nhận rating nguyên 1–5 và comment tối đa 2000 ký tự, một đánh giá/người/sách, được sửa/xóa của mình. Không nhận user_id/order_item_id từ client. Đánh giá công khai không trả email/user_id.

Đơn VNPAY mới được giữ 17 phút (link VNPAY tối đa 15 phút + 2 phút đối soát). Tác vụ trong server chạy lần đầu sau 10 giây và mỗi 60 giây, dùng khóa MySQL chống chạy trùng; mỗi đơn chưa rõ kết quả được kiểm tra cách ít nhất 5 phút. Có thể chạy một lượt bằng `npm run expire:payments`. Tác vụ chỉ xử lý đơn pending, unpaid/failed, chưa có vận đơn. Không áp dụng COD.

Hết hạn chỉ hủy sau khi không có giao dịch đang chờ hoặc VNPAY xác nhận giao dịch không tồn tại/thất bại. Hủy chuyển payment_status=expired, ghi expired_at, hoàn tồn kho, lượt flash sale và lượt dùng mã trong cùng transaction, chống hoàn trùng. Nếu QueryDR lỗi (kể cả mã 99), giữ đơn và giữ kho, tạo một thông báo cần đối soát; không suy diễn lỗi kết nối thành chưa thanh toán. Kết quả trả tiền đến sau khi đơn đã hủy được đánh dấu cần hoàn tiền theo luồng VNPAY hiện có. Hạn giữ đơn không được gia hạn vô hạn khi thử lại thanh toán.

Các sự kiện tạo đơn, chuyển trạng thái, tạo vận đơn, cập nhật GHN, kết quả COD/VNPAY và hết hạn được ghi vào lịch sử cùng transaction với thay đổi chính. Thông báo trong ứng dụng được gửi cho chủ đơn, có số chưa đọc, đánh dấu từng mục/tất cả đã đọc, chọn để mở đúng đơn. Không gửi email/SMS. Đơn cũ chỉ có mốc tạo đơn được đánh dấu là dữ liệu trước khi bật lịch sử; không bịa lịch sử trạng thái cũ.

API mới: `GET /api/orders/:id/history` cho chủ đơn, `GET /api/admin/orders/:id/history` cho admin; `GET /api/notifications`, `PATCH /api/notifications/:id/read`, `PATCH /api/notifications/read-all`; `GET /api/wishlist`, `GET/PUT/DELETE /api/wishlist/:bookId`; `GET /api/books/:bookId/reviews` công khai, `GET /api/books/:bookId/review-eligibility` và `PUT/DELETE /api/books/:bookId/review` cho khách đăng nhập. Các danh sách hỗ trợ page/limit. Yêu thích được lưu trên tài khoản, thêm trùng là idempotent; sách ẩn vẫn có thể bỏ yêu thích.

Trên giao diện: chuông thông báo/trái tim ở thanh tài khoản và trang cửa hàng; lịch sử nằm trong chi tiết đơn; nút yêu thích và phần đánh giá nằm ở chi tiết sách; danh sách yêu thích mở lại sách để mua. Trang đơn hiển thị đếm ngược giữ đơn/trạng thái hết hạn.

Kiểm thử tích hợp: đặt `RUN_CUSTOMER_FEATURES_MYSQL_TEST=1`, chạy `node --test tests/customer-features.integration.test.js`; mọi dữ liệu kiểm thử được rollback.
