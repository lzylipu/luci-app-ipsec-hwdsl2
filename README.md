# luci-app-ipsec-hwdsl2

**LuCI App for managing the [hwdsl2/ipsec-vpn-server](https://github.com/hwdsl2/docker-ipsec-vpn-server) Docker container.**

Provides a visual web UI for IPsec VPN multi-user management on ImmortalWrt / OpenWrt routers, wrapping the upstream `hwdsl2/setup-ipsec-vpn` Libreswan image (IKEv2 + L2TP/IPsec PSK + IPsec/XAuth ("Cisco IPsec")).

## What it does

| Feature                            | Backing command / mechanism                                           |
| ---------------------------------- | --------------------------------------------------------------------- |
| IKEv2 client certificate list      | `docker exec <cn> /opt/src/ikev2.sh --listclients`                     |
| Add IKEv2 client (signs cert)      | `docker exec <cn> /opt/src/ikev2.sh --addclient <name> --yes`          |
| Revoke IKEv2 client (writes CRL)   | `docker exec <cn> /opt/src/ikev2.sh --revokeclient <name> --yes`       |
| Delete IKEv2 client                 | `docker exec <cn> /opt/src/ikev2.sh --deleteclient <name> --yes`       |
| Download client config (.p12 / .mobileconfig / .sswan) | `docker exec <cn> cat /etc/ipsec.d/<name>.<ext>`       |
| L2TP / XAuth user list             | `docker exec <cn> cat /etc/ppp/chap-secrets` + `cat /etc/ipsec.d/passwd` |
| Add L2TP / XAuth user (double-write) | `echo >> /etc/ppp/chap-secrets` + `openssl passwd -1 | echo >> /etc/ipsec.d/passwd` |
| Delete L2TP / XAuth user           | `sed -i '/pattern/d` in both files                                     |
| Container status / live SA         | `ipsec whack --status` + `ipsec whack --trafficstatus`               |
| Restart container                  | `docker restart <cn>`                                                  |

All management goes through:
1. **docker exec** → upstream `ikev2.sh` script (for IKEv2 certificate operations), and
2. **direct file read/write** on the mounted volume for L2TP/XAuth user credentials.

**This app does NOT fork, modify, or replace the upstream image.** It only drives the upstream container from the router side.

## Why

The hwdsl2 image has been continuously maintained by Lin Song for 7+ years and bundles both IKEv1 (L2TP/IPsec PSK + IPsec/XAuth) and IKEv2 (certificate-based) tunnels with mobile auto-configuration distribution (.p12 / .mobileconfig / .sswan). It is the de-facto "just works" IPsec Docker image.

There is no LuCI app in upstream OpenWrt/ImmortalWrt that:
- manages a hwdsl2 container's users/clients visually, OR
- exposes IKEv2 client certificate operations to the user.

Prior options:
- `luci-app-ipsec-vpnd` (community): bundles its own strongSwan with init.d controlling `ipsec.conf`. Its LuCI form only exposes 6 IKEv1 xauth_psk fields. Adding IKEv2 cert management to it ≈ 5 days work (swanctl migration is the hard part).
- `luci-app-dockerman`: full Docker socket wrapper, no IPsec-specific operations.

This app's design is the minimum-glue layer: it speaks the upstream `ikev2.sh` text protocol (-parser for the `--listclients` table + `ipsec whack --trafficstatus` output) and reads/writes two plain text credential files. No schema migration, no stroke→swanctl translation, no daemon supervision — just ops on the upstream container.

## Architecture

```
┌────────────────────────────────────────────────────────────┐
│ ImmortalWrt router                                          │
│                                                              │
│  ┌─────────────────────────┐    ┌──────────────────────────┐│
│  │ LuCI web UI             │    │ /var/run/docker.sock       ││
│  │  overview.js            │    │                            ││
│  │  clients.js (IKEv2)    │ ─▶ │  rpcd ucode backend         ││
│  │  users.js   (L2TP/XAuth)│   │  (ipsec_hwdsl2.uc)          ││
│  │  settings.js (UCI)      │    │      │                     ││
│  └─────────────────────────┘    └──────┼─────────────────────┘│
│                                          │ docker exec         │
└──────────────────────────────────────────┼─────────────────────┘
                                           │
                          ┌────────────────▼────────────────────┐
                          │ hwdsl2/ipsec-vpn-server:latest        │
                          │                                       │
                          │ Libreswan 5.x + xl2tpd                │
                          │                                       │
                          │ /opt/src/ikev2.sh  (5 subcommands)    │
                          │ /etc/ipsec.d/      ← volume persisted │
                          │ /etc/ppp/chap-secrets  ← L2TP         │
                          │ /etc/ipsec.d/passwd    ← XAuth        │
                          └───────────────────────────────────────┘
```

## Requires / depends on

- `luci-base`
- `docker` + `dockerd` (the CLI + the daemon)
- A running hwdsl2 container, e.g.:
  ```bash
  docker run \
    --name ipsec-vpn-server \
    --privileged \
    -p 500:500/udp -p 4500:4500/udp \
    -v ikev2-vpn-data:/etc/ipsec.d \
    -e VPN_IPSEC_PSK=your_psk \
    -e VPN_USER=your_admin \
    -e VPN_PASSWORD=your_pw \
    -d hwdsl2/ipsec-vpn-server:latest
  ```

> The `-v ikev2-vpn-data:/etc/ipsec.d` volume mount is **required** for IKEv2 auto-setup to trigger (the upstream run.sh performs `grep -q " /etc/ipsec.d " /proc/mounts`) and for client certificates to persist across container restarts.

## Menu placement

`Services → IPsec VPN (hwdsl2)` with 4 sub-pages:
1. **Overview** — container status + live SA list + Libreswan daemon info
2. **IKEv2 Clients** — list/add/revoke/delete cert clients + download profiles
3. **L2TP / XAuth Users** — list/add/delete PSK-based users
4. **Settings** — UCI container name/image/volume + restart action

## Build

This package builds via the standard `luci.mk` include in either the LuCI feed or as a custom feed:

```bash
# inside an OpenWrt buildroot
./scripts/feeds update -a
./scripts/feeds install luci-app-ipsec-hwdsl2
make package/luci-app-ipsec-hwdsl2/compile V=s
# → bin/packages/<arch>/luci/luci-app-ipsec-hwdsl2_<ver>_all.ipk
```

See [`docs/api-spec.md`](docs/api-spec.md) for the complete ubus method reference and tested hwdsl2 command outputs.

## License

Apache-2.0 (matches the upstream `hwdsl2/setup-ipsec-vpn` license).

## Author / Maintainer

LZY ([@lzylipu](https://github.com/lzylipu)) — built and tested against `hwdsl2/ipsec-vpn-server:latest` (Libreswan 5.3.1 on Alpine 3.23) on a Debian 12 LXC container per the design reference.
