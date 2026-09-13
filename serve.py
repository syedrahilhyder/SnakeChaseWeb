#!/usr/bin/env python3
"""Serve SnakeChase over the local network so an iPad on the same Wi-Fi can play.

Usage:
    python3 serve.py            # serve on port 8000, print the LAN address
    python3 serve.py 8080      # serve on a specific port
"""
import http.server
import socket
import socketserver
import sys

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8000


def lan_ip():
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("8.8.8.8", 80))
        return s.getsockname()[0]
    except Exception:
        return "127.0.0.1"
    finally:
        s.close()


def main():
    handler = http.server.SimpleHTTPRequestHandler
    # Suppress per-request logging noise.
    handler.log_message = lambda *a, **k: None
    with socketserver.TCPServer(("0.0.0.0", PORT), handler) as httpd:
        ip = lan_ip()
        print(f"SnakeChase is running.")
        print(f"  On this Mac:   http://localhost:{PORT}/")
        print(f"  On your iPad:  http://{ip}:{PORT}/   (same Wi-Fi)")
        print("Open the iPad URL in Safari, then Share > Add to Home Screen.")
        print("Press Ctrl+C to stop.")
        httpd.serve_forever()


if __name__ == "__main__":
    main()
