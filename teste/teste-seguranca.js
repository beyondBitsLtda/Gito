/* Teste de mesa das TRAVAS do gito.

   Este app executa git em caminhos do disco a partir de uma pagina web. Ele e
   seguro por quatro afirmacoes, e cada uma e uma linha de codigo que alguem
   pode afrouxar sem perceber - sem que nada pare de funcionar:

     1. escuta SO em 127.0.0.1
     2. toda chamada da API exige o token da execucao
     3. Host/Origin de fora do loopback sao recusados (DNS rebinding)
     4. so opera dentro das pastas que o usuario cadastrou, e ".." e recusado

   O afrouxamento de qualquer uma delas NAO aparece no uso normal: o app
   continua funcionando igual. O que muda e quem mais consegue usa-lo.

   Rodar:  node teste/teste-seguranca.js
*/
'use strict';

var http = require('http');
var os = require('os');
var path = require('path');
var fs = require('fs');

/* A configuracao do teste vai para uma pasta temporaria ANTES de carregar o
   config.js - senao o teste leria (e gravaria) a config real de quem roda. */
var TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'gito-teste-'));
process.env.APPDATA = TMP;
process.env.XDG_CONFIG_HOME = TMP;

var servidor = require('../src/servidor');
var config = require('../src/config');

var falhas = 0;
function conferir(condicao, descricao, detalhe) {
    if (condicao) console.log('ok     ' + descricao);
    else { console.log('FALHA  ' + descricao + (detalhe ? '\n         ' + detalhe : '')); falhas++; }
}

/* Uma pasta cadastrada, e uma vizinha que NAO esta cadastrada. */
var PERMITIDA = path.join(TMP, 'repos');
var DE_FORA = path.join(TMP, 'fora');
fs.mkdirSync(PERMITIDA, { recursive: true });
fs.mkdirSync(DE_FORA, { recursive: true });
config.gravar({ pastas: [PERMITIDA] });

var TOKEN = config.tokenDoUsuario();
var app = servidor.criar(TOKEN);

function pedir(op) {
    return new Promise(function (resolve) {
        var dados = op.corpo ? JSON.stringify(op.corpo) : null;
        var cab = {};
        if (op.token !== null) cab['X-Gito-Token'] = (op.token === undefined ? TOKEN : op.token);
        if (op.cookie) cab['Cookie'] = op.cookie;
        if (op.origin) cab['Origin'] = op.origin;
        if (dados) cab['Content-Type'] = 'application/json';

        var req = http.request({
            host: '127.0.0.1', port: app.address().port,
            method: op.metodo || 'GET', path: op.rota, headers: cab,
            /* setHeader('Host') e ignorado pelo Node; a opcao abaixo e a que
               realmente troca o Host da requisicao. */
            setHost: !op.host
        }, function (res) {
            var b = '';
            res.on('data', function (d) { b += d; });
            res.on('end', function () {
                var j = null;
                try { j = JSON.parse(b); } catch (e) { /* estatico */ }
                resolve({ status: res.statusCode, corpo: j, bruto: b, cab: res.headers });
            });
        });
        if (op.host) req.setHeader('Host', op.host);
        req.on('error', function (e) { resolve({ status: 0, erro: e.message }); });
        if (dados) req.write(dados);
        req.end();
    });
}

