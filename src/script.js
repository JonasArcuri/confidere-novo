// ===== ESTADO =====
import { DB, getUid } from './firebase.js';
import { escapeHtml, escapeAttr } from './utils.js';

let linhaId = 0;
let orcamentoEditandoId = null;
let descontoAplicado = 0;
let logoBase64 = null;
let pagamentoSelecionado = null; // { forma, parcelas, entrada }
let tipoDocumentoAtual = 'orcamento'; // 'orcamento' | 'cobranca'
let obraVinculadaOrcamentoId = '';
let empresaConfig = {
    empresaNome: 'Confidere Impermeabilizações',
    empresaLocal: '',
    empresaContato: '',
    empresaContatoWhatsapp: false,
    empresaGestor: '',
    empresaUrl: ''
};

const MASTER_ADMIN_EMAIL = 'admin@obraflux.com.br';
const PLANOS_MODULOS = {
    essencial: ['inicio', 'orcamento', 'historico'],
    profissional: ['inicio', 'orcamento', 'historico', 'gestao'],
    completo: ['inicio', 'orcamento', 'historico', 'gestao', 'financeiro']
};
const MODULOS_ADMIN = [
    { id: 'orcamento', label: 'Novo Orcamento' },
    { id: 'historico', label: 'Historico' },
    { id: 'gestao', label: 'Gestao de Equipe' },
    { id: 'financeiro', label: 'Fluxo Financeiro' }
];
let perfilUsuarioAtual = {};
let modulosLiberadosAtuais = new Set(['inicio', 'orcamento', 'historico', 'gestao', 'financeiro']);
let usuarioMasterAtual = false;
let adminUsuariosCache = [];

// ===== INICIALIZAÇÃO =====
document.addEventListener('DOMContentLoaded', () => {
    const hoje = new Date();
    const validade = new Date();
    validade.setDate(hoje.getDate() + 30);
    document.getElementById('campo-data').value = hoje.toISOString().split('T')[0];
    document.getElementById('campo-validade').value = validade.toISOString().split('T')[0];
    adicionarLinha();
    adicionarLinha();
    aplicarTipoDocumento();
    atualizarNumeroDisplay();
});

// ===== LOGO =====
const LOGO_LOCAL_KEY = 'confidere_empresa_logo_fallback';

function getUsuarioStorageId() {
    try { return getUid(); } catch { return 'sem-login'; }
}

function getChaveUsuarioLocal(chave) {
    return `${chave}_${getUsuarioStorageId()}`;
}

function salvarLogoLocal(src) {
    try { localStorage.setItem(getChaveUsuarioLocal(LOGO_LOCAL_KEY), src || ''); } catch { /* localStorage pode estar cheio/bloqueado */ }
}

function obterLogoLocal() {
    try { return localStorage.getItem(getChaveUsuarioLocal(LOGO_LOCAL_KEY)) || ''; } catch { return ''; }
}

function removerLogoLocal() {
    try { localStorage.removeItem(getChaveUsuarioLocal(LOGO_LOCAL_KEY)); } catch { /* silencioso */ }
}

function gerarLogoFallback(file, dataUrl) {
    if (!file || file.type === 'image/svg+xml') return Promise.resolve(dataUrl.length < 750000 ? dataUrl : '');

    return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
            const max = 520;
            const escala = Math.min(1, max / Math.max(img.width, img.height));
            const canvas = document.createElement('canvas');
            canvas.width = Math.max(1, Math.round(img.width * escala));
            canvas.height = Math.max(1, Math.round(img.height * escala));
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            const fallback = canvas.toDataURL('image/png');
            resolve(fallback.length < 900000 ? fallback : '');
        };
        img.onerror = () => resolve(dataUrl.length < 750000 ? dataUrl : '');
        img.src = dataUrl;
    });
}

// Logo salva no Firebase Storage; tambem mantemos fallback local/Firestore para refresh.
function carregarLogo(event) {
    const file = event.target.files[0];
    if (!file) return;
    const maxSize = 2 * 1024 * 1024;
    if (file.size > maxSize) {
        mostrarToast('Imagem muito grande. Use ate 2MB.', 'erro');
        return;
    }
    const reader = new FileReader();
    reader.onload = async (e) => {
        const b64 = e.target.result;
        const fallback = await gerarLogoFallback(file, b64);
        logoBase64 = b64;
        aplicarLogoNaTela(b64);
        if (fallback) {
            salvarLogoLocal(fallback);
            try { await DB.salvarLogoFallback?.(fallback); } catch { /* fallback remoto opcional */ }
        }
        try {
            const url = await DB.salvarLogoArquivo(file);
            logoBase64 = url;
            aplicarLogoNaTela(url);
            salvarLogoLocal(fallback || url);
            mostrarToast('Logotipo salvo!', 'sucesso');
        } catch (err) {
            console.error('Erro ao salvar logo no servidor:', err);
            mostrarToast('Logo carregada (erro ao salvar no servidor).', 'erro');
        }
    };
    reader.readAsDataURL(file);
    event.target.value = '';
}

function aplicarLogoNaTela(src) {
    if (!src) return;
    const fallback = obterLogoLocal();
    const navImg = document.getElementById('nav-logo-img');
    const navTexto = document.getElementById('nav-logo-texto');
    const navArea = document.querySelector('.nav-logo-area');
    navImg.onerror = () => {
        if (fallback && navImg.src !== fallback) aplicarLogoNaTela(fallback);
    };
    navImg.src = src;
    navImg.style.display = 'block';
    navTexto.style.display = 'none';
    navArea.classList.add('com-logo');
    document.getElementById('btn-remover-logo').style.display = 'flex';

    const headerImg = document.getElementById('header-logo-img');
    const headerTexto = document.getElementById('header-logo-texto');
    headerImg.onerror = () => {
        if (fallback && headerImg.src !== fallback) aplicarLogoNaTela(fallback);
    };
    headerImg.src = src;
    headerImg.style.display = 'block';
    headerTexto.style.display = 'none';
    aplicarMarcaEmpresa();
}

async function carregarLogoSalva(perfil = null) {
    try {
        let logoSalva = perfil?.logoUrl || perfil?.logo || perfil?.logoFallback || obterLogoLocal() || '';
        if (!logoSalva && perfil?.logoPath) {
            logoSalva = await DB.obterUrlArquivo(perfil.logoPath);
        }
        if (!logoSalva) {
            logoSalva = await DB.carregarLogo();
        }
        if (logoSalva) {
            logoBase64 = logoSalva;
            aplicarLogoNaTela(logoSalva);
        }
    } catch (err) {
        console.error('Erro ao carregar logotipo salvo:', err);
    }
}

async function removerLogo() {
    logoBase64 = null;
    removerLogoLocal();
    try { await DB.removerLogo(); } catch { /* silencioso */ }

    const navImg = document.getElementById('nav-logo-img');
    const navTexto = document.getElementById('nav-logo-texto');
    const navArea = document.querySelector('.nav-logo-area');
    navImg.src = '';
    navImg.style.display = 'none';
    navTexto.style.display = '';
    navArea.classList.remove('com-logo');
    document.getElementById('btn-remover-logo').style.display = 'none';

    const headerImg = document.getElementById('header-logo-img');
    const headerTexto = document.getElementById('header-logo-texto');
    headerImg.src = '';
    headerImg.style.display = 'none';
    headerTexto.style.display = '';
    aplicarMarcaEmpresa();

    mostrarToast('Logotipo removido.', '');
}

function formatarMarcaEmpresa(nome = '') {
    return escapeHtml(nome || 'Empresa');
}

function getContatoEmpresaTexto() {
    if (!empresaConfig.empresaContato) return '';
    return empresaConfig.empresaContato;
}

function getSubtituloEmpresa(separador = ' • ') {
    return [getContatoEmpresaTexto(), empresaConfig.empresaLocal].filter(Boolean).join(separador);
}

function getSubtituloEmpresaHtml(separador = ' • ') {
    const partes = [];
    if (empresaConfig.empresaContato) {
        const contato = escapeHtml(empresaConfig.empresaContato);
        partes.push(empresaConfig.empresaContatoWhatsapp
            ? `<span class="marca-whatsapp-icon" aria-label="WhatsApp">☎</span>${contato}`
            : contato);
    }
    if (empresaConfig.empresaLocal) partes.push(escapeHtml(empresaConfig.empresaLocal));
    return partes.join(escapeHtml(separador));
}

function normalizarUrlEmpresa(url = '') {
    const limpa = String(url || '').trim();
    if (!limpa) return '';
    return /^https?:\/\//i.test(limpa) ? limpa : `https://${limpa}`;
}

function aplicarMarcaEmpresa() {
    const nome = empresaConfig.empresaNome || 'Empresa';
    const navTexto = document.getElementById('nav-logo-texto');
    const navSub = document.getElementById('nav-marca-sub');
    const headerGrande = document.querySelector('#header-logo-texto .logo-grande');
    const headerSub = document.getElementById('header-marca-sub');

    if (navTexto) navTexto.innerHTML = formatarMarcaEmpresa(nome);
    if (navSub) navSub.innerHTML = '';
    if (headerGrande) headerGrande.innerHTML = formatarMarcaEmpresa(nome);
    if (headerSub) headerSub.innerHTML = getSubtituloEmpresaHtml(' • ');
}

function aplicarConfiguracoesEmpresa(perfil = {}) {
    empresaConfig = {
        empresaNome: perfil.empresaNome || 'Confidere Impermeabilizações',
        empresaLocal: perfil.empresaLocal || '',
        empresaContato: perfil.empresaContato || '',
        empresaContatoWhatsapp: !!perfil.empresaContatoWhatsapp,
        empresaGestor: perfil.empresaGestor || '',
        empresaUrl: perfil.empresaUrl || ''
    };
    const empresa = document.getElementById('config-empresa');
    const local = document.getElementById('config-local');
    const contato = document.getElementById('config-contato');
    const contatoWhatsapp = document.getElementById('config-contato-whatsapp');
    const gestor = document.getElementById('config-gestor');
    const url = document.getElementById('config-url');
    if (empresa) empresa.value = empresaConfig.empresaNome || '';
    if (local) local.value = empresaConfig.empresaLocal || '';
    if (contato) contato.value = empresaConfig.empresaContato || '';
    if (contatoWhatsapp) contatoWhatsapp.checked = empresaConfig.empresaContatoWhatsapp;
    if (gestor) gestor.value = empresaConfig.empresaGestor || '';
    if (url) url.value = empresaConfig.empresaUrl || '';
    aplicarMarcaEmpresa();
}

async function salvarConfiguracoesEmpresa() {
    const config = {
        empresaNome: document.getElementById('config-empresa')?.value.trim() || '',
        empresaLocal: document.getElementById('config-local')?.value.trim() || '',
        empresaContato: document.getElementById('config-contato')?.value.trim() || '',
        empresaContatoWhatsapp: !!document.getElementById('config-contato-whatsapp')?.checked,
        empresaGestor: document.getElementById('config-gestor')?.value.trim() || '',
        empresaUrl: document.getElementById('config-url')?.value.trim() || ''
    };

    try {
        await DB.salvarConfiguracoesEmpresa(config);
        aplicarConfiguracoesEmpresa(config);
        mostrarToast('Configurações salvas!', 'sucesso');
    } catch (err) {
        console.error(err);
        mostrarToast('Erro ao salvar configurações.', 'erro');
    }
}


function moedaInicio(valor) {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(valor) || 0);
}

