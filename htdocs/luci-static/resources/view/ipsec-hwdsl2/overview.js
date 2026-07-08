'use strict';
'require view';
'require rpc';
'require ui';

const callStatus = rpc.declare({
    object: 'luci.ipsec_hwdsl2',
    method: 'container_status',
});

return view.extend({
    title: _('IPsec VPN Server (hwdsl2) — Overview'),

    load: function() {
        return Promise.all([
            callStatus(),
            Promise.resolve(null)
        ]);
    },

    render: function(data) {
        const status = data[0] || {};
        let container_box, daemon_box, sa_box;

        if (!status.running) {
            container_box = E('div', { 'class': 'alert warning' }, [
                E('strong', {}, _('Container not running')),
                E('br'),
                _('The hwdsl2 container "') + (status.image || 'ipsec-vpn-server') + _('(" was not detected on this host. Pull and start it first via Settings → Container Management.')
            ]);
        } else {
            container_box = E('div', { 'class': 'alert success' }, [
                E('strong', {}, _('Container running')),
                E('br'),
                E('span', {}, _('Image: ') + (status.image || 'unknown')),
                E('br'),
                E('span', {}, _('Ports: ') + (status.ports || '500/udp, 4500/udp'))
            ]);
        }

        if (status.daemon) {
            daemon_box = E('div', { 'class': 'cbi-section' }, [
                E('h3', {}, _('Libreswan daemon')),
                E('pre', { 'class': 'cbi-code',
                    'style': 'max-height:300px;overflow:auto;font-size:11px;white-space:pre-wrap;'
                }, status.daemon)
            ]);
        } else {
            daemon_box = E('div', { 'class': 'alert' }, _('Daemon info unavailable'));
        }

        let sa_text = _('No active VPN connections');
        if (status.active_sa && status.active_sa > 0) {
            sa_text = _('Active connections: ') + status.active_sa;
        }
        sa_box = E('div', { 'class': 'cbi-section' }, [
            E('h3', {}, _('Active SA (live tunnels)')),
            E('p', {}, sa_text),
            status.active_sa_detail && status.active_sa_detail.length ?
                E('pre', { 'style': 'font-size:11px;white-space:pre-wrap;' },
                    status.active_sa_detail.join('\n')) :
                E('p', { 'class': 'cbi-map-descr' },
                    _('No clients currently connected.'))
        ]);

        return E('div', { 'class': 'cbi-map' }, [
            E('h2', {}, _('Overview')),
            container_box,
            sa_box,
            daemon_box
        ]);
    }
});
