// --- Foto aberta: desenho, barra de botões e gravação ------------------------------------------------------------------
const tela = $('tela'), ctx = tela.getContext('2d');
function abrirFoto(i) {
  const f = S.fotos[i];
  Object.assign(S, {i, sujo: false, img: null, arrasto: null, revisando: rotulada(f)});
  S.r = JSON.parse(JSON.stringify(f.r || {}));
  S.r.caixas ||= []; S.r.foto ||= '';
  S.sel = unica();
  $('grade').hidden = true; $('anotador').hidden = false;
  const img = new Image();
  img.onload = () => { if (S.i === i) { S.img = img; ajustar(); desenhar(); } };
  img.src = f.url;
  if (S.modo === 'poligono') api('/api/preparar', {lote: S.lote, arquivos: [f.arquivo, S.fotos[i + 1]?.arquivo].filter(Boolean)}).catch(() => {});  // adianta a leitura do SAM
  desenharBarra(); desenhar();
}
function ajustar() {  // foto inteira, centralizada
  tela.width = tela.clientWidth; tela.height = tela.clientHeight;
  if (!S.img) return;
  const s = Math.min(tela.width / S.img.width, tela.height / S.img.height);
  S.v = {s, x: (tela.width - S.img.width * s) / 2, y: (tela.height - S.img.height * s) / 2, base: s};
}
// Redesenha no máximo uma vez por quadro da tela: arrastar não trava.
let quadro = 0;
function desenhar() { if (!quadro) quadro = requestAnimationFrame(() => { quadro = 0; pintar(); }); }
function pintar() {
  ctx.clearRect(0, 0, tela.width, tela.height);
  if (!S.img) return;
  const W = S.img.width * S.v.s, H = S.img.height * S.v.s;
  ctx.drawImage(S.img, S.v.x, S.v.y, W, H);
  S.r.caixas.forEach((c, k) => {
    const cor = classe(c.classe)?.cor || '#9ca3af', x = S.v.x + c.x * W, y = S.v.y + c.y * H, w = c.w * W, h = c.h * H, selecionada = k === S.sel;
    const silhueta = pintada(c, cor);
    if (silhueta) { ctx.globalAlpha = selecionada ? 0.65 : 0.5; ctx.drawImage(silhueta, x, y, w, h); ctx.globalAlpha = 1; }
    if (!silhueta || selecionada) {  // com silhueta, o retângulo só aparece (fino, tracejado) no objeto selecionado
      ctx.lineWidth = silhueta ? 1 : (selecionada ? 3 : 2); ctx.strokeStyle = cor; ctx.setLineDash(c.classe && !silhueta ? [] : [6, 4]);
      ctx.strokeRect(x, y, w, h); ctx.setLineDash([]);
      if (!silhueta && selecionada) { ctx.fillStyle = cor + '33'; ctx.fillRect(x, y, w, h); }
    }
    const nome = classe(c.classe)?.rotulo || 'escolha a classe';
    ctx.font = '12px system-ui';
    ctx.fillStyle = cor; ctx.fillRect(x, y - 17, ctx.measureText(nome).width + 8, 17);
    ctx.fillStyle = '#fff'; ctx.fillText(nome, x + 4, y - 5);
    // Botão × no canto do quadrado; a posição fica em c._x para o clique saber onde ele está.
    const bx = Math.min(tela.width - 20, x + w - 10), by = Math.max(0, y - 10); c._x = [bx, by];
    ctx.fillStyle = '#111827'; ctx.fillRect(bx, by, 20, 20); ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(bx + 6, by + 6); ctx.lineTo(bx + 14, by + 14); ctx.moveTo(bx + 14, by + 6); ctx.lineTo(bx + 6, by + 14); ctx.stroke();
  });
  if (S.arrasto) { const a = S.arrasto; ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.setLineDash([4, 3]); ctx.strokeRect(a.x0, a.y0, a.x1 - a.x0, a.y1 - a.y0); ctx.setLineDash([]); }
}
// Silhueta (PNG transparente vindo do SAM) pintada com a cor da classe; refeita só quando a cor muda.
function pintada(c, cor) {
  if (!c.mascara) return null;
  if (c._cor === cor) return c._pintada;
  if (!c._img) { c._img = new Image(); c._img.onload = desenhar; c._img.src = c.mascara; }
  if (!c._img.complete || !c._img.naturalWidth) return null;
  const t = el('canvas', {width: c._img.naturalWidth, height: c._img.naturalHeight}), g = t.getContext('2d');
  g.drawImage(c._img, 0, 0); g.globalCompositeOperation = 'source-in'; g.fillStyle = cor; g.fillRect(0, 0, t.width, t.height);
  c._cor = cor; c._pintada = t; return t;
}
function desenharBarra() {
  const b = $('barra'); b.replaceChildren();
  const separador = () => b.append(el('span', {className: 'sep'}));
  const botao = (texto, tecla, ligado, acao, extra = '') => { const x = el('button', {className: (ligado ? 'ligado ' : '') + extra}, texto); x.append(el('kbd', {}, tecla)); x.onclick = acao; b.append(x); return x; };
  botao('← Lote', 'Esc', false, mostrarGrade);
  botao('Voltar', '←', false, () => vizinha(-1)).disabled = S.i === 0;
  b.append(el('span', {}, (S.i + 1) + ' / ' + S.fotos.length));
  botao('Avançar', '→', false, () => vizinha(1)).disabled = S.i === S.fotos.length - 1;
  separador();
  const atual = S.r.caixas[S.sel]?.classe;
  classes().forEach((c, k) => { const x = botao(c.rotulo, String(k + 1), atual === c.nome, () => classificar(c.nome)); if (atual === c.nome) x.style.cssText = 'background:' + c.cor + ';border-color:' + c.cor; });
  separador();
  for (const [c, [nome, tecla]] of Object.entries(FOTO)) botao(nome, tecla.toUpperCase(), S.r.foto === c, () => marcarFoto(c));
  if (S.sel >= 0) { separador(); botao('Tirar quadrado', 'Del', false, apagar); }
  b.append(el('span', {className: 'esp'}));
  botao('Próxima', 'E', false, proxima, 'principal');
}

