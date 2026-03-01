const socket = io();
const BOARD_SIZE = 15;
const AI_TOTAL_MS = 5 * 60 * 1000;

const els = {
  registerCard: document.getElementById('registerCard'),
  menuCard: document.getElementById('menuCard'),
  computerCard: document.getElementById('computerCard'),
  lobbyCard: document.getElementById('lobbyCard'),
  roomCard: document.getElementById('roomCard'),
  gameCard: document.getElementById('gameCard'),
  nameInput: document.getElementById('nameInput'),
  registerBtn: document.getElementById('registerBtn'),
  myTag: document.getElementById('myTag'),
  aiDifficulty: document.getElementById('aiDifficulty'),
  startAiBtn: document.getElementById('startAiBtn'),
  roomList: document.getElementById('roomList'),
  createRoomBtn: document.getElementById('createRoomBtn'),
  roomName: document.getElementById('roomName'),
  roomPassword: document.getElementById('roomPassword'),
  roomTime: document.getElementById('roomTime'),
  roomNoLimit: document.getElementById('roomNoLimit'),
  roomInfo: document.getElementById('roomInfo'),
  roomPlayers: document.getElementById('roomPlayers'),
  readyBtn: document.getElementById('readyBtn'),
  leaveRoomBtn: document.getElementById('leaveRoomBtn'),
  setRoomTime: document.getElementById('setRoomTime'),
  setRoomNoLimit: document.getElementById('setRoomNoLimit'),
  saveRoomTimeBtn: document.getElementById('saveRoomTimeBtn'),
  board: document.getElementById('board'),
  gameStatus: document.getElementById('gameStatus'),
  lastMoveHint: document.getElementById('lastMoveHint'),
  surrenderBtn: document.getElementById('surrenderBtn'),
  topBackBtn: document.getElementById('topBackBtn'),
  playerBadge: document.getElementById('playerBadge'),
  viewTitle: document.getElementById('viewTitle'),
  changeNameBtn: document.getElementById('changeNameBtn'),
  returnAfterGameBtn: document.getElementById('returnAfterGameBtn'),
  reselectModeComputerBtn: document.getElementById('reselectModeComputerBtn'),
  reselectModeLobbyBtn: document.getElementById('reselectModeLobbyBtn'),
  aiFirstTurn: document.getElementById('aiFirstTurn'),
  roomFirstTurn: document.getElementById('roomFirstTurn'),
  saveFirstTurnBtn: document.getElementById('saveFirstTurnBtn'),
  undoAiBtn: document.getElementById('undoAiBtn'),
  resultModal: document.getElementById('resultModal'),
  resultMessage: document.getElementById('resultMessage'),
  closeResultModalBtn: document.getElementById('closeResultModalBtn'),
  chatPanel: document.getElementById('chatPanel'),
  chatMessages: document.getElementById('chatMessages'),
  chatInput: document.getElementById('chatInput'),
  sendChatBtn: document.getElementById('sendChatBtn'),
};

const views = {
  register: els.registerCard,
  menu: els.menuCard,
  computer: els.computerCard,
  lobby: els.lobbyCard,
  room: els.roomCard,
  game: els.gameCard,
};

const viewTitleMap = {
  register: '建立玩家身份',
  menu: '選擇模式',
  computer: '電腦模式設定',
  lobby: '玩家大廳',
  room: '房間資訊',
  game: '對局中',
};

const state = {
  myTag: '',
  mode: '',
  roomList: [],
  currentRoom: null,
  board: Array.from({ length: BOARD_SIZE }, () => Array(BOARD_SIZE).fill(null)),
  aiDifficulty: 'easy',
  gameType: '',
  colorByTag: {},
  turn: 'black',
  lastMove: null,
  remainingMs: {},
  syncAt: 0,
  currentView: 'register',
  history: [],
  gameOver: false,
  pendingRoomAfterGame: null,
  aiFirstTurn: 'player',
  aiMoveHistory: [],
  aiThinking: false,
  aiHasMoved: false,
  aiColor: 'white',
  aiClock: {
    playerMs: AI_TOTAL_MS,
    aiMs: AI_TOTAL_MS,
    turn: 'player',
    turnStartAt: 0,
  },
  chatMessages: [],
};

