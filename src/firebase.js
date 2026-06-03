// ===== FIREBASE CONFIG =====
// Substitua os valores abaixo pelas suas credenciais do Firebase Console
const FIREBASE_CONFIG = {
  apiKey: "AIzaSyCiVtdfc31tlCuXNClbdzbAXQYOX1SDcL0",
  authDomain: "confidere-prod.firebaseapp.com",
  projectId: "confidere-prod",
  storageBucket: "confidere-prod.firebasestorage.app",
  messagingSenderId: "197598419906",
  appId: "1:197598419906:web:7a7173ccd166534d9f545b"
};

// ===== IMPORTAÇÕES (ES Modules via CDN) =====
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getAuth,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
  getFirestore,
  collection,
  doc,
  getDocs,
  addDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import {
  getStorage,
  ref as storageRef,
  uploadBytes,
  getDownloadURL,
  deleteObject
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-storage.js";

// ===== INICIALIZAÇÃO =====
const app = initializeApp(FIREBASE_CONFIG);
const auth = getAuth(app);
const db = getFirestore(app);
const storage = getStorage(app);

const MASTER_ADMIN_EMAIL = 'sanojsistemas@gmail.com';

// ===== ESTADO DO USUÁRIO =====
let currentUser = null;

function isAdminMasterAtual() {
  return !!currentUser && String(currentUser.email || '').toLowerCase() === MASTER_ADMIN_EMAIL;
}

// ===== AUTH: OBSERVER =====
function initAuth(onLogin, onLogout) {
  onAuthStateChanged(auth, (user) => {
    if (user) {
      currentUser = user;
      onLogin(user);
    } else {
      currentUser = null;
      onLogout();
    }
  });
}

// ===== AUTH: LOGIN =====
async function login(email, password) {
  const cred = await signInWithEmailAndPassword(auth, email, password);
  return cred.user;
}

// ===== AUTH: LOGOUT =====
async function logout() {
  await signOut(auth);
}

// ===== HELPER: UID DO USUÁRIO ATUAL =====
function getUid() {
  if (!currentUser) throw new Error("Usuário não autenticado.");
  return currentUser.uid;
}

// ===== HELPER: COLEÇÃO DO USUÁRIO =====
// Todos os dados ficam em /users/{uid}/{collection}
// Isso garante isolamento total por usuário via Firestore Security Rules
function userCol(colName) {
  return collection(db, "users", getUid(), colName);
}

function userDoc(colName, id) {
  return doc(db, "users", getUid(), colName, id);
}

//Sanitizar Objeto, caso algum dado esteja null ou undefined
function sanitizar(obj) {
  return JSON.parse(JSON.stringify(obj, (_, v) => v === undefined ? null : v));
}

function storagePath(prefix, file) {
  const safeName = (file?.name || 'arquivo')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]/g, '_');
  return `users/${getUid()}/${prefix}/${Date.now()}_${safeName}`;
}

async function uploadArquivo(file, prefix) {
  const path = storagePath(prefix, file);
  const ref = storageRef(storage, path);
  await uploadBytes(ref, file, { contentType: file.type || 'application/octet-stream' });
  const url = await getDownloadURL(ref);
  return { url, path };
}

async function removerArquivoSeExistir(path) {
  if (!path) return;
  try {
    await deleteObject(storageRef(storage, path));
  } catch {
    // Arquivos antigos podem ja ter sido removidos ou estar em formato legado base64.
  }
}

