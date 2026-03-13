/**
 * ETA SQL Server Client
 * Yerel agdan ETA veritabanina baglanir
 * Node 12 uyumlu
 */

var sql = require('mssql');

// Retry configuration
var MAX_RETRIES = 3;
var RETRY_DELAY_MS = 2000;

// Helper: delay function
function delay(ms) {
  return new Promise(function(resolve) {
    setTimeout(resolve, ms);
  });
}

// Helper: retry wrapper for database operations
function withRetry(operation, retries, delayMs) {
  retries = retries || MAX_RETRIES;
  delayMs = delayMs || RETRY_DELAY_MS;

  return operation().catch(function(error) {
    if (retries <= 0) {
      throw error;
    }
    console.log('  Veritabani hatasi, ' + retries + ' deneme kaldi. ' + (delayMs/1000) + ' saniye bekleniyor...');
    return delay(delayMs).then(function() {
      return withRetry(operation, retries - 1, delayMs * 1.5); // Exponential backoff
    });
  });
}

function EtaClient(config) {
  // Use encryption settings from config, with secure defaults
  var configOptions = config.options || {};

  this.baseConfig = {
    server: config.server,
    port: config.port,
    database: config.database, // Default database
    user: config.user,
    password: config.password,
    options: {
      // Default to encrypted connection for security
      encrypt: configOptions.encrypt !== undefined ? configOptions.encrypt : true,
      trustServerCertificate: configOptions.trustServerCertificate !== undefined ? configOptions.trustServerCertificate : true,
      enableArithAbort: true,
    },
    pool: {
      max: 10,
      min: 0,
      idleTimeoutMillis: 30000,
    },
  };

  this.config = Object.assign({}, this.baseConfig);
  this.pool = null;
  this.currentDatabase = config.database;

  // Debug: config'i goster
  console.log('  ETA Config: server=' + config.server + ', user=' + config.user + ', db=' + config.database);
}

/**
 * Veritabani degistir - otel bazli veritabani secimi icin
 * @param {string} databaseName - Yeni veritabani adi (orn: Demet_2025, Gayri_2025)
 */
EtaClient.prototype.switchDatabase = function(databaseName) {
  var self = this;

  // Eger ayni veritabanindaysak degisiklik yapma
  if (this.currentDatabase === databaseName) {
    return Promise.resolve();
  }

  console.log('  DB degistiriliyor: ' + this.currentDatabase + ' -> ' + databaseName);

  // Mevcut baglantıyı kapat
  var closePromise = this.pool ? this.disconnect() : Promise.resolve();

  return closePromise.then(function() {
    // Yeni config olustur
    self.config = Object.assign({}, self.baseConfig, { database: databaseName });
    self.currentDatabase = databaseName;
    return self.connect();
  });
};

EtaClient.prototype.connect = function() {
  var self = this;

  // Use retry wrapper for connection
  return withRetry(function() {
    return new sql.ConnectionPool(self.config).connect()
      .then(function(pool) {
        self.pool = pool;
        console.log('+ ETA SQL Server baglantisi basarili');
        return true;
      });
  }).catch(function(error) {
    console.error('x ETA baglanti hatasi (tum denemeler basarisiz):', error.message);
    throw error;
  });
};

// Ensure connection is available, reconnect if needed
EtaClient.prototype.ensureConnection = function() {
  var self = this;
  if (this.pool && this.pool.connected) {
    return Promise.resolve(this.pool);
  }
  return this.connect().then(function() {
    return self.pool;
  });
};

EtaClient.prototype.disconnect = function() {
  var self = this;
  if (this.pool) {
    return this.pool.close().then(function() {
      self.pool = null;
    });
  }
  return Promise.resolve();
};

EtaClient.prototype.testConnection = function() {
  var self = this;
  return this.connect()
    .then(function() {
      return self.pool.request().query('SELECT @@VERSION as version');
    })
    .then(function(result) {
      return self.disconnect().then(function() {
        var version = result.recordset[0] ? result.recordset[0].version : '';
        return {
          success: true,
          version: version,
        };
      });
    })
    .catch(function(error) {
      return {
        success: false,
        error: error.message,
      };
    });
};

