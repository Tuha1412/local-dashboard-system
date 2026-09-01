import asyncio
import os
from pathlib import Path
from typing import Set

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
# pyrefly: ignore [missing-import]
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from app.metrics import collector
from app.disk_analyzer import disk_analyzer
from app.system_notifications import notification_collector
from app.action_center_reader import action_center_reader
from app.network_helper import network_helper
from app.actions import actions_manager
from app.ai_copilot import ai_copilot
from app.gemini_service import gemini_service
from app.app_tracker import app_tracker
from app.downloads_analyzer import downloads_analyzer
from app.alert_engine import alert_engine
from app.network_radar import network_radar
from app.power_estimator import power_estimator
from app.wallpaper_service import wallpaper_service
from app.weather_service import weather_service
from app.snippet_lab_service import snippet_lab_service
from app.media_preview_service import media_preview_service
from app.vocab_service import vocab_service
from app.disk_delta_service import disk_delta_service
from fastapi import Request
from fastapi.responses import FileResponse
from pydantic import BaseModel
from typing import Optional, Set, List, Dict, Any

BASE_DIR = Path(__file__).resolve().parent.parent
STATIC_DIR = BASE_DIR / "static"

app = FastAPI(
    title="System Performance Monitor",
    description="Real-time PC Performance Monitoring Dashboard using FastAPI and psutil",
    version="1.0.0",
)

@app.on_event("startup")
async def on_startup():
    """Start background services on server startup."""
    app_tracker.start_background_tracker()
    alert_engine.start_background_monitor(collector)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Active WebSocket connections manager
class ConnectionManager:
    def __init__(self):
        self.active_connections: Set[WebSocket] = set()

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.add(websocket)

    def disconnect(self, websocket: WebSocket):
        self.active_connections.discard(websocket)

manager = ConnectionManager()

class AskPromptRequest(BaseModel):
    question: str = ""

class VoiceCommandRequest(BaseModel):
    query: str = ""
    lang: str = "vi"

class GeminiConfigRequest(BaseModel):
    api_key: str = ""
    model: str = "gemini-2.5-pro"

class OpenFolderRequest(BaseModel):
    file_path: str = ""

class VocabCreateRequest(BaseModel):
    word: str
    phonetic: Optional[str] = ""
    part_of_speech: Optional[str] = "Noun"
    meaning_vi: str
    example_en: Optional[str] = ""
    example_vi: Optional[str] = ""
    category: Optional[str] = "General English"

class VocabUpdateRequest(BaseModel):
    word: Optional[str] = None
    phonetic: Optional[str] = None
    part_of_speech: Optional[str] = None
    meaning_vi: Optional[str] = None
    example_en: Optional[str] = None
    example_vi: Optional[str] = None
    category: Optional[str] = None

@app.get("/api/metrics")
async def get_metrics():
    """REST API endpoint to fetch current system metrics snapshot."""
    return collector.get_all_metrics()

@app.get("/api/insights")
async def get_smart_insights():
    """Generate smart AI insights, health score and suggestions from current metrics."""
    metrics = collector.get_all_metrics()
    return ai_copilot.generate_smart_insights(metrics)

@app.post("/api/insights/ask")
async def ask_copilot(req: AskPromptRequest):
    """Answer user questions with Gemini Pro (if configured) or fast local engine."""
    metrics = collector.get_all_metrics()
    if gemini_service.is_configured():
        return await gemini_service.answer_query_async(req.question, metrics)
    return ai_copilot.answer_query(req.question, metrics)

