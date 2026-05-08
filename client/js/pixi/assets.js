import { Text, Texture, RenderTexture, Container, Graphics } from 'pixi.js';

/**
 * We render piece glyphs (Unicode chess symbols) into RenderTextures at boot.
 * This avoids any binary asset dependency and gives us crisp scaling. Replace
 * with SVG sprite loading later if you want a more refined look (Cburnett, etc.).
 */
const GLYPHS = {
  P: '♙', N: '♘', B: '♗', R: '♖', Q: '♕', K: '♔', // White
  p: '♟', n: '♞', b: '♝', r: '♜', q: '♛', k: '♚', // Black
};

const TEXTURE_SIZE = 256;

export const pieceTextures = {};

/** Render a piece glyph centered onto a fresh RenderTexture. */
function buildPieceTexture(app, letter) {
  const isWhite = letter === letter.toUpperCase();
  const fill = isWhite ? 0xfafafa : 0x1c1f24;
  const stroke = isWhite ? 0x2c2f36 : 0xf0f0f0;

  const container = new Container();

  // Soft drop shadow as a slightly offset duplicate of the glyph.
  const shadow = new Text({
    text: GLYPHS[letter],
    style: {
      fontFamily: 'serif',
      fontSize: 200,
      fill: 0x000000,
      align: 'center',
    },
  });
  shadow.alpha = 0.35;
  shadow.anchor.set(0.5);
  shadow.position.set(TEXTURE_SIZE / 2 + 4, TEXTURE_SIZE / 2 + 6);

  const glyph = new Text({
    text: GLYPHS[letter],
    style: {
      fontFamily: 'serif',
      fontSize: 200,
      fill,
      stroke: { color: stroke, width: 4, join: 'round' },
      align: 'center',
    },
  });
  glyph.anchor.set(0.5);
  glyph.position.set(TEXTURE_SIZE / 2, TEXTURE_SIZE / 2);

  container.addChild(shadow, glyph);

  const tex = RenderTexture.create({ width: TEXTURE_SIZE, height: TEXTURE_SIZE, resolution: 2 });
  app.renderer.render({ container, target: tex });
  container.destroy({ children: true });
  return tex;
}

/** Generate a 1×1 white circle texture used for particles (tinted at runtime). */
export function buildParticleTexture(app) {
  const g = new Graphics().circle(32, 32, 28).fill({ color: 0xffffff });
  const tex = RenderTexture.create({ width: 64, height: 64, resolution: 1 });
  app.renderer.render({ container: g, target: tex });
  g.destroy();
  return tex;
}

export async function loadAssets(app) {
  for (const letter of Object.keys(GLYPHS)) {
    pieceTextures[letter] = buildPieceTexture(app, letter);
  }
  pieceTextures.__particle = buildParticleTexture(app);
}

export function getPieceTexture(letter) {
  return pieceTextures[letter] ?? Texture.EMPTY;
}
