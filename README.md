# SimuTrader Binance Bot (Testnet)

This contains everything you need to run your app locally. The application consists of a React frontend (Vite) and a Node.js/Express backend.

## Run Locally

**Prerequisites:** Node.js (v18 or higher recommended)

1.  **Install Dependencies:**
    Open your terminal in the project root and run:
    ```bash
    npm install
    ```

2.  **Configure Backend API Keys:**
    *   Navigate to the `server` directory.
    *   Create a new file named `.env` (i.e., `server/.env`).
    *   Add your Binance Testnet API keys to this `server/.env` file:
        ```env
        BINANCE_API_KEY=your_binance_testnet_api_key
        BINANCE_API_SECRET=your_binance_testnet_api_secret
        PORT=3001
        ```
    *   Replace `your_binance_testnet_api_key` and `your_binance_testnet_api_secret` with your actual keys from the Binance Testnet.
    *   `PORT=3001` is the default port for the backend server. The frontend will proxy requests to this port.

3.  **Run the Full Application (Frontend & Backend):**
    Go back to the project root directory in your terminal and run:
    ```bash
    npm run dev:full
    ```
    This command will:
    *   Start the Vite development server for the frontend (usually on http://localhost:5173).
    *   Start the Node.js/Express backend server (usually on http://localhost:3001).
    *   Open your browser to the frontend application.

4.  **Alternative: Running Separately**
    *   To run only the frontend: `npm run dev`
    *   To run only the backend: `npm run server`

## Building for Production (Optional)

1.  **Build the frontend:**
    ```bash
    npm run build:client
    ```
    This creates a `dist` folder with static assets.

2.  **Build the backend:**
    ```bash
    npm run build:server
    ```
    This compiles the TypeScript server code into `dist/server`.

3.  **Run the production backend:**
    ```bash
    npm run start:server
    ```
    You would then typically serve the frontend's `dist` folder using a static file server or configure the backend to serve it.
