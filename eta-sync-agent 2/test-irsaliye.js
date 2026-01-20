/**
 * Calisan bir irsaliyeyi incele - hangi alanlar dolu?
 */
var sql = require('mssql');
var fs = require('fs');

// Config oku
var config = JSON.parse(fs.readFileSync('config.json', 'utf8'));

var sqlConfig = {
  server: config.eta.server,
  port: config.eta.port,
  database: config.eta.database,
  user: config.eta.user,
  password: config.eta.password,
  options: {
    encrypt: false,
    trustServerCertificate: true
  }
};

console.log('\n=== ETA CALISAN IRSALIYE INCELEME ===\n');
console.log('Baglaniyor: ' + sqlConfig.server + '/' + sqlConfig.database);

sql.connect(sqlConfig).then(function(pool) {
  console.log('Baglanti basarili!\n');

  // Son eklenen RFID haricindeki bir irsaliyeyi bul
  var query = "SELECT TOP 1 * FROM IRSFIS WHERE IRSFISACIKLAMA1 NOT LIKE '%RFID%' ORDER BY IRSFISREFNO DESC";

  return pool.request().query(query);
}).then(function(result) {
  if (result.recordset.length === 0) {
    console.log('Irsaliye bulunamadi!');
    process.exit(1);
  }

  var row = result.recordset[0];
  console.log('=== DOLU ALANLAR (RefNo: ' + row.IRSFISREFNO + ') ===\n');

  var doluAlanlar = [];
  for (var key in row) {
    var val = row[key];
    if (val !== null && val !== '' && val !== 0) {
      doluAlanlar.push(key);
      var displayVal = val;
      if (val instanceof Date) {
        displayVal = val.toLocaleDateString('tr-TR');
      } else if (typeof val === 'string' && val.length > 50) {
        displayVal = val.substring(0, 50) + '...';
      }
      console.log(key + ' = ' + displayVal);
    }
  }

  console.log('\n=== TOPLAM ' + doluAlanlar.length + ' DOLU ALAN ===');
  process.exit(0);
}).catch(function(err) {
  console.log('HATA:', err.message);
  process.exit(1);
});
