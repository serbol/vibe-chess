import { Sprite, Container, Graphics, Text } from 'pixi.js';
import { getPieceTexture } from './assets.js';
import { FILES, RANKS, SQUARE_SIZE, BOARD_LOGICAL_SIZE } from './board.js';
import { fadeAndShrink, slidePiece } from './animations.js';

/**
 * Manages piece sprites mounted on the board. Owns drag-and-drop input,
 * which produces semantic events the host module handles:
 *
 *   onPickup(square)    — user grabbed a piece (host computes legal moves)
 *   onDrop(from, to)    — user dropped on a target (host emits the move)
 *   onPromotion(from,to,choice)
 *
 * Visual state is driven by setFromFen — pieces are rebuilt on every state
 * change for simplicity. For the move that triggered the change, callers
 * can call animateMove first, then setFromFen at the end.
 */
export class Pieces {
  constructor({ pieceLayer, dragLayer, board, getYourColor, getCurrentTurn, onPickup, onDrop, onPromotion }) {
    this.pieceLayer = pieceLayer;
    this.dragLayer = dragLayer;
    this.board = board;
    this.getYourColor = getYourColor;
    this.getCurrentTurn = getCurrentTurn;
    this.onPickup = onPickup;
    this.onDrop = onDrop;
    this.onPromotion = onPromotion;

    /** square -> Sprite */
    this.spriteAt = new Map();
    /** Sprite currently being dragged (or null). */
    this.dragSprite = null;
    this.dragOriginSquare = null;
    /** Sprite -> { homeX, homeY } baseline before drag. */
    this.dragHome = null;
    this.pointerOffset = { x: 0, y: 0 };
    /** lift on hover (sprite -> baseY). */
    this._hoveredSprite = null;

    this.promotionContainer = new Container({ label: 'promotion' });
    this.promotionContainer.visible = false;
    pieceLayer.addChild(this.promotionContainer);
  }

  /**
   * Rebuild all sprites from a FEN. We diff against the current set so that
   * pieces that didn't move keep their identity (and thus any in-flight tweens
   * aren't disrupted unnecessarily).
   */
  setFromFen(fen) {
    const placement = fen.split(' ')[0];
    const desired = new Map(); // square -> piece letter
    let rank = 8;
    for (const row of placement.split('/')) {
      let file = 0;
      for (const ch of row) {
        if (/[1-8]/.test(ch)) {
          file += parseInt(ch, 10);
        } else {
          const sq = FILES[file] + RANKS[rank - 1];
          desired.set(sq, ch);
          file += 1;
        }
      }
      rank -= 1;
    }

    // Remove sprites that no longer exist or whose piece changed.
    for (const [sq, sprite] of this.spriteAt) {
      const want = desired.get(sq);
      if (!want || sprite.__piece !== want) {
        this.pieceLayer.removeChild(sprite);
        sprite.destroy();
        this.spriteAt.delete(sq);
      }
    }

    // Add or move sprites.
    for (const [sq, letter] of desired) {
      let sprite = this.spriteAt.get(sq);
      if (!sprite) {
        sprite = this._createSprite(letter, sq);
        this.spriteAt.set(sq, sprite);
        this.pieceLayer.addChild(sprite);
      } else {
        const center = this.board.squareCenter(sq);
        sprite.position.set(center.x, center.y);
      }
    }
  }

  /** Animate the move first; the host calls setFromFen afterwards. */
  async animateMove(from, to, pieceLetter) {
    const sprite = this.spriteAt.get(from);
    if (!sprite) return;

    const start = this.board.squareCenter(from);
    const end = this.board.squareCenter(to);
    const isKnight = pieceLetter.toLowerCase() === 'n';
    await slidePiece(sprite, start, end, 180, { knightArc: isKnight });

    // Reassign sprite map to its new square (will be overwritten by setFromFen,
    // but keeps things consistent if anything probes mid-frame).
    this.spriteAt.delete(from);
    this.spriteAt.set(to, sprite);
  }

