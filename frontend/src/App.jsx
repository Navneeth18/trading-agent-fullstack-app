import React from 'react';
import { BrowserRouter as Router, Routes, Route, Link, useLocation } from 'react-router-dom';
import { LayoutDashboard, LineChart, Newspaper, MessageSquare, BookOpen, Wallet, TrendingUp, ShoppingCart } from 'lucide-react';
import Dashboard from './pages/Dashboard';
import Stocks from './pages/Stocks';
import News from './pages/News';
import Chat from './pages/Chat';
import PortfolioWallet from './pages/PortfolioWallet';
import KnowledgeBase from './pages/KnowledgeBase';
import Transactions from './pages/Transactions';
import ManualTrade from './pages/ManualTrade';

const Sidebar = () => {
  const location = useLocation();
  const path = location.pathname;

  return (
    <div className="sidebar">
      <h2 className="gradient-text" style={{ paddingBottom: '1rem', borderBottom: '1px solid rgba(255,255,255,0.1)', marginBottom: '1rem' }}>
        AI Portfolio
      </h2>
      <Link to="/" className={path === '/' ? 'active' : ''}>
        <LayoutDashboard size={20} /> Dashboard
      </Link>
      <Link to="/stocks" className={path === '/stocks' ? 'active' : ''}>
        <LineChart size={20} /> Stocks & Charts
      </Link>
      <Link to="/news" className={path === '/news' ? 'active' : ''}>
        <Newspaper size={20} /> Market News
      </Link>
      <Link to="/chat" className={path === '/chat' ? 'active' : ''}>
        <MessageSquare size={20} /> AI Chatbot
      </Link>
      <Link to="/wallet" className={path === '/wallet' ? 'active' : ''}>
        <Wallet size={20} /> Wallet & Assets
      </Link>
      <Link to="/transactions" className={path === '/transactions' ? 'active' : ''}>
        <TrendingUp size={20} /> Execution Ledger
      </Link>
      <Link to="/trade" className={path === '/trade' ? 'active' : ''}>
        <ShoppingCart size={20} /> Manual Trading
      </Link>
      <Link to="/knowledge" className={path === '/knowledge' ? 'active' : ''}>
        <BookOpen size={20} /> Knowledge Base
      </Link>
    </div>
  );
};

const App = () => {
  return (
    <Router>
      <div className="app-container">
        <Sidebar />
        <div className="main-content">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/stocks" element={<Stocks />} />
            <Route path="/news" element={<News />} />
            <Route path="/chat" element={<Chat />} />
            <Route path="/wallet" element={<PortfolioWallet />} />
            <Route path="/knowledge" element={<KnowledgeBase />} />
            <Route path="/transactions" element={<Transactions />} />
            <Route path="/trade" element={<ManualTrade />} />
          </Routes>
        </div>
      </div>
    </Router>
  );
};

export default App;