@app.post("/api/voice/command")
async def process_voice_command_endpoint(req: VoiceCommandRequest):
    """
    Process voice commands from Jarvis assistant, execute system actions,
    and return concise spoken voice responses and rich UI display data.
    """
    metrics = collector.get_all_metrics()
    result = ai_copilot.process_voice_command(req.query, metrics, lang=req.lang)

    action = result.get("action")
    action_result = None

    if action == "clean_temp":
        action_result = await actions_manager.clean_temp_async()
        if action_result.get("status") == "success":
            freed = action_result.get("freed_mb", 0)
            if req.lang == "vi":
                result["spoken_response"] = f"Đã dọn dẹp thành công các file tạm, giải phóng {freed} Megabyte bộ nhớ."
                result["display_text"] = f"🧹 **Hoàn tất:** Đã dọn dẹp file tạm và giải phóng **{freed} MB** dung lượng."
            else:
                result["spoken_response"] = f"Successfully cleaned temporary files, freeing {freed} megabytes of space."
                result["display_text"] = f"🧹 **Completed:** Cleaned temporary files, freed **{freed} MB**."
    elif action == "flush_dns":
        action_result = await actions_manager.flush_dns_async()
        if action_result.get("status") == "success":
            if req.lang == "vi":
                result["spoken_response"] = "Đã làm mới bộ nhớ đệm DNS hệ thống thành công."
                result["display_text"] = "⚡ **Hoàn tất:** Đã làm mới DNS Resolver Cache thành công."
            else:
                result["spoken_response"] = "Successfully flushed Windows DNS Resolver cache."
                result["display_text"] = "⚡ **Completed:** Successfully flushed DNS Resolver cache."
    elif action == "engage_focus":
        action_result = await actions_manager.engage_focus_async()
        if action_result.get("status") == "success":
            freed = action_result.get("freed_mb", 0)
            if req.lang == "vi":
                result["spoken_response"] = f"Kích hoạt chế độ Cyber Focus! Đã tối ưu {freed} Megabyte bộ nhớ đệm."
                result["display_text"] = f"🎯 **Focus Matrix Active:** Đã tối ưu ~**{freed} MB** bộ nhớ đệm."
            else:
                result["spoken_response"] = f"Cyber Focus engaged! Optimized {freed} megabytes of memory buffer."
                result["display_text"] = f"🎯 **Focus Matrix Active:** Optimized ~**{freed} MB** memory buffer."

    result["action_result"] = action_result
    return result

@app.get("/api/gemini/config")
async def get_gemini_config():
    """Fetch current Gemini Pro connection and model status."""
    return gemini_service.get_config()

@app.post("/api/gemini/config")
async def update_gemini_config(req: GeminiConfigRequest):
    """Update and verify Gemini API key and active model."""
    return gemini_service.update_config(api_key=req.api_key, model_name=req.model)

@app.get("/api/network/status")
async def get_network_status(force: bool = False):
    """Fetch network ping latency and local IP address."""
    return await network_helper.get_network_status_async(force=force)

@app.post("/api/actions/flush-dns")
async def flush_dns():
    """Flush the Windows DNS Resolver Cache."""
    return await actions_manager.flush_dns_async()

@app.post("/api/actions/clean-temp")
async def clean_temp():
    """Safely clean Windows system temporary files."""
    return await actions_manager.clean_temp_async()

@app.post("/api/focus/engage")
async def engage_focus():
    """Optimize memory buffer and prime host machine for Hyper Focus / Deep Work."""
    return await actions_manager.engage_focus_async()

@app.get("/api/disk/available-drives")
async def get_available_drives():
    """List all detected local disk drives with basic capacity info."""
    return disk_analyzer.get_available_drives()

@app.get("/api/disk/usage-breakdown")
async def get_disk_usage_breakdown(drive: str = "C", force: bool = False):
    """Scan and return folder size breakdown for the specified drive."""
    return await disk_analyzer.scan_drive_async(drive, force=force)

@app.get("/api/disk/sub-items")
async def get_disk_sub_items(path: str, force: bool = False):
    """Scan and return child files/folders for a given directory path."""
    return await disk_analyzer.scan_subfolder_async(path, force=force)

# ===========================================================================
# DISK DELTA & BLOAT TRACKER — Snapshot, Diff & Safe Purge API
# ===========================================================================

class DiskSnapshotCreateRequest(BaseModel):
    label: Optional[str] = None

class DiskPurgeItemRequest(BaseModel):
    path: str

class DiskOpenItemRequest(BaseModel):
    path: str

@app.post("/api/disk/snapshot/create")
async def create_disk_snapshot(req: DiskSnapshotCreateRequest):
    """Create a new baseline snapshot of disk hotspot directories for delta tracking."""
    return await disk_delta_service.create_snapshot(label=req.label)

@app.get("/api/disk/snapshot/latest")
async def get_latest_disk_snapshot():
    """Retrieve the most recent baseline snapshot metadata."""
    result = await disk_delta_service.get_latest_snapshot()
    if result is None:
        return {"has_snapshot": False, "message": "Chưa có mốc snapshot nào được tạo."}
    return {"has_snapshot": True, **result}

@app.get("/api/disk/snapshot/list")
async def list_disk_snapshots(limit: int = 15):
    """List historical baseline snapshots (newest first)."""
    return await disk_delta_service.list_snapshots(limit=limit)

