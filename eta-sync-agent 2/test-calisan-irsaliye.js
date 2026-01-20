/**
 * Calisan bir irsaliyeyi incele - RFID disindaki bir kayit
 * Bu script ETA UI'da gorunen kayitlarin hangi alanlari dolu oldugunu gosterir
 */
var sql = require('mssql');
var fs = require('fs');

// Config oku
var config = JSON.parse(fs.readFileSync('config.json', 'utf8'));

var sqlConfig = {
  server: config.eta.server,
  port: config.eta.port,
  database: config.eta.database,
  options: {
    encrypt: false,
    trustServerCertificate: true,
    trustedConnection: config.eta.trustedConnection || false
  }
};

// Windows Authentication degilse user/password ekle
if (!config.eta.trustedConnection) {
  sqlConfig.user = config.eta.user;
  sqlConfig.password = config.eta.password;
}

console.log('\n=== ETA CALISAN IRSALIYE INCELEME ===\n');
console.log('Baglaniyor: ' + sqlConfig.server + '/' + sqlConfig.database);

var pool;
var refNo;

sql.connect(sqlConfig).then(function(p) {
  pool = p;
  console.log('Baglanti basarili!\n');

  // RFID disinda bir irsaliye bul
  var query = "SELECT TOP 1 * FROM IRSFIS WHERE IRSFISACIKLAMA1 NOT LIKE '%RFID%' OR IRSFISACIKLAMA1 IS NULL ORDER BY IRSFISREFNO DESC";
  return pool.request().query(query);

}).then(function(result) {
  if (result.recordset.length === 0) {
    console.log('RFID disinda irsaliye bulunamadi, herhangi bir irsaliye aliniyor...');
    return pool.request().query("SELECT TOP 1 * FROM IRSFIS ORDER BY IRSFISREFNO DESC");
  }
  return result;

}).then(function(result) {
  if (result.recordset.length === 0) {
    console.log('Hic irsaliye bulunamadi!');
    process.exit(1);
  }

  var row = result.recordset[0];
  refNo = row.IRSFISREFNO;

  console.log('=== IRSFIS DOLU ALANLAR (RefNo: ' + refNo + ') ===\n');

  for (var key in row) {
    var val = row[key];
    if (val !== null && val !== '' && val !== 0) {
      var displayVal = val;
      if (val instanceof Date) {
        displayVal = val.toISOString();
      } else if (typeof val === 'string' && val.length > 60) {
        displayVal = val.substring(0, 60) + '...';
      }
      console.log('  ' + key + ' = ' + displayVal);
    }
  }

  // IRSHAR kontrolu
  console.log('\n=== IRSHAR KONTROL (RefNo: ' + refNo + ') ===\n');
  return pool.request()
    .input('refNo', sql.Int, refNo)
    .query("SELECT TOP 1 * FROM IRSHAR WHERE IRSHARREFNO = @refNo");

}).then(function(result) {
  if (result.recordset.length === 0) {
    console.log('  IRSHAR kaydi yok!');
  } else {
    var row = result.recordset[0];
    for (var key in row) {
      var val = row[key];
      if (val !== null && val !== '' && val !== 0) {
        var displayVal = val;
        if (val instanceof Date) {
          displayVal = val.toISOString();
        } else if (typeof val === 'string' && val.length > 60) {
          displayVal = val.substring(0, 60) + '...';
        }
        console.log('  ' + key + ' = ' + displayVal);
      }
    }
  }

  // CARFIS kontrolu
  console.log('\n=== CARFIS KONTROL (RefNo: ' + refNo + ') ===\n');
  return pool.request()
    .input('refNo', sql.Int, refNo)
    .query("SELECT TOP 1 * FROM CARFIS WHERE CARFISREFNO = @refNo");

}).then(function(result) {
  if (result.recordset.length === 0) {
    console.log('  CARFIS kaydi yok!');
  } else {
    var row = result.recordset[0];
    for (var key in row) {
      var val = row[key];
      if (val !== null && val !== '' && val !== 0) {
        var displayVal = val;
        if (val instanceof Date) {
          displayVal = val.toISOString();
        } else if (typeof val === 'string' && val.length > 60) {
          displayVal = val.substring(0, 60) + '...';
        }
        console.log('  ' + key + ' = ' + displayVal);
      }
    }
  }

  // CARHAR kontrolu
  console.log('\n=== CARHAR KONTROL (RefNo: ' + refNo + ') ===\n');
  return pool.request()
    .input('refNo', sql.Int, refNo)
    .query("SELECT TOP 1 * FROM CARHAR WHERE CARHARREFNO = @refNo");

}).then(function(result) {
  if (result.recordset.length === 0) {
    console.log('  CARHAR kaydi yok!');
  } else {
    var row = result.recordset[0];
    for (var key in row) {
      var val = row[key];
      if (val !== null && val !== '' && val !== 0) {
        var displayVal = val;
        if (val instanceof Date) {
          displayVal = val.toISOString();
        } else if (typeof val === 'string' && val.length > 60) {
          displayVal = val.substring(0, 60) + '...';
        }
        console.log('  ' + key + ' = ' + displayVal);
      }
    }
  }

  // STKFIS kontrolu
  console.log('\n=== STKFIS KONTROL (RefNo: ' + refNo + ') ===\n');
  return pool.request()
    .input('refNo', sql.Int, refNo)
    .query("SELECT TOP 1 * FROM STKFIS WHERE STKFISREFNO = @refNo");

}).then(function(result) {
  if (result.recordset.length === 0) {
    console.log('  STKFIS kaydi yok!');
  } else {
    var row = result.recordset[0];
    for (var key in row) {
      var val = row[key];
      if (val !== null && val !== '' && val !== 0) {
        var displayVal = val;
        if (val instanceof Date) {
          displayVal = val.toISOString();
        } else if (typeof val === 'string' && val.length > 60) {
          displayVal = val.substring(0, 60) + '...';
        }
        console.log('  ' + key + ' = ' + displayVal);
      }
    }
  }

  // STKHAR kontrolu
  console.log('\n=== STKHAR KONTROL (RefNo: ' + refNo + ') ===\n');
  return pool.request()
    .input('refNo', sql.Int, refNo)
    .query("SELECT TOP 1 * FROM STKHAR WHERE STKHARREFNO = @refNo");

}).then(function(result) {
  if (result.recordset.length === 0) {
    console.log('  STKHAR kaydi yok!');
  } else {
    var row = result.recordset[0];
    for (var key in row) {
      var val = row[key];
      if (val !== null && val !== '' && val !== 0) {
        var displayVal = val;
        if (val instanceof Date) {
          displayVal = val.toISOString();
        } else if (typeof val === 'string' && val.length > 60) {
          displayVal = val.substring(0, 60) + '...';
        }
        console.log('  ' + key + ' = ' + displayVal);
      }
    }
  }

  console.log('\n=== INCELEME TAMAMLANDI ===\n');
  process.exit(0);

}).catch(function(err) {
  console.log('HATA:', err.message);
  process.exit(1);
});
