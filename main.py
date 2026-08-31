import sys
import uvicorn

if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass

if __name__ == "__main__":
    host = "127.0.0.1"
    port = 8000
    print("\n" + "=" * 60)
    print("  [+] SYSTEM PERFORMANCE MONITOR DASHBOARD")
    print("  [*] Dashboard URL : http://127.0.0.1:8000")
    print("  [*] API Snapshot  : http://127.0.0.1:8000/api/metrics")
    print("  [*] WebSocket     : ws://127.0.0.1:8000/ws/metrics")
    print("=" * 60 + "\n")
    uvicorn.run("app.server:app", host=host, port=port, reload=True)
