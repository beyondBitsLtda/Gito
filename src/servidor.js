/* ============================================================================
   servidor.js - o HTTP local, e as travas que o tornam seguro
   ============================================================================
   Uma interface web que executa git em caminhos do disco E UM TERMINAL REMOTO
   se for mal fechada. As travas abaixo nao sao opcionais, e cada uma fecha um
   caminho que as outras nao fecham.

   1. ESCUTA SO EM 127.0.0.1
      Nunca 0.0.0.0. Sem isso, qualquer pessoa na rede abre o IP da maquina do
      dev no navegador e comanda o disco dele.

   2. TOKEN POR EXECUCAO
      O bind em loopback NAO protege contra o proprio navegador do dev: uma aba
      aberta em qualquer site pode fazer requisicao para 127.0.0.1. O token,
      gerado a cada inicializacao e exigido em toda chamada da API, e o que
      impede isso - o site de fora nao tem como adivinha-lo.

   3. CONFERENCIA DE Host E Origin
      Fecha o DNS rebinding, que e exatamente a tecnica que contorna as duas
      travas anteriores: um dominio que resolve para 127.0.0.1 faz o navegador
      tratar o app como "mesma origem".

   4. A CERCA DE PASTAS  (config.js)
      O app so opera dentro das pastas que o proprio usuario cadastrou.

   RESPOSTA SEMPRE NA MESMA FORMA - { ok, codigo, mensagem, dados } - para a
   tela ter UM tratador de erro, e nao um por rota.
============================================================================ */
'use strict';

var http = require('http');
var fs = require('fs');
var path = require('path');
var crypto = require('crypto');
var os = require('os');

var git = require('./git');
var repos = require('./repos');
var config = require('./config');
var gitlab = require('./gitlab');
var painel = require('./painel');
var verificar = require('./verificar');

var WEB = path.join(__dirname, '..', 'web');

/* O CODIGO DO SERVIDOR MUDOU DEPOIS QUE O GITO ABRIU?
   A interface (web/) e lida do disco a cada pedido e pega mudancas sozinha;
   o servidor (src/, app.js) so muda reabrindo. Sem este aviso, a tela nova
   chamava uma rota que o servidor velho nao tinha e aparecia "nao existe:
   GET /api/painel" - visto em 26/09, logo depois de o painel chegar. */
var INICIO = Date.now();
function codigoMudou() {
    var arqs = [path.join(__dirname, '..', 'app.js')];
    try { fs.readdirSync(__dirname).forEach(function (f) { if (/\.js$/.test(f)) arqs.push(path.join(__dirname, f)); }); } catch (e) { /* segue */ }
    return arqs.some(function (a) { try { return fs.statSync(a).mtimeMs > INICIO; } catch (e) { return false; } });
}
var CORPO_MAX = 256 * 1024;
/* Evidencias de issue vao em base64 no corpo: ate 3 arquivos de 8 MB. */
var CORPO_MAX_EVIDENCIA = 34 * 1024 * 1024;

var TIPOS = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png'
};