let audioContext = null;

function initAudio() {
  if (!audioContext) audioContext = new window.AudioContext();
  if (audioContext.state === 'suspended') audioContext.resume().catch(() => {});
}

document.addEventListener('pointerdown', initAudio, { passive: true });

function playStoneSound() {
  try {
    initAudio();
    if (!audioContext) return;
    const now = audioContext.currentTime;
    const osc = audioContext.createOscillator();
    const gain = audioContext.createGain();

    osc.type = 'triangle';
    osc.frequency.setValueAtTime(420, now);
    osc.frequency.exponentialRampToValueAtTime(260, now + 0.09);

    gain.gain.setValueAtTime(0.001, now);
    gain.gain.exponentialRampToValueAtTime(0.12, now + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.11);

    osc.connect(gain);
    gain.connect(audioContext.destination);
    osc.start(now);
    osc.stop(now + 0.12);
  } catch {
    // ignore
  }
}

function showResultModal(message) {
  els.resultMessage.textContent = message;
  els.resultModal.classList.remove('hidden');
}

function hideResultModal() {
  els.resultModal.classList.add('hidden');
}

function removeGameFromHistory() {
  state.history = state.history.filter((h) => h !== 'game');
}

function goToView(view, pushHistory = true) {
  Object.values(views).forEach((card) => card.classList.add('hidden'));
  views[view].classList.remove('hidden');

  if (pushHistory && state.currentView !== view) state.history.push(state.currentView);
  state.currentView = view;
  els.viewTitle.textContent = viewTitleMap[view];
  els.topBackBtn.classList.toggle('hidden', state.history.length === 0);
}

function goBack() {
  if (!state.history.length) return;
  if (state.currentView === 'room' && state.currentRoom) {
    socket.emit('room:leave');
    state.currentRoom = null;
  }
  const prev = state.history.pop();
  goToView(prev, false);
}

function resetIdentity() {
  if (state.currentRoom) socket.emit('room:leave');
  state.myTag = '';
  state.currentRoom = null;
  state.mode = '';
  state.gameType = '';
  state.history = [];
  state.gameOver = false;
  state.pendingRoomAfterGame = null;
  state.board = Array.from({ length: BOARD_SIZE }, () => Array(BOARD_SIZE).fill(null));
  els.playerBadge.classList.add('hidden');
  els.changeNameBtn.classList.add('hidden');
  els.returnAfterGameBtn.classList.add('hidden');
  els.undoAiBtn.classList.add('hidden');
  els.nameInput.value = '';
  els.myTag.textContent = '';
  hideResultModal();
  state.chatMessages = [];
  renderChatMessages();
  syncLobbyTimeUi();
  els.chatPanel.classList.add('hidden');
  goToView('register', false);
}

function reselectMode() {
  if (state.currentRoom) {
    socket.emit('room:leave');
    state.currentRoom = null;
  }
  state.mode = '';
  removeGameFromHistory();
  goToView('menu', false);
}

function formatMs(ms = 0) {
  const sec = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
}

function renderBoard(onClick) {
  els.board.innerHTML = '';
  for (let y = 0; y < BOARD_SIZE; y += 1) {
    for (let x = 0; x < BOARD_SIZE; x += 1) {
      const cell = document.createElement('button');
      cell.className = 'cell';
      cell.addEventListener('click', () => {
        if (state.gameOver) return;
        onClick(x, y);
      });
      const v = state.board[y][x];
      if (v) {
        const stone = document.createElement('div');
        stone.className = `stone ${v}`;
        cell.appendChild(stone);
      }
      if (state.lastMove && state.lastMove.x === x && state.lastMove.y === y) cell.classList.add('last-move');
      els.board.appendChild(cell);
    }
  }
}

