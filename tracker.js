/* Отслеживание входящих транзакций.
   BTC — публичный API mempool.space.
   SOL — публичный RPC mainnet-beta (getSignaturesForAddress + getTransaction).
   XMR — отслеживания нет: блокчейн Monero не позволяет собрать входящие
   транзакции по одному адресу без ключа просмотра.

   Обёрнуто в IIFE: app.js уже объявляет nf в глобальной лексической области. */
(function () {

const GOALS = { btc: 5_000_000, sol: 20 * 10 ** 9 }; // satoshi / lamport

const TIERS = {
  btc: [
    { min: 1_000_000, note: "два фейерверка, конфетти и полный аккорд" },
    { min: 250_000, note: "фейерверк, конфетти и аккорд" },
    { min: 50_000, note: "два фейерверка и конфетти" },
    { min: 10_000, note: "конфетти и короткий аккорд" },
    { min: 1_000, note: "конфетти и один тон" },
    { min: 1, note: "один тон" },
  ],
  sol: [
    { min: 10 * 10 ** 9, note: "два фейерверка, конфетти и полный аккорд" },
    { min: 5 * 10 ** 9, note: "фейерверк, конфетти и аккорд" },
    { min: 10 ** 9, note: "два фейерверка и конфетти" },
    { min: 5 * 10 ** 8, note: "конфетти и короткий аккорд" },
    { min: 10 ** 8, note: "конфетти и один тон" },
    { min: 1, note: "один тон" },
  ],
};

const nf = new Intl.NumberFormat("ru-RU");
const el = {};
let seen = {};
let firstRun = {};
let reduced = false;
const lastRows = { btc: [], sol: [] };

const tierFor = (c, value) =>
  (TIERS[c] || []).find((t) => value >= t.min) || null;

const fmt = (c, value) => {
  const decimals = CURRENCIES[c].decimals;
  return (value / 10 ** decimals)
    .toFixed(decimals)
    .replace(/0+$/, "")
    .replace(/\.$/, "") || "0";
};

const amountText = (c, value) => `${fmt(c, value)} ${CURRENCIES[c].code}`;

/* ---------------- источники данных ---------------- */

async function fetchBtc(address) {
  const response = await fetch(
    `https://mempool.space/api/address/${address}/txs`,
    { cache: "no-store" }
  );
  if (!response.ok) throw new Error(response.status);
  const txs = await response.json();
  return txs
    .map((tx) => ({
      id: tx.txid,
      value: (tx.vout || [])
        .filter((o) => o.scriptpubkey_address === address)
        .reduce((sum, o) => sum + (o.value || 0), 0),
      time: tx.status?.block_time || null,
      confirmed: !!tx.status?.confirmed,
      url: `https://mempool.space/tx/${tx.txid}`,
    }))
    .filter((row) => row.value > 0);
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
        const account = tx.transaction.message.accountKeys.find(
          (k) => (typeof k === "string" ? k : k.pubkey) === address
        );
        const index = tx.transaction.message.accountKeys.indexOf(account);
        if (index < 0) return null;
        const received = (tx.meta.postBalances[index] || 0) - (tx.meta.preBalances[index] || 0);
        if (received <= 0) return null;
        return {
          id: sig.signature,
          value: received,
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

const SOURCES = { btc: fetchBtc, sol: fetchSol };
const TRACKED = new Set(Object.keys(SOURCES));

/* ---------------- эффекты ---------------- */

function playTier(tier, value) {
  if (reduced) return;
  const target = $(".pay:not([hidden]) .pay-body") || document.body;
  const rect = target.getBoundingClientRect();
  const x = rect.left + rect.width / 2;
  const y = rect.top + rect.height / 2;

  if (value >= (tier?.min ?? 0) * 4) {
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

/* Пороги показываем в сатошах для BTC: десятичная запись настолько мелких
   порогов нечитаема. Для остальных сетей единица измерения — сама монета. */
const TIER_UNITS = { btc: "сат", xmr: "XMR", sol: "SOL" };

function renderTiers(currency) {
  const unit = TIER_UNITS[currency] || CURRENCIES[currency].code;
  const display = (value) =>
    unit === "сат" ? nf.format(value) : fmt(currency, value);
  el.tiers.innerHTML = (TIERS[currency] || [])
    .map(
      (t) => `<li class="tier">
        <span class="t-amount">от ${display(t.min)}
          <span class="sat">${unit}</span></span>
        <span class="t-note">${t.note}</span>
      </li>`
    )
    .join("");
}

function renderProgress(currency, rows) {
  const goal = GOALS[currency];
  const total = rows.reduce((sum, row) => sum + row.value, 0);
  const percent = Math.min(100, (total / goal) * 100);

  el.totalAmount.textContent = fmt(currency, total);
  el.totalUnit.textContent = CURRENCIES[currency].code;
  const usd = window.prices?.[currency];
  el.totalUsd.textContent =
    usd && total > 0 ? `≈ $${money((total / 10 ** CURRENCIES[currency].decimals) * usd)}` : "";
  el.bar.style.width = percent.toFixed(percent < 10 ? 2 : 0) + "%";
  el.goalText.textContent =
    `цель ${fmt(currency, goal)} ${CURRENCIES[currency].code} · ${percent.toFixed(percent < 10 ? 2 : 0)}%`;
  el.supporters.textContent = nf.format(rows.length);
}

function render(currency, rows) {
  const tracked = TRACKED.has(currency);
  el.progress.hidden = !tracked;
  el.feed.hidden = !tracked;
  el.tiers.hidden = !tracked;
  el.untracked.hidden = tracked;

  el.trackTitle.textContent = tracked
    ? "Что происходит после перевода"
    : "Почему здесь нет ленты";
  el.trackLede.textContent = tracked
    ? `Страница проверяет адрес каждые 30 секунд. Как только транзакция появится
       в сети, здесь появится запись, а сумма определит эффект.`
    : `Проверить баланс можно по адресу в проверенном обозревателе.`;

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

let current = "btc";

async function poll() {
  if (!TRACKED.has(current)) return;
  const currency = current;
  let rows = [];
  try {
    rows = await SOURCES[currency](addressOf(currency));
  } catch {
    setStatus("offline", "Нет связи с обозревателем");
    return;
  }
  if (currency !== current) return;
  setStatus("ok", "Отслеживание работает");

  rows.sort((a, b) => (b.time || 0) - (a.time || 0));

  const fresh = rows.filter((row) => !seen[currency].has(row.id));
  if (fresh.length) {
    fresh.forEach((row) => seen[currency].add(row.id));
    try {
      localStorage.setItem(
        seenKey(currency),
        JSON.stringify([...seen[currency]].slice(-500))
      );
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
  seen = { btc: new Set(), sol: new Set(), xmr: new Set() };
  firstRun = {};

  for (const c of ["btc", "sol"]) {
    try {
      seen[c] = new Set(JSON.parse(localStorage.getItem(seenKey(c)) || "[]"));
    } catch {}
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

let ready = false;

window.Tracker = {
  select(currency) {
    current = currency;
    if (!ready) return;
    render(currency, TRACKED.has(currency) ? lastRows[currency] : []);
    if (TRACKED.has(currency)) poll();
  },
  pricesChanged() {
    if (!ready || !TRACKED.has(current)) return;
    renderProgress(current, lastRows[current]);
  },
};
})();
