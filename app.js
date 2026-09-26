#!/usr/bin/env node
/* ============================================================================
   Gito - versionar o trabalho sem terminal e sem saber git
   ============================================================================
   Uso:

       node app.js                 escolhe uma porta livre e abre o navegador
       node app.js --porta 7027    noutra porta fixa
       node app.js --sem-navegador nao abre o navegador sozinho

   ELE RODA NA MAQUINA DO DEV, e essa e a decisao que faz tudo funcionar:

     - o Z: existe, porque a sessao e a do proprio usuario
     - as permissoes sao as dele, sem conta de servico no meio
     - os commits saem com a autoria dele, sem ninguem configurar nada
     - o push usa o Git Credential Manager que ja esta na maquina

   Fechar esta janela encerra o app. Nao existe servico, nao fica nada rodando
   em segundo plano.

   Zero dependencias: so http, fs, path, crypto e child_process. E por isso que
   ele pode viver numa pasta de rede e ser executado de la, sem npm install e
   sem instalar nada na estacao.
============================================================================ */
'use strict';

var child = require('child_process');
var servidor = require('./src/servidor');
var git = require('./src/git');
var config = require('./src/config');

var VERSAO = '1.0.0';

/* PORTA FIXA, e nao uma livre qualquer.

   O atalho da Area de Trabalho e a inicializacao com o Windows abrem
   "http://127.0.0.1:7027/", e um atalho nao tem como descobrir uma porta
   sorteada. 7027, e nao a 7017 do delp-git: os dois podem rodar ao mesmo
   tempo, cada um na sua porta, com o seu cookie. */
var PORTA_PADRAO = 7027;

function lerArgumentos(argv) {
    var op = { porta: PORTA_PADRAO, navegador: true };
    for (var i = 0; i < argv.length; i++) {
        if (argv[i] === '--porta') op.porta = parseInt(argv[++i], 10) || 0;
        else if (argv[i] === '--sem-navegador') op.navegador = false;
        else if (argv[i] === '--versao') { console.log(VERSAO); process.exit(0); }
        else if (argv[i] === '--ajuda' || argv[i] === '-h') { ajuda(); process.exit(0); }
        else { console.error('argumento desconhecido: ' + argv[i]); process.exit(2); }
    }
    return op;
}

function ajuda() {
    console.log('gito ' + VERSAO);
    console.log('');
    console.log('  node app.js                 porta livre + abre o navegador');
    console.log('  node app.js --porta 7027    porta fixa');
    console.log('  node app.js --sem-navegador nao abre o navegador');
}

function abrirNavegador(url) {
    try {
        if (process.platform === 'win32') {
            /* "start" precisa de um titulo antes da URL, senao ele trata a URL
               como titulo da janela e nao abre nada. O "" e esse titulo. */
            child.spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' }).unref();
        } else if (process.platform === 'darwin') {
            child.spawn('open', [url], { detached: true, stdio: 'ignore' }).unref();
        } else {
            child.spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).unref();
        }
    } catch (e) { /* sem navegador e so inconveniencia: a URL esta impressa */ }
}

function principal() {
    var op = lerArgumentos(process.argv.slice(2));

    console.log('gito ' + VERSAO);

    git.versao()
        .then(function (v) {
            console.log(v);
            return git.identidade();
        })
        .then(function (id) {
            if (!id.completa) {
                console.log('');
                console.log('AVISO: o git ainda nao sabe quem e voce.');
                console.log('       O app pede seu nome e e-mail na primeira tela - e precisa');
                console.log('       deles antes do primeiro commit, senao o historico nasce');
                console.log('       com autoria errada e isso nao se corrige depois.');
            } else {
                console.log('voce: ' + id.nome + ' <' + id.email + '>');
            }

            var cfg = config.ler();
            console.log('pastas configuradas: ' + (cfg.pastas.length || 'nenhuma ainda') +
                        (cfg.herdadas ? ' (trazidas do delp-git na primeira abertura)' : ''));

            /* O token vem do config do usuário, não é sorteado a cada
               execução: é ele que mantém o cookie válido entre aberturas, e é
               o cookie que faz o atalho funcionar. Ver config.js. */
            var token = config.tokenDoUsuario();
            var app = servidor.criar(token);

            app.on('error', function (e) {
                if (e.code === 'EADDRINUSE') {
                    console.error('');
                    console.error('A porta ' + op.porta + ' ja esta em uso.');
                    console.error('Rode sem --porta que o app escolhe uma livre.');
                } else {
                    console.error('Nao consegui subir o servidor: ' + e.message);
                }
                process.exit(1);
            });

            /* 127.0.0.1 e NAO 0.0.0.0 - ver o cabecalho do servidor.js. Em
               0.0.0.0 qualquer um na rede comandaria o disco desta maquina. */
            app.listen(op.porta, '127.0.0.1', function () {
                var base = 'http://127.0.0.1:' + app.address().port + '/';
                var url = base + '?t=' + token;
                console.log('');
                console.log('Abra no navegador:');
                console.log('  ' + url);
                console.log('');
                console.log('Depois da primeira vez, este endereco curto passa a bastar');
                console.log('(e e ele que o atalho usa):');
                console.log('  ' + base);
                console.log('');
                console.log('(deixe esta janela aberta enquanto usa - fecha-la encerra o app)');
                if (op.navegador) abrirNavegador(url);
            });
        })
        .then(null, function (e) {
            console.error('');
            console.error('Nao consegui iniciar: ' + (e.message || e));
            console.error('');
            console.error('Se a mensagem fala do git, ele nao esta instalado ou nao esta no');
            console.error('PATH. Abra um chamado no GLPI pedindo o Git for Windows.');
            process.exit(1);
        });
}

principal();
