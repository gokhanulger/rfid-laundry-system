/**
 * ETA SQL Server Client
 * Yerel agdan ETA veritabanina baglanir
 * Node 12 uyumlu
 */

var sql = require('mssql');

function EtaClient(config) {
  this.config = {
    server: config.server,
    port: config.port,
    database: config.database,
    user: config.user,
    password: config.password,
    options: {
      encrypt: false,
      trustServerCertificate: true,
    },
    pool: {
      max: 10,
      min: 0,
      idleTimeoutMillis: 30000,
    },
  };
  this.pool = null;
}

EtaClient.prototype.connect = function() {
  var self = this;
  return new sql.ConnectionPool(this.config).connect()
    .then(function(pool) {
      self.pool = pool;
      console.log('+ ETA SQL Server baglantisi basarili');
      return true;
    })
    .catch(function(error) {
      console.error('x ETA baglanti hatasi:', error.message);
      throw error;
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
 * Tum ilgili tablolara kayit atar: IRSFIS, IRSHAR, CARFIS, STKFIS, STKHAR
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

    // Toplam tutari hesapla
    var toplamTutar = 0;
    for (var t = 0; t < irsaliye.satirlar.length; t++) {
      var s = irsaliye.satirlar[t];
      toplamTutar += (s.miktar || 0) * (s.fiyat || 0);
    }

    console.log('  RefNo: ' + refNo + ' olusturuluyor...');

    // 1. IRSFIS - Irsaliye Fis (Ana kayit)
    var irsfisQuery =
      "INSERT INTO IRSFIS (IRSFISREFNO, IRSFISTAR, IRSFISTIPI, IRSFISCARKOD, IRSFISCARUNVAN, " +
      "IRSFISACIKLAMA1, IRSFISSAAT, IRSFISKAYONC, IRSFISGENTOPLAM) " +
      "VALUES (@refNo, @tarih, 1, @cariKod, @cariUnvan, @aciklama, @saat, 1, @toplamTutar)";

    return self.pool.request()
      .input('refNo', sql.Int, refNo)
      .input('tarih', sql.DateTime, tarih)
      .input('cariKod', sql.VarChar, cariKod)
      .input('cariUnvan', sql.VarChar, cariUnvan)
      .input('aciklama', sql.VarChar, aciklama)
      .input('saat', sql.VarChar, saat)
      .input('toplamTutar', sql.Numeric, toplamTutar)
      .query(irsfisQuery)
      .then(function() {
        console.log('    IRSFIS OK');

        // 2. CARFIS - Cari Fis (Borc kaydi)
        var carfisQuery =
          "INSERT INTO CARFIS (CARFISREFNO, CARFISTAR, CARFISTIPI, CARFISCARKOD, CARFISCARUNVAN, " +
          "CARFISACIKLAMA1, CARFISBORCTOP, CARFISKAYONC) " +
          "VALUES (@refNo, @tarih, 1, @cariKod, @cariUnvan, @aciklama, @toplamTutar, 1)";

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

        // 3. STKFIS - Stok Fis
        var stkfisQuery =
          "INSERT INTO STKFIS (STKFISREFNO, STKFISTAR, STKFISTIPI, STKFISCARKOD, " +
          "STKFISACIKLAMA1, STKFISKAYONC, STKFISTOPTUT) " +
          "VALUES (@refNo, @tarih, 1, @cariKod, @aciklama, 1, @toplamTutar)";

        return self.pool.request()
          .input('refNo', sql.Int, refNo)
          .input('tarih', sql.DateTime, tarih)
          .input('cariKod', sql.VarChar, cariKod)
          .input('aciklama', sql.VarChar, aciklama)
          .input('toplamTutar', sql.Numeric, toplamTutar)
          .query(stkfisQuery);
      })
      .then(function() {
        console.log('    STKFIS OK');

        // 4. IRSHAR ve STKHAR - Satirlar
        var promise = Promise.resolve();

        for (var i = 0; i < irsaliye.satirlar.length; i++) {
          (function(satir, lineIndex) {
            promise = promise.then(function() {
              var siraNo = lineIndex + 1;
              var stokKod = satir.stokKod || satir.stokAd || '';
              var birim = satir.birim || 'ADET';
              var miktar = satir.miktar || 0;
              var fiyat = satir.fiyat || 0;
              var tutar = miktar * fiyat;

              // IRSHAR - Irsaliye Hareket
              var irsharQuery =
                "INSERT INTO IRSHAR (IRSHARREFNO, IRSHARTAR, IRSHARTIPI, IRSHARCARKOD, " +
                "IRSHARSTKKOD, IRSHARSTKBRM, IRSHARMIKTAR, IRSHARFIYAT, IRSHARTUTAR, " +
                "IRSHARKAYONC, IRSHARSIRANO) " +
                "VALUES (@refNo, @tarih, 1, @cariKod, @stokKod, @birim, @miktar, @fiyat, @tutar, 1, @siraNo)";

              return self.pool.request()
                .input('refNo', sql.Int, refNo)
                .input('tarih', sql.DateTime, tarih)
                .input('cariKod', sql.VarChar, cariKod)
                .input('stokKod', sql.VarChar, stokKod)
                .input('birim', sql.VarChar, birim)
                .input('miktar', sql.Numeric, miktar)
                .input('fiyat', sql.Numeric, fiyat)
                .input('tutar', sql.Numeric, tutar)
                .input('siraNo', sql.Int, siraNo)
                .query(irsharQuery)
                .then(function() {
                  // STKHAR - Stok Hareket
                  var stkharQuery =
                    "INSERT INTO STKHAR (STKHARREFNO, STKHARTAR, STKHARTIPI, STKHARCARKOD, " +
                    "STKHARSTKKOD, STKHARSTKBRM, STKHARMIKTAR, STKHARFIYAT, STKHARTUTAR, " +
                    "STKHARKAYONC, STKHARSIRANO) " +
                    "VALUES (@refNo, @tarih, 1, @cariKod, @stokKod, @birim, @miktar, @fiyat, @tutar, 1, @siraNo)";

                  return self.pool.request()
                    .input('refNo', sql.Int, refNo)
                    .input('tarih', sql.DateTime, tarih)
                    .input('cariKod', sql.VarChar, cariKod)
                    .input('stokKod', sql.VarChar, stokKod)
                    .input('birim', sql.VarChar, birim)
                    .input('miktar', sql.Numeric, miktar)
                    .input('fiyat', sql.Numeric, fiyat)
                    .input('tutar', sql.Numeric, tutar)
                    .input('siraNo', sql.Int, siraNo)
                    .query(stkharQuery);
                });
            });
          })(irsaliye.satirlar[i], i);
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
      "SELECT TOP " + limit + " IRSFISREFNO, IRSFISTAR, IRSFISCARKOD, IRSFISCARUNVAN, IRSFISACIKLAMA1, IRSFISFIRMA " +
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

module.exports = EtaClient;
