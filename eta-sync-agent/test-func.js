var RfidClient = require('./src/rfid-client');
var config = require('./config.json');

var client = new RfidClient(config.rfid);

console.log('getPrintedWaybills mevcut mu:', typeof client.getPrintedWaybills);
console.log('Tum fonksiyonlar:');
for (var key in RfidClient.prototype) {
  console.log('  - ' + key);
}
