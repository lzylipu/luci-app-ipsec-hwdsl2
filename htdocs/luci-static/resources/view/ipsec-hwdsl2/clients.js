'use strict';
'require view';
'require rpc';
'require ui';
'require form';
'require dom';

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
        if (!confirm(_('吊销 IKEv2 客户端 "') + name + _('"? 这将立即阻止该客户端重新连接。'))) return;
        ui.showModal(null, E('p', { 'class': 'spinning' }, _('正在容器内吊销证书...')));
        const r = await callRevoke(name);
        ui.hideModal();
        if (r.error) ui.addNotification(null, E('p', r.error + (r.raw || '')));
        else { ui.addNotification(null, E('p', _('客户端 ') + name + _(' 已吊销')), 'success'); window.location.reload(); }
    },

    deleteClient: async function(name) {
        if (!confirm(_('永久删除客户端 "') + name + _('"? 此操作无法撤销。'))) return;
        ui.showModal(null, E('p', { 'class': 'spinning' }, _('正在删除证书元数据...')));
        const r = await callDelete(name);
        ui.hideModal();
        if (r.error) ui.addNotification(null, E('p', r.error + (r.raw || '')));
        else { ui.addNotification(null, E('p', _('客户端 ') + name + _(' 已删除')), 'success'); window.location.reload(); }
    },

    addClient: async function() {
        const name = prompt(_('新 IKEv2 客户端名称（仅限字母数字、连字符、下划线）:'));
        if (!name) return;
        if (!/^[A-Za-z0-9_-]+$/.test(name)) {
            ui.addNotification(null, E('p', _('无效的客户端名称'))); return;
        }
        
        const exists = this.clientsData.clients.some(c => c.name === name);
        if (exists) {
            ui.addNotification(null, E('p', _('该客户端名称已存在'))); return;
        }

        // 追加占位行并局部更新 UI
        this.clientsData.clients.push({ name: name, status: 'creating' });
        this.clientsData.total++;
        this.updateUI();

        try {
            const r = await callAdd(name);
            if (r.error) {
                ui.addNotification(null, E('p', _('添加客户端 ') + name + _(' 失败: ') + r.error));
                this.clientsData.clients = this.clientsData.clients.filter(c => c.name !== name);
                this.clientsData.total--;
                this.updateUI();
            } else {
                // 后端添加成功，重新调取列表刷新
                const freshData = await callList();
                this.clientsData = freshData || { clients: [], total: 0 };
                this.updateUI();
            }
        } catch (e) {
            ui.addNotification(null, E('p', _('添加客户端 ') + name + _(' 发生异常: ') + String(e)));
            this.clientsData.clients = this.clientsData.clients.filter(c => c.name !== name);
            this.clientsData.total--;
            this.updateUI();
        }
    },

    updateUI: function() {
        const container = document.getElementById('clients_table_container');
        if (container) {
            dom.content(container, this.renderTable(this.clientsData.clients));
        }
        const legend = document.getElementById('clients_legend');
        if (legend) {
            legend.textContent = _('证书列表 (') + this.clientsData.total + _(')');
        }
    },

    renderTable: function(clients) {
        const rows = (clients || []).map(c => {
            let statusClass = c.status === 'valid' ? 'success' :
                              c.status === 'revoked' ? 'error' :
                              c.status === 'creating' ? 'warning' : 'warning';
            
            let statusText = c.status === 'creating' ? _('创建中...') : c.status.toUpperCase();
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
            
            if (c.status !== 'creating') {
                actions.push(E('button', {
                    'class': 'cbi-button cbi-button-remove',
                    'click': ev => this.deleteClient(c.name)
                }, _('删除')));
            }

            return E('tr', { 'class': 'tr' }, [
                E('td', { 'class': 'td', 'style': 'font-weight:600;' }, c.name),
                E('td', { 'class': 'td' }, E('span', { 'class': 'label ' + statusClass }, statusText)),
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
        this.clientsData = data || { clients: [], total: 0 };
        const clients = this.clientsData.clients || [];
        
        return E('div', { 'class': 'cbi-map' }, [
            E('h2', {}, _('IKEv2 客户端证书')),
            E('p', { 'class': 'cbi-map-descr' },
                _('管理 IKEv2 模式的证书客户端。下载下方预构建的配置文件导入设备。')),
            E('div', { 'class': 'cbi-section' }, [
                E('legend', { 'id': 'clients_legend' }, _('证书列表 (') + this.clientsData.total + _(')')),
                E('div', { 'id': 'clients_table_container' }, this.renderTable(clients))
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
