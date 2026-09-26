/* ============================================================================
   repos.js - encontrar os repositorios e dizer o estado de cada um
   ============================================================================
   A pergunta que este arquivo responde nao e "como esta este repositorio" - e
   "o que ficou para tras". Por isso ele olha TODOS de uma vez: ninguem deixa
   de versionar por achar commit dificil, deixa por nao lembrar.

   Pasta com codigo e sem .git aparece como NAO VERSIONADA, e esse e o achado
   mais importante da lista - nao uma excecao dela. E codigo que existe so
   naquela maquina e some junto com ela.
============================================================================ */
'use strict';

var fs = require('fs');
var path = require('path');
var git = require('./git');

var PROFUNDIDADE = 2;        /* cobre "pasta/app" e "pasta/grupo/app" */
var SIMULTANEOS = 4;         /* status em paralelo - ver rodarEmLotes() */

function ehRepo(dir) {
    try { return fs.existsSync(path.join(dir, '.git')); } catch (e) { return false; }
}

/* E PASTA?  - e a resposta nao e "isDirectory()".

   No Z: da DELP, as pastas de primeiro nivel NAO sao pastas para o Node:

       COMITES    isDirectory()=false   isSymbolicLink()=true
       DATABOOK   isDirectory()=false   isSymbolicLink()=true

   \\intranet.delp\FILES e um namespace DFS, e cada pasta ali e um reparse
   point que aponta para outro servidor. O readdir devolve o LINK, nao o
   destino - entao isDirectory() responde sobre o link, e o link nao e pasta.

   Um filtro so com isDirectory() faz o Z: inteiro aparecer VAZIO. Nao da erro,
   nao avisa nada: some. O statSync SEGUE o link e pergunta ao destino, que e
   o que interessa.

   Ele custa uma ida ao disco por entrada, entao so e chamado quando o barato
   ja disse nao - e junction do Windows cai no mesmo caminho. */
function ehPasta(entrada, caminho) {
    if (entrada.isDirectory()) return true;
    if (!entrada.isSymbolicLink()) return false;
    try { return fs.statSync(caminho).isDirectory(); }
    catch (e) { return false; }            /* link quebrado ou sem acesso */
}

function subpastas(dir) {
    try {
        return fs.readdirSync(dir, { withFileTypes: true })
            .filter(function (d) {
                return d.name.charAt(0) !== '.'
                    && d.name !== 'node_modules'
                    && d.name !== 'target'
                    && ehPasta(d, path.join(dir, d.name));
            })
            .map(function (d) { return path.join(dir, d.name); });
    } catch (e) {
        return null;                       /* sem permissao, ou sumiu */
    }
}

/* Junta os candidatos SEM chamar o git ainda: primeiro sabemos onde olhar,
   depois olhamos. Misturar as duas coisas faria a varredura de uma pasta de
   rede lenta parecer travada, sem nunca dizer quantos faltam. */
function candidatos(pastas) {
    var achados = [];
    var vistos = {};

    function incluir(caminho, versionado) {
        var chave = path.resolve(caminho).toLowerCase();
        if (vistos[chave]) return;
        vistos[chave] = true;
        achados.push({ caminho: caminho, nome: path.basename(caminho), versionado: versionado });
    }

    function descer(dir, nivel) {
        if (ehRepo(dir)) {
            /* Achou repositorio: PARA de descer. Dentro de um repositorio nao
               ha outro a procurar, e descer ali seria percorrer a arvore
               inteira do projeto - pela rede, quando a pasta e do Z:. */
            incluir(dir, true);
            return true;
        }
        if (nivel >= PROFUNDIDADE) return false;

        var filhos = subpastas(dir);
        if (filhos === null) return false;

        var algum = false;
        for (var i = 0; i < filhos.length; i++) {
            if (descer(filhos[i], nivel + 1)) algum = true;
        }
        return algum;
    }

    (pastas || []).forEach(function (raiz) {
        if (!fs.existsSync(raiz)) {
            achados.push({ caminho: raiz, nome: path.basename(raiz) || raiz,
                           versionado: false, erro: 'pasta nao encontrada' });
            return;
        }

        if (ehRepo(raiz)) { incluir(raiz, true); return; }

        var filhos = subpastas(raiz);
        if (filhos === null) {
            achados.push({ caminho: raiz, nome: path.basename(raiz),
                           versionado: false, erro: 'nao consegui ler a pasta' });
            return;
        }

        filhos.forEach(function (f) {
            /* Subpasta que nao e repositorio e nao contem nenhum entra na
               lista como NAO VERSIONADA - e o aviso, nao um item faltando. */
            if (!descer(f, 1)) incluir(f, false);
        });
    });

    return achados;
}

/* Poucos de cada vez: numa pasta de rede, disparar 30 "git status" juntos
   enfileira tudo no SMB e a lista inteira demora o tempo do mais lento. */
function rodarEmLotes(itens, tarefa, simultaneos) {
    var fila = itens.slice();
    var resultados = [];
    var ativos = [];

    function proximo() {
        if (!fila.length) return Promise.resolve();
        var item = fila.shift();
        return tarefa(item).then(function (r) {
            resultados.push(r);
            return proximo();
        });
    }

    for (var i = 0; i < Math.min(simultaneos, itens.length); i++) ativos.push(proximo());
    return Promise.all(ativos).then(function () { return resultados; });
}

