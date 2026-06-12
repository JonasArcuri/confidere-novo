// ===== INSUMOS / DESPESAS =====
import { DB, getUid } from './firebase.js';
import { escapeHtml, escapeAttr, setOptions } from './utils.js';

// Estado global
window.insumos = window.insumos || [];
Object.defineProperty(window, 'insumos', {
  get() { return this._insumos || []; },
  set(v) { this._insumos = v; }
});

let fotoInsumoSelecionada = null;

const TIPOS_BASE_INSUMO = [
  { value: 'material', label: 'Material', icon: '🧱' },
  { value: 'ferramenta', label: 'Ferramenta', icon: '🔧' },
  { value: 'veiculo', label: 'Veículo', icon: '🚗' },
  { value: 'trajeto', label: 'Trajeto', icon: '🛣️' }
];

function chaveTiposInsumoUsuario() {
  let uid = 'sem-login';
  try { uid = getUid(); } catch { /* sem login */ }
  return `obraflux_tipos_insumo_${uid}`;
}

function normalizarTipoInsumo(texto) {
  const base = String(texto || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return base ? `custom_${base}` : '';
}

function getTiposInsumoManuais() {
  try {
    const lista = JSON.parse(localStorage.getItem(chaveTiposInsumoUsuario()) || '[]');
    return Array.isArray(lista) ? lista.filter(t => t?.value && t?.label) : [];
  } catch {
    return [];
  }
}

function salvarTiposInsumoManuais(lista) {
  try { localStorage.setItem(chaveTiposInsumoUsuario(), JSON.stringify(lista || [])); } catch { /* localStorage pode estar bloqueado */ }
}

function getTodosTiposInsumo() {
  const porValor = new Map();
  [...TIPOS_BASE_INSUMO, ...getTiposInsumoManuais()].forEach(tipo => porValor.set(tipo.value, tipo));
  (window.insumos || []).forEach(ins => {
    if (ins?.tipo && !porValor.has(ins.tipo)) {
      porValor.set(ins.tipo, { value: ins.tipo, label: ins.tipoLabel || ins.tipo, icon: '📦' });
    }
  });
  return [...porValor.values()];
}

function salvarTipoInsumoManual(label) {
  const texto = String(label || '').trim();
  const value = normalizarTipoInsumo(texto);
  if (!texto || !value) return null;
  const existentes = getTiposInsumoManuais();
  const jaExiste = getTodosTiposInsumo().find(t => t.value === value || t.label.toLowerCase() === texto.toLowerCase());
  if (jaExiste) return jaExiste;
  const atualizados = existentes.filter(t => t.value !== value && t.label.toLowerCase() !== texto.toLowerCase());
  const novoTipo = { value, label: texto, icon: '📦' };
  atualizados.push(novoTipo);
  salvarTiposInsumoManuais(atualizados);
  return novoTipo;
}

function popularTiposInsumo(valorAtual = '') {
  const tipos = getTodosTiposInsumo();
  const opcoes = [...tipos, { value: 'manual', label: 'Digitar novo tipo...' }];
  ['ins-tipo', 'filtro-ins-tipo'].forEach(id => {
    const sel = document.getElementById(id);
    if (!sel) return;
    const atual = valorAtual || sel.value || '';
    setOptions(
      sel,
      id === 'filtro-ins-tipo' ? tipos : opcoes,
      id === 'filtro-ins-tipo' ? { value: '', label: 'Todos os tipos' } : null,
      atual
    );
    if (id === 'ins-tipo') sel.onchange = toggleTipoInsumoManual;
  });
}

function toggleTipoInsumoManual() {
  const sel = document.getElementById('ins-tipo');
  const input = document.getElementById('ins-tipo-manual');
  if (!sel || !input) return;
  const manual = sel.value === 'manual';
  input.style.display = manual ? 'block' : 'none';
  if (manual) input.focus();
}

function obterTipoInsumoSelecionado() {
  const sel = document.getElementById('ins-tipo');
  const input = document.getElementById('ins-tipo-manual');
  if (sel?.value === 'manual') {
    const tipoManual = salvarTipoInsumoManual(input?.value || '');
    return tipoManual || { value: '', label: '' };
  }
  const tipo = getTodosTiposInsumo().find(t => t.value === sel?.value);
  return tipo || { value: sel?.value || '', label: sel?.value || '' };
}

// ===== RENDERIZAR LISTA =====
function renderizarInsumos() {
  aplicarFiltrosInsumos();
}

function aplicarFiltrosInsumos() {
  popularTiposInsumo();
  const filtroTipo = document.getElementById('filtro-ins-tipo')?.value || '';
  const filtroFunc = document.getElementById('filtro-ins-func')?.value || '';
  const filtroMes  = document.getElementById('filtro-ins-mes')?.value  || '';

  let lista = [...insumos];
  if (filtroTipo) lista = lista.filter(i => i.tipo === filtroTipo);
  if (filtroFunc) lista = lista.filter(i => i.funcionarioId === filtroFunc);
  if (filtroMes)  lista = lista.filter(i => i.data && i.data.startsWith(filtroMes));

  lista.sort((a, b) => (b.data || '').localeCompare(a.data || ''));

  const cont = document.getElementById('ins-lista');
  if (!cont) return;

  if (lista.length === 0) {
    cont.innerHTML = `<div class="hist-vazio"><div class="icone">🧾</div><p>Nenhum insumo/despesa registrado.</p></div>`;
    return;
  }

  cont.innerHTML = lista.map(ins => {
    const func = funcionarios.find(f => f.id === ins.funcionarioId);
    const dataFmt = ins.data ? new Date(ins.data + 'T00:00:00').toLocaleDateString('pt-BR') : '-';
    const tipoInfo = getTodosTiposInsumo().find(t => t.value === ins.tipo);
    const icon = tipoInfo?.icon || '📦';
    const label = ins.tipoLabel || tipoInfo?.label || ins.tipo;
    const tipoClasse = TIPOS_BASE_INSUMO.some(t => t.value === ins.tipo) ? ins.tipo : 'custom';
    return `<div class="ins-card">
      <div class="ins-card-header">
        <div class="ins-card-info">
          <div class="ins-card-titulo">${icon} ${escapeHtml(ins.descricao || label)}</div>
          <div class="ins-card-meta">
            <span class="ins-tipo-badge ins-tipo-${escapeAttr(tipoClasse)}">${escapeHtml(label)}</span>
            📅 ${dataFmt}
            ${func ? `· 👷 ${escapeHtml(func.nome)}` : ''}
          </div>
          ${ins.obs ? `<div class="ins-card-obs">${escapeHtml(ins.obs)}</div>` : ''}
          ${ins.fotoUrl ? `<div class="ins-card-foto"><img src="${escapeAttr(ins.fotoUrl)}" alt="Foto" onclick="abrirFotoInsumo('${escapeAttr(ins.id)}')"></div>` : ''}
        </div>
        <div class="ins-card-valor">
          <div class="ins-card-valor-label">Valor</div>
          <div class="ins-card-valor-num">${formatarMoeda(ins.valor)}</div>
        </div>
      </div>
      <div class="ins-card-acoes">
        <button class="btn-mini editar" onclick="editarInsumo('${escapeAttr(ins.id)}')">Editar</button>
        <button class="btn-mini excluir" onclick="confirmarExcluirInsumo('${escapeAttr(ins.id)}')">Excluir</button>
      </div>
    </div>`;
  }).join('');
}

// ===== POPULAR SELECTS =====
function popularSelectFuncionariosIns() {
  popularTiposInsumo();
  ['ins-funcionario', 'filtro-ins-func'].forEach(selId => {
    const sel = document.getElementById(selId);
    if (!sel) return;
    const atual = sel.value;
    setOptions(
      sel,
      funcionarios.map(f => ({ value: f.id, label: f.nome })),
      selId === 'filtro-ins-func'
        ? { value: '', label: 'Todos os funcionarios' }
        : { value: '', label: 'Nenhum (despesa geral)' },
      atual
    );
  });
}

// ===== MODAL NOVO INSUMO =====
function abrirModalInsumo(id = null) {
  popularSelectFuncionariosIns();
  document.getElementById('ins-id-edit').value = id || '';
  popularTiposInsumo('material');
  document.getElementById('ins-tipo').value = 'material';
  document.getElementById('ins-tipo-manual').value = '';
  document.getElementById('ins-tipo-manual').style.display = 'none';
  document.getElementById('ins-funcionario').value = '';
  document.getElementById('ins-data').value = new Date().toISOString().split('T')[0];
  document.getElementById('ins-valor').value = '';
  document.getElementById('ins-descricao').value = '';
  document.getElementById('ins-obs').value = '';
  document.getElementById('ins-foto-preview').style.display = 'none';
  document.getElementById('ins-foto-preview').src = '';
  document.getElementById('ins-foto-base64').value = '';
  fotoInsumoSelecionada = null;
  document.getElementById('modal-ins-titulo').textContent = id ? 'Editar Insumo/Despesa' : 'Novo Insumo/Despesa';

  if (id) {
    const ins = insumos.find(i => i.id === id);
    if (ins) {
      popularTiposInsumo(ins.tipo || 'material');
      document.getElementById('ins-tipo').value = ins.tipo || 'material';
      document.getElementById('ins-tipo-manual').value = '';
      document.getElementById('ins-tipo-manual').style.display = 'none';
      document.getElementById('ins-funcionario').value = ins.funcionarioId || '';
      document.getElementById('ins-data').value = ins.data || '';
      document.getElementById('ins-valor').value = ins.valor || '';
      document.getElementById('ins-descricao').value = ins.descricao || '';
      document.getElementById('ins-obs').value = ins.obs || '';
      if (ins.fotoUrl) {
        document.getElementById('ins-foto-preview').src = ins.fotoUrl;
        document.getElementById('ins-foto-preview').style.display = 'block';
        document.getElementById('ins-foto-base64').value = ins.fotoUrl;
      }
    }
  }

  document.getElementById('modal-insumo').classList.add('aberto');
}

function fecharModalInsumo() {
  document.getElementById('modal-insumo').classList.remove('aberto');
}

function editarInsumo(id) { abrirModalInsumo(id); }

// ===== FOTO UPLOAD =====
function handleFotoInsumo(input) {
  const file = input.files[0];
  if (!file) return;
  const maxSize = 5 * 1024 * 1024;
  if (file.size > maxSize) {
    mostrarToast('Imagem muito grande. Use até 5MB.', 'erro');
    input.value = '';
    return;
  }
  fotoInsumoSelecionada = file;
  const reader = new FileReader();
  reader.onload = (e) => {
    const base64 = e.target.result;
    document.getElementById('ins-foto-preview').src = base64;
    document.getElementById('ins-foto-preview').style.display = 'block';
    document.getElementById('ins-foto-base64').value = '';
  };
  reader.readAsDataURL(file);
}

function abrirFotoInsumo(id) {
  const ins = insumos.find(i => i.id === id);
  if (!ins || !ins.fotoUrl) return;
  const overlay = document.getElementById('modal-foto-insumo');
  document.getElementById('foto-insumo-img').src = ins.fotoUrl;
  overlay.classList.add('aberto');
}

function fecharFotoInsumo() {
  document.getElementById('modal-foto-insumo').classList.remove('aberto');
}

// ===== SALVAR INSUMO =====
async function salvarInsumo() {
  const tipoInfo    = obterTipoInsumoSelecionado();
  const tipo        = tipoInfo.value;
  const funcId      = document.getElementById('ins-funcionario').value;
  const data        = document.getElementById('ins-data').value;
  const valor       = parseFloat(document.getElementById('ins-valor').value) || 0;
  const descricao   = document.getElementById('ins-descricao').value.trim();
  const obs         = document.getElementById('ins-obs').value.trim();
  let fotoUrl       = document.getElementById('ins-foto-base64').value || '';
  const idEdit      = document.getElementById('ins-id-edit').value;

  if (!data || !tipo) { mostrarToast('Preencha tipo e data.', 'erro'); return; }

  const func = funcionarios.find(f => f.id === funcId);

  try {
    if (fotoInsumoSelecionada) {
      mostrarToast('Enviando foto...', '');
      fotoUrl = await DB.salvarFotoInsumoArquivo(fotoInsumoSelecionada);
    }

    popularTiposInsumo(tipo);
    const dados = { tipo, tipoLabel: tipoInfo.label || tipo, funcionarioId: funcId, funcionarioNome: func?.nome || '', data, valor, descricao, obs, fotoUrl };

    if (idEdit) {
      await DB.salvarInsumo(dados, idEdit);
      const idx = insumos.findIndex(i => i.id === idEdit);
      if (idx >= 0) insumos[idx] = { ...insumos[idx], ...dados };
      mostrarToast('Insumo atualizado!', 'sucesso');
    } else {
      const newId = await DB.salvarInsumo(dados);
      insumos.push({ id: newId, ...dados });
      mostrarToast('Insumo registrado!', 'sucesso');
    }
    fotoInsumoSelecionada = null;
    fecharModalInsumo();
    renderizarInsumos();
    renderizarCalendario();
  } catch (err) {
    console.error(err);
    mostrarToast('Erro ao salvar insumo.', 'erro');
  }
}

// ===== EXCLUIR INSUMO =====
function confirmarExcluirInsumo(id) {
  const ins = insumos.find(i => i.id === id);
  abrirModal('Excluir Insumo/Despesa', `Excluir "${ins?.descricao || ins?.tipo}"? Esta ação não pode ser desfeita.`, async () => {
    try {
      await DB.excluirInsumo(id);
      insumos = insumos.filter(i => i.id !== id);
      renderizarInsumos();
      renderizarCalendario();
      mostrarToast('Insumo removido.', '');
    } catch {
      mostrarToast('Erro ao excluir insumo.', 'erro');
    }
  });
}

async function excluirInsumo(id) {
  try {
    await DB.excluirInsumo(id);
    insumos = insumos.filter(i => i.id !== id);
    renderizarInsumos();
    renderizarCalendario();
    mostrarToast('Insumo removido.', '');
  } catch {
    mostrarToast('Erro ao excluir insumo.', 'erro');
  }
}

function limparFiltrosIns() {
  const campos = ['filtro-ins-tipo', 'filtro-ins-func', 'filtro-ins-mes'];
  campos.forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  aplicarFiltrosInsumos();
}

// Exportar para escopo global
Object.assign(window, {
  renderizarInsumos, aplicarFiltrosInsumos, popularSelectFuncionariosIns,
  abrirModalInsumo, fecharModalInsumo, editarInsumo, salvarInsumo,
  confirmarExcluirInsumo, excluirInsumo, limparFiltrosIns,
  handleFotoInsumo, abrirFotoInsumo, fecharFotoInsumo
});
