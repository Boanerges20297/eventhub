"""Offline integrity checks for EventHub architecture docs.

Usage: python scripts/test_architecture_docs.py
Reads files only; no Docker, service, Git, network or filesystem mutation.
"""
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
DOCUMENTS = (
    "README.md",
    "docs/ARQUITETURA_COMUNICACAO_SEGURANCA_REDE.md",
    "docs/FRONTEND_HANDOFF_2026-11-04.md",
    "docs/CHECKPOINT_2026-11-04.md",
    "docs/planejamento/README.md",
)


def validate_document(relative: str) -> tuple[int, int]:
    path = ROOT / relative
    content = path.read_text(encoding="utf-8-sig")
    if "§" in content:
        raise AssertionError(f"{relative}: marcador editorial nao substituido")
    if content.count(chr(96) * 3) % 2:
        raise AssertionError(f"{relative}: bloco Markdown sem fechamento")
    links = re.findall(r"\]\(([^)]+)\)", content)
    for item in links:
        if item.startswith(("https://", "http://", "mailto:")):
            continue
        target = item.split("#", 1)[0]
        if target and not (path.parent / target).exists():
            raise AssertionError(f"{relative}: link local quebrado: {item}")
    return len(content.splitlines()), len(links)


def main():
    for name in DOCUMENTS:
        lines, links = validate_document(name)
        print(f"DOC_OK {name} lines={lines} links={links}")
    doc = (ROOT / DOCUMENTS[1]).read_text(encoding="utf-8")
    fence = chr(96) * 3
    diagrams = re.findall(re.escape(fence) + r"mermaid\s*(.*?)\s*" +
                          re.escape(fence), doc, flags=re.S)
    if len(diagrams) < 3:
        raise AssertionError("Esperados pelo menos 3 diagramas Mermaid")
    for index, diagram in enumerate(diagrams, 1):
        if not re.match(r"^(flowchart|sequenceDiagram)\b", diagram.strip()):
            raise AssertionError(f"Diagrama {index}: tipo inesperado")
    required = (
        "## 3. Topologia", "## 4. Autenticação", "## 5. Fluxos",
        "## 6. Segurança", "## 7. Evidências", "## 8. Checklist",
        "INDETERMINADO", "Idempotency-Key",
        "EVENTHUB_INTERNAL_SECRET", "internal: true",
    )
    for term in required:
        if term not in doc:
            raise AssertionError(f"Documento incompleto: {term}")
    compose = (ROOT / "compose.yaml").read_text(encoding="utf-8")
    if "internal: true" not in compose or "127.0.0.1:" not in compose:
        raise AssertionError("Topologia documentada diverge do Compose")
    print(f"ARCH_DOCS_OK diagrams={len(diagrams)}")
    print("Limite: checagem estatica de documentacao, nao prova de seguranca.")


if __name__ == "__main__":
    main()
