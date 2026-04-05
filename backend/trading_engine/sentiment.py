import torch
from transformers import BertTokenizer, BertForSequenceClassification
import os
import asyncio
import re
from typing import Dict
from dotenv import load_dotenv

load_dotenv()

LOCAL_TARGET = "d:/Minor Project/project-2/TradingAgents/model/finbert"
MODEL_NAME = LOCAL_TARGET if os.path.exists(LOCAL_TARGET) else "ProsusAI/finbert"

class SentimentAnalyst:
    _instance = None

    @classmethod
    def get_instance(cls):
        if cls._instance is None:
            cls._instance = cls()
        return cls._instance

    def __init__(self):
        print(f"[SentimentAnalyst] Loading FinBERT from: {MODEL_NAME}")
        local_only = os.path.exists(LOCAL_TARGET)
        self.tokenizer = BertTokenizer.from_pretrained(MODEL_NAME, local_files_only=local_only)
        self.model = BertForSequenceClassification.from_pretrained(MODEL_NAME, local_files_only=local_only)
        self.model.eval()
        self.device = torch.device("cpu")
        self.model.to(self.device)
        self.labels = ['positive', 'negative', 'neutral']

    def analyze_headline(self, headline: str) -> Dict:
        inputs = self.tokenizer(headline, return_tensors="pt", truncation=True, max_length=512, padding=True)
        inputs = {k: v.to(self.device) for k, v in inputs.items()}
        with torch.no_grad():
            outputs = self.model(**inputs)
            probs = torch.nn.functional.softmax(outputs.logits, dim=-1)
        scores = {label: float(prob) for label, prob in zip(self.labels, probs[0])}
        sentiment = max(scores, key=scores.get)
        return {"sentiment": sentiment, "scores": scores, "confidence": scores[sentiment]}

    async def analyze_news_async(self, ticker: str, limit: int = 15) -> Dict:
        def fetch_and_score():
            import feedparser
            import requests
            import urllib3
            urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)
            from datetime import datetime, timedelta

            headlines = []

            # 1. Google News RSS
            try:
                feed = feedparser.parse(f"https://news.google.com/rss/search?q={ticker}+stock+news&hl=en-US")
                for entry in feed.entries[:10]:
                    title = entry.get("title", "")
                    # Strip source suffix like " - Reuters"
                    title = re.sub(r"\s[-|]\s[^-|]+$", "", title.strip())
                    if len(title) > 5:
                        headlines.append(title)
            except Exception:
                pass

            # 2. Finnhub company news (last 3 days)
            try:
                finnhub_key = os.getenv("FINNHUB_API_KEY", "")
                if finnhub_key:
                    end = datetime.now().strftime("%Y-%m-%d")
                    start = (datetime.now() - timedelta(days=3)).strftime("%Y-%m-%d")
                    url = f"https://finnhub.io/api/v1/company-news?symbol={ticker}&from={start}&to={end}&token={finnhub_key}"
                    res = requests.get(url, timeout=5, verify=False)
                    if res.status_code == 200:
                        for item in res.json()[:10]:
                            hl = item.get("headline", "")
                            summary = item.get("summary", "")
                            text = f"{hl}. {summary}".strip(". ")
                            if len(text) > 10:
                                headlines.append(text)
            except Exception:
                pass

            unique_headlines = list(dict.fromkeys(headlines))[:limit]

            if not unique_headlines:
                return {
                    "ticker": ticker, "avg_sentiment": "neutral", "avg_score": 0.0,
                    "positive_ratio": 0.0, "negative_ratio": 0.0, "neutral_ratio": 0.0,
                    "total_headlines": 0,
                }

            results = [self.analyze_headline(h) for h in unique_headlines]
            p = sum(1 for r in results if r["sentiment"] == "positive")
            n = sum(1 for r in results if r["sentiment"] == "negative")
            neu = sum(1 for r in results if r["sentiment"] == "neutral")
            t = len(results)
            score = (p - n) / t

            return {
                "ticker": ticker,
                "avg_sentiment": "positive" if score > 0.2 else "negative" if score < -0.2 else "neutral",
                "avg_score": round(score, 4),
                "positive_ratio": round(p / t, 4),
                "negative_ratio": round(n / t, 4),
                "neutral_ratio": round(neu / t, 4),
                "total_headlines": t,
            }

        return await asyncio.to_thread(fetch_and_score)
