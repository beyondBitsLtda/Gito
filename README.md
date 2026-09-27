# Gito

*Seu trabalho, estação por estação.*

Versionar o trabalho **sem terminal e sem saber git**. Roda na máquina do dev e
abre no navegador. É a nova versão do `delp-git`, com outra cara e as mesmas
funções, menos a comparação com a plataforma.

**Para abrir:** clique duas vezes em **`gito.cmd`**. Para ter um atalho na Área
de Trabalho, rode **`criar-atalho.cmd`** uma vez. Pelo terminal, é o mesmo que:

```bash
node app.js
```

```
gito 1.0.0
git version 2.55.0.windows.3
voce: Brayan Rodrigues <brayan.rodrigues@delp.com.br>
pastas configuradas: 2 (trazidas do delp-git na primeira abertura)

Abra no navegador:
  http://127.0.0.1:7027/?t=9f3c1a8e4b...
```

Fechar a janela preta encerra o app. Não existe serviço e não fica nada em
segundo plano, exceto no modo oculto descrito abaixo.

---

## O que mudou em relação ao delp-git

| | delp-git | Gito |
|---|---|---|
| Pasta | `estacao/delp-git` (continua lá, intacta) | `estacao/gito` |
| Endereço | `127.0.0.1:7017` | `127.0.0.1:7027` — **os dois rodam ao mesmo tempo** |
| Configuração | `%APPDATA%\delp-git` | `%APPDATA%\gito` — na 1ª abertura, **as pastas vêm do delp-git** |
| Comparar com a plataforma | aba "Fluig" | **removida**, com o que só existia para ela |
| Cookie de acesso | `SameSite=Lax` (precisava do link no painel) | `SameSite=Strict` — mais fechado, sem custo |
| Visual | preto e vermelho | mapa de metrô, tema claro e escuro |

## A identidade: um mapa de metrô

Um repositório é uma **linha**, e cada salvamento é uma **estação**.

- **Meus repositórios:** a lista é uma linha vertical com uma estação por repositório. A cor da estação é o estado dele, a mesma da faixa no topo e da legenda ao lado do título:

  | Cor | Estado |
  |---|---|
  | verde | tudo salvo |
  | laranja | tem coisa a salvar |
  | azul | salvo, mas falta enviar |
  | vermelho | pasta sem versão (o único alarme de verdade) |

- **Histórico:** as versões salvas são as paradas da linha, e a atual fica em verde.
- **Marca:** o glifo é uma linha com três estações, e é também o ícone da aba.
- **Tema:** claro ou escuro. Sem escolha, segue o sistema; o botão ◐ no topo alterna entre automático, claro e escuro.
- **Topo:** mostra as iniciais e o primeiro nome de quem assina os commits. O e-mail completo aparece ao passar o mouse.

As cores são as da paleta corporativa, usadas de outro jeito: o azul Mooring é
a cor da marca e da ação principal, e o vermelho fica reservado ao que exige
ação.

## O que ele faz

- **Meus repositórios:** o estado de todos de uma vez, com o que ficou para trás.
- **O que mudou:** escolher os arquivos e salvar (`add` + `commit` só do que ficou marcado), com o diff de cada arquivo.
- **Arquivos:** a árvore do repositório, com o código realçado e numerado.
- **Histórico:** as versões salvas, e baixar qualquer uma num `.zip` sem mexer na pasta.
- **Branches:** criar, trocar, publicar, trazer do servidor e juntar. Nos conflitos, escolher o lado de cada arquivo, concluir ou desfazer a junção.
- **Merge Requests:** consultar no GitLab com um token só de leitura (`read_api`), guardado apenas na memória.
- **Enviar e trazer:** `push` e `pull`, com o erro traduzido e o original do git a um clique.
- **Criar repositório:** numa pasta que ainda não tem versão.
- **Minhas pastas:** onde procurar (aceita `Z:\...` colado do Explorer), com um navegador de pastas.
- **Identidade:** pede nome e e-mail uma vez, antes do primeiro commit.
- **Painel:** as aplicações das suas pastas, com versões, ficha técnica e issues (veja abaixo).

### A regra que vale mais que qualquer recurso

> **Nenhuma operação do app pode fazer alguém perder código.**

O app não tem rebase, cherry-pick nem edição de histórico. Para quem está
começando isso é corda para se enforcar; para quem domina git, o VSCode está
ao lado e faz melhor.

---

## O painel das aplicações

A aba **Painel** mostra cada aplicação que tem um **`gito.json`**. É ele que diz o nome, a versão, o histórico e a ficha técnica. As regras de como mantê-lo estão no **`GITO.md`**, e o Claude as segue sozinho.

- **Versões:** a versão **publicada na `main`**, a de **cada branch** e a da **sua pasta** (o que ainda não foi salvo). As versões são lidas direto do git (`git show <branch>:gito.json`): o Gito não troca de branch nem toca em arquivo. O cartão de cada aplicação desenha isso como uma linha de metrô, com uma estação por branch.
  - **Branch:** o que está na pasta de cada pessoa e no servidor, e quanto ela está à frente ou atrás da `main`.
  - **Histórico:** o de versões, da `main` ou da sua pasta.
  - **Aviso:** o painel avisa quando a `main` recebeu uma versão de branch sem finalizar.
- **Ficha técnica:** tudo com link e com o selo **no ar / atenção / fora do ar**, conferido desta máquina (HTTP para endereços, conexão TCP para bancos, sem login e sem enviar dado):
  - **O que é:** descrição, escopo (faz / não faz) e stack.
  - **Arquitetura:** diagramas (imagem do repositório, código Mermaid ou link).
  - **Onde roda:** hospedagem de cada ambiente, banco de dados, integrações, links e contatos.
