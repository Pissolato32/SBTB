
// Represents a coin's market data from Binance API (24hr ticker)
export interface Coin {
  id: string; // symbol, e.g. "SHIBUSDT"
  symbol: string; // e.g. "SHIBUSDT"
  name: string;   // Derived: e.g. "Shiba Inu" (Base Asset Name)
  price: number; // lastPrice
  priceChange24hPercent: number; // priceChangePercent
  baseAsset: string; // e.g. "SHIB"
  quoteAsset: string; // e.g. "USDT"
  volume: number; // total traded base asset volume
  quoteVolume: number; // total traded quote asset volume
  // Novos campos para indicadores técnicos (vindos do backend)
  rsi?: number; // Ex: RSI de 14 períodos
  smaShort?: number; // Valor da SMA de período curto
  smaLong?: number;  // Valor da SMA de período longo
  lastQty?: string; // Última quantidade negociada (do stream de ticker)
}

// Represents an asset held in the portfolio, primarily based on account balance
export interface PortfolioItem {
  symbol: string; // e.g. "SHIBUSDT"
  baseAsset: string; // e.g. "SHIB"
  quoteAsset: string; // e.g. "USDT"
  amount: number; // Amount of baseAsset held (free balance)
  lockedAmount: number; // Amount of baseAsset locked in orders
  // Bot-managed properties for P/L on its own trades:
  avgPurchasePrice?: number; // Average price this bot session paid for this asset
  purchaseTimestamp?: number; // Timestamp of first purchase by bot this session
}

export enum BotStatus { // Exporta o enum
  STOPPED = 'STOPPED',
  RUNNING = 'RUNNING',
  ERROR = 'ERROR',
  INITIALIZING = 'INITIALIZING', // New status for API key check / initial load
}

export interface BotSettings {
  maxCoinPrice: number; // in USDT
  tradeAmountUSDT: number;
  scanIntervalMs: number;
  targetProfitPercent: number;
  stopLossPercent: number;
  maxOpenTrades: number; // Novo: Limite de trades abertos simultaneamente
  // Novas configurações para indicadores (Nível 2.1)
  rsiPeriod: number;
  rsiBuyThreshold: number;
  smaShortPeriod: number; // Período para a SMA curta
  smaLongPeriod: number;  // Período para a SMA longa (anteriormente smaPeriod)
  // Novas configurações para Trailing Stop-Loss (Nível 3)
  useTrailingStop: boolean;
  trailingStopArmPercentage: number; // % de lucro para armar o trailing stop
  trailingStopOffsetPercentage: number; // % abaixo do preço máximo para o stop
  // klineInterval: string; // Ex: '5m', '15m', '1h' - Se o backend for suportar isso dinamicamente
}

// Em c:\Users\rodri\Desktop\SBTB\src\types.ts (ou onde suas types globais estão)
export interface BotLog {
  id: string; // Identificador único do log
  timestamp: number; // Timestamp Unix em milissegundos
  type: 'BUY' | 'SELL' | 'ERROR' | 'INFO' | 'SUCCESS' | 'WARNING' | 'API_KEY' | 'STRATEGY_INFO' | 'DEBUG';
  message: string; // Mensagem principal. Para STRATEGY_INFO, pode ser a lógica da decisão.

  // Campos opcionais para logs de transação (BUY/SELL)
  pair?: string;         // Ex: "BTC/USDT"
  orderId?: string;      // ID da ordem na exchange
  orderType?: 'market' | 'limit' | string; // Tipo da ordem
  price?: number;        // Preço de execução
  amount?: number;       // Quantidade do ativo base transacionado
  cost?: number;         // Custo total ou recebido na moeda de cotação (ex: USDT)
  
  // Específico para logs de VENDA ou quando uma trade é fechada
  profitAmount?: number;    // Lucro/Prejuízo na moeda de cotação
  profitPercent?: number; // Lucro/Prejuízo em porcentagem

  // Opcional: Detalhes de taxas
  feeCurrency?: string;
  feeAmount?: number;

  // Opcional: Motivo da transação, se não estiver na mensagem principal.
  // Para STRATEGY_INFO, 'message' conteria o motivo.
  // Para BUY/SELL, se 'message' for genérica como "Ordem executada", 'reason' pode conter o sinal da estratégia.
  reason?: string; 
}

