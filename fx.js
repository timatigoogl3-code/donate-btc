/* Лёгкие визуальные эффекты без внешних зависимостей */
const FX = (() => {
  const canvas = document.getElementById("fx");
  const ctx = canvas.getContext("2d");
  let W = 0, H = 0, dpr = 1, parts = [], raf = null;

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = canvas.clientWidth; H = canvas.clientHeight;
    canvas.width = W * dpr; canvas.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  window.addEventListener("resize", resize);
  resize();

  const COLORS = ["#f7931a", "#ffb454", "#3ddc97", "#7aa2ff", "#ff6b8b", "#ffffff"];

  function confetti(n = 140) {
    for (let i = 0; i < n; i++) {
      parts.push({
        kind: "confetti",
        x: Math.random() * W,
        y: -20 - Math.random() * H * 0.3,
        w: 6 + Math.random() * 7,
        h: 9 + Math.random() * 9,
        vy: 2 + Math.random() * 3.4,
        vx: -1.6 + Math.random() * 3.2,
        rot: Math.random() * Math.PI,
        vr: -0.14 + Math.random() * 0.28,
        color: COLORS[(Math.random() * COLORS.length) | 0],
        life: 260,
      });
    }
    start();
  }

  function coinRain(n = 26) {
    for (let i = 0; i < n; i++) {
      parts.push({
        kind: "coin",
        x: Math.random() * W,
        y: -30 - Math.random() * H,
        r: 9 + Math.random() * 9,
        vy: 1.6 + Math.random() * 2.2,
        vx: -0.6 + Math.random() * 1.2,
        rot: Math.random() * Math.PI,
        vr: -0.05 + Math.random() * 0.1,
        life: 300,
      });
    }
    start();
  }

  function spark(x, y, color, power = 1) {
    const count = Math.round(40 * power);
    for (let i = 0; i < count; i++) {
      const a = (Math.PI * 2 * i) / count + Math.random() * 0.2;
      const sp = 2.5 + Math.random() * 4 * power;
      parts.push({
        kind: "spark",
        x, y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        r: 1.4 + Math.random() * 2,
        color,
        life: 48,
      });
    }
    start();
  }

  function fireworks(count = 3) {
    for (let i = 0; i < count; i++) {
      const x = W * (0.2 + Math.random() * 0.6);
      const y = H * (0.2 + Math.random() * 0.4);
      setTimeout(() => spark(x, y, COLORS[(Math.random() * COLORS.length) | 0], 1), i * 260);
    }
  }

  function rainbowFlash() {
    const el = document.body;
    el.classList.add("flash");
    setTimeout(() => el.classList.remove("flash"), 1400);
  }

  function step() {
    ctx.clearRect(0, 0, W, H);
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i];
      p.x += p.vx; p.y += p.vy;
      if (p.kind === "confetti") { p.vy += 0.045; p.rot += p.vr; p.vx *= 0.995; }
      if (p.kind === "coin") { p.vy += 0.03; p.rot += p.vr; }
      if (p.kind === "spark") { p.vx *= 0.93; p.vy = p.vy * 0.93 + 0.12; }
      p.life--;

      ctx.save();
      ctx.globalAlpha = Math.max(0, Math.min(1, p.life / 40));
      if (p.kind === "spark") {
        ctx.fillStyle = p.color;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill();
      } else {
        ctx.translate(p.x, p.y); ctx.rotate(p.rot);
        if (p.kind === "confetti") {
          ctx.fillStyle = p.color;
          ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
        } else {
          ctx.fillStyle = "#f7931a";
          ctx.beginPath(); ctx.arc(0, 0, p.r, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = "#1a1206";
          ctx.font = `${Math.round(p.r * 1.1)}px sans-serif`;
          ctx.textAlign = "center"; ctx.textBaseline = "middle";
          ctx.fillText("₿", 0, 1);
        }
      }
      ctx.restore();

      if (p.life <= 0 || p.y > H + 60) parts.splice(i, 1);
    }
    if (parts.length) raf = requestAnimationFrame(step);
    else { raf = null; ctx.clearRect(0, 0, W, H); }
  }

  function start() { if (!raf) raf = requestAnimationFrame(step); }

  let audioCtx = null;
  function blip(freq = 880, dur = 0.16, type = "triangle", gain = 0.05) {
    if (document.getElementById("soundToggle")?.dataset.on !== "1") return;
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      const o = audioCtx.createOscillator(), g = audioCtx.createGain();
      o.type = type; o.frequency.value = freq;
      g.gain.setValueAtTime(gain, audioCtx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + dur);
      o.connect(g).connect(audioCtx.destination);
      o.start(); o.stop(audioCtx.currentTime + dur);
    } catch {}
  }
  function fanfare() {
    [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => blip(f, 0.2, "triangle", 0.06), i * 110));
  }

  return { confetti, coinRain, fireworks, spark, rainbowFlash, blip, fanfare };
})();
