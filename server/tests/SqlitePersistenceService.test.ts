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

  it('should save and load active trades', () => {
      const trade: BotTradeData = {
          purchasePrice: 100,
          amount: 1,
          timestamp: 123456789,
          highestPriceSinceBuy: 105
      };

      service.saveActiveTrade('BTC/USDT', trade);

      const loaded = service.loadActiveTrades();
      expect(loaded.size).toBe(1);
      expect(loaded.get('BTC/USDT')).toEqual(trade);

      // Add another
      service.saveActiveTrade('ETH/USDT', { ...trade, purchasePrice: 10 });
      const loaded2 = service.loadActiveTrades();
      expect(loaded2.size).toBe(2);
  });

  it('should delete active trades', () => {
      const trade: BotTradeData = { purchasePrice: 100, amount: 1, timestamp: 123 };
      service.saveActiveTrade('BTC/USDT', trade);
      service.deleteActiveTrade('BTC/USDT');
      const loaded = service.loadActiveTrades();
      expect(loaded.size).toBe(0);
  });

  it('should save and load ledger items', () => {
      const trade: CompletedTrade = {
          id: '1',
          timestamp: 1000,
          type: 'SELL',
          pair: 'BTC/USDT',
          price: 100,
          amount: 1,
          cost: 100
      };

      service.saveLedgerItem(trade);

      // Add a second newer trade
      const trade2: CompletedTrade = { ...trade, id: '2', timestamp: 2000 };
      service.saveLedgerItem(trade2);

      const ledger = service.loadLedger(10);
      expect(ledger.length).toBe(2);
      expect(ledger[0].id).toBe('2'); // Newest first
      expect(ledger[1].id).toBe('1');
  });

  it('should respect limit in loadLedger', () => {
      for (let i = 0; i < 5; i++) {
          service.saveLedgerItem({
              id: `${i}`,
              timestamp: i,
              type: 'BUY',
              pair: 'BTC/USDT',
              price: 100,
              amount: 1,
              cost: 100
          });
      }
      const ledger = service.loadLedger(3);
      expect(ledger.length).toBe(3);
      expect(ledger[0].id).toBe('4'); // 4, 3, 2
  });
});
