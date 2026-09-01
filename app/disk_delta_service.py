import asyncio
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
import glob
import os
from pathlib import Path
import shutil
import sqlite3
import subprocess
import time
from typing import Any, Dict, List, Optional, Set, Tuple

BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = BASE_DIR / "data"
DB_PATH = DATA_DIR / "disk_snapshots.db"

# Protected paths and filenames that MUST NEVER be deleted
PROTECTED_SYSTEM_PATHS = {
    r"C:\Windows",
    r"C:\Windows\System32",
    r"C:\Windows\SysWOW64",
    r"C:\Windows\WinSxS",
    r"C:\Windows\SystemResources",
    r"C:\Windows\Boot",
    r"C:\Program Files",
    r"C:\Program Files (x86)",
    r"C:\Users",
    r"C:\Recovery",
    r"C:\System Volume Information",
    r"C:\$Recycle.Bin",
    r"C:\\",
    r"C:",
}

PROTECTED_FILE_NAMES = {
    "pagefile.sys",
    "hiberfil.sys",
    "swapfile.sys",
    "dumpstack.log",
    "bootmgr",
    "ntldr",
    "ntoskrnl.exe",
    "kernel32.dll",
    "user32.dll",
    "hal.dll",
}

class DiskDeltaService:
    def __init__(self, max_workers: int = 8):
        self.max_workers = max_workers
        self._init_lock = asyncio.Lock()
        self._scan_lock = asyncio.Lock()
        self._ensure_db()

    def _ensure_db(self):
        """Initialize SQLite database schema for snapshots."""
        DATA_DIR.mkdir(parents=True, exist_ok=True)
        with sqlite3.connect(DB_PATH) as conn:
            cursor = conn.cursor()
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS snapshots (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    created_at TEXT NOT NULL,
                    label TEXT NOT NULL,
                    total_bytes INTEGER NOT NULL,
                    item_count INTEGER NOT NULL,
                    note TEXT DEFAULT ''
                )
            """)
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS snapshot_items (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    snapshot_id INTEGER NOT NULL,
                    path TEXT NOT NULL,
                    name TEXT NOT NULL,
                    is_dir INTEGER NOT NULL,
                    size_bytes INTEGER NOT NULL,
                    file_count INTEGER NOT NULL,
                    category TEXT NOT NULL,
                    last_modified TEXT NOT NULL,
                    FOREIGN KEY(snapshot_id) REFERENCES snapshots(id) ON DELETE CASCADE
                )
            """)
            cursor.execute("CREATE INDEX IF NOT EXISTS idx_snap_items_snap_id ON snapshot_items(snapshot_id)")
            cursor.execute("CREATE INDEX IF NOT EXISTS idx_snap_items_path ON snapshot_items(path)")
            conn.commit()

    def _get_hotspot_targets(self) -> List[Dict[str, Any]]:
        """
        Build the list of hot folders and files on Drive C known for rapid bloat/growth.
        """
        targets = []
        user_profile = os.environ.get("USERPROFILE", r"C:\Users\Default")
        local_appdata = os.environ.get("LOCALAPPDATA", os.path.join(user_profile, "AppData", "Local"))
        appdata_roaming = os.environ.get("APPDATA", os.path.join(user_profile, "AppData", "Roaming"))
        win_dir = os.environ.get("SystemRoot", r"C:\Windows")
        prog_data = os.environ.get("ProgramData", r"C:\ProgramData")

        # 1. Root System Virtual Memory Files
        for root_file in ["pagefile.sys", "hiberfil.sys", "swapfile.sys", "DumpStack.log"]:
            fpath = os.path.join(r"C:\\", root_file)
            targets.append({
                "type": "file",
                "path": fpath,
                "category": "Virtual Memory" if "sys" in root_file else "System Log",
                "max_depth": 0
            })

        # 2. Windows Temp & User Temp
        targets.append({
            "type": "dir_children",
            "path": os.path.join(win_dir, "Temp"),
            "category": "Temp & Junk",
            "max_depth": 1
        })
        targets.append({
            "type": "dir_children",
            "path": os.path.join(local_appdata, "Temp"),
            "category": "Temp & Junk",
            "max_depth": 1
        })

        # 3. Windows Logs & Dumps
        targets.append({
            "type": "dir_children",
            "path": os.path.join(win_dir, "Logs"),
            "category": "System Log",
            "max_depth": 2
        })
        for extra_log in ["MEMORY.DMP", "Minidump"]:
            targets.append({
                "type": "file_or_dir",
                "path": os.path.join(win_dir, extra_log),
                "category": "Crash Dump",
                "max_depth": 1
            })

        # 4. Windows Update & SoftwareDistribution
        targets.append({
            "type": "dir_children",
            "path": os.path.join(win_dir, "SoftwareDistribution", "Download"),
            "category": "Windows Update",
            "max_depth": 1
        })
        targets.append({
            "type": "dir_children",
            "path": os.path.join(win_dir, "SoftwareDistribution", "DataStore"),
            "category": "Windows Update",
            "max_depth": 1
        })

        # 5. ProgramData Key Folders
        if os.path.exists(prog_data):
            targets.append({
                "type": "dir_children",
                "path": prog_data,
                "category": "Application Data",
                "max_depth": 1
            })

        # 6. User AppData Local Key Bloat Areas
        if os.path.exists(local_appdata):
            targets.append({
                "type": "dir_children",
                "path": local_appdata,
                "category": "AppData Cache",
                "max_depth": 1
            })

            # Specific high-bloat browser/app cache subfolders
            cache_subpaths = [
                (os.path.join(local_appdata, "CrashDumps"), "Crash Dump"),
                (os.path.join(local_appdata, "Google", "Chrome", "User Data", "Default", "Cache"), "AppData Cache"),
                (os.path.join(local_appdata, "Google", "Chrome", "User Data", "Default", "Code Cache"), "AppData Cache"),
                (os.path.join(local_appdata, "BraveSoftware", "Brave-Browser", "User Data", "Default", "Cache"), "AppData Cache"),
                (os.path.join(local_appdata, "Microsoft", "Edge", "User Data", "Default", "Cache"), "AppData Cache"),
                (os.path.join(local_appdata, "npm-cache"), "AppData Cache"),
                (os.path.join(local_appdata, "pip", "cache"), "AppData Cache"),
                (os.path.join(local_appdata, "pypoetry", "cache"), "AppData Cache"),
                (os.path.join(local_appdata, "Spotify", "Data"), "AppData Cache"),
                (os.path.join(local_appdata, "Discord", "Cache"), "AppData Cache"),
                (os.path.join(local_appdata, "Slack", "Cache"), "AppData Cache"),
                (os.path.join(local_appdata, "Docker", "wsl"), "Docker / WSL"),
                (os.path.join(local_appdata, "Packages"), "AppData Cache"),
            ]
            for c_path, c_cat in cache_subpaths:
                if os.path.exists(c_path):
                    targets.append({
                        "type": "file_or_dir",
                        "path": c_path,
                        "category": c_cat,
                        "max_depth": 1
                    })

        # 7. User AppData Roaming Key Bloat Areas
        if os.path.exists(appdata_roaming):
            targets.append({
                "type": "dir_children",
                "path": appdata_roaming,
                "category": "AppData Cache",
                "max_depth": 1
            })
            code_cache = os.path.join(appdata_roaming, "Code", "Cache")
            if os.path.exists(code_cache):
                targets.append({
                    "type": "file_or_dir",
                    "path": code_cache,
                    "category": "AppData Cache",
                    "max_depth": 1
                })

        # 8. WSL / Docker VHDX Disks
        try:
            wsl_vhdx = glob.glob(os.path.join(local_appdata, "Packages", "*", "LocalState", "*.vhdx"))
            for vh in wsl_vhdx:
                targets.append({
                    "type": "file",
                    "path": vh,
                    "category": "Docker / WSL",
                    "max_depth": 0
                })
        except Exception:
            pass

        return targets

    def _determine_category(self, path: str, fallback_cat: str = "Application Data") -> str:
        """Categorize an item based on its path and extension."""
        low = path.lower()
        if any(v in low for v in ["pagefile.sys", "hiberfil.sys", "swapfile.sys"]):
            return "Virtual Memory"
        if any(k in low for k in ["crashdump", "minidump", "memory.dmp", ".dmp"]):
            return "Crash Dump"
        if any(k in low for k in ["softwaredistribution", "windowsupdate", "software distribution"]):
            return "Windows Update"
        if any(k in low for k in ["windows\\logs", "cbs", "dism", "dumpstack", ".log", "measuredboot"]):
            return "System Log"
        if any(k in low for k in ["\\temp", "local\\temp", "windows\\temp", "tmp"]):
            return "Temp & Junk"
        if any(k in low for k in ["docker", "wsl", "ext4.vhdx", ".vhdx"]):
            return "Docker / WSL"
        if any(k in low for k in ["cache", "code cache", "gpucache", "npm-cache", "pip\\cache", "spotify", "discord", "slack", "appdata\\local", "appdata\\roaming"]):
            return "AppData Cache"
        return fallback_cat

    def _calc_item_stats(self, item_path: str, max_depth: int = 1) -> Tuple[int, int, bool, str]:
        """
        Calculate total size, file count, and last modified date for a file or directory
        with depth limiting to prevent long scans.
        Returns: (size_bytes, file_count, is_dir, last_modified_iso)
        """
        if not os.path.exists(item_path):
            return 0, 0, False, ""

        try:
            stat = os.stat(item_path, follow_symlinks=False)
        except (PermissionError, FileNotFoundError, OSError):
            return 0, 0, False, ""

        is_dir = os.path.isdir(item_path)
        mtime_iso = datetime.fromtimestamp(stat.st_mtime).strftime("%Y-%m-%d %H:%M:%S")

        if not is_dir:
            return stat.st_size, 1, False, mtime_iso

        total_size = 0
        file_count = 0
        latest_mtime = stat.st_mtime

        # Bounded BFS/DFS
        stack = [(item_path, 0)]
        while stack:
            curr_dir, depth = stack.pop()
            try:
                with os.scandir(curr_dir) as it:
                    for entry in it:
                        try:
                            st = entry.stat(follow_symlinks=False)
                            if st.st_mtime > latest_mtime:
                                latest_mtime = st.st_mtime

                            if entry.is_dir(follow_symlinks=False):
                                if depth < max_depth:
                                    stack.append((entry.path, depth + 1))
                            elif entry.is_file(follow_symlinks=False):
                                file_count += 1
                                total_size += st.st_size
                        except (PermissionError, FileNotFoundError, OSError):
                            continue
            except (PermissionError, FileNotFoundError, OSError):
                continue

        formatted_mtime = datetime.fromtimestamp(latest_mtime).strftime("%Y-%m-%d %H:%M:%S")
        return total_size, file_count, True, formatted_mtime

    def _scan_hotspots_sync(self) -> List[Dict[str, Any]]:
        """
        Perform parallelized fast scan of all designated hotspots.
        """
        targets = self._get_hotspot_targets()
        items_to_scan: List[Dict[str, Any]] = []
        seen_paths: Set[str] = set()

        for t in targets:
            t_type = t["type"]
            t_path = t["path"]
            t_cat = t["category"]
            max_depth = t.get("max_depth", 1)

            if not os.path.exists(t_path):
                continue

            norm = os.path.abspath(t_path)
            norm_key = norm.lower()

            if t_type == "file" or t_type == "file_or_dir":
                if norm_key not in seen_paths:
                    seen_paths.add(norm_key)
                    items_to_scan.append({
                        "path": norm,
                        "name": os.path.basename(norm) or norm,
                        "category": t_cat,
                        "max_depth": max_depth
                    })

            elif t_type == "dir_children":
                try:
                    with os.scandir(norm) as it:
                        for entry in it:
                            try:
                                child_path = os.path.abspath(entry.path)
                                child_key = child_path.lower()
                                if child_key not in seen_paths:
                                    seen_paths.add(child_key)
                                    items_to_scan.append({
                                        "path": child_path,
                                        "name": entry.name,
                                        "category": self._determine_category(child_path, t_cat),
                                        "max_depth": max_depth
                                    })
                            except (PermissionError, FileNotFoundError, OSError):
                                continue
                except (PermissionError, FileNotFoundError, OSError):
                    continue

        results = []

        def worker(item_def):
            p = item_def["path"]
            sz, count, is_dir, last_mod = self._calc_item_stats(p, item_def["max_depth"])
            if sz > 0 or count > 0 or not is_dir:
                return {
                    "path": p,
                    "name": item_def["name"],
                    "is_dir": is_dir,
                    "size_bytes": sz,
                    "file_count": count,
                    "category": item_def["category"],
                    "last_modified": last_mod or datetime.now().strftime("%Y-%m-%d %H:%M:%S")
                }
            return None

        with ThreadPoolExecutor(max_workers=self.max_workers) as executor:
            futures = [executor.submit(worker, item) for item in items_to_scan]
            for f in futures:
                try:
                    res = f.result()
                    if res:
                        results.append(res)
                except Exception:
                    continue

        return results

    def _format_size(self, size_bytes: int) -> str:
        """Format bytes into readable string (GB, MB, KB, B)."""
        abs_bytes = abs(size_bytes)
        prefix = "+" if size_bytes > 0 else ("-" if size_bytes < 0 else "")
        if abs_bytes >= 1024 ** 3:
            return f"{prefix}{round(abs_bytes / (1024 ** 3), 2)} GB"
        elif abs_bytes >= 1024 ** 2:
            return f"{prefix}{round(abs_bytes / (1024 ** 2), 1)} MB"
        elif abs_bytes >= 1024:
            return f"{prefix}{round(abs_bytes / 1024, 1)} KB"
        return f"{prefix}{abs_bytes} B"

    def _is_safe_to_purge(self, path: str) -> Tuple[bool, str]:
        """
        Check if an item is safe to purge.
        Returns: (can_purge, warning_message)
        """
        norm = os.path.abspath(path)
        low = norm.lower()

        # 1. Reject Windows Core / System critical paths
        for p in PROTECTED_SYSTEM_PATHS:
            if low == p.lower() or low == p.lower() + "\\":
                return False, f"Thư mục hệ thống cốt lõi '{p}' được bảo vệ tuyệt đối."

        base_name = os.path.basename(norm).lower()
        if base_name in PROTECTED_FILE_NAMES:
            return False, f"Tệp hệ thống cốt lõi '{base_name}' được Windows quản lý và không thể xóa trực tiếp."

        if any(low.startswith(p.lower()) for p in [r"C:\Windows\System32", r"C:\Windows\SysWOW64", r"C:\Windows\WinSxS", r"C:\Windows\Boot"]):
            return False, "Khu vực tệp hệ thống Windows System32 / WinSxS được bảo vệ tuyệt đối."

        # Check if path is root of user directory
        user_profile = os.environ.get("USERPROFILE", "").lower()
        if user_profile and low == user_profile:
            return False, "Không thể xóa thư mục gốc của tài khoản người dùng."

        # Whitelist safe zones for cleanup
        safe_keywords = [
            "\\temp",
            "appdata\\local\\temp",
            "cache",
            "code cache",
            "gpucache",
            "crashdump",
            "minidump",
            "softwaredistribution\\download",
            ".log",
            "npm-cache",
            "pip\\cache",
            "pypoetry\\cache",
            "spotify\\data",
            "discord\\cache",
            "slack\\cache",
        ]

        if any(k in low for k in safe_keywords):
            return True, "An toàn để dọn dẹp (Tệp tạm, bộ nhớ đệm cache hoặc nhật ký log)."

        # If inside AppData or ProgramData but not explicitly matched
        if "appdata" in low or "programdata" in low or "windows\\logs" in low:
            return True, "Thư mục ứng dụng/nhật ký có thể dọn dẹp (Khuyến nghị kiểm tra trước)."

        return False, "Mục này thuộc khu vực hệ thống cần thận trọng trước khi xóa."

    async def create_snapshot(self, label: Optional[str] = None) -> Dict[str, Any]:
        """
        Capture and store a new baseline snapshot.
        """
        t_start = time.time()
        now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        time_label = datetime.now().strftime("%H:%M %d/%m/%Y")
        snap_label = label.strip() if (label and label.strip()) else f"Mốc {time_label}"

        async with self._scan_lock:
            items = await asyncio.to_thread(self._scan_hotspots_sync)
            total_bytes = sum(i["size_bytes"] for i in items)
            item_count = len(items)

            def save_db():
                with sqlite3.connect(DB_PATH) as conn:
                    cursor = conn.cursor()
                    cursor.execute(
                        "INSERT INTO snapshots (created_at, label, total_bytes, item_count) VALUES (?, ?, ?, ?)",
                        (now_str, snap_label, total_bytes, item_count)
                    )
                    snap_id = cursor.lastrowid
                    if snap_id is None:
                        raise RuntimeError("Failed to insert snapshot record.")

                    item_records = [
                        (
                            snap_id,
                            i["path"],
                            i["name"],
                            1 if i["is_dir"] else 0,
                            i["size_bytes"],
                            i["file_count"],
                            i["category"],
                            i["last_modified"]
                        )
                        for i in items
                    ]
                    cursor.executemany(
                        """
                        INSERT INTO snapshot_items 
                        (snapshot_id, path, name, is_dir, size_bytes, file_count, category, last_modified)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                        """,
                        item_records
                    )

                    # Prune old snapshots (keep last 30)
                    cursor.execute("""
                        DELETE FROM snapshots WHERE id NOT IN (
                            SELECT id FROM snapshots ORDER BY id DESC LIMIT 30
                        )
                    """)
                    conn.commit()
                    return snap_id

            snap_id = await asyncio.to_thread(save_db)
            duration = round(time.time() - t_start, 2)

            return {
                "status": "success",
                "snapshot_id": snap_id,
                "label": snap_label,
                "created_at": now_str,
                "total_bytes": total_bytes,
                "total_formatted": self._format_size(total_bytes).lstrip("+"),
                "item_count": item_count,
                "duration_sec": duration,
                "message": f"Đã ghi nhận mốc snapshot thành công ({item_count} vị trí theo dõi, {duration}s)."
            }

    async def get_latest_snapshot(self) -> Optional[Dict[str, Any]]:
        """Retrieve latest snapshot metadata."""
        def fetch():
            with sqlite3.connect(DB_PATH) as conn:
                conn.row_factory = sqlite3.Row
                cursor = conn.cursor()
                cursor.execute("SELECT * FROM snapshots ORDER BY id DESC LIMIT 1")
                row = cursor.fetchone()
                if not row:
                    return None
                return {
                    "id": row["id"],
                    "created_at": row["created_at"],
                    "label": row["label"],
                    "total_bytes": row["total_bytes"],
                    "total_formatted": self._format_size(row["total_bytes"]).lstrip("+"),
                    "item_count": row["item_count"],
                    "note": row["note"]
                }
        return await asyncio.to_thread(fetch)

    async def list_snapshots(self, limit: int = 15) -> List[Dict[str, Any]]:
        """List historical snapshots."""
        def fetch():
            with sqlite3.connect(DB_PATH) as conn:
                conn.row_factory = sqlite3.Row
                cursor = conn.cursor()
                cursor.execute("SELECT * FROM snapshots ORDER BY id DESC LIMIT ?", (limit,))
                rows = cursor.fetchall()
                return [
                    {
                        "id": r["id"],
                        "created_at": r["created_at"],
                        "label": r["label"],
                        "total_bytes": r["total_bytes"],
                        "total_formatted": self._format_size(r["total_bytes"]).lstrip("+"),
                        "item_count": r["item_count"],
                    }
                    for r in rows
                ]
        return await asyncio.to_thread(fetch)

    async def compute_diff(self, snapshot_id: Optional[int] = None) -> Dict[str, Any]:
        """
        Compare current disk hotspot state against baseline snapshot.
        Returns top bloat offenders, category breakdown, and delta KPIs.
        """
        t_start = time.time()

        # 1. Fetch baseline snapshot items from SQLite
        def fetch_baseline():
            with sqlite3.connect(DB_PATH) as conn:
                conn.row_factory = sqlite3.Row
                cursor = conn.cursor()
                if snapshot_id:
                    cursor.execute("SELECT * FROM snapshots WHERE id = ?", (snapshot_id,))
                else:
                    cursor.execute("SELECT * FROM snapshots ORDER BY id DESC LIMIT 1")
                snap = cursor.fetchone()
                if not snap:
                    return None, {}

                snap_info = {
                    "id": snap["id"],
                    "created_at": snap["created_at"],
                    "label": snap["label"],
                    "total_bytes": snap["total_bytes"],
                    "item_count": snap["item_count"]
                }

                cursor.execute("SELECT * FROM snapshot_items WHERE snapshot_id = ?", (snap["id"],))
                items_dict = {
                    row["path"].lower(): {
                        "path": row["path"],
                        "name": row["name"],
                        "is_dir": bool(row["is_dir"]),
                        "size_bytes": row["size_bytes"],
                        "file_count": row["file_count"],
                        "category": row["category"],
                        "last_modified": row["last_modified"]
                    }
                    for row in cursor.fetchall()
                }
                return snap_info, items_dict

        snap_info, baseline_map = await asyncio.to_thread(fetch_baseline)

        # If no baseline exists, auto create one and return fresh baseline state
        if not snap_info:
            created = await self.create_snapshot("Mốc ban đầu (Tự động)")
            return {
                "has_baseline": False,
                "message": "Chưa có mốc snapshot nào. Hệ thống đã tự động tạo mốc Baseline ban đầu!",
                "baseline": created,
                "summary": {
                    "total_delta_bytes": 0,
                    "total_delta_formatted": "+0 B",
                    "total_expanded_bytes": 0,
                    "total_new_bytes": 0,
                    "new_files_count": 0,
                    "expanded_count": 0,
                    "top_category": "None",
                    "scan_duration_sec": created.get("duration_sec", 0.5)
                },
                "category_deltas": {},
                "items": []
            }

        # 2. Live scan current state
        async with self._scan_lock:
            current_items = await asyncio.to_thread(self._scan_hotspots_sync)

        current_map = {item["path"].lower(): item for item in current_items}

        # 3. Calculate Diff
        all_paths = set(baseline_map.keys()).union(set(current_map.keys()))
        diff_items = []
        category_deltas: Dict[str, int] = {}
        category_item_counts: Dict[str, int] = {}

        total_delta = 0
        total_expanded = 0
        total_new = 0
        new_count = 0
        expanded_count = 0
        shrunk_count = 0

        for p_key in all_paths:
            base = baseline_map.get(p_key)
            curr = current_map.get(p_key)

            base_size = base["size_bytes"] if base else 0
            curr_size = curr["size_bytes"] if curr else 0
            delta = curr_size - base_size

            name = curr["name"] if curr else (base["name"] if base else os.path.basename(p_key))
            orig_path = curr["path"] if curr else (base["path"] if base else p_key)
            is_dir = curr["is_dir"] if curr else (base["is_dir"] if base else False)
            category = curr["category"] if curr else (base["category"] if base else "Application Data")
            last_mod = curr["last_modified"] if curr else (base["last_modified"] if base else "")

            if not base and curr:
                status = "new"
                status_label = "Mới sinh ra"
                new_count += 1
                if delta > 0:
                    total_new += delta
            elif base and curr:
                if delta > 0:
                    status = "expanded"
                    status_label = "Phình to"
                    expanded_count += 1
                    total_expanded += delta
                elif delta < 0:
                    status = "shrunk"
                    status_label = "Đã dọn / Thu nhỏ"
                    shrunk_count += 1
                else:
                    status = "unchanged"
                    status_label = "Không đổi"
            else:
                # Existed in baseline but deleted now
                status = "deleted"
                status_label = "Đã xóa"
                shrunk_count += 1

            total_delta += delta

            # Accumulate category growth
            if delta > 0:
                category_deltas[category] = category_deltas.get(category, 0) + delta
                category_item_counts[category] = category_item_counts.get(category, 0) + 1

            can_purge, purge_warning = self._is_safe_to_purge(orig_path)

            diff_items.append({
                "path": orig_path,
                "name": name,
                "is_dir": is_dir,
                "type": "Directory" if is_dir else "File",
                "category": category,
                "status": status,
                "status_label": status_label,
                "baseline_size_bytes": base_size,
                "baseline_size_formatted": self._format_size(base_size).lstrip("+-"),
                "current_size_bytes": curr_size,
                "current_size_formatted": self._format_size(curr_size).lstrip("+-"),
                "delta_size_bytes": delta,
                "delta_size_formatted": self._format_size(delta),
                "delta_size_mb": round(delta / (1024 ** 2), 2),
                "current_size_mb": round(curr_size / (1024 ** 2), 2),
                "last_modified": last_mod,
                "can_purge": can_purge,
                "purge_warning": purge_warning
            })

        # Sort diff items by largest delta growth descending
        diff_items.sort(key=lambda x: (x["delta_size_bytes"], x["current_size_bytes"]), reverse=True)

        # Top bloat offenders (items that increased in size or are new)
        top_offenders = [i for i in diff_items if i["delta_size_bytes"] > 0 or i["status"] == "new"]

        # Determine top category with highest bloat
        top_category = "Chưa phát hiện"
        top_category_bytes = 0
        if category_deltas:
            top_cat_pair = max(category_deltas.items(), key=lambda x: x[1])
            top_category = top_cat_pair[0]
            top_category_bytes = top_cat_pair[1]

        duration = round(time.time() - t_start, 2)

        # Format category breakdown for charts/pills
        cat_breakdown = []
        for cat, b_bytes in sorted(category_deltas.items(), key=lambda x: x[1], reverse=True):
            cat_breakdown.append({
                "category": cat,
                "delta_bytes": b_bytes,
                "delta_formatted": self._format_size(b_bytes),
                "delta_mb": round(b_bytes / (1024 ** 2), 1),
                "item_count": category_item_counts.get(cat, 0),
                "percent_of_bloat": round((b_bytes / total_expanded * 100), 1) if total_expanded > 0 else 0.0
            })

        return {
            "has_baseline": True,
            "baseline": {
                "id": snap_info["id"],
                "created_at": snap_info["created_at"],
                "label": snap_info["label"],
                "total_bytes": snap_info["total_bytes"],
                "total_formatted": self._format_size(snap_info["total_bytes"]).lstrip("+-"),
                "item_count": snap_info["item_count"]
            },
            "summary": {
                "total_delta_bytes": total_delta,
                "total_delta_formatted": self._format_size(total_delta),
                "total_expanded_bytes": total_expanded,
                "total_expanded_formatted": self._format_size(total_expanded),
                "total_new_bytes": total_new,
                "total_new_formatted": self._format_size(total_new),
                "new_files_count": new_count,
                "expanded_count": expanded_count,
                "shrunk_count": shrunk_count,
                "top_category": top_category,
                "top_category_formatted": f"{top_category} ({self._format_size(top_category_bytes)})" if top_category_bytes > 0 else top_category,
                "scan_duration_sec": duration,
                "total_offenders_count": len(top_offenders)
            },
            "category_deltas": cat_breakdown,
            "items": diff_items
        }

    async def purge_item(self, target_path: str) -> Dict[str, Any]:
        """
        Safely delete a bloat offender file or folder.
        Includes robust safety guardrails against Windows system destruction.
        """
        norm_path = os.path.abspath(target_path.strip())

        # Safety Check
        can_purge, reason = self._is_safe_to_purge(norm_path)
        if not can_purge:
            return {
                "status": "blocked",
                "success": False,
                "message": f"Hành động bị chặn vì lý do an toàn hệ thống: {reason}",
                "freed_bytes": 0
            }

        if not os.path.exists(norm_path):
            return {
                "status": "not_found",
                "success": False,
                "message": f"Tệp tin hoặc thư mục '{norm_path}' không còn tồn tại.",
                "freed_bytes": 0
            }

        def delete_sync() -> Tuple[bool, int, str]:
            freed_bytes = 0
            try:
                if os.path.isdir(norm_path):
                    # Compute size before removing
                    for root, _, files in os.walk(norm_path):
                        for f in files:
                            try:
                                fp = os.path.join(root, f)
                                freed_bytes += os.path.getsize(fp)
                            except Exception:
                                pass
                    shutil.rmtree(norm_path, ignore_errors=True)
                    return True, freed_bytes, f"Đã dọn dẹp thư mục thành công: {os.path.basename(norm_path)}"
                else:
                    try:
                        freed_bytes = os.path.getsize(norm_path)
                    except Exception:
                        pass
                    os.remove(norm_path)
                    return True, freed_bytes, f"Đã xóa tệp tin thành công: {os.path.basename(norm_path)}"
            except PermissionError:
                return False, freed_bytes, "Tệp/thư mục đang bị khóa bởi tiến trình khác hoặc cần quyền Administrator."
            except Exception as e:
                return False, freed_bytes, f"Lỗi trong khi xóa: {str(e)}"

        success, freed, msg = await asyncio.to_thread(delete_sync)

        return {
            "status": "success" if success else "error",
            "success": success,
            "message": msg,
            "freed_bytes": freed,
            "freed_formatted": self._format_size(freed).lstrip("+-"),
            "path": norm_path
        }

    def open_item_location(self, file_or_dir_path: str) -> Dict[str, Any]:
        """Open Windows Explorer and highlight the requested file or folder."""
        clean_path = os.path.abspath(file_or_dir_path.strip())
        if not os.path.exists(clean_path):
            return {
                "status": "error",
                "message": f"Path '{clean_path}' does not exist on disk."
            }

        try:
            if os.name == "nt":
                if os.path.isdir(clean_path):
                    subprocess.Popen(['explorer', clean_path])
                else:
                    subprocess.Popen(['explorer', f'/select,{clean_path}'])
            else:
                subprocess.Popen(['xdg-open', clean_path])

            return {
                "status": "success",
                "message": f"Opened Explorer at {clean_path}"
            }
        except Exception as e:
            return {
                "status": "error",
                "message": f"Failed to open explorer: {str(e)}"
            }

disk_delta_service = DiskDeltaService(max_workers=8)
