"""Tiny web server for the Stock Drift Check app.

It only serves the static page and answers the health check. All of the comparison
work happens in the person's browser, so no stock data ever reaches this server.
"""
import json
import mimetypes
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlparse

STATIC = (Path(__file__).parent / "static").resolve()
PORT = int(os.environ.get("PORT", "8000"))

mimetypes.add_type("application/javascript", ".js")


class Handler(BaseHTTPRequestHandler):
    server_version = "StockMatch"

    def _send(self, code, body, ctype, cache="no-cache"):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", cache)
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def _handle(self):
        path = unquote(urlparse(self.path).path)
        if path in ("/health", "/api/health"):
            return self._send(200, b"ok", "text/plain; charset=utf-8")
        if path == "/api/info":
            body = json.dumps({"app": "stock-drift-check", "warehouse": "1A"}).encode()
            return self._send(200, body, "application/json")
        if path.startswith("/api/"):
            return self._send(404, b'{"error":"not found"}', "application/json")

        rel = "index.html" if path in ("", "/") else path.lstrip("/")
        target = (STATIC / rel).resolve()
        if STATIC not in target.parents or not target.is_file():
            return self._send(404, b"Not found", "text/plain; charset=utf-8")
        ctype = mimetypes.guess_type(str(target))[0] or "application/octet-stream"
        if ctype.startswith("text/") or ctype in ("application/javascript", "application/json"):
            ctype += "; charset=utf-8"
        cache = "no-cache" if target.suffix == ".html" else "public, max-age=3600"
        return self._send(200, target.read_bytes(), ctype, cache)

    do_GET = _handle
    do_HEAD = _handle

    def log_message(self, fmt, *args):
        pass  # keep request lines (which can carry nothing sensitive here) out of the logs


if __name__ == "__main__":
    ThreadingHTTPServer(("0.0.0.0", PORT), Handler).serve_forever()
