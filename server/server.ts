import express, { Request, Response, NextFunction } from 'express';
import axios from 'axios';
import crypto from 'crypto';
import * as dotenv from 'dotenv';
import { RSI, SMA } from 'technicalindicators';
import WebSocket, { WebSocketServer } from 'ws';
// --- Backend-Frontend WebSocket Server ---
import http from 'http'; // Importar http para criar o servidor
import { BotSettings, BotLog, Coin, PortfolioItem, BinanceAccountInfo, CompletedTrade, BotStatus, BinanceError, LotSizeFilter, ExchangeInfo } from '../src/types.js'; // Importar tipos do frontend
import { MIN_TRADE_VALUE_USDT, BINANCE_TESTNET_API_URL } from '../src/constants.js'; // Importar constantes do frontend

import cors from 'cors'; // Import cors
dotenv.config(); // Loads .env file from the current directory (server/.env)

const app = express();
app.use(express.json()); // Middleware to parse JSON bodies
app.use(cors()); // Enable CORS for all routes

const { BINANCE_TESTNET_API_KEY, BINANCE_TESTNET_SECRET_KEY, PORT = 3001 } = process.env;
const DEFAULT_RECEIVE_WINDOW = 5000;
const EXCLUDED_SYMBOLS_BY_DEFAULT: string[] = ["BTCUSDT", "ETHUSDT", "BNBUSDT"];

// Interface para os dados brutos do stream de tickers da Binance
interface BinanceRawTickerStreamData {
  e: string; // Event type (e.g., "24hrTicker")
  E: number; // Event time
  s: string; // Symbol
  p: string; // Price change
  P: string; // Price change percent
  w: string; // Weighted average price
  x: string; // First trade(F)-1 price (First trade before 24hr rolling window)
  c: string; // Last price
  Q: string; // Last quantity
  b: string; // Best bid price
  B: string; // Best bid quantity
  a: string; // Best ask price
  A: string; // Best ask quantity
  o: string; // Open price
  h: string; // High price
  l: string; // Low price
  v: string; // Total traded base asset volume in last 24hrs
  q: string; // Total traded quote asset volume in last 24hrs
  O: number; // Open time
  C: number; // Close time
  F: number; // First trade ID
  L: number; // Last trade ID
  n: number; // Total number of trades
}

// Interface para os dados de ticker 24hr que armazenamos (após processamento do stream)
interface BinanceTicker24hr {
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
  volume: string; // Total traded base asset volume
  quoteVolume: string; // Total traded quote asset volume
  openTime: number;
  closeTime: number;
  firstId: number; // First tradeId
  lastId: number; // Last tradeId
  count: number; // Total number of trades
}

// Function to create HMAC SHA256 signature
function createSignature(queryString: string, apiSecret: string): string {
  return crypto.createHmac('sha256', apiSecret).update(queryString).digest('hex');
}

// Cache para Exchange Info
let exchangeInfoCache: ExchangeInfo | null = null;
let lastExchangeInfoFetchTime: number = 0;
const EXCHANGE_INFO_CACHE_DURATION = 1000 * 60 * 60; // Cache por 1 hora

async function getExchangeInfo(): Promise<ExchangeInfo> {
  const now = Date.now();
  if (exchangeInfoCache && (now - lastExchangeInfoFetchTime < EXCHANGE_INFO_CACHE_DURATION)) {
    console.log('[Backend] Using cached exchangeInfo.');
    return exchangeInfoCache;
  }
  try {
    broadcastLog({ message: 'Backend: Fetching new exchangeInfo from Binance...', type: 'INFO' });
    const info = await callBinanceApi<ExchangeInfo>('/v3/exchangeInfo', 'GET', {}, false);
    exchangeInfoCache = info;
    lastExchangeInfoFetchTime = now;
    broadcastLog({ message: 'Backend: ExchangeInfo fetched and cached.', type: 'INFO' });
    return info;
  } catch (error: any) {
    console.error(`[Backend] Failed to fetch exchangeInfo: ${error.message || JSON.stringify(error)}`);
    if (exchangeInfoCache) {
        console.warn('[Backend] Serving stale exchangeInfo due to fetch failure.');
        return exchangeInfoCache; // Retorna o cache antigo se a nova busca falhar
    }
    throw error; // Lança o erro se não houver cache algum
  }
}

// Função utilitária para formatar a quantidade de acordo com o stepSize
function formatQuantityByStepSize(quantity: number, stepSize: string): string {
  const step = parseFloat(stepSize);
  if (isNaN(step) || step <= 0) {
    return quantity.toFixed(8);
  }
  const decimalPlaces = stepSize.includes('.') ? stepSize.split('.')[1].length : 0;
  const formattedQuantity = Math.floor(quantity / step) * step;
  if (Object.is(formattedQuantity, -0)) {
    return (0).toFixed(decimalPlaces);
  }
  return formattedQuantity.toFixed(decimalPlaces);
}

// Function to broadcast status updates to all connected frontend clients
function broadcastStatusUpdate(status: BotStatus) {
  clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
          client.send(JSON.stringify({ type: 'status', status: status }));
      }
  });
}

// --- WebSocket Management for Tickers ---
let liveTickerData: { [symbol: string]: BinanceTicker24hr } = {};
// let tickerWs: WebSocket | null = null; // This variable was declared but its value is never read. Consider removing or using it.
let tickerWsReconnectAttempts = 0;
const MAX_TICKER_WS_RECONNECT_ATTEMPTS = 5;

// --- WebSocket Management and Data Cache for Klines & Indicators ---
let klineWs: WebSocket | null = null;
// let klineWsReconnectAttempts = 0; // Removed as it's not used in the current passive reconnect logic
const KLINE_INTERVAL = '15m'; // Fixed for now, could be made configurable
const KLINE_BUFFER_SIZE_MULTIPLIER = 2; // How many times the longest period to keep in buffer

interface KlineDataBuffer {
  closes: number[];
  lastUpdate: number;
}
let klineDataBuffers: Map<string, KlineDataBuffer> = new Map(); // symbol -> KlineDataBuffer
let coinDataWithIndicatorsCache: Map<string, Coin> = new Map(); // symbol -> Coin (type from src/types.ts)

// --- Bot State and Configuration (Managed by Backend, can be updated by Frontend) ---
let botStatus: BotStatus = BotStatus.INITIALIZING;
let botSettings: BotSettings = { // Default settings, will be updated by frontend
    maxCoinPrice: 0.50,
    tradeAmountUSDT: 11,
    scanIntervalMs: 7000,
    targetProfitPercent: 3,
    stopLossPercent: 1.5,
    maxOpenTrades: 5,
    rsiPeriod: 14,
    rsiBuyThreshold: 30,
    smaShortPeriod: 9,
    smaLongPeriod: 21,
    useTrailingStop: false,
    trailingStopArmPercentage: 1.0,
    trailingStopOffsetPercentage: 0.5,
};
let botInterval: NodeJS.Timeout | null = null; // Use NodeJS.Timeout for backend intervals

// Bot's internal trade history (Managed by Backend) - Represents active trades
interface BotTradeData {
  purchasePrice: number;
  amount: number; // Quantidade comprada inicialmente
  timestamp: number;
  highestPriceSinceBuy?: number; // For Trailing Stop
}
let botTradeHistory: Map<string, BotTradeData> = new Map(); // symbol -> BotTradeData
let tradeLedger: CompletedTrade[] = []; // Initialized as empty array

