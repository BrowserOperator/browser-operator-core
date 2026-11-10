# Multi-stage build for Chrome DevTools Frontend
FROM --platform=linux/amd64 ubuntu:22.04 AS builder

# Install required packages
RUN apt-get update && apt-get install -y \
    curl \
    git \
    python3 \
    python3-pip \
    python-is-python3 \
    wget \
    unzip \
    sudo \
    ca-certificates \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Install Node.js 18.x
RUN curl -fsSL https://deb.nodesource.com/setup_18.x | bash - && \
    apt-get install -y nodejs && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /workspace

# Clone depot_tools
RUN git clone https://chromium.googlesource.com/chromium/tools/depot_tools.git
ENV PATH="/workspace/depot_tools:${PATH}"
ENV DEPOT_TOOLS_UPDATE=0

# Follow README instructions exactly:
# fetching code
RUN mkdir devtools
WORKDIR /workspace/devtools
RUN fetch devtools-frontend

# Build steps
WORKDIR /workspace/devtools/devtools-frontend

RUN gclient sync
RUN /workspace/depot_tools/ensure_bootstrap

# Build standard DevTools first
RUN npm run build

# Add Browser Operator fork and switch to it
# Branch is configurable via build arg (default: main)
ARG BROWSER_OPERATOR_BRANCH=main
RUN git remote add upstream https://github.com/BrowserOperator/browser-operator-core.git
RUN git fetch upstream
RUN git checkout upstream/${BROWSER_OPERATOR_BRANCH}

# Copy local LLM changes on top of the upstream code
# This allows iterative development of LLM providers without rebuilding everything
COPY front_end/panels/ai_chat/LLM /workspace/devtools/devtools-frontend/front_end/panels/ai_chat/LLM

# Regenerate GN build files
RUN gn gen out/Default

# AUTOMATED_MODE: Default true for API mode (Type 2/3). Override with --build-arg AUTOMATED_MODE=false for Type 1.
ARG AUTOMATED_MODE=true
RUN if [ "$AUTOMATED_MODE" = "true" ]; then \
      sed -i 's/AUTOMATED_MODE: false/AUTOMATED_MODE: true/' \
      front_end/panels/ai_chat/core/BuildConfig.ts; \
    fi

# Build Browser Operator version with local changes (fresh GN generation)
RUN npm run build

# ==============================================================================
# Agent Server build stage
# ==============================================================================
FROM --platform=linux/amd64 node:18-alpine AS agent-server-builder

WORKDIR /workspace

# Copy agent-server from local directory
COPY agent-server/nodejs /workspace/agent-server

WORKDIR /workspace/agent-server

# Install dependencies
RUN npm install

# ==============================================================================
# Production stage - DevTools + Agent Server
# ==============================================================================
FROM --platform=linux/amd64 nginx:alpine

# Install Node.js (required for agent-server)
RUN apk add --no-cache nodejs npm bash

# Copy the built DevTools frontend
COPY --from=builder /workspace/devtools/devtools-frontend/out/Default/gen/front_end /usr/share/nginx/html

# Copy agent-server from builder stage
COPY --from=agent-server-builder /workspace/agent-server /opt/agent-server

# Copy nginx config
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf

# Create startup script to run both nginx and agent-server
RUN cat > /usr/local/bin/start-services.sh <<'EOFSCRIPT'
#!/bin/bash
set -e

# Start nginx in background
echo "Starting nginx..."
nginx -g "daemon off;" &
NGINX_PID=$!

# Start agent-server in background
echo "Starting agent-server..."
cd /opt/agent-server
node start.js &
AGENT_PID=$!

# Wait for both processes
echo "DevTools running on http://localhost:8000"
echo "Agent Server WebSocket on ws://localhost:8082"
echo "Agent Server HTTP API on http://localhost:8080"
echo "Press Ctrl+C to stop..."

# Trap SIGTERM and SIGINT
trap "kill $NGINX_PID $AGENT_PID 2>/dev/null || true; exit 0" SIGTERM SIGINT

# Wait for either process to exit
wait -n $NGINX_PID $AGENT_PID

# If one exits, kill the other
kill $NGINX_PID $AGENT_PID 2>/dev/null || true
EOFSCRIPT

RUN chmod +x /usr/local/bin/start-services.sh

# Environment variables for agent-server
ENV PORT=8082
ENV API_PORT=8080
ENV HOST=0.0.0.0
ENV CDP_HOST=host.docker.internal
ENV CDP_PORT=9222

EXPOSE 8000 8080 8082

# Override the nginx entrypoint
ENTRYPOINT []
CMD ["/bin/bash", "/usr/local/bin/start-services.sh"]