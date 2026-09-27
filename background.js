
// Estado por aba: tabId -> relatório da página carregada naquela aba.
const tabs = new Map();

// Bounce: página intermediária que ficou menos que isso e saiu sem interação do usuário.
const BOUNCE_MAX_MS = 10000;
// Valores menores não são tratados como identificador (evita "1", "true", "pt-BR"...).
const MIN_ID_LENGTH = 8;
// Parâmetros de rastreio conhecidos em links (além de qualquer utm_*).
const TRACKING_PARAMS = new Set([
  "fbclid", "fb_source", "fb_action_ids", "fb_action_types", "gclid", "gclsrc",
  "dclid", "gbraid", "wbraid", "msclkid", "yclid", "twclid", "ttclid", "igshid",
  "li_fat_id", "mc_cid", "mc_eid", "_hsenc", "_hsmi", "mkt_tok", "oly_enc_id", "vero_id"
]);

function newState(url, requestId) {
  return {
    url,
    site: baseDomain(hostOf(url)),   // eTLD+1 da página (primeira parte)
    startedAt: Date.now(),
    requestId,                       // liga os saltos de um mesmo redirect do servidor
    committedAt: null,               // quando a página passou a ser exibida
    interacted: false,               // houve clique/tecla do usuário nesta página
    previous: null,                  // resumo da página anterior da aba (para bounce)
    serverHops: [],                  // URLs pelas quais esta navegação passou via redirect HTTP
    thirdParty: {},                  // eTLD+1 de terceiro -> { requests, hosts, types }
    cookies: {
      headers: [],                   // Set-Cookie recebidos: o que o servidor tentou gravar
      stored: {}                     // cookies.onChanged: o que o navegador de fato gravou
    },
    cookieValues: [],                // { name, domain, value } de cookies com cara de ID (só para cookie sync)
    idValues: {},                    // valor com cara de ID -> eTLD+1 de terceiros que o receberam
    storage: {},                     // frameId -> resumo do armazenamento HTML5 (vindo do content.js)
    canvas: {},                      // frameId -> leituras de canvas interceptadas (vindo do content.js)
    tracking: {
      params: trackingParamsIn(url), // parâmetros de rastreio na URL da página
      bounces: [],                   // sites intermediários pelos quais a navegação saltou
      syncs: []                      // indícios de cookie sync
    }
  };
}

function trackingParamsIn(url) {
  try {
    return [...new URL(url).searchParams.keys()]
      .filter((k) => TRACKING_PARAMS.has(k.toLowerCase()) || /^utm_/i.test(k));
  } catch (e) {
    return [];
  }
}

// Valor com cara de identificador: longo, sem espaços, e que não seja um horário
// (cache-buster em segundos/milissegundos) nem o endereço da própria página.
function looksLikeId(value, state) {
  if (value.length < MIN_ID_LENGTH || !/^[\w.~%-]+$/.test(value)) return false;
  if (/^\d{10}$|^\d{13}$/.test(value)) {
    const ms = value.length === 10 ? Number(value) * 1000 : Number(value);
    if (Math.abs(ms - Date.now()) < 86400000) return false;
  }
  return !value.includes(hostOf(state.url)) && value !== state.site;
}

function addSync(state, sync) {
  const id = JSON.stringify([sync.kind, sync.detail]);
  if (!state.tracking.syncs.some((s) => JSON.stringify([s.kind, s.detail]) === id)) {
    state.tracking.syncs.push(sync);
  }
}

// Mostra só o começo do identificador: o popup não precisa exibir o ID inteiro.
const abbreviate = (value) => (value.length > 10 ? value.slice(0, 8) + "…" : value);

