/* ============================================================================
   realce.js - marcacao de sintaxe, embutida
   ============================================================================
   POR QUE NAO USAR UMA BIBLIOTECA

   highlight.js e Prism resolveriam isto em duas linhas - por CDN. E CDN aqui
   nao funciona por dois motivos somados: a estacao pode estar atras de proxy
   ou sem internet, e a pagina roda com Content-Security-Policy default-src
   'self', que bloqueia qualquer script de fora. Afrouxar o CSP para carregar
   um realce de sintaxe seria trocar uma trava de seguranca por cor na tela.

   Baixar a biblioteca para dentro do projeto tambem nao compensa: sao centenas
   de KB para cobrir 200 linguagens, quando o que existe nos repositorios daqui
   sao seis - JavaScript, CSS, HTML/FTL, SQL, JSON e Markdown.

   COMO FUNCIONA

   Um regex unico por linguagem, com alternativas em ORDEM DE PRIORIDADE.
   Comentario e texto vem primeiro de proposito: sem isso, a palavra "function"
   dentro de um comentario sairia colorida como palavra-chave, e uma aspa
   dentro de comentario bagunçaria o resto do arquivo.

   As cores sao as do VSCode Dark+, que e o tema que a equipe ja ve o dia
   inteiro - o objetivo aqui e nao parecer outra coisa.
============================================================================ */
(function (global) {
    'use strict';

    function esc(s) {
        return String(s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
    }

    /* Cada regra e [classe, fonte-do-regex]. A ordem E a precedencia. */
    var PALAVRAS_JS = 'var|let|const|function|return|if|else|for|while|do|switch|case|break|' +
        'continue|new|delete|typeof|instanceof|this|null|undefined|true|false|try|catch|' +
        'finally|throw|class|extends|super|import|export|default|from|async|await|yield|in|of|void';

    var PALAVRAS_SQL = 'SELECT|FROM|WHERE|INSERT|INTO|VALUES|UPDATE|SET|DELETE|CREATE|ALTER|DROP|' +
        'TABLE|INDEX|VIEW|PROCEDURE|FUNCTION|TRIGGER|BEGIN|END|IF|ELSE|WHILE|DECLARE|AS|ON|' +
        'JOIN|LEFT|RIGHT|INNER|OUTER|GROUP|ORDER|BY|HAVING|UNION|ALL|DISTINCT|AND|OR|NOT|' +
        'NULL|IS|IN|EXISTS|BETWEEN|LIKE|CASE|WHEN|THEN|PRIMARY|KEY|FOREIGN|REFERENCES|' +
        'CONSTRAINT|DEFAULT|IDENTITY|GO|USE|MERGE|MATCHED|OUTPUT|WITH|TOP|PRINT|EXEC';

    var REGRAS = {
        js: [
            ['com', '\\/\\*[\\s\\S]*?\\*\\/|\\/\\/[^\\n]*'],
            ['txt', '`(?:[^`\\\\]|\\\\[\\s\\S])*`|\'(?:[^\'\\\\\\n]|\\\\.)*\'|"(?:[^"\\\\\\n]|\\\\.)*"'],
            ['cha', '\\b(?:' + PALAVRAS_JS + ')\\b'],
            ['fun', '\\b[A-Za-z_$][\\w$]*(?=\\s*\\()'],
            ['num', '\\b0[xX][0-9a-fA-F]+\\b|\\b\\d+(?:\\.\\d+)?(?:[eE][+-]?\\d+)?\\b'],
            ['tip', '\\b[A-Z][A-Za-z0-9_]*\\b']
        ],
        css: [
            ['com', '\\/\\*[\\s\\S]*?\\*\\/'],
            ['txt', '\'(?:[^\'\\\\\\n]|\\\\.)*\'|"(?:[^"\\\\\\n]|\\\\.)*"'],
            ['sel', '^[ \\t]*[.#&][\\w-]+[^{\\n]*(?={)'],
            ['cha', '--[\\w-]+|\\b[a-z-]+(?=\\s*:)'],
            ['num', '#[0-9a-fA-F]{3,8}\\b|\\b\\d+(?:\\.\\d+)?(?:px|em|rem|%|vh|vw|s|ms|fr|deg)?\\b'],
            ['ar', '@[\\w-]+']
        ],
        html: [
            ['com', '&lt;!--[\\s\\S]*?--&gt;|&lt;#--[\\s\\S]*?--&gt;'],
            ['ftl', '&lt;#\\/?[\\w.]+|\\$\\{[^}]*\\}|&lt;@[\\w.]+'],
            ['tag', '&lt;\\/?[a-zA-Z][\\w:-]*|\\/?&gt;'],
            ['txt', '"(?:[^"\\\\]|\\\\.)*"|\'(?:[^\'\\\\]|\\\\.)*\''],
            ['atr', '\\b[a-zA-Z-]+(?=\\s*=)']
        ],
        sql: [
            ['com', '--[^\\n]*|\\/\\*[\\s\\S]*?\\*\\/'],
            ['txt', 'N?\'(?:[^\']|\'\')*\''],
            ['cha', '\\b(?:' + PALAVRAS_SQL + ')\\b'],
            ['var', '@[\\w]+'],
            ['num', '\\b\\d+(?:\\.\\d+)?\\b'],
            ['tip', '\\b(?:INT|VARCHAR|NVARCHAR|BIT|DATETIME2|DATETIME|DECIMAL|FLOAT|CHAR|TEXT)\\b']
        ],
        json: [
            ['cha', '"(?:[^"\\\\]|\\\\.)*"(?=\\s*:)'],
            ['txt', '"(?:[^"\\\\]|\\\\.)*"'],
            ['num', '-?\\b\\d+(?:\\.\\d+)?(?:[eE][+-]?\\d+)?\\b'],
            ['tip', '\\b(?:true|false|null)\\b']
        ],
        md: [
            ['tit', '^#{1,6}[^\\n]*'],
            ['txt', '`[^`\\n]*`|```[\\s\\S]*?```'],
            ['cha', '^\\s*[-*+]\\s|^\\s*\\d+\\.\\s|^&gt;.*'],
            ['fun', '\\*\\*[^*\\n]+\\*\\*|__[^_\\n]+__']
        ],
        texto: []
    };

    var POR_EXTENSAO = {
        js: 'js', mjs: 'js', json: 'json', ts: 'js',
        css: 'css',
        html: 'html', htm: 'html', ftl: 'html', xml: 'html', svg: 'html', war: 'texto',
        sql: 'sql',
        md: 'md', markdown: 'md',
        properties: 'texto', info: 'texto', txt: 'texto',
        cmd: 'texto', bat: 'texto', sh: 'texto', yml: 'texto', yaml: 'texto'
    };

    function linguagemDe(caminho) {
        var m = /\.([A-Za-z0-9]+)$/.exec(String(caminho || ''));
        if (!m) return 'texto';
        return POR_EXTENSAO[m[1].toLowerCase()] || 'texto';
    }

    /* Monta o regex combinado uma vez por linguagem e guarda. */
    var cache = {};
    function motor(ling) {
        if (cache[ling]) return cache[ling];
        var regras = REGRAS[ling] || [];
        if (!regras.length) return (cache[ling] = null);
        var fonte = regras.map(function (r) { return '(' + r[1] + ')'; }).join('|');
        cache[ling] = { re: new RegExp(fonte, 'gm'), classes: regras.map(function (r) { return r[0]; }) };
        return cache[ling];
    }

    /**
     * Devolve HTML com <span class="r-xxx"> ao redor dos tokens.
     *
     * ATENCAO: o texto e escapado ANTES de casar o regex, e as regras de HTML
     * ja esperam "&lt;" no lugar de "<". Escapar depois quebraria as tags que
     * este arquivo mesmo insere.
     */
    function realcar(codigo, caminho) {
        var ling = linguagemDe(caminho);
        var texto = esc(codigo);
        var m = motor(ling);
        if (!m) return texto;

        var saida = '', ultimo = 0, achado;
        m.re.lastIndex = 0;

        while ((achado = m.re.exec(texto)) !== null) {
            /* Regex que casa vazio entraria em laco infinito. */
            if (achado[0] === '') { m.re.lastIndex++; continue; }

            saida += texto.slice(ultimo, achado.index);

            var classe = null;
            for (var i = 1; i < achado.length; i++) {
                if (achado[i] !== undefined) { classe = m.classes[i - 1]; break; }
            }
            saida += classe
                ? '<span class="r-' + classe + '">' + achado[0] + '</span>'
                : achado[0];

            ultimo = achado.index + achado[0].length;
        }
        return saida + texto.slice(ultimo);
    }

    global.realce = { realcar: realcar, linguagemDe: linguagemDe, escapar: esc };

}(window));