@app.get("/api/disk/diff")
async def get_disk_diff(snapshot_id: Optional[int] = None):
    """Compare current disk hotspot state against baseline snapshot, return top bloat offenders."""
    return await disk_delta_service.compute_diff(snapshot_id=snapshot_id)

@app.post("/api/disk/purge-item")
async def purge_disk_item(req: DiskPurgeItemRequest):
    """Safely delete a detected bloat file or folder with built-in Windows Core protection."""
    return await disk_delta_service.purge_item(req.path)

@app.post("/api/disk/open-item")
async def open_disk_item(req: DiskOpenItemRequest):
    """Open Windows Explorer and highlight the specified file or folder."""
    return disk_delta_service.open_item_location(req.path)

@app.get("/api/apps/analytics")
async def get_app_analytics(range: str = "today"):
    """Fetch application screen time and network bandwidth usage analytics."""
    return app_tracker.get_app_analytics(time_range=range)

@app.get("/api/apps/summary")
async def get_app_summary():
    """Fetch high-level KPI card statistics for today, week, and month."""
    return app_tracker.get_summary_kpis()

@app.get("/api/downloads")
async def get_downloads(filter: str = "today", path: Optional[str] = None, force: bool = False):
    """Scan and return downloaded files with categories, sizes, and time filters."""
    return await downloads_analyzer.scan_downloads_async(target_dir=path, time_filter=filter, force=force)

@app.post("/api/downloads/open-folder")
async def open_downloads_item(req: OpenFolderRequest):
    """Open Windows Explorer and highlight the requested file or folder."""
    return downloads_analyzer.open_in_explorer(req.file_path)

@app.post("/api/downloads/open-downloads-dir")
async def open_downloads_dir(path: Optional[str] = None):
    """Open the user Downloads directory in Windows Explorer."""
    target = path or downloads_analyzer.get_default_downloads_dir()
    return downloads_analyzer.open_in_explorer(target)

@app.get("/api/notifications")
async def get_notifications(force: bool = False):
    """Fetch recent system and application alert notifications from Windows Event Logs."""
    return await notification_collector.get_notifications_async(limit=25, force=force)

@app.get("/api/notifications/action-center")
async def get_action_center_notifications(force: bool = False):
    """Fetch recent Windows Action Center toast notifications."""
    return await action_center_reader.get_action_center_notifications_async(limit=30, force=force)

@app.post("/api/notifications/mark-read")
async def mark_notifications_read(id: str = None):
    """Mark a specific notification or all notifications as read."""
    notification_collector.mark_as_read(id)
    return {"status": "success", "marked_id": id}

@app.post("/api/notifications/refresh")
async def refresh_notifications():
    """Force re-query of Windows event logs and Action Center."""
    event_logs = await notification_collector.get_notifications_async(limit=25, force=True)
    action_center = await action_center_reader.get_action_center_notifications_async(limit=30, force=True)
    return {
        "status": "success",
        "event_logs_count": event_logs.get("total_count", 0),
        "action_center_count": action_center.get("total_count", 0),
    }

# =========================================================================
# Network & LAN Radar API Endpoints
# =========================================================================
class PingTargetRequest(BaseModel):
    ip: str = "192.168.1.1"

@app.get("/api/radar/lan-devices")
async def get_radar_lan_devices(force: bool = False):
    """Scan and return all discovered Wi-Fi / LAN devices with coordinates for Radar."""
    return await network_radar.scan_lan_devices_async(force=force)

@app.get("/api/radar/connections")
async def get_radar_connections():
    """Scan active socket connections and listening ports grouped by process."""
    return await network_radar.scan_active_connections_async()

@app.get("/api/radar/wifi-info")
async def get_radar_wifi_info():
    """Fetch active Wi-Fi connection info and signal strength."""
    return await network_radar.get_wifi_telemetry_async()

@app.post("/api/radar/ping")
async def ping_radar_device(req: PingTargetRequest):
    """Ping a specific device from the radar display."""
    return await network_radar.ping_device_async(req.ip)

# =========================================================================
# Power & Carbon Cost Estimator API
# =========================================================================
class PowerConfigRequest(BaseModel):
    kwh_price_vnd: Optional[float] = None
    cpu_tdp_watts: Optional[float] = None
    base_idle_watts: Optional[float] = None
    gpu_tdp_watts: Optional[float] = None
    daily_hours: Optional[float] = None

@app.get("/api/power/stats")
async def get_power_stats():
    """Return instant wattage, daily/monthly costs, carbon emissions, and 60s history."""
    return power_estimator.calculate_power()

