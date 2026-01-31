import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { BotSettings, BotTradeData, CompletedTrade } from '../../src/types.js';

export class SqlitePersistenceService {
  private db: Database.Database;

  constructor(filename: string = 'bot.db') {
    const dataDir = path.resolve(process.cwd(), 'data');
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir);
    }
    const dbPath = path.join(dataDir, filename);
    this.db = new Database(dbPath);
    this.init();
  }

  private init() {
    this.db.pragma('journal_mode = WAL');

    // Settings table (store as JSON blob for flexibility)
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS bot_settings (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        data TEXT NOT NULL
      )
    `);

    // Active trades table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS active_trades (
        symbol TEXT PRIMARY KEY,
        data TEXT NOT NULL
      )
    `);

    // Trade ledger table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS trade_ledger (
        id TEXT PRIMARY KEY,
        timestamp INTEGER,
        data TEXT NOT NULL
      )
    `);
  }

  saveSettings(settings: BotSettings) {
    const stmt = this.db.prepare('INSERT OR REPLACE INTO bot_settings (id, data) VALUES (1, ?)');
    stmt.run(JSON.stringify(settings));
  }

  loadSettings(): BotSettings | undefined {
    const stmt = this.db.prepare('SELECT data FROM bot_settings WHERE id = 1');
    const row = stmt.get() as { data: string } | undefined;
    if (row) {
      return JSON.parse(row.data) as BotSettings;
    }
    return undefined;
  }

  saveActiveTrade(symbol: string, trade: BotTradeData) {
    const stmt = this.db.prepare('INSERT OR REPLACE INTO active_trades (symbol, data) VALUES (?, ?)');
    stmt.run(symbol, JSON.stringify(trade));
  }

  deleteActiveTrade(symbol: string) {
    const stmt = this.db.prepare('DELETE FROM active_trades WHERE symbol = ?');
    stmt.run(symbol);
  }

  loadActiveTrades(): Map<string, BotTradeData> {
    const stmt = this.db.prepare('SELECT symbol, data FROM active_trades');
    const rows = stmt.all() as { symbol: string; data: string }[];
    const map = new Map<string, BotTradeData>();
    for (const row of rows) {
      map.set(row.symbol, JSON.parse(row.data));
    }
    return map;
  }

  saveLedgerItem(trade: CompletedTrade) {
      const stmt = this.db.prepare('INSERT OR REPLACE INTO trade_ledger (id, timestamp, data) VALUES (?, ?, ?)');
      stmt.run(trade.id, trade.timestamp, JSON.stringify(trade));
  }

  loadLedger(limit: number = 100): CompletedTrade[] {
      const stmt = this.db.prepare('SELECT data FROM trade_ledger ORDER BY timestamp DESC LIMIT ?');
      const rows = stmt.all(limit) as { data: string }[];
      return rows.map(row => JSON.parse(row.data));
  }

  close() {
      this.db.close();
  }
}
