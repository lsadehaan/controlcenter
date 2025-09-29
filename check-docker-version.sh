#!/bin/bash
echo "Checking Docker image version..."
docker pull ghcr.io/lsadehaan/controlcenter-manager:latest
docker run --rm ghcr.io/lsadehaan/controlcenter-manager:latest cat package.json | grep version
