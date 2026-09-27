/* ============================================================================
   Gito - o painel das aplicacoes
   ============================================================================
   Tres perguntas, uma aba cada:

     Versoes         qual versao esta publicada (main) e qual esta em cada
                     branch - lidas do git, sem trocar de branch
     Ficha tecnica   o que e, onde roda, onde guarda dados, como acessar - e
                     se cada servico esta no ar agora
     Issues          o que falta melhorar ou corrigir, com prazo, responsavel,
                     situacao, comentarios e evidencias

   Tudo sai do gito.json de cada aplicacao (contrato em GITO.md) e da pasta
   .gito/ ao lado dele. Usa os utilitarios do app.js (window.gitoUI).
============================================================================ */
(function () {
    'use strict';

    var U = window.gitoUI;
    if (!U) return;
    var $ = U.$, criar = U.criar, api = U.api, recado = U.recado;

    var ROT_SITUACAO = { 'aberta': 'Aberta', 'em-andamento': 'Em andamento', 'em-revisao': 'Em revisão',
                         'concluida': 'Concluída', 'cancelada': 'Cancelada' };
    var ROT_TIPO = { bug: 'Bug', melhoria: 'Melhoria', tarefa: 'Tarefa' };
    var ROT_PRIORIDADE = { baixa: 'Baixa', media: 'Média', alta: 'Alta', critica: 'Crítica' };
    var ROT_HIST = { funcionalidade: 'funcionalidade', correcao: 'correção', melhoria: 'melhoria',
                     seguranca: 'segurança', infraestrutura: 'infraestrutura', quebra: 'quebra de compatibilidade' };

    var estado = { lista: null, app: null, aba: 'versoes', issues: null, filtro: { situacao: 'abertas', busca: '', tipo: '', resp: '' },
                   aberta: null, novaAberta: false, servicos: {}, historicoDe: 'publicada' };

    function hoje() { return new Date().toISOString().slice(0, 10); }
    function qs(o) { return Object.keys(o).map(function (k) { return k + '=' + encodeURIComponent(o[k] == null ? '' : o[k]); }).join('&'); }
    function dataBr(iso) {
        if (!iso) return '';
        var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
        return m ? m[3] + '/' + m[2] + '/' + m[1] : iso;
    }
    function quandoBr(iso) {
        if (!iso) return '';
        var d = new Date(iso);
        return isNaN(d) ? iso : d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    }
    function iniciais(nome) {
        var p = String(nome || '').replace(/<.*>/, '').trim().split(/\s+/).filter(Boolean);
        if (!p.length) return '?';
        return (p[0].charAt(0) + (p.length > 1 ? p[p.length - 1].charAt(0) : '')).toUpperCase();
    }
    function soNome(autor) { return String(autor || '').replace(/\s*<.*>$/, ''); }
    function link(url, texto) {
        var a = criar('a', 'painel-link', texto || url);
        a.href = url; a.target = '_blank'; a.rel = 'noopener noreferrer';
        return a;
    }
    function el(tag, classe, filhos) {
        var e = criar(tag, classe);
        (filhos || []).forEach(function (f) { if (f) e.appendChild(typeof f === 'string' ? document.createTextNode(f) : f); });
        return e;
    }
    function arquivoUrl(app, extra) {
        return '/api/painel/arquivo?' + qs(Object.assign({ p: app.repo, sub: app.sub }, extra)) +
               (U.token() ? '&t=' + encodeURIComponent(U.token()) : '');
    }
    function nomeDaApp(a) { return a.ficha && a.ficha.dados ? a.ficha.dados.aplicacao.nome : a.repoNome; }

    /* ======================================================== A LISTA */
    function abrir() {
        U.mostrarTela('painel');
        var host = $('[data-painel-lista]');
        host.innerHTML = '';
        host.appendChild(criar('p', 'ajuda', 'Lendo as aplicações e as versões de cada branch…'));
        return api('/api/painel').then(function (d) {
            estado.lista = d;
            pintarLista();
        }).catch(function (e) { host.innerHTML = ''; U.erroDetalhado(e, host); });
    }

    function pintarLista() {
        var d = estado.lista, host = $('[data-painel-lista]');
        host.innerHTML = '';
        var n = d.aplicacoes.length;
        var abertas = d.aplicacoes.reduce(function (s, a) { return s + (a.issues ? a.issues.abertas : 0); }, 0);
        var vencidas = d.aplicacoes.reduce(function (s, a) { return s + (a.issues ? a.issues.vencidas : 0); }, 0);
        $('[data-painel-resumo]').textContent = n
            ? n + ' aplicação(ões) com ficha · ' + abertas + ' issue(s) aberta(s)' + (vencidas ? ' · ' + vencidas + ' vencida(s)' : '') +
              (d.semFicha.length ? ' · ' + d.semFicha.length + ' repositório(s) sem ficha' : '')
            : 'Nenhuma aplicação com gito.json nas suas pastas ainda.';

        if (!n) host.appendChild(comoAdotar());
        var grade = criar('div', 'apps-painel');
        d.aplicacoes.forEach(function (a) { grade.appendChild(cartao(a)); });
        host.appendChild(grade);
        d.aplicacoes.forEach(verificarResumo);

        if (d.semFicha.length) {
            var b = criar('div', 'bloco sem-ficha');
            b.appendChild(criar('p', 'bloco__titulo', 'Repositórios sem ficha (' + d.semFicha.length + ')'));
            b.appendChild(criar('p', 'ajuda', 'Criar a ficha acrescenta gito.json e GITO.md na raiz e a linha @GITO.md no CLAUDE.md — nada existente é apagado. ' +
                                           'A partir daí, o Claude mantém a versão e a ficha a cada mudança.'));
            d.semFicha.forEach(function (r) {
                var linha = criar('div', 'sem-ficha__linha');
                linha.appendChild(el('span', 'sem-ficha__nome', [r.nome, criar('span', 'repo__caminho', r.caminho)]));
                var bt = criar('button', 'btn btn--mini', 'Criar ficha');
                bt.onclick = function () { criarFicha(r, bt); };
                linha.appendChild(bt);
                b.appendChild(linha);
            });
            host.appendChild(b);
        }
    }

    function comoAdotar() {
        var v = criar('div', 'vazio');
        v.appendChild(criar('p', null, 'Uma aplicação entra no painel quando o repositório dela tem um gito.json.'));
        v.appendChild(criar('p', 'ajuda', 'Use "Criar ficha" nos repositórios abaixo, ou copie gito.json, GITO.md e CLAUDE.md da pasta modelo/ do Gito para a raiz do repositório.'));
        return v;
    }

    function criarFicha(r, bt) {
        if (!window.confirm('Criar a ficha em "' + r.nome + '"?\n\nVão ser criados gito.json e GITO.md na raiz, e o CLAUDE.md ganha a linha @GITO.md. ' +
                            'Nenhum arquivo existente é apagado. Depois, salve e envie pela aba Meus repositórios.')) return;
        bt.disabled = true; bt.textContent = 'criando…';
        api('/api/painel/criar-ficha', { metodo: 'POST', corpo: { p: r.caminho } }).then(function (res) {
            recado('Ficha criada (' + res.criados.join(', ') + '). Preencha o gito.json e salve.');
            abrir();
        }).catch(function (e) { bt.disabled = false; bt.textContent = 'Criar ficha'; recado(e.message, true); });
    }

    /* O cartao: a linha do metro na horizontal. A primeira estacao e a
       publicada (main); depois, cada branch com a sua versao. */
    function cartao(a) {
        var f = a.ficha && a.ficha.dados, v = a.versoes || { branches: [] };
        var c = criar('button', 'appcard');
        c.type = 'button';
        c.onclick = function () { abrirApp(a.repo, a.sub); };

        var topo = criar('div', 'appcard__topo');
        var nome = el('div', 'appcard__nome', [nomeDaApp(a)]);
        if (f) nome.appendChild(criar('span', 'appcard__codigo', f.aplicacao.codigo));
        topo.appendChild(nome);
        if (f && f.aplicacao.situacao) topo.appendChild(criar('span', 'situacao situacao--' + slug(f.aplicacao.situacao), f.aplicacao.situacao));
        c.appendChild(topo);
        if (f && f.aplicacao.descricao) c.appendChild(criar('p', 'appcard__desc', f.aplicacao.descricao));
        c.appendChild(criar('p', 'appcard__onde', a.repoNome + (a.sub ? ' / ' + a.sub : '') + (f && f.aplicacao.tipo ? ' · ' + f.aplicacao.tipo : '')));

        var pub = criar('div', 'appcard__publicada');
        pub.appendChild(criar('span', 'appcard__rot', 'publicada na ' + (v.padrao || 'main')));
        pub.appendChild(criar('span', 'appcard__versao', v.publicada && v.publicada.versao ? v.publicada.versao : '—'));
        if (!v.publicada) pub.appendChild(criar('span', 'appcard__rot', 'o gito.json ainda não chegou à ' + (v.padrao || 'main')));
        c.appendChild(pub);

        c.appendChild(trilhoDeVersoes(v));

        var rod = criar('div', 'appcard__rodape');
        var is = a.issues || {};
        rod.appendChild(chip(is.abertas + ' issue(s) aberta(s)', is.abertas ? '' : 'fraco'));
        if (is.vencidas) rod.appendChild(chip(is.vencidas + ' vencida(s)', 'alarme'));
        if (is.bugs) rod.appendChild(chip(is.bugs + ' bug(s)', 'bug'));
        var srv = chip('serviços: verificando…', 'fraco');
        srv.setAttribute('data-servicos', a.repo + '|' + a.sub);
        rod.appendChild(srv);
        c.appendChild(rod);

        var avisos = [].concat(a.ficha ? a.ficha.avisos : ['gito.json ilegível']).concat(v.avisos || []);
        if (v.erro) avisos.push(v.erro);
        if (avisos.length) {
            var av = criar('ul', 'appcard__avisos');
            avisos.slice(0, 3).forEach(function (t) { av.appendChild(criar('li', null, t)); });
            c.appendChild(av);
        }
        return c;
    }

    function slug(t) { return String(t || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z]+/g, '-'); }
    function chip(texto, tipo) { return criar('span', 'pchip' + (tipo ? ' pchip--' + tipo : ''), texto); }

    function trilhoDeVersoes(v) {
        var t = criar('div', 'trilho-h');
        var ordenadas = (v.branches || []).slice().sort(function (x, y) { return (y.padrao ? 1 : 0) - (x.padrao ? 1 : 0); });
        function versaoDe(b) { return (b.servidor && b.servidor.versao) || (b.local && b.local.versao); }
        /* No cartao cabem poucas estacoes: a principal sempre, e as branches
           que ja tem versao. As sem gito.json viram uma contagem. */
        var comVersao = ordenadas.filter(function (b) { return b.padrao || versaoDe(b); });
        var semFichaN = ordenadas.length - comVersao.length;
        comVersao.slice(0, 4).forEach(function (b) {
            var lado = b.local || b.servidor || {};
            var versao = (b.servidor && b.servidor.versao) || (b.local && b.local.versao);
            var e = criar('span', 'estacao' + (b.padrao ? ' estacao--principal' : '') + (versao ? '' : ' estacao--sem'));
            e.title = b.nome + (versao ? ' · ' + versao : ' · sem gito.json nesta branch') + (lado.assunto ? '\núltimo: ' + lado.assunto : '');
            e.appendChild(criar('span', 'estacao__ponto'));
            e.appendChild(criar('span', 'estacao__branch', b.nome));
            e.appendChild(criar('span', 'estacao__versao', versao || 'sem ficha'));
            t.appendChild(e);
        });
        if (v.pasta && v.pasta.versao && (!v.publicada || v.pasta.versao !== v.publicada.versao)) {
            var atual = (v.branches || []).filter(function (b) { return b.atual; })[0];
            var vAtual = atual && ((atual.local && atual.local.versao) || (atual.servidor && atual.servidor.versao));
            if (v.pasta.versao !== vAtual) {
                var p = criar('span', 'estacao estacao--pasta');
                p.title = 'Na sua pasta, ainda não salvo';
                p.appendChild(criar('span', 'estacao__ponto'));
                p.appendChild(criar('span', 'estacao__branch', 'sua pasta'));
                p.appendChild(criar('span', 'estacao__versao', v.pasta.versao));
                t.appendChild(p);
            }
        }
        var sobra = Math.max(0, comVersao.length - 4);
        if (sobra || semFichaN) t.appendChild(criar('span', 'trilho-h__mais', [sobra ? '+' + sobra + ' com versão' : '', semFichaN ? '+' + semFichaN + ' sem ficha' : ''].filter(Boolean).join(' · ')));
        return t;
    }

    function verificarResumo(a) {
        api('/api/painel/verificar?' + qs({ p: a.repo, sub: a.sub })).then(function (rs) {
            var alvo = document.querySelector('[data-servicos="' + (a.repo + '|' + a.sub).replace(/["\\]/g, '\\$&') + '"]');
            if (!alvo) return;
            if (!rs.length) { alvo.textContent = 'sem serviços para conferir'; return; }
            var no = rs.filter(function (r) { return r.estado === 'online'; }).length;
            var fora = rs.filter(function (r) { return r.estado === 'offline'; }).length;
            alvo.textContent = 'serviços: ' + no + '/' + rs.length + ' no ar';
            alvo.className = 'pchip ' + (fora ? 'pchip--alarme' : no === rs.length ? 'pchip--ok' : 'pchip--alerta');
        }).catch(function () { /* o resumo e extra: sem ele, o cartao continua */ });
    }

    /* ======================================================== UMA APLICACAO */
    function abrirApp(repo, sub, aba) {
        U.mostrarTela('app');
        U.$$('.nav__item').forEach(function (b) { b.classList.toggle('nav__item--ativo', b.getAttribute('data-tela') === 'painel'); });
        $('[data-app-nome]').textContent = 'Lendo…';
        $('[data-app-info]').textContent = '';
        $('[data-app-corpo]').innerHTML = '';
        estado.aba = aba || estado.aba || 'versoes';
        estado.aberta = null; estado.novaAberta = false; estado.servicos = {};
        return api('/api/painel/app?' + qs({ p: repo, sub: sub })).then(function (d) {
            estado.app = d;
            pintarApp();
        }).catch(function (e) { $('[data-app-nome]').textContent = 'Não consegui abrir'; U.erroDetalhado(e, $('[data-app-corpo]')); });
    }

    function pintarApp() {
        var d = estado.app, f = d.ficha.dados, v = d.versoes;
        var nome = $('[data-app-nome]');
        nome.innerHTML = '';
        nome.appendChild(document.createTextNode(f ? f.aplicacao.nome : d.repoNome));
        if (f) nome.appendChild(criar('span', 'appcard__codigo', f.aplicacao.codigo));
        var info = [];
        info.push('publicada: ' + (v.publicada ? v.publicada.versao : '— (ainda não está na ' + (v.padrao || 'main') + ')'));
        if (v.pasta && v.pasta.versao) info.push('sua pasta: ' + v.pasta.versao);
        if (f && f.aplicacao.situacao) info.push(f.aplicacao.situacao);
        if (f && f.aplicacao.responsavel) info.push('responsável: ' + f.aplicacao.responsavel);
        info.push(d.repoNome + (d.sub ? ' / ' + d.sub : ''));
        $('[data-app-info]').textContent = info.join('  ·  ');

        var host = $('[data-app-corpo]');
        host.innerHTML = '';
        var avisos = [].concat(d.ficha.avisos || []).concat(v.avisos || []);
        if (avisos.length) {
            var av = criar('div', 'aviso');
            avisos.forEach(function (t) { av.appendChild(criar('div', null, '⚠ ' + t)); });
            host.appendChild(av);
        }

        var abas = criar('div', 'subnav');
        [['versoes', 'Versões'], ['ficha', 'Ficha técnica'], ['issues', 'Issues' + (d.issues.abertas ? ' (' + d.issues.abertas + ')' : '')]].forEach(function (p) {
            var b = criar('button', 'subnav__item' + (estado.aba === p[0] ? ' subnav__item--ativo' : ''), p[1]);
            b.onclick = function () { estado.aba = p[0]; pintarApp(); };
            abas.appendChild(b);
        });
        host.appendChild(abas);
        var corpo = criar('div');
        host.appendChild(corpo);
        if (estado.aba === 'ficha') return pintarFicha(corpo);
        if (estado.aba === 'issues') return pintarIssues(corpo);
        pintarVersoes(corpo);
    }

    /* ------------------------------------------------------------ VERSOES */
    function pintarVersoes(host) {
        var d = estado.app, v = d.versoes, f = d.ficha.dados;
        var topo = criar('div', 'versoes-topo');

        var pub = criar('div', 'bloco publicada');
        pub.appendChild(criar('p', 'bloco__titulo', 'Versão publicada · ' + (v.padrao || 'main')));
        pub.appendChild(criar('div', 'publicada__versao', v.publicada ? v.publicada.versao : '—'));
        var pd = v.publicada && v.publicada.dados;
        var linhaPadrao = (v.branches || []).filter(function (b) { return b.padrao; })[0];
        var ultimo = linhaPadrao && (linhaPadrao.servidor || linhaPadrao.local);
        pub.appendChild(criar('p', 'ajuda', v.publicada
            ? 'atualizada em ' + dataBr(pd && pd.atualizadoEm) +
              (pd && pd.compilacao ? ' · compilação nº ' + pd.compilacao.numero + (pd.compilacao.artefato ? ' (' + pd.compilacao.artefato + ')' : '') : '')
            : 'O gito.json ainda não chegou à ' + (v.padrao || 'main') + '.'));
        if (ultimo) pub.appendChild(criar('p', 'ajuda ajuda--fraca', 'último na ' + v.padrao + ': ' + ultimo.assunto + ' · ' + ultimo.autor + ' · ' + U.desde(ultimo.data)));
        topo.appendChild(pub);

        if (v.pasta && v.pasta.versao) {
            var pa = criar('div', 'bloco publicada publicada--pasta');
            pa.appendChild(criar('p', 'bloco__titulo', 'Na sua pasta · ' + (v.atual || '')));
            pa.appendChild(criar('div', 'publicada__versao', v.pasta.versao));
            pa.appendChild(criar('p', 'ajuda', 'É o gito.json que está no disco agora — pode ter mudança ainda não salva.'));
            topo.appendChild(pa);
        }
        host.appendChild(topo);

        var bl = criar('div', 'bloco');
        bl.appendChild(criar('p', 'bloco__titulo', 'Versão de cada branch'));
        bl.appendChild(criar('p', 'ajuda', 'Lida do gito.json de cada branch, direto do git — sem trocar de branch. As do servidor são as da última atualização da lista (aba Branches do repositório).'));
        var tab = criar('div', 'vers-tabela');
        (v.branches || []).forEach(function (b) {
            var l = criar('div', 'vers-linha' + (b.padrao ? ' vers-linha--principal' : ''));
            l.appendChild(criar('span', 'vers-linha__ponto'));
            var nome = el('div', 'vers-linha__nome', [b.nome]);
            if (b.padrao) nome.appendChild(criar('span', 'commit__tag commit__tag--servidor', 'publicada'));
            if (b.atual) nome.appendChild(criar('span', 'commit__tag', 'você está aqui'));
            l.appendChild(nome);
            var vl = b.local && b.local.versao, vs = b.servidor && b.servidor.versao;
            var ver = criar('div', 'vers-linha__versao');
            if (vl && vs && vl !== vs) {
                ver.appendChild(el('span', null, [criar('b', null, vl), ' aqui']));
                ver.appendChild(el('span', null, [criar('b', null, vs), ' no servidor']));
            } else {
                ver.appendChild(criar('b', null, vl || vs || 'sem gito.json'));
                ver.appendChild(criar('span', 'ajuda', b.local && b.servidor ? 'aqui e no servidor' : b.local ? 'só neste computador' : 'só no servidor'));
            }
            l.appendChild(ver);
            var dif = criar('div', 'vers-linha__dif');
            if (b.diferenca) {
                var partes = [];
                if (b.diferenca.frente) partes.push(b.diferenca.frente + ' à frente');
                if (b.diferenca.atras) partes.push(b.diferenca.atras + ' atrás');
                dif.textContent = partes.length ? partes.join(' · ') + ' da ' + v.padrao : 'igual à ' + v.padrao;
            } else if (!b.padrao) dif.textContent = '';
            l.appendChild(dif);
            var lado = b.local || b.servidor;
            l.appendChild(el('div', 'vers-linha__ultimo', lado ? [criar('span', null, lado.assunto), criar('span', 'ajuda', lado.autor + ' · ' + U.desde(lado.data))] : []));
            tab.appendChild(l);
        });
        if (!(v.branches || []).length) tab.appendChild(criar('div', 'vazio', 'Este repositório ainda não tem nenhum commit.'));
        bl.appendChild(tab);
        host.appendChild(bl);

        /* O historico: o da main (publicado) ou o da sua pasta (o que esta
           sendo feito agora). */
        var hb = criar('div', 'bloco bloco--linha historico-versoes');
        var cab = criar('header', 'historico-versoes__cab');
        cab.appendChild(criar('p', 'bloco__titulo', 'Histórico de versões'));
        var sel = criar('div', 'subnav subnav--mini');
        [['publicada', 'da ' + (v.padrao || 'main')], ['pasta', 'da sua pasta']].forEach(function (p) {
            var b = criar('button', 'subnav__item' + (estado.historicoDe === p[0] ? ' subnav__item--ativo' : ''), p[1]);
            b.onclick = function () { estado.historicoDe = p[0]; pintarApp(); };
            sel.appendChild(b);
        });
        cab.appendChild(sel);
        hb.appendChild(cab);
        var fonte = estado.historicoDe === 'pasta' ? f : (pd || null);
        var hist = fonte ? fonte.historico : [];
        if (!hist.length) hb.appendChild(criar('p', 'ajuda', estado.historicoDe === 'pasta' ? 'Sem histórico no gito.json da pasta.' : 'Sem versão publicada ainda.'));
        hist.forEach(function (h, i) {
            var linha = criar('div', 'commit versao-item');
            linha.appendChild(criar('span', 'commit__sha', h.versao));
            var meio = criar('div', 'commit__meio');
            var assunto = el('span', 'commit__assunto', [h.resumo || '(sem resumo)']);
            meio.appendChild(assunto);
            meio.appendChild(criar('span', 'commit__autor', dataBr(h.data) + (h.branch ? ' · ' + h.branch : '') + (h.tipo ? ' · ' + (ROT_HIST[h.tipo] || h.tipo) : '')));
            if (h.itens.length) {
                var ul = criar('ul', 'versao-item__itens');
                h.itens.forEach(function (t) { ul.appendChild(criar('li', null, t)); });
                meio.appendChild(ul);
            }
            if (h.issues.length) {
                var is = criar('div', 'versao-item__issues');
                h.issues.forEach(function (id) { is.appendChild(criar('span', 'issue-id', id)); });
                meio.appendChild(is);
            }
            linha.appendChild(meio);
            if (i === 0) linha.appendChild(criar('span', 'commit__tag', 'atual'));
            hb.appendChild(linha);
        });
        host.appendChild(hb);
    }

    /* ------------------------------------------------------------ FICHA */
    function pintarFicha(host) {
        var d = estado.app, f = d.ficha.dados;
        if (!f) { host.appendChild(criar('div', 'vazio', 'O gito.json desta aplicação não pôde ser lido.')); return; }
        var fi = f.ficha;

        var barra = criar('div', 'acoes');
        var bv = criar('button', 'btn btn--principal', 'Verificar serviços agora');
        bv.onclick = function () { verificarServicos(true, bv); };
        barra.appendChild(bv);
        barra.appendChild(criar('span', 'acoes__nota', 'A ficha vem do gito.json da sua pasta. "No ar" é conferido desta máquina: HTTP para endereços, conexão TCP para bancos.'));
        host.appendChild(barra);

        var grade = criar('div', 'ficha-grade');
        host.appendChild(grade);
        function secao(titulo, largo) {
            var b = criar('div', 'bloco ficha-secao' + (largo ? ' ficha-secao--larga' : ''));
            b.appendChild(criar('p', 'bloco__titulo', titulo));
            grade.appendChild(b);
            return b;
        }
        function vazio(b, t) { b.appendChild(criar('p', 'ajuda ajuda--fraca', t || 'não informado no gito.json')); }
        function par(b, rotulo, valor) {
            if (!valor) return;
            var p = criar('div', 'ficha-par');
            p.appendChild(criar('span', 'ficha-par__rot', rotulo));
            p.appendChild(typeof valor === 'string' ? criar('span', 'ficha-par__val', valor) : valor);
            b.appendChild(p);
        }

        var geral = secao('Visão geral', true);
        if (f.aplicacao.descricao) geral.appendChild(criar('p', 'ficha-desc', f.aplicacao.descricao));
        par(geral, 'Tipo', f.aplicacao.tipo);
        par(geral, 'Situação', f.aplicacao.situacao);
        par(geral, 'Responsável', f.aplicacao.responsavel);
        par(geral, 'Equipe', f.aplicacao.equipe);
        par(geral, 'Versão na pasta', f.versao);

        var esc = secao('Escopo');
        if (fi.escopo.objetivo) esc.appendChild(criar('p', null, fi.escopo.objetivo));
        if (fi.escopo.inclui.length) {
            esc.appendChild(criar('p', 'ficha-sub', 'Faz'));
            var ul = criar('ul', 'ficha-lista ficha-lista--sim');
            fi.escopo.inclui.forEach(function (t) { ul.appendChild(criar('li', null, t)); });
            esc.appendChild(ul);
        }
        if (fi.escopo.naoInclui.length) {
            esc.appendChild(criar('p', 'ficha-sub', 'Não faz'));
            var un = criar('ul', 'ficha-lista ficha-lista--nao');
            fi.escopo.naoInclui.forEach(function (t) { un.appendChild(criar('li', null, t)); });
            esc.appendChild(un);
        }
        if (!fi.escopo.objetivo && !fi.escopo.inclui.length) vazio(esc);

        var st = secao('Stack');
        if (fi.stack.length) {
            var chips = criar('div', 'ficha-chips');
            fi.stack.forEach(function (t) { chips.appendChild(criar('span', 'pchip', t)); });
            st.appendChild(chips);
        } else vazio(st);

        var arq = secao('Arquitetura e diagramas', true);
        if (fi.arquitetura.resumo) arq.appendChild(criar('p', null, fi.arquitetura.resumo));
        fi.arquitetura.diagramas.forEach(function (g, i) {
            var box = criar('div', 'diagrama');
            box.appendChild(criar('p', 'ficha-sub', g.titulo || 'Diagrama'));
            if (g.arquivo) {
                var a = criar('a', 'diagrama__img');
                a.href = arquivoUrl(d, { arq: g.arquivo }); a.target = '_blank'; a.rel = 'noopener';
                var img = document.createElement('img');
                img.src = a.href; img.alt = g.titulo || 'diagrama'; img.loading = 'lazy';
                img.onerror = function () { box.replaceChild(criar('p', 'aviso', 'Não achei o arquivo do diagrama: ' + g.arquivo + ' (caminho relativo à pasta do gito.json).'), a); };
                a.appendChild(img);
                box.appendChild(a);
                box.appendChild(criar('p', 'ajuda ajuda--fraca', g.arquivo + ' — clique para abrir em tamanho real'));
            } else if (g.mermaid) {
                box.appendChild(criar('pre', 'visor__codigo diagrama__mermaid', g.mermaid));
                box.appendChild(criar('p', 'ajuda ajuda--fraca', 'Código Mermaid. Para ver a imagem aqui, exporte o SVG para docs/ e use "arquivo" no gito.json.'));
            } else if (g.link) {
                var lk = el('div', 'servico-linha', [link(g.link, g.link), selo('diagrama:' + i)]);
                box.appendChild(lk);
            }
            arq.appendChild(box);
        });
        if (!fi.arquitetura.resumo && !fi.arquitetura.diagramas.length) vazio(arq);

        var hosp = secao('Onde está hospedado', true);
        if (!fi.hospedagem.length) vazio(hosp);
        fi.hospedagem.forEach(function (h, i) {
            var c = criar('div', 'servico');
            c.appendChild(el('div', 'servico__cab', [criar('b', null, h.ambiente || 'Ambiente'), h.url && h.verificar !== false ? selo('hospedagem:' + i) : null]));
            if (h.onde) c.appendChild(criar('p', 'ajuda', h.onde));
            if (h.url) c.appendChild(link(h.url, h.url));
            hosp.appendChild(c);
        });

        var bd = secao('Banco de dados', true);
        if (!fi.bancoDeDados.length) vazio(bd, 'Sem banco de dados declarado. ' + (fi.arquitetura.resumo ? '' : 'Explique em arquitetura.resumo onde a aplicação guarda os dados.'));
        fi.bancoDeDados.forEach(function (b, i) {
            var c = criar('div', 'servico');
            c.appendChild(el('div', 'servico__cab', [criar('b', null, b.nome || b.base || 'Banco'), b.servidor && b.porta ? selo('banco:' + i) : null]));
            par(c, 'Tipo', b.tipo);
            par(c, 'Servidor', b.servidor ? b.servidor + (b.porta ? ':' + b.porta : '') : '');
            par(c, 'Base', b.base);
            if (b.acesso) par(c, 'Acesso', /^https?:/i.test(b.acesso) ? el('span', null, [link(b.acesso, b.acesso), selo('banco-acesso:' + i)]) : String(b.acesso));
            if (b.observacao) c.appendChild(criar('p', 'ajuda', b.observacao));
            bd.appendChild(c);
        });

        var integ = secao('Integrações');
        if (!fi.integracoes.length) vazio(integ);
        fi.integracoes.forEach(function (g, i) {
            var c = criar('div', 'servico servico--compacto');
            c.appendChild(el('div', 'servico__cab', [criar('b', null, g.nome || 'Integração'), g.url ? selo('integracao:' + i) : null]));
            if (g.descricao) c.appendChild(criar('p', 'ajuda', g.descricao));
            if (g.url) c.appendChild(link(g.url, g.url));
            integ.appendChild(c);
        });

        var lk = secao('Links');
        if (!fi.links.length) vazio(lk);
        fi.links.forEach(function (l, i) {
            var c = criar('div', 'servico-linha');
            if (l.url) { c.appendChild(link(l.url, l.titulo || l.url)); c.appendChild(selo('link:' + i)); }
            else c.appendChild(criar('span', null, (l.titulo || '') + (l.arquivo ? ' — ' + l.arquivo + ' (no repositório)' : '')));
            lk.appendChild(c);
        });

        var ct = secao('Contatos');
        if (!fi.contatos.length) vazio(ct);
        fi.contatos.forEach(function (c) {
            var p = criar('div', 'contato');
            p.appendChild(criar('span', 'eu__avatar contato__avatar', iniciais(c.nome)));
            p.appendChild(el('span', null, [criar('b', null, c.nome || '—'), criar('span', 'ajuda', ' ' + (c.papel || ''))]));
            ct.appendChild(p);
        });

        verificarServicos(false);
    }

    /* O selo "no ar": nasce "verificando" e e pintado quando a conferencia volta. */
    function selo(chave) {
        var s = criar('span', 'servico-selo servico-selo--verificando', 'verificando…');
        s.setAttribute('data-alvo', chave);
        if (estado.servicos[chave]) pintarSelo(s, estado.servicos[chave]);
        return s;
    }
    function pintarSelo(s, r) {
        var rot = { online: 'no ar', alerta: 'atenção', offline: 'fora do ar', invalido: 'não conferido' }[r.estado] || r.estado;
        s.className = 'servico-selo servico-selo--' + r.estado;
        s.textContent = rot + (r.ms != null && r.estado !== 'offline' ? ' · ' + r.ms + ' ms' : '');
        s.title = (r.nota || '') + (r.codigo ? ' (HTTP ' + r.codigo + ')' : '') + (r.conferidoEm ? '\nconferido em ' + quandoBr(r.conferidoEm) : '');
    }
    function verificarServicos(forcar, bt) {
        var d = estado.app;
        if (bt) { bt.disabled = true; bt.textContent = 'verificando…'; }
        if (forcar) U.$$('[data-alvo]').forEach(function (s) { s.className = 'servico-selo servico-selo--verificando'; s.textContent = 'verificando…'; });
        api('/api/painel/verificar?' + qs({ p: d.repo, sub: d.sub, forcar: forcar ? 1 : 0 })).then(function (rs) {
            rs.forEach(function (r) {
                estado.servicos[r.chave] = r;
                U.$$('[data-alvo="' + r.chave + '"]').forEach(function (s) {
                    pintarSelo(s, r);
                    if (r.estado !== 'online' && r.nota) {
                        var n = s.parentNode && s.parentNode.parentNode ? s.parentNode.parentNode.querySelector('.servico__nota[data-nota="' + r.chave + '"]') : null;
                        if (!n && s.parentNode && s.parentNode.parentNode) {
                            n = criar('p', 'servico__nota'); n.setAttribute('data-nota', r.chave);
                            s.parentNode.parentNode.appendChild(n);
                        }
                        if (n) n.textContent = r.nota;
                    }
                });
            });
            if (bt) { bt.disabled = false; bt.textContent = 'Verificar serviços agora'; recado('Serviços conferidos.'); }
        }).catch(function (e) { if (bt) { bt.disabled = false; bt.textContent = 'Verificar serviços agora'; } recado(e.message, true); });
    }

    /* ------------------------------------------------------------ ISSUES */
    function pintarIssues(host) {
        var d = estado.app;
        host.appendChild(criar('p', 'ajuda', 'Carregando issues…'));
        api('/api/painel/issues?' + qs({ p: d.repo, sub: d.sub })).then(function (r) {
            estado.issues = r;
            host.innerHTML = '';
            desenharIssues(host);
        }).catch(function (e) { host.innerHTML = ''; U.erroDetalhado(e, host); });
    }

    function contaSituacoes(lista) {
        var c = { abertas: 0, vencidas: 0, todas: lista.length };
        Object.keys(ROT_SITUACAO).forEach(function (k) { c[k] = 0; });
        lista.forEach(function (i) {
            c[i.status] = (c[i.status] || 0) + 1;
            if (i.status !== 'concluida' && i.status !== 'cancelada') {
                c.abertas++;
                if (i.prazo && i.prazo < hoje()) c.vencidas++;
            }
        });
        return c;
    }

    function passaFiltro(i) {
        var f = estado.filtro;
        var fechada = i.status === 'concluida' || i.status === 'cancelada';
        if (f.situacao === 'abertas' && fechada) return false;
        if (f.situacao === 'vencidas' && (fechada || !i.prazo || i.prazo >= hoje())) return false;
        if (ROT_SITUACAO[f.situacao] && i.status !== f.situacao) return false;
        if (f.tipo && i.tipo !== f.tipo) return false;
        if (f.resp && i.responsavel !== f.resp) return false;
        if (f.busca) {
            var t = (i.id + ' ' + i.titulo + ' ' + (i.descricao || '') + ' ' + (i.responsavel || '')).toLowerCase();
            if (t.indexOf(f.busca.toLowerCase()) < 0) return false;
        }
        return true;
    }

    function desenharIssues(host) {
        var r = estado.issues, d = estado.app;
        host.innerHTML = '';

        var nota = criar('div', 'issues-nota');
        nota.appendChild(criar('span', null, 'As issues ficam em .gito/issues deste repositório — versionadas com o código. Depois de criar ou mudar, salve e envie para a equipe ver.'));
        var ir = criar('button', 'btn btn--mini', 'Ir para salvar');
        ir.onclick = function () { U.abrirRepo(d.repo, d.repoNome); };
        nota.appendChild(ir);
        host.appendChild(nota);
        (r.problemas || []).forEach(function (p) { host.appendChild(criar('div', 'aviso', '⚠ ' + p)); });

        var c = contaSituacoes(r.issues);
        var faixa = criar('div', 'issues-contagem');
        [['abertas', 'Abertas', c.abertas], ['vencidas', 'Vencidas', c.vencidas], ['aberta', 'Novas', c.aberta], ['em-andamento', 'Em andamento', c['em-andamento']],
         ['em-revisao', 'Em revisão', c['em-revisao']], ['concluida', 'Concluídas', c.concluida], ['todas', 'Todas', c.todas]].forEach(function (p) {
            var b = criar('button', 'contagem' + (estado.filtro.situacao === p[0] ? ' contagem--ativa' : '') + (p[0] === 'vencidas' && p[2] ? ' contagem--alarme' : ''));
            b.appendChild(criar('span', 'contagem__num', String(p[2] || 0)));
            b.appendChild(criar('span', 'contagem__rot', p[1]));
            b.onclick = function () { estado.filtro.situacao = p[0]; desenharIssues(host); };
            faixa.appendChild(b);
        });
        host.appendChild(faixa);

        var barra = criar('div', 'issues-barra');
        var busca = criar('input'); busca.type = 'text'; busca.placeholder = 'Buscar por ID, título, descrição…'; busca.value = estado.filtro.busca;
        busca.oninput = function () { estado.filtro.busca = busca.value; desenharLista(listaHost); };
        barra.appendChild(busca);
        barra.appendChild(seletor([['', 'Todos os tipos']].concat(r.tipos.map(function (t) { return [t, ROT_TIPO[t]]; })), estado.filtro.tipo,
            function (v) { estado.filtro.tipo = v; desenharLista(listaHost); }));
        barra.appendChild(seletor([['', 'Todos os responsáveis']].concat(r.pessoas.map(function (p) { return [p, p]; })), estado.filtro.resp,
            function (v) { estado.filtro.resp = v; desenharLista(listaHost); }));
        var nova = criar('button', 'btn btn--principal', '+ Nova issue');
        nova.onclick = function () { estado.novaAberta = !estado.novaAberta; desenharIssues(host); };
        barra.appendChild(nova);
        host.appendChild(barra);

        if (estado.novaAberta) host.appendChild(formIssue(null, host));
        var listaHost = criar('div', 'issues-lista');
        host.appendChild(listaHost);
        desenharLista(listaHost);
    }

    function seletor(opcoes, valor, aoMudar) {
        var s = criar('select');
        opcoes.forEach(function (o) { var op = criar('option', null, o[1]); op.value = o[0]; s.appendChild(op); });
        s.value = valor || '';
        s.onchange = function () { aoMudar(s.value); };
        return s;
    }

    function desenharLista(host) {
        host.innerHTML = '';
        var PESO_SIT = { 'em-andamento': 0, 'aberta': 1, 'em-revisao': 2, 'concluida': 3, 'cancelada': 4 };
        var PESO_PRI = { critica: 0, alta: 1, media: 2, baixa: 3 };
        function vencida(i) { return i.prazo && i.prazo < hoje() && PESO_SIT[i.status] < 3; }
        /* Ordem de trabalho: vencidas, depois pela situacao, pela prioridade,
           pelo prazo mais perto - e a mais nova por ultimo criterio. */
        var lista = estado.issues.issues.filter(passaFiltro).sort(function (a, b) {
            return (vencida(b) ? 1 : 0) - (vencida(a) ? 1 : 0) ||
                   (PESO_SIT[a.status] - PESO_SIT[b.status]) ||
                   ((PESO_PRI[a.prioridade] == null ? 2 : PESO_PRI[a.prioridade]) - (PESO_PRI[b.prioridade] == null ? 2 : PESO_PRI[b.prioridade])) ||
                   String(a.prazo || '9999').localeCompare(String(b.prazo || '9999')) ||
                   String(b.id).localeCompare(String(a.id), 'pt-BR', { numeric: true });
        });
        if (!lista.length) {
            host.appendChild(criar('div', 'vazio', estado.issues.issues.length ? 'Nenhuma issue com esse filtro.' : 'Nenhuma issue ainda. Use "+ Nova issue" para registrar uma melhoria, um bug ou uma tarefa.'));
            return;
        }
        lista.forEach(function (i) {
            var linha = criar('button', 'issue' + (estado.aberta === i.id ? ' issue--aberta' : ''));
            linha.type = 'button';
            linha.appendChild(criar('span', 'issue-id', i.id));
            linha.appendChild(criar('span', 'issue-tipo issue-tipo--' + i.tipo, ROT_TIPO[i.tipo] || i.tipo));
            var meio = el('span', 'issue__meio', [criar('span', 'issue__titulo', i.titulo)]);
            var sub = [ROT_PRIORIDADE[i.prioridade] ? 'prioridade ' + ROT_PRIORIDADE[i.prioridade].toLowerCase() : '',
                       i.comentarios.length ? i.comentarios.length + ' comentário(s)' : '',
                       i.evidencias.length ? i.evidencias.length + ' evidência(s)' : '',
                       'atualizada ' + U.desde(i.atualizadaEm)].filter(Boolean).join(' · ');
            meio.appendChild(criar('span', 'issue__sub', sub));
            linha.appendChild(meio);
            var resp = criar('span', 'issue__resp');
            if (i.responsavel) { resp.appendChild(criar('span', 'eu__avatar issue__avatar', iniciais(i.responsavel))); resp.appendChild(criar('span', null, i.responsavel)); }
            else resp.appendChild(criar('span', 'ajuda', 'sem responsável'));
            linha.appendChild(resp);
            linha.appendChild(prazo(i));
            linha.appendChild(criar('span', 'issue-situacao issue-situacao--' + i.status, ROT_SITUACAO[i.status] || i.status));
            linha.onclick = function () { estado.aberta = estado.aberta === i.id ? null : i.id; desenharLista(host); };
            host.appendChild(linha);
            if (estado.aberta === i.id) host.appendChild(detalheIssue(i, host));
        });
    }

    function prazo(i) {
        var p = criar('span', 'issue__prazo');
        if (!i.prazo) { p.textContent = 'sem prazo'; p.className += ' issue__prazo--sem'; return p; }
        var fechada = i.status === 'concluida' || i.status === 'cancelada';
        var dias = Math.round((Date.parse(i.prazo) - Date.parse(hoje())) / 86400000);
        p.textContent = dataBr(i.prazo) + (fechada ? '' : dias < 0 ? ' · vencida há ' + (-dias) + 'd' : dias === 0 ? ' · hoje' : dias <= 3 ? ' · em ' + dias + 'd' : '');
        if (!fechada && dias < 0) p.className += ' issue__prazo--vencido';
        else if (!fechada && dias <= 3) p.className += ' issue__prazo--perto';
        return p;
    }

    /* O formulario serve para criar (i = null) e para editar. */
    function formIssue(i, hostIssues) {
        var r = estado.issues, d = estado.app;
        var f = criar('div', 'bloco issue-form');
        f.appendChild(criar('p', 'bloco__titulo', i ? 'Editar ' + i.id : 'Nova issue'));
        var campos = {};
        function campo(rotulo, el2, largo) {
            var c = criar('div', 'issue-form__campo' + (largo ? ' issue-form__campo--largo' : ''));
            var l = criar('label', null, rotulo);
            c.appendChild(l); c.appendChild(el2);
            f.appendChild(c);
            return el2;
        }
        function entrada(tipo, valor) { var e = criar('input'); e.type = tipo; e.value = valor || ''; return e; }
        campos.titulo = campo('Título', entrada('text', i && i.titulo), true);
        campos.titulo.placeholder = 'Ex.: Relatório de vendas demora mais de 30 s para abrir';
        campos.tipo = campo('Tipo', seletor(r.tipos.map(function (t) { return [t, ROT_TIPO[t]]; }), i ? i.tipo : 'melhoria', function () {}));
        campos.prioridade = campo('Prioridade', seletor(r.prioridades.map(function (t) { return [t, ROT_PRIORIDADE[t]]; }), i ? i.prioridade : 'media', function () {}));
        if (i) campos.status = campo('Situação', seletor(r.situacoes.map(function (t) { return [t, ROT_SITUACAO[t]]; }), i.status, function () {}));
        campos.responsavel = campo('Responsável', entrada('text', i ? i.responsavel : ''));
        var dl = criar('datalist'); dl.id = 'gito-pessoas-' + (i ? i.id : 'nova');
        r.pessoas.forEach(function (p) { var o = criar('option'); o.value = p; dl.appendChild(o); });
        f.appendChild(dl);
        campos.responsavel.setAttribute('list', dl.id);
        campos.prazo = campo('Prazo', entrada('date', i ? i.prazo : ''));
        campos.versaoAlvo = campo('Versão alvo', entrada('text', i ? i.versaoAlvo : ''));
        campos.versaoAlvo.placeholder = 'ex.: 1.5.0';
        var desc = criar('textarea'); desc.rows = 5; desc.value = i ? (i.descricao || '') : '';
        desc.placeholder = 'O que precisa ser feito, como reproduzir (se for bug), o que se espera no final.';
        campos.descricao = campo('Descrição', desc, true);

        var ac = criar('div', 'linha-acoes issue-form__acoes');
        var salvar = criar('button', 'btn btn--principal', i ? 'Salvar alterações' : 'Criar issue');
        salvar.onclick = function () {
            var dados = {};
            Object.keys(campos).forEach(function (k) { dados[k] = campos[k].value; });
            salvar.disabled = true;
            api('/api/painel/issue', { metodo: 'POST', corpo: { p: d.repo, sub: d.sub, id: i ? i.id : null, dados: dados } })
                .then(function (nova) {
                    recado(i ? 'Issue ' + nova.id + ' atualizada.' : 'Issue ' + nova.id + ' criada. Lembre de salvar e enviar.');
                    estado.novaAberta = false; estado.aberta = nova.id;
                    if (!i) estado.filtro.situacao = 'abertas';
                    return recarregarIssues(hostIssues);
                })
                .catch(function (e) { salvar.disabled = false; recado(e.message, true); });
        };
        ac.appendChild(salvar);
        if (!i) {
            var cancelar = criar('button', 'btn', 'Cancelar');
            cancelar.onclick = function () { estado.novaAberta = false; desenharIssues(hostIssues); };
            ac.appendChild(cancelar);
        }
        f.appendChild(ac);
        return f;
    }

    function recarregarIssues(hostLista) {
        var d = estado.app;
        return api('/api/painel/issues?' + qs({ p: d.repo, sub: d.sub })).then(function (r) {
            estado.issues = r;
            var host = hostLista.closest ? (hostLista.closest('.issues-lista') ? hostLista.closest('.issues-lista').parentNode : hostLista) : hostLista;
            desenharIssues(host);
            api('/api/painel/app?' + qs({ p: d.repo, sub: d.sub })).then(function (novo) { estado.app.issues = novo.issues; }).catch(function () {});
        });
    }

    function detalheIssue(i, hostLista) {
        var d = estado.app;
        var box = criar('div', 'issue-detalhe');

        var cab = criar('div', 'issue-detalhe__cab');
        cab.appendChild(criar('span', null, 'Criada por ' + soNome(i.criadaPor) + ' em ' + quandoBr(i.criadaEm)));
        box.appendChild(cab);
        if (i.descricao) box.appendChild(criar('div', 'issue-detalhe__desc', i.descricao));
        box.appendChild(formIssue(i, hostLista));

        /* comentarios e evidencias */
        var cm = criar('div', 'bloco bloco--linha issue-comentarios');
        cm.appendChild(criar('p', 'bloco__titulo', 'Comentários e evidências (' + i.comentarios.length + ')'));
        i.comentarios.forEach(function (c) {
            var l = criar('div', 'commit comentario');
            l.appendChild(criar('span', 'eu__avatar comentario__avatar', iniciais(c.autor)));
            var meio = criar('div', 'commit__meio');
            meio.appendChild(criar('span', 'commit__autor', soNome(c.autor) + ' · ' + quandoBr(c.quando)));
            if (c.texto) meio.appendChild(criar('div', 'comentario__texto', c.texto));
            if ((c.evidencias || []).length) meio.appendChild(galeria(c.evidencias, i.id));
            l.appendChild(meio);
            cm.appendChild(l);
        });
        if (!i.comentarios.length) cm.appendChild(criar('p', 'ajuda', 'Nenhum comentário ainda.'));

        var novo = criar('div', 'comentar');
        var ta = criar('textarea'); ta.rows = 3; ta.placeholder = 'Escreva um comentário: andamento, dúvida, o que foi testado…';
        novo.appendChild(ta);
        var arqs = criar('input'); arqs.type = 'file'; arqs.multiple = true;
        arqs.accept = '.png,.jpg,.jpeg,.gif,.webp,.svg,.pdf,.txt,.log,.csv,.json,.zip,.docx,.xlsx,.mp4';
        var linhaAc = criar('div', 'linha-acoes');
        var rotArq = criar('label', 'btn btn--mini comentar__anexo', '📎 Anexar evidências');
        rotArq.appendChild(arqs);
        var escolhidos = criar('span', 'acoes__nota', 'até 3 arquivos de 8 MB (imagem, PDF, texto, planilha, vídeo)');
        arqs.onchange = function () {
            escolhidos.textContent = arqs.files.length ? Array.prototype.map.call(arqs.files, function (x) { return x.name; }).join(', ') : 'nenhum arquivo';
        };
        var enviar = criar('button', 'btn btn--principal', 'Comentar');
        enviar.onclick = function () {
            var lista = Array.prototype.slice.call(arqs.files || []);
            if (lista.length > 3) { recado('No máximo 3 evidências por comentário.', true); return; }
            if (lista.some(function (x) { return x.size > 8 * 1024 * 1024; })) { recado('Cada evidência pode ter até 8 MB.', true); return; }
            enviar.disabled = true; enviar.textContent = lista.length ? 'enviando evidências…' : 'enviando…';
            Promise.all(lista.map(lerBase64)).then(function (anexos) {
                return api('/api/painel/comentario', { metodo: 'POST', corpo: { p: d.repo, sub: d.sub, id: i.id, texto: ta.value, anexos: anexos } });
            }).then(function () {
                recado('Comentário registrado.');
                estado.aberta = i.id;
                return recarregarIssues(hostLista);
            }).catch(function (e) { enviar.disabled = false; enviar.textContent = 'Comentar'; recado(e.message, true); });
        };
        linhaAc.appendChild(rotArq); linhaAc.appendChild(escolhidos); linhaAc.appendChild(enviar);
        novo.appendChild(linhaAc);
        cm.appendChild(novo);
        box.appendChild(cm);

        if (i.evidencias.length) {
            var ev = criar('div', 'bloco');
            ev.appendChild(criar('p', 'bloco__titulo', 'Todas as evidências (' + i.evidencias.length + ')'));
            ev.appendChild(galeria(i.evidencias.map(function (e) { return e.arquivo; }), i.id));
            box.appendChild(ev);
        }

        var det = document.createElement('details');
        det.className = 'issue-historico';
        det.appendChild(criar('summary', null, 'Histórico da issue (' + i.historico.length + ')'));
        var ul = criar('ul');
        i.historico.slice().reverse().forEach(function (h) { ul.appendChild(criar('li', null, quandoBr(h.quando) + ' · ' + soNome(h.autor) + ' — ' + h.mudanca)); });
        det.appendChild(ul);
        box.appendChild(det);
        return box;
    }

    function galeria(nomes, id) {
        var g = criar('div', 'galeria');
        nomes.forEach(function (n) {
            var url = arquivoUrl(estado.app, { id: id, arq: n });
            var a = criar('a', 'galeria__item');
            a.href = url; a.target = '_blank'; a.rel = 'noopener';
            if (/\.(png|jpe?g|gif|webp|svg)$/i.test(n)) {
                var img = document.createElement('img'); img.src = url; img.alt = n; img.loading = 'lazy';
                a.appendChild(img);
            } else {
                a.appendChild(criar('span', 'galeria__arquivo', (n.split('.').pop() || '').toUpperCase()));
            }
            a.appendChild(criar('span', 'galeria__nome', n));
            g.appendChild(a);
        });
        return g;
    }

    function lerBase64(arquivo) {
        return new Promise(function (ok, falha) {
            var fr = new FileReader();
            fr.onload = function () { ok({ nome: arquivo.name, base64: String(fr.result || '') }); };
            fr.onerror = function () { falha(new Error('não consegui ler ' + arquivo.name)); };
            fr.readAsDataURL(arquivo);
        });
    }

    /* ======================================================== LIGACOES */
    $('[data-acao="painel-atualizar"]').onclick = abrir;
    $('[data-acao="painel-voltar"]').onclick = function () { abrir(); };

    window.gitoPainel = { abrir: abrir, abrirApp: abrirApp };
}());
