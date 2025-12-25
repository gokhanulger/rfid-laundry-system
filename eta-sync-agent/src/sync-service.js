/**
 * Senkronizasyon Servisi
 * ETA ve RFID arasinda veri senkronizasyonu yapar
 * Node 12 uyumlu
 */

var EtaClient = require('./eta-client');
var RfidClient = require('./rfid-client');

function SyncService(config) {
  this.etaClient = new EtaClient(config.eta);
  this.rfidClient = new RfidClient(config.rfid);
  this.config = config;
}

// Bekleme fonksiyonu
function delay(ms) {
  return new Promise(function(resolve) {
    setTimeout(resolve, ms);
  });
}

/**
 * Baglantilari test eder
 */
SyncService.prototype.testConnections = function() {
  var self = this;
  console.log('\n--- Baglanti Testi ---\n');

  // ETA testi
  console.log('ETA SQL Server test ediliyor...');
  return this.etaClient.testConnection()
    .then(function(etaResult) {
      if (etaResult.success) {
        console.log('+ ETA baglantisi basarili');
        var version = etaResult.version || '';
        var firstLine = version.split('\n')[0];
        console.log('  SQL Server: ' + firstLine);
      } else {
        console.log('x ETA baglanti hatasi: ' + etaResult.error);
      }

      // RFID testi
      console.log('\nRFID API test ediliyor...');
      return self.rfidClient.testConnection()
        .then(function(rfidResult) {
          if (rfidResult.success) {
            console.log('+ RFID API baglantisi basarili');
          } else {
            console.log('x RFID API baglanti hatasi: ' + rfidResult.error);
          }

          return {
            eta: etaResult.success,
            rfid: rfidResult.success,
          };
        });
    });
};

/**
 * ETA cari kartlarini RFID tenant'larina senkronlar
 */
SyncService.prototype.syncCariler = function() {
  var self = this;
  console.log('\n--- Cari Kart Senkronizasyonu ---\n');

  var created = 0;
  var updated = 0;
  var errors = 0;

  // RFID'ye giris yap
  return this.rfidClient.login()
    .then(function() {
      // ETA'dan carileri cek
      console.log('ETA\'dan cariler cekiliyor...');
      return self.etaClient.getCariKartlar();
    })
    .then(function(cariler) {
      console.log(cariler.length + ' cari bulundu');

      // Siralı senkronizasyon - her cari icin promise chain (3 saniye beklemeli)
      var promise = Promise.resolve();

      for (var i = 0; i < cariler.length; i++) {
        (function(cari, index) {
          promise = promise.then(function() {
            return delay(3000).then(function() {
              return self.rfidClient.syncTenant(cari)
                .then(function(result) {
                  if (result.action === 'created') {
                    created++;
                    console.log('  + ' + cari.unvan + ' (yeni)');
                  } else {
                    updated++;
                    console.log('  ~ ' + cari.unvan + ' (guncellendi)');
                  }
                })
                .catch(function() {
                  errors++;
                  console.log('  x ' + cari.unvan + ' (hata)');
                });
            });
          });
        })(cariler[i], i);
      }

      return promise;
    })
    .then(function() {
      console.log('\nSonuc: ' + created + ' yeni, ' + updated + ' guncellendi, ' + errors + ' hata');
      return self.etaClient.disconnect();
    })
    .then(function() {
      return { success: true, created: created, updated: updated, errors: errors };
    })
    .catch(function(error) {
      console.error('Senkronizasyon hatasi:', error.message);
      return { success: false, error: error.message };
    });
};

/**
 * ETA stok kartlarini RFID item type'larina senkronlar
 */
SyncService.prototype.syncStoklar = function() {
  var self = this;
  console.log('\n--- Stok Kart Senkronizasyonu ---\n');

  var created = 0;
  var updated = 0;
  var errors = 0;

  // RFID'ye giris yap
  return this.rfidClient.login()
    .then(function() {
      // ETA'dan stoklari cek
      console.log('ETA\'dan stoklar cekiliyor...');
      return self.etaClient.getStokKartlar();
    })
    .then(function(stoklar) {
      console.log(stoklar.length + ' stok bulundu');

      // Siralı senkronizasyon (3 saniye beklemeli)
      var promise = Promise.resolve();

      for (var i = 0; i < stoklar.length; i++) {
        (function(stok) {
          promise = promise.then(function() {
            return delay(3000).then(function() {
              return self.rfidClient.syncItemType(stok)
                .then(function(result) {
                  if (result.action === 'created') {
                    created++;
                    console.log('  + ' + stok.ad + ' (yeni)');
                  } else {
                    updated++;
                    console.log('  ~ ' + stok.ad + ' (guncellendi)');
                  }
                })
                .catch(function() {
                  errors++;
                  console.log('  x ' + stok.ad + ' (hata)');
                });
            });
          });
        })(stoklar[i]);
      }

      return promise;
    })
    .then(function() {
      console.log('\nSonuc: ' + created + ' yeni, ' + updated + ' guncellendi, ' + errors + ' hata');
      return self.etaClient.disconnect();
    })
    .then(function() {
      return { success: true, created: created, updated: updated, errors: errors };
    })
    .catch(function(error) {
      console.error('Senkronizasyon hatasi:', error.message);
      return { success: false, error: error.message };
    });
};

