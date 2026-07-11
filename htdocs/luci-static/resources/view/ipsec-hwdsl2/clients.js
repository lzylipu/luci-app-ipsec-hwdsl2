'use strict';
'require view';
'require rpc';
'require ui';
'require form';

const callList   = rpc.declare({ object: 'luci.ipsec_hwdsl2', method: 'clients_list' });
const callAdd    = rpc.declare({ object: 'luci.ipsec_hwdsl2', method: 'client_add', params: ['name'] });
const callRevoke = rpc.declare({ object: 'luci.ipsec_hwdsl2', method: 'client_revoke', params: ['name'] });
const callDelete = rpc.declare({ object: 'luci.ipsec_hwdsl2', method: 'client_delete', params: ['name'] });
const callDownload = rpc.declare({ object: 'luci.ipsec_hwdsl2', method: 'client_download', params: ['name', 'format'] });

return view.extend({
    title: _('IKEv2 客户端证书'),

    load: function() { return callList(); },

    downloadCert: async function(name, fmt) {
        try {
            ui.showModal(null, E('p', { 'class': 'spinning' }, _('正在获取客户端配置文件...')));
            const r = await callDownload(name, fmt);
            ui.hideModal();
            if (r.error) { ui.addNotification(null, E('p', r.error)); return; }
            
            // Binary safe base64 decoding (using atob safely inside Uint8Array mapping)
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
        } catch (e) {
            ui.hideModal();
            ui.addNotification(null, E('p', String(e)));
        }
    },

    revokeClient: async function(name) {
        if (!confirm(_('Revoke IKEv2 client "') + name + _('"? This blocks client reconnect immediately.'))) return;
        ui.showModal(null, E('p', { 'class': 'spinning' }, _('正在容器内吊销证书...')));
        const r = await callRevoke(name);
        ui.hideModal();
        if (r.error) ui.addNotification(null, E('p', r.error + (r.raw || '')));
        else { ui.addNotification(null, E('p', _('客户端 ') + name + _(' revoked')), 'success'); this.refresh(); }
    },

    deleteClient: async function(name) {
        if (!confirm(_('Permanently delete client "') + name + _('"? This cannot be undone.'))) return;
        ui.showModal(null, E('p', { 'class': 'spinning' }, _('正在删除证书元数据...')));
        const r = await callDelete(name);
        ui.hideModal();
        if (r.error) ui.addNotification(null, E('p', r.error + (r.raw || '')));
        else { ui.addNotification(null, E('p', _('客户端 ') + name + _(' deleted')), 'success'); this.refresh(); }
    },

    addClient: async function() {
        const name = prompt(_('新 IKEv2 客户端名称（仅限字母数字、连字符、下划线）:'));
        if (!name) return;
        if (!/^[A-Za-z0-9_-]+$/.test(name)) {
            ui.addNotification(null, E('p', _('无效的客户端名称'))); return;
        }
        ui.showModal(null, E('p', { 'class': 'spinning' }, _('正在容器内生成新证书（需要几秒钟）...')));
        const r = await callAdd(name);
        ui.hideModal();
        if (r.error) ui.addNotification(null, E('p', r.error + (r.raw || '')));
        else { ui.addNotification(null, E('p', _('客户端 ') + name + _(' added')), 'success'); this.refresh(); }
    },

    renderTable: function(clients) {
        const rows = (clients || []).map(c => {
            let statusClass = c.status === 'valid' ? 'success' :
                              c.status === 'revoked' ? 'error' : 'warning';
            let actions = [];
            if (c.status === 'valid') {
                actions.push(E('button', {
                    'class': 'cbi-button cbi-button-apply',
                    'style': 'margin-right: 4px;',
                    'click': ev => this.downloadCert(c.name, 'mobileconfig')
                }, _('iOS/macOS')));
                actions.push(E('button', {
                    'class': 'cbi-button',
                    'style': 'margin-right: 4px;',
                    'click': ev => this.downloadCert(c.name, 'sswan')
                }, _('Android strongSwan')));
                actions.push(E('button', {
                    'class': 'cbi-button',
                    'style': 'margin-right: 4px;',
                    'click': ev => this.downloadCert(c.name, 'p12')
                }, _('Windows/Linux')));
                actions.push(E('button', {
                    'class': 'cbi-button cbi-button-negative',
                    'style': 'margin-right: 4px;',
                    'click': ev => this.revokeClient(c.name)
                }, _('吊销')));
            }
            actions.push(E('button', {
                'class': 'cbi-button cbi-button-remove',
                'click': ev => this.deleteClient(c.name)
            }, _('删除')));

            return E('tr', { 'class': 'tr' }, [
                E('td', { 'class': 'td', 'style': 'font-weight:600;' }, c.name),
                E('td', { 'class': 'td' }, E('span', { 'class': 'label ' + statusClass }, c.status.toUpperCase())),
                E('td', { 'class': 'td cbi-section-actions' }, actions)
            ]);
        });

        return E('table', { 'class': 'table' }, [
            E('tr', { 'class': 'tr table-titles' }, [
                E('th', { 'class': 'th' }, _('客户端名称')),
                E('th', { 'class': 'th' }, _('证书状态')),
                E('th', { 'class': 'th', 'style': 'text-align: right;' }, _('操作'))
            ]),
            ...rows
        ]);
    },

    render: function(data) {
        const clients = (data && data.clients) || [];
        return E('div', { 'class': 'cbi-map' }, [
            E('h2', {}, _('IKEv2 客户端证书')),
            E('p', { 'class': 'cbi-map-descr' },
                _('管理 IKEv2 模式的证书客户端。下载下方预构建的配置文件导入设备。')),
            E('div', { 'class': 'cbi-section' }, [
                E('legend', {}, _('证书列表 (') + (data && data.total || 0) + _(')')),
                this.renderTable(clients)
            ]),
            E('div', { 'class': 'cbi-page-actions' }, [
                E('button', {
                    'class': 'cbi-button cbi-button-positive',
                    'click': ev => this.addClient()
                }, _('添加 IKEv2 客户端'))
            ])
        ]);
    }
});
