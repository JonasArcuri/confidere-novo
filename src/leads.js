import { DB, getUid } from './firebase.js';
import { escapeHtml, escapeAttr } from './utils.js';

const LEAD_STATUS = [
  { id: 'novo', label: 'Novo' },
  { id: 'contato', label: 'Em contato' },
  { id: 'proposta', label: 'Proposta' },
  { id: 'convertido', label: 'Convertido' },
  { id: 'perdido', label: 'Perdido' }
];

const configLeadsPadrao = {
  ativo: false,
  titulo: 'Solicite seu orçamento',
  descricao: 'Conte um pouco sobre o serviço que precisa.',
  origemPadrao: 'Site',
  solicitarEndereco: true,
  solicitarMensagem: true
};

window.leads = window.leads || [];
let leadArrastadoId = '';
let captacaoConfigAtual = { ...configLeadsPadrao };

function statusLeadValido(status) {
  return LEAD_STATUS.some(item => item.id === status) ? status : 'novo';
}

function formatarDataLead(valor) {
  if (!valor) return '';
  if (valor?.toDate) return valor.toDate().toLocaleString('pt-BR');
  const data = new Date(valor);
  return Number.isNaN(data.getTime()) ? '' : data.toLocaleString('pt-BR');
}

function normalizarLead(dados = {}) {
  return {
    nome: String(dados.nome || '').trim(),
    contato: String(dados.contato || '').trim(),
    email: String(dados.email || '').trim(),
    servico: String(dados.servico || '').trim(),
    local: String(dados.local || '').trim(),
    origem: String(dados.origem || captacaoConfigAtual.origemPadrao || 'Site').trim(),
    status: statusLeadValido(dados.status),
    observacoes: String(dados.observacoes || '').trim()
  };
}

function getLead(id) {
  return (window.leads || []).find(lead => lead.id === id);
}

function linkPublicoLeads() {
  try {
    const url = new URL(window.location.href);
    url.search = '';
    url.hash = '';
    url.searchParams.set('leadForm', getUid());
    return url.toString();
  } catch {
    return '';
  }
}

function iframePublicoLeads() {
  const src = linkPublicoLeads();
  return `<iframe src="${src}" title="Formulário de captação" style="width:100%;min-height:720px;border:0;"></iframe>`;
}

function preencherConfiguracaoLeads(config = {}) {
  captacaoConfigAtual = { ...configLeadsPadrao, ...(config || {}) };
  const ativo = document.getElementById('lead-config-ativo');
  const titulo = document.getElementById('lead-config-titulo');
  const descricao = document.getElementById('lead-config-descricao');
  const origem = document.getElementById('lead-config-origem');
  const endereco = document.getElementById('lead-config-endereco');
  const mensagem = document.getElementById('lead-config-mensagem');
  const link = document.getElementById('lead-public-link');

  if (ativo) ativo.checked = !!captacaoConfigAtual.ativo;
  if (titulo) titulo.value = captacaoConfigAtual.titulo || configLeadsPadrao.titulo;
  if (descricao) descricao.value = captacaoConfigAtual.descricao || configLeadsPadrao.descricao;
  if (origem) origem.value = captacaoConfigAtual.origemPadrao || 'Site';
  if (endereco) endereco.checked = !!captacaoConfigAtual.solicitarEndereco;
  if (mensagem) mensagem.checked = captacaoConfigAtual.solicitarMensagem !== false;
  if (link) link.value = linkPublicoLeads();
}

async function carregarConfiguracaoLeads() {
  try {
    const config = await DB.carregarCaptacaoLeads();
    preencherConfiguracaoLeads(config || {});
  } catch (err) {
    console.warn('Nao foi possivel carregar configuracao de leads:', err);
    preencherConfiguracaoLeads({});
  }
}

async function carregarLeads() {
  try {
    window.leads = await DB.listarLeads();
  } catch (err) {
    console.error('Erro ao carregar leads:', err);
    window.leads = window.leads || [];
  }
}

function renderizarResumoLeads() {
  const alvo = document.getElementById('leads-resumo');
  if (!alvo) return;
  const leads = window.leads || [];
  alvo.innerHTML = LEAD_STATUS.map(status => {
    const total = leads.filter(lead => statusLeadValido(lead.status) === status.id).length;
    return `<div class="lead-resumo-item"><span>${escapeHtml(status.label)}</span><strong>${total}</strong></div>`;
  }).join('');
}

