const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 3000;
const DATA_FILE = path.join(__dirname, 'users.json');

app.use(express.json());
app.use(express.static(__dirname));

let db = { users: [] };

function loadData() {
    if (fs.existsSync(DATA_FILE)) {
        try {
            const data = fs.readFileSync(DATA_FILE, 'utf8');
            db = JSON.parse(data);
        } catch (err) {
            console.error('Veri okunurken hata oluştu:', err);
            db = { users: [] };
        }
    }
}

function saveData() {
    try {
        fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2), 'utf8');
    } catch (err) {
        console.error('Veri kaydedilirken hata oluştu:', err);
    }
}

loadData();

// 1. Oturum Kontrolü ve Kullanıcı Bilgileri
app.get('/api/user', (req, res) => {
    loadData();
    const { username } = req.query;
    
    if (!username) {
        return res.status(400).json({ error: 'Kullanıcı adı belirtilmedi!' });
    }

    const user = db.users.find(u => u.username === username);
    if (!user) {
        return res.status(404).json({ error: 'Kullanıcı bulunamadı!' });
    }

    res.json({
        user: {
            username: user.username,
            balance: user.balance !== undefined ? user.balance : 0
        }
    });
});

// 2. Giriş Yap
app.post('/api/login', (req, res) => {
    loadData();
    const { username, password } = req.body;

    if (!username || !password) {
        return res.status(400).json({ error: 'Kullanıcı adı ve şifre gereklidir!' });
    }

    const user = db.users.find(u => u.username === username && u.password === password);
    if (!user) {
        return res.status(401).json({ error: 'Geçersiz kullanıcı adı veya şifre!' });
    }

    res.json({ success: true, username: user.username, message: 'Giriş başarılı!' });
});

// 3. Kayıt Ol
app.post('/api/register', (req, res) => {
    loadData();
    const { username, password, securityQuestion, securityAnswer } = req.body;

    if (!username || !password) {
        return res.status(400).json({ error: 'Kullanıcı adı ve şifre zorunludur!' });
    }

    const existingUser = db.users.find(u => u.username === username);
    if (existingUser) {
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
    res.json({ success: true, message: 'Kayıt başarılı!' });
});

// 4. Güvenlik Sorusu Getir
app.get('/api/get-security-question', (req, res) => {
    loadData();
    const { username } = req.query;

    if (!username) {
        return res.status(400).json({ error: 'Kullanıcı adı belirtilmedi!' });
    }

    const user = db.users.find(u => u.username === username);
    if (!user) {
        return res.status(404).json({ error: 'Kullanıcı bulunamadı!' });
    }

    res.json({ question: user.securityQuestion || 'Güvenlik sorusu tanımlanmamış.' });
});

// 5. Şifre Sıfırla
app.post('/api/reset-password', (req, res) => {
    loadData();
    const { username, answer, newPassword } = req.body;

    if (!username || !answer || !newPassword) {
        return res.status(400).json({ error: 'Tüm alanları doldurmalısın!' });
    }

    const user = db.users.find(u => u.username === username);
    if (!user) {
        return res.status(404).json({ error: 'Kullanıcı bulunamadı!' });
    }

    if (user.securityAnswer !== answer) {
        return res.status(400).json({ error: 'Güvenlik sorusu cevabı yanlış!' });
    }

    user.password = newPassword;
    saveData();

    res.json({ success: true, message: 'Şifre başarıyla güncellendi!' });
});

// 6. Para Yatırma (Deposit)
app.post('/api/deposit', (req, res) => {
    loadData();
    const { username, amount } = req.body;
    
    if (!username || !amount || amount <= 0) {
        return res.status(400).json({ error: 'Geçersiz miktar veya kullanıcı!' });
    }

    const user = db.users.find(u => u.username === username);
    if (!user) {
        return res.status(404).json({ error: 'Kullanıcı bulunamadı!' });
    }

    if (user.balance === undefined) user.balance = 0;

    user.balance += Number(amount);
    saveData();

    res.json({ success: true, newBalance: user.balance, message: `${amount} TL başarıyla yüklendi!` });
});

// 7. Çark Oyunu Sonrası Bakiye Güncelleme
app.post('/api/update-balance', (req, res) => {
    loadData();
    const { username, newBalance } = req.body;

    if (!username || newBalance === undefined || newBalance < 0) {
        return res.status(400).json({ error: 'Geçersiz veri!' });
    }

    const user = db.users.find(u => u.username === username);
    if (!user) {
        return res.status(404).json({ error: 'Kullanıcı bulunamadı!' });
    }

    user.balance = Number(newBalance);
    saveData();

    res.json({ success: true, balance: user.balance });
});

// Sunucuyu Başlat
app.listen(PORT, () => {
    console.log(`Sunucu aktif: http://localhost:${PORT}`);
});