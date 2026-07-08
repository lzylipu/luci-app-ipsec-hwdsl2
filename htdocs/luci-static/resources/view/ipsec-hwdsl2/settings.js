'use strict';
'require view';
'require form';
'require rpc';
'require ui';

const callRestart = rpc.declare({ object: 'luci.ipsec_hwdsl2', method: 'container_restart' });

return view.extend({
    title: _('IPsec VPN (hwdsl2) Settings'),

    render: function() {
        let m, s, o;

        m = new form.Map('ipsec-hwdsl2', _('IPsec VPN (hwdsl2)'),
            _('Configure the upstream Docker container this LuCI app manages. None of these options change the container itself — they tell this app which container to drive via docker exec.'));

        s = m.section(form.TypedSection, 'global', _('Container options'));
        s.anonymous = true;

        o = s.option(form.Value, 'container_name', _('Container name'),
            _('Name of the running Docker container. Default: ipsec-vpn-server'));
        o.default = 'ipsec-vpn-server';
        o.rmempty = false;

        o = s.option(form.Value, 'image', _('Image'),
            _('The hwdsl2 image this app expects to be running.'));
        o.default = 'hwdsl2/ipsec-vpn-server:latest';
        o.rmempty = false;

        o = s.option(form.Value, 'volume', _('IKEv2 volume'),
            _('Docker volume mounted at /etc/ipsec.d inside the container. This is what makes IKEv2 client certs persist across container restarts. Format: name:/etc/ipsec.d'));
        o.default = 'ikev2-vpn-data:/etc/ipsec.d';
        o.rmempty = false;

        // 操作按钮: 重启容器
        s = m.section(form.TypedSection, 'global', _('Actions'));
        s.anonymous = true;
        s.render_actions = function() {
            return E('div', { 'class': 'cbi-section-actions' }, [
                E('button', {
                    'class': 'cbi-button cbi-button-apply',
                    'click': async ev => {
                        ev.target.disabled = true;
                        try {
                            const r = await callRestart();
                            if (r.error) ui.addNotification(null, E('p', r.error));
                            else ui.addNotification(null, E('p', _('Container restarted')), 'success');
                        } finally { ev.target.disabled = false; }
                    }
                }, _('Restart container'))
            ]);
        };

        return m.render();
    }
});
