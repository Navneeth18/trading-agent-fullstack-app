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
        held_qty = state["assets"].get(smb, 0)
        held_val = held_qty * md.get('price', 0) if held_qty > 0 else 0
        report += (
            f"[{smb}] Price=${md.get('price',0):.2f} | "
            f"RSI={md.get('rsi',50):.1f} MACD={md.get('macd',0):.4f} | "
            f"Sentiment={sen.get('avg_score',0.0):.4f} ({sen.get('avg_sentiment','neutral')}) | "
            f"Trend={tec.get('trend','neutral')} | "
            f"Held={held_qty:.2f} shares (${held_val:.2f})\n"
        )

    override_val = state.get("objective_amount", 0.0)
    objective = state.get("objective", "")

    if objective == "INVEST":
        forced_action = "BUY"
        directive = (
            f"You MUST deploy exactly ${override_val:.2f} by BUYING stocks. "
            "Pick the best opportunities from the tracked stocks above. "
            "ALL actions MUST be BUY. Return percentage splits that sum to EXACTLY 100. "
            "For example if you want 60% in MSFT and 40% in GOOGL, percentages are 60 and 40."
        )
    elif objective == "WITHDRAW":
        forced_action = "SELL"
        directive = (
            f"You MUST liquidate exactly ${override_val:.2f} worth of holdings by SELLING stocks. "
            "Pick positions to sell from the held stocks above: " +
            ", ".join(f"{s}({state['assets'].get(s,0):.2f} shares)" for s in state["tracked_symbols"] if state["assets"].get(s, 0) > 0) + ". "
            "ALL actions MUST be SELL. Return percentage splits that sum to EXACTLY 100. "
            "Each percentage represents that fraction of the total $" + f"{override_val:.2f}" + " to sell from that stock."
        )
    else:
        forced_action = None
        directive = "Distribute capital strategically to hedge risk and catch momentum."

    # Load knowledge base context for decision-making
    knowledge_section = ""
    try:
        from routers.knowledge import get_knowledge_context
        kb_db = SessionLocal()
        kb_text = get_knowledge_context(kb_db, max_chars=2000)
        kb_db.close()
        if kb_text:
            knowledge_section = (
                "\n\nTRADING PRINCIPLES (from Knowledge Base — you MUST follow these):\n"
                f"{kb_text}\n"
                "Apply the above principles when making your trading decisions.\n"
            )
    except Exception as e:
        print(f"[Portfolio] Knowledge base load failed: {e}")

    prompt = (
        f"You are a Portfolio Manager. {directive}\n\n"
        f"{report}\n"
        f"Wallet Cash: ${state['wallet_balance']:.2f}.\n"
        f"{knowledge_section}\n"
        "CRITICAL: You MUST respond with ONLY a valid JSON array. No other text.\n"
        "Each object MUST have ALL four fields: symbol, action, percentage, reasoning.\n"
        "The 'reasoning' field MUST contain a detailed 1-2 sentence explanation of WHY this trade.\n\n"
        'EXACT FORMAT: [{"symbol":"MSFT","action":"BUY","percentage":60,"reasoning":"Strong RSI momentum at 65 with positive sentiment score of 0.4, indicating bullish continuation"},{"symbol":"GOOGL","action":"BUY","percentage":40,"reasoning":"Undervalued with negative MACD divergence suggesting reversal"}]\n\n'
        "Rules:\n"
        f"- action must be {forced_action if forced_action else 'BUY or SELL'}\n"
        "- All percentages MUST sum to exactly 100\n"
        "- reasoning MUST be a non-empty descriptive string explaining the trade rationale\n"
        "- No markdown, no explanation, no text outside the JSON array\n"
        "- Only use symbols from the portfolio report above"
    )

    think_content = ""
    try:
        res = await asyncio.to_thread(
            requests.post, f"{OLLAMA_URL}/api/generate",
            json={"model": PORTFOLIO_MODEL, "prompt": prompt, "stream": False},
            timeout=300
        )
        raw = res.json().get("response", "[]")
        print(f"[Portfolio/{PORTFOLIO_MODEL}] Raw (first 500): {raw[:500]}")

        # 1. Strip think tags — but keep content inside as fallback reasoning
        think_match = re.search(r"<think>(.*?)</think>", raw, flags=re.DOTALL)
        if think_match:
            think_content = think_match.group(1).strip()
        clean = re.sub(r"<think>.*?</think>", "", raw, flags=re.DOTALL).strip()

        # If nothing outside think tags, search inside them
        search_text = clean if clean else think_content

        # 2. Find a JSON array
        m = re.search(r"\[\s*\{.*\}\s*\]", search_text, flags=re.DOTALL)
        if not m:
            m = re.search(r"\[.*\]", search_text, flags=re.DOTALL)
        if not m:
            objects = re.findall(r'\{[^{}]+\}', search_text, flags=re.DOTALL)
            if objects:
                search_text = "[" + ",".join(objects) + "]"
                m = re.search(r"\[.*\]", search_text, flags=re.DOTALL)

        if m:
            raw_json = m.group(0)
            raw_json = re.sub(r'(?<=:)\s*"([^"]*)"', lambda x: '"' + x.group(1).replace('\n', ' ').replace('\r', '') + '"', raw_json)
            try:
                data = json.loads(raw_json)
            except json.JSONDecodeError:
                objects = re.findall(r'\{[^{}]+\}', raw_json, flags=re.DOTALL)
                data = []
                for obj in objects:
                    try:
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

    # ── Post-process: normalize reasoning key and force action direction ──
    plan = state["deepseek_plan"]
    for d in plan:
        # Handle both "reason" and "reasoning" keys
        if "reason" in d and "reasoning" not in d:
            d["reasoning"] = d.pop("reason")
        # Ensure reasoning is non-empty; use think content as fallback
        if not d.get("reasoning") or str(d["reasoning"]).strip() == "":
            symbol = d.get("symbol", "")
            md = state["market_data"].get(symbol, {})
            sen = state["sentiment_data"].get(symbol, {})
            d["reasoning"] = (
                f"AI decision based on RSI={md.get('rsi',50):.1f}, "
                f"MACD={md.get('macd',0):.4f}, "
                f"sentiment={sen.get('avg_score',0):.2f} ({sen.get('avg_sentiment','neutral')})"
            )
            if think_content:
                # Try to extract symbol-specific reasoning from think content
                sym_reason = re.search(rf"{symbol}[^.]*\.", think_content)
                if sym_reason:
                    d["reasoning"] = sym_reason.group(0).strip()

    # Force action direction for objective-based trades
    if forced_action:
        plan = [d for d in plan if str(d.get("action", "")).upper() == forced_action
                or str(d.get("action", "")).upper() not in ["BUY", "SELL"]]
        for d in plan:
            d["action"] = forced_action

    # Re-normalize percentages to sum to exactly 100
    total_pct = sum(float(d.get("percentage", 0)) for d in plan)
    if plan and total_pct > 0 and abs(total_pct - 100) > 0.01:
        for d in plan:
            d["percentage"] = float(d.get("percentage", 0)) / total_pct * 100
        print(f"[Portfolio] Re-normalized percentages from {total_pct:.1f}% to 100%")

    state["deepseek_plan"] = plan
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

    # Percentages should already be normalized to 100 by reason_with_deepseek
    executed = []
    remaining_target = target_amount if target_amount > 0 else 0

    for decision in plan:
        action     = str(decision.get("action", "HOLD")).upper()
        percentage = float(decision.get("percentage", 0))
        symbol     = str(decision.get("symbol", "")).upper()
        reasoning  = str(decision.get("reasoning", "") or decision.get("reason", ""))

        # Ensure reasoning is never empty
        if not reasoning.strip():
            md = final_state["market_data"].get(symbol, {})
            sen = final_state["sentiment_data"].get(symbol, {})
            reasoning = f"AI trade: RSI={md.get('rsi',50):.1f}, sentiment={sen.get('avg_score',0):.2f}"

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
                cash = remaining_target * (percentage / 100.0) if remaining_target > 0 else 0
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
            if remaining_target > 0:
                remaining_target -= cash

        elif action == "SELL":
            if not asset or asset.quantity <= 0:
                continue
            if objective == "WITHDRAW" and remaining_target > 0:
                # Calculate how much cash we want from THIS stock
                cash_needed = remaining_target * (percentage / 100.0)
                qty = cash_needed / execute_price
                # Can't sell more than we hold
                qty = min(qty, asset.quantity)
            else:
                qty = asset.quantity * (percentage / 100.0)
            if qty <= 0:
                continue
            actual_cash = qty * execute_price
            wallet.balance  += actual_cash
            asset.quantity  -= qty
            if asset.quantity <= 0.001:
                asset.quantity = 0.0
            if remaining_target > 0:
                remaining_target -= actual_cash

        if qty > 0:
            db.add(models.TransactionOverview(
                symbol=symbol, transaction_type=action,
                quantity=qty, price=execute_price, reasoning=reasoning,
            ))
            db.add(models.SystemLogs(
                level="INFO",
                message=f"[{objective or 'AUTO'}] {action} {qty:.4f} {symbol} @ ${execute_price:.2f} | {reasoning[:80]}",
            ))
            executed.append({
                **decision,
                "executed_qty": round(qty, 4),
                "executed_price": execute_price,
                "reasoning": reasoning,
            })

    # ── Second pass: if withdraw target not fully met, sell more from held assets ──
    if objective == "WITHDRAW" and remaining_target > 1.0:
        print(f"[Portfolio] Shortfall after first pass: ${remaining_target:.2f}. Selling more to cover.")
        held_assets = db.query(models.Asset).filter(models.Asset.quantity > 0.001).all()
        # Calculate total held value
        total_held_value = 0.0
        asset_values = []
        for a in held_assets:
            p = final_state["market_data"].get(a.symbol, {}).get("price", 0.0)
            if p <= 0:
                try:
                    url = f"https://finnhub.io/api/v1/quote?symbol={a.symbol}&token={FINNHUB_KEY}"
                    r = requests.get(url, timeout=5, verify=False)
                    p = float(r.json().get("c", 0.0))
                except Exception:
                    continue
            if p <= 0:
                continue
            val = a.quantity * p
            total_held_value += val
            asset_values.append((a, p, val))

        for a, p, val in asset_values:
            if remaining_target <= 1.0:
                break
            # Sell proportionally: this asset's share of held value * remaining target
            sell_val = min(remaining_target, val)
            sell_qty = sell_val / p
            sell_qty = min(sell_qty, a.quantity)
            if sell_qty <= 0:
                continue
            actual = sell_qty * p
            wallet.balance += actual
            a.quantity -= sell_qty
            if a.quantity <= 0.001:
                a.quantity = 0.0
            remaining_target -= actual

            reasoning = f"Additional sell to meet withdrawal target (shortfall coverage)"
            db.add(models.TransactionOverview(
                symbol=a.symbol, transaction_type="SELL",
                quantity=sell_qty, price=p, reasoning=reasoning,
            ))
            db.add(models.SystemLogs(
                level="INFO",
                message=f"[WITHDRAW-EXTRA] SELL {sell_qty:.4f} {a.symbol} @ ${p:.2f} to cover shortfall",
            ))
            executed.append({
                "symbol": a.symbol, "action": "SELL",
                "executed_qty": round(sell_qty, 4),
                "executed_price": p,
                "reasoning": reasoning,
            })

    db.commit()
    total_executed_value = sum(e["executed_qty"] * e["executed_price"] for e in executed)
    print(f"[Portfolio] Executed {len(executed)} trades for objective={objective}, target=${target_amount:.2f}, actual=${total_executed_value:.2f}")
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
