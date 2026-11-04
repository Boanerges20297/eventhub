"""Preview visual isolado do build React. Usa dados ficticios e somente loopback."""
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import json
import os
import sys

PREVIEW_ROLE = os.environ.get('EVENTHUB_PREVIEW_ROLE', 'admin')

DIST = Path(__file__).resolve().parents[1] / "frontend" / "dist"
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 48761

EVENTS = [
    {"id": "ev-demo-001", "title": "Encontro de inovação e tecnologia", "atividades": 3},
    {"id": "ev-demo-002", "title": "Jornada de arquitetura de software", "atividades": 2},
    {"id": "ev-demo-003", "title": "Workshop de experiências digitais", "atividades": 1},
]

class PreviewHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(DIST), **kwargs)

    def do_GET(self):
        route = self.path.split("?", 1)[0]
        mock = {
            "/api/auth/me": {"user": {"id": "demo-user", "role": PREVIEW_ROLE, "org_id": "org-demo"}, "csrf": "preview-only"},
            "/api/eventos/ev-demo-001/atividades": {"atividades": [
                {"atividade_id": "act-demo-001", "titulo": "Laboratório de inovação",
                 "capacidade": 48, "gratuita": True, "preco_centavos": 0},
                {"atividade_id": "act-demo-002", "titulo": "Arquitetura e escala",
                 "capacidade": 20, "gratuita": False, "preco_centavos": 1500},
            ]},
            "/api/eventos": {"eventos": EVENTS},
            "/api/inscricoes": {"inscricoes": []},
            "/api/notificacoes": {"notificacoes": []},
        }
        if route.startswith("/api/"):
            data = json.dumps(mock.get(route, {"atividades": []}), ensure_ascii=False).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)
            return
        if route == "/":
            source = (DIST / "index.html").read_text(encoding="utf-8")
            notice = '<div style="position:fixed;bottom:8px;right:8px;z-index:999;background:#fff7d8;color:#624a14;padding:6px 10px;border-radius:8px;font:11px Arial">PRÉVIA VISUAL • DADOS FICTÍCIOS</div><output id="visual-metrics" style="position:fixed;top:0;right:0;background:#ffffffe8;z-index:999;font:10px Arial"></output><script>setTimeout(()=>{document.getElementById("visual-metrics").textContent="inner="+innerWidth+" scroll="+document.documentElement.scrollWidth+" screen="+screen.width},900)</script>'
            source = source.replace("</body>", notice + "</body>")
            data = source.encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)
            return
        return super().do_GET()

if __name__ == "__main__":
    if not DIST.exists():
        raise SystemExit("Execute npm run build --prefix frontend antes.")
    print(f"Visual preview on http://127.0.0.1:{PORT}", flush=True)
    ThreadingHTTPServer(("127.0.0.1", PORT), PreviewHandler).serve_forever()
