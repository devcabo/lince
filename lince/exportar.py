"""Exporta os rótulos no formato YOLO: uma pasta por lote, refeita a cada exportação.

  dados/treino/<modo>/<lote>/
    images/train|valid|test/   as fotos rotuladas
    labels/train|valid|test/   um .txt por foto, em frações da foto:
                               bounding_box: "classe x_centro y_centro largura altura"
                               poligono:     "classe x1 y1 x2 y2 ..." (contorno da silhueta)
    data.yaml                  caminhos e nomes das classes

A divisão 80/10/10 é pelo nome do arquivo: a mesma foto cai sempre na mesma parte.
Foto "ilegível" fica de fora; foto "sem objeto" entra com o .txt vazio (exemplo negativo).

Uso: python -m lince.exportar <poligono|bounding_box> [lote ...]
"""
import base64
import csv
import hashlib
import io
import math
import os
import shutil
import sys
from pathlib import Path

import numpy as np
from PIL import Image

from .armazenamento import CLASSES, MODOS, TREINO, fotos_do_lote, ler_lote, lotes as todos_os_lotes, rotulada

PARTES = ("train", "valid", "test")


def parte_da_foto(nome: str) -> str:
    """80% treino, 10% validação, 10% teste, sempre igual para o mesmo arquivo."""
    n = int(hashlib.sha256(nome.encode()).hexdigest(), 16) % 10
    return "test" if n == 0 else "valid" if n == 1 else "train"


def simplificar(pontos: list, folga: float) -> list:
    """Tira os pontos que saem menos de `folga` da reta entre os vizinhos que ficam (Douglas-Peucker)."""
    fica, pilha = {0, len(pontos) - 1}, [(0, len(pontos) - 1)]
    while pilha:
        i, j = pilha.pop()
        if j <= i + 1:
            continue
        (x0, y0), (x1, y1) = pontos[i], pontos[j]
        reta = math.hypot(x1 - x0, y1 - y0) or 1
        desvio, k = max((abs((x1 - x0) * (pontos[n][1] - y0) - (y1 - y0) * (pontos[n][0] - x0)) / reta, n) for n in range(i + 1, j))
        if desvio > folga:
            fica.add(k)
            pilha += [(i, k), (k, j)]
    return [pontos[n] for n in sorted(fica)]


def contorno(mascara: str) -> list:
    """Contorno da silhueta (PNG transparente em data URL): pontos (x, y) em frações do retângulo dela.

    O YOLO aceita um polígono só por objeto. Pedaços soltos (objeto tapado no meio) são ligados por uma ponte sem
    largura entre os pontos mais próximos. Buracos e ciscos (menos de 1% do maior pedaço) saem.
    """
    cheio = np.asarray(Image.open(io.BytesIO(base64.b64decode(mascara.split(",", 1)[1]))).convert("RGBA"))[:, :, 3] > 127
    altura, largura = cheio.shape
    borda = np.pad(cheio, 1)
    # Cada lado de pixel que dá para fora vira um passo entre dois cantos, sempre no sentido horário.
    lados = {}
    for vizinho, (a, b) in ((borda[:-2, 1:-1], ((0, 0), (0, 1))), (borda[1:-1, 2:], ((0, 1), (1, 1))),
                            (borda[2:, 1:-1], ((1, 1), (1, 0))), (borda[1:-1, :-2], ((1, 0), (0, 0)))):
        for linha, coluna in np.argwhere(cheio & ~vizinho).tolist():
            lados.setdefault((coluna + a[1], linha + a[0]), []).append((coluna + b[1], linha + b[0]))
    voltas = []  # (área, pontos) de cada pedaço
    while lados:  # segue os passos até fechar cada volta
        inicio = ponto = next(iter(lados))
        volta = []
        while not volta or ponto != inicio:
            volta.append(ponto)
            saidas = lados[ponto]
            ponto = saidas.pop()
            if not saidas:
                del lados[volta[-1]]
        area = sum(x0 * y1 - x1 * y0 for (x0, y0), (x1, y1) in zip(volta, volta[1:] + volta[:1]))
        if area > 0:  # no sentido horário é pedaço; ao contrário é buraco
            voltas.append((area, volta))
    voltas.sort(reverse=True)
    pontos = []
    for area, volta in voltas:
        if area < voltas[0][0] / 100:
            break
        longe = max(range(len(volta)), key=lambda n: math.dist(volta[0], volta[n]))  # corta a volta em duas para simplificar
        volta = simplificar(volta[:longe + 1], 1)[:-1] + simplificar(volta[longe:] + volta[:1], 1)[:-1]
        if pontos:  # ponte: vai do polígono até o pedaço, dá a volta nele e retorna pelo mesmo caminho
            _, i, j = min((math.dist(p, q), i, j) for i, p in enumerate(pontos) for j, q in enumerate(volta))
            volta = pontos[:i + 1] + volta[j:] + volta[:j + 1] + pontos[i:]
        pontos = volta
    return [(x / largura, y / altura) for x, y in pontos]


