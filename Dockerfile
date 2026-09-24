# LawLink 应用容器
# 多阶段构建：deps → builder → runner

FROM node:22-alpine AS deps
WORKDIR /app
# openssl 必须显式安装（2026-09-21 Docker 部署验证暴露）：node:22-alpine 只带
# libssl3，不带 openssl 命令行；Prisma 在安装/生成时用它探测 OpenSSL 版本，探测
# 失败会回退选择 openssl-1.1.x 的引擎二进制，而运行环境只有 libssl3 —— 引擎加载
# 失败，容器内 migrate/seed 与应用查询全部不可用。见 AGENTS §五 6.2。
RUN apk add --no-cache libc6-compat openssl
COPY package*.json ./
COPY prisma ./prisma
RUN npm ci

FROM node:22-alpine AS builder
WORKDIR /app
# 同 deps：prisma generate 同样按探测到的 OpenSSL 版本选引擎
RUN apk add --no-cache openssl
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate
RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# 自动备份链依赖（2026-09-20 第六轮体检 P1-1）：backup.sh 以 bash 运行并调用
# pg_dump。postgresql16-client 对齐 db 服务的 postgres:16（pg_dump 客户端主版本
# 须等于或高于服务器）。缺了这两样，镜像里备份每天失败。
# openssl：运行时 Prisma Client 加载 query engine 需要（同 deps 阶段说明）
RUN apk add --no-cache bash postgresql16-client openssl

RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs

COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next-build ./.next-build
COPY --from=builder --chown=nextjs:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=nextjs:nodejs /app/package.json ./package.json
# next.config.mjs 必须进镜像（2026-09-21 Docker 部署验证暴露）：其中 distDir 读
# NEXT_DIST_DIR（构建产物在 .next-build 而非默认 .next），缺了它 next start 会去
# 找 .next 并报 "Could not find a production build"，容器无限重启。该文件还带着
# serverExternalPackages（缺则 /matters 等路由 500）、serverActions 25MB 上传上限
# 与全站安全响应头——即便能启动，缺配置同样是错的。见 AGENTS §五 6.3。
COPY --from=builder --chown=nextjs:nodejs /app/next.config.mjs ./next.config.mjs
COPY --from=builder --chown=nextjs:nodejs /app/prisma ./prisma
# 备份脚本必须进镜像：cron job 通过 process.cwd()/scripts/backup.sh 调用
COPY --from=builder --chown=nextjs:nodejs /app/scripts ./scripts

# backups 目录预先建好并授权：命名卷首次挂载会继承镜像内目录属主，
# 运行用户 nextjs 才能写入（BACKUP_DIR 默认 /app/backups）
RUN mkdir -p /app/storage /app/backups && chown -R nextjs:nodejs /app/storage /app/backups

USER nextjs
EXPOSE 3000
CMD ["npm", "run", "start"]
