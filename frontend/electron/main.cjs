const { app, BrowserWindow, ipcMain, globalShortcut, shell } = require('electron');
const path = require('path');
const net = require('net');
const os = require('os');
const fs = require('fs');
const { exec } = require('child_process');

// PDF to Printer for silent printing
let pdfToPrinter = null;
try {
  pdfToPrinter = require('pdf-to-printer');
} catch (e) {
  console.log('[Print] pdf-to-printer not available, will use fallback');
}

// Database and Sync Service
const db = require('./database.cjs');
const syncService = require('./sync-service.cjs');

// Development or production mode
const isDev = !app.isPackaged;

// ==========================================
// UHF RFID Reader Configuration
// ==========================================
const UHF_READER_CONFIG = {
  ip: '192.168.1.155',
  port: 20058,
  reconnectInterval: 5000,  // Reconnect every 5 seconds if disconnected
  inventoryInterval: 100    // How often to process inventory data
};

// BOHANG UHF Reader Commands (CM Protocol)
const UHF_CMD = {
  HEARTBEAT: 0x10,
  START_INVENTORY: 0x2A,
  STOP_INVENTORY: 0x2B,
  GET_VERSION: 0x31,
  START_AUTO_READ: 0x2E,
  STOP_AUTO_READ: 0x2F,
  DEVICE_INFO_REPORT: 0x67,
  SET_RF_POWER: 0x76,      // Set RF power for all antennas (0-30 dBm)
  GET_RF_POWER: 0x77,      // Get current RF power
  SET_ANTENNA_POWER: 0xB6  // Alternative power command
};

// UHF Reader State
let uhfSocket = null;
let uhfConnected = false;
let uhfReconnectTimer = null;
let uhfDataBuffer = Buffer.alloc(0);
let uhfInventoryActive = false;
let scannedTags = new Map(); // EPC -> { count, lastSeen, rssi, antenna }
let uhfReaderId = 0x01; // Default reader ID
let lastDataReceived = 0; // Timestamp of last data received
let uhfStatusSent = false; // Track if we've sent connected status
let inventoryPollTimer = null; // Timer for polling inventory
let userWantsConnection = false; // User initiated connection - auto-reconnect if true
let heartbeatTimer = null; // Timer for sending heartbeats
let healthCheckTimer = null; // Timer for checking connection health
const CONNECTION_TIMEOUT = 30000; // 30 seconds without data = connection lost
let currentRfPower = 20; // Default RF power (0-30 dBm). Lower = shorter range

// Common RFID reader ports to scan
const COMMON_RFID_PORTS = [20058, 4001, 6000, 8080, 5000, 4196, 10001, 502, 7000, 8000, 9000, 3000, 4000, 6001, 20059, 8899, 9999, 2000, 1024, 23, 80];

// Get local network IP ranges
function getLocalNetworkRanges() {
  const ranges = [];
  const interfaces = os.networkInterfaces();

  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      // Skip internal and non-IPv4 addresses
      if (iface.internal || iface.family !== 'IPv4') continue;

      // Get network prefix (e.g., 192.168.1)
      const parts = iface.address.split('.');
      const prefix = parts.slice(0, 3).join('.');
      if (!ranges.includes(prefix)) {
        ranges.push(prefix);
      }
    }
  }

  return ranges;
}

// Try to connect to a specific IP:port with timeout (simple port check)
function tryConnect(ip, port, timeout = 1000) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let resolved = false;

    const timer = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        socket.destroy();
        resolve(false);
      }
    }, timeout);

    socket.connect(port, ip, () => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timer);
        socket.destroy();
        resolve(true);
      }
    });

    socket.on('error', () => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timer);
        socket.destroy();
        resolve(false);
      }
    });
  });
}

// Try to connect and verify it's a BOHANG RFID reader using CM protocol
function tryConnectAndVerify(ip, port, timeout = 2000) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let resolved = false;
    let dataBuffer = Buffer.alloc(0);

    const cleanup = () => {
      if (!resolved) {
        resolved = true;
        socket.destroy();
      }
    };

    const timer = setTimeout(() => {
      cleanup();
      resolve({ success: false, reason: 'timeout' });
    }, timeout);

    socket.connect(port, ip, () => {
      // Send HEARTBEAT command to verify it's a BOHANG reader
      const heartbeatCmd = Buffer.from([0x43, 0x4D, 0x10, 0x00, 0x00, 0x00, 0x00]); // CM + HEARTBEAT
      socket.write(heartbeatCmd);
    });

    socket.on('data', (data) => {
      dataBuffer = Buffer.concat([dataBuffer, data]);

      // Check for CM protocol header (0x43 0x4D = "CM")
      if (dataBuffer.length >= 2) {
        // Look for CM header anywhere in response
        for (let i = 0; i < dataBuffer.length - 1; i++) {
          if (dataBuffer[i] === 0x43 && dataBuffer[i + 1] === 0x4D) {
            clearTimeout(timer);
            cleanup();
            resolve({ success: true, ip, port });
            return;
          }
        }
      }

      // Also check for device info report or any valid response pattern
      if (dataBuffer.length >= 5) {
        // Give it a short time to receive full response
        setTimeout(() => {
          if (!resolved) {
            // Check one more time
            for (let i = 0; i < dataBuffer.length - 1; i++) {
              if (dataBuffer[i] === 0x43 && dataBuffer[i + 1] === 0x4D) {
                clearTimeout(timer);
                cleanup();
                resolve({ success: true, ip, port });
                return;
              }
            }
            clearTimeout(timer);
            cleanup();
            resolve({ success: false, reason: 'invalid_protocol' });
          }
        }, 200);
      }
    });

    socket.on('error', (err) => {
      clearTimeout(timer);
      cleanup();
      resolve({ success: false, reason: err.message });
    });

    socket.on('close', () => {
      if (!resolved) {
        clearTimeout(timer);
        resolved = true;
        resolve({ success: false, reason: 'connection_closed' });
      }
    });
  });
}

