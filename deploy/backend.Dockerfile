FROM python:3.11-slim

LABEL maintainer="Singra Vox" \
      description="Singra Vox Backend API Server"

WORKDIR /app

# System deps for bcrypt
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc libffi-dev && \
    rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Non-root user for security
RUN useradd -m -r singravox && chown -R singravox:singravox /app
USER singravox

EXPOSE 8001

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8001/api/health')"

CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8001", "--workers", "1", "--log-level", "info"]
