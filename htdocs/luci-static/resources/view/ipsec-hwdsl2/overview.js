'use strict';
'require view';
'require rpc';
'require ui';

const callStatus = rpc.declare({
    object: 'luci.ipsec_hwdsl2',
    method: 'container_status',
});

const callStart = rpc.declare({ object: 'luci.ipsec_hwdsl2', method: 'container_start' });
const callStop = rpc.declare({ object: 'luci.ipsec_hwdsl2', method: 'container_stop' });

return view.extend({
    title: _('IPsec VPN Server (hwdsl2) — Overview'),

    load: function() {
        return callStatus();
    },

    checkConnect: function(ev, type, host) {
        const btn = ev.target;
        const parent = btn.parentNode;
        btn.style.display = 'none';
        
        const statusSpan = E('span', { 'class': 'spinner' }, _('Checking...'));
        parent.appendChild(statusSpan);

        // Fetch using browser to verify real client-side outbound connectivity
        const start = new Date().getTime();
        fetch('https://' + host + '/favicon.ico', { mode: 'no-cors', cache: 'no-cache' })
            .then(() => {
                const duration = new Date().getTime() - start;
                statusSpan.className = duration < 1000 ? 'green' : 'yellow';
                statusSpan.textContent = duration + ' ms';
            })
            .catch(() => {
                statusSpan.className = 'red';
                statusSpan.textContent = _('Problem detected!');
            });
    },

    render: function(status) {
        status = status || {};
        
        // CSS for Passwall2 styled grids and cards
        const css = E('style', {}, `
            .pw2-grid {
                display: flex;
                flex-wrap: wrap;
                margin: -0.5rem;
            }
            .pw2-col {
                flex: 1 1 20%;
                min-width: 180px;
                padding: 0.5rem;
            }
            .pw2-card {
                background: var(--background-cbi-section, #fff);
                border: 1px solid rgba(0, 0, 0, 0.05);
                border-radius: 0.375rem;
                padding: 1rem;
                box-shadow: 0 0 2rem 0 rgba(136, 152, 170, 0.05);
                display: flex;
                align-items: center;
                min-height: 70px;
            }
            .pw2-icon-circle {
                width: 40px;
                height: 40px;
                border-radius: 50%;
                display: flex;
                align-items: center;
                justify-content: center;
                margin-right: 0.75rem;
                color: #fff;
                font-weight: bold;
                font-size: 1.2rem;
            }
            .bg-green { background-color: #2dce89; }
            .bg-red { background-color: #fb6340; }
            .bg-blue { background-color: #5e72e4; }
            .bg-grey { background-color: #adb5bd; }
            .pw2-info h4 {
                margin: 0;
                font-size: 0.8rem;
                color: #8898aa !important;
                text-transform: uppercase;
                letter-spacing: 1px;
            }
            .pw2-status-val {
                font-size: 1rem;
                font-weight: 600;
                margin-top: 0.25rem;
                display: block;
            }
            .green { color: #2dce89 !important; }
            .red { color: #fb6340 !important; }
            .yellow { color: #fb9a05 !important; }
            .check-link {
                color: #5e72e4;
                text-decoration: none;
                cursor: pointer;
                font-size: 0.9rem;
            }
        `);

        // Cards list
        const cards = E('div', { 'class': 'pw2-grid' }, [
            // Container Card
            E('div', { 'class': 'pw2-col' }, E('div', { 'class': 'pw2-card' }, [
                E('div', { 'class': 'pw2-icon-circle ' + (status.running ? 'bg-green' : 'bg-red') }, 'C'),
                E('div', { 'class': 'pw2-info' }, [
                    E('h4', {}, _('Container')),
                    E('span', { 'class': 'pw2-status-val ' + (status.running ? 'green' : 'red') },
                        status.running ? _('RUNNING') : _('NOT RUNNING'))
                ])
            ])),
            // IKEv2 Server Card
            E('div', { 'class': 'pw2-col' }, E('div', { 'class': 'pw2-card' }, [
                E('div', { 'class': 'pw2-icon-circle ' + (status.running ? 'bg-green' : 'bg-red') }, '2'),
                E('div', { 'class': 'pw2-info' }, [
                    E('h4', {}, _('IKEv2 Server')),
                    E('span', { 'class': 'pw2-status-val ' + (status.running ? 'green' : 'red') },
                        status.running ? _('RUNNING') : _('NOT RUNNING'))
                ])
            ])),
            // L2TP/IPsec Card
            E('div', { 'class': 'pw2-col' }, E('div', { 'class': 'pw2-card' }, [
                E('div', { 'class': 'pw2-icon-circle ' + (status.running ? 'bg-green' : 'bg-red') }, 'L'),
                E('div', { 'class': 'pw2-info' }, [
                    E('h4', {}, _('L2TP Daemon')),
                    E('span', { 'class': 'pw2-status-val ' + (status.running ? 'green' : 'red') },
                        status.running ? _('RUNNING') : _('NOT RUNNING'))
                ])
            ])),
            // Baidu Connection Check Card
            E('div', { 'class': 'pw2-col' }, E('div', { 'class': 'pw2-card' }, [
                E('div', { 'class': 'pw2-icon-circle bg-blue' }, 'B'),
                E('div', { 'class': 'pw2-info' }, [
                    E('h4', {}, _('Baidu Conn.')),
                    E('span', { 'class': 'pw2-status-val' }, [
                        E('a', {
                            'class': 'check-link',
                            'click': ev => this.checkConnect(ev, 'baidu', 'www.baidu.com')
                        }, _('Touch Check'))
                    ])
                ])
            ])),
            // GitHub Connection Check Card
            E('div', { 'class': 'pw2-col' }, E('div', { 'class': 'pw2-card' }, [
                E('div', { 'class': 'pw2-icon-circle bg-blue' }, 'G'),
                E('div', { 'class': 'pw2-info' }, [
                    E('h4', {}, _('GitHub Conn.')),
                    E('span', { 'class': 'pw2-status-val' }, [
                        E('a', {
                            'class': 'check-link',
                            'click': ev => this.checkConnect(ev, 'github', 'github.com')
                        }, _('Touch Check'))
                    ])
                ])
            ]))
        ]);

        // Container info details
        let details_box = null;
        if (status.running) {
            let active_sa_descr = _('No clients currently connected.');
            if (status.active_sa && status.active_sa > 0) {
                active_sa_descr = _('Active tunnels count: ') + status.active_sa;
            }

            details_box = E('div', { 'class': 'cbi-section' }, [
                E('h3', {}, _('Active Tunnels (Live SA)')),
                E('p', { 'class': 'cbi-map-descr' }, active_sa_descr),
                status.active_sa_detail && status.active_sa_detail.length ?
                    E('pre', { 'class': 'cbi-code', 'style': 'font-size:11px; white-space:pre-wrap;' },
                        status.active_sa_detail.join('\n')) : null,

                E('h3', {}, _('Libreswan Daemon Status')),
                E('pre', {
                    'class': 'cbi-code',
                    'style': 'max-height:220px; overflow:auto; font-size:11px; white-space:pre-wrap;'
                }, status.daemon || _('Daemon logs empty'))
            ]);
        } else {
            details_box = E('div', { 'class': 'alert warning' }, [
                E('strong', {}, _('Container inactive.')),
                E('p', {}, _('Go to Settings and enable the VPN switch to provision and run the container.'))
            ]);
        }

        return E('div', { 'class': 'cbi-map' }, [
            css,
            E('h2', {}, _('IPsec VPN Server (hwdsl2)')),
            E('p', { 'class': 'cbi-map-descr' },
                _('Visual client and user credential manager for Libreswan IKEv2, L2TP, and Cisco IPsec XAuth.')),
            E('div', { 'class': 'cbi-section' }, [
                E('legend', {}, _('Running Status')),
                cards
            ]),
            details_box
        ]);
    }
});
