const { app, BrowserWindow, Menu, ipcMain } = require('electron');
const path = require('path');
const isDev = process.argv.includes('--dev');
const os = require('os');
const fs = require('fs');
const { startAdminServer, getLocalIp } = require('./server');
const RestaurantDB = require('./assets/js/db');

let mainWindow;
let adminServer = null;
let dbInstance = null;
let terminalConfig = null;

async function initializeDatabase() {
  if (!dbInstance) {
    // Database will be initialized in the app
    console.log('Database initialization deferred to app');
  }
}

function createWindow() {
  // Create the browser window
  mainWindow = new BrowserWindow({
    width: 1920,
    height: 1080,
    minWidth: 1024,
    minHeight: 768,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      enableRemoteModule: false,
      sandbox: true
    }
  });

  // Check if configuration exists
  const configPath = path.join(app.getPath('userData'), 'config', 'terminal-config.json');
  let startPage = 'terminal-config.html';
  
  if (fs.existsSync(configPath)) {
    try {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      console.log('Configuration found, loading:', config.mode);
      if (config.mode === 'admin') {
        startPage = 'admin-login.html';
      } else {
        startPage = 'login.html';
      }
    } catch (err) {
      console.error('Error reading config:', err);
      startPage = 'terminal-config.html';
    }
  } else {
    console.log('No configuration found, showing setup screen');
  }

  mainWindow.loadFile(path.join(__dirname, startPage));

  // Open DevTools in development
  if (isDev) {
    mainWindow.webContents.openDevTools();
  }

  // Handle window closed
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// App event listeners
app.on('ready', createWindow);

app.on('window-all-closed', () => {
  // On macOS, apps typically stay open until explicitly quit
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  // On macOS, re-create window when dock icon is clicked
  if (mainWindow === null) {
    createWindow();
  }
});

// Create application menu
const createMenu = () => {
  const template = [
    {
      label: 'File',
      submenu: [
        {
          label: 'Exit',
          accelerator: 'CmdOrCtrl+Q',
          click: () => {
            app.quit();
          }
        }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' }
      ]
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'About',
          click: () => {
            // You can create an about window here if desired
          }
        }
      ]
    }
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
};

app.on('ready', createMenu);
// ====== IPC HANDLERS ======

/**
 * Save terminal configuration
 */
ipcMain.handle('save-terminal-config', async (event, config) => {
  try {
    const configDir = path.join(app.getPath('userData'), 'config');
    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true });
    }

    const configPath = path.join(configDir, 'terminal-config.json');
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    
    terminalConfig = config;
    console.log('✓ Terminal configuration saved');
    
    // If admin mode, start server
    if (config.mode === 'admin') {
      await startAdminServerMode(config);
    }
    
    return { success: true };
  } catch (err) {
    console.error('Error saving terminal config:', err);
    return { success: false, error: err.message };
  }
});

/**
 * Load terminal configuration
 */
ipcMain.handle('load-terminal-config', async (event) => {
  try {
    const configPath = path.join(app.getPath('userData'), 'config', 'terminal-config.json');
    
    if (fs.existsSync(configPath)) {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      terminalConfig = config;
      return { success: true, config };
    }
    
    return { success: false, error: 'No configuration found' };
  } catch (err) {
    console.error('Error loading terminal config:', err);
    return { success: false, error: err.message };
  }
});

/**
 * Get local IP address
 */
ipcMain.handle('get-local-ip', async (event) => {
  try {
    const ip = getLocalIp();
    return { success: true, ip };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

/**
 * Get sync service status
 */
ipcMain.handle('get-sync-status', async (event) => {
  try {
    // Will be implemented when sync service is integrated
    return { success: true, status: 'ready' };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// ====== ADMIN SERVER MODE ======

async function startAdminServerMode(config) {
  console.log('\n🚀 STARTING ADMIN MODE');
  console.log('═══════════════════════════════════');
  
  try {
    // Initialize database
    if (!dbInstance) {
      dbInstance = new RestaurantDB();
      await dbInstance.initialize();
      console.log('✓ Database initialized');
    }
    
    // Start the Express server
    adminServer = await startAdminServer(dbInstance, 3000);
    
    console.log(`Mode: ADMIN`);
    console.log(`Server listening at: http://${getLocalIp()}:3000`);
    console.log('═══════════════════════════════════\n');
    
    // Send IP to renderer
    if (mainWindow) {
      mainWindow.webContents.send('admin-mode-ready', {
        serverIp: getLocalIp(),
        port: 3000,
        status: 'ready'
      });
    }
  } catch (err) {
    console.error('❌ Failed to start admin server:', err);
    if (mainWindow) {
      mainWindow.webContents.send('admin-mode-error', {
        error: err.message
      });
    }
  }
}