const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const path = require('path');

const app = express();
const server = http.createServer(app);

const JWT_SECRET = process.env.JWT_SECRET || 'nakayoshi-chat-secret-2024';
const CLIENT_URL = process.env.CLIENT_URL || '*';

const io = new Server(server, {
  cors: { origin: CLIENT_URL, methods: ['GET', 'POST'] }
});

app.use(cors({ origin: CLIENT_URL }));
app.use(express.json({ limit: '5mb' }));
app.use(express.static(path.join(__dirname, '../client/public')));

// ====== IN-MEMORY DB ======
const users = new Map(); // username -> { id, username, password, role, icon, banned, ipBanned, socketId, ip }
const rooms = new Map(); // roomId -> { id, name, icon, createdBy, messages: [], members: Set }
const bannedIPs = new Set();
const connectedSockets = new Map(); // socketId -> { username, ip }
const spamTracker = new Map(); // username -> [timestamps]
const kickedUsers = new Set(); // temporary kick (session)
let adminLoginEnabled = true;
let adminSignupEnabled = true;

// Default room
rooms.set('general', {
  id: 'general',
  name: '🌸 ロビー',
  icon: '🏠',
  createdBy: 'system',
  messages: [],
  members: new Set()
});

// Admin accounts
const ADMIN_CREDENTIALS = {
  admin: { password: 'yuj88433', role: 'admin' },
  subadmin: { password: 'kjn6654', role: 'subadmin' }
};

// ====== SPAM DETECTION ======
function isSpam(username) {
  const now = Date.now();
  const times = spamTracker.get(username) || [];
  const recent = times.filter(t => now - t < 3000); // 3秒以内
  recent.push(now);
  spamTracker.set(username, recent);
  return recent.length > 5; // 3秒に5回以上
}

// ====== OMIKUJI ======
const omikujiResults = [
  { result: '大吉', msg: '最高の運気！何でも上手くいく日です！🌟', color: '#FFD700' },
  { result: '吉', msg: '良い一日になりそうです！前向きに進みましょう！✨', color: '#90EE90' },
  { result: '中吉', msg: 'まずまずの運気。丁寧に過ごすと良いでしょう🌿', color: '#87CEEB' },
  { result: '小吉', msg: '小さな幸せを見つけてみて！🍀', color: '#DDA0DD' },
  { result: '末吉', msg: '焦らずゆっくり。後から良くなります🌱', color: '#F0E68C' },
  { result: '凶', msg: '今日は慎重に。休息が大事です🌙', color: '#FFA07A' },
  { result: '大凶', msg: '試練の日。でも乗り越えれば強くなれます！💪', color: '#FF6B6B' }
];

// ====== AUTH ROUTES ======
app.post('/api/signup', async (req, res) => {
  const { username, password, icon } = req.body;
  if (!username || !password) return res.status(400).json({ error: '名前とパスワードが必要です' });
  if (username.length < 2 || username.length > 20) return res.status(400).json({ error: '名前は2〜20文字にしてください' });
  if (password.length < 4) return res.status(400).json({ error: 'パスワードは4文字以上にしてください' });
  if (users.has(username)) return res.status(400).json({ error: 'この名前はすでに使われています' });
  if (ADMIN_CREDENTIALS[username]) return res.status(400).json({ error: 'この名前は使えません' });

  const hashed = await bcrypt.hash(password, 10);
  const user = { id: uuidv4(), username, password: hashed, role: 'user', icon: icon || '😊', banned: false, ipBanned: false };
  users.set(username, user);
  const token = jwt.sign({ id: user.id, username, role: 'user' }, JWT_SECRET, { expiresIn: '7d' });
  res.json({ token, user: { id: user.id, username, role: 'user', icon: user.icon } });
});

app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: '名前とパスワードが必要です' });

  const user = users.get(username);
  if (!user) return res.status(401).json({ error: 'ユーザーが見つかりません' });
  if (user.banned) return res.status(403).json({ error: 'BANされています' });

  const valid = await bcrypt.compare(password, user.password);
  if (!valid) return res.status(401).json({ error: 'パスワードが違います' });

  const token = jwt.sign({ id: user.id, username, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
  res.json({ token, user: { id: user.id, username, role: user.role, icon: user.icon } });
});