function parseValorInicio(v) {
    if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
    if (!v) return 0;
    const n = Number(String(v).replace(/[^\d,.-]/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.'));
    return Number.isFinite(n) ? n : 0;
}

function totalDocumentoInicio(doc = {}) {
    const direto = parseValorInicio(doc.totalComDesconto);
    if (direto > 0) return direto;
    return (doc.linhas || []).reduce((acc, l) => {
        if (!l || l.tipo === 'cabecalho' || l.tipo === 'imagem' || l.tipo === 'opcao') return acc;
        const total = parseValorInicio(l.total);
        if (total > 0) return acc + total;
        return acc + parseValorInicio(l.subtotalMaterial) + parseValorInicio(l.subtotalMao);
    }, 0);
}

function mesAtualInicio() {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
}

function renderizarInicio() {
    const perfilNome = empresaConfig?.empresaNome || 'Sua empresa';
    const local = empresaConfig?.empresaLocal || '';
    const contato = empresaConfig?.empresaContato || '';
    const orcamentos = (window._orcamentosFirestore || []).filter(o => (o.tipoDocumento || 'orcamento') === 'orcamento');
    const cobrancas = (window._orcamentosFirestore || []).filter(o => o.tipoDocumento === 'cobranca');
    const obras = window.obras || [];
    const funcionariosAtivos = (window.funcionarios || []).filter(f => f.status !== 'inativo' && f.ativo !== false);
    const mes = mesAtualInicio();
    const entradasMes = cobrancas.filter(o => (o.data || '').startsWith(mes)).reduce((s, o) => s + totalDocumentoInicio(o), 0);
    const insumosMes = (window.insumos || []).filter(i => (i.data || '').startsWith(mes)).reduce((s, i) => s + parseValorInicio(i.valor), 0);
    const saldoMes = entradasMes - insumosMes;

    const nomeEl = document.getElementById('inicio-empresa-nome');
    const metaEl = document.getElementById('inicio-empresa-meta');
    const saudacaoEl = document.getElementById('inicio-saudacao');
    if (saudacaoEl) saudacaoEl.textContent = 'Painel inicial';
    if (nomeEl) nomeEl.textContent = perfilNome;
    if (metaEl) metaEl.textContent = [contato, local].filter(Boolean).join(' • ');

    const kpis = document.getElementById('inicio-kpis');
    if (kpis) {
        const dados = [
            ['Orçamentos', orcamentos.length],
            ['Obras em execução', obras.filter(o => o.status !== 'finalizada').length],
            ['Funcionários ativos', funcionariosAtivos.length],
            ['Entradas do mês', moedaInicio(entradasMes)]
        ];
        kpis.innerHTML = dados.map(([label, valor]) => '<div class="inicio-kpi"><span>' + escapeHtml(String(label)) + '</span><strong>' + escapeHtml(String(valor)) + '</strong></div>').join('');
    }

    const hoje = new Date().toISOString().slice(0, 10);
    const agendaHoje = (window.agendamentos || []).filter(a => a.data === hoje).sort((a,b) => (a.hora || '').localeCompare(b.hora || '')).slice(0, 4);
    const agendaEl = document.getElementById('inicio-agenda');
    if (agendaEl) {
        agendaEl.innerHTML = agendaHoje.length ? agendaHoje.map(a => '<div class="inicio-item"><strong>' + escapeHtml((a.hora ? a.hora.slice(0,5) + ' - ' : '') + (a.cliente || 'Agendamento')) + '</strong><span>' + escapeHtml(a.local || a.funcionarioNome || '') + '</span></div>').join('') : '<div class="inicio-vazio">Nenhum agendamento para hoje.</div>';
    }

    const finEl = document.getElementById('inicio-financeiro');
    if (finEl) {
        finEl.innerHTML = '<div class="inicio-fin-linha positivo"><span>Entradas do mês</span><strong>' + moedaInicio(entradasMes) + '</strong></div>' +
            '<div class="inicio-fin-linha negativo"><span>Insumos / despesas</span><strong>' + moedaInicio(insumosMes) + '</strong></div>' +
            '<div class="inicio-fin-linha ' + (saldoMes >= 0 ? 'positivo' : 'negativo') + '"><span>Saldo operacional</span><strong>' + moedaInicio(saldoMes) + '</strong></div>';
    }
}

// ===== ABAS =====
function normalizarModuloAba(aba) {
    if (aba === 'admin') return 'admin';
    return ['inicio', 'orcamento', 'historico', 'gestao', 'financeiro'].includes(aba) ? aba : 'inicio';
}

function modulosDoPlano(plano) {
    const chave = String(plano || 'essencial').toLowerCase();
    return PLANOS_MODULOS[chave] || PLANOS_MODULOS.essencial;
}

function getModulosPermitidos(perfil = {}) {
    const definidos = Array.isArray(perfil.modulosLiberados) ? perfil.modulosLiberados.filter(Boolean) : [];
    return definidos.length ? definidos : modulosDoPlano(perfil.plano);
}

function aplicarPermissoesUsuario(perfil = {}, user = {}) {
    perfilUsuarioAtual = perfil || {};
    usuarioMasterAtual = String(user?.email || '').toLowerCase() === MASTER_ADMIN_EMAIL;
    const permitidos = (!usuarioMasterAtual && perfilUsuarioAtual.bloqueado)
        ? ['inicio']
        : usuarioMasterAtual
        ? ['inicio', 'orcamento', 'historico', 'gestao', 'financeiro', 'admin']
        : getModulosPermitidos(perfilUsuarioAtual);
    modulosLiberadosAtuais = new Set(['inicio', ...permitidos]);

    document.querySelectorAll('.nav-admin-tab').forEach(btn => {
        btn.style.display = usuarioMasterAtual ? '' : 'none';
    });

    document.querySelectorAll('.nav-tab').forEach(btn => {
        const match = (btn.getAttribute('onclick') || '').match(/mudarAba\('([^']+)'/);
        const aba = match ? match[1] : '';
        if (!aba || aba === 'inicio') {
            btn.style.display = '';
            return;
        }
        btn.style.display = modulosLiberadosAtuais.has(aba) ? '' : 'none';
    });

    const abaAtiva = document.querySelector('.aba.ativo')?.id?.replace('aba-', '') || 'inicio';
    if (!modulosLiberadosAtuais.has(abaAtiva)) {
        mudarAba('inicio', document.querySelector(".nav-tab[onclick*=\"inicio\"]") || document.querySelector('.nav-tab'));
    }
}

function moduloPermitido(aba) {
    const modulo = normalizarModuloAba(aba);
    return modulo === 'inicio' || modulosLiberadosAtuais.has(modulo);
}

function mudarAba(aba, btn) {
    if (!moduloPermitido(aba)) {
        mostrarToast('Modulo indisponivel para este usuario.', 'erro');
        return;
    }
    document.querySelectorAll('.aba').forEach(a => a.classList.remove('ativo'));
    document.querySelectorAll('.nav-tab').forEach(b => b.classList.remove('ativo'));
    document.getElementById('aba-' + aba)?.classList.add('ativo');
    const botao = btn || document.querySelector('.nav-tab[data-aba=\"' + aba + '\"]') || document.querySelector('.nav-tab[onclick*=\"' + aba + '\"]');
    botao?.classList.add('ativo');
    if (aba === 'inicio') renderizarInicio();
    if (aba === 'historico') renderizarHistorico();
    if (aba === 'financeiro' && window.renderizarFluxoFinanceiro) window.renderizarFluxoFinanceiro();
    if (aba === 'admin') renderizarAdminMaster();
    if (aba === 'gestao') {
        renderizarCalendario();
        popularSelectFuncionariosRel();
    }
}

// ===== TIPO E NUMERO DO DOCUMENTO =====
function normalizarTipoDocumento(tipo) {
    return tipo === 'cobranca' ? 'cobranca' : 'orcamento';
}

function getTipoDocumento(o = null) {
    return normalizarTipoDocumento(o?.tipoDocumento || 'orcamento');
}

function getLabelTipoDocumento(tipo = tipoDocumentoAtual) {
    return normalizarTipoDocumento(tipo) === 'cobranca' ? 'Relat\u00F3rio de Cobran\u00E7a' : 'Or\u00E7amento';
}

function aplicarTipoDocumento() {
    tipoDocumentoAtual = normalizarTipoDocumento(tipoDocumentoAtual);
    const isCobranca = tipoDocumentoAtual === 'cobranca';
    const btn = document.getElementById('btn-tipo-documento');
    if (btn) btn.textContent = getLabelTipoDocumento();
    const labelData = document.getElementById('label-campo-data');
    const labelValidade = document.getElementById('label-campo-validade');
    if (labelData) labelData.textContent = isCobranca ? 'Data Cobran\u00E7a' : 'Data do Or\u00E7amento';
    if (labelValidade) labelValidade.textContent = isCobranca ? 'M\u00EAs Refer\u00EAncia' : 'Validade do Or\u00E7amento';
    const validade = document.getElementById('campo-validade');
    if (validade) {
        const atual = validade.value;
        validade.type = isCobranca ? 'month' : 'date';
        if (isCobranca && atual?.length >= 7) validade.value = atual.slice(0, 7);
        if (!isCobranca && atual?.length === 7) validade.value = atual + '-01';
    }
    atualizarNumeroDisplay();
}

function toggleTipoDocumento() {
    tipoDocumentoAtual = tipoDocumentoAtual === 'cobranca' ? 'orcamento' : 'cobranca';
    aplicarTipoDocumento();
    atualizarNumeroDisplay();
}

function proximoNumero(tipo = tipoDocumentoAtual) {
    const tipoNorm = normalizarTipoDocumento(tipo);
    const hist = getHistorico();
    const nums = hist
        .filter(o => getTipoDocumento(o) === tipoNorm)
        .map(o => parseInt(o.numero))
        .filter(n => !isNaN(n));
    return nums.length > 0 ? Math.max(...nums) + 1 : 1;
}

function atualizarNumeroDisplay() {
    const docEditando = orcamentoEditandoId ? getHistorico().find(o => o.id === orcamentoEditandoId) : null;
    const tipo = tipoDocumentoAtual;
    const mesmoTipoEdicao = docEditando && getTipoDocumento(docEditando) === tipo;
    const num = orcamentoEditandoId
        ? (mesmoTipoEdicao ? (docEditando?.numero || proximoNumero(tipo)) : proximoNumero(tipo))
        : proximoNumero(tipo);
    document.getElementById('display-numero').textContent = '#' + String(num).padStart(3, '0');
}

// ===== LINHAS DA TABELA =====
// Listas de opcoes editaveis
const _OPCOES_STORAGE_KEYS = {
    desc: 'confidere_opcoes_desc',
    material: 'confidere_opcoes_material',
    area: 'confidere_opcoes_area'
};

function getChaveOpcoesUsuario(tipo) {
    return getChaveUsuarioLocal(_OPCOES_STORAGE_KEYS[tipo] || `confidere_opcoes_${tipo}`);
}

const _OPCOES_DESC_PADRAO = [
    'BWC(s)', 'BWC Suite', 'Lavabo(s)', 'Sacada(s)', 'Caixa d Água', 'Cisterna', 'Terraço(s)',
    'Janelas Etapa 1', 'Janelas Etapa 2', 'Piscina', 'Piscina Infantil(s)',
    'Piscina Cobertura 1', 'Piscina Cobertura 2', 'Piscina Giardinho 1', 'Piscina Giardinho 2',
    'Rampa Mezanino', 'Teto Cisterna', 'Teto Caixa Da Água', 'Laje Caixa Da Água',
    'Muro Contenção', 'Floreira(s)', 'Barrilete'
];
const _OPCOES_MATERIAL_PADRAO = [
    'Manta Asfáltica 4mm Anti Raiz', 'Manta Asfáltica 3mm Aluminizada', 'Manta Asfáltica 4mm TIPO 3 PP',
    'Manta Asfáltica 4mm TIPO 3 AA', 'Manta Asfáltica 3mm PP', 'Membrana Líquida', 'Poliuretano',
    'Sistema Icobit', 'Membrana Cimenticia', 'Membrana Cimenticia com Prot UV', 'Regularização Substrato',
    'Proteção Mecânica', 'Membrana Acrilica com Prot UV', 'Cintamento Perimetral', 'Cristalização', 'Tamponamento'
];
const _OPCOES_AREA_PADRAO = ['m&sup2;', 'm', 'Unid.'];

const _OPCOES_CORRECOES_TEXTO = {
    'Caixa d \u003Fgua': 'Caixa d Água',
    'Teto Caixa Da \u003Fgua': 'Teto Caixa Da Água',
    'Laje Caixa Da \u003Fgua': 'Laje Caixa Da Água',
    'Terra\u003Fo(s)': 'Terraço(s)',
    'Muro Conten\u003F\u003Fo': 'Muro Contenção',
    'Manta Asf\u003Fltica 4mm Anti Raiz': 'Manta Asfáltica 4mm Anti Raiz',
    'Manta Asf\u003Fltica 3mm Aluminizada': 'Manta Asfáltica 3mm Aluminizada',
    'Manta Asf\u003Fltica 4mm TIPO 3 PP': 'Manta Asfáltica 4mm TIPO 3 PP',
    'Manta Asf\u003Fltica 4mm TIPO 3 AA': 'Manta Asfáltica 4mm TIPO 3 AA',
    'Manta Asf\u003Fltica 3mm PP': 'Manta Asfáltica 3mm PP',
    'Membrana L\u003Fquida': 'Membrana Líquida',
    'Regulariza\u003F\u003Fo Substrato': 'Regularização Substrato',
    'Prote\u003F\u003Fo Mecanica': 'Proteção Mecânica',
    'Cristaliza\u003F\u003Fo': 'Cristalização'
};

function normalizarOpcaoEditavelTexto(valor) {
    const texto = String(valor || '').trim();
    return _OPCOES_CORRECOES_TEXTO[texto] || texto;
}

function carregarOpcoesEditaveis(tipo, padrao) {
    try {
        const salvas = JSON.parse(localStorage.getItem(getChaveOpcoesUsuario(tipo)) || 'null');
        if (Array.isArray(salvas)) return [...new Set(salvas.map(normalizarOpcaoEditavelTexto).filter(Boolean))];
    } catch {}
    return [...padrao];
}

let _OPCOES_DESC = carregarOpcoesEditaveis('desc', _OPCOES_DESC_PADRAO);
let _OPCOES_MATERIAL = carregarOpcoesEditaveis('material', _OPCOES_MATERIAL_PADRAO);
let _OPCOES_AREA = carregarOpcoesEditaveis('area', _OPCOES_AREA_PADRAO);

function salvarOpcoesEditaveis(tipo) {
    const lista = tipo === 'desc' ? _OPCOES_DESC : tipo === 'material' ? _OPCOES_MATERIAL : _OPCOES_AREA;
    try { localStorage.setItem(getChaveOpcoesUsuario(tipo), JSON.stringify(lista)); } catch {}
}

function recarregarOpcoesEditaveisUsuario() {
    _OPCOES_DESC = carregarOpcoesEditaveis('desc', _OPCOES_DESC_PADRAO);
    _OPCOES_MATERIAL = carregarOpcoesEditaveis('material', _OPCOES_MATERIAL_PADRAO);
    _OPCOES_AREA = carregarOpcoesEditaveis('area', _OPCOES_AREA_PADRAO);
    atualizarDropdownsEditaveis();
}

function getListaOpcoesEditaveis(tipo) {
    return tipo === 'desc' ? _OPCOES_DESC : tipo === 'material' ? _OPCOES_MATERIAL : _OPCOES_AREA;
}

function adicionarOpcaoEditavel(tipo, valor) {
    const limpo = String(valor || '').trim();
    if (!limpo) return false;
    const lista = getListaOpcoesEditaveis(tipo);
    if (lista.some(v => v.toLowerCase() === limpo.toLowerCase())) return false;
    lista.push(limpo);
    salvarOpcoesEditaveis(tipo);
    atualizarDropdownsEditaveis();
    mostrarToast('Opção salva na lista.', 'sucesso');
    return true;
}

function salvarManualSeMarcado(tipo, id) {
    const input = tipo === 'desc'
        ? document.getElementById(`desc-manual-${id}`)
        : tipo === 'area'
            ? document.getElementById(`area-manual-${id}`)
            : document.getElementById(`mat-manual-input-${id}`);
    const cb = tipo === 'desc'
        ? document.getElementById(`desc-manual-salvar-${id}`)
        : tipo === 'area'
            ? document.getElementById(`area-manual-salvar-${id}`)
            : document.getElementById(`mat-manual-salvar-${id}`);
    if (cb?.checked) adicionarOpcaoEditavel(tipo, input?.value || '');
}

function removerOpcaoEditavel(tipo, valor, event = null) {
    event?.stopPropagation?.();
    event?.preventDefault?.();
    const lista = getListaOpcoesEditaveis(tipo);
    const idx = lista.findIndex(v => v === valor);
    if (idx < 0) return;
    lista.splice(idx, 1);
    if (tipo === 'material') {
        Object.keys(_materiaisSelecionados).forEach(id => {
            _setMateriais(id, _getMateriais(id).filter(v => v !== valor));
            _atualizarResumoDeMateriais(id);
        });
    }
    salvarOpcoesEditaveis(tipo);
    atualizarDropdownsEditaveis();
    mostrarToast('Opção removida da lista.', '');
}

function escapeJsString(valor) {
    return String(valor || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function renderOpcaoEditavel(tipo, id, valor, selecionado = false) {
    const cls = tipo === 'desc' ? 'desc-opt' : tipo === 'area' ? 'area-opt' : 'mat-option-row';
    const action = tipo === 'desc'
        ? `selecionarDesc(${id},'${escapeJsString(valor)}');calcularLinha(${id})`
        : tipo === 'area'
            ? `selecionarArea(${id},'${escapeJsString(valor)}');calcularLinha(${id})`
            : '';

    if (tipo === 'material') {
        const checked = (_getMateriais(id).includes(valor)) ? 'checked' : '';
        return `<label class="mat-check-item mat-option-row" data-opcao-tipo="material" data-opcao-valor="${escapeAttr(valor)}">
          <span class="mat-option-main"><input type="checkbox" value="${escapeAttr(valor)}" ${checked} onchange="toggleMaterialLinha(${id},'${escapeJsString(valor)}',this);calcularLinha(${id})"><span>${escapeHtml(valor)}</span></span>
          <button type="button" class="opcao-delete-btn" title="Excluir op&ccedil;&atilde;o" onclick="removerOpcaoEditavel('material','${escapeJsString(valor)}',event)">&times;</button>
        </label>`;
    }

    return `<div class="${cls}${selecionado ? ' selecionado' : ''} opcao-editavel-row" data-opcao-tipo="${tipo}" data-opcao-valor="${escapeAttr(valor)}" onclick="${action}">
      <span>${escapeHtml(valor)}</span>
      <button type="button" class="opcao-delete-btn" title="Excluir op&ccedil;&atilde;o" onclick="removerOpcaoEditavel('${tipo}','${escapeJsString(valor)}',event)">&times;</button>
    </div>`;
}

function renderOpcoesDesc(id, selecionada) {
    return _OPCOES_DESC.map(v => renderOpcaoEditavel('desc', id, v, v === selecionada)).join('');
}

function renderOpcoesArea(id, selecionada) {
    return _OPCOES_AREA.map(v => renderOpcaoEditavel('area', id, v, v === selecionada)).join('');
}

function renderOpcoesMaterial(id) {
    return _OPCOES_MATERIAL.map(v => renderOpcaoEditavel('material', id, v)).join('');
}

function atualizarDropdownsEditaveis() {
    document.querySelectorAll('tr[data-id]').forEach(tr => {
        const id = Number(tr.dataset.id);
        if (!id) return;
        const descPanel = document.getElementById(`desc-dropdown-${id}`);
        const areaPanel = document.getElementById(`area-dropdown-${id}`);
        const matPanel = document.getElementById(`mat-opcoes-${id}`);
        if (descPanel) {
            const manual = descPanel.querySelector('.manual-option-row');
            descPanel.innerHTML = (manual ? manual.outerHTML : '') + renderOpcoesDesc(id, _descPersonalizada[id] || '');
        }
        if (areaPanel) {
            const manual = areaPanel.querySelector('.manual-option-row');
            areaPanel.innerHTML = (manual ? manual.outerHTML : '') + renderOpcoesArea(id, _areaLabel[id] || '');
        }
        if (matPanel) matPanel.innerHTML = renderOpcoesMaterial(id);
    });
}

// Estado dos materiais selecionados por linha
const _materiaisSelecionados = {};
// Estado das descrições personalizadas por linha
const _descPersonalizada = {};
// Estado das áreas por linha (label descritivo)
const _areaLabel = {};

function _getMateriais(id) { return _materiaisSelecionados[id] || []; }
function _setMateriais(id, arr) { _materiaisSelecionados[id] = arr; }

function toggleMaterialLinha(id, valor, cb) {
    const atual = _getMateriais(id);
    if (cb.checked) {
        if (!atual.includes(valor)) atual.push(valor);
    } else {
        const idx = atual.indexOf(valor);
        if (idx >= 0) atual.splice(idx, 1);
    }
    _setMateriais(id, atual);
    _atualizarResumoDeMateriais(id);
}

function toggleMaterialManual(id, cb) {
    const inputManual = document.getElementById(`mat-manual-input-${id}`);
    const salvarRow = document.getElementById(`mat-manual-save-row-${id}`);
    if (inputManual) inputManual.style.display = cb.checked ? 'block' : 'none';
    if (salvarRow) salvarRow.style.display = cb.checked ? 'flex' : 'none';
    if (!cb.checked) {
        // remover valor manual dos selecionados
        const atual = _getMateriais(id);
        const manual = inputManual?.value?.trim();
        if (manual) {
            const idx = atual.indexOf(manual);
            if (idx >= 0) atual.splice(idx, 1);
            _setMateriais(id, atual);
        }
    }
    _atualizarResumoDeMateriais(id);
}

function atualizarMaterialManual(id) {
    const inputManual = document.getElementById(`mat-manual-input-${id}`);
    const cbManual = document.getElementById(`mat-manual-cb-${id}`);
    if (!inputManual || !cbManual?.checked) return;
    const valor = inputManual.value.trim();
    // Remover valor manual anterior e adicionar novo
    const atual = _getMateriais(id).filter(v => !_OPCOES_MATERIAL.includes(v) && v !== '');
    // Retirar entradas manuais antigas — mantemos apenas as do predefinido + este novo
    const predefinidos = _getMateriais(id).filter(v => _OPCOES_MATERIAL.includes(v));
    _setMateriais(id, valor ? [...predefinidos, valor] : predefinidos);
    _atualizarResumoDeMateriais(id);
}

function _atualizarResumoDeMateriais(id) {
    const resumo = document.getElementById(`mat-resumo-${id}`);
    const lista = _getMateriais(id);
    if (resumo) resumo.textContent = lista.length > 0 ? lista.join(', ') : 'Nenhum selecionado';
}

function _posicionarDropdown(dropdown, btn) {
    const rect = btn.getBoundingClientRect();
    const viewH = window.innerHeight;
    const viewW = window.innerWidth;
    const panelH = 300;
    const panelW = Math.max(260, parseInt(dropdown.style.width) || 260);
    const openUp = (viewH - rect.bottom) < panelH && rect.top > panelH;
    dropdown.style.top  = openUp ? `${rect.top - panelH}px` : `${rect.bottom + 4}px`;
    dropdown.style.left = `${Math.min(rect.left, viewW - panelW - 8)}px`;
    dropdown.style.width = `${Math.max(rect.width, 260)}px`;
}

function toggleDropdownMaterial(id) {
    const dropdown = document.getElementById(`mat-dropdown-${id}`);
    if (!dropdown) return;
    const aberto = dropdown.style.display === 'block';
    document.querySelectorAll('.mat-dropdown-panel, .desc-dropdown-panel').forEach(d => d.style.display = 'none');
    if (!aberto) {
        dropdown.style.display = 'block';
        const btn = dropdown.closest('.mat-dropdown-wrapper')?.querySelector('.mat-select-btn');
        if (btn) _posicionarDropdown(dropdown, btn);
    }
}

function toggleDropdownDesc(id) {
    const dropdown = document.getElementById(`desc-dropdown-${id}`);
    if (!dropdown) return;
    const aberto = dropdown.style.display === 'block';
    document.querySelectorAll('.desc-dropdown-panel, .mat-dropdown-panel').forEach(d => d.style.display = 'none');
    if (!aberto) {
        dropdown.style.display = 'block';
        const btn = document.getElementById(`desc-btn-${id}`);
        if (btn) _posicionarDropdown(dropdown, btn);
    }
}

function selecionarDesc(id, valor) {
    _descPersonalizada[id] = valor;
    const btn = document.getElementById(`desc-btn-${id}`);
    if (btn) btn.textContent = valor;
    document.getElementById(`desc-dropdown-${id}`).style.display = 'none';
    // Esconder campo manual se selecionar predefinido
    const manual = document.getElementById(`desc-manual-${id}`);
    if (manual) manual.style.display = 'none';
    const salvarRow = document.getElementById(`desc-manual-save-row-${id}`);
    if (salvarRow) salvarRow.style.display = 'none';
}

function toggleDescManual(id) {
    const manual = document.getElementById(`desc-manual-${id}`);
    const salvarRow = document.getElementById(`desc-manual-save-row-${id}`);
    if (!manual) return;
    const visivel = manual.style.display === 'block';
    manual.style.display = visivel ? 'none' : 'block';
    if (salvarRow) salvarRow.style.display = visivel ? 'none' : 'flex';
    document.getElementById(`desc-dropdown-${id}`).style.display = 'none';
    if (!visivel) manual.focus();
}

function atualizarDescManual(id) {
    const manual = document.getElementById(`desc-manual-${id}`);
    const btn = document.getElementById(`desc-btn-${id}`);
    if (!manual || !btn) return;
    const valor = manual.value.trim();
    _descPersonalizada[id] = valor || '';
    btn.textContent = valor || 'Selecione o serviço';
}

function getDescLinha(id) {
    return _descPersonalizada[id] || '';
}

// ===== DROPDOWN DE ÁREA =====
function toggleDropdownArea(id) {
    const dropdown = document.getElementById(`area-dropdown-${id}`);
    if (!dropdown) return;
    const aberto = dropdown.style.display === 'block';
    document.querySelectorAll('.mat-dropdown-panel, .desc-dropdown-panel, .area-dropdown-panel').forEach(d => d.style.display = 'none');
    if (!aberto) {
        dropdown.style.display = 'block';
        const btn = document.getElementById(`area-btn-${id}`);
        if (btn) _posicionarDropdown(dropdown, btn);
    }
}

function selecionarArea(id, valor) {
    _areaLabel[id] = valor;
    const btn = document.getElementById(`area-btn-${id}`);
    if (btn) {
        btn.querySelector('.area-btn-label').textContent = valor;
        btn.title = valor;
    }
    document.getElementById(`area-dropdown-${id}`).style.display = 'none';
    // Esconder campo manual se selecionou predefinido
    const manual = document.getElementById(`area-manual-${id}`);
    if (manual) manual.style.display = 'none';
    const salvarRow = document.getElementById(`area-manual-save-row-${id}`);
    if (salvarRow) salvarRow.style.display = 'none';
}

function toggleAreaManual(id) {
    const manual = document.getElementById(`area-manual-${id}`);
    const salvarRow = document.getElementById(`area-manual-save-row-${id}`);
    if (!manual) return;
    const visivel = manual.style.display === 'block';
    manual.style.display = visivel ? 'none' : 'block';
    if (salvarRow) salvarRow.style.display = visivel ? 'none' : 'flex';
    document.getElementById(`area-dropdown-${id}`).style.display = 'none';
    if (!visivel) manual.focus();
}

function atualizarAreaManual(id) {
    const manual = document.getElementById(`area-manual-${id}`);
    const btn = document.getElementById(`area-btn-${id}`);
    if (!manual || !btn) return;
    const valor = manual.value.trim();
    _areaLabel[id] = valor || '';
    btn.querySelector('.area-btn-label').textContent = valor || '\u00C1rea';
    btn.title = valor || '';
}

// Fecha dropdowns ao clicar fora ou ao rolar a página
document.addEventListener('click', (e) => {
    if (!e.target.closest('.desc-dropdown-wrapper') && !e.target.closest('.desc-dropdown-panel')) {
        document.querySelectorAll('.desc-dropdown-panel').forEach(d => d.style.display = 'none');
    }
    if (!e.target.closest('.mat-dropdown-wrapper') && !e.target.closest('.mat-dropdown-panel')) {
        document.querySelectorAll('.mat-dropdown-panel').forEach(d => d.style.display = 'none');
    }
    if (!e.target.closest('.area-dropdown-wrapper') && !e.target.closest('.area-dropdown-panel')) {
        document.querySelectorAll('.area-dropdown-panel').forEach(d => d.style.display = 'none');
    }
});

// Fecha dropdowns ao rolar a PÁGINA — mas NÃO fecha quando o scroll é dentro do próprio painel
window.addEventListener('scroll', (e) => {
    const dentroDropdown = e.target.closest && e.target.closest('.desc-dropdown-panel, .mat-dropdown-panel, .area-dropdown-panel');
    if (dentroDropdown) return; // scroll interno — não fecha
    document.querySelectorAll('.desc-dropdown-panel, .mat-dropdown-panel, .area-dropdown-panel').forEach(d => d.style.display = 'none');
}, true);

function adicionarLinha(desc = '', area = '', material = '', custoMaterial = '', custoMao = '', total = 0, areaLabel = '', opcoes = {}) {
    linhaId++;
    const id = linhaId;
    const tbody = document.getElementById('linhas-tbody');
    const tr = document.createElement('tr');
    tr.dataset.id = id;
    const isOpcao = opcoes.tipo === 'opcao';
    if (isOpcao) {
        tr.dataset.tipo = 'opcao';
        tr.dataset.baseId = opcoes.baseId || '';
        tr.classList.add('linha-opcao');
    }

    const areaNum = parseFloat(area) || 0;
    const matNum = parseFloat(custoMaterial) || 0;
    const maoNum = parseFloat(custoMao) || 0;
    const initSubMat = areaNum * matNum;
    const initSubMao = areaNum * maoNum;

    // Inicializar estado de materiais — suporta string única ou array
    const matArray = Array.isArray(material)
        ? material
        : (material ? [material] : []);
    _setMateriais(id, matArray);

    // Inicializar descrição
    _descPersonalizada[id] = desc || '';

    // Inicializar label da área
    _areaLabel[id] = areaLabel || '';

    // Separar material manual de predefinidos para restaurar checkboxes
    const matPredefinidos = matArray.filter(v => _OPCOES_MATERIAL.includes(v));
    const matManual = matArray.find(v => !_OPCOES_MATERIAL.includes(v) && v !== '') || '';

    const descPredefinida = _OPCOES_DESC.includes(desc) ? desc : '';
    const descManualVal = !_OPCOES_DESC.includes(desc) ? desc : '';

    const areaLabelPredefinida = _OPCOES_AREA.includes(areaLabel) ? areaLabel : '';
    const areaLabelManual = (!_OPCOES_AREA.includes(areaLabel) && areaLabel) ? areaLabel : '';

    tr.innerHTML = `
<td class="col-desc">
  <div class="desc-dropdown-wrapper" style="position:relative">
    <button type="button" id="desc-btn-${id}" class="desc-select-btn" onclick="toggleDropdownDesc(${id})">${escapeHtml(desc || 'Selecione o servi\u00e7o')}</button>
    <div id="desc-dropdown-${id}" class="desc-dropdown-panel" style="display:none;">
      <div class="desc-opt manual-option-row" onclick="toggleDescManual(${id})">Digitar manualmente...</div>
      ${renderOpcoesDesc(id, descPredefinida)}
    </div>
    <label class="manual-save-row" id="desc-manual-save-row-${id}" style="display:${descManualVal ? 'flex' : 'none'}"><input type="checkbox" id="desc-manual-salvar-${id}" onchange="salvarManualSeMarcado('desc',${id})"><span>Salvar na lista</span></label>
    <input type="text" id="desc-manual-${id}" placeholder="Digite o servi&ccedil;o..." value="${escapeAttr(descManualVal)}" oninput="atualizarDescManual(${id});calcularLinha(${id})" onblur="salvarManualSeMarcado('desc',${id})" style="display:${descManualVal ? 'block' : 'none'};margin-top:4px;width:100%;box-sizing:border-box;padding:5px 8px;border:1px solid #c0bdb8;border-radius:6px;font-size:13px">
  </div>
</td>
<td class="col-area">
  <div class="area-dropdown-wrapper" style="position:relative">
    <button type="button" id="area-btn-${id}" class="area-select-btn" onclick="toggleDropdownArea(${id})" title="${escapeAttr(areaLabel || '')}" ${isOpcao ? 'disabled' : ''}>
      <span class="area-btn-label">${escapeHtml(areaLabel || '\u00C1rea')}</span>
      <span class="area-btn-arrow">&#9662;</span>
    </button>
    <div id="area-dropdown-${id}" class="area-dropdown-panel" style="display:none;">
      <div class="area-opt manual-option-row" onclick="toggleAreaManual(${id})">Digitar manualmente...</div>
      ${renderOpcoesArea(id, areaLabelPredefinida)}
    </div>
    <label class="manual-save-row" id="area-manual-save-row-${id}" style="display:${areaLabelManual ? 'flex' : 'none'}"><input type="checkbox" id="area-manual-salvar-${id}" onchange="salvarManualSeMarcado('area',${id})"><span>Salvar na lista</span></label>
    <input type="text" id="area-manual-${id}" placeholder="Digite manualmente..." value="${escapeAttr(areaLabelManual)}" oninput="atualizarAreaManual(${id})" onblur="salvarManualSeMarcado('area',${id})" style="display:${areaLabelManual ? 'block' : 'none'};margin-top:4px;width:100%;box-sizing:border-box;padding:5px 8px;border:1px solid #c0bdb8;border-radius:6px;font-size:12px">
  </div>
  <input type="number" placeholder="m&sup2;" step="0.01" value="${area}" oninput="calcularLinha(${id})" style="margin-top:4px">
</td>
<td class="col-material">
  <div class="mat-dropdown-wrapper" style="position:relative">
    <button type="button" class="mat-select-btn" onclick="toggleDropdownMaterial(${id})">Selecionar materiais &#9662;</button>
    <div id="mat-resumo-${id}" class="mat-resumo">${matArray.length > 0 ? escapeHtml(matArray.join(', ')) : 'Nenhum selecionado'}</div>
    <div id="mat-dropdown-${id}" class="mat-dropdown-panel" style="display:none;">
      <label class="mat-check-item manual-option-row">
        <input type="checkbox" id="mat-manual-cb-${id}" ${matManual ? 'checked' : ''} onchange="toggleMaterialManual(${id},this)">
        <span>Digitar manualmente</span>
      </label>
      <label class="manual-save-row" id="mat-manual-save-row-${id}" style="display:${matManual ? 'flex' : 'none'}"><input type="checkbox" id="mat-manual-salvar-${id}" onchange="salvarManualSeMarcado('material',${id})"><span>Salvar na lista</span></label>
      <input type="text" id="mat-manual-input-${id}" placeholder="Digite o material..." value="${escapeAttr(matManual)}" oninput="atualizarMaterialManual(${id})" onblur="salvarManualSeMarcado('material',${id})" style="display:${matManual ? 'block' : 'none'};margin:2px 14px 8px;width:calc(100% - 28px);box-sizing:border-box;padding:5px 8px;border:1px solid #c0bdb8;border-radius:6px;font-size:13px">
      <div style="border-top:1px solid #eee;margin:4px 0"></div>
      <div id="mat-opcoes-${id}">${renderOpcoesMaterial(id)}</div>
    </div>
  </div>
</td>
<td class="col-qtd">
  <input type="number" placeholder="Material m²" step="0.01" value="${custoMaterial}" oninput="calcularLinha(${id})">
</td>
<td class="col-unit">
  <input type="number" placeholder="Mão obra m²" step="0.01" value="${custoMao}" oninput="calcularLinha(${id})">
</td>
<td class="col-subtmat">
  <span id="submat-${id}" class="subtot-mat${initSubMat > 0 ? ' ativo' : ''}">${formatarMoeda(initSubMat)}</span>
</td>
<td class="col-subtmao">
  <span id="submao-${id}" class="subtot-mao${initSubMao > 0 ? ' ativo' : ''}">${formatarMoeda(initSubMao)}</span>
</td>
<td class="col-total">
  <span id="total-${id}">${formatarMoeda(total)}</span>
</td>
<td class="col-acao">
  <button class="btn-remover" onclick="removerLinha(${id})">×</button>
</td>`;

    tbody.appendChild(tr);
}

function removerLinha(id) {
    const tr = document.querySelector(`tr[data-id="${id}"]`);
    if (tr) tr.remove();
    calcularTotais();
}

// ===== CABEÇALHO DE SEÇÃO =====
let cabecalhoId = 0;

function _getTextoHeaderPadrao() {
    const detalhes = getSubtituloEmpresa(' — ');
    return detalhes ? `${empresaConfig.empresaNome} — ${detalhes}` : empresaConfig.empresaNome;
}

function adicionarCabecalho(texto = '') {
    cabecalhoId++;
    const cid = 'cab_' + cabecalhoId;
    const tbody = document.getElementById('linhas-tbody');
    const tr = document.createElement('tr');
    tr.dataset.cabId = cid;
    tr.className = 'linha-cabecalho';

    const valorInicial = texto || _getTextoHeaderPadrao();

    // Linha que replica visualmente o <thead>, com campo editável na 1ª célula
    tr.innerHTML = `
<td class="cab-col-desc">
  <div class="cabecalho-wrapper">
    <input type="text" class="cabecalho-input" id="cab-input-${cid}" value="${valorInicial}"
      placeholder="Ex: Pavimento Térreo..."
      oninput="calcularTotais()"
      autocomplete="off">
    <button class="cabecalho-btn-remover" onclick="removerCabecalho('${cid}')" title="Remover cabeçalho">×</button>
  </div>
</td>
<td class="cab-col-label">&Aacute;rea</td>
<td class="cab-col-label">Material</td>
<td class="cab-col-label">Custo Mat. m²</td>
<td class="cab-col-label">Mão Obra m²</td>
<td class="cab-col-label">Total Material</td>
<td class="cab-col-label">Total M.O.</td>
<td class="cab-col-label">Total (R$)</td>
<td class="cab-col-label"></td>`;
    tbody.appendChild(tr);
    // Focar e selecionar o texto para facilitar a edição
    if (!texto) setTimeout(() => {
        const input = document.getElementById(`cab-input-${cid}`);
        if (input) { input.focus(); input.select(); }
    }, 50);
}

function abrirDropdownCabecalho(cid) { /* removido — sem dropdown */ }
function filtrarCabecalhoOpcoes(cid) { /* removido — sem dropdown */ }
function selecionarCabecalho(cid, valor) { /* removido — sem dropdown */ }

function removerCabecalho(cid) {
    const tr = document.querySelector(`tr[data-cab-id="${cid}"]`);
    if (tr) tr.remove();
}

let imagemLinhaId = 0;

function handleImagemOrcamento(input) {
    const file = input.files?.[0];
    if (!file) return;
    if (!['image/png', 'image/jpeg'].includes(file.type)) {
        mostrarToast('Use uma imagem PNG ou JPEG.', 'erro');
        input.value = '';
        return;
    }
    const maxSize = 2 * 1024 * 1024;
    if (file.size > maxSize) {
        mostrarToast('Imagem muito grande. Use ate 2MB.', 'erro');
        input.value = '';
        return;
    }
    const reader = new FileReader();
    reader.onload = () => {
        const img = new Image();
        img.onload = () => {
            const linhaImagem = adicionarImagemOrcamento(reader.result, img.naturalWidth, img.naturalHeight, {
                uploadStatus: 'pending'
            });
            try {
                mostrarToast('Enviando imagem...', '');
                DB.salvarImagemOrcamentoArquivo(file).then(uploaded => {
                    linhaImagem.dataset.storageUrl = uploaded.url;
                    linhaImagem.dataset.storagePath = uploaded.path;
                    linhaImagem.dataset.uploadStatus = 'done';
                    mostrarToast('Imagem adicionada!', 'sucesso');
                }).catch(err => {
                    console.error(err);
                    linhaImagem.dataset.uploadStatus = 'error';
                    mostrarToast('Imagem apareceu na tela, mas falhou ao enviar. Tente adicionar novamente antes de salvar.', 'erro');
                });
            } catch (err) {
                console.error(err);
                linhaImagem.dataset.uploadStatus = 'error';
                mostrarToast('Erro ao enviar imagem. Tente novamente.', 'erro');
            }
        };
        img.src = reader.result;
    };
    reader.readAsDataURL(file);
    input.value = '';
}

function adicionarImagemOrcamento(src, width = 0, height = 0, opcoes = {}) {
    imagemLinhaId++;
    const imgId = 'img_' + imagemLinhaId;
    const tbody = document.getElementById('linhas-tbody');
    const tr = document.createElement('tr');
    tr.dataset.imgId = imgId;
    tr.dataset.imgWidth = width;
    tr.dataset.imgHeight = height;
    const srcTexto = String(src || '');
    tr.dataset.storageUrl = opcoes.storageUrl || (srcTexto.startsWith('data:') ? '' : srcTexto);
    tr.dataset.storagePath = opcoes.storagePath || '';
    tr.dataset.uploadStatus = opcoes.uploadStatus || (tr.dataset.storageUrl ? 'done' : '');
    tr.className = 'linha-imagem-orcamento';
    tr.innerHTML = `
<td colspan="9">
  <div class="orcamento-imagem-wrap">
    <button type="button" class="btn-remover imagem" onclick="removerImagemOrcamento('${imgId}')">&times;</button>
    ${src ? `<img src="${escapeAttr(src)}" alt="Imagem do orcamento" onerror="this.style.display='none';this.nextElementSibling.style.display='block'">` : ''}
    <div class="imagem-erro" style="${src ? 'display:none' : ''}">Imagem salva sem URL disponível.</div>
  </div>
</td>`;
    tbody.appendChild(tr);
    return tr;
}

async function restaurarImagemOrcamento(linha) {
    let src = linha.src || linha.storageUrl || linha.url || linha.imagemUrl || '';
    const storagePath = linha.storagePath || linha.path || '';

    if (!src && storagePath) {
        try {
            src = await DB.obterUrlArquivo(storagePath);
        } catch (err) {
            console.error('Erro ao recuperar imagem do orçamento:', err);
        }
    }

    adicionarImagemOrcamento(src, linha.width || 0, linha.height || 0, {
        storageUrl: linha.storageUrl || (String(src || '').startsWith('data:') ? '' : src),
        storagePath
    });
}

function removerImagemOrcamento(imgId) {
    const tr = document.querySelector(`tr[data-img-id="${imgId}"]`);
    if (tr) tr.remove();
}

function getItensParaOpcao() {
    return Array.from(document.querySelectorAll('#linhas-tbody tr[data-id]'))
        .filter(tr => tr.dataset.tipo !== 'opcao')
        .map(tr => {
            const id = parseInt(tr.dataset.id);
            return { id, desc: getDescLinha(id) || `Item ${id}` };
        });
}

function toggleMenuOpcao() {
    const menu = document.getElementById('menu-opcao');
    const select = document.getElementById('select-opcao-base');
    if (!menu || !select) return;
    const itens = getItensParaOpcao();
    select.innerHTML = '';
    if (itens.length === 0) {
        const opt = document.createElement('option');
        opt.value = '';
        opt.textContent = 'Nenhum item disponivel';
        select.appendChild(opt);
    } else {
        itens.forEach(item => {
            const opt = document.createElement('option');
            opt.value = item.id;
            opt.textContent = item.desc;
            select.appendChild(opt);
        });
    }
    menu.style.display = menu.style.display === 'flex' ? 'none' : 'flex';
}

function adicionarOpcaoSelecionada() {
    const select = document.getElementById('select-opcao-base');
    const baseId = parseInt(select?.value);
    if (!baseId) {
        mostrarToast('Selecione um item para criar a opcao.', 'erro');
        return;
    }
    const base = coletarLinhaPorId(baseId);
    if (!base) return;
    adicionarCabecalho(`OPCAO DO ITEM: ${base.desc || 'ITEM'}`);
    adicionarLinha(base.desc, base.area, base.materialArr, base.custoMaterial, base.custoMao, base.total, base.areaLabel, {
        tipo: 'opcao',
        baseId
    });
    document.getElementById('menu-opcao').style.display = 'none';
    calcularTotais();
}

function coletarLinhaPorId(rowId) {
    const tr = document.querySelector(`#linhas-tbody tr[data-id="${rowId}"]`);
    if (!tr) return null;
    const areaInput = tr.querySelector('.col-area input[type=number]');
    const area = parseFloat(areaInput?.value) || 0;
    const custoMaterial = parseFloat(tr.querySelector('.col-qtd input')?.value) || 0;
    const custoMao = parseFloat(tr.querySelector('.col-unit input')?.value) || 0;
    const subtotalMaterial = area * custoMaterial;
    const subtotalMao = area * custoMao;
    return {
        tipo: tr.dataset.tipo === 'opcao' ? 'opcao' : 'item',
        desc: getDescLinha(rowId),
        area,
        areaLabel: _areaLabel[rowId] || '',
        materialArr: _getMateriais(rowId),
        material: _getMateriais(rowId).join(', '),
        custoMaterial,
        custoMao,
        subtotalMaterial,
        subtotalMao,
        total: subtotalMaterial + subtotalMao,
        baseId: tr.dataset.baseId || ''
    };
}

function calcularLinha(id) {
    const tr = document.querySelector(`tr[data-id="${id}"]`);
    if (!tr) return;
    // Area input is the number input inside col-area (second child)
    const areaInput = tr.querySelector('.col-area input[type=number]');
    const matInputs = tr.querySelectorAll('.col-qtd input, .col-unit input');
    const area = parseFloat(areaInput?.value) || 0;
    const custoMat = parseFloat(matInputs[0]?.value) || 0;
    const custoMao = parseFloat(matInputs[1]?.value) || 0;
    const subMat = area * custoMat;
    const subMao = area * custoMao;
    const total = subMat + subMao;

    const elSubMat = tr.querySelector(`#submat-${id}`);
    const elSubMao = tr.querySelector(`#submao-${id}`);
    if (elSubMat) { elSubMat.textContent = formatarMoeda(subMat); elSubMat.classList.toggle('ativo', subMat > 0); }
    if (elSubMao) { elSubMao.textContent = formatarMoeda(subMao); elSubMao.classList.toggle('ativo', subMao > 0); }
    tr.querySelector(`#total-${id}`).textContent = formatarMoeda(total);
    calcularTotais();
}

function getTextoCabecalhoLinha(tr) {
    return tr.querySelector('.cabecalho-input')?.value.trim() || '';
}

function isCabecalhoOpcaoTexto(texto = '') {
    return /^OP(?:C|Ç)AO\b/i.test(texto.trim());
}

function coletarTotaisOpcoesDaTabela() {
    const grupos = [];
    let grupoAtual = null;

    document.querySelectorAll('#linhas-tbody tr').forEach(tr => {
        if (tr.dataset.cabId) {
            const texto = getTextoCabecalhoLinha(tr);
            grupoAtual = isCabecalhoOpcaoTexto(texto)
                ? { titulo: texto, subtotalMaterial: 0, subtotalMaoObra: 0, totalGeral: 0 }
                : null;
            if (grupoAtual) grupos.push(grupoAtual);
            return;
        }

        if (!tr.dataset.id || !grupoAtual) return;

        const area = parseFloat(tr.querySelector('.col-area input[type=number]')?.value) || 0;
        const matInputs = tr.querySelectorAll('.col-qtd input, .col-unit input');
        const material = parseFloat(matInputs[0]?.value) || 0;
        const mao = parseFloat(matInputs[1]?.value) || 0;
        const subtotalMaterial = area * material;
        const subtotalMao = area * mao;

        grupoAtual.subtotalMaterial += subtotalMaterial;
        grupoAtual.subtotalMaoObra += subtotalMao;
        grupoAtual.totalGeral += subtotalMaterial + subtotalMao;
    });

    return grupos.filter(g => g.totalGeral > 0 || g.subtotalMaterial > 0 || g.subtotalMaoObra > 0);
}

function renderizarTotaisOpcoes(grupos = []) {
    const cont = document.getElementById('opcoes-totais');
    if (!cont) return;
    if (!grupos.length) {
        cont.innerHTML = '';
        return;
    }

    cont.innerHTML = grupos.map(g => `
      <div class="opcao-total-card">
        <div class="opcao-total-titulo">${escapeHtml(g.titulo)}</div>
        <div class="totais-linha"><span class="label">Subtotal Material</span><span class="valor">${formatarMoeda(g.subtotalMaterial)}</span></div>
        <div class="totais-linha"><span class="label">Subtotal Mão de Obra</span><span class="valor">${formatarMoeda(g.subtotalMaoObra)}</span></div>
        <div class="totais-linha principal"><span class="label">TOTAL DA OPÇÃO</span><span class="valor">${formatarMoeda(g.totalGeral)}</span></div>
      </div>`).join('');
}

function calcularTotais() {
    let subtotalMaterial = 0, subtotalMaoObra = 0, totalGeral = 0;
    let dentroDeOpcao = false;
    document.querySelectorAll('#linhas-tbody tr').forEach(tr => {
        if (tr.dataset.cabId) {
            dentroDeOpcao = isCabecalhoOpcaoTexto(getTextoCabecalhoLinha(tr));
            return;
        }
        if (!tr.dataset.id || dentroDeOpcao || tr.dataset.tipo === 'opcao') return;
        const areaInput = tr.querySelector('.col-area input[type=number]');
        const matInputs = tr.querySelectorAll('.col-qtd input, .col-unit input');
        const area = parseFloat(areaInput?.value) || 0;
        const material = parseFloat(matInputs[0]?.value) || 0;
        const maoObra = parseFloat(matInputs[1]?.value) || 0;
        subtotalMaterial += area * material;
        subtotalMaoObra += area * maoObra;
        totalGeral += area * material + area * maoObra;
    });
    document.getElementById('disp-subtotal-material').textContent = formatarMoeda(subtotalMaterial);
    document.getElementById('disp-subtotal-mao').textContent = formatarMoeda(subtotalMaoObra);
    document.getElementById('disp-total').textContent = formatarMoeda(totalGeral);
    limparDescontoCalculo();
    const opcoes = coletarTotaisOpcoesDaTabela();
    renderizarTotaisOpcoes(opcoes);
    return { subtotalMaterial, subtotalMaoObra, totalGeral, opcoes };
}

// ===== DESCONTO =====
function toggleDesconto() { document.getElementById('form-desconto').classList.toggle('visivel'); }

function aplicarDesconto() {
    const pct = parseFloat(document.getElementById('input-desconto').value);
    if (isNaN(pct) || pct <= 0 || pct >= 100) { mostrarToast('Informe um percentual entre 0 e 100.', 'erro'); return; }
    const { totalGeral } = calcularTotais();
    descontoAplicado = pct;
    const descValor = totalGeral * pct / 100;
    const comDesc = totalGeral - descValor;
    document.getElementById('desc-cartoes').innerHTML = `
    <div class="desc-cartao" style="background:#2563a8">
      <span class="dc-label">Total com ${pct}% desconto</span>
      <span class="dc-valor">${formatarMoeda(comDesc)}</span>
      <span class="dc-economia">Economia de ${formatarMoeda(descValor)}</span>
    </div>
    <div class="desc-cartao" style="background:#e05c20">
      <span class="dc-label">Valor do desconto</span>
      <span class="dc-valor">${formatarMoeda(descValor)}</span>
      <span class="dc-economia">Sobre ${formatarMoeda(totalGeral)}</span>
    </div>`;
    document.getElementById('resultados-desconto').classList.add('visivel');
}

function limparDesconto() {
    descontoAplicado = 0;
    limparDescontoCalculo();
    document.getElementById('form-desconto').classList.remove('visivel');
    document.getElementById('input-desconto').value = '';
}

function limparDescontoCalculo() {
    descontoAplicado = 0;
    document.getElementById('resultados-desconto').classList.remove('visivel');
}

// ===== OBSERVAÇÕES =====
function getObservacoesMarcadas() {
    return Array.from(document.querySelectorAll('input[name="obs-opcao"]:checked')).map(cb => cb.value);
}

function getTextoObservacaoOpcao(valor) {
    const cb = document.querySelector(`input[name="obs-opcao"][value="${valor}"]`);
    return cb?.closest('.obs-opcao-item')?.querySelector('span')?.textContent.trim() || '';
}

function montarObservacoes() {
    const opcoes = getObservacoesMarcadas()
        .map(getTextoObservacaoOpcao)
        .filter(Boolean)
        .map(txt => `- ${txt}`);
    const textoLivre = document.getElementById('campo-obs').value.trim();
    if (textoLivre) opcoes.push(textoLivre);
    return opcoes.join('\n');
}

function limparObservacoes() {
    document.querySelectorAll('input[name="obs-opcao"]').forEach(cb => { cb.checked = false; });
    document.getElementById('campo-obs').value = '';
}

function restaurarObservacoes(orc) {
    document.querySelectorAll('input[name="obs-opcao"]').forEach(cb => {
        cb.checked = Array.isArray(orc.obsOpcoes) && orc.obsOpcoes.includes(cb.value);
    });
    document.getElementById('campo-obs').value = orc.obsTextoLivre ?? orc.obs ?? '';
}

// ===== FORMAS DE PAGAMENTO =====
function togglePagamento() {
    document.getElementById('form-pagamento').classList.toggle('visivel');
}

// Mostra/esconde campos de entrada+saldo conforme checkbox marcado
function handlePgtoChange(cb) {
    const mapacampos = {
        'material_entrada_saldo': 'campos-material-ent',
        'mao_entrada_saldo': 'campos-mao-ent'
    };
    const camposId = mapacamp[cb.value] || mapacamp[cb.value];
    if (mapacamp[cb.value]) {
        document.getElementById(mapacamp[cb.value]).style.display = cb.checked ? 'flex' : 'none';
    }
}

// Calcula saldo automaticamente (100 - entrada)
function calcularSaldo(tipo) {
    const entradaEl = document.getElementById(`${tipo}-entrada-pct`);
    const saldoEl   = document.getElementById(`${tipo}-saldo-pct`);
    const ent = parseFloat(entradaEl.value) || 0;
    saldoEl.value = Math.max(0, 100 - ent);
}

// Helper para campo de mapa interno
const mapacamp = {
    'material_entrada_saldo': 'campos-material-ent',
    'mao_entrada_saldo': 'campos-mao-ent'
};

function _getOpcoesMarcadas() {
    return Array.from(document.querySelectorAll('input[name="pgto-opcao"]:checked')).map(cb => cb.value);
}

// Gera linhas de texto para o PDF com base nas opções marcadas
function _gerarLinhasPagamentoPDF(opcoes) {
    const linhas = [];
    // Determina linha do MATERIAL
    if (opcoes.includes('avista')) {
        linhas.push('A VISTA');
    }
    if (opcoes.includes('material_avista')) {
        linhas.push('MATERIAL A VISTA');
    }
    if (opcoes.includes('material_entrada_saldo')) {
        const ent = parseFloat(document.getElementById('mat-entrada-pct').value) || 0;
        const sal = Math.max(0, 100 - ent);
        const descSaldo = sal > 0 ? `SALDO ${sal}% APÓS CONCLUSÃO` : 'SALDO APÓS CONCLUSÃO';
        linhas.push(`MATERIAL ${ent}% ENTRADA + ${descSaldo}`);
    }
    if (opcoes.includes('mao_avista')) {
        linhas.push('MÃO DE OBRA A VISTA');
    }
    if (opcoes.includes('mao_entrada_saldo')) {
        const ent = parseFloat(document.getElementById('mao-entrada-pct').value) || 0;
        const sal = Math.max(0, 100 - ent);
        const descSaldo = sal > 0 ? `SALDO ${sal}% APÓS CONCLUSÃO` : 'SALDO APÓS CONCLUSÃO';
        linhas.push(`MÃO DE OBRA ${ent}% ENTRADA + ${descSaldo}`);
    }
    if (opcoes.includes('a_combinar')) {
        linhas.push('MATERIAL E MÃO DE OBRA: A COMBINAR');
    }
    return linhas;
}

function aplicarPagamento() {
    const opcoes = _getOpcoesMarcadas();
    if (opcoes.length === 0) { mostrarToast('Selecione ao menos uma opção de pagamento.', 'erro'); return; }

    // Validar campos de entrada
    if (opcoes.includes('material_entrada_saldo')) {
        const ent = parseFloat(document.getElementById('mat-entrada-pct').value);
        if (isNaN(ent) || ent <= 0 || ent >= 100) { mostrarToast('Informe a % de entrada do Material (1–99).', 'erro'); return; }
        calcularSaldo('mat');
    }
    if (opcoes.includes('mao_entrada_saldo')) {
        const ent = parseFloat(document.getElementById('mao-entrada-pct').value);
        if (isNaN(ent) || ent <= 0 || ent >= 100) { mostrarToast('Informe a % de entrada da Mão de Obra (1–99).', 'erro'); return; }
        calcularSaldo('mao');
    }

    pagamentoSelecionado = { opcoes,
        matEntradaPct: parseFloat(document.getElementById('mat-entrada-pct')?.value) || 0,
        maoEntradaPct: parseFloat(document.getElementById('mao-entrada-pct')?.value) || 0
    };

    const linhasPDF = _gerarLinhasPagamentoPDF(opcoes);
    const resumoHtml = linhasPDF.map(l =>
        `<div class="desc-cartao" style="background:#1a3a5c"><span class="dc-label" style="font-size:13px;font-weight:600">${l}</span></div>`
    ).join('');

    document.getElementById('pagamento-cartoes').innerHTML = resumoHtml;
    document.getElementById('resultados-pagamento').classList.add('visivel');
}

function restaurarPagamento(pgto) {
    limparPagamento();
    if (!pgto || !Array.isArray(pgto.opcoes) || pgto.opcoes.length === 0) return;

    pgto.opcoes.forEach(opcao => {
        const cb = document.querySelector(`input[name="pgto-opcao"][value="${opcao}"]`);
        if (cb) {
            cb.checked = true;
            handlePgtoChange(cb);
        }
    });

    document.getElementById('mat-entrada-pct').value = pgto.matEntradaPct || '';
    document.getElementById('mao-entrada-pct').value = pgto.maoEntradaPct || '';
    if (pgto.opcoes.includes('material_entrada_saldo')) calcularSaldo('mat');
    if (pgto.opcoes.includes('mao_entrada_saldo')) calcularSaldo('mao');

    pagamentoSelecionado = {
        opcoes: [...pgto.opcoes],
        matEntradaPct: parseFloat(pgto.matEntradaPct) || 0,
        maoEntradaPct: parseFloat(pgto.maoEntradaPct) || 0
    };

    const linhasPDF = _gerarLinhasPagamentoPDF(pgto.opcoes);
    document.getElementById('pagamento-cartoes').innerHTML = linhasPDF.map(l =>
        `<div class="desc-cartao" style="background:#1a3a5c"><span class="dc-label" style="font-size:13px;font-weight:600">${l}</span></div>`
    ).join('');
    document.getElementById('resultados-pagamento').classList.add('visivel');
}

function limparPagamento() {
    pagamentoSelecionado = null;
    document.getElementById('form-pagamento').classList.remove('visivel');
    document.querySelectorAll('input[name="pgto-opcao"]').forEach(cb => { cb.checked = false; });
    ['campos-material-ent','campos-mao-ent'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = 'none';
    });
    ['mat-entrada-pct','mat-saldo-pct','mao-entrada-pct','mao-saldo-pct'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
    });
    document.getElementById('resultados-pagamento').classList.remove('visivel');
    document.getElementById('pagamento-cartoes').innerHTML = '';
}

// ===== COLETA DOS DADOS =====
function coletarDados() {
    const linhas = [];
    let opcaoAtual = '';
    document.querySelectorAll('#linhas-tbody tr').forEach(tr => {
        if (tr.dataset.cabId) {
            const texto = tr.querySelector('.cabecalho-input')?.value || '';
            opcaoAtual = isCabecalhoOpcaoTexto(texto) ? texto : '';
            linhas.push({ tipo: 'cabecalho', texto });
            return;
        }
        if (tr.dataset.imgId) {
            const img = tr.querySelector('img');
            linhas.push({
                tipo: 'imagem',
                src: img?.src || '',
                storageUrl: tr.dataset.storageUrl || '',
                storagePath: tr.dataset.storagePath || '',
                width: Number(tr.dataset.imgWidth) || 0,
                height: Number(tr.dataset.imgHeight) || 0
            });
            return;
        }
        const rowId = parseInt(tr.dataset.id);
        if (!rowId) return;
        const linha = coletarLinhaPorId(rowId);
        if (linha && opcaoAtual) {
            linha.tipo = 'opcao';
            linha.opcaoTitulo = opcaoAtual;
        }
        if (linha) linhas.push(linha);
    });
    const subtotal = linhas.reduce((a, l) => a + (l.tipo === 'item' ? (Number(l.total) || 0) : 0), 0);
    const obsTextoLivre = document.getElementById('campo-obs').value;
    const obsOpcoes = getObservacoesMarcadas();
    const totaisOpcoes = coletarTotaisOpcoesDaTabela();
    return {
        cliente: document.getElementById('campo-cliente').value,
        obra: document.getElementById('campo-obra').value,
        assunto: document.getElementById('campo-obra').value,
        endereco: document.getElementById('campo-endereco').value,
        estado: document.getElementById('campo-estado').value,
        tipoDocumento: tipoDocumentoAtual,
        obraId: obraVinculadaOrcamentoId || '',
        data: document.getElementById('campo-data').value,
        validade: document.getElementById('campo-validade').value,
        obs: montarObservacoes(),
        obsTextoLivre,
        obsOpcoes,
        totaisOpcoes,
        linhas, subtotal,
        desconto: descontoAplicado,
        totalComDesconto: descontoAplicado ? subtotal * (1 - descontoAplicado / 100) : subtotal,
        pagamento: pagamentoSelecionado
    };
}

// ===== HISTÓRICO — usa Firestore via window._orcamentosFirestore =====
function getHistorico() {
    return window._orcamentosFirestore || [];
}

function setHistorico(lista) {
    window._orcamentosFirestore = lista;
}

// ===== SALVAR ORÇAMENTO =====
function normalizarLinhaParaFirestore(linha) {
    if (!linha || typeof linha !== 'object') return linha;
    if (linha.tipo === 'imagem') {
        return {
            tipo: 'imagem',
            src: linha.storageUrl || (String(linha.src || '').startsWith('data:') ? '' : linha.src || ''),
            storageUrl: linha.storageUrl || '',
            storagePath: linha.storagePath || '',
            width: Number(linha.width) || 0,
            height: Number(linha.height) || 0
        };
    }
    const { materialArr, ...limpa } = linha;
    if (Array.isArray(materialArr) && !limpa.material) {
        limpa.material = materialArr.join(', ');
    }
    return limpa;
}

function resumoRevisaoParaFirestore(rev) {
    return {
        numero: rev.numero || null,
        cliente: rev.cliente || '',
        obra: rev.obra || rev.assunto || '',
        assunto: rev.assunto || rev.obra || '',
        estado: rev.estado || '',
        tipoDocumento: getTipoDocumento(rev),
        data: rev.data || '',
        validade: rev.validade || '',
        totalComDesconto: Number(rev.totalComDesconto) || 0,
        revisao: rev.revisao || null,
        savedAt: rev.savedAt || ''
    };
}

function prepararOrcamentoParaFirestore(orc) {
    const preparado = {
        ...orc,
        linhas: (orc.linhas || []).map(normalizarLinhaParaFirestore),
        revisoes: (orc.revisoes || []).map(resumoRevisaoParaFirestore)
    };
    return removerArraysAninhadosFirestore(preparado);
}

function removerArraysAninhadosFirestore(valor, dentroDeArray = false) {
    if (Array.isArray(valor)) {
        if (dentroDeArray) {
            return valor
                .map(v => {
                    if (v === null || v === undefined) return '';
                    if (typeof v === 'object') return JSON.stringify(removerArraysAninhadosFirestore(v, false));
                    return String(v);
                })
                .join(', ');
        }
        return valor.map(v => removerArraysAninhadosFirestore(v, true));
    }

    if (valor && typeof valor === 'object') {
        return Object.fromEntries(
            Object.entries(valor)
                .filter(([, v]) => v !== undefined)
                .map(([k, v]) => [k, removerArraysAninhadosFirestore(v, dentroDeArray)])
        );
    }

    return valor;
}

async function validarImagensAntesDeSalvar() {
    const imagens = Array.from(document.querySelectorAll('#linhas-tbody tr[data-img-id]'));
    const normalizarStatus = () => {
        imagens.forEach(tr => {
            if (tr.dataset.storageUrl && tr.dataset.uploadStatus === 'pending') {
                tr.dataset.uploadStatus = 'done';
            }
        });
    };

    normalizarStatus();
    let pendente = imagens.some(tr => tr.dataset.uploadStatus === 'pending' && !tr.dataset.storageUrl);
    if (pendente) {
        mostrarToast('Enviando imagem... aguarde alguns instantes.', '');
        const limite = Date.now() + 30000;
        while (Date.now() < limite) {
            await new Promise(resolve => setTimeout(resolve, 300));
            normalizarStatus();
            pendente = imagens.some(tr => tr.dataset.uploadStatus === 'pending' && !tr.dataset.storageUrl);
            if (!pendente) break;
        }
    }

    if (pendente) {
        mostrarToast('Nao foi possivel concluir o envio da imagem. Tente adicionar a imagem novamente.', 'erro');
        return false;
    }

    const comErro = imagens.some(tr => {
        const imgSrc = tr.querySelector('img')?.src || '';
        return imgSrc.startsWith('data:') && !tr.dataset.storageUrl;
    });
    if (comErro) {
        mostrarToast('Uma imagem ainda não foi enviada. Remova e adicione novamente antes de salvar.', 'erro');
        return false;
    }

    return true;
}

async function salvarOrcamento() {
    if (!document.getElementById('campo-cliente')?.value?.trim()) {
        mostrarToast('Informe o nome do cliente.', 'erro');
        return;
    }
    if (!(await validarImagensAntesDeSalvar())) return;
    const dados = coletarDados();

    try {
        if (orcamentoEditandoId) {
            const hist = getHistorico();
            const atual = hist.find(o => o.id === orcamentoEditandoId);
            if (atual) {
                const tipoAtual = getTipoDocumento(atual);
                const tipoNovo = getTipoDocumento(dados);
                const mudouTipoDocumento = tipoAtual !== tipoNovo;
                const revBase = (atual.revisoes || []).length + 1;
                if (!atual.revisoes) atual.revisoes = [];
                atual.revisoes.push({ ...atual, revisoes: undefined, savedAt: atual.savedAt });
                const revLabel = 'REV ' + numeroRomano(revBase);
                const updated = {
                    ...dados,
                    tipoDocumento: tipoNovo,
                    numero: mudouTipoDocumento ? proximoNumero(tipoNovo) : atual.numero,
                    savedAt: new Date().toISOString(),
                    revisao: revLabel,
                    revisoes: atual.revisoes,
                    statusAprovacao: atual.statusAprovacao || (atual.aprovado ? 'aprovado' : 'pendente'),
                    aprovado: !!atual.aprovado || atual.statusAprovacao === 'aprovado',
                    dataAprovacao: atual.dataAprovacao || ''
                };
                await DB.salvarOrcamento(prepararOrcamentoParaFirestore(updated), orcamentoEditandoId);
                const idx = hist.findIndex(o => o.id === orcamentoEditandoId);
                if (idx >= 0) hist[idx] = { id: orcamentoEditandoId, ...updated };
                setHistorico(hist);
            }
        } else {
            const num = proximoNumero(tipoDocumentoAtual);
            const novoOrc = {
                ...dados,
                numero: num,
                savedAt: new Date().toISOString(),
                revisao: null,
                revisoes: [],
                statusAprovacao: 'pendente',
                aprovado: false,
                dataAprovacao: ''
            };
            const newId = await DB.salvarOrcamento(prepararOrcamentoParaFirestore(novoOrc));
            const hist = getHistorico();
            hist.push({ id: newId, ...novoOrc });
            setHistorico(hist);
        }
        window.renderizarObras?.();
        mostrarToast(`${getLabelTipoDocumento(dados.tipoDocumento)} salvo com sucesso!`, 'sucesso');
        orcamentoEditandoId = null;
        document.getElementById('display-rev').innerHTML = '';
        atualizarNumeroDisplay();
    } catch (err) {
        console.error(err);
        mostrarToast('Erro ao salvar documento.', 'erro');
    }
}

function numeroRomano(n) {
    const romanos = [['X', 10], ['IX', 9], ['V', 5], ['IV', 4], ['I', 1]];
    let res = '';
    for (const [r, v] of romanos) { while (n >= v) { res += r; n -= v; } }
    return res;
}

// ===== NOVO ORÇAMENTO =====
function novoOrcamento() {
    orcamentoEditandoId = null;
    obraVinculadaOrcamentoId = '';
    tipoDocumentoAtual = 'orcamento';
    aplicarTipoDocumento();
    document.getElementById('campo-cliente').value = '';
    document.getElementById('campo-obra').value = '';
    document.getElementById('campo-endereco').value = '';
    document.getElementById('campo-estado').value = '';
    limparObservacoes();
    document.getElementById('display-rev').innerHTML = '';
    const hoje = new Date();
    const validade = new Date();
    validade.setDate(hoje.getDate() + 30);
    document.getElementById('campo-data').value = hoje.toISOString().split('T')[0];
    document.getElementById('campo-validade').value = validade.toISOString().split('T')[0];
    document.getElementById('linhas-tbody').innerHTML = '';
    linhaId = 0;
    cabecalhoId = 0;
    imagemLinhaId = 0;
    adicionarLinha();
    adicionarLinha();
    limparDesconto();
    limparPagamento();
    calcularTotais();
    atualizarNumeroDisplay();
    mudarAba('orcamento', document.querySelector(".nav-tab[onclick*=\"orcamento\"]") || document.querySelector('.nav-tab'));
}

function iniciarOrcamentoParaObra(obra = {}, data = '') {
    novoOrcamento();
    obraVinculadaOrcamentoId = obra.id || '';
    document.getElementById('campo-cliente').value = obra.construtora || obra.nome || '';
    document.getElementById('campo-obra').value = obra.nome || '';
    document.getElementById('campo-endereco').value = obra.local || '';
    if (data) document.getElementById('campo-data').value = data;
    calcularTotais();
    mostrarToast('Orçamento vinculado à obra iniciado.', 'sucesso');
}

// ===== EDITAR =====
async function editarOrcamento(id) {
    const orc = getHistorico().find(o => o.id === id);
    if (!orc) return;
    orcamentoEditandoId = id;
    obraVinculadaOrcamentoId = orc.obraId || '';
    tipoDocumentoAtual = getTipoDocumento(orc);
    aplicarTipoDocumento();
    document.getElementById('campo-cliente').value = orc.cliente || '';
    document.getElementById('campo-obra').value = orc.obra || '';
    document.getElementById('campo-endereco').value = orc.endereco || '';
    document.getElementById('campo-estado').value = orc.estado || '';
    document.getElementById('campo-data').value = orc.data || '';
    document.getElementById('campo-validade').value = orc.validade || '';
    restaurarObservacoes(orc);
    document.getElementById('linhas-tbody').innerHTML = '';
    linhaId = 0;
    cabecalhoId = 0;
    imagemLinhaId = 0;
    for (const l of (orc.linhas || [])) {
        if (l.tipo === 'cabecalho') {
            adicionarCabecalho(l.texto || '');
        } else if (l.tipo === 'imagem') {
            await restaurarImagemOrcamento(l);
        } else if (l.tipo === 'opcao') {
            adicionarLinha(l.desc, l.area, l.materialArr || (l.material ? [l.material] : []), l.custoMaterial, l.custoMao, l.total, l.areaLabel || '', { tipo: 'opcao', baseId: l.baseId || '' });
        } else {
            adicionarLinha(l.desc, l.area, l.materialArr || (l.material ? [l.material] : []), l.custoMaterial, l.custoMao, l.total, l.areaLabel || '');
        }
    }
    descontoAplicado = orc.desconto || 0;
    limparDescontoCalculo();
    restaurarPagamento(orc.pagamento);
    calcularTotais();
    document.getElementById('display-numero').textContent = '#' + String(orc.numero).padStart(3, '0');
    const revLabel = orc.revisoes && orc.revisoes.length > 0
        ? 'REV ' + numeroRomano(orc.revisoes.length + 1) + ' (próxima ao salvar)'
        : '';
    document.getElementById('display-rev').innerHTML = revLabel ? `<div class="orca-rev-badge">${revLabel}</div>` : '';
    mudarAba('orcamento', document.querySelector(".nav-tab[onclick*=\"orcamento\"]") || document.querySelector('.nav-tab'));
    mostrarToast('Orçamento carregado para edição.', 'sucesso');
}

// ===== EXCLUIR =====
function confirmarExcluir(id) {
    abrirModal('Excluir Orçamento', 'Esta ação é irreversível. Deseja excluir este orçamento?', async () => {
        try {
            await DB.excluirOrcamento(id);
            setHistorico(getHistorico().filter(o => o.id !== id));
            renderizarHistorico();
            mostrarToast('Orçamento excluído.', 'erro');
        } catch {
            mostrarToast('Erro ao excluir orçamento.', 'erro');
        }
    });
}

// ===== HISTÓRICO =====
let filtroBusca = '';
let tipoHistoricoAtual = 'orcamento';

function filtrarHistorico(v) {
    filtroBusca = v.toLowerCase();
    renderizarHistorico();
}

function setTipoHistorico(tipo) {
    tipoHistoricoAtual = normalizarTipoDocumento(tipo);
    renderizarHistorico();
}

function getDataOrdenacaoHistorico(o) {
    const savedTime = o.savedAt ? new Date(o.savedAt).getTime() : NaN;
    if (Number.isFinite(savedTime)) return savedTime;

    const dataTime = o.data ? new Date(o.data + 'T12:00:00').getTime() : NaN;
    if (Number.isFinite(dataTime)) return dataTime;

    return Number(o.numero) || 0;
}

function renderizarHistorico() {
    const hist = getHistorico()
        .filter(o => getTipoDocumento(o) === tipoHistoricoAtual)
        .sort((a, b) => getDataOrdenacaoHistorico(b) - getDataOrdenacaoHistorico(a));
    const cont = document.getElementById('hist-conteudo');
    const titulo = document.getElementById('hist-titulo');
    const tabOrcamento = document.getElementById('hist-tab-orcamento');
    const tabCobranca = document.getElementById('hist-tab-cobranca');
    const isCobranca = tipoHistoricoAtual === 'cobranca';

    if (titulo) titulo.textContent = isCobranca ? 'Histórico de Relatórios de Cobrança' : 'Histórico de Orçamentos';
    if (tabOrcamento) {
        tabOrcamento.classList.toggle('ativo', !isCobranca);
        tabOrcamento.setAttribute('aria-selected', String(!isCobranca));
    }
    if (tabCobranca) {
        tabCobranca.classList.toggle('ativo', isCobranca);
        tabCobranca.setAttribute('aria-selected', String(isCobranca));
    }

    const filtrados = filtroBusca
        ? hist.filter(o => (o.cliente || '').toLowerCase().includes(filtroBusca) || String(o.numero).includes(filtroBusca) || (o.assunto || o.obra || '').toLowerCase().includes(filtroBusca))
        : hist;
    if (filtrados.length === 0) {
        const vazio = isCobranca ? 'Nenhum relatório de cobrança encontrado.' : 'Nenhum orçamento encontrado.';
        cont.innerHTML = `<div class="hist-vazio"><div class="icone">📋</div><p>${vazio}<br>Crie seu primeiro documento na aba <strong>Novo Orçamento</strong>.</p></div>`;
        return;
    }
    cont.innerHTML = `<div class="hist-lista">${filtrados.map(o => renderItemHistorico(o)).join('')}</div>`;
}

function renderItemHistorico(o) {
    const nRevs = (o.revisoes || []).length;
    const dataFmt = o.data ? new Date(o.data + 'T12:00:00').toLocaleDateString('pt-BR') : '-';
    const savedFmt = o.savedAt ? new Date(o.savedAt).toLocaleDateString('pt-BR') : '';
    const aprovado = o.statusAprovacao === 'aprovado' || o.aprovado === true;
    const dataAprovacaoFmt = o.dataAprovacao ? new Date(o.dataAprovacao + 'T12:00:00').toLocaleDateString('pt-BR') : '';
    const tipoDoc = getTipoDocumento(o);
    const isOrcamento = tipoDoc === 'orcamento';
    const tipoBadge = `<span class="hist-rev-badge" style="background:${tipoDoc === 'cobranca' ? '#2563a8' : '#6b6660'}">${escapeHtml(getLabelTipoDocumento(tipoDoc))}</span>`;
    const aprovacaoBadge = isOrcamento
        ? (aprovado ? `<span class="hist-status-badge aprovado">Aprovado${dataAprovacaoFmt ? ' em ' + escapeHtml(dataAprovacaoFmt) : ''}</span>` : `<span class="hist-status-badge pendente">Pendente</span>`)
        : '';
    const revBadge = o.revisao ? `<span class="hist-rev-badge">${escapeHtml(o.revisao)}</span>` : '';
    const nRevBadge = nRevs > 0 ? `<span class="hist-rev-badge" style="background:#6b6660">${nRevs} rev.</span>` : '';
    const assunto = o.assunto || o.obra || '';
    const assuntoHtml = assunto ? `<span class="hist-assunto">${escapeHtml(assunto)}</span>` : '';
    const totalHistorico = calcularTotalHistorico(o);
    return `
    <div class="hist-item ${o.revisao ? 'rev' : ''}">
      <div class="hist-item-header">
        <div class="hist-item-info">
          <div class="hist-item-num">#${String(o.numero).padStart(3, '0')} ${tipoBadge} ${aprovacaoBadge} ${revBadge} ${nRevBadge}</div>
          <div class="hist-item-cliente">${escapeHtml(o.cliente || '(sem nome)')}</div>
          <div class="hist-item-meta">${assuntoHtml} ${o.estado ? ' - ' + escapeHtml(o.estado) : ''} ${dataFmt ? ' - ' + escapeHtml(dataFmt) : ''} ${savedFmt ? ' - Salvo em ' + escapeHtml(savedFmt) : ''}</div>
        </div>
        <div class="hist-item-total">${formatarMoeda(totalHistorico)}</div>
        <div class="hist-item-acoes">
          <div class="hist-acoes-linha">
            <button class="btn-mini editar" onclick="editarOrcamento('${escapeAttr(o.id)}')">Editar</button>
            <button class="btn-mini excluir" onclick="confirmarExcluir('${escapeAttr(o.id)}')">Excluir</button>
          </div>
          ${isOrcamento ? `
          <div class="hist-aprovacao-wrap">
            <button class="btn-aprovacao ${aprovado ? 'aprovado' : 'pendente'}" onclick="toggleAprovacaoHistorico('${escapeAttr(o.id)}')">${aprovado ? 'Aprovado' : 'Pendente'}</button>
            <div class="aprovacao-menu" id="aprovacao-menu-${escapeAttr(o.id)}">
              <label>Data da aprova&ccedil;&atilde;o</label>
              <input type="date" id="aprovacao-data-${escapeAttr(o.id)}" value="${escapeAttr(o.dataAprovacao || new Date().toISOString().slice(0, 10))}">
              <div class="aprovacao-menu-acoes">
                <button type="button" class="btn-mini editar" onclick="confirmarAprovacaoHistorico('${escapeAttr(o.id)}')">Aprovar</button>
                <button type="button" class="btn-mini excluir" onclick="fecharMenuAprovacao('${escapeAttr(o.id)}')">Cancelar</button>
              </div>
            </div>
          </div>
          ${aprovado ? `<button type="button" class="btn-cobranca-hist" onclick="gerarRelatorioCobrancaDeOrcamento('${escapeAttr(o.id)}')">Gerar relat&oacute;rio de cobran&ccedil;a</button>` : ''}
          ` : ''}
        </div>
      </div>
    </div>`;
}

function fecharMenusAprovacao() {
    document.querySelectorAll('.aprovacao-menu.aberto').forEach(menu => menu.classList.remove('aberto'));
    document.querySelectorAll('.hist-item.menu-aprovacao-aberto').forEach(item => item.classList.remove('menu-aprovacao-aberto'));
}

function fecharMenuAprovacao(id) {
    const menu = document.getElementById(`aprovacao-menu-${id}`);
    menu?.classList.remove('aberto');
    menu?.closest('.hist-item')?.classList.remove('menu-aprovacao-aberto');
}

function toggleAprovacaoHistorico(id) {
    const orc = getHistorico().find(o => o.id === id);
    if (!orc) return;
    const aprovado = orc.statusAprovacao === 'aprovado' || orc.aprovado === true;

    if (aprovado) {
        abrirModal('Marcar como pendente', 'Deseja voltar este orçamento para o status pendente?', () => atualizarAprovacaoHistorico(id, 'pendente', ''));
        return;
    }

    const menu = document.getElementById(`aprovacao-menu-${id}`);
    if (!menu) return;
    const estavaAberto = menu.classList.contains('aberto');
    fecharMenusAprovacao();
    if (!estavaAberto) {
        menu.classList.add('aberto');
        menu.closest('.hist-item')?.classList.add('menu-aprovacao-aberto');
    }
}

async function confirmarAprovacaoHistorico(id) {
    const data = document.getElementById(`aprovacao-data-${id}`)?.value;
    if (!data) {
        mostrarToast('Informe a data da aprovação.', 'erro');
        return;
    }
    await atualizarAprovacaoHistorico(id, 'aprovado', data);
}

async function atualizarAprovacaoHistorico(id, status, dataAprovacao) {
    const hist = getHistorico();
    const idx = hist.findIndex(o => o.id === id);
    if (idx < 0) return;

    const aprovado = status === 'aprovado';
    const atualizado = {
        ...hist[idx],
        statusAprovacao: status,
        aprovado,
        dataAprovacao: aprovado ? dataAprovacao : ''
    };

    try {
        await DB.salvarOrcamento({
            statusAprovacao: atualizado.statusAprovacao,
            aprovado: atualizado.aprovado,
            dataAprovacao: atualizado.dataAprovacao
        }, id);
        hist[idx] = atualizado;
        setHistorico(hist);
        renderizarHistorico();
        window.renderizarFluxoFinanceiro?.();
        mostrarToast(aprovado ? 'Orçamento aprovado.' : 'Orçamento marcado como pendente.', 'sucesso');
    } catch (err) {
        console.error(err);
        mostrarToast('Erro ao atualizar aprovação.', 'erro');
    }
}

async function gerarRelatorioCobrancaDeOrcamento(id) {
    const origem = getHistorico().find(o => o.id === id);
    if (!origem) return;
    const aprovado = origem.statusAprovacao === 'aprovado' || origem.aprovado === true;
    if (!aprovado) {
        mostrarToast('Aprove o orçamento antes de gerar o relatório de cobrança.', 'erro');
        return;
    }

    const hoje = new Date().toISOString().slice(0, 10);
    const relatorio = {
        ...origem,
        id: undefined,
        tipoDocumento: 'cobranca',
        numero: proximoNumero('cobranca'),
        data: hoje,
        validade: hoje.slice(0, 7),
        savedAt: new Date().toISOString(),
        revisao: null,
        revisoes: [],
        statusAprovacao: '',
        aprovado: false,
        dataAprovacao: '',
        orcamentoOrigemId: origem.id,
        orcamentoOrigemNumero: origem.numero || ''
    };

    try {
        const novoId = await DB.salvarOrcamento(prepararOrcamentoParaFirestore(relatorio));
        const hist = getHistorico();
        hist.push({ ...relatorio, id: novoId });
        setHistorico(hist);
        tipoHistoricoAtual = 'cobranca';
        renderizarHistorico();
        window.renderizarFluxoFinanceiro?.();
        mostrarToast('Relatório de cobrança criado.', 'sucesso');
        editarOrcamento(novoId);
    } catch (err) {
        console.error(err);
        mostrarToast('Erro ao gerar relatório de cobrança.', 'erro');
    }
}

function calcularTotalHistorico(o) {
    const totalSalvo = Number(o.totalComDesconto);
    if (Number.isFinite(totalSalvo) && totalSalvo > 0) return totalSalvo;

    const subtotalSalvo = Number(o.subtotal);
    if (Number.isFinite(subtotalSalvo) && subtotalSalvo > 0) {
        return o.desconto ? subtotalSalvo * (1 - Number(o.desconto) / 100) : subtotalSalvo;
    }

    const subtotalLinhas = (o.linhas || []).reduce((acc, linha) => {
        if (!linha || linha.tipo === 'cabecalho' || linha.tipo === 'imagem' || linha.tipo === 'opcao') return acc;
        const totalLinha = Number(linha.total);
        if (Number.isFinite(totalLinha)) return acc + totalLinha;
        const subtotalMaterial = Number(linha.subtotalMaterial);
        const subtotalMao = Number(linha.subtotalMao);
        if (Number.isFinite(subtotalMaterial) || Number.isFinite(subtotalMao)) {
            return acc + (subtotalMaterial || 0) + (subtotalMao || 0);
        }
        const area = Number(linha.area) || 0;
        const custoMaterial = Number(linha.custoMaterial) || 0;
        const custoMao = Number(linha.custoMao) || 0;
        return acc + area * (custoMaterial + custoMao);
    }, 0);

    return o.desconto ? subtotalLinhas * (1 - Number(o.desconto) / 100) : subtotalLinhas;
}

// ===== UTILITÁRIOS =====
function formatarMoeda(v) {
    return (v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function formatarReferenciaDocumento(valor, isCobranca = false) {
    if (!valor) return '-';
    if (isCobranca && /^\d{4}-\d{2}$/.test(valor)) {
        return new Date(valor + '-01T12:00:00').toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
    }
    return new Date(valor + 'T12:00:00').toLocaleDateString('pt-BR');
}

function mostrarToast(msg, tipo = '') {
    const t = document.getElementById('toast');
    if (!msg) { t.classList.remove('visivel'); return; }
    t.textContent = msg;
    t.className = 'toast ' + tipo;
    t.classList.add('visivel');
    setTimeout(() => t.classList.remove('visivel'), 3200);
}

function abrirModal(titulo, msg, cb) {
    document.getElementById('modal-titulo').textContent = titulo;
    document.getElementById('modal-msg').textContent = msg;
    document.getElementById('modal-confirmar').onclick = () => { cb(); fecharModal(); };
    document.getElementById('modal-overlay').classList.add('aberto');
}

function fecharModal() {
    document.getElementById('modal-overlay').classList.remove('aberto');
}

document.getElementById('modal-overlay').addEventListener('click', e => {
    if (e.target === e.currentTarget) fecharModal();
});

// ===== ORIENTAÇÃO DO PDF =====
let pdfOrientacao = 'portrait'; // 'portrait' | 'landscape'
let pdfPreviewUrl = '';
let pdfPreviewDoc = null;
let pdfPreviewNome = '';

function setPdfOrientacao(valor, btn) {
    pdfOrientacao = valor;
    document.querySelectorAll('.pdf-layout-btn').forEach(b => {
        const ativo = b.dataset.orientacao ? b.dataset.orientacao === valor : b === btn;
        b.classList.toggle('ativo', ativo);
    });
    if (btn) btn.classList.add('ativo');

    if (document.getElementById('modal-preview-pdf')?.classList.contains('aberto')) {
        atualizarPreviewPDF();
    }
}

function abrirPreviewPDF() {
    mostrarToast('Preparando prévia do PDF...', '');
    const resultado = gerarPDF(false);
    if (!resultado) return;
    exibirPreviewPDF(resultado);
    document.getElementById('modal-preview-pdf')?.classList.add('aberto');
}

function atualizarPreviewPDF() {
    const resultado = gerarPDF(false);
    if (!resultado) return;
    exibirPreviewPDF(resultado);
}

function exibirPreviewPDF(resultado) {
    if (pdfPreviewUrl) URL.revokeObjectURL(pdfPreviewUrl);
    pdfPreviewDoc = resultado.doc;
    pdfPreviewNome = resultado.nomeArq;
    pdfPreviewUrl = URL.createObjectURL(resultado.doc.output('blob'));
    const frame = document.getElementById('pdf-preview-frame');
    if (frame) frame.src = pdfPreviewUrl;
}

function baixarPDFPreview() {
    if (!pdfPreviewDoc) {
        const resultado = gerarPDF(false);
        if (!resultado) return;
        exibirPreviewPDF(resultado);
    }
    pdfPreviewDoc.save(pdfPreviewNome);
    mostrarToast('PDF baixado com sucesso!', 'sucesso');
}

function fecharPreviewPDF() {
    document.getElementById('modal-preview-pdf')?.classList.remove('aberto');
    const frame = document.getElementById('pdf-preview-frame');
    if (frame) frame.src = 'about:blank';
    if (pdfPreviewUrl) URL.revokeObjectURL(pdfPreviewUrl);
    pdfPreviewUrl = '';
    pdfPreviewDoc = null;
    pdfPreviewNome = '';
}

// ===== PDF =====
function gerarPDF(baixar = true) {
    if (typeof window.jspdf === 'undefined' && typeof jsPDF === 'undefined') {
        mostrarToast('Biblioteca PDF não carregada. Recarregue a página.', 'erro');
        return;
    }
    const dados = coletarDados();
    if (!dados.cliente) { mostrarToast('Informe o nome do cliente antes de gerar o PDF.', 'erro'); return; }
    if (baixar) mostrarToast('Gerando PDF...', '');

    const { jsPDF: JsPDF } = window.jspdf || {};
    const Doc = JsPDF || jsPDF;
    const isLandscape = pdfOrientacao === 'landscape';
    const doc = new Doc({ unit: 'mm', format: 'a4', orientation: pdfOrientacao });

    const numDisplay = document.getElementById('display-numero').textContent;
    const dataFmt = dados.data ? new Date(dados.data + 'T12:00:00').toLocaleDateString('pt-BR') : '—';
    const isCobranca = getTipoDocumento(dados) === 'cobranca';
    const docTitulo = getLabelTipoDocumento(dados.tipoDocumento).toUpperCase();
    const validFmt = formatarReferenciaDocumento(dados.validade, isCobranca);

    const PW = isLandscape ? 297 : 210;
    const PH = isLandscape ? 210 : 297;
    const ML = 14, MR = 14, CW = PW - ML - MR;
    const C_AZUL_ESC = [26, 58, 92], C_AZUL_MED = [37, 99, 168], C_AZUL_CLA = [74, 144, 217];
    const C_AZUL_FADE = [232, 240, 250], C_LARANJA = [224, 92, 32];
    const C_BRANCO = [255, 255, 255], C_TEXTO = [26, 24, 20];
    const C_CINZA = [107, 102, 96], C_BORDA = [216, 212, 204], C_ZEBRA = [245, 247, 250];

    let y = 0;
    const HEADER_H = 28;
    doc.setFillColor(...C_AZUL_ESC);
    doc.rect(0, 0, PW, HEADER_H, 'F');

    if (logoBase64) {
        try {
            const fmt = logoBase64.startsWith('data:image/png') ? 'PNG' : logoBase64.startsWith('data:image/svg') ? 'SVG' : 'JPEG';
            doc.addImage(logoBase64, fmt === 'SVG' ? 'PNG' : fmt, ML, 4, 38, 16, undefined, 'FAST');
            _pdfMarcaDetalhes(doc, ML, 24, 6.5, [200, 210, 225]);
        } catch { _pdfLogoTexto(doc, ML, C_BRANCO, C_AZUL_CLA); }
    } else {
        _pdfLogoTexto(doc, ML, C_BRANCO, C_AZUL_CLA);
    }

    doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor(...C_AZUL_CLA);
    doc.text(docTitulo, PW - MR, 14, { align: 'right' });
    doc.setFont('helvetica', 'bold'); doc.setFontSize(20); doc.setTextColor(...C_BRANCO);
    doc.text(numDisplay, PW - MR, 24, { align: 'right' });
    y = HEADER_H + 8;

    // Cliente
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(...C_CINZA);
    doc.text('CLIENTE', ML, y); doc.text(isCobranca ? 'DATA COBRANCA' : 'DATA', ML + CW * 0.55, y); doc.text(isCobranca ? 'MES REFERENCIA' : 'VALIDADE', ML + CW * 0.78, y);
    y += 4;
    doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(...C_TEXTO);
    doc.text(dados.cliente || '—', ML, y);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(10);
    doc.text(dataFmt, ML + CW * 0.55, y);
    doc.text(validFmt, ML + CW * 0.78, y);
    y += 6;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(...C_CINZA);
    if (dados.endereco) { doc.text(dados.endereco + (dados.estado ? ', ' + dados.estado : ''), ML, y); y += 5; }
    if (dados.obra) { doc.text(dados.obra, ML, y); y += 5; }
    doc.setDrawColor(...C_BORDA); doc.setLineWidth(0.3); doc.line(ML, y, ML + CW, y); y += 5;

    // Tabela — larguras responsivas por orientação
    // Paisagem tem +87mm de largura útil, distribuímos nas colunas de texto
    const COL_UNID  = isLandscape ? 24 : 20;
    const COL_CMAT  = isLandscape ? 22 : 18;
    const COL_CMO   = isLandscape ? 22 : 18;
    const COL_TMAT  = isLandscape ? 24 : 20;
    const COL_TMAO  = isLandscape ? 24 : 20;
    const COL_FIXED = COL_UNID + COL_CMAT + COL_CMO + COL_TMAT + COL_TMAO; // colunas numéricas fixas
    const COL_FLEX  = CW - COL_FIXED; // espaço restante para desc + material
    const COL_DESC  = Math.round(COL_FLEX * 0.45);
    const COL_MAT   = COL_FLEX - COL_DESC;

    // Espaçamento interno das células
    const PAD_X  = 3.5; // padding horizontal dentro de cada célula
    const PAD_Y  = 3.5; // padding vertical (topo e base)
    const LINE_H = 5.0; // altura por linha de texto (leading)
    const HDR_H  = 10;  // altura do cabeçalho

    // Helper: quebra texto respeitando largura máxima da coluna
    function wrapText(doc, text, maxW) {
        if (!text) return ['-'];
        return doc.splitTextToSize(String(text), maxW);
    }

    // Retorna a baseline Y da primeira linha de um bloco centralizado verticalmente
    function vCenter(rowY, rowH, nLines) {
        const blockH = nLines * LINE_H;
        return rowY + (rowH - blockH) / 2 + LINE_H * 0.75;
    }

    const cols = [
        { label: 'Descrição do Serviço', w: COL_DESC, align: 'left'   },
        { label: 'Área',                 w: COL_UNID, align: 'center' },
        { label: 'Material',             w: COL_MAT,  align: 'left'   },
        { label: 'Mat./m²',              w: COL_CMAT, align: 'right'  },
        { label: 'M.O./m²',              w: COL_CMO,  align: 'right'  },
        { label: 'Total Mat.',           w: COL_TMAT, align: 'right'  },
        { label: 'Total M.O.',           w: COL_TMAO, align: 'right'  },
    ];

    // ── Cabeçalho ──
    doc.setFillColor(...C_AZUL_ESC);
    doc.rect(ML, y, CW, HDR_H, 'F');
    let cx = ML;
    cols.forEach(col => {
        doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.setTextColor(...C_BRANCO);
        const tx = col.align === 'right'  ? cx + col.w - PAD_X
                 : col.align === 'center' ? cx + col.w / 2
                 : cx + PAD_X;
        doc.text(col.label, tx, y + HDR_H / 2 + 1.5, { align: col.align });
        cx += col.w;
    });
    y += HDR_H;

    // ── Linhas da tabela ──
    const linhasFiltradas = dados.linhas.filter(l => l.tipo === 'cabecalho' || l.tipo === 'imagem' || l.tipo === 'opcao' || l.desc || l.total > 0);
    if (linhasFiltradas.length === 0) {
        const emptyH = LINE_H + PAD_Y * 2;
        doc.setFillColor(...C_ZEBRA); doc.rect(ML, y, CW, emptyH, 'F');
        doc.setFont('helvetica', 'italic'); doc.setFontSize(8); doc.setTextColor(...C_CINZA);
        doc.text('Nenhum item adicionado', ML + PAD_X, vCenter(y, emptyH, 1));
        y += emptyH;
    } else {
        let itemIdx = 0;
        linhasFiltradas.forEach((l) => {
            // Linha de cabeçalho de seção
            if (l.tipo === 'cabecalho') {
                const cabH = 9;
                if (y + cabH > PH - 27) { doc.addPage(); y = 14; }
                doc.setFillColor(26, 58, 92);
                doc.rect(ML, y, CW, cabH, 'F');
                doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5); doc.setTextColor(255, 255, 255);
                doc.text((l.texto || '').toUpperCase(), ML + PAD_X + 2, y + cabH / 2 + 1.5);
                y += cabH + 1;
                return;
            }

            if (l.tipo === 'imagem') {
                if (!l.src) return;
                const ratio = (l.width && l.height) ? l.height / l.width : 0.56;
                const imgW = Math.min(CW * 0.92, isLandscape ? 150 : 130);
                const imgH = imgW * ratio;
                if (y + imgH + 8 > PH - 27) { doc.addPage(); y = 14; }
                const imgX = ML + (CW - imgW) / 2;
                try {
                    const fmt = l.src.startsWith('data:image/png') ? 'PNG' : 'JPEG';
                    doc.addImage(l.src, fmt, imgX, y + 4, imgW, imgH, undefined, 'FAST');
                    y += imgH + 10;
                } catch {
                    doc.setFont('helvetica', 'italic'); doc.setFontSize(8); doc.setTextColor(...C_CINZA);
                    doc.text('Imagem nao pode ser adicionada ao PDF.', ML, y + 6);
                    y += 10;
                }
                return;
            }

            doc.setFont('helvetica', 'normal'); doc.setFontSize(8);

            // Calcular quebras de texto para colunas multiline
            const descLines = wrapText(doc, l.desc || '-', COL_DESC - PAD_X * 2);
            const areaValorFmt = Number(l.area || 0).toLocaleString('pt-BR', { maximumFractionDigits: 2 });
            const areaText = l.areaLabel ? `${areaValorFmt} ${l.areaLabel}` : areaValorFmt;
            const areaLines = wrapText(doc, areaText, COL_UNID - PAD_X * 2);

            // Materiais: array salvo (multi-checkbox) ou string separada por vírgula
            const matItems = (l.materialArr && l.materialArr.length > 0)
                ? l.materialArr
                : (l.material ? l.material.split(', ') : ['-']);
            const matLines = matItems.flatMap(m => wrapText(doc, m.trim(), COL_MAT - PAD_X * 2));

            // Altura da linha = bloco mais alto + padding superior + inferior
            const nLines = Math.max(descLines.length, matLines.length, areaLines.length, 1);
            const rowH   = nLines * LINE_H + PAD_Y * 2;

            // Quebra de página antecipada
            if (y + rowH > PH - 27) { doc.addPage(); y = 14; }

            // Fundo zebrado
            doc.setFillColor(...(l.tipo === 'opcao' ? [255, 248, 236] : (itemIdx % 2 === 0 ? C_ZEBRA : C_BRANCO)));
            doc.rect(ML, y, CW, rowH, 'F');

            // Borda inferior
            doc.setDrawColor(...C_BORDA); doc.setLineWidth(0.25);
            doc.line(ML, y + rowH, ML + CW, y + rowH);

            // Divisores verticais entre colunas
            doc.setDrawColor(210, 205, 198); doc.setLineWidth(0.15);
            let sepX = ML;
            cols.forEach((col, ci) => {
                sepX += col.w;
                if (ci < cols.length - 1) doc.line(sepX, y + 1.5, sepX, y + rowH - 1.5);
            });

            // Baselines centralizadas verticalmente para cada bloco
            const descBase = vCenter(y, rowH, descLines.length);
            const matBase  = vCenter(y, rowH, matLines.length);
            const areaBase = vCenter(y, rowH, areaLines.length);
            const midY     = vCenter(y, rowH, 1); // linha única

            let ccx = ML;

            // DESC
            doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(...C_TEXTO);
            if (l.tipo === 'opcao') {
                doc.setFont('helvetica', 'bold'); doc.setFontSize(7); doc.setTextColor(...C_LARANJA);
                doc.text('OPCAO', ccx + PAD_X, y + 5);
                doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(...C_TEXTO);
            }
            descLines.forEach((line, li) => {
                doc.text(line, ccx + PAD_X, descBase + li * LINE_H + (l.tipo === 'opcao' ? 2 : 0));
            });
            ccx += COL_DESC;

            // ÁREA — valor + unidade na mesma linha
            doc.setFont('helvetica', 'normal'); doc.setFontSize(7.2); doc.setTextColor(...C_CINZA);
            areaLines.forEach((line, li) => doc.text(line, ccx + COL_UNID / 2, areaBase + li * LINE_H, { align: 'center' }));
            ccx += COL_UNID;

            // MATERIAL
            doc.setFont('helvetica', 'normal'); doc.setFontSize(7.8); doc.setTextColor(...C_AZUL_ESC);
            matLines.forEach((line, li) => {
                doc.text(line, ccx + PAD_X, matBase + li * LINE_H);
            });
            ccx += COL_MAT;

            // VALORES NUMÉRICOS
            doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(...C_TEXTO);
            doc.text(formatarMoeda(l.custoMaterial || 0), ccx + COL_CMAT - PAD_X, midY, { align: 'right' }); ccx += COL_CMAT;
            doc.text(formatarMoeda(l.custoMao      || 0), ccx + COL_CMO  - PAD_X, midY, { align: 'right' }); ccx += COL_CMO;

            doc.setFont('helvetica', 'bold'); doc.setTextColor(...C_AZUL_ESC);
            doc.text(formatarMoeda(l.subtotalMaterial), ccx + COL_TMAT - PAD_X, midY, { align: 'right' }); ccx += COL_TMAT;
            doc.text(formatarMoeda(l.subtotalMao),      ccx + COL_TMAO - PAD_X, midY, { align: 'right' });

            doc.setFont('helvetica', 'normal'); doc.setTextColor(...C_TEXTO);
            y += rowH;
            itemIdx++;
        });
    }

    doc.setDrawColor(...C_AZUL_ESC); doc.setLineWidth(0.5); doc.line(ML, y, ML + CW, y); y += 1;
    const totais = calcularTotais();
    const totalGeral = totais.subtotalMaterial + totais.subtotalMaoObra;
    const totalComDesconto = dados.desconto ? totalGeral * (1 - dados.desconto / 100) : totalGeral;
    [
        ['Subtotal Material', totais.subtotalMaterial],
        ['Subtotal Mão de Obra', totais.subtotalMaoObra],
    ].forEach(([label, val]) => {
        if (y + 7 > PH - 27) { doc.addPage(); y = 14; }
        doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(...C_CINZA);
        doc.text(label, ML + CW - COL_TMAO - 30, y + 6, { align: 'right' });
        doc.setTextColor(...C_TEXTO); doc.text(formatarMoeda(val), ML + CW - 2, y + 6, { align: 'right' }); y += 6;
    });
    y += 2;
    if (dados.desconto) {
        if (y + 7 > PH - 27) { doc.addPage(); y = 14; }
        doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(...C_LARANJA);
        doc.text(`Desconto (${dados.desconto}%)`, ML + CW - COL_TMAO - 30, y + 6, { align: 'right' });
        doc.text(`- ${formatarMoeda(totalGeral * dados.desconto / 100)}`, ML + CW - 2, y + 6, { align: 'right' }); y += 7;
    }
    if (y + 10 > PH - 27) { doc.addPage(); y = 14; }
    doc.setFillColor(...C_AZUL_ESC); doc.rect(ML, y, CW, 12, 'F');
    doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor(...C_BRANCO);
    doc.text('TOTAL GERAL', ML + CW - COL_TMAO - 30, y + 8, { align: 'right' });
    doc.setFontSize(13); doc.setTextColor(...C_AZUL_CLA);
    doc.text(formatarMoeda(totalComDesconto), ML + CW - 2, y + 8.5, { align: 'right' }); y += 16;

    (dados.totaisOpcoes || totais.opcoes || []).forEach(opcao => {
        const blocoH = 30;
        if (y + blocoH > PH - 27) { doc.addPage(); y = 14; }
        doc.setFillColor(255, 248, 236);
        doc.setDrawColor(...C_LARANJA);
        doc.setLineWidth(0.6);
        doc.rect(ML, y, CW, blocoH, 'F');
        doc.setFillColor(...C_LARANJA);
        doc.rect(ML, y, 3, blocoH, 'F');

        doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.setTextColor(...C_LARANJA);
        doc.text(`CÁLCULO SEPARADO: ${(opcao.titulo || 'OPÇÃO').toUpperCase()}`, ML + 6, y + 6);

        doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(...C_CINZA);
        doc.text('Subtotal Material', ML + CW - 46, y + 13, { align: 'right' });
        doc.text('Subtotal Mão de Obra', ML + CW - 46, y + 19, { align: 'right' });
        doc.setFont('helvetica', 'bold'); doc.setTextColor(...C_TEXTO);
        doc.text(formatarMoeda(opcao.subtotalMaterial || 0), ML + CW - 4, y + 13, { align: 'right' });
        doc.text(formatarMoeda(opcao.subtotalMaoObra || 0), ML + CW - 4, y + 19, { align: 'right' });
        doc.setFontSize(9.5); doc.setTextColor(...C_LARANJA);
        doc.text('TOTAL DA OPÇÃO', ML + CW - 46, y + 26, { align: 'right' });
        doc.text(formatarMoeda(opcao.totalGeral || 0), ML + CW - 4, y + 26, { align: 'right' });
        y += blocoH + 6;
    });

    if (dados.obs && dados.obs.trim()) {
        if (y + 16 > PH - 27) { doc.addPage(); y = 14; }
        const obsPadding = PAD_X;
        doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5);
        const obsLinhas = doc.splitTextToSize(dados.obs.trim(), CW - obsPadding * 2);
        const obsH = Math.max(16, obsLinhas.length * 5 + 12);
        doc.setFillColor(...C_AZUL_FADE); doc.setDrawColor(...C_AZUL_MED); doc.setLineWidth(0.8);
        doc.rect(ML, y, CW, obsH, 'F');
        doc.setFont('helvetica', 'bold'); doc.setFontSize(7); doc.setTextColor(...C_AZUL_MED);
        doc.text('OBSERVAÇÕES', ML + obsPadding, y + 6);
        doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(68, 68, 68);
        obsLinhas.forEach((linha, li) => {
            doc.text(linha, ML + obsPadding, y + 12 + li * 5);
        });
        y += obsH + 6;
    }

    // ── Condições de Pagamento ──
    if (dados.pagamento && dados.pagamento.opcoes && dados.pagamento.opcoes.length > 0) {
        if (y + 16 > PH - 27) { doc.addPage(); y = 14; }

        // Restaurar valores de entrada para gerar linhas corretamente
        const pgto = dados.pagamento;
        const linhasPgto = [];
        const opcoes = pgto.opcoes || [];
        if (opcoes.includes('avista'))              linhasPgto.push('A VISTA');
        if (opcoes.includes('material_avista'))     linhasPgto.push('MATERIAL A VISTA');
        if (opcoes.includes('material_entrada_saldo')) {
            const ent = pgto.matEntradaPct || 0;
            const sal = Math.max(0, 100 - ent);
            linhasPgto.push(`MATERIAL ${ent}% ENTRADA + SALDO ${sal}% APÓS CONCLUSÃO`);
        }
        if (opcoes.includes('mao_avista'))          linhasPgto.push('MÃO DE OBRA A VISTA');
        if (opcoes.includes('mao_entrada_saldo')) {
            const ent = pgto.maoEntradaPct || 0;
            const sal = Math.max(0, 100 - ent);
            linhasPgto.push(`MÃO DE OBRA ${ent}% ENTRADA + SALDO ${sal}% APÓS CONCLUSÃO`);
        }
        if (opcoes.includes('a_combinar'))          linhasPgto.push('MATERIAL E MÃO DE OBRA: A COMBINAR');

        if (linhasPgto.length > 0) {
            const pgH = Math.max(14, linhasPgto.length * 6 + 14);
            doc.setFillColor(232, 240, 250); doc.setDrawColor(26, 58, 92); doc.setLineWidth(0.8);
            doc.rect(ML, y, CW, pgH, 'F');
            doc.setFillColor(26, 58, 92); doc.rect(ML, y, 3, pgH, 'F');
            // Título
            doc.setFont('helvetica', 'bold'); doc.setFontSize(7); doc.setTextColor(26, 58, 92);
            doc.text('CONDIÇÕES DE PAGAMENTO', ML + CW / 2, y + 6, { align: 'center' });
            // Linhas de pagamento centralizadas
            doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5); doc.setTextColor(30, 30, 30);
            linhasPgto.forEach((linha, li) => {
                doc.text(linha, ML + CW / 2, y + 12 + li * 6, { align: 'center' });
            });
            y += pgH + 6;
        }
    }

    const footerLineY = PH - 20;
    const footerInfoY = PH - 14;
    const devY = PH - 7;
    if (y > footerLineY - 4) { doc.addPage(); y = 14; }
    doc.setDrawColor(...C_BORDA); doc.setLineWidth(0.3); doc.line(ML, footerLineY, ML + CW, footerLineY);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(...C_CINZA);
    _pdfTextoEmpresaComLink(doc, empresaConfig.empresaNome || 'Empresa', ML, footerInfoY, {});
    doc.text(isCobranca ? `Mes referencia: ${validFmt}` : `Orcamento valido ate ${validFmt}`, ML + CW, footerInfoY, { align: 'right' });
    const devPrefix = 'Desenvolvido por ';
    const devLink = 'Sanoj Sistemas';
    const devX = ML + CW / 2 - (doc.getTextWidth(devPrefix + devLink) / 2);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(...C_CINZA);
    doc.text(devPrefix, devX, devY);
    doc.setTextColor(...C_AZUL_MED);
    doc.textWithLink(devLink, devX + doc.getTextWidth(devPrefix), devY, { url: 'https://www.sanojsistemas.com.br' });

    const assuntoAdendo = (dados.assunto || dados.obra || '').trim().replace(/\s+/g, '_').replace(/[^\w\-]/g, '');
    const nomeArq = `${isCobranca ? 'Relatorio_Cobranca' : 'Orcamento'}_${numDisplay.replace('#', '')}_${(dados.cliente || 'cliente').replace(/\s+/g, '_')}${assuntoAdendo ? '_' + assuntoAdendo : ''}.pdf`;
    if (baixar) {
        doc.save(nomeArq);
        mostrarToast('PDF gerado com sucesso!', 'sucesso');
    }
    return { doc, nomeArq };
}

function _pdfLogoTexto(doc, ML, C_BRANCO, C_AZUL_CLA) {
    const nome = empresaConfig.empresaNome || 'Empresa';
    doc.setFont('helvetica', 'bold'); doc.setFontSize(16); doc.setTextColor(...C_BRANCO);
    _pdfTextoEmpresaComLink(doc, nome, ML, 15, {});
    _pdfMarcaDetalhes(doc, ML, 21, 7, [200, 210, 225]);
}

function _pdfTextoEmpresaComLink(doc, texto, x, y, opcoes = {}) {
    const url = normalizarUrlEmpresa(empresaConfig.empresaUrl);
    if (url) {
        doc.textWithLink(texto, x, y, { ...opcoes, url });
    } else {
        doc.text(texto, x, y, opcoes);
    }
}

function _pdfMarcaDetalhes(doc, x, y, fontSize, textColor) {
    const contato = empresaConfig.empresaContato || '';
    const local = empresaConfig.empresaLocal || '';
    if (!contato && !local) return;

    let cursor = x;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(fontSize);
    doc.setTextColor(...textColor);

    if (contato) {
        if (empresaConfig.empresaContatoWhatsapp) {
            doc.setFillColor(37, 211, 102);
            doc.circle(cursor + 1.8, y - 1.5, 1.9, 'F');
            doc.setTextColor(255, 255, 255);
            doc.setFont('helvetica', 'bold');
            doc.setFontSize(Math.max(5, fontSize - 0.4));
            doc.text('☎', cursor + 1.8, y - 0.05, { align: 'center' });
            cursor += 5.2;
            doc.setFont('helvetica', 'normal');
            doc.setFontSize(fontSize);
            doc.setTextColor(...textColor);
        }
        const contatoTxt = contato.toUpperCase();
        doc.text(contatoTxt, cursor, y);
        cursor += doc.getTextWidth(contatoTxt);
    }

    if (contato && local) {
        doc.text(' • ', cursor, y);
        cursor += doc.getTextWidth(' • ');
    }

    if (local) {
        doc.text(local.toUpperCase(), cursor, y);
    }
}

function truncarTexto(doc, texto, maxW) {
    if (!texto) return '';
    if (doc.getTextWidth(texto) <= maxW) return texto;
    let t = texto;
    while (t.length > 1 && doc.getTextWidth(t + '…') > maxW) { t = t.slice(0, -1); }
    return t + '…';
}

// ===== ADMIN MASTER =====
function nomePlanoAdmin(plano) {
    const chave = String(plano || 'essencial').toLowerCase();
    if (chave === 'profissional') return 'Profissional';
    if (chave === 'completo') return 'Completo';
    return 'Essencial';
}

function renderizarModulosAdmin(user) {
    const modulos = new Set(getModulosPermitidos(user));
    return MODULOS_ADMIN.map(mod => {
        const checked = modulos.has(mod.id) ? 'checked' : '';
        return '<label class="admin-check"><input type="checkbox" data-admin-modulo="' + mod.id + '" ' + checked + '><span>' + escapeHtml(mod.label) + '</span></label>';
    }).join('');
}

async function renderizarAdminMaster() {
    const alvo = document.getElementById('admin-conteudo');
    if (!alvo) return;
    if (!usuarioMasterAtual) {
        alvo.innerHTML = '<div class="admin-vazio">Acesso restrito ao administrador master.</div>';
        return;
    }

    alvo.innerHTML = '<div class="admin-vazio">Carregando usuarios...</div>';
    try {
        adminUsuariosCache = await DB.listarUsuariosAdmin();
        const usuarios = [...adminUsuariosCache].sort((a, b) => {
            const na = (a.empresaNome || a.email || a.id || '').toLowerCase();
            const nb = (b.empresaNome || b.email || b.id || '').toLowerCase();
            return na.localeCompare(nb);
        });

        if (!usuarios.length) {
            alvo.innerHTML = '<div class="admin-vazio">Nenhum usuario encontrado.</div>';
            return;
        }

        alvo.innerHTML = usuarios.map(user => {
            const uid = escapeAttr(user.id);
            const email = escapeHtml(user.email || user.loginEmail || user.id || '');
            const nome = escapeHtml(user.empresaNome || user.nomeEmpresa || 'Empresa sem nome');
            const gestor = escapeHtml(user.empresaGestor || user.gestor || '');
            const bloqueado = user.bloqueado ? 'checked' : '';
            const isMaster = String(user.email || '').toLowerCase() === MASTER_ADMIN_EMAIL || user.isMasterAdmin;
            return '<article class="admin-card" data-admin-user="' + uid + '">' +
                '<div class="admin-card-head">' +
                    '<div><strong>' + nome + '</strong><span>' + email + '</span>' + (gestor ? '<small>Gestor: ' + gestor + '</small>' : '') + '</div>' +
                    '<span class="admin-plano-badge">' + (isMaster ? 'Master' : nomePlanoAdmin(user.plano)) + '</span>' +
                '</div>' +
                '<div class="admin-card-grid">' +
                    '<label><span>Plano</span><select data-admin-plano ' + (isMaster ? 'disabled' : '') + '>' +
                        '<option value="essencial" ' + (String(user.plano || 'essencial').toLowerCase() === 'essencial' ? 'selected' : '') + '>Essencial</option>' +
                        '<option value="profissional" ' + (String(user.plano || '').toLowerCase() === 'profissional' ? 'selected' : '') + '>Profissional</option>' +
                        '<option value="completo" ' + (String(user.plano || '').toLowerCase() === 'completo' ? 'selected' : '') + '>Completo</option>' +
                    '</select></label>' +
                    '<label class="admin-bloqueio"><input type="checkbox" data-admin-bloqueado ' + bloqueado + ' ' + (isMaster ? 'disabled' : '') + '><span>Usuario bloqueado</span></label>' +
                '</div>' +
                '<div class="admin-modulos">' + renderizarModulosAdmin(user) + '</div>' +
                '<label class="admin-observacao"><span>Observacao interna</span><textarea data-admin-observacao rows="2" ' + (isMaster ? 'disabled' : '') + '>' + escapeHtml(user.observacaoAdmin || '') + '</textarea></label>' +
                '<div class="admin-acoes">' +
                    (isMaster ? '<span class="admin-master-nota">Conta master protegida.</span>' : '<button type="button" class="btn-primario" data-admin-salvar="' + uid + '">Salvar permissoes</button>') +
                '</div>' +
            '</article>';
        }).join('');

        document.querySelectorAll('[data-admin-salvar]').forEach(btn => {
            btn.addEventListener('click', () => salvarPermissoesAdmin(btn.dataset.adminSalvar));
        });

        document.querySelectorAll('[data-admin-plano]').forEach(select => {
            select.addEventListener('change', (e) => {
                const card = e.target.closest('.admin-card');
                const defaults = modulosDoPlano(e.target.value);
                card?.querySelectorAll('[data-admin-modulo]').forEach(cb => { cb.checked = defaults.includes(cb.dataset.adminModulo); });
            });
        });
    } catch (err) {
        console.error('Erro no Admin Master:', err);
        alvo.innerHTML = '<div class="admin-vazio">As regras do Firestore ainda nao permitem listar empresas. Publique as regras com: firebase deploy --only firestore:rules</div>';
    }
}

async function salvarPermissoesAdmin(userId) {
    const card = document.querySelector('[data-admin-user="' + CSS.escape(userId) + '"]');
    if (!card) return;
    const plano = card.querySelector('[data-admin-plano]')?.value || 'essencial';
    const modulosLiberados = [...card.querySelectorAll('[data-admin-modulo]:checked')].map(cb => cb.dataset.adminModulo);
    const bloqueado = !!card.querySelector('[data-admin-bloqueado]')?.checked;
    const observacaoAdmin = card.querySelector('[data-admin-observacao]')?.value || '';

    try {
        await DB.salvarPermissoesUsuarioAdmin(userId, { plano, modulosLiberados, bloqueado, observacaoAdmin });
        mostrarToast('Permissoes salvas.', '');
        await renderizarAdminMaster();
    } catch (err) {
        console.error('Erro ao salvar permissoes:', err);
        mostrarToast('Erro ao salvar permissoes do usuario.', 'erro');
    }
}

// Exportar funções para uso global (onclick no HTML)
Object.assign(window, {
    mudarAba, renderizarInicio, aplicarPermissoesUsuario, renderizarAdminMaster, salvarPermissoesAdmin,
    adicionarLinha, removerLinha, calcularLinha, calcularTotais,
    adicionarCabecalho, removerCabecalho, selecionarCabecalho, filtrarCabecalhoOpcoes, abrirDropdownCabecalho,
    toggleDesconto, aplicarDesconto, limparDesconto,
    togglePagamento, aplicarPagamento, limparPagamento, handlePgtoChange, calcularSaldo,
    salvarOrcamento, novoOrcamento, editarOrcamento, confirmarExcluir,
    iniciarOrcamentoParaObra,
    filtrarHistorico, renderizarHistorico, setTipoHistorico,
    toggleAprovacaoHistorico, confirmarAprovacaoHistorico, fecharMenuAprovacao, gerarRelatorioCobrancaDeOrcamento,
    handleImagemOrcamento, adicionarImagemOrcamento, removerImagemOrcamento,
    toggleMenuOpcao, adicionarOpcaoSelecionada,
    toggleTipoDocumento, aplicarTipoDocumento,
    carregarLogo, carregarLogoSalva, aplicarLogoNaTela, removerLogo,
    aplicarConfiguracoesEmpresa, salvarConfiguracoesEmpresa,
    gerarPDF, abrirPreviewPDF, atualizarPreviewPDF, baixarPDFPreview, fecharPreviewPDF,
    setPdfOrientacao, formatarMoeda, mostrarToast, abrirModal, fecharModal,
    getHistorico, setHistorico, proximoNumero, atualizarNumeroDisplay,
    logoBase64,
    // Descrição do serviço (dropdown + manual)
    recarregarOpcoesEditaveisUsuario, removerOpcaoEditavel, adicionarOpcaoEditavel, salvarManualSeMarcado,
    toggleDropdownDesc, selecionarDesc, toggleDescManual, atualizarDescManual, getDescLinha,
    // Área (dropdown + manual)
    toggleDropdownArea, selecionarArea, toggleAreaManual, atualizarAreaManual,
    // Material (multi-checkbox + manual)
    toggleDropdownMaterial, toggleMaterialLinha, toggleMaterialManual, atualizarMaterialManual
});

// Proxy para logoBase64 (precisa ser acessível por referência)
Object.defineProperty(window, 'logoBase64', {
    get() { return logoBase64; },
    set(v) { logoBase64 = v; },
    configurable: true
});
