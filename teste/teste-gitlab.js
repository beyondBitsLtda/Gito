/* Teste da consulta de Merge Requests (gitlab.js).

   Sem rede: o https.request e trocado por um GitLab de mentira que responde o
   que cada teste precisa e ANOTA cada chamada que recebeu. E essa anotacao
   que prova as tres promessas do modulo:

   1. SO LEITURA. Nenhuma chamada sai com metodo que nao seja GET - e o
      proprio codigo-fonte nao tem outro metodo escrito.

   2. O TOKEN NAO VOLTA. Nada que o modulo devolve para a tela contem o token.

   3. O TOKEN SO VAI PARA O SERVIDOR DO REPOSITORIO. Um repositorio de outro
      host nao recebe o token deste - nem por engano.

   Rodar:  node teste/teste-gitlab.js
*/
'use strict';

var fs = require('fs');
var os = require('os');
var path = require('path');
var child = require('child_process');
var https = require('https');
var EventEmitter = require('events');

var falhas = 0;
function conferir(condicao, descricao, detalhe) {
    if (condicao) console.log('ok     ' + descricao);
    else { console.log('FALHA  ' + descricao + (detalhe ? '\n         ' + detalhe : '')); falhas++; }
}

/* ---------------- o GitLab de mentira ---------------- */
var TOKEN = 'glpat-TESTE-segredo-123';
var chamadas = [];
var respostas = {};          /* 'host path-sem-query' -> [status, corpo] */

https.request = function (op, cb) {
    var req = new EventEmitter();
    req.end = function () {
        chamadas.push({ host: op.hostname, metodo: op.method, caminho: op.path,
                        token: op.headers && op.headers['PRIVATE-TOKEN'] });
        var chave = op.hostname + ' ' + op.path.split('?')[0];
        var r = respostas[chave];
        var status = 200, corpo = '{}';
        if (!r) status = 404;
        else if (op.headers['PRIVATE-TOKEN'] !== TOKEN) status = 401;
        else { status = r[0]; corpo = JSON.stringify(r[1]); }

        var res = new EventEmitter();
        res.statusCode = status;
        res.setEncoding = function () {};
        cb(res);
        process.nextTick(function () { res.emit('data', corpo); res.emit('end'); });
    };
    req.destroy = function () {};
    return req;
};

var gitlab = require('../src/gitlab');

/* ---------------- dois repositórios, dois servidores ---------------- */
var TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'gito-gitlab-'));
function repo(nome, remoto) {
    var p = path.join(TMP, nome);
    fs.mkdirSync(p);
    child.spawnSync('git', ['init', '-q'], { cwd: p, windowsHide: true });
    child.spawnSync('git', ['remote', 'add', 'origin', remoto], { cwd: p, windowsHide: true });
    return p;
}
/* Com credencial embutida no remoto, de propósito: ela não pode ir para
   lugar nenhum além do git. */
var REPO = repo('projeto', 'https://brayan:senha-do-git@gitlab.exemplo.com/grupo/sub/projeto.git');
var OUTRO = repo('outro', 'https://gitlab.de-outra-empresa.com/x/y.git');
var PID = encodeURIComponent('grupo/sub/projeto');

var H = 'gitlab.exemplo.com';
respostas[H + ' /api/v4/user'] = [200, { username: 'brayan.rodrigues', name: 'Brayan Rodrigues' }];
respostas[H + ' /api/v4/projects/' + PID] = [200, { id: 7 }];
respostas[H + ' /api/v4/projects/' + PID + '/merge_requests'] = [200, [
    { iid: 1, title: 'Refatorar', author: { name: 'Brayan' }, source_branch: 'refatorar',
      target_branch: 'DEV', source_project_id: 7, target_project_id: 7, state: 'opened',
      detailed_merge_status: 'ci_must_pass', has_conflicts: false, web_url: 'https://x/1' },
    { iid: 2, title: 'Do fork', author: { name: 'Ana' }, source_branch: 'feature',
      target_branch: 'main', source_project_id: 99, target_project_id: 7, state: 'opened',
      detailed_merge_status: 'mergeable', has_conflicts: true, draft: true, web_url: 'https://x/2' }
]];
respostas[H + ' /api/v4/projects/' + PID + '/merge_requests/1'] = [200, {
    iid: 1, title: 'Refatorar', author: { name: 'Brayan' }, source_branch: 'refatorar',
    target_branch: 'DEV', source_project_id: 7, target_project_id: 7, state: 'opened',
    detailed_merge_status: 'not_approved', description: 'Subindo versão refatorada',
    head_pipeline: { status: 'success', web_url: 'https://x/p' }, diverged_commits_count: 1
}];
respostas[H + ' /api/v4/projects/' + PID + '/merge_requests/1/approvals'] = [200, {
    approved_by: [{ user: { name: 'Brayan Rodrigues' } }], approvals_left: 1 }];