// Account Data Cache (Managed by Backend, will be updated by User Data Stream or polling)
let currentAccountInfo: BinanceAccountInfo | null = null; // To be used by backend bot logic
let currentUSDTBalance: number = 0;
let currentPortfolio: PortfolioItem[] = [];

// --- Backend-Frontend WebSocket Server ---
const clients: Set<WebSocket> = new Set(); // Set to keep track of connected clients
const server = http.createServer(app); // Create HTTP server
const wss = new WebSocketServer({ server }); // Create WebSocket server on top of HTTP server

wss.on('connection', (ws: WebSocket) => {
  clients.add(ws);
  console.log('[Backend-Frontend WS] Client connected.');

  sendInitialStateToClient(ws);

  ws.on('message', (message: WebSocket.Data) => {
    try {
        const msg = JSON.parse(message.toString());
        if (msg.type === 'command') {
            handleFrontendCommand(msg.command, msg.payload);
        } else if (msg.type === 'settings') {
            handleSettingsUpdate(msg.payload);
        }
    } catch (error) {
        console.error('[Backend-Frontend WS] Failed to parse message from client:', error);
    }
  });

  ws.on('close', () => {
    clients.delete(ws);
    console.log('[Backend-Frontend WS] Client disconnected.');
  });

  ws.on('error', (error: Error) => {
    console.error('[Backend-Frontend WS] WebSocket error:', error);
    clients.delete(ws);
  });
});

function sendInitialStateToClient(ws: WebSocket) {
    const initialState = {
      type: 'initial_state',
      payload: {
          botStatus,
          settings: botSettings,
          logs: [],
          portfolio: currentPortfolio || [],
          usdtBalance: currentUSDTBalance,
          tradeLedger: tradeLedger || [],
          marketData: Array.from(coinDataWithIndicatorsCache.values())
      }
  };
  ws.send(JSON.stringify(initialState));
  broadcastLog({ message: 'Backend: Sent initial state to new client.', type: 'INFO' });
}
let subscribedKlineSymbols: Set<string> = new Set();

function handleFrontendCommand(command: string, payload: any) {
  broadcastLog({ message: `Backend: Received command: ${command}${payload ? ` with payload: ${JSON.stringify(payload)}` : ''}`, type: 'INFO' });
  switch (command) {
      case 'START_BOT':
          startBotLogic();
          break;
      case 'STOP_BOT':
          stopBotLogic();
          break;
      default:
          broadcastLog({ message: `Backend: Unknown command received: ${command}`, type: 'WARNING' });
  }
}

function handleSettingsUpdate(newSettings: BotSettings) {
  const oldScanInterval = botSettings.scanIntervalMs;
  botSettings = { ...botSettings, ...newSettings };
  broadcastLog({ message: `Backend: Bot settings updated by frontend. New scan interval: ${botSettings.scanIntervalMs}ms`, type: 'INFO' });
  if (botStatus === BotStatus.RUNNING && botInterval && oldScanInterval !== botSettings.scanIntervalMs) {
    clearInterval(botInterval);
    botInterval = setInterval(executeBotLogic, botSettings.scanIntervalMs);
    broadcastLog({ message: `Backend: Bot scan interval updated to ${botSettings.scanIntervalMs / 1000}s and restarted.`, type: 'INFO' });
  }
  // TODO: Add persistence logic for botSettings (save to file/DB)
}

function connectToAllMarketTickersStream() {
  // Using the /stream?streams=... format for combined streams, which is also standard.
  // Reverting to /ws/!ticker@arr as another attempt, as /stream?streams= also resulted in 404.
  // ATENÇÃO: A linha abaixo está configurada para testar com 'btcusdt@ticker'. 
  // Se quiser voltar para '!ticker@arr', descomente a linha apropriada e comente a outra.
  const currentStreamName = 'btcusdt@ticker'; // ou '!ticker@arr'
  const wsUrl = `wss://testnet.binance.vision/ws/${currentStreamName}`;
  broadcastLog({ message: `Backend: Attempting to connect to ticker stream: ${wsUrl}`, type: 'INFO' });
  const ws = new WebSocket(wsUrl);

  ws.on('error', (error: Error) => {
    // Este evento 'error' pode ser emitido ANTES do 'open' ou 'unexpected-response' se houver um problema fundamental na conexão.
    // O evento 'close' será emitido depois.
    broadcastLog({ message: `Backend: WebSocket connection error for ${currentStreamName} stream: ${error.message}`, type: 'ERROR' });
    // Não precisamos chamar ws.terminate() aqui, pois o evento 'close' cuidará da lógica de reconexão.
  });

  ws.on('open', () => {
    broadcastLog({ message: 'Backend: Connected to Binance !ticker@arr stream.', type: 'INFO' });
    tickerWsReconnectAttempts = 0;
    setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.ping(() => {});
      }
    }, 30000);
  });

  ws.on('ping', (_data: Buffer) => {
    if (ws.readyState === WebSocket.OPEN) ws.pong(() => {});
  });

  ws.on('pong', () => {
    // console.debug('[Backend Ticker WS] Received pong from server');
  });

  ws.on('message', (data: WebSocket.Data) => {
    try {
      const rawTickers: BinanceRawTickerStreamData[] = JSON.parse(data.toString());
      for (const rawTicker of rawTickers) {
        if (rawTicker.e !== "24hrTicker") continue;

        const symbol = rawTicker.s;
        const lastPrice = parseFloat(rawTicker.c);
        const quoteVolume = parseFloat(rawTicker.q);

        liveTickerData[symbol] = {
          symbol: rawTicker.s,
          priceChange: rawTicker.p,
          priceChangePercent: rawTicker.P,
          weightedAvgPrice: rawTicker.w,
          prevClosePrice: rawTicker.x,
          lastPrice: rawTicker.c,
          lastQty: rawTicker.Q,
          bidPrice: rawTicker.b,
          bidQty: rawTicker.B,
          askPrice: rawTicker.a,
          askQty: rawTicker.A,
          openPrice: rawTicker.o,
          highPrice: rawTicker.h,
          lowPrice: rawTicker.l,
          volume: rawTicker.v,
          quoteVolume: rawTicker.q,
          openTime: rawTicker.O,
          closeTime: rawTicker.C,
          firstId: rawTicker.F,
          lastId: rawTicker.L,
          count: rawTicker.n,
        };

        let cachedCoin = coinDataWithIndicatorsCache.get(symbol);
        if (!cachedCoin) {
          cachedCoin = {
            id: symbol,
            symbol: symbol,
            name: symbol.replace('USDT', ''),
            baseAsset: symbol.replace('USDT', ''),
            quoteAsset: 'USDT',
            price: lastPrice,
            priceChange24hPercent: parseFloat(rawTicker.P),
            volume: parseFloat(rawTicker.v),
            quoteVolume: quoteVolume,
            lastQty: rawTicker.Q,
          } as Coin;
        } else {
            cachedCoin.price = lastPrice;
            cachedCoin.priceChange24hPercent = parseFloat(rawTicker.P);
            cachedCoin.volume = parseFloat(rawTicker.v);
            cachedCoin.quoteVolume = quoteVolume;
            cachedCoin.lastQty = rawTicker.Q;
        }
        coinDataWithIndicatorsCache.set(symbol, cachedCoin);

        clients.forEach(client => {
          if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify({ type: 'market_update_single', payload: cachedCoin }));
          }
        });
      }
    } catch (error) {
      broadcastLog({ message: `Error processing ticker stream message: ${error instanceof Error ? error.message : String(error)}`, type: 'ERROR' });
    }
  });

  ws.on('unexpected-response', (_req, res) => {
    broadcastLog({
      message: `Backend: Unexpected response from ${currentStreamName} stream. Status: ${res.statusCode}, Message: ${res.statusMessage}`,
      type: 'ERROR'
    });
    // You might want to inspect req and res headers here for more clues
    // console.error('[Backend Ticker WS] Unexpected response details:', { statusCode: res.statusCode, statusMessage: res.statusMessage, headers: res.headers });
    ws.terminate(); // Terminate the connection as it's likely not going to work
    // O evento 'close' será acionado após 'terminate', lidando com a reconexão.
  });

  ws.on('close', (code: number, reason: Buffer | string) => {
    // A lógica de reconexão já está aqui.
    broadcastLog({ message: `Backend: ${currentStreamName} stream closed. Code: ${code}, Reason: ${reason.toString()}`, type: 'WARNING' });
    if (tickerWsReconnectAttempts < MAX_TICKER_WS_RECONNECT_ATTEMPTS) {
      tickerWsReconnectAttempts++;
      const reconnectDelay = 15000;
      broadcastLog({ message: `Backend: Attempting ${currentStreamName} reconnect ${tickerWsReconnectAttempts}/${MAX_TICKER_WS_RECONNECT_ATTEMPTS} in ${reconnectDelay / 1000}s...`, type: 'WARNING' });
      setTimeout(connectToAllMarketTickersStream, reconnectDelay);
    } else {
      broadcastLog({ message: `Backend: ${currentStreamName} stream closed. Max reconnect attempts reached.`, type: 'ERROR' });
    }
  });
}

