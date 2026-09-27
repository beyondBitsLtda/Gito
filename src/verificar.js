/* ============================================================================
   verificar.js - "esta no ar?", para cada servico da ficha tecnica
   ============================================================================
   Dois tipos de conferencia, e nenhuma manda dado nenhum:

     http(s)   um HEAD (ou GET, se o servidor recusar HEAD) no endereco. So a
               resposta interessa: o corpo e descartado sem ler.
     tcp       abre e fecha uma conexao no servidor:porta de um banco. Nao
               fala o protocolo do banco, nao tenta login - so pergunta se a
               porta atende.

   O QUE CONTA COMO "NO AR"

     2xx e 3xx          online
     401 e 403          online - o servico respondeu; so exige login
     404                alerta - o servidor esta de pe, mas o endereco da
                        ficha nao existe (ficha desatualizada?)
     5xx                fora - o servidor respondeu com erro
     sem resposta       fora, com o motivo em portugues

   Nao segue redirecionamento: um 302 ja prova que o servidor atende, e seguir
   levaria a pedidos para enderecos que a ficha nao declarou.

   CERTIFICADO que esta maquina nao reconhece (interno, autoassinado) nao e
   "fora do ar". A conferencia repete aceitando o certificado - so para ler o
   status - e diz isso na nota.

   O Node NAO usa o proxy do Windows. Endereco externo que so sai pelo proxy
   da empresa aparece "sem resposta", e a nota diz que pode ser isso.
============================================================================ */
'use strict';

var http = require('http');
var https = require('https');
var net = require('net');

var TEMPO_MS = 6000;
var CACHE_MS = 30000;
var SIMULTANEOS = 6;
var cache = {};

var ERROS_DE_CERTIFICADO = /CERT|SELF_SIGNED|UNABLE_TO_VERIFY|UNABLE_TO_GET_ISSUER|ALTNAME/i;

function motivo(e, alvo) {
    var c = e && e.code;
    if (c === 'ENOTFOUND' || c === 'EAI_AGAIN') return 'o endereço não foi encontrado (DNS)';
    if (c === 'ECONNREFUSED') return 'o servidor recusou a conexão (serviço parado ou porta errada)';
    if (c === 'ECONNRESET') return 'a conexão foi derrubada no meio';
    if (c === 'EHOSTUNREACH' || c === 'ENETUNREACH') return 'a rede não alcança esse servidor';
    if (c === 'TEMPO') {
        return 'não respondeu em ' + Math.round(TEMPO_MS / 1000) + ' s' +
               (alvo && alvo.externo ? ' (se o endereço for externo, a rede pode exigir o proxy da empresa)' : '');
    }
    return (e && e.message) || 'sem resposta';
}

function ehInterno(host) {
    return /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host) || host.indexOf('.') < 0 ||
           /\.(local|intranet|corp|lan)$/i.test(host) || /delp/i.test(host);
}

/* Um pedido so. aceitarCertificado=true e a segunda tentativa, depois de um
   erro de certificado. */
function pedir(u, metodo, aceitarCertificado) {
    return new Promise(function (ok, falha) {
        var mod = u.protocol === 'https:' ? https : http;
        var t0 = Date.now(), fim = false;
        var req = mod.request(u, {
            method: metodo,
            headers: { 'User-Agent': 'gito-verificar', 'Accept': '*/*' },
            rejectUnauthorized: !aceitarCertificado,
            timeout: TEMPO_MS
        }, function (res) {
            fim = true;
            res.resume();                     /* descarta o corpo sem ler */
            req.destroy();
            ok({ codigo: res.statusCode, ms: Date.now() - t0, local: res.headers.location || '' });
        });
        req.on('timeout', function () {
            if (fim) return;
            fim = true; req.destroy();
            falha(Object.assign(new Error('tempo'), { code: 'TEMPO' }));
        });
        req.on('error', function (e) { if (!fim) { fim = true; falha(e); } });
        req.end();
    });
}

function classificar(r, nota) {
    var c = r.codigo;
    if (c >= 200 && c < 400) return { estado: 'online', codigo: c, ms: r.ms, nota: nota || (c >= 300 ? 'redireciona' : '') };
    if (c === 401 || c === 403) return { estado: 'online', codigo: c, ms: r.ms, nota: nota || 'no ar; exige login' };
    if (c === 404) return { estado: 'alerta', codigo: c, ms: r.ms, nota: 'o servidor responde, mas esse endereço não existe (404) — a ficha está atualizada?' };
    if (c >= 500) return { estado: 'offline', codigo: c, ms: r.ms, nota: 'o servidor respondeu com erro ' + c };
    return { estado: 'alerta', codigo: c, ms: r.ms, nota: 'respondeu ' + c };
}

