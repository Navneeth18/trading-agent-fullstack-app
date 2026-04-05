from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from database import get_db
import models
import yfinance as yf
import requests
import urllib3
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)
import os
import time
import json

router = APIRouter()

OLLAMA_URL = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")
FINNHUB_KEY = os.getenv("FINNHUB_API_KEY", "d6psvfpr01qk0cf1ql00d6psvfpr01qk0cf1ql0g")

# ── Live price cache ──────────────────────────────────────────────────────────
_price_cache: dict = {}
_CACHE_TTL = 30  # seconds

@router.get("/live-prices")
def get_live_prices(symbols: str):
    symbol_list = [s.strip().upper() for s in symbols.split(",") if s.strip()]
    if not symbol_list:
        return {}

    cache_key = frozenset(symbol_list)
    cached = _price_cache.get(cache_key)
    if cached and (time.time() - cached[0]) < _CACHE_TTL:
        return cached[1]

    try:
        from concurrent.futures import ThreadPoolExecutor

        def fetch_finnhub_quote(sym):
            try:
                url = f"https://finnhub.io/api/v1/quote?symbol={sym}&token={FINNHUB_KEY}"
                res = requests.get(url, timeout=5, verify=False)
                if res.status_code == 200:
                    d = res.json()
                    current = float(d.get("c", 0.0))
                    high = float(d.get("h", 0.0))
                    low = float(d.get("l", 0.0))
                    prev = float(d.get("pc", 0.0))
                    return sym, {"current_price": current, "day_high": high, "day_low": low, "prev_close": prev}
            except Exception:
                pass
            return sym, {"current_price": 0.0, "day_high": 0.0, "day_low": 0.0, "prev_close": 0.0}

        result = {}
        with ThreadPoolExecutor(max_workers=5) as executor:
            for sym, data in executor.map(fetch_finnhub_quote, symbol_list):
                result[sym] = data

        _price_cache[cache_key] = (time.time(), result)
        return result
    except Exception:
        return {}


# ── Wallet ────────────────────────────────────────────────────────────────────
@router.get("/wallet")
def get_wallet(db: Session = Depends(get_db)):
    wallet = db.query(models.PortfolioWallet).first()
    if not wallet:
        wallet = models.PortfolioWallet(balance=10000.0)
        db.add(wallet)
        db.commit()
    return {"balance": wallet.balance}

@router.post("/wallet/deposit")
def update_wallet(amount: float, db: Session = Depends(get_db)):
    wallet = db.query(models.PortfolioWallet).first()
    if not wallet:
        wallet = models.PortfolioWallet(balance=10000.0)
        db.add(wallet)
        db.commit()

    if amount < 0:
        withdraw_amt = abs(amount)
        if withdraw_amt > wallet.balance:
            deficit = withdraw_amt - wallet.balance
            assets_sorted = sorted(
                db.query(models.Asset).filter(models.Asset.quantity > 0).all(),
                key=lambda a: a.quantity * a.average_price, reverse=True
            )
            for asset in assets_sorted:
                if deficit <= 0:
                    break
                asset_value = asset.quantity * asset.average_price
                if asset_value <= deficit:
                    db.add(models.TransactionOverview(symbol=asset.symbol, transaction_type="SELL", quantity=asset.quantity, price=asset.average_price, reasoning=f"Auto-liquidation for withdrawal of ${withdraw_amt:.2f}"))
                    wallet.balance += asset_value
                    deficit -= asset_value
                    asset.quantity = 0
                else:
                    qty_to_sell = deficit / asset.average_price
                    db.add(models.TransactionOverview(symbol=asset.symbol, transaction_type="SELL", quantity=qty_to_sell, price=asset.average_price, reasoning="Partial auto-liquidation for withdrawal"))
                    wallet.balance += deficit
                    asset.quantity -= qty_to_sell
                    deficit = 0

        if withdraw_amt <= wallet.balance:
            wallet.balance -= withdraw_amt
            db.add(models.TransactionOverview(symbol="USD", transaction_type="WITHDRAWAL", quantity=0, price=withdraw_amt, reasoning="User requested withdrawal"))
    else:
        wallet.balance += amount
        db.add(models.TransactionOverview(symbol="USD", transaction_type="DEPOSIT", quantity=0, price=amount, reasoning="User added funds"))

    db.commit()
    return {"status": "success", "balance": wallet.balance}


# ── Portfolio data ────────────────────────────────────────────────────────────
@router.get("/transactions")
def get_transactions(db: Session = Depends(get_db)):
    txs = db.query(models.TransactionOverview).order_by(models.TransactionOverview.timestamp.desc()).limit(100).all()
    return txs

@router.get("/assets")
def get_assets(db: Session = Depends(get_db)):
    return db.query(models.Asset).all()

@router.get("/summary")
def get_summary(db: Session = Depends(get_db)):
    """Returns wallet + held assets + recent transactions for the dashboard."""
    wallet = db.query(models.PortfolioWallet).first()
    assets = db.query(models.Asset).filter(models.Asset.quantity > 0).all()
    recent_txs = db.query(models.TransactionOverview).order_by(
        models.TransactionOverview.timestamp.desc()).limit(5).all()
    return {
        "balance": wallet.balance if wallet else 0,
        "active_positions": len(assets),
        "recent_transactions": [
            {"symbol": t.symbol, "type": t.transaction_type,
             "quantity": t.quantity, "price": t.price,
             "reasoning": t.reasoning,
             "timestamp": t.timestamp.isoformat() if t.timestamp else ""}
            for t in recent_txs
        ]
    }


