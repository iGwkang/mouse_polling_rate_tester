# 鼠标回报率测试

浏览器端鼠标回报率（Polling Rate）测试工具，使用 `pointerrawupdate` 或 `mousemove` 统计事件间隔，实时显示当前回报率与峰值。

## 在线体验

**[👉 点击这里直接进入测试](https://igwkang.github.io/mouse_polling_rate_tester/)**

无需安装，打开链接即可在浏览器中测试鼠标回报率。

## 使用方法

1. 打开上方链接
2. 点击测试区域进入 Pointer Lock 相对移动采样模式
3. 移动鼠标进行测试，观察「当前回报率」与「峰值」
4. 再次点击测试区域或按 `Esc` 结束测试

## 浏览器支持

- 推荐使用 **Chrome** 或 **Edge**（支持 `pointerrawupdate`，采样更精确）
- 其他浏览器会回退到 `mousemove`，结果可能略低于真实回报率
- 需在 **HTTPS** 或 **localhost** 环境下使用（GitHub Pages 已满足）

## 本地运行

```bash
git clone https://github.com/igwkang/mouse_polling_rate_tester.git
cd mouse_polling_rate_tester
python -m http.server 8080
```

浏览器访问 `http://localhost:8080`。

## 许可证

MIT
