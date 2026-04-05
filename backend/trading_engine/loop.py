import requests
import urllib3
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)
import json
import re
import os
import asyncio
import uuid
from typing import TypedDict, Literal, List, Dict
from sqlalchemy.orm import Session
from database import SessionLocal
import models
from langgraph.graph import StateGraph, START, END
from dotenv import load_dotenv

load_dotenv()
FINNHUB_KEY = os.getenv("FINNHUB_API_KEY", "d6psvfpr01qk0cf1ql00d6psvfpr01qk0cf1ql0g")
OLLAMA_URL  = os.getenv("OLLAMA_BASE_URL", "http://127.0.0.1:11434")

# Detect available models at startup and pick the best ones
def _detect_models():
    try:
        r = requests.get(f"{OLLAMA_URL}/api/tags", timeout=5, verify=False)
        available = [m["name"].split(":")[0] for m in r.json().get("models", [])]
        print(f"[Loop] Ollama models available: {available}")
        # Portfolio manager: prefer llama3.2 (reliable JSON), then qwen3, then deepseek-r1
        pm = next((m for m in ["llama3.2", "qwen3", "deepseek-r1"] if m in available), available[0] if available else "llama3.2")
        # Technical analyst: same preference
        ta = next((m for m in ["llama3.2", "qwen3", "deepseek-r1"] if m in available), pm)
        print(f"[Loop] Using — Portfolio Manager: {pm} | Technical Analyst: {ta}")
        return pm, ta
    except Exception as e:
        print(f"[Loop] Could not detect Ollama models: {e}. Using llama3.2 defaults.")
        return "llama3.2", "llama3.2"

PORTFOLIO_MODEL, TECHNICAL_MODEL = _detect_models()

# ── In-memory job store ───────────────────────────────────────────────────────
# { job_id: { "status": "pending"|"running"|"done"|"error", "result": [...], "message": "" } }
_jobs: Dict[str, dict] = {}

def get_job(job_id: str) -> dict:
    return _jobs.get(job_id, {"status": "not_found", "result": [], "message": ""})


class PortfolioState(TypedDict):
    wallet_balance: float
    tracked_symbols: List[str]
    assets: Dict[str, float]
    market_data: Dict[str, dict]
    sentiment_data: Dict[str, dict]
    llama_ta: Dict[str, dict]
    deepseek_plan: List[dict]
    execution_status: str
    objective: str
    objective_amount: float


# ── Data fetching ─────────────────────────────────────────────────────────────
async def fetch_finnhub_quote(smb: str):
    url = f"https://finnhub.io/api/v1/quote?symbol={smb}&token={FINNHUB_KEY}"
    try:
        res = await asyncio.to_thread(requests.get, url, timeout=10, verify=False)
        d = res.json()
        return smb, {"price": d.get("c", 0.0), "high": d.get("h", 0.0),
                     "low": d.get("l", 0.0), "open": d.get("o", 0.0), "pc": d.get("pc", 0.0)}
    except Exception:
        return smb, {"price": 0.0, "high": 0.0, "low": 0.0, "open": 0.0, "pc": 0.0}


# ── LangGraph nodes ───────────────────────────────────────────────────────────
async def fetch_market_data(state: PortfolioState) -> PortfolioState:
    tasks = [fetch_finnhub_quote(smb) for smb in state["tracked_symbols"]]
    finnhub_results = await asyncio.gather(*tasks)

    def calc_technicals():
        metrics = {}
        import time
        import pandas as pd
        end_time = int(time.time())
        start_time = end_time - 90 * 86400  # 3 months
        
        for smb in state["tracked_symbols"]:
            metrics[smb] = {"rsi": 50.0, "macd": 0.0, "yf_price": 0.0}
            try:
                url = f"https://query1.finance.yahoo.com/v8/finance/chart/{smb}?range=3mo&interval=1d"
                res = requests.get(url, headers={'User-Agent': 'Mozilla/5.0'}, verify=False, timeout=5)
                if res.status_code == 200:
                    d = res.json()
                    result = d.get("chart", {}).get("result", [])
                    if result:
                        closes = result[0].get("indicators", {}).get("quote", [{}])[0].get("close", [])
                        valid_closes = [c for c in closes if c is not None]
                        close = pd.Series(valid_closes)
                        if len(close) < 15:
                            continue
                        delta = close.diff()
                        gain  = delta.where(delta > 0, 0).rolling(14).mean()
                        loss  = (-delta.where(delta < 0, 0)).rolling(14).mean()
                        rsi   = 100 - (100 / (1 + gain / loss))
                        ema12 = close.ewm(span=12, adjust=False).mean()
                        ema26 = close.ewm(span=26, adjust=False).mean()
                        metrics[smb]["rsi"]      = round(float(rsi.iloc[-1]), 2)
                        metrics[smb]["macd"]     = round(float((ema12 - ema26).iloc[-1]), 4)
                        metrics[smb]["yf_price"] = round(float(close.iloc[-1]), 2)
            except Exception:
                pass
        return metrics

    technicals = await asyncio.to_thread(calc_technicals)

    state["market_data"] = {}
    for smb, quote in finnhub_results:
        t = technicals.get(smb, {"rsi": 50.0, "macd": 0.0, "yf_price": 0.0})
        price = quote["price"] if quote["price"] > 0 else t.get("yf_price", 0.0)
        state["market_data"][smb] = {
            "price": price,
            "high":  quote["high"]  if quote["high"]  > 0 else price,
            "low":   quote["low"]   if quote["low"]   > 0 else price,
            "open":  quote["open"]  if quote["open"]  > 0 else price,
            "pc":    quote["pc"]    if quote["pc"]    > 0 else price,
            "rsi":   t["rsi"],
            "macd":  t["macd"],
        }
    return state


