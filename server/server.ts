import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import * as dotenv from 'dotenv';
import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { BotEngine } from './services/BotEngine.js';
import { CcxtExchange } from './services/ExchangeService.js';
import { PersistenceService } from './services/PersistenceService.js';
import { BotSettings, BotStatus } from '../src/types.js';

dotenv.config();

const app = express();
app.use(express.json());
app.use(cors());

const PORT = process.env.PORT || 3001;

// --- Initialization ---

const defaultSettings: BotSettings = {
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

const persistence = new PersistenceService();
const exchangeId = process.env.EXCHANGE || 'binance';
const exchangeService = new CcxtExchange(exchangeId);
const botEngine = new BotEngine(exchangeService, persistence, defaultSettings);

botEngine.initialize();

// --- WebSocket Server ---

const server = http.createServer(app);
const wss = new WebSocketServer({ server });
const clients: Set<WebSocket> = new Set();

// Hook up Bot Engine Events to WebSocket
botEngine.onMarketUpdate = (coins) => {
    const msg = JSON.stringify({ type: 'market_update_full', payload: coins }); // Changed to full update for simplicity or we can send singles
    // Original frontend expected 'market_update_single' for stream, but let's see.
    // If I send 'market_update_single' in a loop, it might be better for compatibility if the frontend expects one by one.
    // However, sending a full list is more efficient for polling.
    // Let's iterate and send single updates to match original behavior if needed, OR generic market_update.
    // The original code sent 'market_update_single' for each ticker update.
    // To be safe and compatible, I will iterate.

    // Actually, sending a bulk update is better. But does the frontend support it?
    // Looking at original frontend code (inferred): it probably updates state based on ID.
    // I'll send 'market_update_single' for each coin to ensure compatibility with existing Frontend reducer.

    coins.forEach(coin => {
        const singleMsg = JSON.stringify({ type: 'market_update_single', payload: coin });
        broadcast(singleMsg);
    });
};

botEngine.onStatusUpdate = (status) => {
    broadcast(JSON.stringify({ type: 'status', status }));
};

botEngine.onLog = (logEntry) => {
    broadcast(JSON.stringify({ type: 'log', payload: logEntry }));
    console.log(`[Bot] [${logEntry.type}] ${logEntry.message}`);
};

botEngine.onPortfolioUpdate = (portfolio, balance) => {
    broadcast(JSON.stringify({ type: 'portfolio_update', payload: { portfolio, usdtBalance: balance } }));
};

botEngine.onTradeLedgerUpdate = (ledger) => {
    broadcast(JSON.stringify({ type: 'trade_ledger_update', payload: ledger }));
};

function broadcast(msg: string) {
    clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(msg);
        }
    });
}

wss.on('connection', (ws: WebSocket) => {
    clients.add(ws);
    console.log('[WS] Client connected.');

    // Send Initial State
    const initialState = {
        type: 'initial_state',
        payload: {
            botStatus: botEngine.status,
            settings: botEngine.settings,
            logs: [], // We don't store full logs history in backend memory efficiently yet, send empty or recent
            portfolio: botEngine.portfolio,
            usdtBalance: botEngine.usdtBalance,
            tradeLedger: botEngine.tradeLedger,
            marketData: botEngine.marketData
        }
    };
    ws.send(JSON.stringify(initialState));

    ws.on('message', (message: WebSocket.Data) => {
        try {
            const msg = JSON.parse(message.toString());
            if (msg.type === 'command') {
                if (msg.command === 'START_BOT') botEngine.start();
                if (msg.command === 'STOP_BOT') botEngine.stop();
            } else if (msg.type === 'settings') {
                botEngine.updateSettings(msg.payload);
            }
        } catch (error) {
            console.error('[WS] Failed to parse message:', error);
        }
    });

    ws.on('close', () => clients.delete(ws));
});

// --- API Endpoints ---

app.get('/api/api-key-status', (_req: Request, res: Response) => {
    // Basic check if env vars are present (generic)
    const hasKeys = !!process.env.BINANCE_API_KEY || !!process.env.API_KEY || !!process.env.BINANCE_TESTNET_API_KEY;
    if (hasKeys) {
        res.json({ configured: true, message: 'API keys configured.' });
    } else {
        res.status(400).json({ configured: false, message: 'API keys missing.' });
    }
});

app.get('/api/market-data', (req: Request, res: Response) => {
    // Filter based on query params if needed, or just return all
    // The frontend sends params like maxCoinPrice, but our engine already filters some.
    // We can filter `botEngine.marketData` further here.
    const maxCoinPrice = req.query.maxCoinPrice ? parseFloat(req.query.maxCoinPrice as string) : undefined;
    
    let coins = botEngine.marketData;
    if (maxCoinPrice !== undefined && !isNaN(maxCoinPrice)) {
        coins = coins.filter(c => c.price < maxCoinPrice);
    }
    res.json({ coins });
});

app.get('/api/account-info', (_req: Request, res: Response) => {
    // Return what we have. Original returned full BinanceAccountInfo.
    // We have simplified PortfolioItem[].
    // If frontend strictly needs BinanceAccountInfo structure, we might need to fetch it or mock it.
    // But `fetchAccountInfo` in frontend seems to expect `BinanceAccountInfo`.
    // Let's try to fetch fresh from exchange or construct a compatible object.

    exchangeService.getBalance().then(balance => {
         // Construct a mock BinanceAccountInfo from CCXT balance
         // This is a "best effort" mapping to avoid breaking frontend types
         const balances = Object.keys(balance.total).map(asset => ({
             asset,
             free: (balance.free[asset] || 0).toString(),
             locked: (balance.used[asset] || 0).toString()
         }));

         const info: any = {
             canTrade: true,
             balances
         };
         res.json(info);
    }).catch(err => {
        res.status(500).json({ message: err.message });
    });
});

app.post('/api/order', async (req: Request, res: Response) => {
    const { symbol, side, quantity, quoteOrderQty } = req.body;
    // Manual order
    try {
        let amount = quantity;
        if (side === 'BUY' && quoteOrderQty && !quantity) {
             // Calculate amount from price? CCXT createOrder usually takes amount of base currency.
             // Some exchanges support 'cost' or params for quoteOrderQty.
             // For simplicity, we might need current price.
             const ticker = await exchangeService.fetchTickers().then(t => t.find(x => x.symbol === symbol));
             if (ticker && ticker.last) {
                 amount = parseFloat(quoteOrderQty) / ticker.last;
             }
        }

        const order = await exchangeService.placeOrder(symbol, 'market', side.toLowerCase() as 'buy'|'sell', Number(amount));
        res.json(order);
    } catch (err: any) {
        res.status(500).json({ message: err.message });
    }
});

// Global Error Handler
app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    console.error(err);
    res.status(500).json({ message: err.message || 'Server error' });
});

server.listen(PORT, () => {
    console.log(`Backend server running on port ${PORT}`);
    console.log(`Exchange: ${exchangeId}`);
});
