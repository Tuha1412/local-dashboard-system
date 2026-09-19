import socket
import sys
import uvicorn

if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass

def get_lan_ip() -> str:
    """Detect the active local LAN / Wi-Fi IP address."""
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.settimeout(0.5)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        try:
            return socket.gethostbyname(socket.gethostname())
        except Exception:
            return "127.0.0.1"

if __name__ == "__main__":
    host = "0.0.0.0"
    port = 8000
    lan_ip = get_lan_ip()

    print("\n" + "=" * 64)
    print("  [+] SYSTEM PERFORMANCE MONITOR DASHBOARD (LAN ENABLED)")
    print(f"  [*] Localhost URL : http://127.0.0.1:{port}")
    print(f"  [*] LAN / Wi-Fi   : http://{lan_ip}:{port}")
    print(f"  [*] API Snapshot  : http://{lan_ip}:{port}/api/metrics")
    print(f"  [*] WebSocket LAN : ws://{lan_ip}:{port}/ws/metrics")
    print(f"  [*] Listening on  : {host}:{port} (All Network Interfaces)")
    print("=" * 64 + "\n")
    uvicorn.run("app.server:app", host=host, port=port, reload=True)