function renderRooms() {
  els.roomList.innerHTML = '';
  state.roomList.forEach((room) => {
    const li = document.createElement('li');
    li.innerHTML = `<strong>${room.name}</strong><span>房主 ${room.hostTag}｜${room.players.length}/2｜${room.timeLimitSec ? `${room.timeLimitSec}s` : '不限時'}｜${room.firstTurn === 'guest' ? '加入者先手' : '房主先手'}</span>`;
    const btn = document.createElement('button');
    btn.textContent = '加入';
    btn.className = 'btn primary';
    btn.addEventListener('click', () => {
      const pwd = room.hasPassword ? prompt('輸入房間密碼') || '' : '';
      socket.emit('room:join', { roomId: room.id, password: pwd }, (res) => {
        if (!res.ok) return alert(res.error);
        state.currentRoom = res.room;
        enterRoom();
      });
    });
    li.appendChild(btn);
    els.roomList.appendChild(li);
  });
}

function enterRoom() {
  updateRoomUI();
  goToView('room');
}

function updateRoomUI() {
  if (!state.currentRoom) return;
  const room = state.currentRoom;
  const isHost = room.hostTag === state.myTag;
  els.roomInfo.textContent = `房間：${room.name}｜房主：${room.hostTag}｜狀態：${room.status}｜${room.firstTurn === 'guest' ? '加入者先手' : '房主先手'}`;
  syncRoomTimeUi(room);
  els.roomFirstTurn.value = room.firstTurn || 'host';
  els.saveRoomTimeBtn.disabled = !isHost;
  els.saveFirstTurnBtn.disabled = !isHost;
  els.chatPanel.classList.toggle('hidden', room.status !== 'playing');

  els.roomPlayers.innerHTML = '';
  room.players.forEach((p) => {
    const ready = room.ready[p.tag] ? '✅已準備' : '⌛未準備';
    const li = document.createElement('li');
    li.textContent = `${p.tag} ${p.tag === room.hostTag ? '(房主)' : ''} ${ready}`;
    if (isHost && p.tag !== room.hostTag) {
      const kickBtn = document.createElement('button');
      kickBtn.className = 'btn secondary';
      kickBtn.textContent = '踢出';
      kickBtn.addEventListener('click', () => {
        socket.emit('room:kick', p.tag, (res) => {
          if (!res?.ok) alert(res?.error || '踢人失敗');
        });
      });
      li.appendChild(kickBtn);
    }
    els.roomPlayers.appendChild(li);
  });
}

function renderChatMessages() {
  els.chatMessages.innerHTML = '';
  state.chatMessages.forEach((m) => {
    const li = document.createElement('li');
    li.innerHTML = `<div class="meta">${m.tag}｜${m.time}</div><div>${m.text}</div>`;
    els.chatMessages.appendChild(li);
  });
  els.chatMessages.scrollTop = els.chatMessages.scrollHeight;
}

function appendChatMessage(message) {
  state.chatMessages.push(message);
  if (state.chatMessages.length > 80) state.chatMessages.shift();
  renderChatMessages();
}

function syncRoomTimeUi(room) {
  const noLimit = !room.timeLimitSec;
  els.setRoomNoLimit.checked = noLimit;
  els.setRoomTime.disabled = noLimit;
  els.setRoomTime.value = room.timeLimitSec || 300;
}

function syncLobbyTimeUi() {
  const noLimit = els.roomNoLimit.checked;
  els.roomTime.disabled = noLimit;
}

function getTurnTag() {
  return Object.keys(state.colorByTag).find((tag) => state.colorByTag[tag] === state.turn) || '-';
}

function currentRemainingForMultiplayer() {
  const out = { ...state.remainingMs };
  const turnTag = getTurnTag();
  if (!turnTag || !out[turnTag]) return out;
  const elapsed = Math.max(0, Date.now() - state.syncAt);
  out[turnTag] = Math.max(0, out[turnTag] - elapsed);
  return out;
}

