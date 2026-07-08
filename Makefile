include $(TOPDIR)/rules.mk

LUCI_TITLE:=IPsec VPN Server (hwdsl2) - IKEv2 + L2TP/IPsec PSK + XAuth multi-user management via Docker
LUCI_DEPENDS:=+luci-base \
	+docker \
	+dockerd \
	+ucode

PKG_LICENSE:=Apache-2.0
PKG_MAINTAINER:=LZY <lzylipu@users.noreply.github.com>
LUCI_PKGARCH:=all

include ../../luci.mk

# call BuildPackage - OpenWrt buildroot signature
