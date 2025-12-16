const { app, BrowserWindow, ipcMain, globalShortcut } = require('electron');
const path = require('path');
const net = require('net');
const os = require('os');

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
  DEVICE_INFO_REPORT: 0x67
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
      console.log(`[UHF-Verify] Connected to ${ip}:${port}, sending HEARTBEAT...`);
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
            console.log(`[UHF-Verify] ✓ Valid CM protocol response from ${ip}:${port}`);
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
                console.log(`[UHF-Verify] ✓ Valid CM protocol response from ${ip}:${port}`);
                clearTimeout(timer);
                cleanup();
                resolve({ success: true, ip, port });
                return;
              }
            }
            console.log(`[UHF-Verify] ✗ Invalid response from ${ip}:${port}: ${dataBuffer.toString('hex')}`);
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
  console.log('[UHF] Scanning network ranges:', ranges);

  if (progressCallback) progressCallback({ status: 'scanning', ranges });

  // Priority ports for BOHANG readers
  const priorityPorts = [20058, 4001, 6000];

  // First, try known/saved IP with priority ports (with protocol verification)
  const savedIp = UHF_READER_CONFIG.ip;
  console.log(`[UHF] Trying saved IP ${savedIp} with protocol verification...`);
  if (progressCallback) progressCallback({ status: 'trying', ip: savedIp, message: `Kayıtlı IP deneniyor: ${savedIp}` });

  for (const port of priorityPorts) {
    const result = await tryConnectAndVerify(savedIp, port, 1500);
    if (result.success) {
      console.log(`[UHF] ✓ Verified BOHANG reader at ${savedIp}:${port}`);
      return { ip: savedIp, port, verified: true };
    }
  }

  // Scan each network range with protocol verification
  for (const prefix of ranges) {
    console.log(`[UHF] Scanning ${prefix}.x with protocol verification...`);
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

    console.log(`[UHF] Found ${candidates.length} candidate(s) in ${prefix}.x`);
    if (progressCallback) progressCallback({
      status: 'verifying',
      message: `${candidates.length} aday bulundu, doğrulanıyor...`,
      candidates: candidates.length
    });

    // Now verify each candidate with protocol check
    for (const candidate of candidates) {
      console.log(`[UHF] Verifying candidate ${candidate.ip}:${candidate.port}...`);
      if (progressCallback) progressCallback({
        status: 'verifying_device',
        ip: candidate.ip,
        port: candidate.port,
        message: `Doğrulanıyor: ${candidate.ip}:${candidate.port}`
      });

      const result = await tryConnectAndVerify(candidate.ip, candidate.port, 1500);
      if (result.success) {
        console.log(`[UHF] ✓ Verified BOHANG reader at ${candidate.ip}:${candidate.port}`);
        return { ip: candidate.ip, port: candidate.port, verified: true };
      }
    }
  }

  // Deep scan - try all common ports on all IPs (slower, still with verification)
  console.log('[UHF] Quick scan failed, trying deep scan with all ports...');
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
            console.log(`[UHF] ✓ Verified BOHANG reader at ${ip}:${port}`);
            return { ip, port, verified: true };
          }
        }
      }
    }
  }

  console.log('[UHF] No verified BOHANG reader found');
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
    console.log(`[UHF] Parsed frame: cmd=0x${cmd.toString(16)}, readerId=${readerId}, dataLen=${dataLen}`);

    offset += frameLen;
  }

  // Return remaining buffer
  return { results, remaining: buffer.slice(offset) };
}

// Extract EPC from inventory response
function extractEpcFromInventory(data) {
  // Inventory response format varies, but typically:
  // Antenna(1) + PC(2) + EPC(12+) + RSSI(1) or similar
  if (data.length < 4) return null;

  try {
    const antenna = data[0];
    // PC is 2 bytes
    const pc = (data[1] << 8) | data[2];
    // EPC length can be determined from PC, but typically 12 bytes (96 bits)
    const epcLen = Math.min(12, data.length - 4); // Reserve space for RSSI
    const epc = data.slice(3, 3 + epcLen);
    const rssi = data.length > 3 + epcLen ? data[3 + epcLen] : 0;

    return {
      antenna,
      pc,
      epc: Buffer.from(epc).toString('hex').toUpperCase(),
      rssi: rssi > 127 ? rssi - 256 : rssi // Convert to signed
    };
  } catch (e) {
    return null;
  }
}

