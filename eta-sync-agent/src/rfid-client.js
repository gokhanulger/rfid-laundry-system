/**
 * RFID Backend API Client
 * HTTPS uzerinden RFID sistemine baglanir
 * Node 12 uyumlu
 */

var axios = require('axios');

function RfidClient(config) {
  this.apiUrl = config.apiUrl;
  this.username = config.username;
  this.password = config.password;
  this.token = null;

  this.client = axios.create({
    baseURL: this.apiUrl,
    timeout: 30000,
    headers: {
      'Content-Type': 'application/json',
    },
  });
}

function delay(ms) {
  return new Promise(function(resolve) {
    setTimeout(resolve, ms);
  });
}

RfidClient.prototype.login = function(retryCount) {
  var self = this;
  retryCount = retryCount || 0;

  return this.client.post('/auth/login', {
    email: this.username,
    password: this.password,
  })
  .then(function(response) {
    if (response.data.token) {
      self.token = response.data.token;
      self.client.defaults.headers['Authorization'] = 'Bearer ' + self.token;
      console.log('+ RFID API giris basarili');
      return true;
    }
    throw new Error('Token alinamadi');
  })
  .catch(function(error) {
    var status = error.response && error.response.status;
    if (status === 429 && retryCount < 5) {
      console.log('  Rate limit, ' + (retryCount + 1) + '. deneme icin 10 saniye bekleniyor...');
      return delay(10000).then(function() {
        return self.login(retryCount + 1);
      });
    }
    var errMsg = (error.response && error.response.data && error.response.data.error) || error.message;
    console.error('x RFID API giris hatasi:', errMsg);
    throw error;
  });
};

RfidClient.prototype.testConnection = function() {
  return this.client.get('/health')
    .then(function(response) {
      return {
        success: true,
        status: response.data.status,
      };
    })
    .catch(function(error) {
      return {
        success: false,
        error: error.message,
      };
    });
};

RfidClient.prototype.getTenants = function(retryCount) {
  var self = this;
  retryCount = retryCount || 0;

  return this.client.get('/settings/tenants')
    .then(function(response) {
      return response.data;
    })
    .catch(function(error) {
      var status = error.response && error.response.status;
      if (status === 429 && retryCount < 5) {
        console.log('  Tenant listesi icin rate limit, 10 saniye bekleniyor...');
        return delay(10000).then(function() {
          return self.getTenants(retryCount + 1);
        });
      }
      console.error('Tenant listesi alinamadi:', error.message);
      throw error;
    });
};

RfidClient.prototype.findTenantByQrCode = function(qrCode) {
  return this.getTenants()
    .then(function(tenants) {
      for (var i = 0; i < tenants.length; i++) {
        if (tenants[i].qrCode === qrCode) {
          return tenants[i];
        }
      }
      return null;
    });
    // Hata olursa yukari firlatilsin, null donmesin
};

// İsmi normalize et - Türkçe karakterleri İngilizce'ye çevir, sadece harf ve rakam
function normalizeName(name) {
  if (!name) return '';
  // Türkçe -> İngilizce dönüşüm
  var tr = {'İ':'I', 'I':'I', 'Ğ':'G', 'Ü':'U', 'Ş':'S', 'Ö':'O', 'Ç':'C',
            'ı':'I', 'i':'I', 'ğ':'G', 'ü':'U', 'ş':'S', 'ö':'O', 'ç':'C'};
  var result = name.toUpperCase();
  for (var k in tr) {
    result = result.split(k).join(tr[k]);
  }
  // Sadece A-Z ve 0-9 kalsın
  return result.replace(/[^A-Z0-9]/g, '');
}

RfidClient.prototype.findTenantByName = function(name) {
  var searchNorm = normalizeName(name);

  return this.getTenants()
    .then(function(tenants) {
      // 1. Tam eşleşme (normalize edilmiş)
      for (var i = 0; i < tenants.length; i++) {
        var tenantNorm = normalizeName(tenants[i].name);
        if (tenantNorm === searchNorm) {
          console.log('      Tam eslesme: "' + tenants[i].name + '" = "' + name + '"');
          return tenants[i];
        }
      }

      // 2. Kısmi eşleşme (biri diğerini içeriyorsa)
      for (var i = 0; i < tenants.length; i++) {
        var tenantNorm = normalizeName(tenants[i].name);
        if (tenantNorm.length > 3 && searchNorm.length > 3) {
          if (tenantNorm.indexOf(searchNorm) !== -1 || searchNorm.indexOf(tenantNorm) !== -1) {
            console.log('      Kismi eslesme: "' + tenants[i].name + '" ~ "' + name + '"');
            return tenants[i];
          }
        }
      }

      console.log('      Eslesme bulunamadi: "' + name + '"');
      return null;
    });
};

