"""
Daily English & Vocab Booster Service.
Provides persistent storage, Daily Words generator, Mini Quiz generator,
and custom vocabulary management using SQLite.
"""

import datetime
import json
import logging
import os
from pathlib import Path
import random
import sqlite3
import time
import uuid
from typing import Any, Dict, List, Optional

logger = logging.getLogger("vocab_service")

BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = BASE_DIR / "data"
DATA_DIR.mkdir(parents=True, exist_ok=True)
DB_PATH = DATA_DIR / "vocab.db"

# =============================================================================
# Rich Initial Seed Vocabulary (Tech & Networking, Workplace, Daily Life)
# =============================================================================
SEED_VOCABULARY = [
    # ---------------- Tech & Networking & System ----------------
    {
        "word": "Latency",
        "phonetic": "/ˈleɪ.tən.si/",
        "part_of_speech": "Noun",
        "meaning_vi": "Độ trễ, khoảng thời gian trễ trong việc truyền dữ liệu qua mạng",
        "example_en": "High network latency can cause severe lag in real-time telemetry streaming.",
        "example_vi": "Độ trễ mạng cao có thể gây giật lag nghiêm trọng trong việc truyền dữ liệu đo thời gian thực.",
        "category": "Tech & Networking"
    },
    {
        "word": "Throughput",
        "phonetic": "/ˈθruː.pʊt/",
        "part_of_speech": "Noun",
        "meaning_vi": "Thông lượng, lượng dữ liệu được xử lý hoặc truyền tải thành công trong một đơn vị thời gian",
        "example_en": "We upgraded the network switch to achieve a maximum throughput of 10 Gbps.",
        "example_vi": "Chúng tôi đã nâng cấp bộ chuyển mạch mạng để đạt thông lượng tối đa 10 Gbps.",
        "category": "Tech & Networking"
    },
    {
        "word": "Redundancy",
        "phonetic": "/rɪˈdʌn.dən.si/",
        "part_of_speech": "Noun",
        "meaning_vi": "Tính dự phòng, khả năng sao lưu dự phòng để tránh sập hệ thống khi có sự cố",
        "example_en": "Hardware redundancy ensures the server remains operational even if one power supply fails.",
        "example_vi": "Tính dự phòng phần cứng đảm bảo máy chủ vẫn hoạt động ngay cả khi một bộ nguồn gặp sự cố.",
        "category": "Tech & Networking"
    },
    {
        "word": "Bottleneck",
        "phonetic": "/ˈbɒt.əl.nek/",
        "part_of_speech": "Noun",
        "meaning_vi": "Điểm nghẽn, nút thắt cổ chai làm chậm toàn bộ quy trình hoặc hệ thống",
        "example_en": "Disk I/O speed is currently the main bottleneck affecting database performance.",
        "example_vi": "Tốc độ đọc/ghi ổ đĩa hiện là điểm nghẽn chính ảnh hưởng đến hiệu năng cơ sở dữ liệu.",
        "category": "Tech & Networking"
    },
    {
        "word": "Resilience",
        "phonetic": "/rɪˈzɪl.jəns/",
        "part_of_speech": "Noun",
        "meaning_vi": "Khả năng phục hồi, độ bền bỉ tự khắc phục sự cố của hệ thống",
        "example_en": "Building system resilience allows our infrastructure to survive sudden traffic spikes.",
        "example_vi": "Xây dựng khả năng phục hồi hệ thống giúp hạ tầng của chúng ta đứng vững trước các đợt tăng vọt lưu lượng bất ngờ.",
        "category": "Tech & Networking"
    },
    {
        "word": "Asynchronous",
        "phonetic": "/eɪˈsɪŋ.krə.nəs/",
        "part_of_speech": "Adjective",
        "meaning_vi": "Bất đồng bộ (không chặn luồng xử lý, tiếp tục công việc khác trong lúc chờ kết quả)",
        "example_en": "Python FastAPI utilizes asynchronous coroutines to handle thousands of concurrent requests.",
        "example_vi": "Python FastAPI sử dụng các hàm coroutine bất đồng bộ để xử lý hàng ngàn yêu cầu đồng thời.",
        "category": "Tech & Networking"
    },
    {
        "word": "Idempotent",
        "phonetic": "/ˌaɪ.dəmˈpoʊ.tənt/",
        "part_of_speech": "Adjective",
        "meaning_vi": "Tính bất biến khi lặp lại (thực hiện nhiều lần cho ra cùng một kết quả mà không gây lỗi)",
        "example_en": "HTTP PUT and DELETE methods are designed to be idempotent.",
        "example_vi": "Các phương thức HTTP PUT và DELETE được thiết kế để có tính bất biến khi lặp lại.",
        "category": "Tech & Networking"
    },
    {
        "word": "Scalability",
        "phonetic": "/ˌskeɪ.ləˈbɪl.ə.ti/",
        "part_of_speech": "Noun",
        "meaning_vi": "Khả năng mở rộng quy mô (theo chiều ngang hoặc chiều dọc)",
        "example_en": "Microservices architecture improves the horizontal scalability of modern web applications.",
        "example_vi": "Kiến trúc microservices cải thiện khả năng mở rộng theo chiều ngang của các ứng dụng web hiện đại.",
        "category": "Tech & Networking"
    },
    {
        "word": "Failover",
        "phonetic": "/ˈfeɪl.oʊ.vər/",
        "part_of_speech": "Noun",
        "meaning_vi": "Chuyển đổi dự phòng tự động sang máy chủ phụ khi máy chủ chính gặp sự cố",
        "example_en": "The automated failover mechanism switched traffic to the standby cluster in under two seconds.",
        "example_vi": "Cơ chế chuyển đổi dự phòng tự động đã chuyển lưu lượng sang cụm máy chủ phụ trong chưa đầy hai giây.",
        "category": "Tech & Networking"
    },
    {
        "word": "Telemetry",
        "phonetic": "/təˈlem.ə.tri/",
        "part_of_speech": "Noun",
        "meaning_vi": "Dữ liệu đo lường từ xa, hệ thống thu thập số liệu tự động",
        "example_en": "The dashboard gathers real-time CPU, RAM, and disk telemetry from the operating system.",
        "example_vi": "Trang điều khiển thu thập số liệu đo lường từ xa thời gian thực về CPU, RAM và ổ đĩa từ hệ điều hành.",
        "category": "Tech & Networking"
    },
    {
        "word": "Deployment",
        "phonetic": "/dɪˈplɔɪ.mənt/",
        "part_of_speech": "Noun",
        "meaning_vi": "Triển khai phần mềm lên môi trường chạy thực tế (Production)",
        "example_en": "Continuous integration pipelines automate testing and deployment for every git commit.",
        "example_vi": "Quy trình CI tự động hóa việc kiểm thử và triển khai cho mỗi lượt commit trên git.",
        "category": "Tech & Networking"
    },
    {
        "word": "Deprecated",
        "phonetic": "/ˈdep.rə.keɪ.tɪd/",
        "part_of_speech": "Adjective",
        "meaning_vi": "Bị phản đối / không còn khuyến khích sử dụng và sẽ bị xóa trong tương lai",
        "example_en": "This legacy API method is deprecated and should be replaced with the modern v2 endpoint.",
        "example_vi": "Phương thức API cũ này đã bị ngừng khuyến khích và nên được thay thế bằng endpoint v2 hiện đại.",
        "category": "Tech & Networking"
    },
    {
        "word": "Concurrency",
        "phonetic": "/kənˈkʌr.ən.si/",
        "part_of_speech": "Noun",
        "meaning_vi": "Tính đồng thời, khả năng thực hiện nhiều tác vụ cùng một khoảng thời gian",
        "example_en": "Handling high concurrency requires efficient thread pools and asynchronous event loops.",
        "example_vi": "Xử lý mức độ đồng thời cao đòi hỏi các pool luồng hiệu quả và vòng lặp sự kiện bất đồng bộ.",
        "category": "Tech & Networking"
    },
    {
        "word": "Bandwidth",
        "phonetic": "/ˈbænd.wɪtθ/",
        "part_of_speech": "Noun",
        "meaning_vi": "Băng thông mạng, tốc độ truyền tải dữ liệu tối đa của đường truyền",
        "example_en": "Video streaming consumes a considerable amount of network bandwidth.",
        "example_vi": "Xem video trực tuyến tiêu tốn một lượng băng thông mạng đáng kể.",
        "category": "Tech & Networking"
    },
    {
        "word": "Encapsulation",
        "phonetic": "/ɪnˌkæp.sjəˈleɪ.ʃən/",
        "part_of_speech": "Noun",
        "meaning_vi": "Tính đóng gói (che giấu chi tiết cài đặt bên trong và chỉ phơi bày giao diện cần thiết)",
        "example_en": "Encapsulation is one of the fundamental pillars of object-oriented programming.",
        "example_vi": "Tính đóng gói là một trong những trụ cột cơ bản của lập trình hướng đối tượng.",
        "category": "Tech & Networking"
    },

    # ---------------- Workplace & Business Communication ----------------
    {
        "word": "Proactive",
        "phonetic": "/prəʊˈæk.tɪv/",
        "part_of_speech": "Adjective",
        "meaning_vi": "Chủ động, đi trước đón đầu thay vì chờ sự việc xảy ra mới phản ứng",
        "example_en": "Taking a proactive approach to system maintenance prevents unexpected downtime.",
        "example_vi": "Tiếp cận chủ động trong việc bảo trì hệ thống giúp ngăn chặn sự cố sập mạng bất ngờ.",
        "category": "Workplace & Business"
    },
    {
        "word": "Streamline",
        "phonetic": "/ˈstriːm.laɪn/",
        "part_of_speech": "Verb",
        "meaning_vi": "Tinh gọn hóa, tối giản hóa quy trình để đạt hiệu quả cao hơn",
        "example_en": "We need to streamline our onboarding workflow to help new engineers get started faster.",
        "example_vi": "Chúng ta cần tinh gọn quy trình tiếp nhận để giúp các kỹ sư mới bắt đầu công việc nhanh hơn.",
        "category": "Workplace & Business"
    },
    {
        "word": "Mitigate",
        "phonetic": "/ˈmɪt.ɪ.ɡeɪt/",
        "part_of_speech": "Verb",
        "meaning_vi": "Giảm thiểu tác động tiêu cực, xoa dịu rủi ro",
        "example_en": "Regular data backups help mitigate the risk of accidental data loss.",
        "example_vi": "Sao lưu dữ liệu định kỳ giúp giảm thiểu rủi ro mất mát dữ liệu do sơ suất.",
        "category": "Workplace & Business"
    },
    {
        "word": "Prioritize",
        "phonetic": "/praɪˈɒr.ɪ.taɪz/",
        "part_of_speech": "Verb",
        "meaning_vi": "Ưu tiên, sắp xếp thứ tự công việc quan trọng lên hàng đầu",
        "example_en": "You should prioritize critical security patches over minor cosmetic UI tweaks.",
        "example_vi": "Bạn nên ưu tiên các bản vá bảo mật nghiêm trọng trước các chỉnh sửa giao diện nhỏ.",
        "category": "Workplace & Business"
    },
    {
        "word": "Comprehensive",
        "phonetic": "/ˌkɒm.prɪˈhen.sɪv/",
        "part_of_speech": "Adjective",
        "meaning_vi": "Toàn diện, bao quát đầy đủ mọi khía cạnh",
        "example_en": "The team conducted a comprehensive audit of the entire server infrastructure.",
        "example_vi": "Đội ngũ đã thực hiện một cuộc kiểm toán toàn diện toàn bộ hạ tầng máy chủ.",
        "category": "Workplace & Business"
    },
    {
        "word": "Leverage",
        "phonetic": "/ˈliː.vər.ɪdʒ/",
        "part_of_speech": "Verb",
        "meaning_vi": "Tận dụng tối đa nguồn lực, công cụ hoặc lợi thế sẵn có",
        "example_en": "We can leverage AI copilots to speed up code documentation and test generation.",
        "example_vi": "Chúng ta có thể tận dụng các trợ lý AI để tăng tốc viết tài liệu và tạo bộ kiểm thử.",
        "category": "Workplace & Business"
    },
    {
        "word": "Intuitive",
        "phonetic": "/ɪnˈtʃuː.ɪ.tɪv/",
        "part_of_speech": "Adjective",
        "meaning_vi": "Trực quan, dễ hiểu và dễ thao tác mà không cần hướng dẫn phức tạp",
        "example_en": "The new dashboard layout is much more intuitive and user-friendly.",
        "example_vi": "Bố cục dashboard mới trực quan và thân thiện với người dùng hơn rất nhiều.",
        "category": "Workplace & Business"
    },
    {
        "word": "Alignment",
        "phonetic": "/əˈlaɪn.mənt/",
        "part_of_speech": "Noun",
        "meaning_vi": "Sự đồng thuận, nhất quán về mục tiêu và hướng đi giữa các bên",
        "example_en": "We held a sync meeting to ensure complete alignment between product and engineering teams.",
        "example_vi": "Chúng tôi đã tổ chức cuộc họp đồng bộ để đảm bảo sự nhất quán hoàn toàn giữa đội ngũ sản phẩm và kỹ thuật.",
        "category": "Workplace & Business"
    },
    {
        "word": "Feasibility",
        "phonetic": "/ˌfiː.zəˈbɪl.ə.ti/",
        "part_of_speech": "Noun",
        "meaning_vi": "Tính khả thi, khả năng thực tế có thể hoàn thành được",
        "example_en": "Before writing code, we must evaluate the technical feasibility of the proposed architecture.",
        "example_vi": "Trước khi viết code, chúng ta phải đánh giá tính khả thi về mặt kỹ thuật của kiến trúc đề xuất.",
        "category": "Workplace & Business"
    },
    {
        "word": "Actionable",
        "phonetic": "/ˈæk.ʃən.ə.bəl/",
        "part_of_speech": "Adjective",
        "meaning_vi": "Có tính ứng dụng thực tế, có thể bắt tay vào thực hiện được ngay",
        "example_en": "The performance report provided clear, actionable insights for optimization.",
        "example_vi": "Báo cáo hiệu năng đã cung cấp các phân tích sâu sắc, có tính hành động rõ ràng để tối ưu hóa.",
        "category": "Workplace & Business"
    },
    {
        "word": "Deliverable",
        "phonetic": "/dɪˈlɪv.ər.ə.bəl/",
        "part_of_speech": "Noun",
        "meaning_vi": "Sản phẩm bàn giao, kết quả cụ thể phải bàn giao cho khách hàng hoặc sếp",
        "example_en": "The final deliverable includes the source code, API documentation, and deployment guide.",
        "example_vi": "Sản phẩm bàn giao cuối cùng bao gồm mã nguồn, tài liệu API và hướng dẫn triển khai.",
        "category": "Workplace & Business"
    },
    {
        "word": "Stakeholder",
        "phonetic": "/ˈsteɪkˌhəʊl.dər/",
        "part_of_speech": "Noun",
        "meaning_vi": "Các bên liên quan (khách hàng, nhà đầu tư, người sử dụng, đối tác)",
        "example_en": "We need to communicate the project delay to key stakeholders as soon as possible.",
        "example_vi": "Chúng ta cần thông báo việc dự án bị chậm tiến độ cho các bên liên quan chủ chốt càng sớm càng tốt.",
        "category": "Workplace & Business"
    },
    {
        "word": "Benchmark",
        "phonetic": "/ˈbentʃ.mɑːk/",
        "part_of_speech": "Noun / Verb",
        "meaning_vi": "Tiêu chuẩn đánh giá chuẩn mực / Thực hiện đo đạc so sánh hiệu năng",
        "example_en": "We benchmarked our FastAPI server against Node.js to evaluate response latency.",
        "example_vi": "Chúng tôi đã đo đạc đối chuẩn máy chủ FastAPI với Node.js để đánh giá độ trễ phản hồi.",
        "category": "Workplace & Business"
    },
    {
        "word": "Seamless",
        "phonetic": "/ˈsiːm.ləs/",
        "part_of_speech": "Adjective",
        "meaning_vi": "Liền mạch, mượt mà không có bất kỳ trục trặc hay gián đoạn nào",
        "example_en": "The update provided a seamless transition without interrupting any active user sessions.",
        "example_vi": "Bản cập nhật đã mang lại sự chuyển đổi liền mạch mà không làm gián đoạn phiên người dùng đang chạy.",
        "category": "Workplace & Business"
    },

    # ---------------- General English & Daily Idioms ----------------
    {
        "word": "Hit the ground running",
        "phonetic": "/hɪt ðə ɡraʊnd ˈrʌn.ɪŋ/",
        "part_of_speech": "Idiom",
        "meaning_vi": "Bắt tay vào việc một cách đầy năng lượng và hiệu quả ngay từ giây phút đầu tiên",
        "example_en": "With his solid background, he was able to hit the ground running on day one.",
        "example_vi": "Với nền tảng vững chắc, anh ấy đã có thể bắt nhịp công việc hiệu quả ngay từ ngày đầu tiên.",
        "category": "Daily Life"
    },
    {
        "word": "Touch base",
        "phonetic": "/tʌtʃ beɪs/",
        "part_of_speech": "Idiom",
        "meaning_vi": "Liên lạc nhanh, trao đổi ngắn gọn để cập nhật tình hình",
        "example_en": "Let's touch base tomorrow morning before the client presentation.",
        "example_vi": "Hãy trao đổi nhanh vào sáng mai trước buổi thuyết trình với khách hàng nhé.",
        "category": "Daily Life"
    },
    {
        "word": "In a nutshell",
        "phonetic": "/ɪn ə ˈnʌt.ʃel/",
        "part_of_speech": "Idiom",
        "meaning_vi": "Tóm lại một cách ngắn gọn, súc tích",
        "example_en": "In a nutshell, the server crash was caused by an out-of-memory error.",
        "example_vi": "Tóm lại một cách ngắn gọn, việc sập máy chủ là do lỗi tràn bộ nhớ.",
        "category": "Daily Life"
    },
    {
        "word": "Bite the bullet",
        "phonetic": "/baɪt ðə ˈbʊl.ɪt/",
        "part_of_speech": "Idiom",
        "meaning_vi": "Cắn răng chấp nhận đối mặt với một việc khó khăn nhưng không thể tránh khỏi",
        "example_en": "We had to bite the bullet and rewrite the legacy codebase from scratch.",
        "example_vi": "Chúng tôi phải cắn răng chấp nhận viết lại toàn bộ mã nguồn cũ từ đầu.",
        "category": "Daily Life"
    },
    {
        "word": "Think outside the box",
        "phonetic": "/θɪŋk aʊtˈsaɪd ðə bɒks/",
        "part_of_speech": "Idiom",
        "meaning_vi": "Tư duy đột phá, sáng tạo không theo lối mòn cũ",
        "example_en": "To solve complex engineering puzzles, you often have to think outside the box.",
        "example_vi": "Để giải quyết các bài toán kỹ thuật phức tạp, bạn thường phải tư duy đột phá và sáng tạo.",
        "category": "Daily Life"
    },
    {
        "word": "Call it a day",
        "phonetic": "/kɔːl ɪt ə deɪ/",
        "part_of_speech": "Idiom",
        "meaning_vi": "Dừng công việc lại, kết thúc một ngày làm việc",
        "example_en": "We've fixed all critical bugs, so let's call it a day and rest.",
        "example_vi": "Chúng ta đã sửa hết các lỗi nghiêm trọng rồi, hãy kết thúc ngày làm việc và nghỉ ngơi thôi.",
        "category": "Daily Life"
    },
    {
        "word": "Out of the blue",
        "phonetic": "/aʊt əv ðə bluː/",
        "part_of_speech": "Idiom",
        "meaning_vi": "Bất thình lình, hoàn toàn bất ngờ không báo trước",
        "example_en": "Out of the blue, the monitoring system triggered a high CPU alert.",
        "example_vi": "Bất thình lình, hệ thống giám sát đã kích hoạt cảnh báo CPU quá tải.",
        "category": "Daily Life"
    },
    {
        "word": "Piece of cake",
        "phonetic": "/piːs əv keɪk/",
        "part_of_speech": "Idiom",
        "meaning_vi": "Dễ như ăn bánh, việc vô cùng đơn giản",
        "example_en": "Installing the project dependencies with python virtual environment was a piece of cake.",
        "example_vi": "Cài đặt các gói phụ thuộc dự án bằng môi trường ảo python quả là dễ như ăn bánh.",
        "category": "Daily Life"
    },
    {
        "word": "Once in a blue moon",
        "phonetic": "/wʌns ɪn ə bluː muːn/",
        "part_of_speech": "Idiom",
        "meaning_vi": "Rất hiếm khi, năm thì mười họa mới xảy ra một lần",
        "example_en": "A zero-day security exploit like this only happens once in a blue moon.",
        "example_vi": "Một lỗ hổng bảo mật zero-day nghiêm trọng như thế này năm thì mười họa mới xảy ra một lần.",
        "category": "Daily Life"
    },
    {
        "word": "Break the ice",
        "phonetic": "/breɪk ði aɪs/",
        "part_of_speech": "Idiom",
        "meaning_vi": "Phá vỡ sự ngại ngùng ban đầu, làm bầu không khí trở nên thân thiện cởi mở",
        "example_en": "The team leader told a funny story to break the ice during the kickoff meeting.",
        "example_vi": "Trưởng nhóm đã kể một câu chuyện vui để phá vỡ sự ngại ngùng trong cuộc họp khởi động dự án.",
        "category": "Daily Life"
    },
    {
        "word": "Perseverance",
        "phonetic": "/ˌpɜː.sɪˈvɪə.rəns/",
        "part_of_speech": "Noun",
        "meaning_vi": "Tính kiên trì, bền bỉ theo đuổi mục tiêu dù gặp nhiều trở ngại",
        "example_en": "Debugging complex race conditions requires patience and perseverance.",
        "example_vi": "Tìm và sửa lỗi tranh chấp tài nguyên phức tạp đòi hỏi sự kiên nhẫn và tính kiên trì bền bỉ.",
        "category": "General English"
    },
    {
        "word": "Versatile",
        "phonetic": "/ˈvɜː.sə.taɪl/",
        "part_of_speech": "Adjective",
        "meaning_vi": "Đa năng, linh hoạt, có thể thích ứng với nhiều mục đích khác nhau",
        "example_en": "Python is a versatile programming language suitable for web, data science, and automation.",
        "example_vi": "Python là ngôn ngữ lập trình đa năng phù hợp cho web, khoa học dữ liệu và tự động hóa.",
        "category": "General English"
    },
    {
        "word": "Exemplary",
        "phonetic": "/ɪɡˈzem.plər.i/",
        "part_of_speech": "Adjective",
        "meaning_vi": "Mẫu mực, xuất sắc đáng làm tấm gương noi theo",
        "example_en": "She wrote exemplary code that followed every best practice in software engineering.",
        "example_vi": "Cô ấy đã viết đoạn mã nguồn mẫu mực tuân thủ mọi quy chuẩn tốt nhất trong kỹ nghệ phần mềm.",
        "category": "General English"
    },
    {
        "word": "Pragmatic",
        "phonetic": "/præɡˈmæt.ɪk/",
        "part_of_speech": "Adjective",
        "meaning_vi": "Thực tế, thực dụng, dựa trên kết quả thực tế thay vì lý thuyết suông",
        "example_en": "We took a pragmatic approach and chose the simplest architecture that solved the user's problem.",
        "example_vi": "Chúng tôi đã chọn cách tiếp cận thực tế và lựa chọn kiến trúc đơn giản nhất giúp giải quyết bài toán của người dùng.",
        "category": "General English"
    }
]


