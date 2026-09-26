/* Teste da marcacao de sintaxe.

   O QUE ELE PROTEGE, E POR QUE NAO E SO ESTETICA

   O realce devolve HTML que o app joga num innerHTML. Se ele deixar passar um
   "<" sem escapar, o CONTEUDO DE UM ARQUIVO DO REPOSITORIO vira HTML executado
   na pagina - e repositorio de widget Fluig e cheio de <script>. Nao e ataque
   de terceiro: e o proprio codigo da equipe virando execucao ao ser exibido.

   Por isso a primeira secao e a que importa. As outras conferem que o realce
   nao come nem duplica caractere - um visualizador que mostra o codigo
   ligeiramente diferente do que esta no arquivo e pior que um sem cor nenhuma.

   Rodar:  node teste/teste-realce.js
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

/* Carrega o realce.js de verdade, com um window de mentira. */
var sandbox = { window: {} };
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'web', 'realce.js'), 'utf8'),
                sandbox, { filename: 'realce.js' });
var R = sandbox.window.realce;

conferir(!!R && typeof R.realcar === 'function', 'o realce carregou');

console.log('\n--- 1. ESCAPE: o conteúdo do arquivo não pode virar HTML ---');

var perigo = '<script>alert(1)</script>';
var saida = R.realcar(perigo, 'x.js');
conferir(saida.indexOf('<script>') < 0,
    '<script> de dentro do arquivo é escapado',
    'saiu: ' + saida);
conferir(saida.indexOf('&lt;script&gt;') >= 0, 'e aparece como texto, para a pessoa ler');

saida = R.realcar('<img src=x onerror="alert(1)">', 'x.html');
conferir(saida.indexOf('onerror="alert(1)"') < 0 || saida.indexOf('<img') < 0,
    'atributo de evento não escapa para o HTML da página',
    saida.slice(0, 120));

saida = R.realcar('a & b < c > d', 'x.txt');
conferir(saida === 'a &amp; b &lt; c &gt; d',
    'o &, o < e o > viram entidade mesmo sem linguagem', saida);

console.log('\n--- 2. o texto não pode ser alterado ---');

function semTags(html) {
    return String(html).replace(/<[^>]*>/g, '')
        .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

[
    ['js',  'var x = 1; // comentário com acento ç\nfunction f() { return "ok"; }'],
    ['css', '.classe { color: #CC0F10; margin: 0 4px; }'],
    ['sql', "SELECT * FROM T WHERE N = 'texto com espaço';"],
    ['html','<div class="a">texto</div>'],
    ['json','{"chave": "valor", "n": 12}'],
    ['md',  '# Título\n- item `código`']
].forEach(function (par) {
    var fonte = par[1];
    var html = R.realcar(fonte, 'arquivo.' + par[0]);
    conferir(semTags(html) === fonte,
        par[0] + ': o texto volta idêntico depois de tirar as tags',
        'esperado: ' + JSON.stringify(fonte) + '\n         veio:     ' + JSON.stringify(semTags(html)));
});

console.log('\n--- 3. reconhece o que deve ---');

var js = R.realcar('var a = 1; // nota\nfunction somar() { return "txt"; }', 'x.js');
conferir(js.indexOf('r-cha') >= 0, 'JavaScript: marca palavra-chave');
conferir(js.indexOf('r-com') >= 0, 'JavaScript: marca comentário');
conferir(js.indexOf('r-txt') >= 0, 'JavaScript: marca texto entre aspas');
conferir(js.indexOf('r-fun') >= 0, 'JavaScript: marca chamada de função');

var sql = R.realcar("SELECT NOME FROM Z_TAB WHERE ID = 1", 'x.sql');
conferir(sql.indexOf('r-cha') >= 0, 'SQL: marca palavra-chave');

var ftl = R.realcar('<#if x>${valor}</#if>', 'view.ftl');
conferir(ftl.indexOf('r-ftl') >= 0, 'FTL: marca a diretiva do FreeMarker');

console.log('\n--- 4. a armadilha do comentário ---');

var truque = R.realcar('// aqui tem a palavra function e uma aspa " solta\nvar x = 1;', 'x.js');
var primeiraLinha = truque.split('\n')[0];
conferir(primeiraLinha.indexOf('r-cha') < 0 && primeiraLinha.indexOf('r-fun') < 0,
    'palavra-chave DENTRO de comentário não é marcada como código',
    'comentário e texto vêm primeiro na ordem das regras justamente por isso');
conferir(truque.split('\n')[1].indexOf('r-cha') >= 0,
    'e a aspa solta no comentário não desregula a linha seguinte',
    'sem a ordem certa, a aspa abriria um texto que engoliria o resto do arquivo');

console.log('\n--- 5. linguagem pela extensão ---');
[['a.js','js'], ['a.JS','js'], ['a.sql','sql'], ['view.ftl','html'],
 ['a.css','css'], ['a.json','json'], ['README.md','md'],
 ['a.xyz','texto'], ['semextensao','texto']].forEach(function (p) {
    conferir(R.linguagemDe(p[0]) === p[1], p[0] + ' -> ' + p[1], 'veio ' + R.linguagemDe(p[0]));
});

console.log('\n--- 6. TODA classe marcada tem cor no CSS ---');

/* Este bloco existe por causa de um bug real: uma edição do app.css apagou o
   trecho do realce inteiro. O JavaScript continuou marcando tudo certinho, os
   <span class="r-xxx"> continuaram no HTML - e a tela passou a mostrar TEXTO
   PURO, sem erro nenhum no console.

   É o pior tipo de defeito: silencioso dos dois lados. O teste fecha isso
   comparando quem produz a classe com quem pinta a classe. */
var css = fs.readFileSync(path.join(__dirname, '..', 'web', 'app.css'), 'utf8');

/* As classes que o realce realmente emite, tiradas do próprio arquivo. */
var fonteRealce = fs.readFileSync(path.join(__dirname, '..', 'web', 'realce.js'), 'utf8');
var emitidas = {};
(fonteRealce.match(/\['(\w+)',\s*'/g) || []).forEach(function (m) {
    emitidas[m.replace(/\['|',\s*'/g, '')] = true;
});

var faltando = Object.keys(emitidas).filter(function (c) {
    return css.indexOf('.r-' + c) < 0;
});

conferir(Object.keys(emitidas).length >= 8,
    'achei as classes que o realce emite (' + Object.keys(emitidas).length + ')',
    Object.keys(emitidas).join(' '));

conferir(faltando.length === 0,
    'TODA classe emitida pelo realce tem regra no app.css',
    faltando.length
        ? 'sem cor: ' + faltando.map(function (c) { return '.r-' + c; }).join(', ') +
          ' — o código apareceria como texto puro, sem erro nenhum'
        : '');

/* As classes estruturais do visor, que não vêm do realce mas somem junto. */
['.codigo', '.codigo__nums', '.codigo__texto', '.visor__diff', '.d__sinal', '.d--mais']
    .forEach(function (c) {
        conferir(css.indexOf(c) >= 0, 'o CSS tem ' + c,
            'sem ela o visor perde número de linha, fundo escuro ou alinhamento');
    });

console.log('');
console.log(falhas ? ('===== ' + falhas + ' FALHAS =====') : '===== todos passaram =====');
process.exit(falhas ? 1 : 0);