// Scan network for RFID reader with protocol verification
async function scanForReader(progressCallback) {
  const ranges = getLocalNetworkRanges();

  if (progressCallback) progressCallback({ status: 'scanning', ranges });

  // Priority ports for BOHANG readers
  const priorityPorts = [20058, 4001, 6000];

  // First, try known/saved IP with priority ports (with protocol verification)
  const savedIp = UHF_READER_CONFIG.ip;
  if (progressCallback) progressCallback({ status: 'trying', ip: savedIp, message: `Kayıtlı IP deneniyor: ${savedIp}` });

  for (const port of priorityPorts) {
    const result = await tryConnectAndVerify(savedIp, port, 1500);
    if (result.success) {
      return { ip: savedIp, port, verified: true };
    }
  }

  // Scan each network range with protocol verification
  for (const prefix of ranges) {
    if (progressCallback) progressCallback({ status: 'scanning_range', prefix, message: `Ağ taranıyor: ${prefix}.x` });

    // First do a quick port scan to find candidates
    const candidates = [];

    // Scan IPs in parallel (batches of 30)
    for (let batch = 0; batch < 256; batch += 30) {
      const promises = [];

      for (let i = batch; i < Math.min(batch + 30, 256); i++) {
        const ip = `${prefix}.${i}`;

        // Quick port check on priority ports
        for (const port of priorityPorts) {
          promises.push(
            tryConnect(ip, port, 200).then(success => {
              if (success) return { ip, port };
              return null;
            })
          );
        }
      }

      const results = await Promise.all(promises);
      for (const r of results) {
        if (r !== null) {
          candidates.push(r);
        }
      }
    }

    if (progressCallback) progressCallback({
      status: 'verifying',
      message: `${candidates.length} aday bulundu, doğrulanıyor...`,
      candidates: candidates.length
    });

    // Now verify each candidate with protocol check
    for (const candidate of candidates) {
      if (progressCallback) progressCallback({
        status: 'verifying_device',
        ip: candidate.ip,
        port: candidate.port,
        message: `Doğrulanıyor: ${candidate.ip}:${candidate.port}`
      });

      const result = await tryConnectAndVerify(candidate.ip, candidate.port, 1500);
      if (result.success) {
        return { ip: candidate.ip, port: candidate.port, verified: true };
      }
    }
  }

  // Deep scan - try all common ports on all IPs (slower, still with verification)
  if (progressCallback) progressCallback({ status: 'deep_scan', message: 'Detaylı tarama yapılıyor...' });

  for (const prefix of ranges) {
    for (let i = 1; i < 255; i++) {
      const ip = `${prefix}.${i}`;

      // Quick port check first
      for (const port of COMMON_RFID_PORTS) {
        const portOpen = await tryConnect(ip, port, 100);
        if (portOpen) {
          // Verify with protocol
          const result = await tryConnectAndVerify(ip, port, 1500);
          if (result.success) {
            return { ip, port, verified: true };
          }
        }
      }
    }
  }

  return null;
}

// Build BOHANG UHF command frame (CM Protocol)
// Format: 0x43 0x4D (CM) + cmd + reader_id + len + data + padding
function buildUhfCommand(cmd, data = []) {
  const len = data.length;
  const frame = [
    0x43, 0x4D,     // Header "CM"
    cmd,            // Command
    0x00,           // Reader ID (must be 0x00 like demo software)
    len,            // Data length
    ...data,        // Data
    0x00, 0x00      // Padding bytes (demo software sends these)
  ];
  return Buffer.from(frame);
}

// Parse BOHANG UHF response frame (CM Protocol)
function parseUhfResponse(buffer) {
  const results = [];
  let offset = 0;

  while (offset < buffer.length) {
    // Look for header 0x43 0x4D ("CM")
    if (buffer[offset] !== 0x43 || (offset + 1 < buffer.length && buffer[offset + 1] !== 0x4D)) {
      offset++;
      continue;
    }

    // Need at least 5 bytes for minimal frame (CM + cmd + reader_id + len)
    if (buffer.length - offset < 5) break;

    const cmd = buffer[offset + 2];
    const readerId = buffer[offset + 3];
    const dataLen = buffer[offset + 4];

    // Check if we have the complete frame
    const frameLen = 5 + dataLen;
    if (buffer.length - offset < frameLen) break;

    const data = buffer.slice(offset + 5, offset + 5 + dataLen);

    results.push({ cmd, readerId, data: [...data] });

    // Move to next frame - but also check for another CM header right after
    offset += frameLen;

    // Skip any padding bytes (0x00) between frames
    while (offset < buffer.length && buffer[offset] === 0x00 &&
           (offset + 1 >= buffer.length || buffer[offset + 1] !== 0x4D)) {
      offset++;
    }
  }

  // Return remaining buffer
  return { results, remaining: buffer.slice(offset) };
}

