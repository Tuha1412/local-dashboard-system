import asyncio
import os
import re
import socket
import subprocess
import time
from typing import Any, Dict, Optional, Tuple

class NetworkHelper:
    def __init__(self, cache_ttl_seconds: float = 3.0):
        self.cache_ttl = cache_ttl_seconds
        self._last_check_time: float = 0.0
        self._cached_status: Dict[str, Any] = {
            "local_ip": "127.0.0.1",
            "ping_ms": None,
            "online": True,
            "target": "8.8.8.8",
        }
        self._lock = asyncio.Lock()

    def _get_local_ip(self) -> str:
        """Get the primary local IP address assigned to the machine."""
        try:
            s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            s.settimeout(0.5)
            s.connect(("8.8.8.8", 80))
            ip = s.getsockname()[0]
            s.close()
            return ip
        except Exception:
            return "127.0.0.1"

    def _ping_sync(self, host: str = "8.8.8.8") -> Tuple[Optional[int], bool]:
        """Perform a single fast ping to measure round-trip latency in ms."""
        try:
            t0 = time.perf_counter()
            res = subprocess.run(
                ["ping", "-n", "1", "-w", "1000", host],
                capture_output=True,
                text=True,
                timeout=1.5,
            )
            if res.returncode == 0:
                match = re.search(r"time[=<](\d+)ms", res.stdout, re.IGNORECASE)
                if match:
                    return int(match.group(1)), True
                latency = int((time.perf_counter() - t0) * 1000)
                return max(1, latency), True
            return None, False
        except Exception:
            return None, False

    def _check_network_sync(self) -> Dict[str, Any]:
        """Collect local IP and ping latency."""
        local_ip = self._get_local_ip()
        ping_ms, online = self._ping_sync("8.8.8.8")

        return {
            "local_ip": local_ip,
            "ping_ms": ping_ms,
            "online": online,
            "target": "8.8.8.8",
            "timestamp": time.time(),
        }

    async def get_network_status_async(self, force: bool = False) -> Dict[str, Any]:
        """Asynchronously return network telemetry with 3-second cache."""
        now = time.time()
        async with self._lock:
            if not force and (now - self._last_check_time < self.cache_ttl):
                return self._cached_status

            status = await asyncio.to_thread(self._check_network_sync)
            self._cached_status = status
            self._last_check_time = now
            return status

network_helper = NetworkHelper(cache_ttl_seconds=3.0)
