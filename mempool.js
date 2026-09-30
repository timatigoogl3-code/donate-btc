/* Отслеживание входящих транзакций через публичный mempool.space API
   + тир-эффекты в зависимости от суммы доната.
   IIFE — чтобы не конфликтовать с app.js (там тоже есть ADDRESS). */
(function () {
const TIERS = [
  { sats: 1_000_000, key: "legend",  name: "ЛЕГЕНДА",  fx: "mega",   msg: "Вот этоpower! Такие донаты запоминаются надолго 🔥" },
  { sats: 250_000,   key: "titan",   name: "ТИТАН",    fx: "epic",   msg: "Огромное спасибо, это дорогого стоит! 💎" },
  { sats: 50_000,    key: "whale",   name: "КИТ",      fx: "big",    msg: "Спасибо огромное! Продолжаю работать 🚀" },
  { sats: 10_000,    key: "captain", name: "КАПИТАН",  fx: "mid",    msg: "Спасибо, очень приятно! ⭐" },
  { sats: 1_000,     key: "supporter", name: "ДРУГ",   fx: "small",  msg: "Спасибо за поддержку! ☕" },
  { sats: 1,         key: "dust",    name: "ПЫЛЬ",     fx: "tiny",   msg: "Даже мелочь радует. Спасибо! ✨" },
];

const GOAL_SATS = 5_000_000; // цель сбора: 0.05 BTC
const ADDRESS = "bc1qx4wlpqvlp46rf25w7vlej267ux6k0k8dl775gm";
const API = `https://mempool.space/api/address/${ADDRESS}`;
const LS_SEEN = "dbtc.seen.v1";

const fmtBtc = (sats) => (sats / 1e8).toFixed(8).replace(/0+$/, "").replace(/\.$/, ".0");
const fmtSats = (s) => new Intl.NumberFormat("ru-RU").format(Math.round(s));

function tierFor(sats) {
  return TIERS.find((t) => sats >= t.sats) || TIERS[TIERS.length - 1];
}

function playFx(fx, el) {
  const box = el || document.querySelector(".card");
  const r = box ? box.getBoundingClientRect() : { left: 0, top: 0, width: innerWidth, height: innerHeight };
  const cx = r.left + r.width / 2, cy = r.top + r.height / 3;
  switch (fx) {
    case "mega":
      FX.rainbowFlash(); FX.coinRain(34); FX.confetti(240);
      setTimeout(() => FX.fireworks(4), 350); FX.fanfare();
      break;
    case "epic":
      FX.fireworks(3); FX.coinRain(18); FX.confetti(180); FX.fanfare();
      break;
    case "big":
      FX.fireworks(2); FX.confetti(140); FX.fanfare();
      break;
    case "mid":
      FX.confetti(110); FX.blip(880, 0.14); FX.spark(cx, cy, "#ffb454", 0.8);
      break;
    case "small":
      FX.confetti(70); FX.blip(660, 0.12);
      break;
    default:
      FX.blip(520, 0.1);
  }
}

class Tracker {
  constructor(els) {
    this.els = els;
    this.seen = new Set(JSON.parse(localStorage.getItem(LS_SEEN) || "[]"));
    this.firstRun = this.seen.size === 0;
    this.price = null;
    this.timers = [];
  }

  async loadPrice() {
    try {
      const r = await fetch("https://api.coinbase.com/v2/prices/BTC-USD/spot", { cache: "no-store" });
      const d = await r.json();
      this.price = Number(d?.data?.amount) || null;
    } catch {}
  }

  /* Сумма, зачисленная на адрес (только входящие) */
  receivedIn(tx) {
    return (tx.vout || [])
      .filter((o) => o.scriptpubkey_address === ADDRESS)
      .reduce((s, o) => s + (o.value || 0), 0);
  }

  async poll() {
    let txs = [];
    try {
      const r = await fetch(`${API}/txs`, { cache: "no-store" });
      if (!r.ok) throw new Error(r.status);
      txs = await r.json();
    } catch {
      this.setStatus("offline");
      return;
    }
    this.setStatus("ok");

    const fresh = [];
    for (const tx of txs) {
      const sats = this.receivedIn(tx);
      if (sats <= 0) continue;
      if (this.seen.has(tx.txid)) continue;
      this.seen.add(tx.txid);
      fresh.push({ tx, sats });
    }
    if (fresh.length) localStorage.setItem(LS_SEEN, JSON.stringify([...this.seen].slice(-500)));

    fresh.sort((a, b) => (b.tx.status?.block_time || 0) - (a.tx.status?.block_time || 0));

    // при первом запуске не кричим конфетти на старых транзакциях
    if (!this.firstRun) for (const f of fresh) this.celebrate(f);
    this.firstRun = false;

    this.render(txs);
  }

  celebrate({ tx, sats }) {
    const tier = tierFor(sats);
    const confirmed = !!tx.status?.confirmed;
    const el = this.els.banner;
    el.className = "thanks " + tier.key;
    el.innerHTML = `
      <div class="thanks-top">
        <span class="badge">${tier.name}</span>
        <span class="thanks-amt">+${fmtBtc(sats)} BTC</span>
        <span class="dot">•</span>
        <span class="thanks-sub">${confirmed ? "подтверждено" : "в mempool"}</span>
      </div>
      <p class="thanks-msg">${tier.msg}</p>
      <a class="thanks-tx" target="_blank" rel="noopener"
         href="https://mempool.space/tx/${tx.txid}">${tx.txid.slice(0, 18)}… →</a>`;
    el.classList.add("show");
    clearTimeout(this._bt);
    this._bt = setTimeout(() => el.classList.remove("show"), 15000);

    playFx(tier.fx);
    this.els.pulse.classList.remove("pulse");
    void this.els.pulse.offsetWidth;
    this.els.pulse.classList.add("pulse");
  }

  render(txs) {
    const rows = txs
      .map((tx) => ({ tx, sats: this.receivedIn(tx) }))
      .filter((r) => r.sats > 0)
      .sort((a, b) => (b.tx.status?.block_time || 0) - (a.tx.status?.block_time || 0))
      .slice(0, 8);

    const total = rows.reduce((s, r) => s + r.sats, 0);
    this.els.total.textContent = `${fmtBtc(total)} BTC`;
    this.els.count.textContent = rows.length;
    if (this.price != null) {
      const usd = (total / 1e8) * this.price;
      this.els.totalUsd.textContent =
        usd > 0 ? `≈ $${usd.toLocaleString("en-US", { maximumFractionDigits: 2 })}` : "";
    }

    const pct = Math.min(100, (total / GOAL_SATS) * 100);
    this.els.bar.style.width = pct.toFixed(2) + "%";
    this.els.goal.textContent = `цель ${(GOAL_SATS / 1e8).toFixed(2)} BTC · ${pct.toFixed(pct < 10 ? 2 : 0)}%`;

    this.els.list.innerHTML = rows.length
      ? rows
          .map(({ tx, sats }) => {
            const t = tierFor(sats);
            const time = tx.status?.block_time
              ? new Date(tx.status.block_time * 1000).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })
              : "ожидает";
            const conf = tx.status?.confirmed ? "" : ' class="pending"';
            return `<li${conf}>
              <span class="l-amt">+${fmtBtc(sats)} BTC</span>
              <span class="l-tier">${t.name}</span>
              <span class="l-time">${time}</span>
              <a href="https://mempool.space/tx/${tx.txid}" target="_blank" rel="noopener">tx</a>
            </li>`;
          })
          .join("")
      : `<li class="empty">Пока нет транзакций — будь первым!</li>`;

    this.tiersUI();
  }

  tiersUI() {
    if (this.els.tiers.dataset.done) return;
    this.els.tiers.innerHTML = TIERS.slice().reverse()
      .map(
        (t) => `<div class="tier">
          <span class="t-amt">${fmtSats(t.sats)}+ сат</span>
          <span class="t-name">${t.name}</span>
          <span class="t-msg">${t.msg}</span>
        </div>`
      )
      .join("");
    this.els.tiers.dataset.done = "1";
  }

  setStatus(s) {
    const d = this.els.status;
    d.textContent = s === "ok" ? "мониторинг активен" : "нет соединения с mempool.space";
    d.className = "status " + s;
  }

  start() {
    this.loadPrice();
    this.poll();
    this.timers.push(setInterval(() => this.poll(), 30000));
    this.timers.push(setInterval(() => this.loadPrice(), 60000));
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) this.poll();
    });
  }
}

window.addEventListener("DOMContentLoaded", () => {
  const tracker = new Tracker({
    banner: document.getElementById("thanks"),
    list: document.getElementById("feed"),
    total: document.getElementById("totalBtc"),
    totalUsd: document.getElementById("totalUsd"),
    count: document.getElementById("supporters"),
    bar: document.getElementById("bar"),
    goal: document.getElementById("goal"),
    tiers: document.getElementById("tiers"),
    status: document.getElementById("status"),
    pulse: document.getElementById("liveDot"),
  });
  const soundBtn = document.getElementById("soundToggle");
  soundBtn.addEventListener("click", () => {
    const on = soundBtn.dataset.on === "1";
    soundBtn.dataset.on = on ? "0" : "1";
    soundBtn.setAttribute("aria-pressed", String(!on));
    soundBtn.textContent = on ? "выключен" : "включён";
    if (!on) { try { new (window.AudioContext || window.webkitAudioContext)().resume(); } catch {} FX.blip(760, .1, "sine", .04); }
  });

  tracker.start();
  window.tracker = tracker;
});
})();