// Extract EPC from inventory response
function extractEpcFromInventory(data) {
  // BOHANG CM protocol inventory response format:
  // [Antenna(1)] [PC(2)] [EPC(12)] [RSSI(1)] [extra...]
  // or [PC(2)] [EPC(12)] [RSSI(1)] [extra...]

  if (data.length < 12) return null; // Need at least EPC(12)

  try {
    // Convert to hex string for pattern matching
    const rawHex = Buffer.from(data).toString('hex').toUpperCase();
    console.log('[UHF] Raw inventory data:', rawHex, `(${data.length} bytes)`);

    let epcHex = '';
    let rssi = 0;
    let antenna = 0;

    // Method 1: Find known EPC prefixes and extract 24 chars (12 bytes)
    // Support multiple prefixes: 903425 (our tags), E200 (common), 3000 (common), etc.
    const knownPrefixes = ['903425', '9034', 'E200', 'E280', '3000', '3400', 'AD00'];
    let foundByPrefix = false;

    for (const prefix of knownPrefixes) {
      const prefixIndex = rawHex.indexOf(prefix);
      if (prefixIndex !== -1 && rawHex.length >= prefixIndex + 24) {
        epcHex = rawHex.substring(prefixIndex, prefixIndex + 24);
        console.log('[UHF] Found EPC by prefix', prefix, 'at position', prefixIndex, ':', epcHex);

        // Try to extract RSSI from remaining data
        const epcEndByteIndex = (prefixIndex + 24) / 2; // Convert hex position to byte position
        if (data.length > epcEndByteIndex) {
          rssi = data[epcEndByteIndex];
          if (rssi > 127) rssi = rssi - 256;
        }
        foundByPrefix = true;
        break;
      }
    }

    // Method 2: Fallback to offset-based extraction if no known prefix found
    if (!epcHex) {
      let epcStartOffset = 0;

      // Check for antenna + PC format (most common)
      if (data.length >= 16) {
        const pc = (data[1] << 8) | data[2];
        // PC word: bits 15-11 indicate EPC length (0x3000 = 96-bit EPC)
        // Accept various PC values that indicate valid EPC
        if ((pc & 0xF800) >= 0x1000 && (pc & 0xF800) <= 0x7800) {
          epcStartOffset = 3;
          antenna = data[0];
          rssi = data.length > 15 ? data[15] : data[data.length - 1];
          console.log('[UHF] Format: Antenna+PC+EPC, offset=3, PC=0x' + pc.toString(16));
        }
      }

      // Check for PC-only format
      if (epcStartOffset === 0 && data.length >= 14) {
        const pc = (data[0] << 8) | data[1];
        if ((pc & 0xF800) >= 0x1000 && (pc & 0xF800) <= 0x7800) {
          epcStartOffset = 2;
          rssi = data[data.length - 1];
          console.log('[UHF] Format: PC+EPC, offset=2, PC=0x' + pc.toString(16));
        }
      }

      // Raw EPC fallback - just take first 12 bytes
      if (epcStartOffset === 0) {
        epcStartOffset = 0;
        rssi = data.length > 12 ? data[12] : 0;
        console.log('[UHF] Format: Raw EPC, offset=0');
      }

      if (data.length - epcStartOffset >= 12) {
        const epc = data.slice(epcStartOffset, epcStartOffset + 12);
        epcHex = Buffer.from(epc).toString('hex').toUpperCase();
        console.log('[UHF] Extracted EPC by offset:', epcHex, 'from offset', epcStartOffset);
      }
    }

    // Method 3: If still no valid EPC, try to extract any 24-char hex sequence that looks like an EPC
    if (!epcHex && rawHex.length >= 24) {
      // Skip first 2-6 bytes (header/antenna/PC) and take next 12 bytes as EPC
      for (let startPos = 2; startPos <= 6 && startPos + 24 <= rawHex.length; startPos += 2) {
        const candidate = rawHex.substring(startPos, startPos + 24);
        // Check if it looks like a valid EPC (not all zeros or all FFs)
        if (candidate !== '000000000000000000000000' &&
            candidate !== 'FFFFFFFFFFFFFFFFFFFFFFFF' &&
            !/^0+$/.test(candidate)) {
          epcHex = candidate;
          console.log('[UHF] Extracted EPC by scanning:', epcHex, 'from position', startPos);
          rssi = data.length > (startPos / 2) + 12 ? data[(startPos / 2) + 12] : 0;
          if (rssi > 127) rssi = rssi - 256;
          break;
        }
      }
    }

    if (!epcHex) {
      console.log('[UHF] Could not extract EPC from data');
      return null;
    }

    return {
      antenna,
      pc: 0x3000,
      epc: epcHex,
      rssi: rssi > 127 ? rssi - 256 : rssi
    };
  } catch (e) {
    console.error('[UHF] Error extracting EPC:', e);
    return null;
  }
}

