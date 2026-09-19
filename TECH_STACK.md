# TỔNG HỢP CÔNG NGHỆ & THƯ VIỆN DỰ ÁN SYSTEM PERFORMANCE MONITOR DASHBOARD

Tài liệu này tổng hợp toàn bộ các công nghệ, ngôn ngữ lập trình, thư viện bên thứ 3, các module hệ thống và giao thức được sử dụng để xây dựng hệ thống **Local Dashboard System Monitor & Weather Studio**.

---

## BẢNG DANH MỤC CÔNG NGHỆ, THƯ VIỆN VÀ VAI TRÒ

| Tên | Loại | Version | Vai trò | Thông tin thêm nếu có |
| :--- | :--- | :--- | :--- | :--- |
| **Python** | Ngôn ngữ lập trình | 3.13.x (Hỗ trợ 3.10+) | Ngôn ngữ nền tảng xử lý toàn bộ backend, backend service, tương tác OS và API | Tận dụng cơ chế AsyncIO và typing hiện đại |
| **JavaScript (ES6+)** | Ngôn ngữ lập trình | ECMAScript 2020+ | Xử lý toàn bộ logic client-side, nhận stream WebSocket, vẽ Canvas và điều khiển DOM | Viết theo chuẩn Vanilla JS hướng module, không dùng framework nặng (Zero-bloat) |
| **HTML5** | Ngôn ngữ đánh dấu | HTML5 Living Standard | Cấu trúc ngữ nghĩa trang web (Semantic Markup), các thẻ `<canvas>` cho Diorama và nền hiệu ứng thời tiết | Thiết kế dạng Single Page Application (SPA) gồm 13 Tab giao diện |
| **CSS3** | Ngôn ngữ định kiểu | CSS3 Modern | Tạo phong cách giao diện Dark Cyber, Glassmorphism, 3D Transforms và Keyframe Animations | Hỗ trợ CSS Variables linh hoạt và Parallax 2.5D chiều sâu (`perspective`, `rotateX/Y`) |
| **PowerShell** | Ngôn ngữ kịch bản | 5.1+ / 7+ | Kịch bản tự động hóa mở cổng Windows Defender Firewall cho phép truy cập qua mạng LAN | Cung cấp file thực thi nhanh `allow_lan_firewall.ps1` |
| **FastAPI** | Thư viện / Web Framework | 0.141.1 (Yêu cầu >=0.110.0) | Cung cấp toàn bộ hệ thống REST API, quản lý WebSocket Hub (`/ws/metrics`), Middleware CORS và phục vụ Static Files | Framework nền tảng ASGI hiệu năng cao hàng đầu của Python |
| **Uvicorn [standard]** | Thư viện / ASGI Server | 0.52.4 (Yêu cầu >=0.28.0) | Web server chịu tải cao chạy ứng dụng FastAPI, duy trì luồng WebSocket bền vững và hot-reload | Lắng nghe trên `0.0.0.0:8000` phục vụ cả Localhost lẫn mạng Wi-Fi/LAN |
| **psutil** | Thư viện hệ thống | 7.2.2 (Yêu cầu >=5.9.8) | Trích xuất thông số phần cứng: CPU (từng nhân), RAM, Swap, Disk I/O, Network I/O và Top tiến trình | Cầu nối phần cứng cốt lõi trong `app/metrics.py` |
| **google-genai** | Thư viện / AI SDK | 2.22.0 (Yêu cầu >=2.20.0) | SDK chính thức kết nối Google Gemini API (Gemini 2.5 Flash / Pro) cho trợ lý AI Copilot | Phân tích chẩn đoán sức khỏe PC, tư vấn tối ưu và xử lý lệnh giọng nói |
| **httpx** | Thư viện / HTTP Client | 0.28.1 (Yêu cầu >=0.27.0) | Gửi các HTTP request bất đồng bộ ra Internet (lấy dữ liệu thời tiết thực tế, tải kho hình nền wallpaper) | Không làm nghẽn (non-blocking) Event Loop của FastAPI |
| **Pillow (PIL)** | Thư viện xử lý ảnh | 12.3.0 (Yêu cầu >=10.0.0) | Đọc metadata hình ảnh, resize và tạo ảnh thumbnail xem trước (preview) cho tệp tin tải về | Tích hợp trong `app/media_preview_service.py` |
| **python-dotenv** | Thư viện tiện ích | 1.2.3 (Yêu cầu >=1.0.0) | Tự động đọc và nạp các biến môi trường nhạy cảm từ file `.env` vào `os.environ` | Quản lý an toàn `GEMINI_API_KEY` và cấu hình server |
| **Pydantic** | Thư viện kiểm thực dữ liệu | 2.13.5 (v2.x) | Định nghĩa Schema dữ liệu và kiểm thực (Validation) các request payload gửi lên API | Tự động sinh tài liệu Swagger UI tại `/docs` |
| **Chart.js** | Thư viện Frontend (CDN) | 4.4.2 UMD | Vẽ biểu đồ thời gian thực: Bezier Line Chart 60s CPU/RAM, Donut Chart dung lượng ổ đĩa, Bar Chart ứng dụng | Tích hợp trực tiếp qua CDN jsDelivr, tự động cập nhật mượt mà khi nhận dữ liệu |
| **Google Fonts** | Thư viện phông chữ (CDN) | Latest | Cung cấp font chữ hiện đại: `Plus Jakarta Sans` (UI typography) và `JetBrains Mono` (Hiển thị số liệu, code, IP) | Tối ưu trải nghiệm thị giác chuyên nghiệp, đậm chất công nghệ |
| **HTML5 Canvas 2D API** | Công nghệ đồ họa Web | W3C Standard | Động cơ render mô phỏng vật lý các hạt thời tiết (mưa, tuyết, hoa anh đào, cực quang Aurora) ở tốc độ 60 FPS | 100% procedural vector, tự động dừng khi ẩn tab để CPU/GPU < 0.5% |
| **asyncio** | Module chuẩn Python | Built-in | Quản lý đồng thời bất đồng bộ: Vòng lặp bắn WebSocket 1s/lần, background app tracker và các tác vụ I/O | Trái tim điều phối các luồng chạy ngầm của máy chủ |
| **sqlite3** | Module chuẩn / CSDL nhúng | SQLite 3.x (Built-in) | Hệ quản trị cơ sở dữ liệu quan hệ nhúng file, lưu trữ lịch sử sử dụng ứng dụng, code snippets và từ vựng | Gồm `app_analytics.db`, `snippets.db` và bảng từ vựng, không cần cài server DB |
| **ctypes** | Module chuẩn Python | Built-in | Gọi trực tiếp các hàm Windows Win32 API (`user32.dll`) như `SystemParametersInfoW` (đổi hình nền desktop), theo dõi title cửa sổ đang mở | Tương tác sâu cấp hệ điều hành Windows |
| **subprocess** | Module chuẩn Python | Built-in | Chạy các lệnh CLI hệ thống mạng: `ping` (đo latency), `arp -a` (quét LAN), `ipconfig /flushdns`, dọn dẹp temp files | Tích hợp trong `network_radar.py` và `actions.py` |
| **socket** | Module chuẩn Python | Built-in | Giao tiếp socket mạng mức thấp, tự động dò tìm IP LAN thật của card mạng đang kết nối Internet | Giúp hệ thống tự phát hiện địa chỉ LAN để người dùng truy cập từ điện thoại |
| **xml.etree.ElementTree** | Module chuẩn Python | Built-in | Đọc và phân tích cú pháp dữ liệu XML của các thông báo từ Windows Action Center | Tích hợp trong `app/action_center_reader.py` |
| **WebSocket Protocol** | Giao thức truyền thông | RFC 6455 | Giao thức truyền dữ liệu hai chiều full-duplex liên tục giữa server và client | Đảm bảo độ trễ cập nhật chỉ số phần cứng dưới 10ms |

---

## TỔNG KẾT KIẾN TRÚC HỆ THỐNG (ARCHITECTURE OVERVIEW)

- **Kiến trúc Tổng thể**: Event-driven Client-Server (Full-Stack Realtime Monolith).
- **Backend**: Python 3.13 + FastAPI + Uvicorn + psutil + SQLite + Gemini AI SDK.
- **Frontend**: Vanilla HTML5 + CSS3 (Glassmorphism & 3D Parallax) + JavaScript ES6+ + Chart.js (Zero Framework Overhead).
- **Khả năng mở rộng mạng**: Lắng nghe trên `0.0.0.0:8000`, hỗ trợ tự động nhận diện Dynamic Host IP và mở Windows Firewall để mọi thiết bị trong mạng LAN/Wi-Fi đều truy cập được.
