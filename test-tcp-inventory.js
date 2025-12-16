const net = require('net');

const HOST = '192.168.1.155';
const PORT = 20058;

// CM Protocol Commands
const UHF_CMD = {
  HEARTBEAT: 0x10,
  START_INVENTORY: 0x2A,
  STOP_INVENTORY: 0x2B,
  GET_VERSION: 0x31,
  START_AUTO_READ: 0x2E,
  STOP_AUTO_READ: 0x2F,
  DEVICE_INFO_REPORT: 0x67
};

let readerId = 0x01;

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

// Parse CM response frame
function parseResponse(buffer) {
  const results = [];
  let offset = 0;

  while (offset < buffer.length) {
    // Look for CM header
    if (buffer[offset] !== 0x43 || (offset + 1 < buffer.length && buffer[offset + 1] !== 0x4D)) {
      offset++;
      continue;
    }

    if (buffer.length - offset < 5) break;

    const cmd = buffer[offset + 2];
    const rId = buffer[offset + 3];
    const dataLen = buffer[offset + 4];
    const frameLen = 5 + dataLen;

    if (buffer.length - offset < frameLen) break;

    const data = buffer.slice(offset + 5, offset + 5 + dataLen);
    results.push({ cmd, readerId: rId, data: [...data], raw: buffer.slice(offset, offset + frameLen) });
    offset += frameLen;
  }

  return { results, remaining: buffer.slice(offset) };
}

console.log(`Connecting to ${HOST}:${PORT}...`);

const client = new net.Socket();
let dataBuffer = Buffer.alloc(0);
let tagCount = 0;

client.connect(PORT, HOST, () => {
  console.log('Connected!\n');

  // Wait for device info, then start inventory
  setTimeout(() => {
    console.log('=== Starting Inventory ===');
    const startCmd = buildCommand(UHF_CMD.START_INVENTORY);
    console.log('Sending START_INVENTORY:', startCmd.toString('hex'));
    client.write(startCmd);
  }, 1000);

  // Stop inventory after 15 seconds
  setTimeout(() => {
    console.log('\n=== Stopping Inventory ===');
    const stopCmd = buildCommand(UHF_CMD.STOP_INVENTORY);
    console.log('Sending STOP_INVENTORY:', stopCmd.toString('hex'));
    client.write(stopCmd);
  }, 15000);

  // Close after 17 seconds
  setTimeout(() => {
    console.log('\n=== Closing ===');
    console.log(`Total tags found: ${tagCount}`);
    client.destroy();
  }, 17000);
});

client.on('data', (data) => {
  dataBuffer = Buffer.concat([dataBuffer, data]);

  const { results, remaining } = parseResponse(dataBuffer);
  dataBuffer = remaining;

  for (const result of results) {
    // Update reader ID
    if (result.readerId) readerId = result.readerId;

    switch (result.cmd) {
      case UHF_CMD.HEARTBEAT:
        console.log('[HEARTBEAT]');
        break;

      case UHF_CMD.DEVICE_INFO_REPORT:
        console.log('[DEVICE INFO] Data length:', result.data.length);
        // Parse model name from data
        if (result.data.length > 8) {
          const modelLen = result.data[8];
          const model = Buffer.from(result.data.slice(9, 9 + modelLen)).toString('ascii');
          console.log('[DEVICE INFO] Model:', model);
        }
        break;

      case UHF_CMD.START_INVENTORY:
        // Inventory response contains tag data
        if (result.data.length > 0) {
          tagCount++;
          console.log(`\n[TAG #${tagCount}] Raw data:`, Buffer.from(result.data).toString('hex'));

          // Try to parse EPC
          // Format: Antenna(1) + PC(2) + EPC(varies) + RSSI(1)
          if (result.data.length >= 4) {
            const antenna = result.data[0];
            const pc = (result.data[1] << 8) | result.data[2];
            const epcLen = Math.min(12, result.data.length - 4);
            const epc = result.data.slice(3, 3 + epcLen);
            const rssi = result.data.length > 3 + epcLen ? result.data[3 + epcLen] : 0;

            console.log(`[TAG #${tagCount}] Antenna: ${antenna}`);
            console.log(`[TAG #${tagCount}] PC: 0x${pc.toString(16)}`);
            console.log(`[TAG #${tagCount}] EPC: ${Buffer.from(epc).toString('hex').toUpperCase()}`);
            console.log(`[TAG #${tagCount}] RSSI: ${rssi > 127 ? rssi - 256 : rssi} dBm`);
          }
        }
        break;

      case UHF_CMD.STOP_INVENTORY:
        console.log('[INVENTORY STOPPED]');
        break;

      default:
        console.log(`[CMD 0x${result.cmd.toString(16)}] Data:`, Buffer.from(result.data).toString('hex'));
    }
  }
});

client.on('error', (err) => {
  console.error('Error:', err.message);
});

client.on('close', () => {
  console.log('Connection closed');
  process.exit(0);
});
