// ===== AUTH CONTROLLER =====
// Gerencia a tela de login, estado de autenticação e carregamento inicial dos dados

import { auth, initAuth, login, logout, DB } from './firebase.js';

// ===== TELA DE LOGIN =====
function mostrarTelaLogin() {
  document.getElementById('tela-login').classList.add('visivel');
  document.getElementById('app-conteudo').classList.remove('visivel');
  document.getElementById('app-loading').classList.add('oculto');
  // Limpar campos
  document.getElementById('login-email').value = '';
  document.getElementById('login-senha').value = '';
  document.getElementById('login-erro').classList.remove('visivel');
  document.getElementById('login-erro').textContent = '';
}

function ocultarTelaLogin() {
  document.getElementById('tela-login').classList.remove('visivel');
}

function mostrarAppConteudo(user) {
  ocultarTelaLogin();
  document.getElementById('app-loading').classList.add('oculto');
  document.getElementById('app-conteudo').classList.add('visivel');
  // Exibir email na nav
  const emailEl = document.getElementById('nav-usuario-email');
  if (emailEl) emailEl.textContent = user.email;
  const configEmailEl = document.getElementById('config-user-email');
  if (configEmailEl) configEmailEl.textContent = user.email;
}

// ===== FORMULÁRIO DE LOGIN =====
async function handleLogin(e) {
  if (e) e.preventDefault();

  const emailInput = document.getElementById('login-email');
  const senhaInput = document.getElementById('login-senha');
  const erroEl    = document.getElementById('login-erro');
  const btnLogin  = document.getElementById('btn-login');

  const email = emailInput.value.trim();
  const senha = senhaInput.value;

  // Validação básica no front
  erroEl.classList.remove('visivel');
  emailInput.classList.remove('erro');
  senhaInput.classList.remove('erro');

  if (!email || !senha) {
    erroEl.textContent = 'Preencha e-mail e senha.';
    erroEl.classList.add('visivel');
    if (!email) emailInput.classList.add('erro');
    if (!senha) senhaInput.classList.add('erro');
    return;
  }

  if (!emailInput.checkValidity() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    erroEl.textContent = 'Informe um e-mail válido.';
    erroEl.classList.add('visivel');
    emailInput.classList.add('erro');
    emailInput.focus();
    return;
  }

  // Mostrar loading no botão
  btnLogin.classList.add('carregando');
  btnLogin.disabled = true;

  try {
    await login(email, senha);
    // onAuthStateChanged vai acionar mostrarAppConteudo automaticamente
  } catch (err) {
    let msg = 'Erro ao entrar. Tente novamente.';
    if (err.code === 'auth/invalid-credential' ||
        err.code === 'auth/wrong-password' ||
        err.code === 'auth/user-not-found') {
      msg = 'E-mail ou senha incorretos.';
    } else if (err.code === 'auth/too-many-requests') {
      msg = 'Muitas tentativas. Aguarde alguns minutos.';
    } else if (err.code === 'auth/invalid-email') {
      msg = 'E-mail inválido.';
    } else if (err.code === 'auth/network-request-failed') {
      msg = 'Sem conexão. Verifique sua internet.';
    }
    erroEl.textContent = msg;
    erroEl.classList.add('visivel');
    emailInput.classList.add('erro');
    senhaInput.classList.add('erro');
  } finally {
    btnLogin.classList.remove('carregando');
    btnLogin.disabled = false;
  }
}

// ===== LOGOUT =====
async function handleLogout() {
  try {
    // Limpar dados em memória antes de sair
    agendamentos = [];
    funcionarios = [];
    relatorios   = [];
    window.agendamentos = [];
    window.funcionarios = [];
    window.relatorios = [];
    window.insumos = [];
    window.obras = [];
    window._orcamentosFirestore = [];
    await logout();
    mostrarToast('Sessão encerrada.', '');
  } catch {
    mostrarToast('Erro ao sair.', 'erro');
  }
}

// ===== CARREGAR DADOS INICIAIS DO FIRESTORE =====
async function carregarDadosIniciais() {
  mostrarToast('Carregando dados...', '');
  try {
    [agendamentos, funcionarios, relatorios] = await Promise.all([
      DB.listarAgendamentos(),
      DB.listarFuncionarios(),
      DB.listarRelatorios()
    ]);

    // Carregar insumos e obras
    const [insumosData, obrasData] = await Promise.all([
      DB.listarInsumos(),
      DB.listarObras()
    ]);
    window.insumos = insumosData;
    window.obras   = obrasData;
    window.agendamentos = agendamentos;
    window.funcionarios = funcionarios;
    window.relatorios   = relatorios;

    // Carregar histórico de orçamentos
    const orcamentos = await DB.listarOrcamentos();
    window._orcamentosFirestore = orcamentos;

    window.recarregarOpcoesEditaveisUsuario?.();

    // Carregar perfil/logotipo do Firestore
    const perfil = await DB.carregarPerfilUsuario();
    await DB.salvarMetadadosUsuario?.(auth.currentUser);
    if (window.aplicarConfiguracoesEmpresa) {
      window.aplicarConfiguracoesEmpresa(perfil || {});
    }
    window.aplicarPermissoesUsuario?.(perfil || {}, auth.currentUser || {});
    await window.carregarLogoSalva?.(perfil || {});

    mostrarToast('', '');
  } catch (err) {
    console.error('Erro ao carregar dados:', err);
    mostrarToast('Erro ao carregar dados do servidor.', 'erro');
  }
}

// ===== INICIALIZAR AUTH =====
function initAuthController() {
  // Loading inicial — aguarda Firebase resolver o estado
  document.getElementById('app-loading').classList.remove('oculto');

  initAuth(
    // Callback: usuário logado
    async (user) => {
      mostrarAppConteudo(user);
      await carregarDadosIniciais();
      // Re-renderizar telas após carregar dados
      renderizarHistorico();
      renderizarCalendario();
      popularSelectFuncionariosRel();
      atualizarNumeroDisplay();
      if (window.inicializarFluxoFinanceiro) window.inicializarFluxoFinanceiro();
      window.renderizarInicio?.();
    },
    // Callback: usuário deslogado
    () => {
      mostrarTelaLogin();
    }
  );

  // Eventos do formulário de login
  document.getElementById('btn-login').addEventListener('click', handleLogin);
  document.getElementById('login-senha').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') handleLogin();
  });
  document.getElementById('login-email').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') document.getElementById('login-senha').focus();
  });

  // Botão de logout na nav
  document.getElementById('btn-logout').addEventListener('click', () => {
    handleLogout();
  });
}

// Inicializa quando o DOM estiver pronto
document.addEventListener('DOMContentLoaded', initAuthController);
