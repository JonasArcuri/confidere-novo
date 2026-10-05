import { auth } from './firebase.js';

const LOCAL = 'http://127.0.0.1:17843';
const root = document.createElement('aside');
root.className = 'obraflux-assistente';
root.hidden = true;
root.innerHTML = `
  <section class="obraflux-painel" id="obraflux-painel" hidden aria-label="Assistente Obraflux">
    <header><strong>Obraflux</strong><button type="button" id="obraflux-fechar" aria-label="Fechar painel">×</button></header>
    <div class="obraflux-corpo">
      <p>Seu assistente por voz. Diga <strong>“Obraflux”</strong> e peça um orçamento.</p>
      <p class="obraflux-status" role="status" aria-live="polite">Conecte o assistente local para começar.</p>
      <div class="obraflux-acoes"><button type="button" id="obraflux-iniciar">Ativar microfone</button><button type="button" id="obraflux-parar" class="obraflux-pausar" disabled>Pausar</button></div>
      <div class="obraflux-historico" aria-live="polite" aria-label="Conversa"></div>
      <div class="obraflux-resumo" hidden></div>
      <div class="obraflux-acoes"><button type="button" id="obraflux-abrir" hidden>Abrir orçamento salvo</button></div>
      <details id="obraflux-conexao"><summary>Conectar assistente local</summary>
        <p>Inicie o assistente neste computador e cole o código de conexão exibido por ele. A voz e a IA são processadas no computador; os orçamentos continuam no Firebase.</p>
        <label>Código de conexão<input id="obraflux-token" type="password" autocomplete="off" spellcheck="false" placeholder="Código do assistente local"></label>
        <p>O microfone permanece ativo até você pausar ou sair do sistema. A aba precisa permanecer aberta e ativa.</p>
      </details>
    </div>
  </section>
  <button type="button" class="obraflux-botao" aria-label="Abrir assistente Obraflux" aria-controls="obraflux-painel" aria-expanded="false" title="Obraflux — assistente por voz">
    <img src="landing-obraflux/assets/obraflux-somentelogo-crop.png" alt="">
  </button>`;
document.body.append(root);
const $ = selector => root.querySelector(selector);
const painel = $('.obraflux-painel');
let socket, stream, context, source, worklet, ligado = false, iniciando = false, recebendo = false, geracao = 0, ultimoSalvo, epoch = 0;
const estados = { waiting: 'Microfone ativo. Diga “Obraflux”.', listening: 'Estou ouvindo. Fale sua instrução e faça uma pausa.',
    transcribing: 'Reconhecendo sua fala neste computador…', thinking: 'Montando o orçamento neste computador…', speaking: 'Obraflux está falando…', saving: 'Salvando no Firebase…' };
