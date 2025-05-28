
import React from 'react';
import { APP_NAME } from '../src/constants';

const Header: React.FC = () => {
  return (
    <header className="bg-gray-800 shadow-md p-4">
      <div className="container mx-auto flex items-center justify-between">
        <h1 className="text-2xl font-bold text-sky-400">{APP_NAME}</h1>
        <div className="text-sm text-gray-400">
          Mock Trading Simulation
        </div>
      </div>
    </header>
  );
};

export default Header;
    