- **Issues:** melhorias, bugs e tarefas, cada uma com:
  - **Controle:** prazo, responsável, prioridade, versão alvo e situação (aberta, em andamento, em revisão, concluída, cancelada).
  - **Registro:** comentários, evidências (imagem, PDF, planilha, até 8 MB) e histórico de cada mudança.
  - **Ordem:** as vencidas e as críticas aparecem primeiro.
  - **Onde ficam:** em `.gito/issues/` dentro do repositório, versionadas com o código. Depois de criar ou mudar, salve e envie para a equipe ver.

### Como pôr um repositório no painel

1. **Pelo Gito:** na aba Painel, em "Repositórios sem ficha", clique em **Criar ficha**. São criados `gito.json` e `GITO.md` na raiz, e o `CLAUDE.md` ganha a linha `@GITO.md` (ou é criado). Nada existente é apagado.
   **À mão:** copie os três arquivos de **`modelo/`** para a raiz do repositório. Se o repositório já tem `CLAUDE.md`, acrescente só o conteúdo do `modelo/CLAUDE.md` no fim.
2. **Preencha o `gito.json`:** nome, sigla, descrição, versão atual e a ficha. Ou peça ao Claude: *"preencha o gito.json seguindo o GITO.md"*.
3. **Salve e envie.** A partir daí, o Claude atualiza versão, compilação, histórico e ficha a cada mudança, seguindo o `GITO.md`.

**Repositório com várias aplicações:** um `gito.json` na pasta de cada uma (por exemplo, `wcm/widget/minhaWidget/`). O Gito procura até 3 níveis abaixo da raiz.

**O exemplo é o próprio Gito:** veja o `gito.json`, o `GITO.md`, o `CLAUDE.md` e o `docs/arquitetura.svg` desta pasta.

**Segurança da ficha:** o `gito.json` é lido pela equipe inteira. Nunca coloque senha, token nem *connection string* com credencial, nem dado pessoal: o contrato proíbe, e o painel avisa quando algo parece credencial.

---

## Abrir com o Windows (modo oculto)

Rode **`iniciar-com-o-windows.cmd`** uma vez. A partir do próximo logon, o Gito
sobe sem janela e `http://127.0.0.1:7027/` abre direto. Para encerrar, use
**`parar-gito.cmd`**. Se ele não subir, o motivo fica em
`%LOCALAPPDATA%\gito\erros.log`.

É um atalho na sua pasta de Inicialização: não é serviço, não mexe no registro
e não precisa de administrador.

---

## Segurança

Uma interface web que executa git no disco é um terminal remoto se for mal
fechada. Quatro travas, e nenhuma é opcional:

| Trava | Sem ela |
|---|---|
| Escuta só em `127.0.0.1` | Qualquer um na rede abre o IP da máquina e comanda o disco |
| Token por instalação (cabeçalho `X-Gito-Token` ou cookie `HttpOnly; SameSite=Strict`) | Uma aba em qualquer site alcança `127.0.0.1` |
| Confere `Host` e `Origin` | DNS rebinding contorna as duas anteriores |
| Cerca de pastas | O app age numa pasta que ninguém pediu |

E **sem shell, nunca**: todo git sai de `src/git.js`, com `spawn`, lista de
argumentos e `shell: false`.

---

## Instalação

**Nenhuma.** Zero dependências, sem `npm install`: é o que permite viver numa
pasta de rede e cada dev rodar de lá, sem privilégio de administrador.

Precisa de **Node ≥ 14** e **git** na estação. Se faltar algum, abra um
chamado no GLPI para a TI instalar; não instale por conta própria.

---

## Testes

```bash
npm run teste
```

Segurança, os ajustes obrigatórios do git, salvar, versões, realce, árvore,
branches, junção, GitLab e o painel (`teste-painel.js`). O teste do painel usa
repositórios git de verdade:

- **Versões:** versão por branch sem trocar de branch, e o aviso de `main` sem finalizar.
- **Descoberta:** o `gito.json` em monorepo.
- **Issues e evidências:** as tentativas de sair da pasta pelo nome do arquivo ou de subir extensão proibida.
- **Criar ficha:** nunca sobrescreve.
- **"No ar":** HTTP 200, 401, 404 e 500, servidor sem HEAD e TCP.
- **Diagrama:** servido com CSP `sandbox`.

Os testes da comparação com a plataforma saíram junto com ela.

---

## Onde ficam as coisas

```
gito/
├── gito.cmd                  clique duplo para abrir
├── criar-atalho.cmd          atalho na Área de Trabalho
├── iniciar-com-o-windows.cmd modo oculto no logon
├── parar-gito.cmd            encerra o modo oculto
├── app.js                    sobe o servidor e imprime a URL com o token
├── src/
│   ├── servidor.js           http, token, Host/Origin, rotas
│   ├── git.js                A ÚNICA porta para o git
│   ├── repos.js              varredura das pastas e estado de cada repositório
│   ├── gitlab.js             Merge Requests (só leitura)
│   ├── painel.js             gito.json, versões por branch, issues e evidências
│   ├── verificar.js          "está no ar?" (http/tcp)
│   └── config.js             %APPDATA%\gito\config.json, a cerca e a herança do delp-git
├── web/                      interface, sem framework e sem build (+ os SVGs da marca)
│   └── painel.js             a aba Painel
├── modelo/                   o que copiar para os outros repositórios
│   ├── GITO.md               o contrato de versionamento que o Claude segue
│   ├── CLAUDE.md             o trecho que importa o GITO.md
│   └── gito.json             a ficha em branco
├── gito.json · GITO.md · CLAUDE.md · docs/   o próprio Gito, seguindo o contrato
└── teste/
```