function broadcastLog(logData: Omit<BotLog, 'id' | 'timestamp'>) {
  const logMessage = {
      type: 'log',
        payload: {
            id: Date.now().toString() + Math.random().toString(36).substr(2, 5),
            timestamp: Date.now(),
            ...logData
        }
    };
    const messageString = JSON.stringify(logMessage);
    clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) client.send(messageString);
  });
    console.log(`[Backend Log] [${logData.type}] ${logData.pair ? `[${logData.pair}] ` : ''}${logData.message}`);
}

async function fetchInitialKlinesAndCalculateIndicators(symbol: string, _rsiPeriod: number, _smaShortPeriod: number, _smaLongPeriod: number) {
  broadcastLog({ message: `Backend: Initializing kline buffer for ${symbol} (${KLINE_INTERVAL}). Indicators will be calculated as data arrives via WebSocket.`, type: 'DEBUG', pair: symbol });
  if (!klineDataBuffers.has(symbol)) {
    klineDataBuffers.set(symbol, { closes: [], lastUpdate: Date.now() });
  }
}

function updateIndicatorsForSymbol(symbol: string, closePrices: number[], rsiPeriodParam: number, smaShortPeriodParam: number, smaLongPeriodParam: number) {
  let rsiValue: number | undefined = undefined;
  let smaShortValue: number | undefined = undefined;
  let smaLongValue: number | undefined = undefined;

  if (closePrices.length >= rsiPeriodParam) {
    try {
      const rsiResult = RSI.calculate({ values: closePrices, period: rsiPeriodParam });
      if (rsiResult.length > 0) rsiValue = parseFloat(rsiResult[rsiResult.length - 1].toFixed(2));
    } catch (e: any) { console.error(`RSI calc error for ${symbol}: ${e.message}`); }
  }
  if (closePrices.length >= smaShortPeriodParam) {
    try {
      const smaShortResult = SMA.calculate({ values: closePrices, period: smaShortPeriodParam });
      if (smaShortResult.length > 0) smaShortValue = parseFloat(smaShortResult[smaShortResult.length - 1].toFixed(8));
    } catch (e: any) { console.error(`SMA Short calc error for ${symbol}: ${e.message}`); }
  }
  if (closePrices.length >= smaLongPeriodParam) {
    try {
      const smaLongResult = SMA.calculate({ values: closePrices, period: smaLongPeriodParam });
      if (smaLongResult.length > 0) smaLongValue = parseFloat(smaLongResult[smaLongResult.length - 1].toFixed(8));
    } catch (e: any) { console.error(`SMA Long calc error for ${symbol}: ${e.message}`); }
  }

  let cachedCoin = coinDataWithIndicatorsCache.get(symbol);
  if (!cachedCoin) {
    cachedCoin = { id: symbol, symbol: symbol, name: symbol.replace('USDT',''), baseAsset: symbol.replace('USDT',''), quoteAsset: 'USDT', price: 0, priceChange24hPercent: 0, volume: 0, quoteVolume: 0 } as Coin;
  }
  cachedCoin.rsi = rsiValue;
  cachedCoin.smaShort = smaShortValue;
  cachedCoin.smaLong = smaLongValue;
  if (!cachedCoin.price && closePrices.length > 0) {
      cachedCoin.price = closePrices[closePrices.length - 1];
  }
  clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
        const { id, symbol: coinSymbol, name, price, priceChange24hPercent, baseAsset, quoteAsset, volume, quoteVolume, rsi: rsiVal, smaShort: smaS, smaLong: smaL, lastQty } = cachedCoin as Coin;
        const payload: Coin = { id, symbol: coinSymbol, name, price, priceChange24hPercent, baseAsset, quoteAsset, volume, quoteVolume, rsi: rsiVal, smaShort: smaS, smaLong: smaL, lastQty };
        client.send(JSON.stringify({ type: 'market_update_single', payload }));
    }
  });
  coinDataWithIndicatorsCache.set(symbol, cachedCoin);
  // broadcastLog({ message: `Indicators updated for ${symbol}: RSI=${rsiValue}, SMA_S=${smaShortValue}, SMA_L=${smaLongValue}`, type: 'DEBUG', pair: symbol });
}

