# 配色复盘：只整理候选，不自动发布

这是配色手册的离线维护工具。它读取工作台手动导出的复盘 JSON，输出一份简短报告和一份候选差异 JSON。不会联网、寻找或写入 Obsidian、创建每周任务、改代码、改原手册或改原色配方。

## 使用

先在工作台导出自己的配色手册和反馈。输入结构为：

```json
{
  "handbook": { "schemaVersion": 1, "owner": "自己的账户", "version": 1, "categories": [], "recipes": [], "history": [] },
  "feedback": []
}
```

在项目目录运行，`--output` 应是专用的新目录或空目录，不要使用真实笔记库、输入目录、项目根目录或磁盘根目录：

```powershell
node scripts/review-handbook.js --input "C:\SHINE-Exports\review.json" --output "C:\SHINE-Exports\review-2026-09-08"
```

输出 `review-report.md`（阅读）和 `review-candidates.json`（审核差异）。为了避免覆盖，非空输出目录会被拒绝。输入最多 8 MB、5000 条反馈。格式不合法的反馈会计入排除数量；手册不合法则整个命令失败。

## 整理原则

- 只处理明确确认且允许学习的记录；衍生色不是额外投票，完全撤销不产生色差反馈。
- 客户单次覆盖的权重始终为 0。它的颜色不会出现在报告或候选中；原订单仍可以保留最终设置。
- 重复导出的同一订单、同一部件、同一修改只保留一条证据。来源标签由本地改为 API、或组件只改显示名称，不会产生额外投票。快照必须提供 `context.orderId`，不同订单不能共用同一反馈 ID。缺少订单身份的旧记录仍可读取，但不会进入学习候选。
- 词义纠正只提出词义复核，不据此更改 HEX、锚点或词条权重。当前导出未记录原句时，必须人工补充原词和目标词条。
- 审美修改显示前后色；只有原记录与当前配方、模板和图层角色都对应，才列入候选颜色差异。当前配方已变化则提示重新确认，绝不覆盖。
- 角色配色须有明确角色名，并且有模板或眼睛方案范围。头发、衣服、眼睛都可存颜色规则，但不绑定或自动调取任何素材。
- 明确认可的优质样本允许没有色差；保存最终有效颜色快照，不伪造一次修改。
- 未确认、换素材、换方案导致范围变化、无法关联当前配方的记录，不自动学习或发布。没有有效样本时，报告明确显示“不建议更新”。

## 必须由画师决定的最后一步

1. 核对候选关联的模板、A/B、具体素材夹子、配方版本。
2. 用实际 PSD 比较前后效果，确认柔光等混合模式、透明度、纹理、肤色和固定高光未受破坏。
3. 按项目选择拒绝、保留样本，或在配色手册编辑器中修改。
4. 预览满意后才提交为新版本，再核对备份状态。旧订单不自动重算。

`review-candidates.json` 不是正式手册，不能直接当成 `normalizeHandbook` 的输入。`publishes` 永远是 `false`；此工具没有自动升级稳定规则或执行候选补丁的入口。

## 模块接口摘要

`createFeedbackProposal(initialSnapshot, finalSnapshot, actions)` 比较净变化。动作支持 `id`、`componentId`、`role`、`type`（manual/derived/undo/redo）、`targetActionId`、`reason`、`confirmed`。相同动作 ID 去重，冲突动作 ID 拒绝；同一项目以最后有效手动决策为准。

快照是 `{ components: [{ id, category, name, recipeId, anchorHex, layers, context }] }`。未知原色应省略，不填占位 HEX。`context` 可含 `templateSignature`、`schemeId`、`characterName`、`orderId`、`slot`、`assetId`、`assetVersion`、`folderPath`、`source`。`assetVersion` 可以是字符串或数值，其余为短文本。部件标识必须包含模板/素材版本/A-B/夹子身份，不能只用显示名称。

`createGoldenSample(snapshot, { componentId, confirmed: true, reason: 'AESTHETIC', context })` 创建优质样本。必须存在有效颜色，`context` 不得换成别的模板或部件；未明确确认的样本权重为 0。返回的 `kind` 是 `golden`，`changes` 为空，`finalSnapshot` 保存原快照。

标准反馈会重新计算 `learningEligible` 和 `learningWeight`（有效的一次确认是 1，否则 0），不相信导入数据宣称的学习权重。它保存 `recipeId`、实际前后快照和范围，而不是把每个衍生图层当一次审美投票。

若反馈附带起点或终点快照，声明的每条修改都必须与对应快照一致。可以只记录手动改过的图层，不必把衍生色重复列入；但不能通过手改导出 JSON 伪造与快照不同的原色或最终色。
