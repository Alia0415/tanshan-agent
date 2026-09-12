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
  caption="正在了解你的关注点"
  position="bottom-right"
/>;
```

浮窗默认固定在右下角，移动端会缩小边距并适配底部安全区域。正式页面也可以只使用 `WaveProgress`，自行实现浮窗外壳。

## 推荐的业务进度映射

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
