# 星辰 / 十二星座浏览器 — 一次编译，N 个打包

在 **Floorp-Runtime** 上用统一的 `compileId`（`MOZ_APP_NAME`）**完整编译一次**，再按 `brand.config.json` 里的 `variants[]` 打出多个 AppImage。  
耗时几乎只在那一次 `mach build`；打包阶段只是复制 + 换皮 + AppImage。

## 你改哪里

### `brand.config.json`

```json
{
  "compileId": "xingchen",
  "compileDisplayName": "星辰浏览器",
  "vendor": "Xingchen",
  "variants": [
    { "id": "aries", "displayName": "白羊座浏览器", "profileDir": "Aries" },
    …
  ]
}
```

| 字段 | 作用 |
|------|------|
| `compileId` | **编译一次**的 `MOZ_APP_NAME` / 二进制原名 / Wayland `app_id` |
| `compileDisplayName` | 编译期品牌文案（打包时会被各星座名覆盖） |
| `variants[].id` | 产物二进制名、桌面项、Actions artifact 名 |
| `variants[].displayName` | 界面显示名（关于页等） |
| `icons/` | **所有变体共用**同一套图标 |

当前默认是 **12 星座**（aries … pisces）。增删变体只改 `variants` 数组即可（workflow 里若写死了 12 个 upload，改数量时同步改 CI）。

## 流程

```text
mach build（一次，compileId=xingchen）
        ↓
mach package → xingchen.tar.xz
        ↓
make-appimage-from-dist.sh
  ├─ aries AppImage
  ├─ taurus AppImage
  └─ … 共 N 个
        ↓
Actions Artifacts：aries / taurus / … / pisces
```

## CI

GitHub Actions → **Build from Runtime (MOZ_APP_NAME)**

- 全量编译约数小时  
- 成功后在本次 run 的 Artifacts 下看到 **12 个命名包**（`aries` … `pisces`）

## 本地

```bash
./scripts/prepare-runtime.sh ../Floorp-Runtime
cd ../Floorp-Runtime
export MOZCONFIG=$PWD/mozconfig.xingchen
./mach --no-interactive bootstrap --application-choice browser
./mach configure && ./mach build && ./mach package

cd ../floorp-2
./scripts/make-appimage-from-dist.sh ../Floorp-Runtime/obj-xingchen/dist ./dist
# → dist/aries/*.AppImage … dist/pisces/*.AppImage
```

## Wayland 说明

所有变体的 **Wayland `app_id` 仍是 `compileId`（xingchen）**——这是编译进二进制的，换皮改不了。  
各变体仍有独立：二进制名、`.desktop`、`RemotingName`、`--class`、界面显示名。  
面板若都显示同一名字，属预期；要 12 个原生不同 `app_id` 只能编 12 次（本仓库刻意不做）。

## 上游快路径

`build_appimage_upstream.yml` / `make-appimage.sh`：下官方 Firefox 换皮，**不经 Runtime 全编**。星座多包逻辑主要挂在 Runtime 这条路上。

## 脚本

| 脚本 | 作用 |
|------|------|
| `brand_config.py` | 读配置（compileId / variants） |
| `generate-branding.py` / `prepare-runtime.sh` | 注入编译期 branding |
| `make-appimage-from-dist.sh` | **一次 dist → N 个 AppImage** |
| `patch_firefox_brand.py` | 每个变体换皮（omni.ja / 二进制名） |
