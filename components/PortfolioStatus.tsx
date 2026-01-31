
import React from 'react';
import { PortfolioItem, Coin } from '../src/types';

interface PortfolioStatusProps {
  portfolio: PortfolioItem[];
  marketData: Coin[]; // To get current prices
  usdtBalance: number;
  isLoading: boolean;
}

const PortfolioStatus: React.FC<PortfolioStatusProps> = ({ portfolio, marketData, usdtBalance, isLoading }) => {
  if (isLoading) {
    return (
      <div className="bg-gray-800 p-6 rounded-lg shadow-xl mb-6">
        <h2 className="text-xl font-semibold text-sky-300 mb-4 border-b border-gray-700 pb-2">Current Portfolio</h2>
        <p className="text-gray-400">Loading portfolio from Binance Testnet account...</p>
      </div>
    );
  }

  const calculateTotalValue = () => {
    const assetsValue = portfolio.reduce((total, item) => {
      const coinData = marketData.find(c => c.symbol === item.symbol);
      const currentPrice = coinData ? coinData.price : (item.avgPurchasePrice || 0); // Fallback to purchase price if market data missing
      const currentValue = (item.amount + item.lockedAmount) * currentPrice;
      return total + currentValue;
    }, 0);
    return assetsValue + usdtBalance;
  };
  
  const totalPortfolioValue = calculateTotalValue();

  return (
    <div className="bg-gray-800 p-6 rounded-lg shadow-xl mb-6">
      <div className="flex justify-between items-center mb-4 border-b border-gray-700 pb-2">
        <h2 className="text-xl font-semibold text-sky-300">Current Portfolio (Testnet)</h2>
        <div className="text-lg">
            <span className="font-medium text-gray-300">Total Value (Est.): </span>
            <span className="font-bold text-sky-400">
              ${totalPortfolioValue.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})} USDT
            </span>
        </div>
      </div>
      <div className="overflow-x-auto max-h-96">
        <table className="w-full min-w-max table-auto text-left">
          <thead>
            <tr className="text-gray-400 text-sm leading-normal sticky top-0 bg-gray-800 shadow-sm">
              <th className="py-3 px-4">Asset</th>
              <th className="py-3 px-4 text-right">Total Held</th>
              <th className="py-3 px-4 text-right">Free</th>
              <th className="py-3 px-4 text-right">Locked</th>
              <th className="py-3 px-4 text-right">Bot Buy Price</th>
              <th className="py-3 px-4 text-right">Current Price</th>
              <th className="py-3 px-4 text-right">Current Value</th>
              <th className="py-3 px-4 text-right">Bot P/L ($)</th>
              <th className="py-3 px-4 text-right">Bot P/L (%)</th>
            </tr>
          </thead>
          <tbody className="text-gray-200 text-sm font-light">
            {/* Linha para o saldo em dinheiro (USDT) */}
            <tr className="border-b border-gray-700 bg-gray-750/30">
              <td className="py-3 px-4 font-semibold text-green-400">USDT (Cash)</td>
              <td className="py-3 px-4 text-right font-mono">{usdtBalance.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</td>
              <td className="py-3 px-4 text-right font-mono">{usdtBalance.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</td>
              <td className="py-3 px-4 text-right font-mono">0.00</td>
              <td className="py-3 px-4 text-right font-mono text-gray-500">N/A</td>
              <td className="py-3 px-4 text-right font-mono">$1.00</td>
              <td className="py-3 px-4 text-right font-mono">${usdtBalance.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</td>
              <td className="py-3 px-4 text-right font-mono text-gray-500">N/A</td>
              <td className="py-3 px-4 text-right font-mono text-gray-500">N/A</td>
            </tr>

            {portfolio.length === 0 && (
              <tr>
                <td colSpan={9} className="py-8 text-center text-gray-500 italic">
                  Nenhuma outra posição ativa no momento.
                </td>
              </tr>
            )}

            {portfolio.map((item) => {
              const coinData = marketData.find(c => c.symbol === item.symbol);
              const currentPrice = coinData ? coinData.price : (item.avgPurchasePrice || 0);
              const totalAmount = item.amount + item.lockedAmount;
              const currentValue = totalAmount * currentPrice;
              
              let profitLoss = 0;
              let profitLossPercent = 0;
              let purchaseValue = 0;

              if (item.avgPurchasePrice && item.avgPurchasePrice > 0) {
                purchaseValue = totalAmount * item.avgPurchasePrice;
                profitLoss = currentValue - purchaseValue;
                profitLossPercent = purchaseValue > 0 ? (profitLoss / purchaseValue) * 100 : 0;
              }

              return (
                <tr key={item.symbol} className="border-b border-gray-700 hover:bg-gray-750 transition-colors">
                  <td className="py-3 px-4 font-semibold text-sky-400">{item.baseAsset}</td>
                  <td className="py-3 px-4 text-right font-mono">{(item.amount + item.lockedAmount).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 6})}</td>
                  <td className="py-3 px-4 text-right font-mono">{item.amount.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 6})}</td>
                  <td className="py-3 px-4 text-right font-mono">{item.lockedAmount.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 6})}</td>
                  <td className="py-3 px-4 text-right font-mono">
                    {item.avgPurchasePrice ? `$${item.avgPurchasePrice.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 8})}` : 'N/A'}
                  </td>
                  <td className="py-3 px-4 text-right font-mono">${currentPrice.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 8})}</td>
                  <td className="py-3 px-4 text-right font-mono">${currentValue.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</td>
                  <td className={`py-3 px-4 text-right font-mono ${!item.avgPurchasePrice ? 'text-gray-500' : profitLoss >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                    {item.avgPurchasePrice ? profitLoss.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2}) : 'N/A'}
                  </td>
                  <td className={`py-3 px-4 text-right font-mono ${!item.avgPurchasePrice ? 'text-gray-500' : profitLossPercent >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                    {item.avgPurchasePrice ? `${profitLossPercent.toFixed(2)}%` : 'N/A'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default PortfolioStatus;
