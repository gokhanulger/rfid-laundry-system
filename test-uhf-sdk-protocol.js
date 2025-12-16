const { SerialPort } = require('serialport');

const port = new SerialPort({
  path: '/dev/cu.usbserial-110',
  baudRate: 115200,
  dataBits: 8,
  stopBits: 1,
  parity: 'none'
});

// SDK Protocol from cmd_code.h
// Frame format: Header(1) + Type(1) + Len(2) + Cmd(1) + Data(n) + Checksum(1)
// Header: 0xBB
// Type: 0x00 (command)
// Len: length of cmd + data
// Checksum: XOR of all bytes from Type to last Data byte

function buildCommand(cmd, data = []) {
  const len = 1 + data.length;
  const frame = [
    0xBB,           // Header
    0x00,           // Type: command
    (len >> 8) & 0xFF,  // Len high
    len & 0xFF,         // Len low
    cmd,            // Command
    ...data         // Data
  ];

  // Calculate checksum: XOR from Type to end of data
  let checksum = 0;
  for (let i = 1; i < frame.length; i++) {
    checksum ^= frame[i];
  }
  frame.push(checksum);

  return Buffer.from(frame);
}

// Commands from SDK
const CMD_GET_VERSION = 0x31;      // Get firmware version
const CMD_START_INVENTORY = 0x2A;  // Start inventory
const CMD_STOP_INVENTORY = 0x2B;   // Stop inventory
const CMD_GET_POWER = 0x30;        // Get RF power
const CMD_GET_FREQ_REGION = 0x33;  // Get frequency region

port.on('open', () => {
  console.log('Serial port opened');

  // Try get version command
  const getVersionCmd = buildCommand(CMD_GET_VERSION);
  console.log('Sending GET_VERSION:', getVersionCmd.toString('hex').toUpperCase());
  port.write(getVersionCmd);

  // Try different commands with delay
  setTimeout(() => {
    const getPowerCmd = buildCommand(CMD_GET_POWER);
    console.log('Sending GET_POWER:', getPowerCmd.toString('hex').toUpperCase());
    port.write(getPowerCmd);
  }, 500);

  setTimeout(() => {
    const getFreqCmd = buildCommand(CMD_GET_FREQ_REGION);
    console.log('Sending GET_FREQ_REGION:', getFreqCmd.toString('hex').toUpperCase());
    port.write(getFreqCmd);
  }, 1000);

  // Also try alternate frame format (0xA0 header)
  setTimeout(() => {
    // Try A0 format: A0 + Len + Cmd + Data + Checksum
    const a0Frame = Buffer.from([0xA0, 0x03, 0x01, 0x00, 0x04]); // Query version
    console.log('Sending A0 format:', a0Frame.toString('hex').toUpperCase());
    port.write(a0Frame);
  }, 1500);

  // Close after 3 seconds
  setTimeout(() => {
    console.log('\nClosing port...');
    port.close();
  }, 3000);
});

port.on('data', (data) => {
  console.log('RECEIVED:', data.toString('hex').toUpperCase());
  console.log('Raw bytes:', [...data].map(b => '0x' + b.toString(16).padStart(2, '0')).join(' '));
});

port.on('error', (err) => {
  console.error('Error:', err.message);
});