// Interface para o histórico detalhado de transações (Trade Ledger)
export interface CompletedTrade {
  id: string;                     // Identificador único da transação
  timestamp: number;              // Timestamp Unix em milissegundos
  type: 'BUY' | 'SELL';           // Tipo da transação
  pair: string;                   // Par de moedas (ex: "BTC/USDT")
  price: number;                  // Preço de execução
  amount: number;                 // Quantidade do ativo base transacionado
  cost: number;                   // Custo total (para BUY em USDT) ou valor recebido (para SELL em USDT)
  orderId?: string;               // ID da ordem na exchange
  feeAmount?: number;             // Taxa da transação (opcional, se disponível)
  feeCurrency?: string;           // Moeda da taxa (opcional)
  // Específico para transações de VENDA
  profitAmount?: number;          // Lucro/Prejuízo na moeda de cotação (USDT)
  profitPercent?: number;       // Lucro/Prejuízo em porcentagem
  purchasePriceForSell?: number;  // Preço de compra que foi usado para calcular o P/L desta venda específica
}

// Binance API specific types
export interface BinanceRawTicker {
  symbol: string;
  priceChange: string;
  priceChangePercent: string;
  weightedAvgPrice: string;
  prevClosePrice: string;
  lastPrice: string;
  lastQty: string;
  bidPrice: string;
  bidQty: string;
  askPrice: string;
  askQty: string;
  openPrice: string;
  highPrice: string;
  lowPrice: string;
  volume: string; // Traded base asset volume
  quoteVolume: string; // Traded quote asset volume
  openTime: number;
  closeTime: number;
  firstId: number;
  lastId: number;
  count: number;
}

export interface BinanceAccountBalance {
  asset: string;
  free: string;
  locked: string;
}

export interface BinanceAccountInfo {
  makerCommission: number;
  takerCommission: number;
  buyerCommission: number;
  sellerCommission: number;
  canTrade: boolean;
  canWithdraw: boolean;
  canDeposit: boolean;
  updateTime: number;
  accountType: string;
  balances: BinanceAccountBalance[];
  permissions: string[];
}

export interface BinanceOrderResponse {
  symbol: string;
  orderId: number;
  orderListId: number; // Unless OCO, value will be -1
  clientOrderId: string;
  transactTime: number;
  price: string;
  origQty: string; // Original quantity
  executedQty: string; // Executed quantity
  cummulativeQuoteQty: string; // Cumulative quote asset transacted
  status: string; // e.g., FILLED, PARTIALLY_FILLED
  timeInForce: string;
  type: string; // e.g., MARKET, LIMIT
  side: string; // BUY or SELL
  fills?: { // Array of fill details; only for MARKET and LIMIT orders
    price: string;
    qty: string;
    commission: string;
    commissionAsset: string;
    tradeId: number;
  }[];
}

// Adicionando a interface ExchangeInfo que estava faltando no types.ts mas era usada no server.ts
export interface LotSizeFilter {
  filterType: 'LOT_SIZE';
  minQty: string;
  maxQty: string;
  stepSize: string;
}

export interface PriceFilter {
  filterType: 'PRICE_FILTER';
  minPrice: string;
  maxPrice: string;
  tickSize: string;
}

export type SymbolFilter = LotSizeFilter | PriceFilter | { filterType: string; [key: string]: any };

export interface SymbolInfo {
  symbol: string;
  status: string;
  baseAsset: string;
  baseAssetPrecision: number;
  quoteAsset: string;
  quotePrecision: number;
  quoteAssetPrecision: number;
  orderTypes: string[];
  icebergAllowed: boolean;
  ocoAllowed: boolean;
  quoteOrderQtyMarketAllowed: boolean;
  allowTrailingStop: boolean;
  cancelReplaceAllowed: boolean;
  isSpotTradingAllowed: boolean;
  isMarginTradingAllowed: boolean;
  filters: SymbolFilter[];
  permissions: string[];
  defaultSelfTradePreventionMode: string;
  allowedSelfTradePreventionModes: string[];
}

export interface ExchangeInfo {
  timezone: string;
  serverTime: number;
  rateLimits: any[]; // Pode ser mais específico se necessário
  exchangeFilters: any[]; // Pode ser mais específico se necessário
  symbols: SymbolInfo[];
}

// Definindo BinanceError aqui para ser a única fonte da verdade
export interface BinanceError {
  code: number;
  msg: string;
}
