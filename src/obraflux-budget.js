// Contrato restrito entre a IA local e o orçamento. Totais nunca vêm do modelo.
const texto = (valor, limite = 2000) => {
    if (typeof valor !== 'string' || valor.length > limite) throw new Error('Texto do orçamento inválido.');
    return valor.trim();
};
const numero = (valor, maximo, positivo = false) => {
    if (typeof valor !== 'number' || !Number.isFinite(valor) || valor < 0 || valor > maximo || (positivo && valor === 0)) {
        throw new Error('Quantidade ou valor inválido no orçamento.');
    }
    return valor;
};
const dinheiro = valor => Math.round((valor + Number.EPSILON) * 100) / 100;

export function prepararOrcamentoVoz(entrada, hoje = new Date()) {
    if (!entrada || typeof entrada !== 'object') throw new Error('Orçamento ausente.');
    const cliente = texto(entrada.cliente, 200);
    if (!cliente) throw new Error('Informe o cliente por voz.');
    if (!Array.isArray(entrada.itens) || !entrada.itens.length || entrada.itens.length > 100) throw new Error('Informe os itens do orçamento.');
    const linhas = entrada.itens.map(item => {
        const desc = texto(item.descricao, 500);
        if (!desc) throw new Error('Há um item sem descrição.');
        const area = numero(item.quantidade, 1000000, true);
        const custoMaterial = numero(item.precoMaterial, 10000000);
        const custoMao = numero(item.precoMaoObra, 10000000);
        const subtotalMaterial = dinheiro(area * custoMaterial);
        const subtotalMao = dinheiro(area * custoMao);
        return { tipo: 'item', desc, area, areaLabel: texto(item.unidade, 40),
            material: texto(item.material || '', 500), custoMaterial, custoMao,
            subtotalMaterial, subtotalMao, total: dinheiro(subtotalMaterial + subtotalMao), baseId: '' };
    });
    const subtotalMaterial = dinheiro(linhas.reduce((s, l) => s + l.subtotalMaterial, 0));
    const subtotalMaoObra = dinheiro(linhas.reduce((s, l) => s + l.subtotalMao, 0));
    const desconto = { material: numero(entrada.descontoMaterial ?? 0, 99.99), maoObra: numero(entrada.descontoMaoObra ?? 0, 99.99) };
    const pagamentoTexto = texto(entrada.pagamento || '', 1000);
    const validade = new Date(hoje);
    validade.setDate(validade.getDate() + numero(entrada.validadeDias ?? 30, 365, true));
    const dataLocal = data => `${data.getFullYear()}-${String(data.getMonth() + 1).padStart(2, '0')}-${String(data.getDate()).padStart(2, '0')}`;
    const obra = texto(entrada.obra || '', 500);
    const obs = texto(entrada.observacoes || '');
    return { cliente, obra, assunto: obra, endereco: texto(entrada.endereco || '', 500), estado: texto(entrada.estado || '', 40),
        tipoDocumento: 'orcamento', obraId: '', data: dataLocal(hoje), validade: dataLocal(validade),
        obs, obsTextoLivre: obs, obsOpcoes: [], totaisOpcoes: [], linhas,
        subtotalMaterial, subtotalMaoObra, subtotal: dinheiro(subtotalMaterial + subtotalMaoObra),
        desconto, descontoMaterial: desconto.material, descontoMaoObra: desconto.maoObra,
        totalComDesconto: dinheiro(subtotalMaterial * (1 - desconto.material / 100) + subtotalMaoObra * (1 - desconto.maoObra / 100)),
        pagamento: pagamentoTexto ? { opcoes: ['manual_obraflux_voz'], personalizados: { manual_obraflux_voz: pagamentoTexto }, matEntradaPct: 0, maoEntradaPct: 0 } : null };
}
