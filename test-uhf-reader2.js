/**
 * UHF RFID Reader Test Script v2
 * Passive listening + more protocol variants
 */

const { SerialPort } = require('serialport');

const SERIAL_PORT = '/dev/cu.usbserial-BG01BIB4';

function formatHex(buffer) {
  return Array.from(buffer).map(b => b.toString(16).padStart(2, '0').toUpperCase()).join(' ');
}

// More protocol variants to try
const PROTOCOLS = {
  // BB/7E R2000 style
  BB_GET_VERSION: Buffer.from([0xBB, 0x00, 0x03, 0x00, 0x01, 0x00, 0x04, 0x7E]),
  BB_SINGLE_INV: Buffer.from([0xBB, 0x00, 0x22, 0x00, 0x00, 0x22, 0x7E]),
  BB_MULTI_INV: Buffer.from([0xBB, 0x00, 0x27, 0x00, 0x03, 0x22, 0xFF, 0xFF, 0x4A, 0x7E]),
  BB_STOP_INV: Buffer.from([0xBB, 0x00, 0x28, 0x00, 0x00, 0x28, 0x7E]),

  // A0/E4 DFRobot style
  A0_GET_VERSION: Buffer.from([0xA0, 0x03, 0x00, 0x00, 0x53]),
  A0_SINGLE_INV: Buffer.from([0xA0, 0x06, 0x80, 0x00, 0x01, 0x02, 0x01, 0xD6]),
  A0_STOP_INV: Buffer.from([0xA0, 0x03, 0xA8, 0x00, 0xB5]),

  // CHAFON CF-RU5100 style (different checksum)
  CHAFON_GET_INFO: Buffer.from([0x04, 0x00, 0x21]),

  // Some readers use 0x10 start byte
  ALT_GET_VERSION: Buffer.from([0x10, 0x03, 0x01, 0x00, 0x00]),

  // Simple query commands
  SIMPLE_QUERY: Buffer.from([0x01]),
  SIMPLE_INV: Buffer.from([0x43, 0x03, 0x01]),

  // UHF Reader 18 style
  UHF18_GET_VER: Buffer.from([0xCF, 0xFF, 0x00, 0x03, 0x00, 0x01, 0x00, 0x03]),

  // EPCglobal / LLRP style header
  LLRP_KEEPALIVE: Buffer.from([0x04, 0x3E, 0x00, 0x00, 0x00, 0x0A, 0x00, 0x00, 0x00, 0x01]),
};

async function testPort(baudRate) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Testing with baud rate: ${baudRate}`);
  console.log('='.repeat(60));

  return new Promise((resolve) => {
    const port = new SerialPort({
      path: SERIAL_PORT,
      baudRate: baudRate,
      dataBits: 8,
      parity: 'none',
      stopBits: 1,
    });

    let receivedData = false;
    let allData = Buffer.alloc(0);

    port.on('error', (err) => {
      console.log('Error:', err.message);
      resolve({ success: false, baudRate });
    });

    port.on('data', (data) => {
      receivedData = true;
      allData = Buffer.concat([allData, data]);
      console.log('\n>>> RECEIVED:', formatHex(data));
      console.log('>>> ASCII:', data.toString('utf8').replace(/[^\x20-\x7E]/g, '.'));
    });

    port.on('open', async () => {
      console.log('Port opened at', baudRate, 'baud');

      // First listen for 3 seconds without sending anything
      console.log('\n[Passive listening for 3 seconds...]');
      await new Promise(r => setTimeout(r, 3000));

      if (receivedData) {
        console.log('\n*** Reader is sending data automatically! ***');
      }

      // Try each protocol
      for (const [name, cmd] of Object.entries(PROTOCOLS)) {
        console.log(`\n[Sending ${name}]:`, formatHex(cmd));
        port.write(cmd);
        await new Promise(r => setTimeout(r, 1000));

        if (allData.length > 0) {
          console.log('Total received so far:', formatHex(allData));
        }
      }

      // Final wait
      await new Promise(r => setTimeout(r, 2000));

      port.close();

      resolve({
        success: receivedData || allData.length > 0,
        baudRate,
        data: allData,
      });
    });
  });
}

async function main() {
  console.log('UHF RFID Reader Extended Test');
  console.log('Port:', SERIAL_PORT);
  console.log('\nMake sure:');
  console.log('1. Reader is powered ON');
  console.log('2. RS232 cable is properly connected');
  console.log('3. TX/RX might need to be swapped if no response\n');

  const baudRates = [115200, 57600, 38400, 19200, 9600];

  for (const baud of baudRates) {
    const result = await testPort(baud);
    if (result.success) {
      console.log('\n' + '*'.repeat(60));
      console.log('SUCCESS! Got data at', result.baudRate, 'baud');
      console.log('Data:', formatHex(result.data));
      console.log('*'.repeat(60));
      return;
    }
  }

  console.log('\n' + '-'.repeat(60));
  console.log('No response at any baud rate.');
  console.log('');
  console.log('Possible issues:');
  console.log('1. TX/RX cables might be swapped - try reversing them');
  console.log('2. Reader might need DIP switch configuration');
  console.log('3. Reader might only support TCP/IP (Ethernet)');
  console.log('4. Check if RS232 port is enabled on the reader');
  console.log('-'.repeat(60));
}

main().catch(console.error);
