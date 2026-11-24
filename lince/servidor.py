"""Site local do Lince: entrega a tela e as fotos e grava os rótulos. Só escuta em 127.0.0.1 (este computador).

GET  /  /web/...  /foto/<lote>/<arquivo>  /api/config  /api/estado  /api/lotes?modo=  /api/lote?modo=&nome=
     /api/planilha?modo=&lote=&classe=
POST /api/rotulo  /api/preparar  /api/sam  /api/exportar
"""
import json
import mimetypes
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, unquote, urlparse

from . import exportar, sam
from .armazenamento import CLASSES, MODOS, RAIZ, foto_do_lote, fotos_do_lote, gravar_lote, ler_lote, lotes, rotulada

WEB = (RAIZ / "web").resolve()
TIPOS_DA_TELA = {".html": "text/html", ".css": "text/css", ".js": "text/javascript"}
_trava = threading.Lock()                   # rótulos: leitura e gravação
_em_memoria: dict[tuple, dict] = {}         # (modo, lote) -> {foto: rótulo}


def rotulos_do(modo: str, lote: str) -> dict:
    if (modo, lote) not in _em_memoria:
        _em_memoria[modo, lote] = ler_lote(modo, lote)
    return _em_memoria[modo, lote]


def modo_valido(modo) -> str:
    if modo not in MODOS:
        raise ValueError("modo inválido")
    return modo


class Atendimento(BaseHTTPRequestHandler):
    def responder(self, corpo, status=200, tipo="application/json"):
        dados = corpo if isinstance(corpo, bytes) else json.dumps(corpo, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header("Content-Type", tipo if tipo.startswith("image/") else tipo + "; charset=utf-8")
        self.send_header("Content-Length", str(len(dados)))
        self.send_header("Cache-Control", "max-age=3600" if tipo.startswith("image/") else "no-store")
        self.end_headers()
        try:
            self.wfile.write(dados)
        except (BrokenPipeError, ConnectionAbortedError, ConnectionResetError):
            pass  # a aba foi fechada no meio da resposta

    def log_message(self, format, *args):  # noqa: A002 - sem uma linha no terminal a cada foto
        pass

    def do_GET(self):
        url = urlparse(self.path)
        pedido = {k: v[0] for k, v in parse_qs(url.query).items()}
        try:
            if url.path == "/" or url.path.startswith("/web/"):
                arquivo = (WEB / (unquote(url.path[5:]) if url.path != "/" else "index.html")).resolve()
                if WEB not in arquivo.parents or arquivo.suffix not in TIPOS_DA_TELA or not arquivo.is_file():
                    raise ValueError("arquivo inválido")
                return self.responder(arquivo.read_bytes(), tipo=TIPOS_DA_TELA[arquivo.suffix])
            if url.path == "/api/config":
                return self.responder({"classes": CLASSES})
            if url.path == "/api/estado":
                return self.responder({"sam": sam.estado})
            if url.path == "/api/lotes":
                modo, lista = modo_valido(pedido.get("modo")), []
                for lote in lotes():
                    fotos, do_lote = fotos_do_lote(lote), rotulos_do(modo, lote)
                    lista.append({"nome": lote, "total": len(fotos), "feitas": sum(rotulada(do_lote.get(f.name), modo) for f in fotos)})
                return self.responder(lista)
            if url.path == "/api/lote":
                modo, lote = modo_valido(pedido.get("modo")), pedido.get("nome", "")
                do_lote = rotulos_do(modo, lote)
                return self.responder([{"arquivo": f.name, "r": do_lote.get(f.name)} for f in fotos_do_lote(lote)])
            if url.path == "/api/planilha":  # ?modo=&lote=...&classe=... (lote e classe se repetem)
                listas = parse_qs(url.query)
                texto = exportar.planilha(modo_valido(pedido.get("modo")), listas.get("lote"), listas.get("classe") or [])
                return self.responder(texto.encode("utf-8-sig"), tipo="text/csv")  # BOM: o Excel lê os acentos
            if url.path.startswith("/foto/"):
                lote, _, arquivo = unquote(url.path[6:]).partition("/")
                foto = foto_do_lote(lote, arquivo)
                return self.responder(foto.read_bytes(), tipo=mimetypes.guess_type(foto.name)[0] or "image/jpeg")
        except (ValueError, OSError) as erro:
            return self.responder({"erro": str(erro)}, 400)
        self.responder({"erro": "não encontrado"}, 404)

    def do_POST(self):
        try:
            tamanho = int(self.headers.get("Content-Length", "0"))
            if not 0 < tamanho <= 2_000_000:  # o rótulo leva as silhuetas (PNG pequeno por objeto)
                raise ValueError("pedido inválido")
            corpo = json.loads(self.rfile.read(tamanho))
            if self.path == "/api/exportar":
                pasta, fotos = exportar.salvar(modo_valido(corpo.get("modo")), corpo.get("lotes"))
                return self.responder({"fotos": fotos, "pasta": str(pasta)})
            lote = corpo["lote"]
            if self.path == "/api/rotulo":  # r vazio = tirar o rótulo da foto
                modo, arquivo = modo_valido(corpo.get("modo")), foto_do_lote(lote, corpo["arquivo"]).name
                with _trava:
                    do_lote = rotulos_do(modo, lote)
                    if corpo.get("r"):
                        do_lote[arquivo] = corpo["r"]
                    else:
                        do_lote.pop(arquivo, None)
                    gravar_lote(modo, lote, do_lote)
                return self.responder({"salvo": True})
            if self.path == "/api/preparar":
                sam.preparar([foto_do_lote(lote, a) for a in corpo.get("arquivos", [])[:2]])
                return self.responder({})
            if self.path == "/api/sam":
                if sam.estado != "pronto":
                    return self.responder({"erro": "A seleção por clique não está disponível agora."}, 503)
                return self.responder({"caixa": sam.selecionar(foto_do_lote(lote, corpo["arquivo"]), corpo.get("pontos") or [], corpo.get("caixa"))})
        except (ValueError, KeyError, TypeError, OSError) as erro:
            return self.responder({"erro": str(erro)}, 400)
        self.responder({"erro": "não encontrado"}, 404)


class _Servidor(ThreadingHTTPServer):
    allow_reuse_address = False  # no Windows, reutilizar deixaria dois servidores na mesma porta sem erro


def rodar(porta: int) -> ThreadingHTTPServer:
    return _Servidor(("127.0.0.1", porta), Atendimento)
