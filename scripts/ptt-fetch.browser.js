/**
 * PTT posta kodu listesini tarayıcıdan çeker ve data/ptt-raw.json biçiminde indirir.
 *
 * Kullanım:
 *   1. https://www.ptt.gov.tr/posta-kodu sayfasını açın.
 *   2. Geliştirici konsolunu açıp (F12 > Console) bu dosyanın tamamını yapıştırın.
 *   3. İlerleme konsolda görünür. Bittiğinde "ptt-raw.json" indirilir;
 *      dosyayı data/ klasörüne koyup `node scripts/build.mjs` çalıştırın.
 *
 * Notlar:
 *   - Sayfanın kendi kullandığı /api/posta-kodu servisini, istekler arasında
 *     en az 2 saniye bekleyerek çağırır (~1.050 istek, ~40 dakika).
 *     Daha kısa aralıklarda servis 429 (Too Many Requests) dönüyor; lütfen
 *     aralığı düşürmeyin.
 *   - İlerleme IndexedDB'de il bazında saklanır. Sayfa yenilenirse script'i
 *     tekrar yapıştırmak kaldığı ilden devam ettirir. Baştan başlamak için:
 *     indexedDB.deleteDatabase("pttscrape")
 */
(async () => {
  const GAP_MS = 2000;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const db = await new Promise((res, rej) => {
    const r = indexedDB.open("pttscrape", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("il");
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  const idb = (mode, fn) =>
    new Promise((res, rej) => {
      const tx = db.transaction("il", mode);
      const req = fn(tx.objectStore("il"));
      tx.oncomplete = () => res(req.result);
      tx.onerror = () => rej(tx.error);
    });

  let gap = GAP_MS;
  let last = 0;
  const call = async (body) => {
    for (let attempt = 0; attempt < 8; attempt++) {
      const wait = last + gap - Date.now();
      if (wait > 0) await sleep(wait);
      last = Date.now();
      try {
        const r = await fetch("/api/posta-kodu", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (r.ok) return r.json();
        console.warn("HTTP", r.status, body);
        if (r.status === 429) {
          gap = Math.min(gap + 500, 6000);
          await sleep(60000);
          continue;
        }
      } catch (e) {
        console.warn(e, body);
      }
      await sleep(10000 * (attempt + 1));
    }
    throw new Error("İstek başarısız: " + JSON.stringify(body));
  };

  const html = await fetch("/posta-kodu").then((r) => r.text());
  const iller = JSON.parse(html.match(/"illerData":(\[[^\]]*\])/)[1]);
  const done = await idb("readonly", (st) => st.getAllKeys());

  for (const il of iller) {
    if (done.includes(il.kod)) continue;
    const ilceler = (
      await call({ action: "ilceler", il_kodu: String(il.kod) })
    ).filter((x) => x.kod > 0);
    const districts = [];
    for (const ic of ilceler) {
      const rows = await call({
        action: "postakodu",
        il_kodu: String(il.kod),
        ilce_kodu: String(ic.kod),
      });
      const m = new Map();
      for (const r of rows) {
        if (!m.has(r.mahalleAdi)) m.set(r.mahalleAdi, new Set());
        m.get(r.mahalleAdi).add(r.posta_Kodu);
      }
      districts.push({
        name: ic.ad,
        neighborhoods: [...m].map(([ad, pk]) => [ad, [...pk].sort().join(",")]),
      });
    }
    await idb("readwrite", (st) =>
      st.put({ plaka: il.kod, name: il.ad, districts }, il.kod),
    );
    console.log(`✓ ${il.ad} (${ilceler.length} ilçe)`);
  }

  const provinces = (await idb("readonly", (st) => st.getAll())).sort(
    (a, b) => a.plaka - b.plaka,
  );
  const snapshot = {
    source: "PTT posta kodu API (ptt.gov.tr/posta-kodu)",
    fetchedAt: new Date().toISOString().slice(0, 10),
    provinces,
  };
  const a = document.createElement("a");
  a.href = URL.createObjectURL(
    new Blob([JSON.stringify(snapshot)], { type: "application/json" }),
  );
  a.download = "ptt-raw.json";
  a.click();
  console.log("Bitti:", provinces.length, "il");
})();
