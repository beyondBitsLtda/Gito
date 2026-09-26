/* Teste do fluxo de SALVAR, contra um repositorio git de verdade.

   Ele cria um repositorio temporario, mexe nele, e exercita o caminho inteiro:
   status -> lista de arquivos -> add dos escolhidos -> commit.

   O QUE ELE PROTEGE

   1. SO OS ARQUIVOS ESCOLHIDOS ENTRAM. Se o app mandasse "add ." ou "add -A",
      um arquivo que a pessoa DESMARCOU entraria no commit - e ela so
      descobriria depois, se descobrisse. Desmarcar tem de significar alguma
      coisa.

   2. NOME COM ESPACO E ACENTO ATRAVESSA INTEIRO. Os caminhos daqui tem os
      dois ("Depto Tecnologia da Informacao", "22 - Repositorios"), e um
      parser que quebra no espaco perde arquivos da lista em silencio - o pior
      desfecho, porque a tela diz "tudo salvo".

   3. MENSAGEM VAZIA E RECUSADA. Commit sem mensagem util e um commit que
      ninguem consegue ler depois.

   Rodar:  node teste/teste-salvar.js
*/
'use strict';

var fs = require('fs');
var os = require('os');
var path = require('path');
var child = require('child_process');

var git = require('../src/git');
var repos = require('../src/repos');

var falhas = 0;
function conferir(condicao, descricao, detalhe) {
    if (condicao) console.log('ok     ' + descricao);
    else { console.log('FALHA  ' + descricao + (detalhe ? '\n         ' + detalhe : '')); falhas++; }
}

var TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'gito-salvar-'));
var REPO = path.join(TMP, 'app teste');          /* espaco no nome, de proposito */

function gitSync(args) {
    return child.spawnSync('git', args, { cwd: REPO, encoding: 'utf8', windowsHide: true });
}

function preparar() {
    fs.mkdirSync(REPO, { recursive: true });
    child.spawnSync('git', ['init', '-q', '-b', 'main'], { cwd: REPO, windowsHide: true });
    gitSync(['config', 'user.name', 'Teste Delp']);
    gitSync(['config', 'user.email', 'teste@delp.com.br']);
    fs.writeFileSync(path.join(REPO, 'base.txt'), 'inicial\n');
    gitSync(['add', '-A']);
    gitSync(['commit', '-q', '-m', 'commit inicial']);
}

function limpar() {
    try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* tudo bem */ }
}

preparar();

console.log('--- 1. o estado inicial ---');

