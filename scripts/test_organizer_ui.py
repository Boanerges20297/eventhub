"""Feature-focused visual test: organizer workspace, mock data and Edge CDP.

Starts a temporary synthetic preview server on loopback; no real user, MySQL,
Docker or persistent registration is accessed.
"""
import base64
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import urllib.request

from visual_capture import CDP, EDGE, ROOT

PREVIEW_PORT = 48766
CDP_PORT = 49246
DOCS = ROOT / "docs"


def wait_page():
    for _ in range(70):
        try:
            with urllib.request.urlopen(f"http://127.0.0.1:{CDP_PORT}/json/list",
                                         timeout=1) as response:
                pages = json.load(response)
            page = next((p for p in pages if p.get("type") == "page"), None)
            if page:
                return page
        except (OSError, ValueError):
            pass
        time.sleep(.15)
    raise RuntimeError("Edge CDP nao respondeu")


def main():
    if not EDGE.exists():
        raise RuntimeError("Edge ausente")
    server = subprocess.Popen(
        [sys.executable, str(ROOT / "scripts" / "visual_preview.py"),
         str(PREVIEW_PORT)],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
    cdp = None
    browser = None
    try:
        with tempfile.TemporaryDirectory(prefix=".preview-browser-manager-", dir=ROOT, ignore_cleanup_errors=True) as profile:
            browser = subprocess.Popen([
                str(EDGE), "--headless=new", "--disable-gpu", "--no-first-run",
                "--no-default-browser-check", "--remote-debugging-address=127.0.0.1",
                f"--remote-debugging-port={CDP_PORT}", "--remote-allow-origins=*",
                f"--user-data-dir={profile}", "about:blank",
            ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            page = wait_page()
            cdp = CDP(page["webSocketDebuggerUrl"])
            cdp.call("Page.enable")
            cdp.call("Runtime.enable")
            cdp.call("Emulation.setDeviceMetricsOverride", {
                "width": 1440, "height": 900, "deviceScaleFactor": 1,
                "mobile": False, "screenWidth": 1440, "screenHeight": 900,
            })
            cdp.call("Page.navigate", {"url": f"http://127.0.0.1:{PREVIEW_PORT}/"})
            time.sleep(1.6)

            def js(code):
                result = cdp.call("Runtime.evaluate", {
                    "expression": code, "returnByValue": True, "awaitPromise": True
                })
                if "exceptionDetails" in result:
                    raise RuntimeError(str(result["exceptionDetails"]))
                return result.get("result", {}).get("value")

            def ensure(condition, label):
                if not condition:
                    raise AssertionError(label)
                print("OK", label, flush=True)

            def capture(name):
                blob = cdp.call("Page.captureScreenshot", {
                    "format": "png", "captureBeyondViewport": False,
                    "fromSurface": True
                })["data"]
                path = DOCS / name
                path.write_bytes(base64.b64decode(blob))
                print("SCREENSHOT", name, path.stat().st_size, flush=True)

            ensure(js("!!document.querySelector('.eh-nav-tabs a[href=\\\"#organizacao\\\"]')"),
                   "organizer route available")
            js("document.querySelector('.eh-nav-tabs a[href=\\\"#organizacao\\\"]').click()")
            time.sleep(.85)
            ensure(js("document.querySelectorAll('.eh-manager-event').length===2"),
                   "private organization events rendered including draft")
            ensure(js("document.querySelectorAll('.eh-manager-activity').length===2"),
                   "published activities rendered in management view")
            js("document.querySelector('.eh-manager-activity .eh-manager-actions button:nth-child(2)').click()")
            time.sleep(.5)
            ensure(js("!!document.querySelector('.eh-manager-metrics') && document.querySelector('.eh-manager-metrics strong').textContent==='5'"),
                   "aggregate occupancy from independent service contract")
            js("document.querySelector('.eh-manager-activity .eh-manager-reg-toggle').click()")
            time.sleep(.45)
            ensure(js("document.querySelectorAll('.eh-manager-reg-table tbody tr').length===3"),
                   "private registration tickets rendered without personal data")
            ensure(js("document.querySelector('.eh-manager-reg-table tbody tr td').textContent==='#1'"),
                   "arrival order follows sequential tickets")
            ensure(js("document.querySelector('.eh-manager-reg-panel').textContent.includes('3 inscrição')"),
                   "processed count displayed")
            ensure(js("document.documentElement.scrollWidth<=innerWidth"),
                   "desktop no horizontal overflow")
            capture("eventhub-organizer-desktop-2026-11-04.png")

            js("document.querySelectorAll('.eh-manager-event')[1].click()")
            time.sleep(.55)
            ensure(js("document.querySelector('.eh-manager-event-header h3').textContent==='Evento em preparação'"),
                   "unpublished event is selectable privately")
            ensure(js("document.querySelectorAll('.eh-manager-activity').length===0"),
                   "draft empty state")
            ensure(js("!!document.querySelector('#eh-new-activity-title')"),
                   "add activity form available for draft")

            js("document.querySelectorAll('.eh-manager-event')[0].click()")
            time.sleep(.4)
            js("document.querySelector('.eh-manager-activity .eh-manager-reg-toggle').click()")
            time.sleep(.45)
            cdp.call("Emulation.setDeviceMetricsOverride", {
                "width": 390, "height": 844, "deviceScaleFactor": 1,
                "mobile": True, "screenWidth": 390, "screenHeight": 844,
            })
            time.sleep(.55)
            ensure(js("innerWidth===390 && document.documentElement.scrollWidth<=390"),
                   "mobile workspace no horizontal overflow")
            capture("eventhub-organizer-mobile-2026-11-04.png")
            print("ORGANIZER_UI_OK", flush=True)
    finally:
        if cdp:
            cdp.close()
        if browser:
            browser.terminate()
            try:
                browser.wait(timeout=5)
            except subprocess.TimeoutExpired:
                browser.kill()
                browser.wait(timeout=2)
        server.terminate()
        try:
            server.wait(timeout=5)
        except subprocess.TimeoutExpired:
            server.kill()
            server.wait(timeout=2)


if __name__ == "__main__":
    main()