function updateGameStatus() {
  if (state.gameType === 'multiplayer') {
    const rem = currentRemainingForMultiplayer();
    const turnTag = getTurnTag();
    const noLimit = !state.currentRoom?.timeLimitSec;
    if (noLimit) {
      els.gameStatus.textContent = `不限時對局\n目前回合：${turnTag}${state.gameOver ? '（已結束）' : ''}`;
      return;
    }
    const timerText = Object.entries(rem).map(([tag, ms]) => `${tag}: ${formatMs(ms)}`).join('｜');
    els.gameStatus.textContent = `${formatMs(rem[turnTag] || 0)}\n目前回合：${turnTag}${state.gameOver ? '（已結束）' : ''}\n${timerText}`;
    return;
  }

  if (state.gameType === 'ai') {
    const aiName = `${els.aiDifficulty.options[els.aiDifficulty.selectedIndex].text}AI`;
    const turnLabel = state.gameOver
      ? '對局結束'
      : (state.aiClock.turn === 'player' ? '玩家' : 'AI');
    els.gameStatus.textContent = `玩家 VS ${aiName}
目前回合：${turnLabel}`;
  }
}

function checkWinner(board, x, y, color) {
  const dirs = [[1, 0], [0, 1], [1, 1], [1, -1]];
  for (const [dx, dy] of dirs) {
    let count = 1;
    for (const dir of [-1, 1]) {
      let nx = x + dx * dir;
      let ny = y + dy * dir;
      while (nx >= 0 && ny >= 0 && nx < BOARD_SIZE && ny < BOARD_SIZE && board[ny][nx] === color) {
        count += 1;
        nx += dx * dir;
        ny += dy * dir;
      }
    }
    if (count >= 5) return true;
  }
  return false;
}

function evaluateLine(line) {
  const scoreTable = {
    '11111': 600000,
    '011110': 180000,
    '211110': 30000,
    '011112': 30000,
    '01110': 12000,
    '010110': 9000,
    '011010': 9000,
    '001112': 4000,
    '211100': 4000,
    '01100': 2600,
    '00110': 2600,
    '001010': 2000,
  };

  let score = 0;
  for (const [pattern, val] of Object.entries(scoreTable)) {
    if (line.includes(pattern)) score += val;
  }
  return score;
}

function evaluatePoint(board, x, y, color) {
  const enemy = color === 'white' ? 'black' : 'white';
  const dirs = [[1, 0], [0, 1], [1, 1], [1, -1]];
  let offense = 0;
  let defense = 0;

  const toDigit = (v, self) => {
    if (!v) return '0';
    return v === self ? '1' : '2';
  };

  for (const [dx, dy] of dirs) {
    let selfLine = '';
    let enemyLine = '';
    for (let step = -4; step <= 4; step += 1) {
      const nx = x + step * dx;
      const ny = y + step * dy;
      if (nx < 0 || ny < 0 || nx >= BOARD_SIZE || ny >= BOARD_SIZE) {
        selfLine += '2';
        enemyLine += '2';
      } else {
        const cur = board[ny][nx];
        if (step === 0) {
          selfLine += '1';
          enemyLine += '1';
        } else {
          selfLine += toDigit(cur, color);
          enemyLine += toDigit(cur, enemy);
        }
      }
    }
    offense += evaluateLine(selfLine);
    defense += evaluateLine(enemyLine);
  }

  const centerBonus = 24 - (Math.abs(x - 7) + Math.abs(y - 7));
  return offense + defense * 0.95 + centerBonus;
}

function evaluateBoard(board) {
  const candidates = getCandidateMoves(board);
  let aiScore = 0;
  let playerScore = 0;
  for (const m of candidates) {
    aiScore += evaluatePoint(board, m.x, m.y, 'white');
    playerScore += evaluatePoint(board, m.x, m.y, 'black');
  }
  return aiScore - playerScore;
}

