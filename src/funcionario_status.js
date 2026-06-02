import { DB } from './firebase.js';

function getEl(id) {
  return document.getElementById(id);
}

function garantirCamposStatusFuncionario() {
  const salario = getEl('func-salario');
  if (!salario) return;

  const salarioCampo = salario.closest('.campo') || salario.parentElement;
  if (!salarioCampo?.parentElement) return;

  if (!getEl('func-status')) {
    const wrap = document.createElement('div');
    wrap.className = 'func-status-grid';
    wrap.innerHTML = `
      <div class="campo">
        <label>Status</label>
        <button type="button" class="btn-status-func ativo" id="func-status-btn">ATIVO</button>
        <input type="hidden" id="func-status" value="ativo">
      </div>
      <div class="campo" id="campo-func-demissao" style="display:none;">
        <label>Data Demissão/Rescisão</label>
        <input type="date" id="func-demissao">
      </div>
    `;

    salarioCampo.insertAdjacentElement('afterend', wrap);
    getEl('func-status-btn')?.addEventListener('click', () => {
      setStatusFuncionario(getEl('func-status')?.value === 'inativo' ? 'ativo' : 'inativo');
    });
  }

  if (!getEl('func-diaria-calendario-wrap')) {
    const cal = document.createElement('div');
    cal.className = 'func-diaria-calendario-wrap';
    cal.id = 'func-diaria-calendario-wrap';
    cal.style.display = 'none';
    cal.innerHTML = `
      <div class="func-cal-topo">
        <div>
          <label>Dias trabalhados no mês</label>
          <div class="func-cal-resumo" id="func-cal-resumo"></div>
        </div>
        <input type="month" id="func-cal-mes">
      </div>
      <div class="func-cal-grid" id="func-cal-grid"></div>
    `;
    const ref = getEl('campo-func-demissao')?.parentElement || salarioCampo;
    ref.insertAdjacentElement('afterend', cal);
    getEl('func-cal-mes')?.addEventListener('change', renderCalendarioDiaria);
  }

  getEl('func-tipo-salario')?.addEventListener('change', atualizarVisibilidadeCalendarioDiaria);
}

function setStatusFuncionario(status = 'ativo', dataDemissao = '') {
  garantirCamposStatusFuncionario();
  const normalizado = status === 'inativo' ? 'inativo' : 'ativo';
  const hidden = getEl('func-status');
  const btn = getEl('func-status-btn');
  const campoDemissao = getEl('campo-func-demissao');
  const inputDemissao = getEl('func-demissao');

  if (hidden) hidden.value = normalizado;
  if (btn) {
    btn.textContent = normalizado === 'inativo' ? 'INATIVO' : 'ATIVO';
    btn.classList.toggle('ativo', normalizado === 'ativo');
    btn.classList.toggle('inativo', normalizado === 'inativo');
  }
  if (campoDemissao) campoDemissao.style.display = normalizado === 'inativo' ? '' : 'none';
  if (inputDemissao) inputDemissao.value = dataDemissao || '';
}

function getFuncionarioEditando() {
  const id = getEl('func-id-edit')?.value || getEl('func-id')?.value || '';
  if (!id) return null;
  return (window.funcionarios || []).find(f => f.id === id) || null;
}

function mesAtual() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function getDiasMapAtual() {
  const raw = getEl('func-dias-trabalhados')?.value;
  if (!raw) return {};
  try { return JSON.parse(raw) || {}; } catch { return {}; }
}

function setDiasMapAtual(map) {
  let hidden = getEl('func-dias-trabalhados');
  if (!hidden) {
    hidden = document.createElement('input');
    hidden.type = 'hidden';
    hidden.id = 'func-dias-trabalhados';
    getEl('modal-funcionario')?.appendChild(hidden);
  }
  hidden.value = JSON.stringify(map || {});
}

function diasDoMes(mes) {
  const [ano, m] = mes.split('-').map(Number);
  return new Date(ano, m, 0).getDate();
}

function renderCalendarioDiaria() {
  const mes = getEl('func-cal-mes')?.value || mesAtual();
  const grid = getEl('func-cal-grid');
  const resumo = getEl('func-cal-resumo');
  if (!grid) return;
  const map = getDiasMapAtual();
  const selecionados = new Set((map[mes] || []).map(Number));
  const totalDias = diasDoMes(mes);

  grid.innerHTML = Array.from({ length: totalDias }, (_, i) => {
    const dia = i + 1;
    return `<button type="button" class="func-cal-dia ${selecionados.has(dia) ? 'ativo' : ''}" data-dia="${dia}">${dia}</button>`;
  }).join('');

  grid.querySelectorAll('.func-cal-dia').forEach(btn => {
    btn.addEventListener('click', () => {
      const dia = Number(btn.dataset.dia);
      const atual = new Set((getDiasMapAtual()[mes] || []).map(Number));
      if (atual.has(dia)) atual.delete(dia); else atual.add(dia);
      const novoMap = getDiasMapAtual();
      novoMap[mes] = [...atual].sort((a, b) => a - b);
      setDiasMapAtual(novoMap);
      renderCalendarioDiaria();
    });
  });

  if (resumo) {
    const qtd = selecionados.size;
    const diaria = Number(getEl('func-salario')?.value || 0);
    resumo.textContent = `${qtd} dia(s) x ${diaria.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}`;
  }
}

