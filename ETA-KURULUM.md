# ETA Bilgisayarinda Backend Kurulumu

## 1. Node.js Kur

https://nodejs.org adresinden **Node.js 20 LTS** indir ve kur.

Kurulum sonrasi CMD acip kontrol et:
```
node --version
npm --version
```

## 2. Projeyi Indir

CMD'de:
```
cd C:\
git clone https://github.com/gokhanulger/rfid-laundry-system.git
cd rfid-laundry-system\backend
```

Git yoksa: https://github.com/gokhanulger/rfid-laundry-system adresinden ZIP indir ve C:\ altina cikart.

## 3. Bagimliliklari Kur

```
cd C:\rfid-laundry-system\backend
npm install
```

## 4. .env Dosyasini Ayarla

`C:\rfid-laundry-system\backend\.env` dosyasini olustur veya duzenle:

```
# Veritabani (Railway'deki PostgreSQL)
DATABASE_URL=postgresql://postgres:XXX@XXX.railway.app:5432/railway

# JWT
JWT_SECRET=your-secret-key-here

# ETA SQL Server Baglantisi
ETA_SQL_SERVER=localhost
ETA_SQL_PORT=1433
ETA_SQL_DATABASE=ETAV8
ETA_SQL_USER=sa
ETA_SQL_PASSWORD=eta_sifresi

# Port
PORT=3001
```

**NOT:** DATABASE_URL icin Railway'deki mevcut baglanti bilgilerini kullan.

## 5. Backend'i Baslat

```
cd C:\rfid-laundry-system\backend
npm run dev
```

Basarili olursa:
```
Server running on port 3001
ETA SQL Server baglantisi basarili
```

## 6. Test Et

Tarayicida ac: http://localhost:3001/api/eta/status

Basarili cevap:
```json
{"success":true,"message":"ETA SQL Server baglantisi basarili"}
```

## 7. Frontend'i ETA Backend'e Yonlendir

ETA bilgisayarinda tarayicidan:
- https://frontend-three-virid-27.vercel.app adresini ac
- Ayarlar > ETA Entegrasyonu sayfasina git
- Tablo kesfi bolumunden ETA tablolarini incele

**VEYA** Frontend'i de local calistir:
```
cd C:\rfid-laundry-system\frontend
npm install
npm run dev
```

---

## Hizli Baslatma (Kurulum Sonrasi)

Her seferinde:
```
cd C:\rfid-laundry-system\backend
npm run dev
```

## Sorun Giderme

### ETA baglantisi basarisiz
- SQL Server Browser servisi calisiyormu kontrol et
- SQL Server Authentication aktif mi kontrol et
- Firewall 1433 portunu aciyor mu kontrol et

### Node modules hatasi
```
rm -rf node_modules
npm install
```
