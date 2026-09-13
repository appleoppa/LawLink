# LawLink 运维手册（部署者三件套）

> 依据《LawLink-改进分析报告-v5》P1 第 10 项：备份恢复演练、版本升级与回退、数据分级。面向自部署的律所运维者（可以是律师本人）。命令均以仓库根目录为工作目录。
> 日期：2026-09-13

## 一、备份与恢复演练

### 1.1 日常备份

仓库自带 `scripts/backup.sh`（数据库 pg_dump + storage 目录打包，输出到 `./backups/<时间戳>/`）：

```bash
./scripts/backup.sh                # 备份到 ./backups/
./scripts/backup.sh /mnt/nas/lawlink   # 备份到指定目录（建议异地/离线介质）
```

Docker Compose 部署时的等价命令（数据在容器卷里）：

```bash
# 数据库逻辑备份
docker compose exec -T db pg_dump -U lawlink -Fc lawlink > backups/db_$(date +%F).dump

# 附件卷备份（app_storage 卷）
docker run --rm -v lawlink_app_storage:/data -v $(pwd)/backups:/backup alpine \
  tar czf /backup/storage_$(date +%F).tar.gz -C /data .
```

**必须同时备份三样**：数据库转储、storage 附件卷、`.env`（含 `STORAGE_ENCRYPTION_KEY`——**丢失该密钥则加密附件永久无法解密**，与备份分开存放但同样妥善保管）。

### 1.2 恢复演练（每季度至少一次）

"有备份、没演练"到恢复时才暴露问题。在隔离环境（另一台机器或本机另一目录）执行：

```bash
# 1) 起一套干净的 db
docker compose up -d db

# 2) 恢复数据库
cat backups/db_2026-09-13.dump | docker compose exec -T db pg_restore -U lawlink -c -d lawlink

# 3) 恢复附件卷
docker run --rm -v lawlink_app_storage:/data -v $(pwd)/backups:/backup alpine \
  sh -c "cd /data && tar xzf /backup/storage_2026-09-13.tar.gz"

# 4) 用生产 .env 启动应用并验证
docker compose up app
```

**演练通过标准**（缺一不可）：
- 能用原账号登录；
- 任选一个案件：详情、附件列表、附件可下载且内容正常（验证加密密钥配对）；
- 任选一次归档：导出 ZIP 与归档记录清单一致（校验值匹配）；
- 管理后台审计日志有历史记录。

演练结果（时间、备份文件、发现的问题）记入运维日志。备份保留策略建议：每日保留 7 份、每周保留 4 份、每月保留 12 份；备份文件与生产环境不同机、不同账号，防勒索加密后连备份一起丢失。

## 二、版本升级与回退

### 2.1 标准升级流程

```bash
# 1) 升级前备份（同上）
./scripts/backup.sh

# 2) 拉取新版本并重建
git pull
docker compose build app
docker compose up -d app

# 3) 应用数据库迁移（容器启动后执行，或进入容器）
docker compose exec app npx prisma migrate deploy
```

**先看迁移说明**：每次升级前阅读版本说明中列出的迁移名。涉及 Schema 变更的版本，迁移不可跳过、不可重复执行（已执行的迁移数据库会自动跳过）。`migrate deploy` 是生产唯一正确的迁移命令，**永远不要**在生产使用 `migrate dev` 或 `prisma db push`。

### 2.2 回退

- **仅代码回退（无 Schema 变更的版本）**：`git checkout <上一个版本> && docker compose build app && docker compose up -d app`。
- **含 Schema 变更的回退**：Prisma 不自动回滚迁移。原则是**向前修复**（发布修复版本）而非回滚数据库。确需回退时：用升级前备份恢复数据库（接受升级后产生的数据丢失），并明确这一点后再操作。

升级窗口建议选在无开庭提醒推送的时段（避开每日 09:00 扫描），停机期间挂维护提示。

## 三、数据分级说明

| 级别 | 内容 | 存放 | 约束 |
|---|---|---|---|
| 绝密（禁出所） | 身份证件照片、案件附件正文、证据材料 | `storage/`（AES-256-GCM 可选加密），下载经鉴权 API | 不出服务器；备份加密保存；不进公开直链/通用导出 |
| 机密 | 客户证件号、电话、案由与标的、冲突检索记录、审计日志 | 数据库 | 展示打码/按需查看；日志不落 PII 明文；不出所 |
| 内部 | 案件编号、状态、期限与开庭安排、通知 | 数据库 | 所内可见；ICS 订阅链接即凭证，泄露按重置处理 |
| 可公开 | 程序代码、文档、品牌资源 | 代码仓库 | MIT 协议 |

**附件加密开关的取舍**：`STORAGE_ENCRYPTION_KEY` 配置后新附件以 AES-256-GCM 落盘，防"介质被物理拷走裸读"；代价是密钥与备份必须成对保管。建议启用。密钥轮换：当前版本尚无在线轮换工具，轮换需停机 + 用旧钥解密存量 + 新钥重加密（工具在 P1 规划中）；日常只需确保密钥不进代码、不进日志。

**AI / 外部服务边界**：AI 审查与元典调用会把案件相关文本/图片发送到所配置的外部服务（管理后台可配置域名）；证件识别对非本地服务强制逐次确认。涉密材料所在案件应评估是否使用外部 AI 功能——系统不强制阻止（由所内制度决定），但每次调用均记入外部调用台账（服务、成败、耗时，不含正文）。

## 四、常规巡检清单（每周 5 分钟）

1. 管理后台「提醒维护」：最近一次扫描与群机器人推送状态是否正常（失败会有红字原因）；
2. 管理后台「AI 与元典」：外部调用台账失败率是否突增；
3. `docker compose ps`：两个容器均为 running/healthy；
4. 磁盘空间：`df -h` 与 `docker system df`（备份与附件是增长主力）；
5. 本周备份文件存在且大小合理。
