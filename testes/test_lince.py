"""Testes das regras do Lince. Uso (na raiz do projeto): python -m unittest discover testes"""
import base64
import io
import tempfile
import unittest
from pathlib import Path

from PIL import Image

from lince import armazenamento
from lince.exportar import linhas_yolo, parte_da_foto
from lince.importar import importar


def png_com(alfa: Image.Image) -> str:
    imagem, png = Image.new("RGBA", alfa.size), io.BytesIO()
    imagem.putalpha(alfa)
    imagem.save(png, "PNG")
    return "data:image/png;base64," + base64.b64encode(png.getvalue()).decode()


class Regras(unittest.TestCase):
    def test_conta_como_rotulada(self):
        modo = "bounding_box"
        classe = armazenamento.CLASSES[modo][0]["nome"]
        self.assertTrue(armazenamento.rotulada({"caixas": [{"classe": classe}]}, modo))
        self.assertTrue(armazenamento.rotulada({"caixas": [], "foto": "sem_objeto"}, modo))
        self.assertFalse(armazenamento.rotulada({"caixas": [{"classe": "nao_existe"}]}, modo))
        self.assertFalse(armazenamento.rotulada({"caixas": [], "foto": ""}, modo))
        self.assertFalse(armazenamento.rotulada(None, modo))

    def test_so_abre_foto_de_dentro_dos_lotes(self):
        for lote, arquivo in [("..", "x.jpg"), ("lote_001", "../../classes.json"), ("../rotulos", "a.jpg")]:
            with self.assertRaises(ValueError):
                armazenamento.foto_do_lote(lote, arquivo)
        with self.assertRaises(ValueError):
            armazenamento.ler_lote("../fora", "lote_001")

    def test_classes_validas(self):
        with tempfile.TemporaryDirectory() as pasta:
            arquivo = Path(pasta) / "classes.json"
            arquivo.write_text('{"poligono": [{"nome": "a"}, {"nome": "a"}], "bounding_box": [{"nome": "b"}]}', encoding="utf-8")
            with self.assertRaises(ValueError):
                armazenamento.carregar_classes(arquivo)

    def test_foto_cai_sempre_na_mesma_parte(self):
        partes = [parte_da_foto(f"{n}.jpg") for n in range(2000)]
        self.assertEqual(partes, [parte_da_foto(f"{n}.jpg") for n in range(2000)])
        self.assertAlmostEqual(partes.count("train") / 2000, 0.8, delta=0.05)

    def test_linha_bounding_box_usa_o_centro(self):
        rotulo = {"caixas": [{"x": 0.1, "y": 0.2, "w": 0.2, "h": 0.6, "classe": "b"}, {"x": 0, "y": 0, "w": 1, "h": 1, "classe": "outra"}]}
        self.assertEqual(linhas_yolo(rotulo, ["a", "b"]), "1 0.200000 0.500000 0.200000 0.600000\n")
        self.assertEqual(linhas_yolo({"caixas": [], "foto": "sem_objeto"}, ["a"]), "")

    def test_silhueta_vira_poligono(self):
        # silhueta em "L" (40x40 com o canto de cima à direita vazio) e, solto, um cisco que deve ser ignorado
        alfa = Image.new("L", (80, 40), 0)
        for canto in [(0, 0, 20, 40), (0, 20, 40, 40), (70, 0, 72, 2)]:
            alfa.paste(255, canto)
        linha = linhas_yolo({"caixas": [{"x": 0.2, "y": 0.5, "w": 0.8, "h": 0.4, "classe": "a", "mascara": png_com(alfa)}]}, ["a"], True)
        numeros = linha.split()
        pontos = {(round(float(a), 3), round(float(b), 3)) for a, b in zip(numeros[1::2], numeros[2::2])}
        self.assertEqual(pontos, {(0.2, 0.5), (0.4, 0.5), (0.4, 0.7), (0.6, 0.7), (0.6, 0.9), (0.2, 0.9)})
        # pedaço solto grande (objeto tapado no meio): entra no mesmo polígono, ligado por uma ponte
        alfa.paste(255, (60, 0, 80, 40))
        linhas = linhas_yolo({"caixas": [{"x": 0, "y": 0, "w": 1, "h": 1, "classe": "a", "mascara": png_com(alfa)}]}, ["a"], True).splitlines()
        self.assertEqual(len(linhas), 1)
        self.assertEqual(max(float(v) for v in linhas[0].split()[1::2]), 1.0)
        # retângulo sem silhueta: os 4 cantos
        self.assertEqual(linhas_yolo({"caixas": [{"x": 0.1, "y": 0.2, "w": 0.2, "h": 0.6, "classe": "a"}]}, ["a"], True),
                         "0 0.100000 0.200000 0.300000 0.200000 0.300000 0.800000 0.100000 0.800000\n")

    def test_importar_divide_em_lotes(self):
        with tempfile.TemporaryDirectory() as origem, tempfile.TemporaryDirectory() as destino:
            origem, destino = Path(origem), Path(destino)
            (origem / "sub").mkdir()
            for nome in ["a.jpg", "b.png", "c.jpg", "nota.txt", "sub/a.jpg"]:
                (origem / nome).write_bytes(b"x")
            (destino / "lote_007").mkdir()
            criados = importar(origem, 2, destino)
            self.assertEqual([p.name for p in criados], ["lote_008", "lote_009"])
            self.assertEqual(sum(len(list(p.iterdir())) for p in criados), 4)  # .txt fica de fora; nomes repetidos não se perdem


if __name__ == "__main__":
    unittest.main()