function connectToKlineStreams(symbolsToSubscribe: string[], rsiPeriod: number = botSettings.rsiPeriod, smaShortPeriod: number = botSettings.smaShortPeriod, smaLongPeriod: number = botSettings.smaLongPeriod) {
  const wsUrl = `${BINANCE_TESTNET_API_URL.replace('https://', 'wss://').replace('/api', '')}/ws`;

  if (!klineWs || klineWs.readyState === WebSocket.CLOSED || klineWs.readyState === WebSocket.CLOSING) {
    broadcastLog({ message: 'Backend: Creating new kline WebSocket connection.', type: 'INFO' });
    subscribedKlineSymbols.clear();
    klineWs = new WebSocket(wsUrl);
    // klineWsReconnectAttempts = 0; // This variable was removed

    klineWs.on('open', () => {
      broadcastLog({ message: 'Backend: Kline WebSocket Connected.', type: 'INFO' });
      // klineWsReconnectAttempts = 0; // This variable was removed
      if (symbolsToSubscribe.length > 0) {
        const currentStreamsToSubscribeParams = symbolsToSubscribe.map(s => `${s.toLowerCase()}@kline_${KLINE_INTERVAL}`);
        const subscribeMsg = { method: "SUBSCRIBE", params: currentStreamsToSubscribeParams, id: Date.now() };
        if (klineWs?.readyState === WebSocket.OPEN) klineWs.send(JSON.stringify(subscribeMsg));
        broadcastLog({ message: `[Backend Kline WebSocket] Subscribing to: ${currentStreamsToSubscribeParams.join(', ')}`, type: 'INFO' });
        symbolsToSubscribe.forEach(symbol => {
            subscribedKlineSymbols.add(symbol.toUpperCase());
            fetchInitialKlinesAndCalculateIndicators(symbol, rsiPeriod, smaShortPeriod, smaLongPeriod);
        });
      } else {
        broadcastLog({ message: 'Backend: Kline WebSocket Connected, but no symbols to subscribe to initially.', type: 'INFO' });
      }

      setInterval(() => {
        if (klineWs?.readyState === WebSocket.OPEN) {
          klineWs.ping(() => {});
        }
      }, 30000);
    });

    klineWs.on('message', (data: WebSocket.Data) => {
      try {
        const klineEvent = JSON.parse(data.toString());
        if (klineEvent.e === 'kline') {
          const symbol = klineEvent.s;
          const k = klineEvent.k;

          if (k.x === true) {
            let buffer = klineDataBuffers.get(symbol);
            if (!buffer) {
              buffer = { closes: [], lastUpdate: 0 };
              broadcastLog({ message: `Backend: Initializing kline buffer for ${symbol} upon first closed kline.`, type: 'DEBUG', pair: symbol });
              klineDataBuffers.set(symbol, buffer);
            }
            buffer.closes.push(parseFloat(k.c));
            const requiredBufferSize = Math.max(rsiPeriod, smaLongPeriod, smaShortPeriod) * KLINE_BUFFER_SIZE_MULTIPLIER + 5;
            while (buffer.closes.length > requiredBufferSize) {
              buffer.closes.shift();
            }
            buffer.lastUpdate = klineEvent.E;
            // broadcastLog({ message: `Backend: Closed kline for ${symbol}. Price: ${k.c}. Buf: ${buffer.closes.length}.`, type: 'DEBUG', pair: symbol });
            updateIndicatorsForSymbol(symbol, buffer.closes, rsiPeriod, smaShortPeriod, smaLongPeriod);
          }
        } else if (klineEvent.result === null && klineEvent.id) {
          broadcastLog({ message: `Backend: Kline Subscription/Unsubscription ack received: ID ${klineEvent.id}`, type: 'INFO' });
        }
      } catch (error) {
        broadcastLog({ message: `Backend: Error processing kline message: ${error instanceof Error ? error.message : String(error)}`, type: 'ERROR' });
      }
    });

    klineWs.on('error', (error: Error) => {
      broadcastLog({ message: `Backend: Kline WebSocket Error: ${error.message}`, type: 'ERROR' });
    });

    klineWs.on('close', (code: number, reason: Buffer | string) => {
      broadcastLog({ message: `[Backend Kline WebSocket] Closed. Code: ${code}, Reason: ${reason.toString()}`, type: 'WARNING' });
      klineWs = null;
      subscribedKlineSymbols.clear();
      broadcastLog({ message: 'Backend: Kline WebSocket connection will be re-established and subscriptions renewed on the next /api/market-data request if needed.', type: 'INFO' });
    });

  } else if (klineWs.readyState === WebSocket.OPEN) {
    const newSymbolsToSubscribe = symbolsToSubscribe.filter(s => !subscribedKlineSymbols.has(s.toUpperCase()));
    const symbolsToUnsubscribe = Array.from(subscribedKlineSymbols).filter(s => !symbolsToSubscribe.map(sym => sym.toUpperCase()).includes(s));

    if (symbolsToUnsubscribe.length > 0) {
      const unsubscribeParams = symbolsToUnsubscribe.map(s => `${s.toLowerCase()}@kline_${KLINE_INTERVAL}`);
      const unsubscribeMsg = { method: "UNSUBSCRIBE", params: unsubscribeParams, id: Date.now() };
      if (klineWs?.readyState === WebSocket.OPEN) klineWs.send(JSON.stringify(unsubscribeMsg));
      broadcastLog({ message: `[Backend Kline WebSocket] Unsubscribing from: ${unsubscribeParams.join(', ')}`, type: 'INFO' });
      symbolsToUnsubscribe.forEach(s => subscribedKlineSymbols.delete(s));
    }

    if (newSymbolsToSubscribe.length > 0) {
      const subscribeParams = newSymbolsToSubscribe.map(s => `${s.toLowerCase()}@kline_${KLINE_INTERVAL}`);
      const subscribeMsg = { method: "SUBSCRIBE", params: subscribeParams, id: Date.now() };
      if (klineWs?.readyState === WebSocket.OPEN) klineWs.send(JSON.stringify(subscribeMsg));
      broadcastLog({ message: `[Backend Kline WebSocket] Subscribing to additional: ${subscribeParams.join(', ')}`, type: 'INFO' });
      newSymbolsToSubscribe.forEach(symbol => {
        subscribedKlineSymbols.add(symbol.toUpperCase());
        fetchInitialKlinesAndCalculateIndicators(symbol, rsiPeriod, smaShortPeriod, smaLongPeriod);
      });
    }
    if (newSymbolsToSubscribe.length === 0 && symbolsToUnsubscribe.length === 0 && symbolsToSubscribe.length > 0) {
      // console.log('[Backend Kline WebSocket] Kline subscriptions are already up-to-date.');
    }
  }
}

async function callBinanceApi<T>(
  endpoint: string,
  method: 'GET' | 'POST' = 'GET',
  params: Record<string, any> = {},
  isPrivate: boolean = false
): Promise<T> {
  if (isPrivate && (!BINANCE_TESTNET_API_KEY || !BINANCE_TESTNET_SECRET_KEY)) {
    console.error('API Key or Secret is not configured in server/.env');
    throw { status: 500, message: 'API Key or Secret is not configured on the server.' };
  }

  const urlObj = new URL(`${BINANCE_TESTNET_API_URL}${endpoint}`);

  const headers: Record<string, string> = {
    'Accept': 'application/json',
  };

  if (isPrivate) {
    params.timestamp = Date.now();
    params.recvWindow = DEFAULT_RECEIVE_WINDOW;
    if (BINANCE_TESTNET_API_KEY) {
      headers['X-MBX-APIKEY'] = BINANCE_TESTNET_API_KEY;
    }
  }

  const searchParams = new URLSearchParams();
  Object.keys(params).forEach(key => {
    if (params[key] !== undefined) {
      searchParams.append(key, params[key].toString());
    }
  });

  let requestBody: string | undefined = undefined;
  let fullUrl: string;

  if (method === 'POST') {
    if (isPrivate && BINANCE_TESTNET_SECRET_KEY) {
      const signature = createSignature(searchParams.toString(), BINANCE_TESTNET_SECRET_KEY);
      searchParams.append('signature', signature);
    }
    requestBody = searchParams.toString();
    fullUrl = urlObj.toString();
    headers['Content-Type'] = 'application/x-www-form-urlencoded';
  } else { // GET
    if (isPrivate && BINANCE_TESTNET_SECRET_KEY) {
      const signature = createSignature(searchParams.toString(), BINANCE_TESTNET_SECRET_KEY);
      searchParams.append('signature', signature);
    }
    urlObj.search = searchParams.toString();
    fullUrl = urlObj.toString();
  }

  // console.debug(`[Backend Binance API Call] Method: ${method}, URL: ${fullUrl}, Private: ${isPrivate}`);
  // if (method === 'POST' && requestBody) {
  //   console.debug(`  Body: ${requestBody}`);
  // }

  try {
    const response = await axios({
      method,
      url: fullUrl,
      data: requestBody,
      headers,
    });
    return response.data as T;
  } catch (error: any) {
    if (axios.isAxiosError(error) && error.response) {
      const binanceError = error.response.data as BinanceError;
      console.error('Binance API Error on Backend:', binanceError);
      throw { status: error.response.status, message: `Binance API Error (${binanceError.code}): ${binanceError.msg}` };
    }
    console.error('Generic API call error on Backend:', error);
    throw { status: 500, message: 'Failed to call Binance API from backend.' };
  }
}

