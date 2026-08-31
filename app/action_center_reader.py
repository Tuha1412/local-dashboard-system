import asyncio
from datetime import datetime, timezone
import os
import shutil
import sqlite3
import tempfile
import time
from typing import Any, Dict, List, Optional
import xml.etree.ElementTree as ET

class ActionCenterReader:
    def __init__(self, cache_ttl_seconds: float = 1.0):
        self.cache_ttl = cache_ttl_seconds
        self._last_mtime: float = 0.0
        self._last_size: int = 0
        self._last_scan_time: float = 0.0
        self._cached_notifications: List[Dict[str, Any]] = []
        self._lock = asyncio.Lock()
        self._temp_db_path = os.path.join(tempfile.gettempdir(), "spm_wpn_live_sync.db")

    def _get_db_path(self) -> Optional[str]:
        """Locate the Windows Notifications SQLite database."""
        local_app_data = os.environ.get("LOCALAPPDATA", "")
        if not local_app_data:
            return None

        primary_path = os.path.join(local_app_data, "Microsoft", "Windows", "Notifications", "wpndatabase.db")
        if os.path.isfile(primary_path):
            return primary_path

        folder = os.path.join(local_app_data, "Microsoft", "Windows", "Notifications")
        if os.path.isdir(folder):
            for fname in os.listdir(folder):
                if fname.endswith(".db"):
                    return os.path.join(folder, fname)
        return None

    def _clean_app_name(self, primary_id: Optional[str], wns_id: Optional[str]) -> str:
        """Derive a clean, readable Application Name from Windows AUMID or Package ID."""
        raw = primary_id or wns_id or "System"

        known = {
            "Google.AntigravityIDE": "Antigravity IDE",
            "Windows.Defender": "Windows Security",
            "Microsoft.Windows.Search": "Windows Search",
            "Microsoft.Windows.Explorer": "File Explorer",
            "Microsoft.Windows.ShellExperienceHost": "Windows Shell",
            "Microsoft.Windows.ActionCenter": "Action Center",
            "Microsoft.Windows.InputSwitchToastHandler": "Input Switcher",
            "Microsoft.Windows.LanguageComponentsInstaller": "Language Installer",
            "Microsoft.Windows.ParentalControls": "Family Safety",
            "FamilySafety_Settings": "Family Safety",
            "ScreenSketch": "Snipping Tool",
            "Microsoft.ScreenSketch": "Snipping Tool",
            "Microsoft.Windows.SnippingTool": "Snipping Tool",
        }

        for k, v in known.items():
            if k.lower() in raw.lower():
                return v

        if "!" in raw:
            parts = raw.split("!")
            app_sub = parts[-1]
            if app_sub and len(app_sub) > 2:
                return app_sub

        if "_" in raw:
            base = raw.split("_")[0]
            if "." in base:
                return base.split(".")[-1]
            return base

        if "." in raw:
            return raw.split(".")[-1]

        return raw

    def _filetime_to_datetime(self, filetime: int) -> tuple[datetime, str, str]:
        """Convert Windows 64-bit FILETIME (100ns intervals since Jan 1 1601) to datetime."""
        if not filetime or filetime <= 0:
            dt = datetime.now()
            return dt, dt.strftime("%Y-%m-%d %H:%M:%S"), "Recently"

        try:
            epoch = (filetime - 116444736000000000) / 10000000.0
            dt = datetime.fromtimestamp(epoch)
            formatted = dt.strftime("%Y-%m-%d %H:%M:%S")

            now = datetime.now()
            diff_sec = int((now - dt).total_seconds())

            if diff_sec < 60:
                time_ago = "Just now"
            elif diff_sec < 3600:
                time_ago = f"{diff_sec // 60}m ago"
            elif diff_sec < 86400:
                time_ago = f"{diff_sec // 3600}h ago"
            else:
                time_ago = f"{diff_sec // 86400}d ago"

            return dt, formatted, time_ago
        except Exception:
            dt = datetime.now()
            return dt, dt.strftime("%Y-%m-%d %H:%M:%S"), "Recently"

    def _parse_payload_xml(self, payload: Any) -> tuple[str, str]:
        """Extract Title and Body texts from the Notification XML blob."""
        if not payload:
            return "", ""

        if isinstance(payload, bytes):
            try:
                xml_str = payload.decode("utf-8", errors="ignore")
            except Exception:
                xml_str = str(payload)
        else:
            xml_str = str(payload)

        texts = []
        try:
            root = ET.fromstring(xml_str)
            for t in root.iter("text"):
                if t.text and t.text.strip():
                    txt = t.text.strip()
                    if txt not in texts:
                        texts.append(txt)
        except Exception:
            pass

        if not texts:
            return "", ""

        title = texts[0]
        body = " • ".join(texts[1:]) if len(texts) > 1 else ""

        return title, body

    def _read_action_center_sync(self, limit: int = 50) -> List[Dict[str, Any]]:
        """Safely copy the SQLite DB snapshot and query active Windows Toast notifications."""
        db_path = self._get_db_path()
        if not db_path or not os.path.exists(db_path):
            return []

        try:
            # Copy snapshot to temporary location
            shutil.copy2(db_path, self._temp_db_path)
        except Exception:
            return []

        notifications = []

        try:
            conn = sqlite3.connect(self._temp_db_path, timeout=1.0)
            conn.execute("PRAGMA query_only = ON;")
            cursor = conn.cursor()

            # Query only active toast notifications (Type = 'toast' or 'toastCondensed')
            query = """
                SELECT 
                    n.Id, n.Type, n.ArrivalTime, n.Payload,
                    h.PrimaryId, h.WNSId, n.[Order]
                FROM Notification n
                LEFT JOIN NotificationHandler h ON n.HandlerId = h.RecordId
                WHERE n.Type IN ('toast', 'toastCondensed')
                ORDER BY n.ArrivalTime DESC
                LIMIT ?;
            """
            cursor.execute(query, (limit,))
            rows = cursor.fetchall()
            conn.close()

            for row in rows:
                nid, ntype, arr_time, payload, primary_id, wns_id, order_id = row

                title, body = self._parse_payload_xml(payload)
                # Skip empty items without message text
                if not title and not body:
                    continue

                app_name = self._clean_app_name(primary_id, wns_id)
                dt, formatted_time, time_ago = self._filetime_to_datetime(arr_time)

                unique_id = f"toast_{nid}_{arr_time}_{order_id}"

                notifications.append({
                    "id": unique_id,
                    "record_id": nid,
                    "app_name": app_name,
                    "app_id": primary_id or wns_id or "System",
                    "title": title,
                    "body": body,
                    "type": (ntype or "toast").capitalize(),
                    "time": formatted_time,
                    "time_ago": time_ago,
                    "timestamp": dt.timestamp(),
                })
        except Exception:
            pass

        notifications.sort(key=lambda x: x.get("timestamp", 0), reverse=True)
        return notifications[:limit]

    async def get_action_center_notifications_async(self, limit: int = 50, force: bool = False) -> Dict[str, Any]:
        """Fetch Action Center notifications with microsecond mtime change detection."""
        now = time.time()
        db_path = self._get_db_path()

        if not db_path or not os.path.exists(db_path):
            return {
                "total_count": 0,
                "is_cached": False,
                "notifications": [],
            }

        try:
            stat = os.stat(db_path)
            current_mtime = stat.st_mtime
            current_size = stat.st_size
        except Exception:
            current_mtime = now
            current_size = 0

        async with self._lock:
            # If DB file has not changed and cache is fresh within 1.0s, return cached in < 0.01ms
            if not force and self._cached_notifications is not None:
                if current_mtime == self._last_mtime and current_size == self._last_size and (now - self._last_scan_time < self.cache_ttl):
                    return {
                        "total_count": len(self._cached_notifications),
                        "is_cached": True,
                        "notifications": self._cached_notifications,
                    }

            # File changed or forced: read snapshot in background thread
            events = await asyncio.to_thread(self._read_action_center_sync, limit)
            self._cached_notifications = events
            self._last_mtime = current_mtime
            self._last_size = current_size
            self._last_scan_time = now

            return {
                "total_count": len(events),
                "is_cached": False,
                "notifications": events,
            }

action_center_reader = ActionCenterReader(cache_ttl_seconds=1.0)
