"""
bge-reranker-v2-m3 FastAPI 서비스
POST /rerank — query + documents → reranked scores
"""
from fastapi import FastAPI
from pydantic import BaseModel
from sentence_transformers import CrossEncoder
import uvicorn

app = FastAPI(title="RAG Reranker", version="1.0.0")

print("Loading bge-reranker-v2-m3...")
model = CrossEncoder("BAAI/bge-reranker-v2-m3")
print("Reranker ready")


class RerankRequest(BaseModel):
    query: str
    documents: list[str]
    top_k: int = 5


class RerankResult(BaseModel):
    index: int
    score: float
    document: str


class RerankResponse(BaseModel):
    results: list[RerankResult]


@app.post("/rerank", response_model=RerankResponse)
def rerank(req: RerankRequest):
    pairs = [[req.query, doc[:2000]] for doc in req.documents]
    scores = model.predict(pairs).tolist()

    indexed = sorted(enumerate(scores), key=lambda x: x[1], reverse=True)
    results = [
        RerankResult(index=idx, score=score, document=req.documents[idx])
        for idx, score in indexed[: req.top_k]
    ]
    return RerankResponse(results=results)


@app.get("/health")
def health():
    return {"status": "ok", "model": "bge-reranker-v2-m3"}


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=10800)