// ---- API Endpoints ----

app.get('/api/api-key-status', (_req: Request, res: Response) => {
  const configured = !!BINANCE_TESTNET_API_KEY && !!BINANCE_TESTNET_SECRET_KEY;
  if (configured) {
    res.json({ configured: true, message: 'API keys are configured on the backend.' });
  } else {
    const missing = [];
    if (!BINANCE_TESTNET_API_KEY) missing.push("BINANCE_TESTNET_API_KEY");
    if (!BINANCE_TESTNET_SECRET_KEY) missing.push("BINANCE_TESTNET_SECRET_KEY");
    res.status(400).json({ configured: false, message: `API keys (${missing.join(' and ')}) are missing in server/.env.` });
  }
});

app.get('/api/market-data', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const maxCoinPriceQueryParam = req.query?.maxCoinPrice;
    const rsiPeriodParam = req.query?.rsiPeriod;
    const smaShortPeriodParam = req.query?.smaShortPeriod;
    const smaLongPeriodQueryParam = req.query?.smaLongPeriod; // Corrected variable name

    const maxCoinPrice = maxCoinPriceQueryParam ? parseFloat(maxCoinPriceQueryParam as string) : undefined;
    if (maxCoinPrice === undefined || isNaN(maxCoinPrice)) {
        return res.status(400).json({ message: "maxCoinPrice query parameter is required and must be a number." });
    }
    const rsiPeriod = rsiPeriodParam ? parseInt(rsiPeriodParam as string, 10) : botSettings.rsiPeriod;
    const smaShortPeriod = smaShortPeriodParam ? parseInt(smaShortPeriodParam as string, 10) : botSettings.smaShortPeriod;
    const smaLongPeriod = smaLongPeriodQueryParam ? parseInt(smaLongPeriodQueryParam as string, 10) : botSettings.smaLongPeriod;

    const MAX_PAIRS_FOR_INDICATORS = 30;

    const tickersFromCache: BinanceTicker24hr[] = Object.values(liveTickerData);

    if (tickersFromCache.length === 0) {
      broadcastLog({ message: '[Backend /api/market-data] Ticker cache (liveTickerData) is empty. WebSocket for tickers might not be connected or receiving data yet.', type: 'WARNING' });
      return res.json({ coins: [] });
    }

    const topVolumePairs = tickersFromCache.filter((ticker: BinanceTicker24hr) =>
      ticker.symbol.endsWith('USDT') &&
        !EXCLUDED_SYMBOLS_BY_DEFAULT.includes(ticker.symbol) &&
        parseFloat(ticker.lastPrice) > 0 &&
        parseFloat(ticker.quoteVolume) > 10000
      )
      .sort((a, b) => parseFloat(b.quoteVolume) - parseFloat(a.quoteVolume));
  
    const symbolsForKlineProcessing = topVolumePairs.slice(0, MAX_PAIRS_FOR_INDICATORS).map(t => t.symbol);
    
    connectToKlineStreams(symbolsForKlineProcessing, rsiPeriod, smaShortPeriod, smaLongPeriod);

    const responseCoins: Coin[] = [];
    for (const symbol of topVolumePairs.map(t => t.symbol)) {
        const cachedData = coinDataWithIndicatorsCache.get(symbol);
        if (cachedData && cachedData.price < maxCoinPrice) {
            responseCoins.push({
                id: cachedData.id,
                symbol: cachedData.symbol,
                name: cachedData.name || cachedData.symbol.replace('USDT', ''),
                price: cachedData.price,
                priceChange24hPercent: cachedData.priceChange24hPercent || 0,
                baseAsset: cachedData.baseAsset || cachedData.symbol.replace('USDT', ''),
                quoteAsset: cachedData.quoteAsset || 'USDT',
                volume: cachedData.volume || 0,
                quoteVolume: cachedData.quoteVolume || 0,
                rsi: cachedData.rsi,
                smaShort: cachedData.smaShort,
                smaLong: cachedData.smaLong,
                lastQty: cachedData.lastQty,
            });
        } else if (liveTickerData[symbol] && parseFloat(liveTickerData[symbol].lastPrice) < maxCoinPrice) {
            const ticker = liveTickerData[symbol];
            responseCoins.push({
                id: ticker.symbol,
                symbol: ticker.symbol,
                name: ticker.symbol.replace('USDT', ''),
                price: parseFloat(ticker.lastPrice),
                priceChange24hPercent: parseFloat(ticker.priceChangePercent),
                baseAsset: ticker.symbol.replace('USDT', ''),
                quoteAsset: 'USDT',
                volume: parseFloat(ticker.volume),
                quoteVolume: parseFloat(ticker.quoteVolume),
                lastQty: ticker.lastQty,
            });
        }
    }
    res.json({ coins: responseCoins.sort((a,b) => a.price - b.price) });
  } catch (error) {
    next(error);
  }
});

app.get('/api/account-info', async (_req: Request, res: Response, next: NextFunction) => { // req marked as unused
  try {
    const accountInfo = await callBinanceApi<BinanceAccountInfo>('/v3/account', 'GET', {}, true);
    res.json(accountInfo);
  } catch (error) {
    next(error);
  }
});

app.post('/api/order', async (req: Request, res: Response, next: NextFunction) => {
  const { symbol, side, quantity, quoteOrderQty } = req.body;
  if (!symbol || !side || (side === 'BUY' && !quoteOrderQty) || (side === 'SELL' && !quantity)) {
    return res.status(400).json({ message: 'Missing required parameters for order (symbol, side, and quantity/quoteOrderQty).' });
  }

  const params: Record<string, any> = {
    symbol,
    side,
    type: 'MARKET',
  };
  if (side === 'BUY' && quoteOrderQty) {
    params.quoteOrderQty = parseFloat(quoteOrderQty as string).toFixed(8);
  } else if (side === 'SELL' && quantity) {
    try {
      const exInfo = await getExchangeInfo();
      const symbolInfo = exInfo.symbols.find(s => s.symbol === symbol);
      if (symbolInfo) {
        const lotSizeFilter = symbolInfo.filters.find(f => f.filterType === 'LOT_SIZE') as LotSizeFilter | undefined;
        if (lotSizeFilter?.stepSize && typeof quantity === 'number') {
          params.quantity = formatQuantityByStepSize(quantity as number, lotSizeFilter.stepSize);
          broadcastLog({ message: `Formatted SELL quantity for ${symbol} to ${params.quantity} using stepSize ${lotSizeFilter.stepSize}`, type: 'DEBUG', pair: symbol });
        } else {
          broadcastLog({ message: `LOT_SIZE filter or stepSize not found for ${symbol}. Using default quantity formatting.`, type: 'WARNING', pair: symbol });
          params.quantity = (quantity as number).toString();
        }
      } else {
        broadcastLog({ message: `Symbol info not found for ${symbol} in exchangeInfo. Using default quantity formatting.`, type: 'WARNING', pair: symbol });
        params.quantity = (quantity as number).toString();
      }
    } catch (exInfoError: any) {
      console.error(`[Backend] Error getting exchangeInfo for order formatting: ${exInfoError.message}. Using default quantity formatting.`);
      params.quantity = (quantity as number).toString();
    }
  }

  try {
    const orderResponse = await callBinanceApi<import('../src/types').BinanceOrderResponse>('/v3/order', 'POST', params, true);
    res.json(orderResponse);
  } catch (error) {
    next(error);
  }
});

