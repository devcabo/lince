"""Onde ficam as fotos, as classes e os rótulos, e como os rótulos são lidos e gravados.

Um arquivo de rótulos por modo e por lote: dados/rotulos/<modo>/<lote>.json.
"""
import json
import os
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
DADOS = RAIZ / "dados"          # fora do git
LOTES = DADOS / "lotes"         # uma pasta de imagens por lote
ROTULOS = DADOS / "rotulos"
CACHE = DADOS / "cache-sam"     # leitura das fotos pelo SAM; pode apagar, é refeita
TREINO = DADOS / "treino"       # saída no formato YOLO
MODOS = ("poligono", "bounding_box")
MARCAS = ("sem_objeto", "ilegivel")  # marcas da foto inteira
EXTENSOES = {".jpg", ".jpeg", ".png"}


def carregar_classes(arquivo: Path = RAIZ / "classes.json") -> dict:
    """{modo: [{nome, rotulo, cor}]}. De 1 a 9 classes por modo: as teclas 1 a 9 seguem a ordem do arquivo."""
    classes = json.loads(Path(arquivo).read_text(encoding="utf-8"))
    for modo in MODOS:
        nomes = [c["nome"] for c in classes.get(modo) or []]
        if not 1 <= len(nomes) <= 9 or len(set(nomes)) != len(nomes):
            raise ValueError(f"classes.json: o modo {modo} precisa de 1 a 9 classes com nomes diferentes")
    return {modo: classes[modo] for modo in MODOS}


CLASSES = carregar_classes()


def pasta_do_lote(lote: str) -> Path:
    pasta = (LOTES / lote).resolve()
    if pasta.parent != LOTES.resolve() or not pasta.is_dir():
        raise ValueError("lote inválido")
    return pasta


def foto_do_lote(lote: str, arquivo: str) -> Path:
    """Só aceita imagem que esteja direto dentro da pasta do lote."""
    caminho = (pasta_do_lote(lote) / arquivo).resolve()
    if caminho.parent.parent != LOTES.resolve() or caminho.suffix.lower() not in EXTENSOES or not caminho.is_file():
        raise ValueError("foto inválida")
    return caminho


def fotos_do_lote(lote: str) -> list[Path]:
    return sorted(p for p in pasta_do_lote(lote).iterdir() if p.suffix.lower() in EXTENSOES)


def lotes() -> list[str]:
    return sorted(p.name for p in LOTES.iterdir() if p.is_dir()) if LOTES.is_dir() else []


def _arquivo(modo: str, lote: str) -> Path:
    if modo not in MODOS:
        raise ValueError("modo inválido")
    return ROTULOS / modo / f"{pasta_do_lote(lote).name}.json"


def ler_lote(modo: str, lote: str) -> dict:
    """{arquivo da foto: rótulo}. Rótulo = {caixas: [{x, y, w, h, classe, mascara?}], foto, quando}, em frações da foto."""
    arquivo = _arquivo(modo, lote)
    return json.loads(arquivo.read_text(encoding="utf-8")) if arquivo.exists() else {}


def gravar_lote(modo: str, lote: str, fotos: dict) -> None:
    arquivo = _arquivo(modo, lote)
    arquivo.parent.mkdir(parents=True, exist_ok=True)
    temporario = arquivo.with_suffix(".tmp")  # grava ao lado e troca: queda de luz não deixa arquivo pela metade
    temporario.write_text(json.dumps(fotos, ensure_ascii=False, indent=1), encoding="utf-8")
    os.replace(temporario, arquivo)


def rotulada(rotulo: dict | None, modo: str) -> bool:
    """Tem ao menos um objeto de uma classe do modo, ou foi marcada como sem objeto / ilegível."""
    if not rotulo:
        return False
    nomes = {c["nome"] for c in CLASSES[modo]}
    return rotulo.get("foto") in MARCAS or any(c.get("classe") in nomes for c in rotulo.get("caixas") or [])
