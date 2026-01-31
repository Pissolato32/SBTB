// @ts-nocheck
import { IExchange } from './ExchangeService.js';
import { SqlitePersistenceService } from './SqlitePersistenceService.js';
import { BotSettings, BotStatus, Coin, CompletedTrade, PortfolioItem, BotTradeData } from '../../src/types.js';
import { MIN_TRADE_VALUE_USDT, EXCLUDED_SYMBOLS_BY_DEFAULT } from '../../src/constants.js';
import { RSI, SMA } from 'technicalindicators';
import { Mutex } from 'async-mutex';

export class BotEngine {
  private exchange: IExchange;
  private persistence: SqlitePersistenceService;
  private mutex: Mutex = new Mutex();

  public status: BotStatus = BotStatus.INITIALIZING;
  public settings: BotSettings;
  public tradeLedger: CompletedTrade[] = [];
  public activeTrades: Map<string, BotTradeData> = new Map();
  public marketData: Coin[] = [];
  public portfolio: PortfolioItem[] = [];
  public usdtBalance: number = 0;

  private scanTimer: NodeJS.Timeout | null = null;
  private isScanning: boolean = false;
  private isStopping: boolean = false; // Kill switch flag

  // Events
  public onMarketUpdate: ((coins: Coin[]) => void) | null = null;
  public onStatusUpdate: ((status: BotStatus) => void) | null = null;
  public onLog: ((log: any) => void) | null = null;
  public onPortfolioUpdate: ((portfolio: PortfolioItem[], balance: number) => void) | null = null;
  public onTradeLedgerUpdate: ((ledger: CompletedTrade[]) => void) | null = null;

  constructor(exchange: IExchange, persistence: SqlitePersistenceService, initialSettings: BotSettings) {
    this.exchange = exchange;
    this.persistence = persistence;
    this.settings = initialSettings;

    // Load persisted state - synchronous in better-sqlite3
    const loadedTrades = this.persistence.loadActiveTrades();
    if (loadedTrades.size > 0) {
      this.activeTrades = loadedTrades;
      this.log('INFO', `Loaded ${this.activeTrades.size} active trades from persistence.`);
    }

    const loadedSettings = this.persistence.loadSettings();
    if (loadedSettings) {
        this.settings = { ...this.settings, ...loadedSettings };
        this.log('INFO', `Loaded settings from persistence.`);
    }

    this.tradeLedger = this.persistence.loadLedger(50);
  }

  private log(type: string, message: string, extra: any = {}) {
    const logEntry = {
      type,
      message,
      timestamp: Date.now(),
      id: Date.now().toString() + Math.random().toString(36).substr(2, 5),
      ...extra
    };
    if (this.onLog) this.onLog(logEntry);
  }

  private setStatus(newStatus: BotStatus) {
    this.status = newStatus;
    if (this.onStatusUpdate) this.onStatusUpdate(newStatus);
  }

  async initialize() {
    try {
      this.log('INFO', 'Initializing Bot Engine...');
      await this.exchange.initialize();
      this.setStatus(BotStatus.STOPPED); // Ready but stopped
      this.log('INFO', 'Bot Engine Initialized. Ready to start.');

      // Initial fetch to populate data even if stopped
      // We don't need mutex here as it's single threaded startup usually, but good practice
      await this.mutex.runExclusive(async () => {
          await this.refreshAccount();
      });
    } catch (error: any) {
      this.log('ERROR', `Initialization failed: ${error.message}`);
      this.setStatus(BotStatus.ERROR);
    }
  }

  async start() {
      // Use mutex to prevent race between start and stop
      await this.mutex.runExclusive(async () => {
        if (this.status === BotStatus.RUNNING) {
            this.log('WARNING', 'Bot is already running.');
            return;
        }

        this.log('INFO', 'Starting Bot...');
        this.isStopping = false;
        this.setStatus(BotStatus.RUNNING);

        if (this.scanTimer) clearInterval(this.scanTimer);
        this.scanTimer = setInterval(() => this.executeLoop(), this.settings.scanIntervalMs);
      });

      // Execute immediately (will acquire its own lock)
      this.executeLoop();
  }

