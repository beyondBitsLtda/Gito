/* ============================================================================
   git.js - A UNICA PORTA PARA O GIT
   ============================================================================
   Todo comando git do sistema sai daqui. Nao existe caminho alternativo.

   POR QUE UMA PORTA SO

   Cada chamada precisa dos mesmos quatro ajustes, e esquecer um deles nao
   produz erro visivel - produz comportamento errado em alguns repositorios,
   as vezes, o que e muito pior de achar. Com uma porta so, eles sao aplicados
   uma vez e valem para sempre.

   OS QUATRO AJUSTES, E O QUE ACONTECE SEM CADA UM

   --no-optional-locks   um "git status" comum ESCREVE no .git/index para
                         refrescar o cache de stat. A pasta e a mesma em que a
                         pessoa esta trabalhando, e o app brigaria com ela pelo
                         index.lock.
   core.quotepath=false  sem isso, "relatório.txt" sai como
                         "relat\303\263rio.txt" na lista de arquivos alterados.
   core.longpaths=true   o limite de 260 caracteres do Windows. Um projeto
                         Fluig com wcm/widget/<nome>/src/main/webapp/resources/js
                         estoura sozinho, e o erro e "Filename too long" - que
                         aparece so em alguns repositorios, nunca no teste.
   GIT_TERMINAL_PROMPT=0 sem isso, um comando que resolva pedir credencial fica
                         PENDURADO esperando alguem digitar num terminal que
                         ninguem esta olhando.

   SEM SHELL, NUNCA

   spawn com lista de argumentos e shell:false. Nao existe caractere que a
   pessoa possa digitar num campo da tela e que vire outro comando - nao ha
   shell no caminho para interpreta-lo. E a mesma decisao do
   delp-tools-runner, pelo mesmo motivo.
============================================================================ */
'use strict';

var child = require('child_process');
var fs = require('fs');

var TIMEOUT_PADRAO_MS = 60000;

/* Aplicados a TODA chamada. Ver o cabecalho.

   --no-optional-locks e opcao do GIT, nao do subcomando: ela tem de vir ANTES
   de "status", "log" ou "commit". Depois deles, o git para com "unknown
   option" - que e o que acontecia antes do teste-salvar.js pegar. */
var AJUSTES = [
    '--no-optional-locks',
    '-c', 'core.quotepath=false',
    '-c', 'core.longpaths=true'
];

function ambiente() {
    return Object.assign({}, process.env, {
        GIT_TERMINAL_PROMPT: '0',
        GIT_OPTIONAL_LOCKS: '0'
    });
}

/**
 * Executa o git e devolve uma Promise.
 *
 * Assincrono de proposito: o app e um servidor HTTP de um processo so, e
 * spawnSync numa pasta de rede lenta congelaria a interface inteira enquanto
 * o comando nao voltasse.
 *
 * @param {string[]} args    argumentos, JA como lista - nunca uma string
 * @param {object}   [op]    { cwd, timeoutMs }
 * @return {Promise<{codigo:number, saida:string, erro:string}>}
 */
function executar(args, op) {
    op = op || {};
    return new Promise(function (resolve, reject) {
        var proc;
        try {
            proc = child.spawn('git', AJUSTES.concat(args), {
                cwd: op.cwd || process.cwd(),
                env: ambiente(),
                shell: false,
                windowsHide: true
            });
        } catch (e) {
            return reject(new Error('nao consegui executar o git: ' + e.message));
        }

        var saida = '', erro = '', encerrado = false;

        var relogio = setTimeout(function () {
            encerrado = true;
            try { proc.kill(); } catch (e) { /* ja morreu */ }
            reject(new Error('o git nao respondeu em ' + (op.timeoutMs || TIMEOUT_PADRAO_MS) + 'ms'));
        }, op.timeoutMs || TIMEOUT_PADRAO_MS);

        proc.stdout.setEncoding('utf8');
        proc.stderr.setEncoding('utf8');
        proc.stdout.on('data', function (d) { saida += d; });
        proc.stderr.on('data', function (d) { erro += d; });

        proc.on('error', function (e) {
            if (encerrado) return;
            clearTimeout(relogio);
            /* ENOENT tambem e o que o Windows responde quando a PASTA (cwd) nao
               existe - e "instale o git" mandaria a pessoa abrir chamado por
               causa de uma pasta renomeada ou de um Z: desconectado. */
            if (e.code === 'ENOENT' && op.cwd && !fs.existsSync(op.cwd)) {
                return reject(new Error('a pasta não existe (ou a unidade de rede caiu): ' + op.cwd));
            }
            reject(new Error(e.code === 'ENOENT'
                ? 'git nao encontrado. Instale o Git for Windows ou peca a instalacao no GLPI.'
                : e.message));
        });

        proc.on('close', function (codigo) {
            if (encerrado) return;
            clearTimeout(relogio);
            resolve({ codigo: codigo, saida: saida, erro: erro });
        });
    });
}

/* Executa e falha se o git nao terminar com 0. Para os comandos em que um
   codigo != 0 nao tem leitura util - "git commit" que falha e falha. */
function exigir(args, op) {
    return executar(args, op).then(function (r) {
        if (r.codigo !== 0) {
            var msg = (r.erro || r.saida || '').trim().split('\n')[0] || ('git saiu com ' + r.codigo);
            throw new Error(msg);
        }
        return r.saida;
    });
}

/* ==========================================================================
   VERSAO E IDENTIDADE
   ========================================================================== */
function versao() {
    return exigir(['--version']).then(function (s) { return s.trim(); });
}

/* O nome e o e-mail que vao assinar os commits.

   Commit com autoria errada e o erro classico de quem esta comecando, e ele so
   aparece semanas depois - quando ja esta em todos os commits e nao da mais
   para corrigir sem reescrever historico. Por isso o app confere ANTES de
   deixar salvar. */
function identidade() {
    return Promise.all([
        executar(['config', '--get', 'user.name']),
        executar(['config', '--get', 'user.email'])
    ]).then(function (r) {
        return {
            nome: (r[0].saida || '').trim(),
            email: (r[1].saida || '').trim(),
            completa: !!((r[0].saida || '').trim() && (r[1].saida || '').trim())
        };
    });
}

function definirIdentidade(nome, email) {
    return exigir(['config', '--global', 'user.name', nome])
        .then(function () { return exigir(['config', '--global', 'user.email', email]); })
        .then(function () { return identidade(); });
}

/* ==========================================================================
   ESTADO DE UM REPOSITORIO
   ========================================================================== */