function renderizarCardLead(lead) {
  const criado = formatarDataLead(lead.criadoEm);
  const convertido = statusLeadValido(lead.status) === 'convertido';
  return `<article class="lead-card" draggable="true" ondragstart="iniciarArrasteLead(event, '${escapeAttr(lead.id)}')">
    <div class="lead-card-head">
      <strong>${escapeHtml(lead.nome || 'Lead sem nome')}</strong>
      <button type="button" onclick="abrirModalLead('${escapeAttr(lead.id)}')" title="Editar lead" aria-label="Editar lead">Editar</button>
    </div>
    <div class="lead-card-servico">${escapeHtml(lead.servico || 'Serviço não informado')}</div>
    <div class="lead-card-meta">
      ${lead.contato ? `<span>${escapeHtml(lead.contato)}</span>` : ''}
      ${lead.local ? `<span>${escapeHtml(lead.local)}</span>` : ''}
      ${lead.origem ? `<span>${escapeHtml(lead.origem)}</span>` : ''}
      ${criado ? `<span>${escapeHtml(criado)}</span>` : ''}
    </div>
    ${lead.observacoes ? `<p>${escapeHtml(lead.observacoes)}</p>` : ''}
    <div class="lead-card-acoes">
      ${lead.contato ? `<a class="btn-secundario lead-mini-btn" href="${escapeAttr(getWhatsappLeadUrl(lead.contato))}" target="_blank" rel="noopener">WhatsApp</a>` : ''}
      <button type="button" class="btn-primario lead-mini-btn" onclick="converterLeadEmObra('${escapeAttr(lead.id)}')" ${convertido ? 'disabled' : ''}>Converter em obra</button>
    </div>
  </article>`;
}

function renderizarLeads() {
  const kanban = document.getElementById('leads-kanban');
  if (!kanban) return;
  carregarConfiguracaoLeads();
  const leads = window.leads || [];
  kanban.innerHTML = LEAD_STATUS.map(status => {
    const cards = leads.filter(lead => statusLeadValido(lead.status) === status.id);
    return `<section class="lead-coluna" data-lead-status="${escapeAttr(status.id)}" ondragover="permitirSoltarLead(event)" ondrop="soltarLead(event, '${escapeAttr(status.id)}')">
      <div class="lead-coluna-head">
        <h2>${escapeHtml(status.label)}</h2>
        <span>${cards.length}</span>
      </div>
      <div class="lead-coluna-lista">
        ${cards.length ? cards.map(renderizarCardLead).join('') : '<div class="lead-vazio">Sem leads neste status.</div>'}
      </div>
    </section>`;
  }).join('');
  renderizarResumoLeads();
}

async function inicializarLeads() {
  await Promise.all([carregarConfiguracaoLeads(), carregarLeads()]);
  renderizarLeads();
}

function abrirModalLead(id = '') {
  const lead = id ? getLead(id) : null;
  document.getElementById('lead-id-edit').value = id || '';
  document.getElementById('lead-modal-titulo').textContent = id ? 'Editar Lead' : 'Novo Lead';
  document.getElementById('lead-nome').value = lead?.nome || '';
  document.getElementById('lead-contato').value = lead?.contato || '';
  document.getElementById('lead-email').value = lead?.email || '';
  document.getElementById('lead-servico').value = lead?.servico || '';
  document.getElementById('lead-local').value = lead?.local || '';
  document.getElementById('lead-origem').value = lead?.origem || captacaoConfigAtual.origemPadrao || 'Site';
  document.getElementById('lead-status').value = statusLeadValido(lead?.status || 'novo');
  document.getElementById('lead-observacoes').value = lead?.observacoes || '';
  document.getElementById('modal-lead')?.classList.add('aberto');
}

function fecharModalLead() {
  document.getElementById('modal-lead')?.classList.remove('aberto');
}

