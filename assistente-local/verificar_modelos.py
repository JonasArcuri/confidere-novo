"""Teste manual dos modelos reais com voz sintetizada, sem gravação no Firebase."""
import asyncio
from pathlib import Path
import tempfile
import time
import argparse
from unittest.mock import patch, AsyncMock

import httpx
import pyttsx3
from faster_whisper.audio import decode_audio

from contracts import Decision, SYSTEM_PROMPT, ativacao, schema_ollama, validar_fidelidade
from server import MODEL_NAME, OLLAMA, modelo_local, transcrever
import server


def verificar_transporte(audio, salvar_audio):
    import numpy as np
    from fastapi.testclient import TestClient
    client = TestClient(server.app, base_url='http://127.0.0.1:17843')
    with patch('server.falar_local', lambda texto: None):
        with client.websocket_connect('/voice', headers={'Origin': 'http://localhost:8000', 'Host': '127.0.0.1:17843'}) as ws:
            ws.send_json({'token': server.TOKEN, 'sampleRate': 16000})
            state = ws.receive_json()
            print('Transporte: conectado.', flush=True)
            def enviar_audio(samples, epoch):
                samples = np.concatenate((samples, np.zeros(28800, dtype=np.float32)))
                for i in range(0, len(samples), 2048):
                    ws.send_bytes(epoch.to_bytes(4, 'little') + samples[i:i + 2048].astype('<f4').tobytes())
            enviar_audio(audio, state['epoch'])
            preview = None
            while True:
                message = ws.receive_json()
                print('Transporte:', message['type'], message.get('state', message.get('text', '')), flush=True)
                if message['type'] == 'preview': preview = message['budget']
                if message['type'] == 'state' and message['state'] == 'listening':
                    if not preview: raise AssertionError('O áudio não produziu orçamento.')
                    enviar_audio(salvar_audio, message['epoch'])
                    break
            while True:
                message = ws.receive_json()
                print('Transporte:', message['type'], message.get('state', message.get('text', '')), flush=True)
                if message['type'] == 'state' and message['state'] == 'listening':
                    raise AssertionError('O comando salvar não foi reconhecido.')
                if message['type'] == 'save':
                    total = sum(i['quantidade'] * (i['precoMaterial'] + i['precoMaoObra']) for i in message['budget']['itens'])
                    assert total == 3810
                    ws.send_json({'type': 'save_result', 'requestId': message['requestId'], 'ok': True, 'numero': 123, 'total': total})
                if message['type'] == 'state' and message['state'] == 'waiting': break
    print('Áudio por WebSocket, chamada Obraflux, montagem, comando salvar e confirmação simulada: OK.', flush=True)


async def verificar(transporte=False):
    inicio = time.monotonic()
    if not await modelo_local():
        raise RuntimeError('O modelo configurado não é local.')
    with tempfile.TemporaryDirectory(prefix='obraflux-teste-') as pasta:
        arquivo = Path(pasta) / 'fala.wav'
        engine = pyttsx3.init()
        for voice in engine.getProperty('voices'):
            if 'portugu' in voice.name.lower():
                engine.setProperty('voice', voice.id)
                break
        engine.setProperty('rate', 160)
        engine.save_to_file('Obraflux, monte um orçamento para João. Pintura de cento e vinte metros quadrados, a vinte e oito reais por metro quadrado de mão de obra. Materiais: quatrocentos e cinquenta reais. Pagamento em duas parcelas.', str(arquivo))
        salvar_arquivo = Path(pasta) / 'salvar.wav'
        engine.save_to_file('Salvar.', str(salvar_arquivo))
        engine.runAndWait()
        engine.stop()
        audio = decode_audio(str(arquivo), sampling_rate=16000)
        salvar_audio = decode_audio(str(salvar_arquivo), sampling_rate=16000)
        transcrito = await asyncio.to_thread(transcrever, audio)
    print('Transcrição sintética:', transcrito, flush=True)
    comando = ativacao(transcrito)
    if comando is None:
        raise AssertionError('A chamada Obraflux não foi reconhecida na fala sintetizada.')
    async with httpx.AsyncClient(timeout=180, trust_env=False) as client:
        result = await client.post(f'{OLLAMA}/api/chat', json={'model': MODEL_NAME,
            'messages': [{'role': 'system', 'content': SYSTEM_PROMPT}, {'role': 'user', 'content': comando}],
            'format': schema_ollama(), 'stream': False, 'options': {'temperature': 0, 'num_ctx': 8192, 'num_predict': 1800}})
        result.raise_for_status()
        decision = Decision.model_validate_json(result.json()['message']['content'])
    print('Resultado:', decision.model_dump_json(indent=2), flush=True)
    assert decision.acao == 'orcamento' and decision.orcamento is not None
    validar_fidelidade(decision.orcamento, comando)
    total = sum(i.quantidade * (i.precoMaterial + i.precoMaoObra) for i in decision.orcamento.itens)
    assert total == 3810, f'Total esperado 3810, recebido {total}'
    sessao = server.VoiceSession(AsyncMock(), 16000)
    sessao.say = AsyncMock()
    await sessao.command('Monte um orçamento para Carlos, pintura de 20 metros quadrados.')
    assert sessao.pending is None, 'Pedido sem preço não pode gerar orçamento pronto.'
    await sessao.command('A mão de obra custa 25 reais por metro quadrado, sem materiais.')
    assert sessao.pending is not None, 'O complemento deveria concluir o orçamento.'
    assert sum(i.quantidade * (i.precoMaterial + i.precoMaoObra) for i in sessao.pending.itens) == 500
    await sessao.command('Corrija o preço da mão de obra para 30 reais por metro quadrado.')
    assert sessao.pending is not None
    assert sum(i.quantidade * (i.precoMaterial + i.precoMaoObra) for i in sessao.pending.itens) == 600
    assert not sessao.saving, 'A correção não autoriza salvar.'
    print('Pergunta por preço ausente, complemento e correção falada: OK.', flush=True)
    if transporte:
        await asyncio.to_thread(verificar_transporte, audio, salvar_audio)
    print(f'Modelos locais verificados em {time.monotonic() - inicio:.1f}s. Nenhum documento foi salvo.', flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--transporte', action='store_true')
    asyncio.run(verificar(parser.parse_args().transporte))