async function refreshAccountDataBackend(logUpdate: boolean = true): Promise<boolean> {
  if (!BINANCE_TESTNET_API_KEY || !BINANCE_TESTNET_SECRET_KEY) {
      if (logUpdate) broadcastLog({ message: 'Backend: API Keys not configured. Cannot refresh account data.', type: 'API_KEY' });
      botStatus = BotStatus.ERROR;
      broadcastStatusUpdate(botStatus);
      return false;
  }
  try {
    if (logUpdate) broadcastLog({ message: 'Backend: Fetching account balance and portfolio from Binance...', type: 'INFO' });
    const accountInfo = await callBinanceApi<BinanceAccountInfo>('/v3/account', 'GET', {}, true);
    currentAccountInfo = accountInfo;
    currentUSDTBalance = getUSDTBalanceBackend(accountInfo);
    currentPortfolio = getAssetBalancesFromAccountInfoBackend(accountInfo);

    currentPortfolio = currentPortfolio.map(item => {
        const botTradeInfo = botTradeHistory.get(item.symbol);
        return {
            ...item,
            avgPurchasePrice: botTradeInfo?.purchasePrice,
            purchaseTimestamp: botTradeInfo?.timestamp,
        };
    });

    if (logUpdate) broadcastLog({ message: 'Backend: Account data refreshed successfully.', type: 'SUCCESS' });
    return true;
  } catch (error: any) {
    const errorMessage = error.message || String(error);
    broadcastLog({ message: `Backend: Error fetching account data: ${errorMessage}`, type: 'ERROR' });
    botStatus = BotStatus.ERROR;
    broadcastStatusUpdate(botStatus);
    return false;
  } finally {
    clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
          client.send(JSON.stringify({ type: 'portfolio_update', payload: { portfolio: currentPortfolio, usdtBalance: currentUSDTBalance } }));
      }
    });
  }
}

function getUSDTBalanceBackend(accountInfo: BinanceAccountInfo): number {
  const usdt = accountInfo.balances.find(b => b.asset === 'USDT');
  return usdt ? parseFloat(usdt.free) : 0;
}

function getAssetBalancesFromAccountInfoBackend(accountInfo: BinanceAccountInfo): PortfolioItem[] {
  return accountInfo.balances
    .filter(b => b.asset !== 'USDT' && (parseFloat(b.free) > 0 || parseFloat(b.locked) > 0))
    .map(balance => ({
      symbol: `${balance.asset}USDT`,
      baseAsset: balance.asset,
      quoteAsset: 'USDT',
      amount: parseFloat(balance.free),
      lockedAmount: parseFloat(balance.locked),
    }));
}

function addCompletedTradeBackend(trade: Omit<CompletedTrade, 'id'>) {
  const newTrade: CompletedTrade = { ...trade, id: Date.now().toString() + Math.random().toString(36).substr(2, 5) };
  tradeLedger = [newTrade, ...tradeLedger.slice(0, 499)];
  clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
          client.send(JSON.stringify({ type: 'trade_ledger_update', payload: tradeLedger }));
      }
  });
  broadcastLog({ message: `Backend: Trade ledger updated. New trade: ${newTrade.type} ${newTrade.pair}`, type: 'INFO', pair: newTrade.pair });
}

