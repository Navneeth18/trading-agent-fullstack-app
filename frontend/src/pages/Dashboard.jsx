import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { DollarSign, Activity, BarChart2, TrendingUp, TrendingDown, Minus } from 'lucide-react';

const API = 'http://localhost:8000/api/portfolio';

const Dashboard = () => {
  const [summary, setSummary] = useState({ balance: 0, active_positions: 0, recent_transactions: [] });
  const [livePrices, setLivePrices] = useState({});
  const [assets, setAssets] = useState([]);

  useEffect(() => {
    const load = async () => {
      try {
        const [sumRes, assetRes] = await Promise.all([
          axios.get(`${API}/summary`),
          axios.get(`${API}/assets`),
        ]);
        setSummary(sumRes.data);
        const held = assetRes.data.filter(a => a.quantity > 0);
        setAssets(held);
        if (held.length > 0) {
          const syms = held.map(a => a.symbol).join(',');
          const priceRes = await axios.get(`${API}/live-prices?symbols=${syms}`);
          setLivePrices(priceRes.data);
        }
      } catch (e) {
        console.error(e);
      }
    };
    load();
  }, []);

  const investedValue = assets.reduce((s, a) => s + a.quantity * a.average_price, 0);
  const currentValue  = assets.reduce((s, a) => {
    const p = livePrices[a.symbol]?.current_price;
    return s + a.quantity * (p || a.average_price);
  }, 0);
  const netWorth = summary.balance + currentValue;
  const totalPnL = currentValue - investedValue;
  const totalPnLPct = investedValue > 0 ? (totalPnL / investedValue) * 100 : 0;

  const typeColor = (t) => t === 'BUY' ? 'var(--accent-green)' : t === 'SELL' ? 'var(--accent-red)' : 'var(--text-secondary)';
  const TypeIcon = ({ t }) => t === 'BUY' ? <TrendingUp size={14} /> : t === 'SELL' ? <TrendingDown size={14} /> : <Minus size={14} />;

  return (
    <div>
      <h1 style={{ marginBottom: '2rem' }}>Portfolio Overview</h1>

      {/* Stat cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '1rem', marginBottom: '2rem' }}>
        <div className="glass-card" style={{ textAlign: 'center', padding: '1.5rem 1rem' }}>
          <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '0.4rem' }}>Cash Balance</div>
          <div style={{ fontSize: '1.7rem', fontWeight: 'bold', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}>
            <DollarSign size={22} color="var(--accent-blue)" />
            {summary.balance.toLocaleString('en-US', { minimumFractionDigits: 2 })}
          </div>
        </div>

        <div className="glass-card" style={{ textAlign: 'center', padding: '1.5rem 1rem' }}>
          <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '0.4rem' }}>Portfolio Net Worth</div>
          <div style={{ fontSize: '1.7rem', fontWeight: 'bold', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}>
            <Activity size={22} color="var(--accent-purple)" />
            {netWorth.toLocaleString('en-US', { minimumFractionDigits: 2 })}
          </div>
        </div>

        <div className="glass-card" style={{ textAlign: 'center', padding: '1.5rem 1rem' }}>
          <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '0.4rem' }}>Active Positions</div>
          <div style={{ fontSize: '1.7rem', fontWeight: 'bold', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}>
            <BarChart2 size={22} color="var(--accent-blue)" />
            {summary.active_positions}
          </div>
        </div>

        <div className="glass-card" style={{ textAlign: 'center', padding: '1.5rem 1rem' }}>
          <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '0.4rem' }}>Unrealized P&L</div>
          <div style={{ fontSize: '1.7rem', fontWeight: 'bold', color: totalPnL >= 0 ? 'var(--accent-green)' : 'var(--accent-red)' }}>
            {totalPnL >= 0 ? '+' : ''}${totalPnL.toLocaleString('en-US', { minimumFractionDigits: 2 })}
            <span style={{ fontSize: '0.85rem', marginLeft: '6px' }}>({totalPnLPct >= 0 ? '+' : ''}{totalPnLPct.toFixed(2)}%)</span>
          </div>
        </div>
      </div>

      {/* Recent AI Decisions */}
      <h2 style={{ marginBottom: '1.5rem', marginTop: '1rem' }}>Recent AI Decisions</h2>
      <div className="glass-card">
        {summary.recent_transactions.length === 0 ? (
          <p style={{ color: 'var(--text-secondary)', padding: '0.5rem 0' }}>No executions yet. The background loop runs every 30 minutes.</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
            <thead>
              <tr style={{ color: 'var(--text-secondary)', borderBottom: '1px solid var(--border-glass)', fontSize: '0.8rem', textTransform: 'uppercase' }}>
                <th style={{ padding: '0.75rem 1rem' }}>Time</th>
                <th style={{ padding: '0.75rem 1rem' }}>Symbol</th>
                <th style={{ padding: '0.75rem 1rem' }}>Action</th>
                <th style={{ padding: '0.75rem 1rem' }}>Qty</th>
                <th style={{ padding: '0.75rem 1rem' }}>Price</th>
                <th style={{ padding: '0.75rem 1rem' }}>Reasoning</th>
              </tr>
            </thead>
            <tbody>
              {summary.recent_transactions.map((tx, i) => (
                <tr key={i} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                  <td style={{ padding: '0.75rem 1rem', color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
                    {new Date(tx.timestamp).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                  </td>
                  <td style={{ padding: '0.75rem 1rem', fontWeight: 700 }}>{tx.symbol}</td>
                  <td style={{ padding: '0.75rem 1rem', color: typeColor(tx.type), fontWeight: 600 }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <TypeIcon t={tx.type} />{tx.type}
                    </span>
                  </td>
                  <td style={{ padding: '0.75rem 1rem' }}>{tx.symbol === 'USD' ? '—' : tx.quantity.toFixed(4)}</td>
                  <td style={{ padding: '0.75rem 1rem' }}>${tx.price.toFixed(2)}</td>
                  <td style={{ padding: '0.75rem 1rem', color: 'var(--text-secondary)', fontSize: '0.82rem', maxWidth: '300px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{tx.reasoning}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};

export default Dashboard;
