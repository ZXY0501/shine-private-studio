# Shine Backend

`backend/` 先归档了已部署的阿里云函数计算 v0.1 连通性基线；当前分支在它上面增量实现 v0.2 Template Profile 测试版。v0.2 尚未部署到阿里云。

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

注意：

- 本基线不包含任何 DeepSeek API Key。
- v0.2 只保存 Template Profile JSON，不保存 PSD、素材或订单。
- 不要把 `SHINE_PROFILE_TOKEN`、AccessKey 或临时 STS 凭证提交进 Git。
- 本地测试不会访问真实 OSS；只有实际启动并调用 Profile API 时才会创建 OSS client。
