# 网易云音乐去广告 · NetEase Cloud Music AdBlock

> 一个专门针对**网易云音乐**的去广告复写脚本，适用于 Shadowrocket / Surge / Loon / Quantumult X。
> A dedicated ad-blocking rewrite script for **NetEase Cloud Music**, for Shadowrocket / Surge / Loon / Quantumult X.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Tests](https://img.shields.io/badge/tests-52%20passing-brightgreen.svg)](#开发与测试--development)

**中文** | [English](#english)

---

## 一键安装 / One-line install

在 **Shadowrocket → 配置 → 模块 → 右上角 ➕**，粘贴下面这条 URL 即可：

```
https://raw.githubusercontent.com/socamalo/netease-music-adblock/main/netease-music-adblock.sgmodule
```

装完记得：**模块拖到最上面 → 开启 HTTPS 解密（装并信任证书）→ 全局路由切到「配置」模式 → 杀掉网易云音乐重新打开**。

> 国内直连 `raw.githubusercontent.com` 不稳的话，在链接前面加一个加速前缀再粘贴，例如
> `https://gh.idayer.com/https://raw.githubusercontent.com/...`（自行挑选可用的加速服务）。

---

## 它去掉什么 / What it removes

| 位置 | 去掉的内容 | 实现方式 |
|------|-----------|---------|
| 开屏 / 启动 | 启动领 VIP 弹窗、免费听歌弹窗 | 接口返回清空 |
| 首页 / 发现页 | 信息流广告位、Banner 广告、`PAGE_DISCOVERY_BANNER` | 按 `bizCode` 白名单过滤 |
| Banner 轮播 | `v2/banner/get` 里标了「活动 / 广告」的位 | 按 `typeTitle` 过滤，保留真实内容 |
| 搜索页 | Chart 推广、猜你喜欢、特殊词、默认填词 | 接口返回清空 |
| 歌曲页 / 评论区 | 评论区插入的推广、楼层广告 | 子响应替换 / 字段清洗 |
| 侧栏 / 账号中心 | 侧边 VIP 推广、浮层、优惠券、云贝入口、创作福利 | 接口返回清空 |
| 底部导航 | 可选的「漫游 / 笔记」标签 | 列表过滤 |
| 更新提示 | 版本升级弹窗 | 接口返回清空 |
| 开屏视频/动图广告 | `iadmusicmatvideo.music.126.net` | 规则层直接 REJECT |
| 广告素材 CDN | `iadmusicmat*`、`admusicpic`、`iadmat*`、第三方广告联盟 | 规则层直接 REJECT |

**它不做什么**：**不解锁 VIP / 会员权益**。去广告和浏览器装 AdBlock 是一回事；伪造会员到期时间去白嫖付费内容不是，本项目不做这件事。

---

## 安装步骤 / Install

### 1. 装模块

Shadowrocket → **配置** → **模块** → 右上角 **➕** → 粘贴上面的 URL → 下载 → 长按把模块**拖到列表最上方**（模块顺序即优先级，排在上面的会覆盖下面的）。

### 2. 生成并信任证书（关键）

1. **配置 → 点当前配置的 ⓘ → HTTPS 解密 → 证书 → 生成新的 CA 证书 → 安装证书**
2. Safari 弹出下载 → **允许** → 去 **设置 → 通用 → VPN 与设备管理** → 安装描述文件
   （提示密码时先试 `Shadowrocket`）
3. **设置 → 通用 → 关于本机 → 证书信任设置** → 打开对应开关 → **继续**

> 「安装」和「信任」是 iOS 上两个独立动作，只做第一步不生效。
> 如果「关于本机」里找不到证书信任设置那一行，说明描述文件根本没装上。
> CA 证书有效期约 **365 天**，过期后所有 HTTPS 会静默失效 —— 建议提前设个日历提醒。

### 3. 确认路由模式

回到 Shadowrocket 首页，顶部「全局路由」必须是 **配置** 模式。选「代理」等于所有流量直接走代理，规则完全不生效。

### 4. 杀掉 App 重开

网易云音乐会缓存之前的连接 / TLS 状态，改完规则必须**完全杀掉**再打开。

### 5. ⚠️ 开屏广告还在？先清缓存 —— 这几乎总是原因

**开屏广告是提前预下载到本地的**，你还没打开 App 时，网易云就已经把广告图和配置下好、缓存进手机了。所以第一次装上模块后启动，App 根本不会发网络请求 —— 它直接从本地缓存读广告，Shadowrocket 从头到尾什么都看不到，自然也就拦不住。

这不是规则没生效，是**存量广告**。实测确认：清掉缓存后开屏广告立即消失，且规则此后正常拦截。

**怎么清**：

- 能接受的话，**卸载重装**最彻底；
- 不想重装：**先完全杀掉 App**（上滑关掉），再进「设置 → 清除缓存」。

> App 内那个「清除缓存」按钮经常**不清广告素材缓存**，所以清了还在的话，直接重装。

**判断方法**：清完缓存
- 广告**消失** → 规则一直在正常工作，只是之前拦的是缓存。收工。
- 广告**又回来** → 那是实时拉取，说明走的是还没覆盖的接口，请把 Shadowrocket 的请求日志发我。

> 这条对**所有**去广告复写都成立，不只是本项目。任何广告只要被预缓存过，装模块当次都不会立刻见效。

---

## 原理 / How it works

网易云音乐的接口有三种形态，脚本对三种都做了处理：

| 形态 | 路径 | 响应体 |
|------|------|--------|
| `api` | `/api/...` | 明文 JSON |
| `eapi` | `/eapi/...` | **AES-128-ECB 加密的二进制流** |
| `weapi` | `/weapi/...` | 双层 AES-CBC + RSA（网页版） |

脚本的处理流程：

```
拿到响应体
  ├─ 是明文 JSON 文本？ → 直接 parse
  ├─ 是 UTF-8 字节的 JSON？ → 解码后 parse
  └─ 都不是 → 用 AES-128-ECB（密钥 e82ckenh8dichen8）解密
              ├─ 请求头带 x-aeapi: true → 再 gunzip 一层
              └─ 解不出来 → 原样放行（绝不破坏看不懂的响应）
                            ↓
                     按路径改写 JSON
                            ↓
        按「进来的样子」原路返回：
        密文进来 → 明文改写 → 重新加密回去
        明文进来 → 直接返回字符串
```

几个刻意的设计选择：

- **自带 AES，不依赖 CryptoJS。** 纯 JS 实现 AES-128-ECB 约 4 KB，比内联 CryptoJS（约 120 KB）小两个数量级，且没有 CDN 依赖，离线可用。
- **靠嗅探，不靠猜开关。** 社区脚本通常根据 `x-aeapi` 或 `e_r` 判断要不要解密。实测这两个开关单独出现时响应仍是明文，所以脚本改成**先探测响应体本身**：能当 JSON 解析就解析，不能就解密。服务端哪天改了触发条件也不会失效。
- **看不懂就放行。** 解密失败、gzip 解不开、JSON 解析失败 —— 一律 `$done({})` 原样透传。宁可这次广告没去掉，也不能让 App 白屏。
- **一个脚本管所有接口。** 模块只负责把流量路由过来，具体哪条路径「清空」、哪条「改写」由脚本里的规则表决定。以后接口变了只改脚本，不用动模块。

---

## 开发与测试 / Development

整个仓库**只有 JavaScript，没有 Python**。脚本本身零依赖，不带 CryptoJS，也不从 CDN 拉任何东西 —— 网易云音乐运行脚本的环境里只有 JS 引擎，AES 是脚本自己实现的。

```bash
npm test             # 52 个测试
npm run test:watch   # 保存即跑
```

测试用 Node 内置 test runner，**零依赖**（Node 只是本地开发工具，和 App 里跑什么无关）：

- `test/aes.test.cjs` — AES 实现正确性
- `test/rules.test.cjs` — 规则引擎 + 端到端
- `test/module.test.cjs` — 模块与脚本的一致性

`test/fixtures/eapi-samples.json` 里是预先算好的加密样本（含密文与对应明文），用来证明这个手写的 JS AES 能正确解开网易云的载荷。它只是数据文件，测试时不需要任何 Python。

### 验证状态 / Verification status

诚实说明哪些验证过、哪些没有：

| 项目 | 状态 |
|------|------|
| 纯 JS AES-128-ECB 与 **OpenSSL** 对拍 200 组随机密钥 | ✅ 200/200 一致 |
| AES 通过 **NIST FIPS-197** 标准测试向量 | ✅ |
| 能解密 **pycryptodome** 加密的网易云载荷 | ✅ 全部字节一致 |
| 规则引擎、端到端流程（明文 / 密文 / gzip / QuanX） | ✅ 52 个测试全绿 |
| 模块正则覆盖脚本所有路径 | ✅ 自动校验 |
| **在真机 Shadowrocket 上的实际效果** | ⚠️ **未验证** |

最后一行是重点：本项目的密码学与逻辑层经过严格验证，但**没有在真实 iOS 设备 + 真实网易云音乐 App 上跑过**。首次使用请自行确认效果。

---

## 常见问题 / FAQ

**Q：装完了广告还在？**

按顺序排查：

1. **清缓存 / 重装 App** —— 见上面第 5 节。**开屏广告几乎都是这一条**，因为广告是提前预下载缓存到本地的，拦网络挡不住已经躺在手机里的素材。
2. 证书是否**已信任**（不只是已安装）
3. 全局路由是否在**配置**模式
4. 网易云是否**杀掉重开**
5. 模块是否在列表**最上面**

**Q：为什么开屏广告非要清缓存才行？**

因为开屏广告是 App 启动时从**本地缓存**读的，不是当场联网拉的。它在你上次使用时就已经下载好了 —— 你的模块拦的是"下载"这一步，但拦不住"读本地文件"。清掉缓存后，下载这一步被规则挡住，广告就再也回不来了。

**Q：App 白屏 / 崩了？**

立刻关掉模块开关。多半是某个接口的响应体被改坏了。请在 Issue 里附上 Shadowrocket 的请求日志，我会补规则。

**Q：会影响播放吗？**

不会。模块的匹配正则刻意排除了 `song/enhance/player/url`、登录、歌词等核心接口，这一点有测试守着（`patterns do not accidentally swallow playback or login traffic`）。

**Q：为什么不做 VIP 解锁？**

因为那是绕过付费，性质不同于去广告。浏览器装 AdBlock 是正当的，伪造会员到期时间不是。

**Q：证书过期了怎么办？**

重新生成并安装证书。**不要**试图"续期" —— iOS 无法就地续期根证书，残留的旧证书会扰乱信任链，先删旧的再装新的。

---

## 参考与致谢 / Credits

本项目的接口清单参考了以下公开项目的思路，规则表是重新整理并实测的：

- [ddgksf2013/Rewrite](https://github.com/ddgksf2013/Rewrite) — 网易云音乐净化（墨鱼版）
- [ahhfzwl/zdsa](https://github.com/ahhfzwl/zdsa) — 网易云重写规则集
- [Keywos/rule](https://github.com/Keywos/rule) — `wyres.js`

AES 密钥 `e82ckenh8dichen8` 与 `x-aeapi` / gzip 处理方式由上述公开脚本交叉确认，并通过独立实现对拍验证。

---

## 免责声明 / Disclaimer

仅供个人学习与自用。脚本只做**去广告**，不解锁任何付费权益。请自行评估使用风险，作者不对任何后果负责。

---

<a id="english"></a>
# English

## What it is

A rewrite script that removes ads from the **NetEase Cloud Music** mobile app via MITM. Works with Shadowrocket, Surge, Loon and Quantumult X.

## Install

In **Shadowrocket → Config → Modules → ➕**, paste:

```
https://raw.githubusercontent.com/socamalo/netease-music-adblock/main/netease-music-adblock.sgmodule
```

Then: drag the module to the **top** of the list → enable **HTTPS decryption** and install + **trust** the CA certificate → set global routing to **Config** mode → **force-quit** NetEase Cloud Music and reopen it.

### ⚠️ Splash ad still showing? Clear the cache — that is almost always why

**The splash ad is pre-downloaded and cached on the device.** Before you ever open the app, NetEase has already fetched the ad image and its config and stored them locally. So the first launch after installing the module, the app makes **no network request at all** — it reads the cached ad straight off disk, and Shadowrocket never sees anything to block.

This is not the rules failing. It is a stale cached ad. Confirmed by test: clearing the cache makes the splash ad disappear immediately, and the rules block it correctly from then on.

**How to clear it:**

- **Reinstalling the app** is the most reliable;
- Otherwise: **force-quit the app first**, then use 设置 → 清除缓存 (Settings → Clear cache).

> The in-app "clear cache" button often does **not** clear the ad-creative cache. If the ad survives it, reinstall.

**How to tell which case you are in:**

- Ad **gone** after clearing → the rules were working all along; you were looking at a cached ad.
- Ad **comes back** → it is being fetched live, so an endpoint is still uncovered. Send me the Shadowrocket request log.

> This applies to **every** ad-blocking rewrite, not just this one. Any ad that was pre-cached will survive the first launch after you install the module.

### Trusting the certificate (the step people skip)

Generating and installing the CA profile is not enough — iOS treats *installing* and *trusting* as two separate actions. After installing the profile, go to **Settings → General → About → Certificate Trust Settings** and enable the switch for the certificate. The CA expires after ~365 days, and when it does, all HTTPS silently breaks.

## What gets blocked

Splash-screen video/image ads (including third-party brand campaigns such as Tmall 双11), splash VIP popups, home/discovery feed ad slots, banner ads, search-page promos, comment-area injections, sidebar upsells, coupon entries, update nags, and the ad-creative CDNs themselves (rejected at the rule layer).

Sold slots inside the banner carousel (`v2/banner/get`) are filtered by their `活动`/`广告` label, so genuine editorial banners survive.

**What it deliberately does not do:** unlock VIP or paid entitlements. Blocking ads is what a browser ad-blocker does. Forging a membership expiry to obtain paid content is circumventing payment, and is out of scope.

## How it works

NetEase serves three API flavours: plain `api` (JSON), `eapi` (AES-128-ECB encrypted binary) and `weapi` (double AES-CBC + RSA, web). The script handles all three.

The important design decision is **sniffing rather than guessing**. Most community scripts branch on the `x-aeapi` or `e_r` flags to decide whether to decrypt. Testing showed those flags can appear while the response is still plaintext, so this script instead probes the body itself: if it parses as JSON, treat it as JSON; otherwise AES-decrypt it (and gunzip when `x-aeapi: true`). Whatever comes in goes back out in the same encoding — ciphertext in, re-encrypted ciphertext out.

It ships its own ~4 KB pure-JS AES-128-ECB instead of inlining CryptoJS (~120 KB), so there is no CDN dependency. And when anything is unreadable — decryption fails, gzip fails, JSON is malformed — it passes the response through untouched rather than risk a blank screen.

## Development

**This repository contains JavaScript only — there is no Python anywhere.** The script itself has zero dependencies: it does not bundle CryptoJS and fetches nothing from a CDN, because the environment the rewrite runs in is a bare JS engine. AES is implemented in the script itself.

```bash
npm test    # 52 tests, zero dependencies (Node's built-in runner)
```

Node is a local development tool and has nothing to do with what runs inside the app.

- `test/aes.test.cjs` — cipher correctness
- `test/rules.test.cjs` — rule engine and end-to-end pipeline
- `test/module.test.cjs` — keeps the module file and the script in sync

`test/fixtures/eapi-samples.json` holds pre-computed ciphertext/plaintext pairs, used to prove the hand-written JS AES decrypts NetEase payloads correctly. It is a data file; running the tests requires no Python.

### Verification status

The AES implementation is cross-checked against **OpenSSL** on 200 random keys and passes the **NIST FIPS-197** vectors; it decrypts **pycryptodome**-generated NetEase payloads byte-for-byte. The rule engine and full pipeline (plaintext / ciphertext / gzip / Quantumult X) are covered by the test suite.

**Not verified: behaviour on a real device.** The crypto and logic layers are tested thoroughly, but this has not been run against the actual app on real iOS hardware. Please verify before relying on it.

## FAQ

**Ads still showing?** Check, in order:

1. **Clear the cache / reinstall the app** — see the section above. This is the answer for the splash ad essentially every time, because the ad was pre-downloaded to disk and blocking the network cannot remove something already on the device.
2. Certificate actually **trusted** (not merely installed)
3. Global routing in **Config** mode
4. App force-quit and reopened
5. Module at the **top** of the list

**Why does the splash ad need a cache clear?** Because the app reads it from local storage at launch rather than fetching it live. It was downloaded during a previous session — the module blocks the *download*, but cannot block *reading a local file*. Once the cache is cleared, the download is blocked and the ad does not come back.

**App blank or crashing?** Toggle the module off immediately and open an Issue with the request log from Shadowrocket.

**Will it break playback?** No. The module's regexes deliberately exclude `song/enhance/player/url`, login and lyric endpoints — there is a test guarding this.

## Credits

Endpoint lists were informed by [ddgksf2013/Rewrite](https://github.com/ddgksf2013/Rewrite), [ahhfzwl/zdsa](https://github.com/ahhfzwl/zdsa) and [Keywos/rule](https://github.com/Keywos/rule). The AES key and the `x-aeapi`/gzip handling were cross-confirmed against those public scripts and validated by independent implementation.

## License

MIT — see [LICENSE](LICENSE). For personal use. Ad removal only; no paid entitlements are unlocked.