/**
 * Tum verileri senkronlar
 */
SyncService.prototype.syncAll = function() {
  var self = this;
  var cariResult;

  console.log('\n========== TAM SENKRONIZASYON ==========\n');

  return this.syncCariler()
    .then(function(result) {
      cariResult = result;
      return self.syncStoklar();
    })
    .then(function(stokResult) {
      console.log('\n========== SENKRONIZASYON TAMAMLANDI ==========');
      console.log('Cariler: ' + (cariResult.created || 0) + ' yeni, ' + (cariResult.updated || 0) + ' guncellendi');
      console.log('Stoklar: ' + (stokResult.created || 0) + ' yeni, ' + (stokResult.updated || 0) + ' guncellendi');

      return {
        cariler: cariResult,
        stoklar: stokResult,
      };
    });
};

/**
 * RFID teslimatlarini ETA'ya irsaliye olarak gonderir
 * Waybill (irsaliye) basilmis olanlari alir
 */
SyncService.prototype.syncIrsaliyeler = function() {
  var self = this;
  console.log('\n--- Irsaliye Senkronizasyonu (RFID -> ETA) ---\n');

  var sent = 0;
  var errors = 0;

  // RFID'ye giris yap
  return this.rfidClient.login()
    .then(function() {
      // Waybill (irsaliye) basilmis ama ETA'ya gonderilmemis deliveryleri al
      console.log('RFID\'den irsaliyesi basilmis teslimatlar cekiliyor...');
      return self.rfidClient.getPrintedWaybills();
    })
    .then(function(deliveries) {
      console.log(deliveries.length + ' teslimat bulundu (ETA\'ya gonderilecek)\n');

      if (deliveries.length === 0) {
        console.log('Gonderilecek irsaliye yok.');
        return { success: true, sent: 0, errors: 0 };
      }

      // Siralı islem (3 saniye beklemeli)
      var promise = Promise.resolve();

      for (var i = 0; i < deliveries.length; i++) {
        (function(delivery) {
          promise = promise.then(function() {
            return delay(3000).then(function() {
              // Delivery detaylarini al
              return self.rfidClient.getDeliveryDetails(delivery.id)
                .then(function(details) {
                  // Debug: API yanitini goster
                  console.log('  DEBUG - Delivery keys:', Object.keys(details));

                  // Tenant bilgisini al
                  var tenant = details.tenant || {};
                  console.log('  DEBUG - Tenant tum alanlar:', JSON.stringify(tenant, null, 2));
                  // ETA cari kodu icin oncelik: etaCariKod > etaCode > cariKod > code > qrCode
                  var cariKod = tenant.etaCariKod || tenant.etaCode || tenant.cariKod || tenant.code || tenant.qrCode || '';
                  var cariUnvan = tenant.name || '';
                  console.log('  DEBUG - Secilen cariKod: ' + cariKod + ', cariUnvan: ' + cariUnvan);

                  var satirlar = [];

                  // ONCELIK 1: notes alaninda JSON olarak saklanan item verileri (ironer'dan)
                  if (details.notes) {
                    try {
                      var labelData = JSON.parse(details.notes);
                      if (Array.isArray(labelData) && labelData.length > 0) {
                        console.log('  DEBUG - Notes icinden ' + labelData.length + ' urun tipi bulundu');
                        for (var n = 0; n < labelData.length; n++) {
                          var noteItem = labelData[n];
                          var typeName = noteItem.typeName || noteItem.name || 'Bilinmeyen';
                          var count = noteItem.count || 0;
                          if (typeName && count > 0) {
                            satirlar.push({
                              stokKod: '', // notes'da kod yok
                              stokAd: typeName,
                              birim: 'ADET',
                              miktar: count,
                              fiyat: 0
                            });
                          }
                        }
                      }
                    } catch (e) {
                      // JSON parse hatasi, notes baska bir sey
                    }
                  }

                  // ONCELIK 2: deliveryItems veya deliveryPackages
                  if (satirlar.length === 0) {
                    var items = details.items || details.deliveryItems || details.lineItems || [];

                    // deliveryPackages icinden items topla
                    if (items.length === 0 && details.deliveryPackages) {
                      var packages = details.deliveryPackages || [];
                      for (var p = 0; p < packages.length; p++) {
                        var pkg = packages[p];
                        var pkgItems = pkg.items || pkg.packageItems || pkg.deliveryItems || [];
                        for (var pi = 0; pi < pkgItems.length; pi++) {
                          items.push(pkgItems[pi]);
                        }
                      }
                    }

                    // Item'lari grupla
                    var gruplar = {};
                    for (var j = 0; j < items.length; j++) {
                      var item = items[j];
                      var itemType = item.itemType || item.item_type || item.type || (item.item && item.item.itemType) || {};
                      var stokKod = itemType.description || itemType.code || '';
                      if (stokKod.indexOf('ETA:') === 0) {
                        stokKod = stokKod.substring(4);
                      }
                      var stokAd = itemType.name || item.name || '';
                      var key = stokKod || stokAd;

                      if (key) {
                        if (!gruplar[key]) {
                          gruplar[key] = {
                            stokKod: stokKod,
                            stokAd: stokAd,
                            birim: 'ADET',
                            miktar: 0,
                            fiyat: 0
                          };
                        }
                        gruplar[key].miktar += 1;
                      }
                    }

                    for (var key in gruplar) {
                      satirlar.push(gruplar[key]);
                    }
                  }

                  // Debug
                  console.log('  DEBUG - Toplam ' + satirlar.length + ' satir bulundu');
                  if (satirlar.length > 0) {
                    console.log('  DEBUG - Ilk satir:', JSON.stringify(satirlar[0]));
                  }

                  if (satirlar.length === 0) {
                    console.log('  - ' + delivery.barcode + ': Bos teslimat (notes ve items bos), atlaniyor');
                    console.log('  DEBUG - notes:', details.notes ? details.notes.substring(0, 200) : 'yok');
                    return;
                  }

                  // ETA'ya irsaliye olustur
                  // waybillNumber varsa evrak no olarak kullan (A-407912105 gibi)
                  var evrakNo = delivery.waybillNumber || delivery.barcode;
                  var irsaliye = {
                    cariKod: cariKod,
                    cariUnvan: cariUnvan,
                    tarih: delivery.pickedUpAt ? new Date(delivery.pickedUpAt) : new Date(),
                    aciklama: 'RFID: ' + evrakNo,
                    evrakNo: evrakNo,
                    barcode: delivery.barcode,
                    satirlar: satirlar
                  };

                  // Otel bazli veritabani secimi
                  var targetDatabase = tenant.etaDatabaseName || self.config.eta.database;
                  console.log('  Hedef veritabani: ' + targetDatabase);

                  // Veritabani degistir (gerekirse)
                  return self.etaClient.switchDatabase(targetDatabase)
                    .then(function() {
                      return self.etaClient.createIrsaliye(irsaliye);
                    })
                    .then(function(result) {
                      if (result.success) {
                        sent++;
                        console.log('  + Irsaliye ' + evrakNo + ' (Delivery: ' + delivery.barcode + ') -> ETA RefNo: ' + result.refNo);

                        // RFID'de isaretle
                        return self.rfidClient.markDeliveryAsEtaSynced(delivery.id, result.refNo);
                      } else {
                        errors++;
                        console.log('  x Irsaliye ' + evrakNo + ': ' + result.error);
                      }
                    });
                })
                .catch(function(error) {
                  errors++;
                  console.log('  x Irsaliye ' + (delivery.waybillNumber || delivery.barcode) + ': ' + error.message);
                });
            });
          });
        })(deliveries[i]);
      }

      return promise.then(function() {
        return { success: true, sent: sent, errors: errors };
      });
    })
    .then(function(result) {
      console.log('\nSonuc: ' + result.sent + ' gonderildi, ' + result.errors + ' hata');
      return self.etaClient.disconnect().then(function() {
        return result;
      });
    })
    .catch(function(error) {
      console.error('Irsaliye senkronizasyon hatasi:', error.message);
      return { success: false, error: error.message };
    });
};

