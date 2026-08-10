# Shine 项目架构与 Template Profile 云端化计划

> 审查日期：2026-08-09  
> 审查基线：`main` / `9cab6bafa92e75ee9464ab53019d98573bcb1ab9`  
> 当前产品基线：v0.28-alpha  
> Phase 1 状态：Template Profile 云端测试已实现并完成真实模板读写验证。
> Phase 2 状态：在 `codex/phase2` 独立分支实施；`main` 与生产 v0.28 保持不变。
> Phase 2 详细契约：见 `SHINE_PHASE2_ASSET_SYSTEM.md`；部署与回滚见 `SHINE_DEPLOYMENT.md`。

### 2026-08-10 Phase 2 架构决定

- 不要求 PSD 增加 `@SLOT_*` 提示层；网页在 Template Profile 中维护可拖动的虚拟插槽。
- 素材分类、A/B 选择、Z 层级和画布变换彼此解耦。
- 所有上传素材默认 `PRESERVE_ORIGINAL`，只有用户主动打开“跟随订单配色”才允许自动改色。
- 纯净模板、素材 PSD、缩略图、metadata、工作室设置和订单使用不同的数据生命周期。
- Phase 2 继续保持当前单文件前端，避免在功能迁移期间同时进行大规模框架重构。

## 1. 项目约束

Shine 是一个基于 Procreate PSD 的快速上色网页工具，核心目标是帮助定制头像快速生产。

本项目的硬约束：

- 不删除或破坏 v0.28 已有功能；
- 不修改 PSD 解析核心逻辑；
- 未确认前不重构现有单文件架构；
- 云端功能必须是增量接入，并保留本地工作流和快速回滚能力；
- 下一阶段按 Template Profile、OSS 素材、素材库管理、批量订单的顺序推进，避免一次扩大范围。

## 2. 仓库结构

当前 GitHub 仓库：`https://github.com/ZXY0501/shine-private-studio`

```text
shine-private-studio/
├── .git/
├── index.html                 # GitHub Pages 前端与全部生产逻辑
└── SHINE_ARCHITECTURE.md      # 本次新增的架构与实施计划
```

基线仓库在本次文档加入前只有一个文件：

- `index.html`：3,278 行；Git blob 约 224 KB；HTML、CSS、UI 和 JavaScript 全部集中在同一文件；
- Git 历史只有一个提交 `9cab6ba Add files via upload`；
- 默认分支为 `main`；
- 当前没有 Git tag；
- 没有 `README`、测试、构建脚本、`package.json`、后端源码或部署配置。

因此，v0.28 目前更像“已部署的单文件生产快照”，尚不是一个前后端完整、可重复构建的工程仓库。

## 3. 前端入口与组织方式

### 3.1 入口文件

前端入口和 GitHub Pages 生产文件均为根目录：

```text
index.html
```

历史源文件名为 `shine_private_studio_v0_28_alpha.html`，部署时改名为 `index.html`。仓库中的页面标题和导出版本均标识为 v0.28-alpha。

### 3.2 单文件分区

| 范围 | 作用 |
| --- | --- |
| `index.html:1` 起 | HTML 头部与内联 CSS |
| `index.html:524` 起 | 三栏工作台 DOM、上传/素材/表单/微调/逻辑 UI |
| `index.html:924` | 从 jsDelivr 加载 `ag-psd@31.0.2` |
| `index.html:925` 起 | 全部应用 JavaScript |
| `index.html:926` | 全局状态对象 `S` |
| `index.html:3270` 起 | 启动序列：禁用未加载控件、读取本地状态、构建工作区、锁定三栏布局 |

没有模块加载器、框架、打包器或独立 JS/CSS 文件。浏览器直接执行该 HTML。

### 3.3 UI 结构

页面是固定的三栏生产工作台：

```text
左侧 previewDock       中间 taskRail          右侧 taskDock
成图预览/导出          功能索引                当前任务面板
                       ├─ 模板上传
                       ├─ 素材库
                       ├─ 表单清洗
                       ├─ 单层微调
                       └─ 衍生色逻辑
```

高级的模板体检、图层树和绑定编辑器被放在“模板设置 / 解析调试”折叠区，日常订单操作与模板调试基本分开。

