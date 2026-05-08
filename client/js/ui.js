// Thin wrapper around DOM elements outside the Pixi canvas.

const PIECE_GLYPH = {
  P: '♙', N: '♘', B: '♗', R: '♖', Q: '♕', K: '♔',
  p: '♟', n: '♞', b: '♝', r: '♜', q: '♛', k: '♚',
};

export const ui = {
  // Screens
  showLanding() {
    document.getElementById('screen-landing').classList.remove('hidden');
    document.getElementById('screen-game').classList.add('hidden');
  },
  showGame() {
    document.getElementById('screen-landing').classList.add('hidden');
    document.getElementById('screen-game').classList.remove('hidden');
  },

  // Landing
  setLandingStatus(text) {
    document.getElementById('landing-status').textContent = text;
  },
  getNameInput() {
    return document.getElementById('name-input').value.trim();
  },
  onFindGame(handler) {
    document.getElementById('find-game-btn').addEventListener('click', handler);
    document.getElementById('name-input').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') handler();
    });
  },

  // Game header
  setPlayers(youName, oppName) {
    document.getElementById('your-name').textContent = youName;
    document.getElementById('opponent-name').textContent = oppName;
  },
  setTurn(label) {
    document.getElementById('turn-label').textContent = label;
  },
  onResign(h) { document.getElementById('resign-btn').addEventListener('click', h); },
  onOfferDraw(h) { document.getElementById('draw-btn').addEventListener('click', h); },

  // Move history
  resetMoves() {
    document.getElementById('move-list').innerHTML = '';
  },
  addMove(san, color) {
    const list = document.getElementById('move-list');
    if (color === 'white') {
      const li = document.createElement('li');
      const num = list.children.length + 1;
      li.innerHTML = `<span class="num">${num}.</span><span class="white-move">${san}</span><span class="black-move"></span>`;
      list.appendChild(li);
    } else {
      const last = list.lastElementChild;
      if (last) {
        last.querySelector('.black-move').textContent = san;
      } else {
        const li = document.createElement('li');
        li.innerHTML = `<span class="num">1.</span><span class="white-move">…</span><span class="black-move">${san}</span>`;
        list.appendChild(li);
      }
    }
    list.scrollTop = list.scrollHeight;
  },

  // Captured tray
  resetCaptured() {
    document.getElementById('captured-by-you').innerHTML = '';
    document.getElementById('captured-by-opp').innerHTML = '';
  },
  /** side === 'you' or 'opp' — who DID the capturing. */
  addCapturedPiece(side, pieceLetter) {
    const id = side === 'you' ? 'captured-by-you' : 'captured-by-opp';
    const tray = document.getElementById(id);
    const span = document.createElement('span');
    span.textContent = PIECE_GLYPH[pieceLetter] ?? '?';
    span.style.color = pieceLetter === pieceLetter.toUpperCase() ? '#f0f0f0' : '#222';
    span.style.textShadow = pieceLetter === pieceLetter.toLowerCase()
      ? '0 0 1px #888, 0 0 2px #aaa'
      : '0 0 2px #000';
    tray.appendChild(span);
  },

  // Toasts
  toast(msg, ms = 2400) {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.classList.remove('hidden');
    clearTimeout(el._t);
    el._t = setTimeout(() => el.classList.add('hidden'), ms);
  },

  // Draw modal
  showDrawOffered(onAccept, onDecline) {
    const modal = document.getElementById('draw-modal');
    modal.classList.remove('hidden');
    const accept = document.getElementById('accept-draw-btn');
    const decline = document.getElementById('decline-draw-btn');
    const cleanup = () => {
      modal.classList.add('hidden');
      accept.removeEventListener('click', onA);
      decline.removeEventListener('click', onD);
    };
    const onA = () => { cleanup(); onAccept(); };
    const onD = () => { cleanup(); onDecline(); };
    accept.addEventListener('click', onA);
    decline.addEventListener('click', onD);
  },

  // Game over
  showGameOver(title, detail, onRematch) {
    const modal = document.getElementById('gameover-modal');
    document.getElementById('gameover-title').textContent = title;
    document.getElementById('gameover-detail').textContent = detail;
    modal.classList.remove('hidden');
    const btn = document.getElementById('gameover-rematch-btn');
    const onClick = () => {
      modal.classList.add('hidden');
      btn.removeEventListener('click', onClick);
      onRematch();
    };
    btn.addEventListener('click', onClick);
  },
};