RfidClient.prototype.syncTenant = function(tenant) {
  var self = this;

  // Önce qrCode ile ara, bulamazsa isim ile ara
  return this.findTenantByQrCode(tenant.kod)
    .then(function(existing) {
      if (existing) {
        return existing;
      }
      // qrCode ile bulunamadı, isim ile ara
      return self.findTenantByName(tenant.unvan);
    })
    .then(function(existing) {
      if (existing) {
        // Mevcut tenant'ı güncelle - qrCode'u ETA cari koduyla değiştir
        console.log('    Tenant bulundu (id: ' + existing.id + '), qrCode guncelleniyor: ' + tenant.kod);
        return self.client.patch('/settings/tenants/' + existing.id, {
          name: tenant.unvan,
          qrCode: tenant.kod,  // ETA cari kodunu qrCode olarak kaydet
          address: tenant.adres,
          phone: tenant.telefon,
          email: tenant.email,
        })
        .then(function() {
          return { action: 'updated', id: existing.id };
        });
      } else {
        // Yeni tenant oluştur
        return self.client.post('/settings/tenants', {
          name: tenant.unvan,
          qrCode: tenant.kod,
          address: tenant.adres,
          phone: tenant.telefon,
          email: tenant.email,
        })
        .then(function(response) {
          return { action: 'created', id: response.data.id };
        });
      }
    })
    .catch(function(error) {
      var errMsg = (error.response && error.response.data && error.response.data.error) || error.message;
      console.error('Tenant sync hatasi (' + tenant.unvan + '):', errMsg);
      throw error;
    });
};

RfidClient.prototype.getItemTypes = function(retryCount) {
  var self = this;
  retryCount = retryCount || 0;

  return this.client.get('/item-types')
    .then(function(response) {
      return response.data;
    })
    .catch(function(error) {
      var status = error.response && error.response.status;
      if (status === 429 && retryCount < 5) {
        console.log('  Item type listesi icin rate limit, 10 saniye bekleniyor...');
        return delay(10000).then(function() {
          return self.getItemTypes(retryCount + 1);
        });
      }
      console.error('Item type listesi alinamadi:', error.message);
      throw error;
    });
};

RfidClient.prototype.findItemTypeByEtaCode = function(etaCode) {
  return this.getItemTypes()
    .then(function(itemTypes) {
      for (var i = 0; i < itemTypes.length; i++) {
        if (itemTypes[i].description === 'ETA:' + etaCode) {
          return itemTypes[i];
        }
      }
      return null;
    });
    // Hata olursa yukari firlatilsin
};

RfidClient.prototype.syncItemType = function(itemType) {
  var self = this;
  return this.findItemTypeByEtaCode(itemType.kod)
    .then(function(existing) {
      if (existing) {
        return self.client.patch('/item-types/' + existing.id, {
          name: itemType.ad,
        })
        .then(function() {
          return { action: 'updated', id: existing.id };
        });
      } else {
        return self.client.post('/item-types', {
          name: itemType.ad,
          description: 'ETA:' + itemType.kod,
        })
        .then(function(response) {
          return { action: 'created', id: response.data.id };
        });
      }
    })
    .catch(function(error) {
      var errMsg = (error.response && error.response.data && error.response.data.error) || error.message;
      console.error('ItemType sync hatasi (' + itemType.ad + '):', errMsg);
      throw error;
    });
};

/**
 * ETA'ya gonderilecek deliveryleri al
 * label_printed, in_transit, delivered durumlarindaki etaSynced=false olanlari getirir
 */
