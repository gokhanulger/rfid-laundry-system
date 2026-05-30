/**
 * LAN Sync Module for RFID Laundry System
 * Enables offline sync between computers on the same local network.
 *
 * How it works:
 * - Each Electron instance starts a small HTTP server (port 19876)
 * - UDP broadcast (port 19877) for peer discovery
 * - When a delivery is updated, broadcasts change to all peers
 * - Peers receive the change and update their local SQLite
 */

const http = require('http');
const dgram = require('dgram');
const os = require('os');
const db = require('./database.cjs');

const LAN_HTTP_PORT = 19876;
const LAN_BROADCAST_PORT = 19877;
const DISCOVERY_INTERVAL = 10000; // Announce every 10 seconds
const PEER_TIMEOUT = 30000; // Remove peer if no heartbeat for 30s

let httpServer = null;
let udpSocket = null;
let discoveryTimer = null;
let mainWindow = null;
let peers = new Map(); // ip -> { port, lastSeen, hostname }
let myIp = null;
let isRunning = false;

// Get local IP address
function getLocalIp() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.internal || iface.family !== 'IPv4') continue;
      return iface.address;
    }
  }
  return '127.0.0.1';
}

// Set main window for status updates
function setMainWindow(window) {
  mainWindow = window;
}

// Send status to renderer
function sendLanStatus(data) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('lan-sync-status', data);
  }
}

// ==========================================
// HTTP Server - Serves delivery data to peers
// ==========================================

function startHttpServer() {
  return new Promise((resolve, reject) => {
    httpServer = http.createServer((req, res) => {
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Access-Control-Allow-Origin', '*');

      try {
        if (req.method === 'GET' && req.url === '/deliveries') {
          // Return all active deliveries from local DB
          const labelPrinted = db.getDeliveriesByStatus('label_printed');
          const packaged = db.getDeliveriesByStatus('packaged');
          const all = [...labelPrinted, ...packaged];
          res.writeHead(200);
          res.end(JSON.stringify({ success: true, deliveries: all, timestamp: Date.now() }));

        } else if (req.method === 'POST' && req.url === '/delivery-update') {
          // Receive delivery update from a peer
          let body = '';
          req.on('data', chunk => body += chunk);
          req.on('end', () => {
            try {
              const update = JSON.parse(body);
              handlePeerDeliveryUpdate(update);
              res.writeHead(200);
              res.end(JSON.stringify({ success: true }));
            } catch (e) {
              res.writeHead(400);
              res.end(JSON.stringify({ error: e.message }));
            }
          });

        } else if (req.method === 'GET' && req.url === '/ping') {
          res.writeHead(200);
          res.end(JSON.stringify({ ok: true, hostname: os.hostname(), ip: myIp }));

        } else {
          res.writeHead(404);
          res.end(JSON.stringify({ error: 'Not found' }));
        }
      } catch (e) {
        console.error('[LAN-Sync] HTTP error:', e.message);
        res.writeHead(500);
        res.end(JSON.stringify({ error: e.message }));
      }
    });

    httpServer.listen(LAN_HTTP_PORT, '0.0.0.0', () => {
      console.log(`[LAN-Sync] HTTP server listening on port ${LAN_HTTP_PORT}`);
      resolve();
    });

    httpServer.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        console.log(`[LAN-Sync] Port ${LAN_HTTP_PORT} in use, trying ${LAN_HTTP_PORT + 1}`);
        httpServer.listen(LAN_HTTP_PORT + 1, '0.0.0.0', () => {
          console.log(`[LAN-Sync] HTTP server listening on port ${LAN_HTTP_PORT + 1}`);
          resolve();
        });
      } else {
        console.error('[LAN-Sync] HTTP server error:', err.message);
        reject(err);
      }
    });
  });
}

// ==========================================
// UDP Discovery - Find peers on LAN
// ==========================================

