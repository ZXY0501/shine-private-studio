# Shine Phase 2：素材系统与新模板适配

> 状态：实施中
> 开发分支：`codex/phase2`
> 生产基线：`v0.28` / `main`，禁止自动合并、覆盖或部署
> 最后更新：2026-08-10

## 当前实现进度（仅 `codex/phase2`，未部署）

- 已完成：可折叠内置/自定义大类、素材缩略图、A/B 独立勾选、上传默认保留原色。
- 已完成：手动虚拟大夹子顺序，不要求 PSD 包含 `@SLOT_*`；素材可在整块预览区拖动，并支持缩放、旋转和翻转。
- 已完成：私有 OSS 素材目录 API、单对象短时签名直传、按需下载和确认删除；前端入口仍受 `?cloudProfiles=1` 隐藏开关保护。
- 待联调：测试 FC 部署、Bucket CORS、真实大 PSD 上传/重新载入和回滚。
- 已完成：Eye Scheme v2 双锚点、完整字段映射与旧方案迁移；固定近白高光继续沿用 PSD 原像素。
- 已完成：订单本标签页临时出图历史；PNG/JPEG 自动归入当前订单，刷新或关闭标签页即清空。
- 待实现：IndexedDB 素材缓存与完整缩略图生命周期。

## 1. 不可越过的兼容边界

- Phase 2 只在独立分支和独立预览入口开发。
- 不修改 `ag-psd` 的读取入口和 v0.28 PSD 解析核心。
- 不删除或改变一期衣服、帽子、眼睛、背景、耳朵、尾巴、导出及单层微调功能。
- 新接口只能增量加入；`GET /health`、`GET /api/ping` 和一期 Template Profile API 保持兼容。
- 未收到“可以合并生产版”的明确指令，不合并 `main`，不替换 GitHub Pages 生产站。
- 所有素材默认保留上传 PSD 的原始颜色。归类不等于授权改色。

## 2. 以最新业务决定为准

早期方案曾建议在 PSD 中建立 `@SLOT_*` 提示层。该方案已被后续业务决定替代：

- 不要求模板作者修改 PSD 或预埋提示图层。
- Template Profile 在网页内维护虚拟插槽。
- 用户可以手动拖动素材在人物、头发、帽子等层级之间的位置。
- 同一素材的画面位置变换与 Z 层级调整是两个独立操作。
- 旧模板继续使用 v0.28 语义层级作为初始建议，但建议不得覆盖用户手动选择。

## 3. 素材分类

内置大类按以下顺序显示，并允许折叠：

1. 纯净模板 `CLEAN_TEMPLATE`
2. 头发 `HAIR`
3. 耳朵 `EAR`
4. 嘴巴表情 `MOUTH`
5. 尾巴 `TAIL`
6. 配饰 `ACCESSORY`
7. 小物 `PROP`

用户可以创建自定义大类。自定义分类只影响整理和筛选，不改变渲染或改色权限。

每个素材卡至少显示：

- 预览缩略图；
- 名称；
- 所属大类；
- A/B/全局适配范围；
- 原色保留或主动跟随订单配色状态；
- 云端同步和本地缓存状态。

## 4. Asset Metadata v2

```json
{
  "schemaVersion": "shine-asset-v2",
  "assetId": "asset_xxx",
  "name": "狐狸耳朵",
  "categoryId": "EAR",
  "characterCompatibility": "BOTH",
  "defaultSlot": "A",
  "colorMode": "PRESERVE_ORIGINAL",
  "layerVisibility": {
    "A头发/刘海": true,
    "A头发/备用发饰": false
  },
  "compatibleTemplateIds": [],
  "defaultTransform": {
    "x": 0,
    "y": 0,
    "scale": 1,
    "rotation": 0,
    "flipX": false,
    "flipY": false
  },
  "templateTransforms": {},
  "sourceObjectKey": "assets/v2/.../source.psd",
  "thumbnailObjectKey": "assets/v2/.../thumbnail.webp",
  "contentHash": "sha256:...",
  "version": 1,
  "createdAt": "ISO-8601",
  "updatedAt": "ISO-8601"
}
```

约束：

- `colorMode` 默认必须是 `PRESERVE_ORIGINAL`。
- `layerVisibility` 只保存网页端的显隐覆盖；空对象表示完全沿用 PSD 原始显隐，不得改写 PSD 的 `hidden` 字段。
- 只有用户主动开启“跟随订单配色”后才切换为 `FOLLOW_ORDER`。
- 改分类、改名称、切换 A/B、移动层级都不得自动切换 `colorMode`。
- 素材源 PSD 不保存订单中的位置、旋转和缩放。

## 5. 素材选择与 A/B 规则

耳朵、嘴巴表情等成套素材使用独立 A/B 勾选框：

- 素材卡可分别勾选 A 位和 B 位。
- 同一大类、同一人物位默认单选；勾选新素材会取消该人物位的旧素材。
- 用户可以主动取消勾选，表示该人物位不使用该类素材。
- A 与 B 相互独立，例如 A 狐狸耳、B 兔耳可以同时存在。
- 选择或更换头发不得清空耳朵、帽子、嘴巴、配饰或小物。
- 上传顺序不再决定 A/B。