## 4. 前端核心架构

### 4.1 状态中心

`index.html:926` 的全局对象 `S` 是应用状态中心，主要包含：

- 主模板：`master`、`masterFile`、`flat`、`masterOrder`；
- 模板绑定：`bindings`、`templateSignature`、`builderCollapsed`；
- 可见性与渲染：`visOverride`、`overlayBase`、`recolorCache`；
- 素材：`assets`、`editingAssetIndex`、`assetRenderWarnings`；
- 颜色覆写：`ruleColorOverrides`、`manualLayerOverrides`、`layerColorOverrides`；
- 大夹子与头发插入：`rootStackOrder`、`hairInsertion`；
- 订单和设置：`orders`、`presets`、`logic`、`eyeSchemes`、`styleSchemes`；
- API：`apiConfig`；
- UI/临时状态：当前订单、吸色图、自动帽饰槽位等。

这是单页内存状态，不是服务端模型。

### 4.2 PSD 解析与渲染主链路

```text
File / Drag & Drop
    │
    ▼
parsePsd(file)
    │ file.arrayBuffer() + agPsd.readPsd()
    ▼
loadMaster() / loadAssets() / loadHairAsset()
    │
    ├─ flatten()                   图层树展平并生成 path
    ├─ detectLayerDrawOrder()      检测正序/反序
    ├─ ensureBindings()            猜测模板语义
    ├─ initAssetBindings()         猜测素材语义
    ├─ reconstruct()               重建主模板
    ├─ renderAssetComposite()      重建素材 PSD
    └─ renderOverlay()             合成最终预览
```

关键函数：

| 函数 | 位置 | 职责 |
| --- | --- | --- |
| `parsePsd` | `index.html:3019` | 唯一 PSD 读取入口，调用 `ag-psd` |
| `flatten` | `index.html:953` | 递归展开图层并建立以 `/` 分隔的 path |
| `detectLayerDrawOrder` | `index.html:1286` | 通过采样比较判断 PSD 层序 |
| `renderPsdTree` | `index.html:1246` | 按图层、混合模式、剪辑关系重绘 PSD |
| `renderMasterWithRootStack` | `index.html:1268` | 按模板根夹子顺序插入 A/B 头发 |
| `reconstruct` | `index.html:1296` | 重建主模板画布 |
| `renderOverlay` | `index.html:1332` | 合成启用的外挂素材 |
| `renderAssetComposite` | `index.html:2250` | 依据素材绑定与颜色覆写重绘一个素材 |

这些函数属于 v0.28 的生产核心。Template Profile 上云不需要、也不应修改它们。

### 4.3 配色链路

模板和素材的颜色分两层：

```text
订单/预设/衍生色逻辑
    │
    ├─ ruleColorOverrides          系统按 role 计算出的覆写
    └─ manualLayerOverrides        用户单层人工覆写，优先级更高
              │
              ▼
       layerColorOverrides
              │
              ▼
    主模板或素材 Canvas 重绘
```

主要代码包括：

- `deriveRoleColor()`：根据发色、瞳色、帽饰等生成各 role 的颜色；
- `applyOrderColors()`：把当前订单转换为模板规则覆写；
- `setManualLayerOverride()`：保存单层人工覆写；
- `rebuildLayerOverrideMap()`：合并规则与人工覆写；
- `shiftColor()` 及 OKLCH 转换函数：完成明度/饱和度派生；
- `scheduleQuickColorPreview()`：32 ms 节流的单层实时预览。

### 4.4 订单与导出

- 订单状态在 `S.orders`，并存入 `localStorage`；
- 表单可用本地规则解析，也可向用户配置的 API endpoint 发送 POST；
- 当前唯一的 `fetch()` 位于 `apiParseForm()`，用于委托表单结构化，不是 OSS 或 profile API；
- PNG/JPEG 导出基于 Canvas；
- 剪贴板导出使用 `navigator.clipboard.write()`，失败时回退到下载；
- 背景底色/蕾丝开关、水印模式、预览/交付导出均是现有生产链路。

## 5. 模板 Profile 现状

### 5.1 模板识别

`templateSig()` 位于 `index.html:1381`，当前签名算法为：

