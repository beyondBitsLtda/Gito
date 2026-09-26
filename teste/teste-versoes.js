/* Teste das VERSOES ANTIGAS, das branches e do enviar/trazer.

   A AFIRMACAO MAIS IMPORTANTE DESTE ARQUIVO

     "baixar uma versao antiga NAO altera nada na sua pasta"

   E a promessa que faz a funcao existir. Se ela deixar de ser verdade, alguem
   vai clicar em "baixar" achando que esta so olhando - e vai perder o trabalho
   do dia. O teste abaixo suja a working tree DE PROPOSITO antes de baixar, e
   confere depois que a sujeira continua lá, byte por byte.

   As outras duas travas testadas aqui sao da mesma familia: trocar de branch e
   trazer do servidor sao recusados com trabalho pendente, porque nos dois
   casos o que a pessoa fez pode ir junto para outro lugar - ou sumir.

   Rodar:  node teste/teste-versoes.js
*/
'use strict';

var fs = require('fs');
var os = require('os');
var path = require('path');
var child = require('child_process');

var git = require('../src/git');

var falhas = 0;
function conferir(condicao, descricao, detalhe) {
    if (condicao) console.log('ok     ' + descricao);
    else { console.log('FALHA  ' + descricao + (detalhe ? '\n         ' + detalhe : '')); falhas++; }
}

var TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'gito-versoes-'));
var REPO = path.join(TMP, 'projeto');
var SHA_ANTIGO = null;

function g(args) { return child.spawnSync('git', args, { cwd: REPO, encoding: 'utf8', windowsHide: true }); }

function preparar() {
    fs.mkdirSync(REPO, { recursive: true });
    child.spawnSync('git', ['init', '-q', '-b', 'main'], { cwd: REPO, windowsHide: true });
    g(['config', 'user.name', 'Teste Delp']);
    g(['config', 'user.email', 'teste@delp.com.br']);

    fs.writeFileSync(path.join(REPO, 'arquivo.txt'), 'VERSAO 1\n');
    g(['add', '-A']); g(['commit', '-q', '-m', 'primeira versao']);
    SHA_ANTIGO = g(['rev-parse', 'HEAD']).stdout.trim();

    fs.writeFileSync(path.join(REPO, 'arquivo.txt'), 'VERSAO 2\n');
    g(['add', '-A']); g(['commit', '-q', '-m', 'segunda versao']);

    g(['branch', 'experimento']);
}

function limpar() { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) {} }

preparar();

console.log('--- 1. histórico ---');

git.historico(REPO, 10)
    .then(function (h) {
        conferir(h.length === 2, 'lê os dois commits', 'veio ' + h.length);
        conferir(h[0].assunto === 'segunda versao', 'o mais recente vem primeiro');
        conferir(!!h[0].curto && h[0].curto.length >= 7, 'traz o sha curto, para a tela');
        conferir(!!h[0].autor && !!h[0].data, 'traz autor e data');

        console.log('\n--- 2. ler um arquivo de uma versão antiga ---');
        return git.arquivoDeCommit(REPO, SHA_ANTIGO, 'arquivo.txt');
    })
    .then(function (conteudo) {
        conferir(conteudo.indexOf('VERSAO 1') >= 0,
            'recupera o conteúdo antigo do arquivo', JSON.stringify(conteudo));

        console.log('\n--- 3. A PROMESSA: baixar NÃO mexe na pasta ---');

        /* Sujamos a working tree DE PROPOSITO. Se o download tocar na pasta,
           esta alteracao desaparece - e e exatamente o estrago que a funcao
           promete nao causar. */
        fs.writeFileSync(path.join(REPO, 'arquivo.txt'), 'TRABALHO DE HOJE, NAO SALVO\n');
        fs.writeFileSync(path.join(REPO, 'novo.txt'), 'arquivo novo de hoje\n');

        return new Promise(function (resolve, reject) {
            var proc = git.zipDaVersao(REPO, SHA_ANTIGO);
            var pedacos = [], erroGit = '';
            proc.stdout.on('data', function (d) { pedacos.push(d); });
            proc.stderr.on('data', function (d) { erroGit += d; });
            proc.on('close', function (codigo) {
                if (codigo !== 0) return reject(new Error(erroGit || 'git archive falhou'));
                resolve(Buffer.concat(pedacos));
            });
            proc.on('error', reject);
        });
    })
    .then(function (zip) {
        conferir(zip.length > 0, 'o zip tem conteúdo', zip.length + ' bytes');
        conferir(zip[0] === 0x50 && zip[1] === 0x4B,
            'é um zip de verdade (assinatura PK)',
            'primeiros bytes: ' + zip.slice(0, 4).toString('hex'));

        var agora = fs.readFileSync(path.join(REPO, 'arquivo.txt'), 'utf8');
        conferir(agora === 'TRABALHO DE HOJE, NAO SALVO\n',
            'O TRABALHO NÃO SALVO CONTINUA INTACTO depois de baixar a versão antiga',
            'veio: ' + JSON.stringify(agora));

        conferir(fs.existsSync(path.join(REPO, 'novo.txt')),
            'e o arquivo novo, que nem estava no commit, também continua lá');

        var head = g(['rev-parse', 'HEAD']).stdout.trim();
        conferir(head !== SHA_ANTIGO,
            'o HEAD continua na versão atual — baixar não move o repositório',
            'um checkout faria o HEAD pular para a versão antiga');

        console.log('\n--- 4. branches ---');
        return git.branches(REPO);
    })
    .then(function (bs) {
        conferir(bs.length === 2, 'lista as duas branches', JSON.stringify(bs.map(function (b) { return b.nome; })));
        var atual = bs.filter(function (b) { return b.atual; });
        conferir(atual.length === 1 && atual[0].nome === 'main',
            'marca qual é a atual', JSON.stringify(atual));

        console.log('\n--- 5. as travas de trabalho pendente ---');
        /* A working tree continua suja do teste 3. */
        return git.trocarBranch(REPO, 'experimento').then(
            function () { conferir(false, 'trocar de branch com trabalho pendente deveria ser recusado'); },
            function (e) {
                conferir(e.codigo === 'TRABALHO_PENDENTE',
                    'TROCAR DE BRANCH é recusado com trabalho pendente',
                    'o git levaria as alterações junto, e elas sumiriam da branch onde estavam');
            });
    })
    .then(function () {
        return git.trazer(REPO).then(
            function () { conferir(false, 'trazer com trabalho pendente deveria ser recusado'); },
            function (e) {
                conferir(e.codigo === 'TRABALHO_PENDENTE',
                    'TRAZER é recusado com trabalho pendente',
                    'o que vem do servidor pode esbarrar no que a pessoa mexeu');
            });
    })
    .then(function () {
        console.log('\n--- 6. depois de salvar, a troca passa ---');
        return git.salvar(REPO, 'salvando o trabalho de hoje', ['arquivo.txt', 'novo.txt'])
            .then(function () { return git.trocarBranch(REPO, 'experimento'); });
    })
    .then(function (st) {
        conferir(st.branch === 'experimento',
            'com tudo salvo, trocar de branch funciona', 'branch: ' + st.branch);

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
