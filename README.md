# Türkiye İl / İlçe / Mahalle Listesi

Türkiye'nin güncel **81 il, 973 ilçe ve 72.434 mahalle/köy** listesi. Her kayıtta **posta kodu** var. Veri JSON, CSV ve PostgreSQL olarak hazır; adres formlarında, checkout ekranlarında ve kargo entegrasyonlarında doğrudan kullanılabilir.

|                          |       Adet |
| ------------------------ | ---------: |
| İl                       |         81 |
| İlçe                     |        973 |
| Mahalle                  |     33.434 |
| Köy                      |     39.000 |
| **Toplam mahalle + köy** | **72.434** |

**Kaynak:** [PTT Posta Kodu Sorgulama](https://www.ptt.gov.tr/posta-kodu)
**Veri tarihi:** 26 Kasım 2026

## Neden?

İnternette dolaşan il-ilçe-mahalle listelerinin çoğu yıllar önceki PTT Excel'inden üretilmiş ve güncellenmiyor. Bu listelerde yeni ilçeler eksik (Sultanhanı, Derecik, Kemalpaşa/Artvin), adı değişen ilçeler eski adıyla duruyor (Eyüp → Eyüpsultan) ve kaldırılmış belde/mevki kayıtları hâlâ yer alıyor.

PTT artık toplu indirme sunmuyor. Bu repo, PTT'nin herkese açık sorgulama servisindeki güncel veriyi tek seferde toplar ve kullanıma hazır biçimlere dönüştürür.

## Dosyalar

| Dosya                                                                          | İçerik                                                                    |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------------------- |
| [`data/il_ilce_mahalle.json`](data/il_ilce_mahalle.json)                       | İç içe yapı: il → ilçeler → mahalleler                                    |
| [`data/il_ilce_mahalle.csv`](data/il_ilce_mahalle.csv)                         | Düz liste, her satır bir mahalle (Excel'de doğrudan açılır, UTF-8 BOM'lu) |
| [`data/iller.json`](data/iller.json) / [`.csv`](data/iller.csv)                | İller                                                                     |
| [`data/ilceler.json`](data/ilceler.json) / [`.csv`](data/ilceler.csv)          | İlçeler (`il_plaka` ile ile bağlı)                                        |
| [`data/mahalleler.json`](data/mahalleler.json) / [`.csv`](data/mahalleler.csv) | Mahalle ve köyler (`ilce_id` ile ilçeye bağlı)                            |
| [`sql/postgresql.sql`](sql/postgresql.sql)                                     | Tabloları oluşturan ve veriyi yükleyen PostgreSQL script'i                |
| [`data/ptt-raw.json`](data/ptt-raw.json)                                       | PTT'den gelen ham veri, değiştirilmemiş hali                              |

## Veri yapısı

### `il`

| Alan    | Tip   | Örnek      |
| ------- | ----- | ---------- |
| `plaka` | sayı  | `34`       |
| `ad`    | metin | `İstanbul` |
| `slug`  | metin | `istanbul` |

### `ilce`

| Alan       | Tip   | Örnek     |
| ---------- | ----- | --------- |
| `id`       | sayı  | `444`     |
| `il_plaka` | sayı  | `34`      |
| `ad`       | metin | `Kadıköy` |

### `mahalle`

| Alan         | Tip          | Örnek             | Açıklama                                        |
| ------------ | ------------ | ----------------- | ----------------------------------------------- |
| `id`         | sayı         | `32513`           |                                                 |
| `ilce_id`    | sayı         | `444`             |                                                 |
| `ad`         | metin        | `Acıbadem`        | Gösterim adı                                    |
| `tip`        | metin        | `mahalle` / `koy` |                                                 |
| `koy`        | metin \| boş | `Çukurköy Köyü`   | Yalnızca köylerde                               |
| `mevki`      | metin \| boş | `Yukarı`          | Köyün mevkisi varsa                             |
| `posta_kodu` | metin        | `34718`           | Birden fazlaysa virgülle ayrılır: `77600,77610` |
| `ptt_adi`    | metin        | `ACIBADEM MAH.`   | PTT'deki özgün yazım                            |

### İç içe JSON örneği

```json
{
  "kaynak": "PTT Posta Kodu Sorgulama (https://www.ptt.gov.tr/posta-kodu)",
  "tarih": "2026-11-26",
  "iller": [
    {
      "plaka": 34,
      "ad": "İstanbul",
      "slug": "istanbul",
      "ilceler": [
        {
          "id": 444,
          "ad": "Kadıköy",
          "mahalleler": [
            {
              "id": 32512,
              "ad": "19 Mayıs",
              "tip": "mahalle",
              "posta_kodu": "34736"
            },
            {
              "id": 32513,
              "ad": "Acıbadem",
              "tip": "mahalle",
              "posta_kodu": "34718"
            }
          ]
        }
      ]
    }
  ]
}
```

## Yazım kuralları

PTT verisi büyük harfle geliyor. Gösterim adları şu kurallarla üretildi:

- **Türkçe büyük/küçük harf:** Dönüşüm Türkçe kurallarına göre yapıldı (`I → ı`, `İ → i`). Örnek: `IŞIKLAR` → `Işıklar`.
- **"Mah." eki:** Kaldırıldı. Örnek: `500 EVLER MAH.` → `500 Evler`.
- **Köyler:** "Köyü" eki adın içinde kalıyor. Örnek: `AĞCİN KÖYÜ` → `Ağcin Köyü`.
- **Mevkili köyler:** PTT bunları `MEVKİ / KÖY` biçiminde veriyor. Burada `Köy, Mevki` sırasına çevrildi. Örnek: `YUKARI / ÇUKURKÖY KÖYÜ` → `Çukurköy Köyü, Yukarı`.
- **Tekrarlar:** Aynı ilçede aynı adla birden fazla geçen kayıtlar tekilleştirildi. Posta kodları birleştirildi.

PTT'deki özgün yazım her zaman `ptt_adi` alanında duruyor. Kendi kuralınızı uygulamak isterseniz o alanı kullanabilirsiniz.

## Kullanım

### PostgreSQL

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f sql/postgresql.sql
```

Script `il`, `ilce` ve `mahalle` tablolarını oluşturur ve tek transaction içinde doldurur.

```sql
-- Bir ilçenin mahalleleri
SELECT m.ad, m.tip, m.posta_kodu
FROM mahalle m
JOIN ilce c ON c.id = m.ilce_id
WHERE c.il_plaka = 34 AND c.ad = 'Kadıköy'
ORDER BY m.ad;
```

### JavaScript (CDN)

Dosyalar jsDelivr üzerinden doğrudan çekilebilir. Adresin sonuna dosya adı eklenmelidir:

| Dosya            | Adres                                                                                   |
| ---------------- | --------------------------------------------------------------------------------------- |
| İller            | <https://cdn.jsdelivr.net/gh/nesetdemir/il_ilce_mahalle@main/data/iller.json>           |
| İlçeler          | <https://cdn.jsdelivr.net/gh/nesetdemir/il_ilce_mahalle@main/data/ilceler.json>         |
| Mahalleler       | <https://cdn.jsdelivr.net/gh/nesetdemir/il_ilce_mahalle@main/data/mahalleler.json>      |
| İç içe tam liste | <https://cdn.jsdelivr.net/gh/nesetdemir/il_ilce_mahalle@main/data/il_ilce_mahalle.json> |

Tüm dosyaların listesi: <https://cdn.jsdelivr.net/gh/nesetdemir/il_ilce_mahalle@main/data/> (sondaki `/` gerekli).

```js
// Ön ek: tek başına açılmaz, sonuna dosya adı eklenir
const BASE = "https://cdn.jsdelivr.net/gh/nesetdemir/il_ilce_mahalle@main/data";

const iller = await fetch(`${BASE}/iller.json`).then((r) => r.json());
const ilceler = await fetch(`${BASE}/ilceler.json`).then((r) => r.json());

const istanbulIlceleri = ilceler.filter((c) => c.il_plaka === 34);
```

Production'da `@main` yerine belirli bir commit ya da tag kullanmanız önerilir. Dosyaları kendi projenize kopyalamak da bir seçenek.

### Node.js

```js
import fs from "node:fs";

const { iller } = JSON.parse(
  fs.readFileSync("data/il_ilce_mahalle.json", "utf8"),
);
const kadikoy = iller
  .find((il) => il.plaka === 34)
  .ilceler.find((c) => c.ad === "Kadıköy");

console.log(kadikoy.mahalleler.map((m) => m.ad));
```

## Veriyi güncelleme

1. Tarayıcıda <https://www.ptt.gov.tr/posta-kodu> sayfasını açın.
2. Geliştirici konsoluna (F12 → Console) [`scripts/ptt-fetch.browser.js`](scripts/ptt-fetch.browser.js) dosyasının içeriğini yapıştırın.
3. Script, sayfanın kendi kullandığı servisi istekler arasında 2 saniye bekleyerek çağırır. Tamamı yaklaşık 40 dakika sürer. Bitince `ptt-raw.json` indirilir.
   - Aralığı düşürmeyin. Daha sık isteklerde PTT `429 Too Many Requests` dönüyor.
   - Sayfa yenilenirse script'i yeniden yapıştırmanız yeterli. İlerleme tarayıcıda saklanır ve script kaldığı ilden devam eder.
4. İnen dosyayı `data/ptt-raw.json` ile değiştirin.
5. Diğer dosyaları yeniden üretin:

```bash
node scripts/build.mjs
```

`build.mjs`'in bağımlılığı yok, Node 18 veya üstü yeterli.

## Notlar

- **ID'ler kalıcı değil.** `ilce.id` ve `mahalle.id` her derlemede sıralamaya göre yeniden verilir. Veri güncellendiğinde değişebilirler. Kalıcı bir referans gerekiyorsa adresi isimle (il + ilçe + mahalle) saklayın ya da kendi ID'lerinizi verin. `il.plaka` sabittir.
- **Resmi kaynak değildir.** Veri PTT'nin herkese açık sorgulama ekranından alınmıştır. Resmî adres kayıtları için [NVİ Adres Kayıt Sistemi](https://adres.nvi.gov.tr/) esas alınmalıdır.
- **Hata bildirimi.** Eksik ya da hatalı bir kayıt görürseniz issue açabilirsiniz.

## Lisans

Kod (`scripts/`) [MIT](LICENSE) lisanslıdır. Veri PTT'nin herkese açık posta kodu servisinden derlenmiştir. Kullanırken kaynak olarak PTT'yi belirtmeniz rica olunur.
