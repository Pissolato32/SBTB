import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BotEngine } from '../services/BotEngine.js';
import { SqlitePersistenceService } from '../services/SqlitePersistenceService.js';
import { IExchange } from '../services/ExchangeService.js';
import { BotSettings, BotStatus, Coin } from '../../src/types.js';
import fs from 'fs';
import path from 'path';

// Mock technicalindicators
vi.mock('technicalindicators', () => ({
    RSI: { calculate: () => [25] },
    SMA: { calculate: (params: any) => params.period === 9 ? [10] : [5] }
}));

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
        vi.restoreAllMocks();
        // bot.stop() might be async and have timer, but here we just test methods
        if ((bot as any).scanTimer) clearInterval((bot as any).scanTimer);
        persistence.close();
        if (fs.existsSync(DB_PATH)) fs.unlinkSync(DB_PATH);
        if (fs.existsSync(DB_PATH + '-wal')) fs.unlinkSync(DB_PATH + '-wal');
        if (fs.existsSync(DB_PATH + '-shm')) fs.unlinkSync(DB_PATH + '-shm');
    });

    it('should initialize correctly', async () => {
        await bot.initialize();
        expect(bot.status).toBe(BotStatus.STOPPED);
        expect(bot.usdtBalance).toBe(1000); // From mock balance
    });

    it('should scan market and identify buy candidates', async () => {
        // Setup market data
        const mockTickers = [{
            symbol: 'LTC/USDT',
            last: 0.5,
            baseVolume: 1000,
            quoteVolume: 500,
            percentage: 0
        }];
        vi.spyOn(exchange, 'fetchTickers').mockResolvedValue(mockTickers as any);

        const ohlcv = Array(50).fill([0, 0, 0, 0, 1]); // Dummy data, logic handled by mocked technicalindicators
        vi.spyOn(exchange, 'fetchOHLCV').mockResolvedValue(ohlcv as any);

        await (bot as any).scanMarket();

        expect(bot.marketData.length).toBe(1);
        expect(bot.marketData[0].symbol).toBe('LTC/USDT');
        expect(bot.marketData[0].rsi).toBe(25); // From mock
        expect(bot.marketData[0].smaShort).toBe(10);
        expect(bot.marketData[0].smaLong).toBe(5);
    });

    it('should execute buy strategy', async () => {
        // Setup bot state with a candidate
        bot.marketData = [{
            id: 'LTC/USDT',
            symbol: 'LTC/USDT',
            price: 0.5,
            rsi: 25,
            smaShort: 10,
            smaLong: 5,
            quoteVolume: 1000
        } as Coin];
        bot.usdtBalance = 1000;

        const placeOrderSpy = vi.spyOn(exchange, 'placeOrder').mockResolvedValue({
            id: 'order1',
            price: 0.5,
            amount: 20,
            cost: 10,
            filled: 20,
            average: 0.5
        } as any);

        await (bot as any).executeStrategy();

        expect(placeOrderSpy).toHaveBeenCalledWith('LTC/USDT', 'market', 'buy', 20); // 10 USDT / 0.5 price = 20
        expect(bot.activeTrades.has('LTC/USDT')).toBe(true);
    });

    it('should execute sell strategy (Take Profit)', async () => {
        // Setup active trade
        const purchasePrice = 0.5;
        bot.activeTrades.set('LTC/USDT', {
            purchasePrice,
            amount: 20,
            timestamp: Date.now()
        });

        // Setup portfolio
        bot.portfolio = [{
            symbol: 'LTC/USDT',
            baseAsset: 'LTC',
            quoteAsset: 'USDT',
            amount: 20,
            lockedAmount: 0
        }];

        // Market price hits target profit (10% -> 0.55)
        bot.marketData = [{
            symbol: 'LTC/USDT',
            price: 0.60, // Way above 0.55
        } as Coin];

        const placeOrderSpy = vi.spyOn(exchange, 'placeOrder').mockResolvedValue({
            id: 'sell1',
            price: 0.60,
            amount: 20,
            cost: 12,
            filled: 20,
            average: 0.60
        } as any);

        await (bot as any).executeStrategy();

        expect(placeOrderSpy).toHaveBeenCalledWith('LTC/USDT', 'market', 'sell', 20);
        expect(bot.activeTrades.has('LTC/USDT')).toBe(false);
        expect(bot.tradeLedger.length).toBe(1);
        expect(bot.tradeLedger[0].type).toBe('SELL');
        expect(bot.tradeLedger[0].profitPercent).toBeGreaterThan(0);
    });
});
