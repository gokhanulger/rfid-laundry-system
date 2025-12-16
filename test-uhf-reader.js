/**
 * UHF RFID Reader Test Script
 * Tests both common protocols to identify which one the reader uses
 */

const { SerialPort } = require('serialport');

// Configuration - change this to your serial port
const SERIAL_PORT = '/dev/cu.usbserial-BG01BIB4';
const BAUD_RATE = 115200;

// Protocol 1: BB/7E Frame (R2000 based readers)
const PROTOCOL_BB = {
  name: 'BB/7E Protocol (R2000)',
  singleInventory: Buffer.from([0xBB, 0x00, 0x22, 0x00, 0x00, 0x22, 0x7E]),
  multiInventory: Buffer.from([0xBB, 0x00, 0x27, 0x00, 0x03, 0x22, 0xFF, 0xFF, 0x4A, 0x7E]),
  stopInventory: Buffer.from([0xBB, 0x00, 0x28, 0x00, 0x00, 0x28, 0x7E]),
  getVersion: Buffer.from([0xBB, 0x00, 0x03, 0x00, 0x01, 0x00, 0x04, 0x7E]),
};

// Protocol 2: A0/E4 Frame (DFRobot style)
const PROTOCOL_A0 = {
  name: 'A0/E4 Protocol',
  singleInventory: Buffer.from([0xA0, 0x06, 0x80, 0x00, 0x01, 0x02, 0x01, 0xD6]),
  stopInventory: Buffer.from([0xA0, 0x03, 0xA8, 0x00, 0xB5]),
  getVersion: Buffer.from([0xA0, 0x03, 0x00, 0x00, 0x53]),
};

// Try different baud rates
const BAUD_RATES = [115200, 57600, 38400, 9600];

let port = null;
let currentBaudRate = BAUD_RATE;
let responseBuffer = Buffer.alloc(0);

function formatHex(buffer) {
  return Array.from(buffer).map(b => b.toString(16).padStart(2, '0').toUpperCase()).join(' ');
}

function parseResponse(data) {
  responseBuffer = Buffer.concat([responseBuffer, data]);

  console.log('\n--- Data Received ---');
  console.log('Raw hex:', formatHex(data));
  console.log('Buffer total:', formatHex(responseBuffer));

  // Check for BB/7E protocol response
  if (responseBuffer[0] === 0xBB) {
    const endIdx = responseBuffer.indexOf(0x7E);
    if (endIdx > 0) {
      const frame = responseBuffer.slice(0, endIdx + 1);
      console.log('\n[BB/7E Protocol Frame Detected]');
      console.log('Frame:', formatHex(frame));

      const type = frame[1];
      const cmd = frame[2];
      console.log('Type:', type === 0x00 ? 'Command' : type === 0x01 ? 'Response' : type === 0x02 ? 'Notice (Tag)' : `Unknown (${type})`);
      console.log('Command:', '0x' + cmd.toString(16).toUpperCase());

      if (type === 0x02 && cmd === 0x22) {
        // Tag read response
        const pl = (frame[3] << 8) | frame[4];
        console.log('Payload Length:', pl);
        if (pl > 0) {
          const rssi = frame[5];
          const pc = (frame[6] << 8) | frame[7];
          const epcLength = pl - 5; // RSSI(1) + PC(2) + CRC(2)
          const epc = frame.slice(8, 8 + epcLength - 2);
          console.log('RSSI:', rssi - 256, 'dBm');
          console.log('PC:', '0x' + pc.toString(16).toUpperCase());
          console.log('EPC:', formatHex(epc));
        }
      }

      responseBuffer = responseBuffer.slice(endIdx + 1);
    }
  }

  // Check for A0/E4 protocol response
  if (responseBuffer[0] === 0xE4 || responseBuffer[0] === 0xE0) {
    const len = responseBuffer[1];
    if (responseBuffer.length >= len + 2) {
      const frame = responseBuffer.slice(0, len + 2);
      console.log('\n[A0/E4 Protocol Frame Detected]');
      console.log('Frame:', formatHex(frame));

      if (responseBuffer[0] === 0xE4) {
        console.log('Type: Response');
        const status = frame[4];
        console.log('Status:', status === 0x00 ? 'Success' : `Error (0x${status.toString(16)})`);
      } else if (responseBuffer[0] === 0xE0) {
        console.log('Type: Tag Data');
        // Parse tag data
      }

      responseBuffer = responseBuffer.slice(len + 2);
    }
  }
}