app.listen(0, '127.0.0.1', function () {

    console.log('--- 1. o bind ---');
    conferir(app.address().address === '127.0.0.1',
        'o servidor escuta SÓ em 127.0.0.1',
        'em 0.0.0.0, qualquer um na rede comandaria o disco desta máquina. Valor: ' +
        app.address().address);

    Promise.resolve()
        .then(function () {
            console.log('\n--- 2. o token ---');
            return pedir({ rota: '/api/config', token: null });
        })
        .then(function (r) {
            conferir(r.status === 401 && r.corpo && r.corpo.codigo === 'TOKEN',
                'chamada SEM token é recusada',
                'o bind em loopback não protege contra o próprio navegador do dev: ' +
                'uma aba aberta em qualquer site alcança 127.0.0.1');
            return pedir({ rota: '/api/config', token: 'x'.repeat(48) });
        })
        .then(function (r) {
            conferir(r.status === 401, 'token errado, do mesmo tamanho, é recusado');
            return pedir({ rota: '/api/config', token: 'curto' });
        })
        .then(function (r) {
            conferir(r.status === 401, 'token de tamanho diferente é recusado sem estourar exceção',
                'timingSafeEqual lança quando os tamanhos diferem — tem de ser conferido antes');
            return pedir({ rota: '/api/config' });
        })
        .then(function (r) {
            conferir(r.status === 200 && r.corpo && r.corpo.ok, 'com o token certo, passa');

            console.log('\n--- 3. Host e Origin (DNS rebinding) ---');
            return pedir({ rota: '/api/config', host: 'app.exemplo.com' });
        })
        .then(function (r) {
            conferir(r.status === 403 && r.corpo && r.corpo.codigo === 'ORIGEM',
                'Host de fora do loopback é recusado',
                'é assim que o DNS rebinding contorna o bind e o token');
            return pedir({ rota: '/api/config', origin: 'http://malicioso.example' });
        })
        .then(function (r) {
            conferir(r.status === 403, 'Origin de outro site é recusado');
            return pedir({ rota: '/api/config', origin: 'http://127.0.0.1:1234' });
        })
        .then(function (r) {
            conferir(r.status === 200, 'Origin do próprio loopback passa');

            console.log('\n--- 4. a cerca de pastas ---');
            return pedir({ rota: '/api/repo?p=' + encodeURIComponent(DE_FORA) });
        })
        .then(function (r) {
            conferir(r.corpo && r.corpo.codigo === 'FORA_DA_CERCA',
                'pasta que o usuário NÃO cadastrou é recusada',
                JSON.stringify(r.corpo));
            return pedir({ rota: '/api/repo?p=' + encodeURIComponent(PERMITIDA + '\\..\\fora') });
        })
        .then(function (r) {
            conferir(r.corpo && r.corpo.codigo === 'CAMINHO_INVALIDO',
                '".." é recusado explicitamente, antes de ser resolvido',
                'resolvido, ele some — e a intenção some junto');

            /* A armadilha do prefixo: "<permitida>-outra" começa com o mesmo
               texto de "<permitida>", mas está fora dela. */
            var vizinha = PERMITIDA + '-outra';
            fs.mkdirSync(vizinha, { recursive: true });
            return pedir({ rota: '/api/repo?p=' + encodeURIComponent(vizinha) });
        })
        .then(function (r) {
            conferir(r.corpo && r.corpo.codigo === 'FORA_DA_CERCA',
                'ARMADILHA DO PREFIXO: pasta vizinha de nome parecido não entra',
                'um indexOf() sem o separador no fim libera toda pasta vizinha');

            return pedir({ rota: '/api/config', metodo: 'POST', corpo: { pastas: ['C:\\nao\\existe\\mesmo'] } });
        })
        .then(function (r) {
            conferir(r.corpo && !r.corpo.ok, 'cadastrar pasta inexistente é recusado',
                'senão a lista enche de caminho que nunca vai casar com nada');

            console.log('\n--- 5. o cookie que sustenta o endereço curto ---');
            return pedir({ rota: '/?t=' + TOKEN, token: null });
        })
        .then(function (r) {
            var sc = String(r.cab['set-cookie'] || '');
            conferir(r.status === 200, 'abrir com o token na URL carrega a página');
            conferir(sc.indexOf('gito=') >= 0, 'e planta o cookie', sc);
            conferir(/HttpOnly/i.test(sc), 'o cookie é HttpOnly — nenhum JavaScript o lê',
                'sem isso, um script injetado na página levaria o token embora');
            /* Strict: o Gito não é aberto por link de outro site (o atalho, o
               endereço digitado e a inicialização do Windows não são
               navegação cross-site), então a trava mais fechada não custa
               nada — nem uma página GET abre com o cookie a partir de fora. */
            conferir(/SameSite=Strict/i.test(sc),
                'e SameSite=Strict — nenhum site de fora navega no app com o seu cookie',
                'Veio: ' + sc);

            return pedir({ rota: '/api/config', token: null, cookie: 'gito=' + TOKEN });
        })
        .then(function (r) {
            conferir(r.status === 200 && r.corpo && r.corpo.ok,
                'COM o cookie, a API responde sem token na URL',
                'é o que faz o atalho funcionar: o endereço curto não leva token');
            return pedir({ rota: '/api/config', token: null, cookie: 'gito=' + 'f'.repeat(48) });
        })
        .then(function (r) {
            conferir(r.status === 401, 'cookie com token errado é recusado igual');
            return pedir({ rota: '/', token: null });
        })
        .then(function (r) {
            conferir(r.status === 401 && /autorizado/.test(r.bruto),
                'sem token e sem cookie, a página EXPLICA em vez de vir vazia',
                'quem abre o atalho num navegador novo cai aqui');

            console.log('\n--- 6. estáticos ---');
            return pedir({ rota: '/app.css', token: null });
        })
        .then(function (r) {
            conferir(r.status === 200, 'o CSS carrega sem token (não tem dado nenhum)');
            return pedir({ rota: '/../src/git.js', token: null });
        })
        .then(function (r) {
            conferir(r.bruto.indexOf('module.exports') < 0,
                'travessia no caminho de estático não serve arquivo de fora de web/');
        })
        .then(function () {
            console.log('');
            console.log(falhas ? ('===== ' + falhas + ' FALHAS =====') : '===== todos passaram =====');
            app.close();
            try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* tudo bem */ }
            process.exit(falhas ? 1 : 0);
        })
        .catch(function (e) {
            console.error('o teste estourou: ' + (e && e.stack || e));
            app.close();
            process.exit(1);
        });
});
