import { escapeHtml } from './utils.js';

const moeda = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

function parseValor(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  if (!v) return 0;
  const limpo = String(v)
    .replace(/[^\d,.-]/g, '')
    .replace(/\.(?=\d{3}(\D|$))/g, '')
    .replace(',', '.');
  const n = Number(limpo);
  return Number.isFinite(n) ? n : 0;
}

function primeiroValor(obj, campos) {
  for (const campo of campos) {
    const valor = campo.split('.').reduce((acc, k) => acc?.[k], obj);
    const n = parseValor(valor);
    if (n > 0) return n;
  }
  return 0;
}

function dataItem(item) {
  const valor = item?.data || item?.dataRelatorio || item?.dataExecucao || item?.createdAt || item?.criadoEm || item?.savedAt;
  if (!valor) return null;
  if (valor?.toDate) return valor.toDate();
  if (typeof valor === 'string' && /^\d{4}-\d{2}/.test(valor)) return new Date(valor + 'T12:00:00');
  const d = new Date(valor);
  return Number.isNaN(d.getTime()) ? null : d;
}

function mesChave(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function nomeMes(chave) {
  const [ano, mes] = chave.split('-').map(Number);
  return new Date(ano, mes - 1, 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
}

function noMes(item, mes) {
  const d = dataItem(item);
  if (!d) return true;
  return mesChave(d) === mes;
}

function limitesMes(mes) {
  const [ano, m] = mes.split('-').map(Number);
  return {
    inicio: new Date(ano, m - 1, 1, 0, 0, 0),
    fim: new Date(ano, m, 0, 23, 59, 59)
  };
}

function dataFuncionario(func, campos) {
  for (const campo of campos) {
    const valor = func?.[campo];
    if (!valor) continue;
    const d = typeof valor === 'string' && /^\d{4}-\d{2}/.test(valor)
      ? new Date(valor + 'T12:00:00')
      : new Date(valor);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return null;
}

function funcionarioContaNoMes(func, mes) {
  const { inicio, fim } = limitesMes(mes);
  const admissao = dataFuncionario(func, ['dataAdmissao', 'admissao', 'data']);
  const demissao = dataFuncionario(func, ['dataDemissao', 'dataRescisao', 'demissao', 'rescisao']);

  if (admissao && admissao > fim) return false;
  if (demissao && demissao < inicio) return false;
  if ((func.status === 'inativo' || func.ativo === false) && !demissao) return false;
  return true;
}

function descricao(item, fallback) {
  return item?.obraNome || item?.obra || item?.nomeObra || item?.cliente || item?.descricao || item?.nome || fallback;
}

function getRelatorios() {
  return Array.isArray(window.relatorios) ? window.relatorios : [];
}

function getOrcamentos() {
  return Array.isArray(window._orcamentosFirestore) ? window._orcamentosFirestore : [];
}

function getInsumos() {
  return Array.isArray(window.insumos) ? window.insumos : [];
}

function getFuncionarios() {
  return Array.isArray(window.funcionarios) ? window.funcionarios : [];
}

function entradaRelatorio(rel) {
  return primeiroValor(rel, [
    'rendimento',
    'valorRendimento',
    'valorRecebido',
    'receita',
    'faturamento',
    'valorTotal',
    'total',
    'valor'
  ]);
}

function getTipoDocumentoFinanceiro(doc) {
  return doc?.tipoDocumento || doc?.tipo || doc?.documentoTipo || 'orcamento';
}

function dataAprovacaoOrcamento(orc) {
  const valor = orc?.dataAprovacao;
  if (!valor) return null;
  if (typeof valor === 'string' && /^\d{4}-\d{2}/.test(valor)) return new Date(valor + 'T12:00:00');
  const d = new Date(valor);
  return Number.isNaN(d.getTime()) ? null : d;
}

function orcamentoAprovadoNoMes(orc, mes) {
  if (getTipoDocumentoFinanceiro(orc) !== 'orcamento') return false;
  if (orc?.statusAprovacao !== 'aprovado' && orc?.aprovado !== true) return false;
  const data = dataAprovacaoOrcamento(orc);
  return data ? mesChave(data) === mes : false;
}

function isOrcamentoFinanceiro(orc) {
  return getTipoDocumentoFinanceiro(orc) === 'orcamento';
}

function isRelatorioCobrancaFinanceiro(doc) {
  return getTipoDocumentoFinanceiro(doc) === 'cobranca';
}

function orcamentoRealizadoNoMes(orc, mes) {
  if (!isOrcamentoFinanceiro(orc)) return false;
  const data = dataItem(orc);
  return data ? mesChave(data) === mes : false;
}

function valorAreaLinha(linha) {
  const direto = parseValor(linha?.area);
  if (direto > 0) return direto;
  const match = String(linha?.area || '').replace(',', '.').match(/\d+(?:\.\d+)?/);
  return match ? parseValor(match[0]) : 0;
}

function totaisMaterialMaoObraOrcamento(orc) {
  return (orc?.linhas || []).reduce((acc, linha) => {
    if (!linha || linha.tipo === 'cabecalho' || linha.tipo === 'imagem' || linha.tipo === 'opcao') return acc;

    const totalMaterial = parseValor(linha.totalMaterial);
    const totalMaoObra = parseValor(linha.totalMaoObra);
    if (totalMaterial > 0 || totalMaoObra > 0) {
      acc.material += totalMaterial;
      acc.maoObra += totalMaoObra;
      return acc;
    }

    const area = valorAreaLinha(linha);
    acc.material += area * parseValor(linha.custoMaterial);
    acc.maoObra += area * parseValor(linha.custoMao);
    return acc;
  }, { material: 0, maoObra: 0 });
}

function entradaOrcamento(orc) {
  const totalSalvo = parseValor(orc?.totalComDesconto);
  if (totalSalvo > 0) return totalSalvo;

  const subtotalSalvo = parseValor(orc?.subtotal);
  if (subtotalSalvo > 0) {
    const desconto = parseValor(orc?.desconto);
    return desconto ? subtotalSalvo * (1 - desconto / 100) : subtotalSalvo;
  }

  const subtotalLinhas = (orc?.linhas || []).reduce((acc, linha) => {
    if (!linha || linha.tipo === 'cabecalho' || linha.tipo === 'imagem' || linha.tipo === 'opcao') return acc;
    const totalLinha = parseValor(linha.total);
    if (totalLinha > 0) return acc + totalLinha;
    return acc + parseValor(linha.totalMaterial) + parseValor(linha.totalMaoObra);
  }, 0);
  const desconto = parseValor(orc?.desconto);
  return desconto ? subtotalLinhas * (1 - desconto / 100) : subtotalLinhas;
}

function saidaInsumo(insumo) {
  const direto = primeiroValor(insumo, ['valorTotal', 'total', 'valor', 'custo', 'preco', 'precoTotal']);
  if (direto > 0) return direto;
  const qtd = parseValor(insumo.quantidade || insumo.qtd);
  const unit = parseValor(insumo.valorUnitario || insumo.precoUnitario || insumo.valorUnidade);
  return qtd * unit;
}

function saidaFuncionario(func) {
  return primeiroValor(func, [
    'salarioMensal',
    'salario',
    'custoMensal',
    'valorMensal',
    'valor',
    'diaria',
    'valorDiaria'
  ]);
}

function isCustoDiario(func) {
  return /di[aá]rio/i.test(func?.tipoSalario || func?.tipoCusto || '');
}

function diasTrabalhadosMes(func, mes) {
  const dias = func?.diasTrabalhados?.[mes];
  return Array.isArray(dias) ? dias.length : 0;
}

function montarAnaliseOrcamentos(mes) {
  const orcamentos = getOrcamentos().filter(isOrcamentoFinanceiro);
  const realizados = orcamentos.filter(o => orcamentoRealizadoNoMes(o, mes));
  const aprovados = orcamentos.filter(o => orcamentoAprovadoNoMes(o, mes));
  const totais = aprovados.reduce((acc, orc) => {
    const t = totaisMaterialMaoObraOrcamento(orc);
    acc.material += t.material;
    acc.maoObra += t.maoObra;
    return acc;
  }, { material: 0, maoObra: 0 });

  return {
    realizados: realizados.length,
    aprovados: aprovados.length,
    pendentes: Math.max(realizados.length - realizados.filter(o => o.statusAprovacao === 'aprovado' || o.aprovado === true).length, 0),
    material: totais.material,
    maoObra: totais.maoObra
  };
}

function montarAnaliseCobrancas(mes) {
  const cobrancas = getOrcamentos().filter(o => isRelatorioCobrancaFinanceiro(o) && noMes(o, mes));
  const totais = cobrancas.reduce((acc, doc) => {
    const t = totaisMaterialMaoObraOrcamento(doc);
    acc.material += t.material;
    acc.maoObra += t.maoObra;
    return acc;
  }, { material: 0, maoObra: 0 });

  return {
    quantidade: cobrancas.length,
    material: totais.material,
    maoObra: totais.maoObra,
    total: totais.material + totais.maoObra
  };
}

function montarMovimentos(mes) {
  const entradas = getOrcamentos()
    .filter(o => isRelatorioCobrancaFinanceiro(o) && noMes(o, mes))
    .map(o => ({
      tipo: 'entrada',
      grupo: 'Relat\u00F3rio de cobran\u00E7a',
      data: dataItem(o),
      descricao: descricao(o, `Relat\u00F3rio de cobran\u00E7a #${String(o.numero || '').padStart(3, '0')}`),
      valor: entradaOrcamento(o)
    }))
    .filter(m => m.valor > 0);

  const insumos = getInsumos()
    .filter(i => noMes(i, mes))
    .map(i => ({
      tipo: 'saida',
      grupo: 'Insumos',
      data: dataItem(i),
      descricao: descricao(i, 'Insumo/despesa'),
      valor: saidaInsumo(i)
    }))
    .filter(m => m.valor > 0);

  const funcionarios = getFuncionarios()
    .filter(f => funcionarioContaNoMes(f, mes))
    .map(f => ({
      tipo: 'saida',
      grupo: 'Funcion\u00E1rios',
      data: null,
      descricao: isCustoDiario(f)
        ? `${f.nome || f.funcionario || 'Funcion\u00E1rio'} (${diasTrabalhadosMes(f, mes)} dia(s))`
        : (f.nome || f.funcionario || 'Funcion\u00E1rio'),
      valor: isCustoDiario(f)
        ? saidaFuncionario(f) * diasTrabalhadosMes(f, mes)
        : saidaFuncionario(f)
    }))
    .filter(m => m.valor > 0);

  const movimentos = [...entradas, ...insumos, ...funcionarios];
  const totalEntradas = entradas.reduce((s, m) => s + m.valor, 0);
  const totalInsumos = insumos.reduce((s, m) => s + m.valor, 0);
  const totalFuncionarios = funcionarios.reduce((s, m) => s + m.valor, 0);
  const totalSaidas = totalInsumos + totalFuncionarios;

  return {
    mes,
    entradas,
    insumos,
    funcionarios,
    movimentos,
    totalEntradas,
    totalInsumos,
    totalFuncionarios,
    totalSaidas,
    saldo: totalEntradas - totalSaidas
  };
}

function pctDiff(atual, anterior) {
  if (!anterior) return atual ? 'novo' : '0%';
  const pct = ((atual - anterior) / Math.abs(anterior)) * 100;
  return `${pct >= 0 ? '+' : ''}${pct.toFixed(1).replace('.', ',')}%`;
}

function card(label, valor, classe = '') {
  return `<div class="fin-card ${classe}">
    <span>${escapeHtml(label)}</span>
    <strong>${moeda.format(valor)}</strong>
  </div>`;
}

function graficoRosca(titulo, itens, modo = 'numero') {
  const total = itens.reduce((s, item) => s + item.valor, 0);
  let inicio = 0;
  const fatias = total > 0
    ? itens.map(item => {
        const fim = inicio + (item.valor / total) * 100;
        const trecho = `${item.cor} ${inicio.toFixed(2)}% ${fim.toFixed(2)}%`;
        inicio = fim;
        return trecho;
      }).join(', ')
    : '#d9dee5 0% 100%';
  const centro = modo === 'moeda' ? moeda.format(total) : String(total);

  return `<div class="fin-pie-card">
    <div class="fin-chart-head">
      <h4>${escapeHtml(titulo)}</h4>
      <strong>${escapeHtml(centro)}</strong>
    </div>
    <div class="fin-pie-3d" style="--pie:${fatias}"></div>
    <div class="fin-pie-legend">
      ${itens.map(item => {
        const pct = total > 0 ? (item.valor / total) * 100 : 0;
        return `<div class="fin-pie-legend-item">
        <span class="fin-pie-dot" style="background:${item.cor}"></span>
        <span>${escapeHtml(item.label)}</span>
        <strong>${modo === 'moeda' ? moeda.format(item.valor) : item.valor}</strong>
        <em>${pct.toFixed(1).replace('.', ',')}%</em>
      </div>`;
      }).join('')}
    </div>
  </div>`;
}

function renderRelacaoOrcamentos(analise) {
  return `<section class="fin-section fin-orcamentos-section">
    <div class="fin-section-title-row">
      <h3>Relação de Orçamentos</h3>
      <span>${analise.realizados} realizados &bull; ${analise.aprovados} aprovados</span>
    </div>
    <div class="fin-orcamento-resumo fin-orcamento-resumo-contagem">
      <div class="fin-orcamento-kpi">
        <span>Orçamentos realizados</span>
        <strong>${analise.realizados}</strong>
      </div>
      <div class="fin-orcamento-kpi aprovado">
        <span>Orçamentos aprovados</span>
        <strong>${analise.aprovados}</strong>
      </div>
    </div>
    ${graficoRosca('Quantidade', [
      { label: 'Orçamentos realizados', valor: analise.realizados, cor: '#1a3a5c' },
      { label: 'Orçamentos aprovados', valor: analise.aprovados, cor: '#1f9d55' }
    ])}
  </section>`;
}

function renderAnaliseCobrancas(analise) {
  return `<section class="fin-section fin-cobrancas-section">
    <div class="fin-section-title-row">
      <h3>Relatórios de Cobrança</h3>
      <span>${analise.quantidade} no mês &bull; ${moeda.format(analise.total)}</span>
    </div>
    <div class="fin-orcamento-resumo fin-orcamento-resumo-contagem">
      <div class="fin-orcamento-kpi">
        <span>Total material</span>
        <strong>${moeda.format(analise.material)}</strong>
      </div>
      <div class="fin-orcamento-kpi">
        <span>Total mão de obra</span>
        <strong>${moeda.format(analise.maoObra)}</strong>
      </div>
    </div>
    ${graficoRosca('Valores dos relatórios de cobrança', [
      { label: 'Material', valor: analise.material, cor: '#2563a8' },
      { label: 'Mão de obra', valor: analise.maoObra, cor: '#e95a1a' }
    ], 'moeda')}
  </section>`;
}

function renderAnalisesFinanceiras(orcamentos, cobrancas) {
  return `<div class="fin-analises-grid">
    ${renderRelacaoOrcamentos(orcamentos)}
    ${renderAnaliseCobrancas(cobrancas)}
  </div>`;
}

function tabela(titulo, linhas, vazio) {
  const body = linhas.length
    ? linhas.map(m => `<tr>
        <td>${m.data ? m.data.toLocaleDateString('pt-BR') : '-'}</td>
        <td>${escapeHtml(m.descricao)}</td>
        <td>${escapeHtml(m.grupo)}</td>
        <td class="${m.tipo === 'entrada' ? 'pos' : 'neg'}">${m.tipo === 'entrada' ? '+' : '-'} ${moeda.format(m.valor)}</td>
      </tr>`).join('')
    : `<tr><td colspan="4" class="fin-vazio">${escapeHtml(vazio)}</td></tr>`;

  return `<section class="fin-section">
    <h3>${escapeHtml(titulo)}</h3>
    <div class="fin-table-wrap">
      <table class="fin-table">
        <thead><tr><th>Data</th><th>Descrição</th><th>Grupo</th><th>Valor</th></tr></thead>
        <tbody>${body}</tbody>
      </table>
    </div>
  </section>`;
}

function renderComparativo(a, b) {
  if (!b) return '';
  const rows = [
    ['Entradas', a.totalEntradas, b.totalEntradas],
    ['Insumos', a.totalInsumos, b.totalInsumos],
    ['Funcionários', a.totalFuncionarios, b.totalFuncionarios],
    ['Saídas', a.totalSaidas, b.totalSaidas],
    ['Saldo', a.saldo, b.saldo]
  ];

  return `<section class="fin-section">
    <h3>Comparativo mensal</h3>
    <div class="fin-table-wrap">
      <table class="fin-table">
        <thead><tr><th>Indicador</th><th>${escapeHtml(nomeMes(a.mes))}</th><th>${escapeHtml(nomeMes(b.mes))}</th><th>Variação</th></tr></thead>
        <tbody>${rows.map(([label, atual, antigo]) => `<tr>
          <td>${label}</td>
          <td>${moeda.format(atual)}</td>
          <td>${moeda.format(antigo)}</td>
          <td class="${atual - antigo >= 0 ? 'pos' : 'neg'}">${moeda.format(atual - antigo)} (${pctDiff(atual, antigo)})</td>
        </tr>`).join('')}</tbody>
      </table>
    </div>
  </section>`;
}

function renderizarFluxoFinanceiro() {
  const mesEl = document.getElementById('fin-mes');
  const compEl = document.getElementById('fin-mes-comparar');
  const cont = document.getElementById('financeiro-conteudo');
  if (!mesEl || !compEl || !cont) return;

  if (!mesEl.value) mesEl.value = mesChave(new Date());
  if (!compEl.value) {
    const d = new Date(mesEl.value + '-01T12:00:00');
    d.setMonth(d.getMonth() - 1);
    compEl.value = mesChave(d);
  }

  const atual = montarMovimentos(mesEl.value);
  const analiseOrcamentos = montarAnaliseOrcamentos(mesEl.value);
  const analiseCobrancas = montarAnaliseCobrancas(mesEl.value);
  const comparar = compEl.value ? montarMovimentos(compEl.value) : null;
  const movimentos = [...atual.movimentos].sort((a, b) => (b.data?.getTime?.() || 0) - (a.data?.getTime?.() || 0));

  cont.innerHTML = `
    <div class="fin-mes-label">${escapeHtml(nomeMes(atual.mes))}</div>
    <div class="fin-cards">
      ${card('Entradas', atual.totalEntradas, 'entrada')}
      ${card('Saídas', atual.totalSaidas, 'saida')}
      ${card('Saldo do mês', atual.saldo, atual.saldo >= 0 ? 'entrada' : 'saida')}
      ${card('Insumos', atual.totalInsumos)}
      ${card('Funcionários', atual.totalFuncionarios)}
    </div>
    ${renderAnalisesFinanceiras(analiseOrcamentos, analiseCobrancas)}
    ${renderComparativo(atual, comparar)}
    ${tabela('Entradas', atual.entradas, 'Nenhuma entrada no mês selecionado.')}
    ${tabela('Saídas com insumos', atual.insumos, 'Nenhum gasto com insumo no mês selecionado.')}
    ${tabela('Saídas com funcionários', atual.funcionarios, 'Nenhum custo de funcionário cadastrado.')}
    ${tabela('Relação completa', movimentos, 'Nenhum movimento financeiro encontrado.')}
  `;
}


function normalizarTextoPdf(texto) {
  const mapa = {
    'Relat\u003Frio': 'Relat\u00F3rio',
    'Relat\u00C3\u00B3rio': 'Relat\u00F3rio',
    'Or\u00C3\u00A7amento': 'Or\u00E7amento',
    'Or\u00C3\u00A7amentos': 'Or\u00E7amentos',
    'Rela\u00C3\u00A7\u00C3\u00A3o': 'Rela\u00E7\u00E3o',
    'Descri\u00C3\u00A7\u00C3\u00A3o': 'Descri\u00E7\u00E3o',
    'Sa\u00C3\u00ADdas': 'Sa\u00EDdas',
    'm\u00C3\u00AAs': 'm\u00EAs',
    'M\u00C3\u00AAs': 'M\u00EAs',
    'M\u00C3\u00A3o': 'M\u00E3o',
    'funcion\u00C3\u00A1rios': 'funcion\u00E1rios',
    'Funcion\u00C3\u00A1rio': 'Funcion\u00E1rio',
    'M\u003Fs': 'M\u00EAs',
    'Sa\u003Fdas': 'Sa\u00EDdas',
    'Descri\u003F\u003Fo': 'Descri\u00E7\u00E3o',
    'Funcion\u003Frios': 'Funcion\u00E1rios',
    'Funcion\u00C3\u00A1rios': 'Funcion\u00E1rios',
    'Rela\u003F\u003Fo': 'Rela\u00E7\u00E3o',
    'or\u003Famentos': 'or\u00E7amentos',
    'Or\u003Famentos': 'Or\u00E7amentos',
    'M\u003Fo obra': 'M\u00E3o obra',
    'n\u003Fo': 'n\u00E3o',
    'P\u003Fgina': 'P\u00E1gina',
    'Varia\u003F\u003Fo': 'Varia\u00E7\u00E3o'
  };
  let saida = String(texto || '');
  Object.entries(mapa).forEach(([de, para]) => {
    saida = saida.replaceAll(de, para);
  });
  return saida;
}

function textoPdf(doc, texto, x, y, opts = {}) {
  doc.text(normalizarTextoPdf(texto), x, y, opts);
}

function cortarPdf(doc, texto, maxW) {
  const str = normalizarTextoPdf(texto || '-');
  if (doc.getTextWidth(str) <= maxW) return str;
  let t = str;
  while (t.length > 1 && doc.getTextWidth(t + '...') > maxW) t = t.slice(0, -1);
  return t + '...';
}

function criarPdfFinanceiroBase() {
  const JsPDF = window.jspdf?.jsPDF || window.jsPDF;
  if (!JsPDF) {
    mostrarToast?.('Biblioteca de PDF n\u00E3o carregada.', 'erro');
    return null;
  }
  const doc = new JsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  return doc;
}

function addCabecalhoFinanceiroPdf(doc, titulo, subtitulo) {
  doc.setFillColor(26, 58, 92);
  doc.rect(0, 0, 210, 30, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(17);
  textoPdf(doc, titulo, 14, 14);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  textoPdf(doc, subtitulo, 14, 22);
  doc.setTextColor(26, 58, 92);
}

function addRodapeFinanceiroPdf(doc) {
  const paginas = doc.getNumberOfPages();
  for (let i = 1; i <= paginas; i++) {
    doc.setPage(i);
    doc.setDrawColor(210, 210, 210);
    doc.line(14, 287, 196, 287);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(105, 105, 105);
    textoPdf(doc, `P\u00E1gina ${i} de ${paginas}`, 196, 292, { align: 'right' });
    textoPdf(doc, 'Fluxo Financeiro', 14, 292);
  }
}

function garantirEspacoPdf(doc, y, altura = 12) {
  if (y + altura <= 282) return y;
  doc.addPage();
  return 18;
}

function addSecaoTituloPdf(doc, titulo, y) {
  y = garantirEspacoPdf(doc, y, 10);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.setTextColor(26, 58, 92);
  textoPdf(doc, titulo.toUpperCase(), 14, y);
  doc.setDrawColor(37, 99, 168);
  doc.line(14, y + 2, 196, y + 2);
  return y + 8;
}

function addKpisPdf(doc, itens, y) {
  const w = 35;
  const gap = 2;
  itens.forEach((item, idx) => {
    const x = 14 + idx * (w + gap);
    doc.setFillColor(248, 250, 252);
    doc.setDrawColor(218, 218, 218);
    doc.roundedRect(x, y, w, 20, 2, 2, 'FD');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7);
    doc.setTextColor(90, 90, 90);
    textoPdf(doc, item.label.toUpperCase(), x + 2, y + 6);
    doc.setFontSize(10);
    doc.setTextColor(item.cor || 26, item.g || 58, item.b || 92);
    textoPdf(doc, item.valor, x + 2, y + 15);
  });
  return y + 27;
}

function addTabelaPdf(doc, titulo, linhas, y, limite = 18) {
  y = addSecaoTituloPdf(doc, titulo, y);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setFillColor(26, 58, 92);
  doc.setTextColor(255, 255, 255);
  doc.rect(14, y, 182, 7, 'F');
  textoPdf(doc, 'Data', 16, y + 5);
  textoPdf(doc, 'Descri\u00E7\u00E3o', 38, y + 5);
  textoPdf(doc, 'Grupo', 122, y + 5);
  textoPdf(doc, 'Valor', 194, y + 5, { align: 'right' });
  y += 9;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(35, 35, 35);
  const mostrar = linhas.slice(0, limite);
  if (!mostrar.length) {
    textoPdf(doc, 'Nenhum registro encontrado.', 16, y + 4);
    return y + 10;
  }

  mostrar.forEach((m, idx) => {
    y = garantirEspacoPdf(doc, y, 8);
    if (idx % 2 === 0) {
      doc.setFillColor(248, 250, 252);
      doc.rect(14, y - 1, 182, 7, 'F');
    }
    const valor = `${m.tipo === 'entrada' ? '+' : '-'} ${moeda.format(m.valor)}`;
    textoPdf(doc, m.data ? m.data.toLocaleDateString('pt-BR') : '-', 16, y + 4);
    textoPdf(doc, cortarPdf(doc, m.descricao, 78), 38, y + 4);
    textoPdf(doc, cortarPdf(doc, m.grupo, 42), 122, y + 4);
    doc.setTextColor(m.tipo === 'entrada' ? 31 : 224, m.tipo === 'entrada' ? 157 : 92, m.tipo === 'entrada' ? 85 : 32);
    textoPdf(doc, valor, 194, y + 4, { align: 'right' });
    doc.setTextColor(35, 35, 35);
    y += 7;
  });

  if (linhas.length > limite) {
    doc.setFont('helvetica', 'italic');
    doc.setTextColor(105, 105, 105);
    textoPdf(doc, `+ ${linhas.length - limite} registros adicionais omitidos neste resumo.`, 16, y + 4);
    y += 8;
  }
  return y + 4;
}

function gerarRelatorioFinanceiroPDF() {
  const mesEl = document.getElementById('fin-mes');
  const compEl = document.getElementById('fin-mes-comparar');
  const mes = mesEl?.value || mesChave(new Date());
  const comp = compEl?.value || '';
  const atual = montarMovimentos(mes);
  const comparar = comp ? montarMovimentos(comp) : null;
  const analise = montarAnaliseOrcamentos(mes);
  const analiseCobrancas = montarAnaliseCobrancas(mes);
  const movimentos = [...atual.movimentos].sort((a, b) => (b.data?.getTime?.() || 0) - (a.data?.getTime?.() || 0));
  const doc = criarPdfFinanceiroBase();
  if (!doc) return;

  addCabecalhoFinanceiroPdf(doc, 'Relat\u00F3rio de Fluxo Financeiro', `M\u00EAs principal: ${nomeMes(mes)}${comparar ? ' | Comparativo: ' + nomeMes(comp) : ''}`);
  let y = 40;

  y = addSecaoTituloPdf(doc, 'Resumo do m\u00EAs', y);
  y = addKpisPdf(doc, [
    { label: 'Entradas', valor: moeda.format(atual.totalEntradas), cor: 31, g: 157, b: 85 },
    { label: 'Sa\u00EDdas', valor: moeda.format(atual.totalSaidas), cor: 224, g: 92, b: 32 },
    { label: 'Saldo', valor: moeda.format(atual.saldo), cor: atual.saldo >= 0 ? 31 : 224, g: atual.saldo >= 0 ? 157 : 92, b: atual.saldo >= 0 ? 85 : 32 },
    { label: 'Insumos', valor: moeda.format(atual.totalInsumos) },
    { label: 'Funcion\u00E1rios', valor: moeda.format(atual.totalFuncionarios) }
  ], y);

  y = addSecaoTituloPdf(doc, 'Rela\u00E7\u00E3o de or\u00E7amentos', y);
  y = addKpisPdf(doc, [
    { label: 'Realizados', valor: String(analise.realizados) },
    { label: 'Aprovados', valor: String(analise.aprovados), cor: 31, g: 157, b: 85 }
  ], y);

  y = addSecaoTituloPdf(doc, 'Relat\u00F3rios de cobran\u00E7a', y);
  y = addKpisPdf(doc, [
    { label: 'Cobran\u00E7as', valor: String(analiseCobrancas.quantidade) },
    { label: 'Material', valor: moeda.format(analiseCobrancas.material) },
    { label: 'M\u00E3o obra', valor: moeda.format(analiseCobrancas.maoObra) },
    { label: 'Total', valor: moeda.format(analiseCobrancas.total), cor: 31, g: 157, b: 85 }
  ], y);

  if (comparar) {
    y = addSecaoTituloPdf(doc, 'Comparativo mensal', y);
    const rows = [
      ['Entradas', atual.totalEntradas, comparar.totalEntradas],
      ['Sa\u00EDdas', atual.totalSaidas, comparar.totalSaidas],
      ['Saldo', atual.saldo, comparar.saldo],
      ['Insumos', atual.totalInsumos, comparar.totalInsumos],
      ['Funcion\u00E1rios', atual.totalFuncionarios, comparar.totalFuncionarios]
    ];
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    rows.forEach(([label, a, b]) => {
      y = garantirEspacoPdf(doc, y, 7);
      textoPdf(doc, label, 16, y);
      textoPdf(doc, moeda.format(a), 74, y);
      textoPdf(doc, moeda.format(b), 120, y);
      textoPdf(doc, `${moeda.format(a - b)} (${pctDiff(a, b)})`, 194, y, { align: 'right' });
      y += 7;
    });
    y += 4;
  }

  y = addTabelaPdf(doc, 'Entradas', atual.entradas, y, 14);
  y = addTabelaPdf(doc, 'Sa\u00EDdas com insumos', atual.insumos, y, 12);
  y = addTabelaPdf(doc, 'Sa\u00EDdas com funcion\u00E1rios', atual.funcionarios, y, 12);
  y = addTabelaPdf(doc, 'Rela\u00E7\u00E3o completa', movimentos, y, 20);

  addRodapeFinanceiroPdf(doc);
  const nomeArquivo = `Relatorio_Fluxo_Financeiro_${mes}.pdf`;
  doc.save(nomeArquivo);
  mostrarToast?.('Relat\u00F3rio financeiro gerado em PDF.', 'sucesso');
}

function inicializarFluxoFinanceiro() {
  const mesEl = document.getElementById('fin-mes');
  if (mesEl && !mesEl.value) mesEl.value = mesChave(new Date());
  renderizarFluxoFinanceiro();
}

Object.assign(window, {
  inicializarFluxoFinanceiro,
  renderizarFluxoFinanceiro,
  gerarRelatorioFinanceiroPDF
});
