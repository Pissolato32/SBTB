import ccxt, { Exchange, Ticker, OHLCV, Balances, Order } from 'ccxt';
import * as dotenv from 'dotenv';

dotenv.config();

export interface IExchange {
  name: string;
  initialize(): Promise<void>;
  fetchTickers(): Promise<Ticker[]>;
  fetchOHLCV(symbol: string, timeframe: string, limit?: number): Promise<OHLCV[]>;
  getBalance(): Promise<Balances>;
  placeOrder(symbol: string, type: 'market' | 'limit', side: 'buy' | 'sell', amount: number, price?: number): Promise<Order>;
}

export class CcxtExchange implements IExchange {
  public name: string;
  private exchange: Exchange;

  constructor(exchangeId: string = 'binance') {
    this.name = exchangeId;
    const exchangeClass = (ccxt as any)[exchangeId];
    if (!exchangeClass) {
      throw new Error(`Exchange ${exchangeId} not supported by CCXT`);
    }

    this.exchange = new exchangeClass({
      'enableRateLimit': true,
      'timeout': 30000,
    });
  }

  async initialize(): Promise<void> {
    const apiKey = process.env.BINANCE_API_KEY || process.env.API_KEY; // Fallback for generic name
    const secret = process.env.BINANCE_API_SECRET || process.env.SECRET_KEY;
    const isTestnet = process.env.IS_TESTNET === 'true' || process.env.BINANCE_TESTNET_API_KEY !== undefined; // Detect testnet intent

    // Specific logic for Binance Testnet if using old env vars
    if (this.name === 'binance' && process.env.BINANCE_TESTNET_API_KEY) {
        this.exchange.apiKey = process.env.BINANCE_TESTNET_API_KEY;
        this.exchange.secret = process.env.BINANCE_TESTNET_SECRET_KEY;
        this.exchange.setSandboxMode(true);
    } else {
        if (apiKey) this.exchange.apiKey = apiKey;
        if (secret) this.exchange.secret = secret;
        if (isTestnet) {
            this.exchange.setSandboxMode(true);
        }
    }

    console.log(`[ExchangeService] Initializing ${this.name} (Sandbox: ${this.exchange.sandboxMode ? 'YES' : 'NO'})...`);

    // Load markets to ensure we have symbol data
    await this.exchange.loadMarkets();
    console.log(`[ExchangeService] ${this.name} initialized. Markets loaded.`);
  }

  async fetchTickers(): Promise<Ticker[]> {
    try {
        const tickersMap = await this.exchange.fetchTickers();
        return Object.values(tickersMap);
    } catch (error) {
        console.error(`[ExchangeService] Error fetching tickers:`, error);
        throw error;
    }
  }

  async fetchOHLCV(symbol: string, timeframe: string, limit: number = 50): Promise<OHLCV[]> {
    try {
        // Ensure symbol is in CCXT format (e.g. BTC/USDT)
        return await this.exchange.fetchOHLCV(symbol, timeframe, undefined, limit);
    } catch (error) {
        console.error(`[ExchangeService] Error fetching OHLCV for ${symbol}:`, error);
        throw error;
    }
  }

  async getBalance(): Promise<Balances> {
    try {
        return await this.exchange.fetchBalance();
    } catch (error) {
        console.error(`[ExchangeService] Error fetching balance:`, error);
        throw error;
    }
  }

  async placeOrder(symbol: string, type: 'market' | 'limit', side: 'buy' | 'sell', amount: number, price?: number): Promise<Order> {
    try {
        const params: any = {};
        // Handle quoteOrderQty for Binance market buys if needed, but CCXT often handles amount as base asset.
        // For standardization, we stick to base asset amount usually.
        // However, some strategies prefer spending X USDT.
        // CCXT 'createOrder' signature: (symbol, type, side, amount, price, params)

        return await this.exchange.createOrder(symbol, type, side, amount, price, params);
    } catch (error) {
        console.error(`[ExchangeService] Error placing order ${side} ${amount} ${symbol}:`, error);
        throw error;
    }
  }
}
