"""Bootstrap Notificacoes; outbox e entrega de email ainda pendentes."""
from fastapi import FastAPI

app = FastAPI(title="EventHub - Notificacoes", version="0.1.0")


@app.get("/health", include_in_schema=False)
def health():
    return {
        "status": "up",
        "service": "notifications",
        "implementation": "scaffold",
        "business_ready": False,
    }
