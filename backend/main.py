from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from apscheduler.schedulers.background import BackgroundScheduler
import os
from dotenv import load_dotenv

load_dotenv()
from database import engine, Base
from routers import portfolio, llm_chat, knowledge, news
import models

# Create database tables
Base.metadata.create_all(bind=engine)

app = FastAPI(title="Portfolio Management API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.on_event("startup")
def startup_event():
    from database import SessionLocal
    db = SessionLocal()
    # Seed all tracked stocks — all are active (no buffer distinction)
    all_stocks = ["MSFT", "GOOGL", "ADBE", "JPM", "BAC", "XOM", "LMT", "NOC", "JNJ", "PFE", "AMZN", "INTC"]
    for symbol in all_stocks:
        existing = db.query(models.TrackedStock).filter(models.TrackedStock.symbol == symbol).first()
        if not existing:
            db.add(models.TrackedStock(symbol=symbol, is_active=True))
        elif not existing.is_active:
            # Activate any previously inactive "buffer" stocks
            existing.is_active = True
    db.commit()
    db.close()

    from trading_engine.loop import run_trading_cycle
    from apscheduler.schedulers.background import BackgroundScheduler
    scheduler = BackgroundScheduler()
    scheduler.add_job(run_trading_cycle, 'interval', minutes=30)
    scheduler.start()

app.include_router(portfolio.router, prefix="/api/portfolio")
app.include_router(llm_chat.router, prefix="/api/chat")
app.include_router(knowledge.router, prefix="/api/knowledge")
app.include_router(news.router, prefix="/api/news")

@app.get("/")
def health_check():
    return {"status": "ok", "message": "API Running"}


