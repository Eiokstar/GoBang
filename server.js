const path = require('path');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const sqlite3 = require('sqlite3').verbose();

const PORT = process.env.PORT || 3000;
const BOARD_SIZE = 15;

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const db = new sqlite3.Database(path.join(__dirname, 'data', 'gobang.db'));
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS players (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    base_name TEXT NOT NULL,
    tag TEXT NOT NULL UNIQUE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
});

const players = new Map(); // socketId -> {tag, socketId}
const rooms = new Map(); // roomId -> room state

const emptyBoard = () => Array.from({ length: BOARD_SIZE }, () => Array(BOARD_SIZE).fill(null));

function normalizeTimeLimitSec(raw) {
  if (raw === null || raw === undefined || raw === '') return 300;
  const n = Number(raw);
  if (!Number.isFinite(n)) return 300;
  if (n <= 0) return 0;
  return Math.max(30, Math.min(1800, Math.floor(n)));
}

function serializeRoom(room) {
  return {
    id: room.id,
    name: room.name,
    hasPassword: Boolean(room.password),
    hostTag: room.hostTag,
    players: room.players,
    ready: room.ready,
    timeLimitSec: room.timeLimitSec,
    status: room.status,
    firstTurn: room.firstTurn || 'host',
  };
}

function broadcastRooms() {
  io.emit('room:list', [...rooms.values()].map(serializeRoom));
}

function createTag(baseName, callback) {
  const safeBase = String(baseName || '').trim().slice(0, 20);
  if (!safeBase) {
    callback(new Error('名稱不可為空'));
    return;
  }

  db.get(
    `SELECT MAX(CAST(SUBSTR(tag, INSTR(tag, '#') + 1) AS INTEGER)) AS max_suffix
     FROM players
     WHERE base_name = ?`,
    [safeBase],
    (err, row) => {
      if (err) {
        callback(err);
        return;
      }

      const nextSuffix = Number.isInteger(row?.max_suffix) ? row.max_suffix + 1 : 0;
      if (nextSuffix > 999) {
        callback(new Error('該名稱已達上限'));
        return;
      }

      const tag = `${safeBase}#${String(nextSuffix).padStart(3, '0')}`;
      db.run('INSERT INTO players (base_name, tag) VALUES (?, ?)', [safeBase, tag], function insertCb(insertErr) {
        if (insertErr && String(insertErr.message || '').includes('UNIQUE')) {
          createTag(safeBase, callback);
          return;
        }
        callback(insertErr, tag);
      });
    }
  );
}

function findRoomBySocket(socketId) {
  for (const room of rooms.values()) {
    if (room.players.some((p) => p.socketId === socketId)) return room;
  }
  return null;
}

