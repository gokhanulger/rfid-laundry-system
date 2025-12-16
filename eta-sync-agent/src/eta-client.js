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
 */
EtaClient.prototype.createIrsaliye = function(irsaliye) {
  var self = this;

  var connectPromise = this.pool ? Promise.resolve() : this.connect();

  return connectPromise.then(function() {
    return self.getNextIrsaliyeRefNo();
  })
  .then(function(refNo) {
    // IRSFIS (header) kaydi olustur
    var tarih = irsaliye.tarih || new Date();
    var saat = ('0' + tarih.getHours()).slice(-2) + ':' + ('0' + tarih.getMinutes()).slice(-2);

    // ETA V.8 icin gerekli tum kolonlar
    // IRSFISFIRMA: Firma kodu (genellikle 1)
    // IRSFISTIPI: 1=Satis Irsaliyesi
    // IRSFISKAYONC: 1=Cikis
    var headerQuery =
      "INSERT INTO IRSFIS (IRSFISREFNO, IRSFISTAR, IRSFISTIPI, IRSFISCARKOD, IRSFISCARUNVAN, " +
      "IRSFISACIKLAMA1, IRSFISSAAT, IRSFISKAYONC, IRSFISFIRMA) " +
      "VALUES (@refNo, @tarih, 1, @cariKod, @cariUnvan, @aciklama, @saat, 1, 1)";

    return self.pool.request()
      .input('refNo', sql.Int, refNo)
      .input('tarih', sql.DateTime, tarih)
      .input('cariKod', sql.VarChar, irsaliye.cariKod || '')
      .input('cariUnvan', sql.VarChar, irsaliye.cariUnvan || '')
      .input('aciklama', sql.VarChar, irsaliye.aciklama || 'RFID Sistem')
      .input('saat', sql.VarChar, saat)
      .query(headerQuery)
      .then(function() {
        // IRSHAR (satirlar) kayitlari olustur
        var promise = Promise.resolve();
        var siraNo = 0;

        for (var i = 0; i < irsaliye.satirlar.length; i++) {
          (function(satir, lineIndex) {
            promise = promise.then(function() {
              siraNo = lineIndex + 1;
              // ETA V.8 icin gerekli kolonlar
              // IRSHARSIRANO: Satir numarasi (1'den baslar)
              // IRSHARFIRMA: Firma kodu (genellikle 1)
              var satirQuery =
                "INSERT INTO IRSHAR (IRSHARREFNO, IRSHARTAR, IRSHARTIPI, IRSHARCARKOD, " +
                "IRSHARSTKKOD, IRSHARSTKBRM, IRSHARMIKTAR, IRSHARKAYONC, IRSHARSIRANO, IRSHARFIRMA) " +
                "VALUES (@refNo, @tarih, 1, @cariKod, @stokKod, @birim, @miktar, 1, @siraNo, 1)";

              return self.pool.request()
                .input('refNo', sql.Int, refNo)
                .input('tarih', sql.DateTime, tarih)
                .input('cariKod', sql.VarChar, irsaliye.cariKod || '')
                .input('stokKod', sql.VarChar, satir.stokAd || '') // stokAd'i stokKod olarak kullan
                .input('birim', sql.VarChar, satir.birim || 'ADET')
                .input('miktar', sql.Numeric, satir.miktar || 0)
                .input('siraNo', sql.Int, lineIndex + 1)
                .query(satirQuery);
            });
          })(irsaliye.satirlar[i], i);
        }

        return promise.then(function() {
          console.log('  + Irsaliye olusturuldu: RefNo=' + refNo);
          return { success: true, refNo: refNo };
        });
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