async function salvarLead() {
  const id = document.getElementById('lead-id-edit')?.value || '';
  const dados = normalizarLead({
    nome: document.getElementById('lead-nome')?.value,
    contato: document.getElementById('lead-contato')?.value,
    email: document.getElementById('lead-email')?.value,
    servico: document.getElementById('lead-servico')?.value,
    local: document.getElementById('lead-local')?.value,
    origem: document.getElementById('lead-origem')?.value,
    status: document.getElementById('lead-status')?.value,
    observacoes: document.getElementById('lead-observacoes')?.value
  });

  if (!dados.nome || !dados.contato) {
    window.mostrarToast?.('Informe nome e contato do lead.', 'erro');
    return;
  }

  try {
    const leadId = await DB.salvarLead(dados, id || null);
    if (id) {
      window.leads = (window.leads || []).map(lead => lead.id === id ? { ...lead, ...dados } : lead);
    } else {
      window.leads = [{ id: leadId, ...dados, criadoEm: new Date().toISOString() }, ...(window.leads || [])];
    }
    fecharModalLead();
    renderizarLeads();
    window.mostrarToast?.('Lead salvo.', 'sucesso');
  } catch (err) {
    console.error('Erro ao salvar lead:', err);
    window.mostrarToast?.('Erro ao salvar lead.', 'erro');
  }
}

function iniciarArrasteLead(event, id) {
  leadArrastadoId = id;
  event.dataTransfer?.setData('text/plain', id);
  event.dataTransfer.effectAllowed = 'move';
}

function permitirSoltarLead(event) {
  event.preventDefault();
  event.dataTransfer.dropEffect = 'move';
}

async function soltarLead(event, status) {
  event.preventDefault();
  const id = event.dataTransfer?.getData('text/plain') || leadArrastadoId;
  await atualizarStatusLead(id, status);
}

async function atualizarStatusLead(id, status) {
  const lead = getLead(id);
  const novoStatus = statusLeadValido(status);
  if (!lead || statusLeadValido(lead.status) === novoStatus) return;
  try {
    await DB.salvarLead({ status: novoStatus }, id);
    lead.status = novoStatus;
    renderizarLeads();
  } catch (err) {
    console.error('Erro ao atualizar status do lead:', err);
    window.mostrarToast?.('Erro ao mover lead.', 'erro');
  }
}

function getWhatsappLeadUrl(contato = '') {
  const digitos = String(contato || '').replace(/\D/g, '');
  if (!digitos) return '#';
  const numero = digitos.startsWith('55') ? digitos : `55${digitos}`;
  return `https://wa.me/${numero}`;
}

async function converterLeadEmObra(id) {
  const lead = getLead(id);
  if (!lead) return;
  const hoje = new Date().toISOString().slice(0, 10);
  const dadosObra = {
    nome: lead.servico || `Obra - ${lead.nome}`,
    construtora: lead.nome || '',
    responsavel: lead.nome || '',
    contatoResponsavel: lead.contato || lead.email || '',
    data: hoje,
    local: lead.local || '',
    status: 'execucao',
    leadId: id,
    origemLead: lead.origem || 'Lead'
  };

  try {
    const obraId = await DB.salvarObra(dadosObra);
    window.obras = [...(window.obras || []), { id: obraId, ...dadosObra }];
    await DB.salvarLead({ status: 'convertido', obraId, convertidoEm: hoje }, id);
    Object.assign(lead, { status: 'convertido', obraId, convertidoEm: hoje });
    window.renderizarObras?.();
    renderizarLeads();
    window.mostrarToast?.('Lead convertido em obra.', 'sucesso');
  } catch (err) {
    console.error('Erro ao converter lead:', err);
    window.mostrarToast?.('Erro ao converter lead em obra.', 'erro');
  }
}

async function salvarConfiguracaoLeads() {
  const config = {
    ativo: !!document.getElementById('lead-config-ativo')?.checked,
    titulo: document.getElementById('lead-config-titulo')?.value || configLeadsPadrao.titulo,
    descricao: document.getElementById('lead-config-descricao')?.value || '',
    origemPadrao: document.getElementById('lead-config-origem')?.value || 'Site',
    solicitarEndereco: !!document.getElementById('lead-config-endereco')?.checked,
    solicitarMensagem: !!document.getElementById('lead-config-mensagem')?.checked,
    empresaNome: window.empresaConfig?.empresaNome || '',
    empresaContato: window.empresaConfig?.empresaContato || '',
    empresaUrl: window.empresaConfig?.empresaUrl || ''
  };

  try {
    await DB.salvarCaptacaoLeads(config);
    preencherConfiguracaoLeads(config);
    window.mostrarToast?.('Configuração de leads salva.', 'sucesso');
  } catch (err) {
    console.error('Erro ao salvar configuracao de leads:', err);
    window.mostrarToast?.('Erro ao salvar configuração de leads.', 'erro');
  }
}

