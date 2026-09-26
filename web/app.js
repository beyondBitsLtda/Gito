/* ============================================================================
   Gito - a interface
   ============================================================================
   Sem framework e sem build: o app tem tres telas e precisa poder ser
   atualizado copiando um arquivo para uma pasta de rede. Uma etapa de build
   aqui significaria "quem for mexer precisa instalar o ambiente antes" - e
   quase ninguem da equipe vai mexer nisto com frequencia.

   VOCABULARIO: a tela fala "salvar meu trabalho", nao "stage" e "commit". Quem
   vai usar isto e quem nao abre o VSCode. O termo tecnico esta no titulo do
   campo quando ajuda, nunca no botao.
============================================================================ */
(function () {
    'use strict';

    /* O token veio na URL. Guardamos em memoria e LIMPAMOS a barra de
       endereco: token em URL fica no historico do navegador e vaza em print de
       tela - e o app inteiro se apoia nele. */
    var TOKEN = new URLSearchParams(location.search).get('t') || '';
    if (TOKEN) history.replaceState(null, '', location.pathname);

    var estado = { repos: [], repoAberto: null, pastas: [] };

    /* ---------------------------------------------------------------- API */

    /* O APP ENCERRADO É O CASO NORMAL, NÃO UMA EXCEÇÃO.

       Fechar a janela preta é como se fecha este programa - então a página
       aberta no navegador VAI, mais cedo ou mais tarde, ficar falando com um
       servidor que não existe mais. Sem tratamento, isso vira "Failed to
       fetch" no console e uma tela que simplesmente não responde a nada, sem
       dizer por quê.

       Quando a conexão cai, a faixa abaixo fica FIXA na tela (não some sozinha
       como os outros recados) e diz o que fazer. */
    function appEncerrado() {
        var el = $('[data-recado]');
        el.textContent = 'O Gito foi encerrado — a janela preta foi fechada. ' +
                         'Abra o gito.cmd de novo e recarregue esta página.';
        el.className = 'recado recado--erro recado--fixo';
        el.hidden = false;
        clearTimeout(relogioRecado);
    }

    function api(rota, opcoes) {
        opcoes = opcoes || {};
        return fetch(rota, {
            method: opcoes.metodo || 'GET',
            headers: Object.assign({ 'X-Gito-Token': TOKEN },
                                   opcoes.corpo ? { 'Content-Type': 'application/json' } : {}),
            body: opcoes.corpo ? JSON.stringify(opcoes.corpo) : undefined
        }).then(function (r) {
            return r.json().then(function (j) {
                if (!j.ok) throw Object.assign(new Error(j.mensagem || 'falhou'),
                                               { codigo: j.codigo, detalhe: j.detalhe });
                return j.dados;
            });
        }, function (e) {
            /* TypeError do fetch = não chegou no servidor. Não é erro da
               operação; é o app que não está mais lá. */
            appEncerrado();
            throw Object.assign(new Error('o app não está mais rodando'), { codigo: 'SEM_APP' });
        });
    }

    /* ------------------------------------------------------------ ATALHOS */
    function $(sel, raiz) { return (raiz || document).querySelector(sel); }
    function $$(sel, raiz) { return Array.prototype.slice.call((raiz || document).querySelectorAll(sel)); }

    function criar(tag, classe, texto) {
        var e = document.createElement(tag);
        if (classe) e.className = classe;
        if (texto !== undefined) e.textContent = texto;      /* textContent escapa sozinho */
        return e;
    }

    var relogioRecado = null;
    function recado(texto, ehErro) {
        var el = $('[data-recado]');
        /* O aviso de "app encerrado" é definitivo: nada mais vai funcionar até
           reabrir. Deixar um recado passageiro cobri-lo esconderia a única
           mensagem que explica por que a tela parou de responder. */
        if (el.classList.contains('recado--fixo')) return;
        el.textContent = texto;
        el.className = 'recado' + (ehErro ? ' recado--erro' : '');
        el.hidden = false;
        clearTimeout(relogioRecado);
        relogioRecado = setTimeout(function () { el.hidden = true; }, ehErro ? 6000 : 3000);
    }

    /* Erro do git: a tradução em português fica visível, e o que o git
       realmente disse fica a um clique. Trocar um pelo outro foi o erro da
       primeira versão — a mensagem real sumia junto com a chance de descobrir
       a causa. Um erro de push com "detalhe" é copiável e mostrável. */
    function erroDetalhado(e, host) {
        var cx = criar('div', 'erro-cx');
        cx.appendChild(criar('p', 'erro-cx__msg', e.message));

        if (e.detalhe) {
            var det = document.createElement('details');
            det.appendChild(criar('summary', null, 'o que o git respondeu'));
            det.appendChild(criar('pre', 'erro-cx__bruto', e.detalhe));
            cx.appendChild(det);
        }
        if (host) { host.innerHTML = ''; host.appendChild(cx); host.hidden = false; }
        return cx;
    }

    function mostrarTela(id) {
        $$('[data-tela-id]').forEach(function (s) { s.hidden = (s.getAttribute('data-tela-id') !== id); });
        $$('.nav__item').forEach(function (b) {
            b.classList.toggle('nav__item--ativo', b.getAttribute('data-tela') === id);
        });
    }

    /* =================================================== LISTA DE REPOS */
    function classeEstado(r) {
        if (r.erro) return 'erro';
        if (!r.versionado) return 'sem-git';
        if (r.conflitos) return 'pendente';
        if (r.sujo) return 'pendente';
        if (r.ahead) return 'enviar';
        return 'limpo';
    }

    function textoEstado(r) {
        if (r.erro) return r.erro;
        if (!r.versionado) return 'NÃO VERSIONADO';
        if (r.semCommit) return 'sem nenhum commit ainda';
        if (r.conflitos) return r.conflitos + ' em conflito';

        var partes = [];
        if (r.alterados) partes.push(r.alterados + (r.alterados > 1 ? ' alterados' : ' alterado'));
        if (r.novos) partes.push(r.novos + (r.novos > 1 ? ' novos' : ' novo'));
        if (!partes.length) partes.push('tudo salvo');
        if (r.ahead) partes.push(r.ahead + ' para enviar');
        return partes.join(' · ');
    }

    /* "há 3 dias" diz mais que a data: a pergunta é há quanto tempo aquilo
       está parado, não em que dia foi. */
    function desde(iso) {
        if (!iso) return '';
        var dias = Math.floor((Date.now() - Date.parse(iso)) / 86400000);
        if (isNaN(dias)) return '';
        if (dias <= 0) return 'hoje';
        if (dias === 1) return 'ontem';
        if (dias < 30) return 'há ' + dias + ' dias';
        if (dias < 60) return 'há 1 mês';
        if (dias < 365) return 'há ' + Math.floor(dias / 30) + ' meses';
        return 'há mais de 1 ano';
    }

    function pintarRepos() {
        var host = $('[data-lista-repos]');
        host.innerHTML = '';

        if (!estado.repos.length) {
            var v = criar('div', 'vazio');
            v.appendChild(criar('p', null, 'Nenhuma pasta configurada ainda.'));
            var b = criar('button', 'btn btn--principal', 'Escolher minhas pastas');
            b.onclick = function () { mostrarTela('pastas'); };
            v.appendChild(b);
            host.appendChild(v);
            $('[data-resumo]').textContent = '';
            return;
        }

        estado.repos.forEach(function (r) {
            var el = criar('button', 'repo repo--' + classeEstado(r));

            var nome = criar('span', 'repo__nome');
            nome.appendChild(document.createTextNode(r.nome));
            nome.appendChild(criar('span', 'repo__caminho', r.caminho));
            el.appendChild(nome);

            el.appendChild(criar('span', 'repo__branch', r.branch || (r.versionado ? '' : '—')));
            el.appendChild(criar('span', 'repo__commit',
                r.ultimoCommit ? r.ultimoCommit.assunto : ''));
            el.appendChild(criar('span', 'repo__quando',
                r.ultimoCommit ? desde(r.ultimoCommit.data) : ''));
            el.appendChild(criar('span', 'repo__estado', textoEstado(r)));

            el.onclick = function () { abrirRepo(r); };
            host.appendChild(el);
        });

        var semGit = estado.repos.filter(function (r) { return !r.versionado && !r.erro; }).length;
        var sujos = estado.repos.filter(function (r) { return r.sujo; }).length;
        var resumo = estado.repos.length + ' pasta(s)';
        if (sujos) resumo += ' · ' + sujos + ' com coisa a salvar';
        if (semGit) resumo += ' · ' + semGit + ' não versionada(s)';
        $('[data-resumo]').textContent = resumo;
    }

    function carregarRepos() {
        $('[data-resumo]').textContent = 'Lendo…';
        return api('/api/repos').then(function (lista) {
            estado.repos = lista;
            pintarRepos();
        }).catch(function (e) { recado(e.message, true); });
    }

    /* ==================================================== UM REPOSITÓRIO */
    function abrirRepo(r) {
        if (!r.versionado) return oferecerCriarRepo(r);
        mostrarTela('repo');
        $('[data-repo-nome]').textContent = r.nome;
        $('[data-repo-info]').textContent = 'lendo…';
        $('[data-repo-corpo]').innerHTML = '';

        api('/api/repo?p=' + encodeURIComponent(r.caminho))
            .then(function (d) { estado.repoAberto = d; pintarRepo(d); })
            .catch(function (e) { recado(e.message, true); });
    }

    /* A PASTA QUE AINDA NÃO É UM REPOSITÓRIO.

       Antes isto era um recado dizendo "chega na próxima versão", o que
       transformava a pasta num item de lista que só servia para frustrar.
       Agora é o único lugar do app que CRIA um repositório — e ele explica o
       que vai acontecer antes, porque "git init" é daquelas coisas que a
       pessoa faz sem saber o que fez. */
    function oferecerCriarRepo(r) {
        mostrarTela('repo');
        $('[data-repo-nome]').textContent = r.nome;
        $('[data-repo-info]').textContent = 'ainda não é um repositório';

        var host = $('[data-repo-corpo]');
        host.innerHTML = '';

        var bloco = criar('div', 'bloco');
        bloco.appendChild(criar('p', 'bloco__titulo', 'Começar a versionar esta pasta'));
        bloco.appendChild(criar('p', 'ajuda',
            'Isto cria o histórico aqui dentro, nesta máquina. Nada é enviado para ' +
            'lugar nenhum e nenhum arquivo seu é alterado — a partir daí você passa a ' +
            'poder salvar versões do que mudar.'));
        bloco.appendChild(criar('p', 'ajuda ajuda--fraca', r.caminho));

        var linha = criar('div', 'linha-acoes');
        var campo = document.createElement('input');
        campo.type = 'text';
        campo.value = 'main';
        campo.spellcheck = false;
        campo.title = 'Nome do primeiro ramo';
        linha.appendChild(campo);

        var bt = criar('button', 'btn btn--principal', 'Criar repositório aqui');
        bt.onclick = function () {
            bt.disabled = true; bt.textContent = 'criando…';
            api('/api/criar-repo', { metodo: 'POST', corpo: { p: r.caminho, branch: campo.value.trim() } })
                .then(function () {
                    recado('Pronto. Agora esta pasta tem histórico.');
                    return carregarRepos().then(function () {
                        abrirRepo({ caminho: r.caminho, nome: r.nome, versionado: true });
                    });
                })
                .catch(function (e) {
                    bt.disabled = false; bt.textContent = 'Criar repositório aqui';
                    recado(e.message, true);
                });
        };
        linha.appendChild(bt);
        bloco.appendChild(linha);

        bloco.appendChild(criar('p', 'ajuda ajuda--fraca',
            'O nome do primeiro ramo costuma ser "main". Se esta pasta for virar uma cópia ' +
            'de algo que já existe no GitLab, não crie aqui — peça o clone para a equipe, ' +
            'senão você fica com duas histórias separadas que nunca se encontram.'));

        host.appendChild(bloco);
    }

    function pintarRepo(d, abaPedida) {
        var info = [d.branch ? 'branch ' + d.branch +
                               (!d.upstream && !d.semCommit ? ' (só neste computador)' : '')
                             : 'HEAD destacado'];
        if (d.ultimoCommit) info.push('último: ' + d.ultimoCommit.assunto);
        if (d.ahead) info.push(d.ahead + ' para enviar');
        if (d.behind) info.push(d.behind + ' para trazer');
        $('[data-repo-info]').textContent = info.join('  ·  ');

        var host = $('[data-repo-corpo]');
        host.innerHTML = '';

        /* ------- ações do repositório ------- */
        var acoes = criar('div', 'acoes');
        var caixaErro = criar('div', 'erro-host');
        caixaErro.hidden = true;

        /* BRANCH QUE O SERVIDOR NUNCA VIU.

           Sem par no servidor o git não conta "salvamentos para enviar" — o
           ahead fica 0 — e o botão Enviar ficava apagado para sempre numa
           branch nova, sem dizer por quê. Nesse caso a ação que existe é
           publicar, e é ela que o botão passa a oferecer. */
        var semServidor = !!d.branch && !d.upstream && !d.semCommit;
        var bEnviar;
        if (semServidor) {
            bEnviar = criar('button', 'btn btn--principal', 'Publicar branch no servidor');
            bEnviar.title = 'A branch "' + d.branch + '" só existe neste computador. ' +
                            'Publicar cria ela no servidor e envia o que você já salvou.';
            bEnviar.onclick = function () { publicarBranch(d, d.branch, bEnviar); };
        } else {
            bEnviar = criar('button', 'btn' + (d.ahead ? ' btn--principal' : ''),
                d.ahead ? ('Enviar ' + d.ahead + (d.ahead > 1 ? ' salvamentos' : ' salvamento')) : 'Enviar');
            bEnviar.disabled = !d.ahead;
            bEnviar.title = d.ahead ? 'Manda para o servidor o que você já salvou'
                                    : 'Nada novo para enviar';
            bEnviar.onclick = function () { enviar(d, bEnviar); };
        }
        acoes.appendChild(bEnviar);

        var bTrazer = criar('button', 'btn', 'Trazer do servidor');
        bTrazer.title = 'Traz o que os outros enviaram';
        bTrazer.onclick = function () { trazer(d, bTrazer); };
        acoes.appendChild(bTrazer);
        host.appendChild(acoes);
        host.appendChild(caixaErro);
        estado.caixaErro = caixaErro;

        /* A JUNÇÃO ABERTA fica aqui em cima, fora das abas, até acabar.

           Ela morava dentro de "O que mudou" e só aparecia enquanto houvesse
           conflito. Decidido o último arquivo, a lista ficava vazia, a aba
           dizia "Tudo salvo" — e o botão "Concluir a junção" sumia no exato
           momento em que era a única coisa a fazer. Quem estava em Branches
           nem chegava a ver o painel. */
        if (d.juntando || d.conflitos.length) host.appendChild(painelDeConflito(d));

        /* Para onde este repositório envia. Metade dos "não consigo enviar" é
           o remote apontando para outro lugar que a pessoa imagina — e ela só
           descobre isso vendo o endereço. */
        api('/api/remotes?p=' + encodeURIComponent(d.caminho))
            .then(function (rs) {
                if (!rs.length) {
                    /* Sem servidor, "Publicar" não tem para onde ir. */
                    if (semServidor) { bEnviar.disabled = true; bEnviar.className = 'btn'; }
                    acoes.appendChild(criar('span', 'acoes__nota',
                        'este repositório não tem servidor configurado — só existe nesta máquina'));
                    return;
                }
                acoes.appendChild(criar('span', 'acoes__nota', 'envia para ' + rs[0].url));
            })
            .catch(function () { /* sem remote não é erro */ });

        /* ------- sub-abas ------- */
        var abas = criar('div', 'subnav');
        var corpo = criar('div');
        var ativa = abaPedida || 'mudancas';

        [['mudancas', 'O que mudou'], ['arquivos', 'Arquivos'],
         ['historico', 'Histórico'], ['branches', 'Branches'], ['mrs', 'Merge Requests']]
            .forEach(function (par) {
                var b = criar('button', 'subnav__item' + (ativa === par[0] ? ' subnav__item--ativo' : ''),
                              par[1]);
                b.onclick = function () { pintarRepo(d, par[0]); };
                abas.appendChild(b);
            });
        host.appendChild(abas);
        host.appendChild(corpo);

        if (ativa === 'historico') return pintarHistorico(d, corpo);
        if (ativa === 'branches') return pintarBranches(d, corpo);
        if (ativa === 'mrs') return pintarMergeRequests(d, corpo);
        if (ativa === 'arquivos') return pintarArvore(d, corpo);

        pintarMudancas(d, corpo);
    }

    /* ==================================================== A BASE DE CÓDIGO */
    function pintarArvore(d, host) {
        host.innerHTML = '';
        var bloco = criar('div', 'bloco');
        bloco.appendChild(criar('p', 'bloco__titulo', 'Arquivos versionados'));
        bloco.appendChild(criar('p', 'ajuda',
            'O que está guardado no git — não o que está na pasta. ' +
            'Arquivo que você vê no Explorer e não vê aqui é arquivo que ninguém versionou.'));

        var busca = document.createElement('input');
        busca.type = 'text';
        busca.placeholder = 'filtrar por nome ou pasta…';
        busca.className = 'arvore__busca';
        bloco.appendChild(busca);

        var lista = criar('div', 'arvore');
        bloco.appendChild(lista);
        host.appendChild(bloco);

        api('/api/arvore?p=' + encodeURIComponent(d.caminho))
            .then(function (arquivos) {
                var raiz = montarArvore(arquivos);

                /* Quais pastas estão abertas. Fica FORA da função de pintura
                   para sobreviver a cada redesenho — senão a árvore fecharia
                   inteira a cada clique, que é o oposto de navegar. */
                var abertas = { '': true };
                Object.keys(raiz.pastas).forEach(function (n) { abertas[n] = true; });

                function pintar(filtro) {
                    lista.innerHTML = '';
                    var f = (filtro || '').trim().toLowerCase();

                    /* Com filtro, a hierarquia atrapalha: quem busca quer ver
                       os resultados, não navegar até eles. O Explorer faz o
                       mesmo quando você digita na caixa de pesquisa. */
                    if (f) {
                        var achados = arquivos.filter(function (a) {
                            return a.caminho.toLowerCase().indexOf(f) >= 0;
                        });
                        achados.slice(0, 300).forEach(function (a) {
                            lista.appendChild(linhaDeArquivo(d, a.caminho, a.caminho, a.bytes, 0));
                        });
                        lista.appendChild(criar('p', 'ajuda ajuda--fraca',
                            achados.length + ' de ' + arquivos.length + ' arquivo(s)' +
                            (achados.length > 300 ? ' — mostrando os 300 primeiros' : '')));
                        return;
                    }

                    desenharPasta(d, raiz, '', 0, lista, abertas, function () { pintar(''); });
                    lista.appendChild(criar('p', 'ajuda ajuda--fraca',
                        arquivos.length + ' arquivo(s) versionado(s)'));
                }

                pintar('');
                var t = null;
                busca.oninput = function () {
                    clearTimeout(t);
                    t = setTimeout(function () { pintar(busca.value); }, 150);
                };
            })
            .catch(function (e) { erroDetalhado(e, lista); });
    }

    /* Transforma a lista de caminhos ("a/b/c.js") na hierarquia de pastas.

       O git entrega tudo plano, e é assim que ele pensa - mas não é assim que
       alguém procura um arquivo. Quem abre esta aba quer reconhecer o projeto
       dele: wcm/, datasets/, sql/. */
    function montarArvore(arquivos) {
        var raiz = { nome: '', pastas: {}, arquivos: [], total: 0 };

        (arquivos || []).forEach(function (a) {
            var partes = a.caminho.split('/');
            var atual = raiz;
            atual.total++;

            for (var i = 0; i < partes.length - 1; i++) {
                if (!atual.pastas[partes[i]]) {
                    atual.pastas[partes[i]] = { nome: partes[i], pastas: {}, arquivos: [], total: 0 };
                }
                atual = atual.pastas[partes[i]];
                atual.total++;
            }
            atual.arquivos.push({
                nome: partes[partes.length - 1], caminho: a.caminho, bytes: a.bytes
            });
        });
        return raiz;
    }

    function desenharPasta(d, no, prefixo, nivel, host, abertas, redesenhar) {
        /* Pastas antes de arquivos, cada grupo em ordem alfabética - é a ordem
           do Explorer, e a que a pessoa já espera sem pensar. */
        Object.keys(no.pastas).sort(function (a, b) { return a.localeCompare(b); })
            .forEach(function (nome) {
                var filho = no.pastas[nome];
                var chave = prefixo ? (prefixo + '/' + nome) : nome;
                var aberta = !!abertas[chave];

                var linha = criar('div', 'arv__linha arv__linha--pasta');
                linha.style.paddingLeft = (nivel * 15 + 2) + 'px';

                var bt = criar('button', 'arv__botao');
                bt.appendChild(criar('span', 'arv__seta', aberta ? '▾' : '▸'));
                bt.appendChild(criar('span', 'arv__pasta', nome));
                bt.title = (aberta ? 'Fechar' : 'Abrir') + ' ' + chave;
                bt.onclick = function () { abertas[chave] = !aberta; redesenhar(); };
                linha.appendChild(bt);
                linha.appendChild(criar('span', 'arv__conta', filho.total));
                host.appendChild(linha);

                if (aberta) desenharPasta(d, filho, chave, nivel + 1, host, abertas, redesenhar);
            });

        no.arquivos.sort(function (a, b) { return a.nome.localeCompare(b.nome); })
            .forEach(function (a) {
                host.appendChild(linhaDeArquivo(d, a.nome, a.caminho, a.bytes, nivel));
            });
    }

    function linhaDeArquivo(d, rotulo, caminho, bytes, nivel) {
        var linha = criar('div', 'arv__linha');
        linha.style.paddingLeft = (nivel * 15 + 2) + 'px';

        var bt = criar('button', 'arv__botao');
        /* O espaço da seta fica reservado mesmo sem seta: sem ele, o nome do
           arquivo encosta 12px à esquerda do nome da pasta irmã, e a coluna
           deixa de ser uma coluna. */
        bt.appendChild(criar('span', 'arv__seta', ''));
        bt.appendChild(criar('span', 'arv__arquivo', rotulo));
        bt.title = 'Ver ' + caminho;
        bt.onclick = function () { verArquivo(d, caminho, 'HEAD', linha); };
        linha.appendChild(bt);
        linha.appendChild(criar('span', 'arv__bytes', tamanho(bytes)));
        return linha;
    }

    /* Código com número de linha, como no editor.

       O limite de linhas não é preciosismo: um dsDevToolsCatalogo.js tem 32 KB
       e um SQL de instalação passa de mil linhas. Realçar tudo de uma vez trava
       a aba por segundos, e ninguém abre um visualizador para ler a linha 4000
       — quem precisa daquilo abre o arquivo no editor. */
    var MAX_LINHAS = 2500;

    function codigoComLinhas(texto, caminho) {
        var linhas = String(texto).split('\n');
        var cortado = linhas.length > MAX_LINHAS;
        if (cortado) linhas = linhas.slice(0, MAX_LINHAS);

        var cx = criar('div', 'codigo');

        var numeros = criar('div', 'codigo__nums');
        var n = '';
        for (var i = 1; i <= linhas.length; i++) n += i + '\n';
        numeros.textContent = n;
        cx.appendChild(numeros);

        var pre = criar('pre', 'codigo__texto');
        /* innerHTML aqui é seguro: o realce escapa o conteúdo ANTES de inserir
           as tags dele. Ver realce.js. */
        pre.innerHTML = global_realce().realcar(linhas.join('\n'), caminho);
        cx.appendChild(pre);

        if (cortado) {
            var aviso = criar('div', 'codigo__corte',
                'mostrando as primeiras ' + MAX_LINHAS + ' linhas de ' +
                String(texto).split('\n').length);
            var fora = criar('div');
            fora.appendChild(cx);
            fora.appendChild(aviso);
            return fora;
        }
        return cx;
    }

    /* O realce é um arquivo à parte; se ele falhar em carregar, o visor ainda
       tem de mostrar o código — sem cor, mas legível. */
    function global_realce() {
        return window.realce || {
            realcar: function (t) {
                return String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
            }
        };
    }

    function tamanho(b) {
        if (b < 1024) return b + ' B';
        if (b < 1024 * 1024) return Math.round(b / 1024) + ' KB';
        return (b / 1048576).toFixed(1) + ' MB';
    }

    function verArquivo(d, caminho, ref, ancora) {
        var ja = ancora.nextSibling;
        if (ja && ja.classList && ja.classList.contains('visor')) { ja.remove(); return; }

        var visor = criar('div', 'visor');
        visor.appendChild(criar('p', 'ajuda ajuda--fraca', 'lendo…'));
        ancora.parentNode.insertBefore(visor, ancora.nextSibling);

        api('/api/ver-arquivo?p=' + encodeURIComponent(d.caminho) +
            '&ref=' + encodeURIComponent(ref) + '&a=' + encodeURIComponent(caminho))
            .then(function (r) {
                visor.innerHTML = '';
                /* Binário vira ruído ilegível e trava o navegador por alguns
                   segundos. Melhor dizer que é binário do que despejá-lo. */
                if (/\u0000/.test(r.conteudo.slice(0, 4000))) {
                    visor.appendChild(criar('p', 'ajuda', 'Arquivo binário — não dá para mostrar como texto.'));
                    return;
                }
                visor.appendChild(codigoComLinhas(r.conteudo, caminho));
            })
            .catch(function (e) { erroDetalhado(e, visor); });
    }

    /* ==================================================== HISTÓRICO */
    function pintarHistorico(d, host) {
        host.innerHTML = '';
        var bloco = criar('div', 'bloco bloco--linha');
        bloco.appendChild(criar('p', 'bloco__titulo', 'Versões salvas'));
        bloco.appendChild(criar('p', 'ajuda',
            'Baixar traz aquela versão num .zip, sem encostar na sua pasta. ' +
            'Você abre, confere e copia de volta só o que quiser.'));
        host.appendChild(bloco);

        api('/api/historico?p=' + encodeURIComponent(d.caminho) + '&n=40')
            .then(function (lista) {
                if (!lista.length) {
                    bloco.appendChild(criar('div', 'vazio', 'Nenhuma versão salva ainda.'));
                    return;
                }
                lista.forEach(function (c, i) {
                    var linha = criar('div', 'commit');
                    linha.appendChild(criar('span', 'commit__sha', c.curto));

                    var meio = criar('span', 'commit__meio');
                    meio.appendChild(criar('span', 'commit__assunto', c.assunto));
                    meio.appendChild(criar('span', 'commit__autor',
                        c.autor + '  ·  ' + desde(c.data)));
                    linha.appendChild(meio);

                    if (i === 0) linha.appendChild(criar('span', 'commit__tag', 'atual'));

                    var b = criar('a', 'btn btn--mini', 'Baixar .zip');
                    b.href = '/api/baixar-versao?p=' + encodeURIComponent(d.caminho) +
                             '&ref=' + encodeURIComponent(c.sha) + '&t=' + encodeURIComponent(TOKEN);
                    b.setAttribute('download', '');
                    b.title = 'Baixa esta versão sem alterar nada na sua pasta';
                    linha.appendChild(b);

                    bloco.appendChild(linha);
                });
            })
            .catch(function (e) { recado(e.message, true); });
    }

    /* ==================================================== BRANCHES */
    function pintarBranches(d, host) {
        host.innerHTML = '';
        var bloco = criar('div', 'bloco');
        bloco.appendChild(criar('p', 'bloco__titulo', 'Branches'));
        host.appendChild(bloco);

        if (d.sujo) {
            bloco.appendChild(criar('div', 'aviso',
                'Você tem trabalho não salvo. Salve antes de trocar de branch — ' +
                'senão as alterações vão junto para a outra e some da branch onde estavam.'));
        }

        /* CRIAR UM RAMO.

           Fica aqui em cima, antes da lista: quem abre esta aba ou quer trocar
           de ramo ou quer um novo, e o novo é o que não tinha como fazer sem
           terminal. O ramo nasce de onde a pessoa está e ela já vai para ele —
           criar e não mudar é a pegadinha clássica de quem está aprendendo. */
        var novo = criar('div', 'linha-acoes');
        var campoNovo = document.createElement('input');
        campoNovo.type = 'text';
        campoNovo.placeholder = 'nome do ramo novo — ex.: correcao-do-login';
        campoNovo.spellcheck = false;
        novo.appendChild(campoNovo);

        var btNovo = criar('button', 'btn', 'Criar ramo');
        btNovo.onclick = function () {
            var nome = campoNovo.value.trim();
            if (!nome) return recado('Escreva o nome do ramo.', true);
            btNovo.disabled = true; btNovo.textContent = 'criando…';
            api('/api/criar-branch', { metodo: 'POST', corpo: { p: d.caminho, nome: nome } })
                .then(function () {
                    recado('Ramo "' + nome + '" criado. Você já está nele.');
                    return carregarRepos().then(function () {
                        abrirRepo({ caminho: d.caminho, nome: d.nome, versionado: true });
                    });
                })
                .catch(function (e) {
                    btNovo.disabled = false; btNovo.textContent = 'Criar ramo';
                    recado(e.message, true);
                });
        };
        novo.appendChild(btNovo);
        bloco.appendChild(novo);

        bloco.appendChild(criar('p', 'ajuda ajuda--fraca',
            'Um ramo é uma linha de trabalho separada: o que você salvar nele não ' +
            'atrapalha o que está em "main" até você juntar os dois.'));

        /* As duas seções de juntar ficam num host próprio, pintado depois da
           lista: elas precisam das branches locais E das do servidor, e a
           lista não pode esperar pela segunda leitura para aparecer. */
        var hostJuntar = criar('div');

        api('/api/branches?p=' + encodeURIComponent(d.caminho))
            .then(function (lista) {
                lista.forEach(function (b) {
                    var linha = criar('div', 'commit');
                    linha.appendChild(criar('span', 'commit__meio', b.nome));

                    /* Onde a branch existe. É a pergunta que ninguém conseguia
                       responder olhando a tela: criar e salvar são locais, e
                       uma branch "pronta" podia nunca ter saído daqui. */
                    if (b.publicada) {
                        linha.appendChild(criar('span', 'commit__tag commit__tag--servidor', 'no servidor'));
                    } else {
                        linha.appendChild(criar('span', 'commit__tag commit__tag--local',
                            b.sumiuNoServidor ? 'apagada no servidor' : 'só neste computador'));
                        var bPub = criar('button', 'btn btn--mini',
                            b.sumiuNoServidor ? 'Publicar de novo' : 'Publicar no servidor');
                        bPub.title = b.sumiuNoServidor
                            ? 'Ela existia no servidor e foi apagada lá (comum depois de um Merge Request aceito). ' +
                              'Publicar cria de novo.'
                            : 'Cria esta branch no servidor e envia o que já foi salvo nela.';
                        bPub.onclick = function () { publicarBranch(d, b.nome, bPub); };
                        linha.appendChild(bPub);
                    }

                    if (b.atual) {
                        linha.appendChild(criar('span', 'commit__tag', 'você está aqui'));
                    } else {
                        var bt = criar('button', 'btn btn--mini', 'Ir para esta');
                        bt.disabled = d.sujo;
                        bt.onclick = function () {
                            bt.disabled = true; bt.textContent = 'trocando…';
                            api('/api/branch', { metodo: 'POST', corpo: { p: d.caminho, nome: b.nome } })
                                .then(function () {
                                    recado('Agora você está em ' + b.nome);
                                    return carregarRepos().then(function () {
                                        abrirRepo({ caminho: d.caminho, nome: d.nome, versionado: true });
                                    });
                                })
                                .catch(function (e) {
                                    bt.disabled = false; bt.textContent = 'Ir para esta';
                                    recado(e.message, true);
                                });
                        };
                        linha.appendChild(bt);
                    }
                    bloco.appendChild(linha);
                });
                host.appendChild(hostJuntar);
                pintarJuntarBranches(d, lista, hostJuntar, bloco);
            })
            .catch(function (e) { recado(e.message, true); });
    }

    /* ============================================ JUNTAR BRANCHES

       Duas direções, e elas NÃO são a mesma operação:

       TRAZER OUTRA PARA ESTA — merge local, na pasta. É o "a main andou,
       quero isso na minha branch". Mexe só na branch em que a pessoa está,
       e o que der conflito cai na mesma tela de decidir arquivo por arquivo.

       LEVAR ESTA PARA OUTRA — Merge Request no GitLab. Juntar na main ou na
       DEV é decisão do projeto: fica registrado, alguém pode revisar, e as
       branches protegidas continuam protegidas. O app só abre o pedido já
       preenchido; quem cria é a pessoa, lá.

       Não existe botão de "juntar esta direto na main": seria um merge local
       seguido de push numa branch compartilhada — a operação que passa por
       cima de revisão e que uma branch protegida recusaria de qualquer jeito. */
    function pintarJuntarBranches(d, locais, host, blocoLista) {
        host.innerHTML = '';

        api('/api/branches-remotas?p=' + encodeURIComponent(d.caminho))
            .then(function (rem) { pintarSoNoServidor(d, locais, rem, blocoLista); montar(rem); },
                  function (e) {
                      /* Sem servidor, só dá para juntar branches locais. */
                      if (e.codigo === 'SEM_REMOTO') return montar(null);
                      recado(e.message, true);
                  });

        function montar(rem) {
            if (!d.branch) return;
            /* ---------- 1. trazer outra branch para esta ---------- */
            var b1 = criar('div', 'bloco');
            b1.appendChild(criar('p', 'bloco__titulo', 'Trazer outra branch para "' + d.branch + '"'));
            b1.appendChild(criar('p', 'ajuda',
                'Junta nesta branch o que foi feito em outra — por exemplo, trazer a "main" ' +
                'atualizada antes de pedir o Merge Request. Só esta branch muda; a outra fica como está.'));

            var opcoes = [];
            if (rem) {
                rem.lista.forEach(function (n) {
                    /* A própria branch no servidor é o que "Trazer do servidor"
                       já faz — repetir aqui só confundiria. */
                    if (n === d.branch) return;
                    opcoes.push({ valor: rem.remoto + '/' + n, nome: n,
                                  texto: n + '  (do servidor, atualizada agora)' });
                });
            }
            locais.forEach(function (b) {
                if (b.atual) return;
                opcoes.push({ valor: b.nome, nome: b.nome, texto: b.nome + '  (deste computador)' });
            });

            var linha1 = criar('div', 'linha-acoes');
            var sel1 = criarSelect(opcoes, rem && rem.padrao && rem.padrao !== d.branch
                                            ? rem.remoto + '/' + rem.padrao : '');
            linha1.appendChild(sel1);
            var bTraz = criar('button', 'btn', 'Trazer para cá');
            bTraz.disabled = !opcoes.length || d.sujo || d.conflitos.length > 0 || d.juntando;
            bTraz.title = d.sujo ? 'Salve o que está pendente antes' : 'Junta a branch escolhida nesta';
            bTraz.onclick = function () {
                var op = opcoes[sel1.selectedIndex];
                if (op) trazerBranch(d, op.valor, op.nome, bTraz);
            };
            linha1.appendChild(bTraz);
            b1.appendChild(linha1);
            if (d.sujo) {
                b1.appendChild(criar('p', 'ajuda ajuda--fraca',
                    'Salve o que está pendente antes — o que vier pode esbarrar no que você mexeu.'));
            } else if (!opcoes.length) {
                b1.appendChild(criar('p', 'ajuda ajuda--fraca', 'Não há outra branch para trazer.'));
            }
            host.appendChild(b1);

            /* ---------- 2. pedir para juntar esta em outra (MR) ---------- */
            if (!rem) return;
            var b2 = criar('div', 'bloco');
            b2.appendChild(criar('p', 'bloco__titulo', 'Levar "' + d.branch + '" para outra branch (Merge Request)'));
            b2.appendChild(criar('p', 'ajuda',
                'Abre no GitLab o pedido para juntar esta branch na escolhida, já preenchido. ' +
                'Lá você confere as mudanças, escreve a descrição e cria o pedido — ou pede revisão.'));

            var destinos = rem.lista.filter(function (n) { return n !== d.branch; })
                .map(function (n) { return { valor: n, texto: n }; });
            var linha2 = criar('div', 'linha-acoes');
            var sel2 = criarSelect(destinos, rem.padrao);
            linha2.appendChild(sel2);

            var publicada = rem.lista.indexOf(d.branch) >= 0;
            var bMr = criar('button', 'btn' + (publicada ? ' btn--principal' : ''), 'Abrir Merge Request');
            bMr.disabled = !publicada || !destinos.length;
            bMr.onclick = function () { abrirMergeRequest(d, sel2.value, bMr); };
            linha2.appendChild(bMr);
            b2.appendChild(linha2);

            if (!publicada) {
                var nota = criar('div', 'aviso');
                nota.appendChild(criar('p', null,
                    'A branch "' + d.branch + '" ainda não está no servidor — o GitLab não tem o que juntar.'));
                var bPub = criar('button', 'btn btn--mini', 'Publicar agora');
                bPub.onclick = function () { publicarBranch(d, d.branch, bPub); };
                nota.appendChild(bPub);
                b2.appendChild(nota);
            } else if (d.ahead) {
                /* O pedido é do que está NO SERVIDOR. Salvamento que não foi
                   enviado não entra — e a pessoa acharia que entrou. */
                b2.appendChild(criar('div', 'aviso',
                    'Você tem ' + d.ahead + (d.ahead > 1 ? ' salvamentos' : ' salvamento') +
                    ' que ainda não enviou. Envie antes: o Merge Request só leva o que está no servidor.'));
            }
            host.appendChild(b2);
        }
    }

    /* AS BRANCHES QUE SÓ O SERVIDOR TEM.

       Antes elas não apareciam em lugar nenhum: a lista era só do que existe
       aqui, e a "DEV" que o time usa parecia não existir. Cada uma vem com
       "Baixar", que cria a cópia local SEM trocar de branch e sem mexer na
       pasta — por isso não tem a trava do "trabalho não salvo".

       "Atualizar do servidor" existe porque a lista é da última conversa com
       ele: a branch que um colega criou hoje só aparece depois de perguntar. */
    function pintarSoNoServidor(d, locais, rem, bloco) {
        var aqui = {};
        locais.forEach(function (b) { aqui[b.nome] = true; });
        var soLa = rem.lista.filter(function (n) { return !aqui[n]; });

        soLa.forEach(function (nome) {
            var linha = criar('div', 'commit');
            linha.appendChild(criar('span', 'commit__meio', nome));
            linha.appendChild(criar('span', 'commit__tag', 'só no servidor'));
            var bB = criar('button', 'btn btn--mini', 'Baixar para este computador');
            bB.title = 'Cria a branch "' + nome + '" aqui, igual à do servidor. ' +
                       'Não troca de branch e não mexe nos seus arquivos.';
            bB.onclick = function () {
                bB.disabled = true; bB.textContent = 'baixando…';
                api('/api/baixar-branch', { metodo: 'POST', corpo: { p: d.caminho, nome: nome } })
                    .then(function () {
                        recado('Branch "' + nome + '" baixada. Use "Ir para esta" para trabalhar nela.');
                        return abrirRepoNaAba(d, 'branches');
                    })
                    .catch(function (e) {
                        bB.disabled = false; bB.textContent = 'Baixar para este computador';
                        if (estado.caixaErro) erroDetalhado(e, estado.caixaErro);
                        recado(e.message, true);
                    });
            };
            linha.appendChild(bB);
            bloco.appendChild(linha);
        });

        var rodape = criar('div', 'linha-acoes');
        var bAt = criar('button', 'btn btn--mini', 'Atualizar do servidor');
        bAt.title = 'Pergunta ao servidor quais branches existem agora. Não mexe nos seus arquivos.';
        bAt.onclick = function () {
            bAt.disabled = true; bAt.textContent = 'perguntando…';
            api('/api/atualizar-servidor', { metodo: 'POST', corpo: { p: d.caminho } })
                .then(function () {
                    recado('Lista do servidor atualizada.');
                    return abrirRepoNaAba(d, 'branches');
                })
                .catch(function (e) {
                    bAt.disabled = false; bAt.textContent = 'Atualizar do servidor';
                    if (estado.caixaErro) erroDetalhado(e, estado.caixaErro);
                    recado(e.message, true);
                });
        };
        rodape.appendChild(bAt);
        rodape.appendChild(criar('span', 'acoes__nota',
            soLa.length ? '' : 'todas as branches do servidor já estão neste computador'));
        bloco.appendChild(rodape);
    }

    /* Recarrega o repositório e volta para a aba em que a pessoa estava —
       abrir na aba padrão a jogaria para "O que mudou" a cada clique. */
    function abrirRepoNaAba(d, aba) {
        return api('/api/repo?p=' + encodeURIComponent(d.caminho))
            .then(function (nd) { estado.repoAberto = nd; pintarRepo(nd, aba); });
    }

    /* ============================================ MERGE REQUESTS (consulta)

       SÓ LEITURA. Lista os pedidos, mostra por que cada um pode ou não ser
       juntado e o que ele muda. Aprovar e aceitar continuam no GitLab — ver
       o cabeçalho do gitlab.js. O botão "Abrir no GitLab" é o caminho para
       decidir.

       O token é pedido aqui e só aqui, com o escopo mínimo (read_api), e a
       tela nunca o recebe de volta: ela só sabe se está conectada. */
    function pintarMergeRequests(d, host) {
        host.innerHTML = '';
        var bloco = criar('div', 'bloco');
        bloco.appendChild(criar('p', 'bloco__titulo', 'Merge Requests'));
        host.appendChild(bloco);
        var corpo = criar('div');
        bloco.appendChild(corpo);
        corpo.appendChild(criar('p', 'ajuda ajuda--fraca', 'perguntando ao GitLab…'));

        api('/api/gitlab/estado?p=' + encodeURIComponent(d.caminho))
            .then(function (st) {
                corpo.innerHTML = '';
                if (!st.conectado) return pedirToken(d, st, corpo);
                cabecalhoConectado(d, st, corpo);
                listarMRs(d, st, corpo, 'opened');
            })
            .catch(function (e) {
                corpo.innerHTML = '';
                if (e.codigo === 'SEM_REMOTO' || e.codigo === 'SEM_GITLAB') {
                    corpo.appendChild(criar('p', 'ajuda', e.message));
                    return;
                }
                erroDetalhado(e, corpo);
            });
    }

    function pedirToken(d, st, host) {
        host.appendChild(criar('p', 'ajuda',
            'Para ver os Merge Requests de ' + st.projeto + ', o app precisa de um token de acesso do ' +
            'GitLab. A senha que o git usa para enviar não serve: ela não abre a consulta.'));

        var passos = criar('ol', 'ajuda');
        var li1 = criar('li');
        var link = criar('a', null, 'Crie um token aqui');
        link.href = st.criarToken; link.target = '_blank'; link.rel = 'noopener noreferrer';
        li1.appendChild(link);
        li1.appendChild(document.createTextNode(
            ' — o nome "gito" e o escopo read_api já vêm marcados. Deixe só o read_api: ' +
            'com ele o app consegue ler, e nada além disso.'));
        passos.appendChild(li1);
        passos.appendChild(criar('li', null, 'Escolha uma data de validade e crie.'));
        passos.appendChild(criar('li', null, 'Copie o token e cole abaixo.'));
        host.appendChild(passos);

        var linha = criar('div', 'linha-acoes');
        var campo = document.createElement('input');
        /* password: o token não fica visível na tela nem em print. */
        campo.type = 'password';
        campo.placeholder = 'glpat-…';
        campo.autocomplete = 'off';
        campo.spellcheck = false;
        linha.appendChild(campo);
        var bt = criar('button', 'btn btn--principal', 'Conectar');
        bt.onclick = function () {
            var tk = campo.value.trim();
            if (!tk) return recado('Cole o token.', true);
            bt.disabled = true; bt.textContent = 'conferindo…';
            api('/api/gitlab/conectar', { metodo: 'POST', corpo: { p: d.caminho, token: tk } })
                .then(function (st2) {
                    campo.value = '';
                    recado('Conectado ao GitLab como ' + st2.usuario + '.');
                    host.innerHTML = '';
                    cabecalhoConectado(d, st2, host);
                    listarMRs(d, st2, host, 'opened');
                })
                .catch(function (e) {
                    bt.disabled = false; bt.textContent = 'Conectar';
                    recado(e.message, true);
                });
        };
        campo.onkeydown = function (ev) { if (ev.key === 'Enter') bt.click(); };
        linha.appendChild(bt);
        host.appendChild(linha);

        host.appendChild(criar('p', 'ajuda ajuda--fraca',
            'O token fica só na memória do app: fechou o Gito, ele é esquecido. ' +
            'Não é gravado em disco nem aparece de volta nesta tela.'));
    }

    function cabecalhoConectado(d, st, host) {
        var cab = criar('div', 'linha-acoes');
        cab.appendChild(criar('span', 'acoes__nota',
            'conectado ao GitLab como ' + st.usuario + ' · ' + st.projeto));
        var bSair = criar('button', 'btn btn--mini', 'Desconectar');
        bSair.title = 'Esquece o token agora';
        bSair.onclick = function () {
            api('/api/gitlab/sair', { metodo: 'POST', corpo: { p: d.caminho } })
                .then(function () { recado('Token esquecido.'); abrirRepoNaAba(d, 'mrs'); })
                .catch(function (e) { recado(e.message, true); });
        };
        cab.appendChild(bSair);
        host.appendChild(cab);
    }

    function listarMRs(d, st, host, situacao) {
        var filtro = criar('div', 'subnav');
        var lista = criar('div');
        [['opened', 'Abertos'], ['merged', 'Juntados'], ['closed', 'Fechados']].forEach(function (par) {
            var b = criar('button', 'subnav__item' + (situacao === par[0] ? ' subnav__item--ativo' : ''), par[1]);
            b.onclick = function () {
                filtro.remove(); lista.remove();
                listarMRs(d, st, host, par[0]);
            };
            filtro.appendChild(b);
        });
        host.appendChild(filtro);
        host.appendChild(lista);
        lista.appendChild(criar('p', 'ajuda ajuda--fraca', 'lendo…'));

        /* As branches locais vêm junto: é com elas que o detalhe sabe se a
           branch do pedido já está aqui ou se oferece "Baixar". */
        Promise.all([
            api('/api/gitlab/mrs?p=' + encodeURIComponent(d.caminho) + '&situacao=' + situacao),
            api('/api/branches?p=' + encodeURIComponent(d.caminho)).catch(function () { return []; })
        ]).then(function (rs) {
            var mrs = rs[0], locais = {};
            rs[1].forEach(function (b) { locais[b.nome] = b; });
            lista.innerHTML = '';
            if (!mrs.length) {
                lista.appendChild(criar('div', 'vazio',
                    situacao === 'opened' ? 'Nenhum Merge Request aberto neste projeto.'
                                          : 'Nenhum Merge Request aqui.'));
                return;
            }
            mrs.forEach(function (mr) { lista.appendChild(linhaMR(d, mr, locais)); });
        }).catch(function (e) {
            lista.innerHTML = '';
            /* Token revogado no meio do caminho: volta para o pedido de token. */
            if (e.codigo === 'GITLAB_TOKEN' || e.codigo === 'GITLAB_SEM_TOKEN') {
                recado(e.message, true);
                return abrirRepoNaAba(d, 'mrs');
            }
            erroDetalhado(e, lista);
        });
    }

    function tagEstado(estado) {
        return criar('span', 'commit__tag mr-tom--' + (estado.tom || 'neutro'), estado.texto);
    }

    function linkGitLab(url, texto) {
        var a = criar('a', 'btn btn--mini', texto || 'Abrir no GitLab');
        a.href = url; a.target = '_blank';
        /* noopener: a página do GitLab não ganha acesso a esta aba, que
           carrega o token do app. */
        a.rel = 'noopener noreferrer';
        return a;
    }

    function linhaMR(d, mr, locais) {
        var cx = criar('div');
        var linha = criar('div', 'commit');
        linha.appendChild(criar('span', 'commit__sha', '!' + mr.iid));

        var meio = criar('span', 'commit__meio');
        meio.appendChild(criar('span', 'commit__assunto', mr.titulo));
        meio.appendChild(criar('span', 'commit__autor',
            mr.origem + '  →  ' + mr.destino + '  ·  ' + mr.autor + '  ·  ' + quando(mr.atualizadoEm) +
            (mr.comentarios ? '  ·  ' + mr.comentarios + ' comentário(s)' : '')));
        linha.appendChild(meio);

        if (mr.rascunho) linha.appendChild(criar('span', 'commit__tag', 'rascunho'));
        linha.appendChild(tagEstado(mr.estado));

        var bVer = criar('button', 'btn btn--mini', 'Detalhes');
        bVer.onclick = function () { detalheMR(d, mr, locais, cx, bVer); };
        linha.appendChild(bVer);
        linha.appendChild(linkGitLab(mr.url));
        cx.appendChild(linha);
        return cx;
    }

    function quando(iso) {
        if (!iso) return '';
        var dt = new Date(iso);
        return isNaN(dt) ? '' : dt.toLocaleDateString('pt-BR') + ' ' +
               dt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    }

    function detalheMR(d, mr, locais, cx, bVer) {
        var ja = cx.querySelector('.visor');
        if (ja) { ja.remove(); bVer.textContent = 'Detalhes'; return; }

        var visor = criar('div', 'visor');
        visor.appendChild(criar('p', 'ajuda ajuda--fraca', 'lendo…'));
        cx.appendChild(visor);
        bVer.textContent = 'Fechar';

        api('/api/gitlab/mr?p=' + encodeURIComponent(d.caminho) + '&iid=' + encodeURIComponent(mr.iid))
            .then(function (x) {
                visor.innerHTML = '';

                /* ---- por que pode, ou não pode, ser juntado ---- */
                var fatos = [];
                fatos.push('situação: ' + x.estado.texto);
                if (x.pipeline) fatos.push('pipeline: ' + x.pipeline.texto);
                if (x.aprovacoes) {
                    fatos.push(x.aprovacoes.aprovadoPor.length
                        ? 'aprovado por ' + x.aprovacoes.aprovadoPor.join(', ')
                        : 'sem aprovação ainda');
                    if (x.aprovacoes.faltam) fatos.push('faltam ' + x.aprovacoes.faltam + ' aprovação(ões)');
                }
                if (x.atrasadoEm) {
                    fatos.push('"' + x.origem + '" está ' + x.atrasadoEm + ' salvamento(s) atrás de "' +
                               x.destino + '"');
                }
                visor.appendChild(criar('p', 'ajuda', fatos.join('  ·  ')));

                if (x.estado.codigo === 'conflict') {
                    visor.appendChild(criar('div', 'aviso',
                        'Este pedido tem conflito. Para resolver: baixe/vá para a branch "' + x.origem +
                        '", use "Trazer outra branch" com "' + x.destino + '" (do servidor), decida os ' +
                        'arquivos, conclua e envie. O pedido se atualiza sozinho.'));
                }

                if (x.descricao) {
                    var desc = criar('pre', 'mr-descricao');
                    desc.textContent = x.descricao;          /* texto cru: nada do GitLab vira HTML aqui */
                    visor.appendChild(desc);
                }

                /* ---- a branch do pedido neste computador ---- */
                visor.appendChild(blocoBranchDoMR(d, x, locais));

                /* ---- commits ---- */
                if (x.commits && x.commits.length) {
                    visor.appendChild(criar('p', 'bloco__titulo', x.commits.length + ' salvamento(s)'));
                    x.commits.forEach(function (c) {
                        var l = criar('div', 'commit');
                        l.appendChild(criar('span', 'commit__sha', c.curto));
                        var m = criar('span', 'commit__meio');
                        m.appendChild(criar('span', 'commit__assunto', c.titulo));
                        m.appendChild(criar('span', 'commit__autor', c.autor + '  ·  ' + quando(c.data)));
                        l.appendChild(m);
                        visor.appendChild(l);
                    });
                }

                /* ---- arquivos, cada um com o seu diff ---- */
                visor.appendChild(criar('p', 'bloco__titulo', x.arquivos.length + ' arquivo(s) alterado(s)'));
                x.arquivos.forEach(function (f) {
                    var l = criar('div', 'arquivo');
                    var rot = f.novo ? 'novo' : f.apagado ? 'apagado' : f.renomeado ? 'renomeado' : 'alterado';
                    l.appendChild(criar('span', 'arquivo__tag arquivo__tag--' + rot, rot));
                    var nome = criar('button', 'arquivo__nome arquivo__nome--link',
                                     f.antigo ? f.antigo + ' → ' + f.caminho : f.caminho);
                    nome.onclick = function () {
                        var aberto = l.nextSibling;
                        if (aberto && aberto.classList && aberto.classList.contains('visor__diff')) {
                            aberto.remove(); return;
                        }
                        var conteudo = f.grande
                            ? criar('p', 'ajuda visor__diff', 'Arquivo grande demais para o GitLab mostrar a diferença aqui — veja no GitLab.')
                            : (f.diff ? pintarDiff(f.diff, f.caminho)
                                      : criar('p', 'ajuda visor__diff', 'Sem diferença de texto (binário ou só renomeado).'));
                        l.parentNode.insertBefore(conteudo, l.nextSibling);
                    };
                    l.appendChild(nome);
                    visor.appendChild(l);
                });
            })
            .catch(function (e) { erroDetalhado(e, visor); });
    }

    /* BAIXAR A BRANCH DO PEDIDO — para testar ou revisar na própria máquina.

       Só quando ela mora neste mesmo projeto: a de um fork está em outro
       servidor, e este remoto não tem como buscá-la. */
    function blocoBranchDoMR(d, x, locais) {
        var cx = criar('div', 'linha-acoes');
        if (!x.mesmoProjeto) {
            cx.appendChild(criar('span', 'acoes__nota',
                'a branch deste pedido vem de um fork — só dá para vê-la pelo GitLab'));
            return cx;
        }
        var local = locais[x.origem];
        if (local) {
            cx.appendChild(criar('span', 'acoes__nota',
                local.atual ? 'você está na branch "' + x.origem + '" deste pedido'
                            : 'a branch "' + x.origem + '" já está neste computador — use "Ir para esta" em Branches'));
            return cx;
        }
        var bB = criar('button', 'btn btn--mini', 'Baixar a branch "' + x.origem + '"');
        bB.title = 'Cria a branch aqui, igual à do servidor. Não troca de branch e não mexe nos seus arquivos.';
        bB.onclick = function () {
            bB.disabled = true; bB.textContent = 'baixando…';
            api('/api/baixar-branch', { metodo: 'POST', corpo: { p: d.caminho, nome: x.origem } })
                .then(function () {
                    locais[x.origem] = { nome: x.origem, atual: false };
                    cx.innerHTML = '';
                    cx.appendChild(criar('span', 'acoes__nota',
                        'baixada. Para trabalhar nela, use "Ir para esta" em Branches.'));
                    recado('Branch "' + x.origem + '" baixada.');
                })
                .catch(function (e) {
                    bB.disabled = false; bB.textContent = 'Baixar a branch "' + x.origem + '"';
                    recado(e.message, true);
                });
        };
        cx.appendChild(bB);
        return cx;
    }

    function criarSelect(opcoes, padrao) {
        var sel = document.createElement('select');
        opcoes.forEach(function (o) {
            var op = document.createElement('option');
            op.value = o.valor; op.textContent = o.texto;       /* textContent escapa sozinho */
            if (o.valor === padrao) op.selected = true;
            sel.appendChild(op);
        });
        return sel;
    }

    function publicarBranch(d, nome, btn) {
        var antes = btn.textContent;
        btn.disabled = true; btn.textContent = 'publicando…';
        api('/api/publicar-branch', { metodo: 'POST', corpo: { p: d.caminho, branch: nome } })
            .then(function () {
                recado('Branch "' + nome + '" publicada. Agora ela existe no servidor.');
                return carregarRepos().then(function () {
                    abrirRepo({ caminho: d.caminho, nome: d.nome, versionado: true });
                });
            })
            .catch(function (e) {
                btn.disabled = false; btn.textContent = antes;
                if (estado.caixaErro) erroDetalhado(e, estado.caixaErro);
                recado(e.message, true);
            });
    }

    function trazerBranch(d, origem, nomeVisivel, btn) {
        if (!origem) return recado('Escolha a branch que vai ser trazida.', true);
        if (!confirm('Trazer "' + nomeVisivel + '" para a branch "' + d.branch + '"?\n\n' +
                     'Só "' + d.branch + '" muda. Se as duas mexeram nas mesmas linhas, o app ' +
                     'pergunta qual vale — e dá para desfazer.')) return;

        btn.disabled = true; btn.textContent = 'trazendo…';
        api('/api/trazer-branch', { metodo: 'POST', corpo: { p: d.caminho, origem: origem } })
            .then(function (r) {
                if (r.jaEstava) recado('"' + d.branch + '" já tinha tudo de "' + nomeVisivel + '".');
                else if (r.juntou) recado('Trazido. Agora dá para enviar.');
                else recado(r.conflitos.length + ' arquivo(s) precisam da sua decisão.', true);
                return carregarRepos().then(function () {
                    /* Com conflito, a aba que resolve é a de mudanças. */
                    abrirRepo({ caminho: d.caminho, nome: d.nome, versionado: true });
                });
            })
            .catch(function (e) {
                btn.disabled = false; btn.textContent = 'Trazer para cá';
                if (estado.caixaErro) erroDetalhado(e, estado.caixaErro);
                recado(e.message, true);
            });
    }

    function abrirMergeRequest(d, destino, btn) {
        if (!destino) return recado('Escolha a branch de destino.', true);
        btn.disabled = true;
        api('/api/link-mr?p=' + encodeURIComponent(d.caminho) +
            '&origem=' + encodeURIComponent(d.branch) + '&destino=' + encodeURIComponent(destino))
            .then(function (r) {
                btn.disabled = false;
                /* noopener: a página do GitLab não ganha acesso a esta aba —
                   que carrega o token do app. */
                window.open(r.url, '_blank', 'noopener');
                recado('Merge Request aberto no GitLab: ' + r.origem + ' → ' + r.destino);
            })
            .catch(function (e) { btn.disabled = false; recado(e.message, true); });
    }

    /* ==================================================== ENVIAR / TRAZER */
    function enviar(d, btn) {
        var antes = btn.textContent;
        btn.disabled = true; btn.textContent = 'enviando…';
        api('/api/enviar', { metodo: 'POST', corpo: { p: d.caminho } })
            .then(function () {
                recado('Enviado. Seu trabalho já está no servidor.');
                return carregarRepos().then(function () {
                    abrirRepo({ caminho: d.caminho, nome: d.nome, versionado: true });
                });
            })
            .catch(function (e) {
                btn.disabled = false; btn.textContent = antes;
                if (estado.caixaErro) erroDetalhado(e, estado.caixaErro);
                if (e.codigo === 'SEM_UPSTREAM' && d.branch) {
                    if (confirm('A branch "' + d.branch + '" ainda não existe no servidor. Criar lá?')) {
                        return api('/api/enviar', { metodo: 'POST', corpo: {
                            p: d.caminho, criarUpstream: true, branch: d.branch } })
                            .then(function () { recado('Branch criada e enviada.'); return carregarRepos(); })
                            .catch(function (e2) { recado(e2.message, true); });
                    }
                    return;
                }
                recado(e.message, true);
            });
    }

    function trazer(d, btn) {
        var antes = btn.textContent;
        btn.disabled = true; btn.textContent = 'trazendo…';
        api('/api/trazer', { metodo: 'POST', corpo: { p: d.caminho } })
            .then(function (saida) {
                recado(/up to date|atualizado/i.test(saida || '')
                    ? 'Você já estava em dia.' : 'Trazido do servidor.');
                return carregarRepos().then(function () {
                    abrirRepo({ caminho: d.caminho, nome: d.nome, versionado: true });
                });
            })
            .catch(function (e) {
                btn.disabled = false; btn.textContent = antes;
                if (estado.caixaErro) erroDetalhado(e, estado.caixaErro);

                /* DIVERGIU NÃO É BECO SEM SAÍDA.

                   Antes, o app dizia "isso precisa de alguém da equipe" e
                   parava ali. Mas juntar as duas histórias é justamente o que
                   o git faz bem, e o que pode dar errado — o conflito — tem
                   solução na tela agora. Então a saída é oferecida aqui, com
                   a pessoa confirmando: nenhuma junção acontece sozinha. */
                if (e.codigo === 'DIVERGIU') {
                    var cx = estado.caixaErro;
                    if (cx) {
                        var b = criar('button', 'btn btn--principal', 'Juntar os dois');
                        b.title = 'Traz o do servidor e junta com o seu. Nada é apagado.';
                        b.onclick = function () { juntar(d, b); };
                        cx.appendChild(b);
                        cx.appendChild(criar('p', 'ajuda',
                            'Os dois lados continuam aqui. Se alguma linha tiver sido mexida ' +
                            'pelos dois, o app vai perguntar qual vale — e dá para desfazer.'));
                    }
                    return;
                }

                recado(e.message, true);
            });
    }

    function juntar(d, btn) {
        btn.disabled = true; btn.textContent = 'juntando…';
        api('/api/juntar', { metodo: 'POST', corpo: { p: d.caminho } })
            .then(function (r) {
                if (r.juntou) recado('Juntado. Agora dá para enviar.');
                else recado(r.conflitos.length + ' arquivo(s) precisam da sua decisão.', true);
                return carregarRepos().then(function () {
                    abrirRepo({ caminho: d.caminho, nome: d.nome, versionado: true });
                });
            })
            .catch(function (e) {
                btn.disabled = false; btn.textContent = 'Juntar os dois';
                recado(e.message, true);
            });
    }

    /* O DIFF, pintado linha a linha. Sem biblioteca: o formato do git já é
       linha-a-linha, e o que importa é a primeira letra de cada uma.

       Um pintor só para o diff do git, com realce e número de linha.
       Os dois recebem saída do MESMO `git diff`, então duplicar isso seria
       manter dois jeitos de errar a mesma coisa. */
    function pintarDiff(texto, caminhoParaRealce) {
        var pre = criar('pre', 'visor__diff');
        var R = global_realce();
        var html = '';

        String(texto).split('\n').forEach(function (l) {
            var cls = 'd', corpo = l, sinal = '';

            if (l.charAt(0) === '+' && l.slice(0, 3) !== '+++') {
                cls = 'd d--mais'; sinal = '+'; corpo = l.slice(1);
            } else if (l.charAt(0) === '-' && l.slice(0, 3) !== '---') {
                cls = 'd d--menos'; sinal = '-'; corpo = l.slice(1);
            } else if (l.charAt(0) === '@') {
                cls = 'd d--trecho';
            } else if (/^(diff |index |--- |\+\+\+ |new file|deleted file|similarity)/.test(l)) {
                cls = 'd d--cab';
            } else if (l.charAt(0) === ' ') {
                sinal = ' '; corpo = l.slice(1);
            }

            /* Linha de contexto e linha alterada levam realce de sintaxe;
               cabeçalho e marcador de trecho não, porque não são código — são
               o envelope do diff. */
            var interno = (cls === 'd d--cab' || cls === 'd d--trecho')
                ? (R.escapar ? R.escapar(corpo) : corpo)
                : R.realcar(corpo, caminhoParaRealce);

            html += '<span class="' + cls + '">' +
                    '<span class="d__sinal">' + (sinal || ' ') + '</span>' +
                    interno + '\n</span>';
        });

        pre.innerHTML = html;
        return pre;
    }

    function verDiff(d, arquivo, ancora) {
        var ja = ancora.nextSibling;
        if (ja && ja.classList && ja.classList.contains('visor')) { ja.remove(); return; }

        var visor = criar('div', 'visor');
        visor.appendChild(criar('p', 'ajuda ajuda--fraca', 'lendo…'));
        ancora.parentNode.insertBefore(visor, ancora.nextSibling);

        api('/api/diff?p=' + encodeURIComponent(d.caminho) +
            '&a=' + encodeURIComponent(arquivo.caminho))
            .then(function (texto) {
                visor.innerHTML = '';
                if (!texto || !texto.trim()) {
                    visor.appendChild(criar('p', 'ajuda', 'Sem diferenças de texto para mostrar.'));
                    return;
                }
                visor.appendChild(pintarDiff(texto, arquivo.caminho));
            })
            .catch(function (e) { erroDetalhado(e, visor); });
    }

    /* ==================================================== MUDANÇAS */
    /* ===================================================== CONFLITO

       O QUE UMA PESSOA PRECISA SABER AQUI

       "Conflito" não é defeito nem castigo: é o git dizendo que duas pessoas
       mexeram na MESMA linha e que ele não vai escolher por conta própria.
       Essa frase é metade da solução — sem ela, quem vê a palavra "conflito"
       supõe que quebrou alguma coisa e para.

       A outra metade é ter o que fazer. Por arquivo, dois desfechos que dá
       para decidir olhando o diff: ficar com o que estava aqui, ou com o que
       veio do servidor. Misturar pedaço dos dois é edição de texto, e isso se
       faz no editor — não num botão que decide sozinho.
       ================================================================== */
    function painelDeConflito(d) {
        var cx = criar('div', 'aviso');

        if (!d.conflitos.length) {
            /* Tudo decidido: falta só fechar. É o estado em que o botão
               sumia — agora ele é a primeira coisa que se vê. */
            cx.appendChild(criar('p', null, 'Junção em andamento: tudo decidido, falta concluir.'));
            cx.appendChild(criar('p', 'ajuda',
                'Todos os conflitos já foram resolvidos. Clique em "Concluir a junção" para ' +
                'fechar com um salvamento — depois é só enviar.'));
        } else {
            cx.appendChild(criar('p', null,
                d.conflitos.length === 1
                    ? '1 arquivo precisa da sua decisão'
                    : d.conflitos.length + ' arquivos precisam da sua decisão'));

            cx.appendChild(criar('p', 'ajuda',
                'Você e outra pessoa mexeram nas mesmas linhas. O git não escolhe sozinho ' +
                'qual versão vale — e é só isso que "conflito" quer dizer. Nada se perdeu: ' +
                'os dois lados estão aqui, e você decide arquivo por arquivo.'));
        }

        d.conflitos.forEach(function (c) {
            var linha = criar('div', 'arquivo');
            linha.appendChild(criar('span', 'arquivo__tag arquivo__tag--conflito', 'decidir'));

            var nome = criar('button', 'arquivo__nome arquivo__nome--link', c.caminho);
            nome.title = 'Ver os dois lados';
            nome.onclick = function () { verDiff(d, c, linha); };
            linha.appendChild(nome);

            var bMeu = criar('button', 'btn btn--mini', 'Ficar com o meu');
            bMeu.title = 'Mantém o que estava neste computador';
            bMeu.onclick = function () { resolver(d, c.caminho, 'meu', bMeu); };
            linha.appendChild(bMeu);

            /* "O que chegou", e não "o do servidor": a mesma tela resolve o
               conflito de trazer outra branch, e aí o outro lado é ela. */
            var bDeles = criar('button', 'btn btn--mini', 'Ficar com o que chegou');
            bDeles.title = 'Mantém a versão que veio na junção — do servidor ou da outra branch';
            bDeles.onclick = function () { resolver(d, c.caminho, 'deles', bDeles); };
            linha.appendChild(bDeles);

            cx.appendChild(linha);
        });

        var acoes = criar('div', 'linha-acoes');

        var bFim = criar('button', 'btn btn--principal', 'Concluir a junção');
        bFim.disabled = d.conflitos.length > 0;
        bFim.title = d.conflitos.length
            ? 'Decida os arquivos acima primeiro'
            : 'Fecha a junção com um salvamento';
        bFim.onclick = function () { concluirJuncao(d, bFim); };
        acoes.appendChild(bFim);

        /* A saída de quem olhou e concluiu que aquilo precisa de outra pessoa.
           Sem ela, abrir um conflito seria uma porta sem volta. */
        var bSai = criar('button', 'btn', 'Desfazer a junção');
        bSai.title = 'Volta tudo como estava antes de trazer. Nada do seu trabalho se perde.';
        bSai.onclick = function () { abortarJuncao(d, bSai); };
        acoes.appendChild(bSai);

        cx.appendChild(acoes);
        return cx;
    }

    function resolver(d, arquivo, lado, btn) {
        btn.disabled = true;
        api('/api/resolver', { metodo: 'POST', corpo: { p: d.caminho, arquivo: arquivo, lado: lado } })
            .then(function () {
                recado(lado === 'meu'
                    ? 'Ficou com a sua versão de ' + arquivo
                    : 'Ficou com a versão que chegou de ' + arquivo);
                return abrirRepo({ caminho: d.caminho, nome: d.nome, versionado: true });
            })
            .catch(function (e) { btn.disabled = false; recado(e.message, true); });
    }

    function concluirJuncao(d, btn) {
        btn.disabled = true; btn.textContent = 'concluindo…';
        api('/api/concluir-juncao', { metodo: 'POST', corpo: { p: d.caminho } })
            .then(function () {
                recado('Junção concluída. Agora dá para enviar.');
                return carregarRepos().then(function () {
                    abrirRepo({ caminho: d.caminho, nome: d.nome, versionado: true });
                });
            })
            .catch(function (e) {
                btn.disabled = false; btn.textContent = 'Concluir a junção';
                recado(e.message, true);
            });
    }

    function abortarJuncao(d, btn) {
        if (!confirm('Voltar tudo como estava antes de trazer?\n\n' +
                     'O seu trabalho salvo continua aqui — só a junção é desfeita.')) return;
        btn.disabled = true;
        api('/api/abortar-juncao', { metodo: 'POST', corpo: { p: d.caminho } })
            .then(function () {
                recado('Junção desfeita. Está como antes de trazer.');
                return carregarRepos().then(function () {
                    abrirRepo({ caminho: d.caminho, nome: d.nome, versionado: true });
                });
            })
            .catch(function (e) { btn.disabled = false; recado(e.message, true); });
    }

    function pintarMudancas(d, host) {
        var pendentes = d.conflitos.concat(d.alterados).concat(d.novos);

        if (!pendentes.length) {
            /* Com a junção aberta, "tudo salvo" seria mentira: falta o
               salvamento que a fecha (o painel logo acima). */
            if (d.juntando) return;
            var v = criar('div', 'vazio', 'Tudo salvo. Não há nada aqui esperando por você.');
            host.appendChild(v);
            return;
        }
        /* O painel de conflito é pintado por pintarRepo, acima das abas. */

        /* A PASTA QUE É UM REPOSITÓRIO PRÓPRIO.

           Ela aparece como "alterada" e não há nada para salvar aqui fora: o
           que mudou está lá dentro. Sem esta explicação, a pessoa marca,
           clica em Salvar, não acontece nada, e tenta de novo — foi o beco
           em que o app prendeu quem tentou enviar. */
        var proprios = d.alterados.filter(function (a) {
            return a.submodulo && !a.submodulo.commitNovo;
        });
        if (proprios.length) {
            var ex = criar('div', 'aviso');
            ex.appendChild(criar('p', null,
                proprios.length === 1
                    ? 'A pasta "' + proprios[0].caminho + '" é um repositório próprio.'
                    : 'Há ' + proprios.length + ' pastas que são repositórios próprios.'));
            ex.appendChild(criar('p', 'ajuda',
                'O que mudou está DENTRO dela — aqui de fora existe só um marcador, ' +
                'e ele não mudou. Abra essa pasta em "Meus repositórios" e salve por lá. ' +
                'Salvar aqui não tem efeito nenhum, e é por isso que ela não vem marcada.'));
            host.appendChild(ex);
        }

        /* Duas colunas quando a janela deixa: a mensagem fica ao lado da lista,
           para a pessoa escrever olhando para o que mudou. */
        var grade = criar('div', 'repo-grade');
        host.appendChild(grade);

        var bloco = criar('div', 'bloco');
        bloco.appendChild(criar('p', 'bloco__titulo',
            'O que mudou (' + pendentes.length + ')'));

        pendentes.forEach(function (a, i) {
            var linha = criar('div', 'arquivo');

            /* Repositório próprio sem commit novo não vem marcado: marcá-lo
               só produziria um "Salvar" que não salva nada. */
            var soMarcador = !!(a.submodulo && !a.submodulo.commitNovo);

            var cb = document.createElement('input');
            cb.type = 'checkbox';
            cb.checked = !soMarcador;           /* marcado por padrão: salvar tudo é a regra */
            cb.disabled = soMarcador;
            cb.id = 'arq' + i;
            cb.value = a.caminho;
            if (soMarcador) cb.title = 'Esta pasta tem repositório próprio — salve lá dentro';
            linha.appendChild(cb);

            var tagClasse = 'arquivo__tag';
            if (a.estado === 'novo') tagClasse += ' arquivo__tag--novo';
            if (a.estado === 'apagado') tagClasse += ' arquivo__tag--apagado';
            if (a.estado === 'em conflito') tagClasse += ' arquivo__tag--conflito';
            linha.appendChild(criar('span', tagClasse, a.estado));

            /* O nome é botão, não label: clicar mostra o QUE mudou.
               Quem não sabe o que mudou escreve mensagem ruim — e "ajustes"
               é o que sai quando a pessoa não consegue lembrar. */
            var nome = criar('button', 'arquivo__nome arquivo__nome--link', a.caminho);
            nome.title = 'Ver o que mudou neste arquivo';
            nome.onclick = function () { verDiff(d, a, linha); };
            linha.appendChild(nome);

            bloco.appendChild(linha);
        });
        grade.appendChild(bloco);

        var form = criar('div', 'bloco repo-grade__acao');
        var campo = criar('div', 'campo');
        var lab = criar('label', null, 'O que você fez?');
        lab.setAttribute('for', 'msg');
        campo.appendChild(lab);
        var msg = document.createElement('input');
        msg.type = 'text';
        msg.id = 'msg';
        msg.placeholder = 'ex.: aba Como rodar no painel';
        campo.appendChild(msg);
        form.appendChild(campo);

        var btn = criar('button', 'btn btn--principal', 'Salvar meu trabalho');
        btn.onclick = function () { salvar(d, msg, btn); };
        form.appendChild(btn);
        grade.appendChild(form);

        msg.addEventListener('keydown', function (e) { if (e.key === 'Enter') btn.click(); });
        msg.focus();
    }

    function salvar(d, campoMsg, btn) {
        var escolhidos = $$('[data-repo-corpo] input[type=checkbox]')
            .filter(function (c) { return c.checked; })
            .map(function (c) { return c.value; });

        if (!escolhidos.length) return recado('Escolha ao menos um arquivo.', true);
        if (!campoMsg.value.trim()) { campoMsg.focus(); return recado('Escreva o que você fez.', true); }

        btn.disabled = true;
        btn.textContent = 'Salvando…';

        api('/api/salvar', { metodo: 'POST', corpo: {
            p: d.caminho, mensagem: campoMsg.value, arquivos: escolhidos
        }}).then(function (commit) {
            recado('Salvo: ' + (commit ? commit.assunto : campoMsg.value));
            return carregarRepos().then(function () { abrirRepo({ caminho: d.caminho, nome: d.nome, versionado: true }); });
        }).catch(function (e) {
            btn.disabled = false;
            btn.textContent = 'Salvar meu trabalho';
            if (e.codigo === 'SEM_IDENTIDADE') return mostrarTela('identidade');
            recado(e.message, true);
        });
    }

    /* ============================================================ PASTAS */
    function carregarPastas() {
        return api('/api/config').then(function (c) {
            estado.pastas = c.pastas || [];
            $('[data-pastas]').value = estado.pastas.join('\n');
        });
    }

    function salvarPastas() {
        var linhas = $('[data-pastas]').value.split('\n')
            .map(function (s) { return s.trim(); })
            .filter(Boolean);

        var aviso = $('[data-aviso-pastas]');
        aviso.hidden = true;

        api('/api/config', { metodo: 'POST', corpo: { pastas: linhas } })
            .then(function () {
                recado('Pastas salvas.');
                mostrarTela('repos');
                return carregarRepos();
            })
            .catch(function (e) { aviso.textContent = e.message; aviso.hidden = false; });
    }

    /* ========================================== PROCURAR PASTA NO DISCO */
    var procura = { atual: null, pai: null };

    function abrirProcurar() {
        $('[data-procurar]').hidden = false;
        irPara(null);
    }

    function irPara(caminho) {
        var lista = $('[data-procurar-lista]');
        lista.innerHTML = '';
        lista.appendChild(criar('p', 'ajuda ajuda--fraca', 'lendo…'));

        api('/api/navegar' + (caminho ? '?p=' + encodeURIComponent(caminho) : ''))
            .then(function (d) {
                procura.atual = d.atual;
                procura.pai = d.pai;

                $('[data-procurar-caminho]').textContent = d.atual || 'Escolha uma unidade';
                $('[data-acao="subir"]').disabled = !d.atual;
                /* Só dá para "usar" uma pasta de verdade — a lista de unidades
                   não é uma pasta, é o ponto de partida. */
                $('[data-acao="usar-pasta"]').disabled = !d.atual;

                lista.innerHTML = '';
                if (!d.pastas.length) {
                    lista.appendChild(criar('p', 'ajuda', 'Nenhuma subpasta aqui.'));
                    return;
                }
                d.pastas.forEach(function (p) {
                    var b = criar('button', 'procurar__item');
                    b.appendChild(criar('span', 'procurar__ic', '▸'));
                    b.appendChild(criar('span', 'procurar__nome', p.nome));
                    /* Marcar o que já é repositório poupa a pessoa de entrar
                       numa pasta para descobrir que ela é o destino, e não o
                       caminho até ele. */
                    if (p.repo) b.appendChild(criar('span', 'procurar__tag', 'repositório'));
                    b.onclick = function () { irPara(p.caminho); };
                    lista.appendChild(b);
                });
            })
            .catch(function (e) {
                lista.innerHTML = '';
                erroDetalhado(e, lista);
            });
    }

    function usarPasta() {
        if (!procura.atual) return;
        var ta = $('[data-pastas]');
        var linhas = ta.value.split('\n').map(function (s) { return s.trim(); }).filter(Boolean);

        if (linhas.indexOf(procura.atual) >= 0) {
            recado('Essa pasta já está na lista.');
        } else {
            linhas.push(procura.atual);
            ta.value = linhas.join('\n');
            recado('Pasta adicionada. Clique em Salvar para valer.');
        }
        $('[data-procurar]').hidden = true;
    }

    /* ======================================================== QUEM SOU EU
       No topo, a pessoa vê as iniciais e o primeiro nome; o e-mail completo,
       que é o que assina os commits, fica no title - a um passar de mouse. */
    function pintarEu(id) {
        var host = $('[data-eu]');
        host.innerHTML = '';
        var nome = String(id.nome || '').trim();
        var partes = nome.split(/\s+/).filter(Boolean);
        var iniciais = partes.length
            ? (partes[0].charAt(0) + (partes.length > 1 ? partes[partes.length - 1].charAt(0) : '')).toUpperCase()
            : '?';
        host.appendChild(criar('span', 'eu__avatar', iniciais));
        host.appendChild(criar('span', 'eu__nome', 'Olá, ' + (partes[0] || 'você')));
        host.title = 'Seus commits saem assinados como ' + nome + ' <' + id.email + '>';
    }

    /* ============================================================ O TEMA
       Claro ou escuro. Sem escolha, segue o sistema; a escolha fica neste
       navegador (é preferência de tela, não configuração do app). */
    var TEMAS = ['auto', 'claro', 'escuro'];
    function aplicarTema(tema) {
        var raiz = document.documentElement;
        if (tema === 'claro') raiz.setAttribute('data-theme', 'light');
        else if (tema === 'escuro') raiz.setAttribute('data-theme', 'dark');
        else raiz.removeAttribute('data-theme');
        var b = $('[data-acao="tema"]');
        if (b) {
            b.textContent = tema === 'claro' ? '☀' : tema === 'escuro' ? '☾' : '◐';
            b.title = 'Tema: ' + (tema === 'auto' ? 'igual ao do sistema' : tema) + ' — clique para trocar';
        }
    }
    function temaSalvo() {
        try { var v = localStorage.getItem('gito-tema'); return TEMAS.indexOf(v) >= 0 ? v : 'auto'; }
        catch (e) { return 'auto'; }
    }
    function alternarTema() {
        var prox = TEMAS[(TEMAS.indexOf(temaSalvo()) + 1) % TEMAS.length];
        try { localStorage.setItem('gito-tema', prox); } catch (e) { /* sem storage: vale só agora */ }
        aplicarTema(prox);
    }

    /* ======================================================== IDENTIDADE */
    function salvarIdentidade() {
        var nome = $('#id-nome').value.trim();
        var email = $('#id-email').value.trim();
        var aviso = $('[data-aviso-identidade]');
        aviso.hidden = true;

        api('/api/identidade', { metodo: 'POST', corpo: { nome: nome, email: email } })
            .then(function (id) {
                pintarEu(id);
                recado('Pronto. Seus commits vão assinados assim.');
                mostrarTela('repos');
                return carregarRepos();
            })
            .catch(function (e) { aviso.textContent = e.message; aviso.hidden = false; });
    }

    /* ============================================================ INÍCIO */
    function iniciar() {
        aplicarTema(temaSalvo());
        $$('[data-tela]').forEach(function (b) {
            b.onclick = function () {
                var t = b.getAttribute('data-tela');
                mostrarTela(t);
                if (t === 'repos') carregarRepos();
                if (t === 'pastas') carregarPastas();
            };
        });
        $('[data-acao="atualizar"]').onclick = carregarRepos;
        $('[data-acao="voltar"]').onclick = function () { mostrarTela('repos'); };
        $('[data-acao="salvar-pastas"]').onclick = salvarPastas;
        $('[data-acao="salvar-identidade"]').onclick = salvarIdentidade;
        $('[data-acao="procurar"]').onclick = abrirProcurar;
        $('[data-acao="subir"]').onclick = function () { irPara(procura.pai); };
        $('[data-acao="usar-pasta"]').onclick = usarPasta;
        $('[data-acao="tema"]').onclick = alternarTema;
        $('[data-acao="fechar-procurar"]').onclick = function () {
            $('[data-procurar]').hidden = true;
        };

        api('/api/estado').then(function (e) {
            $('[data-arquivo-config]').textContent = 'Guardado em ' + e.arquivoConfig;

            if (!e.identidade.completa) {
                $('#id-nome').value = e.identidade.nome || '';
                $('#id-email').value = e.identidade.email || '';
                mostrarTela('identidade');
                return;
            }
            pintarEu(e.identidade);

            if (!e.pastas.length) { mostrarTela('pastas'); return carregarPastas(); }
            return carregarRepos();
        }).catch(function (err) {
            recado('Não consegui falar com o app: ' + err.message +
                   ' — reabra pelo endereço que apareceu no console.', true);
        });
    }

    iniciar();
}());
