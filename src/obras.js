// ===== OBRAS =====
import { DB } from './firebase.js';
import { escapeHtml, escapeAttr, setOptions } from './utils.js';

// Estado global
window.obras = window.obras || [];
Object.defineProperty(window, 'obras', {
  get() { return this._obras || []; },
  set(v) { this._obras = v; }
});

// ===== FILTRO ATUAL =====
let filtroObrasStatus = 'todos'; // 'todos' | 'execucao' | 'finalizada'
let obraDetalheId = null;
let obraCalendarioMesAtual = {};

function normalizarTexto(v = '') {
  return String(v || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function formatarDataObra(data) {
  return data ? new Date(data + 'T12:00:00').toLocaleDateString('pt-BR') : '-';
}

function moedaObra(valor) {
  return (Number(valor) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function totalOrcamentoObra(orc) {
  const direto = Number(orc?.totalComDesconto);
  if (Number.isFinite(direto) && direto > 0) return direto;
  const subtotal = Number(orc?.subtotal);
  if (Number.isFinite(subtotal) && subtotal > 0) {
    const desconto = Number(orc?.desconto) || 0;
    return desconto ? subtotal * (1 - desconto / 100) : subtotal;
  }
  return (orc?.linhas || []).reduce((acc, linha) => {
    if (!linha || linha.tipo === 'cabecalho' || linha.tipo === 'imagem' || linha.tipo === 'opcao') return acc;
    const total = Number(linha.total);
    if (Number.isFinite(total)) return acc + total;
    return acc + (Number(linha.totalMaterial) || 0) + (Number(linha.totalMaoObra) || 0);
  }, 0);
}

function getRelatoriosDaObra(obra) {
  const nome = normalizarTexto(obra?.nome);
  return (window.relatorios || []).filter(rel => {
    if (rel.obraId && rel.obraId === obra.id) return true;
    return nome && normalizarTexto(rel.obra) === nome;
  }).sort((a, b) => (a.data || '').localeCompare(b.data || ''));
}

function getAgendamentosDaObra(obra) {
  const nome = normalizarTexto(obra?.nome);
  const construtora = normalizarTexto(obra?.construtora);
  return (window.agendamentos || []).filter(ag => {
    if (ag.obraId && ag.obraId === obra.id) return true;
    const texto = normalizarTexto([ag.cliente, ag.local, ag.obs].filter(Boolean).join(' '));
    return (nome && texto.includes(nome)) || (construtora && texto.includes(construtora));
  }).sort((a, b) => (a.data || '').localeCompare(b.data || '') || (a.hora || '').localeCompare(b.hora || ''));
}

function getOrcamentosDaObra(obra) {
  const nome = normalizarTexto(obra?.nome);
  const construtora = normalizarTexto(obra?.construtora);
  return (window._orcamentosFirestore || []).filter(orc => {
    if (orc.obraId && orc.obraId === obra.id) return true;
    const texto = normalizarTexto([orc.obra, orc.assunto, orc.cliente, orc.endereco].filter(Boolean).join(' '));
    return (nome && texto.includes(nome)) || (construtora && texto.includes(construtora));
  }).sort((a, b) => (b.data || b.savedAt || '').localeCompare(a.data || a.savedAt || ''));
}

function getMesBaseCronogramaObra(obra, rels = [], agendamentosObra = []) {
  const base = rels.find(r => r.data)?.data || agendamentosObra.find(a => a.data)?.data || obra.data || new Date().toISOString().slice(0, 10);
  const chaveSalva = obraCalendarioMesAtual[obra.id];
  const chave = chaveSalva || base.slice(0, 7);
  const [ano, mes] = chave.split('-').map(Number);
  if (!ano || !mes) return new Date(base + 'T12:00:00');
  return new Date(ano, mes - 1, 1, 12, 0, 0);
}

function mudarMesCronogramaObra(obraId, delta) {
  const obra = obras.find(o => o.id === obraId);
  if (!obra) return;
  const rels = getRelatoriosDaObra(obra);
  const ags = getAgendamentosDaObra(obra);
  const atual = getMesBaseCronogramaObra(obra, rels, ags);
  atual.setMonth(atual.getMonth() + delta);
  obraCalendarioMesAtual[obraId] = `${atual.getFullYear()}-${String(atual.getMonth() + 1).padStart(2, '0')}`;
  renderizarDetalheObra(obraId);
}

function renderMiniCalendarioObra(obra, rels, agendamentosObra = []) {
  const d = getMesBaseCronogramaObra(obra, rels, agendamentosObra);
  const ano = d.getFullYear();
  const mes = d.getMonth();
  const mesStr = String(mes + 1).padStart(2, '0');
  const primeiroDia = new Date(ano, mes, 1).getDay();
  const totalDias = new Date(ano, mes + 1, 0).getDate();
  const eventosPorDia = {};

  rels.forEach(rel => {
    if (!rel.data || !rel.data.startsWith(`${ano}-${mesStr}`)) return;
    const dia = Number(rel.data.slice(8, 10));
    eventosPorDia[dia] = eventosPorDia[dia] || [];
    eventosPorDia[dia].push({ tipo: 'relatorio', label: rel.funcionariosNomes || rel.funcionarioNome || rel.obra || 'Relatório' });
  });

  agendamentosObra.forEach(ag => {
    if (!ag.data || !ag.data.startsWith(`${ano}-${mesStr}`)) return;
    const dia = Number(ag.data.slice(8, 10));
    eventosPorDia[dia] = eventosPorDia[dia] || [];
    eventosPorDia[dia].push({ tipo: 'agendamento', label: `${ag.hora ? ag.hora.slice(0, 5) + ' ' : ''}${ag.cliente || 'Agendamento'}` });
  });

  const vazios = Array.from({ length: primeiroDia }, () => '<div class="obra-cal-dia vazio"></div>').join('');
  const dias = Array.from({ length: totalDias }, (_, i) => {
    const dia = i + 1;
    const dataStr = `${ano}-${mesStr}-${String(dia).padStart(2, '0')}`;
    const lista = eventosPorDia[dia] || [];
    return `<button type="button" class="obra-cal-dia ${lista.length ? 'com-relatorio' : ''}" onclick="abrirMenuDiaObra('${escapeAttr(obra.id)}', '${escapeAttr(dataStr)}')">
      <strong>${dia}</strong>
      ${lista.slice(0, 2).map(ev => `<span class="${escapeAttr(ev.tipo)}">${escapeHtml(ev.label)}</span>`).join('')}
      ${lista.length > 2 ? `<em>+${lista.length - 2}</em>` : ''}
    </button>`;
  }).join('');

  return `<div class="obra-calendario">
    <div class="obra-cal-topo">
      <button type="button" class="obra-cal-nav" aria-label="Mes anterior" onclick="mudarMesCronogramaObra('${escapeAttr(obra.id)}', -1)">&lsaquo;</button>
      <span>${d.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })}</span>
      <button type="button" class="obra-cal-nav" aria-label="Proximo mes" onclick="mudarMesCronogramaObra('${escapeAttr(obra.id)}', 1)">&rsaquo;</button>
    </div>
    <div class="obra-cal-grid">
      ${['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'].map(x => `<div class="obra-cal-semana">${x}</div>`).join('')}
      ${vazios}${dias}
    </div>
  </div>`;
}

// ===== RENDERIZAR OBRAS =====
function renderizarObras() {
  if (obraDetalheId) {
    renderizarDetalheObra(obraDetalheId);
    return;
  }

  let lista = [...obras];
  if (filtroObrasStatus === 'execucao')  lista = lista.filter(o => o.status !== 'finalizada');
  if (filtroObrasStatus === 'finalizada') lista = lista.filter(o => o.status === 'finalizada');

  lista.sort((a, b) => (b.data || '').localeCompare(a.data || ''));

  // Atualizar botões de filtro
  document.querySelectorAll('.obras-filtro-btn').forEach(btn => {
    btn.classList.toggle('ativo', btn.dataset.filtro === filtroObrasStatus);
  });

  const cont = document.getElementById('obras-lista');
  if (!cont) return;

  if (lista.length === 0) {
    cont.innerHTML = `<div class="hist-vazio"><div class="icone">🏗️</div><p>Nenhuma obra cadastrada.</p></div>`;
    return;
  }

  cont.innerHTML = lista.map(obra => {
    const dataFmt = obra.data ? new Date(obra.data + 'T00:00:00').toLocaleDateString('pt-BR') : '-';
    const isFinali = obra.status === 'finalizada';
    return `<div class="obra-card ${isFinali ? 'finalizada' : ''}" onclick="abrirDetalheObra('${escapeAttr(obra.id)}')">
      <div class="obra-card-header">
        <div class="obra-card-info">
          <div class="obra-card-nome">🏗️ ${escapeHtml(obra.nome)}</div>
          <div class="obra-card-meta">🏢 ${escapeHtml(obra.construtora || '-')}</div>
          ${(obra.responsavel || obra.contatoResponsavel) ? `<div class="obra-card-meta">Responsável: ${escapeHtml(obra.responsavel || '-')}${obra.contatoResponsavel ? ' · ' + escapeHtml(obra.contatoResponsavel) : ''}</div>` : ''}
          <div class="obra-card-meta">📍 ${escapeHtml(obra.local || '-')} · 📅 ${dataFmt}</div>
        </div>
        <div class="obra-status-badge ${isFinali ? 'finalizada' : 'execucao'}">
          ${isFinali ? 'Finalizada' : 'Em Execução'}
        </div>
      </div>
      <div class="obra-card-acoes">
        <button class="btn-mini editar" onclick="event.stopPropagation();editarObra('${escapeAttr(obra.id)}')">Editar</button>
        ${isFinali
          ? `<button class="btn-mini ver" onclick="event.stopPropagation();marcarObraExecucao('${escapeAttr(obra.id)}')">Reabrir</button>`
          : `<button class="btn-mini" style="background:#e8f5e9;color:#2e7d32;border:none;" onclick="event.stopPropagation();marcarObraFinalizada('${escapeAttr(obra.id)}')">Finalizar</button>`
        }
        <button class="btn-mini excluir" onclick="event.stopPropagation();confirmarExcluirObra('${escapeAttr(obra.id)}')">Excluir</button>
      </div>
    </div>`;
  }).join('');
}

function abrirDetalheObra(id) {
  obraDetalheId = id;
  renderizarDetalheObra(id);
}

function voltarListaObras() {
  obraDetalheId = null;
  renderizarObras();
}

function abrirOrcamentoAtrelado(id) {
  if (!id) return;
  window.editarOrcamento?.(id);
}

function renderizarDetalheObra(id) {
  const obra = obras.find(o => o.id === id);
  const cont = document.getElementById('obras-lista');
  if (!obra || !cont) {
    obraDetalheId = null;
    renderizarObras();
    return;
  }

  const rels = getRelatoriosDaObra(obra);
  const ags = getAgendamentosDaObra(obra);
  const orcs = getOrcamentosDaObra(obra);
  const rendimento = rels.reduce((acc, rel) => acc + (Number(rel.rendimento) || 0), 0);
  const totalOrcamentos = orcs.reduce((acc, orc) => acc + totalOrcamentoObra(orc), 0);
  const isFinali = obra.status === 'finalizada';

  cont.innerHTML = `<div class="obra-detalhe">
    <div class="obra-detalhe-topo">
      <button class="btn-secundario" type="button" onclick="voltarListaObras()">← Voltar</button>
      <div class="obra-status-badge ${isFinali ? 'finalizada' : 'execucao'}">${isFinali ? 'Finalizada' : 'Em Execução'}</div>
    </div>
    <div class="obra-detalhe-hero">
      <div>
        <h3>${escapeHtml(obra.nome || 'Obra')}</h3>
        <p>${escapeHtml(obra.construtora || '-')} · ${escapeHtml(obra.local || '-')} · ${formatarDataObra(obra.data)}</p>
        ${(obra.responsavel || obra.contatoResponsavel) ? `<p>Responsável: ${escapeHtml(obra.responsavel || '-')}${obra.contatoResponsavel ? ' · ' + escapeHtml(obra.contatoResponsavel) : ''}</p>` : ''}
      </div>
      <div class="obra-detalhe-acoes">
        <button class="btn-mini editar" onclick="editarObra('${escapeAttr(obra.id)}')">Editar</button>
        ${isFinali
          ? `<button class="btn-mini ver" onclick="marcarObraExecucao('${escapeAttr(obra.id)}')">Reabrir</button>`
          : `<button class="btn-mini" style="background:#e8f5e9;color:#2e7d32;border:none;" onclick="marcarObraFinalizada('${escapeAttr(obra.id)}')">Finalizar</button>`}
      </div>
    </div>

    <div class="obra-resumo-grid">
      <div class="obra-resumo-card"><span>Relatórios de obra</span><strong>${rels.length}</strong></div>
      <div class="obra-resumo-card"><span>Rendimento registrado</span><strong>${moedaObra(rendimento)}</strong></div>
      <div class="obra-resumo-card"><span>Orçamentos atrelados</span><strong>${orcs.length}</strong></div>
      <div class="obra-resumo-card"><span>Total orçado</span><strong>${moedaObra(totalOrcamentos)}</strong></div>
    </div>

    <section class="obra-detalhe-section">
      <h4>Or?amentos atrelados</h4>
      ${orcs.length ? `<div class="obra-orc-lista">${orcs.map(orc => `<button type="button" class="obra-orc-item" onclick="abrirOrcamentoAtrelado('${escapeAttr(orc.id)}')">
        <div class="obra-orc-main">
          <div><strong>#${String(orc.numero || '').padStart(3, '0')}</strong> ${escapeHtml(orc.cliente || 'Or?amento')}</div>
          <small>${escapeHtml(orc.assunto || orc.obra || 'Sem assunto informado')}</small>
        </div>
        <span>${formatarDataObra(orc.data)} ? ${moedaObra(totalOrcamentoObra(orc))}</span>
      </button>`).join('')}</div>` : '<div class="obra-vazio">Nenhum or?amento relacionado a esta obra.</div>'}
    </section>
    <section class="obra-detalhe-section">
      <h4>Cronograma da obra</h4>
      <div class="obra-cronograma-grid">
        ${renderMiniCalendarioObra(obra, rels, ags)}
        <div class="obra-relatorios-lista">
          ${ags.length ? ags.map(ag => `<div class="obra-relatorio-item agendamento">
            <strong>${formatarDataObra(ag.data)}${ag.hora ? ' - ' + escapeHtml(ag.hora.slice(0, 5)) : ''}</strong>
            <span>${escapeHtml(ag.cliente || 'Agendamento')}</span>
            ${ag.local ? `<p>${escapeHtml(ag.local)}</p>` : ''}
            ${ag.obs ? `<p>${escapeHtml(ag.obs)}</p>` : ''}
          </div>`).join('') : ''}
          ${rels.length ? rels.map(rel => `<div class="obra-relatorio-item">
            <strong>${formatarDataObra(rel.data)}</strong>
            <span>${escapeHtml(rel.funcionariosNomes || rel.funcionarioNome || 'Sem funcionário')}</span>
            <em>${moedaObra(rel.rendimento || 0)}</em>
            ${rel.obs ? `<p>${escapeHtml(rel.obs)}</p>` : ''}
          </div>`).join('') : (!ags.length ? '<div class="obra-vazio">Nenhum relat&oacute;rio ou agendamento registrado para esta obra.</div>' : '')}
        </div>
      </div>
    </section>
  </div>`;
}

function fecharMenuDiaObra() {
  document.getElementById('modal-dia-obra')?.remove();
}

function abrirMenuDiaObra(obraId, dataStr) {
  const obra = obras.find(o => o.id === obraId);
  if (!obra) { mostrarToast('Obra não encontrada.', 'erro'); return; }
  fecharMenuDiaObra();
  const dataFmt = formatarDataObra(dataStr);
  const overlay = document.createElement('div');
  overlay.id = 'modal-dia-obra';
  overlay.className = 'modal-overlay aberto';
  overlay.innerHTML = `<div class="modal-gestao obra-dia-modal">
    <h3>${escapeHtml(dataFmt)}</h3>
    <p>${escapeHtml(obra.nome || 'Obra')}</p>
    <div class="obra-dia-opcoes">
      <button type="button" onclick="criarRelatorioObraDia('${escapeAttr(obraId)}', '${escapeAttr(dataStr)}')">Relatório de Obra</button>
      <button type="button" onclick="criarAgendamentoObraDia('${escapeAttr(obraId)}', '${escapeAttr(dataStr)}')">Agendamento</button>
      <button type="button" onclick="criarOrcamentoObraDia('${escapeAttr(obraId)}', '${escapeAttr(dataStr)}')">Orçamento</button>
    </div>
    <div class="modal-acoes">
      <button type="button" class="btn-secundario" onclick="fecharMenuDiaObra()">Cancelar</button>
    </div>
  </div>`;
  overlay.addEventListener('click', (ev) => { if (ev.target === overlay) fecharMenuDiaObra(); });
  document.body.appendChild(overlay);
}

function criarRelatorioObraDia(obraId, dataStr) {
  const obra = obras.find(o => o.id === obraId);
  fecharMenuDiaObra();
  window.abrirRelatorioParaObra?.(obra, dataStr);
}

function criarAgendamentoObraDia(obraId, dataStr) {
  const obra = obras.find(o => o.id === obraId);
  fecharMenuDiaObra();
  window.abrirAgendamentoParaObra?.(obra, dataStr);
}

function criarOrcamentoObraDia(obraId, dataStr) {
  const obra = obras.find(o => o.id === obraId);
  fecharMenuDiaObra();
  window.iniciarOrcamentoParaObra?.(obra, dataStr);
}

function setFiltroObras(status, btn) {
  filtroObrasStatus = status;
  renderizarObras();
}

// ===== MODAL OBRA =====
function abrirModalObra(id = null) {
  document.getElementById('obra-id-edit').value = id || '';
  document.getElementById('obra-nome').value = '';
  document.getElementById('obra-construtora').value = '';
  document.getElementById('obra-responsavel').value = '';
  document.getElementById('obra-contato-responsavel').value = '';
  document.getElementById('obra-data').value = new Date().toISOString().split('T')[0];
  document.getElementById('obra-local').value = '';
  document.getElementById('modal-obra-titulo').textContent = id ? 'Editar Obra' : 'Adicionar Obra';

  if (id) {
    const obra = obras.find(o => o.id === id);
    if (obra) {
      document.getElementById('obra-nome').value = obra.nome || '';
      document.getElementById('obra-construtora').value = obra.construtora || '';
      document.getElementById('obra-responsavel').value = obra.responsavel || '';
      document.getElementById('obra-contato-responsavel').value = obra.contatoResponsavel || '';
      document.getElementById('obra-data').value = obra.data || '';
      document.getElementById('obra-local').value = obra.local || '';
    }
  }
  document.getElementById('modal-obra').classList.add('aberto');
}

function fecharModalObra() {
  document.getElementById('modal-obra').classList.remove('aberto');
}

function editarObra(id) { abrirModalObra(id); }

async function salvarObra() {
  const nome       = document.getElementById('obra-nome').value.trim();
  const construtora = document.getElementById('obra-construtora').value.trim();
  const responsavel = document.getElementById('obra-responsavel').value.trim();
  const contatoResponsavel = document.getElementById('obra-contato-responsavel').value.trim();
  const data       = document.getElementById('obra-data').value;
  const local      = document.getElementById('obra-local').value.trim();
  const idEdit     = document.getElementById('obra-id-edit').value;

  if (!nome) { mostrarToast('Informe o nome da obra.', 'erro'); return; }

  const dados = { nome, construtora, responsavel, contatoResponsavel, data, local, status: idEdit ? (obras.find(o=>o.id===idEdit)?.status || 'execucao') : 'execucao' };

  try {
    if (idEdit) {
      await DB.salvarObra(dados, idEdit);
      const idx = obras.findIndex(o => o.id === idEdit);
      if (idx >= 0) obras[idx] = { ...obras[idx], ...dados };
      mostrarToast('Obra atualizada!', 'sucesso');
    } else {
      const newId = await DB.salvarObra(dados);
      obras.push({ id: newId, ...dados });
      mostrarToast('Obra adicionada!', 'sucesso');
    }
    fecharModalObra();
    renderizarObras();
    // Atualizar select de obras no modal de relatório
    popularSelectObrasRel();
  } catch (err) {
    console.error(err);
    mostrarToast('Erro ao salvar obra.', 'erro');
  }
}

async function marcarObraFinalizada(id) {
  try {
    await DB.salvarObra({ status: 'finalizada' }, id);
    const idx = obras.findIndex(o => o.id === id);
    if (idx >= 0) obras[idx].status = 'finalizada';
    renderizarObras();
    mostrarToast('Obra marcada como finalizada.', 'sucesso');
  } catch { mostrarToast('Erro ao atualizar obra.', 'erro'); }
}

async function marcarObraExecucao(id) {
  try {
    await DB.salvarObra({ status: 'execucao' }, id);
    const idx = obras.findIndex(o => o.id === id);
    if (idx >= 0) obras[idx].status = 'execucao';
    renderizarObras();
    mostrarToast('Obra reaberta.', 'sucesso');
  } catch { mostrarToast('Erro ao atualizar obra.', 'erro'); }
}

function confirmarExcluirObra(id) {
  const obra = obras.find(o => o.id === id);
  abrirModal('Excluir Obra', `Excluir "${obra?.nome}"? Esta ação não pode ser desfeita.`, async () => {
    try {
      await DB.excluirObra(id);
      obras = obras.filter(o => o.id !== id);
      renderizarObras();
      popularSelectObrasRel();
      mostrarToast('Obra removida.', '');
    } catch { mostrarToast('Erro ao excluir obra.', 'erro'); }
  });
}

// ===== POPULAR SELECT OBRAS NO RELATORIO =====
function popularSelectObrasRel() {
  if (typeof window.popularSelectObrasRel === 'function' && window.popularSelectObrasRel !== popularSelectObrasRel) {
    window.popularSelectObrasRel();
    return;
  }
  const sel = document.getElementById('rel-obra-select');
  if (!sel) return;
  const atual = sel.value;
  setOptions(
    sel,
    obras.map(o => ({
      value: o.id,
      label: o.nome + (o.construtora ? ' - ' + o.construtora : ''),
      dataset: { nome: o.nome }
    })),
    { value: '', label: 'Digitar manualmente...' },
    atual
  );
}

// Exportar para escopo global
Object.assign(window, {
  renderizarObras, setFiltroObras, abrirDetalheObra, voltarListaObras, renderizarDetalheObra, mudarMesCronogramaObra,
  abrirMenuDiaObra, fecharMenuDiaObra, criarRelatorioObraDia, criarAgendamentoObraDia, criarOrcamentoObraDia, abrirOrcamentoAtrelado,
  abrirModalObra, fecharModalObra, editarObra, salvarObra,
  marcarObraFinalizada, marcarObraExecucao, confirmarExcluirObra
});