RfidClient.prototype.getDeliveredDeliveries = function(retryCount) {
  var self = this;
  retryCount = retryCount || 0;

  // Birden fazla status icin ayri istekler yap
  // label_printed ve sonraki tum durumlar - etiketi basilan tum teslimatlar
  var statuses = ['label_printed', 'packaged', 'picked_up', 'delivered'];
  var allDeliveries = [];

  function fetchStatus(index) {
    if (index >= statuses.length) {
      // Tum statusler bitti, etaSynced=false olanlari filtrele
      var result = [];
      for (var i = 0; i < allDeliveries.length; i++) {
        if (!allDeliveries[i].etaSynced) {
          result.push(allDeliveries[i]);
        }
      }
      return Promise.resolve(result);
    }

    console.log('  Checking status: ' + statuses[index]);
    return self.client.get('/deliveries', {
      params: {
        status: statuses[index],
        limit: 100
      }
    })
    .then(function(response) {
      var data = response.data;
      var deliveries = [];

      if (Array.isArray(data)) {
        deliveries = data;
      } else if (data && Array.isArray(data.deliveries)) {
        deliveries = data.deliveries;
      } else if (data && Array.isArray(data.data)) {
        deliveries = data.data;
      }

      console.log('    Found ' + deliveries.length + ' deliveries');

      // Listeye ekle
      for (var i = 0; i < deliveries.length; i++) {
        allDeliveries.push(deliveries[i]);
      }

      // Sonraki status
      return delay(1000).then(function() {
        return fetchStatus(index + 1);
      });
    })
    .catch(function(err) {
      console.log('    Error for status ' + statuses[index] + ': ' + (err.response ? err.response.status : err.message));
      // Hata olsa bile sonraki statuse devam et
      return delay(1000).then(function() {
        return fetchStatus(index + 1);
      });
    });
  }

  return fetchStatus(0)
  .catch(function(error) {
    var status = error.response && error.response.status;
    if (status === 429 && retryCount < 5) {
      console.log('  Delivery listesi icin rate limit, 10 saniye bekleniyor...');
      return delay(10000).then(function() {
        return self.getDeliveredDeliveries(retryCount + 1);
      });
    }
    console.error('Delivery listesi alinamadi:', error.message);
    throw error;
  });
};

/**
 * Delivery detaylarini al (itemlari ile birlikte)
 */
RfidClient.prototype.getDeliveryDetails = function(deliveryId, retryCount) {
  var self = this;
  retryCount = retryCount || 0;

  return this.client.get('/deliveries/' + deliveryId)
    .then(function(response) {
      return response.data;
    })
    .catch(function(error) {
      var status = error.response && error.response.status;
      if (status === 429 && retryCount < 5) {
        console.log('  Delivery detay icin rate limit, 10 saniye bekleniyor...');
        return delay(10000).then(function() {
          return self.getDeliveryDetails(deliveryId, retryCount + 1);
        });
      }
      throw error;
    });
};

/**
 * Delivery'yi ETA'ya senkronlandi olarak isaretle
 */
RfidClient.prototype.markDeliveryAsEtaSynced = function(deliveryId, etaRefNo) {
  var self = this;

  return this.client.patch('/deliveries/' + deliveryId, {
    etaSynced: true,
    etaRefNo: etaRefNo ? etaRefNo.toString() : null
  })
  .then(function() {
    return { success: true };
  })
  .catch(function(error) {
    console.error('Delivery ETA sync isareti hatasi:', error.message);
    return { success: false, error: error.message };
  });
};

/**
 * Irsaliyesi basilmis (waybill) ama ETA'ya gonderilmemis delivery'leri al
 * Waybill tablosundan bakar - printed status'ta ve etaSynced=false olanlar
 */
RfidClient.prototype.getPrintedWaybills = function(retryCount) {
  var self = this;
  retryCount = retryCount || 0;

  console.log('  Waybill\'lar kontrol ediliyor...');
  return this.client.get('/waybills', {
    params: {
      status: 'printed',
      limit: 100
    }
  })
  .then(function(response) {
    var data = response.data;
    var waybills = [];

    if (Array.isArray(data)) {
      waybills = data;
    } else if (data && Array.isArray(data.data)) {
      waybills = data.data;
    }

    console.log('    Toplam ' + waybills.length + ' waybill bulundu');

    // Her waybill icin detay al (delivery bilgileri icin)
    var detailPromises = waybills.map(function(w) {
      return self.client.get('/waybills/' + w.id)
        .then(function(r) { return r.data; })
        .catch(function() { return null; });
    });

    return Promise.all(detailPromises);
  })
  .then(function(waybillDetails) {
    // null olanlari filtrele ve etaSynced=false olan delivery'leri topla
    var result = [];

    for (var i = 0; i < waybillDetails.length; i++) {
      var w = waybillDetails[i];
      if (!w || !w.waybillDeliveries) continue;

      for (var j = 0; j < w.waybillDeliveries.length; j++) {
        var wd = w.waybillDeliveries[j];
        var delivery = wd.delivery;

        if (delivery && !delivery.etaSynced) {
          // Waybill bilgisini delivery'ye ekle
          delivery.waybillNumber = w.waybillNumber;
          delivery.waybillId = w.id;
          result.push(delivery);
        }
      }
    }

    console.log('    ETA\'ya gonderilecek ' + result.length + ' delivery bulundu');
    return result;
  })
  .catch(function(error) {
    var status = error.response && error.response.status;
    if (status === 429 && retryCount < 5) {
      console.log('  Waybill listesi icin rate limit, 10 saniye bekleniyor...');
      return delay(10000).then(function() {
        return self.getPrintedWaybills(retryCount + 1);
      });
    }
    console.error('Waybill listesi alinamadi:', error.message);
    throw error;
  });
};

module.exports = RfidClient;
