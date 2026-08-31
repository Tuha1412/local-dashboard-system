"""
Power & Carbon Cost Estimator Engine.
Estimates real-time hardware power consumption (Watts), cumulative energy usage (kWh),
projected electricity costs (VNĐ), and carbon footprint (kg CO2).
"""

import json
import os
import time
from collections import deque
from typing import Any, Dict, List, Optional
import psutil

CONFIG_FILE = os.path.join(os.path.dirname(os.path.dirname(__file__)), "power_config.json")

DEFAULT_CONFIG: Dict[str, Any] = {
    "kwh_price_vnd": 2500.0,      # Average residential electricity price in Vietnam
    "cpu_tdp_watts": 65.0,        # Default CPU TDP rating (Watts)
    "base_idle_watts": 35.0,      # Motherboard, RAM, SSD, Fans, Chipset base power
    "gpu_tdp_watts": 75.0,        # GPU base TDP (or 0 if integrated only)
    "daily_hours": 8.0,           # Average daily active usage hours
    "currency_symbol": "đ",
}

CO2_GRID_FACTOR = 0.72  # Vietnam national power grid emission factor: 0.72 kg CO2 / kWh
COFFEE_PRICE_VND = 25000.0  # 1 cup of coffee ~ 25,000 VNĐ
TEA_PRICE_VND = 5000.0      # 1 cup of iced tea ~ 5,000 VNĐ
TREE_ANNUAL_CO2_KG = 21.77  # 1 mature tree absorbs ~21.77 kg CO2 / year


