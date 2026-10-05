"""Obraflux local: Whisper + Ollama + voz Windows. Orçamentos só existem na RAM."""
import asyncio
import concurrent.futures
import json
import os
from pathlib import Path
import secrets
import time
import uuid

import httpx
import numpy as np
from fastapi import FastAPI, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import ValidationError

from contracts import Budget, Decision, SYSTEM_PROMPT, ativacao, autoriza_salvar, comando_salvar, comando_cancelar, normalizar, schema_ollama, validar_fidelidade

BASE = Path(__file__).resolve().parent
CONFIG_PATH = BASE / '.config.json'
CONFIG = json.loads(CONFIG_PATH.read_text('utf-8')) if CONFIG_PATH.exists() else {}
ORIGINS = CONFIG.get('origins', ['http://localhost:8000', 'http://127.0.0.1:8000', 'http://localhost:4173', 'http://127.0.0.1:4173', 'https://confidere-prod.web.app', 'https://confidere-prod.firebaseapp.com', 'https://confidere-novo.vercel.app'])
MODEL_NAME = CONFIG.get('model', 'qwen2.5:7b')
WHISPER_PATH = BASE / 'models' / 'whisper-small'
TOKEN_PATH = BASE / '.pairing-token'
if not TOKEN_PATH.exists():
    TOKEN_PATH.write_text(secrets.token_urlsafe(32), encoding='utf-8')
TOKEN = TOKEN_PATH.read_text('utf-8').strip()
OLLAMA = 'http://127.0.0.1:11434'

app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
app.add_middleware(CORSMiddleware, allow_origins=ORIGINS, allow_methods=['GET'], allow_headers=['Authorization'], allow_private_network=True)
whisper = None
whisper_lock = asyncio.Lock()
voice_executor = concurrent.futures.ThreadPoolExecutor(max_workers=1)
active_session = False


@app.middleware('http')
async def proteger(request: Request, call_next):
    # Host explícito para impedir DNS rebinding; origem exata, sem wildcard.
    if request.headers.get('host') not in ('127.0.0.1:17843', 'localhost:17843'):
        from fastapi.responses import JSONResponse
        return JSONResponse({'message': 'Host não autorizado.'}, status_code=403)
    return await call_next(request)


async def modelo_local() -> bool:
    # Recusa modelos cloud, inclusive aliases para modelos remotos.
    async with httpx.AsyncClient(timeout=5, trust_env=False) as client:
        response = await client.post(f'{OLLAMA}/api/show', json={'model': MODEL_NAME})
        response.raise_for_status()
        info = response.json()
        return not (info.get('remote_host') or info.get('remote_model') or ':cloud' in MODEL_NAME)


@app.get('/health')
async def health(request: Request):
    origem = request.headers.get('origin')
    if origem and origem not in ORIGINS:
        raise HTTPException(403, 'Origem não autorizada.')
    if not secrets.compare_digest(request.headers.get('authorization', ''), f'Bearer {TOKEN}'):
        raise HTTPException(401, 'Código inválido.')
    ready = WHISPER_PATH.joinpath('model.bin').exists()
    message = '' if ready else 'Execute configurar.ps1 para baixar o reconhecedor de voz local.'
    if ready:
        try:
            ready = await modelo_local()
            if not ready: message = 'Escolha um modelo Ollama local. Modelos de nuvem não são permitidos.'
        except (httpx.HTTPError, ValueError):
            ready = False
            message = 'Inicie o Ollama e baixe o modelo configurado com ollama pull.'
    return {'ready': ready, 'message': message, 'name': 'Obraflux'}


def transcrever(audio: np.ndarray, confirmacao=False) -> str:
    global whisper
    if whisper is None:
        from faster_whisper import WhisperModel
        whisper = WhisperModel(str(WHISPER_PATH), device='cpu', compute_type='int8', cpu_threads=4, local_files_only=True)
    contexto = 'Obraflux. Salvar. Pode salvar o orçamento. Cancelar. Corrigir o orçamento.' if confirmacao else 'Obraflux. Orçamento de obra, cliente, metros quadrados, materiais e mão de obra.'
    segments, _ = whisper.transcribe(audio, language='pt', beam_size=3, vad_filter=True,
        initial_prompt=contexto, condition_on_previous_text=False)
    return ' '.join(s.text.strip() for s in segments if s.no_speech_prob < 0.65).strip()


def falar_local(texto: str):
    import pyttsx3
    engine = pyttsx3.init()
    try:
        for voice in engine.getProperty('voices'):
            dados = f'{voice.id} {voice.name} {voice.languages}'.lower()
            if any(nome in dados for nome in ('portugu', 'brazil', 'pt-br', '0416')):
                engine.setProperty('voice', voice.id)
                break
        engine.setProperty('rate', 175)
        engine.say(texto)
        engine.runAndWait()
    finally:
        engine.stop()


