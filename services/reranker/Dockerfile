FROM python:3.11-slim

WORKDIR /app

# 일반 패키지
RUN pip install --no-cache-dir \
    fastapi \
    uvicorn \
    sentence-transformers \
    pydantic

# PyTorch CPU only
RUN pip install --no-cache-dir torch --index-url https://download.pytorch.org/whl/cpu

COPY main.py .

# 모델 미리 다운로드
RUN python -c "from sentence_transformers import CrossEncoder; CrossEncoder('BAAI/bge-reranker-v2-m3')"

EXPOSE 10800

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "10800"]
