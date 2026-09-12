import { drizzle } from 'drizzle-orm/mysql2';
import mysql from 'mysql2/promise';

// No connection is created at import time. Credentials never enter client packages.
export function createDatabase(uri: string) {
  const pool = mysql.createPool({
    uri,
    connectionLimit: 5,
    charset: 'utf8mb4',
    connectTimeout: 5000,
    timezone: 'Z',
    supportBigNumbers: true,
    bigNumberStrings: true,
  });
  pool.on('connection', (connection) => {
    connection.query("SET time_zone = '+00:00'");
  });
  return { db: drizzle(pool), close: () => pool.end() };
}

export * from './schema.js';
export * from './store.js';
