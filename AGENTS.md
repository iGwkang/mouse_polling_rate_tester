## Learned User Preferences

- 统计窗口 UI 控件须同时控制定时器间隔与事件回看窗口，二者保持一致
- 默认统计窗口为 0.5 秒
- 完成代码改动后常会要求提交并推送到远程
- README 须包含醒目的在线体验链接，提示用户点击直接进入

## Learned Workspace Facts

- 纯静态前端项目（index.html、app.js、styles.css），无需构建或打包
- 在线部署地址：https://igwkang.github.io/mouse_polling_rate_tester/
- GitHub 仓库 iGwkang/mouse_polling_rate_tester，Pages 从 main 分支根目录部署
- 回报率统计：定时器 tick 内累加事件计数，用 count×1000/实际间隔 换算 Hz；每个浏览器事件计 1 次
- pointerrawupdate / Pointer Lock 需要 HTTPS 或 localhost；本地预览用 python -m http.server
- 纯函数统计逻辑通过 module.exports 暴露，可供 Node 侧验证
