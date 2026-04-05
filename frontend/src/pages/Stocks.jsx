import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { 
  LineChart, Line, XAxis, YAxis, CartesianGrid, 
  Tooltip, ResponsiveContainer
} from 'recharts';
import { TrendingUp, Clock, Target, Loader } from 'lucide-react';

const API_URL = 'http://localhost:8000/api/portfolio';

const Stocks = () => {
  const [tracked, setTracked] = useState([]);
  const [newStock, setNewStock] = useState('');
  const [trackError, setTrackError] = useState('');
  
  // Per-stock state isolation
  const [activeRanges, setActiveRanges] = useState({}); // { MSFT: '1mo', AAPL: '1y' }
  const [stockHistory, setStockHistory] = useState({});
  const [predictions, setPredictions] = useState({});
  const [predictingState, setPredictingState] = useState({}); // { MSFT: true/false }

  useEffect(() => {
    fetchTrackedStocks();
  }, []);

  const fetchTrackedStocks = async () => {
    try {
      const res = await axios.get(`${API_URL}/tracked-stocks`);
      const symbols = res.data.map(s => s.symbol);
      setTracked(symbols);
      
      const ranges = {};
      symbols.forEach(sym => {
        ranges[sym] = '1mo';
        fetchHistory(sym, '1mo');
      });
      setActiveRanges(ranges);
    } catch (e) {
      console.error(e);
    }
  };

  const fetchHistory = async (symbol, range) => {
    try {
      const res = await axios.get(`${API_URL}/history/${symbol}?range=${range}`);
      setStockHistory(prev => ({...prev, [symbol]: res.data.data}));
    } catch (e) {
      console.error(e);
    }
  };

  const handleManualPrediction = async (symbol) => {
    setPredictingState(prev => ({...prev, [symbol]: true}));
    try {
      const res = await axios.get(`${API_URL}/predict/${symbol}`);
      setPredictions(prev => ({...prev, [symbol]: res.data.predictions}));
    } catch (e) {
      console.error(e);
    } finally {
      setPredictingState(prev => ({...prev, [symbol]: false}));
    }
  };

  const handleRangeChange = (symbol, range) => {
    setActiveRanges(prev => ({...prev, [symbol]: range}));
    fetchHistory(symbol, range);
  };

  const handleAddTrack = async () => {
    const sym = newStock.trim().toUpperCase();
    if (!sym) {
      setTrackError('Please enter a stock symbol.');
      return;
    }
    if (tracked.includes(sym)) {
      setTrackError(`${sym} is already being tracked.`);
      return;
    }
    setTrackError('');
    await axios.post(`${API_URL}/tracked-stocks?symbol=${sym}`);
    setTracked([...tracked, sym]);
    setActiveRanges(prev => ({...prev, [sym]: '1mo'}));
    fetchHistory(sym, '1mo');
    setNewStock('');
  };

  const timeRanges = [
    { label: '1D', value: '1d' },
    { label: '1W', value: '1wk' },
    { label: '1M', value: '1mo' },
    { label: '1Y', value: '1y' },
    { label: '5Y', value: '5y' }
  ];

  return (
    <div>
      <h1 style={{ marginBottom: '2rem' }}>Market Performance & Predictions</h1>
      
      <div style={{ display: 'flex', gap: '1rem', marginBottom: '2rem' }}>
        <input 
          type="text" 
          placeholder="Stock Symbol (e.g. MSFT)" 
          value={newStock} 
          onChange={(e) => { setNewStock(e.target.value); setTrackError(''); }}
          style={{
            background: 'var(--bg-card)', border: '1px solid var(--border-glass)',
            color: 'white', padding: '0.8rem 1rem', borderRadius: '8px'
          }}
        />
        <button className="btn btn-primary" onClick={handleAddTrack}>
          Track Asset
        </button>
      </div>
      {trackError && (
        <div style={{ marginTop: '-1.5rem', marginBottom: '1.5rem', color: 'var(--accent-red)', fontSize: '0.9rem' }}>
          {trackError}
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: '3rem' }}>
        {tracked.map((symbol) => (
          <div key={symbol} className="glass-card">
            
            {/* Header & Controls mapping specifically to THIS stock */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
                <h2 className="gradient-text" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', margin: 0 }}>
                <TrendingUp size={24} /> {symbol}
                </h2>

                <div style={{ display: 'flex', gap: '0.2rem', background: 'var(--bg-card)', padding: '0.3rem', borderRadius: '8px', border: '1px solid var(--border-glass)' }}>
                {timeRanges.map(tr => {
                    const isActive = activeRanges[symbol] === tr.value;
                    return (
                        <button 
                        key={tr.value}
                        onClick={() => handleRangeChange(symbol, tr.value)}
                        style={{
                            background: isActive ? 'var(--gradient-primary)' : 'transparent',
                            color: isActive ? 'white' : 'var(--text-secondary)',
                            border: 'none', padding: '0.4rem 0.8rem', borderRadius: '4px', cursor: 'pointer', fontWeight: 600, fontSize: '0.8rem'
                        }}
                        >
                        {tr.label}
                        </button>
                    )
                })}
                </div>
            </div>
            
            <div style={{ height: '300px', width: '100%', marginBottom: '2rem' }}>
              <ResponsiveContainer>
                <LineChart data={stockHistory[symbol] || []}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
                  <XAxis 
                    dataKey="time" 
                    stroke="var(--text-secondary)" 
                    tick={{fontSize: 12}}
                    minTickGap={30}
                    tickFormatter={(val) => {
                      const d = new Date(val);
                      if (isNaN(d)) return '';
                      const range = activeRanges[symbol];
                      if (range === '1d') return `${d.getHours()}:${d.getMinutes() === 0 ? '00' : d.getMinutes()}`;
                      if (range === '1wk' || range === '1mo') return `${d.getMonth()+1}/${d.getDate()}`;
                      return `${d.getFullYear()}`;
                    }}
                  />
                  <YAxis 
                    stroke="var(--text-secondary)" 
                    domain={['auto', 'auto']} 
                    tickFormatter={(val) => `$${val.toFixed(0)}`}
                    width={60}
                  />
                  <Tooltip 
                    contentStyle={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-glass)' }}
                    itemStyle={{ color: 'var(--text-primary)' }}
                    labelFormatter={(val) => new Date(val).toLocaleString()}
                    formatter={(value) => [`$${value}`, "Price"]}
                  />
                  <Line type="monotone" dataKey="price" stroke="var(--accent-blue)" strokeWidth={3} dot={false} activeDot={{ r: 6 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>

            <div style={{ display: 'flex', gap: '1.5rem', alignItems: 'center' }}>
              <div style={{ flex: 1 }}>
                
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
                    <h4 style={{ color: 'var(--text-secondary)', margin: 0, display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <Target size={16} /> 1-Month Trajectory Prediction (Llama 3.2 Engine)
                    </h4>
                    
                    {!predictions[symbol] && (
                        <button 
                            onClick={() => handleManualPrediction(symbol)}
                            disabled={predictingState[symbol]}
                            style={{
                                background: 'transparent',
                                border: '1px solid var(--accent-purple)',
                                color: 'var(--accent-purple)',
                                padding: '0.4rem 1rem',
                                borderRadius: '4px',
                                cursor: predictingState[symbol] ? 'not-allowed' : 'pointer',
                                display: 'flex', alignItems: 'center', gap: '0.5rem'
                            }}
                        >
                            {predictingState[symbol] ? <Loader size={16} className="lucide-spin"/> : <Target size={16}/>}
                            {predictingState[symbol] ? 'Running Llama Inference...' : 'Generate Prediction'}
                        </button>
                    )}
                </div>

                {predictions[symbol] && (
                    <div style={{ height: '150px' }}>
                    <ResponsiveContainer>
                        <LineChart data={predictions[symbol] || []}>
                        <YAxis stroke="rgba(255,255,255,0.2)" domain={['auto', 'auto']} tickFormatter={(v)=>(`$${v.toFixed(0)}`)} width={60} />
                        <XAxis dataKey="step" stroke="rgba(255,255,255,0.2)" tickFormatter={(v) => `Day ${v}`}/>
                        <Tooltip contentStyle={{ background: '#0a0a0f', border: '1px solid var(--accent-purple)' }}/>
                        <Line type="monotone" dataKey="predicted_price" stroke="var(--accent-purple)" strokeWidth={3} dot={true} />
                        </LineChart>
                    </ResponsiveContainer>
                    </div>
                )}
              </div>
            </div>
            
          </div>
        ))}
      </div>
    </div>
  );
};

export default Stocks;
