import time
import asyncio
from typing import Optional, Dict, Any, List
import httpx

# WMO Weather interpretation codes (WW) mapping
WMO_CODE_MAP = {
    0: {"condition": "clear", "text_vi": "Trời quang đãng", "text_en": "Clear sky", "icon_day": "☀️", "icon_night": "🌙"},
    1: {"condition": "partly_cloudy", "text_vi": "Ít mây", "text_en": "Mainly clear", "icon_day": "🌤️", "icon_night": "☁️"},
    2: {"condition": "partly_cloudy", "text_vi": "Mây rải rác", "text_en": "Partly cloudy", "icon_day": "⛅", "icon_night": "☁️"},
    3: {"condition": "cloudy", "text_vi": "Trời nhiều mây", "text_en": "Overcast", "icon_day": "☁️", "icon_night": "☁️"},
    45: {"condition": "fog", "text_vi": "Sương mù", "text_en": "Fog", "icon_day": "🌫️", "icon_night": "🌫️"},
    48: {"condition": "fog", "text_vi": "Sương muối tích tụ", "text_en": "Depositing rime fog", "icon_day": "🌫️", "icon_night": "🌫️"},
    51: {"condition": "drizzle", "text_vi": "Mưa phùn nhẹ", "text_en": "Light drizzle", "icon_day": "🌦️", "icon_night": "🌧️"},
    53: {"condition": "drizzle", "text_vi": "Mưa phùn vừa", "text_en": "Moderate drizzle", "icon_day": "🌦️", "icon_night": "🌧️"},
    55: {"condition": "drizzle", "text_vi": "Mưa phùn nặng hạt", "text_en": "Dense drizzle", "icon_day": "🌧️", "icon_night": "🌧️"},
    56: {"condition": "drizzle", "text_vi": "Mưa phùn lạnh buốt", "text_en": "Freezing drizzle", "icon_day": "🌨️", "icon_night": "🌨️"},
    57: {"condition": "drizzle", "text_vi": "Mưa phùn dày đặc", "text_en": "Dense freezing drizzle", "icon_day": "🌨️", "icon_night": "🌨️"},
    61: {"condition": "rain", "text_vi": "Mưa nhỏ rải rác", "text_en": "Slight rain", "icon_day": "🌦️", "icon_night": "🌧️"},
    63: {"condition": "rain", "text_vi": "Mưa vừa", "text_en": "Moderate rain", "icon_day": "🌧️", "icon_night": "🌧️"},
    65: {"condition": "rain", "text_vi": "Mưa rào to", "text_en": "Heavy rain", "icon_day": "🌧️", "icon_night": "🌧️"},
    66: {"condition": "rain", "text_vi": "Mưa buốt giá", "text_en": "Light freezing rain", "icon_day": "🌨️", "icon_night": "🌨️"},
    67: {"condition": "rain", "text_vi": "Mưa đá lạnh buốt", "text_en": "Heavy freezing rain", "icon_day": "🌨️", "icon_night": "🌨️"},
    71: {"condition": "snow", "text_vi": "Tuyết rơi nhẹ", "text_en": "Slight snow fall", "icon_day": "🌨️", "icon_night": "🌨️"},
    73: {"condition": "snow", "text_vi": "Tuyết rơi vừa", "text_en": "Moderate snow fall", "icon_day": "❄️", "icon_night": "❄️"},
    75: {"condition": "snow", "text_vi": "Bão tuyết to", "text_en": "Heavy snow fall", "icon_day": "❄️", "icon_night": "❄️"},
    77: {"condition": "snow", "text_vi": "Tuyết hạt nhỏ", "text_en": "Snow grains", "icon_day": "🌨️", "icon_night": "🌨️"},
    80: {"condition": "rain", "text_vi": "Mưa rào nhẹ", "text_en": "Slight rain showers", "icon_day": "🌦️", "icon_night": "🌧️"},
    81: {"condition": "rain", "text_vi": "Mưa rào vừa", "text_en": "Moderate rain showers", "icon_day": "🌧️", "icon_night": "🌧️"},
    82: {"condition": "rain", "text_vi": "Mưa rào rất to", "text_en": "Violent rain showers", "icon_day": "⛈️", "icon_night": "⛈️"},
    85: {"condition": "snow", "text_vi": "Mưa tuyết nhẹ", "text_en": "Slight snow showers", "icon_day": "🌨️", "icon_night": "🌨️"},
    86: {"condition": "snow", "text_vi": "Mưa tuyết dày", "text_en": "Heavy snow showers", "icon_day": "❄️", "icon_night": "❄️"},
    95: {"condition": "thunderstorm", "text_vi": "Dông bão sấm sét", "text_en": "Thunderstorm", "icon_day": "⛈️", "icon_night": "⛈️"},
    96: {"condition": "thunderstorm", "text_vi": "Dông kèm mưa đá nhỏ", "text_en": "Thunderstorm with slight hail", "icon_day": "⛈️", "icon_night": "⛈️"},
    99: {"condition": "thunderstorm", "text_vi": "Dông bão mưa đá dữ dội", "text_en": "Thunderstorm with heavy hail", "icon_day": "⚡", "icon_night": "⚡"},
}

