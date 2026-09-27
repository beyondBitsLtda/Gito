/* ============================================================================
   painel.js - o painel das aplicacoes: versoes, ficha tecnica e issues
   ============================================================================
   Tudo sai do gito.json de cada aplicacao (o contrato esta em GITO.md) e da
   pasta .gito/ ao lado dele.

   AS VERSOES VEM DO GIT, NAO DO DISCO. A versao da main e a de cada branch
   sao lidas com "git show <branch>:<caminho>/gito.json": nenhuma troca de
   branch, nenhum arquivo tocado, e da para ver a branch de um colega que so
   existe no servidor (a partir do ultimo "Atualizar lista do servidor").
   O disco entra so como "na sua pasta" - o que ainda nao foi salvo.

   AS ISSUES SAO ARQUIVOS DO REPOSITORIO (.gito/issues/<ID>.json). Viajam com
   o codigo: quem salva e envia, compartilha. Um arquivo por issue, para duas
   pessoas mexendo em issues diferentes nao colidirem.

   NADA AQUI APAGA: issue, comentario e evidencia so se acrescentam - a regra
   do app ("nenhuma operacao pode fazer alguem perder trabalho") vale para as
   issues tambem.
============================================================================ */
'use strict';

var fs = require('fs');
var path = require('path');
var git = require('./git');

var ARQUIVO = 'gito.json';
var PROFUNDIDADE = 3;
var MAX_PASTAS_VISITADAS = 600;
var MAX_REFS = 40;
var SEP = '\u001f';
var IGNORAR = { 'node_modules': 1, 'target': 1, 'dist': 1, 'build': 1, 'bin': 1, 'obj': 1,
                'vendor': 1, 'cache': 1, 'coverage': 1, 'out': 1 };

var TIPOS_ISSUE = ['bug', 'melhoria', 'tarefa'];
var PRIORIDADES = ['baixa', 'media', 'alta', 'critica'];
var SITUACOES = ['aberta', 'em-andamento', 'em-revisao', 'concluida', 'cancelada'];
var EXT_IMAGEM = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
                   '.webp': 'image/webp', '.svg': 'image/svg+xml' };
var EXT_EVIDENCIA = Object.assign({ '.pdf': 'application/pdf', '.txt': 'text/plain; charset=utf-8',
    '.log': 'text/plain; charset=utf-8', '.csv': 'text/csv; charset=utf-8', '.json': 'application/json',
    '.zip': 'application/zip', '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', '.mp4': 'video/mp4' }, EXT_IMAGEM);
var EVIDENCIA_MAX = 8 * 1024 * 1024;

function erroDe(msg, codigo) { return Object.assign(new Error(msg), { codigo: codigo || 'PAINEL' }); }
function posix(p) { return String(p || '').split(path.sep).join('/'); }
function agora() { return new Date().toISOString(); }

/* ==========================================================================
   ONDE ESTAO AS APLICACOES
   ========================================================================== */
/* A pasta de uma aplicacao DENTRO do repositorio: '' (a raiz) ou um caminho
   relativo. Vem da tela, entao passa pela mesma desconfianca do resto. */
function subValida(sub) {
    var s = posix(sub).replace(/^\/+|\/+$/g, '');
    if (s === '' || s === '.') return '';
    if (s.indexOf('..') >= 0 || /^[A-Za-z]:/.test(s) || s.indexOf('\u0000') >= 0) {
        throw erroDe('pasta da aplicação inválida', 'CAMINHO_INVALIDO');
    }
    return s;
}

function pastaDaApp(repo, sub) {
    var dir = path.resolve(repo, subValida(sub));
    var rel = path.relative(path.resolve(repo), dir);
    if (rel.indexOf('..') === 0 || path.isAbsolute(rel)) throw erroDe('fora do repositório', 'CAMINHO_INVALIDO');
    return dir;
}

/* Procura gito.json na raiz e ate PROFUNDIDADE niveis abaixo. Para no
   primeiro achado de cada ramo: uma aplicacao nao tem outra dentro. */
