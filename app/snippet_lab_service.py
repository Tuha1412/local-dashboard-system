"""
AI Prompt & Code Snippet Laboratory Service.
Provides persistent storage, category filtering, token estimation, and instant AI execution testing
for AI prompts and multi-language code snippets using SQLite.
"""

import asyncio
import json
import logging
import os
from pathlib import Path
import sqlite3
import time
import uuid
from typing import Any, Dict, List, Optional

logger = logging.getLogger("snippet_lab_service")

BASE_DIR = Path(__file__).resolve().parent.parent
DB_PATH = BASE_DIR / "snippets.db"

DEFAULT_TEMPLATES = [
    # 1. AI Prompt: Fix Bug & Refactor Code
    {
        "id": "tpl-prompt-refactor-bugfix",
        "title": "Fix Bug & Clean Code Refactor",
        "category": "ai_prompt",
        "tags": ["refactor", "bugfix", "clean-code", "gemini"],
        "description": "Yêu cầu AI rà soát mã nguồn, tìm kiếm lỗi tiềm ẩn / edge-cases và tái cấu trúc code sạch theo chuẩn SOLID/Clean Architecture.",
        "content": """[VAI TRÒ & MỤC TIÊU]
Bạn là một Senior Software Architect và Clean Code Expert. Hãy phân tích đoạn mã nguồn sau đây, phát hiện các lỗ hổng / bug tiềm ẩn và thực hiện tái cấu trúc (refactoring).

[YÊU CẦU ĐẦU RA]
1. Chỉ ra ít nhất 2-3 điểm yếu, bottleneck hoặc edge-cases của code hiện tại.
2. Cung cấp phiên bản mã nguồn đã tái cấu trúc hoàn chỉnh, dễ đọc, tuân thủ Clean Code & SOLID principles.
3. Kèm theo Type Hints (nếu là Python/TS) và chú thích ngắn gọn giải thích lý do thay đổi.

[ĐOẠN MÃ NGUỒN CẦN XỬ LÝ]:
```python
def process_data(items):
    res = []
    for i in range(len(items)):
        if items[i]['status'] == 'active':
            res.append(items[i]['val'] * 2)
    return res
```"""
    },

    # 2. AI Prompt: Generate Regex Pattern
    {
        "id": "tpl-prompt-regex-generator",
        "title": "Chuyên Gia Regex Pattern Generator",
        "category": "ai_prompt",
        "tags": ["regex", "pattern", "validation", "string"],
        "description": "Tạo Regular Expression tối ưu kèm giải thích chi tiết từng block token và bộ dữ liệu test mẫu (Pass/Fail).",
        "content": """[NHIỆM VỤ]
Hãy tạo biểu thức chính quy (Regular Expression - Regex) để giải quyết bài toán sau:

[YÊU CẦU DỮ LIỆU]:
- Định dạng cần match: [Ví dụ: Địa chỉ Email doanh nghiệp hợp lệ, số điện thoại VN, IPv4/IPv6, hoặc Password mạnh có ít nhất 8 ký tự, 1 số, 1 chữ hoa và 1 ký tự đặc biệt]
- Ngôn ngữ áp dụng: [Python / JavaScript / C#]

[CẤU TRÚC PHẢN HỒI]:
1. Biểu thức Regex: (Đặt trong khối code block)
2. Giải thích chi tiết các token trong biểu thức (`^`, `(?=...)`, `[A-Za-z]`,...):
3. Danh sách 5 test cases PASS và 5 test cases FAIL để kiểm thử:"""
    },

    # 3. AI Prompt: DevOps & System Automation Scripting
    {
        "id": "tpl-prompt-devops-automation",
        "title": "DevOps & SysAdmin Automation Script",
        "category": "ai_prompt",
        "tags": ["devops", "sysadmin", "automation", "bash", "powershell"],
        "description": "Yêu cầu AI viết script tự động hóa quản trị hệ điều hành (Windows/Linux) có xử lý lỗi try/catch và logging chuyên nghiệp.",
        "content": """[BỐI CẢNH]
Bạn là một DevOps Engineer dày dặn kinh nghiệm. Hãy viết một kịch bản tự động hóa (PowerShell cho Windows hoặc Bash cho Linux) để thực hiện tác vụ sau:

[TÁC VỤ CẦN TỰ ĐỘNG HÓA]:
- Tự động kiểm tra dung lượng ổ đĩa, dọn dẹp các tệp log cũ hơn 7 ngày, nén thư mục sao lưu và gửi thông báo nếu dung lượng trống dưới 15%.

[TIÊU CHUẨN KỸ THUẬT]:
1. Tính lũy đẳng (Idempotency) - có thể chạy nhiều lần an toàn mà không lỗi.
2. Xử lý lỗi toàn diện (Try-Catch / set -euo pipefail).
3. Có format xuất log thời gian thực với timestamp ISO 8601."""
    },

    # 4. AI Prompt: Image Generation Prompt Enhancer
    {
        "id": "tpl-prompt-image-enhancer",
        "title": "AI Image Generation Prompt Enhancer",
        "category": "ai_prompt",
        "tags": ["image-gen", "midjourney", "gemini", "cinematic", "photorealistic"],
        "description": "Nâng cấp ý tưởng mô tả thô sơ thành Prompt hình ảnh chi tiết chuẩn Cinematic 8K, ánh sáng Volumetric và thông số camera chuyên nghiệp.",
        "content": """[TASK]
You are a world-class prompt engineer for AI image generators (Midjourney v6, Imagen 3, Stable Diffusion XL). 
Transform the raw idea below into 3 distinct, breathtaking image prompts:

[RAW IDEA]:
"A futuristic cyberpunk server room at midnight with glowing neon green liquid cooling pipes and a holographic AI robot inspecting the core"

[OUTPUT FORMAT FOR EACH VERSION]:
1. Style: [Photorealistic 8K Cinematic / Cyberpunk Concept Art / Unreal Engine 5 Render]
2. Detailed Prompt: Subject details, environment, lighting (volumetric god rays, neon accents), lens/camera (85mm f/1.4, cinematic film grain, depth of field), color palette.
3. Negative Prompts / Aspect Ratio: (e.g. `--ar 16:9 --v 6.0 --style raw`)"""
    },

    # 5. Script: PowerShell Clear Temp & Cache
    {
        "id": "tpl-script-ps-clean-temp",
        "title": "PowerShell Deep Clean Temp & Prefetch",
        "category": "powershell",
        "tags": ["powershell", "cleanup", "windows", "maintenance"],
        "description": "Script PowerShell dọn dẹp an toàn các thư mục Temp, Windows Prefetch, và Crash Dumps của hệ thống.",
        "content": """<#
.SYNOPSIS
    Deep Clean Windows System Temp, User Temp & Prefetch Cache.
.DESCRIPTION
    Safely purges locked and expired temporary files to reclaim disk storage.
#>

$ErrorActionPreference = 'SilentlyContinue'
$TotalFreedBytes = 0

$TargetPaths = @(
    "$env:TEMP\\*",
    "$env:SystemRoot\\Temp\\*",
    "$env:LOCALAPPDATA\\Temp\\*",
    "$env:SystemRoot\\Prefetch\\*.pf"
)

Write-Host "🧹 [1/3] Bắt đầu dọn dẹp file tạm Windows..." -ForegroundColor Cyan

foreach ($Path in $TargetPaths) {
    $Items = Get-ChildItem -Path $Path -Recurse -Force -ErrorAction SilentlyContinue
    foreach ($Item in $Items) {
        try {
            $Size = $Item.Length
            Remove-Item -Path $Item.FullName -Recurse -Force -ErrorAction Stop
            $TotalFreedBytes += $Size
        } catch {
            # Locked file by running process, skip safely
        }
    }
}

$FreedMB = [math]::Round($TotalFreedBytes / 1MB, 2)
Write-Host "✨ [2/3] Hoàn tất dọn dẹp! Đã giải phóng: $FreedMB MB" -ForegroundColor Green

# Optional: Flush DNS Cache
Clear-DnsClientCache
Write-Host "⚡ [3/3] Đã làm mới bộ nhớ đệm DNS." -ForegroundColor Yellow"""
    },

    # 6. Script: Docker Prune Clean Script
    {
        "id": "tpl-script-docker-prune",
        "title": "Docker Complete Prune & Resource Reclaim",
        "category": "docker",
        "tags": ["docker", "devops", "containers", "cleanup"],
        "description": "Lệnh Docker dọn dẹp các dangling images, stopped containers, build cache và unused networks.",
        "content": """#!/usr/bin/env bash
# ==============================================================================
# Docker Complete Cleanup & Space Recovery Utility
# ==============================================================================

echo "🐳 [1/4] Xóa các Container đã dừng..."
docker container prune -f

echo "🧹 [2/4] Xóa các Images không còn tag / dangling..."
docker image prune -f

echo "💾 [3/4] Xóa Build Cache cũ..."
docker builder prune -a --force --keep-storage 2GB

echo "🌐 [4/4] Xóa các Network tùy chỉnh không sử dụng..."
docker network prune -f

echo "📊 Tổng quan dung lượng Docker hiện tại:"
docker system df"""
    },

    # 7. Script: Python Fast Async HTTP Benchmark
    {
        "id": "tpl-script-python-bench",
        "title": "Python Async HTTP Benchmark Tester",
        "category": "python",
        "tags": ["python", "httpx", "asyncio", "benchmark", "performance"],
        "description": "Script Python kiểm thử hiệu năng API đồng thời nhiều requests bằng HTTPX AsyncClient.",
        "content": """import asyncio
import time
import httpx

TARGET_URL = "http://127.0.0.1:8000/api/metrics"
TOTAL_REQUESTS = 50
CONCURRENCY = 10

async def send_request(client: httpx.AsyncClient, req_id: int):
    t0 = time.perf_counter()
    try:
        res = await client.get(TARGET_URL)
        latency_ms = (time.perf_counter() - t0) * 1000
        return {"id": req_id, "status": res.status_code, "latency_ms": latency_ms, "ok": res.status_code == 200}
    except Exception as e:
        return {"id": req_id, "status": 0, "latency_ms": 0, "ok": False, "error": str(e)}

async def main():
    print(f"🚀 Bắt đầu benchmark {TARGET_URL} ({TOTAL_REQUESTS} requests, concurrency={CONCURRENCY})...")
    start_time = time.perf_counter()
    
    limits = httpx.Limits(max_connections=CONCURRENCY, max_keepalive_connections=CONCURRENCY)
    async with httpx.AsyncClient(timeout=5.0, limits=limits) as client:
        tasks = [send_request(client, i + 1) for i in range(TOTAL_REQUESTS)]
        results = await asyncio.gather(*tasks)
        
    total_time = time.perf_counter() - start_time
    successful = [r for r in results if r["ok"]]
    latencies = [r["latency_ms"] for r in successful]
    
    avg_latency = sum(latencies) / len(latencies) if latencies else 0
    rps = len(successful) / total_time if total_time > 0 else 0
    
    print("\\n" + "=" * 50)
    print(f"✅ Thành công: {len(successful)}/{TOTAL_REQUESTS} requests ({len(successful)/TOTAL_REQUESTS*100:.1f}%)")
    print(f"⏱️ Tổng thời gian: {total_time:.2f}s | RPS: {rps:.1f} req/s")
    print(f"⚡ Latency TB: {avg_latency:.2f}ms | Min: {min(latencies):.2f}ms | Max: {max(latencies):.2f}ms")
    print("=" * 50)

if __name__ == "__main__":
    asyncio.run(main())"""
    },

    # 8. Script: SQL Top Fragmented Indexes
    {
        "id": "tpl-script-sql-table-sizes",
        "title": "SQL Table Sizes & Index Usage Analyzer",
        "category": "sql",
        "tags": ["sql", "database", "dba", "indexing", "performance"],
        "description": "Truy vấn thống kê kích thước các bảng và số lượng bản ghi chi tiết trong cơ sở dữ liệu.",
        "content": """-- ==============================================================================
-- Query: Analyze Table Sizes & Row Counts (SQLite / Generic SQL)
-- ==============================================================================

-- 1. Liệt kê các bảng và cấu trúc schema
SELECT 
    type,
    name AS object_name,
    tbl_name,
    sql
FROM sqlite_master
WHERE type IN ('table', 'index') AND name NOT LIKE 'sqlite_%'
ORDER BY type DESC, name ASC;

-- 2. Đếm số dòng nhanh trên các bảng chính
SELECT 'app_daily_usage' AS table_name, COUNT(*) AS total_rows FROM app_daily_usage
UNION ALL
SELECT 'snippets' AS table_name, COUNT(*) AS total_rows FROM snippets;"""
    },

    # 9. Script: Bash Linux System Health Check & Disk Alert
    {
        "id": "tpl-script-bash-system-health",
        "title": "Bash Linux Health Check & Auto Alert",
        "category": "bash",
        "tags": ["bash", "linux", "devops", "monitoring", "sysadmin"],
        "description": "Kịch bản Shell kiểm tra CPU, RAM, Disk và gửi cảnh báo nếu tài nguyên vượt ngưỡng an toàn.",
        "content": """#!/usr/bin/env bash
# ==============================================================================
# Linux Server Health Check & Resource Diagnostic Script
# ==============================================================================
set -euo pipefail

THRESHOLD_CPU=85
THRESHOLD_RAM=90
THRESHOLD_DISK=85

echo "=================================================="
echo "🖥️  SERVER HEALTH INSPECTION: $(hostname) [$(date '+%Y-%m-%d %H:%M:%S')]"
echo "=================================================="

# 1. CPU Usage Check
CPU_USAGE=$(top -bn1 | grep "Cpu(s)" | sed "s/.*, *\\([0-9.]*\\)%* id.*/\\1/" | awk '{print 100 - $1}')
echo "⚡ CPU Load: ${CPU_USAGE}%"

# 2. Memory Usage Check
RAM_TOTAL=$(free -m | awk '/Mem:/ {print $2}')
RAM_USED=$(free -m | awk '/Mem:/ {print $3}')
RAM_PCT=$(( RAM_USED * 100 / RAM_TOTAL ))
echo "🧠 RAM Memory: ${RAM_USED}MB / ${RAM_TOTAL}MB (${RAM_PCT}%)"

# 3. Disk Usage Check (Root Partition)
DISK_PCT=$(df / | awk 'NR==2 {gsub("%",""); print $5}')
echo "💾 Disk (/): ${DISK_PCT}% used"

# 4. Top 5 CPU Consuming Processes
echo -e "\\n🔥 Top 5 Resource-Heavy Processes:"
ps aux --sort=-%cpu | head -n 6 | awk '{printf "%-10s %-8s %-6s %-6s %s\\n", $1, $2, $3, $4, $11}'

echo "=================================================="
echo "✅ Health Diagnostic Completed."
"""
    },

    # 10. Script: C# High-Performance JSON & Pipeline
    {
        "id": "tpl-script-csharp-pipeline",
        "title": "C# .NET High-Performance Pipeline & SIMD",
        "category": "csharp",
        "tags": ["csharp", "dotnet", "performance", "async", "memory"],
        "description": "Mã nguồn C# .NET 8/9 tối ưu bộ nhớ không cấp phát thừa (Zero-Allocation) sử dụng MemoryPool và Utf8JsonReader.",
        "content": """using System;
using System.Buffers;
using System.IO;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;

namespace HighPerfPipeline
{
    public sealed class DataStreamProcessor
    {
        private static readonly ArrayPool<byte> Pool = ArrayPool<byte>.Shared;

        /// <summary>
        /// Asynchronously processes incoming stream with zero-allocation buffer pooling.
        /// </summary>
        public static async ValueTask ProcessStreamAsync(Stream inputStream, CancellationToken ct = default)
        {
            byte[] rentedBuffer = Pool.Rent(64 * 1024); // 64 KB buffer
            try
            {
                int bytesRead;
                long totalBytes = 0;
                
                while ((bytesRead = await inputStream.ReadAsync(rentedBuffer.AsMemory(0, rentedBuffer.Length), ct)) > 0)
                {
                    totalBytes += bytesRead;
                    // Fast in-memory processing via ReadOnlySpan
                    ReadOnlySpan<byte> dataChunk = rentedBuffer.AsSpan(0, bytesRead);
                    InspectChunk(dataChunk);
                }

                Console.WriteLine($"✅ Processed total: {totalBytes:N0} bytes safely via ArrayPool.");
            }
            finally
            {
                Pool.Return(rentedBuffer);
            }
        }

        private static void InspectChunk(ReadOnlySpan<byte> chunk)
        {
            // Vectorized / SIMD or Fast Span-based search
            int newlineCount = 0;
            for (int i = 0; i < chunk.Length; i++)
            {
                if (chunk[i] == (byte)'\\n') newlineCount++;
            }
        }
    }
}"""
    }
]

