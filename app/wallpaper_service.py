import os
import sys
import ctypes
import tempfile
import asyncio
from io import BytesIO
from typing import Optional, List, Dict, Any
import httpx
from PIL import Image

# Windows SystemParametersInfo Constants
SPI_SETDESKWALLPAPER = 20
SPIF_UPDATEINIFILE = 0x01
SPIF_SENDCHANGE = 0x02

# Fallback Curated HD/4K Wallpaper Database (Fast & 100% Reliable CDN links)
CURATED_FALLBACK_WALLPAPERS: List[Dict[str, Any]] = [
    {
        "id": "cp-01",
        "title": "Neon Cyberpunk City Highway",
        "category": "cyberpunk",
        "resolution": "3840x2160",
        "ratio": "16:9",
        "thumb_url": "https://images.unsplash.com/photo-1519501025264-65ba15a82390?w=600&auto=format&fit=crop&q=80",
        "full_url": "https://images.unsplash.com/photo-1519501025264-65ba15a82390?auto=format&fit=crop&w=3840&q=95",
        "views": 42500,
        "favorites": 1820,
        "colors": ["#0f172a", "#38bdf8", "#bcf846"],
        "tags": ["cyberpunk", "neon", "night", "city", "futuristic"]
    },
    {
        "id": "cp-02",
        "title": "Cyber Blade Runner Alley",
        "category": "cyberpunk",
        "resolution": "3840x2160",
        "ratio": "16:9",
        "thumb_url": "https://images.unsplash.com/photo-1509198397868-475647b2a1e5?w=600&auto=format&fit=crop&q=80",
        "full_url": "https://images.unsplash.com/photo-1509198397868-475647b2a1e5?auto=format&fit=crop&w=3840&q=95",
        "views": 38900,
        "favorites": 1450,
        "colors": ["#1e1b4b", "#ec4899", "#8b5cf6"],
        "tags": ["cyberpunk", "japan", "neon", "arcade", "retro"]
    },
    {
        "id": "an-01",
        "title": "Anime Sunset Valley & Clouds",
        "category": "anime",
        "resolution": "3840x2160",
        "ratio": "16:9",
        "thumb_url": "https://images.unsplash.com/photo-1534447677768-be436bb09401?w=600&auto=format&fit=crop&q=80",
        "full_url": "https://images.unsplash.com/photo-1534447677768-be436bb09401?auto=format&fit=crop&w=3840&q=95",
        "views": 51200,
        "favorites": 2300,
        "colors": ["#f59e0b", "#ec4899", "#1e293b"],
        "tags": ["anime", "scenery", "sky", "sunset", "clouds"]
    },
    {
        "id": "an-02",
        "title": "Anime Neon Tokyo Rain",
        "category": "anime",
        "resolution": "2560x1440",
        "ratio": "16:9",
        "thumb_url": "https://images.unsplash.com/photo-1514565131-fce0801e5785?w=600&auto=format&fit=crop&q=80",
        "full_url": "https://images.unsplash.com/photo-1514565131-fce0801e5785?auto=format&fit=crop&w=2560&q=95",
        "views": 31000,
        "favorites": 1150,
        "colors": ["#0284c7", "#38bdf8", "#0f172a"],
        "tags": ["anime", "rain", "street", "night", "tokyo"]
    },
    {
        "id": "dk-01",
        "title": "Minimalist Dark OLED Geometry",
        "category": "minimalist",
        "resolution": "3840x2160",
        "ratio": "16:9",
        "thumb_url": "https://images.unsplash.com/photo-1550684848-fac1c5b4e853?w=600&auto=format&fit=crop&q=80",
        "full_url": "https://images.unsplash.com/photo-1550684848-fac1c5b4e853?auto=format&fit=crop&w=3840&q=95",
        "views": 62400,
        "favorites": 3400,
        "colors": ["#000000", "#111827", "#bcf846"],
        "tags": ["minimalist", "dark", "oled", "abstract", "modern"]
    },
    {
        "id": "dk-02",
        "title": "Dark Matrix Binary Wave",
        "category": "minimalist",
        "resolution": "3840x2160",
        "ratio": "16:9",
        "thumb_url": "https://images.unsplash.com/photo-1526374965328-7f61d4dc18c5?w=600&auto=format&fit=crop&q=80",
        "full_url": "https://images.unsplash.com/photo-1526374965328-7f61d4dc18c5?auto=format&fit=crop&w=3840&q=95",
        "views": 44100,
        "favorites": 1950,
        "colors": ["#000000", "#10b981", "#bcf846"],
        "tags": ["minimalist", "hacker", "code", "matrix", "matrix-green"]
    },
    {
        "id": "sp-01",
        "title": "Deep Space Nebula & Galaxy Stars",
        "category": "space",
        "resolution": "3840x2160",
        "ratio": "16:9",
        "thumb_url": "https://images.unsplash.com/photo-1506703719100-a0f3a48c0f86?w=600&auto=format&fit=crop&q=80",
        "full_url": "https://images.unsplash.com/photo-1506703719100-a0f3a48c0f86?auto=format&fit=crop&w=3840&q=95",
        "views": 78000,
        "favorites": 4200,
        "colors": ["#0f172a", "#8b5cf6", "#38bdf8"],
        "tags": ["space", "nebula", "galaxy", "stars", "cosmos"]
    },
    {
        "id": "sp-02",
        "title": "Cosmic Earth Horizon View",
        "category": "space",
        "resolution": "3840x2160",
        "ratio": "16:9",
        "thumb_url": "https://images.unsplash.com/photo-1451187580459-43490279c0fa?w=600&auto=format&fit=crop&q=80",
        "full_url": "https://images.unsplash.com/photo-1451187580459-43490279c0fa?auto=format&fit=crop&w=3840&q=95",
        "views": 85000,
        "favorites": 5100,
        "colors": ["#0284c7", "#0f172a", "#38bdf8"],
        "tags": ["space", "earth", "planet", "orbit", "satellite"]
    },
    {
        "id": "nt-01",
        "title": "Emerald Alpine Mountain Peaks",
        "category": "nature",
        "resolution": "3840x2160",
        "ratio": "16:9",
        "thumb_url": "https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?w=600&auto=format&fit=crop&q=80",
        "full_url": "https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?auto=format&fit=crop&w=3840&q=95",
        "views": 61200,
        "favorites": 2890,
        "colors": ["#10b981", "#047857", "#0f172a"],
        "tags": ["nature", "mountain", "landscape", "alps", "fog"]
    },
    {
        "id": "nt-02",
        "title": "Moody Foggy Pine Forest",
        "category": "nature",
        "resolution": "3840x2160",
        "ratio": "16:9",
        "thumb_url": "https://images.unsplash.com/photo-1448375240586-882707db888b?w=600&auto=format&fit=crop&q=80",
        "full_url": "https://images.unsplash.com/photo-1448375240586-882707db888b?auto=format&fit=crop&w=3840&q=95",
        "views": 49800,
        "favorites": 2100,
        "colors": ["#064e3b", "#065f46", "#111827"],
        "tags": ["nature", "forest", "trees", "fog", "serene"]
    },
    {
        "id": "gm-01",
        "title": "Cyber Gaming Setup & Neon Grid",
        "category": "gaming",
        "resolution": "3840x2160",
        "ratio": "16:9",
        "thumb_url": "https://images.unsplash.com/photo-1542751371-adc38448a05e?w=600&auto=format&fit=crop&q=80",
        "full_url": "https://images.unsplash.com/photo-1542751371-adc38448a05e?auto=format&fit=crop&w=3840&q=95",
        "views": 67000,
        "favorites": 3150,
        "colors": ["#a855f7", "#ec4899", "#0f172a"],
        "tags": ["gaming", "esports", "battlestation", "rgb", "neon"]
    },
    {
        "id": "gm-02",
        "title": "Retro Cyber Arcade Console",
        "category": "gaming",
        "resolution": "3840x2160",
        "ratio": "16:9",
        "thumb_url": "https://images.unsplash.com/photo-1550745165-9bc0b252726f?w=600&auto=format&fit=crop&q=80",
        "full_url": "https://images.unsplash.com/photo-1550745165-9bc0b252726f?auto=format&fit=crop&w=3840&q=95",
        "views": 53200,
        "favorites": 2400,
        "colors": ["#3b82f6", "#fbbf24", "#0f172a"],
        "tags": ["gaming", "retro", "synthwave", "arcade", "controller"]
    }
]