async function executeBotLogic() {
  if (botStatus !== BotStatus.RUNNING) {
      return;
  }

  if (!BINANCE_TESTNET_API_KEY || !BINANCE_TESTNET_SECRET_KEY) {
      broadcastLog({ message: 'Backend: Bot logic skipped: API keys are not configured. Setting status to ERROR.', type: 'ERROR' });
      botStatus = BotStatus.ERROR;
      broadcastStatusUpdate(botStatus);
      return;
  }

  broadcastLog({ message: 'Backend: Scanning markets...', type: 'INFO' });

  const currentMarketData = Array.from(coinDataWithIndicatorsCache.values());

  if (currentMarketData.length === 0) {
      broadcastLog({ message: 'Backend: Market data cache is empty. Skipping scan.', type: 'WARNING' });
      return;
  }

  await refreshAccountDataBackend(false);

  if (!currentAccountInfo) {
    broadcastLog({ message: 'Backend: Account info not available. Skipping trade logic.', type: 'WARNING' });
    return;
  }
  const portfolioFromAccount = getAssetBalancesFromAccountInfoBackend(currentAccountInfo);

  for (const [symbol, tradeInfo] of botTradeHistory.entries()) {
    const portfolioItem = portfolioFromAccount.find(pItem => pItem.symbol === symbol);

    if (!portfolioItem || portfolioItem.amount <= 0) {
      broadcastLog({
        type: 'WARNING',
        message: `Backend: Bot has trade history for ${symbol} (bought ${tradeInfo.amount.toFixed(6)} at $${tradeInfo.purchasePrice.toFixed(8)}), but no (or zero) balance found in current account portfolio. This trade will be removed from bot's history.`,
        pair: symbol
      });
      botTradeHistory.delete(symbol);
      continue;
    }

    const coinMarketData = coinDataWithIndicatorsCache.get(symbol);
    if (!coinMarketData || !coinMarketData.price) {
        broadcastLog({ type: 'WARNING', message: `Backend: Market data not available for ${symbol}. Cannot perform SELL check.`, pair: symbol });
        continue;
    }

    broadcastLog({ type: 'STRATEGY_INFO', message: `Backend: SELL CHECK for ${symbol}: Bot purchased at $${tradeInfo.purchasePrice.toFixed(8)}. Current amount in portfolio: ${portfolioItem.amount.toFixed(6)}`, pair: symbol });

    const initialStopLossPrice = tradeInfo.purchasePrice * (1 - botSettings.stopLossPercent / 100);
    let effectiveStopLossPrice = initialStopLossPrice;
    let trailingStopMessage = "";
    const profitTargetPrice = tradeInfo.purchasePrice * (1 + botSettings.targetProfitPercent / 100);
    
    broadcastLog({ type: 'STRATEGY_INFO', message: `Backend: SELL PRICES for ${symbol}: Current: $${coinMarketData.price.toFixed(8)}, Target: $${profitTargetPrice.toFixed(8)}, Initial Stop: $${initialStopLossPrice.toFixed(8)}${trailingStopMessage}`, pair: symbol });

    let shouldSell = false;
    let sellReason = "";

    if (botSettings.useTrailingStop) {
      const currentHighest = tradeInfo.highestPriceSinceBuy || tradeInfo.purchasePrice;
      if (coinMarketData.price > currentHighest) {
        tradeInfo.highestPriceSinceBuy = coinMarketData.price;
      }

      if (tradeInfo.highestPriceSinceBuy &&
          tradeInfo.highestPriceSinceBuy > tradeInfo.purchasePrice * (1 + botSettings.trailingStopArmPercentage / 100)) {
        const trailingStopPrice = tradeInfo.highestPriceSinceBuy * (1 - botSettings.trailingStopOffsetPercentage / 100);
        trailingStopMessage = ` (TSL Armed: Highest $${tradeInfo.highestPriceSinceBuy.toFixed(8)}, TSL Price $${trailingStopPrice.toFixed(8)})`;
        effectiveStopLossPrice = Math.max(initialStopLossPrice, trailingStopPrice);
      }
    }

    if (coinMarketData.price >= profitTargetPrice) {
      shouldSell = true;
      sellReason = `target profit of ${botSettings.targetProfitPercent}% reached`;
      broadcastLog({ type: 'STRATEGY_INFO', message: `Backend: SELL TRIGGER for ${symbol}: Profit target reached.`, pair: symbol });
    } else if (coinMarketData.price <= effectiveStopLossPrice) {
      shouldSell = true;
      sellReason = coinMarketData.price <= initialStopLossPrice && (!botSettings.useTrailingStop || effectiveStopLossPrice === initialStopLossPrice) ? `initial stop loss of ${botSettings.stopLossPercent}% triggered` : `trailing stop loss triggered`;
      broadcastLog({ type: 'STRATEGY_INFO', message: `Backend: SELL TRIGGER for ${symbol}: ${sellReason} at $${coinMarketData.price.toFixed(8)}. Effective SL: $${effectiveStopLossPrice.toFixed(8)}${trailingStopMessage}`, pair: symbol });
    }

    if (shouldSell) {
      broadcastLog({
        message: `Backend: Attempting to SELL ${portfolioItem.amount.toFixed(8)} ${portfolioItem.baseAsset} (approx $${(portfolioItem.amount * coinMarketData.price).toFixed(2)}). Reason: ${sellReason}.`,
        type: 'INFO',
        pair: symbol,
        reason: sellReason,
      });
      try {
        const sellQuantity = parseFloat(portfolioItem.amount.toFixed(6));
        const estimatedSellValue = sellQuantity * coinMarketData.price;
        if (estimatedSellValue < MIN_TRADE_VALUE_USDT) {
          broadcastLog({
            message: `Backend: Calculated sell value for ${sellQuantity.toFixed(8)} ${portfolioItem.baseAsset} (approx $${estimatedSellValue.toFixed(2)}) is below minimum $${MIN_TRADE_VALUE_USDT}. Skipping sell.`,
            type: 'WARNING',
            pair: symbol,
            reason: `Value $${estimatedSellValue.toFixed(2)} < Min Trade $${MIN_TRADE_VALUE_USDT}`
          });
          continue;
        }
        const sellResult = await callBinanceApi<import('../src/types').BinanceOrderResponse>('/v3/order', 'POST', { symbol, side: 'SELL', quantity: sellQuantity }, true);

        const executedQtyNum = parseFloat(sellResult.executedQty);
        const cummulativeQuoteQtyNum = parseFloat(sellResult.cummulativeQuoteQty);
        const sellPrice = executedQtyNum > 0 ? cummulativeQuoteQtyNum / executedQtyNum : coinMarketData.price;

        let profitAmount = 0;
        let profitPercent = 0;
        if (tradeInfo.purchasePrice && executedQtyNum > 0) {
          const totalPurchaseCost = tradeInfo.purchasePrice * executedQtyNum;
          profitAmount = cummulativeQuoteQtyNum - totalPurchaseCost;
          if (totalPurchaseCost > 0) {
            profitPercent = (profitAmount / totalPurchaseCost) * 100;
          }
        }

        broadcastLog({
          message: `Backend: Successfully SOLD ${sellResult.executedQty} ${portfolioItem.baseAsset} for approx ${sellResult.cummulativeQuoteQty} USDT. Reason: ${sellReason}.`,
          type: 'SELL',
          pair: sellResult.symbol,
          orderId: sellResult.orderId.toString(),
          orderType: 'market',
          price: sellPrice,
          amount: executedQtyNum,
          cost: cummulativeQuoteQtyNum,
          profitAmount: profitAmount,
          profitPercent: profitPercent,
          reason: sellReason,
        });
        addCompletedTradeBackend({
          timestamp: sellResult.transactTime || Date.now(),
          type: 'SELL',
          pair: sellResult.symbol,
          price: sellPrice,
          amount: executedQtyNum,
          cost: cummulativeQuoteQtyNum,
          orderId: sellResult.orderId.toString(),
          profitAmount: profitAmount,
          profitPercent: profitPercent,
          purchasePriceForSell: tradeInfo.purchasePrice,
        });
        botTradeHistory.delete(symbol);
        await refreshAccountDataBackend(false);
      } catch (error: any) {
        const errorMessage = error.message || String(error);
        broadcastLog({ message: `Backend: Failed to sell ${portfolioItem.baseAsset}: ${errorMessage}`, type: 'ERROR', pair: symbol });
      }
    }
  }

  const initialCandidates = currentMarketData.filter(
    coin => !botTradeHistory.has(coin.symbol) &&
            !EXCLUDED_SYMBOLS_BY_DEFAULT.includes(coin.symbol) &&
            coin.price < botSettings.maxCoinPrice
  );
  broadcastLog({ message: `Backend: BUY CHECK: Initial candidates (after price & exclusion filters): ${initialCandidates.length} out of ${currentMarketData.length} market coins.`, type: 'STRATEGY_INFO' });

  if (initialCandidates.length > 0) {
    const debugCandidates = initialCandidates.slice(0, 5);
    debugCandidates.forEach(c => {
      broadcastLog({ message: `Backend: Debug Candidate: ${c.symbol} - Price: ${c.price.toFixed(8)}, RSI: ${c.rsi?.toFixed(2) ?? 'N/A'}, SMA_S: ${c.smaShort?.toFixed(8) ?? 'N/A'}, SMA_L: ${c.smaLong?.toFixed(8) ?? 'N/A'}`, type: 'STRATEGY_INFO', pair: c.symbol });
    });
  }

  const cheapCoinsPassingIndicators = initialCandidates.filter(
    coin =>
            coin.rsi !== undefined && coin.rsi < botSettings.rsiBuyThreshold &&
            coin.smaShort !== undefined && coin.smaLong !== undefined && coin.smaShort > coin.smaLong
  );
  broadcastLog({ message: `Backend: BUY CHECK: Candidates after indicator filter (RSI < ${botSettings.rsiBuyThreshold}, SMA${botSettings.smaShortPeriod} > SMA${botSettings.smaLongPeriod}): ${cheapCoinsPassingIndicators.length}`, type: 'STRATEGY_INFO' });

  const cheapCoins = cheapCoinsPassingIndicators.sort((a, b) => b.quoteVolume - a.quoteVolume);

  if (cheapCoins.length > 0 && currentUSDTBalance >= botSettings.tradeAmountUSDT && currentAccountInfo) {
    if (botTradeHistory.size >= botSettings.maxOpenTrades) {
      broadcastLog({ message: `Backend: BUY CHECK SKIPPED: Maximum open trades limit (${botSettings.maxOpenTrades}) reached. Current open trades: ${botTradeHistory.size}.`, type: 'STRATEGY_INFO' });
      return;
    }

    broadcastLog({ message: `Backend: BUY CHECK: Found ${cheapCoins.length} candidate(s) post-indicator filter. Top: ${cheapCoins[0].symbol} (Vol: ${cheapCoins[0].quoteVolume.toFixed(0)} USDT). Balance: $${currentUSDTBalance.toFixed(2)} vs Trade Amt: $${botSettings.tradeAmountUSDT}. Open Trades: ${botTradeHistory.size}/${botSettings.maxOpenTrades}.`, type: 'STRATEGY_INFO' });

    const coinToBuy = cheapCoins[0];

    if (coinToBuy) {
      broadcastLog({
        message: `Backend: Attempting to BUY ${coinToBuy.symbol} (Price: $${coinToBuy.price.toFixed(4)}, Volume: ${coinToBuy.quoteVolume.toFixed(0)} USDT) with ${botSettings.tradeAmountUSDT} USDT...`,
        type: 'INFO',
        pair: coinToBuy.symbol,
      });
      try {
        const buyResult = await callBinanceApi<import('../src/types').BinanceOrderResponse>('/v3/order', 'POST', { symbol: coinToBuy.symbol, side: 'BUY', quoteOrderQty: botSettings.tradeAmountUSDT }, true);

        const executedQtyNum = parseFloat(buyResult.executedQty);
        const cummulativeQuoteQtyNum = parseFloat(buyResult.cummulativeQuoteQty);
        let actualPurchasePrice = coinToBuy.price;
        if (executedQtyNum > 0) {
            actualPurchasePrice = cummulativeQuoteQtyNum / executedQtyNum;
        }

        broadcastLog({
          message: `Backend: Successfully BOUGHT ${buyResult.executedQty} ${coinToBuy.baseAsset} for approx ${buyResult.cummulativeQuoteQty} USDT.`,
          type: 'BUY',
          pair: buyResult.symbol,
          orderId: buyResult.orderId.toString(),
          orderType: 'market',
          price: actualPurchasePrice,
          amount: executedQtyNum,
          cost: cummulativeQuoteQtyNum,
          reason: `Selected: RSI ${coinToBuy.rsi?.toFixed(2)} < ${botSettings.rsiBuyThreshold}, SMA_S ${coinToBuy.smaShort?.toFixed(8)} > SMA_L ${coinToBuy.smaLong?.toFixed(8)}, highest volume.`,
        });
        addCompletedTradeBackend({
          timestamp: buyResult.transactTime || Date.now(),
          type: 'BUY',
          pair: buyResult.symbol,
          price: actualPurchasePrice,
          amount: executedQtyNum,
          cost: cummulativeQuoteQtyNum,
          orderId: buyResult.orderId.toString(),
        });

        botTradeHistory.set(coinToBuy.symbol, {
          purchasePrice: actualPurchasePrice,
          amount: executedQtyNum,
          timestamp: Date.now(),
          highestPriceSinceBuy: actualPurchasePrice,
        });
        await refreshAccountDataBackend(false);
      } catch (error: any) {
        const errorMessage = error.message || String(error);
        broadcastLog({ message: `Backend: Failed to buy ${coinToBuy.symbol}: ${errorMessage}`, type: 'ERROR', pair: coinToBuy.symbol });
      }
    } else {
       broadcastLog({ message: `Backend: BUY CHECK: No coin selected despite cheapCoins list not being empty. This is unexpected.`, type: 'WARNING' });
    }
  } else {
    let failReason = "";
    if (cheapCoins.length === 0) {
      failReason = `No suitable cheap coins found after indicator filters (found: ${cheapCoins.length}, needs >0). Max coin price: $${botSettings.maxCoinPrice.toFixed(8)}. Ensure coins are not in bot's active trade history or excluded, and meet indicator criteria.`;
    } else if (currentUSDTBalance < botSettings.tradeAmountUSDT) {
      failReason = `Insufficient USDT balance ($${currentUSDTBalance.toFixed(2)}) for trade amount ($${botSettings.tradeAmountUSDT}).`;
    } else {
      failReason = `Buy conditions not met. cheapCoins: ${cheapCoins.length}, currentUSDTBalance: ${currentUSDTBalance.toFixed(2)}, tradeAmount: ${botSettings.tradeAmountUSDT}.`;
    }
    broadcastLog({ message: `Backend: BUY CHECK: ${failReason}`, type: 'STRATEGY_INFO' });
  }
}

