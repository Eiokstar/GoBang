const socket = io();
const BOARD_SIZE = 15;

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
  roomInfo: document.getElementById('roomInfo'),
  roomPlayers: document.getElementById('roomPlayers'),
  readyBtn: document.getElementById('readyBtn'),
  leaveRoomBtn: document.getElementById('leaveRoomBtn'),
  setRoomTime: document.getElementById('setRoomTime'),
  saveRoomTimeBtn: document.getElementById('saveRoomTimeBtn'),
  board: document.getElementById('board'),
  gameStatus: document.getElementById('gameStatus'),
  lastMoveHint: document.getElementById('lastMoveHint'),
  surrenderBtn: document.getElementById('surrenderBtn'),
  topBackBtn: document.getElementById('topBackBtn'),
  playerBadge: document.getElementById('playerBadge'),
  viewTitle: document.getElementById('viewTitle'),
  changeNameBtn: document.getElementById('changeNameBtn'),
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
  currentView: 'register',
  history: [],
};

let audioContext = null;

function playStoneSound() {
  try {
    if (!audioContext) {
      audioContext = new window.AudioContext();
    }
    const now = audioContext.currentTime;
    const osc = audioContext.createOscillator();
    const gain = audioContext.createGain();

    osc.type = 'triangle';
    osc.frequency.setValueAtTime(520, now);
    osc.frequency.exponentialRampToValueAtTime(300, now + 0.08);

    gain.gain.setValueAtTime(0.001, now);
    gain.gain.exponentialRampToValueAtTime(0.14, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.1);

    osc.connect(gain);
    gain.connect(audioContext.destination);
    osc.start(now);
    osc.stop(now + 0.11);
  } catch (e) {
    // ignore audio errors
  }
}

function goToView(view, pushHistory = true) {
  Object.values(views).forEach((card) => card.classList.add('hidden'));
  views[view].classList.remove('hidden');

  if (pushHistory && state.currentView !== view) {
    state.history.push(state.currentView);
  }
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
  if (state.currentRoom) {
    socket.emit('room:leave');
  }
  state.myTag = '';
  state.currentRoom = null;
  state.mode = '';
  state.gameType = '';
  state.history = [];
  els.playerBadge.classList.add('hidden');
  els.changeNameBtn.classList.add('hidden');
  els.myTag.textContent = '';
  els.nameInput.value = '';
  goToView('register', false);
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
      cell.addEventListener('click', () => onClick(x, y));
      const v = state.board[y][x];
      if (v) {
        const stone = document.createElement('div');
        stone.className = `stone ${v}`;
        cell.appendChild(stone);
      }
      if (state.lastMove && state.lastMove.x === x && state.lastMove.y === y) {
        cell.classList.add('last-move');
      }
      els.board.appendChild(cell);
    }
  }
}