function acharAplicacoes(repo) {
    var achadas = [], visitadas = 0;
    function descer(dir, nivel) {
        if (++visitadas > MAX_PASTAS_VISITADAS) return;
        if (fs.existsSync(path.join(dir, ARQUIVO))) {
            achadas.push(posix(path.relative(repo, dir)));
            return;
        }
        if (nivel >= PROFUNDIDADE) return;
        var filhos;
        try { filhos = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
        filhos.forEach(function (d) {
            if (!d.isDirectory() || d.name.charAt(0) === '.' || IGNORAR[d.name]) return;
            descer(path.join(dir, d.name), nivel + 1);
        });
    }
    descer(repo, 0);
    return achadas;
}

/* ==========================================================================
   LER E CONFERIR O gito.json
   ========================================================================== */
var SEMVER = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/;
/* O que PARECE credencial - o contrato proibe, e o painel denuncia. So
   avisa: quem decide e a pessoa, e um falso positivo nao pode esconder a ficha.

   Procura credencial DE VERDADE: "senha: xyz" ou "Password=..." numa string,
   ou uma chave chamada senha/token com valor. Falar SOBRE senha ("nao guarda
   senhas em disco") nao conta - a propria ficha do Gito diz isso. */
var VALOR_SEGREDO = /(senha|password|passwd|pwd|secret|segredo|api[_-]?key|token)\s*[:=]\s*[^\s,;]{3,}/i;
var CHAVE_SEGREDO = /^(senha|password|passwd|pwd|secret|segredo|token|apikey|api_key|chave)$/i;

function pareceSegredo(v, chave) {
    if (v == null) return false;
    if (typeof v === 'string') return !!(chave && CHAVE_SEGREDO.test(chave) && v.trim() !== '') || VALOR_SEGREDO.test(v);
    if (typeof v !== 'object') return false;
    return Object.keys(v).some(function (k) { return pareceSegredo(v[k], Array.isArray(v) ? '' : k); });
}

function texto(v) { return v == null ? '' : String(v); }
function lista(v) { return Array.isArray(v) ? v : []; }

function lerFicha(bruto, origem) {
    var avisos = [], d;
    try { d = JSON.parse(bruto); } catch (e) {
        return { ok: false, avisos: ['o ' + (origem || ARQUIVO) + ' não é um JSON válido: ' + e.message], dados: null };
    }
    if (!d || typeof d !== 'object') return { ok: false, avisos: ['o gito.json está vazio'], dados: null };
    if (d.$gito !== 1) avisos.push('falta "$gito": 1 — o arquivo pode não seguir o contrato do GITO.md');

    var ap = d.aplicacao || {};
    var f = d.ficha || {};
    var arq = f.arquitetura || {};
    var dados = {
        aplicacao: {
            nome: texto(ap.nome) || '(sem nome)',
            codigo: texto(ap.codigo).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12),
            descricao: texto(ap.descricao), tipo: texto(ap.tipo), situacao: texto(ap.situacao),
            responsavel: texto(ap.responsavel), equipe: texto(ap.equipe)
        },
        versao: texto(d.versao),
        atualizadoEm: texto(d.atualizadoEm),
        compilacao: d.compilacao && typeof d.compilacao === 'object' ? {
            numero: d.compilacao.numero, data: texto(d.compilacao.data), artefato: texto(d.compilacao.artefato)
        } : null,
        historico: lista(d.historico).map(function (h) {
            h = h || {};
            return { versao: texto(h.versao), data: texto(h.data), branch: texto(h.branch), tipo: texto(h.tipo),
                     resumo: texto(h.resumo), itens: lista(h.itens).map(texto), issues: lista(h.issues).map(texto) };
        }),
        ficha: {
            escopo: { objetivo: texto((f.escopo || {}).objetivo), inclui: lista((f.escopo || {}).inclui).map(texto),
                      naoInclui: lista((f.escopo || {}).naoInclui).map(texto) },
            stack: lista(f.stack).map(texto),
            arquitetura: { resumo: texto(arq.resumo), diagramas: lista(arq.diagramas).filter(Boolean) },
            hospedagem: lista(f.hospedagem).filter(Boolean),
            bancoDeDados: lista(f.bancoDeDados).filter(Boolean),
            integracoes: lista(f.integracoes).filter(Boolean),
            links: lista(f.links).filter(Boolean),
            contatos: lista(f.contatos).filter(Boolean)
        }
    };
    if (!dados.aplicacao.codigo) {
        dados.aplicacao.codigo = dados.aplicacao.nome.toUpperCase().normalize('NFD').replace(/[^A-Z0-9]/g, '').slice(0, 6) || 'APP';
        avisos.push('sem "aplicacao.codigo": as issues usam ' + dados.aplicacao.codigo + ' — defina a sigla no gito.json');
    }
    if (!dados.versao) avisos.push('sem "versao"');
    else if (!SEMVER.test(dados.versao)) avisos.push('a versão "' + dados.versao + '" não segue MAIOR.MENOR.CORREÇÃO');
    if (dados.historico.length && dados.versao && dados.historico[0].versao !== dados.versao) {
        avisos.push('a primeira entrada do histórico (' + dados.historico[0].versao + ') não é a versão atual (' + dados.versao + ')');
    }
    if (pareceSegredo(d.ficha || {})) {
        avisos.push('a ficha parece conter uma credencial (senha, token ou chave). O contrato proíbe: informe onde está o recurso, nunca como entrar.');
    }
    return { ok: true, avisos: avisos, dados: dados };
}

