# Lince

**Rotulador local de imagens para ensinar modelos de visão computacional.**
Marque objetos com **polígonos** (segmentação) ou **bounding boxes** (detecção), escolha as classes que quiser
e exporte direto no formato **YOLO**, pronto para treinar.

- **Dois modos na mesma tela:** Polígono e Bounding box. Cada um tem as suas classes e os seus rótulos.
- **Classes configuráveis** num único arquivo `classes.json`. As teclas 1 a 9 seguem a ordem das classes.
- **Seleção por clique (SAM):** no modo Polígono, um clique no objeto devolve a silhueta pronta. É opcional; sem ela, você desenha retângulos à mão.
- **Salva sozinho** a cada mudança, numa gravação atômica (uma queda de energia não corrompe o arquivo).
- **Exportação YOLO** com divisão treino/validação/teste (80/10/10) estável por arquivo.
- **100% local:** o servidor só escuta em `127.0.0.1`, e nenhuma imagem sai do computador.
- **Leve:** Python com biblioteca padrão + Pillow + NumPy, e a interface em HTML/JS puro, sem build.

## Começando

Requisitos: Python 3.10 ou mais novo.

```bash
git clone https://github.com/devcabo/lince.git
cd lince
python -m venv .venv
# Windows: .venv\Scripts\activate    Linux/macOS: source .venv/bin/activate
pip install -r requirements.txt
pip install -r requirements-sam.txt   # opcional: seleção por clique no modo Polígono
```