/* O porcelain v2 com -z: os registros vem separados por NUL e os caminhos NAO
   levam aspas nem escape. E o unico formato em que nome de arquivo com espaco,
   acento ou aspas atravessa inteiro - e todos os tres existem nos caminhos
   daqui ("Depto Tecnologia da Informacao", "22 - Repositorios"). */
function status(repo) {
    return executar(['status', '--porcelain=v2', '--branch', '-z'], { cwd: repo })
        .then(function (r) {
            if (r.codigo !== 0) {
                var m = (r.erro || '').trim();
                if (/dubious ownership/i.test(m)) {
                    throw new Error('o git recusou esta pasta por "dubious ownership" ' +
                                    '(ela foi criada por outro usuario)');
                }
                throw new Error(m.split('\n')[0] || 'nao consegui ler o repositorio');
            }
            var info = interpretarStatus(r.saida);

            /* JUNCAO EM ANDAMENTO, MESMO SEM CONFLITO NENHUM.

               Depois que o ULTIMO conflito e decidido, o porcelain nao mostra
               mais nada - mas o merge continua aberto (MERGE_HEAD existe) e so
               fecha com um commit. A tela so via "conflitos": o painel com
               "Concluir a juncao" sumia exatamente quando ficava pronto para
               ser usado, e o proximo "Trazer" batia em "You have not concluded
               your merge". */
            return executar(['rev-parse', '-q', '--verify', 'MERGE_HEAD'], { cwd: repo })
                .then(function (m) {
                    info.juntando = m.codigo === 0;
                    return info;
                });
        });
}

function interpretarStatus(bruto) {
    var info = {
        branch: null, sha: null, upstream: null,
        ahead: 0, behind: 0,
        destacado: false, semCommit: false,
        alterados: [],      /* rastreados que mudaram */
        novos: [],          /* nunca versionados */
        conflitos: []
    };

    var reg = String(bruto).split('\u0000');

    for (var i = 0; i < reg.length; i++) {
        var l = reg[i];
        if (!l) continue;

        if (l.charAt(0) === '#') {
            var c = l.split(' ');
            if (c[1] === 'branch.oid') {
                info.semCommit = (c[2] === '(initial)');
                info.sha = info.semCommit ? null : c[2];
            } else if (c[1] === 'branch.head') {
                info.destacado = (c[2] === '(detached)');
                info.branch = info.destacado ? null : c[2];
            } else if (c[1] === 'branch.upstream') {
                info.upstream = c[2];
            } else if (c[1] === 'branch.ab') {
                info.ahead = Math.abs(parseInt(c[2], 10) || 0);
                info.behind = Math.abs(parseInt(c[3], 10) || 0);
            }
            continue;
        }

        var tipo = l.charAt(0);
        var p = l.split(' ');

        /* O caminho e o ULTIMO campo e pode conter espacos, entao ele e
           reconstruido a partir do indice fixo de cada formato - nunca por
           split simples. */
        if (tipo === '1') {
            /* O campo 3 do porcelain v2 diz se a entrada e um SUBMODULO:
               "N..." para arquivo comum, "S<c><m><u>" para submodulo.

               Isso precisa aparecer porque submodulo NAO se comporta como
               arquivo, e tratar os dois igual produz um beco sem saida:
               a pasta aparece como "alterada", salvar nao comita nada (o
               ponteiro nao mudou), e o repositorio fica "sujo" para sempre -
               travando o trazer e, com ele, o enviar. */
            var sub = null;
            if (p[2] && p[2].charAt(0) === 'S') {
                sub = {
                    /* C = ha um commit NOVO la dentro para o pai registrar.
                       Sem ele, nao ha o que salvar aqui, por mais que a
                       pasta apareca como alterada. */
                    commitNovo: p[2].charAt(1) === 'C',
                    modificado: p[2].charAt(2) === 'M',
                    temNovos:   p[2].charAt(3) === 'U'
                };
            }
            info.alterados.push({
                caminho: p.slice(8).join(' '),
                estado: sub && !sub.commitNovo ? 'repositório próprio' : rotulo(p[1]),
                submodulo: sub
            });
        } else if (tipo === '2') {
            /* Renomeado: o caminho ORIGINAL vem no registro NUL seguinte. */
            info.alterados.push({ caminho: p.slice(9).join(' '), estado: 'renomeado' });
            i++;
        } else if (tipo === 'u') {
            info.conflitos.push({ caminho: p.slice(10).join(' '), estado: 'em conflito' });
        } else if (tipo === '?') {
            info.novos.push({ caminho: l.substring(2), estado: 'novo' });
        }
        /* '!' (ignorado) nao entra: nao e pendencia. */
    }

    info.sujo = (info.alterados.length + info.novos.length + info.conflitos.length) > 0;

    /* O QUE DE FATO IMPEDE UM PULL.

       Um submodulo sujo SEM commit novo nao e pendencia deste repositorio:
       aqui so existe o ponteiro, e ele nao mudou. O pull do pai nao encosta
       no conteudo de la dentro, entao bloquear por causa dele e recusar uma
       operacao segura - e, como essa sujeira nunca sai salvando aqui, e
       recusa-la PARA SEMPRE.

       Foi exatamente o beco em que o app prendeu quem tentou enviar: enviar
       pedia trazer, trazer pedia salvar, salvar nao tinha o que salvar. */
    info.submodulosSujos = info.alterados.filter(function (a) {
        return a.submodulo && !a.submodulo.commitNovo;
    });
    info.pendenciaReal =
        (info.alterados.length - info.submodulosSujos.length) +
        info.novos.length + info.conflitos.length;
    info.emConflito = info.conflitos.length > 0;

    return info;
}

/* XY do porcelain: X = no indice, Y = na working tree. Basta um dos dois. */
function rotulo(xy) {
    xy = xy || '..';
    if (xy.indexOf('D') >= 0) return 'apagado';
    if (xy.indexOf('A') >= 0) return 'novo';
    if (xy.indexOf('R') >= 0) return 'renomeado';
    return 'alterado';
}

var SEP = '\u001f';

function ultimoCommit(repo) {
    return executar(['log', '-1', '--format=%H' + SEP + '%an' + SEP + '%aI' + SEP + '%s'],
                    { cwd: repo })
        .then(function (r) {
            if (r.codigo !== 0) return null;          /* repositorio sem commit */
            var p = r.saida.trim().split(SEP);
            if (p.length < 4) return null;
            return { sha: p[0], autor: p[1], data: p[2], assunto: p[3] };
        });
}

