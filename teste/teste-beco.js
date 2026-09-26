/* O BECO SEM SAÍDA, e a saída dele.

   O QUE ACONTECEU DE VERDADE

   Uma pessoa tentou enviar o trabalho e recebeu, em sequência:

     enviar  ->  "há trabalho novo no servidor. Use Trazer antes de enviar."
     trazer  ->  "salve o que está pendente antes de trazer."
     salvar  ->  "On branch main"           (e nada era salvo)
     enviar  ->  ... de novo, para sempre.

   A causa: a pasta listada como alterada era um SUBMÓDULO — um repositório
   dentro do repositório. O ponteiro dele não tinha mudado, então não havia
   nada para salvar ali; mas ele contava como "sujo", e o sujo travava o
   trazer. Salvar nunca limpava, porque não havia o que salvar.

   Nada disso dava erro. Cada passo estava "certo" isoladamente, e juntos
   formavam um ciclo fechado — o pior tipo de defeito, porque a pessoa conclui
   que não sabe usar a ferramenta.

   Estes testes usam repositórios git DE VERDADE, criados numa pasta
   temporária. Dublar o git aqui testaria o dublê: o comportamento em questão
   é o do git com submódulo, que é justamente o que ninguém tinha na cabeça.

   Rodar:  node teste/teste-beco.js
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

var TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'delp-beco-'));

function rodar(args, cwd) {
    var r = child.spawnSync('git', args, { cwd: cwd, encoding: 'utf8', windowsHide: true });
    return (r.stdout || '') + (r.stderr || '');
}

function novoRepo(nome) {
    var p = path.join(TMP, nome);
    fs.mkdirSync(p, { recursive: true });
    rodar(['init', '-b', 'main'], p);
    rodar(['config', 'user.name', 'Teste'], p);
    rodar(['config', 'user.email', 'teste@delp.com.br'], p);
    rodar(['config', 'commit.gpgsign', 'false'], p);
    return p;
}

function gravar(repo, rel, texto) {
    var alvo = path.join(repo, rel);
    fs.mkdirSync(path.dirname(alvo), { recursive: true });
    fs.writeFileSync(alvo, texto, 'utf8');
}

/* ========================================================================== */
console.log('--- 1. O SUBMÓDULO É RECONHECIDO ---');

var PAI = novoRepo('pai');
gravar(PAI, 'leia-me.txt', 'repositorio de fora\n');
rodar(['add', '.'], PAI);
rodar(['commit', '-m', 'inicio'], PAI);

/* Um repositório DENTRO do outro — exatamente o caso real. */
var DENTRO = path.join(PAI, 'interno');
fs.mkdirSync(DENTRO, { recursive: true });
rodar(['init', '-b', 'main'], DENTRO);
rodar(['config', 'user.name', 'Teste'], DENTRO);
rodar(['config', 'user.email', 'teste@delp.com.br'], DENTRO);
rodar(['config', 'commit.gpgsign', 'false'], DENTRO);
gravar(DENTRO, 'codigo.js', 'var a = 1;\n');
rodar(['add', '.'], DENTRO);
rodar(['commit', '-m', 'inicio de dentro'], DENTRO);

/* O pai registra o ponteiro. Daqui em diante ele é um gitlink. */
rodar(['add', 'interno'], PAI);
rodar(['commit', '-m', 'registra o interno'], PAI);

/* Agora alguém mexe DENTRO, sem salvar lá. É o estado do print. */
gravar(DENTRO, 'codigo.js', 'var a = 2;  // mexido e nao salvo\n');
gravar(DENTRO, 'novo.txt', 'arquivo novo aqui dentro\n');

