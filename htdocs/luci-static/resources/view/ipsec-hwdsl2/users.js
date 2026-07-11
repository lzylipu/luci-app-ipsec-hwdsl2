'use strict';
'require view';
'require rpc';
'require ui';
'require dom';

const callList  = rpc.declare({ object: 'luci.ipsec_hwdsl2', method: 'users_list' });
const callAdd   = rpc.declare({ object: 'luci.ipsec_hwdsl2', method: 'user_add', params: ['name', 'password'] });
const callDelete= rpc.declare({ object: 'luci.ipsec_hwdsl2', method: 'user_delete', params: ['name'] });

return view.extend({
    title: _('L2TP / Cisco IPsec XAuth 用户'),

    load: function() { return callList(); },

    removeUser: async function(name) {
        if (!confirm(_('删除 VPN 用户 "') + name + _('"? 这将同时从 chap-secrets 和 passwd 中删除凭据。'))) return;
        ui.showModal(null, E('p', { 'class': 'spinning' }, _('正在更新用户数据库...')));
        const r = await callDelete(name);
        ui.hideModal();
        if (r.error) ui.addNotification(null, E('p', r.error));
        else { ui.addNotification(null, E('p', _('用户 ') + name + _(' 已删除')), 'success'); window.location.reload(); }
    },

    addUser: async function() {
        const name = prompt(_('新 VPN 用户名（仅限字母数字、连字符、下划线）:'));
        if (!name) return;
        if (!/^[A-Za-z0-9_-]+$/.test(name)) {
            ui.addNotification(null, E('p', _('无效的用户名'))); return;
        }
        
        const exists = this.usersData.users.some(u => u.name === name);
        if (exists) {
            ui.addNotification(null, E('p', _('该用户名已存在'))); return;
        }

        const pass = prompt(_('输入 VPN 密码:'));
        if (!pass) return;
        if (/["`$\\]/.test(pass)) {
            ui.addNotification(null, E('p', _('密码包含非法字符 (双引号、反单引号、美元符号、反斜杠)'))); return;
        }

        // 追加占位行并局部更新 UI
        this.usersData.users.push({
            name: name,
            l2tp_present: true,
            xauth_present: true,
            status: 'creating'
        });
        this.usersData.total++;
        this.updateUI();

        try {
            const r = await callAdd(name, pass);
            if (r.error) {
                ui.addNotification(null, E('p', _('创建用户 ') + name + _(' 失败: ') + r.error));
                this.usersData.users = this.usersData.users.filter(u => u.name !== name);
                this.usersData.total--;
                this.updateUI();
            } else {
                // 成功后，重新获取最新列表
                const freshData = await callList();
                this.usersData = freshData || { users: [], total: 0 };
                this.updateUI();
            }
        } catch (e) {
            ui.addNotification(null, E('p', _('创建用户 ') + name + _(' 发生异常: ') + String(e)));
            this.usersData.users = this.usersData.users.filter(u => u.name !== name);
            this.usersData.total--;
            this.updateUI();
        }
    },

    updateUI: function() {
        const container = document.getElementById('users_table_container');
        if (container) {
            dom.content(container, this.renderTable(this.usersData.users));
        }
        const legend = document.getElementById('users_legend');
        if (legend) {
            legend.textContent = _('用户列表 (') + this.usersData.total + _(')');
        }
    },

    renderTable: function(users) {
        const rows = (users || []).map(u => {
            const badges = [];
            if (u.status === 'creating') {
                badges.push(E('span', { 'class': 'label warning' }, _('创建中...')));
            } else {
                if (u.l2tp_present) badges.push(E('span', { 'class': 'label success', 'style': 'margin-right:4px;' }, _('L2TP')));
                if (u.xauth_present) badges.push(E('span', { 'class': 'label info' }, _('XAuth')));
            }
            
            let actions = [];
            if (u.status !== 'creating') {
                actions.push(E('button', {
                    'class': 'cbi-button cbi-button-remove',
                    'click': ev => this.removeUser(u.name)
                }, _('删除')));
            }

            return E('tr', { 'class': 'tr' }, [
                E('td', { 'class': 'td', 'style': 'font-weight:600;' }, u.name),
                E('td', { 'class': 'td' }, badges),
                E('td', { 'class': 'td cbi-section-actions' }, actions)
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
        this.usersData = data || { users: [], total: 0 };
        const users = this.usersData.users || [];
        
        return E('div', { 'class': 'cbi-map' }, [
            E('h2', {}, _('L2TP / Cisco IPsec XAuth 用户')),
            E('p', { 'class': 'cbi-map-descr' },
                _('基于 PSK 的 VPN 账户会同时写入容器内的 chap-secrets (L2TP/IPsec) 和 passwd (Cisco IPsec / XAuth)。')),
            E('div', { 'class': 'cbi-section' }, [
                E('legend', { 'id': 'users_legend' }, _('用户列表 (') + this.usersData.total + _(')')),
                E('div', { 'id': 'users_table_container' }, this.renderTable(users))
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