@app.post("/api/power/config")
async def update_power_config(req: PowerConfigRequest):
    """Update power estimation parameters and electricity price."""
    updates = req.dict(exclude_unset=True)
    saved = power_estimator.save_config(updates)
    return {"status": "success", "config": saved}

# =========================================================================
# Dynamic Wallpaper Studio API Endpoints
# =========================================================================
class SetWallpaperRequest(BaseModel):
    image_url: str
    title: Optional[str] = None

@app.get("/api/wallpapers")
async def get_wallpapers(
    q: Optional[str] = None,
    category: str = "all",
    sorting: str = "toplist",
    resolution: str = "all",
    page: int = 1
):
    """Fetch 4K/2K desktop wallpapers from Wallhaven API with curated offline fallback."""
    return await wallpaper_service.search_wallpapers_async(
        query=q,
        category=category,
        sorting=sorting,
        resolution=resolution,
        page=page
    )

@app.post("/api/wallpapers/set-desktop")
async def set_desktop_wallpaper(req: SetWallpaperRequest):
    """Download and set the specified image as current Windows desktop wallpaper."""
    return await wallpaper_service.set_desktop_wallpaper_async(
        image_url=req.image_url,
        title=req.title
    )

@app.get("/api/wallpapers/info")
async def get_wallpaper_info():
    """Fetch categories and last applied wallpaper metadata."""
    return wallpaper_service.get_info()

# =========================================================================
# Weather & Dynamic Atmospheric Mood API
# =========================================================================
@app.get("/api/weather")
async def get_weather(force: bool = False):
    """Fetch real-time weather and hourly forecast from Open-Meteo with caching."""
    return await weather_service.fetch_weather_async(force=force)

# =========================================================================
# AI Prompt & Code Snippet Laboratory API
# =========================================================================
class CreateSnippetRequest(BaseModel):
    title: str
    category: str = "ai_prompt"
    content: str
    tags: Optional[List[str]] = None
    description: str = ""

class UpdateSnippetRequest(BaseModel):
    title: Optional[str] = None
    category: Optional[str] = None
    content: Optional[str] = None
    tags: Optional[List[str]] = None
    description: Optional[str] = None

class TestPromptRequest(BaseModel):
    prompt: str
    system_instruction: Optional[str] = None
    model: Optional[str] = None

@app.get("/api/lab/snippets")
async def get_lab_snippets(category: Optional[str] = None, tag: Optional[str] = None, search: Optional[str] = None):
    """List code snippets and AI prompts with optional filtering."""
    return {
        "status": "success",
        "snippets": snippet_lab_service.list_snippets(category=category, tag=tag, search=search)
    }

@app.get("/api/lab/snippets/{snippet_id}")
async def get_lab_snippet(snippet_id: str):
    """Fetch a single snippet by ID."""
    snippet = snippet_lab_service.get_snippet(snippet_id)
    if not snippet:
        return {"status": "error", "message": "Snippet not found"}
    return {"status": "success", "snippet": snippet}

@app.post("/api/lab/snippets")
async def create_lab_snippet(req: CreateSnippetRequest):
    """Create a new snippet or AI prompt."""
    created = snippet_lab_service.create_snippet(
        title=req.title,
        category=req.category,
        content=req.content,
        tags=req.tags,
        description=req.description
    )
    return {"status": "success", "snippet": created}

@app.put("/api/lab/snippets/{snippet_id}")
async def update_lab_snippet(snippet_id: str, req: UpdateSnippetRequest):
    """Update an existing snippet."""
    updated = snippet_lab_service.update_snippet(
        snippet_id=snippet_id,
        title=req.title,
        category=req.category,
        content=req.content,
        tags=req.tags,
        description=req.description
    )
    if not updated:
        return {"status": "error", "message": "Snippet not found"}
    return {"status": "success", "snippet": updated}

@app.delete("/api/lab/snippets/{snippet_id}")
async def delete_lab_snippet(snippet_id: str):
    """Delete a snippet by ID."""
    deleted = snippet_lab_service.delete_snippet(snippet_id)
    return {"status": "success", "deleted": deleted}

@app.post("/api/lab/test-prompt")
async def test_lab_prompt(req: TestPromptRequest):
    """Test execute an AI prompt with Gemini or local fallback engine."""
    return await snippet_lab_service.test_prompt_async(
        prompt=req.prompt,
        system_instruction=req.system_instruction,
        model=req.model
    )

