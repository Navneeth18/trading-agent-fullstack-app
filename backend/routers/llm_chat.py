from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from database import get_db
from pydantic import BaseModel
import requests
import urllib3
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

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
        tags = _req.get("http://localhost:11434/api/tags", timeout=3, verify=False).json()
        available = [m["name"].split(":")[0] for m in tags.get("models", [])]
        chat_model = next((m for m in ["llama3.2", "qwen3", "deepseek-r1"] if m in available), "llama3.2")
    except Exception:
        chat_model = "llama3.2"
    
    # 4. Chatbot Trade Execution Mode interceptor
    if "buy" in req_lower or "sell" in req_lower:
        import re
        percentages = re.findall(r'(\d+)%', req_lower)
        dollars = re.findall(r'\$(\d+)', req_lower)
        
        # Natural language fraction parsing
        fraction_map = {
            "half": 50.0, "quarter": 25.0, "third": 33.33,
            "three quarter": 75.0, "three-quarter": 75.0,
            "two third": 66.67, "two-third": 66.67,
            "tenth": 10.0, "fifth": 20.0,
        }
        pct = float(percentages[0]) if percentages else None
        if pct is None:
            for word, val in fraction_map.items():
                if word in req_lower:
                    pct = val
                    break
        if pct is None:
            pct = 100.0
        
        explicit_cash = float(dollars[0]) if dollars else None
        
        action = "BUY" if "buy" in req_lower else "SELL"
        
        company_map = {
            "microsoft": "MSFT", "alphabet": "GOOGL", "google": "GOOGL",
            "adobe": "ADBE", "jpmorgan": "JPM", "bank of america": "BAC",
            "exxon": "XOM", "exxonmobil": "XOM", "lockheed": "LMT", "northrop": "NOC",
            "johnson": "JNJ", "pfizer": "PFE", "amazon": "AMZN", "intel": "INTC"
        }
        
        # 1. Try company names first
        found_target = None
        for name, smb in company_map.items():
            if name in req_lower:
                found_target = smb
                break
        # 2. Try ticker symbols (word-boundary aware)
        if not found_target:
            for smb in [t.symbol.lower() for t in tracked]:
                if re.search(r'\b' + re.escape(smb) + r'\b', req_lower):
                    found_target = smb.upper()
                    break

        # 3. Only fall back to ALL if NO specific symbol was found
        if not found_target and ("all" in req_lower or "everything" in req_lower or "portfolio" in req_lower):
            found_target = "ALL"
            
        if found_target == "ALL" and action == "SELL":
            import requests as req
            import os
            total_cash_gained = 0.0
            sold_symbols = []
            for a in assets:
                if a.quantity > 0:
                    try:
                        url = f"https://finnhub.io/api/v1/quote?symbol={a.symbol}&token={os.getenv('FINNHUB_API_KEY')}"
                        price = req.get(url, timeout=5, verify=False).json().get("c", 0.0)
                    except: price = 0.0
                    if price <= 0.0:
                        continue
                        
                    qty = a.quantity
                    cash_gained = qty * price
                    total_cash_gained += cash_gained
                    wallet.balance += cash_gained
                    a.quantity = 0
                    db.add(models.TransactionOverview(symbol=a.symbol, transaction_type="SELL", quantity=qty, price=price, reasoning=f"User manual chat command: {request.message}"))
                    sold_symbols.append(a.symbol)
            if total_cash_gained > 0:
                ai_resp = f"Executed Manual Trade: Sold all holdings ({', '.join(sold_symbols)}) for a total of ${total_cash_gained:.2f}. Capital returned to wallet."
                db.add(models.ChatHistory(sender="user", text=request.message))
                db.add(models.ChatHistory(sender="ai", text=ai_resp))
                db.commit()
                return {"response": ai_resp}
            else:
                ai_resp = "You don't have any holdings to sell."
                db.add(models.ChatHistory(sender="user", text=request.message))
                db.add(models.ChatHistory(sender="ai", text=ai_resp))
                db.commit()
                return {"response": ai_resp}
        elif found_target == "ALL" and action == "BUY":
            ai_resp = "I cannot automatically buy 'all'. Please specify a stock symbol to buy."
            db.add(models.ChatHistory(sender="user", text=request.message))
            db.add(models.ChatHistory(sender="ai", text=ai_resp))
            db.commit()
            return {"response": ai_resp}
                
        elif found_target:
            import requests as req
            import os
            try:
                # Force rapid execution simulated trade
                url = f"https://finnhub.io/api/v1/quote?symbol={found_target}&token={os.getenv('FINNHUB_API_KEY')}"
                price = req.get(url, timeout=5, verify=False).json().get("c", 0.0)
                if price <= 0.0: price = 150.0
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
                ai_resp = f"Executed Manual Trade: Sold {qty:.4f} shares of {found_target} at ${price} per share for ${cash_gained:.2f}. Capital returned to wallet."
                db.add(models.ChatHistory(sender="user", text=request.message))
                db.add(models.ChatHistory(sender="ai", text=ai_resp))
                db.commit()
                return {"response": ai_resp}
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
                    ai_resp = f"Executed Manual Trade: Bought {qty:.4f} shares of {found_target} at ${price} per share using ${cash:.2f}."
                    db.add(models.ChatHistory(sender="user", text=request.message))
                    db.add(models.ChatHistory(sender="ai", text=ai_resp))
                    db.commit()
                    return {"response": ai_resp}
                else:
                    ai_resp = "You don't have enough capital in your wallet to execute this purchase."
                    db.add(models.ChatHistory(sender="user", text=request.message))
                    db.add(models.ChatHistory(sender="ai", text=ai_resp))
                    db.commit()
                    return {"response": ai_resp}

    # If no explicit trade, process through LLM
    try:
        sys_prompt = f"You are Antigravity AI, the elite manager of this portfolio. Wallet: ${wallet_bal:.2f}. Assets owned: {asset_str}. Tracking actively: {tracked_str}. User says: " + request.message
        payload = {
            "model": chat_model,
            "prompt": sys_prompt,
            "stream": False
        }
        res = requests.post(OLLAMA_URL, json=payload, timeout=30, verify=False)
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
