/* ============================================================================
   gitlab.js - CONSULTAR os Merge Requests do repositorio
   ============================================================================
   SO LEITURA, DE PROPOSITO

   Listar os pedidos abertos, ver o estado de cada um (conflito, pipeline,
   aprovacoes) e o que ele muda. Aprovar, aceitar e fechar NAO existem aqui:
   aceitar um Merge Request e o ponto de revisao de codigo do time, e trazer
   isso para uma ferramenta propria e mudanca de processo - que passa antes
   pela avaliacao de Governanca e Compliance. Ate la, a decisao continua no
   GitLab, onde ja esta registrada e protegida.

   Nenhuma chamada deste arquivo usa POST, PUT ou DELETE contra o GitLab. Um
   teste confere isso (teste-gitlab.js) - para ninguem acrescentar uma escrita
   "pequena" sem perceber que mudou a natureza do modulo.

   O TOKEN

   A credencial que o git usa para enviar e trazer NAO abre a API do GitLab.
   Aqui vale um token de acesso pessoal com o escopo read_api - o MINIMO para
   ler: com ele, nem por engano da para escrever nada no GitLab.

   Ele fica em memoria, nesta instancia: fechou o app,
   esqueceu. Nunca vai para disco, para log, nem de volta para a tela - a tela
   so fica sabendo SE esta conectado e com qual usuario.

   E so vai para o servidor de onde o repositorio vem: o host sai do remoto do
   proprio repositorio, e o token fica guardado POR host. Um repositorio de
   outro servidor nao recebe o token deste.
============================================================================ */
'use strict';

var https = require('https');
var url = require('url');

var git = require('./git');

var TIMEOUT_MS = 30000;

/* host -> { token, usuario, nome }. So em memoria. */
var tokens = {};

/* --------------------------------------------------------------------------
   De qual projeto do GitLab este repositorio e: o remoto "origin" (ou o
   primeiro), convertido para o endereco do site sem credencial.
   -------------------------------------------------------------------------- */
function projetoDoRepo(repo) {
    return git.remotes(repo).then(function (rs) {
        if (!rs.length) {
            throw Object.assign(new Error('este repositório não tem servidor configurado.'),
                                { codigo: 'SEM_REMOTO' });
        }
        var r = rs.filter(function (x) { return x.nome === 'origin'; })[0] || rs[0];
        var web = git.enderecoWeb(r.url);
        var m = web && /^https:\/\/([^\/]+)\/(.+)$/.exec(web);
        if (!m) {
            throw Object.assign(new Error('não reconheci o endereço do servidor deste repositório.'),
                                { codigo: 'SEM_GITLAB' });
        }
        if (/github\.com$/i.test(m[1])) {
            throw Object.assign(new Error('este repositório está no GitHub — a consulta é de Merge Requests do GitLab.'),
                                { codigo: 'SEM_GITLAB' });
        }
        return { host: m[1], caminho: m[2], web: web, id: encodeURIComponent(m[2]) };
    });
}

/* O endereco que abre a tela de criar token ja com nome e escopo preenchidos
   (o GitLab aceita os dois na URL). Poupa a pessoa de achar a pagina e,
   principalmente, de marcar um escopo maior do que o necessario. */
function enderecoCriarToken(host) {
    return 'https://' + host + '/-/user_settings/personal_access_tokens?name=gito&scopes=read_api';
}

/* --------------------------------------------------------------------------
   GET na API. So GET - ver o cabecalho.
   -------------------------------------------------------------------------- */
