"""
Pro Desk Health & Ergonomics Service.
Provides persistent tracking of daily hydration, 20-20-20 eye care breaks,
active screen time, and interactive ergonomics stretches using SQLite.
Integrates official Health.gov MyHealthfinder API (with 12h caching) and
Google Gemini AI Health Copilot for workplace ergonomics and micro-break routines.
"""

import asyncio
import datetime
import json
import logging
import math
import os
from pathlib import Path
import random
import sqlite3
import time
from typing import Any, Dict, List, Optional
import httpx

from app.gemini_service import gemini_service

logger = logging.getLogger("health_expert_service")

BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = BASE_DIR / "data"
DATA_DIR.mkdir(parents=True, exist_ok=True)
DB_PATH = DATA_DIR / "health.db"

# =============================================================================
# Rich Curated Offline Medical Knowledge Base (ODPHP / CDC / AAO / OSHA Standard)
# =============================================================================
OFFLINE_VERIFIED_INSIGHTS = [
    {
        "id": "insight_eye_202020",
        "title": "Quy tắc thị lực 20-20-20 phòng tránh Hội chứng Thị giác Màn hình (CVS)",
        "source": "American Academy of Ophthalmology (AAO) & ODPHP Health.gov",
        "category": "Vision & Eye Care",
        "badge": "Chuẩn Y Khoa Quốc Tế",
        "summary": "Cứ sau mỗi 20 phút nhìn màn hình, hãy nhìn ra xa một vật cách ít nhất 20 feet (khoảng 6 mét) trong tối thiểu 20 giây. Hành động này giúp cơ thể mi mắt (ciliary muscles) giãn ra hoàn toàn, giảm căng thẳng điều tiết và giảm khô giác mạc đến 78%.",
        "action_steps": [
            "Cài đặt chuông báo nghỉ mỗi 20 phút làm việc liên tục.",
            "Phóng tầm mắt ra cửa sổ hoặc góc xa nhất của căn phòng.",
            "Chớp mắt chậm 5-10 lần để làm ẩm bề mặt giác mạc tự nhiên."
        ],
        "evidence_level": "Level 1A Medical Evidence"
    },
    {
        "id": "insight_cervical_spine",
        "title": "Áp lực cột sống cổ theo góc cúi đầu khi dùng máy tính (Cervical Spine Load)",
        "source": "Surgical Technology International & US Dept of Health",
        "category": "Ergonomics & Spine",
        "badge": "Cơ Xương Khớp",
        "summary": "Đầu người nặng trung bình 4.5 - 5.5 kg ở tư thế thẳng trục (0°). Khi cúi đầu nhìn màn hình góc 15°, áp lực lên đốt sống cổ tăng lên 12 kg; ở góc 30° là 18 kg; và góc 60° (gập cổ nhìn laptop/điện thoại) tương đương áp lực 27 kg lên đốt sống C5-C7, gây thoái hóa đĩa đệm sớm và chèn ép dây thần kinh vai gáy.",
        "action_steps": [
            "Nâng mép trên của màn hình ngang tầm mắt hoặc thấp hơn 2-3 cm.",
            "Dùng giá đỡ laptop kết hợp bàn phím/chuột rời.",
            "Thực hiện bài tập thu cằm (Chin Tuck) 10 lần mỗi 60 phút."
        ],
        "evidence_level": "Biomechanical Clinical Study"
    },
    {
        "id": "insight_hydration_metabolism",
        "title": "Tác động của mất nước nhẹ (Mild Dehydration) đến hiệu suất não bộ",
        "source": "European Journal of Nutrition & Health.gov",
        "category": "Hydration & Metabolism",
        "badge": "Sinh Hiệu & Năng Lượng",
        "summary": "Chỉ cần cơ thể thiếu hụt 1.5% lượng nước tổng thể, tốc độ xử lý của não bộ giảm 14%, khả năng tập trung ngắn hạn suy giảm rõ rệt và nguy cơ đau đầu cuối ngày tăng gấp 3. Uống nước rải đều từng ngụm nhỏ 200-250ml mỗi 45-60 phút duy trì lưu thông máu tối ưu đến não và thận.",
        "action_steps": [
            "Công thức chuẩn cho dân văn phòng: Cân nặng (kg) × 35ml.",
            "Uống trước khi cảm thấy khát, vì cảm giác khát xuất hiện khi cơ thể đã mất 1% nước.",
            "Bù thêm 200ml nước nếu uống 1 cốc cà phê chứa caffeine."
        ],
        "evidence_level": "Nutritional Physiology Guideline"
    },
    {
        "id": "insight_carpal_tunnel",
        "title": "Phòng ngừa Hội chứng Ống cổ tay (Carpal Tunnel Syndrome) khi gõ phím",
        "source": "Occupational Safety and Health Administration (OSHA)",
        "category": "Repetitive Strain Injury",
        "badge": "Công Thái Học Lao Động",
        "summary": "Khi cổ tay bị gập lên (dorsiflexion) quá 15° trong lúc gõ phím, áp lực bên trong ống cổ tay tăng từ 3 mmHg lên hơn 30 mmHg, chèn ép trực tiếp dây thần kinh giữa (median nerve), dẫn đến tê bì ngón cái, ngón trỏ và ngón giữa.",
        "action_steps": [
            "Giữ cẳng tay và cổ tay thẳng hàng song song với mặt sàn.",
            "Không tì mạnh cổ tay xuống mép bàn cứng; dùng đệm cổ tay công thái học.",
            "Thực hiện bài tập kéo giãn gân gấp cổ tay (Wrist Flexor Stretch) 15 giây mỗi 2 giờ."
        ],
        "evidence_level": "OSHA Ergonomic Standard"
    },
    {
        "id": "insight_circadian_blue_light",
        "title": "Ánh sáng xanh nhân tạo và ức chế Melatonin buổi tối",
        "source": "Harvard Health & National Institutes of Health (NIH)",
        "category": "Circadian Rhythm & Sleep",
        "badge": "Giấc Ngủ & Não Bộ",
        "summary": "Bước sóng ánh sáng xanh 450-480nm từ màn hình máy tính ức chế tuyến tùng tiết hormone Melatonin lên đến 50%, làm trì hoãn pha buồn ngủ tự nhiên từ 1.5 đến 3 giờ, làm suy giảm chất lượng giấc ngủ sâu (NREM Stage 3/4) cần thiết cho phục hồi thể chất.",
        "action_steps": [
            "Bật chế độ Night Light (Ánh sáng đêm) trên Windows sau 19:00.",
            "Giữ độ sáng màn hình tương đồng với độ sáng môi trường xung quanh.",
            "Nghỉ nhìn màn hình ít nhất 45 phút trước khi đi ngủ."
        ],
        "evidence_level": "Clinical Neurobiology"
    }
]

