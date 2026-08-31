import os
import re
import subprocess
import time
from typing import Dict, Any, Optional
import psutil

class HardwareSensors:
    def __init__(self, cache_ttl_seconds: float = 1.0):
        self.cache_ttl = cache_ttl_seconds
        self._last_gpu_check = 0.0
        self._cached_gpu_data: Dict[str, Any] = {
            "available": False,
            "name": "N/A",
            "temperature_c": None,
            "utilization_percent": None,
            "memory_used_mb": None,
            "memory_total_mb": None,
            "memory_percent": None,
            "power_draw_w": None,
            "fan_speed_percent": None,
        }

    def get_nvidia_gpu_data(self, force: bool = False) -> Dict[str, Any]:
        """Fetch NVIDIA GPU metrics via nvidia-smi with 1-second caching."""
        now = time.time()
        if not force and (now - self._last_gpu_check < self.cache_ttl):
            return self._cached_gpu_data

        try:
            # Query nvidia-smi for real-time telemetry
            res = subprocess.run(
                [
                    'nvidia-smi',
                    '--query-gpu=name,temperature.gpu,utilization.gpu,memory.used,memory.total,power.draw,fan.speed',
                    '--format=csv,noheader,nounits'
                ],
                capture_output=True,
                text=True,
                timeout=1.5
            )

            if res.returncode == 0 and res.stdout.strip():
                parts = [p.strip() for p in res.stdout.strip().splitlines()[0].split(',')]
                if len(parts) >= 6:
                    name = parts[0]
                    temp = int(parts[1]) if parts[1].isdigit() else None
                    util = int(parts[2]) if parts[2].isdigit() else None
                    mem_used = int(float(parts[3])) if parts[3].replace('.', '', 1).isdigit() else 0
                    mem_total = int(float(parts[4])) if parts[4].replace('.', '', 1).isdigit() else 0
                    power = float(parts[5]) if parts[5].replace('.', '', 1).isdigit() else None
                    
                    fan = None
                    if len(parts) >= 7 and parts[6].isdigit():
                        fan = int(parts[6])

                    mem_pct = round((mem_used / mem_total * 100), 1) if mem_total > 0 else 0.0

                    self._cached_gpu_data = {
                        "available": True,
                        "name": name,
                        "temperature_c": temp,
                        "utilization_percent": util,
                        "memory_used_mb": mem_used,
                        "memory_total_mb": mem_total,
                        "memory_percent": mem_pct,
                        "power_draw_w": power,
                        "fan_speed_percent": fan,
                    }
                    self._last_gpu_check = now
                    return self._cached_gpu_data

        except Exception:
            pass

        self._cached_gpu_data = {
            "available": False,
            "name": "No Dedicated GPU Detected",
            "temperature_c": None,
            "utilization_percent": None,
            "memory_used_mb": None,
            "memory_total_mb": None,
            "memory_percent": None,
            "power_draw_w": None,
            "fan_speed_percent": None,
        }
        self._last_gpu_check = now
        return self._cached_gpu_data

    def get_cpu_temperature(self, cpu_load_percent: float = 0.0) -> Dict[str, Any]:
        """
        Get or estimate CPU package temperature.
        If direct ACPI sensor is available, uses it. Otherwise uses calibrated thermal model.
        """
        # Try ACPI ThermalZone if motherboard exposes it
        try:
            res = subprocess.run(
                ['powershell', '-Command', 'Get-CimInstance -Namespace root/wmi -ClassName MSAcpi_ThermalZoneTemperature -ErrorAction SilentlyContinue | Select-Object -ExpandProperty CurrentTemperature'],
                capture_output=True,
                text=True,
                timeout=1.0
            )
            val = res.stdout.strip()
            if val and val.isdigit():
                raw = int(val)
                celsius = round((raw - 2732) / 10.0, 1)
                if 20.0 <= celsius <= 110.0:
                    return {"temperature_c": celsius, "is_estimated": False}
        except Exception:
            pass

        # Calibrated thermal model based on CPU load (base 38°C + load delta)
        # Typical idle 38-42°C, full load 70-82°C
        estimated_temp = round(38.0 + (cpu_load_percent / 100.0) * 42.0, 1)
        return {
            "temperature_c": estimated_temp,
            "is_estimated": True
        }

    def calculate_system_health_score(self, metrics: Dict[str, Any]) -> Dict[str, Any]:
        """Calculate a 0-100 system health score with actionable suggestions."""
        score = 100
        penalties = []
        recommendations = []

        # 1. CPU Load penalty
        cpu_load = metrics.get('cpu', {}).get('overall_percent', 0.0)
        if cpu_load > 90:
            score -= 20
            penalties.append("CPU quá tải (> 90%)")
            recommendations.append("Kiểm tra các tiến trình đang chiếm dụng CPU cao ở bảng Processes.")
        elif cpu_load > 75:
            score -= 10
            penalties.append("CPU tải cao (> 75%)")

        # 2. RAM Usage penalty
        ram_pct = metrics.get('memory', {}).get('ram', {}).get('percent', 0.0)
        if ram_pct > 90:
            score -= 20
            penalties.append("RAM gần đầy (> 90%)")
            recommendations.append("Sử dụng tính năng 'Optimize RAM' để giải phóng bộ nhớ đệm.")
        elif ram_pct > 80:
            score -= 10
            penalties.append("RAM cao (> 80%)")

        # 3. Disk Space penalty
        disks = metrics.get('disk', {}).get('partitions', [])
        for d in disks:
            if d.get('percent', 0) > 90:
                score -= 15
                penalties.append(f"Ổ đĩa {d.get('drive', 'C:')} gần đầy (> 90%)")
                recommendations.append(f"Chạy 'System Cleaner' hoặc kiểm tra dung lượng ổ {d.get('drive', 'C:')}.")
                break

        # 4. GPU Temperature penalty
        gpu_data = self.get_nvidia_gpu_data()
        if gpu_data.get('available') and gpu_data.get('temperature_c'):
            gpu_temp = gpu_data['temperature_c']
            if gpu_temp > 85:
                score -= 15
                penalties.append(f"GPU nhiệt độ cao ({gpu_temp}°C)")
                recommendations.append("Đảm bảo quạt tản nhiệt GPU hoạt động và luồng khí máy tính thông thoáng.")

        score = max(10, min(100, score))

        status_label = "Hoàn hảo (Optimal)"
        status_color = "#c2f83b"
        if score < 60:
            status_label = "Cần chú ý (Critical)"
            status_color = "#f87171"
        elif score < 80:
            status_label = "Tương đối tốt (Fair)"
            status_color = "#fbbf24"

        return {
            "score": score,
            "status_label": status_label,
            "status_color": status_color,
            "penalties": penalties,
            "recommendations": recommendations if recommendations else ["Hệ thống đang hoạt động tối ưu, không có cảnh báo nào."]
        }

hardware_sensors = HardwareSensors(cache_ttl_seconds=1.0)
