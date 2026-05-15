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
  onPlayBot(handler) {
    // Wrap to drop the click event arg — handler signature is handler(difficulty?).
    document.getElementById('play-bot-btn').addEventListener('click', () => handler());
  },

  // Bot difficulty picker — handler is called with 'easy' | 'medium' | 'hard',
  // or not called at all if the user cancels.
  showDifficultyPicker(onPick) {
    const modal = document.getElementById('difficulty-modal');
    modal.classList.remove('hidden');
    const buttons = modal.querySelectorAll('.difficulty-btn');
    const cancel = document.getElementById('difficulty-cancel-btn');
    const cleanup = () => {
      modal.classList.add('hidden');
      buttons.forEach((b) => b.removeEventListener('click', onBtn));
      cancel.removeEventListener('click', onCancel);
    };
    const onBtn = (e) => {
      const difficulty = e.currentTarget.dataset.difficulty;
      cleanup();
      onPick(difficulty);
    };
    const onCancel = () => cleanup();
    buttons.forEach((b) => b.addEventListener('click', onBtn));
    cancel.addEventListener('click', onCancel);
  },
  onInstall(handler) {
    const btn = document.getElementById('install-btn');
    if (btn) btn.addEventListener('click', handler);
  },
  setInstallAvailable(available) {
    const btn = document.getElementById('install-btn');
    if (!btn) return;
    btn.classList.toggle('hidden', !available);
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

  // Toasts. Pass ms=0 for a sticky toast (clear via hideToast()).
  toast(msg, ms = 2400) {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.classList.remove('hidden');
    clearTimeout(el._t);
    if (ms > 0) {
      el._t = setTimeout(() => el.classList.add('hidden'), ms);
    } else {
      el._t = null;
    }
  },
  hideToast() {
    const el = document.getElementById('toast');
    clearTimeout(el._t);
    el._t = null;
    el.classList.add('hidden');
  },

  /**
   * Persistent connection-status banner at the bottom of the viewport.
   * severity is 'warning' (sticky by default) or 'success' (auto-hides).
   * Pass `ms` to override the auto-hide duration; pass 0 to keep it sticky.
   */
  connectionBanner(msg, severity, ms) {
    const el = document.getElementById('connection-banner');
    if (!el) return;
    el.textContent = msg;
    el.classList.remove('hidden', 'warning', 'success');
    el.classList.add(severity);
    clearTimeout(el._t);
    if (el._countdown) {
      clearInterval(el._countdown);
      el._countdown = null;
    }
    const defaultMs = severity === 'success' ? 2400 : 0;
    const hideAfter = ms === undefined ? defaultMs : ms;
    if (hideAfter > 0) {
      el._t = setTimeout(() => el.classList.add('hidden'), hideAfter);
    }
  },

  /**
   * Sticky warning with a live countdown — used while the opponent is offline.
   * Renders `${prefix} ${seconds}s` and ticks down every second. Replaced /
   * cleared automatically when connectionBanner or hideConnectionBanner runs.
   */
  connectionBannerCountdown(prefix, durationMs, severity = 'warning') {
    const el = document.getElementById('connection-banner');
    if (!el) return;
    el.classList.remove('hidden', 'warning', 'success');
    el.classList.add(severity);
    clearTimeout(el._t);
    if (el._countdown) clearInterval(el._countdown);

    const endAt = Date.now() + Math.max(0, durationMs);
    const render = () => {
      const remaining = Math.max(0, Math.ceil((endAt - Date.now()) / 1000));
      el.textContent = remaining > 0
        ? `${prefix} ${remaining}s left…`
        : `${prefix} time expired`;
      if (remaining <= 0 && el._countdown) {
        clearInterval(el._countdown);
        el._countdown = null;
      }
    };
    render();
    el._countdown = setInterval(render, 1000);
  },

  hideConnectionBanner() {
    const el = document.getElementById('connection-banner');
    if (!el) return;
    clearTimeout(el._t);
    if (el._countdown) {
      clearInterval(el._countdown);
      el._countdown = null;
    }
    el.classList.add('hidden');
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

  // Offline alert — shown when a user tries to find an online match while offline.
  showOfflineAlert() {
    const modal = document.getElementById('offline-modal');
    modal.classList.remove('hidden');
    const ok = document.getElementById('offline-ok-btn');
    const onOk = () => {
      modal.classList.add('hidden');
      ok.removeEventListener('click', onOk);
    };
    ok.addEventListener('click', onOk);
  },

  /** Toggle the "you are offline" label on the landing screen and disable the matchmaking button. */
  setOnlineState(online) {
    const findBtn = document.getElementById('find-game-btn');
    if (findBtn) {
      findBtn.disabled = !online;
      findBtn.classList.toggle('disabled', !online);
      findBtn.title = online ? '' : 'Offline — only Practice vs Bot is available';
    }
    if (!online) {
      this.setLandingStatus('Offline — only Practice vs Bot is available.');
    } else {
      const status = document.getElementById('landing-status');
      if (status && status.textContent.startsWith('Offline')) status.textContent = '';
    }
  },

  // Game over
  showGameOver(title, detail, onFindNew, onMenu) {
    const modal = document.getElementById('gameover-modal');
    document.getElementById('gameover-title').textContent = title;
    document.getElementById('gameover-detail').textContent = detail;
    modal.classList.remove('hidden');
    const findBtn = document.getElementById('gameover-find-btn');
    const menuBtn = document.getElementById('gameover-menu-btn');
    const cleanup = () => {
      modal.classList.add('hidden');
      findBtn.removeEventListener('click', onFind);
      menuBtn.removeEventListener('click', onM);
    };
    const onFind = () => { cleanup(); onFindNew(); };
    const onM = () => { cleanup(); onMenu(); };
    findBtn.addEventListener('click', onFind);
    menuBtn.addEventListener('click', onM);
  },
};