EtaClient.prototype.getCariKartlar = function() {
  var self = this;

  var connectPromise = this.pool ? Promise.resolve() : this.connect();

  return connectPromise.then(function() {
    var query =
      "SELECT " +
      "CARKOD as kod, " +
      "CARUNVAN as unvan " +
      "FROM CARKART " +
      "WHERE CARKOD IS NOT NULL AND CARKOD != '' " +
      "ORDER BY CARUNVAN";

    return self.pool.request().query(query);
  })
  .then(function(result) {
    return result.recordset.map(function(row) {
      return {
        kod: row.kod ? row.kod.toString().trim() : '',
        unvan: row.unvan ? row.unvan.toString().trim() : '',
        adres: '',
        telefon: '',
        email: '',
        aktif: true,
      };
    });
  })
  .catch(function(error) {
    console.error('Cari kart cekme hatasi:', error.message);
    throw error;
  });
};

EtaClient.prototype.getStokKartlar = function() {
  var self = this;

  var connectPromise = this.pool ? Promise.resolve() : this.connect();

  return connectPromise.then(function() {
    var query =
      "SELECT " +
      "STKKOD as kod, " +
      "STKCINSI as ad, " +
      "STKBIRIM as birim " +
      "FROM STKKART " +
      "WHERE STKKOD IS NOT NULL AND STKKOD != '' " +
      "ORDER BY STKCINSI";

    return self.pool.request().query(query);
  })
  .then(function(result) {
    return result.recordset.map(function(row) {
      return {
        kod: row.kod ? row.kod.toString().trim() : '',
        ad: row.ad ? row.ad.toString().trim() : '',
        aciklama: '',
        birim: row.birim ? row.birim.toString().trim() : '',
        aktif: true,
      };
    });
  })
  .catch(function(error) {
    console.error('Stok kart cekme hatasi:', error.message);
    throw error;
  });
};

EtaClient.prototype.listTables = function() {
  var self = this;

  var connectPromise = this.pool ? Promise.resolve() : this.connect();

  return connectPromise.then(function() {
    var query =
      "SELECT TABLE_NAME " +
      "FROM INFORMATION_SCHEMA.TABLES " +
      "WHERE TABLE_TYPE = 'BASE TABLE' " +
      "ORDER BY TABLE_NAME";

    return self.pool.request().query(query);
  })
  .then(function(result) {
    return result.recordset.map(function(row) {
      return row.TABLE_NAME;
    });
  });
};

EtaClient.prototype.getTableColumns = function(tableName) {
  var self = this;

  var connectPromise = this.pool ? Promise.resolve() : this.connect();

  return connectPromise.then(function() {
    var query =
      "SELECT COLUMN_NAME, DATA_TYPE " +
      "FROM INFORMATION_SCHEMA.COLUMNS " +
      "WHERE TABLE_NAME = @tableName " +
      "ORDER BY ORDINAL_POSITION";

    return self.pool.request()
      .input('tableName', sql.VarChar, tableName)
      .query(query);
  })
  .then(function(result) {
    return result.recordset;
  });
};

/**
 * Sonraki irsaliye referans numarasini al
 */
EtaClient.prototype.getNextIrsaliyeRefNo = function() {
  var self = this;

  var connectPromise = this.pool ? Promise.resolve() : this.connect();

  return connectPromise.then(function() {
    var query = "SELECT ISNULL(MAX(IRSFISREFNO), 0) + 1 as nextRefNo FROM IRSFIS";
    return self.pool.request().query(query);
  })
  .then(function(result) {
    return result.recordset[0].nextRefNo;
  });
};

/**
 * Irsaliye olustur (RFID'den ETA'ya)
 * Tum ilgili tablolara kayit atar: IRSFIS, IRSHAR, CARFIS, CARHAR, STKFIS, STKHAR
 * ONEMLI: FIRMA alanlari ETA'da kayitlarin gorulmesi icin gereklidir!
 */