function renderRooms() {
  els.roomList.innerHTML = '';
  state.roomList.forEach((room) => {
    const li = document.createElement('li');
    li.innerHTML = `<strong>${room.name}</strong> <span>房主 ${room.hostTag}｜${room.players.length}/2｜${room.timeLimitSec}s</span>`;
    const btn = document.createElement('button');
    btn.textContent = '加入';
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
  els.roomInfo.textContent = `房間：${room.name}｜房主：${room.hostTag}｜狀態：${room.status}`;
  els.setRoomTime.value = room.timeLimitSec;
  els.saveRoomTimeBtn.disabled = !isHost;

  els.roomPlayers.innerHTML = '';
  room.players.forEach((p) => {
    const ready = room.ready[p.tag] ? '✅已準備' : '⌛未準備';
    const li = document.createElement('li');
    li.textContent = `${p.tag} ${p.tag === room.hostTag ? '(房主)' : ''} ${ready}`;
    if (isHost && p.tag !== room.hostTag) {
      const kickBtn = document.createElement('button');
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

function updateGameStatus() {
  if (state.gameType !== 'multiplayer') return;
  const turnTag = Object.keys(state.colorByTag).find((k) => state.colorByTag[k] === state.turn) || '-';
  const timerText = Object.entries(state.remainingMs)
    .map(([tag, ms]) => `${tag}: ${formatMs(ms)}`)
    .join(' ｜ ');
  els.gameStatus.textContent = `目前回合：${turnTag}（${state.turn}）\n${timerText}`;
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

function aiPickMove(difficulty) {
  const empties = [];
  for (let y = 0; y < BOARD_SIZE; y += 1) {
    for (let x = 0; x < BOARD_SIZE; x += 1) {
      if (!state.board[y][x]) empties.push({ x, y });
    }
  }
  if (!empties.length) return null;

  const findWinning = (color) => {
    for (const { x, y } of empties) {
      state.board[y][x] = color;
      const win = checkWinner(state.board, x, y, color);
      state.board[y][x] = null;
      if (win) return { x, y };
    }
    return null;
  };

  if (difficulty === 'easy') return empties[Math.floor(Math.random() * empties.length)];
  if (difficulty === 'medium') return findWinning('white') || findWinning('black') || empties[Math.floor(Math.random() * empties.length)];

  const center = { x: 7, y: 7 };
  const sorted = [...empties].sort((a, b) => {
    const da = Math.abs(a.x - center.x) + Math.abs(a.y - center.y);
    const db = Math.abs(b.x - center.x) + Math.abs(b.y - center.y);
    return da - db;
  });
  return findWinning('white') || findWinning('black') || sorted[0];
}

function aiMove() {
  const pick = aiPickMove(state.aiDifficulty);
  if (!pick) return;
  const { x, y } = pick;
  state.board[y][x] = 'white';
  state.lastMove = { x, y, tag: 'AI' };
  playStoneSound();
  renderBoard(playerMoveAi);
  els.lastMoveHint.textContent = `上一手：AI 落在 (${x + 1}, ${y + 1})`;
  if (checkWinner(state.board, x, y, 'white')) {
    alert('AI 獲勝');
    goToView('computer');
  }
}

function playerMoveAi(x, y) {
  if (state.board[y][x]) return;
  state.board[y][x] = 'black';
  state.lastMove = { x, y, tag: state.myTag };
  playStoneSound();
  renderBoard(playerMoveAi);
  els.lastMoveHint.textContent = `上一手：${state.myTag} 落在 (${x + 1}, ${y + 1})，輪到 AI`;
  if (checkWinner(state.board, x, y, 'black')) {
    alert('你獲勝');
    goToView('computer');
    return;
  }
  setTimeout(aiMove, state.aiDifficulty === 'hard' ? 250 : 500);
}

els.topBackBtn.addEventListener('click', goBack);
els.changeNameBtn.addEventListener('click', resetIdentity);

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
  goToView('game');
  els.gameStatus.textContent = `玩家 VS ${els.aiDifficulty.options[els.aiDifficulty.selectedIndex].text}AI`;
  els.lastMoveHint.textContent = '目前回合：玩家（黑棋）';
  renderBoard(playerMoveAi);
});

els.createRoomBtn.addEventListener('click', () => {
  socket.emit(
    'room:create',
    {
      name: els.roomName.value,
      password: els.roomPassword.value,
      timeLimitSec: Number(els.roomTime.value),
    },
    (res) => {
      if (!res.ok) return alert(res.error);
      state.currentRoom = res.room;
      enterRoom();
    }
  );
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
  socket.emit('room:set-time', Number(els.setRoomTime.value), (res) => {
    if (!res.ok) alert(res.error);
  });
});

els.surrenderBtn.addEventListener('click', () => {
  if (state.gameType === 'multiplayer') {
    socket.emit('game:surrender', (res) => {
      if (!res.ok) alert(res.error);
    });
    return;
  }
  alert('你已投降，返回模式設定。');
  goToView('computer');
});

socket.on('room:list', (rooms) => {
  state.roomList = rooms;
  renderRooms();
});

socket.on('room:updated', (room) => {
  if (state.currentRoom?.id === room.id) {
    state.currentRoom = room;
    updateRoomUI();
    if (room.status !== 'playing') goToView('room');
  }
  state.roomList = state.roomList.map((r) => (r.id === room.id ? room : r));
  renderRooms();
});

socket.on('room:kicked', () => {
  alert('你已被房主踢出房間');
  state.currentRoom = null;
  goToView('lobby');
});

socket.on('game:started', ({ room, board, turn, colorByTag, remainingMs }) => {
  state.currentRoom = room;
  state.gameType = 'multiplayer';
  state.board = board;
  state.turn = turn;
  state.colorByTag = colorByTag;
  state.remainingMs = remainingMs;
  state.lastMove = null;
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
  state.remainingMs = remainingMs;
  state.lastMove = lastMove;
  state.currentRoom = room;
  updateGameStatus();

  if (lastMove && (!oldLastMove || lastMove.x !== oldLastMove.x || lastMove.y !== oldLastMove.y)) {
    playStoneSound();
  }

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

socket.on('game:ended', ({ winnerTag, reason, loserTag }) => {
  let message = '平局';
  if (reason === 'surrender') message = `${loserTag} 投降，${winnerTag} 獲勝`;
  else if (reason === 'timeout') message = `${loserTag} 超時，${winnerTag} 獲勝`;
  else if (winnerTag) message = `${winnerTag} 五連珠獲勝`;
  alert(`${message}，即將返回房間。`);
  goToView(state.gameType === 'multiplayer' ? 'room' : 'computer');
});

setInterval(() => {
  if (state.gameType !== 'multiplayer' || !state.currentRoom || state.currentRoom.status !== 'playing') return;
  updateGameStatus();
}, 500);

goToView('register', false);
