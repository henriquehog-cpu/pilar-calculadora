#!/bin/bash
cd "$(dirname "$0")"
node painel-proxy.js &
python3 -m http.server 8080
