
// Pontuação de privacidade da página.
//
// Metodologia: a página começa com 100 pontos e perde pontos por ocorrência de
// cada critério, até um teto de desconto por critério (um único problema não
// zera a nota). Nota mínima 0. Peso maior = mais difícil para o usuário se defender.
//
// Cada critério corresponde a um item que o enunciado manda detectar. Critérios
// com count null ainda não são detectados pelo plugin e não descontam pontos.
const SCORE_CRITERIA = [
  {
    name: "Domínios de terceira parte",
    perItem: 2, cap: 30,
    // cada terceiro recebe o IP, o navegador e a página visitada (Referer)
    count: (r) => Object.keys(r.thirdParty).length
  },
  {
    name: "Cookies de terceira parte",
    perItem: 3, cap: 20,
    // permitem ao terceiro reconhecer o usuário em sites diferentes
    count: null
  },
  {
    name: "Cookies persistentes",
    perItem: 1, cap: 10,
    // sobrevivem ao fechamento do navegador
    count: null
  },
  {
    name: "Frames de terceira parte com armazenamento HTML5",
    perItem: 5, cap: 10,
    // outro lugar para guardar um identificador, fora dos cookies
    count: (r) => Object.values(r.storage)
      .filter((f) => isThirdParty(f.url, r.url) && usesStorage(f)).length
  },
  {
    name: "Canvas fingerprint",
    perItem: 20, cap: 20,
    // identifica o navegador sem guardar nada; limpar cookies não resolve
    count: null
  },
  {
    name: "Bounce tracking / cookie sync",
    perItem: 15, cap: 15,
    // liga a identidade do usuário entre sites e contorna o particionamento
    count: null
  }
];

function usesStorage(frame) {
  return (frame.localStorage.keys || []).length > 0 ||
    (frame.sessionStorage.keys || []).length > 0 ||
    (frame.indexedDB.names || []).length > 0;
}

function privacyScore(report) {
  const items = SCORE_CRITERIA.map((c) => {
    if (!c.count) return { name: c.name, perItem: c.perItem, cap: c.cap, pending: true };
    const found = c.count(report);
    return { name: c.name, perItem: c.perItem, cap: c.cap, found, penalty: Math.min(found * c.perItem, c.cap) };
  });
  const score = Math.max(0, 100 - items.reduce((sum, i) => sum + (i.penalty || 0), 0));
  const band = score >= 80 ? "boa" : score >= 50 ? "moderada" : "ruim";
  return { score, band, items };
}
