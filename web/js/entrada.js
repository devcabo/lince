// --- Mouse e teclado ---------------------------------------------------------------------------------------------------
// Clique = selecionar o objeto (SAM, modo Polígono). Arrastar no vazio = retângulo novo. Arrastar um quadrado = mover. × = tirar.
// Em Bounding box não há SAM, e só o quadrado selecionado se move: assim dá para desenhar um quadrado por cima de outro.
const arrastavel = k => k >= 0 && (S.modo === 'poligono' || k === S.sel);
const naFoto = (px, py) => [(px - S.v.x) / (S.img.width * S.v.s), (py - S.v.y) / (S.img.height * S.v.s)];  // ponto da tela -> fração da foto
const noX = (px, py) => S.r.caixas.findIndex(c => c._x && px >= c._x[0] && px <= c._x[0] + 20 && py >= c._x[1] && py <= c._x[1] + 20);
function caixaEm(px, py) {  // menor quadrado sob o ponteiro, ou -1
  const [fx, fy] = naFoto(px, py);
  return S.r.caixas.reduce((melhor, c, k) => fx >= c.x && fx <= c.x + c.w && fy >= c.y && fy <= c.y + c.h && (melhor < 0 || c.w * c.h < S.r.caixas[melhor].w * S.r.caixas[melhor].h) ? k : melhor, -1);
}
const longe = (e, p) => Math.hypot(e.offsetX - p.x, e.offsetY - p.y) > 5;  // passou de clique para arrasto
let apertado = null, movendo = null;  // botão esquerdo apertado (com o quadrado sob ele, se houver); botão direito arrastando a foto

