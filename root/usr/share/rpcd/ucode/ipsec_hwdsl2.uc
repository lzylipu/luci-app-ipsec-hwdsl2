#!/usr/bin/env ucode
'use strict';

// IPsec VPN (hwdsl2) rpcd backend - جميع ubus methods call docker CLI
// All commands affixed to the container name from /etc/config/ipsec-hwdsl2.
// Authored by LZY Agent (2026) — backed by hwdsl2/setup-ipsec-vpn Libreswan.

import { cursor } from 'uci';
import { popen, readfile, stat } from 'fs';

const uci = cursor();
const CONTAINER_DEFAULT = 'ipsec-vpn-server';
const IKEV2_SCRIPT = '/opt/src/ikev2.sh';

function container_name() {
    return uci.get('ipsec-hwdsl2', 'global', 'container_name') || CONTAINER_DEFAULT;
}

function exec_capture(cmd) {
    let p = popen(cmd + ' 2>&1', 'r');
    let out = '';
    let chunk;
    while ((chunk = p.read('all')) !== null) {
        out = out + chunk;
    }
    let rc = p.close();
    return { rc: rc, out: out };
}

function docker_exec(args) {
    const cn = container_name();
    const cmd = 'docker exec ' + shell_quote(cn) + ' ' + args;
    return exec_capture(cmd);
}

function shell_quote(s) {
    return "'" + replace(s, "'", "'\\''") + "'";
}

function fail(ctx, msg) {
    return { error: msg, code: ctx.rc, raw: substr(ctx.out, 0, 400) };
}

