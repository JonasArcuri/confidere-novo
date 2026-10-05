# Obraflux — assistente local por voz

O botão flutuante usa a mesma marca do botão de início. O navegador captura o microfone e envia áudio somente a `127.0.0.1:17843`. Whisper transcreve e reconhece a chamada **Obraflux** no processo Python local; Ollama interpreta as instruções. A voz de resposta usa as vozes instaladas no Windows (pyttsx3/SAPI). Não usa SpeechRecognition, API de ditado remoto ou modelo no navegador.

Os orçamentos continuam nas coleções existentes do Firebase, sob a sessão atual e as regras existentes. Áudio e conversa ficam apenas na memória e são descartados ao desconectar. As únicas informações persistidas localmente pelo assistente são os modelos, a configuração técnica e o segredo de pareamento. Nenhuma credencial Firebase é enviada ao assistente.

## Preparar no Windows

1. Instale Python 3.11+ e [Ollama para Windows](https://ollama.com/download/windows).
2. Abra o Ollama. Em suas configurações desative os recursos de nuvem; alternativamente configure `OLLAMA_NO_CLOUD=1` **no processo do Ollama** antes de iniciá-lo. A variável em `iniciar.ps1` afeta só seus processos filhos, não um Ollama já aberto. O assistente também verifica `/api/show` e recusa modelos remotos.
3. Execute na pasta do projeto:

```powershell
powershell -ExecutionPolicy Bypass -File .\assistente-local\configurar.ps1
powershell -ExecutionPolicy Bypass -File .\assistente-local\iniciar.ps1
```

A preparação baixa aproximadamente alguns GB para o modelo de linguagem e centenas de MB para Whisper. O padrão é `qwen2.5:7b` e Whisper `small` com CPU/int8. A máquina de desenvolvimento possui 32 GB de RAM; latência e qualidade ainda precisam de validação com a fala real do usuário. Para escolher outro modelo local: `configurar.ps1 -Modelo 'nome:tag'`.

Se o site usa domínio próprio, acrescente a **origem exata** (protocolo + domínio + porta, sem caminho) em `assistente-local/.config.json`, na lista `origins`, e reinicie o assistente. Nunca use `*`. O endereço de produção `https://confidere-novo.vercel.app`, os domínios Firebase do projeto e localhost nas portas 8000/4173 já estão configurados.

## Usar

1. Entre no Obra Flux com acesso a orçamentos e plano ativo.
2. Abra o botão flutuante **Obraflux**, expanda **Conectar assistente local** e cole o código exibido pelo programa. O código fica somente na memória da página.
3. Clique **Ativar microfone** e permita microfone/acesso ao computador local no navegador. Esse primeiro gesto é necessário; o site não liga o microfone antes da sua interação.
4. Diga **“Obraflux”**, espere a resposta e fale a instrução. Também pode dizer chamada e instrução numa frase. Faça uma pausa de cerca de 1,4 segundo ao terminar. A chamada é reconhecida ao terminar a frase, não instantaneamente durante sua fala.
5. Exemplo: **“Obraflux, monte um orçamento para João, pintura de cento e vinte metros quadrados a vinte e oito reais por metro quadrado de mão de obra, mais quatrocentos e cinquenta reais de materiais, pagamento em duas parcelas.”**
6. Responda por voz às perguntas. Ao concluir diga **“salvar”**. A ordem **“monte ... e salve”** permite salvar diretamente se os dados estiverem completos. Um complemento posterior exige novamente a palavra salvar, para não reaproveitar uma autorização antiga.
7. **“Cancelar”** descarta o pedido em andamento. **Pausar** desliga o microfone. Fechar o painel mantém a escuta e o indicador verde; ocultar a aba, sair ou fechar a página desliga a escuta.

O assistente cria apenas novos orçamentos nesta versão. Não modifica ou apaga documentos existentes. Os campos já abertos no editor são preservados; o novo orçamento aparece no histórico e pode ser aberto pelo painel. Abrir pede confirmação se houver conteúdo no editor. A resposta falada confirma salvamento somente após a confirmação do Firebase. Falhas podem ser repetidas dizendo salvar, com o mesmo ID, sem criar outro documento.

## Operação e limites

- Desktop Windows com Chrome/Edge, HTTPS ou localhost. Não é compatível com o celular acessando o serviço do PC por `127.0.0.1`.
- Mantenha uma única aba em escuta. A aba precisa estar visível; o serviço roda separado, mas a captura do microfone depende da página.
- Reconhecimento e geração usam CPU por padrão; não foi instalada dependência de GPU.
- O detector de fala usa limiar de energia configurável (`voiceThreshold`). Ruído contínuo pode impedir a detecção de pausas; ajuste o limiar e use um microfone próximo.
- Ativação por marca usa transcrição Whisper e pode ter erros. Validar reconhecimento de “Obraflux”, nomes, vírgulas decimais, valores e latência com áudio real antes de distribuir. Não é um detector dedicado de palavra-chave.
- Fala limitada a 60 segundos por trecho; respostas a perguntas podem ser dadas por até 90 segundos sem repetir a chamada. Após isso diga Obraflux novamente.
- Habilite uma voz portuguesa nas configurações de fala do Windows. Sem voz portuguesa, SAPI pode usar outra voz instalada. Sem SAPI, as respostas aparecem no painel.
- O modelo não consulta preços cadastrados nesta primeira versão. Informe os preços por voz; o prompt exige pergunta quando faltar preço. O esquema impede dados inválidos, mas não elimina erros de interpretação da IA.
- Totais e descontos são calculados por código; a IA não define totais. Pagamento falado é preservado como condição personalizada do sistema.
- Não houve alteração nas regras, autenticação ou configuração do Firebase. Numeração segue `proximoNumero`, com a mesma limitação de concorrência já existente entre máquinas distintas.
- O serviço escuta apenas no loopback e exige origem exata e segredo. Não exponha a porta na rede. O segredo não é credencial de acesso ao Firebase.
- Instalar modelos exige internet; inferência não. Salvar no Firebase continua exigindo conexão conforme o fluxo atual.

## Verificação técnica

```powershell
.\assistente-local\.venv\Scripts\python.exe -m unittest discover -s assistente-local -p 'test_*.py'
node --test tests/obraflux-budget.test.mjs
.\assistente-local\.venv\Scripts\python.exe .\assistente-local\verificar_modelos.py --transporte
```

O último comando usa os modelos reais, fala sintetizada e a conexão WebSocket. A confirmação de gravação é simulada: não cria documentos no Firebase nem liga o microfone real.

Referências: [Whisper local](https://github.com/SYSTRAN/faster-whisper), [API Ollama](https://docs.ollama.com/api/chat), [modo local e nuvem](https://docs.ollama.com/faq).
