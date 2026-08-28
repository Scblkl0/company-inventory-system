import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';
import fs from 'node:fs';
import path from 'node:path';

const dataDirectory = path.join(process.cwd(), 'data');
fs.mkdirSync(dataDirectory, { recursive: true });
export const db = new Database(path.join(dataDirectory, 'inventory.sqlite'));
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL UNIQUE,
    password TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'user',
    employee_id INTEGER, active INTEGER NOT NULL DEFAULT 1,
    must_change_password INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS employees (
    id INTEGER PRIMARY KEY AUTOINCREMENT, first_name TEXT NOT NULL, last_name TEXT NOT NULL,
    email TEXT, department TEXT, position TEXT
  );
  CREATE TABLE IF NOT EXISTS categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, description TEXT
  );
  CREATE TABLE IF NOT EXISTS locations (
    id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, address TEXT
  );
  CREATE TABLE IF NOT EXISTS assets (
    id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, inventory_number TEXT UNIQUE,
    serial_number TEXT,
    category_id INTEGER, location_id INTEGER, employee_id INTEGER,
    FOREIGN KEY(category_id) REFERENCES categories(id) ON DELETE SET NULL,
    FOREIGN KEY(location_id) REFERENCES locations(id) ON DELETE SET NULL,
    FOREIGN KEY(employee_id) REFERENCES employees(id) ON DELETE SET NULL
  );
  CREATE TABLE IF NOT EXISTS asset_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT, asset_id INTEGER, action TEXT NOT NULL,
    details TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(asset_id) REFERENCES assets(id) ON DELETE SET NULL
  );
`);

// Proste migracje zachowujące dane z wcześniejszej wersji projektu.
const userColumns = new Set((db.prepare('PRAGMA table_info(users)').all() as any[]).map(column => column.name));
if (!userColumns.has('employee_id')) db.exec('ALTER TABLE users ADD COLUMN employee_id INTEGER');
if (!userColumns.has('active')) db.exec('ALTER TABLE users ADD COLUMN active INTEGER NOT NULL DEFAULT 1');
if (!userColumns.has('must_change_password')) db.exec('ALTER TABLE users ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 0');
if (!userColumns.has('created_at')) db.exec('ALTER TABLE users ADD COLUMN created_at TEXT');
const assetColumnRows = db.prepare('PRAGMA table_info(assets)').all() as any[];
const assetColumns = new Set(assetColumnRows.map(column => column.name));
const inventoryNumberColumn = assetColumnRows.find(column => column.name === 'inventory_number');
if (assetColumns.has('purchase_date') || assetColumns.has('purchase_price') || assetColumns.has('status') || inventoryNumberColumn?.notnull) {
  db.pragma('foreign_keys = OFF');
  db.exec(`
    BEGIN;
    CREATE TABLE assets_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, inventory_number TEXT UNIQUE,
      serial_number TEXT, category_id INTEGER, location_id INTEGER, employee_id INTEGER,
      FOREIGN KEY(category_id) REFERENCES categories(id) ON DELETE SET NULL,
      FOREIGN KEY(location_id) REFERENCES locations(id) ON DELETE SET NULL,
      FOREIGN KEY(employee_id) REFERENCES employees(id) ON DELETE SET NULL
    );
    INSERT INTO assets_new (id,name,inventory_number,serial_number,category_id,location_id,employee_id)
      SELECT id,name,inventory_number,serial_number,category_id,location_id,employee_id FROM assets;
    DROP TABLE assets;
    ALTER TABLE assets_new RENAME TO assets;
    COMMIT;
  `);
  db.pragma('foreign_keys = ON');
}
db.exec(`
  UPDATE users SET active = 1 WHERE active IS NULL;
  UPDATE users SET must_change_password = 0;
  UPDATE users SET created_at = CURRENT_TIMESTAMP WHERE created_at IS NULL;
  CREATE UNIQUE INDEX IF NOT EXISTS idx_users_employee_id ON users(employee_id) WHERE employee_id IS NOT NULL;
`);

if (!db.prepare('SELECT id FROM users WHERE username = ?').get('admin')) {
  db.prepare('INSERT INTO users (username, password) VALUES (?, ?)').run('admin', bcrypt.hashSync('admin123', 10));
  db.prepare('INSERT INTO categories (name, description) VALUES (?, ?), (?, ?)')
    .run('Komputery', 'Laptopy i komputery stacjonarne', 'Meble', 'Wyposażenie biura');
  db.prepare('INSERT INTO locations (name, address) VALUES (?, ?), (?, ?)')
    .run('Biuro główne', 'Warszawa, ul. Przykładowa 1', 'Magazyn', 'Warszawa, ul. Przemysłowa 5');
  db.prepare('INSERT INTO employees (first_name, last_name, email, department, position) VALUES (?, ?, ?, ?, ?)')
    .run('Jan', 'Kowalski', 'jan.kowalski@firma.pl', 'IT', 'Programista');
}

export function history(assetId: number, action: string, details: string) {
  db.prepare('INSERT INTO asset_history (asset_id, action, details) VALUES (?, ?, ?)').run(assetId, action, details);
}
