/* Отслеживание входящих транзакций.
   BTC — публичный API mempool.space.
   SOL — публичный RPC (getSignaturesForAddress + getTransaction).
   ETH — публичный API Blockscout v2.
   XMR — отслеживания нет: блокчейн Monero не позволяет собрать входящие
   транзакции по одному адресу без ключа просмотра.

   Суммы хранятся строкой в базовых единицах (сатоши, лампорты, wei) и
   считаются через BigInt: 0.01 ETH — это 1e16 wei, что не помещается в Number
   без потери точности.

   Обёрнуто в IIFE: app.js уже объявляет nf в глобальной лексической области. */
(function () {

const TRACKED = ["btc", "sol", "eth"];

/* Пороги и цели заданы строкой в базовых единицах */
const GOALS = {
  btc: "5000000",
  sol: "20000000000",
  eth: "200000000000000000",
};

const TIERS = {
  btc: [
    { min: "1000000", note: "два фейерверка, конфетти и полный аккорд" },
    { min: "250000", note: "фейерверк, конфетти и аккорд" },
    { min: "50000", note: "два фейерверка и конфетти" },
    { min: "10000", note: "конфетти и короткий аккорд" },
    { min: "1000", note: "конфетти и один тон" },
    { min: "1", note: "один тон" },
  ],
  sol: [
    { min: "10000000000", note: "два фейерверка, конфетти и полный аккорд" },
    { min: "5000000000", note: "фейерверк, конфетти и аккорд" },
    { min: "1000000000", note: "два фейерверка и конфетти" },
    { min: "500000000", note: "конфетти и короткий аккорд" },
    { min: "100000000", note: "конфетти и один тон" },
    { min: "1000000", note: "один тон" },
  ],
  eth: [
    { min: "50000000000000000", note: "два фейерверка, конфетти и полный аккорд" },
    { min: "25000000000000000", note: "фейерверк, конфетти и аккорд" },
    { min: "10000000000000000", note: "два фейерверка и конфетти" },
    { min: "5000000000000000", note: "конфетти и короткий аккорд" },
    { min: "1000000000000000", note: "конфетти и один тон" },
    { min: "100000000000000", note: "один тон" },
  ],
};

const nf = new Intl.NumberFormat("ru-RU");
const el = {};
let seen = {};
let firstRun = {};
let ready = false;
let reduced = false;
let current = "btc";
const lastRows = { btc: [], sol: [], eth: [] };

const isTracked = (c) => TRACKED.includes(c);
const tierFor = (c, value) =>
  (TIERS[c] || []).find((t) => BigInt(value) >= BigInt(t.min)) || null;

/* Деление строки на 10^decimals без потери точности */
function fmt(c, value) {
  const decimals = CURRENCIES[c].decimals;
  const padded = String(value).padStart(decimals + 1, "0");
  const whole = padded.slice(0, padded.length - decimals).replace(/^0+(?=\d)/, "") || "0";
  const frac = decimals ? padded.slice(-decimals).replace(/0+$/, "") : "";
  return frac ? `${whole}.${frac}` : whole;
}

const amountText = (c, value) => `${fmt(c, value)} ${CURRENCIES[c].code}`;

/* ---------------- источники данных ---------------- */

async function fetchBtc(address) {
  const response = await fetch(`https://mempool.space/api/address/${address}/txs`, {
    cache: "no-store",
  });
  if (!response.ok) throw new Error(response.status);
  const txs = await response.json();
  return txs
    .map((tx) => ({
      id: tx.txid,
      value: String(
        (tx.vout || [])
          .filter((o) => o.scriptpubkey_address === address)
          .reduce((sum, o) => sum + (o.value || 0), 0)
      ),
      time: tx.status?.block_time || null,
      confirmed: !!tx.status?.confirmed,
      url: `https://mempool.space/tx/${tx.txid}`,
    }))
    .filter((row) => BigInt(row.value) > 0n);
}

/* Публичный RPC Solana. api.mainnet-beta.solana.com отвечает 403 на запросы
   с заголовком Origin, то есть из браузера не работает, поэтому он последний. */
const RPC_ENDPOINTS = [
  "https://solana-rpc.publicnode.com",
  "https://solana.api.onfinality.io/public",
  "https://api.mainnet-beta.solana.com",
];

let rpcEndpoint = 0;

async function rpc(method, params) {
  let lastError;
  for (let attempt = 0; attempt < RPC_ENDPOINTS.length; attempt++) {
    const url = RPC_ENDPOINTS[(rpcEndpoint + attempt) % RPC_ENDPOINTS.length];
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      });
      if (!response.ok) throw new Error(`${url} → ${response.status}`);
      const data = await response.json();
      if (data.error) throw new Error(data.error.message);
      rpcEndpoint = (rpcEndpoint + attempt) % RPC_ENDPOINTS.length;
      return data.result;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error("нет доступного RPC");
}

async function fetchSol(address) {
  const signatures = await rpc("getSignaturesForAddress", [address, { limit: 25 }]);
  if (!signatures.length) return [];

  const rows = await Promise.all(
    signatures.slice(0, 10).map(async (sig) => {
      try {
        const tx = await rpc("getTransaction", [
          sig.signature,
          { encoding: "jsonParsed", maxSupportedTransactionVersion: 0 },
        ]);
        if (!tx?.meta) return null;
        const keys = tx.transaction.message.accountKeys;
        const index = keys.findIndex(
          (k) => (typeof k === "string" ? k : k.pubkey) === address
        );
        if (index < 0) return null;
        const received = (tx.meta.postBalances[index] || 0) - (tx.meta.preBalances[index] || 0);
        if (received <= 0) return null;
        return {
          id: sig.signature,
          value: String(received),
          time: tx.blockTime || null,
          confirmed: sig.confirmationStatus !== "processed",
          url: `https://explorer.solana.com/tx/${sig.signature}`,
        };
      } catch {
        return null;
      }
    })
  );

  return rows.filter(Boolean);
}

/* ---- Ethereum ----
   Два независимых источника, оба без ключа и с CORS:
   1) Blockscout v2 — отдаёт готовую историю по адресу;
   2) JSON-RPC — перебор последних блоков, если REST недоступен.
   Считается только нативный ETH: переводы ERC-20 лежат в token_transfers
   и намеренно не суммируются, чтобы не выдавать их за донат. */

const ETH_RPC = [
  "https://ethereum-rpc.publicnode.com",
  "https://eth.llamarpc.com",
  "https://cloudflare-eth.com",
];

async function ethRpc(method, params) {
  let lastError;
  for (const url of ETH_RPC) {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      });
      if (!response.ok) throw new Error(`${url} → ${response.status}`);
      const data = await response.json();
      if (data.error) throw new Error(data.error.message);
      return data.result;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error("нет доступного RPC");
}

