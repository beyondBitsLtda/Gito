/* O PAINEL DAS APLICACOES: versoes por branch, ficha, issues e verificacao.

   Roda contra repositorios git DE VERDADE, numa pasta temporaria:

     1. a ficha: o gito.json do proprio Gito passa; credencial e denunciada
     2. as versoes vem do git - main, cada branch e a pasta - sem trocar de branch
     3. o gito.json e achado na raiz e em subpastas (monorepo), fora de node_modules
     4. issues: criar, mudar (com historico), comentar com evidencia - e as
        tentativas de sair da pasta ou de subir arquivo proibido
     5. criar a ficha num repositorio sem: so acrescenta, nunca sobrescreve
     6. "esta no ar?": http (200, 404, 500, HEAD recusado) e tcp
     7. as rotas: o painel lista, o arquivo sai com sandbox, a cerca vale
     8. o painel unificado: as issues de todas as aplicacoes, mudar a
        situacao pelo kanban e o "hoje" no relogio local

   Rodar:  node teste/teste-painel.js
*/
'use strict';

var fs = require('fs');
var os = require('os');
var path = require('path');
var http = require('http');
var net = require('net');
var child = require('child_process');

var TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'gito-painel-'));
process.env.APPDATA = TMP;
process.env.XDG_CONFIG_HOME = TMP;

var painel = require('../src/painel');
var verificar = require('../src/verificar');
var config = require('../src/config');
var servidor = require('../src/servidor');

var falhas = 0;
function conferir(c, d, det) {
    if (c) console.log('ok     ' + d);
    else { console.log('FALHA  ' + d + (det ? '\n         ' + det : '')); falhas++; }
}
function g(repo, args) {
    return child.execFileSync('git', args, { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}
function ficha(versao, extra) {
    var f = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'modelo', 'gito.json'), 'utf8'));
    f.aplicacao.nome = 'App Teste'; f.aplicacao.codigo = 'APT'; f.versao = versao;
    f.historico[0].versao = versao;
    return JSON.stringify(Object.assign(f, extra || {}), null, 2);
}

var REPOS = path.join(TMP, 'repos');
var R = path.join(REPOS, 'app-teste');
fs.mkdirSync(R, { recursive: true });

