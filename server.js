const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 3000;
const DATA_FILE = path.join(__dirname, 'users.json');
const CHAT_FILE = path.join(__dirname, 'chat.json');

app.use(express.json());
app.use(express.static(__dirname));

let db = { users: [] };
let chatDb = { messages: [] };

function loadData() {
    if (fs.existsSync(DATA_FILE)) {
        try {
            const data = fs.readFileSync(DATA_FILE, 'utf8');
            db = JSON.parse(data);
        } catch (err) {
            db = { users: [] };
        }
    }
    if (fs.existsSync(CHAT_FILE)) {
        try {
            const data = fs.readFileSync(CHAT_FILE, 'utf8');
            chatDb = JSON.parse(data);
        } catch (err) {
            chatDb = { messages: [] };
        }
    }
}

function saveData() {
    fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2), 'utf8');
}

function saveChatData() {
    fs.writeFileSync(CHAT_FILE, JSON.stringify(chatDb, null, 2), 'utf8');
}

loadData();

// 1. Oturum Kontrolü (Kullanıcı Bilgisi)
app.get('/api/user', (req, res) => {
    loadData();
    const { username } = req.query;
    if (!username) return res.status(400).json({ error: 'Kullanıcı adı belirtilmedi!' });

    const user = db.users.find(u => u.username === username);
    if (!user) return res.status(404).json({ error: 'Kullanıcı bulunamadı!' });
    
    res.json({ user: { username: user.username, balance: user.balance || 0 } });
});

// 2. Giriş Yap
app.post('/api/login', (req, res) => {
    loadData();
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Kullanıcı adı ve şifre gereklidir!' });

    const user = db.users.find(u => u.username === username && u.password === password);
    if (!user) return res.status(401).json({ error: 'Hatalı kullanıcı adı veya şifre!' });
    
    res.json({ success: true, username: user.username });
});

// 3. Kayıt Ol
app.post('/api/register', (req, res) => {
    loadData();
    const { username, password, securityQuestion, securityAnswer } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Kullanıcı adı ve şifre zorunludur!' });

    if (db.users.some(u => u.username === username)) {
        return res.status(400).json({ error: 'Bu kullanıcı adı zaten alınmış!' });
    }

    db.users.push({ 
        username, 
        password, 
        securityQuestion: securityQuestion || '', 
        securityAnswer: securityAnswer || '', 
        balance: 0 
    });
    
    saveData();
    res.json({ success: true });
});

// 4. Güvenlik Sorusu Getir
app.get('/api/get-security-question', (req, res) => {
    loadData();
    const { username } = req.query;
    if (!username) return res.status(400).json({ error: 'Kullanıcı adı belirtilmedi!' });

    const user = db.users.find(u => u.username === username);
    if (!user) return res.status(404).json({ error: 'Kullanıcı bulunamadı!' });
    
    res.json({ question: user.securityQuestion || 'Güvenlik sorusu tanımlanmamış.' });
});

// 5. Şifre Sıfırla
app.post('/api/reset-password', (req, res) => {
    loadData();
    const { username, answer, newPassword } = req.body;
    if (!username || !answer || !newPassword) return res.status(400).json({ error: 'Tüm alanları doldurmalısın!' });

    const user = db.users.find(u => u.username === username);
    if (!user) return res.status(404).json({ error: 'Kullanıcı bulunamadı!' });

    if (user.securityAnswer !== answer) {
        return res.status(400).json({ error: 'Güvenlik sorusu cevabı yanlış!' });
    }

    user.password = newPassword;
    saveData();
    
    res.json({ success: true });
});

// --- SOHBET (CHAT) ENDPOINTLERİ ---

// Sohbet Mesajlarını Getir
app.get('/api/chat/messages', (req, res) => {
    loadData();
    // Son 50 mesajı gönder
    const recentMessages = chatDb.messages.slice(-50);
    res.json({ success: true, messages: recentMessages });
});

// Yeni Mesaj Gönder
app.post('/api/chat/send', (req, res) => {
    loadData();
    const { username, text } = req.body;
    if (!username || !text) return res.status(400).json({ error: 'Eksik bilgi!' });

    chatDb.messages.push({
        username,
        text,
        timestamp: Date.now()
    });

    // 100 mesajdan fazlasını silerek şişmeyi önleyelim
    if (chatDb.messages.length > 100) {
        chatDb.messages = chatDb.messages.slice(-100);
    }

    saveChatData();
    res.json({ success: true });
});

// Sunucuyu Başlat
app.listen(PORT, () => {
    console.log(`Sunucu çalışıyor: http://localhost:${PORT}`);
});