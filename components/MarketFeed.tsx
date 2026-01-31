
import React from 'react';
import { Coin } from '../src/types';

interface MarketFeedProps {
  coins: Coin[];
  maxCoinPrice: number;
  isLoading: boolean;
}

const MarketFeed: React.FC<MarketFeedProps> = ({ coins, maxCoinPrice, isLoading }) => {
  // Coins are already filtered by maxCoinPrice by the API service or App.tsx
  // Sorting is also handled upstream.

  if (isLoading) {
     return (
      <div className="bg-gray-800 p-6 rounded-lg shadow-xl mb-6">
        <h2 className="text-xl font-semibold text-sky-300 mb-4 border-b border-gray-700 pb-2">
          Monitored Coins (Under ${maxCoinPrice.toFixed(Math.max(2, (Math.log10(1/Math.max(0.00000001,maxCoinPrice)) || 0) + 2))})
        </h2>
        <p className="text-gray-400">Loading market data from Binance Testnet...</p>
      </div>
    );
  }

  if (coins.length === 0) {
    return (
      <div className="bg-gray-800 p-6 rounded-lg shadow-xl mb-6">
        <h2 className="text-xl font-semibold text-sky-300 mb-4 border-b border-gray-700 pb-2">
            Monitored Coins (Under ${maxCoinPrice.toFixed(Math.max(2, (Math.log10(1/Math.max(0.00000001,maxCoinPrice)) || 0) + 2))})
        </h2>
        <p className="text-gray-400">No coins found on Binance Testnet below ${maxCoinPrice.toFixed(2)} matching liquidity criteria. Adjust "Max Coin Price" or wait for market changes.</p>
      </div>
    );
  }
  
  return (
    <div className="bg-gray-800 p-6 rounded-lg shadow-xl mb-6">
      <h2 className="text-xl font-semibold text-sky-300 mb-4 border-b border-gray-700 pb-2">
        Monitored Coins (Under ${maxCoinPrice.toFixed(Math.max(2, (Math.log10(1/Math.max(0.00000001,maxCoinPrice)) || 0) + 2))})
      </h2>
      <div className="overflow-x-auto max-h-96">
        <table className="w-full min-w-max table-auto text-left">
          <thead>
            <tr className="text-gray-400 text-sm leading-normal sticky top-0 bg-gray-800 shadow-sm">
              <th className="py-3 px-4">Symbol</th>
              <th className="py-3 px-4 text-right">Price (USDT)</th>
              <th className="py-3 px-4 text-right">24h Change</th>
              <th className="py-3 px-4 text-right">Volume (24h)</th>
            </tr>
          </thead>
          <tbody className="text-gray-200 text-sm font-light">
            {coins.map((coin, index) => (
              <tr key={`${coin.id}-${index}`} className="border-b border-gray-700 hover:bg-gray-750 transition-colors">
                <td className="py-3 px-4">
                  <div className="font-semibold text-sky-400">{coin.symbol}</div>
                  <div className="text-xs text-gray-500">{coin.baseAsset}/USDT</div>
                </td>
                <td className="py-3 px-4 text-right font-mono">${coin.price.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 8})}</td>
                <td className={`py-3 px-4 text-right font-mono ${coin.priceChange24hPercent >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                  {coin.priceChange24hPercent.toFixed(2)}%
                </td>
                <td className="py-3 px-4 text-right font-mono">{coin.quoteVolume.toLocaleString(undefined, {minimumFractionDigits: 0, maximumFractionDigits: 0})} USDT</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default MarketFeed;