respostas[H + ' /api/v4/projects/' + PID + '/merge_requests/1/commits'] = [200, [
    { short_id: 'e52e2d24', title: 'Merge DEV', author_name: 'Brayan', created_at: '2026-09-24T10:00:00Z' }]];
/* /diffs ausente de propósito: GitLab antigo. O módulo tem de cair no /changes. */
respostas[H + ' /api/v4/projects/' + PID + '/merge_requests/1/changes'] = [200, { changes: [
    { old_path: 'a.js', new_path: 'a.js', diff: '@@ -1 +1 @@\n-x\n+y\n' },
    { old_path: 'ESTRUTURA.MD', new_path: 'ESTRUTURA.MD', deleted_file: true, diff: '' },
    { old_path: 'grande.json', new_path: 'grande.json', too_large: true, diff: '' }
]}];

console.log('--- 1. SÓ LEITURA: o código não tem como escrever no GitLab ---');

var fonte = fs.readFileSync(path.join(__dirname, '..', 'src', 'gitlab.js'), 'utf8');
var metodos = (fonte.match(/method:\s*'(\w+)'/g) || []);
conferir(metodos.length === 1 && /'GET'/.test(metodos[0]),
    'o único método HTTP escrito no gitlab.js é GET',
    'achados: ' + JSON.stringify(metodos) + ' — aprovar/aceitar/fechar passam antes por Governança');
