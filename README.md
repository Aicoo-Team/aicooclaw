# pulseclaw-systemind

`pulseclaw-systemind` 是一个用于将 **OpenClaw** 一键接入 **Pulse** 的插件包。

## 安装

```bash
npx pulseclaw-systemind install
```

执行后会引导你完成 Pulse 渠道接入。

## CLI

包内提供命令：

```bash
pulseclaw
```

对应入口：`dist/cli/install.js`

## 开发

安装依赖：

```bash
npm install
```

构建：

```bash
npm run build
```

开发监听：

```bash
npm run dev
```

## 包内容

发布时包含：

- `dist/`
- `openclaw.plugin.json`

## License

MIT
