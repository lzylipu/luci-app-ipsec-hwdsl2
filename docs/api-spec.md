
# API Spec / Tested Command Contract

This document records the real command contract used by `luci-app-ipsec-hwdsl2`.
The commands were tested against `hwdsl2/ipsec-vpn-server:latest` on a Debian 12 LXC Docker host.

## Container baseline

Required container properties:

```bash
docker run \
  --name ipsec-vpn-server \
  --privileged \
  -p 500:500/udp -p 4500:4500/udp \
  -v ikev2-vpn-data:/etc/ipsec.d \
  -e VPN_IPSEC_PSK=testpsk123 \
  -e VPN_USER=testuser \
  -e VPN_PASSWORD=testpw456 \
  -e VPN_CLIENT_NAME=vpnclient \
  -d hwdsl2/ipsec-vpn-server:latest
```

Important upstream behavior verified:

- The image is Libreswan based, not strongSwan.
- `/opt/src/ikev2.sh` and `/usr/bin/ikev2.sh` both exist; this app calls `/opt/src/ikev2.sh`.
- The image does **not** contain `add_vpn_user.sh` or `del_vpn_user.sh`.
- IKEv2 setup only auto-runs when `/etc/ipsec.d` is a Docker mount/volume. Upstream `run.sh` checks `/proc/mounts` for ` /etc/ipsec.d `.
- IKEv2 client files are written under `/etc/ipsec.d/<client>.{p12,mobileconfig,sswan}`.
- L2TP/XAuth users are stored in two files:
  - `/etc/ppp/chap-secrets`
  - `/etc/ipsec.d/passwd`

## 1. Container / daemon status

Command:

```bash
docker exec ipsec-vpn-server ipsec whack --status
```

Useful output sample:

```text
using kernel interface: xfrm
interface lo 127.0.0.1:UDP/4500 (NAT)
interface lo 127.0.0.1:UDP/500
interface eth0 172.17.0.3:UDP/4500 (NAT)
interface eth0 172.17.0.3:UDP/500
configdir=/etc, configfile=/etc/ipsec.conf, secrets=/etc/ipsec.secrets, ipsecdir=/etc/ipsec.d
nssdir=/etc/ipsec.d, dumpdir=/run/pluto, statsbin=unset
pluto_version=5.3.1, pluto_vendorid=OE-Libreswan-5.3.1
```

Parser rule:

- Treat rc=0 as daemon reachable.
- Display first ~600 chars as diagnostics.

## 2. Live SA / connected clients

Command:

```bash
docker exec ipsec-vpn-server ipsec whack --trafficstatus
```

Verified empty output when no active VPN tunnel exists:

```text

```

Parser rule:

- Empty stdout = 0 active VPN clients.
- Non-empty stdout lines = active SA details.

## 3. List IKEv2 clients

Command:

```bash
docker exec ipsec-vpn-server /opt/src/ikev2.sh --listclients
```

Verified output:

```text
IKEv2 Script   Copyright (c) 2020-2026 Lin Song   20 Mar 2026

Checking for existing IKEv2 client(s)...

Client Name       Certificate Status
------------      -------------------
vpnclient         valid

Total: 1 client
```

Parser rule:

```regex
^\s*(\S+)\s+(valid|expired|revoked)\s*$
```

Each match becomes:

```json
{"name":"vpnclient","status":"valid"}
```

## 4. Add IKEv2 client

Correct command after the server is already initialized:

```bash
docker exec ipsec-vpn-server /opt/src/ikev2.sh --addclient test1 --yes
```

Verified output:

```text
## Adding a new IKEv2 client 'test1', using default options.
## Generating client certificate...
## Creating client configuration...

New IKEv2 client "test1" added!

VPN server address: 162.141.130.220

Client configuration is available inside the
Docker container at:
/etc/ipsec.d/test1.p12 (for Windows & Linux)
/etc/ipsec.d/test1.sswan (for Android)
/etc/ipsec.d/test1.mobileconfig (for iOS & macOS)
```

Files verified:

```text
/etc/ipsec.d/test1.mobileconfig
/etc/ipsec.d/test1.p12
/etc/ipsec.d/test1.sswan
```

Important trap:

```bash
/opt/src/ikev2.sh --addclient test1 --auto --yes
```

fails after initial setup:

```text
Error: Invalid parameter '--auto'. IKEv2 is already set up on this server.
       To manage VPN clients, re-run this script without '--auto'.
```

So the LuCI backend must **not** pass `--auto` for normal add-client operations.

## 5. Revoke IKEv2 client

Command:

