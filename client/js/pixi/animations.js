// Tiny tween helper: drives interpolations off the Pixi ticker so they
// stay in lockstep with the renderer.

const tweens = new Set();

export function startTweenSystem(app) {
  app.ticker.add((ticker) => {
    const dt = ticker.deltaMS / 1000;
    for (const t of tweens) {
      t.elapsed += dt;
      const k = Math.min(1, t.elapsed / t.duration);
      const eased = ease(t.easing, k);
      t.onUpdate(eased);
      if (k >= 1) {
        tweens.delete(t);
        t.onComplete?.();
      }
    }
  });
}

function ease(name, k) {
  switch (name) {
    case 'easeOutCubic': return 1 - Math.pow(1 - k, 3);
    case 'easeOutQuart': return 1 - Math.pow(1 - k, 4);
    case 'easeInOutCubic':
      return k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
    case 'linear':
    default:
      return k;
  }
}

/**
 * Generic tween. onUpdate gets the eased progress 0..1.
 * Returns a promise that resolves on completion.
 */
export function tween({ duration, easing = 'easeOutCubic', onUpdate, onComplete }) {
  return new Promise((resolve) => {
    tweens.add({
      duration,
      easing,
      elapsed: 0,
      onUpdate,
      onComplete: () => { onComplete?.(); resolve(); },
    });
  });
}

/**
 * Slide a sprite from (x0,y0) to (x1,y1). If knightArc is true, lift the
 * sprite along a parabolic Y curve so the L-shape reads even on short moves.
 */
export function slidePiece(sprite, from, to, durationMs = 180, { knightArc = false } = {}) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  return tween({
    duration: durationMs / 1000,
    easing: 'easeOutCubic',
    onUpdate: (k) => {
      sprite.x = from.x + dx * k;
      sprite.y = from.y + dy * k;
      if (knightArc) {
        const arc = -50 * Math.sin(Math.PI * k); // negative = upward
        sprite.y += arc;
      }
    },
  });
}

/** Capture animation: scale → 0 with fade-out. */
export function fadeAndShrink(sprite, durationMs = 200) {
  const startScale = sprite.scale.x;
  return tween({
    duration: durationMs / 1000,
    easing: 'easeOutCubic',
    onUpdate: (k) => {
      sprite.scale.set(startScale * (1 - k));
      sprite.alpha = 1 - k;
    },
  });
}

/** Pickup pulse: scale up to a target, used when grabbing a piece. */
export function scaleTo(sprite, targetScale, durationMs = 120) {
  const start = sprite.scale.x;
  return tween({
    duration: durationMs / 1000,
    easing: 'easeOutCubic',
    onUpdate: (k) => sprite.scale.set(start + (targetScale - start) * k),
  });
}