/**
 * ETA tablolarini listeler (kesif)
 */
SyncService.prototype.exploreTables = function() {
  var self = this;
  console.log('\n--- ETA Tablo Kesfi ---\n');

  return this.etaClient.listTables()
    .then(function(tables) {
      console.log(tables.length + ' tablo bulundu:\n');

      // Onemli tablolari vurgula
      var important = ['CAR', 'STK', 'IRS', 'FAT', 'CAS'];
      for (var i = 0; i < tables.length; i++) {
        var table = tables[i];
        var isImportant = false;
        for (var j = 0; j < important.length; j++) {
          if (table.toUpperCase().indexOf(important[j]) !== -1) {
            isImportant = true;
            break;
          }
        }
        if (isImportant) {
          console.log('  * ' + table);
        } else {
          console.log('    ' + table);
        }
      }

      return self.etaClient.disconnect().then(function() {
        return tables;
      });
    })
    .catch(function(error) {
      console.error('Tablo listesi alinamadi:', error.message);
      return [];
    });
};

/**
 * Belirli bir tablonun kolonlarini listeler
 */
SyncService.prototype.exploreTable = function(tableName) {
  var self = this;
  console.log('\n--- ' + tableName + ' Tablo Yapisi ---\n');

  return this.etaClient.getTableColumns(tableName)
    .then(function(columns) {
      console.log(columns.length + ' kolon:\n');

      for (var i = 0; i < columns.length; i++) {
        var col = columns[i];
        console.log('  ' + col.COLUMN_NAME + ' (' + col.DATA_TYPE + ')');
      }

      return self.etaClient.disconnect().then(function() {
        return columns;
      });
    })
    .catch(function(error) {
      console.error('Kolon listesi alinamadi:', error.message);
      return [];
    });
};

