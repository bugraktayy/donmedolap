const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const JWT_SECRET = 'cark_oyunu_gizli_anahtar_12345';
const USERS_FILE = path.join(__dirname, 'users.json');

app.use(express.json());
app.use(express.static(__dirname)); // Ana dizindeki HTML dosyalarını okur

// KULLANICILARI DOSYADAN YÜKLE
let users = [];
if (fs.existsSync(USERS_FILE)) {
    try {
        users = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
    } catch (e) {
        users = [];
    }
}

function saveUsers() {
    fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
}

const securityQuestions = {};
const bonusTimers = {};

// Çark Öğeleri
const items = [
    { id: '1', icon: '🍌', multiplier: 2 },
    { id: '2', icon: '🍎', multiplier: 3 },
    { id: '3', icon: '🍇', multiplier: 5 },
    { id: '4', icon: '🍊', multiplier: 10 },
    { id: '5', icon: '🍉', multiplier: 15 },
    { id: '6', icon: '🍓', multiplier: 20 },
    { id: '7', icon: '🍗', multiplier: 45 }
];

let history = [];
let currentBets = [];
let timer = 20;
let isSpinning = false;
let forcedNextItem = null;

function getLeaderboard() {
    return users
        .map(u => ({ username: u.username, balance: u.balance }))
        .sort((a, b) => b.balance - a.balance)
        .slice(0, 5);
}

function getTableBetsSummary() {
    const summary = {};
    items.forEach(item => { summary[item.id] = 0; });
    currentBets.forEach(bet => {
        summary[bet.itemId] = (summary[bet.itemId] || 0) + bet.amount;
    });
    return summary;
}

// --- KULLANICI AUTH API ROTALARI ---
app.post('/api/register', (req, res) => {
    const { username, password, securityQuestion, securityAnswer, refCode } = req.body;
    if (!username || !password || !securityQuestion || !securityAnswer) {
        return res.status(400).json({ error: 'Tüm alanları doldurun!' });
    }
    if (users.find(u => u.username === username)) {
        return res.status(400).json({ error: 'Bu kullanıcı adı zaten alınmış.' });
    }

    let startingBalance = 1000;
    if (refCode) {
        const referrer = users.find(u => u.username === refCode);
        if (referrer) {
            referrer.balance += 250; 
            startingBalance += 250;
            saveUsers(); // Referans bonusu güncellendiğinde kaydet
        }
    }

    users.push({ username, password, balance: startingBalance });
    securityQuestions[username] = { question: securityQuestion, answer: securityAnswer.toLowerCase() };
    saveUsers(); // YENİ KULLANICIYI DOSYAYA KAYDET

    io.emit('leaderboard_update', getLeaderboard());
    res.json({ message: 'Kayıt başarılı! Giriş yapabilirsiniz.' });
});

app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    const user = users.find(u => u.username === username && u.password === password);
    if (!user) {
        return res.status(400).json({ error: 'Hatalı kullanıcı adı veya şifre!' });
    }
    const token = jwt.sign({ username: user.username }, JWT_SECRET);
    res.json({ token, username: user.username, balance: user.balance });
});

app.get('/api/get-security-question', (req, res) => {
    const { username } = req.query;
    const qData = securityQuestions[username];
    if (!qData) return res.status(404).json({ error: 'Kullanıcı bulunamadı!' });
    res.json({ question: qData.question });
});

app.post('/api/reset-password', (req, res) => {
    const { username, newPassword, securityAnswer } = req.body;
    const qData = securityQuestions[username];
    const user = users.find(u => u.username === username);

    if (!user || !qData) return res.status(400).json({ error: 'Kullanıcı bulunamadı!' });
    if (qData.answer !== securityAnswer.toLowerCase()) {
        return res.status(400).json({ error: 'Güvenlik sorusu cevabı yanlış!' });
    }

    user.password = newPassword;
    saveUsers(); // Şifre değişince kaydet
    res.json({ message: 'Şifreniz başarıyla güncellendi. Giriş yapabilirsiniz.' });
});

