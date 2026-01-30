import { IExchange } from './ExchangeService.js';
import { PersistenceService, BotTradeData } from './PersistenceService.js';
import { BotSettings, BotStatus, Coin, CompletedTrade, PortfolioItem } from '../../src/types.js';
import { MIN_TRADE_VALUE_USDT, EXCLUDED_SYMBOLS_BY_DEFAULT } from '../../src/constants.js';
import { RSI, SMA } from 'technicalindicators';

export class BotEngine {
  private exchange: IExchange;
  private persistence: PersistenceService;

  public status: BotStatus = BotStatus.INITIALIZING;
  public settings: BotSettings;
  public tradeLedger: CompletedTrade[] = [];
  public activeTrades: Map<string, BotTradeData> = new Map();
  public marketData: Coin[] = [];
  public portfolio: PortfolioItem[] = [];
  public usdtBalance: number = 0;

  private scanTimer: NodeJS.Timeout | null = null;
  private isScanning: boolean = false;

  // Events
  public onMarketUpdate: ((coins: Coin[]) => void) | null = null;
  public onStatusUpdate: ((status: BotStatus) => void) | null = null;
  public onLog: ((log: any) => void) | null = null;
  public onPortfolioUpdate: ((portfolio: PortfolioItem[], balance: number) => void) | null = null;
  public onTradeLedgerUpdate: ((ledger: CompletedTrade[]) => void) | null = null;