function startDiscovery() {
  udpSocket = dgram.createSocket({ type: 'udp4', reuseAddr: true });

  udpSocket.on('message', (msg, rinfo) => {
    try {
      const data = JSON.parse(msg.toString());
      if (data.type === 'rfid-laundry-announce' && rinfo.address !== myIp) {
        const peerId = rinfo.address;
        const isNew = !peers.has(peerId);
        peers.set(peerId, {
          port: data.port || LAN_HTTP_PORT,
          lastSeen: Date.now(),
          hostname: data.hostname || 'unknown'
        });
        if (isNew) {
          console.log(`[LAN-Sync] Discovered peer: ${peerId} (${data.hostname})`);
          sendLanStatus({
            type: 'peer-discovered',
            peer: peerId,
            hostname: data.hostname,
            totalPeers: peers.size
          });
          // When we discover a new peer, pull their deliveries
          pullDeliveriesFromPeer(peerId, data.port || LAN_HTTP_PORT);
        }
      }
    } catch (e) {
      // Ignore non-JSON messages
    }
  });

  udpSocket.on('error', (err) => {
    console.error('[LAN-Sync] UDP error:', err.message);
  });

  udpSocket.bind(LAN_BROADCAST_PORT, () => {
    udpSocket.setBroadcast(true);
    console.log(`[LAN-Sync] UDP discovery listening on port ${LAN_BROADCAST_PORT}`);
    // Start announcing
    announcePresence();
    discoveryTimer = setInterval(() => {
      announcePresence();
      cleanupPeers();
    }, DISCOVERY_INTERVAL);
  });
}

function announcePresence() {
  if (!udpSocket) return;

  const message = JSON.stringify({
    type: 'rfid-laundry-announce',
    port: LAN_HTTP_PORT,
    hostname: os.hostname(),
    ip: myIp
  });

  const buffer = Buffer.from(message);

  // Broadcast to all local network subnets
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.internal || iface.family !== 'IPv4') continue;
      // Calculate broadcast address
      const parts = iface.address.split('.');
      const maskParts = iface.netmask.split('.');
      const broadcast = parts.map((p, i) => (parseInt(p) | (~parseInt(maskParts[i]) & 255))).join('.');
      try {
        udpSocket.send(buffer, 0, buffer.length, LAN_BROADCAST_PORT, broadcast);
      } catch (e) {
        // Ignore send errors
      }
    }
  }
}

function cleanupPeers() {
  const now = Date.now();
  for (const [ip, peer] of peers) {
    if (now - peer.lastSeen > PEER_TIMEOUT) {
      console.log(`[LAN-Sync] Peer timeout: ${ip}`);
      peers.delete(ip);
      sendLanStatus({
        type: 'peer-lost',
        peer: ip,
        totalPeers: peers.size
      });
    }
  }
}

// ==========================================
// Sync Operations
// ==========================================

// Pull all deliveries from a peer (used on first discovery)
async function pullDeliveriesFromPeer(ip, port) {
  try {
    const data = await httpGet(`http://${ip}:${port}/deliveries`);
    if (data.success && data.deliveries && data.deliveries.length > 0) {
      console.log(`[LAN-Sync] Pulled ${data.deliveries.length} deliveries from ${ip}`);
      // Upsert into local DB - merge with existing data
      mergeDeliveries(data.deliveries);
      sendLanStatus({
        type: 'sync-complete',
        peer: ip,
        count: data.deliveries.length
      });
    }
  } catch (e) {
    console.log(`[LAN-Sync] Could not pull from ${ip}:`, e.message);
  }
}

// Push a delivery update to all peers
async function broadcastDeliveryUpdate(delivery) {
  if (peers.size === 0) return;

  const body = JSON.stringify(delivery);

  for (const [ip, peer] of peers) {
    try {
      await httpPost(`http://${ip}:${peer.port}/delivery-update`, body);
      console.log(`[LAN-Sync] Pushed delivery update to ${ip}`);
    } catch (e) {
      console.log(`[LAN-Sync] Failed to push to ${ip}:`, e.message);
    }
  }
}

