/* Teste da montagem da ARVORE DE PASTAS.

   O git entrega os caminhos PLANOS ("wcm/widget/x/view.ftl") porque e assim
   que ele pensa. Mas nao e assim que alguem procura um arquivo: quem abre a
   aba quer reconhecer o projeto dele - wcm/, datasets/, sql/.

   A conversao de plano para hierarquia e pequena e tem tres jeitos de ficar
   sutilmente errada, e nenhum deles quebra a tela - so faz a arvore mentir:

     1. arquivo sumir (pasta sobrescrita por outra de mesmo nome em ramo
        diferente)
     2. a contagem da pasta nao bater com o que ela contem
     3. nome com espaco ou ponto tratado como separador

   Um explorador que esconde um arquivo e pior que nenhum: a pessoa conclui
   que aquilo nao esta versionado.

   Rodar:  node teste/teste-arvore.js
*/
'use strict';

var fs = require('fs');
var path = require('path');
var vm = require('vm');

var falhas = 0;
function conferir(condicao, descricao, detalhe) {
    if (condicao) console.log('ok     ' + descricao);
    else { console.log('FALHA  ' + descricao + (detalhe ? '\n         ' + detalhe : '')); falhas++; }
}

/* O app.js e um IIFE que mexe em document/window. Em vez de simular o DOM
   inteiro, extraimos a funcao pura - ela nao depende de nada do navegador. */
var fonte = fs.readFileSync(path.join(__dirname, '..', 'web', 'app.js'), 'utf8');
var inicio = fonte.indexOf('function montarArvore');
var fim = fonte.indexOf('function desenharPasta');
if (inicio < 0 || fim < 0) {
    console.log('FALHA  nao achei montarArvore no app.js');
    process.exit(1);
}
var sandbox = {};
vm.createContext(sandbox);
vm.runInContext(fonte.slice(inicio, fim) + '\n;this.montarArvore = montarArvore;',
                sandbox, { filename: 'montarArvore' });
var montarArvore = sandbox.montarArvore;

function arq(c, b) { return { caminho: c, bytes: b || 10 }; }

console.log('--- 1. hierarquia básica ---');

var t = montarArvore([
    arq('README.md'),
    arq('datasets/dsCatalogo.js'),
    arq('datasets/dsExecucao.js'),
    arq('wcm/widget/devToolsKit/view.ftl'),
    arq('wcm/widget/devToolsKit/js/app.js')
]);

conferir(t.arquivos.length === 1 && t.arquivos[0].nome === 'README.md',
    'arquivo da raiz fica na raiz');
conferir(!!t.pastas.datasets && !!t.pastas.wcm, 'cria as pastas de primeiro nível');
conferir(t.pastas.datasets.arquivos.length === 2, 'datasets/ tem os dois arquivos');
conferir(!!t.pastas.wcm.pastas.widget.pastas.devToolsKit,
    'aninha três níveis (wcm/widget/devToolsKit)');
conferir(t.pastas.wcm.pastas.widget.pastas.devToolsKit.arquivos.length === 1,
    'o .ftl fica na pasta certa');
conferir(t.pastas.wcm.pastas.widget.pastas.devToolsKit.pastas.js.arquivos[0].nome === 'app.js',
    'e o js/ vira subpasta, não parte do nome');

console.log('\n--- 2. a contagem de cada pasta ---');

conferir(t.total === 5, 'a raiz conta todos os arquivos', 'veio ' + t.total);
conferir(t.pastas.datasets.total === 2, 'datasets/ conta 2', 'veio ' + t.pastas.datasets.total);
conferir(t.pastas.wcm.total === 2, 'wcm/ conta os 2 do fundo da árvore',
    'a contagem tem de somar o que está NAS SUBPASTAS, senão wcm/ apareceria com 0');
conferir(t.pastas.wcm.pastas.widget.total === 2, 'widget/ também conta 2');

console.log('\n--- 3. nomes que costumam quebrar ---');

t = montarArvore([
    arq('pasta com espaço/arquivo com espaço.txt'),
    arq('relatórios/ação ç.md'),
    arq('a.b.c/arquivo.min.js'),
    arq('22 - Repositórios/x.js')
]);

conferir(!!t.pastas['pasta com espaço'], 'espaço no nome da PASTA');
conferir(t.pastas['pasta com espaço'].arquivos[0].nome === 'arquivo com espaço.txt',
    'espaço no nome do ARQUIVO');
conferir(!!t.pastas['relatórios'] && t.pastas['relatórios'].arquivos[0].nome === 'ação ç.md',
    'acento e cedilha atravessam inteiros');
conferir(!!t.pastas['a.b.c'] && t.pastas['a.b.c'].arquivos[0].nome === 'arquivo.min.js',
    'PONTO não é separador de pasta',
    'só a barra separa — um split por "." transformaria "arquivo.min.js" em três níveis');
conferir(!!t.pastas['22 - Repositórios'], 'hífen e número no nome da pasta');

console.log('\n--- 4. a armadilha do nome repetido ---');

t = montarArvore([
    arq('src/js/a.js'),
    arq('teste/js/b.js'),
    arq('src/js/c.js')
]);

conferir(!!t.pastas.src.pastas.js && !!t.pastas.teste.pastas.js,
    'duas pastas "js" em ramos diferentes coexistem',
    'guardar as pastas por nome global faria a segunda sobrescrever a primeira');
conferir(t.pastas.src.pastas.js.arquivos.length === 2, 'src/js tem 2 arquivos');
conferir(t.pastas.teste.pastas.js.arquivos.length === 1, 'teste/js tem 1 arquivo');

console.log('\n--- 5. nenhum arquivo pode sumir ---');

var entrada = [];
['a.js', 'x/b.js', 'x/y/c.js', 'x/y/d.js', 'x/z/e.js', 'w/f.js',
 'w/g/h/i/j/fundo.js', 'raiz2.md'].forEach(function (c) { entrada.push(arq(c)); });

t = montarArvore(entrada);

function contar(no) {
    var n = no.arquivos.length;
    Object.keys(no.pastas).forEach(function (k) { n += contar(no.pastas[k]); });
    return n;
}
conferir(contar(t) === entrada.length,
    'a árvore tem exatamente os ' + entrada.length + ' arquivos que entraram',
    'contou ' + contar(t) + ' — um explorador que esconde arquivo faz a pessoa ' +
    'concluir que ele não está versionado');
conferir(t.total === entrada.length, 'e a contagem da raiz bate com isso');

console.log('\n--- 6. lista vazia ---');
t = montarArvore([]);
conferir(t.total === 0 && !t.arquivos.length && !Object.keys(t.pastas).length,
    'repositório sem arquivo nenhum não estoura');

console.log('');
console.log(falhas ? ('===== ' + falhas + ' FALHAS =====') : '===== todos passaram =====');
process.exit(falhas ? 1 : 0);
