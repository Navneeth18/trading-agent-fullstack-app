import React, { useState, useEffect } from 'react';
import axios from 'axios';
import {
  ShoppingCart, ArrowDownCircle, RefreshCw, DollarSign,
  TrendingUp, TrendingDown, BarChart2, Layers
} from 'lucide-react';

const API = 'http://localhost:8000/api/portfolio';

const ManualTrade = () => {
  const [tracked, setTracked] = useState([]);
  const [assets, setAssets] = useState([]);
  const [livePrices, setLivePrices] = useState({});
  const [balance, setBalance] = useState(0);

  // Trade form state
  const [selectedSymbol, setSelectedSymbol] = useState('');
  const [action, setAction] = useState('BUY');
  const [amountType, setAmountType] = useState('dollars'); // 'dollars' or 'shares'
  const [amount, setAmount] = useState('');
  const [sliderPct, setSliderPct] = useState(0);
  const [executing, setExecuting] = useState(false);
  const [resultMsg, setResultMsg] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);

  const fetchAll = async () => {
    try {
      const [walletRes, assetsRes, trackedRes] = await Promise.all([
        axios.get(`${API}/wallet`),
        axios.get(`${API}/assets`),
        axios.get(`${API}/tracked-stocks`),
      ]);
      setBalance(walletRes.data.balance);
      setAssets(assetsRes.data);
      const trkd = trackedRes.data.filter(t => t.is_active);
      setTracked(trkd);
      if (!selectedSymbol && trkd.length > 0) {
        setSelectedSymbol(trkd[0].symbol);
      }
      // Fetch live prices
      if (trkd.length > 0) {
        const syms = trkd.map(t => t.symbol).join(',');
        const priceRes = await axios.get(`${API}/live-prices?symbols=${syms}`);
        setLivePrices(priceRes.data);
        setLastUpdated(new Date());
      }
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    fetchAll();
    const interval = setInterval(fetchAll, 30000);
    return () => clearInterval(interval);
  }, []);

  const assetMap = Object.fromEntries(assets.map(a => [a.symbol, a]));
  const currentAsset = assetMap[selectedSymbol];
  const currentPrice = livePrices[selectedSymbol]?.current_price || 0;
  const prevClose = livePrices[selectedSymbol]?.prev_close || 0;
  const dayChange = prevClose > 0 ? ((currentPrice - prevClose) / prevClose) * 100 : 0;
  const heldQty = currentAsset?.quantity || 0;
  const heldValue = heldQty * currentPrice;
  const avgPrice = currentAsset?.average_price || 0;
  const pnl = heldQty > 0 ? (currentPrice - avgPrice) * heldQty : 0;
  const pnlPct = avgPrice > 0 && heldQty > 0 ? ((currentPrice - avgPrice) / avgPrice) * 100 : 0;

  // Calculate max based on action
  const maxDollars = action === 'BUY' ? balance : heldValue;
  const maxShares = action === 'BUY' ? (currentPrice > 0 ? balance / currentPrice : 0) : heldQty;

  // Compute shares/dollars from amount
  const numericAmount = parseFloat(amount) || 0;
  const displayShares = amountType === 'dollars' && currentPrice > 0
    ? (numericAmount / currentPrice)
    : numericAmount;
  const displayDollars = amountType === 'shares'
    ? numericAmount * currentPrice
    : numericAmount;

  const handleSlider = (pct) => {
    setSliderPct(pct);
    const maxVal = amountType === 'dollars' ? maxDollars : maxShares;
    const val = maxVal * (pct / 100);
    setAmount(val > 0 ? val.toFixed(amountType === 'dollars' ? 2 : 4) : '');
  };

  const handleAmountChange = (val) => {
    setAmount(val);
    const num = parseFloat(val) || 0;
    const maxVal = amountType === 'dollars' ? maxDollars : maxShares;
    const pct = maxVal > 0 ? Math.min((num / maxVal) * 100, 100) : 0;
    setSliderPct(pct);
  };

  const executeTrade = async () => {
    if (!selectedSymbol || numericAmount <= 0) {
      setResultMsg({ type: 'error', text: 'Please select a stock and enter a valid amount.' });
      return;
    }
    setExecuting(true);
    setResultMsg(null);
    try {
      const res = await axios.post(
        `${API}/manual-trade?symbol=${selectedSymbol}&action=${action}&amount=${numericAmount}&amount_type=${amountType}`
      );
      const d = res.data;
      setResultMsg({
        type: 'success',
        text: `✓ ${d.action} ${d.quantity} shares of ${d.symbol} at $${d.price.toFixed(2)} (Total: $${d.total.toFixed(2)}). New balance: $${d.wallet_balance.toFixed(2)}`
      });
      setAmount('');
      setSliderPct(0);
      fetchAll();
    } catch (e) {
      const detail = e.response?.data?.detail || e.message;
      setResultMsg({ type: 'error', text: `Trade failed: ${detail}` });
    }
    setExecuting(false);
  };

  const presetPcts = [10, 25, 50, 75, 100];

  return (
    <div>
      <h1 style={{ marginBottom: '0.5rem', display: 'flex', alignItems: 'center', gap: '10px' }}>
        <ShoppingCart size={32} color="var(--accent-blue)" /> Manual Trading
      </h1>
      <p style={{ color: 'var(--text-secondary)', marginBottom: '2rem' }}>
        Execute direct buy and sell orders on tracked stocks with full manual control.
      </p>

      {/* Result notification */}
      {resultMsg && (
        <div style={{
          marginBottom: '1.5rem', padding: '1rem 1.5rem', borderRadius: '12px',
          background: resultMsg.type === 'success' ? 'rgba(16,185,129,0.1)' : 'rgba(239,68,68,0.1)',
          border: `1px solid ${resultMsg.type === 'success' ? 'var(--accent-green)' : 'var(--accent-red)'}`,
          color: resultMsg.type === 'success' ? 'var(--accent-green)' : 'var(--accent-red)',
          fontSize: '0.9rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center'
        }}>
          <span>{resultMsg.text}</span>
          <button onClick={() => setResultMsg(null)} style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', fontSize: '1.1rem' }}>✕</button>
        </div>
      )}

      {/* Top stats row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1rem', marginBottom: '2rem' }}>
        <div className="glass-card" style={{ textAlign: 'center', padding: '1.2rem' }}>
          <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '0.3rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            <DollarSign size={14} style={{ verticalAlign: 'middle' }} /> Available Cash
          </div>
          <div style={{ fontSize: '1.5rem', fontWeight: 'bold' }}>
            ${balance.toLocaleString('en-US', { minimumFractionDigits: 2 })}
          </div>
        </div>
        <div className="glass-card" style={{ textAlign: 'center', padding: '1.2rem' }}>
          <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '0.3rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            <Layers size={14} style={{ verticalAlign: 'middle' }} /> Positions Held
          </div>
          <div style={{ fontSize: '1.5rem', fontWeight: 'bold' }}>
            {assets.filter(a => a.quantity > 0).length}
          </div>
        </div>
        <div className="glass-card" style={{ textAlign: 'center', padding: '1.2rem' }}>
          <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '0.3rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            <BarChart2 size={14} style={{ verticalAlign: 'middle' }} /> Tracked Stocks
          </div>
          <div style={{ fontSize: '1.5rem', fontWeight: 'bold' }}>
            {tracked.length}
          </div>
        </div>
      </div>

      {/* Main trading panel */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem' }}>
        {/* Left: Order Form */}
        <div className="glass-card" style={{ padding: '2rem' }}>
          <h3 style={{ marginBottom: '1.5rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
            Order Form
          </h3>

          {/* Stock Selector */}
          <div style={{ marginBottom: '1.5rem' }}>
            <label style={{ display: 'block', fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '0.4rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Select Stock
            </label>
            <select
              value={selectedSymbol}
              onChange={(e) => { setSelectedSymbol(e.target.value); setAmount(''); setSliderPct(0); }}
              style={{
                width: '100%', padding: '0.8rem 1rem', background: 'rgba(0,0,0,0.4)',
                border: '1px solid var(--border-glass)', color: 'white', borderRadius: '10px',
                fontSize: '1rem', cursor: 'pointer', outline: 'none',
                appearance: 'none', WebkitAppearance: 'none',
                backgroundImage: 'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'12\' height=\'12\' viewBox=\'0 0 12 12\'%3E%3Cpath fill=\'%2394a3b8\' d=\'M6 8L1 3h10z\'/%3E%3C/svg%3E")',
                backgroundRepeat: 'no-repeat', backgroundPosition: 'right 1rem center',
              }}
            >
              {tracked.map(t => {
                const lp = livePrices[t.symbol];
                const price = lp?.current_price ? `$${lp.current_price.toFixed(2)}` : '...';
                return (
                  <option key={t.symbol} value={t.symbol} style={{ background: '#0a0a1a', color: 'white' }}>
                    {t.symbol} — {price}
                  </option>
                );
              })}
            </select>
          </div>

          {/* Action Toggle */}
          <div style={{ marginBottom: '1.5rem' }}>
            <label style={{ display: 'block', fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '0.4rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Action
            </label>
            <div style={{ display: 'flex', borderRadius: '10px', overflow: 'hidden', border: '1px solid var(--border-glass)' }}>
              <button
                onClick={() => { setAction('BUY'); setAmount(''); setSliderPct(0); }}
                style={{
                  flex: 1, padding: '0.8rem', border: 'none', cursor: 'pointer',
                  fontWeight: 700, fontSize: '0.95rem', transition: 'all 0.3s',
                  background: action === 'BUY' ? 'var(--accent-green)' : 'rgba(0,0,0,0.3)',
                  color: action === 'BUY' ? '#000' : 'var(--text-secondary)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
                }}
              >
                <TrendingUp size={18} /> BUY
              </button>
              <button
                onClick={() => { setAction('SELL'); setAmount(''); setSliderPct(0); }}
                style={{
                  flex: 1, padding: '0.8rem', border: 'none', cursor: 'pointer',
                  fontWeight: 700, fontSize: '0.95rem', transition: 'all 0.3s',
                  background: action === 'SELL' ? 'var(--accent-red)' : 'rgba(0,0,0,0.3)',
                  color: action === 'SELL' ? '#fff' : 'var(--text-secondary)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
                }}
              >
                <TrendingDown size={18} /> SELL
              </button>
            </div>
          </div>

          {/* Amount Type Toggle */}
          <div style={{ marginBottom: '1rem' }}>
            <label style={{ display: 'block', fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '0.4rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Amount Type
            </label>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button
                onClick={() => { setAmountType('dollars'); setAmount(''); setSliderPct(0); }}
                style={{
                  flex: 1, padding: '0.5rem', borderRadius: '8px', border: '1px solid var(--border-glass)',
                  cursor: 'pointer', fontWeight: 600, fontSize: '0.85rem', transition: 'all 0.2s',
                  background: amountType === 'dollars' ? 'rgba(59,130,246,0.2)' : 'rgba(0,0,0,0.2)',
                  color: amountType === 'dollars' ? 'var(--accent-blue)' : 'var(--text-secondary)',
                }}
              >
                $ Dollars
              </button>
              <button
                onClick={() => { setAmountType('shares'); setAmount(''); setSliderPct(0); }}
                style={{
                  flex: 1, padding: '0.5rem', borderRadius: '8px', border: '1px solid var(--border-glass)',
                  cursor: 'pointer', fontWeight: 600, fontSize: '0.85rem', transition: 'all 0.2s',
                  background: amountType === 'shares' ? 'rgba(139,92,246,0.2)' : 'rgba(0,0,0,0.2)',
                  color: amountType === 'shares' ? 'var(--accent-purple)' : 'var(--text-secondary)',
                }}
              >
                # Shares
              </button>
            </div>
          </div>

          {/* Amount Input */}
          <div style={{ marginBottom: '1rem' }}>
            <label style={{ display: 'block', fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '0.4rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              {amountType === 'dollars' ? `Amount (max $${maxDollars.toFixed(2)})` : `Shares (max ${maxShares.toFixed(4)})`}
            </label>
            <input
              type="number"
              value={amount}
              onChange={(e) => handleAmountChange(e.target.value)}
              placeholder={amountType === 'dollars' ? '0.00' : '0.0000'}
              style={{
                width: '100%', padding: '0.8rem 1rem', background: 'rgba(0,0,0,0.4)',
                border: '1px solid var(--border-glass)', color: 'white', borderRadius: '10px',
                fontSize: '1.1rem', fontWeight: '600', outline: 'none',
              }}
            />
          </div>

          {/* Slider */}
          <div style={{ marginBottom: '1.2rem' }}>
            <input
              type="range"
              min="0"
              max="100"
              value={sliderPct}
              onChange={(e) => handleSlider(Number(e.target.value))}
              style={{
                width: '100%', height: '6px', borderRadius: '3px',
                appearance: 'none', WebkitAppearance: 'none',
                background: `linear-gradient(to right, ${action === 'BUY' ? 'var(--accent-green)' : 'var(--accent-red)'} ${sliderPct}%, rgba(255,255,255,0.1) ${sliderPct}%)`,
                outline: 'none', cursor: 'pointer',
              }}
            />
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '0.5rem' }}>
              {presetPcts.map(pct => (
                <button
                  key={pct}
                  onClick={() => handleSlider(pct)}
                  style={{
                    padding: '4px 10px', borderRadius: '6px', fontSize: '0.75rem', fontWeight: 600,
                    cursor: 'pointer', border: '1px solid var(--border-glass)', transition: 'all 0.2s',
                    background: Math.abs(sliderPct - pct) < 2 ? (action === 'BUY' ? 'rgba(16,185,129,0.3)' : 'rgba(239,68,68,0.3)') : 'rgba(0,0,0,0.3)',
                    color: Math.abs(sliderPct - pct) < 2 ? 'white' : 'var(--text-secondary)',
                  }}
                >
                  {pct}%
                </button>
              ))}
            </div>
          </div>

          {/* Trade Preview */}
          {numericAmount > 0 && currentPrice > 0 && (
            <div style={{
              padding: '1rem', borderRadius: '10px', marginBottom: '1.2rem',
              background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border-glass)',
            }}>
              <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '0.5rem', textTransform: 'uppercase' }}>
                Order Preview
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem', fontSize: '0.9rem' }}>
                <div>
                  <span style={{ color: 'var(--text-secondary)' }}>Shares:</span>{' '}
                  <span style={{ fontWeight: 600 }}>{displayShares.toFixed(4)}</span>
                </div>
                <div>
                  <span style={{ color: 'var(--text-secondary)' }}>Total Cost:</span>{' '}
                  <span style={{ fontWeight: 600 }}>${displayDollars.toFixed(2)}</span>
                </div>
                <div>
                  <span style={{ color: 'var(--text-secondary)' }}>Price:</span>{' '}
                  <span style={{ fontWeight: 600 }}>${currentPrice.toFixed(2)}</span>
                </div>
                <div>
                  <span style={{ color: 'var(--text-secondary)' }}>Action:</span>{' '}
                  <span style={{ fontWeight: 600, color: action === 'BUY' ? 'var(--accent-green)' : 'var(--accent-red)' }}>{action}</span>
                </div>
              </div>

              {/* P&L Impact for SELL when holding position */}
              {action === 'SELL' && heldQty > 0 && avgPrice > 0 && (
                <div style={{
                  marginTop: '0.8rem', paddingTop: '0.8rem', borderTop: '1px solid var(--border-glass)',
                }}>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', textTransform: 'uppercase', marginBottom: '0.4rem' }}>
                    Realized P&L from this sale
                  </div>
                  {(() => {
                    const sellQty = displayShares;
                    const proceeds = sellQty * currentPrice;
                    const costBasis = sellQty * avgPrice;
                    const realizedPnl = proceeds - costBasis;
                    const realizedPct = costBasis > 0 ? (realizedPnl / costBasis) * 100 : 0;
                    return (
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.4rem', fontSize: '0.85rem' }}>
                        <div>
                          <span style={{ color: 'var(--text-secondary)' }}>Avg Buy:</span>{' '}
                          <span style={{ fontWeight: 600 }}>${avgPrice.toFixed(2)}</span>
                        </div>
                        <div>
                          <span style={{ color: 'var(--text-secondary)' }}>Sell At:</span>{' '}
                          <span style={{ fontWeight: 600 }}>${currentPrice.toFixed(2)}</span>
                        </div>
                        <div>
                          <span style={{ color: 'var(--text-secondary)' }}>Cost Basis:</span>{' '}
                          <span style={{ fontWeight: 600 }}>${costBasis.toFixed(2)}</span>
                        </div>
                        <div>
                          <span style={{ color: 'var(--text-secondary)' }}>Profit/Loss:</span>{' '}
                          <span style={{
                            fontWeight: 700,
                            color: realizedPnl >= 0 ? 'var(--accent-green)' : 'var(--accent-red)',
                          }}>
                            {realizedPnl >= 0 ? '+' : ''}${realizedPnl.toFixed(2)} ({realizedPct >= 0 ? '+' : ''}{realizedPct.toFixed(2)}%)
                          </span>
                        </div>
                      </div>
                    );
                  })()}
                </div>
              )}

              {/* Position info for BUY when already holding */}
              {action === 'BUY' && heldQty > 0 && avgPrice > 0 && (
                <div style={{
                  marginTop: '0.8rem', paddingTop: '0.8rem', borderTop: '1px solid var(--border-glass)',
                }}>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', textTransform: 'uppercase', marginBottom: '0.4rem' }}>
                    Position After Purchase
                  </div>
                  {(() => {
                    const buyQty = displayShares;
                    const buyCost = displayDollars;
                    const newTotalShares = heldQty + buyQty;
                    const newAvgPrice = ((heldQty * avgPrice) + buyCost) / newTotalShares;
                    const currentPnl = (currentPrice - avgPrice) * heldQty;
                    return (
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.4rem', fontSize: '0.85rem' }}>
                        <div>
                          <span style={{ color: 'var(--text-secondary)' }}>New Total Shares:</span>{' '}
                          <span style={{ fontWeight: 600 }}>{newTotalShares.toFixed(4)}</span>
                        </div>
                        <div>
                          <span style={{ color: 'var(--text-secondary)' }}>New Avg Price:</span>{' '}
                          <span style={{ fontWeight: 600 }}>${newAvgPrice.toFixed(2)}</span>
                        </div>
                        <div>
                          <span style={{ color: 'var(--text-secondary)' }}>Current P&L:</span>{' '}
                          <span style={{ fontWeight: 600, color: currentPnl >= 0 ? 'var(--accent-green)' : 'var(--accent-red)' }}>
                            {currentPnl >= 0 ? '+' : ''}${currentPnl.toFixed(2)}
                          </span>
                        </div>
                        <div>
                          <span style={{ color: 'var(--text-secondary)' }}>Old Avg:</span>{' '}
                          <span style={{ fontWeight: 600 }}>${avgPrice.toFixed(2)}</span>
                        </div>
                      </div>
                    );
                  })()}
                </div>
              )}
            </div>
          )}

          {/* Execute Button */}
          <button
            onClick={executeTrade}
            disabled={executing || numericAmount <= 0}
            style={{
              width: '100%', padding: '1rem', border: 'none', borderRadius: '12px',
              fontWeight: 700, fontSize: '1rem', cursor: executing ? 'not-allowed' : 'pointer',
              background: action === 'BUY'
                ? (executing ? 'rgba(16,185,129,0.4)' : 'linear-gradient(135deg, #10b981, #059669)')
                : (executing ? 'rgba(239,68,68,0.4)' : 'linear-gradient(135deg, #ef4444, #dc2626)'),
              color: 'white', transition: 'all 0.3s',
              boxShadow: executing ? 'none' : `0 4px 20px ${action === 'BUY' ? 'rgba(16,185,129,0.3)' : 'rgba(239,68,68,0.3)'}`,
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
            }}
          >
            {executing ? (
              <><RefreshCw size={18} style={{ animation: 'spin 1s linear infinite' }} /> Executing...</>
            ) : (
              <>{action === 'BUY' ? <TrendingUp size={18} /> : <TrendingDown size={18} />} Execute {action} Order</>
            )}
          </button>
        </div>

        {/* Right: Stock Details & Holdings */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          {/* Selected stock card */}
          <div className="glass-card" style={{ padding: '2rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
              <h3 style={{ margin: 0 }}>{selectedSymbol || '—'}</h3>
              <span style={{
                fontSize: '0.7rem', padding: '4px 10px', borderRadius: '20px',
                background: dayChange >= 0 ? 'rgba(16,185,129,0.15)' : 'rgba(239,68,68,0.15)',
                color: dayChange >= 0 ? 'var(--accent-green)' : 'var(--accent-red)',
                fontWeight: 600
              }}>
                {dayChange >= 0 ? '▲' : '▼'} {Math.abs(dayChange).toFixed(2)}%
              </span>
            </div>

            <div style={{ fontSize: '2.5rem', fontWeight: 'bold', fontFamily: 'var(--font-display)', marginBottom: '1rem' }}>
              {currentPrice > 0 ? `$${currentPrice.toFixed(2)}` : '—'}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
              <div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', textTransform: 'uppercase' }}>Day High</div>
                <div style={{ fontWeight: 600 }}>{livePrices[selectedSymbol]?.day_high ? `$${livePrices[selectedSymbol].day_high.toFixed(2)}` : '—'}</div>
              </div>
              <div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', textTransform: 'uppercase' }}>Day Low</div>
                <div style={{ fontWeight: 600 }}>{livePrices[selectedSymbol]?.day_low ? `$${livePrices[selectedSymbol].day_low.toFixed(2)}` : '—'}</div>
              </div>
              <div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', textTransform: 'uppercase' }}>Prev Close</div>
                <div style={{ fontWeight: 600 }}>{prevClose > 0 ? `$${prevClose.toFixed(2)}` : '—'}</div>
              </div>
              <div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', textTransform: 'uppercase' }}>Last Updated</div>
                <div style={{ fontWeight: 600, fontSize: '0.85rem' }}>{lastUpdated ? lastUpdated.toLocaleTimeString() : '—'}</div>
              </div>
            </div>
          </div>

          {/* Holdings card */}
          <div className="glass-card" style={{ padding: '2rem' }}>
            <h3 style={{ marginBottom: '1.2rem' }}>Your Position — {selectedSymbol}</h3>
            {heldQty > 0 ? (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', textTransform: 'uppercase' }}>Shares Held</div>
                  <div style={{ fontSize: '1.3rem', fontWeight: 700 }}>{heldQty.toFixed(4)}</div>
                </div>
                <div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', textTransform: 'uppercase' }}>Market Value</div>
                  <div style={{ fontSize: '1.3rem', fontWeight: 700 }}>${heldValue.toFixed(2)}</div>
                </div>
                <div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', textTransform: 'uppercase' }}>Avg Buy Price</div>
                  <div style={{ fontWeight: 600 }}>${avgPrice.toFixed(2)}</div>
                </div>
                <div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', textTransform: 'uppercase' }}>Unrealized P&L</div>
                  <div style={{ fontWeight: 700, color: pnl >= 0 ? 'var(--accent-green)' : 'var(--accent-red)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                    {pnl >= 0 ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
                    {pnl >= 0 ? '+' : ''}${pnl.toFixed(2)}
                    <span style={{ fontSize: '0.75rem' }}>({pnlPct >= 0 ? '+' : ''}{pnlPct.toFixed(2)}%)</span>
                  </div>
                </div>
              </div>
            ) : (
              <div style={{ color: 'var(--text-secondary)', padding: '1rem 0', textAlign: 'center' }}>
                No position in {selectedSymbol}
              </div>
            )}
          </div>

          {/* Quick Holdings table */}
          <div className="glass-card" style={{ padding: '1.5rem', flex: 1, overflow: 'auto' }}>
            <h4 style={{ marginBottom: '1rem', color: 'var(--text-secondary)', fontSize: '0.85rem', textTransform: 'uppercase' }}>
              All Open Positions
            </h4>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
              {assets.filter(a => a.quantity > 0).length === 0 ? (
                <div style={{ color: 'var(--text-secondary)', textAlign: 'center', padding: '1rem', fontSize: '0.85rem' }}>
                  No open positions
                </div>
              ) : assets.filter(a => a.quantity > 0).map(a => {
                const lp = livePrices[a.symbol];
                const cp = lp?.current_price || a.average_price;
                const mv = a.quantity * cp;
                const pl = (cp - a.average_price) * a.quantity;
                const isSelected = a.symbol === selectedSymbol;
                return (
                  <div
                    key={a.symbol}
                    onClick={() => { setSelectedSymbol(a.symbol); setAmount(''); setSliderPct(0); }}
                    style={{
                      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                      padding: '0.6rem 0.8rem', borderRadius: '8px', cursor: 'pointer',
                      transition: 'all 0.2s',
                      background: isSelected ? 'rgba(59,130,246,0.12)' : 'transparent',
                      border: isSelected ? '1px solid rgba(59,130,246,0.3)' : '1px solid transparent',
                    }}
                  >
                    <div>
                      <div style={{ fontWeight: 700, fontSize: '0.9rem' }}>{a.symbol}</div>
                      <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>{a.quantity.toFixed(2)} shares</div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>${mv.toFixed(2)}</div>
                      <div style={{ fontSize: '0.7rem', color: pl >= 0 ? 'var(--accent-green)' : 'var(--accent-red)', fontWeight: 600 }}>
                        {pl >= 0 ? '+' : ''}${pl.toFixed(2)}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ManualTrade;