```text
<width>x<height>:<flattened-layer-count>:<FNV-1a(layer-paths)>
```

它不读取像素数据，不修改 PSD 解析流程，且已经用于全部模板级本地 key。第一阶段云端化应复用这个签名，避免引入新的模板识别行为。

### 5.2 现有 Profile Schema

`buildTemplateJson()` 位于 `index.html:1535`，现有 schema 为：

```json
{
  "schemaVersion": "shine-template-0.28-alpha",
  "template": {
    "fileName": "template.psd",
    "width": 1500,
    "height": 1500,
    "signature": "1500x1500:..."
  },
  "colorPolicy": {
    "preset": [],
    "manualAnchor": [],
    "derived": [],
    "fixed": []
  },
  "rootStackOrder": [],
  "hairInsertion": {},
  "bindings": {}
}
```

其中 `bindings[path]` 保存：

- `slot`：`A` / `B` / `SHARED` / `NONE`；
- `part`：头发、眼睛、衣服、帽子、背景等部位；
- `role`：`HAIR_BASE`、`EYE_DARK`、`BACKGROUND_BASE` 等语义；
- `source`：固定、预设、人工锚点、衍生、覆写等颜色来源；
- `locked`：图层是否锁定。

### 5.3 当前保存和恢复

模板绑定保存：

```text
saveBindingsLocal()
    ├─ buildTemplateJson()
    ├─ 增加 savedAt
    ├─ 保存到 S._savedTemplate（页面内存兜底）
    └─ 保存到 localStorage
```

模板重新上传时：

```text
loadMaster()
    ├─ 解析 PSD
    ├─ 计算 templateSignature
    ├─ ensureBindings()
    ├─ loadStoredBindings()
    ├─ loadHairInsertion() / loadRootStackOrder()
    └─ 渲染页面
```

现有导入/导出：

- “导出 template.json”直接下载 `buildTemplateJson()`；
- “导入 template.json”恢复 bindings、hairInsertion、rootStackOrder；
- 导入后需由用户检查并再次点击“保存模板绑定”。

## 6. 本地存储与数据边界

### 6.1 模板级 key

| Key | 内容 |
| --- | --- |
| `qq-color-studio:template:<signature>` | `buildTemplateJson()` + `savedAt` |
| `shine:hair-insertion:<signature>` | 旧版头发 anchor/position 兼容数据 |
| `shine:root-stack:<signature>` | 模板根夹子与 A/B 虚拟头发夹子顺序 |

### 6.2 工作室级 key

| Key | 内容 |
| --- | --- |
| `shine:orders:v0.6` | 订单、A/B 选择与单层覆写 |
| `shine:presets:v0.6` | 帽子、衣服、背景预设色 |
| `shine:api:v0.6` | 表单解析 API endpoint 和 model |
| `shine:logic:v0.6` | 头发、眼睛、帽子、衣服的衍生色参数 |
| `shine:eyeSchemes:v0.6` | 眼睛方案 |
| `shine:styleSchemes:v0.13` | 帽子/衣服工作室方案 |

### 6.3 只在内存中的数据

`S.assets` 中保存素材的 `File`、解析后的 PSD、图层 bindings 和合成 Canvas。当前代码没有把素材 PSD 或素材元数据持久化；刷新页面后需要重新上传。

这三个生命周期不能混为一谈：

1. **Template Profile**：跟具体模板签名绑定；
2. **Studio Settings**：全工作室共享的审美参数与方案；
3. **Asset Library / Orders**：素材文件、素材元数据与订单。

第一阶段只做第 1 类，避免把多个本地 key 一次性迁移成不透明大对象。

## 7. 素材库与上传代码

### 7.1 上传入口

| 上传类型 | 入口 | 处理函数 |
| --- | --- | --- |
| 纯净模板 | `#masterFile` / `#masterDrop` | `loadMaster()` |
| A/B 新头发 | `#aHairFile` / `#bHairFile` | `loadHairAsset()` |
| 素材库 PSD | `#assetFiles` / 素材库拖拽区 | `loadAssets()` |
| 吸色参考图 | `#swatchFile` | `loadSwatchImage()` |
| template.json | `#importTemplate` | 内联 import handler |