class SnippetLabService:
    def __init__(self, db_path: Path = DB_PATH):
        self.db_path = db_path
        self._init_db()
        self._seed_default_templates_if_empty()

    def _init_db(self):
        """Initialize SQLite snippets database with proper indices."""
        with sqlite3.connect(self.db_path) as conn:
            cursor = conn.cursor()
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS snippets (
                    id TEXT PRIMARY KEY,
                    title TEXT NOT NULL,
                    category TEXT NOT NULL,
                    tags TEXT NOT NULL,
                    content TEXT NOT NULL,
                    description TEXT,
                    created_at REAL NOT NULL,
                    updated_at REAL NOT NULL
                )
            """)
            cursor.execute("CREATE INDEX IF NOT EXISTS idx_snippets_category ON snippets(category)")
            cursor.execute("CREATE INDEX IF NOT EXISTS idx_snippets_updated ON snippets(updated_at DESC)")
            conn.commit()

    def _seed_default_templates_if_empty(self):
        """Seed initial templates if the snippets database is newly created."""
        with sqlite3.connect(self.db_path) as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT COUNT(*) FROM snippets")
            count = cursor.fetchone()[0]
            if count > 0:
                return

            now = time.time()
            for tpl in DEFAULT_TEMPLATES:
                cursor.execute("""
                    INSERT OR REPLACE INTO snippets (id, title, category, tags, content, description, created_at, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """, (
                    tpl["id"],
                    tpl["title"],
                    tpl["category"],
                    json.dumps(tpl.get("tags", []), ensure_ascii=False),
                    tpl["content"],
                    tpl.get("description", ""),
                    now,
                    now
                ))
            conn.commit()
            logger.info("Seeded initial Prompt & Snippet Laboratory templates.")

    def calculate_token_stats(self, text: str) -> Dict[str, Any]:
        """
        Calculate character count, word count, line count, and estimated Token consumption.
        Applies heuristic tokenization (~4 characters per token in English, with CJK multiplier).
        """
        if not text:
            return {
                "characters": 0,
                "words": 0,
                "lines": 0,
                "estimated_tokens": 0
            }

        chars = len(text)
        words = len(text.split())
        lines = len(text.splitlines()) if text else 0

        # Heuristic: CJK characters occupy ~1-2 tokens each, English ~4 chars per token
        cjk_chars = sum(1 for c in text if '\u4e00' <= c <= '\u9fff' or '\u3040' <= c <= '\u30ff' or '\uac00' <= c <= '\ud7af')
        latin_chars = chars - cjk_chars
        estimated_tokens = max(1, round((latin_chars / 4.0) + (cjk_chars * 1.5)))

        return {
            "characters": chars,
            "words": words,
            "lines": lines,
            "estimated_tokens": estimated_tokens
        }

    def list_snippets(
        self,
        category: Optional[str] = None,
        tag: Optional[str] = None,
        search: Optional[str] = None
    ) -> List[Dict[str, Any]]:
        """Fetch all snippets with optional category, tag, or search term filtering."""
        with sqlite3.connect(self.db_path) as conn:
            conn.row_factory = sqlite3.Row
            cursor = conn.cursor()

            query = "SELECT * FROM snippets WHERE 1=1"
            params = []

            if category and category.lower() != "all":
                query += " AND category = ?"
                params.append(category.lower())

            if search and search.strip():
                term = f"%{search.strip()}%"
                query += " AND (title LIKE ? OR content LIKE ? OR description LIKE ? OR tags LIKE ?)"
                params.extend([term, term, term, term])

            query += " ORDER BY updated_at DESC"
            cursor.execute(query, params)
            rows = cursor.fetchall()

            results = []
            for r in rows:
                tags_list = []
                try:
                    tags_list = json.loads(r["tags"]) if r["tags"] else []
                except Exception:
                    tags_list = []

                if tag and tag.lower() != "all":
                    if not any(t.lower() == tag.lower() for t in tags_list):
                        continue

                snippet_dict = {
                    "id": r["id"],
                    "title": r["title"],
                    "category": r["category"],
                    "tags": tags_list,
                    "content": r["content"],
                    "description": r["description"] or "",
                    "created_at": r["created_at"],
                    "updated_at": r["updated_at"],
                    "token_stats": self.calculate_token_stats(r["content"])
                }
                results.append(snippet_dict)

            return results

    def get_snippet(self, snippet_id: str) -> Optional[Dict[str, Any]]:
        """Fetch single snippet by ID."""
        with sqlite3.connect(self.db_path) as conn:
            conn.row_factory = sqlite3.Row
            cursor = conn.cursor()
            cursor.execute("SELECT * FROM snippets WHERE id = ?", (snippet_id,))
            row = cursor.fetchone()
            if not row:
                return None

            try:
                tags_list = json.loads(row["tags"]) if row["tags"] else []
            except Exception:
                tags_list = []

            return {
                "id": row["id"],
                "title": row["title"],
                "category": row["category"],
                "tags": tags_list,
                "content": row["content"],
                "description": row["description"] or "",
                "created_at": row["created_at"],
                "updated_at": row["updated_at"],
                "token_stats": self.calculate_token_stats(row["content"])
            }

    def create_snippet(
        self,
        title: str,
        category: str,
        content: str,
        tags: Optional[List[str]] = None,
        description: str = ""
    ) -> Dict[str, Any]:
        """Create and store a new snippet / prompt."""
        snippet_id = str(uuid.uuid4())
        now = time.time()
        tags_json = json.dumps(tags or [], ensure_ascii=False)

        with sqlite3.connect(self.db_path) as conn:
            cursor = conn.cursor()
            cursor.execute("""
                INSERT INTO snippets (id, title, category, tags, content, description, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                snippet_id,
                title.strip() or "Untitled Snippet",
                category.strip().lower() or "ai_prompt",
                tags_json,
                content,
                description.strip(),
                now,
                now
            ))
            conn.commit()

        return self.get_snippet(snippet_id)

    def update_snippet(
        self,
        snippet_id: str,
        title: Optional[str] = None,
        category: Optional[str] = None,
        content: Optional[str] = None,
        tags: Optional[List[str]] = None,
        description: Optional[str] = None
    ) -> Optional[Dict[str, Any]]:
        """Update existing snippet fields."""
        existing = self.get_snippet(snippet_id)
        if not existing:
            return None

        new_title = title if title is not None else existing["title"]
        new_category = category.lower() if category is not None else existing["category"]
        new_content = content if content is not None else existing["content"]
        new_tags = json.dumps(tags if tags is not None else existing["tags"], ensure_ascii=False)
        new_desc = description if description is not None else existing["description"]
        now = time.time()

        with sqlite3.connect(self.db_path) as conn:
            cursor = conn.cursor()
            cursor.execute("""
                UPDATE snippets
                SET title = ?, category = ?, content = ?, tags = ?, description = ?, updated_at = ?
                WHERE id = ?
            """, (new_title.strip(), new_category.strip(), new_content, new_tags, new_desc.strip(), now, snippet_id))
            conn.commit()

        return self.get_snippet(snippet_id)

    def delete_snippet(self, snippet_id: str) -> bool:
        """Delete snippet by ID."""
        with sqlite3.connect(self.db_path) as conn:
            cursor = conn.cursor()
            cursor.execute("DELETE FROM snippets WHERE id = ?", (snippet_id,))
            conn.commit()
            return cursor.rowcount > 0

    def reset_default_templates(self) -> int:
        """Re-seed default sample templates into database without deleting custom snippets."""
        now = time.time()
        inserted_count = 0
        with sqlite3.connect(self.db_path) as conn:
            cursor = conn.cursor()
            for tpl in DEFAULT_TEMPLATES:
                cursor.execute("""
                    INSERT OR REPLACE INTO snippets (id, title, category, tags, content, description, created_at, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """, (
                    tpl["id"],
                    tpl["title"],
                    tpl["category"],
                    json.dumps(tpl.get("tags", []), ensure_ascii=False),
                    tpl["content"],
                    tpl.get("description", ""),
                    now,
                    now
                ))
                inserted_count += 1
            conn.commit()
        return inserted_count

    async def test_prompt_async(
        self,
        prompt: str,
        system_instruction: Optional[str] = None,
        model: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Execute an instant AI test for a given prompt using Google Gemini (if configured)
        or fast local engine fallback with latency measurement and token estimation.
        """
        if not prompt or not prompt.strip():
            return {
                "status": "error",
                "message": "Prompt content is empty.",
                "response": "",
                "duration_ms": 0
            }

        t0 = time.perf_counter()
        from app.gemini_service import gemini_service
        from app.ai_copilot import ai_copilot
        from app.metrics import collector

        full_prompt = prompt.strip()
        if system_instruction and system_instruction.strip():
            full_prompt = f"[SYSTEM INSTRUCTION]:\n{system_instruction.strip()}\n\n[USER PROMPT]:\n{full_prompt}"

        # If Gemini is configured, generate with Gemini
        if gemini_service.is_configured():
            target_model = model or gemini_service.model_name or "gemini-3.5-flash-lite"
            try:
                import asyncio
                res = await asyncio.wait_for(
                    asyncio.to_thread(
                        gemini_service._client.models.generate_content,
                        model=target_model,
                        contents=full_prompt
                    ),
                    timeout=12.0
                )
                duration_ms = round((time.perf_counter() - t0) * 1000)
                answer_text = res.text.strip() if (res and res.text) else "No response returned from model."
                
                return {
                    "status": "success",
                    "engine": "gemini",
                    "model": target_model,
                    "response": answer_text,
                    "duration_ms": duration_ms,
                    "prompt_tokens": self.calculate_token_stats(full_prompt)["estimated_tokens"],
                    "response_tokens": self.calculate_token_stats(answer_text)["estimated_tokens"]
                }
            except Exception as e:
                logger.warning(f"Gemini test prompt execution failed: {e}")
                # Fall through to local engine

        # Fast local copilot execution fallback
        duration_ms = round((time.perf_counter() - t0) * 1000)
        metrics = collector.get_all_metrics()
        local_ans = ai_copilot.answer_query(prompt, metrics)
        reply = local_ans.get("answer", "")
        
        return {
            "status": "success",
            "engine": "local_engine",
            "model": "Local Fast AI Heuristic Engine",
            "response": f"*(Chế độ Local Engine - Hãy cấu hình Gemini API Key để kích hoạt mô hình Gemini 3.5 Flash / 3.7 Flash)*\n\n{reply}",
            "duration_ms": duration_ms,
            "prompt_tokens": self.calculate_token_stats(full_prompt)["estimated_tokens"],
            "response_tokens": self.calculate_token_stats(reply)["estimated_tokens"]
        }

# Global Singleton instance
snippet_lab_service = SnippetLabService()
