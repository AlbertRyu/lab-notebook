FROM python:3.12-slim
WORKDIR /app

COPY pyproject.toml .
RUN pip install .

COPY backend/ ./backend/
COPY frontend/ ./frontend/

RUN mkdir -p /data/samples

EXPOSE 8000
ENV DB_PATH=/data/lab_notebook.db
ENV DATA_DIR=/data
ENV PORT=8000

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--app-dir", "/app/backend"]
