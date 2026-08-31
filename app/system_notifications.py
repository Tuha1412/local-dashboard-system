import asyncio
import os
import platform
import subprocess
import time
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Set
import xml.etree.ElementTree as ET

class NotificationCollector:
    def __init__(self, cache_ttl_seconds: int = 30):
        self.cache_ttl = cache_ttl_seconds
        self._last_scan_time = 0.0
        self._cached_notifications: List[Dict[str, Any]] = []
        self._read_ids: Set[str] = set()
        self._lock = asyncio.Lock()

    def _format_time_ago(self, dt: datetime) -> str:
        """Convert datetime to relative time string (e.g., '5 mins ago')."""
        now = datetime.now()
        diff = now - dt
        seconds = int(diff.total_seconds())

        if seconds < 60:
            return "Just now"
        elif seconds < 3600:
            mins = seconds // 60
            return f"{mins}m ago"
        elif seconds < 86400:
            hours = seconds // 3600
            return f"{hours}h ago"
        else:
            days = seconds // 86400
            return f"{days}d ago"

    def _parse_event_xml(self, xml_output: str, channel: str) -> List[Dict[str, Any]]:
        """Parse raw XML output from wevtutil into structured notification objects."""
        if not xml_output.strip():
            return []

        wrapped_xml = f"<Events>{xml_output}</Events>"
        notifications = []
        ns = "{http://schemas.microsoft.com/win/2004/08/events/event}"

        try:
            root = ET.fromstring(wrapped_xml)
            for event_node in root.findall(f"{ns}Event"):
                sys_node = event_node.find(f"{ns}System")
                if sys_node is None:
                    continue

                prov_node = sys_node.find(f"{ns}Provider")
                level_node = sys_node.find(f"{ns}Level")
                time_node = sys_node.find(f"{ns}TimeCreated")
                rec_node = sys_node.find(f"{ns}EventRecordID")
                event_id_node = sys_node.find(f"{ns}EventID")

                record_id = rec_node.text.strip() if rec_node is not None and rec_node.text else str(time.time())
                event_id = event_id_node.text.strip() if event_id_node is not None and event_id_node.text else "0"
                provider = prov_node.attrib.get("Name", channel) if prov_node is not None else channel

                # Level mapping: 1 = Critical, 2 = Error, 3 = Warning, 4 = Info
                lvl_val = int(level_node.text) if level_node is not None and level_node.text else 4
                if lvl_val == 1:
                    level_str = "Critical"
                elif lvl_val == 2:
                    level_str = "Error"
                elif lvl_val == 3:
                    level_str = "Warning"
                else:
                    level_str = "Info"

                # Parse timestamp
                iso_time = time_node.attrib.get("SystemTime", "") if time_node is not None else ""
                parsed_dt = datetime.now()
                formatted_time = ""
                time_ago = "Recently"
                if iso_time:
                    try:
                        clean_iso = iso_time[:19]
                        parsed_dt = datetime.strptime(clean_iso, "%Y-%m-%dT%H:%M:%S")
                        formatted_time = parsed_dt.strftime("%Y-%m-%d %H:%M:%S")
                        time_ago = self._format_time_ago(parsed_dt)
                    except Exception:
                        formatted_time = iso_time[:19].replace("T", " ")

                # Extract event message / data values
                message_parts = []
                event_data = event_node.find(f"{ns}EventData")
                if event_data is not None:
                    for data_elem in event_data.findall(f"{ns}Data"):
                        if data_elem.text:
                            txt = data_elem.text.strip()
                            if txt and len(txt) > 1 and not txt.startswith("{"):
                                message_parts.append(txt)

                user_data = event_node.find(f"{ns}UserData")
                if user_data is not None:
                    for elem in user_data.iter():
                        if elem.text and elem.text.strip():
                            txt = elem.text.strip()
                            if len(txt) > 2 and not txt.startswith("{"):
                                message_parts.append(txt)

                if message_parts:
                    message = " • ".join(message_parts[:3])
                    if len(message) > 180:
                        message = message[:177] + "..."
                else:
                    message = f"Event #{event_id} logged by {provider} in {channel} channel."

                notif_id = f"{channel}_{record_id}"

                notifications.append({
                    "id": notif_id,
                    "event_id": event_id,
                    "title": provider,
                    "message": message,
                    "level": level_str,
                    "channel": channel,
                    "time": formatted_time,
                    "time_ago": time_ago,
                    "timestamp": parsed_dt.timestamp(),
                    "read": notif_id in self._read_ids,
                })
        except Exception:
            pass

        return notifications

    def _collect_windows_events_sync(self, limit: int = 20) -> List[Dict[str, Any]]:
        """Collect recent system and application warning/error/info events on Windows."""
        all_events = []

        if platform.system() != "Windows":
            return [
                {
                    "id": "sys_welcome",
                    "event_id": "100",
                    "title": "System Monitor",
                    "message": "Performance monitor telemetry daemon is active and monitoring.",
                    "level": "Info",
                    "channel": "System",
                    "time": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                    "time_ago": "Just now",
                    "timestamp": time.time(),
                    "read": "sys_welcome" in self._read_ids,
                }
            ]

        # Query System log for Warnings, Errors, Criticals
        try:
            cmd_system = [
                "wevtutil", "qe", "System",
                "/q:*[System[(Level=1 or Level=2 or Level=3)]]",
                f"/c:{limit}",
                "/rd:true",
                "/f:xml"
            ]
            res_system = subprocess.run(cmd_system, capture_output=True, text=True, timeout=3)
            if res_system.returncode == 0:
                all_events.extend(self._parse_event_xml(res_system.stdout, "System"))
        except Exception:
            pass

        # Query Application log for Warnings, Errors, Criticals
        try:
            cmd_app = [
                "wevtutil", "qe", "Application",
                "/q:*[System[(Level=1 or Level=2 or Level=3)]]",
                f"/c:{limit}",
                "/rd:true",
                "/f:xml"
            ]
            res_app = subprocess.run(cmd_app, capture_output=True, text=True, timeout=3)
            if res_app.returncode == 0:
                all_events.extend(self._parse_event_xml(res_app.stdout, "Application"))
        except Exception:
            pass

        # Fallback if no recent errors found: fetch recent info events
        if not all_events:
            try:
                cmd_info = [
                    "wevtutil", "qe", "System",
                    "/c:10",
                    "/rd:true",
                    "/f:xml"
                ]
                res_info = subprocess.run(cmd_info, capture_output=True, text=True, timeout=3)
                if res_info.returncode == 0:
                    all_events.extend(self._parse_event_xml(res_info.stdout, "System"))
            except Exception:
                pass

        # Sort descending by timestamp
        all_events.sort(key=lambda x: x.get("timestamp", 0), reverse=True)
        return all_events[:limit]

    async def get_notifications_async(self, limit: int = 25, force: bool = False) -> Dict[str, Any]:
        """Fetch notifications asynchronously with in-memory caching."""
        now = time.time()

        async with self._lock:
            if not force and self._cached_notifications and (now - self._last_scan_time < self.cache_ttl):
                # Update read states from memory
                for n in self._cached_notifications:
                    n["read"] = n["id"] in self._read_ids
                unread_count = sum(1 for n in self._cached_notifications if not n["read"])
                return {
                    "unread_count": unread_count,
                    "total_count": len(self._cached_notifications),
                    "is_cached": True,
                    "notifications": self._cached_notifications,
                }

            events = await asyncio.to_thread(self._collect_windows_events_sync, limit)
            for n in events:
                n["read"] = n["id"] in self._read_ids

            self._cached_notifications = events
            self._last_scan_time = now
            unread_count = sum(1 for n in events if not n["read"])

            return {
                "unread_count": unread_count,
                "total_count": len(events),
                "is_cached": False,
                "notifications": events,
            }

    def mark_as_read(self, notif_id: Optional[str] = None):
        """Mark single or all notifications as read."""
        if notif_id:
            self._read_ids.add(notif_id)
        else:
            for n in self._cached_notifications:
                self._read_ids.add(n["id"])

notification_collector = NotificationCollector(cache_ttl_seconds=30)
