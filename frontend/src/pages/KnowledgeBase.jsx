import React, { useState } from 'react';
import { BookOpen, UploadCloud } from 'lucide-react';

const KnowledgeBase = () => {
  const [file, setFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState(null); // { type: 'success'|'error', text: string }

  const handleUpload = async () => {
    if (!file) return;
    setUploading(true);
    setUploadResult(null);
    try {
      const formData = new FormData();
      formData.append('file', file);
      await fetch('http://localhost:8000/api/knowledge/upload', {
        method: 'POST',
        body: formData,
      }).then(async (res) => {
        if (!res.ok) {
          const err = await res.json().catch(() => ({ detail: res.statusText }));
          throw new Error(err.detail || 'Upload failed');
        }
        return res.json();
      });
      setUploadResult({ type: 'success', text: `"${file.name}" uploaded and injected into the RAG Vector DB.` });
      setFile(null);
    } catch (e) {
      setUploadResult({ type: 'error', text: `Upload failed: ${e.message}` });
    } finally {
      setUploading(false);
    }
  };

  return (
    <div>
      <h1 style={{ marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '1rem' }}>
        <BookOpen size={32} color="var(--accent-purple)" /> Knowledge Base
      </h1>
      <p style={{ color: 'var(--text-secondary)', marginBottom: '3rem', maxWidth: '800px', lineHeight: '1.6' }}>
        Upload trading books, strategy PDFs, or customized logic texts. These documents dictate standard principles that the system will adhere strictly to. 
        Once uploaded, our Vector Engine parses the context ensuring Deepseek references these rules before trading decisions.
      </p>

      <div className="glass-card" style={{ padding: '4rem 2rem', display: 'flex', flexDirection: 'column', alignItems: 'center', borderStyle: 'dashed' }}>
        <UploadCloud size={64} color="var(--text-secondary)" style={{ marginBottom: '2rem' }} />
        
        <input 
          type="file" 
          id="file-upload" 
          accept=".pdf,.txt"
          style={{ display: 'none' }}
          onChange={(e) => setFile(e.target.files[0])}
        />
        
        <label htmlFor="file-upload" className="btn btn-primary" style={{ marginBottom: '1rem', display: 'inline-block', cursor: 'pointer' }}>
          Select File (.pdf, .txt)
        </label>
        
        {file && (
          <div style={{ marginTop: '1rem', color: 'var(--accent-green)', fontWeight: 'bold' }}>
            Selected: {file.name}
          </div>
        )}

        {uploadResult && (
          <div style={{
            marginTop: '1rem', padding: '0.8rem 1.2rem', borderRadius: '8px',
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
          style={{ marginTop: '2rem', opacity: file && !uploading ? 1 : 0.5 }}
        >
          {uploading ? 'Uploading…' : 'Inject to RAG Vector DB'}
        </button>
      </div>
    </div>
  );
};

export default KnowledgeBase;
