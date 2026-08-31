import asyncio
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta
import os
from pathlib import Path
import subprocess
import time
from typing import Any, Dict, List, Optional

# Predefined file extension to category mappings
CATEGORY_MAPPINGS: Dict[str, str] = {
    # Documents
    '.pdf': 'Document', '.doc': 'Document', '.docx': 'Document',
    '.xls': 'Document', '.xlsx': 'Document', '.ppt': 'Document', '.pptx': 'Document',
    '.txt': 'Document', '.csv': 'Document', '.md': 'Document', '.rtf': 'Document',
    '.epub': 'Document', '.odt': 'Document', '.tsv': 'Document', '.pages': 'Document',

    # Images
    '.png': 'Image', '.jpg': 'Image', '.jpeg': 'Image', '.gif': 'Image',
    '.webp': 'Image', '.svg': 'Image', '.ico': 'Image', '.bmp': 'Image',
    '.tiff': 'Image', '.tif': 'Image', '.heic': 'Image', '.psd': 'Image',
    '.ai': 'Image', '.raw': 'Image',

    # Videos
    '.mp4': 'Video', '.mkv': 'Video', '.avi': 'Video', '.mov': 'Video',
    '.wmv': 'Video', '.flv': 'Video', '.webm': 'Video', '.m4v': 'Video',
    '.3gp': 'Video', '.mpeg': 'Video', '.mpg': 'Video',

    # Audio
    '.mp3': 'Audio', '.wav': 'Audio', '.flac': 'Audio', '.aac': 'Audio',
    '.m4a': 'Audio', '.ogg': 'Audio', '.wma': 'Audio', '.mid': 'Audio',
    '.midi': 'Audio',

    # Archives
    '.zip': 'Archive', '.rar': 'Archive', '.7z': 'Archive', '.tar': 'Archive',
    '.gz': 'Archive', '.bz2': 'Archive', '.xz': 'Archive', '.iso': 'Archive',
    '.tgz': 'Archive', '.cab': 'Archive', '.7zip': 'Archive',

    # Executables / Installers
    '.exe': 'Executable', '.msi': 'Executable', '.bat': 'Executable',
    '.cmd': 'Executable', '.ps1': 'Executable', '.vbs': 'Executable',
    '.apk': 'Executable', '.dmg': 'Executable', '.jar': 'Executable',
    '.appx': 'Executable', '.deb': 'Executable',

    # Code / Developer Files
    '.py': 'Code', '.js': 'Code', '.ts': 'Code', '.html': 'Code',
    '.css': 'Code', '.json': 'Code', '.xml': 'Code', '.cpp': 'Code',
    '.c': 'Code', '.h': 'Code', '.cs': 'Code', '.java': 'Code',
    '.go': 'Code', '.rs': 'Code', '.php': 'Code', '.sql': 'Code',
    '.sh': 'Code', '.yml': 'Code', '.yaml': 'Code', '.toml': 'Code',
    '.env': 'Code',
}

INCOMPLETE_EXTENSIONS = {'.crdownload', '.tmp', '.part', '.download'}

