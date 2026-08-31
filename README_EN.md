# 🛡️ luci-app-ipsec-hwdsl2

**LuCI Web UI for the hwdsl2/IPsec VPN Docker Container**

**English | [简体中文](./README.md)**

---

> 🛡️ A LuCI visual management panel for the [hwdsl2/ipsec-vpn-server](https://github.com/hwdsl2/docker-ipsec-vpn-server) Docker container — Libreswan IKEv2 certificates, L2TP/IPsec pre-shared keys and Cisco IPsec XAuth, all managed from your router's web UI.

---

## ✨ Features

* **🔌 Smart Container Lifecycle** — When enabled, if no matching Docker container exists, a restart-persistent IPsec server container is provisioned automatically from the built-in template. When disabled, the container is stopped to free network ports.
* **🔑 Secure Key Generation** — If the Pre-Shared Key (PSK) or admin credentials are left blank, strong random secrets are generated automatically and written back to UCI for instant use.
* **📂 Certificate Management** — Visual management of IKEv2 client certificates: create, revoke and delete in one place.
* **💾 Binary-safe Config Export** — Client profiles download via container-side Base64 streaming with zero corruption: `.mobileconfig` (Apple native), `.sswan` (Android strongSwan), `.p12` (Windows/Linux).
* **👥 Multi-user Management** — Visual management of L2TP/IPsec and Cisco IPsec XAuth users, safely double-written to the container's `chap-secrets` (L2TP) and `passwd` (XAuth) credential stores.
* **🎨 Passwall2 Visual Standard** — Top 5-card status grid redesigned per the Passwall2 visual spec, with click-to-test connectivity, live client tunnel details and real-time log streaming.

## 🚀 Installation & Integration

The plugin builds through the standard OpenWrt/ImmortalWrt `luci.mk` pipeline. In the [ImageBuilder workflow](https://github.com/lzylipu/ImmortalWrt-ImageBuilder), wire the source into `feeds.conf.custom` and it is packaged into the firmware in one go.

## 📝 Credits / Attribution

A router-side management shell built for Lin Song ([@hwdsl2](https://github.com/hwdsl2))'s excellent [setup-ipsec-vpn](https://github.com/hwdsl2/setup-ipsec-vpn) platform. It does not replace or modify the upstream image structure.

## 📄 License

[MIT](./LICENSE) License
