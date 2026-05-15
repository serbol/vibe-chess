// Web Worker that runs the chess engine off the main thread so Pixi
// rendering and DOM updates aren't blocked while the bot thinks.
import { selectBotMove } from './bot-engine.js';

self.addEventListener('message', (event) => {
  const { type, fen, reqId } = event.data ?? {};
  if (type !== 'compute') return;
  try {
    const move = selectBotMove(fen);
    self.postMessage({ type: 'result', reqId, move });
  } catch (err) {
    self.postMessage({ type: 'error', reqId, message: String(err?.message ?? err) });
  }
});