// Handle delivery update received from a peer
function handlePeerDeliveryUpdate(update) {
  if (!update || !update.id) {
    console.log('[LAN-Sync] Invalid delivery update received');
    return;
  }

  console.log(`[LAN-Sync] Received delivery update: ${update.id} -> ${update.status}`);

  // TOMBSTONE statuleri (peer'da iptal/iskarta edilmis) - yereli HARD-DELETE et VE
  // bir sonraki backend sync'inin (henuz islenmemis label_printed/packaged) geri
  // upsert etmesini engellemek icin recentLocalOps korumasina al. Aksi halde
  // peer A iptal eder -> B sadece status='cancelled' olur, 3-5sn sonra B'nin
  // backend sync'i fetch eder, backend cancel'i henuz islememisse (veya kuyrukta
  // takiliysa) satir label_printed/packaged'a GERI DONER -> paket ekranda hayalet.
  if (update.status === 'cancelled' || update.status === 'discarded') {
    try { db.deleteDelivery(update.id); } catch (_) {}
    try {
      const sync = require('./sync-service.cjs');
      if (sync && typeof sync.addRecentLocalOp === 'function') {
        sync.addRecentLocalOp(update.id);
      }
    } catch (e) {
      console.log('[LAN-Sync] addRecentLocalOp unavailable:', e.message);
    }
    console.log(`[LAN-Sync] Tombstone ${update.status} -> hard-deleted ${update.id} + protected from re-sync`);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('lan-delivery-updated', {
        deliveryId: update.id,
        status: update.status
      });
    }
    return;
  }

  // Check if we already have this delivery
  const existing = db.getDeliveryByBarcode(update.barcode);

  if (existing) {
    // Update only if the incoming update is newer
    const existingTime = new Date(existing.updated_at || existing.updatedAt || 0).getTime();
    const incomingTime = new Date(update.updated_at || update.updatedAt || 0).getTime();

    if (incomingTime >= existingTime) {
      db.updateDeliveryStatus(update.id, update.status, {
        packagedAt: update.packaged_at || update.packagedAt,
        pickedUpAt: update.picked_up_at || update.pickedUpAt,
        deliveredAt: update.delivered_at || update.deliveredAt
      });
      console.log(`[LAN-Sync] Updated delivery ${update.id} to ${update.status}`);
    } else {
      console.log(`[LAN-Sync] Skipped older update for ${update.id}`);
    }
  } else {
    // New delivery - upsert it
    db.upsertDeliveries([update]);
    console.log(`[LAN-Sync] Inserted new delivery ${update.id}`);
  }

  // Notify renderer to refresh
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('lan-delivery-updated', {
      deliveryId: update.id,
      status: update.status
    });
  }
}

// Merge deliveries from peer with local DB
function mergeDeliveries(deliveries) {
  for (const d of deliveries) {
    const existing = db.getDeliveryByBarcode(d.barcode);
    if (existing) {
      const existingTime = new Date(existing.updated_at || existing.updatedAt || 0).getTime();
      const incomingTime = new Date(d.updated_at || d.updatedAt || 0).getTime();
      if (incomingTime > existingTime) {
        db.updateDeliveryStatus(d.id, d.status, {
          packagedAt: d.packaged_at || d.packagedAt,
          pickedUpAt: d.picked_up_at || d.pickedUpAt,
          deliveredAt: d.delivered_at || d.deliveredAt
        });
      }
    } else {
      db.upsertDeliveries([d]);
    }
  }
}

// Periodic sync - pull from all peers every 5 seconds
let periodicSyncTimer = null;

function startPeriodicSync() {
  periodicSyncTimer = setInterval(async () => {
    for (const [ip, peer] of peers) {
      try {
        await pullDeliveriesFromPeer(ip, peer.port);
      } catch (e) {
        // Ignore errors during periodic sync
      }
    }
  }, 5000); // Every 5 seconds
}

// ==========================================
// HTTP Helpers
// ==========================================

function httpGet(url) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { timeout: 3000 }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(e);
        }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
  });
}

function httpPost(url, body) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const options = {
      hostname: urlObj.hostname,
      port: urlObj.port,
      path: urlObj.pathname,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      timeout: 3000
    };
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(e);
        }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.write(body);
    req.end();
  });
}

// ==========================================
// Public API
// ==========================================

async function start() {
  if (isRunning) return;

  myIp = getLocalIp();
  console.log(`[LAN-Sync] Starting LAN sync (IP: ${myIp})`);

  try {
    await startHttpServer();
    startDiscovery();
    startPeriodicSync();
    isRunning = true;

    sendLanStatus({
      type: 'started',
      ip: myIp,
      port: LAN_HTTP_PORT
    });

    console.log('[LAN-Sync] LAN sync started successfully');
  } catch (e) {
    console.error('[LAN-Sync] Failed to start:', e.message);
  }
}

function stop() {
  if (discoveryTimer) {
    clearInterval(discoveryTimer);
    discoveryTimer = null;
  }
  if (periodicSyncTimer) {
    clearInterval(periodicSyncTimer);
    periodicSyncTimer = null;
  }
  if (udpSocket) {
    try { udpSocket.close(); } catch (e) {}
    udpSocket = null;
  }
  if (httpServer) {
    try { httpServer.close(); } catch (e) {}
    httpServer = null;
  }
  peers.clear();
  isRunning = false;
  console.log('[LAN-Sync] Stopped');
}

function getPeers() {
  const result = [];
  for (const [ip, peer] of peers) {
    result.push({ ip, ...peer });
  }
  return result;
}

function getStatus() {
  return {
    running: isRunning,
    ip: myIp,
    port: LAN_HTTP_PORT,
    peerCount: peers.size,
    peers: getPeers()
  };
}

module.exports = {
  start,
  stop,
  setMainWindow,
  broadcastDeliveryUpdate,
  getPeers,
  getStatus
};
