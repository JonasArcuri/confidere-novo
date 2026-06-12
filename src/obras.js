// ===== OBRAS =====
import { DB } from './firebase.js';
import { escapeHtml, escapeAttr, setOptions } from './utils.js';

// Estado global
window.obras = window.obras || [];
window.obraDocumentos = window.obraDocumentos || [];
Object.defineProperty(window, 'obras', {
  get() { return this._obras || []; },
  set(v) { this._obras = v; }
});
Object.defineProperty(window, 'obraDocumentos', {
  get() { return this._obraDocumentos || []; },
  set(v) { this._obraDocumentos = Array.isArray(v) ? v : []; }
});

// ===== FILTRO ATUAL =====
let filtroObrasStatus = 'todos'; // 'todos' | 'execucao' | 'finalizada'
let obraDetalheId = null;
let obraCalendarioMesAtual = {};
let obraDocArquivosSelecionados = [];
let obraRelatorioPreviewAtual = null;
let obraRelatorioPreviewUrl = '';

const OBRA_DOC_CLASSIFICACOES = ['Contrato', 'Projeto', 'ART/RRT', 'Medição', 'Foto técnica', 'Laudo', 'Nota fiscal', 'Outro'];
const OBRA_DOC_STATUS = ['Pendente', 'Em revisão', 'Aprovado', 'Reprovado'];

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

function getTipoDocumentoObra(doc = {}) {
  return doc.tipoDocumento || doc.tipo || doc.documentoTipo || 'orcamento';
}

function isCobrancaObra(doc = {}) {
  return getTipoDocumentoObra(doc) === 'cobranca';
}

function isOrcamentoObra(doc = {}) {
  return getTipoDocumentoObra(doc) !== 'cobranca';
}

function formatarDataCampoObra(valor) {
  if (!valor) return '';
  if (valor?.toDate) return valor.toDate().toLocaleDateString('pt-BR');
  if (typeof valor === 'string' && /^\d{4}-\d{2}/.test(valor)) return new Date(valor + 'T12:00:00').toLocaleDateString('pt-BR');
  const d = new Date(valor);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('pt-BR');
}

function resumoStatusDocumentoObra(doc = {}) {
  if (isCobrancaObra(doc)) {
    const pago = doc.statusPagamento === 'pago' || doc.pago === true;
    const dataPago = formatarDataCampoObra(doc.dataPagamento || doc.pagoEm || doc.dataPago);
    return {
      classe: pago ? 'pago' : 'pendente',
      texto: pago ? `Pago${dataPago ? ' em ' + dataPago : ''}` : 'Pagamento pendente'
    };
  }
  const aprovado = doc.statusAprovacao === 'aprovado' || doc.aprovado === true;
  const dataAprovado = formatarDataCampoObra(doc.dataAprovacao || doc.aprovadoEm);
  return {
    classe: aprovado ? 'aprovado' : 'pendente',
    texto: aprovado ? `Aprovado${dataAprovado ? ' em ' + dataAprovado : ''}` : 'Aprovação pendente'
  };
}

function renderDocumentoFinanceiroObraItem(doc, tipoLabel) {
  const status = resumoStatusDocumentoObra(doc);
  return `<button type="button" class="obra-orc-item" onclick="abrirOrcamentoAtrelado('${escapeAttr(doc.id)}')">
    <div class="obra-orc-main">
      <div><strong>#${String(doc.numero || '').padStart(3, '0')}</strong> ${escapeHtml(doc.cliente || tipoLabel)}</div>
      <small>${escapeHtml(doc.assunto || doc.obra || 'Sem assunto informado')}</small>
      <div class="obra-doc-resumo">
        <span class="obra-doc-resumo-badge ${escapeAttr(status.classe)}">${escapeHtml(status.texto)}</span>
        ${doc.data ? `<span>Criado em ${escapeHtml(formatarDataObra(doc.data))}</span>` : ''}
        ${doc.salvoEm ? `<span>Salvo em ${escapeHtml(formatarDataCampoObra(doc.salvoEm))}</span>` : ''}
      </div>
    </div>
    <span>${formatarDataObra(doc.data)} · ${moedaObra(totalOrcamentoObra(doc))}</span>
  </button>`;
}

function normalizarArquivosDocumentoObra(doc = {}) {
  return Array.isArray(doc.arquivos) ? doc.arquivos.filter(arq => arq && (arq.url || arq.src)) : [];
}

function getDocumentosDaObra(obra) {
  const nome = normalizarTexto(obra?.nome);
  return (window.obraDocumentos || []).filter(doc => {
    if (doc.obraId && doc.obraId === obra.id) return true;
    return nome && normalizarTexto(doc.obraNome) === nome;
  }).sort((a, b) => (b.data || b.criadoEm || '').localeCompare(a.data || a.criadoEm || ''));
}

function arquivoEhImagem(arq = {}) {
  const tipo = String(arq.tipo || arq.type || '').toLowerCase();
  const url = String(arq.url || arq.src || '').toLowerCase();
  return tipo.startsWith('image/') || /\.(png|jpe?g|webp)(\?|$)/.test(url);
}

function getEventosPeriodoObra(obra, inicio, fim) {
  const dentro = data => (!inicio || data >= inicio) && (!fim || data <= fim);
  const rels = getRelatoriosDaObra(obra).filter(r => r.data && dentro(r.data));
  const ags = getAgendamentosDaObra(obra).filter(a => a.data && dentro(a.data));
  const docs = getDocumentosDaObra(obra).filter(d => (d.data || d.criadoEm || '').slice(0, 10) && dentro((d.data || d.criadoEm || '').slice(0, 10)));
  return { rels, ags, docs };
}

function dataDocumentoFinanceiroObra(doc = {}) {
  return (doc.data || doc.dataOrcamento || doc.dataCobranca || doc.savedAt || doc.criadoEm || doc.createdAt || '').slice(0, 10);
}

function getFinanceirosPeriodoObra(obra, inicio, fim) {
  const dentro = data => (!inicio || data >= inicio) && (!fim || data <= fim);
  const docs = getOrcamentosDaObra(obra);
  return {
    orcamentos: docs.filter(d => isOrcamentoObra(d) && dataDocumentoFinanceiroObra(d) && dentro(dataDocumentoFinanceiroObra(d))),
    cobrancas: docs.filter(d => isCobrancaObra(d) && dataDocumentoFinanceiroObra(d) && dentro(dataDocumentoFinanceiroObra(d)))
  };
}

function selecionarRelatorioObraOpcoes() {
  const marcado = id => !!document.getElementById(id)?.checked;
  return {
    rendimentos: marcado('obra-rel-opt-rendimentos'),
    relatorios: marcado('obra-rel-opt-relatorios'),
    etapas: marcado('obra-rel-opt-etapas'),
    agendamentos: marcado('obra-rel-opt-agendamentos'),
    orcamentos: marcado('obra-rel-opt-orcamentos'),
    cobrancas: marcado('obra-rel-opt-cobrancas'),
    documentos: marcado('obra-rel-opt-documentos'),
    documentosIds: Array.from(document.querySelectorAll('.obra-rel-doc-check:checked')).map(el => el.value)
  };
}

