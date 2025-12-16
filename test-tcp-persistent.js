const net = require('net');

const HOST = '192.168.1.155';
const PORT = 20058;

let readerId = 0x01;
let connectionAttempts = 0;
let client = null;

// Build CM command frame
function buildCommand(cmd, data = []) {
  const len = data.length;
  const frame = [
    0x43, 0x4D,     // Header "CM"
    cmd,            // Command
    readerId,       // Reader ID
    len,            // Data length
    ...data         // Data
  ];
  return Buffer.from(frame);
}

function connect() {
  connectionAttempts++;
  console.log(`\n[${new Date().toISOString()}] Connection attempt #${connectionAttempts}...`);

  client = new net.Socket();
  client.setKeepAlive(true, 1000);
  client.setTimeout(30000);

  client.connect(PORT, HOST, () => {
    console.log(`[${new Date().toISOString()}] Connected!`);

    // Don't send any commands initially - just wait
    console.log('Waiting for data from reader...');

    // After 5 seconds, try start inventory
    setTimeout(() => {
      if (client && !client.destroyed) {
        console.log('\nSending START_INVENTORY...');
        client.write(buildCommand(0x2A));
      }
    }, 5000);
  });

  client.on('data', (data) => {
    const timestamp = new Date().toISOString();
    console.log(`\n[${timestamp}] RECEIVED ${data.length} bytes:`);
    console.log('Hex:', data.toString('hex'));

    // Parse
    let offset = 0;
    while (offset < data.length) {
      if (data[offset] !== 0x43 || (offset + 1 >= data.length) || data[offset + 1] !== 0x4D) {
        offset++;
        continue;
      }
      if (data.length - offset < 5) break;

      const cmd = data[offset + 2];
      const rId = data[offset + 3];
      const dataLen = data[offset + 4];

      if (data.length - offset < 5 + dataLen) break;

      const frameData = data.slice(offset + 5, offset + 5 + dataLen);
      if (rId) readerId = rId;

      if (cmd === 0x10) {
        console.log('  [HEARTBEAT]');
      } else if (cmd === 0x67) {
        console.log('  [DEVICE_INFO]');
      } else if (cmd === 0x2A && dataLen > 0) {
        console.log('  [TAG DATA]', Buffer.from(frameData).toString('hex').toUpperCase());
      } else {
        console.log(`  [CMD 0x${cmd.toString(16)}] DataLen=${dataLen}`);
        if (dataLen > 0) {
          console.log('    Data:', Buffer.from(frameData).toString('hex'));
        }
      }

      offset += 5 + dataLen;
    }
  });

  client.on('error', (err) => {
    console.error(`[${new Date().toISOString()}] Error:`, err.message);
  });

  client.on('close', () => {
    console.log(`[${new Date().toISOString()}] Connection closed`);
    // Reconnect after 2 seconds
    setTimeout(connect, 2000);
  });

  client.on('timeout', () => {
    console.log(`[${new Date().toISOString()}] Timeout - destroying socket`);
    client.destroy();
  });
}

console.log('=== Persistent Connection Test ===');
console.log(`Target: ${HOST}:${PORT}`);
console.log('Press Ctrl+C to stop\n');

connect();

// Handle Ctrl+C
process.on('SIGINT', () => {
  console.log('\n\nStopping...');
  if (client) client.destroy();
  process.exit(0);
});
