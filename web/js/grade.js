// --- Lotes e grade de fotos --------------------------------------------------------------------------------------------
async function carregarLotes() { S.lotes = await api('/api/lotes?modo=' + S.modo); }
function desenharLotes() {
  const atual = S.lotes.find(l => l.nome === S.lote);
  if (atual) atual.feitas = S.fotos.filter(rotulada).length;
  $('lotes').replaceChildren(...S.lotes.map(l => {
    const d = el('div', {className: 'lote' + (l === atual ? ' atual' : '')});
    const barra = el('div', {className: 'prog'}); barra.append(el('i')); barra.firstChild.style.width = (l.total ? l.feitas / l.total * 100 : 0) + '%';
    d.append(el('small', {}, l.feitas + '/' + l.total), el('span', {}, l.nome.replace('_', ' ')), barra);
    d.onclick = () => abrirLote(l.nome);
    return d;
  }));
  if (!S.lotes.length) $('lotes').append(el('div', {className: 'vazio'}, 'Nenhum lote. Veja "Importar imagens" no README.'));
}
async function abrirLote(nome) {
  const fotos = await api('/api/lote?modo=' + S.modo + '&nome=' + encodeURIComponent(nome));
  S.fotos = fotos.map(f => ({...f, url: '/foto/' + encodeURIComponent(nome) + '/' + encodeURIComponent(f.arquivo)}));
  S.lote = nome;
  mostrarGrade();
}
// Exportar ou baixar planilha: primeiro a janela para escolher os lotes (só os que têm foto rotulada no modo em uso)
// e, na planilha, as classes; depois a ação.
function escolherLotes(botao, paraPlanilha) {
  const comFotos = S.lotes.filter(l => l.feitas > 0);
  if (!comFotos.length) return alert('Nenhuma foto rotulada no modo ' + $('m_' + S.modo).textContent + ' ainda.');
  const janela = $('escolha'), todos = $('escolha_todos'), marcas = [];
  $('escolha_titulo').textContent = paraPlanilha ? 'Baixar planilha' : 'Exportar para treino';
  $('escolha_texto').textContent = paraPlanilha ? 'Lotes na planilha (uma linha por foto):' : 'Lotes a exportar (cada um vira uma pasta no formato YOLO):';
  $('escolha_ok').textContent = paraPlanilha ? 'Baixar' : 'Exportar';
  $('escolha_bloco_classes').hidden = !paraPlanilha;
  const opcoes = [...classes().map(c => [c.nome, c.rotulo, true]), ...Object.entries(FOTO).map(([k, [nome]]) => [k, nome, false])];
  const escolhas = opcoes.map(([nome, , marcada]) => el('input', {type: 'checkbox', value: nome, checked: marcada}));
  $('escolha_classes').replaceChildren(...opcoes.map(([, rotulo], i) => { const l = el('label'); l.append(escolhas[i], ' ' + rotulo); return l; }));
  $('escolha_lotes').replaceChildren(...comFotos.map(l => {
    const linha = el('label'), marca = el('input', {type: 'checkbox', value: l.nome, checked: true});
    marca.onchange = () => todos.checked = marcas.every(m => m.checked);
    marcas.push(marca); linha.append(marca, ' ' + l.nome.replace('_', ' '), el('small', {}, l.feitas + ' rotuladas'));
    return linha;
  }));
  todos.checked = true; todos.onchange = () => marcas.forEach(m => m.checked = todos.checked);
  janela.onclose = () => {
    if (janela.returnValue !== 'salvar') return;
    const lotes = marcas.filter(m => m.checked).map(m => m.value);
    if (!lotes.length) return alert('Nenhum lote escolhido; nada foi ' + (paraPlanilha ? 'baixado.' : 'exportado.'));
    paraPlanilha ? baixarPlanilha(botao, lotes, escolhas.filter(m => m.checked).map(m => m.value)) : exportar(botao, lotes);
  };
  janela.returnValue = ''; janela.showModal();
}
async function baixarPlanilha(botao, lotes, nomes) {
  if (!nomes.length) return alert('Nenhuma classe escolhida; nada foi baixado.');
  botao.disabled = true;
  try {
    const q = new URLSearchParams([['modo', S.modo], ...lotes.map(l => ['lote', l]), ...nomes.map(c => ['classe', c])]);
    const r = await fetch('/api/planilha?' + q);
    if (!r.ok) throw new Error((await r.json()).erro || 'Falha');
    const agora = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString();  // hora local no nome
    const a = el('a', {href: URL.createObjectURL(await r.blob()), download: 'lince-' + S.modo + '-' + agora.slice(0, 16).replace(/[-:]/g, '').replace('T', '-') + '.csv'});
    a.click(); URL.revokeObjectURL(a.href);
  } catch (e) { alert('Não baixou: ' + e.message); } finally { botao.disabled = false; }
}
async function exportar(botao, lotes) {
  botao.disabled = true;
  try {
    const d = await api('/api/exportar', {modo: S.modo, lotes}), f = d.fotos;
    alert(lotes.length + (lotes.length > 1 ? ' lotes exportados' : ' lote exportado') + ': ' + (f.train + f.valid + f.test) + ' fotos (treino ' + f.train + ', validação ' + f.valid + ', teste ' + f.test + ').\n\n' + d.pasta);
  } catch (e) { alert('Não exportou: ' + e.message); } finally { botao.disabled = false; }
}
function mostrarGrade() {
  $('anotador').hidden = true; $('grade').hidden = false;
  $('onde').textContent = S.lote ? '· ' + S.lote.replace('_', ' ') : '';
  desenharLotes();
  const lista = filtros(), escolha = el('select', {title: 'Quais fotos do lote aparecem'});
  if (!lista[S.filtro]) S.filtro = 'todas';
  for (const [chave, [nome, teste]] of Object.entries(lista)) {
    const n = S.fotos.filter(teste).length;
    if (!n && chave !== 'todas' && chave !== S.filtro) continue;  // filtro vazio não aparece
    escolha.append(el('option', {value: chave, selected: chave === S.filtro}, nome + ' (' + n + ')'));
  }
  escolha.onchange = () => { S.filtro = escolha.value; mostrarGrade(); };
  const botao = el('button', {className: 'principal', title: 'Grava (ou refaz) a pasta de treino de cada lote escolhido'}, 'Exportar para treino');
  botao.onclick = () => escolherLotes(botao);
  const planilha = el('button', {title: 'Planilha (Excel) das fotos com as classes escolhidas, com a contagem de cada uma'}, 'Baixar planilha');
  planilha.onclick = () => escolherLotes(planilha, true);
  $('filtros').replaceChildren(el('span', {}, 'Mostrar'), escolha, el('span', {className: 'esp'}), planilha, botao);
  const grade = $('miniaturas'); grade.replaceChildren();
  if (!S.lote) return grade.append(el('div', {className: 'vazio'}, 'Escolha um lote à esquerda.'));
  S.fotos.forEach((f, i) => {
    if (!lista[S.filtro][1](f)) return;
    const m = el('div', {className: 'mini' + (rotulada(f) ? ' rotulada' : '')});
    m.append(el('img', {src: f.url, loading: 'lazy'}));
    const resumo = f.r?.foto ? FOTO[f.r.foto][0] : (f.r?.caixas || []).map(c => classe(c.classe)?.rotulo || '?').join(', ');
    if (resumo) m.append(el('span', {}, resumo));
    m.onclick = () => abrirFoto(i); grade.append(m);
  });
  if (!grade.children.length) grade.append(el('div', {className: 'vazio'}, 'Nenhuma foto neste filtro.'));
}
