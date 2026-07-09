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

return view.extend({
    title: _('IPsec VPN (hwdsl2) Settings'),

    render: function() {
        let m, s, o;

        m = new form.Map('ipsec-hwdsl2', _('IPsec VPN (hwdsl2) — Settings'),
            _('Configure the smart Docker container. Enabling the service auto-provisions and configures a restart-persistent IPsec server.'));

        s = m.section(form.TypedSection, 'global', _('Global Options'));
        s.anonymous = true;

        // Master Switch: Driving container start/stop lifecycle
        o = s.option(form.Flag, 'enabled', _('Enable VPN service'),
            _('When enabled, the daemon will provision or start the container. When disabled, the container is stopped.'));
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

        o = s.option(form.Value, 'container_name', _('Container name'),
            _('Name of the Docker container. Default: ipsec-vpn-server'));
        o.default = 'ipsec-vpn-server';
        o.rmempty = false;

        o = s.option(form.Value, 'image', _('Image'),
            _('Upstream setup image. Default: hwdsl2/ipsec-vpn-server:latest'));
        o.default = 'hwdsl2/ipsec-vpn-server:latest';
        o.rmempty = false;

        o = s.option(form.Value, 'volume', _('Volume mount path'),
            _('Mounted volume for certificate persistence. Format: volume_name:/etc/ipsec.d'));
        o.default = 'ikev2-vpn-data:/etc/ipsec.d';
        o.rmempty = false;

        s = m.section(form.TypedSection, 'global', _('Container Template Parameters'));
        s.anonymous = true;
        s.depends('enabled', '1');

        o = s.option(form.Value, 'vpn_ipsec_psk', _('IPsec Pre-Shared Key (PSK)'),
            _('Used for L2TP/IPsec and XAuth. Left blank to auto-generate a strong secure key.'));
        o.password = true;
        o.rmempty = true;

        o = s.option(form.Value, 'vpn_user', _('Default Administrator Username'),
            _('Initial VPN administrator. Default: vpnuser'));
        o.default = 'vpnuser';
        o.rmempty = true;

        o = s.option(form.Value, 'vpn_password', _('Default Administrator Password'),
            _('Password for default admin. Left blank to auto-generate.'));
        o.password = true;
        o.rmempty = true;

        o = s.option(form.Value, 'dns_srv1', _('DNS Server 1'), _('Primary DNS server. Default: 1.1.1.1'));
        o.default = '1.1.1.1';
        o.datatype = 'ip4addr';

        o = s.option(form.Value, 'dns_srv2', _('DNS Server 2'), _('Secondary DNS server. Default: 1.0.0.1'));
        o.default = '1.0.0.1';
        o.datatype = 'ip4addr';

        o = s.option(form.Value, 'public_ip', _('Public Server IP/Domain (Optional)'),
            _('If set, this will override auto-detected public IP in client config.'));
        o.datatype = 'host';
        o.rmempty = true;

        // Container actions
        s = m.section(form.TypedSection, 'global', _('Actions'));
        s.anonymous = true;
        s.render_actions = function() {
            return E('div', { 'class': 'cbi-section-actions' }, [
                E('button', {
                    'class': 'cbi-button cbi-button-apply',
                    'style': 'margin-right: 8px;',
                    'click': async ev => {
                        ev.target.disabled = true;
                        ui.showModal(null, E('p', { 'class': 'spinning' }, _('Restarting Docker container...')));
                        try {
                            const r = await callRestart();
                            ui.hideModal();
                            if (r.error) ui.addNotification(null, E('p', r.error));
                            else ui.addNotification(null, E('p', _('Container restarted successfully')), 'success');
                        } finally { ev.target.disabled = false; }
                    }
                }, _('Restart container')),
                
                E('button', {
                    'class': 'cbi-button cbi-button-negative',
                    'click': async ev => {
                        if (!confirm(_('Force stop the container? VPN tunnels will disconnect immediately.'))) return;
                        ev.target.disabled = true;
                        ui.showModal(null, E('p', { 'class': 'spinning' }, _('Stopping container...')));
                        try {
                            await callStop();
                            ui.hideModal();
                            ui.addNotification(null, E('p', _('Container stopped')), 'success');
                        } finally { ev.target.disabled = false; }
                    }
                }, _('Force Stop container'))
            ]);
        };

        return m.render();
    }
});