所有 PSD 上传都先进入 `parsePsd(file)`，即：

```text
浏览器 File → file.arrayBuffer() → agPsd.readPsd()
```

当前不存在上传到 OSS 的代码。

### 7.2 素材分类与语义

素材类别：

- `HAIR`：头发；
- `HAT_DECOR`：耳朵/帽饰；
- `TAIL`：尾巴；
- `PROP`：小物；
- `STICKER`：贴纸。

主要代码：

| 函数 | 位置 | 职责 |
| --- | --- | --- |
| `inferAsset` | `index.html:3062` | 从文件名初步判断 A/B 和分类 |
| `inferPairGroups` | `index.html:2728` | 从一份 PSD 找 A/B 大夹子 |
| `normalizeVariantName` | `index.html:2734` | 去除重复文件后缀等，生成逻辑素材名 |
| `loadAssets` | `index.html:3081` | 批量解析、拆 A/B、替换同名逻辑素材、自动试戴 |
| `inferAssetLayerRole` | `index.html:2134` | 识别底色、重色、内耳、线稿、绒毛等语义 |
| `renderAssetLibrary` | `index.html:2304` | 分类展示、改分类/逻辑名、打开图层绑定、删除 |
| `renderAssetBindingEditor` | `index.html:2277` | 手工修正素材图层 role |

素材 PSD、图层 bindings 和启用状态当前只保存在 `S.assets`，未进入 `localStorage` 或云端。

## 8. 后端入口与现状

### 8.1 GitHub 仓库不含后端，但本地部署包已找到

`shine-private-studio` 仓库中没有：

- `server.js`；
- `package.json` 或 lockfile；
- FC 配置/部署脚本；
- OSS SDK；
- 后端测试。

本次在电脑上找到两份 `Shine_阿里云后端_v0_1.zip`：

- `C:\Users\Lenovo\Downloads\Shine_阿里云后端_v0_1.zip`；
- `C:\Users\Lenovo\Desktop\Shine_阿里云后端_v0_1.zip`。

两份 ZIP 的 SHA-256 均为：

```text
013ADE24F4B9B672EF48201C9E432A077D39AFB234AB4EE97422B3803F6D133F
```

因此可以确认它们是同一份后端部署包。本次只读取 ZIP 内容，没有解压、复制或修改它。

### 8.2 后端包结构与入口

```text
Shine_阿里云后端_v0_1.zip
├── server.js
├── package.json
└── README.txt
```

`package.json` 已确认：

- 包名：`shine-backend`；
- 版本：`0.1.0`；
- 入口：`server.js`；
- 启动脚本：`node server.js`；
- Node 要求：`>=18`；
- 没有第三方依赖。

`server.js` 使用 Node 内置 `http` 模块，结构为：

```text
http.createServer()
    ├─ OPTIONS *       → 204 + CORS
    ├─ GET /health     → 服务/阶段信息
    ├─ GET /api/ping   → 连通信息与服务器时间
    └─ 其他路径        → 404 NOT_FOUND
```

配置：

- `PORT`：默认 `9000`；
- `ALLOWED_ORIGIN`：默认 `*`；
- CORS methods：`GET,POST,OPTIONS`；
- CORS headers：`Content-Type,Authorization`；
- 监听地址：`0.0.0.0`。

当前后端没有请求体解析、认证、限流、OSS SDK、Profile 路由或持久化逻辑；它确实只是第一阶段的连通性服务。

### 8.3 云部署事实

根据当前项目上下文、部署包说明和既有部署记录：

- 阿里云 Function Compute 服务/函数：`shine-backend`；
- 后端入口：`server.js`；
- 启动命令：`node server.js`；
- 监听端口：`9000`；
- 已知接口：`GET /health`、`GET /api/ping`；
- OSS Bucket：`shine-private-studio-nick`；
- RAM 角色：`shine-fc-role`；
- FC 已具备访问 OSS 的权限；
- OSS 文件系统挂载未开启；计划由后端代码通过 SDK 访问 Bucket。

后端代码和依赖已通过 ZIP 验证；FC 控制台中的实际运行时版本、当前 `ALLOWED_ORIGIN`、已部署代码与该 ZIP 是否完全一致，仍需在实施前做只读核对。

