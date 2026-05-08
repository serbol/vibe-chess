import { Graphics, Container } from 'pixi.js';
import { SQUARE_SIZE } from './board.js';

/**
 * Highlights layer: last-move overlays, legal-move dots, and the check
 * glow under a king. All highlights are children of the board-space root,
 * so they share the same transform.
 */
export class Highlights {
  constructor(layer, board) {
    this.layer = layer;
    this.board = board;

    this.lastMoveGfx = new Container({ label: 'lastMove' });
    this.legalDotsGfx = new Container({ label: 'legal' });
    this.checkGlowGfx = new Container({ label: 'checkGlow' });
    layer.addChild(this.lastMoveGfx, this.legalDotsGfx, this.checkGlowGfx);

    this.checkPulseT = 0;
    this.lastMoveAlpha = 0;
  }

  setLastMove(from, to, color) {
    this.lastMoveGfx.removeChildren();
    if (!from || !to) return;
    const tint = color === 'white' ? 0xf6c177 : 0x6aa2f1;
    for (const sq of [from, to]) {
      const center = this.board.squareCenter(sq);
      const g = new Graphics()
        .rect(center.x - SQUARE_SIZE / 2, center.y - SQUARE_SIZE / 2, SQUARE_SIZE, SQUARE_SIZE)
        .fill({ color: tint, alpha: 0.28 });
      this.lastMoveGfx.addChild(g);
    }
    this.lastMoveAlpha = 1;
    this.lastMoveGfx.alpha = 1;
  }

  /** moves: array of { to, isCapture } */
  setLegalMoves(moves) {
    this.legalDotsGfx.removeChildren();
    for (const m of moves) {
      const { x, y } = this.board.squareCenter(m.to);
      const g = new Graphics();
      if (m.isCapture) {
        g.circle(x, y, SQUARE_SIZE * 0.42)
          .stroke({ color: 0xef6c6c, width: 6, alpha: 0.7 });
      } else {
        g.circle(x, y, SQUARE_SIZE * 0.16)
          .fill({ color: 0x000000, alpha: 0.32 });
      }
      this.legalDotsGfx.addChild(g);
    }
  }

  clearLegalMoves() {
    this.legalDotsGfx.removeChildren();
  }

  /** algebraic of the king-in-check, or null to clear. */
  setCheckGlow(algebraic) {
    this.checkGlowGfx.removeChildren();
    if (!algebraic) return;
    const { x, y } = this.board.squareCenter(algebraic);
    const g = new Graphics();
    g.circle(0, 0, SQUARE_SIZE * 0.55).fill({ color: 0xff3030, alpha: 0.18 });
    g.circle(0, 0, SQUARE_SIZE * 0.42).fill({ color: 0xff5050, alpha: 0.28 });
    g.circle(0, 0, SQUARE_SIZE * 0.30).fill({ color: 0xff8080, alpha: 0.32 });
    g.position.set(x, y);
    this.checkGlowGfx.addChild(g);
  }

  /** Called every tick to fade the last-move overlay and pulse the check glow. */
  update(dtSeconds) {
    if (this.lastMoveAlpha > 0) {
      this.lastMoveAlpha = Math.max(0, this.lastMoveAlpha - dtSeconds * 0.4);
      this.lastMoveGfx.alpha = Math.max(0.5, this.lastMoveAlpha);
    }
    if (this.checkGlowGfx.children.length) {
      this.checkPulseT += dtSeconds;
      const pulse = 0.7 + Math.sin(this.checkPulseT * 6) * 0.3;
      this.checkGlowGfx.alpha = pulse;
    }
  }
}
