"""Bootstrap FastAPI: apenas saude; contratos de negocio ainda nao publicados."""
from fastapi import FastAPI

app = FastAPI(title="EventHub - Inscricoes", version="0.1.0")


@app.get("/health", include_in_schema=False)
def health():
    return {
        "status": "up",
        "service": "registrations",
        "implementation": "scaffold",
        "business_ready": False,
    }
