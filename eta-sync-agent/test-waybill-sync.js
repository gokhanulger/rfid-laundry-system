var axios = require('axios');
var config = require('./config.json');

var api = axios.create({
  baseURL: config.rfid.apiUrl,
  timeout: 30000
});

console.log('=== WAYBILL BAZLI SYNC TESTİ ===\n');

api.post('/auth/login', {
  email: config.rfid.username,
  password: config.rfid.password
}).then(function(loginRes) {
  api.defaults.headers['Authorization'] = 'Bearer ' + loginRes.data.token;
  console.log('Login OK\n');

  // Printed status'taki waybill'ları al
  console.log('Printed waybill\'lar kontrol ediliyor...');
  return api.get('/waybills', { params: { status: 'printed', limit: 100 } });
}).then(function(res) {
  var waybills = res.data.data || res.data;
  console.log('Toplam ' + waybills.length + ' printed waybill bulundu\n');

  // Her birinin detayını al
  var promises = waybills.slice(0, 10).map(function(w) {
    return api.get('/waybills/' + w.id)
      .then(function(r) { return r.data; })
      .catch(function() { return null; });
  });

  return Promise.all(promises);
}).then(function(details) {
  var needSync = [];
  var alreadySynced = [];

  details.forEach(function(w) {
    if (!w || !w.waybillDeliveries) return;

    w.waybillDeliveries.forEach(function(wd) {
      var d = wd.delivery;
      if (!d) return;

      if (d.etaSynced) {
        alreadySynced.push({
          waybillNumber: w.waybillNumber,
          barcode: d.barcode,
          etaRefNo: d.etaRefNo
        });
      } else {
        needSync.push({
          waybillNumber: w.waybillNumber,
          barcode: d.barcode,
          tenant: d.tenant ? d.tenant.name : 'N/A'
        });
      }
    });
  });

  console.log('=== ETA SYNC BEKLEYENLERİ ===');
  console.log('Toplam: ' + needSync.length);
  needSync.forEach(function(n) {
    console.log('  ' + n.waybillNumber + ' | Delivery: ' + n.barcode + ' | ' + n.tenant);
  });

  console.log('\n=== ZATEN SYNC EDİLMİŞLER ===');
  console.log('Toplam: ' + alreadySynced.length);
  alreadySynced.slice(0, 5).forEach(function(s) {
    console.log('  ' + s.waybillNumber + ' | Delivery: ' + s.barcode + ' | ETA RefNo: ' + s.etaRefNo);
  });
  if (alreadySynced.length > 5) {
    console.log('  ... ve ' + (alreadySynced.length - 5) + ' tane daha');
  }

}).catch(function(err) {
  console.error('Hata:', err.response ? JSON.stringify(err.response.data) : err.message);
});
