# Firefox + 品牌加法 → AppImage

在**官方 Firefox** 上只做加法：改名称、换图标、打成标准 Type-2 AppImage。  
不是 Floorp / Noraneko 叠层，也不从完整浏览器源码编译。

## 你只改这两处

### 1. 名称 — `brand.config.json`

```json
{
  "id": "xingchen",
  "displayName": "星辰浏览器",
  "vendor": "Xingchen",
  "firefoxChannel": "latest",
  "firefoxLang": "zh-CN"
}
```

| 字段 | 含义 |
|------|------|
| `id` | 进程名 / 二进制 / 桌面 Icon / AppImage 文件名（小写） |
| `displayName` | 启动器显示名、`application.ini` 的 Name |
| `vendor` | Vendor |
| `firefoxChannel` | `latest` / `beta` / `nightly` |
| `firefoxLang` | Mozilla 下载语言，如 `zh-CN`、`en-US` |

### 2. 图标 — `icons/`

放入 `default128.png`（建议再补 16/32/48/64），可选 `about-logo.png`。

## 本地构建

```bash
chmod +x scripts/make-appimage.sh
./scripts/make-appimage.sh ./dist
```

产物：`dist/<id>-<firefoxVersion>-x86_64.AppImage`  
解压：`./xxx.AppImage --appimage-extract`

## CI

GitHub Actions → **Build Linux AppImage** → Artifact `linux-x86_64-AppImage`。

## 说明

- 浏览器本体来自 [Mozilla 官方下载](https://www.mozilla.org/firefox/)，已是完整浏览器。
- 加法内容：显示名、图标、AppImage 桌面项、禁用应用内自动更新（`distribution/policies.json`）。
- about: 里部分仍可能显示 “Firefox”（资源在 `omni.ja` 内）；启动器 / 进程名 / AppImage 名已是你的品牌。
