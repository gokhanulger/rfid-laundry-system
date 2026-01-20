const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { exec } = require('child_process');

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
    title: 'RFID İrsaliye İstasyonu'
  });

  // Load the app - directly to irsaliye login page
  if (isDev) {
    // Development: Load from Vite dev server
    mainWindow.loadURL('http://localhost:3002/#/irsaliye-login');
    mainWindow.webContents.openDevTools();
  } else {
    // Production: Load from built files using app path
    const appPath = app.getAppPath();
    const indexPath = path.join(appPath, 'dist/index.html');
    console.log('[Irsaliye] App path:', appPath);
    console.log('[Irsaliye] Index path:', indexPath);
    console.log('[Irsaliye] File exists:', fs.existsSync(indexPath));
    mainWindow.loadFile(indexPath, { hash: '/irsaliye-login' });
    // Open DevTools to debug white screen
    mainWindow.webContents.openDevTools();
  }

  // Enable F12 to open DevTools
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.key === 'F12') {
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

// Handle irsaliye printing (205mm x 215mm for network printers like Canon GM2000)
ipcMain.handle('print-irsaliye', async (event, { html, printerName, copies }) => {
  console.log('[Print] ========== IRSALIYE PRINT START ==========');
  console.log('[Print] Printer:', printerName);
  console.log('[Print] Copies:', copies);

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
          resolve(result);
        }
      };

      const timeout = setTimeout(() => {
        safeResolve({ success: false, error: 'Print timeout' });
      }, 30000);

      const base64Html = Buffer.from(html || '<html><body>No content</body></html>').toString('base64');
      printWindow.loadURL(`data:text/html;base64,${base64Html}`);

      printWindow.webContents.on('did-finish-load', async () => {
        console.log('[Print] HTML loaded, generating PDF...');
        clearTimeout(timeout);

        await new Promise(r => setTimeout(r, 1000));

        try {
          // Generate PDF - A5 portrait (148mm x 210mm), içerik 90 derece döndürülmüş
          const pdfData = await printWindow.webContents.printToPDF({
            marginsType: 1,  // 1 = no margins (yazıcı padding'i yok)
            printBackground: true,
            pageSize: 'A5',
            landscape: false
          });

          // Save PDF to temp file
          const tempDir = app.getPath('temp');
          const pdfPath = path.join(tempDir, `irsaliye_${Date.now()}.pdf`);
          fs.writeFileSync(pdfPath, pdfData);
          console.log('[Print] PDF saved to:', pdfPath);

          if (process.platform === 'win32') {
            // Escape backslashes for network printer paths (e.g., \\TERM1\G3010)
            const escapedPrinter = printerName ? printerName.replace(/\\/g, '\\\\') : '';
            const quotedPrinter = printerName ? `"${printerName}"` : '';

            const tryPrintMethods = async () => {
              if (printerName) {
                // Method 1: Adobe Reader silent print
                try {
                  const method1Cmd = `powershell -Command "& { $reader = (Get-ItemProperty 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\AcroRd32.exe' -ErrorAction SilentlyContinue).'(default)'; if ($reader) { Start-Process $reader -ArgumentList '/t','\\"${pdfPath.replace(/\\/g, '\\\\')}\\",\\"${escapedPrinter}\\"' -Wait } else { Start-Process '${pdfPath.replace(/\\/g, '\\\\')}' -Verb PrintTo -ArgumentList '${escapedPrinter}' } }"`;
                  console.log('[Print] Trying Method 1 (Adobe/Default)...');

                  await new Promise((res, rej) => {
                    exec(method1Cmd, { timeout: 20000 }, (err) => {
                      if (err) rej(err);
                      else res();
                    });
                  });
                  console.log('[Print] Method 1 succeeded');
                  return { success: true, method: 'adobe_silent' };
                } catch (e) {
                  console.log('[Print] Method 1 failed:', e.message);
                }

                // Method 2: Set default printer and open
                try {
                  const method2Cmd = `rundll32.exe printui.dll,PrintUIEntry /y /n ${quotedPrinter}`;
                  console.log('[Print] Setting default printer...');

                  await new Promise((res) => {
                    exec(method2Cmd, { timeout: 5000 }, () => res());
                  });

                  await shell.openPath(pdfPath);
                  console.log('[Print] Method 2 triggered');
                  return { success: true, method: 'shell_default' };
                } catch (e) {
                  console.log('[Print] Method 2 failed:', e.message);
                }
              }

              // Method 3: Fallback - open PDF
              console.log('[Print] Using fallback: open PDF...');
              await shell.openPath(pdfPath);
              return { success: true, method: 'shell_manual' };
            };

            tryPrintMethods()
              .then((result) => {
                setTimeout(() => { try { fs.unlinkSync(pdfPath); } catch (e) {} }, 30000);
                console.log('[Print] ========== IRSALIYE PRINT SUCCESS ==========');
                safeResolve(result);
              })
              .catch((err) => {
                console.log('[Print] All methods failed:', err);
                shell.openPath(pdfPath);
                safeResolve({ success: true, method: 'shell_fallback' });
              });
          } else {
            shell.openPath(pdfPath);
            safeResolve({ success: true, method: 'shell' });
          }
        } catch (pdfError) {
          console.log('[Print] PDF error:', pdfError);
          safeResolve({ success: false, error: pdfError.message });
        }
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
