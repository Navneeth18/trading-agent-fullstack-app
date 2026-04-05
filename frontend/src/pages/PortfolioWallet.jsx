import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import { Wallet as WalletIcon, ArrowDownCircle, ArrowUpCircle, TrendingUp, TrendingDown, RefreshCw } from 'lucide-react';

const PortfolioWallet = () => {
  const [balance, setBalance] = useState(0);
  const [assets, setAssets] = useState([]);       // holdings with qty/avg_price
  const [tracked, setTracked] = useState([]);     // all tracked symbols
  const [amount, setAmount] = useState('');
  const [investLoading, setInvestLoading] = useState(false);
  const [withdrawLoading, setWithdrawLoading] = useState(false);
  const [actionMsg, setActionMsg] = useState(null); // {type: 'success'|'error', text: string}
  const [livePrices, setLivePrices] = useState({});
  const [pricesLoading, setPricesLoading] = useState(false);
  const [lastUpdated, setLastUpdated] = useState(null);
  const refreshInterval = useRef(null);

  const fetchWallet = async () => {
    try {
      const res = await axios.get("http://localhost:8000/api/portfolio/wallet");
      setBalance(res.data.balance);
    } catch { }
  };

  const fetchAssets = async () => {
    try {
      const res = await axios.get("http://localhost:8000/api/portfolio/assets");
      return res.data;
    } catch { return []; }
  };

  const fetchTracked = async () => {
    try {
      const res = await axios.get("http://localhost:8000/api/portfolio/tracked-stocks");
      return res.data;
    } catch { return []; }
  };

  // Fetch live prices for ALL tracked symbols at once
  const fetchLivePrices = async (symbolList) => {
    if (!symbolList || symbolList.length === 0) return;
    setPricesLoading(true);
    try {
      const symbols = symbolList.join(',');
      const res = await axios.get(`http://localhost:8000/api/portfolio/live-prices?symbols=${symbols}`);
      setLivePrices(res.data);
      setLastUpdated(new Date());
    } catch { }
    setPricesLoading(false);
  };

  useEffect(() => {
    const init = async () => {
      fetchWallet();
      const [loadedAssets, loadedTracked] = await Promise.all([fetchAssets(), fetchTracked()]);
      setAssets(loadedAssets);
      setTracked(loadedTracked);
      const symbols = loadedTracked.map(t => t.symbol);
      await fetchLivePrices(symbols);
    };
    init();
    refreshInterval.current = setInterval(async () => {
      const t = await fetchTracked();
      fetchLivePrices(t.map(x => x.symbol));
    }, 60000);
    return () => clearInterval(refreshInterval.current);
  }, []);

  // Build merged rows: every tracked stock, enriched with holding data if available
  const assetMap = Object.fromEntries(assets.map(a => [a.symbol, a]));

  const rows = tracked.map(t => {
    const sym = t.symbol;
    const holding = assetMap[sym];
    const lp = livePrices[sym];
    const qty = holding?.quantity ?? 0;
    const avgPrice = holding?.average_price ?? 0;
    const currentPrice = lp?.current_price ?? null;
    const marketValue = qty > 0 && currentPrice ? qty * currentPrice : null;
    const costBasis = qty > 0 ? qty * avgPrice : 0;
    const pnl = marketValue !== null ? marketValue - costBasis : null;
    const pnlPct = costBasis > 0 && pnl !== null ? (pnl / costBasis) * 100 : null;
    const dayChange = lp && lp.prev_close > 0
      ? ((lp.current_price - lp.prev_close) / lp.prev_close) * 100
      : null;
    return { sym, qty, avgPrice, currentPrice, lp, marketValue, pnl, pnlPct, dayChange, isActive: t.is_active };
  });

  // Summary stats — only held positions
  const heldRows = rows.filter(r => r.qty > 0);
  const totalInvested = heldRows.reduce((s, r) => s + r.qty * r.avgPrice, 0);
  const totalCurrentValue = heldRows.reduce((s, r) => s + (r.marketValue ?? r.qty * r.avgPrice), 0);
  const totalPnL = totalCurrentValue - totalInvested;
  const totalPnLPct = totalInvested > 0 ? (totalPnL / totalInvested) * 100 : 0;

  const handleTransaction = async (type) => {
    const val = parseFloat(amount);
    if (!isNaN(val) && val > 0) {
      if (type === 'deposit') {
        await axios.post(`http://localhost:8000/api/portfolio/wallet/deposit?amount=${val}`);
        fetchWallet();
        const [a, t] = await Promise.all([fetchAssets(), fetchTracked()]);
        setAssets(a); setTracked(t);
        fetchLivePrices(t.map(x => x.symbol));
      }
      if (type === 'withdraw') {
        if (val > balance) {
          setActionMsg({ type: 'error', text: `Insufficient balance. Available: $${balance.toFixed(2)}` });
          return;
        }
        await axios.post(`http://localhost:8000/api/portfolio/wallet/deposit?amount=-${val}`);
        fetchWallet();
        const [a, t] = await Promise.all([fetchAssets(), fetchTracked()]);
        setAssets(a); setTracked(t);
        fetchLivePrices(t.map(x => x.symbol));
      }
      setAmount('');
    }
  };

  return (
    <div>
      <h1 style={{ marginBottom: '2rem' }}>Portfolio Wallet</h1>

      {/* Summary cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '1rem', marginBottom: '1.5rem' }}>
        <div className="glass-card" style={{ textAlign: 'center', padding: '1.5rem 1rem' }}>
          <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '0.4rem' }}>Cash Balance</div>
          <div style={{ fontSize: '1.6rem', fontWeight: 'bold' }}>${balance.toLocaleString('en-US', { minimumFractionDigits: 2 })}</div>
        </div>
        <div className="glass-card" style={{ textAlign: 'center', padding: '1.5rem 1rem' }}>
          <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '0.4rem' }}>Invested Value</div>
          <div style={{ fontSize: '1.6rem', fontWeight: 'bold' }}>${totalInvested.toLocaleString('en-US', { minimumFractionDigits: 2 })}</div>
        </div>
        <div className="glass-card" style={{ textAlign: 'center', padding: '1.5rem 1rem' }}>
          <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '0.4rem' }}>Current Value</div>
          <div style={{ fontSize: '1.6rem', fontWeight: 'bold' }}>${totalCurrentValue.toLocaleString('en-US', { minimumFractionDigits: 2 })}</div>
        </div>
        <div className="glass-card" style={{ textAlign: 'center', padding: '1.5rem 1rem' }}>
          <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '0.4rem' }}>Unrealized P&L</div>
          <div style={{ fontSize: '1.6rem', fontWeight: 'bold', color: totalPnL >= 0 ? 'var(--accent-green)' : 'var(--accent-red)' }}>
            {totalPnL >= 0 ? '+' : ''}${totalPnL.toLocaleString('en-US', { minimumFractionDigits: 2 })}
            <span style={{ fontSize: '0.85rem', marginLeft: '6px' }}>({totalPnLPct >= 0 ? '+' : ''}{totalPnLPct.toFixed(2)}%)</span>
          </div>
        </div>
      </div>

      {/* actionMsg — shown below summary cards */}
      {actionMsg && (
        <div style={{
          marginBottom: '1.5rem', padding: '1rem 1.5rem', borderRadius: '10px',
          background: actionMsg.type === 'success' ? 'rgba(16,185,129,0.12)' : 'rgba(239,68,68,0.12)',
          border: `1px solid ${actionMsg.type === 'success' ? 'var(--accent-green)' : 'var(--accent-red)'}`,
          color: actionMsg.type === 'success' ? 'var(--accent-green)' : 'var(--accent-red)',
          fontSize: '0.9rem'
        }}>
          {actionMsg.text}
          <button onClick={() => setActionMsg(null)} style={{ float: 'right', background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', fontSize: '1rem' }}>✕</button>
        </div>
      )}

      {/* Balance + Simulate */}
      <div className="dashboard-grid">
        <div className="glass-card" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '3rem 1rem' }}>
          <WalletIcon size={48} color="var(--accent-blue)" style={{ marginBottom: '1rem' }} />
          <div style={{ fontSize: '1.2rem', color: 'var(--text-secondary)' }}>Current Balance</div>
          <div style={{ fontSize: '3rem', fontWeight: 'bold', fontFamily: 'var(--font-display)', marginTop: '0.5rem' }}>
            ${balance.toLocaleString('en-US', { minimumFractionDigits: 2 })}
          </div>
        </div>
        <div className="glass-card">
          <h3 style={{ marginBottom: '1.5rem' }}>Simulate Transactions</h3>
          <p style={{ color: 'var(--text-secondary)', marginBottom: '1.5rem', fontSize: '0.95rem' }}>
            Deposit or withdraw money to see how the Deepseek reasoning engine handles sudden liquidity changes. If drawing down forces liquidation, AI will decide what positions to trim.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <input
              type="number" placeholder="Amount ($)" value={amount}
              onChange={(e) => setAmount(e.target.value)}
              style={{ background: 'rgba(0,0,0,0.3)', border: '1px solid var(--border-glass)', color: 'white', padding: '1rem', borderRadius: '8px', fontSize: '1.1rem' }}
            />
            <div style={{ display: 'flex', gap: '1rem' }}>
              <button className="btn btn-primary" style={{ flex: 1, display: 'flex', justifyContent: 'center', gap: '0.5rem', background: 'var(--accent-green)' }} onClick={() => handleTransaction('deposit')}>
                <ArrowUpCircle /> Deposit
              </button>
              <button className="btn btn-primary" style={{ flex: 1, display: 'flex', justifyContent: 'center', gap: '0.5rem', background: 'var(--accent-red)' }} onClick={() => handleTransaction('withdraw')}>
                <ArrowDownCircle /> Withdraw
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Asset Holdings — ALL tracked stocks */}
      <h2 style={{ marginTop: '3rem', marginBottom: '1.5rem', display: 'flex', alignItems: 'center', gap: '1rem' }}>
        Asset Holdings
        <button
          onClick={() => fetchLivePrices(tracked.map(t => t.symbol))}
          style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid var(--border-glass)', color: 'var(--text-secondary)', borderRadius: '8px', padding: '4px 12px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.8rem' }}
        >
          <RefreshCw size={13} style={{ animation: pricesLoading ? 'spin 1s linear infinite' : 'none' }} />
          {lastUpdated ? `Updated ${lastUpdated.toLocaleTimeString()}` : 'Refresh Prices'}
        </button>
      </h2>

      <div className="glass-card" style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', textAlign: 'left', borderCollapse: 'collapse', minWidth: '820px' }}>
          <thead>
            <tr style={{ color: 'var(--text-secondary)', borderBottom: '1px solid var(--border-glass)', fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              <th style={{ padding: '1rem' }}>Symbol</th>
              <th style={{ padding: '1rem' }}>Shares</th>
              <th style={{ padding: '1rem' }}>Avg Buy Price</th>
              <th style={{ padding: '1rem' }}>Current Price</th>
              <th style={{ padding: '1rem' }}>Day Range</th>
              <th style={{ padding: '1rem' }}>Market Value</th>
              <th style={{ padding: '1rem' }}>Unrealized P&L</th>
              <th style={{ padding: '1rem' }}>P&L %</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan="8" align="center" style={{ padding: '2rem', color: 'var(--text-secondary)' }}>Loading tracked stocks…</td></tr>
            ) : rows.map(({ sym, qty, avgPrice, currentPrice, lp, marketValue, pnl, pnlPct, dayChange }) => {
              const hasPosition = qty > 0;
              const isProfit = pnl !== null ? pnl >= 0 : true;
              const pnlColor = pnl !== null ? (isProfit ? 'var(--accent-green)' : 'var(--accent-red)') : 'var(--text-secondary)';

              return (
                <tr key={sym}
                  style={{ borderBottom: '1px solid rgba(255,255,255,0.05)', opacity: hasPosition ? 1 : 0.55, transition: 'background 0.2s' }}
                  onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.03)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                >
                  {/* Symbol */}
                  <td style={{ padding: '1rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{ fontWeight: 700, fontSize: '1rem' }}>{sym}</span>
                      {hasPosition && (
                        <span style={{ fontSize: '0.7rem', background: 'rgba(59,130,246,0.15)', color: 'var(--accent-blue)', padding: '2px 7px', borderRadius: '10px' }}>HELD</span>
                      )}
                    </div>
                  </td>

                  {/* Shares */}
                  <td style={{ padding: '1rem', color: hasPosition ? 'white' : 'var(--text-secondary)' }}>
                    {hasPosition ? qty.toFixed(4) : '—'}
                  </td>

                  {/* Avg Buy Price */}
                  <td style={{ padding: '1rem', color: 'var(--text-secondary)' }}>
                    {hasPosition ? `$${avgPrice.toFixed(2)}` : '—'}
                  </td>

                  {/* Current Price */}
                  <td style={{ padding: '1rem' }}>
                    {currentPrice !== null ? (
                      <div>
                        <span style={{ fontWeight: 600 }}>${currentPrice.toFixed(2)}</span>
                        {dayChange !== null && (
                          <span style={{ fontSize: '0.75rem', marginLeft: '6px', color: dayChange >= 0 ? 'var(--accent-green)' : 'var(--accent-red)' }}>
                            {dayChange >= 0 ? '▲' : '▼'} {Math.abs(dayChange).toFixed(2)}%
                          </span>
                        )}
                      </div>
                    ) : (
                      <span style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>—</span>
                    )}
                  </td>

                  {/* Day Range */}
                  <td style={{ padding: '1rem', fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
                    {lp ? `$${lp.day_low.toFixed(2)} – $${lp.day_high.toFixed(2)}` : '—'}
                  </td>

                  {/* Market Value */}
                  <td style={{ padding: '1rem', fontWeight: hasPosition ? 600 : 400, color: hasPosition ? 'white' : 'var(--text-secondary)' }}>
                    {marketValue !== null ? `$${marketValue.toLocaleString('en-US', { minimumFractionDigits: 2 })}` : '—'}
                  </td>

                  {/* Unrealized P&L */}
                  <td style={{ padding: '1rem', color: pnlColor, fontWeight: hasPosition ? 600 : 400 }}>
                    {pnl !== null ? (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                        {isProfit ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
                        {isProfit ? '+' : ''}${pnl.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                      </div>
                    ) : '—'}
                  </td>

                  {/* P&L % */}
                  <td style={{ padding: '1rem' }}>
                    {pnlPct !== null ? (
                      <span style={{
                        background: isProfit ? 'rgba(0,255,100,0.12)' : 'rgba(255,80,80,0.12)',
                        color: pnlColor, padding: '3px 10px', borderRadius: '20px', fontSize: '0.85rem', fontWeight: 600
                      }}>
                        {isProfit ? '+' : ''}{pnlPct.toFixed(2)}%
                      </span>
                    ) : '—'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Tactical AI Deployment */}
      <h2 style={{ marginTop: '3rem', marginBottom: '1.5rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
        Tactical AI Deployment
      </h2>

      <div className="glass-card" style={{ marginBottom: '3rem', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2rem' }}>
        <div style={{ background: 'rgba(0,255,100,0.02)', padding: '1.5rem', borderRadius: '12px', border: '1px solid rgba(0,255,100,0.1)' }}>
          <h3 style={{ marginTop: 0, color: 'var(--accent-green)' }}>Strategic Auto-Invest</h3>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginBottom: '1.5rem' }}>
            Force the Deepseek Engine to instantly allocate the requested capital exclusively to undervalued tracked stocks.
          </p>
          <div style={{ display: 'flex', gap: '1rem' }}>
            <input type="number" placeholder="E.g., 2000" id="investAmt"
              style={{ flex: 1, background: 'var(--bg-secondary)', border: '1px solid var(--border-glass)', color: 'white', padding: '0.8rem', borderRadius: '8px' }} />
            <button className="btn" disabled={investLoading}
              style={{ background: investLoading ? 'rgba(16,185,129,0.4)' : 'var(--accent-green)', color: 'black', fontWeight: 'bold', minWidth: '130px' }}
              onClick={async () => {
                const amt = parseFloat(document.getElementById('investAmt').value);
                if (!amt || amt <= 0) { setActionMsg({ type: 'error', text: 'Enter a valid amount.' }); return; }
                if (amt > balance) { setActionMsg({ type: 'error', text: `Insufficient balance. Available: $${balance.toFixed(2)}` }); return; }
                setInvestLoading(true);
                setActionMsg({ type: 'success', text: '⏳ AI pipeline running… fetching market data, sentiment & DeepSeek reasoning. This takes 1–5 minutes.' });
                try {
                  const startRes = await axios.post(`http://localhost:8000/api/portfolio/strategic-invest?amount=${amt}`);
                  const jobId = startRes.data.job_id;
                  document.getElementById('investAmt').value = '';
                  // Poll every 5s until done
                  const poll = setInterval(async () => {
                    try {
                      const jobRes = await axios.get(`http://localhost:8000/api/portfolio/job/${jobId}`);
                      const job = jobRes.data;
                      if (job.status === 'done') {
                        clearInterval(poll);
                        const [a, t] = await Promise.all([fetchAssets(), fetchTracked()]);
                        setAssets(a); setTracked(t); fetchWallet();
                        fetchLivePrices(t.map(x => x.symbol));
                        setActionMsg({ type: 'success', text: `✓ Invested $${amt.toFixed(2)} across ${job.result?.length ?? 0} position(s). Check Execution Ledger.` });
                        setInvestLoading(false);
                      } else if (job.status === 'error') {
                        clearInterval(poll);
                        setActionMsg({ type: 'error', text: `Invest failed: ${job.message}` });
                        setInvestLoading(false);
                      }
                    } catch { clearInterval(poll); setInvestLoading(false); }
                  }, 5000);
                } catch (e) {
                  const detail = e.response?.data?.detail || e.message;
                  setActionMsg({ type: 'error', text: `Invest failed: ${detail}` });
                  setInvestLoading(false);
                }
              }}>
              {investLoading ? 'Running AI…' : 'Deploy Capital'}
            </button>
          </div>
        </div>

        <div style={{ background: 'rgba(255,80,80,0.02)', padding: '1.5rem', borderRadius: '12px', border: '1px solid rgba(255,80,80,0.1)' }}>
          <h3 style={{ marginTop: 0, color: 'var(--accent-red)' }}>Strategic Auto-Withdraw</h3>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginBottom: '1.5rem' }}>
            Force the AI to optimally liquidate specific open stock positions to explicitly free up the requested cash target.
          </p>
          <div style={{ display: 'flex', gap: '1rem' }}>
            <input type="number" placeholder="E.g., 1000" id="withdrawAmt"
              style={{ flex: 1, background: 'var(--bg-secondary)', border: '1px solid var(--border-glass)', color: 'white', padding: '0.8rem', borderRadius: '8px' }} />
            <button className="btn" disabled={withdrawLoading}
              style={{ background: withdrawLoading ? 'rgba(239,68,68,0.4)' : 'var(--accent-red)', color: 'white', fontWeight: 'bold', minWidth: '140px' }}
              onClick={async () => {
                const amt = parseFloat(document.getElementById('withdrawAmt').value);
                if (!amt || amt <= 0) { setActionMsg({ type: 'error', text: 'Enter a valid amount.' }); return; }
                const heldValue = rows.filter(r => r.qty > 0).reduce((s, r) => s + (r.marketValue ?? 0), 0);
                if (heldValue <= 0) { setActionMsg({ type: 'error', text: 'No open positions to liquidate.' }); return; }
                setWithdrawLoading(true);
                setActionMsg({ type: 'success', text: '⏳ AI pipeline running… analysing positions to liquidate. This takes 1–5 minutes.' });
                try {
                  const startRes = await axios.post(`http://localhost:8000/api/portfolio/strategic-withdraw?amount=${amt}`);
                  const jobId = startRes.data.job_id;
                  document.getElementById('withdrawAmt').value = '';
                  const poll = setInterval(async () => {
                    try {
                      const jobRes = await axios.get(`http://localhost:8000/api/portfolio/job/${jobId}`);
                      const job = jobRes.data;
                      if (job.status === 'done') {
                        clearInterval(poll);
                        const [a, t] = await Promise.all([fetchAssets(), fetchTracked()]);
                        setAssets(a); setTracked(t); fetchWallet();
                        fetchLivePrices(t.map(x => x.symbol));
                        setActionMsg({ type: 'success', text: `✓ Liquidated $${amt.toFixed(2)} across ${job.result?.length ?? 0} position(s). Funds returned to wallet.` });
                        setWithdrawLoading(false);
                      } else if (job.status === 'error') {
                        clearInterval(poll);
                        setActionMsg({ type: 'error', text: `Withdraw failed: ${job.message}` });
                        setWithdrawLoading(false);
                      }
                    } catch { clearInterval(poll); setWithdrawLoading(false); }
                  }, 5000);
                } catch (e) {
                  const detail = e.response?.data?.detail || e.message;
                  setActionMsg({ type: 'error', text: `Withdraw failed: ${detail}` });
                  setWithdrawLoading(false);
                }
              }}>
              {withdrawLoading ? 'Running AI…' : 'Liquidate Assets'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default PortfolioWallet;
