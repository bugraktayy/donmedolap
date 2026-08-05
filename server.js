const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

// MongoDB Bağlantısı (Render Environment Variables kısmından MONGO_URL ekleyebilirsin)
const MONGO_URL = process.env.MONGO_URL || 'mongodb+srv://kullaniciadi:sifre@cluster.mongodb.net/oyunplatformu?retryWrites=true&w=majority';

mongoose.connect(MONGO_URL)
    .then(() => console.log('MongoDB veritabanına başarıyla bağlanıldı!'))
    .catch(err => console.error('MongoDB bağlantı hatası:', err));

// --- ŞEMALAR VE MODELLER ---
const userSchema = new mongoose.Schema({
    username: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    securityQuestion: { type: String, default: '' },
    securityAnswer: { type: String, default: '' },
    balance: { type: Number, default: 1000 },
    lastBonusDate: { type: String, default: '' }
});
const User = mongoose.model('User', userSchema);

const logSchema = new mongoose.Schema({
    type: { type: String, required: true },
    message: { type: String, required: true },
    date: { type: String, default: () => new Date().toLocaleString() }
});
const Log = mongoose.model('Log', logSchema);

async function addLog(type, message) {
    try {
        await new Log({ type, message }).save();
    } catch (err) {
        console.error('Log kaydedilemedi:', err);
    }
}

// Bellekte tutulan yatırım talepleri
let depositRequests = [];

app.use(express.json());
app.use(express.static(__dirname));

// --- KULLANICI & AUTH ---
app.get('/api/user', async (req, res) => {
    try {
        const { username } = req.query;
        const user = await User.findOne({ username });
        if (!user) return res.status(404).json({ error: 'Kullanıcı bulunamadı!' });
        res.json({ user: { username: user.username, balance: user.balance || 0 } });
    } catch (err) {
        res.status(500).json({ error: 'Sunucu hatası!' });
    }
});

app.post('/api/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        const user = await User.findOne({ username, password });
        if (!user) return res.status(401).json({ error: 'Hatalı kullanıcı adı veya şifre!' });
        
        await addLog('LOGIN', `${username} sisteme giriş yaptı.`);
        res.json({ success: true, username: user.username });
    } catch (err) {
        res.status(500).json({ error: 'Giriş yapılamadı!' });
    }
});

app.post('/api/register', async (req, res) => {
    try {
        const { username, password, securityQuestion, securityAnswer } = req.body;
        if (!username || !password) return res.status(400).json({ error: 'Eksik bilgi!' });

        const existingUser = await User.findOne({ username });
        if (existingUser) return res.status(400).json({ error: 'Bu kullanıcı adı zaten alınmış!' });

        const newUser = new User({
            username,
            password,
            securityQuestion: securityQuestion || '',
            securityAnswer: securityAnswer || '',
            balance: 1000,
            lastBonusDate: ''
        });
        await newUser.save();

        await addLog('REGISTER', `Yeni kullanıcı kayıt oldu: ${username}`);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Kayıt oluşturulamadı!' });
    }
});

// --- GÜNLÜK BONUS ---
app.post('/api/bonus/daily', async (req, res) => {
    try {
        const { username } = req.body;
        const user = await User.findOne({ username });
        if (!user) return res.status(404).json({ error: 'Kullanıcı bulunamadı!' });

        const today = new Date().toDateString();
        if (user.lastBonusDate === today) {
            return res.status(400).json({ error: 'Bugünkü günlük bonusunu zaten aldın! Yarın tekrar dene.' });
        }

        user.balance = (user.balance || 0) + 250;
        user.lastBonusDate = today;
        await user.save();

        await addLog('BONUS', `${username} günlük 250 TL bonusunu aldı.`);
        res.json({ success: true, message: 'Tebrikler! 250 TL günlük bonus hesabına eklendi 🎁' });
    } catch (err) {
        res.status(500).json({ error: 'Bonus alınamadı!' });
    }
});

// --- PARA YATIRMA İŞLEMLERİ ---
app.post('/api/deposit/request', async (req, res) => {
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

    await addLog('DEPOSIT', `${username} tarafından ${parsedAmount} TL yatırım talebi oluşturuldu.`);
    res.json({ success: true, message: 'Yatırım talebi alındı, onay bekleniyor.' });
});