tela.oncontextmenu = e => e.preventDefault();
tela.onmousedown = e => {
  if (!S.img) return;
  if (e.button === 2) movendo = {mx: e.offsetX, my: e.offsetY, x: S.v.x, y: S.v.y};
  if (e.button !== 0) return;
  const k = caixaEm(e.offsetX, e.offsetY), c = noX(e.offsetX, e.offsetY) < 0 && arrastavel(k) ? S.r.caixas[k] : null;
  apertado = {x: e.offsetX, y: e.offsetY, ...(c ? {caixa: c, x0: c.x, y0: c.y} : {})};
};
tela.onmousemove = e => {
  if (movendo) { S.v.x = movendo.x + e.offsetX - movendo.mx; S.v.y = movendo.y + e.offsetY - movendo.my; return desenhar(); }
  if (!S.img) return;
  if (!apertado) {  // cursor: × e quadrado ainda não selecionado = clicar; quadrado que se move = mover
    const k = caixaEm(e.offsetX, e.offsetY);
    if (!S.ocupado) tela.style.cursor = noX(e.offsetX, e.offsetY) >= 0 ? 'pointer' : arrastavel(k) ? 'move' : k >= 0 ? 'pointer' : 'crosshair';
    return;
  }
  if (!apertado.moveu && !longe(e, apertado)) return;
  const c = apertado.caixa;
  if (c) {  // move o quadrado, sem sair da foto
    c.x = Math.min(1 - c.w, Math.max(0, apertado.x0 + (e.offsetX - apertado.x) / (S.img.width * S.v.s)));
    c.y = Math.min(1 - c.h, Math.max(0, apertado.y0 + (e.offsetY - apertado.y) / (S.img.height * S.v.s)));
    apertado.moveu = true; S.sel = S.r.caixas.indexOf(c);
  } else S.arrasto = {x0: apertado.x, y0: apertado.y, x1: e.offsetX, y1: e.offsetY};
  desenhar();
};
window.onmouseup = e => {
  movendo = null;
  if (!apertado || !S.img) return;
  const inicio = apertado, a = S.arrasto; apertado = null; S.arrasto = null;
  if (inicio.moveu) { delete inicio.caixa.pontos; return mudou(); }
  if (a) {  // retângulo novo
    const [x0, y0] = naFoto(Math.min(a.x0, a.x1), Math.min(a.y0, a.y1)), [x1, y1] = naFoto(Math.max(a.x0, a.x1), Math.max(a.y0, a.y1));
    const c = {x: Math.max(0, x0), y: Math.max(0, y0), classe: ''}; c.w = Math.min(1, x1) - c.x; c.h = Math.min(1, y1) - c.y;
    if (c.w < 0.004 || c.h < 0.004) return desenhar();
    const porCima = S.modo === 'bounding_box' && caixaEm(a.x0, a.y0) >= 0;  // começou dentro de um quadrado que já existia
    S.r.caixas.push(c); S.sel = S.r.caixas.length - 1; S.r.foto = ''; mudou();
    if (porCima) aviso('Quadrado novo: escolha a classe, ou tire no ×. Para mover um quadrado que já existe, clique nele e depois arraste.');
    return S.modo === 'poligono' ? selecionarComSam({caixa: [c.x, c.y, c.x + c.w, c.y + c.h]}, c, 'Ajustando na silhueta do objeto…') : undefined;
  }
  if (noX(inicio.x, inicio.y) >= 0) return apagar(noX(inicio.x, inicio.y));
  const [fx, fy] = naFoto(inicio.x, inicio.y);
  if (fx < 0 || fy < 0 || fx > 1 || fy > 1) return;
  const k = caixaEm(inicio.x, inicio.y);
  if (S.modo === 'bounding_box' || (k >= 0 && !e.shiftKey)) { S.sel = k; desenharBarra(); return desenhar(); }  // clique num quadrado: só seleciona
  if (S.sam !== 'pronto') return aviso(S.sam === 'carregando' ? 'A seleção por clique ainda está carregando; por enquanto, arraste um retângulo.' : 'Arraste um retângulo em volta do objeto.');
  const antiga = e.shiftKey && S.sel >= 0 ? S.r.caixas[S.sel] : null;  // Shift+clique soma um ponto ao objeto selecionado
  selecionarComSam({pontos: [...(antiga?.pontos || []), [fx, fy]]}, antiga, 'Selecionando o objeto…');
};
// Pede a silhueta ao SAM (por pontos ou dentro de um retângulo) e põe o resultado no lugar de `antiga`, ou como objeto novo.
async function selecionarComSam(pedido, antiga, mensagem) {
  if (S.sam !== 'pronto' || S.ocupado) return;
  const i = S.i;
  S.ocupado = true; tela.style.cursor = 'progress'; aviso(mensagem);
  try {
    const {caixa} = await api('/api/sam', {lote: S.lote, arquivo: S.fotos[i].arquivo, ...pedido});
    const k = antiga ? S.r.caixas.indexOf(antiga) : S.r.caixas.length;
    if (S.i !== i || k < 0) return;  // mudou de foto ou tirou o quadrado enquanto esperava
    if (!caixa) return aviso('Não achei um objeto aí. Tente outro ponto ou arraste um retângulo.');
    S.r.caixas[k] = {...caixa, classe: antiga?.classe || '', ...(pedido.pontos ? {pontos: pedido.pontos} : {})};
    S.sel = k; S.r.foto = ''; $('aviso').hidden = true; mudou();
  } catch (e) { aviso(e.message); } finally { S.ocupado = false; tela.style.cursor = 'crosshair'; }
}
tela.onwheel = e => {  // zoom em volta do ponteiro
  if (!S.img) return; e.preventDefault();
  const s = Math.min(S.v.base * 12, Math.max(S.v.base * 0.6, S.v.s * (e.deltaY < 0 ? 1.25 : 0.8))), r = s / S.v.s;
  S.v.x = e.offsetX - (e.offsetX - S.v.x) * r; S.v.y = e.offsetY - (e.offsetY - S.v.y) * r; S.v.s = s; desenhar();
};
window.onresize = () => { if (!$('anotador').hidden) { ajustar(); desenhar(); } };
window.onkeydown = e => {
  if ($('anotador').hidden || e.ctrlKey || e.altKey || e.metaKey) return;
  const t = e.key.toLowerCase(), c = classes()[Number(t) - 1], foto = Object.keys(FOTO).find(k => FOTO[k][1] === t);
  if (c && t !== '0') classificar(c.nome); else if (foto) marcarFoto(foto);
  else if (t === 'delete' || t === 'backspace') apagar();
  else if (t === 'e' || t === 'enter') proxima();
  else if (t === 'arrowright') vizinha(1); else if (t === 'arrowleft') vizinha(-1);
  else if (t === 'z') { ajustar(); desenhar(); }
  else if (t === 't') trocarModo(S.modo === 'bounding_box' ? 'poligono' : 'bounding_box');
  else if (t !== 'escape') return;
  else if (!apertado) mostrarGrade();
  else {  // Esc no meio do arrasto: cancela (e devolve o quadrado para onde estava)
    if (apertado.moveu) { apertado.caixa.x = apertado.x0; apertado.caixa.y = apertado.y0; }
    apertado = null; S.arrasto = null; desenhar();
  }
  e.preventDefault();
};

// --- Início ------------------------------------------------------------------------------------------------------------
(async () => {
  S.classes = (await api('/api/config')).classes;
  try { if (localStorage.getItem('modo') === 'bounding_box') S.modo = 'bounding_box'; } catch {}
  mostrarModo();
  await carregarLotes(); mostrarGrade();
  const verSam = async () => {
    S.sam = (await api('/api/estado')).sam;
    $('sam').textContent = {pronto: 'Seleção por clique: ligada', carregando: 'Seleção por clique: carregando…', indisponivel: 'Seleção por clique: indisponível'}[S.sam];
    if (S.sam === 'carregando') setTimeout(verSam, 3000);
  };
  verSam();
})();
