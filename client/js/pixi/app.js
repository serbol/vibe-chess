import { Application, Container } from 'pixi.js';

/**
 * Boots the Pixi v8 Application and a stack of named layered containers.
 * Returns { app, layers } once init resolves.
 */
export async function createPixiApp(mountEl) {
  const app = new Application();
  await app.init({
    resizeTo: mountEl,
    antialias: true,
    autoDensity: true,
    resolution: window.devicePixelRatio || 1,
    backgroundAlpha: 0,
    powerPreference: 'high-performance',
  });
  mountEl.appendChild(app.canvas);

  const layers = {
    boardLayer: new Container({ label: 'board' }),
    highlightLayer: new Container({ label: 'highlight' }),
    pieceLayer: new Container({ label: 'pieces' }),
    effectsLayer: new Container({ label: 'effects' }),
    dragLayer: new Container({ label: 'drag' }),
  };
  for (const c of Object.values(layers)) app.stage.addChild(c);

  // Enable hit testing on the stage so empty-square clicks bubble up.
  app.stage.eventMode = 'static';
  app.stage.hitArea = app.screen;

  return { app, layers };
}