async function testProtocol(protocol, commands) {
  console.log(`\n${'='.repeat(50)}`);
  console.log(`Testing: ${protocol.name}`);
  console.log('='.repeat(50));

  for (const [cmdName, cmdData] of Object.entries(commands)) {
    if (cmdName === 'name') continue;

    console.log(`\nSending ${cmdName}:`, formatHex(cmdData));

    return new Promise((resolve) => {
      responseBuffer = Buffer.alloc(0);
      port.write(cmdData, (err) => {
        if (err) {
          console.log('Write error:', err.message);
          resolve(false);
          return;
        }

        // Wait for response
        setTimeout(() => {
          if (responseBuffer.length > 0) {
            console.log('Got response!');
            resolve(true);
          } else {
            console.log('No response');
            resolve(false);
          }
        }, 2000);
      });
    });
  }
}

async function tryBaudRate(baudRate) {
  console.log(`\n${'#'.repeat(60)}`);
  console.log(`Trying baud rate: ${baudRate}`);
  console.log('#'.repeat(60));

  return new Promise((resolve) => {
    if (port && port.isOpen) {
      port.close();
    }

    port = new SerialPort({
      path: SERIAL_PORT,
      baudRate: baudRate,
      dataBits: 8,
      parity: 'none',
      stopBits: 1,
    });

    port.on('error', (err) => {
      console.log('Port error:', err.message);
      resolve(false);
    });

    port.on('data', parseResponse);

    port.on('open', async () => {
      console.log('Port opened successfully');

      // Test BB/7E protocol first (getVersion command)
      let gotResponse = await testProtocol(PROTOCOL_BB, { getVersion: PROTOCOL_BB.getVersion });

      if (!gotResponse) {
        // Try A0/E4 protocol
        gotResponse = await testProtocol(PROTOCOL_A0, { getVersion: PROTOCOL_A0.getVersion });
      }

      if (gotResponse) {
        console.log('\n*** SUCCESS! Found working configuration ***');
        console.log('Baud rate:', baudRate);
        currentBaudRate = baudRate;
        resolve(true);
      } else {
        resolve(false);
      }
    });
  });
}

async function runInventoryTest() {
  console.log('\n\n' + '='.repeat(60));
  console.log('RUNNING INVENTORY TEST - Place a tag near the antenna!');
  console.log('='.repeat(60));

  // Try single inventory with BB protocol
  console.log('\nTrying BB protocol single inventory...');
  port.write(PROTOCOL_BB.singleInventory);

  await new Promise(r => setTimeout(r, 3000));

  // Try continuous inventory
  console.log('\nTrying BB protocol multi inventory...');
  port.write(PROTOCOL_BB.multiInventory);

  await new Promise(r => setTimeout(r, 5000));

  // Stop inventory
  console.log('\nStopping inventory...');
  port.write(PROTOCOL_BB.stopInventory);

  await new Promise(r => setTimeout(r, 1000));

  // Now try A0 protocol
  console.log('\nTrying A0 protocol inventory...');
  port.write(PROTOCOL_A0.singleInventory);

  await new Promise(r => setTimeout(r, 3000));
}

async function main() {
  console.log('UHF RFID Reader Test');
  console.log('Serial Port:', SERIAL_PORT);
  console.log('');

  // First, list available ports
  const ports = await SerialPort.list();
  console.log('Available ports:');
  ports.forEach(p => {
    console.log(`  ${p.path} - ${p.manufacturer || 'Unknown'} (${p.vendorId || '?'}:${p.productId || '?'})`);
  });

  // Try each baud rate
  let success = false;
  for (const baudRate of BAUD_RATES) {
    success = await tryBaudRate(baudRate);
    if (success) break;
  }

  if (success) {
    await runInventoryTest();
  } else {
    console.log('\nNo response from any baud rate. Check:');
    console.log('1. Is the reader powered on?');
    console.log('2. Is the serial cable connected properly?');
    console.log('3. Try the other serial port if available');
  }

  // Close port
  if (port && port.isOpen) {
    port.close();
  }

  console.log('\nTest complete.');
}

main().catch(console.error);