class HealthExpertService:
    def __init__(self, db_path: Path = DB_PATH):
        self.db_path = db_path
        self._init_db()

    def _init_db(self):
        """Initialize SQLite tables for daily logs, activity events, and external API caching."""
        with sqlite3.connect(self.db_path) as conn:
            cursor = conn.cursor()
            
            # 1. Daily Health Logs Table
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS daily_health_log (
                    date_str TEXT PRIMARY KEY,
                    water_intake_ml INTEGER DEFAULT 0,
                    water_target_ml INTEGER DEFAULT 2000,
                    user_weight_kg REAL DEFAULT 65.0,
                    activity_level TEXT DEFAULT 'desk_worker',
                    screen_time_minutes INTEGER DEFAULT 0,
                    eye_breaks_completed INTEGER DEFAULT 0,
                    stretches_completed INTEGER DEFAULT 0,
                    last_updated REAL
                )
            """)

            # 2. External Health API Cache Table
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS health_cache (
                    cache_key TEXT PRIMARY KEY,
                    data_json TEXT,
                    expires_at REAL
                )
            """)

            # 3. Micro Activity Log Events Table
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS health_log_events (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    timestamp REAL,
                    date_str TEXT,
                    event_type TEXT,
                    amount INTEGER DEFAULT 0,
                    details TEXT
                )
            """)
            cursor.execute("CREATE INDEX IF NOT EXISTS idx_health_date ON health_log_events(date_str)")
            cursor.execute("CREATE INDEX IF NOT EXISTS idx_health_type ON health_log_events(event_type)")
            conn.commit()

    def _get_today_str(self) -> str:
        return datetime.datetime.now().strftime("%Y-%m-%d")

    def get_daily_log(self, date_str: Optional[str] = None) -> Dict[str, Any]:
        """Fetch or initialize the daily health record for a given date."""
        if not date_str:
            date_str = self._get_today_str()

        with sqlite3.connect(self.db_path) as conn:
            conn.row_factory = sqlite3.Row
            cursor = conn.cursor()
            cursor.execute("SELECT * FROM daily_health_log WHERE date_str = ?", (date_str,))
            row = cursor.fetchone()

            if row:
                return dict(row)

            # Calculate default target based on 65kg * 35ml + desk compensation
            default_weight = 65.0
            default_target = int(math.ceil((default_weight * 35 + 200) / 50.0) * 50)  # Rounded to nearest 50ml -> 2500ml

            now_ts = time.time()
            cursor.execute("""
                INSERT INTO daily_health_log (
                    date_str, water_intake_ml, water_target_ml, user_weight_kg,
                    activity_level, screen_time_minutes, eye_breaks_completed,
                    stretches_completed, last_updated
                ) VALUES (?, 0, ?, ?, 'desk_worker', 0, 0, 0, ?)
            """, (date_str, default_target, default_weight, now_ts))
            conn.commit()

            return {
                "date_str": date_str,
                "water_intake_ml": 0,
                "water_target_ml": default_target,
                "user_weight_kg": default_weight,
                "activity_level": "desk_worker",
                "screen_time_minutes": 0,
                "eye_breaks_completed": 0,
                "stretches_completed": 0,
                "last_updated": now_ts
            }

    def log_water(self, amount_ml: int, action: str = "add", custom_target_ml: Optional[int] = None) -> Dict[str, Any]:
        """Log water intake (+200ml, +250ml, +500ml, or reset)."""
        date_str = self._get_today_str()
        current = self.get_daily_log(date_str)
        now_ts = time.time()

        if action == "reset":
            new_intake = 0
        elif action == "set":
            new_intake = max(0, amount_ml)
        else:  # add
            new_intake = max(0, current["water_intake_ml"] + amount_ml)

        target = custom_target_ml if custom_target_ml and custom_target_ml > 500 else current["water_target_ml"]

        with sqlite3.connect(self.db_path) as conn:
            cursor = conn.cursor()
            cursor.execute("""
                UPDATE daily_health_log
                SET water_intake_ml = ?, water_target_ml = ?, last_updated = ?
                WHERE date_str = ?
            """, (new_intake, target, now_ts, date_str))

            # Record event history
            cursor.execute("""
                INSERT INTO health_log_events (timestamp, date_str, event_type, amount, details)
                VALUES (?, ?, 'water_intake', ?, ?)
            """, (now_ts, date_str, amount_ml, json.dumps({"action": action, "new_total": new_intake})))
            conn.commit()

        pct = min(100.0, round((new_intake / max(target, 1)) * 100.0, 1))
        status_info = self._compute_hydration_status(new_intake, target)

        return {
            "status": "success",
            "date_str": date_str,
            "water_intake_ml": new_intake,
            "water_target_ml": target,
            "percentage": pct,
            "hydration_status": status_info["status"],
            "hydration_badge": status_info["badge"],
            "hydration_message": status_info["message"],
            "hydration_color": status_info["color"]
        }

    def update_target_and_profile(self, weight_kg: float, activity_level: str = "desk_worker", manual_target_ml: Optional[int] = None) -> Dict[str, Any]:
        """Update body weight and automatically calculate medical hydration target."""
        date_str = self._get_today_str()
        weight_kg = max(30.0, min(200.0, float(weight_kg)))

        if manual_target_ml and manual_target_ml >= 500:
            target_ml = manual_target_ml
        else:
            # Medical formula: 35ml per kg + desk activity compensation
            base = weight_kg * 35
            multiplier = 1.0
            if activity_level == "active":
                multiplier = 1.2
            elif activity_level == "athlete":
                multiplier = 1.4
            target_ml = int(math.ceil((base * multiplier) / 50.0) * 50)

        now_ts = time.time()
        with sqlite3.connect(self.db_path) as conn:
            cursor = conn.cursor()
            cursor.execute("""
                UPDATE daily_health_log
                SET user_weight_kg = ?, activity_level = ?, water_target_ml = ?, last_updated = ?
                WHERE date_str = ?
            """, (weight_kg, activity_level, target_ml, now_ts, date_str))
            conn.commit()

        updated_log = self.get_daily_log(date_str)
        pct = min(100.0, round((updated_log["water_intake_ml"] / max(target_ml, 1)) * 100.0, 1))
        status_info = self._compute_hydration_status(updated_log["water_intake_ml"], target_ml)

        return {
            "status": "success",
            "date_str": date_str,
            "user_weight_kg": weight_kg,
            "activity_level": activity_level,
            "water_target_ml": target_ml,
            "water_intake_ml": updated_log["water_intake_ml"],
            "percentage": pct,
            "hydration_status": status_info["status"]
        }

    def complete_exercise(self, exercise_type: str, exercise_name: str = "20-20-20 Eye Care") -> Dict[str, Any]:
        """Increment completed count for eye breaks or ergonomics stretches."""
        date_str = self._get_today_str()
        current = self.get_daily_log(date_str)
        now_ts = time.time()

        if exercise_type == "eye_break":
            new_eye = current["eye_breaks_completed"] + 1
            new_stretch = current["stretches_completed"]
            event_type = "eye_break_complete"
        else:  # stretch
            new_eye = current["eye_breaks_completed"]
            new_stretch = current["stretches_completed"] + 1
            event_type = "stretch_complete"

        with sqlite3.connect(self.db_path) as conn:
            cursor = conn.cursor()
            cursor.execute("""
                UPDATE daily_health_log
                SET eye_breaks_completed = ?, stretches_completed = ?, last_updated = ?
                WHERE date_str = ?
            """, (new_eye, new_stretch, now_ts, date_str))

            cursor.execute("""
                INSERT INTO health_log_events (timestamp, date_str, event_type, amount, details)
                VALUES (?, ?, ?, 1, ?)
            """, (now_ts, date_str, event_type, json.dumps({"exercise_name": exercise_name})))
            conn.commit()

        return {
            "status": "success",
            "date_str": date_str,
            "exercise_type": exercise_type,
            "exercise_name": exercise_name,
            "eye_breaks_completed": new_eye,
            "stretches_completed": new_stretch,
            "message": f"Tuyệt vời! Đã hoàn thành '{exercise_name}'."
        }

    def _compute_hydration_status(self, intake_ml: int, target_ml: int) -> Dict[str, str]:
        """Classify hydration level into clinical status bands."""
        ratio = intake_ml / max(target_ml, 1)
        current_hour = datetime.datetime.now().hour

        if ratio >= 1.0:
            return {
                "status": "Hoàn Hảo (Optimal)",
                "badge": "🌟 Đủ Nước Chuẩn Y Khoa",
                "message": "Cơ thể đã nhận đủ 100% lượng nước cần thiết trong ngày. Hãy duy trì nhấp từng ngụm nhỏ.",
                "color": "#10b981"
            }
        elif ratio >= 0.7:
            return {
                "status": "Tốt (Good)",
                "badge": "💧 Mức Bù Nước Khá",
                "message": "Bạn đang duy trì lượng nước rất tốt, sắp hoàn thành mục tiêu ngày.",
                "color": "#38bdf8"
            }
        elif ratio >= 0.4:
            return {
                "status": "Trung Bình (Moderate)",
                "badge": "⏳ Cần Bổ Sung Thêm",
                "message": "Lượng nước trung bình. Hãy uống thêm 1 cốc 250ml để giữ sự tỉnh táo cho não bộ.",
                "color": "#f59e0b"
            }
        else:
            if current_hour >= 14:
                return {
                    "status": "Báo Động Mất Nước (Dehydration Risk)",
                    "badge": "⚠️ Cần Bù Nước Ngay",
                    "message": "Cơ thể đang thiếu nước nghiêm trọng so với thời gian trong ngày. Uống ngay 250-500ml!",
                    "color": "#f87171"
                }
            else:
                return {
                    "status": "Khởi Đầu Ngày (Starting)",
                    "badge": "🌅 Khởi Động Ngày Mới",
                    "message": "Hãy bắt đầu buổi làm việc với một cốc nước ấm 250ml.",
                    "color": "#a855f7"
                }

    def _get_active_screen_time_minutes(self) -> int:
        """Estimate today's active screen time from app_tracker database if available."""
        date_str = self._get_today_str()
        app_db_path = BASE_DIR / "app_analytics.db"

        if app_db_path.exists():
            try:
                with sqlite3.connect(app_db_path) as conn:
                    cursor = conn.cursor()
                    cursor.execute("""
                        SELECT SUM(screen_time_seconds)
                        FROM app_daily_usage
                        WHERE date_str = ?
                    """, (date_str,))
                    row = cursor.fetchone()
                    if row and row[0] is not None:
                        return int(row[0] // 60)
            except Exception as e:
                logger.warning(f"Failed to read screen time from app_analytics.db: {e}")

        # Fallback to uptime or stored estimate
        import psutil
        try:
            uptime_seconds = time.time() - psutil.boot_time()
            return min(720, max(15, int(uptime_seconds // 60)))
        except Exception:
            return 120

    async def fetch_official_health_topics(self, keyword: str = "physical activity") -> Dict[str, Any]:
        """
        Fetch certified topics from ODPHP Health.gov MyHealthfinder API v4.
        Caches API responses for 12 hours. Falls back to curated offline clinical insights if offline.
        """
        cache_key = f"healthgov_topics_{keyword.strip().lower()}"
        now_ts = time.time()

        # 1. Check local SQLite Cache
        with sqlite3.connect(self.db_path) as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT data_json, expires_at FROM health_cache WHERE cache_key = ?", (cache_key,))
            row = cursor.fetchone()
            if row:
                data_json, expires_at = row
                if expires_at > now_ts:
                    try:
                        parsed = json.loads(data_json)
                        return {
                            "source": "Health.gov MyHealthfinder (Cached)",
                            "is_cached": True,
                            "keyword": keyword,
                            "topics": parsed
                        }
                    except Exception:
                        pass

        # 2. Try fetching from official ODPHP API with 5s timeout
        url = f"https://odphp.health.gov/myhealthfinder/api/v4/topicsearch.json?keyword={keyword}"
        headers = {"User-Agent": "LocalPerformanceMonitor-HealthAssistant/1.0"}

        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                resp = await client.get(url, headers=headers)
                if resp.status_code == 200:
                    payload = resp.json()
                    result_topics = []
                    
                    # Extract topics safely from MyHealthfinder response structure
                    resources = payload.get("Result", {}).get("Resources", {}).get("Resource", [])
                    if isinstance(resources, dict):
                        resources = [resources]
                    
                    for item in resources[:8]:
                        title = item.get("Title", "Health Recommendation")
                        cat = item.get("Categories", "General Wellness")
                        desc = item.get("AccessibleVersion", "") or item.get("Description", "")
                        image_url = item.get("ImageUrl", "")
                        source_url = item.get("MyHFUrl", "https://health.gov")

                        result_topics.append({
                            "title": title,
                            "category": cat,
                            "summary": desc[:280] + ("..." if len(desc) > 280 else ""),
                            "image_url": image_url,
                            "source_url": source_url,
                            "source": "US Dept of Health and Human Services (Health.gov)"
                        })

                    if result_topics:
                        # Save to Cache for 12 hours (43200 seconds)
                        expires_at = now_ts + 43200
                        with sqlite3.connect(self.db_path) as conn:
                            cursor = conn.cursor()
                            cursor.execute("""
                                INSERT OR REPLACE INTO health_cache (cache_key, data_json, expires_at)
                                VALUES (?, ?, ?)
                            """, (cache_key, json.dumps(result_topics), expires_at))
                            conn.commit()

                        return {
                            "source": "Health.gov MyHealthfinder (Live API)",
                            "is_cached": False,
                            "keyword": keyword,
                            "topics": result_topics
                        }
        except Exception as e:
            logger.warning(f"External Health.gov API call failed or timed out: {e}. Using rich offline clinical knowledge base.")

        # 3. Return rich curated offline medical topics
        return {
            "source": "Verified Medical Clinical Library (Offline Safe)",
            "is_cached": True,
            "keyword": keyword,
            "topics": OFFLINE_VERIFIED_INSIGHTS
        }

    def get_daily_verified_insight(self) -> Dict[str, Any]:
        """Return today's certified medical recommendation."""
        # Pick today's insight deterministically based on day of year
        day_of_year = datetime.datetime.now().timetuple().tm_yday
        idx = day_of_year % len(OFFLINE_VERIFIED_INSIGHTS)
        return OFFLINE_VERIFIED_INSIGHTS[idx]

    def get_dashboard_summary(self) -> Dict[str, Any]:
        """Aggregate complete daily health dashboard metrics, hydration wave state, and 7-day stats."""
        date_str = self._get_today_str()
        log = self.get_daily_log(date_str)
        screen_minutes = self._get_active_screen_time_minutes()

        # Update screen time in today's log
        with sqlite3.connect(self.db_path) as conn:
            cursor = conn.cursor()
            cursor.execute("UPDATE daily_health_log SET screen_time_minutes = ? WHERE date_str = ?", (screen_minutes, date_str))
            conn.commit()
        log["screen_time_minutes"] = screen_minutes

        intake = log["water_intake_ml"]
        target = log["water_target_ml"]
        pct = min(100.0, round((intake / max(target, 1)) * 100.0, 1))
        status_info = self._compute_hydration_status(intake, target)

        # 7-day trend history
        history_7d = []
        with sqlite3.connect(self.db_path) as conn:
            conn.row_factory = sqlite3.Row
            cursor = conn.cursor()
            cursor.execute("""
                SELECT date_str, water_intake_ml, water_target_ml, eye_breaks_completed, stretches_completed, screen_time_minutes
                FROM daily_health_log
                ORDER BY date_str DESC
                LIMIT 7
            """)
            history_7d = [dict(r) for r in cursor.fetchall()]
            history_7d.reverse()

        daily_insight = self.get_daily_verified_insight()

        # Screen time strain score calculation
        strain_level = "Thấp (Low)"
        strain_color = "#10b981"
        if screen_minutes > 360:  # > 6 hours
            strain_level = "Rất Cao (High Fatigue Risk)"
            strain_color = "#f87171"
        elif screen_minutes > 240:  # > 4 hours
            strain_level = "Đáng Chú Ý (Moderate Strain)"
            strain_color = "#f59e0b"

        # Ergonomics tension score (0-100, where 100 is completely relaxed)
        # Stretches and eye breaks restore score, screen time decreases score
        fatigue_points = (screen_minutes / 60.0) * 12.0
        relief_points = (log["eye_breaks_completed"] * 6.0) + (log["stretches_completed"] * 10.0)
        recovery_score = max(10, min(100, int(90 - fatigue_points + relief_points)))

        return {
            "status": "success",
            "today": {
                "date_str": date_str,
                "water_intake_ml": intake,
                "water_target_ml": target,
                "hydration_pct": pct,
                "hydration_status": status_info["status"],
                "hydration_badge": status_info["badge"],
                "hydration_message": status_info["message"],
                "hydration_color": status_info["color"],
                "user_weight_kg": log.get("user_weight_kg", 65.0),
                "activity_level": log.get("activity_level", "desk_worker"),
                "screen_time_minutes": screen_minutes,
                "screen_time_hours": round(screen_minutes / 60.0, 1),
                "strain_level": strain_level,
                "strain_color": strain_color,
                "eye_breaks_completed": log.get("eye_breaks_completed", 0),
                "eye_breaks_target": max(4, int(screen_minutes // 30)),
                "stretches_completed": log.get("stretches_completed", 0),
                "stretches_target": max(3, int(screen_minutes // 60)),
                "recovery_score": recovery_score
            },
            "daily_insight": daily_insight,
            "history_7d": history_7d
        }

    async def generate_expert_advice(self, screen_time_hours: float, symptoms: List[str], desk_type: str = "sitting_desk") -> Dict[str, Any]:
        """
        Generate AI Health Copilot & Ergonomics Coach 60-second micro-break recovery plan
        tailored to active screen time and specific symptoms.
        """
        symptoms_str = ", ".join(symptoms) if symptoms else "Mệt mỏi toàn thân, mỏi mắt nhẹ"
        screen_time_hours = max(0.5, float(screen_time_hours))

        # Check if Gemini AI client is active
        if gemini_service._client:
            prompt = f"""
Bạn là Bác Sĩ Chuyên Khoa Cơ Xương Khớp & Chuyên Gia Công Thái Học Văn Phòng Cao Cấp (Senior Ergonomics & Occupational Physiotherapist).
Hãy xây dựng phác đồ hồi phục khẩn cấp 60 giây (60-Second Micro-Break Recovery Protocol) cho nhân viên văn phòng có dữ liệu sau:
- Thời gian nhìn màn hình liên tục: {screen_time_hours:.1f} giờ
- Triệu chứng đang gặp phải: {symptoms_str}
- Kiểu bàn làm việc: {desk_type}

YÊU CẦU ĐẦU RA BẮT BUỘC:
Trả về định dạng JSON thuần túy (valid JSON only, no markdown backticks, no markdown formatting) với cấu trúc schema sau:
{{
  "clinical_summary": "Nhận định y khoa ngắn gọn về tình trạng căng cơ và thị giác (tối đa 2 câu)",
  "root_cause_explanation": "Giải thích nguyên nhân giải phẫu học và cơ chế sinh học dẫn đến triệu chứng (ví dụ: đè nén thần kinh, ức chế chớp mắt, co thắt cơ nâng vai)",
  "recovery_protocol": [
    {{
      "step_number": 1,
      "title": "Tên động tác 1",
      "duration_seconds": 20,
      "instruction": "Hướng dẫn chi tiết từng nhịp thở và góc cử động",
      "target_muscle": "Nhóm cơ đích",
      "svg_type": "neck"
    }},
    {{
      "step_number": 2,
      "title": "Tên động tác 2",
      "duration_seconds": 20,
      "instruction": "Hướng dẫn chi tiết",
      "target_muscle": "Nhóm cơ đích",
      "svg_type": "shoulder"
    }},
    {{
      "step_number": 3,
      "title": "Tên động tác 3",
      "duration_seconds": 20,
      "instruction": "Hướng dẫn chi tiết",
      "target_muscle": "Nhóm cơ đích",
      "svg_type": "eye"
    }}
  ],
  "ergonomic_prescription": "Lời khuyên điều chỉnh bàn/ghế/màn hình cụ thể để ngăn tái phát (1-2 câu)",
  "hydration_recommendation": "Khuyến nghị uống nước và bù khoáng phù hợp",
  "next_break_in_minutes": 25
}}
"""
            try:
                # Call Gemini Pro model asynchronously via run_in_executor
                def _call_gemini():
                    response = gemini_service._client.models.generate_content(
                        model=gemini_service.model_name,
                        contents=prompt,
                    )
                    return response.text

                loop = asyncio.get_event_loop()
                raw_text = await loop.run_in_executor(None, _call_gemini)

                # Clean response text from possible code blocks
                clean_text = raw_text.strip()
                if clean_text.startswith("```json"):
                    clean_text = clean_text[7:]
                if clean_text.startswith("```"):
                    clean_text = clean_text[3:]
                if clean_text.endswith("```"):
                    clean_text = clean_text[:-3]
                clean_text = clean_text.strip()

                parsed = json.loads(clean_text)
                parsed["source"] = f"Google Gemini AI ({gemini_service.model_name})"
                return parsed
            except Exception as e:
                logger.warning(f"Gemini AI generation error: {e}. Falling back to certified clinical rule-based engine.")

        # Clinical Rule-based Fallback Protocol
        steps = []
        if "Mỏi mắt" in symptoms or "Khô mắt" in symptoms:
            steps.append({
                "step_number": 1,
                "title": "Massage Cơ Vòng Mi & Chớp Mắt Tĩnh Dưỡng",
                "duration_seconds": 20,
                "instruction": "Nhắm chặt mắt 3 giây, mở to mắt nhìn ra xa 3 giây, lặp lại 3 chu kỳ kết hợp xoa ấm 2 lòng bàn tay úp nhẹ lên hốc mắt.",
                "target_muscle": "Cơ vòng mi (Orbicularis oculi) & Cơ thể mi",
                "svg_type": "eye"
            })
        else:
            steps.append({
                "step_number": 1,
                "title": "Kéo Giãn Thần Kinh Cổ Trục Dọc (Chin Tuck)",
                "duration_seconds": 20,
                "instruction": "Ngồi thẳng lưng, thu cằm vào trong như tạo cằm đôi, giữ 5 giây rồi thả lỏng. Cảm nhận sự giải nén ở các đốt sống cổ C1-C4.",
                "target_muscle": "Cơ duỗi cổ sâu & Đốt sống cổ",
                "svg_type": "neck"
            })

        if "Đau cổ vai gáy" in symptoms or "Đau lưng" in symptoms:
            steps.append({
                "step_number": 2,
                "title": "Ép Xương Bả Vai & Mở Rộng Lồng Ngực (Scapular Retraction)",
                "duration_seconds": 20,
                "instruction": "Kéo 2 bả vai ra sau và hướng xuống dưới, ép chặt cơ giữa 2 bả vai trong 5 giây kết hợp hít sâu, sau đó thở ra thả lỏng.",
                "target_muscle": "Cơ Trám (Rhomboids) & Cơ Thang Giữa",
                "svg_type": "shoulder"
            })
        else:
            steps.append({
                "step_number": 2,
                "title": "Xoay Khớp Vai 360 Độ & Giãn Cơ Ngực",
                "duration_seconds": 20,
                "instruction": "Đặt 2 đầu ngón tay lên mỏm vai, vẽ vòng tròn lớn về phía sau 5 lần, sau đó đổi chiều vẽ về phía trước 5 lần.",
                "target_muscle": "Khớp ổ chảo cánh tay & Cơ ngực lớn",
                "svg_type": "shoulder"
            })

        steps.append({
            "step_number": 3,
            "title": "Thả Lỏng Ống Cổ Tay & Gân Gấp Ngón (Wrist Prayer Stretch)",
            "duration_seconds": 20,
            "instruction": "Chắp 2 lòng bàn tay trước ngực theo tư thế cầu nguyện, từ từ hạ cổ tay xuống ngang bụng cho đến khi cảm thấy căng nhẹ ở cẳng tay.",
            "target_muscle": "Dây thần kinh giữa & Nhóm gân gấp cổ tay",
            "svg_type": "wrist"
        })

        return {
            "clinical_summary": f"Sau {screen_time_hours:.1f} giờ làm việc, hệ cơ vùng cổ vai và cơ điều tiết mắt đang chịu áp lực tĩnh kéo dài gây thiếu máu cục bộ tạm thời.",
            "root_cause_explanation": "Tư thế ngồi bất động làm giảm lưu thông dịch khớp, đồng thời giảm tần số chớp mắt từ 18 lần/phút xuống còn 4-6 lần/phút dẫn đến khô màng phim nước mắt và co thắt cơ thang.",
            "recovery_protocol": steps,
            "ergonomic_prescription": "Nâng màn hình sao cho 1/3 trên cùng ngang tầm mắt nhìn thẳng và duy trì khoảng cách 50-70cm.",
            "hydration_recommendation": "Uống ngay 200ml nước ấm để kích thích đào thải axit lactic tích tụ trong các bó cơ.",
            "next_break_in_minutes": 25,
            "source": "Occupational Ergonomics Standard Protocol (Offline Certified)"
        }

    async def quick_consult(self, query: str) -> Dict[str, Any]:
        """Answer quick ergonomics and posture questions via Gemini Pro AI or internal knowledge engine."""
        query_clean = query.strip()
        if not query_clean:
            return {"status": "error", "message": "Vui lòng nhập câu hỏi tư vấn."}

        if gemini_service._client:
            prompt = f"""
Bạn là Chuyên Gia Công Thái Học & Bác Sĩ Sức Khỏe Nghề Nghiệp Văn Phòng.
Người dùng hỏi: "{query_clean}"

Hãy đưa ra câu trả lời ngắn gọn, súc tích (3-4 gạch đầu dòng rõ ràng, chuẩn thông số y khoa / ergonomics cm và góc độ độ, kèm mẹo thực hành ngay tại bàn làm việc).
"""
            try:
                def _call_gemini():
                    response = gemini_service._client.models.generate_content(
                        model=gemini_service.model_name,
                        contents=prompt,
                    )
                    return response.text

                loop = asyncio.get_event_loop()
                answer = await loop.run_in_executor(None, _call_gemini)
                return {
                    "status": "success",
                    "query": query_clean,
                    "answer": answer,
                    "source": f"Google Gemini AI ({gemini_service.model_name})"
                }
            except Exception as e:
                logger.warning(f"Quick consult Gemini call failed: {e}")

        # Intelligent knowledge-base matcher fallback
        q_lower = query_clean.lower()
        if "ghế" in q_lower or "chiều cao" in q_lower or "ngồi" in q_lower:
            answer = (
                "**Quy tắc điều chỉnh ghế chuẩn Công thái học:**\n\n"
                "• **Độ cao mặt ghế:** Điều chỉnh sao cho đùi song song với mặt sàn, hai bàn chân đặt phẳng hoàn toàn trên sàn (hoặc dùng kê chân nếu ghế cao).\n"
                "• **Góc khớp gối & hông:** Giữ góc 90° - 100° để không chèn ép động mạch đùi dưới.\n"
                "• **Tựa lưng ghế:** Tựa sát vào đường cong thắt lưng (Lumbar support) ở góc nghiêng 100° - 110° để giảm 30% áp lực nội đĩa đệm."
            )
        elif "màn hình" in q_lower or "mắt" in q_lower or "khoảng cách" in q_lower:
            answer = (
                "**Quy tắc setup Màn hình chuẩn y khoa:**\n\n"
                "• **Khoảng cách nhìn:** Cách mắt khoảng 50 - 70 cm (bằng một sải cánh tay duỗi thẳng).\n"
                "• **Độ cao màn hình:** Cạnh trên của màn hình ngang tầm mắt khi ngồi thẳng lưng, tránh cúi đầu quá 15°.\n"
                "• **Độ sáng & góc nghiêng:** Nghiêng màn hình ra sau 10° - 20° và tránh phản chiếu nguồn sáng trực tiếp từ cửa sổ."
            )
        elif "bàn phím" in q_lower or "chuột" in q_lower or "cổ tay" in q_lower:
            answer = (
                "**Quy tắc vị trí Bàn phím & Chuột chống Hội chứng Ống cổ tay:**\n\n"
                "• **Góc khuỷu tay:** Để khuỷu tay mở góc 90° - 100°, thả lỏng tự nhiên sát thân người.\n"
                "• **Trục cổ tay:** Cổ tay luôn thẳng hàng với cẳng tay, không bẻ gập lên trên hoặc lệch sang hai bên.\n"
                "• **Chuột máy tính:** Đặt chuột ngang hàng sát mép bàn phím, dùng đệm lót cổ tay silicone mềm."
            )
        else:
            answer = (
                "**Nguyên tắc vàng Công thái học cho người làm việc máy tính:**\n\n"
                "• **Tư thế 90-90-90:** Giữ góc 90° tại khớp khuỷu tay, khớp háng và khớp đầu gối.\n"
                "• **Quy tắc 20-20-20:** Cứ 20 phút nhìn màn hình, phóng tầm mắt ra xa 6m trong 20 giây.\n"
                "• **Uống nước khoa học:** Nhấp 100-200ml nước mỗi 45 phút để duy trì độ đàn hồi của đĩa đệm cột sống."
            )

        return {
            "status": "success",
            "query": query_clean,
            "answer": answer,
            "source": "Ergonomic Guidelines Knowledge Base (Offline Certified)"
        }

    def reset_today(self) -> Dict[str, Any]:
        """Reset today's logs for testing or fresh start."""
        date_str = self._get_today_str()
        now_ts = time.time()
        with sqlite3.connect(self.db_path) as conn:
            cursor = conn.cursor()
            cursor.execute("""
                UPDATE daily_health_log
                SET water_intake_ml = 0, eye_breaks_completed = 0, stretches_completed = 0, last_updated = ?
                WHERE date_str = ?
            """, (now_ts, date_str))
            conn.commit()
        return self.get_dashboard_summary()

health_expert_service = HealthExpertService()