app.get('/api/admin/deposits', (req, res) => {
    res.json({ deposits: depositRequests });
});

app.post('/api/admin/deposit/approve', async (req, res) => {
    try {
        const { requestId } = req.body;
        const request = depositRequests.find(r => r.id === requestId);
        if (!request || request.status !== 'pending') return res.status(404).json({ error: 'Geçersiz talep!' });

        const user = await User.findOne({ username: request.username });
        if (!user) return res.status(404).json({ error: 'Kullanıcı bulunamadı!' });

        user.balance = (user.balance || 0) + request.amount;
        request.status = 'approved';
        await user.save();

        await addLog('ADMIN', `${request.username} adlı kullanıcıya ${request.amount} TL yatırım onaylandı.`);
        res.json({ success: true, message: 'Talep onaylandı ve bakiye eklendi.' });
    } catch (err) {
        res.status(500).json({ error: 'Onaylama sırasında hata oluştu!' });
    }
});

// --- ÇARK OYUNU ---
app.post('/api/game/wheel', async (req, res) => {
    try {
        const { username, betAmount, symbol } = req.body;
        const user = await User.findOne({ username });
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
            io.emit('new-winner', { username: user.username, amount: wonAmount, symbol: winningItem.name });
            await addLog('GAME', `${user.username} çark oyunundan ${wonAmount} TL kazandı (${winningItem.name}).`);
        }

        await user.save();
        res.json({ success: true, winningItem, wonAmount, newBalance: user.balance });
    } catch (err) {
        res.status(500).json({ error: 'Oyun işlenirken hata oluştu!' });
    }
});

// --- ADMIN KULLANICI & LOG YÖNETİMİ ---
app.get('/api/admin/users', async (req, res) => {
    try {
        const users = await User.find({});
        res.json({ success: true, users: users.map(u => ({ username: u.username, balance: u.balance || 0 })) });
    } catch (err) {
        res.status(500).json({ error: 'Kullanıcılar alınamadı!' });
    }
});

app.post('/api/admin/update-balance', async (req, res) => {
    try {
        const { username, newBalance } = req.body;
        const user = await User.findOne({ username });
        if (!user) return res.status(404).json({ error: 'Kullanıcı bulunamadı!' });
        user.balance = Number(newBalance);
        await user.save();
        
        await addLog('ADMIN', `${username} kullanıcısının bakiyesi admin tarafından ${newBalance} TL olarak güncellendi.`);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Bakiye güncellenemedi!' });
    }
});

app.post('/api/admin/delete-user', async (req, res) => {
    try {
        const { username } = req.body;
        await User.deleteOne({ username });
        await addLog('ADMIN', `${username} kullanıcısı admin tarafından silindi.`);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Kullanıcı silinemedi!' });
    }
});

app.get('/api/admin/logs', async (req, res) => {
    try {
        const logs = await Log.find({}).sort({ _id: -1 }).limit(100);
        res.json({ success: true, logs });
    } catch (err) {
        res.status(500).json({ error: 'Loglar alınamadı!' });
    }
});

// --- WEBRTC SIGNALING & CHAT ---
io.on('connection', (socket) => {
    socket.broadcast.emit('user-joined', socket.id);

    socket.on('offer', (data) => {
        io.to(data.target).emit('offer', { offer: data.offer, sender: socket.id });
    });

    socket.on('answer', (data) => {
        io.to(data.target).emit('answer', { answer: data.answer, sender: socket.id });
    });

    socket.on('ice-candidate', (data) => {
        io.to(data.target).emit('ice-candidate', { candidate: data.candidate, sender: socket.id });
    });

    socket.on('chat-message', (data) => {
        io.emit('chat-message', data);
    });

    socket.on('disconnect', () => {
        socket.broadcast.emit('user-disconnected', socket.id);
    });
});

server.listen(PORT, () => {
    console.log(`Sunucu MongoDB, WebRTC ve Log sistemiyle çalışıyor: http://localhost:${PORT}`);
});