function alternarDocumentosRelatorioObra() {
  const ativo = document.getElementById('obra-rel-opt-documentos')?.checked;
  document.querySelectorAll('.obra-rel-doc-check').forEach(el => {
    el.disabled = !ativo;
    el.closest('label')?.classList.toggle('desabilitado', !ativo);
  });
}

function renderDocumentoRelatorioOpcao(doc) {
  const arquivos = normalizarArquivosDocumentoObra(doc).length;
  return `<label class="obra-relatorio-check-item">
    <input type="checkbox" class="obra-rel-doc-check" value="${escapeAttr(doc.id)}" checked>
    <span>
      <strong>${escapeHtml(doc.titulo || 'Documento')}</strong>
      <small>${escapeHtml(doc.classificacao || 'Sem classificação')} · Rev. ${escapeHtml(doc.revisao || '00')} · ${escapeHtml(doc.status || 'Pendente')} · ${formatarDataObra(doc.data || (doc.criadoEm || '').slice(0, 10))}${arquivos ? ` · ${arquivos} arquivo(s)` : ''}</small>
    </span>
  </label>`;
}

function toDataUrlImagem(src) {
  return new Promise((resolve) => {
    if (!src) return resolve('');
    if (src.startsWith('data:image/')) return resolve(src);
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth || img.width;
        canvas.height = img.naturalHeight || img.height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);
        resolve(canvas.toDataURL('image/jpeg', 0.88));
      } catch (err) {
        console.warn('Nao foi possivel converter imagem para PDF:', err);
        resolve('');
      }
    };
    img.onerror = () => resolve('');
    img.src = src;
  });
}

async function adicionarImagemPdf(doc, src, x, y, maxW, maxH) {
  const dataUrl = await toDataUrlImagem(src);
  if (!dataUrl) return 0;
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => {
      const ratio = Math.min(maxW / img.width, maxH / img.height, 1);
      const w = img.width * ratio;
      const h = img.height * ratio;
      const fmt = dataUrl.startsWith('data:image/png') ? 'PNG' : 'JPEG';
      doc.addImage(dataUrl, fmt, x + (maxW - w) / 2, y, w, h, undefined, 'FAST');
      resolve(h);
    };
    img.onerror = () => resolve(0);
    img.src = dataUrl;
  });
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

