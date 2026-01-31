import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqlitePersistenceService } from '../services/SqlitePersistenceService.js';
import fs from 'fs';
import path from 'path';
import { BotSettings, BotTradeData, CompletedTrade } from '../../src/types.js';

const TEST_DB = 'test_bot.db';
const DATA_DIR = path.resolve(process.cwd(), 'data');
const DB_PATH = path.join(DATA_DIR, TEST_DB);

describe('SqlitePersistenceService', () => {
  let service: SqlitePersistenceService;

  beforeEach(() => {
    if (fs.existsSync(DB_PATH)) fs.unlinkSync(DB_PATH);
    if (fs.existsSync(DB_PATH + '-wal')) fs.unlinkSync(DB_PATH + '-wal');
    if (fs.existsSync(DB_PATH + '-shm')) fs.unlinkSync(DB_PATH + '-shm');
    service = new SqlitePersistenceService(TEST_DB);
  });

  afterEach(() => {
    service.close();
    if (fs.existsSync(DB_PATH)) fs.unlinkSync(DB_PATH);
    if (fs.existsSync(DB_PATH + '-wal')) fs.unlinkSync(DB_PATH + '-wal');
    if (fs.existsSync(DB_PATH + '-shm')) fs.unlinkSync(DB_PATH + '-shm');
  });

  it('should save and load settings', () => {
    const settings: BotSettings = {
        maxCoinPrice: 1,
        tradeAmountUSDT: 10,
        scanIntervalMs: 5000,
        targetProfitPercent: 2,
        stopLossPercent: 1,
        maxOpenTrades: 3,
        rsiPeriod: 14,
        rsiBuyThreshold: 30,
        smaShortPeriod: 9,
        smaLongPeriod: 21,
        useTrailingStop: false,
        trailingStopArmPercentage: 1,
        trailingStopOffsetPercentage: 0.5
    };
    service.saveSettings(settings);
    const loaded = service.loadSettings();
    expect(loaded).toEqual(settings);
  });
});
