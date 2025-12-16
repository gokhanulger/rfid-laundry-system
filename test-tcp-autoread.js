const net = require('net');

const HOST = '192.168.1.155';
const PORT = 20058;

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

console.log(`Connecting to ${HOST}:${PORT}...`);
console.log('Put an RFID tag near the reader antenna!\n');

const client = new net.Socket();
let dataBuffer = Buffer.alloc(0);
let tagCount = 0;

client.connect(PORT, HOST, () => {
  console.log('Connected!\n');

  // Try multiple inventory commands
  setTimeout(() => {
    console.log('=== Trying START_INVENTORY (0x2A) ===');
    client.write(buildCommand(0x2A));
  }, 1000);

  setTimeout(() => {
    console.log('=== Trying START_AUTO_READ (0x2E) ===');
    client.write(buildCommand(0x2E));
  }, 2000);

  // Try alternate inventory commands
  setTimeout(() => {
    console.log('=== Trying CMD 0x22 (Real-time Inventory) ===');
    // Some readers use 0x22 with antenna parameter
    client.write(buildCommand(0x22, [0x00, 0x04])); // All antennas
  }, 3000);

  setTimeout(() => {
    console.log('=== Trying CMD 0x27 (Read Data) ===');
    client.write(buildCommand(0x27));
  }, 4000);

  // Keep connection alive
  const keepAlive = setInterval(() => {
    // Send inventory command periodically
    client.write(buildCommand(0x2A));
  }, 2000);

  // Stop after 30 seconds
  setTimeout(() => {
    clearInterval(keepAlive);
    console.log('\n=== Stopping ===');
    client.write(buildCommand(0x2B)); // Stop inventory
    client.write(buildCommand(0x2F)); // Stop auto read

    setTimeout(() => {
      console.log(`\nTotal tags found: ${tagCount}`);
      client.destroy();
    }, 1000);
  }, 30000);
});

client.on('data', (data) => {
  dataBuffer = Buffer.concat([dataBuffer, data]);

  // Simple parsing - just show all data
  console.log('\n--- RAW DATA ---');
  console.log('Hex:', data.toString('hex'));

  // Try to parse CM frames
  let offset = 0;
  while (offset < dataBuffer.length) {
    if (dataBuffer[offset] !== 0x43 || (offset + 1 >= dataBuffer.length) || dataBuffer[offset + 1] !== 0x4D) {
      offset++;
      continue;
    }

    if (dataBuffer.length - offset < 5) break;

    const cmd = dataBuffer[offset + 2];
    const rId = dataBuffer[offset + 3];
    const dataLen = dataBuffer[offset + 4];

    if (dataBuffer.length - offset < 5 + dataLen) break;

    const frameData = dataBuffer.slice(offset + 5, offset + 5 + dataLen);

    // Update reader ID
    if (rId) readerId = rId;

    const cmdName = {
      0x10: 'HEARTBEAT',
      0x2A: 'INVENTORY_RESPONSE',
      0x2B: 'STOP_INVENTORY',
      0x2E: 'AUTO_READ_START',
      0x2F: 'AUTO_READ_STOP',
      0x31: 'VERSION',
      0x67: 'DEVICE_INFO',
      0x22: 'REAL_TIME_INVENTORY',
      0x27: 'READ_DATA'
    }[cmd] || `CMD_${cmd.toString(16).toUpperCase()}`;

    console.log(`[${cmdName}] Reader:${rId} DataLen:${dataLen}`);

    if (dataLen > 0) {
      console.log(`[${cmdName}] Data: ${Buffer.from(frameData).toString('hex')}`);

      // If this looks like tag data (inventory response with data)
      if ((cmd === 0x2A || cmd === 0x22) && dataLen > 4) {
        tagCount++;
        const antenna = frameData[0];
        const epcStartIndex = frameData[1] === 0x30 ? 3 : 1; // Skip PC bytes if present
        const epcData = frameData.slice(epcStartIndex);
        console.log(`*** TAG #${tagCount} ***`);
        console.log(`    Antenna: ${antenna}`);
        console.log(`    EPC: ${Buffer.from(epcData).toString('hex').toUpperCase()}`);
      }
    }

    offset += 5 + dataLen;
  }

  dataBuffer = dataBuffer.slice(offset);
});

client.on('error', (err) => {
  console.error('Error:', err.message);
});

client.on('close', () => {
  console.log('Connection closed');
  process.exit(0);
});

// Handle Ctrl+C
process.on('SIGINT', () => {
  console.log('\nInterrupted - closing...');
  client.destroy();
});
