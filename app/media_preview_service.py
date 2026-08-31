import mimetypes
import os
import re
from datetime import datetime
from typing import Dict, Any, Optional, Tuple, Generator
from fastapi import HTTPException
from fastapi.responses import Response, FileResponse, StreamingResponse

# Map extensions to primary media categories
MEDIA_CATEGORY_MAP = {
    # Images
    '.png': 'image',
    '.jpg': 'image',
    '.jpeg': 'image',
    '.webp': 'image',
    '.gif': 'image',
    '.svg': 'image',
    '.bmp': 'image',
    '.ico': 'image',
    '.avif': 'image',
    '.tif': 'image',
    '.tiff': 'image',

    # Videos
    '.mp4': 'video',
    '.webm': 'video',
    '.mkv': 'video',
    '.mov': 'video',
    '.avi': 'video',
    '.m4v': 'video',
    '.ts': 'video',
    '.ogv': 'video',
    '.flv': 'video',

    # PDF & Documents
    '.pdf': 'pdf',

    # Audio
    '.mp3': 'audio',
    '.wav': 'audio',
    '.ogg': 'audio',
    '.flac': 'audio',
    '.m4a': 'audio',
    '.aac': 'audio',

    # Text / Code
    '.txt': 'text',
    '.log': 'text',
    '.json': 'text',
    '.py': 'text',
    '.js': 'text',
    '.css': 'text',
    '.html': 'text',
    '.htm': 'text',
    '.md': 'text',
    '.sql': 'text',
    '.yaml': 'text',
    '.yml': 'text',
    '.xml': 'text',
    '.csv': 'text',
    '.sh': 'text',
    '.ps1': 'text',
    '.ini': 'text',
    '.cfg': 'text',
    '.conf': 'text',
    '.env': 'text',
}

CUSTOM_MIME_TYPES = {
    '.svg': 'image/svg+xml',
    '.webp': 'image/webp',
    '.avif': 'image/avif',
    '.ico': 'image/x-icon',
    '.mp4': 'video/mp4',
    '.webm': 'video/webm',
    '.mkv': 'video/x-matroska',
    '.mov': 'video/quicktime',
    '.avi': 'video/x-msvideo',
    '.m4v': 'video/x-m4v',
    '.ts': 'video/mp2t',
    '.pdf': 'application/pdf',
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
    '.ogg': 'audio/ogg',
    '.flac': 'audio/flac',
    '.m4a': 'audio/mp4',
    '.json': 'application/json',
    '.md': 'text/markdown',
    '.py': 'text/plain',
    '.js': 'text/javascript',
    '.css': 'text/css',
    '.html': 'text/html',
    '.txt': 'text/plain',
    '.log': 'text/plain',
    '.sql': 'text/plain',
    '.yaml': 'text/plain',
    '.yml': 'text/plain',
    '.sh': 'text/plain',
    '.ps1': 'text/plain',
}

