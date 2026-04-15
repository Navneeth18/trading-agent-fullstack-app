from fastapi import APIRouter, UploadFile, File, Depends, HTTPException
from sqlalchemy.orm import Session
from database import get_db
import models

router = APIRouter()


def extract_text_from_file(filename: str, content: bytes) -> str:
    """Extract text from uploaded file."""
    if filename.endswith('.txt'):
        return content.decode('utf-8', errors='ignore')
    elif filename.endswith('.pdf'):
        try:
            import io
            # Try PyPDF2 first
            try:
                from PyPDF2 import PdfReader
                reader = PdfReader(io.BytesIO(content))
                text = ""
                for page in reader.pages:
                    text += page.extract_text() or ""
                return text
            except ImportError:
                pass
            # Try pdfplumber
            try:
                import pdfplumber
                with pdfplumber.open(io.BytesIO(content)) as pdf:
                    text = ""
                    for page in pdf.pages:
                        text += page.extract_text() or ""
                    return text
            except ImportError:
                pass
            return f"[PDF file: {filename} - install PyPDF2 or pdfplumber to extract text]"
        except Exception as e:
            return f"[PDF extraction failed: {str(e)}]"
    return content.decode('utf-8', errors='ignore')


def get_knowledge_context(db: Session, max_chars: int = 3000) -> str:
    """Get concatenated knowledge base content for AI context injection."""
    docs = db.query(models.KnowledgeDocument).order_by(
        models.KnowledgeDocument.uploaded_at.desc()
    ).all()
    if not docs:
        return ""
    
    context_parts = []
    total_chars = 0
    for doc in docs:
        remaining = max_chars - total_chars
        if remaining <= 0:
            break
        snippet = doc.content[:remaining]
        context_parts.append(f"[{doc.filename}]:\n{snippet}")
        total_chars += len(snippet)
    
    return "\n\n".join(context_parts)


@router.post("/upload")
async def upload_document(file: UploadFile = File(...), db: Session = Depends(get_db)):
    if not file.filename.endswith('.pdf') and not file.filename.endswith('.txt'):
        raise HTTPException(status_code=400, detail="Only PDF and TXT files are supported.")
    
    content = await file.read()
    extracted_text = extract_text_from_file(file.filename, content)
    
    if not extracted_text.strip():
        raise HTTPException(status_code=400, detail="Could not extract any text from the file.")
    
    # Check if document already exists
    existing = db.query(models.KnowledgeDocument).filter(
        models.KnowledgeDocument.filename == file.filename
    ).first()
    
    if existing:
        existing.content = extracted_text
    else:
        db.add(models.KnowledgeDocument(
            filename=file.filename,
            content=extracted_text,
        ))
    db.commit()
    
    return {
        "status": "success",
        "message": f"'{file.filename}' ingested into knowledge base ({len(extracted_text)} chars extracted).",
        "chars_extracted": len(extracted_text),
    }


@router.get("/documents")
async def list_documents(db: Session = Depends(get_db)):
    docs = db.query(models.KnowledgeDocument).order_by(
        models.KnowledgeDocument.uploaded_at.desc()
    ).all()
    return {
        "documents": [
            {
                "id": d.id,
                "filename": d.filename,
                "chars": len(d.content) if d.content else 0,
                "uploaded_at": d.uploaded_at.isoformat() if d.uploaded_at else "",
                "preview": (d.content[:200] + "...") if d.content and len(d.content) > 200 else d.content,
            }
            for d in docs
        ]
    }


@router.delete("/documents/{doc_id}")
async def delete_document(doc_id: int, db: Session = Depends(get_db)):
    doc = db.query(models.KnowledgeDocument).filter(models.KnowledgeDocument.id == doc_id).first()
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    db.delete(doc)
    db.commit()
    return {"status": "success", "message": f"Deleted '{doc.filename}'"}
