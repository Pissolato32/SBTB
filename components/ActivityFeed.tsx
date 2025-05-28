
import React, { useEffect, useRef } from 'react';
import { BotLog } from '../src/types'; // Caminho atualizado para consistência

interface ActivityFeedProps {
  logs: BotLog[];
}


const ActivityFeed: React.FC<ActivityFeedProps> = ({ logs }) => {
  const getLogColor = (type: BotLog['type']): string => {
    switch (type) {
      case 'SUCCESS':
      case 'BUY':
      case 'SELL':
        return 'text-green-400';
      case 'ERROR':
        return 'text-red-400';
      case 'WARNING':
         return 'text-yellow-400';
      case 'STRATEGY_INFO':
        return 'text-purple-400';
      case 'API_KEY':
        return 'text-orange-400';
      case 'INFO':
      default:
        return 'text-sky-400';
    }
  };
  
  const getLogIcon = (type: BotLog['type']): React.ReactNode => {
    switch (type) {
      case 'BUY': return <span className="mr-2">🛍️</span>;
      case 'SELL': return <span className="mr-2">💸</span>;
      case 'SUCCESS': return <span className="mr-2">✅</span>;
      case 'ERROR': return <span className="mr-2">❌</span>;
      case 'WARNING': return <span className="mr-2">⚠️</span>;
      case 'STRATEGY_INFO': return <span className="mr-2">💡</span>;
      case 'API_KEY': return <span className="mr-2">🔑</span>;
      case 'INFO':
      default:
        return <span className="mr-2">ℹ️</span>;
    }
  }

  const getBorderColor = (type: BotLog['type']): string => {
     switch (type) {
      case 'SUCCESS':
      case 'BUY':
      case 'SELL':
        return 'border-green-500';
      case 'ERROR':
        return 'border-red-500';
      case 'WARNING':
        return 'border-yellow-500';
      case 'STRATEGY_INFO':
        return 'border-purple-500';
      case 'API_KEY':
        return 'border-orange-500';
      case 'INFO':
      default:
        return 'border-sky-500';
    }
  }

  const logsContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (logsContainerRef.current) {
      logsContainerRef.current.scrollTop = logsContainerRef.current.scrollHeight;
    }
  }, [logs]); // Rola para o final sempre que a lista de logs mudar

  return (
    <div className="bg-gray-800 p-6 rounded-lg shadow-xl">
      <h2 className="text-xl font-semibold text-sky-300 mb-4 border-b border-gray-700 pb-2">Activity Log</h2>
      {logs.length === 0 ? (
        <p className="text-gray-400">No activity yet. Start the bot or perform actions.</p>
      ) : (
        <div ref={logsContainerRef} className="max-h-[600px] overflow-y-auto space-y-3 pr-2">
          {logs.slice().reverse().map((log) => ( // Display newest logs at the bottom
            <div key={log.id} className={`p-3 rounded-md bg-gray-750 border-l-4 ${getBorderColor(log.type)}`}
            >
              <div className="flex items-center text-xs text-gray-400 mb-1">
                {getLogIcon(log.type)}
                <span>{new Date(log.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
                <span className={`ml-auto font-semibold ${getLogColor(log.type)}`}>{log.type}</span>
              </div>
              <p className={`text-sm ${getLogColor(log.type)}`}>{log.message}</p>
              {(log.type === 'BUY' || log.type === 'SELL') && (
                <div className="mt-1 text-xs text-gray-500 space-y-0.5">
                  {log.pair && <div><strong>Pair:</strong> {log.pair}</div>}
                  {log.orderId && <div><strong>Order ID:</strong> {log.orderId}</div>}
                  {log.orderType && <div><strong>Type:</strong> {log.orderType}</div>}
                  {log.price !== undefined && <div><strong>Price:</strong> ${log.price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 8 })}</div>}
                  {log.amount !== undefined && <div><strong>Amount:</strong> {log.amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 6 })}</div>}
                  {log.cost !== undefined && <div><strong>Cost:</strong> ${log.cost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDT</div>}
                  {log.reason && <div className="italic"><strong>Reason:</strong> {log.reason}</div>}
                  {log.type === 'SELL' && log.profitAmount !== undefined && (
                    <div>
                      <strong>P/L: </strong> 
                      <span className={log.profitAmount >= 0 ? 'text-green-400' : 'text-red-400'}>
                        ${log.profitAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        {log.profitPercent !== undefined && ` (${log.profitPercent.toFixed(2)}%)`}
                      </span>
                    </div>
                  )}
                </div>
              )}
              {log.type === 'STRATEGY_INFO' && log.pair && <div className="mt-1 text-xs text-gray-500"><strong>Pair:</strong> {log.pair}</div>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default ActivityFeed;
