import re
import time
from typing import Any, Dict, List, Optional

class AICopilotEngine:
    def __init__(self):
        self._last_insights_cache: Optional[Dict[str, Any]] = None
        self._last_insights_time: float = 0.0
        self._cache_ttl: float = 2.0

    def generate_smart_insights(self, metrics: Dict[str, Any]) -> Dict[str, Any]:
        """Generate human-like smart insights, health score, and proactive suggestions."""
        now = time.time()
        if self._last_insights_cache and (now - self._last_insights_time < self._cache_ttl):
            return self._last_insights_cache

        cpu = metrics.get("cpu", {})
        cpu_pct = cpu.get("overall_percent", 0.0)
        cores = cpu.get("logical_cores", 4)
        ghz = cpu.get("frequency", {}).get("current_ghz") or "--"

        ram = metrics.get("memory", {}).get("ram", {})
        ram_pct = ram.get("percent", 0.0)
        ram_used = ram.get("used_gb", 0.0)
        ram_total = ram.get("total_gb", 0.0)
        ram_free = ram.get("free_gb", 0.0)

        processes = metrics.get("processes", {})
        top_cpu_list = processes.get("by_cpu", [])
        top_ram_list = processes.get("by_ram", [])
        top_cpu = top_cpu_list[0] if top_cpu_list else None
        top_ram = top_ram_list[0] if top_ram_list else None

        disk_summary = metrics.get("disk", {}).get("summary", {})
        disk_pct = disk_summary.get("percent", 0.0)
        partitions = metrics.get("disk", {}).get("partitions", [])

        network = metrics.get("network", {})
        down_kbs = network.get("download_kbs", 0.0)
        up_kbs = network.get("upload_kbs", 0.0)

        # 1. Calculate Overall System Health Score (0 - 100)
        health_score = 100
        issues = []
        suggestions: List[Dict[str, str]] = []

        # CPU evaluation
        if cpu_pct >= 90:
            health_score -= 30
            issues.append(f"CPU critical load ({cpu_pct:.1f}%)")
            top_name = top_cpu["name"] if top_cpu else "Unknown"
            suggestions.append({
                "type": "alert",
                "title": "High CPU Load",
                "text": f"CPU spiked to {cpu_pct:.1f}%, heavily driven by {top_name}."
            })
        elif cpu_pct >= 70:
            health_score -= 15
            issues.append(f"CPU heavy load ({cpu_pct:.1f}%)")
            suggestions.append({
                "type": "warn",
                "title": "Moderate CPU Usage",
                "text": f"CPU is running at {cpu_pct:.1f}% ({ghz} GHz across {cores} cores)."
            })
        else:
            suggestions.append({
                "type": "success",
                "title": "Optimal CPU Load",
                "text": f"CPU is calm at {cpu_pct:.1f}% ({ghz} GHz). Thermal & clock optimal."
            })

        # RAM evaluation
        if ram_pct >= 90:
            health_score -= 30
            issues.append(f"RAM near full ({ram_pct:.1f}%)")
            top_ram_name = top_ram["name"] if top_ram else "apps"
            suggestions.append({
                "type": "alert",
                "title": "Critical RAM Pressure",
                "text": f"RAM is at {ram_pct:.1f}% ({ram_used:.1f}/{ram_total:.1f} GB). Highest used by {top_ram_name}."
            })
        elif ram_pct >= 75:
            health_score -= 10
            top_ram_name = top_ram["name"] if top_ram else "active apps"
            suggestions.append({
                "type": "warn",
                "title": "RAM Pressure",
                "text": f"RAM is at {ram_pct:.1f}%, top memory consumer is {top_ram_name}."
            })
        else:
            suggestions.append({
                "type": "success",
                "title": "Healthy Memory",
                "text": f"RAM is stable with {ram_free:.1f} GB available ({ram_pct:.1f}% used)."
            })

        # Disk evaluation
        for p in partitions:
            if p.get("percent", 0) >= 90:
                health_score -= 15
                drive_name = p.get("mountpoint", "Drive")
                suggestions.append({
                    "type": "alert",
                    "title": f"Low Space on {drive_name}",
                    "text": f"Drive {drive_name} is {p.get('percent')}% full. Use Clean Temp in sidebar to free space."
                })
                break

        # Network evaluation
        if down_kbs > 5120:  # > 5 MB/s
            suggestions.append({
                "type": "info",
                "title": "Active Download Activity",
                "text": f"Network download throughput is high ({down_kbs/1024:.1f} MB/s)."
            })

        health_score = max(10, min(100, health_score))

        if health_score >= 85:
            health_status = "Optimal"
            status_color = "success"
        elif health_score >= 65:
            health_status = "Good"
            status_color = "normal"
        elif health_score >= 45:
            health_status = "Moderate Load"
            status_color = "warn"
        else:
            health_status = "Critical Pressure"
            status_color = "alert"

        # 2. Natural Language AI Insight Sentence
        top_apps_str = ""
        if top_ram and top_cpu:
            if top_ram["name"] == top_cpu["name"]:
                top_apps_str = f"chủ yếu do {top_ram['name']}"
            else:
                top_apps_str = f"chủ yếu do {top_ram['name']} và {top_cpu['name']}"
        elif top_ram:
            top_apps_str = f"chủ yếu do {top_ram['name']}"

        if health_score >= 80:
            summary_vi = f"Hệ thống vận hành mượt mà, CPU ở mức {cpu_pct:.1f}%, RAM chiếm {ram_pct:.1f}% ({top_apps_str})."
            summary_en = f"System operating smoothly. CPU is at {cpu_pct:.1f}%, RAM is at {ram_pct:.1f}% (mainly {top_ram['name'] if top_ram else 'apps'})."
        elif health_score >= 60:
            summary_vi = f"Hệ thống đang có tải vừa phải. RAM đạt {ram_pct:.1f}% ({top_apps_str}), CPU {cpu_pct:.1f}%."
            summary_en = f"System under moderate load. RAM is at {ram_pct:.1f}% ({top_apps_str}), CPU {cpu_pct:.1f}%."
        else:
            summary_vi = f"Hệ thống đang chịu tải nặng: CPU {cpu_pct:.1f}%, RAM {ram_pct:.1f}%. Hãy giải phóng tài nguyên."
            summary_en = f"System under heavy resource pressure: CPU {cpu_pct:.1f}%, RAM {ram_pct:.1f}%."

        result = {
            "health_score": health_score,
            "health_status": health_status,
            "status_color": status_color,
            "summary_vi": summary_vi,
            "summary_en": summary_en,
            "issues": issues,
            "suggestions": suggestions[:2],
            "timestamp": now,
        }

        self._last_insights_cache = result
        self._last_insights_time = now
        return result

    def answer_query(self, question: str, metrics: Dict[str, Any]) -> Dict[str, Any]:
        """Analyze user query and return a smart, contextual AI answer based on live telemetry snapshot."""
        if not question or not question.strip():
            return {
                "answer": "Xin chào! Bạn có thể hỏi tôi bất kỳ câu hỏi nào về hiệu năng PC (ví dụ: 'Tiến trình nào ngốn RAM nhất?', 'CPU có đang cao không?', 'Sức khỏe hệ thống thế nào?').",
                "intent": "greeting",
            }

        q = question.lower().strip()

        cpu = metrics.get("cpu", {})
        cpu_pct = cpu.get("overall_percent", 0.0)
        cpu_ghz = cpu.get("frequency", {}).get("current_ghz") or "--"
        cores = cpu.get("logical_cores", 4)
        physical_cores = cpu.get("physical_cores", 2)

        ram = metrics.get("memory", {}).get("ram", {})
        ram_pct = ram.get("percent", 0.0)
        ram_used = ram.get("used_gb", 0.0)
        ram_total = ram.get("total_gb", 0.0)
        ram_free = ram.get("free_gb", 0.0)

        processes = metrics.get("processes", {})
        top_cpu_list = processes.get("by_cpu", [])
        top_ram_list = processes.get("by_ram", [])
        top_cpu = top_cpu_list[0] if top_cpu_list else None
        top_ram = top_ram_list[0] if top_ram_list else None

        disk = metrics.get("disk", {})
        partitions = disk.get("partitions", [])
        disk_sum = disk.get("summary", {})

        network = metrics.get("network", {})
        down_kbs = network.get("download_kbs", 0.0)
        up_kbs = network.get("upload_kbs", 0.0)
        uptime = metrics.get("uptime", {}).get("uptime_formatted", "00:00:00")
        os_info = metrics.get("os", {})

        # Intent 1: RAM & Memory
        if any(w in q for w in ["ram", "memory", "bộ nhớ", "ngốn ram", "chiếm ram", "ram usage"]):
            if any(w in q for w in ["top", "nhiều nhất", "most", "cao nhất", "tiến trình", "process", "app", "ứng dụng", "ai"]):
                top_5_str = ", ".join([f"{p['name']} ({p['memory_mb']:.0f} MB)" for p in top_ram_list[:3]])
                return {
                    "intent": "top_ram_process",
                    "answer": f"Tiến trình đang ngốn RAM nhiều nhất hiện tại là **{top_ram['name']}** (PID #{top_ram['pid']}) với **{top_ram['memory_mb']:.1f} MB** ({top_ram['memory_percent']:.1f}% RAM).\n\nTop 3 tiến trình chiếm RAM: {top_5_str}.",
                }
            return {
                "intent": "ram_summary",
                "answer": f"Mức sử dụng RAM hiện tại là **{ram_pct:.1f}%** (đã dùng **{ram_used:.1f} GB** / tổng **{ram_total:.1f} GB**). Còn trống **{ram_free:.1f} GB**.",
            }

        # Intent 2: CPU & Processor
        if any(w in q for w in ["cpu", "processor", "vi xử lý", "ngốn cpu", "tải cpu", "nóng", "spike"]):
            if any(w in q for w in ["top", "nhiều nhất", "most", "cao nhất", "tiến trình", "process", "app"]):
                top_5_str = ", ".join([f"{p['name']} ({p['cpu_percent']:.1f}%)" for p in top_cpu_list[:3]])
                return {
                    "intent": "top_cpu_process",
                    "answer": f"Tiến trình đang sử dụng CPU cao nhất là **{top_cpu['name']}** (PID #{top_cpu['pid']}) với **{top_cpu['cpu_percent']:.1f}%** CPU.\n\nTop 3 tiêu thụ CPU: {top_5_str}.",
                }
            status_text = "ổn định và mượt mà" if cpu_pct < 60 else ("khá cao" if cpu_pct < 85 else "đang quá tải")
            return {
                "intent": "cpu_summary",
                "answer": f"Tổng tải CPU hiện tại là **{cpu_pct:.1f}%** ({status_text}), đang chạy ở xung nhịp **{cpu_ghz} GHz** trên {cores} luồng xử lý ({physical_cores} nhân vật lý).",
            }

        # Intent 3: System Health & Overall Status
        if any(w in q for w in ["sức khỏe", "health", "tổng quan", "tình trạng", "status", "ổn không", "lag", "chậm", "score", "điểm"]):
            insights = self.generate_smart_insights(metrics)
            score = insights["health_score"]
            status = insights["health_status"]
            return {
                "intent": "health_check",
                "answer": f"Điểm sức khỏe hệ thống hiện tại: **{score}/100 ({status})**.\n- CPU: **{cpu_pct:.1f}%** ({cpu_ghz} GHz)\n- RAM: **{ram_pct:.1f}%** ({ram_used:.1f}/{ram_total:.1f} GB)\n- Uptime: **{uptime}**\n- Trạng thái: {insights['summary_vi']}",
            }

        # Intent 4: Disk & Storage
        if any(w in q for w in ["disk", "ổ đĩa", "dung lượng", "ổ c", "ổ d", "trống", "storage", "space"]):
            drives_info = " • ".join([f"Ổ **{p['mountpoint']}**: {p['used_gb']:.0f}/{p['total_gb']:.0f} GB ({p['percent']}%)" for p in partitions])
            return {
                "intent": "disk_info",
                "answer": f"Tổng quan dung lượng lưu trữ:\n{drives_info}.\n\nBạn có thể vào tab **Disk Breakdown** để phân tích chi tiết các thư mục chiếm dung lượng lớn nhất!",
            }

        # Intent 5: Network & Speed
        if any(w in q for w in ["mạng", "network", "speed", "tốc độ", "download", "upload", "ping", "internet"]):
            down_str = f"{down_kbs/1024:.2f} MB/s" if down_kbs > 1024 else f"{down_kbs:.1f} KB/s"
            up_str = f"{up_kbs/1024:.2f} MB/s" if up_kbs > 1024 else f"{up_kbs:.1f} KB/s"
            return {
                "intent": "network_info",
                "answer": f"Tốc độ mạng hiện tại:\n- Download: **{down_str}**\n- Upload: **{up_str}**\n- Tổng nhận: **{network.get('total_recv_mb', 0):.1f} MB** | Tổng gửi: **{network.get('total_sent_mb', 0):.1f} MB**.",
            }

        # Intent 6: Uptime & Machine Info
        if any(w in q for w in ["uptime", "bật bao lâu", "máy tính", "os", "windows", "hostname", "cấu hình"]):
            return {
                "intent": "system_info",
                "answer": f"Thông tin máy: **{os_info.get('hostname', 'Local PC')}**\n- Hệ điều hành: **{os_info.get('system')} {os_info.get('release')} ({os_info.get('architecture')})**\n- CPU: **{os_info.get('cpu_model', 'Multi-core')}** ({cores} Cores)\n- Thời gian hoạt động (Uptime): **{uptime}**.",
            }

        # Default fallback: Comprehensive Contextual Digest
        top_app = top_ram['name'] if top_ram else 'ứng dụng'
        return {
            "intent": "general_digest",
            "answer": f"Dựa trên các chỉ số thời gian thực:\n- CPU: **{cpu_pct:.1f}%** ({top_cpu['name'] if top_cpu else 'N/A'})\n- RAM: **{ram_pct:.1f}%** (chủ yếu do **{top_app}**)\n- Uptime: **{uptime}**\n\nBạn có thể thử các câu hỏi mẫu như: *'Tiến trình nào ngốn RAM nhất?'*, *'CPU có đang cao không?'*, hoặc *'Sức khỏe máy tính thế nào?'*.",
        }

    def process_voice_command(self, query: str, metrics: Dict[str, Any], lang: str = "vi") -> Dict[str, Any]:
        """
        Analyze speech queries, detect executable system intents, prepare concise speakable
        audio text for TTS, and return actionable UI/backend payload.
        """
        if not query or not query.strip():
            return {
                "query": "",
                "intent": "empty",
                "action": None,
                "spoken_response": "Tôi đang lắng nghe bạn, hãy thử ra lệnh hoặc hỏi về tình trạng máy tính nhé." if lang == "vi" else "I am listening. Ask me anything about your system or give a command.",
                "display_text": "Sẵn sàng nhận lệnh giọng nói. Nhấn phím micro hoặc Alt + J để ra lệnh." if lang == "vi" else "Ready for voice commands. Press mic or Alt + J to speak.",
                "success": True,
            }

        q = query.lower().strip()
        cpu = metrics.get("cpu", {})
        cpu_pct = cpu.get("overall_percent", 0.0)
        cpu_ghz = cpu.get("frequency", {}).get("current_ghz") or "--"
        cores = cpu.get("logical_cores", 4)

        ram = metrics.get("memory", {}).get("ram", {})
        ram_pct = ram.get("percent", 0.0)
        ram_used = ram.get("used_gb", 0.0)
        ram_total = ram.get("total_gb", 0.0)
        ram_free = ram.get("free_gb", 0.0)

        processes = metrics.get("processes", {})
        top_cpu_list = processes.get("by_cpu", [])
        top_ram_list = processes.get("by_ram", [])
        top_cpu = top_cpu_list[0] if top_cpu_list else {"name": "Hệ thống", "cpu_percent": 0.0, "pid": 0}
        top_ram = top_ram_list[0] if top_ram_list else {"name": "Hệ thống", "memory_mb": 0.0, "memory_percent": 0.0, "pid": 0}

        disk = metrics.get("disk", {})
        partitions = disk.get("partitions", [])
        c_drive = next((p for p in partitions if "c" in p.get("mountpoint", "").lower()), None)
        c_free = c_drive.get("free_gb", 0.0) if c_drive else 0.0
        c_pct = c_drive.get("percent", 0.0) if c_drive else 0.0

        network = metrics.get("network", {})
        down_kbs = network.get("download_kbs", 0.0)
        up_kbs = network.get("upload_kbs", 0.0)
        uptime = metrics.get("uptime", {}).get("uptime_formatted", "00:00:00")

        # --- 1. ACTION: Clean Temp Files ---
        if any(w in q for w in ["dọn rác", "xóa file tạm", "dọn temp", "clean temp", "clear temp", "xóa rác", "dọn dẹp ổ", "dọn dẹp rác", "dọn bộ nhớ tạm"]):
            return {
                "query": query,
                "intent": "action_clean_temp",
                "action": "clean_temp",
                "action_payload": {},
                "spoken_response": "Đang tiến hành dọn dẹp các file rác và bộ nhớ đệm tạm thời của hệ thống." if lang == "vi" else "Cleaning temporary system files and caches now.",
                "display_text": "🧹 **Đang thực thi:** Dọn dẹp file tạm thời trong `$env:TEMP` và bộ nhớ đệm.",
                "success": True,
            }

        # --- 2. ACTION: Flush DNS ---
        if any(w in q for w in ["flush dns", "làm mới dns", "xóa dns", "refresh dns", "reset mạng", "xóa cache mạng", "clear dns"]):
            return {
                "query": query,
                "intent": "action_flush_dns",
                "action": "flush_dns",
                "action_payload": {},
                "spoken_response": "Đang làm mới bộ nhớ đệm DNS hệ thống Windows." if lang == "vi" else "Flushing Windows DNS resolver cache now.",
                "display_text": "⚡ **Đang thực thi:** Làm mới bộ nhớ đệm DNS (`ipconfig /flushdns`).",
                "success": True,
            }

        # --- 3. ACTION: Focus Mode / Cyber Focus ---
        if any(w in q for w in ["tập trung", "chế độ focus", "focus mode", "bật focus", "cyber focus", "deep work", "priming"]):
            return {
                "query": query,
                "intent": "action_focus_mode",
                "action": "engage_focus",
                "action_payload": {"navigate_tab": "focus"},
                "spoken_response": "Kích hoạt chế độ Cyber Focus. Đã tối ưu bộ nhớ đệm và mở không gian tập trung." if lang == "vi" else "Cyber Focus mode engaged! Memory optimized and ready for deep work.",
                "display_text": "🎯 **Đã kích hoạt:** Chế độ Cyber Matrix & Hyper Focus Deck! Tối ưu bộ nhớ đệm và kích hoạt âm thanh tập trung.",
                "success": True,
            }

        # --- 4. ACTION: Tab Navigation ---
        if any(w in q for w in ["hình nền", "đổi hình nền", "wallpaper", "hình 4k", "ảnh nền", "wallhaven"]):
            return {
                "query": query,
                "intent": "navigate_tab",
                "action": "navigate_tab",
                "action_payload": {"tab": "wallpaper"},
                "spoken_response": "Đã mở Dynamic Wallpaper Studio. Bạn có thể chọn và đổi hình nền máy tính 4K chỉ với một nút bấm." if lang == "vi" else "Switched to Wallpaper Studio.",
                "display_text": "🖼️ **Điều hướng:** Đã mở tab **Dynamic Wallpaper Studio & Desktop Set**.",
                "success": True,
            }

        if any(w in q for w in ["tiền điện", "tiêu thụ điện", "công suất", "tốn điện", "bao nhiêu watt", "carbon", "power", "eco cost"]):
            return {
                "query": query,
                "intent": "navigate_tab",
                "action": "navigate_tab",
                "action_payload": {"tab": "power"},
                "spoken_response": "Đã mở bảng ước tính công suất tiêu thụ điện, chi phí tiền điện và phát thải carbon." if lang == "vi" else "Switched to Power & Carbon Cost Estimator.",
                "display_text": "⚡ **Điều hướng:** Đã mở tab **Power & Eco Cost Estimator**.",
                "success": True,
            }

        if any(w in q for w in ["radar", "quét mạng", "thiết bị mạng", "dùng chung wifi", "ai dùng wifi", "network radar", "lan radar"]):
            return {
                "query": query,
                "intent": "navigate_tab",
                "action": "navigate_tab",
                "action_payload": {"tab": "radar"},
                "spoken_response": "Đã mở hệ thống Network Radar để quét và định vị các thiết bị trong mạng Wi-Fi." if lang == "vi" else "Switched to Network & LAN Radar view.",
                "display_text": "🌐 **Điều hướng:** Đã mở tab **Network & LAN Radar**.",
                "success": True,
            }

        if any(w in q for w in ["tab ổ đĩa", "phân tích ổ", "dung lượng ổ", "disk breakdown", "mở ổ đĩa", "xem ổ c", "xem ổ d"]):
            return {
                "query": query,
                "intent": "navigate_tab",
                "action": "navigate_tab",
                "action_payload": {"tab": "disk"},
                "spoken_response": "Đã chuyển sang tab phân tích chi tiết dung lượng ổ đĩa." if lang == "vi" else "Switched to Disk Breakdown view.",
                "display_text": "💾 **Điều hướng:** Đã mở tab **Disk Breakdown**.",
                "success": True,
            }

        if any(w in q for w in ["thời gian dùng", "ứng dụng", "screen time", "app analytics", "thống kê app", "xem ứng dụng"]):
            return {
                "query": query,
                "intent": "navigate_tab",
                "action": "navigate_tab",
                "action_payload": {"tab": "apps"},
                "spoken_response": "Đã mở tab thống kê thời gian sử dụng ứng dụng và lưu lượng mạng." if lang == "vi" else "Switched to Application Analytics view.",
                "display_text": "📊 **Điều hướng:** Đã mở tab **App Analytics**.",
                "success": True,
            }

        if any(w in q for w in ["tải về", "downloads", "mở download", "xem file tải", "lịch sử tải"]):
            return {
                "query": query,
                "intent": "navigate_tab",
                "action": "navigate_tab",
                "action_payload": {"tab": "downloads"},
                "spoken_response": "Đã mở tab quản lý và phân loại thư mục tải về." if lang == "vi" else "Switched to Downloads Tracker view.",
                "display_text": "📥 **Điều hướng:** Đã mở tab **Downloads Tracker**.",
                "success": True,
            }

        if any(w in q for w in ["thông báo", "notifications", "action center", "event log", "sự kiện"]):
            return {
                "query": query,
                "intent": "navigate_tab",
                "action": "navigate_tab",
                "action_payload": {"tab": "notifications"},
                "spoken_response": "Đã chuyển sang trung tâm thông báo và nhật ký sự kiện Windows." if lang == "vi" else "Switched to Notifications & Events hub.",
                "display_text": "🔔 **Điều hướng:** Đã mở tab **Notifications & Events**.",
                "success": True,
            }

        if any(w in q for w in ["cảnh báo", "alerts", "webhook", "ngưỡng", "telegram", "discord"]):
            return {
                "query": query,
                "intent": "navigate_tab",
                "action": "navigate_tab",
                "action_payload": {"tab": "alerts"},
                "spoken_response": "Đã mở tab cấu hình cảnh báo ngưỡng và webhook." if lang == "vi" else "Switched to Alerts & Webhooks configuration.",
                "display_text": "⚠️ **Điều hướng:** Đã mở tab **Alerts & Webhooks**.",
                "success": True,
            }

        if any(w in q for w in ["về trang chủ", "tổng quan", "overview", "realtime", "giám sát", "màn hình chính"]):
            return {
                "query": query,
                "intent": "navigate_tab",
                "action": "navigate_tab",
                "action_payload": {"tab": "overview"},
                "spoken_response": "Đã trở về màn hình giám sát hiệu năng tổng quan." if lang == "vi" else "Switched to Real-time Monitor overview.",
                "display_text": "🖥️ **Điều hướng:** Đã mở tab **Real-time Monitor**.",
                "success": True,
            }

        # --- 5. ACTION: Toggle Theme (Dark / Light) ---
        if any(w in q for w in ["đổi giao diện", "theme", "chế độ sáng", "chế độ tối", "dark mode", "light mode", "giao diện sáng", "giao diện tối"]):
            return {
                "query": query,
                "intent": "action_toggle_theme",
                "action": "toggle_theme",
                "action_payload": {},
                "spoken_response": "Đã chuyển đổi giao diện sáng tối." if lang == "vi" else "Toggled dashboard theme.",
                "display_text": "🌓 **Giao diện:** Đã chuyển đổi Theme thành công.",
                "success": True,
            }

        # --- 6. TELEMETRY: Top RAM Consumer ---
        if any(w in q for w in ["ram", "bộ nhớ", "ngốn ram", "chiếm ram"]) and any(w in q for w in ["top", "nhiều nhất", "cao nhất", "ai", "tiến trình", "app", "ứng dụng", "nào"]):
            spoken = f"Ứng dụng đang chiếm nhiều RAM nhất là {top_ram['name']} với {top_ram['memory_mb']:.0f} Megabyte, chiếm {top_ram['memory_percent']:.1f} phần trăm RAM." if lang == "vi" else f"Top memory consumer is {top_ram['name']} using {top_ram['memory_mb']:.0f} MB ({top_ram['memory_percent']:.1f}% RAM)."
            top_3_str = ", ".join([f"**{p['name']}** ({p['memory_mb']:.0f} MB)" for p in top_ram_list[:3]])
            display = f"🧠 **Tiến trình ngốn RAM nhất:**\n- **{top_ram['name']}** (PID #{top_ram['pid']}): **{top_ram['memory_mb']:.1f} MB** ({top_ram['memory_percent']:.1f}% RAM)\n- Top 3: {top_3_str}"
            return {
                "query": query,
                "intent": "top_ram_process",
                "action": None,
                "spoken_response": spoken,
                "display_text": display,
                "success": True,
            }

        # --- 7. TELEMETRY: Top CPU Consumer ---
        if any(w in q for w in ["cpu", "vi xử lý", "ngốn cpu", "tải cpu", "nóng", "quá tải"]) and any(w in q for w in ["top", "nhiều nhất", "cao nhất", "tiến trình", "app", "ứng dụng", "nào"]):
            spoken = f"Ứng dụng đang dùng nhiều CPU nhất là {top_cpu['name']} với {top_cpu['cpu_percent']:.1f} phần trăm CPU." if lang == "vi" else f"Top CPU consumer is {top_cpu['name']} with {top_cpu['cpu_percent']:.1f}% CPU load."
            top_3_str = ", ".join([f"**{p['name']}** ({p['cpu_percent']:.1f}%)" for p in top_cpu_list[:3]])
            display = f"⚡ **Tiến trình tiêu thụ CPU cao nhất:**\n- **{top_cpu['name']}** (PID #{top_cpu['pid']}): **{top_cpu['cpu_percent']:.1f}%** CPU\n- Top 3: {top_3_str}"
            return {
                "query": query,
                "intent": "top_cpu_process",
                "action": None,
                "spoken_response": spoken,
                "display_text": display,
                "success": True,
            }

        # --- 8. TELEMETRY: CPU Status Summary ---
        if any(w in q for w in ["cpu", "vi xử lý", "xung nhịp"]):
            status_text = "hoạt động ổn định và mượt mà" if cpu_pct < 65 else ("đang tải khá cao" if cpu_pct < 85 else "đang chịu tải rất nặng")
            spoken = f"Tải CPU hiện tại là {cpu_pct:.1f} phần trăm, xung nhịp {cpu_ghz} Gigahertz, {status_text}." if lang == "vi" else f"Current CPU usage is {cpu_pct:.1f}% at {cpu_ghz} GHz, load is normal."
            display = f"⚡ **Trạng thái CPU:**\n- Mức sử dụng: **{cpu_pct:.1f}%**\n- Xung nhịp hiện tại: **{cpu_ghz} GHz** ({cores} Threads)\n- Đánh giá: *{status_text}*"
            return {
                "query": query,
                "intent": "cpu_summary",
                "action": None,
                "spoken_response": spoken,
                "display_text": display,
                "success": True,
            }

        # --- 9. TELEMETRY: RAM Summary ---
        if any(w in q for w in ["ram", "bộ nhớ"]):
            spoken = f"Mức sử dụng RAM hiện tại là {ram_pct:.1f} phần trăm, đã dùng {ram_used:.1f} trên tổng số {ram_total:.1f} Gigabyte." if lang == "vi" else f"RAM usage is {ram_pct:.1f}%, using {ram_used:.1f} of {ram_total:.1f} GB."
            display = f"🧠 **Trạng thái Bộ nhớ RAM:**\n- Đã sử dụng: **{ram_used:.1f}/{ram_total:.1f} GB** (**{ram_pct:.1f}%**)\n- Còn trống: **{ram_free:.1f} GB**"
            return {
                "query": query,
                "intent": "ram_summary",
                "action": None,
                "spoken_response": spoken,
                "display_text": display,
                "success": True,
            }

        # --- 10. TELEMETRY: Disk Free Space ---
        if any(w in q for w in ["ổ đĩa", "ổ c", "ổ d", "dung lượng", "bộ nhớ trống", "còn bao nhiêu gb", "trống bao nhiêu"]):
            spoken = f"Ổ đĩa C hiện còn trống {c_free:.1f} Gigabyte, chiếm {c_pct:.1f} phần trăm dung lượng." if lang == "vi" else f"Drive C has {c_free:.1f} GB free, currently {c_pct:.1f}% full."
            drives_info = "\n".join([f"- Ổ **{p['mountpoint']}**: Còn trống **{p['free_gb']:.1f} GB** / Tổng **{p['total_gb']:.1f} GB** ({p['percent']}%)" for p in partitions])
            display = f"💾 **Tổng quan dung lượng ổ cứng:**\n{drives_info}"
            return {
                "query": query,
                "intent": "disk_info",
                "action": None,
                "spoken_response": spoken,
                "display_text": display,
                "success": True,
            }

        # --- 11. TELEMETRY: System Health Score ---
        if any(w in q for w in ["sức khỏe", "health", "tình trạng máy", "máy ổn không", "điểm sức khỏe", "lag", "chậm"]):
            insights = self.generate_smart_insights(metrics)
            score = insights["health_score"]
            status = insights["health_status"]
            spoken = f"Điểm sức khỏe hệ thống hiện tại là {score} trên 100, trạng thái {status}. CPU ở mức {cpu_pct:.1f} phần trăm, RAM chiếm {ram_pct:.1f} phần trăm." if lang == "vi" else f"Current system health score is {score} out of 100, status {status}."
            display = f"🏥 **Đánh giá sức khỏe PC:**\n- Điểm số: **{score}/100** ({status})\n- Tóm tắt: {insights['summary_vi']}\n- CPU: **{cpu_pct:.1f}%** | RAM: **{ram_pct:.1f}%** | Uptime: **{uptime}**"
            return {
                "query": query,
                "intent": "health_check",
                "action": None,
                "spoken_response": spoken,
                "display_text": display,
                "success": True,
            }

        # --- 12. TELEMETRY: Network Speed ---
        if any(w in q for w in ["mạng", "tốc độ mạng", "speed", "download", "upload", "ping", "internet"]):
            down_str = f"{down_kbs/1024:.2f} MB/s" if down_kbs > 1024 else f"{down_kbs:.1f} KB/s"
            up_str = f"{up_kbs/1024:.2f} MB/s" if up_kbs > 1024 else f"{up_kbs:.1f} KB/s"
            spoken = f"Tốc độ mạng hiện tại: tải xuống {down_str}, tải lên {up_str}." if lang == "vi" else f"Network download speed is {down_str}, upload speed is {up_str}."
            display = f"🌐 **Tốc độ Mạng Thời gian thực:**\n- Download: **{down_str}**\n- Upload: **{up_str}**"
            return {
                "query": query,
                "intent": "network_info",
                "action": None,
                "spoken_response": spoken,
                "display_text": display,
                "success": True,
            }

        # --- 13. TELEMETRY: Uptime ---
        if any(w in q for w in ["uptime", "bật bao lâu", "chạy bao lâu", "thời gian hoạt động"]):
            spoken = f"Máy tính đã hoạt động liên tục trong {uptime}." if lang == "vi" else f"System uptime is {uptime}."
            display = f"⏱️ **Thời gian hoạt động liên tục (Uptime):** **{uptime}**"
            return {
                "query": query,
                "intent": "uptime_info",
                "action": None,
                "spoken_response": spoken,
                "display_text": display,
                "success": True,
            }

        # --- Fallback: Standard AI Q&A Engine ---
        answer_data = self.answer_query(query, metrics)
        raw_ans = answer_data.get("answer", "")
        # Create a clean spoken version (strip markdown stars and brackets)
        clean_speech = re.sub(r"[\*\#\_\`]", "", raw_ans).replace("\n", ". ")
        clean_speech = re.sub(r"\s+", " ", clean_speech).strip()
        # Limit spoken length to first 2 sentences for natural conversational feel
        sentences = [s.strip() for s in clean_speech.split(".") if s.strip()]
        spoken_summary = ". ".join(sentences[:2]) + "." if sentences else "Tôi đã phân tích xong chỉ số hệ thống cho bạn."

        return {
            "query": query,
            "intent": answer_data.get("intent", "general_query"),
            "action": None,
            "spoken_response": spoken_summary if lang == "vi" else "I analyzed the system metrics based on your request.",
            "display_text": raw_ans,
            "success": True,
        }

ai_copilot = AICopilotEngine()

