import React, { useState, useMemo } from 'react';
import { CompletedTrade } from '../src/types';

interface TradeLedgerViewProps {
  tradeLedger: CompletedTrade[];
  onClose: () => void; // Função para fechar a visualização (ex: modal)
}

const TradeLedgerView: React.FC<TradeLedgerViewProps> = ({ tradeLedger, onClose }) => {
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');

  const filteredTrades = useMemo(() => {
    if (!tradeLedger) return [];
    return tradeLedger.filter(trade => {
      const tradeDate = new Date(trade.timestamp);
      const start = startDate ? new Date(startDate) : null;
      const end = endDate ? new Date(endDate) : null;

      if (start && tradeDate < start) {
        return false;
      }
      // Ajustar a data final para incluir o dia inteiro
      if (end) {
        const endOfDay = new Date(end);
        endOfDay.setHours(23, 59, 59, 999);
        if (tradeDate > endOfDay) {
          return false;
        }
      }
      return true;
    });
  }, [tradeLedger, startDate, endDate]);

  const summary = useMemo(() => {
    if (!filteredTrades.length) {
      return {
        totalTrades: 0,
        totalProfitLoss: 0,
        profitableTrades: 0,
        lossTrades: 0,
        winRate: 0,
        avgProfit: 0,
        avgLoss: 0,
      };
    }

    let totalProfitLoss = 0;
    let profitableTrades = 0;
    let lossTrades = 0;
    let sumOfProfits = 0;
    let sumOfLosses = 0;

    filteredTrades.forEach(trade => {
      if (trade.type === 'SELL' && trade.profitAmount !== undefined) {
        totalProfitLoss += trade.profitAmount;
        if (trade.profitAmount > 0) {
          profitableTrades++;
          sumOfProfits += trade.profitAmount;
        } else if (trade.profitAmount < 0) {
          lossTrades++;
          sumOfLosses += trade.profitAmount;
        }
      }
    });

    const totalSellTrades = profitableTrades + lossTrades;

    return {
      totalTrades: filteredTrades.length, // Total de transações (compras e vendas)
      totalSellTrades: totalSellTrades, // Total de vendas com P/L calculado
      totalProfitLoss: totalProfitLoss,
      profitableTrades: profitableTrades,
      lossTrades: lossTrades,
      winRate: totalSellTrades > 0 ? (profitableTrades / totalSellTrades) * 100 : 0,
      avgProfit: profitableTrades > 0 ? sumOfProfits / profitableTrades : 0,
      avgLoss: lossTrades > 0 ? sumOfLosses / lossTrades : 0, // avgLoss será negativo
    };
  }, [filteredTrades]);

  const formatDate = (timestamp: number) => {
    return new Date(timestamp).toLocaleString([], {
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
    });
  };

  return (
    <div className="fixed inset-0 bg-gray-900 bg-opacity-75 flex items-center justify-center p-4 z-50">
      <div className="bg-gray-800 p-6 rounded-lg shadow-xl w-full max-w-5xl max-h-[90vh] flex flex-col">
        <div className="flex justify-between items-center mb-4 border-b border-gray-700 pb-3">
          <h2 className="text-2xl font-semibold text-sky-300">Trade Ledger</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-200 transition-colors text-2xl"
            aria-label="Close"
          >
            &times;
          </button>
        </div>

        {/* Filtros de Data */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
          <div>
            <label htmlFor="startDate" className="block text-sm font-medium text-gray-300 mb-1">
              Start Date:
            </label>
            <input
              type="date"
              id="startDate"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="w-full bg-gray-700 border border-gray-600 text-gray-100 rounded-md p-2 focus:ring-sky-500 focus:border-sky-500"
            />
          </div>
          <div>
            <label htmlFor="endDate" className="block text-sm font-medium text-gray-300 mb-1">
              End Date:
            </label>
            <input
              type="date"
              id="endDate"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="w-full bg-gray-700 border border-gray-600 text-gray-100 rounded-md p-2 focus:ring-sky-500 focus:border-sky-500"
            />
          </div>
        </div>

        {/* Resumo Financeiro */}
        <div className="bg-gray-750 p-4 rounded-md mb-6">
          <h3 className="text-lg font-semibold text-sky-400 mb-3">Summary (Filtered Period)</h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 text-sm">
            <div><strong>Total P/L:</strong> <span className={summary.totalProfitLoss >= 0 ? 'text-green-400' : 'text-red-400'}>${summary.totalProfitLoss.toFixed(2)}</span></div>
            <div><strong>Total Trades:</strong> {summary.totalTrades}</div>
            <div><strong>Sell Trades:</strong> {summary.totalSellTrades}</div>
            <div><strong>Profitable Sells:</strong> <span className="text-green-400">{summary.profitableTrades}</span></div>
            <div><strong>Losing Sells:</strong> <span className="text-red-400">{summary.lossTrades}</span></div>
            <div><strong>Win Rate (Sells):</strong> {summary.winRate.toFixed(2)}%</div>
            <div><strong>Avg. Profit/Sell:</strong> <span className="text-green-400">${summary.avgProfit.toFixed(2)}</span></div>
            <div><strong>Avg. Loss/Sell:</strong> <span className="text-red-400">${summary.avgLoss.toFixed(2)}</span></div>
          </div>
        </div>

        {/* Tabela de Transações */}
        <div className="overflow-y-auto flex-grow min-h-0"> {/* Adicionado min-h-0 */}
          {filteredTrades.length === 0 ? (
            <p className="text-gray-400 text-center py-8">No trades found for the selected period.</p>
          ) : (
            <table className="w-full min-w-max table-auto text-left">
              <thead className="sticky top-0 bg-gray-750 z-10">
                <tr className="text-gray-400 text-xs uppercase leading-normal">
                  <th className="py-3 px-3">Date/Time</th>
                  <th className="py-3 px-3">Pair</th>
                  <th className="py-3 px-3">Type</th>
                  <th className="py-3 px-3 text-right">Price (USDT)</th>
                  <th className="py-3 px-3 text-right">Amount</th>
                  <th className="py-3 px-3 text-right">Cost/Value (USDT)</th>
                  <th className="py-3 px-3 text-right">P/L (USDT)</th>
                  <th className="py-3 px-3 text-right">P/L (%)</th>
                  <th className="py-3 px-3">Order ID</th>
                </tr>
              </thead>
              <tbody className="text-gray-200 text-sm font-light">
                {filteredTrades.map((trade) => (
                  <tr key={trade.id} className="border-b border-gray-700 hover:bg-gray-700 transition-colors">
                    <td className="py-2 px-3 whitespace-nowrap">{formatDate(trade.timestamp)}</td>
                    <td className="py-2 px-3 font-semibold">{trade.pair}</td>
                    <td className={`py-2 px-3 font-semibold ${trade.type === 'BUY' ? 'text-green-400' : 'text-red-400'}`}>
                      {trade.type}
                    </td>
                    <td className="py-2 px-3 text-right font-mono">${trade.price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 8 })}</td>
                    <td className="py-2 px-3 text-right font-mono">{trade.amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 6 })}</td>
                    <td className="py-2 px-3 text-right font-mono">${trade.cost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                    <td className={`py-2 px-3 text-right font-mono ${trade.profitAmount === undefined ? '' : (trade.profitAmount >= 0 ? 'text-green-400' : 'text-red-400')}`}>
                      {trade.profitAmount !== undefined ? `$${trade.profitAmount.toFixed(2)}` : 'N/A'}
                    </td>
                    <td className={`py-2 px-3 text-right font-mono ${trade.profitPercent === undefined ? '' : (trade.profitPercent >= 0 ? 'text-green-400' : 'text-red-400')}`}>
                      {trade.profitPercent !== undefined ? `${trade.profitPercent.toFixed(2)}%` : 'N/A'}
                    </td>
                    <td className="py-2 px-3 text-xs text-gray-500">{trade.orderId || 'N/A'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
};

export default TradeLedgerView;