git.status(PAI).then(function (st) {
    var sub = st.alterados.filter(function (a) { return a.submodulo; })[0];

    conferir(!!sub, 'a pasta com repositório próprio é reconhecida como submódulo',
        JSON.stringify(st.alterados));

    conferir(sub && sub.submodulo.commitNovo === false,
        'e o app sabe que NÃO há commit novo para registrar aqui fora',
        'é este bit que diz se "Salvar" tem o que fazer — sem ele, o app manda ' +
        'a pessoa salvar para sempre');

    conferir(sub && sub.estado === 'repositório próprio',
        'o rótulo na tela diz o que aquilo é, não "alterado"',
        'veio "' + (sub && sub.estado) + '"');

    console.log('\n--- 2. O CICLO ESTÁ QUEBRADO ---');

    conferir(st.sujo === true, 'o repositório continua "sujo" (o git diz isso)');
    conferir(st.pendenciaReal === 0,
        'MAS A PENDÊNCIA REAL É ZERO — e é ela que trava o trazer',
        'veio ' + st.pendenciaReal + '. Enquanto o bloqueio olhava o "sujo" cru, ' +
        'trazer era recusado para sempre e não havia como sair');

    return git.salvar(PAI, 'tentando salvar', ['interno']).then(function () {
        conferir(false, 'salvar um submódulo sem commit novo devia ser recusado');
    }, function (e) {
        console.log('\n--- 3. A MENSAGEM QUE A PESSOA RECEBE ---');

        conferir(!/on branch/i.test(e.message),
            'NÃO diz mais "On branch main"',
            'veio: ' + e.message);

        conferir(e.codigo === 'SUBMODULO',
            'o erro é identificado como submódulo', 'veio ' + e.codigo);

        conferir(/repositório próprio/i.test(e.message) && /DENTRO/i.test(e.message),
            'e explica onde a alteração precisa ser salva',
            'veio: ' + e.message);
    });
})
/* ========================================================================== */
.then(function () {
    console.log('\n--- 4. a primeira linha útil ---');

    conferir(git.primeiraLinhaUtil('On branch main\nnothing to commit, working tree clean') ===
             'nothing to commit, working tree clean',
        'pula "On branch" e entrega a linha que explica');

    conferir(git.primeiraLinhaUtil(
        'On branch main\nYour branch is ahead of \'origin/main\' by 1 commit.\n' +
        '  (use "git push" to publish)\nnothing to commit') === 'nothing to commit',
        'pula também o "Your branch is ahead" e as dicas entre parênteses');

    conferir(git.primeiraLinhaUtil('error: pathspec \'x\' did not match') ===
             'pathspec \'x\' did not match',
        'tira o prefixo "error:" — ele não acrescenta nada para quem lê');

    conferir(git.primeiraLinhaUtil('hint: use git pull\nfatal: refusing to merge') ===
             'refusing to merge',
        'pula "hint:" e pega o que de fato falhou');
})

/* ========================================================================== */
.then(function () {
    console.log('\n--- 5. criar repositório e ramo ---');

    var VAZIA = path.join(TMP, 'nova');
    fs.mkdirSync(VAZIA, { recursive: true });

    return git.criarRepositorio(VAZIA, 'main').then(function (st) {
        conferir(st.branch === 'main',
            'o repositório novo nasce no ramo "main"',
            'veio "' + st.branch + '" — sem -b o nome vem da config da máquina e ' +
            'varia entre master e main');
        conferir(fs.existsSync(path.join(VAZIA, '.git')), 'e o .git existe');

        /* De novo na mesma pasta: tem de recusar, não "criar" por cima. */
        return git.criarRepositorio(VAZIA, 'main').then(function () {
            conferir(false, 'criar sobre repositório existente devia ser recusado');
        }, function (e) {
            conferir(e.codigo === 'JA_E_REPO',
                'criar de novo na mesma pasta é recusado', e.message);
        });
    });
})

.then(function () {
    /* Um ramo precisa de pelo menos um commit para nascer. */
    return git.criarBranch(PAI, 'minha-tarefa').then(function (st) {
        conferir(st.branch === 'minha-tarefa',
            'o ramo novo é criado E a pessoa já está nele',
            'veio "' + st.branch + '" — quem cria um ramo quer trabalhar nele em seguida');

        return git.criarBranch(PAI, 'minha-tarefa').then(function () {
            conferir(false, 'ramo repetido devia ser recusado');
        }, function (e) {
            conferir(e.codigo === 'BRANCH_EXISTE', 'ramo com nome repetido é recusado', e.message);
        });
    });
})

.then(function () {
    var ruins = ['', '  ', 'com espaco', 'til~aqui', 'dois::pontos', '.comeca-com-ponto',
                 'termina.', 'tem..dois', 'barra/', '/barra', 'a\\b', '@'];
    var todosRecusados = ruins.every(function (n) { return !!git.nomeDeBranchInvalido(n); });
    conferir(todosRecusados,
        'nomes de ramo que o git recusaria são barrados ANTES, em português',
        'a mensagem do git é "is not a valid ref name", que não ajuda ninguém');

    conferir(!git.nomeDeBranchInvalido('correcao-do-login') &&
             !git.nomeDeBranchInvalido('feature/relatorio-2026'),
        'e os nomes bons passam');
})

