# Run this:

{% raw %}
set -e

cd ~/CyberMinds
git checkout egeuysall
git pull

## 1) Make sure terminal stack is up with correct origin

cat > terminal/.env << 'EOF'
PORT=3000
ENVIRONMENT=production
APP_DOMAIN=terminal.egeuysal.com
CADDY_HTTP_PORT=18080
ALLOWED_ORIGINS=https://cyber-minds.github.io
EOF

docker compose -f terminal/docker-compose.prod.yml --env-file terminal/.env up -d --build

## 2) Find the PUBLIC caddy container (the one bound to :443)

PUB_CADDY=$(docker ps --format '{{.Names}} {{.Image}} {{.Ports}}' | awk '$0 ~ /0\.0\.0\.0:443->/ && tolower($0) ~ /caddy/ {print $1; exit}')
if [ -z "$PUB_CADDY" ]; then
echo "No public caddy container found on :443. Run: docker ps --format 'table {{.Names}}\t{{.Image}}\t{{.Ports}}'"
exit 1
fi
echo "Public Caddy: $PUB_CADDY"

## 3) Put public caddy and terminal stack on same Docker network

docker network connect terminal_default "$PUB_CADDY" 2>/dev/null || true

## 4) Locate mounted Caddyfile used by public caddy

CF=$(docker inspect "$PUB_CADDY" --format '{{range .Mounts}}{{if eq .Destination "/etc/caddy/Caddyfile"}}{{.Source}}{{end}}{{end}}')
if [ -z "$CF" ]; then
echo "Could not find /etc/caddy/Caddyfile mount for $PUB_CADDY"
exit 1
fi
echo "Public Caddyfile: $CF"

## 5) Add terminal route if missing

if ! grep -q "terminal.egeuysal.com" "$CF"; then
  cp "$CF" "${CF}.bak.$(date +%s)"
cat >> "$CF" << 'EOF'

terminal.egeuysal.com {
reverse_proxy terminal-caddy-1:80
}
EOF
fi

## 6) Reload public caddy config

docker exec "$PUB_CADDY" caddy reload --config /etc/caddy/Caddyfile

## 7) Verify

curl -I https://terminal.egeuysal.com/health
{% endraw %}
