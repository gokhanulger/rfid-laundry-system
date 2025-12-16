const net = require('net');

const HOST = '192.168.1.155';
const PORT = 20058;

console.log(`Connecting to ${HOST}:${PORT}...`);

const client = new net.Socket();
client.setTimeout(10000);

client.connect(PORT, HOST, () => {
  console.log('Connected!');
  console.log('Waiting for data...\n');

  // Try sending some common UHF commands

  // CM Protocol - Get Version
  const cmVersion = Buffer.from([0x43, 0x4D, 0x31, 0x01, 0x00]);
  console.log('Sending CM Version cmd:', cmVersion.toString('hex'));
  client.write(cmVersion);

  // Try after 500ms - SDK Protocol (0xBB header)
  setTimeout(() => {
    // BB 00 00 01 31 checksum
    const bbVersion = Buffer.from([0xBB, 0x00, 0x00, 0x01, 0x31, 0x30]);
    console.log('Sending BB Version cmd:', bbVersion.toString('hex'));
    client.write(bbVersion);
  }, 500);

  // Try after 1s - Alien protocol
  setTimeout(() => {
    const alienQuery = Buffer.from([0x04, 0x00, 0x01, 0x00]);
    console.log('Sending Alien query:', alienQuery.toString('hex'));
    client.write(alienQuery);
  }, 1000);

  // Try after 1.5s - Simple queries
  setTimeout(() => {
    // Some readers respond to simple text commands
    client.write('get version\r\n');
    console.log('Sent text: get version');
  }, 1500);
});

client.on('data', (data) => {
  console.log('\n========== RECEIVED DATA ==========');
  console.log('Hex:', data.toString('hex'));
  console.log('Bytes:', [...data].map(b => '0x' + b.toString(16).padStart(2, '0')).join(' '));
  console.log('Length:', data.length);
  console.log('ASCII:', data.toString('ascii').replace(/[^\x20-\x7E]/g, '.'));
  console.log('=====================================\n');
});

client.on('error', (err) => {
  console.error('Error:', err.message);
});

client.on('timeout', () => {
  console.log('Connection timeout');
  client.destroy();
});

client.on('close', () => {
  console.log('Connection closed');
});

// Auto close after 10 seconds
setTimeout(() => {
  console.log('\nClosing connection after 10s...');
  client.destroy();
}, 10000);