function chamar(host, token, caminho) {
    return new Promise(function (resolve, reject) {
        var alvo = new url.URL('https://' + host + '/api/v4' + caminho);
        var req = https.request({
            protocol: 'https:', hostname: alvo.hostname, port: alvo.port || 443,
            path: alvo.pathname + alvo.search, method: 'GET',
            headers: { 'PRIVATE-TOKEN': token, Accept: 'application/json',
                       'User-Agent': 'gito' },
            timeout: TIMEOUT_MS
        }, function (res) {
            var corpo = '';
            res.setEncoding('utf8');
            res.on('data', function (d) { corpo += d; });
            res.on('end', function () {
                if (res.statusCode === 401) {
                    /* Token revogado ou expirado: esquecer, para a tela pedir
                       outro em vez de insistir com o morto. */
                    delete tokens[host];
                    return reject(Object.assign(
                        new Error('o GitLab não aceitou o token (inválido, revogado ou expirado). Conecte de novo.'),
                        { codigo: 'GITLAB_TOKEN' }));
                }
                if (res.statusCode === 403) {
                    return reject(Object.assign(
                        new Error('o token não tem permissão para isto. Ele precisa do escopo read_api.'),
                        { codigo: 'GITLAB_ESCOPO' }));
                }
                if (res.statusCode === 404) {
                    return reject(Object.assign(
                        new Error('o GitLab não encontrou isto — ou o seu usuário não tem acesso a este projeto.'),
                        { codigo: 'GITLAB_404' }));
                }
                if (res.statusCode !== 200) {
                    return reject(new Error('o GitLab respondeu HTTP ' + res.statusCode));
                }
                try { resolve(JSON.parse(corpo)); }
                catch (e) { reject(new Error('resposta inesperada do GitLab')); }
            });
        });
        req.on('timeout', function () {
            req.destroy();
            reject(Object.assign(new Error('o GitLab não respondeu em ' + (TIMEOUT_MS / 1000) + 's'),
                                 { codigo: 'REDE' }));
        });
        req.on('error', function (e) {
            reject(Object.assign(new Error(e.code === 'ENOTFOUND'
                ? 'não encontrei o servidor "' + host + '". Confira a rede.'
                : 'não consegui falar com o GitLab: ' + e.message), { codigo: 'REDE' }));
        });
        req.end();
    });
}

function exigirToken(p) {
    var t = tokens[p.host];
    if (!t) {
        throw Object.assign(new Error('conecte ao GitLab para ver os Merge Requests.'),
                            { codigo: 'GITLAB_SEM_TOKEN', criarToken: enderecoCriarToken(p.host) });
    }
    return t;
}

/* --------------------------------------------------------------------------
   CONECTAR / ESTADO / SAIR
   -------------------------------------------------------------------------- */
function estado(repo) {
    return projetoDoRepo(repo).then(function (p) {
        var t = tokens[p.host];
        return {
            host: p.host, projeto: p.caminho, web: p.web,
            conectado: !!t, usuario: t ? t.usuario : null, nome: t ? t.nome : null,
            criarToken: enderecoCriarToken(p.host)
        };
    });
}

/* O token so e guardado depois de PROVAR que funciona - para o usuario e para
   este projeto. Guardar um token que nao abre o projeto trocaria um erro
   claro agora ("nao ve este projeto") por um confuso depois. */
function conectar(repo, token) {
    var tk = String(token || '').trim();
    if (!tk) return Promise.reject(new Error('cole o token de acesso'));
    if (/\s/.test(tk)) return Promise.reject(new Error('o token não tem espaços — confira o que foi colado'));

    return projetoDoRepo(repo).then(function (p) {
        return chamar(p.host, tk, '/user').then(function (u) {
            return chamar(p.host, tk, '/projects/' + p.id).then(function () {
                tokens[p.host] = { token: tk, usuario: u.username, nome: u.name };
                return estado(repo);
            }, function (e) {
                if (e.codigo === 'GITLAB_404') {
                    throw Object.assign(
                        new Error('o token funciona, mas o usuário "' + u.username +
                                  '" não enxerga o projeto ' + p.caminho + '.'),
                        { codigo: 'GITLAB_404' });
                }
                throw e;
            });
        });
    });
}

function sair(repo) {
    return projetoDoRepo(repo).then(function (p) {
        delete tokens[p.host];
        return estado(repo);
    });
}