(async function () {
    /* ====================================================================== */
    console.log('--- 1. a ficha ---');
    var propria = painel.lerFichaDaPasta(path.join(__dirname, '..'));
    conferir(propria && propria.ok && propria.dados.aplicacao.codigo === 'GITO',
        'o gito.json do próprio Gito (o exemplo do contrato) é lido', JSON.stringify(propria && propria.avisos));
    conferir(propria && propria.avisos.length === 0, 'e segue o contrato sem nenhum aviso', JSON.stringify(propria && propria.avisos));
    var modelo = painel.lerFicha(fs.readFileSync(path.join(__dirname, '..', 'modelo', 'gito.json'), 'utf8'));
    conferir(modelo.ok, 'o modelo em branco também é um gito.json válido');
    var comSenha = painel.lerFicha(ficha('1.0.0', { ficha: { bancoDeDados: [{ nome: 'x', observacao: 'usuario sa, senha: 123' }] } }));
    conferir(comSenha.avisos.some(function (a) { return /credencial/.test(a); }),
        'credencial na ficha é DENUNCIADA (o contrato proíbe)', JSON.stringify(comSenha.avisos));
    conferir(!painel.lerFicha('{ quebrado').ok, 'JSON quebrado vira aviso, não derruba o painel');
    conferir(painel.lerFicha(ficha('1.2')).avisos.some(function (a) { return /MAIOR\.MENOR/.test(a); }),
        'versão fora do SemVer é avisada');

    /* ====================================================================== */
    console.log('\n--- 2. as versões vêm do git ---');
    g(R, ['init', '-q', '-b', 'main']);
    g(R, ['config', 'user.name', 'Teste Gito']); g(R, ['config', 'user.email', 'teste@exemplo.com']);
    fs.writeFileSync(path.join(R, 'gito.json'), ficha('1.0.0'));
    fs.writeFileSync(path.join(R, 'app.js'), 'console.log(1);\n');
    g(R, ['add', '-A']); g(R, ['commit', '-q', '-m', 'primeira versao']);
    g(R, ['checkout', '-q', '-b', 'relatorio-vendas']);
    fs.writeFileSync(path.join(R, 'gito.json'), ficha('1.1.0-relatorio-vendas.1'));
    g(R, ['commit', '-q', '-am', 'relatorio na branch']);
    g(R, ['checkout', '-q', 'main']);
    fs.writeFileSync(path.join(R, 'gito.json'), ficha('1.0.1'));        /* na pasta, sem salvar */

    var v = await painel.versoes(R, '');
    var feat = v.branches.filter(function (b) { return b.nome === 'relatorio-vendas'; })[0];
    conferir(v.padrao === 'main' && v.publicada && v.publicada.versao === '1.0.0',
        'a versão publicada é a da main, lida do git (1.0.0)', JSON.stringify(v.publicada && v.publicada.versao));
    conferir(feat && feat.local.versao === '1.1.0-relatorio-vendas.1',
        'a versão da branch vem do gito.json DAQUELA branch, sem trocar de branch', JSON.stringify(feat));
    conferir(feat && feat.diferenca && feat.diferenca.frente === 1 && feat.diferenca.atras === 0,
        'e diz quanto a branch está à frente da main', JSON.stringify(feat && feat.diferenca));
    conferir(v.pasta && v.pasta.versao === '1.0.1', 'a pasta aparece à parte: o que ainda não foi salvo (1.0.1)');
    conferir(g(R, ['rev-parse', '--abbrev-ref', 'HEAD']).trim() === 'main' && /1\.0\.1/.test(fs.readFileSync(path.join(R, 'gito.json'), 'utf8')),
        'e nada foi tocado: continua na main, com o arquivo da pasta intacto');
    conferir(v.avisos.length === 0, 'main com versão final não gera aviso');

    g(R, ['checkout', '-q', '--', 'gito.json']);
    g(R, ['merge', '-q', '--no-ff', '-m', 'junta sem finalizar', 'relatorio-vendas']);
    var v2 = await painel.versoes(R, '');
    conferir(v2.avisos.some(function (a) { return /versão de branch/.test(a); }),
        'main que recebeu a versão com sufixo é AVISADA (faltou finalizar)', JSON.stringify(v2.avisos));

    /* ====================================================================== */
    console.log('\n--- 3. onde estão as aplicações ---');
    fs.mkdirSync(path.join(R, 'apps', 'painel'), { recursive: true });
    fs.writeFileSync(path.join(R, 'apps', 'painel', 'gito.json'), ficha('0.1.0'));
    fs.mkdirSync(path.join(R, 'node_modules', 'lib'), { recursive: true });
    fs.writeFileSync(path.join(R, 'node_modules', 'lib', 'gito.json'), ficha('9.9.9'));
    var M = path.join(REPOS, 'mono');
    fs.mkdirSync(path.join(M, 'wcm', 'widget', 'a'), { recursive: true });
    fs.mkdirSync(path.join(M, 'wcm', 'widget', 'b'), { recursive: true });
    fs.writeFileSync(path.join(M, 'wcm', 'widget', 'a', 'gito.json'), ficha('1.0.0'));
    fs.writeFileSync(path.join(M, 'wcm', 'widget', 'b', 'gito.json'), ficha('2.0.0'));
    var achadas = painel.acharAplicacoes(M).sort();
    conferir(JSON.stringify(achadas) === JSON.stringify(['wcm/widget/a', 'wcm/widget/b']),
        'monorepo: um gito.json por pasta de aplicação, até 3 níveis', JSON.stringify(achadas));
    conferir(JSON.stringify(painel.acharAplicacoes(R)) === JSON.stringify(['']),
        'com gito.json na raiz, a raiz é A aplicação (não desce, e ignora node_modules)', JSON.stringify(painel.acharAplicacoes(R)));
    var subRuim = null;
    try { painel.pastaDaApp(R, '../fora'); } catch (e) { subRuim = e; }
    conferir(subRuim && subRuim.codigo === 'CAMINHO_INVALIDO', 'pasta de aplicação com ".." é recusada');

    /* ====================================================================== */
    console.log('\n--- 4. issues ---');
    var autor = 'Teste Gito <teste@exemplo.com>';
    var i1 = painel.salvarIssue(R, 'APT', null, { titulo: 'Relatório lento', tipo: 'bug', prioridade: 'alta', prazo: '2026-10-05', responsavel: 'Ana' }, autor);
    var i2 = painel.salvarIssue(R, 'APT', null, { titulo: 'Exportar em PDF', tipo: 'melhoria' }, autor);
    conferir(i1.id === 'APT-0001' && i2.id === 'APT-0002', 'IDs em sequência com a sigla da aplicação', i1.id + ' ' + i2.id);
    conferir(fs.existsSync(path.join(R, '.gito', 'issues', 'APT-0001.json')), 'um arquivo por issue, em .gito/issues (versionado com o código)');
    var mudou = painel.salvarIssue(R, 'APT', 'APT-0001', { status: 'em-andamento', responsavel: 'Bruno' }, autor);
    conferir(mudou.status === 'em-andamento' && mudou.historico.some(function (h) { return /responsável: Ana → Bruno/.test(h.mudanca); }),
        'mudar situação e responsável fica no histórico da issue', JSON.stringify(mudou.historico));
    var invalida = painel.salvarIssue(R, 'APT', 'APT-0002', { status: 'qualquer-coisa', prazo: 'amanhã' }, autor);
    conferir(invalida.status === 'aberta' && invalida.prazo === '', 'situação e prazo fora do formato não entram');
    var png = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a4a40000000049454e44ae426082', 'hex').toString('base64');
    var com = painel.comentar(R, 'APT-0001', 'Print do erro', [{ nome: '../../fora.png', base64: png }], autor);
    conferir(com.comentarios.length === 1 && com.evidencias[0].arquivo === 'fora.png' &&
             fs.existsSync(path.join(R, '.gito', 'evidencias', 'APT-0001', 'fora.png')) && !fs.existsSync(path.join(R, 'fora.png')),
        'evidência com "../../" no nome fica DENTRO da pasta da issue', JSON.stringify(com.evidencias));
    var com2 = painel.comentar(R, 'APT-0001', '', [{ nome: 'fora.png', base64: png }], autor);
    conferir(com2.evidencias[1].arquivo === 'fora-1.png', 'nome repetido ganha sufixo: evidência nunca sobrescreve outra');
    var proibido = null;
    try { painel.comentar(R, 'APT-0001', 'x', [{ nome: 'virus.exe', base64: png }], autor); } catch (e) { proibido = e; }
    conferir(proibido && /não aceito/.test(proibido.message), 'extensão fora da lista (.exe) é recusada', proibido && proibido.message);
    var grande = null;
    try { painel.comentar(R, 'APT-0001', 'x', [{ nome: 'g.png', base64: Buffer.alloc(8 * 1024 * 1024 + 1).toString('base64') }], autor); } catch (e) { grande = e; }
    conferir(grande && /8 MB/.test(grande.message), 'evidência acima de 8 MB é recusada');
    var fuga = null;
    try { painel.arquivoDaApp(R, '../../../Windows/win.ini', true); } catch (e) { fuga = e; }
    conferir(fuga && fuga.codigo === 'CAMINHO_INVALIDO', 'ler arquivo fora da aplicação é recusado');
    var codigoFonte = null;
    try { painel.arquivoDaApp(R, 'app.js', false); } catch (e) { codigoFonte = e; }
    conferir(codigoFonte && codigoFonte.codigo === 'TIPO', 'e código-fonte não é servido como "diagrama"');
    var res = painel.resumoIssues(R);
    conferir(res.abertas === 2 && res.bugs === 1, 'o resumo conta abertas e bugs', JSON.stringify(res));

    /* ====================================================================== */
    console.log('\n--- 5. criar a ficha num repositório sem ---');
    var S = path.join(REPOS, 'sem-ficha');
    fs.mkdirSync(S); g(S, ['init', '-q']);
    fs.writeFileSync(path.join(S, 'CLAUDE.md'), '# regras do projeto\n');
    var criada = painel.criarFicha(S, 'https://gitlab.com/grupo/sem-ficha', '2026-09-26');
    var lida = painel.lerFichaDaPasta(S);
    conferir(lida && lida.ok && lida.dados.aplicacao.nome === 'sem-ficha' && lida.dados.ficha.links[0].url === 'https://gitlab.com/grupo/sem-ficha',
        'o gito.json nasce do modelo, com o nome e o endereço do repositório', JSON.stringify(criada));
    var claude = fs.readFileSync(path.join(S, 'CLAUDE.md'), 'utf8');
    conferir(/^# regras do projeto/.test(claude) && /@GITO\.md/.test(claude) && fs.existsSync(path.join(S, 'GITO.md')),
        'o CLAUDE.md existente GANHA a linha @GITO.md, sem perder o que tinha');
    var denovo = null;
    try { painel.criarFicha(S, ''); } catch (e) { denovo = e; }
    conferir(denovo && /já tem/.test(denovo.message), 'com gito.json já existente, recusa em vez de sobrescrever');

    /* ====================================================================== */
    console.log('\n--- 6. está no ar? ---');
    var srvTeste = http.createServer(function (req, res) {
        if (req.url === '/sem-head' && req.method === 'HEAD') { res.writeHead(405); return res.end(); }
        if (req.url === '/some') { res.writeHead(404); return res.end(); }
        if (req.url === '/quebrado') { res.writeHead(500); return res.end(); }
        if (req.url === '/login') { res.writeHead(401); return res.end(); }
        res.writeHead(200); res.end('ok');
    });
    await new Promise(function (ok) { srvTeste.listen(0, '127.0.0.1', ok); });
    var base = 'http://127.0.0.1:' + srvTeste.address().port;
    var r200 = await verificar.verificarHttp({ url: base + '/' });
    var r404 = await verificar.verificarHttp({ url: base + '/some' });
    var r500 = await verificar.verificarHttp({ url: base + '/quebrado' });
    var r401 = await verificar.verificarHttp({ url: base + '/login' });
    var rHead = await verificar.verificarHttp({ url: base + '/sem-head' });
    conferir(r200.estado === 'online' && r401.estado === 'online' && /login/.test(r401.nota), '200 e 401 contam como no ar (401 só exige login)');
    conferir(r404.estado === 'alerta' && r500.estado === 'offline', '404 é alerta (ficha errada?) e 500 é fora');
    conferir(rHead.estado === 'online', 'servidor que recusa HEAD é conferido com GET');
    var rFtp = await verificar.verificarHttp({ url: 'file:///C:/Windows/win.ini' });
    conferir(rFtp.estado === 'invalido', 'só http e https são conferidos (file:// não)');
    var portaAberta = srvTeste.address().port;
    var livre = await new Promise(function (ok) { var s = net.createServer(); s.listen(0, '127.0.0.1', function () { var p = s.address().port; s.close(function () { ok(p); }); }); });
    var tcpOk = await verificar.verificarTcp({ host: '127.0.0.1', porta: portaAberta });
    var tcpNao = await verificar.verificarTcp({ host: '127.0.0.1', porta: livre });
    conferir(tcpOk.estado === 'online' && tcpNao.estado === 'offline' && /recusou/.test(tcpNao.nota),
        'banco: a porta que atende é online; a fechada diz "recusou a conexão"', JSON.stringify(tcpNao));
    var alvos = verificar.alvosDaFicha({ hospedagem: [{ ambiente: 'Prod', url: base }], bancoDeDados: [{ nome: 'db', servidor: '127.0.0.1', porta: portaAberta }],
                                          links: [{ titulo: 'doc', url: base + '/some' }, { titulo: 'sem url' }] });
    conferir(alvos.length === 3 && alvos[1].tipo === 'tcp', 'os alvos saem da ficha: hospedagem, banco (tcp) e links com endereço', JSON.stringify(alvos));

    /* ====================================================================== */
    console.log('\n--- 7. as rotas ---');
    config.gravar({ pastas: [REPOS] });
    var TOKEN = config.tokenDoUsuario();
    var app = servidor.criar(TOKEN);
    await new Promise(function (ok) { app.listen(0, '127.0.0.1', ok); });
    function pedir(rota, metodo, corpo) {
        return new Promise(function (ok) {
            var dados = corpo ? JSON.stringify(corpo) : null;
            var req = http.request({ host: '127.0.0.1', port: app.address().port, path: rota, method: metodo || 'GET',
                headers: Object.assign({ 'X-Gito-Token': TOKEN }, dados ? { 'Content-Type': 'application/json' } : {}) }, function (res) {
                var b = []; res.on('data', function (d) { b.push(d); });
                res.on('end', function () { var t = Buffer.concat(b).toString('utf8'), j = null; try { j = JSON.parse(t); } catch (e) {} ok({ status: res.statusCode, cab: res.headers, j: j, t: t }); });
            });
            if (dados) req.write(dados);
            req.end();
        });
    }
    var ver = await pedir('/api/versao');
    conferir(ver.j && ver.j.ok && ver.j.dados.desatualizado === false, 'recém-aberto, o Gito não se diz desatualizado (a faixa só aparece se o código do servidor mudar depois)', ver.t);
    var lista = await pedir('/api/painel');
    var nomes = lista.j && lista.j.dados ? lista.j.dados.aplicacoes.map(function (a) { return a.repoNome + ':' + a.sub; }) : [];
    conferir(nomes.indexOf('app-teste:') >= 0, 'o painel lista a aplicação do repositório', JSON.stringify(nomes));
    conferir(lista.j && lista.j.dados.semFicha.some(function (s) { return s.nome === 'x-sem'; }) === false &&
             lista.j.dados.aplicacoes.some(function (a) { return a.repoNome === 'sem-ficha'; }),
        'e a ficha criada no passo 5 já aparece');
    fs.mkdirSync(path.join(TMP, 'fora-da-cerca'));
    var fora = await pedir('/api/painel/app?p=' + encodeURIComponent(path.join(TMP, 'fora-da-cerca')));
    conferir(fora.status === 400 && fora.j && fora.j.codigo === 'FORA_DA_CERCA', 'aplicação fora das pastas cadastradas é recusada');
    fs.mkdirSync(path.join(R, 'docs'), { recursive: true });
    fs.writeFileSync(path.join(R, 'docs', 'd.svg'), '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    var svg = await pedir('/api/painel/arquivo?p=' + encodeURIComponent(R) + '&sub=&arq=docs/d.svg');
    conferir(svg.status === 200 && /sandbox/.test(svg.cab['content-security-policy'] || '') && svg.cab['x-content-type-options'] === 'nosniff',
        'o diagrama sai com CSP sandbox: um SVG com script não roda nada na origem do app', JSON.stringify(svg.cab));
    var ev = await pedir('/api/painel/arquivo?p=' + encodeURIComponent(R) + '&sub=&id=APT-0001&arq=' + encodeURIComponent('../../app.js'));
    conferir(ev.status === 400 || ev.status === 404, 'evidência com "../" no nome não escapa da pasta da issue', ev.status + ' ' + ev.t.slice(0, 120));
    var nova = await pedir('/api/painel/issue', 'POST', { p: R, sub: '', dados: { titulo: 'Pela rota', tipo: 'tarefa' } });
    conferir(nova.j && nova.j.ok && nova.j.dados.id === 'APT-0003' && /<.+@.+>/.test(nova.j.dados.criadaPor),
        'criar issue pela rota assina com a identidade do git', JSON.stringify(nova.j && nova.j.dados && nova.j.dados.criadaPor));
    var iss = await pedir('/api/painel/issues?p=' + encodeURIComponent(R) + '&sub=');
    conferir(iss.j && iss.j.dados.issues.length === 3 && iss.j.dados.pessoas.indexOf('Bruno') >= 0,
        'a lista traz as issues e as sugestões de responsável');

    /* ====================================================================== */
    console.log('\n--- 8. o painel unificado (GITO-0002) ---');
    var todas = await pedir('/api/painel/issues-todas');
    var dt = todas.j && todas.j.dados;
    var appT = dt && dt.aplicacoes.filter(function (a) { return a.repoNome === 'app-teste' && a.sub === ''; })[0];
    conferir(appT && appT.codigo === 'APT' && appT.total === 3, 'traz cada aplicação das pastas com a sigla e o total de issues', JSON.stringify(dt && dt.aplicacoes));
    var daApp = dt ? dt.issues.filter(function (i) { return appT && i.app === appT.chave; }) : [];
    conferir(daApp.length === 3 && daApp.every(function (i) { return /^APT-\d{4}$/.test(i.id); }),
        'as issues de todas vêm juntas, cada uma com a aplicação dela', JSON.stringify(daApp.map(function (i) { return i.id; })));
    var a1 = daApp.filter(function (i) { return i.id === 'APT-0001'; })[0];
    conferir(a1 && a1.descricao === undefined && a1.historico === undefined && typeof a1.comentarios === 'number' && a1.prazo === '2026-10-05',
        'vai só o resumo que a lista, o kanban e a agenda mostram (prazo, contagens), sem descrição nem histórico', JSON.stringify(a1));
    conferir(dt && /^\d{4}-\d{2}-\d{2}$/.test(dt.hoje) && dt.tipos.indexOf('bug') >= 0 && dt.situacoes.indexOf('em-revisao') >= 0,
        'e o que as visões precisam: o dia de hoje, os tipos e as situações');
    var movida = await pedir('/api/painel/issue', 'POST', { p: R, sub: '', id: 'APT-0003', dados: { status: 'em-revisao' } });
    var m3 = movida.j && movida.j.dados;
    conferir(m3 && m3.status === 'em-revisao' && m3.titulo === 'Pela rota' && m3.tipo === 'tarefa' &&
             /situação: aberta → em-revisao/.test(m3.historico[m3.historico.length - 1].mudanca),
        'arrastar no kanban (só a situação) muda a situação, mantém o resto e entra no histórico', JSON.stringify(m3 && m3.historico));
    conferir(painel.hojeLocal(new Date(2026, 8, 26, 23, 30)) === '2026-09-26' && painel.hojeLocal(new Date(2026, 0, 5, 0, 5)) === '2026-01-05',
        'o "hoje" é o do relógio da pessoa: 23h30 ainda é o mesmo dia (em UTC já seria o seguinte)');

    app.close(); srvTeste.close();
    console.log('\n===== ' + (falhas ? falhas + ' FALHAS' : 'todos passaram') + ' =====');
    process.exit(falhas ? 1 : 0);
})().catch(function (e) { console.log('FALHA  ' + (e.stack || e)); process.exit(1); });