class VoiceSession:
    def __init__(self, socket, sample_rate):
        self.socket = socket
        self.sample_rate = sample_rate
        self.epoch = 0
        self.active_until = 0
        self.frames = []
        self.pre_roll = np.array([], dtype=np.float32)
        self.silence = 0
        self.duration = 0
        self.pending = None
        self.request_id = None
        self.saving = False
        self.history = []
        self.save_authorized = False

    async def send(self, **data):
        await self.socket.send_json(data)

    async def state(self, state):
        if state in ('waiting', 'listening'):
            self.epoch += 1
            self.frames = []
            self.duration = self.silence = 0
            self.pre_roll = np.array([], dtype=np.float32)
        await self.send(type='state', state=state, epoch=self.epoch)

    async def say(self, text):
        await self.send(type='message', text=text)
        await self.state('speaking')
        try:
            await asyncio.get_running_loop().run_in_executor(voice_executor, falar_local, text)
        except Exception:
            await self.send(type='error', message='A voz do Windows está indisponível. A resposta aparece no painel.')
        # Cauda acústica da voz; o cliente não envia áudio enquanto falamos.
        await asyncio.sleep(0.35)

    async def listen(self):
        self.active_until = time.monotonic() + 90
        await self.state('listening')

    async def save(self):
        if not self.pending or self.saving:
            return
        self.saving = True
        await self.state('saving')
        await self.send(type='save', budget=self.pending.model_dump(), requestId=self.request_id)

    async def command(self, text):
        if normalizar(text).strip(' .!') in ('pausar', 'pausa', 'parar', 'pare'):
            await self.say('Microfone pausado.')
            await self.send(type='paused')
            return
        if comando_cancelar(text):
            self.pending = None
            self.request_id = None
            self.history = []
            self.save_authorized = False
            await self.say('Pedido cancelado. Diga Obraflux para começar outro orçamento.')
            self.active_until = 0
            await self.state('waiting')
            return
        if self.pending and comando_salvar(text):
            await self.save()
            return
        # "Não salve" revoga a autorização acumulada; correções exigem nova ordem.
        self.save_authorized = autoriza_salvar(text)
        self.request_id = None
        await self.state('thinking')
        self.history.append({'role': 'user', 'content': text})
        if len(self.history) > 24:
            await self.say('Este pedido ficou muito longo. Cancele e comece um novo orçamento.')
            await self.listen()
            return
        try:
            if not await modelo_local():
                raise ValueError('Modelo de nuvem bloqueado.')
            async with httpx.AsyncClient(timeout=180, trust_env=False) as client:
                response = await client.post(f'{OLLAMA}/api/chat', json={'model': MODEL_NAME,
                    'messages': [{'role': 'system', 'content': SYSTEM_PROMPT}] + self.history,
                    'format': schema_ollama(), 'stream': False, 'options': {'temperature': 0, 'num_ctx': 8192, 'num_predict': 1800}})
                response.raise_for_status()
                result = Decision.model_validate_json(response.json()['message']['content'])
            if result.acao == 'orcamento' and result.orcamento is None:
                raise ValueError('Orçamento ausente.')
            if result.acao == 'orcamento':
                validar_fidelidade(result.orcamento, '\n'.join(m['content'] for m in self.history if m['role'] == 'user'), text)
            self.history.append({'role': 'assistant', 'content': result.model_dump_json()})
            self.pending = result.orcamento if result.acao == 'orcamento' else None
            if self.pending:
                self.request_id = str(uuid.uuid4())
                await self.send(type='preview', budget=self.pending.model_dump(), saved=False)
                if self.save_authorized:
                    await self.save()
                    return
                await self.say(f'{result.mensagem} Diga salvar para gravar, ou fale uma correção.')
            else:
                await self.say(result.mensagem)
        except (httpx.HTTPError, ValidationError, ValueError, KeyError):
            self.pending = None
            self.save_authorized = False
            await self.say('Não consegui montar um orçamento válido. Verifique o Ollama e repita sua instrução.')
        await self.listen()

    async def audio(self, packet):
        if len(packet) < 8 or len(packet) > 65540 or (len(packet) - 4) % 4:
            return
        epoch = int.from_bytes(packet[:4], 'little')
        if epoch != self.epoch or self.saving:
            return
        samples = np.frombuffer(packet[4:], dtype='<f4')
        if not np.isfinite(samples).all() or np.max(np.abs(samples)) > 1.1:
            return
        if self.sample_rate != 16000:
            tamanho = round(len(samples) * 16000 / self.sample_rate)
            samples = np.interp(np.arange(tamanho) * self.sample_rate / 16000, np.arange(len(samples)), samples).astype(np.float32)
        duration = len(samples) / 16000
        voice = float(np.sqrt(np.mean(samples ** 2))) > float(CONFIG.get('voiceThreshold', 0.012))
        if not self.frames:
            if not voice:
                self.pre_roll = np.concatenate((self.pre_roll, samples))[-4800:]
                if self.active_until and time.monotonic() > self.active_until:
                    self.active_until = 0
                    await self.state('waiting')
                return
            self.frames.append(self.pre_roll)
            self.pre_roll = np.array([], dtype=np.float32)
        self.frames.append(samples)
        self.duration += duration
        self.silence = 0 if voice else self.silence + duration
        if self.duration > 60:
            await self.say('Fale instruções de até um minuto. Repita em partes menores.')
            await self.listen()
            return
        if self.silence < 1.4 or self.duration < 0.5:
            return
        audio = np.concatenate(self.frames)
        await self.state('transcribing')
        async with whisper_lock:
            text = await asyncio.to_thread(transcrever, audio, self.pending is not None)
        self.frames = []
        self.duration = self.silence = 0
        wake = ativacao(text)
        if wake is not None:
            self.active_until = time.monotonic() + 90
            if not wake:
                await self.say('Estou ouvindo. Qual orçamento vamos montar?')
                await self.listen()
                return
            text = wake
        elif time.monotonic() > self.active_until:
            await self.state('waiting')
            return
        if text:
            await self.send(type='transcript', text=text)
            await self.command(text)
        else:
            await self.state('listening' if time.monotonic() < self.active_until else 'waiting')

    async def control(self, message):
        if message.get('type') == 'save_result' and self.saving and message.get('requestId') == self.request_id:
            self.saving = False
            if message.get('ok') is True:
                await self.send(type='preview', budget=self.pending.model_dump(), saved=True)
                await self.say(f'Orçamento número {int(message["numero"])} salvo no Firebase. Você pode abrir pelo painel.')
                self.pending = None
                self.request_id = None
                self.history = []
                self.save_authorized = False
                self.active_until = 0
                await self.state('waiting')
            else:
                await self.say('Não foi possível confirmar o salvamento. Diga salvar para tentar novamente com o mesmo identificador.')
                await self.listen()
        elif message.get('type') == 'invalid_budget':
            self.pending = None
            self.saving = False
            await self.say('Há dados inválidos no orçamento. Vamos corrigir antes de salvar.')
            await self.listen()