function getCandidateMoves(board) {
  const candidates = [];
  const hasStone = board.some((row) => row.some(Boolean));
  if (!hasStone) return [{ x: 7, y: 7 }];

  for (let y = 0; y < BOARD_SIZE; y += 1) {
    for (let x = 0; x < BOARD_SIZE; x += 1) {
      if (board[y][x]) continue;
      let near = false;
      for (let dy = -2; dy <= 2 && !near; dy += 1) {
        for (let dx = -2; dx <= 2; dx += 1) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= BOARD_SIZE || ny >= BOARD_SIZE) continue;
          if (board[ny][nx]) {
            near = true;
            break;
          }
        }
      }
      if (near) candidates.push({ x, y });
    }
  }
  return candidates;
}

function sortCandidates(board, color) {
  return getCandidateMoves(board)
    .map((m) => ({ ...m, score: evaluatePoint(board, m.x, m.y, color) }))
    .sort((a, b) => b.score - a.score);
}

function minimax(board, depth, maximizing, alpha, beta, lastMove, lastColor) {
  if (lastMove && checkWinner(board, lastMove.x, lastMove.y, lastColor)) {
    return lastColor === 'white' ? 900000 + depth : -900000 - depth;
  }
  if (depth === 0) return evaluateBoard(board);

  const color = maximizing ? 'white' : 'black';
  const moves = sortCandidates(board, color).slice(0, maximizing ? 8 : 7);
  if (!moves.length) return evaluateBoard(board);

  if (maximizing) {
    let best = -Infinity;
    for (const m of moves) {
      board[m.y][m.x] = 'white';
      const val = minimax(board, depth - 1, false, alpha, beta, m, 'white');
      board[m.y][m.x] = null;
      best = Math.max(best, val);
      alpha = Math.max(alpha, best);
      if (beta <= alpha) break;
    }
    return best;
  }

  let best = Infinity;
  for (const m of moves) {
    board[m.y][m.x] = 'black';
    const val = minimax(board, depth - 1, true, alpha, beta, m, 'black');
    board[m.y][m.x] = null;
    best = Math.min(best, val);
    beta = Math.min(beta, best);
    if (beta <= alpha) break;
  }
  return best;
}

function aiPickMove(difficulty) {
  const candidates = getCandidateMoves(state.board);
  if (!candidates.length) return null;

  for (const m of candidates) {
    state.board[m.y][m.x] = 'white';
    const win = checkWinner(state.board, m.x, m.y, 'white');
    state.board[m.y][m.x] = null;
    if (win) return m;
  }

  for (const m of candidates) {
    state.board[m.y][m.x] = 'black';
    const block = checkWinner(state.board, m.x, m.y, 'black');
    state.board[m.y][m.x] = null;
    if (block) return m;
  }

  if (difficulty === 'easy') {
    const sorted = sortCandidates(state.board, 'white').slice(0, 5);
    if (!sorted.length) return candidates[0];
    if (Math.random() < 0.7) return sorted[0];
    return sorted[Math.floor(Math.random() * sorted.length)];
  }

  if (difficulty === 'medium') {
    const sorted = sortCandidates(state.board, 'white').slice(0, 6);
    let best = sorted[0];
    let bestScore = -Infinity;
    for (const m of sorted) {
      state.board[m.y][m.x] = 'white';
      const score = minimax(state.board, 1, false, -Infinity, Infinity, m, 'white');
      state.board[m.y][m.x] = null;
      if (score > bestScore) {
        bestScore = score;
        best = m;
      }
    }
    return best;
  }

  const sorted = sortCandidates(state.board, 'white').slice(0, 8);
  let best = sorted[0];
  let bestScore = -Infinity;
  for (const m of sorted) {
    state.board[m.y][m.x] = 'white';
    const score = minimax(state.board, 2, false, -Infinity, Infinity, m, 'white');
    state.board[m.y][m.x] = null;
    if (score > bestScore) {
      bestScore = score;
      best = m;
    }
  }
  return best;
}

function consumeAiTurnTime() {
  // AI 模式不使用倒數計時
}

function finishGameOnBoard(message, returnText) {
  state.gameOver = true;
  els.lastMoveHint.textContent = `${els.lastMoveHint.textContent}\n${message}`;
  els.returnAfterGameBtn.textContent = returnText;
  els.returnAfterGameBtn.classList.remove('hidden');
  showResultModal(message);
  updateGameStatus();
}

