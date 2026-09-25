
// Roda dentro de cada página e de cada iframe (ver manifest: all_frames).
// Lê o armazenamento HTML5 da origem deste frame e manda um resumo ao background.

const STORAGE_POLL_MS = 2000;

// Resumo de uma Storage (localStorage ou sessionStorage): chaves e tamanho.
// Os valores não são enviados, só o tamanho deles.
function summarizeStorage(getStorage) {
  try {
    const storage = getStorage();
    const keys = [];
    let chars = 0;
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      keys.push(key);
      chars += key.length + (storage.getItem(key) || "").length;
    }
    return { keys, chars };
  } catch (e) {
    // Acesso negado (ex.: iframe sandbox, armazenamento bloqueado pelo navegador).
    return { error: e.name };
  }
}

// Nomes dos bancos IndexedDB da origem. indexedDB.databases() existe a partir do Firefox 126.
async function summarizeIndexedDB() {
  try {
    if (typeof indexedDB.databases !== "function") return { error: "databases() indisponível" };
    const dbs = await indexedDB.databases();
    return { names: dbs.map((db) => db.name) };
  } catch (e) {
    return { error: e.name };
  }
}

let lastSent = "";

async function reportStorage() {
  const snapshot = {
    localStorage: summarizeStorage(() => window.localStorage),
    sessionStorage: summarizeStorage(() => window.sessionStorage),
    indexedDB: await summarizeIndexedDB()
  };
  const serialized = JSON.stringify(snapshot);
  if (serialized === lastSent) return;   // só avisa o background quando algo mudou
  lastSent = serialized;
  browser.runtime.sendMessage({ type: "storage", snapshot }).catch(() => {});
}

// A página pode gravar a qualquer momento (ex.: botão "Store data"), então além da
// leitura no carregamento há uma releitura periódica.
document.addEventListener("DOMContentLoaded", reportStorage);
const storageTimer = setInterval(reportStorage, STORAGE_POLL_MS);
// Ao sair da página, para de ler, para não misturar com o relatório da próxima.
window.addEventListener("pagehide", () => clearInterval(storageTimer));
