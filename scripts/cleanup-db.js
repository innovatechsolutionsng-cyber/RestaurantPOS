#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

const rootDir = path.resolve(__dirname, '..');
const dbFile = path.join(rootDir, 'restaurant.db');
const dbDir = path.join(rootDir, 'db');
const backupDir = path.join(rootDir, 'backups');

function log(message) {
  console.log(message);
}

async function cleanupLocalFiles() {
  const targets = [dbFile, dbDir];
  let removed = 0;

  for (const target of targets) {
    if (!fs.existsSync(target)) continue;
    fs.rmSync(target, { recursive: true, force: true });
    removed += 1;
    log(`Removed ${target}`);
  }

  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }

  log(`Local cleanup complete. Removed ${removed} target(s).`);
}

async function cleanupMySQL() {
  const host = process.env.MYSQL_HOST || 'localhost';
  const port = Number(process.env.MYSQL_PORT || 3306);
  const user = process.env.MYSQL_USER || 'restaurantapp';
  const password = process.env.MYSQL_PASSWORD || 'Olaniyi123$';
  const database = process.env.MYSQL_DATABASE || 'restaurant_pos';

  try {
    const connection = await mysql.createConnection({ host, port, user, password, database, connectTimeout: 5000 });
    const tables = ['orders', 'cash_reports', 'settings', 'users', 'categories', 'subcategories', 'products', 'events'];

    for (const table of tables) {
      try {
        await connection.query(`DELETE FROM \`${table}\``);
        log(`Cleared table: ${table}`);
      } catch (err) {
        log(`Skipped table ${table}: ${err.message}`);
      }
    }

    await connection.end();
    log('MySQL cleanup complete.');
  } catch (err) {
    log(`MySQL cleanup skipped: ${err.message}`);
  }
}

async function main() {
  const mode = process.argv[2] || 'soft';
  const force = process.argv.includes('--force');

  if (!force) {
    log('This will clear local app data and/or MySQL records.');
    log('Run with --force to continue.');
    process.exit(0);
  }

  try {
    if (mode === 'hard') {
      await cleanupLocalFiles();
      await cleanupMySQL();
    } else {
      await cleanupMySQL();
      await cleanupLocalFiles();
    }
  } catch (err) {
    console.error('Cleanup failed:', err.message);
    process.exit(1);
  }
}

main();
