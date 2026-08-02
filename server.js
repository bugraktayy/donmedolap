// Gerekli modüllerin projeye dahil edilmesi
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');

// Express uygulaması ve HTTP Sunucusunun oluşturulması
const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Middleware tanımlamaları
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public'))); // Frontend dosyalarının bulunduğu klasör

// Sabitler ve Veritabanı Dosyası Yolu
const JWT_SECRET = "gizli_anahtarim_123"; 
const DATA_FILE = path.join(__dirname, 'users.json');

// --- VERİTABANI YÖNETİMİ (JSON DOSYASI SİSTEMİ) ---
let db = {
    users: [],
    history: []
};

// Sunucu açıldığında daha önceden kaydedilmiş kullanıcılar var mı diye kontrol et ve oku
if (fs.existsSync(DATA_FILE)) {
    try {
        const fileData = fs.readFileSync(DATA_FILE, 'utf8');
        db = JSON.parse(fileData);
        console.log("Kayıtlı veriler 'users.json' dosyasından başarıyla yüklendi.");
    } catch (e) {
        console.log("Veri dosyası okunamadı, boş veri tabanı ile başlatılıyor.");
    }
} else {
    saveData(); // Dosya yoksa ilk oluşturma işlemini yap
}

// Verileri JSON dosyasına anlık ve kalıcı olarak yazdıran fonksiyon
function saveData() {
    try {
        fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2), 'utf8');
    } catch (err) {
        console.error("Veri kaydedilirken hata oluştu:", err);
    }
}
// ----------------------------------------------------

// Çark Üzerinde Yer Alan Meyveler ve Çarpan Bilgileri
const wheelItems = [
    { id: 'banana', icon: '🍌', multiplier: 2 },
    { id: 'apple', icon: '🍎', multiplier: 3 },
    { id: 'grapes', icon: '🍇', multiplier: 5 },
    { id: 'orange', icon: '🍊', multiplier: 10 },
    { id: 'watermelon', icon: '🍉', multiplier: 15 },
    { id: 'strawberry', icon: '🍓', multiplier: 20 },
    { id: 'meat', icon: '🍗', multiplier: 45 }
];

// Oyunun anlık durum yönetimi
let gameState = {
    timer: 20,
    status: 'betting', // 'betting' (bahis aşaması) veya 'spinning' (dönme aşaması)
    bets: {} // Oyuncuların yaptığı bahislerin tutulduğu nesne
};

// ================= API ENDPOINT'LERİ (HTTP) =================

// 1. Yeni Kullanıcı Kayıt İşlemi
app.post('/api/register', (req, res) => {
    const { username, password, securityQuestion, securityAnswer, refCode } = req.body;
    
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
        balance: 1000, // Yeni kullanıcılara 1000 TL başlangıç ikramiyesi
        lastBonusDate: null
    };

    db.users.push(newUser);
    saveData(); // Yeni kullanıcıyı hemen kalıcı dosyaya kaydet

    res.json({ success: true, message: 'Kayıt başarılı! Şimdi giriş yapabilirsiniz.' });
});

// 2. Kullanıcı Giriş İşlemi
app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    
    const user = db.users.find(u => u.username === username && u.password === password);
    if (!user) {
        return res.status(400).json({ error: 'Kullanıcı adı veya şifre hatalı!' });
    }

    // Oturum için JWT token üretimi
    const token = jwt.sign({ username: user.username }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, username: user.username, balance: user.balance });
});

// 3. Şifremi Unuttum İçin Güvenlik Sorusunu Getirme
app.get('/api/get-security-question', (req, res) => {
    const { username } = req.query;
    const user = db.users.find(u => u.username === username);
    if (!user) return res.status(404).json({ error: 'Böyle bir kullanıcı bulunamadı!' });

    res.json({ question: user.securityQuestion || 'Güvenlik sorusu tanımlanmamış.' });
});

// 4. Güvenlik Sorusu Doğrulayıp Şifre Sıfırlama
app.post('/api/reset-password', (req, res) => {
    const { username, securityAnswer, newPassword } = req.body;
    const user = db.users.find(u => u.username === username);
    
    if (!user) return res.status(404).json({ error: 'Kullanıcı bulunamadı!' });
    if (user.securityAnswer !== securityAnswer) {
        return res.status(400).json({ error: 'Güvenlik sorusu cevabı yanlış!' });
    }

    user.password = newPassword;
    saveData(); // Güncellenen şifreyi dosyaya kaydet

    res.json({ success: true, message: 'Şifreniz başarıyla güncellendi!' });
});

// 5. Günlük Bonus Talep Etme İşlemi
app.post('/api/claim-bonus', (req, res) => {
    const { username } = req.body;
    const user = db.users.find(u => u.username === username);
    if (!user) return res.status(400).json({ error: 'Kullanıcı bulunamadı!' });

    const today = new Date().toDateString();
    if (user.lastBonusDate === today) {
        return res.status(400).json({ error: 'Bugün zaten günlük bonusunuzu aldınız!' });
    }

    user.balance += 500;
    user.lastBonusDate = today;
    saveData(); // Bonus miktarını ve tarihini dosyaya kaydet

    res.json({ success: true, newBalance: user.balance, message: '500 TL günlük bonus eklendi!' });
});