async def analyze_sentiment_node(state: PortfolioState) -> PortfolioState:
    from trading_engine.sentiment import SentimentAnalyst
    analyst = SentimentAnalyst.get_instance()
    results = await asyncio.gather(
        *[analyst.analyze_news_async(smb, limit=5) for smb in state["tracked_symbols"]]
    )
    state["sentiment_data"] = {r["ticker"]: r for r in results}
    return state


async def analyze_with_llama(state: PortfolioState) -> PortfolioState:
    lines = "\n".join(
        f"- {s}: Price=${d['price']}, RSI={d['rsi']}, MACD={d['macd']}"
        for s, d in state["market_data"].items()
    )
    prompt = (
        f"Evaluate technical indicators for these stocks:\n{lines}\n"
        'Output ONLY valid JSON: {"MSFT": {"trend": "bullish", "rsi": 60, "macd_signal": "positive"}}'
    )
    try:
        res = await asyncio.to_thread(
            requests.post, f"{OLLAMA_URL}/api/generate",
            json={"model": TECHNICAL_MODEL, "prompt": prompt, "format": "json", "stream": False},
            timeout=90
        )
        llama_metrics = json.loads(res.json().get("response", "{}"))
    except Exception:
        llama_metrics = {}

    state["llama_ta"] = {
        smb: llama_metrics.get(smb, {"trend": "neutral", "rsi": 50, "macd_signal": "unknown"})
        for smb in state["tracked_symbols"]
    }
    return state