1. **Defina as classes** em `classes.json` (veja [Classes](#classes)).
2. **Importe as imagens**, que serão divididas em lotes:
   ```bash
   python -m lince.importar caminho/das/imagens --por-lote 100
   ```
3. **Abra o rotulador.** O navegador abre sozinho em `http://127.0.0.1:8090`.
   ```bash
   python -m lince            # opções: --porta 8090  --sem-navegador
   ```
4. **Rotule** e clique em **Exportar para treino**. Para exportar pela linha de comando:
   ```bash
   python -m lince.exportar bounding_box            # todos os lotes
   python -m lince.exportar poligono lote_001 lote_002
   ```

## Classes

O arquivo `classes.json` tem uma lista por modo, com 1 a 9 classes cada. As teclas 1 a 9 seguem a ordem da lista.

```json
{
  "poligono":     [{"nome": "pessoa", "rotulo": "Pessoa", "cor": "#dc2626"}],
  "bounding_box": [{"nome": "veiculo", "rotulo": "Veículo", "cor": "#2563eb"}]
}
```

| Campo | Para que serve |
|---|---|
| `nome` | identificador da classe; é o nome que vai para o `data.yaml` |
| `rotulo` | texto que aparece nos botões da tela |
| `cor` | cor da marcação na foto |

> A ordem das classes define o número de cada uma no YOLO. Se você mudar a ordem depois de rotular, exporte de novo.

## Como rotular

| Ação | Como |
|---|---|
| Selecionar um objeto (Polígono) | clique nele, ou arraste um retângulo em volta |
| Somar outro pedaço ao mesmo objeto (Polígono) | Shift+clique |
| Desenhar uma caixa (Bounding box) | arraste um retângulo |
| Escolher a classe | teclas **1** a **9**, ou os botões da barra |
| Foto sem nenhum objeto | **S**: vira exemplo negativo, com `.txt` vazio |
| Foto ilegível | **I**: fica de fora da exportação |
| Mover um quadrado | arraste (em Bounding box, clique nele antes para selecionar) |
| Tirar um quadrado | **×** no canto, ou **Delete** |
| Próxima foto a rotular | **E** |
| Foto anterior / seguinte | setas **←** / **→** |
| Zoom / arrastar a foto / foto inteira | roda do mouse / botão direito / **Z** |
| Trocar de modo | **T** |
| Voltar à grade do lote | **Esc** |

Na grade, o seletor **Mostrar** filtra as fotos por situação (a rotular / rotuladas), por classe, sem objeto ou ilegível.

## Saída (formato YOLO)

```
dados/treino/<modo>/<lote>/
├── data.yaml                 caminhos relativos + nomes das classes
├── images/{train,valid,test}/
└── labels/{train,valid,test}/   um .txt por foto, coordenadas em frações (0 a 1)
```

| Modo | Linha do `.txt` | Treina com |
|---|---|---|
| `bounding_box` | `classe x_centro y_centro largura altura` | YOLO detect |
| `poligono` | `classe x1 y1 x2 y2 ...` (contorno da silhueta) | YOLO segment |

Para treinar com o [Ultralytics](https://docs.ultralytics.com), por exemplo:
`yolo detect train data=dados/treino/bounding_box/lote_001/data.yaml model=yolo11n.pt`.

**Detalhes da exportação:**
- No modo Polígono, um retângulo sem silhueta é exportado como um polígono de 4 cantos.
- Uma silhueta com pedaços soltos vira um polígono só, com os pedaços ligados por uma ponte de largura zero.
- Buracos e ciscos menores que 1% do pedaço maior são descartados.

## Organização do projeto

```
lince/
├── classes.json            classes de cada modo (edite aqui)
├── lince/                  pacote Python (servidor e regras)
│   ├── __main__.py         `python -m lince`: sobe o servidor e abre o navegador
│   ├── servidor.py         HTTP local: tela, fotos e API JSON
│   ├── armazenamento.py    caminhos, classes, leitura e gravação dos rótulos
│   ├── sam.py              seleção por clique (Segment Anything), opcional
│   ├── exportar.py         exportação YOLO (caixas e polígonos)
│   └── importar.py         divide uma pasta de imagens em lotes
├── web/                    interface (HTML/CSS/JS puro, sem build)
│   ├── index.html
│   ├── estilo.css
│   └── js/
│       ├── estado.js       estado da tela, classes e chamadas à API
│       ├── grade.js        lista de lotes, grade de fotos e exportação
│       ├── anotador.js     foto aberta: desenho, barra e gravação
│       └── entrada.js      mouse, teclado e início
├── testes/test_lince.py
└── dados/                  criado no uso, fora do git
    ├── lotes/<lote>/       as imagens
    ├── rotulos/<modo>/<lote>.json
    ├── cache-sam/          leitura das fotos pelo SAM (pode apagar)
    └── treino/<modo>/<lote>/   saída YOLO
```

### Formato dos rótulos

Os rótulos ficam em `dados/rotulos/<modo>/<lote>.json`, com uma entrada por foto e coordenadas em frações da foto:

```json
{
  "foto_01.jpg": {
    "caixas": [{"x": 0.1, "y": 0.2, "w": 0.3, "h": 0.5, "classe": "veiculo", "mascara": "data:image/png;base64,..."}],
    "foto": "",
    "quando": "2026-01-01T12:00:00.000Z"
  }
}
```

`mascara` só existe no modo Polígono e guarda a silhueta recortada no retângulo. `foto` vale `sem_objeto`,
`ilegivel` ou vazio.

## Seleção por clique (SAM)

No modo Polígono, o Lince usa o [SlimSAM](https://huggingface.co/Zigeng/SlimSAM-uniform-77), uma versão enxuta do
Segment Anything, que roda em CPU:

- **Primeira vez:** o modelo é baixado do Hugging Face (cerca de 40 MB) e fica no cache.
- **Cada foto:** é "lida" uma vez, em cerca de 10 s em CPU, em segundo plano e com a próxima foto adiantada. A leitura fica guardada em `dados/cache-sam/`.
- **Depois disso:** cada clique responde em menos de 1 s.
- **Sem `torch`/`transformers`:** o topo da tela mostra "Seleção por clique: indisponível" e o resto funciona normalmente.

## Testes

```bash
python -m unittest discover testes
```

## Licença

[MIT](LICENSE)