/* ==========================================================================
   SALVAR (add + commit)
   --------------------------------------------------------------------------
   A UNICA operacao de escrita da Fase 1, e ela so ACRESCENTA: nao existe
   caminho aqui que apague, sobrescreva ou mova trabalho de alguem.
   ========================================================================== */
function salvar(repo, mensagem, arquivos) {
    if (!mensagem || !String(mensagem).trim()) {
        return Promise.reject(new Error('escreva o que voce fez antes de salvar'));
    }
    if (!arquivos || !arquivos.length) {
        return Promise.reject(new Error('escolha ao menos um arquivo'));
    }

    /* APAGADO E JA PREPARADO NAO PASSA PELO ADD.

       Um arquivo cuja exclusao ja esta no indice (status "D.", por um git rm
       ou pelo VS Code) nao existe mais nem no disco nem no indice. O
       "git add -- ele" entao aborta com "pathspec ... did not match any files"
       - e leva junto o salvamento de TODOS os outros arquivos escolhidos.

       Ele nao precisa de add nenhum: a exclusao ja esta la e entra no commit.
       Por isso sai da lista do add, e so dela. */
    return executar(['diff', '--cached', '--name-only', '--diff-filter=D', '-z'], { cwd: repo })
        .then(function (r) {
            var jaApagados = {};
            if (r.codigo === 0) {
                String(r.saida || '').split('\u0000').forEach(function (c) {
                    if (c) jaApagados[c] = true;
                });
            }
            var paraAdd = arquivos.filter(function (a) { return !jaApagados[a]; });
            if (!paraAdd.length) return null;

            /* "--" separa opcoes de caminhos. Sem ele, um arquivo chamado "-f"
               seria lido pelo git como opcao. E improvavel - e custa um
               argumento. */
            return exigir(['add', '--'].concat(paraAdd), { cwd: repo });
        })
        .then(function () {
            return executar(['commit', '-m', String(mensagem).trim()], { cwd: repo });
        })
        .then(function (r) {
            if (r.codigo === 0) return ultimoCommit(repo);

            var bruto = (r.saida || '') + '\n' + (r.erro || '');

            /* "NADA PARA SALVAR" NAO E UM ERRO DO GIT - E UMA SITUACAO.

               O git responde a isso com "On branch main / nothing to commit",
               e a primeira linha dessa resposta e "On branch main". Antes,
               essa linha subia crua para a tela como se fosse a explicacao do
               problema - e ela nao explica nada a ninguem.

               Pior: o caso mais comum aqui e a pessoa ter marcado uma pasta
               que e um repositorio proprio (submodulo). Nao ha o que salvar
               no repositorio de fora, e nenhuma quantidade de cliques em
               "Salvar" muda isso. Sem dizer o motivo, o app manda a pessoa
               tentar de novo para sempre. */
            if (/nothing to commit|no changes added|nada a submeter/i.test(bruto)) {
                return status(repo).then(function (st) {
                    var subs = (st.submodulosSujos || []).filter(function (s) {
                        return arquivos.indexOf(s.caminho) >= 0;
                    });
                    if (subs.length) {
                        throw Object.assign(new Error(
                            '"' + subs[0].caminho + '" é uma pasta com repositório próprio. ' +
                            'O que mudou está DENTRO dela, e é lá que precisa ser salvo — ' +
                            'aqui de fora só existe um marcador, e ele não mudou.'),
                            { codigo: 'SUBMODULO', submodulos: subs.map(function (s) { return s.caminho; }) });
                    }
                    throw Object.assign(
                        new Error('não há nada de novo para salvar nesses arquivos.'),
                        { codigo: 'NADA_A_SALVAR' });
                });
            }

            throw new Error(primeiraLinhaUtil(bruto) || 'não consegui salvar');
        });
}

/* A PRIMEIRA LINHA QUE EXPLICA ALGUMA COISA.

   O git conversa antes de dizer o que houve: "On branch main", "Your branch
   is ahead of...", "Changes not staged for commit" sao contexto, nao causa.
   Mostrar a primeira linha crua no lugar da mensagem de erro entrega
   justamente essas - e foi assim que um "On branch main" virou o aviso que a
   pessoa recebia ao tentar salvar. */
