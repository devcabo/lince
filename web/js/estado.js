// --- Estado e servidor -------------------------------------------------------------------------------------------------
const $ = id => document.getElementById(id);
const FOTO = {sem_objeto: ['Sem objeto', 's'], ilegivel: ['Ilegível', 'i']};  // marcas da foto inteira: nome, tecla
// S.r é a cópia de trabalho do rótulo da foto aberta; S.v é o zoom e a posição da foto na tela.
const S = {classes: {}, modo: 'poligono', lotes: [], lote: '', fotos: [], filtro: 'todas', i: -1, r: null, sel: -1, sujo: false,
  img: null, v: {s: 1, x: 0, y: 0, base: 1}, sam: 'carregando', ocupado: false, arrasto: null};
// Classes do modo em uso, na ordem do classes.json: {nome, rotulo, cor}; a tecla é a posição + 1.
const classes = () => S.classes[S.modo];
const classe = nome => classes().find(c => c.nome === nome);
const unica = () => S.modo === 'poligono' && S.r.caixas.length === 1 ? 0 : -1;  // um objeto só: já fica selecionado

async function api(caminho, corpo) {
  const r = await fetch(caminho, corpo ? {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(corpo)} : undefined);
  const d = await r.json();
  if (!r.ok) throw new Error(d.erro || 'Falha');
  return d;
}
function el(tag, attrs = {}, texto = '') { const e = document.createElement(tag); Object.assign(e, attrs); if (texto) e.textContent = texto; return e; }
let relogioAviso;
function aviso(texto) { const a = $('aviso'); a.textContent = texto; a.hidden = false; clearTimeout(relogioAviso); relogioAviso = setTimeout(() => a.hidden = true, 3500); }

const rotulada = f => !!(f.r && (f.r.foto || f.r.caixas?.length));
function filtros() {  // {chave: [nome, teste da foto]}
  const tem = nome => f => (f.r?.caixas || []).some(c => c.classe === nome);
  return {todas: ['Todas', () => true], a_rotular: ['A rotular', f => !rotulada(f)], rotulada: ['Rotuladas', rotulada],
    ...Object.fromEntries(classes().map(c => ['classe_' + c.nome, [c.rotulo, tem(c.nome)]])),
    ...Object.fromEntries(Object.entries(FOTO).map(([k, [nome]]) => [k, [nome, f => f.r?.foto === k]]))};
}
