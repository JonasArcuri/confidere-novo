import { DB } from './firebase.js';
import { escapeHtml, escapeAttr, setOptions } from './utils.js';

let calMes = new Date().getMonth();
let calAno = new Date().getFullYear();
let relFuncionariosSelected = [];
let agendamentoArrastandoId = null;
let agendamentoObraContextId = '';

window.agendamentos = window.agendamentos || [];
window.funcionarios = window.funcionarios || [];
window.relatorios = window.relatorios || [];

function garantirArrayGlobal(nome) {
  const interno = '_' + nome;
  if (!Object.getOwnPropertyDescriptor(window, nome)?.get) {
    window[interno] = window[nome] || [];
    Object.defineProperty(window, nome, {
      get() { return this[interno] || []; },
      set(v) { this[interno] = Array.isArray(v) ? v : []; },
      configurable: true
    });
  }
}

garantirArrayGlobal('agendamentos');
garantirArrayGlobal('funcionarios');
garantirArrayGlobal('relatorios');

const MESES = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
const DIAS_SEMANA = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];

function formatarData(data) {
  return data ? new Date(data + 'T12:00:00').toLocaleDateString('pt-BR') : '-';
}

function formatarHora(hora) {
  return hora ? String(hora).slice(0, 5) : '';
}

function mudarSubAba(sub, btn) {
  document.querySelectorAll('.gestao-sub-aba').forEach(a => a.classList.remove('ativo'));
  document.querySelectorAll('.gestao-sub-tab').forEach(b => b.classList.remove('ativo'));
  document.getElementById('sub-' + sub)?.classList.add('ativo');
  btn?.classList.add('ativo');
  if (sub === 'calendario') renderizarCalendario();
  if (sub === 'funcionarios') renderizarFuncionarios();
  if (sub === 'relatorios') renderizarRelatorios();
  if (sub === 'insumos') { window.popularSelectFuncionariosIns?.(); window.renderizarInsumos?.(); }
  if (sub === 'obras') window.renderizarObras?.();
}

function getEventosDia(dataStr) {
  return agendamentos.filter(a => a.data === dataStr).sort((a, b) => (a.hora || '').localeCompare(b.hora || ''));
}

function iniciarArrasteAgendamento(event, id) {
  agendamentoArrastandoId = id;
  document.body.classList.add('arrastando-agendamento');
  event.dataTransfer.effectAllowed = 'move';
  event.dataTransfer.setData('text/plain', id);
}

function finalizarArrasteAgendamento() {
  agendamentoArrastandoId = null;
  document.body.classList.remove('arrastando-agendamento');
  document.querySelectorAll('.cal-celula.drop-hover').forEach(el => el.classList.remove('drop-hover'));
}

function conflitoAgendamentoHorario(id, novaData) {
  const ag = agendamentos.find(a => a.id === id);
  if (!ag?.hora) return false;
  return agendamentos.some(a => a.id !== id && a.data === novaData && a.hora === ag.hora);
}

function pedirNovaHoraAgendamento(id, novaData) {
  const ag = agendamentos.find(a => a.id === id);
  if (!ag) return;
  mostrarToast('Já existe um agendamento nesta data e horário. Escolha outra hora.', 'erro');
  fecharDetalheDia();
  abrirModalAgendamento(id);
  document.getElementById('agend-data').value = novaData;
  document.getElementById('agend-hora').value = '';
  setTimeout(() => document.getElementById('agend-hora')?.focus(), 80);
}

async function moverAgendamentoParaDia(id, novaData) {
  const ag = agendamentos.find(a => a.id === id);
  if (!ag || ag.data === novaData) return;

  if (conflitoAgendamentoHorario(id, novaData)) {
    pedirNovaHoraAgendamento(id, novaData);
    return;
  }

  try {
    await DB.salvarAgendamento({ data: novaData }, id);
    ag.data = novaData;
    fecharDetalheDia();
    renderizarCalendario();
    mostrarToast('Agendamento movido.', 'sucesso');
  } catch (err) {
    console.error(err);
    mostrarToast('Erro ao mover agendamento.', 'erro');
  }
}

