import ccxt, { Exchange, Ticker, OHLCV, Balances, Order } from 'ccxt';
import * as dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), 'server', '.env') });

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
      'options': {
        'defaultType': 'spot',
        'adjustForTimeDifference': true, // Add this to handle time sync issues
        'recvWindow': 60000, // Increase receive window
        'fetchCurrencies': false, // Desativar para evitar 404 no Demo Mode
      }
    });
  }

  async initialize(): Promise<void> {
    const isTestnet = process.env.IS_TESTNET === 'true' || process.env.BINANCE_TESTNET_API_KEY !== undefined;
    const apiKey = isTestnet ? (process.env.BINANCE_TESTNET_API_KEY || process.env.BINANCE_API_KEY) : process.env.BINANCE_API_KEY;
    const secret = isTestnet ? (process.env.BINANCE_TESTNET_SECRET_KEY || process.env.BINANCE_API_SECRET) : process.env.BINANCE_API_SECRET;

    if (isTestnet) {
      console.log('[ExchangeService] Adaptando CCXT para Binance SPOT DEMO Mode...');
      
      this.exchange.setSandboxMode(true);
      const originalUrls = this.exchange.urls['api'] as any;
      const demoHost = 'demo-api.binance.com';
      
      // Substituir o host da testnet antiga pelo novo Demo Mode em todas as URLs da API
      for (const key in originalUrls) {
        if (typeof originalUrls[key] === 'string' && originalUrls[key].includes('testnet.binance.vision')) {
          originalUrls[key] = originalUrls[key].replace('testnet.binance.vision', demoHost);
        }
      }
      
      // Desativar endpoints que não existem no Demo Mode/Testnet
      this.exchange.options['fetchCurrencies'] = false;
      this.exchange.options['fetchMarkets'] = ['spot'];
    }

    if (apiKey && secret) {
      // Inicialmente não definimos as chaves para carregar mercados (público)
      // Isso evita erros de API Key inválida em endpoints públicos
      // @ts-ignore - CCXT types might not allow empty string if it expects valid keys
      this.exchange.apiKey = '';
      // @ts-ignore
      this.exchange.secret = '';
    } else {
      console.warn('[ExchangeService] No API keys found in .env!');
    }

    console.log(`[ExchangeService] Initializing ${this.name}...`);
    // Removed manual URL override to let setSandboxMode handle it
    
    // Load markets to ensure we have symbol data
    try {
      await this.exchange.loadMarkets();
      console.log(`[ExchangeService] ${this.name} initialized. Markets loaded.`);

      // Agora aplicamos as chaves para operações privadas
        if (apiKey && secret) {
          this.exchange.apiKey = apiKey.trim();
          this.exchange.secret = secret.trim();
        }
    } catch (error: any) {
      console.warn(`[ExchangeService] Aviso ao carregar mercados (pode ser normal no Demo Mode): ${error.message}`);
       // Se já tivermos alguns mercados, podemos continuar
       if (this.exchange.markets && Object.keys(this.exchange.markets).length > 0) {
         console.log(`[ExchangeService] ${Object.keys(this.exchange.markets).length} mercados carregados. Continuando...`);
       } else {
         console.error('[ExchangeService] Nenhum mercado carregado. Tentando carregar apenas mercados Spot manualmente...');
         try {
           const markets = await this.exchange.fetchMarkets({ type: 'spot' });
           console.log(`[ExchangeService] ${markets.length} mercados Spot carregados manualmente.`);
         } catch (innerError: any) {
           console.error('[ExchangeService] Falha crítica ao carregar mercados:', innerError.message);
           throw error;
         }
       }
    }
  }

  async fetchTickers(): Promise<Ticker[]> {
    try {
        const tickersMap = await this.exchange.fetchTickers();
        // CCXT fetchTickers returns a map. Values might have undefined price in some exchanges.
        return Object.values(tickersMap).filter(t => t.last !== undefined && t.last > 0);
    } catch (error) {
        console.error(`[ExchangeService] Error fetching tickers:`, error);
        throw error;
    }
  }

  async fetchOHLCV(symbol: string, timeframe: string, limit: number = 50): Promise<OHLCV[]> {
    try {
        // Ensure symbol is in CCXT format (e.g. BTC/USDT)
        const ohlcv = await this.exchange.fetchOHLCV(symbol, timeframe, undefined, limit);
        return ohlcv || [];
    } catch (error) {
        console.error(`[ExchangeService] Error fetching OHLCV for ${symbol}:`, error);
        return []; // Return empty instead of throwing to allow the loop to continue with other coins
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
