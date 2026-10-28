#!/bin/sh
set -eu
prefix=${BLAZE_WORKER_NET_PREFIX-172.28.22}
# Reject ambiguous, public, malformed or mismatched network settings before firewall startup.
node - "$prefix" <<'NODE'
const { networkInterfaces } = require("node:os");
const prefix = process.argv[2];
const match = /^172\.(1[6-9]|2[0-9]|3[01])\.(0|[1-9][0-9]{0,2})$/.exec(prefix);
if (!match || Number(match[2]) > 255) process.exit(1);
const expected = `${prefix}.3`;
if (!Object.values(networkInterfaces()).flat().some(x => x && x.family === "IPv4" && x.address === expected)) process.exit(1);
NODE
# The browser container has only the internal network. No direct TCP, UDP, DNS,
# loopback, or IPv6 connections may leave the browser. Only the proxy is reachable.
iptables -P INPUT DROP
iptables -P OUTPUT DROP
iptables -P FORWARD DROP
iptables -A INPUT -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
iptables -A INPUT -p tcp -s "${prefix}.4" --dport 3000 -j ACCEPT
iptables -A INPUT -p tcp -s "${prefix}.4" --dport 3001 -j ACCEPT
iptables -A OUTPUT -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
iptables -A OUTPUT -p tcp -d "${prefix}.2" --dport 3128 -j ACCEPT
ip6tables -P INPUT DROP
ip6tables -P OUTPUT DROP
ip6tables -P FORWARD DROP
# Neither the browser manager nor Chromium retain NET_ADMIN or other capabilities.
exec setpriv --reuid=pwuser --regid=pwuser --init-groups --bounding-set=-all --inh-caps=-all --ambient-caps=-all /app/node_modules/.bin/tsx /app/worker/egress-browser.ts
