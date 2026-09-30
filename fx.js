/* Эффекты. Приглушённая палитра из токенов страницы,
   без эмодзи и без радужных вспышек. Уважает prefers-reduced-motion. */
const FX = (() => {
  const canvas = document.getElementById("fx");
  const ctx = canvas.getContext("2d");
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const COLORS = ["#ed8300", "#fa9700", "#db7400", "#b36200", "#9e5e04", "#807a72"];
  let W = 0, H = 0, parts = [], frame = null;

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = canvas.clientWidth;
    H = canvas.clientHeight;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  window.addEventListener("resize", resize);
  resize();

  function add(p) { parts.push(p); }

  /* Мелкие бумажные прямоугольники — единственный базовый эффект */
  function confetti(count = 90) {
    if (reduced) return;
    for (let i = 0; i < count; i++) {
      add({
        kind: "paper",
        x: Math.random() * W,
        y: -12 - Math.random() * H * 0.4,
        w: 5 + Math.random() * 5,
        h: 3 + Math.random() * 4,
        vy: 1.6 + Math.random() * 2.4,
        vx: -1.1 + Math.random() * 2.2,
        rot: Math.random() * Math.PI,
        vr: -0.1 + Math.random() * 0.2,
        color: COLORS[(Math.random() * COLORS.length) | 0],
        life: 220,
      });
    }
    start();
  }

  /* Расходящиеся точки — для крупных сумм */
  function burst(x, y, color, power = 1) {
    if (reduced) return;
    const count = Math.round(28 * power);
    for (let i = 0; i < count; i++) {
      const angle = (Math.PI * 2 * i) / count;
      const speed = 1.8 + Math.random() * 2.6 * power;
      add({
        kind: "spark",
        x, y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        r: 1.2 + Math.random() * 1.4,
        color,
        life: 40,
      });
    }
    start();
  }

  function draw() {
    ctx.clearRect(0, 0, W, H);
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i];
      p.x += p.vx;
      p.y += p.vy;
      p.life--;

      if (p.kind === "paper") {
        p.vy += 0.035;
        p.rot += p.vr;
        p.vx *= 0.995;
      } else {
        p.vx *= 0.93;
        p.vy = p.vy * 0.93 + 0.1;
      }

      ctx.save();
      ctx.globalAlpha = Math.max(0, Math.min(1, p.life / 36));
      ctx.translate(p.x, p.y);
      if (p.kind === "spark") {
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(0, 0, p.r, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.rotate(p.rot);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      }
      ctx.restore();

      if (p.life <= 0 || p.y > H + 40) parts.splice(i, 1);
    }
    if (parts.length) {
      frame = requestAnimationFrame(draw);
    } else {
      frame = null;
      ctx.clearRect(0, 0, W, H);
    }
  }

  function start() { if (!frame) frame = requestAnimationFrame(draw); }

  let audio = null;
  function tone(freq, duration = 0.14, gain = 0.04) {
    if (document.getElementById("soundToggle")?.getAttribute("aria-checked") !== "true") return;
    try {
      audio = audio || new (window.AudioContext || window.webkitAudioContext)();
      const osc = audio.createOscillator();
      const vol = audio.createGain();
      osc.type = "triangle";
      osc.frequency.value = freq;
      vol.gain.setValueAtTime(gain, audio.currentTime);
      vol.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + duration);
      osc.connect(vol).connect(audio.destination);
      osc.start();
      osc.stop(audio.currentTime + duration);
    } catch {}
  }
  function chord() {
    [523.25, 659.25, 783.99].forEach((f, i) => setTimeout(() => tone(f, 0.18), i * 90));
  }

  return { confetti, burst, tone, chord, reduced };
})();
