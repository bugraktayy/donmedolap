const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = 3000;
const DATA_FILE = path.join(__dirname, 'users.json');

app.use(express.json());
app.use(express.static(__dirname));

let db = { users: [] };
let depositRequests = [];

function loadData() {
    if (fs.existsSync(DATA_FILE)) {
        try { db = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); } catch (e) { db = { users: [] }; }
    }
}

function saveData() {
    fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2), 'utf8');
}

loadData();

// --- KULLANICI ROTALARI ---
app.get('/api/user', (req, res) => {
    loadData();
    const { username } = req.query;
    const user = db.users.find(u => u.username === username);
    if (!user) return res.status(404).json({ error: 'Kullanıcı bulunamadı!' });
    res.json({ user: { username: user.username, balance: user.balance || 0 } });
});

app.post('/api/login', (req, res) => {
    loadData();
    const { username, password } = req.body;
    const user = db.users.find(u => u.username === username && u.password === password);
    if (!user) return res.status(401).json({ error: 'Hatalı kullanıcı adı veya şifre!' });
    res.json({ success: true, username: user.username });
});

app.post('/api/register', (req, res) => {
    loadData();
    const { username, password, securityQuestion, securityAnswer } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Eksik bilgi!' });
    if (db.users.some(u => u.username === username)) return res.status(400).json({ error: 'Bu kullanıcı adı zaten alınmış!' });

    db.users.push({ username, password, securityQuestion: securityQuestion || '', securityAnswer: securityAnswer || '', balance: 1000 });
    saveData();
    res.json({ success: true });
});

// --- PARA YATIRMA ROTALARI ---
app.post('/api/deposit/request', (req, res) => {
    const { username, amount, senderName } = req.body;
    const parsedAmount = Number(amount);
    if (!username || isNaN(parsedAmount) || parsedAmount <= 0) return res.status(400).json({ error: 'Geçersiz miktar!' });

    depositRequests.push({
        id: Date.now().toString(),
        username,
        senderName: senderName || username,
        amount: parsedAmount,
        status: 'pending',
        date: new Date().toLocaleString()
    });
    res.json({ success: true, message: 'Yatırım talebi alındı, onay bekleniyor.' });
});

app.get('/api/admin/deposits', (req, res) => {
    res.json({ deposits: depositRequests });
});

app.post('/api/admin/deposit/approve', (req, res) => {
    loadData();
    const { requestId } = req.body;
    const request = depositRequests.find(r => r.id === requestId);
    if (!request) return res.status(404).json({ error: 'Talep bulunamadı!' });
    if (request.status !== 'pending') return res.status(400).json({ error: 'Bu talep zaten işlem görmüş!' });

    const user = db.users.find(u => u.username === request.username);
    if (!user) return res.status(404).json({ error: 'Kullanıcı bulunamadı!' });

    user.balance = (user.balance || 0) + request.amount;
    request.status = 'approved';
    saveData();

    res.json({ success: true, message: 'Talep onaylandı ve bakiye eklendi.' });
});

// --- ÇARK OYUNU ROTOSU ---
app.post('/api/game/wheel', (req, res) => {
    loadData();
    const { username, betAmount, symbol } = req.body;
    const user = db.users.find(u => u.username === username);
    if (!user) return res.status(404).json({ error: 'Kullanıcı bulunamadı!' });
    if (user.balance < betAmount || betAmount <= 0) return res.status(400).json({ error: 'Yetersiz bakiye!' });

    user.balance -= Number(betAmount);

    const items = [
        { id: 'watermelon', name: 'Karpuz', multiplier: 5 },
        { id: 'orange', name: 'Portakal', multiplier: 5 },
        { id: 'apple', name: 'Elma', multiplier: 5 },
        { id: 'fish', name: 'Balık', multiplier: 10 },
        { id: 'burger', name: 'Burger', multiplier: 15 },
        { id: 'chicken', name: 'Tavuk', multiplier: 25 },
        { id: 'meat', name: 'Et', multiplier: 45 }
    ];

    const winningItem = items[Math.floor(Math.random() * items.length)];
    let wonAmount = 0;

    if (winningItem.id === symbol) {
        wonAmount = betAmount * winningItem.multiplier;
        user.balance += wonAmount;
    }

    saveData();
    res.json({ success: true, winningItem, wonAmount, newBalance: user.balance });
});

// --- ADMIN KULLANICI YÖNETİMİ ---
app.get('/api/admin/users', (req, res) => {
    loadData();
    res.json({ success: true, users: db.users.map(u => ({ username: u.username, balance: u.balance || 0 })) });
});

app.post('/api/admin/update-balance', (req, res) => {
    loadData();
    const { username, newBalance } = req.body;
    const user = db.users.find(u => u.username === username);
    if (!user) return res.status(404).json({ error: 'Kullanıcı bulunamadı!' });

    user.balance = Number(newBalance);
    saveData();
    res.json({ success: true });
});

app.post('/api/admin/delete-user', (req, res) => {
    loadData();
    const { username } = req.body;
    db.users = db.users.filter(u => u.username !== username);
    saveData();
    res.json({ success: true });
});

// --- SOCKET.IO SES AKTARIMI ---
io.on('connection', (socket) => {
    socket.on('voice-stream', (audioData) => {
        socket.broadcast.emit('voice-stream', audioData);
    });
});

server.listen(PORT, () => {
    console.log(`Sunucu çalışıyor: http://localhost:${PORT}`);
});