"""Seleção por clique no modo Polígono: o SAM ("Segment Anything") devolve a silhueta do objeto clicado.

A parte pesada é "ler" a foto (~10 s em CPU). Ela é feita em segundo plano para a foto aberta e a seguinte e fica
guardada em disco; depois disso cada clique sai em menos de 1 s. Sem torch/transformers, o Lince funciona igual,
só com retângulos desenhados à mão. O modelo é baixado do Hugging Face na primeira vez e fica no cache.
"""
import base64
import io
import os
import threading
import time
from collections import OrderedDict, deque
from pathlib import Path

from .armazenamento import CACHE

MODELO = "Zigeng/SlimSAM-uniform-77"  # SAM enxuto: lê a foto em metade do tempo do sam-vit-base
estado = "carregando"                 # carregando | pronto | indisponivel
_torch = _modelo = _processador = None
_trava_modelo = threading.Lock()      # uma leitura de foto por vez
_trava_lidas = threading.Lock()
_lidas: OrderedDict = OrderedDict()   # foto -> (imagem, leitura); as 20 mais recentes ficam na memória
_fila: deque = deque()                # fotos a ler em segundo plano


def iniciar() -> None:
    """Carrega o modelo sem segurar a abertura do site."""
    threading.Thread(target=_carregar, daemon=True).start()


def _carregar() -> None:
    global estado, _torch, _modelo, _processador
    try:
        import torch
        from transformers import SamModel, SamProcessor
        torch.set_num_threads(max(1, (os.cpu_count() or 2) // 2))  # metade do processador; o resto fica para o navegador
        _torch, _modelo, _processador = torch, SamModel.from_pretrained(MODELO).eval(), SamProcessor.from_pretrained(MODELO)
        estado = "pronto"
    except Exception as erro:  # noqa: BLE001 - sem torch ou sem o modelo: segue com retângulo à mão
        print("Seleção por clique indisponível:", type(erro).__name__, erro, flush=True)
        estado = "indisponivel"
        return
    while True:  # leitura antecipada
        try:
            _ler(_fila.popleft())
        except IndexError:
            time.sleep(0.5)
        except Exception as erro:  # noqa: BLE001 - uma foto com problema não para a fila
            print("Leitura antecipada falhou:", erro, flush=True)


def preparar(fotos: list[Path]) -> None:
    """Pede a leitura da foto aberta e da seguinte; o que estava na fila antes é descartado."""
    _fila.clear()
    _fila.extend(fotos)


def _ler(foto: Path):
    """Imagem (até 1024 px) e a leitura do SAM, da memória, do disco ou calculada agora."""
    with _trava_lidas:
        if foto in _lidas:
            _lidas.move_to_end(foto)
            return _lidas[foto]
    import numpy as np
    from PIL import Image
    imagem = Image.open(foto).convert("RGB")
    imagem.thumbnail((1024, 1024))
    guardada = CACHE / foto.parent.name / (foto.stem + ".npy")

    def do_disco():
        try:
            return _torch.from_numpy(np.load(guardada).astype("float32"))
        except (OSError, ValueError):  # não existe ou ficou pela metade
            return None

    leitura = do_disco()
    if leitura is None:
        with _trava_modelo:
            leitura = do_disco()  # outra chamada pode ter terminado enquanto esta esperava
            if leitura is None:
                with _torch.no_grad():
                    leitura = _modelo.get_image_embeddings(_processador(imagem, return_tensors="pt")["pixel_values"])
                guardada.parent.mkdir(parents=True, exist_ok=True)
                with open(guardada.with_suffix(".tmp"), "wb") as arquivo:
                    np.save(arquivo, leitura.numpy().astype("float16"))
                os.replace(guardada.with_suffix(".tmp"), guardada)
    with _trava_lidas:
        _lidas[foto] = (imagem, leitura)
        while len(_lidas) > 20:
            _lidas.popitem(last=False)
    return imagem, leitura


def selecionar(foto: Path, pontos: list, caixa: list | None) -> dict | None:
    """Objeto nos pontos clicados, ou dentro do retângulo dado: {x, y, w, h} em frações da foto + silhueta em PNG."""
    from PIL import Image
    imagem, leitura = _ler(foto)
    W, H = imagem.size
    if caixa:
        entrada = _processador(imagem, input_boxes=[[[caixa[0] * W, caixa[1] * H, caixa[2] * W, caixa[3] * H]]], return_tensors="pt")
    else:
        entrada = _processador(imagem, input_points=[[[[x * W, y * H] for x, y in pontos]]], return_tensors="pt")
    entrada.pop("pixel_values", None)
    with _torch.no_grad():  # sem trava: o clique não espera a leitura de outra foto
        saida = _modelo(**entrada, image_embeddings=leitura, multimask_output=True)
    mascaras = _processador.image_processor.post_process_masks(saida.pred_masks, entrada["original_sizes"], entrada["reshaped_input_sizes"])[0][0]
    notas = saida.iou_scores[0][0]
    # O SAM devolve 3 tamanhos (detalhe, parte, objeto): entre os bem avaliados, fica o maior, que costuma ser o objeto inteiro.
    boas = [k for k in range(len(notas)) if mascaras[k].any() and float(notas[k]) >= float(notas.max()) - 0.15]
    if not boas:
        return None
    k = max(boas, key=lambda n: int(mascaras[n].sum()))
    linhas, colunas = _torch.where(mascaras[k])
    x0, x1, y0, y1 = int(colunas.min()), int(colunas.max()) + 1, int(linhas.min()), int(linhas.max()) + 1
    # Silhueta: o recorte da máscara dentro do retângulo, como PNG transparente (a tela pinta por cima da foto).
    silhueta = Image.new("RGBA", (x1 - x0, y1 - y0), (255, 255, 255, 0))
    silhueta.putalpha(Image.fromarray((mascaras[k][y0:y1, x0:x1].numpy() * 255).astype("uint8"), "L"))
    png = io.BytesIO()
    silhueta.save(png, "PNG", optimize=True)
    return {"x": x0 / W, "y": y0 / H, "w": (x1 - x0) / W, "h": (y1 - y0) / H,
            "mascara": "data:image/png;base64," + base64.b64encode(png.getvalue()).decode()}