// ================= SOCKET.IO BAĞLANTI VE OYUN MANTIĞI =================

io.on('connection', (socket) => {
    console.log('Bir kullanıcı bağlandı, Socket ID:', socket.id);

    // Yeni bağlanan oyuncuya oyunun mevcut durumunu, liderlik tablosunu ve geçmişi gönder
    socket.emit('init_state', {
        items: wheelItems,
        leaderboard: getLeaderboard(),
        history: db.history.slice(-10)
    });

    // Kullanıcının anlık bakiyesini doğrula ve güncelle
    socket.on('get_balance', (data) => {
        try {
            const decoded = jwt.verify(data.token, JWT_SECRET);
            const user = db.users.find(u => u.username === decoded.username);
            if (user) {
                socket.emit('balance_update', { newBalance: user.balance });
            }
        } catch (e) {
            // Token geçersiz veya süresi dolmuş
        }
    });

    // Bahis Yapma İşlemi
    socket.on('place_bet', (data) => {
        if (gameState.status !== 'betting') {
            return socket.emit('error_msg', 'Şu an bahis yapamazsınız, çark dönüyor!');
        }
        
        try {
            const decoded = jwt.verify(data.token, JWT_SECRET);
            const user = db.users.find(u => u.username === decoded.username);
            
            if (!user) return socket.emit('error_msg', 'Kullanıcı oturumu geçersiz!');
            if (user.balance < data.amount) return socket.emit('error_msg', 'Yetersiz bakiye!');

            // Bakiyeden düş ve dosyaya işle
            user.balance -= data.amount;
            saveData();

            // Bahis listesini düzenle
            if (!gameState.bets[socket.id]) {
                gameState.bets[socket.id] = { username: user.username, items: {} };
            }
            gameState.bets[socket.id].items[data.itemId] = (gameState.bets[socket.id].items[data.itemId] || 0) + data.amount;

            socket.emit('bet_confirmed', { newBalance: user.balance });
            io.emit('leaderboard_update', getLeaderboard());
        } catch (e) {
            socket.emit('error_msg', 'Yetkilendirme hatası oluştu!');
        }
    });

    // Canlı Sohbet Mesajı Gönderme
    socket.on('send_chat_message', (data) => {
        const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        io.emit('new_chat_message', { username: data.username, message: data.message, time });
    });

    socket.on('disconnect', () => {
        console.log('Bir kullanıcı ayrıldı:', socket.id);
        delete gameState.bets[socket.id];
    });
});

// En zengin ilk 5 kullanıcıyı hesaplayan liderlik tablosu fonksiyonu
function getLeaderboard() {
    return [...db.users]
        .sort((a, b) => b.balance - a.balance)
        .slice(0, 5)
        .map(u => ({ username: u.username, balance: u.balance }));
}

// Oyun Döngüsü ve Zamanlayıcı (Her 1 saniyede bir çalışır)
setInterval(() => {
    gameState.timer--;

    if (gameState.timer <= 0) {
        if (gameState.status === 'betting') {
            gameState.status = 'spinning';
            
            // Kazanan öğeyi rastgele belirle
            const winnerIndex = Math.floor(Math.random() * wheelItems.length);
            const winningItem = wheelItems[winnerIndex];

            // Tüm kullanıcılara çarkın dönmesi komutunu ilet
            io.emit('spin_wheel', { winnerIndex });

            // Çarkın dönme animasyonu süresi (3 saniye sonra sonuçları hesapla)
            setTimeout(() => {
                // Kazanan öğeyi geçmiş listesine ekle (en fazla son 20 kayıt tutulur)
                db.history.push(winningItem);
                if (db.history.length > 20) db.history.shift();

                // Yapılan bahisleri kontrol et ve kazananlara ödemelerini yap
                for (let socketId in gameState.bets) {
                    const betData = gameState.bets[socketId];
                    const userBets = betData.items;
                    const username = betData.username;

                    if (userBets[winningItem.id]) {
                        const betAmount = userBets[winningItem.id];
                        const winAmount = betAmount * winningItem.multiplier;
                        
                        // Kullanıcıyı veritabanında bul ve kazandığı tutarı bakiyesine ekle
                        const user = db.users.find(u => u.username === username);
                        if (user) {
                            user.balance += winAmount;
                            
                            // Eğer oyuncu hâlâ bağlıysa anlık yeni bakiyesini gönder
                            const socket = io.sockets.sockets.get(socketId);
                            if (socket) {
                                socket.emit('balance_update', { newBalance: user.balance });
                            }
                        }
                    }
                }

                saveData(); // Tüm bakiye güncellemelerini ve oyun geçmişini kalıcı olarak dosyaya kaydet

                io.emit('round_result', { history: db.history.slice(-10) });
                io.emit('leaderboard_update', getLeaderboard());

                // Yeni tur için oyun durumunu sıfırla ve yeniden başlat
                gameState.bets = {};
                gameState.status = 'betting';
                gameState.timer = 20;
            }, 3000);
        }
    }

    io.emit('timer_update', { timer: gameState.timer });
}, 1000);

// Sunucuyu 3000 portunda dinlemeye başla
server.listen(3000, () => {
    console.log('Sunucu 3000 portunda başarıyla çalışıyor...');
});