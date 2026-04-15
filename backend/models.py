from sqlalchemy import Column, Integer, String, Float, DateTime, Boolean, ForeignKey
from sqlalchemy.orm import relationship
from datetime import datetime, timezone
from database import Base

class PortfolioWallet(Base):
    __tablename__ = "portfolio_wallet"
    id = Column(Integer, primary_key=True, index=True)
    balance = Column(Float, default=10000.0) # Requested initial balance

class TrackedStock(Base):
    __tablename__ = "tracked_stocks"
    id = Column(Integer, primary_key=True, index=True)
    symbol = Column(String, unique=True, index=True)
    is_active = Column(Boolean, default=True)

class Asset(Base):
    __tablename__ = "assets"
    id = Column(Integer, primary_key=True, index=True)
    symbol = Column(String, unique=True, index=True)
    quantity = Column(Float, default=0.0)
    average_price = Column(Float, default=0.0)

class TransactionOverview(Base):
    __tablename__ = "transactions"
    id = Column(Integer, primary_key=True, index=True)
    timestamp = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    symbol = Column(String, index=True)
    transaction_type = Column(String) # 'BUY', 'SELL', 'FUNDS_ADDED', 'FUNDS_WITHDRAWN'
    quantity = Column(Float)
    price = Column(Float)
    reasoning = Column(String, nullable=True) # deepseek reasoning output

class SystemLogs(Base):
    __tablename__ = "system_logs"
    id = Column(Integer, primary_key=True, index=True)
    timestamp = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    level = Column(String) # INFO, WARNING, CRITICAL
    message = Column(String)

class ChatHistory(Base):
    __tablename__ = "chat_history"
    id = Column(Integer, primary_key=True, index=True)
    timestamp = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    sender = Column(String) # ai or user
    text = Column(String)

class KnowledgeDocument(Base):
    __tablename__ = "knowledge_documents"
    id = Column(Integer, primary_key=True, index=True)
    filename = Column(String)
    content = Column(String)  # extracted text content
    uploaded_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