## 9. Template Profile 云端保存/读取方案

### 9.1 实施原则

第一阶段只把现有 `buildTemplateJson()` 产物云端化：

- 不改 `parsePsd()`；
- 不改 `templateSig()`；
- 不改任何渲染或配色核心函数；
- 不改变 localStorage key 或现有导入/导出格式；
- 先本地保存，再异步云端保存；
- 云端读取失败时继续使用本地数据；
- 不静默用云端覆盖本地绑定；
- 通过 feature flag 关闭云端后，行为立即恢复为纯 v0.28。

### 9.2 云端对象格式

OSS 里的对象使用服务端 envelope 包装现有 payload，不修改 payload 内部 schema：

```json
{
  "apiVersion": 1,
  "profileKey": "<templateSignature>",
  "revision": 1,
  "createdAt": "2026-08-09T00:00:00.000Z",
  "updatedAt": "2026-08-09T00:00:00.000Z",
  "data": {
    "schemaVersion": "shine-template-0.28-alpha",
    "template": {},
    "colorPolicy": {},
    "rootStackOrder": [],
    "hairInsertion": {},
    "bindings": {},
    "savedAt": "2026-08-09T00:00:00.000Z"
  }
}
```

这样本地导出的 template.json、内存对象和云端 `data` 保持同一种业务结构。

### 9.3 OSS 对象路径

建议使用独立私有前缀：

```text
template-profiles/v1/<server-side-hash-of-template-signature>.json
```

要求：

- Bucket 和对象保持 private；
- 客户端只能提交 `templateSignature`，不能提交 OSS object key；
- 后端使用 Node `crypto` 对签名做 SHA-256 后拼接 key，阻止路径穿越和任意前缀写入；
- 对象设置 `Content-Type: application/json; charset=utf-8`；
- JSON 大小先限制为 512 KiB；
- 后端校验 `schemaVersion`、`template.signature`、bindings 类型和字段白名单；
- OSS ETag 用于条件更新和冲突检测。

### 9.4 API 契约

最小接口：

```http
GET /api/template-profiles/:templateSignature
PUT /api/template-profiles/:templateSignature
OPTIONS /api/template-profiles/:templateSignature
```

`GET`：

- `200`：返回 envelope，并附 `ETag`；
- `404`：云端尚无该模板；前端继续使用本地绑定；
- `401/403`：未认证/无权限；
- `500/503`：后端或 OSS 故障；前端不阻断上色。

`PUT`：

- 路径签名必须等于 `data.template.signature`；
- 只接受 `shine-template-0.28-alpha` 或明确列出的兼容 schema；
- 后端生成 `revision`、`createdAt`、`updatedAt`；
- 支持 `If-Match` 防止旧页面覆盖新版本；
- 返回 `200`（更新）或 `201`（首次创建）；
- 冲突返回 `409/412`，不直接覆盖。

列表、删除、重命名、历史版本和批量迁移不属于第一阶段。第一次上线尤其不增加删除接口。

### 9.5 认证与 CORS

GitHub Pages 前端是公开源码。CORS 只能限制浏览器来源，不能替代身份认证。

严禁：

- 把 OSS AccessKey 写入 `index.html`；
- 把永久管理 token 写入 `index.html` 或 GitHub；
- 只靠 `Access-Control-Allow-Origin` 保护写接口；
- 让浏览器直接使用 `shine-fc-role`。

单用户 MVP 可采用短会话：

1. 用户运行时输入工作室口令，口令不写入 `localStorage`；
2. `POST /api/session` 经 HTTPS 提交；
3. 后端验证慢哈希后签发短期 token；
4. token 只存内存或 `sessionStorage`；
5. profile 读写要求 `Authorization: Bearer <token>`；
6. 增加失败限速、token 过期和日志脱敏。

如果已有可靠身份系统，应优先复用它。

建议 FC 环境变量：

```text
OSS_REGION=cn-hangzhou
OSS_BUCKET=shine-private-studio-nick
OSS_PROFILE_PREFIX=template-profiles/v1/
ALLOWED_ORIGIN=<实际 GitHub Pages origin>
PROFILE_MAX_BYTES=524288
AUTH_*=<仅服务端使用的认证配置>
```