function isEtapaObra(ag) {
  return ag?.tipo === 'etapa_obra';
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
    eventosPorDia[dia].push({ tipo: isEtapaObra(ag) ? 'etapa' : 'agendamento', label: `${ag.hora ? ag.hora.slice(0, 5) + ' ' : ''}${ag.cliente || (isEtapaObra(ag) ? 'Etapa' : 'Agendamento')}` });
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

function renderDocumentoObraItem(doc) {
  const arquivos = normalizarArquivosDocumentoObra(doc);
  const aprovado = String(doc.status || '').toLowerCase() === 'aprovado';
  return `<div class="obra-doc-item">
    <div class="obra-doc-main">
      <div class="obra-doc-title">
        <strong>${escapeHtml(doc.titulo || doc.nome || 'Documento')}</strong>
        <span class="obra-doc-status ${aprovado ? 'aprovado' : ''}">${escapeHtml(doc.status || 'Pendente')}</span>
      </div>
      <div class="obra-doc-meta">
        ${escapeHtml(doc.classificacao || 'Sem classificação')} · Rev. ${escapeHtml(doc.revisao || '00')} · ${formatarDataObra(doc.data || '')}
      </div>
      ${doc.descricao ? `<p>${escapeHtml(doc.descricao)}</p>` : ''}
      ${arquivos.length ? `<div class="obra-doc-arquivos">${arquivos.slice(0, 4).map(arq => arquivoEhImagem(arq)
        ? `<img src="${escapeAttr(arq.url || arq.src)}" alt="${escapeAttr(arq.nome || 'Documento')}">`
        : `<a href="${escapeAttr(arq.url || arq.src)}" target="_blank" rel="noopener">${escapeHtml(arq.nome || 'Arquivo')}</a>`
      ).join('')}${arquivos.length > 4 ? `<span>+${arquivos.length - 4}</span>` : ''}</div>` : ''}
    </div>
    <div class="obra-doc-acoes">
      <button type="button" class="btn-mini editar" onclick="editarDocumentoObra('${escapeAttr(doc.id)}')">Editar</button>
      <button type="button" class="btn-mini ver" onclick="aprovarDocumentoObra('${escapeAttr(doc.id)}')">Aprovar</button>
      <button type="button" class="btn-mini excluir" onclick="confirmarExcluirDocumentoObra('${escapeAttr(doc.id)}')">Excluir</button>
    </div>
  </div>`;
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
  const orcamentosAtrelados = orcs.filter(isOrcamentoObra);
  const cobrancasAtreladas = orcs.filter(isCobrancaObra);
  const docs = getDocumentosDaObra(obra);
  const rendimento = rels.reduce((acc, rel) => acc + (Number(rel.rendimento) || 0), 0);
  const totalOrcamentos = orcamentosAtrelados.reduce((acc, orc) => acc + totalOrcamentoObra(orc), 0);
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
        <button class="btn-mini ver" onclick="abrirRelatorioPeriodoObra('${escapeAttr(obra.id)}')">Gerar relatório</button>
        <button class="btn-mini ver" onclick="abrirModalDocumentoObra('${escapeAttr(obra.id)}')">+ Documento</button>
        <button class="btn-mini editar" onclick="editarObra('${escapeAttr(obra.id)}')">Editar</button>
        ${isFinali
          ? `<button class="btn-mini ver" onclick="marcarObraExecucao('${escapeAttr(obra.id)}')">Reabrir</button>`
          : `<button class="btn-mini" style="background:#e8f5e9;color:#2e7d32;border:none;" onclick="marcarObraFinalizada('${escapeAttr(obra.id)}')">Finalizar</button>`}
      </div>
    </div>

    <div class="obra-resumo-grid">
      <div class="obra-resumo-card"><span>Relatórios de obra</span><strong>${rels.length}</strong></div>
      <div class="obra-resumo-card"><span>Rendimento registrado</span><strong>${moedaObra(rendimento)}</strong></div>
      <div class="obra-resumo-card"><span>Orçamentos atrelados</span><strong>${orcamentosAtrelados.length}</strong></div>
      <div class="obra-resumo-card"><span>Relatórios de cobrança</span><strong>${cobrancasAtreladas.length}</strong></div>
      <div class="obra-resumo-card"><span>Documentos</span><strong>${docs.length}</strong></div>
      <div class="obra-resumo-card"><span>Total orçado</span><strong>${moedaObra(totalOrcamentos)}</strong></div>
    </div>

    <section class="obra-detalhe-section">
      <h4>Orçamentos atrelados</h4>
      ${orcamentosAtrelados.length ? `<div class="obra-orc-lista">${orcamentosAtrelados.map(orc => renderDocumentoFinanceiroObraItem(orc, 'Orçamento')).join('')}</div>` : '<div class="obra-vazio">Nenhum orçamento relacionado a esta obra.</div>'}
    </section>
    <section class="obra-detalhe-section">
      <h4>Relatórios de cobrança atrelados</h4>
      ${cobrancasAtreladas.length ? `<div class="obra-orc-lista">${cobrancasAtreladas.map(cob => renderDocumentoFinanceiroObraItem(cob, 'Relatório de cobrança')).join('')}</div>` : '<div class="obra-vazio">Nenhum relatório de cobrança relacionado a esta obra.</div>'}
    </section>
    <section class="obra-detalhe-section">
      <div class="obra-section-topo">
        <h4>Documentos da obra</h4>
        <button type="button" class="btn-primario" onclick="abrirModalDocumentoObra('${escapeAttr(obra.id)}')">+ Adicionar Documento</button>
      </div>
      ${docs.length ? `<div class="obra-doc-lista">${docs.map(doc => renderDocumentoObraItem(doc)).join('')}</div>` : '<div class="obra-vazio">Nenhum documento vinculado a esta obra.</div>'}
    </section>
    <section class="obra-detalhe-section">
      <div class="obra-section-topo">
        <h4>Cronograma da obra</h4>
        <button type="button" class="btn-primario" onclick="abrirEtapaCronogramaObra('${escapeAttr(obra.id)}')">+ Nova Etapa / Cronograma</button>
      </div>
      <div class="obra-cronograma-grid">
        ${renderMiniCalendarioObra(obra, rels, ags)}
        <div class="obra-relatorios-lista">
          ${ags.filter(ag => !isEtapaObra(ag)).length ? ags.filter(ag => !isEtapaObra(ag)).map(ag => `<div class="obra-relatorio-item agendamento">
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
            ${Array.isArray(rel.imagens) && rel.imagens.length ? `<div class="obra-relatorio-imagens">${rel.imagens.slice(0, 6).map(img => `<img src="${escapeAttr(img.url || img.src || '')}" alt="Imagem do relatório">`).join('')}${rel.imagens.length > 6 ? `<span>+${rel.imagens.length - 6}</span>` : ''}</div>` : ''}
          </div>`).join('') : ''}
          ${ags.filter(isEtapaObra).length ? ags.filter(isEtapaObra).map(ag => `<div class="obra-relatorio-item etapa">
            <strong>${formatarDataObra(ag.data)}${ag.hora ? ' - ' + escapeHtml(ag.hora.slice(0, 5)) : ''}</strong>
            <span>${escapeHtml(ag.cliente || 'Etapa de obra')}</span>
            ${ag.funcionariosNomes ? `<p>Funcionários: ${escapeHtml(ag.funcionariosNomes)}</p>` : ''}
            ${ag.local ? `<p>${escapeHtml(ag.local)}</p>` : ''}
            ${ag.obs ? `<p>${escapeHtml(ag.obs)}</p>` : ''}
          </div>`).join('') : ''}
          ${(!ags.length && !rels.length) ? '<div class="obra-vazio">Nenhum relatório, agendamento ou etapa registrado para esta obra.</div>' : ''}
        </div>
      </div>
    </section>
  </div>`;
}

function fecharModalDocumentoObra() {
  document.getElementById('modal-documento-obra')?.remove();
}

function previewArquivoObra(file) {
  return new Promise(resolve => {
    if (!file || !file.type?.startsWith('image/')) return resolve('');
    const reader = new FileReader();
    reader.onload = e => resolve(e.target.result || '');
    reader.onerror = () => resolve('');
    reader.readAsDataURL(file);
  });
}

function renderArquivosDocumentoObraModal() {
  const cont = document.getElementById('obra-doc-arquivos-preview');
  if (!cont) return;
  if (!obraDocArquivosSelecionados.length) {
    cont.innerHTML = '<div class="obra-doc-vazio">Nenhum arquivo adicionado.</div>';
    return;
  }
  cont.innerHTML = obraDocArquivosSelecionados.map((arq, index) => `
    <div class="obra-doc-upload-item ${arq.status === 'pending' ? 'enviando' : ''}">
      ${arquivoEhImagem(arq) ? `<img src="${escapeAttr(arq.preview || arq.url || arq.src || '')}" alt="${escapeAttr(arq.nome || 'Arquivo')}">` : '<div class="obra-doc-file-icon">PDF</div>'}
      <div><strong>${escapeHtml(arq.nome || 'Arquivo')}</strong><span>${escapeHtml(arq.status === 'pending' ? 'Enviando...' : arq.status === 'error' ? 'Falhou' : 'Pronto')}</span></div>
      <button type="button" onclick="removerArquivoDocumentoObra(${index})">&times;</button>
    </div>
  `).join('');
}

function removerArquivoDocumentoObra(index) {
  obraDocArquivosSelecionados.splice(index, 1);
  renderArquivosDocumentoObraModal();
}

async function handleArquivosDocumentoObra(input) {
  const arquivos = Array.from(input?.files || []);
  input.value = '';
  if (!arquivos.length) return;
  for (const file of arquivos) {
    if (!['image/png', 'image/jpeg', 'application/pdf'].includes(file.type)) {
      mostrarToast('Use PNG, JPEG ou PDF.', 'erro');
      continue;
    }
    const item = {
      nome: file.name,
      tipo: file.type,
      tamanho: file.size,
      preview: await previewArquivoObra(file),
      status: 'pending'
    };
    obraDocArquivosSelecionados.push(item);
    renderArquivosDocumentoObraModal();
    try {
      const uploaded = await DB.salvarDocumentoObraArquivo(file);
      item.url = uploaded.url;
      item.path = uploaded.path;
      item.status = 'done';
    } catch (err) {
      console.error('Erro ao enviar documento da obra:', err);
      item.status = 'error';
      mostrarToast('Erro ao enviar arquivo do documento.', 'erro');
    }
    renderArquivosDocumentoObraModal();
  }
}

function abrirModalDocumentoObra(obraId, docId = '') {
  const obra = obras.find(o => o.id === obraId) || obras.find(o => o.id === obraDetalheId);
  if (!obra) { mostrarToast('Obra não encontrada.', 'erro'); return; }
  const doc = docId ? (window.obraDocumentos || []).find(d => d.id === docId) : null;
  obraDocArquivosSelecionados = doc ? normalizarArquivosDocumentoObra(doc).map(arq => ({ ...arq, status: 'done', preview: arq.url || arq.src || '' })) : [];
  fecharModalDocumentoObra();
  const overlay = document.createElement('div');
  overlay.id = 'modal-documento-obra';
  overlay.className = 'modal-overlay aberto';
  overlay.innerHTML = `<div class="modal-gestao obra-doc-modal">
    <h3>${doc ? 'Editar Documento' : 'Novo Documento da Obra'}</h3>
    <input type="hidden" id="obra-doc-id" value="${escapeAttr(doc?.id || '')}">
    <input type="hidden" id="obra-doc-obra-id" value="${escapeAttr(obra.id)}">
    <div class="campo"><label>Obra</label><input type="text" value="${escapeAttr(obra.nome || '')}" disabled></div>
    <div class="grid-2">
      <div class="campo"><label>Título *</label><input type="text" id="obra-doc-titulo" value="${escapeAttr(doc?.titulo || '')}" placeholder="Ex: Projeto executivo, ART, medição..."></div>
      <div class="campo"><label>Classificação</label><select id="obra-doc-classificacao">${OBRA_DOC_CLASSIFICACOES.map(c => `<option ${doc?.classificacao === c ? 'selected' : ''}>${escapeHtml(c)}</option>`).join('')}</select></div>
    </div>
    <div class="grid-3">
      <div class="campo"><label>Revisão</label><input type="text" id="obra-doc-revisao" value="${escapeAttr(doc?.revisao || '00')}" placeholder="00, R01, Rev. A..."></div>
      <div class="campo"><label>Status / Aprovação</label><select id="obra-doc-status">${OBRA_DOC_STATUS.map(s => `<option ${doc?.status === s ? 'selected' : ''}>${escapeHtml(s)}</option>`).join('')}</select></div>
      <div class="campo"><label>Data</label><input type="date" id="obra-doc-data" value="${escapeAttr(doc?.data || new Date().toISOString().slice(0, 10))}"></div>
    </div>
    <div class="campo"><label>Descrição</label><textarea id="obra-doc-descricao" rows="3" placeholder="Observações, motivo da revisão, parecer de aprovação...">${escapeHtml(doc?.descricao || '')}</textarea></div>
    <div class="campo">
      <label>Arquivos vinculados</label>
      <div class="rel-imagens-box">
        <button type="button" class="btn-secundario" onclick="document.getElementById('obra-doc-input').click()">+ Adicionar Arquivos</button>
        <input type="file" id="obra-doc-input" accept="image/png,image/jpeg,application/pdf" multiple style="display:none" onchange="handleArquivosDocumentoObra(this)">
        <small>Use PNG, JPEG ou PDF. Arquivos ficam classificados, revisados e vinculados a esta obra.</small>
        <div class="obra-doc-upload-list" id="obra-doc-arquivos-preview"></div>
      </div>
    </div>
    <div class="modal-acoes">
      <button type="button" class="btn-secundario" onclick="fecharModalDocumentoObra()">Cancelar</button>
      <button type="button" class="btn-primario" onclick="salvarDocumentoObra()">Salvar Documento</button>
    </div>
  </div>`;
  overlay.addEventListener('click', ev => { if (ev.target === overlay) fecharModalDocumentoObra(); });
  document.body.appendChild(overlay);
  renderArquivosDocumentoObraModal();
}

function editarDocumentoObra(docId) {
  const doc = (window.obraDocumentos || []).find(d => d.id === docId);
  if (!doc) { mostrarToast('Documento não encontrado.', 'erro'); return; }
  abrirModalDocumentoObra(doc.obraId || obraDetalheId, docId);
}

async function salvarDocumentoObra() {
  const id = document.getElementById('obra-doc-id')?.value || '';
  const obraId = document.getElementById('obra-doc-obra-id')?.value || obraDetalheId;
  const obra = obras.find(o => o.id === obraId);
  const titulo = document.getElementById('obra-doc-titulo')?.value.trim() || '';
  if (!obra || !titulo) { mostrarToast('Informe o título do documento.', 'erro'); return; }
  if (obraDocArquivosSelecionados.some(a => a.status === 'pending')) { mostrarToast('Aguarde o envio dos arquivos terminar.', 'erro'); return; }
  if (obraDocArquivosSelecionados.some(a => a.status === 'error' || !a.url)) { mostrarToast('Remova ou reenvie arquivos com erro.', 'erro'); return; }
  const dados = {
    obraId,
    obraNome: obra.nome || '',
    titulo,
    classificacao: document.getElementById('obra-doc-classificacao')?.value || 'Outro',
    revisao: document.getElementById('obra-doc-revisao')?.value.trim() || '00',
    status: document.getElementById('obra-doc-status')?.value || 'Pendente',
    data: document.getElementById('obra-doc-data')?.value || new Date().toISOString().slice(0, 10),
    descricao: document.getElementById('obra-doc-descricao')?.value.trim() || '',
    arquivos: obraDocArquivosSelecionados.filter(a => a.url || a.src).map(a => ({
      url: a.url || a.src,
      path: a.path || '',
      nome: a.nome || '',
      tipo: a.tipo || '',
      tamanho: a.tamanho || 0
    }))
  };
  try {
    const salvoId = await DB.salvarDocumentoObra(dados, id || null);
    if (id) {
      const idx = window.obraDocumentos.findIndex(d => d.id === id);
      if (idx >= 0) window.obraDocumentos[idx] = { ...window.obraDocumentos[idx], ...dados };
    } else {
      window.obraDocumentos.push({ id: salvoId, ...dados, criadoEm: new Date().toISOString() });
    }
    fecharModalDocumentoObra();
    renderizarDetalheObra(obraId);
    mostrarToast('Documento salvo.', 'sucesso');
  } catch (err) {
    console.error(err);
    mostrarToast('Erro ao salvar documento.', 'erro');
  }
}

async function aprovarDocumentoObra(docId) {
  const doc = (window.obraDocumentos || []).find(d => d.id === docId);
  if (!doc) return;
  try {
    await DB.salvarDocumentoObra({ status: 'Aprovado', aprovadoEm: new Date().toISOString() }, docId);
    doc.status = 'Aprovado';
    doc.aprovadoEm = new Date().toISOString();
    renderizarDetalheObra(doc.obraId || obraDetalheId);
    mostrarToast('Documento aprovado.', 'sucesso');
  } catch (err) {
    console.error(err);
    mostrarToast('Erro ao aprovar documento.', 'erro');
  }
}

function confirmarExcluirDocumentoObra(docId) {
  const doc = (window.obraDocumentos || []).find(d => d.id === docId);
  abrirModal('Excluir Documento', `Excluir "${doc?.titulo || 'documento'}"?`, async () => {
    try {
      await DB.excluirDocumentoObra(docId);
      window.obraDocumentos = window.obraDocumentos.filter(d => d.id !== docId);
      normalizarArquivosDocumentoObra(doc).forEach(arq => { if (arq.path) DB.excluirArquivoStorage?.(arq.path); });
      renderizarDetalheObra(doc?.obraId || obraDetalheId);
      mostrarToast('Documento removido.', '');
    } catch (err) {
      console.error(err);
      mostrarToast('Erro ao excluir documento.', 'erro');
    }
  });
}

function fecharRelatorioPeriodoObra() {
  document.getElementById('modal-relatorio-periodo-obra')?.remove();
  if (obraRelatorioPreviewUrl) URL.revokeObjectURL(obraRelatorioPreviewUrl);
  obraRelatorioPreviewUrl = '';
  obraRelatorioPreviewAtual = null;
}

function abrirRelatorioPeriodoObra(obraId) {
  const obra = obras.find(o => o.id === obraId);
  if (!obra) { mostrarToast('Obra não encontrada.', 'erro'); return; }
  fecharRelatorioPeriodoObra();
  const hoje = new Date().toISOString().slice(0, 10);
  const inicio = obra.data || hoje;
  const overlay = document.createElement('div');
  overlay.id = 'modal-relatorio-periodo-obra';
  overlay.className = 'modal-overlay pdf-preview-overlay aberto';
  overlay.innerHTML = `<div class="pdf-preview-modal obra-relatorio-periodo-modal">
    <div class="pdf-preview-topo">
      <div><h3>Relatório da Obra</h3><p>${escapeHtml(obra.nome || 'Obra')} · escolha o período e gere a prévia.</p></div>
      <button type="button" class="pdf-preview-fechar" onclick="fecharRelatorioPeriodoObra()" aria-label="Fechar">×</button>
    </div>
    <div class="pdf-preview-toolbar obra-periodo-toolbar">
      <label>De <input type="date" id="obra-rel-inicio" value="${escapeAttr(inicio)}"></label>
      <label>Até <input type="date" id="obra-rel-fim" value="${escapeAttr(hoje)}"></label>
      <button type="button" class="btn-secundario" onclick="atualizarPreviewRelatorioObra('${escapeAttr(obra.id)}')">Gerar prévia</button>
      <button type="button" class="btn-primario" onclick="baixarRelatorioPeriodoObra()">Baixar PDF</button>
    </div>
    <iframe id="obra-relatorio-preview-frame" class="pdf-preview-frame" title="Prévia do relatório da obra"></iframe>
  </div>`;
  overlay.addEventListener('click', ev => { if (ev.target === overlay) fecharRelatorioPeriodoObra(); });
  document.body.appendChild(overlay);
  atualizarPreviewRelatorioObra(obraId);
}

function textoPeriodoRelatorioObra(inicio, fim) {
  const a = inicio ? formatarDataObra(inicio) : 'início';
  const b = fim ? formatarDataObra(fim) : 'fim';
  return `${a} a ${b}`;
}

async function gerarRelatorioPeriodoObraPDF(obraId, inicio, fim) {
  const JsPDF = window.jspdf?.jsPDF || window.jsPDF;
  if (!JsPDF) throw new Error('Biblioteca de PDF não carregada.');
  const obra = obras.find(o => o.id === obraId);
  if (!obra) throw new Error('Obra não encontrada.');
  const { rels, ags, docs } = getEventosPeriodoObra(obra, inicio, fim);
  const etapas = ags.filter(isEtapaObra);
  const agendamentos = ags.filter(a => !isEtapaObra(a));
  const doc = new JsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const PW = doc.internal.pageSize.getWidth();
  const PH = doc.internal.pageSize.getHeight();
  const M = 14;
  const W = PW - M * 2;
  const azul = [26, 58, 92];
  const azulClaro = [74, 144, 217];
  const cinza = [95, 91, 86];
  const laranja = [224, 92, 32];
  let y = 16;

  const novaPaginaSePreciso = h => { if (y + h > PH - 18) { doc.addPage(); y = 16; } };
  const linha = () => { doc.setDrawColor(...azulClaro); doc.setLineWidth(0.25); doc.line(M, y, M + W, y); y += 4; };
  const tituloSecao = t => {
    novaPaginaSePreciso(12);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(12); doc.setTextColor(...azul);
    doc.text(String(t).toUpperCase(), M, y);
    y += 3; linha();
  };
  const paragrafo = (txt, x = M, maxW = W, cor = [20, 20, 20], size = 9) => {
    const lines = doc.splitTextToSize(String(txt || '-'), maxW);
    novaPaginaSePreciso(lines.length * 5 + 2);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(size); doc.setTextColor(...cor);
    doc.text(lines, x, y);
    y += lines.length * 5 + 2;
  };
  const itemBox = (titulo, meta, desc = '', destaque = azul) => {
    const descLines = desc ? doc.splitTextToSize(desc, W - 10) : [];
    const h = 15 + descLines.length * 4.5;
    novaPaginaSePreciso(h + 4);
    doc.setFillColor(248, 250, 252);
    doc.setDrawColor(220, 216, 210);
    doc.roundedRect(M, y, W, h, 2, 2, 'FD');
    doc.setFillColor(...destaque);
    doc.rect(M, y, 2.5, h, 'F');
    doc.setFont('helvetica', 'bold'); doc.setFontSize(9.5); doc.setTextColor(...azul);
    doc.text(titulo || '-', M + 6, y + 7);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(...cinza);
    doc.text(meta || '-', M + 6, y + 12);
    if (descLines.length) {
      doc.setTextColor(30, 30, 30);
      doc.text(descLines, M + 6, y + 17);
    }
    y += h + 4;
  };

  doc.setFillColor(...azul);
  doc.rect(0, 0, PW, 34, 'F');
  doc.setFont('helvetica', 'bold'); doc.setFontSize(19); doc.setTextColor(255, 255, 255);
  doc.text('Relatório de Obra', M, 15);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
  doc.text(`Período: ${textoPeriodoRelatorioObra(inicio, fim)}`, M, 24);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(12);
  doc.text(obra.nome || 'Obra', PW - M, 15, { align: 'right' });
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5);
  doc.text(obra.construtora || '', PW - M, 22, { align: 'right' });
  y = 44;

  tituloSecao('Informações da obra');
  paragrafo(`Obra: ${obra.nome || '-'}\nConstrutora / Empreiteiro: ${obra.construtora || '-'}\nLocal: ${obra.local || '-'}\nResponsável técnico/responsável: ${obra.responsavel || '-'}\nContato do responsável: ${obra.contatoResponsavel || '-'}\nInício: ${formatarDataObra(obra.data)}\nStatus: ${obra.status === 'finalizada' ? 'Finalizada' : 'Em execução'}`);

  tituloSecao('Resumo do período');
  const rendimento = rels.reduce((acc, r) => acc + (Number(r.rendimento) || 0), 0);
  paragrafo(`Relatórios de obra: ${rels.length}\nEtapas / cronogramas: ${etapas.length}\nAgendamentos: ${agendamentos.length}\nDocumentos: ${docs.length}\nRendimento registrado: ${moedaObra(rendimento)}`);

  tituloSecao('Etapas e cronograma');
  if (!etapas.length && !agendamentos.length) paragrafo('Nenhuma etapa ou agendamento registrado no período.', M, W, cinza);
  etapas.forEach(ev => itemBox(ev.cliente || 'Etapa de obra', `${formatarDataObra(ev.data)}${ev.hora ? ' · ' + ev.hora.slice(0, 5) : ''}${ev.funcionariosNomes ? ' · ' + ev.funcionariosNomes : ''}`, [ev.local, ev.obs].filter(Boolean).join('\n'), [34, 160, 90]));
  agendamentos.forEach(ev => itemBox(ev.cliente || 'Agendamento', `${formatarDataObra(ev.data)}${ev.hora ? ' · ' + ev.hora.slice(0, 5) : ''}`, [ev.local, ev.obs].filter(Boolean).join('\n'), azulClaro));

  tituloSecao('Relatórios de obra');
  if (!rels.length) paragrafo('Nenhum relatório de obra registrado no período.', M, W, cinza);
  for (const rel of rels) {
    itemBox(rel.obra || obra.nome || 'Relatório', `${formatarDataObra(rel.data)} · ${rel.funcionariosNomes || rel.funcionarioNome || 'Sem funcionário'} · ${moedaObra(rel.rendimento || 0)}`, rel.obs || '', laranja);
    const imgs = normalizarArquivosDocumentoObra({ arquivos: rel.imagens }).filter(arquivoEhImagem).slice(0, 4);
    if (imgs.length) {
      let x = M;
      let rowH = 0;
      for (const img of imgs) {
        novaPaginaSePreciso(42);
        const h = await adicionarImagemPdf(doc, img.url || img.src, x, y, 42, 34);
        rowH = Math.max(rowH, h || 34);
        x += 46;
        if (x + 42 > M + W) { x = M; y += rowH + 5; rowH = 0; }
      }
      if (rowH) y += rowH + 5;
    }
  }

  tituloSecao('Documentos vinculados');
  if (!docs.length) paragrafo('Nenhum documento vinculado no período.', M, W, cinza);
  for (const d of docs) {
    itemBox(d.titulo || 'Documento', `${formatarDataObra(d.data)} · ${d.classificacao || 'Sem classificação'} · Rev. ${d.revisao || '00'} · ${d.status || 'Pendente'}`, d.descricao || '', d.status === 'Aprovado' ? [34, 160, 90] : azul);
    const imgs = normalizarArquivosDocumentoObra(d).filter(arquivoEhImagem).slice(0, 3);
    for (const img of imgs) {
      novaPaginaSePreciso(52);
      const h = await adicionarImagemPdf(doc, img.url || img.src, M + 8, y, W - 16, 46);
      if (h) y += h + 5;
    }
  }

  doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(...cinza);
  doc.text('Desenvolvido por Sanoj Sistemas', PW / 2, PH - 8, { align: 'center' });
  return doc;
}

async function atualizarPreviewRelatorioObra(obraId) {
  const inicio = document.getElementById('obra-rel-inicio')?.value || '';
  const fim = document.getElementById('obra-rel-fim')?.value || '';
  if (inicio && fim && inicio > fim) { mostrarToast('Data inicial maior que a data final.', 'erro'); return; }
  const frame = document.getElementById('obra-relatorio-preview-frame');
  if (frame) frame.srcdoc = '<div style="font-family:Arial;padding:24px">Gerando prévia...</div>';
  try {
    const doc = await gerarRelatorioPeriodoObraPDF(obraId, inicio, fim);
    if (obraRelatorioPreviewUrl) URL.revokeObjectURL(obraRelatorioPreviewUrl);
    obraRelatorioPreviewAtual = { doc, obraId, inicio, fim };
    obraRelatorioPreviewUrl = URL.createObjectURL(doc.output('blob'));
    if (frame) frame.src = obraRelatorioPreviewUrl;
  } catch (err) {
    console.error(err);
    mostrarToast('Erro ao gerar prévia do relatório.', 'erro');
  }
}

async function baixarRelatorioPeriodoObra() {
  if (!obraRelatorioPreviewAtual) { mostrarToast('Gere a prévia antes de baixar.', 'erro'); return; }
  const obra = obras.find(o => o.id === obraRelatorioPreviewAtual.obraId);
  const nome = String(obra?.nome || 'obra').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase();
  obraRelatorioPreviewAtual.doc.save(`relatorio-obra-${nome || 'obra'}-${obraRelatorioPreviewAtual.inicio || 'inicio'}-${obraRelatorioPreviewAtual.fim || 'fim'}.pdf`);
  mostrarToast('Relatório de obra baixado.', 'sucesso');
}

function abrirRelatorioPeriodoObraAvancado(obraId) {
  const obra = obras.find(o => o.id === obraId);
  if (!obra) { mostrarToast('Obra não encontrada.', 'erro'); return; }
  fecharRelatorioPeriodoObra();
  const hoje = new Date().toISOString().slice(0, 10);
  const inicio = obra.data || hoje;
  const documentos = getDocumentosDaObra(obra);
  const overlay = document.createElement('div');
  overlay.id = 'modal-relatorio-periodo-obra';
  overlay.className = 'modal-overlay pdf-preview-overlay aberto';
  overlay.innerHTML = `<div class="pdf-preview-modal obra-relatorio-periodo-modal">
    <div class="pdf-preview-topo">
      <div><h3>Relatório da Obra</h3><p>${escapeHtml(obra.nome || 'Obra')} · escolha período, conteúdo e documentos para gerar a prévia.</p></div>
      <button type="button" class="pdf-preview-fechar" onclick="fecharRelatorioPeriodoObra()" aria-label="Fechar">×</button>
    </div>
    <div class="obra-relatorio-config">
      <div class="pdf-preview-toolbar obra-periodo-toolbar">
        <label>De <input type="date" id="obra-rel-inicio" value="${escapeAttr(inicio)}"></label>
        <label>Até <input type="date" id="obra-rel-fim" value="${escapeAttr(hoje)}"></label>
        <button type="button" class="btn-secundario" onclick="atualizarPreviewRelatorioObra('${escapeAttr(obra.id)}')">Gerar prévia</button>
        <button type="button" class="btn-primario" onclick="baixarRelatorioPeriodoObra()">Baixar PDF</button>
      </div>
      <div class="obra-relatorio-opcoes">
        <label><input type="checkbox" id="obra-rel-opt-rendimentos" checked> Rendimentos e resumo financeiro</label>
        <label><input type="checkbox" id="obra-rel-opt-relatorios" checked> Relatórios de obra e imagens</label>
        <label><input type="checkbox" id="obra-rel-opt-etapas" checked> Etapas / cronograma</label>
        <label><input type="checkbox" id="obra-rel-opt-agendamentos" checked> Agendamentos vinculados</label>
        <label><input type="checkbox" id="obra-rel-opt-orcamentos" checked> Orçamentos atrelados</label>
        <label><input type="checkbox" id="obra-rel-opt-cobrancas" checked> Relatórios de cobrança</label>
        <label><input type="checkbox" id="obra-rel-opt-documentos" checked onchange="alternarDocumentosRelatorioObra()"> Documentos da obra</label>
      </div>
      <div class="obra-relatorio-documentos">
        <div class="obra-relatorio-documentos-topo">
          <strong>Documentos para incluir</strong>
          <small>${documentos.length ? 'Marque apenas os documentos que devem sair no relatório.' : 'Nenhum documento cadastrado para esta obra.'}</small>
        </div>
        ${documentos.length ? documentos.map(renderDocumentoRelatorioOpcao).join('') : '<div class="obra-vazio">Nenhum documento vinculado a esta obra.</div>'}
      </div>
    </div>
    <iframe id="obra-relatorio-preview-frame" class="pdf-preview-frame" title="Prévia do relatório da obra"></iframe>
  </div>`;
  overlay.addEventListener('click', ev => { if (ev.target === overlay) fecharRelatorioPeriodoObra(); });
  document.body.appendChild(overlay);
  atualizarPreviewRelatorioObraAvancado(obraId);
}

async function gerarRelatorioPeriodoObraPDFAvancado(obraId, inicio, fim, opcoes = {}) {
  const JsPDF = window.jspdf?.jsPDF || window.jsPDF;
  if (!JsPDF) throw new Error('Biblioteca de PDF não carregada.');
  const obra = obras.find(o => o.id === obraId);
  if (!obra) throw new Error('Obra não encontrada.');

  const { rels, ags, docs } = getEventosPeriodoObra(obra, inicio, fim);
  const { orcamentos, cobrancas } = getFinanceirosPeriodoObra(obra, inicio, fim);
  const etapas = ags.filter(isEtapaObra);
  const agendamentos = ags.filter(a => !isEtapaObra(a));
  const docsSelecionados = opcoes.documentos
    ? docs.filter(d => !opcoes.documentosIds?.length || opcoes.documentosIds.includes(d.id))
    : [];
  const rendimento = rels.reduce((acc, r) => acc + (Number(r.rendimento) || 0), 0);
  const totalOrcado = orcamentos.reduce((acc, o) => acc + totalOrcamentoObra(o), 0);
  const totalCobrancas = cobrancas.reduce((acc, c) => acc + totalOrcamentoObra(c), 0);

  const doc = new JsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const PW = doc.internal.pageSize.getWidth();
  const PH = doc.internal.pageSize.getHeight();
  const M = 14;
  const W = PW - M * 2;
  const azul = [26, 58, 92];
  const azulClaro = [74, 144, 217];
  const cinza = [95, 91, 86];
  const laranja = [224, 92, 32];
  const verde = [31, 143, 77];
  let y = 16;

  const rodape = () => {
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(...cinza);
    doc.text('Desenvolvido por Sanoj Sistemas', PW / 2, PH - 8, { align: 'center' });
  };
  const novaPaginaSePreciso = h => { if (y + h > PH - 18) { rodape(); doc.addPage(); y = 16; } };
  const linha = () => { doc.setDrawColor(...azulClaro); doc.setLineWidth(0.25); doc.line(M, y, M + W, y); y += 4; };
  const tituloSecao = t => {
    novaPaginaSePreciso(12);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(12); doc.setTextColor(...azul);
    doc.text(String(t).toUpperCase(), M, y);
    y += 3; linha();
  };
  const paragrafo = (txt, x = M, maxW = W, cor = [20, 20, 20], size = 9) => {
    const lines = doc.splitTextToSize(String(txt || '-'), maxW);
    novaPaginaSePreciso(lines.length * 5 + 2);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(size); doc.setTextColor(...cor);
    doc.text(lines, x, y);
    y += lines.length * 5 + 2;
  };
  const itemBox = (titulo, meta, desc = '', destaque = azul) => {
    const metaLines = doc.splitTextToSize(String(meta || '-'), W - 12);
    const descLines = desc ? doc.splitTextToSize(desc, W - 10) : [];
    const h = 13 + metaLines.length * 4.2 + descLines.length * 4.5;
    novaPaginaSePreciso(h + 4);
    doc.setFillColor(248, 250, 252);
    doc.setDrawColor(220, 216, 210);
    doc.roundedRect(M, y, W, h, 2, 2, 'FD');
    doc.setFillColor(...destaque);
    doc.rect(M, y, 2.5, h, 'F');
    doc.setFont('helvetica', 'bold'); doc.setFontSize(9.5); doc.setTextColor(...azul);
    doc.text(String(titulo || '-'), M + 6, y + 7);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(...cinza);
    doc.text(metaLines, M + 6, y + 12);
    if (descLines.length) {
      doc.setTextColor(30, 30, 30);
      doc.text(descLines, M + 6, y + 12 + metaLines.length * 4.2 + 3);
    }
    y += h + 4;
  };
  const resumoCard = (x, yCard, w, titulo, valor, cor = azul) => {
    doc.setFillColor(248, 250, 252);
    doc.setDrawColor(220, 216, 210);
    doc.roundedRect(x, yCard, w, 18, 2, 2, 'FD');
    doc.setFont('helvetica', 'bold'); doc.setFontSize(7); doc.setTextColor(95, 91, 86);
    doc.text(String(titulo).toUpperCase(), x + 3, yCard + 6);
    doc.setFontSize(11); doc.setTextColor(...cor);
    doc.text(String(valor), x + 3, yCard + 14);
  };

  doc.setFillColor(...azul);
  doc.rect(0, 0, PW, 38, 'F');
  doc.setFont('helvetica', 'bold'); doc.setFontSize(18); doc.setTextColor(255, 255, 255);
  doc.text('Relatório de Andamento da Obra', M, 15);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
  doc.text(`Período: ${textoPeriodoRelatorioObra(inicio, fim)}`, M, 25);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(12);
  doc.text(obra.nome || 'Obra', PW - M, 15, { align: 'right' });
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5);
  doc.text(obra.construtora || '', PW - M, 23, { align: 'right' });
  y = 48;

  tituloSecao('Informações da obra');
  paragrafo(`Obra: ${obra.nome || '-'}\nConstrutora / Empreiteiro: ${obra.construtora || '-'}\nLocal: ${obra.local || '-'}\nResponsável técnico/responsável: ${obra.responsavel || '-'}\nContato do responsável: ${obra.contatoResponsavel || '-'}\nInício: ${formatarDataObra(obra.data)}\nStatus: ${obra.status === 'finalizada' ? 'Finalizada' : 'Em execução'}`);

  tituloSecao('Linha do tempo');
  const primeiroOrc = orcamentos.slice().sort((a, b) => (dataDocumentoFinanceiroObra(a) || '').localeCompare(dataDocumentoFinanceiroObra(b) || ''))[0];
  const primeiroAprovado = orcamentos.find(o => o.statusAprovacao === 'aprovado' || o.aprovado === true);
  const primeiraCobrancaPaga = cobrancas.find(c => c.statusPagamento === 'pago' || c.pago === true);
  paragrafo(`Primeiro orçamento: ${primeiroOrc ? `#${String(primeiroOrc.numero || '').padStart(3, '0')} em ${formatarDataObra(dataDocumentoFinanceiroObra(primeiroOrc))}` : '-'}\nAprovação: ${primeiroAprovado ? resumoStatusDocumentoObra(primeiroAprovado).texto : '-'}\nPrimeira cobrança paga: ${primeiraCobrancaPaga ? resumoStatusDocumentoObra(primeiraCobrancaPaga).texto : '-'}\nÚltima atualização do período: ${formatarDataObra(fim || new Date().toISOString().slice(0, 10))}`);

  tituloSecao('Resumo');
  const cardW = (W - 8) / 3;
  novaPaginaSePreciso(42);
  resumoCard(M, y, cardW, 'Orçado', moedaObra(totalOrcado));
  resumoCard(M + cardW + 4, y, cardW, 'Cobrado', moedaObra(totalCobrancas), laranja);
  resumoCard(M + cardW * 2 + 8, y, cardW, 'Rendimento', moedaObra(rendimento), verde);
  y += 24;
  paragrafo(`Relatórios de obra: ${rels.length}\nEtapas / cronogramas: ${etapas.length}\nAgendamentos: ${agendamentos.length}\nOrçamentos atrelados: ${orcamentos.length}\nRelatórios de cobrança: ${cobrancas.length}\nDocumentos selecionados: ${docsSelecionados.length}`, M, W, cinza, 8.5);

  if (opcoes.orcamentos) {
    tituloSecao('Orçamentos atrelados');
    if (!orcamentos.length) paragrafo('Nenhum orçamento relacionado no período.', M, W, cinza);
    orcamentos.forEach(o => {
      const status = resumoStatusDocumentoObra(o);
      itemBox(`#${String(o.numero || '').padStart(3, '0')} ${o.cliente || 'Orçamento'}`, `${o.assunto || '-'} · Orçado em ${formatarDataObra(dataDocumentoFinanceiroObra(o))} · ${status.texto}`, `Valor: ${moedaObra(totalOrcamentoObra(o))}`, status.classe === 'aprovado' ? verde : azul);
    });
  }

  if (opcoes.cobrancas) {
    tituloSecao('Relatórios de cobrança');
    if (!cobrancas.length) paragrafo('Nenhum relatório de cobrança relacionado no período.', M, W, cinza);
    cobrancas.forEach(c => {
      const status = resumoStatusDocumentoObra(c);
      itemBox(`#${String(c.numero || '').padStart(3, '0')} ${c.cliente || 'Relatório de cobrança'}`, `${c.assunto || '-'} · Emitido em ${formatarDataObra(dataDocumentoFinanceiroObra(c))} · ${status.texto}`, `Valor: ${moedaObra(totalOrcamentoObra(c))}`, status.classe === 'pago' ? verde : laranja);
    });
  }

  if (opcoes.etapas || opcoes.agendamentos) {
    tituloSecao('Etapas e cronograma');
    if (opcoes.etapas && !etapas.length && opcoes.agendamentos && !agendamentos.length) paragrafo('Nenhuma etapa ou agendamento registrado no período.', M, W, cinza);
    if (opcoes.etapas) etapas.forEach(ev => itemBox(ev.cliente || 'Etapa de obra', `${formatarDataObra(ev.data)}${ev.hora ? ' · ' + ev.hora.slice(0, 5) : ''}${ev.funcionariosNomes ? ' · ' + ev.funcionariosNomes : ''}`, [ev.local, ev.obs].filter(Boolean).join('\n'), verde));
    if (opcoes.agendamentos) agendamentos.forEach(ev => itemBox(ev.cliente || 'Agendamento', `${formatarDataObra(ev.data)}${ev.hora ? ' · ' + ev.hora.slice(0, 5) : ''}`, [ev.local, ev.obs].filter(Boolean).join('\n'), azulClaro));
  }

  if (opcoes.rendimentos) {
    tituloSecao('Rendimentos');
    paragrafo(`Rendimento total registrado no período: ${moedaObra(rendimento)}\nQuantidade de relatórios com rendimento: ${rels.filter(r => Number(r.rendimento) > 0).length}`);
  }

  if (opcoes.relatorios) {
    tituloSecao('Relatórios de obra');
    if (!rels.length) paragrafo('Nenhum relatório de obra registrado no período.', M, W, cinza);
    for (const rel of rels) {
      itemBox(rel.obra || obra.nome || 'Relatório', `${formatarDataObra(rel.data)} · ${rel.funcionariosNomes || rel.funcionarioNome || 'Sem funcionário'} · ${moedaObra(rel.rendimento || 0)}`, rel.obs || '', laranja);
      const imgs = normalizarArquivosDocumentoObra({ arquivos: rel.imagens }).filter(arquivoEhImagem).slice(0, 4);
      if (imgs.length) {
        let x = M;
        let rowH = 0;
        for (const img of imgs) {
          novaPaginaSePreciso(42);
          const h = await adicionarImagemPdf(doc, img.url || img.src, x, y, 42, 34);
          rowH = Math.max(rowH, h || 34);
          x += 46;
          if (x + 42 > M + W) { x = M; y += rowH + 5; rowH = 0; }
        }
        if (rowH) y += rowH + 5;
      }
    }
  }

  if (opcoes.documentos) {
    tituloSecao('Documentos selecionados');
    if (!docsSelecionados.length) paragrafo('Nenhum documento selecionado para o relatório.', M, W, cinza);
    for (const d of docsSelecionados) {
      itemBox(d.titulo || 'Documento', `${formatarDataObra(d.data)} · ${d.classificacao || 'Sem classificação'} · Rev. ${d.revisao || '00'} · ${d.status || 'Pendente'}`, d.descricao || '', d.status === 'Aprovado' ? verde : azul);
      const imgs = normalizarArquivosDocumentoObra(d).filter(arquivoEhImagem).slice(0, 3);
      for (const img of imgs) {
        novaPaginaSePreciso(52);
        const h = await adicionarImagemPdf(doc, img.url || img.src, M + 8, y, W - 16, 46);
        if (h) y += h + 5;
      }
    }
  }

  rodape();
  return doc;
}

