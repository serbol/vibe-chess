import { Sprite, Text, Graphics } from 'pixi.js';
import { getPieceTexture } from './assets.js';
import { tween } from './animations.js';
import { SQUARE_SIZE, BOARD_LOGICAL_SIZE } from './board.js';

/**
 * Effects layer: capture particle bursts, screen shake, and the checkmate
 * sequence. We apply screen shake to the board root since shaking the entire
 * stage would shift the static DOM-style coordinate hits as well.
 */
export class Effects {
  constructor(app, layer, boardRoot) {
    this.app = app;
    this.layer = layer;
    this.boardRoot = boardRoot;
    this.shakeT = 0;
    this.shakeDuration = 0;
    this.shakeAmplitude = 0;
    this.baseX = boardRoot.position.x;
    this.baseY = boardRoot.position.y;
    this._lastTickerTime = 0;

    app.ticker.add((ticker) => {
      const dt = ticker.deltaMS / 1000;
      this._tickShake(dt);
    });
  }

  /** Update the resting position the boardRoot should settle back to. */
  syncBaseTransform() {
    if (this.shakeDuration === 0) {
      this.baseX = this.boardRoot.position.x;
      this.baseY = this.boardRoot.position.y;
    }
  }

  /** Burst of small spark particles at a square. */
  burstAt(algebraic, board, color = 0xffffff) {
    const center = board.squareCenter(algebraic);
    const COUNT = 22;
    for (let i = 0; i < COUNT; i++) {
      const s = new Sprite(getPieceTexture('__particle'));
      s.anchor.set(0.5);
      s.tint = color;
      s.alpha = 1;
      s.position.set(center.x, center.y);
      s.scale.set(0.25 + Math.random() * 0.15);

      const angle = (i / COUNT) * Math.PI * 2 + Math.random() * 0.4;
      const dist = SQUARE_SIZE * (0.5 + Math.random() * 0.6);
      const dx = Math.cos(angle) * dist;
      const dy = Math.sin(angle) * dist;

      this.layer.addChild(s);

      const startX = s.x;
      const startY = s.y;
      tween({
        duration: 0.55 + Math.random() * 0.3,
        easing: 'easeOutQuart',
        onUpdate: (k) => {
          s.x = startX + dx * k;
          s.y = startY + dy * k + 30 * k * k; // slight gravity
          s.alpha = 1 - k;
          s.scale.set(s.scale.x * 0.995);
        },
        onComplete: () => s.destroy(),
      });
    }
  }

  /** 4–6px shake with linear decay over ~200ms. */
  shake(amplitude = 6, durationMs = 200) {
    this.syncBaseTransform();
    this.shakeAmplitude = amplitude;
    this.shakeDuration = durationMs / 1000;
    this.shakeT = 0;
  }

  _tickShake(dt) {
    if (this.shakeDuration <= 0) return;
    this.shakeT += dt;
    const k = Math.min(1, this.shakeT / this.shakeDuration);
    const decay = 1 - k;
    const offsetX = (Math.random() * 2 - 1) * this.shakeAmplitude * decay;
    const offsetY = (Math.random() * 2 - 1) * this.shakeAmplitude * decay;
    this.boardRoot.position.set(this.baseX + offsetX, this.baseY + offsetY);
    if (k >= 1) {
      this.shakeDuration = 0;
      this.boardRoot.position.set(this.baseX, this.baseY);
    }
  }

  /** Big celebratory effect on checkmate. */
  async checkmate(loserKingSquare, board, winnerColor) {
    // Bigger, slower particle burst at the losing king.
    const tint = winnerColor === 'white' ? 0xf6c177 : 0x6aa2f1;
    for (let r = 0; r < 3; r++) {
      this.burstAt(loserKingSquare, board, tint);
      await new Promise((res) => setTimeout(res, 120));
    }

    // White flash overlay over the board, fading to transparent.
    const flash = new Graphics()
      .rect(0, 0, BOARD_LOGICAL_SIZE, BOARD_LOGICAL_SIZE)
      .fill({ color: 0xffffff });
    flash.alpha = 0;
    this.layer.addChild(flash);

    await tween({
      duration: 0.16,
      easing: 'easeOutCubic',
      onUpdate: (k) => (flash.alpha = k * 0.7),
    });
    await tween({
      duration: 0.5,
      easing: 'easeOutCubic',
      onUpdate: (k) => (flash.alpha = (1 - k) * 0.7),
      onComplete: () => flash.destroy(),
    });

    // Big "Checkmate" text scaling in.
    const text = new Text({
      text: 'Checkmate',
      style: {
        fontFamily: 'system-ui',
        fontSize: 96,
        fill: 0xffffff,
        stroke: { color: 0x000000, width: 6 },
        align: 'center',
      },
    });
    text.anchor.set(0.5);
    text.position.set(BOARD_LOGICAL_SIZE / 2, BOARD_LOGICAL_SIZE / 2);
    text.scale.set(0);
    text.alpha = 0;
    this.layer.addChild(text);

    await tween({
      duration: 0.55,
      easing: 'easeOutCubic',
      onUpdate: (k) => {
        text.scale.set(k);
        text.alpha = k;
      },
    });
  }
}
