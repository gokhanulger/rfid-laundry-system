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

RfidClient.prototype.syncTenant = function(tenant) {
  var self = this;
  return this.findTenantByQrCode(tenant.kod)
    .then(function(existing) {
      if (existing) {
        return self.client.patch('/settings/tenants/' + existing.id, {
          name: tenant.unvan,
          address: tenant.adres,
          phone: tenant.telefon,
          email: tenant.email,
        })
        .then(function() {
          return { action: 'updated', id: existing.id };
        });
      } else {
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

module.exports = RfidClient;