class PowerEstimator:
    """Estimates live system wattage, energy usage, and electrical costs."""

    def __init__(self) -> None:
        self.config: Dict[str, Any] = self._load_config()
        self._session_start: float = time.time()
        self._last_sample_time: float = time.time()
        self._accumulated_kwh: float = 0.0
        self._history: deque = deque(maxlen=60)  # Last 60 seconds history
        self._has_dedicated_gpu: bool = self._detect_dedicated_gpu()

    def _load_config(self) -> Dict[str, Any]:
        """Load power settings from JSON config file with fallback defaults."""
        if os.path.exists(CONFIG_FILE):
            try:
                with open(CONFIG_FILE, "r", encoding="utf-8") as f:
                    saved = json.load(f)
                    merged = {**DEFAULT_CONFIG, **saved}
                    return merged
            except Exception:
                pass
        return dict(DEFAULT_CONFIG)

    def save_config(self, new_config: Dict[str, Any]) -> Dict[str, Any]:
        """Update and persist power estimation configuration."""
        for k in ["kwh_price_vnd", "cpu_tdp_watts", "base_idle_watts", "gpu_tdp_watts", "daily_hours"]:
            if k in new_config:
                try:
                    val = float(new_config[k])
                    if val >= 0:
                        self.config[k] = val
                except (ValueError, TypeError):
                    pass

        try:
            with open(CONFIG_FILE, "w", encoding="utf-8") as f:
                json.dump(self.config, f, indent=2)
        except Exception:
            pass

        return self.config

    def _detect_dedicated_gpu(self) -> bool:
        """Heuristic check for dedicated GPU availability."""
        return float(self.config.get("gpu_tdp_watts", 0)) > 0

    def calculate_power(
        self,
        cpu_percent: Optional[float] = None,
        gpu_percent: float = 0.0,
    ) -> Dict[str, Any]:
        """
        Calculate current instant power, costs, and carbon emission stats.
        """
        now = time.time()
        dt = max(0.1, now - self._last_sample_time)
        self._last_sample_time = now

        # 1. Fetch CPU load if not provided
        if cpu_percent is None:
            cpu_percent = psutil.cpu_percent(interval=None)

        cpu_percent = max(0.0, min(100.0, float(cpu_percent)))
        gpu_percent = max(0.0, min(100.0, float(gpu_percent)))

        # 2. Compute Instant Power Breakdown (Watts)
        cpu_tdp = float(self.config.get("cpu_tdp_watts", 65.0))
        base_idle = float(self.config.get("base_idle_watts", 35.0))
        gpu_tdp = float(self.config.get("gpu_tdp_watts", 75.0))

        # CPU dynamic load curve: Idle ~12W + Load scaling up to TDP
        cpu_load_ratio = cpu_percent / 100.0
        cpu_watts = round(12.0 + (cpu_load_ratio * (cpu_tdp - 12.0)), 1)
        if cpu_watts < 8.0:
            cpu_watts = 8.0

        # GPU dynamic load
        if gpu_tdp > 0:
            gpu_load_ratio = gpu_percent / 100.0
            gpu_watts = round(10.0 + (gpu_load_ratio * (gpu_tdp - 10.0)), 1)
        else:
            gpu_watts = 0.0

        # Base Motherboard / RAM / NVMe / Fans
        mobo_ram_watts = round(base_idle, 1)

        # Total System Instant Power
        total_watts = round(cpu_watts + gpu_watts + mobo_ram_watts, 1)

        # 3. Integrate Energy Usage (kWh)
        step_kwh = (total_watts * (dt / 3600.0)) / 1000.0
        self._accumulated_kwh += step_kwh

        # 4. Energy & Cost Forecast
        kwh_price = float(self.config.get("kwh_price_vnd", 2500.0))
        daily_hours = float(self.config.get("daily_hours", 8.0))

        kwh_per_hour = total_watts / 1000.0
        vnd_per_hour = round(kwh_per_hour * kwh_price, 1)
        vnd_per_day = round(vnd_per_hour * daily_hours, 0)
        vnd_per_month = round(vnd_per_day * 30, 0)

        # Session Cost So Far
        session_cost_vnd = round(self._accumulated_kwh * kwh_price, 0)
        session_duration_hrs = round((now - self._session_start) / 3600.0, 2)

        # 5. Carbon Footprint (kg CO2)
        co2_kg_per_hour = round(kwh_per_hour * CO2_GRID_FACTOR, 4)
        co2_kg_per_day = round((kwh_per_hour * daily_hours) * CO2_GRID_FACTOR, 3)
        co2_kg_per_month = round(co2_kg_per_day * 30.0, 2)
        session_co2_kg = round(self._accumulated_kwh * CO2_GRID_FACTOR, 4)

        # 6. Real-world Analogies
        coffee_cups_month = round(vnd_per_month / COFFEE_PRICE_VND, 1)
        tea_cups_month = round(vnd_per_month / TEA_PRICE_VND, 1)
        trees_needed = round((co2_kg_per_month * 12.0) / TREE_ANNUAL_CO2_KG, 2)

        # 7. Record History Point
        point = {
            "time": time.strftime("%H:%M:%S", time.localtime(now)),
            "watts": total_watts,
            "cpu_watts": cpu_watts,
            "gpu_watts": gpu_watts,
            "base_watts": mobo_ram_watts,
        }
        self._history.append(point)

        # Power load tier color indicator
        if total_watts < 90.0:
            tier = "eco"
            tier_label = "ECO LOW"
            tier_color = "#10b981"  # Emerald
        elif total_watts < 180.0:
            tier = "normal"
            tier_label = "NORMAL"
            tier_color = "#fbbf24"  # Amber
        else:
            tier = "high"
            tier_label = "HEAVY LOAD"
            tier_color = "#f87171"  # Red

        return {
            "status": "success",
            "timestamp": now,
            "instant_power": {
                "total_watts": total_watts,
                "cpu_watts": cpu_watts,
                "gpu_watts": gpu_watts,
                "base_watts": mobo_ram_watts,
                "cpu_percent": cpu_percent,
                "gpu_percent": gpu_percent,
                "tier": tier,
                "tier_label": tier_label,
                "tier_color": tier_color,
                "gauge_percent": min(100, round((total_watts / max(200.0, cpu_tdp + gpu_tdp + base_idle)) * 100, 1)),
            },
            "energy_usage": {
                "kwh_per_hour": round(kwh_per_hour, 4),
                "kwh_per_day": round(kwh_per_hour * daily_hours, 3),
                "kwh_per_month": round(kwh_per_hour * daily_hours * 30, 2),
                "session_kwh": round(self._accumulated_kwh, 5),
                "session_hours": session_duration_hrs,
            },
            "cost_forecast": {
                "kwh_price_vnd": kwh_price,
                "daily_hours": daily_hours,
                "vnd_per_hour": vnd_per_hour,
                "vnd_per_day": int(vnd_per_day),
                "vnd_per_month": int(vnd_per_month),
                "session_cost_vnd": int(session_cost_vnd),
                "currency": "VNĐ",
            },
            "carbon_footprint": {
                "grid_factor": CO2_GRID_FACTOR,
                "co2_kg_per_hour": co2_kg_per_hour,
                "co2_kg_per_day": co2_kg_per_day,
                "co2_kg_per_month": co2_kg_per_month,
                "session_co2_kg": session_co2_kg,
            },
            "analogies": {
                "coffee_cups_month": coffee_cups_month,
                "tea_cups_month": tea_cups_month,
                "trees_needed_year": trees_needed,
                "coffee_price_vnd": int(COFFEE_PRICE_VND),
            },
            "config": self.config,
            "history": list(self._history),
        }


# Global singleton instance
power_estimator = PowerEstimator()
