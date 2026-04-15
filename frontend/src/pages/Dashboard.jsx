import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { DollarSign, Activity, BarChart2, TrendingUp, TrendingDown, Minus, RefreshCw, AlertTriangle, Zap } from 'lucide-react';

const API = 'http://localhost:8000/api/portfolio';

const Dashboard = () => {
  const [summary, setSummary] = useState({ balance: 0, active_positions: 0, recent_transactions: [] });
  const [livePrices, setLivePrices] = useState({});
  const [assets, setAssets] = useState([]);
  const [totalPnlData, setTotalPnlData] = useState(null);
  const [pnlLoading, setPnlLoading] = useState(false);
  const [resetConfirm, setResetConfirm] = useState(false);
  const [resetting, setResetting] = useState(false);

  const loadDashboard = async () => {
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

  const fetchTotalPnl = async () => {
    setPnlLoading(true);
    try {
      const res = await axios.get(`${API}/total-pnl`);
      setTotalPnlData(res.data);
    } catch (e) {
      console.error(e);
    }
    setPnlLoading(false);
  };

  useEffect(() => {
    loadDashboard();
    fetchTotalPnl();
  }, []);

  const handleReset = async () => {
    setResetting(true);
    try {
      await axios.post(`${API}/reset`);
      setResetConfirm(false);
      await loadDashboard();
      await fetchTotalPnl();
    } catch (e) {
      console.error(e);
    }
    setResetting(false);
  };

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
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
        <h1 style={{ margin: 0 }}>Portfolio Overview</h1>
        <div style={{ display: 'flex', gap: '0.8rem' }}>
          <button
            onClick={fetchTotalPnl}
            disabled={pnlLoading}
            style={{
              background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border-glass)',
              color: 'var(--text-secondary)', padding: '0.5rem 1rem', borderRadius: '8px',
              cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.85rem',
            }}
          >
            <RefreshCw size={14} style={{ animation: pnlLoading ? 'spin 1s linear infinite' : 'none' }} />
            Refresh P&L
          </button>
          {!resetConfirm ? (
            <button
              onClick={() => setResetConfirm(true)}
              style={{
                background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.3)',
                color: 'var(--accent-red)', padding: '0.5rem 1rem', borderRadius: '8px',
                cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.85rem',
              }}
            >
              <AlertTriangle size={14} /> Reset Portfolio
            </button>
          ) : (
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
              <span style={{ color: 'var(--accent-red)', fontSize: '0.85rem', fontWeight: 600 }}>
                Delete ALL data?
              </span>
              <button
                onClick={handleReset}
                disabled={resetting}
                style={{
                  background: 'var(--accent-red)', border: 'none', color: 'white',
                  padding: '0.5rem 1rem', borderRadius: '8px', cursor: 'pointer',
                  fontWeight: 700, fontSize: '0.85rem',
                }}
              >
                {resetting ? 'Resetting…' : 'Yes, Reset'}
              </button>
              <button
                onClick={() => setResetConfirm(false)}
                style={{
                  background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border-glass)',
                  color: 'var(--text-secondary)', padding: '0.5rem 1rem', borderRadius: '8px',
                  cursor: 'pointer', fontSize: '0.85rem',
                }}
              >
                Cancel
              </button>
            </div>
          )}
        </div>
      </div>

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

      {/* Total P&L Card — Lifetime Performance */}
      {totalPnlData && (
        <div className="glass-card" style={{ marginBottom: '2rem', padding: '2rem' }}>
          <h2 style={{ marginBottom: '1.5rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Zap size={24} color="var(--accent-purple)" /> Lifetime Performance
          </h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '1.2rem' }}>
            {/* Total P&L */}
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.4rem' }}>
                Total P&L
              </div>
              <div style={{
                fontSize: '1.6rem', fontWeight: 'bold',
                color: totalPnlData.total_pnl >= 0 ? 'var(--accent-green)' : 'var(--accent-red)',
              }}>
                {totalPnlData.total_pnl >= 0 ? '+' : ''}${totalPnlData.total_pnl.toLocaleString('en-US', { minimumFractionDigits: 2 })}
              </div>
              <div style={{
                fontSize: '0.85rem', fontWeight: 600,
                color: totalPnlData.total_pnl_pct >= 0 ? 'var(--accent-green)' : 'var(--accent-red)',
              }}>
                {totalPnlData.total_pnl_pct >= 0 ? '+' : ''}{totalPnlData.total_pnl_pct}%
              </div>
            </div>

            {/* Realized */}
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.4rem' }}>
                Realized P&L
              </div>
              <div style={{
                fontSize: '1.3rem', fontWeight: 'bold',
                color: totalPnlData.realized_pnl >= 0 ? 'var(--accent-green)' : 'var(--accent-red)',
              }}>
                {totalPnlData.realized_pnl >= 0 ? '+' : ''}${totalPnlData.realized_pnl.toLocaleString('en-US', { minimumFractionDigits: 2 })}
              </div>
            </div>

            {/* Unrealized */}
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.4rem' }}>
                Unrealized P&L
              </div>
              <div style={{
                fontSize: '1.3rem', fontWeight: 'bold',
                color: totalPnlData.unrealized_pnl >= 0 ? 'var(--accent-green)' : 'var(--accent-red)',
              }}>
                {totalPnlData.unrealized_pnl >= 0 ? '+' : ''}${totalPnlData.unrealized_pnl.toLocaleString('en-US', { minimumFractionDigits: 2 })}
              </div>
            </div>

            {/* Total Trades */}
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.4rem' }}>
                Total Trades
              </div>
              <div style={{ fontSize: '1.3rem', fontWeight: 'bold' }}>
                {totalPnlData.total_trades}
              </div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                {totalPnlData.total_buys} buys / {totalPnlData.total_sells} sells
              </div>
            </div>

            {/* Portfolio Value */}
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.4rem' }}>
                Current Value
              </div>
              <div style={{ fontSize: '1.3rem', fontWeight: 'bold' }}>
                ${totalPnlData.total_current_value.toLocaleString('en-US', { minimumFractionDigits: 2 })}
              </div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                from ${totalPnlData.total_capital_in.toLocaleString('en-US', { minimumFractionDigits: 2 })} invested
              </div>
            </div>
          </div>

          {/* Progress bar visual */}
          <div style={{ marginTop: '1.5rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '0.4rem' }}>
              <span>Initial: ${totalPnlData.total_capital_in.toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
              <span>Current: ${totalPnlData.total_current_value.toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
            </div>
            <div style={{ background: 'rgba(255,255,255,0.05)', borderRadius: '8px', height: '8px', overflow: 'hidden' }}>
              <div style={{
                height: '100%', borderRadius: '8px', transition: 'width 0.5s',
                width: `${Math.min(Math.max((totalPnlData.total_current_value / totalPnlData.total_capital_in) * 50, 5), 100)}%`,
                background: totalPnlData.total_pnl >= 0
                  ? 'linear-gradient(135deg, var(--accent-green), #059669)'
                  : 'linear-gradient(135deg, var(--accent-red), #dc2626)',
              }} />
            </div>
          </div>
        </div>
      )}

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