EtaClient.prototype.createIrsaliye = function(irsaliye) {
  var self = this;

  var connectPromise = this.pool ? Promise.resolve() : this.connect();

  return connectPromise.then(function() {
    return self.getNextIrsaliyeRefNo();
  })
  .then(function(refNo) {
    var tarih = irsaliye.tarih || new Date();
    var saat = ('0' + tarih.getHours()).slice(-2) + ':' + ('0' + tarih.getMinutes()).slice(-2);
    var cariKod = irsaliye.cariKod || '';
    var cariUnvan = irsaliye.cariUnvan || '';
    var aciklama = irsaliye.aciklama || 'RFID Sistem';
    var firma = irsaliye.firma || 1; // ETA firma kodu - genellikle 1

    // Toplam tutari hesapla
    var toplamTutar = 0;
    for (var t = 0; t < irsaliye.satirlar.length; t++) {
      var s = irsaliye.satirlar[t];
      toplamTutar += (s.miktar || 0) * (s.fiyat || 0);
    }

    console.log('  RefNo: ' + refNo + ' olusturuluyor (Firma: ' + firma + ')...');

    // 1. IRSFIS - Irsaliye Fis (Ana kayit)
    // IRSFISTIPI: 3 = Temiz/Cikis Irsaliyesi
    // IRSFISKAYNAK: 6, IRSFISGCFLAG: 2, IRSFISFATKONT: 1, IRSFISSEVNO: 1
    var evrakNo = irsaliye.evrakNo || irsaliye.barcode || '';
    var irsfisQuery =
      "INSERT INTO IRSFIS (IRSFISREFNO, IRSFISTAR, IRSFISTIPI, IRSFISCARKOD, IRSFISCARUNVAN, " +
      "IRSFISACIKLAMA1, IRSFISSAAT, IRSFISKAYONC, IRSFISGENTOPLAM, " +
      "IRSFISKAYNAK, IRSFISGCFLAG, IRSFISFATKONT, IRSFISEVRAKNO1, IRSFISSEVNO) " +
      "VALUES (@refNo, @tarih, 3, @cariKod, @cariUnvan, @aciklama, @saat, 1, @toplamTutar, " +
      "6, 2, 1, @evrakNo, 1)";

    return self.pool.request()
      .input('refNo', sql.Int, refNo)
      .input('tarih', sql.DateTime, tarih)
      .input('cariKod', sql.VarChar, cariKod)
      .input('cariUnvan', sql.VarChar, cariUnvan)
      .input('aciklama', sql.VarChar, aciklama)
      .input('saat', sql.VarChar, saat)
      .input('toplamTutar', sql.Numeric, toplamTutar)
      .input('evrakNo', sql.VarChar, evrakNo)
      .query(irsfisQuery)
      .then(function() {
        console.log('    IRSFIS OK');

        // 2. CARFIS - Cari Fis (Borc kaydi) - TIPI = 3
        var carfisQuery =
          "INSERT INTO CARFIS (CARFISREFNO, CARFISTAR, CARFISTIPI, CARFISCARKOD, CARFISCARUNVAN, " +
          "CARFISACIKLAMA1, CARFISBORCTOP, CARFISKAYONC) " +
          "VALUES (@refNo, @tarih, 3, @cariKod, @cariUnvan, @aciklama, @toplamTutar, 1)";

        return self.pool.request()
          .input('refNo', sql.Int, refNo)
          .input('tarih', sql.DateTime, tarih)
          .input('cariKod', sql.VarChar, cariKod)
          .input('cariUnvan', sql.VarChar, cariUnvan)
          .input('aciklama', sql.VarChar, aciklama)
          .input('toplamTutar', sql.Numeric, toplamTutar)
          .query(carfisQuery);
      })
      .then(function() {
        console.log('    CARFIS OK');

        // 3. CARHAR - Cari Hareket (Her satir icin borc kaydi)
        var carharPromise = Promise.resolve();

        for (var c = 0; c < irsaliye.satirlar.length; c++) {
          (function(satir, lineIndex) {
            carharPromise = carharPromise.then(function() {
              var siraNo = lineIndex + 1;
              var miktar = satir.miktar || 0;
              var fiyat = satir.fiyat || 0;
              var tutar = miktar * fiyat;

              // CARHAR - TIPI = 3
              var carharQuery =
                "INSERT INTO CARHAR (CARHARREFNO, CARHARTAR, CARHARTIPI, CARHARCARKOD, " +
                "CARHARTUTAR, CARHARKAYONC, CARHARSIRANO) " +
                "VALUES (@refNo, @tarih, 3, @cariKod, @tutar, 1, @siraNo)";

              return self.pool.request()
                .input('refNo', sql.Int, refNo)
                .input('tarih', sql.DateTime, tarih)
                .input('cariKod', sql.VarChar, cariKod)
                .input('tutar', sql.Numeric, tutar)
                .input('siraNo', sql.Int, siraNo)
                .query(carharQuery);
            });
          })(irsaliye.satirlar[c], c);
        }

        return carharPromise;
      })
      .then(function() {
        console.log('    CARHAR OK');

        // 4. STKFIS - Stok Fis - TIPI = 3
        // STKFIS kendi REFNO sirasini kullaniyor, ayri almamiz gerekiyor
        return self.pool.request()
          .query("SELECT ISNULL(MAX(STKFISREFNO), 0) + 1 as nextRefNo FROM STKFIS")
          .then(function(result) {
            var stkfisRefNo = result.recordset[0].nextRefNo;
            console.log('    STKFIS RefNo: ' + stkfisRefNo);

            var stkfisQuery =
              "INSERT INTO STKFIS (STKFISREFNO, STKFISTAR, STKFISTIPI, STKFISCARKOD, " +
              "STKFISACIKLAMA1, STKFISKAYONC, STKFISTOPNTUT) " +
              "VALUES (@stkfisRefNo, @tarih, 3, @cariKod, @aciklama, 1, @toplamTutar)";

            return self.pool.request()
              .input('stkfisRefNo', sql.Int, stkfisRefNo)
              .input('tarih', sql.DateTime, tarih)
              .input('cariKod', sql.VarChar, cariKod)
              .input('aciklama', sql.VarChar, aciklama)
              .input('toplamTutar', sql.Numeric, toplamTutar)
              .query(stkfisQuery)
              .then(function() {
                return stkfisRefNo; // STKHAR icin refNo'yu dondur
              });
          });
      })
      .then(function(stkfisRefNo) {
        console.log('    STKFIS OK');

        // 5. IRSHAR ve STKHAR - Satirlar
        // ONEMLI: TIPI = 3 (Satis Irsaliyesi)
        // IRSHAR icin IRSFIS refNo, STKHAR icin STKFIS refNo kullanilir
        var promise = Promise.resolve();
        var satirSayisi = irsaliye.satirlar ? irsaliye.satirlar.length : 0;

        console.log('    IRSHAR/STKHAR icin ' + satirSayisi + ' satir islenecek');

        if (satirSayisi === 0) {
          console.log('    UYARI: Satir yok, IRSHAR/STKHAR olusturulmayacak!');
          return Promise.resolve();
        }

        for (var i = 0; i < irsaliye.satirlar.length; i++) {
          (function(satir, lineIndex, stkRefNo) {
            promise = promise.then(function() {
              var siraNo = lineIndex + 1;
              var stokKod = satir.stokKod || satir.stokAd || '';
              var birim = satir.birim || 'ADET';
              var miktar = satir.miktar || 0;
              var fiyat = satir.fiyat || 0;
              var tutar = miktar * fiyat;

              var stokAd = satir.stokAd || '';
              console.log('      Satir ' + siraNo + ': ' + stokKod + ' (' + stokAd + ') x ' + miktar);

              // IRSHAR - Irsaliye Hareket (TIPI = 3) - IRSFIS refNo kullanir
              // IRSHARGCFLAG=2, IRSHARKAYNAK=6, IRSHARKODTIP=1 ETA uyumlulugu icin gerekli
              var irsharQuery =
                "INSERT INTO IRSHAR (IRSHARREFNO, IRSHARTAR, IRSHARTIPI, IRSHARCARKOD, " +
                "IRSHARSTKKOD, IRSHARSTKCINS, IRSHARSTKBRM, IRSHARMIKTAR, IRSHARFIYAT, IRSHARTUTAR, " +
                "IRSHARKAYONC, IRSHARSIRANO, IRSHARGCFLAG, IRSHARKAYNAK, IRSHARKODTIP) " +
                "VALUES (@refNo, @tarih, 3, @cariKod, @stokKod, @stokAd, @birim, @miktar, @fiyat, @tutar, 1, @siraNo, 2, 6, 1)";

              return self.pool.request()
                .input('refNo', sql.Int, refNo)
                .input('tarih', sql.DateTime, tarih)
                .input('cariKod', sql.VarChar, cariKod)
                .input('stokKod', sql.VarChar, stokKod)
                .input('stokAd', sql.VarChar, stokAd)
                .input('birim', sql.VarChar, birim)
                .input('miktar', sql.Numeric, miktar)
                .input('fiyat', sql.Numeric, fiyat)
                .input('tutar', sql.Numeric, tutar)
                .input('siraNo', sql.Int, siraNo)
                .query(irsharQuery)
                .then(function() {
                  console.log('        IRSHAR OK (satir ' + siraNo + ')');
                  // STKHAR - Stok Hareket (TIPI = 3) - STKFIS refNo kullanir
                  var stkharQuery =
                    "INSERT INTO STKHAR (STKHARREFNO, STKHARTAR, STKHARTIPI, STKHARCARKOD, " +
                    "STKHARSTKKOD, STKHARSTKBRM, STKHARMIKTAR, STKHARFIYAT, STKHARTUTAR, " +
                    "STKHARKAYONC, STKHARSIRANO) " +
                    "VALUES (@stkRefNo, @tarih, 3, @cariKod, @stokKod, @birim, @miktar, @fiyat, @tutar, 1, @siraNo)";

                  return self.pool.request()
                    .input('stkRefNo', sql.Int, stkRefNo)
                    .input('tarih', sql.DateTime, tarih)
                    .input('cariKod', sql.VarChar, cariKod)
                    .input('stokKod', sql.VarChar, stokKod)
                    .input('birim', sql.VarChar, birim)
                    .input('miktar', sql.Numeric, miktar)
                    .input('fiyat', sql.Numeric, fiyat)
                    .input('tutar', sql.Numeric, tutar)
                    .input('siraNo', sql.Int, siraNo)
                    .query(stkharQuery);
                })
                .then(function() {
                  console.log('        STKHAR OK (satir ' + siraNo + ')');
                });
            });
          })(irsaliye.satirlar[i], i, stkfisRefNo);
        }

        return promise;
      })
      .then(function() {
        console.log('    IRSHAR + STKHAR OK');
        console.log('  + Irsaliye olusturuldu: RefNo=' + refNo);
        return { success: true, refNo: refNo };
      });
  })
  .catch(function(error) {
    console.error('  x Irsaliye olusturma hatasi:', error.message);
    return { success: false, error: error.message };
  });
};

