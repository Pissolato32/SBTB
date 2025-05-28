import React, { useEffect, useRef } from 'react';
import { BotLog, BotStatus, Coin, PortfolioItem, CompletedTrade, BotSettings } from '../src/types';

interface WebSocketManagerProps {
  addLog: (log: Omit<BotLog, 'id' | 'timestamp'>) => void; // This prop type is fine if addLog doesn't use functional updates
  setBotStatus: React.Dispatch<React.SetStateAction<BotStatus>>;
  setMarketData: React.Dispatch<React.SetStateAction<Coin[]>>;
  setPortfolio: React.Dispatch<React.SetStateAction<PortfolioItem[]>>;
  setUsdtBalance: React.Dispatch<React.SetStateAction<number>>;
  setTradeLedger: React.Dispatch<React.SetStateAction<CompletedTrade[]>>;
  setSettings: React.Dispatch<React.SetStateAction<BotSettings>>;
  // TODO: Adicionar props para enviar mensagens para o backend
}

const WebSocketManager: React.FC<WebSocketManagerProps> = ({
  addLog,
  setBotStatus,
  setMarketData,
  setPortfolio,
  setUsdtBalance,
  setTradeLedger,
  setSettings,
}) => {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<number | null>(null);

  const connectWebSocket = () => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      return; // Already connected
    }

    // Determine WebSocket URL - assuming it's on the same host/port as the HTTP server, but on the /ws path
    // In production, you might need a specific WS URL.
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host; // Includes hostname and port
    const wsUrl = `${protocol}//${host}`; // Connect to the root, backend will handle /ws internally

    addLog({ message: `Frontend: Attempting to connect to backend WebSocket at ${wsUrl}...`, type: 'INFO' });
    const ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      addLog({ message: 'Frontend: WebSocket connected to backend.', type: 'SUCCESS' });
      setBotStatus(BotStatus.INITIALIZING); // Assume initializing until backend sends status
      if (reconnectTimeoutRef.current) {
        window.clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
      // TODO: Send a message to backend requesting initial state?
      // Or backend automatically sends initial state upon connection.
    };

    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data.toString());
        // console.log('Frontend: Received WS message:', message); // Too noisy

        switch (message.type) {
          case 'log':
            addLog(message.payload);
            break;
          case 'status':
            setBotStatus(message.status);
            break;
          case 'settings':
            setSettings(message.settings); // Update frontend settings state
            addLog({ message: 'Frontend: Received updated settings from backend.', type: 'INFO' });
            break;
          case 'market_update_single':
            // Update a single coin in the marketData list
            setMarketData((prevData: Coin[]): Coin[] => { // Explicitly type prevData and return type
                const updatedData = prevData.map((coin) => // Explicitly type coin
                    coin.symbol === message.payload.symbol ? { ...coin, ...message.payload } : coin
                );
                // If the coin isn't in the current list, add it (might happen if market data is filtered)
                if (!updatedData.find((coin) => coin.symbol === message.payload.symbol)) { // Explicitly type coin
                     // This case might need refinement depending on how marketData is managed (e.g., periodic fetch vs WS only)
                     // For now, let's just add it if it's not there. This might not be the desired behavior if marketData is strictly filtered.
                     return [...updatedData, message.payload];
                }
                return updatedData;
            });
            break;
          case 'market_update_batch':
             // Replace the entire market data list (less efficient but simpler)
             setMarketData(message.payload);
             break;
          case 'portfolio_update':
             setPortfolio(message.payload.portfolio);
             setUsdtBalance(message.payload.usdtBalance);
             addLog({ message: 'Frontend: Received portfolio update from backend.', type: 'INFO' });
             break;
          case 'trade_completed':
             setTradeLedger((prevLedger: CompletedTrade[]): CompletedTrade[] => [message.payload, ...prevLedger.slice(0, 499)]); // Explicitly type prevLedger and return type
             addLog({ message: `Frontend: Received completed trade for ${message.payload.pair}.`, type: 'INFO' });
             break;
          // TODO: Handle other message types (e.g., initial state, errors)
          default:
            console.warn('Frontend: Received unknown WS message type:', message.type, message);
            addLog({ message: `Frontend: Received unknown WS message type: ${message.type}`, type: 'WARNING' });
        }
      } catch (error) {
        console.error('Frontend: Failed to parse or process WS message:', error, event.data);
        addLog({ message: `Frontend: Error processing WS message: ${error instanceof Error ? error.message : String(error)}`, type: 'ERROR' });
      }
    };

    ws.onerror = (error) => {
      console.error('Frontend: WebSocket error:', error);
      addLog({ message: 'Frontend: WebSocket error occurred.', type: 'ERROR' });
      // Error event is usually followed by a close event
    };

    ws.onclose = (event) => {
      wsRef.current = null; // Clear the ref
      addLog({ message: `Frontend: WebSocket disconnected. Code: ${event.code}, Reason: ${event.reason || 'N/A'}`, type: 'WARNING' });

      // Attempt to reconnect
      const reconnectDelay = 5000; // 5 seconds
      addLog({ message: `Frontend: Attempting to reconnect in ${reconnectDelay / 1000} seconds...`, type: 'INFO' });
      reconnectTimeoutRef.current = window.setTimeout(connectWebSocket, reconnectDelay);
    };

    wsRef.current = ws; // Store the WebSocket instance in the ref
  };

  // Effect to establish connection on mount
  useEffect(() => {
    connectWebSocket();

    // Cleanup function to close WebSocket on unmount
    return () => {
      if (wsRef.current) {
        wsRef.current.close();
      }
      if (reconnectTimeoutRef.current) {
        window.clearTimeout(reconnectTimeoutRef.current);
      }
    };
  }, []); // Empty dependency array means this runs only on mount and unmount

  // TODO: Add functions here to expose send capability to App.tsx
  // For example, using useImperativeHandle or passing down a send function via context
  // For now, App.tsx will log commands instead of sending.

  return null; // This component doesn't render anything visible
};

export default WebSocketManager;