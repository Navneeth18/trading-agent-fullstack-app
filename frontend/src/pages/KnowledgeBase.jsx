import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { BookOpen, UploadCloud, FileText, Trash2, Brain, Clock, RefreshCw } from 'lucide-react';

const API = 'http://localhost:8000/api/knowledge';

const KnowledgeBase = () => {
  const [file, setFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState(null);
  const [documents, setDocuments] = useState([]);
  const [loading, setLoading] = useState(true);

  const fetchDocuments = async () => {
    setLoading(true);
    try {
      const res = await axios.get(`${API}/documents`);
      setDocuments(res.data.documents || []);
    } catch (e) {
      console.error(e);
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchDocuments();
  }, []);

  const handleUpload = async () => {
    if (!file) return;
    setUploading(true);
    setUploadResult(null);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await axios.post(`${API}/upload`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });
      setUploadResult({ type: 'success', text: res.data.message });
      setFile(null);
      // Reset file input
      const el = document.getElementById('kb-file-upload');
      if (el) el.value = '';
      fetchDocuments();
    } catch (e) {
      const detail = e.response?.data?.detail || e.message;
      setUploadResult({ type: 'error', text: `Upload failed: ${detail}` });
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async (id, filename) => {
    if (!confirm(`Delete "${filename}" from knowledge base?`)) return;
    try {
      await axios.delete(`${API}/documents/${id}`);
      fetchDocuments();
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <div>
      <h1 style={{ marginBottom: '0.5rem', display: 'flex', alignItems: 'center', gap: '10px' }}>
        <BookOpen size={32} color="var(--accent-purple)" /> Knowledge Base
      </h1>
      <p style={{ color: 'var(--text-secondary)', marginBottom: '2rem', maxWidth: '900px', lineHeight: '1.6' }}>
        Upload trading strategy documents, market principles, and rules. The AI engine will reference 
        these as <strong style={{ color: 'var(--accent-purple)' }}>mandatory trading principles</strong> before 
        every buy/sell decision. This acts as the system's central brain — ensuring consistent strategy adherence.
      </p>

      {/* How it works */}
      <div className="glass-card" style={{ marginBottom: '2rem', padding: '1.5rem', background: 'rgba(139,92,246,0.04)', border: '1px solid rgba(139,92,246,0.15)' }}>
        <h3 style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '1rem', color: 'var(--accent-purple)' }}>
          <Brain size={20} /> How Knowledge Integration Works
        </h3>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '1.5rem' }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: '1.2rem', marginBottom: '0.3rem' }}>1. Upload</div>
            <div style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', lineHeight: '1.5' }}>
              Upload .PDF or .TXT files containing trading strategies, risk rules, or market principles.
            </div>
          </div>
          <div>
            <div style={{ fontWeight: 700, fontSize: '1.2rem', marginBottom: '0.3rem' }}>2. Extract</div>
            <div style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', lineHeight: '1.5' }}>
              Text is extracted and stored. The system indexes key principles for quick retrieval.
            </div>
          </div>
          <div>
            <div style={{ fontWeight: 700, fontSize: '1.2rem', marginBottom: '0.3rem' }}>3. Influence</div>
            <div style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', lineHeight: '1.5' }}>
              Every AI trade decision (auto & strategic) consults these principles as mandatory rules before executing.
            </div>
          </div>
        </div>
      </div>

      {/* Upload area */}
      <div className="glass-card" style={{
        padding: '3rem 2rem', display: 'flex', flexDirection: 'column', alignItems: 'center',
        borderStyle: 'dashed', marginBottom: '2rem',
      }}>
        <UploadCloud size={52} color="var(--text-secondary)" style={{ marginBottom: '1.5rem' }} />
        
        <input 
          type="file" 
          id="kb-file-upload" 
          accept=".pdf,.txt"
          style={{ display: 'none' }}
          onChange={(e) => setFile(e.target.files[0])}
        />
        
        <label htmlFor="kb-file-upload" className="btn btn-primary" style={{
          marginBottom: '0.8rem', display: 'inline-block', cursor: 'pointer', padding: '0.8rem 2rem',
        }}>
          Select File (.pdf, .txt)
        </label>
        
        {file && (
          <div style={{ marginTop: '0.8rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <FileText size={16} color="var(--accent-green)" />
            <span style={{ color: 'var(--accent-green)', fontWeight: 600 }}>{file.name}</span>
            <span style={{ color: 'var(--text-secondary)', fontSize: '0.8rem' }}>
              ({(file.size / 1024).toFixed(1)} KB)
            </span>
          </div>
        )}

        {uploadResult && (
          <div style={{
            marginTop: '1rem', padding: '0.8rem 1.2rem', borderRadius: '8px', maxWidth: '500px', textAlign: 'center',
            background: uploadResult.type === 'success' ? 'rgba(16,185,129,0.12)' : 'rgba(239,68,68,0.12)',
            border: `1px solid ${uploadResult.type === 'success' ? 'var(--accent-green)' : 'var(--accent-red)'}`,
            color: uploadResult.type === 'success' ? 'var(--accent-green)' : 'var(--accent-red)',
            fontSize: '0.9rem'
          }}>
            {uploadResult.text}
          </div>
        )}

        <button 
          className="btn" 
          onClick={handleUpload} 
          disabled={!file || uploading}
          style={{
            marginTop: '1.5rem', opacity: file && !uploading ? 1 : 0.4,
            display: 'flex', alignItems: 'center', gap: '8px',
          }}
        >
          {uploading ? (
            <><RefreshCw size={16} style={{ animation: 'spin 1s linear infinite' }} /> Processing…</>
          ) : (
            <><UploadCloud size={16} /> Inject into Knowledge Base</>
          )}
        </button>
      </div>

      {/* Stored documents */}
      <h2 style={{ marginBottom: '1.5rem', display: 'flex', alignItems: 'center', gap: '10px' }}>
        <FileText size={24} /> Stored Knowledge Documents
        <span style={{
          fontSize: '0.75rem', padding: '3px 10px', borderRadius: '20px',
          background: 'rgba(139,92,246,0.15)', color: 'var(--accent-purple)', fontWeight: 600,
        }}>
          {documents.length} document{documents.length !== 1 ? 's' : ''}
        </span>
      </h2>

      {loading ? (
        <div className="glass-card" style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
          <RefreshCw size={24} style={{ animation: 'spin 1s linear infinite', marginBottom: '0.5rem' }} />
          <div>Loading documents…</div>
        </div>
      ) : documents.length === 0 ? (
        <div className="glass-card" style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
          <Brain size={40} style={{ marginBottom: '1rem', opacity: 0.4 }} />
          <div style={{ fontSize: '1rem', marginBottom: '0.5rem' }}>No documents uploaded yet</div>
          <div style={{ fontSize: '0.85rem' }}>Upload trading strategies or principles to enhance AI decision-making.</div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {documents.map(doc => (
            <div key={doc.id} className="glass-card" style={{ padding: '1.5rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '0.5rem' }}>
                    <FileText size={18} color="var(--accent-purple)" />
                    <span style={{ fontWeight: 700, fontSize: '1rem' }}>{doc.filename}</span>
                    <span style={{
                      fontSize: '0.7rem', padding: '2px 8px', borderRadius: '10px',
                      background: 'rgba(59,130,246,0.1)', color: 'var(--accent-blue)',
                    }}>
                      {doc.chars.toLocaleString()} chars
                    </span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--text-secondary)', fontSize: '0.8rem', marginBottom: '0.8rem' }}>
                    <Clock size={12} />
                    Uploaded {new Date(doc.uploaded_at).toLocaleString()}
                  </div>
                  <div style={{
                    color: 'var(--text-secondary)', fontSize: '0.85rem', lineHeight: '1.5',
                    background: 'rgba(0,0,0,0.2)', padding: '0.8rem 1rem', borderRadius: '8px',
                    fontFamily: 'monospace', whiteSpace: 'pre-wrap', maxHeight: '120px', overflow: 'auto',
                  }}>
                    {doc.preview}
                  </div>
                </div>
                <button
                  onClick={() => handleDelete(doc.id, doc.filename)}
                  style={{
                    background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)',
                    color: 'var(--accent-red)', padding: '0.5rem', borderRadius: '8px',
                    cursor: 'pointer', marginLeft: '1rem', flexShrink: 0,
                    display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.8rem',
                  }}
                  title="Delete document"
                >
                  <Trash2 size={14} /> Remove
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default KnowledgeBase;
