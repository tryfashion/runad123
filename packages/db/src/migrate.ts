import mysql, { type RowDataPacket } from 'mysql2/promise';
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

export async function migrate(uri: string) {
  const connection = await mysql.createConnection({
    uri,
    timezone: 'Z',
    connectTimeout: 5000,
    multipleStatements: false,
  });
  try {
    const [environment] = await connection.query<RowDataPacket[]>(
      'SELECT VERSION() AS version, @@sql_mode AS sqlMode',
    );
    const version = String(environment[0]?.version ?? '');
    const match = /^8\.(\d+)\.(\d+)/.exec(version);
    if (
      !match ||
      version.toLowerCase().includes('mariadb') ||
      (Number(match[1]) === 0 && Number(match[2]) < 16)
    )
      throw new Error('MYSQL_8_0_16_REQUIRED');
    if (!String(environment[0]?.sqlMode).includes('STRICT_'))
      throw new Error('MYSQL_STRICT_MODE_REQUIRED');
    await connection.query("SET time_zone = '+00:00'");
    const [lock] = await connection.query<RowDataPacket[]>(
      "SELECT GET_LOCK('runad123:migrate', 10) AS acquired",
    );
    if (lock[0]?.acquired !== 1) throw new Error('MIGRATION_LOCK_UNAVAILABLE');
    await connection.query(
      'CREATE TABLE IF NOT EXISTS runad_migrations (name VARCHAR(160) PRIMARY KEY, checksum CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL, state VARCHAR(16) NOT NULL, created_at DATETIME(3) NOT NULL, updated_at DATETIME(3) NOT NULL) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin',
    );
    const directory = fileURLToPath(new URL('../migrations/', import.meta.url));
    for (const name of (await readdir(directory))
      .filter((name) => /^\d+_[a-z0-9_]+\.sql$/.test(name))
      .sort()) {
      const sql = await readFile(`${directory}/${name}`, 'utf8'),
        checksum = createHash('sha256').update(sql.replace(/\r\n/g, '\n')).digest('hex');
      const [rows] = await connection.execute<RowDataPacket[]>(
        'SELECT checksum,state FROM runad_migrations WHERE name=?',
        [name],
      );
      if (rows.length) {
        if (rows[0]?.checksum !== checksum || rows[0]?.state !== 'applied')
          throw new Error('MIGRATION_REVIEW_REQUIRED');
        continue;
      }
      // MySQL DDL commits implicitly. Partial application requires review, never a silent retry.
      await connection.execute(
        "INSERT INTO runad_migrations VALUES (?,?,'applying',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",
        [name, checksum],
      );
      for (const statement of sql
        .split('--> statement-breakpoint')
        .map((s) => s.trim())
        .filter(Boolean))
        await connection.query(statement);
      await connection.execute(
        "UPDATE runad_migrations SET state='applied',updated_at=UTC_TIMESTAMP(3) WHERE name=?",
        [name],
      );
    }
  } finally {
    await connection.query("SELECT RELEASE_LOCK('runad123:migrate')").catch(() => undefined);
    await connection.end();
  }
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  if (!process.env.MYSQL_URL) {
    process.stderr.write('MYSQL_URL_REQUIRED: no database was modified.\n');
    process.exitCode = 1;
  } else
    try {
      await migrate(process.env.MYSQL_URL);
      process.stdout.write('MIGRATIONS_APPLIED\n');
    } catch {
      process.stderr.write(
        'MIGRATION_FAILED: check configuration and migration journal; no credentials are logged.\n',
      );
      process.exitCode = 1;
    }
}
