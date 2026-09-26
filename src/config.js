/* ============================================================================
   config.js - as pastas onde este usuario guarda os repositorios
   ============================================================================
   Fica em %APPDATA%\gito\config.json - por USUARIO, na maquina dele.

   Nao vai para pasta de rede nem para o servidor de proposito: cada dev tem as
   pastas dele, e uma configuracao compartilhada faria a lista de um aparecer
   para o outro, com caminhos que o outro nem alcanca.

   SOBRE "Z:" AQUI

   Num servico do Windows, "Z:" precisaria virar UNC, porque servico nao
   enxerga unidade mapeada. AQUI NAO: o app roda na sessao do proprio
   usuario, onde o Z: existe. O caminho que ele copiou do Explorer e o caminho
   que funciona - que e metade do motivo desta aplicacao existir.
============================================================================ */
'use strict';

var fs = require('fs');
var path = require('path');
var os = require('os');

function pastaDoApp() {
    var base = process.env.APPDATA
            || process.env.XDG_CONFIG_HOME
            || path.join(os.homedir(), '.config');
    return path.join(base, 'gito');
}

/* O ANTECESSOR. Quem ja usava o delp-git tem as pastas cadastradas la. Na
   PRIMEIRA abertura do Gito (sem config.json proprio), as pastas vem de
   la - so as pastas: o token e de cada app, e os dois rodam lado a lado. */
function arquivoDoAntecessor() {
    return path.join(path.dirname(pastaDoApp()), 'delp-git', 'config.json');
}

function pastasDoAntecessor() {
    try {
        var c = JSON.parse(fs.readFileSync(arquivoDoAntecessor(), 'utf8'));
        return Array.isArray(c.pastas) ? c.pastas.map(String) : [];
    } catch (e) { return []; }
}

function arquivo() {
    return path.join(pastaDoApp(), 'config.json');
}

var PADRAO = { pastas: [], token: '' };

function ler() {
    try {
        var txt = fs.readFileSync(arquivo(), 'utf8');
        var c = JSON.parse(txt);
        return {
            pastas: Array.isArray(c.pastas) ? c.pastas.map(String) : [],
            token: String(c.token || '')
        };
    } catch (e) {
        /* Arquivo inexistente e o caso NORMAL: primeira execucao. Arquivo
           corrompido tambem cai aqui e vira configuracao vazia - o app volta a
           pedir as pastas, que e recuperavel. Derrubar a aplicacao por causa
           de um JSON quebrado deixaria o usuario sem saida. */
        if (!fs.existsSync(arquivo())) {
            var herdadas = pastasDoAntecessor();
            if (herdadas.length) return { pastas: herdadas, herdadas: true };
        }
        return { pastas: PADRAO.pastas.slice() };
    }
}

/* ==========================================================================
   O TOKEN, GUARDADO POR USUARIO
   --------------------------------------------------------------------------
   Ele nascia a cada execucao. Isso era mais seguro na teoria e impedia o que
   um atalho precisa na pratica: um ENDERECO FIXO. O atalho so pode apontar
   para "http://127.0.0.1:7027/" - ele nao tem como saber o token que o app
   sorteou ha cinco minutos.

   Entao o token passa a ser POR INSTALACAO, guardado aqui no %APPDATA% do
   usuario, junto com as pastas dele. O que se perde: um token vazado continua
   valido ate alguem trocar. O que se ganha: ele para de viajar na URL a cada
   abertura - e URL fica no historico do navegador e aparece em print de tela,
   que e um vazamento bem mais provavel.

   Trocar o token e apagar esta linha do config.json: o app sorteia outro na
   proxima abertura.
   ========================================================================== */
function tokenDoUsuario() {
    var cfg = ler();
    if (cfg.token && cfg.token.length >= 32) return cfg.token;

    var novo = require('crypto').randomBytes(24).toString('hex');
    gravar({ pastas: cfg.pastas, token: novo });
    return novo;
}

function gravar(cfg) {
    var dados = {
        pastas: (cfg.pastas || []).map(String),
        /* Gravar sem token apagaria o token na primeira vez que alguem
           salvasse as pastas pela tela - e o atalho pararia de funcionar
           sem ninguem entender por que. */
        token: String(cfg.token !== undefined ? cfg.token : ler().token || '')
    };
    try { fs.mkdirSync(pastaDoApp(), { recursive: true }); } catch (e) { /* ja existe */ }

    /* Grava em temporario e renomeia: se a energia cair no meio da escrita, o
       config.json antigo continua inteiro em vez de virar meio arquivo. */
    var tmp = arquivo() + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(dados, null, 2), 'utf8');
    fs.renameSync(tmp, arquivo());
    return dados;
}

/* ==========================================================================
   A CERCA
   --------------------------------------------------------------------------
   O app so opera dentro das pastas que o PROPRIO usuario cadastrou.

   Isto nao e trava contra ele - ele ja alcanca o disco inteiro pelo Explorer,
   e o app roda com a identidade dele. E trava contra o APP agir onde ninguem
   pediu: um caminho vindo da tela com um ".." a mais, ou um erro de digitacao
   que caisse em C:\Windows, encontraria aqui uma recusa em vez de um "git" na
   pasta errada.
   ========================================================================== */
function dentroDasPastas(alvo, pastas) {
    var a = path.resolve(String(alvo)).toLowerCase();
    for (var i = 0; i < (pastas || []).length; i++) {
        var raiz = path.resolve(String(pastas[i])).toLowerCase();
        if (a === raiz) return true;
        /* O separador no fim evita o falso positivo classico: "C:\devs-antigo"
           nao pode passar por estar "dentro" de "C:\devs". */
        if (a.indexOf(raiz + path.sep) === 0) return true;
    }
    return false;
}

/* Recusa o ".." ANTES de resolver o caminho. Resolvido, ele some - e o que a
   pessoa TENTOU fazer desaparece junto. Recusar a intencao deixa rastro. */
function caminhoAceitavel(alvo) {
    var s = String(alvo || '');
    if (!s.trim()) return 'caminho vazio';
    if (s.indexOf('..') >= 0) return 'caminho com ".." nao e aceito';
    if (s.indexOf('\u0000') >= 0) return 'caminho invalido';
    return null;
}

module.exports = {
    arquivo: arquivo,
    arquivoDoAntecessor: arquivoDoAntecessor,
    pastaDoApp: pastaDoApp,
    ler: ler,
    gravar: gravar,
    tokenDoUsuario: tokenDoUsuario,
    dentroDasPastas: dentroDasPastas,
    caminhoAceitavel: caminhoAceitavel
};
