// Decorative background animation: small chess glyphs drift downward like
// snowflakes. Pure DOM + CSS so it costs essentially nothing and doesn't
// interact with the Pixi canvas.

const PIECES = ["♔", "♕", "♖", "♗", "♘", "♙", "♚", "♛", "♜", "♝", "♞", "♟"];

const SPAWN_INTERVAL_MS = 650;
const MAX_ACTIVE = 28;

let spawnTimer = null;
let containerEl = null;
let activeCount = 0;

function spawnOne() {
  if (!containerEl || activeCount >= MAX_ACTIVE) return;

  const wrap = document.createElement("span");
  wrap.className = "snowflake";
  const glyph = document.createElement("span");
  glyph.className = "snowflake-glyph";
  glyph.textContent = PIECES[(Math.random() * PIECES.length) | 0];
  wrap.appendChild(glyph);

  const size = 24 + Math.random() * 22;
  const fallDuration = 11 + Math.random() * 14;
  const swayDuration = 2.5 + Math.random() * 2.5;
  const swayDelay = -Math.random() * swayDuration;

  wrap.style.left = Math.random() * 100 + "%";
  wrap.style.fontSize = size.toFixed(1) + "px";
  wrap.style.opacity = (0.1 + Math.random() * 0.22).toFixed(2);
  wrap.style.animationDuration = fallDuration.toFixed(2) + "s";
  glyph.style.animationDuration = swayDuration.toFixed(2) + "s";
  glyph.style.animationDelay = swayDelay.toFixed(2) + "s";

  containerEl.appendChild(wrap);
  activeCount++;
  wrap.addEventListener("animationend", () => {
    wrap.remove();
    activeCount--;
  });
}

export function startSnowfall(el) {
  if (spawnTimer) return;
  containerEl = el ?? document.getElementById("snowfall");
  if (!containerEl) return;
  // Seed a few so the screen isn't empty for the first second.
  for (let i = 0; i < 6; i++) spawnOne();
  spawnTimer = setInterval(spawnOne, SPAWN_INTERVAL_MS);
}

export function stopSnowfall() {
  if (spawnTimer) {
    clearInterval(spawnTimer);
    spawnTimer = null;
  }
  if (containerEl) {
    containerEl.innerHTML = "";
    activeCount = 0;
  }
}
