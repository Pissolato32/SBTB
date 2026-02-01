// @ts-nocheck
import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import http from 'http';
import helmet from 'helmet';
import { WebSocketServer, WebSocket } from 'ws';
import { BotEngine } from './services/BotEngine.js';
import { CcxtExchange } from './services/ExchangeService.js';
import { SqlitePersistenceService } from './services/SqlitePersistenceService.js';
import { ConfigService } from './services/ConfigService.js';
import { BotSettings, BotStatus } from '../src/types.js';

const configService = ConfigService.getInstance();
const config = configService.getConfig();

const app = express();
app.use(helmet()); // Apply security headers
app.use(express.json());
app.use(cors());

const PORT = config.port;

console.log('[Server] Starting with config:', configService.getSafeConfig());

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

const persistence = new SqlitePersistenceService();
const exchangeService = new CcxtExchange(config.exchangeId);
const botEngine = new BotEngine(exchangeService, persistence, defaultSettings);

botEngine.initialize().catch(err => {
    console.error('[Critical] Bot Engine failed to initialize:', err);
    process.exit(1);
});

// --- WebSocket Server ---

const server = http.createServer(app);
const wss = new WebSocketServer({ 
    server,
    // Garante que o WS aceite conexões de qualquer origem em desenvolvimento
    verifyClient: () => true 
});
const clients: Set<WebSocket> = new Set();

// Hook up Bot Engine Events to WebSocket
botEngine.onMarketUpdate = (coins) => {
    const msg = JSON.stringify({ type: 'market_update_full', payload: coins });
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
            logs: [],
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
                if (msg.command === 'KILL_SWITCH') botEngine.stop(true);
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
    const hasKeys = !!config.apiKey && !!config.apiSecret;
    if (hasKeys) {
        res.json({ configured: true, message: 'API keys configured.' });
    } else {
        res.status(400).json({ configured: false, message: 'API keys missing.' });
    }
});

app.get('/api/market-data', (req: Request, res: Response) => {
    const maxCoinPrice = req.query.maxCoinPrice ? parseFloat(req.query.maxCoinPrice as string) : undefined;
    
    let coins = botEngine.marketData;
    if (maxCoinPrice !== undefined && !isNaN(maxCoinPrice)) {
        coins = coins.filter(c => c.price < maxCoinPrice);
    }
    res.json({ coins });
});

app.get('/api/account-info', (_req: Request, res: Response) => {
    exchangeService.getBalance().then(balance => {
         const balances = Object.keys(balance.total).map(asset => ({
             asset,
             free: ((balance.free as any)[asset] || 0).toString(),
             locked: ((balance.used as any)[asset] || 0).toString()
         }));

         const info: any = {
             canTrade: true,
             balances
         };
         res.json(info);
    }).catch(err => {
        console.error(`[API] Account Info failed:`, err);
        res.status(500).json({ message: 'Failed to fetch account info' });
    });
});

app.post('/api/order', async (req: Request, res: Response) => {
    const { symbol, side, quantity, quoteOrderQty } = req.body;

    if (!symbol || typeof symbol !== 'string') {
        return res.status(400).json({ message: 'Invalid symbol' });
    }
    if (!side || !['buy', 'sell'].includes(side.toLowerCase())) {
        return res.status(400).json({ message: 'Invalid side. Must be "BUY" or "SELL".' });
    }
    if ((!quantity && !quoteOrderQty) || (quantity && isNaN(Number(quantity))) || (quoteOrderQty && isNaN(Number(quoteOrderQty)))) {
         return res.status(400).json({ message: 'Invalid quantity' });
    }

    try {
        let amount = quantity ? Number(quantity) : 0;
        if (side.toUpperCase() === 'BUY' && quoteOrderQty && !quantity) {
             const ticker = await exchangeService.fetchTickers().then(t => t.find(x => x.symbol === symbol));
             if (ticker && ticker.last) {
                 amount = parseFloat(quoteOrderQty) / ticker.last;
             } else {
                 throw new Error('Could not fetch price to calculate quantity');
             }
        }

        const order = await exchangeService.placeOrder(symbol, 'market', side.toLowerCase() as 'buy'|'sell', Number(amount));
        res.json(order);
    } catch (err: any) {
        console.error(`[API] Order failed:`, err);
        res.status(500).json({ message: 'Order execution failed' });
    }
});

app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    console.error(`[Server] Unhandled Error:`, err);
    res.status(500).json({ message: 'Internal Server Error' });
});

server.listen(PORT, () => {
    console.log(`[Server] Backend running on http://localhost:${PORT}`);
    console.log(`[Server] WebSocket Server attached to same port`);
});