  /** Animate a captured piece at `square` shrinking and fading. Removes the sprite. */
  async animateCapture(square) {
    const sprite = this.spriteAt.get(square);
    if (!sprite) return;
    this.spriteAt.delete(square);
    await fadeAndShrink(sprite, 220);
    sprite.destroy();
  }

  _createSprite(letter, square) {
    const sprite = new Sprite(getPieceTexture(letter));
    sprite.anchor.set(0.5);
    const center = this.board.squareCenter(square);
    sprite.position.set(center.x, center.y);
    sprite.width = SQUARE_SIZE * 0.85;
    sprite.height = SQUARE_SIZE * 0.85;
    sprite.__piece = letter;
    sprite.eventMode = 'static';
    sprite.cursor = 'grab';

    // Look up the current square at drag time — this sprite gets reused across moves
    // by setFromFen, so the captured `square` would go stale after the first move.
    sprite.on('pointerdown', (e) => this._beginDrag(sprite, this._spriteSquare(sprite) ?? square, e));
    sprite.on('pointerover', () => this._onHover(sprite, true));
    sprite.on('pointerout', () => this._onHover(sprite, false));
    return sprite;
  }

  _spriteSquare(sprite) {
    for (const [sq, s] of this.spriteAt) if (s === sprite) return sq;
    return null;
  }

  _onHover(sprite, hovering) {
    if (this.dragSprite) return;
    const yourColor = this.getYourColor();
    const turn = this.getCurrentTurn();
    if (yourColor !== turn) return;
    const isYours = yourColor === 'white'
      ? sprite.__piece === sprite.__piece.toUpperCase()
      : sprite.__piece === sprite.__piece.toLowerCase();
    if (!isYours) return;

    if (hovering && this._hoveredSprite !== sprite) {
      this._hoveredSprite = sprite;
      sprite.__hoverBase = sprite.y;
      sprite.y = sprite.__hoverBase - 4;
    } else if (!hovering && this._hoveredSprite === sprite) {
      sprite.y = sprite.__hoverBase ?? sprite.y;
      this._hoveredSprite = null;
    }
  }

  _beginDrag(sprite, square, event) {
    const yourColor = this.getYourColor();
    const turn = this.getCurrentTurn();
    if (yourColor !== turn) return;

    const isYours = yourColor === 'white'
      ? sprite.__piece === sprite.__piece.toUpperCase()
      : sprite.__piece === sprite.__piece.toLowerCase();
    if (!isYours) return;

    // Clear hover lift.
    if (this._hoveredSprite === sprite) {
      sprite.y = sprite.__hoverBase ?? sprite.y;
      this._hoveredSprite = null;
    }

    this.dragSprite = sprite;
    this.dragOriginSquare = square;
    this.dragHome = { x: sprite.x, y: sprite.y };

    // Move sprite to the dragLayer so it draws on top of everything.
    this.pieceLayer.removeChild(sprite);
    this.dragLayer.addChild(sprite);

    // Convert global pointer position into board-local coords.
    const local = this.dragLayer.toLocal(event.global);
    this.pointerOffset = { x: sprite.x - local.x, y: sprite.y - local.y };
    sprite.cursor = 'grabbing';
    sprite.scale.set(sprite.scale.x * 1.12);

    this.onPickup?.(square);

    // Wire move/up handlers on the stage so we keep tracking even if the pointer leaves the sprite.
    // Walk to the topmost ancestor (app.stage) — intermediate containers like boardRoot
    // aren't interactive, so listeners attached there would never fire.
    const stage = this._rootStage();
    const moveHandler = (ev) => this._onDragMove(ev);
    const upHandler = (ev) => this._onDragEnd(ev, moveHandler, upHandler);
    stage.on('globalpointermove', moveHandler);
    stage.once('pointerup', upHandler);
    stage.once('pointerupoutside', upHandler);
  }

  _rootStage() {
    let n = this.dragLayer;
    while (n.parent) n = n.parent;
    return n;
  }

  _onDragMove(event) {
    if (!this.dragSprite) return;
    const local = this.dragLayer.toLocal(event.global);
    this.dragSprite.x = local.x + this.pointerOffset.x;
    this.dragSprite.y = local.y + this.pointerOffset.y;
  }

