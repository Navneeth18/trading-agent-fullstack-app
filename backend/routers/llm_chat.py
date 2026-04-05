from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from database import get_db
from pydantic import BaseModel
import requests

router = APIRouter()

class ChatRequest(BaseModel):
    message: str

@router.post("/")
def chat_with_llm(request: ChatRequest, db: Session = Depends(get_db)):
    import models
    wallet = db.query(models.PortfolioWallet).first()
    assets = db.query(models.Asset).all()
    tracked = db.query(models.TrackedStock).filter(models.TrackedStock.is_active == True).all()

    wallet_bal = wallet.balance if wallet else 0
    asset_str = ", ".join([f"{a.symbol}: {a.quantity:.2f} shares" for a in assets])
    tracked_str = ", ".join([t.symbol for t in tracked])

    OLLAMA_URL = "http://localhost:11434/api/generate"
    req_lower = request.message.lower()
    
    # Detect best available model
    try:
        import requests as _req
        tags = _req.get("http://localhost:11434/api/tags", timeout=3).json()
        available = [m["name"].split(":")[0] for m in tags.get("models", [])]
        chat_model = next((m for m in ["llama3.2", "qwen3", "deepseek-r1"] if m in available), "llama3.2")
    except Exception:
        chat_model = "llama3.2"
    
    # 4. Chatbot Trade Execution Mode interceptor
    if "buy" in req_lower or "sell" in req_lower:
        import re
        percentages = re.findall(r'(\d+)%', req_lower)
        dollars = re.findall(r'\$(\d+)', req_lower)
        
        pct = float(percentages[0]) if percentages else 100.0
        explicit_cash = float(dollars[0]) if dollars else None
        
        action = "BUY" if "buy" in req_lower else "SELL"
        
        company_map = {
            "microsoft": "MSFT", "alphabet": "GOOGL", "google": "GOOGL",
            "adobe": "ADBE", "jpmorgan": "JPM", "bank of america": "BAC",
            "exxon": "XOM", "lockheed": "LMT", "northrop": "NOC",
            "johnson": "JNJ", "pfizer": "PFE"
        }
        
        found_target = None
        for smb in [t.symbol.lower() for t in tracked]:
            if smb in req_lower:
                found_target = smb.upper()
                break
        
        if not found_target:
            for name, smb in company_map.items():
                if name in req_lower:
                    found_target = smb
                    break
                
        if found_target:
            import requests as req
            import os
            try:
                # Force rapid execution simulated trade
                url = f"https://finnhub.io/api/v1/quote?symbol={found_target}&token={os.getenv('FINNHUB_API_KEY')}"
                price = req.get(url, timeout=5).json().get("c", 150.0)
            except: price = 150.0
            
            asset = db.query(models.Asset).filter(models.Asset.symbol == found_target).first()
            if action == "SELL" and asset and asset.quantity > 0:
                if explicit_cash:
                    qty = min(explicit_cash / price, asset.quantity)
                else:
                    qty = asset.quantity * (pct / 100.0)
                
                cash_gained = qty * price
                wallet.balance += cash_gained
                asset.quantity -= qty
                if asset.quantity < 0.001: asset.quantity = 0
                db.add(models.TransactionOverview(symbol=found_target, transaction_type="SELL", quantity=qty, price=price, reasoning=f"User manual chat command: {request.message}"))
                db.commit()
                return {"response": f"Executed Manual Trade: Sold {qty:.4f} shares of {found_target} at ${price} per share for ${cash_gained:.2f}. Capital returned to wallet."}
            elif action == "BUY":
                cash = explicit_cash if explicit_cash else wallet.balance * (pct / 100.0)
                cash = min(cash, wallet.balance) # Can't buy more than wallet
                qty = cash / price
                if cash > 0:
                    wallet.balance -= cash
                    if not asset:
                        asset = models.Asset(symbol=found_target, quantity=0, average_price=0)
                        db.add(asset)
                    asset.average_price = ((asset.quantity * asset.average_price) + cash) / (asset.quantity + qty)
                    asset.quantity += qty
                    db.add(models.TransactionOverview(symbol=found_target, transaction_type="BUY", quantity=qty, price=price, reasoning=f"User manual chat command: {request.message}"))
                    db.commit()
                    return {"response": f"Executed Manual Trade: Bought {qty:.4f} shares of {found_target} at ${price} per share using ${cash:.2f}."}
                else:
                    return {"response": "You don't have enough capital in your wallet to execute this purchase."}

    # If no explicit trade, process through LLM
    try:
        sys_prompt = f"You are Antigravity AI, the elite manager of this portfolio. Wallet: ${wallet_bal:.2f}. Assets owned: {asset_str}. Tracking actively: {tracked_str}. User says: " + request.message
        payload = {
            "model": chat_model,
            "prompt": sys_prompt,
            "stream": False
        }
        res = requests.post(OLLAMA_URL, json=payload, timeout=30)
        res.raise_for_status()
        data = res.json()
        ai_response = data.get("response", "I could not generate a response.")
        
        # Save to DB history
        db.add(models.ChatHistory(sender="user", text=request.message))
        db.add(models.ChatHistory(sender="ai", text=ai_response))
        db.commit()
        
        return {"response": ai_response}
    except Exception as e:
        return {"response": f"System error communicating with LLM: {str(e)}"}

@router.get("/history")
def get_chat_history(db: Session = Depends(get_db)):
    import models
    history = db.query(models.ChatHistory).order_by(models.ChatHistory.timestamp.asc()).all()
    out = [{"sender": h.sender, "text": h.text} for h in history]
    if len(out) == 0:
        out = [{"sender": "ai", "text": "Hello! I am your Portfolio Intelligence Agent powered by Llama 3.2. I monitor your stocks continuously using Deepseek to act on optimal scenarios. How can I assist you with your portfolio today?"}]
    return {"history": out}