class VocabService:
    def __init__(self, db_path: Path = DB_PATH):
        self.db_path = db_path
        self._init_db()

    def _get_connection(self) -> sqlite3.Connection:
        conn = sqlite3.connect(str(self.db_path), timeout=10)
        conn.row_factory = sqlite3.Row
        return conn

    def _init_db(self):
        """Initialize database schema and populate seed data if empty."""
        try:
            with self._get_connection() as conn:
                cursor = conn.cursor()
                cursor.execute("""
                    CREATE TABLE IF NOT EXISTS vocab (
                        id TEXT PRIMARY KEY,
                        word TEXT NOT NULL,
                        phonetic TEXT,
                        part_of_speech TEXT,
                        meaning_vi TEXT NOT NULL,
                        example_en TEXT,
                        example_vi TEXT,
                        category TEXT NOT NULL,
                        learned INTEGER DEFAULT 0,
                        review_count INTEGER DEFAULT 0,
                        last_reviewed_at TEXT,
                        created_at TEXT
                    )
                """)
                cursor.execute("""
                    CREATE TABLE IF NOT EXISTS vocab_meta (
                        key TEXT PRIMARY KEY,
                        value TEXT
                    )
                """)
                conn.commit()

                # Check if vocabulary is empty, seed initial records
                cursor.execute("SELECT COUNT(*) AS total FROM vocab")
                count = cursor.fetchone()["total"]
                if count == 0:
                    logger.info("Vocab database is empty. Seeding initial vocabulary records...")
                    now_str = datetime.datetime.now().isoformat()
                    for item in SEED_VOCABULARY:
                        item_id = str(uuid.uuid4())[:8]
                        cursor.execute("""
                            INSERT INTO vocab (
                                id, word, phonetic, part_of_speech, meaning_vi,
                                example_en, example_vi, category, learned, review_count,
                                last_reviewed_at, created_at
                            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0, NULL, ?)
                        """, (
                            item_id,
                            item.get("word", "").strip(),
                            item.get("phonetic", "").strip(),
                            item.get("part_of_speech", "Noun").strip(),
                            item.get("meaning_vi", "").strip(),
                            item.get("example_en", "").strip(),
                            item.get("example_vi", "").strip(),
                            item.get("category", "General English").strip(),
                            now_str
                        ))
                    conn.commit()
                    logger.info(f"Seeded {len(SEED_VOCABULARY)} vocabulary records successfully.")
        except Exception as e:
            logger.error(f"Failed to initialize vocab database: {e}", exc_info=True)

    def get_today_words(self, limit: int = 5) -> List[Dict[str, Any]]:
        """
        Fetch daily words. Uses date-based stable seeding or unlearned priority
        so the user gets a fresh set of 3-5 words each day.
        """
        try:
            today_str = datetime.date.today().isoformat()
            # Deterministic daily seed based on date string
            seed_val = int(today_str.replace("-", ""))

            with self._get_connection() as conn:
                cursor = conn.cursor()
                cursor.execute("SELECT * FROM vocab ORDER BY learned ASC, review_count ASC")
                rows = [dict(r) for r in cursor.fetchall()]

                if not rows:
                    return []

                # Split into unlearned and learned
                unlearned = [r for r in rows if not r["learned"]]
                learned = [r for r in rows if r["learned"]]

                # Use random with daily seed to shuffle deterministic order
                rng = random.Random(seed_val)
                rng.shuffle(unlearned)
                rng.shuffle(learned)

                selected = (unlearned + learned)[:limit]
                # Convert boolean for learned
                for item in selected:
                    item["learned"] = bool(item["learned"])
                return selected
        except Exception as e:
            logger.error(f"Error fetching today words: {e}")
            return []

    def get_all(
        self,
        category: Optional[str] = None,
        search: Optional[str] = None,
        learned: Optional[bool] = None,
        limit: int = 200,
        offset: int = 0
    ) -> Dict[str, Any]:
        """Fetch all vocabulary with filtering support."""
        try:
            with self._get_connection() as conn:
                cursor = conn.cursor()
                query = "SELECT * FROM vocab WHERE 1=1"
                params: List[Any] = []

                if category and category.lower() != "all":
                    query += " AND category = ?"
                    params.append(category)

                if learned is not None:
                    query += " AND learned = ?"
                    params.append(1 if learned else 0)

                if search and search.strip():
                    term = f"%{search.strip()}%"
                    query += " AND (word LIKE ? OR meaning_vi LIKE ? OR example_en LIKE ?)"
                    params.extend([term, term, term])

                # Get total count for pagination
                count_query = query.replace("SELECT *", "SELECT COUNT(*) AS total")
                cursor.execute(count_query, params)
                total = cursor.fetchone()["total"]

                query += " ORDER BY learned ASC, word ASC LIMIT ? OFFSET ?"
                params.extend([limit, offset])

                cursor.execute(query, params)
                rows = [dict(r) for r in cursor.fetchall()]
                for item in rows:
                    item["learned"] = bool(item["learned"])

                return {
                    "total": total,
                    "items": rows,
                    "limit": limit,
                    "offset": offset
                }
        except Exception as e:
            logger.error(f"Error fetching vocab list: {e}")
            return {"total": 0, "items": []}

    def get_by_id(self, vocab_id: str) -> Optional[Dict[str, Any]]:
        """Get single vocabulary item by ID."""
        try:
            with self._get_connection() as conn:
                cursor = conn.cursor()
                cursor.execute("SELECT * FROM vocab WHERE id = ?", (vocab_id,))
                row = cursor.fetchone()
                if row:
                    item = dict(row)
                    item["learned"] = bool(item["learned"])
                    return item
                return None
        except Exception as e:
            logger.error(f"Error getting vocab {vocab_id}: {e}")
            return None

    def add_word(self, data: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """Add new custom vocabulary item."""
        try:
            item_id = str(uuid.uuid4())[:8]
            word = str(data.get("word", "")).strip()
            if not word:
                return None

            phonetic = str(data.get("phonetic", "")).strip()
            part_of_speech = str(data.get("part_of_speech", "Noun")).strip()
            meaning_vi = str(data.get("meaning_vi", "")).strip()
            example_en = str(data.get("example_en", "")).strip()
            example_vi = str(data.get("example_vi", "")).strip()
            category = str(data.get("category", "General English")).strip()
            now_str = datetime.datetime.now().isoformat()

            with self._get_connection() as conn:
                cursor = conn.cursor()
                cursor.execute("""
                    INSERT INTO vocab (
                        id, word, phonetic, part_of_speech, meaning_vi,
                        example_en, example_vi, category, learned, review_count,
                        last_reviewed_at, created_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0, NULL, ?)
                """, (
                    item_id, word, phonetic, part_of_speech, meaning_vi,
                    example_en, example_vi, category, now_str
                ))
                conn.commit()

            return self.get_by_id(item_id)
        except Exception as e:
            logger.error(f"Error adding vocab: {e}")
            return None

    def update_word(self, vocab_id: str, data: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """Update existing vocabulary item."""
        try:
            existing = self.get_by_id(vocab_id)
            if not existing:
                return None

            word = data.get("word", existing["word"])
            phonetic = data.get("phonetic", existing["phonetic"])
            part_of_speech = data.get("part_of_speech", existing["part_of_speech"])
            meaning_vi = data.get("meaning_vi", existing["meaning_vi"])
            example_en = data.get("example_en", existing["example_en"])
            example_vi = data.get("example_vi", existing["example_vi"])
            category = data.get("category", existing["category"])

            with self._get_connection() as conn:
                cursor = conn.cursor()
                cursor.execute("""
                    UPDATE vocab SET
                        word = ?, phonetic = ?, part_of_speech = ?, meaning_vi = ?,
                        example_en = ?, example_vi = ?, category = ?
                    WHERE id = ?
                """, (word, phonetic, part_of_speech, meaning_vi, example_en, example_vi, category, vocab_id))
                conn.commit()

            return self.get_by_id(vocab_id)
        except Exception as e:
            logger.error(f"Error updating vocab {vocab_id}: {e}")
            return None

    def delete_word(self, vocab_id: str) -> bool:
        """Delete vocabulary item."""
        try:
            with self._get_connection() as conn:
                cursor = conn.cursor()
                cursor.execute("DELETE FROM vocab WHERE id = ?", (vocab_id,))
                conn.commit()
                return cursor.rowcount > 0
        except Exception as e:
            logger.error(f"Error deleting vocab {vocab_id}: {e}")
            return False

    def toggle_learned(self, vocab_id: str) -> Optional[Dict[str, Any]]:
        """Toggle learned status for a word and record review timestamp."""
        try:
            existing = self.get_by_id(vocab_id)
            if not existing:
                return None

            new_status = 0 if existing["learned"] else 1
            now_str = datetime.datetime.now().isoformat()

            with self._get_connection() as conn:
                cursor = conn.cursor()
                cursor.execute("""
                    UPDATE vocab SET
                        learned = ?,
                        review_count = review_count + 1,
                        last_reviewed_at = ?
                    WHERE id = ?
                """, (new_status, now_str, vocab_id))
                conn.commit()

            self._record_streak()
            return self.get_by_id(vocab_id)
        except Exception as e:
            logger.error(f"Error toggling learned status: {e}")
            return None

    def record_reviewed(self, vocab_id: str) -> Optional[Dict[str, Any]]:
        """Increment review counter without changing learned status."""
        try:
            now_str = datetime.datetime.now().isoformat()
            with self._get_connection() as conn:
                cursor = conn.cursor()
                cursor.execute("""
                    UPDATE vocab SET
                        review_count = review_count + 1,
                        last_reviewed_at = ?
                    WHERE id = ?
                """, (now_str, vocab_id))
                conn.commit()

            self._record_streak()
            return self.get_by_id(vocab_id)
        except Exception as e:
            logger.error(f"Error recording review: {e}")
            return None

    def _record_streak(self):
        """Update consecutive study streak days."""
        try:
            today_str = datetime.date.today().isoformat()
            with self._get_connection() as conn:
                cursor = conn.cursor()
                cursor.execute("SELECT value FROM vocab_meta WHERE key = 'last_study_date'")
                row = cursor.fetchone()
                last_date_str = row["value"] if row else None

                cursor.execute("SELECT value FROM vocab_meta WHERE key = 'study_streak'")
                row_streak = cursor.fetchone()
                current_streak = int(row_streak["value"]) if row_streak else 0

                if not last_date_str:
                    current_streak = 1
                elif last_date_str == today_str:
                    # Already studied today, streak stays the same
                    pass
                else:
                    last_date = datetime.date.fromisoformat(last_date_str)
                    today = datetime.date.today()
                    diff = (today - last_date).days
                    if diff == 1:
                        current_streak += 1
                    elif diff > 1:
                        current_streak = 1

                cursor.execute("INSERT OR REPLACE INTO vocab_meta (key, value) VALUES ('last_study_date', ?)", (today_str,))
                cursor.execute("INSERT OR REPLACE INTO vocab_meta (key, value) VALUES ('study_streak', ?)", (str(current_streak),))
                conn.commit()
        except Exception as e:
            logger.warning(f"Failed to record study streak: {e}")

    def get_stats(self) -> Dict[str, Any]:
        """Get summary statistics for header bar."""
        try:
            with self._get_connection() as conn:
                cursor = conn.cursor()
                cursor.execute("SELECT COUNT(*) AS total FROM vocab")
                total = cursor.fetchone()["total"]

                cursor.execute("SELECT COUNT(*) AS learned FROM vocab WHERE learned = 1")
                learned = cursor.fetchone()["learned"]

                cursor.execute("SELECT SUM(review_count) AS total_reviews FROM vocab")
                rev_row = cursor.fetchone()
                total_reviews = rev_row["total_reviews"] if rev_row and rev_row["total_reviews"] else 0

                cursor.execute("SELECT value FROM vocab_meta WHERE key = 'study_streak'")
                streak_row = cursor.fetchone()
                streak = int(streak_row["value"]) if streak_row and streak_row["value"] else 1

                # Categories distribution
                cursor.execute("SELECT category, COUNT(*) AS count FROM vocab GROUP BY category")
                cat_rows = [dict(r) for r in cursor.fetchall()]

                return {
                    "total_words": total,
                    "learned_words": learned,
                    "unlearned_words": max(0, total - learned),
                    "total_reviews": total_reviews,
                    "streak_days": max(1, streak),
                    "categories": cat_rows
                }
        except Exception as e:
            logger.error(f"Error fetching vocab stats: {e}")
            return {
                "total_words": 0,
                "learned_words": 0,
                "unlearned_words": 0,
                "total_reviews": 0,
                "streak_days": 1,
                "categories": []
            }

    def generate_quiz(self, count: int = 4) -> List[Dict[str, Any]]:
        """
        Generate multiple-choice mini quiz questions.
        Supports 2 question types:
        1. Meaning matching: "Nghĩa tiếng Việt của từ 'X' là gì?"
        2. Fill in the blank in example sentence.
        """
        try:
            with self._get_connection() as conn:
                cursor = conn.cursor()
                cursor.execute("SELECT * FROM vocab")
                all_words = [dict(r) for r in cursor.fetchall()]

                if len(all_words) < 4:
                    return []

                # Select random target words for questions
                sample_count = min(count, len(all_words))
                selected_targets = random.sample(all_words, sample_count)
                questions = []

                for idx, target in enumerate(selected_targets):
                    # Randomly decide question type
                    has_example = bool(target.get("example_en") and target["word"].lower() in target["example_en"].lower())
                    q_type = random.choice(["meaning", "blank"]) if has_example else "meaning"

                    # Pick 3 distractors from different words
                    distractors = [w for w in all_words if w["id"] != target["id"]]
                    selected_distractors = random.sample(distractors, min(3, len(distractors)))

                    if q_type == "meaning":
                        question_title = f"Nghĩa tiếng Việt của từ \"{target['word']}\" là gì?"
                        correct_option = target["meaning_vi"]
                        options = [correct_option] + [d["meaning_vi"] for d in selected_distractors]
                        random.shuffle(options)

                        questions.append({
                            "id": f"q-{idx+1}",
                            "type": "meaning",
                            "target_id": target["id"],
                            "word": target["word"],
                            "phonetic": target["phonetic"],
                            "category": target["category"],
                            "question": question_title,
                            "options": options,
                            "correct_answer": correct_option,
                            "explanation": f"💡 <b>{target['word']}</b> ({target['phonetic']}): {target['meaning_vi']}<br><i>VD:</i> {target['example_en']}"
                        })
                    else:
                        # Replace target word in example sentence with blank: ______
                        example = target["example_en"]
                        # Case-insensitive replacement of first occurrence
                        import re
                        blank_sentence = re.sub(re.escape(target["word"]), "______", example, flags=re.IGNORECASE, count=1)

                        question_title = f"Điền từ thích hợp vào chỗ trống:<br><i>\"{blank_sentence}\"</i>"
                        correct_option = target["word"]
                        options = [correct_option] + [d["word"] for d in selected_distractors]
                        random.shuffle(options)

                        questions.append({
                            "id": f"q-{idx+1}",
                            "type": "blank",
                            "target_id": target["id"],
                            "word": target["word"],
                            "phonetic": target["phonetic"],
                            "category": target["category"],
                            "question": question_title,
                            "options": options,
                            "correct_answer": correct_option,
                            "explanation": f"💡 <b>{target['word']}</b> ({target['meaning_vi']})<br><i>Câu hoàn chỉnh:</i> \"{target['example_en']}\"<br><i>Dịch:</i> {target['example_vi']}"
                        })

                return questions
        except Exception as e:
            logger.error(f"Error generating quiz: {e}")
            return []

    def reset_default_seed(self) -> int:
        """Reset database and re-seed all standard words."""
        try:
            with self._get_connection() as conn:
                cursor = conn.cursor()
                cursor.execute("DELETE FROM vocab")
                conn.commit()
            self._init_db()
            return len(SEED_VOCABULARY)
        except Exception as e:
            logger.error(f"Error resetting seed: {e}")
            return 0


# Global singleton instance
vocab_service = VocabService()