function resetGameState(room) {
  room.status = 'waiting';
  room.ready = Object.fromEntries(room.players.map((p) => [p.tag, false]));
  room.game = {
    board: emptyBoard(),
    turn: 'black',
    colorByTag: {},
    lastMove: null,
    winner: null,
    remainingMs: {},
    turnEndsAt: null,
    timer: null,
  };
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

function isDraw(board) {
  return board.every((row) => row.every((cell) => cell));
}

function clearRoomTimer(room) {
  if (room.game?.timer) {
    clearTimeout(room.game.timer);
    room.game.timer = null;
  }
}

function getTagByTurn(room) {
  return Object.entries(room.game.colorByTag).find(([, c]) => c === room.game.turn)?.[0] || null;
}

function tickTurn(room) {
  clearRoomTimer(room);
  if (!room.timeLimitSec) return;
  const currentTag = getTagByTurn(room);
  if (!currentTag) return;
  room.game.turnEndsAt = Date.now() + room.game.remainingMs[currentTag];
  room.game.timer = setTimeout(() => {
    const loserTag = currentTag;
    const winnerTag = room.players.find((p) => p.tag !== loserTag)?.tag;
    room.game.winner = winnerTag || 'draw';
    room.status = 'finished';
    io.to(room.id).emit('game:ended', {
      room: serializeRoom(room),
      board: room.game.board,
      winnerTag,
      reason: 'timeout',
      loserTag,
    });
    clearRoomTimer(room);
    setTimeout(() => {
      resetGameState(room);
      io.to(room.id).emit('room:updated', serializeRoom(room));
      broadcastRooms();
    }, 1500);
  }, room.game.remainingMs[currentTag]);
}

function startGame(room) {
  if (room.players.length !== 2) return;
  room.status = 'playing';
  room.game.board = emptyBoard();
  room.game.lastMove = null;
  room.game.winner = null;

  const hostPlayer = room.players.find((p) => p.tag === room.hostTag) || room.players[0];
  const guestPlayer = room.players.find((p) => p.tag !== hostPlayer.tag) || room.players[1];
  const blackPlayer = room.firstTurn === 'guest' ? guestPlayer : hostPlayer;
  const whitePlayer = blackPlayer.tag === hostPlayer.tag ? guestPlayer : hostPlayer;

  room.game.colorByTag = {
    [blackPlayer.tag]: 'black',
    [whitePlayer.tag]: 'white',
  };
  room.game.turn = 'black';
  room.game.remainingMs = room.timeLimitSec ? {
    [hostPlayer.tag]: room.timeLimitSec * 1000,
    [guestPlayer.tag]: room.timeLimitSec * 1000,
  } : {
    [hostPlayer.tag]: 0,
    [guestPlayer.tag]: 0,
  };

  io.to(room.id).emit('game:started', {
    room: serializeRoom(room),
    board: room.game.board,
    turn: room.game.turn,
    colorByTag: room.game.colorByTag,
    remainingMs: room.game.remainingMs,
  });
  tickTurn(room);
  broadcastRooms();
}

io.on('connection', (socket) => {
  socket.on('player:register', (baseName, cb) => {
    createTag(baseName, (err, tag) => {
      if (err) {
        cb?.({ ok: false, error: err.message });
        return;
      }
      players.set(socket.id, { socketId: socket.id, tag });
      cb?.({ ok: true, tag });
      socket.emit('room:list', [...rooms.values()].map(serializeRoom));
    });
  });

  socket.on('room:create', (payload, cb) => {
    const player = players.get(socket.id);
    if (!player) return cb?.({ ok: false, error: '請先設定名稱' });

    const roomId = `room-${Math.random().toString(36).slice(2, 8)}`;
    const room = {
      id: roomId,
      name: String(payload.name || `${player.tag} 的房間`).slice(0, 30),
      password: payload.password || '',
      hostTag: player.tag,
      players: [{ tag: player.tag, socketId: socket.id }],
      ready: { [player.tag]: false },
      timeLimitSec: normalizeTimeLimitSec(payload.timeLimitSec),
      firstTurn: payload.firstTurn === 'guest' ? 'guest' : 'host',
      status: 'waiting',
      game: {
        board: emptyBoard(),
        turn: 'black',
        colorByTag: {},
        lastMove: null,
        winner: null,
        remainingMs: {},
        turnEndsAt: null,
        timer: null,
      },
    };

    rooms.set(roomId, room);
    socket.join(roomId);
    cb?.({ ok: true, room: serializeRoom(room) });
    broadcastRooms();
  });

  socket.on('room:join', ({ roomId, password }, cb) => {
    const player = players.get(socket.id);
    const room = rooms.get(roomId);
    if (!player || !room) return cb?.({ ok: false, error: '房間不存在或尚未登入' });
    if (room.players.length >= 2) return cb?.({ ok: false, error: '房間已滿' });
    if (room.password && room.password !== (password || '')) return cb?.({ ok: false, error: '密碼錯誤' });

    room.players.push({ tag: player.tag, socketId: socket.id });
    room.ready[player.tag] = false;
    socket.join(room.id);
    io.to(room.id).emit('room:updated', serializeRoom(room));
    cb?.({ ok: true, room: serializeRoom(room) });
    broadcastRooms();
  });

  socket.on('room:set-first-turn', (firstTurn, cb) => {
    const room = findRoomBySocket(socket.id);
    const player = players.get(socket.id);
    if (!room || !player || room.hostTag !== player.tag) return cb?.({ ok: false, error: '只有房主可設定先後手' });
    if (room.status !== 'waiting') return cb?.({ ok: false, error: '遊戲進行中不可更改' });
    room.firstTurn = firstTurn === 'guest' ? 'guest' : 'host';
    io.to(room.id).emit('room:updated', serializeRoom(room));
    broadcastRooms();
    cb?.({ ok: true });
  });

  socket.on('room:set-time', (timeLimitSec, cb) => {
    const room = findRoomBySocket(socket.id);
    const player = players.get(socket.id);
    if (!room || !player || room.hostTag !== player.tag) return cb?.({ ok: false, error: '只有房主可設定' });
    room.timeLimitSec = normalizeTimeLimitSec(timeLimitSec);
    io.to(room.id).emit('room:updated', serializeRoom(room));
    broadcastRooms();
    cb?.({ ok: true });
  });

  socket.on('room:ready', (ready, cb) => {
    const room = findRoomBySocket(socket.id);
    const player = players.get(socket.id);
    if (!room || !player) return cb?.({ ok: false, error: '未在房間內' });
    room.ready[player.tag] = Boolean(ready);
    io.to(room.id).emit('room:updated', serializeRoom(room));

    if (
      room.players.length === 2 &&
      room.players.every((p) => room.ready[p.tag]) &&
      room.status === 'waiting'
    ) {
      startGame(room);
    }
    cb?.({ ok: true });
    broadcastRooms();
  });

  socket.on('room:kick', (targetTag, cb) => {
    const room = findRoomBySocket(socket.id);
    const player = players.get(socket.id);
    if (!room || !player || room.hostTag !== player.tag) return cb?.({ ok: false, error: '只有房主可踢人' });
    const target = room.players.find((p) => p.tag === targetTag && p.tag !== room.hostTag);
    if (!target) return cb?.({ ok: false, error: '找不到玩家' });

    const targetSocket = io.sockets.sockets.get(target.socketId);
    targetSocket?.leave(room.id);
    targetSocket?.emit('room:kicked', room.id);

    room.players = room.players.filter((p) => p.tag !== targetTag);
    delete room.ready[targetTag];
    clearRoomTimer(room);
    resetGameState(room);
    io.to(room.id).emit('room:updated', serializeRoom(room));
    cb?.({ ok: true });
    broadcastRooms();
  });

  socket.on('game:move', ({ x, y }, cb) => {
    const room = findRoomBySocket(socket.id);
    const player = players.get(socket.id);
    if (!room || !player || room.status !== 'playing') return cb?.({ ok: false, error: '遊戲未開始' });
    const color = room.game.colorByTag[player.tag];
    if (!color || room.game.turn !== color) return cb?.({ ok: false, error: '尚未輪到你' });
    if (x < 0 || y < 0 || x >= BOARD_SIZE || y >= BOARD_SIZE) return cb?.({ ok: false, error: '超出範圍' });
    if (room.game.board[y][x]) return cb?.({ ok: false, error: '已有棋子' });

    if (room.timeLimitSec) {
      const elapsed = Date.now() - room.game.turnEndsAt + room.game.remainingMs[player.tag];
      room.game.remainingMs[player.tag] = Math.max(0, room.game.remainingMs[player.tag] - elapsed);
    }

    room.game.board[y][x] = color;
    room.game.lastMove = { x, y, tag: player.tag };

    const win = checkWinner(room.game.board, x, y, color);
    const draw = !win && isDraw(room.game.board);

    if (win || draw) {
      room.status = 'finished';
      clearRoomTimer(room);
      const winnerTag = win ? player.tag : null;
      io.to(room.id).emit('game:ended', {
        room: serializeRoom(room),
        board: room.game.board,
        winnerTag,
        reason: win ? 'five-in-row' : 'draw',
        lastMove: room.game.lastMove,
      });
      setTimeout(() => {
        resetGameState(room);
        io.to(room.id).emit('room:updated', serializeRoom(room));
        broadcastRooms();
      }, 2000);
      return cb?.({ ok: true });
    }

    room.game.turn = color === 'black' ? 'white' : 'black';
    io.to(room.id).emit('game:state', {
      board: room.game.board,
      turn: room.game.turn,
      remainingMs: room.game.remainingMs,
      lastMove: room.game.lastMove,
      room: serializeRoom(room),
    });
    tickTurn(room);
    cb?.({ ok: true });
  });

  socket.on('game:surrender', (cb) => {
    const room = findRoomBySocket(socket.id);
    const player = players.get(socket.id);
    if (!room || !player || room.status !== 'playing') return cb?.({ ok: false, error: '遊戲未開始' });
    const winnerTag = room.players.find((p) => p.tag !== player.tag)?.tag;
    room.status = 'finished';
    clearRoomTimer(room);
    io.to(room.id).emit('game:ended', {
      room: serializeRoom(room),
      board: room.game.board,
      winnerTag,
      reason: 'surrender',
      loserTag: player.tag,
    });
    setTimeout(() => {
      resetGameState(room);
      io.to(room.id).emit('room:updated', serializeRoom(room));
      broadcastRooms();
    }, 1500);
    cb?.({ ok: true });
  });


  socket.on('room:chat', (text, cb) => {
    const room = findRoomBySocket(socket.id);
    const player = players.get(socket.id);
    if (!room || !player || room.status !== 'playing') return cb?.({ ok: false, error: '目前不可聊天' });
    const safeText = String(text || '').trim().slice(0, 200);
    if (!safeText) return cb?.({ ok: false, error: '訊息不可為空' });
    const message = {
      tag: player.tag,
      text: safeText,
      time: new Date().toLocaleTimeString('zh-TW', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' }),
    };
    io.to(room.id).emit('room:chat', message);
    cb?.({ ok: true });
  });

  socket.on('room:leave', () => {
    const room = findRoomBySocket(socket.id);
    const player = players.get(socket.id);
    if (!room || !player) return;

    socket.leave(room.id);
    room.players = room.players.filter((p) => p.socketId !== socket.id);
    delete room.ready[player.tag];

    if (room.players.length === 0) {
      clearRoomTimer(room);
      rooms.delete(room.id);
    } else {
      if (room.hostTag === player.tag) {
        room.hostTag = room.players[0].tag;
      }
      clearRoomTimer(room);
      resetGameState(room);
      io.to(room.id).emit('room:updated', serializeRoom(room));
    }
    broadcastRooms();
  });

  socket.on('disconnect', () => {
    const room = findRoomBySocket(socket.id);
    const player = players.get(socket.id);
    players.delete(socket.id);
    if (!room || !player) return;

    room.players = room.players.filter((p) => p.socketId !== socket.id);
    delete room.ready[player.tag];
    if (room.players.length === 0) {
      clearRoomTimer(room);
      rooms.delete(room.id);
    } else {
      if (room.hostTag === player.tag) room.hostTag = room.players[0].tag;
      clearRoomTimer(room);
      resetGameState(room);
      io.to(room.id).emit('room:updated', serializeRoom(room));
    }
    broadcastRooms();
  });
});

app.use(express.static(path.join(__dirname, 'public')));

server.listen(PORT, () => {
  console.log(`GoBang server running at http://localhost:${PORT}`);
});
