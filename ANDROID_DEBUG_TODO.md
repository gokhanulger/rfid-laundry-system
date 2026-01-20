# Android RFID Okuma Sorunu - Debug Notları

## Sorun
Android cihazda toplama ekranında otelin tag'leri başka otel gibi okunuyor.

## Yapılan Düzeltmeler

### 1. `backend/src/routes/scan.ts` (satır 23-63)
Partial RFID matching fonksiyonları düzeltildi. Artık birden fazla eşleşme olduğunda **en uzun rfidTag** seçiliyor.

### 2. `backend/src/routes/items.ts` (satır 468-540)
Android'in kullandığı `POST /items/scan` endpoint'i güncellendi:
- Eski: Tam eşleşme (`inArray`) - çalışmıyordu
- Yeni: Partial matching + en uzun eşleşme

## Veritabanı Tag Formatı
```
rfidTag: 90342511271503040002A214 (24 karakter)
rfidTag: 903425112716153806021358 (24 karakter)
...
```
Tag'ler `9034...` ile başlıyor.

## Debug Logları Eklendi
`items.ts` dosyasına debug logları eklendi:
```
[SCAN DEBUG] Received tags: [...]
[SCAN DEBUG] Matched: X NotFound: Y
[SCAN DEBUG] First notFound tag: ...
```

## Yarın Yapılacaklar

1. Backend'i başlat:
   ```bash
   cd /Users/gokhanulger/Desktop/RFID/backend
   npm run dev
   ```

2. Android'de toplama ekranında bir tarama yap

3. Terminal'deki logları kontrol et:
   - Android'in gönderdiği tag formatı ne?
   - Eşleşme oluyor mu?
   - `notFoundTags` listesinde ne var?

4. Olası sorunlar:
   - Android uzun tag gönderiyor olabilir: `E200000090342511271503040002A214`
   - DB'de kısa tag var: `90342511271503040002A214`
   - `scannedTag.includes(item.rfidTag)` çalışması lazım

## Eğer Hala Çalışmazsa
- Case sensitivity kontrol et (büyük/küçük harf)
- Android'in gönderdiği tag'in başında/sonunda boşluk var mı?
- Tag'lerin trim edilmesi gerekebilir