/* O estado de um repositorio, ja pronto para a tela. Nunca rejeita: um
   repositorio ilegivel vira uma LINHA COM ERRO na lista, porque sumir da lista
   e o pior desfecho possivel - a pessoa concluiria que esta tudo salvo. */
function estado(item) {
    if (!item.versionado || item.erro) {
        return Promise.resolve(Object.assign({
            branch: null, sujo: false, alterados: 0, novos: 0, conflitos: 0,
            ahead: 0, behind: 0, ultimoCommit: null
        }, item));
    }

    return git.status(item.caminho)
        .then(function (st) {
            return git.ultimoCommit(item.caminho).then(function (uc) {
                return Object.assign({}, item, {
                    branch: st.branch,
                    destacado: st.destacado,
                    semCommit: st.semCommit,
                    sujo: st.sujo,
                    alterados: st.alterados.length,
                    novos: st.novos.length,
                    conflitos: st.conflitos.length,
                    ahead: st.ahead,
                    behind: st.behind,
                    upstream: st.upstream,
                    ultimoCommit: uc
                });
            });
        })
        .then(null, function (e) {
            return Object.assign({}, item, { erro: e.message, sujo: false });
        });
}

function listar(pastas) {
    var itens = candidatos(pastas);
    return rodarEmLotes(itens, estado, SIMULTANEOS).then(function (lista) {
        lista.sort(function (a, b) {
            /* O que precisa de atencao primeiro: nao versionado, depois com
               pendencia, depois o resto. A ordem da lista E a prioridade. */
            function peso(r) {
                if (r.erro) return 0;
                if (!r.versionado) return 1;
                if (r.conflitos) return 2;
                if (r.sujo) return 3;
                if (r.ahead) return 4;
                return 5;
            }
            var d = peso(a) - peso(b);
            return d !== 0 ? d : a.nome.localeCompare(b.nome);
        });
        return lista;
    });
}

/* O detalhe de UM repositorio: o que a tela de salvar precisa. */
function detalhe(caminho) {
    return git.status(caminho).then(function (st) {
        return git.ultimoCommit(caminho).then(function (uc) {
            return {
                caminho: caminho,
                nome: path.basename(caminho),
                branch: st.branch,
                destacado: st.destacado,
                semCommit: st.semCommit,
                upstream: st.upstream,
                ahead: st.ahead,
                behind: st.behind,
                alterados: st.alterados,
                novos: st.novos,
                conflitos: st.conflitos,
                juntando: !!st.juntando,
                sujo: st.sujo,
                ultimoCommit: uc
            };
        });
    });
}

/* ==========================================================================
   NAVEGAR PELO DISCO, PARA ESCOLHER UMA PASTA
   --------------------------------------------------------------------------
   Colar caminho a mao e a pior parte de configurar o app: ninguem lembra se a
   pasta e "Repositorios" ou "Repositórios", e um acento errado vira "pasta nao
   encontrada" sem dizer o porque.

   O navegador do Chrome nao entrega o caminho real de uma pasta escolhida - e
   uma decisao de seguranca dele, e ela esta certa. Mas este app roda NA
   MAQUINA da pessoa, entao quem lista o disco pode ser ele proprio.

   ISTO NAO FURA A CERCA. A cerca vale para as OPERACOES do git: ler status,
   commitar, baixar versao. Navegar para escolher uma pasta e o passo ANTERIOR
   - e a pessoa ja ve o disco inteiro no Explorer, com a mesma conta. O que a
   cerca impede continua impedido: operar fora do que ela cadastrou.
   ========================================================================== */
function unidades() {
    var achadas = [];
    if (process.platform !== 'win32') return [{ caminho: '/', nome: '/' }];

    'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').forEach(function (letra) {
        var raiz = letra + ':\\';
        try {
            fs.accessSync(raiz);
            achadas.push({ caminho: raiz, nome: raiz });
        } catch (e) { /* unidade nao existe ou nao esta pronta */ }
    });
    return achadas;
}

function navegar(alvo) {
    /* Sem alvo: a lista de unidades, mais os lugares onde as pessoas daqui
       realmente guardam repositorio. */
    if (!alvo) {
        var atalhos = [];
        [process.env.USERPROFILE, path.join(process.env.USERPROFILE || '', 'Documents')]
            .forEach(function (c) {
                if (c && fs.existsSync(c)) atalhos.push({ caminho: c, nome: path.basename(c) || c });
            });
        return Promise.resolve({
            atual: null, pai: null,
            pastas: unidades().concat(atalhos)
        });
    }

    var lista = subpastas(alvo);
    if (lista === null) {
        return Promise.reject(Object.assign(
            new Error('não consegui abrir esta pasta'), { codigo: 'SEM_ACESSO' }));
    }

    var pai = path.dirname(alvo);
    return Promise.resolve({
        atual: alvo,
        /* Na raiz de uma unidade, dirname devolve ela mesma - e o botao de
           subir ficaria girando no lugar. Nesse caso, "subir" volta para a
           lista de unidades. */
        pai: (pai && pai !== alvo) ? pai : null,
        pastas: lista.map(function (c) {
            return { caminho: c, nome: path.basename(c), repo: ehRepo(c) };
        })
    });
}

module.exports = {
    listar: listar,
    detalhe: detalhe,
    candidatos: candidatos,
    ehRepo: ehRepo,
    navegar: navegar
};