  async stop(hard: boolean = false) {
    this.isStopping = true; // Signal immediate stop
    this.log('INFO', 'Stopping Bot...');

    await this.mutex.runExclusive(async () => {
        if (this.scanTimer) clearInterval(this.scanTimer);
        this.scanTimer = null;
        this.setStatus(BotStatus.STOPPED);
        if (hard) {
            this.log('WARNING', 'Hard stop executed.');
        }
    });
  }

  async updateSettings(newSettings: BotSettings) {
    await this.mutex.runExclusive(async () => {
        this.settings = { ...this.settings, ...newSettings };
        this.persistence.saveSettings(this.settings);
        this.log('INFO', 'Settings updated.');

        // Restart loop if running to apply interval change
        if (this.status === BotStatus.RUNNING && this.scanTimer) {
            clearInterval(this.scanTimer);
            this.scanTimer = setInterval(() => this.executeLoop(), this.settings.scanIntervalMs);
        }
    });
  }

  private async refreshAccount() {
    try {
      const balance = await this.exchange.getBalance();

      const items: PortfolioItem[] = [];
      const currencies = Object.keys(balance.total);

      for (const currency of currencies) {
        const total = (balance.total as any)[currency];
        const free = (balance.free as any)[currency];
        const used = (balance.used as any)[currency];

        if (total && total > 0) {
            if (currency === 'USDT') {
                this.usdtBalance = free || 0;
            } else {
                items.push({
                    symbol: `${currency}/USDT`,
                    baseAsset: currency,
                    quoteAsset: 'USDT',
                    amount: free || 0,
                    lockedAmount: used || 0,
                    avgPurchasePrice: this.activeTrades.get(`${currency}/USDT`)?.purchasePrice,
                    purchaseTimestamp: this.activeTrades.get(`${currency}/USDT`)?.timestamp,
                });
            }
        }
      }
      this.portfolio = items;

      if (this.onPortfolioUpdate) this.onPortfolioUpdate(this.portfolio, this.usdtBalance);

    } catch (error: any) {
      this.log('ERROR', `Failed to refresh account: ${error.message}`);
    }
  }

  private async executeLoop() {
    if (this.isScanning) return;

    // Acquire lock for the entire iteration
    await this.mutex.runExclusive(async () => {
        if (this.isStopping || this.status !== BotStatus.RUNNING) return;

        this.isScanning = true;
        try {
            await this.refreshAccount();
            if (this.isStopping) return;

            await this.scanMarket();
            if (this.isStopping) return;

            await this.executeStrategy();
        } catch (error: any) {
            this.log('ERROR', `Error in bot loop: ${error.message}`);
        } finally {
            this.isScanning = false;
        }
    });
  }