/**
 * Son eklenen irsaliyeleri listele (kontrol icin)
 */
EtaClient.prototype.getLastIrsaliyeler = function(limit) {
  var self = this;
  limit = limit || 10;

  var connectPromise = this.pool ? Promise.resolve() : this.connect();

  return connectPromise.then(function() {
    var query =
      "SELECT TOP " + limit + " IRSFISREFNO, IRSFISTAR, IRSFISCARKOD, IRSFISCARUNVAN, IRSFISACIKLAMA1 " +
      "FROM IRSFIS ORDER BY IRSFISREFNO DESC";

    return self.pool.request().query(query);
  })
  .then(function(result) {
    return result.recordset;
  });
};

/**
 * Mevcut calisir bir irsaliyeyi incele (ETA UI'da gorunenleri bulmak icin)
 */
EtaClient.prototype.examineWorkingIrsaliye = function() {
  var self = this;

  var connectPromise = this.pool ? Promise.resolve() : this.connect();

  return connectPromise.then(function() {
    // Herhangi bir irsaliyeyi getir
    var query = "SELECT TOP 1 * FROM IRSFIS ORDER BY IRSFISREFNO DESC";

    return self.pool.request().query(query);
  })
  .then(function(result) {
    return result.recordset[0] || null;
  });
};

