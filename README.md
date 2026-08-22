# Building Sunlight Analysis Simulator

**建筑日照采光模拟分析工具** — 在浏览器里绘制楼房与围墙，实时查看太阳光照与阴影，并对建筑立面做日照时数分析、判定是否达标。

A browser-based **building sunlight & daylight simulation** tool: draw houses and walls, watch the sun cast light and shadows in real time 3D, and run **sunlight-hours analysis** on building facades to check daylight compliance.

> 纯静态网页应用，无需后端，双击即用；数据保存在本地浏览器。
> Pure static web app — no backend required, runs in any browser; data is stored locally.

---

## 简介 / Overview

**中文** — 这是一个面向建筑与住区规划的**日照分析模拟器**。你可以按经纬度画出场景范围、绘制房屋（楼栋）与围墙、设置层高层数，程序按真太阳时模拟一天的太阳轨迹与阴影，并在建筑立面上生成**连片渐变的日照时数热力图**，同时给出每栋每层的日照时数与达标情况，辅助采光与日照评估。

**English** — A **sunlight analysis simulator** for buildings and residential planning. Define the site by latitude/longitude, draw houses (buildings) and walls, set floor height and floor count. The app simulates the sun's daily path and shadows in true solar time, renders a **continuous gradient sunlight-hours heatmap** on building facades, and reports per-floor sunlight duration and compliance — supporting daylight and insolation assessment.

关键词 / Keywords: 采光、日照、日照分析、日照模拟、建筑、房屋、楼房、阴影分析、住区规划 · daylight, sunlight, insolation, sun study, building, shadow analysis, solar access.

---

## 主要功能 / Features

- **建筑与围墙建模 / Building & wall modeling** — 2D 编辑器点击画楼、画围墙，支持矩形快速绘制、逐层层高、旋转、拖拽、撤销/重做。
- **实时 3D 日照与阴影 / Real-time 3D sun & shadows** — 按纬度/经度/日期/时间模拟太阳位置，楼体随光照明暗变化，可播放一天光影动画并调速。
- **日照分析 / Sunlight analysis** — 对选中立面（默认南面，可 3D 点选增减）按真太阳时 8:00–16:00 统计各点日照时数，生成整面渐变热力图（0h 红 → 8h 绿）与达标报告（达标线 2h）。
- **底图与透视校正 / Basemap & perspective rectification** — 载入卫星图/总平图作底图；斜拍图可用 4 点单应校正为正射平面图。
- **保存与分享 / Save & share** — 自动保存到本地浏览器，支持导出/导入 JSON 工程文件（含底图）。

---

## 在线使用 / Live Demo

部署到 GitHub Pages 后，访问：
After deploying to GitHub Pages, visit:

```
https://<your-username>.github.io/building-sunlight-analysis-simulator/
```

---

## 快速开始 / Quick Start

### 本地运行 / Run locally

需通过 HTTP 访问（勿用 `file://`，底图/校正的像素读取需要正常 origin）：
Serve over HTTP (not `file://` — pixel access for basemap/rectification needs a proper origin):

```bash
# 任意静态服务器 / any static server
python3 -m http.server 8000
# 打开 / open http://localhost:8000/index.html
```

### 从源码构建 / Build from source

```bash
./build.sh      # 用 esbuild 把 scene.js 及依赖打包成 bundle.js
npm test        # 运行单元测试 (node --test)
```

运行时只需两个文件 / Only two files are needed at runtime: `index.html` + `bundle.js`。

---

## 部署 / Deployment

本项目是静态站点，把 `index.html` 与 `bundle.js` 放到任意静态托管即可。
This is a static site — host `index.html` and `bundle.js` on any static host.

**GitHub Pages**：Settings → Pages → 从 `main` 分支 `/ (root)` 部署。
**GitHub Pages**: Settings → Pages → deploy from `main` branch, `/ (root)`.

**Nginx**：
```nginx
server {
    listen 80;
    server_name your-domain.com;
    root /var/www/building-sunlight-analysis-simulator;
    index index.html;
}
```

---

## 技术 / Tech

- 原生 JavaScript (ES modules) · Three.js (3D/WebGL) · HTML5 Canvas (2D 编辑器) · esbuild 打包 · `node --test` 单元测试。
- 无外部运行时依赖、无后端、无数据库；数据存浏览器 localStorage。
- Vanilla JS, Three.js, Canvas 2D, esbuild, `node --test`. No backend, no database.

---

## 说明 / Notes

- 日照分析为**立面网格估算**，供工程参考。
- 国标（GB 50180）不同标准日的有效日照时间带不同（大寒日 8:00–16:00、冬至日 9:00–15:00，均按真太阳时）；本工具目前统一使用 8:00–16:00。
- Sunlight analysis is a facade-grid estimation for engineering reference. China's GB 50180 uses different time bands per standard day (Great Cold 8–16, Winter Solstice 9–15, in true solar time); this tool currently uses 8–16 uniformly.

---

## 许可证 / License

MIT