async function copiarTextoLeads(texto, mensagem) {
  try {
    await navigator.clipboard.writeText(texto);
    window.mostrarToast?.(mensagem, 'sucesso');
  } catch {
    window.mostrarToast?.('Nao foi possivel copiar automaticamente.', 'erro');
  }
}

function copiarLinkLeads() {
  copiarTextoLeads(linkPublicoLeads(), 'Link copiado.');
}

function copiarEmbedLeads() {
  copiarTextoLeads(iframePublicoLeads(), 'Iframe copiado.');
}

function getLeadFormUserId() {
  const params = new URLSearchParams(window.location.search);
  return params.get('leadForm') || params.get('lead') || '';
}

function renderPublicLeadShell(config) {
  document.body.classList.add('lead-public-mode');
  document.body.innerHTML = `<main class="lead-public-page">
    <section class="lead-public-card">
      <div class="lead-public-brand">
        <img src="landing-obraflux/assets/obraflux-somentelogo-crop.png" alt="">
        <span>${escapeHtml(config.empresaNome || 'ObraFlux')}</span>
      </div>
      <h1>${escapeHtml(config.titulo || configLeadsPadrao.titulo)}</h1>
      ${config.descricao ? `<p>${escapeHtml(config.descricao)}</p>` : ''}
      <form id="lead-public-form" class="lead-public-form">
        <label>Nome<input name="nome" required autocomplete="name"></label>
        <label>Telefone / WhatsApp<input name="contato" required autocomplete="tel"></label>
        <label>E-mail<input name="email" type="email" autocomplete="email"></label>
        <label>Serviço / Obra<input name="servico" placeholder="O que você precisa?"></label>
        ${config.solicitarEndereco ? '<label>Local<input name="local" placeholder="Cidade, bairro ou endereço"></label>' : ''}
        ${config.solicitarMensagem !== false ? '<label>Mensagem<textarea name="observacoes" rows="4" placeholder="Detalhes, prazo, melhor horário para contato..."></textarea></label>' : ''}
        <button type="submit" class="btn-primario">Enviar solicitação</button>
      </form>
      <div id="lead-public-retorno" class="lead-public-retorno"></div>
    </section>
  </main>`;
}

async function inicializarFormularioPublico(userId) {
  window.ObraFluxPublicLeadMode = true;
  try {
    const config = { ...configLeadsPadrao, ...((await DB.carregarCaptacaoLeads(userId)) || {}) };
    renderPublicLeadShell(config);
    const retorno = document.getElementById('lead-public-retorno');
    if (!config.ativo) {
      document.getElementById('lead-public-form')?.remove();
      retorno.textContent = 'Formulario indisponivel no momento.';
      return;
    }

    document.getElementById('lead-public-form')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const data = new FormData(form);
      const dados = normalizarLead({
        nome: data.get('nome'),
        contato: data.get('contato'),
        email: data.get('email'),
        servico: data.get('servico'),
        local: data.get('local'),
        origem: config.origemPadrao || 'Site',
        status: 'novo',
        observacoes: data.get('observacoes')
      });
      if (!dados.nome || !dados.contato) return;
      const botao = form.querySelector('button');
      botao?.setAttribute('disabled', 'disabled');
      try {
        await DB.salvarLeadPublico(userId, dados);
        form.reset();
        retorno.textContent = 'Solicitação enviada. A equipe entrará em contato.';
      } catch (err) {
        console.error('Erro ao enviar lead publico:', err);
        retorno.textContent = 'Nao foi possivel enviar agora. Tente novamente em instantes.';
      } finally {
        botao?.removeAttribute('disabled');
      }
    });
  } catch (err) {
    document.body.classList.add('lead-public-mode');
    document.body.innerHTML = '<main class="lead-public-page"><section class="lead-public-card"><h1>Formulario indisponivel</h1><p>Tente novamente mais tarde.</p></section></main>';
  }
}

const publicUserId = getLeadFormUserId();
if (publicUserId) {
  inicializarFormularioPublico(publicUserId);
}

Object.assign(window, {
  inicializarLeads,
  carregarLeads,
  renderizarLeads,
  abrirModalLead,
  fecharModalLead,
  salvarLead,
  iniciarArrasteLead,
  permitirSoltarLead,
  soltarLead,
  atualizarStatusLead,
  converterLeadEmObra,
  salvarConfiguracaoLeads,
  copiarLinkLeads,
  copiarEmbedLeads
});
