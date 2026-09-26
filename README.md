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

### A regra que vale mais que qualquer recurso

> **Nenhuma operação do app pode fazer alguém perder código.**

O app não tem rebase, cherry-pick nem edição de histórico. Para quem está
começando isso é corda para se enforcar; para quem domina git, o VSCode está
ao lado e faz melhor.

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
branches, junção e GitLab. Os testes da comparação com a plataforma saíram
junto com ela.

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
│   └── config.js             %APPDATA%\gito\config.json, a cerca e a herança do delp-git
├── web/                      interface, sem framework e sem build (+ os SVGs da marca)
└── teste/
```