def linhas_yolo(rotulo: dict, classes: list[str], poligono: bool = False) -> str:
    """Conteúdo do .txt da foto: uma linha por objeto das classes dadas; vazio = foto sem objeto.

    Com `poligono`, a linha leva o contorno da silhueta; objeto sem silhueta (retângulo à mão) leva os 4 cantos.
    """
    linhas = []
    for c in rotulo.get("caixas") or []:
        if c.get("classe") not in classes:
            continue
        if poligono:
            pontos = contorno(c["mascara"]) if c.get("mascara") else []
            if len(pontos) < 3:
                pontos = [(0, 0), (1, 0), (1, 1), (0, 1)]
            numeros = " ".join(f"{min(1, max(0, c['x'] + x * c['w'])):.6f} {min(1, max(0, c['y'] + y * c['h'])):.6f}" for x, y in pontos)
        else:
            numeros = f"{c['x'] + c['w'] / 2:.6f} {c['y'] + c['h'] / 2:.6f} {c['w']:.6f} {c['h']:.6f}"
        linhas.append(f"{classes.index(c['classe'])} {numeros}\n")
    return "".join(linhas)


def salvar(modo: str, lotes: list[str] | None = None, treino: Path = TREINO) -> tuple[Path, dict]:
    """Grava uma pasta por lote (sem lista: todos), trocando a que já existia. Devolve a pasta do modo e o total por parte."""
    if modo not in MODOS:
        raise ValueError(f"Modo desconhecido: {modo}. Use: {' ou '.join(MODOS)}.")
    classes, contagem = [c["nome"] for c in CLASSES[modo]], dict.fromkeys(PARTES, 0)
    for lote in todos_os_lotes() if lotes is None else lotes:
        do_lote = ler_lote(modo, lote)
        entram = [(f, do_lote[f.name]) for f in fotos_do_lote(lote)
                  if rotulada(do_lote.get(f.name), modo) and do_lote[f.name].get("foto") != "ilegivel"]
        if not entram:
            continue
        pasta = treino / modo / lote
        if pasta.exists():
            shutil.rmtree(pasta)
        for parte in PARTES:
            (pasta / "images" / parte).mkdir(parents=True)
            (pasta / "labels" / parte).mkdir(parents=True)
        nomes = "".join(f"  {i}: {nome}\n" for i, nome in enumerate(classes))
        (pasta / "data.yaml").write_text(  # sem "path": os caminhos valem a partir da pasta do próprio data.yaml
            f"train: images/train\nval: images/valid\ntest: images/test\nnc: {len(classes)}\nnames:\n{nomes}", encoding="utf-8")
        for foto, rotulo in entram:
            parte = parte_da_foto(foto.name)
            try:
                os.link(foto, pasta / "images" / parte / foto.name)  # mesma foto nos dois lugares, sem gastar disco
            except OSError:
                shutil.copy2(foto, pasta / "images" / parte / foto.name)
            (pasta / "labels" / parte / f"{foto.stem}.txt").write_text(linhas_yolo(rotulo, classes, modo == "poligono"), encoding="utf-8")
            contagem[parte] += 1
    if not sum(contagem.values()):
        raise ValueError(f"Nenhuma foto rotulada no modo {modo} nos lotes escolhidos.")
    return treino / modo, contagem


def planilha(modo: str, lotes: list[str] | None, escolhidas: list[str]) -> str:
    """Planilha (CSV com ";", abre direto no Excel): uma linha por foto com ao menos um objeto das classes escolhidas,
    com quantos objetos de cada uma. As marcas "sem_objeto" e "ilegivel" também podem ser escolhidas (contam 1)."""
    if modo not in MODOS:
        raise ValueError(f"Modo desconhecido: {modo}.")
    nomes = {c["nome"]: c.get("rotulo") or c["nome"] for c in CLASSES[modo]} | {"sem_objeto": "Sem objeto", "ilegivel": "Ilegível"}
    if not escolhidas or set(escolhidas) - nomes.keys():
        raise ValueError("Escolha ao menos uma classe do modo em uso.")
    linhas = [["lote", "foto", *(nomes[c] for c in escolhidas), "total", "rotulada_em"]]
    for lote in todos_os_lotes() if lotes is None else lotes:
        do_lote = ler_lote(modo, lote)
        for foto in fotos_do_lote(lote):
            rotulo = do_lote.get(foto.name) or {}
            objetos = [c.get("classe") for c in rotulo.get("caixas") or []]
            n = [objetos.count(c) + (rotulo.get("foto") == c) for c in escolhidas]
            if any(n):
                linhas.append([lote, foto.name, *n, sum(n), rotulo.get("quando", "")])
    if len(linhas) == 1:
        raise ValueError("Nenhuma foto com as classes escolhidas nos lotes escolhidos.")
    saida = io.StringIO()
    csv.writer(saida, delimiter=";", lineterminator="\n").writerows(linhas)
    return saida.getvalue()


if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    try:
        print(*salvar(sys.argv[1], sys.argv[2:] or None))
    except ValueError as erro:
        sys.exit(str(erro))
