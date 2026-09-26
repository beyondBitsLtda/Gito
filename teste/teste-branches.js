/* Teste de branch <-> servidor: publicar, trazer outra branch, Merge Request.

   O "servidor" aqui e um repositorio bare numa pasta temporaria - o git trata
   igual a um GitLab para push, fetch e merge, e o teste nao depende de rede.

   AS TRES PERGUNTAS QUE ESTE ARQUIVO RESPONDE

   1. Criar branch e salvar sobem alguma coisa? NAO - e uma branch nova fica
      sem par no servidor ate ser PUBLICADA. Sem par, o git nao conta
      "salvamentos para enviar", e o Enviar ficava apagado para sempre.

   2. Trazer outra branch junta mesmo, e para quando da conflito? A main do
      servidor e buscada antes: juntar a copia velha seria juntar outra coisa.

   3. O link do Merge Request sai sem a credencial? Ele vai para o navegador,
      para o historico e para print de tela.

   Rodar:  node teste/teste-branches.js
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

var TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'gito-branches-'));
var SERVIDOR = path.join(TMP, 'servidor.git');
var EU = path.join(TMP, 'eu');                 /* o repositorio de quem usa o app */
var OUTRO = path.join(TMP, 'outro colega');    /* alguem que envia para a main */

function g(cwd, args) {
    var r = child.spawnSync('git', args, { cwd: cwd, encoding: 'utf8', windowsHide: true });
    if (r.status !== 0) throw new Error('git ' + args.join(' ') + ': ' + r.stderr);
    return r.stdout;
}
function identidade(repo) {
    g(repo, ['config', 'user.name', 'Teste Delp']);
    g(repo, ['config', 'user.email', 'teste@delp.com.br']);
}
function escrever(repo, nome, texto) { fs.writeFileSync(path.join(repo, nome), texto); }

function preparar() {
    fs.mkdirSync(SERVIDOR);
    g(SERVIDOR, ['init', '-q', '--bare', '-b', 'main']);

    fs.mkdirSync(EU);
    g(EU, ['init', '-q', '-b', 'main']);
    identidade(EU);
    escrever(EU, 'app.js', 'linha 1\nlinha 2\nlinha 3\n');
    g(EU, ['add', '-A']);
    g(EU, ['commit', '-q', '-m', 'inicial']);
    g(EU, ['remote', 'add', 'origin', SERVIDOR]);
    g(EU, ['push', '-q', '-u', 'origin', 'main']);
    /* O clone de verdade traz o origin/HEAD; aqui ele e criado a mao. */
    g(EU, ['remote', 'set-head', 'origin', 'main']);

    g(TMP, ['clone', '-q', SERVIDOR, OUTRO]);
    identidade(OUTRO);
}

function limpar() {
    try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* tudo bem */ }
}

preparar();

console.log('--- 1. o endereço do site sai do remoto, SEM credencial ---');

conferir(git.enderecoWeb('https://gitlab.com/desenvolviemento-fluig/administrativo/gestaooperacionalfs.git') ===
         'https://gitlab.com/desenvolviemento-fluig/administrativo/gestaooperacionalfs',
    'https com subgrupos');
conferir(git.enderecoWeb('https://brayan:glpat-SEGREDO@gitlab.com/g/p.git') === 'https://gitlab.com/g/p',
    'USUÁRIO E TOKEN EMBUTIDOS SAEM do endereço',
    'veio ' + git.enderecoWeb('https://brayan:glpat-SEGREDO@gitlab.com/g/p.git') +
    ' — ele vai para o navegador, o histórico dele e qualquer print');
conferir(git.enderecoWeb('git@gitlab.com:grupo/sub/projeto.git') === 'https://gitlab.com/grupo/sub/projeto',
    'endereço ssh (git@host:caminho) vira https');
conferir(git.enderecoWeb('ssh://git@gitlab.delp.com.br:2222/g/p.git') === 'https://gitlab.delp.com.br/g/p',
    'ssh:// com porta: a porta do ssh não vai para o site');
conferir(git.enderecoWeb('C:\\pasta\\local') === null, 'caminho local não vira site nenhum');

console.log('\n--- 2. branch nova é LOCAL até ser publicada ---');

