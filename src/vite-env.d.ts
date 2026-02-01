/// <reference types="vite/client" />

interface ImportMetaEnv {
    // Add other custom frontend environment variables here if needed
    // Example: readonly VITE_APP_TITLE: string;
    readonly VITE_APP_TITLE?: string;
  }
  
  interface ImportMeta {
    readonly env: ImportMetaEnv;
  }
  