// Connect to UHF Reader
function connectUhfReader() {
  if (uhfSocket) {
    uhfSocket.destroy();
    uhfSocket = null;
  }

  console.log(`[UHF] Connecting to ${UHF_READER_CONFIG.ip}:${UHF_READER_CONFIG.port}...`);

  uhfSocket = new net.Socket();
  uhfSocket.setKeepAlive(true, 5000); // Keep connection alive every 5 seconds
  uhfSocket.setNoDelay(true); // Disable Nagle's algorithm for faster communication
  uhfSocket.setTimeout(10000); // 10 second timeout for initial connection

  uhfSocket.on('timeout', () => {
    console.log('[UHF] Socket timeout - connection may be stale');
    // Clear timeout after connection established
    if (uhfConnected) {
      uhfSocket.setTimeout(0); // Disable timeout once connected
    }
  });

  uhfSocket.connect(UHF_READER_CONFIG.port, UHF_READER_CONFIG.ip, () => {
    console.log('[UHF] Connected to reader');
    uhfConnected = true;
    uhfDataBuffer = Buffer.alloc(0);
    lastDataReceived = Date.now();
    userWantsConnection = true; // Mark that user wants to stay connected

    // Disable socket timeout now that we're connected
    uhfSocket.setTimeout(0);

    // Send log to renderer for debugging
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('uhf-log', { type: 'connect', message: 'Connected to ' + UHF_READER_CONFIG.ip + ':' + UHF_READER_CONFIG.port });
    }

    console.log('[UHF] Connected - starting auto-read mode...');
    uhfInventoryActive = true;

    // Notify renderer - connected
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('uhf-status', { connected: true, ip: UHF_READER_CONFIG.ip, port: UHF_READER_CONFIG.port, inventoryActive: true });
    }

    // Wait a moment then send START_AUTO_READ to begin tag scanning
    setTimeout(() => {
      if (uhfSocket && !uhfSocket.destroyed && uhfConnected) {
        console.log('[UHF] Sending START_AUTO_READ command...');
        try {
          uhfSocket.write(buildUhfCommand(UHF_CMD.START_AUTO_READ));
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('uhf-log', { type: 'sent', message: 'START_AUTO_READ command sent' });
          }
        } catch (e) {
          console.log('[UHF] Failed to send START_AUTO_READ:', e.message);
        }
      }
    }, 1000);
  });

  uhfSocket.on('data', (data) => {
    uhfDataBuffer = Buffer.concat([uhfDataBuffer, data]);
    lastDataReceived = Date.now(); // Update timestamp

    // Log to main process and renderer for debugging
    console.log('[UHF] Data:', data.length, 'bytes, hex:', data.toString('hex'));
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('uhf-log', { type: 'data', message: data.length + ' bytes: ' + data.toString('hex') });
    }

    const { results, remaining } = parseUhfResponse(uhfDataBuffer);
    uhfDataBuffer = remaining;
    console.log('[UHF] Parsed results count:', results.length);

    for (const result of results) {
      // Store reader ID from device
      if (result.readerId) {
        uhfReaderId = result.readerId;
      }

      // Handle device info report (0x67)
      if (result.cmd === UHF_CMD.DEVICE_INFO_REPORT) {
        console.log('[UHF] Device info received - reader ready');
        // Don't auto-start - wait for user to click "Tara"
      }

      // Handle heartbeat (0x10) - respond with heartbeat to keep connection alive
      if (result.cmd === UHF_CMD.HEARTBEAT) {
        console.log('[UHF] Heartbeat received from reader - sending response');
        try {
          uhfSocket.write(buildUhfCommand(UHF_CMD.HEARTBEAT));
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('uhf-log', { type: 'sent', message: 'HEARTBEAT response sent' });
          }
        } catch (e) {
          console.log('[UHF] Failed to send heartbeat response:', e.message);
        }
      }

      // Handle inventory response commands
      // 0x2A = inventory response, 0x2E = auto-read response, 0x22 = realtime inventory, 0x81 = tag notification
      const isInventoryResponse = (result.cmd === UHF_CMD.START_INVENTORY ||
                                   result.cmd === UHF_CMD.START_AUTO_READ ||
                                   result.cmd === 0x22 ||
                                   result.cmd === 0x81 ||
                                   result.cmd === 0x29);

      if (isInventoryResponse && result.data.length > 0) {
        console.log('[UHF] TAG DATA cmd=0x' + result.cmd.toString(16) + ' data=' + Buffer.from(result.data).toString('hex'));

        const tagInfo = extractEpcFromInventory(result.data);
        if (tagInfo && tagInfo.epc && tagInfo.epc.length > 0) {
          const existing = scannedTags.get(tagInfo.epc);
          scannedTags.set(tagInfo.epc, {
            epc: tagInfo.epc,
            count: existing ? existing.count + 1 : 1,
            lastSeen: Date.now(),
            rssi: tagInfo.rssi,
            antenna: tagInfo.antenna
          });

          console.log('[UHF] *** TAG FOUND: ' + tagInfo.epc + ' RSSI:' + tagInfo.rssi + ' ***');

          // Notify renderer of new tag
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('uhf-tag', tagInfo);
          }
        }
      }

      // Handle version response
      if (result.cmd === UHF_CMD.GET_VERSION) {
        console.log('[UHF] Version:', Buffer.from(result.data).toString());
      }

      // Log unknown commands with data
      if (result.data.length > 0 && !isInventoryResponse &&
          result.cmd !== UHF_CMD.DEVICE_INFO_REPORT &&
          result.cmd !== UHF_CMD.HEARTBEAT &&
          result.cmd !== UHF_CMD.GET_VERSION) {
        console.log('[UHF] Unknown cmd=0x' + result.cmd.toString(16) + ' data=' + Buffer.from(result.data).toString('hex'));
      }
    }
  });

  uhfSocket.on('error', (err) => {
    console.log('[UHF] Socket error:', err.message);
    // Send error to renderer for debugging
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('uhf-log', { type: 'error', message: 'Socket error: ' + err.message });
    }
    // Error will trigger 'close' event, which will handle reconnect
  });

  uhfSocket.on('close', () => {
    console.log('[UHF] Connection closed');
    // Send to renderer for debugging
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('uhf-log', { type: 'close', message: 'Connection closed - will reconnect' });
    }
    uhfConnected = false;
    uhfStatusSent = false;
    stopInventoryPolling();
    stopHeartbeat();
    stopHealthCheck();

    // Always auto-reconnect - don't notify UI of disconnect, just reconnect silently
    if (userWantsConnection) {
      console.log('[UHF] Connection lost - reconnecting immediately...');
      scheduleReconnect();
    } else {
      // Only notify UI if user doesn't want connection
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('uhf-status', { connected: false });
      }
    }
  });

  // No timeout handler - connection stays open
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
      console.log('[UHF] Reconnecting to ' + UHF_READER_CONFIG.ip + ':' + UHF_READER_CONFIG.port + '...');
      connectUhfReader();
    }
  }, 500);
}

