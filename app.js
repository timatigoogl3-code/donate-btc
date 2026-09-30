/* Валюты, адреса и ссылки. Суммы редактируются здесь. */
const CURRENCIES = {
  btc: {
    code: "BTC",
    name: "Bitcoin",
    decimals: 8,
    /* BIP-21 — сумма кодируется в ссылку, поддерживается кошельками */
    uri: (address, amount) => `bitcoin:${address}?amount=${amount}`,
    qrWithAmount: true,
  },
  xmr: {
    code: "XMR",
    name: "Monero",
    decimals: 12,
    /* Стандарта ссылки с суммой нет: только адрес */
    uri: (address) => `monero:${address}`,
    qrWithAmount: false,
  },
  sol: {
    code: "SOL",
    name: "Solana",
    decimals: 9,
    uri: (address) => `solana:${address}`,
    qrWithAmount: false,
  },
  eth: {
    code: "ETH",
    name: "Ethereum",
    decimals: 18,
    /* EIP-681: базовая форма без суммы */
    uri: (address) => `ethereum:${address}`,
    qrWithAmount: false,
  },
};

const PRICE_IDS = { btc: "bitcoin", xmr: "monero", sol: "solana", eth: "ethereum" };
const seenKey = (currency) => `donate.seen.${currency}.v1`;

/* tracker.js читает курсы напрямую */
window.prices = {};

let active = "btc";
const prices = {};

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const addressOf = (c) => $(`[data-address="${c}"]`).textContent.trim();
const amountOf = (c) => $(`[data-amount="${c}"]`).textContent.trim();
const state = (c) => Number(amountOf(c)) * 10 ** CURRENCIES[c].decimals;

const nf = new Intl.NumberFormat("ru-RU");
const money = (value) =>
  value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/* ---------------- табы ---------------- */
const tabs = $$(".tab");
const panels = $$('[role="tabpanel"]');

function selectCurrency(id, { focusTab = false } = {}) {
  if (!CURRENCIES[id]) return;
  active = id;

  for (const tab of tabs) {
    const on = tab.dataset.currency === id;
    tab.setAttribute("aria-selected", String(on));
    tab.tabIndex = on ? 0 : -1;
    if (on && focusTab) tab.focus();
  }
  for (const panel of panels) panel.hidden = panel.id !== `panel-${id}`;

  location.hash = id;
  drawQR(id);
  renderUsd(id);
  window.Tracker?.select(id);
}

tabs.forEach((tab, index) => {
  tab.addEventListener("click", () => selectCurrency(tab.dataset.currency));
  tab.addEventListener("keydown", (event) => {
    const keys = { ArrowRight: 1, ArrowLeft: -1, Home: "first", End: "last" };
    const step = keys[event.key];
    if (step === undefined) return;
    event.preventDefault();
    const next =
      step === "first" ? 0
      : step === "last" ? tabs.length - 1
      : (index + step + tabs.length) % tabs.length;
    selectCurrency(tabs[next].dataset.currency, { focusTab: true });
  });
});

/* ---------------- тост, копирование ---------------- */
const toast = $("#toast");

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove("show"), 2200);
}

async function copyText(text, label, button) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const field = document.createElement("textarea");
    field.value = text;
    field.style.position = "fixed";
    field.style.opacity = "0";
    document.body.appendChild(field);
    field.select();
    document.execCommand("copy");
    field.remove();
  }
  if (button) {
    const original = button.textContent;
    button.textContent = "Скопировано";
    setTimeout(() => (button.textContent = original), 1600);
  }
  showToast(label);
}

for (const button of $$("[data-copy]")) {
  button.addEventListener("click", () => {
    const c = button.dataset.copy;
    copyText(addressOf(c), "Адрес скопирован", button);
  });
}

/* ---------------- QR ---------------- */
const qrWithAmount = { btc: true, xmr: false, sol: false };

function qrPayload(c) {
  const config = CURRENCIES[c];
  return qrWithAmount[c] ? config.uri(addressOf(c), amountOf(c)) : addressOf(c);
}

function drawQR(c) {
  const slot = $(`[data-qr="${c}"]`);
  if (!slot) return;
  if (typeof QRCode === "undefined") {
    slot.innerHTML = '<span class="qr-fallback">QR недоступен</span>';
    return;
  }
  const canvas = document.createElement("canvas");
  QRCode.toCanvas(canvas, qrPayload(c), {
    width: 148,
    margin: 0,
    color: { dark: "#1b1917", light: "#ffffff" },
  })
    .then(() => slot.replaceChildren(canvas))
    .catch(() => (slot.innerHTML = '<span class="qr-fallback">QR недоступен</span>'));
}

for (const button of $$("[data-qr-toggle]")) {
  button.addEventListener("click", () => {
    const c = button.dataset.qrToggle;
    qrWithAmount[c] = !qrWithAmount[c];
    button.textContent = qrWithAmount[c]
      ? "Показать адрес без суммы"
      : "Показать адрес с суммой";
    drawQR(c);
  });
}

/* ---------------- ссылки для кошелька ---------------- */
for (const c of Object.keys(CURRENCIES)) {
  const link = $(`[data-uri="${c}"]`);
  if (link) link.href = CURRENCIES[c].uri(addressOf(c), amountOf(c));
}

/* ---------------- курсы ---------------- */
async function loadPrices() {
  try {
    const response = await fetch(
      "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,monero,solana,ethereum&vs_currencies=usd",
      { cache: "no-store" }
    );
    if (response.ok) {
      const data = await response.json();
      for (const [c, id] of Object.entries(PRICE_IDS)) {
        if (data[id]?.usd) prices[c] = data[id].usd;
      }
    }
  } catch {}

  for (const c of Object.keys(CURRENCIES)) {
    if (prices[c]) continue;
    try {
      const response = await fetch(
        `https://api.coinbase.com/v2/prices/${CURRENCIES[c].code}-USD/spot`,
        { cache: "no-store" }
      );
      if (!response.ok) continue;
      const data = await response.json();
      const value = Number(data?.data?.amount);
      if (isFinite(value) && value > 0) prices[c] = value;
    } catch {}
  }

  for (const c of Object.keys(CURRENCIES)) renderUsd(c);
  window.Tracker?.pricesChanged();
}

function renderUsd(c) {
  const cell = $(`[data-usd="${c}"]`);
  if (!cell) return;
  const usd = prices[c];
  cell.textContent = usd ? `$${money(Number(amountOf(c)) * usd)}` : "—";
}

document.addEventListener("DOMContentLoaded", () => {
  /* курсы грузим до переключения вкладки: Tracker может быть ещё не готов */
  loadPrices();
  const fromHash = location.hash.replace("#", "");
  selectCurrency(CURRENCIES[fromHash] ? fromHash : "btc");
  setInterval(loadPrices, 60_000);
  window.addEventListener("hashchange", () => {
    const id = location.hash.replace("#", "");
    if (CURRENCIES[id] && id !== active) selectCurrency(id);
  });
});