function primeiraLinhaUtil(texto) {
    var ignorar = /^(on branch|your branch|changes not staged|changes to be committed|untracked files|no changes added|nothing added|\(use |hint:|warning:|\s*$)/i;
    var linhas = String(texto || '').split('\n');
    for (var i = 0; i < linhas.length; i++) {
        var l = linhas[i].replace(/^\s+|\s+$/g, '').replace(/^(error|fatal):\s*/i, '');
        if (l && !ignorar.test(l)) return l;
    }
    return '';
}

/* ==========================================================================
   CRIAR: um repositorio novo, e um ramo novo
   ========================================================================== */

/* Um repositorio novo na pasta escolhida. Se a pasta ja for um repositorio,
   nao ha o que fazer - e dizer isso e melhor do que rodar "init" por cima e
   deixar a pessoa achando que criou algo. */
function criarRepositorio(pasta, nomeBranch) {
    var branch = String(nomeBranch || 'main').trim() || 'main';
    var recusa = nomeDeBranchInvalido(branch);
    if (recusa) return Promise.reject(new Error(recusa));

    return executar(['rev-parse', '--is-inside-work-tree'], { cwd: pasta })
        .then(function (r) {
            if (r.codigo === 0 && /true/i.test(r.saida)) {
                throw Object.assign(
                    new Error('esta pasta já é um repositório.'),
                    { codigo: 'JA_E_REPO' });
            }
            /* -b nomeia o ramo inicial na criacao. Sem ele o nome vem da
               configuracao da maquina, que varia entre "master" e "main" - e
               um repositorio nasceria diferente do outro sem ninguem escolher. */
            return exigir(['init', '-b', branch], { cwd: pasta });
        })
        .then(function () { return status(pasta); });
}

/* O git recusa varios nomes de ramo, e a mensagem dele e cifrada
   ("is not a valid ref name"). Conferir antes deixa o aviso em portugues, e
   antes de o repositorio ficar meio criado. */
function nomeDeBranchInvalido(nome) {
    var n = String(nome || '').trim();
    if (!n) return 'escreva o nome do ramo';
    if (n.length > 100) return 'o nome do ramo é longo demais';
    if (/[\s~^:?*\[\\]/.test(n)) return 'o nome não pode ter espaço nem ~ ^ : ? * [ \\';
    if (/^[-.]|[.]$|\.\.|@\{|\/$|^\/|\/\//.test(n)) return 'nome de ramo inválido: "' + n + '"';
    if (n === '@') return 'nome de ramo inválido';
    return null;
}

/* Um ramo novo a partir de onde a pessoa esta, e ja muda para ele - que e o
   que quem cria um ramo quer em seguida, sem excecao. */
function criarBranch(repo, nome) {
    var recusa = nomeDeBranchInvalido(nome);
    if (recusa) return Promise.reject(new Error(recusa));

    return executar(['rev-parse', '--verify', '--quiet', 'refs/heads/' + nome], { cwd: repo })
        .then(function (r) {
            if (r.codigo === 0) {
                throw Object.assign(
                    new Error('já existe um ramo chamado "' + nome + '".'),
                    { codigo: 'BRANCH_EXISTE' });
            }
            return executar(['checkout', '-b', nome], { cwd: repo });
        })
        .then(function (r) {
            if (r.codigo !== 0) {
                throw new Error(primeiraLinhaUtil(r.erro || r.saida) ||
                                'não consegui criar o ramo');
            }
            return status(repo);
        });
}

/* ==========================================================================
   HISTORICO
   ========================================================================== */
function historico(repo, limite) {
    var fmt = '--format=%H' + SEP + '%h' + SEP + '%an' + SEP + '%aI' + SEP + '%s';
    return executar(['log', '-' + (parseInt(limite, 10) || 30), fmt], { cwd: repo })
        .then(function (r) {
            if (r.codigo !== 0) return [];          /* repositorio sem commit */
            return r.saida.split('\n')
                .filter(function (l) { return l.trim(); })
                .map(function (l) {
                    var p = l.split(SEP);
                    return { sha: p[0], curto: p[1], autor: p[2], data: p[3], assunto: p[4] };
                });
        });
}

/* ==========================================================================
   BRANCHES
   ========================================================================== */
/* Com cada branch vem se ela ja esta no servidor. "upstream" vazio = so
   existe aqui; "[gone]" no track = estava, e alguem apagou la (o caso tipico
   de uma branch cujo Merge Request ja foi aceito). */
function branches(repo) {
    return executar(['branch', '--format=%(refname:short)' + SEP + '%(HEAD)' + SEP +
                     '%(upstream:short)' + SEP + '%(upstream:track)'], { cwd: repo })
        .then(function (r) {
            if (r.codigo !== 0) return [];
            return r.saida.split('\n')
                .filter(function (l) { return l.trim(); })
                .map(function (l) {
                    var p = l.split(SEP);
                    var sumiu = /\[gone\]/.test(p[3] || '');
                    return {
                        nome: p[0], atual: (p[1] || '').trim() === '*',
                        upstream: (p[2] || '').trim() || null,
                        publicada: !!(p[2] || '').trim() && !sumiu,
                        sumiuNoServidor: sumiu
                    };
                });
        });
}

/* TROCAR DE BRANCH - a primeira operacao deste app que MEXE na working tree.

   A trava: com trabalho pendente, ela NAO acontece.

   O git ate deixaria em alguns casos, carregando as alteracoes para a outra
   branch - e e ai que se perde o controle sem perceber, porque o trabalho
   "some" da branch onde estava. Recusar e explicar custa um clique a mais e
   evita a pergunta "cade o que eu tinha feito?". */
/* Uma juncao aberta, ja sem conflito, so espera o "Concluir". Qualquer outra
   operacao que mexa na historia por cima dela falha com o ingles cru do git
   ("You have not concluded your merge") - entao a recusa vem antes, dizendo
   as duas saidas que existem. */
function recusarSeJuntando(st) {
    if (st.juntando && !st.emConflito) {
        throw Object.assign(
            new Error('há uma junção aberta esperando para ser concluída. Em "O que mudou", ' +
                      'clique em "Concluir a junção" — ou em "Desfazer a junção" para voltar atrás.'),
            { codigo: 'JUNCAO_ABERTA' });
    }
}

function trocarBranch(repo, nome) {
    return status(repo).then(function (st) {
        recusarSeJuntando(st);
        if (st.sujo) {
            throw Object.assign(
                new Error('salve o que está pendente antes de trocar de branch — ' +
                          'senão as alterações vão junto para a outra branch.'),
                { codigo: 'TRABALHO_PENDENTE' });
        }
        return exigir(['checkout', nome], { cwd: repo });
    }).then(function () { return status(repo); });
}

/* ==========================================================================
   VERSOES ANTIGAS - SEM TOCAR NA PASTA
   --------------------------------------------------------------------------
   "git archive" le a arvore de um commit e escreve um zip na SAIDA PADRAO.
   Ele nao muda a working tree, nao muda o HEAD, nao muda nada: e leitura.

   E por isso que esta e a operacao de restaurar que o app oferece primeiro.
   Um "checkout" ou "reset" para uma versao antiga sobrescreve o que esta na
   pasta - e quem pede "quero ver como estava" quase nunca quer dizer "apague o
   que eu tenho agora". Com o zip, a pessoa abre, compara, e copia de volta o
   que quiser, no tempo dela.
   ========================================================================== */
function zipDaVersao(repo, ref) {
    var proc = child.spawn('git', AJUSTES.concat(['archive', '--format=zip', ref]), {
        cwd: repo, env: ambiente(), shell: false, windowsHide: true
    });
    return proc;      /* quem chamou faz o pipe para a resposta HTTP */
}

/* Um arquivo so, como ele estava naquele commit. Para "o que mudou desde
   entao" sem baixar o projeto inteiro. */
function arquivoDeCommit(repo, ref, caminho) {
    return executar(['show', ref + ':' + caminho], { cwd: repo }).then(function (r) {
        if (r.codigo !== 0) {
            throw new Error('esse arquivo não existia nessa versão');
        }
        return r.saida;
    });
}

/* ==========================================================================
   A BASE DE CODIGO - a estrutura de arquivos VERSIONADA
   --------------------------------------------------------------------------
   Vem do git (ls-tree), nao do disco. A diferenca importa:

     - o disco mostra node_modules, target/, .war e o que mais estiver la
     - o git mostra o que ESTA VERSIONADO, que e a pergunta de quem quer saber
       "o que deste projeto esta guardado?"

   Um arquivo que aparece no Explorer e nao aparece aqui e um arquivo que
   ninguem versionou - e ver isso e metade do valor da tela.
   ========================================================================== */
function arvore(repo, ref) {
    return executar(['ls-tree', '-r', '-l', '-z', ref || 'HEAD'], { cwd: repo })
        .then(function (r) {
            if (r.codigo !== 0) return [];
            return r.saida.split('\u0000')
                .filter(function (l) { return l.trim(); })
                .map(function (l) {
                    /* <modo> <tipo> <sha> <tamanho>\t<caminho>
                       O TAB separa o caminho: ele pode ter espacos, e so o tab
                       e garantido nao aparecer num nome de arquivo. */
                    var tab = l.indexOf('\t');
                    if (tab < 0) return null;
                    var campos = l.substring(0, tab).split(/\s+/);
                    return {
                        caminho: l.substring(tab + 1),
                        bytes: parseInt(campos[3], 10) || 0
                    };
                })
                .filter(Boolean);
        });
}

/* O que mudou num arquivo, contra o ultimo commit. Leitura pura. */
function diff(repo, caminho) {
    return executar(['diff', '--no-color', 'HEAD', '--', caminho], { cwd: repo })
        .then(function (r) {
            if (r.saida) return r.saida;
            /* Arquivo novo nao esta no HEAD: o diff vem vazio. Mostramos o
               conteudo, que e o que a pessoa quer ver. */
            return executar(['diff', '--no-color', '--no-index', '/dev/null', caminho], { cwd: repo })
                .then(function (r2) { return r2.saida || '(arquivo novo, ainda sem comparação)'; });
        });
}

/* ==========================================================================
   ENVIAR E TRAZER
   ========================================================================== */
/* TRADUZIR O ERRO DO GIT - SEM ESCONDÊ-LO

   A primeira versão disto substituía a mensagem do git por um conselho, e o
   conselho estava ERRADO: dizia "entre no GitLab pelo navegador que o Windows
   guarda o acesso". Não guarda. O login do navegador e o do Git Credential
   Manager são coisas separadas, e quem seguiu o conselho ficou rodando em
   círculo - logado no site, recusado no push.

   Pior que o conselho errado foi o que ele causou: a mensagem REAL do git
   sumiu, e com ela a única informação que permitiria descobrir a causa.

   Agora a tradução vem junto com o original, sempre. A frase em português
   ajuda quem entende; o `detalhe` salva quem precisa mostrar para alguém. */
function falhaDoGit(mensagemAmigavel, codigo, bruto) {
    return Object.assign(new Error(mensagemAmigavel), {
        codigo: codigo,
        detalhe: String(bruto || '').trim()
    });
}

function enviar(repo) {
    return executar(['push'], { cwd: repo, timeoutMs: 120000 }).then(function (r) {
        if (r.codigo !== 0) {
            var m = ((r.erro || '') + '\n' + (r.saida || '')).trim();

            if (/no upstream branch/i.test(m)) {
                throw falhaDoGit('esta branch ainda não existe no servidor. Criar lá?',
                                 'SEM_UPSTREAM', m);
            }
            throw falhaDePush(m);
        }
        return true;
    });
}

/* A traducao dos erros de push, num lugar so: enviar e publicar uma branch
   falham pelos mesmos motivos, e duas copias disto divergiriam na primeira
   mensagem nova que alguem acrescentasse em uma delas. */
function falhaDePush(m) {
    if (/not allowed to push|pre-receive hook declined|protected branch/i.test(m)) {
        return falhaDoGit(
            'o servidor aceitou você, mas não deixa gravar nesta branch. ' +
            'Ou ela é protegida, ou seu usuário não tem permissão de escrita no projeto.',
            'SEM_PERMISSAO', m);
    }
    if (/Authentication failed|could not read Username|invalid credentials|401/i.test(m)) {
        return falhaDoGit(
            'o servidor não aceitou suas credenciais. Estar logado no GitLab pelo ' +
            'navegador NÃO resolve isto: o git usa credencial própria. O GitLab pede ' +
            'um token de acesso pessoal no lugar da senha.',
            'CREDENCIAL', m);
    }
    if (/403|forbidden/i.test(m)) {
        return falhaDoGit(
            'o servidor reconheceu você mas recusou a operação (403). Normalmente é ' +
            'falta de permissão neste projeto, não senha errada.',
            'PROIBIDO', m);
    }
    if (/rejected|non-fast-forward|behind|fetch first/i.test(m)) {
        return falhaDoGit('há trabalho novo no servidor que você ainda não tem. ' +
                         'Use "Trazer" antes de enviar.', 'ATRASADO', m);
    }
    if (/Could not resolve host|unable to access|timed out/i.test(m)) {
        return falhaDoGit('não consegui falar com o servidor. Confira a rede ou o proxy.',
                         'REDE', m);
    }
    return falhaDoGit(primeiraLinhaUtil(m) || 'não consegui enviar', 'ENVIO', m);
}

/* Para onde este repositório envia. A tela mostra junto do erro: metade dos
   "não consigo enviar" é o remote apontando para outro lugar que não o que a
   pessoa imagina. */
function remotes(repo) {
    return executar(['remote', '-v'], { cwd: repo }).then(function (r) {
        if (r.codigo !== 0) return [];
        var vistos = {}, lista = [];
        r.saida.split('\n').forEach(function (l) {
            var p = l.trim().split(/\s+/);
            if (p.length < 2 || vistos[p[0]]) return;
            vistos[p[0]] = true;
            lista.push({ nome: p[0], url: p[1] });
        });
        return lista;
    });
}

/* O servidor para onde o app envia: "origin" quando existe - e o nome que o
   clone da - e o primeiro que houver quando nao. */
function remotoPadrao(repo) {
    return remotes(repo).then(function (rs) {
        if (!rs.length) {
            throw Object.assign(
                new Error('este repositório não tem servidor configurado — só existe nesta máquina.'),
                { codigo: 'SEM_REMOTO' });
        }
        var origin = rs.filter(function (r) { return r.nome === 'origin'; })[0];
        return origin || rs[0];
    });
}

/* PUBLICAR UMA BRANCH: criar no servidor uma branch que so existe aqui.

   Criar a branch e salvar nela NAO sobe nada - as duas coisas sao locais. E
   uma branch que o servidor nunca viu nao tem com quem se comparar, entao o
   git nao conta "salvamentos para enviar" e o botao Enviar ficava apagado
   para sempre. Esta e a saida explicita.

   --set-upstream amarra as duas: dali em diante, Enviar e Trazer desta branch
   funcionam direto, como em qualquer outra. */
function publicarBranch(repo, branch) {
    var nome = String(branch || '').trim();
    var recusa = nomeDeBranchInvalido(nome);
    if (recusa) return Promise.reject(new Error(recusa));

    return executar(['rev-parse', '--verify', '--quiet', 'refs/heads/' + nome], { cwd: repo })
        .then(function (r) {
            if (r.codigo !== 0) throw new Error('não existe uma branch "' + nome + '" neste computador.');
            return remotoPadrao(repo);
        })
        .then(function (remoto) {
            return executar(['push', '--set-upstream', remoto.nome, nome],
                            { cwd: repo, timeoutMs: 120000 });
        })
        .then(function (r) {
            if (r.codigo !== 0) throw falhaDePush(((r.erro || '') + '\n' + (r.saida || '')).trim());
            return status(repo);
        });
}

/* Mantido pelo nome antigo: a rota /api/enviar com criarUpstream ainda o usa. */
function enviarCriandoUpstream(repo, branch) {
    return publicarBranch(repo, branch);
}

/* AS BRANCHES QUE EXISTEM NO SERVIDOR - pela ultima leitura dele.

   Nao faz fetch: listar tem de ser instantaneo, e quem precisa do servidor
   atualizado (trazerBranch) busca por conta propria antes de usar. "padrao"
   e a branch principal do projeto (o HEAD do remoto, quase sempre main): e o
   destino que um Merge Request tem na grande maioria das vezes. */
function branchesRemotas(repo) {
    return remotoPadrao(repo).then(function (remoto) {
        return Promise.all([
            executar(['for-each-ref', '--format=%(refname)', 'refs/remotes/' + remoto.nome + '/'],
                     { cwd: repo }),
            executar(['symbolic-ref', '--quiet', 'refs/remotes/' + remoto.nome + '/HEAD'],
                     { cwd: repo })
        ]).then(function (rs) {
            var prefixo = 'refs/remotes/' + remoto.nome + '/';
            var nomes = rs[0].codigo !== 0 ? [] : rs[0].saida.split('\n')
                .map(function (l) { return l.trim(); })
                .filter(function (l) { return l.indexOf(prefixo) === 0; })
                .map(function (l) { return l.slice(prefixo.length); })
                /* HEAD nao e branch: e o apelido de qual delas e a principal. */
                .filter(function (n) { return n && n !== 'HEAD'; })
                .sort();
            var cab = rs[1].codigo === 0 ? rs[1].saida.trim() : '';
            var padrao = cab.indexOf(prefixo) === 0 ? cab.slice(prefixo.length) : '';
            if (!padrao && nomes.indexOf('main') >= 0) padrao = 'main';
            if (!padrao && nomes.indexOf('master') >= 0) padrao = 'master';
            return { remoto: remoto.nome, url: remoto.url, lista: nomes, padrao: padrao };
        });
    });
}

/* ATUALIZAR A LISTA DO SERVIDOR - fetch, e so.

   branchesRemotas le o que o git lembrou da ULTIMA conversa com o servidor.
   Uma branch que um colega criou ontem nao aparece ate alguem perguntar de
   novo. O fetch so atualiza essa lembranca (refs/remotes/...): nao mexe na
   pasta, na branch atual nem em nada salvo - por isso nao tem trava nenhuma.

   --prune tira da lista o que foi apagado la (a branch de um Merge Request
   aceito), senao ela seguiria aparecendo como se existisse. */
function atualizarDoServidor(repo) {
    return remotoPadrao(repo).then(function (remoto) {
        return executar(['fetch', '--prune', remoto.nome], { cwd: repo, timeoutMs: 120000 });
    }).then(function (r) {
        if (r.codigo !== 0) throw falhaDePush(((r.erro || '') + '\n' + (r.saida || '')).trim());
        return branchesRemotas(repo);
    });
}

/* BAIXAR UMA BRANCH DO SERVIDOR - sem merge, sem trocar de branch.

   Cria aqui a branch com o mesmo nome, apontando para o que esta no servidor
   e ja amarrada a ele (--track): Enviar e Trazer nela funcionam direto.

   NAO troca para ela. Trocar mexe na pasta e exige tudo salvo; baixar nao
   mexe em nada, entao pode ser feito a qualquer momento. Quem quiser ir para
   ela usa o "Ir para esta" de sempre - com a trava de sempre.

   A branch e buscada antes: baixar a lembranca velha dela criaria uma copia
   que ja nasce atrasada. */
function baixarBranch(repo, nome) {
    var n = String(nome || '').trim();
    var recusa = nomeDeBranchInvalido(n);
    if (recusa) return Promise.reject(new Error(recusa));

    var remoto;
    return executar(['rev-parse', '--verify', '--quiet', 'refs/heads/' + n], { cwd: repo })
        .then(function (r) {
            if (r.codigo === 0) {
                throw Object.assign(
                    new Error('a branch "' + n + '" já existe neste computador. Use "Ir para esta" ' +
                              'e depois "Trazer do servidor" para atualizá-la.'),
                    { codigo: 'BRANCH_EXISTE' });
            }
            return remotoPadrao(repo);
        })
        .then(function (rm) {
            remoto = rm.nome;
            return executar(['fetch', remoto, '+refs/heads/' + n + ':refs/remotes/' + remoto + '/' + n],
                            { cwd: repo, timeoutMs: 120000 });
        })
        .then(function (r) {
            if (r.codigo !== 0) {
                var m = ((r.erro || '') + '\n' + (r.saida || '')).trim();
                if (/couldn't find remote ref/i.test(m)) {
                    throw falhaDoGit('a branch "' + n + '" não existe mais no servidor.', 'NAO_EXISTE', m);
                }
                throw falhaDePush(m);
            }
            return exigir(['branch', '--track', n, 'refs/remotes/' + remoto + '/' + n], { cwd: repo });
        })
        .then(function () { return branches(repo); });
}

/* TRAZER OUTRA BRANCH PARA ESTA - o merge local.

   O caso de uso e "a main andou; quero isso na minha branch antes de pedir o
   Merge Request", ou juntar duas branches de trabalho. Ele MEXE na pasta, e
   por isso tem as mesmas travas do trazer: sem trabalho pendente, sem
   conflito aberto.

   "origem" pode ser uma branch deste computador ("refatorar") ou uma do
   servidor ("origin/main"). A do servidor e buscada ANTES: juntar a copia de
   uma semana atras seria juntar outra coisa que a pessoa pensa.

   O nome escolhido tem de estar na lista do que existe - nunca vai cru para a
   linha de comando. Um "--algo" digitado seria lido como opcao do merge.

   Conflito nao e erro aqui: volta a lista, e a tela de decidir arquivo por
   arquivo (a mesma do "Juntar os dois") assume dali. */
function trazerBranch(repo, origem) {
    var alvo = String(origem || '').trim();
    if (!alvo) return Promise.reject(new Error('escolha a branch que vai ser trazida'));

    var ctx = {};
    return status(repo).then(function (st) {
        ctx.st = st;
        recusarSeJuntando(st);
        if (st.emConflito) {
            throw Object.assign(new Error('há arquivos em conflito para resolver antes.'),
                                { codigo: 'EM_CONFLITO' });
        }
        if (st.pendenciaReal > 0) {
            throw Object.assign(
                new Error('salve o que está pendente antes de trazer outra branch — ' +
                          'o que vier pode esbarrar no que você mexeu.'),
                { codigo: 'TRABALHO_PENDENTE' });
        }
        if (!st.branch) throw new Error('você não está em nenhuma branch (HEAD destacado).');
        return Promise.all([branches(repo), branchesRemotas(repo).catch(function () { return null; })]);
    }).then(function (rs) {
        var locais = rs[0].map(function (b) { return b.nome; });
        var remotas = rs[1];
        var ehRemota = !!remotas && alvo.indexOf(remotas.remoto + '/') === 0 &&
                       remotas.lista.indexOf(alvo.slice(remotas.remoto.length + 1)) >= 0;

        if (!ehRemota && locais.indexOf(alvo) < 0) {
            throw new Error('a branch "' + alvo + '" não existe aqui nem no servidor.');
        }
        if (alvo === ctx.st.branch) throw new Error('essa já é a branch em que você está.');

        if (!ehRemota) return alvo;
        /* Buscar so aquela branch: e o que vai ser usado, e e mais rapido do
           que trazer o servidor inteiro por uma pasta de rede. */
        var nome = alvo.slice(remotas.remoto.length + 1);
        return executar(['fetch', remotas.remoto,
                         '+refs/heads/' + nome + ':refs/remotes/' + remotas.remoto + '/' + nome],
                        { cwd: repo, timeoutMs: 120000 })
            .then(function (r) {
                if (r.codigo !== 0) throw falhaDePush(((r.erro || '') + '\n' + (r.saida || '')).trim());
                return alvo;
            });
    }).then(function (ref) {
        return executar(['merge', '--no-edit', ref], { cwd: repo, timeoutMs: 120000 });
    }).then(function (r) {
        var m = ((r.saida || '') + '\n' + (r.erro || '')).trim();
        if (r.codigo === 0) {
            return { juntou: true, jaEstava: /already up.to.date/i.test(m), conflitos: [], saida: m };
        }
        if (/conflict/i.test(m)) {
            return status(repo).then(function (st) {
                return { juntou: false, conflitos: st.conflitos.map(function (c) { return c.caminho; }),
                         saida: m };
            });
        }
        throw falhaDoGit(primeiraLinhaUtil(m) || 'não consegui trazer a branch', 'MERGE', m);
    });
}

/* O ENDERECO DO SITE do repositorio, a partir do remoto.

     https://gitlab.com/grupo/projeto.git        -> https://gitlab.com/grupo/projeto
     https://usuario:token@gitlab.com/g/p.git    -> https://gitlab.com/g/p   (sem a credencial!)
     git@gitlab.com:grupo/sub/projeto.git        -> https://gitlab.com/grupo/sub/projeto

   A credencial embutida sai SEMPRE: este endereco vai para o navegador, para
   o historico dele e para qualquer print de tela. */
function enderecoWeb(urlRemoto) {
    var u = String(urlRemoto || '').trim();
    var m = /^[\w.-]+@([^:\/]+):(.+?)(?:\.git)?\/?$/.exec(u);          /* scp-like (ssh) */
    if (m) return 'https://' + m[1] + '/' + m[2];
    m = /^(?:https?|ssh|git):\/\/(?:[^@\/]*@)?([^\/:]+)(?::\d+)?\/(.+?)(?:\.git)?\/?$/i.exec(u);
    if (m) return 'https://' + m[1] + '/' + m[2];
    return null;
}

/* PEDIR PARA JUNTAR (Merge Request) - o merge que passa por revisao.

   Juntar na main, ou na DEV, e decisao do projeto: fica registrado quem
   pediu, alguem pode revisar, e as branches protegidas continuam protegidas.
   Por isso o app nao faz esse merge - ele abre o pedido no GitLab, ja com
   origem e destino preenchidos, e quem cria (ou nao) e a pessoa, la.

   Uma branch que o servidor nao tem nao pode ser origem de pedido nenhum:
   isso e recusado aqui, com o motivo, em vez de abrir uma pagina de erro. */
function linkMergeRequest(repo, origem, destino) {
    var o = String(origem || '').trim(), d = String(destino || '').trim();
    if (!o || !d) return Promise.reject(new Error('escolha a branch de origem e a de destino'));
    if (o === d) return Promise.reject(new Error('origem e destino são a mesma branch'));

    return branchesRemotas(repo).then(function (r) {
        if (r.lista.indexOf(o) < 0) {
            throw Object.assign(
                new Error('a branch "' + o + '" ainda não está no servidor. Publique antes de pedir para juntar.'),
                { codigo: 'NAO_PUBLICADA' });
        }
        if (r.lista.indexOf(d) < 0) throw new Error('a branch "' + d + '" não existe no servidor.');

        var web = enderecoWeb(r.url);
        /* Sem a URL na mensagem: ela pode trazer usuario e token embutidos. */
        if (!web) throw new Error('não reconheci o endereço do servidor deste repositório.');

        var q = encodeURIComponent;
        /* GitHub chama de Pull Request e tem outro endereco; o resto (gitlab.com
           e GitLab da propria empresa) segue o formato do GitLab. */
        var url = /github\.com/i.test(web)
            ? web + '/compare/' + q(d) + '...' + q(o) + '?expand=1'
            : web + '/-/merge_requests/new?' +
              q('merge_request[source_branch]') + '=' + q(o) + '&' +
              q('merge_request[target_branch]') + '=' + q(d);
        return { url: url, origem: o, destino: d };
    });
}

/* TRAZER - com a mesma trava do checkout, e pelo mesmo motivo. --ff-only
   recusa criar merge: se as duas pontas divergiram, isso precisa de gente,
   nao de um botao. */
function trazer(repo) {
    return status(repo).then(function (st) {
        recusarSeJuntando(st);
        if (st.emConflito) {
            throw Object.assign(
                new Error('há arquivos em conflito para resolver antes de trazer de novo.'),
                { codigo: 'EM_CONFLITO' });
        }
        /* A trava olha a pendencia REAL, nao o "sujo" cru: submodulo sujo sem
           commit novo nao e pendencia daqui, e bloquear por ele prendia a
           pessoa num ciclo sem saida (ver interpretarStatus). */
        if (st.pendenciaReal > 0) {
            throw Object.assign(
                new Error('salve o que está pendente antes de trazer — ' +
                          'o que vier pode esbarrar no que você mexeu.'),
                { codigo: 'TRABALHO_PENDENTE' });
        }
        return executar(['pull', '--ff-only'], { cwd: repo, timeoutMs: 120000 });
    }).then(function (r) {
        if (r.codigo !== 0) {
            var m = (r.erro || r.saida || '').trim();
            if (/not possible to fast-forward|diverge/i.test(m)) {
                throw Object.assign(
                    new Error('seu trabalho e o do servidor seguiram caminhos diferentes: ' +
                              'os dois ganharam salvamentos desde o último ponto em comum.'),
                    { codigo: 'DIVERGIU' });
            }
            throw new Error(primeiraLinhaUtil(m) || 'não consegui trazer');
        }
        return r.saida.trim();
    });
}

/* AS DUAS HISTORIAS JUNTAS.

   Chamado so depois de o "trazer" acusar DIVERGIU, e so quando a pessoa
   confirma. O merge e o caminho honesto aqui: ele preserva os dois lados e,
   quando nao consegue decidir, PARA e marca o arquivo - em vez de escolher
   sozinho e apagar o trabalho de alguem.

   Nao ha rebase: reescrever commits ja salvos, para quem esta aprendendo git
   pela primeira vez numa tela, e a operacao que perde trabalho sem deixar
   rastro obvio. */
function juntar(repo) {
    return executar(['pull', '--no-rebase', '--no-edit'], { cwd: repo, timeoutMs: 120000 })
        .then(function (r) {
            if (r.codigo === 0) {
                return { juntou: true, conflitos: [], saida: r.saida.trim() };
            }
            var m = (r.erro || r.saida || '');
            if (/conflict/i.test(m)) {
                return status(repo).then(function (st) {
                    return {
                        juntou: false,
                        conflitos: st.conflitos.map(function (c) { return c.caminho; }),
                        saida: m.trim()
                    };
                });
            }
            throw new Error(primeiraLinhaUtil(m) || 'não consegui juntar');
        });
}

/* Resolver UM arquivo em conflito ficando com um dos lados inteiro.

   "meu"  = o que estava aqui       (--ours)
   "deles" = o que veio do servidor (--theirs)

   Sao os dois desfechos que alguem consegue decidir com seguranca olhando o
   diff. Misturar pedaco dos dois no mesmo arquivo e edicao de texto, e isso
   se faz no editor - nao num botao que decide sozinho. */
function resolverConflito(repo, arquivo, lado) {
    var opcao = (lado === 'meu') ? '--ours' : '--theirs';
    return executar(['checkout', opcao, '--', arquivo], { cwd: repo })
        .then(function (r) {
            if (r.codigo === 0) return exigir(['add', '--', arquivo], { cwd: repo });

            /* APAGADO DE UM LADO, ALTERADO DO OUTRO (DU / UD no status).

               Se o lado escolhido APAGOU o arquivo, nao ha versao dele para
               restaurar: o checkout responde "does not have our/their
               version". Ficar com esse lado e confirmar a exclusao - git rm.

               Foi o caso do ESTRUTURA.MD: apagado na refatoracao, mexido na
               DEV. Sem isto, "Ficar com o meu" falhava justamente no conflito
               em que a escolha era obvia. */
            if (/does not have (our|their) version/i.test(r.erro || r.saida || '')) {
                return exigir(['rm', '-q', '--', arquivo], { cwd: repo });
            }
            throw new Error(primeiraLinhaUtil(r.erro || r.saida) ||
                            'não consegui resolver ' + arquivo);
        })
        .then(function () { return status(repo); });
}

/* Fechar o merge depois que todos os conflitos foram resolvidos. */
function concluirJuncao(repo, mensagem) {
    return status(repo).then(function (st) {
        if (st.conflitos.length) {
            throw Object.assign(
                new Error('ainda há ' + st.conflitos.length + ' arquivo(s) em conflito.'),
                { codigo: 'EM_CONFLITO' });
        }
        /* Sem mensagem digitada, vale a que o proprio git preparou para o
           merge ("Merge branch 'DEV' into refatorar"). A frase fixa que havia
           aqui falava em "servidor" - e errava sempre que a juncao era com
           outra branch. */
        var msg = String(mensagem || '').trim();
        if (!st.juntando && !msg) msg = 'junta o trabalho do servidor com o meu';
        return executar(msg ? ['commit', '-m', msg] : ['commit', '--no-edit'], { cwd: repo });
    }).then(function (r) {
        if (r.codigo !== 0 && !/nothing to commit/i.test(r.saida + r.erro)) {
            throw new Error(primeiraLinhaUtil(r.erro || r.saida) || 'não consegui concluir');
        }
        return ultimoCommit(repo);
    });
}

/* Desistir da juncao e voltar ao estado anterior. E a saida de quem abriu o
   conflito, olhou e concluiu que aquilo precisa de outra pessoa. */
function abortarJuncao(repo) {
    return executar(['merge', '--abort'], { cwd: repo }).then(function (r) {
        if (r.codigo !== 0) {
            throw new Error(primeiraLinhaUtil(r.erro || r.saida) ||
                            'não consegui desfazer a junção');
        }
        return status(repo);
    });
}

module.exports = {
    executar: executar,
    versao: versao,
    identidade: identidade,
    definirIdentidade: definirIdentidade,
    status: status,
    interpretarStatus: interpretarStatus,
    ultimoCommit: ultimoCommit,
    salvar: salvar,
    historico: historico,
    branches: branches,
    trocarBranch: trocarBranch,
    zipDaVersao: zipDaVersao,
    arquivoDeCommit: arquivoDeCommit,
    diff: diff,
    enviar: enviar,
    remotes: remotes,
    arvore: arvore,
    enviarCriandoUpstream: enviarCriandoUpstream,
    trazer: trazer,
    juntar: juntar,
    resolverConflito: resolverConflito,
    concluirJuncao: concluirJuncao,
    abortarJuncao: abortarJuncao,
    criarRepositorio: criarRepositorio,
    criarBranch: criarBranch,
    publicarBranch: publicarBranch,
    branchesRemotas: branchesRemotas,
    atualizarDoServidor: atualizarDoServidor,
    baixarBranch: baixarBranch,
    trazerBranch: trazerBranch,
    linkMergeRequest: linkMergeRequest,
    enderecoWeb: enderecoWeb,
    nomeDeBranchInvalido: nomeDeBranchInvalido,
    primeiraLinhaUtil: primeiraLinhaUtil,
    AJUSTES: AJUSTES
};