const SCAN_KEY = "donate.scan.eth.v1";
const CONFIRMATIONS = 12;
const SCAN_ON_FIRST_RUN = 24;
const SCAN_MAX = 60;

function loadScan() {
  try {
    const saved = JSON.parse(localStorage.getItem(SCAN_KEY) || "null");
    if (saved && typeof saved.lastBlock === "number" && Array.isArray(saved.rows)) return saved;
  } catch {}
  return { lastBlock: null, rows: [] };
}

/* Перебор блоков: нативные переводы не порождают логов, поэтому смотрим
   сами блоки. Окно ограничено, чтобы не упираться в лимиты публичных RPC. */
async function fetchEthByScan(address) {
  const state = loadScan();
  const head = parseInt(await ethRpc("eth_blockNumber", []), 16);

  let from = state.lastBlock === null ? head - SCAN_ON_FIRST_RUN : state.lastBlock + 1;
  let to = head;
  if (from > to) {
    return state.rows;
  }
  if (to - from + 1 > SCAN_MAX) from = to - SCAN_MAX + 1;

  const wanted = address.toLowerCase();
  const heights = [];
  for (let h = from; h <= to; h++) heights.push(h);

  const blocks = await Promise.all(
    heights.map((h) =>
      ethRpc("eth_getBlockByNumber", ["0x" + h.toString(16), true]).catch(() => null)
    )
  );

  const found = [];
  blocks.forEach((block, index) => {
    if (!block) return;
    const number = heights[index];
    for (const tx of block.transactions || []) {
      if ((tx.to || "").toLowerCase() !== wanted) continue;
      if (!tx.value || BigInt(tx.value) <= 0n) continue;
      found.push({
        id: tx.hash,
        value: String(BigInt(tx.value)),
        time: parseInt(block.timestamp, 16),
        confirmed: head - number >= CONFIRMATIONS,
        url: `https://eth.blockscout.com/tx/${tx.hash}`,
      });
    }
  });

  const merged = new Map([...state.rows, ...found].map((row) => [row.id, row]));
  const rows = [...merged.values()].sort((a, b) => b.time - a.time).slice(0, 25);

  try {
    localStorage.setItem(SCAN_KEY, JSON.stringify({ lastBlock: to, rows }));
  } catch {}

  return rows;
}

