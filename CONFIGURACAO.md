# 🔥 Guia de Configuração — Firebase + Confidere

## Estrutura de arquivos

```
confidere/
├── index.html              ← HTML principal (atualizado)
├── firestore.rules         ← Regras de segurança do Firestore
├── CONFIGURACAO.md         ← Este guia
└── src/
    ├── firebase.js         ← Config Firebase + camada de banco de dados
    ├── auth.js             ← Controlador de login/logout
    ├── auth.css            ← Estilos da tela de login
    ├── script.js           ← Orçamentos (usa Firestore)
    ├── gestao.js           ← Gestão de equipe (usa Firestore)
    ├── style.css           ← Estilos originais (não modificado)
    └── gestao.css          ← Estilos de gestão (não modificado)
```

---

## Passo 1 — Criar projeto Firebase

1. Acesse https://console.firebase.google.com
2. Clique em **"Adicionar projeto"**
3. Dê um nome (ex: `confidere-prod`)
4. Desative o Google Analytics (opcional) → **Criar projeto**

---

## Passo 2 — Ativar Authentication

1. No painel do projeto, vá em **Build → Authentication**
2. Clique **"Começar"**
3. Na aba **"Sign-in method"**, ative **"E-mail/senha"**
4. Salve

### Criar usuários (NUNCA via app — só pelo Console)

1. Ainda em Authentication, aba **"Users"**
2. Clique **"Adicionar usuário"**
3. Preencha e-mail e senha
4. Repita para cada usuário autorizado

> ⚠️ **Segurança:** A criação de contas só é possível pelo Console Firebase.
> O app não possui nenhum formulário de cadastro — qualquer tentativa de
> acesso com credenciais inválidas é bloqueada pelo Firebase.

---

## Passo 3 — Ativar Firestore

1. Vá em **Build → Firestore Database**
2. Clique **"Criar banco de dados"**
3. Escolha **"Iniciar no modo de produção"** ← importante!
4. Selecione a região mais próxima (ex: `southamerica-east1` — São Paulo)
5. Clique **"Ativar"**

---

## Passo 4 — Publicar as regras de segurança

1. Ainda no Firestore, clique na aba **"Regras"**
2. Apague o conteúdo existente
3. Cole o conteúdo do arquivo `firestore.rules`:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{userId} {
      allow read, write: if request.auth != null
                         && request.auth.uid == userId;
      match /{collection}/{docId} {
        allow read, write: if request.auth != null
                           && request.auth.uid == userId;
      }
    }
    match /{document=**} {
      allow read, write: if false;
    }
  }
}
```

4. Clique **"Publicar"**

> ✅ Estas regras garantem que cada usuário só acessa **seus próprios dados**.
> Nenhum usuário pode ver orçamentos, funcionários ou relatórios de outro.

---

## Passo 5 — Obter credenciais e configurar o app

1. No Console Firebase, clique na **engrenagem ⚙️ → Configurações do projeto**
2. Role até **"Seus aplicativos"** → clique no ícone **`</>`** (Web)
3. Registre o app com um apelido (ex: "confidere-web")
4. **Não** marque Firebase Hosting por enquanto
5. Copie o objeto `firebaseConfig` que aparece

6. Abra o arquivo `src/firebase.js` e substitua o bloco no topo:

```javascript
const FIREBASE_CONFIG = {
  apiKey: "AIzaSy...",           // ← sua apiKey real
  authDomain: "confidere-prod.firebaseapp.com",
  projectId: "confidere-prod",
  storageBucket: "confidere-prod.appspot.com",
  messagingSenderId: "123456789",
  appId: "1:123456789:web:abc123"
};
```

---

## Passo 6 — Testar localmente

O app usa **ES Modules**, que requerem servidor HTTP (não funciona abrindo
`index.html` diretamente no navegador por causa de CORS).

**Opção A — VS Code (recomendado):**
- Instale a extensão **"Live Server"**
- Clique com botão direito em `index.html` → **"Open with Live Server"**

**Opção B — Python (qualquer sistema):**
```bash
# Na pasta raiz do projeto:
python -m http.server 8080
# Acesse: http://localhost:8080
```

**Opção C — Node.js:**
```bash
npx serve .
```

---

## Passo 7 — (Opcional) Deploy com Firebase Hosting

```bash
npm install -g firebase-tools
firebase login
firebase init hosting
# public directory: . (ponto)
# single page app: não
firebase deploy
```

Seu app ficará disponível em `https://SEU-PROJETO.web.app`

---

## Estrutura do banco de dados

```
Firestore
└── users/
    └── {uid}/                    ← 1 nó por usuário logado
        ├── logo: "data:image/..."  ← campo no doc raiz
        ├── orcamentos/
        │   └── {id}/  { cliente, obra, linhas, total, ... }
        ├── funcionarios/
        │   └── {id}/  { nome, admissao, salario, ... }
        ├── agendamentos/
        │   └── {id}/  { cliente, data, local, obs, ... }
        └── relatorios/
            └── {id}/  { obra, data, funcionarioId, rendimento, ... }
```

---

## Segurança — Resumo

| Camada | Proteção |
|---|---|
| **Firebase Auth** | Só usuários cadastrados pelo admin podem logar |
| **Firestore Rules** | Cada usuário acessa apenas `/users/{seuUid}/...` |
| **Front-end** | Todo conteúdo fica oculto até autenticação completa |
| **Sem cadastro público** | Não há formulário de criação de conta no app |
| **Token automático** | Firebase gerencia tokens JWT com expiração automática |

---

## Migração de dados do localStorage

Se houver dados antigos no `localStorage`, execute no console do navegador
**antes** de fazer login com a nova versão:

```javascript
// Exportar dados do localStorage para JSON
const dados = {
  orcamentos: JSON.parse(localStorage.getItem('confidere_historico') || '[]'),
  funcionarios: JSON.parse(localStorage.getItem('confidere_funcionarios') || '[]'),
  agendamentos: JSON.parse(localStorage.getItem('confidere_agendamentos') || '[]'),
  relatorios: JSON.parse(localStorage.getItem('confidere_relatorios') || '[]'),
};
console.log(JSON.stringify(dados));
// Copie o JSON e guarde — você poderá importar manualmente pelo Console Firebase
```
