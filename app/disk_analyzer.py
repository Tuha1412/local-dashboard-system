import asyncio
from concurrent.futures import ThreadPoolExecutor
import os
import time
from datetime import datetime
from typing import Any, Dict, List, Optional
import psutil

class DiskAnalyzer:
    def __init__(self, cache_ttl_seconds: int = 600, max_workers: int = 8):
        self.cache_ttl = cache_ttl_seconds
        self.max_workers = max_workers
        # Structure: { "C:": { "timestamp": 123456.0, "data": {...} } }
        self._cache: Dict[str, Dict[str, Any]] = {}
        self._scan_locks: Dict[str, asyncio.Lock] = {}
        self._global_lock = asyncio.Lock()

    def get_available_drives(self) -> List[Dict[str, Any]]:
        """List all valid and accessible local drives/partitions."""
        drives = []
        seen = set()
        for part in psutil.disk_partitions(all=False):
            mount = part.mountpoint
            if mount in seen or 'cdrom' in part.opts or part.fstype == '':
                continue
            seen.add(mount)
            try:
                usage = psutil.disk_usage(mount)
                drive_letter = mount.rstrip('\\/').upper()
                if not drive_letter:
                    drive_letter = mount
                drives.append({
                    "drive": drive_letter,
                    "mountpoint": mount,
                    "fstype": part.fstype,
                    "total_gb": round(usage.total / (1024 ** 3), 2),
                    "used_gb": round(usage.used / (1024 ** 3), 2),
                    "free_gb": round(usage.free / (1024 ** 3), 2),
                    "percent": round(usage.percent, 1),
                })
            except (PermissionError, OSError):
                continue
        return drives

    def _normalize_drive_path(self, drive_str: str) -> str:
        """Normalize drive string (e.g., 'C', 'c:', 'C:\\') into a clean root path 'C:\\'."""
        cleaned = drive_str.strip().upper()
        if not cleaned:
            cleaned = "C:"
        if not cleaned.endswith(":"):
            if len(cleaned) == 1 and cleaned.isalpha():
                cleaned = f"{cleaned}:"
            elif not cleaned.endswith("\\") and not cleaned.endswith("/"):
                cleaned = f"{cleaned.rstrip(':/')}:"
        
        if not cleaned.endswith("\\") and not cleaned.endswith("/"):
            cleaned = f"{cleaned}\\"
        return cleaned

    def _get_dir_size_and_count(self, root_path: str) -> tuple[int, int, int]:
        """
        Iterative folder size calculation using os.scandir stack.
        Returns: (total_bytes, file_count, folder_count)
        """
        total_size = 0
        file_count = 0
        folder_count = 0
        stack = [root_path]

        while stack:
            curr_dir = stack.pop()
            try:
                with os.scandir(curr_dir) as it:
                    for entry in it:
                        try:
                            # Do not follow symlinks/junctions to prevent infinite loops
                            if entry.is_dir(follow_symlinks=False):
                                folder_count += 1
                                stack.append(entry.path)
                            elif entry.is_file(follow_symlinks=False):
                                file_count += 1
                                total_size += entry.stat(follow_symlinks=False).st_size
                        except (PermissionError, FileNotFoundError, OSError):
                            continue
            except (PermissionError, FileNotFoundError, OSError):
                continue

        return total_size, file_count, folder_count

    def _process_single_entry(self, entry_info: tuple, drive_total_bytes: int, drive_used_bytes: int) -> Dict[str, Any]:
        """Worker function for single root entry processing."""
        name, path, is_dir = entry_info
        bytes_to_gb = 1024 ** 3
        bytes_to_mb = 1024 ** 2

        if is_dir:
            size_bytes, file_count, subfolder_count = self._get_dir_size_and_count(path)
        else:
            try:
                size_bytes = os.path.getsize(path)
            except Exception:
                size_bytes = 0
            file_count = 1
            subfolder_count = 0

        size_gb = round(size_bytes / bytes_to_gb, 2)
        size_mb = round(size_bytes / bytes_to_mb, 1)

        if size_gb >= 1.0:
            size_formatted = f"{size_gb} GB"
        elif size_mb >= 1.0:
            size_formatted = f"{size_mb} MB"
        else:
            size_formatted = f"{round(size_bytes / 1024, 1)} KB"

        pct_drive = round((size_bytes / drive_total_bytes * 100), 2) if drive_total_bytes > 0 else 0.0
        pct_used = round((size_bytes / drive_used_bytes * 100), 2) if drive_used_bytes > 0 else 0.0

        return {
            "name": name,
            "path": path,
            "is_dir": is_dir,
            "type": "Directory" if is_dir else "File",
            "size_bytes": size_bytes,
            "size_gb": size_gb,
            "size_mb": size_mb,
            "size_formatted": size_formatted,
            "percent_of_drive": pct_drive,
            "percent_of_used": pct_used,
            "file_count": file_count,
            "subfolder_count": subfolder_count,
        }

    def _scan_drive_sync(self, drive_root: str) -> Dict[str, Any]:
        """Perform parallel level-1 folder breakdown scan."""
        t_start = time.time()
        bytes_to_gb = 1024 ** 3

        # Get overall partition metrics
        drive_total_bytes = 0
        drive_used_bytes = 0
        drive_free_bytes = 0
        drive_percent = 0.0

        try:
            usage = psutil.disk_usage(drive_root)
            drive_total_bytes = usage.total
            drive_used_bytes = usage.used
            drive_free_bytes = usage.free
            drive_percent = round(usage.percent, 1)
        except Exception:
            pass

        raw_entries = []
        try:
            with os.scandir(drive_root) as it:
                for entry in it:
                    try:
                        raw_entries.append((entry.name, entry.path, entry.is_dir(follow_symlinks=False)))
                    except (PermissionError, FileNotFoundError, OSError):
                        continue
        except Exception:
            pass

        # Parallelize scanning of level-1 folders
        items = []
        if raw_entries:
            with ThreadPoolExecutor(max_workers=self.max_workers) as executor:
                futures = [
                    executor.submit(self._process_single_entry, entry, drive_total_bytes, drive_used_bytes)
                    for entry in raw_entries
                ]
                for f in futures:
                    try:
                        items.append(f.result())
                    except Exception:
                        continue

        # Sort items descending by size
        items.sort(key=lambda x: x["size_bytes"], reverse=True)

        analyzed_total_bytes = sum(i["size_bytes"] for i in items)
        duration = round(time.time() - t_start, 2)
        analyzed_gb = round(analyzed_total_bytes / bytes_to_gb, 2)

        return {
            "drive": drive_root.rstrip('\\/'),
            "mountpoint": drive_root,
            "total_gb": round(drive_total_bytes / bytes_to_gb, 2),
            "used_gb": round(drive_used_bytes / bytes_to_gb, 2),
            "free_gb": round(drive_free_bytes / bytes_to_gb, 2),
            "used_percent": drive_percent,
            "analyzed_total_gb": analyzed_gb,
            "scanned_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            "scan_duration_sec": duration,
            "item_count": len(items),
            "items": items,
        }

    async def scan_drive_async(self, drive_str: str, force: bool = False) -> Dict[str, Any]:
        """
        Asynchronously scan drive with in-memory caching and lock protection.
        """
        drive_root = self._normalize_drive_path(drive_str)
        drive_key = drive_root.rstrip('\\/').upper()

        now = time.time()

        # Check Cache
        if not force and drive_key in self._cache:
            cache_entry = self._cache[drive_key]
            if now - cache_entry["timestamp"] < self.cache_ttl:
                result = dict(cache_entry["data"])
                result["is_cached"] = True
                result["cache_age_sec"] = int(now - cache_entry["timestamp"])
                return result

        # Ensure single scan per drive concurrently
        async with self._global_lock:
            if drive_key not in self._scan_locks:
                self._scan_locks[drive_key] = asyncio.Lock()
            drive_lock = self._scan_locks[drive_key]

        async with drive_lock:
            if not force and drive_key in self._cache:
                cache_entry = self._cache[drive_key]
                if now - cache_entry["timestamp"] < self.cache_ttl:
                    result = dict(cache_entry["data"])
                    result["is_cached"] = True
                    result["cache_age_sec"] = int(now - cache_entry["timestamp"])
                    return result

            scan_data = await asyncio.to_thread(self._scan_drive_sync, drive_root)
            scan_data["is_cached"] = False
            scan_data["cache_age_sec"] = 0

            self._cache[drive_key] = {
                "timestamp": time.time(),
                "data": scan_data,
            }

            return scan_data

    def _scan_subfolder_sync(self, parent_path: str) -> Dict[str, Any]:
        """Synchronously scan immediate children of parent_path in parallel."""
        t_start = time.time()
        norm_path = os.path.abspath(parent_path)

        if not os.path.exists(norm_path):
            return {
                "status": "error",
                "message": f"Path '{norm_path}' not found.",
                "parent_path": norm_path,
                "parent_name": os.path.basename(norm_path) or norm_path,
                "items": []
            }

        drive_letter = os.path.splitdrive(norm_path)[0].upper() or "C:"
        drive_total_bytes = 0
        try:
            usage = psutil.disk_usage(norm_path)
            drive_total_bytes = usage.total
        except Exception:
            pass

        raw_entries = []
        try:
            with os.scandir(norm_path) as it:
                for entry in it:
                    try:
                        raw_entries.append((entry.name, entry.path, entry.is_dir(follow_symlinks=False)))
                    except (PermissionError, FileNotFoundError, OSError):
                        continue
        except PermissionError:
            return {
                "status": "permission_denied",
                "message": "Access denied by Windows security permissions.",
                "parent_path": norm_path,
                "parent_name": os.path.basename(norm_path) or norm_path,
                "items": []
            }
        except Exception as e:
            return {
                "status": "error",
                "message": str(e),
                "parent_path": norm_path,
                "parent_name": os.path.basename(norm_path) or norm_path,
                "items": []
            }

        items = []
        if raw_entries:
            with ThreadPoolExecutor(max_workers=self.max_workers) as executor:
                futures = [
                    executor.submit(self._process_single_entry, entry, drive_total_bytes, 0)
                    for entry in raw_entries
                ]
                for f in futures:
                    try:
                        items.append(f.result())
                    except Exception:
                        continue

        # Sort descending by size
        items.sort(key=lambda x: x["size_bytes"], reverse=True)
        total_size_bytes = sum(i["size_bytes"] for i in items)

        # Calculate percent of parent
        for i in items:
            if total_size_bytes > 0:
                i["percent_of_parent"] = round((i["size_bytes"] / total_size_bytes) * 100, 1)
            else:
                i["percent_of_parent"] = 0.0

        bytes_to_gb = 1024 ** 3
        bytes_to_mb = 1024 ** 2
        if total_size_bytes >= bytes_to_gb:
            total_size_formatted = f"{round(total_size_bytes / bytes_to_gb, 2)} GB"
        elif total_size_bytes >= bytes_to_mb:
            total_size_formatted = f"{round(total_size_bytes / bytes_to_mb, 1)} MB"
        else:
            total_size_formatted = f"{round(total_size_bytes / 1024, 1)} KB"

        return {
            "status": "success",
            "parent_path": norm_path,
            "parent_name": os.path.basename(norm_path) or norm_path,
            "drive": drive_letter,
            "total_size_bytes": total_size_bytes,
            "total_size_formatted": total_size_formatted,
            "item_count": len(items),
            "scan_duration_sec": round(time.time() - t_start, 2),
            "items": items
        }

    async def scan_subfolder_async(self, parent_path: str, force: bool = False) -> Dict[str, Any]:
        """
        Asynchronously scan child items of a directory with memory caching.
        """
        norm_path = os.path.abspath(parent_path.strip())
        cache_key = norm_path.lower()

        now = time.time()
        if not hasattr(self, "_subfolder_cache"):
            self._subfolder_cache = {}
        if not hasattr(self, "_subfolder_locks"):
            self._subfolder_locks = {}

        if not force and cache_key in self._subfolder_cache:
            cache_entry = self._subfolder_cache[cache_key]
            if now - cache_entry["timestamp"] < self.cache_ttl:
                res = dict(cache_entry["data"])
                res["is_cached"] = True
                res["cache_age_sec"] = int(now - cache_entry["timestamp"])
                return res

        async with self._global_lock:
            if cache_key not in self._subfolder_locks:
                self._subfolder_locks[cache_key] = asyncio.Lock()
            sub_lock = self._subfolder_locks[cache_key]

        async with sub_lock:
            if not force and cache_key in self._subfolder_cache:
                cache_entry = self._subfolder_cache[cache_key]
                if now - cache_entry["timestamp"] < self.cache_ttl:
                    res = dict(cache_entry["data"])
                    res["is_cached"] = True
                    res["cache_age_sec"] = int(now - cache_entry["timestamp"])
                    return res

            data = await asyncio.to_thread(self._scan_subfolder_sync, norm_path)
            data["is_cached"] = False
            data["cache_age_sec"] = 0

            if data.get("status") == "success":
                self._subfolder_cache[cache_key] = {
                    "timestamp": time.time(),
                    "data": data
                }

            return data

disk_analyzer = DiskAnalyzer(cache_ttl_seconds=600, max_workers=8)
