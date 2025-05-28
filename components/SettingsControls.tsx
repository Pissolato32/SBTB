import React from 'react';
import { BotSettings, BotStatus } from '../src/types';

interface SettingsControlsProps {
  settings: BotSettings;
  onSettingsChange: <K extends keyof BotSettings>(key: K, value: BotSettings[K]) => void;
  botStatus: BotStatus;
  onStartBot: () => void;
  onStopBot: () => void;
  usdtBalance: number;
  isApiConfigured: boolean;
  onSaveSettings: () => void; // Nova prop para salvar configurações
}

const SettingsControls: React.FC<SettingsControlsProps> = ({
  settings,
  onSettingsChange,
  botStatus,
  onStartBot,
  onStopBot,
  usdtBalance,
  isApiConfigured,
  onSaveSettings, // Receber a nova prop
}) => {
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value, type, checked } = e.target;
    let parsedValue;
    if (type === 'checkbox') {
      parsedValue = checked;
    } else if (type === 'number') {
      parsedValue = parseFloat(value);
    } else {
      parsedValue = value;
    }
    onSettingsChange(name as keyof BotSettings, parsedValue as any);
  };
  const canStartBot = isApiConfigured && (botStatus === BotStatus.STOPPED || botStatus === BotStatus.ERROR || botStatus === BotStatus.INITIALIZING);

  return (
    <div className="bg-gray-800 p-6 rounded-lg shadow-xl mb-6">
      <h2 className="text-xl font-semibold text-sky-300 mb-4 border-b border-gray-700 pb-2">Bot Configuration & Controls</h2>
      
      {!isApiConfigured && (
        <div className="mb-4 p-3 bg-red-900 border border-red-700 rounded-md text-yellow-300 text-sm">
          <p className="font-semibold">API Keys Not Configured on Backend</p>
          <p>Please ensure BINANCE_API_KEY and BINANCE_API_SECRET are correctly set in the <code>server/.env</code> file and the backend server is running. Trading functionality is disabled.</p>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
        <div>
          <label htmlFor="maxCoinPrice" className="block text-sm font-medium text-gray-300 mb-1">
            Max Coin Price (USDT)
          </label>
          <input
            type="number"
            name="maxCoinPrice"
            id="maxCoinPrice"
            value={settings.maxCoinPrice}
            onChange={handleInputChange}
            className="w-full bg-gray-700 border border-gray-600 text-gray-100 rounded-md p-2 focus:ring-sky-500 focus:border-sky-500 transition"
            placeholder="e.g., 1.0"
            disabled={botStatus === BotStatus.RUNNING}
          />
          <p className="text-xs text-gray-400 mt-1">Bot will only consider coins below this price from Binance Testnet.</p>
        </div>
        <div>
          <label htmlFor="tradeAmountUSDT" className="block text-sm font-medium text-gray-300 mb-1">
            Trade Amount (USDT)
          </label>
          <input
            type="number"
            name="tradeAmountUSDT"
            id="tradeAmountUSDT"
            value={settings.tradeAmountUSDT}
            onChange={handleInputChange}
            className="w-full bg-gray-700 border border-gray-600 text-gray-100 rounded-md p-2 focus:ring-sky-500 focus:border-sky-500 transition"
            placeholder="e.g., 100"
            disabled={botStatus === BotStatus.RUNNING || !isApiConfigured}
          />
           <p className="text-xs text-gray-400 mt-1">Amount of USDT to use per trade on Testnet.</p>
        </div>
        <div>
          <label htmlFor="targetProfitPercent" className="block text-sm font-medium text-gray-300 mb-1">
            Target Profit (%)
          </label>
          <input
            type="number"
            name="targetProfitPercent"
            id="targetProfitPercent"
            value={settings.targetProfitPercent}
            onChange={handleInputChange}
            className="w-full bg-gray-700 border border-gray-600 text-gray-100 rounded-md p-2 focus:ring-sky-500 focus:border-sky-500 transition"
            placeholder="e.g., 5"
            disabled={botStatus === BotStatus.RUNNING || !isApiConfigured}
          />
        </div>
        <div>
          <label htmlFor="stopLossPercent" className="block text-sm font-medium text-gray-300 mb-1">
            Stop Loss (%)
          </label>
          <input
            type="number"
            name="stopLossPercent"
            id="stopLossPercent"
            value={settings.stopLossPercent}
            onChange={handleInputChange}
            className="w-full bg-gray-700 border border-gray-600 text-gray-100 rounded-md p-2 focus:ring-sky-500 focus:border-sky-500 transition"
            placeholder="e.g., 2"
            disabled={botStatus === BotStatus.RUNNING || !isApiConfigured}
          />
        </div>
        <div className="md:col-span-2">
          <label htmlFor="scanIntervalMs" className="block text-sm font-medium text-gray-300 mb-1">
            Scan Interval (ms)
          </label>
          <input
            type="number"
            name="scanIntervalMs"
            id="scanIntervalMs"
            value={settings.scanIntervalMs}
            onChange={handleInputChange}
            step="100"
            min="2000" 
            className="w-full bg-gray-700 border border-gray-600 text-gray-100 rounded-md p-2 focus:ring-sky-500 focus:border-sky-500 transition"
            disabled={botStatus === BotStatus.RUNNING}
          />
           <p className="text-xs text-gray-400 mt-1">How often the bot scans markets (min 2000ms).</p>
        </div>
    <div>
      <label htmlFor="maxOpenTrades" className="block text-sm font-medium text-gray-300 mb-1">
        Max Open Trades
      </label>
      <input
        type="number"
        name="maxOpenTrades"
        id="maxOpenTrades"
        value={settings.maxOpenTrades}
        onChange={handleInputChange}
        step="1"
        min="1"
        className="w-full bg-gray-700 border border-gray-600 text-gray-100 rounded-md p-2 focus:ring-sky-500 focus:border-sky-500 transition"
        disabled={botStatus === BotStatus.RUNNING}
      />
      <p className="text-xs text-gray-400 mt-1">Max number of concurrent trades bot can manage.</p>
        </div>
        {/* Novas Configurações de Indicadores */}
        <div className="md:col-span-2 border-t border-gray-700 pt-6 mt-6">
          <h3 className="text-lg font-semibold text-sky-400 mb-3">Indicator Settings</h3>
        </div>
        <div>
          <label htmlFor="rsiPeriod" className="block text-sm font-medium text-gray-300 mb-1">
            RSI Period
          </label>
          <input
            type="number"
            name="rsiPeriod"
            id="rsiPeriod"
            value={settings.rsiPeriod}
            onChange={handleInputChange}
            step="1"
            min="2"
            className="w-full bg-gray-700 border border-gray-600 text-gray-100 rounded-md p-2 focus:ring-sky-500 focus:border-sky-500 transition"
            disabled={botStatus === BotStatus.RUNNING}
          />
          <p className="text-xs text-gray-400 mt-1">Period for RSI calculation (e.g., 14).</p>
        </div>
        <div>
          <label htmlFor="rsiBuyThreshold" className="block text-sm font-medium text-gray-300 mb-1">
            RSI Buy Threshold
          </label>
          <input
            type="number"
            name="rsiBuyThreshold"
            id="rsiBuyThreshold"
            value={settings.rsiBuyThreshold}
            onChange={handleInputChange}
            step="1"
            min="1" max="99"
            className="w-full bg-gray-700 border border-gray-600 text-gray-100 rounded-md p-2 focus:ring-sky-500 focus:border-sky-500 transition"
            disabled={botStatus === BotStatus.RUNNING}
          />
          <p className="text-xs text-gray-400 mt-1">Buy if RSI is below this value (e.g., 30).</p>
        </div>
        <div>
          <label htmlFor="smaShortPeriod" className="block text-sm font-medium text-gray-300 mb-1">
            SMA Short Period
          </label>
          <input
            type="number"
            name="smaShortPeriod"
            id="smaShortPeriod"
            value={settings.smaShortPeriod}
            onChange={handleInputChange}
            step="1"
            min="2"
            className="w-full bg-gray-700 border border-gray-600 text-gray-100 rounded-md p-2 focus:ring-sky-500 focus:border-sky-500 transition"
            disabled={botStatus === BotStatus.RUNNING}
          />
          <p className="text-xs text-gray-400 mt-1">Period for Short SMA (e.g., 9).</p>
        </div>
        <div>
          <label htmlFor="smaLongPeriod" className="block text-sm font-medium text-gray-300 mb-1">
            SMA Long Period
          </label>
          <input
            type="number"
            name="smaLongPeriod"
            id="smaLongPeriod"
            value={settings.smaLongPeriod}
            onChange={handleInputChange}
            step="1"
            min="5" // Longa deve ser maior que a curta
            className="w-full bg-gray-700 border border-gray-600 text-gray-100 rounded-md p-2 focus:ring-sky-500 focus:border-sky-500 transition"
            disabled={botStatus === BotStatus.RUNNING}
          />
          <p className="text-xs text-gray-400 mt-1">Period for Long SMA (e.g., 21).</p>
        </div>

        {/* Novas Configurações de Trailing Stop-Loss */}
        <div className="md:col-span-2 border-t border-gray-700 pt-6 mt-6">
          <h3 className="text-lg font-semibold text-sky-400 mb-3">Trailing Stop-Loss Settings</h3>
        </div>
        <div className="flex items-center">
          <input
            type="checkbox"
            name="useTrailingStop"
            id="useTrailingStop"
            checked={settings.useTrailingStop}
            onChange={handleInputChange}
            className="h-5 w-5 bg-gray-700 border-gray-600 text-sky-500 focus:ring-sky-500 rounded transition"
            disabled={botStatus === BotStatus.RUNNING || !isApiConfigured}
          />
          <label htmlFor="useTrailingStop" className="ml-2 block text-sm font-medium text-gray-300">
            Use Trailing Stop-Loss
          </label>
        </div>
        <div className={!settings.useTrailingStop ? 'opacity-50' : ''}>
          <label htmlFor="trailingStopArmPercentage" className="block text-sm font-medium text-gray-300 mb-1">
            Arm TSL at Profit (%)
          </label>
          <input
            type="number"
            name="trailingStopArmPercentage"
            id="trailingStopArmPercentage"
            value={settings.trailingStopArmPercentage}
            onChange={handleInputChange}
            step="0.1"
            min="0.1"
            className="w-full bg-gray-700 border border-gray-600 text-gray-100 rounded-md p-2 focus:ring-sky-500 focus:border-sky-500 transition"
            disabled={botStatus === BotStatus.RUNNING || !isApiConfigured || !settings.useTrailingStop}
          />
          <p className="text-xs text-gray-400 mt-1">Profit % to activate trailing stop (e.g., 1.0 for 1%).</p>
        </div>
        <div className={!settings.useTrailingStop ? 'opacity-50' : ''}>
          <label htmlFor="trailingStopOffsetPercentage" className="block text-sm font-medium text-gray-300 mb-1">
            TSL Offset (%)
          </label>
          <input
            type="number"
            name="trailingStopOffsetPercentage"
            id="trailingStopOffsetPercentage"
            value={settings.trailingStopOffsetPercentage}
            onChange={handleInputChange}
            step="0.1"
            min="0.1"
            className="w-full bg-gray-700 border border-gray-600 text-gray-100 rounded-md p-2 focus:ring-sky-500 focus:border-sky-500 transition"
            disabled={botStatus === BotStatus.RUNNING || !isApiConfigured || !settings.useTrailingStop}
          />
          <p className="text-xs text-gray-400 mt-1">Trail stop % below highest price (e.g., 0.5 for 0.5%).</p>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          {botStatus !== BotStatus.RUNNING ? (
            <button
              onClick={onStartBot}
              disabled={!canStartBot}
              className={`px-6 py-2 text-white font-semibold rounded-md shadow-md transition transform hover:scale-105 focus:outline-none focus:ring-2  focus:ring-opacity-50 ${
                canStartBot ? 'bg-green-600 hover:bg-green-700 focus:ring-green-500' : 'bg-gray-500 cursor-not-allowed'
              }`}
            >
              Start Bot
            </button>
          ) : (
            <button
              onClick={onStopBot}
              className="px-6 py-2 bg-red-600 hover:bg-red-700 text-white font-semibold rounded-md shadow-md transition transform hover:scale-105 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-opacity-50"
            >
              Stop Bot
            </button>
          )}
          <div className="text-sm">
            <button
              onClick={onSaveSettings}
              disabled={botStatus === BotStatus.RUNNING}
              className={`px-4 py-2 text-sm font-semibold rounded-md shadow-sm transition transform hover:scale-105 focus:outline-none focus:ring-2 focus:ring-opacity-50 ${
                botStatus === BotStatus.RUNNING ? 'bg-gray-600 text-gray-400 cursor-not-allowed' : 'bg-indigo-600 hover:bg-indigo-700 text-white focus:ring-indigo-500'
              }`}
            >
              Save Settings
            </button>
            <span className="font-medium text-gray-300">Status: </span>
            <span
              className={`font-semibold ${
                botStatus === BotStatus.RUNNING ? 'text-green-400' :
                botStatus === BotStatus.STOPPED ? 'text-yellow-400' :
                botStatus === BotStatus.INITIALIZING ? 'text-blue-400' :
                'text-red-400'
              }`}
            >
              {botStatus}
            </span>
          </div>
        </div>
        <div className="text-lg">
            <span className="font-medium text-gray-300">Testnet Balance (USDT): </span>
            <span className="font-bold text-sky-400">${usdtBalance.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</span>
        </div>
      </div>
      <div className="text-xs text-gray-500 mt-4 pt-2 border-t border-gray-700">
          <p>Backend API Key Status: <span className={isApiConfigured ? "text-green-400" : "text-red-400"}>{isApiConfigured ? "Configured" : "Not Configured / Error"}</span></p>
          {isApiConfigured && <p className="text-green-400">Backend confirms API keys are set. Bot can connect to Binance Testnet via backend.</p>}
      </div>
    </div>
  );
};

export default SettingsControls;
