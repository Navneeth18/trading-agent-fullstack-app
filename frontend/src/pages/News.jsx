import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { Newspaper, Loader } from 'lucide-react';

const News = () => {
  const [newsList, setNewsList] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchNews = async () => {
      try {
        const res = await axios.get("http://localhost:8000/api/news/");
        setNewsList(res.data.news);
      } catch (e) {
        console.error("News error", e);
      } finally {
        setLoading(false);
      }
    };
    fetchNews();
  }, []);

  return (
    <div>
      <h1 className="gradient-text" style={{ marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '1rem' }}>
        <Newspaper size={32} /> Algorithmic News Feed
      </h1>
      <p style={{ color: 'var(--text-secondary)', marginBottom: '2.5rem' }}>
        These headlines are ingested dynamically via free APIs and analyzed using standard momentum metrics (or local FinBERT loading if available) to ascertain immediate market sentiment impacts.
      </p>

      {loading ? (
        <div style={{ display: 'flex', gap: '1rem', color: 'var(--text-secondary)' }}>
            <Loader className="lucide-spin" /> Fetching live headlines...
        </div>
      ) : (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        {newsList.map((news) => (
          <a
            key={news.id}
            href={news.link}
            target="_blank"
            rel="noopener noreferrer"
            style={{ textDecoration: 'none', color: 'inherit' }}
          >
          <div className="glass-card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }}>
            <div>
              <h3 style={{ marginBottom: '0.5rem', fontSize: '1.2rem' }}>{news.title}</h3>
              <div style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', display: 'flex', gap: '1rem' }}>
                <span>Source: {news.source}</span>
                <span>•</span>
                <span>{news.time}</span>
              </div>
            </div>
            
            <div style={{
              padding: '0.5rem 1rem', borderRadius: '20px', fontWeight: 'bold', textTransform: 'uppercase', fontSize: '0.8rem',
              backgroundColor: news.sentiment === 'positive' ? 'rgba(16, 185, 129, 0.2)' : news.sentiment === 'negative' ? 'rgba(239, 68, 68, 0.2)' : 'rgba(148, 163, 184, 0.2)',
              color: news.sentiment === 'positive' ? 'var(--accent-green)' : news.sentiment === 'negative' ? 'var(--accent-red)' : 'var(--text-secondary)'
            }}>
              {news.sentiment}
            </div>
          </div>
          </a>
        ))}
      </div>
      )}
    </div>
  );
};

export default News;