app.post('/api/admin/login', async (req, res) => {
  if (!adminLoginEnabled) return res.status(403).json({ error: '管理者ログインは現在無効です' });
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: '名前とパスワードを入力してください' });

  // パスワードで役職を判定（名前は自由）
  let role = null;
  if (password === 'yuj88433') role = 'admin';
  else if (password === 'kjn6654') role = 'subadmin';

  if (!role) return res.status(401).json({ error: '管理者パスワードが違います' });

  const displayName = username || (role === 'admin' ? 'admin' : 'subadmin');
  const icon = role === 'admin' ? '👑' : '⭐';
  const token = jwt.sign({ id: displayName, username: displayName, role }, JWT_SECRET, { expiresIn: '1d' });
  res.json({ token, user: { id: displayName, username: displayName, role, icon } });
});

app.post('/api/admin/signup', async (req, res) => {
  if (!adminSignupEnabled) return res.status(403).json({ error: '管理者登録は現在無効です' });
  const { username, password } = req.body;
  const cred = ADMIN_CREDENTIALS[username];
  if (!cred || cred.password !== password) return res.status(401).json({ error: '管理者認証に失敗しました' });
  res.json({ message: '管理者としてログインしてください', username, role: cred.role });
});

app.get('/api/rooms', (req, res) => {
  const roomList = Array.from(rooms.values()).map(r => ({
    id: r.id, name: r.name, icon: r.icon, createdBy: r.createdBy,
    memberCount: r.members.size
  }));
  res.json(roomList);
});

app.get('/api/admin/settings', (req, res) => {
  res.json({ adminLoginEnabled, adminSignupEnabled });
});

app.post('/api/admin/settings', (req, res) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: '認証が必要です' });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded.role !== 'admin') return res.status(403).json({ error: '権限がありません' });
    if (req.body.adminLoginEnabled !== undefined) adminLoginEnabled = req.body.adminLoginEnabled;
    if (req.body.adminSignupEnabled !== undefined) adminSignupEnabled = req.body.adminSignupEnabled;
    res.json({ adminLoginEnabled, adminSignupEnabled });
  } catch { res.status(401).json({ error: '無効なトークン' }); }
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../client/public/index.html'));
});

// ====== SOCKET.IO ======
function verifyToken(token) {
  try { return jwt.verify(token, JWT_SECRET); } catch { return null; }
}

