"""Interactive visual regression checks via local Edge CDP, no Docker.
Run against scripts/visual_preview.py, which serves MOCK data only on loopback.
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

PORT = 49242
URL = sys.argv[1] if len(sys.argv)>1 else "http://127.0.0.1:48763/"
OUTPUT = ROOT/"docs"


def ensure(value, description):
    if not value:
        raise AssertionError(description)
    print("OK", description, flush=True)


def main():
    OUTPUT.mkdir(exist_ok=True)
    with tempfile.TemporaryDirectory(prefix=".cdp-interactive-",dir=ROOT) as profile:
        proc=subprocess.Popen([
            str(EDGE),"--headless=new","--disable-gpu","--no-first-run",
            "--no-default-browser-check","--remote-debugging-address=127.0.0.1",
            f"--remote-debugging-port={PORT}","--remote-allow-origins=*",
            f"--user-data-dir={profile}","about:blank",
        ], stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
        cdp=None
        try:
            page=None
            for attempt in range(60):
                try:
                    with urllib.request.urlopen(f"http://127.0.0.1:{PORT}/json/list",timeout=1) as rsp:
                        data=json.load(rsp)
                    page=next((p for p in data if p.get("type")=="page"),None)
                    if page:
                        break
                except (OSError,ValueError):
                    pass
                time.sleep(.15)
            ensure(page is not None,"CDP page available")
            cdp=CDP(page["webSocketDebuggerUrl"])
            cdp.call("Page.enable")
            cdp.call("Runtime.enable")
            cdp.call("Emulation.setDeviceMetricsOverride",{
                "width":390,"height":844,"deviceScaleFactor":1,"mobile":True,
                "screenWidth":390,"screenHeight":844,
            })
            cdp.call("Page.navigate",{"url":URL})
            time.sleep(1.7)

            def js(code):
                result=cdp.call("Runtime.evaluate",{
                    "expression":code,"returnByValue":True,"awaitPromise":True,
                })
                if "exceptionDetails" in result:
                    raise RuntimeError(result["exceptionDetails"])
                return result.get("result",{}).get("value")

            def screenshot(filename):
                image=cdp.call("Page.captureScreenshot",{
                    "format":"png","captureBeyondViewport":False,
                    "fromSurface":True,
                })["data"]
                dest=OUTPUT/filename
                dest.write_bytes(base64.b64decode(image))
                print("SCREENSHOT",dest.name,dest.stat().st_size,flush=True)

            ensure(js("innerWidth===390 && document.documentElement.scrollWidth<=390"),
                   "390px viewport, no overflow")
            ensure(js("getComputedStyle(document.querySelector('.eh-menu-toggle')).display !== 'none'"),
                   "mobile hamburger visible")
            ensure(js("getComputedStyle(document.querySelector('.eh-nav-tabs')).display === 'none'"),
                   "desktop navigation hidden on mobile")
            ensure(js("document.querySelector('.eh-brand-word').textContent==='EventHub'"),
                   "C2 brand caption EventHub")

            js("document.querySelector('.eh-menu-toggle').click()")
            time.sleep(.35)
            ensure(js("!!document.querySelector('.eh-drawer') && document.body.style.overflow==='hidden'"),
                   "drawer opens from left, locks background scroll")
            ensure(js("document.querySelector('.eh-menu-toggle').getAttribute('aria-expanded')==='true'"),
                   "hamburger reports expanded state")
            ensure(js("document.activeElement.getAttribute('aria-label')==='Fechar menu'"),
                   "focus moves to close control")
            screenshot("eventhub-mobile-drawer-open.png")

            cdp.call("Input.dispatchKeyEvent",{
                "type":"keyDown","key":"Escape","code":"Escape","windowsVirtualKeyCode":27,
            })
            cdp.call("Input.dispatchKeyEvent",{
                "type":"keyUp","key":"Escape","code":"Escape","windowsVirtualKeyCode":27,
            })
            time.sleep(.3)
            ensure(js("!document.querySelector('.eh-drawer') && document.body.style.overflow!== 'hidden'"),
                   "Escape closes drawer and restores scroll")
            ensure(js("document.activeElement.classList.contains('eh-menu-toggle')"),
                   "focus returns to menu button")

            js("document.querySelector('.eh-menu-toggle').click()")
            time.sleep(.2)
            js("document.querySelector('.eh-drawer-backdrop').click()")
            time.sleep(.2)
            ensure(js("!document.querySelector('.eh-drawer')"),
                   "outside click closes drawer")

            js("document.querySelector('.eh-menu-toggle').click()")
            time.sleep(.2)
            js("document.querySelector('.eh-drawer-link[href=\\\"#eventos\\\"]').click()")
            time.sleep(.35)
            ensure(js("!!document.querySelector('.eh-catalog-panel') && !document.querySelector('.eh-drawer')"),
                   "catalog navigates and menu closes")
            ensure(js("document.querySelectorAll('.eh-event-tile').length===3"),
                   "3 mock events rendered in catalog")
            screenshot("eventhub-mobile-catalog.png")

            js("document.querySelector('.eh-tile-action').click()")
            time.sleep(.35)
            ensure(js("document.querySelectorAll('.eh-activity-card').length===2"),
                   "activities loaded via mocked API contract")
            js("document.querySelector('.eh-activity-card button').click()")
            time.sleep(.2)
            ensure(js("!!document.querySelector('#eh-selected-activity') && document.querySelector('#eh-selected-activity').value==='act-demo-001'"),
                   "selected activity persists on registration screen")
            screenshot("eventhub-mobile-registrations.png")

            js("document.querySelector('.eh-menu-toggle').click()")
            time.sleep(.2)
            js("document.querySelector('.eh-drawer-link[href=\\\"#organizacao\\\"]').click()")
            time.sleep(.25)
            ensure(js("document.querySelector('#organizacao .eh-screen-heading h2').textContent.includes('Tire seu evento')"),
                   "organizer screen navigates")
            screenshot("eventhub-mobile-organizer.png")

            js("document.querySelector('.eh-menu-toggle').click()")
            time.sleep(.2)
            js("document.querySelector('.eh-drawer-link[href=\\\"#notificacoes\\\"]').click()")
            time.sleep(.25)
            ensure(js("document.querySelector('#notificacoes .eh-screen-heading h2').textContent.includes('atenção')"),
                   "notifications screen navigates")
            screenshot("eventhub-mobile-updates.png")

            cdp.call("Emulation.setDeviceMetricsOverride",{
                "width":1440,"height":900,"deviceScaleFactor":1,"mobile":False,
                "screenWidth":1440,"screenHeight":900,
            })
            time.sleep(.3)
            ensure(js("innerWidth===1440 && document.documentElement.scrollWidth<=1440"),
                   "1440px desktop layout no overflow")
            ensure(js("getComputedStyle(document.querySelector('.eh-menu-toggle')).display==='none' && getComputedStyle(document.querySelector('.eh-nav-tabs')).display!=='none'"),
                   "desktop top navigation visible, hamburger hidden")
            js("document.querySelector('.eh-nav-tabs a[href=\\\"#eventos\\\"]').click()")
            time.sleep(.3)
            screenshot("eventhub-desktop-catalog.png")
            print("VISUAL_INTERACTION_OK",flush=True)
        finally:
            if cdp: cdp.close()
            proc.terminate()
            try:proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                proc.kill()
                proc.wait(timeout=2)


if __name__=="__main__":
    main()