class WallpaperService:
    def __init__(self):
        self.wallhaven_base_url = "https://wallhaven.cc/api/v1/search"
        self.last_applied_wallpaper: Optional[Dict[str, Any]] = None
        self.history: List[Dict[str, Any]] = []

    async def search_wallpapers_async(
        self,
        query: Optional[str] = None,
        category: str = "all",
        sorting: str = "toplist",
        resolution: str = "all",
        page: int = 1
    ) -> Dict[str, Any]:
        """
        Fetch wallpapers from Wallhaven API with automatic fallback to high-quality curated 4K gallery.
        """
        search_terms = []
        if query and query.strip():
            search_terms.append(query.strip())
        elif category and category != "all":
            category_mapping = {
                "cyberpunk": "cyberpunk neon city",
                "anime": "anime landscape scenery",
                "minimalist": "minimalist dark oled",
                "space": "space galaxy nebula 4k",
                "nature": "nature landscape mountains 4k",
                "gaming": "gaming cyber synthwave",
                "dark": "dark wallpaper oled black"
            }
            search_terms.append(category_mapping.get(category.lower(), category))

        final_q = " ".join(search_terms) if search_terms else ""

        # Prepare parameters for Wallhaven
        params = {
            "purity": "100",  # SFW strictly
            "sorting": sorting if sorting in ["toplist", "views", "random", "relevance"] else "toplist",
            "page": str(page),
            "ratios": "16x9,16x10,21x9",
        }

        if final_q:
            params["q"] = final_q

        if resolution == "4k":
            params["resolutions"] = "3840x2160,5120x2880,7680x4320"
        elif resolution == "2k":
            params["resolutions"] = "2560x1440,2560x1600"
        elif resolution == "1080p":
            params["resolutions"] = "1920x1080,1920x1200"

        # Attempt to call Wallhaven API
        try:
            headers = {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                "Accept": "application/json"
            }
            async with httpx.AsyncClient(timeout=6.0, follow_redirects=True, headers=headers) as client:
                res = await client.get(self.wallhaven_base_url, params=params)
                if res.status_code == 200:
                    data = res.json()
                    items = data.get("data", [])
                    if items:
                        wallpapers = []
                        for it in items:
                            thumbs = it.get("thumbs", {})
                            wallpapers.append({
                                "id": it.get("id"),
                                "title": f"Wallpaper {it.get('id')}",
                                "category": it.get("category", "General"),
                                "resolution": it.get("resolution", "3840x2160"),
                                "ratio": it.get("ratio", "16:9"),
                                "thumb_url": thumbs.get("large") or thumbs.get("small") or it.get("path"),
                                "full_url": it.get("path"),
                                "views": it.get("views", 0),
                                "favorites": it.get("favorites", 0),
                                "colors": it.get("colors", []),
                                "tags": [category] if category != "all" else ["4k", "wallpaper"],
                                "source": "wallhaven"
                            })
                        
                        meta = data.get("meta", {})
                        return {
                            "status": "success",
                            "source": "wallhaven",
                            "current_page": meta.get("current_page", page),
                            "last_page": meta.get("last_page", 10),
                            "total": meta.get("total", len(wallpapers)),
                            "wallpapers": wallpapers
                        }
        except Exception as e:
            # Network issue or Wallhaven rate-limited, fall through to curated collection
            pass

        # Fallback to Curated Database
        filtered = CURATED_FALLBACK_WALLPAPERS
        if category and category != "all":
            filtered = [w for w in CURATED_FALLBACK_WALLPAPERS if w["category"].lower() == category.lower()]
            if not filtered:
                filtered = CURATED_FALLBACK_WALLPAPERS

        if query and query.strip():
            kw = query.strip().lower()
            q_matches = [w for w in CURATED_FALLBACK_WALLPAPERS if kw in w["title"].lower() or any(kw in t for t in w.get("tags", []))]
            if q_matches:
                filtered = q_matches

        return {
            "status": "success",
            "source": "curated_cdn",
            "current_page": 1,
            "last_page": 1,
            "total": len(filtered),
            "wallpapers": filtered
        }

    async def set_desktop_wallpaper_async(self, image_url: str, title: Optional[str] = None) -> Dict[str, Any]:
        """
        Download high-res wallpaper, convert/save cleanly with Pillow, and apply to Windows desktop via User32 API.
        """
        if not image_url or not image_url.startswith("http"):
            raise ValueError("Invalid image URL provided")

        # 1. Download image asynchronously
        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Accept": "image/*"
        }
        async with httpx.AsyncClient(timeout=35.0, follow_redirects=True, headers=headers) as client:
            resp = await client.get(image_url)
            if resp.status_code != 200:
                raise RuntimeError(f"Failed to download image (HTTP {resp.status_code})")
            image_bytes = resp.content

        # 2. Process image with Pillow in a thread pool to avoid blocking the event loop
        def save_processed_image():
            temp_dir = tempfile.gettempdir()
            output_file = os.path.join(temp_dir, "custom_desktop_wallpaper.jpg")
            
            with Image.open(BytesIO(image_bytes)) as img:
                # Convert RGBA/Palette/Grayscale to standard RGB
                if img.mode != 'RGB':
                    rgb_img = img.convert('RGB')
                else:
                    rgb_img = img
                
                # Save with high quality JPEG
                rgb_img.save(output_file, "JPEG", quality=98)
                width, height = rgb_img.width, rgb_img.height

            return os.path.abspath(output_file), width, height

        abs_path, width, height = await asyncio.to_thread(save_processed_image)

        # 3. Call Windows user32 SystemParametersInfoW
        def apply_wallpaper_win32():
            if hasattr(ctypes, 'windll') and hasattr(ctypes.windll, 'user32'):
                res = ctypes.windll.user32.SystemParametersInfoW(
                    SPI_SETDESKWALLPAPER,
                    0,
                    abs_path,
                    SPIF_UPDATEINIFILE | SPIF_SENDCHANGE
                )
                return bool(res)
            return False

        applied = await asyncio.to_thread(apply_wallpaper_win32)
        if not applied:
            raise RuntimeError(f"SystemParametersInfoW Windows API returned failure code: {ctypes.GetLastError()}")

        # Record in history
        meta = {
            "title": title or "Custom Desktop Wallpaper",
            "image_url": image_url,
            "local_path": abs_path,
            "file_path": abs_path,
            "width": width,
            "height": height,
            "applied_at": "Just now"
        }
        self.last_applied_wallpaper = meta
        self.history.insert(0, meta)
        if len(self.history) > 20:
            self.history.pop()

        return {
            "status": "success",
            "message": "Đã đổi hình nền máy tính Windows thành công!",
            "details": meta
        }

    def get_info(self) -> Dict[str, Any]:
        return {
            "last_applied": self.last_applied_wallpaper,
            "history": self.history[:10],
            "categories": [
                {"id": "all", "label": "Tất Cả", "icon": "🌟"},
                {"id": "cyberpunk", "label": "Cyberpunk", "icon": "🌆"},
                {"id": "anime", "label": "Anime Scenery", "icon": "🌸"},
                {"id": "minimalist", "label": "Dark Minimal", "icon": "🖤"},
                {"id": "space", "label": "Cosmic & Galaxy", "icon": "🚀"},
                {"id": "nature", "label": "Nature & Forest", "icon": "🌲"},
                {"id": "gaming", "label": "Gaming & RGB", "icon": "🎮"},
            ]
        }

# Global Singleton Service
wallpaper_service = WallpaperService()