  private async scanMarket() {
    try {
      const tickers = await this.exchange.fetchTickers();
      const candidates = tickers.filter(t =>
        t.symbol.endsWith('/USDT') &&
        t.baseVolume && t.baseVolume > 0 &&
        t.last !== undefined &&
        !EXCLUDED_SYMBOLS_BY_DEFAULT.some(ex => t.symbol.replace('/', '') === ex)
      ).sort((a, b) => (b.quoteVolume || 0) - (a.quoteVolume || 0));

      const topCandidates = candidates.slice(0, 30);

      const coinPromises = topCandidates.map(async (t) => {
        try {
           const ohlcv = await this.exchange.fetchOHLCV(t.symbol, '15m', 50);
           const closes = ohlcv.map(c => c[4]);

           let rsi = undefined;
           let smaShort = undefined;
           let smaLong = undefined;

           if (closes.length >= this.settings.rsiPeriod) {
               const rsiRes = RSI.calculate({ values: closes, period: this.settings.rsiPeriod } as any);
               if (rsiRes.length > 0) rsi = rsiRes[rsiRes.length - 1];
           }
           if (closes.length >= this.settings.smaShortPeriod) {
               const smaSRes = SMA.calculate({ values: closes, period: this.settings.smaShortPeriod } as any);
               if (smaSRes.length > 0) smaShort = smaSRes[smaSRes.length - 1];
           }
           if (closes.length >= this.settings.smaLongPeriod) {
               const smaLRes = SMA.calculate({ values: closes, period: this.settings.smaLongPeriod } as any);
               if (smaLRes.length > 0) smaLong = smaLRes[smaLRes.length - 1];
           }

           const base = t.symbol.split('/')[0];
           const quote = t.symbol.split('/')[1];

           return {
             id: t.symbol,
             symbol: t.symbol,
             name: base,
             price: t.last!,
             priceChange24hPercent: t.percentage || 0,
             baseAsset: base,
             quoteAsset: quote,
             volume: t.baseVolume || 0,
             quoteVolume: t.quoteVolume || 0,
             rsi,
             smaShort,
             smaLong
           } as Coin;

        } catch (e) {
            return null;
        }
      });

      const results = await Promise.all(coinPromises);
      this.marketData = results.filter((c): c is Coin => c !== null);
      this.marketData.sort((a, b) => a.price - b.price);

      if (this.onMarketUpdate) this.onMarketUpdate(this.marketData);

    } catch (error: any) {
      this.log('ERROR', `Market scan failed: ${error.message}`);
    }
  }