/**
 * Mevcut calisir bir irsaliyenin satirlarini incele
 */
EtaClient.prototype.examineWorkingIrsaliyeHar = function(refNo) {
  var self = this;

  var connectPromise = this.pool ? Promise.resolve() : this.connect();

  return connectPromise.then(function() {
    var query = "SELECT TOP 1 * FROM IRSHAR WHERE IRSHARREFNO = @refNo";

    return self.pool.request()
      .input('refNo', sql.Int, refNo)
      .query(query);
  })
  .then(function(result) {
    return result.recordset[0] || null;
  });
};

/**
 * Belirli bir irsaliyenin satirlarini getir
 */
EtaClient.prototype.getIrsaliyeSatirlari = function(refNo) {
  var self = this;

  var connectPromise = this.pool ? Promise.resolve() : this.connect();

  return connectPromise.then(function() {
    var query =
      "SELECT IRSHARSTKKOD, IRSHARSTKBRM, IRSHARMIKTAR " +
      "FROM IRSHAR WHERE IRSHARREFNO = @refNo";

    return self.pool.request()
      .input('refNo', sql.Int, refNo)
      .query(query);
  })
  .then(function(result) {
    return result.recordset;
  });
};

/**
 * Cari bazli stok fiyatlarini getir
 * Once cari kodu ile arar, bulamazsa cari adi ile dener
 * @param {string} cariKod - Cari kodu (orn: "120 00 3002")
 * @param {string} cariAdi - Cari adi (orn: "CRONTON DESIGN HOTEL")
 * @returns {Object} stokKod -> fiyat eslestirmesi
 */
