// ===== INSUMOS / DESPESAS =====
import { DB } from './firebase.js';
import { escapeHtml, escapeAttr, setOptions } from './utils.js';

// Estado global
window.insumos = window.insumos || [];
Object.defineProperty(window, 'insumos', {
  get() { return this._insumos || []; },
  set(v) { this._insumos = v; }
});

let fotoInsumoSelecionada = null;

// ===== RENDERIZAR LISTA =====
function renderizarInsumos() {
  aplicarFiltrosInsumos();
}

function aplicarFiltrosInsumos() {
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

  const TIPO_ICONS = { veiculo: '🚗', trajeto: '🛣️', material: '🧱', ferramenta: '🔧' };
  const TIPO_LABELS = { veiculo: 'Veículo', trajeto: 'Trajeto', material: 'Material', ferramenta: 'Ferramenta' };

  cont.innerHTML = lista.map(ins => {
    const func = funcionarios.find(f => f.id === ins.funcionarioId);
    const dataFmt = ins.data ? new Date(ins.data + 'T00:00:00').toLocaleDateString('pt-BR') : '-';
    const icon = TIPO_ICONS[ins.tipo] || '📦';
    const label = TIPO_LABELS[ins.tipo] || ins.tipo;
    return `<div class="ins-card">
      <div class="ins-card-header">
        <div class="ins-card-info">
          <div class="ins-card-titulo">${icon} ${escapeHtml(ins.descricao || label)}</div>
          <div class="ins-card-meta">
            <span class="ins-tipo-badge ins-tipo-${ins.tipo}">${escapeHtml(label)}</span>
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
  document.getElementById('ins-tipo').value = 'material';
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
      document.getElementById('ins-tipo').value = ins.tipo || 'material';
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
  const tipo        = document.getElementById('ins-tipo').value;
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

    const dados = { tipo, funcionarioId: funcId, funcionarioNome: func?.nome || '', data, valor, descricao, obs, fotoUrl };

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
