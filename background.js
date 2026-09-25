
// Estado por aba: tabId -> relatório da página carregada naquela aba.
const tabs = new Map();

function newState(url) {
  return {
    url,
    site: baseDomain(hostOf(url)),   // eTLD+1 da página (primeira parte)
    startedAt: Date.now(),
    thirdParty: {}                   // eTLD+1 de terceiro -> { requests, hosts, types }
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
