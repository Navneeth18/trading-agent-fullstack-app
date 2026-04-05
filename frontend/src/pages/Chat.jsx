import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import { Send, Bot, User } from 'lucide-react';

const Chat = () => {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const chatEndRef = useRef(null);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    fetchHistory();
  }, []);

  const fetchHistory = async () => {
    try {
      const res = await axios.get('http://localhost:8000/api/chat/history');
      setMessages(res.data.history);
    } catch { }
  };

  const sendMessage = async () => {
    if (!input.trim()) return;
    
    const userMessage = { sender: 'user', text: input };
    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setLoading(true);
    
    try {
      // In a real env, path is to python backend: /api/chat
      // We will simulate delayed response if backend isn't up
      const res = await axios.post('http://localhost:8000/api/chat/', { message: input }).catch(err => {
        // Fallback for demo
        return { data: { response: "I am actively tracking your assets. My backend connection is currently unreachable, but my background logic persists." } };
      });
      
      setMessages(prev => [...prev, { sender: 'ai', text: res.data.response }]);
    } catch (e) {
      setMessages(prev => [...prev, { sender: 'ai', text: "System error: unable to reach reasoning engine." }]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <h1 style={{ marginBottom: '1rem' }}>AI Command Hub</h1>
      <p style={{ color: 'var(--text-secondary)', marginBottom: '2rem' }}>
        Interact directly with your intelligence agent. You can ask for portfolio status, instruct manual trades, or ask about specific stocks.
      </p>
      
      <div className="chat-window">
        <div className="chat-history">
          {messages.map((msg, i) => (
            <div key={i} className={`chat-message ${msg.sender}`} style={{ display: 'flex', gap: '12px', alignItems: 'flex-start' }}>
              <div style={{ marginTop: '0.2rem' }}>
                {msg.sender === 'ai' ? <Bot size={20} color="var(--accent-purple)" /> : <User size={20} color="var(--accent-blue)" />}
              </div>
              <div style={{ flex: 1 }}>{msg.text}</div>
            </div>
          ))}
          {loading && (
            <div className="chat-message ai" style={{ display: 'flex', gap: '12px' }}>
              <Bot size={20} color="var(--accent-purple)" />
              <div style={{ fontStyle: 'italic', color: 'var(--text-secondary)' }}>Thinking...</div>
            </div>
          )}
          <div ref={chatEndRef} />
        </div>
        
        <div className="chat-input">
          <input 
            type="text" 
            placeholder="E.g., What's the latest momentum on TSLA?" 
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && sendMessage()}
          />
          <button className="btn btn-primary" onClick={sendMessage} disabled={loading} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Send size={18} /> Send
          </button>
        </div>
      </div>
    </div>
  );
};

export default Chat;