function criar(token) {

    function responder(res, http_status, corpo) {
        var txt = JSON.stringify(corpo);
        res.writeHead(http_status, {
            'Content-Type': 'application/json; charset=utf-8',
            'Cache-Control': 'no-store',
            /* A pagina nao carrega nada de fora e nao pode ser embutida em
               outro site - as duas coisas que transformariam a interface num
               alvo. */
            'Content-Security-Policy': "default-src 'self'; frame-ancestors 'none'",
            'X-Content-Type-Options': 'nosniff'
        });
        res.end(txt);
    }

    function ok(res, dados) {
        responder(res, 200, { ok: true, codigo: '', mensagem: '', dados: dados === undefined ? null : dados });
    }

    /* O `detalhe` carrega a saída CRUA do git. A tradução em português ajuda
       quem entende; o detalhe salva quem precisa mostrar para alguém. Trocar
       um pelo outro foi o erro da primeira versão: a mensagem real sumia, e
       com ela a única informação que permitia achar a causa. */
    function erro(res, http_status, codigo, mensagem, detalhe) {
        responder(res, http_status, {
            ok: false, codigo: codigo, mensagem: mensagem,
            detalhe: detalhe || '', dados: null
        });
    }

    /* --------------------------------------------------------------------
       TRAVA 3 - so aceitamos pedido que diz vir do proprio loopback.
       -------------------------------------------------------------------- */
    function origemConfiavel(req) {
        var host = String(req.headers.host || '');
        if (!/^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/i.test(host)) return false;

        var origem = req.headers.origin;
        if (origem && !/^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/i.test(origem)) {
            return false;
        }
        return true;
    }

    /* TRAVA 2 - o token. Tres portas, e a ordem importa pouco porque as tres
       exigem o mesmo segredo:

         cabecalho  o que o JS da pagina manda
         cookie     o que permite o ENDERECO CURTO funcionar: o atalho da
                    Area de Trabalho e a inicializacao com o Windows abrem
                    "http://127.0.0.1:7027/", que nao leva token nenhum
         query      a primeira abertura, pelo endereco que o console imprime -
                    e quem planta o cookie

       O cookie e HttpOnly: o JavaScript da propria pagina nao o le, e nenhum
       script de outro site tem como alcança-lo.

       E SameSite=STRICT. O antecessor usava Lax porque era aberto por um link
       dentro de OUTRO site (o painel da plataforma), e Strict nao manda o
       cookie em navegacao vinda de fora. O Gito nao tem esse link: ele abre
       pelo atalho, pelo endereco digitado ou pela inicializacao do Windows -
       e nenhum desses e navegacao de outro site. Entao a trava mais fechada
       nao custa nada: nem uma pagina GET do app um site de fora consegue
       abrir com o seu cookie. */
    function tokenDoPedido(req, url) {
        var h = req.headers['x-gito-token'];
        if (h) return String(h);

        var bruto = String(req.headers.cookie || '');
        var m = /(?:^|;\s*)gito=([^;]+)/.exec(bruto);
        if (m) return decodeURIComponent(m[1]);

        return url.searchParams.get('t') || '';
    }

    function autorizado(req, url) {
        var t = tokenDoPedido(req, url);
        if (t.length !== token.length) return false;
        /* Comparacao de tempo constante: com == , o tempo da resposta vaza
           quantos caracteres iniciais estavam certos. */
        return crypto.timingSafeEqual(Buffer.from(t), Buffer.from(token));
    }

    /* Planta o cookie quando a pagina e aberta com o token na URL. A partir
       daqui, o endereco curto (sem token nenhum) passa a funcionar neste
       navegador. */
    function plantarCookie(req, url, res) {
        var t = url.searchParams.get('t');
        if (!t || t.length !== token.length) return;
        try {
            if (!crypto.timingSafeEqual(Buffer.from(t), Buffer.from(token))) return;
        } catch (e) { return; }

        res.setHeader('Set-Cookie',
            'gito=' + encodeURIComponent(token) +
            '; Path=/; HttpOnly; SameSite=Strict; Max-Age=' + (60 * 60 * 24 * 365));
    }

    function lerCorpo(req, limite) {
        limite = limite || CORPO_MAX;
        return new Promise(function (resolve, reject) {
            var bruto = '';
            req.on('data', function (d) {
                bruto += d;
                if (bruto.length > limite) { req.destroy(); reject(new Error('pedido grande demais')); }
            });
            req.on('end', function () {
                if (!bruto) return resolve({});
                try { resolve(JSON.parse(bruto)); }
                catch (e) { reject(new Error('pedido malformado')); }
            });
            req.on('error', reject);
        });
    }

    /* Todo caminho vindo da tela passa por aqui, sem excecao. */
    function caminhoValidado(p) {
        var recusa = config.caminhoAceitavel(p);
        if (recusa) throw Object.assign(new Error(recusa), { codigo: 'CAMINHO_INVALIDO' });

        var cfg = config.ler();
        if (!config.dentroDasPastas(p, cfg.pastas)) {
            throw Object.assign(
                new Error('esta pasta nao esta na sua lista. Acrescente em "Minhas pastas".'),
                { codigo: 'FORA_DA_CERCA' });
        }
        return path.resolve(p);
    }

    /* Quem assina uma acao do painel (issue, comentario): a mesma identidade
       que assina os commits. Sem ela, recusa - como o salvar. */
    function autorDaAcao() {
        return git.identidade().then(function (id) {
            if (!id.completa) {
                throw Object.assign(new Error('antes, diga quem você é (nome e e-mail) — é o que assina issues e comentários.'),
                                    { codigo: 'SEM_IDENTIDADE' });
            }
            return id.nome + ' <' + id.email + '>';
        });
    }

    /* ====================================================================
       ROTAS
       ==================================================================== */
    var ROTAS = {
        'GET /api/versao': function () {
            return Promise.resolve({ desatualizado: codigoMudou() });
        },

        'GET /api/estado': function () {
            return Promise.all([git.versao(), git.identidade()]).then(function (r) {
                var cfg = config.ler();
                return { git: r[0], identidade: r[1], pastas: cfg.pastas, arquivoConfig: config.arquivo() };
            });
        },

        'GET /api/repos': function () {
            return repos.listar(config.ler().pastas);
        },

        'GET /api/repo': function (req, url) {
            return Promise.resolve(caminhoValidado(url.searchParams.get('p')))
                .then(repos.detalhe);
        },

        'POST /api/salvar': function (req, url, corpo) {
            var alvo = caminhoValidado(corpo.p);

            /* Autoria ANTES de escrever. Commit com nome errado so aparece
               semanas depois, no historico, quando ja esta em todos eles. */
            return git.identidade().then(function (id) {
                if (!id.completa) {
                    throw Object.assign(
                        new Error('antes de salvar, diga quem voce e (nome e e-mail).'),
                        { codigo: 'SEM_IDENTIDADE' });
                }
                return git.salvar(alvo, corpo.mensagem, corpo.arquivos);
            });
        },

        'GET /api/historico': function (req, url) {
            var alvo = caminhoValidado(url.searchParams.get('p'));
            return git.historico(alvo, url.searchParams.get('n') || 30);
        },

        'GET /api/branches': function (req, url) {
            return git.branches(caminhoValidado(url.searchParams.get('p')));
        },

        'GET /api/remotes': function (req, url) {
            return git.remotes(caminhoValidado(url.searchParams.get('p')));
        },

        'GET /api/arvore': function (req, url) {
            var alvo = caminhoValidado(url.searchParams.get('p'));
            return git.arvore(alvo, url.searchParams.get('ref') || 'HEAD');
        },

        'GET /api/ver-arquivo': function (req, url) {
            var alvo = caminhoValidado(url.searchParams.get('p'));
            return git.arquivoDeCommit(alvo, String(url.searchParams.get('ref') || 'HEAD'),
                                       String(url.searchParams.get('a') || ''))
                .then(function (texto) { return { conteudo: texto }; });
        },

        'POST /api/branch': function (req, url, corpo) {
            return git.trocarBranch(caminhoValidado(corpo.p), String(corpo.nome || ''));
        },

        'GET /api/diff': function (req, url) {
            var alvo = caminhoValidado(url.searchParams.get('p'));
            return git.diff(alvo, String(url.searchParams.get('a') || ''));
        },

        'GET /api/arquivo-antigo': function (req, url) {
            var alvo = caminhoValidado(url.searchParams.get('p'));
            return git.arquivoDeCommit(alvo, String(url.searchParams.get('ref') || ''),
                                       String(url.searchParams.get('a') || ''))
                .then(function (texto) { return { conteudo: texto }; });
        },

        'POST /api/enviar': function (req, url, corpo) {
            var alvo = caminhoValidado(corpo.p);
            if (corpo.criarUpstream) {
                return git.enviarCriandoUpstream(alvo, String(corpo.branch || ''));
            }
            return git.enviar(alvo);
        },

        'POST /api/trazer': function (req, url, corpo) {
            return git.trazer(caminhoValidado(corpo.p));
        },

        /* ---------------- JUNTAR AS DUAS HISTÓRIAS ----------------
           Só depois de "trazer" dizer DIVERGIU, e só com a pessoa
           confirmando: é a única operação do app que pode gerar conflito,
           e ela não acontece por acidente. */
        'POST /api/juntar': function (req, url, corpo) {
            return git.juntar(caminhoValidado(corpo.p));
        },

        'POST /api/resolver': function (req, url, corpo) {
            var repo = caminhoValidado(corpo.p);
            var arquivo = String(corpo.arquivo || '');
            var lado = String(corpo.lado || '');
            if (!arquivo) throw new Error('escolha o arquivo');
            if (lado !== 'meu' && lado !== 'deles') throw new Error('lado inválido');
            return git.resolverConflito(repo, arquivo, lado);
        },

        'POST /api/concluir-juncao': function (req, url, corpo) {
            return git.concluirJuncao(caminhoValidado(corpo.p), corpo.mensagem);
        },

        'POST /api/abortar-juncao': function (req, url, corpo) {
            return git.abortarJuncao(caminhoValidado(corpo.p));
        },

        /* ---------------- CRIAR ----------------
           O repositório nasce numa pasta que a pessoa já cadastrou: a cerca
           vale aqui como em tudo mais, e "git init" grava no disco. */
        'POST /api/criar-repo': function (req, url, corpo) {
            var pasta = caminhoValidado(corpo.p);
            return git.criarRepositorio(pasta, corpo.branch)
                .then(function (st) { return { pasta: pasta, status: st }; });
        },

        'POST /api/criar-branch': function (req, url, corpo) {
            return git.criarBranch(caminhoValidado(corpo.p), String(corpo.nome || ''));
        },

        /* ---------------- BRANCH <-> SERVIDOR ----------------
           Publicar cria no servidor a branch que só existe aqui. Trazer outra
           branch é o merge local (mexe na pasta, com as travas do trazer). O
           Merge Request o app NÃO faz: devolve o endereço do pedido já
           preenchido, e quem cria é a pessoa, no GitLab. */
        'POST /api/publicar-branch': function (req, url, corpo) {
            return git.publicarBranch(caminhoValidado(corpo.p), String(corpo.branch || ''));
        },

        'GET /api/branches-remotas': function (req, url) {
            return git.branchesRemotas(caminhoValidado(url.searchParams.get('p')));
        },

        /* ---------------- MERGE REQUESTS (só consulta) ----------------
           Ver gitlab.js: nada aqui escreve no GitLab. O token entra por
           /conectar e nunca volta para a tela. */
        'GET /api/gitlab/estado': function (req, url) {
            return gitlab.estado(caminhoValidado(url.searchParams.get('p')));
        },

        'POST /api/gitlab/conectar': function (req, url, corpo) {
            return gitlab.conectar(caminhoValidado(corpo.p), String(corpo.token || ''));
        },

        'POST /api/gitlab/sair': function (req, url, corpo) {
            return gitlab.sair(caminhoValidado(corpo.p));
        },

        'GET /api/gitlab/mrs': function (req, url) {
            return gitlab.listarMRs(caminhoValidado(url.searchParams.get('p')),
                                    String(url.searchParams.get('situacao') || 'opened'));
        },

        'GET /api/gitlab/mr': function (req, url) {
            return gitlab.detalheMR(caminhoValidado(url.searchParams.get('p')),
                                    url.searchParams.get('iid'));
        },

        /* Fetch e só: atualiza o que o app sabe do servidor, sem mexer na
           pasta. É POST porque fala com o servidor e grava refs aqui. */
        'POST /api/atualizar-servidor': function (req, url, corpo) {
            return git.atualizarDoServidor(caminhoValidado(corpo.p));
        },

        'POST /api/baixar-branch': function (req, url, corpo) {
            return git.baixarBranch(caminhoValidado(corpo.p), String(corpo.nome || ''));
        },

        'POST /api/trazer-branch': function (req, url, corpo) {
            return git.trazerBranch(caminhoValidado(corpo.p), String(corpo.origem || ''));
        },

        'GET /api/link-mr': function (req, url) {
            return git.linkMergeRequest(caminhoValidado(url.searchParams.get('p')),
                                        String(url.searchParams.get('origem') || ''),
                                        String(url.searchParams.get('destino') || ''));
        },

        /* Navegar para ESCOLHER uma pasta. Fora da cerca de propósito: é o
           passo anterior a cadastrá-la, e a pessoa já vê o disco inteiro no
           Explorer com a mesma conta. O ".." continua recusado, e nenhuma
           operação do git passa por aqui. */
        'GET /api/navegar': function (req, url) {
            var p = url.searchParams.get('p');
            if (p) {
                var recusa = config.caminhoAceitavel(p);
                if (recusa) throw Object.assign(new Error(recusa), { codigo: 'CAMINHO_INVALIDO' });
            }
            return repos.navegar(p ? path.resolve(p) : null);
        },

        /* ---------------- O PAINEL DAS APLICACOES ----------------
           Versoes (lidas do git, de cada branch), ficha tecnica, verificacao
           de servicos e issues. O contrato do gito.json esta em GITO.md. */
        'GET /api/painel': function () {
            var itens = repos.candidatos(config.ler().pastas).filter(function (r) { return r.versionado && !r.erro; });
            var aplicacoes = [], semFicha = [];
            return Promise.all(itens.map(function (r) {
                var subs = painel.acharAplicacoes(r.caminho);
                if (!subs.length) { semFicha.push({ caminho: r.caminho, nome: r.nome }); return null; }
                return Promise.all(subs.map(function (sub) {
                    var dir = painel.pastaDaApp(r.caminho, sub);
                    var ficha = painel.lerFichaDaPasta(dir);
                    return painel.versoes(r.caminho, sub, 8).then(null, function (e) { return { erro: e.message, branches: [] }; })
                        .then(function (v) {
                            aplicacoes.push({ repo: r.caminho, repoNome: r.nome, sub: sub,
                                              ficha: ficha, versoes: v, issues: painel.resumoIssues(dir) });
                        });
                }));
            })).then(function () {
                aplicacoes.sort(function (a, b) {
                    var na = a.ficha && a.ficha.dados ? a.ficha.dados.aplicacao.nome : a.repoNome;
                    var nb = b.ficha && b.ficha.dados ? b.ficha.dados.aplicacao.nome : b.repoNome;
                    return na.localeCompare(nb, 'pt-BR');
                });
                semFicha.sort(function (a, b) { return a.nome.localeCompare(b.nome, 'pt-BR'); });
                return { aplicacoes: aplicacoes, semFicha: semFicha };
            });
        },

        'GET /api/painel/app': function (req, url) {
            var repo = caminhoValidado(url.searchParams.get('p'));
            var sub = painel.subValida(url.searchParams.get('sub'));
            var dir = painel.pastaDaApp(repo, sub);
            var ficha = painel.lerFichaDaPasta(dir);
            if (!ficha) throw Object.assign(new Error('esta pasta não tem gito.json'), { codigo: 'SEM_FICHA' });
            return painel.versoes(repo, sub).then(function (v) {
                return { repo: repo, repoNome: path.basename(repo), sub: sub, ficha: ficha, versoes: v,
                         issues: painel.resumoIssues(dir) };
            });
        },

        'GET /api/painel/verificar': function (req, url) {
            var repo = caminhoValidado(url.searchParams.get('p'));
            var dir = painel.pastaDaApp(repo, url.searchParams.get('sub'));
            var ficha = painel.lerFichaDaPasta(dir);
            if (!ficha || !ficha.dados) return [];
            return verificar.verificarTodos(verificar.alvosDaFicha(ficha.dados.ficha), url.searchParams.get('forcar') === '1');
        },

        'GET /api/painel/issues': function (req, url) {
            var repo = caminhoValidado(url.searchParams.get('p'));
            var dir = painel.pastaDaApp(repo, url.searchParams.get('sub'));
            var ficha = painel.lerFichaDaPasta(dir);
            if (!ficha || !ficha.dados) throw Object.assign(new Error('esta pasta não tem gito.json válido'), { codigo: 'SEM_FICHA' });
            var l = painel.listarIssues(dir);
            /* Sugestoes de responsavel: quem ja aparece nas issues e nos contatos. */
            var pessoas = {};
            l.issues.forEach(function (i) { if (i.responsavel) pessoas[i.responsavel] = 1; });
            (ficha.dados.ficha.contatos || []).forEach(function (c) { if (c && c.nome) pessoas[c.nome] = 1; });
            if (ficha.dados.aplicacao.responsavel) pessoas[ficha.dados.aplicacao.responsavel] = 1;
            return git.identidade().then(function (id) {
                if (id.nome) pessoas[id.nome] = 1;
                return { codigo: ficha.dados.aplicacao.codigo, issues: l.issues, problemas: l.problemas,
                         pessoas: Object.keys(pessoas).sort(), eu: id.nome || '',
                         tipos: painel.TIPOS_ISSUE, prioridades: painel.PRIORIDADES, situacoes: painel.SITUACOES };
            });
        },

        /* As issues de TODAS as aplicações das pastas cadastradas: a Lista, o
           Kanban e a Agenda do painel unificado (GITO-0002). Só leitura: mudar
           uma issue continua passando por POST /api/painel/issue. */
        'GET /api/painel/issues-todas': function () {
            var itens = repos.candidatos(config.ler().pastas).filter(function (r) { return r.versionado && !r.erro; });
            var d = painel.issuesDeTodas(itens);
            return git.identidade().then(function (id) {
                var pessoas = {};
                d.issues.forEach(function (i) { if (i.responsavel) pessoas[i.responsavel] = 1; });
                if (id.nome) pessoas[id.nome] = 1;
                return Object.assign(d, { pessoas: Object.keys(pessoas).sort(), eu: id.nome || '',
                                          tipos: painel.TIPOS_ISSUE, prioridades: painel.PRIORIDADES, situacoes: painel.SITUACOES });
            });
        },

        'POST /api/painel/issue': function (req, url, corpo) {
            var repo = caminhoValidado(corpo.p);
            var dir = painel.pastaDaApp(repo, corpo.sub);
            var ficha = painel.lerFichaDaPasta(dir);
            if (!ficha || !ficha.dados) throw new Error('esta pasta não tem gito.json válido');
            return autorDaAcao().then(function (autor) {
                return painel.salvarIssue(dir, ficha.dados.aplicacao.codigo, corpo.id || null, corpo.dados || {}, autor);
            });
        },

        'POST /api/painel/comentario': function (req, url, corpo) {
            var repo = caminhoValidado(corpo.p);
            var dir = painel.pastaDaApp(repo, corpo.sub);
            if (!painel.lerFichaDaPasta(dir)) throw new Error('esta pasta não tem gito.json');
            if ((corpo.anexos || []).length > 3) throw new Error('no máximo 3 evidências por comentário');
            return autorDaAcao().then(function (autor) {
                return painel.comentar(dir, corpo.id, corpo.texto, corpo.anexos, autor);
            });
        },

        'POST /api/painel/criar-ficha': function (req, url, corpo) {
            var repo = caminhoValidado(corpo.p);
            if (!repos.ehRepo(repo)) throw new Error('esta pasta não é um repositório');
            return git.remotes(repo).then(function (rs) {
                var web = '';
                try { web = rs.length ? git.enderecoWeb(rs[0].url) : ''; } catch (e) { web = ''; }
                /* Endereco com usuario/senha embutidos nunca vai para a ficha. */
                if (/\/\/[^/]*@/.test(web)) web = web.replace(/\/\/[^/]*@/, '//');
                return painel.criarFicha(repo, web);
            });
        },

        'GET /api/config': function () {
            return Promise.resolve(config.ler());
        },

        'POST /api/config': function (req, url, corpo) {
            var pastas = (corpo.pastas || []).map(String).filter(function (p) { return p.trim(); });
            for (var i = 0; i < pastas.length; i++) {
                var recusa = config.caminhoAceitavel(pastas[i]);
                if (recusa) throw Object.assign(new Error(recusa), { codigo: 'CAMINHO_INVALIDO' });
                if (!fs.existsSync(pastas[i])) {
                    throw Object.assign(new Error('nao encontrei: ' + pastas[i]),
                                        { codigo: 'PASTA_INEXISTENTE' });
                }
            }
            return Promise.resolve(config.gravar({ pastas: pastas }));
        },

        'POST /api/identidade': function (req, url, corpo) {
            var nome = String(corpo.nome || '').trim();
            var email = String(corpo.email || '').trim();
            if (!nome || !email) throw new Error('preencha nome e e-mail');
            if (email.indexOf('@') < 0) throw new Error('e-mail invalido');
            return git.definirIdentidade(nome, email);
        }
    };

    /* A tela de "este navegador ainda nao foi autorizado".

       Ela existe porque o endereco curto leva gente aqui sem token: quem abriu
       pelo atalho num navegador novo nunca passou pelo endereco que o console
       imprime. Um 401 cru, ou uma tela em branco, faria a pessoa achar que o
       app esta quebrado. */
    function paginaSemToken(res) {
        var html = '<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8">' +
            '<title>gito</title><link rel="stylesheet" href="/app.css"></head><body>' +
            '<header class="topo"><div class="topo__marca"><span class="marca__glifo" aria-hidden="true"></span>gito</div></header>' +
            '<main class="conteudo">' +
            '<h1 class="titulo">Este navegador ainda não foi autorizado</h1>' +
            '<p class="ajuda">O gito está rodando, mas este navegador nunca abriu ' +
            'o endereço com a chave de acesso — então ele ainda não pode falar com o app.</p>' +
            '<div class="bloco"><p class="bloco__titulo">O que fazer</p>' +
            '<p class="ajuda">Vá até a <strong>janela preta do gito</strong> e abra o ' +
            'endereço que ela imprimiu (aquele que termina em <code>?t=...</code>). ' +
            'É uma vez só: depois disso, este navegador fica autorizado e o atalho ' +
            'passa a funcionar direto.</p></div>' +
            '<div class="bloco"><p class="bloco__titulo">Se a janela preta não estiver aberta</p>' +
            '<p class="ajuda">O app não está rodando. Abra o <code>gito.cmd</code> ' +
            '(ou o atalho na sua Área de Trabalho) e tente de novo.</p></div>' +
            '</main></body></html>';

        res.writeHead(401, {
            'Content-Type': 'text/html; charset=utf-8',
            'Cache-Control': 'no-store',
            'Content-Security-Policy': "default-src 'self'; frame-ancestors 'none'"
        });
        res.end(html);
    }

    /* ====================================================================
       ESTATICOS
       ==================================================================== */
    function servirArquivo(res, nome) {
        /* basename() e o que impede "../../" de sair da pasta web. */
        var arq = path.join(WEB, path.basename(nome));
        fs.readFile(arq, function (e, dados) {
            if (e) { res.writeHead(404); return res.end('nao encontrado'); }
            res.writeHead(200, {
                'Content-Type': TIPOS[path.extname(arq)] || 'application/octet-stream',
                'Cache-Control': 'no-store',
                'Content-Security-Policy': "default-src 'self'; frame-ancestors 'none'",
                'X-Content-Type-Options': 'nosniff'
            });
            res.end(dados);
        });
    }

    /* ==================================================================== */
    var servidor = http.createServer(function (req, res) {
        var url = new URL(req.url, 'http://127.0.0.1');
        var rota = req.method + ' ' + url.pathname;

        if (!origemConfiavel(req)) {
            return erro(res, 403, 'ORIGEM', 'pedido recusado: origem nao confiavel');
        }

        if (url.pathname.indexOf('/api/') !== 0) {
            if (url.pathname === '/' || url.pathname === '/index.html') {
                plantarCookie(req, url, res);

                /* Sem token e sem cookie, a pagina carregaria bonita e daria
                   401 em tudo - e a pessoa veria uma tela vazia sem explicacao.
                   Melhor dizer o que aconteceu: quase sempre e o atalho
                   aberto num navegador que nunca abriu o app. */
                if (!autorizado(req, url)) return paginaSemToken(res);

                return servirArquivo(res, 'index.html');
            }
            /* O logo fica na RAIZ da pasta do Gito (e nao em web/): e o
               arquivo que a equipe troca, e trocar la basta. */
            if (url.pathname === '/logo.png') {
                return fs.readFile(path.join(__dirname, '..', 'logo.png'), function (e, dados) {
                    if (e) { res.writeHead(404); return res.end('sem logo'); }
                    res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'no-cache',
                                         'X-Content-Type-Options': 'nosniff' });
                    res.end(dados);
                });
            }
            return servirArquivo(res, url.pathname);
        }

        if (!autorizado(req, url)) {
            return erro(res, 401, 'TOKEN', 'token ausente ou invalido. Reabra pelo endereco que o app imprimiu.');
        }

        /* O ZIP de uma versao antiga vai por STREAM, nao pelo JSON das outras
           rotas: o "git archive" escreve o zip na saida padrao e nos apenas
           ligamos essa saida na resposta. Nao existe arquivo temporario no
           disco, e a working tree do dev nao e tocada em momento nenhum -
           archive e leitura da arvore de um commit.

           O token vem na query porque um <a download> nao manda cabecalho. */
        if (rota === 'GET /api/baixar-versao') {
            var alvoZip, proc;
            try {
                alvoZip = caminhoValidado(url.searchParams.get('p'));
            } catch (e) {
                return erro(res, 400, e.codigo || 'ERRO', e.message);
            }

            var ref = String(url.searchParams.get('ref') || '');
            /* A ref vai como argumento para o git; so aceitamos o que parece
               ref, para nao virar porta de entrada de opcao ("--upload-pack=..."). */
            if (!/^[A-Za-z0-9._\/-]{1,120}$/.test(ref) || ref.charAt(0) === '-') {
                return erro(res, 400, 'REF', 'versao invalida');
            }

            proc = git.zipDaVersao(alvoZip, ref);
            var nomeZip = path.basename(alvoZip).replace(/[^\w.-]/g, '_') + '-' + ref.slice(0, 12) + '.zip';
            var errGit = '';

            proc.stderr.on('data', function (d) { errGit += d; });
            proc.on('error', function () {
                if (!res.headersSent) erro(res, 500, 'ZIP', 'nao consegui gerar o arquivo');
            });
            proc.on('close', function (codigo) {
                /* Codigo != 0 com cabecalho ja enviado nao da para virar erro
                   JSON: o download ja comecou. Encerramos a resposta - o
                   navegador mostra arquivo incompleto, que e visivel. */
                if (codigo !== 0 && !res.headersSent) {
                    erro(res, 400, 'ZIP', (errGit.trim().split('\n')[0]) || 'versao nao encontrada');
                }
            });

            res.writeHead(200, {
                'Content-Type': 'application/zip',
                'Content-Disposition': 'attachment; filename="' + nomeZip + '"',
                'Cache-Control': 'no-store'
            });
            return proc.stdout.pipe(res);
        }

        /* DIAGRAMA OU EVIDENCIA: bytes, nao JSON. Imagem abre na pagina; o
           resto desce como anexo. O CSP "sandbox" vale para quem abrir o
           arquivo direto numa aba: um SVG com script nao roda nada na origem
           do app (que e a mesma da API). */
        if (rota === 'GET /api/painel/arquivo') {
            var achado;
            try {
                var repoA = caminhoValidado(url.searchParams.get('p'));
                var dirA = painel.pastaDaApp(repoA, url.searchParams.get('sub'));
                var ev = url.searchParams.get('id');
                if (ev && !painel.idValido(ev)) throw Object.assign(new Error('ID inválido'), { codigo: 'ID' });
                var rel = ev ? '.gito/evidencias/' + ev + '/' + path.basename(String(url.searchParams.get('arq') || ''))
                             : String(url.searchParams.get('arq') || '');
                achado = painel.arquivoDaApp(dirA, rel, !!ev);
            } catch (e) {
                return erro(res, e.codigo === 'NAO_EXISTE' ? 404 : 400, e.codigo || 'ERRO', e.message);
            }
            var nomeA = path.basename(achado.arquivo).replace(/[^\w.\- ()]/g, '_');
            res.writeHead(200, {
                'Content-Type': achado.tipo,
                'Content-Disposition': (achado.imagem ? 'inline' : 'attachment') + '; filename="' + nomeA + '"',
                'Content-Security-Policy': "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox",
                'X-Content-Type-Options': 'nosniff',
                'Cache-Control': 'no-store'
            });
            return fs.createReadStream(achado.arquivo).pipe(res);
        }

        var acao = ROTAS[rota];
        if (!acao) {
            return erro(res, 404, 'ROTA', codigoMudou()
                ? 'o Gito foi atualizado depois de aberto: feche a janela do Gito e abra de novo pelo gito.cmd.'
                : 'nao existe: ' + rota);
        }

        var corpo = (req.method === 'POST')
            ? lerCorpo(req, rota === 'POST /api/painel/comentario' ? CORPO_MAX_EVIDENCIA : CORPO_MAX)
            : Promise.resolve({});

        corpo
            .then(function (c) { return acao(req, url, c); })
            .then(function (dados) { ok(res, dados); })
            .then(null, function (e) {
                erro(res, 400, e.codigo || 'ERRO', e.message || String(e), e.detalhe);
            });
    });

    return servidor;
}

function novoToken() {
    return crypto.randomBytes(24).toString('hex');
}

module.exports = {
    criar: criar, novoToken: novoToken
};