function aiMove() {
  if (state.gameOver) return;
  state.aiThinking = true;
  state.aiClock.turn = 'ai';

  const pick = aiPickMove(state.aiDifficulty);
  if (!pick) {
    state.aiThinking = false;
    return;
  }
  const { x, y } = pick;

  state.board[y][x] = state.aiColor;
  state.lastMove = { x, y, tag: 'AI' };
  state.aiMoveHistory.push({ x, y, color: state.aiColor, tag: 'AI' });
  state.aiHasMoved = true;
  playStoneSound();

  state.aiClock.turn = 'player';
  state.aiThinking = false;

  renderBoard(playerMoveAi);
  els.lastMoveHint.textContent = `上一手：AI 落在 (${x + 1}, ${y + 1})`;
  updateGameStatus();

  if (checkWinner(state.board, x, y, state.aiColor)) {
    finishGameOnBoard('結果：AI 獲勝', '返回模式設定');
  }
}

function playerMoveAi(x, y) {
  if (state.board[y][x] || state.gameOver || state.aiThinking || state.aiClock.turn !== 'player') return;

  const playerColor = state.aiColor === 'white' ? 'black' : 'white';
  state.board[y][x] = playerColor;
  state.lastMove = { x, y, tag: state.myTag || '玩家' };
  state.aiMoveHistory.push({ x, y, color: playerColor, tag: state.myTag || '玩家' });
  playStoneSound();

  state.aiClock.turn = 'ai';

  renderBoard(playerMoveAi);
  els.lastMoveHint.textContent = `上一手：${state.myTag || '玩家'} 落在 (${x + 1}, ${y + 1})，輪到 AI`;
  updateGameStatus();

  if (checkWinner(state.board, x, y, playerColor)) {
    finishGameOnBoard('結果：你獲勝', '返回模式設定');
    return;
  }

  setTimeout(aiMove, state.aiDifficulty === 'hard' ? 160 : 340);
}

function undoAiMoves() {
  if (state.gameType !== 'ai' || state.gameOver || state.aiThinking) return;
  if (state.aiMoveHistory.length < 2) {
    alert('目前無法悔棋（至少要下完雙方各一步）');
    return;
  }

  const last = state.aiMoveHistory.pop();
  const prev = state.aiMoveHistory.pop();
  state.board[last.y][last.x] = null;
  state.board[prev.y][prev.x] = null;
  state.lastMove = state.aiMoveHistory[state.aiMoveHistory.length - 1] || null;
  state.aiClock.turn = 'player';

  renderBoard(playerMoveAi);
  if (state.lastMove) {
    els.lastMoveHint.textContent = `已悔棋：回到 ${state.lastMove.tag} 在 (${state.lastMove.x + 1}, ${state.lastMove.y + 1}) 之後`;
  } else {
    els.lastMoveHint.textContent = '已悔棋：回到開局';
  }
  updateGameStatus();
}

els.topBackBtn.addEventListener('click', goBack);
els.changeNameBtn.addEventListener('click', resetIdentity);
els.reselectModeComputerBtn.addEventListener('click', reselectMode);
els.reselectModeLobbyBtn.addEventListener('click', reselectMode);
els.closeResultModalBtn.addEventListener('click', hideResultModal);
els.undoAiBtn.addEventListener('click', undoAiMoves);
els.roomNoLimit.addEventListener('change', syncLobbyTimeUi);
els.setRoomNoLimit.addEventListener('change', () => {
  els.setRoomTime.disabled = els.setRoomNoLimit.checked;
});


els.returnAfterGameBtn.addEventListener('click', () => {
  removeGameFromHistory();
  els.returnAfterGameBtn.classList.add('hidden');
  const returnView = state.gameType === 'multiplayer' ? 'room' : 'computer';
  if (returnView !== 'game') els.undoAiBtn.classList.add('hidden');
  goToView(returnView, false);
});

