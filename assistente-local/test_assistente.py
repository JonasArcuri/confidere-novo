import unittest
from unittest.mock import AsyncMock, patch
from fastapi.testclient import TestClient
from pydantic import ValidationError

from contracts import Budget, ativacao, autoriza_salvar, comando_salvar, validar_fidelidade
import server


def budget():
    return Budget(cliente='João', itens=[{'descricao': 'Pintura', 'quantidade': 120, 'unidade': 'm²', 'precoMaterial': 0, 'precoMaoObra': 28}])


class ContractsTest(unittest.TestCase):
    def test_ativacao_e_preservacao(self):
        self.assertEqual(ativacao('Obraflux, orçamento para João'), 'orçamento para João')
        self.assertEqual(ativacao('Olá, obra flux!'), '')
        self.assertIsNone(ativacao('orçamento para João'))
        self.assertIsNone(ativacao('a marca Obraflux é bonita'))

    def test_autorizacao(self):
        self.assertTrue(autoriza_salvar('Monte um orçamento e salve'))
        for frase in ['Não salve ainda', 'Antes de salvar pergunte', 'Como salvar?', 'Se ficar bom pode salvar', 'Quero só montar']:
            self.assertFalse(autoriza_salvar(frase), frase)
        self.assertTrue(comando_salvar('Pode salvar o orçamento agora.'))
        self.assertTrue(comando_salvar('Salvas.'))
        self.assertFalse(comando_salvar('Quantas propostas salvas?'))
        self.assertFalse(comando_salvar('Não salvar'))

    def test_contrato_recusa_precos_invalidos_e_codigo(self):
        dados = budget().model_dump()
        dados['itens'][0]['precoMaoObra'] = -28
        with self.assertRaises(ValidationError): Budget.model_validate(dados)
        dados = budget().model_dump()
        dados['javascript'] = 'alert(1)'
        with self.assertRaises(ValidationError): Budget.model_validate(dados)

    def test_omissao_de_valores_pagamento_e_desconto_inventado(self):
        with self.assertRaises(ValueError): validar_fidelidade(budget(), 'Pintura a 28 reais e materiais 450 reais')
        with self.assertRaises(ValueError): validar_fidelidade(budget(), 'Pagamento em duas parcelas')
        dados = budget(); dados.descontoMaoObra = 5
        with self.assertRaises(ValueError): validar_fidelidade(dados, 'Pintura a 28 reais')

    def test_correcao_nao_exige_o_preco_antigo(self):
        dados = budget(); dados.itens[0].precoMaoObra = 30
        validar_fidelidade(dados, 'Pintura a 28 reais\nTroque o preço por 30 reais', 'Troque o preço por 30 reais')


class SecurityTest(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(server.app, base_url='http://127.0.0.1:17843')

    def test_health_requires_token_and_exact_origin(self):
        self.assertEqual(self.client.get('/health').status_code, 401)
        headers = {'Authorization': f'Bearer {server.TOKEN}', 'Origin': 'https://evil.example'}
        self.assertEqual(self.client.get('/health', headers=headers).status_code, 403)
        headers['Origin'] = 'http://localhost:8000'
        with patch('server.modelo_local', new=AsyncMock(return_value=True)):
            resposta = self.client.get('/health', headers=headers)
        self.assertEqual(resposta.status_code, 200)
        self.assertEqual(resposta.headers['access-control-allow-origin'], 'http://localhost:8000')
        self.assertEqual(self.client.get('/health', headers={'Host': 'evil.example'}).status_code, 403)

    def test_ws_auth_and_single_session(self):
        headers = {'Origin': 'http://localhost:8000', 'Host': '127.0.0.1:17843'}
        with self.client.websocket_connect('/voice', headers=headers) as ws:
            ws.send_json({'token': server.TOKEN, 'sampleRate': 16000})
            self.assertEqual(ws.receive_json()['state'], 'waiting')
            with self.client.websocket_connect('/voice', headers=headers) as other:
                other.send_json({'token': server.TOKEN, 'sampleRate': 16000})
                self.assertEqual(other.receive_json()['type'], 'error')
        self.assertFalse(server.active_session)


class SessionTest(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.ws = AsyncMock()
        self.session = server.VoiceSession(self.ws, 16000)
        self.session.say = AsyncMock()

    async def test_salva_com_id_estavel_e_so_confirma_depois_do_firebase(self):
        self.session.pending = budget()
        self.session.request_id = 'c808a423-38e8-4ac9-bd27-8f172d7f9402'
        await self.session.command('salvar')
        self.session.say.assert_not_awaited()
        self.assertTrue(self.session.saving)
        await self.session.control({'type': 'save_result', 'requestId': self.session.request_id, 'ok': False})
        pedido = self.session.request_id
        await self.session.command('salvar')
        self.assertEqual(self.session.request_id, pedido)
        await self.session.control({'type': 'save_result', 'requestId': pedido, 'ok': True, 'numero': 12, 'total': 3360})
        self.assertIsNone(self.session.pending)
        self.assertIn('12', self.session.say.call_args.args[0])

    async def test_cancelar_descarta_pedido(self):
        self.session.pending = budget()
        await self.session.command('cancelar')
        self.assertIsNone(self.session.pending)
        self.assertEqual(self.session.history, [])

    async def test_audio_antigo_nao_e_processado(self):
        import numpy as np
        self.session.epoch = 3
        packet = (2).to_bytes(4, 'little') + np.ones(2048, dtype='<f4').tobytes()
        await self.session.audio(packet)
        self.assertEqual(self.session.frames, [])

    async def test_modelo_nuvem_recusado(self):
        with patch('server.modelo_local', new=AsyncMock(return_value=False)):
            await self.session.command('Monte um orçamento e salve')
        self.assertIsNone(self.session.pending)
        self.assertFalse(self.session.saving)


if __name__ == '__main__':
    unittest.main()
