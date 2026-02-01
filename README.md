# SimuTrader Binance Bot (Testnet)

A robust, full-stack cryptocurrency trading bot built with React, Node.js (Express), and SQLite. Designed for Binance Testnet (default) but compatible with other exchanges via CCXT.

## Architecture

*   **Frontend**: React 19 + Vite + TailwindCSS. Provides a real-time dashboard for monitoring market data, bot status, portfolio, and trade history.
*   **Backend**: Node.js + Express. Handles API requests and runs the trading engine.
*   **Trading Engine**: `BotEngine` class managing market scanning (RSI/SMA strategies), trade execution, and risk management (Stop-loss, Take-profit).
*   **Persistence**: SQLite (`better-sqlite3`) with WAL mode. Stores active trades, trade history (ledger), and bot settings locally in `data/bot.db`.
*   **Concurrency**: `async-mutex` ensures safe state transitions and prevents race conditions during trade execution.
*   **Communication**: WebSocket for real-time updates (market data, logs, portfolio) from backend to frontend.

## Prerequisites

*   Node.js (v18 or higher recommended)
*   npm

## Installation

1.  **Clone the repository:**
    ```bash
    git clone <repository-url>
    cd <repository-directory>
    ```

2.  **Install Dependencies:**
    ```bash
    npm install
    ```

## Configuration

1.  Navigate to the `server` directory and create a `.env` file:
    ```bash
    cp server/.env.example server/.env
    ```

2.  Edit `server/.env` with your API keys:
    ```env
    PORT=3001
    EXCHANGE=binance
    IS_TESTNET=true  # Set to false for real trading (USE AT YOUR OWN RISK)

    # Binance Testnet Keys
    BINANCE_TESTNET_API_KEY=your_testnet_api_key
    BINANCE_TESTNET_SECRET_KEY=your_testnet_secret_key

    # Or Real Keys
    # BINANCE_API_KEY=your_real_api_key
    # BINANCE_API_SECRET=your_real_secret_key
    ```

## Running the Application

### Development Mode

Run both frontend and backend concurrently:

```bash
npm run dev:full
```

*   Frontend: http://localhost:5173
*   Backend: http://localhost:3001

### Running Separately

*   **Frontend**: `npm run dev`
*   **Backend**: `npm run server` (uses `tsx` for direct TypeScript execution)

## Testing & Quality

*   **Run Unit Tests**:
    ```bash
    npm test
    ```
    Uses `vitest` to run tests for `BotEngine`, `SqlitePersistenceService`, and `ConfigService`.

*   **Linting**:
    ```bash
    npm run lint
    ```
    Uses ESLint with TypeScript and React support.

*   **Formatting**:
    ```bash
    npm run format
    ```
    Uses Prettier.

## Building for Production

1.  **Build Frontend**:
    ```bash
    npm run build:client
    ```
    Outputs to `dist/`.

2.  **Build Backend**:
    ```bash
    npm run build:server
    ```
    Outputs to `dist/server/`.

3.  **Run Production Server**:
    ```bash
    npm run start:server
    ```

## Strategies

The bot currently implements a basic strategy based on:
*   **RSI (Relative Strength Index)**: Buys when RSI is below a threshold (default 30).
*   **SMA (Simple Moving Average)**: Checks trend alignment (Short SMA > Long SMA).
*   **Risk Management**: Configurable Stop Loss, Take Profit, and Trailing Stop.

## Disclaimer

This software is for educational and testing purposes only. Using it on real markets involves financial risk. The authors are not responsible for any financial losses.