/* ========================================================================== */
.then(function () {
    console.log('\n--- 6. CONFLITO: abrir, resolver, concluir ---');

    /* Dois clones do mesmo repositório, cada um mexendo na MESMA linha. É a
       situação que gera conflito de verdade. */
    var CENTRAL = path.join(TMP, 'central.git');
    rodar(['init', '--bare', '-b', 'main', CENTRAL], TMP);

    var A = novoRepo('clone-a');
    rodar(['remote', 'add', 'origin', CENTRAL], A);
    gravar(A, 'texto.txt', 'linha original\n');
    rodar(['add', '.'], A);
    rodar(['commit', '-m', 'inicio'], A);
    rodar(['push', '-u', 'origin', 'main'], A);

    var B = path.join(TMP, 'clone-b');
    rodar(['clone', CENTRAL, B], TMP);
    rodar(['config', 'user.name', 'Outra'], B);
    rodar(['config', 'user.email', 'outra@delp.com.br'], B);
    rodar(['config', 'commit.gpgsign', 'false'], B);

    /* B muda e envia. */
    gravar(B, 'texto.txt', 'mudanca de QUEM ESTAVA NO SERVIDOR\n');
    rodar(['add', '.'], B);
    rodar(['commit', '-m', 'mudanca do outro'], B);
    rodar(['push'], B);

    /* A muda a MESMA linha, sem trazer antes. */
    gravar(A, 'texto.txt', 'mudanca de QUEM ESTA AQUI\n');
    rodar(['add', '.'], A);
    rodar(['commit', '-m', 'minha mudanca'], A);

    /* Trazer tem de acusar divergência, não travar em silêncio. */
    return git.trazer(A).then(function () {
        conferir(false, 'trazer com histórias divergentes devia acusar');
    }, function (e) {
        conferir(e.codigo === 'DIVERGIU',
            'trazer avisa que as duas histórias seguiram caminhos diferentes', e.message);
        conferir(!/^(on branch|hint:)/i.test(e.message),
            'e a mensagem não é resmungo cru do git', e.message);

        return git.juntar(A);
    }).then(function (r) {
        conferir(r.juntou === false && r.conflitos.indexOf('texto.txt') >= 0,
            'juntar abre o conflito e DIZ qual arquivo está em conflito',
            JSON.stringify(r));

        return git.status(A);
    }).then(function (st) {
        conferir(st.emConflito === true, 'o status sabe que há conflito aberto');

        /* Resolver ficando com o lado de cá. */
        return git.resolverConflito(A, 'texto.txt', 'meu');
    }).then(function (st) {
        conferir(st.conflitos.length === 0, 'depois de resolver, não há mais conflito');

        /* O fim de linha é normalizado na comparação: no Windows o git
           converte LF em CRLF ao gravar o arquivo de volta, e isso é dele,
           não do que estamos testando aqui. */
        var ficou = fs.readFileSync(path.join(A, 'texto.txt'), 'utf8').replace(/\r\n/g, '\n');
        conferir(ficou === 'mudanca de QUEM ESTA AQUI\n',
            '"meu" mantém o que estava aqui', JSON.stringify(ficou));

        return git.concluirJuncao(A, 'junta o do servidor com o meu');
    }).then(function (c) {
        conferir(!!c && !!c.sha, 'a junção é fechada com um salvamento', JSON.stringify(c));

        return git.status(A);
    }).then(function (st) {
        conferir(st.pendenciaReal === 0 && !st.emConflito,
            'e o repositório volta a ficar limpo — o ciclo TEM saída',
            JSON.stringify({ pendencia: st.pendenciaReal, conflito: st.emConflito }));
    });
})

/* ========================================================================== */
.then(function () {
    console.log('');
    console.log(falhas ? ('===== ' + falhas + ' FALHAS =====') : '===== todos passaram =====');
    try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* paciência */ }
    process.exit(falhas ? 1 : 0);
})
.catch(function (e) {
    console.error('o teste estourou: ' + (e && e.stack || e));
    try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (x) {}
    process.exit(1);
});
