"""
Gemini Pro AI Service for Local System Performance Monitor.
Provides deep AI hardware analysis, root-cause diagnostics, and intelligent Q&A
powered by Google Gemini Pro models using the official google-genai SDK.
"""

import os
import time
import json
import logging
from pathlib import Path
from typing import Dict, Any, Optional

try:
    from dotenv import load_dotenv, set_key
    BASE_DIR = Path(__file__).resolve().parent.parent
    ENV_PATH = BASE_DIR / ".env"
    if ENV_PATH.exists():
        load_dotenv(ENV_PATH)
except Exception:
    ENV_PATH = None

try:
    from google import genai
    from google.genai import types
    GENAI_AVAILABLE = True
except ImportError:
    GENAI_AVAILABLE = False

logger = logging.getLogger("gemini_service")

class GeminiAIService:
    def __init__(self):
        self.api_key: Optional[str] = os.environ.get("GEMINI_API_KEY", "").strip() or None
        self.model_name: str = os.environ.get("GEMINI_MODEL", "gemini-2.5-pro").strip()
        self._client: Optional[Any] = None
        self._last_gemini_insights: Optional[Dict[str, Any]] = None
        self._last_env_mtime: float = 0
        self._check_env_file()

        if self.api_key and GENAI_AVAILABLE:
            try:
                self._client = genai.Client(api_key=self.api_key)
            except Exception as e:
                logger.warning(f"Failed to initialize Gemini Client with env key: {e}")

    def _check_env_file(self):
        """Auto-detect changes made directly to .env file."""
        if ENV_PATH and ENV_PATH.exists():
            try:
                mtime = ENV_PATH.stat().st_mtime
                if mtime != self._last_env_mtime:
                    self._last_env_mtime = mtime
                    load_dotenv(ENV_PATH, override=True)
                    env_key = os.environ.get("GEMINI_API_KEY", "").strip() or None
                    env_model = os.environ.get("GEMINI_MODEL", "gemini-2.5-pro").strip()

                    if env_key != self.api_key or env_model != self.model_name:
                        self.api_key = env_key
                        self.model_name = env_model
                        if self.api_key and GENAI_AVAILABLE:
                            try:
                                self._client = genai.Client(api_key=self.api_key)
                            except Exception:
                                self._client = None
                        else:
                            self._client = None
            except Exception:
                pass

    def is_configured(self) -> bool:
        """Check if Gemini API key is set and SDK is available."""
        self._check_env_file()
        return bool(self.api_key and self._client and GENAI_AVAILABLE)

    def get_config(self) -> Dict[str, Any]:
        """Return current Gemini configuration status (with masked key)."""
        self._check_env_file()
        masked = ""
        if self.api_key:
            if len(self.api_key) > 8:
                masked = self.api_key[:4] + "..." + self.api_key[-4:]
            else:
                masked = "***"

        return {
            "configured": self.is_configured(),
            "model": self.model_name,
            "masked_key": masked,
            "sdk_available": GENAI_AVAILABLE,
            "available_models": [
                {"id": "gemini-3.5-flash-lite", "name": "Gemini 3.5 Flash Lite (Recommended - High Quota & Fast)", "tier": "flash"},
                {"id": "gemini-3.7-flash", "name": "Gemini 3.7 Flash (Balanced Performance)", "tier": "flash"},
                {"id": "gemini-3.1-pro-preview", "name": "Gemini 3.1 Pro Preview (Deep Reasoning)", "tier": "pro"},
            ]
        }

    def update_config(self, api_key: str, model_name: str = "gemini-3.5-flash-lite") -> Dict[str, Any]:
        """Update API key and model at runtime, saving to .env if possible."""
        clean_key = api_key.strip()
        if not clean_key:
            self.api_key = None
            self._client = None
            if ENV_PATH:
                try:
                    set_key(str(ENV_PATH), "GEMINI_API_KEY", "")
                except Exception:
                    pass
            return {"status": "success", "message": "Gemini API key removed."}

        target_model = model_name or "gemini-3.5-flash-lite"

        try:
            client = genai.Client(api_key=clean_key)
            # Verify by making a lightweight test call
            res = client.models.generate_content(
                model="gemini-3.5-flash-lite",
                contents="ping",
            )
            
            self.api_key = clean_key
            self.model_name = target_model
            self._client = client
            self._last_gemini_insights = None

            # Persist to .env
            if ENV_PATH:
                try:
                    if not ENV_PATH.exists():
                        ENV_PATH.touch()
                    set_key(str(ENV_PATH), "GEMINI_API_KEY", clean_key)
                    set_key(str(ENV_PATH), "GEMINI_MODEL", self.model_name)
                except Exception as e:
                    logger.warning(f"Could not persist to .env: {e}")

            return {
                "status": "success",
                "message": f"Connected successfully to Google Gemini ({self.model_name})!",
                "model": self.model_name,
            }
        except Exception as e:
            return {
                "status": "error",
                "message": f"Gemini API verification failed: {str(e)}",
            }

    async def answer_query_async(self, question: str, metrics: Dict[str, Any]) -> Dict[str, Any]:
        """Answer user questions with Gemini using real-time PC telemetry context, with auto-fallback."""
        if not self.is_configured():
            from app.ai_copilot import ai_copilot
            return ai_copilot.answer_query(question, metrics)

        # Build telemetry summary context for Gemini
        cpu = metrics.get("cpu", {})
        memory = metrics.get("memory", {}).get("ram", {})
        disk = metrics.get("disk", {})
        network = metrics.get("network", {})
        os_info = metrics.get("os", {})
        uptime = metrics.get("uptime", {}).get("formatted", "N/A")
        
        procs_data = metrics.get("processes", {})
        if isinstance(procs_data, dict):
            procs = (procs_data.get("by_cpu", []) + procs_data.get("by_ram", []))[:10]
        elif isinstance(procs_data, list):
            procs = procs_data[:10]
        else:
            procs = []

        seen_pids = set()
        unique_procs = []
        for p in procs:
            if isinstance(p, dict) and p.get("pid") not in seen_pids:
                seen_pids.add(p.get("pid"))
                unique_procs.append(p)

        procs_text = "\n".join([
            f"- PID {p.get('pid')}: {p.get('name')} | CPU: {p.get('cpu_percent')}% | RAM: {p.get('memory_mb')} MB ({p.get('memory_percent')}%)"
            for p in unique_procs
        ])

        system_prompt = f"""You are 'Gemini Pro System Copilot', an expert PC hardware performance diagnostic assistant running locally.
Analyze the user's PC performance based on this EXACT real-time telemetry snapshot:

[SYSTEM TELEMETRY SNAPSHOT]
- OS: {os_info.get('system')} {os_info.get('release')} (Node: {os_info.get('node')})
- Uptime: {uptime}
- CPU Total: {cpu.get('overall_percent')}% ({cpu.get('cores_logical')} cores @ {cpu.get('frequency_current_ghz', 0):.2f} GHz)
- RAM: {memory.get('used_gb', 0):.1f} GB used / {memory.get('total_gb', 0):.1f} GB total ({memory.get('percent')}%), Free: {memory.get('free_gb', 0):.1f} GB
- Network Speeds: Download {network.get('download_speed_formatted', '0 KB/s')}, Upload {network.get('upload_speed_formatted', '0 KB/s')}
- Disks: {', '.join([f"{d.get('mountpoint')} ({d.get('percent')}% full)" for d in disk.get('partitions', [])])}
- Top Active Processes:
{procs_text}

[INSTRUCTIONS]
1. Answer the user's question concisely, accurately, and politely in the language they asked (Vietnamese or English).
2. Reference exact numbers, process names, PIDs, or usage metrics from the snapshot whenever relevant.
3. Use clean Markdown formatting (**bold**, bullet points, code tags) for readability.
4. Keep the answer clear, informative, and under 3-4 short paragraphs."""

        # Candidate models with auto-fallback
        models_to_try = [self.model_name, "gemini-3.5-flash-lite", "gemini-3.7-flash", "gemini-3.1-pro-preview"]
        seen_models = set()
        unique_models = []
        for m in models_to_try:
            if m and m not in seen_models:
                seen_models.add(m)
                unique_models.append(m)

        import asyncio

        for model in unique_models:
            try:
                response = await asyncio.to_thread(
                    self._client.models.generate_content,
                    model=model,
                    contents=f"{system_prompt}\n\n[USER QUESTION]: {question}"
                )
                if response and response.text:
                    return {
                        "configured": True,
                        "model": model,
                        "answer": response.text.strip(),
                    }
            except Exception as e:
                logger.warning(f"Failed to generate with model {model}: {e}")
                continue

        # If all Gemini cloud models fail (e.g. rate-limit or network offline), fallback gracefully to local engine
        from app.ai_copilot import ai_copilot
        local_ans = ai_copilot.answer_query(question, metrics)
        local_ans["answer"] = f"*(Gemini quota/offline fallback)*\n\n" + local_ans.get("answer", "")
        return local_ans


# Singleton instance
gemini_service = GeminiAIService()
