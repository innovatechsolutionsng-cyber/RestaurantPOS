/**
 * Admin Server Module
 * Runs on Admin machine to sync data with cashier terminals
 */

const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const mysql = require('mysql2/promise');
require('dotenv').config();

// Simple ID generator (replaces uuid to avoid ES Module issues)
function generateId() {
  return 'id_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

const JWT_EXPIRY_SECONDS = 60 * 60 * 8; // 8 hours
const DEFAULT_ALLOWED_ORIGINS = [
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'http://localhost:8080',
  'http://127.0.0.1:8080',
  'https://localhost:3000',
  'https://127.0.0.1:3000'
];
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map((origin) => origin.trim()).filter(Boolean)
  : DEFAULT_ALLOWED_ORIGINS;

function base64UrlEncode(value) {
  return Buffer.from(value)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function base64UrlDecode(value) {
  const padded = value.padEnd(value.length + ((4 - (value.length % 4)) % 4), '=');
  return Buffer.from(padded.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
}

function hashPassword(password, salt) {
  return crypto.scryptSync(String(password), salt, 64).toString('hex');
}

function hashPasswordSha256(password, salt) {
  return crypto.createHash('sha256').update(`${salt}${password}`, 'utf8').digest('hex');
}

function verifyPassword(password, salt, storedHash) {
  const candidateHash = storedHash.length === 64 ? hashPasswordSha256(password, salt) : hashPassword(password, salt);
  const candidateBuffer = Buffer.from(candidateHash, 'hex');
  const storedBuffer = Buffer.from(storedHash, 'hex');
  if (candidateBuffer.length !== storedBuffer.length) {
    return false;
  }
  return crypto.timingSafeEqual(candidateBuffer, storedBuffer);
}

function createJwtToken(payload, secret) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const body = Object.assign({}, payload, { iat: now, exp: now + JWT_EXPIRY_SECONDS });
  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(body));
  const signature = crypto
    .createHmac('sha256', secret)
    .update(`${encodedHeader}.${encodedPayload}`)
    .digest('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  return `${encodedHeader}.${encodedPayload}.${signature}`;
}

function verifyJwtToken(token, secret) {
  if (!token || !secret) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [encodedHeader, encodedPayload, signature] = parts;
  const expectedSignature = crypto
    .createHmac('sha256', secret)
    .update(`${encodedHeader}.${encodedPayload}`)
    .digest('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  const signatureBuffer = Buffer.from(signature, 'utf8');
  const expectedBuffer = Buffer.from(expectedSignature, 'utf8');
  if (signatureBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(signatureBuffer, expectedBuffer)) {
    return null;
  }
  let payload;
  try {
    payload = JSON.parse(base64UrlDecode(encodedPayload));
  } catch (err) {
    return null;
  }
  const now = Math.floor(Date.now() / 1000);
  if (!payload || typeof payload !== 'object' || payload.exp === undefined || now >= payload.exp) {
    return null;
  }
  return payload;
}

async function getConfiguredJwtSecret(connection) {
  if (process.env.JWT_SECRET && process.env.JWT_SECRET.trim()) {
    return process.env.JWT_SECRET.trim();
  }
  return await getMySQLSetting(connection, 'jwtSecret');
}

async function ensureMySQLColumn(connection, table, column, definition){
  const [rows] = await connection.query('SHOW COLUMNS FROM ?? LIKE ?', [table, column]);
  if(!rows.length){
    await connection.query(`ALTER TABLE ?? ADD COLUMN ?? ${definition}`, [table, column]);
  }
}

async function hasMySQLColumn(connection, table, column) {
  const [rows] = await connection.query('SHOW COLUMNS FROM ?? LIKE ?', [table, column]);
  return rows.length > 0;
}

async function ensureMySQLSchema(connection) {
  await connection.query(`
    CREATE TABLE IF NOT EXISTS users (
      id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      username VARCHAR(255) NOT NULL UNIQUE,
      password_hash VARCHAR(128) NOT NULL,
      password_salt VARCHAR(64) NOT NULL,
      full_name VARCHAR(255) NOT NULL,
      role VARCHAR(50) NOT NULL,
      status VARCHAR(50) NOT NULL,
      tables_assigned TEXT DEFAULT NULL,
      created_at DATETIME NOT NULL,
      updated_at DATETIME NOT NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await connection.query(`
    CREATE TABLE IF NOT EXISTS settings (
      ` + '`key` VARCHAR(255) PRIMARY KEY,' + `
      value LONGTEXT,
      updated_at DATETIME NOT NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await connection.query(`
    CREATE TABLE IF NOT EXISTS orders (
      id VARCHAR(80) PRIMARY KEY,
      terminal_id VARCHAR(255),
      order_data LONGTEXT,
      status VARCHAR(50),
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await connection.query(`
    CREATE TABLE IF NOT EXISTS cash_reports (
      id VARCHAR(80) PRIMARY KEY,
      terminal_id VARCHAR(255),
      total_cash DECIMAL(12,2),
      report_data LONGTEXT,
      timestamp DATETIME NOT NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await connection.query(`
    CREATE TABLE IF NOT EXISTS categories (
      id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      color VARCHAR(7) DEFAULT NULL,
      created_at DATETIME NOT NULL,
      updated_at DATETIME NOT NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await connection.query(`
    CREATE TABLE IF NOT EXISTS subcategories (
      id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      color VARCHAR(7) DEFAULT NULL,
      parent INT UNSIGNED NOT NULL,
      parent_category_id INT UNSIGNED DEFAULT NULL,
      created_at DATETIME NOT NULL,
      updated_at DATETIME NOT NULL,
      FOREIGN KEY (parent) REFERENCES categories(id) ON DELETE CASCADE,
      FOREIGN KEY (parent_category_id) REFERENCES categories(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await connection.query(`
    CREATE TABLE IF NOT EXISTS products (
      id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      color VARCHAR(7) DEFAULT NULL,
      price DECIMAL(12,2) DEFAULT 0,
      quantity INT DEFAULT 0,
      barcode VARCHAR(64) DEFAULT NULL,
      cat INT UNSIGNED DEFAULT NULL,
      sub INT UNSIGNED DEFAULT NULL,
      created_at DATETIME NOT NULL,
      updated_at DATETIME NOT NULL,
      FOREIGN KEY (cat) REFERENCES categories(id) ON DELETE SET NULL,
      FOREIGN KEY (sub) REFERENCES subcategories(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await connection.query(`
    CREATE TABLE IF NOT EXISTS events (
      id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      date DATE DEFAULT NULL,
      location VARCHAR(255) DEFAULT NULL,
      phone VARCHAR(64) DEFAULT NULL,
      created_at DATETIME NOT NULL,
      updated_at DATETIME NOT NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await ensureMySQLColumn(connection, 'categories', 'color', 'VARCHAR(7) DEFAULT NULL');
  await ensureMySQLColumn(connection, 'subcategories', 'color', 'VARCHAR(7) DEFAULT NULL');
  await ensureMySQLColumn(connection, 'products', 'color', 'VARCHAR(7) DEFAULT NULL');
  await ensureMySQLColumn(connection, 'products', 'cat', 'INT UNSIGNED DEFAULT NULL');
  await ensureMySQLColumn(connection, 'products', 'sub', 'INT UNSIGNED DEFAULT NULL');
  await ensureMySQLColumn(connection, 'subcategories', 'parent', 'INT UNSIGNED DEFAULT NULL');
  await ensureMySQLColumn(connection, 'subcategories', 'parent_category_id', 'INT UNSIGNED DEFAULT NULL');
  await ensureMySQLColumn(connection, 'events', 'phone', 'VARCHAR(64) DEFAULT NULL');
  await ensureMySQLColumn(connection, 'orders', 'terminal_id', 'VARCHAR(255)');
  await ensureMySQLColumn(connection, 'orders', 'order_data', 'LONGTEXT');
  await ensureMySQLColumn(connection, 'orders', 'status', 'VARCHAR(50)');
  await ensureMySQLColumn(connection, 'orders', 'created_at', 'DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP');
  await ensureMySQLColumn(connection, 'orders', 'updated_at', 'DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP');

  if (await hasMySQLColumn(connection, 'subcategories', 'parent_category_id')) {
    await connection.query('ALTER TABLE subcategories MODIFY COLUMN parent_category_id INT UNSIGNED DEFAULT NULL');
  }
  if (await hasMySQLColumn(connection, 'subcategories', 'parent')) {
    await connection.query('ALTER TABLE subcategories MODIFY COLUMN parent INT UNSIGNED DEFAULT NULL');
  }

  const hasParent = await hasMySQLColumn(connection, 'subcategories', 'parent');
  const hasParentCategoryId = await hasMySQLColumn(connection, 'subcategories', 'parent_category_id');
  if (hasParentCategoryId && !hasParent) {
    await connection.query('ALTER TABLE subcategories ADD COLUMN parent INT UNSIGNED DEFAULT NULL');
    await connection.query('UPDATE subcategories SET parent = parent_category_id WHERE parent_category_id IS NOT NULL');
  }
  if (hasParent && !hasParentCategoryId) {
    await connection.query('ALTER TABLE subcategories ADD COLUMN parent_category_id INT UNSIGNED DEFAULT NULL');
    await connection.query('UPDATE subcategories SET parent_category_id = parent WHERE parent IS NOT NULL');
  }
}

async function getMySQLSetting(connection, key) {
  const [rows] = await connection.query('SELECT value FROM settings WHERE `key` = ? LIMIT 1', [key]);
  return rows.length ? String(rows[0].value) : null;
}

async function setMySQLSetting(connection, key, value) {
  await connection.query(
    'REPLACE INTO settings (`key`, value, updated_at) VALUES (?, ?, NOW())',
    [String(key), String(value)]
  );
}

function parseBusinessDayCutoff(value) {
  if (!value || typeof value !== 'string') return null;
  const trimmed = value.trim();
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(trimmed);
  return match ? `${match[1]}:${match[2]}` : null;
}

function getBusinessDayRange(now, cutoff = '00:00') {
  const normalized = parseBusinessDayCutoff(cutoff) || '00:00';
  const [hours, minutes] = normalized.split(':').map((n) => Number(n));
  const boundary = new Date(now);
  boundary.setHours(hours, minutes, 0, 0);
  let start, end;
  if (now < boundary) {
    end = boundary;
    start = new Date(boundary);
    start.setDate(start.getDate() - 1);
  } else {
    start = boundary;
    end = new Date(boundary);
    end.setDate(end.getDate() + 1);
  }
  return { start, end };
}

async function getMySQLBusinessDayCutoff(connection) {
  const value = await getMySQLSetting(connection, 'businessDayCutoff');
  return parseBusinessDayCutoff(value) || '00:00';
}

function normalizeWaiterTables(rawTables) {
  if (!Array.isArray(rawTables)) return [];
  return rawTables
    .map((table) => String(table || '').trim())
    .filter(Boolean);
}

async function getMySQLUserByUsername(connection, username) {
  const [rows] = await connection.query(
    'SELECT *, password_hash AS hash, password_salt AS salt, tables_assigned AS tables FROM users WHERE username = ? LIMIT 1',
    [username.trim()]
  );
  if (!rows.length) return null;
  const user = rows[0];
  if (user.tables) {
    try { user.tables = JSON.parse(user.tables); } catch (err) { user.tables = []; }
  } else {
    user.tables = [];
  }
  return user;
}

async function getMySQLUserById(connection, id) {
  const [rows] = await connection.query(
    'SELECT *, password_hash AS hash, password_salt AS salt, tables_assigned AS tables FROM users WHERE id = ? LIMIT 1',
    [id]
  );
  if (!rows.length) return null;
  const user = rows[0];
  if (user.tables) {
    try { user.tables = JSON.parse(user.tables); } catch (err) { user.tables = []; }
  } else {
    user.tables = [];
  }
  return user;
}

async function createMySQLUser(connection, user) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = hashPassword(user.password, salt);
  const now = new Date();
  const tablesJson = user.tables && Array.isArray(user.tables) ? JSON.stringify(user.tables) : null;
  const [result] = await connection.query(
    'INSERT INTO users (username, password_hash, password_salt, full_name, role, status, tables_assigned, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [user.username.trim(), hash, salt, user.fullName.trim(), user.role, user.status || 'active', tablesJson, now, now]
  );
  return {
    id: result.insertId,
    username: user.username.trim(),
    role: user.role,
    status: user.status || 'active',
    fullName: user.fullName.trim(),
    createdAt: now.toISOString()
  };
}

async function updateMySQLUserPassword(connection, userId, newPassword) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = hashPassword(newPassword, salt);
  await connection.query(
    'UPDATE users SET password_hash = ?, password_salt = ?, updated_at = ? WHERE id = ?',
    [hash, salt, new Date(), userId]
  );
}

let dbPool = null; // MySQL connection pool
let connectedTerminals = new Map(); // Track connected cashiers
let useMySQL = false; // Flag to determine database backend

/**
 * Initialize MySQL connection pool
 */
async function initializeMySQL() {
  try {
    dbPool = mysql.createPool({
      host: process.env.MYSQL_HOST || 'localhost',
      port: Number(process.env.MYSQL_PORT || 3306),
      user: process.env.MYSQL_USER || 'restaurantapp',
      password: process.env.MYSQL_PASSWORD || 'app_password_2026',
      database: process.env.MYSQL_DATABASE || 'restaurant_pos',
      waitForConnections: true,
      connectionLimit: Number(process.env.MYSQL_CONNECTION_LIMIT || 10),
      queueLimit: 0,
      connectTimeout: Number(process.env.MYSQL_CONNECT_TIMEOUT || 1000)
    });

    // Test connection and ensure schema
    const connection = await dbPool.getConnection();
    await connection.ping();
    await ensureMySQLSchema(connection);
    connection.release();

    console.log('✅ Connected to MySQL database');
    useMySQL = true;
    return true;
  } catch (err) {
    console.error('❌ MySQL connection failed:', err.message);
    console.error('This installation requires MySQL. Exiting.');
    process.exit(1);
  }
}

function resolveIndexFile() {
  const candidates = [];

  if (process.env.STATIC_DIR) {
    candidates.push(path.join(__dirname, process.env.STATIC_DIR, 'index.html'));
  }

  candidates.push(path.join(__dirname, 'public', 'index.html'));
  candidates.push(path.join(__dirname, 'index.html'));

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

async function startAdminServer(port = 3000) {
  
  // Try to initialize MySQL (optional but recommended)
  await initializeMySQL().catch(() => false);
  
  const app = express();

  // Middleware
  const isAllowedOrigin = (origin) => {
    if (!origin) return true;

    const normalizedOrigin = origin.trim().toLowerCase();

    return ALLOWED_ORIGINS.some((allowedOrigin) => {
      const normalizedAllowed = allowedOrigin.trim().toLowerCase();
      if (normalizedAllowed === '*') return true;
      if (normalizedAllowed.endsWith('.*')) {
        const prefix = normalizedAllowed.slice(0, -1);
        return normalizedOrigin.startsWith(prefix);
      }
      return normalizedOrigin === normalizedAllowed;
    });
  };

  app.use(cors({
    origin: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
    maxAge: 600
  }));
  app.use(bodyParser.json({ limit: '10mb', strict: true }));
  app.use(bodyParser.urlencoded({ limit: '10mb', extended: false }));

  const publicFolder = process.env.STATIC_DIR ? path.join(__dirname, process.env.STATIC_DIR) : path.join(__dirname, 'public');
  const staticFolder = fs.existsSync(publicFolder) ? publicFolder : path.join(__dirname);
  const indexFile = resolveIndexFile();
  const fallbackHtml = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Restaurant POS</title>
  </head>
  <body>
    <h1>Restaurant POS</h1>
    <p>The application entry page is not available in this deployment.</p>
  </body>
</html>`;

  const sendIndexPage = (res) => {
    if (indexFile && fs.existsSync(indexFile) && fs.statSync(indexFile).isFile()) {
      return fs.readFile(indexFile, 'utf8', (err, html) => {
        if (err) {
          console.error('Error reading index file:', err.message);
          return res.type('html').send(fallbackHtml);
        }
        return res.type('html').send(html);
      });
    }

    return res.type('html').send(fallbackHtml);
  };

  app.use(express.static(staticFolder, { index: false }));
  if (staticFolder !== path.join(__dirname)) {
    app.use(express.static(path.join(__dirname), { index: false }));
  }

  app.get('/', (req, res) => {
    sendIndexPage(res);
  });
  app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

    // ====== ADMIN AUTH & USER MANAGEMENT ======

    app.post('/api/admin/setup', async (req, res) => {
      try {
        const { username, fullName, password, jwtSecret } = req.body || {};
        if (!username || !password) {
          return res.status(400).json({ success: false, error: 'missing_fields' });
        }

        if (!useMySQL || !dbPool) {
          return res.status(500).json({ success: false, error: 'database_unavailable' });
        }

        const connection = await dbPool.getConnection();
        try {
          const [admins] = await connection.query('SELECT id FROM users WHERE role = ? LIMIT 1', ['admin']);
          if (admins.length > 0) {
            return res.status(409).json({ success: false, error: 'admin_exists' });
          }
          await createMySQLUser(connection, {
            username,
            password,
            role: 'admin',
            fullName: (fullName && fullName.trim()) ? fullName.trim() : username.trim(),
            status: 'active'
          });
          if (jwtSecret && jwtSecret.trim()) {
            await setMySQLSetting(connection, 'jwtSecret', jwtSecret.trim());
          }
        } finally {
          connection.release();
        }

        res.json({ success: true, message: 'Admin account created' });
      } catch (err) {
        console.error('Error creating admin account:', err);
        res.status(500).json({ success: false, error: err.message });
      }
    });

    app.post('/api/auth/login', async (req, res) => {
      try {
        const { username, password } = req.body || {};
        if (!username || !password) {
          return res.status(400).json({ success: false, error: 'missing_credentials' });
        }

        let user = null;
        let secret = null;

        if (!useMySQL || !dbPool) {
          return res.status(500).json({ success: false, error: 'database_unavailable' });
        }
        const connection = await dbPool.getConnection();
        try {
          user = await getMySQLUserByUsername(connection, username);
          secret = await getConfiguredJwtSecret(connection);
        } finally {
          connection.release();
        }

        if (!user) {
          return res.status(401).json({ success: false, error: 'invalid_credentials' });
        }

        if (!verifyPassword(password, user.salt, user.hash)) {
          return res.status(401).json({ success: false, error: 'invalid_credentials' });
        }

        const sessionUser = {
          id: user.id,
          username: user.username,
          role: user.role,
          fullName: user.full_name || user.fullName || user.username,
          status: user.status
        };

        const token = secret ? createJwtToken(sessionUser, secret) : null;

        res.json({ success: true, user: sessionUser, token });
      } catch (err) {
        console.error('Login error:', err);
        res.status(500).json({ success: false, error: err.message });
      }
    });

    app.post('/api/auth/change-password', async (req, res) => {
      try {
        const { username, currentPassword, newPassword } = req.body || {};
        if (!username || !currentPassword || !newPassword) {
          return res.status(400).json({ success: false, error: 'missing_fields' });
        }

        let user = null;

        if (!useMySQL || !dbPool) { return res.status(500).json({ success: false, error: 'database_unavailable' }); }
          const connection = await dbPool.getConnection();
          try {
            user = await getMySQLUserByUsername(connection, username);
            if (!user) {
              return res.status(404).json({ success: false, error: 'no_user' });
            }
            if (!verifyPassword(currentPassword, user.salt, user.hash)) {
              return res.status(401).json({ success: false, error: 'invalid_current_password' });
            }
            await updateMySQLUserPassword(connection, user.id, newPassword);
          } finally {
            connection.release();
          }

        res.json({ success: true, message: 'Password changed' });
      } catch (err) {
        console.error('Change password error:', err);
        res.status(500).json({ success: false, error: err.message });
      }
    });

    app.post('/api/users/create', async (req, res) => {
      try {
        const { username, password, role, fullName, status, tables } = req.body || {};
        if (!username || !password || !role) {
          return res.status(400).json({ success: false, error: 'missing_fields' });
        }

        const normalizedRole = String(role).trim() || 'cashier';
        const normalizedFullName = (fullName && fullName.trim()) ? fullName.trim() : username.trim();
        const normalizedStatus = (status && status.trim()) || 'active';
        const normalizedTables = normalizeWaiterTables(tables);

        if (!useMySQL || !dbPool) { return res.status(500).json({ success: false, error: 'database_unavailable' }); }
          const connection = await dbPool.getConnection();
          try {
            const existing = await getMySQLUserByUsername(connection, username);
            if (existing) {
              return res.status(409).json({ success: false, error: 'username_exists' });
            }
            if (normalizedRole === 'waiter' && normalizedTables.length) {
              const [rows] = await connection.query(
                'SELECT id, username, role, full_name, tables_assigned AS tables FROM users WHERE role = ?',
                ['waiter']
              );
              const assignedTables = new Map();
              rows.forEach((row) => {
                let currentTables = [];
                if (row.tables) {
                  try { currentTables = JSON.parse(row.tables); } catch (err) { currentTables = []; }
                }
                currentTables = normalizeWaiterTables(currentTables);
                currentTables.forEach((table) => {
                  if (table) assignedTables.set(table, row.username || row.full_name || 'unknown');
                });
              });
              const conflicts = normalizedTables.filter((table) => assignedTables.has(table));
              if (conflicts.length) {
                return res.status(409).json({ success: false, error: 'tables_conflict', conflictTables: conflicts });
              }
            }
            const created = await createMySQLUser(connection, {
              username,
              password,
              role: normalizedRole,
              fullName: normalizedFullName,
              status: normalizedStatus,
              tables: normalizedRole === 'waiter' ? normalizedTables : []
            });
            return res.json({ success: true, user: created });
          } finally {
            connection.release();
          }
      } catch (err) {
        console.error('Create user error:', err);
        res.status(500).json({ success: false, error: err.message });
      }
    });

    app.post('/api/users/update', async (req, res) => {
      try {
        const { id, username, role, fullName, status, tables } = req.body || {};
        if (!id || !username || !role) {
          return res.status(400).json({ success: false, error: 'missing_fields' });
        }

        const normalizedFullName = (fullName && fullName.trim()) ? fullName.trim() : username.trim();
        const normalizedStatus = (status && status.trim()) || 'active';
        const normalizedTables = normalizeWaiterTables(tables);

        if (!useMySQL || !dbPool) { return res.status(500).json({ success: false, error: 'database_unavailable' }); }
          const connection = await dbPool.getConnection();
          try {
            const existing = await getMySQLUserById(connection, id);
            if (!existing) {
              return res.status(404).json({ success: false, error: 'no_user' });
            }
            if (role === 'waiter' && normalizedTables.length) {
              const [rows] = await connection.query(
                'SELECT id, username, role, full_name, tables_assigned AS tables FROM users WHERE role = ? AND id != ?',
                ['waiter', id]
              );
              const assignedTables = new Map();
              rows.forEach((row) => {
                let currentTables = [];
                if (row.tables) {
                  try { currentTables = JSON.parse(row.tables); } catch (err) { currentTables = []; }
                }
                currentTables = normalizeWaiterTables(currentTables);
                currentTables.forEach((table) => {
                  if (table) assignedTables.set(table, row.username || row.full_name || 'unknown');
                });
              });
              const conflicts = normalizedTables.filter((table) => assignedTables.has(table));
              if (conflicts.length) {
                return res.status(409).json({ success: false, error: 'tables_conflict', conflictTables: conflicts });
              }
            }
            await connection.query(
              'UPDATE users SET username = ?, full_name = ?, role = ?, status = ?, tables_assigned = ?, updated_at = ? WHERE id = ?',
              [username.trim(), normalizedFullName, role, normalizedStatus, JSON.stringify(role === 'waiter' ? normalizedTables : []), new Date(), id]
            );

            return res.json({ success: true, user: { id, username: username.trim(), role, status: normalizedStatus, fullName: normalizedFullName, tables: role === 'waiter' ? normalizedTables : [] } });
          } finally {
            connection.release();
          }
      } catch (err) {
        console.error('Update user error:', err);
        res.status(500).json({ success: false, error: err.message });
      }
    });

    app.post('/api/users/delete', async (req, res) => {
      try {
        const { id } = req.body || {};
        if (!id) {
          return res.status(400).json({ success: false, error: 'missing_id' });
        }

        if (!useMySQL || !dbPool) { return res.status(500).json({ success: false, error: 'database_unavailable' }); }
          const connection = await dbPool.getConnection();
          try {
            await connection.query('DELETE FROM users WHERE id = ?', [id]);
            return res.json({ success: true });
          } finally {
            connection.release();
          }
      } catch (err) {
        console.error('Delete user error:', err);
        res.status(500).json({ success: false, error: err.message });
      }
    });

    app.get('/api/users/list', async (req, res) => {
      try {
        let safeUsers = [];

        if (!useMySQL || !dbPool) { return res.status(500).json({ success: false, error: 'database_unavailable' }); }
          const connection = await dbPool.getConnection();
          try {
            const [rows] = await connection.query('SELECT id, username, role, status, full_name, tables_assigned AS tables FROM users');
            safeUsers = rows.map(row => {
              let tables = [];
              if (row.tables) {
                try { tables = JSON.parse(row.tables); } catch (err) { tables = []; }
              }
              return { id: row.id, username: row.username, role: row.role, status: row.status, fullName: row.full_name, tables };
            });
          } finally {
            connection.release();
          }

        res.json({ success: true, users: safeUsers, count: safeUsers.length });
      } catch (err) {
        console.error('List users error:', err);
        res.status(500).json({ success: false, error: err.message });
      }
    });

    app.get('/api/users/:id', async (req, res) => {
      try {
        const userId = req.params.id;
        if (!userId) {
          return res.status(400).json({ success: false, error: 'missing_id' });
        }

        if (!useMySQL || !dbPool) { return res.status(500).json({ success: false, error: 'database_unavailable' }); }
          const connection = await dbPool.getConnection();
          try {
            const [rows] = await connection.query('SELECT id, username, role, status, full_name, tables_assigned AS tables FROM users WHERE id = ? LIMIT 1', [userId]);
            if (!rows.length) {
              return res.status(404).json({ success: false, error: 'no_user' });
            }
            const row = rows[0];
            let tables = [];
            if (row.tables) {
              try { tables = JSON.parse(row.tables); } catch (err) { tables = []; }
            }
            return res.json({ success: true, user: { id: row.id, username: row.username, role: row.role, status: row.status, fullName: row.full_name, tables } });
          } finally {
            connection.release();
          }
      } catch (err) {
        console.error('Get user error:', err);
        res.status(500).json({ success: false, error: err.message });
      }
    });

    // ====== INVENTORY ======

    app.get('/api/categories', async (req, res) => {
      try {
        if (!useMySQL || !dbPool) { return res.status(500).json({ success: false, error: 'database_unavailable' }); }
          const connection = await dbPool.getConnection();
          try {
            const [rows] = await connection.query('SELECT id, name, color, created_at AS createdAt, updated_at AS updatedAt FROM categories ORDER BY name ASC');
            return res.json({ success: true, categories: rows });
          } finally {
            connection.release();
          }
      } catch (err) {
        console.error('Error fetching categories:', err);
        res.status(500).json({ success: false, error: err.message });
      }
    });

    app.post('/api/categories/save', async (req, res) => {
      try {
        const { id, name, color } = req.body || {};
        if (!name) {
          return res.status(400).json({ success: false, error: 'missing_fields' });
        }
        const colorValue = color ? String(color).trim() : null;

        if (!useMySQL || !dbPool) { return res.status(500).json({ success: false, error: 'database_unavailable' }); }
          const connection = await dbPool.getConnection();
          try {
            const now = new Date();
            if (id) {
              await connection.query('UPDATE categories SET name = ?, color = ?, updated_at = ? WHERE id = ?', [name.trim(), colorValue, now, id]);
              return res.json({ success: true, category: { id, name: name.trim(), color: colorValue, updatedAt: now.toISOString() } });
            }
            const [result] = await connection.query('INSERT INTO categories (name, color, created_at, updated_at) VALUES (?, ?, ?, ?)', [name.trim(), colorValue, now, now]);
            return res.json({ success: true, category: { id: result.insertId, name: name.trim(), color: colorValue, createdAt: now.toISOString(), updatedAt: now.toISOString() } });
          } finally {
            connection.release();
          }


        res.status(500).json({ success: false, error: 'database_unavailable' });
      } catch (err) {
        console.error('Error saving category:', err);
        res.status(500).json({ success: false, error: err.message });
      }
    });

    app.post('/api/categories/delete', async (req, res) => {
      try {
        const { id } = req.body || {};
        if (!id) {
          return res.status(400).json({ success: false, error: 'missing_id' });
        }

        if (!useMySQL || !dbPool) { return res.status(500).json({ success: false, error: 'database_unavailable' }); }
          const connection = await dbPool.getConnection();
          try {
            await connection.query('DELETE FROM categories WHERE id = ?', [id]);
            return res.json({ success: true });
          } finally {
            connection.release();
          }


        res.status(500).json({ success: false, error: 'database_unavailable' });
      } catch (err) {
        console.error('Error deleting category:', err);
        res.status(500).json({ success: false, error: err.message });
      }
    });

    app.get('/api/subcategories', async (req, res) => {
      try {
        if (!useMySQL || !dbPool) { return res.status(500).json({ success: false, error: 'database_unavailable' }); }
          const connection = await dbPool.getConnection();
          try {
            const [rows] = await connection.query('SELECT id, name, color, parent, created_at AS createdAt, updated_at AS updatedAt FROM subcategories ORDER BY name ASC');
            return res.json({ success: true, subcategories: rows });
          } finally {
            connection.release();
          }
      } catch (err) {
        console.error('Error fetching subcategories:', err);
        res.status(500).json({ success: false, error: err.message });
      }
    });

    app.post('/api/subcategories/save', async (req, res) => {
      try {
        const { id, name, parent, color } = req.body || {};
        if (!name || !parent) {
          return res.status(400).json({ success: false, error: 'missing_fields' });
        }
        const colorValue = color ? String(color).trim() : null;

        if (!useMySQL || !dbPool) { return res.status(500).json({ success: false, error: 'database_unavailable' }); }
          const connection = await dbPool.getConnection();
          try {
            const now = new Date();
            if (id) {
              await connection.query('UPDATE subcategories SET name = ?, color = ?, parent = ?, updated_at = ? WHERE id = ?', [name.trim(), colorValue, parent, now, id]);
              return res.json({ success: true, subcategory: { id, name: name.trim(), color: colorValue, parent, updatedAt: now.toISOString() } });
            }
            const [result] = await connection.query('INSERT INTO subcategories (name, color, parent, created_at, updated_at) VALUES (?, ?, ?, ?, ?)', [name.trim(), colorValue, parent, now, now]);
            return res.json({ success: true, subcategory: { id: result.insertId, name: name.trim(), color: colorValue, parent, createdAt: now.toISOString(), updatedAt: now.toISOString() } });
          } finally {
            connection.release();
          }


        res.status(500).json({ success: false, error: 'database_unavailable' });
      } catch (err) {
        console.error('Error saving subcategory:', err);
        res.status(500).json({ success: false, error: err.message });
      }
    });

    app.post('/api/subcategories/delete', async (req, res) => {
      try {
        const { id } = req.body || {};
        if (!id) {
          return res.status(400).json({ success: false, error: 'missing_id' });
        }

        if (!useMySQL || !dbPool) { return res.status(500).json({ success: false, error: 'database_unavailable' }); }
          const connection = await dbPool.getConnection();
          try {
            await connection.query('DELETE FROM subcategories WHERE id = ?', [id]);
            return res.json({ success: true });
          } finally {
            connection.release();
          }


        res.status(500).json({ success: false, error: 'database_unavailable' });
      } catch (err) {
        console.error('Error deleting subcategory:', err);
        res.status(500).json({ success: false, error: err.message });
      }
    });

    app.get('/api/products', async (req, res) => {
      try {
        if (!useMySQL || !dbPool) { return res.status(500).json({ success: false, error: 'database_unavailable' }); }
          const connection = await dbPool.getConnection();
          try {
            const [rows] = await connection.query('SELECT id, name, color, price, quantity, barcode, cat, sub, created_at AS createdAt, updated_at AS updatedAt FROM products ORDER BY name ASC');
            return res.json({ success: true, products: rows });
          } finally {
            connection.release();
          }
      } catch (err) {
        console.error('Error fetching products:', err);
        res.status(500).json({ success: false, error: err.message });
      }
    });

    app.post('/api/products/save', async (req, res) => {
      try {
        const { id, name, price, quantity, barcode, cat, sub, color } = req.body || {};
        if (!name) {
          return res.status(400).json({ success: false, error: 'missing_fields' });
        }
        const colorValue = color ? String(color).trim() : null;
        const parsedPrice = price !== undefined && price !== null ? Number(price) : 0;
        const parsedQuantity = quantity !== undefined && quantity !== null ? Number(quantity) : 0;

        if (!useMySQL || !dbPool) { return res.status(500).json({ success: false, error: 'database_unavailable' }); }
          const connection = await dbPool.getConnection();
          try {
            const now = new Date();
            if (id) {
              await connection.query('UPDATE products SET name = ?, color = ?, price = ?, quantity = ?, barcode = ?, cat = ?, sub = ?, updated_at = ? WHERE id = ?', [name.trim(), colorValue, parsedPrice, parsedQuantity, barcode || null, cat || null, sub || null, now, id]);
              return res.json({ success: true, product: { id, name: name.trim(), color: colorValue, price: parsedPrice, quantity: parsedQuantity, barcode: barcode || null, cat: cat || null, sub: sub || null, updatedAt: now.toISOString() } });
            }
            const [result] = await connection.query('INSERT INTO products (name, color, price, quantity, barcode, cat, sub, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', [name.trim(), colorValue, parsedPrice, parsedQuantity, barcode || null, cat || null, sub || null, now, now]);
            return res.json({ success: true, product: { id: result.insertId, name: name.trim(), color: colorValue, price: parsedPrice, quantity: parsedQuantity, barcode: barcode || null, cat: cat || null, sub: sub || null, createdAt: now.toISOString(), updatedAt: now.toISOString() } });
          } finally {
            connection.release();
          }


        res.status(500).json({ success: false, error: 'database_unavailable' });
      } catch (err) {
        console.error('Error saving product:', err);
        res.status(500).json({ success: false, error: err.message });
      }
    });

    app.post('/api/products/delete', async (req, res) => {
      try {
        const { id } = req.body || {};
        if (!id) {
          return res.status(400).json({ success: false, error: 'missing_id' });
        }

        if (!useMySQL || !dbPool) { return res.status(500).json({ success: false, error: 'database_unavailable' }); }
          const connection = await dbPool.getConnection();
          try {
            await connection.query('DELETE FROM products WHERE id = ?', [id]);
            return res.json({ success: true });
          } finally {
            connection.release();
          }


        res.status(500).json({ success: false, error: 'database_unavailable' });
      } catch (err) {
        console.error('Error deleting product:', err);
        res.status(500).json({ success: false, error: err.message });
      }
    });

    app.get('/api/events', async (req, res) => {
      try {
        if (!useMySQL || !dbPool) { return res.status(500).json({ success: false, error: 'database_unavailable' }); }
          const connection = await dbPool.getConnection();
          try {
            const [rows] = await connection.query('SELECT id, name, date, location, phone, created_at AS createdAt, updated_at AS updatedAt FROM events ORDER BY created_at DESC');
            return res.json({ success: true, events: rows });
          } finally {
            connection.release();
          }
      } catch (err) {
        console.error('Error fetching events:', err);
        res.status(500).json({ success: false, error: err.message });
      }
    });

    app.post('/api/events/save', async (req, res) => {
      try {
        const { id, name, date, location, phone } = req.body || {};
        if (!name) {
          return res.status(400).json({ success: false, error: 'missing_fields' });
        }

        if (!useMySQL || !dbPool) { return res.status(500).json({ success: false, error: 'database_unavailable' }); }
          const connection = await dbPool.getConnection();
          try {
            const now = new Date();
            if (id) {
              await connection.query('UPDATE events SET name = ?, date = ?, location = ?, phone = ?, updated_at = ? WHERE id = ?', [name.trim(), date || null, location || null, phone || null, now, id]);
              return res.json({ success: true, event: { id, name: name.trim(), date, location, phone, updatedAt: now.toISOString() } });
            }
            const [result] = await connection.query('INSERT INTO events (name, date, location, phone, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)', [name.trim(), date || null, location || null, phone || null, now, now]);
            return res.json({ success: true, event: { id: result.insertId, name: name.trim(), date, location, phone, createdAt: now.toISOString(), updatedAt: now.toISOString() } });
          } finally {
            connection.release();
          }


        res.status(500).json({ success: false, error: 'database_unavailable' });
      } catch (err) {
        console.error('Error saving event:', err);
        res.status(500).json({ success: false, error: err.message });
      }
    });

    app.post('/api/events/delete', async (req, res) => {
      try {
        const { id } = req.body || {};
        if (!id) {
          return res.status(400).json({ success: false, error: 'missing_id' });
        }

        if (!useMySQL || !dbPool) { return res.status(500).json({ success: false, error: 'database_unavailable' }); }
          const connection = await dbPool.getConnection();
          try {
            await connection.query('DELETE FROM events WHERE id = ?', [id]);
            return res.json({ success: true });
          } finally {
            connection.release();
          }


        res.status(500).json({ success: false, error: 'database_unavailable' });
      } catch (err) {
        console.error('Error deleting event:', err);
        res.status(500).json({ success: false, error: err.message });
      }
    });

    app.post('/api/orders/delete', async (req, res) => {
      try {
        const { id } = req.body || {};
        if (!id) {
          return res.status(400).json({ success: false, error: 'missing_id' });
        }

        if (!useMySQL || !dbPool) { return res.status(500).json({ success: false, error: 'database_unavailable' }); }
          const connection = await dbPool.getConnection();
          try {
            await connection.query('DELETE FROM orders WHERE id = ?', [id]);
            return res.json({ success: true });
          } finally {
            connection.release();
          }


        res.status(500).json({ success: false, error: 'database_unavailable' });
      } catch (err) {
        console.error('Error deleting order:', err);
        res.status(500).json({ success: false, error: err.message });
      }
    });

  /**
   * POST /api/terminals/register
   * Cashier registers with admin on startup
   */
  app.post('/api/terminals/register', async (req, res) => {
    try {
      const { terminalId, terminalName, terminalType } = req.body;
      const clientIp = req.ip || req.connection.remoteAddress;
      
      const terminal = {
        terminalId,
        terminalName,
        terminalType, // 'cashier' or 'admin'
        ipAddress: clientIp,
        lastSeen: new Date().toISOString(),
        status: 'connected'
      };

      connectedTerminals.set(terminalId, terminal);
      
      console.log(`✓ Terminal registered: ${terminalName} (${terminalId}) from ${clientIp}`);
      
      res.json({
        success: true,
        message: 'Terminal registered',
        adminId: 'admin-main',
        timestamp: new Date().toISOString()
      });
    } catch (err) {
      console.error('Error registering terminal:', err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  /**
   * GET /api/terminals/list
   * Get all connected terminals
   */
  app.get('/api/terminals/list', (req, res) => {
    try {
      const terminals = Array.from(connectedTerminals.values());
      res.json({
        success: true,
        terminals: terminals,
        count: terminals.length
      });
    } catch (err) {
      console.error('Error fetching terminals:', err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ====== SETTINGS ENDPOINTS ======

  app.get('/api/settings/tax', async (req, res) => {
    try {
      const key = 'tax';
      if (!useMySQL || !dbPool) { return res.status(500).json({ success: false, error: 'database_unavailable' }); }
        const connection = await dbPool.getConnection();
        try {
          const value = await getMySQLSetting(connection, key);
          return res.json({ success: true, value: value });
        } finally {
          connection.release();
        }
      
      res.status(500).json({ success: false, error: 'database_unavailable' });
    } catch (err) {
      console.error('Error fetching tax setting:', err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.get('/api/settings/service-charge', async (req, res) => {
    try {
      const key = 'service-charge';
      if (!useMySQL || !dbPool) { return res.status(500).json({ success: false, error: 'database_unavailable' }); }
        const connection = await dbPool.getConnection();
        try {
          const value = await getMySQLSetting(connection, key);
          return res.json({ success: true, value: value });
        } finally {
          connection.release();
        }
      
      res.status(500).json({ success: false, error: 'database_unavailable' });
    } catch (err) {
      console.error('Error fetching service-charge setting:', err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.get('/api/settings/discount', async (req, res) => {
    try {
      const key = 'discount';
      if (!useMySQL || !dbPool) { return res.status(500).json({ success: false, error: 'database_unavailable' }); }
        const connection = await dbPool.getConnection();
        try {
          const value = await getMySQLSetting(connection, key);
          return res.json({ success: true, value: value });
        } finally {
          connection.release();
        }
      
      res.status(500).json({ success: false, error: 'database_unavailable' });
    } catch (err) {
      console.error('Error fetching discount setting:', err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.get('/api/settings/terminal-config', async (req, res) => {
    try {
      const key = 'terminal-config';
      if (!useMySQL || !dbPool) { return res.status(500).json({ success: false, error: 'database_unavailable' }); }
        const connection = await dbPool.getConnection();
        try {
          const value = await getMySQLSetting(connection, key);
          let config = null;
          if (value) {
            try { config = JSON.parse(value); } catch (e) { config = null; }
          }
          return res.json({ success: true, config: config });
        } finally {
          connection.release();
        }
      
      res.status(500).json({ success: false, error: 'database_unavailable' });
    } catch (err) {
      console.error('Error fetching terminal-config setting:', err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.get('/api/settings/business-day', async (req, res) => {
    try {
      if (!useMySQL || !dbPool) { return res.status(500).json({ success: false, error: 'database_unavailable' }); }
      const connection = await dbPool.getConnection();
      try {
        const cutoff = await getMySQLBusinessDayCutoff(connection);
        return res.json({ success: true, value: cutoff });
      } finally {
        connection.release();
      }
    } catch (err) {
      console.error('Error fetching business-day setting:', err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.post('/api/settings/business-day', async (req, res) => {
    try {
      const cutoff = req.body && typeof req.body.cutoff === 'string' ? req.body.cutoff.trim() : null;
      const parsedCutoff = parseBusinessDayCutoff(cutoff);
      if (!parsedCutoff) {
        return res.status(400).json({ success: false, error: 'invalid_business_day_cutoff', message: 'Business day cutoff must be a valid time in HH:mm format.' });
      }
      if (!useMySQL || !dbPool) { return res.status(500).json({ success: false, error: 'database_unavailable' }); }
      const connection = await dbPool.getConnection();
      try {
        await setMySQLSetting(connection, 'businessDayCutoff', parsedCutoff);
        return res.json({ success: true, value: parsedCutoff });
      } finally {
        connection.release();
      }
    } catch (err) {
      console.error('Error saving business-day setting:', err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.get('/api/settings/receipt-details', async (req, res) => {
    try {
      if (!useMySQL || !dbPool) { return res.status(500).json({ success: false, error: 'database_unavailable' }); }
      const connection = await dbPool.getConnection();
      try {
        const rawValue = await getMySQLSetting(connection, 'receiptDetails');
        let config = {};
        if (rawValue) {
          try { config = JSON.parse(rawValue); } catch (parseErr) { config = {}; }
        }
        return res.json({ success: true, config });
      } finally {
        connection.release();
      }
    } catch (err) {
      console.error('Error fetching receipt details setting:', err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.post('/api/settings/receipt-details', async (req, res) => {
    try {
      const payload = req.body || {};
      const config = {
        businessName: String(payload.businessName || '').trim(),
        address: String(payload.address || '').trim(),
        phone: String(payload.phone || '').trim(),
        email: String(payload.email || '').trim(),
        footerMessage: String(payload.footerMessage || '').trim()
      };
      if (!useMySQL || !dbPool) { return res.status(500).json({ success: false, error: 'database_unavailable' }); }
      const connection = await dbPool.getConnection();
      try {
        await setMySQLSetting(connection, 'receiptDetails', JSON.stringify(config));
        return res.json({ success: true, config });
      } finally {
        connection.release();
      }
    } catch (err) {
      console.error('Error saving receipt details setting:', err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ====== ORDER SYNC ======

  /**
   * POST /api/orders/sync
   * Cashier sends new/updated orders to admin
   */
  app.post('/api/orders/sync', async (req, res) => {
    try {
      const { terminalId, orders, lastSyncTime } = req.body;

      if (!useMySQL || !dbPool) { return res.status(500).json({ success: false, error: 'database_unavailable' }); }
        // MySQL version
        const connection = await dbPool.getConnection();
        try {
          // Detect whether the `orders.id` column is integer (auto-increment) or varchar
          let ordersIdIsInteger = false;
          try {
            const [cols] = await connection.query("SHOW COLUMNS FROM orders LIKE 'id'");
            if (cols && cols.length && cols[0] && cols[0].Type) {
              const t = String(cols[0].Type).toLowerCase();
              if (t.indexOf('int') !== -1) ordersIdIsInteger = true;
            }
          } catch (colErr) {
            // ignore and assume non-integer id
          }

          for (const order of orders) {
            // Normalize undefined-like ids
            if (order && (typeof order.id === 'undefined' || order.id === null || String(order.id).trim().toLowerCase() === 'undefined' || String(order.id).trim() === '')) {
              order.id = null;
            }

            // Try to find existing record by id if present
            let existing = [];
            if (order && order.id != null) {
              const [ex] = await connection.query('SELECT id FROM orders WHERE id = ?', [order.id]);
              existing = ex;

              // If not found and DB uses integer id but incoming order.id is a string
              // the original order may have been stored with that string inside order_data.id
              if ((!existing || existing.length === 0) && ordersIdIsInteger && String(order.id).trim() !== '') {
                try {
                  const [rowsForTerminalInternal] = await connection.query('SELECT id, order_data FROM orders WHERE terminal_id = ?', [terminalId]);
                  if (rowsForTerminalInternal && rowsForTerminalInternal.length > 0) {
                    for (const r of rowsForTerminalInternal) {
                      try {
                        const od = JSON.parse(r.order_data);
                        if (od && String(od.id) === String(order.id)) {
                          existing = [{ id: r.id }];
                          break;
                        }
                      } catch (e) {
                        // ignore parse errors
                      }
                    }
                  }
                } catch (internalErr) {
                  // ignore
                }
              }
            }

            if (!existing || existing.length === 0) {
              // Try to detect an existing order by tableName + terminalId to avoid duplicates
              let foundMatch = null;
              try {
                const tableName = order && order.tableName ? String(order.tableName) : null;
                if (tableName) {
                  const tableNameNormalized = String(tableName).trim().toLowerCase();
                  const [rowsForTerminal] = await connection.query('SELECT id, order_data FROM orders WHERE terminal_id = ?', [terminalId]);
                  if (rowsForTerminal && rowsForTerminal.length > 0) {
                    for (const r of rowsForTerminal) {
                      try {
                        const od = JSON.parse(r.order_data);
                        const otherName = od && od.tableName ? String(od.tableName).trim().toLowerCase() : '';
                        console.log('Order sync: comparing', { terminalId, tableNameNormalized, dbId: r.id, dbTableName: otherName });
                        if (otherName && otherName === tableNameNormalized) {
                          foundMatch = { id: r.id, order_data: r.order_data };
                          break;
                        }
                      } catch (e) {
                        // ignore parse errors
                      }
                    }
                  }
                }
              } catch (matchErr) {
                // ignore matching errors and proceed to insert
              }

              if (foundMatch) {
                // Update the matched order instead of inserting a duplicate
                const existingId = foundMatch.id;
                await connection.query(
                  'UPDATE orders SET order_data = ?, status = ?, updated_at = NOW() WHERE id = ?',
                  [JSON.stringify(order), order.status || 'pending', existingId]
                );
                order.id = existingId;
              } else {
                if (ordersIdIsInteger) {
                  // DB expects integer id -> insert without id to let auto-increment assign
                  const [insRes] = await connection.query(
                    'INSERT INTO orders (terminal_id, order_data, status, created_at, updated_at) VALUES (?, ?, ?, NOW(), NOW())',
                    [terminalId, JSON.stringify(order), order.status || 'pending']
                  );
                  const newId = insRes && insRes.insertId ? insRes.insertId : null;
                  if (newId) {
                    order.id = Number(newId);
                    // Backfill the generated id into stored JSON
                    await connection.query('UPDATE orders SET order_data = ? WHERE id = ?', [JSON.stringify(order), newId]);
                  }
                } else {
                  const safeId = order && order.id ? String(order.id) : generateId();
                  order.id = safeId;
                  try {
                    await connection.query(
                      'INSERT INTO orders (id, terminal_id, order_data, status, created_at, updated_at) VALUES (?, ?, ?, ?, NOW(), NOW())',
                      [safeId, terminalId, JSON.stringify(order), order.status || 'pending']
                    );
                  } catch (insErr) {
                    // If insertion failed because DB id is actually integer, retry insert without id and backfill
                    if (insErr && (insErr.code === 'ER_TRUNCATED_WRONG_VALUE_FOR_FIELD' || insErr.errno === 1366)) {
                      const [insRes] = await connection.query(
                        'INSERT INTO orders (terminal_id, order_data, status, created_at, updated_at) VALUES (?, ?, ?, NOW(), NOW())',
                        [terminalId, JSON.stringify(order), order.status || 'pending']
                      );
                      const newId = insRes && insRes.insertId ? insRes.insertId : null;
                      if (newId) {
                        order.id = Number(newId);
                        await connection.query('UPDATE orders SET order_data = ? WHERE id = ?', [JSON.stringify(order), newId]);
                      }
                    } else {
                      throw insErr;
                    }
                  }
                }
              }
            } else {
              const existingId = existing[0].id;
              await connection.query(
                'UPDATE orders SET order_data = ?, status = ?, updated_at = NOW() WHERE id = ?',
                [JSON.stringify(order), order.status || 'pending', existingId]
              );
            }
          }

          // Get updated orders since last sync
          // Deduplicate any orders that share terminal_id + tableName (keep newest)
          try {
            // Delete older duplicate orders that share terminal_id, tableName, and splitReference, keeping the most recent
            await connection.query(
              `DELETE o1 FROM orders o1
               JOIN orders o2 ON o1.terminal_id = o2.terminal_id
               AND JSON_UNQUOTE(JSON_EXTRACT(o1.order_data, '$.tableName')) = JSON_UNQUOTE(JSON_EXTRACT(o2.order_data, '$.tableName'))
               AND JSON_UNQUOTE(JSON_EXTRACT(o1.order_data, '$.splitReference')) = JSON_UNQUOTE(JSON_EXTRACT(o2.order_data, '$.splitReference'))
               AND o1.updated_at < o2.updated_at`
            );
          } catch (dedupeErr) {
            // ignore dedupe errors
          }

          const [allOrders] = await connection.query(
            'SELECT order_data FROM orders WHERE updated_at > ?',
            [new Date(lastSyncTime)]
          );

          const updatedOrders = allOrders.map(row => JSON.parse(row.order_data));

          res.json({
            success: true,
            synced: orders.length,
            updates: updatedOrders,
            timestamp: new Date().toISOString()
          });
        } finally {
          connection.release();
        }

    } catch (err) {
      console.error('Error in order sync endpoint:', err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  /**
   * GET /api/orders/all
   * Get all orders from admin database
   */
  app.get('/api/orders/all', async (req, res) => {
    try {
      if (!useMySQL || !dbPool) { return res.status(500).json({ success: false, error: 'database_unavailable' }); }
        const waiterNameQuery = req.query.waiterName ? String(req.query.waiterName).trim().toLowerCase() : null;
        const connection = await dbPool.getConnection();
        try {
          const [rows] = await connection.query('SELECT order_data, created_at, updated_at FROM orders');
          const orders = [];
          for (const row of rows) {
            let order = {};
            try {
              order = JSON.parse(row.order_data);
            } catch (err) {
              order = {};
            }
            if (!order.createdAt && row.created_at) {
              const createdAt = row.created_at instanceof Date ? row.created_at.toISOString() : new Date(row.created_at).toISOString();
              if (!Number.isNaN(new Date(createdAt).getTime())) {
                order.createdAt = createdAt;
              }
            }
            if (!order.updatedAt && row.updated_at) {
              const updatedAt = row.updated_at instanceof Date ? row.updated_at.toISOString() : new Date(row.updated_at).toISOString();
              if (!Number.isNaN(new Date(updatedAt).getTime())) {
                order.updatedAt = updatedAt;
              }
            }
            if (waiterNameQuery) {
              const orderWaiter = String(
                order.waiterName ||
                order.waiter ||
                order.orderData?.waiterName ||
                order.orderData?.order?.waiterName ||
                order.order_data?.waiterName ||
                order.order_data?.order?.waiterName ||
                order.orderData?.order_data?.waiterName ||
                order.order_data?.order_data?.waiterName ||
                ''
              ).trim().toLowerCase();
              if (orderWaiter !== waiterNameQuery) {
                continue;
              }
            }
            orders.push(order);
          }
          
          res.json({
            success: true,
            orders: orders,
            count: orders.length
          });
        } finally {
          connection.release();
        }

    } catch (err) {
      console.error('Error fetching orders:', err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ====== CASH TRACKING ======

  /**
   * POST /api/cash/report
   * Cashier sends cash collection report
   */
  app.post('/api/cash/report', async (req, res) => {
    try {
      const { terminalId, totalCash, reportData } = req.body;

      const cashReport = {
        id: generateId(),
        terminalId,
        totalCash,
        reportData,
        timestamp: new Date().toISOString()
      };

      // Save to admin's cash reports
      if (!useMySQL || !dbPool) { return res.status(500).json({ success: false, error: 'database_unavailable' }); }
        const connection = await dbPool.getConnection();
        try {
          await connection.query(
            'INSERT INTO cash_reports (id, terminal_id, total_cash, report_data, timestamp) VALUES (?, ?, ?, ?, ?)',
            [cashReport.id, terminalId, Number(totalCash) || 0, JSON.stringify(reportData), new Date(cashReport.timestamp)]
          );
        } finally {
          connection.release();
        }


      res.json({
        success: true,
        message: 'Cash report received',
        reportId: cashReport.id
      });
    } catch (err) {
      console.error('Error saving cash report:', err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  /**
   * GET /api/cash/summary
   * Get cash summary from all terminals
   */
  app.get('/api/cash/summary', async (req, res) => {
    try {
      let cashReports = [];
      if (!useMySQL || !dbPool) { return res.status(500).json({ success: false, error: 'database_unavailable' }); }
        const connection = await dbPool.getConnection();
        try {
          const [rows] = await connection.query('SELECT report_data FROM cash_reports');
          cashReports = rows.map(row => JSON.parse(row.report_data));
        } finally {
          connection.release();
        }


      // Group by terminal
      const summary = {};
      let totalCash = 0;

      cashReports.forEach(report => {
        if (!summary[report.terminalId]) {
          summary[report.terminalId] = [];
        }
        summary[report.terminalId].push(report);
        totalCash += report.totalCash;
      });

      res.json({
        success: true,
        summary: summary,
        totalCash: totalCash,
        reportCount: cashReports.length
      });
    } catch (err) {
      console.error('Error fetching cash summary:', err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ====== USER MANAGEMENT ======

  /**
   * POST /api/users/sync
   * Sync user list with cashier
   */
  app.post('/api/users/sync', async (req, res) => {
    try {
      let users = [];
      if (!useMySQL || !dbPool) { return res.status(500).json({ success: false, error: 'database_unavailable' }); }
        const connection = await dbPool.getConnection();
        try {
          const [rows] = await connection.query('SELECT id, username, role, status FROM users');
          users = rows.map(row => ({ id: row.id, username: row.username, role: row.role, status: row.status }));
        } finally {
          connection.release();
        }


      const safeUsers = users.map(u => ({
        id: u.id,
        username: u.username,
        role: u.role,
        status: u.status
      }));

      res.json({
        success: true,
        users: safeUsers,
        count: safeUsers.length
      });
    } catch (err) {
      console.error('Error syncing users:', err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ====== SYSTEM INFO ======

  /**
   * GET /api/server/info
   * Get admin server information
   */
  app.get('/api/server/info', (req, res) => {
    try {
      const networkInterfaces = os.networkInterfaces();
      let ipAddress = 'localhost';
      
      // Get first non-internal IPv4
      for (const [name, addrs] of Object.entries(networkInterfaces)) {
        for (const addr of addrs) {
          if (addr.family === 'IPv4' && !addr.internal) {
            ipAddress = addr.address;
            break;
          }
        }
        if (ipAddress !== 'localhost') break;
      }

      res.json({
        success: true,
        serverIp: ipAddress,
        port: port,
        connectedTerminals: connectedTerminals.size,
        timestamp: new Date().toISOString()
      });
    } catch (err) {
      console.error('Error fetching server info:', err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  /**
   * GET /api/server/health
   * Health check endpoint
   */
  app.get('/api/server/health', (req, res) => {
    res.json({
      status: 'healthy',
      uptime: process.uptime(),
      timestamp: new Date().toISOString()
    });
  });

  // Serve SPA routes from index.html for non-API requests
  app.use((req, res, next) => {
    if (req.path.startsWith('/api/') || req.path.startsWith('/health')) {
      return next();
    }
    sendIndexPage(res);
  });

  // Start server
  const server = app.listen(port, '0.0.0.0', () => {
    console.log(`\n🖥️  Admin Server Started`);
    console.log(`════════════════════════════════`);
    console.log(`Port: ${port}`);
    console.log(`Status: LISTENING`);
    console.log(`\n📡 Cashiers can connect to: http://${getLocalIp()}:${port}`);
    console.log(`════════════════════════════════\n`);
  });

  return server;
}

function getLocalIp() {
  const networkInterfaces = os.networkInterfaces();
  for (const [name, addrs] of Object.entries(networkInterfaces)) {
    for (const addr of addrs) {
      if (addr.family === 'IPv4' && !addr.internal) {
        return addr.address;
      }
    }
  }
  return 'localhost';
}

function getConnectedTerminals() {
  return Array.from(connectedTerminals.values());
}

startAdminServer(process.env.PORT || 3000)
  .then(() => {
    console.log('🌐 Web app is ready to open in your browser');
  })
  .catch((err) => {
    console.error('Failed to start web server:', err);
    process.exit(1);
  });

module.exports = {
  startAdminServer,
  getLocalIp,
  getConnectedTerminals
};