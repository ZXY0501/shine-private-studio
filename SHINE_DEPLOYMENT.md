# Shine 部署与回滚

> 生产基线：GitHub Pages `main` / v0.28
> Phase 2 开发分支：`codex/phase2`

## 1. 当前生产资源

- 前端仓库：`ZXY0501/shine-private-studio`
- 生产前端：`https://zxy0501.github.io/shine-private-studio/`
- 阿里云区域：华东 1（杭州）
- FC：`shine-backend`
- 私有 OSS Bucket：`shine-private-studio-nick`
- RAM Role：`shine-fc-role`
- RAM Policy：`ShinePrivateStudioOSSAccess`

禁止重新创建同名资源，禁止把永久 AccessKey 写入源码。

## 2. 现有后端契约

一期接口必须保持：

```http
GET /health
GET /api/ping
GET /api/template-profiles/:templateSignature
PUT /api/template-profiles/:templateSignature
POST /api/deepseek/parse
```

Template Profile 使用 Bearer 测试口令和 ETag/If-Match 防止误覆盖。现有 OSS 前缀默认为 `template-profiles/v1`。

## 3. Phase 2 隔离规则

- 二期只在 `codex/phase2` 开发。
- 未经确认不推送到生产分支。
- 未经确认不修改 GitHub Pages 发布源。
- 二期后端接口使用新路径和新 OSS 前缀，不覆盖 `template-profiles/v1`。
- 二期预览必须带有明显的 Phase 2 标识，并使用独立 URL 或等价隔离环境。

## 4. 本地验证

后端：

```powershell
cd backend
npm.cmd ci
npm.cmd test
npm.cmd start
```

前端是单文件页面。可以通过本地静态服务器访问，避免直接打开 `file://` 带来的浏览器权限差异。

每次阶段提交前至少执行：

```powershell
cd backend
npm.cmd test
git diff --check
```

并确认：

- `main` 未被切换或修改；
- 没有 token、AccessKey、STS 凭据进入 Git；
- v0.28 前端契约测试通过；
- 新增接口测试不访问真实 OSS。

## 5. Phase 2 后端规划

在保留一期接口的前提下，增量加入：

```http
GET    /api/v2/assets
POST   /api/v2/assets/uploads
POST   /api/v2/assets/:assetId/complete
GET    /api/v2/assets/:assetId/download
PATCH  /api/v2/assets/:assetId
DELETE /api/v2/assets/:assetId

GET    /api/v2/studio-settings
PUT    /api/v2/studio-settings
```

首版删除建议使用软删除 metadata，不立即物理删除 OSS 源 PSD。物理清理需要单独、可恢复的后台流程。

上传推荐流程：

1. 前端把文件名、大小、SHA-256 和素材 metadata 发给 FC。
2. FC 校验大小、类型和目标前缀，生成短时受限上传信息。
3. 浏览器直传私有 OSS。
4. 前端通知 FC 完成；FC 校验对象存在后写入 metadata。
5. 列表接口只返回 metadata 和短时缩略图地址。

## 6. 环境变量

保留一期变量，并为二期增加独立配置。变量值不得提交到 Git：

```text
ALLOWED_ORIGIN
SHINE_PROFILE_TOKEN
SHINE_OSS_BUCKET
SHINE_OSS_REGION
SHINE_OSS_ENDPOINT
SHINE_PROFILE_PREFIX
PROFILE_MAX_BYTES

SHINE_ASSET_PREFIX=assets/v2
SHINE_ASSET_METADATA_PREFIX=asset-metadata/v2
SHINE_STUDIO_SETTINGS_PREFIX=studio-settings/v2
ASSET_MAX_BYTES
UPLOAD_TTL_SECONDS

DEEPSEEK_API_KEY=<仅在 FC 控制台填写>
DEEPSEEK_API_BASE=https://api.deepseek.com
DEEPSEEK_FLASH_MODEL=deepseek-v4-flash
DEEPSEEK_PRO_MODEL=deepseek-v4-pro
DEEPSEEK_TIMEOUT_MS=20000
DEEPSEEK_MAX_BODY_BYTES=65536
```

`DEEPSEEK_API_KEY` 不得写入部署包、GitHub Secrets 以外的源码文件、前端或项目文档。Phase 3 首轮只通过 `?cloudProfiles=1` 隐藏入口测试，复用 `SHINE_PROFILE_TOKEN` 做代理接口鉴权；真实客单回归通过前不开放普通入口。解析固定本地优先，随后按需使用 `flash0731`（默认 `deepseek-v4-flash`），只有 Flash 仍有解析问题时才使用 `pro0813`（默认 `deepseek-v4-pro`）。

## 7. 发布顺序

1. 本地单元测试和前端契约测试全部通过。
2. 部署到独立 Phase 2 后端函数或独立版本/别名。
3. 发布独立 Phase 2 Preview。
4. 使用真实纯净模板、复杂挑染头发、A/B 耳朵、嘴巴和配饰完成至少一单回归。
5. 使用脱敏真实客单验证 DeepSeek 结构化输出、非法输出拦截、超时与本地规则回退。
6. 用户明确确认“可以合并生产版”。
7. 才允许合并 `main` 并切换生产入口。

## 8. 回滚

前端回滚：

- 将 GitHub Pages 发布源恢复到 `v0.28` 对应提交或稳定的 `main` 提交。
- 二期 Preview 与生产入口分离，因此测试期不需要回滚生产。

后端回滚：

- 将 FC 流量/别名切回一期稳定版本。
- 保留 `template-profiles/v1`，不要因二期回滚删除现有 Profile。
- `assets/v2` 和 metadata 暂停写入即可；不要自动删除已上传素材。

数据回滚：

- metadata 使用版本号和软删除字段。
- OSS 开启版本控制后，误覆盖可恢复旧版本；启用前需单独确认费用和生命周期策略。
