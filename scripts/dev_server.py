#!/usr/bin/env python3
"""Static server for dev, with a change-version endpoint that drives auto-reload."""
import os
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WATCH = ("index.html", "src", "assets")


def version() -> float:
    latest = 0.0
    for name in WATCH:
        path = os.path.join(ROOT, name)
        if os.path.isfile(path):
            latest = max(latest, os.path.getmtime(path))
            continue
        for base, _, files in os.walk(path):
            for f in files:
                latest = max(latest, os.path.getmtime(os.path.join(base, f)))
    return latest


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def do_GET(self):
        if self.path.startswith("/__reload/version"):
            body = str(version()).encode()
            self.send_response(200)
            self.send_header("Content-Type", "text/plain")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        super().do_GET()

    def log_message(self, fmt, *args):
        if "__reload" in " ".join(str(a) for a in args):
            return
        super().log_message(fmt, *args)


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 9010
    ThreadingHTTPServer(("127.0.0.1", port), Handler).serve_forever()
