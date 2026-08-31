"""
Resource Threshold Alerting & Webhook Notifications Engine.
Monitors CPU, RAM, and Disk free space thresholds and sends real-time rich alerts
to Discord Webhooks and Telegram Bots with anti-spam cooldown and process insights.
"""

import asyncio
import json
import logging
import os
import platform
import socket
import time
from collections import deque
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import httpx

logger = logging.getLogger("alert_engine")

BASE_DIR = Path(__file__).resolve().parent.parent
CONFIG_FILE = BASE_DIR / "alert_config.json"

DEFAULT_CONFIG: Dict[str, Any] = {
    "enabled": True,
    "cpu_enabled": True,
    "cpu_threshold": 90.0,         # %
    "cpu_sustained_sec": 30,        # Must stay > threshold for 30s
    "ram_enabled": True,
    "ram_threshold": 85.0,         # %
    "disk_enabled": True,
    "disk_c_free_min_gb": 5.0,      # GB minimum free on drive C
    "cooldown_minutes": 10,         # Anti-spam cooldown per alert type
    "discord_enabled": False,
    "discord_webhook_url": "",
    "telegram_enabled": False,
    "telegram_bot_token": "",
    "telegram_chat_id": "",
}


class AlertEngine:
    def __init__(self):
        self.config: Dict[str, Any] = self._load_config()
        self._is_running = False
        self._bg_task: Optional[asyncio.Task] = None
        self._collector = None

        # Tracking state
        self._last_alert_times: Dict[str, float] = {
            "cpu": 0.0,
            "ram": 0.0,
            "disk": 0.0,
        }
        self._cpu_crossed_start_time: Optional[float] = None
        self._was_in_alert_state: Dict[str, bool] = {
            "cpu": False,
            "ram": False,
            "disk": False,
        }

        # Alert history log (in-memory deque of last 50 alerts)
        self.alert_history: deque = deque(maxlen=50)

    def _load_config(self) -> Dict[str, Any]:
        """Load configuration from JSON file or fall back to default."""
        config = DEFAULT_CONFIG.copy()
        if CONFIG_FILE.exists():
            try:
                with open(CONFIG_FILE, "r", encoding="utf-8") as f:
                    saved = json.load(f)
                    config.update(saved)
            except Exception as e:
                logger.error(f"Error loading {CONFIG_FILE}: {e}. Using defaults.")
        else:
            self._save_config(config)
        return config

    def _save_config(self, config_data: Dict[str, Any]) -> bool:
        """Persist configuration to JSON file."""
        try:
            with open(CONFIG_FILE, "w", encoding="utf-8") as f:
                json.dump(config_data, f, indent=2, ensure_ascii=False)
            return True
        except Exception as e:
            logger.error(f"Error saving {CONFIG_FILE}: {e}")
            return False

    def get_config(self) -> Dict[str, Any]:
        """Return public configuration with masked credentials for UI display."""
        cfg = self.config.copy()
        # Create masked versions of sensitive tokens for display
        webhook_url = cfg.get("discord_webhook_url", "")
        if webhook_url and len(webhook_url) > 24:
            cfg["discord_webhook_url_masked"] = webhook_url[:12] + "..." + webhook_url[-8:]
        else:
            cfg["discord_webhook_url_masked"] = ""

        bot_token = cfg.get("telegram_bot_token", "")
        if bot_token and len(bot_token) > 10:
            cfg["telegram_bot_token_masked"] = bot_token[:5] + "..." + bot_token[-4:]
        else:
            cfg["telegram_bot_token_masked"] = ""

        return cfg

    def update_config(self, new_cfg: Dict[str, Any]) -> Dict[str, Any]:
        """Update and persist configuration."""
        for key in DEFAULT_CONFIG.keys():
            if key in new_cfg:
                self.config[key] = new_cfg[key]

        # Validation & Type casting
        try:
            self.config["cpu_threshold"] = float(self.config.get("cpu_threshold", 90.0))
            self.config["cpu_sustained_sec"] = int(self.config.get("cpu_sustained_sec", 30))
            self.config["ram_threshold"] = float(self.config.get("ram_threshold", 85.0))
            self.config["disk_c_free_min_gb"] = float(self.config.get("disk_c_free_min_gb", 5.0))
            self.config["cooldown_minutes"] = int(self.config.get("cooldown_minutes", 10))
        except (ValueError, TypeError):
            pass

        self._save_config(self.config)
        return self.get_config()

    def start_background_monitor(self, collector_instance):
        """Start the background monitor task."""
        self._collector = collector_instance
        if not self._is_running:
            self._is_running = True
            self._bg_task = asyncio.create_task(self._monitor_loop())
            logger.info("AlertEngine background monitor started.")

    def stop_background_monitor(self):
        """Stop the background monitor task."""
        self._is_running = False
        if self._bg_task:
            self._bg_task.cancel()
            logger.info("AlertEngine background monitor stopped.")

    async def _monitor_loop(self):
        """Continuous background evaluation loop checking metrics every 5 seconds."""
        # Initial warmup delay so system metrics initialize
        await asyncio.sleep(5)
        while self._is_running:
            try:
                if self.config.get("enabled", True) and self._collector:
                    metrics = self._collector.get_all_metrics()
                    await self.evaluate_metrics(metrics)
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"Error in AlertEngine monitor loop: {e}", exc_info=True)

            await asyncio.sleep(5)

    async def evaluate_metrics(self, metrics: Dict[str, Any]):
        """Evaluate current system metrics against configured thresholds."""
        if not self.config.get("enabled", True):
            return

        # Check if at least one channel is active
        discord_on = self.config.get("discord_enabled", False) and bool(self.config.get("discord_webhook_url"))
        telegram_on = self.config.get("telegram_enabled", False) and bool(self.config.get("telegram_bot_token")) and bool(self.config.get("telegram_chat_id"))

        if not (discord_on or telegram_on):
            return

        now = time.time()
        cooldown_sec = self.config.get("cooldown_minutes", 10) * 60

        hostname = metrics.get("os", {}).get("hostname", socket.gethostname())
        proc_data = metrics.get("processes", {})
        if isinstance(proc_data, dict):
            procs_by_cpu = proc_data.get("by_cpu", [])
            procs_by_ram = proc_data.get("by_ram", [])
        elif isinstance(proc_data, list):
            procs_by_cpu = proc_data
            procs_by_ram = proc_data
        else:
            procs_by_cpu = []
            procs_by_ram = []

        # =====================================================================
        # 1. CPU Threshold Check
        # =====================================================================
        if self.config.get("cpu_enabled", True):
            cpu_val = metrics.get("cpu", {}).get("overall_percent", 0.0)
            cpu_thresh = self.config.get("cpu_threshold", 90.0)
            cpu_sustained = self.config.get("cpu_sustained_sec", 30)

            if cpu_val >= cpu_thresh:
                if self._cpu_crossed_start_time is None:
                    self._cpu_crossed_start_time = now

                duration_over = now - self._cpu_crossed_start_time
                if duration_over >= cpu_sustained:
                    # Check anti-spam cooldown
                    last_time = self._last_alert_times.get("cpu", 0.0)
                    if (now - last_time) >= cooldown_sec or not self._was_in_alert_state.get("cpu", False):
                        self._last_alert_times["cpu"] = now
                        self._was_in_alert_state["cpu"] = True

                        # Extract top CPU processes
                        top_procs = procs_by_cpu[:4] if procs_by_cpu else []
                        ghz = metrics.get("cpu", {}).get("frequency", {}).get("current_ghz")
                        freq_str = f" • {ghz} GHz" if ghz else ""

                        await self._dispatch_alert(
                            alert_type="CPU",
                            resource_name="Vi Xử Lý (CPU)",
                            current_value=f"{cpu_val:.1f}%{freq_str}",
                            threshold_value=f">{cpu_thresh:.1f}% (duy trì {cpu_sustained}s)",
                            level="CRITICAL" if cpu_val >= 95 else "WARNING",
                            hostname=hostname,
                            top_processes=top_procs,
                            extra_info=f"CPU đã vượt ngưỡng {cpu_thresh:.0f}% liên tục trong {int(duration_over)}s."
                        )
            else:
                self._cpu_crossed_start_time = None
                self._was_in_alert_state["cpu"] = False

        # =====================================================================
        # 2. RAM Threshold Check
        # =====================================================================
        if self.config.get("ram_enabled", True):
            ram_info = metrics.get("memory", {}).get("ram", {})
            ram_val = ram_info.get("percent", 0.0)
            ram_thresh = self.config.get("ram_threshold", 85.0)

            if ram_val >= ram_thresh:
                last_time = self._last_alert_times.get("ram", 0.0)
                if (now - last_time) >= cooldown_sec or not self._was_in_alert_state.get("ram", False):
                    self._last_alert_times["ram"] = now
                    self._was_in_alert_state["ram"] = True

                    top_procs = procs_by_ram[:4] if procs_by_ram else []
                    used_gb = ram_info.get("used_gb", 0)
                    total_gb = ram_info.get("total_gb", 0)

                    await self._dispatch_alert(
                        alert_type="RAM",
                        resource_name="Bộ Nhớ RAM",
                        current_value=f"{ram_val:.1f}% ({used_gb:.1f} GB / {total_gb:.1f} GB)",
                        threshold_value=f">{ram_thresh:.1f}%",
                        level="CRITICAL" if ram_val >= 92 else "WARNING",
                        hostname=hostname,
                        top_processes=top_procs,
                        extra_info=f"Bộ nhớ RAM khả dụng còn lại rất thấp (còn {ram_info.get('available_gb', 0):.1f} GB)."
                    )
            else:
                self._was_in_alert_state["ram"] = False

        # =====================================================================
        # 3. Disk C Free Space Check
        # =====================================================================
        if self.config.get("disk_enabled", True):
            partitions = metrics.get("disk", {}).get("partitions", [])
            drive_c = None
            for p in partitions:
                mount = p.get("mountpoint", "").upper()
                if mount.startswith("C:") or mount == "C:\\" or mount == "/":
                    drive_c = p
                    break

            if drive_c:
                free_gb = drive_c.get("free_gb", 999.0)
                used_pct = drive_c.get("percent", 0.0)
                min_free_gb = self.config.get("disk_c_free_min_gb", 5.0)

                if free_gb <= min_free_gb or used_pct >= 95.0:
                    last_time = self._last_alert_times.get("disk", 0.0)
                    if (now - last_time) >= cooldown_sec or not self._was_in_alert_state.get("disk", False):
                        self._last_alert_times["disk"] = now
                        self._was_in_alert_state["disk"] = True

                        total_c = drive_c.get("total_gb", 0)
                        await self._dispatch_alert(
                            alert_type="DISK",
                            resource_name="Dung Lượng Ổ Đĩa Hệ Thống (C:)",
                            current_value=f"Còn trống {free_gb:.1f} GB / {total_c:.1f} GB ({used_pct:.1f}% đã dùng)",
                            threshold_value=f"< {min_free_gb:.1f} GB trống",
                            level="CRITICAL" if free_gb < 2.0 else "WARNING",
                            hostname=hostname,
                            top_processes=[],
                            extra_info="Dung lượng ổ đĩa cài đặt hệ điều hành sắp cạn kiệt, có thể gây treo ứng dụng hoặc crash hệ thống."
                        )
                else:
                    self._was_in_alert_state["disk"] = False

    async def _dispatch_alert(
        self,
        alert_type: str,
        resource_name: str,
        current_value: str,
        threshold_value: str,
        level: str,
        hostname: str,
        top_processes: List[Dict[str, Any]],
        extra_info: str = "",
        is_test: bool = False,
    ) -> Dict[str, Any]:
        """Construct and send alert payload to Discord and/or Telegram."""
        now_dt = datetime.now()
        time_str = now_dt.strftime("%d/%m/%Y %H:%M:%S")
        iso_str = now_dt.isoformat()

        # Format Top processes block
        proc_lines = []
        if top_processes:
            for idx, p in enumerate(top_processes, 1):
                name = p.get("name", "Unknown")
                cpu = p.get("cpu_percent", 0)
                mem_mb = p.get("memory_mb", 0)
                proc_lines.append(f"**{idx}. {name}**: {cpu:.1f}% CPU | {mem_mb:.0f} MB RAM")
        proc_text = "\n".join(proc_lines) if proc_lines else "*(Không có thông tin tiến trình)*"

        # Results tracking
        results = {
            "id": f"alert_{int(time.time() * 1000)}",
            "timestamp": iso_str,
            "formatted_time": time_str,
            "type": alert_type,
            "level": level,
            "resource": resource_name,
            "current_value": current_value,
            "threshold_value": threshold_value,
            "is_test": is_test,
            "discord": {"attempted": False, "success": False, "error": None},
            "telegram": {"attempted": False, "success": False, "error": None},
        }

        # 1. Send Discord Webhook
        discord_url = self.config.get("discord_webhook_url", "").strip()
        if (self.config.get("discord_enabled", False) or is_test) and discord_url:
            results["discord"]["attempted"] = True
            discord_success, discord_err = await self._send_discord_webhook(
                webhook_url=discord_url,
                alert_type=alert_type,
                resource_name=resource_name,
                current_value=current_value,
                threshold_value=threshold_value,
                level=level,
                hostname=hostname,
                proc_text=proc_text,
                time_str=time_str,
                extra_info=extra_info,
                is_test=is_test,
            )
            results["discord"]["success"] = discord_success
            results["discord"]["error"] = discord_err

        # 2. Send Telegram Bot
        tg_token = self.config.get("telegram_bot_token", "").strip()
        tg_chat_id = self.config.get("telegram_chat_id", "").strip()
        if (self.config.get("telegram_enabled", False) or is_test) and tg_token and tg_chat_id:
            results["telegram"]["attempted"] = True
            tg_success, tg_err = await self._send_telegram_message(
                bot_token=tg_token,
                chat_id=tg_chat_id,
                alert_type=alert_type,
                resource_name=resource_name,
                current_value=current_value,
                threshold_value=threshold_value,
                level=level,
                hostname=hostname,
                top_processes=top_processes,
                time_str=time_str,
                extra_info=extra_info,
                is_test=is_test,
            )
            results["telegram"]["success"] = tg_success
            results["telegram"]["error"] = tg_err

        # Store in history
        self.alert_history.appendleft(results)
        return results

    async def _send_discord_webhook(
        self,
        webhook_url: str,
        alert_type: str,
        resource_name: str,
        current_value: str,
        threshold_value: str,
        level: str,
        hostname: str,
        proc_text: str,
        time_str: str,
        extra_info: str,
        is_test: bool,
    ) -> Tuple[bool, Optional[str]]:
        """Send rich embed notification to Discord."""
        # Color codes: Red for Critical, Amber for Warning, Cyan for Test
        color = 0x38bdf8 if is_test else (0xf87171 if level == "CRITICAL" else 0xfb923c)
        tag_title = "🧪 [THỬ NGHIỆM KẾT NỐI]" if is_test else f"🚨 [CẢNH BÁO {level}] TÀI NGUYÊN QUÁ TẢI"

        embed = {
            "title": tag_title,
            "description": f"Hệ thống giám sát phát hiện tài nguyên trên máy tính **{hostname}** đang vượt ngưỡng quy định!",
            "color": color,
            "fields": [
                {
                    "name": "🖥️ Máy Tính & Hệ Thống",
                    "value": f"**{hostname}** ({platform.system()} {platform.release()})",
                    "inline": True,
                },
                {
                    "name": "⚡ Tài Nguyên Bị Ảnh Hưởng",
                    "value": f"**{resource_name}**",
                    "inline": True,
                },
                {
                    "name": "📊 Chỉ Số Thực Tế",
                    "value": f"```diff\n- {current_value}\n```",
                    "inline": False,
                },
                {
                    "name": "🎯 Ngưỡng Cảnh Báo",
                    "value": f"`{threshold_value}`",
                    "inline": True,
                },
                {
                    "name": "⏱️ Thời Điểm",
                    "value": f"`{time_str}`",
                    "inline": True,
                },
                {
                    "name": "🔥 Top Tiến Trình Chiếm Dụng Cao Nhất",
                    "value": proc_text,
                    "inline": False,
                },
            ],
            "footer": {
                "text": "Local Performance Monitor • Auto-Alert Engine",
                "icon_url": "https://cdn-icons-png.flaticon.com/512/900/900782.png"
            },
            "timestamp": datetime.now(timezone.utc).isoformat()
        }

        if extra_info:
            embed["fields"].append({
                "name": "💡 Chi Tiết Bổ Sung",
                "value": extra_info,
                "inline": False
            })

        payload = {
            "username": "Local Dashboard Alert Bot",
            "avatar_url": "https://cdn-icons-png.flaticon.com/512/900/900782.png",
            "embeds": [embed]
        }

        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                res = await client.post(webhook_url, json=payload)
                if res.status_code in (200, 204):
                    logger.info(f"Discord alert sent successfully for {alert_type}")
                    return True, None
                else:
                    err_msg = f"Discord Webhook returned HTTP {res.status_code}: {res.text[:200]}"
                    logger.warning(err_msg)
                    return False, err_msg
        except Exception as e:
            err_msg = f"Exception sending Discord webhook: {str(e)}"
            logger.error(err_msg)
            return False, err_msg

    async def _send_telegram_message(
        self,
        bot_token: str,
        chat_id: str,
        alert_type: str,
        resource_name: str,
        current_value: str,
        threshold_value: str,
        level: str,
        hostname: str,
        top_processes: List[Dict[str, Any]],
        time_str: str,
        extra_info: str,
        is_test: bool,
    ) -> Tuple[bool, Optional[str]]:
        """Send formatted HTML alert message to Telegram."""
        tag_title = "🧪 <b>[THỬ NGHIỆM] KẾT NỐI TELEGRAM THÀNH CÔNG</b>" if is_test else f"🚨 <b>[CẢNH BÁO {level}] HỆ THỐNG QUÁ TẢI</b>"

        proc_lines = []
        if top_processes:
            for idx, p in enumerate(top_processes, 1):
                name = p.get("name", "Unknown")
                cpu = p.get("cpu_percent", 0)
                mem_mb = p.get("memory_mb", 0)
                proc_lines.append(f"  {idx}. <code>{name}</code>: {cpu:.1f}% CPU | {mem_mb:.0f} MB")
        proc_html = "\n".join(proc_lines) if proc_lines else "  <i>(Không có tiến trình nổi bật)</i>"

        text = (
            f"{tag_title}\n\n"
            f"🖥️ <b>Máy tính:</b> <code>{hostname}</code>\n"
            f"⚡ <b>Tài nguyên:</b> <b>{resource_name}</b>\n"
            f"📊 <b>Chỉ số hiện tại:</b> <b>{current_value}</b>\n"
            f"🎯 <b>Ngưỡng quy định:</b> <code>{threshold_value}</code>\n"
            f"⏱️ <b>Thời điểm:</b> <code>{time_str}</code>\n\n"
            f"🔥 <b>Top tiến trình chiếm dụng:</b>\n{proc_html}\n"
        )
        if extra_info:
            text += f"\n💡 <i>{extra_info}</i>\n"

        text += "\n<i>🛡️ Local System Performance Monitor • Auto-Alert Engine</i>"

        url = f"https://api.telegram.org/bot{bot_token}/sendMessage"
        payload = {
            "chat_id": chat_id,
            "text": text,
            "parse_mode": "HTML",
            "disable_web_page_preview": True,
        }

        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                res = await client.post(url, json=payload)
                if res.status_code == 200:
                    resp_json = res.json()
                    if resp_json.get("ok"):
                        logger.info(f"Telegram alert sent successfully for {alert_type}")
                        return True, None
                    else:
                        err_msg = f"Telegram error: {resp_json.get('description', 'Unknown error')}"
                        return False, err_msg
                else:
                    err_msg = f"Telegram API HTTP {res.status_code}: {res.text[:200]}"
                    return False, err_msg
        except Exception as e:
            err_msg = f"Exception sending Telegram message: {str(e)}"
            logger.error(err_msg)
            return False, err_msg

    async def send_test_alert(self, custom_config: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """Send a test notification using current or supplied configuration."""
        cfg_to_use = self.config.copy()
        if custom_config:
            cfg_to_use.update(custom_config)

        # Temporary apply config for test dispatch
        original_cfg = self.config
        self.config = cfg_to_use

        hostname = socket.gethostname()
        top_procs = [
            {"name": "chrome.exe", "cpu_percent": 18.5, "memory_mb": 850},
            {"name": "python.exe", "cpu_percent": 12.0, "memory_mb": 320},
            {"name": "antigravity.exe", "cpu_percent": 8.2, "memory_mb": 640},
        ]

        try:
            res = await self._dispatch_alert(
                alert_type="TEST",
                resource_name="Thông Báo Kiểm Tra (Test Webhook)",
                current_value="Kiểm tra đường truyền webhook hoạt động bình thường 100%",
                threshold_value="Manual Test Trigger",
                level="INFO",
                hostname=hostname,
                top_processes=top_procs,
                extra_info="Nếu bạn nhìn thấy tin nhắn này, hệ thống cảnh báo Discord / Telegram của Dashboard đã được thiết lập chính xác!",
                is_test=True
            )
            return res
        finally:
            self.config = original_cfg

    def clear_history(self):
        """Clear all stored alert history entries."""
        self.alert_history.clear()


# Singleton instance
alert_engine = AlertEngine()