## 6. 虚拟插槽与 Z 层级

Template Profile 保存 `slotRegistry`。插槽由网页创建，不依赖 PSD 命名协议。

```json
{
  "slotRegistry": [
    {
      "slotId": "slot_A_hair",
      "character": "A",
      "categoryId": "HAIR",
      "insertAfterPath": "A人物/脸",
      "label": "A 头发",
      "order": 20
    }
  ]
}
```

用户可以在模板层级面板中拖动插槽或素材实例。上方覆盖下方。头发既可以放在帽子下，也可以移到最上方。

旧模板第一次载入时，可根据 v0.28 的现有语义生成建议插槽；建议结果需要用户确认并保存到 Template Profile。

## 7. 自由变换

订单中的每个素材实例拥有独立变换：

```json
{
  "instanceId": "instance_xxx",
  "assetId": "asset_xxx",
  "character": "A",
  "slotId": "slot_A_accessory",
  "transform": {
    "x": 0,
    "y": 0,
    "scale": 1,
    "rotation": 0,
    "flipX": false,
    "flipY": false
  }
}
```

交互规则：

- 先选中素材，再在预览画布任意空白位置拖动，即可移动该素材。
- 不要求鼠标必须压在素材像素上。
- 素材卡直接提供当前 A/B 位的调整入口，以及缩放、旋转、水平翻转、垂直翻转和复位控制。
- `Space + 拖动`保留给画布平移，避免与素材移动冲突。
- 变换只修改订单实例，不修改云端源素材。

## 8. 颜色策略

### 8.1 上传素材

- 所有新上传素材默认 `PRESERVE_ORIGINAL`。
- 分类不会触发改色。
- “跟随订单配色”是显式开关，默认关闭。
- 单层手动微调是用户显式操作，优先级最高。

### 8.2 帽子

帽子颜色提供三种来源：

1. 默认锚定耳朵底色；
2. 帽子预设方案；
3. 手动选色。

手动选色使用顺滑取色器，只影响帽子及其方案内的线稿/辅色，不改耳朵素材原色。

### 8.3 Eye Scheme v2

眼睛至少有两个独立颜色锚点：`irisBase` 和 `pupilAccent`。字段支持 `DERIVED`、`FIXED`、`INDEPENDENT`。

完整角色包括：

- `EYE_IRIS_BASE`
- `EYE_IRIS_DARK`
- `EYE_IRIS_DEEP`
- `EYE_IRIS_HIGHLIGHT`
- `EYE_PUPIL`
- `EYE_PUPIL_DARK`
- `EYE_PUPIL_HIGHLIGHT`
- `EYE_OUTLINE`
- `EYE_LASH`
- `EYE_LASH_HIGHLIGHT`

推导公式必须声明色彩空间。当前参考公式使用 HSL，不能直接套入一期的 OKLCH 参数。

Eye Scheme 只改变已绑定字段的颜色，不改变图层可见性、顺序、不透明度、剪贴关系或 Multiply 等 PSD 混合模式。隐藏高光保持隐藏，固定近白高光不随锚点漂移。

普通订单 UI 只显示“眼睛主色”和“Eye Scheme”；只有所选方案需要第二锚点时，才在高级区显示“瞳孔点缀色”。

## 9. 订单当日临时出图记录

点击任意 PNG/JPEG 出图按钮后，将结果记录到当前订单：

- 生成的预览图；
- 当时的订单编辑状态；
- 时间和导出类型。

该历史仅放在当前页面内存，不上传云端、不写长期存储。刷新、关闭标签页、关闭浏览器或关机后可以自动清空，用于当天临时返图。

## 10. 云端与缓存

推荐 OSS 布局：

```text
template-profiles/v1/   # 已有一期 Profile，保持兼容
templates/v2/
assets/v2/
asset-metadata/v2/
studio-settings/v2/
schemes/v2/
```

原则：

- Bucket 保持私有。
- 永久 AccessKey 不进入前端或 Git。
- 大 PSD 优先使用后端签发的短时、限 key 上传能力。
- 页面启动只拉 metadata 和缩略图；使用素材时再 lazy-load PSD。
- 本地大文件缓存使用 IndexedDB，按 `assetId + version + contentHash` 失效。

## 11. 生命周期边界

- Template Profile：模板结构、语义绑定、虚拟插槽、系统控制层。
- Studio Settings：颜色预设、Eye Scheme、用户分类。
- Asset Library：PSD、缩略图和素材 metadata。
- Order：选择的素材实例、A/B、颜色、变换和单层覆写。
- Session Export History：仅本标签页内存中的临时出图记录。

这五类数据不得合并为一个不透明大对象。

## 12. 验收重点

- v0.28 老模板仍能解析和出图。
- 素材归类后原色不变。
- A/B 耳朵、嘴巴可以独立勾选和取消。
- 头发、帽子、耳朵、配饰可以同时存在。
- 用户可手动调整素材 Z 层级，不依赖 PSD 提示层。
- 自由变换在同一订单内可靠恢复。
- 云端素材刷新后仍存在，并按需下载。
- Multiply、隐藏高光和固定近白层保持原 PSD 行为。
- 预览与 PNG/JPEG 导出一致。
