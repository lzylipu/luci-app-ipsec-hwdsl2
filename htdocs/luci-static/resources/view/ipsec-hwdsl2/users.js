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

    renderTable: function(users) {
        const rows = (users || []).map(u => {
            const badges = [];
            if (u.l2tp_present) badges.push(E('span', { 'class': 'label' }, _('L2TP')));
            if (u.xauth_present) badges.push(E('span', { 'class': 'label' }, _('XAuth')));
            return E('tr', { 'class': 'tr' }, [
                E('td', { 'class': 'td' }, u.name),
                E('td', { 'class': 'td' }, badges),
                E('td', { 'class': 'td' }, [
                    E('button', {
                        'class': 'cbi-button cbi-button-remove',
                        'click': ev => this.removeUser(u.name)
                    }, _('Delete'))
                ])
            ]);
        });
        return E('table', { 'class': 'table' }, [
            E('tr', { 'class': 'tr table-titles' }, [
                E('th', { 'class': 'th' }, _('User')),
                E('th', { 'class': 'th' }, _('Type')),
                E('th', { 'class': 'th' }, _('Action'))
            ]),
            ...rows
        ]);
    },

    removeUser: async function(name) {
        if (!confirm(_('Delete VPN user "') + name + _('"? Removes from /etc/ppp/chap-secrets and /etc/ipsec.d/passwd.'))) return;
        const r = await callDelete(name);
        if (r.error) ui.addNotification(null, E('p', r.error + (r.raw || '')));
        else { ui.addNotification(null, E('p', _('User ') + name + _(' removed')), 'success'); this.refresh(); }
    },

    addUser: async function(ev) {
        const name = prompt(_('New VPN user name:'));
        if (!name) return;
        if (!/^[A-Za-z0-9_-]+$/.test(name)) {
            ui.addNotification(null, E('p', _('Invalid username'))); return;
        }
        const pass = prompt(_('Password:'));
        if (!pass) return;
        const r = await callAdd(name, pass);
        if (r.error) ui.addNotification(null, E('p', r.error + (r.raw || '')));
        else { ui.addNotification(null, E('p', _('User ') + name + _(' added')), 'success'); this.refresh(); }
    },

    render: function(data) {
        const users = (data && data.users) || [];
        return E('div', { 'class': 'cbi-map' }, [
            E('h2', {}, _('L2TP / XAuth Users')),
            E('p', { 'class': 'cbi-map-descr' },
                _('PSK-based VPN modes use named user accounts. Adding a user here appends to both /etc/ppp/chap-secrets (L2TP plaintext) and /etc/ipsec.d/passwd (XAuth MD5-crypt).')),
            E('div', { 'class': 'cbi-section' }, [
                E('h3', {}, _('Existing users (' + (data && data.total || 0) + ')')),
                this.renderTable(users)
            ]),
            E('div', { 'class': 'cbi-page-actions' }, [
                E('button', {
                    'class': 'cbi-button cbi-button-positive',
                    'click': ev => this.addUser(ev)
                }, _('Add VPN user'))
            ])
        ]);
    }
});
