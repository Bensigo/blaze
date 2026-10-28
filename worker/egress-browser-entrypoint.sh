#!/bin/sh
set -eu
# The browser container has only the internal network. No direct TCP, UDP, DNS,
# loopback, or IPv6 connections may leave the browser. Only the proxy is reachable.
iptables -P INPUT DROP
iptables -P OUTPUT DROP
iptables -P FORWARD DROP
iptables -A INPUT -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
iptables -A INPUT -p tcp -s 172.28.22.4 --dport 3000 -j ACCEPT
iptables -A INPUT -p tcp -s 172.28.22.4 --dport 3001 -j ACCEPT
iptables -A OUTPUT -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
iptables -A OUTPUT -p tcp -d 172.28.22.2 --dport 3128 -j ACCEPT
ip6tables -P INPUT DROP
ip6tables -P OUTPUT DROP
ip6tables -P FORWARD DROP
# Neither the browser manager nor Chromium retain NET_ADMIN or other capabilities.
exec setpriv --reuid=pwuser --regid=pwuser --init-groups --bounding-set=-all --inh-caps=-all --ambient-caps=-all /app/node_modules/.bin/tsx /app/worker/egress-browser.ts