class MediaPreviewService:
    def __init__(self):
        mimetypes.init()

    def get_mime_type(self, file_path: str) -> str:
        """Get best matching MIME type for file."""
        ext = os.path.splitext(file_path)[1].lower()
        if ext in CUSTOM_MIME_TYPES:
            return CUSTOM_MIME_TYPES[ext]
        mime, _ = mimetypes.guess_type(file_path)
        return mime or 'application/octet-stream'

    def get_media_category(self, file_path: str) -> str:
        """Determine media category (image, video, pdf, audio, text, or unknown)."""
        ext = os.path.splitext(file_path)[1].lower()
        return MEDIA_CATEGORY_MAP.get(ext, 'unknown')

    def is_previewable(self, file_path: str) -> bool:
        """Check if file can be rendered directly in browser."""
        ext = os.path.splitext(file_path)[1].lower()
        return ext in MEDIA_CATEGORY_MAP

    def validate_file_path(self, raw_path: str) -> str:
        """Validate and resolve target file path safely."""
        if not raw_path or not raw_path.strip():
            raise HTTPException(status_code=400, detail="File path must not be empty.")
        
        norm_path = os.path.abspath(raw_path.strip())
        if not os.path.exists(norm_path):
            raise HTTPException(status_code=404, detail=f"File not found: '{norm_path}'")
        
        if not os.path.isfile(norm_path):
            raise HTTPException(status_code=400, detail=f"Path is a directory, not a file: '{norm_path}'")

        return norm_path

    def get_media_info(self, raw_path: str) -> Dict[str, Any]:
        """Return rich metadata for a given file."""
        file_path = self.validate_file_path(raw_path)
        stat = os.stat(file_path)
        size_bytes = stat.st_size
        ext = os.path.splitext(file_path)[1].lower()
        category = self.get_media_category(file_path)
        mime_type = self.get_mime_type(file_path)

        # Format Size
        if size_bytes >= (1024 ** 3):
            size_formatted = f"{round(size_bytes / (1024 ** 3), 2)} GB"
        elif size_bytes >= (1024 ** 2):
            size_formatted = f"{round(size_bytes / (1024 ** 2), 1)} MB"
        elif size_bytes >= 1024:
            size_formatted = f"{round(size_bytes / 1024, 1)} KB"
        else:
            size_formatted = f"{size_bytes} B"

        # Formatted Date
        mod_time = datetime.fromtimestamp(stat.st_mtime).strftime("%Y-%m-%d %H:%M:%S")

        # For small text files (under 1MB), read content for instant preview
        text_content = None
        if category == 'text' and size_bytes <= (1024 * 1024):
            try:
                with open(file_path, 'r', encoding='utf-8', errors='replace') as f:
                    text_content = f.read()
            except Exception:
                text_content = None

        return {
            "status": "success",
            "file_name": os.path.basename(file_path),
            "file_path": file_path,
            "directory": os.path.dirname(file_path),
            "extension": ext,
            "category": category,
            "mime_type": mime_type,
            "size_bytes": size_bytes,
            "size_formatted": size_formatted,
            "modified_at": mod_time,
            "is_previewable": self.is_previewable(file_path),
            "text_content": text_content,
        }

    def _parse_range_header(self, range_header: str, file_size: int) -> Tuple[int, int]:
        """Parse HTTP Range header: e.g. 'bytes=0-1048575' or 'bytes=1000-'."""
        match = re.match(r'bytes=(\d+)-(\d*)', range_header)
        if not match:
            return 0, file_size - 1
        
        start_str, end_str = match.groups()
        start = int(start_str)
        end = int(end_str) if end_str else file_size - 1

        if start >= file_size:
            start = max(0, file_size - 1)
        if end >= file_size:
            end = file_size - 1
        if start > end:
            start = end

        return start, end

    def _file_chunk_generator(self, file_path: str, start: int, length: int, chunk_size: int = 1024 * 64) -> Generator[bytes, None, None]:
        """Yield chunks of file content from start byte."""
        bytes_remaining = length
        with open(file_path, 'rb') as f:
            f.seek(start)
            while bytes_remaining > 0:
                current_chunk_size = min(chunk_size, bytes_remaining)
                chunk = f.read(current_chunk_size)
                if not chunk:
                    break
                bytes_remaining -= len(chunk)
                yield chunk

    def get_media_response(self, raw_path: str, range_header: Optional[str] = None) -> Response:
        """
        Generate streaming HTTP response supporting Partial Content (Range requests)
        for seamless video/audio seeking and inline viewing.
        """
        file_path = self.validate_file_path(raw_path)
        file_size = os.path.getsize(file_path)
        file_name = os.path.basename(file_path)
        mime_type = self.get_mime_type(file_path)
        category = self.get_media_category(file_path)

        # Handle Range requests (particularly vital for Video & Audio seeking)
        if range_header and (category in ('video', 'audio') or 'bytes=' in range_header):
            start, end = self._parse_range_header(range_header, file_size)
            content_length = (end - start) + 1

            headers = {
                "Content-Range": f"bytes {start}-{end}/{file_size}",
                "Accept-Ranges": "bytes",
                "Content-Length": str(content_length),
                "Content-Type": mime_type,
                "Content-Disposition": f'inline; filename="{file_name}"',
                "Cache-Control": "public, max-age=3600",
            }

            return StreamingResponse(
                self._file_chunk_generator(file_path, start, content_length),
                status_code=206,
                headers=headers,
                media_type=mime_type,
            )

        # Standard full file streaming response
        headers = {
            "Accept-Ranges": "bytes",
            "Content-Length": str(file_size),
            "Content-Type": mime_type,
            "Content-Disposition": f'inline; filename="{file_name}"',
            "Cache-Control": "public, max-age=3600",
        }

        # For text files, enforce utf-8 encoding header
        if category == 'text':
            headers["Content-Type"] = f"{mime_type}; charset=utf-8"

        return FileResponse(
            path=file_path,
            media_type=mime_type,
            filename=file_name,
            headers=headers,
            content_disposition_type="inline",
        )

media_preview_service = MediaPreviewService()
