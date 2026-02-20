# Skill: server-ip

Returns the IP address of the server.

## Usage

When the user asks for the server IP address, use the following command:

```bash
curl -s ifconfig.me || curl -s icanhazip.com || hostname -I | awk '{print $1}'
```

If those external services are unavailable, fallback to:

```bash
ip addr show | grep 'inet ' | grep -v '127.0.0.1' | head -1 | awk '{print $2}' | cut -d'/' -f1
```

## Description

This skill retrieves the public or local IP address of the server running Wafflebot.
