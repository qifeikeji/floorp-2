# 星辰浏览器 — Floorp 式 Runtime 编译 + AppImage

在 **Gecko / Floorp-Runtime 源码**上设置 `MOZ_APP_NAME`（与 Floorp 相同做法），完整编译后再打 AppImage。  
这样 Wayland 的 `app_id` 就是 `xingchen`，GNOME 面板会显示「星辰浏览器」，而不是 Mozilla Firefox。

> 官方 Firefox 压缩包**改不了** `MOZ_APP_NAME`（已编进二进制）。那条「快速换皮」路线见下方「上游包（不推荐作正式品牌）」。

## 你只改这两处

### 1. `brand.config.json`

```json
{
  "id": "xingchen",
  "displayName": "星辰浏览器",
  "vendor": "Xingchen",
  "profileDir": "Xingchen",
  "runtimeRepository": "Floorp-Projects/Floorp-Runtime",
  "runtimeRef": ""
}
```

| 字段 | 作用 |
|------|------|
| `id` | **`MOZ_APP_NAME`**、二进制名、Wayland `app_id`、`.desktop` |
| `displayName` | 界面显示名 / `brand.ftl` |
| `vendor` | Vendor |
| `profileDir` | 配置目录名 |
| `runtimeRepository` | 用来完整编译的 Gecko 树（默认 Floorp-Runtime） |

### 2. `icons/`

至少放 `default128.png`（建议再补 16/32/48/64 与 `about-logo.png`）。

## 和 Floorp 的对应关系

| Floorp | 本仓库 |
|--------|--------|
| Floorp-Runtime 编译，`MOZ_APP_NAME=floorp` | 注入 `browser/branding/<id>/` + `--with-app-name=<id>` 后完整编译 |
| 面板显示 Floorp | 面板显示 `displayName`（app_id=`id`） |
| 官方 Firefox 换皮 | **做不到**原生 app_id（仅有 upstream 快路径） |

## CI（推荐）

GitHub Actions → **Build from Runtime (MOZ_APP_NAME)**

- 会 clone Floorp-Runtime、注入品牌、**完整 `mach build`**（约数小时）、再打 AppImage  
- Artifact：`linux-x86_64-AppImage-runtime`

标准 `ubuntu-22.04` 磁盘/内存紧张：workflow 已加 16G swap 并把 `mach build` 并行度压到 2–3。  
若仍出现 **exit 143**（被 SIGTERM 杀掉），多半是 OOM/磁盘/超时或重复触发把旧任务 cancel 掉——换更大 runner 或本地编 Runtime。  
`swgl … -fembed-bitcode=all` 一类是常见警告，可忽略。

## 本地（有磁盘与时间时）

```bash
# 1) 准备 Runtime 源码树（示例）
git clone --depth 1 https://github.com/Floorp-Projects/Floorp-Runtime.git ../Floorp-Runtime

# 2) 注入品牌 + 写 mozconfig
chmod +x scripts/*.sh scripts/*.py
./scripts/prepare-runtime.sh ../Floorp-Runtime

# 3) 完整编译（很久）
cd ../Floorp-Runtime
export MOZCONFIG=$PWD/mozconfig.xingchen
./mach --no-interactive bootstrap --application-choice browser
./mach configure && ./mach build && ./mach package

# 4) AppImage
cd ../floorp-2   # 回本仓库
./scripts/make-appimage-from-dist.sh ../Floorp-Runtime/obj-xingchen/dist ./dist
```

## 上游包快路径（仅测试用）

Action：**Build AppImage (upstream Firefox, quick)**  
脚本：`scripts/make-appimage.sh`  

下载 Mozilla 官方包换皮，**Wayland 仍是 `firefox`**，面板会显示 Mozilla Firefox。  
若要用覆盖桌面项凑合：`scripts/install-desktop.sh`。

## 脚本一览

| 脚本 | 作用 |
|------|------|
| `generate-branding.py` | 生成 `browser/branding/<id>/` |
| `prepare-runtime.sh` | 写入 Runtime 树 + `mozconfig`（含 `--with-app-name`） |
| `make-appimage-from-dist.sh` | 从 `mach package` 产物打 AppImage |
| `make-appimage.sh` | 上游官方包快路径 |
| `install-desktop.sh` | 仅 upstream 路线的 GNOME 桌面覆盖 |
