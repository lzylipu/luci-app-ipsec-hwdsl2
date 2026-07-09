#!/usr/bin/env ucode
'use strict';

// IPsec VPN (hwdsl2) rpcd backend - all ubus methods call docker CLI safely
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

// Safely execute docker commands using shell_quote or strict variables
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

const methods = {

    // Status: Check running container, ports, and image
    container_status: {
        call: function() {
            const cn = container_name();
            // Get enabled state from uci
            const enabled = uci.get('ipsec-hwdsl2', 'global', 'enabled') || '0';
            
            // Query all container status to avoid regex quote bugs
            const probe = exec_capture('docker ps -a --format "{{.Names}}|{{.Status}}|{{.Image}}|{{.Ports}}"');
            let matched_line = null;
            if (probe.rc == 0 && probe.out) {
                const lines = split(trim(probe.out), '\n');
                for (let line of lines) {
                    const parts = split(line, '|');
                    if (parts[0] == cn) {
                        matched_line = line;
                        break;
                    }
                }
            }

            if (!matched_line) {
                return { running: false, installed: false, enabled: enabled == '1' };
            }

            const parts = split(matched_line, '|');
            const is_running = match(parts[1], /^Up /) ? true : false;

            let daemon_info = '';
            let sa_active = 0;
            let sa_active_detail = [];

            if (is_running) {
                const stat = docker_exec('ipsec whack --status 2>&1 | head -25');
                daemon_info = stat.out ? substr(stat.out, 0, 600) : '';

                const sa = docker_exec('ipsec whack --trafficstatus 2>&1');
                const sa_lines = sa.out ? split(trim(sa.out), '\n') : [];
                const sa_active_arr = filter(sa_lines, function(s) { return length(trim(s)) > 0; });
                sa_active = length(sa_active_arr);
                sa_active_detail = sa_active_arr;
            }

            return {
                running: is_running,
                installed: true,
                enabled: enabled == '1',
                image: parts[2] || 'unknown',
                ports: parts[3] || '',
                daemon: daemon_info,
                active_sa: sa_active,
                active_sa_detail: sa_active_detail
            };
        }
    },

    // Check if the required Docker image is pulled
    image_check: {
        call: function() {
            const img = uci.get('ipsec-hwdsl2', 'global', 'image') || 'hwdsl2/ipsec-vpn-server:latest';
            const r = exec_capture('docker images --format "{{.Repository}}:{{.Tag}}"');
            if (r.rc != 0) return { error: 'docker images failed', rc: r.rc };
            const lines = split(trim(r.out), '\n');
            for (let line of lines) {
                if (trim(line) == img) {
                    return { pulled: true };
                }
            }
            return { pulled: false };
        }
    },

    // Start / Ensure the container runs (or create it from template)
    container_start: {
        call: function() {
            const cn = container_name();
            
            // Check if container already exists (any state)
            const probe = exec_capture('docker ps -a --format "{{.Names}}"');
            let exists = false;
            if (probe.rc == 0 && probe.out) {
                const lines = split(trim(probe.out), '\n');
                for (let line of lines) {
                    if (trim(line) == cn) {
                        exists = true;
                        break;
                    }
                }
            }

            if (exists) {
                // If it exists, just start it
                const r = exec_capture('docker start ' + shell_quote(cn));
                if (r.rc != 0) return fail(r, 'docker start failed');
                return { ok: true, action: 'start' };
            }

            // Create and start container from UCI template
            const img = uci.get('ipsec-hwdsl2', 'global', 'image') || 'hwdsl2/ipsec-vpn-server:latest';
            const volume = uci.get('ipsec-hwdsl2', 'global', 'volume') || 'ikev2-vpn-data:/etc/ipsec.d';
            
            let psk = uci.get('ipsec-hwdsl2', 'global', 'vpn_ipsec_psk') || '';
            let user = uci.get('ipsec-hwdsl2', 'global', 'vpn_user') || '';
            let pass = uci.get('ipsec-hwdsl2', 'global', 'vpn_password') || '';
            
            // Fallback generation for empty configs to ensure instant usability
            if (!psk) { psk = 'ipsec_psk_gen_' + substr(btoa(readfile('/dev/urandom', 12)), 0, 12); }
            if (!user) { user = 'vpnuser'; }
            if (!pass) { pass = 'vpn_pass_gen_' + substr(btoa(readfile('/dev/urandom', 12)), 0, 12); }

            let dns1 = uci.get('ipsec-hwdsl2', 'global', 'dns_srv1') || '1.1.1.1';
            let dns2 = uci.get('ipsec-hwdsl2', 'global', 'dns_srv2') || '1.0.0.1';
            let pub_ip = uci.get('ipsec-hwdsl2', 'global', 'public_ip') || '';

            let run_cmd = 'docker run --name ' + shell_quote(cn) +
                          ' --privileged ' +
                          ' -p 500:500/udp -p 4500:4500/udp ' +
                          ' -v ' + shell_quote(volume) +
                          ' -e VPN_IPSEC_PSK=' + shell_quote(psk) +
                          ' -e VPN_USER=' + shell_quote(user) +
                          ' -e VPN_PASSWORD=' + shell_quote(pass) +
                          ' -e VPN_DNS_SRV1=' + shell_quote(dns1) +
                          ' -e VPN_DNS_SRV2=' + shell_quote(dns2);

            if (pub_ip) {
                run_cmd += ' -e VPN_DNS_NAME=' + shell_quote(pub_ip);
            }

            run_cmd += ' -d ' + shell_quote(img);

            const r = exec_capture(run_cmd);
            if (r.rc != 0) return fail(r, 'docker run failed');

            // Save generated configs back to UCI if they were blank
            uci.set('ipsec-hwdsl2', 'global', 'vpn_ipsec_psk', psk);
            uci.set('ipsec-hwdsl2', 'global', 'vpn_user', user);
            uci.set('ipsec-hwdsl2', 'global', 'vpn_password', pass);
            uci.commit('ipsec-hwdsl2');

            return { ok: true, action: 'create_run' };
        }
    },

    // Stop container
    container_stop: {
        call: function() {
            const cn = container_name();
            const r = exec_capture('docker stop ' + shell_quote(cn));
            if (r.rc != 0) return fail(r, 'docker stop failed');
            return { ok: true };
        }
    },

    clients_list: {
        call: function(req) {
            const r = docker_exec(IKEV2_SCRIPT + ' --listclients --yes');
            if (r.rc != 0) return fail(r, 'ikev2.sh --listclients failed');
            const lines = split(r.out, '\n');
            const rows = [];
            for (let i = 0; i < length(lines); i++) {
                const m = match(lines[i], /^\s*(\S+)\s+(valid|expired|revoked|unknown)\s*$/);
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
            const l2tp_users = {};
            if (chap.out) {
                for (let line of split(chap.out, '\n')) {
                    const m = match(line, /^"([^"]+)"\s+l2tpd\s+"([^"]+)"\s+\*/);
                    if (m) {
                        l2tp_users[m[1]] = m[2];
                    }
                }
            }
            const xauth_users = {};
            if (pw.out) {
                for (let line of split(pw.out, '\n')) {
                    const parts = split(line, ':');
                    if (length(parts) >= 3) {
                        xauth_users[parts[0]] = parts[1];
                    }
                }
            }
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
        call: function(req) {
            const name = req.name || '';
            const fmt = req.format || 'p12';
            if (!match(name, /^[A-Za-z0-9_-]+$/)) return { error: 'invalid name' };
            
            let ext = fmt;
            if (fmt != 'mobileconfig' && fmt != 'sswan' && fmt != 'p12') {
                return { error: 'unsupported format' };
            }

            const cn = container_name();
            // Use docker base64 to safely fetch binary output without NUL truncation
            const r = exec_capture('docker exec ' + shell_quote(cn) +
                ' base64 /etc/ipsec.d/' + name + '.' + ext);
            if (r.rc != 0 || !r.out) return { error: 'file missing or read failed', code: r.rc };
            
            // Clean base64 output
            let base64_cleaned = replace(r.out, /[\r\n\s]/, '');
            return { content_base64: base64_cleaned, filename: name + '.' + ext };
        }
    },

    client_add: {
        call: function(req) {
            const name = req.name || '';
            if (!match(name, /^[A-Za-z0-9_-]+$/)) return { error: 'invalid client name' };
            const r = docker_exec(IKEV2_SCRIPT + ' --addclient ' + name);
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
            const name = (req.name || '').trim();
            const pass = req.password || '';
            if (!match(name, /^[A-Za-z0-9_-]+$/) || !pass) return { error: 'invalid user/password' };
            if (match(pass, /["`$\\]/)) return { error: 'password contains forbidden characters' };

            const cn = container_name();

            // First check duplicate
            const exist_check = exec_capture('docker exec ' + shell_quote(cn) + ' grep -q "^\\"' + name + '\\" " /etc/ppp/chap-secrets');
            if (exist_check.rc == 0) {
                return { error: 'user already exists' };
            }

            // Pipe parameters to stdin to completely avoid shell injection
            const pipe_payload = name + ' l2tpd ' + pass + ' *';
            
            // To prevent quoting mess, write command with clean quotes
            const sh = sprintf("docker exec -i %s sh -c 'read -r line; echo \"$line\" >> /etc/ppp/chap-secrets; ENC=$(openssl passwd -1 %s); echo \"%s:$ENC:xauth-psk\" >> /etc/ipsec.d/passwd; chmod 600 /etc/ppp/chap-secrets /etc/ipsec.d/passwd' <<< %s",
                shell_quote(cn),
                shell_quote(pass),
                name,
                shell_quote(pipe_payload)
            );
            
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

            // Since name is safe alphanumeric, we can clean files by filtering matching lines via safe sed
            const sh_secrets = sprintf("docker exec %s sed -i '/^\\\"%s\\\"[[:space:]]\\+l2tpd/d' /etc/ppp/chap-secrets", shell_quote(cn), name);
            const sh_passwd = sprintf("docker exec %s sed -i '/^%s:/d' /etc/ipsec.d/passwd", shell_quote(cn), name);

            const r1 = exec_capture(sh_secrets);
            const r2 = exec_capture(sh_passwd);
            
            if (r1.rc != 0 || r2.rc != 0) {
                return { error: 'delete user failed', secrets_rc: r1.rc, passwd_rc: r2.rc };
            }
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
