# Control Center Node Agent - Container Image
# For Kubernetes deployments and testing only
# For production on VMs/bare metal, use the native binary

FROM golang:1.25-alpine AS builder

RUN apk add --no-cache git

WORKDIR /build
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-w -s" -o agent .

# Runtime image
FROM alpine:3.19

RUN apk add --no-cache ca-certificates git openssh-client

# Create agent user
RUN addgroup -g 1001 -S agent && \
    adduser -S agent -u 1001 -G agent

WORKDIR /home/agent
COPY --from=builder /build/agent /usr/local/bin/agent

# Create config directory
RUN mkdir -p /home/agent/.controlcenter-agent && \
    chown -R agent:agent /home/agent

EXPOSE 8088 2222

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:8088/healthz || exit 1

USER agent
ENTRYPOINT ["/usr/local/bin/agent"]