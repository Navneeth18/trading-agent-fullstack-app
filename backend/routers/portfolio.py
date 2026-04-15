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


@router.get("/total-pnl")
def get_total_pnl(db: Session = Depends(get_db)):
    """Calculate total realized + unrealized P&L from inception.
    Realized P&L = sum of (sell_price - avg_buy_price) * qty for all sells.
    Unrealized P&L = sum of (current_price - avg_buy_price) * qty for held positions.
    """
    wallet = db.query(models.PortfolioWallet).first()
    initial_balance = 10000.0  # Starting balance

    # Realized P&L: compute from SELL transactions
    # For each sell, profit = (sell_price - asset's avg_price at that time) * qty
    # Simplification: total_cash_from_sells - total_cost_of_sold_shares
    sells = db.query(models.TransactionOverview).filter(
        models.TransactionOverview.transaction_type == "SELL",
        models.TransactionOverview.symbol != "USD"
    ).all()
    
    buys = db.query(models.TransactionOverview).filter(
        models.TransactionOverview.transaction_type == "BUY"
    ).all()
    
    total_bought = sum(tx.quantity * tx.price for tx in buys)
    total_sold = sum(tx.quantity * tx.price for tx in sells)
    
    # Net deposits/withdrawals
    deposits = db.query(models.TransactionOverview).filter(
        models.TransactionOverview.transaction_type == "DEPOSIT"
    ).all()
    withdrawals = db.query(models.TransactionOverview).filter(
        models.TransactionOverview.transaction_type == "WITHDRAWAL"
    ).all()
    total_deposited = sum(tx.price for tx in deposits)
    total_withdrawn = sum(tx.price for tx in withdrawals)
    
    # Current held assets value (unrealized)
    assets = db.query(models.Asset).filter(models.Asset.quantity > 0).all()
    held_cost = sum(a.quantity * a.average_price for a in assets)
    
    # Fetch live prices for unrealized calc
    unrealized_pnl = 0.0
    held_market_value = 0.0
    for a in assets:
        try:
            url = f"https://finnhub.io/api/v1/quote?symbol={a.symbol}&token={FINNHUB_KEY}"
            res = requests.get(url, timeout=5, verify=False)
            current_price = float(res.json().get("c", 0.0))
            if current_price <= 0:
                current_price = a.average_price
        except Exception:
            current_price = a.average_price
        market_val = a.quantity * current_price
        cost_basis = a.quantity * a.average_price
        held_market_value += market_val
        unrealized_pnl += market_val - cost_basis
    
    # Total P&L = (current_cash + held_market_value) - (initial + deposits - withdrawals)
    current_cash = wallet.balance if wallet else 0
    total_capital_in = initial_balance + total_deposited - total_withdrawn
    total_current_value = current_cash + held_market_value
    total_pnl = total_current_value - total_capital_in
    
    # Realized = total_sold - cost of those sold shares
    # Approximate realized from: total_pnl - unrealized_pnl
    realized_pnl = total_pnl - unrealized_pnl
    
    return {
        "initial_balance": initial_balance,
        "total_deposited": total_deposited,
        "total_withdrawn": total_withdrawn,
        "total_capital_in": total_capital_in,
        "current_cash": current_cash,
        "held_market_value": round(held_market_value, 2),
        "total_current_value": round(total_current_value, 2),
        "realized_pnl": round(realized_pnl, 2),
        "unrealized_pnl": round(unrealized_pnl, 2),
        "total_pnl": round(total_pnl, 2),
        "total_pnl_pct": round((total_pnl / total_capital_in) * 100, 2) if total_capital_in > 0 else 0,
        "total_trades": len(buys) + len(sells),
        "total_buys": len(buys),
        "total_sells": len(sells),
    }


