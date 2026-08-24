# Shine 项目移交说明

更新时间：2026-08-13  
当前基线：v0.28  ̶ Phase 2 云素材/模板能力已部署

2026-08-24 增量：四期配色/灵活组件与朋友独立账户已合入。日常入口直接显示登录区；管理员沿用原工作台口令创建朋友账号，朋友共用云素材但没有删除素材、修改模板规则或管理账号的权限。

## 1. 项目定位

Shine 是一个基于 Procreate PSD 图层语义和确定性规则的快速上色网页工具，用于定制头像、临时调整和订单出图。

必须遵守：

- 不删除 v0.28 已有功能；
- 不修改 PSD 解析核心入口；
- 未确认前不做大规模重构；
- 素材上传默认保留 PSD 原色，只有用户主动选择跟随订单配色时才改色；
- Token、AccessKey、STS 凭证不得进入 Git 或前端源码。

## 2. 当前入口

### 日常工作入口

<https://zxy0501.github.io/shine-private-studio/>

### 隐藏云端测试入口

<https://zxy0501.github.io/shine-private-studio/?cloudProfiles=1>

隐藏入口用于配置后端地址、测试口令、读取 Template Profile 和读取云素材目录。日常制图不需要携带查询参数。

## 3. 已部署资源

- GitHub 仓库：`ZXY0501/shine-private-studio`
- GitHub Pages：`https://zxy0501.github.io/shine-private-studio/`
- 正式 FC 函数：`shine-backend`
- Phase 2 测试函数：`shine-backend-profile-test`（保留作回滚/对照，不要误删）
- OSS Bucket：`shine-private-studio-nick`
- RAM Role：`shine-fc-role`
- RAM Policy：`ShinePrivateStudioOSSAccess`
- 区域：华东 1（杭州）

正式函数公网触发器地址由阿里云控制台管理，不写入源码；网页隐藏测试入口中应填写正式触发器的基础地址，不要追加 `/api/ping`。

## 4. 已完成能力

### 一期 v0.28

- PSD 上传、解析、图层语义绑定；
- A/B 表单清洗和配色；
- 眼睛方案、帽子/衣服配色；
- PNG/JPEG 出图；
- 单层微调和原有订单流程。

### Phase 2

- 素材库分类：纯净模板、头发、耳朵、嘴巴、尾巴、边框、配饰、小物；
- 自定义素材大类和折叠；
- 素材缩略图；
- A/B 独立勾选；
- 耳朵与同动物尾巴自动配对；
- 耳朵底色、重色、主线稿与尾巴对应锚定；耳朵绒毛线稿保持独立；
- 素材整体拖动、缩放、旋转、水平/垂直翻转；
- 单层微调只显示当前订单已启用的 A/B 素材；
- 边框多层叠加、置顶、置底、删除和预览吸色；
- 帽子线稿不再跟随眼睛颜色；
- 帽子/衣服官方固定色板与手动配色；
- Eye Scheme v2，同时保留一期傻瓜式瞳孔方案；
- 订单切换时独立保存颜色方案、素材变换和图层顺序；
- PNG/JPEG 临时出图记录归入当前订单，刷新或关闭标签页后清理；
- 纯净模板和素材 PSD 自动保存到浏览器 IndexedDB；
- 云端只先读取目录 metadata，使用时再下载 PSD；
- 云端素材保存、读取、按需下载和删除。

## 5. 云端存储约定

### Template Profile

```text
template-profiles/v1/<sha256(signature)>.json
```

用于保存模板语义绑定、颜色策略、虚拟插槽和根图层顺序。采用 Bearer token、ETag 和 If-Match/If-None-Match，避免覆盖错误版本。

### Cloud Asset

```text
assets/v2/<assetId>/source.psd
asset-metadata/v2/<assetId>.json
```

PSD 使用短时签名 URL 由浏览器直传 OSS，后端再校验对象大小并写入 metadata。Bucket 为私有读写，不能改为公共读写。

## 6. 正式函数环境变量

必需：

```text
ALLOWED_ORIGIN=https://zxy0501.github.io
SHINE_PROFILE_TOKEN=<由阿里云 FC 环境变量保管，不写入文档>
```

推荐额外配置独立随机值；未配置时会兼容沿用管理员口令签名会话：

```text
SHINE_SESSION_SECRET=<由阿里云 FC 环境变量保管，不写入文档>
SHINE_SESSION_SECONDS=604800
SHINE_ACCOUNT_PREFIX=accounts/v1
```

可显式填写，也可以使用代码默认值：

```text
SHINE_OSS_BUCKET=shine-private-studio-nick
SHINE_OSS_REGION=oss-cn-hangzhou
SHINE_OSS_PUBLIC_ENDPOINT=https://oss-cn-hangzhou.aliyuncs.com
SHINE_ASSET_PREFIX=assets/v2
SHINE_ASSET_METADATA_PREFIX=asset-metadata/v2
ASSET_MAX_BYTES=209715200
ASSET_TICKET_SECONDS=900
```

OSS AccessKey 不应手动放入函数环境变量；正式函数通过 `shine-fc-role` 获取临时访问权限。

## 7. 后端接口

一期兼容接口：

```http
GET /health
GET /api/ping
GET /api/template-profiles/:templateSignature
PUT /api/template-profiles/:templateSignature
```

Phase 2 云素材接口：

```http
GET    /api/assets
POST   /api/assets/upload-ticket
POST   /api/assets/:assetId/complete
GET    /api/assets/:assetId/source
DELETE /api/assets/:assetId
```

