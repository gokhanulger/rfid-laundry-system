/**
 * Tedious ile ETA SQL Server testi
 * Node 12 uyumlu
 */
var Connection = require('tedious').Connection;
var Request = require('tedious').Request;
var fs = require('fs');

// Config oku
var configFile = fs.readFileSync('config.json', 'utf8');
var config = JSON.parse(configFile);

var connectionConfig = {
  server: config.eta.server,
  authentication: {
    type: 'default',
    options: {
      userName: config.eta.user,
      password: config.eta.password
    }
  },
  options: {
    port: config.eta.port,
    database: config.eta.database,
    encrypt: false,
    trustServerCertificate: true,
    rowCollectionOnRequestCompletion: true
  }
};

console.log('\n=== TEDIOUS SQL SERVER TEST ===\n');
console.log('Baglaniyor: ' + connectionConfig.server + '/' + connectionConfig.options.database);

var connection = new Connection(connectionConfig);

connection.on('connect', function(err) {
  if (err) {
    console.log('Baglanti hatasi:', err.message);
    process.exit(1);
  }

  console.log('Baglanti basarili!\n');

  // Calisan bir irsaliye bul
  var query = "SELECT TOP 1 * FROM IRSFIS ORDER BY IRSFISREFNO DESC";

  var request = new Request(query, function(err, rowCount, rows) {
    if (err) {
      console.log('Sorgu hatasi:', err.message);
      connection.close();
      process.exit(1);
    }

    if (rowCount === 0) {
      console.log('Irsaliye bulunamadi!');
      connection.close();
      process.exit(1);
    }

    console.log('=== IRSFIS DOLU ALANLAR ===\n');

    var row = rows[0];
    for (var i = 0; i < row.length; i++) {
      var col = row[i];
      if (col.value !== null && col.value !== '' && col.value !== 0) {
        var displayVal = col.value;
        if (col.value instanceof Date) {
          displayVal = col.value.toISOString();
        } else if (typeof col.value === 'string' && col.value.length > 60) {
          displayVal = col.value.substring(0, 60) + '...';
        }
        console.log('  ' + col.metadata.colName + ' = ' + displayVal);
      }
    }

    console.log('\n=== TAMAMLANDI ===\n');
    connection.close();
  });

  connection.execSql(request);
});

connection.on('error', function(err) {
  console.log('Connection error:', err.message);
});
