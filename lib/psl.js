
const MULTI_PART_SUFFIXES = new Set([
  // Brasil
  "com.br", "net.br", "org.br", "gov.br", "edu.br", "art.br", "blog.br", "app.br",
  "leg.br", "jus.br", "mil.br", "ind.br", "inf.br", "tv.br",
  // Outros ccTLDs comuns
  "co.uk", "org.uk", "ac.uk", "gov.uk",
  "com.au", "net.au", "org.au",
  "co.jp", "ne.jp", "or.jp",
  "com.ar", "com.mx", "co.in", "co.za", "com.cn", "com.tr", "co.nz", "com.sg", "com.hk",
  // Plataformas que hospedam sites de donos diferentes (sufixos "privados" da PSL)
  "github.io", "gitlab.io", "herokuapp.com", "vercel.app", "netlify.app", "pages.dev",
  "workers.dev", "cloudfront.net", "azurewebsites.net", "blogspot.com", "appspot.com",
  "web.app", "firebaseapp.com"
]);
 
function hostOf(url) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch (e) {
    return "";
  }
}
 
function isWebUrl(url) {
  return /^(https?|wss?):\/\//i.test(url || "");
}
 
function baseDomain(host) {
  if (!host) return "";
  host = host.toLowerCase().replace(/\.$/, "");
  // IPs e hosts sem ponto (localhost) são o próprio "site"
  if (/^[\d.]+$/.test(host) || host.includes(":") || !host.includes(".")) return host;
  const parts = host.split(".");
  for (const n of [3, 2]) {
    if (parts.length > n && MULTI_PART_SUFFIXES.has(parts.slice(-n).join("."))) {
      return parts.slice(-(n + 1)).join(".");
    }
  }
  return parts.slice(-2).join(".");
}
 
function isThirdParty(requestUrl, pageUrl) {
  const a = baseDomain(hostOf(requestUrl));
  const b = baseDomain(hostOf(pageUrl));
  return !!a && !!b && a !== b;
}
 