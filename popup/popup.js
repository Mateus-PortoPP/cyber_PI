
// Os dados vêm de sites (nomes de cookie, chaves de storage, URLs) e podem ser
// maliciosos: tudo é inserido com textContent, nunca com innerHTML.
function cell(text, className) {
  const td = document.createElement("td");
  td.textContent = text;
  if (className) td.className = className;
  return td;
}

function row(tbody, cells) {
  const tr = document.createElement("tr");
  for (const c of cells) tr.appendChild(c);
  tbody.appendChild(tr);
}

function emptyRow(tbody, columns, text) {
  const td = cell(text, "muted");
  td.colSpan = columns;
  row(tbody, [td]);
}

// Resumo de uma leitura de storage vinda do content.js.
function describeStorage(entry, field) {
  if (!entry) return "—";
  if (entry.error) return "erro: " + entry.error;
  const list = entry[field];
  return list.length ? `${list.length}: ${list.join(", ")}` : "vazio";
}

function renderScore(report) {
  const result = privacyScore(report);   // lib/score.js
  document.getElementById("score").textContent = result.score;
  document.getElementById("score-band").textContent = result.band;
  const body = document.getElementById("score-items");
  for (const item of result.items) {
    const rule = `−${item.perItem} cada, máx. −${item.cap}`;
    if (item.pending) {
      row(body, [cell(item.name), cell("não detectado ainda", "muted"), cell(rule, "muted")]);
    } else {
      row(body, [cell(item.name), cell(String(item.found)), cell(`−${item.penalty} (${rule})`)]);
    }
  }
}

// currentUrl é a URL atual da aba (pode ter mudado depois do carregamento, ex.: #hash).
function render(report, currentUrl) {
  document.getElementById("site").textContent = report.site + " — " + currentUrl;
  renderScore(report);

  // Terceira parte
  const thirdParty = Object.entries(report.thirdParty)
    .sort((a, b) => b[1].requests - a[1].requests);
  const thirdBody = document.getElementById("third-party");
  for (const [domain, info] of thirdParty) {
    // eTLD+1 agrupa subdomínios (ex.: good. e broken.third-party.site); os hosts vão embaixo.
    const domainCell = cell(domain);
    const hosts = document.createElement("div");
    hosts.className = "hosts";
    hosts.textContent = info.hosts.join(", ");
    domainCell.appendChild(hosts);
    row(thirdBody, [domainCell, cell(String(info.requests)), cell(info.types.join(", "))]);
  }
  if (!thirdParty.length) emptyRow(thirdBody, 3, "Nenhuma conexão a terceira parte.");

  // Cookies
  const stored = Object.values(report.cookies.stored);
  const cookieBody = document.getElementById("cookies");
  for (const c of stored) {
    row(cookieBody, [cell(c.name), cell(c.domain), cell(c.partitioned ? "sim" : "não")]);
  }
  if (!stored.length) emptyRow(cookieBody, 3, "Nenhum cookie gravado.");
  document.getElementById("cookie-headers").textContent = report.cookies.headers.length;
  document.getElementById("cookie-stored").textContent = stored.length;

  // Armazenamento HTML5, um frame por linha (frame 0 = página principal primeiro)
  const frames = Object.entries(report.storage).sort((a, b) => Number(a[0]) - Number(b[0]));
  const storageBody = document.getElementById("storage");
  for (const [frameId, f] of frames) {
    let origin;
    try { origin = new URL(f.url).origin; } catch (e) { origin = f.url; }
    const label = frameId === "0" ? origin + " (página)" : origin;
    row(storageBody, [
      cell(label),
      cell(describeStorage(f.localStorage, "keys")),
      cell(describeStorage(f.sessionStorage, "keys")),
      cell(describeStorage(f.indexedDB, "names"))
    ]);
  }
  if (!frames.length) emptyRow(storageBody, 4, "Nenhuma leitura de armazenamento.");

  // Resumo
  document.getElementById("sum-third").textContent = thirdParty.length;
  document.getElementById("sum-cookies").textContent = stored.length;
  document.getElementById("sum-storage").textContent = frames.filter(([, f]) => usesStorage(f)).length;

  document.getElementById("report").hidden = false;
}

(async () => {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  const report = tab && await browser.runtime.sendMessage({ type: "getReport", tabId: tab.id });
  if (report) render(report, tab.url);
  else document.getElementById("empty").hidden = false;
})();
