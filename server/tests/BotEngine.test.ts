import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BotEngine } from '../services/BotEngine.js';
import { SqlitePersistenceService } from '../services/SqlitePersistenceService.js';
import { IExchange } from '../services/ExchangeService.js';
import { BotSettings, BotStatus } from '../../src/types.js';
import fs from 'fs';
import path from 'path';

class MockExchange implements IExchange {
    name = 'mock';
    async initialize() {}
    async fetchTickers() { return []; }
    async fetchOHLCV() { return []; }
    async getBalance() { return { info: {}, free: { USDT: 1000 }, used: {}, total: { USDT: 1000 } } as any; }
    async placeOrder() { return {} as any; }
    async validateApiKeyPermissions() { return true; }
}

const TEST_DB = 'bot_engine_test.db';
const DATA_DIR = path.resolve(process.cwd(), 'data');
const DB_PATH = path.join(DATA_DIR, TEST_DB);

const defaultSettings: BotSettings = {
    maxCoinPrice: 1,
    tradeAmountUSDT: 10,
    scanIntervalMs: 100,
    targetProfitPercent: 10,
    stopLossPercent: 5,
    maxOpenTrades: 1,
    rsiPeriod: 14,
    rsiBuyThreshold: 30,
    smaShortPeriod: 9,
    smaLongPeriod: 21,
    useTrailingStop: false,
    trailingStopArmPercentage: 1,
    trailingStopOffsetPercentage: 0.5
};

describe('BotEngine', () => {
    let persistence: SqlitePersistenceService;
    let exchange: MockExchange;
    let bot: BotEngine;

    beforeEach(() => {
        if (fs.existsSync(DB_PATH)) fs.unlinkSync(DB_PATH);
        if (fs.existsSync(DB_PATH + '-wal')) fs.unlinkSync(DB_PATH + '-wal');
        if (fs.existsSync(DB_PATH + '-shm')) fs.unlinkSync(DB_PATH + '-shm');
        persistence = new SqlitePersistenceService(TEST_DB);
        exchange = new MockExchange();
        bot = new BotEngine(exchange, persistence, defaultSettings);
    });

    afterEach(() => {
        bot.stop();
        persistence.close();
        if (fs.existsSync(DB_PATH)) fs.unlinkSync(DB_PATH);
        if (fs.existsSync(DB_PATH + '-wal')) fs.unlinkSync(DB_PATH + '-wal');
        if (fs.existsSync(DB_PATH + '-shm')) fs.unlinkSync(DB_PATH + '-shm');
    });

    it('should initialize correctly', async () => {
        await bot.initialize();
        expect(bot.status).toBe(BotStatus.STOPPED);
    });

    it('should prevent double start', async () => {
        await bot.initialize();
        await bot.start();
        const logSpy = vi.spyOn(bot as any, 'log');
        await bot.start();
        expect(logSpy).toHaveBeenCalledWith('WARNING', 'Bot is already running.');
    });
});
