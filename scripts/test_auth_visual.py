"""Teste visual de acesso EventHub: mock isolado, Edge/CDP e viewport responsivo."""
import base64
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import urllib.request

from visual_capture import CDP, EDGE, ROOT

PREVIEW_PORT = 48787
CDP_PORT = 49287

def wait_target():
    for _ in range(90):
        try:
            with urllib.request.urlopen(f"http://127.0.0.1:{CDP_PORT}/json/list",
                                        timeout=1) as response:
                pages = json.load(response)
            page = next((x for x in pages if x.get("type") == "page"), None)
            if page:
                return page
        except (OSError, ValueError):
            pass
        time.sleep(.15)
    raise RuntimeError("Edge CDP inacessivel")

def main():
    if not EDGE.exists():
        raise RuntimeError("Microsoft Edge ausente no notebook")
    env = dict(os.environ, EVENTHUB_PREVIEW_ROLE="guest")
    server = subprocess.Popen(
        [sys.executable, str(ROOT / "scripts" / "visual_preview.py"), str(PREVIEW_PORT)],
        env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL
    )
    browser = None
    cdp = None
    try:
        with tempfile.TemporaryDirectory(prefix=".preview-browser-login-", dir=ROOT,
                                         ignore_cleanup_errors=True) as profile:
            browser = subprocess.Popen([
                str(EDGE), "--headless=new", "--disable-gpu", "--no-first-run",
                "--no-default-browser-check", "--remote-debugging-address=127.0.0.1",
                f"--remote-debugging-port={CDP_PORT}", "--remote-allow-origins=*",
                f"--user-data-dir={profile}", "about:blank"
            ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            page=wait_target()
            cdp=CDP(page["webSocketDebuggerUrl"])
            cdp.call("Page.enable")
            cdp.call("Runtime.enable")
            def js(expression):
                response=cdp.call("Runtime.evaluate",{
                    "expression":expression, "returnByValue":True,"awaitPromise":True
                })
                if response.get("exceptionDetails"):
                    raise RuntimeError(str(response["exceptionDetails"]))
                return response.get("result",{}).get("value")
            def ensure(condition,label):
                if not condition:
                    raise AssertionError(label)
                print("OK",label,flush=True)
            def screenshot(name):
                picture=cdp.call("Page.captureScreenshot", {
                    "format":"png","captureBeyondViewport":False,"fromSurface":True
                })["data"]
                file=ROOT / "docs" / name
                file.write_bytes(base64.b64decode(picture))
                print("SCREENSHOT",name,file.stat().st_size,flush=True)
            cdp.call("Emulation.setDeviceMetricsOverride", {
                "width":1440,"height":900,"deviceScaleFactor":1,
                "mobile":False,"screenWidth":1440,"screenHeight":900
            })
            cdp.call("Page.navigate",{"url":f"http://127.0.0.1:{PREVIEW_PORT}/"})
            time.sleep(1.4)
            ensure(js("!!document.querySelector('.eh-auth-landing')"),
                   "public login workspace mounted")
            ensure(js("!!document.querySelector('.eh-auth-showcase h1') && !!document.querySelector('.eh-auth-access form')"),
                   "professional split hero and functional form")
            ensure(js("document.querySelector('input#eh-auth-email').labels.length===1 && document.querySelector('input#eh-auth-password').labels.length===1"),
                   "persistent accessible labels for credentials")
            ensure(js("document.querySelector('#eh-auth-password').minLength===-1"),
                   "login does not force registration password validation")
            ensure(js("document.documentElement.scrollWidth<=innerWidth"),
                   "desktop no horizontal overflow")
            ensure(js("getComputedStyle(document.querySelector('.eh-auth-showcase')).backgroundImage.includes('gradient')"),
                   "EventHub brand gradient applied")
            screenshot("eventhub-login-desktop-2026-11-04.png")
            js("document.querySelector('.eh-auth-mode-selector button:nth-child(2)').click()")
            time.sleep(.2)
            ensure(js("document.querySelector('#eh-auth-password').minLength===12"),
                   "registration enforces minimum 12 characters")
            ensure(js("document.querySelector('.eh-auth-submit').textContent.includes('Criar conta')"),
                   "registration action connected")
            js("document.querySelector('.eh-auth-mode-selector button:nth-child(1)').click()")
            js("document.querySelector('.eh-auth-reveal').click()")
            ensure(js("document.querySelector('#eh-auth-password').type==='text'"),
                   "password visibility toggle works")
            js("document.querySelector('.eh-auth-reveal').click()")
            cdp.call("Emulation.setDeviceMetricsOverride", {
                "width":390,"height":844,"deviceScaleFactor":1,
                "mobile":True,"screenWidth":390,"screenHeight":844
            })
            time.sleep(.55)
            ensure(js("document.documentElement.scrollWidth<=390"),"mobile no horizontal overflow")
            ensure(js("Math.round(document.querySelector('.eh-auth-access').getBoundingClientRect().width)<=390"),
                   "mobile form fits viewport")
            screenshot("eventhub-login-mobile-2026-11-04.png")
            print("EVENTHUB_AUTH_VISUAL_OK",flush=True)
    finally:
        if cdp:
            cdp.close()
        if browser:
            browser.terminate()
            try:browser.wait(timeout=5)
            except subprocess.TimeoutExpired:
                browser.kill();browser.wait(timeout=3)
        server.terminate()
        try:server.wait(timeout=5)
        except subprocess.TimeoutExpired:server.kill();server.wait(timeout=3)

if __name__=="__main__":
    main()
