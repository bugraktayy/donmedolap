const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 3000;
const DATA_FILE = path.join(__dirname, 'users.json');
const CHAT_FILE = path.join(__dirname, 'chat.json');

app.use(express.json());
app.use(express.static(__dirname));
// Doğrudan login sayfasına yönlendirme için
app.get('/login.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'login.html'));
});

// Tarayıcıdan direkt siteye girildiğinde login'e yönlendirmek istersen:
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'login.html'));
});

let db = { users: [] };
let chatDb = { messages: [] };

function loadData() {
    if (fs.existsSync(DATA_FILE)) {
        try { db = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); } catch (e) { db = { users: [] }; }
    }
    if (fs.existsSync(CHAT_FILE)) {
        try { chatDb = JSON.parse(fs.readFileSync(CHAT_FILE, 'utf8')); } catch (e) { chatDb = { messages: [] }; }
    }
}

function saveData() {
    fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2), 'utf8');
}

function saveChatData() {
    fs.writeFileSync(CHAT_FILE, JSON.stringify(chatDb, null, 2), 'utf8');
}

loadData();

// --- KULLANICI İŞLEMLERİ ---
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

// --- PARA YATIRMA İŞLEMLERİ ---
let depositRequests = [];

app.post('/api/deposit/request', (req, res) => {
    const { username, amount, senderName } = req.body;
    const parsedAmount = Number(amount);

    if (!username || isNaN(parsedAmount) || parsedAmount <= 0) {
        return res.status(400).json({ error: 'Geçersiz kullanıcı veya miktar!' });
    }

    const newRequest = {
        id: Date.now().toString(),
        username,
        senderName: senderName || username,
        amount: parsedAmount,
        status: 'pending',
        date: new Date().toLocaleString()
    };

    depositRequests.push(newRequest);
    res.json({ success: true, message: 'Para yatırma talebiniz alındı, onay bekleniyor.' });
});

app.get('/api/admin/deposits', (req, res) => {
    res.json({ deposits: depositRequests });
});

app.post('/api/admin/deposit/approve', (req, res) => {
    loadData();
    const { requestId } = req.body;
    const request = depositRequests.find(r => r.id === requestId);

    if (!request) {
        return res.status(404).json({ error: 'Talep bulunamadı!' });
    }

    if (request.status !== 'pending') {
        return res.status(400).json({ error: 'Bu talep zaten işlem görmüş!' });
    }

    const user = db.users.find(u => u.username === request.username);
    if (!user) {
        return res.status(404).json({ error: 'Kullanıcı bulunamadı!' });
    }

    user.balance = (user.balance || 0) + request.amount;
    request.status = 'approved';
    saveData();

    res.json({ success: true, message: 'Talep onaylandı ve bakiye kullanıcıya eklendi.' });
});

// --- ADMIN İŞLEMLERİ ---
app.get('/api/admin/users', (req, res) => {
    loadData();
    res.json({ success: true, users: db.users.map(u => ({ username: u.username, balance: u.balance || 0, securityQuestion: u.securityQuestion })) });
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

app.listen(PORT, () => {
    console.log(`Sunucu çalışıyor: http://localhost:${PORT}`);
});