/* --------------------------------------------------------------------------
   O ESTADO DE UM PEDIDO, EM PORTUGUES

   detailed_merge_status e o campo que o GitLab usa para dizer por que um
   pedido pode ou nao ser juntado. Os nomes crus ("ci_must_pass") nao dizem
   nada para quem abre a tela; o que ele NAO conhece passa cru, em vez de
   virar um "desconhecido" que esconde a informacao.
   -------------------------------------------------------------------------- */
var ESTADOS = {
    mergeable:                  { texto: 'pronto para juntar',        tom: 'ok' },
    conflict:                   { texto: 'com conflito',              tom: 'ruim' },
    broken_status:              { texto: 'com conflito',              tom: 'ruim' },
    need_rebase:                { texto: 'precisa atualizar a branch', tom: 'ruim' },
    ci_must_pass:               { texto: 'esperando o pipeline',      tom: 'espera' },
    ci_still_running:           { texto: 'pipeline rodando',          tom: 'espera' },
    not_approved:               { texto: 'falta aprovação',           tom: 'espera' },
    requested_changes:          { texto: 'mudanças pedidas',          tom: 'ruim' },
    discussions_not_resolved:   { texto: 'discussões abertas',        tom: 'espera' },
    draft_status:               { texto: 'rascunho',                  tom: 'espera' },
    checking:                   { texto: 'verificando',               tom: 'espera' },
    unchecked:                  { texto: 'verificando',               tom: 'espera' },
    approvals_syncing:          { texto: 'verificando',               tom: 'espera' },
    not_open:                   { texto: 'fechado',                   tom: 'neutro' },
    blocked_status:             { texto: 'bloqueado por outro pedido', tom: 'ruim' },
    merge_request_blocked:      { texto: 'bloqueado por outro pedido', tom: 'ruim' },
    security_policy_violations: { texto: 'bloqueado por política',    tom: 'ruim' }
};

function traduzirEstado(mr) {
    if (mr.state === 'merged') return { codigo: 'merged', texto: 'juntado', tom: 'ok' };
    if (mr.state === 'closed') return { codigo: 'closed', texto: 'fechado', tom: 'neutro' };
    var c = mr.detailed_merge_status || mr.merge_status || '';
    /* has_conflicts vale mais que o status: o status pode estar "checking"
       enquanto o conflito ja e sabido - e conflito e o que a pessoa precisa
       ver primeiro. */
    if (mr.has_conflicts) return { codigo: 'conflict', texto: 'com conflito', tom: 'ruim' };
    var e = ESTADOS[c];
    return e ? { codigo: c, texto: e.texto, tom: e.tom } : { codigo: c, texto: c || '?', tom: 'neutro' };
}

function resumo(mr) {
    return {
        iid: mr.iid,
        titulo: mr.title,
        autor: mr.author ? (mr.author.name || mr.author.username) : '',
        origem: mr.source_branch,
        destino: mr.target_branch,
        /* Pedido vindo de um fork: a branch de origem mora em OUTRO projeto,
           e nao da para baixa-la deste remoto. */
        mesmoProjeto: mr.source_project_id === mr.target_project_id,
        rascunho: !!(mr.draft || mr.work_in_progress),
        estado: traduzirEstado(mr),
        criadoEm: mr.created_at,
        atualizadoEm: mr.updated_at,
        comentarios: mr.user_notes_count || 0,
        url: mr.web_url
    };
}

/* --------------------------------------------------------------------------
   LISTAR E DETALHAR
   -------------------------------------------------------------------------- */
var SITUACOES = { opened: 1, merged: 1, closed: 1 };

function listarMRs(repo, situacao) {
    var s = SITUACOES[situacao] ? situacao : 'opened';
    return projetoDoRepo(repo).then(function (p) {
        var t = exigirToken(p);
        return chamar(p.host, t.token, '/projects/' + p.id +
                      '/merge_requests?state=' + s + '&order_by=updated_at&sort=desc&per_page=50')
            .then(function (lista) { return (lista || []).map(resumo); });
    });
}

