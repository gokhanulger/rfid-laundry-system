/**
 * UHF RFID Reader Network Scanner
 * Scans common IP addresses and ports for UHF readers
 */

const net = require('net');

// Common default IPs for UHF readers
const COMMON_IPS = [
  '192.168.0.178',
  '192.168.1.178',
  '192.168.0.200',
  '192.168.1.200',
  '192.168.0.100',
  '192.168.1.100',
  '192.168.0.1',
  '192.168.1.1',
  '192.168.0.10',
  '192.168.1.10',
];

// Common ports for UHF readers
const COMMON_PORTS = [4001, 5000, 4000, 6000, 8080, 80, 23];

async function checkPort(ip, port, timeout = 2000) {
  return new Promise((resolve) => {
    const socket = new net.Socket();

    socket.setTimeout(timeout);

    socket.on('connect', () => {
      socket.destroy();
      resolve({ ip, port, open: true });
    });

    socket.on('timeout', () => {
      socket.destroy();
      resolve({ ip, port, open: false });
    });

    socket.on('error', () => {
      socket.destroy();
      resolve({ ip, port, open: false });
    });

    socket.connect(port, ip);
  });
}

async function scanNetwork() {
  console.log('='.repeat(60));
  console.log('UHF RFID Reader Network Scanner');
  console.log('='.repeat(60));
  console.log('');
  console.log('Scanning common UHF reader IP addresses...');
  console.log('This may take a minute...');
  console.log('');

  const found = [];

  for (const ip of COMMON_IPS) {
    process.stdout.write(`Checking ${ip}... `);

    for (const port of COMMON_PORTS) {
      const result = await checkPort(ip, port);
      if (result.open) {
        console.log(`FOUND! Port ${port} open`);
        found.push(result);
        break;
      }
    }

    if (!found.find(f => f.ip === ip)) {
      console.log('no response');
    }
  }

  console.log('');
  console.log('='.repeat(60));

  if (found.length > 0) {
    console.log('Found devices:');
    for (const f of found) {
      console.log(`  ${f.ip}:${f.port}`);
    }
    console.log('');
    console.log('Run: node test-uhf-tcp.js <IP> <PORT>');
  } else {
    console.log('No devices found at common addresses.');
    console.log('');
    console.log('Try:');
    console.log('1. Check if reader is connected to the same network');
    console.log('2. Check if reader has power (LED on)');
    console.log('3. The reader might have a different IP - check router DHCP list');
  }

  console.log('='.repeat(60));
}

// Also scan local subnet
async function scanLocalSubnet() {
  // Get local IP
  const os = require('os');
  const interfaces = os.networkInterfaces();
  let localIP = null;

  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        localIP = iface.address;
        break;
      }
    }
    if (localIP) break;
  }

  if (!localIP) {
    console.log('Could not determine local IP');
    return;
  }

  console.log('Local IP:', localIP);
  const subnet = localIP.split('.').slice(0, 3).join('.');
  console.log('Scanning subnet:', subnet + '.x');
  console.log('');

  // Scan subnet for port 4001 (most common UHF reader port)
  const scanPromises = [];
  for (let i = 1; i <= 254; i++) {
    const ip = `${subnet}.${i}`;
    scanPromises.push(checkPort(ip, 4001, 500));
  }

  const results = await Promise.all(scanPromises);
  const openPorts = results.filter(r => r.open);

  if (openPorts.length > 0) {
    console.log('\nDevices with port 4001 open:');
    for (const r of openPorts) {
      console.log(`  ${r.ip}:${r.port}`);
    }
  } else {
    console.log('\nNo devices found with port 4001 open on local subnet.');
  }
}

async function main() {
  await scanNetwork();
  console.log('\n');
  await scanLocalSubnet();
}

main().catch(console.error);