  private async executeStrategy() {
    // 1. Check Active Trades (Sell Logic)
    for (const [symbol, tradeData] of this.activeTrades.entries()) {
        // Kill switch check inside loop for faster response
        if (this.isStopping) break;

        const currentPrice = this.marketData.find(c => c.symbol === symbol)?.price;
        if (!currentPrice) continue;

        const portfolioItem = this.portfolio.find(p => p.symbol === symbol);

        if (!portfolioItem || portfolioItem.amount <= 0) {
             this.log('WARNING', `Trade recorded for ${symbol} but no balance found. Removing from history.`);
             this.activeTrades.delete(symbol);
             this.persistence.deleteActiveTrade(symbol);
             continue;
        }

        const initialStopLossPrice = tradeData.purchasePrice * (1 - this.settings.stopLossPercent / 100);
        let effectiveStopLossPrice = initialStopLossPrice;

        if (this.settings.useTrailingStop) {
            const currentHighest = tradeData.highestPriceSinceBuy || tradeData.purchasePrice;
             if (currentPrice > currentHighest) {
                tradeData.highestPriceSinceBuy = currentPrice;
                this.activeTrades.set(symbol, tradeData);
                this.persistence.saveActiveTrade(symbol, tradeData);
            }

            if (tradeData.highestPriceSinceBuy &&
                tradeData.highestPriceSinceBuy > tradeData.purchasePrice * (1 + this.settings.trailingStopArmPercentage / 100)) {
                effectiveStopLossPrice = tradeData.highestPriceSinceBuy * (1 - this.settings.trailingStopOffsetPercentage / 100);
            }
        }

        const targetPrice = tradeData.purchasePrice * (1 + this.settings.targetProfitPercent / 100);

        let shouldSell = false;
        let reason = '';

        if (currentPrice >= targetPrice) {
            shouldSell = true;
            reason = `Take Profit (${this.settings.targetProfitPercent}%)`;
        } else if (currentPrice <= effectiveStopLossPrice) {
             shouldSell = true;
             reason = `Stop Loss`;
        }

        if (shouldSell) {
            this.log('INFO', `Selling ${symbol}. Reason: ${reason}. Price: ${currentPrice}`);
            try {
                const amountToSell = portfolioItem.amount;
                const value = amountToSell * currentPrice;
                if (value < MIN_TRADE_VALUE_USDT) {
                     this.log('WARNING', `Skipping sell for ${symbol}: Value $${value.toFixed(2)} < Min $${MIN_TRADE_VALUE_USDT}`);
                     continue;
                }

                const order = await this.exchange.placeOrder(symbol, 'market', 'sell', amountToSell);
                const cost = order.cost || (order.amount * order.price);
                const profit = cost - (tradeData.purchasePrice * order.amount);
                const profitPercent = (profit / (tradeData.purchasePrice * order.amount)) * 100;

                const completedTrade: CompletedTrade = {
                    id: order.id,
                    timestamp: Date.now(),
                    type: 'SELL',
                    pair: symbol,
                    price: order.price || currentPrice,
                    amount: order.amount,
                    cost: cost,
                    orderId: order.id,
                    profitAmount: profit,
                    profitPercent: profitPercent,
                    purchasePriceForSell: tradeData.purchasePrice
                };

                this.tradeLedger.unshift(completedTrade);
                this.persistence.saveLedgerItem(completedTrade); // Save to DB
                if (this.onTradeLedgerUpdate) this.onTradeLedgerUpdate(this.tradeLedger);

                this.activeTrades.delete(symbol);
                this.persistence.deleteActiveTrade(symbol); // Remove from DB
                this.log('SUCCESS', `Sold ${symbol}. PnL: ${profitPercent.toFixed(2)}%`);

            } catch (e: any) {
                this.log('ERROR', `Failed to sell ${symbol}: ${e.message}`);
            }
        }
    }

    // 2. Check Buy Opportunities
    // Kill switch check
    if (this.isStopping) return;

    const potentialBuys = this.marketData.filter(c => {
        if (this.activeTrades.has(c.symbol)) return false;
        if (c.price > this.settings.maxCoinPrice) return false;
        if (EXCLUDED_SYMBOLS_BY_DEFAULT.some(ex => c.symbol.replace('/', '') === ex)) return false;

        if (c.rsi === undefined || c.smaShort === undefined || c.smaLong === undefined) return false;
        if (c.rsi >= this.settings.rsiBuyThreshold) return false;
        if (c.smaShort <= c.smaLong) return false;

        return true;
    }).sort((a, b) => b.quoteVolume - a.quoteVolume);

    if (potentialBuys.length > 0) {
        const candidate = potentialBuys[0];

        if (this.activeTrades.size >= this.settings.maxOpenTrades) return;

        // Double check balance inside lock
        if (this.usdtBalance < this.settings.tradeAmountUSDT) return;

        this.log('INFO', `Buying ${candidate.symbol}. Price: ${candidate.price}. RSI: ${candidate.rsi?.toFixed(2)}`);

        try {
            const amount = this.settings.tradeAmountUSDT / candidate.price;
            const order = await this.exchange.placeOrder(candidate.symbol, 'market', 'buy', amount);

            const realPrice = order.average || order.price || candidate.price;
            const filledAmount = order.filled || order.amount;

            const tradeRecord: BotTradeData = {
                purchasePrice: realPrice,
                amount: filledAmount,
                timestamp: Date.now(),
                highestPriceSinceBuy: realPrice
            };

            this.activeTrades.set(candidate.symbol, tradeRecord);
            this.persistence.saveActiveTrade(candidate.symbol, tradeRecord); // Save to DB

            const completedTrade: CompletedTrade = {
                id: order.id,
                timestamp: Date.now(),
                type: 'BUY',
                pair: candidate.symbol,
                price: realPrice,
                amount: filledAmount,
                cost: order.cost || (filledAmount * realPrice),
                orderId: order.id
            };
            this.tradeLedger.unshift(completedTrade);
            this.persistence.saveLedgerItem(completedTrade); // Save to DB
            if (this.onTradeLedgerUpdate) this.onTradeLedgerUpdate(this.tradeLedger);

            this.log('SUCCESS', `Bought ${candidate.symbol} at ${realPrice}`);
        } catch (e: any) {
            this.log('ERROR', `Failed to buy ${candidate.symbol}: ${e.message}`);
        }
    }
  }
}
