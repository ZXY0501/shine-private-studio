# Shine Backend

`backend/` 先归档了已部署的阿里云函数计算 v0.1 连通性基线；当前分支在它上面增量实现 v0.2 Template Profile 与 Phase 2 素材库测试版。这里记录的 Phase 2 新接口尚未部署到阿里云。

原始部署包：

```text
Shine_阿里云后端_v0_1.zip
SHA-256: 013ADE24F4B9B672EF48201C9E432A077D39AFB234AB4EE97422B3803F6D133F
```

原始文件：

- `server.js`
- `package.json`
- `README.txt`

Web 函数配置：

- 自定义运行时 / Node.js 可运行环境
- 启动命令：`node server.js`
- 监听端口：`9000`

保留的 v0.1 接口（响应契约不变）：

- `GET /health`
- `GET /api/ping`

环境变量：

- `ALLOWED_ORIGIN`
  - 本地默认 `*`；测试/正式环境应设置为实际 GitHub Pages origin。
- `SHINE_PROFILE_TOKEN`
  - Profile API 的临时 Bearer 口令；缺失时接口以 `503 PROFILE_AUTH_NOT_CONFIGURED` 关闭。
- `SHINE_OSS_BUCKET`
  - 默认 `shine-private-studio-nick`。
- `SHINE_OSS_REGION`
  - 默认 `oss-cn-hangzhou`。
- `SHINE_OSS_ENDPOINT`
  - 默认 `https://oss-cn-hangzhou-internal.aliyuncs.com`。
- `SHINE_PROFILE_PREFIX`
  - 默认 `template-profiles/v1`。
- `PROFILE_MAX_BYTES`
  - Profile 请求体上限，默认 524288 bytes。
- `SHINE_OSS_PUBLIC_ENDPOINT`
  - 浏览器短时签名地址使用的公网 OSS Endpoint，默认 `https://oss-cn-hangzhou.aliyuncs.com`。FC 自己读写仍使用内网 Endpoint。
- `SHINE_ASSET_PREFIX`
  - 素材源 PSD 前缀，默认 `assets/v2`。
- `SHINE_ASSET_METADATA_PREFIX`
  - 素材目录 JSON 前缀，默认 `asset-metadata/v2`。
- `ASSET_MAX_BYTES`
  - 单个素材 PSD 上限，默认 200 MiB。
- `ASSET_TICKET_SECONDS`
  - 上传/下载签名有效期，默认 900 秒，最大 3600 秒。
- `DEEPSEEK_API_KEY`
  - 必需；只保存在 FC 环境变量中。缺失时解析接口以 `503 DEEPSEEK_NOT_CONFIGURED` 关闭。
- `DEEPSEEK_API_BASE`
  - 可选；默认 `https://api.deepseek.com`。
- `DEEPSEEK_FLASH_MODEL`
  - 可选；`flash0731` 逻辑层实际调用的模型 ID，默认 `deepseek-v4-flash`。
- `DEEPSEEK_PRO_MODEL`
  - 可选；`pro0813` 逻辑层实际调用的模型 ID，默认 `deepseek-v4-pro`。若账户提供日期版 ID，可只在 FC 环境变量中替换。
- `DEEPSEEK_TIMEOUT_MS`
  - 可选；默认 20000 ms，服务端限制在 3000～60000 ms。
- `DEEPSEEK_MAX_BODY_BYTES`
  - 可选；客单解析请求体上限，默认 65536 bytes，且不会超过 Profile 请求体上限。

OSS 凭证不写入配置文件。代码优先读取 FC 角色注入的 `ALIBABA_CLOUD_ACCESS_KEY_ID`、`ALIBABA_CLOUD_ACCESS_KEY_SECRET`、`ALIBABA_CLOUD_SECURITY_TOKEN`，并兼容自定义运行时请求头中的临时凭证。

## Template Profile API

```text
GET /api/template-profiles/:templateSignature
PUT /api/template-profiles/:templateSignature
```

