# Docker Setup for Browser Operator DevTools + Agent Server

This directory contains Docker configuration files for building and running the Browser Operator DevTools Frontend with integrated Agent Server in a containerized environment.

> **Deployment Types:** This directory supports **Type 1** (DevTools only) and **Type 2** (DevTools + Agent Server).
> For **Type 3** (full dockerized browser), see the [web-agent](https://github.com/BrowserOperator/web-agent) repository.
> Quick reference: [CLAUDE.md](../CLAUDE.md)

## Overview

The Docker setup uses a multi-stage build process:
1. **DevTools Build Stage**: Compiles the DevTools frontend using the full development environment
2. **Agent Server Build Stage**: Installs Node.js dependencies for the agent server
3. **Production Stage**: Serves DevTools via Nginx + runs Agent Server (Node.js) in the same container

## Prerequisites

- Docker Engine 20.10+ installed
- Docker Compose v2.0+ (optional, for easier management)
- At least 8GB of available disk space for the build process
- 4GB+ RAM recommended for building

## Quick Start

### Building the Docker Image

From the repository root directory:

```bash
# Build DevTools image (AUTOMATED_MODE is always enabled)
docker build -f docker/Dockerfile -t browser-operator-devtools .

# Or use docker-compose (recommended)
docker-compose -f docker/docker-compose.yml build
```

### Running the Container

```bash
# Run DevTools container (AUTOMATED_MODE enabled by default)
docker run -d -p 8000:8000 --name browser-operator-devtools browser-operator-devtools

# Or using docker-compose (recommended)
docker-compose -f docker/docker-compose.yml up -d
```

The services will be available at:
- **DevTools UI**: http://localhost:8000
- **Agent Server HTTP API**: http://localhost:8080
- **Agent Server WebSocket**: ws://localhost:8082

### Accessing DevTools

Once the container is running, open Chrome or Chromium with remote debugging enabled:

```bash
# macOS
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --remote-debugging-port=9222 \
  --remote-allow-origins="*" \
  --auto-open-devtools-for-tabs \
  --user-data-dir=/tmp/chrome-debug-profile \
  --custom-devtools-frontend=http://localhost:8000/

# Linux
google-chrome \
  --remote-debugging-port=9222 \
  --remote-allow-origins="*" \
  --auto-open-devtools-for-tabs \
  --user-data-dir=/tmp/chrome-debug-profile \
  --custom-devtools-frontend=http://localhost:8000/

# Windows
"C:\Program Files\Google\Chrome\Application\chrome.exe" \
  --remote-debugging-port=9222 \
  --remote-allow-origins="*" \
  --auto-open-devtools-for-tabs \
  --user-data-dir=C:\temp\chrome-debug-profile \
  --custom-devtools-frontend=http://localhost:8000/
```

**Important flags:**
- `--remote-debugging-port=9222` - Enables CDP for the Agent Server to connect
- `--remote-allow-origins="*"` - Allows CDP connections from Docker containers
- `--auto-open-devtools-for-tabs` - Automatically opens DevTools for new tabs (required for agent-server automation)
- `--user-data-dir=/tmp/chrome-debug-profile` - Uses a temporary profile to avoid conflicts
- `--custom-devtools-frontend=http://localhost:8000/` - Uses the Browser Operator DevTools

**Note:** Make sure to completely quit Chrome before starting it with these flags. On macOS, use `Cmd+Q` or run `killall "Google Chrome"`.

## File Structure

```
docker/
├── Dockerfile           # Multi-stage build (DevTools + Agent Server)
├── .dockerignore       # Files to exclude from Docker context
├── nginx.conf          # Nginx server configuration
├── docker-compose.yml  # Docker Compose configuration
└── README.md          # This file

../agent-server/         # Agent Server source code (included in build)
```

## Automated Mode (Always Enabled)

This Docker image is built with **AUTOMATED_MODE** always enabled for seamless deployment:

- **Authentication**: Bypasses OAuth panel - no manual setup required
- **Evaluation**: Automatically enables evaluation mode for agent-server connectivity
- **Use cases**: Production deployments, CI/CD, headless automation, API integration

```bash
# Example workflow - ready to use immediately
docker build -f docker/Dockerfile -t browser-operator-devtools .
docker run -d -p 8000:8000 --name browser-operator browser-operator-devtools

# Ready to use immediately - no authentication required!
# Agent server can connect automatically via WebSocket (ws://localhost:8082)
```

**Note**: This approach matches the parent repository's `Dockerfile.devtools` which has proven to work "rock-solid" in production.

## Agent Server

The container includes a fully functional Agent Server that provides:

### WebSocket API (port 8082)
- JSON-RPC 2.0 bidirectional communication
- Browser agent lifecycle management
- Direct CDP integration

### HTTP REST API (port 8080)
- `POST /v1/responses` - Send tasks to browser agents
- `POST /page/screenshot` - Capture screenshots via CDP
- `POST /page/content` - Get HTML/text content
- `GET /status` - Health check

### Configuration

The Agent Server runs with these default settings:
- **WebSocket Port**: 8082
- **HTTP API Port**: 8080
- **Host**: 0.0.0.0 (listens on all interfaces)
- **Authentication**: Disabled (automated mode)

To customize, you can override environment variables:

```bash
docker run -d -p 8000:8000 -p 8080:8080 -p 8082:8082 \
  -e EVAL_SERVER_WS_PORT=8082 \
  -e EVAL_SERVER_HTTP_PORT=8080 \
  -e EVAL_SERVER_HOST=0.0.0.0 \
  browser-operator-devtools
```

### Testing the Agent Server

```bash
# Health check
curl http://localhost:8080/status

# Send a task (requires browser with remote debugging)
curl -X POST http://localhost:8080/v1/responses \
  -H "Content-Type: application/json" \
  -d '{
    "input": "Navigate to google.com",
    "url": "about:blank",
    "wait_timeout": 5000,
    "model": {
      "main_model": {"provider": "openai", "model": "gpt-4", "api_key": "sk-..."}
    }
  }'
```

For more details on the Agent Server API, see `../agent-server/README.md`.

## Advanced Usage

### Development Mode

For development with local file changes:

1. Build the project locally first:
```bash
npm run build
```

2. Run the container with volume mount:
```bash
docker run -d -p 8000:8000 \
  -v $(pwd)/out/Default/gen/front_end:/usr/share/nginx/html:ro \
  --name devtools-frontend-dev \
  devtools-frontend
```

Or uncomment the volume mount in `docker-compose.yml`.

### Custom Port

To run on a different port:

```bash
# Using docker run
docker run -d -p 9000:8000 devtools-frontend

# Using docker-compose
DEVTOOLS_PORT=9000 docker-compose -f docker/docker-compose.yml up -d
```

Then update your Chrome launch command accordingly.

### Building with Cache

To speed up rebuilds, Docker automatically caches layers. To force a fresh build:

```bash
docker build -f docker/Dockerfile --no-cache -t devtools-frontend .
```

### Viewing Logs

```bash
# Using docker
docker logs devtools-frontend

# Using docker-compose
docker-compose -f docker/docker-compose.yml logs -f
```

### Stopping the Container

```bash
# Using docker
docker stop devtools-frontend
docker rm devtools-frontend

# Using docker-compose
docker-compose -f docker/docker-compose.yml down
```

## Troubleshooting

### Build Fails

If the build fails:
1. Ensure you have enough disk space (8GB+ free)
2. Check Docker memory limits (4GB+ recommended)
3. Try building with `--no-cache` flag
4. Check the build logs for specific errors

### Container Won't Start

1. Check if port 8000 is already in use:
   ```bash
   lsof -i :8000  # macOS/Linux
   netstat -an | findstr :8000  # Windows
   ```

2. View container logs:
   ```bash
   docker logs devtools-frontend
   ```

### DevTools Not Loading

1. Verify the container is running:
   ```bash
   docker ps
   ```

2. Check Nginx is serving files:
   ```bash
   curl http://localhost:8000/
   ```

3. Ensure Chrome is launched with the correct flag

## Performance

- **Build time**: ~10-20 minutes (first build, depending on system)
- **Image size**: ~50MB (production image with Nginx)
- **Memory usage**: ~50-100MB at runtime
- **Startup time**: <5 seconds

## Security Notes

- The Nginx configuration includes security headers
- CORS is enabled for DevTools functionality
- The container runs as non-root user (nginx)
- No sensitive data is included in the final image

## Contributing

When modifying the Docker setup:
1. Test builds locally before committing
2. Update this README if configuration changes
3. Keep the final image size minimal
4. Follow Docker best practices for multi-stage builds

## License

Same as the Chrome DevTools Frontend project - BSD-3-Clause