  _onDragEnd(event, moveHandler, upHandler) {
    const stage = this._rootStage();
    stage.off('globalpointermove', moveHandler);
    stage.off('pointerup', upHandler);
    stage.off('pointerupoutside', upHandler);

    const sprite = this.dragSprite;
    if (!sprite) return;

    sprite.scale.set(sprite.scale.x / 1.12);

    const local = this.dragLayer.toLocal(event.global);
    const dropSquare = this.board.pointToSquare(local.x, local.y);
    const from = this.dragOriginSquare;

    // Move sprite back to the piece layer (it'll be repositioned/replaced shortly).
    this.dragLayer.removeChild(sprite);
    this.pieceLayer.addChild(sprite);
    sprite.cursor = 'grab';

    this.dragSprite = null;
    this.dragOriginSquare = null;

    if (!dropSquare || dropSquare === from) {
      this._snapBack(sprite);
      this.onDrop?.(from, null);
      return;
    }

    // Detect promotion: pawn moving to first/last rank.
    const isPawn = sprite.__piece.toLowerCase() === 'p';
    const promoting = isPawn && (dropSquare[1] === '1' || dropSquare[1] === '8');

    if (promoting) {
      this._showPromotionPicker(from, dropSquare, sprite, (choice) => {
        if (!choice) {
          this._snapBack(sprite);
          this.onDrop?.(from, null);
          return;
        }
        this.onPromotion?.(from, dropSquare, choice);
      });
      return;
    }

    this.onDrop?.(from, dropSquare);
  }

  /** Animate a sprite back to its origin (used when a move is rejected). */
  snapBackInvalid(square) {
    const sprite = this.spriteAt.get(square);
    if (!sprite) return;
    this._snapBack(sprite);
  }

  _snapBack(sprite) {
    if (!this.dragHome) return;
    const home = this.dragHome;
    this.dragHome = null;
    void slidePiece(sprite, { x: sprite.x, y: sprite.y }, home, 140);
  }

  _showPromotionPicker(from, to, pawnSprite, callback) {
    const yourColor = this.getYourColor();
    const choices = ['q', 'r', 'b', 'n'];
    const isWhite = yourColor === 'white';
    const center = this.board.squareCenter(to);

    this.promotionContainer.removeChildren();

    // Background panel.
    const panel = new Graphics()
      .roundRect(-SQUARE_SIZE * 0.6, -SQUARE_SIZE * 2.2, SQUARE_SIZE * 1.2, SQUARE_SIZE * 4.4, 12)
      .fill({ color: 0x161b22, alpha: 0.96 })
      .stroke({ color: 0x2a313c, width: 2 });
    this.promotionContainer.addChild(panel);

    choices.forEach((c, i) => {
      const letter = isWhite ? c.toUpperCase() : c;
      const btn = new Sprite(getPieceTexture(letter));
      btn.anchor.set(0.5);
      btn.width = SQUARE_SIZE * 0.85;
      btn.height = SQUARE_SIZE * 0.85;
      btn.position.set(0, (i - 1.5) * SQUARE_SIZE);
      btn.eventMode = 'static';
      btn.cursor = 'pointer';
      btn.on('pointerover', () => btn.scale.set(btn.scale.x * 1.1));
      btn.on('pointerout', () => btn.scale.set(btn.scale.x / 1.1));
      btn.on('pointerdown', (e) => {
        e.stopPropagation();
        this.promotionContainer.visible = false;
        callback(c);
      });
      this.promotionContainer.addChild(btn);
    });

    // Anchor the picker at the destination square. Flip vertically if it would clip the bottom edge.
    let y = center.y;
    if (y + SQUARE_SIZE * 2.2 > BOARD_LOGICAL_SIZE) y = BOARD_LOGICAL_SIZE - SQUARE_SIZE * 2.2;
    if (y - SQUARE_SIZE * 2.2 < 0) y = SQUARE_SIZE * 2.2;
    this.promotionContainer.position.set(center.x, y);
    this.promotionContainer.visible = true;
  }
}
