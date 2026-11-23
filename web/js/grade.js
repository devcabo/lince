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
// Exportar: primeiro a janela para escolher os lotes (só os que têm foto rotulada no modo em uso), depois a exportação.
function escolherLotes(botao) {
  const comFotos = S.lotes.filter(l => l.feitas > 0);
  if (!comFotos.length) return alert('Nenhuma foto rotulada no modo ' + $('m_' + S.modo).textContent + ' ainda.');
  const janela = $('escolha'), todos = $('escolha_todos'), marcas = [];
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
    lotes.length ? exportar(botao, lotes) : alert('Nenhum lote escolhido; nada foi exportado.');
  };
  janela.returnValue = ''; janela.showModal();
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
  $('filtros').replaceChildren(el('span', {}, 'Mostrar'), escolha, el('span', {className: 'esp'}), botao);
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