els.registerBtn.addEventListener('click', () => {
  socket.emit('player:register', els.nameInput.value, (res) => {
    if (!res.ok) return alert(res.error);
    state.myTag = res.tag;
    els.myTag.textContent = `你的玩家標籤：${res.tag}`;
    els.playerBadge.textContent = res.tag;
    els.playerBadge.classList.remove('hidden');
    els.changeNameBtn.classList.remove('hidden');
    goToView('menu');
  });
});

document.querySelectorAll('[data-mode]').forEach((btn) => {
  btn.addEventListener('click', () => {
    const mode = btn.getAttribute('data-mode');
    state.mode = mode;
    goToView(mode === 'computer' ? 'computer' : 'lobby');
  });
});

els.startAiBtn.addEventListener('click', () => {
  state.gameType = 'ai';
  state.aiDifficulty = els.aiDifficulty.value;
  state.board = Array.from({ length: BOARD_SIZE }, () => Array(BOARD_SIZE).fill(null));
  state.lastMove = null;
  state.gameOver = false;
  state.aiMoveHistory = [];
  state.aiHasMoved = false;
  state.aiThinking = false;
  state.aiFirstTurn = els.aiFirstTurn.value;
  state.aiColor = state.aiFirstTurn === 'ai' ? 'black' : 'white';
  els.undoAiBtn.classList.remove('hidden');
  els.returnAfterGameBtn.classList.add('hidden');
  hideResultModal();
  state.chatMessages = [];
  renderChatMessages();
  els.chatPanel.classList.add('hidden');
  state.aiClock = { playerMs: AI_TOTAL_MS, aiMs: AI_TOTAL_MS, turn: state.aiFirstTurn === 'ai' ? 'ai' : 'player', turnStartAt: Date.now() };
  goToView('game');
  els.lastMoveHint.textContent = state.aiFirstTurn === 'ai' ? '電腦先手（黑棋）' : '玩家先手（黑棋）';
  renderBoard(playerMoveAi);
  updateGameStatus();
  if (state.aiFirstTurn === 'ai') {
    setTimeout(aiMove, 260);
  }
});

els.createRoomBtn.addEventListener('click', () => {
  socket.emit('room:create', {
    name: els.roomName.value,
    password: els.roomPassword.value,
    timeLimitSec: els.roomNoLimit.checked ? 0 : Number(els.roomTime.value),
    firstTurn: els.roomFirstTurn.value,
  }, (res) => {
    if (!res.ok) return alert(res.error);
    state.currentRoom = res.room;
    enterRoom();
  });
});

els.readyBtn.addEventListener('click', () => {
  if (!state.currentRoom) return;
  const ready = !state.currentRoom.ready[state.myTag];
  socket.emit('room:ready', ready);
});

els.leaveRoomBtn.addEventListener('click', () => {
  socket.emit('room:leave');
  state.currentRoom = null;
  goToView('lobby');
});

els.saveRoomTimeBtn.addEventListener('click', () => {
  socket.emit('room:set-time', els.setRoomNoLimit.checked ? 0 : Number(els.setRoomTime.value), (res) => {
    if (!res.ok) alert(res.error);
  });
});

els.saveFirstTurnBtn.addEventListener('click', () => {
  socket.emit('room:set-first-turn', els.roomFirstTurn.value, (res) => {
    if (!res?.ok) alert(res?.error || '設定先後手失敗');
  });
});

els.sendChatBtn.addEventListener('click', () => {
  if (state.gameType !== 'multiplayer' || !state.currentRoom || state.currentRoom.status !== 'playing') return;
  const text = (els.chatInput.value || '').trim();
  if (!text) return;
  socket.emit('room:chat', text, (res) => {
    if (!res?.ok) alert(res?.error || '訊息發送失敗');
  });
  els.chatInput.value = '';
});

els.chatInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    els.sendChatBtn.click();
  }
});

els.surrenderBtn.addEventListener('click', () => {
  if (state.gameOver) return;
  if (state.gameType === 'multiplayer') {
    socket.emit('game:surrender', (res) => {
      if (!res.ok) alert(res.error);
    });
    return;
  }
  finishGameOnBoard('你已投降', '返回模式設定');
});