async def reason_with_deepseek(state: PortfolioState) -> PortfolioState:
    report = "PORTFOLIO REPORT:\n"
    for smb in state["tracked_symbols"]:
        md  = state["market_data"].get(smb, {})
        sen = state["sentiment_data"].get(smb, {})
        tec = state["llama_ta"].get(smb, {})
        report += (
            f"[{smb}] ${md.get('price',0):.2f} | "
            f"Sentiment Score: {sen.get('avg_score',0.0):.4f} | "
            f"Trend: {tec.get('trend','neutral')} RSI:{tec.get('rsi',50)}\n"
        )

    override_val = state.get("objective_amount", 0.0)
    if state.get("objective") == "INVEST":
        directive = (
            f"You MUST BUY stocks totalling exactly ${override_val:.2f}. "
            "Pick the best opportunities. Return percentage splits that sum to 100."
        )
    elif state.get("objective") == "WITHDRAW":
        directive = (
            f"You MUST SELL holdings totalling exactly ${override_val:.2f}. "
            "Pick the weakest positions. Return percentage splits that sum to 100."
        )
    else:
        directive = "Distribute capital strategically to hedge risk and catch momentum."

    prompt = (
        f"You are a Portfolio Manager. {directive}\n\n"
        f"{report}\n"
        f"Wallet: ${state['wallet_balance']:.2f}. Holdings: {state['assets']}\n\n"
        "Respond with ONLY a valid JSON array of objects. Use curly braces for each object.\n"
        'REQUIRED FORMAT (copy exactly): [{"symbol":"MSFT","action":"BUY","percentage":60,"reasoning":"reason"},{"symbol":"GOOGL","action":"BUY","percentage":40,"reasoning":"reason"}]\n'
        "Rules: action must be BUY or SELL. All BUY percentages must sum to 100. No markdown, no explanation, no text outside the JSON array."
    )

    try:
        res = await asyncio.to_thread(
            requests.post, f"{OLLAMA_URL}/api/generate",
            json={"model": PORTFOLIO_MODEL, "prompt": prompt, "stream": False},
            timeout=300
        )
        raw = res.json().get("response", "[]")
        print(f"[Portfolio/{PORTFOLIO_MODEL}] Raw (first 400): {raw[:400]}")

        # 1. Strip think tags — but keep content inside as fallback
        think_content = ""
        think_match = re.search(r"<think>(.*?)</think>", raw, flags=re.DOTALL)
        if think_match:
            think_content = think_match.group(1)
        clean = re.sub(r"<think>.*?</think>", "", raw, flags=re.DOTALL).strip()

        # If nothing outside think tags, search inside them
        search_text = clean if clean else think_content

        # 2. Find a JSON array — use greedy match to capture full array
        # First try a proper array with objects: [{...}]
        m = re.search(r"\[\s*\{.*\}\s*\]", search_text, flags=re.DOTALL)
        if not m:
            # Try any array
            m = re.search(r"\[.*\]", search_text, flags=re.DOTALL)
        if not m:
            # Try to reconstruct from individual objects
            objects = re.findall(r'\{[^{}]+\}', search_text, flags=re.DOTALL)
            if objects:
                search_text = "[" + ",".join(objects) + "]"
                m = re.search(r"\[.*\]", search_text, flags=re.DOTALL)

        if m:
            raw_json = m.group(0)
            # Sanitize: remove literal newlines inside JSON strings that break json.loads
            raw_json = re.sub(r'(?<=:)\s*"([^"]*)"', lambda x: '"' + x.group(1).replace('\n', ' ').replace('\r', '') + '"', raw_json)
            try:
                data = json.loads(raw_json)
            except json.JSONDecodeError:
                # Fallback: extract individual valid objects
                objects = re.findall(r'\{[^{}]+\}', raw_json, flags=re.DOTALL)
                data = []
                for obj in objects:
                    try:
                        # Clean newlines inside each object too
                        obj_clean = re.sub(r'\n', ' ', obj)
                        data.append(json.loads(obj_clean))
                    except Exception:
                        pass
        else:
            data = []

        print(f"[Portfolio/{PORTFOLIO_MODEL}] Parsed {len(data)} decisions: {data}")
        state["deepseek_plan"] = data if isinstance(data, list) else []
    except Exception as e:
        print(f"[Portfolio] Exception: {e}")
        state["deepseek_plan"] = []

    state["execution_status"] = "PROCEED"
    return state


async def execute_trade_node(state: PortfolioState) -> PortfolioState:
    state["execution_status"] = "PROCEED"
    return state


def should_execute(state: PortfolioState) -> Literal["execute_trade", "__end__"]:
    return "execute_trade" if state["deepseek_plan"] else "__end__"


# ── Compile graph ─────────────────────────────────────────────────────────────
workflow = StateGraph(PortfolioState)
workflow.add_node("fetch_market",    fetch_market_data)
workflow.add_node("sentiment_node",  analyze_sentiment_node)
workflow.add_node("analyze_llama",   analyze_with_llama)
workflow.add_node("reason_deepseek", reason_with_deepseek)
workflow.add_node("execute_trade",   execute_trade_node)
workflow.add_edge(START, "fetch_market")
workflow.add_edge("fetch_market",    "sentiment_node")
workflow.add_edge("sentiment_node",  "analyze_llama")
workflow.add_edge("analyze_llama",   "reason_deepseek")
workflow.add_conditional_edges("reason_deepseek", should_execute)
workflow.add_edge("execute_trade",   END)
graph = workflow.compile()