g(EU, ['checkout', '-q', '-b', 'refatorar']);
escrever(EU, 'novo.js', 'feito na branch\n');
g(EU, ['add', '-A']);
g(EU, ['commit', '-q', '-m', 'trabalho na refatorar']);

git.status(EU)
    .then(function (st) {
        conferir(st.branch === 'refatorar' && !st.upstream,
            'criar e salvar NÃO sobem nada: a branch não tem par no servidor');
        conferir(st.ahead === 0,
            'e sem par o git conta 0 "para enviar" — era por isso que o Enviar ficava apagado',
            'ahead=' + st.ahead);
        return git.branches(EU);
    })
    .then(function (lista) {
        var r = lista.filter(function (b) { return b.nome === 'refatorar'; })[0];
        var m = lista.filter(function (b) { return b.nome === 'main'; })[0];
        conferir(r && !r.publicada, 'a lista diz que "refatorar" só está neste computador');
        conferir(m && m.publicada, 'e que "main" está no servidor');
        return git.linkMergeRequest(EU, 'refatorar', 'main').then(
            function () { conferir(false, 'MR de branch não publicada deveria ser recusado'); },
            function (e) {
                conferir(e.codigo === 'NAO_PUBLICADA',
                    'Merge Request de branch que o servidor não tem é recusado, com o motivo',
                    e.message);
            });
    })
    .then(function () {
        return git.publicarBranch(EU, '--force');
    })
    .then(function () { conferir(false, 'nome de branch começando com "-" deveria ser recusado'); },
          function (e) { conferir(!/force/i.test(e.message) || /inválido/i.test(e.message),
              'nome que começa com "-" não vira opção do push', e.message); })
    .then(function () {
        return git.publicarBranch(EU, 'refatorar');
    })
    .then(function (st) {
        conferir(st.upstream === 'origin/refatorar', 'PUBLICAR cria a branch no servidor e amarra as duas',
            'upstream=' + st.upstream);
        var noServidor = g(SERVIDOR, ['branch', '--format=%(refname:short)']);
        conferir(/refatorar/.test(noServidor), 'e ela existe de fato lá', noServidor.trim());
        return git.branchesRemotas(EU);
    })
    .then(function (r) {
        conferir(r.lista.indexOf('main') >= 0 && r.lista.indexOf('refatorar') >= 0,
            'branches do servidor listadas', JSON.stringify(r.lista));
        conferir(r.lista.indexOf('HEAD') < 0, 'o apelido HEAD não aparece como branch');
        conferir(r.padrao === 'main', 'a branch principal do projeto é reconhecida', r.padrao);

        console.log('\n--- 3. o link do Merge Request ---');
        return git.linkMergeRequest(EU, 'refatorar', 'main');
    })
    .then(function () { conferir(false, 'remoto em pasta local não deveria virar link'); },
          function (e) {
              conferir(!/servidor\.git|gito-branches/.test(e.message),
                  'remoto que não é site é recusado SEM repetir o endereço na mensagem', e.message);
          })
    .then(function () {
        /* Troca o remoto por um endereço do GitLab COM token, só para montar o
           link (nada é enviado para lá). */
        g(EU, ['remote', 'set-url', 'origin', 'https://brayan:glpat-SEGREDO@gitlab.com/g/projeto.git']);
        return git.linkMergeRequest(EU, 'refatorar', 'main');
    })
    .then(function (r) {
        g(EU, ['remote', 'set-url', 'origin', SERVIDOR]);
        conferir(r.url === 'https://gitlab.com/g/projeto/-/merge_requests/new?' +
                           'merge_request%5Bsource_branch%5D=refatorar&merge_request%5Btarget_branch%5D=main',
            'o link abre o MR já com origem e destino preenchidos', r.url);
        conferir(r.url.indexOf('glpat') < 0 && r.url.indexOf('brayan') < 0,
            'O TOKEN DO REMOTO NÃO VAI PARA O LINK');

        console.log('\n--- 4. trazer a main do servidor para a minha branch ---');

        /* O colega envia para a main, numa linha que eu não mexi. */
        g(OUTRO, ['pull', '-q']);
        escrever(OUTRO, 'app.js', 'linha 1 do colega\nlinha 2\nlinha 3\n');
        g(OUTRO, ['commit', '-q', '-am', 'colega mexeu na linha 1']);
        g(OUTRO, ['push', '-q']);

        escrever(EU, 'pendente.txt', 'não salvei\n');
        return git.trazerBranch(EU, 'origin/main');
    })
    .then(function () { conferir(false, 'trazer com trabalho pendente deveria ser recusado'); },
          function (e) {
              conferir(e.codigo === 'TRABALHO_PENDENTE', 'com trabalho não salvo, trazer é recusado', e.message);
              fs.unlinkSync(path.join(EU, 'pendente.txt'));
          })
    .then(function () {
        return git.trazerBranch(EU, '--abort').then(
            function () { conferir(false, 'nome inventado deveria ser recusado'); },
            function (e) { conferir(/não existe/.test(e.message),
                'nome que não está na lista não chega ao git (nem "--abort")', e.message); });
    })
    .then(function () {
        return git.trazerBranch(EU, 'origin/main');
    })
    .then(function (r) {
        conferir(r.juntou && !r.jaEstava, 'a main do servidor é trazida e juntada', r.saida);
        var app = fs.readFileSync(path.join(EU, 'app.js'), 'utf8');
        conferir(/do colega/.test(app),
            'A MAIN FOI BUSCADA ANTES: chegou o que o colega enviou depois da última leitura',
            'sem o fetch, juntaria a cópia velha e a pessoa acharia que está em dia');
        conferir(fs.existsSync(path.join(EU, 'novo.js')), 'e o trabalho da minha branch continua aqui');
        return git.trazerBranch(EU, 'origin/main');
    })
    .then(function (r) {
        conferir(r.juntou && r.jaEstava, 'trazer de novo avisa que já estava tudo aqui');

        console.log('\n--- 5. conflito cai na tela de decidir ---');

        g(EU, ['checkout', '-q', '-b', 'outra', 'main']);
        escrever(EU, 'app.js', 'linha 1 da OUTRA\nlinha 2\nlinha 3\n');
        g(EU, ['commit', '-q', '-am', 'outra mexeu na linha 1']);
        g(EU, ['checkout', '-q', 'refatorar']);
        return git.trazerBranch(EU, 'outra');
    })
    .then(function (r) {
        conferir(!r.juntou && r.conflitos.indexOf('app.js') >= 0,
            'mesma linha mexida dos dois lados volta como conflito, com o arquivo',
            JSON.stringify(r));
        return git.abortarJuncao(EU);
    })
    .then(function (st) {
        conferir(!st.emConflito && !st.sujo, '"Desfazer a junção" devolve a branch como estava');
        return git.trazerBranch(EU, 'refatorar').then(
            function () { conferir(false, 'trazer a própria branch deveria ser recusado'); },
            function (e) { conferir(/já é a branch/.test(e.message), 'trazer a branch em que se está é recusado'); });
    })
    .then(function () {
        console.log('\n--- 6. apagado aqui, alterado lá (o caso do ESTRUTURA.MD) ---');

        /* A refatoração apagou o arquivo; a outra branch mexeu nele. "Ficar
           com o meu" é confirmar a exclusão - e não há versão "minha" para o
           checkout --ours restaurar. */
        escrever(EU, 'ESTRUTURA.MD', 'estrutura antiga\n');
        g(EU, ['add', '-A']); g(EU, ['commit', '-q', '-m', 'estrutura']);
        g(EU, ['branch', 'dev2']);
        g(EU, ['rm', '-q', 'ESTRUTURA.MD']); g(EU, ['commit', '-q', '-m', 'refatoração apaga']);
        g(EU, ['checkout', '-q', 'dev2']);
        escrever(EU, 'ESTRUTURA.MD', 'estrutura antiga \n');
        g(EU, ['commit', '-q', '-am', 'teste']);
        g(EU, ['checkout', '-q', 'refatorar']);
        return git.trazerBranch(EU, 'dev2');
    })
    .then(function (r) {
        conferir(!r.juntou && r.conflitos.indexOf('ESTRUTURA.MD') >= 0,
            'apagado de um lado e alterado do outro vira conflito', JSON.stringify(r.conflitos));
        return git.resolverConflito(EU, 'ESTRUTURA.MD', 'meu');
    })
    .then(function (st) {
        conferir(!st.emConflito, '"FICAR COM O MEU" CONFIRMA A EXCLUSÃO, sem "does not have our version"');
        conferir(!fs.existsSync(path.join(EU, 'ESTRUTURA.MD')), 'e o arquivo continua apagado');

        /* O estado em que o botão "Concluir" sumia: nada pendente, nenhum
           conflito, e o merge ainda aberto. */
        conferir(st.juntando && !st.sujo,
            'SEM CONFLITO E SEM PENDÊNCIA, A JUNÇÃO AINDA É VISTA COMO ABERTA',
            'juntando=' + st.juntando + ' sujo=' + st.sujo +
            ' — sem isto a tela dizia "tudo salvo" e o botão de concluir sumia');
        return git.trazerBranch(EU, 'dev2').then(
            function () { conferir(false, 'trazer com junção aberta deveria ser recusado'); },
            function (e) {
                conferir(e.codigo === 'JUNCAO_ABERTA',
                    'trazer por cima da junção aberta é recusado em português, dizendo o que fazer',
                    e.message);
            });
    })
    .then(function () {
        return git.concluirJuncao(EU);
    })
    .then(function (c) {
        conferir(!!c && /Merge branch 'dev2'/.test(c.assunto),
            'a junção é concluída com a mensagem do merge, não com uma frase sobre "servidor"',
            c && c.assunto);
        return git.status(EU);
    })
    .then(function (st) {
        conferir(!st.juntando, 'e depois de concluída não fica nada aberto');

        console.log('\n--- 7. baixar uma branch que só existe no servidor ---');

        g(OUTRO, ['checkout', '-q', '-b', 'feature-colega']);
        escrever(OUTRO, 'colega.js', 'do colega\n');
        g(OUTRO, ['add', '-A']); g(OUTRO, ['commit', '-q', '-m', 'feature do colega']);
        g(OUTRO, ['push', '-q', '-u', 'origin', 'feature-colega']);
        return git.branchesRemotas(EU);
    })
    .then(function (r) {
        conferir(r.lista.indexOf('feature-colega') < 0,
            'a branch nova do colega ainda não aparece: a lista é da última conversa com o servidor');
        return git.atualizarDoServidor(EU);
    })
    .then(function (r) {
        conferir(r.lista.indexOf('feature-colega') >= 0, '"Atualizar do servidor" faz ela aparecer',
            JSON.stringify(r.lista));

        /* Trabalho pendente NÃO impede baixar: baixar não mexe na pasta. */
        escrever(EU, 'rascunho.txt', 'não salvo\n');
        return git.baixarBranch(EU, 'feature-colega');
    })
    .then(function (lista) {
        var b = lista.filter(function (x) { return x.nome === 'feature-colega'; })[0];
        conferir(b && b.publicada && b.upstream === 'origin/feature-colega',
            'BAIXAR cria a branch aqui já ligada à do servidor', JSON.stringify(b));
        conferir(b && !b.atual, 'e NÃO troca para ela');
        conferir(fs.existsSync(path.join(EU, 'rascunho.txt')) && !fs.existsSync(path.join(EU, 'colega.js')),
            'a pasta fica intocada: o rascunho continua, e o arquivo da outra branch não aparece',
            'baixar não pode ter efeito colateral no que a pessoa está fazendo');
        return git.baixarBranch(EU, 'feature-colega');
    })
    .then(function () { conferir(false, 'baixar de novo deveria ser recusado'); },
          function (e) {
              conferir(e.codigo === 'BRANCH_EXISTE', 'baixar o que já existe aqui é recusado, dizendo o que usar',
                       e.message);
              return git.baixarBranch(EU, 'nao-existe-la');
          })
    .then(function () { conferir(false, 'baixar branch inexistente deveria falhar'); },
          function (e) {
              conferir(e.codigo === 'NAO_EXISTE', 'branch que o servidor não tem: diz isso, em português',
                       e.message);
              fs.unlinkSync(path.join(EU, 'rascunho.txt'));
          })
    .then(function () {
        limpar();
        console.log('');
        console.log(falhas ? ('===== ' + falhas + ' FALHAS =====') : '===== todos passaram =====');
        process.exit(falhas ? 1 : 0);
    }, function (e) {
        limpar();
        console.log('FALHA  erro inesperado: ' + (e.stack || e.message));
        process.exit(1);
    });
