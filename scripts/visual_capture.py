"""Captura visual responsiva via CDP/Edge, sem dependencias de terceiros.

Uso: python scripts/visual_capture.py <URL> <width> <height> <output.png>
O servidor visual_preview.py fornece somente dados sinteticos, em loopback.
"""
import base64
import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import urllib.request
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parents[1]
EDGE = Path(r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe")
PORT = 49241


def read_exact(sock, size):
    buf = bytearray()
    while len(buf) < size:
        part = sock.recv(size - len(buf))
        if not part:
            raise ConnectionError("CDP socket closed")
        buf.extend(part)
    return bytes(buf)


class CDP:
    def __init__(self, endpoint):
        u = urlparse(endpoint)
        self.sock = socket.create_connection((u.hostname, u.port), timeout=20)
        self.sock.settimeout(20)
        key = base64.b64encode(os.urandom(16)).decode()
        req = (f"GET {u.path} HTTP/1.1\r\nHost: {u.netloc}\r\n"
               "Upgrade: websocket\r\nConnection: Upgrade\r\n"
               f"Sec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n\r\n")
        self.sock.sendall(req.encode())
        head = bytearray()
        while not head.endswith(b"\r\n\r\n"):
            head.extend(read_exact(self.sock, 1))
        if b" 101 " not in bytes(head).split(b"\r\n", 1)[0]:
            raise RuntimeError("CDP WebSocket handshake refused: " + head[:160].decode(errors="replace"))
        self.next_id = 0

    def send_frame(self, data, opcode=1):
        mask = os.urandom(4)
        ln = len(data)
        header = bytes([0x80 | opcode, 0x80 | ln]) if ln < 126 else (
            bytes([0x80 | opcode, 0x80 | 126]) + ln.to_bytes(2, "big") if ln < 65536
            else bytes([0x80 | opcode, 0x80 | 127]) + ln.to_bytes(8, "big")
        )
        body = bytes(b ^ mask[i % 4] for i, b in enumerate(data))
        self.sock.sendall(header + mask + body)

    def read_message(self):
        while True:
            header = read_exact(self.sock, 2)
            opcode = header[0] & 15
            length = header[1] & 127
            if length == 126:
                length = int.from_bytes(read_exact(self.sock, 2), "big")
            elif length == 127:
                length = int.from_bytes(read_exact(self.sock, 8), "big")
            masked = header[1] & 128
            mask = read_exact(self.sock, 4) if masked else None
            data = read_exact(self.sock, length)
            if mask:
                data = bytes(b ^ mask[i % 4] for i, b in enumerate(data))
            if opcode == 9:
                self.send_frame(data, 10)
                continue
            if opcode == 8:
                raise RuntimeError("CDP WebSocket closed")
            if opcode == 1:
                return json.loads(data.decode("utf-8"))

    def call(self, method, params=None):
        self.next_id += 1
        ident = self.next_id
        self.send_frame(json.dumps({"id": ident, "method": method, "params": params or {}}).encode())
        while True:
            message = self.read_message()
            if message.get("id") == ident:
                if "error" in message:
                    raise RuntimeError(f"{method}: {message['error']}")
                return message.get("result", {})

    def close(self):
        self.sock.close()


def main():
    if len(sys.argv) != 5:
        raise SystemExit("Uso: visual_capture.py URL width height output.png")
    url = sys.argv[1]
    width, height = int(sys.argv[2]), int(sys.argv[3])
    output = Path(sys.argv[4]).resolve()
    if not EDGE.exists():
        raise SystemExit("Microsoft Edge nao encontrado")
    with tempfile.TemporaryDirectory(prefix=".cdp-", dir=ROOT) as profile:
        proc = subprocess.Popen(
            [str(EDGE), "--headless=new", "--disable-gpu", "--no-first-run",
             "--no-default-browser-check", "--remote-debugging-address=127.0.0.1",
             f"--remote-debugging-port={PORT}", "--remote-allow-origins=*",
             f"--user-data-dir={profile}", "about:blank"],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        cdp = None
        try:
            page = None
            for _ in range(60):
                try:
                    with urllib.request.urlopen(f"http://127.0.0.1:{PORT}/json/list", timeout=1) as r:
                        pages = json.load(r)
                    page = next((p for p in pages if p.get("type") == "page"), None)
                    if page:
                        break
                except (OSError, ValueError):
                    pass
                time.sleep(.15)
            if not page:
                raise RuntimeError("CDP alvo nao respondeu")
            cdp = CDP(page["webSocketDebuggerUrl"])
            cdp.call("Page.enable")
            cdp.call("Emulation.setDeviceMetricsOverride", {
                "width": width, "height": height, "deviceScaleFactor": 1,
                "mobile": width < 700, "screenWidth": width, "screenHeight": height
            })
            cdp.call("Page.navigate", {"url": url})
            time.sleep(2)
            metrics = cdp.call("Runtime.evaluate", {
                "expression": "({width:innerWidth,scroll:document.documentElement.scrollWidth,body:document.body.scrollWidth,title:document.title})",
                "returnByValue": True
            })["result"]["value"]
            data = cdp.call("Page.captureScreenshot", {
                "format": "png", "captureBeyondViewport": False, "fromSurface": True
            })["data"]
            output.parent.mkdir(parents=True, exist_ok=True)
            output.write_bytes(base64.b64decode(data))
            print("VISUAL_METRICS=" + json.dumps(metrics, ensure_ascii=False), flush=True)
            print(f"SCREENSHOT={output} ({output.stat().st_size} bytes)", flush=True)
            if metrics["width"] != width or metrics["scroll"] > width + 1:
                raise SystemExit("FALHA: viewport divergente ou overflow horizontal")
        finally:
            if cdp:
                cdp.close()
            proc.terminate()
            try:
                proc.wait(timeout=6)
            except subprocess.TimeoutExpired:
                proc.kill()
                proc.wait(timeout=3)


if __name__ == "__main__":
    main()