  constructor(exchange: IExchange, persistence: PersistenceService, initialSettings: BotSettings) {
    this.exchange = exchange;
    this.persistence = persistence;
    this.settings = initialSettings;

    // Load persisted state
    const loadedData = this.persistence.loadData();
    if (loadedData.trades.size > 0) {
      this.activeTrades = loadedData.trades;
      this.log('INFO', `Loaded ${this.activeTrades.size} active trades from persistence.`);
    }
    if (loadedData.settings) {
        // Merge loaded settings with defaults, prioritizing loaded ones
        this.settings = { ...this.settings, ...loadedData.settings };
        this.log('INFO', `Loaded settings from persistence.`);
    }
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
      await this.refreshAccount();
    } catch (error: any) {
      this.log('ERROR', `Initialization failed: ${error.message}`);
      this.setStatus(BotStatus.ERROR);
    }
  }

  async start() {
    if (this.status === BotStatus.RUNNING) {
        this.log('WARNING', 'Bot is already running.');
        return;
    }

    this.log('INFO', 'Starting Bot...');
    this.setStatus(BotStatus.RUNNING);

    // Start loop
    if (this.scanTimer) clearInterval(this.scanTimer);
    this.scanTimer = setInterval(() => this.executeLoop(), this.settings.scanIntervalMs);

    // Execute immediately
    this.executeLoop();
  }

  async stop() {
    this.log('INFO', 'Stopping Bot...');
    if (this.scanTimer) clearInterval(this.scanTimer);
    this.scanTimer = null;
    this.setStatus(BotStatus.STOPPED);
  }

  updateSettings(newSettings: BotSettings) {
    const oldMaxPrice = this.settings.maxCoinPrice;
    this.settings = { ...this.settings, ...newSettings };
    this.persistence.saveData(this.activeTrades, this.settings);
    this.log('INFO', 'Settings updated.');

    // Re-filter existing market data if price limit changed
    if (this.settings.maxCoinPrice !== oldMaxPrice) {
      this.marketData = this.marketData.filter(c => c.price <= this.settings.maxCoinPrice);
      if (this.onMarketUpdate) this.onMarketUpdate(this.marketData);
    }

    // Restart loop if running to apply interval change
    if (this.status === BotStatus.RUNNING && this.scanTimer) {
        clearInterval(this.scanTimer);
        this.scanTimer = setInterval(() => this.executeLoop(), this.settings.scanIntervalMs);
    }
  }

  private async refreshAccount() {
    try {
      const balance = await this.exchange.getBalance();

      // Map to PortfolioItem
      // CCXT 'total' gives the total balance. 'free' and 'used' (locked) are also available.
      // We want non-zero assets.
      const items: PortfolioItem[] = [];
      const currencies = Object.keys(balance.total);

      for (const currency of currencies) {
        const total = (balance.total as any)[currency];
        const free = (balance.free as any)[currency];
        const used = (balance.used as any)[currency];

        if (total && total > 0) {
            // Note: In CCXT, we don't always know the quote asset easily for the portfolio view
            // unless we assume everything is paired with USDT or we fetch all markets.
            // For now, we assume X/USDT exists for valuation purposes or just list the asset.

            if (currency === 'USDT') {
                this.usdtBalance = free || 0;
            } else {
                items.push({
                    symbol: `${currency}/USDT`, // Assumption: displayed as pair
                    baseAsset: currency,
                    quoteAsset: 'USDT',
                    amount: free || 0,
                    lockedAmount: used || 0,
                    // Re-attach bot specific data
                    avgPurchasePrice: this.activeTrades.get(`${currency}/USDT`)?.purchasePrice,
                    purchaseTimestamp: this.activeTrades.get(`${currency}/USDT`)?.timestamp,
                });
            }
        }
      }
      this.portfolio = items;

      if (this.onPortfolioUpdate) this.onPortfolioUpdate(this.portfolio, this.usdtBalance);
      this.log('INFO', `Account refreshed. USDT Balance: ${this.usdtBalance.toFixed(2)}`);

    } catch (error: any) {
      this.log('ERROR', `Failed to refresh account: ${error.message}`);
    }
  }

  private async executeLoop() {
    if (this.isScanning) return;
    this.isScanning = true;

    try {
      await this.refreshAccount();
      await this.scanMarket();
      await this.executeStrategy();
    } catch (error: any) {
      this.log('ERROR', `Error in bot loop: ${error.message}`);
    } finally {
      this.isScanning = false;
    }
  }

  private async scanMarket() {
    try {
      // 1. Fetch Tickers
      const tickers = await this.exchange.fetchTickers();
      // Filter for USDT pairs, high volume, not excluded
      const candidates = tickers.filter(t =>
        t.symbol.endsWith('/USDT') &&
        t.baseVolume && t.baseVolume > 0 &&
        t.last !== undefined &&
        t.last <= this.settings.maxCoinPrice && // Filter by max price
        !EXCLUDED_SYMBOLS_BY_DEFAULT.some(ex => t.symbol.replace('/', '') === ex) // Check exclusion
      ).sort((a, b) => (b.quoteVolume || 0) - (a.quoteVolume || 0));

      const topCandidates = candidates.slice(0, 30); // Analyze top 30 by volume

      // 2. Fetch OHLCV and Calculate Indicators for top candidates
      const coins: Coin[] = [];

      // We process candidates in parallel (with some concurrency limit if needed, but 30 is small)
      // Actually, sequential is safer for rate limits if we are aggressive.
      // Let's do `Promise.all` but maybe CCXT handles queueing? CCXT has built-in rate limiter if enabled.
      // We enabled it in ExchangeService.

      const coinPromises = topCandidates.map(async (t) => {
        try {
           const ohlcv = await this.exchange.fetchOHLCV(t.symbol, '15m', 50); // Hardcoded 15m for now as per original
           const closes = ohlcv.map(c => c[4]).filter((v): v is number => typeof v === 'number');

           let rsi = undefined;
           let smaShort = undefined;
           let smaLong = undefined;

           if (closes.length >= this.settings.rsiPeriod) {
               const rsiRes = RSI.calculate({ values: closes, period: this.settings.rsiPeriod });
               if (rsiRes.length > 0) rsi = rsiRes[rsiRes.length - 1];
           }
           if (closes.length >= this.settings.smaShortPeriod) {
               const smaSRes = SMA.calculate({ values: closes, period: this.settings.smaShortPeriod });
               if (smaSRes.length > 0) smaShort = smaSRes[smaSRes.length - 1];
           }
           if (closes.length >= this.settings.smaLongPeriod) {
               const smaLRes = SMA.calculate({ values: closes, period: this.settings.smaLongPeriod });
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
            // console.error(`Failed to process ${t.symbol}`, e);
            return null;
        }
      });

      const results = await Promise.all(coinPromises);
      this.marketData = results.filter((c): c is Coin => c !== null);

      // Sort by price for frontend display consistency or whatever
      this.marketData.sort((a, b) => a.price - b.price);

      if (this.onMarketUpdate) this.onMarketUpdate(this.marketData);

    } catch (error: any) {
      this.log('ERROR', `Market scan failed: ${error.message}`);
    }
  }

  private async executeStrategy() {
    // 1. Check Active Trades (Sell Logic)
    for (const [symbol, tradeData] of this.activeTrades.entries()) {
        const currentPrice = this.marketData.find(c => c.symbol === symbol)?.price;
        if (!currentPrice) continue; // Price not updated this scan? Skip.

        const portfolioItem = this.portfolio.find(p => p.symbol === symbol);
        // CCXT balance keys are usually base assets (BTC). Portfolio symbol is BTC/USDT.
        // My portfolio logic constructed symbols as 'BTC/USDT'.

        if (!portfolioItem || portfolioItem.amount <= 0) {
             // Lost sync? Or sold externally?
             this.log('WARNING', `Trade recorded for ${symbol} but no balance found. Removing from history.`);
             this.activeTrades.delete(symbol);
             this.persistence.saveData(this.activeTrades, this.settings);
             continue;
        }

        // Logic
        const initialStopLossPrice = tradeData.purchasePrice * (1 - this.settings.stopLossPercent / 100);
        let effectiveStopLossPrice = initialStopLossPrice;

        if (this.settings.useTrailingStop) {
            const currentHighest = tradeData.highestPriceSinceBuy || tradeData.purchasePrice;
             if (currentPrice > currentHighest) {
                tradeData.highestPriceSinceBuy = currentPrice;
                // Update persistence if we track high water mark
                this.activeTrades.set(symbol, tradeData);
                // We might want to save less frequently to avoid disk IO spam, but for now it's safe.
                this.persistence.saveData(this.activeTrades, this.settings);
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
                // CCXT placeOrder amount is usually base asset.
                // We sell all available free amount.
                const amountToSell = portfolioItem.amount;
                // Ensure min trade value?
                const value = amountToSell * currentPrice;
                if (value < MIN_TRADE_VALUE_USDT) {
                     this.log('WARNING', `Skipping sell for ${symbol}: Value $${value.toFixed(2)} < Min $${MIN_TRADE_VALUE_USDT}`);
                     continue;
                }

                const order = await this.exchange.placeOrder(symbol, 'market', 'sell', amountToSell);
                
                // Use a more robust price detection
                const executionPrice = order.average || order.price || currentPrice;
                const filledAmount = order.filled || order.amount || amountToSell;
                const cost = order.cost || (filledAmount * executionPrice);
                
                const profit = cost - (tradeData.purchasePrice * filledAmount);
                const profitPercent = (profit / (tradeData.purchasePrice * filledAmount)) * 100;

                const completedTrade: CompletedTrade = {
                    id: order.id || `sell-${Date.now()}`,
                    timestamp: Date.now(),
                    type: 'SELL',
                    pair: symbol,
                    price: executionPrice,
                    amount: filledAmount,
                    cost: cost,
                    orderId: order.id,
                    profitAmount: profit,
                    profitPercent: profitPercent,
                    purchasePriceForSell: tradeData.purchasePrice
                };

                this.tradeLedger.unshift(completedTrade);
                if (this.onTradeLedgerUpdate) this.onTradeLedgerUpdate(this.tradeLedger);

                this.activeTrades.delete(symbol);
                this.persistence.saveData(this.activeTrades, this.settings);
                this.log('SUCCESS', `Sold ${symbol}. PnL: ${profitPercent.toFixed(2)}%`);

            } catch (e: any) {
                this.log('ERROR', `Failed to sell ${symbol}: ${e.message}`);
            }
        }
    }

    // 2. Check Buy Opportunities
    // Filter candidates
    const potentialBuys = this.marketData.filter(c => {
        if (this.activeTrades.has(c.symbol)) return false;
        if (c.price > this.settings.maxCoinPrice) return false;
        if (EXCLUDED_SYMBOLS_BY_DEFAULT.some(ex => c.symbol.replace('/', '') === ex)) return false;

        // Indicators
        if (c.rsi === undefined || c.smaShort === undefined || c.smaLong === undefined) return false;
        if (c.rsi >= this.settings.rsiBuyThreshold) return false;
        if (c.smaShort <= c.smaLong) return false;

        return true;
    }).sort((a, b) => b.quoteVolume - a.quoteVolume); // Highest volume first

    if (potentialBuys.length > 0) {
        const candidate = potentialBuys[0];

        if (this.activeTrades.size >= this.settings.maxOpenTrades) {
             // this.log('INFO', 'Max open trades reached. Skipping buy.');
             return;
        }

        if (this.usdtBalance < this.settings.tradeAmountUSDT) {
            // this.log('INFO', 'Insufficient balance for buy.');
            return;
        }

        this.log('INFO', `Buying ${candidate.symbol}. Price: ${candidate.price}. RSI: ${candidate.rsi?.toFixed(2)}`);

        try {
            // Calculate amount based on tradeAmountUSDT
            // amount = tradeAmountUSDT / price
            const amount = this.settings.tradeAmountUSDT / candidate.price;

            const order = await this.exchange.placeOrder(candidate.symbol, 'market', 'buy', amount);

            const realPrice = order.average || order.price || candidate.price; 
            const filledAmount = order.filled || order.amount || amount; 

            const tradeRecord: BotTradeData = {
                purchasePrice: realPrice,
                amount: filledAmount,
                timestamp: Date.now(),
                highestPriceSinceBuy: realPrice
            };

            this.activeTrades.set(candidate.symbol, tradeRecord);
            this.persistence.saveData(this.activeTrades, this.settings);

            const completedTrade: CompletedTrade = {
                id: order.id || `buy-${Date.now()}`,
                timestamp: Date.now(),
                type: 'BUY',
                pair: candidate.symbol,
                price: realPrice,
                amount: filledAmount,
                cost: order.cost || (filledAmount * realPrice),
                orderId: order.id
            };
            this.tradeLedger.unshift(completedTrade);
             if (this.onTradeLedgerUpdate) this.onTradeLedgerUpdate(this.tradeLedger);

            this.log('SUCCESS', `Bought ${candidate.symbol} at ${realPrice}`);
        } catch (e: any) {
            this.log('ERROR', `Failed to buy ${candidate.symbol}: ${e.message}`);
        }
    }
  }
}