验收结果：正式函数 `/api/ping` 已返回 `ok: true`；云端素材目录读取、真实 PSD 上传和读取均已由浏览器验证通过。

## 8. OSS CORS 规则

当前本地测试和 GitHub Pages 均可用的规则：

- 来源：`*`；
- Methods：`GET`、`PUT`、`HEAD`；
- 允许 Headers：`*`；
- 暴露 Headers：`ETag`、`x-oss-request-id`；
- 缓存时间：`600` 秒。

如果不再需要本地 `file://` 测试，可将来源收紧为：

```text
https://zxy0501.github.io
```

## 9. 本地开发与验证

后端验证：

```powershell
cd C:\Users\Lenovo\Documents\ChatGPT\SHINE\backend
npm.cmd ci
npm.cmd test
```

当前最后一次验证：54 个测试全部通过。

后端本地启动：

```powershell
npm.cmd start
```

默认监听端口为 `9000`。前端为单文件静态页面，避免直接用 `file://` 时的浏览器权限差异，建议通过静态服务器访问。

## 10. 发布包与版本记录

当前正式候选包：

```text
C:\Users\Lenovo\Documents\ChatGPT\SHINE\.deploy\shine-backend-phase2-production-candidate.zip
```

最近一次后端修复：修正 OSS V4 签名首屏 `marker` 参数，避免 `/api/assets` 出现 `SignatureDoesNotMatch`。

最近本地提交：

```text
62d0df6 fix: handle OSS asset listing with v4 signing
```

`.deploy/` 是本地部署包目录，不应提交到 Git。若需要回滚，保留正式函数上一版本或切回原 v0.28 后端版本；不要删除 OSS 中已有的 `template-profiles/v1`、`assets/v2` 和 metadata。

## 11. 三期计划：DeepSeek 客单解析

DeepSeek 当前尚未真正接入，现阶段客单信息仍使用前端本地规则解析。代码只预留了 API 代理地址和模型字段，没有把 API Key 放入前端。

三期建议拆成以下增量步骤：

1. 在正式后端增加独立代理接口，例如 `POST /api/deepseek/parse`；
2. API Key 只保存为 FC 环境变量，前端永不接触密钥；
3. 将顾客表单发送给代理，要求模型只返回受约束的 JSON 字段；
4. 对模型输出做 schema 校验、字段白名单和长度限制；
5. 请求设置超时和大小上限，失败自动回退到本地规则；
6. 先用低成本快速模型做客单整理，再评估是否需要更强模型；
7. 在隐藏入口灰度测试，通过真实订单回归后再开放给日常入口。

三期不得让 DeepSeek 参与 PSD 解析、取色、图层重组或 PNG/JPEG 出图核心逻辑。AI 只负责把自然语言客单转换成结构化表单，确定性渲染仍由 Shine 本地规则完成。

## 12. 四期开发计划（持续累计）

当前进度（2026-08-14）：第一版已在本地完成，自动测试与本地页面烟测通过，尚未推送或部署正式版。已实现 EYE 独立分类、A/B 表情与眼睛状态选择、选择眼睛状态时替换对应原眼睛大夹子并在取消后恢复、透明 PNG 直传、A/B 双实例、公共装饰、订单级变换/层级保存，以及 PNG/EYE/GLOBAL 云素材后端兼容。

### 表情与眼睛状态替换

- 支持为 A/B 分别更换表情，表情素材作为可切换方案管理，不破坏原 PSD；
- 支持更换眼睛状态，首个明确需求是把当前“一闭一睁”替换成“两只全睁”；
- 眼睛状态替换与现有 Eye Scheme 配色逻辑分开：换眼型/睁闭状态时继续沿用本单瞳色和眼睛方案；
- A/B 的表情和眼睛状态必须独立保存，不同订单之间不得串用；
- 允许恢复原始表情和原始眼睛状态；
- 工作台预览、保存订单以及 PNG/JPEG 导出结果必须一致。

初步验收口径：同一订单内可将任意一位从原表情切到新表情，并将“一闭一睁”切到“两只全睁”；切换 A/B 或切换订单后选择仍准确，恢复原始状态后不留下素材或图层覆写残留。

### PNG 小物素材直传与快速出图

- 工作台支持直接上传带透明通道的 PNG 小物，不再要求所有小物都制作成分层 PSD；
- PNG 小物进入现有素材库，可分配给 A、B 或作为画面公共装饰，并支持置顶/置底、拖动、缩放、旋转和翻转；
- 保留 PNG 原始像素、颜色和透明度，除非用户主动开启跟随订单配色，否则不得自动改色；
- PNG 小物的启用状态、位置和变换参数随订单独立保存，预览与 PNG/JPEG 导出结果一致；
- 对制作成本高但不需要复杂分层的小物，可由 Codex 直接生成透明底 PNG，用户复制保存后上传到 Shine 使用。

初步验收口径：上传一张透明 PNG 后无需转 PSD 即可加入当前订单，透明边缘正常、变换和层级可调；切换角色或订单不会串位，重新打开订单及最终导出时仍保持原位置与外观。

## 13. 接手时的第一轮检查

1. 打开普通网址，确认一期能上传模板并出 PNG/JPEG；
2. 打开 `?cloudProfiles=1`，确认正式后端地址和口令只保存在当前浏览器会话；
3. 点击「读取云端素材」，确认目录可读；
4. 勾选一个云端素材，确认 PSD 按需下载；
5. 切换两个订单，确认素材、颜色方案和图层顺序不串单；
6. 不要在没有回归测试和用户确认的情况下替换生产入口。