FC 继续通过 `shine-fc-role` 获取临时凭据，不配置永久 AccessKey。

### 9.6 前端最小接入点

保存链路：

```text
用户点击“保存模板绑定”
    ├─ 原样执行 saveBindingsLocal()       # v0.28 本地保存先成功
    └─ feature flag 开启时：
         buildTemplateJson()
            └─ PUT cloud profile          # 异步，不阻断生产
```

读取链路：

```text
loadMaster()
    ├─ 原样解析、计算签名、恢复本地绑定并完成首次渲染
    └─ feature flag 开启时：
         GET cloud profile
            ├─ 不存在/失败：保持本地状态
            ├─ 相同 revision：无需动作
            └─ 云端较新：提示用户“应用云端配置”，不静默覆盖
```

建议新增独立函数，而不是把网络逻辑塞进 PSD 函数：

```text
cloudProfilesEnabled()
getCloudTemplateProfile(signature)
putCloudTemplateProfile(payload, etag)
applyTemplateProfile(payload)       # 复用现有导入逻辑
renderCloudProfileStatus()
```

第一版 feature flag 默认关闭。后端、认证、CORS 和真实 PSD 回归全部通过后再打开。

### 9.7 Studio Settings 单独迁移

Template Profile 稳定后，第二个小阶段再保存全局工作室设置：

```text
presets
styleSchemes
logic
eyeSchemes
```

建议使用独立资源，例如：

```http
GET /api/studio-settings
PUT /api/studio-settings
```

不要把这些全局方案复制进每个模板 profile，也不要在第一刀迁移 orders 或 assets。

## 10. 预计修改范围

源码和后端归档齐全后，预计只改/新增以下范围：

| 文件 | 计划 | 约束 |
| --- | --- | --- |
| `index.html` | 新增 cloud profile adapter、短会话状态、同步状态和 feature flag | 不改 PSD 解析/渲染/配色核心函数，不拆框架 |
| `server.js` | 保留现有接口，增量加入 session 与 profile 路由 | 后端文件目前不在仓库，先归档再改 |
| `package.json` / lockfile | 锁定 OSS SDK、校验和认证依赖 | 先确认 FC 运行时和部署方式 |
| 后端测试文件 | mock OSS，测试认证、校验、冲突和错误降级 | 不访问生产前缀 |
| 部署文档/脚本 | 固化依赖安装、ZIP 结构、环境变量、版本和回滚 | 首次实现不自动覆盖生产 |
| `SHINE_ARCHITECTURE.md` | 记录实际后端结构和最终 API | 与实现同步 |

不建议为了 profile 功能先拆分 `index.html`。模块化可作为未来独立项目，不能和云端首发混做。

## 11. 分阶段实施计划

### 阶段 0：补齐与冻结基线

1. 经用户确认后，把已找到的 `server.js`、`package.json`、说明文件和部署 ZIP 归档进受控目录或独立后端仓库；
2. 校验线上 GitHub Pages 文件与当前 `main/index.html` 一致；
3. 为当前提交建立明确的 v0.28 tag 或 release；
4. 记录 FC 运行时、环境变量名称、CORS 和回滚版本；
5. 不提交任何密钥。

### 阶段 1：建立 v0.28 回归清单

至少固定以下真实生产 smoke test：

- 纯净模板能解析、体检并预览；
- A/B 头发按大夹子顺序插入；
- 狐狸、兔耳及当前稳定素材能显示和改色；
- 模板锁定、单层微调和人工覆写可用；
- 眼睛、帽子、衣服和背景方案行为不变；
- 白底、蕾丝/花纹和透明底输出不变；
- PNG/JPEG/剪贴板导出不变；
- `/health`、`/api/ping` 和 CORS 不变。

### 阶段 2：后端测试版本

1. 在现有 `server.js` 增量加入认证和 OSS client；
2. 实现 `GET`/`PUT`/`OPTIONS` 与 JSON 校验；
3. 使用测试前缀验证 `shine-fc-role` 的读写权限；
4. 测试 404、非法签名、超限、未授权、ETag 冲突和 OSS 故障；
5. 部署为独立 FC 版本/别名，不直接覆盖生产版本。

