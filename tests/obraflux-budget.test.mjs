import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
// O projeto usa ES Modules no navegador, sem package.json: importar como módulo.
const codigo = await readFile(new URL('../src/obraflux-budget.js', import.meta.url), 'utf8');
const { prepararOrcamentoVoz } = await import(`data:text/javascript;base64,${Buffer.from(codigo).toString('base64')}`);
const entrada = () => ({ cliente: 'João', itens: [
    { descricao: 'Pintura', quantidade: 120, unidade: 'm²', precoMaterial: 0, precoMaoObra: 28 },
    { descricao: 'Materiais', quantidade: 1, unidade: 'verba', precoMaterial: 450, precoMaoObra: 0 }
], pagamento: 'Duas parcelas' });

test('calcula 3810, preserva o contrato do editor e ignora totais inventados', () => {
    const dados = prepararOrcamentoVoz({ ...entrada(), totalComDesconto: 1 });
    assert.equal(dados.subtotalMaoObra, 3360);
    assert.equal(dados.subtotalMaterial, 450);
    assert.equal(dados.totalComDesconto, 3810);
    assert.equal(dados.linhas[0].area, 120);
    assert.equal(dados.linhas[0].desc, 'Pintura');
    assert.equal(dados.pagamento.personalizados.manual_obraflux_voz, 'Duas parcelas');
});
test('aplica descontos por componente e validade entre meses', () => {
    const dados = prepararOrcamentoVoz({ ...entrada(), descontoMaterial: 10, descontoMaoObra: 5, validadeDias: 30 }, new Date(2026, 9, 5, 12));
    assert.equal(dados.totalComDesconto, 3597);
    assert.equal(dados.data, '2026-10-05');
    assert.equal(dados.validade, '2026-11-04');
});
test('rejeita preço ausente, negativo, não numérico, infinito e quantidade zero', () => {
    for (const valor of [undefined, -1, '28', Infinity, NaN, null, true]) {
        const dados = entrada(); dados.itens[0].precoMaoObra = valor;
        assert.throws(() => prepararOrcamentoVoz(dados));
    }
    const dados = entrada(); dados.itens[0].quantidade = 0;
    assert.throws(() => prepararOrcamentoVoz(dados));
});
test('rejeita cliente ausente, lista vazia e desconto fora do limite', () => {
    assert.throws(() => prepararOrcamentoVoz({ ...entrada(), cliente: '' }));
    assert.throws(() => prepararOrcamentoVoz({ ...entrada(), itens: [] }));
    assert.throws(() => prepararOrcamentoVoz({ ...entrada(), descontoMaterial: 100 }));
});
