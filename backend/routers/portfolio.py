from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from database import get_db
import models
import yfinance as yf
import requests
import os
import time
import json

router = APIRouter()

OLLAMA_URL = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")

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
        df = yf.download(symbol_list, period="2d", progress=False, auto_adjust=True, threads=True)
        result = {}
        for sym in symbol_list:
            try:
                close_col = df["Close"] if len(symbol_list) == 1 else df["Close"][sym]
                high_col  = df["High"]  if len(symbol_list) == 1 else df["High"][sym]
                low_col   = df["Low"]   if len(symbol_list) == 1 else df["Low"][sym]
                closes = close_col.dropna()
                highs  = high_col.dropna()
                lows   = low_col.dropna()
                current = round(float(closes.iloc[-1]), 2) if len(closes) >= 1 else 0.0
                prev    = round(float(closes.iloc[-2]), 2) if len(closes) >= 2 else current
                d_high  = round(float(highs.iloc[-1]),  2) if len(highs)  >= 1 else current
                d_low   = round(float(lows.iloc[-1]),   2) if len(lows)   >= 1 else current
                result[sym] = {"current_price": current, "day_high": d_high, "day_low": d_low, "prev_close": prev}
            except Exception:
                result[sym] = {"current_price": 0.0, "day_high": 0.0, "day_low": 0.0, "prev_close": 0.0}
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
            db.add(models.TransactionOverview(symbol="USD", transaction_type="WITHDRAWAL", quantity=withdraw_amt, price=1.0, reasoning="User requested withdrawal"))
    else:
        wallet.balance += amount
        db.add(models.TransactionOverview(symbol="USD", transaction_type="DEPOSIT", quantity=amount, price=1.0, reasoning="User added funds"))

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
    interval_map = {"1d": "5m", "1wk": "1h", "1mo": "1d", "1y": "1wk", "5y": "1mo"}
    interval = interval_map.get(range, "1d")
    try:
        hist = yf.Ticker(symbol).history(period=range, interval=interval)
        data = []
        for index, row in hist.iterrows():
            val = row["Close"]
            try:
                import math
                if math.isnan(val):
                    continue
            except Exception:
                pass
            data.append({"time": str(index), "price": round(float(val), 2)})
        return {"symbol": symbol, "range": range, "data": data}
    except Exception:
        return {"symbol": symbol, "range": range, "data": []}

@router.get("/predict/{symbol}")
def get_prediction(symbol: str):
    try:
        hist = yf.Ticker(symbol).history(period="1mo")
        latest_price = round(float(hist["Close"].iloc[-1]), 2) if len(hist) > 0 else 150.0
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