### 阶段 3：前端 local-first 接入

1. 保留原 `saveBindingsLocal()`；
2. 增加独立 cloud adapter；
3. 默认关闭 feature flag，仅测试 URL/账号开启；
4. 云端失败时保留本地保存和全部出图能力；
5. 云端较新时让用户明确确认后应用。

### 阶段 4：真实 PSD 验收与灰度

1. 用 v0.28 主模板保存云端 profile；
2. 刷新或换浏览器，重新上传同一 PSD，确认命中同一签名；
3. 验证 bindings、锁、rootStackOrder、hairInsertion 全部恢复；
4. 断网、后端 500、OSS 403 时仍可本地上色和导出；
5. 先对单账号开启，观察后再决定默认开启。

### 阶段 5：后续资源

按顺序独立实施：

1. Studio Settings 云端保存；
2. 素材 PSD 预签名直传与素材元数据；
3. 素材列表恢复、缓存和版本管理；
4. 订单云保存与批量订单；
5. DeepSeek 代理与权限收口。

## 12. 验收标准

- feature flag 关闭时，v0.28 行为与当前生产一致；
- `parsePsd()`、渲染链路和颜色核心无改动；
- `/health`、`/api/ping` 响应契约不变；
- 未认证请求不能读取或写入 profile；
- 前端源码和浏览器永久存储中没有长期凭据；
- 同一 PSD 在不同设备生成相同的现有 templateSignature；
- profile 保存、读取、校验和导入成功；
- OSS/网络故障不阻断解析、上色、预览和导出；
- 冲突不静默覆盖本地配置；
- 日志不记录口令、token、profile 正文或顾客信息；
- 关闭 feature flag、切回上一 FC 版本即可回滚。

## 13. 风险点

1. **后端源码已找到，但未进入版本控制**  
   当前 ZIP 已能确认 `server.js`、依赖、CORS 和路由实现，但它不在 Git 历史中，仍无法可靠比较 FC 线上版本与本地包，也没有自动测试或变更审计。

2. **v0.28 缺少明确 tag 和发布记录**  
   仓库只有一个手工上传提交。上线前应建立不可歧义的基线，避免未来不知道哪个 HTML 是稳定母版。

3. **单文件耦合高**  
   一个 `index.html` 同时承担 UI、PSD 解析、渲染、状态、素材、订单和导出。即使只加网络 adapter，也必须保持修改面极小。

4. **Profile 与其他本地状态是分裂的**  
   bindings、根顺序、头发插入、预设、逻辑、眼睛方案、订单使用不同 key。一次性“全部上云”容易破坏生命周期和覆盖优先级。

5. **现有模板签名不是密码学哈希**  
   FNV-1a 图层路径签名适合兼容现有本地 key，但理论上存在碰撞，也不感知像素变化。第一阶段为避免触碰解析核心继续复用；未来可在 schema v2 增加强指纹。

6. **公开前端的认证风险**  
   GitHub Pages 源码公开，固定 token 和 AccessKey 不能放入页面。CORS 不能阻止非浏览器调用。

7. **本地与云端冲突**  
   同一模板可能同时存在本地、导入文件和云端三份配置。没有 revision/ETag 和明确确认流程会导致绑定丢失。

8. **错误 profile 会直接影响成图**  
   bindings 和锁定状态一旦错配，可能造成素材消失、图层串色或错误改色，因此不能静默覆盖本地。

9. **CDN 单点依赖**  
   `ag-psd@31.0.2` 从 jsDelivr 运行时加载；网络或 CDN 异常会让 PSD 无法解析。云端 profile 首发不应顺带更换该依赖方式。

10. **素材上云范围更复杂**  
    PSD 是大文件，涉及预签名上传、断点、缓存、元数据、版本、删除和公网流量，必须与小型 profile JSON 分开发版。

11. **FC 依赖打包风险**  
    当前包没有第三方依赖且声明 Node `>=18`。新增 OSS SDK 后仍需确认 FC 实际 Node 版本、`node_modules`、lockfile、ZIP 根目录和冷启动行为。

## 14. 下一步建议