repos.detalhe(REPO)
    .then(function (d) {
        conferir(d.branch === 'main', 'lê a branch atual', 'veio: ' + d.branch);
        conferir(!d.sujo, 'repositório recém-commitado aparece limpo');
        conferir(!!d.ultimoCommit && d.ultimoCommit.assunto === 'commit inicial',
            'lê o último commit');

        console.log('\n--- 2. arquivos com espaço e acento ---');
        fs.writeFileSync(path.join(REPO, 'base.txt'), 'inicial\nmudou\n');
        fs.writeFileSync(path.join(REPO, 'relatório ção.txt'), 'novo com acento\n');
        fs.writeFileSync(path.join(REPO, 'deixar de fora.txt'), 'nao deve entrar\n');
        return repos.detalhe(REPO);
    })
    .then(function (d) {
        var nomes = d.alterados.concat(d.novos).map(function (a) { return a.caminho; });

        conferir(nomes.indexOf('base.txt') >= 0, 'vê o arquivo alterado');
        conferir(nomes.indexOf('relatório ção.txt') >= 0,
            'NOME COM ESPAÇO E ACENTO chega inteiro na lista',
            'veio: ' + JSON.stringify(nomes));
        conferir(nomes.indexOf('deixar de fora.txt') >= 0, 'vê o outro arquivo novo');
        conferir(d.novos.length === 2 && d.alterados.length === 1,
            'separa "alterado" de "novo"',
            'alterados=' + d.alterados.length + ' novos=' + d.novos.length);

        console.log('\n--- 3. o que é recusado ---');
        return git.salvar(REPO, '   ', ['base.txt']).then(
            function () { conferir(false, 'mensagem em branco deveria ser recusada'); },
            function (e) { conferir(/escreva/i.test(e.message), 'mensagem em branco é recusada', e.message); });
    })
    .then(function () {
        return git.salvar(REPO, 'mensagem boa', []).then(
            function () { conferir(false, 'salvar sem arquivo deveria ser recusado'); },
            function (e) { conferir(/escolha/i.test(e.message), 'salvar sem nenhum arquivo é recusado', e.message); });
    })
    .then(function () {
        console.log('\n--- 4. salvar só os escolhidos ---');
        return git.salvar(REPO, 'mexi no base e no relatório', ['base.txt', 'relatório ção.txt']);
    })
    .then(function (commit) {
        conferir(!!commit && commit.assunto === 'mexi no base e no relatório',
            'o commit é criado com a mensagem digitada',
            commit && commit.assunto);
        conferir(commit.autor === 'Teste Delp', 'o commit sai com a autoria configurada');

        var arquivos = gitSync(['show', '--name-only', '--format=', 'HEAD']).stdout || '';
        conferir(arquivos.indexOf('base.txt') >= 0 && arquivos.indexOf('relat') >= 0,
            'os dois arquivos escolhidos entraram no commit');
        conferir(arquivos.indexOf('deixar de fora') < 0,
            'O ARQUIVO DESMARCADO NÃO ENTROU',
            'um "add -A" no lugar do "add <arquivos>" levaria junto o que a pessoa tirou');

        return repos.detalhe(REPO);
    })
    .then(function (d) {
        conferir(d.sujo && d.novos.length === 1,
            'depois de salvar, sobra só o que ficou de fora',
            'novos=' + d.novos.length);

        console.log('\n--- 4a. exclusão JÁ PREPARADA fora do app ---');

        /* O caso do gestaooperacionalfs: um "git rm" (ou o VS Code) já pôs a
           exclusão no índice. O arquivo não existe nem no disco nem no índice,
           e "git add -- ele" aborta com "pathspec did not match any files" -
           levando junto o salvamento de tudo o que foi escolhido. */
        gitSync(['rm', '-q', 'base.txt']);
        fs.appendFileSync(path.join(REPO, 'relatório ção.txt'), 'mais\n');
        return git.salvar(REPO, 'apaguei o base', ['base.txt', 'relatório ção.txt']).then(
            function (commit) {
                var arquivos = gitSync(['show', '--name-status', '--format=', 'HEAD']).stdout || '';
                conferir(!!commit && /D\s+base\.txt/.test(arquivos) && arquivos.indexOf('relat') >= 0,
                    'salva a exclusão já preparada junto com o resto, sem "pathspec did not match"',
                    arquivos);
            },
            function (e) {
                conferir(false, 'salvar com exclusão já preparada', e.message);
            });
    })
    .then(function () {
        console.log('\n--- 4b. A ARMADILHA DO DFS: pasta que não é "pasta" ---');

        /* No Z: da DELP, as pastas de primeiro nível são reparse points de DFS:
           isDirectory() devolve FALSE e isSymbolicLink() devolve true. Um
           filtro só com isDirectory() faz o Z: inteiro aparecer VAZIO - sem
           erro, sem aviso, some.

           Uma junction do Windows reproduz o mesmo comportamento, e não
           precisa de privilégio para criar. */
        var real = path.join(TMP, 'destino-real');
        var atalho = path.join(TMP, 'via-junction');
        fs.mkdirSync(real, { recursive: true });
        fs.writeFileSync(path.join(real, 'codigo.js'), '// dentro do destino\n');

        var temJunction = true;
        try { fs.symlinkSync(real, atalho, 'junction'); }
        catch (e) { temJunction = false; }

        if (!temJunction) {
            console.log('(pulado) este sistema não deixou criar junction');
            return null;
        }

        var ent = fs.readdirSync(TMP, { withFileTypes: true })
                    .filter(function (d) { return d.name === 'via-junction'; })[0];
        conferir(ent && !ent.isDirectory() && ent.isSymbolicLink(),
            'a junction se comporta como o DFS: isDirectory() é FALSE',
            'se este teste falhar, o sistema mudou e o cenário deixou de reproduzir o Z:');

        return repos.listar([TMP]).then(function (lista) {
            var achou = lista.filter(function (r) { return r.nome === 'via-junction'; })[0];
            conferir(!!achou,
                'e MESMO ASSIM a varredura enxerga a pasta',
                'com um filtro por isDirectory(), o Z: inteiro apareceria vazio — ' +
                'sem erro e sem aviso, o que faria a pessoa concluir que não há nada lá');
        });
    })
    .then(function () {
        console.log('\n--- 5. pasta que não é repositório ---');
        var semGit = path.join(TMP, 'pasta solta');
        fs.mkdirSync(semGit, { recursive: true });
        fs.writeFileSync(path.join(semGit, 'codigo.js'), '// nunca versionado\n');
        return repos.listar([TMP]);
    })
    .then(function (lista) {
        var solta = lista.filter(function (r) { return r.nome === 'pasta solta'; })[0];
        conferir(!!solta && !solta.versionado,
            'pasta com código e sem .git aparece como NÃO VERSIONADA',
            'é o achado mais importante da lista — some com a máquina');

        var app = lista.filter(function (r) { return r.nome === 'app teste'; })[0];
        conferir(!!app && app.versionado && app.branch === 'main',
            'e o repositório de verdade aparece com a branch');

        console.log('');
        console.log(falhas ? ('===== ' + falhas + ' FALHAS =====') : '===== todos passaram =====');
        limpar();
        process.exit(falhas ? 1 : 0);
    })
    .catch(function (e) {
        console.error('o teste estourou: ' + (e && e.stack || e));
        limpar();
        process.exit(1);
    });