// Handle UHF data from reader
function handleUhfData(data) {
  lastDataReceived = Date.now();

  const foundInPacket = new Set(); // Dedupe EPCs in this packet

  // ============ CM EXTRACTION (Wireshark method) ============
  // This parses the CM protocol frames and extracts EPCs
  uhfDataBuffer = Buffer.concat([uhfDataBuffer, data]);

  // Limit buffer size
  if (uhfDataBuffer.length > 8192) {
    uhfDataBuffer = uhfDataBuffer.slice(-4096);
  }

  const { results, remaining } = parseUhfResponse(uhfDataBuffer);
  uhfDataBuffer = remaining;

  for (const result of results) {
    if (result.readerId) {
      uhfReaderId = result.readerId;
    }

    // Handle heartbeat (0x10)
    if (result.cmd === UHF_CMD.HEARTBEAT) {
      try {
        if (uhfSocket && !uhfSocket.destroyed) {
          uhfSocket.write(buildUhfCommand(UHF_CMD.HEARTBEAT));
        }
      } catch (e) {
        // Silently handle error
      }
    }

    // CM extraction - search for EPC in CM protocol data
    // SINGLE MATCH: Try prefixes in order, stop at first match
    if (result.data && result.data.length >= 12) {
      const dataHex = Buffer.from(result.data).toString('hex').toUpperCase();

      // Try prefixes in priority order - 9034 first
      const cmPrefixes = ['9034', 'E200', 'E280', '3000', '3400', 'AD00'];
      let epc = null;
      let rssi = -50;

      for (const cmPrefix of cmPrefixes) {
        const cmPattern = new RegExp(cmPrefix + '[0-9A-F]{' + (24 - cmPrefix.length) + '}');
        const cmMatch = cmPattern.exec(dataHex);

        if (cmMatch && cmMatch[0].length === 24) {
          epc = cmMatch[0];
          break; // STOP at first match - tek eşleştirme
        }
      }

      // Send EPC if found and not duplicate
      if (epc && !foundInPacket.has(epc)) {
        foundInPacket.add(epc);
        console.log('[UHF] SENDING EPC (CM):', epc);

        scannedTags.set(epc, {
          epc,
          count: (scannedTags.get(epc)?.count || 0) + 1,
          lastSeen: Date.now(),
          rssi,
          antenna: 0
        });

        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('uhf-tag', { epc, rssi, antenna: 0 });
        }
      }
    }
  }
}

// Connect to UHF Reader as TCP Client
function connectUhfReader() {
  if (uhfSocket) {
    uhfSocket.destroy();
    uhfSocket = null;
  }

  uhfSocket = new net.Socket();
  uhfSocket.setKeepAlive(true, 5000);
  uhfSocket.setNoDelay(true);
  uhfSocket.setTimeout(10000);

  uhfSocket.on('timeout', () => {
    if (uhfConnected) {
      uhfSocket.setTimeout(0);
    }
  });

  uhfSocket.connect(UHF_READER_CONFIG.port, UHF_READER_CONFIG.ip, () => {
    uhfConnected = true;
    uhfDataBuffer = Buffer.alloc(0);
    lastDataReceived = Date.now();
    userWantsConnection = true;

    uhfSocket.setTimeout(0);
    uhfInventoryActive = true;

    console.log('[UHF] Connected to', UHF_READER_CONFIG.ip + ':' + UHF_READER_CONFIG.port);

    // Notify renderer - connected
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('uhf-status', { connected: true, ip: UHF_READER_CONFIG.ip, port: UHF_READER_CONFIG.port, inventoryActive: true });
    }

    // BOHANG initialization sequence - like demo app
    // Step 1: Send heartbeat response to establish communication
    setTimeout(() => {
      if (uhfSocket && !uhfSocket.destroyed && uhfConnected) {
        console.log('[UHF] Step 1: Sending HEARTBEAT');
        uhfSocket.write(buildUhfCommand(UHF_CMD.HEARTBEAT));
      }
    }, 100);

    // Step 2: Get device version/info
    setTimeout(() => {
      if (uhfSocket && !uhfSocket.destroyed && uhfConnected) {
        console.log('[UHF] Step 2: Sending GET_VERSION');
        uhfSocket.write(buildUhfCommand(UHF_CMD.GET_VERSION));
      }
    }, 300);

    // Step 3: Try START_AUTO_READ first (continuous mode like demo's "Inventory Once")
    setTimeout(() => {
      if (uhfSocket && !uhfSocket.destroyed && uhfConnected) {
        console.log('[UHF] Step 3: Sending START_AUTO_READ (0x2E)');
        uhfSocket.write(buildUhfCommand(UHF_CMD.START_AUTO_READ));
      }
    }, 500);

    // Step 4: Try START_INVENTORY with antenna mask parameter
    setTimeout(() => {
      if (uhfSocket && !uhfSocket.destroyed && uhfConnected) {
        // Try with antenna 1 enabled (0x01)
        console.log('[UHF] Step 4: Sending START_INVENTORY with antenna=0x01');
        uhfSocket.write(buildUhfCommand(UHF_CMD.START_INVENTORY, [0x01]));
      }
    }, 700);

    // Step 5: Try bare START_INVENTORY (like demo)
    setTimeout(() => {
      if (uhfSocket && !uhfSocket.destroyed && uhfConnected) {
        console.log('[UHF] Step 5: Sending START_INVENTORY (bare)');
        uhfSocket.write(buildUhfCommand(UHF_CMD.START_INVENTORY));
      }
    }, 900);

    // Step 6: Try command 0x22 (alternative inventory on some BOHANG readers)
    setTimeout(() => {
      if (uhfSocket && !uhfSocket.destroyed && uhfConnected) {
        console.log('[UHF] Step 6: Sending alt inventory 0x22');
        uhfSocket.write(Buffer.from([0x43, 0x4D, 0x22, 0x00, 0x00, 0x00, 0x00]));
      }
    }, 1100);

    // Step 7: Start polling
    setTimeout(() => {
      if (uhfSocket && !uhfSocket.destroyed && uhfConnected) {
        console.log('[UHF] Step 7: Starting inventory polling');
        startInventoryPolling();
      }
    }, 1300);
  });

  uhfSocket.on('data', handleUhfData);

  uhfSocket.on('error', () => {
    // Error will trigger 'close' event, which will handle reconnect
  });

  uhfSocket.on('close', () => {
    uhfConnected = false;
    uhfStatusSent = false;
    stopInventoryPolling();
    stopHeartbeat();
    stopHealthCheck();

    // Always auto-reconnect silently
    if (userWantsConnection) {
      scheduleReconnect();
    } else {
      // Only notify UI if user doesn't want connection
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('uhf-status', { connected: false });
      }
    }
  });
}

