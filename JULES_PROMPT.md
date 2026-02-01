<instruction>
You are an expert software engineer. You are working on a WIP branch: `bot-stability-sqlite-mutex-14410359789549334859`. 
Please run `git status` and `git diff main..HEAD` to understand the current state of the stability migration. Your mission is to reconcile the existing code with the "Parecer Técnico" requirements.
</instruction>

<workspace_context>
- **Project**: SimuTrader Binance Bot (SBTB).
- **Core Goal**: Transform a prototype into a stable, audited trading system.
- **Current Branch**: `bot-stability-sqlite-mutex-...` - This branch introduces `better-sqlite3` and `async-mutex` for thread-safe operations.
- **WIP State**: 
    - `server/services/BotEngine.ts` has been partially migrated but contains duplicate methods and TS-ignore flags that need fixing.
    - `SqlitePersistenceService.ts` is implemented but needs full integration in `server/server.ts`.
    - `ConfigService.ts` is available to replace ad-hoc `process.env` calls.
- **Technical Audit Context**: A recent audit marked this project as "Alpha/Experimental" due to lack of tests, local JSON persistence (now being migrated), and basic documentation.
</workspace_context>

<mission_brief>
Your mission is to stabilize the bot and meet the requirements for a transition from "Alpha" to "Production-Ready" (internal use).

### 1. Stability & Fixes (Priority 1)
- **Refactor `BotEngine.ts`**: Clean up the file. Remove duplicate `updateSettings` methods and reconcile the `SqlitePersistenceService` integration. Ensure the `Mutex` protects all shared state updates (marketData, activeTrades, portfolio).
- **Service Integration**: Update `server/server.ts` to use `ConfigService` for all configurations and ensure the `SqlitePersistenceService` is the sole source of truth for persistence.

### 2. Testing & Quality (Priority 2)
- **Test Coverage**: Reach a minimum of **70% test coverage**. Implement missing unit/integration tests using Vitest/Jest for:
    - `BotEngine` strategy logic (mocking the exchange).
    - `SqlitePersistenceService` edge cases.
    - `ExchangeService` response handling.
- **Code Quality**: Setup `eslint` and `prettier`. Ensure the codebase passes a strict lint check.

### 3. Reliability & DevOps (Priority 3)
- **Error Handling**: Implement robust error catch blocks in the main trading loop. If the exchange API fails, the bot must log it properly and retry without crashing.
- **GitHub Actions**: Create a `.github/workflows/ci.yml` that runs the linter and the test suite on every push.
- **Graceful Shutdown**: Ensure `process.on('SIGTERM')` triggers a hard save and closes the SQLite connection cleanly.

### 4. Documentation & UI
- **README Revamp**: Rewrite `README.md` to include: architecture diagram (mermaid), setup guide, strategy explanation (the current RSI/SMA logic), and security best practices.
- **Analytics Dashboard**: Complete the Profit Analytics component to show realized PnL from the `trade_ledger` table.

Please start by fixing the duplicate logic in `BotEngine.ts` and removing the `@ts-nocheck` flag once types are reconciled.
</mission_brief>