@app.post("/api/lab/snippets/reset-defaults")
async def reset_lab_defaults():
    """Reset and re-seed default sample templates."""
    count = snippet_lab_service.reset_default_templates()
    return {"status": "success", "reseeded_count": count}

# =========================================================================
# Resource Threshold Alerts & Webhooks API
# =========================================================================
class AlertConfigRequest(BaseModel):
    enabled: Optional[bool] = None
    cpu_enabled: Optional[bool] = None
    cpu_threshold: Optional[float] = None
    cpu_sustained_sec: Optional[int] = None
    ram_enabled: Optional[bool] = None
    ram_threshold: Optional[float] = None
    disk_enabled: Optional[bool] = None
    disk_c_free_min_gb: Optional[float] = None
    cooldown_minutes: Optional[int] = None
    discord_enabled: Optional[bool] = None
    discord_webhook_url: Optional[str] = None
    telegram_enabled: Optional[bool] = None
    telegram_bot_token: Optional[str] = None
    telegram_chat_id: Optional[str] = None

class TestAlertRequest(BaseModel):
    discord_webhook_url: Optional[str] = None
    telegram_bot_token: Optional[str] = None
    telegram_chat_id: Optional[str] = None

@app.get("/api/alerts/config")
async def get_alert_config():
    """Get threshold alert configuration, active statuses, and recent history."""
    return {
        "status": "success",
        "config": alert_engine.get_config(),
        "history": list(alert_engine.alert_history)[:20]
    }

@app.post("/api/alerts/config")
async def update_alert_config(req: AlertConfigRequest):
    """Save threshold alert configuration and webhook credentials."""
    data = {k: v for k, v in req.model_dump().items() if v is not None}
    updated = alert_engine.update_config(data)
    return {
        "status": "success",
        "message": "Cấu hình cảnh báo & Webhook đã được lưu thành công!",
        "config": updated
    }

@app.post("/api/alerts/test")
async def test_alert(req: Optional[TestAlertRequest] = None):
    """Dispatch a test notification to Discord and/or Telegram."""
    custom_cfg = {}
    if req:
        if req.discord_webhook_url:
            custom_cfg["discord_webhook_url"] = req.discord_webhook_url
            custom_cfg["discord_enabled"] = True
        if req.telegram_bot_token and req.telegram_chat_id:
            custom_cfg["telegram_bot_token"] = req.telegram_bot_token
            custom_cfg["telegram_chat_id"] = req.telegram_chat_id
            custom_cfg["telegram_enabled"] = True

    result = await alert_engine.send_test_alert(custom_cfg if custom_cfg else None)
    return {
        "status": "success",
        "result": result
    }

@app.get("/api/alerts/history")
async def get_alert_history():
    """Get recent alerts history log."""
    return {
        "status": "success",
        "history": list(alert_engine.alert_history)
    }

@app.post("/api/alerts/clear-history")
async def clear_alert_history():
    """Clear all stored alert history entries."""
    alert_engine.clear_history()
    return {
        "status": "success",
        "message": "Đã xóa toàn bộ lịch sử thông báo cảnh báo."
    }

# =============================================================================
# In-Browser Media & Document Previewer Endpoints (Image, Video, PDF, Text)
# =============================================================================
@app.get("/api/media/info")
async def get_media_info(path: str):
    """Return media info, mime type, size, and category for a local file."""
    return media_preview_service.get_media_info(path)

@app.get("/api/media/preview")
async def get_media_preview(request: Request, path: str):
    """Stream media file directly with Range request support for videos/audio and inline PDFs/images."""
    range_header = request.headers.get("range") or request.headers.get("Range")
    return media_preview_service.get_media_response(path, range_header=range_header)

# =============================================================================
# Daily English & Vocab Booster Endpoints (Flashcards, Quiz, Custom Notebook)
# =============================================================================
@app.get("/api/vocab/today")
async def get_today_vocab(limit: int = 5):
    """Fetch daily 3-5 words for today's learning."""
    items = vocab_service.get_today_words(limit=limit)
    return {"success": True, "items": items}

@app.get("/api/vocab/all")
async def get_all_vocab(
    category: Optional[str] = None,
    search: Optional[str] = None,
    learned: Optional[bool] = None,
    limit: int = 200,
    offset: int = 0
):
    """Fetch full vocabulary list with category, search, and learned filter."""
    result = vocab_service.get_all(
        category=category,
        search=search,
        learned=learned,
        limit=limit,
        offset=offset
    )
    return {"success": True, **result}

