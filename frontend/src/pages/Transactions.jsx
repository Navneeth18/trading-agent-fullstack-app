import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { History, Target, TrendingUp, TrendingDown } from 'lucide-react';

const Transactions = () => {
  const [transactions, setTransactions] = useState([]);

  useEffect(() => {
    fetchTransactions();
  }, []);

  const fetchTransactions = async () => {
    try {
        const res = await axios.get("http://localhost:8000/api/portfolio/transactions");
        setTransactions(res.data);
    } catch (e) {
        console.error(e);
    }
  };

  return (
    <div>
      <h1 style={{ marginBottom: '0.5rem', display: 'flex', alignItems: 'center', gap: '10px' }}>
        <History size={32} color="var(--accent-blue)" /> Global Transaction Ledger
      </h1>
      <p style={{ color: 'var(--text-secondary)', marginBottom: '3rem' }}>
        A complete historical immutable record of every autonomous AI execution and manual wallet transaction natively stored.
      </p>

      <div className="glass-card">
        <table style={{ width: '100%', textAlign: 'left', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ color: 'var(--text-secondary)', borderBottom: '1px solid var(--border-glass)' }}>
              <th style={{ padding: '1.2rem 1rem' }}>Timestamp</th>
              <th style={{ padding: '1.2rem 1rem' }}>Asset</th>
              <th style={{ padding: '1.2rem 1rem' }}>Action</th>
              <th style={{ padding: '1.2rem 1rem' }}>Shares</th>
              <th style={{ padding: '1.2rem 1rem' }}>Unit Price</th>
              <th style={{ padding: '1.2rem 1rem' }}>Total Value</th>
              <th style={{ padding: '1.2rem 1rem' }}>Deepseek Strategic Reasoning</th>
            </tr>
          </thead>
          <tbody>
            {transactions.length === 0 ? (
                <tr>
                  <td colSpan="7" style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
                    No executions recorded in internal database yet. Send funds or trigger Llama.
                  </td>
                </tr>
            ) : (
                transactions.map(tx => {
                    const isUSD = tx.symbol === 'USD';
                    const totalValue = isUSD ? tx.price : (tx.quantity * tx.price);
                    return (
                    <tr key={tx.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                        <td style={{ padding: '1.2rem 1rem', color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
                            {new Date(tx.timestamp).toLocaleString(undefined, {
                                month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
                            })}
                        </td>
                        <td style={{ padding: '1.2rem 1rem', fontWeight: 700 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                            {isUSD ? <Target size={16} color="var(--text-secondary)"/> : tx.transaction_type === "BUY" ? <TrendingUp size={16} color="var(--accent-green)"/> : <TrendingDown size={16} color="var(--accent-red)"/> }
                            {tx.symbol}
                            </div>
                        </td>
                        <td style={{ 
                            padding: '1.2rem 1rem', fontWeight: 600,
                            color: tx.transaction_type === "BUY" ? 'var(--accent-green)' : tx.transaction_type === "SELL" ? 'var(--accent-red)' : 'var(--text-secondary)' 
                        }}>
                            {tx.transaction_type}
                        </td>
                        <td style={{ padding: '1.2rem 1rem' }}>{isUSD ? '-' : tx.quantity.toFixed(4)}</td>
                        <td style={{ padding: '1.2rem 1rem' }}>
                            {isUSD ? '-' : `$${tx.price.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`}
                        </td>
                        <td style={{ 
                            padding: '1.2rem 1rem', fontWeight: 700,
                            color: tx.transaction_type === "BUY" ? 'var(--accent-green)' : tx.transaction_type === "SELL" ? 'var(--accent-red)' : 'var(--accent-blue)',
                        }}>
                            ${totalValue.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}
                        </td>
                        <td style={{ padding: '1.2rem 1rem', fontSize: '0.85rem', color: 'var(--text-secondary)', lineHeight: '1.4' }}>{tx.reasoning}</td>
                    </tr>
                    );
                })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default Transactions;