EtaClient.prototype.getCariStokFiyatlari = function(cariKod, cariAdi) {
  var self = this;

  var connectPromise = this.pool ? Promise.resolve() : this.connect();

  return connectPromise.then(function() {
    // Once cari kodu ile dene
    var query =
      "SELECT CARFIYKOD, CARFIYSTKKOD, CARFIYTUTAR " +
      "FROM CARFIYAT " +
      "WHERE CARFIYKOD = @cariKod AND CARFIYSTKKOD IS NOT NULL AND CARFIYSTKKOD != ''";

    return self.pool.request()
      .input('cariKod', sql.VarChar, cariKod)
      .query(query);
  })
  .then(function(result) {
    if (result.recordset.length > 0) {
      console.log('    Fiyatlar cari kodu ile bulundu: ' + cariKod + ' (' + result.recordset.length + ' kayit)');
      return result.recordset;
    }

    // Cari kodu ile bulunamadi, cari adi ile dene (tam eslesme)
    console.log('    Cari kodu ile fiyat bulunamadi, cari adi deneniyor: ' + cariAdi);
    var query2 =
      "SELECT CARFIYKOD, CARFIYSTKKOD, CARFIYTUTAR " +
      "FROM CARFIYAT " +
      "WHERE CARFIYKOD = @cariAdi AND CARFIYSTKKOD IS NOT NULL AND CARFIYSTKKOD != ''";

    return self.pool.request()
      .input('cariAdi', sql.VarChar, cariAdi)
      .query(query2)
      .then(function(result2) {
        if (result2.recordset.length > 0) {
          console.log('    Fiyatlar cari adi ile bulundu: ' + cariAdi + ' (' + result2.recordset.length + ' kayit)');
          return result2.recordset;
        }

        // Tam eslesme bulunamadi
        // 1) Cari kodu ile CARKART'tan ETA'daki unvani bul
        // 2) O unvanla CARFIYAT'ta ara
        // 3) Bulamazsa CARFIYAT'taki tum isimleri normalize edip karsilastir
        console.log('    Tam eslesme bulunamadi, CARKART\'tan unvan cekiliyor...');

        return self.pool.request()
          .input('carKod', sql.VarChar, cariKod)
          .query("SELECT CARUNVAN FROM CARKART WHERE CARKOD = @carKod")
          .then(function(carResult) {
            var etaUnvan = (carResult.recordset[0] && carResult.recordset[0].CARUNVAN) ? carResult.recordset[0].CARUNVAN.toString().trim() : '';

            if (etaUnvan) {
              console.log('    CARKART\'taki unvan: "' + etaUnvan + '"');
              // Bu unvanla CARFIYAT'ta ara
              return self.pool.request()
                .input('etaUnvan', sql.VarChar, etaUnvan)
                .query("SELECT CARFIYKOD, CARFIYSTKKOD, CARFIYTUTAR FROM CARFIYAT WHERE CARFIYKOD = @etaUnvan AND CARFIYSTKKOD IS NOT NULL AND CARFIYSTKKOD != ''")
                .then(function(r) {
                  if (r.recordset.length > 0) {
                    console.log('    CARKART unvani ile ' + r.recordset.length + ' fiyat bulundu');
                    return r.recordset;
                  }
                  console.log('    CARKART unvani ile de bulunamadi');
                  return null; // Devam et
                });
            }
            return null; // Devam et
          })
          .then(function(records) {
            if (records) return records;

            // Son care: tum CARFIYAT isimlerini normalize edip karsilastir
            console.log('    Normalize eslestirme deneniyor...');
            return self.pool.request()
              .query("SELECT DISTINCT CARFIYKOD FROM CARFIYAT WHERE CARFIYSTKKOD IS NOT NULL AND CARFIYSTKKOD != ''")
              .then(function(allNames) {
                function norm(t) {
                  if (!t) return '';
                  var tr = {'İ':'I','I':'I','Ğ':'G','Ü':'U','Ş':'S','Ö':'O','Ç':'C',
                            'ı':'I','i':'I','ğ':'G','ü':'U','ş':'S','ö':'O','ç':'C'};
                  var r = t.toUpperCase().trim();
                  for (var k in tr) { r = r.split(k).join(tr[k]); }
                  return r.replace(/[^A-Z0-9 ]/g, '').trim();
                }

                // Genel kelimeri cikar (HOTEL, OTEL, PALACE vs)
                function coreWords(t) {
                  var skip = ['HOTEL','OTEL','PALACE','SUIT','SUITES','SUITE','INN','RESORT','SPA'];
                  var words = t.split(/\s+/);
                  var result = [];
                  for (var w = 0; w < words.length; w++) {
                    var found = false;
                    for (var sk = 0; sk < skip.length; sk++) {
                      if (words[w] === skip[sk]) { found = true; break; }
                    }
                    if (!found && words[w].length > 0) result.push(words[w]);
                  }
                  return result;
                }

                var searchCore = coreWords(norm(cariAdi));
                console.log('    Aranan cekirdek kelimeler: ' + searchCore.join(', '));

                var bestMatch = null;
                var bestMatchCount = 0;

                for (var s = 0; s < allNames.recordset.length; s++) {
                  var name = (allNames.recordset[s].CARFIYKOD || '').toString().trim();
                  var nameCore = coreWords(norm(name));

                  // Kac kelime eslesiyor?
                  var matchCount = 0;
                  for (var a = 0; a < searchCore.length; a++) {
                    for (var b = 0; b < nameCore.length; b++) {
                      if (searchCore[a] === nameCore[b]) {
                        matchCount++;
                        break;
                      }
                    }
                  }

                  // En az 1 cekirdek kelime eslesmeli ve oncekinden iyi olmali
                  if (matchCount > bestMatchCount) {
                    bestMatchCount = matchCount;
                    bestMatch = name;
                  }
                }

                if (bestMatch && bestMatchCount >= 1) {
                  console.log('    Normalize eslesmesi: "' + cariAdi + '" -> "' + bestMatch + '" (' + bestMatchCount + ' kelime eslesti)');
                  return self.pool.request()
                    .input('matchedName', sql.VarChar, bestMatch)
                    .query("SELECT CARFIYKOD, CARFIYSTKKOD, CARFIYTUTAR FROM CARFIYAT WHERE CARFIYKOD = @matchedName AND CARFIYSTKKOD IS NOT NULL AND CARFIYSTKKOD != ''")
                    .then(function(result4) {
                      console.log('    ' + result4.recordset.length + ' fiyat kaydi bulundu');
                      return result4.recordset;
                    });
                }

                console.log('    ! CARFIYAT tablosunda bu cari icin fiyat bulunamadi');
                console.log('    ! Aranan: kod="' + cariKod + '", ad="' + cariAdi + '"');
                return [];
              });
          });
      });
  })
  .then(function(records) {
    // recordset veya bos dizi
    if (!Array.isArray(records)) records = [];
    var fiyatlar = {};
    for (var i = 0; i < records.length; i++) {
      var row = records[i];
      var stokKod = row.CARFIYSTKKOD ? row.CARFIYSTKKOD.toString().trim() : '';
      var fiyat = row.CARFIYTUTAR || 0;
      if (stokKod) {
        fiyatlar[stokKod] = fiyat;
      }
    }
    return fiyatlar;
  })
  .catch(function(error) {
    console.error('Cari fiyat cekme hatasi:', error.message);
    return {}; // Hata durumunda bos obje don
  });
};

module.exports = EtaClient;
