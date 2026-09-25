# Rastro

Extensão para Firefox que detecta e apresenta, por aba, o que uma página faz com a
privacidade do usuário:

- conexões a domínios de terceira parte (comparação por eTLD+1);
- cookies injetados no carregamento da página (via cabeçalho `Set-Cookie` e via
  `cookies.onChanged`, que também vê cookies criados por JavaScript);
- uso de armazenamento HTML5 (localStorage, sessionStorage e IndexedDB), em cada frame;
- uma pontuação de privacidade de 0 a 100 (ver [Pontuação](#pontuação-de-privacidade)).

Avaliação Intermediária de Cibersegurança — Insper.

## Requisitos

- Firefox 115 ou mais recente. Recomendado 126+, pois a listagem de bancos
  IndexedDB usa `indexedDB.databases()`; em versões anteriores o popup mostra
  "databases() indisponível" nessa coluna.

## Como carregar no Firefox (about:debugging)

1. Baixe ou clone este repositório.
2. No Firefox, abra `about:debugging#/runtime/this-firefox`
   (ou `about:debugging` → **Este Firefox**).
3. Clique em **Carregar extensão temporária...**
4. Selecione o arquivo `manifest.json` na raiz do repositório.
5. A extensão **Rastro** aparece na lista e o ícone dela fica na barra de
   ferramentas (se não aparecer, está no menu de extensões, ícone de peça 🧩).

A extensão temporária é removida quando o Firefox é fechado; para usar de novo,
repita os passos 2 a 4. Depois de alterar o código, clique em **Recarregar** no
card da Rastro em `about:debugging`.

## Como usar

1. Carregue a extensão **antes** de abrir a página a analisar. O plugin só
   observa o que acontece depois de carregado; se a página já estava aberta,
   recarregue-a.
2. Para medir tudo o que a página grava, comece sem dados do site:
   cadeado na barra de endereço → **Limpar cookies e dados do site**, e recarregue.
3. Clique no ícone da Rastro para ver o relatório da aba atual.

Para inspecionar os dados brutos, clique em **Inspecionar** no card da Rastro em
`about:debugging` e, no console, use `tabs` (mapa aba → relatório).

## Pontuação de privacidade

A página começa com 100 pontos e perde pontos por ocorrência de cada critério,
até um teto por critério. Nota mínima 0. Quanto mais difícil para o usuário se
defender, maior o peso. Cálculo em `lib/score.js`.

| Critério | Desconto | Teto |
|---|---|---|
| Domínio de terceira parte | −2 cada | −30 |
| Cookie de terceira parte | −3 cada | −20 |
| Cookie persistente | −1 cada | −10 |
| Frame de terceira parte com armazenamento HTML5 | −5 cada | −10 |
| Canvas fingerprint | −20 | −20 |
| Bounce tracking / cookie sync | −15 | −15 |

Faixas: 80–100 boa · 50–79 moderada · abaixo de 50 ruim.

Critérios ainda não detectados pelo plugin aparecem no popup como
"não detectado ainda" e não descontam pontos.

## Estrutura

| Arquivo | Papel |
|---|---|
| `manifest.json` | permissões e registro dos scripts (Manifest V2) |
| `lib/psl.js` | cálculo aproximado de eTLD+1 e teste de terceira parte |
| `lib/score.js` | critérios, pesos e cálculo da pontuação de privacidade |
| `background.js` | estado por aba: requisições de terceira parte e cookies |
| `content.js` | roda em cada página e iframe; lê o armazenamento HTML5 |
| `popup/` | interface com o relatório da aba atual |
| `evidencias/` | prints e arquivos HAR usados no relatório |
