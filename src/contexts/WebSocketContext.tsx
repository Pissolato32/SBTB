import React, { createContext, useContext, useEffect, useRef, useState, useCallback, ReactNode, useMemo } from 'react';
import { BotLog, BotStatus, Coin, PortfolioItem, CompletedTrade, BotSettings } from '../types';
import { INITIAL_USDT_BALANCE } from '../constants';

const BACKEND_WS_URL = window.location.protocol === 'https:' 
  ? `wss://${window.location.hostname}:3001` 
  : `ws://localhost:3001`; // Usando localhost para coincidir com o servidor backend

interface WebSocketContextType {
  sendMessage: (message: any) => void;
  isConnected: boolean;
  botStatus: BotStatus;
  settings: BotSettings;
  logs: BotLog[];
  marketData: Coin[];
  portfolio: PortfolioItem[];
  usdtBalance: number;
  tradeLedger: CompletedTrade[];
  addLog: (logData: Omit<BotLog, 'id' | 'timestamp'>) => void; // Para logs do frontend
}

const WebSocketContext = createContext<WebSocketContextType | undefined>(undefined);

export const useWebSocket = () => {
  const context = useContext(WebSocketContext);
  if (context === undefined) {
    throw new Error('useWebSocket must be used within a WebSocketProvider');
  }
  return context;
};

export const WebSocketProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<number | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [botStatus, setBotStatus] = useState<BotStatus>(BotStatus.INITIALIZING);
  const [settings, setSettings] = useState<BotSettings>({} as BotSettings); // Será populado pelo backend ou localStorage
  const [logs, setLogs] = useState<BotLog[]>([]);
  const [marketData, setMarketData] = useState<Coin[]>([]);
  const [portfolio, setPortfolio] = useState<PortfolioItem[]>([]);
  const [usdtBalance, setUsdtBalance] = useState<number>(INITIAL_USDT_BALANCE);
  const [tradeLedger, setTradeLedger] = useState<CompletedTrade[]>([]);

  const frontendAddLog = useCallback((logData: Omit<BotLog, 'id' | 'timestamp'>) => {
    setLogs(prevLogs => {
        const newLog = {
            id: Date.now().toString() + Math.random().toString(36).substr(2, 5),
            timestamp: Date.now(),
            ...logData
        };
        const updatedLogs = [newLog, ...prevLogs];
        return updatedLogs.slice(0, 200); // Manter no máximo 200 logs
    });
  }, []);


  const connectWebSocket = useCallback(() => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      return; // Already connected
    }

    const wsUrl = BACKEND_WS_URL;
    frontendAddLog({ message: `Frontend: Attempting to connect to backend WebSocket at ${wsUrl}...`, type: 'INFO' });
    const ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      frontendAddLog({ message: 'Frontend: WebSocket connected to backend.', type: 'SUCCESS' });
      setBotStatus(BotStatus.INITIALIZING); // Backend will send actual status
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
      setIsConnected(true);
      // Backend should send initial state upon connection
    };

    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data.toString());

        switch (message.type) {
          case 'log':
            frontendAddLog(message.payload);
            break;
          case 'status':
            setBotStatus(message.status);
            break;
          case 'settings':
            setSettings(message.settings);
            break;
          case 'market_data_init':
            setMarketData(message.payload.sort((a: Coin, b: Coin) => a.price - b.price));
            break;
          case 'market_update_single':
            setMarketData((prevData: Coin[]) => {
                const existingCoinIndex = prevData.findIndex((coin: Coin) => coin.symbol === message.payload.symbol);
                let newData;
                if (existingCoinIndex !== -1) {
                    newData = [...prevData];
                    newData[existingCoinIndex] = { ...newData[existingCoinIndex], ...message.payload };
                } else {
                    newData = [...prevData, message.payload];
                }
                return newData.sort((a, b) => a.price - b.price);
            });
            break;
          case 'portfolio_update':
             setPortfolio(message.payload.portfolio);
             setUsdtBalance(message.payload.usdtBalance);
             break;
          case 'trade_ledger_update':
             setTradeLedger(message.payload);
             break;
          case 'initial_state':
            const {
                botStatus: initialStatus,
                settings: initialSettings,
                logs: initialLogs,
                portfolio: initialPortfolio,
                usdtBalance: initialUsdtBalance,
                tradeLedger: initialTradeLedger,
                marketData: initialMarketData
            } = message.payload;
            setBotStatus(initialStatus);
            setSettings(prev => ({...prev, ...initialSettings}));
            
            if (initialLogs && initialLogs.length > 0) {
                setLogs(prev => {
                    const currentLogIds = new Set(prev.map(l => l.id));
                    const newLogsFromServer = initialLogs.filter((l: BotLog) => !currentLogIds.has(l.id));
                    return [...newLogsFromServer, ...prev].slice(0, 200);
                });
            }
            
            setPortfolio(initialPortfolio || []);
            setUsdtBalance(initialUsdtBalance || 0);
            setTradeLedger(initialTradeLedger || []);
            setMarketData(initialMarketData ? initialMarketData.sort((a: Coin, b: Coin) => a.price - b.price) : []);
            frontendAddLog({ message: 'Frontend: Received initial state from backend.', type: 'SUCCESS' });
             break;
          default:
            console.warn('Frontend: Received unknown WS message type:', message.type, message);
            frontendAddLog({ message: `Frontend: Received unknown WS message type: ${message.type}`, type: 'WARNING' });
        }
      } catch (error) {
        console.error('Frontend: Failed to parse or process WS message:', error, event.data);
        frontendAddLog({ message: `Frontend: Error processing WS message: ${error instanceof Error ? error.message : String(error)}`, type: 'ERROR' });
      }
    };

    ws.onerror = (error) => {
      console.error('Frontend: WebSocket error detail:', error);
      // @ts-ignore
      const message = error.message || 'Erro de conexão ou handshake';
      frontendAddLog({ message: `Frontend: WebSocket error: ${message}`, type: 'ERROR' });
    };

    ws.onclose = (event) => {
      wsRef.current = null;
      setIsConnected(false);
      frontendAddLog({ message: `Frontend: WebSocket disconnected. Code: ${event.code}, Reason: ${event.reason || 'N/A'}`, type: 'WARNING' });

      const reconnectDelay = 5000;
      frontendAddLog({ message: `Frontend: Attempting to reconnect in ${reconnectDelay / 1000} seconds...`, type: 'INFO' });
      reconnectTimeoutRef.current = window.setTimeout(connectWebSocket, reconnectDelay);
    };

    wsRef.current = ws;
  }, [frontendAddLog]); 

  useEffect(() => {
    connectWebSocket();
    return () => {
      if (wsRef.current) {
        wsRef.current.close();
      }
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
    };
  }, [connectWebSocket]);

  const sendMessage = useCallback((message: any) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(message));
    } else {
      frontendAddLog({ message: 'Frontend: WebSocket not connected. Message not sent.', type: 'ERROR' });
      console.warn('Frontend: WebSocket not connected. Message not sent:', message);
    }
  }, [frontendAddLog]);


  const contextValue: WebSocketContextType = useMemo(() => ({
    sendMessage,
    isConnected,
    botStatus,
    settings,
    logs,
    marketData,
    portfolio,
    usdtBalance,
    tradeLedger,
    addLog: frontendAddLog,
  }), [sendMessage, isConnected, botStatus, settings, logs, marketData, portfolio, usdtBalance, tradeLedger, frontendAddLog]);

  return (
    <WebSocketContext.Provider value={contextValue}>
      {children}
    </WebSocketContext.Provider>
  );
};