# ── Core execution ────────────────────────────────────────────────────────────
async def process_portfolio_async(db: Session, objective: str = "", target_amount: float = 0.0):
    wallet  = db.query(models.PortfolioWallet).first()
    if not wallet:
        return []
    tracked = db.query(models.TrackedStock).filter(models.TrackedStock.is_active == True).all()
    if not tracked:
        return []

    symbols   = [t.symbol.upper() for t in tracked]
    asset_map = {a.symbol.upper(): a.quantity for a in db.query(models.Asset).all()}

    if objective == "INVEST" and target_amount > wallet.balance:
        target_amount = wallet.balance
    if objective == "WITHDRAW" and target_amount <= 0:
        return []

    initial_state = PortfolioState(
        wallet_balance=wallet.balance, tracked_symbols=symbols, assets=asset_map,
        market_data={}, sentiment_data={}, llama_ta={}, deepseek_plan=[],
        execution_status="", objective=objective, objective_amount=target_amount,
    )

    final_state = await graph.ainvoke(initial_state)
    db.refresh(wallet)

    plan = final_state.get("deepseek_plan", [])
    if not plan or final_state.get("execution_status") != "PROCEED":
        return []

    buys  = [d for d in plan if str(d.get("action","")).upper() == "BUY"]
    sells = [d for d in plan if str(d.get("action","")).upper() == "SELL"]
    total_buy_pct  = sum(float(d.get("percentage", 0)) for d in buys)  or 1
    total_sell_pct = sum(float(d.get("percentage", 0)) for d in sells) or 1

    executed = []
    for decision in plan:
        action     = str(decision.get("action", "HOLD")).upper()
        percentage = float(decision.get("percentage", 0))
        symbol     = str(decision.get("symbol", "")).upper()
        reasoning  = str(decision.get("reasoning", ""))

        if symbol not in symbols or percentage <= 0 or action not in ["BUY", "SELL"]:
            continue

        # Price: prefer live market_data, fallback to Finnhub quote
        execute_price = final_state["market_data"].get(symbol, {}).get("price", 0.0)
        if execute_price <= 0:
            try:
                url = f"https://finnhub.io/api/v1/quote?symbol={symbol}&token={FINNHUB_KEY}"
                res = requests.get(url, timeout=5, verify=False)
                if res.status_code == 200:
                    execute_price = float(res.json().get("c", 0.0))
            except Exception:
                execute_price = 0.0
        if execute_price <= 0:
            print(f"[SKIP] {symbol}: no price available")
            continue

        asset = db.query(models.Asset).filter(models.Asset.symbol == symbol).first()
        qty   = 0.0

        if action == "BUY":
            if objective == "INVEST" and target_amount > 0:
                cash = target_amount * (percentage / total_buy_pct)
            else:
                cash = wallet.balance * (percentage / 100.0)
            cash = min(cash, wallet.balance)
            if cash <= 0:
                continue
            qty = cash / execute_price
            wallet.balance -= cash
            if not asset:
                asset = models.Asset(symbol=symbol, quantity=0.0, average_price=0.0)
                db.add(asset)
            total_cost = (asset.quantity * asset.average_price) + cash
            asset.quantity    += qty
            asset.average_price = total_cost / asset.quantity

        elif action == "SELL":
            if not asset or asset.quantity <= 0:
                continue
            if objective == "WITHDRAW" and target_amount > 0:
                cash_needed = target_amount * (percentage / total_sell_pct)
                qty = min(cash_needed / execute_price, asset.quantity)
            else:
                qty = asset.quantity * (percentage / 100.0)
            if qty <= 0:
                continue
            wallet.balance  += qty * execute_price
            asset.quantity  -= qty
            if asset.quantity <= 0.001:
                asset.quantity = 0.0

        if qty > 0:
            db.add(models.TransactionOverview(
                symbol=symbol, transaction_type=action,
                quantity=qty, price=execute_price, reasoning=reasoning,
            ))
            db.add(models.SystemLogs(
                level="INFO",
                message=f"[{objective or 'AUTO'}] {action} {qty:.4f} {symbol} @ ${execute_price:.2f}",
            ))
            executed.append({
                **decision,
                "executed_qty": round(qty, 4),
                "executed_price": execute_price,
            })

    db.commit()
    return executed


# ── Background job runner ─────────────────────────────────────────────────────
def _run_job(job_id: str, objective: str, target_amount: float):
    """Runs in a thread via asyncio.run so it doesn't block FastAPI's event loop."""
    _jobs[job_id]["status"] = "running"
    db = SessionLocal()
    try:
        result = asyncio.run(process_portfolio_async(db, objective, target_amount))
        _jobs[job_id]["status"]  = "done"
        _jobs[job_id]["result"]  = result
        _jobs[job_id]["message"] = f"Executed {len(result)} trade(s)."
    except Exception as e:
        _jobs[job_id]["status"]  = "error"
        _jobs[job_id]["message"] = str(e)
    finally:
        db.close()


def start_job(objective: str, target_amount: float) -> str:
    """Kick off a background job and return its ID immediately."""
    import threading
    job_id = str(uuid.uuid4())[:8]
    _jobs[job_id] = {"status": "pending", "result": [], "message": "Queued"}
    t = threading.Thread(target=_run_job, args=(job_id, objective, target_amount), daemon=True)
    t.start()
    return job_id


def run_trading_cycle():
    """Called by APScheduler — runs in its own thread already."""
    db = SessionLocal()
    try:
        asyncio.run(process_portfolio_async(db))
    finally:
        db.close()