function verificarHttp(alvo) {
    var u;
    try { u = new URL(alvo.url); } catch (e) { return Promise.resolve({ estado: 'invalido', nota: 'endereço inválido' }); }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') {
        return Promise.resolve({ estado: 'invalido', nota: 'só endereços http e https são conferidos' });
    }
    alvo.externo = !ehInterno(u.hostname);

    function tentar(aceitar) {
        return pedir(u, 'HEAD', aceitar).then(function (r) {
            /* Ha servidor que nao implementa HEAD: pergunta de novo com GET. */
            if (r.codigo === 405 || r.codigo === 501) return pedir(u, 'GET', aceitar);
            return r;
        });
    }
    return tentar(false).then(function (r) { return classificar(r); }, function (e) {
        if (u.protocol === 'https:' && ERROS_DE_CERTIFICADO.test(String(e.code || e.message))) {
            return tentar(true).then(function (r) {
                return classificar(r, 'no ar, mas o certificado não é reconhecido por esta máquina');
            }, function (e2) { return { estado: 'offline', nota: motivo(e2, alvo) }; });
        }
        return { estado: 'offline', nota: motivo(e, alvo) };
    });
}

function verificarTcp(alvo) {
    var porta = parseInt(alvo.porta, 10);
    if (!alvo.host || !(porta > 0 && porta < 65536)) {
        return Promise.resolve({ estado: 'invalido', nota: 'informe servidor e porta para conferir' });
    }
    return new Promise(function (ok) {
        var t0 = Date.now(), fim = false;
        var s = net.connect({ host: alvo.host, port: porta });
        s.setTimeout(TEMPO_MS);
        function acabar(r) { if (fim) return; fim = true; try { s.destroy(); } catch (e) { /* ja foi */ } ok(r); }
        s.on('connect', function () { acabar({ estado: 'online', ms: Date.now() - t0, nota: 'a porta ' + porta + ' atende' }); });
        s.on('timeout', function () { acabar({ estado: 'offline', nota: motivo({ code: 'TEMPO' }, alvo) }); });
        s.on('error', function (e) { acabar({ estado: 'offline', nota: motivo(e, alvo) }); });
    });
}

/* Os alvos que a ficha declara. A CHAVE e o que a tela usa para pintar cada
   resultado no lugar certo. */
function alvosDaFicha(ficha) {
    var alvos = [];
    ficha = ficha || {};
    (ficha.hospedagem || []).forEach(function (h, i) {
        if (h && h.url && h.verificar !== false) alvos.push({ chave: 'hospedagem:' + i, tipo: 'http', url: h.url, rotulo: h.ambiente || h.url });
    });
    (ficha.bancoDeDados || []).forEach(function (b, i) {
        if (b && b.servidor && b.porta) alvos.push({ chave: 'banco:' + i, tipo: 'tcp', host: String(b.servidor).trim(), porta: b.porta, rotulo: b.nome || b.servidor });
        if (b && b.acesso && /^https?:/i.test(b.acesso)) alvos.push({ chave: 'banco-acesso:' + i, tipo: 'http', url: b.acesso, rotulo: (b.nome || 'banco') + ' (console)' });
    });
    (ficha.integracoes || []).forEach(function (g, i) {
        if (g && g.url && /^https?:/i.test(g.url)) alvos.push({ chave: 'integracao:' + i, tipo: 'http', url: g.url, rotulo: g.nome || g.url });
    });
    (ficha.links || []).forEach(function (l, i) {
        if (l && l.url && /^https?:/i.test(l.url)) alvos.push({ chave: 'link:' + i, tipo: 'http', url: l.url, rotulo: l.titulo || l.url });
    });
    ((ficha.arquitetura && ficha.arquitetura.diagramas) || []).forEach(function (d, i) {
        if (d && d.link && /^https?:/i.test(d.link)) alvos.push({ chave: 'diagrama:' + i, tipo: 'http', url: d.link, rotulo: d.titulo || d.link });
    });
    return alvos;
}

function verificarUm(alvo) {
    var id = alvo.tipo + ' ' + (alvo.url || (alvo.host + ':' + alvo.porta));
    var c = cache[id];
    if (c && Date.now() - c.quando < CACHE_MS) return Promise.resolve(Object.assign({ chave: alvo.chave, doCache: true }, c.r));
    var p = alvo.tipo === 'tcp' ? verificarTcp(alvo) : verificarHttp(alvo);
    return p.then(function (r) {
        r.conferidoEm = new Date().toISOString();
        cache[id] = { quando: Date.now(), r: r };
        return Object.assign({ chave: alvo.chave }, r);
    });
}

function verificarTodos(alvos, forcar) {
    if (forcar) cache = {};
    var fila = alvos.slice(), saida = [];
    function proximo() {
        if (!fila.length) return Promise.resolve();
        return verificarUm(fila.shift()).then(function (r) { saida.push(r); return proximo(); });
    }
    var ativos = [];
    for (var i = 0; i < Math.min(SIMULTANEOS, alvos.length); i++) ativos.push(proximo());
    return Promise.all(ativos).then(function () { return saida; });
}

module.exports = {
    verificarHttp: verificarHttp,
    verificarTcp: verificarTcp,
    alvosDaFicha: alvosDaFicha,
    verificarTodos: verificarTodos,
    _limparCache: function () { cache = {}; }
};