DEFAULT_FALLBACK_LOCATION = {
    "city": "Hà Nội",
    "country": "Vietnam",
    "lat": 21.0285,
    "lon": 105.8542
}

class WeatherService:
    def __init__(self):
        self.cached_weather: Optional[Dict[str, Any]] = None
        self.last_fetched_time: float = 0
        self.cache_ttl_seconds: float = 1200 # 20 minutes cache
        self.detected_location: Optional[Dict[str, Any]] = None

    async def get_geolocation_async(self) -> Dict[str, Any]:
        """Detect client/server public IP location with multiple reliable fallbacks."""
        if self.detected_location:
            return self.detected_location

        # Try ip-api.com
        try:
            async with httpx.AsyncClient(timeout=3.0) as client:
                res = await client.get("http://ip-api.com/json/?fields=status,country,city,lat,lon")
                if res.status_code == 200:
                    data = res.json()
                    if data.get("status") == "success" and "lat" in data and "lon" in data:
                        self.detected_location = {
                            "city": data.get("city") or "Hà Nội",
                            "country": data.get("country") or "Vietnam",
                            "lat": round(float(data.get("lat")), 4),
                            "lon": round(float(data.get("lon")), 4)
                        }
                        return self.detected_location
        except Exception:
            pass

        # Try ipapi.co fallback
        try:
            async with httpx.AsyncClient(timeout=3.0) as client:
                res = await client.get("https://ipapi.co/json/")
                if res.status_code == 200:
                    data = res.json()
                    if "latitude" in data and "longitude" in data:
                        self.detected_location = {
                            "city": data.get("city") or "Hà Nội",
                            "country": data.get("country_name") or "Vietnam",
                            "lat": round(float(data.get("latitude")), 4),
                            "lon": round(float(data.get("longitude")), 4)
                        }
                        return self.detected_location
        except Exception:
            pass

        return DEFAULT_FALLBACK_LOCATION

    async def fetch_weather_async(self, force: bool = False) -> Dict[str, Any]:
        """Fetch real-time weather from Open-Meteo API with caching."""
        now = time.time()
        if not force and self.cached_weather and (now - self.last_fetched_time < self.cache_ttl_seconds):
            return self.cached_weather

        loc = await self.get_geolocation_async()
        lat = loc["lat"]
        lon = loc["lon"]
        city = loc["city"]
        country = loc["country"]

        url = (
            f"https://api.open-meteo.com/v1/forecast"
            f"?latitude={lat}&longitude={lon}"
            f"&current=temperature_2m,relative_humidity_2m,apparent_temperature,is_day,precipitation,weather_code,wind_speed_10m"
            f"&hourly=temperature_2m,weather_code,is_day"
            f"&timezone=auto"
            f"&forecast_days=2"
        )

        try:
            headers = {"User-Agent": "LocalDashboardSystem/1.0 (Windows NT 10.0; x64)"}
            async with httpx.AsyncClient(timeout=6.0, headers=headers) as client:
                res = await client.get(url)
                if res.status_code != 200:
                    raise RuntimeError(f"Open-Meteo API returned status {res.status_code}")

                data = res.json()
                current = data.get("current", {})
                hourly = data.get("hourly", {})

                weather_code = int(current.get("weather_code", 0))
                is_day = int(current.get("is_day", 1))
                wmo_info = WMO_CODE_MAP.get(weather_code, WMO_CODE_MAP[0])

                condition = wmo_info["condition"]
                condition_text = wmo_info["text_vi"]
                icon = wmo_info["icon_day"] if is_day == 1 else wmo_info["icon_night"]

                # Process 6-hour hourly forecast
                hourly_times = hourly.get("time", [])
                hourly_temps = hourly.get("temperature_2m", [])
                hourly_codes = hourly.get("weather_code", [])
                hourly_is_days = hourly.get("is_day", [])

                hourly_forecast: List[Dict[str, Any]] = []
                current_time_iso = current.get("time", "")

                # Find index of current hour
                start_idx = 0
                if current_time_iso:
                    prefix = current_time_iso[:13]  # YYYY-MM-DDTHH
                    for idx, t in enumerate(hourly_times):
                        if t.startswith(prefix):
                            start_idx = idx
                            break

                for i in range(start_idx, min(start_idx + 8, len(hourly_times))):
                    t_str = hourly_times[i]
                    # Parse HH:MM from ISO string e.g. "2026-08-31T15:00"
                    hour_label = t_str.split("T")[-1] if "T" in t_str else t_str
                    code_i = int(hourly_codes[i]) if i < len(hourly_codes) else 0
                    is_day_i = int(hourly_is_days[i]) if i < len(hourly_is_days) else 1
                    wmo_i = WMO_CODE_MAP.get(code_i, WMO_CODE_MAP[0])
                    icon_i = wmo_i["icon_day"] if is_day_i == 1 else wmo_i["icon_night"]

                    hourly_forecast.append({
                        "time": hour_label,
                        "temp": round(float(hourly_temps[i]), 1) if i < len(hourly_temps) else current.get("temperature_2m", 25.0),
                        "code": code_i,
                        "condition": wmo_i["condition"],
                        "condition_text": wmo_i["text_vi"],
                        "icon": icon_i,
                        "is_day": is_day_i
                    })

                result = {
                    "status": "success",
                    "source": "open-meteo",
                    "city": city,
                    "country": country,
                    "latitude": lat,
                    "longitude": lon,
                    "temp": round(float(current.get("temperature_2m", 25.0)), 1),
                    "apparent_temp": round(float(current.get("apparent_temperature", 26.0)), 1),
                    "humidity": int(current.get("relative_humidity_2m", 60)),
                    "wind_speed": round(float(current.get("wind_speed_10m", 5.0)), 1),
                    "precipitation": round(float(current.get("precipitation", 0.0)), 1),
                    "is_day": is_day,
                    "weather_code": weather_code,
                    "weather_condition": condition,
                    "condition_text": condition_text,
                    "condition_icon": icon,
                    "hourly_forecast": hourly_forecast[:6],
                    "updated_at": time.strftime("%H:%M:%S")
                }

                self.cached_weather = result
                self.last_fetched_time = now
                return result

        except Exception as e:
            # Fallback offline estimate if Open-Meteo or network unreachable
            if self.cached_weather:
                return self.cached_weather

            return {
                "status": "fallback",
                "source": "offline_estimate",
                "city": city,
                "country": country,
                "latitude": lat,
                "longitude": lon,
                "temp": 28.0,
                "apparent_temp": 30.0,
                "humidity": 70,
                "wind_speed": 10.0,
                "precipitation": 0.0,
                "is_day": 1,
                "weather_code": 1,
                "weather_condition": "partly_cloudy",
                "condition_text": "Trời quang đãng, mát mẻ",
                "condition_icon": "🌤️",
                "hourly_forecast": [
                    {"time": "14:00", "temp": 28.0, "icon": "🌤️", "condition": "partly_cloudy", "condition_text": "Ít mây"},
                    {"time": "15:00", "temp": 28.5, "icon": "🌤️", "condition": "partly_cloudy", "condition_text": "Ít mây"},
                    {"time": "16:00", "temp": 28.0, "icon": "⛅", "condition": "partly_cloudy", "condition_text": "Nắng nhẹ"},
                    {"time": "17:00", "temp": 27.2, "icon": "⛅", "condition": "partly_cloudy", "condition_text": "Dịu mát"},
                    {"time": "18:00", "temp": 26.5, "icon": "🌥️", "condition": "cloudy", "condition_text": "Hoàng hôn"},
                    {"time": "19:00", "temp": 25.8, "icon": "🌙", "condition": "clear", "condition_text": "Trời quang"}
                ],
                "updated_at": time.strftime("%H:%M:%S")
            }

# Global Singleton
weather_service = WeatherService()