conferir(!/'(POST|PUT|PATCH|DELETE)'/.test(fonte.replace(/\/\*[\s\S]*?\*\//g, '')),
    'e não há POST/PUT/PATCH/DELETE em lugar nenhum do código (fora comentários)');

console.log('\n--- 2. estados em português ---');

conferir(gitlab.traduzirEstado({ state: 'opened', detailed_merge_status: 'ci_must_pass' }).texto ===
         'esperando o pipeline', 'ci_must_pass vira "esperando o pipeline"');
conferir(gitlab.traduzirEstado({ state: 'opened', detailed_merge_status: 'mergeable', has_conflicts: true })
         .codigo === 'conflict',
    'CONFLITO VENCE o status "mergeable"', 'o status pode estar atrasado; o conflito é o que importa ver');
conferir(gitlab.traduzirEstado({ state: 'merged' }).texto === 'juntado', 'juntado');
conferir(gitlab.traduzirEstado({ state: 'opened', detailed_merge_status: 'algo_novo' }).texto === 'algo_novo',
    'estado que o app não conhece passa cru, em vez de virar "desconhecido"');
conferir(gitlab.arquivoDoDiff({ new_path: 'g.json', too_large: true }).grande,
    'arquivo grande demais é marcado — não vira um diff vazio que pareceria "nada mudou"');
conferir(gitlab.enderecoCriarToken('gitlab.com').indexOf('scopes=read_api') > 0 &&
         gitlab.enderecoCriarToken('gitlab.com').indexOf('scopes=api') < 0,
    'o link de criar token já vem com o escopo MÍNIMO (read_api), não o api completo');

console.log('\n--- 3. sem token, nada sai ---');

gitlab.listarMRs(REPO, 'opened')
    .then(function () { conferir(false, 'listar sem token deveria ser recusado'); },
          function (e) {
              conferir(e.codigo === 'GITLAB_SEM_TOKEN', 'listar sem token é recusado', e.message);
              conferir(chamadas.length === 0, 'e nenhuma chamada foi feita ao GitLab');
          })
    .then(function () {
        console.log('\n--- 4. conectar ---');
        return gitlab.conectar(REPO, 'glpat-errado');
    })
    .then(function () { conferir(false, 'token errado deveria ser recusado'); },
          function (e) { conferir(e.codigo === 'GITLAB_TOKEN', 'token errado é recusado', e.message); })
    .then(function () { return gitlab.conectar(REPO, '  ' + TOKEN + '  '); })
    .then(function (st) {
        conferir(st.conectado && st.usuario === 'brayan.rodrigues', 'token bom conecta e diz com qual usuário');
        conferir(JSON.stringify(st).indexOf(TOKEN) < 0,
            'O TOKEN NÃO VOLTA para a tela no estado', JSON.stringify(st));
        conferir(JSON.stringify(st).indexOf('senha-do-git') < 0,
            'nem a credencial que estava embutida no remoto');
        conferir(st.projeto === 'grupo/sub/projeto', 'o projeto sai do remoto, com subgrupo');
        return gitlab.listarMRs(REPO, 'opened');
    })
    .then(function (mrs) {
        console.log('\n--- 5. listar ---');
        conferir(mrs.length === 2, 'lista os pedidos');
        conferir(mrs[0].estado.texto === 'esperando o pipeline' && mrs[0].mesmoProjeto,
            'com estado traduzido e sabendo que a branch é deste projeto');
        conferir(!mrs[1].mesmoProjeto && mrs[1].rascunho && mrs[1].estado.codigo === 'conflict',
            'pedido de fork é marcado (não dá para baixar a branch dele), rascunho e conflito aparecem');
        conferir(JSON.stringify(mrs).indexOf(TOKEN) < 0, 'o token não vai na lista');
        return gitlab.detalheMR(REPO, '1');
    })
    .then(function (x) {
        console.log('\n--- 6. detalhe ---');
        conferir(x.pipeline && x.pipeline.texto === 'passou', 'pipeline em português');
        conferir(x.aprovacoes && x.aprovacoes.aprovadoPor[0] === 'Brayan Rodrigues' && x.aprovacoes.faltam === 1,
            'quem aprovou e quantas aprovações faltam');
        conferir(x.atrasadoEm === 1, 'quantos salvamentos a branch está atrás do destino');
        conferir(x.arquivos.length === 3 && x.arquivos[1].apagado && x.arquivos[2].grande,
            'GitLab sem /diffs: cai no /changes e lista os arquivos', JSON.stringify(x.arquivos));
        conferir(x.commits.length === 1 && x.commits[0].curto === 'e52e2d24', 'os salvamentos do pedido');
        return gitlab.detalheMR(REPO, '1; DROP');
    })
    .then(function (x) {
        conferir(x.iid === 1, 'número do pedido é lido como número — o resto do texto não vai para a URL');
        return gitlab.detalheMR(REPO, 'abc');
    })
    .then(function () { conferir(false, 'número inválido deveria ser recusado'); },
          function (e) { conferir(/inválido/.test(e.message), 'número que não é número é recusado'); })
    .then(function () {
        console.log('\n--- 7. o token só vai para o servidor do repositório ---');
        return gitlab.listarMRs(OUTRO, 'opened');
    })
    .then(function () { conferir(false, 'repositório de outro servidor não deveria usar o token'); },
          function (e) {
              conferir(e.codigo === 'GITLAB_SEM_TOKEN',
                  'repositório de OUTRO servidor não herda o token deste', e.message);
          })
    .then(function () {
        var foraDoHost = chamadas.filter(function (c) { return c.host !== H; });
        conferir(foraDoHost.length === 0,
            'nenhuma chamada foi para outro host', JSON.stringify(foraDoHost));
        var naoGet = chamadas.filter(function (c) { return c.metodo !== 'GET'; });
        conferir(naoGet.length === 0 && chamadas.length > 0,
            'TODAS as ' + chamadas.length + ' chamadas feitas foram GET', JSON.stringify(naoGet));

        console.log('\n--- 8. token recusado depois é esquecido ---');
        TOKEN = 'glpat-outro';          /* o GitLab passa a recusar o token guardado */
        return gitlab.listarMRs(REPO, 'opened');
    })
    .then(function () { conferir(false, 'token revogado deveria falhar'); },
          function (e) {
              conferir(e.codigo === 'GITLAB_TOKEN', 'token revogado: o GitLab recusa', e.message);
              return gitlab.estado(REPO);
          })
    .then(function (st) {
        conferir(!st.conectado, 'e o app o esquece, para pedir outro em vez de insistir com o morto');
        return gitlab.conectar(REPO, 'glpat-outro').then(function () { return gitlab.sair(REPO); });
    })
    .then(function (st) {
        conferir(!st.conectado, '"Desconectar" esquece o token na hora');
    })
    .then(function () {
        try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* tudo bem */ }
        console.log('');
        console.log(falhas ? ('===== ' + falhas + ' FALHAS =====') : '===== todos passaram =====');
        process.exit(falhas ? 1 : 0);
    }, function (e) {
        console.log('FALHA  erro inesperado: ' + (e.stack || e.message));
        process.exit(1);
    });
