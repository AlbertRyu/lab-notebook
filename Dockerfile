FROM python:3.12-slim
WORKDIR /app

COPY pyproject.toml .
RUN pip install .

COPY backend/ ./backend/
COPY frontend/ ./frontend/

# Seed data: pre-built example sample baked into the image
# Layout inside image: /app/seed/example-ppms/{meta.yaml, ppms/{axis-1,axis-2}/}
COPY example_data/meta.yaml   ./seed/example-ppms/meta.yaml
COPY example_data/axis-1/     ./seed/example-ppms/ppms/axis-1/
COPY example_data/axis-2/     ./seed/example-ppms/ppms/axis-2/

RUN mkdir -p /data/samples

EXPOSE 8000
ENV DB_PATH=/data/lab_notebook.db
ENV DATA_DIR=/data
ENV PORT=8000

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--app-dir", "/app/backend"]