/* Основной источник: готовая история адреса, один запрос */
async function fetchEthByRest(address) {
  const response = await fetch(
    `https://eth.blockscout.com/api/v2/addresses/${address}/transactions`,
    { cache: "no-store" }
  );
  if (!response.ok) throw new Error(response.status);
  const data = await response.json();

  return (data.items || [])
    .filter((tx) => (tx.to?.hash || "").toLowerCase() === address.toLowerCase())
    .map((tx) => ({
      id: tx.hash,
      value: String(tx.value || "0"),
      time: tx.timestamp ? Math.floor(Date.parse(tx.timestamp) / 1000) : null,
      confirmed: tx.status === "ok",
      url: `https://eth.blockscout.com/tx/${tx.hash}`,
    }))
    .filter((row) => BigInt(row.value) > 0n);
}

async function fetchEth(address) {
  try {
    return await fetchEthByRest(address);
  } catch {
    return fetchEthByScan(address);
  }
}

const SOURCES = { btc: fetchBtc, sol: fetchSol, eth: fetchEth };

/* ---------------- эффекты ---------------- */

function playTier(tier, value) {
  if (reduced) return;
  const target = $(".pay:not([hidden]) .pay-body") || document.body;
  const rect = target.getBoundingClientRect();
  const x = rect.left + rect.width / 2;
  const y = rect.top + rect.height / 2;

  if (tier && BigInt(value) * 4n >= BigInt(tier.min)) {
    FX.confetti(180);
    FX.burst(x, y, "#ed8300", 1.4);
    setTimeout(() => FX.burst(rect.left + rect.width * 0.25, rect.top, "#fa9700", 1), 220);
    setTimeout(() => FX.burst(rect.left + rect.width * 0.75, rect.top + 40, "#9e5e04", 1), 400);
    FX.chord();
  } else if (tier) {
    FX.confetti(110);
    FX.burst(x, y, "#db7400", 0.9);
    FX.chord();
  } else {
    FX.confetti(85);
    FX.tone(659.25, 0.14);
  }
}

/* ---------------- отрисовка ---------------- */

function setStatus(state, label) {
  el.status.dataset.state = state;
  el.status.textContent = label;
}

/* Пороги показываем в сатошах для BTC: десятичная запись настолько мелких
   порогов нечитаема. Для остальных сетей единица измерения — сама монета. */
const TIER_UNITS = { btc: "сат", sol: "SOL", eth: "ETH" };

function renderTiers(currency) {
  const unit = TIER_UNITS[currency];
  el.tiers.innerHTML = (TIERS[currency] || [])
    .map(
      (t) => `<li class="tier">
        <span class="t-amount">от ${unit === "сат" ? nf.format(BigInt(t.min)) : fmt(currency, t.min)}
          <span class="sat">${unit}</span></span>
        <span class="t-note">${t.note}</span>
      </li>`
    )
    .join("");
}

function renderFeed(currency, rows) {
  if (!rows.length) {
    el.feed.innerHTML = `<li class="empty">
      <strong>Транзакций пока нет</strong>
      <p>Первая запись появится здесь автоматически, обычно в течение минуты
         после подтверждения транзакции в сети.</p>
    </li>`;
    return;
  }

  el.feed.innerHTML = rows
    .map((row) => {
      const time = row.time
        ? new Date(row.time * 1000).toLocaleString("ru-RU", {
            day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
          })
        : "ожидает";
      return `<li data-state="${row.confirmed ? "confirmed" : "mempool"}">
        <span class="f-amount">+${fmt(currency, row.value)} ${CURRENCIES[currency].code}</span>
        <span class="f-time time">${time}</span>
        <a class="link f-tx" target="_blank" rel="noopener" href="${row.url}">Транзакция ${row.id.slice(0, 8)}</a>
      </li>`;
    })
    .join("");
}

function renderProgress(currency, rows) {
  const goal = BigInt(GOALS[currency]);
  const total = rows.reduce((sum, row) => sum + BigInt(row.value), 0n);
  /* проценты в целых тысячных, чтобы не терять точность на BigInt */
  const perMille = Number((total * 10000n) / goal) / 100;
  const percent = Math.min(100, perMille);

  el.totalAmount.textContent = fmt(currency, total);
  el.totalUnit.textContent = CURRENCIES[currency].code;

  const usd = window.prices?.[currency];
  el.totalUsd.textContent =
    usd && total > 0n
      ? `≈ $${money((Number(fmt(currency, total)) || 0) * usd)}`
      : "";

  el.bar.style.width = percent.toFixed(percent < 10 ? 2 : 0) + "%";
  el.goalText.textContent =
    `цель ${fmt(currency, goal)} ${CURRENCIES[currency].code} · ${percent.toFixed(percent < 10 ? 2 : 0)}%`;
  el.supporters.textContent = nf.format(rows.length);
}

