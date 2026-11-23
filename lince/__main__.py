"""Abre o Lince: python -m lince [--porta 8090] [--sem-navegador]"""
import argparse
import webbrowser

from . import sam
from .armazenamento import LOTES
from .servidor import rodar

argumentos = argparse.ArgumentParser(prog="lince", description="Rotulador de imagens para treinar IA (polígonos e bounding box).")
argumentos.add_argument("--porta", type=int, default=8090)
argumentos.add_argument("--sem-navegador", action="store_true", help="não abre o navegador sozinho")
a = argumentos.parse_args()

LOTES.mkdir(parents=True, exist_ok=True)
servidor = rodar(a.porta)
sam.iniciar()
endereco = f"http://127.0.0.1:{a.porta}"
print(f"Lince em {endereco}  (Ctrl+C para fechar)", flush=True)
if not a.sem_navegador:
    webbrowser.open(endereco)
try:
    servidor.serve_forever()
except KeyboardInterrupt:
    pass
