
// Estado por aba: tabId -> relatório da página carregada naquela aba.
const tabs = new Map();

function newState(url) {
  return {
    url,
    site: baseDomain(hostOf(url)),   // eTLD+1 da página (primeira parte)
    startedAt: Date.now(),
    thirdParty: {},                  // eTLD+1 de terceiro -> { requests, hosts, types }
    cookies: {
      headers: [],                   // Set-Cookie recebidos: o que o servidor tentou gravar
      stored: {}                     // cookies.onChanged: o que o navegador de fato gravou
    }
  };
}

// ---------------------------------------------------------------------------
// Conexões a domínios de terceira parte
// ---------------------------------------------------------------------------

browser.webRequest.onBeforeRequest.addListener(
  (details) => {
    if (details.tabId < 0 || !isWebUrl(details.url)) return;   // tabId -1 = requisição fora de aba

    // Nova navegação na aba: começa um relatório novo.
    if (details.type === "main_frame") {
      tabs.set(details.tabId, newState(details.url));
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
  },
  { urls: ["<all_urls>"] }
);

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
    state.cookies.stored[key] = { name: cookie.name, domain: cookie.domain, partitioned: !!topLevel };
  }
});

// ---------------------------------------------------------------------------
// Ciclo de vida das abas e comunicação com o popup
// ---------------------------------------------------------------------------

// Abas que já estavam abertas quando a extensão foi carregada.
browser.tabs.query({}).then((list) => {
  for (const tab of list) {
    if (isWebUrl(tab.url) && !tabs.has(tab.id)) tabs.set(tab.id, newState(tab.url));
  }
});

browser.tabs.onRemoved.addListener((tabId) => tabs.delete(tabId));

browser.runtime.onMessage.addListener((msg) => {
  if (msg.type === "getReport") {
    return Promise.resolve(tabs.get(msg.tabId) || null);
  }
});