function scheduleReconnect() {
  if (uhfReconnectTimer) {
    clearTimeout(uhfReconnectTimer);
    uhfReconnectTimer = null;
  }

  // Reconnect after 500ms - keep trying until user disconnects
  uhfReconnectTimer = setTimeout(() => {
    uhfReconnectTimer = null;
    if (!uhfConnected && userWantsConnection) {
      connectUhfReader();
    }
  }, 500);
}

// Start polling inventory command - like demo app's "Inventory" button
function startInventoryPolling() {
  if (inventoryPollTimer) return;

  let pollCount = 0;

  // Send inventory command every 2000ms (2 seconds) - prevents system slowdown
  inventoryPollTimer = setInterval(() => {
    if (uhfSocket && !uhfSocket.destroyed && uhfConnected && uhfInventoryActive) {
      try {
        pollCount++;

        // Alternate between START_INVENTORY (0x2A) and START_AUTO_READ (0x2E)
        if (pollCount % 2 === 0) {
          const cmd = buildUhfCommand(UHF_CMD.START_INVENTORY);
          uhfSocket.write(cmd);
        } else {
          const cmd = buildUhfCommand(UHF_CMD.START_AUTO_READ);
          uhfSocket.write(cmd);
        }
        // Verbose logging disabled - uncomment for debugging:
        // console.log('[UHF] Poll #' + pollCount);
      } catch (e) {
        // Write error - let close event handle reconnect
      }
    }
  }, 2000);
}

function stopInventoryPolling() {
  if (inventoryPollTimer) {
    clearInterval(inventoryPollTimer);
    inventoryPollTimer = null;
  }
}

// Heartbeat functions - keeps connection alive
function startHeartbeat() {
  if (heartbeatTimer) return;

  heartbeatTimer = setInterval(() => {
    if (uhfSocket && !uhfSocket.destroyed && uhfConnected) {
      try {
        uhfSocket.write(buildUhfCommand(UHF_CMD.HEARTBEAT));
      } catch (e) {
        // Silently handle error
      }
    }
  }, 3000);
}

function stopHeartbeat() {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
}

// Connection health check - detect stale connections
function startHealthCheck() {
  if (healthCheckTimer) return;

  healthCheckTimer = setInterval(() => {
    if (uhfConnected && lastDataReceived > 0) {
      const timeSinceData = Date.now() - lastDataReceived;
      if (timeSinceData > CONNECTION_TIMEOUT) {
        // Force reconnect
        if (uhfSocket && !uhfSocket.destroyed) {
          uhfSocket.destroy();
          // This will trigger 'close' event which will auto-reconnect
        }
      }
    }
  }, 5000);
}

function stopHealthCheck() {
  if (healthCheckTimer) {
    clearInterval(healthCheckTimer);
    healthCheckTimer = null;
  }
}

function disconnectUhfReader() {
  // User wants to disconnect - don't auto-reconnect
  userWantsConnection = false;

  stopInventoryPolling();
  stopHeartbeat();
  stopHealthCheck();

  if (uhfReconnectTimer) {
    clearTimeout(uhfReconnectTimer);
    uhfReconnectTimer = null;
  }

  // Stop inventory by setting flag (next inventory won't be sent)
  uhfInventoryActive = false;

  if (uhfSocket) {
    uhfSocket.destroy();
    uhfSocket = null;
  }

  uhfConnected = false;
}