- 所有 Profile 请求都需要 `Authorization: Bearer <SHINE_PROFILE_TOKEN>`。
- 首次创建需要 `If-None-Match: *`，成功返回 `201` 和 `ETag`。
- 更新需要带上上次读取到的 `If-Match: <ETag>`；过期版本返回 `412 PROFILE_CONFLICT`。
- OSS object key 使用模板签名的 SHA-256，不接受客户端指定对象路径。
- Profile 仅接受现有的 `shine-template-0.28-alpha` schema，单个请求默认不超过 512 KiB。
- 更新的 ETag 检查是“读取后再写入”的单写者保护；首次创建使用 OSS 禁止覆盖头实现原子防覆盖。正式多人协作前需要增加事务型元数据存储。

## 本地验证

```powershell
npm.cmd ci
npm.cmd test
npm.cmd start
```

前端云端面板默认关闭。只在测试地址后加 `?cloudProfiles=1` 才会显示，并且读取到 Profile 后仍需人工确认才应用。

## Asset Library API（Phase 2 测试版）

```text
GET    /api/assets
POST   /api/assets/upload-ticket
POST   /api/assets/:assetId/complete
GET    /api/assets/:assetId/source
DELETE /api/assets/:assetId
```

- 与 Profile API 共用临时 Bearer 口令，但不向前端返回 AccessKey。
- 上传流程是“申请单对象短时 PUT 地址 → 浏览器直传私有 OSS → 后端核对对象大小 → 写入 metadata”。
- 服务端生成 UUID 和固定对象路径，客户端不能指定 OSS key。
- 所有新素材强制登记为 `PRESERVE_ORIGINAL`；分类不会触发改色。
- 支持 `CLEAN_TEMPLATE`、`HAIR`、`EAR`、`MOUTH`、`TAIL`、`FRAME`、`ACCESSORY`、`PROP` 和安全格式的自定义分类。
- `DELETE` 同时移除源 PSD 和 metadata，前端必须先做人类确认。
- Bucket 需要只为测试/正式 GitHub Pages Origin 放行 `PUT`、`GET`、`HEAD` 所需的 CORS；不要设为公共读写。

## DeepSeek 客单解析 API（Phase 3 灰度）

```text
POST /api/deepseek/parse
```

- 与 Profile API 共用 `Authorization: Bearer <SHINE_PROFILE_TOKEN>`；普通生产入口暂不显示 AI 按钮。
- 前端只在 `?cloudProfiles=1` 隐藏入口复用当前标签页的测试口令，DeepSeek API Key 永不进入浏览器。
- 解析顺序固定为“浏览器本地规则 → flash0731 → pro0813”：“本地读表单”不联网；用户明确点击“API 读表单”时，先保留本地结果，再让 Flash 复核表单中已填写且 API 可处理的字段。Flash 输出合法且完成复核时不调用 Pro。
- 耳朵目录会带上当前素材库中已上传的具体名字；本地与 DeepSeek 都优先按“动物 + 姿态”匹配，例如“小狗耳、趴着的”自动选择“趴狗耳”。同一动物存在多个姿态但顾客未写姿态时，不会随便替用户挑选。
- `flash0731` 默认映射 `deepseek-v4-flash`，只有 Flash JSON/结构无效或仍缺少本地未决字段时才调用 `pro0813`（默认 `deepseek-v4-pro`）。
- 后端使用 DeepSeek Chat Completions JSON 模式，关闭思考模式，每次模型调用默认 20 秒超时。
- 客单正文最多 20000 字；后端忽略前端传来的自定义 instructions，只使用固定服务端提示词。
- 返回值只允许顾客名、A/B 名字、明确提供的瞳色/发色十六进制值、现有帽子/衣服/帽饰/背景选项和简短背景理由。
- Pro 仍未补齐、模型编造不存在的预设、返回非法 JSON、超时或上游失败时，接口返回受控错误；前端保留已经完成的本地解析结果。
- 日志不记录顾客表单、模型响应、测试口令或 API Key。

注意：

- 本基线不包含任何 DeepSeek API Key；Key 必须仅由 FC 环境变量注入。
- v0.2 基线只保存 Template Profile JSON；Phase 2 分支新增素材 PSD 与 metadata 接口，仍不保存订单。
- 不要把 `SHINE_PROFILE_TOKEN`、AccessKey 或临时 STS 凭证提交进 Git。
- 本地测试不会访问真实 OSS；只有实际启动并调用 Profile API 时才会创建 OSS client。