/**
 * ETA'daki son irsaliyeleri kontrol et
 */
SyncService.prototype.checkEtaIrsaliyeler = function() {
  var self = this;
  console.log('\n--- ETA\'daki Son 50 Irsaliye ---\n');

  return this.etaClient.getLastIrsaliyeler(50)
    .then(function(irsaliyeler) {
      if (irsaliyeler.length === 0) {
        console.log('Hic irsaliye bulunamadi!');
      } else {
        console.log(irsaliyeler.length + ' irsaliye bulundu:\n');
        for (var i = 0; i < irsaliyeler.length; i++) {
          var irs = irsaliyeler[i];
          var tarih = irs.IRSFISTAR ? new Date(irs.IRSFISTAR).toLocaleDateString('tr-TR') : '';
          var firma = irs.IRSFISFIRMA !== undefined ? ' | Firma:' + irs.IRSFISFIRMA : '';
          console.log('  RefNo: ' + irs.IRSFISREFNO + ' | ' + tarih + ' | ' + (irs.IRSFISCARUNVAN || '-') + ' | ' + (irs.IRSFISACIKLAMA1 || '') + firma);
        }
      }
      return self.etaClient.disconnect().then(function() {
        return irsaliyeler;
      });
    })
    .catch(function(error) {
      console.error('Irsaliye listesi alinamadi:', error.message);
      return [];
    });
};

/**
 * ETA'da calisir bir irsaliyeyi incele - hangi kolonlar dolu?
 */
SyncService.prototype.examineWorkingIrsaliye = function() {
  var self = this;
  console.log('\n--- ETA\'da Calisir Bir Irsaliye Inceleniyor ---\n');

  return this.etaClient.examineWorkingIrsaliye()
    .then(function(fis) {
      if (!fis) {
        console.log('ETA tarafindan olusturulmus irsaliye bulunamadi!');
        console.log('Not: RFID ile olusturulanlar haric arandı.');
        return self.etaClient.disconnect().then(function() {
          return null;
        });
      }

      console.log('IRSFIS kaydı (RefNo: ' + fis.IRSFISREFNO + '):\n');
      console.log('Dolu olan kolonlar:');

      var doluKolonlar = [];
      for (var key in fis) {
        var val = fis[key];
        if (val !== null && val !== '' && val !== 0) {
          doluKolonlar.push(key);
          var displayVal = val;
          if (val instanceof Date) {
            displayVal = val.toLocaleDateString('tr-TR');
          } else if (typeof val === 'string' && val.length > 50) {
            displayVal = val.substring(0, 50) + '...';
          }
          console.log('  ' + key + ' = ' + displayVal);
        }
      }

      // Satirlari da incele
      return self.etaClient.examineWorkingIrsaliyeHar(fis.IRSFISREFNO)
        .then(function(har) {
          if (har) {
            console.log('\nIRSHAR kaydı (ilk satır):');
            console.log('Dolu olan kolonlar:');
            for (var key in har) {
              var val = har[key];
              if (val !== null && val !== '' && val !== 0) {
                var displayVal = val;
                if (val instanceof Date) {
                  displayVal = val.toLocaleDateString('tr-TR');
                } else if (typeof val === 'string' && val.length > 50) {
                  displayVal = val.substring(0, 50) + '...';
                }
                console.log('  ' + key + ' = ' + displayVal);
              }
            }
          }

          return self.etaClient.disconnect().then(function() {
            return { fis: fis, har: har };
          });
        });
    })
    .catch(function(error) {
      console.error('Inceleme hatasi:', error.message);
      return null;
    });
};

module.exports = SyncService;
