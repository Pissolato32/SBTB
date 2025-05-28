import React, { useState, useEffect, useCallback } from 'react';
import Header from '../components/Header';
import SettingsControls from '../components/SettingsControls';
import MarketFeed from '../components/MarketFeed';
import PortfolioStatus from '../components/PortfolioStatus';
import ActivityFeed from '../components/ActivityFeed';
import TradeLedgerView from '../components/TradeLedgerView';
import { BotSettings, BotStatus, BotLog, Coin, PortfolioItem, CompletedTrade } from './types';
import {
  checkApiKeyConfigured,
    } from '../services/binanceApiService';
import { INITIAL_USDT_BALANCE } from './constants';
import { useWebSocket } from './contexts/WebSocketContext';

const BOT_SETTINGS_KEY = 'sbtbBotSettings'; // Chave para salvar as configurações do bot (UI)

const App = (): React.ReactElement => {
  const [settings, setSettings] = useState<BotSettings>({
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
  });

  const {
    sendMessage,
    isConnected,
    botStatus: backendBotStatus,
    settings: backendSettings,
    logs: backendLogs,
    marketData: backendMarketData,
    portfolio: backendPortfolio,
    usdtBalance: backendUsdtBalance,
    tradeLedger: backendTradeLedger,
    addLog: addWsLog
  } = useWebSocket();

  const [botStatus, setBotStatus] = useState<BotStatus>(backendBotStatus || BotStatus.INITIALIZING);
  const [logs, setLogs] = useState<BotLog[]>(backendLogs || []);
  const [marketData, setMarketData] = useState<Coin[]>(backendMarketData || []);
  const [tradeLedger, setTradeLedger] = useState<CompletedTrade[]>(backendTradeLedger || []);
  const [portfolio, setPortfolio] = useState<PortfolioItem[]>(backendPortfolio || []);
  const [usdtBalance, setUsdtBalance] = useState<number>(backendUsdtBalance || INITIAL_USDT_BALANCE);
  const [isApiConfigured, setIsApiConfigured] = useState(false);

  useEffect(() => {
    setBotStatus(backendBotStatus);
  }, [backendBotStatus]);

  useEffect(() => {
    setLogs(backendLogs);
  }, [backendLogs]);

  useEffect(() => {
    const savedBotSettings = localStorage.getItem(BOT_SETTINGS_KEY);
    if (savedBotSettings) {
      try {
        const parsedSettings: BotSettings = JSON.parse(savedBotSettings);
        setSettings(prevSettings => ({ ...prevSettings, ...parsedSettings, ...backendSettings }));
        // addWsLog({ message: 'Frontend: Loaded UI settings from localStorage.', type: 'INFO' }); // Logged by context now
      } catch (error) {
        console.error("Failed to parse bot settings from localStorage", error);
        addWsLog({ message: 'Frontend: Failed to parse bot settings from localStorage. Using default/backend settings.', type: 'WARNING' });
        localStorage.removeItem(BOT_SETTINGS_KEY);
      }
    } else {
      // addWsLog({ message: 'Frontend: No saved UI settings found. Using default/backend settings.', type: 'INFO' }); // Logged by context now
      if (backendSettings && Object.keys(backendSettings).length > 0) { // Check if backendSettings is not empty
        setSettings(backendSettings);
      }
    }
  }, [addWsLog, backendSettings]);

  useEffect(() => {
    setMarketData(backendMarketData);
  }, [backendMarketData]);

  useEffect(() => {
    setPortfolio(backendPortfolio);
  }, [backendPortfolio]);

  useEffect(() => {
    setUsdtBalance(backendUsdtBalance);
  }, [backendUsdtBalance]);

  useEffect(() => {
    setTradeLedger(backendTradeLedger);
  }, [backendTradeLedger]);

  useEffect(() => {
    if (!isConnected) {
      addWsLog({ message: 'Frontend: Checking API key configuration with backend (HTTP)...', type: 'INFO' });
      checkApiKeyConfigured().then(status => {
        setIsApiConfigured(status.configured);
        if (status.configured) {
          addWsLog({ message: 'Frontend: Backend confirms API keys are configured (HTTP check).', type: 'API_KEY' });
        } else {
          addWsLog({ message: status.message || 'Frontend: Backend reports API keys are NOT configured (HTTP check).', type: 'ERROR' });
          setBotStatus(BotStatus.ERROR);
        }
      }).catch(err => {
        addWsLog({ message: `Frontend: Error checking API key status (HTTP): ${err.message}`, type: 'ERROR' });
        setBotStatus(BotStatus.ERROR);
      });
    } else {
        if (backendBotStatus !== BotStatus.ERROR) {
            setIsApiConfigured(true); // Assume configured if WS is connected and bot is not in error
        } else {
            setIsApiConfigured(false); // If bot is in error state from backend, reflect that
        }
    }
  }, [addWsLog, isConnected, backendBotStatus]);


  const handleSettingsChange = useCallback(<K extends keyof BotSettings>(key: K, value: BotSettings[K]) => {
    setSettings(prev => ({ ...prev, [key]: value as BotSettings[K] }));
  }, []);

  const handleSaveSettings = useCallback(() => {
    try {
      localStorage.setItem(BOT_SETTINGS_KEY, JSON.stringify(settings));
      addWsLog({ message: 'Frontend: UI settings saved to local storage.', type: 'SUCCESS' });
      sendMessage({ type: 'settings', payload: settings });
      addWsLog({ message: 'Frontend: Sent updated settings to backend.', type: 'INFO' });
    } catch (error) {
      addWsLog({ message: 'Frontend: Failed to save bot settings to local storage (UI only).', type: 'ERROR' });
      console.error("Error saving bot settings to localStorage:", error);
    }
  }, [settings, addWsLog, sendMessage]);

  const handleStartBot = useCallback(async () => {
    if (!isApiConfigured) {
      addWsLog({ message: 'Frontend: Cannot start bot: API keys are not configured on backend.', type: 'ERROR' });
      setBotStatus(BotStatus.ERROR);
      return;
    }
    sendMessage({ type: 'command', command: 'START_BOT' });
  }, [isApiConfigured, addWsLog, sendMessage]);

  const handleStopBot = useCallback(() => {
    sendMessage({ type: 'command', command: 'STOP_BOT' });
  }, [sendMessage]);
  
  const [showTradeLedger, setShowTradeLedger] = useState(false);

  return (
    <>
      <div className="bg-gray-900 min-h-screen text-gray-100 flex flex-col antialiased">
        <Header />
        <main className="container mx-auto p-4 sm:p-6 flex-grow w-full">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 flex flex-col space-y-6">
              <SettingsControls
                settings={settings}
                onSettingsChange={handleSettingsChange}
                botStatus={botStatus}
                onStartBot={handleStartBot}
                onStopBot={handleStopBot}
                usdtBalance={usdtBalance}
                isApiConfigured={isApiConfigured}
                onSaveSettings={handleSaveSettings}
              />
              <MarketFeed
                coins={marketData}
                maxCoinPrice={settings.maxCoinPrice}
                isLoading={!isConnected && marketData.length === 0}
              />
              <PortfolioStatus
                portfolio={portfolio}
                marketData={marketData}
                isLoading={!isConnected && portfolio.length === 0 && usdtBalance === 0}
              />
            </div>
            <div className="lg:col-span-1">
              <ActivityFeed logs={logs} />
            </div>
            <div className="lg:col-span-3 mt-4">
              <button
                onClick={() => setShowTradeLedger(true)}
                className="w-full bg-sky-600 hover:bg-sky-700 text-white font-semibold py-3 px-4 rounded-md shadow-md transition transform hover:scale-105 focus:outline-none focus:ring-2 focus:ring-sky-500 focus:ring-opacity-50"
              >
                View Detailed Trade History
              </button>
            </div>
          </div>
        </main>
        <footer className="text-center p-4 text-sm text-gray-600 border-t border-gray-700 mt-auto">
          SimuTrader Binance Bot. For Testnet use only.
          <p className="text-xs text-gray-700 mt-1">This is a simulation and not financial advice. Use at your own risk.</p>
        </footer>
      </div>
      {showTradeLedger && (
        <TradeLedgerView tradeLedger={tradeLedger} onClose={() => setShowTradeLedger(false)} />
      )}
    </>
  );
};

export default App;
