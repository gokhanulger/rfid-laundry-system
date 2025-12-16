/**
 * UHF RFID Reader Boot Monitor
 * Listens for any data during reader boot/restart
 * Some readers send their IP config during boot
 */

const { SerialPort } = require('serialport');

const SERIAL_PORT = '/dev/cu.usbserial-BG01BIB4';
const LISTEN_TIME = 30000; // 30 seconds

function formatHex(buffer) {
  return Array.from(buffer).map(b => b.toString(16).padStart(2, '0').toUpperCase()).join(' ');
}

console.log('='.repeat(60));
console.log('UHF RFID Reader Boot Monitor');
console.log('='.repeat(60));
console.log('');
console.log('>>> SIMDI OKUYUCUNUN GUCUNU KAPATIN <<<');
console.log('>>> 5 SANIYE BEKLEYIN <<<');
console.log('>>> SONRA TEKRAR ACIN <<<');
console.log('');
console.log('30 saniye dinlenecek...');
console.log('-'.repeat(60));

const baudRates = [115200, 57600, 38400, 19200, 9600];
let currentBaudIndex = 0;
let port = null;
let totalData = Buffer.alloc(0);
let dataReceived = false;

function openPort(baudRate) {
  return new Promise((resolve) => {
    if (port && port.isOpen) {
      port.close(() => {
        createPort(baudRate, resolve);
      });
    } else {
      createPort(baudRate, resolve);
    }
  });
}

function createPort(baudRate, resolve) {
  console.log(`[${new Date().toLocaleTimeString()}] Listening at ${baudRate} baud...`);

  port = new SerialPort({
    path: SERIAL_PORT,
    baudRate: baudRate,
    dataBits: 8,
    parity: 'none',
    stopBits: 1,
  });

  port.on('error', (err) => {
    console.log('Error:', err.message);
  });

  port.on('data', (data) => {
    dataReceived = true;
    totalData = Buffer.concat([totalData, data]);
    console.log('\n' + '*'.repeat(50));
    console.log('!!! DATA RECEIVED at', baudRate, 'baud !!!');
    console.log('*'.repeat(50));
    console.log('Hex:', formatHex(data));
    console.log('ASCII:', data.toString('utf8').replace(/[^\x20-\x7E\n\r]/g, '.'));
    console.log('*'.repeat(50) + '\n');
  });

  port.on('open', resolve);
}

async function main() {
  const startTime = Date.now();

  // Start with first baud rate
  await openPort(baudRates[0]);

  // Cycle through baud rates every 6 seconds
  const interval = setInterval(async () => {
    if (Date.now() - startTime > LISTEN_TIME) {
      clearInterval(interval);
      return;
    }
    currentBaudIndex = (currentBaudIndex + 1) % baudRates.length;
    await openPort(baudRates[currentBaudIndex]);
  }, 6000);

  // Stop after LISTEN_TIME
  setTimeout(() => {
    clearInterval(interval);
    console.log('\n' + '='.repeat(60));
    console.log('Dinleme tamamlandi.');

    if (totalData.length > 0) {
      console.log('\nToplam alinan veri:');
      console.log('Hex:', formatHex(totalData));
      console.log('ASCII:', totalData.toString('utf8').replace(/[^\x20-\x7E\n\r]/g, '.'));
    } else {
      console.log('\nHicbir veri alinmadi.');
      console.log('');
      console.log('Olasi sorunlar:');
      console.log('1. TX/RX kablolari ters olabilir - degistirin');
      console.log('2. Okuyucu sadece TCP/IP destekliyor olabilir');
      console.log('3. DIP switch ile RS232 aktif edilmeli');
    }
    console.log('='.repeat(60));

    if (port && port.isOpen) {
      port.close();
    }
    process.exit(0);
  }, LISTEN_TIME);
}

main().catch(console.error);
