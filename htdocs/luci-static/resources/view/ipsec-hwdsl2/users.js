'use strict';
'require view';
'require rpc';
'require ui';

const callList  = rpc.declare({ object: 'luci.ipsec_hwdsl2', method: 'users_list' });
const callAdd   = rpc.declare({ object: 'luci.ipsec_hwdsl2', method: 'user_add', params: ['name', 'password'] });
const callDelete= rpc.declare({ object: 'luci.ipsec_hwdsl2', method: 'user_delete', params: ['name'] });

return view.extend({
    title: _('L2TP / XAuth Users'),

    load: function() { return callList(); },

    removeUser: async function(name) {
        if (!confirm(_('Delete VPN user "') + name + _('"? This removes credentials from both chap-secrets and passwd.'))) return;
        ui.showModal(null, E('p', { 'class': 'spinning' }, _('Updating user database...')));
        const r = await callDelete(name);
        ui.hideModal();
        if (r.error) ui.addNotification(null, E('p', r.error));
        else { ui.addNotification(null, E('p', _('User ') + name + _(' deleted')), 'success'); this.refresh(); }
    },

    addUser: async function() {
        const name = prompt(_('New VPN username (alphanumeric, dash, underscore only):'));
        if (!name) return;
        if (!/^[A-Za-z0-9_-]+$/.test(name)) {
            ui.addNotification(null, E('p', _('Invalid username'))); return;
        }
        const pass = prompt(_('Enter VPN password:'));
        if (!pass) return;
        if (/["`$\\]/.test(pass)) {
            ui.addNotification(null, E('p', _('Password contains forbidden characters (", `, $, \\)'))); return;
        }

        ui.showModal(null, E('p', { 'class': 'spinning' }, _('Creating user accounts...')));
        const r = await callAdd(name, pass);
        ui.hideModal();
        if (r.error) ui.addNotification(null, E('p', r.error));
        else { ui.addNotification(null, E('p', _('User ') + name + _(' added')), 'success'); this.refresh(); }
    },

    renderTable: function(users) {
        const rows = (users || []).map(u => {
            const badges = [];
            if (u.l2tp_present) badges.push(E('span', { 'class': 'label success', 'style': 'margin-right:4px;' }, _('L2TP')));
            if (u.xauth_present) badges.push(E('span', { 'class': 'label info' }, _('XAuth')));
            return E('tr', { 'class': 'tr' }, [
                E('td', { 'class': 'td', 'style': 'font-weight:600;' }, u.name),
                E('td', { 'class': 'td' }, badges),
                E('td', { 'class': 'td cbi-section-actions' }, [
                    E('button', {
                        'class': 'cbi-button cbi-button-remove',
                        'click': ev => this.removeUser(u.name)
                    }, _('Delete'))
                ])
            ]);
        });

        return E('table', { 'class': 'table' }, [
            E('tr', { 'class': 'tr table-titles' }, [
                E('th', { 'class': 'th' }, _('Username')),
                E('th', { 'class': 'th' }, _('VPN Types')),
                E('th', { 'class': 'th', 'style': 'text-align: right;' }, _('Action'))
            ]),
            ...rows
        ]);
    },

    render: function(data) {
        const users = (data && data.users) || [];
        return E('div', { 'class': 'cbi-map' }, [
            E('h2', {}, _('L2TP / Cisco IPsec XAuth Users')),
            E('p', { 'class': 'cbi-map-descr' },
                _('PSK-based VPN accounts are double-written to both chap-secrets (L2TP/IPsec) and passwd (Cisco IPsec / XAuth) inside the container.')),
            E('div', { 'class': 'cbi-section' }, [
                E('legend', {}, _('Users list (') + (data && data.total || 0) + _(')')),
                this.renderTable(users)
            ]),
            E('div', { 'class': 'cbi-page-actions' }, [
                E('button', {
                    'class': 'cbi-button cbi-button-positive',
                    'click': ev => this.addUser()
                }, _('Add VPN user'))
            ])
        ]);
    }
});
