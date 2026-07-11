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
            _('配置并运行重启后持久化的 IPsec 服务器。所有参数保存在系统唯一的 global 选项中。'));

        // 声明系统唯一的 TypedSection 实例
        s = m.section(form.TypedSection, 'global', _('配置参数与操作'));
        s.anonymous = true;

        // 1. 启用状态开关
        o = s.option(form.Flag, 'enabled', _('启用 VPN 服务'),
            _('启用时守护进程将创建或启动容器。禁用时容器将被停止。'));
        o.default = '0';
        o.rmempty = false;

        o.write = function(section_id, value) {
            form.Flag.prototype.write.call(this, section_id, value);
            if (value === '1') {
                callStart();
            } else {
                callStop();
            }
        };

        // 2. 基础容器设置
        o = s.option(form.Value, 'container_name', _('容器名称'),
            _('Docker 容器名称。默认: ipsec-vpn-server'));
        o.default = 'ipsec-vpn-server';
        o.rmempty = false;

        o = s.option(form.Value, 'image', _('镜像'),
            _('上游安装镜像。默认: hwdsl2/ipsec-vpn-server:latest'));
        o.default = 'hwdsl2/ipsec-vpn-server:latest';
        o.rmempty = false;

        o = s.option(form.Value, 'volume', _('挂载卷/宿主机映射路径'),
            _('证书持久化存储路径。容器内部 /etc/ipsec.d 的所有证书和密钥将持久化于此卷。导入导出及跨机迁移时均自动对接此目录，实现一键无缝还原。默认: ikev2-vpn-data:/etc/ipsec.d'));
        o.default = 'ikev2-vpn-data:/etc/ipsec.d';
        o.rmempty = false;

        // 3. 密钥与账号参数
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

        // 4. DNS 和服务器参数
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

        // 5. 管理按钮
        o = s.option(form.Button, '_export', _('导出配置备份'), _('将 VPN 容器的证书、账号密码及宿主机 ipsec.env 配置一键打包下载。'));
        o.inputstyle = 'apply';
        o.onclick = async function(ev) {
            ui.showModal(null, E('p', { 'class': 'spinning' }, _('正在打包并导出 VPN 备份...')));
            try {
                const r = await callExport();
                ui.hideModal();
                if (r.error) {
                    ui.addNotification(null, E('p', _('备份失败: ') + r.error));
                } else if (r.url) {
                    const a = E('a', { href: r.url, download: 'ipsec-vpn-backup.tar.gz' });
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                    ui.addNotification(null, E('p', _('配置备份下载成功')), 'success');
                } else {
                    ui.addNotification(null, E('p', _('备份失败：未返回有效的下载路径')));
                }
            } catch (err) {
                ui.hideModal();
                ui.addNotification(null, E('p', String(err)));
            }
        };

        o = s.option(form.Button, '_import', _('导入配置备份'), _('上传已有备份包（.tar.gz 或 .zip），自动恢复 data 目录、ipsec.env 等配置并重建容器。'));
        o.inputstyle = 'action';
        o.onclick = function(ev) {
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
        };

        o = s.option(form.Button, '_restart', _('重启容器'), _('重启当前 IPsec Docker 容器以应用配置更改。'));
        o.inputstyle = 'apply';
        o.onclick = async function(ev) {
            ui.showModal(null, E('p', { 'class': 'spinning' }, _('正在重启 Docker 容器...')));
            try {
                const r = await callRestart();
                ui.hideModal();
                if (r.error) ui.addNotification(null, E('p', r.error));
                else ui.addNotification(null, E('p', _('容器重启成功')), 'success');
            } catch (err) {
                ui.hideModal();
                ui.addNotification(null, E('p', String(err)));
            }
        };

        o = s.option(form.Button, '_stop', _('强制停止容器'), _('立即强制停止并关闭当前运行的 IPsec 容器。'));
        o.inputstyle = 'negative';
        o.onclick = async function(ev) {
            if (!confirm(_('强制停止容器？VPN 隧道将立即断开。'))) return;
            ui.showModal(null, E('p', { 'class': 'spinning' }, _('正在停止容器...')));
            try {
                await callStop();
                ui.hideModal();
                ui.addNotification(null, E('p', _('容器已停止')), 'success');
            } catch (err) {
                ui.hideModal();
                ui.addNotification(null, E('p', String(err)));
            }
        };

        return m.render();
    }
});
