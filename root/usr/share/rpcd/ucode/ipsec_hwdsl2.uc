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
    let out = p.read('all') || '';
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

function run_container_start() {
    const cn = container_name();
    
    // Check if container already exists (any state)
    const probe = exec_capture('docker ps -a --format "{{.Names}}"');
    let exists = false;
    if (probe.rc == 0 && probe.out) {
        const lines = split(trim(probe.out), '\n');
        for (let line in lines) {
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
                  ' --restart=always ' +
                  ' -v /lib/modules:/lib/modules:ro ' +
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
                for (let line in lines) {
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
            for (let line in lines) {
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
            return run_container_start();
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
                for (let line in split(chap.out, '\n')) {
                    const m = match(line, /^"([^"]+)"\s+l2tpd\s+"([^"]+)"\s+\*/);
                    if (m) {
                        l2tp_users[m[1]] = m[2];
                    }
                }
            }
            const xauth_users = {};
            if (pw.out) {
                for (let line in split(pw.out, '\n')) {
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
        args: { name: '', format: '' },
        call: function(request) {
            const name = request.args.name || '';
            const fmt = request.args.format || 'p12';
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
            let base64_cleaned = join('', split(r.out, /\s+/));
            return { content_base64: base64_cleaned, filename: name + '.' + ext };
        }
    },

    client_add: {
        args: { name: '' },
        call: function(request) {
            const name = request.args.name || '';
            if (!match(name, /^[A-Za-z0-9_-]+$/)) return { error: 'invalid client name' };
            const r = docker_exec(IKEV2_SCRIPT + ' --addclient ' + name);
            if (r.rc != 0) return fail(r, 'addclient failed');
            return { ok: true, raw: r.out };
        }
    },

    client_revoke: {
        args: { name: '' },
        call: function(request) {
            const name = request.args.name || '';
            if (!match(name, /^[A-Za-z0-9_-]+$/)) return { error: 'invalid client name' };
            const r = docker_exec(IKEV2_SCRIPT + ' --revokeclient ' + name + ' --yes');
            if (r.rc != 0) return fail(r, 'revoke failed');
            return { ok: true, raw: r.out };
        }
    },

    client_delete: {
        args: { name: '' },
        call: function(request) {
            const name = request.args.name || '';
            if (!match(name, /^[A-Za-z0-9_-]+$/)) return { error: 'invalid client name' };
            const r = docker_exec(IKEV2_SCRIPT + ' --deleteclient ' + name + ' --yes');
            if (r.rc != 0) return fail(r, 'delete failed');
            return { ok: true, raw: r.out };
        }
    },

    user_add: {
        args: { name: '', password: '' },
        call: function(request) {
            const name = (request.args.name || '').trim();
            const pass = request.args.password || '';
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
        args: { name: '' },
        call: function(request) {
            const name = (request.args.name || '').trim();
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
    },

    config_export: {
        call: function() {
            const cn = container_name();
            
            // 1. 如果容器运行中，尝试从它的运行时配置中把最新的环境变量拉回来同步回 UCI
            let inspect_env = exec_capture('docker inspect --format \'{{json .Config.Env}}\' ' + shell_quote(cn));
            if (inspect_env.rc == 0 && inspect_env.out) {
                try {
                    let env_arr = json(inspect_env.out);
                    if (type(env_arr) == 'array') {
                        for (let env_str in env_arr) {
                            let kv = split(env_str, '=');
                            if (length(kv) >= 2) {
                                let k = kv[0];
                                let v = join('=', slice(kv, 1));
                                if (k == 'VPN_IPSEC_PSK') uci.set('ipsec-hwdsl2', 'global', 'vpn_ipsec_psk', v);
                                else if (k == 'VPN_USER') uci.set('ipsec-hwdsl2', 'global', 'vpn_user', v);
                                else if (k == 'VPN_PASSWORD') uci.set('ipsec-hwdsl2', 'global', 'vpn_password', v);
                                else if (k == 'VPN_DNS_SRV1') uci.set('ipsec-hwdsl2', 'global', 'dns_srv1', v);
                                else if (k == 'VPN_DNS_SRV2') uci.set('ipsec-hwdsl2', 'global', 'dns_srv2', v);
                                else if (k == 'VPN_DNS_NAME') uci.set('ipsec-hwdsl2', 'global', 'public_ip', v);
                            }
                        }
                    }
                } catch(e) {}
            }

            // 2. 尝试提取挂载卷路径同步回 UCI
            let inspect_mounts = exec_capture('docker inspect --format \'{{json .Mounts}}\' ' + shell_quote(cn));
            if (inspect_mounts.rc == 0 && inspect_mounts.out) {
                try {
                    let mounts = json(inspect_mounts.out);
                    if (type(mounts) == 'array') {
                        for (let m in mounts) {
                            if (m.Destination == '/etc/ipsec.d') {
                                let vol_str = m.Source + ':/etc/ipsec.d';
                                uci.set('ipsec-hwdsl2', 'global', 'volume', vol_str);
                            }
                        }
                    }
                } catch(e) {}
            }
            
            // 固化可能更新的配置
            uci.commit('ipsec-hwdsl2');

            // 3. 创建临时打包目录，将 UCI 配置与容器内数据一并打包
            exec_capture('mkdir -p /tmp/ipsec_backup');
            exec_capture('cp /etc/config/ipsec-hwdsl2 /tmp/ipsec_backup/ipsec-hwdsl2.uci');
            
            let pack_r = exec_capture('docker exec ' + shell_quote(cn) + ' tar -cz -C / etc/ipsec.d etc/ppp/chap-secrets 2>/dev/null > /tmp/ipsec_backup/data.tar.gz');
            if (pack_r.rc != 0) {
                // 如果容器内打包失败（比如容器根本没启动），尝试读取 uci 中映射的本地挂载目录直接打包，做备用兼容
                let vol_path = uci.get('ipsec-hwdsl2', 'global', 'volume') || '';
                let parts = split(vol_path, ':');
                if (length(parts) >= 2 && stat(parts[0])) {
                    // 本地挂载目录存在，直接打包它
                    exec_capture('tar -cz -C ' + shell_quote(parts[0]) + ' . 2>/dev/null > /tmp/ipsec_backup/data.tar.gz');
                }
            }

            let final_tar = exec_capture('tar -cz -C /tmp/ipsec_backup . | base64');
            exec_capture('rm -rf /tmp/ipsec_backup');

            if (final_tar.rc != 0 || !final_tar.out) {
                return { error: 'Failed to create final backup archive' };
            }

            let base64_cleaned = join('', split(final_tar.out, /\s+/));
            return { content_base64: base64_cleaned, filename: 'ipsec-vpn-backup.tar.gz' };
        }
    },

    config_import: {
        args: { path: '' },
        call: function(request) {
            const path = request.args.path || '';
            if (!match(path, /^\/tmp\/[A-Za-z0-9_\\-\\.]+$/)) {
                return { error: 'invalid file path' };
            }

            // 1. 解压包到临时目录
            exec_capture('mkdir -p /tmp/ipsec_restore');
            let unpack_r = exec_capture('tar -xzf ' + shell_quote(path) + ' -C /tmp/ipsec_restore');
            if (unpack_r.rc != 0) {
                exec_capture('rm -rf /tmp/ipsec_restore');
                return { error: 'Invalid backup file format' };
            }

            // 2. 恢复 UCI 配置
            let has_uci = stat('/tmp/ipsec_restore/ipsec-hwdsl2.uci');
            if (has_uci) {
                exec_capture('cp /tmp/ipsec_restore/ipsec-hwdsl2.uci /etc/config/ipsec-hwdsl2');
                uci.unload('ipsec-hwdsl2');
            }

            const cn = container_name();

            // 3. 检查同名容器是否存在，若存在先强制清理，以便使用最新的环境变量/挂载配置重新 Run
            let check_cn = exec_capture('docker ps -a --format "{{.Names}}"');
            let exists = false;
            if (check_cn.rc == 0 && check_cn.out) {
                let lines = split(trim(check_cn.out), '\n');
                for (let line in lines) {
                    if (trim(line) == cn) {
                        exists = true;
                        break;
                    }
                }
            }

            if (exists) {
                exec_capture('docker rm -f ' + shell_quote(cn));
            }

            // 4. 调用 container_start 重新跑起来（会自动应用恢复后的 UCI 中的各种环境变量和挂载卷）
            let run_res = run_container_start();
            if (run_res.error) {
                exec_capture('rm -rf /tmp/ipsec_restore');
                return { error: 'Failed to recreate container: ' + run_res.error };
            }

            // 5. 将证书和 chap-secrets 复制回容器
            let has_data = stat('/tmp/ipsec_restore/data.tar.gz');
            if (has_data) {
                let cp_r = exec_capture('docker cp /tmp/ipsec_restore/data.tar.gz ' + shell_quote(cn) + ':/tmp/data.tar.gz');
                if (cp_r.rc == 0) {
                    exec_capture('docker exec ' + shell_quote(cn) + ' tar -xzf /tmp/data.tar.gz -C /');
                    exec_capture('docker exec ' + shell_quote(cn) + ' rm -f /tmp/data.tar.gz');
                }
            }

            // 6. 重启容器以重载所有数据
            exec_capture('docker restart ' + shell_quote(cn));

            // 清理
            exec_capture('rm -rf /tmp/ipsec_restore');
            exec_capture('rm -f ' + shell_quote(path));

            return { ok: true };
        }
    }
};

return { 'luci.ipsec_hwdsl2': methods };
