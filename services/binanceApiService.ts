import axios from 'axios';
import {
  Coin,
  BinanceAccountInfo,
  BinanceOrderResponse,
  // BinanceError, // May not be needed if backend handles error shaping
  BotSettings, // Importar BotSettings
  PortfolioItem,
  } from '../src/types';

const API_BASE_URL = '/api'; // Vite will proxy this to the backend

// Helper to handle API errors from our backend
const handleApiError = (error: any, context: string) => {
  if (axios.isAxiosError(error)) {
    const errorMessage = error.response?.data?.message || error.response?.data?.msg || error.message;
    console.error(`Error in ${context}:`, errorMessage, error.response?.data);
    throw new Error(`Backend API Error in ${context}: ${errorMessage}`);
  } else {
    console.error(`Non-Axios error in ${context}:`, error);
    throw new Error(`An unexpected error occurred in ${context}: ${error instanceof Error ? error.message : String(error)}`);
  }
};

export const fetchMarketData = async (settings: Pick<BotSettings, 'maxCoinPrice' | 'rsiPeriod' | 'smaShortPeriod' | 'smaLongPeriod'>): Promise<Coin[]> => {
  try {
    const response = await axios.get<{ coins: Coin[] }>(`${API_BASE_URL}/market-data`, {
      params: { 
        maxCoinPrice: settings.maxCoinPrice,
        rsiPeriod: settings.rsiPeriod,
        smaShortPeriod: settings.smaShortPeriod,
        smaLongPeriod: settings.smaLongPeriod,
        // klineInterval: settings.klineInterval, // Se você implementar isso
      },
    });
    return response.data.coins;
  } catch (error) {
    handleApiError(error, 'fetchMarketData');
    return []; // Should be caught by the caller, returning empty array as fallback
  }
};

export const fetchAccountInfo = async (): Promise<BinanceAccountInfo> => {
  try {
    const response = await axios.get<BinanceAccountInfo>(`${API_BASE_URL}/account-info`);
    return response.data;
  } catch (error) {
    handleApiError(error, 'fetchAccountInfo');
    // Provide a default/empty structure if needed by the caller, or let it throw
    throw error; // Re-throw to be handled by the caller's catch block
  }
};

// These utility functions can remain in the frontend if they operate on data already fetched.
export const getUSDTBalance = (accountInfo: BinanceAccountInfo): number => {
  const usdt = accountInfo.balances.find(b => b.asset === 'USDT');
  return usdt ? parseFloat(usdt.free) : 0;
};

export const getAssetBalancesFromAccountInfo = (accountInfo: BinanceAccountInfo): PortfolioItem[] => {
  return accountInfo.balances
    .filter(b => b.asset !== 'USDT' && (parseFloat(b.free) > 0 || parseFloat(b.locked) > 0))
    .map(balance => ({
      symbol: `${balance.asset}USDT`,
      baseAsset: balance.asset,
      quoteAsset: 'USDT',
      amount: parseFloat(balance.free),
      lockedAmount: parseFloat(balance.locked),
    }));
};


export const placeMarketOrder = async (
  symbol: string,
  side: 'BUY' | 'SELL',
  quantity?: number,
  quoteOrderQty?: number
): Promise<BinanceOrderResponse> => {
  try {
    const response = await axios.post<BinanceOrderResponse>(`${API_BASE_URL}/order`, {
      symbol,
      side,
      quantity,
      quoteOrderQty,
    });
    return response.data;
  } catch (error) {
    handleApiError(error, 'placeMarketOrder');
    throw error; // Re-throw
  }
};

export const checkApiKeyConfigured = async (): Promise<{ configured: boolean; message?: string }> => {
  try {
    const response = await axios.get<{ configured: boolean; message?: string }>(`${API_BASE_URL}/api-key-status`);
    return response.data;
  } catch (error) {
     // If the backend is down or there's a network error reaching it
     const defaultMessage = "Could not reach the backend server to check API key status.";
     if (axios.isAxiosError(error) && error.response) {
        // If backend responded with an error (e.g. specific message about keys)
        return { configured: false, message: error.response.data.message || defaultMessage };
     }
    handleApiError(error, 'checkApiKeyConfigured');
    return { configured: false, message: defaultMessage };
  }
};