app.post('/api/claim-bonus', (req, res) => {
    const { username } = req.body;
    const user = users.find(u => u.username === username);
    if (!user) return res.status(400).json({ error: 'Kullanıcı bulunamadı!' });

    const now = Date.now();
    const lastClaim = bonusTimers[username] || 0;
    const cooldown = 24 * 60 * 60 * 1000; 

    if (now - lastClaim < cooldown) {
        const remainingHours = Math.ceil((cooldown - (now - lastClaim)) / (1000 * 60 * 60));
        return res.status(400).json({ error: `Bonus almak için ${remainingHours} saat beklemelisiniz!` });
    }

    user.balance += 500;
    bonusTimers[username] = now;
    saveUsers(); // Bakiye değişince kaydet

    io.emit('leaderboard_update', getLeaderboard());
    res.json({ message: '🎁 500 TL Günlük bonus bakiyenize eklendi!', newBalance: user.balance });
});

// --- ADMIN PANEL API ROTALARI ---
app.get('/api/admin/stats', (req, res) => {
    const totalUsers = users.length;
    const totalBalance = users.reduce((acc, u) => acc + u.balance, 0);
    res.json({
        totalUsers,
        totalBalance,
        activeBetsCount: currentBets.length,
        historyCount: history.length
    });
});

app.get('/api/admin/users', (req, res) => {
    const userList = users.map(u => ({
        username: u.username,
        balance: u.balance
    }));
    res.json(userList);
});

app.post('/api/admin/set-number', (req, res) => {
    const { number } = req.body;
    forcedNextItem = number;
    res.json({ message: `Sonraki çark sonucu ayarlandı: ${number}` });
});

// --- SOCKET.IO ---
io.on('connection', (socket) => {
    socket.emit('init_state', {
        items,
        history,
        leaderboard: getLeaderboard(),
        tableBets: getTableBetsSummary()
    });

    socket.on('place_bet', (data) => {
        if (isSpinning) return socket.emit('error_msg', 'Tur devam ederken bahis yapılamaz!');
        
        try {
            const decoded = jwt.verify(data.token, JWT_SECRET);
            const user = users.find(u => u.username === decoded.username);

            if (!user) return socket.emit('error_msg', 'Kullanıcı bulunamadı!');
            if (user.balance < data.amount) return socket.emit('error_msg', 'Yetersiz bakiye!');

            user.balance -= data.amount;
            saveUsers(); // Bahis oynandığında bakiyeyi kaydet

            currentBets.push({
                username: user.username,
                socketId: socket.id,
                itemId: data.itemId,
                amount: data.amount
            });

            socket.emit('bet_confirmed', { newBalance: user.balance });
            io.emit('table_bets_update', getTableBetsSummary());
            io.emit('leaderboard_update', getLeaderboard());
        } catch (e) {
            socket.emit('error_msg', 'Oturum geçersiz!');
        }
    });

    socket.on('send_chat_message', (data) => {
        const time = new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
        io.emit('new_chat_message', { username: data.username, message: data.message, time });
    });
});

// OYUN DÖNGÜSÜ
setInterval(() => {
    if (!isSpinning) {
        timer--;
        io.emit('timer_update', { timer });

        if (timer <= 0) {
            isSpinning = true;
            timer = 20;

            let winnerIndex;
            if (forcedNextItem !== null && forcedNextItem !== undefined && forcedNextItem !== "") {
                winnerIndex = items.findIndex(i => i.id === String(forcedNextItem));
                if (winnerIndex === -1) winnerIndex = Math.floor(Math.random() * items.length);
                forcedNextItem = null;
            } else {
                winnerIndex = Math.floor(Math.random() * items.length);
            }

            const winnerItem = items[winnerIndex];
            io.emit('spin_wheel', { winnerIndex, winnerItem });

            setTimeout(() => {
                currentBets.forEach(bet => {
                    if (bet.itemId === winnerItem.id) {
                        const winAmount = bet.amount * winnerItem.multiplier;
                        const user = users.find(u => u.username === bet.username);
                        if (user) {
                            user.balance += winAmount;
                            saveUsers(); // Kazanılan ikramiyeyi kaydet
                            io.to(bet.socketId).emit('balance_update', {
                                newBalance: user.balance,
                                message: `🎉 TEBRİKLER! ${winnerItem.icon} ile ${winAmount} TL kazandınız!`
                            });
                        }
                    }
                });

                history.unshift(winnerItem);
                if (history.length > 10) history.pop();

                io.emit('round_result', { winnerItem, history });
                io.emit('leaderboard_update', getLeaderboard());

                currentBets = [];
                io.emit('table_bets_update', getTableBetsSummary());
                isSpinning = false;
            }, 5000);
        }
    }
}, 1000);

server.listen(PORT, () => {
    console.log(`🚀 Sunucu ${PORT} portunda yayında!`);
});