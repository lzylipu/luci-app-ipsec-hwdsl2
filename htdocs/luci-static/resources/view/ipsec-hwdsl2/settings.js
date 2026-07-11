'use strict';
'require view';
'require form';
'require rpc';
'require ui';

const callStatus = rpc.declare({ object: 'luci.ipsec_hwdsl2', method: 'container_status' });
const callStart = rpc.declare({ object: 'luci.ipsec_hwdsl2', method: 'container_start' });
const callStop = rpc.declare({ object: 'luci.ipsec_hwdsl2', method: 'container_stop' });
const callRestart = rpc.declare({ object: 'luci.ipsec_hwdsl2', method: 'container_restart' });
const callImageCheck = rpc.declare({ object: 'luci.ipsec_hwdsl2', method: 'image_check' });
const callExport = rpc.declare({ object: 'luci.ipsec_hwdsl2', method: 'config_export' });
const callImport = rpc.declare({ object: 'luci.ipsec_hwdsl2', method: 'config_import', params: ['path'] });

return view.extend({
    title: _('IPsec VPN (hwdsl2) 设置'),

    render: function() {
        let m, s, o;

        m = new form.Map('ipsec-hwdsl2', _('IPsec VPN (hwdsl2) — 设置'),
            _('配置智能 Docker 容器。启用服务将自动配置并运行重启后持久化的 IPsec 服务器。'));

        s = m.section(form.TypedSection, 'global', _('全局选项'));
        s.anonymous = true;

        // Master Switch: Driving container start/stop lifecycle
        o = s.option(form.Flag, 'enabled', _('启用 VPN 服务'),
            _('启用时守护进程将创建或启动容器。禁用时容器将被停止。'));
        o.default = '0';
        o.rmempty = false;

        // Visual restart handler linked to enabled uci save
        o.write = function(section_id, value) {
            form.Flag.prototype.write.call(this, section_id, value);
            // Trigger dynamic ubus actions in background
            if (value === '1') {
                callStart();
            } else {
                callStop();
            }
        };

        o = s.option(form.Value, 'container_name', _('容器名称'),
            _('Docker 容器名称。默认: ipsec-vpn-server'));
        o.default = 'ipsec-vpn-server';
        o.rmempty = false;

        o = s.option(form.Value, 'image', _('镜像'),
            _('上游安装镜像。默认: hwdsl2/ipsec-vpn-server:latest'));
        o.default = 'hwdsl2/ipsec-vpn-server:latest';
        o.rmempty = false;

        o = s.option(form.Value, 'volume', _('挂载卷路径'),
            _('证书持久化挂载卷。格式: volume_name:/etc/ipsec.d'));
        o.default = 'ikev2-vpn-data:/etc/ipsec.d';
        o.rmempty = false;

        s = m.section(form.TypedSection, 'global', _('容器模板参数'));
        s.anonymous = true;

        o = s.option(form.Value, 'vpn_ipsec_psk', _('IPsec 预共享密钥 (PSK)'),
            _('用于 L2TP/IPsec 和 XAuth。留空则自动生成高强度安全密钥。'));
        o.password = true;
        o.rmempty = true;

        o = s.option(form.Value, 'vpn_user', _('默认管理员用户名'),
            _('初始 VPN 管理员。默认: vpnuser'));
        o.default = 'vpnuser';
        o.rmempty = true;

        o = s.option(form.Value, 'vpn_password', _('默认管理员密码'),
            _('默认管理员密码。留空则自动生成。'));
        o.password = true;
        o.rmempty = true;

        o = s.option(form.Value, 'dns_srv1', _('DNS 服务器 1'), _('主 DNS 服务器。默认: 1.1.1.1'));
        o.default = '1.1.1.1';
        o.datatype = 'ip4addr';

        o = s.option(form.Value, 'dns_srv2', _('DNS 服务器 2'), _('备 DNS 服务器。默认: 1.0.0.1'));
        o.default = '1.0.0.1';
        o.datatype = 'ip4addr';

        o = s.option(form.Value, 'public_ip', _('公网服务器 IP/域名（可选）'),
            _('如果设置，将覆盖客户端配置中自动检测的公网 IP。'));
        o.datatype = 'host';
        o.rmempty = true;

        // Container actions
        s = m.section(form.TypedSection, 'global', _('操作'));
        s.anonymous = true;

        o = s.option(form.DummyValue, '_actions');
        o.rawhtml = true;
        o.render = function(section_id) {
            return E('div', { 'class': 'cbi-value' }, [
                E('label', { 'class': 'cbi-value-title' }, _('管理操作')),
                E('div', { 'class': 'cbi-value-field' }, [
                    E('button', {
                        'class': 'cbi-button cbi-button-apply',
                        'style': 'margin-right: 8px;',
                        'click': async ev => {
                            ev.target.disabled = true;
                            ui.showModal(null, E('p', { 'class': 'spinning' }, _('正在打包并导出 VPN 备份...')));
                            try {
                                const r = await callExport();
                                ui.hideModal();
                                if (r.error) {
                                    ui.addNotification(null, E('p', _('备份失败: ') + r.error));
                                } else {
                                    const bin = atob(r.content_base64);
                                    const bytes = new Uint8Array(bin.length);
                                    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
                                    const blob = new Blob([bytes], { type: 'application/octet-stream' });
                                    const url = URL.createObjectURL(blob);
                                    const a = E('a', { href: url, download: r.filename });
                                    document.body.appendChild(a);
                                    a.click();
                                    document.body.removeChild(a);
                                    URL.revokeObjectURL(url);
                                    ui.addNotification(null, E('p', _('配置备份下载成功')), 'success');
                                }
                            } catch (err) {
                                ui.hideModal();
                                ui.addNotification(null, E('p', String(err)));
                            } finally { ev.target.disabled = false; }
                        }
                    }, _('导出配置备份')),

                    E('button', {
                        'class': 'cbi-button cbi-button-action',
                        'style': 'margin-right: 8px;',
                        'click': ev => {
                            const input = E('input', {
                                type: 'file',
                                style: 'display:none',
                                change: changeEv => {
                                    const file = changeEv.target.files[0];
                                    if (!file) return;
                                    ui.showModal(null, E('p', { 'class': 'spinning' }, _('正在上传并恢复配置...')));
                                    ui.uploadFile('/tmp/ipsec-vpn-backup.tar.gz', changeEv.target)
                                        .then(res => {
                                            return callImport('/tmp/ipsec-vpn-backup.tar.gz');
                                        })
                                        .then(res => {
                                            ui.hideModal();
                                            if (res.error) {
                                                ui.addNotification(null, E('p', _('导入失败: ') + res.error));
                                            } else {
                                                ui.addNotification(null, E('p', _('配置已成功导入，容器已重启！')), 'success');
                                                window.location.reload();
                                            }
                                        })
                                        .catch(err => {
                                            ui.hideModal();
                                            ui.addNotification(null, E('p', _('文件上传失败: ') + (err.message || err)));
                                        });
                                }
                            });
                            document.body.appendChild(input);
                            input.click();
                            document.body.removeChild(input);
                        }
                    }, _('导入配置备份')),

                    E('button', {
                        'class': 'cbi-button cbi-button-apply',
                        'style': 'margin-right: 8px;',
                        'click': async ev => {
                            ev.target.disabled = true;
                            ui.showModal(null, E('p', { 'class': 'spinning' }, _('正在重启 Docker 容器...')));
                            try {
                                const r = await callRestart();
                                ui.hideModal();
                                if (r.error) ui.addNotification(null, E('p', r.error));
                                else ui.addNotification(null, E('p', _('容器重启成功')), 'success');
                            } finally { ev.target.disabled = false; }
                        }
                    }, _('重启容器')),
                    
                    E('button', {
                        'class': 'cbi-button cbi-button-negative',
                        'click': async ev => {
                            if (!confirm(_('强制停止容器？VPN 隧道将立即断开。'))) return;
                            ev.target.disabled = true;
                            ui.showModal(null, E('p', { 'class': 'spinning' }, _('正在停止容器...')));
                            try {
                                await callStop();
                                ui.hideModal();
                                ui.addNotification(null, E('p', _('容器已停止')), 'success');
                            } finally { ev.target.disabled = false; }
                        }
                    }, _('强制停止容器'))
                ])
            ]);
        };

        return m.render();
    }
});