function prepararDropDia(el, dataStr) {
  el.addEventListener('dragover', (event) => {
    if (!agendamentoArrastandoId) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    el.classList.add('drop-hover');
  });
  el.addEventListener('dragleave', () => el.classList.remove('drop-hover'));
  el.addEventListener('drop', async (event) => {
    if (!agendamentoArrastandoId) return;
    event.preventDefault();
    const id = event.dataTransfer.getData('text/plain') || agendamentoArrastandoId;
    finalizarArrasteAgendamento();
    await moverAgendamentoParaDia(id, dataStr);
  });
}

function renderizarCalendario() {
  const label = document.getElementById('cal-mes-label');
  const grid = document.getElementById('cal-grid');
  if (!label || !grid) return;
  label.textContent = `${MESES[calMes]} ${calAno}`;
  grid.innerHTML = '';

  DIAS_SEMANA.forEach(d => {
    const el = document.createElement('div');
    el.className = 'cal-dia-semana';
    el.textContent = d;
    grid.appendChild(el);
  });

  const primeiroDia = new Date(calAno, calMes, 1).getDay();
  const totalDias = new Date(calAno, calMes + 1, 0).getDate();
  const hoje = new Date();

  for (let i = 0; i < primeiroDia; i++) {
    const vazio = document.createElement('div');
    vazio.className = 'cal-celula vazia';
    grid.appendChild(vazio);
  }

  for (let dia = 1; dia <= totalDias; dia++) {
    const dataStr = `${calAno}-${String(calMes + 1).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
    const el = document.createElement('div');
    el.className = 'cal-celula';
    prepararDropDia(el, dataStr);
    if (dia === hoje.getDate() && calMes === hoje.getMonth() && calAno === hoje.getFullYear()) el.classList.add('hoje');
    el.innerHTML = `<span class="cal-num">${dia}</span>`;

    const eventos = getEventosDia(dataStr);
    const relDia = relatorios.filter(r => r.data === dataStr);
    const insDia = (window.insumos || []).filter(i => i.data === dataStr);

    eventos.slice(0, 2).forEach(ev => {
      const badge = document.createElement('div');
      badge.className = 'cal-evento agendamento';
      badge.draggable = true;
      badge.dataset.agendamentoId = ev.id;
      badge.textContent = `${formatarHora(ev.hora) ? formatarHora(ev.hora) + ' ' : ''}${ev.cliente || ev.titulo || 'Agendamento'}`;
      badge.addEventListener('dragstart', (event) => iniciarArrasteAgendamento(event, ev.id));
      badge.addEventListener('dragend', finalizarArrasteAgendamento);
      el.appendChild(badge);
    });
    relDia.slice(0, 1).forEach(rel => {
      const badge = document.createElement('div');
      badge.className = 'cal-evento relatorio';
      badge.textContent = rel.obra || 'Relatório';
      el.appendChild(badge);
    });
    insDia.slice(0, 1).forEach(ins => {
      const badge = document.createElement('div');
      badge.className = 'cal-evento insumo';
      badge.textContent = ins.descricao || ins.tipo || 'Insumo';
      el.appendChild(badge);
    });

    const totalEventos = eventos.length + relDia.length + insDia.length;
    if (totalEventos > 3) {
      const more = document.createElement('div');
      more.className = 'cal-mais';
      more.textContent = `+${totalEventos - 3}`;
      el.appendChild(more);
    }
    el.addEventListener('click', () => abrirDiaDetalhe(dataStr, dia));
    grid.appendChild(el);
  }
}

function calAnterior() { calMes--; if (calMes < 0) { calMes = 11; calAno--; } renderizarCalendario(); }
function calProximo() { calMes++; if (calMes > 11) { calMes = 0; calAno++; } renderizarCalendario(); }
function calHoje() { const h = new Date(); calMes = h.getMonth(); calAno = h.getFullYear(); renderizarCalendario(); }

function abrirDiaDetalhe(dataStr, dia) {
  const eventos = getEventosDia(dataStr);
  const rels = relatorios.filter(r => r.data === dataStr);
  const ins = (window.insumos || []).filter(i => i.data === dataStr);
  let html = `<div class="detalhe-data-titulo">${dia} de ${escapeHtml(MESES[calMes])}, ${calAno}</div>`;
  if (!eventos.length && !rels.length && !ins.length) html += '<p class="detalhe-vazio">Nenhum evento neste dia.</p>';

  if (eventos.length) {
    html += '<div class="detalhe-secao-label">Agendamentos</div>';
    eventos.forEach(ev => {
      const func = funcionarios.find(f => f.id === ev.funcionarioId);
      html += `<div class="detalhe-item agend agendamento-draggable" draggable="true" ondragstart="iniciarArrasteAgendamento(event, '${escapeAttr(ev.id)}')" ondragend="finalizarArrasteAgendamento()">
        <div class="detalhe-item-titulo">${escapeHtml(ev.cliente || ev.titulo || '')}</div>
        <div class="detalhe-item-meta">${formatarHora(ev.hora) ? 'Hora: ' + escapeHtml(formatarHora(ev.hora)) + ' · ' : ''}${func ? 'Funcionário: ' + escapeHtml(func.nome) : ''}</div>
        ${ev.local ? `<div class="detalhe-item-meta">Local: ${escapeHtml(ev.local)}</div>` : ''}
        ${ev.obs ? `<div class="detalhe-item-obs">${escapeHtml(ev.obs)}</div>` : ''}
        <button class="btn-mini editar" onclick="editarAgendamento('${escapeAttr(ev.id)}')">Editar</button>
        <button class="btn-mini excluir" onclick="excluirAgendamento('${escapeAttr(ev.id)}')">Excluir</button>
      </div>`;
    });
  }

  if (rels.length) {
    html += '<div class="detalhe-secao-label">Relatórios de Obra</div>';
    rels.forEach(rel => {
      html += `<div class="detalhe-item relat">
        <div class="detalhe-item-titulo">${escapeHtml(rel.obra || '')}</div>
        <div class="detalhe-item-meta">Funcionário(s): ${escapeHtml(rel.funcionariosNomes || rel.funcionarioNome || '-')}</div>
        <div class="detalhe-item-meta">Rendimento: <strong>${formatarMoeda(rel.rendimento || 0)}</strong></div>
        ${rel.obs ? `<div class="detalhe-item-obs">${escapeHtml(rel.obs)}</div>` : ''}
        <button class="btn-mini excluir" onclick="excluirRelatorio('${escapeAttr(rel.id)}')">Excluir</button>
      </div>`;
    });
  }

  if (ins.length) {
    html += '<div class="detalhe-secao-label">Insumos / Despesas</div>';
    ins.forEach(i => {
      html += `<div class="detalhe-item" style="border-left-color:#7c5cbf;">
        <div class="detalhe-item-titulo">${escapeHtml(i.descricao || i.tipo || '')}</div>
        <div class="detalhe-item-meta">Valor: <strong>${formatarMoeda(i.valor || 0)}</strong></div>
        ${i.obs ? `<div class="detalhe-item-obs">${escapeHtml(i.obs)}</div>` : ''}
        <button class="btn-mini excluir" onclick="confirmarExcluirInsumo('${escapeAttr(i.id)}')">Excluir</button>
      </div>`;
    });
  }

  document.getElementById('detalhe-corpo').innerHTML = html;
  document.getElementById('modal-detalhe-dia').classList.add('aberto');
}

function fecharDetalheDia() { document.getElementById('modal-detalhe-dia')?.classList.remove('aberto'); }

function popularSelectFuncionariosAgend() {
  const sel = document.getElementById('agend-funcionario');
  if (!sel) return;
  setOptions(sel, funcionarios.map(f => ({ value: f.id, label: f.nome })), { value: '', label: 'Selecione (opcional)' }, sel.value || '');
}

function abrirModalAgendamento(id = null) {
  popularSelectFuncionariosAgend();
  agendamentoObraContextId = '';
  document.getElementById('agend-id-edit').value = id || '';
  document.getElementById('agend-cliente').value = '';
  document.getElementById('agend-data').value = new Date().toISOString().split('T')[0];
  document.getElementById('agend-hora').value = '';
  document.getElementById('agend-local').value = '';
  document.getElementById('agend-obs').value = '';
  document.getElementById('agend-funcionario').value = '';
  if (id) {
    const ag = agendamentos.find(a => a.id === id);
    if (ag) {
      document.getElementById('agend-cliente').value = ag.cliente || '';
      document.getElementById('agend-data').value = ag.data || '';
      document.getElementById('agend-hora').value = ag.hora || '';
      document.getElementById('agend-local').value = ag.local || '';
      document.getElementById('agend-obs').value = ag.obs || '';
      document.getElementById('agend-funcionario').value = ag.funcionarioId || '';
      agendamentoObraContextId = ag.obraId || '';
    }
  }
  document.getElementById('modal-agendamento').classList.add('aberto');
}

function fecharModalAgendamento() { document.getElementById('modal-agendamento')?.classList.remove('aberto'); }

function editarAgendamento(id) {
  fecharDetalheDia();
  abrirModalAgendamento(id);
}

async function salvarAgendamento() {
  const cliente = document.getElementById('agend-cliente').value.trim();
  const data = document.getElementById('agend-data').value;
  const hora = document.getElementById('agend-hora')?.value || '';
  const local = document.getElementById('agend-local').value.trim();
  const obs = document.getElementById('agend-obs').value.trim();
  const funcionarioId = document.getElementById('agend-funcionario').value;
  const idEdit = document.getElementById('agend-id-edit').value;
  if (!cliente || !data) { mostrarToast('Informe cliente e data.', 'erro'); return; }
  if (hora && agendamentos.some(a => a.id !== idEdit && a.data === data && a.hora === hora)) {
    mostrarToast('Já existe um agendamento nesta data e horário. Escolha outra hora.', 'erro');
    document.getElementById('agend-hora')?.focus();
    return;
  }
  const dados = { cliente, data, hora, local, obs, funcionarioId, obraId: agendamentoObraContextId || '' };
  try {
    if (idEdit) {
      await DB.salvarAgendamento(dados, idEdit);
      const idx = agendamentos.findIndex(a => a.id === idEdit);
      if (idx >= 0) agendamentos[idx] = { ...agendamentos[idx], ...dados };
      mostrarToast('Agendamento atualizado!', 'sucesso');
    } else {
      const newId = await DB.salvarAgendamento(dados);
      agendamentos.push({ id: newId, ...dados });
      mostrarToast('Agendamento salvo!', 'sucesso');
    }
    fecharModalAgendamento();
    renderizarCalendario();
    window.renderizarObras?.();
  } catch (err) {
    console.error(err);
    mostrarToast('Erro ao salvar agendamento.', 'erro');
  }
}

async function excluirAgendamento(id) {
  try {
    await DB.excluirAgendamento(id);
    agendamentos = agendamentos.filter(a => a.id !== id);
    fecharDetalheDia();
    renderizarCalendario();
    mostrarToast('Agendamento removido.', '');
  } catch { mostrarToast('Erro ao excluir agendamento.', 'erro'); }
}

function renderizarFuncionarios() {
  const cont = document.getElementById('func-lista');
  if (!cont) return;
  if (!funcionarios.length) {
    cont.innerHTML = '<div class="hist-vazio"><div class="icone"></div><p>Nenhum funcionário cadastrado.</p></div>';
    return;
  }
  cont.innerHTML = funcionarios.map(f => {
    const admFmt = formatarData(f.admissao);
    const status = f.status === 'inativo' || f.ativo === false ? '<span class="func-tipo-badge" style="background:#fff0e8;color:#c2410c">Inativo</span>' : '';
    return `<div class="func-card">
      <div>
        <div class="func-card-nome">${escapeHtml(f.nome || '')}</div>
        <div class="func-card-meta"><span class="func-tipo-badge">${escapeHtml(f.tipoSalario || 'Custo Mensal')}</span> ${f.salario ? formatarMoeda(f.salario) : ''} ${status}</div>
        <div class="func-card-meta">Admissão: ${escapeHtml(admFmt)}</div>
        ${f.dataDemissao ? `<div class="func-card-meta">Demissão/Rescisão: ${escapeHtml(formatarData(f.dataDemissao))}</div>` : ''}
        ${f.telefone ? `<div class="func-card-meta">${escapeHtml(f.telefone)}</div>` : ''}
      </div>
      <div class="func-card-acoes">
        <button class="btn-mini editar" onclick="editarFuncionario('${escapeAttr(f.id)}')">Editar</button>
        <button class="btn-mini excluir" onclick="confirmarExcluirFuncionario('${escapeAttr(f.id)}')">Excluir</button>
      </div>
    </div>`;
  }).join('');
}

function setDiasTrabalhadosFuncionarioModal(map = {}) {
  let hidden = document.getElementById('func-dias-trabalhados');
  if (!hidden) {
    hidden = document.createElement('input');
    hidden.type = 'hidden';
    hidden.id = 'func-dias-trabalhados';
    document.getElementById('modal-funcionario')?.appendChild(hidden);
  }
  hidden.value = JSON.stringify(map || {});
}

function aplicarExtrasFuncionarioModal(func = null) {
  const status = func?.status || (func?.ativo === false ? 'inativo' : 'ativo');
  const dataDemissao = func?.dataDemissao || func?.dataRescisao || '';
  window.setStatusFuncionario?.(status, dataDemissao);
  setDiasTrabalhadosFuncionarioModal(func?.diasTrabalhados || {});
  window.atualizarVisibilidadeCalendarioDiaria?.();
}

function abrirModalFuncionario(id = null) {
  document.getElementById('modal-func-titulo').textContent = id ? 'Editar Funcionário' : 'Novo Funcionário';
  document.getElementById('func-id-edit').value = id || '';
  document.getElementById('func-nome').value = '';
  document.getElementById('func-admissao').value = '';
  document.getElementById('func-salario').value = '';
  document.getElementById('func-tipo-salario').value = 'Custo Mensal';
  document.getElementById('func-telefone').value = '';
  aplicarExtrasFuncionarioModal(null);
  if (id) {
    const f = funcionarios.find(x => x.id === id);
    if (f) {
      document.getElementById('func-nome').value = f.nome || '';
      document.getElementById('func-admissao').value = f.admissao || '';
      document.getElementById('func-salario').value = f.salario || '';
      document.getElementById('func-tipo-salario').value = f.tipoSalario || 'Custo Mensal';
      document.getElementById('func-telefone').value = f.telefone || '';
      aplicarExtrasFuncionarioModal(f);
    }
  }
  document.getElementById('modal-funcionario').classList.add('aberto');
}

function fecharModalFuncionario() { document.getElementById('modal-funcionario')?.classList.remove('aberto'); }
function editarFuncionario(id) { abrirModalFuncionario(id); }

function coletarDadosExtrasFuncionario() {
  const status = document.getElementById('func-status')?.value === 'inativo' ? 'inativo' : 'ativo';
  const dataDemissao = status === 'inativo' ? (document.getElementById('func-demissao')?.value || '') : '';
  let diasTrabalhados = {};
  try { diasTrabalhados = JSON.parse(document.getElementById('func-dias-trabalhados')?.value || '{}') || {}; } catch {}
  return { status, ativo: status === 'ativo', dataDemissao, dataRescisao: dataDemissao, diasTrabalhados };
}

async function salvarFuncionario() {
  const nome = document.getElementById('func-nome').value.trim();
  const admissao = document.getElementById('func-admissao').value;
  const salario = parseFloat(document.getElementById('func-salario').value) || 0;
  const tipoSalario = document.getElementById('func-tipo-salario').value;
  const telefone = document.getElementById('func-telefone').value.trim();
  const idEdit = document.getElementById('func-id-edit').value;
  if (!nome) { mostrarToast('Informe o nome do funcionário.', 'erro'); return; }
  const dados = { nome, admissao, salario, tipoSalario, telefone, ...coletarDadosExtrasFuncionario() };
  try {
    if (idEdit) {
      await DB.salvarFuncionario(dados, idEdit);
      const idx = funcionarios.findIndex(f => f.id === idEdit);
      if (idx >= 0) funcionarios[idx] = { ...funcionarios[idx], ...dados };
      mostrarToast('Funcionário atualizado!', 'sucesso');
    } else {
      const newId = await DB.salvarFuncionario(dados);
      funcionarios.push({ id: newId, ...dados });
      mostrarToast('Funcionário cadastrado!', 'sucesso');
    }
    fecharModalFuncionario();
    renderizarFuncionarios();
    popularSelectFuncionariosRel();
    popularSelectFuncionariosAgend();
    window.popularSelectFuncionariosIns?.();
    window.renderizarFluxoFinanceiro?.();
  } catch (err) {
    console.error(err);
    mostrarToast('Erro ao salvar funcionário.', 'erro');
  }
}

function confirmarExcluirFuncionario(id) {
  const f = funcionarios.find(x => x.id === id);
  abrirModal('Excluir Funcionário', `Excluir "${f?.nome || ''}"? Esta ação não pode ser desfeita.`, async () => {
    try {
      await DB.excluirFuncionario(id);
      funcionarios = funcionarios.filter(x => x.id !== id);
      renderizarFuncionarios();
      popularSelectFuncionariosRel();
      mostrarToast('Funcionário removido.', '');
    } catch { mostrarToast('Erro ao excluir funcionário.', 'erro'); }
  });
}

function popularSelectFuncionariosRel() {
  ['rel-funcionario', 'filtro-rel-func', 'agend-funcionario'].forEach(selId => {
    const sel = document.getElementById(selId);
    if (!sel) return;
    const atual = sel.value;
    const placeholder = selId === 'filtro-rel-func' ? { value: '', label: 'Todos os funcionários' } : selId === 'agend-funcionario' ? { value: '', label: 'Selecione (opcional)' } : { value: '', label: 'Selecione o funcionário' };
    setOptions(sel, funcionarios.map(f => ({ value: f.id, label: f.nome })), placeholder, atual);
  });
  popularCheckboxFuncionariosRel();
}

function popularCheckboxFuncionariosRel() {
  const cont = document.getElementById('rel-funcionarios-check');
  if (!cont) return;
  if (!funcionarios.length) { cont.innerHTML = '<div style="font-size:13px;color:var(--cinza-texto)">Nenhum funcionário cadastrado.</div>'; return; }
  cont.innerHTML = funcionarios.map(f => `<label class="func-check-item"><input type="checkbox" value="${escapeAttr(f.id)}" ${relFuncionariosSelected.includes(f.id) ? 'checked' : ''} onchange="toggleFuncRel(this)"><span>${escapeHtml(f.nome)}</span></label>`).join('');
}

function toggleFuncRel(cb) {
  if (cb.checked) { if (!relFuncionariosSelected.includes(cb.value)) relFuncionariosSelected.push(cb.value); }
  else relFuncionariosSelected = relFuncionariosSelected.filter(id => id !== cb.value);
}

function popularSelectObrasRel() {
  const sel = document.getElementById('rel-obra-select');
  if (!sel) return;
  const atual = sel.value;
  setOptions(sel, (window.obras || []).map(o => ({ value: o.id, label: o.nome + (o.construtora ? ' - ' + o.construtora : ''), dataset: { nome: o.nome } })), { value: '', label: 'Digitar manualmente...' }, atual);
  sincronizarObraTexto();
}

function sincronizarObraTexto() {
  const sel = document.getElementById('rel-obra-select');
  const input = document.getElementById('rel-obra');
  const wrap = document.getElementById('rel-obra-manual-wrap');
  if (!sel || !input) return;
  const opt = sel.options[sel.selectedIndex];
  if (opt?.dataset?.nome) { input.value = opt.dataset.nome; input.style.display = 'none'; if (wrap) wrap.style.display = 'none'; }
  else { input.style.display = ''; if (wrap) wrap.style.display = ''; }
}

function renderizarRelatorios() { aplicarFiltrosRelatorio(); }

function relatorioTemFuncionario(rel, funcionarioId) {
  if (!funcionarioId) return true;
  if (Array.isArray(rel.funcionariosIds) && rel.funcionariosIds.includes(funcionarioId)) return true;
  return rel.funcionarioId === funcionarioId;
}

function aplicarFiltrosRelatorio() {
  const filtroFunc = document.getElementById('filtro-rel-func')?.value || '';
  const filtroMes = document.getElementById('filtro-rel-mes')?.value || '';
  const filtroDia = document.getElementById('filtro-rel-dia')?.value || '';
  let lista = [...relatorios];
  if (filtroFunc) lista = lista.filter(r => relatorioTemFuncionario(r, filtroFunc));
  if (filtroMes) lista = lista.filter(r => r.data?.startsWith(filtroMes));
  if (filtroDia) lista = lista.filter(r => r.data === filtroDia);
  lista.sort((a, b) => (b.data || '').localeCompare(a.data || ''));
  const cont = document.getElementById('rel-lista');
  if (!cont) return;
  if (!lista.length) { cont.innerHTML = '<div class="hist-vazio"><div class="icone"></div><p>Nenhum relatório encontrado.</p></div>'; return; }
  cont.innerHTML = lista.map(rel => `<div class="rel-card">
    <div class="rel-card-header"><div class="rel-card-info"><div class="rel-card-obra">${escapeHtml(rel.obra || '')}</div><div class="rel-card-meta">${escapeHtml(formatarData(rel.data))}</div><div class="rel-card-meta">${escapeHtml(rel.funcionariosNomes || rel.funcionarioNome || '-')}</div>${rel.obs ? `<div class="rel-card-obs">${escapeHtml(rel.obs)}</div>` : ''}</div><div class="rel-card-valor"><div class="rel-card-valor-label">Rendimento</div><div class="rel-card-valor-num">${formatarMoeda(rel.rendimento || 0)}</div></div></div>
    <div class="rel-card-acoes"><button class="btn-mini editar" onclick="editarRelatorio('${escapeAttr(rel.id)}')">Editar</button><button class="btn-mini excluir" onclick="confirmarExcluirRelatorio('${escapeAttr(rel.id)}')">Excluir</button></div>
  </div>`).join('');
}

function abrirModalRelatorio(id = null) {
  popularSelectFuncionariosRel();
  popularSelectObrasRel();
  relFuncionariosSelected = [];
  document.getElementById('rel-id-edit').value = id || '';
  document.getElementById('rel-obra').value = '';
  document.getElementById('rel-data').value = new Date().toISOString().split('T')[0];
  document.getElementById('rel-rendimento').value = '';
  document.getElementById('rel-obs').value = '';
  document.getElementById('rel-funcionario').value = '';
  document.getElementById('modal-rel-titulo').textContent = id ? 'Editar Relatório' : 'Novo Relatório de Obra';
  const selObra = document.getElementById('rel-obra-select');
  if (selObra) selObra.value = '';
  if (id) {
    const rel = relatorios.find(r => r.id === id);
    if (rel) {
      document.getElementById('rel-obra').value = rel.obra || '';
      document.getElementById('rel-data').value = rel.data || '';
      document.getElementById('rel-rendimento').value = rel.rendimento || '';
      document.getElementById('rel-obs').value = rel.obs || '';
      document.getElementById('rel-funcionario').value = rel.funcionarioId || '';
      relFuncionariosSelected = Array.isArray(rel.funcionariosIds) && rel.funcionariosIds.length ? [...rel.funcionariosIds] : (rel.funcionarioId ? [rel.funcionarioId] : []);
      if (selObra && rel.obraId) selObra.value = rel.obraId;
    }
  }
  sincronizarObraTexto();
  popularCheckboxFuncionariosRel();
  const sel = document.getElementById('rel-obra-select');
  if (sel) sel.onchange = sincronizarObraTexto;
  document.getElementById('modal-relatorio').classList.add('aberto');
}

function fecharModalRelatorio() { document.getElementById('modal-relatorio')?.classList.remove('aberto'); }
function editarRelatorio(id) { abrirModalRelatorio(id); }

function encontrarObraPorId(obraOuId) {
  if (obraOuId && typeof obraOuId === 'object') return obraOuId;
  return (window.obras || []).find(o => o.id === obraOuId) || null;
}

function abrirAgendamentoParaObra(obraOuId, data = '') {
  const obra = encontrarObraPorId(obraOuId);
  if (!obra) { mostrarToast('Obra não encontrada.', 'erro'); return; }
  abrirModalAgendamento();
  agendamentoObraContextId = obra.id || '';
  document.getElementById('agend-cliente').value = obra.nome || obra.construtora || '';
  document.getElementById('agend-data').value = data || obra.data || new Date().toISOString().slice(0, 10);
  document.getElementById('agend-local').value = obra.local || '';
  document.getElementById('agend-obs').value = obra.construtora ? `Obra: ${obra.nome} - ${obra.construtora}` : `Obra: ${obra.nome}`;
}

function abrirRelatorioParaObra(obraOuId, data = '') {
  const obra = encontrarObraPorId(obraOuId);
  if (!obra) { mostrarToast('Obra não encontrada.', 'erro'); return; }
  abrirModalRelatorio();
  const selObra = document.getElementById('rel-obra-select');
  if (selObra) selObra.value = obra.id || '';
  document.getElementById('rel-obra').value = obra.nome || '';
  document.getElementById('rel-data').value = data || obra.data || new Date().toISOString().slice(0, 10);
  sincronizarObraTexto();
  popularCheckboxFuncionariosRel();
}

async function salvarRelatorio() {
  const obraManual = document.getElementById('rel-obra').value.trim();
  const data = document.getElementById('rel-data').value;
  const rendimento = parseFloat(document.getElementById('rel-rendimento').value) || 0;
  const obs = document.getElementById('rel-obs').value.trim();
  const idEdit = document.getElementById('rel-id-edit').value;
  const selObra = document.getElementById('rel-obra-select');
  const obraId = selObra?.value || '';
  const obraFinal = obraManual || (window.obras || []).find(o => o.id === obraId)?.nome || '';
  if (!obraFinal || !data) { mostrarToast('Preencha obra e data.', 'erro'); return; }
  const funcsNomes = relFuncionariosSelected.map(id => funcionarios.find(f => f.id === id)?.nome).filter(Boolean).join(', ');
  const dados = { obra: obraFinal, obraId, data, funcionarioId: relFuncionariosSelected[0] || '', funcionarioNome: funcsNomes, funcionariosIds: relFuncionariosSelected, funcionariosNomes: funcsNomes, rendimento, obs };
  try {
    if (idEdit) {
      await DB.salvarRelatorio(dados, idEdit);
      const idx = relatorios.findIndex(r => r.id === idEdit);
      if (idx >= 0) relatorios[idx] = { ...relatorios[idx], ...dados };
      mostrarToast('Relatório atualizado!', 'sucesso');
    } else {
      const newId = await DB.salvarRelatorio(dados);
      relatorios.push({ id: newId, ...dados, criadoEm: new Date().toISOString() });
      mostrarToast('Relatório salvo!', 'sucesso');
    }
    fecharModalRelatorio();
    renderizarRelatorios();
    renderizarCalendario();
    window.renderizarObras?.();
    window.renderizarFluxoFinanceiro?.();
  } catch (err) { console.error(err); mostrarToast('Erro ao salvar relatório.', 'erro'); }
}

function confirmarExcluirRelatorio(id) {
  const rel = relatorios.find(r => r.id === id);
  abrirModal('Excluir Relatório', `Excluir relatório "${rel?.obra || ''}"?`, async () => {
    try {
      await DB.excluirRelatorio(id);
      relatorios = relatorios.filter(r => r.id !== id);
      renderizarRelatorios();
      renderizarCalendario();
      mostrarToast('Relatório excluído.', '');
    } catch { mostrarToast('Erro ao excluir relatório.', 'erro'); }
  });
}

async function excluirRelatorio(id) {
  try {
    await DB.excluirRelatorio(id);
    relatorios = relatorios.filter(r => r.id !== id);
    fecharDetalheDia();
    renderizarCalendario();
    renderizarRelatorios();
    mostrarToast('Relatório removido.', '');
  } catch { mostrarToast('Erro ao excluir relatório.', 'erro'); }
}

function limparFiltrosRel() {
  const f = document.getElementById('filtro-rel-func'); if (f) f.value = '';
  const m = document.getElementById('filtro-rel-mes'); if (m) m.value = '';
  const d = document.getElementById('filtro-rel-dia'); if (d) d.value = '';
  aplicarFiltrosRelatorio();
}

document.addEventListener('DOMContentLoaded', () => {
  popularSelectFuncionariosRel();
  renderizarCalendario();
});

Object.assign(window, {
  mudarSubAba,
  renderizarCalendario, calAnterior, calProximo, calHoje,
  iniciarArrasteAgendamento, finalizarArrasteAgendamento, moverAgendamentoParaDia,
  abrirDiaDetalhe, fecharDetalheDia, getEventosDia,
  abrirModalAgendamento, fecharModalAgendamento, editarAgendamento, salvarAgendamento, excluirAgendamento,
  abrirAgendamentoParaObra,
  renderizarFuncionarios, abrirModalFuncionario, fecharModalFuncionario, editarFuncionario, salvarFuncionario, confirmarExcluirFuncionario,
  renderizarRelatorios, aplicarFiltrosRelatorio, popularSelectFuncionariosRel, popularSelectObrasRel, popularCheckboxFuncionariosRel, toggleFuncRel,
  abrirModalRelatorio, fecharModalRelatorio, editarRelatorio, abrirRelatorioParaObra, salvarRelatorio, confirmarExcluirRelatorio, excluirRelatorio, limparFiltrosRel
});