@router.post("/reset")
def reset_portfolio(db: Session = Depends(get_db)):
    """Clear ALL data and start fresh with $10,000."""
    # Delete all records from all tables
    db.query(models.TransactionOverview).delete()
    db.query(models.Asset).delete()
    db.query(models.SystemLogs).delete()
    db.query(models.ChatHistory).delete()
    # Don't delete knowledge documents — knowledge persists across resets
    
    # Reset wallet to initial balance
    wallet = db.query(models.PortfolioWallet).first()
    if wallet:
        wallet.balance = 10000.0
    else:
        db.add(models.PortfolioWallet(balance=10000.0))
    
    db.commit()
    return {
        "status": "success",
        "message": "Portfolio reset. All trades cleared. Wallet set to $10,000.00. Knowledge base preserved.",
        "balance": 10000.0,
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
    import random
    import pandas as pd
    try:
        url = f"https://finnhub.io/api/v1/quote?symbol={symbol}&token={FINNHUB_KEY}"
        res = requests.get(url, timeout=5, verify=False)
        latest_price = round(float(res.json().get("c", 0.0)), 2)
        if latest_price <= 0.0:
            latest_price = 150.0
    except Exception:
        latest_price = 150.0

    # Fetch recent price history (30 days)
    price_history_str = ""
    rsi_val = 50.0
    macd_val = 0.0
    try:
        hist_url = f"https://query1.finance.yahoo.com/v8/finance/chart/{symbol}?range=1mo&interval=1d"
        hist_res = requests.get(hist_url, headers={'User-Agent': 'Mozilla/5.0'}, verify=False, timeout=8)
        if hist_res.status_code == 200:
            hist_data = hist_res.json()
            result = hist_data.get("chart", {}).get("result", [])
            if result:
                closes = result[0].get("indicators", {}).get("quote", [{}])[0].get("close", [])
                valid_closes = [round(c, 2) for c in closes if c is not None]
                if len(valid_closes) >= 5:
                    price_history_str = ", ".join(f"${p}" for p in valid_closes[-15:])
                    # Calculate RSI and MACD
                    close_series = pd.Series(valid_closes)
                    if len(close_series) >= 14:
                        delta = close_series.diff()
                        gain = delta.where(delta > 0, 0).rolling(14).mean()
                        loss = (-delta.where(delta < 0, 0)).rolling(14).mean()
                        rs = gain / loss
                        rsi = 100 - (100 / (1 + rs))
                        rsi_val = round(float(rsi.iloc[-1]), 2) if not pd.isna(rsi.iloc[-1]) else 50.0
                    if len(close_series) >= 26:
                        ema12 = close_series.ewm(span=12, adjust=False).mean()
                        ema26 = close_series.ewm(span=26, adjust=False).mean()
                        macd_val = round(float((ema12 - ema26).iloc[-1]), 4)
    except Exception:
        pass

    # Fetch sentiment data
    sentiment_str = "neutral (no data)"
    try:
        from trading_engine.sentiment import SentimentAnalyst
        import asyncio
        analyst = SentimentAnalyst.get_instance()
        loop = asyncio.new_event_loop()
        sent_result = loop.run_until_complete(analyst.analyze_news_async(symbol, limit=8))
        loop.close()
        sentiment_str = f"{sent_result.get('avg_sentiment', 'neutral')} (score: {sent_result.get('avg_score', 0):.3f}, positive: {sent_result.get('positive_ratio', 0):.0%}, negative: {sent_result.get('negative_ratio', 0):.0%})"
    except Exception:
        pass

    prompt = (
        f"Analyze stock {symbol} for a 1-month (20 trading days) price prediction.\n\n"
        f"Current price: ${latest_price}\n"
        f"Recent daily closes (last 15 days): {price_history_str if price_history_str else 'unavailable'}\n"
        f"RSI (14-day): {rsi_val}\n"
        f"MACD: {macd_val}\n"
        f"News sentiment: {sentiment_str}\n\n"
        "Based on the technical indicators, price trend, and sentiment:\n"
        "- If RSI > 70: stock is overbought, predict pullback/consolidation\n"
        "- If RSI < 30: stock is oversold, predict recovery/bounce\n"
        "- If sentiment is positive: bias predictions upward\n"
        "- If sentiment is negative: bias predictions downward\n"
        "- MACD positive: bullish momentum. MACD negative: bearish momentum\n\n"
        "Generate a REALISTIC 20-day price trajectory. Prices should NOT follow a simple linear trend.\n"
        "Include natural volatility (small daily fluctuations of 0.2-2%).\n\n"
        "Respond with ONLY a JSON object with key 'predictions' containing an array of exactly 20 numbers.\n"
        'Example: {"predictions": [151.2, 149.8, 152.5, ...]}'
    )
    try:
        res = requests.post(f"{OLLAMA_URL}/api/generate",
            json={"model": "llama3.2", "prompt": prompt, "format": "json", "stream": False}, timeout=30)
        raw_resp = res.json().get("response", "{}")
        parsed = json.loads(raw_resp)
        # Handle both {"predictions": [...]} and direct array [...]
        if isinstance(parsed, dict):
            prediction_arr = parsed.get("predictions", parsed.get("prices", []))
        elif isinstance(parsed, list):
            prediction_arr = parsed
        else:
            prediction_arr = []
        if not isinstance(prediction_arr, list) or len(prediction_arr) < 5:
            raise ValueError("not enough predictions")
        # Ensure all values are numbers
        prediction_arr = [float(p) for p in prediction_arr[:20]]
    except Exception:
        # Improved fallback: random walk with sentiment and RSI bias
        import random
        bias = 0.0
        # Sentiment bias
        if "positive" in sentiment_str:
            bias += 0.003
        elif "negative" in sentiment_str:
            bias -= 0.002
        # RSI bias
        if rsi_val > 70:
            bias -= 0.002  # overbought, expect pullback
        elif rsi_val < 30:
            bias += 0.003  # oversold, expect bounce
        # MACD bias
        if macd_val > 0:
            bias += 0.001
        elif macd_val < 0:
            bias -= 0.001

        prediction_arr = []
        price = latest_price
        for i in range(20):
            daily_change = random.gauss(bias, 0.012)  # ~1.2% daily volatility
            price = price * (1 + daily_change)
            prediction_arr.append(round(price, 2))

    return {
        "symbol": symbol,
        "current_price": latest_price,
        "rsi": rsi_val,
        "macd": macd_val,
        "sentiment": sentiment_str,
        "predictions": [{"step": i + 1, "predicted_price": round(float(p), 2)} for i, p in enumerate(prediction_arr)],
    }


# ── Manual Trade ──────────────────────────────────────────────────────────────
@router.post("/manual-trade")
def manual_trade(symbol: str, action: str, amount: float, amount_type: str = "dollars", db: Session = Depends(get_db)):
    """Execute a manual buy/sell trade.
    amount_type: 'dollars' or 'shares'
    """
    symbol = symbol.upper()
    action = action.upper()
    if action not in ["BUY", "SELL"]:
        raise HTTPException(status_code=400, detail="Action must be BUY or SELL")
    if amount <= 0:
        raise HTTPException(status_code=400, detail="Amount must be greater than 0")

    wallet = db.query(models.PortfolioWallet).first()
    if not wallet:
        raise HTTPException(status_code=400, detail="No wallet found")

    # Fetch live price
    try:
        url = f"https://finnhub.io/api/v1/quote?symbol={symbol}&token={FINNHUB_KEY}"
        res = requests.get(url, timeout=5, verify=False)
        price = float(res.json().get("c", 0.0))
        if price <= 0:
            raise ValueError("Zero price")
    except Exception:
        raise HTTPException(status_code=400, detail=f"Could not fetch live price for {symbol}")

    asset = db.query(models.Asset).filter(models.Asset.symbol == symbol).first()

    if action == "BUY":
        if amount_type == "shares":
            qty = amount
            cash_needed = qty * price
        else:
            cash_needed = amount
            qty = cash_needed / price

        if cash_needed > wallet.balance:
            raise HTTPException(status_code=400, detail=f"Insufficient balance. Need ${cash_needed:.2f}, have ${wallet.balance:.2f}")

        wallet.balance -= cash_needed
        if not asset:
            asset = models.Asset(symbol=symbol, quantity=0.0, average_price=0.0)
            db.add(asset)
        total_cost = (asset.quantity * asset.average_price) + cash_needed
        asset.quantity += qty
        asset.average_price = total_cost / asset.quantity if asset.quantity > 0 else price

        db.add(models.TransactionOverview(
            symbol=symbol, transaction_type="BUY", quantity=qty, price=price,
            reasoning=f"Manual buy: {qty:.4f} shares at ${price:.2f}"
        ))

    elif action == "SELL":
        if not asset or asset.quantity <= 0:
            raise HTTPException(status_code=400, detail=f"No holdings of {symbol} to sell")

        if amount_type == "shares":
            qty = min(amount, asset.quantity)
        else:
            qty = min(amount / price, asset.quantity)

        cash_gained = qty * price
        wallet.balance += cash_gained
        asset.quantity -= qty
        if asset.quantity <= 0.001:
            asset.quantity = 0.0

        db.add(models.TransactionOverview(
            symbol=symbol, transaction_type="SELL", quantity=qty, price=price,
            reasoning=f"Manual sell: {qty:.4f} shares at ${price:.2f}"
        ))

    db.commit()
    return {
        "status": "success",
        "action": action,
        "symbol": symbol,
        "quantity": round(qty, 4),
        "price": price,
        "total": round(qty * price, 2),
        "wallet_balance": wallet.balance,
    }