async function startBotLogic() {
  if (botStatus === BotStatus.RUNNING) {
      broadcastLog({ message: 'Backend: Bot is already running.', type: 'INFO' });
      return;
  }
  if (!BINANCE_TESTNET_API_KEY || !BINANCE_TESTNET_SECRET_KEY) {
      broadcastLog({ message: 'Backend: Cannot start bot: API keys are not configured.', type: 'ERROR' });
      botStatus = BotStatus.ERROR;
      broadcastStatusUpdate(botStatus);
      return;
  }

  broadcastLog({ message: 'Backend: Starting bot...', type: 'INFO' });
  botStatus = BotStatus.INITIALIZING;
  broadcastStatusUpdate(botStatus);

  const refreshSuccess = await refreshAccountDataBackend(true);

  if (refreshSuccess) {
      broadcastLog({ message: `Backend: Account data refreshed. Starting market scan interval (${botSettings.scanIntervalMs / 1000}s).`, type: 'INFO' });
      botStatus = BotStatus.RUNNING;
      broadcastStatusUpdate(botStatus);
      executeBotLogic();
      botInterval = setInterval(executeBotLogic, botSettings.scanIntervalMs);
  } else {
      broadcastLog({ message: 'Backend: Bot start aborted: Account data refresh failed.', type: 'ERROR' });
      // botStatus is already ERROR from refreshAccountDataBackend
      broadcastStatusUpdate(botStatus); // Ensure frontend gets the final ERROR status
  }
}

function stopBotLogic() {
  if (botStatus === BotStatus.STOPPED || botStatus === BotStatus.INITIALIZING || botStatus === BotStatus.ERROR) {
      broadcastLog({ message: 'Backend: Bot is not running or already stopped/error.', type: 'INFO' });
      return;
  }
  broadcastLog({ message: 'Backend: Stopping bot...', type: 'INFO' });
  if (botInterval !== null) {
      clearInterval(botInterval);
      botInterval = null;
  }
  botStatus = BotStatus.STOPPED;
  broadcastStatusUpdate(botStatus);
}

// Global error handler
app.use((err: any, _req: Request, res: Response, _next: NextFunction) => { // req and next marked as unused
  console.error("Global Error Handler Caught:", err);
  const status = err.status || (err.response && err.response.status) || 500;
  const message = err.message || 'Something went wrong on the server.';
  res.status(status).json({ message });
});

server.listen(PORT, async () => {
  console.log(`Backend server is running on http://localhost:${PORT}`);
  broadcastLog({ message: `Backend: Server started on port ${PORT}.`, type: 'INFO' });
  if (!BINANCE_TESTNET_API_KEY || !BINANCE_TESTNET_SECRET_KEY) {
    broadcastLog({ message: 'Warning: BINANCE_TESTNET_API_KEY or BINANCE_TESTNET_SECRET_KEY is not set in server/.env. Private API calls will fail.', type: 'ERROR' });
  } else {
    broadcastLog({ message: 'Binance API keys loaded from server/.env.', type: 'INFO' });
  }
  try {
    await getExchangeInfo();
  } catch (e: any) {
    broadcastLog({ message: `Backend: Initial fetch of exchangeInfo failed: ${e.message}. Will try again on first order or API call requiring it.`, type: 'ERROR' });
  }
 connectToAllMarketTickersStream();
});