class DownloadsAnalyzer:
    def __init__(self, cache_ttl_seconds: int = 5, max_workers: int = 4):
        self.cache_ttl = cache_ttl_seconds
        self.executor = ThreadPoolExecutor(max_workers=max_workers)
        self._cache: Dict[str, Dict[str, Any]] = {}
        self._lock = asyncio.Lock()

    @staticmethod
    def get_default_downloads_dir() -> str:
        """Get the standard user Downloads directory on Windows / OS."""
        home = Path.home()
        downloads = home / "Downloads"
        if downloads.exists() and downloads.is_dir():
            return str(downloads)
        
        # Fallback to userprofile/Downloads or home
        user_profile = os.environ.get("USERPROFILE")
        if user_profile:
            p = Path(user_profile) / "Downloads"
            if p.exists():
                return str(p)
        return str(home)

    @staticmethod
    def format_size(size_bytes: int) -> str:
        """Format raw byte sizes to human-readable strings."""
        if size_bytes < 1024:
            return f"{size_bytes} B"
        elif size_bytes < 1024 * 1024:
            return f"{size_bytes / 1024:.1f} KB"
        elif size_bytes < 1024 * 1024 * 1024:
            return f"{size_bytes / (1024 * 1024):.1f} MB"
        else:
            return f"{size_bytes / (1024 * 1024 * 1024):.2f} GB"

    @staticmethod
    def format_relative_time(dt: datetime) -> str:
        """Return human-readable relative time string."""
        now = datetime.now()
        diff = now - dt

        if diff.total_seconds() < 0:
            return "Just now"

        seconds = int(diff.total_seconds())
        if seconds < 60:
            return f"{seconds}s ago"
        elif seconds < 3600:
            return f"{seconds // 60}m ago"
        elif seconds < 86400:
            hours = seconds // 3600
            return f"{hours}h ago"
        elif seconds < 86400 * 2:
            return f"Yesterday at {dt.strftime('%H:%M')}"
        elif seconds < 86400 * 7:
            days = seconds // 86400
            return f"{days} days ago"
        elif dt.year == now.year:
            return dt.strftime("%b %d, %H:%M")
        else:
            return dt.strftime("%Y-%m-%d %H:%M")

    def _get_file_type(self, ext: str) -> str:
        """Classify file extension into category."""
        clean_ext = ext.lower().strip()
        if clean_ext in INCOMPLETE_EXTENSIONS:
            return 'Downloading'
        return CATEGORY_MAPPINGS.get(clean_ext, 'Other')

    def scan_downloads_sync(self, target_dir: str, time_filter: str = "today") -> Dict[str, Any]:
        """
        Synchronous scanning of the downloads folder using os.scandir.
        Filters by creation/modification timestamp: today, week, month, all.
        """
        start_time = time.time()
        dir_path = Path(target_dir)

        if not dir_path.exists() or not dir_path.is_dir():
            return {
                "status": "error",
                "message": f"Directory not found: {target_dir}",
                "downloads_dir": target_dir,
                "filter_applied": time_filter,
                "total_files": 0,
                "total_size_bytes": 0,
                "total_size_formatted": "0 B",
                "files": [],
                "category_breakdown": {},
                "top_category": None,
                "scan_duration_sec": 0.0,
            }

        now = datetime.now()
        today_midnight = now.replace(hour=0, minute=0, second=0, microsecond=0)
        week_ago = now - timedelta(days=7)
        month_ago = now - timedelta(days=30)

        files_list = []
        category_stats: Dict[str, Dict[str, Any]] = {
            "Document": {"count": 0, "size_bytes": 0},
            "Image": {"count": 0, "size_bytes": 0},
            "Video": {"count": 0, "size_bytes": 0},
            "Audio": {"count": 0, "size_bytes": 0},
            "Archive": {"count": 0, "size_bytes": 0},
            "Executable": {"count": 0, "size_bytes": 0},
            "Code": {"count": 0, "size_bytes": 0},
            "Other": {"count": 0, "size_bytes": 0},
            "Downloading": {"count": 0, "size_bytes": 0},
        }

        total_size_bytes = 0

        try:
            with os.scandir(target_dir) as entries:
                for entry in entries:
                    try:
                        # Skip directories unless specifically inspecting, focus on downloaded files
                        if entry.is_dir(follow_symlinks=False):
                            continue

                        stat = entry.stat(follow_symlinks=False)
                        size = stat.st_size
                        
                        # Windows often updates st_mtime or st_ctime for downloaded files
                        mtime = stat.st_mtime
                        ctime = stat.st_ctime
                        best_timestamp = max(mtime, ctime)
                        file_dt = datetime.fromtimestamp(best_timestamp)

                        # Filter by time range
                        if time_filter == "today":
                            if file_dt < today_midnight:
                                continue
                        elif time_filter == "week":
                            if file_dt < week_ago:
                                continue
                        elif time_filter == "month":
                            if file_dt < month_ago:
                                continue
                        # "all" does not filter

                        ext = Path(entry.name).suffix.lower()
                        category = self._get_file_type(ext)
                        is_incomplete = ext in INCOMPLETE_EXTENSIONS

                        files_list.append({
                            "file_name": entry.name,
                            "file_path": entry.path,
                            "file_size_bytes": size,
                            "file_size_formatted": self.format_size(size),
                            "file_type": category,
                            "extension": ext or "none",
                            "is_incomplete": is_incomplete,
                            "timestamp": best_timestamp,
                            "downloaded_at_iso": file_dt.isoformat(),
                            "downloaded_at_formatted": file_dt.strftime("%Y-%m-%d %H:%M:%S"),
                            "time_ago": self.format_relative_time(file_dt),
                        })

                        total_size_bytes += size

                        if category in category_stats:
                            category_stats[category]["count"] += 1
                            category_stats[category]["size_bytes"] += size
                        else:
                            category_stats["Other"]["count"] += 1
                            category_stats["Other"]["size_bytes"] += size

                    except (PermissionError, FileNotFoundError, OSError):
                        continue
        except (PermissionError, OSError) as e:
            return {
                "status": "error",
                "message": f"Error accessing directory: {str(e)}",
                "downloads_dir": target_dir,
                "filter_applied": time_filter,
                "total_files": 0,
                "total_size_bytes": 0,
                "total_size_formatted": "0 B",
                "files": [],
                "category_breakdown": {},
                "top_category": None,
                "scan_duration_sec": round(time.time() - start_time, 3),
            }

        # Sort files: most recently downloaded first
        files_list.sort(key=lambda x: x["timestamp"], reverse=True)

        # Build category breakdown summary with formatted sizes and percentages
        breakdown_result = {}
        top_category_name = None
        max_category_bytes = -1

        for cat_name, stats in category_stats.items():
            if stats["count"] > 0:
                pct = round((stats["size_bytes"] / total_size_bytes * 100), 1) if total_size_bytes > 0 else 0
                breakdown_result[cat_name] = {
                    "count": stats["count"],
                    "size_bytes": stats["size_bytes"],
                    "size_formatted": self.format_size(stats["size_bytes"]),
                    "percent_of_total": pct,
                }
                if stats["size_bytes"] > max_category_bytes:
                    max_category_bytes = stats["size_bytes"]
                    top_category_name = cat_name

        scan_duration = round(time.time() - start_time, 3)

        return {
            "status": "success",
            "downloads_dir": target_dir,
            "filter_applied": time_filter,
            "total_files": len(files_list),
            "total_size_bytes": total_size_bytes,
            "total_size_formatted": self.format_size(total_size_bytes),
            "top_category": top_category_name or "None",
            "category_breakdown": breakdown_result,
            "files": files_list,
            "scan_duration_sec": scan_duration,
            "scanned_at_iso": datetime.now().isoformat(),
        }

    async def scan_downloads_async(self, target_dir: Optional[str] = None, time_filter: str = "today", force: bool = False) -> Dict[str, Any]:
        """
        Asynchronously scan the downloads folder with short-term caching for extreme responsiveness.
        """
        directory = target_dir.strip() if target_dir else self.get_default_downloads_dir()
        valid_filters = {"today", "week", "month", "all"}
        clean_filter = time_filter.lower() if time_filter and time_filter.lower() in valid_filters else "today"

        cache_key = f"{directory}_{clean_filter}"

        async with self._lock:
            if not force and cache_key in self._cache:
                cached = self._cache[cache_key]
                age = time.time() - cached["timestamp"]
                if age < self.cache_ttl:
                    cached_data = dict(cached["data"])
                    cached_data["is_cached"] = True
                    cached_data["cache_age_sec"] = round(age, 1)
                    return cached_data

        loop = asyncio.get_event_loop()
        result = await loop.run_in_executor(self.executor, self.scan_downloads_sync, directory, clean_filter)

        if result.get("status") == "success":
            async with self._lock:
                self._cache[cache_key] = {
                    "timestamp": time.time(),
                    "data": result,
                }
            result["is_cached"] = False
            result["cache_age_sec"] = 0.0

        return result

    @staticmethod
    def open_in_explorer(file_or_dir_path: str) -> Dict[str, Any]:
        """
        Open Windows Explorer and highlight the selected file, or open the folder.
        """
        if not file_or_dir_path:
            return {"status": "error", "message": "File path is required"}

        clean_path = os.path.normpath(file_or_dir_path.strip())

        if not os.path.exists(clean_path):
            return {"status": "error", "message": f"File or folder does not exist: {clean_path}"}

        try:
            if os.name == 'nt':
                # Windows Explorer command
                if os.path.isfile(clean_path):
                    # /select,<path> highlights the item in folder
                    subprocess.Popen(['explorer', f'/select,{clean_path}'])
                else:
                    # Opens directory
                    os.startfile(clean_path)
            else:
                # Linux / macOS fallback
                parent_dir = os.path.dirname(clean_path) if os.path.isfile(clean_path) else clean_path
                subprocess.Popen(['xdg-open', parent_dir])

            return {
                "status": "success",
                "message": "Opened in File Explorer",
                "path": clean_path,
            }
        except Exception as e:
            return {"status": "error", "message": f"Failed to open explorer: {str(e)}"}

downloads_analyzer = DownloadsAnalyzer()