// --- methods 形态: ubus call luci.ipsec_hwdsl2 <method> '{"name":"x"}' ---
const methods = {

    // 状态类 (read) ============================================================

    container_status: {
        call: function() {
            const cn = container_name();
            // 检查容器是否运行
            const probe = exec_capture('docker ps --filter name=^/' + shell_quote(cn) +
                '$ --format "{{.Status}}|{{.Image}}|{{.Ports}}"');
            if (probe.rc != 0 || !probe.out || probe.out == '\n') {
                return { running: false, installed: false };
            }
            const line = split(probe.out, '\n')[0];
            const parts = split(line, '|');
            // 拿 daemon info
            const stat = docker_exec('ipsec whack --status 2>&1 | head -25');
            // 拿 active SA count
            const sa = docker_exec('ipsec whack --trafficstatus 2>&1');
            const sa_lines = sa.out ? split(trim(sa.out), '\n') : [];
            const sa_active = filter(sa_lines, function(s) { return length(trim(s)) > 0; });
            return {
                running: true,
                image: parts[1] || 'unknown',
                ports: parts[2] || '',
                daemon: substr(stat.out, 0, 600),
                active_sa: length(sa_active),
                active_sa_detail: sa_active
            };
        }
    },

    clients_list: {
        call: function(req) {
            const r = docker_exec(IKEV2_SCRIPT + ' --listclients --yes');
            if (r.rc != 0) return fail(r, 'ikev2.sh --listclients failed');
            // 解析表头 + rows
            const lines = split(r.out, '\n');
            const rows = [];
            for (let i = 0; i < length(lines); i++) {
                const m = match(lines[i], /^\s*(\S+)\s+(valid|expired|revoked)\s*$/);
                if (m) {
                    push(rows, { name: m[1], status: m[2] });
                }
            }
            return { clients: rows, total: length(rows), raw: r.out };
        }
    },

    users_list: {
        call: function() {
            const cn = container_name();
            const chap_cmd = 'docker exec ' + shell_quote(cn) + ' cat /etc/ppp/chap-secrets';
            const pw_cmd = 'docker exec ' + shell_quote(cn) + ' cat /etc/ipsec.d/passwd';
            const chap = exec_capture(chap_cmd);
            const pw = exec_capture(pw_cmd);
            // 解析 L2TP: "name" l2tpd "pass" *
            const l2tp_users = {};
            if (chap.out) {
                for (let line of split(chap.out, '\n')) {
                    const m = match(line, /^"([^"]+)"\s+l2tpd\s+"([^"]+)"\s+\*/);
                    if (m) {
                        l2tp_users[m[1]] = m[2];
                    }
                }
            }
            // 解析 XAuth: user:$1$...$:xauth-psk  (key, no plain pass)
            const xauth_users = {};
            if (pw.out) {
                for (let line of split(pw.out, '\n')) {
                    const parts = split(line, ':');
                    if (length(parts) >= 3) {
                        xauth_users[parts[0]] = parts[1];
                    }
                }
            }
            // merge
            const all = {};
            for (let k in l2tp_users) all[k] = true;
            for (let k in xauth_users) all[k] = true;
            const rows = [];
            for (let name in all) {
                push(rows, {
                    name: name,
                    l2tp_present: l2tp_users[name] ? true : false,
                    xauth_present: xauth_users[name] ? true : false,
                    password: l2tp_users[name] || null
                });
            }
            return { users: rows, total: length(rows) };
        }
    },

    client_download: {
        call: function(req, type_name) {
            // req = { name: "client1", format: "p12" }
            const name = req.name || '';
            const fmt = req.format || 'p12';
            if (!match(name, /^[A-Za-z0-9_-]+$/)) return { error: 'invalid name' };
            let ext = fmt;
            if (fmt == 'mobileconfig') ext = 'mobileconfig';
            else if (fmt == 'sswan') ext = 'sswan';
            else if (fmt == 'p12') ext = 'p12';
            else return { error: 'unsupported format' };

            const cn = container_name();
            const r = exec_capture('docker exec ' + shell_quote(cn) +
                ' cat /etc/ipsec.d/' + name + '.' + ext);
            if (r.rc != 0 || !r.out) return { error: 'file missing', code: r.rc };
            return { content_base64: btoa(r.out), filename: name + '.' + ext };
        }
    },

    // 写操作 ==================================================================

    client_add: {
        call: function(req) {
            const name = req.name || '';
            if (!match(name, /^[A-Za-z0-9_-]+$/)) return { error: 'invalid client name' };
            const r = docker_exec(IKEV2_SCRIPT + ' --addclient ' + name + ' --yes');
            if (r.rc != 0) return fail(r, 'addclient failed');
            return { ok: true, raw: r.out };
        }
    },

    client_revoke: {
        call: function(req) {
            const name = req.name || '';
            if (!match(name, /^[A-Za-z0-9_-]+$/)) return { error: 'invalid client name' };
            const r = docker_exec(IKEV2_SCRIPT + ' --revokeclient ' + name + ' --yes');
            if (r.rc != 0) return fail(r, 'revoke failed');
            return { ok: true, raw: r.out };
        }
    },

    client_delete: {
        call: function(req) {
            const name = req.name || '';
            if (!match(name, /^[A-Za-z0-9_-]+$/)) return { error: 'invalid client name' };
            const r = docker_exec(IKEV2_SCRIPT + ' --deleteclient ' + name + ' --yes');
            if (r.rc != 0) return fail(r, 'delete failed');
            return { ok: true, raw: r.out };
        }
    },

    user_add: {
        call: function(req) {
            // req = { name, password }
            const name = (req.name || '').trim();
            const pass = req.password || '';
            if (!match(name, /^[A-Za-z0-9_-]+$/) || !pass) return { error: 'invalid user/password' };
            const cn = container_name();
            // 1. chap-secrets append (L2TP plaintext)
            const sh = 'docker exec ' + shell_quote(cn) +
                ' sh -c "echo \\"' + name + ' l2tpd \\"' + pass + '\\" *\\" >> /etc/ppp/chap-secrets && ' +
                'ENC=$(openssl passwd -1 \\"' + pass + '\\") && ' +
                'echo \\"' + name + ':$ENC:xauth-psk\\" >> /etc/ipsec.d/passwd && ' +
                'chmod 600 /etc/ppp/chap-secrets /etc/ipsec.d/passwd"';
            const r = exec_capture(sh);
            if (r.rc != 0) return fail(r, 'add user failed');
            return { ok: true };
        }
    },

    user_delete: {
        call: function(req) {
            const name = (req.name || '').trim();
            if (!match(name, /^[A-Za-z0-9_-]+$/)) return { error: 'invalid user' };
            const cn = container_name();
            const sh = 'docker exec ' + shell_quote(cn) +
                ' sh -c "sed -i \\"/^\\"' + name + '\\"\\\\s\\\\+l2tpd\\\\s/d\\" /etc/ppp/chap-secrets && ' +
                'sed -i \\"/^' + name + ':/d\\" /etc/ipsec.d/passwd"';
            const r = exec_capture(sh);
            if (r.rc != 0) return fail(r, 'delete user failed');
            return { ok: true };
        }
    },

    container_restart: {
        call: function() {
            const cn = container_name();
            const r = exec_capture('docker restart ' + shell_quote(cn));
            if (r.rc != 0) return fail(r, 'restart failed');
            return { ok: true, raw: r.out };
        }
    }
};

return { 'luci.ipsec_hwdsl2': methods };
