var axios = require('axios');
var config = require('./config.json');

var api = axios.create({
  baseURL: config.rfid.apiUrl,
  timeout: 30000
});

api.post('/auth/login', {
  email: config.rfid.username,
  password: config.rfid.password
}).then(function(loginRes) {
  api.defaults.headers['Authorization'] = 'Bearer ' + loginRes.data.token;
  console.log('Login OK\n');

  return api.get('/waybills', { params: { limit: 10 } });
}).then(function(res) {
  var waybills = res.data.data || res.data;
  
  // Bugünkü waybill'ları filtrele
  var today = new Date();
  today.setHours(0,0,0,0);
  
  var todayWaybills = waybills.filter(function(w) {
    return new Date(w.createdAt) >= today;
  });
  
  console.log('=== BUGÜNKÜ 4 WAYBILL VE DELIVERY DURUMLARI ===\n');
  
  // Her waybill için detay al
  var promises = todayWaybills.map(function(w) {
    return api.get('/waybills/' + w.id).then(function(r) {
      return r.data;
    });
  });
  
  return Promise.all(promises);
}).then(function(waybillDetails) {
  waybillDetails.forEach(function(w, i) {
    console.log((i+1) + '. WAYBILL: ' + w.waybillNumber);
    console.log('   Oluşturulma: ' + new Date(w.createdAt).toLocaleString('tr-TR'));
    console.log('   Otel: ' + (w.tenant ? w.tenant.name : 'N/A'));
    
    if (w.waybillDeliveries && w.waybillDeliveries.length > 0) {
      w.waybillDeliveries.forEach(function(wd) {
        var d = wd.delivery;
        console.log('   → Delivery: ' + d.barcode);
        console.log('     Status: ' + d.status);
        console.log('     etaSynced: ' + d.etaSynced);
        console.log('     etaRefNo: ' + d.etaRefNo);
        console.log('     pickedUpAt: ' + d.pickedUpAt);
        console.log('     deliveredAt: ' + d.deliveredAt);
      });
    } else {
      console.log('   → Delivery bağlantısı YOK!');
    }
    console.log('');
  });

  // Şimdi etaSynced=false olan delivery'leri kontrol et
  console.log('\n=== ETA SYNC BEKLEYENLERİ (etaSynced=false) ===');
  return api.get('/deliveries', { params: { limit: 200 } });
}).then(function(res) {
  var deliveries = res.data.data || res.data;
  var notSynced = deliveries.filter(function(d) {
    return !d.etaSynced && ['label_printed', 'packaged', 'picked_up', 'delivered'].indexOf(d.status) !== -1;
  });
  
  console.log('Toplam etaSynced=false (uygun status): ' + notSynced.length);
  notSynced.forEach(function(d) {
    console.log('  ' + d.barcode + ' | ' + d.status + ' | ' + (d.tenant ? d.tenant.name : 'N/A'));
  });

}).catch(function(err) {
  console.error('Hata:', err.response ? JSON.stringify(err.response.data) : err.message);
});
