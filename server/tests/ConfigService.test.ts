import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ConfigService } from '../services/ConfigService.js';

describe('ConfigService', () => {
    beforeEach(() => {
        vi.resetModules();
        (ConfigService as any).instance = undefined; // Reset singleton
    });

    afterEach(() => {
        vi.unstubAllEnvs();
    });

    it('should load default config', () => {
        // Ensure testnet is off by default for this test if needed, or check logic
        // But defaults depend on env.
        const config = ConfigService.getInstance().getConfig();
        expect(config.port).toBeDefined();
        expect(config.exchangeId).toBe('binance');
    });

    it('should load specific env vars', () => {
        vi.stubEnv('PORT', '4000');
        vi.stubEnv('EXCHANGE', 'kraken');
        vi.stubEnv('BINANCE_API_KEY', 'test-key');
        // IMPORTANT: Unset testnet triggers to avoid override logic
        vi.stubEnv('IS_TESTNET', 'false');
        vi.stubEnv('BINANCE_TESTNET_API_KEY', '');

        const config = ConfigService.getInstance().getConfig();
        expect(config.port).toBe(4000);
        expect(config.exchangeId).toBe('kraken');
        expect(config.apiKey).toBe('test-key');
    });

    it('should mask secrets in safe config', () => {
        vi.stubEnv('BINANCE_API_KEY', '1234567890');
        vi.stubEnv('IS_TESTNET', 'false');
        vi.stubEnv('BINANCE_TESTNET_API_KEY', '');

        const service = ConfigService.getInstance();
        const safe = service.getSafeConfig();

        expect(safe.apiKey).toBe('1234***');
        expect(safe.apiKey).not.toBe('1234567890');
    });
});