后端部署 ZIP 已找到。最适合的下一步是在用户确认进入实施阶段后，先把当前基线安全归档，再开始 Profile 测试版本：

1. 给当前 `9cab6ba` 建立明确的 v0.28 基线；
2. 将已验证的后端 v0.1 源码纳入版本控制；
3. 固定回归清单；
4. 只实现 Template Profile 的 `GET`/`PUT` 测试版本；
5. 以前端 local-first + feature flag 方式灰度接入；
6. Profile 闭环稳定后再处理 Studio Settings 和素材 PSD。

在用户明确批准进入实施阶段前，不修改前端、不复制后端进仓库，也不部署新的云接口。

## 15. 第一阶段本地实现记录（2026-08-09）

用户已批准开始第一阶段。当前工作在 `codex/template-profile-phase1` 分支进行，尚未 push、尚未部署、尚未连接生产 OSS。

### 15.1 已冻结的回滚基线

- 原始 GitHub Pages 提交 `9cab6ba` 已建立本地 annotated tag：`v0.28`；
- 后端 v0.1 ZIP 的原始文件已经归档到 `backend/`；
- 归档提交为 `550e23d chore: archive Shine v0.28 architecture and backend v0.1`；
- PSD 解析入口 `parsePsd()`、模板签名 `templateSig()`、重组、改色和导出核心没有修改。

### 15.2 后端 v0.2 本地结构

```text
backend/
├── server.js                    # 启动入口；保留 9000 端口
├── src/app.js                   # HTTP 路由、认证、校验、ETag/CORS
├── src/oss-profile-store.js     # FC 临时凭证与 OSS Profile object 适配器
├── test/app.test.js             # API 契约与错误分支
├── test/oss-profile-store.test.js
├── test/frontend-contract.test.js
├── package.json
├── package-lock.json
└── README.md
```

新增接口：

```text
GET /api/template-profiles/:templateSignature
PUT /api/template-profiles/:templateSignature
```

Profile object key 固定为：

```text
template-profiles/v1/<sha256(templateSignature)>.json
```

客户端不能直接指定 OSS key。后端只接受 `shine-template-0.28-alpha`，默认请求体上限为 512 KiB。首次创建要求 `If-None-Match: *`；更新要求 `If-Match` 与最新 ETag 一致。

认证使用 `SHINE_PROFILE_TOKEN`。未配置时 fail closed，不允许匿名读写。OSS AccessKey 不进入仓库；运行时读取 `shine-fc-role` 注入的临时环境变量，兼容 FC 自定义运行时的临时凭证请求头。

### 15.3 前端 local-first 灰度接入

- 默认 URL 不显示云端控件，也不会发送 Profile 网络请求；
- 只有查询参数 `?cloudProfiles=1` 才显示测试面板；
- 原“保存模板绑定”仍只调用 `saveBindingsLocal()`；
- 云端保存和云端读取使用独立按钮；
- 后端地址可存在 `localStorage`，测试口令只存在 `sessionStorage`；
- 云端读取必须校验 schema 和当前模板签名，并由用户明确确认后才应用；
- 网络/OSS 失败只显示状态，不阻断 PSD 解析、上色、预览或导出。

### 15.4 当前并发限制

首次创建使用 OSS `x-oss-forbid-overwrite`，可以原子防止两个首次写入互相覆盖。现阶段更新采用“读取 ETag → 临近写入前复查 → PutObject”，适合单人灰度测试，但不是多人同时编辑下的事务型 CAS。进入批量订单或多账号协作前，应把 revision/锁迁移到具备条件写能力的元数据存储。

### 15.5 上线前仍需人工确认

1. 在阿里云控制台只读核对 FC Node 运行时、`shine-fc-role`、Bucket region 和线上 v0.1 代码；
2. 配置 `ALLOWED_ORIGIN` 和随机生成的 `SHINE_PROFILE_TOKEN`，不把值发到聊天或提交 Git；
3. 部署为独立测试版本/别名，不能直接覆盖稳定版本；
4. 用真实 v0.28 PSD 完成保存、换浏览器读取、人工确认应用、断网降级回归；
5. 验收通过后再决定是否 push、合并和切换流量。