# ── Strategic AI actions ──────────────────────────────────────────────────────
@router.post("/strategic-invest")
async def strategic_invest(amount: float, db: Session = Depends(get_db)):
    if amount <= 0:
        raise HTTPException(status_code=400, detail="Amount must be greater than 0")
    wallet = db.query(models.PortfolioWallet).first()
    if not wallet:
        raise HTTPException(status_code=400, detail="No wallet found")
    if wallet.balance < amount:
        raise HTTPException(status_code=400, detail=f"Insufficient balance. Available: ${wallet.balance:.2f}")
    from trading_engine.loop import start_job
    job_id = start_job("INVEST", amount)
    return {"status": "started", "job_id": job_id, "message": f"AI pipeline started for ${amount:.2f} invest. Poll /job/{job_id} for result."}

@router.post("/strategic-withdraw")
async def strategic_withdraw(amount: float, db: Session = Depends(get_db)):
    if amount <= 0:
        raise HTTPException(status_code=400, detail="Amount must be greater than 0")
    held = db.query(models.Asset).filter(models.Asset.quantity > 0).all()
    if not held:
        raise HTTPException(status_code=400, detail="No open positions to liquidate")
    from trading_engine.loop import start_job
    job_id = start_job("WITHDRAW", amount)
    return {"status": "started", "job_id": job_id, "message": f"AI pipeline started for ${amount:.2f} withdraw. Poll /job/{job_id} for result."}

@router.get("/job/{job_id}")
def get_job_status(job_id: str):
    from trading_engine.loop import get_job
    return get_job(job_id)


# ── Tracked stocks ────────────────────────────────────────────────────────────
@router.get("/tracked-stocks")
def get_tracked_stocks(db: Session = Depends(get_db)):
    return db.query(models.TrackedStock).all()

@router.post("/tracked-stocks")
def add_tracked_stock(symbol: str, db: Session = Depends(get_db)):
    symbol = symbol.upper()
    stock = db.query(models.TrackedStock).filter(models.TrackedStock.symbol == symbol).first()
    if not stock:
        stock = models.TrackedStock(symbol=symbol, is_active=True)
        db.add(stock)
        db.commit()
    return {"status": "success", "symbol": symbol}


# ── Price history & prediction ────────────────────────────────────────────────
@router.get("/history/{symbol}")
def get_stock_history(symbol: str, range: str = "1mo"):
    try:
        import datetime
        interval_map = {"1d": "5m", "1wk": "1h", "1mo": "1d", "1y": "1wk", "5y": "1mo"}
        interval = interval_map.get(range, "1d")
        url = f"https://query1.finance.yahoo.com/v8/finance/chart/{symbol}?range={range}&interval={interval}"
        res = requests.get(url, headers={'User-Agent': 'Mozilla/5.0'}, verify=False, timeout=10)
        if res.status_code == 200:
            d = res.json()
            result = d.get("chart", {}).get("result", [])
            if result:
                timestamps = result[0].get("timestamp", [])
                closes = result[0].get("indicators", {}).get("quote", [{}])[0].get("close", [])
                data = []
                for t, c in zip(timestamps, closes):
                    if c is not None:
                        iso_time = datetime.datetime.fromtimestamp(t).isoformat()
                        data.append({"time": iso_time, "price": round(float(c), 2)})
                return {"symbol": symbol, "range": range, "data": data}
        return {"symbol": symbol, "range": range, "data": []}
    except Exception:
        return {"symbol": symbol, "range": range, "data": []}
@router.get("/predict/{symbol}")
def get_prediction(symbol: str):
    try:
        url = f"https://finnhub.io/api/v1/quote?symbol={symbol}&token={FINNHUB_KEY}"
        res = requests.get(url, timeout=5, verify=False)
        latest_price = round(float(res.json().get("c", 0.0)), 2)
        if latest_price <= 0.0:
            latest_price = 150.0
    except Exception:
        latest_price = 150.0

    prompt = (
        f"Analyze stock {symbol} currently at ${latest_price}. "
        "Predict the 1-month (next 20 trading days) trajectory mathematically. "
        "Provide ONLY a JSON array of 20 floats representing the forecasted daily prices. "
        "E.g. [151.2, 155.0, ...]"
    )
    try:
        res = requests.post(f"{OLLAMA_URL}/api/generate",
            json={"model": "llama3.2", "prompt": prompt, "format": "json", "stream": False}, timeout=15)
        prediction_arr = json.loads(res.json().get("response", "[]"))
        if not isinstance(prediction_arr, list) or len(prediction_arr) == 0:
            raise ValueError("empty")
    except Exception:
        prediction_arr = [round(latest_price * (1 + i * 0.005), 2) for i in range(1, 21)]

    return {
        "symbol": symbol,
        "current_price": latest_price,
        "predictions": [{"step": i + 1, "predicted_price": round(float(p), 2)} for i, p in enumerate(prediction_arr)],
    }