async function atualizarPreviewRelatorioObraAvancado(obraId) {
  const inicio = document.getElementById('obra-rel-inicio')?.value || '';
  const fim = document.getElementById('obra-rel-fim')?.value || '';
  if (inicio && fim && inicio > fim) { mostrarToast('Data inicial maior que a data final.', 'erro'); return; }
  const frame = document.getElementById('obra-relatorio-preview-frame');
  if (frame) frame.srcdoc = '<div style="font-family:Arial;padding:24px">Gerando prévia...</div>';
  try {
    const opcoes = selecionarRelatorioObraOpcoes();
    const pdf = await gerarRelatorioPeriodoObraPDFAvancado(obraId, inicio, fim, opcoes);
    if (obraRelatorioPreviewUrl) URL.revokeObjectURL(obraRelatorioPreviewUrl);
    obraRelatorioPreviewAtual = { doc: pdf, obraId, inicio, fim };
    obraRelatorioPreviewUrl = URL.createObjectURL(pdf.output('blob'));
    if (frame) frame.src = obraRelatorioPreviewUrl;
  } catch (err) {
    console.error(err);
    mostrarToast('Erro ao gerar prévia do relatório.', 'erro');
  }
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
      <button type="button" onclick="criarEtapaObraDia('${escapeAttr(obraId)}', '${escapeAttr(dataStr)}')">Etapa / Cronograma</button>
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

function abrirEtapaCronogramaObra(obraId) {
  const obra = obras.find(o => o.id === obraId);
  window.abrirEtapaParaObra?.(obra, obra?.data || '');
}

function criarEtapaObraDia(obraId, dataStr) {
  const obra = obras.find(o => o.id === obraId);
  fecharMenuDiaObra();
  window.abrirEtapaParaObra?.(obra, dataStr);
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
  abrirMenuDiaObra, fecharMenuDiaObra, criarRelatorioObraDia, criarAgendamentoObraDia, abrirEtapaCronogramaObra, criarEtapaObraDia, criarOrcamentoObraDia, abrirOrcamentoAtrelado,
  abrirModalDocumentoObra, fecharModalDocumentoObra, handleArquivosDocumentoObra, removerArquivoDocumentoObra,
  salvarDocumentoObra, editarDocumentoObra, aprovarDocumentoObra, confirmarExcluirDocumentoObra,
  abrirRelatorioPeriodoObra: abrirRelatorioPeriodoObraAvancado,
  fecharRelatorioPeriodoObra,
  atualizarPreviewRelatorioObra: atualizarPreviewRelatorioObraAvancado,
  baixarRelatorioPeriodoObra,
  alternarDocumentosRelatorioObra,
  abrirModalObra, fecharModalObra, editarObra, salvarObra,
  marcarObraFinalizada, marcarObraExecucao, confirmarExcluirObra
});
