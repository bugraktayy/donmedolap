const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json());
app.use(express.static(__dirname)); // Tüm dosyaları ana klasörden sunar

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Sabitler (Tek bir kez tanımlandı)
const JWT_SECRET = "gizli_anahtarim_123"; 
const DATA_FILE = path.join(__dirname, 'users.json');

// --- VERİTABANI YÖNETİMİ (JSON DOSYASI) ---
let db = {
    users: [],
    history: []
};

if (fs.existsSync(DATA_FILE)) {
    try {
        const fileData = fs.readFileSync(DATA_FILE, 'utf8');
        db = JSON.parse(fileData);
        console.log("Kayıtlı veriler 'users.json' dosyasından yüklendi.");
    } catch (e) {
        console.log("Veri dosyası okunamadı, boş başlatılıyor.");
    }
} else {
    saveData();
}

function saveData() {
    try {
        fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2), 'utf8');
    } catch (err) {
        console.error("Veri kaydedilemedi:", err);
    }
}
// ----------------------------------------

const wheelItems = [
    { id: 'banana', icon: '🍌', multiplier: 2 },
    { id: 'apple', icon: '🍎', multiplier: 3 },
    { id: 'grapes', icon: '🍇', multiplier: 5 },
    { id: 'orange', icon: '🍊', multiplier: 10 },
    { id: 'watermelon', icon: '🍉', multiplier: 15 },
    { id: 'strawberry', icon: '🍓', multiplier: 20 },
    { id: 'meat', icon: '🍗', multiplier: 45 }
];

let gameState = {
    timer: 20,
    status: 'betting', 
    bets: {} 
};

// Kayıt Ol API
app.post('/api/register', (req, res) => {
    const { username, password, securityQuestion, securityAnswer } = req.body;
    
    if (!username || !password) {
        return res.status(400).json({ error: 'Kullanıcı adı ve şifre zorunludur!' });
    }

    const existingUser = db.users.find(u => u.username === username);
    if (existingUser) {
        return res.status(400).json({ error: 'Bu kullanıcı adı zaten alınmış!' });
    }

    const newUser = {
        username,
        password,
        securityQuestion: securityQuestion || '',
        securityAnswer: securityAnswer || '',
        balance: 1000,
        lastBonusDate: null
    };

    db.users.push(newUser);
    saveData();

    res.json({ success: true, message: 'Kayıt başarılı!' });
});

// Giriş Yap API
app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    
    const user = db.users.find(u => u.username === username && u.password === password);
    if (!user) {
        return res.status(400).json({ error: 'Kullanıcı adı veya şifre hatalı!' });
    }

    const token = jwt.sign({ username: user.username }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, username: user.username, balance: user.balance });
});

// Güvenlik Sorusu Getir
app.get('/api/get-security-question', (req, res) => {
    const { username } = req.query;
    const user = db.users.find(u => u.username === username);
    if (!user) return res.status(404).json({ error: 'Kullanıcı bulunamadı!' });

    res.json({ question: user.securityQuestion || 'Güvenlik sorusu tanımlanmamış.' });
});

// Şifre Sıfırla
app.post('/api/reset-password', (req, res) => {
    const { username, securityAnswer, newPassword } = req.body;
    const user = db.users.find(u => u.username === username);
    
    if (!user) return res.status(404).json({ error: 'Kullanıcı bulunamadı!' });
    if (user.securityAnswer !== securityAnswer) {
        return res.status(400).json({ error: 'Güvenlik sorusu cevabı yanlış!' });
    }

    user.password = newPassword;
    saveData();

    res.json({ success: true, message: 'Şifre güncellendi!' });
});

// Günlük Bonus
app.post('/api/claim-bonus', (req, res) => {
    const { username } = req.body;
    const user = db.users.find(u => u.username === username);
    if (!user) return res.status(400).json({ error: 'Kullanıcı bulunamadı!' });

    const today = new Date().toDateString();
    if (user.lastBonusDate === today) {
        return res.status(400).json({ error: 'Bugün zaten bonusunuzu aldınız!' });
    }

    user.balance += 500;
    user.lastBonusDate = today;
    saveData();

    res.json({ success: true, newBalance: user.balance, message: '500 TL bonus eklendi!' });
});

// Socket.io Bağlantıları
io.on('connection', (socket) => {
    socket.emit('init_state', {
        items: wheelItems,
        leaderboard: getLeaderboard(),
        history: db.history.slice(-10)
    });

    socket.on('get_balance', (data) => {
        try {
            const decoded = jwt.verify(data.token, JWT_SECRET);
            const user = db.users.find(u => u.username === decoded.username);
            if (user) {
                socket.emit('balance_update', { newBalance: user.balance });
            }
        } catch (e) {}
    });

    socket.on('place_bet', (data) => {
        if (gameState.status !== 'betting') return socket.emit('error_msg', 'Şu an bahis yapamazsınız!');
        
        try {
            const decoded = jwt.verify(data.token, JWT_SECRET);
            const user = db.users.find(u => u.username === decoded.username);
            
            if (!user) return res.status(400).json({ error: 'Kullanıcı geçersiz!' });
            if (user.balance < data.amount) return socket.emit('error_msg', 'Yetersiz bakiye!');

            user.balance -= data.amount;
            saveData();

            if (!gameState.bets[socket.id]) {
                gameState.bets[socket.id] = { username: user.username, items: {} };
            }
            gameState.bets[socket.id].items[data.itemId] = (gameState.bets[socket.id].items[data.itemId] || 0) + data.amount;

            socket.emit('bet_confirmed', { newBalance: user.balance });
            io.emit('leaderboard_update', getLeaderboard());
        } catch (e) {
            socket.emit('error_msg', 'Yetkilendirme hatası!');
        }
    });

    socket.on('send_chat_message', (data) => {
        const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        io.emit('new_chat_message', { username: data.username, message: data.message, time });
    });

    socket.on('disconnect', () => {
        delete gameState.bets[socket.id];
    });
});

function getLeaderboard() {
    return [...db.users]
        .sort((a, b) => b.balance - a.balance)
        .slice(0, 5)
        .map(u => ({ username: u.username, balance: u.balance }));
}

setInterval(() => {
    gameState.timer--;

    if (gameState.timer <= 0) {
        if (gameState.status === 'betting') {
            gameState.status = 'spinning';
            const winnerIndex = Math.floor(Math.random() * wheelItems.length);
            const winningItem = wheelItems[winnerIndex];

            io.emit('spin_wheel', { winnerIndex });

            setTimeout(() => {
                db.history.push(winningItem);
                if (db.history.length > 20) db.history.shift();

                for (let socketId in gameState.bets) {
                    const betData = gameState.bets[socketId];
                    const userBets = betData.items;
                    const username = betData.username;

                    if (userBets[winningItem.id]) {
                        const betAmount = userBets[winningItem.id];
                        const winAmount = betAmount * winningItem.multiplier;
                        
                        const user = db.users.find(u => u.username === username);
                        if (user) {
                            user.balance += winAmount;
                            const socket = io.sockets.sockets.get(socketId);
                            if (socket) {
                                socket.emit('balance_update', { newBalance: user.balance });
                            }
                        }
                    }
                }

                saveData();
                io.emit('round_result', { history: db.history.slice(-10) });
                io.emit('leaderboard_update', getLeaderboard());

                gameState.bets = {};
                gameState.status = 'betting';
                gameState.timer = 20;
            }, 3000);
        }
    }

    io.emit('timer_update', { timer: gameState.timer });
}, 1000);

server.listen(3000, () => {
    console.log('Sunucu 3000 portunda çalışıyor...');
});