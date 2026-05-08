import { Graphics, Text, Container } from 'pixi.js';

export const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
export const RANKS = ['1', '2', '3', '4', '5', '6', '7', '8'];

const LIGHT = 0xe9d8b6;
const DARK = 0x8a6a4a;

/**
 * The board renders into an 800×800 logical coordinate space, then we let
 * the parent layer scale it down to the canvas size. squareSize is fixed
 * at 100 for math simplicity.
 */
export const BOARD_LOGICAL_SIZE = 800;
export const SQUARE_SIZE = BOARD_LOGICAL_SIZE / 8;

export class Board {
  constructor(layer) {
    this.container = new Container({ label: 'boardSquares' });
    this.coordContainer = new Container({ label: 'coords' });
    layer.addChild(this.container, this.coordContainer);

    this.flipped = false;
    this.squareGraphics = new Map(); // 'e4' -> Graphics

    this.draw();
  }

  draw() {
    this.container.removeChildren();
    this.coordContainer.removeChildren();
    this.squareGraphics.clear();

    for (let r = 0; r < 8; r++) {
      for (let f = 0; f < 8; f++) {
        const algebraic = FILES[f] + RANKS[7 - r];
        const isLight = (r + f) % 2 === 0;
        const color = isLight ? LIGHT : DARK;

        const g = new Graphics()
          .rect(f * SQUARE_SIZE, r * SQUARE_SIZE, SQUARE_SIZE, SQUARE_SIZE)
          .fill({ color });

        this.container.addChild(g);
        this.squareGraphics.set(algebraic, g);
      }
    }

    // Coordinate labels along left edge (ranks) and bottom (files).
    for (let r = 0; r < 8; r++) {
      const rank = this.flipped ? RANKS[r] : RANKS[7 - r];
      const t = new Text({
        text: rank,
        style: { fontFamily: 'system-ui', fontSize: 14, fill: 0x000000 },
      });
      t.alpha = 0.45;
      t.position.set(4, r * SQUARE_SIZE + 4);
      this.coordContainer.addChild(t);
    }
    for (let f = 0; f < 8; f++) {
      const file = this.flipped ? FILES[7 - f] : FILES[f];
      const t = new Text({
        text: file,
        style: { fontFamily: 'system-ui', fontSize: 14, fill: 0x000000 },
      });
      t.alpha = 0.45;
      t.position.set(f * SQUARE_SIZE + SQUARE_SIZE - 14, BOARD_LOGICAL_SIZE - 18);
      this.coordContainer.addChild(t);
    }
  }

  setFlipped(flipped) {
    this.flipped = flipped;
    this.draw();
  }

  /** algebraic ('e4') → {x,y} center in the board's logical coordinates. */
  squareCenter(algebraic) {
    const file = FILES.indexOf(algebraic[0]);
    const rank = RANKS.indexOf(algebraic[1]);
    const f = this.flipped ? 7 - file : file;
    const r = this.flipped ? rank : 7 - rank;
    return {
      x: f * SQUARE_SIZE + SQUARE_SIZE / 2,
      y: r * SQUARE_SIZE + SQUARE_SIZE / 2,
    };
  }

  /** Pointer position in board-local coords → algebraic, or null if off-board. */
  pointToSquare(x, y) {
    if (x < 0 || y < 0 || x >= BOARD_LOGICAL_SIZE || y >= BOARD_LOGICAL_SIZE) return null;
    const f = Math.floor(x / SQUARE_SIZE);
    const r = Math.floor(y / SQUARE_SIZE);
    const file = this.flipped ? 7 - f : f;
    const rank = this.flipped ? r : 7 - r;
    return FILES[file] + RANKS[rank];
  }
}

/**
 * The board, highlights, pieces, and effects layers all share a single
 * "board space" transform (the boardRoot). We scale it to fit the canvas
 * on every resize via fitBoardToScreen.
 */
export function fitBoardToScreen(app, boardRoot) {
  const w = app.screen.width;
  const h = app.screen.height;
  const size = Math.min(w, h);
  const scale = size / BOARD_LOGICAL_SIZE;
  boardRoot.scale.set(scale);
  boardRoot.position.set((w - size) / 2, (h - size) / 2);
}