io.on('connection', (socket) => {
  const clientIP = socket.handshake.headers['x-forwarded-for'] || socket.handshake.address;

  if (bannedIPs.has(clientIP)) {
    socket.emit('error_msg', 'あなたのIPはBANされています');
    socket.disconnect();
    return;
  }

  let currentUser = null;
  let currentRoom = null;

  socket.on('authenticate', (token) => {
    const decoded = verifyToken(token);
    if (!decoded) { socket.emit('auth_error', '認証に失敗しました'); return; }

    // Check if user account is banned
    if (decoded.role === 'user') {
      const u = users.get(decoded.username);
      if (u?.banned) { socket.emit('auth_error', 'BANされています'); socket.disconnect(); return; }
    }

    currentUser = { ...decoded, ip: clientIP, socketId: socket.id };
    connectedSockets.set(socket.id, { username: decoded.username, ip: clientIP, role: decoded.role });

    // Update socket id in users map
    if (users.has(decoded.username)) {
      const u = users.get(decoded.username);
      u.socketId = socket.id;
      u.ip = clientIP;
    }

    socket.emit('authenticated', { username: decoded.username, role: decoded.role, id: decoded.id });
    socket.emit('room_list', Array.from(rooms.values()).map(r => ({
      id: r.id, name: r.name, icon: r.icon, memberCount: r.members.size
    })));
  });

  socket.on('join_room', (roomId) => {
    if (!currentUser) return;
    if (!rooms.has(roomId)) { socket.emit('error_msg', '部屋が見つかりません'); return; }

    if (currentRoom) {
      socket.leave(currentRoom);
      const oldRoom = rooms.get(currentRoom);
      if (oldRoom) oldRoom.members.delete(currentUser.username);
      io.to(currentRoom).emit('user_left', { username: currentUser.username });
      io.emit('room_update', { id: currentRoom, memberCount: oldRoom?.members.size || 0 });
    }

    currentRoom = roomId;
    socket.join(roomId);
    const room = rooms.get(roomId);
    room.members.add(currentUser.username);

    const recentMessages = room.messages.slice(-50);
    socket.emit('room_joined', { room: { id: room.id, name: room.name, icon: room.icon }, messages: recentMessages });
    io.to(roomId).emit('user_joined', { username: currentUser.username, role: currentUser.role });
    io.emit('room_update', { id: roomId, memberCount: room.members.size });

    // Online users in room
    const onlineUsers = Array.from(room.members).map(uname => {
      const sc = Array.from(connectedSockets.values()).find(s => s.username === uname);
      const u = users.get(uname);
      return { username: uname, role: sc?.role || 'user', icon: u?.icon || '😊' };
    });
    io.to(roomId).emit('room_users', onlineUsers);
  });

  socket.on('create_room', ({ name, icon }) => {
    if (!currentUser) return;
    if (!name || name.length < 1 || name.length > 30) { socket.emit('error_msg', '部屋名は1〜30文字にしてください'); return; }
    const roomId = uuidv4();
    rooms.set(roomId, { id: roomId, name, icon: icon || '💬', createdBy: currentUser.username, messages: [], members: new Set() });
    io.emit('room_list_update', Array.from(rooms.values()).map(r => ({
      id: r.id, name: r.name, icon: r.icon, memberCount: r.members.size
    })));
  });

  socket.on('send_message', ({ content, type }) => {
    if (!currentUser || !currentRoom) return;
    if (!content || content.length > 500) return;

    // Spam check
    if (isSpam(currentUser.username)) {
      socket.emit('error_msg', '⚠️ スパム検出: 少し待ってから送信してください');
      return;
    }

    const user = users.get(currentUser.username);
    const icon = currentUser.role === 'admin' ? '👑' : currentUser.role === 'subadmin' ? '⭐' : (user?.icon || '😊');

    // COMMANDS
    if (content.startsWith('/')) {
      handleCommand(socket, currentUser, currentRoom, content, icon);
      return;
    }

    const message = {
      id: uuidv4(),
      username: currentUser.username,
      role: currentUser.role,
      icon,
      content,
      type: type || 'text',
      timestamp: Date.now()
    };

    const room = rooms.get(currentRoom);
    if (room) {
      room.messages.push(message);
      if (room.messages.length > 200) room.messages.shift();
    }

    io.to(currentRoom).emit('new_message', message);
  });

  socket.on('private_message', ({ targetUsername, content }) => {
    if (!currentUser || !content) return;

    const targetSocket = Array.from(connectedSockets.entries()).find(([, v]) => v.username === targetUsername);
    if (!targetSocket) { socket.emit('error_msg', `${targetUsername} はオンラインではありません`); return; }

    const user = users.get(currentUser.username);
    const icon = currentUser.role === 'admin' ? '👑' : currentUser.role === 'subadmin' ? '⭐' : (user?.icon || '😊');

    const pm = {
      id: uuidv4(),
      from: currentUser.username,
      to: targetUsername,
      icon,
      content,
      type: 'pm',
      timestamp: Date.now()
    };

    socket.emit('private_message', pm);
    io.to(targetSocket[0]).emit('private_message', pm);
  });

  function handleCommand(socket, user, roomId, content, icon) {
    const parts = content.trim().split(' ');
    const cmd = parts[0].toLowerCase();

    // /おみくじ - all users
    if (cmd === '/おみくじ') {
      const idx = Math.floor(Math.random() * omikujiResults.length);
      const result = omikujiResults[idx];
      const message = {
        id: uuidv4(), username: user.username, role: user.role, icon,
        content: `🎋 おみくじ結果: 【${result.result}】 ${result.msg}`,
        type: 'system', omikuji: result, timestamp: Date.now()
      };
      const room = rooms.get(roomId);
      if (room) { room.messages.push(message); if (room.messages.length > 200) room.messages.shift(); }
      io.to(roomId).emit('new_message', message);
      return;
    }

    // /msg - all users
    if (cmd === '/msg') {
      const targetId = parts[1];
      const pmContent = parts.slice(2).join(' ');
      if (!targetId || !pmContent) { socket.emit('error_msg', '使い方: /msg {ユーザー名} {メッセージ}'); return; }
      const targetSocket = Array.from(connectedSockets.entries()).find(([, v]) => v.username === targetId);
      if (!targetSocket) { socket.emit('error_msg', `${targetId} はオンラインではありません`); return; }
      const userData = users.get(user.username);
      const userIcon = user.role === 'admin' ? '👑' : user.role === 'subadmin' ? '⭐' : (userData?.icon || '😊');
      const pm = { id: uuidv4(), from: user.username, to: targetId, icon: userIcon, content: pmContent, type: 'pm', timestamp: Date.now() };
      socket.emit('private_message', pm);
      io.to(targetSocket[0]).emit('private_message', pm);
      return;
    }

    // subadmin+ commands
    if (user.role === 'admin' || user.role === 'subadmin') {
      if (cmd === '/ban') {
        const target = parts[1];
        if (!target) { socket.emit('error_msg', '使い方: /ban {ユーザー名}'); return; }
        const targetUser = users.get(target);
        if (!targetUser) { socket.emit('error_msg', 'ユーザーが見つかりません'); return; }
        if (targetUser.role !== 'user') { socket.emit('error_msg', '一般ユーザーのみBANできます'); return; }
        targetUser.banned = true;
        const targetSock = Array.from(connectedSockets.entries()).find(([, v]) => v.username === target);
        if (targetSock) { io.to(targetSock[0]).emit('banned', 'BANされました'); io.sockets.sockets.get(targetSock[0])?.disconnect(); }
        const sys = { id: uuidv4(), username: 'SYSTEM', role: 'system', icon: '🔨', content: `${target} がBANされました`, type: 'system', timestamp: Date.now() };
        io.to(roomId).emit('new_message', sys);
        return;
      }

      if (cmd === '/kick') {
        const target = parts[1];
        if (!target) { socket.emit('error_msg', '使い方: /kick {ユーザー名}'); return; }
        const targetUser = users.get(target);
        if (!targetUser) { socket.emit('error_msg', 'ユーザーが見つかりません'); return; }
        if (targetUser.role !== 'user') { socket.emit('error_msg', '一般ユーザーのみKICKできます'); return; }
        const targetSock = Array.from(connectedSockets.entries()).find(([, v]) => v.username === target);
        if (targetSock) { io.to(targetSock[0]).emit('kicked', 'KICKされました'); io.sockets.sockets.get(targetSock[0])?.disconnect(); }
        const sys = { id: uuidv4(), username: 'SYSTEM', role: 'system', icon: '👢', content: `${target} がKICKされました`, type: 'system', timestamp: Date.now() };
        io.to(roomId).emit('new_message', sys);
        return;
      }
    }

    // admin only commands
    if (user.role === 'admin') {
      if (cmd === '/ipban') {
        const target = parts[1];
        if (!target) { socket.emit('error_msg', '使い方: /ipban {ユーザー名}'); return; }
        const targetInfo = Array.from(connectedSockets.entries()).find(([, v]) => v.username === target);
        if (!targetInfo) { socket.emit('error_msg', 'ユーザーが見つかりません（オフライン？）'); return; }
        const targetIP = targetInfo[1].ip;
        bannedIPs.add(targetIP);
        const targetUser = users.get(target);
        if (targetUser) targetUser.ipBanned = true;
        io.to(targetInfo[0]).emit('banned', 'IPBANされました');
        io.sockets.sockets.get(targetInfo[0])?.disconnect();
        const sys = { id: uuidv4(), username: 'SYSTEM', role: 'system', icon: '🚫', content: `${target} がIPBANされました`, type: 'system', timestamp: Date.now() };
        io.to(roomId).emit('new_message', sys);
        return;
      }

      if (cmd === '/unipban') {
        const target = parts[1];
        if (!target) { socket.emit('error_msg', '使い方: /unipban {ユーザー名}'); return; }
        const targetUser = users.get(target);
        if (targetUser?.ipBanned) {
          targetUser.ipBanned = false;
          socket.emit('error_msg', `${target} のIPBANを解除しました（再接続が必要です）`);
        } else {
          socket.emit('error_msg', `${target} はIPBANされていません`);
        }
        return;
      }

      if (cmd === '/chatkill') {
        const room = rooms.get(roomId);
        if (room) room.messages = [];
        const sys = { id: uuidv4(), username: 'SYSTEM', role: 'system', icon: '💥', content: 'チャット履歴が削除されました', type: 'system', timestamp: Date.now() };
        io.to(roomId).emit('chat_cleared');
        io.to(roomId).emit('new_message', sys);
        return;
      }
    }

    socket.emit('error_msg', `不明なコマンド: ${cmd}`);
  }

  socket.on('disconnect', () => {
    if (currentUser && currentRoom) {
      const room = rooms.get(currentRoom);
      if (room) {
        room.members.delete(currentUser.username);
        io.to(currentRoom).emit('user_left', { username: currentUser.username });
        io.emit('room_update', { id: currentRoom, memberCount: room.members.size });
      }
    }
    connectedSockets.delete(socket.id);
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => console.log(`🌸 仲良しチャット起動中: http://localhost:${PORT}`));
