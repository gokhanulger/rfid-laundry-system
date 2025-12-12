const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');

// Development or production mode
const isDev = !app.isPackaged;

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
    // DevTools disabled for production
  }

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

// Handle silent print with specific printer
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

app.whenReady().then(createWindow);

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