const status = texto => { $('.obraflux-status').textContent = texto; };
function abrirPainel() { painel.hidden = false; $('.obraflux-botao').setAttribute('aria-expanded', 'true'); }
function mensagem(autor, texto) {
    const p = document.createElement('p');
    p.textContent = `${autor}: ${texto}`;
    const historico = $('.obraflux-historico');
    historico.append(p);
    while (historico.children.length > 20) historico.firstChild.remove();
    historico.scrollTop = historico.scrollHeight;
}
function enviar(dados) { if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(dados)); }
function pausar(texto = 'Microfone pausado.') {
    geracao++;
    ligado = iniciando = recebendo = false;
    root.dataset.ouvindo = 'false';
    stream?.getTracks().forEach(track => track.stop());
    source?.disconnect(); worklet?.disconnect();
    context?.close().catch(() => {});
    if (socket) { socket.onclose = null; socket.close(); }
    socket = stream = context = source = worklet = undefined;
    $('#obraflux-iniciar').disabled = false;
    $('#obraflux-parar').disabled = true;
    status(texto);
}
async function iniciar() {
    if (ligado || iniciando || !window.obrafluxOrcamentos?.permitido() || !auth.currentUser) return;
    const token = $('#obraflux-token').value.trim();
    if (!token) { $('#obraflux-conexao').open = true; $('#obraflux-token').focus(); status('Informe o código do assistente local.'); return; }
    if (!navigator.mediaDevices?.getUserMedia || !window.AudioWorkletNode) { status('Abra o Obra Flux em HTTPS no Chrome ou Edge deste computador.'); return; }
    const usuario = auth.currentUser.uid;
    const atual = ++geracao;
    iniciando = true;
    $('#obraflux-iniciar').disabled = true;
    status('Conectando ao assistente local…');
    try {
        const resposta = await fetch(`${LOCAL}/health`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(6000) });
        if (!resposta.ok) throw new Error(resposta.status === 401 ? 'Código de conexão inválido.' : 'Assistente local indisponível.');
        const saude = await resposta.json();
        if (!saude.ready) throw new Error(saude.message || 'Prepare os modelos locais antes de ativar.');
        if (geracao !== atual) return;
        const captura = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
        if (geracao !== atual) { captura.getTracks().forEach(track => track.stop()); return; }
        stream = captura;
        stream.getAudioTracks()[0].addEventListener('ended', () => { if (geracao === atual) pausar('Microfone desconectado.'); });
        context = new AudioContext({ sampleRate: 16000 });
        await context.audioWorklet.addModule(new URL('./obraflux-audio-worklet.js', import.meta.url));
        if (geracao !== atual) return;
        const ws = new WebSocket('ws://127.0.0.1:17843/voice');
        socket = ws;
        await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => { ws.close(); reject(new Error('O assistente local não respondeu.')); }, 6000);
            ws.onopen = () => { clearTimeout(timeout); resolve(); };
            ws.onerror = () => { clearTimeout(timeout); reject(new Error('Não foi possível conectar ao assistente local.')); };
        });
        if (geracao !== atual) { ws.close(); return; }
        ws.onclose = () => { if (geracao === atual) pausar('Conexão encerrada. Ative novamente para continuar.'); };
        ws.onerror = () => { if (geracao === atual) pausar('Falha na conexão com o assistente local.'); };
        ws.onmessage = async event => {
            if (geracao !== atual || auth.currentUser?.uid !== usuario) return;
            let dados;
            try { dados = JSON.parse(event.data); } catch { return; }
            if (dados.type === 'state') {
                epoch = dados.epoch;
                recebendo = ['waiting', 'listening'].includes(dados.state);
                status(estados[dados.state] || 'Assistente conectado.');
            } else if (dados.type === 'transcript') { abrirPainel(); mensagem('Você', dados.text); }
            else if (dados.type === 'message') { abrirPainel(); mensagem('Obraflux', dados.text); }
            else if (dados.type === 'preview') {
                try {
                    const orcamento = window.obrafluxOrcamentos.preparar(dados.budget);
                    const resumo = $('.obraflux-resumo');
                    resumo.hidden = false;
                    resumo.textContent = `${orcamento.cliente}\n${orcamento.linhas.map(l => `${l.desc}: ${l.area} ${l.areaLabel}`).join('\n')}\nTotal: ${orcamento.totalComDesconto.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}\n${dados.saved ? 'Salvo no Firebase.' : 'Diga “salvar” ou fale uma correção.'}`;
                } catch (erro) { enviar({ type: 'invalid_budget', message: erro.message }); }
            } else if (dados.type === 'save') {
                recebendo = false;
                status(estados.saving);
                try {
                    const salvo = await window.obrafluxOrcamentos.salvar(dados.budget, dados.requestId, usuario);
                    if (geracao !== atual || auth.currentUser?.uid !== usuario) return;
                    ultimoSalvo = salvo.id;
                    $('#obraflux-abrir').hidden = false;
                    enviar({ type: 'save_result', requestId: dados.requestId, ok: true, numero: salvo.numero, total: salvo.total });
                } catch (erro) { if (geracao === atual) enviar({ type: 'save_result', requestId: dados.requestId, ok: false, message: erro.message }); }
            } else if (dados.type === 'paused') { pausar(); }
            else if (dados.type === 'error') { mensagem('Obraflux', dados.message); status(dados.message); }
        };
        enviar({ type: 'auth', token, sampleRate: context.sampleRate });
        source = context.createMediaStreamSource(stream);
        worklet = new AudioWorkletNode(context, 'obraflux-audio');
        worklet.port.onmessage = event => {
            if (recebendo && geracao === atual && ws.readyState === WebSocket.OPEN) {
                if (ws.bufferedAmount > 256000) { pausar('Conexão local lenta. Ative novamente.'); return; }
                const pacote = new Uint8Array(4 + event.data.byteLength);
                new DataView(pacote.buffer).setUint32(0, epoch, true);
                pacote.set(new Uint8Array(event.data), 4);
                ws.send(pacote.buffer);
            }
        };
        source.connect(worklet); worklet.connect(context.destination);
        await context.resume();
        ligado = true;
        iniciando = false;
        root.dataset.ouvindo = 'true';
        $('#obraflux-parar').disabled = false;
    } catch (erro) {
        if (geracao !== atual) return;
        const texto = erro.name === 'NotAllowedError' ? 'Permita o microfone e o acesso ao assistente local no navegador.' : erro.message;
        pausar(texto === 'Failed to fetch' ? 'Inicie o assistente local e permita o acesso local no navegador.' : texto);
    }
}
$('.obraflux-botao').addEventListener('click', () => { painel.hidden ? abrirPainel() : fechar(); });
function fechar() { painel.hidden = true; $('.obraflux-botao').setAttribute('aria-expanded', 'false'); $('.obraflux-botao').focus(); }
$('#obraflux-fechar').addEventListener('click', fechar);
root.addEventListener('keydown', event => { if (event.key === 'Escape') fechar(); });
$('#obraflux-iniciar').addEventListener('click', iniciar);
$('#obraflux-parar').addEventListener('click', () => pausar());
$('#obraflux-abrir').addEventListener('click', () => { if (ultimoSalvo) window.obrafluxOrcamentos.abrir(ultimoSalvo); });
const sincronizar = () => {
    const permitido = !!window.obrafluxOrcamentos?.permitido() && document.getElementById('app-conteudo')?.classList.contains('visivel');
    root.hidden = !permitido;
    if (!permitido) {
        window.obrafluxOrcamentos?.limparSessao();
        if (ligado || iniciando || stream || socket) pausar('Entre no sistema para usar o assistente.');
        $('#obraflux-token').value = '';
        $('.obraflux-historico').replaceChildren();
        $('.obraflux-resumo').hidden = true;
        $('#obraflux-abrir').hidden = true;
        ultimoSalvo = undefined;
    }
};
new MutationObserver(sincronizar).observe(document.getElementById('app-conteudo'), { attributes: true, attributeFilter: ['class'] });
new MutationObserver(sincronizar).observe(document.body, { attributes: true, attributeFilter: ['class'] });
window.addEventListener('obraflux:permissoes', sincronizar);
window.addEventListener('pagehide', () => pausar());
document.addEventListener('visibilitychange', () => { if (document.hidden && (ligado || stream)) pausar('Microfone pausado porque a aba foi ocultada.'); });
sincronizar();
