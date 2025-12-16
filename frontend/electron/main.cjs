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

    offset += frameLen;
  }

  // Return remaining buffer
  return { results, remaining: buffer.slice(offset) };
}

// Extract EPC from inventory response
function extractEpcFromInventory(data) {
  // BOHANG CM protocol inventory response format:
  // Antenna(1) + PC(2) + EPC(12 bytes = 96 bits) + RSSI(1)
  // Total minimum: 16 bytes
  if (data.length < 4) return null;

  try {
    const antenna = data[0];
    // PC is 2 bytes (Protocol Control)
    const pc = (data[1] << 8) | data[2];

    // Calculate EPC length from PC word (bits 10-15 encode length in 16-bit words)
    // For 96-bit EPC: length = 6 words = 12 bytes
    const epcWordCount = (pc >> 10) & 0x1F; // Get bits 10-14
    const epcByteLen = epcWordCount * 2; // Convert words to bytes

    // Use calculated length, or default to 12 bytes (96-bit EPC)
    const epcLen = epcByteLen > 0 && epcByteLen <= 32 ? epcByteLen : Math.min(12, data.length - 4);

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

    // Notify renderer - connected
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('uhf-status', { connected: true, ip: UHF_READER_CONFIG.ip, port: UHF_READER_CONFIG.port, inventoryActive: true });
    }

    // Wait a moment then send START_AUTO_READ to begin tag scanning
    setTimeout(() => {
      if (uhfSocket && !uhfSocket.destroyed && uhfConnected) {
        try {
          uhfSocket.write(buildUhfCommand(UHF_CMD.START_AUTO_READ));
        } catch (e) {
          // Silently handle error
        }
      }
    }, 1000);
  });

  uhfSocket.on('data', (data) => {
    uhfDataBuffer = Buffer.concat([uhfDataBuffer, data]);
    lastDataReceived = Date.now();

    const { results, remaining } = parseUhfResponse(uhfDataBuffer);
    uhfDataBuffer = remaining;

    for (const result of results) {
      if (result.readerId) {
        uhfReaderId = result.readerId;
      }

      // Handle heartbeat (0x10) - respond with heartbeat to keep connection alive
      if (result.cmd === UHF_CMD.HEARTBEAT) {
        try {
          uhfSocket.write(buildUhfCommand(UHF_CMD.HEARTBEAT));
        } catch (e) {
          // Silently handle error
        }
      }

      // Handle inventory response commands
      const isInventoryResponse = (result.cmd === UHF_CMD.START_INVENTORY ||
                                   result.cmd === UHF_CMD.START_AUTO_READ ||
                                   result.cmd === 0x22 ||
                                   result.cmd === 0x81 ||
                                   result.cmd === 0x29);

      if (isInventoryResponse && result.data.length > 0) {
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

          // Notify renderer of new tag
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('uhf-tag', tagInfo);
          }
        }
      }
    }
  });

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

// Start polling inventory command
function startInventoryPolling() {
  if (inventoryPollTimer) return;

  inventoryPollTimer = setInterval(() => {
    if (uhfSocket && !uhfSocket.destroyed && uhfConnected && uhfInventoryActive) {
      try {
        uhfSocket.write(buildUhfCommand(UHF_CMD.START_INVENTORY));
      } catch (e) {
        // Write error - let close event handle reconnect
      }
    }
  }, 1000);
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

app.whenReady().then(() => {
  createWindow();
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
