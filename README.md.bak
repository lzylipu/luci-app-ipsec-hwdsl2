<div align="center">

# 🛡️ luci-app-ipsec-hwdsl2

**OpenWrt/ImmortalWrt 上的 IPsec VPN 可视化管理面板**

[![Platform](https://img.shields.io/badge/Platform-OpenWrt%20%7C%20ImmortalWrt-blue?style=flat-square&logo=openwrt)](https://openwrt.org/)
[![Backend](https://img.shields.io/badge/Backend-hwdsl2%2Fipsec--vpn--server-2496ED?style=flat-square&logo=docker&logoColor=white)](https://github.com/hwdsl2/docker-ipsec-vpn-server)
[![License](https://img.shields.io/github/license/lzylipu/luci-app-ipsec-hwdsl2?style=flat-square)](./LICENSE)

**🌐 English | [简体中文](#-简体中文)**

</div>

> 🛡️ 一套运行在路由器上的 IPsec VPN 可视化控制面：容器自动拉停、密钥自动生成、证书与用户全图形化管理，二进制配置文件无损下载。

---

## 🌐 English

LuCI Web UI for managing the [hwdsl2/ipsec-vpn-server](https://github.com/hwdsl2/docker-ipsec-vpn-server) Docker container (Libreswan IKEv2 + L2TP/IPsec PSK + Cisco IPsec XAuth).

### ✨ Features
* **🔌 Smart Docker Lifecycle**: Auto-provisions and configures a restart-persistent IPsec server container if it does not exist when enabled. Stops the container when disabled to free network ports.
* **🔑 Secure Key Generation**: Automatically generates robust random Pre-Shared Keys (PSK) and admin credentials if left blank, saving them back to UCI for instant usage.
* **📂 Certificate Management**: Visual management of IKEv2 client certificates (Add, Revoke, Delete).
* **💾 Binary Safe Config Export**: Safe download of pre-configured client profiles (`.mobileconfig` for Apple native, `.sswan` for Android strongSwan, `.p12` for Windows/Linux) using container-side Base64 streaming.
* **👥 Multi-user Accounts**: Visual management of L2TP/IPsec and Cisco IPsec XAuth users (double-written safely to chap-secrets and passwd).
* **🎨 Modern UI Design**: Follows **Passwall2** LuCI design guidelines, featuring a responsive 5-card status grid, real-time live tunnel statistics, and diagnostic daemon log streams.

### 📝 Credits / Attribution
This project is built to manage the upstream image maintained by Lin Song ([@hwdsl2](https://github.com/hwdsl2)), wrapping the de-facto standard [setup-ipsec-vpn](https://github.com/hwdsl2/setup-ipsec-vpn) Extra tools. It does not replace or modify the upstream image structure.

---

## 🇨🇳 简体中文

适用于管理 [hwdsl2/ipsec-vpn-server](https://github.com/hwdsl2/docker-ipsec-vpn-server) Docker 容器的 LuCI 可视化管理面板（支持 Libreswan IKEv2 证书、L2TP/IPsec 预共享密钥 及 Cisco IPsec XAuth）。

### ✨ 核心特性
* **🔌 智能容器生命周期**: 主开关开启时若系统内不存在对应的 Docker 容器，会套用内置模板**自动拉起并运行新容器**；主开关关闭时自动 `docker stop` 容器，释放系统网络资源，实现秒级持久化启停。
* **🔑 安全密钥自生成**: 在首次自动部署时，若预共享密钥（PSK）和管理员密码留空，系统将**自动在后台生成高强度随机密码**并回填至 UCI，方便在客户端查看及使用。
* **📂 证书管理**: 轻松管理 IKEv2 客户端证书，支持一键创建、吊销（Revoke）与删除，安全控制设备接入权限。
* **💾 配置文件安全下载**: 后端采用 Base64 数据流直传，二进制无损下载 iOS/macOS 描述文件 (`.mobileconfig`)、安卓强天鹅配置 (`.sswan`) 及 Windows 证书包 (`.p12`)。
* **👥 双写用户管理**: 统一管理 PSK 传统账号，安全双写至容器内的 `chap-secrets` (L2TP) 和 `passwd` (XAuth) 凭据库。
* **🎨 Passwall2 视觉规范**: 借鉴 Passwall2 视觉规范，重新设计了顶部 5 卡片状态栅格，支持点击测试连通性，并集成在线客户端隧道连接详情与日志实时滚动展示。

### 📝 项目声明
本项目是针对 Lin Song ([@hwdsl2](https://github.com/hwdsl2)) 优秀的 [setup-ipsec-vpn](https://github.com/hwdsl2/setup-ipsec-vpn) 容器平台开发的路由器管理面板壳，旨在不破坏上游生态的前提下为 OpenWrt/ImmortalWrt 提供便捷的控制面。

### 🚀 安装与集成
本插件可通过 ImmortalWrt/OpenWrt 标准 `luci.mk` 进线编译。在 ImageBuilder 工作流中，将源集成到 `feeds.conf.custom` 即可一键打包。

---

## 📄 许可证 / License

[MIT](./LICENSE) License
