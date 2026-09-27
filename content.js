
// Roda dentro de cada página e de cada iframe (ver manifest: all_frames), em
// document_start, antes dos scripts da página.
// 1. Intercepta leituras de canvas (fingerprint) e aberturas de IndexedDB.
// 2. Lê o armazenamento HTML5 da origem deste frame e manda um resumo ao background.

const STORAGE_POLL_MS = 2000;
const MIN_FINGERPRINT_SIZE = 16;   // leituras menores (ex.: teste de suporte a emoji) não contam

// ---------------------------------------------------------------------------
// Interceptação de funções da página
// ---------------------------------------------------------------------------

// O content script vive num mundo isolado (Xray) e não enxerga as funções que a
// página usa. window.wrappedJSObject dá acesso ao mundo da página, e
// exportFunction coloca lá uma função nossa, que anota a chamada e depois
// executa a original, sem mudar o resultado para a página. onCall recebe
// (objeto, argumentos, resultado) depois da chamada original.
function hook(ctorName, method, onCall) {
  const ctor = window.wrappedJSObject[ctorName];
  if (!ctor || typeof ctor.prototype[method] !== "function") return;   // API inexistente neste navegador
  const proto = ctor.prototype;
  const original = proto[method];
  exportFunction(function (...args) {
    // Reflect.apply do mundo da extensão, não original.apply: o .apply viria da
    // página, e a página não tem permissão de ler o array args (criado aqui) —
    // dava "Permission denied to access property length" e quebrava a página.
    const result = Reflect.apply(original, this, args);
    try { onCall(this, args, result); } catch (e) { /* a detecção nunca pode quebrar a página */ }
    return result;
  }, proto, { defineAs: method });
}

// ---------------------------------------------------------------------------
// Canvas fingerprint
// ---------------------------------------------------------------------------

// Canvas e imagens "identificáveis": com texto desenhado, contexto WebGL, ou
// copiados de um que era. Sem propagar a marca pelas cópias, a página escapava
// desenhando num OffscreenCanvas e lendo de outro canvas (teste
// canvas-2d-offscreen-todataurl do DDG). As chaves passam por
// XPCNativeWrapper.unwrap para que o mesmo objeto da página dê sempre a mesma
// chave, venha ele como argumento, como this ou como resultado.
const fingerprintable = new WeakSet();
const key = (obj) => XPCNativeWrapper.unwrap(obj);
const isObject = (obj) => obj !== null && typeof obj === "object";
const mark = (obj) => { if (isObject(obj)) fingerprintable.add(key(obj)); };
const isMarked = (obj) => isObject(obj) && fingerprintable.has(key(obj));
const canvasReads = {};                // função -> { calls, suspicious }

// Fingerprint = ler de volta (≥16×16) um canvas com texto ou WebGL: o resultado
// varia com placa de vídeo, fontes e sistema.
function isFingerprintRead(canvas, width, height) {
  const bigEnough = width >= MIN_FINGERPRINT_SIZE && height >= MIN_FINGERPRINT_SIZE;
  return bigEnough && isMarked(canvas);
}

function recordCanvasRead(api, suspicious) {
  const entry = canvasReads[api] || (canvasReads[api] = { calls: 0, suspicious: 0 });
  entry.calls++;
  if (suspicious) entry.suspicious++;
  // Envia a cada leitura: iframes de fingerprint podem ser removidos logo em seguida.
  browser.runtime.sendMessage({ type: "canvas", reads: canvasReads }).catch(() => {});
}

const markText = (ctx) => mark(ctx.canvas);
const markWebGL = (canvas, args) => { if (/webgl/i.test(String(args[0]))) mark(canvas); };
// Copiar um canvas marcado para outro (drawImage) marca o destino.
const markCopy = (ctx, args) => { if (isMarked(args[0])) mark(ctx.canvas); };

// Canvas comum (HTMLCanvasElement) e OffscreenCanvas (não aparece na tela).
for (const [canvasCtor, ctxCtor, exportMethod] of [
  ["HTMLCanvasElement", "CanvasRenderingContext2D", "toDataURL"],
  ["OffscreenCanvas", "OffscreenCanvasRenderingContext2D", "convertToBlob"]
]) {
  hook(canvasCtor, "getContext", markWebGL);
  hook(ctxCtor, "fillText", markText);
  hook(ctxCtor, "strokeText", markText);
  hook(ctxCtor, "drawImage", markCopy);
  hook(ctxCtor, "getImageData", (ctx, a) =>
    recordCanvasRead("getImageData", isFingerprintRead(ctx.canvas, Math.abs(a[2]), Math.abs(a[3]))));
  hook(canvasCtor, exportMethod, (canvas) =>
    recordCanvasRead(exportMethod, isFingerprintRead(canvas, canvas.width, canvas.height)));
}
// OffscreenCanvas marcado virando imagem: a imagem fica marcada.
hook("OffscreenCanvas", "transferToImageBitmap", (canvas, args, bitmap) => {
  if (isMarked(canvas)) mark(bitmap);
});
hook("HTMLCanvasElement", "toBlob", (canvas) =>
  recordCanvasRead("toBlob", isFingerprintRead(canvas, canvas.width, canvas.height)));

// WebGL: readPixels lê a imagem 3D renderizada.
for (const glCtor of ["WebGLRenderingContext", "WebGL2RenderingContext"]) {
  hook(glCtor, "readPixels", (gl, a) =>
    recordCanvasRead("readPixels", a[2] >= MIN_FINGERPRINT_SIZE && a[3] >= MIN_FINGERPRINT_SIZE));
}

// ---------------------------------------------------------------------------
// Interação do usuário (para o bounce tracking)
// ---------------------------------------------------------------------------

// Uma página que sai sozinha em poucos segundos, sem clique nem tecla, é suspeita
// de bounce. Avisa o background na primeira interação na página principal.
if (window === window.top) {
  const onInteraction = () => {
    browser.runtime.sendMessage({ type: "interaction" }).catch(() => {});
    window.removeEventListener("pointerdown", onInteraction, true);
    window.removeEventListener("keydown", onInteraction, true);
  };
  window.addEventListener("pointerdown", onInteraction, true);
  window.addEventListener("keydown", onInteraction, true);
}

// ---------------------------------------------------------------------------
// Armazenamento HTML5
// ---------------------------------------------------------------------------

// Bancos IndexedDB abertos pela página, vistos no momento da abertura. Sem isso,
// iframes que gravam e são removidos em seguida escapavam da releitura periódica.
const openedDatabases = new Set();
hook("IDBFactory", "open", (factory, args) => {
  openedDatabases.add(String(args[0]));
  reportStorage();
});

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

// Nomes dos bancos IndexedDB da origem: os listados por indexedDB.databases()
// (Firefox 126+) somados aos que a página abriu desde o carregamento.
async function summarizeIndexedDB() {
  const opened = [...openedDatabases];
  try {
    if (typeof indexedDB.databases !== "function") {
      return opened.length ? { names: opened } : { error: "databases() indisponível" };
    }
    const dbs = await indexedDB.databases();
    return { names: [...new Set([...dbs.map((db) => db.name), ...opened])] };
  } catch (e) {
    return opened.length ? { names: opened } : { error: e.name };
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