@app.websocket('/voice')
async def voice(socket: WebSocket):
    global active_session
    if socket.headers.get('origin') not in ORIGINS or socket.headers.get('host') not in ('127.0.0.1:17843', 'localhost:17843'):
        await socket.close(code=1008)
        return
    await socket.accept()
    acquired = False
    try:
        first = await asyncio.wait_for(socket.receive_json(), 8)
        if not secrets.compare_digest(str(first.get('token', '')), TOKEN) or first.get('sampleRate') not in (16000, 44100, 48000):
            await socket.close(code=1008)
            return
        if active_session:
            await socket.send_json({'type': 'error', 'message': 'O microfone já está em uso em outra aba.'})
            await socket.close(code=1013)
            return
        active_session = acquired = True
        session = VoiceSession(socket, first['sampleRate'])
        await session.state('waiting')
        while True:
            message = await asyncio.wait_for(socket.receive(), 120 if session.saving else 300)
            if message['type'] == 'websocket.disconnect':
                break
            if message.get('bytes'):
                await session.audio(message['bytes'])
            elif message.get('text') and len(message['text']) < 4096:
                await session.control(json.loads(message['text']))
    except (WebSocketDisconnect, asyncio.TimeoutError):
        pass
    except Exception:
        try:
            await socket.send_json({'type': 'error', 'message': 'Falha no assistente local. Pause e ative novamente.'})
            await socket.close(code=1011)
        except Exception:
            pass
    finally:
        if acquired:
            active_session = False


if __name__ == '__main__':
    import uvicorn
    # O código não é enviado a serviços externos nem impresso nos logs de acesso.
    print('\nObraflux local — cole este código em Conectar assistente local:', flush=True)
    print(TOKEN, flush=True)
    print('\nSomente neste computador. Ctrl+C encerra o assistente.\n', flush=True)
    uvicorn.run(app, host='127.0.0.1', port=17843, access_log=False, ws_max_size=65540)
