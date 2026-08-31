import os
import platform
import socket
import time
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
import psutil

class MetricsCollector:
    def __init__(self):
        # Network tracking
        net_io = psutil.net_io_counters()
        self._last_net_time = time.time()
        self._last_bytes_recv = net_io.bytes_recv if net_io else 0
        self._last_bytes_sent = net_io.bytes_sent if net_io else 0

        # Disk IO tracking
        disk_io = psutil.disk_io_counters()
        self._last_disk_time = time.time()
        self._last_disk_read = disk_io.read_bytes if disk_io else 0
        self._last_disk_write = disk_io.write_bytes if disk_io else 0

        # Process CPU times tracking: {pid: (total_cpu_time, timestamp)}
        self._proc_cpu_cache: Dict[int, tuple] = {}

        # Static OS info
        self._os_info = self._collect_static_os_info()
        self._logical_cores = self._os_info["logical_cores"]

        # Prime CPU percent measurement
        psutil.cpu_percent(interval=None)
        psutil.cpu_percent(interval=None, percpu=True)
        self._prime_proc_cache()

    def _collect_static_os_info(self) -> Dict[str, Any]:
        """Collect static OS and Hardware metadata."""
        cpu_name = platform.processor() or "Unknown CPU"
        try:
            if platform.system() == "Windows":
                cpu_name = os.environ.get("PROCESSOR_IDENTIFIER", cpu_name)
        except Exception:
            pass

        return {
            "system": platform.system(),
            "release": platform.release(),
            "version": platform.version(),
            "architecture": platform.machine(),
            "hostname": socket.gethostname(),
            "cpu_model": cpu_name,
            "logical_cores": psutil.cpu_count(logical=True) or 1,
            "physical_cores": psutil.cpu_count(logical=False) or 1,
        }

    def _prime_proc_cache(self):
        now = time.time()
        for p in psutil.process_iter(['pid', 'cpu_times']):
            try:
                times = p.info.get('cpu_times')
                if times:
                    self._proc_cpu_cache[p.info['pid']] = (times.user + times.system, now)
            except Exception:
                pass

    def _get_uptime_info(self) -> Dict[str, Any]:
        """Calculate system uptime."""
        boot_timestamp = psutil.boot_time()
        now = time.time()
        uptime_seconds = max(0, int(now - boot_timestamp))

        days, rem = divmod(uptime_seconds, 86400)
        hours, rem = divmod(rem, 3600)
        minutes, seconds = divmod(rem, 60)

        parts = []
        if days > 0:
            parts.append(f"{days}d")
        if hours > 0 or days > 0:
            parts.append(f"{hours}h")
        parts.append(f"{minutes}m")
        parts.append(f"{seconds}s")
        uptime_str = " ".join(parts)

        boot_datetime = datetime.fromtimestamp(boot_timestamp, timezone.utc).astimezone().strftime("%Y-%m-%d %H:%M:%S")

        return {
            "uptime_seconds": uptime_seconds,
            "uptime_formatted": uptime_str,
            "boot_time": boot_datetime,
        }

    def _get_cpu_metrics(self) -> Dict[str, Any]:
        """Collect CPU utilization and frequency metrics."""
        overall_percent = psutil.cpu_percent(interval=None)
        per_core_percent = psutil.cpu_percent(interval=None, percpu=True)

        freq_info = {}
        try:
            freq = psutil.cpu_freq()
            if freq:
                freq_info = {
                    "current_mhz": round(freq.current, 1) if freq.current else None,
                    "min_mhz": round(freq.min, 1) if freq.min else None,
                    "max_mhz": round(freq.max, 1) if freq.max else None,
                    "current_ghz": round(freq.current / 1000.0, 2) if freq.current else None,
                }
        except Exception:
            pass

        return {
            "overall_percent": round(overall_percent, 1),
            "per_core_percent": [round(p, 1) for p in per_core_percent],
            "logical_cores": self._logical_cores,
            "physical_cores": self._os_info["physical_cores"],
            "frequency": freq_info,
        }

    def _get_memory_metrics(self) -> Dict[str, Any]:
        """Collect RAM and Swap memory metrics."""
        vm = psutil.virtual_memory()
        swap = psutil.swap_memory()

        bytes_to_gb = 1024 ** 3

        return {
            "ram": {
                "total_gb": round(vm.total / bytes_to_gb, 2),
                "used_gb": round(vm.used / bytes_to_gb, 2),
                "free_gb": round(vm.free / bytes_to_gb, 2),
                "available_gb": round(vm.available / bytes_to_gb, 2),
                "percent": round(vm.percent, 1),
            },
            "swap": {
                "total_gb": round(swap.total / bytes_to_gb, 2),
                "used_gb": round(swap.used / bytes_to_gb, 2),
                "free_gb": round(swap.free / bytes_to_gb, 2),
                "percent": round(swap.percent, 1),
            },
        }

    def _get_disk_metrics(self) -> Dict[str, Any]:
        """Collect disk partition usages and disk I/O rates."""
        partitions_data = []
        bytes_to_gb = 1024 ** 3
        total_all_bytes = 0
        used_all_bytes = 0
        free_all_bytes = 0

        partitions = psutil.disk_partitions(all=False)
        seen_mounts = set()

        for part in partitions:
            if part.mountpoint in seen_mounts:
                continue
            seen_mounts.add(part.mountpoint)

            if 'cdrom' in part.opts or part.fstype == '':
                continue

            try:
                usage = psutil.disk_usage(part.mountpoint)
                total_all_bytes += usage.total
                used_all_bytes += usage.used
                free_all_bytes += usage.free

                partitions_data.append({
                    "device": part.device,
                    "mountpoint": part.mountpoint,
                    "fstype": part.fstype,
                    "total_gb": round(usage.total / bytes_to_gb, 2),
                    "used_gb": round(usage.used / bytes_to_gb, 2),
                    "free_gb": round(usage.free / bytes_to_gb, 2),
                    "percent": round(usage.percent, 1),
                })
            except (PermissionError, OSError):
                continue

        # Disk I/O rates
        now = time.time()
        dt = max(0.001, now - self._last_disk_time)
        disk_io = psutil.disk_io_counters()

        read_speed_kbs = 0.0
        write_speed_kbs = 0.0
        if disk_io:
            read_speed_kbs = max(0.0, (disk_io.read_bytes - self._last_disk_read) / dt / 1024)
            write_speed_kbs = max(0.0, (disk_io.write_bytes - self._last_disk_write) / dt / 1024)
            self._last_disk_read = disk_io.read_bytes
            self._last_disk_write = disk_io.write_bytes
        self._last_disk_time = now

        overall_percent = round((used_all_bytes / total_all_bytes * 100), 1) if total_all_bytes > 0 else 0.0

        return {
            "partitions": partitions_data,
            "summary": {
                "total_gb": round(total_all_bytes / bytes_to_gb, 2),
                "used_gb": round(used_all_bytes / bytes_to_gb, 2),
                "free_gb": round(free_all_bytes / bytes_to_gb, 2),
                "percent": overall_percent,
            },
            "io": {
                "read_speed_kbs": round(read_speed_kbs, 1),
                "write_speed_kbs": round(write_speed_kbs, 1),
                "read_speed_mbs": round(read_speed_kbs / 1024, 2),
                "write_speed_mbs": round(write_speed_kbs / 1024, 2),
            }
        }

    def _get_network_metrics(self) -> Dict[str, Any]:
        """Calculate network download/upload speeds and transfer volume."""
        now = time.time()
        dt = max(0.001, now - self._last_net_time)

        net_io = psutil.net_io_counters()
        download_speed_kbs = 0.0
        upload_speed_kbs = 0.0
        total_recv_mb = 0.0
        total_sent_mb = 0.0

        if net_io:
            download_speed_kbs = max(0.0, (net_io.bytes_recv - self._last_bytes_recv) / dt / 1024)
            upload_speed_kbs = max(0.0, (net_io.bytes_sent - self._last_bytes_sent) / dt / 1024)

            self._last_bytes_recv = net_io.bytes_recv
            self._last_bytes_sent = net_io.bytes_sent

            total_recv_mb = round(net_io.bytes_recv / (1024 * 1024), 2)
            total_sent_mb = round(net_io.bytes_sent / (1024 * 1024), 2)

        self._last_net_time = now

        return {
            "download_kbs": round(download_speed_kbs, 1),
            "upload_kbs": round(upload_speed_kbs, 1),
            "download_mbs": round(download_speed_kbs / 1024, 2),
            "upload_mbs": round(upload_speed_kbs / 1024, 2),
            "total_recv_mb": total_recv_mb,
            "total_sent_mb": total_sent_mb,
        }

    def _get_top_processes(self, limit: int = 10) -> Dict[str, Any]:
        """Fetch top running processes ranked by CPU and RAM consumption."""
        procs = []
        now = time.time()
        new_proc_cache = {}

        for p in psutil.process_iter(['pid', 'name', 'cpu_times', 'memory_percent', 'memory_info', 'status', 'username']):
            try:
                info = p.info
                pid = info['pid']
                name = info['name'] or f"PID {pid}"

                # Calculate CPU percent using time delta
                cpu_p = 0.0
                cpu_times = info.get('cpu_times')
                if cpu_times:
                    curr_proc_time = cpu_times.user + cpu_times.system
                    new_proc_cache[pid] = (curr_proc_time, now)

                    if pid in self._proc_cpu_cache:
                        prev_proc_time, prev_time = self._proc_cpu_cache[pid]
                        dt = max(0.001, now - prev_time)
                        # Process CPU % across logical cores
                        cpu_p = max(0.0, ((curr_proc_time - prev_proc_time) / dt / self._logical_cores) * 100)

                # Filter out System Idle Process from top consumer rankings
                if pid == 0 or name == "System Idle Process":
                    continue

                rss = info.get('memory_info')
                mem_mb = round(rss.rss / (1024 * 1024), 1) if rss else 0.0
                mem_p = round(info.get('memory_percent') or 0.0, 1)

                procs.append({
                    "pid": pid,
                    "name": name,
                    "cpu_percent": round(min(100.0, cpu_p), 1),
                    "memory_percent": mem_p,
                    "memory_mb": mem_mb,
                    "status": info.get('status') or 'running',
                    "username": info.get('username') or 'N/A',
                })
            except (psutil.NoSuchProcess, psutil.AccessDenied, psutil.ZombieProcess):
                continue

        self._proc_cpu_cache = new_proc_cache

        top_cpu = sorted(procs, key=lambda x: x["cpu_percent"], reverse=True)[:limit]
        top_ram = sorted(procs, key=lambda x: x["memory_percent"], reverse=True)[:limit]

        return {
            "by_cpu": top_cpu,
            "by_ram": top_ram,
            "total_process_count": len(procs),
        }

    def get_all_metrics(self) -> Dict[str, Any]:
        """Combine all real-time system metrics into a single response object."""
        return {
            "timestamp": time.time(),
            "time_iso": datetime.now().strftime("%H:%M:%S"),
            "os": self._os_info,
            "uptime": self._get_uptime_info(),
            "cpu": self._get_cpu_metrics(),
            "memory": self._get_memory_metrics(),
            "disk": self._get_disk_metrics(),
            "network": self._get_network_metrics(),
            "processes": self._get_top_processes(limit=10),
        }

collector = MetricsCollector()