socket.on('room:list', (rooms) => {
  state.roomList = rooms;
  renderRooms();
});

socket.on('room:updated', (room) => {
  if (state.currentRoom?.id === room.id) {
    state.currentRoom = room;
    updateRoomUI();
    if (room.status !== 'playing' && !(state.currentView === 'game' && state.gameOver)) {
      goToView('room');
    }
  }
  state.roomList = state.roomList.map((r) => (r.id === room.id ? room : r));
  renderRooms();
});

socket.on('room:kicked', () => {
  alert('你已被房主踢出房間');
  state.currentRoom = null;
  state.gameOver = false;
  els.undoAiBtn.classList.add('hidden');
  els.chatPanel.classList.add('hidden');
  goToView('lobby');
});

socket.on('game:started', ({ room, board, turn, colorByTag, remainingMs }) => {
  state.currentRoom = room;
  state.gameType = 'multiplayer';
  state.board = board;
  state.turn = turn;
  state.colorByTag = colorByTag;
  state.remainingMs = { ...remainingMs };
  state.syncAt = Date.now();
  state.lastMove = null;
  state.gameOver = false;
  els.undoAiBtn.classList.add('hidden');
  els.returnAfterGameBtn.classList.add('hidden');
  hideResultModal();
  state.chatMessages = [];
  renderChatMessages();
  els.chatPanel.classList.remove('hidden');
  goToView('game');
  updateGameStatus();
  els.lastMoveHint.textContent = '對局開始';
  renderBoard((x, y) => {
    socket.emit('game:move', { x, y }, (res) => {
      if (!res.ok) alert(res.error);
    });
  });
});

socket.on('game:state', ({ board, turn, remainingMs, lastMove, room }) => {
  const oldLastMove = state.lastMove;
  state.board = board;
  state.turn = turn;
  state.remainingMs = { ...remainingMs };
  state.syncAt = Date.now();
  state.lastMove = lastMove;
  state.currentRoom = room;

  if (lastMove && (!oldLastMove || lastMove.x !== oldLastMove.x || lastMove.y !== oldLastMove.y)) playStoneSound();

  updateGameStatus();
  if (lastMove) {
    const nextTag = Object.keys(state.colorByTag).find((tag) => state.colorByTag[tag] === turn) || '下一位玩家';
    els.lastMoveHint.textContent = `上一手：${lastMove.tag} 落在 (${lastMove.x + 1}, ${lastMove.y + 1})，輪到 ${nextTag}`;
  }

  renderBoard((x, y) => {
    socket.emit('game:move', { x, y }, (res) => {
      if (!res.ok) alert(res.error);
    });
  });
});

socket.on('room:chat', (message) => {
  appendChatMessage(message);
});

socket.on('game:ended', ({ winnerTag, reason, loserTag, board, lastMove, room }) => {
  if (board) state.board = board;
  if (lastMove) state.lastMove = lastMove;
  if (room) state.currentRoom = room;
  state.gameOver = true;

  renderBoard((x, y) => {
    socket.emit('game:move', { x, y }, (res) => {
      if (!res.ok) alert(res.error);
    });
  });

  let message = '結果：平局';
  if (reason === 'surrender') message = `結果：${loserTag} 投降，${winnerTag} 獲勝`;
  else if (reason === 'timeout') message = `結果：${loserTag} 超時，${winnerTag} 獲勝`;
  else if (winnerTag) message = `結果：${winnerTag} 五連珠獲勝`;

  els.lastMoveHint.textContent = `${els.lastMoveHint.textContent}\n${message}`;
  els.returnAfterGameBtn.textContent = state.gameType === 'multiplayer' ? '返回房間' : '返回模式設定';
  els.returnAfterGameBtn.classList.remove('hidden');
  showResultModal(message);
  updateGameStatus();
});

setInterval(() => {
  if (state.currentView !== 'game') return;
  updateGameStatus();
}, 250);

syncLobbyTimeUi();
goToView('register', false);