function nomePipeline(pl) {
    if (!pl) return null;
    var nomes = {
        success: 'passou', failed: 'falhou', running: 'rodando', pending: 'na fila',
        canceled: 'cancelado', skipped: 'pulado', manual: 'esperando ação manual',
        created: 'criado', scheduled: 'agendado', waiting_for_resource: 'esperando recurso'
    };
    return { status: pl.status, texto: nomes[pl.status] || pl.status, url: pl.web_url };
}

/* Um arquivo alterado do pedido. O diff vem da API ja no formato unificado
   ("@@ -1,3 +1,3 @@ ..."), o mesmo que a tela ja pinta para o git local.
   Arquivo grande demais o GitLab manda sem diff (too_large / collapsed): isso
   vira um aviso, nao um diff vazio que pareceria "nada mudou". */
function arquivoDoDiff(f) {
    return {
        caminho: f.new_path || f.old_path,
        antigo: f.renamed_file ? f.old_path : null,
        novo: !!f.new_file, apagado: !!f.deleted_file, renomeado: !!f.renamed_file,
        grande: !!(f.too_large || (f.collapsed && !f.diff)),
        diff: f.diff || ''
    };
}

function detalheMR(repo, iid) {
    var n = parseInt(iid, 10);
    if (!(n > 0)) return Promise.reject(new Error('número do Merge Request inválido'));

    return projetoDoRepo(repo).then(function (p) {
        var t = exigirToken(p);
        var base = '/projects/' + p.id + '/merge_requests/' + n;

        /* Aprovacoes e commits sao extras: se falharem (versao do GitLab, plano
           sem o recurso), o resto do detalhe continua valendo. */
        var opcional = function (promessa) { return promessa.catch(function () { return null; }); };

        return Promise.all([
            chamar(p.host, t.token, base + '?include_diverged_commits_count=true'),
            opcional(chamar(p.host, t.token, base + '/approvals')),
            opcional(chamar(p.host, t.token, base + '/commits?per_page=50')),
            /* /diffs chegou no GitLab 15.7; antes, /changes. */
            chamar(p.host, t.token, base + '/diffs?per_page=100').then(null, function (e) {
                if (e.codigo !== 'GITLAB_404') throw e;
                return chamar(p.host, t.token, base + '/changes').then(function (c) { return c.changes || []; });
            })
        ]).then(function (rs) {
            var mr = rs[0], ap = rs[1], commits = rs[2], arquivos = rs[3] || [];
            var r = resumo(mr);
            r.descricao = mr.description || '';
            r.pipeline = nomePipeline(mr.head_pipeline || mr.pipeline);
            r.atrasadoEm = typeof mr.diverged_commits_count === 'number' ? mr.diverged_commits_count : null;
            r.aprovacoes = ap ? {
                aprovadoPor: (ap.approved_by || []).map(function (a) {
                    return a.user ? (a.user.name || a.user.username) : '';
                }).filter(Boolean),
                faltam: typeof ap.approvals_left === 'number' ? ap.approvals_left : null
            } : null;
            r.commits = (commits || []).map(function (c) {
                return { curto: c.short_id, titulo: c.title, autor: c.author_name, data: c.created_at };
            });
            r.arquivos = arquivos.map(arquivoDoDiff);
            return r;
        });
    });
}

module.exports = {
    estado: estado,
    conectar: conectar,
    sair: sair,
    listarMRs: listarMRs,
    detalheMR: detalheMR,
    /* para os testes */
    traduzirEstado: traduzirEstado,
    resumo: resumo,
    arquivoDoDiff: arquivoDoDiff,
    enderecoCriarToken: enderecoCriarToken,
    _projetoDoRepo: projetoDoRepo
};
