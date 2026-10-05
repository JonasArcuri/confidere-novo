"""Download explícito de modelos; nenhum dado de orçamento é enviado."""
import argparse
import json
from pathlib import Path
import shutil
import subprocess

from faster_whisper.utils import download_model

BASE = Path(__file__).resolve().parent

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--model', default='qwen2.5:7b')
    args = parser.parse_args()
    if ':cloud' in args.model or not args.model.replace(':', '').replace('.', '').replace('-', '').replace('_', '').isalnum():
        raise SystemExit('Informe um modelo local válido.')
    ollama = shutil.which('ollama')
    if not ollama:
        alternativa = Path.home() / 'AppData/Local/Programs/Ollama/ollama.exe'
        if alternativa.exists(): ollama = str(alternativa)
    if not ollama:
        raise SystemExit('Instale o Ollama para Windows em https://ollama.com/download/windows, abra o aplicativo e execute configurar.ps1 novamente.')
    print('Baixando o modelo de linguagem local. Isso pode levar vários minutos.', flush=True)
    subprocess.run([ollama, 'pull', args.model], check=True)
    print('Baixando Whisper small para reconhecimento local de português.', flush=True)
    download_model('small', output_dir=str(BASE / 'models/whisper-small'))
    arquivo = BASE / '.config.json'
    config = json.loads(arquivo.read_text('utf-8')) if arquivo.exists() else json.loads((BASE / 'config.example.json').read_text('utf-8'))
    config['model'] = args.model
    arquivo.write_text(json.dumps(config, ensure_ascii=False, indent=2), encoding='utf-8')