```bash
docker exec ipsec-vpn-server /opt/src/ikev2.sh --revokeclient test1 --yes
```

Verified output:

```text
WARNING: You have selected to revoke IKEv2 client certificate 'test1'.
## Revoking client certificate...
## Removing client config files...
/etc/ipsec.d/test1.p12
/etc/ipsec.d/test1.mobileconfig
/etc/ipsec.d/test1.sswan

Client 'test1' revoked!
```

Verified behavior:

- CRL is written to the NSS DB.
- `.p12`, `.mobileconfig`, `.sswan` are removed automatically.
- `--listclients` then shows `test1 revoked`.

## 6. Delete IKEv2 client

Command:

```bash
docker exec ipsec-vpn-server /opt/src/ikev2.sh --deleteclient test2 --yes
```

Verified output:

```text
WARNING: Deleting a client certificate from the IPsec database *WILL NOT* prevent
         VPN client(s) from connecting using that certificate! For this use case,
         you *MUST* revoke the client certificate instead of deleting it.

## Deleting client certificate...
## Removing client config files...
/etc/ipsec.d/test2.p12
/etc/ipsec.d/test2.mobileconfig
/etc/ipsec.d/test2.sswan

Client 'test2' deleted!
```

Verified behavior:

- Generated profile files are removed automatically.
- The client disappears from `--listclients`.

UX rule:

- Prefer `revoke` for valid clients.
- Keep `delete` available for cleanup, especially revoked clients.

## 7. Download IKEv2 client config files

Commands:

```bash
docker exec ipsec-vpn-server cat /etc/ipsec.d/<client>.p12
docker exec ipsec-vpn-server cat /etc/ipsec.d/<client>.mobileconfig
docker exec ipsec-vpn-server cat /etc/ipsec.d/<client>.sswan
```

Backend returns base64 for browser download.

Supported formats:

| Format | Purpose |
| --- | --- |
| `.mobileconfig` | iOS / macOS native profile |
| `.sswan` | Android strongSwan profile |
| `.p12` | Windows / Linux / generic certificate bundle |

## 8. List L2TP / XAuth users

Commands:

```bash
docker exec ipsec-vpn-server cat /etc/ppp/chap-secrets
docker exec ipsec-vpn-server cat /etc/ipsec.d/passwd
```

Verified raw files:

```text
# /etc/ppp/chap-secrets
"testuser" l2tpd "testpw456" *
"alice" l2tpd "secret_pw_123" *

# /etc/ipsec.d/passwd
testuser:$1$qIMFaZOQ$Pj0uWkdMl9FLi56F3HEwU/:xauth-psk
alice:$1$TcH0U2gR$/j8tC6wVvEPMdoCy0z9WO.:xauth-psk
```

Parser rules:

- L2TP: `^"([^"]+)"\s+l2tpd\s+"([^"]+)"\s+\*`
- XAuth: split by `:`; fields are `user`, `md5crypt_hash`, `xauth-psk`.

Merged UI row:

```json
{"name":"alice","l2tp_present":true,"xauth_present":true}
```

## 9. Add L2TP / XAuth user

Because the image has no `add_vpn_user.sh`, the backend must double-write the files directly.

Verified command logic:

```sh
USER=alice
PASS=secret_pw_123

echo "\"$USER\" l2tpd \"$PASS\" *" >> /etc/ppp/chap-secrets
ENC=$(openssl passwd -1 "$PASS")
echo "$USER:$ENC:xauth-psk" >> /etc/ipsec.d/passwd
chmod 600 /etc/ppp/chap-secrets /etc/ipsec.d/passwd
```

Verified result:

```text
"alice" l2tpd "secret_pw_123" *
alice:$1$...:xauth-psk
```

## 10. Delete L2TP / XAuth user

Verified command logic:

```sh
USER=alice
sed -i "/^\"$USER\"[[:space:]]\+l2tpd[[:space:]]/d" /etc/ppp/chap-secrets
sed -i "/^$USER:/d" /etc/ipsec.d/passwd
```

Verified behavior:

- User line disappears from both files.

## 11. Volume persistence

Verified flow:

```bash
docker restart ipsec-vpn-server
```

After restart:

- `/etc/ipsec.d/cert9.db` persists.
- `/etc/ipsec.d/key4.db` persists.
- `/etc/ipsec.d/vpnclient.{p12,mobileconfig,sswan}` persists.
- `ikev2.sh --listclients` still returns existing clients.

Critical rule:

- The LuCI settings must default to `ikev2-vpn-data:/etc/ipsec.d` and document that the mount is required.
