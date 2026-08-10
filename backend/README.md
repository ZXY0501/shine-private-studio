# Shine Backend v0.1

这是从已部署的阿里云函数计算连通性测试包中归档的后端基线。

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

测试接口：

- `GET /health`
- `GET /api/ping`

环境变量：

- `ALLOWED_ORIGIN`
  - 第一轮连通测试可不填，默认 `*`。
  - 正式环境应设置为实际 GitHub Pages origin。

注意：

- 本基线不包含任何 DeepSeek API Key。
- 本基线不保存 PSD、订单或模板。
- 本基线只验证后端能否被前端调用。
