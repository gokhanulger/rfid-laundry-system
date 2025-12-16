#!/usr/bin/env node
/**
 * ETA Sync Agent
 * ETA V.8 SQL ile RFID Camasirhane sistemi arasinda senkronizasyon
 * Node 12 uyumlu
 */

var fs = require('fs');
var path = require('path');
var readline = require('readline');
var SyncService = require('./src/sync-service');

// Config dosyasini oku
var configPath = path.join(__dirname, 'config.json');
var config;

try {
  config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
} catch (error) {
  console.error('config.json dosyasi okunamadi!');
  console.error('Lutfen config.json dosyasini duzeltip tekrar deneyin.');
  process.exit(1);
}

var syncService = new SyncService(config);

// Otomatik sync modu
var args = process.argv.slice(2);
var isAutoMode = args.indexOf('--auto') !== -1;
var isSingleSync = args.indexOf('--sync') !== -1;

function runAutoSync() {
  var intervalMinutes = (config.sync && config.sync.intervalMinutes) || 30;

  console.log('\n========================================');
  console.log('  ETA SYNC AGENT - OTOMATIK MOD');
  console.log('  Interval: ' + intervalMinutes + ' dakika');
  console.log('========================================\n');

  function doSync() {
    var now = new Date();
    console.log('\n[' + now.toLocaleString('tr-TR') + '] Senkronizasyon basliyor...');

    syncService.syncAll()
      .then(function(result) {
        console.log('[' + new Date().toLocaleString('tr-TR') + '] Senkronizasyon tamamlandi.');
        console.log('Sonraki sync: ' + intervalMinutes + ' dakika sonra\n');
      })
      .catch(function(error) {
        console.error('[' + new Date().toLocaleString('tr-TR') + '] Senkronizasyon hatasi:', error.message);
        console.log('Sonraki deneme: ' + intervalMinutes + ' dakika sonra\n');
      });
  }

  // Ilk sync
  doSync();

  // Periyodik sync
  setInterval(doSync, intervalMinutes * 60 * 1000);
}

function runSingleSync() {
  console.log('\n  ETA Sync Agent - Tek Seferlik Sync\n');

  syncService.syncAll()
    .then(function() {
      console.log('\nTamamlandi.');
      process.exit(0);
    })
    .catch(function(error) {
      console.error('\nHata:', error.message);
      process.exit(1);
    });
}

// Mod kontrolu
if (isAutoMode) {
  runAutoSync();
} else if (isSingleSync) {
  runSingleSync();
} else {
  // Normal menu modu
  main();
}

// Menu goster
function showMenu() {
  console.log('\n');
  console.log('+======================================================+');
  console.log('|           ETA SYNC AGENT v1.0                        |');
  console.log('|     ETA V.8 SQL <-> RFID Camasirhane                 |');
  console.log('+======================================================+');
  console.log('|                                                      |');
  console.log('|  1. Baglanti Testi                                   |');
  console.log('|  2. Carileri Senkronize Et (ETA -> RFID)             |');
  console.log('|  3. Stoklari Senkronize Et (ETA -> RFID)             |');
  console.log('|  4. Tam Senkronizasyon (Cariler + Stoklar)           |');
  console.log('|  5. Irsaliyeleri Gonder (RFID -> ETA)                |');
  console.log('|  --------------------------------------------------  |');
  console.log('|  6. ETA Tablolarini Gor (Kesif)                      |');
  console.log('|  7. Tablo Yapisi Gor                                 |');
  console.log('|  8. Ayarlar                                          |');
  console.log('|  9. ETA Irsaliyelerini Kontrol Et                    |');
  console.log('|  A. Calisir Irsaliye Incele (Debug)                  |');
  console.log('|  0. Cikis                                            |');
  console.log('|                                                      |');
  console.log('+======================================================+');
  console.log('');
}

function showSettings() {
  var etaPassLen = (config.eta.password && config.eta.password.length) || 0;
  var rfidPassLen = (config.rfid.password && config.rfid.password.length) || 0;
  var etaStars = '';
  var rfidStars = '';
  for (var i = 0; i < etaPassLen; i++) etaStars += '*';
  for (var i = 0; i < rfidPassLen; i++) rfidStars += '*';

  console.log('\n--- Mevcut Ayarlar ---\n');
  console.log('ETA SQL Server:');
  console.log('  Sunucu: ' + config.eta.server + ':' + config.eta.port);
  console.log('  Veritabani: ' + config.eta.database);
  console.log('  Kullanici: ' + config.eta.user);
  console.log('  Sifre: ' + etaStars);
  console.log('');
  console.log('RFID API:');
  console.log('  URL: ' + config.rfid.apiUrl);
  console.log('  Kullanici: ' + config.rfid.username);
  console.log('  Sifre: ' + rfidStars);
  console.log('');
  console.log('Ayarlari degistirmek icin config.json dosyasini duzenleyin.');
}

// Readline interface
var rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function prompt(question) {
  return new Promise(function(resolve) {
    rl.question(question, resolve);
  });
}

function handleChoice(choice) {
  var trimmed = choice.trim();

  switch (trimmed) {
    case '1':
      return syncService.testConnections();

    case '2':
      return syncService.syncCariler();

    case '3':
      return syncService.syncStoklar();

    case '4':
      return syncService.syncAll();

    case '5':
      return syncService.syncIrsaliyeler();

    case '6':
      return syncService.exploreTables();

    case '7':
      return prompt('Tablo adi: ')
        .then(function(tableName) {
          if (tableName.trim()) {
            return syncService.exploreTable(tableName.trim());
          }
        });

    case '8':
      showSettings();
      return Promise.resolve();

    case '9':
      return syncService.checkEtaIrsaliyeler();

    case 'A':
    case 'a':
      return syncService.examineWorkingIrsaliye();

    case '0':
    case 'q':
    case 'Q':
      console.log('\nGorustumek uzere!\n');
      rl.close();
      process.exit(0);
      return Promise.resolve();

    default:
      console.log('\nGecersiz secim. Lutfen 0-9 arasinda bir sayi girin.');
      return Promise.resolve();
  }
}

function mainLoop() {
  showMenu();

  prompt('Seciminiz (0-9): ')
    .then(function(choice) {
      return handleChoice(choice);
    })
    .then(function() {
      return prompt('\nDevam etmek icin Enter\'a basin...');
    })
    .then(function() {
      mainLoop();
    })
    .catch(function(error) {
      console.error('Hata:', error.message);
      mainLoop();
    });
}

function main() {
  console.log('\n  ETA Sync Agent baslatiliyor...\n');
  mainLoop();
}

// Hata yakalama
process.on('uncaughtException', function(error) {
  console.error('\nBeklenmeyen hata:', error.message);
});

process.on('unhandledRejection', function(error) {
  console.error('\nIslem hatasi:', error.message);
});

// Baslat
main();