function render(currency, rows) {
  const tracked = isTracked(currency);
  el.progress.hidden = !tracked;
  el.feed.hidden = !tracked;
  el.tiers.hidden = !tracked;
  el.untracked.hidden = tracked;

  el.trackTitle.textContent = tracked
    ? "Что происходит после перевода"
    : "Почему здесь нет ленты";
  el.trackLede.textContent = tracked
    ? "Страница проверяет адрес каждые 30 секунд. Как только транзакция появится в сети, здесь появится запись, а сумма определит эффект."
    : "Проверить баланс можно по адресу в проверенном обозревателе.";

  if (!tracked) {
    renderFeed(currency, []);
    setStatus("idle", "Курс обновляется каждую минуту");
    return;
  }
  renderProgress(currency, rows);
  renderTiers(currency);
  renderFeed(currency, rows);
}

function announce(currency, row) {
  const tier = tierFor(currency, row.value);
  el.notice.innerHTML = `
    <div>
      <div class="n-line">
        <span class="n-amount">+${amountText(currency, row.value)}</span>
        <span class="n-state">${row.confirmed ? "подтверждено" : "ожидает подтверждения"}</span>
      </div>
      <p class="n-text">Спасибо. ${
        tier ? tier.note.charAt(0).toUpperCase() + tier.note.slice(1) : "Спасибо за поддержку"
      }.</p>
    </div>
    <a class="link n-tx" target="_blank" rel="noopener" href="${row.url}">Открыть транзакцию</a>`;
  el.notice.classList.add("show");
  clearTimeout(announce.timer);
  announce.timer = setTimeout(() => el.notice.classList.remove("show"), 20_000);
  playTier(tier, row.value);
}

/* ---------------- цикл опроса ---------------- */

async function poll() {
  if (!isTracked(current)) return;
  const currency = current;
  let rows = [];
  try {
    rows = await SOURCES[currency](addressOf(currency));
  } catch {
    if (currency === current) setStatus("offline", "Нет связи с обозревателем");
    return;
  }
  if (currency !== current) return;
  setStatus("ok", "Отслеживание работает");

  rows.sort((a, b) => (b.time || 0) - (a.time || 0));

  const fresh = rows.filter((row) => !seen[currency].has(row.id));
  if (fresh.length) {
    fresh.forEach((row) => seen[currency].add(row.id));
    try {
      localStorage.setItem(seenKey(currency), JSON.stringify([...seen[currency]].slice(-500)));
    } catch {}
  }

  if (!firstRun[currency]) for (const row of fresh.slice(0, 3)) announce(currency, row);
  firstRun[currency] = false;

  lastRows[currency] = rows;
  render(currency, rows);
}

function bindSound() {
  const button = el.soundToggle;
  button.addEventListener("click", () => {
    const on = button.getAttribute("aria-checked") === "true";
    button.setAttribute("aria-checked", String(!on));
    if (!on) FX.tone(659.25, 0.1);
  });
}

document.addEventListener("DOMContentLoaded", () => {
  [
    "notice", "feed", "tiers", "untracked", "progress", "totalAmount", "totalUnit",
    "totalUsd", "supporters", "bar", "goalText", "status", "soundToggle",
    "trackTitle", "trackLede",
  ].forEach((id) => (el[id] = document.getElementById(id)));

  reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  current = active;
  seen = {};
  firstRun = {};

  for (const c of TRACKED) {
    try {
      seen[c] = new Set(JSON.parse(localStorage.getItem(seenKey(c)) || "[]"));
    } catch {
      seen[c] = new Set();
    }
    firstRun[c] = seen[c].size === 0;
  }

  bindSound();
  ready = true;
  render(current, lastRows[current] || []);
  poll();
  setInterval(poll, 30_000);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) poll();
  });
});

window.Tracker = {
  select(currency) {
    current = currency;
    if (!ready) return;
    render(currency, isTracked(currency) ? lastRows[currency] : []);
    if (isTracked(currency)) poll();
  },
  pricesChanged() {
    if (!ready || !isTracked(current)) return;
    renderProgress(current, lastRows[current]);
  },
};
})();
