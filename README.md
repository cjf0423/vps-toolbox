# 🛠️ VPS 工具箱 & 代理客户端配置

个人收集整理的 VPS 代理搭建脚本和 iOS/macOS 代理客户端配置文件。

> ⚠️ 本仓库中的脚本和配置大部分整理于 **2020-2021 年**，部分内容可能已过时。仅作为个人备份和参考使用。

## 📁 目录结构

```
├── proxy-client-configs/          # 代理客户端配置文件
│   ├── shadowrocket/              # Shadowrocket (iOS)
│   │   ├── My_Shadowrocket.conf   # 个人自用配置（2024年更新）
│   │   ├── Shadowrocket.conf      # 通用分流配置
│   │   ├── Complete.conf          # 完整规则配置（含去广告）
│   │   └── jd_scripts.conf        # 京东脚本配置（已过时）
│   ├── surge/                     # Surge (iOS/macOS)
│   │   └── Surge.conf             # Surge 分流配置（含脚本）
│   ├── loon/                      # Loon (iOS)
│   │   └── default.conf           # Loon 全分组配置
│   └── quantumult-x/              # Quantumult X (iOS)
│       └── quanx.conf             # QuantumultX 完整配置
│
└── vps-scripts/                   # VPS 服务端脚本
    ├── v2ray/                     # V2Ray 相关
    │   ├── v2ray-233boy.sh        # 233boy 一键脚本
    │   ├── v2ray-official-install.sh  # V2Ray 官方安装脚本
    │   ├── wulabing-ws-tls.sh     # wulabing vmess+ws+tls+nginx
    │   ├── wulabing-h2.sh         # wulabing vmess+h2+tls
    │   ├── config-tls.json        # ws+tls 服务端配置示例
    │   ├── config-h2.json         # h2 服务端配置示例
    │   └── client-h2.json         # h2 客户端配置示例
    ├── shadowsocks/               # Shadowsocks
    │   ├── shadowsocks-all.sh     # Teddysun 四合一脚本
    │   └── shadowsocks.tar.gz     # SS 源码包
    ├── ssr/                       # ShadowsocksR
    │   └── ssr.sh                 # 逗比 SSR 一键脚本
    ├── caddy/                     # Caddy Web 服务器
    │   ├── caddy.sh               # Caddy 一键安装
    │   └── caddy_install.sh       # Caddy 安装脚本
    ├── system-tools/              # 系统工具
    │   ├── swap.sh                # 一键添加 swap
    │   ├── network-reinstall.sh   # DD 一键重装系统（支持 Windows/Linux）
    │   └── digitalocean-cli.sh    # DigitalOcean CLI 管理脚本
    └── 逗比/                      # 逗比全套脚本备份
        ├── bbr.sh                 # BBR 加速
        ├── brook.sh               # Brook 代理
        ├── goflyway.sh            # GoFlyway 代理
        ├── ss-go.sh               # Shadowsocks-Go
        ├── ssr.sh                 # ShadowsocksR
        ├── ssrmu.sh               # SSR 多用户管理
        ├── ssr_check.sh           # SSR 检测
        ├── ssr_ip_check.sh        # SSR IP 检测
        ├── ssr_mujson_clear.sh    # SSR mu.json 清理
        ├── ssr_old.sh             # SSR 旧版
        ├── ssrstatus.sh           # SSR 状态监控
        └── caddy_install.sh       # Caddy 安装

```

## 📱 代理客户端配置说明

| 客户端 | 配置文件 | 说明 |
|--------|----------|------|
| **Shadowrocket** | `My_Shadowrocket.conf` | 个人主力配置，含 GLaDOS 订阅分组、Netflix/YouTube/Google/Telegram/OpenAI 等分流规则 |
| **Surge** | `Surge.conf` | macOS 为主，整合了大部分 Mac 可用脚本 |
| **Loon** | `default.conf` | 全分组配置，含去广告插件、VIP 脚本、TikTok 解锁 |
| **Quantumult X** | `quanx.conf` | 完整配置，带中文注释说明 |

## 🖥️ VPS 脚本说明

| 脚本 | 用途 | 来源 |
|------|------|------|
| `v2ray-233boy.sh` | V2Ray 一键安装管理 | 233boy |
| `wulabing-ws-tls.sh` | V2Ray + WS + TLS + Nginx | wulabing |
| `shadowsocks-all.sh` | SS/SSR/SS-libev/SS-go 四合一 | Teddysun |
| `bbr.sh` | Google BBR 加速一键安装 | 逗比 |
| `swap.sh` | 一键创建/管理 Swap | Moerats |
| `network-reinstall.sh` | DD 重装系统（支持 Win/Linux） | CXT |
| `digitalocean-cli.sh` | DigitalOcean CLI 管理 | 自用 |

## ⚠️ 免责声明

- 本仓库仅供学习研究和个人备份使用
- 脚本来源于各位大佬的开源项目，版权归原作者所有
- 部分脚本可能已停止维护，使用前请注意甄别
