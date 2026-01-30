import fs from 'fs';
import path from 'path';
import { BotSettings } from '../../src/types.js';

export interface BotTradeData {
  purchasePrice: number;
  amount: number;
  timestamp: number;
  highestPriceSinceBuy?: number;
}

interface PersistentData {
  trades: { [symbol: string]: BotTradeData };
  settings?: BotSettings;
}

export class PersistenceService {
  private filePath: string;

  constructor(filename: string = 'bot_data.json') {
    const dataDir = path.resolve(process.cwd(), 'data');
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir);
    }
    this.filePath = path.join(dataDir, filename);
  }

  saveData(trades: Map<string, BotTradeData>, settings?: BotSettings) {
    const tradeObj: { [symbol: string]: BotTradeData } = {};
    trades.forEach((value, key) => {
      tradeObj[key] = value;
    });

    const data: PersistentData = {
      trades: tradeObj,
      settings: settings
    };

    try {
        fs.writeFileSync(this.filePath, JSON.stringify(data, null, 2));
    } catch (error) {
        console.error('Failed to save bot data:', error);
    }
  }

  loadData(): { trades: Map<string, BotTradeData>, settings?: BotSettings } {
    if (!fs.existsSync(this.filePath)) {
      return { trades: new Map() };
    }

    try {
      const fileContent = fs.readFileSync(this.filePath, 'utf-8');
      const data: PersistentData = JSON.parse(fileContent);

      const trades = new Map<string, BotTradeData>();
      if (data.trades) {
        Object.entries(data.trades).forEach(([key, value]) => {
          trades.set(key, value);
        });
      }

      return { trades, settings: data.settings };
    } catch (error) {
      console.error('Error loading persistence data:', error);
      return { trades: new Map() };
    }
  }
}