function lerFichaDaPasta(dir) {
    var arq = path.join(dir, ARQUIVO);
    var bruto;
    try { bruto = fs.readFileSync(arq, 'utf8'); } catch (e) { return null; }
    return lerFicha(bruto.replace(/^﻿/, ''), ARQUIVO);
}

/* ==========================================================================
   VERSOES POR BRANCH
   ========================================================================== */
function refs(repo, limite) {
    return git.executar(['for-each-ref', '--sort=-committerdate', '--count=' + (limite * 2),
        '--format=%(refname)' + SEP + '%(refname:short)' + SEP + '%(committerdate:iso-strict)' + SEP +
        '%(authorname)' + SEP + '%(subject)' + SEP + '%(objectname:short)',
        'refs/heads', 'refs/remotes'], { cwd: repo })
        .then(function (r) {
            if (r.codigo !== 0) return [];
            return r.saida.split('\n').filter(function (l) { return l.trim(); }).map(function (l) {
                var p = l.split(SEP);
                return { ref: p[0], curto: p[1], data: p[2], autor: p[3], assunto: p[4], sha: p[5] };
            }).filter(function (x) { return !/\/HEAD$/.test(x.ref) && x.ref.charAt(0) !== '-'; });
        });
}

function branchPadrao(repo, lista) {
    return git.executar(['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD'], { cwd: repo })
        .then(function (r) {
            var nomes = lista.map(function (x) { return x.nome; });
            var viaRemoto = r.codigo === 0 ? r.saida.trim().replace(/^origin\//, '') : '';
            if (viaRemoto && nomes.indexOf(viaRemoto) >= 0) return viaRemoto;
            if (nomes.indexOf('main') >= 0) return 'main';
            if (nomes.indexOf('master') >= 0) return 'master';
            return nomes[0] || '';
        });
}

function versaoNaRef(repo, ref, arquivoRel) {
    return git.executar(['show', ref + ':' + arquivoRel], { cwd: repo }).then(function (r) {
        if (r.codigo !== 0) return { existe: false };
        var f = lerFicha(r.saida, ARQUIVO);
        return { existe: true, valido: f.ok, versao: f.dados ? f.dados.versao : '', avisos: f.avisos, dados: f.dados };
    });
}

function frenteAtras(repo, base, ref) {
    if (!base || base === ref) return Promise.resolve(null);
    return git.executar(['rev-list', '--left-right', '--count', base + '...' + ref], { cwd: repo }).then(function (r) {
        if (r.codigo !== 0) return null;
        var p = r.saida.trim().split(/\s+/);
        return { atras: parseInt(p[0], 10) || 0, frente: parseInt(p[1], 10) || 0 };
    });
}

function emLotes(itens, tarefa, n) {
    var fila = itens.slice(), ativos = [];
    function proximo() {
        if (!fila.length) return Promise.resolve();
        var it = fila.shift();
        return tarefa(it).then(proximo);
    }
    for (var i = 0; i < Math.min(n, itens.length); i++) ativos.push(proximo());
    return Promise.all(ativos);
}

function versoes(repo, sub, maxRefs) {
    sub = subValida(sub);
    var limite = maxRefs || MAX_REFS;
    var arquivoRel = sub ? sub + '/' + ARQUIVO : ARQUIVO;
    var remotoPrefixo = 'refs/remotes/';

    return Promise.all([
        refs(repo, limite),
        git.executar(['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: repo })
    ]).then(function (rs) {
        var todas = rs[0];
        var atual = rs[1].codigo === 0 ? rs[1].saida.trim() : '';
        /* Agrupa a branch daqui com a mesma do servidor: uma linha por nome. */
        var porNome = {}, ordem = [];
        todas.forEach(function (x) {
            var local = x.ref.indexOf('refs/heads/') === 0;
            var nome = local ? x.curto : x.curto.replace(/^[^/]+\//, '');
            if (!porNome[nome]) { porNome[nome] = { nome: nome }; ordem.push(nome); }
            porNome[nome][local ? 'local' : 'servidor'] = x;
            if (!local) porNome[nome].remoto = x.ref.slice(remotoPrefixo.length).split('/')[0];
        });
        var linhas = ordem.slice(0, limite).map(function (n) { return porNome[n]; });

        return branchPadrao(repo, linhas).then(function (padrao) {
            var linhaPadrao = porNome[padrao];
            var baseRef = linhaPadrao ? ((linhaPadrao.servidor || linhaPadrao.local).ref) : '';
            if (linhaPadrao && linhas.indexOf(linhaPadrao) < 0) linhas.unshift(linhaPadrao);

            return emLotes(linhas, function (l) {
                var tarefas = [];
                ['local', 'servidor'].forEach(function (lado) {
                    if (!l[lado]) return;
                    tarefas.push(versaoNaRef(repo, l[lado].ref, arquivoRel).then(function (v) { l[lado].gito = v; }));
                });
                var comparar = (l.local || l.servidor).ref;
                tarefas.push(frenteAtras(repo, baseRef, comparar).then(function (fa) { l.diferenca = fa; }));
                return Promise.all(tarefas);
            }, 4).then(function () {
                var pasta = lerFichaDaPasta(pastaDaApp(repo, sub));
                var avisos = [];
                var vPadrao = linhaPadrao && ((linhaPadrao.servidor && linhaPadrao.servidor.gito) || (linhaPadrao.local && linhaPadrao.local.gito));
                if (vPadrao && vPadrao.existe && vPadrao.versao && /-/.test(vPadrao.versao)) {
                    avisos.push('a ' + padrao + ' está com versão de branch (' + vPadrao.versao +
                                '): o contrato pede para finalizar a versão (tirar o sufixo) antes de juntar.');
                }
                linhas.sort(function (a, b) {
                    function peso(l) { return l.nome === padrao ? 0 : l.nome === atual ? 1 : 2; }
                    return peso(a) - peso(b);
                });
                var saida = linhas.map(function (l) {
                    function lado(x) {
                        if (!x) return null;
                        return { ref: x.curto, sha: x.sha, data: x.data, autor: x.autor, assunto: x.assunto,
                                 versao: x.gito && x.gito.existe ? x.gito.versao : null,
                                 temFicha: !!(x.gito && x.gito.existe), valido: x.gito ? x.gito.valido !== false : true };
                    }
                    return { nome: l.nome, padrao: l.nome === padrao, atual: l.nome === atual,
                             local: lado(l.local), servidor: lado(l.servidor), diferenca: l.diferenca || null };
                });
                return {
                    padrao: padrao, atual: atual, branches: saida, avisos: avisos,
                    publicada: vPadrao && vPadrao.existe ? { versao: vPadrao.versao, dados: vPadrao.dados } : null,
                    pasta: pasta ? { versao: pasta.dados ? pasta.dados.versao : '', valido: pasta.ok } : null
                };
            });
        });
    });
}

/* ==========================================================================
   ISSUES
   ========================================================================== */
function pastaIssues(appDir) { return path.join(appDir, '.gito', 'issues'); }
function pastaEvidencias(appDir, id) { return path.join(appDir, '.gito', 'evidencias', id); }
function idValido(id) { return /^[A-Z0-9]{1,12}-\d{4,6}$/.test(String(id || '')); }

function gravarJson(arq, obj) {
    fs.mkdirSync(path.dirname(arq), { recursive: true });
    var tmp = arq + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(obj, null, 2) + '\n', 'utf8');
    fs.renameSync(tmp, arq);
}

function lerIssue(arq) {
    try { return JSON.parse(fs.readFileSync(arq, 'utf8').replace(/^﻿/, '')); } catch (e) { return null; }
}

function listarIssues(appDir) {
    var dir = pastaIssues(appDir), saida = [], problemas = [];
    var nomes;
    try { nomes = fs.readdirSync(dir); } catch (e) { return { issues: [], problemas: [] }; }
    var vistos = {};
    nomes.filter(function (n) { return /\.json$/i.test(n); }).forEach(function (n) {
        var it = lerIssue(path.join(dir, n));
        if (!it || !idValido(it.id)) { problemas.push(n + ' não é uma issue válida'); return; }
        if (vistos[it.id]) problemas.push('o ID ' + it.id + ' aparece em dois arquivos — duas pessoas criaram ao mesmo tempo? Renomeie um deles.');
        vistos[it.id] = true;
        it.comentarios = lista(it.comentarios);
        it.evidencias = lista(it.evidencias);
        it.historico = lista(it.historico);
        saida.push(it);
    });
    saida.sort(function (a, b) { return String(b.id).localeCompare(String(a.id), 'pt-BR', { numeric: true }); });
    return { issues: saida, problemas: problemas };
}

function resumoIssues(appDir) {
    var hoje = new Date().toISOString().slice(0, 10);
    var l = listarIssues(appDir).issues;
    var abertas = l.filter(function (i) { return i.status !== 'concluida' && i.status !== 'cancelada'; });
    return {
        total: l.length, abertas: abertas.length,
        vencidas: abertas.filter(function (i) { return i.prazo && i.prazo < hoje; }).length,
        bugs: abertas.filter(function (i) { return i.tipo === 'bug'; }).length
    };
}

function proximoId(appDir, codigo) {
    var maior = 0;
    listarIssues(appDir).issues.forEach(function (i) {
        var m = /-(\d+)$/.exec(i.id);
        if (m && i.id.indexOf(codigo + '-') === 0) maior = Math.max(maior, parseInt(m[1], 10));
    });
    var n = String(maior + 1);
    while (n.length < 4) n = '0' + n;
    return codigo + '-' + n;
}

function limparCampos(d, parcial) {
    var s = {};
    function pegar(k, fn) { if (d[k] !== undefined) s[k] = fn(d[k]); else if (!parcial) s[k] = fn(''); }
    pegar('titulo', function (v) { return texto(v).trim().slice(0, 200); });
    pegar('descricao', function (v) { return texto(v).slice(0, 20000); });
    pegar('tipo', function (v) { return TIPOS_ISSUE.indexOf(v) >= 0 ? v : 'tarefa'; });
    pegar('prioridade', function (v) { return PRIORIDADES.indexOf(v) >= 0 ? v : 'media'; });
    pegar('status', function (v) { return SITUACOES.indexOf(v) >= 0 ? v : 'aberta'; });
    pegar('responsavel', function (v) { return texto(v).trim().slice(0, 120); });
    pegar('prazo', function (v) { v = texto(v).trim(); return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : ''; });
    pegar('versaoAlvo', function (v) { return texto(v).trim().slice(0, 40); });
    return s;
}

var ROTULO_CAMPO = { titulo: 'título', descricao: 'descrição', tipo: 'tipo', prioridade: 'prioridade',
                     status: 'situação', responsavel: 'responsável', prazo: 'prazo', versaoAlvo: 'versão alvo' };

function salvarIssue(appDir, codigo, id, dados, autor) {
    if (id) {
        if (!idValido(id)) throw erroDe('ID de issue inválido');
        var arq = path.join(pastaIssues(appDir), id + '.json');
        var it = lerIssue(arq);
        if (!it) throw erroDe('não achei a issue ' + id);
        var novos = limparCampos(dados, true);
        var mudancas = [];
        Object.keys(novos).forEach(function (k) {
            if (texto(it[k]) === texto(novos[k])) return;
            mudancas.push(k === 'descricao' ? 'descrição alterada'
                : ROTULO_CAMPO[k] + ': ' + (texto(it[k]) || '—') + ' → ' + (texto(novos[k]) || '—'));
            it[k] = novos[k];
        });
        if (!mudancas.length) return it;
        if (novos.titulo !== undefined && !novos.titulo) throw erroDe('o título não pode ficar vazio');
        it.atualizadaEm = agora();
        it.historico = lista(it.historico);
        mudancas.forEach(function (m) { it.historico.push({ quando: it.atualizadaEm, autor: autor, mudanca: m }); });
        gravarJson(arq, it);
        return it;
    }
    var campos = limparCampos(dados, false);
    if (!campos.titulo) throw erroDe('dê um título para a issue');
    var novo = proximoId(appDir, codigo);
    var quando = agora();
    var issue = Object.assign({ id: novo }, campos, {
        criadaEm: quando, criadaPor: autor, atualizadaEm: quando,
        comentarios: [], evidencias: [], historico: [{ quando: quando, autor: autor, mudanca: 'issue criada' }]
    });
    gravarJson(path.join(pastaIssues(appDir), novo + '.json'), issue);
    return issue;
}

/* Nome de arquivo de evidencia: so o nome (nunca caminho), caracteres
   comuns, extensao da lista. Repetido ganha -1, -2... e nunca sobrescreve. */
function nomeDeEvidencia(dir, nome) {
    var base = path.basename(texto(nome)).replace(/[^\w.\- ()]/g, '_').replace(/^\.+/, '').slice(0, 80) || 'evidencia';
    var ext = path.extname(base).toLowerCase();
    if (!EXT_EVIDENCIA[ext]) throw erroDe('tipo de arquivo não aceito como evidência: ' + (ext || 'sem extensão') +
        ' (aceitos: ' + Object.keys(EXT_EVIDENCIA).join(' ') + ')');
    var raiz = base.slice(0, base.length - ext.length), final = base, n = 1;
    while (fs.existsSync(path.join(dir, final))) final = raiz + '-' + (n++) + ext;
    return final;
}

function comentar(appDir, id, textoComentario, anexos, autor) {
    if (!idValido(id)) throw erroDe('ID de issue inválido');
    var arq = path.join(pastaIssues(appDir), id + '.json');
    var it = lerIssue(arq);
    if (!it) throw erroDe('não achei a issue ' + id);
    anexos = lista(anexos);
    var corpo = texto(textoComentario).trim().slice(0, 20000);
    if (!corpo && !anexos.length) throw erroDe('escreva o comentário ou anexe uma evidência');

    var dir = pastaEvidencias(appDir, id);
    var gravados = [];
    var quando = agora();
    anexos.forEach(function (a) {
        var buf = Buffer.from(texto(a && a.base64).replace(/^data:[^,]*,/, ''), 'base64');
        if (!buf.length) throw erroDe('a evidência ' + texto(a && a.nome) + ' veio vazia');
        if (buf.length > EVIDENCIA_MAX) throw erroDe('a evidência ' + texto(a && a.nome) + ' passa de 8 MB');
        fs.mkdirSync(dir, { recursive: true });
        var nome = nomeDeEvidencia(dir, a.nome);
        fs.writeFileSync(path.join(dir, nome), buf);
        gravados.push(nome);
    });
    it.comentarios = lista(it.comentarios);
    it.evidencias = lista(it.evidencias);
    it.historico = lista(it.historico);
    it.comentarios.push({ quando: quando, autor: autor, texto: corpo, evidencias: gravados });
    gravados.forEach(function (n) { it.evidencias.push({ arquivo: n, enviadaEm: quando, autor: autor }); });
    it.atualizadaEm = quando;
    if (gravados.length) it.historico.push({ quando: quando, autor: autor, mudanca: gravados.length + ' evidência(s) anexada(s)' });
    gravarJson(arq, it);
    return it;
}

/* ==========================================================================
   ARQUIVOS DA APLICACAO (diagramas e evidencias)
   ========================================================================== */
/* So dentro da pasta da aplicacao, e so dos tipos da lista. */
function arquivoDaApp(appDir, rel, evidencia) {
    var r = posix(rel).replace(/^\/+/, '');
    if (!r || r.indexOf('..') >= 0 || r.indexOf('\u0000') >= 0) throw erroDe('arquivo inválido', 'CAMINHO_INVALIDO');
    var alvo = path.resolve(appDir, r);
    var rr = path.relative(appDir, alvo);
    if (rr.indexOf('..') === 0 || path.isAbsolute(rr)) throw erroDe('fora da aplicação', 'CAMINHO_INVALIDO');
    var tipos = evidencia ? EXT_EVIDENCIA : EXT_IMAGEM;
    var tipo = tipos[path.extname(alvo).toLowerCase()];
    if (!tipo) throw erroDe('tipo de arquivo não servido', 'TIPO');
    if (!fs.existsSync(alvo)) throw erroDe('arquivo não encontrado: ' + r, 'NAO_EXISTE');
    return { arquivo: alvo, tipo: tipo, imagem: !!EXT_IMAGEM[path.extname(alvo).toLowerCase()] };
}

/* ==========================================================================
   CRIAR A FICHA NUM REPOSITORIO QUE AINDA NAO TEM
   --------------------------------------------------------------------------
   So ACRESCENTA: gito.json e GITO.md nascem do modelo; o CLAUDE.md ganha a
   linha "@GITO.md" no fim (ou nasce, se nao existir). Nada existente e
   sobrescrito - se ja houver gito.json, recusa.
   ========================================================================== */
var MODELO = path.join(__dirname, '..', 'modelo');

function criarFicha(repo, remotoUrl, hoje) {
    if (fs.existsSync(path.join(repo, ARQUIVO))) throw erroDe('este repositório já tem gito.json');
    hoje = hoje || new Date().toISOString().slice(0, 10);
    var nome = path.basename(repo);
    var modelo = JSON.parse(fs.readFileSync(path.join(MODELO, 'gito.json'), 'utf8'));
    modelo.aplicacao.nome = nome;
    modelo.aplicacao.codigo = nome.toUpperCase().normalize('NFD').replace(/[^A-Z0-9]/g, '').slice(0, 6) || 'APP';
    modelo.atualizadoEm = hoje;
    modelo.compilacao.data = hoje;
    modelo.historico[0].data = hoje;
    if (remotoUrl) modelo.ficha.links[0].url = remotoUrl;
    var criados = [];
    gravarJson(path.join(repo, ARQUIVO), modelo); criados.push(ARQUIVO);
    if (!fs.existsSync(path.join(repo, 'GITO.md'))) {
        fs.copyFileSync(path.join(MODELO, 'GITO.md'), path.join(repo, 'GITO.md')); criados.push('GITO.md');
    }
    var claude = path.join(repo, 'CLAUDE.md');
    var trecho = fs.readFileSync(path.join(MODELO, 'CLAUDE.md'), 'utf8');
    if (!fs.existsSync(claude)) { fs.writeFileSync(claude, trecho, 'utf8'); criados.push('CLAUDE.md'); }
    else if (!/@GITO\.md/.test(fs.readFileSync(claude, 'utf8'))) {
        fs.appendFileSync(claude, '\n\n' + trecho, 'utf8'); criados.push('CLAUDE.md (linha @GITO.md acrescentada)');
    }
    return { criados: criados, codigo: modelo.aplicacao.codigo };
}

module.exports = {
    ARQUIVO: ARQUIVO, TIPOS_ISSUE: TIPOS_ISSUE, PRIORIDADES: PRIORIDADES, SITUACOES: SITUACOES,
    subValida: subValida, pastaDaApp: pastaDaApp, acharAplicacoes: acharAplicacoes,
    lerFicha: lerFicha, lerFichaDaPasta: lerFichaDaPasta, versoes: versoes,
    listarIssues: listarIssues, resumoIssues: resumoIssues, salvarIssue: salvarIssue, comentar: comentar,
    arquivoDaApp: arquivoDaApp, criarFicha: criarFicha, idValido: idValido
};
