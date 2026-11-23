"""Copia as imagens de uma pasta (e subpastas) para lotes novos do rotulador.

Uso: python -m lince.importar <pasta_de_imagens> [--por-lote 100]
"""
import argparse
import shutil
from pathlib import Path

from .armazenamento import EXTENSOES, LOTES


def importar(origem: Path, por_lote: int = 100, destino: Path = LOTES) -> list[Path]:
    """Cria lote_NNN a partir do próximo número livre, com até `por_lote` imagens cada. A origem não é alterada."""
    if por_lote < 1:
        raise ValueError("--por-lote precisa ser 1 ou mais")
    fotos = sorted(p for p in Path(origem).rglob("*") if p.is_file() and p.suffix.lower() in EXTENSOES)
    usados = [int(p.name[5:]) for p in destino.glob("lote_*") if p.name[5:].isdigit()]
    primeiro, criados = max(usados, default=0) + 1, []
    for i in range(0, len(fotos), por_lote):
        pasta = destino / f"lote_{primeiro + i // por_lote:03d}"
        pasta.mkdir(parents=True)
        for k, foto in enumerate(fotos[i:i + por_lote]):
            alvo = pasta / foto.name
            shutil.copy2(foto, alvo if not alvo.exists() else pasta / f"{k}_{foto.name}")  # mesmo nome vindo de subpastas
        criados.append(pasta)
    return criados


if __name__ == "__main__":
    argumentos = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    argumentos.add_argument("origem", type=Path)
    argumentos.add_argument("--por-lote", type=int, default=100)
    a = argumentos.parse_args()
    criados = importar(a.origem, a.por_lote)
    print(f"{len(criados)} lote(s) criado(s) em {LOTES}" if criados else "Nenhuma imagem .jpg, .jpeg ou .png encontrada.")