@app.get("/api/vocab/stats")
async def get_vocab_stats():
    """Fetch summary statistics for Vocab Booster header bar."""
    stats = vocab_service.get_stats()
    return {"success": True, "stats": stats}

@app.get("/api/vocab/quiz")
async def get_vocab_quiz(count: int = 4):
    """Generate 4 multiple-choice mini quiz questions."""
    questions = vocab_service.generate_quiz(count=count)
    return {"success": True, "questions": questions}

@app.get("/api/vocab/{vocab_id}")
async def get_vocab_by_id(vocab_id: str):
    """Get single vocabulary item by ID."""
    item = vocab_service.get_by_id(vocab_id)
    if not item:
        return {"success": False, "message": "Vocabulary item not found"}
    return {"success": True, "item": item}

@app.post("/api/vocab")
async def add_vocab_word(req: VocabCreateRequest):
    """Add a new custom vocabulary item."""
    item = vocab_service.add_word(req.dict())
    if not item:
        return {"success": False, "message": "Failed to add vocabulary item"}
    return {"success": True, "item": item}

@app.patch("/api/vocab/{vocab_id}/toggle-learned")
async def toggle_vocab_learned(vocab_id: str):
    """Toggle learned status for a word and record study streak."""
    item = vocab_service.toggle_learned(vocab_id)
    if not item:
        return {"success": False, "message": "Vocabulary item not found"}
    return {"success": True, "learned": item.get("learned", False), "item": item}

@app.post("/api/vocab/{vocab_id}/review")
async def review_vocab_word(vocab_id: str):
    """Increment review count without toggling learned status."""
    item = vocab_service.record_reviewed(vocab_id)
    if not item:
        return {"success": False, "message": "Vocabulary item not found"}
    return {"success": True, "item": item}

@app.put("/api/vocab/{vocab_id}")
async def update_vocab_word(vocab_id: str, req: VocabUpdateRequest):
    """Update existing vocabulary item."""
    item = vocab_service.update_word(vocab_id, req.dict(exclude_unset=True))
    if not item:
        return {"success": False, "message": "Vocabulary item not found"}
    return {"success": True, "item": item}

@app.delete("/api/vocab/{vocab_id}")
async def delete_vocab_word(vocab_id: str):
    """Delete a vocabulary item from notebook."""
    success = vocab_service.delete_word(vocab_id)
    return {"success": success, "message": "Deleted successfully" if success else "Not found"}

@app.post("/api/vocab/reset-seed")
async def reset_vocab_seed():
    """Reset to default seed vocabulary."""
    count = vocab_service.reset_default_seed()
    return {"status": "success", "count": count, "message": f"Đã khôi phục thành công {count} từ vựng chuẩn ban đầu."}



@app.websocket("/ws/metrics")
async def websocket_metrics_endpoint(websocket: WebSocket):
    """WebSocket endpoint streaming live metrics & Action Center sync every 1 second."""
    await manager.connect(websocket)
    try:
        while True:
            metrics_data = collector.get_all_metrics()

            # Realtime Action Center Toast synchronization (ultra-fast mtime check)
            try:
                action_data = await action_center_reader.get_action_center_notifications_async(force=False)
                metrics_data["action_center_notifications"] = action_data.get("notifications", [])
                metrics_data["action_center_count"] = action_data.get("total_count", 0)
            except Exception:
                metrics_data["action_center_notifications"] = []
                metrics_data["action_center_count"] = 0

            # Realtime Network Ping and Local IP status
            try:
                net_status = await network_helper.get_network_status_async(force=False)
                metrics_data["network_status"] = net_status
            except Exception:
                metrics_data["network_status"] = {"online": True, "local_ip": "127.0.0.1", "ping_ms": None}

            # Realtime AI Smart Insights
            try:
                insights_data = ai_copilot.generate_smart_insights(metrics_data)
                metrics_data["smart_insights"] = insights_data
            except Exception:
                pass

            # Gemini Status
            metrics_data["gemini_status"] = {
                "configured": gemini_service.is_configured(),
                "model": gemini_service.model_name
            }

            await websocket.send_json(metrics_data)
            await asyncio.sleep(1.0)
    except WebSocketDisconnect:
        manager.disconnect(websocket)
    except Exception:
        manager.disconnect(websocket)


# Mount static files
if STATIC_DIR.exists():
    app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")

@app.get("/")
async def serve_dashboard():
    """Serve the single page dashboard."""
    index_file = STATIC_DIR / "index.html"
    if index_file.exists():
        return FileResponse(str(index_file))
    return {"message": "System Monitor API is running. index.html not found."}