// Start polling inventory command
function startInventoryPolling() {
  if (inventoryPollTimer) return; // Already polling

  console.log('[UHF] Starting inventory polling (every 1 second)');
  inventoryPollTimer = setInterval(() => {
    if (uhfSocket && !uhfSocket.destroyed && uhfConnected && uhfInventoryActive) {
      try {
        uhfSocket.write(buildUhfCommand(UHF_CMD.START_INVENTORY));
      } catch (e) {
        console.log('[UHF] Write error:', e.message);
        // Write error might mean connection is bad - let health check handle it
      }
    }
  }, 1000); // Poll every 1 second - give reader time to respond
}

function stopInventoryPolling() {
  if (inventoryPollTimer) {
    clearInterval(inventoryPollTimer);
    inventoryPollTimer = null;
    console.log('[UHF] Stopped inventory polling');
  }
}

// Heartbeat functions - keeps connection alive
function startHeartbeat() {
  if (heartbeatTimer) return; // Already running

  console.log('[UHF] Starting heartbeat (every 3 seconds)');
  heartbeatTimer = setInterval(() => {
    if (uhfSocket && !uhfSocket.destroyed && uhfConnected) {
      try {
        // Send heartbeat command to keep connection alive
        uhfSocket.write(buildUhfCommand(UHF_CMD.HEARTBEAT));
        console.log('[UHF] Heartbeat sent');
      } catch (e) {
        console.log('[UHF] Heartbeat write error:', e.message);
      }
    }
  }, 3000); // Every 3 seconds to keep connection alive
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

  console.log('[UHF] Starting health check (every 5 seconds)');
  healthCheckTimer = setInterval(() => {
    if (uhfConnected && lastDataReceived > 0) {
      const timeSinceData = Date.now() - lastDataReceived;
      if (timeSinceData > CONNECTION_TIMEOUT) {
        console.log(`[UHF] ⚠️ No data received for ${timeSinceData}ms - connection may be stale`);

        // Force reconnect
        if (uhfSocket && !uhfSocket.destroyed) {
          console.log('[UHF] Forcing reconnect due to stale connection...');
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
  console.log('[UHF] Disconnecting (user requested)...');

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
    return await mainWindow.webContents.getPrintersAsync();
  }
  return [];
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

// Handle silent print with specific printer (for labels - 60mm x 80mm)
ipcMain.handle('print-label', async (event, { html, printerName, copies }) => {
  return new Promise((resolve) => {
    // Create a hidden window for printing
    const printWindow = new BrowserWindow({
      show: false,
      width: 800,
      height: 600,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true
      }
    });

    // Use base64 encoding to avoid URL encoding issues
    const base64Html = Buffer.from(html || '<html><body>No content</body></html>').toString('base64');
    printWindow.loadURL(`data:text/html;base64,${base64Html}`);

    printWindow.webContents.on('did-finish-load', () => {
      // Wait a bit for any embedded content to load
      setTimeout(() => {
        printWindow.webContents.print(
          {
            silent: true,
            printBackground: true,
            deviceName: printerName || '',
            copies: copies || 1,
            margins: { marginType: 'none' },
            pageSize: { width: 60000, height: 80000 } // 60mm x 80mm in microns
          },
          (success, failureReason) => {
            printWindow.close();
            if (success) {
              resolve({ success: true });
            } else {
              resolve({ success: false, error: failureReason });
            }
          }
        );
      }, 500); // Wait 500ms for content to fully render
    });
  });
});

// Handle irsaliye printing (205mm x 217.5mm - special paper size)
ipcMain.handle('print-irsaliye', async (event, { html, printerName, copies }) => {
  return new Promise((resolve) => {
    // Create a hidden window for printing
    const printWindow = new BrowserWindow({
      show: false,
      width: 800,
      height: 900,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true
      }
    });

    // Use base64 encoding to avoid URL encoding issues
    const base64Html = Buffer.from(html || '<html><body>No content</body></html>').toString('base64');
    printWindow.loadURL(`data:text/html;base64,${base64Html}`);

    printWindow.webContents.on('did-finish-load', () => {
      // Wait a bit for content to fully render
      setTimeout(() => {
        printWindow.webContents.print(
          {
            silent: true,
            printBackground: true,
            deviceName: printerName || '',
            copies: copies || 1,
            margins: { marginType: 'none' },
            pageSize: { width: 205000, height: 217500 } // 205mm x 217.5mm in microns
          },
          (success, failureReason) => {
            printWindow.close();
            if (success) {
              resolve({ success: true });
            } else {
              resolve({ success: false, error: failureReason });
            }
          }
        );
      }, 500); // Wait 500ms for content to fully render
    });
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

  scannedTags.clear(); // Clear previous tags
  uhfInventoryActive = true;
  uhfSocket.write(buildUhfCommand(UHF_CMD.START_INVENTORY));
  console.log('[UHF] Started inventory');
  return { success: true };
});

// Stop inventory
ipcMain.handle('uhf-stop-inventory', async () => {
  if (!uhfConnected || !uhfSocket) {
    return { success: false, error: 'Not connected' };
  }

  uhfInventoryActive = false;
  uhfSocket.write(buildUhfCommand(UHF_CMD.STOP_INVENTORY));
  console.log('[UHF] Stopped inventory');
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

// Auto-discover RFID reader on network
ipcMain.handle('uhf-scan-network', async () => {
  console.log('[UHF] Starting network scan...');

  // Send progress updates to renderer
  const sendProgress = (progress) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('uhf-scan-progress', progress);
    }
  };

  sendProgress({ status: 'started', message: 'Ağ taraması başlatıldı...' });

  const result = await scanForReader(sendProgress);

  if (result) {
    // Update config with found IP/port
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
  console.log('[UHF] Auto-connect: scanning and connecting...');

  // Send progress updates to renderer
  const sendProgress = (progress) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('uhf-scan-progress', progress);
    }
  };

  sendProgress({ status: 'started', message: 'Reader aranıyor...' });

  const result = await scanForReader(sendProgress);

  if (result) {
    // Update config with found IP/port
    UHF_READER_CONFIG.ip = result.ip;
    UHF_READER_CONFIG.port = result.port;

    sendProgress({ status: 'connecting', ip: result.ip, port: result.port, message: `Bağlanılıyor: ${result.ip}:${result.port}` });

    // Connect to the reader
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

app.whenReady().then(() => {
  createWindow();

  // Don't auto-connect - user will start scanning manually
  console.log('[UHF] Ready - waiting for user to start scanning');
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
