const ADDRESS = "bc1qx4wlpqvlp46rf25w7vlej267ux6k0k8dl775gm";
const AMOUNT_BTC = "0.0005";

const qrEl = document.getElementById("qr");
const qrToggle = document.getElementById("qrToggle");
const copyBtn = document.getElementById("copyAddr");
const usdEl = document.getElementById("usd");
const toast = document.getElementById("toast");

// BIP-21 ссылка: открывает кошелёк с уже подставленной суммой
document.getElementById("payLink").href = `bitcoin:${ADDRESS}?amount=${AMOUNT_BTC}`;

function showToast(msg) {
  toast.textContent = msg;
  toast.classList.add("show");
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => toast.classList.remove("show"), 2200);
}

async function copy(text, label) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
  }
  copyBtn.classList.add("done");
  copyBtn.textContent = "скопировано";
  setTimeout(() => {
    copyBtn.classList.remove("done");
    copyBtn.textContent = "копировать";
  }, 1600);
  showToast(label);
}

copyBtn.addEventListener("click", () => copy(ADDRESS, "Адрес скопирован"));
document.querySelector(".addr").addEventListener("click", (e) => {
  if (e.target.closest("button")) return;
  copy(ADDRESS, "Адрес скопирован");
});

// --- QR-код ---
function renderQR(text) {
  if (typeof QRCode === "undefined") {
    qrEl.classList.add("empty");
    qrEl.textContent = "QR недоступен";
    return;
  }
  qrEl.classList.remove("empty");
  qrEl.innerHTML = "";
  QRCode.toCanvas(qrEl.appendChild(document.createElement("canvas")), text, {
    width: 188,
    margin: 0,
    color: { dark: "#07090f", light: "#ffffff" },
  });
}

renderQR(`bitcoin:${ADDRESS}?amount=${AMOUNT_BTC}`);
qrToggle.addEventListener("click", () => {
  renderQR(ADDRESS);
  qrToggle.textContent = "QR с суммой";
  qrToggle.onclick = () => {
    renderQR(`bitcoin:${ADDRESS}?amount=${AMOUNT_BTC}`);
    qrToggle.textContent = "Показать адрес";
  };
});

// --- Курс BTC/USD ---
async function loadPrice() {
  const providers = [
    "https://api.coinbase.com/v2/prices/BTC-USD/spot",
    "https://blockchain.info/ticker?currencies=USD",
  ];
  for (const url of providers) {
    try {
      const r = await fetch(url, { cache: "no-store" });
      if (!r.ok) throw new Error(r.status);
      const d = await r.json();
      const usd = Number(d?.data?.amount ?? d?.USD?.last);
      if (typeof usd === "number" && isFinite(usd)) {
        const total = usd * 0.0005;
        usdEl.textContent =
          total >= 1
            ? `$${total.toLocaleString("en-US", { maximumFractionDigits: 2 })}`
            : `$${total.toFixed(2)}`;
        return;
      }
    } catch {}
  }
  usdEl.textContent = "—";
}
loadPrice();
setInterval(loadPrice, 60000);
