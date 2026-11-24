FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    MPLBACKEND=Agg \
    MPLCONFIGDIR=/tmp/matplotlib

WORKDIR /app

# Create non-root user and session directory
RUN groupadd -g 1000 appuser && \
    useradd -u 1000 -g 1000 -m -s /usr/sbin/nologin appuser && \
    mkdir -p /var/lib/ipd-session && \
    chown appuser:appuser /var/lib/ipd-session

COPY requirements.txt /tmp/requirements.txt
RUN pip install --no-cache-dir -r /tmp/requirements.txt && rm -f /tmp/requirements.txt

COPY --chown=appuser:appuser . /app/

USER appuser

EXPOSE 8055

CMD ["python3", "/app/taller5_web/server.py", "--host", "0.0.0.0", "--port", "8055"]
