/* Teste da porta unica para o git: os argumentos que toda chamada leva, e o
   interpretador do "status --porcelain=v2 -z".

   POR QUE O PARSER MERECE TESTE PROPRIO

   Ele decide QUAIS ARQUIVOS aparecem na tela. Um erro aqui nao quebra nada
   visivelmente - ele faz um arquivo sumir da lista, e a tela passa a dizer
   "tudo salvo" sobre um repositorio que tem trabalho pendente. E o pior modo
   de falhar que este app tem, porque a pessoa acredita e vai embora.

   E o formato tem uma armadilha: o caminho e o ULTIMO campo e PODE TER
   ESPACOS. Um split(' ') ingenuo corta "relatorio ção.txt" em dois e perde
   metade - justamente nos nomes que existem aqui.

   Rodar:  node teste/teste-git.js
*/
'use strict';

var git = require('../src/git');

var falhas = 0;
function conferir(condicao, descricao, detalhe) {
    if (condicao) console.log('ok     ' + descricao);
    else { console.log('FALHA  ' + descricao + (detalhe ? '\n         ' + detalhe : '')); falhas++; }
}

console.log('--- 1. os ajustes obrigatórios ---');

var a = git.AJUSTES.join(' ');

conferir(git.AJUSTES[0] === '--no-optional-locks',
    '--no-optional-locks vem PRIMEIRO, antes do subcomando',
    'é opção do git, não do "status" — depois dele o git para com "unknown option"');

conferir(a.indexOf('core.quotepath=false') >= 0,
    'core.quotepath=false',
    'sem ele, "relatório.txt" sai como "relat\\303\\263rio.txt"');

conferir(a.indexOf('core.longpaths=true') >= 0,
    'core.longpaths=true',
    'o limite de 260 caracteres do Windows — estoura em projeto Fluig com wcm/widget/...');

console.log('\n--- 2. o parser do status ---');

function nul(linhas) { return linhas.join('\u0000') + '\u0000'; }

var st = git.interpretarStatus(nul([
    '# branch.oid a1b2c3d4',
    '# branch.head main',
    '# branch.upstream origin/main',
    '# branch.ab +2 -1'
]));

conferir(st.branch === 'main', 'lê a branch');
conferir(st.sha === 'a1b2c3d4', 'lê o sha');
conferir(st.upstream === 'origin/main', 'lê o upstream');
conferir(st.ahead === 2 && st.behind === 1, 'lê o ahead/behind', st.ahead + '/' + st.behind);
conferir(!st.sujo, 'sem arquivo nenhum, não está sujo');

console.log('\n--- 3. A ARMADILHA: caminho com espaço ---');

st = git.interpretarStatus(nul([
    '# branch.oid a1',
    '# branch.head main',
    '1 .M N... 100644 100644 100644 aaa bbb relatório de ção.txt',
    '? arquivo novo com espaço.txt'
]));

conferir(st.alterados.length === 1 && st.alterados[0].caminho === 'relatório de ção.txt',
    'caminho com espaço E acento chega inteiro (tipo 1)',
    'veio: ' + JSON.stringify(st.alterados));

conferir(st.novos.length === 1 && st.novos[0].caminho === 'arquivo novo com espaço.txt',
    'caminho com espaço chega inteiro (não rastreado)',
    'veio: ' + JSON.stringify(st.novos));

console.log('\n--- 4. renomeado, apagado e conflito ---');

st = git.interpretarStatus(nul([
    '# branch.oid a1',
    '# branch.head main',
    '2 R. N... 100644 100644 100644 aaa bbb R100 nome novo.txt',
    'nome antigo.txt',
    '1 .D N... 100644 100644 100644 aaa bbb sumiu.txt',
    'u UU N... 100644 100644 100644 100644 aaa bbb ccc brigou.txt'
]));

conferir(st.alterados.length === 2,
    'renomeado conta uma vez só',
    'o caminho ORIGINAL vem num registro NUL extra, que não pode virar um segundo arquivo');

conferir(st.alterados.some(function (x) { return x.caminho === 'nome novo.txt'; }),
    'o renomeado traz o nome NOVO');

conferir(st.alterados.some(function (x) { return x.caminho === 'sumiu.txt' && x.estado === 'apagado'; }),
    'apagado é marcado como apagado');

conferir(st.conflitos.length === 1 && st.conflitos[0].caminho === 'brigou.txt',
    'conflito entra na lista própria — ele não pode virar "mais um alterado"',
    JSON.stringify(st.conflitos));

console.log('\n--- 5. estados sem commit e destacado ---');

st = git.interpretarStatus(nul(['# branch.oid (initial)', '# branch.head main']));
conferir(st.semCommit && st.sha === null, 'repositório sem nenhum commit');

st = git.interpretarStatus(nul(['# branch.oid a1', '# branch.head (detached)']));
conferir(st.destacado && st.branch === null,
    'HEAD destacado tem nome próprio',
    'senão a tela mostraria uma branch chamada "(detached)"');

console.log('\n--- 6. ignorado não é pendência ---');

st = git.interpretarStatus(nul([
    '# branch.oid a1', '# branch.head main',
    '! node_modules/pacote/x.js'
]));
conferir(!st.sujo && st.novos.length === 0,
    'arquivo ignorado pelo .gitignore não conta como pendência');

console.log('');
console.log(falhas ? ('===== ' + falhas + ' FALHAS =====') : '===== todos passaram =====');
process.exit(falhas ? 1 : 0);