// Cookie sync em uma requisição a terceiro: mesmo ID para 2+ terceiros, ou valor
// de cookie aparecendo na URL.
function checkCookieSync(state, url, domain) {
  let params;
  try { params = new URL(url).searchParams; } catch (e) { return; }
  for (const [name, value] of params) {
    if (!looksLikeId(value, state)) continue;
    const domains = state.idValues[value] || (state.idValues[value] = []);
    if (!domains.includes(domain)) domains.push(domain);
    if (domains.length >= 2) {
      addSync(state, {
        kind: "mesmo ID enviado a vários terceiros",
        detail: `${name}=${abbreviate(value)} → ${domains.join(", ")}`
      });
    }
  }
  for (const c of state.cookieValues) {
    if (url.includes(c.value) || url.includes(encodeURIComponent(c.value))) {
      addSync(state, {
        kind: "valor de cookie na URL de terceiro",
        detail: `cookie ${c.name} (${c.domain}) → ${domain}`
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Conexões a domínios de terceira parte
// ---------------------------------------------------------------------------

browser.webRequest.onBeforeRequest.addListener(
  (details) => {
    if (details.tabId < 0 || !isWebUrl(details.url)) return;   // tabId -1 = requisição fora de aba

    // Nova navegação na aba: começa um relatório novo.
    if (details.type === "main_frame") {
      const old = tabs.get(details.tabId);
      const state = newState(details.url, details.requestId);
      if (old && old.requestId === details.requestId) {
        // Mesmo requestId: é a continuação de um redirect HTTP; a URL anterior foi um salto.
        state.previous = old.previous;
        state.serverHops = [...old.serverHops, { url: old.url, site: old.site, via: "redirect HTTP" }];
      } else if (old) {
        state.previous = {
          url: old.url, site: old.site, committedAt: old.committedAt,
          interacted: old.interacted, cookies: Object.keys(old.cookies.stored).length
        };
      }
      tabs.set(details.tabId, state);
      return;
    }

    const state = tabs.get(details.tabId);
    if (!state || !isThirdParty(details.url, state.url)) return;

    const host = hostOf(details.url);
    const domain = baseDomain(host);
    const entry = state.thirdParty[domain] ||
      (state.thirdParty[domain] = { requests: 0, hosts: [], types: [] });
    entry.requests++;
    if (!entry.hosts.includes(host)) entry.hosts.push(host);
    if (!entry.types.includes(details.type)) entry.types.push(details.type);

    checkCookieSync(state, details.url, domain);
  },
  { urls: ["<all_urls>"] }
);

// Cookie sync por redirect: um terceiro manda o navegador para outro terceiro
// levando um identificador na URL (ex.: pixel que redireciona para um parceiro).
browser.webRequest.onBeforeRedirect.addListener(
  (details) => {
    if (details.type === "main_frame") return;   // redirects da página são tratados no bounce
    const state = tabs.get(details.tabId);
    if (!state) return;
    const from = baseDomain(hostOf(details.url));
    const to = baseDomain(hostOf(details.redirectUrl));
    if (from === to || !isThirdParty(details.url, state.url) || !isThirdParty(details.redirectUrl, state.url)) return;
    let params;
    try { params = new URL(details.redirectUrl).searchParams; } catch (e) { return; }
    for (const [name, value] of params) {
      if (looksLikeId(value, state)) {
        addSync(state, {
          kind: "redirect entre terceiros com ID",
          detail: `${from} → ${to} (${name}=${abbreviate(value)})`
        });
      }
    }
  },
  { urls: ["<all_urls>"] }
);

// ---------------------------------------------------------------------------
// Bounce tracking
// ---------------------------------------------------------------------------

// Quando a nova página é exibida, verifica se a navegação passou por sites
// intermediários: redirects HTTP (serverHops) ou a página anterior, se ela saiu
// sozinha por JavaScript/meta refresh ou depois de poucos segundos sem interação.
browser.webNavigation.onCommitted.addListener((details) => {
  if (details.frameId !== 0) return;
  const state = tabs.get(details.tabId);
  if (!state) return;
  state.committedAt = Date.now();

  const hops = [];
  const prev = state.previous;
  const qualifiers = details.transitionQualifiers || [];
  if (prev && prev.committedAt && !qualifiers.includes("forward_back")) {
    const stayMs = state.committedAt - prev.committedAt;
    const scripted = qualifiers.includes("client_redirect");
    const quickExit = details.transitionType === "link" && stayMs < BOUNCE_MAX_MS && !prev.interacted;
    if (scripted || quickExit) {
      hops.push({
        url: prev.url, site: prev.site, stayMs, cookies: prev.cookies,
        via: scripted ? "redirect por JavaScript/meta refresh" : "saída automática em poucos segundos"
      });
    }
  }
  hops.push(...state.serverHops);

  // Salto por um site diferente do destino = bounce (o intermediário ganhou uma
  // visita "de primeira parte" e pôde gravar seu cookie sem ser terceiro).
  state.tracking.bounces = hops.filter((hop) => hop.site !== state.site);
});

// ---------------------------------------------------------------------------
// Cookies injetados no carregamento
// ---------------------------------------------------------------------------

// Fonte 1: cabeçalhos Set-Cookie. O Firefox informa a aba, mas só vê cookies
// vindos do servidor (não os criados por document.cookie).
browser.webRequest.onHeadersReceived.addListener(
  (details) => {
    const state = tabs.get(details.tabId);
    if (!state) return;
    for (const header of details.responseHeaders || []) {
      if (header.name.toLowerCase() !== "set-cookie") continue;
      // O Firefox junta vários Set-Cookie num único cabeçalho, separados por "\n".
      for (const line of header.value.split("\n")) {
        const name = line.split(";")[0].split("=")[0].trim();
        const domainAttr = /;\s*domain=([^;]+)/i.exec(line);
        const domain = domainAttr ? domainAttr[1].trim().replace(/^\./, "") : hostOf(details.url);
        if (name) state.cookies.headers.push({ name, domain, url: details.url });
      }
    }
  },
  { urls: ["<all_urls>"] },
  ["responseHeaders"]
);

// Fonte 2: cookies.onChanged. Vê todo cookie gravado (servidor ou JavaScript),
// mas não diz a aba; a aba é deduzida pelo domínio do cookie.
browser.cookies.onChanged.addListener(({ removed, cookie }) => {
  if (removed) return;
  const cookieSite = baseDomain(cookie.domain.replace(/^\./, ""));
  // Cookie particionado (Total Cookie Protection): o Firefox diz em qual site ele foi gravado.
  const topLevel = cookie.partitionKey && cookie.partitionKey.topLevelSite;
  const topSite = topLevel ? baseDomain(hostOf(topLevel)) : null;

  for (const state of tabs.values()) {
    const belongs = topSite
      ? state.site === topSite
      : state.site === cookieSite || cookieSite in state.thirdParty;
    if (!belongs) continue;
    const key = [cookie.name, cookie.domain, cookie.path, topLevel || ""].join("|");
    state.cookies.stored[key] = {
      name: cookie.name,
      domain: cookie.domain,
      partitioned: !!topLevel,
      // 3ª parte: domínio do cookie com eTLD+1 diferente do site da aba
      // (particionado implica 3ª parte: o Firefox só particiona cookies de terceiros).
      thirdParty: !!topLevel || cookieSite !== state.site,
      // Sessão: sem data de validade, some ao fechar o navegador. Persistente: tem validade.
      session: cookie.session,
      expires: cookie.session ? null : cookie.expirationDate   // segundos desde 1970
    };
    // Guarda valores com cara de ID para procurar vazamento em URLs (cookie sync).
    if (looksLikeId(cookie.value, state) &&
        !state.cookieValues.some((c) => c.value === cookie.value)) {
      state.cookieValues.push({ name: cookie.name, domain: cookie.domain, value: cookie.value });
    }
  }
});

// ---------------------------------------------------------------------------
// Ciclo de vida das abas e comunicação com o popup
// ---------------------------------------------------------------------------

// Abas que já estavam abertas quando a extensão foi carregada.
browser.tabs.query({}).then((list) => {
  for (const tab of list) {
    if (isWebUrl(tab.url) && !tabs.has(tab.id)) tabs.set(tab.id, newState(tab.url, null));
  }
});

browser.tabs.onRemoved.addListener((tabId) => tabs.delete(tabId));

browser.runtime.onMessage.addListener((msg, sender) => {
  // Armazenamento HTML5 lido pelo content.js de um frame desta aba.
  if (msg.type === "storage" && sender.tab) {
    const state = tabs.get(sender.tab.id);
    if (state) state.storage[sender.frameId] = { url: sender.url, ...msg.snapshot };
    return;
  }
  // Leituras de canvas interceptadas pelo content.js de um frame desta aba.
  if (msg.type === "canvas" && sender.tab) {
    const state = tabs.get(sender.tab.id);
    if (state) state.canvas[sender.frameId] = { url: sender.url, reads: msg.reads };
    return;
  }
  // Primeiro clique/tecla do usuário na página principal (descarta bounce por pressa).
  if (msg.type === "interaction" && sender.tab && sender.frameId === 0) {
    const state = tabs.get(sender.tab.id);
    if (state) state.interacted = true;
    return;
  }
  if (msg.type === "getReport") {
    // cookieValues e idValues ficam só no background: o popup não precisa dos valores.
    const state = tabs.get(msg.tabId);
    if (!state) return Promise.resolve(null);
    const { cookieValues, idValues, ...report } = state;
    return Promise.resolve(report);
  }
});
