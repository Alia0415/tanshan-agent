# Wave progress

问山澄清流程的受控水波进度组件。组件内部不保存业务阶段；正式页面只需传入 `0～100` 的进度值。

## 直接使用水波球

```tsx
import { WaveProgress } from "@/components/wave-progress";

<WaveProgress value={progress} size={112} label="正在了解你的关注点" />;
```

`size` 可传数字（按 px 处理）或 CSS 尺寸字符串。不传时占满父容器。

## 使用内置浮窗

```tsx
import { WaveProgressFloat } from "@/components/wave-progress";

<WaveProgressFloat
  value={progress}
  position="bottom-right"
/>;
```

浮窗默认固定在右下角，只显示水波圆，不显示外框、文字或百分比；进度名称和数值仍提供给屏幕阅读器。移动端会缩小边距并适配底部安全区域。水波振幅和偏移随圆的尺寸等比例缩放，避免小尺寸下出现尖峰。正式页面也可以只使用 `WaveProgress`。

## 推荐的业务进度映射

首页 `Workspace` 已接入浮窗：仅在 `clarifying` 且有追问卡片时显示；打开关于弹窗时隐藏。水位按 `(clarification_count + 1) / (MAX_CLARIFICATION_ROUNDS + 1)` 推进，保留完成阶段，不把仍在等待回答的最后一问显示成 100%。这是轮次进度，不是理解程度或答案准确率。提交等待或失败时保持水位，下一轮返回后再上升；最后一轮回答被确认（包括提前结束或跳过）后升到 100%，用 1 秒完成上升并停留约 0.8 秒后收起；不会延迟后端回答流程。新建提问立即收起。满水位会将波谷抬过圆顶并补足底部水体，保证没有白色缺口。手机端缩小水波球并预留底部滚动空间。

```ts
const progressByStage = {
  idle: 0,
  clarification1: 25,
  clarification2: 50,
  clarification3: 75,
  organizing: 100,
};
```

如果系统提前结束追问，直接把进度更新为 `100`。动画会从当前水位平滑上升，不需要组件知道总问题数。

## 验收页面

访问 `/wave-progress` 可以检查离散步骤、任意百分比、回退、满水位和移动端表现。该页面只用于演示与视觉验收，不应承载正式业务状态。
