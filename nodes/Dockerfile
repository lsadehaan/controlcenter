# Control Center Node Agent
# Multi-stage build for minimal production image

# Build stage
FROM golang:1.25-alpine AS builder

# Install build dependencies
RUN apk add --no-cache git gcc musl-dev

WORKDIR /build

# Copy go mod files
COPY go.mod go.sum ./

# Download dependencies
RUN go mod download

# Copy source code
COPY . .

# Build the binary
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build \
    -ldflags="-w -s" \
    -o agent .

# Runtime stage
FROM alpine:3.19

# Install runtime dependencies
RUN apk add --no-cache ca-certificates git openssh-client && \
    mkdir -p /home/agent/.controlcenter-agent && \
    addgroup -g 1001 -S agent && \
    adduser -S agent -u 1001 -G agent

WORKDIR /home/agent

# Copy binary from builder
COPY --from=builder /build/agent /usr/local/bin/agent

# Set ownership
RUN chown -R agent:agent /home/agent

# Expose ports
EXPOSE 8088 2222

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:8088/healthz || exit 1

# Run as non-root user
USER agent

# Start the agent
ENTRYPOINT ["/usr/local/bin/agent"]