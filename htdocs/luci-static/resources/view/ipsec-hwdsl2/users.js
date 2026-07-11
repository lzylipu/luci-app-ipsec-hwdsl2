'use strict';
'require view';
'require rpc';
'require ui';

const callList  = rpc.declare({ object: 'luci.ipsec_hwdsl2', method: 'users_list' });
const callAdd   = rpc.declare({ object: 'luci.ipsec_hwdsl2', method: 'user_add', params: ['name', 'password'] });
const callDelete= rpc.declare({ object: 'luci.ipsec_hwdsl2', method: 'user_delete', params: ['name'] });

return view.extend({
    title: _('L2TP / XAuth 用户'),

    load: function() { return callList(); },

    removeUser: async function(name) {
        if (!confirm(_('Delete VPN user "') + name + _('"? This removes credentials from both chap-secrets and passwd.'))) return;
        ui.showModal(null, E('p', { 'class': 'spinning' }, _('正在更新用户数据库...')));
        const r = await callDelete(name);
        ui.hideModal();
        if (r.error) ui.addNotification(null, E('p', r.error));
        else { ui.addNotification(null, E('p', _('用户 ') + name + _(' deleted')), 'success'); window.location.reload(); }
    },

    addUser: async function() {
        const name = prompt(_('新 VPN 用户名（仅限字母数字、连字符、下划线）:'));
        if (!name) return;
        if (!/^[A-Za-z0-9_-]+$/.test(name)) {
            ui.addNotification(null, E('p', _('无效的用户名'))); return;
        }
        const pass = prompt(_('输入 VPN 密码:'));
        if (!pass) return;
        if (/["`$\\]/.test(pass)) {
            ui.addNotification(null, E('p', _('Password contains forbidden characters (", `, $, \\)'))); return;
        }

        ui.showModal(null, E('p', { 'class': 'spinning' }, _('正在创建用户账户...')));
        const r = await callAdd(name, pass);
        ui.hideModal();
        if (r.error) ui.addNotification(null, E('p', r.error));
        else { ui.addNotification(null, E('p', _('用户 ') + name + _(' added')), 'success'); window.location.reload(); }
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
                    }, _('删除'))
                ])
            ]);
        });

        return E('table', { 'class': 'table' }, [
            E('tr', { 'class': 'tr table-titles' }, [
                E('th', { 'class': 'th' }, _('用户名')),
                E('th', { 'class': 'th' }, _('VPN 类型')),
                E('th', { 'class': 'th', 'style': 'text-align: right;' }, _('操作'))
            ]),
            ...rows
        ]);
    },

    render: function(data) {
        const users = (data && data.users) || [];
        return E('div', { 'class': 'cbi-map' }, [
            E('h2', {}, _('L2TP / Cisco IPsec XAuth 用户')),
            E('p', { 'class': 'cbi-map-descr' },
                _('基于 PSK 的 VPN 账户会同时写入容器内的 chap-secrets (L2TP/IPsec) 和 passwd (Cisco IPsec / XAuth)。')),
            E('div', { 'class': 'cbi-section' }, [
                E('legend', {}, _('用户列表 (') + (data && data.total || 0) + _(')')),
                this.renderTable(users)
            ]),
            E('div', { 'class': 'cbi-page-actions' }, [
                E('button', {
                    'class': 'cbi-button cbi-button-positive',
                    'click': ev => this.addUser()
                }, _('添加 VPN 用户'))
            ])
        ]);
    }
});
