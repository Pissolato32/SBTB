import * as dotenv from 'dotenv';
import path from 'path';

// Only load .env in non-production environments or if explicitly requested
if (process.env.NODE_ENV !== 'production') {
    dotenv.config({ path: path.resolve(process.cwd(), 'server/.env') });
}

export interface AppConfig {
    port: number;
    exchangeId: string;
    apiKey: string;
    apiSecret: string;
    isTestnet: boolean;
    nodeEnv: string;
}

export class ConfigService {
    private static instance: ConfigService;
    private config: AppConfig;

    private constructor() {
        this.config = this.loadConfig();
    }

    public static getInstance(): ConfigService {
        if (!ConfigService.instance) {
            ConfigService.instance = new ConfigService();
        }
        return ConfigService.instance;
    }

    private loadConfig(): AppConfig {
        const nodeEnv = process.env.NODE_ENV || 'development';
        const exchangeId = process.env.EXCHANGE || 'binance';
        const port = parseInt(process.env.PORT || '3001', 10);

        // Prioritize specific binance keys, fallback to generic
        const apiKey = process.env.BINANCE_API_KEY || process.env.API_KEY || '';
        const apiSecret = process.env.BINANCE_API_SECRET || process.env.SECRET_KEY || '';

        // Testnet detection
        const isTestnet = process.env.IS_TESTNET === 'true' || !!process.env.BINANCE_TESTNET_API_KEY;

        // If explicitly using separate testnet keys (legacy support), override
        let finalApiKey = apiKey;
        let finalApiSecret = apiSecret;

        if (isTestnet && process.env.BINANCE_TESTNET_API_KEY && process.env.BINANCE_TESTNET_SECRET_KEY) {
             finalApiKey = process.env.BINANCE_TESTNET_API_KEY;
             finalApiSecret = process.env.BINANCE_TESTNET_SECRET_KEY;
        }

        // Validation only warns here, doesn't throw yet to allow 'partial' start for status checks
        if (!finalApiKey || !finalApiSecret) {
            console.warn('[ConfigService] WARNING: API Key or Secret is missing. Trading will not function.');
        }

        return {
            port,
            exchangeId,
            apiKey: finalApiKey,
            apiSecret: finalApiSecret,
            isTestnet,
            nodeEnv
        };
    }

    public getConfig(): AppConfig {
        return this.config;
    }

    // Utility to mask secrets for logging
    public getSafeConfig(): Partial<AppConfig> {
        return {
            port: this.config.port,
            exchangeId: this.config.exchangeId,
            isTestnet: this.config.isTestnet,
            nodeEnv: this.config.nodeEnv,
            apiKey: this.config.apiKey ? `${this.config.apiKey.substring(0, 4)}***` : 'NOT_SET'
        };
    }
}