function mudou() { S.sujo = true; desenharBarra(); desenhar(); salvar(false); }  // toda mudança tenta salvar na hora
function classificar(nome) {
  if (S.sel < 0) S.sel = unica();
  if (S.sel < 0) return aviso(S.modo === 'bounding_box' ? 'Arraste um retângulo primeiro, ou clique num quadrado para selecionar.' : 'Selecione um objeto primeiro (clique nele ou arraste um retângulo).');
  S.r.caixas[S.sel].classe = nome; S.r.foto = '';
  if (S.modo === 'bounding_box') S.sel = -1;  // solta o quadrado: o próximo arrasto desenha outro, mesmo por cima deste
  mudou();
}
function marcarFoto(c) {  // sem objeto / ilegível: liga ou desliga; ligada, tira os quadrados
  S.r.foto = S.r.foto === c ? '' : c;
  if (S.r.foto) { S.r.caixas = []; S.sel = -1; }
  mudou();
}
function apagar(k = S.sel) { if (k < 0) return; S.r.caixas.splice(k, 1); S.sel = unica(); mudou(); }

// Grava o rótulo da foto aberta. avisar = dizer o que falta; no salvamento automático a foto incompleta só espera.
async function salvar(avisar = true) {
  const f = S.fotos[S.i], vazia = !S.r.caixas.length && !S.r.foto, arredondar = v => Math.round(v * 10000) / 10000;
  if (S.r.caixas.some(c => !c.classe)) { if (avisar) aviso('Falta a classe de um quadrado: selecione o cinza e aperte o número da classe.'); return false; }
  if (vazia && avisar) { aviso('Marque um objeto, ou S (sem objeto), ou I (ilegível).'); return false; }
  if (vazia && !f.r) return false;
  f.r = vazia ? null : {  // tirou tudo: a foto volta a ficar sem rótulo
    caixas: S.r.caixas.map(c => ({x: arredondar(c.x), y: arredondar(c.y), w: arredondar(c.w), h: arredondar(c.h), classe: c.classe, ...(c.mascara ? {mascara: c.mascara} : {})})),
    foto: S.r.foto, quando: new Date().toISOString()};
  try { await api('/api/rotulo', {modo: S.modo, lote: S.lote, arquivo: f.arquivo, r: f.r}); } catch (e) { aviso('Não salvou: ' + e.message); return false; }
  S.sujo = false;
  if (!avisar && f.r) aviso('Salvo');
  return true;
}
async function proxima() {  // confirma esta foto e abre a próxima que ainda não está rotulada
  if (S.revisando) {  // foto que já estava rotulada: revisão, segue na ordem do lote e só regrava se algo mudou
    if (S.sujo && !await salvar()) return;
    return S.i + 1 < S.fotos.length ? abrirFoto(S.i + 1) : mostrarGrade();
  }
  if (!await salvar()) return;
  const n = S.fotos.length;
  for (let k = 1; k <= n; k++) { const j = (S.i + k) % n; if (!rotulada(S.fotos[j])) return abrirFoto(j); }
  mostrarGrade(); alert('Lote concluído: todas as fotos estão rotuladas.');
}
async function vizinha(d) {  // setas: foto anterior ou seguinte, sem confirmar nada
  if (S.sujo && !await salvar(false)) return;
  const j = S.i + d; if (j >= 0 && j < S.fotos.length) abrirFoto(j);
}
async function trocarModo(m) {
  if (m === S.modo || (!$('anotador').hidden && S.sujo && !await salvar(false))) return;
  S.modo = m; S.filtro = 'todas';
  try { localStorage.setItem('modo', m); } catch {}  // só para lembrar o modo na próxima vez
  mostrarModo();
  await carregarLotes();
  if (S.lote) await abrirLote(S.lote); else mostrarGrade();  // mesmo lote, com os rótulos do outro modo
}
function mostrarModo() {
  for (const m of ['poligono', 'bounding_box']) $('m_' + m).className = m === S.modo ? 'ligado' : '';
  const teclas = classes().map((c, k) => (k + 1) + ' = ' + c.rotulo).join(', ');
  $('dica').textContent = (S.modo === 'bounding_box'
    ? 'Arraste um retângulo em volta do objeto e aperte a tecla da classe (' + teclas + '). Clique num quadrado para selecionar; selecionado, arrastar move.'
    : 'Clique no objeto (Shift+clique soma um ponto) ou arraste um retângulo em volta dele; depois a tecla da classe (' + teclas + '). Arrastar um quadrado move.')
    + ' Salva sozinho. S = sem objeto, I = ilegível, × ou Delete tira, Esc cancela o arrasto. Roda do mouse = zoom, botão direito = arrastar a foto, Z = foto inteira, setas = anterior e seguinte, E = próxima a rotular, T = troca o modo.';
}