// ==========================================
// End UHF RFID Reader
// ==========================================

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 768,
    icon: path.join(__dirname, '../public/pwa-512x512.png'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.cjs')
    },
    autoHideMenuBar: true,
    title: 'RFID Çamaşırhane - Karbeyaz & Demet'
  });

  // Load the app - station selection page
  if (isDev) {
    // Development: Load from Vite dev server
    mainWindow.loadURL('http://localhost:3002/#/station');
    mainWindow.webContents.openDevTools();
  } else {
    // Production: Load from built files using app path
    const appPath = app.getAppPath();
    mainWindow.loadFile(path.join(appPath, 'dist/index.html'), { hash: '/station' });
  }

  // Enable F12 to open DevTools in both dev and production
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.key === 'F12') {
      mainWindow.webContents.toggleDevTools();
    }
    // Ctrl+Shift+I also opens DevTools
    if (input.control && input.shift && input.key === 'I') {
      mainWindow.webContents.toggleDevTools();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// Handle printer list request
ipcMain.handle('get-printers', async () => {
  if (mainWindow) {
    const printers = await mainWindow.webContents.getPrintersAsync();
    console.log('[Print] Available printers:');
    printers.forEach(p => {
      console.log(`  - "${p.name}" (default: ${p.isDefault}, status: ${p.status})`);
    });
    return printers;
  }
  return [];
});

// Test printer - send a test page
ipcMain.handle('test-printer', async (event, { printerName }) => {
  console.log('[Print] ========== TEST PRINT ==========');
  console.log('[Print] Testing printer:', printerName);

  const testHtml = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <style>
        body { font-family: Arial, sans-serif; padding: 20mm; }
        h1 { color: #333; }
        .info { margin: 10px 0; }
        .box { border: 2px solid #000; padding: 20px; margin: 20px 0; }
      </style>
    </head>
    <body>
      <h1>Yazıcı Test Sayfası</h1>
      <div class="info"><strong>Yazıcı:</strong> ${printerName || 'Varsayılan'}</div>
      <div class="info"><strong>Tarih:</strong> ${new Date().toLocaleString('tr-TR')}</div>
      <div class="box">
        <p>Bu bir test sayfasıdır.</p>
        <p>Türkçe karakterler: ğüşıöçĞÜŞİÖÇ</p>
        <p>1234567890</p>
      </div>
      <p>RFID Çamaşırhane Sistemi - Karbeyaz & Demet</p>
    </body>
    </html>
  `;

  return new Promise((resolve) => {
    const printWindow = new BrowserWindow({
      show: false,
      width: 800,
      height: 600,
      webPreferences: { nodeIntegration: false, contextIsolation: true }
    });

    const base64Html = Buffer.from(testHtml).toString('base64');
    printWindow.loadURL('data:text/html;base64,' + base64Html);

    printWindow.webContents.on('did-finish-load', () => {
      setTimeout(() => {
        printWindow.webContents.print({
          silent: true,
          printBackground: true,
          deviceName: printerName || '',
          pageSize: 'A4'
        }, (success, reason) => {
          console.log('[Print] Test print result:', success, reason);
          setTimeout(() => { try { printWindow.close(); } catch(e) {} }, 2000);
          resolve({ success, error: reason });
        });
      }, 500);
    });
  });
});

// Handle print request
ipcMain.handle('print-document', async (event, options) => {
  if (mainWindow) {
    return new Promise((resolve, reject) => {
      mainWindow.webContents.print(
        {
          silent: options.silent || false,
          printBackground: true,
          deviceName: options.printerName || '',
          margins: { marginType: 'none' },
          copies: options.copies || 1,
          ...options
        },
        (success, failureReason) => {
          if (success) {
            resolve({ success: true });
          } else {
            resolve({ success: false, error: failureReason });
          }
        }
      );
    });
  }
  return { success: false, error: 'Window not available' };
});

// Handle silent print with specific printer (for labels - 80mm x 60mm)
ipcMain.handle('print-label', async (event, { html, printerName, copies }) => {
  console.log('[Print] ========== LABEL PRINT START ==========');
  console.log('[Print] Requested printer:', printerName);
  console.log('[Print] Copies:', copies);

  let actualPrinterName = printerName || '';

  if (mainWindow) {
    try {
      const printers = await mainWindow.webContents.getPrintersAsync();
      let targetPrinter = printers.find(p => p.name === printerName);
      if (!targetPrinter && printerName) {
        targetPrinter = printers.find(p => p.name.toLowerCase().includes(printerName.toLowerCase()));
      }
      if (targetPrinter) {
        actualPrinterName = targetPrinter.name;
      } else {
        const defaultPrinter = printers.find(p => p.isDefault);
        if (defaultPrinter) actualPrinterName = defaultPrinter.name;
      }
    } catch (e) {
      console.log('[Print] Could not get printer list:', e.message);
    }
  }

  return new Promise((resolve) => {
    try {
      const printWindow = new BrowserWindow({
        show: false,
        width: 400,
        height: 300,
        webPreferences: { nodeIntegration: false, contextIsolation: true }
      });

      let resolved = false;
      const safeResolve = (result, delayClose = 0) => {
        if (!resolved) {
          resolved = true;
          setTimeout(() => { try { printWindow.close(); } catch (e) {} }, delayClose);
          resolve(result);
        }
      };

      const timeout = setTimeout(() => {
        safeResolve({ success: false, error: 'Print timeout' });
      }, 15000);

      const base64Html = Buffer.from(html || '<html><body>No content</body></html>').toString('base64');
      printWindow.loadURL(`data:text/html;base64,${base64Html}`);

      printWindow.webContents.on('did-finish-load', () => {
        clearTimeout(timeout);

        setTimeout(() => {
          if (resolved) return;

          const printOptions = {
            silent: true,
            printBackground: true,
            deviceName: actualPrinterName,
            copies: copies || 1,
            margins: { marginType: 'none' },
            pageSize: { width: 80000, height: 60000 }
          };

          printWindow.webContents.print(printOptions, (success, failureReason) => {
            console.log('[Print] Label result:', success, failureReason);
            safeResolve({ success: success, error: failureReason }, 3000);
          });
        }, 1000);
      });

      printWindow.webContents.on('did-fail-load', () => {
        clearTimeout(timeout);
        safeResolve({ success: false, error: 'Load failed' });
      });
    } catch (error) {
      resolve({ success: false, error: error.message });
    }
  });
});

// Handle irsaliye printing (Direct Electron print - no PDF conversion)
ipcMain.handle('print-irsaliye', async (event, { html, printerName, copies }) => {
  const logs = [];
  const log = (msg) => { console.log(msg); logs.push(msg); };

  log('[Print] ========== IRSALIYE PRINT START ==========');
  log(`[Print] Printer: ${printerName}`);
  log('[Print] Mode: Direct Electron print (no PDF)');

  // Yazıcı adını doğrula
  let actualPrinterName = printerName || '';
  if (mainWindow) {
    try {
      const printers = await mainWindow.webContents.getPrintersAsync();
      log(`[Print] Available printers: ${printers.map(p => p.name).join(', ')}`);

      let targetPrinter = printers.find(p => p.name === printerName);
      if (!targetPrinter && printerName) {
        targetPrinter = printers.find(p => p.name.toLowerCase().includes(printerName.toLowerCase()));
      }
      if (targetPrinter) {
        actualPrinterName = targetPrinter.name;
        log(`[Print] Matched printer: ${actualPrinterName}`);
      }
    } catch (e) {
      log(`[Print] Could not get printer list: ${e.message}`);
    }
  }

  return new Promise((resolve) => {
    try {
      const printWindow = new BrowserWindow({
        show: false,
        width: 800,
        height: 900,
        webPreferences: { nodeIntegration: false, contextIsolation: true }
      });

      let resolved = false;
      const safeResolve = (result) => {
        if (!resolved) {
          resolved = true;
          setTimeout(() => { try { printWindow.close(); } catch (e) {} }, 1000);
          resolve({ ...result, logs });
        }
      };

      const timeout = setTimeout(() => {
        log('[Print] Timeout!');
        safeResolve({ success: false, error: 'Timeout' });
      }, 30000);

      const base64Html = Buffer.from(html || '<html><body>No content</body></html>').toString('base64');
      printWindow.loadURL(`data:text/html;base64,${base64Html}`);

      printWindow.webContents.on('did-finish-load', () => {
        log('[Print] HTML loaded');
        clearTimeout(timeout);

        // Wait for content to render, then print directly
        setTimeout(() => {
          printWindow.webContents.print(
            {
              silent: true,
              printBackground: true,
              deviceName: actualPrinterName,
              copies: copies || 1,
              margins: { marginType: 'none' },
              pageSize: { width: 205000, height: 217500 } // 205mm x 217.5mm in microns
            },
            (success, failureReason) => {
              if (success) {
                log('[Print] ✓ İrsaliye yazıcıya gönderildi!');
                safeResolve({ success: true });
              } else {
                log(`[Print] Error: ${failureReason}`);
                safeResolve({ success: false, error: failureReason });
              }
            }
          );
        }, 500);
      });

      printWindow.webContents.on('did-fail-load', (e, code, desc) => {
        log(`[Print] Load failed: ${code} ${desc}`);
        clearTimeout(timeout);
        safeResolve({ success: false, error: desc });
      });

    } catch (error) {
      log(`[Print] Exception: ${error.message}`);
      resolve({ success: false, error: error.message, logs });
    }
  });
});


// ==========================================
// UHF RFID Reader IPC Handlers
// ==========================================

// Get UHF reader connection status
ipcMain.handle('uhf-get-status', async () => {
  return {
    connected: uhfConnected,
    ip: UHF_READER_CONFIG.ip,
    port: UHF_READER_CONFIG.port,
    inventoryActive: uhfInventoryActive
  };
});

// Connect to UHF reader
ipcMain.handle('uhf-connect', async (event, { ip, port } = {}) => {
  if (ip) UHF_READER_CONFIG.ip = ip;
  if (port) UHF_READER_CONFIG.port = port;

  connectUhfReader();
  return { success: true };
});

// Disconnect from UHF reader
ipcMain.handle('uhf-disconnect', async () => {
  disconnectUhfReader();
  return { success: true };
});

// Start inventory (continuous tag reading)
ipcMain.handle('uhf-start-inventory', async () => {
  if (!uhfConnected || !uhfSocket) {
    return { success: false, error: 'Not connected' };
  }

  scannedTags.clear();
  uhfInventoryActive = true;
  uhfSocket.write(buildUhfCommand(UHF_CMD.START_INVENTORY));
  return { success: true };
});

// Stop inventory
ipcMain.handle('uhf-stop-inventory', async () => {
  if (!uhfConnected || !uhfSocket) {
    return { success: false, error: 'Not connected' };
  }

  uhfInventoryActive = false;
  uhfSocket.write(buildUhfCommand(UHF_CMD.STOP_INVENTORY));
  return { success: true };
});

// Get all scanned tags
ipcMain.handle('uhf-get-tags', async () => {
  return Array.from(scannedTags.values());
});

// Clear scanned tags
ipcMain.handle('uhf-clear-tags', async () => {
  scannedTags.clear();
  return { success: true };
});

// Set UHF reader configuration
ipcMain.handle('uhf-set-config', async (event, config) => {
  if (config.ip) UHF_READER_CONFIG.ip = config.ip;
  if (config.port) UHF_READER_CONFIG.port = config.port;
  return { success: true, config: UHF_READER_CONFIG };
});

// Set RF power level (0-30 dBm)
// Lower power = shorter read range
// Higher power = longer read range
ipcMain.handle('uhf-set-power', async (event, { power }) => {
  if (!uhfConnected || !uhfSocket) {
    return { success: false, error: 'Not connected' };
  }

  // Validate power level (0-30 dBm)
  const powerLevel = Math.max(0, Math.min(30, parseInt(power) || 20));
  currentRfPower = powerLevel;

  try {
    // BOHANG CM protocol: Set RF power for 4 antennas
    // Format: [ant1_power, ant2_power, ant3_power, ant4_power]
    // Each value is 0-30 dBm
    const powerData = [powerLevel, powerLevel, powerLevel, powerLevel];

    // Try multiple power commands - different BOHANG models use different commands
    // Command 0x76: Set RF Power (common)
    uhfSocket.write(buildUhfCommand(UHF_CMD.SET_RF_POWER, powerData));

    // Also try alternative command 0xB6 with single byte
    setTimeout(() => {
      if (uhfSocket && !uhfSocket.destroyed) {
        uhfSocket.write(buildUhfCommand(UHF_CMD.SET_ANTENNA_POWER, [powerLevel]));
      }
    }, 100);

    return { success: true, power: powerLevel };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// Get current RF power level
ipcMain.handle('uhf-get-power', async () => {
  return { success: true, power: currentRfPower };
});

// Auto-discover RFID reader on network
ipcMain.handle('uhf-scan-network', async () => {
  const sendProgress = (progress) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('uhf-scan-progress', progress);
    }
  };

  sendProgress({ status: 'started', message: 'Ağ taraması başlatıldı...' });

  const result = await scanForReader(sendProgress);

  if (result) {
    UHF_READER_CONFIG.ip = result.ip;
    UHF_READER_CONFIG.port = result.port;

    sendProgress({ status: 'found', ip: result.ip, port: result.port, message: `Reader bulundu: ${result.ip}:${result.port}` });

    return { success: true, ip: result.ip, port: result.port };
  } else {
    sendProgress({ status: 'not_found', message: 'Reader bulunamadı' });
    return { success: false, error: 'Reader bulunamadı' };
  }
});

// Auto-discover and connect
ipcMain.handle('uhf-auto-connect', async () => {
  const sendProgress = (progress) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('uhf-scan-progress', progress);
    }
  };

  sendProgress({ status: 'started', message: 'Reader aranıyor...' });

  const result = await scanForReader(sendProgress);

  if (result) {
    UHF_READER_CONFIG.ip = result.ip;
    UHF_READER_CONFIG.port = result.port;

    sendProgress({ status: 'connecting', ip: result.ip, port: result.port, message: `Bağlanılıyor: ${result.ip}:${result.port}` });

    connectUhfReader();

    return { success: true, ip: result.ip, port: result.port };
  } else {
    sendProgress({ status: 'not_found', message: 'Reader bulunamadı' });
    return { success: false, error: 'Reader bulunamadı' };
  }
});

// ==========================================
// End UHF RFID Reader IPC Handlers
// ==========================================

// ==========================================
// SQLite Database IPC Handlers
// ==========================================

// Initialize database and sync
ipcMain.handle('db-init', async (event, { token }) => {
  try {
    await db.initDatabase();
    if (token) {
      syncService.setAuthToken(token);
    }
    syncService.setMainWindow(mainWindow);
    const stats = db.getDatabaseStats();
    console.log('[Main] Database initialized:', stats);
    return { success: true, stats };
  } catch (error) {
    console.error('[Main] Database init error:', error);
    return { success: false, error: error.message };
  }
});

// Set auth token for sync
ipcMain.handle('db-set-token', async (event, { token }) => {
  console.log('[Main] Setting auth token:', token ? token.substring(0, 30) + '...' : 'NONE');
  syncService.setAuthToken(token);
  return { success: true };
});

// Full sync from API to SQLite
ipcMain.handle('db-full-sync', async () => {
  console.log('[Main] Full sync requested, token available:', !!syncService.getAuthToken());
  try {
    const result = await syncService.fullSync();
    console.log('[Main] Full sync result:', result.success ? `${result.itemsCount} items` : result.error);
    return result;
  } catch (error) {
    console.error('[Main] Full sync error:', error.message);
    return { success: false, error: error.message };
  }
});

// Delta sync (only changes)
ipcMain.handle('db-delta-sync', async () => {
  try {
    const result = await syncService.deltaSync();
    return result;
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Get item by RFID (fast local lookup)
ipcMain.handle('db-get-item-by-rfid', async (event, { rfidTag }) => {
  try {
    const item = db.getItemByRfid(rfidTag);
    return { success: true, item };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Get database stats
ipcMain.handle('db-get-stats', async () => {
  try {
    const stats = db.getDatabaseStats();
    const sampleRfids = db.getSampleRfids(5);
    console.log('[Main] DB Stats:', stats, 'Sample RFIDs:', sampleRfids);
    return { success: true, stats, sampleRfids };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Get all tenants from local cache
ipcMain.handle('db-get-tenants', async () => {
  try {
    const tenants = db.getAllTenants();
    return { success: true, tenants };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Get all item types from local cache
ipcMain.handle('db-get-item-types', async () => {
  try {
    const itemTypes = db.getAllItemTypes();
    return { success: true, itemTypes };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Mark items as clean (with offline queue support)
ipcMain.handle('db-mark-items-clean', async (event, { itemIds }) => {
  try {
    const result = await syncService.markItemsClean(itemIds);
    return result;
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Get pending operations count
ipcMain.handle('db-get-pending-count', async () => {
  try {
    const count = db.getPendingOperationsCount();
    return { success: true, count };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Process pending operations
ipcMain.handle('db-process-pending', async () => {
  try {
    const result = await syncService.processPendingOperations();
    return { success: true, ...result };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Check online status
ipcMain.handle('db-is-online', async () => {
  return { online: syncService.isOnline() };
});

// Debug: Search items in local database
ipcMain.handle('db-debug-search', async (event, { searchTerm }) => {
  try {
    const result = db.debugSearchItems(searchTerm);
    console.log('[Main] Debug search result:', JSON.stringify(result, null, 2));
    return { success: true, ...result };
  } catch (error) {
    console.error('[Main] Debug search error:', error);
    return { success: false, error: error.message };
  }
});

// ==========================================
// End SQLite Database IPC Handlers
// ==========================================

app.whenReady().then(async () => {
  // Initialize database before creating window
  try {
    await db.initDatabase();
    console.log('[Main] Database pre-initialized');
  } catch (error) {
    console.error('[Main] Database pre-init error:', error);
  }

  createWindow();

  // Set main window for sync service
  syncService.setMainWindow(mainWindow);

  // Register global shortcut for DevTools (F12)
  globalShortcut.register('F12', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.toggleDevTools();
    }
  });

  // Also register Ctrl+Shift+I
  globalShortcut.register('CommandOrControl+Shift+I', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.toggleDevTools();
    }
  });

  console.log('[Main] DevTools shortcuts registered (F12, Ctrl+Shift+I)');
});

app.on('window-all-closed', () => {
  // Unregister all shortcuts
  globalShortcut.unregisterAll();

  // Close database on quit
  db.closeDatabase();
  syncService.stopAutoSync();

  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