// ===== ORÇAMENTOS =====
const DB = {
  // — Orçamentos —
  async listarOrcamentos() {
    const q = query(userCol("orcamentos"), orderBy("criadoEm", "desc"));
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  },


  async salvarOrcamento(dados, id = null) {
    const dadosLimpos = sanitizar(dados);
    if (id) {
      await setDoc(userDoc("orcamentos", id), { ...dadosLimpos, atualizadoEm: serverTimestamp() }, { merge: true });
      return id;
    } else {
      const ref = await addDoc(userCol("orcamentos"), { ...dadosLimpos, criadoEm: serverTimestamp() });
      return ref.id;
    }
  },

  async excluirOrcamento(id) {
    await deleteDoc(userDoc("orcamentos", id));
  },

  // — Funcionários —
  async listarFuncionarios() {
    const snap = await getDocs(query(userCol("funcionarios"), orderBy("nome")));
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  },

  async salvarFuncionario(dados, id = null) {
    if (id) {
      await setDoc(userDoc("funcionarios", id), { ...dados, atualizadoEm: serverTimestamp() }, { merge: true });
      return id;
    } else {
      const ref = await addDoc(userCol("funcionarios"), { ...dados, criadoEm: serverTimestamp() });
      return ref.id;
    }
  },

  async excluirFuncionario(id) {
    await deleteDoc(userDoc("funcionarios", id));
  },

  // — Agendamentos —
  async listarAgendamentos() {
    const snap = await getDocs(query(userCol("agendamentos"), orderBy("data")));
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  },

  async salvarAgendamento(dados, id = null) {
    if (id) {
      await setDoc(userDoc("agendamentos", id), { ...dados, atualizadoEm: serverTimestamp() }, { merge: true });
      return id;
    } else {
      const ref = await addDoc(userCol("agendamentos"), { ...dados, criadoEm: serverTimestamp() });
      return ref.id;
    }
  },

  async excluirAgendamento(id) {
    await deleteDoc(userDoc("agendamentos", id));
  },

  // — Relatórios —
  async listarRelatorios() {
    const snap = await getDocs(query(userCol("relatorios"), orderBy("data", "desc")));
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  },

  async salvarRelatorio(dados, id = null) {
    if (id) {
      await setDoc(userDoc("relatorios", id), { ...dados, atualizadoEm: serverTimestamp() }, { merge: true });
      return id;
    } else {
      const ref = await addDoc(userCol("relatorios"), { ...dados, criadoEm: serverTimestamp() });
      return ref.id;
    }
  },

  async excluirRelatorio(id) {
    await deleteDoc(userDoc("relatorios", id));
  },

  // — Logo —
  async salvarLogoArquivo(file) {
    const atual = await this.carregarPerfilUsuario();
    const uploaded = await uploadArquivo(file, "logos");
    await setDoc(doc(db, "users", getUid()), {
      logoUrl: uploaded.url,
      logoPath: uploaded.path,
      logo: null
    }, { merge: true });
    await removerArquivoSeExistir(atual?.logoPath);
    return uploaded.url;
  },

  async salvarLogoFallback(dataUrl) {
    await setDoc(doc(db, "users", getUid()), {
      logoFallback: dataUrl || ''
    }, { merge: true });
  },

  async carregarLogo() {
    const data = await this.carregarPerfilUsuario();
    if (data?.logoUrl || data?.logo || data?.logoFallback) return data.logoUrl || data.logo || data.logoFallback;
    if (data?.logoPath) return await getDownloadURL(storageRef(storage, data.logoPath));
    return null;
  },

  async carregarPerfilUsuario() {
    const { getDoc } = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js");
    const snap = await getDoc(doc(db, "users", getUid()));
    return snap.exists() ? snap.data() : null;
  },

  async salvarMetadadosUsuario(user) {
    if (!user) return;
    await setDoc(doc(db, "users", getUid()), {
      email: user.email || '',
      ultimoLoginEm: serverTimestamp()
    }, { merge: true });
  },

  async salvarConfiguracoesEmpresa(config) {
    await setDoc(doc(db, "users", getUid()), {
      empresaNome: config.empresaNome || '',
      empresaLocal: config.empresaLocal || '',
      empresaContato: config.empresaContato || '',
      empresaContatoWhatsapp: !!config.empresaContatoWhatsapp,
      empresaGestor: config.empresaGestor || '',
      empresaUrl: config.empresaUrl || ''
    }, { merge: true });
  },

  async removerLogo() {
    const { updateDoc, deleteField } = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js");
    const atual = await this.carregarPerfilUsuario();
    await updateDoc(doc(db, "users", getUid()), {
      logo: deleteField(),
      logoUrl: deleteField(),
      logoPath: deleteField(),
      logoFallback: deleteField()
    });
    await removerArquivoSeExistir(atual?.logoPath);
  },

  async salvarFotoInsumoArquivo(file) {
    const uploaded = await uploadArquivo(file, "insumos");
    return uploaded.url;
  },

  async salvarImagemOrcamentoArquivo(file) {
    return await uploadArquivo(file, "orcamentos-imagens");
  },

  async obterUrlArquivo(path) {
    if (!path) return '';
    return await getDownloadURL(storageRef(storage, path));
  },

  // — Insumos / Despesas —
  async listarInsumos() {
    const snap = await getDocs(query(userCol("insumos"), orderBy("data", "desc")));
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  },

  async salvarInsumo(dados, id = null) {
    if (id) {
      await setDoc(userDoc("insumos", id), { ...dados, atualizadoEm: serverTimestamp() }, { merge: true });
      return id;
    } else {
      const ref = await addDoc(userCol("insumos"), { ...dados, criadoEm: serverTimestamp() });
      return ref.id;
    }
  },

  async excluirInsumo(id) {
    await deleteDoc(userDoc("insumos", id));
  },

  // — Obras —
  async listarObras() {
    const snap = await getDocs(query(userCol("obras"), orderBy("data", "desc")));
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  },

  async salvarObra(dados, id = null) {
    if (id) {
      await setDoc(userDoc("obras", id), { ...dados, atualizadoEm: serverTimestamp() }, { merge: true });
      return id;
    } else {
      const ref = await addDoc(userCol("obras"), { ...dados, criadoEm: serverTimestamp() });
      return ref.id;
    }
  },

  async excluirObra(id) {
    await deleteDoc(userDoc("obras", id));
  },

  // — Administração Master —
  async listarUsuariosAdmin() {
    if (!isAdminMasterAtual()) throw new Error('Acesso restrito ao administrador master.');
    const snap = await getDocs(collection(db, "users"));
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  },

  async salvarPermissoesUsuarioAdmin(userId, dados) {
    if (!isAdminMasterAtual()) throw new Error('Acesso restrito ao administrador master.');
    await setDoc(doc(db, "users", userId), {
      plano: dados.plano || 'essencial',
      planoInicio: dados.planoInicio || '',
      planoFim: dados.planoFim || '',
      modulosLiberados: Array.isArray(dados.modulosLiberados) ? dados.modulosLiberados : [],
      bloqueado: !!dados.bloqueado,
      observacaoAdmin: dados.observacaoAdmin || '',
      permissoesAtualizadasEm: serverTimestamp()
    }, { merge: true });
  }
};

export { auth, db, currentUser, initAuth, login, logout, getUid, isAdminMasterAtual, MASTER_ADMIN_EMAIL, DB };