function atualizarVisibilidadeCalendarioDiaria() {
  garantirCamposStatusFuncionario();
  const tipo = getEl('func-tipo-salario')?.value || '';
  const wrap = getEl('func-diaria-calendario-wrap');
  if (!wrap) return;
  const isDiario = /di[aá]rio/i.test(tipo);
  wrap.style.display = isDiario ? '' : 'none';
  if (isDiario) {
    if (!getEl('func-cal-mes')?.value) getEl('func-cal-mes').value = mesAtual();
    renderCalendarioDiaria();
  }
}

function aplicarStatusDoFuncionarioAtual() {
  garantirCamposStatusFuncionario();
  const func = getFuncionarioEditando();
  setStatusFuncionario(func?.status || (func?.ativo === false ? 'inativo' : 'ativo'), func?.dataDemissao || func?.dataRescisao || '');
  setDiasMapAtual(func?.diasTrabalhados || {});
  if (getEl('func-cal-mes') && !getEl('func-cal-mes').value) getEl('func-cal-mes').value = mesAtual();
  atualizarVisibilidadeCalendarioDiaria();
}

function dadosStatusFuncionario() {
  garantirCamposStatusFuncionario();
  const status = getEl('func-status')?.value === 'inativo' ? 'inativo' : 'ativo';
  return {
    status,
    ativo: status === 'ativo',
    dataDemissao: status === 'inativo' ? (getEl('func-demissao')?.value || '') : '',
    diasTrabalhados: getDiasMapAtual()
  };
}

async function salvarStatusAposSalvar() {
  const statusData = dadosStatusFuncionario();
  const idEditando = getEl('func-id-edit')?.value || getEl('func-id')?.value || '';
  const nome = getEl('func-nome')?.value?.trim() || '';

  setTimeout(async () => {
    const lista = window.funcionarios || [];
    const alvo = (idEditando && lista.find(f => f.id === idEditando))
      || [...lista].reverse().find(f => (f.nome || '').trim() === nome);
    if (!alvo?.id) return;

    const atualizado = { ...alvo, ...statusData };
    const idx = lista.findIndex(f => f.id === alvo.id);
    if (idx >= 0) lista[idx] = atualizado;

    try {
      await DB.salvarFuncionario(atualizado, alvo.id);
      if (window.renderizarFuncionarios) window.renderizarFuncionarios();
      if (window.renderizarFluxoFinanceiro) window.renderizarFluxoFinanceiro();
    } catch (err) {
      console.error('Erro ao salvar status do funcionário:', err);
    }
  }, 350);
}

function instalarHooksFuncionario() {
  garantirCamposStatusFuncionario();

  const originalAbrir = window.abrirModalFuncionario;
  if (typeof originalAbrir === 'function' && !originalAbrir.__statusHook) {
    window.abrirModalFuncionario = function (...args) {
      const ret = originalAbrir.apply(this, args);
      setTimeout(aplicarStatusDoFuncionarioAtual, 0);
      return ret;
    };
    window.abrirModalFuncionario.__statusHook = true;
  }

  // O salvamento dos campos extras agora acontece diretamente em gestao.js.
}

document.addEventListener('DOMContentLoaded', () => {
  garantirCamposStatusFuncionario();
  getEl('func-tipo-salario')?.addEventListener('change', atualizarVisibilidadeCalendarioDiaria);
  getEl('func-salario')?.addEventListener('input', renderCalendarioDiaria);
  setStatusFuncionario('ativo');
  if (getEl('func-cal-mes') && !getEl('func-cal-mes').value) getEl('func-cal-mes').value = mesAtual();
  atualizarVisibilidadeCalendarioDiaria();
  setTimeout(instalarHooksFuncionario, 300);
});

Object.assign(window, {
  toggleStatusFuncionario: () => setStatusFuncionario(getEl('func-status')?.value === 'inativo' ? 'ativo' : 'inativo'),
  setStatusFuncionario,
  dadosStatusFuncionario,
  atualizarVisibilidadeCalendarioDiaria
});
